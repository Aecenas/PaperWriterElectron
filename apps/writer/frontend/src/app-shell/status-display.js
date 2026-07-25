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

export function getUpdateStatusMeta(updateState = {}) {
  const status = updateState.status || "idle";
  if (status === "checking") {
    return { label: "检查中", className: "checking", busy: true };
  }
  if (status === "downloading") {
    return { label: "下载中", className: "downloading", busy: true };
  }
  if (status === "available") {
    return { label: "可更新", className: "available", busy: false };
  }
  if (status === "downloaded") {
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
