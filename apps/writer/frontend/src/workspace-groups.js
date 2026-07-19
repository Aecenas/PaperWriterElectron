export const WORKSPACE_GROUPS_SNAPSHOT_VERSION = 3;

export const WORKSPACE_GROUP_ID = Object.freeze({
  PRIMARY: "primary",
  SECONDARY: "secondary",
});

export const WORKSPACE_VIEW_KIND = Object.freeze({
  DOCUMENT: "document",
  RESEARCH: "research",
});

export const DEFAULT_WORKSPACE_SPLIT_RATIO = 0.5;
export const MIN_WORKSPACE_SPLIT_RATIO = 0.25;
export const MAX_WORKSPACE_SPLIT_RATIO = 0.75;

const MAX_IDENTIFIER_LENGTH = 1024;
const MAX_RESOURCE_KEY_LENGTH = 4096;
const MAX_RELATIVE_PATH_LENGTH = 4096;
const MAX_RESEARCH_TITLE_LENGTH = 256;
const MIN_PDF_ZOOM = 0.35;
const MAX_PDF_ZOOM = 2.5;
const RESEARCH_TYPES = new Set(["file", "pdf", "web", "markdown", "text", "table", "image", "unsupported", "other"]);

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizeIdentifier(value, maximumLength = MAX_IDENTIFIER_LENGTH) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maximumLength);
}

function normalizeResourceKey(value) {
  return normalizeIdentifier(value, MAX_RESOURCE_KEY_LENGTH);
}

export function normalizeWorkspaceRelativePath(value) {
  if (typeof value !== "string") return "";
  const source = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .slice(0, MAX_RELATIVE_PATH_LENGTH);
  if (!source || source.startsWith("/") || /^[a-z]:\//i.test(source)) return "";
  const segments = source.split("/").filter((segment) => segment && segment !== ".");
  if (!segments.length || segments.some((segment) => segment === "..")) return "";
  return segments.join("/");
}

export function normalizeWorkspaceSplitRatio(value, fallback = DEFAULT_WORKSPACE_SPLIT_RATIO) {
  const normalizedFallback = clamp(
    finiteNumber(fallback, DEFAULT_WORKSPACE_SPLIT_RATIO),
    MIN_WORKSPACE_SPLIT_RATIO,
    MAX_WORKSPACE_SPLIT_RATIO,
  );
  return clamp(
    finiteNumber(value, normalizedFallback),
    MIN_WORKSPACE_SPLIT_RATIO,
    MAX_WORKSPACE_SPLIT_RATIO,
  );
}

function encodeViewPart(value) {
  // `encodeURIComponent` throws on lone UTF-16 surrogates. Session state is an
  // external boundary, so replace only malformed code units before encoding
  // instead of allowing one damaged path/id to abort the whole snapshot.
  let wellFormed = "";
  const source = String(value ?? "");
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = source.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        wellFormed += source[index] + source[index + 1];
        index += 1;
      } else {
        wellFormed += "\ufffd";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      wellFormed += "\ufffd";
    } else {
      wellFormed += source[index];
    }
  }
  return encodeURIComponent(wellFormed).replace(/%/g, "~");
}

function stableViewHash(value, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function createDocumentWorkspaceView(value) {
  const source = typeof value === "string" ? { tabId: value } : value;
  const tabId = normalizeIdentifier(source?.tabId || source?.id);
  if (!tabId) return null;
  const resourceKey = normalizeResourceKey(source?.resourceKey);
  return {
    kind: WORKSPACE_VIEW_KIND.DOCUMENT,
    viewId: `document:${encodeViewPart(tabId)}`,
    tabId,
    ...(resourceKey ? { resourceKey } : {}),
  };
}

function normalizeResearchTarget(value) {
  const libraryId = normalizeIdentifier(value?.libraryId);
  const relativePathInput = value?.relativePath ?? value?.fileRelativePath;
  const hasRelativePath = typeof relativePathInput === "string" && Boolean(relativePathInput.trim());
  const hasSourceId = typeof value?.sourceId === "string" && Boolean(value.sourceId.trim());
  if (!libraryId || hasRelativePath === hasSourceId) return null;
  const relativePath = normalizeWorkspaceRelativePath(relativePathInput);
  const sourceId = normalizeIdentifier(value?.sourceId);
  if ((hasRelativePath && !relativePath) || (hasSourceId && !sourceId)) return null;
  return relativePath
    ? { libraryId, relativePath }
    : { libraryId, sourceId };
}

function researchTargetKey(value) {
  const target = normalizeResearchTarget(value);
  if (!target) return "";
  return target.relativePath
    ? `${target.libraryId}\u0000file\u0000${target.relativePath}`
    : `${target.libraryId}\u0000source\u0000${target.sourceId}`;
}

export function createResearchWorkspaceViewId(value) {
  const target = normalizeResearchTarget(value);
  if (!target) return "";
  const targetKind = target.relativePath ? "file" : "source";
  const targetValue = target.relativePath || target.sourceId;
  const direct = `research:${encodeViewPart(target.libraryId)}:${targetKind}:${encodeViewPart(targetValue)}`;
  if (direct.length <= MAX_IDENTIFIER_LENGTH) return direct;
  const identity = researchTargetKey(target);
  return `research:${targetKind}:${stableViewHash(identity, 0x811c9dc5)}${stableViewHash(identity, 0x9e3779b9)}`;
}

export function normalizeResearchViewState(value) {
  const source = value && typeof value === "object" ? value : {};
  const zoomMode = source.zoomMode === "manual" ? "manual" : "fit";
  return {
    page: Math.max(1, Math.floor(finiteNumber(source.page, 1))),
    zoomMode,
    scale: clamp(finiteNumber(source.scale ?? source.zoom, 1), MIN_PDF_ZOOM, MAX_PDF_ZOOM),
    scrollTop: Math.max(0, Math.round(finiteNumber(source.scrollTop, 0))),
    scrollLeft: Math.max(0, Math.round(finiteNumber(source.scrollLeft, 0))),
  };
}

export function createResearchWorkspaceView(value) {
  const target = normalizeResearchTarget(value);
  if (!target) return null;
  const requestedViewId = normalizeIdentifier(value?.viewId);
  const viewId = requestedViewId.startsWith("research:")
    ? requestedViewId
    : createResearchWorkspaceViewId(target);
  const titleSnapshot = normalizeIdentifier(value?.titleSnapshot, MAX_RESEARCH_TITLE_LENGTH);
  const researchType = RESEARCH_TYPES.has(value?.researchType) ? value.researchType : "";
  return {
    kind: WORKSPACE_VIEW_KIND.RESEARCH,
    viewId,
    ...target,
    ...(titleSnapshot ? { titleSnapshot } : {}),
    ...(researchType ? { researchType } : {}),
    viewState: normalizeResearchViewState(value?.viewState),
  };
}

function normalizeRuntimeView(value, groupId) {
  if (groupId === WORKSPACE_GROUP_ID.SECONDARY && value?.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
    return createResearchWorkspaceView(value);
  }
  if (value?.kind === WORKSPACE_VIEW_KIND.DOCUMENT || value?.tabId || (!value?.kind && value?.id)) {
    return createDocumentWorkspaceView(value);
  }
  return null;
}

function documentIdentityMatches(left, right) {
  if (left?.kind !== WORKSPACE_VIEW_KIND.DOCUMENT || right?.kind !== WORKSPACE_VIEW_KIND.DOCUMENT) {
    return false;
  }
  if (left.tabId === right.tabId) return true;
  return Boolean(left.resourceKey && right.resourceKey && left.resourceKey === right.resourceKey);
}

function researchIdentityMatches(left, right) {
  return left?.kind === WORKSPACE_VIEW_KIND.RESEARCH
    && right?.kind === WORKSPACE_VIEW_KIND.RESEARCH
    && researchTargetKey(left) === researchTargetKey(right);
}

function normalizeRuntimeGroup(group, groupId, seenDocuments, seenResearch, seenViewIds) {
  const views = [];
  for (const candidate of Array.isArray(group?.views) ? group.views : []) {
    const view = normalizeRuntimeView(candidate, groupId);
    if (!view) continue;
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      if (seenDocuments.some((existing) => documentIdentityMatches(existing, view))) continue;
      seenDocuments.push(view);
    } else {
      const identity = researchTargetKey(view);
      if (!identity || seenResearch.has(identity)) continue;
      seenResearch.add(identity);
      if (seenViewIds.has(view.viewId)) {
        view.viewId = createResearchWorkspaceViewId(view);
      }
    }
    if (seenViewIds.has(view.viewId)) continue;
    seenViewIds.add(view.viewId);
    views.push(view);
  }
  const requestedActiveViewId = normalizeIdentifier(group?.activeViewId);
  const activeViewId = views.some((view) => view.viewId === requestedActiveViewId)
    ? requestedActiveViewId
    : (views[0]?.viewId || "");
  return { views, activeViewId };
}

/**
 * Canonicalizes untrusted runtime input. Pass `fallbackPrimaryDocument` while
 * loading external state to retain the invariant that the primary group has a
 * document even when all persisted references are unavailable.
 */
export function normalizeWorkspaceGroupsState(value, options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const seenDocuments = [];
  const seenResearch = new Set();
  const seenViewIds = new Set();
  const primary = normalizeRuntimeGroup(
    source.primary,
    WORKSPACE_GROUP_ID.PRIMARY,
    seenDocuments,
    seenResearch,
    seenViewIds,
  );
  if (!primary.views.length) {
    const fallback = createDocumentWorkspaceView(options.fallbackPrimaryDocument);
    if (fallback) {
      primary.views.push(fallback);
      primary.activeViewId = fallback.viewId;
      seenDocuments.push(fallback);
      seenViewIds.add(fallback.viewId);
    }
  }
  const secondary = normalizeRuntimeGroup(
    source.secondary,
    WORKSPACE_GROUP_ID.SECONDARY,
    seenDocuments,
    seenResearch,
    seenViewIds,
  );
  const requestedFocus = source.focusedGroup === WORKSPACE_GROUP_ID.SECONDARY
    ? WORKSPACE_GROUP_ID.SECONDARY
    : WORKSPACE_GROUP_ID.PRIMARY;
  return {
    primary,
    secondary,
    focusedGroup: requestedFocus === WORKSPACE_GROUP_ID.SECONDARY && secondary.views.length
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY,
    splitRatio: normalizeWorkspaceSplitRatio(source.splitRatio),
  };
}

export function createWorkspaceGroupsState(primaryDocument, options = {}) {
  const primaryView = createDocumentWorkspaceView(primaryDocument);
  if (!primaryView) {
    throw new TypeError("A primary document tab is required to create workspace groups");
  }
  return {
    primary: { views: [primaryView], activeViewId: primaryView.viewId },
    secondary: { views: [], activeViewId: "" },
    focusedGroup: WORKSPACE_GROUP_ID.PRIMARY,
    splitRatio: normalizeWorkspaceSplitRatio(options.splitRatio),
  };
}

function getGroup(state, groupId) {
  if (groupId === WORKSPACE_GROUP_ID.PRIMARY) return state?.primary;
  if (groupId === WORKSPACE_GROUP_ID.SECONDARY) return state?.secondary;
  return null;
}

function findViewIndex(group, identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized || !Array.isArray(group?.views)) return -1;
  return group.views.findIndex((view) => (
    view.viewId === normalized
    || (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT && view.tabId === normalized)
  ));
}

export function findWorkspaceView(state, identifier) {
  for (const groupId of [WORKSPACE_GROUP_ID.PRIMARY, WORKSPACE_GROUP_ID.SECONDARY]) {
    const group = getGroup(state, groupId);
    const index = findViewIndex(group, identifier);
    if (index >= 0) return { groupId, index, view: group.views[index] };
  }
  return null;
}

export function getActiveWorkspaceView(state, groupId = state?.focusedGroup) {
  const group = getGroup(state, groupId);
  return group?.views?.find((view) => view.viewId === group.activeViewId) || null;
}

function activateExistingDocument(state, location, nextView) {
  const group = getGroup(state, location.groupId);
  const existing = group.views[location.index];
  const mergedView = !nextView.resourceKey && existing.resourceKey
    ? { ...nextView, resourceKey: existing.resourceKey }
    : nextView;
  const replacement = existing.tabId === mergedView.tabId && existing.resourceKey === mergedView.resourceKey
    ? existing
    : mergedView;
  const views = replacement === existing
    ? group.views
    : group.views.map((view, index) => (index === location.index ? replacement : view));
  const nextGroup = { views, activeViewId: replacement.viewId };
  if (replacement === existing
    && group.activeViewId === replacement.viewId
    && state.focusedGroup === location.groupId) return state;
  return {
    ...state,
    [location.groupId]: nextGroup,
    focusedGroup: location.groupId,
  };
}

export function openWorkspaceDocument(state, groupId, document) {
  const view = createDocumentWorkspaceView(document);
  const targetGroupId = groupId === WORKSPACE_GROUP_ID.SECONDARY
    ? WORKSPACE_GROUP_ID.SECONDARY
    : WORKSPACE_GROUP_ID.PRIMARY;
  if (!view || !getGroup(state, targetGroupId)) return state;
  for (const existingGroupId of [WORKSPACE_GROUP_ID.PRIMARY, WORKSPACE_GROUP_ID.SECONDARY]) {
    const group = getGroup(state, existingGroupId);
    const index = group?.views?.findIndex((candidate) => documentIdentityMatches(candidate, view)) ?? -1;
    if (index >= 0) {
      return activateExistingDocument(state, { groupId: existingGroupId, index }, view);
    }
  }
  const group = getGroup(state, targetGroupId);
  return {
    ...state,
    [targetGroupId]: {
      views: [...group.views, view],
      activeViewId: view.viewId,
    },
    focusedGroup: targetGroupId,
  };
}

export function openWorkspaceResearch(state, target) {
  const view = createResearchWorkspaceView(target);
  const secondary = getGroup(state, WORKSPACE_GROUP_ID.SECONDARY);
  if (!view || !secondary) return state;
  const existing = secondary.views.find((candidate) => researchIdentityMatches(candidate, view));
  if (existing) {
    const updated = {
      ...existing,
      ...(view.titleSnapshot ? { titleSnapshot: view.titleSnapshot } : {}),
      ...(view.researchType ? { researchType: view.researchType } : {}),
    };
    const metadataChanged = updated.titleSnapshot !== existing.titleSnapshot
      || updated.researchType !== existing.researchType;
    if (!metadataChanged
      && secondary.activeViewId === existing.viewId
      && state.focusedGroup === WORKSPACE_GROUP_ID.SECONDARY) {
      return state;
    }
    return {
      ...state,
      secondary: {
        ...secondary,
        views: metadataChanged
          ? secondary.views.map((candidate) => (candidate === existing ? updated : candidate))
          : secondary.views,
        activeViewId: existing.viewId,
      },
      focusedGroup: WORKSPACE_GROUP_ID.SECONDARY,
    };
  }
  return {
    ...state,
    secondary: {
      views: [...secondary.views, view],
      activeViewId: view.viewId,
    },
    focusedGroup: WORKSPACE_GROUP_ID.SECONDARY,
  };
}

export function selectWorkspaceView(state, groupId, identifier) {
  const group = getGroup(state, groupId);
  const index = findViewIndex(group, identifier);
  if (index < 0) return state;
  const activeViewId = group.views[index].viewId;
  if (group.activeViewId === activeViewId && state.focusedGroup === groupId) return state;
  return {
    ...state,
    [groupId]: { ...group, activeViewId },
    focusedGroup: groupId,
  };
}

function groupAfterRemovingIndex(group, index) {
  const closing = group.views[index];
  const views = group.views.filter((_, candidateIndex) => candidateIndex !== index);
  if (!views.length) return { views: [], activeViewId: "" };
  if (group.activeViewId !== closing.viewId && views.some((view) => view.viewId === group.activeViewId)) {
    return { views, activeViewId: group.activeViewId };
  }
  // After removal the old right neighbor occupies the same index. If there was
  // no right neighbor, use the item immediately to the left.
  return {
    views,
    activeViewId: views[Math.min(index, views.length - 1)].viewId,
  };
}

export function closeWorkspaceView(state, groupId, identifier) {
  const group = getGroup(state, groupId);
  const index = findViewIndex(group, identifier);
  if (index < 0) return state;
  if (groupId === WORKSPACE_GROUP_ID.PRIMARY && group.views.length <= 1) return state;
  const nextGroup = groupAfterRemovingIndex(group, index);
  return {
    ...state,
    [groupId]: nextGroup,
    focusedGroup: groupId === WORKSPACE_GROUP_ID.SECONDARY && !nextGroup.views.length
      ? WORKSPACE_GROUP_ID.PRIMARY
      : state.focusedGroup,
  };
}

export function reorderWorkspaceView(state, groupId, identifier, toIndex) {
  const group = getGroup(state, groupId);
  const fromIndex = findViewIndex(group, identifier);
  if (fromIndex < 0 || group.views.length < 2) return state;
  const targetIndex = clamp(Math.floor(finiteNumber(toIndex, fromIndex)), 0, group.views.length - 1);
  if (targetIndex === fromIndex) return state;
  const views = [...group.views];
  const [view] = views.splice(fromIndex, 1);
  views.splice(targetIndex, 0, view);
  return {
    ...state,
    [groupId]: { ...group, views },
  };
}

export function moveWorkspaceDocument(state, identifier, targetGroupId, toIndex) {
  if (![WORKSPACE_GROUP_ID.PRIMARY, WORKSPACE_GROUP_ID.SECONDARY].includes(targetGroupId)) return state;
  const location = findWorkspaceView(state, identifier);
  if (!location || location.view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT) return state;
  if (location.groupId === targetGroupId) {
    return reorderWorkspaceView(state, targetGroupId, identifier, toIndex);
  }
  const sourceGroup = getGroup(state, location.groupId);
  if (location.groupId === WORKSPACE_GROUP_ID.PRIMARY && sourceGroup.views.length <= 1) return state;
  const targetGroup = getGroup(state, targetGroupId);
  const nextSourceGroup = groupAfterRemovingIndex(sourceGroup, location.index);
  const insertionIndex = clamp(
    Math.floor(finiteNumber(toIndex, targetGroup.views.length)),
    0,
    targetGroup.views.length,
  );
  const targetViews = [...targetGroup.views];
  targetViews.splice(insertionIndex, 0, location.view);
  return {
    ...state,
    [location.groupId]: nextSourceGroup,
    [targetGroupId]: {
      views: targetViews,
      activeViewId: location.view.viewId,
    },
    focusedGroup: targetGroupId,
  };
}

export function updateWorkspaceResearchTarget(state, identifier, target) {
  const secondary = getGroup(state, WORKSPACE_GROUP_ID.SECONDARY);
  const index = findViewIndex(secondary, identifier);
  const existing = index >= 0 ? secondary.views[index] : null;
  if (existing?.kind !== WORKSPACE_VIEW_KIND.RESEARCH) return state;
  const normalizedTarget = normalizeResearchTarget(target);
  if (!normalizedTarget) return state;
  const duplicateIndex = secondary.views.findIndex((view, candidateIndex) => (
    candidateIndex !== index
    && view.kind === WORKSPACE_VIEW_KIND.RESEARCH
    && researchTargetKey(view) === researchTargetKey(normalizedTarget)
  ));
  if (duplicateIndex >= 0) {
    const duplicate = secondary.views[duplicateIndex];
    const nextGroup = groupAfterRemovingIndex(secondary, index);
    return {
      ...state,
      secondary: { ...nextGroup, activeViewId: duplicate.viewId },
      focusedGroup: WORKSPACE_GROUP_ID.SECONDARY,
    };
  }
  if (researchTargetKey(existing) === researchTargetKey(normalizedTarget)) return state;
  const updated = {
    ...existing,
    ...normalizedTarget,
  };
  if (normalizedTarget.relativePath) delete updated.sourceId;
  else delete updated.relativePath;
  return {
    ...state,
    secondary: {
      ...secondary,
      views: secondary.views.map((view, candidateIndex) => (candidateIndex === index ? updated : view)),
    },
  };
}

export function updateWorkspaceResearchViewState(state, identifier, patch) {
  const secondary = getGroup(state, WORKSPACE_GROUP_ID.SECONDARY);
  const index = findViewIndex(secondary, identifier);
  const existing = index >= 0 ? secondary.views[index] : null;
  if (existing?.kind !== WORKSPACE_VIEW_KIND.RESEARCH) return state;
  const viewState = normalizeResearchViewState({ ...existing.viewState, ...(patch || {}) });
  if (JSON.stringify(viewState) === JSON.stringify(existing.viewState)) return state;
  return {
    ...state,
    secondary: {
      ...secondary,
      views: secondary.views.map((view, candidateIndex) => (
        candidateIndex === index ? { ...existing, viewState } : view
      )),
    },
  };
}

function matcherFromSelector(selector) {
  if (typeof selector === "function") return selector;
  if (selector instanceof Set || Array.isArray(selector)) {
    const identifiers = new Set(Array.from(selector, (value) => normalizeIdentifier(value)).filter(Boolean));
    return (view) => identifiers.has(view.viewId) || identifiers.has(view.tabId);
  }
  if (typeof selector === "string") {
    const identifier = normalizeIdentifier(selector);
    return (view) => view.viewId === identifier || view.tabId === identifier;
  }
  if (!selector || typeof selector !== "object") return () => false;
  const fields = [
    "groupId",
    "kind",
    "viewId",
    "tabId",
    "resourceKey",
    "libraryId",
    "relativePath",
    "sourceId",
  ];
  if (!fields.some((field) => selector[field])) return () => false;
  return (view, groupId) => {
    if (selector.groupId && selector.groupId !== groupId) return false;
    if (selector.kind && selector.kind !== view.kind) return false;
    if (selector.viewId && selector.viewId !== view.viewId) return false;
    if (selector.tabId && selector.tabId !== view.tabId) return false;
    if (selector.resourceKey && selector.resourceKey !== view.resourceKey) return false;
    if (selector.libraryId && selector.libraryId !== view.libraryId) return false;
    if (selector.relativePath && normalizeWorkspaceRelativePath(selector.relativePath) !== view.relativePath) return false;
    if (selector.sourceId && normalizeIdentifier(selector.sourceId) !== view.sourceId) return false;
    return true;
  };
}

function groupAfterRemovingMatches(group, matcher, groupId, keepOne) {
  const matchingIndexes = group.views
    .map((view, index) => (matcher(view, groupId) ? index : -1))
    .filter((index) => index >= 0);
  if (!matchingIndexes.length) return group;
  const activeIndex = group.views.findIndex((view) => view.viewId === group.activeViewId);
  const protectedIndex = keepOne && matchingIndexes.length === group.views.length
    ? (activeIndex >= 0 ? activeIndex : 0)
    : -1;
  const removed = new Set(matchingIndexes.filter((index) => index !== protectedIndex));
  if (!removed.size) return group;
  const views = group.views.filter((_, index) => !removed.has(index));
  if (views.some((view) => view.viewId === group.activeViewId)) {
    return { views, activeViewId: group.activeViewId };
  }
  const right = group.views.find((view, index) => index > activeIndex && !removed.has(index));
  const left = [...group.views]
    .map((view, index) => ({ view, index }))
    .reverse()
    .find(({ index }) => index < activeIndex && !removed.has(index))?.view;
  return { views, activeViewId: (right || left || views[0])?.viewId || "" };
}

export function removeWorkspaceViews(state, selector) {
  const matcher = matcherFromSelector(selector);
  const primary = groupAfterRemovingMatches(state.primary, matcher, WORKSPACE_GROUP_ID.PRIMARY, true);
  const secondary = groupAfterRemovingMatches(state.secondary, matcher, WORKSPACE_GROUP_ID.SECONDARY, false);
  if (primary === state.primary && secondary === state.secondary) return state;
  return {
    ...state,
    primary,
    secondary,
    focusedGroup: state.focusedGroup === WORKSPACE_GROUP_ID.SECONDARY && !secondary.views.length
      ? WORKSPACE_GROUP_ID.PRIMARY
      : state.focusedGroup,
  };
}

function persistentDocumentResourceKey(view, options) {
  let currentResourceKey = "";
  try {
    currentResourceKey = normalizeResourceKey(
      options?.getDocumentResourceKey?.(view?.tabId, view),
    );
  } catch {
    // A session snapshot must remain best-effort. Fall back to the last stable
    // resource key if its live resolver is temporarily unavailable.
  }
  return currentResourceKey || normalizeResourceKey(view?.resourceKey);
}

function persistentViewKey(view) {
  if (view?.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
    const resourceKey = normalizeResourceKey(view.resourceKey);
    if (!resourceKey) return "";
    const direct = `document:${encodeViewPart(resourceKey)}`;
    if (direct.length <= MAX_IDENTIFIER_LENGTH) return direct;
    return `document:resource:${stableViewHash(resourceKey, 0x811c9dc5)}${stableViewHash(resourceKey, 0x9e3779b9)}`;
  }
  if (view?.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
    return createResearchWorkspaceViewId(view);
  }
  return "";
}

function serializeRuntimeView(view, options) {
  if (view?.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
    const resourceKey = persistentDocumentResourceKey(view, options);
    return resourceKey ? { kind: WORKSPACE_VIEW_KIND.DOCUMENT, resourceKey } : null;
  }
  const research = createResearchWorkspaceView(view);
  if (!research) return null;
  return {
    kind: WORKSPACE_VIEW_KIND.RESEARCH,
    libraryId: research.libraryId,
    ...(research.relativePath ? { relativePath: research.relativePath } : { sourceId: research.sourceId }),
    viewState: research.viewState,
  };
}

function serializeRuntimeGroup(group, options) {
  const views = [];
  let activeViewKey = "";
  for (const runtimeView of Array.isArray(group?.views) ? group.views : []) {
    const view = serializeRuntimeView(runtimeView, options);
    if (!view) continue;
    const viewKey = persistentViewKey(view);
    if (runtimeView.viewId === group.activeViewId) activeViewKey = viewKey;
    views.push(view);
  }
  return {
    views,
    activeViewKey: views.some((view) => persistentViewKey(view) === activeViewKey)
      ? activeViewKey
      : persistentViewKey(views[0]),
  };
}

/** A JSON-safe session/layout snapshot. Runtime tab ids are intentionally absent. */
export function createWorkspaceGroupsSnapshot(state, options = {}) {
  // Refresh document identities before canonical deduplication. This matters
  // after Save As: the group view may still carry the old path while openTabs
  // already exposes the new stable resource key through the callback.
  const source = state && typeof state === "object" ? state : {};
  const withCurrentDocumentResources = {
    ...source,
    ...Object.fromEntries(
      [WORKSPACE_GROUP_ID.PRIMARY, WORKSPACE_GROUP_ID.SECONDARY].map((groupId) => {
        const group = source[groupId];
        return [groupId, {
          ...(group && typeof group === "object" ? group : {}),
          views: (Array.isArray(group?.views) ? group.views : []).map((view) => {
            if (view?.kind !== WORKSPACE_VIEW_KIND.DOCUMENT && !view?.tabId) return view;
            const resourceKey = persistentDocumentResourceKey(view, options);
            return resourceKey ? { ...view, resourceKey } : view;
          }),
        }];
      }),
    ),
  };
  const normalizedState = normalizeWorkspaceGroupsState(withCurrentDocumentResources);
  const primary = serializeRuntimeGroup(normalizedState.primary, options);
  const secondary = serializeRuntimeGroup(normalizedState.secondary, options);
  return {
    version: WORKSPACE_GROUPS_SNAPSHOT_VERSION,
    primary,
    secondary,
    focusedGroup: normalizedState.focusedGroup === WORKSPACE_GROUP_ID.SECONDARY && secondary.views.length
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY,
    splitRatio: normalizeWorkspaceSplitRatio(normalizedState.splitRatio),
  };
}

function normalizePersistentView(value, groupId) {
  if (value?.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
    const resourceKey = normalizeResourceKey(value.resourceKey);
    return resourceKey ? { kind: WORKSPACE_VIEW_KIND.DOCUMENT, resourceKey } : null;
  }
  if (groupId !== WORKSPACE_GROUP_ID.SECONDARY || value?.kind !== WORKSPACE_VIEW_KIND.RESEARCH) return null;
  return serializeRuntimeView(value, {});
}

function normalizePersistentGroup(group, groupId, seenResources, seenResearch, seenViewIds) {
  const views = [];
  for (const candidate of Array.isArray(group?.views) ? group.views : []) {
    const view = normalizePersistentView(candidate, groupId);
    if (!view) continue;
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      if (seenResources.has(view.resourceKey)) continue;
      seenResources.add(view.resourceKey);
    } else {
      const identity = researchTargetKey(view);
      if (!identity || seenResearch.has(identity)) continue;
      seenResearch.add(identity);
      if (seenViewIds.has(view.viewId)) view.viewId = createResearchWorkspaceViewId(view);
    }
    const key = persistentViewKey(view);
    if (!key || seenViewIds.has(key)) continue;
    seenViewIds.add(key);
    views.push(view);
  }
  const requestedActiveKey = normalizeIdentifier(group?.activeViewKey, MAX_RESOURCE_KEY_LENGTH * 2);
  const activeViewKey = views.some((view) => persistentViewKey(view) === requestedActiveKey)
    ? requestedActiveKey
    : persistentViewKey(views[0]);
  return { views, activeViewKey };
}

function normalizeVersion3Snapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.version !== WORKSPACE_GROUPS_SNAPSHOT_VERSION) return null;
  const seenResources = new Set();
  const seenResearch = new Set();
  const seenViewIds = new Set();
  const primary = normalizePersistentGroup(
    value.primary,
    WORKSPACE_GROUP_ID.PRIMARY,
    seenResources,
    seenResearch,
    seenViewIds,
  );
  if (!primary.views.length) return null;
  const secondary = normalizePersistentGroup(
    value.secondary,
    WORKSPACE_GROUP_ID.SECONDARY,
    seenResources,
    seenResearch,
    seenViewIds,
  );
  return {
    version: WORKSPACE_GROUPS_SNAPSHOT_VERSION,
    primary,
    secondary,
    focusedGroup: value.focusedGroup === WORKSPACE_GROUP_ID.SECONDARY && secondary.views.length
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY,
    splitRatio: normalizeWorkspaceSplitRatio(value.splitRatio),
  };
}

export function isWorkspaceGroupsSnapshot(value) {
  return Boolean(normalizeVersion3Snapshot(value));
}

function createDocumentResourceLookup(options) {
  const byTabId = new Map();
  const byResourceKey = new Map();
  const candidates = [
    ...(Array.isArray(options?.documents) ? options.documents : []),
    ...(Array.isArray(options?.documentResources) ? options.documentResources : []),
  ];
  for (const candidate of candidates) {
    const runtimeDocument = createDocumentWorkspaceView(candidate);
    if (!runtimeDocument) continue;
    const resourceKey = persistentDocumentResourceKey(runtimeDocument, options);
    const document = createDocumentWorkspaceView({ ...runtimeDocument, resourceKey });
    if (!document) continue;
    byTabId.set(document.tabId, document);
    if (document.resourceKey) byResourceKey.set(document.resourceKey, document);
  }
  return { byTabId, byResourceKey };
}

function resourceKeyForLegacyDocument(value, options, lookup) {
  if (typeof value === "string") {
    return persistentDocumentResourceKey(
      lookup.byTabId.get(value) || { tabId: value },
      options,
    );
  }
  const liveDocument = lookup.byTabId.get(value?.tabId);
  return persistentDocumentResourceKey(
    {
      ...(value || {}),
      ...(liveDocument || {}),
      resourceKey: liveDocument?.resourceKey || value?.resourceKey,
    },
    options,
  );
}

/** Converts the 0.9.6 singleton/v2 layout shape to the v3 persistent union. */
export function migrateWorkspaceGroupsSnapshot(value, options = {}) {
  if (value?.version === WORKSPACE_GROUPS_SNAPSHOT_VERSION) return normalizeVersion3Snapshot(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Number.isFinite(Number(value.version)) && Number(value.version) > WORKSPACE_GROUPS_SNAPSHOT_VERSION) {
    return null;
  }
  if (!("secondaryPane" in value) && !Number.isFinite(Number(value.version))) return null;

  const lookup = createDocumentResourceLookup(options);
  const secondaryPane = value.secondaryPane && typeof value.secondaryPane === "object"
    ? value.secondaryPane
    : { kind: "none" };
  const secondaryTabId = secondaryPane.kind === WORKSPACE_VIEW_KIND.DOCUMENT
    ? normalizeIdentifier(secondaryPane.tabId)
    : "";
  const primaryCandidates = Array.isArray(options.primaryDocuments)
    ? options.primaryDocuments
    : (Array.isArray(options.primaryResourceKeys)
      ? options.primaryResourceKeys.map((resourceKey) => ({ resourceKey }))
      : [...lookup.byTabId.values()].filter((document) => document.tabId !== secondaryTabId));
  const primaryViews = [];
  const seenResources = new Set();
  for (const candidate of primaryCandidates) {
    const resourceKey = resourceKeyForLegacyDocument(candidate, options, lookup);
    if (!resourceKey || seenResources.has(resourceKey)) continue;
    seenResources.add(resourceKey);
    primaryViews.push({ kind: WORKSPACE_VIEW_KIND.DOCUMENT, resourceKey });
  }
  if (!primaryViews.length) return null;

  const secondaryViews = [];
  if (secondaryPane.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
    const resourceKey = resourceKeyForLegacyDocument(secondaryPane, options, lookup);
    if (resourceKey && !seenResources.has(resourceKey)) {
      secondaryViews.push({ kind: WORKSPACE_VIEW_KIND.DOCUMENT, resourceKey });
    }
  } else if (secondaryPane.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
    const research = serializeRuntimeView(secondaryPane, {});
    if (research) secondaryViews.push(research);
  }

  const activePrimaryTabId = normalizeIdentifier(options.activePrimaryTabId || options.activeTabId);
  const activePrimaryResourceKey = resourceKeyForLegacyDocument(activePrimaryTabId, options, lookup);
  const activePrimaryView = primaryViews.find((view) => view.resourceKey === activePrimaryResourceKey) || primaryViews[0];
  const secondaryView = secondaryViews[0];
  const legacyResearchRatio = finiteNumber(value.widths?.researchRatio, Number.NaN);
  const paneRatio = secondaryPane.kind === WORKSPACE_VIEW_KIND.RESEARCH
    // In 0.9.6 researchRatio described the right pane; v3 splitRatio always
    // describes the primary/left group.
    ? (Number.isFinite(legacyResearchRatio)
      ? Number((1 - legacyResearchRatio).toFixed(12))
      : undefined)
    : value.widths?.documentRatio;
  return normalizeVersion3Snapshot({
    version: WORKSPACE_GROUPS_SNAPSHOT_VERSION,
    primary: {
      views: primaryViews,
      activeViewKey: persistentViewKey(activePrimaryView),
    },
    secondary: {
      views: secondaryViews,
      activeViewKey: persistentViewKey(secondaryView),
    },
    focusedGroup: [WORKSPACE_GROUP_ID.SECONDARY, "right"].includes(value.activePane) && secondaryViews.length
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY,
    splitRatio: normalizeWorkspaceSplitRatio(value.splitRatio ?? paneRatio),
  });
}

function fallbackWorkspaceState(options) {
  if (options?.fallbackState) {
    const normalized = normalizeWorkspaceGroupsState(options.fallbackState, {
      fallbackPrimaryDocument: options.fallbackPrimaryDocument,
    });
    if (normalized.primary.views.length) return normalized;
  }
  const fallbackPrimary = createDocumentWorkspaceView(options?.fallbackPrimaryDocument);
  return fallbackPrimary ? createWorkspaceGroupsState(fallbackPrimary) : null;
}

function resolvePersistentDocument(view, options, lookup) {
  const resourceKey = view.resourceKey;
  let resolved = null;
  try {
    resolved = options?.resolveDocumentTabId?.(resourceKey, view) || null;
  } catch {
    resolved = null;
  }
  if (typeof resolved === "string") resolved = { tabId: resolved, resourceKey };
  let document = createDocumentWorkspaceView({ ...resolved, resourceKey });
  if (!document) {
    resolved = lookup.byResourceKey.get(resourceKey);
    document = createDocumentWorkspaceView({ ...resolved, resourceKey });
  }
  if (!document && options?.fallbackState) {
    const fallbackViews = [
      ...(options.fallbackState.primary?.views || []),
      ...(options.fallbackState.secondary?.views || []),
    ];
    resolved = fallbackViews.find((candidate) => (
      candidate.kind === WORKSPACE_VIEW_KIND.DOCUMENT && candidate.resourceKey === resourceKey
    ));
    document = createDocumentWorkspaceView({ ...resolved, resourceKey });
  }
  return document;
}

function materializePersistentGroup(group, groupId, options, lookup, seenDocuments, seenResearch) {
  const views = [];
  let activeViewId = "";
  for (const persistentView of group.views) {
    const view = persistentView.kind === WORKSPACE_VIEW_KIND.DOCUMENT
      ? resolvePersistentDocument(persistentView, options, lookup)
      : createResearchWorkspaceView(persistentView);
    if (!view) continue;
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      if (seenDocuments.some((existing) => documentIdentityMatches(existing, view))) continue;
      seenDocuments.push(view);
    } else {
      if (groupId !== WORKSPACE_GROUP_ID.SECONDARY) continue;
      const identity = researchTargetKey(view);
      if (seenResearch.has(identity)) continue;
      seenResearch.add(identity);
    }
    if (persistentViewKey(persistentView) === group.activeViewKey) activeViewId = view.viewId;
    views.push(view);
  }
  return {
    views,
    activeViewId: views.some((view) => view.viewId === activeViewId)
      ? activeViewId
      : (views[0]?.viewId || ""),
  };
}

/**
 * Restores a v3 or legacy snapshot by resolving stable document resource keys
 * back to the current process' runtime tab ids. Unknown future versions and
 * missing primary documents return the supplied safe fallback unchanged in
 * meaning (as a fresh canonical object).
 */
export function restoreWorkspaceGroupsSnapshot(value, options = {}) {
  const fallback = fallbackWorkspaceState(options);
  const snapshot = migrateWorkspaceGroupsSnapshot(value, options);
  if (!snapshot) return fallback;
  const lookup = createDocumentResourceLookup(options);
  const seenDocuments = [];
  const seenResearch = new Set();
  const primary = materializePersistentGroup(
    snapshot.primary,
    WORKSPACE_GROUP_ID.PRIMARY,
    options,
    lookup,
    seenDocuments,
    seenResearch,
  );
  if (!primary.views.length) return fallback;
  const secondary = materializePersistentGroup(
    snapshot.secondary,
    WORKSPACE_GROUP_ID.SECONDARY,
    options,
    lookup,
    seenDocuments,
    seenResearch,
  );
  return {
    primary,
    secondary,
    focusedGroup: snapshot.focusedGroup === WORKSPACE_GROUP_ID.SECONDARY && secondary.views.length
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY,
    splitRatio: normalizeWorkspaceSplitRatio(snapshot.splitRatio),
  };
}
