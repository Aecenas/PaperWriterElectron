const AI_REQUEST_ID_PATTERN = /^ai-[a-z0-9-]{6,100}$/i;
const AI_CHAT_EXPORT_MAX_BYTES = 16 * 1024 * 1024;
const AI_INPUT_MAX_CHARS = 2 * 1024 * 1024;
const AI_CONCURRENT_REQUEST_LIMIT = 4;

function createAiGenerationRuntime({
  readAiConfig,
  activeAiProviderConfig,
  getCodexRuntimeStatus,
  streamAiCompletion,
  resolveAiApplyHttp,
  throwIfAiAborted,
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
  concurrentRequestLimit = AI_CONCURRENT_REQUEST_LIMIT,
  inputMaxChars = AI_INPUT_MAX_CHARS,
  AbortControllerApi = AbortController,
}) {
  const activeAiRequests = new Map();

  function normalizeAiMessages(payload = {}) {
    if (Array.isArray(payload.messages)) {
      const candidates = payload.messages
        .slice(-100)
        .map((message) => ({
          role: ["system", "user", "assistant"].includes(
            message?.role,
          )
            ? message.role
            : "user",
          content: String(message?.content || "").slice(
            0,
            200000,
          ),
        }))
        .filter((message) => message.content.trim());
      let remainingCharacters = inputMaxChars;
      const messages = candidates.flatMap((message) => {
        if (remainingCharacters <= 0) {
          return [];
        }
        const content = message.content.slice(
          0,
          remainingCharacters,
        );
        remainingCharacters -= content.length;
        return content.trim()
          ? [{ ...message, content }]
          : [];
      });
      if (messages.length) {
        return messages;
      }
    }
    return [{
      role: "user",
      content: String(payload.prompt || "").slice(
        0,
        Math.min(200000, inputMaxChars),
      ),
    }];
  }

  function aiApplyResolverMessages(
    manifest,
    selectedBlock,
    optimizationContext = {},
    repair = null,
  ) {
    const safeOptimizationBlock = (block) => ({
      type: String(block?.type || "paragraph").slice(0, 64),
      text: String(block?.text || "").slice(0, 100000),
      caption: String(block?.caption || "").slice(0, 2000),
      items: Array.isArray(block?.items)
        ? block.items
          .slice(0, 1000)
          .map((item) => ({
            text: String(item?.text ?? item ?? "")
              .slice(0, 10000),
          }))
        : [],
      headers: Array.isArray(block?.headers)
        ? block.headers
          .slice(0, 100)
          .map(
            (item) => String(item || "").slice(0, 10000),
          )
        : [],
      rows: Array.isArray(block?.rows)
        ? block.rows
          .slice(0, 1000)
          .map(
            (row) => (
              Array.isArray(row)
                ? row
                  .slice(0, 100)
                  .map(
                    (item) => String(item || "")
                      .slice(0, 10000),
                  )
                : []
            ),
          )
        : [],
    });
    const safeManifest = {
      version: 1,
      documentFingerprint: String(
        manifest?.documentFingerprint || "",
      ).slice(0, 128),
      blocks: Array.isArray(manifest?.blocks)
        ? manifest.blocks
          .slice(0, 5000)
          .map((block) => ({
            id: String(block?.id || "").slice(0, 128),
            index: Math.max(
              0,
              Math.floor(Number(block?.index) || 0),
            ),
            type: String(block?.type || "").slice(0, 64),
            text: String(block?.text || "").slice(0, 100000),
            protected: Boolean(block?.protected),
          }))
        : [],
    };
    const safeBlock = safeOptimizationBlock(selectedBlock);
    const safeContext = {
      selectedIndex: Math.max(
        0,
        Math.floor(
          Number(optimizationContext?.selectedIndex) || 0,
        ),
      ),
      totalBlocks: Math.max(
        0,
        Math.floor(
          Number(optimizationContext?.totalBlocks) || 0,
        ),
      ),
      previousBlocks: Array.isArray(
        optimizationContext?.previousBlocks,
      )
        ? optimizationContext.previousBlocks
          .slice(-2)
          .map(safeOptimizationBlock)
        : [],
      nextBlocks: Array.isArray(
        optimizationContext?.nextBlocks,
      )
        ? optimizationContext.nextBlocks
          .slice(0, 2)
          .map(safeOptimizationBlock)
        : [],
    };
    const safeRepair = repair && typeof repair === "object"
      ? {
        code: String(
          repair.code || "invalid_schema",
        ).slice(0, 64),
        message: String(
          repair.message || "返回格式不符合要求",
        ).slice(0, 1000),
        previousRaw: String(repair.previousRaw || "")
          .slice(0, 16000),
      }
      : null;
    const payload = JSON.stringify({
      manifest: safeManifest,
      selectedOptimizationBlock: safeBlock,
      optimizationContext: safeContext,
    });
    if (payload.length > inputMaxChars) {
      throw new Error("当前信笺过长，无法安全生成应用裁决");
    }
    const messages = [
      {
        role: "system",
        content: [
          "你是笺间的应用落点裁决器。你只能决定选中优化块在当前信笺中的落点，绝不能改写优化块内容。",
          "只返回一个 JSON 对象，不要使用 Markdown 代码围栏，不要添加解释文字。",
          "允许 action: replace, insert_before, insert_after, unresolved。",
          "四种动作使用互斥字段，不适用字段必须省略，禁止返回 null、空字符串或空数组占位。",
          "replace 只允许字段 version, action, targetBlockIds, confidence, reason, documentFingerprint；targetBlockIds 必须按正文顺序连续。",
          "insert_before/insert_after 只允许字段 version, action, anchorBlockId, confidence, reason, documentFingerprint。",
          "unresolved 只允许字段 version, action, confidence, reason, documentFingerprint，且 reason 必须说明无法定位的原因。",
          "不得选择 protected=true 的块。无法可靠判断时必须 unresolved。",
          "documentFingerprint 必须原样返回输入值；version 必须为 1；confidence 必须位于 0 到 1。",
          'replace 示例：{"version":1,"action":"replace","targetBlockIds":["block-2-abc"],"confidence":0.96,"reason":"内容对应","documentFingerprint":"doc-abc"}',
          'insert_before 示例：{"version":1,"action":"insert_before","anchorBlockId":"block-2-abc","confidence":0.91,"reason":"新增过渡段","documentFingerprint":"doc-abc"}',
          'insert_after 示例：{"version":1,"action":"insert_after","anchorBlockId":"block-2-abc","confidence":0.91,"reason":"新增补充段","documentFingerprint":"doc-abc"}',
          'unresolved 示例：{"version":1,"action":"unresolved","confidence":0.3,"reason":"存在多个同样合理的位置","documentFingerprint":"doc-abc"}',
        ].join("\n"),
      },
      { role: "user", content: payload },
    ];
    if (safeRepair) {
      messages.push(
        {
          role: "assistant",
          content: safeRepair.previousRaw || "（上次响应为空）",
        },
        {
          role: "user",
          content: `上次响应未通过本地校验（${safeRepair.code}：${safeRepair.message}）。只修正位置 JSON 中的格式、字段或目标，不要重新判断或改写优化内容，也不要扩展任务。只返回修正后的 JSON 对象，不要添加解释。`,
        },
      );
    }
    return messages;
  }

  async function resolveAiApplyWithModel(config, messages) {
    if (!config?.testedOk) {
      throw new Error("应用裁决模型尚未通过可用性测试");
    }
    if (config.transport !== "codex-cli") {
      return resolveAiApplyHttp(config, messages);
    }
    let output = "";
    let outputTooLong = false;
    await streamCodexCompletion({
      executable: getCodexRuntimeStatus().executablePath,
      config,
      messages,
      cwd: getTempPath(),
      scope: { mode: "document-only", relativePath: "" },
      onDelta: (delta) => {
        if (outputTooLong) {
          return;
        }
        output += String(delta || "");
        if (output.length > 128 * 1024) {
          output = output.slice(0, 128 * 1024);
          outputTooLong = true;
        }
      },
    });
    if (outputTooLong) {
      throw new Error("应用裁决响应过长");
    }
    return output.trim();
  }

  async function streamCodexForPayload(
    event,
    requestId,
    config,
    messages,
    payload,
    controller,
  ) {
    throwIfAiAborted(controller.signal);
    const resolvedScope = await resolveCodexScopeDirectory({
      scope: payload?.codexScope,
      tempRoot: path.join(getTempPath(), "PaperWriterCodex"),
    });
    let resolvedImages = {
      attachments: [],
      imagePaths: [],
      cleanup: async () => {},
    };
    try {
      throwIfAiAborted(controller.signal);
      if (
        normalizeCodexImageMode(payload?.codexImageMode)
          === "original"
        && Array.isArray(payload?.codexImages)
        && payload.codexImages.length
      ) {
        resolvedImages = await materializeCodexImageAttachments({
          images: payload.codexImages,
          tempRoot: path.join(
            getTempPath(),
            "PaperWriterCodex",
          ),
          readProtocolAsset,
        });
        throwIfAiAborted(controller.signal);
      }
      return await streamCodexCompletion({
        executable: getCodexRuntimeStatus().executablePath,
        config,
        messages,
        cwd: resolvedScope.cwd,
        scope: resolvedScope.scope,
        attachments: resolvedImages.attachments,
        imagePaths: resolvedImages.imagePaths,
        signal: controller.signal,
        onDelta: (delta) => {
          if (controller.signal.aborted) {
            return;
          }
          emitRendererEvent(event.sender, "ai:chunk", {
            requestId,
            delta,
          });
        },
      });
    } finally {
      await Promise.allSettled([
        resolvedImages.cleanup(),
        resolvedScope.cleanup(),
      ]);
    }
  }

  async function generate(event, payload) {
    const requestId = String(payload?.requestId || "");
    const messages = normalizeAiMessages(payload || {});
    if (
      !AI_REQUEST_ID_PATTERN.test(requestId)
      || !messages.some((message) => message.content.trim())
    ) {
      return { ok: false, message: "AI 请求缺少内容" };
    }
    if (activeAiRequests.has(requestId)) {
      return { ok: false, message: "AI 请求标识重复" };
    }
    if (activeAiRequests.size >= concurrentRequestLimit) {
      return {
        ok: false,
        message: "同时运行的 AI 请求过多，请等待当前生成完成",
      };
    }

    const controller = new AbortControllerApi();
    activeAiRequests.set(requestId, controller);
    const releaseReservation = () => {
      if (activeAiRequests.get(requestId) === controller) {
        activeAiRequests.delete(requestId);
      }
    };
    const stoppedResult = {
      ok: false,
      message: "已停止生成",
    };
    const reservationStopped = () => (
      activeAiRequests.get(requestId) !== controller
      || controller.signal.aborted
    );

    try {
      const storedConfig = await readAiConfig();
      if (reservationStopped()) {
        releaseReservation();
        return stoppedResult;
      }
      const config = activeAiProviderConfig(
        storedConfig,
        payload?.provider,
        payload?.modelId,
      );
      if (reservationStopped()) {
        releaseReservation();
        return stoppedResult;
      }
      if (config.transport === "codex-cli") {
        const runtimeStatus = getCodexRuntimeStatus();
        if (reservationStopped()) {
          releaseReservation();
          return stoppedResult;
        }
        if (
          !runtimeStatus.ready
          || !runtimeStatus.executablePath
          || !config.model
        ) {
          releaseReservation();
          return {
            ok: false,
            message: runtimeStatus.message
              || "请先在 AI 设置中配置 Codex CLI",
          };
        }
      } else if (!config.apiKey || !config.testedOk) {
        releaseReservation();
        return {
          ok: false,
          message: "请选择已测试可用的 AI 模型",
        };
      }
      if (reservationStopped()) {
        releaseReservation();
        return stoppedResult;
      }

      const completion = config.transport === "codex-cli"
        ? streamCodexForPayload(
          event,
          requestId,
          config,
          messages,
          payload,
          controller,
        )
        : streamAiCompletion(
          event.sender,
          requestId,
          config,
          messages,
          controller.signal,
        );
      void (async () => {
        try {
          const usage = await completion;
          if (activeAiRequests.get(requestId) !== controller) {
            return;
          }
          throwIfAiAborted(controller.signal);
          emitRendererEvent(event.sender, "ai:done", {
            requestId,
            usage,
          });
        } catch (error) {
          if (activeAiRequests.get(requestId) !== controller) {
            return;
          }
          const aborted = controller.signal.aborted;
          await writeDebugLog("ai:generate:error", {
            requestId,
            aborted,
            message: error?.message,
          });
          if (activeAiRequests.get(requestId) !== controller) {
            return;
          }
          emitRendererEvent(event.sender, "ai:error", {
            requestId,
            message: aborted
              ? "已停止生成"
              : (error?.message || "AI 生成失败"),
            aborted,
          });
        } finally {
          releaseReservation();
        }
      })();
      return { ok: true, requestId };
    } catch (error) {
      const stopped = reservationStopped();
      releaseReservation();
      if (stopped) {
        return stoppedResult;
      }
      throw error;
    }
  }

  async function resolveApply(payload = {}) {
    const config = await readAiConfig();
    const taskModel = config.taskModels?.applyResolver || {};
    const hasExplicitTaskModel = Boolean(
      taskModel.providerId || taskModel.modelId,
    );
    const selectedResolver = taskAiProviderConfig(
      config,
      taskModel,
    );
    const resolver = selectedResolver
      ? {
        ...selectedResolver,
        requestParams: selectedResolver.transport === "codex-cli"
          ? {}
          : aiApplyResolverRequestParams(
            selectedResolver.provider,
            selectedResolver.protocol,
            mergeAiRequestParams(
              selectedResolver.requestParams,
              hasExplicitTaskModel
                ? taskModel.requestParams
                : {},
            ),
          ),
      }
      : null;
    if (!resolver) {
      throw new Error(
        hasExplicitTaskModel
          ? "应用裁决模型已失效，请在“AI 配置 → 任务模型”中重新选择"
          : "请先在“AI 配置”中配置并测试至少一个可用的默认模型",
      );
    }
    if (
      (!resolver.apiKey || !resolver.testedOk)
      && resolver.transport !== "codex-cli"
    ) {
      throw new Error(
        hasExplicitTaskModel
          ? "应用裁决模型已失效，请在“AI 配置 → 任务模型”中重新选择"
          : "默认模型不可用，请在“AI 配置”中重新配置并测试",
      );
    }
    if (
      resolver.transport === "codex-cli"
      && !getCodexRuntimeStatus().ready
    ) {
      throw new Error(
        hasExplicitTaskModel
          ? "应用裁决所选 Codex CLI 当前不可用，请在“AI 配置 → 任务模型”中重新选择"
          : "默认 Codex CLI 当前不可用，请在“AI 配置”中重新检查",
      );
    }
    const messages = aiApplyResolverMessages(
      payload.manifest,
      payload.selectedBlock,
      payload.optimizationContext,
      payload.repair,
    );
    const raw = await resolveAiApplyWithModel(
      resolver,
      messages,
    );
    return {
      ok: true,
      raw,
      model: {
        providerId: resolver.provider,
        providerLabel: resolver.providerLabel,
        modelId: resolver.modelId,
        modelName: resolver.modelName,
      },
    };
  }

  async function cancel(requestId) {
    const id = String(requestId || "");
    const controller = activeAiRequests.get(id);
    if (controller && !controller.signal.aborted) {
      controller.abort(new Error("已停止生成"));
    }
    return {
      ok: true,
      canceled: Boolean(controller),
    };
  }

  async function exportChat(payload) {
    const title = sanitizeName(payload?.title || "AI问答");
    const stamp = timestampForFileName();
    const result = await dialog.showSaveDialog(
      getMainWindow(),
      {
        title: "另存 AI 问答记录",
        defaultPath: path.join(
          defaultDocumentsDir(),
          `${title}-AI问答-${stamp}.md`,
        ),
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "Text", extensions: ["txt"] },
        ],
      },
    );
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    const markdown = String(payload?.markdown || "");
    if (
      Buffer.byteLength(markdown, "utf8")
      > AI_CHAT_EXPORT_MAX_BYTES
    ) {
      throw new Error("AI 问答记录过大，已拒绝导出");
    }
    await atomicWriteFile(result.filePath, markdown);
    return {
      canceled: false,
      path: result.filePath,
    };
  }

  function abortAll() {
    for (const controller of activeAiRequests.values()) {
      controller.abort();
    }
    activeAiRequests.clear();
  }

  const facade = Object.freeze({
    cancel,
    exportChat,
    generate,
    resolveApply,
  });

  return {
    abortAll,
    createApplyMessages: aiApplyResolverMessages,
    facade,
    getActiveRequestCount: () => activeAiRequests.size,
  };
}

module.exports = {
  createAiGenerationRuntime,
};
