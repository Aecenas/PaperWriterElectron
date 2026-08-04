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
const {
  resolveCodexScopeDirectory,
} = require("./codex-scope.cjs");
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
  cancelReader,
  fetchAiResponse,
  readReaderChunk,
  readResponseTextLimited,
  throwIfAborted,
} = require("./ai-http-client.cjs");
const {
  materializeCodexImageAttachments,
  normalizeCodexImageMode,
} = require("./codex-image-attachments.cjs");
const {
  createAiConfigRuntime,
} = require("./ai-config-runtime.cjs");
const {
  createAiGenerationRuntime,
} = require("./ai-generation-runtime.cjs");
const {
  createAiSelectionGenerationRuntime,
} = require("./ai-selection-generation-runtime.cjs");
const {
  createAiHttpRuntime,
} = require("./ai-http-runtime.cjs");
const {
  createHelpAssistantRuntime,
} = require("./help-assistant-runtime.cjs");
const {
  createResearchTranslationRuntime,
} = require("./research-translation-runtime.cjs");

function createAiRuntime({
  fs,
  path,
  safeStorage,
  atomicWriteFile,
  getUserDataPath,
  getTempPath,
  getAppVersion,
  fetchImpl,
  emitRendererEvent,
  emitCodexStatus,
  writeDebugLog,
  readProtocolAsset,
  dialog,
  getMainWindow,
  defaultDocumentsDir,
  sanitizeName,
  timestampForFileName,
  randomUUID,
  limits,
  now,
  AbortControllerApi,
  knowledgeIndexPath,
}) {
  const httpRuntime = createAiHttpRuntime({
    fetchImpl,
    fetchWithAiRedirectPolicy,
    fetchAiResponse,
    readReaderChunk,
    readResponseTextLimited,
    cancelReader,
    throwIfAborted,
    redactSecrets,
    normalizeProviderBaseUrl,
    buildAiRequest,
    extractAiStreamEvent,
    mergeAiUsage,
    emitRendererEvent,
    writeDebugLog,
    limits,
  });

  const configRuntime = createAiConfigRuntime({
    fs,
    path,
    safeStorage,
    atomicWriteFile,
    getUserDataPath,
    getAppVersion,
    normalizeAiConfig,
    decryptProviderSecrets,
    encryptProviderSecrets,
    containsPlaintextSecrets,
    publicAiConfig,
    CODEX_PROVIDER_ID,
    refreshCodexStatus,
    mergeCodexRefreshedModels,
    launchCodexLogin: startCodexLogin,
    emitCodexStatus,
    AI_PROTOCOLS,
    BUILTIN_AI_PROVIDERS,
    normalizeAiRequestParams,
    exactAiProviderConfig,
    normalizeAiModelConfig,
    createAiModelId,
    normalizeAiProtocol,
    normalizeProviderBaseUrl,
    apiKeyCanBeReused,
    createAiTestConfigIdentity,
    commitAiTestResultIfCurrent,
    randomUUID,
    testAiConfig: httpRuntime.testConfig,
    writeDebugLog,
    now,
  });

  const generationRuntime = createAiGenerationRuntime({
    readAiConfig: configRuntime.readConfig,
    activeAiProviderConfig,
    getCodexRuntimeStatus: configRuntime.getCodexRuntimeStatus,
    streamAiCompletion: httpRuntime.streamCompletion,
    resolveAiApplyHttp: httpRuntime.resolveApply,
    throwIfAiAborted: throwIfAborted,
    taskAiProviderConfig,
    aiApplyResolverRequestParams,
    mergeAiRequestParams,
    resolveCodexScopeDirectory,
    streamCodexCompletion,
    normalizeCodexImageMode,
    materializeCodexImageAttachments,
    readProtocolAsset,
    path,
    getTempPath,
    emitRendererEvent,
    writeDebugLog,
    dialog,
    getMainWindow,
    defaultDocumentsDir,
    sanitizeName,
    timestampForFileName,
    atomicWriteFile,
    AbortControllerApi,
  });
  const selectionGenerationRuntime = createAiSelectionGenerationRuntime({
    readAiConfig: configRuntime.readConfig,
    taskAiProviderConfig,
    mergeAiRequestParams,
    getCodexRuntimeStatus: configRuntime.getCodexRuntimeStatus,
    streamAiCompletion: httpRuntime.streamCompletion,
    streamCodexCompletion,
    throwIfAiAborted: throwIfAborted,
    resolveCodexScopeDirectory,
    path,
    getTempPath,
    emitRendererEvent,
    writeDebugLog,
    AbortControllerApi,
  });
  const helpAssistantRuntime = createHelpAssistantRuntime({
    fs,
    path,
    atomicWriteFile,
    getUserDataPath,
    getTempPath,
    getAppVersion,
    randomUUID,
    readAiConfig: configRuntime.readConfig,
    taskAiProviderConfig,
    mergeAiRequestParams,
    getCodexRuntimeStatus: configRuntime.getCodexRuntimeStatus,
    resolveCodexScopeDirectory,
    streamAiCompletion: httpRuntime.streamCompletion,
    streamCodexCompletion,
    throwIfAiAborted: throwIfAborted,
    emitRendererEvent,
    writeDebugLog,
    knowledgeIndexPath,
    now,
    AbortControllerApi,
  });
  const researchTranslationRuntime = createResearchTranslationRuntime({
    readAiConfig: configRuntime.readConfig,
    taskAiProviderConfig,
    mergeAiRequestParams,
    getCodexRuntimeStatus: configRuntime.getCodexRuntimeStatus,
    streamAiCompletion: httpRuntime.streamCompletion,
    streamCodexCompletion,
    throwIfAiAborted: throwIfAborted,
    resolveCodexScopeDirectory,
    path,
    getTempPath,
    emitRendererEvent,
    writeDebugLog,
    AbortControllerApi,
  });
  const generationFacade = Object.freeze({
    ...generationRuntime.facade,
    generateSelectionAi: selectionGenerationRuntime.facade.generate,
    cancel: async (requestId) => {
      const selectionResult = await selectionGenerationRuntime.facade.cancel(
        requestId,
      );
      if (selectionResult.canceled) return selectionResult;
      return generationRuntime.facade.cancel(requestId);
    },
  });
  const compositionTaskKeys = new Set([
    "composeOutline",
    "composeDraft",
    "composeReview",
  ]);
  const compositionModelTaskKey = "composeDraft";

  async function getCompositionModelAssignments() {
    const storedConfig = await configRuntime.readConfig();
    const selected = taskAiProviderConfig(
      storedConfig,
      storedConfig.taskModels?.[compositionModelTaskKey] || {},
    );
    return Object.fromEntries([...compositionTaskKeys].map((taskKey) => {
      return [taskKey, {
        providerId: selected?.provider || "",
        modelId: selected?.modelId || "",
      }];
    }));
  }

  function normalizeTaskUsage(value) {
    const source = value && typeof value === "object" ? value : {};
    const inputTokens = Math.max(
      0,
      Number(source.inputTokens ?? source.prompt_tokens ?? source.input_tokens) || 0,
    );
    const outputTokens = Math.max(
      0,
      Number(source.outputTokens ?? source.completion_tokens ?? source.output_tokens) || 0,
    );
    return {
      inputTokens,
      outputTokens,
      totalTokens: Math.max(
        inputTokens + outputTokens,
        Number(source.totalTokens ?? source.total_tokens) || 0,
      ),
      estimatedCost: Math.max(0, Number(source.estimatedCost) || 0),
    };
  }

  async function completeWithAiConfig({
    config,
    messages,
    signal,
    onDelta,
    requestKind = "task",
    unavailableMessage = "所选 AI 模型当前不可用",
  } = {}) {
    throwIfAborted(signal);
    if (!config) throw new Error(unavailableMessage);
    if (config.transport === "codex-cli") {
      const status = configRuntime.getCodexRuntimeStatus();
      if (!status.ready || !status.executablePath || !config.model) {
        throw new Error(status.message || unavailableMessage);
      }
    } else if (!config.apiKey || !config.testedOk) {
      throw new Error(unavailableMessage);
    }
    const safeMessages = (Array.isArray(messages) ? messages : [])
      .slice(-100)
      .map((message) => ({
        role: ["system", "user", "assistant"].includes(message?.role)
          ? message.role
          : "user",
        content: String(message?.content || "").slice(0, 2 * 1024 * 1024),
      }))
      .filter((message) => message.content.trim());
    if (!safeMessages.length) throw new Error("AI 请求缺少内容");
    let output = "";
    const append = (value) => {
      throwIfAborted(signal);
      const delta = String(value || "");
      if (!delta) return;
      output += delta;
      if (output.length > 8 * 1024 * 1024) {
        throw new Error("AI 输出超过安全上限");
      }
      onDelta?.(delta);
    };
    let usage;
    if (config.transport === "codex-cli") {
      usage = await streamCodexCompletion({
        executable: configRuntime.getCodexRuntimeStatus().executablePath,
        config,
        messages: safeMessages,
        cwd: getTempPath(),
        scope: { mode: "document-only", relativePath: "" },
        signal,
        onDelta: append,
      });
    } else {
      const collector = {
        isDestroyed: () => false,
        send(channel, payload) {
          if (channel === "ai:chunk") append(payload?.delta);
        },
      };
      usage = await httpRuntime.streamCompletion(
        collector,
        `${requestKind}-${randomUUID()}`,
        config,
        safeMessages,
        signal,
      );
    }
    throwIfAborted(signal);
    return {
      text: output,
      usage: normalizeTaskUsage(usage),
      model: {
        providerId: config.provider,
        modelId: config.modelId,
        modelName: config.modelName,
      },
    };
  }

  async function completeSelectedAiTask({
    providerId,
    modelId,
    messages,
    signal,
    onDelta,
    requestKind = "collaboration",
  } = {}) {
    const storedConfig = await configRuntime.readConfig();
    const config = (providerId && modelId)
      ? exactAiProviderConfig(storedConfig, providerId, modelId)
      : activeAiProviderConfig(storedConfig, providerId, modelId);
    return completeWithAiConfig({
      config,
      messages,
      signal,
      onDelta,
      requestKind,
      unavailableMessage: "AI 协作所选模型已失效，请重新选择已测试模型",
    });
  }

  async function completeCompositionTask({
    taskKey,
    messages,
    modelAssignment,
    signal,
    onDelta,
  } = {}) {
    if (!compositionTaskKeys.has(taskKey)) {
      throw new Error("不支持的 AI 起稿模型任务");
    }
    throwIfAborted(signal);
    const storedConfig = await configRuntime.readConfig();
    const requestedAssignment = modelAssignment
      && typeof modelAssignment === "object"
      && (modelAssignment.providerId || modelAssignment.modelId)
      ? modelAssignment
      : storedConfig.taskModels?.[compositionModelTaskKey] || {};
    const assignment = {
      ...requestedAssignment,
      requestParams: storedConfig.taskModels?.[compositionModelTaskKey]?.requestParams || {},
    };
    const selected = taskAiProviderConfig(storedConfig, assignment);
    if (!selected) {
      throw new Error("AI 起稿任务模型已失效，请在 AI 配置中重新选择");
    }
    const config = {
      ...selected,
      requestParams: selected.transport === "codex-cli"
        ? {}
        : mergeAiRequestParams(
          selected.requestParams,
          assignment.requestParams,
        ),
    };
    return completeWithAiConfig({
      config,
      messages,
      signal,
      onDelta,
      requestKind: `composition-${taskKey}`,
      unavailableMessage: "AI 起稿请选择已测试可用的模型",
    });
  }

  return {
    abortAll: () => {
      selectionGenerationRuntime.abortAll();
      generationRuntime.abortAll();
      void helpAssistantRuntime.abortAll();
      researchTranslationRuntime.abortAll();
    },
    configFacade: configRuntime.facade,
    generationFacade,
    helpAssistantFacade: helpAssistantRuntime.facade,
    researchTranslationFacade: researchTranslationRuntime.facade,
    initialize: async () => {
      await configRuntime.initialize();
      await helpAssistantRuntime.initialize();
    },
    profileFacade: configRuntime.profileFacade,
    completeCompositionTask,
    completeSelectedAiTask,
    getCompositionModelAssignments,
  };
}

module.exports = {
  createAiRuntime,
};
