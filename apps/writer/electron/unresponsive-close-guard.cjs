const DEFAULT_UNRESPONSIVE_CLOSE_GRACE_MS = 5_000;

function createUnresponsiveCloseGuard({
  getWindow,
  isCloseRequestInFlight,
  showMessageBox,
  forceClose,
  writeDebugLog = async () => {},
  graceMs = DEFAULT_UNRESPONSIVE_CLOSE_GRACE_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (typeof getWindow !== "function") throw new TypeError("getWindow 必须是函数");
  if (typeof isCloseRequestInFlight !== "function") {
    throw new TypeError("isCloseRequestInFlight 必须是函数");
  }
  if (typeof showMessageBox !== "function") throw new TypeError("showMessageBox 必须是函数");
  if (typeof forceClose !== "function") throw new TypeError("forceClose 必须是函数");

  const resolvedGraceMs = Number.isFinite(graceMs) && graceMs >= 0
    ? graceMs
    : DEFAULT_UNRESPONSIVE_CLOSE_GRACE_MS;
  let rendererUnresponsive = false;
  let graceTimer = null;
  let promptInFlight = false;
  let disposed = false;

  function clearGraceTimer() {
    if (graceTimer === null) return;
    clearTimer(graceTimer);
    graceTimer = null;
  }

  function canPrompt() {
    const window = getWindow();
    return !disposed
      && rendererUnresponsive
      && isCloseRequestInFlight()
      && window
      && !window.isDestroyed();
  }

  function schedulePrompt() {
    if (!canPrompt() || graceTimer !== null || promptInFlight) return;
    graceTimer = setTimer(async () => {
      graceTimer = null;
      if (!canPrompt()) return;
      const window = getWindow();
      promptInFlight = true;
      let result = null;
      try {
        result = await showMessageBox(window, {
          type: "warning",
          title: "笺间暂时没有响应",
          message: "写作界面仍在处理任务",
          detail: "继续等待可保留保存与恢复流程；强制退出可能丢失最近尚未写入恢复缓存的修改。",
          buttons: ["继续等待", "强制退出"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
      } catch (error) {
        await writeDebugLog("renderer:unresponsive-close-prompt:error", {
          message: error?.message,
        });
      } finally {
        promptInFlight = false;
      }
      if (!canPrompt()) return;
      if (result?.response === 1) {
        await writeDebugLog("renderer:unresponsive-close:forced");
        forceClose();
        return;
      }
      // The renderer is still unresponsive and the close request is still
      // pending. Give it another full grace period before asking again.
      schedulePrompt();
    }, resolvedGraceMs);
  }

  function markUnresponsive() {
    if (disposed) return;
    rendererUnresponsive = true;
    schedulePrompt();
  }

  function markResponsive() {
    rendererUnresponsive = false;
    clearGraceTimer();
  }

  function closeRequested() {
    schedulePrompt();
  }

  function closeSettled() {
    clearGraceTimer();
  }

  function dispose() {
    disposed = true;
    rendererUnresponsive = false;
    clearGraceTimer();
  }

  return Object.freeze({
    closeRequested,
    closeSettled,
    dispose,
    markResponsive,
    markUnresponsive,
  });
}

module.exports = {
  DEFAULT_UNRESPONSIVE_CLOSE_GRACE_MS,
  createUnresponsiveCloseGuard,
};
