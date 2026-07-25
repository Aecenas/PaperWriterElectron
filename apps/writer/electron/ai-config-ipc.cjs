function registerAiConfigIpcHandlers({
  ipcMain,
  configFacade,
}) {
  ipcMain.handle("ai:get-config", async () => (
    configFacade.getConfig()
  ));

  ipcMain.handle("ai:refresh-codex", async () => (
    configFacade.refreshCodex()
  ));

  ipcMain.handle("ai:start-codex-login", async () => (
    configFacade.startLogin()
  ));

  ipcMain.handle("ai:create-provider", async (_event, input) => (
    configFacade.createProvider(input || {})
  ));

  ipcMain.handle("ai:delete-provider", async (_event, provider) => (
    configFacade.deleteProvider(String(provider || ""))
  ));

  ipcMain.handle("ai:save-config", async (_event, patch) => (
    configFacade.saveConfig(patch || {})
  ));

  ipcMain.handle("ai:test-config", async (_event, patch) => (
    configFacade.testConfig(patch || {})
  ));
}

module.exports = {
  registerAiConfigIpcHandlers,
};
