function registerApplicationIpcHandlers({
  ipcMain,
  app,
  autoUpdater,
  dialog,
  titleBarOverlay,
  ensureDocumentsDirectory,
  getMainWindow,
  getUpdateState,
  emitUpdateState,
  getCloseRequestInFlight,
  setCloseRequestInFlight,
  getPendingUpdateInstall,
  setPendingUpdateInstall,
  setForceCloseWindow,
  stopCloseAttention,
  writeDebugLog,
}) {
  ipcMain.handle("app:get-paths", async () => ({
    documents: await ensureDocumentsDirectory(),
  }));

  ipcMain.handle("window:set-modal-overlay", async () => {
    try {
      const mainWindow = getMainWindow();
      if (typeof mainWindow?.setTitleBarOverlay === "function") {
        mainWindow.setTitleBarOverlay(titleBarOverlay);
      }
      return { ok: true };
    } catch (error) {
      await writeDebugLog("window:set-modal-overlay:error", { message: error?.message });
      return { ok: false, message: error?.message };
    }
  });

  ipcMain.handle("update:get-state", async () => getUpdateState());

  ipcMain.handle("update:check", async () => {
    if (!app.isPackaged) {
      return emitUpdateState({
        status: "dev",
        message: "开发版不能检查更新，打包安装后可用",
      });
    }
    try {
      await autoUpdater.checkForUpdates();
      return getUpdateState();
    } catch (error) {
      return emitUpdateState({
        status: "error",
        message: `更新失败：${error.message}`,
      });
    }
  });

  ipcMain.handle("update:download", async () => {
    if (!app.isPackaged) {
      return emitUpdateState({
        status: "dev",
        message: "开发版不能下载更新，打包安装后可用",
      });
    }
    try {
      await autoUpdater.downloadUpdate();
      return getUpdateState();
    } catch (error) {
      return emitUpdateState({
        status: "error",
        message: `下载失败：${error.message}`,
      });
    }
  });

  ipcMain.handle("update:install", async () => {
    const updateState = getUpdateState();
    if (updateState.status !== "downloaded") {
      return updateState;
    }
    setPendingUpdateInstall(true);
    const mainWindow = getMainWindow();
    if (!getCloseRequestInFlight() && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    return { ...updateState, installPending: true };
  });

  ipcMain.handle("window:set-fullscreen", async (_event, fullscreen) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return { fullscreen: false };
    mainWindow.setFullScreen(Boolean(fullscreen));
    return { fullscreen: mainWindow.isFullScreen() };
  });

  ipcMain.handle("window:get-fullscreen", async () => ({
    fullscreen: Boolean(getMainWindow()?.isFullScreen?.()),
  }));

  ipcMain.handle("app:confirm-close", async (_event, payload = {}) => {
    const dirtyCount = Number(payload.dirtyCount) || 0;
    const result = await dialog.showMessageBox(getMainWindow(), {
      type: "question",
      title: "关闭笺间",
      message: dirtyCount > 1 ? `有 ${dirtyCount} 篇信笺尚未保存` : "当前信笺尚未保存",
      detail: "选择“保存并关闭”会先保存已有文件；未命名信笺会保存为临时会话文件，下次启动会恢复打开。",
      buttons: ["保存并关闭", "不保存", "取消"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (result.response === 0) {
      return { action: "save" };
    }
    if (result.response === 1) {
      return { action: "discard" };
    }
    return { action: "cancel" };
  });

  ipcMain.handle("app:close-ready", async () => {
    setForceCloseWindow(true);
    setCloseRequestInFlight(false);
    if (getPendingUpdateInstall()) {
      try {
        autoUpdater.quitAndInstall(false, true);
        return { ok: true, installingUpdate: true };
      } catch (error) {
        setPendingUpdateInstall(false);
        setForceCloseWindow(false);
        await writeDebugLog("update:install:error", { message: error?.message });
        throw error;
      }
    }
    getMainWindow()?.close();
    return { ok: true };
  });

  ipcMain.handle("app:close-canceled", async () => {
    setCloseRequestInFlight(false);
    setPendingUpdateInstall(false);
    stopCloseAttention();
    return { ok: true };
  });
}

module.exports = {
  registerApplicationIpcHandlers,
};
