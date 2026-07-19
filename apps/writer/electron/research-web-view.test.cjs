const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  RESEARCH_WEB_PARTITION,
  createResearchWebViewManager,
  normalizeResearchWebUrl,
  sanitizeResearchWebBounds,
} = require("./research-web-view.cjs");

class MockWebContents extends EventEmitter {
  constructor() {
    super();
    this.url = "";
    this.title = "";
    this.loading = false;
    this.closed = false;
    this.navigationHistory = {
      canGoBack: () => true,
      canGoForward: () => false,
      goBack: () => { this.wentBack = true; },
      goForward: () => { this.wentForward = true; },
    };
  }

  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
  getURL() { return this.url; }
  getTitle() { return this.title; }
  isLoading() { return this.loading; }
  async loadURL(url) { this.url = url; }
  reload() { this.reloaded = true; }
  stop() { this.stopped = true; }
  close() { this.closed = true; }
}

test("web view URL and bounds validation reject privileged input and clamp to the window", () => {
  assert.equal(normalizeResearchWebUrl("https://example.com/path"), "https://example.com/path");
  assert.throws(() => normalizeResearchWebUrl("file:///C:/secret"), /HTTP 或 HTTPS/);
  assert.throws(() => normalizeResearchWebUrl("https://user:secret@example.com"), /账号信息/);
  assert.deepEqual(
    sanitizeResearchWebBounds({ x: -5, y: 20.4, width: 900, height: 600 }, [800, 500]),
    { x: 0, y: 20, width: 800, height: 480 },
  );
});

test("web views use an ephemeral sandbox, deny permissions and downloads, and retain hidden tabs", async () => {
  const views = [];
  const opened = [];
  const states = [];
  let permissionRequestHandler;
  let permissionCheckHandler;
  let downloadHandler;
  let usedPartition = "";
  const researchSession = {
    setPermissionRequestHandler(handler) { permissionRequestHandler = handler; },
    setPermissionCheckHandler(handler) { permissionCheckHandler = handler; },
    on(eventName, handler) { if (eventName === "will-download") downloadHandler = handler; },
  };
  const attached = [];
  const removed = [];
  const window = {
    isDestroyed: () => false,
    getContentSize: () => [1200, 800],
    contentView: {
      addChildView(view) { attached.push(view); },
      removeChildView(view) { removed.push(view); },
    },
  };
  class MockWebContentsView {
    constructor(options) {
      this.options = options;
      this.webContents = new MockWebContents();
      views.push(this);
    }
    setBounds(bounds) { this.bounds = bounds; }
  }
  const manager = createResearchWebViewManager({
    WebContentsView: MockWebContentsView,
    session: {
      fromPartition(partition) {
        usedPartition = partition;
        return researchSession;
      },
    },
    shell: { openExternal: async (url) => { opened.push(url); } },
    getWindow: () => window,
    sendState: (state) => states.push(state),
  });

  assert.equal(usedPartition, RESEARCH_WEB_PARTITION);
  assert.equal(usedPartition.startsWith("persist:"), false);
  let allowed = true;
  permissionRequestHandler(null, "camera", (value) => { allowed = value; });
  assert.equal(allowed, false);
  assert.equal(permissionCheckHandler(), false);
  let downloadPrevented = false;
  downloadHandler({ preventDefault() { downloadPrevented = true; } });
  assert.equal(downloadPrevented, true);

  await manager.show({ viewId: "view-1", url: "https://example.com/one", bounds: { x: 10, y: 20, width: 700, height: 500 } });
  await Promise.resolve();
  assert.equal(views.length, 1);
  assert.deepEqual(views[0].options.webPreferences, {
    partition: RESEARCH_WEB_PARTITION,
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    devTools: false,
    webviewTag: false,
  });
  assert.deepEqual(views[0].bounds, { x: 10, y: 20, width: 700, height: 500 });
  assert.equal(attached.length, 1);
  assert.equal(views[0].webContents.url, "https://example.com/one");

  assert.deepEqual(views[0].webContents.windowOpenHandler({ url: "https://example.org/new" }), { action: "deny" });
  await Promise.resolve();
  assert.deepEqual(opened, ["https://example.org/new"]);
  assert.deepEqual(views[0].webContents.windowOpenHandler({ url: "file:///C:/secret" }), { action: "deny" });
  assert.deepEqual(opened, ["https://example.org/new"]);
  let navigationPrevented = false;
  views[0].webContents.emit("will-navigate", { preventDefault() { navigationPrevented = true; } }, "javascript:alert(1)");
  assert.equal(navigationPrevented, true);
  views[0].webContents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://missing.invalid", true);
  views[0].webContents.emit("did-stop-loading");
  assert.equal(states.at(-1).error, "ERR_NAME_NOT_RESOLVED");

  await manager.show({ viewId: "view-2", url: "https://example.com/two", bounds: { x: 20, y: 30, width: 600, height: 400 } });
  assert.equal(views.length, 2);
  assert.equal(removed.includes(views[0]), true);
  assert.equal(views[0].webContents.closed, false);
  assert.deepEqual(manager.control({ viewId: "view-1", action: "back" }), { ok: true });
  assert.equal(views[0].webContents.wentBack, true);
  assert.deepEqual(manager.destroy("view-1"), { ok: true });
  assert.equal(views[0].webContents.closed, true);
  assert.equal(states.some((state) => state.viewId === "view-1"), true);
  manager.destroyAll();
  assert.equal(views[1].webContents.closed, true);
});
