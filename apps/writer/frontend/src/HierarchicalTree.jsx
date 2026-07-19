import { useCallback } from "react";

function resolveValue(value, context, fallback = "") {
  if (typeof value === "function") return value(context);
  return value ?? fallback;
}

function treeItemsFor(element) {
  const tree = element?.closest?.('[role="tree"]');
  return tree ? [...tree.querySelectorAll('button[role="treeitem"]:not(:disabled)')] : [];
}

function focusSibling(element, direction) {
  const items = treeItemsFor(element);
  const index = items.indexOf(element);
  items[index + direction]?.focus();
}

function focusParent(element) {
  const depth = Number(element?.dataset?.treeDepth || 0);
  if (depth <= 0) return;
  const items = treeItemsFor(element);
  const index = items.indexOf(element);
  for (let offset = index - 1; offset >= 0; offset -= 1) {
    if (Number(items[offset]?.dataset?.treeDepth || 0) === depth - 1) {
      items[offset].focus();
      return;
    }
  }
}

/**
 * Business-agnostic accessible tree item. Consumers provide their own icons,
 * labels, expansion state and activation behavior.
 */
export function TreeItemButton({
  branch = false,
  expanded = false,
  depth = 0,
  selected = false,
  onToggle,
  onActivate,
  onNavigate,
  onContextMenu,
  onKeyDown,
  onDoubleClick,
  children,
  ...buttonProps
}) {
  const handleKeyDown = useCallback((event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusSibling(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const items = treeItemsFor(event.currentTarget);
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      return;
    }
    if (event.key === "ArrowRight" && branch) {
      event.preventDefault();
      if (!expanded) onToggle?.(true, event);
      else focusSibling(event.currentTarget, 1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (branch && expanded) onToggle?.(false, event);
      else focusParent(event.currentTarget);
      return;
    }
    if (event.key === "Enter" && branch && onNavigate) {
      event.preventDefault();
      onNavigate(event);
      return;
    }
    if (event.key === "F10" && event.shiftKey && onContextMenu) {
      event.preventDefault();
      onContextMenu(event);
    }
  }, [branch, expanded, onContextMenu, onKeyDown, onNavigate, onToggle]);

  return (
    <button
      {...buttonProps}
      type={buttonProps.type || "button"}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={branch ? expanded : undefined}
      data-tree-depth={depth}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      onContextMenu={onContextMenu}
      onDoubleClick={(event) => {
        onDoubleClick?.(event);
        if (!event.defaultPrevented && branch) onNavigate?.(event);
      }}
    >
      {children}
    </button>
  );
}

/**
 * Recursive hierarchy renderer shared by every sidebar tree. It owns only
 * hierarchy, branch state and ARIA grouping; all product rendering stays in
 * renderRow/renderBranchState callbacks.
 */
export function HierarchicalTreeRows({
  entries = [],
  depth = 0,
  getKey,
  isBranch,
  isExpanded,
  getChildren,
  getBranchState = () => ({}),
  getGroupLabel,
  wrapperClassName = "",
  childrenClassName = "",
  renderRow,
  renderBranchState,
}) {
  return entries.map((entry, index) => {
    const branch = Boolean(isBranch?.(entry));
    const expanded = branch && Boolean(isExpanded?.(entry));
    const state = branch ? (getBranchState?.(entry) || {}) : {};
    const children = branch ? (getChildren?.(entry, state) || []) : [];
    const context = { entry, index, depth, branch, expanded, state, children };
    const key = String(getKey?.(entry) ?? index);
    const loading = Boolean(state.loading);
    const error = state.error || "";
    const childContent = loading
      ? renderBranchState?.("loading", context)
      : error
        ? renderBranchState?.("error", context)
        : children.length
          ? (
            <HierarchicalTreeRows
              entries={children}
              depth={depth + 1}
              getKey={getKey}
              isBranch={isBranch}
              isExpanded={isExpanded}
              getChildren={getChildren}
              getBranchState={getBranchState}
              getGroupLabel={getGroupLabel}
              wrapperClassName={wrapperClassName}
              childrenClassName={childrenClassName}
              renderRow={renderRow}
              renderBranchState={renderBranchState}
            />
          )
          : renderBranchState?.("empty", context);
    return (
      <div key={key} className={resolveValue(wrapperClassName, context)} role="none">
        {renderRow?.(context)}
        {branch && expanded ? (
          <div
            className={resolveValue(childrenClassName, context)}
            role="group"
            aria-label={resolveValue(getGroupLabel, context, undefined)}
          >
            {childContent}
          </div>
        ) : null}
      </div>
    );
  });
}

export default function HierarchicalTree({ className = "", ariaLabel = "树", ...props }) {
  return (
    <div className={className} role="tree" aria-label={ariaLabel} aria-busy={props.loading || undefined}>
      <HierarchicalTreeRows {...props} />
    </div>
  );
}
