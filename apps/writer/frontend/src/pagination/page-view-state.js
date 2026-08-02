export const PAGE_VIEW_MODES = Object.freeze({
  CONTINUOUS: "continuous",
  SINGLE: "single",
  SPREAD: "spread",
});

export const PAGE_ZOOM_MODES = Object.freeze({
  FIT: "fit",
  CUSTOM: "custom",
});

export const DEFAULT_PAGE_VIEW_STATE = Object.freeze({
  mode: PAGE_VIEW_MODES.CONTINUOUS,
  currentPage: 1,
  zoomMode: PAGE_ZOOM_MODES.FIT,
  zoom: 1,
});

const PAGE_VIEW_MODE_SET = new Set(Object.values(PAGE_VIEW_MODES));
const PAGE_ZOOM_MODE_SET = new Set(Object.values(PAGE_ZOOM_MODES));
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2;

export function clampPage(value, pageCount = Number.MAX_SAFE_INTEGER) {
  const count = Math.max(1, Math.trunc(Number(pageCount) || 1));
  const page = Math.trunc(Number(value) || 1);
  return Math.min(count, Math.max(1, page));
}

export function clampZoom(value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return DEFAULT_PAGE_VIEW_STATE.zoom;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function normalizePageViewState(value, pageCount) {
  const source = value && typeof value === "object" ? value : {};
  const mode = PAGE_VIEW_MODE_SET.has(source.mode)
    ? source.mode
    : DEFAULT_PAGE_VIEW_STATE.mode;
  const zoomMode = PAGE_ZOOM_MODE_SET.has(source.zoomMode)
    ? source.zoomMode
    : DEFAULT_PAGE_VIEW_STATE.zoomMode;
  return {
    mode,
    currentPage: clampPage(source.currentPage, pageCount),
    zoomMode,
    zoom: clampZoom(source.zoom),
  };
}

export function spreadStartPage(currentPage, pageCount) {
  const page = clampPage(currentPage, pageCount);
  return page % 2 === 0 ? page - 1 : page;
}

export function visiblePagesForState(state, pageCount) {
  const count = Math.max(1, Math.trunc(Number(pageCount) || 1));
  const normalized = normalizePageViewState(state, count);
  if (normalized.mode === PAGE_VIEW_MODES.CONTINUOUS) {
    return Array.from({ length: count }, (_item, index) => index + 1);
  }
  if (normalized.mode === PAGE_VIEW_MODES.SINGLE) {
    return [normalized.currentPage];
  }
  const start = spreadStartPage(normalized.currentPage, count);
  return [start, start + 1 <= count ? start + 1 : null];
}

export function pageGroupStartIndex(state, pageCount) {
  const normalized = normalizePageViewState(state, pageCount);
  if (normalized.mode === PAGE_VIEW_MODES.SPREAD) {
    const start = spreadStartPage(normalized.currentPage, pageCount);
    return start - 1;
  }
  return normalized.currentPage - 1;
}

export function reducePageViewState(state, action, pageCount) {
  const current = normalizePageViewState(state, pageCount);
  switch (action?.type) {
    case "set-mode":
      return normalizePageViewState({ ...current, mode: action.mode }, pageCount);
    case "set-page":
      return normalizePageViewState({ ...current, currentPage: action.page }, pageCount);
    case "next": {
      const spreadStart = spreadStartPage(current.currentPage, pageCount);
      const nextSpreadStart = spreadStart + 2;
      const nextPage = current.mode === PAGE_VIEW_MODES.SPREAD
        ? (nextSpreadStart > pageCount ? current.currentPage : nextSpreadStart)
        : current.currentPage + 1;
      return normalizePageViewState({ ...current, currentPage: nextPage }, pageCount);
    }
    case "previous": {
      const spreadStart = spreadStartPage(current.currentPage, pageCount);
      const previousSpreadStart = spreadStart - 2;
      const previousPage = current.mode === PAGE_VIEW_MODES.SPREAD
        ? (previousSpreadStart < 1 ? current.currentPage : previousSpreadStart)
        : current.currentPage - 1;
      return normalizePageViewState({ ...current, currentPage: previousPage }, pageCount);
    }
    case "set-fit":
      return { ...current, zoomMode: PAGE_ZOOM_MODES.FIT };
    case "set-zoom":
      return {
        ...current,
        zoomMode: PAGE_ZOOM_MODES.CUSTOM,
        zoom: clampZoom(action.zoom),
      };
    case "hydrate":
      return normalizePageViewState(action.state, pageCount);
    default:
      return current;
  }
}

function safeSessionStorage(storage) {
  try {
    return storage || globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

export function createPageViewSessionStore({
  storage,
  storageKey = "jianjian:page-view-state:v1",
} = {}) {
  const target = safeSessionStorage(storage);
  let states = {};
  if (target) {
    try {
      const parsed = JSON.parse(target.getItem(storageKey) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        states = parsed;
      }
    } catch {
      states = {};
    }
  }

  const persist = () => {
    if (!target) return;
    try {
      target.setItem(storageKey, JSON.stringify(states));
    } catch {
      // Session state is best-effort and never affects document persistence.
    }
  };

  return Object.freeze({
    get(tabId, pageCount) {
      return normalizePageViewState(states[String(tabId || "")], pageCount);
    },
    set(tabId, nextState, pageCount) {
      const id = String(tabId || "");
      if (!id) return normalizePageViewState(nextState, pageCount);
      const normalized = normalizePageViewState(nextState, pageCount);
      states = { ...states, [id]: normalized };
      persist();
      return normalized;
    },
    delete(tabId) {
      const id = String(tabId || "");
      if (!Object.hasOwn(states, id)) return;
      const { [id]: _removed, ...remaining } = states;
      states = remaining;
      persist();
    },
    snapshot() {
      return structuredClone(states);
    },
  });
}
