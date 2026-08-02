const { createAiApi } = require("./ai-api.cjs");
const { createCitationApi } = require("./citation-api.cjs");
const { createCompositionApi } = require("./composition-api.cjs");
const { createDocumentApi } = require("./document-api.cjs");
const { createHistoryApi } = require("./history-api.cjs");
const { createProfileApi } = require("./profile-api.cjs");
const { createResearchApi } = require("./research-api.cjs");
const { createWindowUpdateApi } = require("./window-update-api.cjs");
const { createWorkspaceApi } = require("./workspace-api.cjs");
const { createWritingAssistanceApi } = require("./writing-assistance-api.cjs");

function createPaperWriterApi(ipcRenderer) {
  return {
    isElectron: true,
    ...createWindowUpdateApi(ipcRenderer),
    ...createAiApi(ipcRenderer),
    ...createCompositionApi(ipcRenderer),
    ...createCitationApi(ipcRenderer),
    ...createDocumentApi(ipcRenderer),
    ...createHistoryApi(ipcRenderer),
    ...createProfileApi(ipcRenderer),
    ...createWorkspaceApi(ipcRenderer),
    ...createResearchApi(ipcRenderer),
    ...createWritingAssistanceApi(ipcRenderer),
  };
}

module.exports = {
  createPaperWriterApi,
};
