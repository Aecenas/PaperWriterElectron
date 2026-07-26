const { subscribeToIpc } = require("./subscriptions.cjs");

function createAiApi(ipcRenderer) {
  return {
    getAiConfig: () => ipcRenderer.invoke("ai:get-config"),
    refreshCodexCliStatus: () => ipcRenderer.invoke("ai:refresh-codex"),
    startCodexCliLogin: () => ipcRenderer.invoke("ai:start-codex-login"),
    createAiProvider: (provider) => ipcRenderer.invoke("ai:create-provider", provider || {}),
    deleteAiProvider: (providerId) => ipcRenderer.invoke("ai:delete-provider", providerId || ""),
    saveAiConfig: (config) => ipcRenderer.invoke("ai:save-config", config || {}),
    testAiConfig: (config) => ipcRenderer.invoke("ai:test-config", config || {}),
    generateAi: (payload) => ipcRenderer.invoke("ai:generate", payload || {}),
    generateSelectionAi: (payload) => ipcRenderer.invoke("ai:selection-generate", payload || {}),
    resolveAiApply: (payload) => ipcRenderer.invoke("ai:resolve-apply", payload || {}),
    cancelAi: (requestId) => ipcRenderer.invoke("ai:cancel", requestId || ""),
    exportAiChat: (payload) => ipcRenderer.invoke("ai:export-chat", payload || {}),
    onAiChunk: (callback) => subscribeToIpc(ipcRenderer, "ai:chunk", callback),
    onAiDone: (callback) => subscribeToIpc(ipcRenderer, "ai:done", callback),
    onAiError: (callback) => subscribeToIpc(ipcRenderer, "ai:error", callback),
    onCodexCliStatus: (callback) => subscribeToIpc(ipcRenderer, "ai:codex-status", callback),
  };
}

module.exports = {
  createAiApi,
};
