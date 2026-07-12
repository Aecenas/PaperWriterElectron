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
    accept: "image/png,image/jpeg,image/gif,image/webp,image/bmp",
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

const BROWSER_AI_PROTOCOLS = {
  openai: { label: "OpenAI 兼容", baseUrl: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic 原生", baseUrl: "https://api.anthropic.com/v1" },
};
const BROWSER_BUILTIN_PROVIDERS = {
  gemini: { providerLabel: "Gemini", transport: "http", protocol: "openai", model: "gemini-3.1-pro-preview", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", builtin: true },
  deepseek: { providerLabel: "DeepSeek", transport: "http", protocol: "openai", model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com", builtin: true },
  "codex-cli": { providerLabel: "Codex CLI", transport: "codex-cli", protocol: "", model: "", baseUrl: "", builtin: true },
};

function browserProviderDefaults(provider, source = {}) {
  if (BROWSER_BUILTIN_PROVIDERS[provider]) {
    return { provider, ...BROWSER_BUILTIN_PROVIDERS[provider] };
  }
  const protocol = Object.prototype.hasOwnProperty.call(BROWSER_AI_PROTOCOLS, source.protocol) ? source.protocol : "openai";
  return {
    provider,
    providerLabel: String(source.providerLabel || source.label || "自定义供应商").trim() || "自定义供应商",
    transport: "http",
    protocol,
    model: "",
    baseUrl: source.baseUrl || BROWSER_AI_PROTOCOLS[protocol].baseUrl,
    builtin: false,
  };
}

function browserModelId(provider, model = "") {
  const source = String(model || "default").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${provider}-${source || "model"}`;
}

function normalizeBrowserModelConfig(provider, config = {}, index = 0) {
  const defaults = browserProviderDefaults(provider);
  const model = config.model || defaults.model;
  return {
    id: config.id || browserModelId(provider, model),
    name: config.name || config.modelName || (index === 0 ? "默认模型" : `模型 ${index + 1}`),
    model,
    reasoningEffort: config.reasoningEffort || config.defaultReasoningEffort || "",
    defaultReasoningEffort: config.defaultReasoningEffort || "",
    supportedReasoningEfforts: Array.isArray(config.supportedReasoningEfforts) ? config.supportedReasoningEfforts : [],
    description: config.description || "",
    catalogManaged: Boolean(config.catalogManaged),
    testedOk: Boolean(config.testedOk),
    testedAt: config.testedAt || "",
    testMessage: config.testMessage || "",
  };
}

function normalizeBrowserAiConfig(config = readJson("paperwriter.aiConfig", {})) {
  const providers = {};
  const sources = {
    gemini: config.providers?.gemini || (config.provider === "gemini" ? config : {}),
    deepseek: config.providers?.deepseek || (config.provider === "deepseek" ? config : {}),
    "codex-cli": config.providers?.["codex-cli"] || {},
  };
  Object.entries(config.providers || {}).forEach(([provider, source]) => {
    if (!BROWSER_BUILTIN_PROVIDERS[provider]) sources[provider] = source;
  });
  Object.entries(sources).forEach(([provider, source]) => {
    const defaults = browserProviderDefaults(provider, source);
    const legacyModel = {
      id: source.activeModelId || browserModelId(provider, source.model || defaults.model),
      name: source.modelName || "默认模型",
      model: source.model || defaults.model,
      testedOk: source.testedOk,
      testedAt: source.testedAt,
      testMessage: source.testMessage,
    };
    const isCodex = defaults.transport === "codex-cli";
    const modelsSource = Array.isArray(source.models) ? source.models : ((defaults.builtin && !isCodex) || source.model ? [legacyModel] : []);
    const models = (defaults.builtin && !isCodex && modelsSource.length === 0 ? [legacyModel] : modelsSource)
      .map((model, index) => normalizeBrowserModelConfig(provider, model, index));
    const activeModelId = source.activeModelId && models.some((model) => model.id === source.activeModelId)
      ? source.activeModelId
      : (models[0]?.id || "");
    const activeModel = models.find((model) => model.id === activeModelId) || models[0] || {};
    providers[provider] = {
      provider,
      providerLabel: defaults.providerLabel,
      transport: defaults.transport || "http",
      protocol: defaults.protocol,
      builtin: defaults.builtin,
      baseUrl: source.baseUrl || defaults.baseUrl,
      apiKey: source.apiKey || "",
      activeModelId,
      models,
      modelId: activeModel.id || "",
      modelName: activeModel.name || "",
      model: activeModel.model || "",
      testedOk: Boolean(activeModel.testedOk),
      testedAt: activeModel.testedAt || "",
      testMessage: activeModel.testMessage || "",
    };
  });
  const requestedActiveProvider = config.activeProvider || config.provider || "gemini";
  const activeProvider = providers[requestedActiveProvider] ? requestedActiveProvider : "gemini";
  const activeModelId = config.activeModelId && providers[activeProvider]?.models.some((model) => model.id === config.activeModelId)
    ? config.activeModelId
    : providers[activeProvider]?.activeModelId;
  return { activeProvider, activeModelId, providers };
}

function publicBrowserAiConfig(config = readJson("paperwriter.aiConfig", {})) {
  const normalized = normalizeBrowserAiConfig(config);
  const publicProviders = {};
  Object.entries(normalized.providers).forEach(([provider, providerConfig]) => {
    const apiKey = providerConfig.apiKey || "";
    publicProviders[provider] = {
      provider,
      providerLabel: providerConfig.providerLabel,
      transport: providerConfig.transport || "http",
      protocol: providerConfig.protocol,
      builtin: providerConfig.builtin,
      activeModelId: providerConfig.activeModelId,
      models: providerConfig.models.map((model) => ({
        id: model.id,
        name: model.name,
        model: model.model,
        reasoningEffort: model.reasoningEffort || "",
        defaultReasoningEffort: model.defaultReasoningEffort || "",
        supportedReasoningEfforts: model.supportedReasoningEfforts || [],
        description: model.description || "",
        catalogManaged: Boolean(model.catalogManaged),
        testedOk: Boolean(model.testedOk),
        testedAt: model.testedAt || "",
        testMessage: model.testMessage || "",
      })),
      modelId: providerConfig.modelId,
      modelName: providerConfig.modelName,
      model: providerConfig.model,
      baseUrl: providerConfig.baseUrl,
      hasApiKey: Boolean(apiKey),
      apiKeyLast4: apiKey ? apiKey.slice(-4) : "",
      testedOk: Boolean(providerConfig.testedOk),
      testedAt: providerConfig.testedAt || "",
      testMessage: providerConfig.testMessage || "",
      runtime: providerConfig.transport === "codex-cli" ? {
        installed: false,
        authenticated: false,
        ready: false,
        catalogFresh: false,
        checkedAt: "",
        message: "Codex CLI 仅在桌面端可用",
        browserOnly: true,
      } : null,
    };
  });
  const active = publicProviders[normalized.activeProvider] || publicProviders.gemini;
  const activeModel = active.models.find((model) => model.id === normalized.activeModelId) || active.models[0] || {};
  return {
    activeProvider: normalized.activeProvider,
    activeModelId: activeModel.id,
    providers: publicProviders,
    ...active,
    modelId: activeModel.id || "",
    modelName: activeModel.name || "",
    model: activeModel.model || "",
    testedOk: Boolean(activeModel.testedOk),
    testedAt: activeModel.testedAt || "",
    testMessage: activeModel.testMessage || "",
  };
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
    const providerLabel = String(input.providerLabel || input.label || "").trim();
    if (!providerLabel) throw new Error("请填写供应商名称");
    if (Object.values(previous.providers).some((provider) => provider.providerLabel.toLocaleLowerCase() === providerLabel.toLocaleLowerCase())) {
      throw new Error("供应商名称已存在");
    }
    const protocol = Object.prototype.hasOwnProperty.call(BROWSER_AI_PROTOCOLS, input.protocol) ? input.protocol : "openai";
    const baseUrl = String(input.baseUrl || BROWSER_AI_PROTOCOLS[protocol].baseUrl).trim().replace(/\/+$/, "");
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
    const target = previous.providers[provider];
    if (!target) throw new Error("供应商不存在");
    if (target.builtin) throw new Error("内置供应商不可删除");
    if (previous.activeProvider === provider) throw new Error("请先切换默认供应商后再删除");
    const providers = { ...previous.providers };
    delete providers[provider];
    const next = normalizeBrowserAiConfig({ ...previous, providers });
    writeJson("paperwriter.aiConfig", next);
    return { ...publicBrowserAiConfig(next), ok: true };
  },
  saveAiConfig: async (config = {}) => {
    const previous = normalizeBrowserAiConfig();
    const provider = previous.providers[config.provider] ? config.provider : previous.activeProvider;
    const providerPrevious = previous.providers[provider];
    const nextProviderLabel = providerPrevious.builtin ? providerPrevious.providerLabel : String(config.providerLabel ?? providerPrevious.providerLabel).trim();
    if (!nextProviderLabel) throw new Error("请填写供应商名称");
    if (!providerPrevious.builtin && Object.values(previous.providers).some((item) => item.provider !== provider && item.providerLabel.toLocaleLowerCase() === nextProviderLabel.toLocaleLowerCase())) throw new Error("供应商名称已存在");
    const hasModelPatch = Boolean(config.modelId || config.model || (Array.isArray(config.models) && config.models.length));
    const modelId = hasModelPatch ? (config.modelId || providerPrevious.activeModelId || browserModelId(provider, config.model || providerPrevious.model)) : "";
    const previousModels = Array.isArray(config.models)
      ? config.models.map((model, index) => normalizeBrowserModelConfig(provider, model, index))
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
    const next = {
      activeProvider: config.activate === true ? provider : previous.activeProvider,
      activeModelId: config.activate === true ? modelId : previous.activeModelId,
      providers: {
        ...previous.providers,
        [provider]: {
          ...providerPrevious,
          providerLabel: nextProviderLabel,
          baseUrl: config.baseUrl || providerPrevious.baseUrl,
          apiKey: config.clearApiKey ? "" : (config.apiKey?.trim?.() || providerPrevious.apiKey || ""),
          activeModelId: config.activate === true ? modelId : providerPrevious.activeModelId,
          models: nextModels,
        },
      },
    };
    writeJson("paperwriter.aiConfig", next);
    return publicBrowserAiConfig(next);
  },
  testAiConfig: async (config = {}) => {
    const saved = normalizeBrowserAiConfig();
    const provider = config.provider || saved.activeProvider || "gemini";
    const providerSaved = saved.providers[provider] || {};
    const modelId = config.modelId || providerSaved.activeModelId || browserModelId(provider, config.model || providerSaved.model);
    const existingModel = providerSaved.models?.find((model) => model.id === modelId);
    if (!config.apiKey?.trim?.() && !providerSaved.apiKey) {
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
    const next = {
      activeProvider: saved.activeProvider,
      activeModelId: saved.activeModelId,
      providers: {
        ...saved.providers,
        [provider]: {
          ...providerSaved,
          baseUrl: config.baseUrl || providerSaved.baseUrl,
          apiKey: config.apiKey?.trim?.() || providerSaved.apiKey || "",
          models: existingModel
            ? providerSaved.models.map((model) => (model.id === modelId ? nextModel : model))
            : [...(providerSaved.models || []), nextModel],
        },
      },
    };
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
    writeJson("paperwriter.preview.document", document);
    return { canceled: false, path: "browser-preview.letterpaper" };
  },
  saveTempDocument: async (document, tabId = "temp") => {
    const key = `paperwriter.preview.temp.${tabId || "temp"}`;
    writeJson(key, document);
    return { canceled: false, path: `browser-preview-${tabId || "temp"}.letterpaper` };
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
    const opened = window.open(String(url || ""), "_blank", "noopener,noreferrer");
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
