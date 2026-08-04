const AI_CONFIG_FILE = "ai-config.json";
const AI_TASK_MODEL_KEYS = Object.freeze([
  "selectionChat",
  "applyResolver",
  "helpAssistant",
  "researchTranslation",
  "composeDraft",
]);
const AI_TASK_MODEL_KEY_SET = new Set(AI_TASK_MODEL_KEYS);
const AI_TASK_MODEL_ASSIGNMENT_KEYS = new Set([
  "providerId",
  "modelId",
  "requestParams",
]);

function createAiConfigRuntime({
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
  launchCodexLogin,
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
  testAiConfig,
  writeDebugLog,
  now = () => new Date(),
}) {
  let aiConfigMutationTail = Promise.resolve();
  let codexRuntimeStatus = {
    installed: false,
    authenticated: false,
    ready: false,
    catalogFresh: false,
    checkedAt: "",
    message: "尚未检查本地 Codex CLI",
  };

  function aiConfigPath() {
    return path.join(getUserDataPath(), AI_CONFIG_FILE);
  }

  function resolveAiProvider(config, provider) {
    const normalized = normalizeAiConfig(config);
    return Object.prototype.hasOwnProperty.call(
      normalized.providers,
      provider,
    )
      ? provider
      : normalized.activeProvider;
  }

  async function readAiConfig() {
    try {
      const raw = await fs.readFile(aiConfigPath(), "utf8");
      return normalizeAiConfig(
        decryptProviderSecrets(JSON.parse(raw), safeStorage),
      );
    } catch {
      return normalizeAiConfig();
    }
  }

  function publicAiConfigWithRuntime(config) {
    return publicAiConfig(
      config,
      { [CODEX_PROVIDER_ID]: codexRuntimeStatus },
    );
  }

  function getCodexRuntimeStatus() {
    return codexRuntimeStatus;
  }

  async function queueAiConfigMutation(task) {
    const current = aiConfigMutationTail
      .catch(() => {})
      .then(task);
    aiConfigMutationTail = current;
    return current;
  }

  async function persistAiConfig(config) {
    const stored = encryptProviderSecrets(
      normalizeAiConfig(config),
      safeStorage,
    );
    await atomicWriteFile(
      aiConfigPath(),
      `${JSON.stringify(stored, null, 2)}\n`,
    );
  }

  async function migratePlaintextAiSecrets() {
    try {
      const raw = await fs.readFile(aiConfigPath(), "utf8");
      const parsed = JSON.parse(raw);
      if (!containsPlaintextSecrets(parsed)) {
        return;
      }
      await persistAiConfig(
        normalizeAiConfig(
          decryptProviderSecrets(parsed, safeStorage),
        ),
      );
    } catch (error) {
      if (error?.code !== "ENOENT") {
        await writeDebugLog("ai:config:migration-error", {
          message: error?.message,
        });
      }
    }
  }

  async function refreshCodexCliConfigUnlocked() {
    const existing = await readAiConfig();
    const previousProvider = existing.providers[CODEX_PROVIDER_ID];
    const status = await refreshCodexStatus({
      previousModels: previousProvider.models,
      appVersion: getAppVersion(),
    });
    // Codex inspection can take several seconds. Re-read before persisting so
    // external updates or a future mutation implementation cannot be replaced
    // by the stale snapshot captured before inspection.
    const latest = await readAiConfig();
    const latestProvider = latest.providers[CODEX_PROVIDER_ID];
    const models = Array.isArray(status.models)
      ? mergeCodexRefreshedModels(
        latestProvider.models,
        status.models,
      )
      : latestProvider.models;
    const activeModelId = models.some(
      (model) => model.id === latestProvider.activeModelId,
    )
      ? latestProvider.activeModelId
      : (
        models.find((model) => model.catalogDefault)?.id
        || models[0]?.id
        || ""
      );
    const next = normalizeAiConfig({
      ...latest,
      activeModelId: latest.activeProvider === CODEX_PROVIDER_ID
        ? activeModelId
        : latest.activeModelId,
      providers: {
        ...latest.providers,
        [CODEX_PROVIDER_ID]: {
          ...latestProvider,
          activeModelId,
          models,
        },
      },
    });
    await persistAiConfig(next);
    const { models: _models, email, ...runtime } = status;
    codexRuntimeStatus = {
      ...runtime,
      accountLabel: email
        ? email.replace(/^(.{2}).*(@.*)$/, "$1•••$2")
        : "",
      ready: Boolean(
        status.authenticated
        && models.length
        && activeModelId
      ),
    };
    return publicAiConfigWithRuntime(next);
  }

  function refreshCodexCliConfig() {
    return queueAiConfigMutation(refreshCodexCliConfigUnlocked);
  }

  function validateAiRequestParamsPatch(value) {
    if (value === undefined) {
      return {};
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("请求参数必须是 Key-Value 对象");
    }
    const normalized = normalizeAiRequestParams(value);
    let sourceJson = "";
    try {
      sourceJson = JSON.stringify(value);
    } catch {
      throw new Error("请求参数包含无法保存的值");
    }
    if (sourceJson !== JSON.stringify(normalized)) {
      throw new Error("请求参数包含空键、保留字段、危险键或无效值");
    }
    return normalized;
  }

  function mergeAndValidateAiTaskModels(existing, taskModelsPatch) {
    if (taskModelsPatch === undefined) {
      return existing.taskModels;
    }
    if (
      !taskModelsPatch
      || typeof taskModelsPatch !== "object"
      || Array.isArray(taskModelsPatch)
      || Object.keys(taskModelsPatch).some(
        (taskKey) => !AI_TASK_MODEL_KEY_SET.has(taskKey),
      )
    ) {
      throw new Error("任务模型配置无效");
    }
    const patchedTaskModels = {
      ...existing.taskModels,
      ...taskModelsPatch,
    };
    const touchedTaskKeys = [];
    for (const taskKey of AI_TASK_MODEL_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(taskModelsPatch, taskKey)) {
        continue;
      }
      touchedTaskKeys.push(taskKey);
      const source = taskModelsPatch[taskKey];
      if (
        !source
        || typeof source !== "object"
        || Array.isArray(source)
        || Object.keys(source).some(
          (key) => !AI_TASK_MODEL_ASSIGNMENT_KEYS.has(key),
        )
        || (
          source.providerId !== undefined
          && typeof source.providerId !== "string"
        )
        || (
          source.modelId !== undefined
          && typeof source.modelId !== "string"
        )
      ) {
        throw new Error("任务模型配置无效");
      }
      const hasProvider = Boolean(source.providerId?.trim());
      const hasModel = Boolean(source.modelId?.trim());
      if (hasProvider !== hasModel) {
        throw new Error("任务模型必须同时指定供应商和模型");
      }
      patchedTaskModels[taskKey] = {
        ...source,
        requestParams: validateAiRequestParamsPatch(
          source.requestParams,
        ),
      };
    }
    const merged = normalizeAiConfig({
      ...existing,
      taskModels: patchedTaskModels,
    }).taskModels;
    for (const taskKey of touchedTaskKeys) {
      const assignment = merged[taskKey];
      if (!assignment.providerId && !assignment.modelId) {
        continue;
      }
      const resolver = exactAiProviderConfig(
        existing,
        assignment.providerId,
        assignment.modelId,
      );
      if (!resolver) {
        throw new Error("任务模型只能选择已连接供应商中的已连接模型");
      }
      if (resolver.transport === "codex-cli") {
        if (Object.keys(assignment.requestParams || {}).length) {
          throw new Error("Codex CLI 任务模型不支持 HTTP 请求参数");
        }
        if (!codexRuntimeStatus.ready) {
          throw new Error("任务模型所选 Codex CLI 当前不可用");
        }
      } else if (!resolver.apiKey || !resolver.testedOk) {
        throw new Error("任务模型只能选择已连接供应商中的已连接模型");
      }
    }
    return merged;
  }

  async function saveAiConfigUnlocked(patch = {}) {
    const existing = await readAiConfig();
    const nextTaskModels = mergeAndValidateAiTaskModels(
      existing,
      patch.taskModels,
    );
    const provider = resolveAiProvider(
      existing,
      patch.provider || existing.activeProvider,
    );
    const previousProviderConfig = existing.providers[provider];
    if (Array.isArray(patch.models)) {
      patch.models.forEach((model) => {
        validateAiRequestParamsPatch(model?.requestParams || {});
      });
    }
    const nextProviderLabel = previousProviderConfig.builtin
      ? previousProviderConfig.providerLabel
      : String(
        patch.providerLabel
        ?? previousProviderConfig.providerLabel,
      ).slice(0, 1024).trim().slice(0, 120);
    if (!nextProviderLabel) {
      throw new Error("请填写供应商名称");
    }
    if (
      !previousProviderConfig.builtin
      && Object.values(existing.providers).some(
        (item) => (
          item.provider !== provider
          && item.providerLabel.toLocaleLowerCase()
            === nextProviderLabel.toLocaleLowerCase()
        ),
      )
    ) {
      throw new Error("供应商名称已存在");
    }
    const hasModelPatch = Boolean(
      patch.modelId
      || patch.model
      || (Array.isArray(patch.models) && patch.models.length),
    );
    const modelId = hasModelPatch
      ? String(
        patch.modelId
        || previousProviderConfig.activeModelId
        || createAiModelId(
          provider,
          patch.model || previousProviderConfig.model,
        ),
      ).slice(0, 256).trim()
      : "";
    const previousModels = Array.isArray(patch.models)
      ? patch.models
        .slice(0, 256)
        .map(
          (modelConfig, index) => normalizeAiModelConfig(
            provider,
            modelConfig,
            index,
          ),
        )
      : (previousProviderConfig.models || []);
    const existingModel = previousModels.find(
      (model) => model.id === modelId,
    );
    const nextModel = hasModelPatch
      ? normalizeAiModelConfig(provider, {
        ...(existingModel || {}),
        id: modelId,
        name: patch.modelName || existingModel?.name,
        model: patch.model || existingModel?.model,
        testedOk: (patch.resetTest || patch.clearApiKey)
          ? false
          : existingModel?.testedOk,
        testedAt: (patch.resetTest || patch.clearApiKey)
          ? ""
          : existingModel?.testedAt,
        testMessage: (patch.resetTest || patch.clearApiKey)
          ? ""
          : existingModel?.testMessage,
      })
      : null;
    const updatedModels = !nextModel
      ? previousModels
      : (
        existingModel
          ? previousModels.map(
            (model) => (model.id === modelId ? nextModel : model),
          )
          : [...previousModels, nextModel]
      );
    const isCodexProvider = previousProviderConfig.transport === "codex-cli";
    const nextBaseUrl = isCodexProvider
      ? ""
      : (
        patch.baseUrl
          ? normalizeProviderBaseUrl(patch.baseUrl)
          : previousProviderConfig.baseUrl
      );
    const patchedApiKey = typeof patch.apiKey === "string"
      ? patch.apiKey.slice(0, 16384).trim()
      : "";
    const explicitApiKey = Boolean(patchedApiKey);
    const canReuseApiKey = isCodexProvider || apiKeyCanBeReused(
      previousProviderConfig.baseUrl,
      nextBaseUrl,
    );
    const resetConnectionTest = !isCodexProvider && Boolean(
      patch.clearApiKey
      || patch.resetTest
      || !canReuseApiKey
      || nextBaseUrl !== previousProviderConfig.baseUrl,
    );
    const previousModelsById = new Map(
      (previousProviderConfig.models || [])
        .map((model) => [model.id, model]),
    );
    const nextModels = updatedModels.map((model) => {
      const previousModel = previousModelsById.get(model.id);
      const requestParamsChanged = Boolean(previousModel)
        && JSON.stringify(previousModel.requestParams || {})
          !== JSON.stringify(model.requestParams || {});
      return resetConnectionTest || requestParamsChanged
        ? {
          ...model,
          testedOk: false,
          testedAt: "",
          testMessage: "",
        }
        : model;
    });
    const apiKey = isCodexProvider
      ? ""
      : (
        patch.clearApiKey
        || (!canReuseApiKey && !explicitApiKey)
          ? ""
          : (
            explicitApiKey
              ? patchedApiKey
              : previousProviderConfig.apiKey
          )
      );
    const next = normalizeAiConfig({
      ...existing,
      taskModels: nextTaskModels,
      activeProvider: patch.activate === true
        ? provider
        : existing.activeProvider,
      activeModelId: patch.activate === true
        ? modelId
        : existing.activeModelId,
      providers: {
        ...existing.providers,
        [provider]: {
          ...previousProviderConfig,
          providerLabel: nextProviderLabel,
          baseUrl: nextBaseUrl,
          apiKey,
          activeModelId: patch.activate === true && modelId
            ? modelId
            : previousProviderConfig.activeModelId,
          models: nextModels,
        },
      },
    });
    await persistAiConfig(next);
    return next;
  }

  function saveAiConfig(patch = {}) {
    return queueAiConfigMutation(
      () => saveAiConfigUnlocked(patch),
    );
  }

  async function createAiProviderUnlocked(input = {}) {
    const existing = await readAiConfig();
    const providerLabel = String(
      input.providerLabel || input.label || "",
    ).slice(0, 1024).trim().slice(0, 120);
    if (!providerLabel) {
      throw new Error("请填写供应商名称");
    }
    const duplicate = Object.values(existing.providers).some(
      (provider) => (
        provider.providerLabel.toLocaleLowerCase()
        === providerLabel.toLocaleLowerCase()
      ),
    );
    if (duplicate) {
      throw new Error("供应商名称已存在");
    }
    const protocol = normalizeAiProtocol(input.protocol);
    const baseUrl = normalizeProviderBaseUrl(
      input.baseUrl || AI_PROTOCOLS[protocol].baseUrl,
    );
    const provider = `custom-${randomUUID()}`;
    const next = normalizeAiConfig({
      ...existing,
      providers: {
        ...existing.providers,
        [provider]: {
          provider,
          providerLabel,
          protocol,
          builtin: false,
          baseUrl,
          apiKey: "",
          activeModelId: "",
          models: [],
        },
      },
    });
    await persistAiConfig(next);
    return { config: next, provider };
  }

  function createAiProvider(input = {}) {
    return queueAiConfigMutation(
      () => createAiProviderUnlocked(input),
    );
  }

  async function deleteAiProviderUnlocked(provider) {
    const existing = await readAiConfig();
    const providerConfig = existing.providers[provider];
    if (!providerConfig) {
      throw new Error("供应商不存在");
    }
    if (
      providerConfig.builtin
      || Object.prototype.hasOwnProperty.call(
        BUILTIN_AI_PROVIDERS,
        provider,
      )
    ) {
      throw new Error("内置供应商不可删除");
    }
    if (existing.activeProvider === provider) {
      throw new Error("请先切换默认供应商后再删除");
    }
    const providers = { ...existing.providers };
    delete providers[provider];
    const next = normalizeAiConfig({ ...existing, providers });
    await persistAiConfig(next);
    return next;
  }

  function deleteAiProvider(provider) {
    return queueAiConfigMutation(
      () => deleteAiProviderUnlocked(provider),
    );
  }

  function storedAiTestConfigIdentity(
    config,
    provider,
    modelId,
  ) {
    const providerExists = Boolean(
      config?.providers
      && Object.prototype.hasOwnProperty.call(
        config.providers,
        provider,
      ),
    );
    const providerConfig = providerExists
      ? config.providers[provider]
      : null;
    const modelConfig = providerConfig?.models?.find(
      (model) => model.id === modelId,
    ) || null;
    return createAiTestConfigIdentity({
      provider: providerExists ? provider : "",
      protocol: providerConfig?.protocol || "",
      modelId,
      modelPresent: Boolean(modelConfig),
      modelName: modelConfig?.name || "",
      model: modelConfig?.model || "",
      requestParams: modelConfig?.requestParams || {},
      baseUrl: providerConfig?.baseUrl || "",
      apiKey: providerConfig?.apiKey || "",
    });
  }

  async function updateAiProviderTestStateUnlocked(
    provider,
    modelId,
    testState,
    expectedIdentity,
  ) {
    return commitAiTestResultIfCurrent({
      expectedIdentity,
      readCurrent: readAiConfig,
      identityFromCurrent: (current) => (
        storedAiTestConfigIdentity(
          current,
          provider,
          modelId,
        )
      ),
      commit: async (existing) => {
        const previousProviderConfig = existing.providers[provider];
        const normalizedModelId = String(
          modelId
          || previousProviderConfig.activeModelId
          || createAiModelId(
            provider,
            testState.model || previousProviderConfig.model,
          ),
        ).slice(0, 256).trim();
        const previousModels = previousProviderConfig.models || [];
        const existingModel = previousModels.find(
          (model) => model.id === normalizedModelId,
        );
        const nextModel = normalizeAiModelConfig(provider, {
          ...(existingModel || {}),
          id: normalizedModelId,
          name: testState.modelName || existingModel?.name,
          ...testState,
        });
        const nextModels = existingModel
          ? previousModels.map(
            (model) => (
              model.id === normalizedModelId
                ? nextModel
                : model
            ),
          )
          : [...previousModels, nextModel];
        const next = normalizeAiConfig({
          ...existing,
          activeProvider: existing.activeProvider,
          providers: {
            ...existing.providers,
            [provider]: {
              ...previousProviderConfig,
              baseUrl: testState.baseUrl
                ? normalizeProviderBaseUrl(testState.baseUrl)
                : previousProviderConfig.baseUrl,
              apiKey: testState.apiKey
                || previousProviderConfig.apiKey,
              models: nextModels,
            },
          },
        });
        await persistAiConfig(next);
        return next;
      },
    });
  }

  function updateAiProviderTestState(
    provider,
    modelId,
    testState,
    expectedIdentity,
  ) {
    return queueAiConfigMutation(
      () => updateAiProviderTestStateUnlocked(
        provider,
        modelId,
        testState,
        expectedIdentity,
      ),
    );
  }

  async function getConfig() {
    return publicAiConfigWithRuntime(await readAiConfig());
  }

  async function refreshCodex() {
    const config = await refreshCodexCliConfig();
    const runtimeStatus = getCodexRuntimeStatus();
    await writeDebugLog("ai:codex:refreshed", {
      installed: runtimeStatus.installed,
      authenticated: runtimeStatus.authenticated,
      ready: runtimeStatus.ready,
      version: runtimeStatus.version,
    });
    return {
      ...config,
      ok: runtimeStatus.ready,
      message: runtimeStatus.message,
    };
  }

  async function startLogin() {
    let runtimeStatus = getCodexRuntimeStatus();
    if (!runtimeStatus.executablePath) {
      await refreshCodexCliConfig();
      runtimeStatus = getCodexRuntimeStatus();
    }
    if (!runtimeStatus.executablePath) {
      return {
        ...publicAiConfigWithRuntime(await readAiConfig()),
        ok: false,
        message: "未检测到 Codex CLI",
      };
    }
    launchCodexLogin(runtimeStatus.executablePath, () => {
      refreshCodexCliConfig()
        .then((config) => {
          emitCodexStatus(config);
        })
        .catch(() => {});
    });
    return {
      ...publicAiConfigWithRuntime(await readAiConfig()),
      ok: true,
      message: "已启动 Codex 登录",
    };
  }

  async function createProvider(input = {}) {
    const result = await createAiProvider(input);
    await writeDebugLog("ai:provider:created", {
      provider: result.provider,
      protocol: input?.protocol,
    });
    return {
      ...publicAiConfigWithRuntime(result.config),
      createdProvider: result.provider,
      ok: true,
    };
  }

  async function deleteProvider(provider) {
    const config = await deleteAiProvider(provider);
    await writeDebugLog("ai:provider:deleted", { provider });
    return {
      ...publicAiConfigWithRuntime(config),
      ok: true,
    };
  }

  async function saveConfig(patch = {}) {
    const config = await saveAiConfig(patch);
    await writeDebugLog("ai:config:saved", {
      provider: patch?.provider || config.activeProvider,
      model: patch?.model || "",
      hasApiKey: Boolean(patch?.apiKey),
    });
    return publicAiConfigWithRuntime(config);
  }

  async function testConfig(patch = {}) {
    const initial = await readAiConfig();
    const provider = resolveAiProvider(initial, patch?.provider);
    const initialProviderConfig = initial.providers[provider];
    const modelId = String(
      patch?.modelId
      || initialProviderConfig.activeModelId
      || createAiModelId(
        provider,
        patch?.model || initialProviderConfig.model,
      ),
    ).slice(0, 256).trim();
    const initialModelConfig = initialProviderConfig.models.find(
      (model) => model.id === modelId,
    ) || initialProviderConfig.models[0];
    const expectedIdentity = storedAiTestConfigIdentity(
      initial,
      provider,
      modelId,
    );
    let persistedFailureBaseUrl = initialProviderConfig.baseUrl;
    let persistedFailureApiKey = initialProviderConfig.apiKey;
    try {
      const baseUrl = normalizeProviderBaseUrl(
        patch?.baseUrl || initialProviderConfig.baseUrl,
      );
      const explicitApiKey = typeof patch?.apiKey === "string"
        && Boolean(patch.apiKey.slice(0, 16384).trim());
      if (
        !apiKeyCanBeReused(
          initialProviderConfig.baseUrl,
          baseUrl,
        )
        && !explicitApiKey
      ) {
        throw new Error(
          "Base URL 的服务来源已改变，请重新输入 API Key 后再测试",
        );
      }
      const apiKey = explicitApiKey
        ? patch.apiKey.slice(0, 16384).trim()
        : initialProviderConfig.apiKey;
      persistedFailureBaseUrl = baseUrl;
      persistedFailureApiKey = apiKey;
      const config = {
        provider,
        providerLabel: initialProviderConfig.providerLabel,
        protocol: initialProviderConfig.protocol,
        builtin: initialProviderConfig.builtin,
        modelId,
        modelName: String(
          patch?.modelName || initialModelConfig?.name || "",
        ).slice(0, 256),
        model: String(
          patch?.model
          || initialModelConfig?.model
          || initialProviderConfig.model
          || "",
        ).slice(0, 256),
        requestParams: initialModelConfig?.requestParams || {},
        baseUrl,
        apiKey,
      };
      await testAiConfig(config);
      const commitResult = await updateAiProviderTestState(
        provider,
        modelId,
        {
          modelName: config.modelName,
          model: config.model,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          testedOk: true,
          testedAt: now().toISOString(),
          testMessage: "AI 连接可用",
        },
        expectedIdentity,
      );
      if (commitResult.stale) {
        await writeDebugLog("ai:test:stale", {
          provider: config.provider,
          model: config.model,
        });
        return {
          ...publicAiConfigWithRuntime(commitResult.config),
          ok: false,
          stale: true,
          message: "AI 配置已变化，请重新测试",
        };
      }
      const next = commitResult.config;
      await writeDebugLog("ai:test:success", {
        provider: config.provider,
        model: config.model,
      });
      return {
        ...publicAiConfigWithRuntime(next),
        ok: true,
        message: "AI 连接可用",
      };
    } catch (error) {
      const commitResult = await updateAiProviderTestState(
        provider,
        modelId,
        {
          modelName: patch?.modelName || initialModelConfig?.name,
          model: patch?.model
            || initialModelConfig?.model
            || initialProviderConfig.model,
          baseUrl: persistedFailureBaseUrl,
          apiKey: persistedFailureApiKey,
          testedOk: false,
          testedAt: now().toISOString(),
          testMessage: error?.message || "AI 连接失败",
        },
        expectedIdentity,
      );
      if (commitResult.stale) {
        await writeDebugLog("ai:test:stale", {
          provider,
          model: patch?.model,
          message: error?.message,
        });
        return {
          ...publicAiConfigWithRuntime(commitResult.config),
          ok: false,
          stale: true,
          message: "AI 配置已变化，请重新测试",
        };
      }
      const next = commitResult.config;
      await writeDebugLog("ai:test:error", {
        provider: patch?.provider,
        model: patch?.model,
        baseUrl: patch?.baseUrl,
        message: error?.message,
        causeCode: error?.cause?.code,
        causeMessage: error?.cause?.message,
      });
      return {
        ...publicAiConfigWithRuntime(next),
        ok: false,
        message: error?.message || "AI 连接失败",
      };
    }
  }

  const facade = Object.freeze({
    createProvider,
    deleteProvider,
    getConfig,
    refreshCodex,
    saveConfig,
    startLogin,
    testConfig,
  });
  const profileFacade = Object.freeze({
    readConfig: readAiConfig,
    replaceConfig: (config) => queueAiConfigMutation(async () => {
      const normalized = normalizeAiConfig(config);
      await persistAiConfig(normalized);
      return normalized;
    }),
  });

  return {
    facade,
    getCodexRuntimeStatus,
    initialize: migratePlaintextAiSecrets,
    profileFacade,
    readConfig: readAiConfig,
  };
}

module.exports = {
  createAiConfigRuntime,
};
