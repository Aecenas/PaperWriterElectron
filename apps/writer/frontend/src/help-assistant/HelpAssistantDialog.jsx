import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUpRight,
  BookOpenText,
  Copy,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { AiChatAssistantContent } from "../ai/index.js";
import { bridge } from "../bridge.js";
import { useModalFocusTrap } from "../ui-interactions.js";

const AI_ASSISTANT_WELCOME_MARK = new URL("../assets/icons/ai-assistant-welcome.png", import.meta.url).href;

const EXAMPLE_QUESTIONS = [
  "未保存就退出，信笺还能恢复吗？",
  "怎么给不同任务指定不同的 AI 模型？",
  "资料区和信笺正文会发送给 AI精灵吗？",
];

function emptyState() {
  return { version: 1, activeSessionId: "", sessions: [], activeRequest: null, knowledgeVersion: "" };
}

function requestId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `ai-help-${suffix}`;
}

function sessionStatus(session, activeRequest) {
  if (activeRequest?.sessionId === session.id) return "streaming";
  return session.messages?.some((message) => message.status === "streaming") ? "streaming" : "idle";
}

function replaceMessage(state, payload, status) {
  if (!payload?.sessionId || !payload?.messageId) return state;
  return {
    ...state,
    activeRequest: state.activeRequest?.requestId === payload.requestId ? null : state.activeRequest,
    sessions: state.sessions.map((session) => session.id !== payload.sessionId ? session : {
      ...session,
      updatedAt: Date.now(),
      messages: session.messages.map((message) => message.id !== payload.messageId ? message : {
        ...message,
        content: typeof payload.content === "string" ? payload.content : message.content,
        status,
        sources: Array.isArray(payload.sources) ? payload.sources : message.sources,
        model: payload.model || message.model,
      }),
    }),
  };
}

function appendChunk(state, payload) {
  if (!payload?.sessionId || !payload?.messageId || !payload?.delta) return state;
  return {
    ...state,
    sessions: state.sessions.map((session) => session.id !== payload.sessionId ? session : {
      ...session,
      messages: session.messages.map((message) => message.id !== payload.messageId ? message : {
        ...message,
        content: `${message.content || ""}${payload.delta}`,
        status: "streaming",
      }),
    }),
  };
}

export function helpAssistantModelStatus(aiConfig = {}) {
  const assignment = aiConfig.taskModels?.helpAssistant || {};
  const explicit = Boolean(assignment.providerId || assignment.modelId);
  const providerId = explicit ? assignment.providerId : aiConfig.activeProvider;
  const modelId = explicit ? assignment.modelId : aiConfig.activeModelId;
  const provider = aiConfig.providers?.[providerId];
  const model = provider?.models?.find((item) => item.id === modelId);
  const transportReady = provider?.transport === "codex-cli"
    ? Boolean(provider?.runtime?.ready)
    : Boolean(provider?.hasApiKey);
  const ready = Boolean(
    provider
    && model
    && model.testedOk
    && transportReady,
  );
  return {
    ready,
    explicit,
    label: provider && model
      ? `${provider.providerLabel || provider.provider || providerId} / ${model.name || model.model || modelId}`
      : (explicit ? "指定模型已失效" : "默认模型未配置"),
    message: ready
      ? (explicit ? "使用 AI精灵专用任务模型" : "跟随默认模型")
      : (explicit
        ? "AI精灵的显式模型已失效，请重新选择；不会静默回退。"
        : "请先配置并测试默认模型。"),
  };
}

function formatSessionTime(value) {
  if (!Number.isFinite(Number(value))) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(value)));
}

export function HelpAssistantDialog({
  open,
  aiConfig,
  onClose,
  onOpenSettings,
  onOpenHelpTopic,
  onRequestDelete,
  onStatus,
  returnFocusRef,
}) {
  const [state, setState] = useState(emptyState);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [configurationError, setConfigurationError] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const composerRef = useRef(null);
  const messagesRef = useRef(null);
  const openRef = useRef(open);
  const modelStatus = useMemo(() => helpAssistantModelStatus(aiConfig), [aiConfig]);
  const activeSession = state.sessions.find((session) => session.id === state.activeSessionId)
    || state.sessions[0]
    || null;
  const activeRequest = state.activeRequest;
  const busy = Boolean(activeRequest);

  useModalFocusTrap(open, dialogRef, closeButtonRef, returnFocusRef);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const refreshState = useCallback(async () => {
    setLoading(true);
    try {
      const next = await bridge.getHelpAssistantState();
      setState(next || emptyState());
      setError(next?.notice || "");
      setConfigurationError(false);
    } catch (nextError) {
      setError(nextError?.message || "无法读取 AI精灵历史");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refreshState();
  }, [open, refreshState]);

  useEffect(() => {
    const unsubscribeChunk = bridge.onHelpAssistantChunk?.((payload) => {
      setState((current) => appendChunk(current, payload));
    });
    const unsubscribeDone = bridge.onHelpAssistantDone?.((payload) => {
      setState((current) => replaceMessage(current, payload, "done"));
      if (!openRef.current) onStatus?.("AI精灵已完成回答");
    });
    const unsubscribeError = bridge.onHelpAssistantError?.((payload) => {
      setState((current) => replaceMessage(current, payload, payload?.aborted ? "stopped" : "error"));
      if (!payload?.aborted) {
        setError(payload?.message || "AI精灵回答失败");
        if (!openRef.current) onStatus?.("AI精灵回答失败，请打开后重试", "warning");
      }
    });
    return () => {
      unsubscribeChunk?.();
      unsubscribeDone?.();
      unsubscribeError?.();
    };
  }, [onStatus]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || !messagesRef.current) return;
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [activeSession?.messages, open]);

  const useReturnedState = useCallback((result) => {
    if (result?.state) setState(result.state);
    return result;
  }, []);

  const handleNewSession = useCallback(async () => {
    try {
      const result = useReturnedState(await bridge.createHelpAssistantSession());
      setDraft("");
      setError("");
      setConfigurationError(false);
      window.setTimeout(() => composerRef.current?.focus(), 0);
      return result;
    } catch (nextError) {
      setError(nextError?.message || "无法新建会话");
      return null;
    }
  }, [useReturnedState]);

  const handleSelectSession = useCallback(async (sessionId) => {
    if (!sessionId || sessionId === state.activeSessionId) return;
    try {
      useReturnedState(await bridge.setActiveHelpAssistantSession(sessionId));
      setDraft("");
      setError("");
      setConfigurationError(false);
    } catch (nextError) {
      setError(nextError?.message || "无法切换会话");
    }
  }, [state.activeSessionId, useReturnedState]);

  const saveSessionTitle = useCallback(async (sessionId) => {
    const title = titleDraft.trim();
    if (!title) return;
    try {
      useReturnedState(await bridge.renameHelpAssistantSession({ sessionId, title }));
      setEditingSessionId("");
      setTitleDraft("");
    } catch (nextError) {
      setError(nextError?.message || "无法重命名会话");
    }
  }, [titleDraft, useReturnedState]);

  const handleDeleteSession = useCallback(async (session) => {
    if (!session) return;
    if (!await onRequestDelete?.(session)) return;
    try {
      useReturnedState(await bridge.deleteHelpAssistantSession(session.id));
      setError("");
    } catch (nextError) {
      setError(nextError?.message || "无法删除会话");
    }
  }, [onRequestDelete, useReturnedState]);

  const sendQuestion = useCallback(async (question = draft) => {
    const value = question.trim();
    if (!value || !activeSession || busy) return;
    if (!modelStatus.ready) {
      setError(modelStatus.message);
      setConfigurationError(true);
      return;
    }
    const nextRequestId = requestId();
    setError("");
    setConfigurationError(false);
    try {
      const result = await bridge.generateHelpAssistant({
        requestId: nextRequestId,
        sessionId: activeSession.id,
        question: value,
      });
      if (!result?.ok) {
        setConfigurationError(["AI_HELP_MODEL_INVALID", "AI_DEFAULT_MODEL_UNAVAILABLE"].includes(result?.code));
        throw new Error(result?.message || "AI精灵无法开始回答");
      }
      if (result.state) {
        setState({
          ...result.state,
          activeRequest: result.state.activeRequest || {
            requestId: nextRequestId,
            sessionId: activeSession.id,
            messageId: result.messageId,
          },
        });
      }
      setDraft("");
    } catch (nextError) {
      setError(nextError?.message || "AI精灵无法开始回答");
    }
  }, [activeSession, busy, draft, modelStatus]);

  const handleStop = useCallback(async () => {
    if (!activeRequest?.requestId) return;
    try {
      await bridge.cancelHelpAssistant(activeRequest.requestId);
    } catch (nextError) {
      setError(nextError?.message || "无法停止回答");
    }
  }, [activeRequest]);

  const handleRetry = useCallback((assistantIndex) => {
    const messages = activeSession?.messages || [];
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === "user") {
        void sendQuestion(messages[index].content);
        return;
      }
    }
  }, [activeSession?.messages, sendQuestion]);

  const copyAnswer = useCallback(async (content) => {
    try {
      await navigator.clipboard.writeText(content);
      onStatus?.("回答已复制");
    } catch {
      setError("复制失败，请手动选择文字复制");
    }
  }, [onStatus]);

  if (!open) return null;

  return (
    <div className="help-assistant-overlay dialog-scrim dialog-scrim--large" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="help-assistant-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-assistant-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="help-assistant-sessions" aria-label="AI精灵会话">
          <header>
            <div className="help-assistant-brand">
              <span><Sparkles size={19} aria-hidden="true" /></span>
              <div>
                <p>软件知识问答</p>
                <h2 id="help-assistant-title">AI精灵</h2>
              </div>
            </div>
            <button type="button" className="help-assistant-new" onClick={handleNewSession} disabled={state.sessions.length >= 50}>
              <Plus size={16} aria-hidden="true" />
              <span>新对话</span>
            </button>
          </header>
          <div className="help-assistant-session-list" role="listbox" aria-label="历史会话">
            {state.sessions.map((session) => {
              const selected = session.id === activeSession?.id;
              const streaming = sessionStatus(session, activeRequest) === "streaming";
              return (
                <div key={session.id} className={["help-assistant-session", selected ? "active" : "", streaming ? "streaming" : ""].filter(Boolean).join(" ")}>
                  {editingSessionId === session.id ? (
                    <input
                      value={titleDraft}
                      maxLength={80}
                      autoFocus
                      aria-label="会话名称"
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onBlur={() => void saveSessionTitle(session.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveSessionTitle(session.id);
                        if (event.key === "Escape") setEditingSessionId("");
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="help-assistant-session-select"
                      role="option"
                      aria-selected={selected}
                      onClick={() => void handleSelectSession(session.id)}
                    >
                      <span className="help-assistant-session-title">{session.title}</span>
                      <small>{streaming ? "正在回答…" : formatSessionTime(session.updatedAt)}</small>
                    </button>
                  )}
                  <div className="help-assistant-session-actions">
                    <button
                      type="button"
                      aria-label={`重命名${session.title}`}
                      title="重命名"
                      onClick={() => {
                        setEditingSessionId(session.id);
                        setTitleDraft(session.title);
                      }}
                    ><Pencil size={13} aria-hidden="true" /></button>
                    <button
                      type="button"
                      aria-label={`删除${session.title}`}
                      title="删除"
                      disabled={streaming}
                      onClick={() => void handleDeleteSession(session)}
                    ><Trash2 size={13} aria-hidden="true" /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <footer>
            <History size={14} aria-hidden="true" />
            <span>历史仅保存在本机</span>
          </footer>
        </aside>

        <main className="help-assistant-main">
          <header className="help-assistant-header">
            <div className="help-assistant-header-title">
              <strong>{activeSession?.title || "新对话"}</strong>
              <span>只回答“笺间”的功能与使用问题</span>
            </div>
            <div className="help-assistant-model-info" data-ready={modelStatus.ready ? "true" : "false"} aria-label="当前回答模型">
              <span className="help-assistant-model-info-copy">
                <strong>{modelStatus.label}</strong>
                <small>当前回答模型 · {modelStatus.message}</small>
              </span>
              {!modelStatus.ready ? <button type="button" onClick={() => onOpenSettings?.()}>前往配置</button> : null}
            </div>
            <div className="help-assistant-header-actions">
              <button type="button" onClick={() => onOpenSettings?.()} title="配置 AI精灵模型" aria-label="配置 AI精灵模型">
                <Settings size={17} aria-hidden="true" />
              </button>
              <button ref={closeButtonRef} type="button" onClick={onClose} title="关闭 AI精灵" aria-label="关闭 AI精灵">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          <section ref={messagesRef} className="help-assistant-messages" aria-label="对话内容">
            {loading ? (
              <div className="help-assistant-loading" role="status"><LoaderCircle size={20} className="spin" aria-hidden="true" />正在读取本机历史…</div>
            ) : !activeSession?.messages?.length ? (
              <div className="help-assistant-welcome">
                <span className="help-assistant-welcome-icon"><img src={AI_ASSISTANT_WELCOME_MARK} alt="" /></span>
                <h3>关于笺间，尽管问我</h3>
                <p>每个问题都会交给你配置的 AI；我会同时检索随软件发布的帮助文档和代码核对知识作为参考。不会读取当前正文、文件路径、资料区或其他 AI 记录。</p>
                <div className="help-assistant-examples" aria-label="示例问题">
                  <span className="help-assistant-examples-label"><Sparkles size={13} aria-hidden="true" />可以这样问</span>
                  <div className="help-assistant-examples-list">
                    {EXAMPLE_QUESTIONS.map((question) => (
                      <button type="button" key={question} onClick={() => void sendQuestion(question)}>
                        <span>{question}</span>
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              activeSession.messages.map((message, index) => (
                <article key={message.id} className={`help-assistant-message ${message.role}`}>
                  <header>
                    <span className="help-assistant-message-role">
                      {message.role === "user"
                        ? <UserRound size={15} aria-hidden="true" />
                        : <Sparkles size={16} aria-hidden="true" />}
                      <strong>{message.role === "user" ? "你" : "AI精灵"}</strong>
                      {message.role === "assistant" && message.model?.modelName ? <small>{message.model.modelName}</small> : null}
                    </span>
                  </header>
                  <div className="help-assistant-message-content">
                    {message.role === "assistant"
                      ? <AiChatAssistantContent text={message.content} />
                      : <p>{message.content}</p>}
                    {message.role === "assistant" && message.status === "streaming" && !message.content
                      ? <span className="help-assistant-thinking" role="status"><LoaderCircle size={16} className="spin" aria-hidden="true" />正在检索知识并请求模型…</span>
                      : null}
                  </div>
                  {message.role === "assistant" ? (
                    <footer>
                      {message.sources?.length ? (
                        <div className="help-assistant-sources" aria-label="回答来源">
                          {message.sources.map((source) => (
                            <button
                              type="button"
                              key={`${source.kind}-${source.id}`}
                              onClick={() => onOpenHelpTopic?.(source.helpTopicId)}
                              title={`打开帮助主题：${source.title}`}
                            >
                              <BookOpenText size={13} aria-hidden="true" />
                              <span>{source.kind === "detail" ? "补充知识" : "帮助文档"} · {source.title}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className="help-assistant-message-actions">
                        {message.content ? <button type="button" onClick={() => void copyAnswer(message.content)}><Copy size={13} aria-hidden="true" />复制</button> : null}
                        {["error", "stopped"].includes(message.status) && !busy
                          ? <button type="button" onClick={() => handleRetry(index)}><RotateCcw size={13} aria-hidden="true" />重试</button>
                          : null}
                        {message.status === "stopped" ? <span>已停止</span> : null}
                        {message.status === "error" ? <span className="error">回答失败</span> : null}
                      </div>
                    </footer>
                  ) : null}
                </article>
              ))
            )}
          </section>

          <footer className="help-assistant-composer-area">
            {error ? (
              <div className="help-assistant-error" role="alert">
                <span>{error}</span>
                {configurationError || !modelStatus.ready ? <button type="button" onClick={() => onOpenSettings?.()}>打开任务模型</button> : null}
                <button type="button" aria-label="关闭错误提示" onClick={() => { setError(""); setConfigurationError(false); }}><X size={14} aria-hidden="true" /></button>
              </div>
            ) : null}
            <div className="help-assistant-composer">
              <div className="help-assistant-composer-title">
                <Sparkles size={17} aria-hidden="true" />
                <strong>问问笺间的功能、操作、限制或故障恢复</strong>
              </div>
              <textarea
                ref={composerRef}
                value={draft}
                rows={3}
                maxLength={8000}
                placeholder="询问笺间的功能、操作、限制、故障恢复或隐私…"
                aria-label="向 AI精灵提问"
                disabled={!activeSession}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void sendQuestion();
                  }
                }}
              />
              <div className="help-assistant-composer-actions">
                <span>{draft.length.toLocaleString("zh-CN")}/8,000 · Enter 发送，Shift+Enter 换行</span>
                {busy ? (
                  <button type="button" className="stop" onClick={() => void handleStop()} title="停止生成" aria-label="停止生成"><Square size={16} fill="currentColor" aria-hidden="true" /></button>
                ) : (
                  <button type="button" className="send" disabled={!draft.trim() || !activeSession} onClick={() => void sendQuestion()} title="发送" aria-label="发送"><Send size={20} aria-hidden="true" /></button>
                )}
              </div>
            </div>
            <p>AI 回答可能有误；精确操作请通过来源返回帮助文档核对。</p>
          </footer>
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {busy ? "AI精灵正在生成回答" : ""}
          </div>
        </main>
      </section>
    </div>
  );
}
