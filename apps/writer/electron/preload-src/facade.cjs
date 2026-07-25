const { createAiApi } = require("./ai-api.cjs");
const { createDocumentApi } = require("./document-api.cjs");
const { createResearchApi } = require("./research-api.cjs");
const { createWindowUpdateApi } = require("./window-update-api.cjs");
const { createWorkspaceApi } = require("./workspace-api.cjs");

function createPaperWriterApi(ipcRenderer) {
  return {
    isElectron: true,
    ...createWindowUpdateApi(ipcRenderer),
    ...createAiApi(ipcRenderer),
    ...createDocumentApi(ipcRenderer),
    ...createWorkspaceApi(ipcRenderer),
    ...createResearchApi(ipcRenderer),
  };
}

module.exports = {
  createPaperWriterApi,
};
