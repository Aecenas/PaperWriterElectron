function registerHelpAssistantIpcHandlers({ ipcMain, helpAssistantFacade }) {
  ipcMain.handle("help-ai:get-state", () => helpAssistantFacade.getState());
  ipcMain.handle("help-ai:create-session", () => helpAssistantFacade.createSession());
  ipcMain.handle("help-ai:set-active-session", (_event, sessionId) => (
    helpAssistantFacade.setActiveSession(sessionId)
  ));
  ipcMain.handle("help-ai:rename-session", (_event, payload) => (
    helpAssistantFacade.renameSession(payload || {})
  ));
  ipcMain.handle("help-ai:delete-session", (_event, sessionId) => (
    helpAssistantFacade.deleteSession(sessionId)
  ));
  ipcMain.handle("help-ai:generate", (event, payload) => (
    helpAssistantFacade.generate(event, payload || {})
  ));
  ipcMain.handle("help-ai:cancel", (_event, requestId) => (
    helpAssistantFacade.cancel(requestId)
  ));
}

module.exports = { registerHelpAssistantIpcHandlers };
