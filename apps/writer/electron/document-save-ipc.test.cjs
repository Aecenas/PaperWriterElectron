const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
  registerDocumentSaveIpcHandlers,
} = require("./document-save-ipc.cjs");

const REVISION_CONFLICT_CODE = "DOCUMENT_REVISION_CONFLICT";
const SAVE_CHANNELS = [
  "document:backup",
  "document:create-in-folder",
  "document:save",
];

class TestDocumentRevisionConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "DocumentRevisionConflictError";
    this.code = REVISION_CONFLICT_CODE;
    Object.assign(this, details);
  }
}

function enoent(message = "missing") {
  return Object.assign(new Error(message), { code: "ENOENT" });
}

function validUuid(number) {
  const tail = String(number).padStart(12, "0");
  return `11111111-1111-4111-8111-${tail}`;
}

function createHarness(options = {}) {
  const handlers = new Map();
  const mainWindow = { id: "main-window" };
  const randomIds = [...(options.randomIds || [
    validUuid(1),
    validUuid(2),
    validUuid(3),
    validUuid(4),
  ])];
  const statResults = [...(options.statResults || [])];
  const withinSaveResults = [...(options.withinSaveResults || [])];
  const calls = {
    assertAuthorizedDirectories: [],
    assertAuthorizedDocuments: [],
    assertDiskRevisions: [],
    authorizeDocuments: [],
    conflictPaths: [],
    debugSequence: [],
    dialogSaves: [],
    ensureExtensions: [],
    folderLists: [],
    migrationBackups: [],
    mutableEntries: [],
    mutations: 0,
    normalizeDocuments: [],
    normalizeIds: [],
    readRevisions: [],
    rebaseAssets: [],
    resolveTargets: [],
    saveDocuments: [],
    saveWithin: [],
    statPaths: [],
    uniquePaths: [],
  };
  const sourceSnapshot = options.sourceSnapshot || {
    document: {
      version: 2,
      documentId: validUuid(100),
      derivedFrom: "",
      title: "Original",
      footnotes: [],
      citationSources: [],
    },
    rawDocument: {
      version: 2,
      documentId: validUuid(100),
    },
    diskRevision: {
      size: 100,
      mtimeMs: 10,
      sha256: "a".repeat(64),
    },
  };
  const storageTransaction = {
    async assertDiskRevision(...args) {
      calls.assertDiskRevisions.push(args);
      if (options.assertDiskRevisionImplementation) {
        return options.assertDiskRevisionImplementation(
          ...args,
          calls.assertDiskRevisions.length,
        );
      }
      return undefined;
    },
    createConflictCopyPath(filePath, config = {}) {
      calls.conflictPaths.push([filePath, config]);
      return `${filePath}.conflict-${config.sequence || 0}.letterpaper`;
    },
    async loadPaperDocumentSnapshot(filePath) {
      if (options.snapshotError) throw options.snapshotError;
      assert.equal(
        filePath,
        options.authorizedDocument || filePath,
      );
      return sourceSnapshot;
    },
    async preservePreV2MigrationBackup(filePath) {
      calls.migrationBackups.push(filePath);
      return Object.hasOwn(options, "migrationBackupPath")
        ? options.migrationBackupPath
        : `${filePath}.pre-v2.backup`;
    },
    async readDiskRevision(filePath) {
      calls.readRevisions.push(filePath);
      return options.actualRevision || {
        size: 300,
        mtimeMs: 30,
        sha256: "c".repeat(64),
      };
    },
    rebaseDocumentPath(...args) {
      calls.rebaseAssets.push(args);
    },
    async savePaperDocument(...args) {
      if (calls.resolveTargets.length === 0) {
        calls.saveWithin.push(args);
        calls.debugSequence.push(
          `saveWithin:${args[0]}`,
        );
        if (options.saveWithinImplementation) {
          return options.saveWithinImplementation(...args);
        }
        if (
          options.invokeWithinValidation
          && typeof args[2]?.validateTarget === "function"
        ) {
          await args[2].validateTarget(args[0]);
        }
        const result = withinSaveResults.shift();
        return result || {
          document: args[1],
          diskRevision: {
            size: 200,
            mtimeMs: 20,
            sha256: "b".repeat(64),
          },
        };
      }
      calls.saveDocuments.push(args);
      if (options.saveImplementation) {
        return options.saveImplementation(
          ...args,
          calls.saveDocuments.length,
        );
      }
      if (
        options.invokeWithinValidation
        && typeof args[2]?.validateTarget === "function"
      ) {
        await args[2].validateTarget(args[0]);
      }
      if (typeof args[2]?.afterCommit === "function") {
        await args[2].afterCommit();
      }
      return {
        document: {
          ...args[1],
          updatedAt: "2026-07-25T12:00:00.000Z",
        },
        diskRevision: {
          size: 400,
          mtimeMs: 40,
          sha256: "d".repeat(64),
        },
      };
    },
  };

  registerDocumentSaveIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
        handlers.set(channel, handler);
      },
    },
    documentModel: {
      DOCUMENT_EXTENSION: ".letterpaper",
      DOCUMENT_SCHEMA_VERSION: 2,
      DOCUMENT_FILTERS: [{
        name: "笺间文档",
        extensions: ["letterpaper"],
      }],
      sanitizeName(value, fallback) {
        return String(value || fallback).replace(/[<>]/g, "");
      },
      normalizeDocument(document) {
        calls.normalizeDocuments.push(document);
        return {
          ...document,
          title: String(document?.title || "未命名信笺"),
          normalized: true,
        };
      },
      normalizeDocumentId(value) {
        calls.normalizeIds.push(value);
        const normalized = String(value || "").toLowerCase();
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
          ? normalized
          : "";
      },
      isSupportedDocument(filePath) {
        if (Object.hasOwn(options, "supported")) return options.supported;
        return [".letterpaper", ".paperdoc"].includes(
          path.extname(String(filePath || "")).toLowerCase(),
        );
      },
      timestampForFileName() {
        return "20260725-120000";
      },
    },
    revisionConflictCode: REVISION_CONFLICT_CODE,
    storageFacade: {
      DocumentRevisionConflictError:
        TestDocumentRevisionConflictError,
      async runDocumentTransaction(operation) {
        calls.mutations += 1;
        calls.debugSequence.push("mutation:start");
        const result = await operation(storageTransaction);
        calls.debugSequence.push("mutation:end");
        return result;
      },
    },
    async assertAuthorizedDirectory(folderPath) {
      calls.assertAuthorizedDirectories.push(folderPath);
      return options.authorizedFolder || folderPath;
    },
    assertMutableWorkspaceEntry(filePath) {
      calls.mutableEntries.push(filePath);
    },
    async uniquePath(filePath) {
      calls.uniquePaths.push(filePath);
      calls.debugSequence.push(`unique:${filePath}`);
      return options.uniquePath || filePath;
    },
    path,
    randomUUID() {
      return randomIds.shift() || validUuid(999);
    },
    async listFolderEntries(folderPath) {
      calls.folderLists.push(["all", folderPath]);
      return {
        folderPath,
        parentPath: path.dirname(folderPath),
        folders: [],
        files: [{ path: "listed" }],
        entries: [{ path: "listed" }],
      };
    },
    async assertAuthorizedDocument(filePath) {
      calls.assertAuthorizedDocuments.push(filePath);
      return options.authorizedDocument || filePath;
    },
    async authorizeDocumentPath(...args) {
      calls.authorizeDocuments.push(args);
    },
    async listAuthorizedFolderEntries(folderPath) {
      calls.folderLists.push(["authorized", folderPath]);
      return {
        folderPath,
        parentPath: path.dirname(folderPath),
        folders: [],
        files: [{ path: "authorized-listing" }],
        entries: [{ path: "authorized-listing" }],
      };
    },
    sanitizeFilesystemName(value, fallback) {
      return String(value || fallback).replace(/[<>]/g, "");
    },
    dialog: {
      async showSaveDialog(...args) {
        calls.dialogSaves.push(args);
        return options.dialogResult || {
          canceled: false,
          filePath: "C:\\selected\\saved-copy",
        };
      },
    },
    getMainWindow() {
      return mainWindow;
    },
    defaultDocumentsDir() {
      return "C:\\Documents";
    },
    ensureExtension(filePath, extension) {
      calls.ensureExtensions.push([filePath, extension]);
      return filePath.toLowerCase().endsWith(extension)
        ? filePath
        : `${filePath}${extension}`;
    },
    async resolveDocumentTargetPath(filePath) {
      calls.resolveTargets.push(filePath);
      return options.resolvedTarget || path.resolve(String(filePath));
    },
    platform: "win32",
    async assertAuthorizedDocumentTarget(filePath) {
      calls.assertAuthorizedDocuments.push(filePath);
      return options.authorizedTarget || filePath;
    },
    fs: {
      async stat(filePath) {
        calls.statPaths.push(filePath);
        if (statResults.length) {
          const result = statResults.shift();
          if (result instanceof Error) throw result;
          return result;
        }
        return {
          isFile: () => true,
          dev: 10,
          ino: 20,
        };
      },
      async access(filePath) {
        if (options.accessImplementation) {
          return options.accessImplementation(filePath);
        }
        throw enoent();
      },
    },
  });

  return {
    calls,
    handlers,
    mainWindow,
    sourceSnapshot,
  };
}

test("registers exactly create, backup, and save document IPC", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()].sort(), SAVE_CHANNELS);
});

test("create-in-folder chooses and commits a unique path inside one shared mutation", async () => {
  const missing = createHarness();
  assert.deepEqual(
    await missing.handlers.get("document:create-in-folder")({}, "", "Draft"),
    { ok: false, message: "缺少目标文件夹" },
  );
  assert.equal(missing.calls.mutations, 0);

  const harness = createHarness({
    authorizedFolder: "C:\\workspace",
    uniquePath: "C:\\workspace\\Draft (2).letterpaper",
  });
  const template = {
    title: "Old",
    html: "<p>Old</p>",
    documentId: "invalid-id",
    derivedFrom: validUuid(500),
  };
  const result = await harness.handlers.get("document:create-in-folder")(
    {},
    "C:\\requested",
    "Draft",
    template,
  );

  assert.equal(harness.calls.mutations, 1);
  assert.deepEqual(harness.calls.mutableEntries, ["C:\\workspace"]);
  assert.deepEqual(harness.calls.uniquePaths, [
    "C:\\workspace\\Draft.letterpaper",
  ]);
  assert.equal(harness.calls.saveWithin.length, 1);
  assert.ok(
    harness.calls.debugSequence.indexOf("unique:C:\\workspace\\Draft.letterpaper")
      < harness.calls.debugSequence.indexOf(
        "saveWithin:C:\\workspace\\Draft (2).letterpaper",
      ),
  );
  const [savedPath, savedDocument] = harness.calls.saveWithin[0];
  assert.equal(savedPath, "C:\\workspace\\Draft (2).letterpaper");
  assert.equal(savedDocument.version, 2);
  assert.equal(savedDocument.documentId, validUuid(1));
  assert.equal(savedDocument.derivedFrom, "");
  assert.equal(savedDocument.title, "Draft");
  assert.equal(savedDocument.html, "<p></p>");
  assert.deepEqual(result, {
    ok: true,
    path: "C:\\workspace\\Draft (2).letterpaper",
    document: savedDocument,
    diskRevision: {
      size: 200,
      mtimeMs: 20,
      sha256: "b".repeat(64),
    },
    folderPath: "C:\\workspace",
    parentPath: "C:\\",
    folders: [],
    files: [{ path: "listed" }],
    entries: [{ path: "listed" }],
  });
});

test("backup migrates a pre-v2 source under the same mutation before deriving a new identity", async () => {
  const sourceRevision = {
    size: 100,
    mtimeMs: 10,
    sha256: "a".repeat(64),
  };
  const migratedRevision = {
    size: 110,
    mtimeMs: 11,
    sha256: "e".repeat(64),
  };
  const backupRevision = {
    size: 120,
    mtimeMs: 12,
    sha256: "f".repeat(64),
  };
  const harness = createHarness({
    authorizedDocument: "C:\\workspace\\legacy.paperdoc",
    uniquePath: "C:\\workspace\\legacy_备份_20260725-120000.letterpaper",
    sourceSnapshot: {
      document: {
        version: 1,
        documentId: "",
        derivedFrom: "invalid",
        title: "Legacy",
        footnotes: "invalid",
        citationSources: null,
      },
      rawDocument: { version: 1, documentId: "" },
      diskRevision: sourceRevision,
    },
    migrationBackupPath: "C:\\migration\\legacy.paperdoc",
    randomIds: [validUuid(10), validUuid(11)],
    invokeWithinValidation: true,
    withinSaveResults: [
      {
        document: {
          version: 2,
          documentId: validUuid(10),
          derivedFrom: "",
          title: "Legacy",
          footnotes: [],
          citationSources: [],
        },
        diskRevision: migratedRevision,
      },
      {
        document: { title: "Legacy（备份）" },
        diskRevision: backupRevision,
      },
    ],
  });

  const result = await harness.handlers.get("document:backup")(
    {},
    "C:\\requested\\legacy.paperdoc",
  );

  assert.equal(harness.calls.mutations, 1);
  assert.deepEqual(harness.calls.migrationBackups, [
    "C:\\workspace\\legacy.paperdoc",
  ]);
  assert.equal(harness.calls.saveWithin.length, 2);
  const [migrationPath, migrationDocument, migrationOptions] = harness.calls.saveWithin[0];
  assert.equal(migrationPath, "C:\\workspace\\legacy.paperdoc");
  assert.deepEqual(migrationDocument, {
    version: 2,
    documentId: validUuid(10),
    derivedFrom: "",
    title: "Legacy",
    footnotes: [],
    citationSources: [],
  });
  assert.equal(typeof migrationOptions.validateTarget, "function");
  assert.deepEqual(harness.calls.assertDiskRevisions, [[
    "C:\\workspace\\legacy.paperdoc",
    sourceRevision,
  ]]);
  const [backupPath, backupDocument] = harness.calls.saveWithin[1];
  assert.equal(
    backupPath,
    "C:\\workspace\\legacy_备份_20260725-120000.letterpaper",
  );
  assert.equal(backupDocument.documentId, validUuid(11));
  assert.equal(backupDocument.derivedFrom, validUuid(10));
  assert.equal(backupDocument.title, "Legacy（备份）");
  assert.deepEqual(harness.calls.authorizeDocuments, [[backupPath]]);
  assert.equal(result.migrationBackupPath, "C:\\migration\\legacy.paperdoc");
  assert.equal(result.sourceDiskRevision, migratedRevision);
  assert.equal(result.diskRevision, backupRevision);
});

test("backup rejects unsupported and future-schema documents before writing", async () => {
  const unsupported = createHarness({ supported: false });
  assert.deepEqual(
    await unsupported.handlers.get("document:backup")({}, "C:\\draft.txt"),
    { ok: false, message: "只能备份信笺文件" },
  );
  assert.equal(unsupported.calls.mutations, 0);

  const future = createHarness({
    sourceSnapshot: {
      document: { version: 3, _readOnlyFutureSchema: true },
      rawDocument: { version: 3 },
      diskRevision: null,
    },
  });
  await assert.rejects(
    future.handlers.get("document:backup")({}, "C:\\draft.letterpaper"),
    /未来格式 v3，当前版本不能复制备份/,
  );
  assert.deepEqual(future.calls.saveWithin, []);
});

test("normal save keeps the editor snapshot identity and checks expected revision before and during commit", async () => {
  const expectedRevision = {
    size: 42,
    mtimeMs: 1234,
    sha256: "1".repeat(64),
  };
  const input = {
    version: 2,
    documentId: validUuid(200),
    title: "Live editor",
    updatedAt: "2026-07-25T11:59:59.000Z",
  };
  const committed = {
    ...input,
    updatedAt: "2026-07-25T12:00:00.000Z",
  };
  const stableStat = {
    isFile: () => true,
    dev: 10,
    ino: 20,
  };
  const harness = createHarness({
    statResults: [stableStat, stableStat],
    migrationBackupPath: "C:\\migration\\draft-v1.letterpaper",
    saveImplementation: async (filePath, document, saveOptions) => {
      assert.equal(document, input);
      await saveOptions.validateTarget(filePath);
      assert.equal(saveOptions.afterCommit, undefined);
      return {
        document: committed,
        diskRevision: {
          size: 55,
          mtimeMs: 5678,
          sha256: "2".repeat(64),
        },
      };
    },
  });

  const result = await harness.handlers.get("document:save")(
    {},
    input,
    "C:\\workspace\\draft.letterpaper",
    false,
    [],
    expectedRevision,
    { conflictAction: "overwrite" },
  );

  assert.deepEqual(harness.calls.assertDiskRevisions, [
    ["C:\\workspace\\draft.letterpaper", expectedRevision],
    ["C:\\workspace\\draft.letterpaper", expectedRevision],
  ]);
  assert.equal(harness.calls.saveDocuments[0][1], input);
  assert.equal(input.updatedAt, "2026-07-25T11:59:59.000Z");
  assert.deepEqual(result, {
    canceled: false,
    path: "C:\\workspace\\draft.letterpaper",
    document: committed,
    diskRevision: {
      size: 55,
      mtimeMs: 5678,
      sha256: "2".repeat(64),
    },
    migrationBackupPath: "C:\\migration\\draft-v1.letterpaper",
  });
});

test("save rejects future-schema state and another open tab target before any write", async () => {
  const future = createHarness();
  await assert.rejects(
    future.handlers.get("document:save")(
      {},
      { version: 3, _readOnlyFutureSchema: true },
      "C:\\workspace\\draft.letterpaper",
      false,
    ),
    /未来格式 v3，当前版本只能只读打开/,
  );
  assert.deepEqual(future.calls.resolveTargets, []);

  const reserved = createHarness();
  await assert.rejects(
    reserved.handlers.get("document:save")(
      {},
      { version: 2, title: "Draft" },
      "C:\\workspace\\Draft.letterpaper",
      false,
      ["C:\\WORKSPACE\\draft.letterpaper"],
    ),
    /该保存位置已被另一个打开的标签占用/,
  );
  assert.deepEqual(reserved.calls.assertAuthorizedDocuments, []);
  assert.deepEqual(reserved.calls.saveDocuments, []);
});

test("Save As authorizes a new target, derives a new identity, and rebases assets only after commit", async () => {
  const input = {
    version: 2,
    documentId: validUuid(300),
    title: "Original",
    updatedAt: "editor-revision",
  };
  const harness = createHarness({
    dialogResult: {
      canceled: false,
      filePath: "C:\\selected\\copy",
    },
    resolvedTarget: "C:\\selected\\copy.letterpaper",
    statResults: [enoent(), enoent()],
    randomIds: [validUuid(301)],
    saveImplementation: async (filePath, document, saveOptions) => {
      await saveOptions.validateTarget(filePath);
      assert.equal(typeof saveOptions.afterCommit, "function");
      await saveOptions.afterCommit();
      return {
        document: { ...document, updatedAt: "committed-revision" },
        diskRevision: {
          size: 80,
          mtimeMs: 90,
          sha256: "3".repeat(64),
        },
      };
    },
  });

  const result = await harness.handlers.get("document:save")(
    {},
    input,
    "C:\\workspace\\original.letterpaper",
    true,
    [],
    { sha256: "old" },
  );

  assert.deepEqual(harness.calls.ensureExtensions, [[
    "C:\\selected\\copy",
    ".letterpaper",
  ]]);
  assert.deepEqual(harness.calls.authorizeDocuments, [[
    "C:\\selected\\copy.letterpaper",
    { mustExist: false },
  ]]);
  assert.deepEqual(harness.calls.assertDiskRevisions, []);
  const savedCopy = harness.calls.saveDocuments[0][1];
  assert.equal(savedCopy.version, 2);
  assert.equal(savedCopy.documentId, validUuid(301));
  assert.equal(savedCopy.derivedFrom, validUuid(300));
  assert.deepEqual(harness.calls.rebaseAssets, [[
    "C:\\workspace\\original.letterpaper",
    "C:\\selected\\copy.letterpaper",
  ]]);
  assert.equal(result.document.updatedAt, "committed-revision");
});

test("an initial revision conflict creates and authorizes a separate identity-safe copy", async () => {
  const expectedRevision = {
    size: 10,
    mtimeMs: 1,
    sha256: "4".repeat(64),
  };
  const actualRevision = {
    size: 11,
    mtimeMs: 2,
    sha256: "5".repeat(64),
  };
  const conflict = Object.assign(new Error("external change"), {
    code: REVISION_CONFLICT_CODE,
    expectedRevision,
    actualRevision,
  });
  const input = {
    version: 2,
    documentId: validUuid(400),
    title: "Draft",
  };
  const harness = createHarness({
    assertDiskRevisionImplementation: () => {
      throw conflict;
    },
    randomIds: [validUuid(401)],
  });

  const result = await harness.handlers.get("document:save")(
    {},
    input,
    "C:\\workspace\\draft.letterpaper",
    false,
    [],
    expectedRevision,
  );

  assert.equal(result.conflict, true);
  assert.equal(result.code, REVISION_CONFLICT_CODE);
  assert.equal(
    result.conflictCopyPath,
    "C:\\workspace\\draft.letterpaper.conflict-0.letterpaper",
  );
  assert.equal(result.conflictDocument.documentId, validUuid(401));
  assert.equal(result.conflictDocument.derivedFrom, validUuid(400));
  assert.equal(result.conflictDocument.title, "Draft（本机冲突副本）");
  assert.equal(result.expectedRevision, expectedRevision);
  assert.equal(result.actualRevision, actualRevision);
  assert.deepEqual(harness.calls.authorizeDocuments, [[
    result.conflictCopyPath,
  ]]);
  assert.deepEqual(harness.calls.migrationBackups, []);
});

test("a target replacement during save creates a conflict copy without overwriting the replacement", async () => {
  const stable = {
    isFile: () => true,
    dev: 1,
    ino: 2,
  };
  const replacement = {
    isFile: () => true,
    dev: 9,
    ino: 10,
  };
  const actualRevision = {
    size: 999,
    mtimeMs: 999,
    sha256: "9".repeat(64),
  };
  const input = {
    version: 2,
    documentId: validUuid(500),
    title: "Draft",
  };
  const harness = createHarness({
    statResults: [stable, replacement],
    actualRevision,
    randomIds: [validUuid(501)],
    saveImplementation: async (filePath, document, saveOptions, callNumber) => {
      if (callNumber === 1) {
        await saveOptions.validateTarget(filePath);
        assert.fail("replacement validation should throw");
      }
      return {
        document,
        diskRevision: {
          size: 50,
          mtimeMs: 5,
          sha256: "6".repeat(64),
        },
      };
    },
  });

  const result = await harness.handlers.get("document:save")(
    {},
    input,
    "C:\\workspace\\draft.letterpaper",
    false,
    [],
    { sha256: "expected" },
  );

  assert.equal(result.conflict, true);
  assert.equal(result.actualRevision, actualRevision);
  assert.equal(harness.calls.saveDocuments.length, 2);
  assert.equal(
    harness.calls.saveDocuments[1][0],
    "C:\\workspace\\draft.letterpaper.conflict-0.letterpaper",
  );
});

test("a same-name file appearing during Save As aborts instead of overwriting or creating a conflict copy", async () => {
  const appeared = {
    isFile: () => true,
    dev: 7,
    ino: 8,
  };
  const harness = createHarness({
    dialogResult: {
      canceled: false,
      filePath: "C:\\selected\\new.letterpaper",
    },
    statResults: [enoent(), appeared],
    saveImplementation: async (filePath, _document, saveOptions) => {
      await saveOptions.validateTarget(filePath);
      assert.fail("new target validation should throw");
    },
  });

  await assert.rejects(
    harness.handlers.get("document:save")(
      {},
      { version: 2, title: "Draft" },
      "",
      true,
    ),
    (error) => {
      assert.equal(error.code, REVISION_CONFLICT_CODE);
      assert.match(error.message, /保存期间目标位置出现了同名文件/);
      return true;
    },
  );
  assert.equal(harness.calls.saveDocuments.length, 1);
  assert.deepEqual(harness.calls.conflictPaths, []);
});

test("main delegates save handlers through one storage facade", async () => {
  const source = await fsPromises.readFile(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(source, /require\("\.\/document-save-ipc\.cjs"\)/);
  assert.match(source, /registerDocumentSaveIpcHandlers\(\{/);
  assert.match(
    source,
    /registerDocumentSaveIpcHandlers\(\{[\s\S]*?storageFacade,/,
  );
  assert.doesNotMatch(source, /savePaperDocumentWithinMutation/);
  assert.doesNotMatch(source, /runDocumentMutation/);
  assert.doesNotMatch(source, /ipcMain\.handle\(/);
  assert.doesNotMatch(
    source,
    /ipcMain\.handle\("document:(?:create-in-folder|backup|save)"/,
  );
});
