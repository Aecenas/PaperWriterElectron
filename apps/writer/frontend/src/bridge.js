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

function pickImageInBrowser() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/bmp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ canceled: true });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          canceled: false,
          name: file.name.replace(/\.[^.]+$/, ""),
          path: file.name,
          dataUrl: reader.result,
        });
      };
      reader.onerror = () => resolve({ canceled: true });
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

const browserAiListeners = {
  chunk: new Set(),
  done: new Set(),
  error: new Set(),
};

function emitBrowserAi(type, payload) {
  browserAiListeners[type]?.forEach((callback) => callback(payload));
}

function browserProviderDefaults(provider) {
  return provider === "deepseek"
    ? { provider: "deepseek", providerLabel: "DeepSeek", model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com" }
    : { provider: "gemini", providerLabel: "Gemini", model: "gemini-3.1-pro-preview", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" };
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
    testedOk: Boolean(config.testedOk),
    testedAt: config.testedAt || "",
    testMessage: config.testMessage || "",
  };
}

function normalizeBrowserAiConfig(config = readJson("paperwriter.aiConfig", {})) {
  const activeProvider = config.activeProvider || config.provider || "gemini";
  const providers = {};
  ["gemini", "deepseek"].forEach((provider) => {
    const defaults = browserProviderDefaults(provider);
    const source = config.providers?.[provider] || (config.provider === provider ? config : {});
    const legacyModel = {
      id: source.activeModelId || browserModelId(provider, source.model || defaults.model),
      name: source.modelName || "默认模型",
      model: source.model || defaults.model,
      testedOk: source.testedOk,
      testedAt: source.testedAt,
      testMessage: source.testMessage,
    };
    const models = (Array.isArray(source.models) && source.models.length ? source.models : [legacyModel])
      .map((model, index) => normalizeBrowserModelConfig(provider, model, index));
    const activeModelId = source.activeModelId && models.some((model) => model.id === source.activeModelId)
      ? source.activeModelId
      : models[0].id;
    const activeModel = models.find((model) => model.id === activeModelId) || models[0];
    providers[provider] = {
      provider,
      providerLabel: defaults.providerLabel,
      baseUrl: source.baseUrl || defaults.baseUrl,
      apiKey: source.apiKey || "",
      activeModelId,
      models,
      modelId: activeModel.id,
      modelName: activeModel.name,
      model: activeModel.model,
      testedOk: Boolean(activeModel.testedOk),
      testedAt: activeModel.testedAt || "",
      testMessage: activeModel.testMessage || "",
    };
  });
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
      activeModelId: providerConfig.activeModelId,
      models: providerConfig.models.map((model) => ({
        id: model.id,
        name: model.name,
        model: model.model,
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
    };
  });
  const active = publicProviders[normalized.activeProvider] || publicProviders.gemini;
  const activeModel = active.models.find((model) => model.id === normalized.activeModelId) || active.models[0];
  return {
    activeProvider: normalized.activeProvider,
    activeModelId: activeModel.id,
    providers: publicProviders,
    ...active,
    modelId: activeModel.id,
    modelName: activeModel.name,
    model: activeModel.model,
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
  saveAiConfig: async (config = {}) => {
    const previous = normalizeBrowserAiConfig();
    const provider = config.provider || previous.activeProvider || "gemini";
    const providerPrevious = previous.providers[provider] || browserProviderDefaults(provider);
    const modelId = config.modelId || providerPrevious.activeModelId || browserModelId(provider, config.model || providerPrevious.model);
    const previousModels = Array.isArray(config.models) && config.models.length
      ? config.models.map((model, index) => normalizeBrowserModelConfig(provider, model, index))
      : providerPrevious.models;
    const existingModel = previousModels.find((model) => model.id === modelId);
    const nextModel = normalizeBrowserModelConfig(provider, {
      ...(existingModel || {}),
      id: modelId,
      name: config.modelName || existingModel?.name,
      model: config.model || existingModel?.model,
      testedOk: (config.resetTest || config.clearApiKey) ? false : existingModel?.testedOk,
      testedAt: (config.resetTest || config.clearApiKey) ? "" : existingModel?.testedAt,
      testMessage: (config.resetTest || config.clearApiKey) ? "" : existingModel?.testMessage,
    });
    const updatedModels = existingModel
      ? previousModels.map((model) => (model.id === modelId ? nextModel : model))
      : [...previousModels, nextModel];
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
    const chunks = ["这是一段浏览器预览 AI 回复。", "\n\n", "桌面端会使用你配置的 Gemini 或 DeepSeek API 流式生成真实内容。"];
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
  exportPdf: async () => {
    window.print();
    return { canceled: false, path: "browser-print-dialog" };
  },
  exportPageImages: async () => ({ canceled: true }),
  pickImage: pickImageInBrowser,
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
