function registerResearchTranslationIpcHandlers({ ipcMain, researchTranslationFacade }) {
  ipcMain.handle("research-translation:translate", (event, payload) => (
    researchTranslationFacade.translate(event, payload || {})
  ));
  ipcMain.handle("research-translation:cancel", (_event, requestId) => (
    researchTranslationFacade.cancel(requestId || "")
  ));
}

module.exports = { registerResearchTranslationIpcHandlers };
