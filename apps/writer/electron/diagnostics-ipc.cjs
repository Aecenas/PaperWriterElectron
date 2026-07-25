function registerDiagnosticsIpcHandlers({
  ipcMain,
  writeDebugLog,
}) {
  ipcMain.handle("debug:log", async (_event, event, data) => {
    await writeDebugLog(String(event || "renderer"), data || {});
    return { ok: true };
  });
}

module.exports = {
  registerDiagnosticsIpcHandlers,
};
