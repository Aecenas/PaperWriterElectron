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

  return {
    abortAll: () => {
      selectionGenerationRuntime.abortAll();
      generationRuntime.abortAll();
    },
    configFacade: configRuntime.facade,
    generationFacade,
    initialize: configRuntime.initialize,
  };
}

module.exports = {
  createAiRuntime,
};
