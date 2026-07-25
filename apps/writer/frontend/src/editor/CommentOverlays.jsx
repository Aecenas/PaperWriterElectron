import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorState } from "@tiptap/react";
import { Check, MessageSquare, Pencil, Trash2, X } from "lucide-react";
import { normalizeDocumentComments } from "../editor-comments.js";
import {
  COMMENT_COLOR_PALETTE,
  COMMENT_TRACKS,
  assignDocumentCommentPresentations,
  buildCommentAnchorTopMap,
  getCommentAnchorTop,
} from "./comment-model.js";
import { getDocumentComments } from "./decorations.js";

export function CommentAnchors({ editor, comments = [], activeCommentId = "", hidden = false, onOpenComment }) {
  const normalizedComments = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getDocumentComments(activeEditor, comments),
  }) || normalizeDocumentComments(comments);
  const [positions, setPositions] = useState([]);
  const positionFrameRef = useRef(0);
  const clearPositions = useCallback(() => {
    setPositions((current) => (current.length ? [] : current));
  }, []);

  const updatePositions = useCallback(() => {
    if (!editor?.view || hidden || !normalizedComments.length) {
      clearPositions();
      return;
    }
    const sheet = editor.view.dom.closest(".paper-sheet");
    if (!sheet) {
      clearPositions();
      return;
    }
    const sheetRect = sheet.getBoundingClientRect();
    const maxPosition = editor.state.doc.content.size;
    const topById = buildCommentAnchorTopMap(editor, normalizedComments);
    const commentPresentations = assignDocumentCommentPresentations(normalizedComments, topById);
    const nextPositions = normalizedComments.flatMap((comment) => {
      const from = Math.max(1, Math.min(comment.from, maxPosition));
      const presentation = commentPresentations.get(comment.id);
      const color = presentation?.color || COMMENT_COLOR_PALETTE[0];
      const track = presentation?.track || COMMENT_TRACKS[0];
      try {
        const lineCenter = topById.get(comment.id) || getCommentAnchorTop(editor, from);
        return [{
          id: comment.id,
          top: Math.max(28, (lineCenter || sheetRect.top) - sheetRect.top),
          side: track.side,
          offset: track.offset,
          color,
          comment,
        }];
      } catch {
        return [];
      }
    });
    setPositions(nextPositions);
  }, [clearPositions, editor, hidden, normalizedComments]);

  useEffect(() => {
    if (!editor?.view || hidden || !normalizedComments.length) {
      clearPositions();
      return undefined;
    }
    const updateSoon = () => {
      if (positionFrameRef.current) return;
      positionFrameRef.current = window.requestAnimationFrame(() => {
        positionFrameRef.current = 0;
        updatePositions();
      });
    };
    document.addEventListener("scroll", updateSoon, true);
    window.addEventListener("resize", updateSoon);
    editor.on("transaction", updateSoon);
    updateSoon();
    return () => {
      if (positionFrameRef.current) {
        window.cancelAnimationFrame(positionFrameRef.current);
        positionFrameRef.current = 0;
      }
      document.removeEventListener("scroll", updateSoon, true);
      window.removeEventListener("resize", updateSoon);
      editor.off("transaction", updateSoon);
    };
  }, [clearPositions, editor, hidden, normalizedComments.length, updatePositions]);

  if (hidden || !positions.length) {
    return null;
  }

  return (
    <div className="comment-anchor-layer" aria-label="评注标记">
      {positions.map(({ id, top, side, offset, color, comment }) => (
        <button
          key={id}
          type="button"
          className={id === activeCommentId ? "comment-anchor active" : "comment-anchor"}
          style={{
            top: `${top}px`,
            ...(side === "left" ? { left: `${18 + offset}px` } : { right: `${18 - offset}px` }),
            "--comment-border": color.border,
            "--comment-bg": color.anchorBg,
            "--comment-ink": color.ink,
          }}
          onClick={(event) => onOpenComment?.(comment, { left: event.clientX, top: event.clientY })}
          title="查看评注"
          aria-label="查看评注"
        >
          <MessageSquare size={15} strokeWidth={2.2} />
        </button>
      ))}
    </div>
  );
}

export function getEditorRangeRects(editor, from, to, containerRect) {
  if (!editor?.view || from === to) {
    return [];
  }
  try {
    const start = editor.view.domAtPos(Math.min(from, to));
    const end = editor.view.domAtPos(Math.max(from, to));
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      }));
    range.detach?.();
    const rows = [];
    rects.forEach((rect) => {
      const center = (rect.top + rect.bottom) / 2;
      const row = rows.at(-1);
      if (row && Math.abs(row.center - center) < 4) {
        row.left = Math.min(row.left, rect.left);
        row.right = Math.max(row.right, rect.right);
        row.top = Math.min(row.top, rect.top);
        row.bottom = Math.max(row.bottom, rect.bottom);
        row.center = (row.top + row.bottom) / 2;
      } else {
        rows.push({ ...rect, center });
      }
    });
    return rows.map((row) => ({
      left: row.left - containerRect.left,
      top: row.top - containerRect.top,
      width: row.right - row.left,
      height: row.bottom - row.top,
    }));
  } catch {
    return [];
  }
}

export function CommentHighlights({ editor, comments = [], activeCommentId = "", hidden = false }) {
  const normalizedComments = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getDocumentComments(activeEditor, comments),
  }) || normalizeDocumentComments(comments);
  const [highlights, setHighlights] = useState([]);
  const highlightFrameRef = useRef(0);
  const clearHighlights = useCallback(() => {
    setHighlights((current) => (current.length ? [] : current));
  }, []);

  const updateHighlights = useCallback(() => {
    if (!editor?.view || hidden || !activeCommentId || !normalizedComments.length) {
      clearHighlights();
      return;
    }
    const sheet = editor.view.dom.closest(".paper-sheet");
    if (!sheet) {
      clearHighlights();
      return;
    }
    const sheetRect = sheet.getBoundingClientRect();
    const maxPosition = editor.state.doc.content.size;
    const topById = buildCommentAnchorTopMap(editor, normalizedComments);
    const commentPresentations = assignDocumentCommentPresentations(normalizedComments, topById);
    const nextHighlights = normalizedComments.filter((comment) => comment.id === activeCommentId).flatMap((comment) => {
      const from = Math.max(1, Math.min(comment.from, maxPosition));
      const to = Math.max(1, Math.min(comment.to, maxPosition));
      const presentation = commentPresentations.get(comment.id);
      const color = presentation?.color || COMMENT_COLOR_PALETTE[0];
      return getEditorRangeRects(editor, from, to, sheetRect).map((rect, index) => ({
        id: `${comment.id}-${index}`,
        rect,
        color,
      }));
    });
    setHighlights(nextHighlights);
  }, [activeCommentId, clearHighlights, editor, hidden, normalizedComments]);

  useEffect(() => {
    if (!editor?.view || hidden || !activeCommentId || !normalizedComments.length) {
      clearHighlights();
      return undefined;
    }
    const updateSoon = () => {
      if (highlightFrameRef.current) return;
      highlightFrameRef.current = window.requestAnimationFrame(() => {
        highlightFrameRef.current = 0;
        updateHighlights();
      });
    };
    document.addEventListener("scroll", updateSoon, true);
    window.addEventListener("resize", updateSoon);
    editor.on("transaction", updateSoon);
    updateSoon();
    return () => {
      if (highlightFrameRef.current) {
        window.cancelAnimationFrame(highlightFrameRef.current);
        highlightFrameRef.current = 0;
      }
      document.removeEventListener("scroll", updateSoon, true);
      window.removeEventListener("resize", updateSoon);
      editor.off("transaction", updateSoon);
    };
  }, [activeCommentId, clearHighlights, editor, hidden, normalizedComments.length, updateHighlights]);

  if (hidden || !highlights.length) {
    return null;
  }

  return (
    <div className="comment-highlight-layer" aria-hidden="true">
      {highlights.map(({ id, rect, color }) => (
        <span
          key={id}
          className="comment-highlight-rect"
          style={{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            "--comment-border": color.border,
            "--comment-bg": color.bg,
          }}
        />
      ))}
    </div>
  );
}

export function CommentPanel({ panel, comment, onTextChange, onPositionChange, onSave, onEdit, onDelete, onClose }) {
  const textValue = panel?.mode === "view" ? (comment?.text || "") : (panel?.text || "");
  const isEditing = panel?.mode === "create" || panel?.mode === "edit";
  const title = panel?.mode === "create" ? "新建评注" : (panel?.mode === "edit" ? "编辑评注" : "评注");
  const left = Math.max(12, Math.min(panel?.x || 0, window.innerWidth - 352));
  const top = Math.max(52, Math.min(panel?.y || 0, window.innerHeight - 300));
  const textareaRef = useRef(null);

  const handleDragStart = useCallback((event) => {
    if (event.button !== 0 || event.target.closest?.("button")) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = left;
    const startTop = top;
    const handleMove = (moveEvent) => {
      const nextLeft = Math.max(12, Math.min(startLeft + moveEvent.clientX - startX, window.innerWidth - 352));
      const nextTop = Math.max(52, Math.min(startTop + moveEvent.clientY - startY, window.innerHeight - 180));
      onPositionChange?.({ x: nextLeft, y: nextTop });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", cleanup, true);
      window.removeEventListener("pointercancel", cleanup, true);
    };
    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", cleanup, true);
    window.addEventListener("pointercancel", cleanup, true);
  }, [left, onPositionChange, top]);

  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
    }
  }, [isEditing, panel?.mode]);

  if (!panel) {
    return null;
  }

  return createPortal(
    <section
      className="comment-panel"
      style={{ left, top }}
      onMouseDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-label={title}
    >
      <header onPointerDown={handleDragStart}>
        <span>
          <MessageSquare size={16} />
          {title}
        </span>
        <button type="button" onClick={onClose} aria-label="关闭评注" title="关闭评注">
          <X size={15} />
        </button>
      </header>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={panel.text}
          onChange={(event) => onTextChange?.(event.target.value)}
          placeholder="写下这段文字的评注"
          maxLength={2000}
        />
      ) : (
        <p>{textValue}</p>
      )}
      <footer>
        {isEditing ? (
          <>
            <button type="button" className="ghost" onClick={onClose}>取消</button>
            <button type="button" className="primary" disabled={!panel.text?.trim()} onClick={onSave}>
              <Check size={14} />
              <span>保存</span>
            </button>
          </>
        ) : (
          <>
            <button type="button" className="danger" onClick={onDelete}>
              <Trash2 size={14} />
              <span>删除</span>
            </button>
            <button type="button" className="ghost" onClick={onEdit}>
              <Pencil size={14} />
              <span>编辑</span>
            </button>
          </>
        )}
      </footer>
    </section>,
    document.body,
  );
}

