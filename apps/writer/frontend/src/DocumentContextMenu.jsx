import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Columns2,
  Expand,
  FileClock,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  PanelLeft,
  PanelRight,
  Rows3,
  ScrollText,
  Square,
  X,
} from "lucide-react";
import {
  PAGE_DISPLAY_SIZES,
  PAGE_DISPLAY_SIZE_OPTIONS,
  PAGE_VIEW_MODES,
  normalizePageViewState,
  pageDisplaySizeForState,
  pageDisplaySizeLabel,
} from "./pagination/index.js";

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

const DISPLAY_SIZE_ICONS = Object.freeze({
  [PAGE_DISPLAY_SIZES.SMALL]: Minimize2,
  [PAGE_DISPLAY_SIZES.MEDIUM]: Square,
  [PAGE_DISPLAY_SIZES.LARGE]: Maximize2,
  [PAGE_DISPLAY_SIZES.EXTRA_LARGE]: Expand,
});

export default function DocumentContextMenu({
  menu,
  title = "当前信笺",
  pageViewMode = PAGE_VIEW_MODES.CONTINUOUS,
  pageViewState,
  moveTarget = "",
  moveAllowed = true,
  includeClose = true,
  onSetPageViewMode,
  onSetDisplaySize,
  onOpenHistory,
  onOpenTemplate,
  onMove,
  onCloseDocument,
  onDismiss,
}) {
  const menuRef = useRef(null);
  const pageViewButtonRef = useRef(null);
  const pageViewMenuRef = useRef(null);
  const displaySizeButtonRef = useRef(null);
  const displaySizeMenuRef = useRef(null);
  const onDismissRef = useRef(onDismiss);
  const [openSubmenu, setOpenSubmenu] = useState("");
  const normalizedPageViewState = useMemo(() => normalizePageViewState(
    pageViewState || { mode: pageViewMode },
  ), [pageViewMode, pageViewState]);
  const resolvedPageViewMode = normalizedPageViewState.mode;
  const activeDisplaySize = useMemo(
    () => pageDisplaySizeForState(normalizedPageViewState),
    [normalizedPageViewState],
  );
  const activeDisplaySizeLabel = useMemo(
    () => pageDisplaySizeLabel(normalizedPageViewState),
    [normalizedPageViewState],
  );
  const activePageOption = useMemo(() => (
    PAGE_OPTIONS.find((option) => option.mode === resolvedPageViewMode) || PAGE_OPTIONS[0]
  ), [resolvedPageViewMode]);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!menu) return undefined;
    setOpenSubmenu("");
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

  const openNestedMenu = (name, focusFirst = false) => {
    setOpenSubmenu(name);
    if (focusFirst) {
      window.requestAnimationFrame(() => {
        const target = name === "page-view" ? pageViewMenuRef.current : displaySizeMenuRef.current;
        target?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
      });
    }
  };

  const ActivePageIcon = activePageOption.icon;
  const ActiveDisplaySizeIcon = DISPLAY_SIZE_ICONS[activeDisplaySize] || Square;

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
        onPointerEnter={() => openNestedMenu("page-view", false)}
        onPointerLeave={() => setOpenSubmenu("")}
      >
        <button
          ref={pageViewButtonRef}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openSubmenu === "page-view"}
          aria-label={`页面视图，当前${activePageOption.label}`}
          onClick={() => openNestedMenu("page-view", false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              openNestedMenu("page-view", true);
            }
          }}
        >
          <ActivePageIcon size={16} aria-hidden="true" />
          <span>页面视图</span>
          <small>{activePageOption.label}</small>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        {openSubmenu === "page-view" ? (
          <div
            ref={pageViewMenuRef}
            className={`document-context-view-submenu${menu.openSubmenuLeft ? " opens-left" : ""}`}
            role="menu"
            aria-label="页面视图模式"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setOpenSubmenu("");
                pageViewButtonRef.current?.focus({ preventScroll: true });
              }
            }}
          >
            {PAGE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = resolvedPageViewMode === option.mode;
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

      {onSetDisplaySize ? (
        <div
          className="document-context-view-shell document-context-display-size-shell"
          onPointerEnter={() => openNestedMenu("display-size", false)}
          onPointerLeave={() => setOpenSubmenu("")}
        >
          <button
            ref={displaySizeButtonRef}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openSubmenu === "display-size"}
            aria-label={`显示大小，当前${activeDisplaySizeLabel}`}
            onClick={() => openNestedMenu("display-size", false)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                openNestedMenu("display-size", true);
              }
            }}
          >
            <ActiveDisplaySizeIcon size={16} aria-hidden="true" />
            <span>显示大小</span>
            <small>{activeDisplaySizeLabel}</small>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          {openSubmenu === "display-size" ? (
            <div
              ref={displaySizeMenuRef}
              className={`document-context-view-submenu document-context-display-size-submenu${menu.openSubmenuLeft ? " opens-left" : ""}`}
              role="menu"
              aria-label="正文显示大小"
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setOpenSubmenu("");
                  displaySizeButtonRef.current?.focus({ preventScroll: true });
                }
              }}
            >
              {PAGE_DISPLAY_SIZE_OPTIONS.map((option) => {
                const Icon = DISPLAY_SIZE_ICONS[option.value] || Square;
                const selected = activeDisplaySize === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={selected ? "is-active" : ""}
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => run(() => onSetDisplaySize?.(option.value))}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>{option.label}</span>
                    <small>{option.value === PAGE_DISPLAY_SIZES.MEDIUM
                      ? (resolvedPageViewMode === PAGE_VIEW_MODES.CONTINUOUS ? "100%" : "适合窗口")
                      : `${Math.round(option.zoom * 100)}%`}</small>
                    {selected ? <Check className="document-context-check" size={13} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

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
