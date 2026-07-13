const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("paperWriter", {
  isElectron: true,
  getPaths: () => ipcRenderer.invoke("app:get-paths"),
  debugLog: (event, data) => ipcRenderer.invoke("debug:log", event || "renderer", data || {}),
  setWindowModalOverlay: (active) => ipcRenderer.invoke("window:set-modal-overlay", Boolean(active)),
  getAiConfig: () => ipcRenderer.invoke("ai:get-config"),
  refreshCodexCliStatus: () => ipcRenderer.invoke("ai:refresh-codex"),
  startCodexCliLogin: () => ipcRenderer.invoke("ai:start-codex-login"),
  createAiProvider: (provider) => ipcRenderer.invoke("ai:create-provider", provider || {}),
  deleteAiProvider: (providerId) => ipcRenderer.invoke("ai:delete-provider", providerId || ""),
  saveAiConfig: (config) => ipcRenderer.invoke("ai:save-config", config || {}),
  testAiConfig: (config) => ipcRenderer.invoke("ai:test-config", config || {}),
  generateAi: (payload) => ipcRenderer.invoke("ai:generate", payload || {}),
  cancelAi: (requestId) => ipcRenderer.invoke("ai:cancel", requestId || ""),
  exportAiChat: (payload) => ipcRenderer.invoke("ai:export-chat", payload || {}),
  onAiChunk: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:chunk", listener);
    return () => ipcRenderer.removeListener("ai:chunk", listener);
  },
  onAiDone: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:done", listener);
    return () => ipcRenderer.removeListener("ai:done", listener);
  },
  onAiError: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:error", listener);
    return () => ipcRenderer.removeListener("ai:error", listener);
  },
  onCodexCliStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:codex-status", listener);
    return () => ipcRenderer.removeListener("ai:codex-status", listener);
  },
  openDocument: () => ipcRenderer.invoke("document:open"),
  openDocumentPath: (filePath) => ipcRenderer.invoke("document:open-path", filePath || ""),
  openFolder: () => ipcRenderer.invoke("folder:open"),
  listFolder: (folderPath) => ipcRenderer.invoke("folder:list", folderPath || ""),
  copyFolderPath: (folderPath) => ipcRenderer.invoke("folder:copy-path", folderPath || ""),
  showFolder: (folderPath) => ipcRenderer.invoke("folder:show", folderPath || ""),
  createFolder: (parentPath, name) => ipcRenderer.invoke("folder:create", parentPath || "", name || ""),
  createDocumentInFolder: (folderPath, title, templateDocument) => (
    ipcRenderer.invoke("document:create-in-folder", folderPath || "", title || "", templateDocument || {})
  ),
  renameEntry: (targetPath, nextName) => ipcRenderer.invoke("entry:rename", targetPath || "", nextName || ""),
  deleteEntry: (targetPath) => ipcRenderer.invoke("entry:delete", targetPath || ""),
  moveEntry: (sourcePath, targetFolderPath) => ipcRenderer.invoke("entry:move", sourcePath || "", targetFolderPath || ""),
  backupDocument: (filePath) => ipcRenderer.invoke("document:backup", filePath || ""),
  saveDocument: (document, currentPath, saveAs = false, reservedPaths = []) =>
    ipcRenderer.invoke(
      "document:save",
      document,
      currentPath || "",
      Boolean(saveAs),
      Array.isArray(reservedPaths)
        ? reservedPaths.filter((value) => typeof value === "string").slice(0, 100).map((value) => value.slice(0, 32768))
        : [],
    ),
  saveTempDocument: (document, tabId) => ipcRenderer.invoke("autosave:save-tab", document, tabId || ""),
  deleteTempDocument: (tabId) => ipcRenderer.invoke("autosave:delete-tab", tabId || ""),
  pickExportPath: (format, suggestedName) => (
    ipcRenderer.invoke("document:pick-export-path", format === "images" ? "images" : "pdf", suggestedName || "未命名信笺")
  ),
  exportPdf: (suggestedName, targetPath) => (
    ipcRenderer.invoke("document:export-pdf", suggestedName || "未命名信笺", targetPath || "")
  ),
  exportPageImages: (suggestedName, pageRects, targetPath) => (
    ipcRenderer.invoke(
      "document:export-page-images",
      suggestedName || "未命名信笺",
      Array.isArray(pageRects) ? pageRects : [],
      targetPath || "",
    )
  ),
  onExportProgress: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("document:export-progress", listener);
    return () => ipcRenderer.removeListener("document:export-progress", listener);
  },
  pickImage: () => ipcRenderer.invoke("asset:pick-image"),
  pickAudio: () => ipcRenderer.invoke("asset:pick-audio"),
  pickVideo: () => ipcRenderer.invoke("asset:pick-video"),
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
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
  confirmClose: (payload) => ipcRenderer.invoke("app:confirm-close", payload || {}),
  closeReady: (payload) => ipcRenderer.invoke("app:close-ready", payload || {}),
  closeCanceled: (payload) => ipcRenderer.invoke("app:close-canceled", payload || {}),
  onCloseRequest: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("app:close-request", listener);
    return () => ipcRenderer.removeListener("app:close-request", listener);
  },
});
