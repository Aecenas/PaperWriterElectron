import { useEffect, useRef, useState } from "react";
import { BookOpen, FileCode2, FileImage, FileQuestion, FileSpreadsheet, FileText, Globe2, LayoutTemplate, PanelLeft, PanelRight, Plus, X } from "lucide-react";

const DRAG_MIME = "application/x-paperwriter-group-view";
const GROUP_TAB_MENU_WIDTH = 160;

export function scrollGroupTabListOnWheel(list, event) {
  if (!list || list.scrollWidth <= list.clientWidth + 1) return false;
  const deltaX = Number(event?.deltaX) || 0;
  const deltaY = Number(event?.deltaY) || 0;
  const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
  if (!delta) return false;
  const maximum = Math.max(0, list.scrollWidth - list.clientWidth);
  const next = Math.max(0, Math.min(maximum, list.scrollLeft + delta));
  if (Math.abs(next - list.scrollLeft) < 0.5) return false;
  list.scrollLeft = next;
  event?.preventDefault?.();
  return true;
}

function researchIcon(type) {
  if (type === "web") return Globe2;
  if (type === "markdown") return FileCode2;
  if (type === "image") return FileImage;
  if (type === "table") return FileSpreadsheet;
  if (type === "text") return FileText;
  if (type === "unsupported") return FileQuestion;
  return BookOpen;
}

function viewLabel(view) {
  return String(view?.title || (view?.kind === "research" ? "未命名资料" : "未命名信笺"));
}

function readDragView(event) {
  try {
    const value = JSON.parse(event.dataTransfer.getData(DRAG_MIME) || "null");
    if (!value || !["primary", "secondary"].includes(value.groupId) || !value.viewId) return null;
    return value;
  } catch {
    return null;
  }
}

export default function GroupTabStrip({
  groupId,
  items = [],
  activeViewId = "",
  focused = false,
  disabled = false,
  allowNew = true,
  onActivate,
  onClose,
  onNewDocument,
  onReorder,
  onMoveDocument,
  onOpenTemplatePicker,
  canMoveDocument,
}) {
  const listRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [dropTarget, setDropTarget] = useState("");

  useEffect(() => {
    const active = listRef.current?.querySelector?.(`[data-view-id="${CSS.escape(activeViewId || "")}"]`);
    active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeViewId, items.length]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    window.document.addEventListener("pointerdown", close);
    window.document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.document.removeEventListener("pointerdown", close);
      window.document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const contextView = contextMenu ? items.find((item) => item.viewId === contextMenu.viewId) : null;
  const otherGroup = groupId === "primary" ? "secondary" : "primary";
  const moveAllowed = contextView?.kind === "document" && (canMoveDocument?.(contextView, otherGroup) ?? true);

  const handleDrop = (event, beforeViewId = "") => {
    const dragged = readDragView(event);
    setDropTarget("");
    if (!dragged || disabled) return;
    event.preventDefault();
    if (dragged.groupId === groupId) {
      if (dragged.viewId !== beforeViewId) onReorder?.(dragged.viewId, beforeViewId || null);
      return;
    }
    if (dragged.kind === "document") onMoveDocument?.(dragged.viewId, groupId, beforeViewId || null);
  };

  return (
    <div
      className={["group-tabs", focused ? "is-focused" : "", disabled ? "is-disabled" : ""].filter(Boolean).join(" ")}
      data-group-id={groupId}
      aria-label={groupId === "primary" ? "左侧编辑组标签" : "右侧编辑组标签"}
    >
      <div className="group-tab-strip">
        <div
          ref={listRef}
          className="group-tab-list"
          role="tablist"
          onDragOver={(event) => {
            if (!disabled && Array.from(event.dataTransfer.types || []).includes(DRAG_MIME)) {
              event.preventDefault();
              setDropTarget("__end__");
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget("");
          }}
          onDrop={(event) => handleDrop(event)}
          onWheel={(event) => scrollGroupTabListOnWheel(event.currentTarget, event)}
        >
          {items.map((view) => {
            const Icon = view.kind === "research" ? researchIcon(view.researchType) : FileText;
            const active = view.viewId === activeViewId;
            return (
              <button
                key={view.viewId}
                type="button"
                role="tab"
                data-view-id={view.viewId}
                data-view-kind={view.kind}
                aria-selected={active}
                className={[
                  "group-tab",
                  active ? "active" : "",
                  dropTarget === view.viewId ? "drop-before" : "",
                ].filter(Boolean).join(" ")}
                disabled={disabled}
                draggable={!disabled}
                title={view.path || viewLabel(view)}
                onClick={() => onActivate?.(view.viewId)}
                onContextMenu={(event) => {
                  if (disabled) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const anchorX = event.clientX || rect.left;
                  const anchorY = event.clientY || rect.bottom;
                  const menuWidth = Math.min(GROUP_TAB_MENU_WIDTH, Math.max(0, window.innerWidth - 16));
                  setContextMenu({
                    viewId: view.viewId,
                    x: Math.max(8, Math.min(anchorX, window.innerWidth - menuWidth - 8)),
                    y: Math.max(8, Math.min(anchorY, window.innerHeight - 8)),
                    openUp: anchorY > window.innerHeight / 2,
                  });
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = view.kind === "document" ? "move" : "move";
                  event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ groupId, viewId: view.viewId, kind: view.kind }));
                }}
                onDragEnd={() => setDropTarget("")}
                onDragEnter={(event) => {
                  if (!disabled && Array.from(event.dataTransfer.types || []).includes(DRAG_MIME)) {
                    event.preventDefault();
                    setDropTarget(view.viewId);
                  }
                }}
                onDragOver={(event) => {
                  if (!disabled && Array.from(event.dataTransfer.types || []).includes(DRAG_MIME)) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.stopPropagation();
                  handleDrop(event, view.viewId);
                }}
              >
                <Icon className="group-tab-kind" size={16} strokeWidth={1.8} aria-hidden="true" />
                {view.dirty ? <span className="group-tab-dot" aria-label="尚未保存" /> : null}
                <span className="group-tab-title">{viewLabel(view)}</span>
                {view.kind === "research" && view.metaLabel ? <small>{view.metaLabel}</small> : null}
                <i
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-label={`关闭 ${viewLabel(view)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose?.(view.viewId);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onClose?.(view.viewId);
                    }
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </i>
              </button>
            );
          })}
          {dropTarget === "__end__" ? <span className="group-tab-drop-end" aria-hidden="true" /> : null}
        </div>
        {allowNew ? (
          <button type="button" className="group-tab add" disabled={disabled} onClick={onNewDocument} aria-label="在当前组新建信笺" title="新建信笺">
            <Plus size={20} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {contextMenu && contextView ? (
        <div
          className="document-tab-menu group-tab-menu"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            transform: contextMenu.openUp ? "translateY(-100%)" : undefined,
          }}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextView.kind === "document" ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const returnFocusElement = listRef.current?.querySelector?.(
                  `[data-view-id="${CSS.escape(contextView.viewId)}"]`,
                );
                onOpenTemplatePicker?.(contextView, returnFocusElement);
                setContextMenu(null);
              }}
            >
              <LayoutTemplate size={15} aria-hidden="true" />
              <span>修改模板</span>
            </button>
          ) : null}
          {contextView.kind === "document" ? (
            <button
              type="button"
              role="menuitem"
              disabled={!moveAllowed}
              title={moveAllowed ? "" : "左侧编辑组至少需要保留一个信笺"}
              onClick={() => {
                if (!moveAllowed) return;
                onMoveDocument?.(contextView.viewId, otherGroup, null);
                setContextMenu(null);
              }}
            >
              {otherGroup === "primary" ? <PanelLeft size={15} aria-hidden="true" /> : <PanelRight size={15} aria-hidden="true" />}
              <span>{otherGroup === "primary" ? "移到左侧" : "移到右侧"}</span>
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => { onClose?.(contextView.viewId); setContextMenu(null); }}>
            <X size={15} aria-hidden="true" />
            <span>关闭标签</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
