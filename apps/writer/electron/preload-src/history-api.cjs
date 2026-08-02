function createHistoryApi(ipcRenderer) {
  return {
    listDocumentHistory: (documentId, currentSha256 = "") => (
      currentSha256
        ? ipcRenderer.invoke("history:list", documentId || "", currentSha256)
        : ipcRenderer.invoke("history:list", documentId || "")
    ),
    readDocumentHistory: (payload) => ipcRenderer.invoke("history:read", payload || {}),
    createDocumentHistory: (payload) => ipcRenderer.invoke("history:create", payload || {}),
    updateDocumentHistory: (payload) => ipcRenderer.invoke("history:pin", payload || {}),
    deleteDocumentHistory: (payload) => ipcRenderer.invoke("history:delete", payload || {}),
    restoreDocumentHistory: (payload) => ipcRenderer.invoke("history:restore", payload || {}),
    clearAutomaticDocumentHistory: (documentId) => ipcRenderer.invoke("history:clear-auto", documentId || ""),
    clearDocumentHistory: (documentId) => ipcRenderer.invoke("history:clear", documentId || ""),
  };
}

module.exports = {
  createHistoryApi,
};
