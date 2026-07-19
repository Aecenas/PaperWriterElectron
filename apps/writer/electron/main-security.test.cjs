const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

async function mainSource() {
  return fs.readFile(path.join(__dirname, "main.cjs"), "utf8");
}

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return source.slice(start, end);
}

test("keeps the renderer sandboxed and gates every registered IPC handler", async () => {
  const source = await mainSource();
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /sender\s*!==\s*mainWindow\.webContents/);
  assert.match(source, /senderFrame\s*!==\s*sender\.mainFrame/);
  assert.match(source, /ipcMain\.handle\s*=.*assertTrustedIpcSender/s);
  assert.match(source, /setWindowOpenHandler\(\(\)\s*=>\s*\(\{\s*action:\s*"deny"/);
  assert.match(source, /will-download.*preventDefault/s);
});

test("allows production file requests only from the bundled frontend tree", async () => {
  const source = await mainSource();
  assert.match(source, /onBeforeRequest\(\{\s*urls:\s*\["file:\/\/\/\*"\]/);
  assert.match(source, /cancel:\s*!isTrustedFrontendResourceUrl\(details\.url\)/);
  assert.match(source, /connect-src 'none'/);
  assert.match(source, /frame-ancestors 'none'/);
});

test("defers update installation until the renderer completes its close-save flow", async () => {
  const source = await mainSource();
  const installHandler = between(source, 'ipcMain.handle("update:install"', 'ipcMain.handle("document:open"');
  assert.match(installHandler, /pendingUpdateInstall\s*=\s*true/);
  assert.match(installHandler, /mainWindow\.close\(\)/);
  assert.doesNotMatch(installHandler, /quitAndInstall/);

  const closeReadyHandler = between(source, 'ipcMain.handle("app:close-ready"', 'ipcMain.handle("app:close-canceled"');
  assert.match(closeReadyHandler, /pendingUpdateInstall/);
  assert.match(closeReadyHandler, /quitAndInstall/);
});

test("restores a minimized close confirmation and requests Windows taskbar attention", async () => {
  const source = await mainSource();
  const revealHelper = between(source, "function revealCloseConfirmation", "function createWindow");
  const closeHandler = between(source, 'mainWindow.on("close"', 'mainWindow.on("focus"');
  const focusHandler = between(source, 'mainWindow.on("focus"', 'mainWindow.on("blur"');
  const cancelHandler = between(source, 'ipcMain.handle("app:close-canceled"', 'app.whenReady()');

  assert.match(revealHelper, /mainWindow\.flashFrame\(true\)/);
  assert.match(revealHelper, /mainWindow\.isMinimized\(\).*mainWindow\.restore\(\)/s);
  assert.match(revealHelper, /mainWindow\.isVisible\(\).*mainWindow\.show\(\)/s);
  assert.match(revealHelper, /mainWindow\.focus\(\)/);
  assert.match(closeHandler, /revealCloseConfirmation\(\)/);
  assert.match(focusHandler, /stopCloseAttention\(\)/);
  assert.match(cancelHandler, /stopCloseAttention\(\)/);
  assert.match(source, /mainWindow\.flashFrame\(false\)/);
});

test("an unavailable renderer cannot trap the native window close handshake", async () => {
  const source = await mainSource();
  const unavailableHelper = between(source, "function markRendererUnavailable", "function createWindow");
  const closeHandler = between(source, 'mainWindow.on("close"', 'mainWindow.on("unresponsive"');

  assert.match(source, /webContents\.on\("render-process-gone"/);
  assert.match(source, /mainWindow\.on\("unresponsive"/);
  assert.match(source, /mainWindow\.on\("responsive"/);
  assert.match(unavailableHelper, /closeRequestInFlight/);
  assert.match(unavailableHelper, /forceCloseWindow\s*=\s*true/);
  assert.match(unavailableHelper, /mainWindow\.close\(\)/);
  assert.match(closeHandler, /!rendererCanConfirmClose/);
  assert.match(closeHandler, /mainWindow\.webContents\.isDestroyed\(\)/);
});

test("does not expose internal app paths or the selected image source path", async () => {
  const source = await mainSource();
  const getPathsHandler = between(source, 'ipcMain.handle("app:get-paths"', 'ipcMain.handle("debug:log"');
  assert.doesNotMatch(getPathsHandler, /userData|aiDebugLog|desktop|autosave/);
  const pickImageHandler = between(source, 'ipcMain.handle("asset:pick-image"', 'ipcMain.handle("asset:pick-audio"');
  assert.doesNotMatch(pickImageHandler, /path:\s*filePath/);
  assert.doesNotMatch(pickImageHandler, /All Files|extensions:\s*\["\*"\]/);
  assert.match(pickImageHandler, /IMAGE_EXTENSIONS\.includes\(extension\)/);
  assert.match(pickImageHandler, /src:\s*staged\.src/);
});

test("hardens the packaged Electron binary with production fuses", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(__dirname, "package.json"), "utf8"));
  const fuses = packageJson.build?.electronFuses;
  assert.equal(packageJson.build?.asar, true);
  assert.equal(packageJson.build?.extraResources, undefined);
  assert.ok(packageJson.build?.files?.some((entry) => entry?.from === "../frontend/dist" && entry?.to === "frontend/dist"));
  assert.equal(fuses?.runAsNode, false);
  assert.equal(fuses?.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(fuses?.enableNodeCliInspectArguments, false);
  assert.equal(fuses?.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(fuses?.onlyLoadAppFromAsar, true);
});

test("keeps restored temporary documents bound to their original recovery id", async () => {
  const source = await mainSource();
  const sessionPath = between(source, "function autosaveSessionPath", "async function ensureParentDir");
  assert.match(sessionPath, /\^\[a-zA-Z0-9_-\]\{1,80\}\$/);
  assert.match(sessionPath, /autosaveSessionIdForPath/);
  const openPath = between(source, 'ipcMain.handle("document:open-path"', 'ipcMain.handle("folder:open"');
  assert.match(openPath, /recoveryId\s*\?\s*\{\s*recoveryId\s*\}/);
  const saveTab = between(source, 'ipcMain.handle("autosave:save-tab"', 'ipcMain.handle("autosave:delete-tab"');
  assert.match(saveTab, /recoveryId:/);
});

test("rebases live document resource tokens after Save As", async () => {
  const source = await mainSource();
  const saveHandler = between(source, 'ipcMain.handle("document:save"', "function exportSafeName");
  assert.match(saveHandler, /userSelectedTarget\s*&&\s*sourceKey\s*&&\s*sourceKey\s*!==\s*targetKey/);
  assert.match(saveHandler, /rebaseAssetPathReferences\(sourcePath, filePath\)/);
});

test("serializes saves with rename, move, delete and recovery cleanup", async () => {
  const source = await mainSource();
  const saveFunction = between(source, "async function savePaperDocument", "async function loadPaperDocument");
  assert.match(saveFunction, /runDocumentMutation/);
  for (const [start, end] of [
    ['ipcMain.handle("entry:rename"', 'ipcMain.handle("entry:delete"'],
    ['ipcMain.handle("entry:delete"', 'ipcMain.handle("entry:move"'],
    ['ipcMain.handle("entry:move"', 'ipcMain.handle("document:backup"'],
    ['ipcMain.handle("document:backup"', "async function listAuthorizedFolderEntries"],
    ['ipcMain.handle("autosave:delete-tab"', 'ipcMain.handle("autosave:clear"'],
  ]) {
    assert.match(between(source, start, end), /runDocumentMutation/);
  }
  const saveHandler = between(source, 'ipcMain.handle("document:save"', "function exportSafeName");
  assert.match(saveHandler, /validateTarget/);
  assert.match(saveHandler, /目标信笺已被移动、删除或替换/);
});

test("selects a unique folder document path inside the same mutation as its commit", async () => {
  const source = await mainSource();
  const handler = between(source, 'ipcMain.handle("document:create-in-folder"', 'ipcMain.handle("entry:rename"');
  assert.match(handler, /runDocumentMutation/);
  assert.match(handler, /uniquePath/);
  assert.match(handler, /savePaperDocumentWithinMutation/);
  assert.ok(handler.indexOf("uniquePath") < handler.indexOf("savePaperDocumentWithinMutation"));
});

test("deduplicates and budgets packaged resource extraction and revokes deleted caches", async () => {
  const source = await mainSource();
  const loader = between(source, "async function getAssetZip", "async function readPackagedAsset");
  assert.match(loader, /assetZipPending\.has/);
  assert.match(loader, /assetCacheGeneration/);
  const materializer = between(source, "async function materializePackagedAsset", "async function resolveProtocolAssetFile");
  assert.match(materializer, /extractedAssetLimiter\.acquire/);
  assert.match(materializer, /releaseExtractionSlot\(\)/);
  assert.match(materializer, /信笺资源来源已被移动、删除或替换/);
  const deleteHandler = between(source, 'ipcMain.handle("entry:delete"', 'ipcMain.handle("entry:move"');
  assert.match(deleteHandler, /invalidateDocumentCachesForPath\(currentPath, true, \{ revokeReferences: true \}\)/);
});

test("bounds saved AI state and keeps image maps immune to prototype keys", async () => {
  const source = await mainSource();
  assert.match(source, /SAVED_AI_IMAGE_LIMIT\s*=\s*2048/);
  assert.match(source, /SAVED_AI_QUOTE_LIMIT\s*=\s*1000/);
  assert.match(source, /SAVED_AI_MESSAGE_LIMIT\s*=\s*200/);
  assert.match(source, /SAVED_AI_MESSAGE_TOTAL_CHARS\s*=\s*8\s*\*\s*1024\s*\*\s*1024/);
  assert.equal((source.match(/const nextImages = Object\.create\(null\)/g) || []).length, 2);
});

test("resolves AI providers with own-property checks", async () => {
  const source = await mainSource();
  const resolver = between(source, "function resolveAiProvider", "async function readAiConfig");
  assert.match(resolver, /Object\.prototype\.hasOwnProperty\.call\(normalized\.providers, provider\)/);
});

test("task models validate explicit assignments and fall back only when unconfigured", async () => {
  const source = await mainSource();
  const saver = between(source, "function mergeAndValidateAiTaskModels", "async function saveAiConfigUnlocked");
  assert.match(saver, /exactAiProviderConfig\(existing, assignment\.providerId, assignment\.modelId\)/);
  assert.match(saver, /resolver\.apiKey \|\| !resolver\.testedOk/);
  assert.match(saver, /codexRuntimeStatus\.ready/);
  assert.match(saver, /validateAiRequestParamsPatch\(source\.requestParams \|\| \{\}\)/);
  assert.match(saver, /Codex CLI 任务模型不支持 HTTP 请求参数/);
  const resolver = between(source, 'ipcMain.handle("ai:resolve-apply"', 'ipcMain.handle("ai:cancel"');
  assert.match(resolver, /taskAiProviderConfig\(config, taskModel\)/);
  assert.match(resolver, /hasExplicitTaskModel \? taskModel\.requestParams : \{\}/);
  assert.match(resolver, /AI 配置 → 任务模型/);
  assert.match(resolver, /默认模型不可用/);
});

test("drops stale AI test results before they can overwrite a newer configuration", async () => {
  const source = await mainSource();
  const updater = between(source, "function storedAiTestConfigIdentity", "async function readAiErrorBody");
  assert.match(updater, /createAiTestConfigIdentity/);
  assert.match(updater, /commitAiTestResultIfCurrent/);
  assert.match(updater, /identityFromCurrent/);
  const handler = between(source, 'ipcMain.handle("ai:test-config"', 'ipcMain.handle("ai:generate"');
  assert.match(handler, /expectedIdentity = storedAiTestConfigIdentity/);
  assert.equal((handler.match(/expectedIdentity\)/g) || []).length, 2);
  assert.equal((handler.match(/if \(commitResult\.stale\)/g) || []).length, 2);
  assert.equal((handler.match(/stale: true/g) || []).length, 2);
});

test("always gives Codex a fresh isolated scope", async () => {
  const source = await mainSource();
  const streamer = between(source, "async function streamCodexForPayload", "function sanitizeName");
  assert.match(streamer, /resolveCodexScopeDirectory/);
  assert.doesNotMatch(streamer, /workspacePath|documentPath|fs\.stat/);
});
