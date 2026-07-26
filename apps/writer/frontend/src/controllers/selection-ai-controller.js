import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { bridge } from "../bridge.js";
import {
  createAiModelKey,
  getTestedAiProviders,
  normalizePublicAiConfig,
} from "../ai-settings/model.js";
import {
  SELECTION_AI_MAX_QUESTION_CHARS,
  SELECTION_AI_MAX_ROUNDS,
  SELECTION_AI_MAX_TEXT_CHARS,
  createSelectionAiRequestId,
  selectionAiHistoryFromMessages,
  validateSelectionAiPayload,
} from "../selection-ai/protocol.js";

export const SELECTION_AI_STREAM_FLUSH_INTERVAL_MS = 50;
export const SELECTION_AI_MAX_SESSIONS_PER_DOCUMENT = 10;
export const SELECTION_AI_MAX_SESSIONS_GLOBAL = 50;
export const SELECTION_AI_MAX_CONCURRENT_REQUESTS = 4;

function emptySelectionAiState() {
  return {
    documentsByTabId: {},
    expandedTabId: null,
  };
}

function normalizeAnchor(anchor) {
  const left = Number(anchor?.left);
  const top = Number(anchor?.top);
  const viewportWidth = Number(globalThis.innerWidth) || 800;
  return {
    left: Number.isFinite(left) ? left : viewportWidth / 2,
    top: Number.isFinite(top) ? top : 120,
  };
}

function normalizePanelPosition(position) {
  if (!position || typeof position !== "object") return null;
  const left = Number(position.left);
  const top = Number(position.top);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top };
}

function createMessageId(prefix, timestamp) {
  return `${prefix}-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function requestRouteKey(tabId, sessionId) {
  return `${tabId}\u0000${sessionId}`;
}

function tabIdFrom(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return typeof value.tabId === "string"
    ? value.tabId
    : (typeof value.id === "string" ? value.id : "");
}

export function resolveSelectionAiModelChoice(config) {
  const normalized = normalizePublicAiConfig(config);
  const assignment = normalized.taskModels?.selectionChat || {};
  const explicitlyConfigured = Boolean(
    assignment.providerId && assignment.modelId,
  );
  const modelKey = explicitlyConfigured
    ? createAiModelKey(assignment.providerId, assignment.modelId)
    : normalized.activeModelKey;
  const model = getTestedAiProviders(normalized)
    .find((candidate) => candidate.id === modelKey) || null;
  return {
    explicitlyConfigured,
    invalid: explicitlyConfigured && !model,
    available: Boolean(model),
    modelKey,
    model,
    label: model
      ? `${model.providerLabel || model.label || "AI"} · ${model.modelName || model.model || "模型"}`
      : (explicitlyConfigured ? "选区问答模型已失效" : "默认模型不可用"),
  };
}

export function createSelectionAiController({
  aiBridge = bridge,
  getAiConfig = () => ({}),
  onOpenSettings,
  onStatus,
  now = Date.now,
  requestIdFactory = createSelectionAiRequestId,
  timerHost = globalThis,
} = {}) {
  let state = emptySelectionAiState();
  let destroyed = false;
  let sessionSequence = 0;
  let requestGeneration = 0;
  const listeners = new Set();
  const activeRequests = new Map();
  const issuedRequestIds = new Set();
  const routeGenerations = new Map();
  const returnFocusBySessionId = new Map();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };
  const updateState = (updater) => {
    if (destroyed) return;
    const next = typeof updater === "function" ? updater(state) : updater;
    if (!next || next === state) return;
    state = next;
    notify();
  };
  const getDocument = (tabId) => state.documentsByTabId[tabId] || null;
  const getSession = (tabId, sessionId) => {
    const document = getDocument(tabId);
    if (!document) return null;
    const resolvedSessionId = sessionId || document.activeSessionId;
    return document.sessions.find(
      (session) => session.sessionId === resolvedSessionId,
    ) || null;
  };
  const resolveLocator = (options = {}) => {
    const locator = typeof options === "string" ? { tabId: options } : options;
    const tabId = tabIdFrom(locator) || state.expandedTabId || "";
    const document = getDocument(tabId);
    const sessionId = typeof locator?.sessionId === "string"
      ? locator.sessionId
      : (document?.activeSessionId || "");
    return {
      tabId,
      sessionId,
      document,
      session: getSession(tabId, sessionId),
    };
  };
  const updateDocument = (tabId, updater) => {
    updateState((current) => {
      const document = current.documentsByTabId[tabId];
      if (!document) return current;
      const nextDocument = updater(document);
      if (!nextDocument || nextDocument === document) return current;
      return {
        ...current,
        documentsByTabId: {
          ...current.documentsByTabId,
          [tabId]: nextDocument,
        },
      };
    });
  };
  const updateSession = (tabId, sessionId, updater) => {
    updateDocument(tabId, (document) => {
      let changed = false;
      const sessions = document.sessions.map((session) => {
        if (session.sessionId !== sessionId) return session;
        const nextSession = updater(session);
        if (!nextSession || nextSession === session) return session;
        changed = true;
        return nextSession;
      });
      return changed ? { ...document, sessions } : document;
    });
  };
  const updateAssistant = (request, patch) => {
    updateSession(request.tabId, request.sessionId, (session) => ({
      ...session,
      messages: session.messages.map((message) => (
        message.id === request.assistantId ? { ...message, ...patch } : message
      )),
    }));
  };
  const isSessionVisible = (tabId, sessionId) => {
    const document = getDocument(tabId);
    return Boolean(
      state.expandedTabId === tabId
      && document
      && !document.minimized
      && document.activeSessionId === sessionId,
    );
  };
  const scheduleReturnFocus = (sessionId) => {
    const focus = returnFocusBySessionId.get(sessionId);
    if (!focus) return;
    timerHost.requestAnimationFrame?.(() => focus());
  };
  const clearFlushTimer = (request) => {
    if (!request?.flushTimer) return;
    timerHost.clearTimeout?.(request.flushTimer);
    request.flushTimer = 0;
  };
  const isCurrentRequest = (request) => Boolean(
    request
    && activeRequests.get(request.requestId) === request
    && routeGenerations.get(request.routeKey) === request.generation
  );
  const flushRequest = (request) => {
    if (!isCurrentRequest(request)) return "";
    clearFlushTimer(request);
    if (request.pendingChunks.length) {
      request.output += request.pendingChunks.join("");
      request.pendingChunks.length = 0;
    }
    updateAssistant(request, {
      content: request.output,
      status: "streaming",
    });
    return request.output;
  };
  const retireRequest = (request) => {
    if (activeRequests.get(request?.requestId) === request) {
      activeRequests.delete(request.requestId);
    }
    if (request?.routeKey) {
      routeGenerations.set(
        request.routeKey,
        Math.max(
          routeGenerations.get(request.routeKey) || 0,
          request.generation + 1,
        ),
      );
    }
  };
  const requestForSession = (tabId, sessionId) => {
    for (const request of activeRequests.values()) {
      if (request.tabId === tabId && request.sessionId === sessionId) {
        return request;
      }
    }
    return null;
  };
  const cancelRequest = (
    request,
    { markStopped = false, update = true } = {},
  ) => {
    if (!isCurrentRequest(request)) return "";
    const output = markStopped ? flushRequest(request) : request.output;
    clearFlushTimer(request);
    retireRequest(request);
    if (update) {
      updateAssistant(request, {
        content: output,
        status: markStopped ? "stopped" : "error",
      });
      updateSession(request.tabId, request.sessionId, (session) => ({
        ...session,
        status: "idle",
        error: "",
      }));
    }
    void aiBridge.cancelAi?.(request.requestId);
    return request.requestId;
  };
  const cancelSessionRequest = (
    tabId,
    sessionId,
    options = {},
  ) => {
    const request = requestForSession(tabId, sessionId);
    return request ? cancelRequest(request, options) : "";
  };

  const handleChunk = (payload) => {
    const request = activeRequests.get(payload?.requestId);
    if (!isCurrentRequest(request)) return false;
    const delta = typeof payload?.delta === "string" ? payload.delta : "";
    if (delta) request.pendingChunks.push(delta);
    if (!request.flushTimer) {
      request.flushTimer = timerHost.setTimeout?.(() => {
        if (!isCurrentRequest(request)) return;
        request.flushTimer = 0;
        flushRequest(request);
      }, SELECTION_AI_STREAM_FLUSH_INTERVAL_MS);
    }
    return true;
  };
  const handleDone = (payload) => {
    const request = activeRequests.get(payload?.requestId);
    if (!isCurrentRequest(request)) return false;
    const output = flushRequest(request);
    retireRequest(request);
    const unread = !isSessionVisible(request.tabId, request.sessionId);
    updateSession(request.tabId, request.sessionId, (session) => ({
      ...session,
      messages: session.messages.map((message) => (
        message.id === request.assistantId
          ? {
            ...message,
            content: output,
            status: "done",
            usage: payload?.usage || null,
          }
          : message
      )),
      status: "idle",
      error: "",
      unread: session.unread || unread,
    }));
    return true;
  };
  const handleError = (payload) => {
    const request = activeRequests.get(payload?.requestId);
    if (!isCurrentRequest(request)) return false;
    const output = flushRequest(request);
    retireRequest(request);
    const aborted = Boolean(payload?.aborted);
    const unread = !aborted
      && !isSessionVisible(request.tabId, request.sessionId);
    updateSession(request.tabId, request.sessionId, (session) => ({
      ...session,
      messages: session.messages.map((message) => (
        message.id === request.assistantId
          ? {
            ...message,
            content: output,
            status: aborted ? "stopped" : "error",
          }
          : message
      )),
      status: aborted ? "idle" : "error",
      error: aborted
        ? ""
        : (payload?.message || "选区问答生成失败"),
      unread: session.unread || unread,
    }));
    return true;
  };

  const unsubscribeChunk = aiBridge.onAiChunk?.(handleChunk);
  const unsubscribeDone = aiBridge.onAiDone?.(handleDone);
  const unsubscribeError = aiBridge.onAiError?.(handleError);

  const totalSessionCount = () => Object.values(state.documentsByTabId)
    .reduce((count, document) => count + document.sessions.length, 0);
  const canCreateSession = (tabId) => {
    const documentCount = getDocument(tabId)?.sessions.length || 0;
    if (documentCount >= SELECTION_AI_MAX_SESSIONS_PER_DOCUMENT) {
      onStatus?.(
        `每封信笺最多保留 ${SELECTION_AI_MAX_SESSIONS_PER_DOCUMENT} 个选区问答会话，请先关闭旧会话`,
        "warning",
      );
      return false;
    }
    if (totalSessionCount() >= SELECTION_AI_MAX_SESSIONS_GLOBAL) {
      onStatus?.(
        `选区问答最多保留 ${SELECTION_AI_MAX_SESSIONS_GLOBAL} 个会话，请先关闭旧会话`,
        "warning",
      );
      return false;
    }
    return true;
  };
  const createSession = ({
    tabId,
    selection,
    selectedText,
    anchor,
    target,
    restoreFocus,
  }) => {
    sessionSequence += 1;
    const createdAt = now();
    const sessionId = `selection-session-${createdAt.toString(36)}-${sessionSequence.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const session = {
      sessionId,
      target: target ? { ...target, tabId } : { tabId },
      selectedText,
      anchor: normalizeAnchor(anchor),
      messages: [],
      input: "",
      status: "ready",
      error: "",
      unread: false,
      createdAt,
    };
    if (typeof restoreFocus === "function") {
      returnFocusBySessionId.set(sessionId, restoreFocus);
    }
    return session;
  };

  const open = ({
    selection,
    anchor,
    target = null,
    restoreFocus = null,
  } = {}) => {
    const selectedText = typeof selection?.text === "string"
      ? selection.text
      : "";
    const tabId = tabIdFrom(target);
    if (!tabId) {
      onStatus?.("无法确定选区所属的信笺", "warning");
      return false;
    }
    if (
      !selectedText.trim()
      || selectedText.length > SELECTION_AI_MAX_TEXT_CHARS
    ) {
      onStatus?.(
        selectedText.length > SELECTION_AI_MAX_TEXT_CHARS
          ? `选中文字不能超过 ${SELECTION_AI_MAX_TEXT_CHARS} 个字符`
          : "请先选中要询问的文字",
        "warning",
      );
      return false;
    }
    if (!canCreateSession(tabId)) return false;
    const session = createSession({
      tabId,
      selection,
      selectedText,
      anchor,
      target,
      restoreFocus,
    });
    updateState((current) => {
      const documentsByTabId = { ...current.documentsByTabId };
      if (
        current.expandedTabId
        && current.expandedTabId !== tabId
        && documentsByTabId[current.expandedTabId]
      ) {
        documentsByTabId[current.expandedTabId] = {
          ...documentsByTabId[current.expandedTabId],
          minimized: true,
        };
      }
      const existing = documentsByTabId[tabId];
      documentsByTabId[tabId] = existing
        ? {
          ...existing,
          sessions: [...existing.sessions, session],
          activeSessionId: session.sessionId,
          minimized: false,
        }
        : {
          tabId,
          sessions: [session],
          activeSessionId: session.sessionId,
          minimized: false,
          panelPosition: null,
        };
      return {
        documentsByTabId,
        expandedTabId: tabId,
      };
    });
    return true;
  };

  const newConversation = (options = {}) => {
    const { tabId, session } = resolveLocator(options);
    if (!tabId || !session || !canCreateSession(tabId)) return false;
    const cloned = createSession({
      tabId,
      selectedText: session.selectedText,
      anchor: session.anchor,
      target: session.target,
      restoreFocus: returnFocusBySessionId.get(session.sessionId),
    });
    updateState((current) => {
      const documentsByTabId = { ...current.documentsByTabId };
      if (
        current.expandedTabId
        && current.expandedTabId !== tabId
        && documentsByTabId[current.expandedTabId]
      ) {
        documentsByTabId[current.expandedTabId] = {
          ...documentsByTabId[current.expandedTabId],
          minimized: true,
        };
      }
      const document = documentsByTabId[tabId];
      documentsByTabId[tabId] = {
        ...document,
        sessions: [...document.sessions, cloned],
        activeSessionId: cloned.sessionId,
        minimized: false,
      };
      return {
        documentsByTabId,
        expandedTabId: tabId,
      };
    });
    return true;
  };

  const activate = (tabId, sessionId) => {
    const document = getDocument(tabId);
    if (!document) return false;
    const resolvedSessionId = sessionId || document.activeSessionId;
    if (!getSession(tabId, resolvedSessionId)) return false;
    updateSession(tabId, resolvedSessionId, (session) => (
      session.unread ? { ...session, unread: false } : session
    ));
    updateDocument(tabId, (current) => (
      current.activeSessionId === resolvedSessionId
        ? current
        : { ...current, activeSessionId: resolvedSessionId }
    ));
    return true;
  };

  const minimize = (options = {}, behavior = {}) => {
    const locator = typeof options === "string"
      ? { ...behavior, tabId: options }
      : options;
    const tabId = tabIdFrom(locator) || state.expandedTabId;
    const document = getDocument(tabId);
    if (!document) return false;
    const restoreFocus = locator?.restore !== false;
    updateState((current) => ({
      ...current,
      documentsByTabId: {
        ...current.documentsByTabId,
        [tabId]: {
          ...current.documentsByTabId[tabId],
          minimized: true,
        },
      },
      expandedTabId: current.expandedTabId === tabId
        ? null
        : current.expandedTabId,
    }));
    if (restoreFocus) scheduleReturnFocus(document.activeSessionId);
    return true;
  };

  const restore = (tabId) => {
    const document = getDocument(tabId);
    if (!document || !document.sessions.length) return false;
    updateState((current) => {
      const documentsByTabId = { ...current.documentsByTabId };
      if (
        current.expandedTabId
        && current.expandedTabId !== tabId
        && documentsByTabId[current.expandedTabId]
      ) {
        documentsByTabId[current.expandedTabId] = {
          ...documentsByTabId[current.expandedTabId],
          minimized: true,
        };
      }
      documentsByTabId[tabId] = {
        ...documentsByTabId[tabId],
        minimized: false,
        sessions: documentsByTabId[tabId].sessions.map((session) => (
          session.sessionId === documentsByTabId[tabId].activeSessionId
            ? { ...session, unread: false }
            : session
        )),
      };
      return {
        documentsByTabId,
        expandedTabId: tabId,
      };
    });
    return true;
  };

  const setPanelPosition = (tabId, position) => {
    const normalized = normalizePanelPosition(position);
    if (!getDocument(tabId) || !normalized) return false;
    updateDocument(tabId, (document) => {
      if (
        document.panelPosition?.left === normalized.left
        && document.panelPosition?.top === normalized.top
      ) {
        return document;
      }
      return { ...document, panelPosition: normalized };
    });
    return true;
  };

  const closeSession = (options = {}) => {
    const locator = typeof options === "string"
      ? { sessionId: options }
      : options;
    const { tabId, sessionId, document, session } = resolveLocator(locator);
    if (!document || !session) return false;
    cancelSessionRequest(tabId, sessionId, { update: false });
    const remaining = document.sessions.filter(
      (candidate) => candidate.sessionId !== sessionId,
    );
    const focus = returnFocusBySessionId.get(sessionId);
    const mostRecentRemaining = remaining.reduce((latest, candidate) => (
      !latest
      || Number(candidate.createdAt) >= Number(latest.createdAt)
        ? candidate
        : latest
    ), null);
    const nextActive = remaining.length
      ? (
        document.activeSessionId === sessionId
          ? mostRecentRemaining.sessionId
          : document.activeSessionId
      )
      : "";
    returnFocusBySessionId.delete(sessionId);
    updateState((current) => {
      const documentsByTabId = { ...current.documentsByTabId };
      if (!remaining.length) {
        delete documentsByTabId[tabId];
      } else {
        documentsByTabId[tabId] = {
          ...documentsByTabId[tabId],
          sessions: remaining.map((candidate) => (
            candidate.sessionId === nextActive
              ? { ...candidate, unread: false }
              : candidate
          )),
          activeSessionId: nextActive,
        };
      }
      return {
        documentsByTabId,
        expandedTabId: !remaining.length && current.expandedTabId === tabId
          ? null
          : current.expandedTabId,
      };
    });
    if (!remaining.length && locator?.restore !== false) {
      timerHost.requestAnimationFrame?.(() => focus?.());
    }
    return true;
  };

  const closeAll = (tabIdOrOptions = {}, behavior = {}) => {
    const options = typeof tabIdOrOptions === "string"
      ? { ...behavior, tabId: tabIdOrOptions }
      : tabIdOrOptions;
    const tabId = tabIdFrom(options) || state.expandedTabId;
    const document = getDocument(tabId);
    if (!document) return false;
    const focus = returnFocusBySessionId.get(document.activeSessionId);
    for (const session of document.sessions) {
      cancelSessionRequest(tabId, session.sessionId, { update: false });
      returnFocusBySessionId.delete(session.sessionId);
    }
    updateState((current) => {
      const documentsByTabId = { ...current.documentsByTabId };
      delete documentsByTabId[tabId];
      return {
        documentsByTabId,
        expandedTabId: current.expandedTabId === tabId
          ? null
          : current.expandedTabId,
      };
    });
    if (options?.restore !== false && focus) {
      timerHost.requestAnimationFrame?.(() => focus());
    }
    return true;
  };

  const syncOpenTabs = (openTabs) => {
    if (!Array.isArray(openTabs)) return false;
    const openTabIds = new Set(openTabs.map(tabIdFrom).filter(Boolean));
    const removedTabIds = Object.keys(state.documentsByTabId)
      .filter((tabId) => !openTabIds.has(tabId));
    if (!removedTabIds.length) return false;
    for (const tabId of removedTabIds) {
      const document = getDocument(tabId);
      for (const session of document?.sessions || []) {
        cancelSessionRequest(tabId, session.sessionId, { update: false });
        returnFocusBySessionId.delete(session.sessionId);
      }
    }
    updateState((current) => {
      const documentsByTabId = { ...current.documentsByTabId };
      removedTabIds.forEach((tabId) => delete documentsByTabId[tabId]);
      return {
        documentsByTabId,
        expandedTabId: removedTabIds.includes(current.expandedTabId)
          ? null
          : current.expandedTabId,
      };
    });
    return true;
  };

  const copyReply = async (content) => {
    const text = typeof content === "string" ? content : "";
    if (!text.trim()) return false;
    try {
      if (typeof aiBridge.writeClipboardContent !== "function") {
        throw new Error("当前环境不支持剪贴板");
      }
      await aiBridge.writeClipboardContent({ text });
      onStatus?.("AI 回复已复制", "success");
      return true;
    } catch {
      onStatus?.("复制失败，请手动选择回复文字", "error");
      return false;
    }
  };

  const setInput = (input, options = {}) => {
    const { tabId, sessionId, session } = resolveLocator(options);
    if (!session) return false;
    updateSession(tabId, sessionId, (current) => ({
      ...current,
      input: typeof input === "string" ? input : "",
      error: current.status === "error" ? "" : current.error,
      status: current.status === "error" ? "idle" : current.status,
    }));
    return true;
  };

  const send = async (options = {}) => {
    const locator = resolveLocator(options);
    const { tabId, sessionId } = locator;
    let session = locator.session;
    if (!session || session.status === "streaming") {
      return { ok: false, message: "当前不能发送" };
    }
    if (requestForSession(tabId, sessionId)) {
      return { ok: false, message: "当前会话正在生成" };
    }
    if (activeRequests.size >= SELECTION_AI_MAX_CONCURRENT_REQUESTS) {
      const message = `最多同时生成 ${SELECTION_AI_MAX_CONCURRENT_REQUESTS} 个选区问答，请等待其他会话完成`;
      updateSession(tabId, sessionId, (current) => ({
        ...current,
        status: "error",
        error: message,
      }));
      return {
        ok: false,
        code: "AI_SELECTION_CONCURRENCY_LIMIT",
        message,
      };
    }
    const question = session.input.trim();
    if (!question) return { ok: false, message: "请输入问题" };
    const completedRounds = session.messages.filter((message) => (
      message.role === "user"
    )).length;
    if (completedRounds >= SELECTION_AI_MAX_ROUNDS) {
      const message = `当前对话最多进行 ${SELECTION_AI_MAX_ROUNDS} 轮，请开始新对话`;
      updateSession(tabId, sessionId, (current) => ({
        ...current,
        status: "error",
        error: message,
      }));
      return {
        ok: false,
        code: "AI_SELECTION_ROUND_LIMIT",
        message,
      };
    }
    if (question.length > SELECTION_AI_MAX_QUESTION_CHARS) {
      const message = `问题不能超过 ${SELECTION_AI_MAX_QUESTION_CHARS} 个字符`;
      updateSession(tabId, sessionId, (current) => ({
        ...current,
        status: "error",
        error: message,
      }));
      return { ok: false, message };
    }
    const modelChoice = resolveSelectionAiModelChoice(getAiConfig());
    if (!modelChoice.available) {
      const message = modelChoice.invalid
        ? "选区问答模型已失效，请在“AI 配置 → 任务模型”中重新选择"
        : "请先配置并测试默认模型";
      updateSession(tabId, sessionId, (current) => ({
        ...current,
        status: "error",
        error: message,
      }));
      return {
        ok: false,
        code: modelChoice.invalid
          ? "AI_SELECTION_CHAT_MODEL_INVALID"
          : "AI_DEFAULT_MODEL_UNAVAILABLE",
        message,
      };
    }

    const history = selectionAiHistoryFromMessages(session.messages);
    const requestId = requestIdFactory();
    const payload = {
      requestId,
      selectedText: session.selectedText,
      history,
      question,
    };
    const validated = validateSelectionAiPayload(payload);
    if (!validated.ok) {
      updateSession(tabId, sessionId, (current) => ({
        ...current,
        status: "error",
        error: validated.message,
      }));
      return validated;
    }
    if (issuedRequestIds.has(requestId)) {
      const message = "选区问答请求标识冲突，请重试";
      updateSession(tabId, sessionId, (current) => ({
        ...current,
        status: "error",
        error: message,
      }));
      return {
        ok: false,
        code: "AI_SELECTION_REQUEST_ID_CONFLICT",
        message,
      };
    }
    const createdAt = now();
    const userMessage = {
      id: createMessageId("selection-user", createdAt),
      role: "user",
      content: question,
      status: "done",
      createdAt,
    };
    const assistantMessage = {
      id: createMessageId("selection-assistant", createdAt),
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt,
    };
    const routeKey = requestRouteKey(tabId, sessionId);
    requestGeneration += 1;
    const generation = requestGeneration;
    routeGenerations.set(routeKey, generation);
    const request = {
      requestId,
      routeKey,
      generation,
      tabId,
      sessionId,
      assistantId: assistantMessage.id,
      output: "",
      pendingChunks: [],
      flushTimer: 0,
    };
    issuedRequestIds.add(requestId);
    activeRequests.set(requestId, request);
    updateSession(tabId, sessionId, (current) => ({
      ...current,
      messages: [...current.messages, userMessage, assistantMessage],
      input: "",
      status: "streaming",
      error: "",
      unread: false,
    }));

    let result;
    try {
      result = await aiBridge.generateSelectionAi?.(validated.value);
    } catch (error) {
      result = {
        ok: false,
        message: error?.message || "选区问答启动失败",
      };
    }
    session = getSession(tabId, sessionId);
    if (!session) return result || { ok: false, message: "请求已失效" };
    if (!result?.ok && isCurrentRequest(request)) {
      clearFlushTimer(request);
      retireRequest(request);
      updateAssistant(request, { status: "error" });
      updateSession(tabId, sessionId, (current) => ({
        ...current,
        status: "error",
        error: result?.message || "选区问答启动失败",
      }));
      return result || { ok: false, message: "选区问答启动失败" };
    }
    if (result?.model) {
      updateAssistant(request, { model: result.model });
    }
    return result || { ok: false, message: "选区问答启动失败" };
  };

  const stop = (options = {}) => {
    const { tabId, sessionId } = resolveLocator(options);
    return Boolean(cancelSessionRequest(tabId, sessionId, {
      markStopped: true,
      update: true,
    }));
  };
  const close = (options = {}) => closeSession(options);
  const openSettings = () => onOpenSettings?.({
    panel: "tasks",
    taskId: "selectionChat",
  });
  const getTabSessionSummary = (tabId) => {
    const document = getDocument(tabId);
    if (!document) {
      return {
        count: 0,
        hasContent: false,
        hasDraft: false,
        isStreaming: false,
      };
    }
    return {
      count: document.sessions.length,
      hasContent: document.sessions.some(
        (session) => session.messages.length > 0,
      ),
      hasDraft: document.sessions.some(
        (session) => Boolean(session.input.trim()),
      ),
      isStreaming: document.sessions.some(
        (session) => Boolean(requestForSession(tabId, session.sessionId)),
      ),
    };
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = () => state;
  const destroy = () => {
    if (destroyed) return;
    for (const request of [...activeRequests.values()]) {
      cancelRequest(request, { update: false });
    }
    destroyed = true;
    unsubscribeChunk?.();
    unsubscribeDone?.();
    unsubscribeError?.();
    listeners.clear();
    state = emptySelectionAiState();
    returnFocusBySessionId.clear();
    routeGenerations.clear();
    issuedRequestIds.clear();
  };

  return {
    activate,
    close,
    closeAll,
    closeSession,
    copyReply,
    destroy,
    getDocument,
    getSnapshot,
    getTabSessionSummary,
    minimize,
    newConversation,
    open,
    openSettings,
    restore,
    send,
    setInput,
    setPanelPosition,
    stop,
    subscribe,
    syncOpenTabs,
  };
}

export function useSelectionAiController({
  aiBridge = bridge,
  aiConfig,
  onOpenSettings,
  onStatus,
} = {}) {
  const configRef = useRef(aiConfig);
  const openSettingsRef = useRef(onOpenSettings);
  const statusRef = useRef(onStatus);
  configRef.current = aiConfig;
  openSettingsRef.current = onOpenSettings;
  statusRef.current = onStatus;

  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createSelectionAiController({
      aiBridge,
      getAiConfig: () => configRef.current,
      onOpenSettings: (...args) => openSettingsRef.current?.(...args),
      onStatus: (...args) => statusRef.current?.(...args),
      timerHost: window,
    });
  }
  const controller = controllerRef.current;
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => () => controller.destroy(), [controller]);
  const modelChoice = useMemo(
    () => resolveSelectionAiModelChoice(aiConfig),
    [aiConfig],
  );
  const expandedDocument = state.expandedTabId
    ? state.documentsByTabId[state.expandedTabId] || null
    : null;
  const expandedSession = expandedDocument?.sessions.find(
    (session) => session.sessionId === expandedDocument.activeSessionId,
  ) || null;
  return {
    controller,
    state,
    modelChoice,
    expandedDocument,
    expandedSession,
    isOpen: Boolean(expandedDocument && !expandedDocument.minimized),
    isStreaming: expandedSession?.status === "streaming",
    activate: controller.activate,
    close: controller.close,
    closeAll: controller.closeAll,
    closeSession: controller.closeSession,
    copyReply: controller.copyReply,
    getDocument: controller.getDocument,
    getTabSessionSummary: controller.getTabSessionSummary,
    minimize: controller.minimize,
    newConversation: controller.newConversation,
    open: controller.open,
    openSettings: controller.openSettings,
    restore: controller.restore,
    send: controller.send,
    setInput: controller.setInput,
    setPanelPosition: controller.setPanelPosition,
    stop: controller.stop,
    syncOpenTabs: controller.syncOpenTabs,
  };
}
