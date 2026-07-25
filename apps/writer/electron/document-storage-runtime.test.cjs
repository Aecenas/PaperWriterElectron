const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const JSZip = require("jszip");

const {
  createDocumentStorageRuntime,
} = require("./document-storage-runtime.cjs");
const documentModel = require("./document-model.cjs");
const {
  DEFAULT_ARCHIVE_LIMITS,
  assertZipEntryReadable,
  atomicWriteFile,
  createPathWriteQueue,
  preflightZipBuffer,
  readZipEntryBufferLimited,
  validatePaperArchive,
} = require("./document-storage.cjs");
const {
  DocumentRevisionConflictError,
  assertDiskRevision,
  createConflictCopyPath,
  readFileSnapshot,
  readDiskRevision,
} = require("./document-revision.cjs");
const {
  sanitizeFilesystemName,
} = require("./filesystem-access.cjs");

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

function paperDocument(overrides = {}) {
  return {
    version: 2,
    documentId:
      "11111111-1111-4111-8111-111111111111",
    derivedFrom: "",
    title: "Draft",
    html: "<p>Draft</p>",
    aiState: {},
    createdAt: "2026-07-25T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    ...overrides,
  };
}

async function createHarness(t, options = {}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "paperwriter-storage-runtime-"),
  );
  const userData = path.join(root, "user-data");
  await fs.mkdir(userData, { recursive: true });
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const calls = {
    assetCommits: [],
    assetInvalidations: [],
    assetRebases: [],
    atomicWrites: [],
    debugLogs: [],
    interchangeCreates: [],
    links: [],
    packageAi: 0,
    packageHtml: 0,
    packageSource: 0,
    queueRecords: [],
    rememberedZips: [],
  };
  const fsApi = options.fsApi || fs;
  const actualAtomicWrite =
    options.actualAtomicWrite || atomicWriteFile;
  const assetsFacade = {
    commitPackagedAssetReferences(filePath, packager) {
      calls.assetCommits.push([filePath, packager]);
      options.onAssetCommit?.(filePath, packager);
    },
    createPackager(zip) {
      const sequence = calls.packageHtml;
      return {
        async packageHtml(html) {
          calls.packageHtml += 1;
          if (options.packageHtml) {
            return options.packageHtml({
              html,
              sequence,
              zip,
            });
          }
          return html;
        },
        async packageSource(source) {
          calls.packageSource += 1;
          return source;
        },
      };
    },
    invalidateDocumentCachesForPath(...args) {
      calls.assetInvalidations.push(args);
    },
    linkPaperDocument(filePath, document, metrics) {
      calls.links.push([filePath, document, metrics]);
      return { ...document };
    },
    async packageAiStateAssets(aiState) {
      calls.packageAi += 1;
      return aiState;
    },
    async readProtocolAsset(value) {
      return { value };
    },
    rememberAssetZip(...args) {
      calls.rememberedZips.push(args);
    },
    rebaseAssetPathReferences(...args) {
      calls.assetRebases.push(args);
    },
  };

  const runtime = createDocumentStorageRuntime({
    app: {
      getPath(name) {
        assert.equal(name, "userData");
        return userData;
      },
    },
    fs: fsApi,
    path,
    platform: process.platform,
    appRoot: root,
    JSZip,
    createHash,
    randomUUID: options.randomUUID || randomUUID,
    documentModel,
    assetsFacade,
    archiveLimits: DEFAULT_ARCHIVE_LIMITS,
    assertZipEntryReadable,
    atomicWriteFile: async (...args) => {
      calls.atomicWrites.push(args);
      if (options.atomicWriteFile) {
        return options.atomicWriteFile(
          actualAtomicWrite,
          ...args,
        );
      }
      return actualAtomicWrite(...args);
    },
    createPathWriteQueue(config) {
      const queue = createPathWriteQueue(config);
      const record = { keys: [], queue };
      calls.queueRecords.push(record);
      return {
        run(key, task) {
          record.keys.push(key);
          return queue.run(key, task);
        },
        size: queue.size,
      };
    },
    preflightZipBuffer,
    readZipEntryBufferLimited,
    validatePaperArchive,
    DocumentRevisionConflictError,
    assertDiskRevision,
    createConflictCopyPath,
    readFileSnapshot,
    readDiskRevision:
      options.readDiskRevision || readDiskRevision,
    createDocumentInterchange(config) {
      calls.interchangeCreates.push(config);
      return options.interchange || {
        async importDocument(input) {
          return { kind: "import", input };
        },
        async exportDocument(input) {
          return { kind: "export", input };
        },
      };
    },
    mammoth: options.mammoth || { name: "mammoth" },
    docx: options.docx || { name: "docx" },
    iconvLite: options.iconvLite || { name: "iconv" },
    readSearchDocument:
      options.readSearchDocument
      || (async () => ({ version: 2 })),
    sanitizeFilesystemName,
    async writeDebugLog(...args) {
      calls.debugLogs.push(args);
    },
  });

  return {
    assetsFacade,
    calls,
    root,
    runtime,
    storageFacade: runtime.facade,
    userData,
  };
}

test("owns exactly one mutation queue and one per-path write queue", async (t) => {
  const harness = await createHarness(t);
  const { calls, storageFacade } = harness;
  assert.equal(Object.isFrozen(storageFacade), true);
  assert.equal(calls.queueRecords.length, 2);

  const firstStarted = deferred();
  const releaseFirst = deferred();
  const events = [];
  const first = storageFacade.runDocumentTransaction(
    async () => {
      events.push("rename:start");
      firstStarted.resolve();
      await releaseFirst.promise;
      events.push("rename:end");
    },
  );
  await firstStarted.promise;
  const second = storageFacade.runDocumentTransaction(
    async () => {
      events.push("autosave-clear:start");
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["rename:start"]);
  releaseFirst.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, [
    "rename:start",
    "rename:end",
    "autosave-clear:start",
  ]);

  const mutationKeys = calls.queueRecords[1].keys;
  assert.equal(mutationKeys.length, 2);
  assert.equal(new Set(mutationKeys).size, 1);
  assert.match(
    mutationKeys[0],
    /\.paperwriter-document-mutation\.lock$/,
  );
});

test("serializes concurrent writes to the same target path", async (t) => {
  const firstPackagingStarted = deferred();
  const releaseFirstPackaging = deferred();
  const harness = await createHarness(t, {
    async packageHtml({ html, sequence }) {
      if (sequence === 0) {
        firstPackagingStarted.resolve();
        await releaseFirstPackaging.promise;
      }
      return html;
    },
  });
  const targetPath = path.join(
    harness.root,
    "same-path.letterpaper",
  );

  const transaction = harness.storageFacade.runDocumentTransaction(
    async (storage) => {
      const first = storage.savePaperDocument(
        targetPath,
        paperDocument({ title: "First" }),
      );
      await firstPackagingStarted.promise;
      const second = storage.savePaperDocument(
        targetPath,
        paperDocument({ title: "Second" }),
      );
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(harness.calls.packageHtml, 1);
      releaseFirstPackaging.resolve();
      return Promise.all([first, second]);
    },
  );
  const results = await transaction;
  assert.equal(results.length, 2);
  assert.equal(harness.calls.packageHtml, 2);
  assert.equal(harness.calls.atomicWrites.length, 2);
  assert.equal(
    new Set(harness.calls.queueRecords[0].keys).size,
    1,
  );
  const loaded =
    await harness.storageFacade.loadPaperDocumentSnapshot(
      targetPath,
    );
  assert.equal(loaded.document.title, "Second");
});

test("checks revision around packaging and commits assets only after verified atomic bytes", async (t) => {
  const events = [];
  const harness = await createHarness(t, {
    onAssetCommit() {
      events.push("asset-commit");
    },
    async packageHtml({ html }) {
      events.push("package");
      return html;
    },
    async atomicWriteFile(write, ...args) {
      events.push("atomic");
      return write(...args);
    },
    async readDiskRevision(filePath) {
      events.push("read-revision");
      return readDiskRevision(filePath);
    },
  });
  const targetPath = path.join(
    harness.root,
    "ordered-save.letterpaper",
  );
  const result = await harness.storageFacade.savePaperDocument(
    targetPath,
    paperDocument(),
    {
      async validateTarget() {
        events.push("validate");
      },
      async afterCommit() {
        events.push("after-commit");
      },
    },
  );

  assert.deepEqual(events, [
    "validate",
    "package",
    "validate",
    "atomic",
    "read-revision",
    "asset-commit",
    "after-commit",
  ]);
  assert.equal(harness.calls.assetCommits.length, 1);
  assert.equal(result.diskRevision.size > 0, true);
  assert.match(result.diskRevision.sha256, /^[0-9a-f]{64}$/);
});

test("rejects a same-size post-write hash replacement before asset commit and afterCommit", async (t) => {
  let afterCommit = 0;
  const harness = await createHarness(t, {
    async atomicWriteFile(write, filePath, output) {
      const replaced = Buffer.from(output);
      replaced[Math.floor(replaced.length / 2)] ^= 0xff;
      return write(filePath, replaced);
    },
  });
  const targetPath = path.join(
    harness.root,
    "replaced.letterpaper",
  );
  await assert.rejects(
    harness.storageFacade.savePaperDocument(
      targetPath,
      paperDocument(),
      {
        async afterCommit() {
          afterCommit += 1;
        },
      },
    ),
    (error) => {
      assert.equal(
        error.code,
        "DOCUMENT_REVISION_CONFLICT",
      );
      assert.match(error.message, /写入完成后立即被外部版本替换/);
      return true;
    },
  );
  assert.equal(harness.calls.atomicWrites.length, 1);
  assert.equal(harness.calls.assetCommits.length, 0);
  assert.equal(harness.calls.links.length, 0);
  assert.equal(afterCommit, 0);
});

test("keeps conflict-copy writes and autosave deletion on the same mutation identity", async (t) => {
  const removeEvents = [];
  const fsApi = {
    ...fs,
    async rm(filePath, options) {
      removeEvents.push([filePath, options]);
      return fs.rm(filePath, options);
    },
  };
  const harness = await createHarness(t, { fsApi });
  await harness.runtime.initializeAutosaveStorage();
  const sourcePath = path.join(
    harness.root,
    "draft.letterpaper",
  );
  const conflictPath =
    harness.storageFacade.createConflictCopyPath(sourcePath);
  await harness.storageFacade.runDocumentTransaction(
    async (storage) => {
      await storage.savePaperDocument(
        conflictPath,
        paperDocument({ title: "Conflict copy" }),
      );
    },
  );
  await harness.storageFacade.deleteAutosaveTab("tab-7");
  assert.equal(
    (await fs.stat(conflictPath)).isFile(),
    true,
  );
  assert.match(
    path.basename(conflictPath),
    /冲突副本/,
  );
  assert.equal(removeEvents.length >= 1, true);
  assert.equal(
    new Set(harness.calls.queueRecords[1].keys).size,
    1,
  );
});

test("canonicalizes autosave roots and authorizes only direct session children", async (t) => {
  const harness = await createHarness(t);
  const futureSessionPath = path.join(
    harness.userData,
    "Autosave",
    "Session",
    "tab-1.letterpaper",
  );
  assert.equal(
    harness.storageFacade.autosaveSessionIdForPath(
      futureSessionPath,
    ),
    "",
  );
  const initialized =
    await harness.runtime.initializeAutosaveStorage();
  assert.equal(
    harness.storageFacade.autosaveSessionIdForPath(
      path.join(
        initialized.sessionRoot,
        "tab-1.letterpaper",
      ),
    ),
    "tab-1",
  );
  assert.equal(
    harness.storageFacade.autosaveSessionIdForPath(
      path.join(
        initialized.sessionRoot,
        "nested",
        "tab-1.letterpaper",
      ),
    ),
    "",
  );
  assert.equal(
    harness.storageFacade.autosaveSessionIdForPath(
      path.join(initialized.sessionRoot, "tab-1.txt"),
    ),
    "",
  );
  await assert.rejects(
    harness.storageFacade.saveAutosaveTab(
      paperDocument(),
      "../escape",
    ),
    /无效的临时会话标识/,
  );
});

test("owns document interchange initialization and preserves its exact facade", async (t) => {
  const harness = await createHarness(t);
  assert.throws(
    () => harness.storageFacade.importDocument({
      sourcePath: "draft.md",
    }),
    /尚未初始化/,
  );
  const first =
    harness.runtime.initializeDocumentInterchange();
  const second =
    harness.runtime.initializeDocumentInterchange();
  assert.equal(first, second);
  assert.equal(harness.calls.interchangeCreates.length, 1);
  assert.equal(
    harness.calls.interchangeCreates[0].resolveAsset,
    harness.assetsFacade.readProtocolAsset,
  );
  assert.deepEqual(
    await harness.storageFacade.importDocument({
      sourcePath: "draft.md",
    }),
    {
      kind: "import",
      input: { sourcePath: "draft.md" },
    },
  );
  assert.deepEqual(
    await harness.storageFacade.exportDocument({
      format: "markdown",
    }),
    {
      kind: "export",
      input: { format: "markdown" },
    },
  );
});

test("migration backups use the storage queue and preserve the original bytes", async (t) => {
  const harness = await createHarness(t, {
    async readSearchDocument() {
      return { version: 1 };
    },
    randomUUID() {
      return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    },
  });
  const sourcePath = path.join(
    harness.root,
    "Legacy.letterpaper",
  );
  await fs.writeFile(sourcePath, Buffer.from("legacy-bytes"));
  const backupPath =
    await harness.storageFacade.preservePreV2MigrationBackup(
      sourcePath,
    );
  assert.equal(
    path.dirname(backupPath),
    path.join(harness.userData, "migration-backups"),
  );
  assert.match(
    path.basename(backupPath),
    /^Legacy_pre-v2_.+_aaaaaaaa\.letterpaper$/,
  );
  assert.equal(
    (await fs.readFile(backupPath)).toString(),
    "legacy-bytes",
  );
  assert.equal(
    new Set(harness.calls.queueRecords[1].keys).size,
    1,
  );
});

test("shutdown waits for pending storage mutations and rejects new work", async (t) => {
  const harness = await createHarness(t);
  const started = deferred();
  const release = deferred();
  const pending =
    harness.storageFacade.runDocumentTransaction(
      async () => {
        started.resolve();
        await release.promise;
      },
    );
  await started.promise;

  const firstShutdown = harness.runtime.shutdown();
  assert.equal(firstShutdown.pending, true);
  assert.equal(firstShutdown.started, true);
  const repeatedShutdown = harness.runtime.shutdown();
  assert.equal(repeatedShutdown.pending, true);
  assert.equal(repeatedShutdown.started, false);
  assert.equal(
    repeatedShutdown.promise,
    firstShutdown.promise,
  );
  await assert.rejects(
    harness.storageFacade.runDocumentTransaction(
      async () => {},
    ),
    /正在退出/,
  );
  release.resolve();
  await Promise.all([pending, firstShutdown.promise]);
  assert.deepEqual(harness.runtime.shutdown(), {
    pending: false,
    started: false,
    promise: null,
  });
});
