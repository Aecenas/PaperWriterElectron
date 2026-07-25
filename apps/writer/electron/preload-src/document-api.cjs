const { subscribeToIpc } = require("./subscriptions.cjs");

function createDocumentApi(ipcRenderer) {
  return {
    openDocument: () => ipcRenderer.invoke("document:open"),
    openDocumentPath: (filePath) => ipcRenderer.invoke("document:open-path", filePath || ""),
    importDocument: () => ipcRenderer.invoke("document:import"),
    exportEditable: (document, format, targetPath = "") => ipcRenderer.invoke("document:export-editable", {
      document: document || {},
      format: format || "",
      targetPath: targetPath || "",
    }),
    getDocumentRevision: (filePath) => ipcRenderer.invoke("document:revision", filePath || ""),
    regenerateDocumentIdentity: (filePath, force = false) => (
      ipcRenderer.invoke("document:regenerate-identity", filePath || "", Boolean(force))
    ),
    backupDocument: (filePath) => ipcRenderer.invoke("document:backup", filePath || ""),
    saveDocument: (document, currentPath, saveAs = false, reservedPaths = [], expectedRevision = null, options = {}) =>
      ipcRenderer.invoke(
        "document:save",
        document,
        currentPath || "",
        Boolean(saveAs),
        Array.isArray(reservedPaths)
          ? reservedPaths.filter((value) => typeof value === "string").slice(0, 100).map((value) => value.slice(0, 32768))
          : [],
        expectedRevision || null,
        options && typeof options === "object" ? options : {},
      ),
    saveTempDocument: (document, tabId) => ipcRenderer.invoke("autosave:save-tab", document, tabId || ""),
    deleteTempDocument: (tabId) => ipcRenderer.invoke("autosave:delete-tab", tabId || ""),
    pickExportPath: (format, suggestedName, initialDirectory) => (
      ipcRenderer.invoke(
        "document:pick-export-path",
        ["images", "pdf", "markdown", "html", "txt", "docx"].includes(format) ? format : "pdf",
        suggestedName || "未命名信笺",
        typeof initialDirectory === "string" ? initialDirectory.slice(0, 32768) : "",
      )
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
    onExportProgress: (callback) => subscribeToIpc(ipcRenderer, "document:export-progress", callback),
    pickImage: () => ipcRenderer.invoke("asset:pick-image"),
    pickAudio: () => ipcRenderer.invoke("asset:pick-audio"),
    pickVideo: () => ipcRenderer.invoke("asset:pick-video"),
    writeClipboardContent: (payload) => (
      ipcRenderer.invoke("clipboard:write-content", payload && typeof payload === "object" ? payload : {})
    ),
    copyImageReference: (payload) => (
      ipcRenderer.invoke("clipboard:write-image-reference", payload && typeof payload === "object" ? payload : {})
    ),
    openExternal: (url) => ipcRenderer.invoke("external:open", url),
    loadAutosave: () => ipcRenderer.invoke("autosave:load"),
    saveAutosave: (document) => ipcRenderer.invoke("autosave:save", document),
    clearAutosave: () => ipcRenderer.invoke("autosave:clear"),
  };
}

module.exports = {
  createDocumentApi,
};
