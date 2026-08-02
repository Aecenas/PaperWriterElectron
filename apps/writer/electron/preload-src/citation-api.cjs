function createCitationApi(ipcRenderer) {
  return {
    parseCitations: (payload) => ipcRenderer.invoke("citation:parse", payload || {}),
    exportCitations: (payload) => ipcRenderer.invoke("citation:export", payload || {}),
    formatCitations: (payload) => ipcRenderer.invoke("citation:format", payload || {}),
    listCitationStyles: () => ipcRenderer.invoke("citation:styles"),
    validateCslStyle: (payload) => ipcRenderer.invoke("citation:validate-style", payload || {}),
    pickCitationStyle: () => ipcRenderer.invoke("citation:pick-style"),
    lookupCitation: (payload) => ipcRenderer.invoke("citation:lookup", payload || {}),
    pickCitationImport: (payload) => ipcRenderer.invoke("citation:pick-import", payload || {}),
    saveCitationExport: (payload) => ipcRenderer.invoke("citation:save-export", payload || {}),
    listPublicCitations: () => ipcRenderer.invoke("citation:public-list"),
    upsertPublicCitation: (source) => ipcRenderer.invoke("citation:public-upsert", source || {}),
    deletePublicCitation: (sourceId) => ipcRenderer.invoke("citation:public-delete", sourceId || ""),
    migrateWorkspaceCitationsToPublic: (workspacePath) => (
      ipcRenderer.invoke("citation:public-migrate", workspacePath || "")
    ),
  };
}

module.exports = {
  createCitationApi,
};
