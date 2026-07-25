const { subscribeToIpc } = require("./subscriptions.cjs");

function createWindowUpdateApi(ipcRenderer) {
  return {
    getPaths: () => ipcRenderer.invoke("app:get-paths"),
    debugLog: (event, data) => ipcRenderer.invoke("debug:log", event || "renderer", data || {}),
    setWindowModalOverlay: (active) => ipcRenderer.invoke("window:set-modal-overlay", Boolean(active)),
    setFullscreen: (fullscreen) => ipcRenderer.invoke("window:set-fullscreen", Boolean(fullscreen)),
    getFullscreen: () => ipcRenderer.invoke("window:get-fullscreen"),
    getUpdateState: () => ipcRenderer.invoke("update:get-state"),
    checkForUpdates: () => ipcRenderer.invoke("update:check"),
    downloadUpdate: () => ipcRenderer.invoke("update:download"),
    installUpdate: () => ipcRenderer.invoke("update:install"),
    onUpdateState: (callback) => subscribeToIpc(ipcRenderer, "update:state", callback),
    confirmClose: (payload) => ipcRenderer.invoke("app:confirm-close", payload || {}),
    closeReady: (payload) => ipcRenderer.invoke("app:close-ready", payload || {}),
    closeCanceled: (payload) => ipcRenderer.invoke("app:close-canceled", payload || {}),
    onCloseRequest: (callback) => subscribeToIpc(ipcRenderer, "app:close-request", callback, true),
    onWindowFocus: (callback) => subscribeToIpc(ipcRenderer, "window:focus", callback, true),
    onWindowBlur: (callback) => subscribeToIpc(ipcRenderer, "window:blur", callback, true),
    onFullscreenChanged: (callback) => (
      subscribeToIpc(ipcRenderer, "window:fullscreen-changed", callback, true)
    ),
  };
}

module.exports = {
  createWindowUpdateApi,
};
