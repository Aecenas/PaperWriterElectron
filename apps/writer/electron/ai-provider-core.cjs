const BUILTIN_AI_PROVIDERS = {
  gemini: {
    label: "Gemini",
    protocol: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.1-pro-preview",
  },
  deepseek: {
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
  "codex-cli": {
    label: "Codex CLI",
    transport: "codex-cli",
    protocol: "",
    baseUrl: "",
    model: "",
  },
};

const AI_PROTOCOLS = {
  openai: { label: "OpenAI 兼容", baseUrl: "https://api.openai.com/v1" },
  anthropic: { label: "Anthropic 原生", baseUrl: "https://api.anthropic.com/v1" },
};

const MAX_CUSTOM_AI_PROVIDERS = 64;
const MAX_AI_MODELS_PER_PROVIDER = 256;
const MAX_AI_REASONING_EFFORTS = 32;
const RESERVED_PROVIDER_IDS = new Set(["__proto__", "prototype", "constructor", "tostring", "valueof"]);

function hasOwn(object, key) {
  return Boolean(object && Object.prototype.hasOwnProperty.call(object, key));
}

function safeProviderId(value) {
  const raw = String(value || "");
  if (raw.length > 128) return "";
  const provider = raw.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(provider) || RESERVED_PROVIDER_IDS.has(provider.toLowerCase())) return "";
  return provider;
}

function sourceObject(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeAiProtocol(value) {
  return Object.prototype.hasOwnProperty.call(AI_PROTOCOLS, value) ? value : "openai";
}

function createAiModelId(provider, model = "") {
  const providerId = safeProviderId(provider) || "provider";
  const source = String(model || "default").slice(0, 256).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${providerId}-${source || "model"}`.slice(0, 256);
}

function providerDefinition(provider, config = {}) {
  const source = sourceObject(config);
  const builtin = hasOwn(BUILTIN_AI_PROVIDERS, provider) ? BUILTIN_AI_PROVIDERS[provider] : null;
  if (builtin) {
    return { id: provider, transport: "http", ...builtin, builtin: true };
  }
  const protocol = normalizeAiProtocol(source.protocol);
  return {
    id: provider,
    label: String(source.providerLabel || source.label || "自定义供应商").slice(0, 1024).trim().slice(0, 120) || "自定义供应商",
    transport: "http",
    protocol,
    baseUrl: String(source.baseUrl || AI_PROTOCOLS[protocol].baseUrl).slice(0, 2048).trim() || AI_PROTOCOLS[protocol].baseUrl,
    model: "",
    builtin: false,
  };
}

function normalizeAiModelConfig(provider, config = {}, index = 0, fallbackModel = "") {
  const source = sourceObject(config);
  const model = String(source.model || fallbackModel || "").slice(0, 256).trim();
  return {
    id: String(source.id || createAiModelId(provider, model || String(index + 1))).slice(0, 256).trim(),
    name: String(source.name || source.modelName || (index === 0 ? "默认模型" : `模型 ${index + 1}`)).slice(0, 256).trim() || `模型 ${index + 1}`,
    model,
    reasoningEffort: typeof source.reasoningEffort === "string" ? source.reasoningEffort.slice(0, 64) : "",
    defaultReasoningEffort: typeof source.defaultReasoningEffort === "string" ? source.defaultReasoningEffort.slice(0, 64) : "",
    supportedReasoningEfforts: Array.isArray(source.supportedReasoningEfforts)
      ? source.supportedReasoningEfforts.slice(0, MAX_AI_REASONING_EFFORTS).map((option) => ({
        reasoningEffort: String(option?.reasoningEffort || option || "").slice(0, 64).trim(),
        description: String(option?.description || "").slice(0, 500).trim(),
      })).filter((option) => option.reasoningEffort)
      : [],
    description: typeof source.description === "string" ? source.description.slice(0, 2000) : "",
    catalogManaged: Boolean(source.catalogManaged),
    testedOk: Boolean(source.testedOk),
    testedAt: typeof source.testedAt === "string" ? source.testedAt.slice(0, 64) : "",
    testMessage: typeof source.testMessage === "string" ? source.testMessage.slice(0, 2000) : "",
  };
}

function normalizeAiProviderConfig(provider, config = {}) {
  const source = sourceObject(config);
  const definition = providerDefinition(provider, source);
  const legacyModel = {
    id: source.activeModelId || createAiModelId(provider, source.model || definition.model),
    name: source.modelName || "默认模型",
    model: source.model || definition.model,
    testedOk: source.testedOk,
    testedAt: source.testedAt,
    testMessage: source.testMessage,
  };
  let modelsSource;
  if (Array.isArray(source.models)) {
    modelsSource = source.models.slice(0, MAX_AI_MODELS_PER_PROVIDER);
  } else if ((definition.builtin && definition.transport !== "codex-cli") || source.model) {
    modelsSource = [legacyModel];
  } else {
    modelsSource = [];
  }
  if (definition.builtin && definition.transport !== "codex-cli" && modelsSource.length === 0) {
    modelsSource = [legacyModel];
  }
  const seenModelIds = new Set();
  const models = modelsSource
    .map((modelConfig, index) => normalizeAiModelConfig(provider, modelConfig, index, definition.model))
    .filter((model) => {
      if (!model.model || !model.id || seenModelIds.has(model.id)) return false;
      seenModelIds.add(model.id);
      return true;
    });
  const requestedModelId = typeof source.activeModelId === "string" ? source.activeModelId.slice(0, 256) : "";
  const activeModelId = requestedModelId && models.some((model) => model.id === requestedModelId)
    ? requestedModelId
    : (models[0]?.id || "");
  const activeModel = models.find((model) => model.id === activeModelId) || models[0] || null;
  return {
    provider,
    providerLabel: definition.label,
    transport: definition.transport || "http",
    protocol: definition.protocol,
    builtin: definition.builtin,
    baseUrl: definition.transport === "codex-cli" ? "" : (String(source.baseUrl || definition.baseUrl).slice(0, 2048).trim() || definition.baseUrl),
    apiKey: typeof source.apiKey === "string" ? source.apiKey.slice(0, 16384).trim() : "",
    activeModelId,
    models,
    model: activeModel?.model || "",
    modelId: activeModel?.id || "",
    modelName: activeModel?.name || "",
    testedOk: Boolean(activeModel?.testedOk),
    testedAt: activeModel?.testedAt || "",
    testMessage: activeModel?.testMessage || "",
  };
}

function normalizeAiConfig(config = {}) {
  const source = sourceObject(config);
  const providers = Object.create(null);
  Object.keys(BUILTIN_AI_PROVIDERS).forEach((provider) => {
    const legacy = !source.providers && source.provider === provider ? source : {};
    providers[provider] = normalizeAiProviderConfig(provider, hasOwn(source.providers, provider) ? source.providers[provider] : legacy);
  });
  let customProviderCount = 0;
  const providerSource = source.providers && typeof source.providers === "object" ? source.providers : {};
  for (const rawProvider in providerSource) {
    if (!hasOwn(providerSource, rawProvider) || hasOwn(BUILTIN_AI_PROVIDERS, rawProvider)) continue;
    const provider = safeProviderId(rawProvider);
    const providerConfig = providerSource[rawProvider];
    if (!provider || !providerConfig || typeof providerConfig !== "object") continue;
    providers[provider] = normalizeAiProviderConfig(provider, providerConfig);
    customProviderCount += 1;
    if (customProviderCount >= MAX_CUSTOM_AI_PROVIDERS) break;
  }
  const requestedActiveProvider = safeProviderId(source.activeProvider || source.provider || "gemini");
  const activeProvider = requestedActiveProvider && hasOwn(providers, requestedActiveProvider) ? requestedActiveProvider : "gemini";
  const activeProviderConfig = providers[activeProvider];
  const requestedActiveModelId = typeof source.activeModelId === "string" ? source.activeModelId.slice(0, 256) : "";
  const activeModelId = activeProviderConfig.models.some((model) => model.id === requestedActiveModelId)
    ? requestedActiveModelId
    : activeProviderConfig.activeModelId;
  return { activeProvider, activeModelId, providers };
}

function activeAiProviderConfig(config, preferredProvider = "", preferredModelId = "") {
  const normalized = normalizeAiConfig(config);
  const safePreferredProvider = safeProviderId(preferredProvider);
  const provider = safePreferredProvider && hasOwn(normalized.providers, safePreferredProvider) ? safePreferredProvider : normalized.activeProvider;
  const providerConfig = normalized.providers[provider] || normalized.providers.gemini;
  const model = providerConfig.models.find((item) => item.id === preferredModelId)
    || providerConfig.models.find((item) => item.id === normalized.activeModelId)
    || providerConfig.models[0]
    || null;
  return {
    provider,
    providerLabel: providerConfig.providerLabel,
    transport: providerConfig.transport || "http",
    protocol: providerConfig.protocol,
    builtin: providerConfig.builtin,
    baseUrl: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
    model: model?.model || "",
    modelId: model?.id || "",
    modelName: model?.name || "",
    reasoningEffort: model?.reasoningEffort || model?.defaultReasoningEffort || "",
    supportedReasoningEfforts: model?.supportedReasoningEfforts || [],
    testedOk: Boolean(model?.testedOk),
    testedAt: model?.testedAt || "",
    testMessage: model?.testMessage || "",
  };
}

function publicAiConfig(config, runtimeByProvider = {}) {
  const normalized = normalizeAiConfig(config);
  const active = activeAiProviderConfig(normalized);
  const publicProviders = Object.create(null);
  Object.entries(normalized.providers).forEach(([provider, providerConfig]) => {
    const apiKey = providerConfig.apiKey || "";
    const runtimeSource = hasOwn(runtimeByProvider, provider) ? runtimeByProvider[provider] : null;
    const runtime = runtimeSource ? { ...runtimeSource } : null;
    if (runtime) {
      delete runtime.email;
      delete runtime.models;
    }
    const codexReady = providerConfig.transport === "codex-cli" && Boolean(runtime?.ready);
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
        reasoningEffort: model.reasoningEffort || model.defaultReasoningEffort || "",
        defaultReasoningEffort: model.defaultReasoningEffort || "",
        supportedReasoningEfforts: model.supportedReasoningEfforts || [],
        description: model.description || "",
        catalogManaged: Boolean(model.catalogManaged),
        testedOk: providerConfig.transport === "codex-cli" ? codexReady : Boolean(model.testedOk),
        testedAt: model.testedAt || "",
        testMessage: model.testMessage || "",
      })),
      model: providerConfig.model,
      modelId: providerConfig.modelId,
      modelName: providerConfig.modelName,
      baseUrl: providerConfig.baseUrl,
      hasApiKey: Boolean(apiKey),
      apiKeyLast4: apiKey ? apiKey.slice(-4) : "",
      testedOk: providerConfig.transport === "codex-cli" ? codexReady : Boolean(providerConfig.testedOk),
      testedAt: providerConfig.testedAt || "",
      testMessage: providerConfig.testMessage || "",
      runtime,
    };
  });
  const publicActiveProvider = hasOwn(publicProviders, active.provider) ? publicProviders[active.provider] : publicProviders.gemini;
  const publicActiveModel = publicActiveProvider?.models.find((model) => model.id === active.modelId)
    || publicActiveProvider?.models[0]
    || {};
  return {
    activeProvider: normalized.activeProvider,
    activeModelId: normalized.activeModelId,
    providers: publicProviders,
    provider: active.provider,
    providerLabel: active.providerLabel,
    transport: active.transport || "http",
    protocol: active.protocol,
    modelId: active.modelId,
    modelName: active.modelName,
    model: active.model,
    baseUrl: active.baseUrl,
    hasApiKey: Boolean(active.apiKey),
    apiKeyLast4: active.apiKey ? active.apiKey.slice(-4) : "",
    testedOk: Boolean(publicActiveModel.testedOk),
    testedAt: publicActiveModel.testedAt || active.testedAt || "",
    testMessage: publicActiveModel.testMessage || active.testMessage || "",
    reasoningEffort: active.reasoningEffort || "",
    supportedReasoningEfforts: active.supportedReasoningEfforts || [],
  };
}

function aiEndpoint(config) {
  const suffix = config.protocol === "anthropic" ? "/messages" : "/chat/completions";
  return `${String(config.baseUrl || "").replace(/\/+$/, "")}${suffix}`;
}

function anthropicMessages(messages = []) {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const conversation = [];
  messages.filter((message) => message.role !== "system").forEach((message) => {
    const role = message.role === "assistant" ? "assistant" : "user";
    const previous = conversation[conversation.length - 1];
    if (previous?.role === role) {
      previous.content += `\n\n${message.content}`;
    } else {
      conversation.push({ role, content: message.content });
    }
  });
  return { system, messages: conversation.length ? conversation : [{ role: "user", content: "" }] };
}

function buildAiRequest(config, messages, { stream = false, test = false } = {}) {
  if (config.protocol === "anthropic") {
    const converted = anthropicMessages(messages);
    return {
      url: aiEndpoint(config),
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: config.model,
        max_tokens: test ? 8 : 8192,
        messages: converted.messages,
        ...(converted.system ? { system: converted.system } : {}),
        stream,
      },
    };
  }
  return {
    url: aiEndpoint(config),
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: {
      model: config.model,
      messages,
      ...(test ? { max_tokens: 8 } : {}),
      ...(config.provider === "deepseek" ? { thinking: { type: "enabled" }, reasoning_effort: "max", temperature: 1 } : {}),
      stream,
      ...(stream && config.builtin ? { stream_options: { include_usage: true } } : {}),
    },
  };
}

function mergeAiUsage(protocol, payload, previous = null) {
  if (protocol !== "anthropic") {
    return payload?.usage || previous;
  }
  const source = payload?.type === "message_start" ? payload.message?.usage : payload?.usage;
  if (!source) {
    return previous;
  }
  const promptTokens = source.input_tokens ?? previous?.prompt_tokens ?? 0;
  const completionTokens = source.output_tokens ?? previous?.completion_tokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

function extractAiStreamEvent(protocol, payload) {
  if (protocol === "anthropic") {
    if (payload?.type === "error") {
      return { error: payload.error?.message || "Anthropic 流式请求失败" };
    }
    if (payload?.type === "content_block_delta" && payload.delta?.type === "text_delta") {
      return { delta: payload.delta.text || "" };
    }
    return { done: payload?.type === "message_stop" };
  }
  const choice = payload?.choices?.[0];
  return { delta: choice?.delta?.content || choice?.message?.content || "" };
}

module.exports = {
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
  providerDefinition,
  publicAiConfig,
};
