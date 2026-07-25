function registerAiGenerationIpcHandlers({
  ipcMain,
  generationFacade,
}) {
  ipcMain.handle("ai:generate", async (event, payload) => (
    generationFacade.generate(event, payload)
  ));

  ipcMain.handle("ai:resolve-apply", async (_event, payload = {}) => (
    generationFacade.resolveApply(payload)
  ));

  ipcMain.handle("ai:cancel", async (_event, requestId) => (
    generationFacade.cancel(requestId)
  ));

  ipcMain.handle("ai:export-chat", async (_event, payload) => (
    generationFacade.exportChat(payload)
  ));
}

module.exports = {
  registerAiGenerationIpcHandlers,
};
