const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, net, protocol, screen, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const JSZip = require("jszip");
const {
  AI_PROTOCOLS,
  BUILTIN_AI_PROVIDERS,
  activeAiProviderConfig,
  buildAiRequest,
  createAiModelId,
  extractAiStreamEvent,
  mergeAiUsage,
  normalizeAiConfig,
  normalizeAiModelConfig,
  normalizeAiProtocol,
  normalizeAiProviderConfig,
  publicAiConfig,
} = require("./ai-provider-core.cjs");
const {
  CODEX_PROVIDER_ID,
  refreshCodexStatus,
  startCodexLogin,
  streamCodexCompletion,
} = require("./codex-cli-provider.cjs");
const { normalizeCodexScope, resolveCodexScopeDirectory } = require("./codex-scope.cjs");
const {
  materializeCodexImageAttachments,
  normalizeCodexImageMode,
} = require("./codex-image-attachments.cjs");

const APP_ROOT = path.resolve(__dirname, "..");
const FRONTEND_URL = process.env.PAPERWRITER_FRONTEND_URL || "";
const APP_ICON = path.resolve(__dirname, "assets", process.platform === "win32" ? "app-icon.ico" : "app-icon.png");
const DATA_URL_PATTERN = /src=(["'])(data:(?:image|audio|video)\/[^"']+)\1/gi;
const ASSET_URL_PATTERN = /src=(["'])(assets\/[^"']+)\1/gi;
const ASSET_PROTOCOL = "paperwriter-asset";
const ASSET_PROTOCOL_URL_PATTERN = /src=(["'])(paperwriter-asset:\/\/[^"']+)\1/gi;
const DOCUMENT_EXTENSION = ".letterpaper";
const LEGACY_DOCUMENT_EXTENSION = ".paperdoc";
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
const AI_CONFIG_FILE = "ai-config.json";
const TITLE_BAR_OVERLAY_DEFAULT = {
  color: "#cdd7d2",
  symbolColor: "#334155",
  height: 40,
};
const ASSET_ZIP_CACHE_LIMIT = 5;

let mainWindow = null;
let closeRequestInFlight = false;
let forceCloseWindow = false;
let updateState = {
  status: "idle",
  message: "尚未检查更新",
  version: app.getVersion(),
};
const activeAiRequests = new Map();
const assetZipCache = new Map();
let codexRuntimeStatus = {
  installed: false,
  authenticated: false,
  ready: false,
  catalogFresh: false,
  checkedAt: "",
  message: "尚未检查本地 Codex CLI",
};

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

async function writeAiDebugLog(event, data = {}) {
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
    const payload = {
      time: new Date().toISOString(),
      pid: process.pid,
      event,
      data: fallbackReason ? { ...data, fallbackReason } : data,
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
    return path.join(process.resourcesPath, "frontend", "dist", "index.html");
  }
  return path.resolve(__dirname, "..", "frontend", "dist", "index.html");
}

function emitUpdateState(patch) {
  updateState = {
    ...updateState,
    ...patch,
    version: app.getVersion(),
  };
  mainWindow?.webContents.send("update:state", updateState);
  return updateState;
}

function createWindow() {
  closeRequestInFlight = false;
  forceCloseWindow = false;
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
      sandbox: false,
    },
  });

  mainWindow.on("close", (event) => {
    if (forceCloseWindow) {
      return;
    }
    event.preventDefault();
    if (closeRequestInFlight) {
      return;
    }
    closeRequestInFlight = true;
    mainWindow.webContents.send("app:close-request", { requestedAt: Date.now() });
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
    const parsed = parseAssetUrl(request.url);
    if (!parsed) {
      return new Response("Not found", { status: 404 });
    }
    try {
      const { buffer, mime } = await readPackagedAsset(parsed.filePath, parsed.assetPath);
      const rangeHeader = request.headers.get("range");
      const commonHeaders = {
        "content-type": mime,
        "cache-control": "no-store",
        "accept-ranges": "bytes",
      };
      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
        if (!match || buffer.length === 0 || (!match[1] && !match[2])) {
          return new Response(null, { status: 416, headers: { ...commonHeaders, "content-range": `bytes */${buffer.length}` } });
        }
        let start;
        let end;
        if (!match[1]) {
          const suffixLength = Number(match[2]);
          if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
            return new Response(null, { status: 416, headers: { ...commonHeaders, "content-range": `bytes */${buffer.length}` } });
          }
          start = Math.max(0, buffer.length - suffixLength);
          end = buffer.length - 1;
        } else {
          start = Number(match[1]);
          end = match[2] ? Number(match[2]) : buffer.length - 1;
          if (!Number.isFinite(start) || !Number.isFinite(end) || start >= buffer.length || end < start) {
            return new Response(null, { status: 416, headers: { ...commonHeaders, "content-range": `bytes */${buffer.length}` } });
          }
          end = Math.min(end, buffer.length - 1);
        }
        const chunk = buffer.subarray(start, end + 1);
        return new Response(chunk, {
          status: 206,
          headers: {
            ...commonHeaders,
            "content-length": String(chunk.length),
            "content-range": `bytes ${start}-${end}/${buffer.length}`,
          },
        });
      }
      return new Response(buffer, {
        headers: {
          ...commonHeaders,
          "content-length": String(buffer.length),
        },
      });
    } catch (error) {
      await writeAiDebugLog("asset:protocol:error", {
        filePath: parsed.filePath,
        assetPath: parsed.assetPath,
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
  return normalized.providers[provider] ? provider : normalized.activeProvider;
}

async function readAiConfig() {
  try {
    const raw = await fs.readFile(aiConfigPath(), "utf8");
    return normalizeAiConfig(JSON.parse(raw));
  } catch {
    return normalizeAiConfig();
  }
}

function publicAiConfigWithRuntime(config) {
  return publicAiConfig(config, { [CODEX_PROVIDER_ID]: codexRuntimeStatus });
}

async function persistAiConfig(config) {
  await ensureParentDir(aiConfigPath());
  await fs.writeFile(aiConfigPath(), `${JSON.stringify(normalizeAiConfig(config), null, 2)}\n`, "utf8");
}

async function refreshCodexCliConfig() {
  const existing = await readAiConfig();
  const previousProvider = existing.providers[CODEX_PROVIDER_ID];
  const status = await refreshCodexStatus({
    previousModels: previousProvider.models,
    appVersion: app.getVersion(),
  });
  const models = Array.isArray(status.models) ? status.models : previousProvider.models;
  const activeModelId = models.some((model) => model.id === previousProvider.activeModelId)
    ? previousProvider.activeModelId
    : (models.find((model) => model.catalogDefault)?.id || models[0]?.id || "");
  const next = normalizeAiConfig({
    ...existing,
    activeModelId: existing.activeProvider === CODEX_PROVIDER_ID ? activeModelId : existing.activeModelId,
    providers: {
      ...existing.providers,
      [CODEX_PROVIDER_ID]: { ...previousProvider, activeModelId, models },
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

async function saveAiConfig(patch = {}) {
  const existing = await readAiConfig();
  const provider = resolveAiProvider(existing, patch.provider || existing.activeProvider);
  const previousProviderConfig = existing.providers[provider];
  const nextProviderLabel = previousProviderConfig.builtin
    ? previousProviderConfig.providerLabel
    : String(patch.providerLabel ?? previousProviderConfig.providerLabel).trim();
  if (!nextProviderLabel) throw new Error("请填写供应商名称");
  if (!previousProviderConfig.builtin && Object.values(existing.providers).some((item) => item.provider !== provider && item.providerLabel.toLocaleLowerCase() === nextProviderLabel.toLocaleLowerCase())) {
    throw new Error("供应商名称已存在");
  }
  const hasModelPatch = Boolean(patch.modelId || patch.model || (Array.isArray(patch.models) && patch.models.length));
  const modelId = hasModelPatch
    ? String(patch.modelId || previousProviderConfig.activeModelId || createAiModelId(provider, patch.model || previousProviderConfig.model)).trim()
    : "";
  const previousModels = Array.isArray(patch.models)
    ? patch.models.map((modelConfig, index) => normalizeAiModelConfig(provider, modelConfig, index))
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
  const nextModels = patch.clearApiKey
    ? updatedModels.map((model) => ({ ...model, testedOk: false, testedAt: "", testMessage: "" }))
    : updatedModels;
  const apiKey = patch.clearApiKey
    ? ""
    : (typeof patch.apiKey === "string" && patch.apiKey.trim() ? patch.apiKey : previousProviderConfig.apiKey);
  const next = normalizeAiConfig({
    ...existing,
    activeProvider: patch.activate === true ? provider : existing.activeProvider,
    activeModelId: patch.activate === true ? modelId : existing.activeModelId,
    providers: {
      ...existing.providers,
      [provider]: {
        ...previousProviderConfig,
        providerLabel: nextProviderLabel,
        baseUrl: patch.baseUrl ? normalizeProviderBaseUrl(patch.baseUrl) : previousProviderConfig.baseUrl,
        apiKey,
        activeModelId: patch.activate === true && modelId ? modelId : previousProviderConfig.activeModelId,
        models: nextModels,
      },
    },
  });
  await ensureParentDir(aiConfigPath());
  await fs.writeFile(aiConfigPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function normalizeProviderBaseUrl(value) {
  const baseUrl = String(value || "").trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("请输入有效的 Base URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Base URL 仅支持 HTTP 或 HTTPS");
  }
  if (/\/(chat\/completions|messages)$/i.test(parsed.pathname.replace(/\/+$/, ""))) {
    throw new Error("Base URL 不需要包含具体请求端点");
  }
  return baseUrl;
}

async function createAiProvider(input = {}) {
  const existing = await readAiConfig();
  const providerLabel = String(input.providerLabel || input.label || "").trim();
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
  await ensureParentDir(aiConfigPath());
  await fs.writeFile(aiConfigPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { config: next, provider };
}

async function deleteAiProvider(provider) {
  const existing = await readAiConfig();
  const providerConfig = existing.providers[provider];
  if (!providerConfig) {
    throw new Error("供应商不存在");
  }
  if (providerConfig.builtin || BUILTIN_AI_PROVIDERS[provider]) {
    throw new Error("内置供应商不可删除");
  }
  if (existing.activeProvider === provider) {
    throw new Error("请先切换默认供应商后再删除");
  }
  const providers = { ...existing.providers };
  delete providers[provider];
  const next = normalizeAiConfig({ ...existing, providers });
  await ensureParentDir(aiConfigPath());
  await fs.writeFile(aiConfigPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

async function updateAiProviderTestState(provider, modelId, testState) {
  const existing = await readAiConfig();
  const normalizedProvider = resolveAiProvider(existing, provider);
  const previousProviderConfig = existing.providers[normalizedProvider];
  const normalizedModelId = String(modelId || previousProviderConfig.activeModelId || createAiModelId(normalizedProvider, testState.model || previousProviderConfig.model)).trim();
  const previousModels = previousProviderConfig.models || [];
  const existingModel = previousModels.find((model) => model.id === normalizedModelId);
  const nextModel = normalizeAiModelConfig(normalizedProvider, {
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
      [normalizedProvider]: {
        ...previousProviderConfig,
        baseUrl: testState.baseUrl || previousProviderConfig.baseUrl,
        apiKey: testState.apiKey || previousProviderConfig.apiKey,
        models: nextModels,
      },
    },
  });
  await ensureParentDir(aiConfigPath());
  await fs.writeFile(aiConfigPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

async function readAiErrorBody(response) {
  try {
    const text = await response.text();
    return text.replace(/\s+/g, " ").slice(0, 500);
  } catch {
    return "";
  }
}

async function assertAiResponseOk(response) {
  if (response.ok) {
    return;
  }
  const details = await readAiErrorBody(response);
  throw new Error(`AI 请求失败 ${response.status}${details ? `：${details}` : ""}`);
}

function aiFetch(url, options) {
  return net.fetch(url, options);
}

async function testAiConfig(config) {
  if (!config.apiKey) {
    throw new Error("请先填写 API Key");
  }
  if (!config.model) {
    throw new Error("请先添加模型");
  }
  const request = buildAiRequest(config, [{ role: "user", content: "请只回复 OK" }], { test: true });
  const response = await aiFetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  await assertAiResponseOk(response);
  return { ok: true, message: "AI 连接可用" };
}

function normalizeAiMessages(payload = {}) {
  if (Array.isArray(payload.messages)) {
    const messages = payload.messages
      .map((message) => ({
        role: ["system", "user", "assistant"].includes(message?.role) ? message.role : "user",
        content: String(message?.content || "").slice(0, 200000),
      }))
      .filter((message) => message.content.trim());
    if (messages.length) {
      return messages;
    }
  }
  return [{ role: "user", content: String(payload.prompt || "") }];
}

async function streamAiCompletion(sender, requestId, config, messages, signal) {
  if (!config.apiKey) {
    throw new Error("请先在 AI 设置里填写 API Key");
  }
  const request = buildAiRequest(config, messages, { stream: true });
  const response = await aiFetch(request.url, {
    method: "POST",
    headers: request.headers,
    signal,
    body: JSON.stringify(request.body),
  });
  await assertAiResponseOk(response);
  if (!response.body) {
    const payload = await response.json();
    const delta = config.protocol === "anthropic"
      ? (payload?.content || []).filter((item) => item?.type === "text").map((item) => item.text || "").join("")
      : extractAiStreamEvent(config.protocol, payload).delta;
    if (delta) {
      sender.send("ai:chunk", { requestId, delta });
    }
    return mergeAiUsage(config.protocol, payload, null);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
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
        await writeAiDebugLog("ai:stream:parse-error", { message: error?.message, data: data.slice(0, 200) });
        continue;
      }
      usage = mergeAiUsage(config.protocol, payload, usage);
      const streamEvent = extractAiStreamEvent(config.protocol, payload);
      if (streamEvent.error) {
        throw new Error(streamEvent.error);
      }
      if (streamEvent.delta) {
        sender.send("ai:chunk", { requestId, delta: streamEvent.delta });
      }
      if (streamEvent.done) {
        return usage;
      }
    }
  }
  return usage;
}

async function streamCodexForPayload(event, requestId, config, messages, payload, controller) {
  let resolvedScope;
  if (payload?.codexScope) {
    resolvedScope = await resolveCodexScopeDirectory({
      scope: payload.codexScope,
      workspacePath: payload?.workspacePath,
      documentPath: payload?.documentPath,
      tempRoot: path.join(app.getPath("temp"), "PaperWriterCodex"),
    });
  } else {
    const candidates = [payload?.workspacePath, payload?.documentPath ? path.dirname(payload.documentPath) : ""].filter(Boolean);
    let cwd = "";
    for (const candidate of candidates) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isDirectory()) {
          cwd = candidate;
          break;
        }
      } catch { /* Continue with the legacy fallback order. */ }
    }
    cwd ||= path.join(app.getPath("userData"), "CodexWorkspace");
    await fs.mkdir(cwd, { recursive: true });
    resolvedScope = { cwd, scope: normalizeCodexScope(), cleanup: async () => {} };
  }
  let resolvedImages = { attachments: [], imagePaths: [], cleanup: async () => {} };
  try {
    if (normalizeCodexImageMode(payload?.codexImageMode) === "original" && Array.isArray(payload?.codexImages) && payload.codexImages.length) {
      resolvedImages = await materializeCodexImageAttachments({
        images: payload.codexImages,
        tempRoot: path.join(app.getPath("temp"), "PaperWriterCodex"),
        readProtocolAsset: async (sourceUrl) => {
          const parsed = parseAssetUrl(sourceUrl);
          if (!parsed) throw new Error("无效的信笺资源地址");
          return readPackagedAsset(parsed.filePath, parsed.assetPath);
        },
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
      onDelta: (delta) => event.sender.send("ai:chunk", { requestId, delta }),
    });
  } finally {
    await Promise.allSettled([resolvedImages.cleanup(), resolvedScope.cleanup()]);
  }
}

function sanitizeName(name, fallback = "未命名") {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || fallback;
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

function autosavePath() {
  return path.join(app.getPath("userData"), "Autosave", `autosave${DOCUMENT_EXTENSION}`);
}

function autosaveSessionPath(tabId = "") {
  const safeId = String(tabId || "tab").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "tab";
  return path.join(app.getPath("userData"), "Autosave", "Session", `${safeId}${DOCUMENT_EXTENSION}`);
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function isSupportedDocument(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === DOCUMENT_EXTENSION || extension === LEGACY_DOCUMENT_EXTENSION;
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
  const empty = createEmptyAiState();
  const optimize = state.optimize && typeof state.optimize === "object" ? state.optimize : {};
  const chat = state.chat && typeof state.chat === "object" ? state.chat : {};
  return {
    version: 3,
    lastMode: ["optimize", "chat"].includes(state.lastMode) ? state.lastMode : "",
    optimize: {
      ...empty.optimize,
      ...optimize,
      status: optimize.status === "done" || optimize.status === "error" ? optimize.status : "ready",
      output: typeof optimize.output === "string" ? optimize.output : "",
      error: typeof optimize.error === "string" ? optimize.error : "",
      assets: optimize.assets && typeof optimize.assets === "object"
        ? {
            images: optimize.assets.images && typeof optimize.assets.images === "object" ? optimize.assets.images : {},
            quotes: Array.isArray(optimize.assets.quotes) ? optimize.assets.quotes : [],
          }
        : empty.optimize.assets,
      elapsedSeconds: Number.isFinite(Number(optimize.elapsedSeconds)) ? Math.max(0, Number(optimize.elapsedSeconds)) : 0,
      tokenStats: optimize.tokenStats && typeof optimize.tokenStats === "object" ? optimize.tokenStats : null,
    },
    chat: {
      ...empty.chat,
      ...chat,
      messages: Array.isArray(chat.messages) ? chat.messages : [],
      input: typeof chat.input === "string" ? chat.input : "",
      selectedTexts: Array.isArray(chat.selectedTexts) ? chat.selectedTexts : [],
      codexScope: normalizeCodexScope(chat.codexScope),
      codexImageMode: normalizeCodexImageMode(chat.codexImageMode),
      status: chat.status === "error" ? "error" : "idle",
      error: typeof chat.error === "string" ? chat.error : "",
    },
  };
}

function normalizeAssetPath(assetPath) {
  const normalized = String(assetPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith("assets/") || normalized.includes("..") || path.isAbsolute(normalized)) {
    return "";
  }
  return normalized;
}

function assetUrlForDocument(filePath, assetPath) {
  const normalizedAssetPath = normalizeAssetPath(assetPath);
  if (!filePath || !normalizedAssetPath) {
    return assetPath;
  }
  return `${ASSET_PROTOCOL}://document/${encodeURIComponent(String(filePath))}?asset=${encodeURIComponent(normalizedAssetPath)}`;
}

function parseAssetUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== `${ASSET_PROTOCOL}:`) {
      return null;
    }
    const filePath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const assetPath = normalizeAssetPath(decodeURIComponent(url.searchParams.get("asset") || ""));
    if (!filePath || !assetPath || !isSupportedDocument(filePath)) {
      return null;
    }
    return { filePath, assetPath };
  } catch {
    return null;
  }
}

function rememberAssetZip(filePath, stat, zip) {
  const key = String(filePath || "");
  if (!key || !stat || !zip) {
    return;
  }
  assetZipCache.set(key, {
    zip,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    lastAccess: Date.now(),
  });
  if (assetZipCache.size <= ASSET_ZIP_CACHE_LIMIT) {
    return;
  }
  const oldest = [...assetZipCache.entries()]
    .sort((left, right) => left[1].lastAccess - right[1].lastAccess)[0]?.[0];
  if (oldest) {
    assetZipCache.delete(oldest);
  }
}

async function getAssetZip(filePath) {
  const sourcePath = String(filePath || "");
  if (!sourcePath || !isSupportedDocument(sourcePath)) {
    throw new Error("无效的信笺资源路径");
  }
  const stat = await fs.stat(sourcePath);
  const cached = assetZipCache.get(sourcePath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    cached.lastAccess = Date.now();
    return cached.zip;
  }
  const buffer = await fs.readFile(sourcePath);
  const zip = await JSZip.loadAsync(buffer);
  rememberAssetZip(sourcePath, stat, zip);
  return zip;
}

async function readPackagedAsset(filePath, assetPath) {
  const normalizedAssetPath = normalizeAssetPath(assetPath);
  if (!normalizedAssetPath) {
    throw new Error("无效的资源路径");
  }
  const zip = await getAssetZip(filePath);
  const file = zip.file(normalizedAssetPath);
  if (!file) {
    throw new Error("资源不存在");
  }
  const buffer = await file.async("nodebuffer");
  return {
    buffer,
    mime: mimeFromPath(normalizedAssetPath),
  };
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

function normalizeDocument(document = {}) {
  const now = new Date().toISOString();
  const createdAt = typeof document.createdAt === "string" && document.createdAt
    ? document.createdAt
    : (typeof document.updatedAt === "string" && document.updatedAt ? document.updatedAt : now);
  return {
    version: 1,
    title: typeof document.title === "string" && document.title.trim() ? document.title.trim() : "未命名信笺",
    author: typeof document.author === "string" ? document.author.trim().slice(0, 40) : "",
    html: typeof document.html === "string" && document.html.trim() ? document.html : "<p></p>",
    letterTemplateId: typeof document.letterTemplateId === "string" && document.letterTemplateId
      ? document.letterTemplateId
      : "",
    templateId: typeof document.templateId === "string" && document.templateId ? document.templateId : "warm",
    fontFamily: typeof document.fontFamily === "string" && document.fontFamily ? document.fontFamily : "LXGW WenKai Screen",
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
  };
}

function normalizeDocumentComments(comments = []) {
  if (!Array.isArray(comments)) {
    return [];
  }
  const seen = new Set();
  return comments
    .map((comment, index) => {
      const from = Math.max(1, Math.floor(Number(comment?.from) || 0));
      const to = Math.max(1, Math.floor(Number(comment?.to) || 0));
      const text = typeof comment?.text === "string" ? comment.text.trim().slice(0, 2000) : "";
      if (!text || from === to) {
        return null;
      }
      const fallbackId = `comment-${Date.now().toString(36)}-${index}`;
      const idSource = typeof comment?.id === "string" && comment.id.trim() ? comment.id.trim() : fallbackId;
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

function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    return null;
  }

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function extensionFromMime(mime) {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/bmp":
      return ".bmp";
    case "image/svg+xml":
      return ".svg";
    case "audio/mpeg":
      return ".mp3";
    case "audio/wav":
    case "audio/x-wav":
      return ".wav";
    case "audio/ogg":
      return ".ogg";
    case "audio/mp4":
    case "audio/x-m4a":
      return ".m4a";
    case "audio/aac":
      return ".aac";
    case "audio/flac":
      return ".flac";
    case "video/webm":
      return ".webm";
    case "video/ogg":
      return ".ogv";
    case "video/mp4":
      return ".mp4";
    default:
      return ".png";
  }
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

async function fileToDataUrl(filePath) {
  const buffer = await fs.readFile(filePath);
  return `data:${mimeFromPath(filePath)};base64,${buffer.toString("base64")}`;
}

function extractDataImages(zip, html) {
  return html.replace(DATA_URL_PATTERN, (full, quote, dataUrl) => {
    const decoded = dataUrlToBuffer(dataUrl);
    if (!decoded) {
      return full;
    }

    const assetPath = nextZipAssetPath(zip, "", extensionFromMime(decoded.mime));
    zip.file(assetPath, decoded.buffer, /^(?:audio|video)\//i.test(decoded.mime) ? { compression: "STORE" } : undefined);
    return `src=${quote}${assetPath}${quote}`;
  });
}

async function extractProtocolImages(zip, html) {
  const matches = [...html.matchAll(ASSET_PROTOCOL_URL_PATTERN)];
  const sourceUrls = [...new Set(matches.map((match) => match[2]))];
  const copiedByUrl = new Map();
  for (const sourceUrl of sourceUrls) {
    const parsed = parseAssetUrl(sourceUrl);
    if (!parsed) {
      continue;
    }
    const asset = await readPackagedAsset(parsed.filePath, parsed.assetPath);
    const targetPath = nextZipAssetPath(zip, parsed.assetPath, path.extname(parsed.assetPath) || extensionFromMime(asset.mime));
    zip.file(targetPath, asset.buffer, /^(?:audio|video)\//i.test(asset.mime) ? { compression: "STORE" } : undefined);
    copiedByUrl.set(sourceUrl, targetPath);
  }
  return html.replace(ASSET_PROTOCOL_URL_PATTERN, (full, quote, sourceUrl) => {
    const targetPath = copiedByUrl.get(sourceUrl);
    return targetPath ? `src=${quote}${targetPath}${quote}` : full;
  });
}

async function copyProtocolAssetToZip(zip, sourceUrl, preferredPath = "") {
  const parsed = parseAssetUrl(sourceUrl);
  if (!parsed) {
    return "";
  }
  const asset = await readPackagedAsset(parsed.filePath, parsed.assetPath);
  const targetPath = nextZipAssetPath(zip, preferredPath || parsed.assetPath, path.extname(parsed.assetPath) || extensionFromMime(asset.mime));
  zip.file(targetPath, asset.buffer, /^(?:audio|video)\//i.test(asset.mime) ? { compression: "STORE" } : undefined);
  return targetPath;
}

function linkAssetImages(filePath, html, metrics = null) {
  const matches = [...html.matchAll(ASSET_URL_PATTERN)];
  const linked = html.replace(ASSET_URL_PATTERN, (full, quote, assetPath) => {
    const normalizedAssetPath = normalizeAssetPath(assetPath);
    return normalizedAssetPath ? `src=${quote}${assetUrlForDocument(filePath, normalizedAssetPath)}${quote}` : full;
  });
  if (metrics) {
    metrics.assetReferences = matches.length;
    metrics.linkedAssets = new Set(matches.map((match) => normalizeAssetPath(match[2])).filter(Boolean)).size;
  }
  return linked;
}

async function packageAiStateAssets(zip, aiState) {
  const normalized = normalizeSavedAiState(aiState);
  const images = normalized.optimize?.assets?.images || {};
  const nextImages = {};
  for (const [key, image] of Object.entries(images)) {
    const nextImage = { ...image };
    if (typeof nextImage.src === "string" && nextImage.src.startsWith(`${ASSET_PROTOCOL}://`)) {
      const copiedPath = await copyProtocolAssetToZip(zip, nextImage.src, "");
      if (copiedPath) {
        nextImage.src = copiedPath;
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
  const nextImages = {};
  Object.entries(images).forEach(([key, image]) => {
    const nextImage = { ...image };
    if (typeof nextImage.src === "string" && normalizeAssetPath(nextImage.src)) {
      nextImage.src = assetUrlForDocument(filePath, nextImage.src);
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

async function savePaperDocument(filePath, document) {
  const normalized = normalizeDocument(document);
  const zip = new JSZip();
  const packagedDocument = { ...normalized };

  packagedDocument.html = await extractProtocolImages(zip, packagedDocument.html);
  packagedDocument.html = extractDataImages(zip, packagedDocument.html);
  if (packagedDocument.customBackground?.startsWith(`${ASSET_PROTOCOL}://`)) {
    packagedDocument.customBackground = await copyProtocolAssetToZip(zip, packagedDocument.customBackground, "assets/background.png");
  }
  if (packagedDocument.customBackground?.startsWith("data:")) {
    const decoded = dataUrlToBuffer(packagedDocument.customBackground);
    if (decoded) {
      const backgroundPath = nextZipAssetPath(zip, `assets/background${extensionFromMime(decoded.mime)}`, extensionFromMime(decoded.mime));
      zip.file(backgroundPath, decoded.buffer);
      packagedDocument.customBackground = backgroundPath;
    }
  }
  packagedDocument.aiState = await packageAiStateAssets(zip, packagedDocument.aiState);

  zip.file("document.json", JSON.stringify(packagedDocument, null, 2));
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, output);
}

async function loadPaperDocument(filePath, metrics = null) {
  const startedAt = Date.now();
  const buffer = await fs.readFile(filePath);
  let sourceStat = null;
  try {
    sourceStat = await fs.stat(filePath);
  } catch {
    sourceStat = null;
  }
  if (metrics) {
    metrics.readMs = Date.now() - startedAt;
    metrics.fileBytes = buffer.byteLength;
  }
  const zipStartedAt = Date.now();
  const zip = await JSZip.loadAsync(buffer);
  rememberAssetZip(filePath, sourceStat, zip);
  if (metrics) {
    metrics.zipLoadMs = Date.now() - zipStartedAt;
  }
  const documentFile = zip.file("document.json");
  if (!documentFile) {
    throw new Error("这个信笺文档缺少 document.json。");
  }

  const jsonStartedAt = Date.now();
  const raw = await documentFile.async("string");
  const parsedDocument = JSON.parse(raw);
  if (metrics) {
    metrics.jsonMs = Date.now() - jsonStartedAt;
    metrics.documentJsonBytes = Buffer.byteLength(raw, "utf8");
  }
  if (!parsedDocument.createdAt) {
    try {
      const stat = await fs.stat(filePath);
      parsedDocument.createdAt = stat.birthtime?.toISOString?.() || stat.ctime?.toISOString?.() || parsedDocument.updatedAt;
    } catch {
      // Fall back to updatedAt in normalizeDocument.
    }
  }
  const document = normalizeDocument(parsedDocument);
  const assetLinkStartedAt = Date.now();
  document.html = linkAssetImages(filePath, document.html, metrics);
  if (metrics) {
    metrics.assetLinkMs = Date.now() - assetLinkStartedAt;
    metrics.htmlBytes = Buffer.byteLength(document.html, "utf8");
  }

  if (document.customBackground && !document.customBackground.startsWith("data:")) {
    document.customBackground = assetUrlForDocument(filePath, document.customBackground);
  }
  document.aiState = linkAiStateAssets(filePath, document.aiState);

  if (metrics) {
    metrics.totalMs = Date.now() - startedAt;
  }
  return document;
}

ipcMain.handle("app:get-paths", async () => {
  await fs.mkdir(defaultDocumentsDir(), { recursive: true });
  await fs.mkdir(path.dirname(autosavePath()), { recursive: true });
  return {
    desktop: app.getPath("desktop"),
    documents: defaultDocumentsDir(),
    autosave: autosavePath(),
    userData: app.getPath("userData"),
    aiDebugLog: aiDebugLogPath(),
  };
});

ipcMain.handle("debug:log", async (_event, event, data) => {
  const logPath = await writeAiDebugLog(String(event || "renderer"), data || {});
  return { ok: true, path: logPath || aiDebugLogPath() };
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
      mainWindow?.webContents.send("ai:codex-status", config);
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
  try {
    const existing = initial;
    const previousProviderConfig = existing.providers[provider];
    const modelId = String(patch?.modelId || previousProviderConfig.activeModelId || createAiModelId(provider, patch?.model || previousProviderConfig.model)).trim();
    const previousModelConfig = previousProviderConfig.models.find((model) => model.id === modelId) || previousProviderConfig.models[0];
    const config = {
      provider,
      providerLabel: previousProviderConfig.providerLabel,
      protocol: previousProviderConfig.protocol,
      builtin: previousProviderConfig.builtin,
      modelId,
      modelName: patch?.modelName || previousModelConfig?.name,
      model: patch?.model || previousModelConfig?.model || previousProviderConfig.model,
      baseUrl: patch?.baseUrl || previousProviderConfig.baseUrl,
      apiKey: typeof patch?.apiKey === "string" && patch.apiKey.trim() ? patch.apiKey : previousProviderConfig.apiKey,
    };
    await testAiConfig(config);
    const next = await updateAiProviderTestState(provider, modelId, {
      modelName: config.modelName,
      model: config.model,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      testedOk: true,
      testedAt: new Date().toISOString(),
      testMessage: "AI 连接可用",
    });
    await writeAiDebugLog("ai:test:success", { provider: config.provider, model: config.model });
    return { ...publicAiConfigWithRuntime(next), ok: true, message: "AI 连接可用" };
  } catch (error) {
    const existing = await readAiConfig();
    const previousProviderConfig = existing.providers[provider];
    const modelId = String(patch?.modelId || previousProviderConfig.activeModelId || createAiModelId(provider, patch?.model || previousProviderConfig.model)).trim();
    const previousModelConfig = previousProviderConfig.models.find((model) => model.id === modelId) || previousProviderConfig.models[0];
    const next = await updateAiProviderTestState(provider, modelId, {
      modelName: patch?.modelName || previousModelConfig?.name,
      model: patch?.model || previousModelConfig?.model || previousProviderConfig.model,
      baseUrl: patch?.baseUrl || previousProviderConfig.baseUrl,
      apiKey: typeof patch?.apiKey === "string" && patch.apiKey.trim() ? patch.apiKey : previousProviderConfig.apiKey,
      testedOk: false,
      testedAt: new Date().toISOString(),
      testMessage: error?.message || "AI 连接失败",
    });
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
  if (!requestId || !messages.some((message) => message.content.trim())) {
    return { ok: false, message: "AI 请求缺少内容" };
  }
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
      event.sender.send("ai:done", { requestId, usage });
      activeAiRequests.delete(requestId);
    })
    .catch(async (error) => {
      const aborted = controller.signal.aborted;
      await writeAiDebugLog("ai:generate:error", { requestId, aborted, message: error?.message });
      event.sender.send("ai:error", {
        requestId,
        message: aborted ? "已停止生成" : (error?.message || "AI 生成失败"),
        aborted,
      });
      activeAiRequests.delete(requestId);
    });
  return { ok: true, requestId };
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
  await fs.writeFile(result.filePath, String(payload?.markdown || ""), "utf8");
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
  autoUpdater.quitAndInstall(false, true);
  return updateState;
});

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

  const filePath = result.filePaths[0];
  const metrics = {};
  const document = await loadPaperDocument(filePath, metrics);
  await writeAiDebugLog("document:open:loaded", { filePath, ...metrics });
  return { canceled: false, path: filePath, document };
});

ipcMain.handle("document:open-path", async (_event, filePath) => {
  if (!filePath) {
    return { canceled: true };
  }
  if (!isSupportedDocument(filePath)) {
    return { canceled: true };
  }
  try {
    const metrics = {};
    const document = await loadPaperDocument(filePath, metrics);
    await writeAiDebugLog("document:open-path:loaded", { filePath, ...metrics });
    return { canceled: false, path: filePath, document };
  } catch (error) {
    await writeAiDebugLog("document:open-path:error", {
      filePath,
      message: error?.message,
      code: error?.code,
    });
    return { canceled: true };
  }
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

  return { canceled: false, ...(await listFolderEntries(result.filePaths[0])) };
});

ipcMain.handle("folder:list", async (_event, folderPath) => {
  const startedAt = Date.now();
  if (!folderPath) {
    await writeAiDebugLog("folder:list:empty-path");
    return { canceled: true, files: [], folders: [], entries: [] };
  }
  try {
    await writeAiDebugLog("folder:list:start", { folderPath });
    const listed = await listFolderEntries(folderPath);
    await writeAiDebugLog("folder:list:success", {
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
  clipboard.writeText(String(folderPath));
  return { ok: true };
});

ipcMain.handle("folder:show", async (_event, folderPath) => {
  if (!folderPath) {
    return { ok: false };
  }
  const error = await shell.openPath(String(folderPath));
  return { ok: !error, error };
});

ipcMain.handle("folder:create", async (_event, parentPath, name) => {
  if (!parentPath) {
    return { ok: false, message: "缺少目标文件夹" };
  }
  const folderName = sanitizeName(name, "新建文件夹");
  const targetPath = await uniquePath(path.join(String(parentPath), folderName));
  await fs.mkdir(targetPath, { recursive: false });
  return { ok: true, path: targetPath, ...(await listFolderEntries(String(parentPath))) };
});

ipcMain.handle("document:create-in-folder", async (_event, folderPath, title, templateDocument = {}) => {
  if (!folderPath) {
    return { ok: false, message: "缺少目标文件夹" };
  }
  const safeTitle = sanitizeName(title, "未命名信笺");
  const filePath = await uniquePath(path.join(String(folderPath), `${safeTitle}${DOCUMENT_EXTENSION}`));
  const document = normalizeDocument({
    ...templateDocument,
    title: safeTitle,
    html: "<p></p>",
  });
  await savePaperDocument(filePath, document);
  return { ok: true, path: filePath, document, ...(await listFolderEntries(String(folderPath))) };
});

ipcMain.handle("entry:rename", async (_event, targetPath, nextName) => {
  if (!targetPath) {
    return { ok: false, message: "缺少目标路径" };
  }
  const currentPath = String(targetPath);
  const stat = await fs.stat(currentPath);
  const parsed = path.parse(currentPath);
  let safeName = sanitizeName(nextName, parsed.name);
  if (stat.isFile() && isSupportedDocument(currentPath)) {
    const typedExtension = path.extname(safeName).toLowerCase();
    if (typedExtension === DOCUMENT_EXTENSION || typedExtension === LEGACY_DOCUMENT_EXTENSION) {
      safeName = path.basename(safeName, typedExtension);
    }
  }
  const nextPath = path.join(parsed.dir, stat.isFile() && isSupportedDocument(currentPath) ? `${safeName}${DOCUMENT_EXTENSION}` : safeName);
  if (nextPath === currentPath) {
    return { ok: true, path: currentPath, ...(await listFolderEntries(parsed.dir)) };
  }
  try {
    await fs.access(nextPath);
    return { ok: false, message: "同名项目已经存在" };
  } catch {
    await fs.rename(currentPath, nextPath);
    return { ok: true, oldPath: currentPath, path: nextPath, ...(await listFolderEntries(parsed.dir)) };
  }
});

ipcMain.handle("entry:delete", async (_event, targetPath) => {
  if (!targetPath) {
    return { ok: false, message: "缺少目标路径" };
  }
  const currentPath = String(targetPath);
  const parentPath = path.dirname(currentPath);
  if (typeof shell.trashItem === "function") {
    await shell.trashItem(currentPath);
  } else {
    const stat = await fs.stat(currentPath);
    await fs.rm(currentPath, { recursive: stat.isDirectory(), force: true });
  }
  return { ok: true, deletedPath: currentPath, ...(await listFolderEntries(parentPath)) };
});

ipcMain.handle("entry:move", async (_event, sourcePath, targetFolderPath) => {
  if (!sourcePath || !targetFolderPath) {
    return { ok: false, message: "缺少移动路径" };
  }
  const fromPath = String(sourcePath);
  const toFolder = String(targetFolderPath);
  const sourceStat = await fs.stat(fromPath);
  const targetStat = await fs.stat(toFolder);
  if (!targetStat.isDirectory()) {
    return { ok: false, message: "目标不是文件夹" };
  }
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
  return {
    ok: true,
    oldPath: fromPath,
    path: targetPath,
    sourceParent,
    targetFolderPath: toFolder,
  };
});

ipcMain.handle("document:backup", async (_event, filePath) => {
  if (!filePath || !isSupportedDocument(filePath)) {
    return { ok: false, message: "只能备份信笺文件" };
  }
  const sourcePath = String(filePath);
  const parsed = path.parse(sourcePath);
  const backupPath = await uniquePath(path.join(parsed.dir, `${parsed.name}_备份_${timestampForFileName()}${DOCUMENT_EXTENSION}`));
  await fs.copyFile(sourcePath, backupPath);
  return { ok: true, path: backupPath, ...(await listFolderEntries(parsed.dir)) };
});

async function listFolderEntries(folderPath) {
  const startedAt = Date.now();
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  await writeAiDebugLog("folder:entries:readdir", {
    folderPath,
    ms: Date.now() - startedAt,
    count: entries.length,
  });
  const parent = path.dirname(folderPath);
  const parentPath = parent && parent !== folderPath ? parent : "";
  const folders = [];
  const fileReads = [];
  for (const entry of entries) {
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

    fileReads.push((async () => {
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
    })());
  }

  const files = (await Promise.all(fileReads)).filter(Boolean);
  folders.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  files.sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
  return {
    folderPath,
    parentPath,
    folders,
    files,
    entries: [...folders, ...files],
  };
}

ipcMain.handle("document:save", async (_event, document, currentPath, saveAs) => {
  let filePath = currentPath;
  if (saveAs || !filePath) {
    const safeTitle = normalizeDocument(document).title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "未命名信笺";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "保存信笺",
      defaultPath: path.join(defaultDocumentsDir(), `${safeTitle}${DOCUMENT_EXTENSION}`),
      filters: DOCUMENT_FILTERS,
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    filePath = isSupportedDocument(result.filePath) ? result.filePath : ensureExtension(result.filePath, DOCUMENT_EXTENSION);
  }

  await savePaperDocument(filePath, document);
  return { canceled: false, path: filePath };
});

function exportSafeName(suggestedName) {
  return String(suggestedName || "未命名信笺").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "未命名信笺";
}

async function pickDocumentExportPath(format, suggestedName) {
  const safeName = exportSafeName(suggestedName);
  if (format === "images") {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择分页图片导出文件夹",
      defaultPath: path.join(defaultDocumentsDir(), safeName),
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled || !result.filePaths?.[0]
      ? { canceled: true }
      : { canceled: false, path: result.filePaths[0], format: "images" };
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "选择 PDF 导出位置",
    defaultPath: path.join(defaultDocumentsDir(), `${safeName}.pdf`),
    filters: [
      { name: "PDF 文档", extensions: ["pdf"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  return result.canceled || !result.filePath
    ? { canceled: true }
    : { canceled: false, path: ensureExtension(result.filePath, ".pdf"), format: "pdf" };
}

function sendExportProgress(event, payload) {
  if (!event?.sender?.isDestroyed?.()) {
    event.sender.send("document:export-progress", payload);
  }
}

ipcMain.handle("document:pick-export-path", async (_event, format, suggestedName) => (
  pickDocumentExportPath(format === "images" ? "images" : "pdf", suggestedName)
));

ipcMain.handle("document:export-pdf", async (event, suggestedName, targetPath) => {
  const safeName = String(suggestedName || "未命名信笺").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "未命名信笺";
  const destination = targetPath
    ? { canceled: false, path: ensureExtension(String(targetPath), ".pdf") }
    : await pickDocumentExportPath("pdf", safeName);
  if (destination.canceled || !destination.path) {
    return { canceled: true };
  }

  const filePath = destination.path;
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
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, pdf);
  sendExportProgress(event, { format: "pdf", percent: 100, message: "PDF 导出完成" });
  return { canceled: false, path: filePath };
});

ipcMain.handle("document:export-page-images", async (event, suggestedName, pageRects, targetPath) => {
  const safeName = String(suggestedName || "未命名信笺").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "未命名信笺";
  const rects = Array.isArray(pageRects)
    ? pageRects
        .map((rect) => ({
          x: Number(rect.x),
          y: Number(rect.y),
          width: Number(rect.width),
          height: Number(rect.height),
        }))
        .filter((rect) => rect.width > 0 && rect.height > 0)
    : [];

  if (!rects.length) {
    return { canceled: true };
  }

  const destination = targetPath
    ? { canceled: false, path: String(targetPath) }
    : await pickDocumentExportPath("images", safeName);
  if (destination.canceled || !destination.path) {
    return { canceled: true };
  }

  const outputDir = destination.path;
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
      await fs.writeFile(filePath, Buffer.from(capture.data, "base64"));
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
    return {
      canceled: false,
      kind,
      path: filePath,
      name: path.basename(filePath, path.extname(filePath)),
      fileName: path.basename(filePath),
      mime: mimeFromPath(filePath),
      size: stat.size,
      dataUrl: await fileToDataUrl(filePath),
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
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  return {
    canceled: false,
    path: filePath,
    name: path.basename(filePath, path.extname(filePath)),
    dataUrl: await fileToDataUrl(filePath),
  };
});

ipcMain.handle("asset:pick-audio", async () => pickLocalMediaAsset("audio"));
ipcMain.handle("asset:pick-video", async () => pickLocalMediaAsset("video"));

ipcMain.handle("external:open", async (_event, urlValue) => {
  try {
    const url = new URL(String(urlValue || ""));
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
  await savePaperDocument(filePath, document);
  return { path: filePath };
});

ipcMain.handle("autosave:save-tab", async (_event, document, tabId) => {
  const filePath = autosaveSessionPath(tabId);
  await savePaperDocument(filePath, document);
  return { canceled: false, path: filePath };
});

ipcMain.handle("autosave:clear", async () => {
  try {
    await fs.rm(autosavePath(), { force: true });
  } catch {
    // No-op.
  }
  return { ok: true };
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
  mainWindow?.close();
  return { ok: true };
});

ipcMain.handle("app:close-canceled", async () => {
  closeRequestInFlight = false;
  return { ok: true };
});

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("PaperWriter.Electron");
  }
  registerAssetProtocol();
  createWindow();
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
