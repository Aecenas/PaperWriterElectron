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

function normalizeAiProtocol(value) {
  return Object.prototype.hasOwnProperty.call(AI_PROTOCOLS, value) ? value : "openai";
}

function createAiModelId(provider, model = "") {
  const source = String(model || "default").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${provider}-${source || "model"}`;
}

function providerDefinition(provider, config = {}) {
  const builtin = BUILTIN_AI_PROVIDERS[provider];
  if (builtin) {
    return { id: provider, transport: "http", ...builtin, builtin: true };
  }
  const protocol = normalizeAiProtocol(config.protocol);
  return {
    id: provider,
    label: String(config.providerLabel || config.label || "自定义供应商").trim() || "自定义供应商",
    transport: "http",
    protocol,
    baseUrl: String(config.baseUrl || AI_PROTOCOLS[protocol].baseUrl).trim() || AI_PROTOCOLS[protocol].baseUrl,
    model: "",
    builtin: false,
  };
}

function normalizeAiModelConfig(provider, config = {}, index = 0, fallbackModel = "") {
  const model = String(config.model || fallbackModel || "").trim();
  return {
    id: String(config.id || createAiModelId(provider, model || String(index + 1))).trim(),
    name: String(config.name || config.modelName || (index === 0 ? "默认模型" : `模型 ${index + 1}`)).trim() || `模型 ${index + 1}`,
    model,
    reasoningEffort: typeof config.reasoningEffort === "string" ? config.reasoningEffort : "",
    defaultReasoningEffort: typeof config.defaultReasoningEffort === "string" ? config.defaultReasoningEffort : "",
    supportedReasoningEfforts: Array.isArray(config.supportedReasoningEfforts)
      ? config.supportedReasoningEfforts.map((option) => ({
        reasoningEffort: String(option?.reasoningEffort || option || "").trim(),
        description: String(option?.description || "").trim(),
      })).filter((option) => option.reasoningEffort)
      : [],
    description: typeof config.description === "string" ? config.description : "",
    catalogManaged: Boolean(config.catalogManaged),
    testedOk: Boolean(config.testedOk),
    testedAt: typeof config.testedAt === "string" ? config.testedAt : "",
    testMessage: typeof config.testMessage === "string" ? config.testMessage : "",
  };
}

function normalizeAiProviderConfig(provider, config = {}) {
  const definition = providerDefinition(provider, config);
  const legacyModel = {
    id: config.activeModelId || createAiModelId(provider, config.model || definition.model),
    name: config.modelName || "默认模型",
    model: config.model || definition.model,
    testedOk: config.testedOk,
    testedAt: config.testedAt,
    testMessage: config.testMessage,
  };
  let modelsSource;
  if (Array.isArray(config.models)) {
    modelsSource = config.models;
  } else if ((definition.builtin && definition.transport !== "codex-cli") || config.model) {
    modelsSource = [legacyModel];
  } else {
    modelsSource = [];
  }
  if (definition.builtin && definition.transport !== "codex-cli" && modelsSource.length === 0) {
    modelsSource = [legacyModel];
  }
  const models = modelsSource
    .map((modelConfig, index) => normalizeAiModelConfig(provider, modelConfig, index, definition.model))
    .filter((model) => model.model);
  const activeModelId = config.activeModelId && models.some((model) => model.id === config.activeModelId)
    ? config.activeModelId
    : (models[0]?.id || "");
  const activeModel = models.find((model) => model.id === activeModelId) || models[0] || null;
  return {
    provider,
    providerLabel: definition.label,
    transport: definition.transport || "http",
    protocol: definition.protocol,
    builtin: definition.builtin,
    baseUrl: definition.transport === "codex-cli" ? "" : (String(config.baseUrl || definition.baseUrl).trim() || definition.baseUrl),
    apiKey: typeof config.apiKey === "string" ? config.apiKey.trim() : "",
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
  const providers = {};
  Object.keys(BUILTIN_AI_PROVIDERS).forEach((provider) => {
    const legacy = !config.providers && config.provider === provider ? config : {};
    providers[provider] = normalizeAiProviderConfig(provider, config.providers?.[provider] || legacy);
  });
  Object.entries(config.providers || {}).forEach(([provider, providerConfig]) => {
    if (!BUILTIN_AI_PROVIDERS[provider] && providerConfig && typeof providerConfig === "object") {
      providers[provider] = normalizeAiProviderConfig(provider, providerConfig);
    }
  });
  const requestedActiveProvider = String(config.activeProvider || config.provider || "gemini");
  const activeProvider = providers[requestedActiveProvider] ? requestedActiveProvider : "gemini";
  const activeProviderConfig = providers[activeProvider];
  const activeModelId = activeProviderConfig.models.some((model) => model.id === config.activeModelId)
    ? config.activeModelId
    : activeProviderConfig.activeModelId;
  return { activeProvider, activeModelId, providers };
}

function activeAiProviderConfig(config, preferredProvider = "", preferredModelId = "") {
  const normalized = normalizeAiConfig(config);
  const provider = normalized.providers[preferredProvider] ? preferredProvider : normalized.activeProvider;
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
  const publicProviders = {};
  Object.entries(normalized.providers).forEach(([provider, providerConfig]) => {
    const apiKey = providerConfig.apiKey || "";
    const runtimeSource = runtimeByProvider[provider] || null;
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
  const publicActiveProvider = publicProviders[active.provider] || publicProviders.gemini;
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
