const assert = require("node:assert/strict");
const test = require("node:test");

const { registerApplicationIpcHandlers } = require("./application-ipc.cjs");
const {
  createInitialUpdateState,
  mergeUpdateState,
} = require("./update-runtime.cjs");

const APPLICATION_CHANNELS = [
  "app:close-canceled",
  "app:close-ready",
  "app:confirm-close",
  "app:get-paths",
  "update:check",
  "update:download",
  "update:get-state",
  "update:install",
  "window:get-fullscreen",
  "window:set-fullscreen",
  "window:set-modal-overlay",
];

function createHarness() {
  const handlers = new Map();
  const calls = {
    checkForUpdates: 0,
    close: 0,
    downloadUpdate: 0,
    ensureDocumentsDirectory: 0,
    logs: [],
    messageBoxes: [],
    quitAndInstall: [],
    stopCloseAttention: 0,
    titleBarOverlays: [],
    updateStates: [],
  };
  const app = { isPackaged: true };
  const titleBarOverlay = { color: "#fff", symbolColor: "#111", height: 40 };
  const mainWindow = {
    destroyed: false,
    fullscreen: false,
    close() {
      calls.close += 1;
    },
    isDestroyed() {
      return this.destroyed;
    },
    isFullScreen() {
      return this.fullscreen;
    },
    setFullScreen(value) {
      this.fullscreen = value;
    },
    setTitleBarOverlay(value) {
      calls.titleBarOverlays.push(value);
    },
  };
  let activeWindow = mainWindow;
  const state = {
    closeRequestInFlight: false,
    forceCloseWindow: false,
    pendingUpdateInstall: false,
    update: createInitialUpdateState("1.0.0"),
  };
  const autoUpdater = {
    async checkForUpdates() {
      calls.checkForUpdates += 1;
    },
    async downloadUpdate() {
      calls.downloadUpdate += 1;
    },
    quitAndInstall(...args) {
      calls.quitAndInstall.push(args);
    },
  };
  const dialog = {
    response: 2,
    async showMessageBox(window, options) {
      calls.messageBoxes.push({ window, options });
      return { response: this.response };
    },
  };

  registerApplicationIpcHandlers({
    ipcMain: {
      handle(channel, listener) {
        assert.equal(handlers.has(channel), false, `duplicate test handler: ${channel}`);
        handlers.set(channel, listener);
      },
    },
    app,
    autoUpdater,
    dialog,
    titleBarOverlay,
    ensureDocumentsDirectory: async () => {
      calls.ensureDocumentsDirectory += 1;
      return "C:\\Users\\Writer\\Documents\\PaperWriter";
    },
    getMainWindow: () => activeWindow,
    getUpdateState: () => state.update,
    emitUpdateState: (patch) => {
      state.update = mergeUpdateState(state.update, patch, "1.0.0");
      calls.updateStates.push(state.update);
      return state.update;
    },
    getCloseRequestInFlight: () => state.closeRequestInFlight,
    setCloseRequestInFlight: (value) => { state.closeRequestInFlight = value; },
    getPendingUpdateInstall: () => state.pendingUpdateInstall,
    setPendingUpdateInstall: (value) => { state.pendingUpdateInstall = value; },
    setForceCloseWindow: (value) => { state.forceCloseWindow = value; },
    stopCloseAttention: () => { calls.stopCloseAttention += 1; },
    writeDebugLog: async (...args) => { calls.logs.push(args); },
  });

  return {
    app,
    autoUpdater,
    calls,
    dialog,
    handlers,
    mainWindow,
    setMainWindow: (value) => { activeWindow = value; },
    state,
    titleBarOverlay,
  };
}

test("registers the complete application IPC surface exactly once", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()].sort(), APPLICATION_CHANNELS);
});

test("preserves path, title-bar overlay, and fullscreen contracts", async () => {
  const harness = createHarness();

  assert.deepEqual(await harness.handlers.get("app:get-paths")(), {
    documents: "C:\\Users\\Writer\\Documents\\PaperWriter",
  });
  assert.equal(harness.calls.ensureDocumentsDirectory, 1);

  assert.deepEqual(await harness.handlers.get("window:set-modal-overlay")(), { ok: true });
  assert.equal(harness.calls.titleBarOverlays[0], harness.titleBarOverlay);

  assert.deepEqual(
    await harness.handlers.get("window:set-fullscreen")({}, 1),
    { fullscreen: true },
  );
  assert.deepEqual(await harness.handlers.get("window:get-fullscreen")(), { fullscreen: true });

  harness.mainWindow.destroyed = true;
  assert.deepEqual(
    await harness.handlers.get("window:set-fullscreen")({}, false),
    { fullscreen: false },
  );
  harness.setMainWindow(null);
  assert.deepEqual(await harness.handlers.get("window:get-fullscreen")(), { fullscreen: false });
});

test("reports title-bar overlay failures without rejecting the renderer call", async () => {
  const harness = createHarness();
  harness.mainWindow.setTitleBarOverlay = () => {
    throw new Error("overlay failed");
  };

  assert.deepEqual(await harness.handlers.get("window:set-modal-overlay")(), {
    ok: false,
    message: "overlay failed",
  });
  assert.deepEqual(harness.calls.logs, [[
    "window:set-modal-overlay:error",
    { message: "overlay failed" },
  ]]);
});

test("keeps update IPC results compatible while exposing progress metadata", async () => {
  const harness = createHarness();
  harness.app.isPackaged = false;

  assert.deepEqual(await harness.handlers.get("update:check")(), {
    status: "dev",
    message: "开发版不能检查更新，打包安装后可用",
    version: "1.0.0",
    progressKnown: false,
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    installPending: false,
  });
  assert.deepEqual(await harness.handlers.get("update:download")(), {
    status: "dev",
    message: "开发版不能下载更新，打包安装后可用",
    version: "1.0.0",
    progressKnown: false,
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    installPending: false,
  });
  assert.equal(harness.calls.checkForUpdates, 0);
  assert.equal(harness.calls.downloadUpdate, 0);

  harness.app.isPackaged = true;
  harness.state.update = { status: "checking", message: "正在检查更新", version: "1.0.0" };
  assert.equal(
    await harness.handlers.get("update:check")(),
    harness.state.update,
  );
  assert.equal(harness.calls.checkForUpdates, 1);

  harness.autoUpdater.downloadUpdate = async () => {
    harness.calls.downloadUpdate += 1;
    throw new Error("network unavailable");
  };
  const failedDownload = await harness.handlers.get("update:download")();
  assert.deepEqual(harness.calls.updateStates.at(-2), {
    status: "downloading",
    message: "正在准备下载更新...",
    version: "1.0.0",
    progressKnown: false,
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    installPending: false,
  });
  assert.deepEqual(failedDownload, {
    status: "error",
    message: "下载失败：network unavailable",
    version: "1.0.0",
    progressKnown: false,
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    installPending: false,
  });
  assert.equal(harness.calls.downloadUpdate, 1);
  assert.equal(await harness.handlers.get("update:get-state")(), harness.state.update);
});

test("defers update installation through the existing close-save handshake", async () => {
  const harness = createHarness();
  const idleState = harness.state.update;
  assert.equal(await harness.handlers.get("update:install")(), idleState);
  assert.equal(harness.state.pendingUpdateInstall, false);
  assert.equal(harness.calls.close, 0);

  harness.state.update = { status: "downloaded", message: "ready", version: "2.0.0" };
  assert.deepEqual(await harness.handlers.get("update:install")(), {
    status: "downloaded",
    message: "更新已下载，正在准备重启安装...",
    version: "1.0.0",
    progressKnown: false,
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    installPending: true,
  });
  assert.equal(harness.state.pendingUpdateInstall, true);
  assert.equal(harness.calls.close, 1);
  assert.deepEqual(harness.calls.quitAndInstall, []);

  harness.state.closeRequestInFlight = true;
  assert.deepEqual(await harness.handlers.get("app:close-ready")(), {
    ok: true,
    installingUpdate: true,
  });
  assert.equal(harness.state.forceCloseWindow, true);
  assert.equal(harness.state.closeRequestInFlight, false);
  assert.deepEqual(harness.calls.quitAndInstall, [[false, true]]);
  assert.equal(harness.state.update.message, "正在重启并安装更新...");
  assert.equal(harness.state.update.installPending, true);
});

test("restores close state when update installation throws", async () => {
  const harness = createHarness();
  harness.state.pendingUpdateInstall = true;
  harness.state.closeRequestInFlight = true;
  harness.state.update = { status: "downloaded", message: "ready", version: "1.0.0" };
  harness.autoUpdater.quitAndInstall = () => {
    throw new Error("installer failed");
  };

  await assert.rejects(
    () => harness.handlers.get("app:close-ready")(),
    /installer failed/,
  );
  assert.equal(harness.state.pendingUpdateInstall, false);
  assert.equal(harness.state.forceCloseWindow, false);
  assert.equal(harness.state.closeRequestInFlight, false);
  assert.equal(harness.state.update.status, "error");
  assert.equal(harness.state.update.message, "安装更新失败：installer failed");
  assert.equal(harness.state.update.installPending, false);
  assert.deepEqual(harness.calls.logs, [[
    "update:install:error",
    { message: "installer failed" },
  ]]);
});

test("maps close confirmation choices and cancellation without changing payload semantics", async () => {
  const harness = createHarness();
  const confirmClose = harness.handlers.get("app:confirm-close");

  harness.dialog.response = 0;
  assert.deepEqual(await confirmClose({}, { dirtyCount: 3 }), { action: "save" });
  assert.equal(harness.calls.messageBoxes.at(-1).window, harness.mainWindow);
  assert.equal(harness.calls.messageBoxes.at(-1).options.message, "有 3 篇信笺尚未保存");

  harness.dialog.response = 1;
  assert.deepEqual(await confirmClose({}, { dirtyCount: 1 }), { action: "discard" });
  assert.equal(harness.calls.messageBoxes.at(-1).options.message, "当前信笺尚未保存");

  harness.dialog.response = 2;
  assert.deepEqual(await confirmClose({}, {}), { action: "cancel" });

  harness.state.closeRequestInFlight = true;
  harness.state.pendingUpdateInstall = true;
  harness.state.update = { status: "downloaded", message: "ready", version: "1.0.0" };
  assert.deepEqual(await harness.handlers.get("app:close-canceled")(), { ok: true });
  assert.equal(harness.state.closeRequestInFlight, false);
  assert.equal(harness.state.pendingUpdateInstall, false);
  assert.equal(harness.calls.stopCloseAttention, 1);
  assert.equal(harness.state.update.status, "downloaded");
  assert.equal(harness.state.update.message, "更新已下载，可重新安装");
  assert.equal(harness.state.update.installPending, false);
});

test("closes the application window after a normal close-ready response", async () => {
  const harness = createHarness();
  harness.state.closeRequestInFlight = true;

  assert.deepEqual(await harness.handlers.get("app:close-ready")(), { ok: true });
  assert.equal(harness.state.forceCloseWindow, true);
  assert.equal(harness.state.closeRequestInFlight, false);
  assert.equal(harness.calls.close, 1);
  assert.deepEqual(harness.calls.quitAndInstall, []);
});
