const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const ASSET_PROTOCOL = "paperwriter-asset";
const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_STAGED_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_IMAGE_HEADER_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidImage(message) {
  const error = new Error(message);
  error.code = "INVALID_IMAGE";
  return error;
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda || offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(buffer) {
  if (
    buffer.length < 30
    || buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WEBP"
  ) return null;
  const chunkType = buffer.toString("ascii", 12, 16);
  if (chunkType === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunkType === "VP8L" && buffer[20] === 0x2f) {
    return {
      width: 1 + buffer[21] + ((buffer[22] & 0x3f) << 8),
      height: 1 + (buffer[22] >> 6) + (buffer[23] << 2) + ((buffer[24] & 0x0f) << 10),
    };
  }
  if (
    chunkType === "VP8 "
    && buffer[23] === 0x9d
    && buffer[24] === 0x01
    && buffer[25] === 0x2a
  ) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

function inspectImageBuffer(buffer, expectedExtension = "") {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const extension = String(expectedExtension || "").replace(/^\./, "").toLowerCase();
  let type = "";
  let dimensions = null;
  if (
    bytes.length >= 24
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    && bytes.toString("ascii", 12, 16) === "IHDR"
  ) {
    type = "png";
    dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6))) {
    type = "gif";
    dimensions = { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  } else if (bytes.length >= 26 && bytes.toString("ascii", 0, 2) === "BM") {
    const dibSize = bytes.readUInt32LE(14);
    type = "bmp";
    dimensions = dibSize === 12
      ? { width: bytes.readUInt16LE(18), height: bytes.readUInt16LE(20) }
      : { width: Math.abs(bytes.readInt32LE(18)), height: Math.abs(bytes.readInt32LE(22)) };
  } else if ((dimensions = jpegDimensions(bytes))) {
    type = "jpeg";
  } else if ((dimensions = webpDimensions(bytes))) {
    type = "webp";
  }
  if (!type || !dimensions) throw invalidImage("无法识别图片的真实格式或尺寸");
  const expectedType = extension === "jpg" ? "jpeg" : extension;
  if (expectedType && type !== expectedType) throw invalidImage("图片扩展名与真实格式不一致");
  return { type, ...dimensions };
}

async function inspectImageFile(fsApi, filePath, expectedExtension) {
  const handle = await fsApi.open(filePath, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0) throw invalidImage("所选图片不是有效文件");
    const length = Math.min(stat.size, MAX_IMAGE_HEADER_BYTES);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return inspectImageBuffer(buffer.subarray(0, bytesRead), expectedExtension);
  } finally {
    await handle.close();
  }
}

function assertImageDimensions(metadata, { maxDimension, maxPixels }) {
  const width = Number(metadata?.width) || 0;
  const height = Number(metadata?.height) || 0;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width > maxDimension
    || height > maxDimension
    || width * height > maxPixels
  ) {
    throw invalidImage("图片尺寸或像素数量超过安全上限");
  }
  return metadata;
}

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

  const stage = async (sourcePath, {
    mime = "",
    name = "",
    maxBytes = DEFAULT_MAX_STAGED_ASSET_BYTES,
    validateImage = false,
    maxImageDimension = 16_384,
    maxImagePixels = 40_000_000,
  } = {}) => {
    const absoluteSource = path.resolve(String(sourcePath || ""));
    const sourceStat = await fsApi.stat(absoluteSource);
    if (!sourceStat.isFile()) throw new Error("所选图片不是文件");
    const byteLimit = Math.min(
      DEFAULT_MAX_STAGED_ASSET_BYTES,
      Math.max(1, Math.floor(Number(maxBytes) || DEFAULT_MAX_STAGED_ASSET_BYTES)),
    );
    if (sourceStat.size > byteLimit) throw new Error("所选资源超过安全上限");
    const extension = safeExtension(absoluteSource);
    const imagePolicy = {
      maxDimension: Math.max(1, Math.floor(Number(maxImageDimension) || 16_384)),
      maxPixels: Math.max(1, Math.floor(Number(maxImagePixels) || 40_000_000)),
    };
    const sourceImage = validateImage
      ? assertImageDimensions(
        await inspectImageFile(fsApi, absoluteSource, extension),
        imagePolicy,
      )
      : null;
    await fsApi.mkdir(sessionDir, { recursive: true });
    const token = String(createToken());
    if (!UUID_PATTERN.test(token) || registry.has(token)) throw new Error("无效或重复的图片暂存 token");
    const stagedPath = path.resolve(sessionDir, `${token}${extension}`);
    const tempPath = path.resolve(sessionDir, `${token}.tmp`);
    if (path.dirname(stagedPath) !== sessionDir || path.dirname(tempPath) !== sessionDir) {
      throw new Error("无效的图片暂存路径");
    }
    try {
      await fsApi.copyFile(absoluteSource, tempPath);
      const copiedStat = await fsApi.stat(tempPath);
      if (
        !copiedStat.isFile()
        || copiedStat.size !== sourceStat.size
        || copiedStat.size > byteLimit
      ) {
        throw new Error("图片暂存副本不完整");
      }
      if (validateImage) {
        const copiedImage = assertImageDimensions(
          await inspectImageFile(fsApi, tempPath, extension),
          imagePolicy,
        );
        if (
          copiedImage.type !== sourceImage.type
          || copiedImage.width !== sourceImage.width
          || copiedImage.height !== sourceImage.height
        ) {
          throw invalidImage("图片在复制期间发生变化");
        }
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
  inspectImageBuffer,
  normalizeAssetPath,
  parseAssetUrl,
  stagedAssetUrl,
};
