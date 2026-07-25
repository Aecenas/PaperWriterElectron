function registerResearchWebViewIpcHandlers({
  ipcMain,
  webViewFacade,
}) {
  ipcMain.handle("research:web-view-show", async (_event, payload = {}) => (
    webViewFacade.show(payload)
  ));

  ipcMain.handle("research:web-view-bounds", async (_event, payload = {}) => (
    webViewFacade.updateBounds(payload)
  ));

  ipcMain.handle("research:web-view-hide", async (_event, viewId = "") => (
    webViewFacade.hide(viewId)
  ));

  ipcMain.handle("research:web-view-control", async (_event, payload = {}) => (
    webViewFacade.control(payload)
  ));

  ipcMain.handle("research:web-view-destroy", async (_event, viewId = "") => (
    webViewFacade.destroy(viewId)
  ));
}

module.exports = {
  registerResearchWebViewIpcHandlers,
};
