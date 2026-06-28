const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("paperWriter", {
  isElectron: true,
  getPaths: () => ipcRenderer.invoke("app:get-paths"),
  openDocument: () => ipcRenderer.invoke("document:open"),
  openDocumentPath: (filePath) => ipcRenderer.invoke("document:open-path", filePath || ""),
  openFolder: () => ipcRenderer.invoke("folder:open"),
  listFolder: (folderPath) => ipcRenderer.invoke("folder:list", folderPath || ""),
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
