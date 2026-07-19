const nativeFs = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const { atomicWriteFile, createPathWriteQueue } = require("./document-storage.cjs");
const {
  REVISION_CONFLICT_CODE,
  assertExpectedRevision,
  readFileSnapshot,
} = require("./document-revision.cjs");

const CONFIG_VERSION = 1;
const LIBRARY_VERSION = 1;
const CONFIG_FILE = "research-library.json";
const META_DIRECTORY = ".jianjian";
const LIBRARY_DIRECTORY = "research-library";
const MANIFEST_FILE = "manifest.json";
const SOURCES_DIRECTORY = "sources";
const WEB_TREE_FILE = "web-tree.json";
const SOURCE_JSON_MAX_BYTES = 256 * 1024;
const WEB_TREE_JSON_MAX_BYTES = 1024 * 1024;
const SOURCE_LIMIT = 5000;
const WEB_FOLDER_LIMIT = 2000;
const WEB_FOLDER_MAX_DEPTH = 16;
const DIRECTORY_ENTRY_LIMIT = 5000;
const IMPORT_FILE_MAX_BYTES = 512 * 1024 * 1024;
const PDF_READ_MAX_BYTES = 128 * 1024 * 1024;
const TEXT_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const SOURCE_TYPES = new Set(["file", "web"]);
const DOCUMENT_PREVIEW_EXTENSIONS = new Set([".letterpaper", ".paperdoc"]);
const MARKDOWN_PREVIEW_EXTENSIONS = new Set([".md", ".markdown"]);
const TEXT_PREVIEW_EXTENSIONS = new Set([".txt", ".log"]);
const TABLE_PREVIEW_EXTENSIONS = new Set([".csv", ".tsv"]);
const IMAGE_PREVIEW_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const SAFE_EXTERNAL_EXTENSIONS = new Set([
  ...DOCUMENT_PREVIEW_EXTENSIONS,
  ".pdf",
  ...MARKDOWN_PREVIEW_EXTENSIONS,
  ...TEXT_PREVIEW_EXTENSIONS,
  ...TABLE_PREVIEW_EXTENSIONS,
  ...IMAGE_PREVIEW_EXTENSIONS,
]);

function boundedText(value, maximum = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeUuid(value) {
  const id = String(value || "").trim().toLowerCase();
  return UUID_PATTERN.test(id) ? id : "";
}

function normalizeSourceId(value) {
  const id = String(value || "").trim();
  return SOURCE_ID_PATTERN.test(id) ? id : "";
}

function normalizeTimestamp(value, fallback = "") {
  const candidate = boundedText(value, 64);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : fallback;
}

function normalizeWebUrl(value) {
  const candidate = boundedText(value, 4096);
  if (!candidate) return "";
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("资料网址格式不正确");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("资料网址仅支持不含账号信息的 HTTP 或 HTTPS 地址");
  }
  return parsed.toString();
}

function normalizeRelativePath(value, { allowEmpty = true } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (allowEmpty) return "";
    throw new Error("缺少资料相对路径");
  }
  if (/^[a-zA-Z]:/.test(raw) || /^[/\\]{1,2}/.test(raw) || raw.includes("\0")) {
    throw new Error("资料操作只接受相对路径");
  }
  const normalized = path.posix.normalize(raw.replace(/\\/g, "/")).replace(/^\.\//, "");
  if (!normalized || normalized === ".") {
    if (allowEmpty) return "";
    throw new Error("缺少资料相对路径");
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("资料相对路径无效或越过根目录");
  }
  if (segments.some((segment) => segment.toLocaleLowerCase("en-US") === META_DIRECTORY)) {
    throw new Error(".jianjian 是笺间保留目录");
  }
  return segments.join("/");
}

function normalizeEntryName(value, fallback = "") {
  const name = String(value ?? "").trim();
  if (!name && fallback) return fallback;
  if (!name || name === "." || name === ".." || name.length > 240) throw new Error("资料项目名称无效");
  if (/[\u0000-\u001f\u007f\\/:*?"<>|]/.test(name) || /[. ]$/.test(name)) {
    throw new Error("资料项目名称包含不受支持的字符");
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error("资料项目名称属于系统保留名称");
  }
  if (name.toLocaleLowerCase("en-US") === META_DIRECTORY) throw new Error(".jianjian 是笺间保留目录");
  return name;
}

function pathKey(value, pathApi = path, platform = process.platform) {
  const resolved = pathApi.resolve(String(value || ""));
  return platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

function isPathInside(rootPath, candidatePath, pathApi = path, platform = process.platform) {
  const root = pathKey(rootPath, pathApi, platform);
  const candidate = pathKey(candidatePath, pathApi, platform);
  const relative = pathApi.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative));
}

function libraryPaths(rootPath, pathApi = path) {
  const root = pathApi.resolve(String(rootPath || ""));
  const metadataRoot = pathApi.join(root, META_DIRECTORY);
  const libraryRoot = pathApi.join(metadataRoot, LIBRARY_DIRECTORY);
  return {
    root,
    metadataRoot,
    libraryRoot,
    manifestPath: pathApi.join(libraryRoot, MANIFEST_FILE),
    sourcesRoot: pathApi.join(libraryRoot, SOURCES_DIRECTORY),
    webTreePath: pathApi.join(libraryRoot, WEB_TREE_FILE),
  };
}

function normalizeWebScopeKey(value) {
  const scopeKey = String(value || "").trim().toLowerCase();
  if (scopeKey === "global") return "global";
  const workspaceId = scopeKey.startsWith("workspace:") ? normalizeUuid(scopeKey.slice(10)) : "";
  if (!workspaceId) throw new Error("网页资料作用域无效");
  return `workspace:${workspaceId}`;
}

function normalizeWebFolderName(value) {
  const name = boundedText(value, 120);
  if (!name) throw new Error("网页文件夹名称不能为空");
  return name;
}

function emptyWebTree() {
  return { version: 1, folders: [], placements: {} };
}

function normalizeWebTree(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("网页树索引格式无效");
  if (Number(input.version) > 1) throw new Error("网页树索引由更高版本的笺间创建");
  if (Number(input.version) !== 1) throw new Error("网页树索引版本无效");
  if (!Array.isArray(input.folders) || input.folders.length > WEB_FOLDER_LIMIT) throw new Error("网页文件夹数量超过安全上限");
  const folders = input.folders.map((folder) => {
    const id = normalizeUuid(folder?.id);
    if (!id) throw new Error("网页文件夹标识无效");
    const scopeKey = normalizeWebScopeKey(folder?.scopeKey);
    const parentId = folder?.parentId ? normalizeUuid(folder.parentId) : "";
    if (folder?.parentId && !parentId) throw new Error("网页文件夹父级标识无效");
    const createdAt = normalizeTimestamp(folder?.createdAt, "");
    const updatedAt = normalizeTimestamp(folder?.updatedAt, createdAt);
    if (!createdAt || !updatedAt) throw new Error("网页文件夹时间信息无效");
    return { id, name: normalizeWebFolderName(folder?.name), parentId, scopeKey, createdAt, updatedAt };
  });
  const folderMap = new Map();
  for (const folder of folders) {
    if (folderMap.has(folder.id)) throw new Error("网页文件夹标识重复");
    folderMap.set(folder.id, folder);
  }
  const depthMemo = new Map();
  const folderDepth = (folder, visiting = new Set()) => {
    if (depthMemo.has(folder.id)) return depthMemo.get(folder.id);
    if (visiting.has(folder.id)) throw new Error("网页文件夹层级存在循环");
    visiting.add(folder.id);
    let depth = 1;
    if (folder.parentId) {
      const parent = folderMap.get(folder.parentId);
      if (!parent || parent.scopeKey !== folder.scopeKey) throw new Error("网页文件夹父级不存在或作用域不同");
      depth = folderDepth(parent, visiting) + 1;
    }
    visiting.delete(folder.id);
    if (depth > WEB_FOLDER_MAX_DEPTH) throw new Error(`网页文件夹最多支持 ${WEB_FOLDER_MAX_DEPTH} 层`);
    depthMemo.set(folder.id, depth);
    return depth;
  };
  folders.forEach((folder) => folderDepth(folder));
  const rawPlacements = input.placements && typeof input.placements === "object" && !Array.isArray(input.placements)
    ? input.placements
    : {};
  if (Object.keys(rawPlacements).length > SOURCE_LIMIT) throw new Error("网页位置记录数量超过安全上限");
  const placements = {};
  for (const [rawSourceId, placement] of Object.entries(rawPlacements)) {
    const sourceId = normalizeSourceId(rawSourceId);
    if (!sourceId || !placement || typeof placement !== "object" || Array.isArray(placement)) throw new Error("网页位置记录无效");
    const scopeKey = normalizeWebScopeKey(placement.scopeKey);
    const folderId = placement.folderId ? normalizeUuid(placement.folderId) : "";
    if (placement.folderId && !folderId) throw new Error("网页位置的文件夹标识无效");
    if (folderId) {
      const folder = folderMap.get(folderId);
      if (!folder || folder.scopeKey !== scopeKey) throw new Error("网页位置指向不存在或跨作用域的文件夹");
    }
    placements[sourceId] = { scopeKey, folderId };
  }
  return { version: 1, folders, placements };
}

async function lstatOrNull(filePath, fsApi = fs) {
  try {
    return await fsApi.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

async function assertOrdinaryDirectory(directoryPath, message, fsApi = fs) {
  const stat = await fsApi.lstat(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(message);
  return stat;
}

async function ensureOrdinaryDirectory(directoryPath, message, fsApi = fs) {
  await fsApi.mkdir(directoryPath, { recursive: false }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  return assertOrdinaryDirectory(directoryPath, message, fsApi);
}

async function assertResolvedInside(rootPath, candidatePath, { fsApi = fs, pathApi = path, platform = process.platform } = {}) {
  const [realRoot, realCandidate] = await Promise.all([fsApi.realpath(rootPath), fsApi.realpath(candidatePath)]);
  if (!isPathInside(realRoot, realCandidate, pathApi, platform)) throw new Error("资料路径越过已授权根目录");
  return realCandidate;
}

async function ensureLibrary(rootPath, {
  fsApi = fs,
  pathApi = path,
  platform = process.platform,
  createId = randomUUID,
  now = () => new Date(),
} = {}) {
  const paths = libraryPaths(rootPath, pathApi);
  await assertOrdinaryDirectory(paths.root, "资料根目录无效或是符号链接", fsApi);
  await ensureOrdinaryDirectory(paths.metadataRoot, "资料根目录的 .jianjian 无效或是符号链接", fsApi);
  await ensureOrdinaryDirectory(paths.libraryRoot, "独立资料库目录无效或是符号链接", fsApi);
  await ensureOrdinaryDirectory(paths.sourcesRoot, "资料来源目录无效或是符号链接", fsApi);
  for (const directory of [paths.metadataRoot, paths.libraryRoot, paths.sourcesRoot]) {
    await assertResolvedInside(paths.root, directory, { fsApi, pathApi, platform });
  }

  let manifest = null;
  const manifestStat = await lstatOrNull(paths.manifestPath, fsApi);
  if (manifestStat) {
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > SOURCE_JSON_MAX_BYTES) {
      throw new Error("资料库清单无效、过大或是符号链接");
    }
    await assertResolvedInside(paths.libraryRoot, paths.manifestPath, { fsApi, pathApi, platform });
    try {
      manifest = JSON.parse(await fsApi.readFile(paths.manifestPath, "utf8"));
    } catch {
      throw new Error("资料库清单无法解析");
    }
    if (Number(manifest?.version) > LIBRARY_VERSION) throw new Error("资料库由更高版本的笺间创建，当前版本只能停止访问");
    if (Number(manifest?.version) !== LIBRARY_VERSION || !normalizeUuid(manifest?.libraryId)) {
      throw new Error("资料库清单格式无效");
    }
  } else {
    const createdAt = now().toISOString();
    manifest = { version: LIBRARY_VERSION, libraryId: normalizeUuid(createId()), createdAt };
    if (!manifest.libraryId) throw new Error("无法生成稳定的资料库标识");
    await atomicWriteFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { fsApi, pathApi, createId });
  }
  return { ...paths, manifest: { ...manifest, libraryId: normalizeUuid(manifest.libraryId) } };
}

function normalizeBibliographic(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    authors: (Array.isArray(input.authors) ? input.authors : [])
      .slice(0, 100)
      .map((author) => boundedText(author, 200))
      .filter(Boolean),
    year: boundedText(String(input.year ?? ""), 32),
    containerTitle: boundedText(input.containerTitle || input.publication, 1000),
    publisher: boundedText(input.publisher, 500),
    doi: boundedText(input.doi, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
    isbn: boundedText(input.isbn, 64),
    pages: boundedText(input.pages, 128),
  };
}

function normalizeImportedFrom(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const workspaceId = boundedText(input.workspaceId, 128);
  const sourceId = boundedText(input.sourceId, 128);
  return workspaceId && sourceId ? { workspaceId, sourceId } : null;
}

function normalizeSource(input = {}, {
  createId = randomUUID,
  now = () => new Date(),
  previous = null,
  touch = true,
} = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const timestamp = now().toISOString();
  const requestedType = raw.type ?? previous?.type;
  if (!SOURCE_TYPES.has(requestedType)) throw new Error("资料来源仅支持文件或网页");
  const type = requestedType;
  const id = normalizeSourceId(previous?.id) || normalizeSourceId(raw.id) || normalizeSourceId(createId());
  if (!id) throw new Error("资料来源标识无效");
  const relativePath = type === "file"
    ? normalizeRelativePath(raw.relativePath ?? previous?.relativePath, { allowEmpty: false })
    : "";
  const rawUrl = type === "web" ? (raw.url ?? previous?.url ?? "") : "";
  const url = rawUrl ? normalizeWebUrl(rawUrl) : "";
  if (type === "web" && !url) throw new Error("网址资料必须提供 HTTP 或 HTTPS 地址");
  const createdAt = normalizeTimestamp(previous?.createdAt || raw.createdAt, timestamp);
  const importedFrom = normalizeImportedFrom(raw.importedFrom ?? previous?.importedFrom);
  return {
    version: 1,
    kind: "research",
    id,
    type,
    title: boundedText(raw.title ?? previous?.title, 500)
      || (type === "file" ? path.posix.basename(relativePath) : "未命名网址"),
    url,
    excerpt: boundedText(raw.excerpt ?? previous?.excerpt, 200000),
    notes: boundedText(raw.notes ?? previous?.notes, 200000),
    relativePath,
    mime: type === "file" ? boundedText(raw.mime ?? previous?.mime, 160) : "",
    size: type === "file" && Number.isFinite(Number(raw.size ?? previous?.size))
      ? Math.max(0, Number(raw.size ?? previous?.size))
      : 0,
    bibliographic: normalizeBibliographic(raw.bibliographic ?? previous?.bibliographic),
    ...(importedFrom ? { importedFrom } : {}),
    createdAt,
    updatedAt: touch ? timestamp : normalizeTimestamp(raw.updatedAt || previous?.updatedAt, createdAt),
  };
}

function sourceMetadataPath(paths, sourceId, pathApi = path) {
  const id = normalizeSourceId(sourceId);
  if (!id) throw new Error("资料来源标识无效");
  return pathApi.join(paths.sourcesRoot, `${id}.json`);
}

function externalOpenAllowed(relativePath) {
  return SAFE_EXTERNAL_EXTENSIONS.has(path.extname(String(relativePath || "")).toLocaleLowerCase("en-US"));
}

function previewKindFromExtension(extension) {
  const normalized = String(extension || "").toLocaleLowerCase("en-US");
  if (DOCUMENT_PREVIEW_EXTENSIONS.has(normalized)) return "document";
  if (normalized === ".pdf") return "pdf";
  if (MARKDOWN_PREVIEW_EXTENSIONS.has(normalized)) return "markdown";
  if (TEXT_PREVIEW_EXTENSIONS.has(normalized)) return "text";
  if (TABLE_PREVIEW_EXTENSIONS.has(normalized)) return "table";
  if (IMAGE_PREVIEW_EXTENSIONS.has(normalized)) return "image";
  return "unsupported";
}

function previewMimeFromExtension(extension) {
  switch (String(extension || "").toLocaleLowerCase("en-US")) {
    case ".md":
    case ".markdown": return "text/markdown; charset=utf-8";
    case ".txt":
    case ".log": return "text/plain; charset=utf-8";
    case ".csv": return "text/csv; charset=utf-8";
    case ".tsv": return "text/tab-separated-values; charset=utf-8";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".bmp": return "image/bmp";
    default: return "application/octet-stream";
  }
}

function classifyEntry(relativePath) {
  const extension = path.extname(String(relativePath || "")).toLocaleLowerCase("en-US");
  const previewKind = previewKindFromExtension(extension);
  return {
    extension,
    isPdf: extension === ".pdf",
    previewKind,
    canOpenInApp: previewKind !== "unsupported",
    canOpenExternally: SAFE_EXTERNAL_EXTENSIONS.has(extension),
  };
}

function createResearchLibraryManager({
  userDataPath,
  fsApi = fs,
  nativeFsApi = nativeFs,
  pathApi = path,
  platform = process.platform,
  createId = randomUUID,
  now = () => new Date(),
  sourceLimit = SOURCE_LIMIT,
  directoryEntryLimit = DIRECTORY_ENTRY_LIMIT,
  importFileMaxBytes = IMPORT_FILE_MAX_BYTES,
  pdfReadMaxBytes = PDF_READ_MAX_BYTES,
} = {}) {
  const userDataRoot = pathApi.resolve(String(userDataPath || ""));
  if (!String(userDataPath || "") || !pathApi.isAbsolute(userDataRoot)) throw new Error("缺少应用数据目录");
  const configPath = pathApi.join(userDataRoot, CONFIG_FILE);
  const libraryRoots = new Map();
  const writeQueue = createPathWriteQueue({ pathApi, platform });
  let current = null;
  let configuredRootPath = "";
  let unavailableReason = "";
  let watcher = null;

  const persistConfig = async (rootPath = "") => {
    const config = { version: CONFIG_VERSION, rootPath: rootPath ? pathApi.resolve(rootPath) : "" };
    await fsApi.mkdir(userDataRoot, { recursive: true });
    await atomicWriteFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { fsApi, pathApi, createId });
  };

  const registerRoot = (workspace) => {
    libraryRoots.clear();
    libraryRoots.set(workspace.manifest.libraryId, workspace.root);
    current = {
      configured: true,
      available: true,
      libraryId: workspace.manifest.libraryId,
      rootPath: workspace.root,
      rootName: pathApi.basename(workspace.root) || workspace.root,
      createdAt: workspace.manifest.createdAt,
    };
    configuredRootPath = workspace.root;
    unavailableReason = "";
    return { ...current };
  };

  const openSelectedRoot = async (rootPath, { rejectAlias = true } = {}) => {
    const requested = pathApi.resolve(String(rootPath || ""));
    if (!String(rootPath || "") || !pathApi.isAbsolute(requested)) throw new Error("请选择有效的资料根目录");
    const selectedStat = await fsApi.lstat(requested);
    if (!selectedStat.isDirectory() || (rejectAlias && selectedStat.isSymbolicLink())) {
      throw new Error("资料根目录不能是文件、符号链接或目录联接");
    }
    const canonicalRoot = await fsApi.realpath(requested);
    const workspace = await ensureLibrary(canonicalRoot, { fsApi, pathApi, platform, createId, now });
    return { workspace, root: registerRoot(workspace) };
  };

  const initialize = async () => {
    libraryRoots.clear();
    current = null;
    configuredRootPath = "";
    unavailableReason = "";
    let parsed;
    try {
      const stat = await fsApi.lstat(configPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > SOURCE_JSON_MAX_BYTES) throw new Error("本机资料库配置无效");
      parsed = JSON.parse(await fsApi.readFile(configPath, "utf8"));
      if (Number(parsed?.version) !== CONFIG_VERSION) throw new Error("本机资料库配置版本无效");
    } catch (error) {
      if (error?.code === "ENOENT") return { configured: false, available: false };
      unavailableReason = error?.message || "本机资料库配置无法读取";
      return { configured: false, available: false, error: unavailableReason };
    }
    configuredRootPath = pathApi.resolve(String(parsed.rootPath || ""));
    if (!parsed.rootPath) return { configured: false, available: false };
    try {
      return (await openSelectedRoot(configuredRootPath)).root;
    } catch (error) {
      unavailableReason = error?.message || "资料根目录当前不可用";
      return {
        configured: true,
        available: false,
        rootPath: configuredRootPath,
        rootName: pathApi.basename(configuredRootPath) || configuredRootPath,
        error: unavailableReason,
      };
    }
  };

  const selectRoot = async (rootPath) => {
    const opened = await openSelectedRoot(rootPath);
    try {
      await persistConfig(opened.workspace.root);
    } catch (error) {
      watcher?.close?.();
      watcher = null;
      libraryRoots.clear();
      current = null;
      throw error;
    }
    watcher?.close?.();
    watcher = null;
    return opened.root;
  };

  const getRoot = () => {
    if (current) return { ...current };
    if (configuredRootPath) {
      return {
        configured: true,
        available: false,
        rootPath: configuredRootPath,
        rootName: pathApi.basename(configuredRootPath) || configuredRootPath,
        ...(unavailableReason ? { error: unavailableReason } : {}),
      };
    }
    return { configured: false, available: false };
  };

  const clearRoot = async () => {
    watcher?.close?.();
    watcher = null;
    await persistConfig("");
    libraryRoots.clear();
    current = null;
    configuredRootPath = "";
    unavailableReason = "";
    return { configured: false, available: false };
  };

  const contextFor = async (libraryId) => {
    const id = normalizeUuid(libraryId);
    const root = id && libraryRoots.get(id);
    if (!root) throw new Error("资料库未授权或标识已经失效，请重新选择资料目录");
    const workspace = await ensureLibrary(root, { fsApi, pathApi, platform, createId, now });
    if (workspace.manifest.libraryId !== id || pathKey(workspace.root, pathApi, platform) !== pathKey(root, pathApi, platform)) {
      libraryRoots.delete(id);
      throw new Error("资料库身份发生变化，请重新选择资料目录");
    }
    return workspace;
  };

  const resolveCandidate = (paths, relativePath) => {
    const relative = normalizeRelativePath(relativePath);
    const candidate = relative ? pathApi.resolve(paths.root, ...relative.split("/")) : paths.root;
    if (!isPathInside(paths.root, candidate, pathApi, platform)) throw new Error("资料路径越过已授权根目录");
    return { relativePath: relative, candidate };
  };

  const assertSafeExistingPath = async (paths, relativePath, expectedType = "") => {
    const resolved = resolveCandidate(paths, relativePath);
    let cursor = paths.root;
    for (const segment of resolved.relativePath ? resolved.relativePath.split("/") : []) {
      cursor = pathApi.join(cursor, segment);
      const stat = await fsApi.lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error("资料路径包含符号链接或目录联接");
      if (cursor !== resolved.candidate && !stat.isDirectory()) throw new Error("资料路径的中间项目不是文件夹");
    }
    const stat = await fsApi.lstat(resolved.candidate);
    if (stat.isSymbolicLink()) throw new Error("资料项目不能是符号链接或目录联接");
    if (expectedType === "directory" && !stat.isDirectory()) throw new Error("资料目标不是文件夹");
    if (expectedType === "file" && !stat.isFile()) throw new Error("资料目标不是普通文件");
    const canonicalPath = await assertResolvedInside(paths.root, resolved.candidate, { fsApi, pathApi, platform });
    return { ...resolved, path: canonicalPath, stat };
  };

  const listFolder = async (libraryId, relativePath = "") => {
    const paths = await contextFor(libraryId);
    const folder = await assertSafeExistingPath(paths, relativePath, "directory");
    const entries = [];
    const directory = await fsApi.opendir(folder.path);
    try {
      for await (const dirent of directory) {
        if (dirent.name.toLocaleLowerCase("en-US") === META_DIRECTORY) continue;
        if (entries.length >= directoryEntryLimit) throw new Error(`资料文件夹项目超过 ${directoryEntryLimit} 项安全上限`);
        const entryRelativePath = folder.relativePath ? `${folder.relativePath}/${dirent.name}` : dirent.name;
        const candidate = pathApi.join(folder.path, dirent.name);
        let stat;
        try {
          stat = await fsApi.lstat(candidate);
          if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) continue;
          await assertResolvedInside(paths.root, candidate, { fsApi, pathApi, platform });
        } catch (error) {
          if (["ENOENT", "ENOTDIR"].includes(error?.code)) continue;
          throw error;
        }
        entries.push({
          name: dirent.name,
          relativePath: entryRelativePath.replace(/\\/g, "/"),
          kind: stat.isDirectory() ? "folder" : "file",
          size: stat.isFile() ? stat.size : 0,
          mtimeMs: stat.mtimeMs,
          ...(stat.isFile() ? classifyEntry(entryRelativePath) : {}),
        });
      }
    } finally {
      await directory.close().catch(() => {});
    }
    entries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
      return left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" });
    });
    return {
      libraryId: paths.manifest.libraryId,
      relativePath: folder.relativePath,
      rootName: pathApi.basename(paths.root) || paths.root,
      entries,
      folders: entries.filter((entry) => entry.kind === "folder"),
      files: entries.filter((entry) => entry.kind === "file"),
    };
  };

  const createFolder = async (libraryId, parentRelativePath = "", name = "") => {
    const paths = await contextFor(libraryId);
    const parent = await assertSafeExistingPath(paths, parentRelativePath, "directory");
    const folderName = normalizeEntryName(name, "新建文件夹");
    const targetRelativePath = parent.relativePath ? `${parent.relativePath}/${folderName}` : folderName;
    const target = resolveCandidate(paths, targetRelativePath);
    await fsApi.mkdir(target.candidate, { recursive: false });
    await assertSafeExistingPath(paths, targetRelativePath, "directory");
    return { ok: true, libraryId, relativePath: targetRelativePath };
  };

  const uniqueImportPath = async (directoryPath, fileName) => {
    const parsed = pathApi.parse(normalizeEntryName(fileName, "导入资料"));
    for (let sequence = 0; sequence < 10000; sequence += 1) {
      const suffix = sequence ? ` (${sequence + 1})` : "";
      const candidate = pathApi.join(directoryPath, `${parsed.name}${suffix}${parsed.ext}`);
      if (!(await lstatOrNull(candidate, fsApi))) return candidate;
    }
    throw new Error("无法为导入资料生成不冲突的文件名");
  };

  const importFiles = async (libraryId, targetRelativePath = "", sourcePaths = []) => {
    const paths = await contextFor(libraryId);
    const targetDirectory = await assertSafeExistingPath(paths, targetRelativePath, "directory");
    const selectedPaths = Array.isArray(sourcePaths) ? sourcePaths.slice(0, 100) : [];
    if (!selectedPaths.length) return { canceled: true, imported: [] };
    const imported = [];
    for (const sourceValue of selectedPaths) {
      const sourcePath = pathApi.resolve(String(sourceValue || ""));
      const sourceStat = await fsApi.lstat(sourcePath);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error("导入来源必须是普通文件，不能是符号链接");
      if (sourceStat.size > importFileMaxBytes) throw new Error("导入文件超过 512MB 安全上限");
      const targetPath = await uniqueImportPath(targetDirectory.path, pathApi.basename(sourcePath));
      const tempPath = pathApi.join(targetDirectory.path, `.${pathApi.basename(targetPath)}.${createId()}.importing`);
      try {
        await fsApi.copyFile(sourcePath, tempPath, nativeFsApi.constants?.COPYFILE_EXCL || nativeFs.constants.COPYFILE_EXCL);
        await fsApi.rename(tempPath, targetPath);
      } catch (error) {
        await fsApi.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }
      const relativePath = pathApi.relative(paths.root, targetPath).replace(/\\/g, "/");
      const targetStat = await fsApi.stat(targetPath);
      imported.push({
        name: pathApi.basename(targetPath),
        relativePath,
        kind: "file",
        size: targetStat.size,
        mtimeMs: targetStat.mtimeMs,
        ...classifyEntry(relativePath),
      });
    }
    return { canceled: false, libraryId, targetRelativePath: targetDirectory.relativePath, imported };
  };

  const sourceSnapshot = async (paths, sourceId) => {
    const filePath = sourceMetadataPath(paths, sourceId, pathApi);
    const stat = await lstatOrNull(filePath, fsApi);
    if (!stat) return { filePath, snapshot: null };
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > SOURCE_JSON_MAX_BYTES) {
      throw new Error("资料来源元数据无效、过大或是符号链接");
    }
    await assertResolvedInside(paths.sourcesRoot, filePath, { fsApi, pathApi, platform });
    const snapshot = await readFileSnapshot(filePath, { fsApi, maxBytes: SOURCE_JSON_MAX_BYTES });
    return { filePath, snapshot };
  };

  const webTreeSnapshot = async (paths) => {
    const stat = await lstatOrNull(paths.webTreePath, fsApi);
    if (!stat) return null;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > WEB_TREE_JSON_MAX_BYTES) {
      throw new Error("网页树索引无效、过大或是符号链接");
    }
    await assertResolvedInside(paths.libraryRoot, paths.webTreePath, { fsApi, pathApi, platform });
    return readFileSnapshot(paths.webTreePath, { fsApi, maxBytes: WEB_TREE_JSON_MAX_BYTES });
  };

  const parseWebTreeSnapshot = (snapshot) => {
    if (!snapshot) return { tree: emptyWebTree(), diskRevision: null, warnings: [], readOnly: false };
    try {
      const parsed = JSON.parse(snapshot.buffer.toString("utf8"));
      return { tree: normalizeWebTree(parsed), diskRevision: snapshot.revision, warnings: [], readOnly: false };
    } catch (error) {
      return {
        tree: emptyWebTree(),
        diskRevision: snapshot.revision,
        warnings: [{ file: WEB_TREE_FILE, message: error?.message || "网页树索引无法读取" }],
        readOnly: true,
      };
    }
  };

  const listWebTree = async (libraryId) => {
    const paths = await contextFor(libraryId);
    const parsed = parseWebTreeSnapshot(await webTreeSnapshot(paths));
    return { libraryId, ...parsed, folders: parsed.tree.folders, placements: parsed.tree.placements };
  };

  const mutateWebTree = async (libraryId, expectedRevision, change) => {
    const paths = await contextFor(libraryId);
    return writeQueue.run(paths.webTreePath, async () => {
      const beforeSnapshot = await webTreeSnapshot(paths);
      assertExpectedRevision(beforeSnapshot?.revision || null, expectedRevision || null, {
        filePath: paths.webTreePath,
        message: "网页树已在同步目录中被修改，请重新载入后再操作",
      });
      const parsed = parseWebTreeSnapshot(beforeSnapshot);
      if (parsed.readOnly) throw new Error("网页树索引已损坏；已保留原文件，修复前不能修改分组");
      const changed = await change(structuredClone(parsed.tree), paths);
      const tree = normalizeWebTree(changed || parsed.tree);
      const serialized = `${JSON.stringify(tree, null, 2)}\n`;
      if (Buffer.byteLength(serialized, "utf8") > WEB_TREE_JSON_MAX_BYTES) throw new Error("网页树索引超过 1MB 安全上限");
      const immediatelyBefore = await webTreeSnapshot(paths);
      assertExpectedRevision(immediatelyBefore?.revision || null, beforeSnapshot?.revision || null, {
        filePath: paths.webTreePath,
        message: "网页树在保存期间被其他程序修改",
      });
      await atomicWriteFile(paths.webTreePath, serialized, { fsApi, pathApi, createId });
      const committed = parseWebTreeSnapshot(await webTreeSnapshot(paths));
      return { libraryId, ...committed, folders: committed.tree.folders, placements: committed.tree.placements };
    });
  };

  const createWebFolder = async (libraryId, input = {}, expectedRevision = null) => mutateWebTree(
    libraryId,
    expectedRevision,
    (tree) => {
      if (tree.folders.length >= WEB_FOLDER_LIMIT) throw new Error("网页文件夹数量已达上限");
      const scopeKey = normalizeWebScopeKey(input.scopeKey || "global");
      const parentId = input.parentId ? normalizeUuid(input.parentId) : "";
      if (input.parentId && !parentId) throw new Error("网页文件夹父级标识无效");
      const timestamp = now().toISOString();
      const id = normalizeUuid(input.id) || normalizeUuid(createId());
      if (!id) throw new Error("无法生成网页文件夹标识");
      if (tree.folders.some((folder) => folder.id === id)) throw new Error("网页文件夹标识已经存在");
      tree.folders.push({
        id,
        name: normalizeWebFolderName(input.name),
        parentId,
        scopeKey,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return tree;
    },
  );

  const updateWebFolder = async (libraryId, input = {}, expectedRevision = null) => mutateWebTree(
    libraryId,
    expectedRevision,
    (tree) => {
      const id = normalizeUuid(input.id);
      const index = tree.folders.findIndex((folder) => folder.id === id);
      if (index < 0) throw new Error("网页文件夹不存在");
      const previous = tree.folders[index];
      const parentId = Object.prototype.hasOwnProperty.call(input, "parentId")
        ? (input.parentId ? normalizeUuid(input.parentId) : "")
        : previous.parentId;
      if (input.parentId && !parentId) throw new Error("网页文件夹父级标识无效");
      if (parentId === id) throw new Error("不能把网页文件夹移动到自身内部");
      tree.folders[index] = {
        ...previous,
        name: Object.prototype.hasOwnProperty.call(input, "name") ? normalizeWebFolderName(input.name) : previous.name,
        parentId,
        updatedAt: now().toISOString(),
      };
      return tree;
    },
  );

  const deleteWebFolder = async (libraryId, folderId, expectedRevision = null) => mutateWebTree(
    libraryId,
    expectedRevision,
    (tree) => {
      const id = normalizeUuid(folderId);
      const removed = tree.folders.find((folder) => folder.id === id);
      if (!removed) throw new Error("网页文件夹不存在");
      tree.folders = tree.folders
        .filter((folder) => folder.id !== id)
        .map((folder) => folder.parentId === id ? { ...folder, parentId: removed.parentId, updatedAt: now().toISOString() } : folder);
      for (const [sourceId, placement] of Object.entries(tree.placements)) {
        if (placement.folderId === id) tree.placements[sourceId] = { ...placement, folderId: removed.parentId };
      }
      return tree;
    },
  );

  const moveWebSource = async (libraryId, sourceId, placement = {}, expectedRevision = null) => {
    const id = normalizeSourceId(sourceId);
    if (!id) throw new Error("资料来源标识无效");
    const paths = await contextFor(libraryId);
    const stored = await sourceSnapshot(paths, id);
    const source = parseSourceSnapshot(stored.snapshot, id);
    if (!source || source.type !== "web") throw new Error("只有网页来源可以加入网页文件夹");
    return mutateWebTree(libraryId, expectedRevision, (tree) => {
      const scopeKey = normalizeWebScopeKey(placement.scopeKey || "global");
      const folderId = placement.folderId ? normalizeUuid(placement.folderId) : "";
      if (placement.folderId && !folderId) throw new Error("网页文件夹标识无效");
      tree.placements[id] = { scopeKey, folderId };
      return tree;
    });
  };

  const parseSourceSnapshot = (snapshot, sourceId) => {
    if (!snapshot) return null;
    let parsed;
    try {
      parsed = JSON.parse(snapshot.buffer.toString("utf8"));
    } catch {
      throw new Error("资料来源元数据无法解析");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || normalizeSourceId(parsed.id) !== normalizeSourceId(sourceId)) {
      throw new Error("资料来源元数据格式无效");
    }
    if (Number(parsed.version) > 1) throw new Error("资料来源由更高版本的笺间创建，当前版本不能修改");
    if (parsed.kind && parsed.kind !== "research") throw new Error("资料来源元数据类型无效");
    const normalized = normalizeSource(parsed, { createId, now, previous: parsed, touch: false });
    return { ...normalized, diskRevision: snapshot.revision };
  };

  const countSourceFiles = async (paths) => {
    let count = 0;
    const directory = await fsApi.opendir(paths.sourcesRoot);
    try {
      for await (const entry of directory) {
        if (!entry.isFile() || !SOURCE_ID_PATTERN.test(entry.name.replace(/\.json$/i, "")) || !/\.json$/i.test(entry.name)) continue;
        count += 1;
        if (count > sourceLimit) throw new Error("资料来源数量超过安全上限");
      }
    } finally {
      await directory.close().catch(() => {});
    }
    return count;
  };

  const purgeDeprecatedNoteSources = async (paths) => {
    const removedSourceIds = [];
    const warnings = [];
    let inspected = 0;
    const directory = await fsApi.opendir(paths.sourcesRoot);
    try {
      for await (const entry of directory) {
        if (++inspected > sourceLimit) throw new Error("资料来源目录项目超过安全上限");
        if (!entry.isFile() || !/^[a-zA-Z0-9_-]{8,128}\.json$/.test(entry.name)) continue;
        const id = normalizeSourceId(entry.name.slice(0, -5));
        if (!id) continue;
        try {
          const before = await sourceSnapshot(paths, id);
          if (!before.snapshot) continue;
          let parsed;
          try {
            parsed = JSON.parse(before.snapshot.buffer.toString("utf8"));
          } catch {
            warnings.push({ file: entry.name, message: "资料来源元数据无法解析，未自动删除" });
            continue;
          }
          if (parsed?.type !== "note") continue;
          await writeQueue.run(before.filePath, async () => {
            const immediatelyBefore = await sourceSnapshot(paths, id);
            assertExpectedRevision(immediatelyBefore.snapshot?.revision || null, before.snapshot.revision, {
              filePath: before.filePath,
              message: "笔记来源在清理期间被其他程序修改",
            });
            await fsApi.rm(before.filePath, { force: false });
          });
          removedSourceIds.push(id);
        } catch (error) {
          warnings.push({ file: entry.name, message: error?.message || "旧笔记来源删除失败" });
        }
      }
    } finally {
      await directory.close().catch(() => {});
    }
    return { removedSourceIds, warnings };
  };

  const listSources = async (libraryId) => {
    const paths = await contextFor(libraryId);
    const sources = [];
    const migration = await purgeDeprecatedNoteSources(paths);
    const warnings = [...migration.warnings];
    let inspected = 0;
    const directory = await fsApi.opendir(paths.sourcesRoot);
    try {
      for await (const entry of directory) {
        if (++inspected > sourceLimit) throw new Error("资料来源目录项目超过安全上限");
        if (!entry.isFile() || !/^[a-zA-Z0-9_-]{8,128}\.json$/.test(entry.name)) continue;
        const id = normalizeSourceId(entry.name.slice(0, -5));
        if (!id) continue;
        try {
          const stored = await sourceSnapshot(paths, id);
          sources.push(parseSourceSnapshot(stored.snapshot, id));
        } catch (error) {
          warnings.push({ file: entry.name, message: error?.message || "资料来源无法读取" });
        }
      }
    } finally {
      await directory.close().catch(() => {});
    }
    sources.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    return { libraryId, sources, warnings, removedNoteSourceIds: migration.removedSourceIds };
  };

  const assertSourceFile = async (paths, source) => {
    if (source.type !== "file") return source;
    const entry = await assertSafeExistingPath(paths, source.relativePath, "file");
    return { ...source, size: entry.stat.size };
  };

  const upsertSource = async (libraryId, input = {}, expectedRevision = null) => {
    const paths = await contextFor(libraryId);
    const requestedId = normalizeSourceId(input?.id);
    const id = requestedId || normalizeSourceId(createId());
    if (!id) throw new Error("无法生成资料来源标识");
    const filePath = sourceMetadataPath(paths, id, pathApi);
    return writeQueue.run(filePath, async () => {
      const before = await sourceSnapshot(paths, id);
      assertExpectedRevision(before.snapshot?.revision || null, expectedRevision || null, {
        filePath,
        message: "资料来源已在同步目录中被修改，请重新载入后再保存",
      });
      if (!before.snapshot && await countSourceFiles(paths) >= sourceLimit) throw new Error("资料来源数量已达上限");
      const previous = parseSourceSnapshot(before.snapshot, id);
      let source = normalizeSource({ ...input, id }, { createId, now, previous });
      source = await assertSourceFile(paths, source);
      const serialized = `${JSON.stringify(source, (key, value) => key === "diskRevision" ? undefined : value, 2)}\n`;
      if (Buffer.byteLength(serialized, "utf8") > SOURCE_JSON_MAX_BYTES) throw new Error("资料来源元数据超过 256KB 上限");
      const immediatelyBefore = await sourceSnapshot(paths, id);
      assertExpectedRevision(immediatelyBefore.snapshot?.revision || null, before.snapshot?.revision || null, {
        filePath,
        message: "资料来源在保存期间被其他程序修改",
      });
      await atomicWriteFile(filePath, serialized, { fsApi, pathApi, createId });
      const committed = await sourceSnapshot(paths, id);
      return { source: parseSourceSnapshot(committed.snapshot, id), libraryId };
    });
  };

  const copyWebSelection = async (libraryId, input = {}) => {
    const rawFolderIds = Array.isArray(input.folderIds) ? input.folderIds : [];
    const rawSourceIds = Array.isArray(input.sourceIds) ? input.sourceIds : [];
    if (rawFolderIds.some((id) => !normalizeUuid(id)) || rawSourceIds.some((id) => !normalizeSourceId(id))) throw new Error("公区复制选择包含无效标识");
    const folderIds = [...new Set(rawFolderIds.map(normalizeUuid))];
    const sourceIds = [...new Set(rawSourceIds.map(normalizeSourceId))];
    if (folderIds.length > WEB_FOLDER_LIMIT || sourceIds.length > sourceLimit) throw new Error("公区复制选择超过安全上限");
    if (!folderIds.length && !sourceIds.length) throw new Error("请至少选择一个公区文件夹或网址");
    const targetScopeKey = normalizeWebScopeKey(input.targetScopeKey);
    if (!targetScopeKey.startsWith("workspace:")) throw new Error("公区内容只能复制到工作区私区");
    const expectedTreeRevision = input.expectedTreeRevision || null;
    const paths = await contextFor(libraryId);

    return writeQueue.run(paths.webTreePath, async () => {
      const beforeSnapshot = await webTreeSnapshot(paths);
      assertExpectedRevision(beforeSnapshot?.revision || null, expectedTreeRevision, {
        filePath: paths.webTreePath,
        message: "网页树已在同步目录中被修改，请重新载入后再复制",
      });
      const parsed = parseWebTreeSnapshot(beforeSnapshot);
      if (parsed.readOnly) throw new Error("网页树索引已损坏；修复前不能从公区复制");
      const tree = structuredClone(parsed.tree);
      const folderMap = new Map(tree.folders.map((folder) => [folder.id, folder]));
      for (const folderId of folderIds) {
        const folder = folderMap.get(folderId);
        if (!folder || folder.scopeKey !== "global") throw new Error("选择的公区文件夹不存在");
      }

      const selectedFolderIds = new Set(folderIds);
      let expandedFolders = true;
      while (expandedFolders) {
        expandedFolders = false;
        for (const folder of tree.folders) {
          if (folder.scopeKey === "global" && folder.parentId && selectedFolderIds.has(folder.parentId) && !selectedFolderIds.has(folder.id)) {
            selectedFolderIds.add(folder.id);
            expandedFolders = true;
          }
        }
      }

      const selectedSourceIds = new Set(sourceIds);
      for (const [sourceId, placement] of Object.entries(tree.placements)) {
        if (placement.scopeKey === "global" && placement.folderId && selectedFolderIds.has(placement.folderId)) selectedSourceIds.add(sourceId);
      }

      const selectedSources = new Map();
      const warnings = [];
      for (const sourceId of selectedSourceIds) {
        try {
          const stored = await sourceSnapshot(paths, sourceId);
          const source = parseSourceSnapshot(stored.snapshot, sourceId);
          const placement = tree.placements[sourceId] || { scopeKey: "global", folderId: "" };
          if (!source || source.type !== "web" || placement.scopeKey !== "global") throw new Error("选择项不是公区网页");
          selectedSources.set(sourceId, source);
        } catch (error) {
          if (sourceIds.includes(sourceId)) throw error;
          warnings.push({ sourceId, message: error?.message || "文件夹内的网页无法读取，已跳过" });
        }
      }

      const requiredFolderIds = new Set(selectedFolderIds);
      const addAncestors = (folderId) => {
        let currentId = folderId;
        const visiting = new Set();
        while (currentId) {
          if (visiting.has(currentId)) throw new Error("公区文件夹层级存在循环");
          visiting.add(currentId);
          const folder = folderMap.get(currentId);
          if (!folder || folder.scopeKey !== "global") throw new Error("公区文件夹祖先不存在");
          requiredFolderIds.add(folder.id);
          currentId = folder.parentId;
        }
      };
      selectedFolderIds.forEach(addAncestors);
      selectedSources.forEach((_source, sourceId) => addAncestors(tree.placements[sourceId]?.folderId || ""));

      const folderDepth = (folder) => {
        let depth = 0;
        let current = folder;
        while (current?.parentId) {
          depth += 1;
          current = folderMap.get(current.parentId);
        }
        return depth;
      };
      const requiredFolders = tree.folders
        .filter((folder) => requiredFolderIds.has(folder.id))
        .sort((left, right) => folderDepth(left) - folderDepth(right) || left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id));
      const mappedFolderIds = new Map();
      const createdFolderIds = new Set();
      const folderNameKey = (name) => String(name || "").trim().toLocaleLowerCase("en-US");
      const findTargetFolder = (parentId, name) => tree.folders
        .filter((folder) => folder.scopeKey === targetScopeKey && folder.parentId === parentId && folderNameKey(folder.name) === folderNameKey(name))
        .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.id.localeCompare(right.id))[0] || null;
      const createFreshUuid = () => {
        for (let attempt = 0; attempt < 32; attempt += 1) {
          const id = normalizeUuid(createId());
          if (id && !folderMap.has(id) && !createdFolderIds.has(id)) return id;
        }
        throw new Error("无法生成网页文件夹标识");
      };
      for (const sourceFolder of requiredFolders) {
        const targetParentId = sourceFolder.parentId ? mappedFolderIds.get(sourceFolder.parentId) : "";
        if (sourceFolder.parentId && !targetParentId) throw new Error("无法重建公区文件夹祖先路径");
        let targetFolder = findTargetFolder(targetParentId, sourceFolder.name);
        if (!targetFolder) {
          if (tree.folders.length >= WEB_FOLDER_LIMIT) throw new Error("网页文件夹数量已达上限");
          const timestamp = now().toISOString();
          targetFolder = {
            id: createFreshUuid(),
            name: sourceFolder.name,
            parentId: targetParentId,
            scopeKey: targetScopeKey,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          tree.folders.push(targetFolder);
          folderMap.set(targetFolder.id, targetFolder);
          createdFolderIds.add(targetFolder.id);
        }
        mappedFolderIds.set(sourceFolder.id, targetFolder.id);
      }

      const targetUrls = new Map();
      for (const [sourceId, placement] of Object.entries(tree.placements)) {
        if (placement.scopeKey !== targetScopeKey) continue;
        try {
          const stored = await sourceSnapshot(paths, sourceId);
          const source = parseSourceSnapshot(stored.snapshot, sourceId);
          if (source?.type === "web") targetUrls.set(`${placement.folderId}\n${source.url}`, sourceId);
        } catch {
          // Broken target entries do not prevent copying healthy public sources.
        }
      }

      const sourceCount = await countSourceFiles(paths);
      const copies = [];
      let skippedDuplicateCount = 0;
      const usedSourceIds = new Set(Object.keys(tree.placements));
      const createFreshSourceId = async () => {
        for (let attempt = 0; attempt < 32; attempt += 1) {
          const id = normalizeSourceId(createId());
          if (!id || usedSourceIds.has(id)) continue;
          const existing = await sourceSnapshot(paths, id);
          if (!existing.snapshot) {
            usedSourceIds.add(id);
            return id;
          }
        }
        throw new Error("无法生成网页来源标识");
      };
      for (const [sourceId, source] of selectedSources) {
        const sourceFolderId = tree.placements[sourceId]?.folderId || "";
        const targetFolderId = sourceFolderId ? mappedFolderIds.get(sourceFolderId) : "";
        if (sourceFolderId && !targetFolderId) throw new Error("无法确定网页副本的目标文件夹");
        const duplicateKey = `${targetFolderId}\n${source.url}`;
        if (targetUrls.has(duplicateKey)) {
          skippedDuplicateCount += 1;
          continue;
        }
        const id = await createFreshSourceId();
        const copy = normalizeSource({
          id,
          type: "web",
          title: source.title,
          url: source.url,
          excerpt: source.excerpt,
          notes: source.notes,
          bibliographic: source.bibliographic,
        }, { createId, now });
        copies.push({ source: copy, folderId: targetFolderId });
        targetUrls.set(duplicateKey, id);
      }
      if (sourceCount + copies.length > sourceLimit) throw new Error("资料来源数量已达上限");

      if (!createdFolderIds.size && !copies.length) {
        return {
          ok: true,
          libraryId,
          tree: parsed.tree,
          folders: parsed.tree.folders,
          placements: parsed.tree.placements,
          diskRevision: parsed.diskRevision,
          createdSources: [],
          createdFolderCount: 0,
          copiedSourceCount: 0,
          skippedDuplicateCount,
          warnings,
        };
      }

      for (const { source, folderId } of copies) tree.placements[source.id] = { scopeKey: targetScopeKey, folderId };
      const normalizedTree = normalizeWebTree(tree);
      const serializedTree = `${JSON.stringify(normalizedTree, null, 2)}\n`;
      if (Buffer.byteLength(serializedTree, "utf8") > WEB_TREE_JSON_MAX_BYTES) throw new Error("网页树索引超过 1MB 安全上限");

      const writtenSourcePaths = [];
      let treeCommitted = false;
      try {
        for (const { source } of copies) {
          const filePath = sourceMetadataPath(paths, source.id, pathApi);
          const serialized = `${JSON.stringify(source, null, 2)}\n`;
          if (Buffer.byteLength(serialized, "utf8") > SOURCE_JSON_MAX_BYTES) throw new Error("网页来源元数据超过 256KB 上限");
          await atomicWriteFile(filePath, serialized, { fsApi, pathApi, createId });
          writtenSourcePaths.push(filePath);
        }
        const immediatelyBefore = await webTreeSnapshot(paths);
        assertExpectedRevision(immediatelyBefore?.revision || null, beforeSnapshot?.revision || null, {
          filePath: paths.webTreePath,
          message: "网页树在复制期间被其他程序修改",
        });
        await atomicWriteFile(paths.webTreePath, serializedTree, { fsApi, pathApi, createId });
        treeCommitted = true;
      } catch (error) {
        if (!treeCommitted) await Promise.all(writtenSourcePaths.map((filePath) => fsApi.rm(filePath, { force: true }).catch(() => {})));
        throw error;
      }

      const committedTree = parseWebTreeSnapshot(await webTreeSnapshot(paths));
      const createdSources = [];
      for (const { source } of copies) {
        const committed = await sourceSnapshot(paths, source.id);
        createdSources.push(parseSourceSnapshot(committed.snapshot, source.id));
      }
      return {
        ok: true,
        libraryId,
        tree: committedTree.tree,
        folders: committedTree.tree.folders,
        placements: committedTree.tree.placements,
        diskRevision: committedTree.diskRevision,
        createdSources,
        createdFolderCount: createdFolderIds.size,
        copiedSourceCount: createdSources.length,
        skippedDuplicateCount,
        warnings,
      };
    });
  };

  const deleteSource = async (libraryId, sourceId, expectedRevision = null) => {
    const paths = await contextFor(libraryId);
    const id = normalizeSourceId(sourceId);
    if (!id) throw new Error("资料来源标识无效");
    const filePath = sourceMetadataPath(paths, id, pathApi);
    const deleted = await writeQueue.run(filePath, async () => {
      const before = await sourceSnapshot(paths, id);
      if (!before.snapshot) throw new Error("资料来源不存在");
      assertExpectedRevision(before.snapshot.revision, expectedRevision || null, {
        filePath,
        message: "资料来源已在同步目录中被修改，请重新载入后再删除",
      });
      const immediatelyBefore = await sourceSnapshot(paths, id);
      assertExpectedRevision(immediatelyBefore.snapshot?.revision || null, before.snapshot.revision, {
        filePath,
        message: "资料来源在删除期间被其他程序修改",
      });
      await fsApi.rm(filePath, { force: false });
      return { ok: true, libraryId, sourceId: id };
    });
    try {
      const treeState = await listWebTree(libraryId);
      if (treeState.placements[id] && !treeState.readOnly) {
        await mutateWebTree(libraryId, treeState.diskRevision, (tree) => {
          delete tree.placements[id];
          return tree;
        });
      }
    } catch {
      // A stale placement is harmless and will stay invisible without its source.
    }
    return deleted;
  };

  const sourcePathMatches = (candidate, from) => candidate === from || candidate.startsWith(`${from}/`);

  const rebaseSourcePaths = async (libraryId, fromRelativePath, toRelativePath) => {
    const listed = await listSources(libraryId);
    const warnings = [];
    for (const source of listed.sources) {
      if (source.type !== "file" || !sourcePathMatches(source.relativePath, fromRelativePath)) continue;
      const suffix = source.relativePath.slice(fromRelativePath.length).replace(/^\//, "");
      const nextPath = suffix ? `${toRelativePath}/${suffix}` : toRelativePath;
      try {
        await upsertSource(libraryId, { ...source, relativePath: nextPath }, source.diskRevision);
      } catch (error) {
        warnings.push({ sourceId: source.id, message: error?.message || "资料身份路径未能同步更新" });
      }
    }
    return warnings;
  };

  const renameEntry = async (libraryId, relativePath, nextName) => {
    const paths = await contextFor(libraryId);
    const entry = await assertSafeExistingPath(paths, normalizeRelativePath(relativePath, { allowEmpty: false }));
    const name = normalizeEntryName(nextName);
    const parentRelativePath = path.posix.dirname(entry.relativePath) === "." ? "" : path.posix.dirname(entry.relativePath);
    const nextRelativePath = parentRelativePath ? `${parentRelativePath}/${name}` : name;
    const target = resolveCandidate(paths, nextRelativePath);
    const sameKey = pathKey(entry.path, pathApi, platform) === pathKey(target.candidate, pathApi, platform);
    if (entry.path === target.candidate) return { ok: true, libraryId, oldRelativePath: entry.relativePath, relativePath: nextRelativePath, warnings: [] };
    if (!sameKey && await lstatOrNull(target.candidate, fsApi)) throw new Error("同名资料项目已经存在");
    if (sameKey) {
      const temporaryPath = pathApi.join(pathApi.dirname(entry.path), `.${pathApi.basename(entry.path)}.${createId()}.renaming`);
      await fsApi.rename(entry.path, temporaryPath);
      try {
        await fsApi.rename(temporaryPath, target.candidate);
      } catch (error) {
        await fsApi.rename(temporaryPath, entry.path).catch(() => {});
        throw error;
      }
    } else {
      await fsApi.rename(entry.path, target.candidate);
    }
    const warnings = await rebaseSourcePaths(libraryId, entry.relativePath, nextRelativePath);
    return { ok: true, libraryId, oldRelativePath: entry.relativePath, relativePath: nextRelativePath, warnings };
  };

  const moveEntry = async (libraryId, relativePath, targetFolderRelativePath = "") => {
    const paths = await contextFor(libraryId);
    const source = await assertSafeExistingPath(paths, normalizeRelativePath(relativePath, { allowEmpty: false }));
    const targetFolder = await assertSafeExistingPath(paths, targetFolderRelativePath, "directory");
    if (source.stat.isDirectory() && isPathInside(source.path, targetFolder.path, pathApi, platform)) {
      throw new Error("不能把资料文件夹移动到自身内部");
    }
    const nextRelativePath = targetFolder.relativePath
      ? `${targetFolder.relativePath}/${pathApi.basename(source.path)}`
      : pathApi.basename(source.path);
    if (nextRelativePath === source.relativePath) throw new Error("资料项目已经位于目标文件夹");
    const target = resolveCandidate(paths, nextRelativePath);
    if (await lstatOrNull(target.candidate, fsApi)) throw new Error("目标文件夹中已经存在同名项目");
    await fsApi.rename(source.path, target.candidate);
    const warnings = await rebaseSourcePaths(libraryId, source.relativePath, nextRelativePath);
    return { ok: true, libraryId, oldRelativePath: source.relativePath, relativePath: nextRelativePath, warnings };
  };

  const trashEntry = async (libraryId, relativePath, trashItem) => {
    if (typeof trashItem !== "function") throw new Error("当前系统不支持安全移入回收站");
    const paths = await contextFor(libraryId);
    const entry = await assertSafeExistingPath(paths, normalizeRelativePath(relativePath, { allowEmpty: false }));
    await trashItem(entry.path);
    return { ok: true, libraryId, relativePath: entry.relativePath };
  };

  const showEntry = async (libraryId, relativePath, showItemInFolder) => {
    if (typeof showItemInFolder !== "function") throw new Error("当前系统不支持在资源管理器中显示");
    const paths = await contextFor(libraryId);
    const entry = await assertSafeExistingPath(paths, relativePath);
    showItemInFolder(entry.path);
    return { ok: true, libraryId, relativePath: entry.relativePath };
  };

  const copyEntryPath = async (libraryId, relativePath) => {
    const paths = await contextFor(libraryId);
    const entry = await assertSafeExistingPath(paths, relativePath);
    return { ok: true, libraryId, relativePath: entry.relativePath, path: entry.path };
  };

  const readPdf = async (libraryId, relativePath) => {
    const paths = await contextFor(libraryId);
    const entry = await assertSafeExistingPath(paths, relativePath, "file");
    if (pathApi.extname(entry.path).toLocaleLowerCase("en-US") !== ".pdf") throw new Error("只有 PDF 可以在资料阅读位中打开");
    if (entry.stat.size > pdfReadMaxBytes) throw new Error("PDF 超过 128MB 内嵌读取上限，请使用系统应用打开");
    const snapshot = await readFileSnapshot(entry.path, { fsApi, maxBytes: pdfReadMaxBytes });
    if (!snapshot) throw new Error("PDF 已不存在");
    return {
      libraryId,
      relativePath: entry.relativePath,
      name: pathApi.basename(entry.path),
      bytes: snapshot.buffer,
      size: snapshot.buffer.length,
      diskRevision: snapshot.revision,
    };
  };

  const readPreview = async (libraryId, relativePath) => {
    const paths = await contextFor(libraryId);
    const entry = await assertSafeExistingPath(paths, relativePath, "file");
    const classification = classifyEntry(entry.relativePath);
    if (!["markdown", "text", "table", "image"].includes(classification.previewKind)) {
      throw new Error("该文件类型不支持静态资料预览");
    }
    const maximumBytes = classification.previewKind === "image"
      ? IMAGE_PREVIEW_MAX_BYTES
      : TEXT_PREVIEW_MAX_BYTES;
    if (entry.stat.size > maximumBytes) {
      throw new Error(classification.previewKind === "image"
        ? "图片超过 64MB 内嵌预览上限"
        : "文本资料超过 8MB 内嵌预览上限");
    }
    const snapshot = await readFileSnapshot(entry.path, { fsApi, maxBytes: maximumBytes });
    if (!snapshot) throw new Error("资料文件已不存在");
    return {
      libraryId,
      relativePath: entry.relativePath,
      name: pathApi.basename(entry.path),
      path: entry.path,
      previewKind: classification.previewKind,
      mime: previewMimeFromExtension(classification.extension),
      bytes: snapshot.buffer,
      size: snapshot.buffer.length,
      diskRevision: snapshot.revision,
    };
  };

  const openEntryExternal = async (libraryId, relativePath, openPath) => {
    if (typeof openPath !== "function") throw new Error("当前系统不支持外部打开");
    const paths = await contextFor(libraryId);
    const entry = await assertSafeExistingPath(paths, relativePath, "file");
    if (!externalOpenAllowed(entry.relativePath)) throw new Error("该文件类型不能从笺间直接启动，请在资源管理器中处理");
    const error = await openPath(entry.path);
    return { ok: !error, error: error || "", libraryId, relativePath: entry.relativePath };
  };

  const watchLibrary = async (libraryId, { onChange, onError, watchFactory } = {}) => {
    const paths = await contextFor(libraryId);
    watcher?.close?.();
    const factory = watchFactory || nativeFsApi.watch?.bind(nativeFsApi);
    if (typeof factory !== "function") throw new Error("当前系统不支持资料目录监听");
    const activeLibraryId = paths.manifest.libraryId;
    watcher = factory(paths.root, { recursive: true }, (eventType, fileName) => {
      const raw = fileName == null ? "" : String(fileName).replace(/\\/g, "/");
      let relativePath = "";
      try {
        if (raw) {
          const normalized = path.posix.normalize(raw).replace(/^\.\//, "");
          if (normalized === META_DIRECTORY || normalized.startsWith(`${META_DIRECTORY}/`)) {
            if (normalized !== `${META_DIRECTORY}/${LIBRARY_DIRECTORY}`
              && !normalized.startsWith(`${META_DIRECTORY}/${LIBRARY_DIRECTORY}/`)) return;
            relativePath = "";
          } else {
            relativePath = normalizeRelativePath(normalized);
          }
        }
      } catch {
        return;
      }
      onChange?.({ libraryId: activeLibraryId, eventType: String(eventType || "change"), relativePath, changedAt: Date.now() });
    });
    watcher.on?.("error", (error) => onError?.({ libraryId: activeLibraryId, message: error?.message || "资料目录监听失败" }));
    return { ok: true, libraryId: activeLibraryId };
  };

  const closeWatcher = () => {
    watcher?.close?.();
    watcher = null;
  };

  return {
    clearRoot,
    closeWatcher,
    copyEntryPath,
    copyWebSelection,
    createWebFolder,
    createFolder,
    deleteWebFolder,
    deleteSource,
    getRoot,
    importFiles,
    initialize,
    listFolder,
    listSources,
    listWebTree,
    moveEntry,
    moveWebSource,
    openEntryExternal,
    readPdf,
    readPreview,
    renameEntry,
    selectRoot,
    showEntry,
    trashEntry,
    updateWebFolder,
    upsertSource,
    watchLibrary,
  };
}

async function ensureLegacyImportFolder(manager, libraryId) {
  for (let sequence = 0; sequence < 100; sequence += 1) {
    const name = sequence ? `旧资料导入 (${sequence + 1})` : "旧资料导入";
    const listed = await manager.listFolder(libraryId, "");
    const existing = listed.entries.find((entry) => entry.name === name);
    if (existing?.kind === "folder") return existing.relativePath;
    if (existing) continue;
    try {
      return (await manager.createFolder(libraryId, "", name)).relativePath;
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
    }
  }
  throw new Error("无法创建唯一的旧资料导入目录");
}

function legacyImportIdentity(workspaceId, sourceId) {
  return `${String(workspaceId || "")}\u0000${String(sourceId || "")}`;
}

async function importLegacyResearch({
  manager,
  libraryId,
  workspaceId,
  sources = [],
  warnings: legacyWarnings = [],
  resolveFile,
  sourceLimit = SOURCE_LIMIT,
} = {}) {
  if (!manager || typeof manager.listSources !== "function") throw new Error("缺少独立资料库管理器");
  const stableWorkspaceId = boundedText(workspaceId, 128);
  if (!stableWorkspaceId) throw new Error("旧资料库缺少稳定的工作区标识");
  const legacySources = Array.isArray(sources) ? sources : [];
  if (legacySources.length > sourceLimit) throw new Error("旧资料数量超过安全导入上限");
  const targetSources = await manager.listSources(libraryId);
  const importedIdentities = new Set(targetSources.sources.flatMap((source) => (
    source.importedFrom?.workspaceId && source.importedFrom?.sourceId
      ? [legacyImportIdentity(source.importedFrom.workspaceId, source.importedFrom.sourceId)]
      : []
  )));
  const occupiedIds = new Set(targetSources.sources.map((source) => String(source.id || "").toLocaleLowerCase("en-US")));
  let importFolderRelativePath = "";
  const imported = [];
  const skipped = [];
  const warnings = (Array.isArray(legacyWarnings) ? legacyWarnings : []).slice(0, sourceLimit).map((warning) => ({
    sourceId: "",
    message: boundedText(warning?.message, 1000) || "旧资料元数据无法读取",
  }));

  for (const source of legacySources) {
    const legacySourceId = boundedText(source?.id, 128);
    const identity = legacyImportIdentity(stableWorkspaceId, legacySourceId);
    if (importedIdentities.has(identity)) {
      skipped.push({ sourceId: legacySourceId, reason: "already-imported" });
      continue;
    }
    if (source?.type === "note") {
      skipped.push({ sourceId: legacySourceId, reason: "notes-removed" });
      continue;
    }
    try {
      let relativePath = "";
      let importedFile = null;
      if (source?.type === "file") {
        if (typeof resolveFile !== "function") throw new Error("缺少旧资料文件解析器");
        const resolved = await resolveFile(source);
        if (!resolved?.filePath) throw new Error("旧资料文件路径无法解析");
        if (!importFolderRelativePath) importFolderRelativePath = await ensureLegacyImportFolder(manager, libraryId);
        const copied = await manager.importFiles(libraryId, importFolderRelativePath, [resolved.filePath]);
        importedFile = copied.imported?.[0] || null;
        if (!importedFile?.relativePath) throw new Error("旧资料文件复制失败");
        relativePath = importedFile.relativePath;
      }

      const preservedId = normalizeSourceId(legacySourceId);
      const sourceInput = {
        ...(preservedId && !occupiedIds.has(preservedId.toLocaleLowerCase("en-US")) ? { id: preservedId } : {}),
        type: source?.type,
        title: source?.title,
        url: source?.type === "web" ? source?.url : "",
        notes: source?.notes,
        excerpt: source?.excerpt || "",
        relativePath,
        mime: source?.mime,
        size: importedFile?.size || source?.size,
        bibliographic: source?.bibliographic,
        importedFrom: { workspaceId: stableWorkspaceId, sourceId: legacySourceId },
      };
      let saved;
      try {
        saved = await manager.upsertSource(libraryId, sourceInput, null);
      } catch (error) {
        if (error?.code !== REVISION_CONFLICT_CODE || !sourceInput.id) throw error;
        delete sourceInput.id;
        saved = await manager.upsertSource(libraryId, sourceInput, null);
      }
      occupiedIds.add(saved.source.id.toLocaleLowerCase("en-US"));
      importedIdentities.add(identity);
      imported.push(saved.source);
    } catch (error) {
      warnings.push({ sourceId: legacySourceId, message: boundedText(error?.message, 1000) || "旧资料导入失败" });
    }
  }

  return {
    ok: true,
    libraryId,
    workspaceId: stableWorkspaceId,
    importFolderRelativePath,
    imported,
    skipped,
    warnings,
  };
}

module.exports = {
  CONFIG_FILE,
  DIRECTORY_ENTRY_LIMIT,
  DOCUMENT_PREVIEW_EXTENSIONS,
  IMAGE_PREVIEW_EXTENSIONS,
  IMAGE_PREVIEW_MAX_BYTES,
  IMPORT_FILE_MAX_BYTES,
  LIBRARY_DIRECTORY,
  MARKDOWN_PREVIEW_EXTENSIONS,
  META_DIRECTORY,
  PDF_READ_MAX_BYTES,
  SAFE_EXTERNAL_EXTENSIONS,
  SOURCE_JSON_MAX_BYTES,
  SOURCE_LIMIT,
  WEB_FOLDER_LIMIT,
  WEB_FOLDER_MAX_DEPTH,
  WEB_TREE_FILE,
  TABLE_PREVIEW_EXTENSIONS,
  TEXT_PREVIEW_EXTENSIONS,
  TEXT_PREVIEW_MAX_BYTES,
  classifyEntry,
  createResearchLibraryManager,
  ensureLibrary,
  externalOpenAllowed,
  importLegacyResearch,
  isPathInside,
  libraryPaths,
  normalizeEntryName,
  normalizeRelativePath,
  normalizeSource,
  normalizeSourceId,
  normalizeUuid,
  normalizeWebScopeKey,
  normalizeWebTree,
  previewKindFromExtension,
  previewMimeFromExtension,
};
