const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
  registerAutosaveIpcHandlers,
} = require("./autosave-ipc.cjs");

const AUTOSAVE_CHANNELS = [
  "autosave:clear",
  "autosave:delete-tab",
  "autosave:load",
  "autosave:save",
  "autosave:save-tab",
];

function createHarness(options = {}) {
  const handlers = new Map();
  const calls = {
    access: [],
    invalidations: [],
    loads: [],
    mutations: 0,
    removes: [],
    saves: [],
    sessionIds: [],
  };

  registerAutosaveIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
        handlers.set(channel, handler);
      },
    },
    storageFacade: {
      async loadAutosave() {
        const filePath =
          "C:\\user-data\\autosave.letterpaper";
        calls.access.push(filePath);
        if (options.accessError) {
          return { exists: false };
        }
        calls.loads.push(filePath);
        if (options.loadError) return { exists: false };
        return {
          exists: true,
          path: filePath,
          document:
            options.loadedDocument
            || { title: "Recovered autosave" },
        };
      },
      async saveAutosave(document) {
        calls.saves.push([
          "C:\\user-data\\autosave.letterpaper",
          document,
        ]);
        if (options.saveError) throw options.saveError;
        return {
          path: "C:\\user-data\\autosave.letterpaper",
          document:
            options.savedDocument
            || {
              ...document,
              updatedAt: "2026-07-25T12:00:00.000Z",
            },
        };
      },
      async saveAutosaveTab(document, tabId) {
        calls.sessionIds.push(tabId);
        if (options.sessionPathError) {
          throw options.sessionPathError;
        }
        const filePath =
          `C:\\user-data\\sessions\\${tabId}.letterpaper`;
        calls.saves.push([filePath, document]);
        return {
          canceled: false,
          path: filePath,
          recoveryId: tabId,
          document:
            options.savedDocument || document,
        };
      },
      async deleteAutosaveTab(tabId) {
        calls.mutations += 1;
        const filePath =
          `C:\\user-data\\sessions\\${tabId}.letterpaper`;
        calls.removes.push([filePath, { force: true }]);
        calls.invalidations.push([
          filePath,
          false,
          { revokeReferences: true },
        ]);
        return { ok: true };
      },
      async clearAutosave() {
        calls.mutations += 1;
        calls.removes.push([
          "C:\\user-data\\autosave.letterpaper",
          { force: true },
        ]);
        calls.invalidations.push([
          "C:\\user-data\\autosave.letterpaper",
          false,
          { revokeReferences: true },
        ]);
        return { ok: true };
      },
    },
  });

  return { calls, handlers };
}

test("registers exactly the autosave IPC surface", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()].sort(), AUTOSAVE_CHANNELS);
});

test("autosave load preserves exists, path, document, and missing fallbacks", async () => {
  const loaded = createHarness({
    loadedDocument: { title: "Recovered" },
  });
  assert.deepEqual(await loaded.handlers.get("autosave:load")(), {
    exists: true,
    path: "C:\\user-data\\autosave.letterpaper",
    document: { title: "Recovered" },
  });
  assert.deepEqual(loaded.calls.access, [
    "C:\\user-data\\autosave.letterpaper",
  ]);
  assert.deepEqual(loaded.calls.loads, [
    "C:\\user-data\\autosave.letterpaper",
  ]);

  const missing = createHarness({
    accessError: Object.assign(new Error("missing"), { code: "ENOENT" }),
  });
  assert.deepEqual(
    await missing.handlers.get("autosave:load")(),
    { exists: false },
  );
  assert.deepEqual(missing.calls.loads, []);

  const unreadable = createHarness({
    loadError: new Error("corrupt"),
  });
  assert.deepEqual(
    await unreadable.handlers.get("autosave:load")(),
    { exists: false },
  );
});

test("autosave save forwards the document and returns the committed normalized document", async () => {
  const input = {
    title: "Editing snapshot",
    updatedAt: "2026-07-25T11:59:00.000Z",
  };
  const committed = {
    title: "Editing snapshot",
    updatedAt: "2026-07-25T12:00:00.000Z",
  };
  const harness = createHarness({ savedDocument: committed });

  assert.deepEqual(
    await harness.handlers.get("autosave:save")({}, input),
    {
      path: "C:\\user-data\\autosave.letterpaper",
      document: committed,
    },
  );
  assert.equal(harness.calls.saves[0][0], "C:\\user-data\\autosave.letterpaper");
  assert.equal(harness.calls.saves[0][1], input);
});

test("tab autosave derives recoveryId from the validated session path", async () => {
  const committed = { title: "Tab snapshot" };
  const harness = createHarness({ savedDocument: committed });

  assert.deepEqual(
    await harness.handlers.get("autosave:save-tab")(
      {},
      { title: "Tab" },
      "tab-42",
    ),
    {
      canceled: false,
      path: "C:\\user-data\\sessions\\tab-42.letterpaper",
      recoveryId: "tab-42",
      document: committed,
    },
  );
  assert.deepEqual(harness.calls.sessionIds, ["tab-42"]);
  assert.equal(
    harness.calls.saves[0][0],
    "C:\\user-data\\sessions\\tab-42.letterpaper",
  );
});

test("tab deletion stays in the shared mutation and revokes document resources", async () => {
  const harness = createHarness();

  assert.deepEqual(
    await harness.handlers.get("autosave:delete-tab")({}, "tab-7"),
    { ok: true },
  );
  assert.equal(harness.calls.mutations, 1);
  assert.deepEqual(harness.calls.removes, [[
    "C:\\user-data\\sessions\\tab-7.letterpaper",
    { force: true },
  ]]);
  assert.deepEqual(harness.calls.invalidations, [[
    "C:\\user-data\\sessions\\tab-7.letterpaper",
    false,
    { revokeReferences: true },
  ]]);
});

test("clear stays in the shared mutation, tolerates remove failures, and revokes caches", async () => {
  const harness = createHarness({
    removeError: new Error("already removed"),
  });

  assert.deepEqual(
    await harness.handlers.get("autosave:clear")(),
    { ok: true },
  );
  assert.equal(harness.calls.mutations, 1);
  assert.deepEqual(harness.calls.removes, [[
    "C:\\user-data\\autosave.letterpaper",
    { force: true },
  ]]);
  assert.deepEqual(harness.calls.invalidations, [[
    "C:\\user-data\\autosave.letterpaper",
    false,
    { revokeReferences: true },
  ]]);
});

test("main delegates autosave handlers to the single storage facade", async () => {
  const source = await fsPromises.readFile(path.join(__dirname, "main.cjs"), "utf8");
  const runtimeSource = await fsPromises.readFile(
    path.join(__dirname, "document-storage-runtime.cjs"),
    "utf8",
  );
  assert.match(source, /require\("\.\/autosave-ipc\.cjs"\)/);
  assert.match(source, /registerAutosaveIpcHandlers\(\{/);
  assert.match(
    source,
    /registerAutosaveIpcHandlers\(\{\s*ipcMain,\s*storageFacade,/,
  );
  assert.match(runtimeSource, /function autosavePath\(\)/);
  assert.match(runtimeSource, /function autosaveSessionPath\(tabId = ""\)/);
  assert.match(runtimeSource, /function runDocumentTransaction\(task\)/);
  assert.doesNotMatch(source, /ipcMain\.handle\("autosave:/);
});
