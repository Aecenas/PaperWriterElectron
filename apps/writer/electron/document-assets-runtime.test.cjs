const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
  createAssetPackager,
} = require("./asset-packager.cjs");
const {
  ASSET_PROTOCOL,
  createDocumentAssetRegistry,
  normalizeAssetPath,
  parseAssetUrl,
} = require("./document-assets.cjs");
const {
  createDocumentAssetsRuntime,
} = require("./document-assets-runtime.cjs");
const documentModel = require("./document-model.cjs");

const DOCUMENT_PATH = "C:\\Workspace\\Draft.letterpaper";
const NEXT_DOCUMENT_PATH =
  "C:\\Archive\\Draft.letterpaper";
const STAGED_TOKEN =
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

function paperDocument(html = '<img src="assets/image.png">') {
  return {
    version: 2,
    documentId: "11111111-1111-4111-8111-111111111111",
    title: "Draft",
    html,
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
  };
}

function linkedAssetUrl(runtime, filePath = DOCUMENT_PATH) {
  const linked = runtime.facade.linkPaperDocument(
    filePath,
    paperDocument(),
  );
  return /src="([^"]+)"/.exec(linked.html)?.[1] || "";
}

function createHarness(options = {}) {
  const calls = {
    cleanupCurrent: 0,
    clearedTimers: [],
    createdStores: [],
    debugLogs: [],
    initializeStore: 0,
    limiterAcquires: [],
    limiterReleases: 0,
    mkdir: [],
    pipeline: 0,
    protocolHandles: [],
    readFiles: [],
    readZipEntries: [],
    renames: [],
    removes: [],
    stagedReads: [],
    stagedResolves: [],
    stagedTouches: 0,
    timerDelays: [],
    timerUnrefs: 0,
    validateArchives: [],
    zipLoads: [],
  };
  const sourceStat = {
    dev: 1,
    ino: 2,
    size: 10,
    mtimeMs: 20,
    isFile: () => true,
  };
  const assetBuffer = Buffer.from("asset");
  const archiveBuffer = Buffer.from("archive");
  const entry = {
    nodeStream: () => ({ kind: "entry-stream" }),
  };
  const zip = {
    file(assetPath) {
      return assetPath === "assets/image.png" ? entry : null;
    },
  };
  const state = {
    pipelineGate: options.pipelineGate || null,
    readGate: options.readGate || null,
    sourceStat,
    stagedAvailable: options.stagedAvailable !== false,
  };
  const pipelineStarted = deferred();
  const readStarted = deferred();
  const protocolHandlers = new Map();
  const stagedAssetStore = {
    sessionDir:
      "C:\\Temp\\PaperWriterAssets\\session",
    async cleanupCurrent() {
      calls.cleanupCurrent += 1;
    },
    has(token) {
      return state.stagedAvailable && token === STAGED_TOKEN;
    },
    async initialize() {
      calls.initializeStore += 1;
      return {
        rootDir: "C:\\Temp\\PaperWriterAssets",
        sessionDir: this.sessionDir,
        sessionId: "session",
      };
    },
    async read(token) {
      calls.stagedReads.push(token);
      return {
        token,
        filePath: "C:\\Temp\\staged.png",
        size: assetBuffer.length,
        mime: "image/png",
        buffer: assetBuffer,
      };
    },
    async resolve(token) {
      calls.stagedResolves.push(token);
      return {
        token,
        filePath: "C:\\Temp\\staged.png",
        size: assetBuffer.length,
        mime: "image/png",
      };
    },
    async stage(filePath, metadata) {
      return {
        filePath,
        ...metadata,
        size: assetBuffer.length,
        src: `${ASSET_PROTOCOL}://staged/${STAGED_TOKEN}`,
      };
    },
    async touch() {
      calls.stagedTouches += 1;
    },
  };
  const fs = {
    async mkdir(...args) {
      calls.mkdir.push(args);
    },
    async readFile(filePath) {
      calls.readFiles.push(filePath);
      readStarted.resolve();
      if (state.readGate) {
        await state.readGate.promise;
      }
      return archiveBuffer;
    },
    async rename(...args) {
      calls.renames.push(args);
    },
    async rm(...args) {
      calls.removes.push(args);
    },
    async stat(filePath) {
      if (String(filePath).endsWith(".tmp")) {
        return {
          size: assetBuffer.length,
          isFile: () => true,
        };
      }
      return sourceStat;
    },
  };
  const runtime = createDocumentAssetsRuntime({
    fs,
    nativeFs: {
      createReadStream() {
        throw new Error("GET stream was not expected");
      },
      createWriteStream() {
        return { kind: "output-stream" };
      },
    },
    path: path.win32,
    platform: "win32",
    JSZip: {
      async loadAsync(buffer) {
        calls.zipLoads.push(buffer);
        return zip;
      },
    },
    async pipeline() {
      calls.pipeline += 1;
      pipelineStarted.resolve();
      if (state.pipelineGate) {
        await state.pipelineGate.promise;
      }
    },
    ReadableApi: { toWeb: (value) => value },
    ResponseApi: Response,
    protocol: {
      handle(scheme, handler) {
        calls.protocolHandles.push(scheme);
        protocolHandlers.set(scheme, handler);
      },
    },
    assetProtocol: ASSET_PROTOCOL,
    createDocumentAssetRegistry: () => (
      createDocumentAssetRegistry({
        pathApi: path.win32,
        platform: "win32",
      })
    ),
    createStagedAssetStore(storeOptions) {
      calls.createdStores.push(storeOptions);
      return stagedAssetStore;
    },
    parseDocumentAssetUrl: parseAssetUrl,
    normalizeAssetPath,
    createAssetPackager,
    createByteBudgetSemaphore() {
      return {
        async acquire(bytes) {
          calls.limiterAcquires.push(bytes);
          return () => {
            calls.limiterReleases += 1;
          };
        },
      };
    },
    assertZipEntryReadable() {
      return { uncompressedSize: assetBuffer.length };
    },
    createZipEntryLimitTransform: () => ({
      kind: "limit-transform",
    }),
    parseSingleByteRange(value, totalBytes) {
      if (!value) return null;
      if (value === "invalid") return { invalid: true };
      return { start: 1, end: totalBytes - 1 };
    },
    preflightZipBuffer() {},
    async readZipEntryBufferLimited(zipEntry, limits) {
      calls.readZipEntries.push([zipEntry, limits]);
      return assetBuffer;
    },
    validatePaperArchive(loadedZip, metadata) {
      calls.validateArchives.push([loadedZip, metadata]);
    },
    archiveLimits: {
      maxArchiveBytes: 1024,
      maxAssetBytes: 512,
    },
    isSupportedDocument: documentModel.isSupportedDocument,
    normalizeDocument: documentModel.normalizeDocument,
    normalizeSavedAiState: documentModel.normalizeSavedAiState,
    getTempPath: () => "C:\\Temp",
    randomUUID: () => (
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    ),
    async writeDebugLog(...args) {
      calls.debugLogs.push(args);
    },
    now: () => 100,
    setIntervalApi(callback, delay) {
      calls.timerDelays.push(delay);
      return {
        callback,
        unref() {
          calls.timerUnrefs += 1;
        },
      };
    },
    clearIntervalApi(timer) {
      calls.clearedTimers.push(timer);
    },
  });
  return {
    calls,
    entry,
    pipelineStarted,
    protocolHandlers,
    readStarted,
    runtime,
    stagedAssetStore,
    state,
    zip,
  };
}

test("deduplicates concurrent archive loads by stable path and stat identity", async () => {
  const readGate = deferred();
  const harness = createHarness({ readGate });
  const sourceUrl = linkedAssetUrl(harness.runtime);

  const first = harness.runtime.facade.readProtocolAsset(
    sourceUrl,
  );
  await harness.readStarted.promise;
  const second = harness.runtime.facade.readProtocolAsset(
    sourceUrl,
  );
  readGate.resolve();
  const [firstAsset, secondAsset] = await Promise.all([
    first,
    second,
  ]);

  assert.equal(harness.calls.readFiles.length, 1);
  assert.equal(harness.calls.zipLoads.length, 1);
  assert.deepEqual(firstAsset, secondAsset);
  assert.equal(firstAsset.mime, "image/png");
  assert.equal(firstAsset.kind, "document");
  assert.equal(firstAsset.assetPath, "assets/image.png");
});

test("does not populate the archive cache after its generation becomes stale", async () => {
  const readGate = deferred();
  const harness = createHarness({ readGate });
  const sourceUrl = linkedAssetUrl(harness.runtime);

  const staleRead = harness.runtime.facade.readProtocolAsset(
    sourceUrl,
  );
  await harness.readStarted.promise;
  harness.runtime.facade.invalidateDocumentCachesForPath(
    DOCUMENT_PATH,
  );
  readGate.resolve();
  await staleRead;

  harness.state.readGate = null;
  await harness.runtime.facade.readProtocolAsset(sourceUrl);
  assert.equal(harness.calls.readFiles.length, 2);
  assert.equal(harness.calls.zipLoads.length, 2);
});

test("rebases live document tokens and revokes them only on explicit invalidation", () => {
  const harness = createHarness();
  const sourceUrl = linkedAssetUrl(harness.runtime);
  assert.equal(
    harness.runtime.facade.parseAssetUrl(sourceUrl).filePath,
    DOCUMENT_PATH,
  );

  harness.runtime.facade.rebaseAssetPathReferences(
    DOCUMENT_PATH,
    NEXT_DOCUMENT_PATH,
  );
  assert.equal(
    harness.runtime.facade.parseAssetUrl(sourceUrl).filePath,
    NEXT_DOCUMENT_PATH,
  );

  harness.runtime.facade.invalidateDocumentCachesForPath(
    NEXT_DOCUMENT_PATH,
    false,
    { revokeReferences: true },
  );
  assert.equal(
    harness.runtime.facade.parseAssetUrl(sourceUrl),
    null,
  );
});

test("registers an authenticated staged protocol surface with unchanged response policy", async () => {
  const harness = createHarness();
  await harness.runtime.initialize();
  await harness.runtime.initialize();
  assert.deepEqual(
    harness.calls.createdStores,
    [{ rootDir: "C:\\Temp\\PaperWriterAssets" }],
  );
  assert.deepEqual(
    harness.calls.protocolHandles,
    [ASSET_PROTOCOL],
  );
  assert.deepEqual(
    harness.calls.timerDelays,
    [60 * 60 * 1000],
  );
  assert.equal(harness.calls.timerUnrefs, 1);

  const handler = harness.protocolHandlers.get(ASSET_PROTOCOL);
  const postResponse = await handler({
    method: "POST",
    url: `${ASSET_PROTOCOL}://staged/${STAGED_TOKEN}`,
    headers: new Headers(),
  });
  assert.equal(postResponse.status, 405);
  assert.equal(postResponse.headers.get("allow"), "GET, HEAD");

  const missingResponse = await handler({
    method: "HEAD",
    url: `${ASSET_PROTOCOL}://staged/cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
    headers: new Headers(),
  });
  assert.equal(missingResponse.status, 404);

  const stagedResponse = await handler({
    method: "HEAD",
    url: `${ASSET_PROTOCOL}://staged/${STAGED_TOKEN}`,
    headers: new Headers(),
  });
  assert.equal(stagedResponse.status, 200);
  assert.equal(
    stagedResponse.headers.get("content-type"),
    "image/png",
  );
  assert.equal(
    stagedResponse.headers.get("cache-control"),
    "private, max-age=31536000, immutable",
  );
  assert.equal(
    stagedResponse.headers.get("content-length"),
    "5",
  );

  const shutdown = harness.runtime.shutdown();
  assert.equal(shutdown.pending, true);
  assert.equal(shutdown.started, true);
  await shutdown.promise;
  assert.equal(harness.calls.cleanupCurrent, 1);
  assert.equal(harness.calls.clearedTimers.length, 1);
});

test("shutdown waits for pending extraction before staged cleanup and cache disposal", async () => {
  const pipelineGate = deferred();
  const harness = createHarness({ pipelineGate });
  await harness.runtime.initialize();
  const sourceUrl = linkedAssetUrl(harness.runtime);
  const handler = harness.protocolHandlers.get(ASSET_PROTOCOL);
  const protocolResponse = handler({
    method: "HEAD",
    url: sourceUrl,
    headers: new Headers(),
  });
  await harness.pipelineStarted.promise;

  const shutdown = harness.runtime.shutdown();
  assert.equal(shutdown.pending, true);
  assert.equal(shutdown.started, true);
  assert.equal(harness.calls.cleanupCurrent, 0);
  assert.equal(harness.calls.clearedTimers.length, 1);

  pipelineGate.resolve();
  assert.equal((await protocolResponse).status, 200);
  await shutdown.promise;
  assert.equal(harness.calls.pipeline, 1);
  assert.equal(harness.calls.renames.length, 1);
  assert.equal(harness.calls.limiterReleases, 1);
  assert.equal(harness.calls.cleanupCurrent, 1);

  assert.deepEqual(harness.runtime.shutdown(), {
    pending: false,
    started: false,
    promise: null,
  });
});

test("main composes one assets runtime and keeps its state outside save, load, and autosave code", async () => {
  const [mainSource, runtimeSource] = await Promise.all([
    fsPromises.readFile(
      path.join(__dirname, "main.cjs"),
      "utf8",
    ),
    fsPromises.readFile(
      path.join(__dirname, "document-assets-runtime.cjs"),
      "utf8",
    ),
  ]);

  assert.equal(
    (
      mainSource.match(
        /createDocumentAssetsRuntime\(\{/g,
      ) || []
    ).length,
    1,
  );
  assert.match(
    mainSource,
    /const assetsFacade = documentAssetsRuntime\.facade/,
  );
  assert.match(
    mainSource,
    /const \{ readProtocolAsset \} = assetsFacade;[\s\S]*createAiRuntime\(\{/,
  );
  assert.match(
    mainSource,
    /registerResourceIpcHandlers\(\{[\s\S]*assetsFacade,/,
  );
  assert.match(
    mainSource,
    /createDocumentStorageRuntime\(\{[\s\S]*assetsFacade,/,
  );
  assert.match(
    mainSource,
    /registerWorkspaceFolderIpcHandlers\(\{[\s\S]*storageFacade,/,
  );
  assert.match(
    mainSource,
    /registerDocumentSaveIpcHandlers\(\{[\s\S]*storageFacade,/,
  );
  assert.match(
    mainSource,
    /documentAssetsRuntime\.shutdown\(\)/,
  );
  assert.doesNotMatch(
    mainSource,
    /\b(?:assetZipCache|assetZipPending|extractedAssetCache|extractedAssetPending|assetSourceAliases|stagedAssetStore)\b/,
  );
  assert.doesNotMatch(
    mainSource,
    /function (?:getAssetZip|materializePackagedAsset|registerAssetProtocol|readProtocolAsset|linkAssetImages|linkAiStateAssets|packageAiStateAssets)\b/,
  );
  assert.doesNotMatch(runtimeSource, /\brequire\(/);
  assert.doesNotMatch(
    runtimeSource,
    /savePaperDocument|loadPaperDocument|runDocumentMutation|autosave/,
  );
});
