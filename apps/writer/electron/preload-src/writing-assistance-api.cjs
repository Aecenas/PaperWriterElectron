const { subscribeToIpc } = require("./subscriptions.cjs");

function createWritingAssistanceApi(ipcRenderer) {
  return {
    getWritingAssistance: () => ipcRenderer.invoke("writing-assistance:get"),
    saveWritingAssistance: (patch) => ipcRenderer.invoke("writing-assistance:save", patch || {}),
    addWritingDictionaryWord: (word) => ipcRenderer.invoke("writing-assistance:add-word", word || ""),
    removeWritingDictionaryWord: (word) => ipcRenderer.invoke("writing-assistance:remove-word", word || ""),
    onDocumentContextMenuRequest: (callback) => (
      subscribeToIpc(
        ipcRenderer,
        "writing-assistance:document-context-menu",
        callback,
        true,
      )
    ),
  };
}

module.exports = {
  createWritingAssistanceApi,
};
