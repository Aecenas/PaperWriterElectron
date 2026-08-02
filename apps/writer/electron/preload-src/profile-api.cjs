function createProfileApi(ipcRenderer) {
  return {
    exportProfile: (payload) => ipcRenderer.invoke("profile:export", payload || {}),
    inspectProfile: (payload) => ipcRenderer.invoke("profile:inspect", payload || {}),
    verifyProfile: (payload) => ipcRenderer.invoke("profile:verify", payload || {}),
    importProfile: (payload) => ipcRenderer.invoke("profile:import", payload || {}),
    commitProfileImport: (payload) => ipcRenderer.invoke("profile:commit", payload || {}),
    rollbackProfileImport: (payload) => ipcRenderer.invoke("profile:rollback", payload || {}),
  };
}

module.exports = {
  createProfileApi,
};
