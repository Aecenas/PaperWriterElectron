const { app, BrowserWindow, Menu, WebContentsView, clipboard, dialog, ipcMain, net, protocol, safeStorage, screen, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const nativeFs = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { fileURLToPath } = require("node:url");
const JSZip = require("jszip");
const mammoth = require("mammoth");
const docx = require("docx");
const iconvLite = require("iconv-lite");
const {
  AI_PROTOCOLS,
  BUILTIN_AI_PROVIDERS,
  activeAiProviderConfig,
  aiApplyResolverRequestParams,
  buildAiRequest,
  createAiModelId,
  exactAiProviderConfig,
  extractAiStreamEvent,
  mergeAiRequestParams,
  mergeAiUsage,
  normalizeAiConfig,
  normalizeAiModelConfig,
  normalizeAiProtocol,
  normalizeAiProviderConfig,
  normalizeAiRequestParams,
  publicAiConfig,
  taskAiProviderConfig,
} = require("./ai-provider-core.cjs");
const {
  CODEX_PROVIDER_ID,
  mergeCodexRefreshedModels,
  refreshCodexStatus,
  startCodexLogin,
  streamCodexCompletion,
} = require("./codex-cli-provider.cjs");
const { normalizeCodexScope, resolveCodexScopeDirectory } = require("./codex-scope.cjs");
const {
  ASSET_PROTOCOL,
  createDocumentAssetRegistry,
  createStagedAssetStore,
  normalizeAssetPath,
  parseAssetUrl: parseDocumentAssetUrl,
} = require("./document-assets.cjs");
const { createAssetPackager } = require("./asset-packager.cjs");
const { createFilesystemAccessRegistry, sanitizeFilesystemName } = require("./filesystem-access.cjs");
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
  apiKeyCanBeReused,
  commitAiTestResultIfCurrent,
  containsPlaintextSecrets,
  createAiTestConfigIdentity,
  decryptProviderSecrets,
  encryptProviderSecrets,
  fetchWithAiRedirectPolicy,
  normalizeProviderBaseUrl,
  redactSecrets,
} = require("./ai-config-security.cjs");
const {
  materializeCodexImageAttachments,
  normalizeCodexImageMode,
} = require("./codex-image-attachments.cjs");
const {
  createWorkspaceSearchIndex,
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
  diskRevisionsEqual,
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
const {
  createSource: createResearchSource,
  deleteCitationSource,
  deleteSource: deleteResearchSource,
  ensureWorkspace,
  listCitationSources,
  listSources: listResearchSources,
  normalizeCitationResearchIdentity,
  readSource: readResearchSource,
  relinkSource: relinkResearchSource,
  resolveSourceFile,
  upsertCitationSource,
  updateSource: updateResearchSource,
} = require("./workspace-research.cjs");
const { createResearchLibraryManager, importLegacyResearch, normalizeWebScopeKey } = require("./research-library.cjs");

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
const ASSET_URL_PATTERN = /src=(["'])(assets\/[^"']+)\1/gi;
const DOCUMENT_EXTENSION = ".letterpaper";
const LEGACY_DOCUMENT_EXTENSION = ".paperdoc";
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];
const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "m4a", "aac", "flac"];
const VIDEO_EXTENSIONS = ["mp4", "webm", "ogv"];
const DOCUMENT_FILTERS = [
  { name: "笺间文档", extensions: ["letterpaper"] },
  { name: "旧版 PaperWriter 文档", extensions: ["paperdoc"] },
  { name: "All Files", extensions: ["*"] },
];
const AI_DEBUG_LOG_MAX_BYTES = 2 * 1024 * 1024;
const AI_DEBUG_LOG_ENTRY_MAX_BYTES = 64 * 1024;
const AI_ERROR_BODY_MAX_BYTES = 64 * 1024;
const AI_JSON_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const AI_STREAM_BUFFER_MAX_CHARS = 1024 * 1024;
const AI_STREAM_OUTPUT_MAX_CHARS = 8 * 1024 * 1024;
const AI_INPUT_MAX_CHARS = 2 * 1024 * 1024;
const AI_FETCH_HEADER_TIMEOUT_MS = 30 * 1000;
const AI_STREAM_IDLE_TIMEOUT_MS = 60 * 1000;
const AI_STREAM_MAX_MS = 10 * 60 * 1000;
const AI_STREAM_INPUT_MAX_BYTES = 64 * 1024 * 1024;
const AI_CONCURRENT_REQUEST_LIMIT = 4;
const SAVED_AI_IMAGE_LIMIT = 2048;
const SAVED_AI_QUOTE_LIMIT = 1000;
const SAVED_AI_MESSAGE_LIMIT = 200;
const SAVED_AI_MESSAGE_TOTAL_CHARS = 8 * 1024 * 1024;
const AI_CONFIG_FILE = "ai-config.json";
const TITLE_BAR_OVERLAY_DEFAULT = {
  color: "#cdd7d2",
  symbolColor: "#334155",
  height: 40,
};
const ASSET_ZIP_CACHE_LIMIT = 5;
const ASSET_ZIP_CACHE_MAX_BYTES = 256 * 1024 * 1024;
const EXTRACTED_ASSET_CACHE_LIMIT = 64;
const EXTRACTED_ASSET_CACHE_MAX_BYTES = 512 * 1024 * 1024;
const EXTRACTED_ASSET_CONCURRENCY = 4;
const ASSET_SOURCE_ALIAS_LIMIT = 10000;
const FILESYSTEM_ACCESS_FILE = "filesystem-access.json";
const DOCUMENT_SCHEMA_VERSION = 2;
const WORKSPACE_SEARCH_CACHE_FOLDER = "workspace-search";
const MIGRATION_BACKUP_FOLDER = "migration-backups";
const RESEARCH_READ_MAX_BYTES = 128 * 1024 * 1024;
const EXPORT_CAPABILITY_TTL_MS = 30 * 60 * 1000;
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
  "worker-src 'none'",
].join("; ");

let mainWindow = null;
let closeRequestInFlight = false;
let forceCloseWindow = false;
let closeAttentionActive = false;
let rendererCanConfirmClose = false;
let pendingUpdateInstall = false;
let downloadGuardInstalled = false;
let updateState = {
  status: "idle",
  message: "尚未检查更新",
  version: app.getVersion(),
};
const activeAiRequests = new Map();
const assetZipCache = new Map();
const assetZipPending = new Map();
const extractedAssetCache = new Map();
const extractedAssetPending = new Map();
const extractedAssetLimiter = createByteBudgetSemaphore({
  maxConcurrent: EXTRACTED_ASSET_CONCURRENCY,
  maxReservedBytes: EXTRACTED_ASSET_CACHE_MAX_BYTES,
});
let assetCacheGeneration = 0;
const documentAssetRegistry = createDocumentAssetRegistry();
const documentWriteQueue = createPathWriteQueue();
const documentMutationQueue = createPathWriteQueue();
const DOCUMENT_MUTATION_LOCK_KEY = path.join(APP_ROOT, ".paperwriter-document-mutation.lock");
const filesystemAccessWriteQueue = createPathWriteQueue();
const filesystemAccess = createFilesystemAccessRegistry();
const exportCapabilities = new Map();
const assetSourceAliases = new Map();
const workspaceSearchIndexes = new Map();
let activeWorkspaceWatcher = null;
let activeWorkspaceWatchRoot = "";
let activeWorkspaceWatchTimer = null;
let stagedAssetStore = null;
let documentInterchange = null;
let researchLibrary = null;
let researchWebViews = null;
let canonicalAutosaveRoot = "";
let canonicalAutosaveSessionRoot = "";
let stagedAssetHeartbeatTimer = null;
let stagedAssetCleanupStarted = false;
let stagedAssetCleanupComplete = false;
let aiConfigMutationTail = Promise.resolve();
let codexRuntimeStatus = {
  installed: false,
  authenticated: false,
  ready: false,
  catalogFresh: false,
  checkedAt: "",
  message: "尚未检查本地 Codex CLI",
};
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function runDocumentMutation(task) {
  return documentMutationQueue.run(DOCUMENT_MUTATION_LOCK_KEY, task);
}

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
  return path.join(path.dirname(app.getPath("exe")), "ai-debug.log");
}

function fallbackAiDebugLogPath() {
  return path.join(app.getPath("userData"), "ai-debug.log");
}

function aiConfigPath() {
  return path.join(app.getPath("userData"), AI_CONFIG_FILE);
}

function filesystemAccessPath() {
  return path.join(app.getPath("userData"), FILESYSTEM_ACCESS_FILE);
}

async function persistFilesystemAccess() {
  const filePath = filesystemAccessPath();
  return filesystemAccessWriteQueue.run(filePath, async () => {
    await atomicWriteFile(filePath, `${JSON.stringify(filesystemAccess.serialize(), null, 2)}\n`);
  });
}

async function initializeFilesystemAccess() {
  try {
    const raw = await fs.readFile(filesystemAccessPath(), "utf8");
    filesystemAccess.load(JSON.parse(raw));
  } catch (error) {
    if (error?.code !== "ENOENT") void writeAiDebugLog("filesystem:access-load-error", { message: error?.message });
  }
  await fs.mkdir(defaultDocumentsDir(), { recursive: true });
  filesystemAccess.authorizeRoot(await fs.realpath(defaultDocumentsDir()));
}

function isResolvedPathInside(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function initializeAutosaveStorage() {
  const requestedUserData = path.resolve(app.getPath("userData"));
  await fs.mkdir(requestedUserData, { recursive: true });
  const userDataRoot = await fs.realpath(requestedUserData);
  const requestedAutosaveRoot = path.join(requestedUserData, "Autosave");
  await fs.mkdir(requestedAutosaveRoot, { recursive: true });
  const resolvedAutosaveRoot = await fs.realpath(requestedAutosaveRoot);
  if (!isResolvedPathInside(userDataRoot, resolvedAutosaveRoot)) {
    throw new Error("自动保存目录指向应用数据目录之外，已拒绝使用");
  }
  const requestedSessionRoot = path.join(resolvedAutosaveRoot, "Session");
  await fs.mkdir(requestedSessionRoot, { recursive: true });
  const resolvedSessionRoot = await fs.realpath(requestedSessionRoot);
  if (!isResolvedPathInside(resolvedAutosaveRoot, resolvedSessionRoot)) {
    throw new Error("临时会话目录指向自动保存目录之外，已拒绝使用");
  }
  canonicalAutosaveRoot = resolvedAutosaveRoot;
  canonicalAutosaveSessionRoot = resolvedSessionRoot;
}

async function canonicalExistingPath(value, expectedType = "") {
  const resolved = await fs.realpath(path.resolve(String(value || "")));
  const stat = await fs.stat(resolved);
  if (expectedType === "directory" && !stat.isDirectory()) throw new Error("目标不是文件夹");
  if (expectedType === "file" && !stat.isFile()) throw new Error("目标不是文件");
  return resolved;
}

async function authorizeFilesystemRoot(value) {
  const resolved = await canonicalExistingPath(value, "directory");
  filesystemAccess.authorizeRoot(resolved);
  await persistFilesystemAccess();
  return resolved;
}

async function resolveDocumentTargetPath(value) {
  const requested = path.resolve(String(value || ""));
  try {
    return await canonicalExistingPath(requested, "file");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const parent = await canonicalExistingPath(path.dirname(requested), "directory");
    return path.join(parent, path.basename(requested));
  }
}

async function authorizeDocumentPath(value, { mustExist = true } = {}) {
  const resolved = mustExist ? await canonicalExistingPath(value, "file") : await resolveDocumentTargetPath(value);
  if (!isSupportedDocument(resolved)) throw new Error("只能授权信笺文档");
  filesystemAccess.authorizeDocument(resolved);
  await persistFilesystemAccess();
  return resolved;
}

async function assertAuthorizedDirectory(value) {
  const resolved = await canonicalExistingPath(value, "directory");
  if (!filesystemAccess.canAccessDirectory(resolved)) throw new Error("这个文件夹尚未由用户授权，请通过“打开文件夹”选择它");
  return resolved;
}

async function assertAuthorizedDocument(value) {
  const resolved = await canonicalExistingPath(value, "file");
  if (!isSupportedDocument(resolved) || !filesystemAccess.canAccessDocument(resolved)) {
    throw new Error("这个信笺路径尚未由用户授权，请通过“打开信笺”选择它");
  }
  return resolved;
}

async function isInternalAutosaveSessionDocument(value) {
  return Boolean(autosaveSessionIdForPath(value));
}

async function resolveAuthorizedOpenDocument(value) {
  const resolved = await canonicalExistingPath(value, "file");
  if (await isInternalAutosaveSessionDocument(resolved)) return resolved;
  if (!isSupportedDocument(resolved) || !filesystemAccess.canAccessDocument(resolved)) {
    throw new Error("这个信笺路径尚未由用户授权，请通过“打开信笺”选择它");
  }
  return resolved;
}

async function assertAuthorizedDocumentTarget(value) {
  const resolved = await resolveDocumentTargetPath(value);
  if (!isSupportedDocument(resolved) || !filesystemAccess.canAccessDocument(resolved)) {
    throw new Error("这个信笺保存位置尚未由用户授权");
  }
  return resolved;
}

async function assertAuthorizedEntry(value, { destructive = false } = {}) {
  const resolved = await canonicalExistingPath(value);
  const stat = await fs.stat(resolved);
  const allowed = stat.isDirectory()
    ? filesystemAccess.canAccessDirectory(resolved)
    : (stat.isFile() && isSupportedDocument(resolved) && filesystemAccess.canAccessDocument(resolved));
  if (!allowed) throw new Error("目标超出已授权的信笺工作区");
  if (destructive && stat.isDirectory() && filesystemAccess.isRoot(resolved)) {
    throw new Error("不能直接修改或删除已授权工作区的根目录");
  }
  return { path: resolved, stat };
}

function exportCapabilityKey(value, kind) {
  const resolved = path.resolve(String(value || ""));
  const pathKey = process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
  return `${kind}:${pathKey}`;
}

function authorizeExportTarget(value, kind) {
  const resolved = path.resolve(String(value || ""));
  for (const [key, expiresAt] of exportCapabilities) {
    if (expiresAt < Date.now()) exportCapabilities.delete(key);
  }
  exportCapabilities.set(exportCapabilityKey(resolved, kind), Date.now() + EXPORT_CAPABILITY_TTL_MS);
  return resolved;
}

function consumeExportTarget(value, kind) {
  const key = exportCapabilityKey(value, kind);
  const expiresAt = exportCapabilities.get(key) || 0;
  exportCapabilities.delete(key);
  if (expiresAt < Date.now()) throw new Error("导出位置授权已失效，请重新选择保存位置");
  return path.resolve(String(value || ""));
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
    let safeData = fallbackReason ? { ...data, fallbackReason } : data;
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
  } catch (error) {
    try {
      return await writeLog(fallbackAiDebugLogPath(), error?.message || "install-dir-write-failed");
    } catch {
      // Debug logging must never break user workflows.
      return "";
    }
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

function assertTrustedIpcSender(event) {
  const sender = event?.sender;
  const senderFrame = event?.senderFrame;
  if (!mainWindow || mainWindow.isDestroyed() || sender !== mainWindow.webContents) throw new Error("拒绝未授权的 IPC 调用");
  if (senderFrame && senderFrame !== sender.mainFrame) throw new Error("拒绝子框架 IPC 调用");
  const senderUrl = senderFrame?.url || sender.getURL();
  if (!isTrustedApplicationUrl(senderUrl)) throw new Error("拒绝非应用页面 IPC 调用");
}

const registerIpcHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => registerIpcHandler(channel, (event, ...args) => {
  assertTrustedIpcSender(event);
  return listener(event, ...args);
});

function emitUpdateState(patch) {
  updateState = {
    ...updateState,
    ...patch,
    version: app.getVersion(),
  };
  sendRendererEvent(mainWindow?.webContents, "update:state", updateState);
  return updateState;
}

function sendRendererEvent(sender, channel, payload) {
  if (!sender || sender.isDestroyed?.()) return false;
  sender.send(channel, payload);
  return true;
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
  void writeAiDebugLog("renderer:unavailable", { reason, ...details }).catch(() => {});
  if (!closeRequestInFlight || !mainWindow || mainWindow.isDestroyed()) return;
  // The user already requested a close, but an unavailable renderer cannot
  // complete the save/discard handshake. Let the native window close instead
  // of leaving a permanently blank or unresponsive process behind.
  closeRequestInFlight = false;
  forceCloseWindow = true;
  mainWindow.close();
}

function createWindow() {
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
    },
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
    revealCloseConfirmation();
    mainWindow.webContents.send("app:close-request", {
      requestedAt: Date.now(),
      reason: pendingUpdateInstall ? "update-install" : "window-close",
    });
  });
  mainWindow.on("unresponsive", () => {
    markRendererUnavailable("unresponsive");
  });
  mainWindow.on("responsive", () => {
    rendererCanConfirmClose = true;
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
    closeAttentionActive = false;
    rendererCanConfirmClose = false;
    researchWebViews?.destroyAll();
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

function registerAssetProtocol() {
  protocol.handle(ASSET_PROTOCOL, async (request) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const parsed = parseAssetUrl(request.url);
    if (!parsed) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const asset = await resolveProtocolAssetFile(parsed);
      const totalBytes = asset.size;
      const range = parseSingleByteRange(request.headers.get("range"), totalBytes);
      const commonHeaders = {
        "content-type": asset.mime,
        "cache-control": parsed.kind === "staged" ? "private, max-age=31536000, immutable" : "no-store",
        "accept-ranges": "bytes",
        "x-content-type-options": "nosniff",
      };
      if (range?.invalid) {
        return new Response(null, { status: 416, headers: { ...commonHeaders, "content-range": `bytes */${totalBytes}` } });
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.max(0, totalBytes - 1);
      const contentLength = totalBytes ? end - start + 1 : 0;
      const headers = {
        ...commonHeaders,
        "content-length": String(contentLength),
        ...(range ? { "content-range": `bytes ${start}-${end}/${totalBytes}` } : {}),
      };
      if (request.method === "HEAD" || totalBytes === 0) {
        return new Response(null, { status: range ? 206 : 200, headers });
      }
      const fileStream = nativeFs.createReadStream(asset.filePath, { start, end });
      request.signal?.addEventListener("abort", () => fileStream.destroy(), { once: true });
      return new Response(Readable.toWeb(fileStream), {
        status: range ? 206 : 200,
        headers: {
          ...headers,
        },
      });
    } catch (error) {
      await writeAiDebugLog("asset:protocol:error", {
        kind: parsed.kind,
        filePath: parsed.filePath,
        assetPath: parsed.assetPath,
        token: parsed.token,
        message: error?.message,
      });
      return new Response("Not found", { status: 404 });
    }
  });
}

autoUpdater.on("checking-for-update", () => {
  emitUpdateState({ status: "checking", message: "正在检查更新..." });
});

autoUpdater.on("update-available", (info) => {
  emitUpdateState({
    status: "available",
    message: `发现新版本 ${info.version}`,
    availableVersion: info.version,
  });
});

autoUpdater.on("update-not-available", () => {
  emitUpdateState({ status: "none", message: "当前已经是最新版本" });
});

autoUpdater.on("download-progress", (progress) => {
  emitUpdateState({
    status: "downloading",
    message: `正在下载更新 ${Math.round(progress.percent || 0)}%`,
    percent: Math.round(progress.percent || 0),
  });
});

autoUpdater.on("update-downloaded", (info) => {
  emitUpdateState({
    status: "downloaded",
    message: `版本 ${info.version} 已下载，重启后安装`,
    availableVersion: info.version,
  });
});

autoUpdater.on("error", (error) => {
  if (pendingUpdateInstall) {
    pendingUpdateInstall = false;
    forceCloseWindow = false;
    closeRequestInFlight = false;
  }
  emitUpdateState({
    status: "error",
    message: `更新失败：${error.message}`,
  });
});

function ensureExtension(filePath, extension) {
  return path.extname(filePath).toLowerCase() === extension ? filePath : `${filePath}${extension}`;
}

function defaultDocumentsDir() {
  return path.join(app.getPath("documents"), "PaperWriter");
}

function resolveAiProvider(config, provider) {
  const normalized = normalizeAiConfig(config);
  return Object.prototype.hasOwnProperty.call(normalized.providers, provider) ? provider : normalized.activeProvider;
}

async function readAiConfig() {
  try {
    const raw = await fs.readFile(aiConfigPath(), "utf8");
    return normalizeAiConfig(decryptProviderSecrets(JSON.parse(raw), safeStorage));
  } catch {
    return normalizeAiConfig();
  }
}

function publicAiConfigWithRuntime(config) {
  return publicAiConfig(config, { [CODEX_PROVIDER_ID]: codexRuntimeStatus });
}

async function queueAiConfigMutation(task) {
  const current = aiConfigMutationTail.catch(() => {}).then(task);
  aiConfigMutationTail = current;
  return current;
}

async function persistAiConfig(config) {
  const stored = encryptProviderSecrets(normalizeAiConfig(config), safeStorage);
  await atomicWriteFile(aiConfigPath(), `${JSON.stringify(stored, null, 2)}\n`);
}

async function migratePlaintextAiSecrets() {
  try {
    const raw = await fs.readFile(aiConfigPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!containsPlaintextSecrets(parsed)) return;
    await persistAiConfig(normalizeAiConfig(decryptProviderSecrets(parsed, safeStorage)));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      await writeAiDebugLog("ai:config:migration-error", { message: error?.message });
    }
  }
}

async function refreshCodexCliConfigUnlocked() {
  const existing = await readAiConfig();
  const previousProvider = existing.providers[CODEX_PROVIDER_ID];
  const status = await refreshCodexStatus({
    previousModels: previousProvider.models,
    appVersion: app.getVersion(),
  });
  // Codex inspection can take several seconds. Re-read before persisting so a
  // concurrent HTTP provider save/test is never replaced by this stale snapshot.
  const latest = await readAiConfig();
  const latestProvider = latest.providers[CODEX_PROVIDER_ID];
  const models = Array.isArray(status.models)
    ? mergeCodexRefreshedModels(latestProvider.models, status.models)
    : latestProvider.models;
  const activeModelId = models.some((model) => model.id === latestProvider.activeModelId)
    ? latestProvider.activeModelId
    : (models.find((model) => model.catalogDefault)?.id || models[0]?.id || "");
  const next = normalizeAiConfig({
    ...latest,
    activeModelId: latest.activeProvider === CODEX_PROVIDER_ID ? activeModelId : latest.activeModelId,
    providers: {
      ...latest.providers,
      [CODEX_PROVIDER_ID]: { ...latestProvider, activeModelId, models },
    },
  });
  await persistAiConfig(next);
  const { models: _models, email, ...runtime } = status;
  codexRuntimeStatus = {
    ...runtime,
    accountLabel: email ? email.replace(/^(.{2}).*(@.*)$/, "$1•••$2") : "",
    ready: Boolean(status.authenticated && models.length && activeModelId),
  };
  return publicAiConfigWithRuntime(next);
}

function refreshCodexCliConfig() {
  return queueAiConfigMutation(refreshCodexCliConfigUnlocked);
}

function validateAiRequestParamsPatch(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("请求参数必须是 Key-Value 对象");
  }
  const normalized = normalizeAiRequestParams(value);
  let sourceJson = "";
  try {
    sourceJson = JSON.stringify(value);
  } catch {
    throw new Error("请求参数包含无法保存的值");
  }
  if (sourceJson !== JSON.stringify(normalized)) {
    throw new Error("请求参数包含空键、保留字段、危险键或无效值");
  }
  return normalized;
}

function mergeAndValidateAiTaskModels(existing, taskModelsPatch) {
  if (!taskModelsPatch || typeof taskModelsPatch !== "object" || Array.isArray(taskModelsPatch)) {
    return existing.taskModels;
  }
  const patchedTaskModels = { ...existing.taskModels, ...taskModelsPatch };
  if (Object.prototype.hasOwnProperty.call(taskModelsPatch, "applyResolver")) {
    const source = taskModelsPatch.applyResolver;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("任务模型配置无效");
    }
    patchedTaskModels.applyResolver = {
      ...source,
      requestParams: validateAiRequestParamsPatch(source.requestParams || {}),
    };
  }
  const merged = normalizeAiConfig({
    ...existing,
    taskModels: patchedTaskModels,
  }).taskModels;
  if (!Object.prototype.hasOwnProperty.call(taskModelsPatch, "applyResolver")) {
    return merged;
  }
  const assignment = merged.applyResolver;
  if (!assignment.providerId && !assignment.modelId) {
    return merged;
  }
  const resolver = exactAiProviderConfig(existing, assignment.providerId, assignment.modelId);
  if (!resolver) {
    throw new Error("任务模型只能选择已连接供应商中的已连接模型");
  }
  if (resolver.transport === "codex-cli") {
    if (Object.keys(assignment.requestParams || {}).length) {
      throw new Error("Codex CLI 任务模型不支持 HTTP 请求参数");
    }
    if (!codexRuntimeStatus.ready) {
      throw new Error("任务模型所选 Codex CLI 当前不可用");
    }
  } else if (!resolver.apiKey || !resolver.testedOk) {
    throw new Error("任务模型只能选择已连接供应商中的已连接模型");
  }
  return merged;
}

async function saveAiConfigUnlocked(patch = {}) {
  const existing = await readAiConfig();
  const nextTaskModels = mergeAndValidateAiTaskModels(existing, patch.taskModels);
  const provider = resolveAiProvider(existing, patch.provider || existing.activeProvider);
  const previousProviderConfig = existing.providers[provider];
  if (Array.isArray(patch.models)) {
    patch.models.forEach((model) => validateAiRequestParamsPatch(model?.requestParams || {}));
  }
  const nextProviderLabel = previousProviderConfig.builtin
    ? previousProviderConfig.providerLabel
    : String(patch.providerLabel ?? previousProviderConfig.providerLabel).slice(0, 1024).trim().slice(0, 120);
  if (!nextProviderLabel) throw new Error("请填写供应商名称");
  if (!previousProviderConfig.builtin && Object.values(existing.providers).some((item) => item.provider !== provider && item.providerLabel.toLocaleLowerCase() === nextProviderLabel.toLocaleLowerCase())) {
    throw new Error("供应商名称已存在");
  }
  const hasModelPatch = Boolean(patch.modelId || patch.model || (Array.isArray(patch.models) && patch.models.length));
  const modelId = hasModelPatch
    ? String(patch.modelId || previousProviderConfig.activeModelId || createAiModelId(provider, patch.model || previousProviderConfig.model)).slice(0, 256).trim()
    : "";
  const previousModels = Array.isArray(patch.models)
    ? patch.models.slice(0, 256).map((modelConfig, index) => normalizeAiModelConfig(provider, modelConfig, index))
    : (previousProviderConfig.models || []);
  const existingModel = previousModels.find((model) => model.id === modelId);
  const nextModel = hasModelPatch ? normalizeAiModelConfig(provider, {
    ...(existingModel || {}), id: modelId,
    name: patch.modelName || existingModel?.name,
    model: patch.model || existingModel?.model,
    testedOk: (patch.resetTest || patch.clearApiKey) ? false : existingModel?.testedOk,
    testedAt: (patch.resetTest || patch.clearApiKey) ? "" : existingModel?.testedAt,
    testMessage: (patch.resetTest || patch.clearApiKey) ? "" : existingModel?.testMessage,
  }) : null;
  const updatedModels = !nextModel ? previousModels : (existingModel
    ? previousModels.map((model) => (model.id === modelId ? nextModel : model))
    : [...previousModels, nextModel]);
  const nextBaseUrl = patch.baseUrl ? normalizeProviderBaseUrl(patch.baseUrl) : previousProviderConfig.baseUrl;
  const patchedApiKey = typeof patch.apiKey === "string" ? patch.apiKey.slice(0, 16384).trim() : "";
  const explicitApiKey = Boolean(patchedApiKey);
  const canReuseApiKey = apiKeyCanBeReused(previousProviderConfig.baseUrl, nextBaseUrl);
  const resetConnectionTest = patch.clearApiKey || patch.resetTest || !canReuseApiKey || nextBaseUrl !== previousProviderConfig.baseUrl;
  const previousModelsById = new Map((previousProviderConfig.models || []).map((model) => [model.id, model]));
  const nextModels = updatedModels.map((model) => {
    const previousModel = previousModelsById.get(model.id);
    const requestParamsChanged = Boolean(previousModel)
      && JSON.stringify(previousModel.requestParams || {}) !== JSON.stringify(model.requestParams || {});
    return resetConnectionTest || requestParamsChanged
      ? { ...model, testedOk: false, testedAt: "", testMessage: "" }
      : model;
  });
  const apiKey = patch.clearApiKey || (!canReuseApiKey && !explicitApiKey)
    ? ""
    : (explicitApiKey ? patchedApiKey : previousProviderConfig.apiKey);
  const next = normalizeAiConfig({
    ...existing,
    taskModels: nextTaskModels,
    activeProvider: patch.activate === true ? provider : existing.activeProvider,
    activeModelId: patch.activate === true ? modelId : existing.activeModelId,
    providers: {
      ...existing.providers,
      [provider]: {
        ...previousProviderConfig,
        providerLabel: nextProviderLabel,
        baseUrl: nextBaseUrl,
        apiKey,
        activeModelId: patch.activate === true && modelId ? modelId : previousProviderConfig.activeModelId,
        models: nextModels,
      },
    },
  });
  await persistAiConfig(next);
  return next;
}

function saveAiConfig(patch = {}) {
  return queueAiConfigMutation(() => saveAiConfigUnlocked(patch));
}

async function createAiProviderUnlocked(input = {}) {
  const existing = await readAiConfig();
  const providerLabel = String(input.providerLabel || input.label || "").slice(0, 1024).trim().slice(0, 120);
  if (!providerLabel) {
    throw new Error("请填写供应商名称");
  }
  const duplicate = Object.values(existing.providers).some((provider) => provider.providerLabel.toLocaleLowerCase() === providerLabel.toLocaleLowerCase());
  if (duplicate) {
    throw new Error("供应商名称已存在");
  }
  const protocol = normalizeAiProtocol(input.protocol);
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl || AI_PROTOCOLS[protocol].baseUrl);
  const provider = `custom-${randomUUID()}`;
  const next = normalizeAiConfig({
    ...existing,
    providers: {
      ...existing.providers,
      [provider]: {
        provider,
        providerLabel,
        protocol,
        builtin: false,
        baseUrl,
        apiKey: "",
        activeModelId: "",
        models: [],
      },
    },
  });
  await persistAiConfig(next);
  return { config: next, provider };
}

function createAiProvider(input = {}) {
  return queueAiConfigMutation(() => createAiProviderUnlocked(input));
}

async function deleteAiProviderUnlocked(provider) {
  const existing = await readAiConfig();
  const providerConfig = existing.providers[provider];
  if (!providerConfig) {
    throw new Error("供应商不存在");
  }
  if (providerConfig.builtin || Object.prototype.hasOwnProperty.call(BUILTIN_AI_PROVIDERS, provider)) {
    throw new Error("内置供应商不可删除");
  }
  if (existing.activeProvider === provider) {
    throw new Error("请先切换默认供应商后再删除");
  }
  const providers = { ...existing.providers };
  delete providers[provider];
  const next = normalizeAiConfig({ ...existing, providers });
  await persistAiConfig(next);
  return next;
}

function deleteAiProvider(provider) {
  return queueAiConfigMutation(() => deleteAiProviderUnlocked(provider));
}

function storedAiTestConfigIdentity(config, provider, modelId) {
  const providerExists = Boolean(config?.providers && Object.prototype.hasOwnProperty.call(config.providers, provider));
  const providerConfig = providerExists ? config.providers[provider] : null;
  const modelConfig = providerConfig?.models?.find((model) => model.id === modelId) || null;
  return createAiTestConfigIdentity({
    provider: providerExists ? provider : "",
    protocol: providerConfig?.protocol || "",
    modelId,
    modelPresent: Boolean(modelConfig),
    modelName: modelConfig?.name || "",
    model: modelConfig?.model || "",
    requestParams: modelConfig?.requestParams || {},
    baseUrl: providerConfig?.baseUrl || "",
    apiKey: providerConfig?.apiKey || "",
  });
}

async function updateAiProviderTestStateUnlocked(provider, modelId, testState, expectedIdentity) {
  return commitAiTestResultIfCurrent({
    expectedIdentity,
    readCurrent: readAiConfig,
    identityFromCurrent: (current) => storedAiTestConfigIdentity(current, provider, modelId),
    commit: async (existing) => {
      const previousProviderConfig = existing.providers[provider];
      const normalizedModelId = String(modelId || previousProviderConfig.activeModelId || createAiModelId(provider, testState.model || previousProviderConfig.model)).slice(0, 256).trim();
      const previousModels = previousProviderConfig.models || [];
      const existingModel = previousModels.find((model) => model.id === normalizedModelId);
      const nextModel = normalizeAiModelConfig(provider, {
        ...(existingModel || {}),
        id: normalizedModelId,
        name: testState.modelName || existingModel?.name,
        ...testState,
      });
      const nextModels = existingModel
        ? previousModels.map((model) => (model.id === normalizedModelId ? nextModel : model))
        : [...previousModels, nextModel];
      const next = normalizeAiConfig({
        ...existing,
        activeProvider: existing.activeProvider,
        providers: {
          ...existing.providers,
          [provider]: {
            ...previousProviderConfig,
            baseUrl: testState.baseUrl ? normalizeProviderBaseUrl(testState.baseUrl) : previousProviderConfig.baseUrl,
            apiKey: testState.apiKey || previousProviderConfig.apiKey,
            models: nextModels,
          },
        },
      });
      await persistAiConfig(next);
      return next;
    },
  });
}

function updateAiProviderTestState(provider, modelId, testState, expectedIdentity) {
  return queueAiConfigMutation(() => updateAiProviderTestStateUnlocked(provider, modelId, testState, expectedIdentity));
}

async function readAiErrorBody(response) {
  try {
    const text = await readResponseTextLimited(response, AI_ERROR_BODY_MAX_BYTES);
    return text.replace(/\s+/g, " ").slice(0, 500);
  } catch {
    return "";
  }
}

async function assertAiResponseOk(response, secrets = []) {
  if (response.ok) {
    return;
  }
  const details = redactSecrets(await readAiErrorBody(response), secrets);
  throw new Error(`AI 请求失败 ${response.status}${details ? `：${details}` : ""}`);
}

async function readResponseTextLimited(response, maximumBytes) {
  if (!response?.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new Error("AI 响应数据过大");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("AI 响应数据过大");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function aiFetch(url, options = {}) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const onExternalAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("AI 服务连接超时"));
  }, AI_FETCH_HEADER_TIMEOUT_MS);
  try {
    return await fetchWithAiRedirectPolicy(net.fetch.bind(net), url, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new Error("AI 服务连接超时", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

async function readAiStreamChunk(reader) {
  let timer;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("AI 流式响应超时")), AI_STREAM_IDLE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function testAiConfig(config) {
  if (!config.apiKey) {
    throw new Error("请先填写 API Key");
  }
  if (!config.model) {
    throw new Error("请先添加模型");
  }
  const securedConfig = { ...config, baseUrl: normalizeProviderBaseUrl(config.baseUrl) };
  const request = buildAiRequest(securedConfig, [{ role: "user", content: "请只回复 OK" }], { test: true });
  const response = await aiFetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  await assertAiResponseOk(response, [config.apiKey]);
  await response.body?.cancel().catch(() => {});
  return { ok: true, message: "AI 连接可用" };
}

function normalizeAiMessages(payload = {}) {
  if (Array.isArray(payload.messages)) {
    const candidates = payload.messages
      .slice(-100)
      .map((message) => ({
        role: ["system", "user", "assistant"].includes(message?.role) ? message.role : "user",
        content: String(message?.content || "").slice(0, 200000),
      }))
      .filter((message) => message.content.trim());
    let remainingCharacters = AI_INPUT_MAX_CHARS;
    const messages = candidates.flatMap((message) => {
      if (remainingCharacters <= 0) return [];
      const content = message.content.slice(0, remainingCharacters);
      remainingCharacters -= content.length;
      return content.trim() ? [{ ...message, content }] : [];
    });
    if (messages.length) {
      return messages;
    }
  }
  return [{ role: "user", content: String(payload.prompt || "").slice(0, Math.min(200000, AI_INPUT_MAX_CHARS)) }];
}

function aiApplyResolverMessages(manifest, selectedBlock, optimizationContext = {}, repair = null) {
  const safeOptimizationBlock = (block) => ({
    type: String(block?.type || "paragraph").slice(0, 64),
    text: String(block?.text || "").slice(0, 100000),
    caption: String(block?.caption || "").slice(0, 2000),
    items: Array.isArray(block?.items) ? block.items.slice(0, 1000).map((item) => ({ text: String(item?.text ?? item ?? "").slice(0, 10000) })) : [],
    headers: Array.isArray(block?.headers) ? block.headers.slice(0, 100).map((item) => String(item || "").slice(0, 10000)) : [],
    rows: Array.isArray(block?.rows) ? block.rows.slice(0, 1000).map((row) => (Array.isArray(row) ? row.slice(0, 100).map((item) => String(item || "").slice(0, 10000)) : [])) : [],
  });
  const safeManifest = {
    version: 1,
    documentFingerprint: String(manifest?.documentFingerprint || "").slice(0, 128),
    blocks: Array.isArray(manifest?.blocks) ? manifest.blocks.slice(0, 5000).map((block) => ({
      id: String(block?.id || "").slice(0, 128),
      index: Math.max(0, Math.floor(Number(block?.index) || 0)),
      type: String(block?.type || "").slice(0, 64),
      text: String(block?.text || "").slice(0, 100000),
      protected: Boolean(block?.protected),
    })) : [],
  };
  const safeBlock = safeOptimizationBlock(selectedBlock);
  const safeContext = {
    selectedIndex: Math.max(0, Math.floor(Number(optimizationContext?.selectedIndex) || 0)),
    totalBlocks: Math.max(0, Math.floor(Number(optimizationContext?.totalBlocks) || 0)),
    previousBlocks: Array.isArray(optimizationContext?.previousBlocks)
      ? optimizationContext.previousBlocks.slice(-2).map(safeOptimizationBlock)
      : [],
    nextBlocks: Array.isArray(optimizationContext?.nextBlocks)
      ? optimizationContext.nextBlocks.slice(0, 2).map(safeOptimizationBlock)
      : [],
  };
  const safeRepair = repair && typeof repair === "object" ? {
    code: String(repair.code || "invalid_schema").slice(0, 64),
    message: String(repair.message || "返回格式不符合要求").slice(0, 1000),
    previousRaw: String(repair.previousRaw || "").slice(0, 16000),
  } : null;
  const payload = JSON.stringify({
    manifest: safeManifest,
    selectedOptimizationBlock: safeBlock,
    optimizationContext: safeContext,
  });
  if (payload.length > AI_INPUT_MAX_CHARS) throw new Error("当前信笺过长，无法安全生成应用裁决");
  const messages = [
    {
      role: "system",
      content: [
        "你是笺间的应用落点裁决器。你只能决定选中优化块在当前信笺中的落点，绝不能改写优化块内容。",
        "只返回一个 JSON 对象，不要使用 Markdown 代码围栏，不要添加解释文字。",
        "允许 action: replace, insert_before, insert_after, unresolved。",
        "四种动作使用互斥字段，不适用字段必须省略，禁止返回 null、空字符串或空数组占位。",
        "replace 只允许字段 version, action, targetBlockIds, confidence, reason, documentFingerprint；targetBlockIds 必须按正文顺序连续。",
        "insert_before/insert_after 只允许字段 version, action, anchorBlockId, confidence, reason, documentFingerprint。",
        "unresolved 只允许字段 version, action, confidence, reason, documentFingerprint，且 reason 必须说明无法定位的原因。",
        "不得选择 protected=true 的块。无法可靠判断时必须 unresolved。",
        "documentFingerprint 必须原样返回输入值；version 必须为 1；confidence 必须位于 0 到 1。",
        'replace 示例：{"version":1,"action":"replace","targetBlockIds":["block-2-abc"],"confidence":0.96,"reason":"内容对应","documentFingerprint":"doc-abc"}',
        'insert_before 示例：{"version":1,"action":"insert_before","anchorBlockId":"block-2-abc","confidence":0.91,"reason":"新增过渡段","documentFingerprint":"doc-abc"}',
        'insert_after 示例：{"version":1,"action":"insert_after","anchorBlockId":"block-2-abc","confidence":0.91,"reason":"新增补充段","documentFingerprint":"doc-abc"}',
        'unresolved 示例：{"version":1,"action":"unresolved","confidence":0.3,"reason":"存在多个同样合理的位置","documentFingerprint":"doc-abc"}',
      ].join("\n"),
    },
    { role: "user", content: payload },
  ];
  if (safeRepair) {
    messages.push(
      { role: "assistant", content: safeRepair.previousRaw || "（上次响应为空）" },
      {
        role: "user",
        content: `上次响应未通过本地校验（${safeRepair.code}：${safeRepair.message}）。只修正位置 JSON 中的格式、字段或目标，不要重新判断或改写优化内容，也不要扩展任务。只返回修正后的 JSON 对象，不要添加解释。`,
      },
    );
  }
  return messages;
}

async function resolveAiApplyWithModel(config, messages) {
  if (!config?.testedOk) throw new Error("应用裁决模型尚未通过可用性测试");
  if (config.transport === "codex-cli") {
    let output = "";
    let outputTooLong = false;
    await streamCodexCompletion({
      executable: codexRuntimeStatus.executablePath,
      config,
      messages,
      cwd: app.getPath("temp"),
      scope: { mode: "document-only", relativePath: "" },
      onDelta: (delta) => {
        if (outputTooLong) return;
        output += String(delta || "");
        if (output.length > 128 * 1024) {
          output = output.slice(0, 128 * 1024);
          outputTooLong = true;
        }
      },
    });
    if (outputTooLong) throw new Error("应用裁决响应过长");
    return output.trim();
  }
  if (!config.apiKey) throw new Error("应用裁决模型缺少 API Key");
  const request = buildAiRequest(config, messages, { stream: false });
  const response = await aiFetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  await assertAiResponseOk(response, [config.apiKey]);
  const raw = await readResponseTextLimited(response, 512 * 1024);
  const payload = JSON.parse(raw);
  const output = config.protocol === "anthropic"
    ? (payload?.content || []).filter((item) => item?.type === "text").map((item) => item.text || "").join("")
    : String(payload?.choices?.[0]?.message?.content || "");
  if (!output.trim()) throw new Error("应用裁决模型没有返回结果");
  return output.trim();
}

async function streamAiCompletion(sender, requestId, config, messages, signal) {
  if (!config.apiKey) {
    throw new Error("请先在 AI 设置里填写 API Key");
  }
  const securedConfig = { ...config, baseUrl: normalizeProviderBaseUrl(config.baseUrl) };
  const request = buildAiRequest(securedConfig, messages, { stream: true });
  const response = await aiFetch(request.url, {
    method: "POST",
    headers: request.headers,
    signal,
    body: JSON.stringify(request.body),
  });
  await assertAiResponseOk(response, [config.apiKey]);
  const contentType = response.headers.get("content-type") || "";
  if (!response.body || !contentType.toLowerCase().includes("text/event-stream")) {
    const rawPayload = await readResponseTextLimited(response, AI_JSON_RESPONSE_MAX_BYTES);
    const payload = JSON.parse(rawPayload);
    const delta = config.protocol === "anthropic"
      ? (payload?.content || []).filter((item) => item?.type === "text").map((item) => item.text || "").join("")
      : extractAiStreamEvent(config.protocol, payload).delta;
    if (delta) {
      sendRendererEvent(sender, "ai:chunk", { requestId, delta });
    }
    return mergeAiUsage(config.protocol, payload, null);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;
  let outputCharacters = 0;
  let parseErrors = 0;
  let inputBytes = 0;
  const streamStartedAt = Date.now();
  try {
    while (true) {
      if (Date.now() - streamStartedAt > AI_STREAM_MAX_MS) throw new Error("AI 流式生成超时");
      const { done, value } = await readAiStreamChunk(reader);
      if (done) {
        break;
      }
      inputBytes += value.byteLength;
      if (inputBytes > AI_STREAM_INPUT_MAX_BYTES) throw new Error("AI 流式响应数据过大");
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > AI_STREAM_BUFFER_MAX_CHARS) throw new Error("AI 流式响应单行过大");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) {
          continue;
        }
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          return usage;
        }
        let payload;
        try {
          payload = JSON.parse(data);
        } catch (error) {
          parseErrors += 1;
          if (parseErrors <= 3) {
            void writeAiDebugLog("ai:stream:parse-error", { message: error?.message, data: data.slice(0, 200) });
          }
          continue;
        }
        usage = mergeAiUsage(config.protocol, payload, usage);
        const streamEvent = extractAiStreamEvent(config.protocol, payload);
        if (streamEvent.error) {
          throw new Error(streamEvent.error);
        }
        if (streamEvent.delta) {
          outputCharacters += streamEvent.delta.length;
          if (outputCharacters > AI_STREAM_OUTPUT_MAX_CHARS) throw new Error("AI 生成内容超过安全上限");
          sendRendererEvent(sender, "ai:chunk", { requestId, delta: streamEvent.delta });
        }
        if (streamEvent.done) {
          return usage;
        }
      }
    }
    return usage;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function streamCodexForPayload(event, requestId, config, messages, payload, controller) {
  const resolvedScope = await resolveCodexScopeDirectory({
    scope: payload?.codexScope,
    tempRoot: path.join(app.getPath("temp"), "PaperWriterCodex"),
  });
  let resolvedImages = { attachments: [], imagePaths: [], cleanup: async () => {} };
  try {
    if (normalizeCodexImageMode(payload?.codexImageMode) === "original" && Array.isArray(payload?.codexImages) && payload.codexImages.length) {
      resolvedImages = await materializeCodexImageAttachments({
        images: payload.codexImages,
        tempRoot: path.join(app.getPath("temp"), "PaperWriterCodex"),
        readProtocolAsset,
      });
    }
    return await streamCodexCompletion({
      executable: codexRuntimeStatus.executablePath,
      config,
      messages,
      cwd: resolvedScope.cwd,
      scope: resolvedScope.scope,
      attachments: resolvedImages.attachments,
      imagePaths: resolvedImages.imagePaths,
      signal: controller.signal,
      onDelta: (delta) => sendRendererEvent(event.sender, "ai:chunk", { requestId, delta }),
    });
  } finally {
    await Promise.allSettled([resolvedImages.cleanup(), resolvedScope.cleanup()]);
  }
}

function sanitizeName(name, fallback = "未命名") {
  return sanitizeFilesystemName(name, fallback, 80);
}

function timestampForFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatPaperDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "今天";
  }
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
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

function autosavePath() {
  const root = canonicalAutosaveRoot || path.join(app.getPath("userData"), "Autosave");
  return path.join(root, `autosave${DOCUMENT_EXTENSION}`);
}

function autosaveSessionPath(tabId = "") {
  const safeId = String(tabId || "");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(safeId)) throw new Error("无效的临时会话标识");
  const root = canonicalAutosaveSessionRoot || path.join(app.getPath("userData"), "Autosave", "Session");
  return path.join(root, `${safeId}${DOCUMENT_EXTENSION}`);
}

function autosaveSessionIdForPath(value) {
  const resolved = path.resolve(String(value || ""));
  const sessionRoot = canonicalAutosaveSessionRoot;
  const relative = sessionRoot ? path.relative(sessionRoot, resolved) : "";
  if (
    !sessionRoot
    || !relative
    || relative.startsWith(`..${path.sep}`)
    || relative === ".."
    || path.isAbsolute(relative)
    || relative.includes(path.sep)
    || path.extname(relative).toLowerCase() !== DOCUMENT_EXTENSION
  ) {
    return "";
  }
  const recoveryId = path.basename(relative, path.extname(relative));
  return /^[a-zA-Z0-9_-]{1,80}$/.test(recoveryId) ? recoveryId : "";
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function isSupportedDocument(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === DOCUMENT_EXTENSION || extension === LEGACY_DOCUMENT_EXTENSION;
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

function createEmptyAiState() {
  return {
    version: 3,
    lastMode: "",
    optimize: {
      output: "",
      status: "ready",
      error: "",
      assets: { images: {}, quotes: [] },
      elapsedSeconds: 0,
      tokenStats: null,
      provider: "",
      modelId: "",
      modelName: "",
      updatedAt: "",
    },
    chat: {
      messages: [],
      input: "",
      selectedTexts: [],
      codexScope: normalizeCodexScope(),
      codexImageMode: normalizeCodexImageMode(),
      status: "idle",
      error: "",
      updatedAt: "",
    },
  };
}

function normalizeSavedAiState(state = {}) {
  const source = state && typeof state === "object" ? state : {};
  const empty = createEmptyAiState();
  const optimize = source.optimize && typeof source.optimize === "object" ? source.optimize : {};
  const chat = source.chat && typeof source.chat === "object" ? source.chat : {};
  const imageEntries = [];
  const imageSource = optimize.assets?.images && typeof optimize.assets.images === "object" ? optimize.assets.images : {};
  for (const key in imageSource) {
    if (!Object.prototype.hasOwnProperty.call(imageSource, key)) continue;
    imageEntries.push([key, imageSource[key]]);
    if (imageEntries.length >= SAVED_AI_IMAGE_LIMIT) break;
  }
  const normalizedImages = Object.fromEntries(
    imageEntries.map(([key, image], index) => [String(key).slice(0, 128), {
      number: Math.max(1, Math.floor(Number(image?.number) || index + 1)),
      caption: String(image?.caption || image?.alt || "图片").slice(0, 240),
      src: typeof image?.src === "string" ? image.src : "",
      alt: typeof image?.alt === "string" ? image.alt.slice(0, 240) : "",
      width: typeof image?.width === "string" ? image.width.slice(0, 32) : "78%",
    }]),
  );
  const normalizedQuotes = (Array.isArray(optimize.assets?.quotes) ? optimize.assets.quotes : [])
    .slice(0, SAVED_AI_QUOTE_LIMIT)
    .map((quote) => ({ text: String(quote?.text || "").slice(0, 10000) }));
  const messageCandidates = (Array.isArray(chat.messages) ? chat.messages : []).slice(-SAVED_AI_MESSAGE_LIMIT);
  const normalizedMessages = [];
  let remainingMessageCharacters = SAVED_AI_MESSAGE_TOTAL_CHARS;
  for (let index = messageCandidates.length - 1; index >= 0 && remainingMessageCharacters > 0; index -= 1) {
    const message = messageCandidates[index];
    const content = typeof message?.content === "string"
      ? message.content.slice(0, Math.min(200000, remainingMessageCharacters))
      : "";
    remainingMessageCharacters -= content.length;
    normalizedMessages.unshift({
      id: typeof message?.id === "string" ? message.id.slice(0, 128) : `message-${index}`,
      role: message?.role === "assistant" ? "assistant" : "user",
      content,
      status: ["done", "streaming", "stopped", "error"].includes(message?.status) ? message.status : "done",
      elapsedSeconds: Number.isFinite(Number(message?.elapsedSeconds)) ? Math.max(0, Number(message.elapsedSeconds)) : 0,
      createdAt: Number.isFinite(Number(message?.createdAt)) ? Number(message.createdAt) : Date.now(),
      usage: Number.isFinite(Number(message?.usage)) ? Number(message.usage) : undefined,
      usageEstimated: Boolean(message?.usageEstimated),
      cachedTokens: Number.isFinite(Number(message?.cachedTokens)) ? Number(message.cachedTokens) : undefined,
    });
  }
  const normalizedSelections = (Array.isArray(chat.selectedTexts) ? chat.selectedTexts : [])
    .slice(0, 100)
    .map((selection, index) => ({
      id: typeof selection?.id === "string" && selection.id ? selection.id.slice(0, 128) : `selection-${index}`,
      text: typeof selection?.text === "string" ? selection.text.slice(0, 20000) : "",
      from: Number.isFinite(Number(selection?.from)) ? Number(selection.from) : 1,
      to: Number.isFinite(Number(selection?.to)) ? Number(selection.to) : 1,
    }))
    .filter((selection) => selection.text);
  const tokenTotal = Number(optimize.tokenStats?.totalTokens);
  const cachedTokenTotal = Number(optimize.tokenStats?.cachedTokens);
  const tokenStats = optimize.tokenStats && typeof optimize.tokenStats === "object" ? {
    totalTokens: Number.isFinite(tokenTotal) ? Math.max(0, tokenTotal) : 0,
    estimated: Boolean(optimize.tokenStats.estimated),
    cachedTokens: Number.isFinite(cachedTokenTotal) ? Math.max(0, cachedTokenTotal) : 0,
  } : null;
  return {
    version: 3,
    lastMode: ["optimize", "chat"].includes(source.lastMode) ? source.lastMode : "",
    optimize: {
      ...empty.optimize,
      status: optimize.status === "done" || optimize.status === "error" ? optimize.status : "ready",
      output: typeof optimize.output === "string" ? optimize.output.slice(0, AI_STREAM_OUTPUT_MAX_CHARS) : "",
      error: typeof optimize.error === "string" ? optimize.error.slice(0, 2000) : "",
      assets: optimize.assets && typeof optimize.assets === "object"
        ? {
            images: normalizedImages,
            quotes: normalizedQuotes,
          }
        : empty.optimize.assets,
      elapsedSeconds: Number.isFinite(Number(optimize.elapsedSeconds)) ? Math.max(0, Number(optimize.elapsedSeconds)) : 0,
      tokenStats,
      provider: typeof optimize.provider === "string" ? optimize.provider.slice(0, 128) : "",
      modelId: typeof optimize.modelId === "string" ? optimize.modelId.slice(0, 256) : "",
      modelName: typeof optimize.modelName === "string" ? optimize.modelName.slice(0, 256) : "",
      updatedAt: typeof optimize.updatedAt === "string" ? optimize.updatedAt.slice(0, 64) : "",
    },
    chat: {
      ...empty.chat,
      messages: normalizedMessages,
      input: typeof chat.input === "string" ? chat.input.slice(0, 200000) : "",
      selectedTexts: normalizedSelections,
      codexScope: normalizeCodexScope(chat.codexScope),
      codexImageMode: normalizeCodexImageMode(chat.codexImageMode),
      status: chat.status === "error" ? "error" : "idle",
      error: typeof chat.error === "string" ? chat.error.slice(0, 2000) : "",
      updatedAt: typeof chat.updatedAt === "string" ? chat.updatedAt.slice(0, 64) : "",
    },
  };
}

function parseAssetUrl(value) {
  const parsed = parseDocumentAssetUrl(value, {
    hasStagedToken: (token) => Boolean(stagedAssetStore?.has(token)),
    resolveDocumentReference: (reference) => documentAssetRegistry.resolve(reference),
  });
  if (parsed?.kind === "document" && !isSupportedDocument(parsed.filePath)) return null;
  return parsed ? { ...parsed, sourceUrl: String(value || "") } : null;
}

function rebaseAssetPathReferences(fromPath, toPath) {
  const source = path.resolve(String(fromPath || ""));
  const target = path.resolve(String(toPath || ""));
  invalidateExtractedAssetsForPath(source, true);
  documentAssetRegistry.rebasePath(source, target);
  for (const alias of assetSourceAliases.values()) {
    const relative = path.relative(source, alias.filePath);
    const inside = relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
    if (inside) alias.filePath = relative ? path.resolve(target, relative) : target;
  }
  assetCacheGeneration += 1;
  assetZipCache.clear();
}

function rememberAssetZip(filePath, stat, zip) {
  const key = String(filePath || "");
  if (!key || !stat || !zip) {
    return;
  }
  if (stat.size > ASSET_ZIP_CACHE_MAX_BYTES) return;
  assetZipCache.set(key, {
    zip,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    lastAccess: Date.now(),
  });
  let cachedBytes = [...assetZipCache.values()].reduce((total, entry) => total + entry.size, 0);
  while (assetZipCache.size > ASSET_ZIP_CACHE_LIMIT || cachedBytes > ASSET_ZIP_CACHE_MAX_BYTES) {
    const oldest = [...assetZipCache.entries()]
      .sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0];
    if (!oldest) break;
    assetZipCache.delete(oldest[0]);
    cachedBytes -= oldest[1].size;
  }
}

async function getAssetZip(filePath) {
  const sourcePath = path.resolve(String(filePath || ""));
  if (!sourcePath || !isSupportedDocument(sourcePath)) {
    throw new Error("无效的信笺资源路径");
  }
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile() || stat.size > DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes) {
    throw new Error("信笺文件过大或不是普通文件，已拒绝读取资源");
  }
  const cached = assetZipCache.get(sourcePath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    cached.lastAccess = Date.now();
    return cached.zip;
  }
  const pendingKey = `${sourcePath}\n${stat.size}\n${stat.mtimeMs}`;
  if (assetZipPending.has(pendingKey)) return assetZipPending.get(pendingKey);
  const generation = assetCacheGeneration;
  const pending = (async () => {
    const buffer = await fs.readFile(sourcePath);
    preflightZipBuffer(buffer);
    const zip = await JSZip.loadAsync(buffer);
    validatePaperArchive(zip, { archiveBytes: buffer.length });
    if (generation === assetCacheGeneration) rememberAssetZip(sourcePath, stat, zip);
    return zip;
  })();
  assetZipPending.set(pendingKey, pending);
  try {
    return await pending;
  } finally {
    if (assetZipPending.get(pendingKey) === pending) assetZipPending.delete(pendingKey);
  }
}

async function readPackagedAsset(filePath, assetPath, { maxBytes = DEFAULT_ARCHIVE_LIMITS.maxAssetBytes } = {}) {
  const normalizedAssetPath = normalizeAssetPath(assetPath);
  if (!normalizedAssetPath) {
    throw new Error("无效的资源路径");
  }
  const zip = await getAssetZip(filePath);
  const file = zip.file(normalizedAssetPath);
  if (!file) {
    throw new Error("资源不存在");
  }
  const buffer = await readZipEntryBufferLimited(file, { maxBytes });
  return {
    buffer,
    mime: mimeFromPath(normalizedAssetPath),
  };
}

function extractedAssetCacheKey(filePath, stat, assetPath) {
  const resolved = path.resolve(String(filePath || ""));
  const pathKey = process.platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
  return `${pathKey}\n${stat.size}\n${stat.mtimeMs}\n${assetPath}`;
}

function invalidateExtractedAssetsForPath(filePath, includeChildren = false) {
  const source = path.resolve(String(filePath || ""));
  for (const [key, entry] of extractedAssetCache) {
    const relative = path.relative(source, entry.sourcePath);
    const matches = relative === "" || (includeChildren && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
    if (!matches) continue;
    extractedAssetCache.delete(key);
    fs.rm(entry.filePath, { force: true }).catch(() => {});
  }
}

function invalidateDocumentCachesForPath(filePath, includeChildren = false, { revokeReferences = false } = {}) {
  const source = path.resolve(String(filePath || ""));
  const contains = (candidate) => {
    const relative = path.relative(source, path.resolve(String(candidate || "")));
    return relative === "" || (includeChildren && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  };
  assetCacheGeneration += 1;
  invalidateExtractedAssetsForPath(source, includeChildren);
  for (const cachePath of [...assetZipCache.keys()]) {
    if (contains(cachePath)) assetZipCache.delete(cachePath);
  }
  if (!revokeReferences) return;
  documentAssetRegistry.revokePath(source, includeChildren);
  for (const [sourceUrl, alias] of [...assetSourceAliases.entries()]) {
    if (contains(alias.filePath)) assetSourceAliases.delete(sourceUrl);
  }
}

async function pruneExtractedAssetCache() {
  let totalBytes = [...extractedAssetCache.values()].reduce((total, entry) => total + entry.size, 0);
  while (extractedAssetCache.size > EXTRACTED_ASSET_CACHE_LIMIT || totalBytes > EXTRACTED_ASSET_CACHE_MAX_BYTES) {
    const oldest = [...extractedAssetCache.entries()]
      .sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0];
    if (!oldest) break;
    extractedAssetCache.delete(oldest[0]);
    totalBytes -= oldest[1].size;
    await fs.rm(oldest[1].filePath, { force: true }).catch(() => {});
  }
}

async function materializePackagedAsset(filePath, assetPath) {
  if (!stagedAssetStore) throw new Error("资源暂存服务尚未就绪");
  const sourcePath = path.resolve(String(filePath || ""));
  const normalizedAssetPath = normalizeAssetPath(assetPath);
  if (!normalizedAssetPath || !isSupportedDocument(sourcePath)) throw new Error("无效的信笺资源路径");
  const sourceStat = await fs.stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size > DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes) throw new Error("信笺文件过大或不是普通文件");
  const key = extractedAssetCacheKey(sourcePath, sourceStat, normalizedAssetPath);
  const cached = extractedAssetCache.get(key);
  if (cached) {
    try {
      const cachedStat = await fs.stat(cached.filePath);
      if (cachedStat.isFile() && cachedStat.size === cached.size) {
        cached.lastAccess = Date.now();
        return { ...cached };
      }
    } catch { /* Re-extract below. */ }
    extractedAssetCache.delete(key);
  }
  if (extractedAssetPending.has(key)) return extractedAssetPending.get(key);

  const pending = (async () => {
    const zip = await getAssetZip(sourcePath);
    const entry = zip.file(normalizedAssetPath);
    const sizes = assertZipEntryReadable(entry);
    const releaseExtractionSlot = await extractedAssetLimiter.acquire(sizes.uncompressedSize);
    const cacheDir = path.join(stagedAssetStore.sessionDir, "document-assets");
    await fs.mkdir(cacheDir, { recursive: true });
    const rawExtension = path.extname(normalizedAssetPath).toLowerCase();
    const extension = /^\.[a-z0-9]{1,12}$/i.test(rawExtension) ? rawExtension : "";
    const outputPath = path.join(cacheDir, `${randomUUID()}${extension}`);
    const temporaryPath = `${outputPath}.tmp`;
    try {
      await pipeline(
        entry.nodeStream("nodebuffer"),
        createZipEntryLimitTransform(entry),
        nativeFs.createWriteStream(temporaryPath, { flags: "wx" }),
      );
      const outputStat = await fs.stat(temporaryPath);
      if (!outputStat.isFile() || outputStat.size !== sizes.uncompressedSize) throw new Error("解压后的信笺资源不完整");
      const latestSourceStat = await fs.stat(sourcePath);
      if (
        !latestSourceStat.isFile()
        || latestSourceStat.dev !== sourceStat.dev
        || latestSourceStat.ino !== sourceStat.ino
        || latestSourceStat.size !== sourceStat.size
        || latestSourceStat.mtimeMs !== sourceStat.mtimeMs
      ) {
        throw new Error("信笺资源来源已被移动、删除或替换");
      }
      await fs.rename(temporaryPath, outputPath);
      const record = {
        filePath: outputPath,
        sourcePath,
        assetPath: normalizedAssetPath,
        mime: mimeFromPath(normalizedAssetPath),
        size: outputStat.size,
        lastAccess: Date.now(),
      };
      extractedAssetCache.set(key, record);
      await pruneExtractedAssetCache();
      return { ...record };
    } catch (error) {
      await Promise.allSettled([
        fs.rm(temporaryPath, { force: true }),
        fs.rm(outputPath, { force: true }),
      ]);
      throw error;
    } finally {
      releaseExtractionSlot();
    }
  })();
  extractedAssetPending.set(key, pending);
  try {
    return await pending;
  } finally {
    if (extractedAssetPending.get(key) === pending) extractedAssetPending.delete(key);
  }
}

async function resolveProtocolAssetFile(parsed) {
  try {
    if (parsed?.kind === "staged") {
      if (!stagedAssetStore) throw new Error("资源暂存服务尚未就绪");
      const asset = await stagedAssetStore.resolve(parsed.token);
      return { ...asset, mime: asset.mime || mimeFromPath(asset.filePath) };
    }
    if (parsed?.kind === "document") return materializePackagedAsset(parsed.filePath, parsed.assetPath);
    throw new Error("无效或未注册的信笺资源地址");
  } catch (error) {
    const alias = assetSourceAliases.get(parsed?.sourceUrl);
    if (!alias) throw error;
    return materializePackagedAsset(alias.filePath, alias.assetPath);
  }
}

async function readAssetFromParsedUrl(parsed, { maxBytes = DEFAULT_ARCHIVE_LIMITS.maxAssetBytes } = {}) {
  try {
    if (parsed?.kind === "staged") {
      if (!stagedAssetStore) throw new Error("图片暂存服务尚未就绪");
      const resolved = await stagedAssetStore.resolve(parsed.token);
      if (resolved.size > maxBytes) throw new Error("暂存资源过大，无法安全读取");
      const asset = await stagedAssetStore.read(parsed.token);
      return {
        ...asset,
        mime: asset.mime || mimeFromPath(asset.filePath),
      };
    }
    if (parsed?.kind === "document") {
      return {
        ...(await readPackagedAsset(parsed.filePath, parsed.assetPath, { maxBytes })),
        kind: "document",
        assetPath: parsed.assetPath,
      };
    }
    throw new Error("无效或未注册的信笺资源地址");
  } catch (error) {
    const alias = assetSourceAliases.get(parsed?.sourceUrl);
    if (!alias) throw error;
    return {
      ...(await readPackagedAsset(alias.filePath, alias.assetPath, { maxBytes })),
      kind: "document",
      assetPath: alias.assetPath,
    };
  }
}

async function readProtocolAsset(sourceUrl, options = {}) {
  const parsed = parseAssetUrl(sourceUrl);
  if (!parsed) throw new Error("无效或未注册的信笺资源地址");
  return readAssetFromParsedUrl(parsed, options);
}

function nextZipAssetPath(zip, preferredPath, extension = ".png") {
  const normalizedPreferred = normalizeAssetPath(preferredPath);
  if (normalizedPreferred && !zip.file(normalizedPreferred)) {
    return normalizedPreferred;
  }
  let index = 1;
  let assetPath = "";
  do {
    assetPath = `assets/image-${String(index).padStart(4, "0")}${extension}`;
    index += 1;
  } while (zip.file(assetPath));
  return assetPath;
}

function normalizeDocumentId(value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function normalizeDocumentFootnotes(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 5000).flatMap((footnote) => {
    const text = typeof footnote?.text === "string" ? footnote.text.trim().slice(0, 20000) : "";
    if (!text) return [];
    const id = normalizeDocumentId(footnote?.id) || randomUUID();
    if (seen.has(id)) return [];
    seen.add(id);
    const createdAt = typeof footnote?.createdAt === "string" && Number.isFinite(Date.parse(footnote.createdAt))
      ? footnote.createdAt
      : new Date().toISOString();
    return [{
      id,
      text,
      createdAt,
      updatedAt: typeof footnote?.updatedAt === "string" && Number.isFinite(Date.parse(footnote.updatedAt)) ? footnote.updatedAt : createdAt,
    }];
  });
}

function normalizeCitationSources(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 5000).flatMap((source) => {
    if (!source || typeof source !== "object") return [];
    const title = typeof source.title === "string" ? source.title.trim().slice(0, 1000) : "";
    const url = typeof source.url === "string" && /^https?:\/\//i.test(source.url.trim()) ? source.url.trim().slice(0, 2048) : "";
    const doi = typeof source.doi === "string" ? source.doi.trim().slice(0, 300) : "";
    if (!title && !url && !doi) return [];
    const id = normalizeDocumentId(source.id) || randomUUID();
    if (seen.has(id)) return [];
    seen.add(id);
    const authors = (Array.isArray(source.authors) ? source.authors : (typeof source.author === "string" ? source.author.split(/[;,；，]/) : []))
      .slice(0, 100).map((author) => String(author || "").trim().slice(0, 200)).filter(Boolean);
    return [{
      id,
      type: ["book", "article", "web", "pdf", "report", "thesis", "other"].includes(source.type) ? source.type : "other",
      title,
      authors,
      year: String(source.year ?? "").trim().slice(0, 32),
      containerTitle: typeof source.containerTitle === "string" ? source.containerTitle.trim().slice(0, 1000) : "",
      publisher: typeof source.publisher === "string" ? source.publisher.trim().slice(0, 500) : "",
      url,
      doi,
      isbn: typeof source.isbn === "string" ? source.isbn.trim().slice(0, 64) : "",
      accessedAt: typeof source.accessedAt === "string" ? source.accessedAt.slice(0, 64) : "",
      pages: typeof source.pages === "string" ? source.pages.trim().slice(0, 128) : "",
      notes: typeof source.notes === "string" ? source.notes.trim().slice(0, 10000) : "",
      ...normalizeCitationResearchIdentity(source),
    }];
  });
}

function normalizeDocument(document = {}) {
  const now = new Date().toISOString();
  const sourceVersion = Number.isInteger(Number(document.version)) && Number(document.version) > 0 ? Number(document.version) : 1;
  const futureSchema = sourceVersion > DOCUMENT_SCHEMA_VERSION;
  const usesV2 = sourceVersion >= DOCUMENT_SCHEMA_VERSION
    || Boolean(document.documentId)
    || Array.isArray(document.footnotes)
    || Array.isArray(document.citationSources);
  const createdAt = typeof document.createdAt === "string" && document.createdAt
    ? document.createdAt
    : (typeof document.updatedAt === "string" && document.updatedAt ? document.updatedAt : now);
  return {
    ...(sourceVersion >= DOCUMENT_SCHEMA_VERSION ? document : {}),
    version: futureSchema ? sourceVersion : (usesV2 ? DOCUMENT_SCHEMA_VERSION : 1),
    ...(usesV2 || futureSchema ? {
      documentId: normalizeDocumentId(document.documentId) || randomUUID(),
      derivedFrom: normalizeDocumentId(document.derivedFrom),
      footnotes: normalizeDocumentFootnotes(document.footnotes),
      citationSources: normalizeCitationSources(document.citationSources),
    } : {}),
    title: typeof document.title === "string" && document.title.trim() ? document.title.trim().slice(0, 200) : "未命名信笺",
    author: typeof document.author === "string" ? document.author.trim().slice(0, 40) : "",
    html: typeof document.html === "string" && document.html.trim() ? document.html : "<p></p>",
    letterTemplateId: typeof document.letterTemplateId === "string" && document.letterTemplateId
      ? document.letterTemplateId.slice(0, 128)
      : "",
    templateId: typeof document.templateId === "string" && document.templateId ? document.templateId.slice(0, 128) : "warm",
    fontFamily: typeof document.fontFamily === "string" && document.fontFamily ? document.fontFamily.slice(0, 128) : "LXGW WenKai Screen",
    fontSize: Number.isFinite(Number(document.fontSize)) ? Math.min(32, Math.max(12, Number(document.fontSize))) : 18,
    layoutMode: "flow",
    customBackground: typeof document.customBackground === "string" && document.customBackground ? document.customBackground : "",
    createdAt,
    displayDate: typeof document.displayDate === "string" && document.displayDate.trim()
      ? document.displayDate.trim().slice(0, 40)
      : formatPaperDate(createdAt),
    updatedAt: typeof document.updatedAt === "string" && document.updatedAt ? document.updatedAt : now,
    comments: normalizeDocumentComments(document.comments),
    aiState: normalizeSavedAiState(document.aiState),
    ...(futureSchema ? { _readOnlyFutureSchema: true } : {}),
  };
}

function normalizeDocumentComments(comments = []) {
  if (!Array.isArray(comments)) {
    return [];
  }
  const seen = new Set();
  return comments
    .slice(0, 5000)
    .map((comment, index) => {
      const from = Math.max(1, Math.floor(Number(comment?.from) || 0));
      const to = Math.max(1, Math.floor(Number(comment?.to) || 0));
      const text = typeof comment?.text === "string" ? comment.text.trim().slice(0, 2000) : "";
      if (!text || from === to) {
        return null;
      }
      const fallbackId = `comment-${Date.now().toString(36)}-${index}`;
      const idSource = typeof comment?.id === "string" && comment.id.trim() ? comment.id.trim().slice(0, 128) : fallbackId;
      const id = seen.has(idSource) ? `${idSource}-${index}` : idSource;
      seen.add(id);
      const createdAt = typeof comment?.createdAt === "string" && comment.createdAt ? comment.createdAt : new Date().toISOString();
      const updatedAt = typeof comment?.updatedAt === "string" && comment.updatedAt ? comment.updatedAt : createdAt;
      return {
        id,
        from: Math.min(from, to),
        to: Math.max(from, to),
        text,
        quote: typeof comment?.quote === "string" ? comment.quote.trim().slice(0, 280) : "",
        createdAt,
        updatedAt,
      };
    })
    .filter(Boolean);
}

function mimeFromPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    case ".avif":
      return "image/avif";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    case ".webm":
      return "video/webm";
    case ".ogv":
      return "video/ogg";
    case ".mp4":
      return "video/mp4";
    default:
      return "image/png";
  }
}

function linkAssetImages(filePath, html, metrics = null) {
  const matches = [...html.matchAll(ASSET_URL_PATTERN)];
  const linked = html.replace(ASSET_URL_PATTERN, (full, quote, assetPath) => {
    const normalizedAssetPath = normalizeAssetPath(assetPath);
    return normalizedAssetPath ? `src=${quote}${documentAssetRegistry.urlFor(filePath, normalizedAssetPath)}${quote}` : full;
  });
  if (metrics) {
    metrics.assetReferences = matches.length;
    metrics.linkedAssets = new Set(matches.map((match) => normalizeAssetPath(match[2])).filter(Boolean)).size;
  }
  return linked;
}

async function packageAiStateAssets(aiState, packager) {
  const normalized = normalizeSavedAiState(aiState);
  const images = normalized.optimize?.assets?.images || {};
  const nextImages = Object.create(null);
  for (const [key, image] of Object.entries(images)) {
    const nextImage = { ...image };
    if (typeof nextImage.src === "string" && nextImage.src) {
      try {
        if (/^data:/i.test(nextImage.src) && !/^data:image\//i.test(nextImage.src)) {
          throw new Error("AI 图片不是受支持的图片数据");
        }
        nextImage.src = await packager.packageSource(nextImage.src);
      } catch (error) {
        throw new Error(`AI 图片资源 ${key} 无法读取，文档未保存：${error?.message || "资源失效"}`, { cause: error });
      }
    }
    nextImages[key] = nextImage;
  }
  return {
    ...normalized,
    optimize: {
      ...normalized.optimize,
      assets: {
        ...normalized.optimize.assets,
        images: nextImages,
      },
    },
  };
}

function linkAiStateAssets(filePath, aiState) {
  const normalized = normalizeSavedAiState(aiState);
  const images = normalized.optimize?.assets?.images || {};
  const nextImages = Object.create(null);
  Object.entries(images).forEach(([key, image]) => {
    const nextImage = { ...image };
    if (typeof nextImage.src === "string" && normalizeAssetPath(nextImage.src)) {
      nextImage.src = documentAssetRegistry.urlFor(filePath, nextImage.src);
    }
    nextImages[key] = nextImage;
  });
  return {
    ...normalized,
    optimize: {
      ...normalized.optimize,
      assets: {
        ...normalized.optimize.assets,
        images: nextImages,
      },
    },
  };
}

function linkPaperDocument(filePath, sourceDocument, metrics = null) {
  const sourcePath = path.resolve(String(filePath || ""));
  documentAssetRegistry.register(sourcePath);
  const document = normalizeDocument(sourceDocument);
  const assetLinkStartedAt = Date.now();
  document.html = linkAssetImages(sourcePath, document.html, metrics);
  if (metrics) {
    metrics.assetLinkMs = Date.now() - assetLinkStartedAt;
    metrics.htmlBytes = Buffer.byteLength(document.html, "utf8");
  }
  if (document.customBackground && !document.customBackground.startsWith("data:")) {
    const backgroundPath = normalizeAssetPath(document.customBackground);
    if (backgroundPath) document.customBackground = documentAssetRegistry.urlFor(sourcePath, backgroundPath);
  }
  document.aiState = linkAiStateAssets(sourcePath, document.aiState);
  return document;
}

async function savePaperDocumentWithinMutation(filePath, document, { validateTarget, afterCommit } = {}) {
  const targetPath = path.resolve(String(filePath || ""));
  if (!targetPath || !isSupportedDocument(targetPath)) throw new Error("无效的信笺保存路径");
  if (Number(document?.version || 1) > DOCUMENT_SCHEMA_VERSION || document?._readOnlyFutureSchema) {
    throw new Error(`此信笺使用未来格式 v${Number(document?.version) || "?"}，当前版本只能只读打开`);
  }
  return documentWriteQueue.run(targetPath, async () => {
    if (typeof validateTarget === "function") await validateTarget(targetPath);
    const normalized = normalizeDocument(document);
    const zip = new JSZip();
    const packagedDocument = { ...normalized };
    const packager = createAssetPackager({ zip, readProtocolAsset, nextAssetPath: nextZipAssetPath });

    packagedDocument.html = await packager.packageHtml(packagedDocument.html);
    if (packagedDocument.customBackground) {
      if (/^data:/i.test(packagedDocument.customBackground) && !/^data:image\//i.test(packagedDocument.customBackground)) {
        throw new Error("自定义背景不是受支持的图片数据，文档未保存");
      }
      packagedDocument.customBackground = await packager.packageSource(packagedDocument.customBackground);
    }
    packagedDocument.aiState = await packageAiStateAssets(packagedDocument.aiState, packager);

    const serializedDocument = JSON.stringify(packagedDocument, null, 2);
    if (Buffer.byteLength(serializedDocument, "utf8") > DEFAULT_ARCHIVE_LIMITS.maxDocumentJsonBytes) {
      throw new Error("信笺正文与元数据超过安全写入上限，文档未保存");
    }
    // STORE keeps documents written by this app inside the same compression-ratio
    // policy enforced by the loader, even for highly repetitive long-form text.
    zip.file("document.json", serializedDocument, { compression: "STORE" });
    const output = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    if (output.length > DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes) {
      throw new Error("信笺文件超过安全写入上限，文档未保存");
    }
    preflightZipBuffer(output);
    // Re-check immediately before the atomic replacement. Packaging images and
    // generating the archive can take long enough for a sync client to update
    // the target after the first validation.
    if (typeof validateTarget === "function") await validateTarget(targetPath);
    await atomicWriteFile(targetPath, output);
    const committedRevision = await readDiskRevision(targetPath);
    const outputSha256 = createHash("sha256").update(output).digest("hex");
    if (
      !committedRevision
      || committedRevision.size !== output.length
      || committedRevision.sha256 !== outputSha256
    ) {
      throw new DocumentRevisionConflictError("工作区文件在写入完成后立即被外部版本替换", {
        filePath: targetPath,
        expectedRevision: {
          size: output.length,
          mtimeMs: committedRevision?.mtimeMs || Date.now(),
          sha256: outputSha256,
        },
        actualRevision: committedRevision,
      });
    }
    invalidateDocumentCachesForPath(targetPath);
    documentAssetRegistry.register(targetPath);
    for (const [sourceUrl, assetPath] of packager.bySource) {
      if (String(sourceUrl).startsWith(`${ASSET_PROTOCOL}://`)) {
        assetSourceAliases.delete(sourceUrl);
        assetSourceAliases.set(sourceUrl, { filePath: targetPath, assetPath });
        while (assetSourceAliases.size > ASSET_SOURCE_ALIAS_LIMIT) {
          assetSourceAliases.delete(assetSourceAliases.keys().next().value);
        }
      }
    }
    const result = {
      path: targetPath,
      document: linkPaperDocument(targetPath, packagedDocument),
      diskRevision: committedRevision,
    };
    if (typeof afterCommit === "function") await afterCommit(result);
    return result;
  });
}

async function savePaperDocument(filePath, document, options = {}) {
  return runDocumentMutation(() => savePaperDocumentWithinMutation(filePath, document, options));
}

async function loadPaperDocumentSnapshot(filePath, metrics = null) {
  const startedAt = Date.now();
  const sourcePath = path.resolve(String(filePath || ""));
  const snapshot = await readFileSnapshot(sourcePath, { maxBytes: DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes });
  if (!snapshot) throw new Error("信笺文件不存在或已被移动");
  const { buffer, revision: diskRevision, stat: sourceStat } = snapshot;
  if (metrics) {
    metrics.readMs = Date.now() - startedAt;
    metrics.fileBytes = buffer.byteLength;
  }
  const zipStartedAt = Date.now();
  preflightZipBuffer(buffer);
  const zip = await JSZip.loadAsync(buffer);
  validatePaperArchive(zip, { archiveBytes: buffer.length });
  rememberAssetZip(sourcePath, sourceStat, zip);
  if (metrics) {
    metrics.zipLoadMs = Date.now() - zipStartedAt;
  }
  const documentFile = zip.file("document.json");
  assertZipEntryReadable(documentFile, {
    maxBytes: DEFAULT_ARCHIVE_LIMITS.maxDocumentJsonBytes,
    maxRatio: DEFAULT_ARCHIVE_LIMITS.maxDocumentJsonRatio,
  });

  const jsonStartedAt = Date.now();
  const raw = (await readZipEntryBufferLimited(documentFile, {
    maxBytes: DEFAULT_ARCHIVE_LIMITS.maxDocumentJsonBytes,
    maxRatio: DEFAULT_ARCHIVE_LIMITS.maxDocumentJsonRatio,
  })).toString("utf8");
  const parsedDocument = JSON.parse(raw);
  if (metrics) {
    metrics.jsonMs = Date.now() - jsonStartedAt;
    metrics.documentJsonBytes = Buffer.byteLength(raw, "utf8");
  }
  if (!parsedDocument.createdAt) {
    parsedDocument.createdAt = sourceStat.birthtime?.toISOString?.() || sourceStat.ctime?.toISOString?.() || parsedDocument.updatedAt;
  }
  const document = linkPaperDocument(sourcePath, parsedDocument, metrics);

  if (metrics) {
    metrics.totalMs = Date.now() - startedAt;
  }
  return { document, diskRevision, rawDocument: parsedDocument };
}

async function loadPaperDocument(filePath, metrics = null) {
  return (await loadPaperDocumentSnapshot(filePath, metrics)).document;
}

ipcMain.handle("app:get-paths", async () => {
  await fs.mkdir(defaultDocumentsDir(), { recursive: true });
  return {
    documents: defaultDocumentsDir(),
  };
});

ipcMain.handle("debug:log", async (_event, event, data) => {
  await writeAiDebugLog(String(event || "renderer"), data || {});
  return { ok: true };
});

ipcMain.handle("window:set-modal-overlay", async () => {
  try {
    if (typeof mainWindow?.setTitleBarOverlay === "function") {
      mainWindow.setTitleBarOverlay(TITLE_BAR_OVERLAY_DEFAULT);
    }
    return { ok: true };
  } catch (error) {
    await writeAiDebugLog("window:set-modal-overlay:error", { message: error?.message });
    return { ok: false, message: error?.message };
  }
});

ipcMain.handle("research:web-view-show", async (_event, payload = {}) => (
  researchWebViews?.show(payload) || { ok: false, unsupported: true }
));

ipcMain.handle("research:web-view-bounds", async (_event, payload = {}) => (
  researchWebViews?.updateBounds(payload) || { ok: false, unsupported: true }
));

ipcMain.handle("research:web-view-hide", async (_event, viewId = "") => (
  researchWebViews?.hide(viewId) || { ok: true }
));

ipcMain.handle("research:web-view-control", async (_event, payload = {}) => (
  researchWebViews?.control(payload) || { ok: false, unsupported: true }
));

ipcMain.handle("research:web-view-destroy", async (_event, viewId = "") => (
  researchWebViews?.destroy(viewId) || { ok: true }
));

ipcMain.handle("ai:get-config", async () => publicAiConfigWithRuntime(await readAiConfig()));

ipcMain.handle("ai:refresh-codex", async () => {
  const config = await refreshCodexCliConfig();
  await writeAiDebugLog("ai:codex:refreshed", {
    installed: codexRuntimeStatus.installed,
    authenticated: codexRuntimeStatus.authenticated,
    ready: codexRuntimeStatus.ready,
    version: codexRuntimeStatus.version,
  });
  return { ...config, ok: codexRuntimeStatus.ready, message: codexRuntimeStatus.message };
});

ipcMain.handle("ai:start-codex-login", async () => {
  if (!codexRuntimeStatus.executablePath) {
    await refreshCodexCliConfig();
  }
  if (!codexRuntimeStatus.executablePath) {
    return { ...publicAiConfigWithRuntime(await readAiConfig()), ok: false, message: "未检测到 Codex CLI" };
  }
  startCodexLogin(codexRuntimeStatus.executablePath, () => {
    refreshCodexCliConfig().then((config) => {
      sendRendererEvent(mainWindow?.webContents, "ai:codex-status", config);
    }).catch(() => {});
  });
  return { ...publicAiConfigWithRuntime(await readAiConfig()), ok: true, message: "已启动 Codex 登录" };
});

ipcMain.handle("ai:create-provider", async (_event, input) => {
  const result = await createAiProvider(input || {});
  await writeAiDebugLog("ai:provider:created", { provider: result.provider, protocol: input?.protocol });
  return { ...publicAiConfigWithRuntime(result.config), createdProvider: result.provider, ok: true };
});

ipcMain.handle("ai:delete-provider", async (_event, provider) => {
  const config = await deleteAiProvider(String(provider || ""));
  await writeAiDebugLog("ai:provider:deleted", { provider });
  return { ...publicAiConfigWithRuntime(config), ok: true };
});

ipcMain.handle("ai:save-config", async (_event, patch) => {
  const config = await saveAiConfig(patch || {});
  await writeAiDebugLog("ai:config:saved", {
    provider: patch?.provider || config.activeProvider,
    model: patch?.model || "",
    hasApiKey: Boolean(patch?.apiKey),
  });
  return publicAiConfigWithRuntime(config);
});

ipcMain.handle("ai:test-config", async (_event, patch) => {
  const initial = await readAiConfig();
  const provider = resolveAiProvider(initial, patch?.provider);
  const initialProviderConfig = initial.providers[provider];
  const modelId = String(patch?.modelId || initialProviderConfig.activeModelId || createAiModelId(provider, patch?.model || initialProviderConfig.model)).slice(0, 256).trim();
  const initialModelConfig = initialProviderConfig.models.find((model) => model.id === modelId) || initialProviderConfig.models[0];
  const expectedIdentity = storedAiTestConfigIdentity(initial, provider, modelId);
  let persistedFailureBaseUrl = initialProviderConfig.baseUrl;
  let persistedFailureApiKey = initialProviderConfig.apiKey;
  try {
    const baseUrl = normalizeProviderBaseUrl(patch?.baseUrl || initialProviderConfig.baseUrl);
    const explicitApiKey = typeof patch?.apiKey === "string" && Boolean(patch.apiKey.slice(0, 16384).trim());
    if (!apiKeyCanBeReused(initialProviderConfig.baseUrl, baseUrl) && !explicitApiKey) {
      throw new Error("Base URL 的服务来源已改变，请重新输入 API Key 后再测试");
    }
    const apiKey = explicitApiKey ? patch.apiKey.slice(0, 16384).trim() : initialProviderConfig.apiKey;
    persistedFailureBaseUrl = baseUrl;
    persistedFailureApiKey = apiKey;
    const config = {
      provider,
      providerLabel: initialProviderConfig.providerLabel,
      protocol: initialProviderConfig.protocol,
      builtin: initialProviderConfig.builtin,
      modelId,
      modelName: String(patch?.modelName || initialModelConfig?.name || "").slice(0, 256),
      model: String(patch?.model || initialModelConfig?.model || initialProviderConfig.model || "").slice(0, 256),
      requestParams: initialModelConfig?.requestParams || {},
      baseUrl,
      apiKey,
    };
    await testAiConfig(config);
    const commitResult = await updateAiProviderTestState(provider, modelId, {
      modelName: config.modelName,
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      testedOk: true,
      testedAt: new Date().toISOString(),
      testMessage: "AI 连接可用",
    }, expectedIdentity);
    if (commitResult.stale) {
      await writeAiDebugLog("ai:test:stale", { provider: config.provider, model: config.model });
      return { ...publicAiConfigWithRuntime(commitResult.config), ok: false, stale: true, message: "AI 配置已变化，请重新测试" };
    }
    const next = commitResult.config;
    await writeAiDebugLog("ai:test:success", { provider: config.provider, model: config.model });
    return { ...publicAiConfigWithRuntime(next), ok: true, message: "AI 连接可用" };
  } catch (error) {
    const commitResult = await updateAiProviderTestState(provider, modelId, {
      modelName: patch?.modelName || initialModelConfig?.name,
      model: patch?.model || initialModelConfig?.model || initialProviderConfig.model,
      baseUrl: persistedFailureBaseUrl,
      apiKey: persistedFailureApiKey,
      testedOk: false,
      testedAt: new Date().toISOString(),
      testMessage: error?.message || "AI 连接失败",
    }, expectedIdentity);
    if (commitResult.stale) {
      await writeAiDebugLog("ai:test:stale", { provider, model: patch?.model, message: error?.message });
      return { ...publicAiConfigWithRuntime(commitResult.config), ok: false, stale: true, message: "AI 配置已变化，请重新测试" };
    }
    const next = commitResult.config;
    await writeAiDebugLog("ai:test:error", {
      provider: patch?.provider,
      model: patch?.model,
      baseUrl: patch?.baseUrl,
      message: error?.message,
      causeCode: error?.cause?.code,
      causeMessage: error?.cause?.message,
    });
    return { ...publicAiConfigWithRuntime(next), ok: false, message: error?.message || "AI 连接失败" };
  }
});

ipcMain.handle("ai:generate", async (event, payload) => {
  const requestId = String(payload?.requestId || "");
  const messages = normalizeAiMessages(payload || {});
  if (!/^ai-[a-z0-9-]{6,100}$/i.test(requestId) || !messages.some((message) => message.content.trim())) {
    return { ok: false, message: "AI 请求缺少内容" };
  }
  if (activeAiRequests.has(requestId)) return { ok: false, message: "AI 请求标识重复" };
  if (activeAiRequests.size >= AI_CONCURRENT_REQUEST_LIMIT) return { ok: false, message: "同时运行的 AI 请求过多，请等待当前生成完成" };
  const config = activeAiProviderConfig(await readAiConfig(), payload?.provider, payload?.modelId);
  if (config.transport === "codex-cli") {
    if (!codexRuntimeStatus.ready || !codexRuntimeStatus.executablePath || !config.model) {
      return { ok: false, message: codexRuntimeStatus.message || "请先在 AI 设置中配置 Codex CLI" };
    }
  } else if (!config.apiKey || !config.testedOk) {
    return { ok: false, message: "请选择已测试可用的 AI 模型" };
  }
  const controller = new AbortController();
  activeAiRequests.set(requestId, controller);
  const completion = config.transport === "codex-cli"
    ? streamCodexForPayload(event, requestId, config, messages, payload, controller)
    : streamAiCompletion(event.sender, requestId, config, messages, controller.signal);
  completion
    .then((usage) => {
      sendRendererEvent(event.sender, "ai:done", { requestId, usage });
      activeAiRequests.delete(requestId);
    })
    .catch(async (error) => {
      const aborted = controller.signal.aborted;
      await writeAiDebugLog("ai:generate:error", { requestId, aborted, message: error?.message });
      sendRendererEvent(event.sender, "ai:error", {
        requestId,
        message: aborted ? "已停止生成" : (error?.message || "AI 生成失败"),
        aborted,
      });
      activeAiRequests.delete(requestId);
    });
  return { ok: true, requestId };
});

ipcMain.handle("ai:resolve-apply", async (_event, payload = {}) => {
  const config = await readAiConfig();
  const taskModel = config.taskModels?.applyResolver || {};
  const hasExplicitTaskModel = Boolean(taskModel.providerId || taskModel.modelId);
  const selectedResolver = taskAiProviderConfig(config, taskModel);
  const resolver = selectedResolver ? {
    ...selectedResolver,
    requestParams: selectedResolver.transport === "codex-cli"
      ? {}
      : aiApplyResolverRequestParams(
        selectedResolver.provider,
        selectedResolver.protocol,
        mergeAiRequestParams(selectedResolver.requestParams, hasExplicitTaskModel ? taskModel.requestParams : {}),
      ),
  } : null;
  if (!resolver) {
    throw new Error(hasExplicitTaskModel
      ? "应用裁决模型已失效，请在“AI 配置 → 任务模型”中重新选择"
      : "请先在“AI 配置”中配置并测试至少一个可用的默认模型");
  }
  if ((!resolver.apiKey || !resolver.testedOk) && resolver.transport !== "codex-cli") {
    throw new Error(hasExplicitTaskModel
      ? "应用裁决模型已失效，请在“AI 配置 → 任务模型”中重新选择"
      : "默认模型不可用，请在“AI 配置”中重新配置并测试");
  }
  if (resolver.transport === "codex-cli" && !codexRuntimeStatus.ready) {
    throw new Error(hasExplicitTaskModel
      ? "应用裁决所选 Codex CLI 当前不可用，请在“AI 配置 → 任务模型”中重新选择"
      : "默认 Codex CLI 当前不可用，请在“AI 配置”中重新检查");
  }
  const messages = aiApplyResolverMessages(
    payload.manifest,
    payload.selectedBlock,
    payload.optimizationContext,
    payload.repair,
  );
  const raw = await resolveAiApplyWithModel(resolver, messages);
  return {
    ok: true,
    raw,
    model: {
      providerId: resolver.provider,
      providerLabel: resolver.providerLabel,
      modelId: resolver.modelId,
      modelName: resolver.modelName,
    },
  };
});

ipcMain.handle("ai:cancel", async (_event, requestId) => {
  const id = String(requestId || "");
  const controller = activeAiRequests.get(id);
  if (controller) {
    controller.abort();
    activeAiRequests.delete(id);
  }
  return { ok: true };
});

ipcMain.handle("ai:export-chat", async (_event, payload) => {
  const title = sanitizeName(payload?.title || "AI问答");
  const stamp = timestampForFileName();
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "另存 AI 问答记录",
    defaultPath: path.join(defaultDocumentsDir(), `${title}-AI问答-${stamp}.md`),
    filters: [
      { name: "Markdown", extensions: ["md"] },
      { name: "Text", extensions: ["txt"] },
    ],
  });
  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }
  const markdown = String(payload?.markdown || "");
  if (Buffer.byteLength(markdown, "utf8") > 16 * 1024 * 1024) throw new Error("AI 问答记录过大，已拒绝导出");
  await atomicWriteFile(result.filePath, markdown);
  return { canceled: false, path: result.filePath };
});

ipcMain.handle("update:get-state", async () => updateState);

ipcMain.handle("update:check", async () => {
  if (!app.isPackaged) {
    return emitUpdateState({
      status: "dev",
      message: "开发版不能检查更新，打包安装后可用",
    });
  }
  try {
    await autoUpdater.checkForUpdates();
    return updateState;
  } catch (error) {
    return emitUpdateState({
      status: "error",
      message: `更新失败：${error.message}`,
    });
  }
});

ipcMain.handle("update:download", async () => {
  if (!app.isPackaged) {
    return emitUpdateState({
      status: "dev",
      message: "开发版不能下载更新，打包安装后可用",
    });
  }
  try {
    await autoUpdater.downloadUpdate();
    return updateState;
  } catch (error) {
    return emitUpdateState({
      status: "error",
      message: `下载失败：${error.message}`,
    });
  }
});

ipcMain.handle("update:install", async () => {
  if (updateState.status !== "downloaded") {
    return updateState;
  }
  pendingUpdateInstall = true;
  if (!closeRequestInFlight && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
  return { ...updateState, installPending: true };
});

function workspaceSearchCachePath(rootPath) {
  const key = createHash("sha256").update(path.resolve(rootPath)).digest("hex");
  return path.join(app.getPath("userData"), WORKSPACE_SEARCH_CACHE_FOLDER, `${key}.json`);
}

async function getWorkspaceSearchIndex(folderPath, { refresh = false } = {}) {
  const rootPath = await assertAuthorizedDirectory(folderPath);
  const key = process.platform === "win32" ? rootPath.toLocaleLowerCase("en-US") : rootPath;
  let index = workspaceSearchIndexes.get(key);
  if (!index) {
    index = createWorkspaceSearchIndex({ rootPath, cachePath: workspaceSearchCachePath(rootPath) });
    workspaceSearchIndexes.set(key, index);
    await index.initialize();
  } else if (refresh) {
    await index.refresh();
  }
  return { index, rootPath };
}

function stopWorkspaceWatcher() {
  if (activeWorkspaceWatchTimer) {
    clearTimeout(activeWorkspaceWatchTimer);
    activeWorkspaceWatchTimer = null;
  }
  activeWorkspaceWatcher?.close?.();
  activeWorkspaceWatcher = null;
  activeWorkspaceWatchRoot = "";
}

async function startWorkspaceWatcher(folderPath) {
  const rootPath = await assertAuthorizedDirectory(folderPath);
  if (activeWorkspaceWatcher && activeWorkspaceWatchRoot === rootPath) return rootPath;
  stopWorkspaceWatcher();
  // This is also the main-process identity of the currently open writing
  // workspace. Keep it even when the host cannot provide recursive watching.
  activeWorkspaceWatchRoot = rootPath;
  try {
    activeWorkspaceWatcher = nativeFs.watch(rootPath, { recursive: true, encoding: "utf8" }, (eventType, fileName) => {
      if (activeWorkspaceWatchTimer) clearTimeout(activeWorkspaceWatchTimer);
      activeWorkspaceWatchTimer = setTimeout(async () => {
        activeWorkspaceWatchTimer = null;
        try {
          const { index } = await getWorkspaceSearchIndex(rootPath);
          await index.refresh();
        } catch (error) {
          await writeAiDebugLog("workspace:watch:refresh-error", { rootPath, message: error?.message });
        }
        sendRendererEvent(mainWindow?.webContents, "workspace:changed", {
          rootPath,
          eventType: String(eventType || "change"),
          relativePath: typeof fileName === "string" ? fileName.slice(0, 32768) : "",
          changedAt: new Date().toISOString(),
        });
      }, 180);
      activeWorkspaceWatchTimer.unref?.();
    });
    activeWorkspaceWatcher.on?.("error", (error) => {
      void writeAiDebugLog("workspace:watch:error", { rootPath, message: error?.message });
      sendRendererEvent(mainWindow?.webContents, "workspace:watch-error", { rootPath, message: error?.message || "文件监听失败" });
    });
  } catch (error) {
    await writeAiDebugLog("workspace:watch:unavailable", { rootPath, message: error?.message });
    return rootPath;
  }
  return rootPath;
}

ipcMain.handle("folder:search", async (_event, payload = {}) => {
  const folderPath = String(payload.folderPath || "");
  if (!folderPath) return { requestId: payload.requestId || "", query: "", canceled: false, results: [], totalMatches: 0 };
  const { index } = await getWorkspaceSearchIndex(folderPath, { refresh: Boolean(payload.refresh) });
  const results = await index.search(payload.query, {
    requestId: String(payload.requestId || randomUUID()).slice(0, 128),
    limit: Math.min(200, Math.max(1, Number(payload.limit) || 100)),
    overrides: Array.isArray(payload.overrides) ? payload.overrides.slice(0, 100) : [],
  });
  return results;
});

ipcMain.handle("folder:search-cancel", async (_event, folderPath, requestId) => {
  if (!folderPath || !requestId) return { ok: false };
  const rootPath = await assertAuthorizedDirectory(folderPath);
  const key = process.platform === "win32" ? rootPath.toLocaleLowerCase("en-US") : rootPath;
  return { ok: Boolean(workspaceSearchIndexes.get(key)?.cancel(String(requestId))) };
});

ipcMain.handle("workspace:relationships", async (_event, payload = {}) => {
  const rootPath = await assertAuthorizedDirectory(payload.folderPath);
  const walked = await walkWorkspaceDocuments(rootPath);
  const overrideByPath = new Map((Array.isArray(payload.overrides) ? payload.overrides : []).slice(0, 100)
    .filter((item) => item?.path && item?.document && isPathInside(rootPath, item.path))
    .map((item) => [process.platform === "win32" ? path.resolve(item.path).toLocaleLowerCase("en-US") : path.resolve(item.path), item.document]));
  const records = (await mapWithConcurrency(walked.documents, 8, async (filePath) => {
    try {
      const key = process.platform === "win32" ? path.resolve(filePath).toLocaleLowerCase("en-US") : path.resolve(filePath);
      const document = overrideByPath.get(key) || await readSearchDocument(filePath);
      const documentId = normalizeDocumentId(document.documentId);
      const links = [...String(document.html || "").matchAll(/data-document-id=["']([0-9a-f-]{36})["']/gi)]
        .map((match) => normalizeDocumentId(match[1])).filter(Boolean);
      return {
        documentId,
        needsIdentity: !documentId,
        title: typeof document.title === "string" ? document.title.slice(0, 200) : path.basename(filePath, path.extname(filePath)),
        path: filePath,
        relativePath: path.relative(rootPath, filePath),
        links: [...new Set(links)],
      };
    } catch {
      return null;
    }
  })).filter(Boolean);
  const byId = new Map();
  records.forEach((record) => {
    if (!record.documentId) return;
    const group = byId.get(record.documentId) || [];
    group.push(record);
    byId.set(record.documentId, group);
  });
  const currentId = normalizeDocumentId(payload.documentId);
  const currentLinks = (Array.isArray(payload.currentLinks) ? payload.currentLinks : []).slice(0, 5000)
    .map((link) => ({
      ...link,
      targetDocumentId: normalizeDocumentId(link?.targetDocumentId || link?.documentId),
    })).filter((link) => link.targetDocumentId);
  const resolvedLinks = currentLinks.map((link) => {
    const target = byId.get(link.targetDocumentId)?.[0];
    return {
      ...link,
      documentId: link.targetDocumentId,
      targetDocumentId: link.targetDocumentId,
      title: target?.title || link.title || "未知笺记",
      path: target?.path || "",
      relativePath: target?.relativePath || "",
      missing: !target,
    };
  });
  return {
    rootPath,
    documents: records.filter((record) => isWorkspaceRelationshipCandidate(record, {
      currentDocumentId: currentId,
      currentPath: payload.currentPath,
    })).map(({ links: _links, ...record }) => record),
    links: resolvedLinks,
    backlinks: currentId ? records.filter((record) => record.documentId !== currentId && record.links.includes(currentId)).map(({ links: _links, ...record }) => record) : [],
    duplicates: [...byId.values()].filter((group) => group.length > 1).flatMap((group) => group.slice(1).map(({ links: _links, ...record }) => record)),
  };
});

ipcMain.handle("workspace:watch", async (_event, folderPath) => {
  if (!folderPath) {
    stopWorkspaceWatcher();
    return { ok: true, rootPath: "" };
  }
  return { ok: true, rootPath: await startWorkspaceWatcher(folderPath) };
});

ipcMain.handle("document:revision", async (_event, filePath) => {
  const authorizedPath = await assertAuthorizedDocument(filePath);
  return { path: authorizedPath, diskRevision: await readDiskRevision(authorizedPath) };
});

ipcMain.handle("document:regenerate-identity", async (_event, filePath, force = false) => {
  const targetPath = await resolveAuthorizedOpenDocument(filePath);
  const sourceSnapshot = await loadPaperDocumentSnapshot(targetPath);
  const expectedRevision = sourceSnapshot.diskRevision;
  const sourceDocument = sourceSnapshot.document;
  if (Number(sourceSnapshot.rawDocument?.version || 1) > DOCUMENT_SCHEMA_VERSION || sourceDocument._readOnlyFutureSchema) {
    throw new Error(`此信笺使用未来格式 v${Number(sourceSnapshot.rawDocument?.version) || "?"}，当前版本只能只读打开`);
  }
  const previousId = normalizeDocumentId(sourceDocument.documentId);
  if (previousId && !force) {
    return { canceled: false, path: targetPath, documentId: previousId, diskRevision: expectedRevision, changed: false };
  }
  const migrationBackupPath = Number(sourceDocument.version || 1) < DOCUMENT_SCHEMA_VERSION
    ? await preservePreV2MigrationBackup(targetPath)
    : "";
  const documentId = randomUUID();
  const nextDocument = {
    ...sourceDocument,
    version: DOCUMENT_SCHEMA_VERSION,
    documentId,
    derivedFrom: previousId || "",
    footnotes: Array.isArray(sourceDocument.footnotes) ? sourceDocument.footnotes : [],
    citationSources: Array.isArray(sourceDocument.citationSources) ? sourceDocument.citationSources : [],
  };
  const saved = await savePaperDocument(targetPath, nextDocument, {
    validateTarget: (candidate) => assertDiskRevision(candidate, expectedRevision),
  });
  return {
    canceled: false,
    changed: true,
    path: targetPath,
    documentId,
    document: saved.document,
    diskRevision: saved.diskRevision,
    ...(migrationBackupPath ? { migrationBackupPath } : {}),
  };
});

ipcMain.handle("window:set-fullscreen", async (_event, fullscreen) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { fullscreen: false };
  mainWindow.setFullScreen(Boolean(fullscreen));
  return { fullscreen: mainWindow.isFullScreen() };
});

ipcMain.handle("window:get-fullscreen", async () => ({ fullscreen: Boolean(mainWindow?.isFullScreen?.()) }));

ipcMain.handle("document:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "打开信笺",
    defaultPath: defaultDocumentsDir(),
    properties: ["openFile"],
    filters: DOCUMENT_FILTERS,
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  const filePath = await canonicalExistingPath(result.filePaths[0], "file");
  if (!isSupportedDocument(filePath)) throw new Error("请选择 .letterpaper 或 .paperdoc 信笺文件");
  const metrics = {};
  const loaded = await loadPaperDocumentSnapshot(filePath, metrics);
  const { document, diskRevision } = loaded;
  await authorizeDocumentPath(filePath);
  void writeAiDebugLog("document:open:loaded", { filePath, ...metrics });
  return { canceled: false, path: filePath, document, diskRevision, readOnly: Boolean(document._readOnlyFutureSchema) };
});

ipcMain.handle("document:open-path", async (_event, filePath) => {
  if (!filePath) {
    return { canceled: true };
  }
  if (!isSupportedDocument(filePath)) {
    return { canceled: true };
  }
  try {
    const authorizedPath = await resolveAuthorizedOpenDocument(filePath);
    const metrics = {};
    const loaded = await loadPaperDocumentSnapshot(authorizedPath, metrics);
    const { document, diskRevision } = loaded;
    const recoveryId = autosaveSessionIdForPath(authorizedPath);
    void writeAiDebugLog("document:open-path:loaded", { filePath: authorizedPath, ...metrics });
    return { canceled: false, path: authorizedPath, document, diskRevision, readOnly: Boolean(document._readOnlyFutureSchema), ...(recoveryId ? { recoveryId } : {}) };
  } catch (error) {
    await writeAiDebugLog("document:open-path:error", {
      filePath,
      message: error?.message,
      code: error?.code,
    });
    return {
      canceled: true,
      error: String(error?.message || "文档打开失败").slice(0, 500),
    };
  }
});

ipcMain.handle("document:import", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入文档",
    defaultPath: defaultDocumentsDir(),
    properties: ["openFile"],
    filters: [
      { name: "可导入文档", extensions: ["md", "markdown", "html", "htm", "txt", "docx"] },
      { name: "Markdown", extensions: ["md", "markdown"] },
      { name: "HTML", extensions: ["html", "htm"] },
      { name: "纯文本", extensions: ["txt"] },
      { name: "Word 文档", extensions: ["docx"] },
    ],
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const sourcePath = await canonicalExistingPath(result.filePaths[0], "file");
  const imported = await documentInterchange.importDocument({ sourcePath });
  const now = new Date().toISOString();
  const document = normalizeDocument({
    ...imported.document,
    version: DOCUMENT_SCHEMA_VERSION,
    documentId: randomUUID(),
    derivedFrom: "",
    comments: [],
    aiState: {},
    createdAt: now,
    updatedAt: now,
  });
  return {
    canceled: false,
    sourcePath,
    format: imported.format,
    document,
    warnings: imported.warnings || [],
  };
});

function interchangeFormatExtension(format) {
  return ({ markdown: ".md", html: ".html", txt: ".txt", docx: ".docx" })[format] || "";
}

async function existingExportPickerDirectory(value) {
  const candidate = typeof value === "string" ? value.trim().slice(0, 32768) : "";
  if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate) || !path.isAbsolute(candidate)) return "";
  try {
    const stats = await fs.stat(candidate);
    return stats.isDirectory() ? candidate : "";
  } catch {
    return "";
  }
}

async function pickInterchangeExportPath(format, suggestedName, initialDirectory = "") {
  const extension = interchangeFormatExtension(format);
  if (!extension) throw new Error("不支持的可编辑导出格式");
  const labels = { markdown: "Markdown", html: "HTML", txt: "纯文本", docx: "Word 文档" };
  const baseDirectory = await existingExportPickerDirectory(initialDirectory) || defaultDocumentsDir();
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `导出 ${labels[format]}`,
    defaultPath: path.join(baseDirectory, `${exportSafeName(suggestedName)}${extension}`),
    filters: [{ name: labels[format], extensions: [extension.slice(1)] }],
  });
  return result.canceled || !result.filePath ? "" : authorizeExportTarget(ensureExtension(result.filePath, extension), format);
}

ipcMain.handle("document:export-editable", async (_event, payload = {}) => {
  const format = ["markdown", "html", "txt", "docx"].includes(payload.format) ? payload.format : "";
  if (!format) throw new Error("不支持的可编辑导出格式");
  const selectedTargetPath = payload.targetPath
    ? ensureExtension(path.resolve(String(payload.targetPath)), interchangeFormatExtension(format))
    : await pickInterchangeExportPath(format, payload.document?.title || "未命名信笺");
  if (!selectedTargetPath) return { canceled: true };
  const targetPath = consumeExportTarget(selectedTargetPath, format);
  const exported = await documentInterchange.exportDocument({
    format,
    document: normalizeDocument(payload.document || {}),
    targetPath,
    baseName: path.basename(targetPath, path.extname(targetPath)),
  });
  const root = path.dirname(targetPath);
  const writes = [];
  for (const asset of exported.assets || []) {
    const assetPath = path.resolve(root, asset.relativePath);
    if (!isPathInside(root, assetPath)) throw new Error("导出资源路径越过目标文件夹");
    writes.push({ path: assetPath, buffer: asset.buffer });
  }
  // Sidecar assets land first; the main document is the bundle commit point.
  writes.push({ path: targetPath, buffer: exported.buffer });
  for (const write of writes) {
    await fs.mkdir(path.dirname(write.path), { recursive: true });
    await atomicWriteFile(write.path, write.buffer);
  }
  return { canceled: false, path: targetPath, format, warnings: exported.warnings || [], assets: Math.max(0, writes.length - 1) };
});

function requireResearchLibrary() {
  if (!researchLibrary) throw new Error("独立资料库尚未初始化");
  return researchLibrary;
}

ipcMain.handle("research:root-get", async () => requireResearchLibrary().getRoot());

ipcMain.handle("research:root-pick", async () => {
  const previous = requireResearchLibrary().getRoot();
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择资料目录",
    defaultPath: previous.rootPath || app.getPath("documents"),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true, ...previous };
  const selected = await requireResearchLibrary().selectRoot(result.filePaths[0]);
  return { canceled: false, ...selected };
});

ipcMain.handle("research:root-clear", async () => requireResearchLibrary().clearRoot());

ipcMain.handle("research:folder-list", async (_event, payload = {}) => (
  requireResearchLibrary().listFolder(payload.libraryId, payload.relativePath || "")
));

ipcMain.handle("research:folder-create", async (_event, payload = {}) => (
  requireResearchLibrary().createFolder(payload.libraryId, payload.parentRelativePath || "", payload.name || "")
));

ipcMain.handle("research:file-import", async (_event, payload = {}) => {
  const library = requireResearchLibrary();
  // Validate the capability and target before showing a privileged file picker.
  await library.listFolder(payload.libraryId, payload.targetRelativePath || "");
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: "导入资料文件",
    defaultPath: app.getPath("documents"),
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "所有资料文件", extensions: ["*"] }],
  });
  if (picked.canceled || !picked.filePaths?.length) {
    return {
      canceled: true,
      libraryId: payload.libraryId || "",
      targetRelativePath: payload.targetRelativePath || "",
      imported: [],
    };
  }
  return library.importFiles(payload.libraryId, payload.targetRelativePath || "", picked.filePaths);
});

ipcMain.handle("research:entry-rename", async (_event, payload = {}) => (
  requireResearchLibrary().renameEntry(payload.libraryId, payload.relativePath, payload.nextName)
));

ipcMain.handle("research:entry-move", async (_event, payload = {}) => (
  requireResearchLibrary().moveEntry(payload.libraryId, payload.relativePath, payload.targetFolderRelativePath || "")
));

ipcMain.handle("research:entry-trash", async (_event, payload = {}) => (
  requireResearchLibrary().trashEntry(payload.libraryId, payload.relativePath, shell.trashItem?.bind(shell))
));

ipcMain.handle("research:entry-show", async (_event, payload = {}) => (
  requireResearchLibrary().showEntry(payload.libraryId, payload.relativePath || "", shell.showItemInFolder?.bind(shell))
));

ipcMain.handle("research:entry-copy-path", async (_event, payload = {}) => {
  const resolved = await requireResearchLibrary().copyEntryPath(payload.libraryId, payload.relativePath || "");
  clipboard.writeText(resolved.path);
  return { ok: true, libraryId: resolved.libraryId, relativePath: resolved.relativePath };
});

ipcMain.handle("research:source-list", async (_event, payload = {}) => (
  requireResearchLibrary().listSources(payload.libraryId)
));

async function runResearchSourceMutation(task) {
  try {
    return { ok: true, ...(await task()) };
  } catch (error) {
    if (error?.code !== REVISION_CONFLICT_CODE) throw error;
    return {
      ok: false,
      conflict: true,
      code: REVISION_CONFLICT_CODE,
      message: error?.message || "资料来源已被外部修改",
      expectedRevision: error?.expectedRevision || null,
      actualRevision: error?.actualRevision || null,
    };
  }
}

ipcMain.handle("research:source-upsert", async (_event, payload = {}) => runResearchSourceMutation(() => (
  requireResearchLibrary().upsertSource(payload.libraryId, payload.source || {}, payload.expectedRevision || null)
)));

ipcMain.handle("research:source-delete", async (_event, payload = {}) => runResearchSourceMutation(() => (
  requireResearchLibrary().deleteSource(payload.libraryId, payload.sourceId, payload.expectedRevision || null)
)));

ipcMain.handle("research:web-tree-list", async (_event, payload = {}) => (
  requireResearchLibrary().listWebTree(payload.libraryId)
));

ipcMain.handle("research:web-folder-create", async (_event, payload = {}) => runResearchSourceMutation(() => (
  requireResearchLibrary().createWebFolder(payload.libraryId, payload.folder || {}, payload.expectedRevision || null)
)));

ipcMain.handle("research:web-folder-update", async (_event, payload = {}) => runResearchSourceMutation(() => (
  requireResearchLibrary().updateWebFolder(payload.libraryId, payload.folder || {}, payload.expectedRevision || null)
)));

ipcMain.handle("research:web-folder-delete", async (_event, payload = {}) => runResearchSourceMutation(() => (
  requireResearchLibrary().deleteWebFolder(payload.libraryId, payload.folderId, payload.expectedRevision || null)
)));

ipcMain.handle("research:web-source-move", async (_event, payload = {}) => runResearchSourceMutation(() => (
  requireResearchLibrary().moveWebSource(payload.libraryId, payload.sourceId, payload.placement || {}, payload.expectedRevision || null)
)));

ipcMain.handle("research:web-selection-copy", async (_event, payload = {}) => runResearchSourceMutation(async () => {
  if (!activeWorkspaceWatchRoot) throw new Error("当前没有打开的写作工作区");
  const workspace = await ensureWorkspace(activeWorkspaceWatchRoot);
  const selection = payload.selection && typeof payload.selection === "object" ? payload.selection : {};
  const targetScopeKey = normalizeWebScopeKey(selection.targetScopeKey);
  if (targetScopeKey !== `workspace:${String(workspace.manifest.workspaceId || "").toLocaleLowerCase("en-US")}`) {
    throw new Error("只能复制到当前打开工作区的私区");
  }
  return requireResearchLibrary().copyWebSelection(payload.libraryId, { ...selection, targetScopeKey });
}));

ipcMain.handle("research:web-source-upsert", async (_event, payload = {}) => runResearchSourceMutation(async () => {
  const library = requireResearchLibrary();
  const revisions = payload.revisions && typeof payload.revisions === "object" ? payload.revisions : {};
  const saved = await library.upsertSource(payload.libraryId, payload.source || {}, revisions.source || null);
  try {
    const tree = await library.moveWebSource(
      payload.libraryId,
      saved.source.id,
      payload.placement || { scopeKey: "global", folderId: "" },
      revisions.tree || null,
    );
    return { ...saved, tree, placementFallback: false };
  } catch (error) {
    return {
      ...saved,
      tree: await library.listWebTree(payload.libraryId),
      placementFallback: true,
      warning: error?.code === REVISION_CONFLICT_CODE
        ? "网页已保存，但分组索引发生冲突；新网页暂时回退到全局未分组。"
        : `网页已保存，但分组位置未能写入：${error?.message || "未知错误"}`,
    };
  }
}));

ipcMain.handle("research:legacy-import", async (_event, payload = {}) => {
  const workspacePath = await assertAuthorizedDirectory(payload.workspacePath);
  const workspaceKey = process.platform === "win32"
    ? workspacePath.toLocaleLowerCase("en-US")
    : workspacePath;
  const activeWorkspaceKey = process.platform === "win32"
    ? activeWorkspaceWatchRoot.toLocaleLowerCase("en-US")
    : activeWorkspaceWatchRoot;
  if (!activeWorkspaceKey || workspaceKey !== activeWorkspaceKey) {
    throw new Error("只能从左侧文件区当前打开的写作工作区导入旧资料库");
  }
  const library = requireResearchLibrary();
  // Validate the target capability before reading anything from the legacy workspace.
  await library.listSources(payload.libraryId);
  const legacy = await listResearchSources(workspacePath);
  return importLegacyResearch({
    manager: library,
    libraryId: payload.libraryId,
    workspaceId: legacy.workspaceId,
    sources: legacy.sources,
    warnings: legacy.warnings,
    resolveFile: (source) => resolveSourceFile(workspacePath, source),
  });
});

ipcMain.handle("research:pdf-read", async (_event, payload = {}) => (
  requireResearchLibrary().readPdf(payload.libraryId, payload.relativePath)
));

function decodeResearchPreviewText(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if ((buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf)
    || (buffer[0] === 0xff && buffer[1] === 0xfe)
    || (buffer[0] === 0xfe && buffer[1] === 0xff)) {
    return decodeTextBuffer(buffer, "utf8", iconvLite);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return iconvLite.decode(buffer, "gb18030");
  }
}

ipcMain.handle("research:preview-read", async (_event, payload = {}) => {
  const preview = await requireResearchLibrary().readPreview(payload.libraryId, payload.relativePath);
  const common = {
    libraryId: preview.libraryId,
    relativePath: preview.relativePath,
    name: preview.name,
    previewKind: preview.previewKind,
    mime: preview.mime,
    size: preview.size,
    diskRevision: preview.diskRevision,
  };
  if (preview.previewKind === "image") return { ...common, bytes: preview.bytes };
  const text = decodeResearchPreviewText(preview.bytes);
  if (preview.previewKind !== "markdown") return { ...common, text };
  const converted = markdownToHtml(text);
  const sanitized = await sanitizeImportedHtml(converted.html, {
    sourcePath: preview.path,
    fsApi: fs,
    pathApi: path,
  });
  return { ...common, html: sanitized.html, warnings: sanitized.warnings || [] };
});

ipcMain.handle("research:document-open", async (_event, payload = {}) => {
  const resolved = await requireResearchLibrary().copyEntryPath(payload.libraryId, payload.relativePath);
  if (!isSupportedDocument(resolved.path)) throw new Error("该资料不是笺间文档");
  const filePath = await authorizeDocumentPath(resolved.path);
  const metrics = {};
  const loaded = await loadPaperDocumentSnapshot(filePath, metrics);
  const recoveryId = autosaveSessionIdForPath(filePath);
  void writeAiDebugLog("research:document-open:loaded", { filePath, ...metrics });
  return {
    canceled: false,
    path: filePath,
    document: loaded.document,
    diskRevision: loaded.diskRevision,
    readOnly: Boolean(loaded.document._readOnlyFutureSchema),
    ...(recoveryId ? { recoveryId } : {}),
  };
});

ipcMain.handle("research:watch", async (_event, payload = {}) => (
  requireResearchLibrary().watchLibrary(payload.libraryId, {
    onChange: (change) => sendRendererEvent(mainWindow?.webContents, "research:changed", change),
    onError: (error) => sendRendererEvent(mainWindow?.webContents, "research:watch-error", error),
  })
));

async function researchListPayload(rootPath) {
  const listed = await listResearchSources(rootPath);
  const sources = await mapWithConcurrency(listed.sources || [], 12, async (source) => {
    if (source.type !== "file") return source;
    try {
      await resolveSourceFile(rootPath, source);
      return { ...source, missing: false };
    } catch (error) {
      return { ...source, missing: true, missingReason: error?.message || "资料文件不存在" };
    }
  });
  return { ...listed, sources };
}

ipcMain.handle("research:list", async (_event, workspacePath) => {
  const rootPath = await assertAuthorizedDirectory(workspacePath);
  await ensureWorkspace(rootPath);
  return { rootPath, ...(await researchListPayload(rootPath)) };
});

ipcMain.handle("workspace:identity", async (_event, workspacePath) => {
  const rootPath = await assertAuthorizedDirectory(workspacePath);
  const workspace = await ensureWorkspace(rootPath);
  return {
    workspaceId: workspace.manifest.workspaceId,
    workspaceName: path.basename(rootPath) || "当前工作区",
  };
});

ipcMain.handle("research:create", async (_event, workspacePath, source = {}) => {
  const rootPath = await assertAuthorizedDirectory(workspacePath);
  const nextSource = { ...source };
  // This legacy v0.9.5 route remains only for compatibility. Never trust a
  // renderer-provided absolute path: every local file must come from the
  // privileged system picker, just like the v0.9.6 research-library routes.
  delete nextSource.filePath;
  if (nextSource.type === "file") {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: nextSource.storage === "managed" ? "选择要托管的研究资料" : "选择工作区内的研究资料",
      defaultPath: nextSource.storage === "managed" ? app.getPath("documents") : rootPath,
      properties: ["openFile"],
      filters: [{ name: "研究资料", extensions: ["pdf", "docx", "md", "txt", "html", "htm", "png", "jpg", "jpeg", "webp"] }],
    });
    if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true };
    nextSource.filePath = await canonicalExistingPath(picked.filePaths[0], "file");
  }
  const created = await createResearchSource(rootPath, nextSource);
  return { canceled: false, source: created, ...(await researchListPayload(rootPath)) };
});

ipcMain.handle("research:update", async (_event, workspacePath, sourceId, patch = {}) => {
  const rootPath = await assertAuthorizedDirectory(workspacePath);
  const source = await updateResearchSource(rootPath, sourceId, patch);
  return { source, ...(await researchListPayload(rootPath)) };
});

ipcMain.handle("research:delete", async (_event, workspacePath, sourceId) => {
  const rootPath = await assertAuthorizedDirectory(workspacePath);
  await deleteResearchSource(rootPath, sourceId);
  return { ok: true, ...(await researchListPayload(rootPath)) };
});

ipcMain.handle("research:relink", async (_event, workspacePath, sourceId) => {
  const rootPath = await assertAuthorizedDirectory(workspacePath);
  const previous = await readResearchSource(rootPath, sourceId);
  if (previous.type !== "file") throw new Error("只有本地文件资料可以重新定位");
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: "重新定位研究资料",
    defaultPath: previous.storage === "managed" ? app.getPath("documents") : rootPath,
    properties: ["openFile"],
    filters: [{ name: "研究资料", extensions: ["pdf", "docx", "md", "txt", "html", "htm", "png", "jpg", "jpeg", "webp"] }],
  });
  if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true };
  const filePath = await canonicalExistingPath(picked.filePaths[0], "file");
  const source = await relinkResearchSource(rootPath, sourceId, filePath);
  return { canceled: false, source, ...(await researchListPayload(rootPath)) };
});

ipcMain.handle("research:read-file", async (_event, workspacePath, sourceId) => {
  const rootPath = await assertAuthorizedDirectory(workspacePath);
  const source = await readResearchSource(rootPath, sourceId);
  if (source.type !== "file") throw new Error("该资料不是本地文件");
  const resolved = await resolveSourceFile(rootPath, source);
  const filePath = resolved.filePath;
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > RESEARCH_READ_MAX_BYTES) throw new Error("研究资料过大，无法内嵌读取；请使用系统应用打开");
  return { source, bytes: await fs.readFile(filePath), size: stat.size };
});

ipcMain.handle("research:open-external", async (_event, workspacePath, sourceId) => {
  if (workspacePath && typeof workspacePath === "object" && !Array.isArray(workspacePath)) {
    return requireResearchLibrary().openEntryExternal(
      workspacePath.libraryId,
      workspacePath.relativePath,
      shell.openPath.bind(shell),
    );
  }
  const rootPath = await assertAuthorizedDirectory(workspacePath);
  const source = await readResearchSource(rootPath, sourceId);
  if (source.type === "web") {
    let url;
    try { url = new URL(source.url); } catch { throw new Error("资料网址无效"); }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("资料网址协议不受支持");
    await shell.openExternal(url.href);
    return { ok: true };
  }
  if (source.type !== "file") return { ok: false };
  const resolved = await resolveSourceFile(rootPath, source);
  const error = await shell.openPath(resolved.filePath);
  return { ok: !error, error };
});

ipcMain.handle("citation:list", async (_event, workspacePath) => {
  const rootPath = await assertAuthorizedDirectory(workspacePath);
  return { rootPath, ...(await listCitationSources(rootPath)) };
});

ipcMain.handle("citation:upsert", async (_event, workspacePath, source = {}) => {
  const rootPath = await assertAuthorizedDirectory(workspacePath);
  const saved = await upsertCitationSource(rootPath, source);
  return { source: saved, rootPath, ...(await listCitationSources(rootPath)) };
});

ipcMain.handle("citation:delete", async (_event, workspacePath, sourceId) => {
  const rootPath = await assertAuthorizedDirectory(workspacePath);
  const deleted = await deleteCitationSource(rootPath, sourceId);
  return { ...deleted, rootPath, ...(await listCitationSources(rootPath)) };
});

ipcMain.handle("folder:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "打开信笺文件夹",
    defaultPath: app.getPath("desktop"),
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  const folderPath = await authorizeFilesystemRoot(result.filePaths[0]);
  return { canceled: false, ...(await listFolderEntries(folderPath)) };
});

ipcMain.handle("folder:list", async (_event, folderPath) => {
  const startedAt = Date.now();
  if (!folderPath) {
    await writeAiDebugLog("folder:list:empty-path");
    return { canceled: true, files: [], folders: [], entries: [] };
  }
  try {
    void writeAiDebugLog("folder:list:start", { folderPath });
    const authorizedPath = await assertAuthorizedDirectory(folderPath);
    const listed = await listFolderEntries(authorizedPath);
    void writeAiDebugLog("folder:list:success", {
      folderPath,
      ms: Date.now() - startedAt,
      folders: listed.folders.length,
      files: listed.files.length,
    });
    return { canceled: false, ...listed };
  } catch (error) {
    await writeAiDebugLog("folder:list:error", {
      folderPath,
      ms: Date.now() - startedAt,
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });
    return { canceled: true, folderPath: "", files: [], folders: [], entries: [] };
  }
});

ipcMain.handle("folder:copy-path", async (_event, folderPath) => {
  if (!folderPath) {
    return { ok: false };
  }
  const authorizedPath = await assertAuthorizedDirectory(folderPath);
  clipboard.writeText(authorizedPath);
  return { ok: true };
});

ipcMain.handle("folder:show", async (_event, folderPath) => {
  if (!folderPath) {
    return { ok: false };
  }
  const authorizedPath = await assertAuthorizedDirectory(folderPath);
  const error = await shell.openPath(authorizedPath);
  return { ok: !error, error };
});

ipcMain.handle("folder:create", async (_event, parentPath, name) => {
  if (!parentPath) {
    return { ok: false, message: "缺少目标文件夹" };
  }
  const authorizedParent = await assertAuthorizedDirectory(parentPath);
  const folderName = sanitizeName(name, "新建文件夹");
  if (folderName.toLocaleLowerCase("en-US") === ".jianjian") throw new Error("该名称由笺间工作区保留");
  const targetPath = await uniquePath(path.join(authorizedParent, folderName));
  assertMutableWorkspaceEntry(authorizedParent);
  assertMutableWorkspaceEntry(targetPath);
  await fs.mkdir(targetPath, { recursive: false });
  return { ok: true, path: targetPath, ...(await listFolderEntries(authorizedParent)) };
});

ipcMain.handle("document:create-in-folder", async (_event, folderPath, title, templateDocument = {}) => {
  if (!folderPath) {
    return { ok: false, message: "缺少目标文件夹" };
  }
  return runDocumentMutation(async () => {
    const authorizedFolder = await assertAuthorizedDirectory(folderPath);
    assertMutableWorkspaceEntry(authorizedFolder);
    const safeTitle = sanitizeName(title, "未命名信笺");
    const filePath = await uniquePath(path.join(authorizedFolder, `${safeTitle}${DOCUMENT_EXTENSION}`));
    const document = normalizeDocument({
      ...templateDocument,
      version: DOCUMENT_SCHEMA_VERSION,
      documentId: normalizeDocumentId(templateDocument?.documentId) || randomUUID(),
      derivedFrom: "",
      title: safeTitle,
      html: "<p></p>",
    });
    const saved = await savePaperDocumentWithinMutation(filePath, document);
    return { ok: true, path: filePath, document: saved.document, diskRevision: saved.diskRevision, ...(await listFolderEntries(authorizedFolder)) };
  });
});

ipcMain.handle("entry:rename", async (_event, targetPath, nextName) => {
  if (!targetPath) {
    return { ok: false, message: "缺少目标路径" };
  }
  return runDocumentMutation(async () => {
  const authorizedEntry = await assertAuthorizedEntry(targetPath, { destructive: true });
  const currentPath = authorizedEntry.path;
  assertMutableWorkspaceEntry(currentPath);
  const stat = authorizedEntry.stat;
  const parsed = path.parse(currentPath);
  let safeName = sanitizeName(nextName, parsed.name);
  if (stat.isFile() && isSupportedDocument(currentPath)) {
    const typedExtension = path.extname(safeName).toLowerCase();
    if (typedExtension === DOCUMENT_EXTENSION || typedExtension === LEGACY_DOCUMENT_EXTENSION) {
      safeName = path.basename(safeName, typedExtension);
    }
  }
  const nextPath = path.join(parsed.dir, stat.isFile() && isSupportedDocument(currentPath) ? `${safeName}${DOCUMENT_EXTENSION}` : safeName);
  assertMutableWorkspaceEntry(nextPath);
  if (nextPath === currentPath) {
    return { ok: true, path: currentPath, ...(await listAuthorizedFolderEntries(parsed.dir)) };
  }
  try {
    await fs.access(nextPath);
    return { ok: false, message: "同名项目已经存在" };
  } catch {
    await fs.rename(currentPath, nextPath);
    rebaseAssetPathReferences(currentPath, nextPath);
    filesystemAccess.rebase(currentPath, nextPath);
    await persistFilesystemAccess();
    return { ok: true, oldPath: currentPath, path: nextPath, ...(await listAuthorizedFolderEntries(parsed.dir)) };
  }
  });
});

ipcMain.handle("entry:delete", async (_event, targetPath) => {
  if (!targetPath) {
    return { ok: false, message: "缺少目标路径" };
  }
  return runDocumentMutation(async () => {
  const authorizedEntry = await assertAuthorizedEntry(targetPath, { destructive: true });
  const currentPath = authorizedEntry.path;
  assertMutableWorkspaceEntry(currentPath);
  const parentPath = path.dirname(currentPath);
  if (typeof shell.trashItem === "function") {
    await shell.trashItem(currentPath);
  } else {
    await fs.rm(currentPath, { recursive: authorizedEntry.stat.isDirectory(), force: true });
  }
  invalidateDocumentCachesForPath(currentPath, true, { revokeReferences: true });
  filesystemAccess.revoke(currentPath, authorizedEntry.stat.isDirectory());
  await persistFilesystemAccess();
  return { ok: true, deletedPath: currentPath, ...(await listAuthorizedFolderEntries(parentPath)) };
  });
});

ipcMain.handle("entry:move", async (_event, sourcePath, targetFolderPath) => {
  if (!sourcePath || !targetFolderPath) {
    return { ok: false, message: "缺少移动路径" };
  }
  return runDocumentMutation(async () => {
  const authorizedSource = await assertAuthorizedEntry(sourcePath, { destructive: true });
  const fromPath = authorizedSource.path;
  const toFolder = await assertAuthorizedDirectory(targetFolderPath);
  assertMutableWorkspaceEntry(fromPath);
  assertMutableWorkspaceEntry(toFolder);
  const sourceStat = authorizedSource.stat;
  if (sourceStat.isDirectory()) {
    const relative = path.relative(fromPath, toFolder);
    if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return { ok: false, message: "不能把文件夹移动到自身内部" };
    }
  }

  const sourceParent = path.dirname(fromPath);
  if (sourceParent === toFolder) {
    return { ok: false, message: "已经在这个文件夹里" };
  }

  const targetPath = await uniquePath(path.join(toFolder, path.basename(fromPath)));
  await fs.rename(fromPath, targetPath);
  rebaseAssetPathReferences(fromPath, targetPath);
  filesystemAccess.rebase(fromPath, targetPath);
  await persistFilesystemAccess();
  return {
    ok: true,
    oldPath: fromPath,
    path: targetPath,
    sourceParent,
    targetFolderPath: toFolder,
  };
  });
});

ipcMain.handle("document:backup", async (_event, filePath) => {
  if (!filePath || !isSupportedDocument(filePath)) {
    return { ok: false, message: "只能备份信笺文件" };
  }
  return runDocumentMutation(async () => {
  const sourcePath = await assertAuthorizedDocument(filePath);
  const parsed = path.parse(sourcePath);
  const backupPath = await uniquePath(path.join(parsed.dir, `${parsed.name}_备份_${timestampForFileName()}${DOCUMENT_EXTENSION}`));
  const sourceSnapshot = await loadPaperDocumentSnapshot(sourcePath);
  if (Number(sourceSnapshot.rawDocument?.version || 1) > DOCUMENT_SCHEMA_VERSION || sourceSnapshot.document._readOnlyFutureSchema) {
    throw new Error(`此信笺使用未来格式 v${Number(sourceSnapshot.rawDocument?.version) || "?"}，当前版本不能复制备份`);
  }
  let sourceDocument = sourceSnapshot.document;
  let sourceDiskRevision = sourceSnapshot.diskRevision;
  let migrationBackupPath = "";
  const rawSourceId = normalizeDocumentId(sourceSnapshot.rawDocument?.documentId);
  if (Number(sourceSnapshot.rawDocument?.version || 1) < DOCUMENT_SCHEMA_VERSION || !rawSourceId) {
    migrationBackupPath = await preservePreV2MigrationBackup(sourcePath);
    sourceDocument = {
      ...sourceDocument,
      version: DOCUMENT_SCHEMA_VERSION,
      documentId: rawSourceId || randomUUID(),
      derivedFrom: normalizeDocumentId(sourceDocument.derivedFrom),
      footnotes: Array.isArray(sourceDocument.footnotes) ? sourceDocument.footnotes : [],
      citationSources: Array.isArray(sourceDocument.citationSources) ? sourceDocument.citationSources : [],
    };
    const migrated = await savePaperDocumentWithinMutation(sourcePath, sourceDocument, {
      validateTarget: (candidate) => assertDiskRevision(candidate, sourceDiskRevision),
    });
    sourceDocument = migrated.document;
    sourceDiskRevision = migrated.diskRevision;
  }
  const parentId = normalizeDocumentId(sourceDocument.documentId);
  if (!parentId) throw new Error("源信笺缺少有效文档身份，无法建立备份关系");
  const backupDocument = {
    ...sourceDocument,
    version: DOCUMENT_SCHEMA_VERSION,
    documentId: randomUUID(),
    derivedFrom: parentId,
    title: `${sourceDocument.title || parsed.name}（备份）`,
  };
  const savedBackup = await savePaperDocumentWithinMutation(backupPath, backupDocument);
  await authorizeDocumentPath(backupPath);
  return {
    ok: true,
    path: backupPath,
    diskRevision: savedBackup.diskRevision,
    sourcePath,
    sourceDocument,
    sourceDiskRevision,
    ...(migrationBackupPath ? { migrationBackupPath } : {}),
    ...(await listAuthorizedFolderEntries(parsed.dir)),
  };
  });
});

async function listAuthorizedFolderEntries(folderPath) {
  if (!filesystemAccess.canAccessDirectory(folderPath)) {
    return { folderPath: "", parentPath: "", folders: [], files: [], entries: [] };
  }
  return listFolderEntries(folderPath);
}

async function listFolderEntries(folderPath) {
  if (isReservedWorkspaceMetadataPath(folderPath)) throw new Error(".jianjian 是工作区内部目录");
  const startedAt = Date.now();
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  if (entries.length > 20000) throw new Error("这个文件夹包含过多项目，请选择更具体的信笺文件夹");
  void writeAiDebugLog("folder:entries:readdir", {
    folderPath,
    ms: Date.now() - startedAt,
    count: entries.length,
  });
  const parent = path.dirname(folderPath);
  const parentPath = parent && parent !== folderPath && filesystemAccess.canAccessDirectory(parent) ? parent : "";
  const folders = [];
  const fileReads = [];
  for (const entry of entries) {
    if (entry.name.toLocaleLowerCase("en-US") === ".jianjian") continue;
    const filePath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      folders.push({
        type: "folder",
        name: entry.name,
        path: filePath,
        hasLetterpapers: null,
        updatedAt: "",
      });
      continue;
    }

    if (!entry.isFile() || !isSupportedDocument(filePath)) {
      continue;
    }

    fileReads.push({ entry, filePath });
  }

  const files = await mapWithConcurrency(fileReads, 32, async ({ entry, filePath }) => {
      try {
        const stat = await fs.stat(filePath);
        const displayName = path.basename(entry.name, path.extname(entry.name));
        return {
          type: "file",
          name: entry.name,
          displayName,
          path: filePath,
          extension: path.extname(entry.name).toLowerCase(),
          updatedAt: stat.mtime.toISOString(),
          size: stat.size,
        };
      } catch (error) {
        await writeAiDebugLog("folder:file-stat:error", {
          filePath,
          code: error?.code,
          message: error?.message,
        });
        return null;
      }
  });
  const readableFiles = files.filter(Boolean);
  folders.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  readableFiles.sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
  return {
    folderPath,
    parentPath,
    folders,
    files: readableFiles,
    entries: [...folders, ...readableFiles],
  };
}

async function preservePreV2MigrationBackup(filePath) {
  try {
    const rawDocument = await readSearchDocument(filePath);
    if (Number(rawDocument?.version || 1) >= DOCUMENT_SCHEMA_VERSION) return "";
    const backupRoot = path.join(app.getPath("userData"), MIGRATION_BACKUP_FOLDER);
    await fs.mkdir(backupRoot, { recursive: true });
    const safeName = sanitizeFilesystemName(path.basename(filePath, path.extname(filePath)), "未命名信笺", 72);
    const backupPath = path.join(backupRoot, `${safeName}_pre-v2_${timestampForFileName()}_${randomUUID().slice(0, 8)}${DOCUMENT_EXTENSION}`);
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    await writeAiDebugLog("document:migration-backup:error", { filePath, message: error?.message });
    throw new Error("无法建立格式迁移备份，已取消保存", { cause: error });
  }
}

ipcMain.handle("document:save", async (_event, document, currentPath, saveAs, reservedPaths = [], expectedRevision = null, saveOptions = {}) => {
  if (Number(document?.version || 1) > DOCUMENT_SCHEMA_VERSION || document?._readOnlyFutureSchema) {
    throw new Error(`此信笺使用未来格式 v${Number(document?.version) || "?"}，当前版本只能只读打开`);
  }
  const sourcePath = currentPath && isSupportedDocument(currentPath) ? path.resolve(String(currentPath)) : "";
  let filePath = currentPath;
  let userSelectedTarget = false;
  if (saveAs || !filePath) {
    const safeTitle = sanitizeFilesystemName(normalizeDocument(document).title, "未命名信笺", 60);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "保存信笺",
      defaultPath: path.join(defaultDocumentsDir(), `${safeTitle}${DOCUMENT_EXTENSION}`),
      filters: DOCUMENT_FILTERS,
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    filePath = isSupportedDocument(result.filePath) ? result.filePath : ensureExtension(result.filePath, DOCUMENT_EXTENSION);
    userSelectedTarget = true;
  }

  filePath = await resolveDocumentTargetPath(filePath);

  const targetKey = process.platform === "win32"
    ? path.resolve(filePath).toLocaleLowerCase("en-US")
    : path.resolve(filePath);
  const conflictsWithOpenDocument = (Array.isArray(reservedPaths) ? reservedPaths : [])
    .slice(0, 100)
    .some((value) => {
      if (!value) return false;
      const candidate = path.resolve(String(value).slice(0, 32768));
      return (process.platform === "win32" ? candidate.toLocaleLowerCase("en-US") : candidate) === targetKey;
    });
  if (conflictsWithOpenDocument) {
    throw new Error("该保存位置已被另一个打开的标签占用，请选择其他文件名");
  }

  if (userSelectedTarget) await authorizeDocumentPath(filePath, { mustExist: false });
  else filePath = await assertAuthorizedDocumentTarget(filePath);

  const sourceKey = sourcePath
    ? (process.platform === "win32" ? sourcePath.toLocaleLowerCase("en-US") : sourcePath)
    : "";
  const targetStat = await fs.stat(filePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const targetIdentity = targetStat?.isFile() ? { dev: targetStat.dev, ino: targetStat.ino } : null;
  let documentToSave = document;
  if (userSelectedTarget && sourcePath && targetKey !== sourceKey) {
    const parentId = normalizeDocumentId(document?.documentId);
    documentToSave = {
      ...document,
      version: DOCUMENT_SCHEMA_VERSION,
      documentId: randomUUID(),
      derivedFrom: parentId,
    };
  }

  const writeConflictCopy = async (error) => {
    let conflictCopyPath = createConflictCopyPath(filePath);
    for (let sequence = 0; sequence < 100; sequence += 1) {
      conflictCopyPath = createConflictCopyPath(filePath, { sequence });
      try {
        await fs.access(conflictCopyPath);
      } catch (accessError) {
        if (accessError?.code === "ENOENT") break;
        throw accessError;
      }
    }
    const conflictDocument = {
      ...documentToSave,
      version: DOCUMENT_SCHEMA_VERSION,
      documentId: randomUUID(),
      derivedFrom: normalizeDocumentId(documentToSave?.documentId),
      title: `${normalizeDocument(documentToSave).title}（本机冲突副本）`,
    };
    const conflictSaved = await savePaperDocument(conflictCopyPath, conflictDocument);
    await authorizeDocumentPath(conflictCopyPath);
    return {
      canceled: false,
      conflict: true,
      code: REVISION_CONFLICT_CODE,
      path: filePath,
      conflictCopyPath,
      conflictDocument: conflictSaved.document,
      expectedRevision: error.expectedRevision || expectedRevision,
      actualRevision: error.actualRevision || await readDiskRevision(filePath),
    };
  };

  if (!userSelectedTarget && sourcePath) {
    try {
      await assertDiskRevision(filePath, expectedRevision);
    } catch (error) {
      if (error?.code !== REVISION_CONFLICT_CODE) throw error;
      return writeConflictCopy(error);
    }
  }

  const migrationBackupPath = sourcePath && Number(documentToSave?.version || 1) >= DOCUMENT_SCHEMA_VERSION
    ? await preservePreV2MigrationBackup(filePath)
    : "";
  let saved;
  try {
    saved = await savePaperDocument(filePath, documentToSave, {
      validateTarget: async (targetPath) => {
        const authorizedTarget = await assertAuthorizedDocumentTarget(targetPath);
        if (!userSelectedTarget && sourcePath) {
          await assertDiskRevision(authorizedTarget, expectedRevision);
        }
        const currentStat = await fs.stat(authorizedTarget).catch((error) => {
          if (error?.code === "ENOENT") return null;
          throw error;
        });
        if (targetIdentity) {
          if (!currentStat?.isFile() || currentStat.dev !== targetIdentity.dev || currentStat.ino !== targetIdentity.ino) {
            throw new DocumentRevisionConflictError("保存期间目标信笺已被移动、删除或替换", {
              filePath: authorizedTarget,
              expectedRevision,
              actualRevision: await readDiskRevision(authorizedTarget),
            });
          }
        } else if (!targetIdentity && currentStat) {
          throw new DocumentRevisionConflictError("保存期间目标位置出现了同名文件", {
            filePath: authorizedTarget,
            expectedRevision: null,
            actualRevision: await readDiskRevision(authorizedTarget),
          });
        }
      },
      afterCommit: userSelectedTarget && sourceKey && sourceKey !== targetKey
        ? async () => rebaseAssetPathReferences(sourcePath, filePath)
        : undefined,
    });
  } catch (error) {
    if (!userSelectedTarget && sourcePath && error?.code === REVISION_CONFLICT_CODE) {
      return writeConflictCopy(error);
    }
    throw error;
  }
  return { canceled: false, path: filePath, document: saved.document, diskRevision: saved.diskRevision, ...(migrationBackupPath ? { migrationBackupPath } : {}) };
});

function exportSafeName(suggestedName) {
  return sanitizeFilesystemName(suggestedName, "未命名信笺", 60);
}

async function pickDocumentExportPath(format, suggestedName, initialDirectory = "") {
  const safeName = exportSafeName(suggestedName);
  const rememberedDirectory = await existingExportPickerDirectory(initialDirectory);
  if (format === "images") {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择分页图片导出文件夹",
      defaultPath: rememberedDirectory || path.join(defaultDocumentsDir(), safeName),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const targetPath = authorizeExportTarget(result.filePaths[0], "images");
    return { canceled: false, path: targetPath, directory: targetPath, format: "images" };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "选择 PDF 导出位置",
    defaultPath: path.join(rememberedDirectory || defaultDocumentsDir(), `${safeName}.pdf`),
    filters: [
      { name: "PDF 文档", extensions: ["pdf"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const targetPath = authorizeExportTarget(ensureExtension(result.filePath, ".pdf"), "pdf");
  return { canceled: false, path: targetPath, directory: path.dirname(targetPath), format: "pdf" };
}

function sendExportProgress(event, payload) {
  if (!event?.sender?.isDestroyed?.()) {
    event.sender.send("document:export-progress", payload);
  }
}

ipcMain.handle("document:pick-export-path", async (_event, format, suggestedName, initialDirectory) => {
  if (["markdown", "html", "txt", "docx"].includes(format)) {
    const targetPath = await pickInterchangeExportPath(format, suggestedName, initialDirectory);
    return targetPath ? { canceled: false, path: targetPath, directory: path.dirname(targetPath), format } : { canceled: true };
  }
  return pickDocumentExportPath(format === "images" ? "images" : "pdf", suggestedName, initialDirectory);
});

ipcMain.handle("document:export-pdf", async (event, suggestedName, targetPath) => {
  const safeName = exportSafeName(suggestedName);
  const destination = targetPath
    ? { canceled: false, path: ensureExtension(String(targetPath), ".pdf") }
    : await pickDocumentExportPath("pdf", safeName);
  if (destination.canceled || !destination.path) {
    return { canceled: true };
  }

  const filePath = consumeExportTarget(destination.path, "pdf");
  sendExportProgress(event, { format: "pdf", percent: 12, message: "正在整理信笺版面…" });
  const pdf = await mainWindow.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    landscape: false,
    margins: {
      marginType: "none",
    },
  });
  sendExportProgress(event, { format: "pdf", percent: 78, message: "正在写入 PDF 文件…" });
  await atomicWriteFile(filePath, pdf);
  sendExportProgress(event, { format: "pdf", percent: 100, message: "PDF 导出完成" });
  return { canceled: false, path: filePath };
});

ipcMain.handle("document:export-page-images", async (event, suggestedName, pageRects, targetPath) => {
  const safeName = sanitizeFilesystemName(suggestedName, "未命名信笺", 60);
  if (Array.isArray(pageRects) && pageRects.length > 500) throw new Error("分页图片数量过多，已拒绝导出");
  const rects = Array.isArray(pageRects)
    ? pageRects
        .map((rect) => ({
          x: Number(rect.x),
          y: Number(rect.y),
          width: Number(rect.width),
          height: Number(rect.height),
        }))
        .filter((rect) => (
          Number.isFinite(rect.x)
          && Number.isFinite(rect.y)
          && Number.isFinite(rect.width)
          && Number.isFinite(rect.height)
          && rect.x >= 0
          && rect.y >= 0
          && rect.width > 0
          && rect.width <= 10000
          && rect.height > 0
          && rect.height <= 8000
        ))
    : [];

  if (!rects.length) {
    return { canceled: true };
  }
  const totalPixels = rects.reduce((total, rect) => total + rect.width * rect.height, 0);
  if (totalPixels > 512 * 1024 * 1024) throw new Error("分页图片总像素过大，请减少内容后重试");

  const destination = targetPath
    ? { canceled: false, path: String(targetPath) }
    : await pickDocumentExportPath("images", safeName);
  if (destination.canceled || !destination.path) {
    return { canceled: true };
  }

  const outputDir = consumeExportTarget(destination.path, "images");
  sendExportProgress(event, { format: "images", percent: 8, message: `正在准备 ${rects.length} 张分页图片…` });
  await fs.mkdir(outputDir, { recursive: true });
  const debuggerApi = mainWindow.webContents.debugger;
  let attachedHere = false;
  try {
    if (!debuggerApi.isAttached()) {
      debuggerApi.attach("1.3");
      attachedHere = true;
    }
    await debuggerApi.sendCommand("Page.enable");
    sendExportProgress(event, { format: "images", percent: 14, message: "已准备图像渲染环境" });
    const files = [];
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index];
      const capture = await debuggerApi.sendCommand("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: Math.max(0, rect.x),
          y: Math.max(0, rect.y),
          width: rect.width,
          height: rect.height,
          scale: 1,
        },
      });
      const filePath = path.join(outputDir, `${safeName}-${String(index + 1).padStart(2, "0")}.png`);
      await atomicWriteFile(filePath, Buffer.from(capture.data, "base64"));
      files.push(filePath);
      const completed = index + 1;
      sendExportProgress(event, {
        format: "images",
        percent: Math.round(14 + (completed / rects.length) * 86),
        message: `正在导出第 ${completed} / ${rects.length} 张图片`,
        completed,
        total: rects.length,
      });
    }
    return { canceled: false, path: outputDir, files, count: files.length };
  } finally {
    if (attachedHere && debuggerApi.isAttached()) {
      debuggerApi.detach();
    }
  }
});

async function pickLocalMediaAsset(kind) {
  const isAudio = kind === "audio";
  const extensions = isAudio ? AUDIO_EXTENSIONS : VIDEO_EXTENSIONS;
  const maxBytes = isAudio ? AUDIO_MAX_BYTES : VIDEO_MAX_BYTES;
  const label = isAudio ? "音频" : "视频";
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `选择${label}`,
    properties: ["openFile"],
    filters: [
      { name: label, extensions },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const extension = path.extname(filePath).toLowerCase().replace(/^\./, "");
  if (!extensions.includes(extension)) {
    return { canceled: false, error: "unsupported-type", kind, extension };
  }
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > maxBytes) {
      return { canceled: false, error: "too-large", kind, size: stat.size, maxBytes };
    }
    if (!stagedAssetStore) throw new Error("资源暂存服务尚未就绪");
    const staged = await stagedAssetStore.stage(filePath, {
      mime: mimeFromPath(filePath),
      name: path.basename(filePath),
    });
    return {
      canceled: false,
      kind,
      name: path.basename(filePath, path.extname(filePath)),
      fileName: path.basename(filePath),
      mime: mimeFromPath(filePath),
      size: staged.size,
      src: staged.src,
    };
  } catch {
    return { canceled: false, error: "read-failed", kind };
  }
}

ipcMain.handle("asset:pick-image", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择图片",
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: IMAGE_EXTENSIONS },
    ],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const extension = path.extname(filePath).slice(1).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(extension)) {
    return { canceled: false, error: "unsupported-type", kind: "image", extension };
  }
  if (!stagedAssetStore) throw new Error("图片暂存服务尚未就绪，请重启应用后重试");
  const fileName = path.basename(filePath);
  const mime = mimeFromPath(filePath);
  const staged = await stagedAssetStore.stage(filePath, { mime, name: fileName });
  return {
    canceled: false,
    name: path.basename(filePath, path.extname(filePath)),
    fileName,
    mime,
    size: staged.size,
    src: staged.src,
  };
});

ipcMain.handle("asset:pick-audio", async () => pickLocalMediaAsset("audio"));
ipcMain.handle("asset:pick-video", async () => pickLocalMediaAsset("video"));

function safeClipboardUuid(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : "";
}

function safeClipboardContent(value, maximumLength) {
  return typeof value === "string" ? value.slice(0, maximumLength) : "";
}

ipcMain.handle("clipboard:write-content", async (_event, payload = {}) => {
  const text = safeClipboardContent(payload?.text, 2_000_000);
  const html = safeClipboardContent(payload?.html, 4_000_000);
  if (!text && !html) return { ok: false, message: "没有可复制的内容" };
  clipboard.write(html ? { text, html } : { text });
  return { ok: true };
});

ipcMain.handle("clipboard:write-image-reference", async (_event, payload = {}) => {
  const documentId = safeClipboardUuid(payload?.documentId);
  const imageId = safeClipboardUuid(payload?.imageId);
  const number = Math.max(1, Math.min(5_000, Number.parseInt(payload?.number, 10) || 1));
  if (!documentId || !imageId) return { ok: false, message: "图片引用身份无效" };
  const label = `图${number}`;
  const html = `<span data-paper-image-reference="true" data-image-id="${imageId}" data-image-number="${number}" data-missing="false" data-source-document-id="${documentId}">${label}</span>`;
  clipboard.write({ text: label, html });
  return { ok: true };
});

ipcMain.handle("external:open", async (_event, urlValue) => {
  try {
    const rawUrl = String(urlValue || "");
    if (rawUrl.length > 8192) return { ok: false, error: "url-too-long" };
    const url = new URL(rawUrl);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
      return { ok: false, error: "unsupported-protocol" };
    }
    await shell.openExternal(url.toString());
    return { ok: true };
  } catch {
    return { ok: false, error: "invalid-url" };
  }
});

ipcMain.handle("autosave:load", async () => {
  const filePath = autosavePath();
  try {
    await fs.access(filePath);
    return { exists: true, path: filePath, document: await loadPaperDocument(filePath) };
  } catch {
    return { exists: false };
  }
});

ipcMain.handle("autosave:save", async (_event, document) => {
  const filePath = autosavePath();
  const saved = await savePaperDocument(filePath, document);
  return { path: filePath, document: saved.document };
});

ipcMain.handle("autosave:save-tab", async (_event, document, tabId) => {
  const filePath = autosaveSessionPath(tabId);
  const saved = await savePaperDocument(filePath, document);
  return { canceled: false, path: filePath, recoveryId: path.basename(filePath, path.extname(filePath)), document: saved.document };
});

ipcMain.handle("autosave:delete-tab", async (_event, tabId) => {
  return runDocumentMutation(async () => {
    const filePath = autosaveSessionPath(tabId);
    await fs.rm(filePath, { force: true });
    invalidateDocumentCachesForPath(filePath, false, { revokeReferences: true });
    return { ok: true };
  });
});

ipcMain.handle("autosave:clear", async () => {
  return runDocumentMutation(async () => {
    const filePath = autosavePath();
    try {
      await fs.rm(filePath, { force: true });
    } catch {
      // No-op.
    }
    invalidateDocumentCachesForPath(filePath, false, { revokeReferences: true });
    return { ok: true };
  });
});

ipcMain.handle("app:confirm-close", async (_event, payload = {}) => {
  const dirtyCount = Number(payload.dirtyCount) || 0;
  const result = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "关闭笺间",
    message: dirtyCount > 1 ? `有 ${dirtyCount} 篇信笺尚未保存` : "当前信笺尚未保存",
    detail: "选择“保存并关闭”会先保存已有文件；未命名信笺会保存为临时会话文件，下次启动会恢复打开。",
    buttons: ["保存并关闭", "不保存", "取消"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (result.response === 0) {
    return { action: "save" };
  }
  if (result.response === 1) {
    return { action: "discard" };
  }
  return { action: "cancel" };
});

ipcMain.handle("app:close-ready", async () => {
  forceCloseWindow = true;
  closeRequestInFlight = false;
  if (pendingUpdateInstall) {
    try {
      autoUpdater.quitAndInstall(false, true);
      return { ok: true, installingUpdate: true };
    } catch (error) {
      pendingUpdateInstall = false;
      forceCloseWindow = false;
      await writeAiDebugLog("update:install:error", { message: error?.message });
      throw error;
    }
  }
  mainWindow?.close();
  return { ok: true };
});

ipcMain.handle("app:close-canceled", async () => {
  closeRequestInFlight = false;
  pendingUpdateInstall = false;
  stopCloseAttention();
  return { ok: true };
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  if (process.platform === "win32") {
    app.setAppUserModelId("PaperWriter.Electron");
  }
  await initializeAutosaveStorage();
  await migratePlaintextAiSecrets();
  await initializeFilesystemAccess();
  researchLibrary = createResearchLibraryManager({ userDataPath: app.getPath("userData") });
  await researchLibrary.initialize();
  researchWebViews = createResearchWebViewManager({
    WebContentsView,
    session,
    shell,
    getWindow: () => mainWindow,
    sendState: (payload) => sendRendererEvent(mainWindow?.webContents, "research:web-view-state", payload),
  });
  stagedAssetStore = createStagedAssetStore({
    rootDir: path.join(app.getPath("temp"), "PaperWriterAssets"),
  });
  await stagedAssetStore.initialize();
  documentInterchange = createDocumentInterchange({
    mammoth,
    docx,
    iconvLite,
    resolveAsset: readProtocolAsset,
  });
  stagedAssetHeartbeatTimer = setInterval(() => {
    stagedAssetStore?.touch().catch(() => {});
  }, 60 * 60 * 1000);
  stagedAssetHeartbeatTimer.unref?.();
  registerAssetProtocol();
  createWindow();
}).catch((error) => {
  dialog.showErrorBox("笺间", `应用数据初始化失败。\n\n${error?.message || error}`);
  app.quit();
});

app.on("before-quit", (event) => {
  stopWorkspaceWatcher();
  researchLibrary?.closeWatcher();
  researchWebViews?.destroyAll();
  for (const controller of activeAiRequests.values()) controller.abort();
  activeAiRequests.clear();
  if (stagedAssetHeartbeatTimer) {
    clearInterval(stagedAssetHeartbeatTimer);
    stagedAssetHeartbeatTimer = null;
  }
  if (!stagedAssetStore || stagedAssetCleanupComplete) return;
  event.preventDefault();
  if (stagedAssetCleanupStarted) return;
  stagedAssetCleanupStarted = true;
  Promise.allSettled([...extractedAssetPending.values()])
    .then(() => stagedAssetStore.cleanupCurrent())
    .catch(() => {})
    .finally(() => {
      assetZipCache.clear();
      assetZipPending.clear();
      extractedAssetCache.clear();
      extractedAssetPending.clear();
      assetSourceAliases.clear();
      stagedAssetCleanupComplete = true;
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
