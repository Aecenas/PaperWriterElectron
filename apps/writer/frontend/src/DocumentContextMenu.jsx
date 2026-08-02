import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Columns2,
  FileClock,
  LayoutTemplate,
  PanelLeft,
  PanelRight,
  Rows3,
  ScrollText,
  X,
} from "lucide-react";
import { PAGE_VIEW_MODES } from "./pagination/index.js";

const MENU_WIDTH = 184;
const SUBMENU_WIDTH = 196;
const MENU_MARGIN = 8;

export function positionDocumentContextMenu(event, extra = {}) {
  const anchorX = Number(event?.clientX) || 0;
  const anchorY = Number(event?.clientY) || 0;
  const viewportWidth = Math.max(MENU_WIDTH + MENU_MARGIN * 2, window.innerWidth || 0);
  const viewportHeight = Math.max(240, window.innerHeight || 0);
  return {
    ...extra,
    x: Math.max(MENU_MARGIN, Math.min(anchorX, viewportWidth - MENU_WIDTH - MENU_MARGIN)),
    y: Math.max(MENU_MARGIN, Math.min(anchorY, viewportHeight - MENU_MARGIN)),
    openUp: anchorY > viewportHeight * 0.62,
    openSubmenuLeft: anchorX + MENU_WIDTH + SUBMENU_WIDTH + MENU_MARGIN * 3 > viewportWidth,
  };
}

const PAGE_OPTIONS = [
  { mode: PAGE_VIEW_MODES.CONTINUOUS, label: "连续", icon: ScrollText },
  { mode: PAGE_VIEW_MODES.SINGLE, label: "单页", icon: Rows3 },
  { mode: PAGE_VIEW_MODES.SPREAD, label: "双页", icon: Columns2 },
];

export default function DocumentContextMenu({
  menu,
  title = "当前信笺",
  pageViewMode = PAGE_VIEW_MODES.CONTINUOUS,
  moveTarget = "",
  moveAllowed = true,
  includeClose = true,
  onSetPageViewMode,
  onOpenHistory,
  onOpenTemplate,
  onMove,
  onCloseDocument,
  onDismiss,
}) {
  const menuRef = useRef(null);
  const pageViewButtonRef = useRef(null);
  const pageViewMenuRef = useRef(null);
  const onDismissRef = useRef(onDismiss);
  const [pageViewOpen, setPageViewOpen] = useState(false);
  const activePageOption = useMemo(() => (
    PAGE_OPTIONS.find((option) => option.mode === pageViewMode) || PAGE_OPTIONS[0]
  ), [pageViewMode]);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!menu) return undefined;
    setPageViewOpen(false);
    const close = (event) => {
      if (event?.type === "keydown" && event.key !== "Escape") return;
      onDismissRef.current?.();
    };
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
    });
    window.document.addEventListener("pointerdown", close);
    window.document.addEventListener("keydown", close);
    return () => {
      window.cancelAnimationFrame(frame);
      window.document.removeEventListener("pointerdown", close);
      window.document.removeEventListener("keydown", close);
    };
  }, [menu]);

  if (!menu) return null;

  const run = (action) => {
    onDismiss?.();
    action?.();
  };

  const openPageViewMenu = (focusFirst = false) => {
    setPageViewOpen(true);
    if (focusFirst) {
      window.requestAnimationFrame(() => {
        pageViewMenuRef.current?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
      });
    }
  };

  const ActivePageIcon = activePageOption.icon;

  return (
    <div
      ref={menuRef}
      className="document-context-menu"
      style={{
        left: `${menu.x}px`,
        top: `${menu.y}px`,
        transform: menu.openUp ? "translateY(-100%)" : undefined,
      }}
      role="menu"
      aria-label={`${title}操作`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="document-context-view-shell"
        onPointerEnter={() => openPageViewMenu(false)}
      >
        <button
          ref={pageViewButtonRef}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={pageViewOpen}
          aria-label={`页面视图，当前${activePageOption.label}`}
          onClick={() => openPageViewMenu(false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              openPageViewMenu(true);
            }
          }}
        >
          <ActivePageIcon size={16} aria-hidden="true" />
          <span>页面视图</span>
          <small>{activePageOption.label}</small>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        {pageViewOpen ? (
          <div
            ref={pageViewMenuRef}
            className={`document-context-view-submenu${menu.openSubmenuLeft ? " opens-left" : ""}`}
            role="menu"
            aria-label="页面视图模式"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setPageViewOpen(false);
                pageViewButtonRef.current?.focus({ preventScroll: true });
              }
            }}
          >
            {PAGE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = pageViewMode === option.mode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  className={selected ? "is-active" : ""}
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => run(() => onSetPageViewMode?.(option.mode))}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{option.label}</span>
                  {selected ? <Check className="document-context-check" size={13} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <span className="document-context-divider" role="separator" />

      {onOpenHistory ? (
        <button type="button" role="menuitem" onClick={() => run(onOpenHistory)}>
          <FileClock size={16} aria-hidden="true" />
          <span>版本历史</span>
        </button>
      ) : null}
      {onOpenTemplate ? (
        <button type="button" role="menuitem" onClick={() => run(onOpenTemplate)}>
          <LayoutTemplate size={16} aria-hidden="true" />
          <span>修改模板</span>
        </button>
      ) : null}
      {moveTarget && onMove ? (
        <button
          type="button"
          role="menuitem"
          disabled={!moveAllowed}
          title={moveAllowed ? "" : "当前页面视图不支持开启右侧编辑组"}
          onClick={() => {
            if (moveAllowed) run(onMove);
          }}
        >
          {moveTarget === "primary"
            ? <PanelLeft size={16} aria-hidden="true" />
            : <PanelRight size={16} aria-hidden="true" />}
          <span>{moveTarget === "primary" ? "移到左侧" : "移到右侧"}</span>
        </button>
      ) : null}

      {includeClose && onCloseDocument ? (
        <>
          <span className="document-context-divider" role="separator" />
          <button
            type="button"
            className="is-danger"
            role="menuitem"
            onClick={() => run(onCloseDocument)}
          >
            <X size={16} aria-hidden="true" />
            <span>关闭标签</span>
          </button>
        </>
      ) : null}
    </div>
  );
}
