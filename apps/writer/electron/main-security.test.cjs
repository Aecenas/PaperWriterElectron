const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

async function mainSource() {
  return fs.readFile(path.join(__dirname, "main.cjs"), "utf8");
}

async function ipcRegistrarSource() {
  return fs.readFile(path.join(__dirname, "ipc-registrar.cjs"), "utf8");
}

async function applicationIpcSource() {
  return fs.readFile(path.join(__dirname, "application-ipc.cjs"), "utf8");
}

async function aiConfigIpcSource() {
  return fs.readFile(path.join(__dirname, "ai-config-ipc.cjs"), "utf8");
}

async function aiGenerationIpcSource() {
  return fs.readFile(path.join(__dirname, "ai-generation-ipc.cjs"), "utf8");
}

async function aiConfigRuntimeSource() {
  return fs.readFile(path.join(__dirname, "ai-config-runtime.cjs"), "utf8");
}

async function aiGenerationRuntimeSource() {
  return fs.readFile(path.join(__dirname, "ai-generation-runtime.cjs"), "utf8");
}

async function documentOpenIpcSource() {
  return fs.readFile(path.join(__dirname, "document-open-ipc.cjs"), "utf8");
}

async function documentSaveIpcSource() {
  return fs.readFile(path.join(__dirname, "document-save-ipc.cjs"), "utf8");
}

async function documentModelSource() {
  return fs.readFile(path.join(__dirname, "document-model.cjs"), "utf8");
}

async function documentAssetsRuntimeSource() {
  return fs.readFile(
    path.join(__dirname, "document-assets-runtime.cjs"),
    "utf8",
  );
}

async function documentStorageRuntimeSource() {
  return fs.readFile(
    path.join(__dirname, "document-storage-runtime.cjs"),
    "utf8",
  );
}

async function autosaveIpcSource() {
  return fs.readFile(path.join(__dirname, "autosave-ipc.cjs"), "utf8");
}

async function resourceIpcSource() {
  return fs.readFile(path.join(__dirname, "resource-ipc.cjs"), "utf8");
}

async function workspaceFolderIpcSource() {
  return fs.readFile(path.join(__dirname, "workspace-folder-ipc.cjs"), "utf8");
}

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return source.slice(start, end);
}

test("keeps the renderer sandboxed and gates every registered IPC handler", async () => {
  const [source, registrarSource] = await Promise.all([mainSource(), ipcRegistrarSource()]);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /ipcMain:\s*electronIpcMain/);
  assert.match(source, /createTrustedIpcRegistrar\(\{\s*ipcMain:\s*electronIpcMain,\s*getMainWindow:\s*\(\)\s*=>\s*mainWindow,\s*isTrustedApplicationUrl/s);
  assert.doesNotMatch(source, /electronIpcMain\.handle/);
  assert.match(registrarSource, /sender\s*!==\s*mainWindow\.webContents/);
  assert.match(registrarSource, /senderFrame\s*!==\s*sender\.mainFrame/);
  assert.match(registrarSource, /assertTrustedIpcSender\(event/);
  assert.match(registrarSource, /registeredChannels\.has\(channel\)/);
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

test("delegates application IPC while retaining lifecycle state in main", async () => {
  const source = await mainSource();
  assert.match(source, /require\("\.\/application-ipc\.cjs"\)/);
  assert.match(source, /registerApplicationIpcHandlers\(\{/);
  assert.match(source, /getUpdateState:\s*\(\)\s*=>\s*updateState/);
  assert.match(source, /getCloseRequestInFlight:\s*\(\)\s*=>\s*closeRequestInFlight/);
  assert.match(source, /getPendingUpdateInstall:\s*\(\)\s*=>\s*pendingUpdateInstall/);
  assert.match(source, /setForceCloseWindow:\s*\(value\)\s*=>\s*\{\s*forceCloseWindow\s*=\s*value/);
  assert.doesNotMatch(source, /ipcMain\.handle\("update:/);
  assert.doesNotMatch(source, /ipcMain\.handle\("app:close-/);
});

test("restores a minimized close confirmation and requests Windows taskbar attention", async () => {
  const [source, applicationSource] = await Promise.all([mainSource(), applicationIpcSource()]);
  const revealHelper = between(source, "function revealCloseConfirmation", "function createWindow");
  const closeHandler = between(source, 'mainWindow.on("close"', 'mainWindow.on("focus"');
  const focusHandler = between(source, 'mainWindow.on("focus"', 'mainWindow.on("blur"');
  const cancelHandler = between(applicationSource, 'ipcMain.handle("app:close-canceled"', "module.exports");

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
  const [source, applicationSource, resourceSource] = await Promise.all([
    mainSource(),
    applicationIpcSource(),
    resourceIpcSource(),
  ]);
  const getPathsHandler = between(applicationSource, 'ipcMain.handle("app:get-paths"', 'ipcMain.handle("window:set-modal-overlay"');
  assert.doesNotMatch(getPathsHandler, /userData|aiDebugLog|desktop|autosave/);
  const pickImageHandler = between(
    resourceSource,
    'ipcMain.handle("asset:pick-image"',
    'ipcMain.handle("asset:pick-audio"',
  );
  assert.doesNotMatch(pickImageHandler, /path:\s*filePath/);
  assert.doesNotMatch(pickImageHandler, /All Files|extensions:\s*\["\*"\]/);
  assert.match(pickImageHandler, /imageExtensions\.includes\(extension\)/);
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
  const [storageSource, documentOpenSource] = await Promise.all([
    documentStorageRuntimeSource(),
    documentOpenIpcSource(),
  ]);
  const sessionPath = between(
    storageSource,
    "function autosaveSessionPath",
    "async function savePaperDocumentWithinTransaction",
  );
  assert.match(sessionPath, /\^\[a-zA-Z0-9_-\]\{1,80\}\$/);
  assert.match(sessionPath, /autosaveSessionIdForPath/);
  const openPath = between(
    documentOpenSource,
    'ipcMain.handle("document:open-path"',
    'ipcMain.handle("document:import"',
  );
  assert.match(openPath, /recoveryId\s*\?\s*\{\s*recoveryId\s*\}/);
  const saveTab = between(
    storageSource,
    "async function saveAutosaveTab",
    "function deleteAutosaveTab",
  );
  assert.match(saveTab, /recoveryId:/);
});

test("rebases live document resource tokens after Save As", async () => {
  const documentSaveSource = await documentSaveIpcSource();
  const saveHandler = between(
    documentSaveSource,
    'ipcMain.handle("document:save"',
    "module.exports",
  );
  assert.match(saveHandler, /userSelectedTarget\s*&&\s*sourceKey\s*&&\s*sourceKey\s*!==\s*targetKey/);
  assert.match(
    saveHandler,
    /transaction\.rebaseDocumentPath\(\s*sourcePath,\s*filePath/,
  );
});

test("serializes saves with rename, move, delete and recovery cleanup", async () => {
  const [storageSource, workspaceFolderSource, documentSaveSource] = await Promise.all([
    documentStorageRuntimeSource(),
    workspaceFolderIpcSource(),
    documentSaveIpcSource(),
  ]);
  const saveFunction = between(
    storageSource,
    "function savePaperDocument(filePath",
    "function preservePreV2MigrationBackup(filePath",
  );
  assert.match(saveFunction, /runDocumentTransaction/);
  for (const [start, end] of [
    ['ipcMain.handle("entry:rename"', 'ipcMain.handle("entry:delete"'],
    ['ipcMain.handle("entry:delete"', 'ipcMain.handle("entry:move"'],
    ['ipcMain.handle("entry:move"', "module.exports"],
  ]) {
    assert.match(
      between(workspaceFolderSource, start, end),
      /runDocumentTransaction/,
    );
  }
  assert.match(
    between(
      documentSaveSource,
      'ipcMain.handle("document:backup"',
      'ipcMain.handle("document:save"',
    ),
    /runDocumentTransaction/,
  );
  const autosaveMutations = between(
    storageSource,
    "function deleteAutosaveTab",
    "function importDocument",
  );
  assert.match(
    autosaveMutations,
    /runDocumentTransaction/,
  );
  const saveHandler = between(
    documentSaveSource,
    'ipcMain.handle("document:save"',
    "module.exports",
  );
  assert.match(saveHandler, /validateTarget/);
  assert.match(saveHandler, /目标信笺已被移动、删除或替换/);
});

test("selects a unique folder document path inside the same mutation as its commit", async () => {
  const documentSaveSource = await documentSaveIpcSource();
  const handler = between(
    documentSaveSource,
    'ipcMain.handle("document:create-in-folder"',
    'ipcMain.handle("document:backup"',
  );
  assert.match(handler, /runDocumentTransaction/);
  assert.match(handler, /uniquePath/);
  assert.match(handler, /transaction\.savePaperDocument/);
  assert.ok(
    handler.indexOf("uniquePath")
      < handler.indexOf("transaction.savePaperDocument"),
  );
});

test("deduplicates and budgets packaged resource extraction and revokes deleted caches", async () => {
  const [assetsSource, workspaceFolderSource] = await Promise.all([
    documentAssetsRuntimeSource(),
    workspaceFolderIpcSource(),
  ]);
  const loader = between(assetsSource, "async function getAssetZip", "async function readPackagedAsset");
  assert.match(loader, /assetZipPending\.has/);
  assert.match(loader, /assetCacheGeneration/);
  const materializer = between(assetsSource, "async function materializePackagedAsset", "async function resolveProtocolAssetFile");
  assert.match(materializer, /extractedAssetLimiter\.acquire/);
  assert.match(materializer, /releaseExtractionSlot\(\)/);
  assert.match(materializer, /信笺资源来源已被移动、删除或替换/);
  const deleteHandler = between(workspaceFolderSource, 'ipcMain.handle("entry:delete"', 'ipcMain.handle("entry:move"');
  assert.match(
    deleteHandler,
    /transaction\.invalidateDocumentPath\(\s*currentPath,\s*true,\s*\{\s*revokeReferences:\s*true/,
  );
});

test("bounds saved AI state and keeps image maps immune to prototype keys", async () => {
  const [assetsSource, modelSource] = await Promise.all([
    documentAssetsRuntimeSource(),
    documentModelSource(),
  ]);
  assert.match(modelSource, /SAVED_AI_IMAGE_LIMIT\s*=\s*2048/);
  assert.match(modelSource, /SAVED_AI_QUOTE_LIMIT\s*=\s*1000/);
  assert.match(modelSource, /SAVED_AI_MESSAGE_LIMIT\s*=\s*200/);
  assert.match(modelSource, /SAVED_AI_MESSAGE_TOTAL_CHARS\s*=\s*8\s*\*\s*1024\s*\*\s*1024/);
  assert.equal((assetsSource.match(/const nextImages = Object\.create\(null\)/g) || []).length, 2);
});

test("resolves AI providers with own-property checks", async () => {
  const source = await aiConfigRuntimeSource();
  const resolver = between(source, "function resolveAiProvider", "async function readAiConfig");
  assert.match(
    resolver,
    /Object\.prototype\.hasOwnProperty\.call\(\s*normalized\.providers,\s*provider,/,
  );
});

test("task models validate explicit assignments and fall back only when unconfigured", async () => {
  const [source, aiGenerationSource] = await Promise.all([
    aiConfigRuntimeSource(),
    aiGenerationRuntimeSource(),
  ]);
  const saver = between(source, "function mergeAndValidateAiTaskModels", "async function saveAiConfigUnlocked");
  assert.match(
    saver,
    /exactAiProviderConfig\(\s*existing,\s*assignment\.providerId,\s*assignment\.modelId,/,
  );
  assert.match(saver, /resolver\.apiKey \|\| !resolver\.testedOk/);
  assert.match(saver, /codexRuntimeStatus\.ready/);
  assert.match(
    saver,
    /validateAiRequestParamsPatch\(\s*source\.requestParams,/,
  );
  assert.match(saver, /Codex CLI 任务模型不支持 HTTP 请求参数/);
  const resolver = between(
    aiGenerationSource,
    "async function resolveApply",
    "async function cancel",
  );
  assert.match(
    resolver,
    /taskAiProviderConfig\(\s*config,\s*taskModel,/,
  );
  assert.match(
    resolver,
    /hasExplicitTaskModel\s*\?\s*taskModel\.requestParams\s*:\s*\{\}/,
  );
  assert.match(resolver, /AI 配置 → 任务模型/);
  assert.match(resolver, /默认模型不可用/);
});

test("drops stale AI test results before they can overwrite a newer configuration", async () => {
  const source = await aiConfigRuntimeSource();
  const updater = between(source, "function storedAiTestConfigIdentity", "async function getConfig");
  assert.match(updater, /createAiTestConfigIdentity/);
  assert.match(updater, /commitAiTestResultIfCurrent/);
  assert.match(updater, /identityFromCurrent/);
  const handler = between(source, "async function testConfig", "const facade");
  assert.match(handler, /expectedIdentity = storedAiTestConfigIdentity/);
  assert.equal((handler.match(/if \(commitResult\.stale\)/g) || []).length, 2);
  assert.equal((handler.match(/stale: true/g) || []).length, 2);
});

test("always gives Codex a fresh isolated scope", async () => {
  const source = await aiGenerationRuntimeSource();
  const streamer = between(source, "async function streamCodexForPayload", "async function generate");
  assert.match(streamer, /resolveCodexScopeDirectory/);
  assert.doesNotMatch(streamer, /workspacePath|documentPath|fs\.stat/);
});

test("checks Codex cancellation around async preparation and suppresses stale deltas", async () => {
  const source = await aiGenerationRuntimeSource();
  const streamer = between(source, "async function streamCodexForPayload", "async function generate");
  const abortChecks = streamer.match(/throwIfAiAborted\(controller\.signal\)/g) || [];
  assert.equal(abortChecks.length, 3);
  assert.ok(
    streamer.indexOf("throwIfAiAborted(controller.signal)") < streamer.indexOf("resolveCodexScopeDirectory"),
    "the initial abort check must happen before scope preparation",
  );
  assert.match(streamer, /resolvedScope[\s\S]*try\s*\{\s*throwIfAiAborted\(controller\.signal\)/);
  assert.match(streamer, /await materializeCodexImageAttachments[\s\S]*throwIfAiAborted\(controller\.signal\)/);
  assert.match(
    streamer,
    /onDelta:\s*\(delta\)\s*=>\s*\{[\s\S]*if \(controller\.signal\.aborted\)[\s\S]*return;[\s\S]*emitRendererEvent/,
  );
});

test("main delegates workspace watcher lifecycle to one runtime", async () => {
  const source = await mainSource();
  assert.match(source, /require\("\.\/workspace-runtime\.cjs"\)/);
  assert.equal(
    (source.match(/createWorkspaceRuntime\(\{/g) || []).length,
    1,
  );
  assert.match(source, /workspaceFacade:\s*workspaceRuntime\.facade/);
  assert.match(source, /workspaceRuntime\.shutdown\(\)/);
  assert.doesNotMatch(
    source,
    /activeWorkspaceWatcher|activeWorkspaceWatchGeneration/,
  );
});
