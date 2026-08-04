const {
  HELP_ASSISTANT_MAX_ANSWER_CHARS,
  HELP_ASSISTANT_MAX_MESSAGES_PER_SESSION,
  HELP_ASSISTANT_MAX_QUESTION_CHARS,
  HELP_ASSISTANT_MAX_SESSIONS,
  HELP_ASSISTANT_MAX_STORAGE_BYTES,
  HELP_ASSISTANT_REQUEST_ID_PATTERN,
  HELP_ASSISTANT_SESSION_ID_PATTERN,
  buildHelpAssistantMessages,
  cleanText,
  createSession,
  normalizeState,
  publicSources,
  retrieveKnowledge,
  safeIdentifier,
  titleFromQuestion,
} = require("./help-assistant-core.cjs");

const HELP_ASSISTANT_HISTORY_FILE = "ai-help-history.json";

function helpError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createHelpAssistantRuntime({
  fs,
  path,
  atomicWriteFile,
  getUserDataPath,
  getTempPath,
  getAppVersion,
  randomUUID,
  readAiConfig,
  taskAiProviderConfig,
  mergeAiRequestParams,
  getCodexRuntimeStatus,
  resolveCodexScopeDirectory,
  streamAiCompletion,
  streamCodexCompletion,
  throwIfAiAborted,
  emitRendererEvent,
  writeDebugLog,
  knowledgeIndexPath,
  now = Date.now,
  AbortControllerApi = AbortController,
}) {
  let state = normalizeState();
  let knowledgeIndex = { schemaVersion: 1, appVersion: "", entries: [] };
  let initialized = false;
  let historyNotice = "";
  let mutationTail = Promise.resolve();
  const activeRequests = new Map();

  function historyPath() {
    return path.join(getUserDataPath(), HELP_ASSISTANT_HISTORY_FILE);
  }

  function queueMutation(task) {
    const pending = mutationTail.catch(() => {}).then(task);
    mutationTail = pending;
    return pending;
  }

  function createSessionId() {
    return `help-session-${String(randomUUID()).toLowerCase()}`;
  }

  function createMessageId(role) {
    return `${role}-${now().toString(36)}-${String(randomUUID()).slice(0, 12).toLowerCase()}`;
  }

  function sessionById(sessionId) {
    return state.sessions.find((session) => session.id === sessionId) || null;
  }

  function activeRequestForSession(sessionId) {
    return [...activeRequests.values()].find((request) => request.sessionId === sessionId) || null;
  }

  function publicState() {
    return {
      ...normalizeState(state),
      knowledgeVersion: knowledgeIndex.appVersion || getAppVersion(),
      notice: historyNotice,
      activeRequest: [...activeRequests.values()].map((request) => ({
        requestId: request.requestId,
        sessionId: request.sessionId,
        messageId: request.messageId,
      }))[0] || null,
    };
  }

  async function persistState(nextState = state) {
    const normalized = normalizeState(nextState);
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > HELP_ASSISTANT_MAX_STORAGE_BYTES) {
      throw helpError(
        "AI精灵本机历史已达到 32 MB，请删除旧会话后重试",
        "AI_HELP_STORAGE_LIMIT",
      );
    }
    await atomicWriteFile(historyPath(), serialized);
    state = normalized;
    return publicState();
  }

  async function readHistory() {
    let handle;
    try {
      handle = await fs.open(historyPath(), "r");
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size <= 0 || stat.size > HELP_ASSISTANT_MAX_STORAGE_BYTES) {
        throw helpError("AI精灵历史文件大小无效", "AI_HELP_HISTORY_CORRUPT");
      }
      const bytes = await handle.readFile();
      return normalizeState(JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return normalizeState();
      if (error instanceof SyntaxError || error?.code === "AI_HELP_HISTORY_CORRUPT") {
        const backup = `${historyPath()}.corrupt-${now()}`;
        try { await fs.rename(historyPath(), backup); } catch { /* Keep the original when it cannot be moved. */ }
        await writeDebugLog("ai:help-history:recovered", {
          message: error?.message,
          backup,
        });
        historyNotice = "AI精灵历史文件已损坏，已保留备份并创建新历史。";
        return normalizeState();
      }
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async function readKnowledgeIndex() {
    const bytes = await fs.readFile(knowledgeIndexPath);
    if (bytes.length > 4 * 1024 * 1024) throw new Error("AI精灵知识索引过大");
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error("AI精灵知识索引格式无效");
    }
    return parsed;
  }

  async function initialize() {
    if (initialized) return publicState();
    knowledgeIndex = await readKnowledgeIndex();
    state = await readHistory();
    let changed = false;
    state.sessions = state.sessions.map((session) => ({
      ...session,
      messages: session.messages.map((message) => {
        if (message.role !== "assistant" || message.status !== "streaming") return message;
        changed = true;
        return {
          ...message,
          status: "stopped",
          content: message.content || "上次生成因应用退出而停止。",
        };
      }),
    }));
    if (!state.sessions.length) {
      const session = createSession({ id: createSessionId(), now: now() });
      state.sessions = [session];
      state.activeSessionId = session.id;
      changed = true;
    }
    initialized = true;
    if (changed) await persistState();
    return publicState();
  }

  function assertInitialized() {
    if (!initialized) throw new Error("AI精灵尚未初始化");
  }

  async function getState() {
    await initialize();
    return publicState();
  }

  async function createNewSession() {
    await initialize();
    return queueMutation(async () => {
      if (state.sessions.length >= HELP_ASSISTANT_MAX_SESSIONS) {
        throw helpError("AI精灵最多保留 50 个会话，请先删除旧会话", "AI_HELP_SESSION_LIMIT");
      }
      const session = createSession({ id: createSessionId(), now: now() });
      await persistState({
        ...state,
        activeSessionId: session.id,
        sessions: [session, ...state.sessions],
      });
      return { ok: true, session, state: publicState() };
    });
  }

  async function setActiveSession(sessionId) {
    await initialize();
    const id = safeIdentifier(sessionId, HELP_ASSISTANT_SESSION_ID_PATTERN, "AI精灵会话标识");
    return queueMutation(async () => {
      if (!sessionById(id)) throw helpError("AI精灵会话不存在", "AI_HELP_SESSION_MISSING");
      await persistState({ ...state, activeSessionId: id });
      return { ok: true, state: publicState() };
    });
  }

  async function renameSession(payload = {}) {
    await initialize();
    const id = safeIdentifier(payload.sessionId, HELP_ASSISTANT_SESSION_ID_PATTERN, "AI精灵会话标识");
    const title = cleanText(payload.title, 80).replace(/\s+/g, " ");
    if (!title) throw helpError("会话名称不能为空", "AI_HELP_TITLE_INVALID");
    return queueMutation(async () => {
      if (!sessionById(id)) throw helpError("AI精灵会话不存在", "AI_HELP_SESSION_MISSING");
      await persistState({
        ...state,
        sessions: state.sessions.map((session) => session.id === id
          ? { ...session, title, updatedAt: now() }
          : session),
      });
      return { ok: true, state: publicState() };
    });
  }

  async function deleteSession(sessionId) {
    await initialize();
    const id = safeIdentifier(sessionId, HELP_ASSISTANT_SESSION_ID_PATTERN, "AI精灵会话标识");
    return queueMutation(async () => {
      if (activeRequestForSession(id)) {
        throw helpError("这个会话仍在生成，请先停止回答", "AI_HELP_SESSION_BUSY");
      }
      const sessions = state.sessions.filter((session) => session.id !== id);
      if (sessions.length === state.sessions.length) {
        throw helpError("AI精灵会话不存在", "AI_HELP_SESSION_MISSING");
      }
      if (!sessions.length) sessions.push(createSession({ id: createSessionId(), now: now() }));
      await persistState({
        ...state,
        sessions,
        activeSessionId: state.activeSessionId === id
          ? sessions[0].id
          : state.activeSessionId,
      });
      return { ok: true, state: publicState() };
    });
  }

  function resolveTaskConfig(storedConfig) {
    const assignment = storedConfig.taskModels?.helpAssistant || {};
    const explicit = Boolean(assignment.providerId || assignment.modelId);
    const selected = taskAiProviderConfig(storedConfig, assignment);
    if (!selected) {
      throw helpError(
        explicit
          ? "AI精灵模型已失效，请在“AI 配置 → 任务模型”中重新选择"
          : "请先配置并测试默认模型",
        explicit ? "AI_HELP_MODEL_INVALID" : "AI_DEFAULT_MODEL_UNAVAILABLE",
      );
    }
    const config = {
      ...selected,
      requestParams: selected.transport === "codex-cli"
        ? {}
        : mergeAiRequestParams(
          selected.requestParams,
          explicit ? assignment.requestParams : {},
        ),
    };
    if (config.transport === "codex-cli") {
      const runtime = getCodexRuntimeStatus();
      if (!runtime.ready || !runtime.executablePath || !config.model) {
        throw helpError(
          explicit
            ? "AI精灵模型已失效，请在“AI 配置 → 任务模型”中重新选择"
            : (runtime.message || "请先配置并测试默认模型"),
          explicit ? "AI_HELP_MODEL_INVALID" : "AI_DEFAULT_MODEL_UNAVAILABLE",
        );
      }
    } else if (!config.apiKey || !config.testedOk) {
      throw helpError(
        explicit
          ? "AI精灵模型已失效，请在“AI 配置 → 任务模型”中重新选择"
          : "请先配置并测试默认模型",
        explicit ? "AI_HELP_MODEL_INVALID" : "AI_DEFAULT_MODEL_UNAVAILABLE",
      );
    }
    return config;
  }

  function streamHttp(event, request, config, messages) {
    const collector = {
      isDestroyed: () => event.sender?.isDestroyed?.() === true,
      send(channel, payload) {
        if (channel === "ai:chunk") request.append(payload?.delta);
      },
    };
    return streamAiCompletion(
      collector,
      request.requestId,
      config,
      messages,
      request.controller.signal,
    );
  }

  async function streamCodex(request, config, messages) {
    const runtime = getCodexRuntimeStatus();
    throwIfAiAborted(request.controller.signal);
    const resolvedScope = await resolveCodexScopeDirectory({
      scope: { mode: "document-only", relativePath: "" },
      tempRoot: path.join(getTempPath(), "PaperWriterHelpCodex"),
    });
    try {
      throwIfAiAborted(request.controller.signal);
      return await streamCodexCompletion({
        executable: runtime.executablePath,
        config,
        messages,
        cwd: resolvedScope.cwd,
        scope: resolvedScope.scope,
        attachments: [],
        imagePaths: [],
        contextInstruction: [
          "本次仅允许依据提示中内嵌的笺间软件知识回答。",
          "没有本地文件、信笺、工作区或资料访问能力，不要尝试调用工具。",
        ].join(""),
        signal: request.controller.signal,
        onDelta: request.append,
      });
    } finally {
      await resolvedScope.cleanup();
    }
  }

  async function generate(event, payload = {}) {
    await initialize();
    let requestId;
    let sessionId;
    let question;
    try {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)
        || Object.keys(payload).some((key) => !["requestId", "sessionId", "question"].includes(key))) {
        throw helpError("AI精灵请求包含不允许的字段", "AI_HELP_PAYLOAD_INVALID");
      }
      requestId = safeIdentifier(payload.requestId, HELP_ASSISTANT_REQUEST_ID_PATTERN, "AI精灵请求标识");
      sessionId = safeIdentifier(payload.sessionId, HELP_ASSISTANT_SESSION_ID_PATTERN, "AI精灵会话标识");
      question = cleanText(payload.question, HELP_ASSISTANT_MAX_QUESTION_CHARS);
      if (!question || question.length !== String(payload.question || "").trim().length) {
        throw helpError(`问题必须为 1-${HELP_ASSISTANT_MAX_QUESTION_CHARS} 个字符`, "AI_HELP_QUESTION_INVALID");
      }
      assertInitialized();
      if (activeRequests.size) throw helpError("AI精灵已有回答正在生成", "AI_HELP_REQUEST_LIMIT");
      if (activeRequests.has(requestId)) throw helpError("AI精灵请求标识重复", "AI_HELP_REQUEST_DUPLICATE");
      const session = sessionById(sessionId);
      if (!session) throw helpError("AI精灵会话不存在", "AI_HELP_SESSION_MISSING");
      if (session.messages.length + 2 > HELP_ASSISTANT_MAX_MESSAGES_PER_SESSION) {
        throw helpError("当前会话已达到 200 条消息，请新建会话", "AI_HELP_MESSAGE_LIMIT");
      }

      const storedConfig = await readAiConfig();
      const config = resolveTaskConfig(storedConfig);
      const knowledge = retrieveKnowledge(knowledgeIndex, question, session.messages);
      const sources = publicSources(knowledge);
      const model = {
        providerId: config.provider,
        providerLabel: config.providerLabel,
        modelId: config.modelId,
        modelName: config.modelName,
      };
      const userMessage = {
        id: createMessageId("user"),
        role: "user",
        content: question,
        status: "done",
        createdAt: now(),
        sources: [],
        model: null,
      };
      const assistantMessage = {
        id: createMessageId("assistant"),
        role: "assistant",
        content: "",
        status: "streaming",
        createdAt: now() + 1,
        sources,
        model,
      };
      await persistState({
        ...state,
        activeSessionId: sessionId,
        sessions: state.sessions.map((item) => item.id === sessionId
          ? {
            ...item,
            title: item.messages.length ? item.title : titleFromQuestion(question),
            updatedAt: now(),
            messages: [...item.messages, userMessage, assistantMessage],
          }
          : item),
      });

      const controller = new AbortControllerApi();
      const request = {
        requestId,
        sessionId,
        messageId: assistantMessage.id,
        controller,
        output: "",
        append: (value) => {
          if (controller.signal.aborted) return;
          const delta = String(value || "");
          if (!delta) return;
          request.output += delta;
          if (request.output.length > HELP_ASSISTANT_MAX_ANSWER_CHARS) {
            controller.abort(new Error("AI精灵回答超过安全长度"));
            throw helpError("AI精灵回答超过安全长度", "AI_HELP_OUTPUT_LIMIT");
          }
          emitRendererEvent(event.sender, "help-ai:chunk", {
            requestId,
            sessionId,
            messageId: request.messageId,
            delta,
          });
        },
      };
      activeRequests.set(requestId, request);
      const messages = buildHelpAssistantMessages({
        appVersion: getAppVersion(),
        modelLabel: `${config.providerLabel || config.provider} / ${config.modelName || config.model}`,
        question,
        history: session.messages,
        knowledge,
      });
      const completion = config.transport === "codex-cli"
        ? streamCodex(request, config, messages)
        : streamHttp(event, request, config, messages);

      void (async () => {
        try {
          const usage = await completion;
          if (activeRequests.get(requestId) !== request) return;
          throwIfAiAborted(controller.signal);
          await persistState({
            ...state,
            sessions: state.sessions.map((item) => item.id === sessionId
              ? {
                ...item,
                updatedAt: now(),
                messages: item.messages.map((message) => message.id === request.messageId
                  ? { ...message, content: request.output, status: "done", sources, model }
                  : message),
              }
              : item),
          });
          emitRendererEvent(event.sender, "help-ai:done", {
            requestId,
            sessionId,
            messageId: request.messageId,
            content: request.output,
            sources,
            model,
            usage,
          });
        } catch (error) {
          if (activeRequests.get(requestId) !== request) return;
          const aborted = controller.signal.aborted;
          const message = aborted ? "已停止生成" : (error?.message || "AI精灵回答失败");
          const failedState = {
            ...state,
            sessions: state.sessions.map((item) => item.id === sessionId
              ? {
                ...item,
                updatedAt: now(),
                messages: item.messages.map((entry) => entry.id === request.messageId
                  ? {
                    ...entry,
                    content: request.output || message,
                    status: aborted ? "stopped" : "error",
                    sources,
                    model,
                  }
                  : entry),
              }
              : item),
          };
          try { await persistState(failedState); } catch (persistError) {
            await writeDebugLog("ai:help-history:persist-error", { message: persistError?.message });
          }
          await writeDebugLog("ai:help-generate:error", {
            requestId,
            aborted,
            message: error?.message,
          });
          emitRendererEvent(event.sender, "help-ai:error", {
            requestId,
            sessionId,
            messageId: request.messageId,
            content: request.output,
            message,
            aborted,
            sources,
            model,
          });
        } finally {
          if (activeRequests.get(requestId) === request) activeRequests.delete(requestId);
        }
      })();

      return { ok: true, requestId, sessionId, messageId: assistantMessage.id, model, sources, state: publicState() };
    } catch (error) {
      return {
        ok: false,
        code: error?.code || "AI_HELP_START_FAILED",
        message: error?.message || "AI精灵启动失败",
      };
    }
  }

  async function cancel(requestId) {
    const id = String(requestId || "");
    const request = activeRequests.get(id);
    if (request && !request.controller.signal.aborted) request.controller.abort(new Error("已停止生成"));
    return { ok: true, canceled: Boolean(request) };
  }

  async function abortAll() {
    for (const request of activeRequests.values()) request.controller.abort(new Error("应用正在退出"));
    await mutationTail.catch(() => {});
  }

  return {
    abortAll,
    initialize,
    facade: Object.freeze({
      cancel,
      createSession: createNewSession,
      deleteSession,
      generate,
      getState,
      renameSession,
      setActiveSession,
    }),
    getActiveRequestCount: () => activeRequests.size,
  };
}

module.exports = {
  HELP_ASSISTANT_HISTORY_FILE,
  createHelpAssistantRuntime,
  helpError,
};
