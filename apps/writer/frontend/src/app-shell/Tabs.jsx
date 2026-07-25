import { useEffect, useRef, useState } from "react";
import {
  FileText,
  Palette,
  PanelRightClose,
  Plus,
  X,
} from "lucide-react";
import { ICON_ASSETS } from "./assets.js";

export function DocumentTabs({
  tabs,
  capacityTabCount = tabs.length,
  activeTabId,
  rightSplitTabId = "",
  onSelectTab,
  onCloseTab,
  onNew,
  onToggleRightSplit,
  onOpenTemplates,
  disabled = false,
  closeDisabled = disabled,
  newDisabled = disabled,
  showNew = true,
  compact = false,
  secondaryOccupied = false,
  onCapacityChange,
}) {
  const stripRef = useRef(null);
  const listRef = useRef(null);
  const addRef = useRef(null);
  const [atCapacity, setAtCapacity] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);

  useEffect(() => {
    if (!showNew) {
      setAtCapacity(false);
      onCapacityChange?.(false);
      return undefined;
    }
    const strip = stripRef.current;
    const list = listRef.current;
    const add = addRef.current;
    if (!strip || !list || !add) {
      setAtCapacity(false);
      onCapacityChange?.(false);
      return undefined;
    }
    const measureCapacity = () => {
      const isCompactStrip = compact || Boolean(strip.closest(".ai-mode-top-strip, .secondary-pane-top-strip"));
      const stripStyle = window.getComputedStyle(strip);
      const listStyle = window.getComputedStyle(list);
      const stripGap = Number.parseFloat(stripStyle.columnGap || stripStyle.gap || "0") || 0;
      const listGap = Number.parseFloat(listStyle.columnGap || listStyle.gap || "0") || 0;
      const addWidth = add.getBoundingClientRect().width || (isCompactStrip ? 38 : 48);
      const minTabWidth = isCompactStrip ? 112 : 120;
      const nextTabCount = Math.max(tabs.length, Number(capacityTabCount) || 0) + 1;
      const nextMinWidth = (nextTabCount * minTabWidth) + (Math.max(0, nextTabCount - 1) * listGap);
      const availableWidth = strip.clientWidth - addWidth - stripGap;
      const nextAtCapacity = nextMinWidth > availableWidth + 0.5;
      setAtCapacity(nextAtCapacity);
      onCapacityChange?.(nextAtCapacity);
    };
    measureCapacity();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureCapacity) : null;
    resizeObserver?.observe(strip);
    window.addEventListener("resize", measureCapacity);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureCapacity);
    };
  }, [capacityTabCount, compact, onCapacityChange, showNew, tabs.length]);

  const resolvedNewDisabled = newDisabled || atCapacity;
  const addTitle = atCapacity ? "标签栏已满，关闭一个信笺后再新建" : "新建文件";
  const tabsClassName = [
    "document-tabs",
    disabled ? "disabled" : "",
    showNew ? "" : "no-new",
  ].filter(Boolean).join(" ");

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const closeMenu = () => setContextMenu(null);
    window.document.addEventListener("pointerdown", closeMenu);
    window.document.addEventListener("keydown", closeMenu);
    return () => {
      window.document.removeEventListener("pointerdown", closeMenu);
      window.document.removeEventListener("keydown", closeMenu);
    };
  }, [contextMenu]);

  const contextTab = contextMenu ? tabs.find((tab) => tab.id === contextMenu.tabId) : null;
  const splitActionLabel = contextTab?.id === rightSplitTabId
    ? "取消向右分屏"
    : (rightSplitTabId || secondaryOccupied ? "替换右侧内容" : "向右分屏");

  return (
    <div className={tabsClassName} aria-label="打开的文件">
      <div className="document-tab-strip" ref={stripRef}>
        <div className="document-tab-list" ref={listRef}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === activeTabId ? "document-tab active" : "document-tab"}
              disabled={disabled}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(event) => {
                if ((!onToggleRightSplit && !onOpenTemplates) || disabled) {
                  return;
                }
                event.preventDefault();
                setContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
              }}
              title={tab.path || tab.title}
            >
              {tab.dirty ? <span className="document-tab-dot" /> : null}
              <span>{tab.title || "未命名信笺"}</span>
              {tab.id === rightSplitTabId ? <img className="document-tab-split-mark" src={ICON_ASSETS.rightSplit} alt="右分屏" title="右分屏中" /> : null}
              <i
                role="button"
                tabIndex={closeDisabled ? -1 : 0}
                aria-label={`关闭 ${tab.title || "未命名信笺"}`}
                aria-disabled={closeDisabled}
                onClick={(event) => {
                  event.stopPropagation();
                  if (closeDisabled) {
                    return;
                  }
                  onCloseTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (closeDisabled) {
                    return;
                  }
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }
                }}
              >
                <X size={15} />
              </i>
            </button>
          ))}
        </div>
        {showNew ? (
          <button type="button" ref={addRef} className="document-tab add" onClick={onNew} disabled={resolvedNewDisabled} aria-label="新建文件" title={addTitle}>
            <Plus size={20} />
          </button>
        ) : null}
      </div>
      {contextMenu && contextTab ? (
        <div
          className="document-tab-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {onOpenTemplates ? (
            <button
              type="button"
              onClick={() => {
                onOpenTemplates?.(contextTab.id);
                setContextMenu(null);
              }}
            >
              <Palette size={15} />
              <span>修改信笺模板</span>
            </button>
          ) : null}
          {onToggleRightSplit ? (
          <button
            type="button"
            onClick={() => {
              onToggleRightSplit?.(contextTab.id);
              setContextMenu(null);
            }}
          >
            <PanelRightClose size={15} />
            <span>{splitActionLabel}</span>
          </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SecondaryDocumentTab({ tab, active = false, onActivate, onClose }) {
  if (!tab) return null;
  return (
    <div className={active ? "secondary-document-tab is-active" : "secondary-document-tab"} role="tablist" aria-label="文档右分屏标签">
      <button type="button" className="secondary-document-tab-main" role="tab" aria-selected={active} onClick={onActivate} title={tab.path || tab.title}>
        <FileText size={15} aria-hidden="true" />
        {tab.dirty ? <span className="document-tab-dot" aria-label="尚未保存" /> : null}
        <strong>{tab.title || "未命名信笺"}</strong>
        <img className="document-tab-split-mark" src={ICON_ASSETS.rightSplit} alt="" aria-hidden="true" />
      </button>
      <button type="button" className="secondary-document-tab-close" onClick={onClose} aria-label="取消右分屏" title="取消右分屏">
        <PanelRightClose size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
