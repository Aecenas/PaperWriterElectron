const { subscribeToIpc } = require("./subscriptions.cjs");

function createWorkspaceApi(ipcRenderer) {
  return {
    openFolder: () => ipcRenderer.invoke("folder:open"),
    listFolder: (folderPath) => ipcRenderer.invoke("folder:list", folderPath || ""),
    searchFolder: (payload) => ipcRenderer.invoke("folder:search", payload || {}),
    cancelFolderSearch: (folderPath, requestId) => (
      ipcRenderer.invoke("folder:search-cancel", folderPath || "", requestId || "")
    ),
    getWorkspaceRelationships: (payload) => ipcRenderer.invoke("workspace:relationships", payload || {}),
    watchWorkspace: (folderPath) => ipcRenderer.invoke("workspace:watch", folderPath || ""),
    copyFolderPath: (folderPath) => ipcRenderer.invoke("folder:copy-path", folderPath || ""),
    showFolder: (folderPath) => ipcRenderer.invoke("folder:show", folderPath || ""),
    createFolder: (parentPath, name) => ipcRenderer.invoke("folder:create", parentPath || "", name || ""),
    createDocumentInFolder: (folderPath, title, templateDocument) => (
      ipcRenderer.invoke("document:create-in-folder", folderPath || "", title || "", templateDocument || {})
    ),
    renameEntry: (targetPath, nextName) => ipcRenderer.invoke("entry:rename", targetPath || "", nextName || ""),
    deleteEntry: (targetPath) => ipcRenderer.invoke("entry:delete", targetPath || ""),
    moveEntry: (sourcePath, targetFolderPath) => (
      ipcRenderer.invoke("entry:move", sourcePath || "", targetFolderPath || "")
    ),
    getWorkspaceIdentity: (workspacePath) => ipcRenderer.invoke("workspace:identity", workspacePath || ""),
    onWorkspaceChanged: (callback) => subscribeToIpc(ipcRenderer, "workspace:changed", callback, true),
    onWorkspaceWatchError: (callback) => subscribeToIpc(ipcRenderer, "workspace:watch-error", callback, true),
  };
}

module.exports = {
  createWorkspaceApi,
};
