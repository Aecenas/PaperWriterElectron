const assert = require("node:assert/strict");
const test = require("node:test");

const {
  registerDocumentHistoryIpcHandlers,
} = require("./document-history-ipc.cjs");

function createHarness() {
  const handlers = new Map();
  const calls = [];
  const historyFacade = {
    async list(...args) { calls.push(["list", ...args]); return []; },
    async read(...args) { calls.push(["read", ...args]); return { entry: {} }; },
    async createSnapshot(...args) { calls.push(["create", ...args]); return { entry: {} }; },
    async updateEntry(...args) { calls.push(["update", ...args]); return {}; },
    async remove(...args) { calls.push(["remove", ...args]); return { ok: true }; },
    async restore(...args) { calls.push(["restore", ...args]); return { ok: true }; },
    async clearAuto(...args) { calls.push(["clear", ...args]); return { ok: true }; },
    async clear(...args) { calls.push(["clear-all", ...args]); return { ok: true }; },
  };
  registerDocumentHistoryIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false);
        handlers.set(channel, handler);
      },
    },
    historyFacade,
    assertAuthorizedDocument: async (filePath) => {
      calls.push(["authorize", filePath]);
      return `authorized:${filePath}`;
    },
    createDocumentSnapshot: async (payload) => {
      calls.push(["create-document", payload]);
      return { entry: { id: "memory-entry" } };
    },
  });
  return { handlers, calls };
}

test("history IPC exposes the complete bounded contract", async () => {
  const { handlers, calls } = createHarness();
  assert.deepEqual([...handlers.keys()].sort(), [
    "history:clear",
    "history:clear-auto",
    "history:create",
    "history:delete",
    "history:list",
    "history:pin",
    "history:read",
    "history:restore",
  ]);
  await handlers.get("history:create")({}, {
    documentId: "doc-1",
    filePath: "C:\\draft.letterpaper",
    name: "manual",
    pinned: true,
  });
  assert.deepEqual(calls.slice(0, 2), [
    ["authorize", "C:\\draft.letterpaper"],
    ["create", {
      documentId: "doc-1",
      filePath: "authorized:C:\\draft.letterpaper",
      kind: "manual",
      name: "manual",
      pinned: true,
    }],
  ]);

  await handlers.get("history:restore")({}, {
    documentId: "doc-1",
    entryId: "entry-1",
    targetPath: "C:\\draft.letterpaper",
    expectedRevision: {
      size: 100,
      mtimeMs: 1234,
      sha256: "a".repeat(64),
    },
  });
  assert.equal(calls.at(-2)[0], "authorize");
  assert.deepEqual(calls.at(-1), ["restore", {
    documentId: "doc-1",
    entryId: "entry-1",
    targetPath: "authorized:C:\\draft.letterpaper",
    expectedRevision: {
      size: 100,
      mtimeMs: 1234,
      sha256: "a".repeat(64),
    },
  }]);

  await handlers.get("history:list")({}, "doc-1", "b".repeat(64));
  assert.deepEqual(calls.at(-1), ["list", "doc-1", {
    excludeAutoSha256: "b".repeat(64),
  }]);
  await handlers.get("history:clear")({}, "doc-1");
  assert.deepEqual(calls.at(-1), ["clear-all", "doc-1"]);
});

test("history IPC can snapshot an in-memory unsaved document without path authorization", async () => {
  const { handlers, calls } = createHarness();
  const document = {
    version: 3,
    documentId: "doc-memory",
    html: "<p>AI 应用前正文</p>",
  };
  const result = await handlers.get("history:create")({}, {
    documentId: "doc-memory",
    document,
    name: "AI 应用前",
  });
  assert.equal(result.ok, true);
  assert.equal(result.entry.id, "memory-entry");
  assert.deepEqual(calls, [[
    "create-document",
    {
      documentId: "doc-memory",
      document,
      name: "AI 应用前",
      pinned: false,
    },
  ]]);
});

test("history IPC normalizes null payloads and rejects malformed revisions", async () => {
  const { handlers, calls } = createHarness();
  await handlers.get("history:read")({}, null);
  await handlers.get("history:pin")({}, null);
  await handlers.get("history:delete")({}, null);
  assert.deepEqual(calls.slice(0, 3), [
    ["read", "", ""],
    ["update", "", "", { pinned: false }],
    ["remove", "", ""],
  ]);

  await assert.rejects(
    handlers.get("history:restore")({}, {
      documentId: "doc-1",
      entryId: "entry-1",
      targetPath: "C:\\draft.letterpaper",
      expectedRevision: { sha256: "a".repeat(64) },
    }),
    /文件大小无效/,
  );
  assert.equal(calls.at(-1)[0], "authorize");
  assert.equal(calls.some(([kind]) => kind === "restore"), false);
});

test("history IPC rejects oversized in-memory documents before snapshot creation", async () => {
  const { handlers, calls } = createHarness();
  await assert.rejects(
    handlers.get("history:create")({}, {
      documentId: "doc-memory",
      document: {
        version: 3,
        content: Array.from({ length: 50_001 }, () => null),
      },
    }),
    /数组项目数量超过限制/,
  );
  assert.deepEqual(calls, []);
});
