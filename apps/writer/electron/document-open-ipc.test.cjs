const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
  registerDocumentOpenIpcHandlers,
} = require("./document-open-ipc.cjs");

const DOCUMENT_OPEN_CHANNELS = [
  "document:export-editable",
  "document:import",
  "document:open",
  "document:open-path",
  "document:regenerate-identity",
  "document:revision",
];

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function createHarness(options = {}) {
  const handlers = new Map();
  const mainWindow = { id: "main-window" };
  const documentFilters = [{ name: "Documents", extensions: ["letterpaper"] }];
  const dialogResults = [...(options.dialogResults || [{
    canceled: false,
    filePaths: ["C:\\selected\\draft.letterpaper"],
  }])];
  const calls = {
    assertDiskRevisions: [],
    atomicWrites: [],
    authorizations: [],
    canonicalPaths: [],
    consumedTargets: [],
    debugLogs: [],
    ensureExtensions: [],
    exportDocuments: [],
    importDocuments: [],
    insideChecks: [],
    mkdirs: [],
    normalizedDocuments: [],
    normalizedIds: [],
    openDialogs: [],
    pickerExports: [],
    preserveBackups: [],
    readRevisions: [],
    resolveDocuments: [],
    saveDocuments: [],
    snapshots: [],
    supportedPaths: [],
  };
  const state = {
    snapshot: options.snapshot || {
      document: {
        version: 2,
        documentId: "33333333-3333-4333-8333-333333333333",
        title: "Draft",
        footnotes: [],
        citationSources: [],
      },
      rawDocument: { version: 2 },
      diskRevision: { sha256: "a".repeat(64), size: 42, mtimeMs: 123 },
    },
  };
  const interchange = {
    async importDocument(input) {
      calls.importDocuments.push(input);
      return options.imported || {
        format: "markdown",
        document: {
          title: "Imported",
          documentId: "untrusted-old-id",
          comments: [{ id: "old-comment" }],
          aiState: { old: true },
        },
        warnings: ["import warning"],
      };
    },
    async exportDocument(input) {
      calls.exportDocuments.push(input);
      return options.exported || {
        buffer: Buffer.from("main"),
        assets: [{
          relativePath: path.join("assets", "image.png"),
          buffer: Buffer.from("image"),
        }],
        warnings: ["export warning"],
      };
    },
  };
  const storageTransaction = {
    async assertDiskRevision(...args) {
      calls.assertDiskRevisions.push(args);
    },
    async loadPaperDocumentSnapshot(filePath, metrics) {
      calls.snapshots.push([filePath, metrics]);
      if (options.snapshotError) {
        throw options.snapshotError;
      }
      if (metrics) metrics.loadMs = 7;
      return state.snapshot;
    },
    async preservePreV2MigrationBackup(filePath) {
      calls.preserveBackups.push(filePath);
      return options.migrationBackupPath
        || `${filePath}.v1.backup`;
    },
    async savePaperDocument(...args) {
      calls.saveDocuments.push(args);
      return options.saved || {
        document: args[1],
        diskRevision: {
          sha256: "c".repeat(64),
          size: 99,
          mtimeMs: 456,
        },
      };
    },
  };

  registerDocumentOpenIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
        handlers.set(channel, handler);
      },
    },
    documentModel: {
      DOCUMENT_SCHEMA_VERSION: 2,
      DOCUMENT_FILTERS: documentFilters,
      isSupportedDocument(filePath) {
        calls.supportedPaths.push(filePath);
        return hasOwn(options, "supported") ? options.supported : true;
      },
      normalizeDocumentId(value) {
        calls.normalizedIds.push(value);
        if (hasOwn(options, "normalizedDocumentId")) {
          return options.normalizedDocumentId;
        }
        return typeof value === "string" && value.includes("-") ? value : "";
      },
      normalizeDocument(document) {
        calls.normalizedDocuments.push(document);
        return { ...document, normalized: true };
      },
    },
    dialog: {
      async showOpenDialog(...args) {
        calls.openDialogs.push(args);
        return dialogResults.shift() || { canceled: true };
      },
    },
    getMainWindow() {
      return mainWindow;
    },
    defaultDocumentsDir() {
      return "C:\\Documents";
    },
    async canonicalExistingPath(filePath, kind) {
      calls.canonicalPaths.push([filePath, kind]);
      return options.canonicalPath || filePath;
    },
    async authorizeDocumentPath(filePath) {
      calls.authorizations.push(filePath);
    },
    async writeDebugLog(...args) {
      calls.debugLogs.push(args);
    },
    async assertAuthorizedDocument(filePath) {
      calls.authorizations.push(filePath);
      return options.authorizedPath || filePath;
    },
    async resolveAuthorizedOpenDocument(filePath) {
      calls.resolveDocuments.push(filePath);
      if (options.resolveError) throw options.resolveError;
      return options.resolvedPath || filePath;
    },
    randomUUID() {
      return "99999999-9999-4999-8999-999999999999";
    },
    storageFacade: {
      autosaveSessionIdForPath(filePath) {
        return hasOwn(options, "recoveryId")
          ? options.recoveryId
          : `recovery:${filePath}`;
      },
      exportDocument(input) {
        return interchange.exportDocument(input);
      },
      importDocument(input) {
        return interchange.importDocument(input);
      },
      loadPaperDocumentSnapshot:
        storageTransaction.loadPaperDocumentSnapshot,
      async readDiskRevision(filePath) {
        calls.readRevisions.push(filePath);
        return options.diskRevision || {
          sha256: "b".repeat(64),
          size: 7,
          mtimeMs: 8,
        };
      },
      async runDocumentTransaction(operation) {
        return operation(storageTransaction);
      },
    },
    interchangeFormatExtension(format) {
      return {
        markdown: ".md",
        html: ".html",
        txt: ".txt",
        docx: ".docx",
      }[format] || "";
    },
    async pickInterchangeExportPath(...args) {
      calls.pickerExports.push(args);
      return hasOwn(options, "pickedExportPath")
        ? options.pickedExportPath
        : "C:\\exports\\picked.md";
    },
    ensureExtension(filePath, extension) {
      calls.ensureExtensions.push([filePath, extension]);
      return filePath.toLowerCase().endsWith(extension)
        ? filePath
        : `${filePath}${extension}`;
    },
    path,
    consumeExportTarget(...args) {
      calls.consumedTargets.push(args);
      return options.consumedTarget || args[0];
    },
    isPathInside(...args) {
      calls.insideChecks.push(args);
      return hasOwn(options, "assetInside") ? options.assetInside : true;
    },
    fs: {
      async mkdir(...args) {
        calls.mkdirs.push(args);
      },
    },
    async atomicWriteFile(...args) {
      calls.atomicWrites.push(args);
    },
  });

  return {
    calls,
    documentFilters,
    handlers,
    interchange,
    mainWindow,
    state,
  };
}

test("registers exactly the document open, import, identity, and editable export surface", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()].sort(), DOCUMENT_OPEN_CHANNELS);
});

test("document revision resolves the capability before reading disk state", async () => {
  const revision = { sha256: "d".repeat(64), size: 11, mtimeMs: 12 };
  const harness = createHarness({
    authorizedPath: "C:\\authorized\\draft.letterpaper",
    diskRevision: revision,
  });

  assert.deepEqual(
    await harness.handlers.get("document:revision")(
      {},
      "C:\\requested\\draft.letterpaper",
    ),
    {
      path: "C:\\authorized\\draft.letterpaper",
      diskRevision: revision,
    },
  );
  assert.deepEqual(harness.calls.authorizations, [
    "C:\\requested\\draft.letterpaper",
  ]);
  assert.deepEqual(harness.calls.readRevisions, [
    "C:\\authorized\\draft.letterpaper",
  ]);
});

test("identity regeneration keeps an existing identity unless force is explicit", async () => {
  const harness = createHarness({
    resolvedPath: "C:\\authorized\\draft.letterpaper",
  });

  assert.deepEqual(
    await harness.handlers.get("document:regenerate-identity")(
      {},
      "C:\\requested\\draft.letterpaper",
    ),
    {
      canceled: false,
      path: "C:\\authorized\\draft.letterpaper",
      documentId: "33333333-3333-4333-8333-333333333333",
      diskRevision: harness.state.snapshot.diskRevision,
      changed: false,
    },
  );
  assert.deepEqual(harness.calls.preserveBackups, []);
  assert.deepEqual(harness.calls.saveDocuments, []);
});

test("identity regeneration upgrades legacy metadata and revision-checks the save target", async () => {
  const revision = { sha256: "e".repeat(64), size: 50, mtimeMs: 75 };
  const harness = createHarness({
    snapshot: {
      document: {
        version: 1,
        documentId: "33333333-3333-4333-8333-333333333333",
        footnotes: "invalid",
        citationSources: [{ id: "source-1" }],
      },
      rawDocument: { version: 1 },
      diskRevision: revision,
    },
    resolvedPath: "C:\\authorized\\legacy.paperdoc",
    migrationBackupPath: "C:\\backups\\legacy-v1.paperdoc",
  });

  const result = await harness.handlers.get("document:regenerate-identity")(
    {},
    "C:\\requested\\legacy.paperdoc",
    true,
  );
  assert.equal(harness.calls.saveDocuments.length, 1);
  const [savePath, nextDocument, saveOptions] = harness.calls.saveDocuments[0];
  assert.equal(savePath, "C:\\authorized\\legacy.paperdoc");
  assert.deepEqual(nextDocument, {
    version: 2,
    documentId: "99999999-9999-4999-8999-999999999999",
    derivedFrom: "33333333-3333-4333-8333-333333333333",
    footnotes: [],
    citationSources: [{ id: "source-1" }],
  });
  await saveOptions.validateTarget("C:\\candidate\\legacy.paperdoc");
  assert.deepEqual(harness.calls.assertDiskRevisions, [[
    "C:\\candidate\\legacy.paperdoc",
    revision,
  ]]);
  assert.deepEqual(result, {
    canceled: false,
    changed: true,
    path: "C:\\authorized\\legacy.paperdoc",
    documentId: "99999999-9999-4999-8999-999999999999",
    document: nextDocument,
    diskRevision: {
      sha256: "c".repeat(64),
      size: 99,
      mtimeMs: 456,
    },
    migrationBackupPath: "C:\\backups\\legacy-v1.paperdoc",
  });
});

test("identity regeneration refuses future schemas before backup or mutation", async () => {
  const harness = createHarness({
    snapshot: {
      document: { version: 3, _readOnlyFutureSchema: true },
      rawDocument: { version: 3 },
      diskRevision: null,
    },
  });

  await assert.rejects(
    harness.handlers.get("document:regenerate-identity")(
      {},
      "C:\\draft.letterpaper",
      true,
    ),
    /未来格式 v3，当前版本只能只读打开/,
  );
  assert.deepEqual(harness.calls.preserveBackups, []);
  assert.deepEqual(harness.calls.saveDocuments, []);
});

test("native open canonicalizes, validates, snapshots, and authorizes the selected document", async () => {
  const snapshot = {
    document: { title: "Future", _readOnlyFutureSchema: true },
    rawDocument: { version: 3 },
    diskRevision: { sha256: "f".repeat(64), size: 100, mtimeMs: 200 },
  };
  const harness = createHarness({
    canonicalPath: "C:\\canonical\\draft.letterpaper",
    snapshot,
  });

  assert.deepEqual(await harness.handlers.get("document:open")(), {
    canceled: false,
    path: "C:\\canonical\\draft.letterpaper",
    document: snapshot.document,
    diskRevision: snapshot.diskRevision,
    readOnly: true,
  });
  assert.deepEqual(harness.calls.openDialogs, [[
    harness.mainWindow,
    {
      title: "打开信笺",
      defaultPath: "C:\\Documents",
      properties: ["openFile"],
      filters: harness.documentFilters,
    },
  ]]);
  assert.deepEqual(harness.calls.canonicalPaths, [[
    "C:\\selected\\draft.letterpaper",
    "file",
  ]]);
  assert.deepEqual(harness.calls.authorizations, [
    "C:\\canonical\\draft.letterpaper",
  ]);
  assert.deepEqual(harness.calls.debugLogs, [[
    "document:open:loaded",
    {
      filePath: "C:\\canonical\\draft.letterpaper",
      loadMs: 7,
    },
  ]]);
});

test("native open preserves cancel and supported-extension rejection behavior", async () => {
  const canceled = createHarness({
    dialogResults: [{ canceled: true }],
  });
  assert.deepEqual(
    await canceled.handlers.get("document:open")(),
    { canceled: true },
  );
  assert.deepEqual(canceled.calls.canonicalPaths, []);

  const unsupported = createHarness({ supported: false });
  await assert.rejects(
    unsupported.handlers.get("document:open")(),
    /请选择 \.letterpaper 或 \.paperdoc 信笺文件/,
  );
  assert.deepEqual(unsupported.calls.snapshots, []);
  assert.deepEqual(unsupported.calls.authorizations, []);
});

test("open-path uses only an authorized path and preserves recovery identity", async () => {
  const snapshot = {
    document: { title: "Recovered" },
    rawDocument: { version: 2 },
    diskRevision: { sha256: "1".repeat(64), size: 9, mtimeMs: 10 },
  };
  const harness = createHarness({
    resolvedPath: "C:\\authorized\\recovery.letterpaper",
    recoveryId: "tab-recovery-1",
    snapshot,
  });

  assert.deepEqual(
    await harness.handlers.get("document:open-path")(
      {},
      "C:\\requested\\recovery.letterpaper",
    ),
    {
      canceled: false,
      path: "C:\\authorized\\recovery.letterpaper",
      document: snapshot.document,
      diskRevision: snapshot.diskRevision,
      readOnly: false,
      recoveryId: "tab-recovery-1",
    },
  );
  assert.deepEqual(harness.calls.resolveDocuments, [
    "C:\\requested\\recovery.letterpaper",
  ]);
  assert.equal(harness.calls.snapshots[0][0], "C:\\authorized\\recovery.letterpaper");
});

test("open-path rejects unsupported input early and bounds reported capability errors", async () => {
  const unsupported = createHarness({ supported: false });
  assert.deepEqual(
    await unsupported.handlers.get("document:open-path")({}, "C:\\draft.txt"),
    { canceled: true },
  );
  assert.deepEqual(unsupported.calls.resolveDocuments, []);

  const longMessage = `denied-${"x".repeat(700)}`;
  const error = Object.assign(new Error(longMessage), { code: "EACCES" });
  const failed = createHarness({ resolveError: error });
  const result = await failed.handlers.get("document:open-path")(
    {},
    "C:\\draft.letterpaper",
  );
  assert.equal(result.canceled, true);
  assert.equal(result.error.length, 500);
  assert.equal(result.error, longMessage.slice(0, 500));
  assert.deepEqual(failed.calls.debugLogs, [[
    "document:open-path:error",
    {
      filePath: "C:\\draft.letterpaper",
      message: longMessage,
      code: "EACCES",
    },
  ]]);
});

test("import accepts only a native-selected canonical source and resets local identities", async () => {
  const harness = createHarness({
    dialogResults: [{
      canceled: false,
      filePaths: ["C:\\selected\\source.md"],
    }],
    canonicalPath: "C:\\canonical\\source.md",
  });

  const result = await harness.handlers.get("document:import")();
  assert.deepEqual(harness.calls.canonicalPaths, [[
    "C:\\selected\\source.md",
    "file",
  ]]);
  assert.deepEqual(harness.calls.importDocuments, [
    { sourcePath: "C:\\canonical\\source.md" },
  ]);
  assert.equal(harness.calls.normalizedDocuments.length, 1);
  const normalizedInput = harness.calls.normalizedDocuments[0];
  assert.equal(normalizedInput.version, 2);
  assert.equal(normalizedInput.documentId, "99999999-9999-4999-8999-999999999999");
  assert.equal(normalizedInput.derivedFrom, "");
  assert.deepEqual(normalizedInput.comments, []);
  assert.deepEqual(normalizedInput.aiState, {});
  assert.equal(normalizedInput.createdAt, normalizedInput.updatedAt);
  assert.match(normalizedInput.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(result, {
    canceled: false,
    sourcePath: "C:\\canonical\\source.md",
    format: "markdown",
    document: { ...normalizedInput, normalized: true },
    warnings: ["import warning"],
  });
});

test("editable export consumes a target capability and commits sidecars before the main file", async () => {
  const consumedTarget = "C:\\authorized\\draft.md";
  const harness = createHarness({ consumedTarget });
  const payload = {
    format: "markdown",
    targetPath: "C:\\selected\\draft",
    document: { title: "Draft", html: "<p>Text</p>" },
  };

  assert.deepEqual(
    await harness.handlers.get("document:export-editable")({}, payload),
    {
      canceled: false,
      path: consumedTarget,
      format: "markdown",
      warnings: ["export warning"],
      assets: 1,
    },
  );
  assert.deepEqual(harness.calls.ensureExtensions, [[
    path.resolve("C:\\selected\\draft"),
    ".md",
  ]]);
  assert.deepEqual(harness.calls.consumedTargets, [[
    path.resolve("C:\\selected\\draft.md"),
    "markdown",
  ]]);
  assert.equal(harness.calls.exportDocuments.length, 1);
  assert.deepEqual(harness.calls.exportDocuments[0], {
    format: "markdown",
    document: {
      title: "Draft",
      html: "<p>Text</p>",
      normalized: true,
    },
    targetPath: consumedTarget,
    baseName: "draft",
  });
  assert.deepEqual(
    harness.calls.atomicWrites.map(([filePath, buffer]) => [
      filePath,
      buffer.toString(),
    ]),
    [
      [path.resolve("C:\\authorized", "assets", "image.png"), "image"],
      [consumedTarget, "main"],
    ],
  );
});

test("editable export preserves picker cancellation, format allowlist, and asset containment", async () => {
  const invalid = createHarness();
  await assert.rejects(
    invalid.handlers.get("document:export-editable")({}, { format: "pdf" }),
    /不支持的可编辑导出格式/,
  );
  assert.deepEqual(invalid.calls.consumedTargets, []);

  const canceled = createHarness({ pickedExportPath: "" });
  assert.deepEqual(
    await canceled.handlers.get("document:export-editable")({}, {
      format: "html",
      document: { title: "Picked" },
    }),
    { canceled: true },
  );
  assert.deepEqual(canceled.calls.pickerExports, [["html", "Picked"]]);
  assert.deepEqual(canceled.calls.consumedTargets, []);

  const escaping = createHarness({ assetInside: false });
  await assert.rejects(
    escaping.handlers.get("document:export-editable")({}, {
      format: "markdown",
      targetPath: "C:\\exports\\draft.md",
      document: {},
    }),
    /导出资源路径越过目标文件夹/,
  );
  assert.deepEqual(escaping.calls.atomicWrites, []);
});

test("main delegates document-open handlers through the storage facade", async () => {
  const [source, documentOpenSource] = await Promise.all([
    fsPromises.readFile(path.join(__dirname, "main.cjs"), "utf8"),
    fsPromises.readFile(path.join(__dirname, "document-open-ipc.cjs"), "utf8"),
  ]);
  assert.match(source, /require\("\.\/document-open-ipc\.cjs"\)/);
  assert.match(source, /registerDocumentOpenIpcHandlers\(\{/);
  assert.match(
    source,
    /registerDocumentOpenIpcHandlers\(\{[\s\S]*?storageFacade,/,
  );
  assert.doesNotMatch(
    source,
    /ipcMain\.handle\("document:(?:revision|regenerate-identity|open|open-path|import|export-editable)"/,
  );
  assert.doesNotMatch(
    documentOpenSource,
    /ipcMain\.handle\("document:(?:create-in-folder|backup|save|pick-export-path|export-pdf|export-page-images)"/,
  );
  assert.match(source, /registerDocumentSaveIpcHandlers\(\{/);
  assert.match(source, /registerDocumentOutputIpcHandlers\(\{/);
});
