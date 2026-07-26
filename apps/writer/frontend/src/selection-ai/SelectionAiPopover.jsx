import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Bot,
  Copy,
  GripHorizontal,
  MessageSquarePlus,
  Minus,
  MoreHorizontal,
  Send,
  Settings,
  Square,
  X,
} from "lucide-react";
import { SELECTION_AI_MAX_QUESTION_CHARS } from "./protocol.js";
import { SelectionAiMarkdown } from "./SelectionAiMarkdown.jsx";
import "./SelectionAiPopover.css";

export const SELECTION_AI_POPOVER_WIDTH = 520;
export const SELECTION_AI_POPOVER_HEIGHT = 620;
export const SELECTION_AI_POPOVER_MARGIN = 12;
const SELECTION_AI_POPOVER_TOP = 52;
const SELECTION_AI_POPOVER_BOTTOM = 48;
const SELECTION_AI_SNAPSHOT_PREVIEW_CHARS = 72;
const SELECTION_AI_SESSION_TITLE_CHARS = 18;
const SELECTION_AI_SNAPSHOT_HOVER_DELAY_MS = 160;

function finitePosition(position) {
  const left = Number(position?.left);
  const top = Number(position?.top);
  return Number.isFinite(left) && Number.isFinite(top)
    ? { left, top }
    : null;
}

function effectivePopoverSize(viewportWidth, viewportHeight) {
  return {
    width: Math.max(
      280,
      Math.min(
        SELECTION_AI_POPOVER_WIDTH,
        (Number(viewportWidth) || SELECTION_AI_POPOVER_WIDTH) - 24,
      ),
    ),
    height: Math.max(
      360,
      Math.min(
        SELECTION_AI_POPOVER_HEIGHT,
        (Number(viewportHeight) || SELECTION_AI_POPOVER_HEIGHT) - 76,
      ),
    ),
  };
}

export function clampSelectionAiPopoverPosition(
  position,
  viewportWidth = globalThis.innerWidth,
  viewportHeight = globalThis.innerHeight,
) {
  const viewportW = Number(viewportWidth) || SELECTION_AI_POPOVER_WIDTH + 24;
  const viewportH = Number(viewportHeight) || SELECTION_AI_POPOVER_HEIGHT + 76;
  const size = effectivePopoverSize(viewportW, viewportH);
  const maxLeft = Math.max(
    SELECTION_AI_POPOVER_MARGIN,
    viewportW - size.width - SELECTION_AI_POPOVER_MARGIN,
  );
  const maxTop = Math.max(
    SELECTION_AI_POPOVER_MARGIN,
    viewportH - size.height - SELECTION_AI_POPOVER_BOTTOM,
  );
  const minTop = Math.min(SELECTION_AI_POPOVER_TOP, maxTop);
  const normalized = finitePosition(position) || {
    left: (viewportW - size.width) / 2,
    top: Math.max(minTop, (viewportH - size.height) / 2),
  };
  return {
    left: Math.max(
      SELECTION_AI_POPOVER_MARGIN,
      Math.min(normalized.left, maxLeft),
    ),
    top: Math.max(
      minTop,
      Math.min(normalized.top, maxTop),
    ),
  };
}

export function resolveSelectionAiPopoverPosition(
  anchor,
  viewportWidth = globalThis.innerWidth,
  viewportHeight = globalThis.innerHeight,
  savedPosition = null,
) {
  const saved = finitePosition(savedPosition);
  if (saved) {
    return clampSelectionAiPopoverPosition(
      saved,
      viewportWidth,
      viewportHeight,
    );
  }
  const viewportW = Number(viewportWidth) || SELECTION_AI_POPOVER_WIDTH + 24;
  const viewportH = Number(viewportHeight) || SELECTION_AI_POPOVER_HEIGHT + 76;
  const size = effectivePopoverSize(viewportW, viewportH);
  const anchorLeft = Number(anchor?.left);
  const anchorTop = Number(anchor?.top);
  const preferredLeft = Number.isFinite(anchorLeft)
    ? anchorLeft - size.width / 2
    : (viewportW - size.width) / 2;
  const preferredBelow = Number.isFinite(anchorTop) ? anchorTop + 24 : 112;
  const preferredAbove = Number.isFinite(anchorTop)
    ? anchorTop - size.height - 18
    : preferredBelow;
  return clampSelectionAiPopoverPosition({
    left: preferredLeft,
    top: preferredBelow + size.height <= viewportH - SELECTION_AI_POPOVER_BOTTOM
      ? preferredBelow
      : preferredAbove,
  }, viewportW, viewportH);
}

export function selectionAiDocumentSessions(documentState) {
  if (!documentState) return [];
  if (Array.isArray(documentState.sessions)) {
    return documentState.sessions.filter(Boolean);
  }
  const sessionsById = documentState.sessionsById || {};
  const order = Array.isArray(documentState.sessionOrder)
    ? documentState.sessionOrder
    : Object.keys(sessionsById);
  return order.map((sessionId) => sessionsById[sessionId]).filter(Boolean);
}

export function createSelectionAiSnapshotPreview(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= SELECTION_AI_SNAPSHOT_PREVIEW_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, SELECTION_AI_SNAPSHOT_PREVIEW_CHARS).trimEnd()}…`;
}

export function createSelectionAiSessionTitle(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= SELECTION_AI_SESSION_TITLE_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, SELECTION_AI_SESSION_TITLE_CHARS).trimEnd()}…`;
}

function sessionIdentifier(session) {
  return String(session?.sessionId || session?.id || "");
}

function sessionStatus(session) {
  return String(session?.status || "ready");
}

function selectionAiDocumentFromController(controller, tabId) {
  if (!tabId) return null;
  if (typeof controller?.getDocument === "function") {
    return controller.getDocument(tabId) || null;
  }
  return controller?.state?.documentsByTabId?.[tabId] || null;
}

function SelectionAiMessage({ message, onCopy }) {
  return (
    <article className={`selection-ai-message ${message.role} ${message.status || ""}`}>
      <span className="selection-ai-message-heading">
        <strong>{message.role === "user" ? "你" : "AI"}</strong>
        {message.role === "assistant" && message.content ? (
          <button
            type="button"
            onClick={() => void onCopy(message.content)}
            aria-label="复制 AI 回复"
            title="复制回复"
          >
            <Copy size={13} />
          </button>
        ) : null}
      </span>
      {message.role === "assistant" && message.content ? (
        <SelectionAiMarkdown text={message.content} />
      ) : (
        <p>{message.content || (message.status === "streaming" ? "正在思考…" : "")}</p>
      )}
      {message.status === "stopped" ? <small>已停止</small> : null}
      {message.status === "error" ? <small>生成失败</small> : null}
    </article>
  );
}

function SelectionAiSessionTabs({
  activeSessionId,
  controller,
  documentState,
  sessions,
}) {
  const tabRefs = useRef(new Map());
  const tabId = documentState?.tabId || documentState?.targetTabId || "";
  const activate = useCallback((sessionId, { focus = false } = {}) => {
    controller.activate?.(tabId, sessionId);
    if (focus) {
      window.requestAnimationFrame(() => {
        tabRefs.current.get(sessionId)?.focus({ preventScroll: true });
      });
    }
  }, [controller, tabId]);

  const move = useCallback((event, index) => {
    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + sessions.length) % sessions.length;
    else if (event.key === "ArrowRight") nextIndex = (index + 1) % sessions.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = sessions.length - 1;
    else return;
    event.preventDefault();
    const sessionId = sessionIdentifier(sessions[nextIndex]);
    if (sessionId) activate(sessionId, { focus: true });
  }, [activate, sessions]);

  return (
    <div className="selection-ai-session-tabs" role="tablist" aria-label="选区问答会话">
      {sessions.map((session, index) => {
        const sessionId = sessionIdentifier(session);
        const selected = sessionId === activeSessionId;
        const preview = createSelectionAiSessionTitle(
          session.selectionPreview || session.selectedText,
        );
        const status = sessionStatus(session);
        return (
          <button
            key={sessionId}
            ref={(element) => {
              if (element) tabRefs.current.set(sessionId, element);
              else tabRefs.current.delete(sessionId);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls="selection-ai-active-conversation"
            tabIndex={selected ? 0 : -1}
            className={[
              "selection-ai-session-tab",
              selected ? "active" : "",
              status,
              session.unread ? "unread" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => activate(sessionId)}
            onKeyDown={(event) => move(event, index)}
          >
            <span className="selection-ai-session-number">{index + 1}</span>
            <span className="selection-ai-session-title">{preview || "选区问答"}</span>
            <span className="selection-ai-session-state" aria-hidden="true" />
            <span className="sr-only">
              {status === "streaming" ? "正在生成" : ""}
              {status === "error" ? "生成失败" : ""}
              {session.unread ? "有新回复" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SelectionAiSnapshot({ session, onEscape }) {
  const triggerRef = useRef(null);
  const hoverTimerRef = useRef(0);
  const [visible, setVisible] = useState(false);
  const [pinned, setPinned] = useState(false);
  const selectedText = String(session?.selectedText || "");
  const preview = session?.selectionPreview
    || createSelectionAiSnapshotPreview(selectedText);
  const contentId = `selection-ai-snapshot-${sessionIdentifier(session) || "active"}`;

  const clearHoverTimer = useCallback(() => {
    if (!hoverTimerRef.current) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = 0;
  }, []);

  const close = useCallback(({ focus = false } = {}) => {
    clearHoverTimer();
    setPinned(false);
    setVisible(false);
    if (focus) {
      window.requestAnimationFrame(() => {
        triggerRef.current?.focus({ preventScroll: true });
      });
    }
  }, [clearHoverTimer]);

  useEffect(() => {
    close();
  }, [close, sessionIdentifier(session)]);

  useEffect(() => {
    onEscape.current = () => {
      if (!visible) return false;
      close({ focus: true });
      return true;
    };
    return () => {
      onEscape.current = null;
    };
  }, [close, onEscape, visible]);

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  return (
    <div
      className="selection-ai-snapshot"
      onPointerEnter={() => {
        clearHoverTimer();
        hoverTimerRef.current = window.setTimeout(() => {
          hoverTimerRef.current = 0;
          setVisible(true);
        }, SELECTION_AI_SNAPSHOT_HOVER_DELAY_MS);
      }}
      onPointerLeave={() => {
        clearHoverTimer();
        if (!pinned) setVisible(false);
      }}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !pinned) {
          setVisible(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="selection-ai-snapshot-trigger"
        aria-expanded={visible}
        aria-controls={contentId}
        onClick={() => {
          setVisible(true);
          setPinned((current) => !current);
        }}
      >
        <strong>选中内容快照</strong>
        <span>{preview}</span>
        <small>{selectedText.length.toLocaleString("zh-CN")} 字</small>
      </button>
      {visible ? (
        <div
          id={contentId}
          className="selection-ai-snapshot-card"
          role="region"
          aria-label="完整选中内容快照"
          tabIndex={pinned ? 0 : -1}
        >
          <header>
            <strong>完整快照</strong>
            <span>{selectedText.length.toLocaleString("zh-CN")} 字</span>
          </header>
          <p>{selectedText}</p>
        </div>
      ) : null}
    </div>
  );
}

export function SelectionAiPopover({
  controller,
  onRequestCloseAll,
  onRequestCloseSession,
}) {
  const expandedTabId = controller?.state?.expandedTabId
    || controller?.expandedTabId
    || "";
  const documentState = controller?.expandedDocument
    || selectionAiDocumentFromController(controller, expandedTabId);
  const sessions = useMemo(
    () => selectionAiDocumentSessions(documentState),
    [documentState],
  );
  const activeSessionId = String(
    documentState?.activeSessionId || controller?.expandedSession?.sessionId || "",
  );
  const session = controller?.expandedSession
    || sessions.find((item) => sessionIdentifier(item) === activeSessionId)
    || sessions[0]
    || null;
  const tabId = String(documentState?.tabId || expandedTabId || session?.tabId || "");
  const open = Boolean(tabId && session && expandedTabId === tabId);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const messagesRef = useRef(null);
  const snapshotEscapeRef = useRef(null);
  const dragRef = useRef(null);
  const previousSessionRef = useRef("");
  const previousStatusRef = useRef("");
  const [dragPosition, setDragPosition] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [viewportRevision, setViewportRevision] = useState(0);
  const status = sessionStatus(session);
  const isStreaming = status === "streaming";
  const persistedPosition = documentState?.panelPosition;
  const resolvedPosition = resolveSelectionAiPopoverPosition(
    session?.anchor || documentState?.anchor,
    globalThis.innerWidth,
    globalThis.innerHeight,
    persistedPosition,
  );
  const position = dragPosition || resolvedPosition;

  useEffect(() => {
    if (!open) return undefined;
    const handleResize = () => setViewportRevision((value) => value + 1);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open]);

  useEffect(() => {
    if (!open || !finitePosition(persistedPosition)) return;
    const clamped = clampSelectionAiPopoverPosition(
      persistedPosition,
      globalThis.innerWidth,
      globalThis.innerHeight,
    );
    if (
      clamped.left !== persistedPosition.left
      || clamped.top !== persistedPosition.top
    ) {
      controller.setPanelPosition?.(tabId, clamped);
    }
  }, [controller, open, persistedPosition, tabId, viewportRevision]);

  useEffect(() => {
    setDragPosition(null);
    setMoreOpen(false);
  }, [activeSessionId, tabId]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      const blockingModal = [...document.querySelectorAll('[aria-modal="true"]')]
        .some((element) => (
          element !== rootRef.current
          && !rootRef.current?.contains(element)
        ));
      if (blockingModal) return;
      if (moreOpen) {
        event.preventDefault();
        event.stopPropagation();
        setMoreOpen(false);
        return;
      }
      if (snapshotEscapeRef.current?.()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      controller.minimize?.({ tabId, restore: true });
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [controller, moreOpen, open, tabId]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const handlePointerDown = (event) => {
      if (event.target?.closest?.(".selection-ai-more-wrap")) return;
      setMoreOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [moreOpen]);

  useLayoutEffect(() => {
    if (!open || !session) return;
    const previousSessionId = previousSessionRef.current;
    previousSessionRef.current = sessionIdentifier(session);
    const activeElement = window.document.activeElement;
    const focusAlreadyInside = rootRef.current?.contains(activeElement);
    if (!previousSessionId || !focusAlreadyInside) {
      const frame = window.requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open, session]);

  useLayoutEffect(() => {
    if (!open) return;
    const container = messagesRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [open, session?.messages]);

  useEffect(() => {
    if (!open) return;
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    if (previousStatus === status) return;
    if (status === "streaming") setAnnouncement("AI 开始回答");
    else if (previousStatus === "streaming" && status === "idle") setAnnouncement("AI 回答完成");
    else if (status === "error") setAnnouncement("AI 回答失败");
  }, [open, status]);

  const commitPosition = useCallback((nextPosition) => {
    const clamped = clampSelectionAiPopoverPosition(
      nextPosition,
      globalThis.innerWidth,
      globalThis.innerHeight,
    );
    setDragPosition(null);
    controller.setPanelPosition?.(tabId, clamped);
    return clamped;
  }, [controller, tabId]);

  const startDrag = useCallback((event) => {
    if (
      event.button !== 0
      || event.target?.closest?.("button, textarea, input, [role='tab'], [role='menu']")
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: position.left,
      startTop: position.top,
      current: position,
    };
    setDragging(true);
  }, [position]);

  const moveDrag = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampSelectionAiPopoverPosition({
      left: drag.startLeft + event.clientX - drag.startX,
      top: drag.startTop + event.clientY - drag.startY,
    }, globalThis.innerWidth, globalThis.innerHeight);
    drag.current = next;
    setDragPosition(next);
  }, []);

  const endDrag = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    commitPosition(drag.current);
  }, [commitPosition]);

  const moveWithKeyboard = useCallback((event) => {
    if (event.target !== event.currentTarget) return;
    const deltas = {
      ArrowLeft: [-1, 0, "左"],
      ArrowRight: [1, 0, "右"],
      ArrowUp: [0, -1, "上"],
      ArrowDown: [0, 1, "下"],
    };
    const move = deltas[event.key];
    if (!move) return;
    event.preventDefault();
    const distance = event.shiftKey ? 64 : 16;
    const next = commitPosition({
      left: position.left + move[0] * distance,
      top: position.top + move[1] * distance,
    });
    setAnnouncement(`选区问答窗口已向${move[2]}移动，横坐标 ${Math.round(next.left)}，纵坐标 ${Math.round(next.top)}`);
  }, [commitPosition, position]);

  const requestCloseSession = useCallback(async () => {
    const context = { documentState, session, sessionId: sessionIdentifier(session), tabId };
    if (onRequestCloseSession) {
      await onRequestCloseSession(context);
      return;
    }
    controller.closeSession?.({
      tabId,
      sessionId: sessionIdentifier(session),
      restore: true,
    });
  }, [controller, documentState, onRequestCloseSession, session, tabId]);

  const requestCloseAll = useCallback(async () => {
    setMoreOpen(false);
    const context = { documentState, sessions, tabId };
    if (onRequestCloseAll) {
      await onRequestCloseAll(context);
      return;
    }
    controller.closeAll?.(tabId, { restore: true });
  }, [controller, documentState, onRequestCloseAll, sessions, tabId]);

  void viewportRevision;
  if (!open) return null;

  return createPortal(
    <section
      ref={rootRef}
      className={[
        "selection-ai-popover",
        dragging ? "dragging" : "",
      ].filter(Boolean).join(" ")}
      style={{ left: position.left, top: position.top }}
      role="dialog"
      aria-label="选区 AI 问答"
      aria-describedby="selection-ai-privacy-note"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header
        className="selection-ai-popover-header"
        tabIndex={0}
        aria-label="移动选区问答窗口；使用方向键移动，按住 Shift 可大幅移动"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={moveWithKeyboard}
      >
        <span className="selection-ai-popover-mark" aria-hidden="true">
          <Bot size={18} />
        </span>
        <span className="selection-ai-popover-heading">
          <strong>选区问答</strong>
          <small>{controller.modelChoice?.label || "任务模型"}</small>
        </span>
        <span className="selection-ai-drag-affordance" aria-hidden="true">
          <GripHorizontal size={16} />
        </span>
        <button
          type="button"
          onClick={() => {
            controller.newConversation?.({
              tabId,
              sessionId: sessionIdentifier(session),
            });
            window.requestAnimationFrame(() => {
              inputRef.current?.focus({ preventScroll: true });
            });
          }}
          aria-label="基于当前选区开始新会话"
          title="新会话（保留当前选区）"
        >
          <MessageSquarePlus size={16} />
        </button>
        <button
          type="button"
          onClick={() => {
            controller.minimize?.({ tabId, restore: false });
            controller.openSettings?.();
          }}
          aria-label="打开 AI 配置"
          title="打开 AI 配置"
        >
          <Settings size={16} />
        </button>
        <button
          type="button"
          onClick={() => controller.minimize?.({ tabId, restore: true })}
          aria-label="最小化选区问答"
          title="最小化"
        >
          <Minus size={17} />
        </button>
        <span className="selection-ai-more-wrap">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((current) => !current)}
            aria-label="更多会话操作"
            title="更多"
          >
            <MoreHorizontal size={17} />
          </button>
          {moreOpen ? (
            <span className="selection-ai-more-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void requestCloseAll()}>
                关闭全部会话
              </button>
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="selection-ai-close-session"
          onClick={() => void requestCloseSession()}
          aria-label="关闭当前选区问答会话"
          title="关闭当前会话"
        >
          <X size={17} />
        </button>
      </header>

      <SelectionAiSessionTabs
        activeSessionId={sessionIdentifier(session)}
        controller={controller}
        documentState={documentState}
        sessions={sessions}
      />

      <SelectionAiSnapshot
        key={sessionIdentifier(session)}
        session={session}
        onEscape={snapshotEscapeRef}
      />

      <div
        id="selection-ai-active-conversation"
        ref={messagesRef}
        className="selection-ai-messages"
        role="tabpanel"
        aria-busy={isStreaming}
      >
        {session.messages?.length ? session.messages.map((message) => (
          <SelectionAiMessage
            key={message.id}
            message={message}
            onCopy={controller.copyReply}
          />
        )) : (
          <p className="selection-ai-empty">围绕这段选中文字提问。后续问题只会携带这段快照和当前会话历史。</p>
        )}
      </div>

      {session.error ? (
        <div className="selection-ai-error" role="alert">
          <span>{session.error}</span>
          {session.error.includes("模型") ? (
            <button
              type="button"
              onClick={() => {
                controller.minimize?.({ tabId, restore: false });
                controller.openSettings?.();
              }}
            >
              去配置
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="selection-ai-composer">
        <textarea
          ref={inputRef}
          aria-label="选区问答问题"
          value={session.input || ""}
          rows={3}
          maxLength={SELECTION_AI_MAX_QUESTION_CHARS}
          placeholder="询问这段文字…"
          disabled={isStreaming}
          onChange={(event) => controller.setInput?.(event.target.value, {
            tabId,
            sessionId: sessionIdentifier(session),
          })}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter"
              || event.shiftKey
              || event.nativeEvent?.isComposing
            ) {
              return;
            }
            event.preventDefault();
            void controller.send?.({
              tabId,
              sessionId: sessionIdentifier(session),
            });
          }}
        />
        {isStreaming ? (
          <button
            type="button"
            className="selection-ai-stop"
            onClick={() => controller.stop?.({
              tabId,
              sessionId: sessionIdentifier(session),
            })}
            aria-label="停止生成"
            title="停止生成"
          >
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            className="selection-ai-send"
            disabled={!String(session.input || "").trim()}
            onClick={() => void controller.send?.({
              tabId,
              sessionId: sessionIdentifier(session),
            })}
            aria-label="发送问题"
            title="发送"
          >
            <Send size={16} />
          </button>
        )}
      </div>
      <footer id="selection-ai-privacy-note">
        仅发送选中内容快照、你的问题和当前会话历史
        <span>Enter 发送 · Shift+Enter 换行</span>
      </footer>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </section>,
    document.body,
  );
}

export function SelectionAiSprite({
  anchorRef,
  controller,
  hidden = false,
  tabId,
}) {
  const documentState = selectionAiDocumentFromController(controller, tabId);
  const sessions = selectionAiDocumentSessions(documentState);
  const expandedTabId = controller?.state?.expandedTabId
    || controller?.expandedTabId
    || "";
  const [position, setPosition] = useState(null);
  const generating = sessions.filter((session) => sessionStatus(session) === "streaming").length;
  const errors = sessions.filter((session) => sessionStatus(session) === "error").length;
  const unread = sessions.filter((session) => session.unread).length;

  useLayoutEffect(() => {
    if (hidden || !sessions.length || expandedTabId === tabId) return undefined;
    let frame = 0;
    const update = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = anchorRef?.current?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          setPosition(null);
          return;
        }
        setPosition({
          left: Math.max(12, Math.min(rect.right - 64, window.innerWidth - 60)),
          top: Math.max(52, Math.min(rect.bottom - 66, window.innerHeight - 66)),
        });
      });
    };
    update();
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(update)
      : null;
    if (anchorRef?.current) observer?.observe(anchorRef.current);
    window.addEventListener("resize", update);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [anchorRef, expandedTabId, hidden, sessions.length, tabId]);

  if (
    hidden
    || !tabId
    || !sessions.length
    || expandedTabId === tabId
    || !position
  ) {
    return null;
  }

  const accessibleName = [
    `选区问答，${sessions.length} 个会话`,
    generating ? `${generating} 个正在生成` : "",
    unread ? `${unread} 个新回复` : "",
    errors ? `${errors} 个失败` : "",
  ].filter(Boolean).join("，");

  return createPortal(
    <button
      type="button"
      className={[
        "selection-ai-sprite",
        generating ? "streaming" : "",
        unread ? "has-unread" : "",
        errors ? "has-error" : "",
      ].filter(Boolean).join(" ")}
      style={{ left: position.left, top: position.top }}
      aria-label={accessibleName}
      title="恢复选区问答"
      onClick={() => controller.restore?.(tabId)}
    >
      <span className="selection-ai-sprite-ring" aria-hidden="true" />
      <span className="selection-ai-sprite-face" aria-hidden="true">
        <Bot size={24} strokeWidth={1.9} />
      </span>
      <span className="selection-ai-sprite-count" aria-hidden="true">
        {sessions.length > 99 ? "99+" : sessions.length}
      </span>
      {unread ? <span className="selection-ai-sprite-unread" aria-hidden="true" /> : null}
      {errors ? (
        <span className="selection-ai-sprite-error" aria-hidden="true">
          <AlertCircle size={13} />
        </span>
      ) : null}
    </button>,
    document.body,
  );
}
