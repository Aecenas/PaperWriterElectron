export const MAX_BROWSER_AI_PROVIDERS = 64;
export const MAX_BROWSER_AI_MODELS = 256;
export const MAX_BROWSER_AI_REASONING_EFFORTS = 32;
export const MAX_BROWSER_AI_REQUEST_PARAMS = 64;

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
const STANDARD_BROWSER_AI_REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);
const DANGEROUS_BROWSER_AI_REQUEST_PARAM_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const RESERVED_BROWSER_AI_REQUEST_PARAM_KEYS = new Set(["model", "messages", "system", "stream", "stream_options"]);
const MAX_BROWSER_AI_REQUEST_PARAM_KEY_CHARS = 128;
const MAX_BROWSER_AI_REQUEST_PARAM_STRING_CHARS = 16 * 1024;
const MAX_BROWSER_AI_REQUEST_PARAMS_JSON_CHARS = 32 * 1024;
const MAX_BROWSER_AI_REQUEST_PARAM_DEPTH = 8;

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

function normalizeBrowserAiRequestParamValue(value, depth = 0) {
  if (depth > MAX_BROWSER_AI_REQUEST_PARAM_DEPTH) return { ok: false };
  if (value === null || typeof value === "boolean") return { ok: true, value };
  if (typeof value === "string") {
    return value.length <= MAX_BROWSER_AI_REQUEST_PARAM_STRING_CHARS ? { ok: true, value } : { ok: false };
  }
  if (typeof value === "number") return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  if (Array.isArray(value)) {
    const result = [];
    for (const item of value) {
      const normalized = normalizeBrowserAiRequestParamValue(item, depth + 1);
      if (!normalized.ok) return { ok: false };
      result.push(normalized.value);
    }
    return { ok: true, value: result };
  }
  if (!value || typeof value !== "object") return { ok: false };
  const result = {};
  for (const rawKey of Object.keys(value)) {
    const key = String(rawKey);
    if (!key || key.length > MAX_BROWSER_AI_REQUEST_PARAM_KEY_CHARS || DANGEROUS_BROWSER_AI_REQUEST_PARAM_KEYS.has(key.toLowerCase())) {
      return { ok: false };
    }
    const normalized = normalizeBrowserAiRequestParamValue(value[rawKey], depth + 1);
    if (!normalized.ok) return { ok: false };
    result[key] = normalized.value;
  }
  return { ok: true, value: result };
}

export function normalizeBrowserAiRequestParams(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  let count = 0;
  for (const rawKey of Object.keys(value)) {
    if (count >= MAX_BROWSER_AI_REQUEST_PARAMS) break;
    const key = String(rawKey).trim();
    const keyLower = key.toLowerCase();
    if (!key || key.length > MAX_BROWSER_AI_REQUEST_PARAM_KEY_CHARS
      || DANGEROUS_BROWSER_AI_REQUEST_PARAM_KEYS.has(keyLower)
      || RESERVED_BROWSER_AI_REQUEST_PARAM_KEYS.has(keyLower)
      || hasOwn(result, key)) continue;
    const normalized = normalizeBrowserAiRequestParamValue(value[rawKey]);
    if (!normalized.ok) continue;
    result[key] = normalized.value;
    count += 1;
  }
  try {
    return JSON.stringify(result).length <= MAX_BROWSER_AI_REQUEST_PARAMS_JSON_CHARS ? result : {};
  } catch {
    return {};
  }
}

export function normalizeBrowserTaskModelAssignment(value) {
  const source = sourceObject(value);
  const providerId = safeBrowserProviderId(source.providerId);
  const modelId = boundedString(source.modelId, 256).trim();
  return providerId && modelId
    ? { providerId, modelId, requestParams: normalizeBrowserAiRequestParams(source.requestParams) }
    : { providerId: "", modelId: "", requestParams: {} };
}

export function safeBrowserReasoningEffort(value) {
  const effort = boundedString(value, 64).trim();
  return !effort || /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(effort) ? effort : "";
}

export function browserAiReasoningEffortIsSupported(model, value) {
  const effort = safeBrowserReasoningEffort(value);
  if (!effort) return true;
  const supported = Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts.map((option) => safeBrowserReasoningEffort(option?.reasoningEffort || option)).filter(Boolean)
    : [];
  return supported.length ? supported.includes(effort) : STANDARD_BROWSER_AI_REASONING_EFFORTS.has(effort);
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
  const isCodex = provider === "codex-cli";
  const supportedReasoningEfforts = isCodex && Array.isArray(source.supportedReasoningEfforts)
    ? source.supportedReasoningEfforts
      .slice(0, MAX_BROWSER_AI_REASONING_EFFORTS)
      .map((option) => ({
        reasoningEffort: safeBrowserReasoningEffort(option?.reasoningEffort || option),
        description: boundedString(option?.description, 500).trim(),
      }))
      .filter((option) => option.reasoningEffort)
    : [];
  return {
    id: boundedString(source.id || browserModelId(provider, model || String(index + 1)), 256).trim(),
    name: boundedString(source.name || source.modelName || (index === 0 ? "默认模型" : `模型 ${index + 1}`), 256).trim() || `模型 ${index + 1}`,
    model,
    requestParams: isCodex ? {} : normalizeBrowserAiRequestParams(source.requestParams),
    reasoningEffort: isCodex ? safeBrowserReasoningEffort(source.reasoningEffort) : "",
    defaultReasoningEffort: isCodex ? safeBrowserReasoningEffort(source.defaultReasoningEffort) : "",
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
    requestParams: source.requestParams,
    reasoningEffort: source.reasoningEffort,
    defaultReasoningEffort: source.defaultReasoningEffort,
    supportedReasoningEfforts: source.supportedReasoningEfforts,
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
  const applyResolver = normalizeBrowserTaskModelAssignment(sourceObject(source.taskModels).applyResolver);
  return {
    activeProvider,
    activeModelId,
    providers,
    taskModels: { applyResolver },
  };
}

export function exactBrowserAiProviderConfig(config, assignment = {}) {
  const normalized = normalizeBrowserAiConfig(config);
  const taskModel = normalizeBrowserTaskModelAssignment(assignment);
  if (!taskModel.providerId || !hasOwn(normalized.providers, taskModel.providerId)) return null;
  const provider = normalized.providers[taskModel.providerId];
  const model = provider.models.find((item) => item.id === taskModel.modelId);
  if (!model) return null;
  return { provider, model };
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
    taskModels: normalized.taskModels,
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
