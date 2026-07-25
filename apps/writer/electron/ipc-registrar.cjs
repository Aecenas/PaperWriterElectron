const UNAUTHORIZED_IPC_ERROR = "拒绝未授权的 IPC 调用";
const SUBFRAME_IPC_ERROR = "拒绝子框架 IPC 调用";
const UNTRUSTED_PAGE_IPC_ERROR = "拒绝非应用页面 IPC 调用";

function assertTrustedIpcSender(event, { getMainWindow, isTrustedApplicationUrl }) {
  const mainWindow = getMainWindow();
  const sender = event?.sender;
  const senderFrame = event?.senderFrame;
  if (!mainWindow || mainWindow.isDestroyed() || sender !== mainWindow.webContents) {
    throw new Error(UNAUTHORIZED_IPC_ERROR);
  }
  if (senderFrame && senderFrame !== sender.mainFrame) {
    throw new Error(SUBFRAME_IPC_ERROR);
  }
  const senderUrl = senderFrame?.url || sender.getURL();
  if (!isTrustedApplicationUrl(senderUrl)) {
    throw new Error(UNTRUSTED_PAGE_IPC_ERROR);
  }
}

function createTrustedIpcRegistrar({
  ipcMain,
  getMainWindow,
  isTrustedApplicationUrl,
}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new TypeError("ipcMain.handle 必须是函数");
  }
  if (typeof getMainWindow !== "function") {
    throw new TypeError("getMainWindow 必须是函数");
  }
  if (typeof isTrustedApplicationUrl !== "function") {
    throw new TypeError("isTrustedApplicationUrl 必须是函数");
  }

  const registeredChannels = new Set();

  function handle(channel, listener) {
    if (typeof channel !== "string" || !channel) {
      throw new TypeError("IPC channel 必须是非空字符串");
    }
    if (typeof listener !== "function") {
      throw new TypeError(`IPC handler 必须是函数: ${channel}`);
    }
    if (registeredChannels.has(channel)) {
      throw new Error(`拒绝重复注册 IPC channel: ${channel}`);
    }

    registeredChannels.add(channel);
    try {
      return ipcMain.handle(channel, (event, ...args) => {
        assertTrustedIpcSender(event, { getMainWindow, isTrustedApplicationUrl });
        return listener(event, ...args);
      });
    } catch (error) {
      registeredChannels.delete(channel);
      throw error;
    }
  }

  return Object.freeze({ handle });
}

module.exports = {
  assertTrustedIpcSender,
  createTrustedIpcRegistrar,
};
