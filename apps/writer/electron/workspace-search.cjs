const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const JSZip = require("jszip");
const {
  DEFAULT_ARCHIVE_LIMITS,
  assertZipEntryReadable,
  atomicWriteFile,
  createZipEntryLimitTransform,
  normalizedPathKey,
  preflightZipBuffer,
  validatePaperArchive,
} = require("./document-storage.cjs");

const SEARCH_CACHE_VERSION = 1;
const SUPPORTED_DOCUMENT_EXTENSIONS = new Set([".letterpaper", ".paperdoc"]);
const DEFAULT_SEARCH_LIMITS = Object.freeze({
  maxDocuments: 20000,
  maxDirectoryEntries: 20000,
  maxWalkEntries: 100000,
  maxIndexedCharactersPerDocument: 2_000_000,
  maxTotalIndexedCharacters: 24_000_000,
  maxCacheBytes: 64 * 1024 * 1024,
  maxQueryCharacters: 256,
  maxResults: 200,
  maxSnippetCharacters: 180,
  searchYieldEvery: 100,
});

function resolveSearchLimits(limits) {
  const resolved = { ...DEFAULT_SEARCH_LIMITS, ...(limits || {}) };
  for (const [name, fallback] of Object.entries(DEFAULT_SEARCH_LIMITS)) {
    if (!Number.isSafeInteger(resolved[name]) || resolved[name] <= 0) resolved[name] = fallback;
  }
  return resolved;
}

function isSupportedDocumentPath(filePath, pathApi = path) {
  return SUPPORTED_DOCUMENT_EXTENSIONS.has(pathApi.extname(String(filePath || "")).toLowerCase());
}

function isPathInside(rootPath, targetPath, { pathApi = path, platform = process.platform } = {}) {
  let root = pathApi.resolve(String(rootPath || ""));
  let target = pathApi.resolve(String(targetPath || ""));
  if (platform === "win32") {
    root = root.toLocaleLowerCase("en-US");
    target = target.toLocaleLowerCase("en-US");
  }
  const relative = pathApi.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative));
}

function isWorkspaceRelationshipCandidate(record, {
  currentDocumentId = "",
  currentPath = "",
  pathApi = path,
  platform = process.platform,
} = {}) {
  if (!record || typeof record.path !== "string" || !record.path) return false;
  const activeId = String(currentDocumentId || "").trim().toLocaleLowerCase("en-US");
  const recordId = String(record.documentId || "").trim().toLocaleLowerCase("en-US");
  if (activeId && recordId === activeId) return false;
  if (currentPath && normalizedPathKey(record.path, pathApi, platform) === normalizedPathKey(currentPath, pathApi, platform)) return false;
  return true;
}

function decodeHtmlEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return String(value || "").replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (full, token) => {
    const lowered = token.toLowerCase();
    if (lowered[0] !== "#") return named[lowered] ?? full;
    const hexadecimal = lowered[1] === "x";
    const codePoint = Number.parseInt(lowered.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return "�";
    return String.fromCodePoint(codePoint);
  });
}

function htmlToSearchText(html) {
  const withoutInvisibleContent = String(html || "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(?:br|hr)\b[^>]*>|<\/(?:p|div|h[1-6]|li|blockquote|pre|tr|table)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "");
  return decodeHtmlEntities(withoutInvisibleContent)
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();
}

function truncateIndexedText(value, maximumCharacters) {
  const text = String(value || "");
  return text.length <= maximumCharacters ? { text, truncated: false } : { text: text.slice(0, maximumCharacters), truncated: true };
}

function createSearchRecord(filePath, document, stat, {
  rootPath,
  limits = DEFAULT_SEARCH_LIMITS,
  pathApi = path,
  platform = process.platform,
} = {}) {
  const resolvedLimits = resolveSearchLimits(limits);
  const resolvedPath = pathApi.resolve(String(filePath || ""));
  if (!isSupportedDocumentPath(resolvedPath, pathApi)) throw new Error("只能索引信笺文档");
  if (rootPath && !isPathInside(rootPath, resolvedPath, { pathApi, platform })) throw new Error("文档不在当前工作区内");
  const source = document && typeof document === "object" ? document : {};
  const body = truncateIndexedText(htmlToSearchText(source.html), resolvedLimits.maxIndexedCharactersPerDocument);
  const title = truncateIndexedText(typeof source.title === "string" ? source.title.trim() : "", 1000).text;
  const author = truncateIndexedText(typeof source.author === "string" ? source.author.trim() : "", 500).text;
  const relativePath = rootPath ? pathApi.relative(pathApi.resolve(rootPath), resolvedPath) : pathApi.basename(resolvedPath);
  return {
    path: resolvedPath,
    pathKey: normalizedPathKey(resolvedPath, pathApi, platform),
    relativePath,
    fileName: pathApi.basename(resolvedPath),
    displayName: pathApi.basename(resolvedPath, pathApi.extname(resolvedPath)),
    title,
    author,
    body: body.text,
    truncated: body.truncated,
    size: Number(stat?.size) || 0,
    mtimeMs: Number(stat?.mtimeMs) || 0,
    updatedAt: Number.isFinite(Number(stat?.mtimeMs)) ? new Date(Number(stat.mtimeMs)).toISOString() : "",
  };
}

async function readSearchDocument(filePath, {
  fsApi = fs,
  archiveLimits = DEFAULT_ARCHIVE_LIMITS,
} = {}) {
  if (!String(filePath || "")) throw new Error("缺少信笺文档路径");
  const resolvedArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...(archiveLimits || {}) };
  const buffer = await fsApi.readFile(filePath);
  preflightZipBuffer(buffer, { limits: resolvedArchiveLimits });
  const zip = await JSZip.loadAsync(buffer);
  validatePaperArchive(zip, { archiveBytes: buffer.length, limits: resolvedArchiveLimits });
  const entry = zip.file("document.json");
  assertZipEntryReadable(entry, {
    maxBytes: resolvedArchiveLimits.maxDocumentJsonBytes,
    maxRatio: resolvedArchiveLimits.maxDocumentJsonRatio,
  });
  const chunks = [];
  let totalBytes = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(bytes);
      totalBytes += bytes.length;
      callback();
    },
  });
  await pipeline(entry.nodeStream("nodebuffer"), createZipEntryLimitTransform(entry, {
    maxBytes: resolvedArchiveLimits.maxDocumentJsonBytes,
    maxRatio: resolvedArchiveLimits.maxDocumentJsonRatio,
  }), sink);
  const parsed = JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("信笺正文数据无效");
  return parsed;
}

async function walkWorkspaceDocuments(rootPath, {
  fsApi = fs,
  limits = DEFAULT_SEARCH_LIMITS,
  signal,
  pathApi = path,
  platform = process.platform,
} = {}) {
  if (!String(rootPath || "")) throw new Error("缺少工作区路径");
  const resolvedLimits = resolveSearchLimits(limits);
  const canonicalRoot = await fsApi.realpath(pathApi.resolve(String(rootPath || "")));
  const rootStat = await fsApi.stat(canonicalRoot);
  if (!rootStat.isDirectory()) throw new Error("搜索根路径不是文件夹");
  const directories = [canonicalRoot];
  const documents = [];
  let visitedEntries = 0;

  while (directories.length) {
    if (signal?.aborted) return { rootPath: canonicalRoot, documents, canceled: true };
    const directory = directories.pop();
    const entries = await fsApi.readdir(directory, { withFileTypes: true });
    if (entries.length > resolvedLimits.maxDirectoryEntries) throw new Error("工作区中的单个文件夹包含过多项目");
    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > resolvedLimits.maxWalkEntries) throw new Error("工作区包含过多项目，请缩小搜索范围");
      if (entry.isSymbolicLink()) continue;
      const entryPath = pathApi.join(directory, entry.name);
      if (!isPathInside(canonicalRoot, entryPath, { pathApi, platform })) continue;
      if (entry.isDirectory()) {
        directories.push(entryPath);
      } else if (entry.isFile() && isSupportedDocumentPath(entryPath, pathApi)) {
        documents.push(entryPath);
        if (documents.length > resolvedLimits.maxDocuments) throw new Error("工作区包含过多信笺，请缩小搜索范围");
      }
    }
  }
  return { rootPath: canonicalRoot, documents, canceled: false };
}

function normalizeLiteral(value) {
  return String(value || "").toLocaleLowerCase("en-US");
}

function createSnippet(text, query, maximumCharacters) {
  const source = String(text || "");
  const index = normalizeLiteral(source).indexOf(normalizeLiteral(query));
  if (index < 0) return { text: source.slice(0, maximumCharacters), matchStart: -1, matchLength: 0 };
  const room = Math.max(query.length, maximumCharacters);
  const context = Math.max(0, Math.floor((room - query.length) / 2));
  let start = Math.max(0, index - context);
  let end = Math.min(source.length, start + room);
  if (end - start < room) start = Math.max(0, end - room);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
  return {
    text: `${prefix}${source.slice(start, end)}${suffix}`,
    matchStart: prefix.length + index - start,
    matchLength: query.length,
  };
}

function matchRecord(record, query, limits) {
  const normalizedQuery = normalizeLiteral(query);
  const fields = [
    ["fileName", record.fileName, 400],
    ["title", record.title, 300],
    ["author", record.author, 200],
    ["body", record.body, 100],
  ];
  for (const [field, value, baseScore] of fields) {
    const index = normalizeLiteral(value).indexOf(normalizedQuery);
    if (index < 0) continue;
    const snippet = createSnippet(value, query, limits.maxSnippetCharacters);
    return {
      path: record.path,
      relativePath: record.relativePath,
      fileName: record.fileName,
      displayName: record.displayName,
      title: record.title,
      author: record.author,
      updatedAt: record.updatedAt,
      size: record.size,
      matchField: field,
      matchStart: index,
      matchLength: query.length,
      snippet: snippet.text,
      snippetMatchStart: snippet.matchStart,
      snippetMatchLength: snippet.matchLength,
      indexedTextTruncated: Boolean(record.truncated),
      score: baseScore - Math.min(index, 99),
    };
  }
  return null;
}

async function searchWorkspaceRecords(records, query, {
  requestId = randomUUID(),
  limit,
  limits = DEFAULT_SEARCH_LIMITS,
  isCanceled = () => false,
  signal,
} = {}) {
  const resolvedLimits = resolveSearchLimits(limits);
  const literalQuery = String(query || "").trim().slice(0, resolvedLimits.maxQueryCharacters);
  const maximumResults = Math.max(1, Math.min(Number(limit) || resolvedLimits.maxResults, resolvedLimits.maxResults));
  if (!literalQuery) return { requestId, query: "", canceled: false, results: [], totalMatches: 0, limited: false };
  const results = [];
  let totalMatches = 0;
  for (let index = 0; index < records.length; index += 1) {
    if (signal?.aborted || isCanceled(requestId)) {
      return { requestId, query: literalQuery, canceled: true, results: [], totalMatches: 0, limited: false };
    }
    if (index > 0 && index % resolvedLimits.searchYieldEvery === 0) await new Promise((resolve) => setImmediate(resolve));
    const match = matchRecord(records[index], literalQuery, resolvedLimits);
    if (!match) continue;
    totalMatches += 1;
    results.push(match);
  }
  results.sort((left, right) => right.score - left.score
    || Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)
    || left.relativePath.localeCompare(right.relativePath, "zh-CN"));
  return {
    requestId,
    query: literalQuery,
    canceled: false,
    results: results.slice(0, maximumResults),
    totalMatches,
    limited: totalMatches > maximumResults,
  };
}

function validCachedRecord(value, rootPath, options) {
  if (!value || typeof value !== "object" || typeof value.path !== "string") return null;
  if (!isSupportedDocumentPath(value.path, options.pathApi)) return null;
  if (!isPathInside(rootPath, value.path, options)) return null;
  if (!Number.isSafeInteger(value.size) || value.size < 0 || !Number.isFinite(value.mtimeMs)) return null;
  const fields = ["relativePath", "fileName", "displayName", "title", "author", "body"];
  if (fields.some((field) => typeof value[field] !== "string")) return null;
  if (value.body.length > options.limits.maxIndexedCharactersPerDocument) return null;
  return { ...value, pathKey: normalizedPathKey(value.path, options.pathApi, options.platform) };
}

function createWorkspaceSearchIndex({
  rootPath,
  cachePath = "",
  fsApi = fs,
  pathApi = path,
  platform = process.platform,
  limits,
  archiveLimits = DEFAULT_ARCHIVE_LIMITS,
  readDocument = readSearchDocument,
} = {}) {
  if (!String(rootPath || "")) throw new Error("缺少工作区路径");
  const resolvedLimits = resolveSearchLimits(limits);
  let canonicalRoot = "";
  let records = new Map();
  let activeRequestId = "";
  const canceledRequests = new Set();
  let cacheError = "";
  let lastRefresh = null;

  const options = { pathApi, platform, limits: resolvedLimits };
  const rootKey = () => normalizedPathKey(canonicalRoot, pathApi, platform);

  async function loadCache() {
    if (!cachePath) return false;
    try {
      const cacheStat = await fsApi.stat(cachePath);
      if (!cacheStat.isFile() || cacheStat.size > resolvedLimits.maxCacheBytes) return false;
      const parsed = JSON.parse(await fsApi.readFile(cachePath, "utf8"));
      if (parsed?.version !== SEARCH_CACHE_VERSION || parsed.rootKey !== rootKey() || !Array.isArray(parsed.records)) return false;
      const loaded = new Map();
      let indexedCharacters = 0;
      for (const candidate of parsed.records) {
        const record = validCachedRecord(candidate, canonicalRoot, options);
        if (!record) continue;
        indexedCharacters += record.body.length;
        if (indexedCharacters > resolvedLimits.maxTotalIndexedCharacters) return false;
        loaded.set(record.pathKey, record);
      }
      records = loaded;
      return true;
    } catch (error) {
      if (error?.code !== "ENOENT") cacheError = String(error?.message || error);
      return false;
    }
  }

  async function persistCache() {
    if (!cachePath) return false;
    const payload = `${JSON.stringify({
      version: SEARCH_CACHE_VERSION,
      rootKey: rootKey(),
      generatedAt: new Date().toISOString(),
      records: [...records.values()],
    })}\n`;
    if (Buffer.byteLength(payload, "utf8") > resolvedLimits.maxCacheBytes) {
      cacheError = "搜索索引超过缓存大小上限";
      return false;
    }
    try {
      await atomicWriteFile(cachePath, payload, { fsApi, pathApi });
      cacheError = "";
      return true;
    } catch (error) {
      cacheError = String(error?.message || error);
      return false;
    }
  }

  async function refresh({ signal } = {}) {
    if (!canonicalRoot) canonicalRoot = await fsApi.realpath(pathApi.resolve(String(rootPath || "")));
    const walked = await walkWorkspaceDocuments(canonicalRoot, { fsApi, limits: resolvedLimits, signal, pathApi, platform });
    if (walked.canceled) return { canceled: true, indexed: records.size, errors: [] };
    const next = new Map();
    const errors = [];
    let reused = 0;
    let indexed = 0;
    let indexedCharacters = 0;
    for (const filePath of walked.documents) {
      if (signal?.aborted) return { canceled: true, indexed: records.size, errors };
      try {
        const linkStat = await fsApi.lstat(filePath);
        if (!linkStat.isFile() || linkStat.isSymbolicLink()) continue;
        const realFilePath = await fsApi.realpath(filePath);
        if (!isPathInside(canonicalRoot, realFilePath, { pathApi, platform })) continue;
        const stat = await fsApi.stat(realFilePath);
        const key = normalizedPathKey(realFilePath, pathApi, platform);
        const cached = records.get(key);
        let record;
        if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
          record = cached;
          reused += 1;
        } else {
          const document = await readDocument(realFilePath, { fsApi, archiveLimits });
          record = createSearchRecord(realFilePath, document, stat, {
            rootPath: canonicalRoot,
            limits: resolvedLimits,
            pathApi,
            platform,
          });
          indexed += 1;
        }
        if (indexedCharacters + record.body.length > resolvedLimits.maxTotalIndexedCharacters) {
          errors.push({ path: realFilePath, code: "INDEX_CHARACTER_BUDGET", message: "工作区搜索索引已达到文字总量上限" });
          continue;
        }
        indexedCharacters += record.body.length;
        next.set(key, record);
      } catch (error) {
        errors.push({ path: filePath, code: String(error?.code || "READ_FAILED"), message: String(error?.message || error) });
      }
    }
    records = next;
    await persistCache();
    lastRefresh = new Date().toISOString();
    return { canceled: false, total: records.size, indexed, reused, errors };
  }

  async function initialize({ signal } = {}) {
    canonicalRoot = await fsApi.realpath(pathApi.resolve(String(rootPath || "")));
    await loadCache();
    return refresh({ signal });
  }

  function overlayRecords(overrides) {
    const merged = new Map(records);
    for (const override of Array.isArray(overrides) ? overrides : []) {
      try {
        if (!override?.path || !override.document) continue;
        const resolvedPath = pathApi.resolve(String(override.path));
        if (!isPathInside(canonicalRoot, resolvedPath, { pathApi, platform }) || !isSupportedDocumentPath(resolvedPath, pathApi)) continue;
        const key = normalizedPathKey(resolvedPath, pathApi, platform);
        const existing = records.get(key);
        merged.set(key, createSearchRecord(resolvedPath, override.document, {
          size: existing?.size || 0,
          mtimeMs: Number(override.mtimeMs) || existing?.mtimeMs || Date.now(),
        }, { rootPath: canonicalRoot, limits: resolvedLimits, pathApi, platform }));
      } catch {
        // Invalid renderer overlays cannot expand the authorized search scope.
      }
    }
    return [...merged.values()];
  }

  async function search(query, { requestId = randomUUID(), limit, overrides, signal } = {}) {
    const resolvedRequestId = String(requestId || randomUUID()).slice(0, 128);
    activeRequestId = resolvedRequestId;
    canceledRequests.delete(resolvedRequestId);
    const response = await searchWorkspaceRecords(overlayRecords(overrides), query, {
      requestId: resolvedRequestId,
      limit,
      limits: resolvedLimits,
      signal,
      isCanceled: (id) => canceledRequests.has(id) || activeRequestId !== id,
    });
    canceledRequests.delete(resolvedRequestId);
    if (activeRequestId === resolvedRequestId) activeRequestId = "";
    return response;
  }

  function cancel(requestId = activeRequestId) {
    const resolved = String(requestId || "");
    if (!resolved) return false;
    canceledRequests.add(resolved);
    if (activeRequestId === resolved) activeRequestId = "";
    return true;
  }

  function stats() {
    return {
      rootPath: canonicalRoot,
      records: records.size,
      activeRequestId,
      cachePath,
      cacheError,
      lastRefresh,
    };
  }

  return { cancel, initialize, persistCache, refresh, search, stats };
}

module.exports = {
  DEFAULT_SEARCH_LIMITS,
  SEARCH_CACHE_VERSION,
  createSearchRecord,
  createSnippet,
  createWorkspaceSearchIndex,
  decodeHtmlEntities,
  htmlToSearchText,
  isPathInside,
  isSupportedDocumentPath,
  isWorkspaceRelationshipCandidate,
  readSearchDocument,
  searchWorkspaceRecords,
  walkWorkspaceDocuments,
};
