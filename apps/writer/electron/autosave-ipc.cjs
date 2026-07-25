function registerAutosaveIpcHandlers({
  ipcMain,
  storageFacade,
}) {
  const {
    clearAutosave,
    deleteAutosaveTab,
    loadAutosave,
    saveAutosave,
    saveAutosaveTab,
  } = storageFacade;
  ipcMain.handle("autosave:load", async () => loadAutosave());
  ipcMain.handle(
    "autosave:save",
    async (_event, document) => saveAutosave(document),
  );
  ipcMain.handle(
    "autosave:save-tab",
    async (_event, document, tabId) => (
      saveAutosaveTab(document, tabId)
    ),
  );
  ipcMain.handle(
    "autosave:delete-tab",
    async (_event, tabId) => deleteAutosaveTab(tabId),
  );
  ipcMain.handle(
    "autosave:clear",
    async () => clearAutosave(),
  );
}

module.exports = {
  registerAutosaveIpcHandlers,
};
