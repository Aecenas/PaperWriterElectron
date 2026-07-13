export const MAX_BROWSER_AI_PROVIDERS = 64;
export const MAX_BROWSER_AI_MODELS = 256;
export const MAX_BROWSER_AI_REASONING_EFFORTS = 32;

export const BROWSER_AI_PROTOCOLS = Object.freeze({
  openai: { label: "OpenAI 兼容", baseUrl: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic 原生", baseUrl: "https://api.anthropic.com/v1" },
});

export const BROWSER_BUILTIN_PROVIDERS = Object.freeze({
  gemini: { providerLabel: "Gemini", transport: "http", protocol: "openai", model: "gemini-3.1-pro-preview", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", builtin: true },
  deepseek: { providerLabel: "DeepSeek", transport: "http", protocol: "openai", model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com", builtin: true },
  "codex-cli": { providerLabel: "Codex CLI", transport: "codex-cli", protocol: "", model: "", baseUrl: "", builtin: true },
});

const RESERVED_PROVIDER_IDS = new Set(["__proto__", "prototype", "constructor", "tostring", "valueof"]);

export function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function sourceObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedString(value, limit, fallback = "") {
  return typeof value === "string" ? value.slice(0, limit) : fallback;
}

export function safeBrowserProviderId(value) {
  if (typeof value !== "string" || value.length > 128) return "";
  const provider = value.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(provider) || RESERVED_PROVIDER_IDS.has(provider.toLowerCase())) return "";
  return provider;
}

function normalizeBrowserProtocol(value) {
  return hasOwn(BROWSER_AI_PROTOCOLS, value) ? value : "openai";
}

export function browserProviderDefaults(provider, config = {}) {
  if (hasOwn(BROWSER_BUILTIN_PROVIDERS, provider)) {
    return { provider, ...BROWSER_BUILTIN_PROVIDERS[provider] };
  }
  const source = sourceObject(config);
  const protocol = normalizeBrowserProtocol(source.protocol);
  return {
    provider,
    providerLabel: boundedString(source.providerLabel || source.label || "自定义供应商", 1024).trim().slice(0, 120) || "自定义供应商",
    transport: "http",
    protocol,
    model: "",
    baseUrl: boundedString(source.baseUrl || BROWSER_AI_PROTOCOLS[protocol].baseUrl, 2048).trim() || BROWSER_AI_PROTOCOLS[protocol].baseUrl,
    builtin: false,
  };
}

export function browserModelId(provider, model = "") {
  const providerId = safeBrowserProviderId(provider) || "provider";
  const source = String(model || "default").slice(0, 256).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${providerId}-${source || "model"}`.slice(0, 256);
}

export function normalizeBrowserModelConfig(provider, config = {}, index = 0, fallbackModel = "") {
  const source = sourceObject(config);
  const model = boundedString(source.model || fallbackModel, 256).trim();
  const supportedReasoningEfforts = Array.isArray(source.supportedReasoningEfforts)
    ? source.supportedReasoningEfforts
      .slice(0, MAX_BROWSER_AI_REASONING_EFFORTS)
      .map((option) => ({
        reasoningEffort: boundedString(option?.reasoningEffort || option, 64).trim(),
        description: boundedString(option?.description, 500).trim(),
      }))
      .filter((option) => option.reasoningEffort)
    : [];
  return {
    id: boundedString(source.id || browserModelId(provider, model || String(index + 1)), 256).trim(),
    name: boundedString(source.name || source.modelName || (index === 0 ? "默认模型" : `模型 ${index + 1}`), 256).trim() || `模型 ${index + 1}`,
    model,
    reasoningEffort: boundedString(source.reasoningEffort, 64),
    defaultReasoningEffort: boundedString(source.defaultReasoningEffort, 64),
    supportedReasoningEfforts,
    description: boundedString(source.description, 2000),
    catalogManaged: Boolean(source.catalogManaged),
    testedOk: Boolean(source.testedOk),
    testedAt: boundedString(source.testedAt, 64),
    testMessage: boundedString(source.testMessage, 2000),
  };
}

function normalizeBrowserProviderConfig(provider, config = {}) {
  const source = sourceObject(config);
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
  let modelsSource;
  if (Array.isArray(source.models)) {
    modelsSource = source.models.slice(0, MAX_BROWSER_AI_MODELS);
  } else {
    modelsSource = (defaults.builtin && !isCodex) || source.model ? [legacyModel] : [];
  }
  if (defaults.builtin && !isCodex && modelsSource.length === 0) modelsSource = [legacyModel];

  const seenModelIds = new Set();
  const models = modelsSource
    .map((model, index) => normalizeBrowserModelConfig(provider, model, index, defaults.model))
    .filter((model) => {
      if (!model.id || !model.model || seenModelIds.has(model.id)) return false;
      seenModelIds.add(model.id);
      return true;
    });
  const requestedModelId = boundedString(source.activeModelId, 256);
  const activeModelId = requestedModelId && models.some((model) => model.id === requestedModelId)
    ? requestedModelId
    : (models[0]?.id || "");
  const activeModel = models.find((model) => model.id === activeModelId) || models[0] || {};
  return {
    provider,
    providerLabel: defaults.providerLabel,
    transport: defaults.transport || "http",
    protocol: defaults.protocol,
    builtin: defaults.builtin,
    baseUrl: defaults.transport === "codex-cli" ? "" : (boundedString(source.baseUrl || defaults.baseUrl, 2048).trim() || defaults.baseUrl),
    apiKey: boundedString(source.apiKey, 16384).trim(),
    activeModelId,
    models,
    modelId: activeModel.id || "",
    modelName: activeModel.name || "",
    model: activeModel.model || "",
    testedOk: Boolean(activeModel.testedOk),
    testedAt: activeModel.testedAt || "",
    testMessage: activeModel.testMessage || "",
  };
}

export function normalizeBrowserAiConfig(config = {}) {
  const source = sourceObject(config);
  const providerSource = sourceObject(source.providers);
  const providers = Object.create(null);
  Object.keys(BROWSER_BUILTIN_PROVIDERS).forEach((provider) => {
    const legacy = !source.providers && source.provider === provider ? source : {};
    providers[provider] = normalizeBrowserProviderConfig(provider, hasOwn(providerSource, provider) ? providerSource[provider] : legacy);
  });
  for (const rawProvider of Object.keys(providerSource)) {
    if (Object.keys(providers).length >= MAX_BROWSER_AI_PROVIDERS) break;
    if (hasOwn(BROWSER_BUILTIN_PROVIDERS, rawProvider)) continue;
    const provider = safeBrowserProviderId(rawProvider);
    const providerConfig = providerSource[rawProvider];
    if (!provider || !providerConfig || typeof providerConfig !== "object" || Array.isArray(providerConfig) || hasOwn(providers, provider)) continue;
    providers[provider] = normalizeBrowserProviderConfig(provider, providerConfig);
  }
  const requestedActiveProvider = safeBrowserProviderId(source.activeProvider || source.provider || "gemini");
  const activeProvider = requestedActiveProvider && hasOwn(providers, requestedActiveProvider) ? requestedActiveProvider : "gemini";
  const requestedActiveModelId = boundedString(source.activeModelId, 256);
  const activeProviderConfig = providers[activeProvider];
  const activeModelId = activeProviderConfig.models.some((model) => model.id === requestedActiveModelId)
    ? requestedActiveModelId
    : activeProviderConfig.activeModelId;
  return { activeProvider, activeModelId, providers };
}

export function publicBrowserAiConfig(config = {}) {
  const normalized = normalizeBrowserAiConfig(config);
  const publicProviders = Object.create(null);
  Object.entries(normalized.providers).forEach(([provider, providerConfig]) => {
    const apiKey = providerConfig.apiKey || "";
    publicProviders[provider] = {
      provider,
      providerLabel: providerConfig.providerLabel,
      transport: providerConfig.transport || "http",
      protocol: providerConfig.protocol,
      builtin: providerConfig.builtin,
      activeModelId: providerConfig.activeModelId,
      models: providerConfig.models.map((model) => ({ ...model })),
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
  const active = hasOwn(publicProviders, normalized.activeProvider) ? publicProviders[normalized.activeProvider] : publicProviders.gemini;
  const activeModel = active.models.find((model) => model.id === normalized.activeModelId) || active.models[0] || {};
  return {
    activeProvider: normalized.activeProvider,
    activeModelId: activeModel.id || "",
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

export function normalizeBrowserExternalUrl(value) {
  if (typeof value !== "string" || value.length > 8192) return "";
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return "";
  }
  return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.toString() : "";
}
