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
    routeAiCollaboration: (payload) => ipcRenderer.invoke("ai-collaboration:route", payload || {}),
    planAiCollaboration: (payload) => ipcRenderer.invoke("ai-collaboration:plan", payload || {}),
    cancelAiCollaboration: (requestId) => ipcRenderer.invoke("ai-collaboration:cancel", requestId || ""),
    validateAiCollaborationProposal: (payload) => ipcRenderer.invoke("ai-collaboration:validate", payload || {}),
    prepareAiCollaborationCommit: (payload) => ipcRenderer.invoke("ai-collaboration:prepare", payload || {}),
    commitAiCollaboration: (commitId) => ipcRenderer.invoke("ai-collaboration:commit", commitId || ""),
    abortAiCollaborationCommit: (commitId) => ipcRenderer.invoke("ai-collaboration:abort", commitId || ""),
    getHelpAssistantState: () => ipcRenderer.invoke("help-ai:get-state"),
    createHelpAssistantSession: () => ipcRenderer.invoke("help-ai:create-session"),
    setActiveHelpAssistantSession: (sessionId) => ipcRenderer.invoke("help-ai:set-active-session", sessionId || ""),
    renameHelpAssistantSession: (payload) => ipcRenderer.invoke("help-ai:rename-session", payload || {}),
    deleteHelpAssistantSession: (sessionId) => ipcRenderer.invoke("help-ai:delete-session", sessionId || ""),
    generateHelpAssistant: (payload) => ipcRenderer.invoke("help-ai:generate", payload || {}),
    cancelHelpAssistant: (requestId) => ipcRenderer.invoke("help-ai:cancel", requestId || ""),
    translateResearchContent: (payload) => ipcRenderer.invoke("research-translation:translate", payload || {}),
    cancelResearchTranslation: (requestId) => ipcRenderer.invoke("research-translation:cancel", requestId || ""),
    onAiChunk: (callback) => subscribeToIpc(ipcRenderer, "ai:chunk", callback),
    onAiDone: (callback) => subscribeToIpc(ipcRenderer, "ai:done", callback),
    onAiError: (callback) => subscribeToIpc(ipcRenderer, "ai:error", callback),
    onAiCollaborationEvent: (callback) => subscribeToIpc(ipcRenderer, "ai-collaboration:event", callback),
    onHelpAssistantChunk: (callback) => subscribeToIpc(ipcRenderer, "help-ai:chunk", callback),
    onHelpAssistantDone: (callback) => subscribeToIpc(ipcRenderer, "help-ai:done", callback),
    onHelpAssistantError: (callback) => subscribeToIpc(ipcRenderer, "help-ai:error", callback),
    onResearchTranslationProgress: (callback) => subscribeToIpc(ipcRenderer, "research-translation:progress", callback),
    onCodexCliStatus: (callback) => subscribeToIpc(ipcRenderer, "ai:codex-status", callback),
  };
}

module.exports = {
  createAiApi,
};
