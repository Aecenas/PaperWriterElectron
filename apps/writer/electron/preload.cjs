const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("paperWriter", {
  isElectron: true,
  getPaths: () => ipcRenderer.invoke("app:get-paths"),
  debugLog: (event, data) => ipcRenderer.invoke("debug:log", event || "renderer", data || {}),
  openDocument: () => ipcRenderer.invoke("document:open"),
  openDocumentPath: (filePath) => ipcRenderer.invoke("document:open-path", filePath || ""),
  openFolder: () => ipcRenderer.invoke("folder:open"),
  listFolder: (folderPath) => ipcRenderer.invoke("folder:list", folderPath || ""),
  copyFolderPath: (folderPath) => ipcRenderer.invoke("folder:copy-path", folderPath || ""),
  showFolder: (folderPath) => ipcRenderer.invoke("folder:show", folderPath || ""),
  createFolder: (parentPath, name) => ipcRenderer.invoke("folder:create", parentPath || "", name || ""),
  createDocumentInFolder: (folderPath, title) => ipcRenderer.invoke("document:create-in-folder", folderPath || "", title || ""),
  renameEntry: (targetPath, nextName) => ipcRenderer.invoke("entry:rename", targetPath || "", nextName || ""),
  deleteEntry: (targetPath) => ipcRenderer.invoke("entry:delete", targetPath || ""),
  moveEntry: (sourcePath, targetFolderPath) => ipcRenderer.invoke("entry:move", sourcePath || "", targetFolderPath || ""),
  backupDocument: (filePath) => ipcRenderer.invoke("document:backup", filePath || ""),
  saveDocument: (document, currentPath, saveAs = false) =>
    ipcRenderer.invoke("document:save", document, currentPath || "", Boolean(saveAs)),
  exportPdf: (suggestedName) => ipcRenderer.invoke("document:export-pdf", suggestedName || "未命名信笺"),
  exportPageImages: (suggestedName, pageRects) =>
    ipcRenderer.invoke("document:export-page-images", suggestedName || "未命名信笺", Array.isArray(pageRects) ? pageRects : []),
  pickImage: () => ipcRenderer.invoke("asset:pick-image"),
  loadAutosave: () => ipcRenderer.invoke("autosave:load"),
  saveAutosave: (document) => ipcRenderer.invoke("autosave:save", document),
  clearAutosave: () => ipcRenderer.invoke("autosave:clear"),
  getUpdateState: () => ipcRenderer.invoke("update:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
});
