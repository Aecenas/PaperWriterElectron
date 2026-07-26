const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const {
  searchRecords,
} = require("./search-record-core.cjs");

const RESEARCH_SEARCH_CACHE_VERSION = 1;
const RESEARCH_SEARCH_CACHE_FOLDER = "research-search";
const DEFAULT_RESEARCH_SEARCH_LIMITS = Object.freeze({
  maxDocuments: 20_000,
  maxWalkEntries: 100_000,
  maxWalkDepth: 64,
  maxIndexedCharactersPerDocument: 2_000_000,
  maxTotalIndexedCharacters: 64_000_000,
  maxCacheBytes: 64 * 1024 * 1024,
  maxQueryCharacters: 256,
  maxResults: 200,
  maxSnippetCharacters: 180,
  searchYieldEvery: 100,
  maxPdfPages: 2000,
  extractionConcurrency: 2,
});

const RESEARCH_SEARCH_FIELDS = Object.freeze([
  Object.freeze({ name: "fileName", weight: 520 }),
  Object.freeze({ name: "title", weight: 500 }),
  Object.freeze({ name: "relativePath", weight: 400 }),
  Object.freeze({ name: "url", weight: 400 }),
  Object.freeze({ name: "body", weight: 100 }),
]);

function resolveResearchSearchLimits(value = {}) {
  const resolved = { ...DEFAULT_RESEARCH_SEARCH_LIMITS, ...(value || {}) };
  for (const [name, fallback] of Object.entries(
    DEFAULT_RESEARCH_SEARCH_LIMITS,
  )) {
    if (!Number.isSafeInteger(resolved[name]) || resolved[name] <= 0) {
      resolved[name] = fallback;
    }
  }
  return resolved;
}

function normalizedRelativePathKey(
  value,
  {
    platform = process.platform,
  } = {},
) {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
  return platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function boundedErrorMessage(error) {
  return String(error?.message || error || "资料内容无法解析")
    .replace(/(?:\\\\\?\\|\\\\)[^\r\n]*/g, "[本机路径]")
    .replace(/[A-Za-z]:[\\/][^\r\n]*/g, "[本机路径]")
    .slice(0, 1000);
}

function sourceRevisionKey(source) {
  const revision = source?.diskRevision;
  return JSON.stringify([
    String(source?.updatedAt || ""),
    Number(revision?.size) || 0,
    Number(revision?.mtimeMs) || 0,
    String(revision?.sha256 || ""),
  ]);
}

function bibliographicSearchText(source) {
  const value = source?.bibliographic
    && typeof source.bibliographic === "object"
    ? source.bibliographic
    : {};
  return [
    ...(Array.isArray(value.authors) ? value.authors : []),
    value.year,
    value.containerTitle,
    value.publisher,
    value.doi,
    value.isbn,
    value.pages,
  ].map((item) => String(item || "").trim()).filter(Boolean).join(" ");
}

function authorsSearchText(source, extractedAuthor = "") {
  const authors = Array.isArray(source?.bibliographic?.authors)
    ? source.bibliographic.authors
    : [];
  return [
    extractedAuthor,
    ...authors,
  ].map((item) => String(item || "").trim()).filter(Boolean).join("；");
}

function resultPageForMatch(record, match) {
  if (match?.field !== "body" || !Array.isArray(record?.pages)) return null;
  return record.pages.find((page) => (
    Number(page?.start) <= match.start
    && Number(page?.end) >= match.start
  ))?.page || null;
}

function mapResearchSearchResult(record, match) {
  const page = resultPageForMatch(record, match);
  return {
    ...(record.result || {}),
    matchField: match.field,
    matchStart: match.start,
    matchLength: match.length,
    snippet: match.snippet,
    snippetMatchStart: match.snippetMatchStart,
    snippetMatchLength: match.snippetMatchLength,
    indexedTextTruncated: Boolean(record.truncated),
    ...(page ? { page } : {}),
    score: match.score,
  };
}

function validCachedRecord(value, libraryId, limits) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.kind !== "file" || value.libraryId !== libraryId) return null;
  if (
    typeof value.relativePath !== "string"
    || !value.relativePath
    || typeof value.fileName !== "string"
    || !Number.isSafeInteger(value.size)
    || value.size < 0
    || !Number.isFinite(value.mtimeMs)
    || typeof value.previewKind !== "string"
    || typeof value.sourceRevisionKey !== "string"
    || typeof value.searchFields !== "object"
    || Array.isArray(value.searchFields)
    || !value.result
    || typeof value.result !== "object"
    || Array.isArray(value.result)
  ) {
    return null;
  }
  const normalizedPath = value.relativePath.replace(/\\/g, "/");
  if (
    normalizedPath.startsWith("/")
    || /^[A-Za-z]:\//.test(normalizedPath)
    || normalizedPath.split("/").some((segment) => segment === "..")
    || normalizedPath.toLocaleLowerCase("en-US") === ".jianjian"
    || normalizedPath.toLocaleLowerCase("en-US").startsWith(".jianjian/")
  ) {
    return null;
  }
  const fields = Object.fromEntries(
    Object.entries(value.searchFields).map(([name, fieldValue]) => [
      name,
      String(fieldValue || ""),
    ]),
  );
  for (const field of RESEARCH_SEARCH_FIELDS) {
    if (typeof fields[field.name] !== "string") fields[field.name] = "";
  }
  if (
    fields.body.length > limits.maxIndexedCharactersPerDocument
    || Object.values(fields).some((field) => field.length > (
      limits.maxIndexedCharactersPerDocument + 500_000
    ))
  ) {
    return null;
  }
  const pages = Array.isArray(value.pages)
    ? value.pages.slice(0, limits.maxPdfPages).map((page) => ({
      page: Math.max(1, Math.trunc(Number(page?.page) || 1)),
      start: Math.max(0, Math.trunc(Number(page?.start) || 0)),
      end: Math.max(0, Math.trunc(Number(page?.end) || 0)),
    }))
    : [];
  return {
    ...value,
    searchFields: fields,
    pages,
    truncated: Boolean(value.truncated),
  };
}

async function walkResearchFiles(
  library,
  libraryId,
  {
    limits = DEFAULT_RESEARCH_SEARCH_LIMITS,
    onProgress,
    signal,
  } = {},
) {
  const resolvedLimits = resolveResearchSearchLimits(limits);
  const queue = [{ relativePath: "", depth: 0 }];
  const files = [];
  const errors = [];
  let walked = 0;
  let documentLimitReached = false;
  while (queue.length) {
    if (signal?.aborted) {
      const error = new Error("资料索引构建已取消");
      error.name = "AbortError";
      throw error;
    }
    const next = queue.shift();
    if (next.depth > resolvedLimits.maxWalkDepth) {
      errors.push({
        relativePath: next.relativePath,
        code: "MAX_DEPTH",
        message: "资料目录超过搜索索引深度上限",
      });
      continue;
    }
    let listed;
    try {
      listed = await library.listFolder(libraryId, next.relativePath);
    } catch (error) {
      errors.push({
        relativePath: next.relativePath,
        code: String(error?.code || "LIST_FAILED").slice(0, 128),
        message: boundedErrorMessage(error),
      });
      continue;
    }
    for (const entry of Array.isArray(listed?.entries) ? listed.entries : []) {
      if (signal?.aborted) {
        const error = new Error("资料索引构建已取消");
        error.name = "AbortError";
        throw error;
      }
      walked += 1;
      if (walked > resolvedLimits.maxWalkEntries) {
        throw new Error("资料目录项目超过全文搜索安全上限");
      }
      if (entry?.kind === "folder") {
        queue.push({
          relativePath: String(entry.relativePath || ""),
          depth: next.depth + 1,
        });
      } else if (entry?.kind === "file") {
        if (files.length >= resolvedLimits.maxDocuments) {
          errors.push({
            relativePath: String(entry.relativePath || ""),
            code: "MAX_DOCUMENTS",
            message: `资料搜索最多索引 ${resolvedLimits.maxDocuments} 个文件`,
          });
          documentLimitReached = true;
          queue.length = 0;
          break;
        }
        files.push(entry);
      }
    }
    onProgress?.({
      phase: "discovering",
      completed: walked,
      total: 0,
      indexed: 0,
      reused: 0,
      skipped: 0,
      failed: errors.length,
    });
    if (documentLimitReached) break;
    if (queue.length % 25 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return { files, errors, walked };
}

function createFileRecord({
  libraryId,
  entry,
  source,
  extracted,
}) {
  const relativePath = String(entry.relativePath || "").replace(/\\/g, "/");
  const fileName = String(entry.name || path.posix.basename(relativePath));
  const sourceTitle = String(source?.title || "");
  const extractedTitle = String(extracted?.title || "");
  const title = sourceTitle || extractedTitle || fileName;
  const author = authorsSearchText(source, extracted?.author);
  const body = String(extracted?.body || "");
  return {
    cacheKey: normalizedRelativePathKey(relativePath),
    kind: "file",
    libraryId,
    relativePath,
    fileName,
    previewKind: String(entry.previewKind || "unsupported"),
    size: Math.max(0, Math.trunc(Number(entry.size) || 0)),
    mtimeMs: Math.max(0, Number(entry.mtimeMs) || 0),
    sourceRevisionKey: sourceRevisionKey(source),
    pages: Array.isArray(extracted?.pages) ? extracted.pages : [],
    truncated: Boolean(extracted?.truncated),
    searchFields: {
      fileName,
      relativePath,
      title,
      authors: author,
      url: "",
      bibliographic: bibliographicSearchText(source),
      excerpt: String(source?.excerpt || ""),
      notes: String(source?.notes || ""),
      body,
    },
    result: {
      kind: "file",
      libraryId,
      relativePath,
      ...(source?.id ? { sourceId: source.id } : {}),
      previewKind: String(entry.previewKind || "unsupported"),
      fileName,
      title,
      author,
      size: Math.max(0, Math.trunc(Number(entry.size) || 0)),
      mtimeMs: Math.max(0, Number(entry.mtimeMs) || 0),
      updatedAt: String(
        source?.updatedAt
        || (entry.mtimeMs ? new Date(entry.mtimeMs).toISOString() : ""),
      ),
    },
  };
}

function markFileRecordIndexSkipped(
  record,
  {
    code = "EXTRACTION_SKIPPED",
    message = "资料正文未建立索引",
    truncated = false,
  } = {},
) {
  return {
    ...record,
    pages: [],
    truncated: Boolean(truncated || record?.truncated),
    indexedTextSkipped: true,
    indexWarning: String(message || "资料正文未建立索引").slice(0, 1000),
    searchFields: {
      ...(record?.searchFields || {}),
      body: "",
    },
    result: {
      ...(record?.result || {}),
      indexedTextSkipped: true,
      indexWarningCode: String(code || "EXTRACTION_SKIPPED").slice(0, 128),
      indexWarning: String(message || "资料正文未建立索引").slice(0, 1000),
    },
  };
}

function createWebRecords(libraryId, sources, tree) {
  const placements = tree?.placements
    && typeof tree.placements === "object"
    && !Array.isArray(tree.placements)
    ? tree.placements
    : {};
  return (Array.isArray(sources) ? sources : [])
    .filter((source) => source?.type === "web")
    .map((source) => {
      const placement = placements[source.id]
        && typeof placements[source.id] === "object"
        ? placements[source.id]
        : null;
      const scopeKey = String(placement?.scopeKey || "");
      if (
        !placement
        || (scopeKey !== "global" && !scopeKey.startsWith("workspace:"))
      ) {
        return null;
      }
      const title = String(source.title || source.url || "未命名网址");
      return {
        cacheKey: `web:${source.id}`,
        kind: "web",
        libraryId,
        sourceId: String(source.id || ""),
        scopeKey,
        folderId: String(placement.folderId || ""),
        previewKind: "web",
        truncated: false,
        pages: [],
        searchFields: {
          fileName: "",
          relativePath: "",
          title,
          authors: "",
          url: String(source.url || ""),
          bibliographic: "",
          excerpt: "",
          notes: "",
          body: "",
        },
        result: {
          kind: "web",
          libraryId,
          sourceId: String(source.id || ""),
          scopeKey,
          folderId: String(placement.folderId || ""),
          previewKind: "web",
          title,
          url: String(source.url || ""),
          updatedAt: String(source.updatedAt || ""),
        },
      };
    })
    .filter(Boolean);
}

async function mapWithConcurrency(
  values,
  concurrency,
  mapper,
) {
  const source = Array.isArray(values) ? values : [];
  const results = new Array(source.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), source.length || 1) },
    async () => {
      while (cursor < source.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(source[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function createResearchSearchIndex({
  libraryId,
  rootKey,
  cachePath,
  library,
  extractFile,
  fsApi = fs,
  pathApi = path,
  atomicWriteFile,
  platform = process.platform,
  limits,
} = {}) {
  if (!String(libraryId || "")) throw new Error("缺少资料库标识");
  if (!library) throw new Error("缺少资料库能力");
  if (typeof extractFile !== "function") throw new Error("缺少资料全文提取器");
  if (typeof atomicWriteFile !== "function") throw new Error("缺少搜索缓存原子写入能力");
  const resolvedLimits = resolveResearchSearchLimits(limits);
  const buildListeners = new Set();
  let records = [];
  let cachedFiles = new Map();
  let initialized = false;
  let dirty = true;
  let buildPromise = null;
  let lastRefresh = "";
  let cacheError = "";
  let lastBuildStats = null;
  let buildController = null;
  let invalidationGeneration = 0;
  const invalidatedPathKeys = new Set();
  let idleBuildAbortTimer = null;

  const cancelIdleBuildAbort = () => {
    if (!idleBuildAbortTimer) return;
    clearTimeout(idleBuildAbortTimer);
    idleBuildAbortTimer = null;
  };

  const scheduleIdleBuildAbort = () => {
    cancelIdleBuildAbort();
    if (!buildPromise || buildListeners.size) return;
    idleBuildAbortTimer = setTimeout(() => {
      idleBuildAbortTimer = null;
      if (!buildListeners.size && buildPromise) {
        buildController?.abort(new Error("资料索引当前没有等待者"));
      }
    }, 350);
  };

  const emitBuildProgress = (payload) => {
    for (const listener of [...buildListeners]) {
      try {
        listener(payload);
      } catch {
        // A detached renderer listener cannot break a shared index build.
      }
    }
  };

  const subscribeBuildProgress = (listener) => {
    if (typeof listener !== "function") return () => {};
    cancelIdleBuildAbort();
    buildListeners.add(listener);
    return () => {
      buildListeners.delete(listener);
      scheduleIdleBuildAbort();
    };
  };

  async function loadCache() {
    if (!cachePath) return false;
    try {
      const stat = await fsApi.stat(cachePath);
      if (!stat.isFile() || stat.size > resolvedLimits.maxCacheBytes) {
        return false;
      }
      const parsed = JSON.parse(await fsApi.readFile(cachePath, "utf8"));
      if (
        parsed?.version !== RESEARCH_SEARCH_CACHE_VERSION
        || parsed?.libraryId !== libraryId
        || parsed?.rootKey !== rootKey
        || !Array.isArray(parsed.files)
      ) {
        return false;
      }
      const next = new Map();
      let indexedCharacters = 0;
      for (const candidate of parsed.files) {
        const record = validCachedRecord(
          candidate,
          libraryId,
          resolvedLimits,
        );
        if (!record) continue;
        indexedCharacters += record.searchFields.body.length;
        if (
          indexedCharacters
          > resolvedLimits.maxTotalIndexedCharacters
        ) {
          return false;
        }
        next.set(
          normalizedRelativePathKey(record.relativePath, { platform }),
          record,
        );
      }
      cachedFiles = next;
      return true;
    } catch (error) {
      if (error?.code !== "ENOENT") cacheError = boundedErrorMessage(error);
      return false;
    }
  }

  async function persistCache(fileRecords) {
    if (!cachePath) return false;
    const serialized = `${JSON.stringify({
      version: RESEARCH_SEARCH_CACHE_VERSION,
      libraryId,
      rootKey,
      generatedAt: new Date().toISOString(),
      files: fileRecords,
    })}\n`;
    if (Buffer.byteLength(serialized, "utf8") > resolvedLimits.maxCacheBytes) {
      cacheError = "资料全文索引超过缓存大小上限";
      return false;
    }
    try {
      await atomicWriteFile(cachePath, serialized, {
        fsApi,
        pathApi,
      });
      cacheError = "";
      return true;
    } catch (error) {
      cacheError = boundedErrorMessage(error);
      return false;
    }
  }

  async function refresh({ signal, generation } = {}) {
    if (!initialized) await loadCache();
    const invalidatedPathsForBuild = new Set(invalidatedPathKeys);
    const [walked, listedSources, webTree] = await Promise.all([
      walkResearchFiles(library, libraryId, {
        limits: resolvedLimits,
        onProgress: emitBuildProgress,
        signal,
      }),
      library.listSources(libraryId),
      library.listWebTree(libraryId),
    ]);
    const sources = Array.isArray(listedSources?.sources)
      ? listedSources.sources
      : [];
    const fileSourceByPath = new Map(
      sources
        .filter((source) => source?.type === "file" && source.relativePath)
        .map((source) => [
          normalizedRelativePathKey(source.relativePath, { platform }),
          source,
        ]),
    );
    let indexedCharacters = 0;
    let completed = 0;
    let indexed = 0;
    let reused = 0;
    let skipped = 0;
    const errors = [...walked.errors];
    const extractedRecords = await mapWithConcurrency(
      walked.files,
      resolvedLimits.extractionConcurrency,
      async (entry) => {
        if (signal?.aborted) {
          const error = new Error("资料索引构建已取消");
          error.name = "AbortError";
          throw error;
        }
        const key = normalizedRelativePathKey(entry.relativePath, { platform });
        const source = fileSourceByPath.get(key) || null;
        const cached = cachedFiles.get(key);
        let record = null;
        let extractedNew = false;
        let reusedCached = false;
        const forcedInvalidation = [...invalidatedPathsForBuild].some(
          (invalidatedKey) => (
            key === invalidatedKey
            || key.startsWith(`${invalidatedKey}/`)
          ),
        );
        if (
          cached
          && !cached.indexedTextSkipped
          && !forcedInvalidation
          && cached.size === Math.max(0, Math.trunc(Number(entry.size) || 0))
          && cached.mtimeMs === Math.max(0, Number(entry.mtimeMs) || 0)
          && cached.previewKind === String(entry.previewKind || "unsupported")
          && cached.sourceRevisionKey === sourceRevisionKey(source)
        ) {
          record = cached;
          reusedCached = true;
        } else {
          try {
            const extracted = await extractFile(libraryId, entry, {
              maxCharacters: resolvedLimits.maxIndexedCharactersPerDocument,
              maxPdfPages: resolvedLimits.maxPdfPages,
              signal,
              onProgress: (progress) => {
                emitBuildProgress({
                  phase: "extracting",
                  completed,
                  total: walked.files.length,
                  indexed,
                  reused,
                  skipped,
                  failed: errors.length,
                  percent: walked.files.length
                    ? Math.floor((completed / walked.files.length) * 90)
                    : 90,
                  current: {
                    completed: Number(progress?.completed) || 0,
                    total: Number(progress?.total) || 0,
                  },
                });
              },
            });
            record = createFileRecord({
              libraryId,
              entry,
              source,
              extracted,
            });
            extractedNew = true;
          } catch (error) {
            if (signal?.aborted || error?.name === "AbortError") throw error;
            skipped += 1;
            const extractionError = {
              relativePath: String(entry.relativePath || ""),
              code: String(error?.code || "EXTRACTION_FAILED").slice(0, 128),
              message: boundedErrorMessage(error),
            };
            errors.push(extractionError);
            record = markFileRecordIndexSkipped(createFileRecord({
              libraryId,
              entry,
              source,
              extracted: {},
            }), {
              code: extractionError.code,
              message: extractionError.message,
            });
          }
        }
        if (record && !record.indexedTextSkipped) {
          const bodyCharacters = record.searchFields.body.length;
          if (
            indexedCharacters + bodyCharacters
            > resolvedLimits.maxTotalIndexedCharacters
          ) {
            skipped += 1;
            const budgetError = {
              relativePath: record.relativePath,
              code: "INDEX_CHARACTER_BUDGET",
              message: "资料全文索引已达到文字总量上限",
            };
            errors.push(budgetError);
            record = markFileRecordIndexSkipped(record, {
              code: budgetError.code,
              message: budgetError.message,
              truncated: true,
            });
          } else {
            indexedCharacters += bodyCharacters;
            if (reusedCached) reused += 1;
            else if (extractedNew) indexed += 1;
          }
        }
        completed += 1;
        emitBuildProgress({
          phase: "extracting",
          completed,
          total: walked.files.length,
          indexed,
          reused,
          skipped,
          failed: errors.length,
          percent: walked.files.length
            ? Math.floor((completed / walked.files.length) * 90)
            : 90,
        });
        return record;
      },
    );
    const fileRecords = extractedRecords.filter(Boolean);
    const webRecords = createWebRecords(
      libraryId,
      sources,
      webTree,
    );
    if (signal?.aborted) {
      const error = new Error("资料索引构建已取消");
      error.name = "AbortError";
      throw error;
    }
    records = [...fileRecords, ...webRecords];
    const cacheableFileRecords = fileRecords.filter(
      (record) => !record.indexedTextSkipped,
    );
    cachedFiles = new Map(cacheableFileRecords.map((record) => [
      normalizedRelativePathKey(record.relativePath, { platform }),
      record,
    ]));
    await persistCache(cacheableFileRecords);
    for (const invalidatedPath of invalidatedPathsForBuild) {
      invalidatedPathKeys.delete(invalidatedPath);
    }
    initialized = true;
    dirty = generation !== invalidationGeneration;
    lastRefresh = new Date().toISOString();
    lastBuildStats = {
      total: records.length,
      files: fileRecords.length,
      web: webRecords.length,
      indexed,
      reused,
      skipped,
      failed: errors.length,
      indexedCharacters,
      errors: errors.slice(0, 100),
    };
    emitBuildProgress({
      phase: "ready",
      completed: records.length,
      total: records.length,
      indexed,
      reused,
      skipped,
      failed: errors.length,
      percent: 90,
    });
    return lastBuildStats;
  }

  function ensureFresh() {
    if (initialized && !dirty) return Promise.resolve(lastBuildStats);
    if (!buildPromise) {
      buildController = new AbortController();
      const generation = invalidationGeneration;
      buildPromise = refresh({
        signal: buildController.signal,
        generation,
      }).finally(() => {
        cancelIdleBuildAbort();
        buildPromise = null;
        buildController = null;
      });
    }
    return buildPromise;
  }

  function invalidate(relativePath = "") {
    invalidationGeneration += 1;
    const invalidatedPath = normalizedRelativePathKey(relativePath, {
      platform,
    });
    if (invalidatedPath) invalidatedPathKeys.add(invalidatedPath);
    dirty = true;
  }

  function dispose() {
    invalidationGeneration += 1;
    cancelIdleBuildAbort();
    buildController?.abort(new Error("资料库已切换"));
    buildListeners.clear();
    dirty = true;
  }

  async function search(
    query,
    {
      requestId,
      limit,
      scopeKey = "global",
      workspaceScopeKey = "",
      includeFiles = true,
      includeWeb = true,
      kinds = [],
      signal,
      onProgress,
    } = {},
  ) {
    const kindFilter = new Set(
      (Array.isArray(kinds) ? kinds : [])
        .map((kind) => String(kind || "").toLocaleLowerCase("en-US"))
        .filter(Boolean),
    );
    const webScopeFilter = new Set([
      String(scopeKey || "global"),
      ...(workspaceScopeKey ? [String(workspaceScopeKey)] : []),
    ]);
    const result = await searchRecords(records, query, {
      requestId,
      limit,
      fields: RESEARCH_SEARCH_FIELDS,
      limits: resolvedLimits,
      signal,
      includeRecord: (record) => {
        if (record.kind === "file" && !includeFiles) return false;
        if (record.kind === "web") {
          if (!includeWeb || !webScopeFilter.has(record.scopeKey)) return false;
        }
        return !kindFilter.size
          || kindFilter.has(record.kind)
          || kindFilter.has(record.previewKind);
      },
      mapResult: mapResearchSearchResult,
      onProgress,
    });
    return {
      ...result,
      indexState: dirty ? "stale" : "ready",
      indexRevision: lastRefresh,
      stats: lastBuildStats,
      warnings: Array.isArray(lastBuildStats?.errors)
        ? lastBuildStats.errors
        : [],
    };
  }

    function stats() {
      return {
        libraryId,
        indexGeneration: invalidationGeneration,
        records: records.length,
      initialized,
      dirty,
      building: Boolean(buildPromise),
      lastRefresh,
      cachePath,
      cacheError,
      build: lastBuildStats,
    };
  }

  return {
    dispose,
    ensureFresh,
    invalidate,
    search,
    stats,
    subscribeBuildProgress,
  };
}

function canceledSearchResult(requestId, query) {
  return {
    requestId,
    query: String(query || "").trim().slice(0, 256),
    canceled: true,
    results: [],
    totalMatches: 0,
    limited: false,
  };
}

function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new Error("aborted"));
  return new Promise((resolve, reject) => {
    const handleAbort = () => reject(signal.reason || new Error("aborted"));
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

function createProgressSink(callback, now = Date.now) {
  let lastSentAt = 0;
  let lastPhase = "";
  return (payload, force = false) => {
    if (typeof callback !== "function") return;
    const currentTime = now();
    const phase = String(payload?.phase || "");
    if (
      !force
      && phase === lastPhase
      && currentTime - lastSentAt < 100
    ) {
      return;
    }
    lastSentAt = currentTime;
    lastPhase = phase;
    callback(payload);
  };
}

function createResearchSearchManager({
  library,
  userDataPath,
  extractFile,
  fsApi = fs,
  pathApi = path,
  platform = process.platform,
  createHashApi = createHash,
  atomicWriteFile,
  limits,
  randomId = randomUUID,
  now = Date.now,
} = {}) {
  if (!library) throw new Error("缺少资料库能力");
  if (
    !String(userDataPath || "")
    || !pathApi.isAbsolute(pathApi.resolve(String(userDataPath || "")))
  ) {
    throw new Error("缺少资料搜索缓存目录");
  }
  const resolvedLimits = resolveResearchSearchLimits(limits);
  const indexes = new Map();
  const activeRequests = new Map();
  const knownCachePaths = new Set();

  function requestKey(libraryId, requestId) {
    return `${String(libraryId || "")}\u0000${String(requestId || "")}`;
  }

  function rootForLibrary(libraryId) {
    const root = library.getRoot();
    if (
      !root?.available
      || !root.libraryId
      || root.libraryId !== libraryId
      || !root.rootPath
    ) {
      throw new Error("资料库能力已失效，请重新选择资料目录");
    }
    return root;
  }

  function cacheIdentity(libraryId, rootPath) {
    return createHashApi("sha256")
      .update(`${libraryId}\u0000${pathApi.resolve(rootPath)}`)
      .digest("hex");
  }

  function indexFor(libraryId) {
    const root = rootForLibrary(libraryId);
    const rootKey = cacheIdentity(libraryId, root.rootPath);
    const existing = indexes.get(libraryId);
    if (existing?.rootKey === rootKey) return existing.index;
    existing?.index.dispose();
    const cachePath = pathApi.join(
      pathApi.resolve(userDataPath),
      RESEARCH_SEARCH_CACHE_FOLDER,
      `${rootKey}.json`,
    );
    knownCachePaths.add(cachePath);
    const index = createResearchSearchIndex({
      libraryId,
      rootKey,
      cachePath,
      library,
      extractFile,
      fsApi,
      pathApi,
      atomicWriteFile,
      platform,
      limits: resolvedLimits,
    });
    indexes.set(libraryId, { rootKey, cachePath, index });
    return index;
  }

  async function search(payload = {}, { onProgress } = {}) {
    const libraryId = String(payload.libraryId || "").slice(0, 128);
    const requestId = String(payload.requestId || randomId()).slice(0, 128);
    const query = String(payload.query || "")
      .trim()
      .slice(0, resolvedLimits.maxQueryCharacters);
    if (!libraryId) throw new Error("缺少资料库标识");
    if (!query) {
      return {
        requestId,
        query: "",
        canceled: false,
        results: [],
        totalMatches: 0,
        limited: false,
        indexState: "idle",
      };
    }
    const key = requestKey(libraryId, requestId);
    activeRequests.get(key)?.abort();
    const controller = new AbortController();
    activeRequests.set(key, controller);
    const index = indexFor(libraryId);
    const progress = createProgressSink((event) => onProgress?.({
      libraryId,
      requestId,
      indexGeneration: index.stats().indexGeneration,
      ...event,
    }), now);
    const unsubscribe = index.subscribeBuildProgress((event) => {
      if (!controller.signal.aborted) progress(event);
    });
    try {
      progress({
        phase: "discovering",
        completed: 0,
        total: 0,
        indexed: 0,
        reused: 0,
        skipped: 0,
        failed: 0,
      }, true);
      await waitWithSignal(index.ensureFresh(), controller.signal);
      if (controller.signal.aborted) {
        return canceledSearchResult(requestId, query);
      }
      const buildStats = index.stats().build || {};
      progress({
        phase: "searching",
        completed: 0,
        total: index.stats().records,
        indexed: Number(buildStats.indexed) || 0,
        reused: Number(buildStats.reused) || 0,
        skipped: Number(buildStats.skipped) || 0,
        failed: Number(buildStats.failed) || 0,
        percent: 90,
      }, true);
      const result = await index.search(query, {
        requestId,
        limit: Math.min(
          resolvedLimits.maxResults,
          Math.max(1, Number(payload.limit) || 100),
        ),
        scopeKey: String(payload.scopeKey || "global"),
        workspaceScopeKey: String(payload.workspaceScopeKey || ""),
        includeFiles: payload.includeFiles !== false,
        includeWeb: payload.includeWeb !== false,
        kinds: Array.isArray(payload.kinds)
          ? payload.kinds.slice(0, 20)
          : [],
        signal: controller.signal,
        onProgress: (state) => {
          progress({
            phase: "searching",
            completed: state.completed,
            total: state.total,
            indexed: Number(buildStats.indexed) || 0,
            reused: Number(buildStats.reused) || 0,
            skipped: Number(buildStats.skipped) || 0,
            failed: Number(buildStats.failed) || 0,
            percent: state.total
              ? 90 + Math.floor((state.completed / state.total) * 10)
              : 100,
          });
        },
      });
      progress({
        phase: "done",
        completed: index.stats().records,
        total: index.stats().records,
        indexed: Number(buildStats.indexed) || 0,
        reused: Number(buildStats.reused) || 0,
        skipped: Number(buildStats.skipped) || 0,
        failed: Number(buildStats.failed) || 0,
        percent: 100,
      }, true);
      return result;
    } catch (error) {
      if (controller.signal.aborted) {
        return canceledSearchResult(requestId, query);
      }
      const safeError = new Error(boundedErrorMessage(error));
      safeError.code = String(error?.code || "RESEARCH_SEARCH_FAILED").slice(
        0,
        128,
      );
      throw safeError;
    } finally {
      unsubscribe();
      if (activeRequests.get(key) === controller) activeRequests.delete(key);
    }
  }

  function cancel(libraryId, requestId) {
    const key = requestKey(libraryId, requestId);
    const controller = activeRequests.get(key);
    if (!controller) return false;
    controller.abort(new Error("资料搜索已取消"));
    activeRequests.delete(key);
    return true;
  }

  function invalidate(change = {}) {
    const libraryId = String(change?.libraryId || "");
    if (libraryId) {
      indexes.get(libraryId)?.index.invalidate(change?.relativePath || "");
    }
    else {
      for (const entry of indexes.values()) entry.index.invalidate();
    }
  }

  async function clear({
    deleteCache = false,
    libraryId = "",
    rootPath = "",
  } = {}) {
    for (const controller of activeRequests.values()) {
      controller.abort(new Error("资料库已切换"));
    }
    activeRequests.clear();
    for (const entry of indexes.values()) entry.index.dispose();
    indexes.clear();
    if (deleteCache) {
      if (libraryId && rootPath) {
        const rootKey = cacheIdentity(libraryId, rootPath);
        knownCachePaths.add(pathApi.join(
          pathApi.resolve(userDataPath),
          RESEARCH_SEARCH_CACHE_FOLDER,
          `${rootKey}.json`,
        ));
      }
      const targets = [...knownCachePaths];
      knownCachePaths.clear();
      await Promise.all(targets.map(async (cachePath) => {
        try {
          await fsApi.rm(cachePath, { force: true });
        } catch {
          // A derived cache can be cleaned on the next successful build.
        }
      }));
    }
  }

  function shutdown() {
    for (const controller of activeRequests.values()) {
      controller.abort(new Error("应用正在退出"));
    }
    activeRequests.clear();
    for (const entry of indexes.values()) entry.index.dispose();
    indexes.clear();
  }

  function stats() {
    return {
      indexes: [...indexes.entries()].map(([libraryId, entry]) => ({
        libraryId,
        ...entry.index.stats(),
      })),
      activeRequests: activeRequests.size,
    };
  }

  return {
    cancel,
    clear,
    invalidate,
    search,
    shutdown,
    stats,
  };
}

module.exports = {
  DEFAULT_RESEARCH_SEARCH_LIMITS,
  RESEARCH_SEARCH_CACHE_FOLDER,
  RESEARCH_SEARCH_CACHE_VERSION,
  RESEARCH_SEARCH_FIELDS,
  bibliographicSearchText,
  createResearchSearchIndex,
  createResearchSearchManager,
  createWebRecords,
  mapResearchSearchResult,
  normalizedRelativePathKey,
  resolveResearchSearchLimits,
  walkResearchFiles,
};
