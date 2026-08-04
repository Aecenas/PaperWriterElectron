const {
  RESEARCH_TRANSLATION_REQUEST_ID_PATTERN,
  batchResearchTranslationBlocks,
  buildResearchTranslationMessages,
  createResearchTranslationError,
  normalizeResearchTranslationPayload,
  parseResearchTranslationResponse,
} = require("./research-translation-core.cjs");

const RESEARCH_TRANSLATION_CONCURRENT_REQUEST_LIMIT = 2;

function normalizedUsage(value = {}) {
  const inputTokens = Math.max(0, Number(value.inputTokens ?? value.prompt_tokens ?? value.input_tokens) || 0);
  const outputTokens = Math.max(0, Number(value.outputTokens ?? value.completion_tokens ?? value.output_tokens) || 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(inputTokens + outputTokens, Number(value.totalTokens ?? value.total_tokens) || 0),
    estimatedCost: Math.max(0, Number(value.estimatedCost) || 0),
  };
}

function addUsage(left, right) {
  const a = normalizedUsage(left);
  const b = normalizedUsage(right);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimatedCost: a.estimatedCost + b.estimatedCost,
  };
}

function createResearchTranslationRuntime({
  readAiConfig,
  taskAiProviderConfig,
  mergeAiRequestParams,
  getCodexRuntimeStatus,
  streamAiCompletion,
  streamCodexCompletion,
  throwIfAiAborted,
  resolveCodexScopeDirectory,
  path,
  getTempPath,
  emitRendererEvent,
  writeDebugLog,
  concurrentRequestLimit = RESEARCH_TRANSLATION_CONCURRENT_REQUEST_LIMIT,
  AbortControllerApi = AbortController,
}) {
  const activeRequests = new Map();

  function resolveTaskConfig(storedConfig) {
    const assignment = storedConfig.taskModels?.researchTranslation || {};
    const explicitAssignment = Boolean(assignment.providerId || assignment.modelId);
    const selected = taskAiProviderConfig(storedConfig, assignment);
    if (!selected) {
      throw createResearchTranslationError(
        explicitAssignment
          ? "资料翻译模型已失效，请在“AI 配置 → 任务模型”中重新选择"
          : "请先配置并测试默认模型",
        explicitAssignment
          ? "AI_RESEARCH_TRANSLATION_MODEL_INVALID"
          : "AI_DEFAULT_MODEL_UNAVAILABLE",
      );
    }
    const requestParams = selected.transport === "codex-cli"
      ? {}
      : mergeAiRequestParams(
        selected.requestParams,
        explicitAssignment ? assignment.requestParams : {},
      );
    const config = {
      ...selected,
      requestParams: selected.protocol === "openai" && ["gemini", "deepseek"].includes(selected.provider)
        ? mergeAiRequestParams(requestParams, { response_format: { type: "json_object" } })
        : requestParams,
    };
    if (config.transport === "codex-cli") {
      const runtime = getCodexRuntimeStatus();
      if (!runtime.ready || !runtime.executablePath || !config.model) {
        throw createResearchTranslationError(
          explicitAssignment
            ? "资料翻译模型已失效，请在“AI 配置 → 任务模型”中重新选择"
            : (runtime.message || "请先配置并测试默认模型"),
          explicitAssignment
            ? "AI_RESEARCH_TRANSLATION_MODEL_INVALID"
            : "AI_DEFAULT_MODEL_UNAVAILABLE",
        );
      }
    } else if (!config.apiKey || !config.testedOk) {
      throw createResearchTranslationError(
        explicitAssignment
          ? "资料翻译模型已失效，请在“AI 配置 → 任务模型”中重新选择"
          : "请先配置并测试默认模型",
        explicitAssignment
          ? "AI_RESEARCH_TRANSLATION_MODEL_INVALID"
          : "AI_DEFAULT_MODEL_UNAVAILABLE",
      );
    }
    return config;
  }

  async function completeHttp(requestId, batchIndex, attempt, config, messages, controller) {
    let output = "";
    const collector = {
      isDestroyed: () => false,
      send(channel, payload) {
        if (channel !== "ai:chunk" || controller.signal.aborted) return;
        output += String(payload?.delta || "");
      },
    };
    const usage = await streamAiCompletion(
      collector,
      `${requestId}-b${batchIndex + 1}-a${attempt}`,
      config,
      messages,
      controller.signal,
    );
    throwIfAiAborted(controller.signal);
    return { output, usage };
  }

  async function completeCodex(scope, config, messages, controller) {
    let output = "";
    const usage = await streamCodexCompletion({
      executable: getCodexRuntimeStatus().executablePath,
      config,
      messages,
      cwd: scope.cwd,
      scope: scope.scope,
      attachments: [],
      imagePaths: [],
      contextInstruction: [
        "本次只翻译消息中提供的资料文本块。",
        "没有本地文件或目录访问能力，不要调用工具，不要尝试读取其他上下文。",
      ].join(""),
      signal: controller.signal,
      onDelta: (delta) => {
        if (!controller.signal.aborted) output += String(delta || "");
      },
    });
    throwIfAiAborted(controller.signal);
    return { output, usage };
  }

  async function translate(event, rawPayload) {
    let input;
    try {
      input = normalizeResearchTranslationPayload(rawPayload);
    } catch (error) {
      const requestId = typeof rawPayload?.requestId === "string"
        && RESEARCH_TRANSLATION_REQUEST_ID_PATTERN.test(rawPayload.requestId)
        ? rawPayload.requestId
        : "";
      return {
        ok: false,
        requestId,
        code: error?.code || "AI_RESEARCH_TRANSLATION_PAYLOAD_INVALID",
        message: error?.message || "资料翻译请求无效",
      };
    }
    const { requestId } = input;
    if (activeRequests.has(requestId)) {
      return {
        ok: false,
        requestId,
        code: "AI_RESEARCH_TRANSLATION_REQUEST_DUPLICATE",
        message: "资料翻译请求标识重复",
      };
    }
    if (activeRequests.size >= concurrentRequestLimit) {
      return {
        ok: false,
        requestId,
        code: "AI_RESEARCH_TRANSLATION_REQUEST_LIMIT",
        message: "同时运行的资料翻译过多，请稍后重试",
      };
    }

    const controller = new AbortControllerApi();
    activeRequests.set(requestId, controller);
    const release = () => {
      if (activeRequests.get(requestId) === controller) activeRequests.delete(requestId);
    };
    let codexScope = null;
    try {
      const storedConfig = await readAiConfig();
      throwIfAiAborted(controller.signal);
      const config = resolveTaskConfig(storedConfig);
      if (config.transport === "codex-cli") {
        codexScope = await resolveCodexScopeDirectory({
          scope: { mode: "document-only", relativePath: "" },
          tempRoot: path.join(getTempPath(), "PaperWriterCodex"),
        });
      }
      const batches = batchResearchTranslationBlocks(input.blocks);
      const translations = [];
      let usage = normalizedUsage();
      emitRendererEvent(event.sender, "research-translation:progress", {
        requestId,
        completedBatches: 0,
        totalBatches: batches.length,
        message: `正在翻译 0/${batches.length} 批…`,
      });
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        throwIfAiAborted(controller.signal);
        const batch = batches[batchIndex];
        let parsed = null;
        let lastError = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          throwIfAiAborted(controller.signal);
          const messages = buildResearchTranslationMessages(input, batch, { repair: attempt === 2 });
          const completion = config.transport === "codex-cli"
            ? await completeCodex(codexScope, config, messages, controller)
            : await completeHttp(requestId, batchIndex, attempt, config, messages, controller);
          usage = addUsage(usage, completion.usage);
          try {
            parsed = parseResearchTranslationResponse(completion.output, batch);
            break;
          } catch (error) {
            lastError = error;
            if (attempt === 2) throw error;
          }
        }
        if (!parsed) throw lastError || createResearchTranslationError(
          "AI 返回的资料翻译结构无效",
          "AI_RESEARCH_TRANSLATION_OUTPUT_INVALID",
        );
        translations.push(...parsed);
        emitRendererEvent(event.sender, "research-translation:progress", {
          requestId,
          completedBatches: batchIndex + 1,
          totalBatches: batches.length,
          message: `正在翻译 ${batchIndex + 1}/${batches.length} 批…`,
        });
      }
      throwIfAiAborted(controller.signal);
      return {
        ok: true,
        requestId,
        translations,
        model: {
          providerId: config.provider,
          providerLabel: config.providerLabel,
          modelId: config.modelId,
          modelName: config.modelName,
        },
        usage,
      };
    } catch (error) {
      const aborted = controller.signal.aborted;
      await writeDebugLog("ai:research-translation:error", {
        requestId,
        aborted,
        code: error?.code,
        message: error?.message,
      });
      return {
        ok: false,
        requestId,
        canceled: aborted,
        code: aborted
          ? "AI_RESEARCH_TRANSLATION_CANCELED"
          : (error?.code || "AI_RESEARCH_TRANSLATION_FAILED"),
        message: aborted
          ? "已停止资料翻译"
          : (error?.message || "资料翻译失败"),
      };
    } finally {
      release();
      await codexScope?.cleanup?.();
    }
  }

  async function cancel(requestId) {
    const id = String(requestId || "");
    const controller = activeRequests.get(id);
    if (controller && !controller.signal.aborted) {
      controller.abort(new Error("已停止资料翻译"));
    }
    return { ok: true, canceled: Boolean(controller) };
  }

  function abortAll() {
    for (const controller of activeRequests.values()) controller.abort(new Error("应用正在退出"));
    activeRequests.clear();
  }

  return {
    abortAll,
    facade: Object.freeze({ cancel, translate }),
    getActiveRequestCount: () => activeRequests.size,
  };
}

module.exports = {
  RESEARCH_TRANSLATION_CONCURRENT_REQUEST_LIMIT,
  createResearchTranslationRuntime,
};
