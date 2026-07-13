import {
  BROWSER_AI_PROTOCOLS,
  MAX_BROWSER_AI_MODELS,
  MAX_BROWSER_AI_PROVIDERS,
  browserModelId,
  hasOwn,
  normalizeBrowserAiConfig as normalizeBrowserAiConfigValue,
  normalizeBrowserExternalUrl,
  normalizeBrowserModelConfig,
  publicBrowserAiConfig as publicBrowserAiConfigValue,
  safeBrowserProviderId,
} from "./browser-ai-config.js";

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function assertBrowserResourcesArePersistable(document = {}) {
  const html = typeof document?.html === "string" ? document.html : "";
  const customBackground = typeof document?.customBackground === "string" ? document.customBackground : "";
  const aiImages = document?.aiState?.optimize?.assets?.images;
  const imageSources = aiImages && typeof aiImages === "object"
    ? Object.values(aiImages).map((image) => image?.src)
    : [];
  if (/\bsrc=(["'])blob:[^"']+\1/i.test(html) || /^blob:/i.test(customBackground) || imageSources.some((source) => /^blob:/i.test(String(source || "")))) {
    throw new Error("文档包含仅在当前页面有效的临时图片；请重新选择图片后再保存");
  }
}

function pickFileInBrowser({ kind, accept, maxBytes = 0, allowedExtensions = [] }) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ canceled: true });
        return;
      }
      const extension = file.name.toLowerCase().split(".").pop();
      if (allowedExtensions.length && !allowedExtensions.includes(extension)) {
        resolve({ canceled: false, error: "unsupported-type", kind, extension });
        return;
      }
      if (maxBytes && file.size > maxBytes) {
        resolve({ canceled: false, error: "too-large", kind, size: file.size, maxBytes });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          canceled: false,
          kind,
          name: file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          path: file.name,
          mime: file.type,
          size: file.size,
          dataUrl: reader.result,
        });
      };
      reader.onerror = () => resolve({ canceled: false, error: "read-failed", kind });
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

function pickImageInBrowser() {
  return pickFileInBrowser({
    kind: "image",
    accept: "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml,image/avif",
  });
}

function pickAudioInBrowser() {
  return pickFileInBrowser({
    kind: "audio",
    accept: ".mp3,.wav,.ogg,.m4a,.aac,.flac,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/flac",
    maxBytes: 20 * 1024 * 1024,
    allowedExtensions: ["mp3", "wav", "ogg", "m4a", "aac", "flac"],
  });
}

function pickVideoInBrowser() {
  return pickFileInBrowser({
    kind: "video",
    accept: ".mp4,.webm,.ogv,video/mp4,video/webm,video/ogg",
    maxBytes: 100 * 1024 * 1024,
    allowedExtensions: ["mp4", "webm", "ogv"],
  });
}

const browserAiListeners = {
  chunk: new Set(),
  done: new Set(),
  error: new Set(),
};
const browserExportProgressListeners = new Set();

function emitBrowserAi(type, payload) {
  browserAiListeners[type]?.forEach((callback) => callback(payload));
}

function emitBrowserExportProgress(payload) {
  browserExportProgressListeners.forEach((callback) => callback(payload));
}

function waitForBrowserPreview(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeBrowserAiConfig(config = readJson("paperwriter.aiConfig", {})) {
  return normalizeBrowserAiConfigValue(config);
}

function publicBrowserAiConfig(config = readJson("paperwriter.aiConfig", {})) {
  return publicBrowserAiConfigValue(config);
}

const browserBridge = {
  isElectron: false,
  getPaths: async () => ({
    desktop: "Browser preview",
    documents: "Browser preview",
    autosave: "localStorage:paperwriter.autosave",
    userData: "localStorage",
    aiDebugLog: "Browser preview",
  }),
  debugLog: async (event, data) => {
    console.debug("[paperwriter-debug]", event, data);
    return { ok: true };
  },
  setWindowModalOverlay: async () => ({ ok: true }),
  getAiConfig: async () => publicBrowserAiConfig(),
  refreshCodexCliStatus: async () => ({ ...publicBrowserAiConfig(), ok: false, message: "Codex CLI 仅在桌面端可用" }),
  startCodexCliLogin: async () => ({ ...publicBrowserAiConfig(), ok: false, message: "Codex CLI 仅在桌面端可用" }),
  onCodexCliStatus: () => () => {},
  createAiProvider: async (input = {}) => {
    const previous = normalizeBrowserAiConfig();
    if (Object.keys(previous.providers).length >= MAX_BROWSER_AI_PROVIDERS) throw new Error("供应商数量已达上限");
    const providerLabel = String(input.providerLabel || input.label || "").slice(0, 120).trim();
    if (!providerLabel) throw new Error("请填写供应商名称");
    if (Object.values(previous.providers).some((provider) => provider.providerLabel.toLocaleLowerCase() === providerLabel.toLocaleLowerCase())) {
      throw new Error("供应商名称已存在");
    }
    const protocol = hasOwn(BROWSER_AI_PROTOCOLS, input.protocol) ? input.protocol : "openai";
    const baseUrl = String(input.baseUrl || BROWSER_AI_PROTOCOLS[protocol].baseUrl).slice(0, 2048).trim().replace(/\/+$/, "");
    let parsed;
    try { parsed = new URL(baseUrl); } catch { throw new Error("请输入有效的 Base URL"); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Base URL 仅支持 HTTP 或 HTTPS");
    if (/\/(chat\/completions|messages)$/i.test(parsed.pathname.replace(/\/+$/, ""))) throw new Error("Base URL 不需要包含具体请求端点");
    const provider = `custom-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
    const next = normalizeBrowserAiConfig({
      ...previous,
      providers: { ...previous.providers, [provider]: { provider, providerLabel, protocol, builtin: false, baseUrl, apiKey: "", activeModelId: "", models: [] } },
    });
    writeJson("paperwriter.aiConfig", next);
    return { ...publicBrowserAiConfig(next), createdProvider: provider, ok: true };
  },
  deleteAiProvider: async (provider) => {
    const previous = normalizeBrowserAiConfig();
    const safeProvider = safeBrowserProviderId(provider);
    const target = safeProvider && hasOwn(previous.providers, safeProvider) ? previous.providers[safeProvider] : null;
    if (!target) throw new Error("供应商不存在");
    if (target.builtin) throw new Error("内置供应商不可删除");
    if (previous.activeProvider === safeProvider) throw new Error("请先切换默认供应商后再删除");
    const providers = Object.assign(Object.create(null), previous.providers);
    delete providers[safeProvider];
    const next = normalizeBrowserAiConfig({ ...previous, providers });
    writeJson("paperwriter.aiConfig", next);
    return { ...publicBrowserAiConfig(next), ok: true };
  },
  saveAiConfig: async (config = {}) => {
    const previous = normalizeBrowserAiConfig();
    const requestedProvider = safeBrowserProviderId(config.provider);
    const provider = requestedProvider && hasOwn(previous.providers, requestedProvider) ? requestedProvider : previous.activeProvider;
    const providerPrevious = previous.providers[provider];
    const nextProviderLabel = providerPrevious.builtin ? providerPrevious.providerLabel : String(config.providerLabel ?? providerPrevious.providerLabel).slice(0, 120).trim();
    if (!nextProviderLabel) throw new Error("请填写供应商名称");
    if (!providerPrevious.builtin && Object.values(previous.providers).some((item) => item.provider !== provider && item.providerLabel.toLocaleLowerCase() === nextProviderLabel.toLocaleLowerCase())) throw new Error("供应商名称已存在");
    const hasModelPatch = Boolean(config.modelId || config.model || (Array.isArray(config.models) && config.models.length));
    const modelId = hasModelPatch ? (config.modelId || providerPrevious.activeModelId || browserModelId(provider, config.model || providerPrevious.model)) : "";
    const previousModels = Array.isArray(config.models)
      ? config.models.slice(0, MAX_BROWSER_AI_MODELS).map((model, index) => normalizeBrowserModelConfig(provider, model, index))
      : providerPrevious.models;
    const existingModel = previousModels.find((model) => model.id === modelId);
    const nextModel = hasModelPatch ? normalizeBrowserModelConfig(provider, {
      ...(existingModel || {}),
      id: modelId,
      name: config.modelName || existingModel?.name,
      model: config.model || existingModel?.model,
      testedOk: (config.resetTest || config.clearApiKey) ? false : existingModel?.testedOk,
      testedAt: (config.resetTest || config.clearApiKey) ? "" : existingModel?.testedAt,
      testMessage: (config.resetTest || config.clearApiKey) ? "" : existingModel?.testMessage,
    }) : null;
    const updatedModels = !nextModel ? previousModels : (existingModel
      ? previousModels.map((model) => (model.id === modelId ? nextModel : model))
      : [...previousModels, nextModel]);
    const nextModels = config.clearApiKey
      ? updatedModels.map((model) => ({ ...model, testedOk: false, testedAt: "", testMessage: "" }))
      : updatedModels;
    const next = normalizeBrowserAiConfig({
      activeProvider: config.activate === true ? provider : previous.activeProvider,
      activeModelId: config.activate === true ? modelId : previous.activeModelId,
      providers: {
        ...previous.providers,
        [provider]: {
          ...providerPrevious,
          providerLabel: nextProviderLabel,
          baseUrl: typeof config.baseUrl === "string" ? config.baseUrl.slice(0, 2048) : providerPrevious.baseUrl,
          apiKey: config.clearApiKey ? "" : ((typeof config.apiKey === "string" ? config.apiKey.slice(0, 16384).trim() : "") || providerPrevious.apiKey || ""),
          activeModelId: config.activate === true ? modelId : providerPrevious.activeModelId,
          models: nextModels,
        },
      },
    });
    writeJson("paperwriter.aiConfig", next);
    return publicBrowserAiConfig(next);
  },
  testAiConfig: async (config = {}) => {
    const saved = normalizeBrowserAiConfig();
    const requestedProvider = safeBrowserProviderId(config.provider);
    const provider = requestedProvider && hasOwn(saved.providers, requestedProvider) ? requestedProvider : saved.activeProvider || "gemini";
    const providerSaved = saved.providers[provider] || {};
    const modelId = config.modelId || providerSaved.activeModelId || browserModelId(provider, config.model || providerSaved.model);
    const existingModel = providerSaved.models?.find((model) => model.id === modelId);
    const suppliedApiKey = typeof config.apiKey === "string" ? config.apiKey.slice(0, 16384).trim() : "";
    if (!suppliedApiKey && !providerSaved.apiKey) {
      return { ok: false, message: "浏览器预览需要先填写 API Key" };
    }
    const nextModel = normalizeBrowserModelConfig(provider, {
      ...(existingModel || {}),
      id: modelId,
      name: config.modelName || existingModel?.name,
      model: config.model || existingModel?.model || providerSaved.model,
      testedOk: true,
      testedAt: new Date().toISOString(),
      testMessage: "浏览器预览已测试",
    });
    const next = normalizeBrowserAiConfig({
      activeProvider: saved.activeProvider,
      activeModelId: saved.activeModelId,
      providers: {
        ...saved.providers,
        [provider]: {
          ...providerSaved,
          baseUrl: typeof config.baseUrl === "string" ? config.baseUrl.slice(0, 2048) : providerSaved.baseUrl,
          apiKey: suppliedApiKey || providerSaved.apiKey || "",
          models: existingModel
            ? providerSaved.models.map((model) => (model.id === modelId ? nextModel : model))
            : [...(providerSaved.models || []), nextModel],
        },
      },
    });
    writeJson("paperwriter.aiConfig", next);
    return { ...publicBrowserAiConfig(next), ok: true, message: "浏览器预览已保存配置，真实请求请在桌面端测试" };
  },
  generateAi: async (payload = {}) => {
    const requestId = payload.requestId || `browser-${Date.now()}`;
    const chunks = ["这是一段浏览器预览 AI 回复。", "\n\n", "桌面端会使用当前已测试的默认供应商和模型流式生成真实内容。"];
    chunks.forEach((delta, index) => {
      window.setTimeout(() => emitBrowserAi("chunk", { requestId, delta }), 120 * (index + 1));
    });
    window.setTimeout(() => emitBrowserAi("done", {
      requestId,
      usage: { prompt_tokens: 1200, completion_tokens: 320, total_tokens: 1520 },
    }), 120 * (chunks.length + 1));
    return { ok: true, requestId };
  },
  cancelAi: async (requestId) => {
    emitBrowserAi("error", { requestId, message: "已停止生成", aborted: true });
    return { ok: true };
  },
  exportAiChat: async (payload = {}) => {
    const blob = new Blob([payload.markdown || ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${payload.title || "AI问答"}.md`;
    link.click();
    URL.revokeObjectURL(url);
    return { canceled: false, path: link.download };
  },
  onAiChunk: (callback) => {
    browserAiListeners.chunk.add(callback);
    return () => browserAiListeners.chunk.delete(callback);
  },
  onAiDone: (callback) => {
    browserAiListeners.done.add(callback);
    return () => browserAiListeners.done.delete(callback);
  },
  onAiError: (callback) => {
    browserAiListeners.error.add(callback);
    return () => browserAiListeners.error.delete(callback);
  },
  openDocument: async () => ({ canceled: true }),
  openDocumentPath: async () => ({ canceled: true }),
  openFolder: async () => ({ canceled: true, files: [] }),
  listFolder: async () => ({ canceled: true, files: [], folders: [], entries: [] }),
  copyFolderPath: async (folderPath) => {
    await navigator.clipboard?.writeText?.(folderPath || "");
    return { ok: Boolean(folderPath) };
  },
  showFolder: async () => ({ ok: false }),
  createFolder: async () => ({ ok: false, canceled: true }),
  createDocumentInFolder: async () => ({ ok: false, canceled: true }),
  renameEntry: async () => ({ ok: false, canceled: true }),
  deleteEntry: async () => ({ ok: false, canceled: true }),
  moveEntry: async () => ({ ok: false, canceled: true }),
  backupDocument: async () => ({ ok: false, canceled: true }),
  saveDocument: async (document) => {
    assertBrowserResourcesArePersistable(document);
    writeJson("paperwriter.preview.document", document);
    return { canceled: false, path: "browser-preview.letterpaper" };
  },
  saveTempDocument: async (document, tabId = "temp") => {
    assertBrowserResourcesArePersistable(document);
    const key = `paperwriter.preview.temp.${tabId || "temp"}`;
    writeJson(key, document);
    return { canceled: false, path: `browser-preview-${tabId || "temp"}.letterpaper` };
  },
  deleteTempDocument: async (tabId = "temp") => {
    localStorage.removeItem(`paperwriter.preview.temp.${tabId || "temp"}`);
    return { ok: true };
  },
  pickExportPath: async (format, suggestedName = "未命名信笺") => ({
    canceled: false,
    format: format === "images" ? "images" : "pdf",
    path: format === "images" ? `${suggestedName}-分页图片` : `${suggestedName}.pdf`,
  }),
  exportPdf: async (_suggestedName, targetPath = "browser-preview.pdf") => {
    emitBrowserExportProgress({ format: "pdf", percent: 12, message: "正在整理信笺版面…" });
    await waitForBrowserPreview(180);
    emitBrowserExportProgress({ format: "pdf", percent: 78, message: "正在写入 PDF 文件…" });
    await waitForBrowserPreview(180);
    emitBrowserExportProgress({ format: "pdf", percent: 100, message: "PDF 导出完成" });
    return { canceled: false, path: targetPath };
  },
  exportPageImages: async (_suggestedName, pageRects, targetPath = "browser-preview-images") => {
    const total = Math.max(1, pageRects?.length || 1);
    emitBrowserExportProgress({ format: "images", percent: 8, message: `正在准备 ${total} 张分页图片…` });
    for (let index = 0; index < total; index += 1) {
      await waitForBrowserPreview(100);
      const completed = index + 1;
      emitBrowserExportProgress({
        format: "images",
        percent: Math.round(14 + (completed / total) * 86),
        message: `正在导出第 ${completed} / ${total} 张图片`,
        completed,
        total,
      });
    }
    return { canceled: false, path: targetPath, count: total };
  },
  onExportProgress: (callback) => {
    browserExportProgressListeners.add(callback);
    return () => browserExportProgressListeners.delete(callback);
  },
  pickImage: pickImageInBrowser,
  pickAudio: pickAudioInBrowser,
  pickVideo: pickVideoInBrowser,
  openExternal: async (url) => {
    const safeUrl = normalizeBrowserExternalUrl(url);
    if (!safeUrl) return { ok: false, error: typeof url === "string" && url.length > 8192 ? "url-too-long" : "unsupported-or-invalid-url" };
    const opened = window.open(safeUrl, "_blank", "noopener,noreferrer");
    return opened === null ? { ok: false, error: "popup-blocked" } : { ok: true };
  },
  loadAutosave: async () => {
    const document = readJson("paperwriter.autosave", null);
    return document ? { exists: true, document, path: "localStorage:paperwriter.autosave" } : { exists: false };
  },
  saveAutosave: async (document) => {
    writeJson("paperwriter.autosave", document);
    return { path: "localStorage:paperwriter.autosave" };
  },
  clearAutosave: async () => {
    localStorage.removeItem("paperwriter.autosave");
    return { ok: true };
  },
  getUpdateState: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  checkForUpdates: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  downloadUpdate: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  installUpdate: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  onUpdateState: () => () => {},
  confirmClose: async () => ({ action: "save" }),
  closeReady: async () => ({ ok: true }),
  closeCanceled: async () => ({ ok: true }),
  onCloseRequest: () => () => {},
};

export const bridge = window.paperWriter ?? browserBridge;
