const ASSET_URL_PATTERN = /src=(["'])(assets\/[^"']+)\1/gi;
const DEFAULT_ASSET_ZIP_CACHE_LIMIT = 5;
const DEFAULT_ASSET_ZIP_CACHE_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_EXTRACTED_ASSET_CACHE_LIMIT = 64;
const DEFAULT_EXTRACTED_ASSET_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_EXTRACTED_ASSET_CONCURRENCY = 4;
const DEFAULT_ASSET_SOURCE_ALIAS_LIMIT = 10000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;

function createDocumentAssetsRuntime({
  fs,
  nativeFs,
  path,
  platform = process.platform,
  JSZip,
  pipeline,
  ReadableApi,
  ResponseApi,
  protocol,
  assetProtocol,
  createDocumentAssetRegistry,
  createStagedAssetStore,
  parseDocumentAssetUrl,
  normalizeAssetPath,
  createAssetPackager,
  createByteBudgetSemaphore,
  assertZipEntryReadable,
  createZipEntryLimitTransform,
  parseSingleByteRange,
  preflightZipBuffer,
  readZipEntryBufferLimited,
  validatePaperArchive,
  archiveLimits,
  isSupportedDocument,
  normalizeDocument,
  normalizeSavedAiState,
  getTempPath,
  randomUUID,
  writeDebugLog,
  now = Date.now,
  setIntervalApi = setInterval,
  clearIntervalApi = clearInterval,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  assetZipCacheLimit = DEFAULT_ASSET_ZIP_CACHE_LIMIT,
  assetZipCacheMaxBytes = DEFAULT_ASSET_ZIP_CACHE_MAX_BYTES,
  extractedAssetCacheLimit =
    DEFAULT_EXTRACTED_ASSET_CACHE_LIMIT,
  extractedAssetCacheMaxBytes =
    DEFAULT_EXTRACTED_ASSET_CACHE_MAX_BYTES,
  extractedAssetConcurrency =
    DEFAULT_EXTRACTED_ASSET_CONCURRENCY,
  assetSourceAliasLimit = DEFAULT_ASSET_SOURCE_ALIAS_LIMIT,
}) {
  const assetZipCache = new Map();
  const assetZipPending = new Map();
  const extractedAssetCache = new Map();
  const extractedAssetPending = new Map();
  const extractedAssetLimiter = createByteBudgetSemaphore({
    maxConcurrent: extractedAssetConcurrency,
    maxReservedBytes: extractedAssetCacheMaxBytes,
  });
  const documentAssetRegistry = createDocumentAssetRegistry();
  const assetSourceAliases = new Map();
  let assetCacheGeneration = 0;
  let stagedAssetStore = null;
  let stagedAssetHeartbeatTimer = null;
  let initializationPromise = null;
  let protocolRegistered = false;
  let stagedAssetCleanupStarted = false;
  let stagedAssetCleanupComplete = false;
  let stagedAssetCleanupPromise = null;

  function mimeFromPath(filePath) {
    switch (path.extname(filePath).toLowerCase()) {
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".gif":
        return "image/gif";
      case ".webp":
        return "image/webp";
      case ".bmp":
        return "image/bmp";
      case ".svg":
        return "image/svg+xml";
      case ".avif":
        return "image/avif";
      case ".mp3":
        return "audio/mpeg";
      case ".wav":
        return "audio/wav";
      case ".ogg":
        return "audio/ogg";
      case ".m4a":
        return "audio/mp4";
      case ".aac":
        return "audio/aac";
      case ".flac":
        return "audio/flac";
      case ".webm":
        return "video/webm";
      case ".ogv":
        return "video/ogg";
      case ".mp4":
        return "video/mp4";
      default:
        return "image/png";
    }
  }

  function parseAssetUrl(value) {
    const parsed = parseDocumentAssetUrl(value, {
      hasStagedToken: (token) => (
        Boolean(stagedAssetStore?.has(token))
      ),
      resolveDocumentReference: (reference) => (
        documentAssetRegistry.resolve(reference)
      ),
    });
    if (
      parsed?.kind === "document"
      && !isSupportedDocument(parsed.filePath)
    ) {
      return null;
    }
    return parsed
      ? { ...parsed, sourceUrl: String(value || "") }
      : null;
  }

  function invalidateExtractedAssetsForPath(
    filePath,
    includeChildren = false,
  ) {
    const source = path.resolve(String(filePath || ""));
    for (const [key, entry] of extractedAssetCache) {
      const relative = path.relative(source, entry.sourcePath);
      const matches = relative === ""
        || (
          includeChildren
          && !relative.startsWith(`..${path.sep}`)
          && relative !== ".."
          && !path.isAbsolute(relative)
        );
      if (!matches) {
        continue;
      }
      extractedAssetCache.delete(key);
      fs.rm(entry.filePath, { force: true }).catch(() => {});
    }
  }

  function rebaseAssetPathReferences(fromPath, toPath) {
    const source = path.resolve(String(fromPath || ""));
    const target = path.resolve(String(toPath || ""));
    invalidateExtractedAssetsForPath(source, true);
    documentAssetRegistry.rebasePath(source, target);
    for (const alias of assetSourceAliases.values()) {
      const relative = path.relative(source, alias.filePath);
      const inside = relative === ""
        || (
          !relative.startsWith(`..${path.sep}`)
          && relative !== ".."
          && !path.isAbsolute(relative)
        );
      if (inside) {
        alias.filePath = relative
          ? path.resolve(target, relative)
          : target;
      }
    }
    assetCacheGeneration += 1;
    assetZipCache.clear();
  }

  function rememberAssetZip(filePath, stat, zip) {
    const key = String(filePath || "");
    if (!key || !stat || !zip) {
      return;
    }
    if (stat.size > assetZipCacheMaxBytes) {
      return;
    }
    assetZipCache.set(key, {
      zip,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      lastAccess: now(),
    });
    let cachedBytes = [...assetZipCache.values()]
      .reduce((total, entry) => total + entry.size, 0);
    while (
      assetZipCache.size > assetZipCacheLimit
      || cachedBytes > assetZipCacheMaxBytes
    ) {
      const oldest = [...assetZipCache.entries()]
        .sort(
          (left, right) => (
            left[1].lastAccess - right[1].lastAccess
          ),
        )[0];
      if (!oldest) {
        break;
      }
      assetZipCache.delete(oldest[0]);
      cachedBytes -= oldest[1].size;
    }
  }

  async function getAssetZip(filePath) {
    const sourcePath = path.resolve(String(filePath || ""));
    if (!sourcePath || !isSupportedDocument(sourcePath)) {
      throw new Error("无效的信笺资源路径");
    }
    const stat = await fs.stat(sourcePath);
    if (
      !stat.isFile()
      || stat.size > archiveLimits.maxArchiveBytes
    ) {
      throw new Error(
        "信笺文件过大或不是普通文件，已拒绝读取资源",
      );
    }
    const cached = assetZipCache.get(sourcePath);
    if (
      cached
      && cached.size === stat.size
      && cached.mtimeMs === stat.mtimeMs
    ) {
      cached.lastAccess = now();
      return cached.zip;
    }
    const pendingKey =
      `${sourcePath}\n${stat.size}\n${stat.mtimeMs}`;
    if (assetZipPending.has(pendingKey)) {
      return assetZipPending.get(pendingKey);
    }
    const generation = assetCacheGeneration;
    const pending = (async () => {
      const buffer = await fs.readFile(sourcePath);
      preflightZipBuffer(buffer);
      const zip = await JSZip.loadAsync(buffer);
      validatePaperArchive(zip, {
        archiveBytes: buffer.length,
      });
      if (generation === assetCacheGeneration) {
        rememberAssetZip(sourcePath, stat, zip);
      }
      return zip;
    })();
    assetZipPending.set(pendingKey, pending);
    try {
      return await pending;
    } finally {
      if (assetZipPending.get(pendingKey) === pending) {
        assetZipPending.delete(pendingKey);
      }
    }
  }

  async function readPackagedAsset(
    filePath,
    assetPath,
    { maxBytes = archiveLimits.maxAssetBytes } = {},
  ) {
    const normalizedAssetPath = normalizeAssetPath(assetPath);
    if (!normalizedAssetPath) {
      throw new Error("无效的资源路径");
    }
    const zip = await getAssetZip(filePath);
    const file = zip.file(normalizedAssetPath);
    if (!file) {
      throw new Error("资源不存在");
    }
    const buffer = await readZipEntryBufferLimited(
      file,
      { maxBytes },
    );
    return {
      buffer,
      mime: mimeFromPath(normalizedAssetPath),
    };
  }

  function extractedAssetCacheKey(filePath, stat, assetPath) {
    const resolved = path.resolve(String(filePath || ""));
    const pathKey = platform === "win32"
      ? resolved.toLocaleLowerCase("en-US")
      : resolved;
    return `${pathKey}\n${stat.size}\n${stat.mtimeMs}\n${assetPath}`;
  }

  function invalidateDocumentCachesForPath(
    filePath,
    includeChildren = false,
    { revokeReferences = false } = {},
  ) {
    const source = path.resolve(String(filePath || ""));
    const contains = (candidate) => {
      const relative = path.relative(
        source,
        path.resolve(String(candidate || "")),
      );
      return relative === ""
        || (
          includeChildren
          && !relative.startsWith(`..${path.sep}`)
          && relative !== ".."
          && !path.isAbsolute(relative)
        );
    };
    assetCacheGeneration += 1;
    invalidateExtractedAssetsForPath(
      source,
      includeChildren,
    );
    for (const cachePath of [...assetZipCache.keys()]) {
      if (contains(cachePath)) {
        assetZipCache.delete(cachePath);
      }
    }
    if (!revokeReferences) {
      return;
    }
    documentAssetRegistry.revokePath(
      source,
      includeChildren,
    );
    for (
      const [sourceUrl, alias]
      of [...assetSourceAliases.entries()]
    ) {
      if (contains(alias.filePath)) {
        assetSourceAliases.delete(sourceUrl);
      }
    }
  }

  async function pruneExtractedAssetCache() {
    let totalBytes = [...extractedAssetCache.values()]
      .reduce((total, entry) => total + entry.size, 0);
    while (
      extractedAssetCache.size > extractedAssetCacheLimit
      || totalBytes > extractedAssetCacheMaxBytes
    ) {
      const oldest = [...extractedAssetCache.entries()]
        .sort(
          (left, right) => (
            left[1].lastAccess - right[1].lastAccess
          ),
        )[0];
      if (!oldest) {
        break;
      }
      extractedAssetCache.delete(oldest[0]);
      totalBytes -= oldest[1].size;
      await fs.rm(
        oldest[1].filePath,
        { force: true },
      ).catch(() => {});
    }
  }

  async function materializePackagedAsset(filePath, assetPath) {
    if (!stagedAssetStore) {
      throw new Error("资源暂存服务尚未就绪");
    }
    const sourcePath = path.resolve(String(filePath || ""));
    const normalizedAssetPath = normalizeAssetPath(assetPath);
    if (
      !normalizedAssetPath
      || !isSupportedDocument(sourcePath)
    ) {
      throw new Error("无效的信笺资源路径");
    }
    const sourceStat = await fs.stat(sourcePath);
    if (
      !sourceStat.isFile()
      || sourceStat.size > archiveLimits.maxArchiveBytes
    ) {
      throw new Error("信笺文件过大或不是普通文件");
    }
    const key = extractedAssetCacheKey(
      sourcePath,
      sourceStat,
      normalizedAssetPath,
    );
    const cached = extractedAssetCache.get(key);
    if (cached) {
      try {
        const cachedStat = await fs.stat(cached.filePath);
        if (
          cachedStat.isFile()
          && cachedStat.size === cached.size
        ) {
          cached.lastAccess = now();
          return { ...cached };
        }
      } catch {
        // Re-extract below.
      }
      extractedAssetCache.delete(key);
    }
    if (extractedAssetPending.has(key)) {
      return extractedAssetPending.get(key);
    }

    const pending = (async () => {
      const zip = await getAssetZip(sourcePath);
      const entry = zip.file(normalizedAssetPath);
      const sizes = assertZipEntryReadable(entry);
      const releaseExtractionSlot =
        await extractedAssetLimiter.acquire(
          sizes.uncompressedSize,
        );
      const cacheDir = path.join(
        stagedAssetStore.sessionDir,
        "document-assets",
      );
      await fs.mkdir(cacheDir, { recursive: true });
      const rawExtension = path.extname(
        normalizedAssetPath,
      ).toLowerCase();
      const extension = /^\.[a-z0-9]{1,12}$/i
        .test(rawExtension)
        ? rawExtension
        : "";
      const outputPath = path.join(
        cacheDir,
        `${randomUUID()}${extension}`,
      );
      const temporaryPath = `${outputPath}.tmp`;
      try {
        await pipeline(
          entry.nodeStream("nodebuffer"),
          createZipEntryLimitTransform(entry),
          nativeFs.createWriteStream(
            temporaryPath,
            { flags: "wx" },
          ),
        );
        const outputStat = await fs.stat(temporaryPath);
        if (
          !outputStat.isFile()
          || outputStat.size !== sizes.uncompressedSize
        ) {
          throw new Error("解压后的信笺资源不完整");
        }
        const latestSourceStat = await fs.stat(sourcePath);
        if (
          !latestSourceStat.isFile()
          || latestSourceStat.dev !== sourceStat.dev
          || latestSourceStat.ino !== sourceStat.ino
          || latestSourceStat.size !== sourceStat.size
          || latestSourceStat.mtimeMs !== sourceStat.mtimeMs
        ) {
          throw new Error(
            "信笺资源来源已被移动、删除或替换",
          );
        }
        await fs.rename(temporaryPath, outputPath);
        const record = {
          filePath: outputPath,
          sourcePath,
          assetPath: normalizedAssetPath,
          mime: mimeFromPath(normalizedAssetPath),
          size: outputStat.size,
          lastAccess: now(),
        };
        extractedAssetCache.set(key, record);
        await pruneExtractedAssetCache();
        return { ...record };
      } catch (error) {
        await Promise.allSettled([
          fs.rm(temporaryPath, { force: true }),
          fs.rm(outputPath, { force: true }),
        ]);
        throw error;
      } finally {
        releaseExtractionSlot();
      }
    })();
    extractedAssetPending.set(key, pending);
    try {
      return await pending;
    } finally {
      if (extractedAssetPending.get(key) === pending) {
        extractedAssetPending.delete(key);
      }
    }
  }

  async function resolveProtocolAssetFile(parsed) {
    try {
      if (parsed?.kind === "staged") {
        if (!stagedAssetStore) {
          throw new Error("资源暂存服务尚未就绪");
        }
        const asset = await stagedAssetStore.resolve(
          parsed.token,
        );
        return {
          ...asset,
          mime: asset.mime || mimeFromPath(asset.filePath),
        };
      }
      if (parsed?.kind === "document") {
        return materializePackagedAsset(
          parsed.filePath,
          parsed.assetPath,
        );
      }
      throw new Error("无效或未注册的信笺资源地址");
    } catch (error) {
      const alias = assetSourceAliases.get(parsed?.sourceUrl);
      if (!alias) {
        throw error;
      }
      return materializePackagedAsset(
        alias.filePath,
        alias.assetPath,
      );
    }
  }

  async function readAssetFromParsedUrl(
    parsed,
    { maxBytes = archiveLimits.maxAssetBytes } = {},
  ) {
    try {
      if (parsed?.kind === "staged") {
        if (!stagedAssetStore) {
          throw new Error("图片暂存服务尚未就绪");
        }
        const resolved = await stagedAssetStore.resolve(
          parsed.token,
        );
        if (resolved.size > maxBytes) {
          throw new Error("暂存资源过大，无法安全读取");
        }
        const asset = await stagedAssetStore.read(parsed.token);
        return {
          ...asset,
          mime: asset.mime || mimeFromPath(asset.filePath),
        };
      }
      if (parsed?.kind === "document") {
        return {
          ...(await readPackagedAsset(
            parsed.filePath,
            parsed.assetPath,
            { maxBytes },
          )),
          kind: "document",
          assetPath: parsed.assetPath,
        };
      }
      throw new Error("无效或未注册的信笺资源地址");
    } catch (error) {
      const alias = assetSourceAliases.get(parsed?.sourceUrl);
      if (!alias) {
        throw error;
      }
      return {
        ...(await readPackagedAsset(
          alias.filePath,
          alias.assetPath,
          { maxBytes },
        )),
        kind: "document",
        assetPath: alias.assetPath,
      };
    }
  }

  async function readProtocolAsset(sourceUrl, options = {}) {
    const parsed = parseAssetUrl(sourceUrl);
    if (!parsed) {
      throw new Error("无效或未注册的信笺资源地址");
    }
    return readAssetFromParsedUrl(parsed, options);
  }

  function nextZipAssetPath(
    zip,
    preferredPath,
    extension = ".png",
  ) {
    const normalizedPreferred =
      normalizeAssetPath(preferredPath);
    if (
      normalizedPreferred
      && !zip.file(normalizedPreferred)
    ) {
      return normalizedPreferred;
    }
    let index = 1;
    let assetPath = "";
    do {
      assetPath =
        `assets/image-${String(index).padStart(4, "0")}${extension}`;
      index += 1;
    } while (zip.file(assetPath));
    return assetPath;
  }

  function createPackager(zip) {
    return createAssetPackager({
      zip,
      readProtocolAsset,
      nextAssetPath: nextZipAssetPath,
    });
  }

  function linkAssetImages(filePath, html, metrics = null) {
    const matches = [...html.matchAll(ASSET_URL_PATTERN)];
    const linked = html.replace(
      ASSET_URL_PATTERN,
      (full, quote, assetPath) => {
        const normalizedAssetPath =
          normalizeAssetPath(assetPath);
        return normalizedAssetPath
          ? `src=${quote}${documentAssetRegistry.urlFor(
            filePath,
            normalizedAssetPath,
          )}${quote}`
          : full;
      },
    );
    if (metrics) {
      metrics.assetReferences = matches.length;
      metrics.linkedAssets = new Set(
        matches
          .map((match) => normalizeAssetPath(match[2]))
          .filter(Boolean),
      ).size;
    }
    return linked;
  }

  async function packageAiStateAssets(aiState, packager) {
    const normalized = normalizeSavedAiState(aiState);
    const images =
      normalized.optimize?.assets?.images || {};
    const nextImages = Object.create(null);
    for (const [key, image] of Object.entries(images)) {
      const nextImage = { ...image };
      if (
        typeof nextImage.src === "string"
        && nextImage.src
      ) {
        try {
          if (
            /^data:/i.test(nextImage.src)
            && !/^data:image\//i.test(nextImage.src)
          ) {
            throw new Error(
              "AI 图片不是受支持的图片数据",
            );
          }
          nextImage.src = await packager.packageSource(
            nextImage.src,
          );
        } catch (error) {
          throw new Error(
            `AI 图片资源 ${key} 无法读取，文档未保存：${error?.message || "资源失效"}`,
            { cause: error },
          );
        }
      }
      nextImages[key] = nextImage;
    }
    return {
      ...normalized,
      optimize: {
        ...normalized.optimize,
        assets: {
          ...normalized.optimize.assets,
          images: nextImages,
        },
      },
    };
  }

  function linkAiStateAssets(filePath, aiState) {
    const normalized = normalizeSavedAiState(aiState);
    const images =
      normalized.optimize?.assets?.images || {};
    const nextImages = Object.create(null);
    Object.entries(images).forEach(([key, image]) => {
      const nextImage = { ...image };
      if (
        typeof nextImage.src === "string"
        && normalizeAssetPath(nextImage.src)
      ) {
        nextImage.src = documentAssetRegistry.urlFor(
          filePath,
          nextImage.src,
        );
      }
      nextImages[key] = nextImage;
    });
    return {
      ...normalized,
      optimize: {
        ...normalized.optimize,
        assets: {
          ...normalized.optimize.assets,
          images: nextImages,
        },
      },
    };
  }

  function linkPaperDocument(
    filePath,
    sourceDocument,
    metrics = null,
  ) {
    const sourcePath = path.resolve(
      String(filePath || ""),
    );
    documentAssetRegistry.register(sourcePath);
    const document = normalizeDocument(sourceDocument);
    const assetLinkStartedAt = now();
    document.html = linkAssetImages(
      sourcePath,
      document.html,
      metrics,
    );
    if (metrics) {
      metrics.assetLinkMs = now() - assetLinkStartedAt;
      metrics.htmlBytes = Buffer.byteLength(
        document.html,
        "utf8",
      );
    }
    if (
      document.customBackground
      && !document.customBackground.startsWith("data:")
    ) {
      const backgroundPath = normalizeAssetPath(
        document.customBackground,
      );
      if (backgroundPath) {
        document.customBackground =
          documentAssetRegistry.urlFor(
            sourcePath,
            backgroundPath,
          );
      }
    }
    document.aiState = linkAiStateAssets(
      sourcePath,
      document.aiState,
    );
    return document;
  }

  function commitPackagedAssetReferences(
    filePath,
    packager,
  ) {
    const targetPath = path.resolve(String(filePath || ""));
    invalidateDocumentCachesForPath(targetPath);
    documentAssetRegistry.register(targetPath);
    for (
      const [sourceUrl, assetPath]
      of packager.bySource
    ) {
      if (
        String(sourceUrl)
          .startsWith(`${assetProtocol}://`)
      ) {
        assetSourceAliases.delete(sourceUrl);
        assetSourceAliases.set(sourceUrl, {
          filePath: targetPath,
          assetPath,
        });
        while (
          assetSourceAliases.size > assetSourceAliasLimit
        ) {
          assetSourceAliases.delete(
            assetSourceAliases.keys().next().value,
          );
        }
      }
    }
  }

  async function stageAsset(filePath, options = {}) {
    if (!stagedAssetStore) {
      throw new Error("资源暂存服务尚未就绪");
    }
    return stagedAssetStore.stage(filePath, options);
  }

  function registerAssetProtocol() {
    if (protocolRegistered) {
      return;
    }
    protocol.handle(assetProtocol, async (request) => {
      if (!["GET", "HEAD"].includes(request.method)) {
        return new ResponseApi(
          "Method not allowed",
          {
            status: 405,
            headers: { allow: "GET, HEAD" },
          },
        );
      }
      const parsed = parseAssetUrl(request.url);
      if (!parsed) {
        return new ResponseApi(
          "Not found",
          { status: 404 },
        );
      }
      try {
        const asset = await resolveProtocolAssetFile(parsed);
        const totalBytes = asset.size;
        const range = parseSingleByteRange(
          request.headers.get("range"),
          totalBytes,
        );
        const commonHeaders = {
          "content-type": asset.mime,
          "cache-control": parsed.kind === "staged"
            ? "private, max-age=31536000, immutable"
            : "no-store",
          "accept-ranges": "bytes",
          "x-content-type-options": "nosniff",
        };
        if (range?.invalid) {
          return new ResponseApi(null, {
            status: 416,
            headers: {
              ...commonHeaders,
              "content-range": `bytes */${totalBytes}`,
            },
          });
        }
        const start = range?.start ?? 0;
        const end =
          range?.end ?? Math.max(0, totalBytes - 1);
        const contentLength = totalBytes
          ? end - start + 1
          : 0;
        const headers = {
          ...commonHeaders,
          "content-length": String(contentLength),
          ...(range
            ? {
              "content-range":
                `bytes ${start}-${end}/${totalBytes}`,
            }
            : {}),
        };
        if (
          request.method === "HEAD"
          || totalBytes === 0
        ) {
          return new ResponseApi(null, {
            status: range ? 206 : 200,
            headers,
          });
        }
        const fileStream = nativeFs.createReadStream(
          asset.filePath,
          { start, end },
        );
        request.signal?.addEventListener(
          "abort",
          () => fileStream.destroy(),
          { once: true },
        );
        return new ResponseApi(
          ReadableApi.toWeb(fileStream),
          {
            status: range ? 206 : 200,
            headers,
          },
        );
      } catch (error) {
        await writeDebugLog("asset:protocol:error", {
          kind: parsed.kind,
          filePath: parsed.filePath,
          assetPath: parsed.assetPath,
          token: parsed.token,
          message: error?.message,
        });
        return new ResponseApi(
          "Not found",
          { status: 404 },
        );
      }
    });
    protocolRegistered = true;
  }

  function initialize() {
    if (initializationPromise) {
      return initializationPromise;
    }
    initializationPromise = (async () => {
      stagedAssetStore = createStagedAssetStore({
        rootDir: path.join(
          getTempPath(),
          "PaperWriterAssets",
        ),
      });
      const initialized =
        await stagedAssetStore.initialize();
      stagedAssetHeartbeatTimer = setIntervalApi(() => {
        stagedAssetStore?.touch().catch(() => {});
      }, heartbeatIntervalMs);
      stagedAssetHeartbeatTimer?.unref?.();
      registerAssetProtocol();
      return initialized;
    })();
    return initializationPromise;
  }

  function shutdown() {
    if (stagedAssetHeartbeatTimer) {
      clearIntervalApi(stagedAssetHeartbeatTimer);
      stagedAssetHeartbeatTimer = null;
    }
    if (!stagedAssetStore || stagedAssetCleanupComplete) {
      return {
        pending: false,
        started: false,
        promise: null,
      };
    }
    if (stagedAssetCleanupStarted) {
      return {
        pending: true,
        started: false,
        promise: stagedAssetCleanupPromise,
      };
    }
    stagedAssetCleanupStarted = true;
    stagedAssetCleanupPromise = Promise.allSettled(
      [...extractedAssetPending.values()],
    )
      .then(() => stagedAssetStore.cleanupCurrent())
      .catch(() => {})
      .finally(() => {
        assetZipCache.clear();
        assetZipPending.clear();
        extractedAssetCache.clear();
        extractedAssetPending.clear();
        assetSourceAliases.clear();
        stagedAssetCleanupComplete = true;
      });
    return {
      pending: true,
      started: true,
      promise: stagedAssetCleanupPromise,
    };
  }

  const facade = Object.freeze({
    commitPackagedAssetReferences,
    createPackager,
    invalidateDocumentCachesForPath,
    isStagedAssetReady: () => Boolean(stagedAssetStore),
    linkPaperDocument,
    mimeFromPath,
    packageAiStateAssets,
    parseAssetUrl,
    readProtocolAsset,
    rememberAssetZip,
    rebaseAssetPathReferences,
    stageAsset,
  });

  return {
    facade,
    initialize,
    shutdown,
  };
}

module.exports = {
  createDocumentAssetsRuntime,
};
