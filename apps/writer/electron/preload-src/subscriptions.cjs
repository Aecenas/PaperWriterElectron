function subscribeToIpc(ipcRenderer, channel, callback, emptyObjectFallback = false) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, payload) => callback(emptyObjectFallback ? (payload || {}) : payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

module.exports = {
  subscribeToIpc,
};
