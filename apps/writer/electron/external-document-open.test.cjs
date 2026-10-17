const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");
const { createExternalDocumentOpenRuntime, registerExternalDocumentOpenIpcHandlers } = require("./external-document-open.cjs");

function harness(options = {}) {
  const app = new EventEmitter();
  const events = [];
  const authorized = [];
  let window = options.noWindow ? null : {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => events.push("restore"),
    show: () => events.push("show"),
    focus: () => events.push("focus"),
    webContents: {
      isDestroyed: () => false,
      send: (...args) => events.push(args),
    },
  };
  const runtime = createExternalDocumentOpenRuntime({
    app,
    argv: options.argv || ["C:\\笺间.exe"],
    workingDirectory: "C:\\工作目录",
    isDefaultApp: Boolean(options.isDefaultApp),
    path: path.win32,
    platform: "win32",
    getMainWindow: () => window,
    isSupportedDocument: (value) => /\.(letterpaper|paperdoc)$/i.test(value),
    canonicalExistingPath: options.canonicalExistingPath || (async (value, type) => {
      assert.equal(type, "file");
      return value;
    }),
    authorizeDocumentPath: async (value) => {
      authorized.push(value);
      return value;
    },
  });
  return { app, authorized, events, runtime, setWindow: (value) => { window = value; } };
}

test("queues cold-start Chinese paths before a window exists and grants only those files", async () => {
  const h = harness({ noWindow: true, argv: ["C:\\笺间.exe", '"C:\\claude\\大A本轮牛市复盘.letterpaper"'] });
  assert.deepEqual(h.authorized, []);
  assert.deepEqual(await h.runtime.takeRequests(), [{ path: "C:\\claude\\大A本轮牛市复盘.letterpaper" }]);
  assert.deepEqual(h.authorized, ["C:\\claude\\大A本轮牛市复盘.letterpaper"]);
  assert.deepEqual(await h.runtime.takeRequests(), []);
});

test("second-instance uses its own working directory, ignores flags and focuses the existing window", async () => {
  const h = harness();
  h.app.emit("second-instance", {}, ["C:\\笺间.exe", "--user-data-dir=C:\\配置.letterpaper", "大 A.paperdoc", "other.txt"], "D:\\claude");
  assert.deepEqual(await h.runtime.takeRequests(), [{ path: "D:\\claude\\大 A.paperdoc" }]);
  assert.deepEqual(h.events.slice(-3), ["restore", "show", "focus"]);
  assert.equal(h.events[0][0], "document:external-open-request");
});

test("deduplicates pending Windows paths but permits a later double click to activate the tab again", async () => {
  const h = harness({ argv: ["C:\\笺间.exe", "C:\\claude\\Draft.letterpaper", "c:\\CLAUDE\\draft.letterpaper"] });
  assert.equal((await h.runtime.takeRequests()).length, 1);
  h.app.emit("second-instance", {}, ["C:\\笺间.exe", "C:\\claude\\Draft.letterpaper"], "C:\\");
  assert.equal((await h.runtime.takeRequests()).length, 1);
});

test("skips the development application entry and supports native open-file events", async () => {
  const h = harness({ isDefaultApp: true, noWindow: true, argv: ["electron", "C:\\app.letterpaper", "draft.paperdoc"] });
  let prevented = false;
  h.app.emit("open-file", { preventDefault: () => { prevented = true; } }, "D:\\资料\\另一篇.letterpaper");
  assert.equal(prevented, true);
  assert.deepEqual(await h.runtime.takeRequests(), [
    { path: "C:\\工作目录\\draft.paperdoc" },
    { path: "D:\\资料\\另一篇.letterpaper" },
  ]);
});

test("reports missing and unsupported canonical files while continuing subsequent opens", async () => {
  const h = harness({
    argv: ["app", "missing.letterpaper", "link.letterpaper", "good.letterpaper"],
    canonicalExistingPath: async (value) => {
      if (value.includes("missing")) throw new Error("文件不存在");
      return value.includes("link") ? "C:\\private.txt" : value;
    },
  });
  const requests = await h.runtime.takeRequests();
  assert.equal(requests[0].error, "文件不存在");
  assert.equal(requests[1].error, "请选择信笺文件");
  assert.equal(requests[2].path, "C:\\工作目录\\good.letterpaper");
  assert.deepEqual(h.authorized, [requests[2].path]);
});

test("retains requests received while an earlier batch is being authorized", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const h = harness({ argv: ["app", "first.letterpaper"], canonicalExistingPath: async (value) => { await blocked; return value; } });
  const first = h.runtime.takeRequests();
  h.app.emit("second-instance", {}, ["app", "second.letterpaper"], "D:\\claude");
  release();
  assert.deepEqual(await first, [{ path: "C:\\工作目录\\first.letterpaper" }]);
  assert.deepEqual(await h.runtime.takeRequests(), [{ path: "D:\\claude\\second.letterpaper" }]);
});

test("the renderer can only consume OS-queued paths, never nominate a path for authorization", async () => {
  const h = harness({ argv: ["app", "selected.letterpaper"] });
  let channel;
  let listener;
  registerExternalDocumentOpenIpcHandlers({
    ipcMain: { handle: (name, callback) => { channel = name; listener = callback; } },
    externalDocumentOpen: h.runtime,
  });
  assert.equal(channel, "document:take-external-open-requests");
  assert.deepEqual(await listener({}, "C:\\private\\other.letterpaper"), [{ path: "C:\\工作目录\\selected.letterpaper" }]);
  assert.deepEqual(h.authorized, ["C:\\工作目录\\selected.letterpaper"]);
});
