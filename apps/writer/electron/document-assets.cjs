const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const ASSET_PROTOCOL = "paperwriter-asset";
const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeAssetPath(assetPath) {
  const normalized = String(assetPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  if (
    normalized.length > 512
    || /[\u0000-\u001f\u007f]/.test(normalized)
    || !normalized.startsWith("assets/")
    || segments.some((segment) => !segment || segment === "." || segment === "..")
    || path.isAbsolute(normalized)
  ) {
    return "";
  }
  return normalized;
}

function assetUrlForDocument(filePath, assetPath) {
  const normalizedAssetPath = normalizeAssetPath(assetPath);
  if (!filePath || !normalizedAssetPath) return assetPath;
  return `${ASSET_PROTOCOL}://document/${encodeURIComponent(String(filePath))}?asset=${encodeURIComponent(normalizedAssetPath)}`;
}

function stagedAssetUrl(token) {
  return `${ASSET_PROTOCOL}://staged/${encodeURIComponent(String(token || ""))}`;
}

function safeSessionId(value) {
  const sessionId = String(value || "");
  if (!UUID_PATTERN.test(sessionId)) throw new Error("无效的图片会话标识");
  return sessionId;
}

function safeExtension(filePath) {
  const extension = path.extname(String(filePath || "")).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/i.test(extension) ? extension : "";
}

function parseAssetUrl(value, { hasStagedToken, resolveDocumentReference } = {}) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== `${ASSET_PROTOCOL}:`) return null;
    if (url.hostname === "document") {
      const reference = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const assetPath = normalizeAssetPath(decodeURIComponent(url.searchParams.get("asset") || ""));
      if (!UUID_PATTERN.test(reference) || !assetPath || typeof resolveDocumentReference !== "function") return null;
      const resolved = resolveDocumentReference(reference);
      const filePath = typeof resolved === "string" ? resolved : resolved?.filePath;
      if (!filePath) return null;
      return { kind: "document", filePath, assetPath, reference, token: resolved?.token || "" };
    }
    if (url.hostname === "staged") {
      if (url.search || url.hash) return null;
      const token = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (!UUID_PATTERN.test(token) || url.pathname.replace(/^\/+/, "").includes("/")) return null;
      if (typeof hasStagedToken !== "function" || !hasStagedToken(token)) return null;
      return { kind: "staged", token };
    }
    return null;
  } catch {
    return null;
  }
}

function createDocumentAssetRegistry({
  pathApi = path,
  platform = process.platform,
  createToken = randomUUID,
  } = {}) {
  const tokenToPath = new Map();
  const pathToToken = new Map();
  const pathAliases = new Map();
  const pathKey = (value) => {
    const resolved = pathApi.resolve(String(value || ""));
    return platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
  };
  const register = (filePath) => {
    const rawPath = String(filePath || "");
    if (!rawPath) throw new Error("缺少信笺资源路径");
    const resolved = pathApi.resolve(rawPath);
    const key = pathKey(resolved);
    const existing = pathToToken.get(key);
    if (existing) return { token: existing, filePath: tokenToPath.get(existing) };
    const token = createToken();
    if (!UUID_PATTERN.test(token)) throw new Error("无效的信笺资源 token");
    tokenToPath.set(token, resolved);
    pathToToken.set(key, token);
    return { token, filePath: resolved };
  };
  const resolve = (reference) => {
    const value = String(reference || "");
    if (UUID_PATTERN.test(value)) {
      const filePath = tokenToPath.get(value);
      return filePath ? { token: value, filePath } : null;
    }
    let key;
    try { key = pathKey(value); } catch { return null; }
    const token = pathToToken.get(key);
    if (token) return { token, filePath: tokenToPath.get(token) };
    const aliasedPath = pathAliases.get(key);
    if (!aliasedPath) return null;
    const registered = register(aliasedPath);
    return { token: registered.token, filePath: registered.filePath };
  };
  const urlFor = (filePath, assetPath) => {
    const registered = register(filePath);
    return assetUrlForDocument(registered.token, assetPath);
  };
  const rebasePath = (fromPath, toPath) => {
    const from = pathApi.resolve(String(fromPath || ""));
    const to = pathApi.resolve(String(toPath || ""));
    if (!from || !to) return [];
    const updates = [];
    for (const [token, currentPath] of [...tokenToPath.entries()]) {
      const relative = pathApi.relative(from, currentPath);
      const inside = relative === "" || (!relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative));
      if (!inside) continue;
      const nextPath = relative ? pathApi.resolve(to, relative) : to;
      const oldKey = pathKey(currentPath);
      pathToToken.delete(oldKey);
      pathAliases.set(oldKey, nextPath);
      tokenToPath.set(token, nextPath);
      pathToToken.set(pathKey(nextPath), token);
      updates.push({ token, oldPath: currentPath, path: nextPath });
    }
    return updates;
  };
  const revokePath = (filePath, includeChildren = false) => {
    const source = pathApi.resolve(String(filePath || ""));
    const contains = (candidate) => {
      const relative = pathApi.relative(source, pathApi.resolve(String(candidate || "")));
      return relative === "" || (includeChildren && !relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative));
    };
    const removed = [];
    for (const [token, currentPath] of [...tokenToPath.entries()]) {
      if (!contains(currentPath)) continue;
      tokenToPath.delete(token);
      pathToToken.delete(pathKey(currentPath));
      removed.push({ token, filePath: currentPath });
    }
    for (const [aliasKey, aliasPath] of [...pathAliases.entries()]) {
      if (contains(aliasKey) || contains(aliasPath)) pathAliases.delete(aliasKey);
    }
    return removed;
  };
  return {
    register,
    rebasePath,
    revokePath,
    resolve,
    size: () => tokenToPath.size,
    urlFor,
  };
}

async function cleanupStaleSessions(rootDir, {
  currentSessionId = "",
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  now = Date.now(),
  fsApi = fs,
} = {}) {
  if (!rootDir) throw new Error("缺少图片暂存根目录");
  const resolvedRoot = path.resolve(String(rootDir || ""));
  await fsApi.mkdir(resolvedRoot, { recursive: true });
  const entries = await fsApi.readdir(resolvedRoot, { withFileTypes: true });
  const removed = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === currentSessionId || !UUID_PATTERN.test(entry.name)) continue;
    const directory = path.resolve(resolvedRoot, entry.name);
    if (path.dirname(directory) !== resolvedRoot) continue;
    try {
      const stat = await fsApi.stat(directory);
      if (now - stat.mtimeMs <= staleAfterMs) continue;
      await fsApi.rm(directory, { recursive: true, force: true });
      removed.push(entry.name);
    } catch {
      // Another application instance may be touching or removing this session.
    }
  }
  return removed;
}

function createStagedAssetStore({
  rootDir,
  sessionId = randomUUID(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
  now = () => Date.now(),
  fsApi = fs,
  createToken = randomUUID,
} = {}) {
  if (!rootDir) throw new Error("缺少图片暂存目录");
  const resolvedRoot = path.resolve(String(rootDir));
  const resolvedSessionId = safeSessionId(sessionId);
  const sessionDir = path.resolve(resolvedRoot, resolvedSessionId);
  if (path.dirname(sessionDir) !== resolvedRoot) throw new Error("无效的图片会话目录");
  const registry = new Map();

  const hashFile = async (filePath) => {
    const hash = createHash("sha256");
    const handle = await fsApi.open(filePath, "r");
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    try {
      while (true) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
        if (!bytesRead) break;
        hash.update(chunk.subarray(0, bytesRead));
        position += bytesRead;
      }
      return hash.digest("hex");
    } finally {
      await handle.close();
    }
  };

  const initialize = async () => {
    await fsApi.mkdir(sessionDir, { recursive: true });
    await cleanupStaleSessions(resolvedRoot, {
      currentSessionId: resolvedSessionId,
      staleAfterMs,
      now: now(),
      fsApi,
    });
    return { rootDir: resolvedRoot, sessionDir, sessionId: resolvedSessionId };
  };

  const touch = async () => {
    const timestamp = new Date(now());
    try { await fsApi.utimes(sessionDir, timestamp, timestamp); } catch { /* Session may be closing. */ }
  };

  const has = (token) => registry.has(String(token || ""));

  const stage = async (sourcePath, { mime = "", name = "" } = {}) => {
    const absoluteSource = path.resolve(String(sourcePath || ""));
    const sourceStat = await fsApi.stat(absoluteSource);
    if (!sourceStat.isFile()) throw new Error("所选图片不是文件");
    await fsApi.mkdir(sessionDir, { recursive: true });
    const token = String(createToken());
    if (!UUID_PATTERN.test(token) || registry.has(token)) throw new Error("无效或重复的图片暂存 token");
    const extension = safeExtension(absoluteSource);
    const stagedPath = path.resolve(sessionDir, `${token}${extension}`);
    const tempPath = path.resolve(sessionDir, `${token}.tmp`);
    if (path.dirname(stagedPath) !== sessionDir || path.dirname(tempPath) !== sessionDir) {
      throw new Error("无效的图片暂存路径");
    }
    try {
      await fsApi.copyFile(absoluteSource, tempPath);
      const copiedStat = await fsApi.stat(tempPath);
      if (!copiedStat.isFile() || copiedStat.size !== sourceStat.size) {
        throw new Error("图片暂存副本不完整");
      }
      const sha256 = await hashFile(tempPath);
      await fsApi.rename(tempPath, stagedPath);
      const record = {
        kind: "staged",
        token,
        filePath: stagedPath,
        extension,
        mime: String(mime || ""),
        name: String(name || path.basename(absoluteSource)),
        size: copiedStat.size,
        sha256,
      };
      registry.set(token, record);
      await touch();
      return { ...record, src: stagedAssetUrl(token) };
    } catch (error) {
      registry.delete(token);
      const removeFailedOutput = async (filePath) => {
        try { await fsApi.rm(filePath, { force: true }); } catch { /* Preserve the staging error. */ }
      };
      await Promise.all([removeFailedOutput(tempPath), removeFailedOutput(stagedPath)]);
      throw error;
    }
  };

  const resolve = async (token) => {
    const record = registry.get(String(token || ""));
    if (!record) throw new Error("图片暂存 token 未注册或已失效");
    let stat;
    try {
      stat = await fsApi.stat(record.filePath);
    } catch (error) {
      throw new Error(`图片暂存资源不存在：${record.name}`, { cause: error });
    }
    if (!stat.isFile() || stat.size !== record.size) throw new Error(`图片暂存资源已损坏：${record.name}`);
    await touch();
    return { ...record };
  };

  const read = async (token) => {
    const record = await resolve(token);
    let buffer;
    try {
      buffer = await fsApi.readFile(record.filePath);
    } catch (error) {
      throw new Error(`图片暂存资源不存在：${record.name}`, { cause: error });
    }
    if (buffer.length !== record.size) throw new Error(`图片暂存资源已损坏：${record.name}`);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (sha256 !== record.sha256) throw new Error(`图片暂存资源完整性校验失败：${record.name}`);
    return { ...record, buffer };
  };

  const parse = (value) => parseAssetUrl(value, { hasStagedToken: has });

  const cleanupCurrent = async () => {
    registry.clear();
    if (path.dirname(sessionDir) !== resolvedRoot) throw new Error("拒绝清理无效的图片会话目录");
    await fsApi.rm(sessionDir, { recursive: true, force: true });
  };

  return {
    cleanupCurrent,
    has,
    initialize,
    parse,
    read,
    resolve,
    rootDir: resolvedRoot,
    sessionDir,
    sessionId: resolvedSessionId,
    stage,
    touch,
  };
}

module.exports = {
  ASSET_PROTOCOL,
  DEFAULT_STALE_AFTER_MS,
  assetUrlForDocument,
  cleanupStaleSessions,
  createDocumentAssetRegistry,
  createStagedAssetStore,
  normalizeAssetPath,
  parseAssetUrl,
  stagedAssetUrl,
};
