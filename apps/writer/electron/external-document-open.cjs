const nodePath = require("node:path");

function createExternalDocumentOpenRuntime({
  app,
  argv = process.argv,
  workingDirectory = process.cwd(),
  isDefaultApp = Boolean(process.defaultApp),
  path = nodePath,
  platform = process.platform,
  getMainWindow,
  isSupportedDocument,
  canonicalExistingPath,
  authorizeDocumentPath,
  writeDebugLog = async () => {},
}) {
  const pendingPaths = new Map();

  function revealWindow() {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  function enqueuePaths(values, cwd = workingDirectory) {
    for (const value of values) {
      if (typeof value !== "string" || !value || value.startsWith("-")) continue;
      const candidate = value.replace(/^"(.*)"$/, "$1");
      if (!isSupportedDocument(candidate)) continue;
      const filePath = path.resolve(cwd, candidate);
      const key = platform === "win32" ? filePath.toLowerCase() : filePath;
      pendingPaths.set(key, filePath);
    }
    const window = getMainWindow();
    if (pendingPaths.size && window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
      // The queue survives startup and reloads; this event only prompts a pull.
      window.webContents.send("document:external-open-request", {});
    }
  }

  async function takeRequests() {
    const requestedPaths = [...pendingPaths.values()];
    pendingPaths.clear();
    const requests = [];
    for (const filePath of requestedPaths) {
      try {
        const canonicalPath = await canonicalExistingPath(filePath, "file");
        if (!isSupportedDocument(canonicalPath)) throw new Error("请选择信笺文件");
        // An OS open action grants access to this file, not its parent folder.
        const authorizedPath = await authorizeDocumentPath(canonicalPath);
        requests.push({ path: authorizedPath });
      } catch (error) {
        const message = String(error?.message || "文档打开失败").slice(0, 500);
        requests.push({ path: filePath, error: message });
        await writeDebugLog("document:external-open:error", {
          filePath,
          message,
        }).catch(() => {});
      }
    }
    return requests;
  }

  app.on("second-instance", (_event, commandLine, cwd) => {
    enqueuePaths(commandLine.slice(isDefaultApp ? 2 : 1), cwd || workingDirectory);
    revealWindow();
  });
  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    enqueuePaths([filePath]);
    revealWindow();
  });
  enqueuePaths(argv.slice(isDefaultApp ? 2 : 1));

  return { takeRequests };
}

function registerExternalDocumentOpenIpcHandlers({ ipcMain, externalDocumentOpen }) {
  ipcMain.handle("document:take-external-open-requests", () => externalDocumentOpen.takeRequests());
}

module.exports = { createExternalDocumentOpenRuntime, registerExternalDocumentOpenIpcHandlers };
