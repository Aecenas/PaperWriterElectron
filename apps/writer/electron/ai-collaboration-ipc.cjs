function registerAiCollaborationIpcHandlers({ ipcMain, collaborationFacade }) {
  ipcMain.handle("ai-collaboration:route", (event, payload) => collaborationFacade.route(event.sender, payload || {}));
  ipcMain.handle("ai-collaboration:plan", (event, payload) => collaborationFacade.plan(event.sender, payload || {}));
  ipcMain.handle("ai-collaboration:cancel", (_event, requestId) => collaborationFacade.cancel(requestId || ""));
  ipcMain.handle("ai-collaboration:validate", (_event, payload) => collaborationFacade.validateProposalSources(payload || {}));
  ipcMain.handle("ai-collaboration:prepare", (_event, payload) => collaborationFacade.prepareCommit(payload || {}));
  ipcMain.handle("ai-collaboration:commit", (_event, commitId) => collaborationFacade.commitPrepared(commitId || ""));
  ipcMain.handle("ai-collaboration:abort", (_event, commitId) => collaborationFacade.abortPrepared(commitId || ""));
}

module.exports = {
  registerAiCollaborationIpcHandlers,
};
