import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns2,
  FileText,
  Minus,
  Plus,
} from "lucide-react";
import {
  PAGE_VIEW_MODES,
  PAGE_ZOOM_MODES,
  reducePageViewState,
  spreadStartPage,
} from "./page-view-state.js";

const MODE_OPTIONS = [
  { id: PAGE_VIEW_MODES.CONTINUOUS, label: "连续", icon: FileText },
  { id: PAGE_VIEW_MODES.SINGLE, label: "单页", icon: BookOpen },
  { id: PAGE_VIEW_MODES.SPREAD, label: "双页", icon: Columns2 },
];

export function PageViewToolbar({
  state,
  pageCount = 1,
  disabled = false,
  showModes = true,
  collapsed = false,
  onCollapsedChange,
  onChange,
}) {
  const update = (action) => onChange?.(reducePageViewState(state, action, pageCount));
  const showNavigation = state.mode !== PAGE_VIEW_MODES.CONTINUOUS;
  const spreadStart = state.mode === PAGE_VIEW_MODES.SPREAD
    ? spreadStartPage(state.currentPage, pageCount)
    : state.currentPage;
  const previousDisabled = spreadStart <= 1;
  const nextDisabled = state.mode === PAGE_VIEW_MODES.SPREAD
    ? spreadStart + 1 >= pageCount
    : state.currentPage >= pageCount;
  if (!showModes && !showNavigation) return null;
  if (!showModes && collapsed) {
    return (
      <div className="page-view-toolbar page-view-navigation is-collapsed" role="toolbar" aria-label="已收起的翻页与缩放工具栏">
        <button
          type="button"
          className="page-view-collapse-button"
          aria-label="展开页码条"
          title="展开页码条"
          onClick={() => onCollapsedChange?.(false)}
        >
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
    );
  }
  return (
    <div className={showModes ? "page-view-toolbar" : "page-view-toolbar page-view-navigation"} role="toolbar" aria-label={showModes ? "页面视图" : "翻页与缩放"}>
      {showModes ? (
        <div className="page-view-modes" role="group" aria-label="页面模式">
          {MODE_OPTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={state.mode === id ? "active" : ""}
              disabled={disabled}
              aria-pressed={state.mode === id}
              aria-label={`${label}模式`}
              title={`${label}模式`}
              onClick={() => update({ type: "set-mode", mode: id })}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {showNavigation ? (
        <>
          {showModes ? <span className="page-view-separator" aria-hidden="true" /> : null}
          <button
            type="button"
            className="page-view-icon-button"
            disabled={disabled || previousDisabled}
            aria-label="上一页"
            onClick={() => update({ type: "previous" })}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <label className="page-view-page-input">
            <span className="sr-only">当前页码</span>
            <input
              type="number"
              min="1"
              max={pageCount}
              value={state.currentPage}
              disabled={disabled}
              onChange={(event) => update({ type: "set-page", page: event.target.value })}
            />
            <span>/ {pageCount}</span>
          </label>
          <button
            type="button"
            className="page-view-icon-button"
            disabled={disabled || nextDisabled}
            aria-label="下一页"
            onClick={() => update({ type: "next" })}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <span className="page-view-separator" aria-hidden="true" />
          <button
            type="button"
            className="page-view-icon-button"
            disabled={disabled}
            aria-label="缩小页面"
            onClick={() => update({ type: "set-zoom", zoom: state.zoom - 0.1 })}
          >
            <Minus size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={state.zoomMode === PAGE_ZOOM_MODES.FIT ? "page-view-fit active" : "page-view-fit"}
            disabled={disabled}
            aria-pressed={state.zoomMode === PAGE_ZOOM_MODES.FIT}
            onClick={() => update({ type: "set-fit" })}
          >
            {state.zoomMode === PAGE_ZOOM_MODES.FIT ? "适合窗口" : `${Math.round(state.zoom * 100)}%`}
          </button>
          <button
            type="button"
            className="page-view-icon-button"
            disabled={disabled}
            aria-label="放大页面"
            onClick={() => update({ type: "set-zoom", zoom: state.zoom + 0.1 })}
          >
            <Plus size={15} aria-hidden="true" />
          </button>
          {!showModes ? (
            <button
              type="button"
              className="page-view-collapse-button"
              aria-label="收起页码条"
              title="收起页码条"
              onClick={() => onCollapsedChange?.(true)}
            >
              <ChevronUp size={15} aria-hidden="true" />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
