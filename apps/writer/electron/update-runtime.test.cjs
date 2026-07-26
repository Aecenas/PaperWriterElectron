const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  createDownloadProgressPatch,
  createDownloadStartingPatch,
  createInitialUpdateState,
  mergeUpdateState,
  registerUpdateEvents,
} = require("./update-runtime.cjs");

test("creates an indeterminate download state before updater progress is known", () => {
  assert.deepEqual(createDownloadStartingPatch(), {
    status: "downloading",
    message: "正在准备下载更新...",
    progressKnown: false,
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    installPending: false,
  });
});

test("normalizes updater progress while retaining byte totals and transfer rate", () => {
  assert.deepEqual(createDownloadProgressPatch({
    percent: 42.34,
    transferred: 13_000_000,
    total: 31_000_000,
    bytesPerSecond: 2_200_000,
  }), {
    status: "downloading",
    message: "正在下载更新 42%",
    progressKnown: true,
    percent: 42.3,
    transferred: 13_000_000,
    total: 31_000_000,
    bytesPerSecond: 2_200_000,
    installPending: false,
  });

  assert.equal(createDownloadProgressPatch({ percent: -2 }).percent, 0);
  assert.equal(createDownloadProgressPatch({ percent: 104 }).percent, 100);
  assert.deepEqual(createDownloadProgressPatch({ percent: undefined }), {
    status: "downloading",
    message: "正在下载更新...",
    progressKnown: false,
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    installPending: false,
  });
  assert.equal(
    createDownloadProgressPatch({ percent: 90, transferred: 120, total: 100 }).transferred,
    100,
  );
});

test("clears stale progress and install fields when the update phase changes", () => {
  const initial = createInitialUpdateState("1.0.0");
  const downloading = mergeUpdateState(initial, createDownloadProgressPatch({
    percent: 60,
    transferred: 600,
    total: 1_000,
    bytesPerSecond: 50,
  }), "1.0.0");
  const downloaded = mergeUpdateState(downloading, {
    status: "downloaded",
    message: "ready",
    installPending: true,
  }, "1.0.0");
  assert.deepEqual(downloaded, {
    status: "downloaded",
    message: "ready",
    version: "1.0.0",
    progressKnown: false,
    percent: null,
    transferred: null,
    total: null,
    bytesPerSecond: null,
    installPending: true,
  });

  const failed = mergeUpdateState(downloaded, {
    status: "error",
    message: "failed",
    progressKnown: true,
    percent: 60,
  }, "1.0.0");
  assert.equal(failed.installPending, false);
  assert.equal(failed.percent, null);
  assert.equal(failed.progressKnown, false);
});

test("maps updater events through the shared update state registrar", () => {
  const autoUpdater = new EventEmitter();
  const emitted = [];
  const errors = [];
  const cleanup = registerUpdateEvents({
    autoUpdater,
    emitUpdateState: (state) => emitted.push(state),
    onError: (error) => errors.push(error),
  });

  autoUpdater.emit("checking-for-update");
  autoUpdater.emit("download-progress", {
    percent: 12.5,
    transferred: 10,
    total: 80,
    bytesPerSecond: 4,
  });
  autoUpdater.emit("update-downloaded", { version: "2.0.0" });
  const failure = new Error("network unavailable");
  autoUpdater.emit("error", failure);

  assert.equal(emitted[0].status, "checking");
  assert.equal(emitted[1].percent, 12.5);
  assert.equal(emitted[2].installPending, false);
  assert.deepEqual(emitted.at(-1), {
    status: "error",
    message: "更新失败：network unavailable",
    installPending: false,
  });
  assert.deepEqual(errors, [failure]);

  cleanup();
  assert.equal(autoUpdater.listenerCount("download-progress"), 0);
});
