const { app, BrowserWindow, Menu, WebContentsView, clipboard, dialog, ipcMain: electronIpcMain, net, protocol, safeStorage, screen, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const nativeFs = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createHash, randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { fileURLToPath } = require("node:url");
const JSZip = require("jszip");
const mammoth = require("mammoth");
const docx = require("docx");
const iconvLite = require("iconv-lite");

if (!app.isPackaged && process.env.PAPERWRITER_SMOKE_TEST === "1") {
  const smokeUserDataDir = String(process.env.PAPERWRITER_SMOKE_USER_DATA_DIR || "");
  if (!smokeUserDataDir || !path.isAbsolute(smokeUserDataDir)) {
    throw new Error("PAPERWRITER_SMOKE_USER_DATA_DIR 必须是绝对路径");
  }
  app.setPath("userData", path.resolve(smokeUserDataDir));
}

const { registerAiConfigIpcHandlers } = require("./ai-config-ipc.cjs");
const { registerAiGenerationIpcHandlers } = require("./ai-generation-ipc.cjs");
const { registerAiCollaborationIpcHandlers } = require("./ai-collaboration-ipc.cjs");
const { registerHelpAssistantIpcHandlers } = require("./help-assistant-ipc.cjs");
const { registerResearchTranslationIpcHandlers } = require("./research-translation-ipc.cjs");
const { registerCitationIpcHandlers } = require("./citation-ipc.cjs");
const { registerCompositionIpcHandlers } = require("./composition-ipc.cjs");
const { registerDocumentHistoryIpcHandlers } = require("./document-history-ipc.cjs");
const { registerProfileIpcHandlers } = require("./profile-ipc.cjs");
const { registerWritingAssistanceIpcHandlers } = require("./writing-assistance-ipc.cjs");
const { registerApplicationIpcHandlers } = require("./application-ipc.cjs");
const { registerAutosaveIpcHandlers } = require("./autosave-ipc.cjs");
const {
  registerDiagnosticsIpcHandlers,
  sanitizeDebugLogData,
} = require("./diagnostics-ipc.cjs");
const { registerDocumentOpenIpcHandlers } = require("./document-open-ipc.cjs");
const { registerDocumentOutputIpcHandlers } = require("./document-output-ipc.cjs");
const { registerDocumentSaveIpcHandlers } = require("./document-save-ipc.cjs");
const { createAiRuntime } = require("./ai-runtime.cjs");
const { createAiCollaborationRuntime } = require("./ai-collaboration-runtime.cjs");
const { createCitationRuntime } = require("./citation-runtime.cjs");
const { createCompositionJobStore } = require("./composition-job-store.cjs");
const { createCompositionRuntime } = require("./composition-runtime.cjs");
const { createDocumentHistoryRuntime } = require("./document-history-runtime.cjs");
const { createDocumentAssetsRuntime } = require("./document-assets-runtime.cjs");
const { createDocumentStorageRuntime } = require("./document-storage-runtime.cjs");
const documentModel = require("./document-model.cjs");
const { createExportRuntime } = require("./export-runtime.cjs");
const { createFilesystemRuntime } = require("./filesystem-runtime.cjs");
const {
  FAIL_CLOSED_DICTIONARY_URL,
  createOfflineDictionaryRuntime,
} = require("./offline-dictionary-runtime.cjs");
const { createResearchRuntime } = require("./research-runtime.cjs");
const { createProfileRuntime } = require("./profile-runtime.cjs");
const { createPublicCitationLibraryRuntime } = require("./public-citation-library.cjs");
const {
  createWritingAssistanceRuntime,
  installSpellingContextMenu,
} = require("./writing-assistance-runtime.cjs");
const { createTrustedIpcRegistrar } = require("./ipc-registrar.cjs");
const {
  createInitialUpdateState,
  mergeUpdateState,
  registerUpdateEvents,
} = require("./update-runtime.cjs");
const { createWorkspaceRuntime } = require("./workspace-runtime.cjs");
const { createUnresponsiveCloseGuard } = require("./unresponsive-close-guard.cjs");
const {
  ASSET_PROTOCOL,
  createDocumentAssetRegistry,
  createStagedAssetStore,
  normalizeAssetPath,
  parseAssetUrl: parseDocumentAssetUrl,
} = require("./document-assets.cjs");
const { createAssetPackager } = require("./asset-packager.cjs");
const { sanitizeFilesystemName } = require("./filesystem-access.cjs");
const {
  DEFAULT_ARCHIVE_LIMITS,
  assertZipEntryReadable,
  atomicWriteFile,
  createByteBudgetSemaphore,
  createZipEntryLimitTransform,
  createPathWriteQueue,
  parseSingleByteRange,
  preflightZipBuffer,
  readZipEntryBufferLimited,
  validatePaperArchive,
} = require("./document-storage.cjs");
const {
  createWorkspaceSearchIndex,
  htmlToSearchText,
  isPathInside,
  isWorkspaceRelationshipCandidate,
  readSearchDocument,
  walkWorkspaceDocuments,
} = require("./workspace-search.cjs");
const {
  DocumentRevisionConflictError,
  REVISION_CONFLICT_CODE,
  assertDiskRevision,
  createConflictCopyPath,
  readFileSnapshot,
  readDiskRevision,
} = require("./document-revision.cjs");
const {
  createDocumentInterchange,
  decodeTextBuffer,
  markdownToHtml,
  sanitizeImportedHtml,
} = require("./document-interchange.cjs");
const { createResearchWebViewManager } = require("./research-web-view.cjs");
const { registerResearchWebViewIpcHandlers } = require("./research-web-view-ipc.cjs");
const { registerResourceIpcHandlers } = require("./resource-ipc.cjs");
const { registerWorkspaceFolderIpcHandlers } = require("./workspace-folder-ipc.cjs");
const { registerResearchLibraryIpcHandlers } = require("./research-library-ipc.cjs");
const { registerWorkspaceResearchIpcHandlers } = require("./workspace-research-ipc.cjs");
const {
  createSource: createResearchSource,
  deleteCitationSource,
  deleteSource: deleteResearchSource,
  ensureWorkspace,
  listCitationSources,
  listSources: listResearchSources,
  readSource: readResearchSource,
  relinkSource: relinkResearchSource,
  resolveSourceFile,
  upsertCitationSource,
  updateSource: updateResearchSource,
} = require("./workspace-research.cjs");
const { createResearchLibraryManager, importLegacyResearch, normalizeWebScopeKey } = require("./research-library.cjs");
const {
  DOCUMENT_EXTENSION,
  DOCUMENT_FILTERS,
  isSupportedDocument,
  normalizeDocument,
  normalizeDocumentId,
  normalizeSavedAiState,
  sanitizeName,
  timestampForFileName,
} = documentModel;

const APP_ROOT = path.resolve(__dirname, "..");
const REQUESTED_FRONTEND_URL = process.env.PAPERWRITER_FRONTEND_URL || "";
const FRONTEND_URL = (() => {
  if (app.isPackaged || !REQUESTED_FRONTEND_URL) return "";
  try {
    const parsed = new URL(REQUESTED_FRONTEND_URL);
    return parsed.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
})();
const APP_ICON = path.resolve(__dirname, "assets", process.platform === "win32" ? "app-icon.ico" : "app-icon.png");
// AVIF stays disabled until the primary item and its coded dimensions can be
// verified without decoding attacker-controlled image data.
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
const IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const IMAGE_MAX_DIMENSION = 16_384;
const IMAGE_MAX_PIXELS = 40_000_000;
const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "m4a", "aac", "flac"];
const VIDEO_EXTENSIONS = ["mp4", "webm", "ogv"];
const AI_DEBUG_LOG_MAX_BYTES = 2 * 1024 * 1024;
const AI_DEBUG_LOG_ENTRY_MAX_BYTES = 64 * 1024;
const TITLE_BAR_OVERLAY_DEFAULT = {
  color: "#cdd7d2",
  symbolColor: "#334155",
  height: 40,
};
const RESEARCH_READ_MAX_BYTES = 128 * 1024 * 1024;
const PRODUCTION_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "manifest-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  `img-src 'self' data: blob: ${ASSET_PROTOCOL}:`,
  `media-src 'self' data: blob: ${ASSET_PROTOCOL}:`,
  "connect-src 'none'",
  "worker-src 'self'",
].join("; ");

let mainWindow = null;
let closeRequestInFlight = false;
let forceCloseWindow = false;
let closeAttentionActive = false;
let rendererCanConfirmClose = false;
let unresponsiveCloseGuard = null;
let pendingUpdateInstall = false;
let downloadGuardInstalled = false;
let compositionShutdownComplete = false;
let compositionShutdownPromise = null;
let removeSpellingContextMenu = null;
let updateState = createInitialUpdateState(app.getVersion());
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

const documentAssetsRuntime = createDocumentAssetsRuntime({
  fs,
  nativeFs,
  path,
  platform: process.platform,
  JSZip,
  pipeline,
  ReadableApi: Readable,
  ResponseApi: Response,
  protocol,
  assetProtocol: ASSET_PROTOCOL,
  createDocumentAssetRegistry,
  createStagedAssetStore,
  parseDocumentAssetUrl,
  normalizeAssetPath,
  createAssetPackager,
  createByteBudgetSemaphore,
  assertZipEntryReadable,
  createZipEntryLimitTransform,
  parseSingleByteRange,
  preflightZipBuffer,
  readZipEntryBufferLimited,
  validatePaperArchive,
  archiveLimits: DEFAULT_ARCHIVE_LIMITS,
  isSupportedDocument,
  normalizeDocument,
  normalizeSavedAiState,
  getTempPath: () => app.getPath("temp"),
  randomUUID,
  writeDebugLog: writeAiDebugLog,
});
const assetsFacade = documentAssetsRuntime.facade;
const { readProtocolAsset } = assetsFacade;

const documentStorageRuntime = createDocumentStorageRuntime({
  app,
  fs,
  path,
  platform: process.platform,
  appRoot: APP_ROOT,
  JSZip,
  createHash,
  randomUUID,
  documentModel,
  assetsFacade,
  archiveLimits: DEFAULT_ARCHIVE_LIMITS,
  assertZipEntryReadable,
  atomicWriteFile,
  createPathWriteQueue,
  preflightZipBuffer,
  readZipEntryBufferLimited,
  validatePaperArchive,
  DocumentRevisionConflictError,
  assertDiskRevision,
  createConflictCopyPath,
  readFileSnapshot,
  readDiskRevision,
  createDocumentInterchange,
  formatCitations: (payload) => citationFacade.formatSources(payload),
  mammoth,
  docx,
  iconvLite,
  readSearchDocument,
  sanitizeFilesystemName,
  writeDebugLog: writeAiDebugLog,
});
const storageFacade = documentStorageRuntime.facade;

const documentHistoryRuntime = createDocumentHistoryRuntime({
  fs,
  path,
  createHash,
  randomUUID,
  atomicWriteFile,
  getUserDataPath: () => app.getPath("userData"),
  readDiskRevision: storageFacade.readDiskRevision,
  assertDiskRevision: storageFacade.assertDiskRevision,
  loadPaperDocumentSnapshot:
    storageFacade.loadPaperDocumentSnapshot,
});
const historyFacade = documentHistoryRuntime.facade;

const writingAssistanceRuntime = createWritingAssistanceRuntime({
  fs,
  path,
  atomicWriteFile,
  getUserDataPath: () => app.getPath("userData"),
  randomUUID,
});
const writingAssistanceFacade =
  writingAssistanceRuntime.facade;
const offlineDictionaryRuntime = createOfflineDictionaryRuntime({
  dictionaryPath: path.join(
    __dirname,
    "assets",
    "dictionaries",
    "en-US-10-1.bdic",
  ),
});

const filesystemRuntime = createFilesystemRuntime({
  app,
  fs,
  path,
  platform: process.platform,
  atomicWriteFile,
  isSupportedDocument,
  isInternalAutosaveSessionDocument: async (value) => (
    Boolean(storageFacade.autosaveSessionIdForPath(value))
  ),
  writeDebugLog: writeAiDebugLog,
});
const {
  assertAuthorizedDirectory,
  assertAuthorizedDocument,
  assertAuthorizedDocumentTarget,
  authorizeDocumentPath,
  canonicalExistingPath,
  defaultDocumentsDir,
  initializeFilesystemAccess,
  resolveAuthorizedOpenDocument,
  resolveDocumentTargetPath,
} = filesystemRuntime;

const aiRuntime = createAiRuntime({
  fs,
  path,
  safeStorage,
  atomicWriteFile,
  getUserDataPath: () => app.getPath("userData"),
  getTempPath: () => app.getPath("temp"),
  getAppVersion: () => app.getVersion(),
  fetchImpl: net.fetch.bind(net),
  emitRendererEvent: sendRendererEvent,
  emitCodexStatus: (config) => {
    sendRendererEvent(
      mainWindow?.webContents,
      "ai:codex-status",
      config,
    );
  },
  writeDebugLog: writeAiDebugLog,
  readProtocolAsset,
  dialog,
  getMainWindow: () => mainWindow,
  defaultDocumentsDir,
  sanitizeName,
  timestampForFileName,
  randomUUID,
  knowledgeIndexPath: path.join(
    __dirname,
    nativeFs.existsSync(path.join(__dirname, "knowledge", "runtime-index.generated.json"))
      ? "knowledge"
      : "../knowledge",
    "runtime-index.generated.json",
  ),
});

const profileRuntime = createProfileRuntime({
  fs,
  path,
  JSZip,
  crypto,
  atomicWriteFile,
  getAppVersion: () => app.getVersion(),
  readAiConfig: aiRuntime.profileFacade.readConfig,
  writeAiConfig: aiRuntime.profileFacade.replaceConfig,
  readWritingAssistance:
    writingAssistanceFacade.getConfig,
  writeWritingAssistance:
    writingAssistanceFacade.replaceConfig,
});
const profileFacade = profileRuntime.facade;

const citationFacade = createCitationRuntime({
  fetchImpl: net.fetch.bind(net),
  idFactory: randomUUID,
  loadLookupCache: loadCitationLookupCache,
  saveLookupCache: saveCitationLookupCache,
});
const publicCitationLibraryRuntime = createPublicCitationLibraryRuntime({
  fs,
  path,
  atomicWriteFile,
  getUserDataPath: () => app.getPath("userData"),
  normalizeCitationSources: documentModel.normalizeCitationSources,
  randomUUID,
});

const compositionJobStore = createCompositionJobStore({
  fs,
  path,
  getUserDataPath: () => app.getPath("userData"),
  atomicWriteFile,
  randomUUID,
});
const compositionRuntime = createCompositionRuntime({
  store: compositionJobStore,
  completeTask: aiRuntime.completeCompositionTask,
  resolveModelAssignments: aiRuntime.getCompositionModelAssignments,
  finalizeDocument: finalizeCompositionDocument,
  reconcileOutputIntent: reconcileCompositionOutputIntent,
  emitEvent: (sender, payload) => {
    sendRendererEvent(sender, "composition:event", payload);
  },
});

const workspaceRuntime = createWorkspaceRuntime({
  filesystemAccess: Object.freeze({
    assertAuthorizedDirectory:
      filesystemRuntime.assertAuthorizedDirectory,
    canAccessDirectory: filesystemRuntime.canAccessDirectory,
  }),
  fs,
  nativeFs,
  path,
  platform: process.platform,
  createHash,
  createWorkspaceSearchIndex,
  walkWorkspaceDocuments,
  readSearchDocument,
  normalizeDocumentId,
  isWorkspaceRelationshipCandidate,
  mapWithConcurrency,
  isPathInside,
  isSupportedDocument,
  isReservedWorkspaceMetadataPath,
  randomUUID,
  getUserDataPath: () => app.getPath("userData"),
  getRendererWebContents: () => mainWindow?.webContents,
  sendRendererEvent,
  writeDebugLog: writeAiDebugLog,
});

const aiCollaborationRuntime = createAiCollaborationRuntime({
  completeTask: aiRuntime.completeSelectedAiTask,
  fs,
  path,
  createHash,
  randomUUID,
  getUserDataPath: () => app.getPath("userData"),
  atomicWriteFile,
  assertAuthorizedDirectory,
  isPathInside,
  isSupportedDocument,
  walkWorkspaceDocuments,
  readSearchDocument,
  searchWorkspace: workspaceRuntime.facade.search,
  loadPaperDocument: storageFacade.loadPaperDocument,
  savePaperDocument: storageFacade.savePaperDocument,
  authorizeDocumentPath,
  normalizeDocument: documentModel.normalizeDocument,
  createEmptyAiState: documentModel.createEmptyAiState,
  htmlToSearchText,
  emitEvent: (sender, payload) => sendRendererEvent(
    sender,
    "ai-collaboration:event",
    payload,
  ),
  writeDebugLog: writeAiDebugLog,
});

const researchRuntime = createResearchRuntime({
  createResearchLibraryManager,
  createResearchWebViewManager,
  getUserDataPath: () => app.getPath("userData"),
  WebContentsView,
  session,
  shell,
  dialog,
  getWindow: () => mainWindow,
  getActiveWorkspaceRoot: workspaceRuntime.getActiveRoot,
  emitRendererEvent: (channel, payload) => {
    sendRendererEvent(mainWindow?.webContents, channel, payload);
  },
  decodeTextBuffer,
  iconvLite,
  listResearchSources,
  resolveSourceFile,
  mapWithConcurrency,
});

const exportRuntime = createExportRuntime({
  path,
  fs,
  dialog,
  getMainWindow: () => mainWindow,
  defaultDocumentsDir: filesystemRuntime.defaultDocumentsDir,
  ensureExtension,
  sanitizeFilesystemName,
  platform: process.platform,
});

Menu.setApplicationMenu(null);
autoUpdater.autoDownload = false;
protocol.registerSchemesAsPrivileged([{
  scheme: ASSET_PROTOCOL,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
  },
}]);

function aiDebugLogPath() {
  return path.join(app.getPath("userData"), "Logs", "ai-debug.log");
}

function isResolvedPathInside(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function writeAiDebugLog(event, data = {}) {
  const safeEvent = String(event || "unknown")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 128) || "unknown";
  const writeLog = async (logPath, fallbackReason = "") => {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    try {
      const stat = await fs.stat(logPath);
      if (stat.size > AI_DEBUG_LOG_MAX_BYTES) {
        await fs.rm(`${logPath}.old`, { force: true });
        await fs.rename(logPath, `${logPath}.old`);
      }
    } catch {
      // No existing log yet.
    }
    let safeData = sanitizeDebugLogData(
      fallbackReason ? { ...data, fallbackReason } : data,
    );
    try {
      if (Buffer.byteLength(JSON.stringify(safeData), "utf8") > AI_DEBUG_LOG_ENTRY_MAX_BYTES) {
        safeData = { truncated: true, message: "debug payload exceeded 64 KiB" };
      }
    } catch {
      safeData = { truncated: true, message: "debug payload was not serializable" };
    }
    const payload = {
      time: new Date().toISOString(),
      pid: process.pid,
      event: safeEvent,
      data: safeData,
    };
    await fs.appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8");
    return logPath;
  };

  try {
    return await writeLog(aiDebugLogPath());
  } catch {
    // Debug logging must never break user workflows.
    return "";
  }
}

function frontendDistPath() {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), "frontend", "dist", "index.html");
  }
  return path.resolve(__dirname, "..", "frontend", "dist", "index.html");
}

function isTrustedApplicationUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (FRONTEND_URL) {
      const expected = new URL(FRONTEND_URL);
      const expectedPath = expected.pathname || "/";
      return url.origin === expected.origin && (url.pathname === expectedPath || (expectedPath === "/" && url.pathname === "/index.html"));
    }
    if (url.protocol !== "file:") return false;
    return path.resolve(fileURLToPath(url)) === path.resolve(frontendDistPath());
  } catch {
    return false;
  }
}

function isTrustedFrontendResourceUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "file:") return false;
    const resourcePath = path.resolve(fileURLToPath(url));
    const distRoot = path.dirname(path.resolve(frontendDistPath()));
    return isResolvedPathInside(distRoot, resourcePath);
  } catch {
    return false;
  }
}

const ipcMain = createTrustedIpcRegistrar({
  ipcMain: electronIpcMain,
  getMainWindow: () => mainWindow,
  isTrustedApplicationUrl,
});

function emitUpdateState(patch) {
  updateState = mergeUpdateState(updateState, patch, app.getVersion());
  sendRendererEvent(mainWindow?.webContents, "update:state", updateState);
  return updateState;
}

function sendRendererEvent(sender, channel, payload) {
  if (!sender || sender.isDestroyed?.()) return false;
  sender.send(channel, payload);
  return true;
}

function citationLookupCachePath() {
  return path.join(
    app.getPath("userData"),
    "Citation",
    "lookup-cache.json",
  );
}

async function loadCitationLookupCache() {
  let handle;
  try {
    handle = await fs.open(citationLookupCachePath(), "r");
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > 16 * 1024 * 1024) {
      throw new Error("文献缓存超出安全上限");
    }
    const buffer = await handle.readFile();
    const after = await handle.stat();
    if (
      before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || buffer.length !== after.size
    ) {
      throw new Error("文献缓存读取期间发生变化");
    }
    const parsed = JSON.parse(buffer.toString("utf8"));
    return parsed?.version === 1 && Array.isArray(parsed.entries)
      ? parsed
      : { version: 1, entries: [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, entries: [] };
    throw error;
  } finally {
    await handle?.close();
  }
}

async function saveCitationLookupCache(cache) {
  const serialized = `${JSON.stringify(cache)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > 16 * 1024 * 1024) {
    throw new Error("文献缓存超出安全上限");
  }
  await atomicWriteFile(citationLookupCachePath(), serialized);
}

async function createInMemoryHistorySnapshot({
  documentId,
  document,
  name,
  pinned,
}) {
  const safeDocumentId = String(documentId || "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(safeDocumentId)) {
    throw new Error("文档身份无效");
  }
  const stagingDirectory = path.join(
    app.getPath("temp"),
    "jianjian-history-staging",
  );
  await fs.mkdir(stagingDirectory, { recursive: true });
  const stagingPath = path.join(
    stagingDirectory,
    `${randomUUID()}.letterpaper`,
  );
  try {
    const saved = await storageFacade.savePaperDocument(
      stagingPath,
      document,
    );
    if (saved?.document?.documentId !== safeDocumentId) {
      throw new Error("历史快照与当前信笺身份不一致");
    }
    return await historyFacade.createSnapshot({
      documentId: safeDocumentId,
      filePath: stagingPath,
      kind: "manual",
      name,
      pinned,
    });
  } finally {
    await fs.unlink(stagingPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function finalizeCompositionDocument({
  job,
  markdown,
  signal,
  outputPath,
  onIntent,
}) {
  if (signal?.aborted) throw new Error("AI 起稿落稿已停止");
  const title = sanitizeName(
    job?.generatedTitle || job?.outline?.[0]?.title || job?.brief?.topic,
    "AI 起稿",
  );
  let sourceDocument = null;
  let authorizedSourcePath = "";
  if (job?.derivedFrom?.path) {
    try {
      authorizedSourcePath = await assertAuthorizedDocument(
        String(job.derivedFrom.path).slice(0, 32768),
      );
      sourceDocument = await storageFacade.loadPaperDocument(
        authorizedSourcePath,
      );
    } catch {
      authorizedSourcePath = "";
      sourceDocument = null;
    }
  }

  let targetPath = "";
  if (outputPath) {
    const requested = isSupportedDocument(outputPath)
      ? outputPath
      : ensureExtension(outputPath, DOCUMENT_EXTENSION);
    targetPath = await assertAuthorizedDocumentTarget(
      await resolveDocumentTargetPath(requested),
    );
  } else if (authorizedSourcePath) {
    targetPath = await uniquePath(path.join(
      path.dirname(authorizedSourcePath),
      `${sanitizeFilesystemName(title, "AI起稿", 60)}-AI起稿-${timestampForFileName()}${DOCUMENT_EXTENSION}`,
    ));
    await authorizeDocumentPath(targetPath, { mustExist: false });
  } else {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "保存 AI 起稿派生信笺",
      defaultPath: path.join(
        defaultDocumentsDir(),
        `${sanitizeFilesystemName(title, "AI起稿", 60)}-AI起稿-${timestampForFileName()}${DOCUMENT_EXTENSION}`,
      ),
      filters: DOCUMENT_FILTERS,
    });
    if (result.canceled || !result.filePath) {
      throw new Error("已取消生成派生信笺");
    }
    targetPath = isSupportedDocument(result.filePath)
      ? result.filePath
      : ensureExtension(result.filePath, DOCUMENT_EXTENSION);
    targetPath = await resolveDocumentTargetPath(targetPath);
    await authorizeDocumentPath(targetPath, { mustExist: false });
  }
  if (
    authorizedSourcePath
    && (
      process.platform === "win32"
        ? path.resolve(targetPath).toLocaleLowerCase("en-US")
          === path.resolve(authorizedSourcePath).toLocaleLowerCase("en-US")
        : path.resolve(targetPath) === path.resolve(authorizedSourcePath)
    )
  ) {
    throw new Error("AI 起稿必须保存为新的派生信笺，不能覆盖来源原稿");
  }

  const sourceIdToCitationId = new Map();
  const generatedCitationSources = (Array.isArray(job?.sourceSnapshots)
    ? job.sourceSnapshots
    : []).map((snapshot) => {
    const citation = snapshot?.citationSource
      && typeof snapshot.citationSource === "object"
      ? snapshot.citationSource
      : {};
    const citationId = normalizeDocumentId(citation.id)
      || normalizeDocumentId(snapshot.sourceId)
      || randomUUID();
    sourceIdToCitationId.set(String(snapshot.sourceId || ""), citationId);
    return {
      ...citation,
      id: citationId,
      citationKey: citation.citationKey
        || String(snapshot.sourceId || citationId),
      title: citation.title || snapshot.title || "未命名资料",
      notes: citation.notes
        || `AI 起稿资料快照，捕获于 ${snapshot.capturedAt || job.createdAt || ""}`,
    };
  });
  const citationSources = documentModel.normalizeCitationSources([
    ...(sourceDocument?.citationSources || []),
    ...generatedCitationSources,
  ]);
  const withCitationLinks = String(markdown || "").replace(
    /\[\[cite:([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})(?:\|([^\]]{0,256}))?\]\]/g,
    (_match, sourceId, locator = "") => {
      const citationId = sourceIdToCitationId.get(sourceId);
      if (!citationId) return `【待核实：${sourceId}】`;
      return `[1](#jianjian-citation=${encodeURIComponent(citationId)}${locator ? `&pages=${encodeURIComponent(locator)}` : ""})`;
    },
  );
  const convertedMarkdown = markdownToHtml(withCitationLinks);
  const generatedHtml = typeof convertedMarkdown?.html === "string"
    ? convertedMarkdown.html
    : "";
  if (!generatedHtml.trim() || generatedHtml.includes("[object Object]")) {
    throw new Error("AI 起稿正文转换失败，未写入派生信笺");
  }
  const sanitizedGenerated = await sanitizeImportedHtml(
    generatedHtml,
    {
      sourcePath: "",
      fsApi: fs,
      pathApi: path,
      warnings: [],
    },
  );
  if (signal?.aborted) throw new Error("AI 起稿落稿已停止");
  const timestamp = new Date().toISOString();
  const document = documentModel.normalizeDocument({
    version: documentModel.DOCUMENT_SCHEMA_VERSION,
    documentId: randomUUID(),
    derivedFrom: normalizeDocumentId(
      job?.derivedFrom?.documentId
      || sourceDocument?.documentId,
    ),
    title,
    author: sourceDocument?.author || "",
    html: sanitizedGenerated.html,
    letterTemplateId: sourceDocument?.letterTemplateId || "",
    templateId: sourceDocument?.templateId || "warm",
    fontFamily: sourceDocument?.fontFamily
      || "LXGW WenKai Screen",
    fontSize: sourceDocument?.fontSize || 18,
    citationSources,
    citationStyle: sourceDocument?.citationStyle,
    footnotes: convertedMarkdown.footnotes || [],
    comments: [],
    aiState: documentModel.createEmptyAiState(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  if (signal?.aborted) throw new Error("AI 起稿落稿已停止");
  if (typeof onIntent !== "function") {
    throw new Error("AI 起稿落稿缺少提交登记");
  }
  await onIntent({
    path: targetPath,
    documentId: document.documentId,
    preparedAt: timestamp,
  });
  if (signal?.aborted) throw new Error("AI 起稿落稿已停止");
  const saved = await storageFacade.savePaperDocument(
    targetPath,
    document,
  );
  await authorizeDocumentPath(targetPath);
  return {
    path: targetPath,
    documentId: saved.document.documentId,
    diskRevision: saved.diskRevision,
  };
}

async function reconcileCompositionOutputIntent(intent) {
  const targetPath = String(intent?.path || "").slice(0, 32768);
  const expectedDocumentId = normalizeDocumentId(intent?.documentId);
  if (!targetPath || !expectedDocumentId || !isSupportedDocument(targetPath)) {
    return { state: "indeterminate", error: "派生信笺落稿意图无效" };
  }
  try {
    const document = await storageFacade.loadPaperDocument(targetPath);
    if (normalizeDocumentId(document?.documentId) !== expectedDocumentId) {
      return { state: "missing" };
    }
    await authorizeDocumentPath(targetPath).catch((error) => (
      writeAiDebugLog("composition:output-authorization-repair-failed", {
        message: String(error?.message || error).slice(0, 500),
      })
    ));
    return {
      state: "committed",
      path: targetPath,
      documentId: expectedDocumentId,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "missing" };
    return {
      state: "indeterminate",
      error: String(error?.message || "派生文件状态无法确认").slice(0, 4000),
    };
  }
}

function stopCloseAttention() {
  if (!closeAttentionActive || !mainWindow || mainWindow.isDestroyed()) return;
  if (process.platform === "win32") mainWindow.flashFrame(false);
  closeAttentionActive = false;
}

function revealCloseConfirmation() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const shouldRequestAttention = mainWindow.isMinimized() || !mainWindow.isFocused();
  if (process.platform === "win32" && shouldRequestAttention) {
    mainWindow.flashFrame(true);
    closeAttentionActive = true;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function markRendererUnavailable(reason, details = {}) {
  rendererCanConfirmClose = false;
  unresponsiveCloseGuard?.dispose();
  void writeAiDebugLog("renderer:unavailable", { reason, ...details }).catch(() => {});
  if (!closeRequestInFlight || !mainWindow || mainWindow.isDestroyed()) return;
  // The user already requested a close, but an unavailable renderer cannot
  // complete the save/discard handshake. Let the native window close instead
  // of leaving a permanently blank or unresponsive process behind.
  closeRequestInFlight = false;
  forceCloseWindow = true;
  mainWindow.close();
}

function setCloseRequestInFlight(value) {
  closeRequestInFlight = Boolean(value);
  if (!closeRequestInFlight) unresponsiveCloseGuard?.closeSettled();
}

function createWindow() {
  unresponsiveCloseGuard?.dispose();
  unresponsiveCloseGuard = null;
  closeRequestInFlight = false;
  forceCloseWindow = false;
  closeAttentionActive = false;
  rendererCanConfirmClose = false;
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = Math.min(1440, Math.max(1080, Math.floor(workArea.width * 0.92)));
  const windowHeight = Math.min(940, Math.max(720, Math.floor(workArea.height * 0.9)));

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 1040,
    minHeight: 720,
    center: true,
    title: "笺间",
    icon: APP_ICON,
    titleBarStyle: "hidden",
    titleBarOverlay: TITLE_BAR_OVERLAY_DEFAULT,
    autoHideMenuBar: true,
    backgroundColor: "#edf6f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  unresponsiveCloseGuard = createUnresponsiveCloseGuard({
    getWindow: () => mainWindow,
    isCloseRequestInFlight: () => closeRequestInFlight,
    showMessageBox: (window, options) => dialog.showMessageBox(window, options),
    writeDebugLog: writeAiDebugLog,
    forceClose: () => {
      if (!mainWindow || mainWindow.isDestroyed() || !closeRequestInFlight) return;
      setCloseRequestInFlight(false);
      forceCloseWindow = true;
      mainWindow.close();
    },
  });
  removeSpellingContextMenu?.();
  removeSpellingContextMenu = installSpellingContextMenu({
    webContents: mainWindow.webContents,
    Menu,
    getConfig: writingAssistanceFacade.getConfig,
    addWord: writingAssistanceFacade.addWord,
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isTrustedApplicationUrl(targetUrl)) event.preventDefault();
  });
  mainWindow.webContents.on("will-redirect", (event, targetUrl) => {
    if (!isTrustedApplicationUrl(targetUrl)) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.on("did-finish-load", () => {
    rendererCanConfirmClose = true;
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    markRendererUnavailable("render-process-gone", {
      reasonCode: details?.reason || "unknown",
      exitCode: Number(details?.exitCode) || 0,
    });
  });
  if (!downloadGuardInstalled) {
    mainWindow.webContents.session.on("will-download", (event) => event.preventDefault());
    downloadGuardInstalled = true;
  }
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  if (!FRONTEND_URL) {
    mainWindow.webContents.session.webRequest.onBeforeRequest({ urls: ["file:///*"] }, (details, callback) => {
      callback({ cancel: !isTrustedFrontendResourceUrl(details.url) });
    });
    mainWindow.webContents.session.webRequest.onHeadersReceived({ urls: ["file:///*"] }, (details, callback) => {
      if (!isTrustedApplicationUrl(details.url)) {
        callback({ responseHeaders: details.responseHeaders });
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [PRODUCTION_CONTENT_SECURITY_POLICY],
        },
      });
    });
  }

  mainWindow.on("close", (event) => {
    if (forceCloseWindow) {
      return;
    }
    if (!rendererCanConfirmClose || mainWindow.webContents.isDestroyed()) {
      forceCloseWindow = true;
      closeRequestInFlight = false;
      return;
    }
    event.preventDefault();
    if (closeRequestInFlight) {
      return;
    }
    closeRequestInFlight = true;
    unresponsiveCloseGuard?.closeRequested();
    revealCloseConfirmation();
    mainWindow.webContents.send("app:close-request", {
      requestedAt: Date.now(),
      reason: pendingUpdateInstall ? "update-install" : "window-close",
    });
  });
  mainWindow.on("unresponsive", () => {
    void writeAiDebugLog("renderer:unresponsive").catch(() => {});
    unresponsiveCloseGuard?.markUnresponsive();
  });
  mainWindow.on("responsive", () => {
    rendererCanConfirmClose = true;
    unresponsiveCloseGuard?.markResponsive();
  });
  mainWindow.on("focus", () => {
    stopCloseAttention();
    sendRendererEvent(mainWindow?.webContents, "window:focus", { focusedAt: Date.now() });
  });
  mainWindow.on("blur", () => {
    sendRendererEvent(mainWindow?.webContents, "window:blur", { blurredAt: Date.now() });
  });
  mainWindow.on("enter-full-screen", () => {
    sendRendererEvent(mainWindow?.webContents, "window:fullscreen-changed", { fullscreen: true });
  });
  mainWindow.on("leave-full-screen", () => {
    sendRendererEvent(mainWindow?.webContents, "window:fullscreen-changed", { fullscreen: false });
  });
  mainWindow.on("closed", () => {
    unresponsiveCloseGuard?.dispose();
    unresponsiveCloseGuard = null;
    closeAttentionActive = false;
    rendererCanConfirmClose = false;
    researchRuntime.destroyWebViews();
    removeSpellingContextMenu?.();
    removeSpellingContextMenu = null;
    mainWindow = null;
  });

  if (FRONTEND_URL) {
    mainWindow.loadURL(FRONTEND_URL);
    return;
  }

  mainWindow.loadFile(frontendDistPath()).catch((error) => {
    dialog.showErrorBox(
      "笺间",
      `Frontend build not found. Run npm run build in apps/writer/frontend first.\n\n${error.message}`,
    );
  });
}

registerUpdateEvents({
  autoUpdater,
  emitUpdateState,
  onError: () => {
    if (pendingUpdateInstall) {
      pendingUpdateInstall = false;
      forceCloseWindow = false;
      closeRequestInFlight = false;
    }
  },
});

function ensureExtension(filePath, extension) {
  return path.extname(filePath).toLowerCase() === extension ? filePath : `${filePath}${extension}`;
}

async function uniquePath(targetPath) {
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  let index = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(parsed.dir, `${parsed.name} ${index}${parsed.ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const values = Array.isArray(items) ? items : [];
  const results = new Array(values.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index], index);
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, () => run());
  await Promise.all(workers);
  return results;
}

function isReservedWorkspaceMetadataPath(filePath) {
  return path.resolve(String(filePath || ""))
    .split(/[\\/]+/)
    .some((segment) => segment.toLocaleLowerCase("en-US") === ".jianjian");
}

function assertMutableWorkspaceEntry(filePath) {
  if (isReservedWorkspaceMetadataPath(filePath)) {
    throw new Error(".jianjian 是笺间工作区保留目录，不能通过文件树修改");
  }
}

registerApplicationIpcHandlers({
  ipcMain,
  app,
  autoUpdater,
  dialog,
  titleBarOverlay: TITLE_BAR_OVERLAY_DEFAULT,
  ensureDocumentsDirectory: async () => {
    const documents = defaultDocumentsDir();
    await fs.mkdir(documents, { recursive: true });
    return documents;
  },
  getMainWindow: () => mainWindow,
  getUpdateState: () => updateState,
  emitUpdateState,
  getCloseRequestInFlight: () => closeRequestInFlight,
  setCloseRequestInFlight,
  getPendingUpdateInstall: () => pendingUpdateInstall,
  setPendingUpdateInstall: (value) => { pendingUpdateInstall = value; },
  setForceCloseWindow: (value) => { forceCloseWindow = value; },
  stopCloseAttention,
  writeDebugLog: writeAiDebugLog,
});

registerDiagnosticsIpcHandlers({
  ipcMain,
  writeDebugLog: writeAiDebugLog,
});

registerResearchWebViewIpcHandlers({
  ipcMain,
  webViewFacade: researchRuntime.webViewFacade,
});

registerAiConfigIpcHandlers({
  ipcMain,
  configFacade: aiRuntime.configFacade,
});

registerAiGenerationIpcHandlers({
  ipcMain,
  generationFacade: aiRuntime.generationFacade,
});

registerAiCollaborationIpcHandlers({
  ipcMain,
  collaborationFacade: aiCollaborationRuntime.facade,
});

registerHelpAssistantIpcHandlers({
  ipcMain,
  helpAssistantFacade: aiRuntime.helpAssistantFacade,
});
registerResearchTranslationIpcHandlers({
  ipcMain,
  researchTranslationFacade: aiRuntime.researchTranslationFacade,
});

registerCompositionIpcHandlers({
  ipcMain,
  compositionFacade: compositionRuntime,
});

registerCitationIpcHandlers({
  ipcMain,
  citationFacade,
  dialog,
  fs,
  path,
  getMainWindow: () => mainWindow,
  defaultDocumentsDir,
  publicCitationLibrary: publicCitationLibraryRuntime.facade,
  assertAuthorizedDirectory,
  ensureWorkspace,
  listCitationSources,
});

registerDocumentHistoryIpcHandlers({
  ipcMain,
  historyFacade,
  assertAuthorizedDocument,
  createDocumentSnapshot: createInMemoryHistorySnapshot,
});

registerProfileIpcHandlers({
  ipcMain,
  profileFacade,
  dialog,
  getMainWindow: () => mainWindow,
  path,
  defaultDirectory: defaultDocumentsDir,
  randomUUID,
});

registerWritingAssistanceIpcHandlers({
  ipcMain,
  writingAssistanceFacade,
});

registerWorkspaceFolderIpcHandlers({
  ipcMain,
  app,
  clipboard,
  dialog,
  filesystemRuntime,
  workspaceFacade: workspaceRuntime.facade,
  fs,
  path,
  shell,
  documentModel,
  getMainWindow: () => mainWindow,
  assertMutableWorkspaceEntry,
  uniquePath,
  storageFacade,
});

registerDocumentOpenIpcHandlers({
  ipcMain,
  documentModel,
  dialog,
  getMainWindow: () => mainWindow,
  defaultDocumentsDir,
  canonicalExistingPath,
  authorizeDocumentPath,
  writeDebugLog: writeAiDebugLog,
  assertAuthorizedDocument,
  resolveAuthorizedOpenDocument,
  randomUUID,
  storageFacade,
  interchangeFormatExtension: exportRuntime.interchangeFormatExtension,
  pickInterchangeExportPath: exportRuntime.pickInterchangeExportPath,
  ensureExtension,
  path,
  consumeExportTarget: exportRuntime.consumeExportTarget,
  isPathInside,
  fs,
  atomicWriteFile,
});

registerResearchLibraryIpcHandlers({
  ipcMain,
  app,
  clipboard,
  dialog,
  fs,
  path,
  platform: process.platform,
  shell,
  revisionConflictCode: REVISION_CONFLICT_CODE,
  getMainWindow: () => mainWindow,
  researchFacade: researchRuntime.libraryFacade,
  ensureWorkspace,
  normalizeWebScopeKey,
  assertAuthorizedDirectory,
  listResearchSources,
  importLegacyResearch,
  resolveSourceFile,
  markdownToHtml,
  sanitizeImportedHtml,
  documentModel,
  authorizeDocumentPath,
  storageFacade,
  writeDebugLog: writeAiDebugLog,
});

registerWorkspaceResearchIpcHandlers({
  ipcMain,
  app,
  dialog,
  fs,
  path,
  shell,
  researchReadMaxBytes: RESEARCH_READ_MAX_BYTES,
  getMainWindow: () => mainWindow,
  researchFacade: researchRuntime.libraryFacade,
  assertAuthorizedDirectory,
  ensureWorkspace,
  canonicalExistingPath,
  createResearchSource,
  updateResearchSource,
  deleteResearchSource,
  readResearchSource,
  relinkResearchSource,
  resolveSourceFile,
  listCitationSources,
  upsertCitationSource,
  deleteCitationSource,
});

registerDocumentSaveIpcHandlers({
  ipcMain,
  documentModel,
  revisionConflictCode: REVISION_CONFLICT_CODE,
  storageFacade,
  assertAuthorizedDirectory,
  assertMutableWorkspaceEntry,
  uniquePath,
  path,
  randomUUID,
  listFolderEntries: workspaceRuntime.facade.listFolderEntries,
  assertAuthorizedDocument,
  authorizeDocumentPath,
  listAuthorizedFolderEntries:
    workspaceRuntime.facade.listAuthorizedFolderEntries,
  sanitizeFilesystemName,
  dialog,
  getMainWindow: () => mainWindow,
  defaultDocumentsDir,
  ensureExtension,
  resolveDocumentTargetPath,
  platform: process.platform,
  assertAuthorizedDocumentTarget,
  fs,
  historyFacade,
  writeDebugLog: writeAiDebugLog,
});

registerDocumentOutputIpcHandlers({
  ipcMain,
  pickInterchangeExportPath: exportRuntime.pickInterchangeExportPath,
  pickDocumentExportPath: exportRuntime.pickDocumentExportPath,
  exportSafeName: exportRuntime.exportSafeName,
  sendExportProgress: exportRuntime.sendExportProgress,
  ensureExtension,
  consumeExportTarget: exportRuntime.consumeExportTarget,
  getMainWindow: () => mainWindow,
  atomicWriteFile,
  fs,
  path,
});

registerResourceIpcHandlers({
  ipcMain,
  dialog,
  getMainWindow: () => mainWindow,
  imageExtensions: IMAGE_EXTENSIONS,
  audioExtensions: AUDIO_EXTENSIONS,
  videoExtensions: VIDEO_EXTENSIONS,
  imageMaxBytes: IMAGE_MAX_BYTES,
  imageMaxDimension: IMAGE_MAX_DIMENSION,
  imageMaxPixels: IMAGE_MAX_PIXELS,
  audioMaxBytes: AUDIO_MAX_BYTES,
  videoMaxBytes: VIDEO_MAX_BYTES,
  path,
  fs,
  assetsFacade,
  clipboard,
  shell,
});

registerAutosaveIpcHandlers({
  ipcMain,
  storageFacade,
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  if (process.platform === "win32") {
    app.setAppUserModelId("PaperWriter.Electron");
  }
  await documentStorageRuntime.initializeAutosaveStorage();
  await aiRuntime.initialize();
  await documentHistoryRuntime.initialize();
  const spellCheckerSession = session.defaultSession;
  spellCheckerSession.setSpellCheckerDictionaryDownloadURL(
    FAIL_CLOSED_DICTIONARY_URL,
  );
  try {
    const dictionaryUrl = await offlineDictionaryRuntime.start();
    spellCheckerSession.setSpellCheckerDictionaryDownloadURL(
      dictionaryUrl,
    );
  } catch (error) {
    await writeAiDebugLog(
      "writing-assistance:offline-dictionary-unavailable",
      { message: String(error?.message || error).slice(0, 500) },
    );
  }
  await writingAssistanceRuntime.initialize(
    spellCheckerSession,
  );
  await initializeFilesystemAccess();
  await compositionRuntime.initialize();
  await aiCollaborationRuntime.initialize();
  await researchRuntime.initialize();
  await documentAssetsRuntime.initialize();
  documentStorageRuntime.initializeDocumentInterchange();
  createWindow();
}).catch((error) => {
  dialog.showErrorBox("笺间", `应用数据初始化失败。\n\n${error?.message || error}`);
  app.quit();
});

app.on("before-quit", (event) => {
  if (!compositionShutdownComplete) {
    event.preventDefault();
    if (!compositionShutdownPromise) {
      compositionShutdownPromise = Promise.allSettled([
        compositionRuntime.abortAll(),
        offlineDictionaryRuntime.stop(),
      ])
        .finally(() => {
          compositionShutdownComplete = true;
          app.quit();
        });
    }
    return;
  }
  workspaceRuntime.shutdown();
  researchRuntime.shutdown();
  aiRuntime.abortAll();
  aiCollaborationRuntime.abortAll();
  const storageShutdown = documentStorageRuntime.shutdown();
  if (storageShutdown.pending) {
    event.preventDefault();
    if (!storageShutdown.started) return;
    storageShutdown.promise.finally(() => {
      app.quit();
    });
    return;
  }
  const assetShutdown = documentAssetsRuntime.shutdown();
  if (!assetShutdown.pending) return;
  event.preventDefault();
  if (!assetShutdown.started) return;
  assetShutdown.promise.finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
