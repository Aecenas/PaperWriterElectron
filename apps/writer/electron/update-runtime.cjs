const EMPTY_UPDATE_PROGRESS = Object.freeze({
  progressKnown: false,
  percent: null,
  transferred: null,
  total: null,
  bytesPerSecond: null,
});

function createInitialUpdateState(version) {
  return {
    status: "idle",
    message: "尚未检查更新",
    version,
    ...EMPTY_UPDATE_PROGRESS,
    installPending: false,
  };
}

function mergeUpdateState(currentState, patch, version) {
  const status = patch?.status || currentState?.status || "idle";
  const progressReset = status === "downloading" ? null : EMPTY_UPDATE_PROGRESS;
  const installPending = Object.hasOwn(patch || {}, "installPending")
    ? Boolean(patch.installPending)
    : status === "downloaded" && Boolean(currentState?.installPending);

  return {
    ...currentState,
    ...patch,
    ...(progressReset || {}),
    status,
    version,
    installPending,
  };
}

function normalizeNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizePercent(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(100, Math.max(0, number)) : null;
}

function createDownloadStartingPatch() {
  return {
    status: "downloading",
    message: "正在准备下载更新...",
    ...EMPTY_UPDATE_PROGRESS,
    installPending: false,
  };
}

function createDownloadProgressPatch(progress = {}) {
  const normalizedPercent = normalizePercent(progress.percent);
  const percent = normalizedPercent === null
    ? null
    : Math.round(normalizedPercent * 10) / 10;
  const total = normalizeNonNegativeNumber(progress.total);
  const rawTransferred = normalizeNonNegativeNumber(progress.transferred);
  const transferred = rawTransferred === null
    ? null
    : total && total > 0
      ? Math.min(rawTransferred, total)
      : rawTransferred;
  const bytesPerSecond = normalizeNonNegativeNumber(progress.bytesPerSecond);
  const progressKnown = percent !== null;

  return {
    status: "downloading",
    message: progressKnown
      ? `正在下载更新 ${Math.round(percent)}%`
      : "正在下载更新...",
    progressKnown,
    percent,
    transferred,
    total,
    bytesPerSecond,
    installPending: false,
  };
}

function registerUpdateEvents({
  autoUpdater,
  emitUpdateState,
  onError,
}) {
  const listeners = {
    "checking-for-update": () => {
      emitUpdateState({
        status: "checking",
        message: "正在检查更新...",
        installPending: false,
      });
    },
    "update-available": (info = {}) => {
      emitUpdateState({
        status: "available",
        message: `发现新版本 ${info.version}`,
        availableVersion: info.version,
        installPending: false,
      });
    },
    "update-not-available": () => {
      emitUpdateState({
        status: "none",
        message: "当前已经是最新版本",
        installPending: false,
      });
    },
    "download-progress": (progress) => {
      emitUpdateState(createDownloadProgressPatch(progress));
    },
    "update-downloaded": (info = {}) => {
      emitUpdateState({
        status: "downloaded",
        message: `版本 ${info.version} 已下载，重启后安装`,
        availableVersion: info.version,
        installPending: false,
      });
    },
    error: (error) => {
      onError?.(error);
      emitUpdateState({
        status: "error",
        message: `更新失败：${error?.message || "未知错误"}`,
        installPending: false,
      });
    },
  };

  for (const [event, listener] of Object.entries(listeners)) {
    autoUpdater.on(event, listener);
  }

  return () => {
    for (const [event, listener] of Object.entries(listeners)) {
      autoUpdater.removeListener?.(event, listener);
    }
  };
}

module.exports = {
  EMPTY_UPDATE_PROGRESS,
  createDownloadProgressPatch,
  createDownloadStartingPatch,
  createInitialUpdateState,
  mergeUpdateState,
  registerUpdateEvents,
};
