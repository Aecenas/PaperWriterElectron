const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const { atomicWriteFile } = require("./document-storage.cjs");
const { sanitizeFilesystemName } = require("./filesystem-access.cjs");

const WORKSPACE_META_DIR = ".jianjian";
const WORKSPACE_MANIFEST = "workspace.json";
const SOURCES_DIR = "sources";
const RESEARCH_DIR = "research";
const SOURCE_LIMIT = 5000;
const SOURCE_JSON_MAX_BYTES = 256 * 1024;
const RESEARCH_FILE_MAX_BYTES = 512 * 1024 * 1024;
const SOURCE_TYPES = new Set(["file", "web"]);
const SOURCE_STORAGE = new Set(["linked", "managed", "none"]);
const CITATION_TYPES = new Set(["book", "article", "web", "pdf", "report", "thesis", "other"]);
const SOURCE_KINDS = Object.freeze({ RESEARCH: "research", CITATION: "citation" });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function boundedText(value, maximum = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeSourceId(value = "") {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,128}$/.test(id) ? id : "";
}

function normalizeCitationId(value = "") {
  const id = String(value || "").trim().toLowerCase();
  return UUID_PATTERN.test(id) ? id : "";
}

function normalizeCitationResearchIdentity(source = {}) {
  const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  if (Object.prototype.hasOwnProperty.call(input, "researchLibraryId")) {
    const researchLibraryId = normalizeCitationId(input.researchLibraryId);
    const researchSourceId = normalizeCitationId(input.researchSourceId);
    return researchLibraryId && researchSourceId ? { researchLibraryId, researchSourceId } : {};
  }
  const researchSourceId = normalizeSourceId(input.researchSourceId);
  return researchSourceId ? { researchSourceId } : {};
}

function normalizeTimestamp(value = "", fallback = "") {
  const timestamp = boundedText(value, 64);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : fallback;
}

function normalizedRoot(rootPath, pathApi = path) {
  const root = pathApi.resolve(String(rootPath || ""));
  if (!rootPath || !pathApi.isAbsolute(root)) throw new Error("缺少工作区路径");
  return root;
}

function isPathInside(rootPath, candidatePath, pathApi = path, platform = process.platform) {
  const root = normalizedRoot(rootPath, pathApi);
  const candidate = pathApi.resolve(String(candidatePath || ""));
  const normalize = (value) => platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
  const relative = pathApi.relative(normalize(root), normalize(candidate));
  return relative === "" || (!relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative));
}

async function isResolvedPathInside(rootPath, candidatePath, { fsApi = fs, pathApi = path } = {}) {
  const [realRoot, realCandidate] = await Promise.all([
    fsApi.realpath(rootPath),
    fsApi.realpath(candidatePath),
  ]);
  return isPathInside(realRoot, realCandidate, pathApi);
}

function workspacePaths(rootPath, pathApi = path) {
  const root = normalizedRoot(rootPath, pathApi);
  const metadataRoot = pathApi.join(root, WORKSPACE_META_DIR);
  return {
    root,
    metadataRoot,
    manifestPath: pathApi.join(metadataRoot, WORKSPACE_MANIFEST),
    sourcesRoot: pathApi.join(metadataRoot, SOURCES_DIR),
    researchRoot: pathApi.join(metadataRoot, RESEARCH_DIR),
  };
}

function normalizeWebUrl(value = "") {
  const source = boundedText(value, 4096);
  if (!source) return "";
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error("网页来源地址格式不正确");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("网页来源仅支持安全的 http 或 https 地址");
  }
  return parsed.toString();
}

function normalizeBibliographic(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const authors = Array.isArray(source.authors)
    ? source.authors.slice(0, 32).map((author) => boundedText(author, 160)).filter(Boolean)
    : [];
  return {
    authors,
    year: boundedText(source.year, 16),
    publisher: boundedText(source.publisher, 240),
    publication: boundedText(source.publication, 240),
    identifier: boundedText(source.identifier, 160),
  };
}

function normalizeResearchSource(source = {}) {
  const id = normalizeSourceId(source.id) || randomUUID();
  if (!SOURCE_TYPES.has(source.type)) throw new Error("研究资料仅支持文件或网页");
  const type = source.type;
  const storage = SOURCE_STORAGE.has(source.storage)
    ? source.storage
    : (type === "file" ? "linked" : "none");
  const now = new Date().toISOString();
  const createdAt = boundedText(source.createdAt, 64) || now;
  return {
    version: 1,
    kind: SOURCE_KINDS.RESEARCH,
    id,
    type,
    title: boundedText(source.title, 240) || (type === "web" ? "未命名网页" : "未命名资料"),
    url: type === "web" && source.url ? normalizeWebUrl(source.url) : "",
    notes: boundedText(source.notes, 200000),
    storage: type === "file" ? storage : "none",
    relativePath: type === "file" ? boundedText(source.relativePath, 32768).replace(/\\/g, "/") : "",
    managedFileName: type === "file" && storage === "managed" ? boundedText(source.managedFileName, 255) : "",
    mime: type === "file" ? boundedText(source.mime, 160) : "",
    size: type === "file" && Number.isFinite(Number(source.size)) ? Math.max(0, Number(source.size)) : 0,
    bibliographic: normalizeBibliographic(source.bibliographic),
    createdAt,
    updatedAt: boundedText(source.updatedAt, 64) || createdAt,
  };
}

function normalizeCitationSource(source = {}, { createId = randomUUID, now = new Date().toISOString() } = {}) {
  const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const authors = (Array.isArray(input.authors)
    ? input.authors
    : (typeof input.authors === "string" ? input.authors.split(/[;,；，]/) : []))
    .slice(0, 100)
    .map((author) => boundedText(author, 200))
    .filter(Boolean);
  const rawUrl = boundedText(input.url, 2048);
  const url = rawUrl ? normalizeWebUrl(rawUrl) : "";
  const createdAt = normalizeTimestamp(input.createdAt, now);
  return {
    version: 1,
    kind: SOURCE_KINDS.CITATION,
    id: normalizeCitationId(input.id) || normalizeCitationId(createId()),
    type: CITATION_TYPES.has(input.type) ? input.type : "other",
    title: boundedText(input.title, 1000),
    authors,
    year: boundedText(String(input.year ?? ""), 32),
    containerTitle: boundedText(input.containerTitle, 1000),
    publisher: boundedText(input.publisher, 500),
    url,
    doi: boundedText(input.doi, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
    isbn: boundedText(input.isbn, 64),
    accessedAt: normalizeTimestamp(input.accessedAt, ""),
    pages: boundedText(input.pages, 128),
    notes: boundedText(input.notes, 10000),
    ...normalizeCitationResearchIdentity(input),
    createdAt,
    updatedAt: normalizeTimestamp(input.updatedAt, createdAt),
  };
}

async function ensureWorkspace(rootPath, {
  fsApi = fs,
  pathApi = path,
  createId = randomUUID,
} = {}) {
  const paths = workspacePaths(rootPath, pathApi);
  await fsApi.mkdir(paths.sourcesRoot, { recursive: true });
  await fsApi.mkdir(paths.researchRoot, { recursive: true });
  for (const directory of [paths.metadataRoot, paths.sourcesRoot, paths.researchRoot]) {
    const stat = await fsApi.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("工作区资料目录无效");
    if (!(await isResolvedPathInside(paths.root, directory, { fsApi, pathApi }))) {
      throw new Error("工作区资料目录越过工作区边界");
    }
  }
  let manifest;
  try {
    const stat = await fsApi.lstat(paths.manifestPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > SOURCE_JSON_MAX_BYTES) {
      throw new Error("工作区清单无效或过大");
    }
    if (!(await isResolvedPathInside(paths.metadataRoot, paths.manifestPath, { fsApi, pathApi }))) {
      throw new Error("工作区清单路径越过工作区边界");
    }
    const raw = await fsApi.readFile(paths.manifestPath, "utf8");
    manifest = JSON.parse(raw);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const normalized = {
    version: 1,
    workspaceId: normalizeSourceId(manifest?.workspaceId) || createId(),
    createdAt: boundedText(manifest?.createdAt, 64) || new Date().toISOString(),
  };
  if (!manifest || manifest.version !== normalized.version || manifest.workspaceId !== normalized.workspaceId) {
    await atomicWriteFile(paths.manifestPath, `${JSON.stringify(normalized, null, 2)}\n`, { fsApi, pathApi, createId });
  }
  return { ...paths, manifest: normalized };
}

function sourceMetadataPath(rootPath, sourceId, pathApi = path) {
  const id = normalizeSourceId(sourceId);
  if (!id) throw new Error("资料标识无效");
  return pathApi.join(workspacePaths(rootPath, pathApi).sourcesRoot, `${id}.json`);
}

async function readSource(rootPath, sourceId, { fsApi = fs, pathApi = path } = {}) {
  const source = await readStoredSource(rootPath, sourceId, { fsApi, pathApi });
  if (source.kind !== SOURCE_KINDS.RESEARCH) throw new Error("该标识属于参考文献来源，不是研究资料");
  return source;
}

async function readStoredSource(rootPath, sourceId, { fsApi = fs, pathApi = path } = {}) {
  const paths = await ensureWorkspace(rootPath, { fsApi, pathApi });
  const id = normalizeSourceId(sourceId);
  if (!id) throw new Error("资料标识无效");
  const filePath = sourceMetadataPath(paths.root, id, pathApi);
  const stat = await fsApi.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > SOURCE_JSON_MAX_BYTES) {
    throw new Error("资料元数据无效或过大");
  }
  if (!(await isResolvedPathInside(paths.sourcesRoot, filePath, { fsApi, pathApi }))) {
    throw new Error("资料元数据路径越过工作区边界");
  }
  const parsed = JSON.parse(await fsApi.readFile(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("资料元数据格式无效");
  if (parsed.kind === SOURCE_KINDS.CITATION) {
    if (!normalizeCitationId(id)) throw new Error("参考文献来源标识必须是 UUID");
    return normalizeCitationSource({ ...parsed, id });
  }
  if (parsed.kind && parsed.kind !== SOURCE_KINDS.RESEARCH) throw new Error("资料元数据类型未知");
  // v0.9.5 之前的研究资料没有 kind；读取时按 research 兼容。
  return normalizeResearchSource({ ...parsed, id });
}

async function readCitationSource(rootPath, sourceId, options = {}) {
  const id = normalizeCitationId(sourceId);
  if (!id) throw new Error("参考文献来源标识必须是 UUID");
  const source = await readStoredSource(rootPath, id, options);
  if (source.kind !== SOURCE_KINDS.CITATION) throw new Error("该标识属于研究资料，不是参考文献来源");
  return source;
}

async function listStoredSources(rootPath, { fsApi = fs, pathApi = path, sourceLimit = SOURCE_LIMIT } = {}) {
  const paths = await ensureWorkspace(rootPath, { fsApi, pathApi });
  const entries = await fsApi.readdir(paths.sourcesRoot, { withFileTypes: true });
  const metadataEntries = entries.filter((entry) => entry.isFile() && /^[a-zA-Z0-9_-]{8,128}\.json$/.test(entry.name));
  if (metadataEntries.length > sourceLimit) throw new Error("工作区资料与参考文献来源数量过多");
  const sources = [];
  const warnings = [];
  for (const entry of metadataEntries) {
    try {
      sources.push(await readStoredSource(paths.root, entry.name.slice(0, -5), { fsApi, pathApi }));
    } catch (error) {
      warnings.push({ file: entry.name, message: error?.message || "资料元数据无法读取" });
    }
  }
  sources.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return { sources, warnings, workspaceId: paths.manifest.workspaceId };
}

async function listSources(rootPath, options = {}) {
  const listed = await listStoredSources(rootPath, options);
  return { ...listed, sources: listed.sources.filter((source) => source.kind === SOURCE_KINDS.RESEARCH) };
}

async function listCitationSources(rootPath, options = {}) {
  const listed = await listStoredSources(rootPath, options);
  return { ...listed, sources: listed.sources.filter((source) => source.kind === SOURCE_KINDS.CITATION) };
}

async function writableMetadataPath(paths, sourceId, {
  fsApi = fs,
  pathApi = path,
  sourceLimit = SOURCE_LIMIT,
} = {}) {
  const filePath = sourceMetadataPath(paths.root, sourceId, pathApi);
  try {
    const stat = await fsApi.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("资料元数据目标无效");
    if (!(await isResolvedPathInside(paths.sourcesRoot, filePath, { fsApi, pathApi }))) {
      throw new Error("资料元数据路径越过工作区边界");
    }
    return filePath;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const entries = await fsApi.readdir(paths.sourcesRoot, { withFileTypes: true });
  const count = entries.filter((entry) => entry.isFile() && /^[a-zA-Z0-9_-]{8,128}\.json$/.test(entry.name)).length;
  if (count >= sourceLimit) throw new Error("工作区资料与参考文献来源数量已达上限");
  return filePath;
}

async function writeSource(rootPath, source, {
  fsApi = fs,
  pathApi = path,
  createId = randomUUID,
  sourceLimit = SOURCE_LIMIT,
} = {}) {
  const paths = await ensureWorkspace(rootPath, { fsApi, pathApi, createId });
  const normalized = normalizeResearchSource(source);
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > SOURCE_JSON_MAX_BYTES) throw new Error("资料元数据过大");
  const filePath = await writableMetadataPath(paths, normalized.id, { fsApi, pathApi, sourceLimit });
  await atomicWriteFile(filePath, serialized, { fsApi, pathApi, createId });
  return normalized;
}

async function writeCitationSource(rootPath, source, {
  fsApi = fs,
  pathApi = path,
  createId = randomUUID,
  sourceLimit = SOURCE_LIMIT,
} = {}) {
  const paths = await ensureWorkspace(rootPath, { fsApi, pathApi, createId });
  const rawResearchSourceId = boundedText(source?.researchSourceId, 128);
  const usesIndependentLibrary = Object.prototype.hasOwnProperty.call(
    source && typeof source === "object" ? source : {},
    "researchLibraryId",
  );
  if (!usesIndependentLibrary && rawResearchSourceId && !normalizeSourceId(rawResearchSourceId)) {
    throw new Error("关联的研究资料标识无效");
  }
  const normalized = normalizeCitationSource(source, { createId });
  if (!normalized.id) throw new Error("无法生成有效的参考文献来源 UUID");
  if (!normalized.title && !normalized.url && !normalized.doi) {
    throw new Error("参考文献来源至少需要标题、网址或 DOI");
  }
  if (normalized.researchSourceId && !normalized.researchLibraryId) {
    await readSource(paths.root, normalized.researchSourceId, { fsApi, pathApi });
  }
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > SOURCE_JSON_MAX_BYTES) throw new Error("参考文献来源元数据过大");
  const filePath = await writableMetadataPath(paths, normalized.id, { fsApi, pathApi, sourceLimit });
  await atomicWriteFile(filePath, serialized, { fsApi, pathApi, createId });
  return normalized;
}

async function upsertCitationSource(rootPath, input = {}, {
  fsApi = fs,
  pathApi = path,
  createId = randomUUID,
  sourceLimit = SOURCE_LIMIT,
} = {}) {
  const paths = await ensureWorkspace(rootPath, { fsApi, pathApi, createId });
  const requestedId = normalizeCitationId(input?.id);
  let previous = null;
  if (requestedId) {
    try {
      previous = await readStoredSource(paths.root, requestedId, { fsApi, pathApi });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (previous?.kind === SOURCE_KINDS.RESEARCH) {
      throw new Error("该标识已被研究资料占用");
    }
  }
  const now = new Date().toISOString();
  const next = {
    ...(previous || {}),
    ...(input && typeof input === "object" ? input : {}),
    id: requestedId || createId(),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  return writeCitationSource(paths.root, next, { fsApi, pathApi, createId, sourceLimit });
}

async function createSource(rootPath, input = {}, {
  fsApi = fs,
  pathApi = path,
  createId = randomUUID,
} = {}) {
  const paths = await ensureWorkspace(rootPath, { fsApi, pathApi, createId });
  const source = normalizeResearchSource({ ...input, id: createId(), createdAt: new Date().toISOString() });
  if (source.type === "file") {
    const inputPath = pathApi.resolve(String(input.filePath || ""));
    const stat = await fsApi.stat(inputPath);
    if (!stat.isFile()) throw new Error("请选择有效的资料文件");
    if (stat.size > RESEARCH_FILE_MAX_BYTES) throw new Error("资料文件超过 512MB 上限");
    if (!boundedText(input.title, 240)) {
      source.title = boundedText(pathApi.basename(inputPath), 240) || "未命名资料";
    }
    source.size = stat.size;
    source.managedFileName = "";
    if (source.storage === "managed") {
      const safeName = sanitizeFilesystemName(pathApi.basename(inputPath), "资料文件", 160);
      const targetDirectory = pathApi.join(paths.researchRoot, source.id);
      await fsApi.mkdir(targetDirectory, { recursive: true });
      const targetPath = pathApi.join(targetDirectory, safeName);
      await fsApi.copyFile(inputPath, targetPath);
      source.managedFileName = safeName;
      source.relativePath = pathApi.relative(paths.root, targetPath).replace(/\\/g, "/");
    } else {
      if (!isPathInside(paths.root, inputPath, pathApi)
        || !(await isResolvedPathInside(paths.root, inputPath, { fsApi, pathApi }))) {
        throw new Error("链接资料必须位于当前工作区内；可改用“复制进资料库”");
      }
      source.relativePath = pathApi.relative(paths.root, inputPath).replace(/\\/g, "/");
    }
  }
  source.updatedAt = new Date().toISOString();
  return writeSource(paths.root, source, { fsApi, pathApi, createId });
}

async function updateSource(rootPath, sourceId, patch = {}, options = {}) {
  const previous = await readSource(rootPath, sourceId, options);
  const next = normalizeResearchSource({
    ...previous,
    title: patch.title ?? previous.title,
    notes: patch.notes ?? previous.notes,
    url: previous.type === "web" ? (patch.url ?? previous.url) : previous.url,
    bibliographic: patch.bibliographic ?? previous.bibliographic,
    updatedAt: new Date().toISOString(),
  });
  return writeSource(rootPath, next, options);
}

async function relinkSource(rootPath, sourceId, filePath, {
  fsApi = fs,
  pathApi = path,
  createId = randomUUID,
} = {}) {
  const paths = await ensureWorkspace(rootPath, { fsApi, pathApi, createId });
  const previous = await readSource(paths.root, sourceId, { fsApi, pathApi });
  if (previous.type !== "file") throw new Error("只有本地文件资料可以重新定位");
  const inputPath = pathApi.resolve(String(filePath || ""));
  const stat = await fsApi.stat(inputPath);
  if (!stat.isFile()) throw new Error("请选择有效的资料文件");
  if (stat.size > RESEARCH_FILE_MAX_BYTES) throw new Error("资料文件超过 512MB 上限");
  const next = { ...previous, size: stat.size, updatedAt: new Date().toISOString() };
  if (previous.storage === "managed") {
    const safeName = sanitizeFilesystemName(pathApi.basename(inputPath), "资料文件", 160);
    const targetDirectory = pathApi.join(paths.researchRoot, previous.id);
    await fsApi.mkdir(targetDirectory, { recursive: true });
    const targetPath = pathApi.join(targetDirectory, safeName);
    await fsApi.copyFile(inputPath, targetPath);
    next.managedFileName = safeName;
    next.relativePath = pathApi.relative(paths.root, targetPath).replace(/\\/g, "/");
  } else {
    if (!isPathInside(paths.root, inputPath, pathApi)
      || !(await isResolvedPathInside(paths.root, inputPath, { fsApi, pathApi }))) {
      throw new Error("链接资料必须位于当前工作区内");
    }
    next.relativePath = pathApi.relative(paths.root, inputPath).replace(/\\/g, "/");
  }
  return writeSource(paths.root, next, { fsApi, pathApi, createId });
}

async function resolveSourceFile(rootPath, sourceOrId, { fsApi = fs, pathApi = path } = {}) {
  const paths = workspacePaths(rootPath, pathApi);
  const source = typeof sourceOrId === "string" ? await readSource(paths.root, sourceOrId, { fsApi, pathApi }) : normalizeResearchSource(sourceOrId);
  if (source.type !== "file" || !source.relativePath) throw new Error("这条资料没有可读取的本地文件");
  const resolved = pathApi.resolve(paths.root, source.relativePath);
  if (!isPathInside(paths.root, resolved, pathApi)) throw new Error("资料路径已越过工作区边界");
  if (source.storage === "managed" && !isPathInside(paths.researchRoot, resolved, pathApi)) {
    throw new Error("托管资料路径无效");
  }
  let stat;
  try {
    stat = await fsApi.stat(resolved);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      throw new Error("资料文件不存在，请重新定位");
    }
    throw error;
  }
  if (!stat.isFile() || stat.size > RESEARCH_FILE_MAX_BYTES) throw new Error("资料文件不存在或过大");
  if (!(await isResolvedPathInside(paths.root, resolved, { fsApi, pathApi }))) {
    throw new Error("资料路径已越过工作区边界");
  }
  if (source.storage === "managed"
    && !(await isResolvedPathInside(paths.researchRoot, resolved, { fsApi, pathApi }))) {
    throw new Error("托管资料路径无效");
  }
  return { source, filePath: resolved, size: stat.size, mtimeMs: stat.mtimeMs };
}

async function deleteSource(rootPath, sourceId, {
  fsApi = fs,
  pathApi = path,
  removeManagedFile = true,
} = {}) {
  const source = await readSource(rootPath, sourceId, { fsApi, pathApi });
  const paths = workspacePaths(rootPath, pathApi);
  await fsApi.rm(sourceMetadataPath(paths.root, source.id, pathApi), { force: true });
  if (removeManagedFile && source.storage === "managed") {
    const directory = pathApi.resolve(paths.researchRoot, source.id);
    if (!isPathInside(paths.researchRoot, directory, pathApi)) throw new Error("托管资料目录无效");
    await fsApi.rm(directory, { recursive: true, force: true });
  }
  return { ok: true, id: source.id };
}

async function deleteCitationSource(rootPath, sourceId, {
  fsApi = fs,
  pathApi = path,
} = {}) {
  const source = await readCitationSource(rootPath, sourceId, { fsApi, pathApi });
  const paths = workspacePaths(rootPath, pathApi);
  await fsApi.rm(sourceMetadataPath(paths.root, source.id, pathApi), { force: true });
  return { ok: true, id: source.id };
}

module.exports = {
  CITATION_TYPES,
  RESEARCH_FILE_MAX_BYTES,
  SOURCE_LIMIT,
  SOURCE_KINDS,
  WORKSPACE_META_DIR,
  createSource,
  deleteCitationSource,
  deleteSource,
  ensureWorkspace,
  isPathInside,
  listCitationSources,
  listSources,
  normalizeCitationId,
  normalizeCitationResearchIdentity,
  normalizeCitationSource,
  normalizeResearchSource,
  normalizeSourceId,
  readCitationSource,
  readSource,
  relinkSource,
  resolveSourceFile,
  sourceMetadataPath,
  upsertCitationSource,
  updateSource,
  workspacePaths,
  writeCitationSource,
  writeSource,
};
