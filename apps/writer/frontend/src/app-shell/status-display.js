export function formatClock(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatCacheBytes(bytes) {
  if (!bytes) {
    return "0 KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function normalizeUpdatePercent(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const percent = Number(value);
  if (!Number.isFinite(percent)) {
    return null;
  }
  return Math.min(100, Math.max(0, percent));
}

function formatUpdateBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) {
    return "";
  }
  if (value < 1024) {
    return `${Math.round(value)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let scaled = value / 1024;
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  const digits = scaled < 100 ? 1 : 0;
  const formatted = scaled.toFixed(digits).replace(/\.0$/, "");
  return `${formatted} ${units[unitIndex]}`;
}

export function getUpdateProgress(updateState = {}) {
  if (updateState.status !== "downloading" || updateState.progressKnown === false) {
    return { known: false, percent: null };
  }
  const percent = normalizeUpdatePercent(updateState.percent);
  return {
    known: percent !== null,
    percent,
  };
}

export function formatUpdateProgressDetails(updateState = {}) {
  const parts = [];
  const transferred = formatUpdateBytes(updateState.transferred);
  const total = formatUpdateBytes(updateState.total);
  if (transferred && total && Number(updateState.total) > 0) {
    parts.push(`${transferred} / ${total}`);
  }
  const rate = formatUpdateBytes(updateState.bytesPerSecond);
  if (rate && Number(updateState.bytesPerSecond) > 0) {
    parts.push(`${rate}/s`);
  }
  return parts.join(" · ");
}

export function getUpdateStatusDescription(updateState = {}, updateMeta = getUpdateStatusMeta(updateState)) {
  const message = updateState.message || updateMeta.label;
  if (!updateMeta.progressKnown) {
    return message;
  }
  const details = formatUpdateProgressDetails(updateState);
  return details ? `${message}（${details}）` : message;
}

export function getUpdateProgressAnnouncement(updateState = {}) {
  if (updateState.status === "downloaded" && updateState.installPending) {
    return "更新已下载，正在准备重启安装";
  }
  const progress = getUpdateProgress(updateState);
  if (updateState.status !== "downloading") {
    return "";
  }
  if (!progress.known) {
    return "正在下载更新，等待进度";
  }
  const roundedPercent = Math.round(progress.percent);
  const bucket = roundedPercent >= 100 ? 100 : Math.floor(roundedPercent / 10) * 10;
  return `更新下载进度 ${bucket}%`;
}

export function getUpdateStatusMeta(updateState = {}) {
  const status = updateState.status || "idle";
  if (status === "checking") {
    return { label: "检查中", className: "checking", busy: true };
  }
  if (status === "downloading") {
    const progress = getUpdateProgress(updateState);
    return {
      label: progress.known ? `更新中 ${Math.round(progress.percent)}%` : "准备更新",
      className: "downloading",
      busy: true,
      progressKnown: progress.known,
      percent: progress.percent,
    };
  }
  if (status === "available") {
    return { label: "可更新", className: "available", busy: false };
  }
  if (status === "downloaded") {
    if (updateState.installPending) {
      return {
        label: "准备安装",
        className: "downloaded install-pending",
        busy: true,
      };
    }
    return { label: "安装更新", className: "downloaded", busy: false };
  }
  if (status === "error") {
    return { label: "更新失败", className: "error", busy: false };
  }
  if (status === "none") {
    return { label: "已是最新", className: "current", busy: false };
  }
  return { label: "检查更新", className: "idle", busy: false };
}
