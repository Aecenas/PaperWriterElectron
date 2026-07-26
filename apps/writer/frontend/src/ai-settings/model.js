import { normalizeUiAiRequestParams } from "../ai-request-params.js";

export const AI_PROVIDER_OPTIONS = [
  {
    id: "gemini",
    label: "Gemini",
    protocol: "openai",
    builtin: true,
    model: "gemini-3.1-pro-preview",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai",
    builtin: true,
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    transport: "codex-cli",
    protocol: "",
    builtin: true,
    model: "",
    baseUrl: "本地 Codex CLI",
  },
];
export const AI_PROTOCOL_OPTIONS = [
  { id: "openai", label: "OpenAI 兼容", baseUrl: "https://api.openai.com/v1", description: "Chat Completions 接口" },
  { id: "anthropic", label: "Anthropic 原生", baseUrl: "https://api.anthropic.com/v1", description: "Messages API 接口" },
];
export const AI_REASONING_EFFORT_OPTIONS = [
  { value: "", label: "服务商默认" },
  { value: "minimal", label: "最简（minimal）" },
  { value: "low", label: "低（low）" },
  { value: "medium", label: "中（medium）" },
  { value: "high", label: "高（high）" },
  { value: "xhigh", label: "超高（xhigh）" },
  { value: "max", label: "最高（max）" },
];
export const AI_TASK_MODEL_DEFINITIONS = [
  {
    id: "selectionChat",
    label: "选区问答",
    description: "只用于选中文字后的临时多轮问答，不读取整篇信笺或资料。未单独指定时跟随默认模型。",
    selectLabel: "选区问答模型",
  },
  {
    id: "applyResolver",
    label: "直接应用定位",
    description: "只判断优化块在正文中的替换或插入位置，不参与内容优化与改写。内置 Gemini、DeepSeek 固定使用 JSON 输出，并使用各自模型允许的最大输出上限。",
    selectLabel: "直接应用定位模型",
  },
];
export const AI_MODEL_REQUIRED_MESSAGE = "必须配置好至少一个可用模型，才能进入 AI 模式。配置完成后，再次点击“AI模式”即可。";
export const DEFAULT_AI_CONFIG = {
  activeProvider: "gemini",
  activeModelId: "gemini-default",
  activeModelKey: "gemini::gemini-default",
  providers: {},
  provider: "gemini",
  providerLabel: "Gemini",
  modelId: "gemini-default",
  modelName: "默认模型",
  model: "gemini-3.1-pro-preview",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  hasApiKey: false,
  apiKeyLast4: "",
  taskModels: {
    selectionChat: { providerId: "", modelId: "", requestParams: {} },
    applyResolver: { providerId: "", modelId: "", requestParams: {} },
  },
};

export function getAiProviderDefaults(provider, config = {}) {
  const builtin = AI_PROVIDER_OPTIONS.find((option) => option.id === provider);
  if (builtin) return builtin;
  const protocol = AI_PROTOCOL_OPTIONS.some((option) => option.id === config.protocol) ? config.protocol : "openai";
  const protocolDefaults = AI_PROTOCOL_OPTIONS.find((option) => option.id === protocol) || AI_PROTOCOL_OPTIONS[0];
  return {
    id: provider,
    label: String(config.providerLabel || config.label || "自定义供应商").trim() || "自定义供应商",
    transport: "http",
    protocol,
    builtin: false,
    model: "",
    baseUrl: config.baseUrl || protocolDefaults.baseUrl,
  };
}

export function createAiModelId(provider, model = "") {
  const source = String(model || "default").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${provider}-${source || "model"}`;
}

export function createAiModelKey(provider, modelId) {
  return provider && modelId ? `${provider}::${modelId}` : "";
}

export function parseAiModelKey(value = "") {
  const [provider, modelId] = String(value || "").split("::");
  return {
    provider,
    modelId: modelId || "",
  };
}

export function normalizePublicAiTaskModelAssignment(value = {}) {
  const rawProviderId = typeof value?.providerId === "string" ? value.providerId.slice(0, 128).trim() : "";
  const providerId = /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(rawProviderId)
    && !["__proto__", "prototype", "constructor", "tostring", "valueof"].includes(rawProviderId.toLowerCase())
    ? rawProviderId
    : "";
  const modelId = typeof value?.modelId === "string" ? value.modelId.slice(0, 256).trim() : "";
  return providerId && modelId
    ? { providerId, modelId, requestParams: normalizeUiAiRequestParams(value?.requestParams) }
    : { providerId: "", modelId: "", requestParams: {} };
}

export function formatAiReasoningEffort(value = "") {
  return AI_REASONING_EFFORT_OPTIONS.find((option) => option.value === value)?.label || value || "服务商默认";
}

export function getAiReasoningEffortOptions(model = {}, { inherit = false } = {}) {
  const supported = Array.isArray(model.supportedReasoningEfforts) && model.supportedReasoningEfforts.length
    ? model.supportedReasoningEfforts.map((option) => ({
      value: String(option?.reasoningEffort || option || ""),
      label: formatAiReasoningEffort(String(option?.reasoningEffort || option || "")),
    })).filter((option) => option.value)
    : AI_REASONING_EFFORT_OPTIONS.filter((option) => option.value);
  const current = String(model.reasoningEffort || model.defaultReasoningEffort || "");
  const choices = current && !supported.some((option) => option.value === current)
    ? [{ value: current, label: formatAiReasoningEffort(current) }, ...supported]
    : supported;
  if (!inherit) {
    return [{ value: "", label: "服务商默认" }, ...choices];
  }
  const modelDefault = formatAiReasoningEffort(current);
  return [{ value: "", label: `跟随模型设置 · ${modelDefault}` }, ...choices];
}

export function normalizePublicAiModelConfig(provider, config = {}, index = 0) {
  const defaults = getAiProviderDefaults(provider, config);
  const model = String(config.model || defaults.model || "").trim();
  const isCodex = defaults.transport === "codex-cli";
  return {
    id: config.id || createAiModelId(provider, model || String(index + 1)),
    name: String(config.name || config.modelName || (index === 0 ? "默认模型" : `模型 ${index + 1}`)).trim() || `模型 ${index + 1}`,
    model,
    requestParams: isCodex ? {} : normalizeUiAiRequestParams(config.requestParams),
    reasoningEffort: isCodex ? (config.reasoningEffort || config.defaultReasoningEffort || "") : "",
    defaultReasoningEffort: isCodex ? (config.defaultReasoningEffort || "") : "",
    supportedReasoningEfforts: isCodex && Array.isArray(config.supportedReasoningEfforts) ? config.supportedReasoningEfforts : [],
    description: config.description || "",
    catalogManaged: Boolean(config.catalogManaged),
    testedOk: Boolean(config.testedOk),
    testedAt: config.testedAt || "",
    testMessage: config.testMessage || "",
  };
}

export function normalizePublicAiProviderConfig(provider, config = {}) {
  const defaults = getAiProviderDefaults(provider, config);
  const legacyModel = {
    id: config.activeModelId || createAiModelId(defaults.id, config.model || defaults.model),
    name: config.modelName || "默认模型",
    model: config.model || defaults.model,
    testedOk: config.testedOk,
    testedAt: config.testedAt,
    testMessage: config.testMessage,
    requestParams: config.requestParams,
    reasoningEffort: config.reasoningEffort,
    defaultReasoningEffort: config.defaultReasoningEffort,
    supportedReasoningEfforts: config.supportedReasoningEfforts,
  };
  const isCodex = defaults.transport === "codex-cli";
  let modelsSource = Array.isArray(config.models) ? config.models : ((defaults.builtin && !isCodex) || config.model ? [legacyModel] : []);
  if (defaults.builtin && !isCodex && modelsSource.length === 0) modelsSource = [legacyModel];
  const models = modelsSource.map((modelConfig, index) => normalizePublicAiModelConfig(defaults.id, modelConfig, index)).filter((model) => model.model);
  const activeModelId = config.activeModelId && models.some((model) => model.id === config.activeModelId)
    ? config.activeModelId
    : (models[0]?.id || "");
  const activeModel = models.find((model) => model.id === activeModelId) || models[0] || {};
  return {
    provider: defaults.id,
    providerLabel: defaults.label,
    transport: defaults.transport || config.transport || "http",
    protocol: defaults.protocol,
    builtin: defaults.builtin,
    baseUrl: config.baseUrl || defaults.baseUrl,
    hasApiKey: Boolean(config.hasApiKey),
    apiKeyLast4: config.apiKeyLast4 || "",
    activeModelId,
    models,
    modelId: activeModel.id || "",
    modelName: activeModel.name || "",
    model: activeModel.model || "",
    testedOk: Boolean(activeModel.testedOk),
    testedAt: activeModel.testedAt || "",
    testMessage: activeModel.testMessage || "",
    runtime: config.runtime || null,
  };
}

export function normalizePublicAiConfig(config) {
  const providers = {};
  AI_PROVIDER_OPTIONS.forEach((option) => {
    providers[option.id] = normalizePublicAiProviderConfig(option.id, config?.providers?.[option.id] || (config?.provider === option.id ? config : {}));
  });
  Object.entries(config?.providers || {}).forEach(([provider, providerConfig]) => {
    if (!providers[provider]) providers[provider] = normalizePublicAiProviderConfig(provider, providerConfig);
  });
  const requestedActiveProvider = config?.activeProvider || config?.provider || "gemini";
  const activeProvider = providers[requestedActiveProvider] ? requestedActiveProvider : "gemini";
  const activeProviderConfig = providers[activeProvider] || providers.gemini;
  const requestedModelId = config?.activeModelId || config?.modelId || activeProviderConfig.activeModelId;
  const activeModel = activeProviderConfig.models.find((model) => model.id === requestedModelId) || activeProviderConfig.models[0] || {};
  const activeModelId = activeModel.id || "";
  const selectionChat = normalizePublicAiTaskModelAssignment(config?.taskModels?.selectionChat);
  const applyResolver = normalizePublicAiTaskModelAssignment(config?.taskModels?.applyResolver);
  return {
    ...DEFAULT_AI_CONFIG,
    activeProvider,
    activeModelId,
    activeModelKey: createAiModelKey(activeProvider, activeModelId),
    providers,
    provider: activeProviderConfig.provider,
    providerLabel: activeProviderConfig.providerLabel,
    protocol: activeProviderConfig.protocol,
    transport: activeProviderConfig.transport || "http",
    modelId: activeModel.id || "",
    modelName: activeModel.name || "",
    model: activeModel.model || "",
    baseUrl: activeProviderConfig.baseUrl,
    hasApiKey: activeProviderConfig.hasApiKey,
    apiKeyLast4: activeProviderConfig.apiKeyLast4,
    testedOk: Boolean(activeModel.testedOk),
    testedAt: activeModel.testedAt || "",
    testMessage: activeModel.testMessage || "",
    taskModels: {
      selectionChat,
      applyResolver,
    },
  };
}

export function getTestedAiProviders(config) {
  const normalized = normalizePublicAiConfig(config);
  return Object.values(normalized.providers).flatMap((providerConfig) => {
    if (providerConfig.transport === "codex-cli") {
      if (!providerConfig.runtime?.ready) return [];
    } else if (!providerConfig.hasApiKey) {
      return [];
    }
    return providerConfig.models
      .filter((model) => model.testedOk)
      .map((model) => ({
        id: createAiModelKey(providerConfig.provider, model.id),
        provider: providerConfig.provider,
        providerLabel: providerConfig.providerLabel,
        protocol: providerConfig.protocol,
        transport: providerConfig.transport || "http",
        builtin: providerConfig.builtin,
        modelId: model.id,
        modelName: model.name,
        model: model.model,
        requestParams: model.requestParams || {},
        reasoningEffort: model.reasoningEffort || model.defaultReasoningEffort || "",
        defaultReasoningEffort: model.defaultReasoningEffort || "",
        supportedReasoningEfforts: model.supportedReasoningEfforts || [],
        label: providerConfig.providerLabel,
        baseUrl: providerConfig.baseUrl,
      }));
  });
}

export function getAiProviderRuntimeConfig(config, modelKey) {
  const normalized = normalizePublicAiConfig(config);
  const parsed = parseAiModelKey(modelKey || normalized.activeModelKey);
  const providerId = normalized.providers[parsed.provider] ? parsed.provider : normalized.activeProvider;
  const providerConfig = normalized.providers[providerId] || normalizePublicAiProviderConfig(providerId);
  const model = providerConfig.models.find((item) => item.id === parsed.modelId)
    || providerConfig.models.find((item) => item.id === normalized.activeModelId)
    || providerConfig.models[0]
    || {};
  return {
    ...normalized,
    provider: providerId,
    providerLabel: providerConfig.providerLabel,
    baseUrl: providerConfig.baseUrl,
    hasApiKey: providerConfig.hasApiKey,
    apiKeyLast4: providerConfig.apiKeyLast4,
    protocol: providerConfig.protocol,
    transport: providerConfig.transport || "http",
    modelId: model.id || "",
    modelName: model.name || "",
    model: model.model || "",
    testedOk: Boolean(model.testedOk),
    testedAt: model.testedAt || "",
    testMessage: model.testMessage || "",
    requestParams: model.requestParams || {},
    reasoningEffort: model.reasoningEffort || model.defaultReasoningEffort || "",
    defaultReasoningEffort: model.defaultReasoningEffort || "",
    supportedReasoningEfforts: model.supportedReasoningEfforts || [],
    activeProvider: normalized.activeProvider,
  };
}

export function getAiProviderConnectionMeta(providerConfig) {
  if (providerConfig?.transport === "codex-cli") {
    const runtime = providerConfig.runtime || {};
    if (runtime.ready) return { tone: "connected", label: "已连接", shortLabel: "可用", statusLabel: "可用" };
    if (runtime.error) return { tone: "failed", label: "检查失败", shortLabel: "失败", statusLabel: "不可用" };
    if (!runtime.installed && runtime.checkedAt) return { tone: "failed", label: "未安装", shortLabel: "未安装", statusLabel: "不可用" };
    if (runtime.installed && !runtime.authenticated) return { tone: "idle", label: "未登录", shortLabel: "未登录", statusLabel: "未登录" };
    return { tone: "idle", label: "待检查", shortLabel: "待检查", statusLabel: "未配置" };
  }
  const hasAvailableModel = Boolean(providerConfig?.hasApiKey) && providerConfig.models?.some((model) => model.testedOk);
  const hasFailedTest = providerConfig.models?.some((model) => model.testedAt) && !providerConfig.models?.some((model) => model.testedOk);
  if (hasAvailableModel) {
    return { tone: "connected", label: "已连接", shortLabel: "已连接", statusLabel: "可用" };
  }
  if (hasFailedTest) {
    return { tone: "failed", label: "连接失败", shortLabel: "失败", statusLabel: "不可用" };
  }
  return { tone: "idle", label: "未连接", shortLabel: "未连接", statusLabel: providerConfig?.hasApiKey ? "未测试" : "未配置" };
}

export function formatAiProviderUpdatedAt(providerConfig) {
  if (providerConfig?.transport === "codex-cli") {
    const checkedAt = Date.parse(providerConfig.runtime?.checkedAt || "");
    return Number.isFinite(checkedAt) ? new Date(checkedAt).toLocaleString("zh-CN", { hour12: false }) : "尚未检查";
  }
  const timestamps = (providerConfig?.models || [])
    .map((model) => Date.parse(model.testedAt || ""))
    .filter((timestamp) => Number.isFinite(timestamp));
  if (!timestamps.length) {
    return "尚未测试";
  }
  const date = new Date(Math.max(...timestamps));
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
