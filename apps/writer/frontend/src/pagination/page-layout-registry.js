import { PAGE_VIEW_MODES, normalizePageViewState } from "./page-view-state.js";

const registeredLayouts = new WeakMap();

export function registerPageLayout(root, value = {}) {
  if (!root || (typeof root !== "object" && typeof root !== "function")) {
    return () => {};
  }
  const entry = {
    editor: value.editor || null,
    pageMap: value.pageMap || null,
    service: value.service || null,
    state: normalizePageViewState(value.state, value.pageMap?.pageCount),
  };
  registeredLayouts.set(root, entry);
  return () => {
    if (registeredLayouts.get(root) === entry) registeredLayouts.delete(root);
  };
}

export function updateRegisteredPageLayout(root, patch = {}) {
  const current = registeredLayouts.get(root);
  if (!current) return null;
  if (Object.hasOwn(patch, "editor")) current.editor = patch.editor || null;
  if (Object.hasOwn(patch, "pageMap")) current.pageMap = patch.pageMap || null;
  if (Object.hasOwn(patch, "service")) current.service = patch.service || null;
  if (Object.hasOwn(patch, "state")) {
    current.state = normalizePageViewState(
      patch.state,
      (patch.pageMap || current.pageMap)?.pageCount,
    );
  }
  return current;
}

export function getRegisteredPageLayout(root) {
  const entry = registeredLayouts.get(root);
  return entry || null;
}

export async function refreshRegisteredPageLayout(root, reason = "export") {
  const entry = getRegisteredPageLayout(root);
  if (!entry) return null;
  const measureContinuous = entry.state.mode === PAGE_VIEW_MODES.CONTINUOUS;
  const previousScroll = measureContinuous
    ? { left: Number(root.scrollLeft) || 0, top: Number(root.scrollTop) || 0 }
    : null;
  if (measureContinuous) {
    root.classList?.add("page-map-measurement-mode");
    root.setAttribute?.("aria-busy", "true");
  }
  try {
    const measured = await entry.service?.flush?.(reason);
    if (measured) {
      entry.pageMap = measured;
      entry.state = normalizePageViewState(entry.state, measured.pageCount);
    }
    return entry;
  } finally {
    if (measureContinuous) {
      root.classList?.remove("page-map-measurement-mode");
      root.removeAttribute?.("aria-busy");
      if (previousScroll) {
        root.scrollLeft = previousScroll.left;
        root.scrollTop = previousScroll.top;
      }
    }
  }
}
