const { subscribeToIpc } = require("./subscriptions.cjs");

function createCompositionApi(ipcRenderer) {
  return {
    listCompositionJobs: () => ipcRenderer.invoke("composition:list"),
    getCompositionJob: (jobId) => ipcRenderer.invoke("composition:get", jobId || ""),
    createCompositionJob: (payload) => ipcRenderer.invoke("composition:create", payload || {}),
    updateCompositionJob: (payload) => ipcRenderer.invoke("composition:update", payload || {}),
    deleteCompositionJob: (jobId) => ipcRenderer.invoke("composition:delete", jobId || ""),
    generateCompositionOutline: (payload) => ipcRenderer.invoke("composition:generate-outline", payload || {}),
    generateCompositionSection: (payload) => ipcRenderer.invoke("composition:generate-section", payload || {}),
    reviewComposition: (payload) => ipcRenderer.invoke("composition:review", payload || {}),
    pauseComposition: (jobId) => ipcRenderer.invoke("composition:pause", jobId || ""),
    resumeComposition: (payload) => ipcRenderer.invoke("composition:resume", payload || {}),
    cancelComposition: (jobId) => ipcRenderer.invoke("composition:cancel", jobId || ""),
    finalizeComposition: (payload) => ipcRenderer.invoke("composition:finalize", payload || {}),
    onCompositionEvent: (callback) => subscribeToIpc(ipcRenderer, "composition:event", callback),
  };
}

module.exports = {
  createCompositionApi,
};

