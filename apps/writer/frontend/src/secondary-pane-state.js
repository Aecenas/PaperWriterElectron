export const SECONDARY_PANE_KIND = Object.freeze({
  NONE: "none",
  DOCUMENT: "document",
  RESEARCH: "research",
});

export const ACTIVE_PANE = Object.freeze({
  PRIMARY: "primary",
  SECONDARY: "secondary",
});

export const SECONDARY_PANE_LAYOUT_SNAPSHOT_VERSION = 2;

export const DEFAULT_DOCUMENT_PANE_RATIO = 0.5;
export const MIN_DOCUMENT_PANE_RATIO = 0.25;
export const MAX_DOCUMENT_PANE_RATIO = 0.75;
export const DEFAULT_RESEARCH_PANE_RATIO = 0.5;
export const MIN_RESEARCH_PANE_RATIO = 0.25;
export const MAX_RESEARCH_PANE_RATIO = 0.75;
export const DEFAULT_RESEARCH_PANE_WIDTH = 480;
export const MIN_RESEARCH_PANE_WIDTH = 360;
export const MAX_RESEARCH_PANE_VIEWPORT_RATIO = 0.6;

export const EMPTY_SECONDARY_PANE = Object.freeze({ kind: SECONDARY_PANE_KIND.NONE });

const DEFAULT_VIEWPORT_WIDTH = 1280;
const MAX_IDENTIFIER_LENGTH = 512;
const MAX_RELATIVE_PATH_LENGTH = 4096;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function normalizedIdentifier(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_IDENTIFIER_LENGTH);
}

function normalizedRelativePath(value) {
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

function normalizedDocumentPane(value) {
  const tabId = normalizedIdentifier(value?.tabId);
  return tabId ? { kind: SECONDARY_PANE_KIND.DOCUMENT, tabId } : null;
}

function normalizedResearchPane(value) {
  const libraryId = normalizedIdentifier(value?.libraryId);
  const hasFileTarget = typeof value?.fileRelativePath === "string" && Boolean(value.fileRelativePath.trim());
  const hasSourceTarget = typeof value?.sourceId === "string" && Boolean(value.sourceId.trim());
  if (!libraryId || hasFileTarget === hasSourceTarget) return null;
  const fileRelativePath = normalizedRelativePath(value?.fileRelativePath);
  const sourceId = normalizedIdentifier(value?.sourceId);
  if ((hasFileTarget && !fileRelativePath) || (hasSourceTarget && !sourceId)) return null;
  return fileRelativePath
    ? { kind: SECONDARY_PANE_KIND.RESEARCH, libraryId, fileRelativePath }
    : { kind: SECONDARY_PANE_KIND.RESEARCH, libraryId, sourceId };
}

/**
 * Converts untrusted or persisted input to the canonical pane union. Invalid input
 * becomes `none`; transition helpers preserve the current pane on invalid targets.
 */
export function normalizeSecondaryPane(value) {
  if (value?.kind === SECONDARY_PANE_KIND.DOCUMENT) {
    return normalizedDocumentPane(value) || EMPTY_SECONDARY_PANE;
  }
  if (value?.kind === SECONDARY_PANE_KIND.RESEARCH) {
    return normalizedResearchPane(value) || EMPTY_SECONDARY_PANE;
  }
  return EMPTY_SECONDARY_PANE;
}

function isIntentionalClose(value) {
  return value == null || value?.kind === SECONDARY_PANE_KIND.NONE;
}

/** Replaces the visible pane without retaining an implicit back stack. */
export function replaceSecondaryPane(currentPane, nextPane) {
  const normalized = normalizeSecondaryPane(nextPane);
  if (normalized.kind === SECONDARY_PANE_KIND.NONE && !isIntentionalClose(nextPane)) {
    return normalizeSecondaryPane(currentPane);
  }
  return normalized;
}

export function openDocumentSecondaryPane(currentPane, tabId) {
  return replaceSecondaryPane(currentPane, {
    kind: SECONDARY_PANE_KIND.DOCUMENT,
    tabId,
  });
}

export function openResearchSecondaryPane(currentPane, target) {
  return replaceSecondaryPane(currentPane, {
    kind: SECONDARY_PANE_KIND.RESEARCH,
    libraryId: target?.libraryId,
    fileRelativePath: target?.fileRelativePath,
    sourceId: target?.sourceId,
  });
}

/** Closing never restores a pane that was replaced earlier. */
export function closeSecondaryPane() {
  return EMPTY_SECONDARY_PANE;
}

/** Sidebar navigation is deliberately orthogonal to the secondary pane. */
export function keepSecondaryPaneForSidebarChange(currentPane) {
  return normalizeSecondaryPane(currentPane);
}

/**
 * Resolves focus after a pane transition. Legacy `main`/`right` values are accepted
 * to make migration from the 0.9.5 component state lossless.
 */
export function deriveActivePane(requestedPane, secondaryPane) {
  const wantsSecondary = requestedPane === ACTIVE_PANE.SECONDARY || requestedPane === "right";
  return wantsSecondary && normalizeSecondaryPane(secondaryPane).kind !== SECONDARY_PANE_KIND.NONE
    ? ACTIVE_PANE.SECONDARY
    : ACTIVE_PANE.PRIMARY;
}

export function deriveActiveDocumentTabId({ primaryTabId, secondaryPane, activePane }) {
  const normalizedPrimaryTabId = normalizedIdentifier(primaryTabId);
  const normalizedPane = normalizeSecondaryPane(secondaryPane);
  const normalizedActivePane = deriveActivePane(activePane, normalizedPane);
  if (normalizedActivePane === ACTIVE_PANE.SECONDARY && normalizedPane.kind === SECONDARY_PANE_KIND.DOCUMENT) {
    return normalizedPane.tabId;
  }
  return normalizedPrimaryTabId;
}

export function normalizeDocumentPaneRatio(value, fallback = DEFAULT_DOCUMENT_PANE_RATIO) {
  const normalizedFallback = clamp(
    finiteNumber(fallback, DEFAULT_DOCUMENT_PANE_RATIO),
    MIN_DOCUMENT_PANE_RATIO,
    MAX_DOCUMENT_PANE_RATIO,
  );
  return clamp(
    finiteNumber(value, normalizedFallback),
    MIN_DOCUMENT_PANE_RATIO,
    MAX_DOCUMENT_PANE_RATIO,
  );
}

export function normalizeResearchPaneRatio(value, fallback = DEFAULT_RESEARCH_PANE_RATIO) {
  const normalizedFallback = clamp(
    finiteNumber(fallback, DEFAULT_RESEARCH_PANE_RATIO),
    MIN_RESEARCH_PANE_RATIO,
    MAX_RESEARCH_PANE_RATIO,
  );
  return clamp(
    finiteNumber(value, normalizedFallback),
    MIN_RESEARCH_PANE_RATIO,
    MAX_RESEARCH_PANE_RATIO,
  );
}

/**
 * Resolves the visible research split from a stable right-side ratio. Container
 * changes alter the pixel width without mutating the stored ratio, so opening or
 * closing the left sidebar cannot make the divider drift.
 */
export function resolveResearchPaneGeometry(ratio, workspaceWidth, viewportWidth) {
  const canonicalRatio = normalizeResearchPaneRatio(ratio);
  const width = Math.max(1, finiteNumber(workspaceWidth, DEFAULT_VIEWPORT_WIDTH));
  const viewport = Math.max(1, finiteNumber(viewportWidth, width));
  const minimumWidth = Math.min(MIN_RESEARCH_PANE_WIDTH, width * MAX_RESEARCH_PANE_RATIO);
  const maximumWidth = Math.max(
    minimumWidth,
    Math.min(viewport * MAX_RESEARCH_PANE_VIEWPORT_RATIO, width * MAX_RESEARCH_PANE_RATIO),
  );
  const paneWidth = clamp(canonicalRatio * width, minimumWidth, maximumWidth);
  const effectiveRatio = paneWidth / width;
  return {
    ratio: canonicalRatio,
    effectiveRatio,
    primaryRatio: 1 - effectiveRatio,
    paneWidth,
    minimumWidth,
    maximumWidth,
  };
}

export function getResearchPaneWidthBounds(viewportWidth) {
  const normalizedViewportWidth = Math.max(0, finiteNumber(viewportWidth, DEFAULT_VIEWPORT_WIDTH));
  // Below 600px the requested 360px minimum and 60vw maximum cannot both hold.
  // Preserve the usable 360px minimum; the window layout may then scroll or collapse.
  const maximum = Math.max(
    MIN_RESEARCH_PANE_WIDTH,
    Math.floor(normalizedViewportWidth * MAX_RESEARCH_PANE_VIEWPORT_RATIO),
  );
  return { minimum: MIN_RESEARCH_PANE_WIDTH, maximum };
}

export function normalizeResearchPaneWidth(
  value,
  viewportWidth,
  fallback = DEFAULT_RESEARCH_PANE_WIDTH,
) {
  const { minimum, maximum } = getResearchPaneWidthBounds(viewportWidth);
  const normalizedFallback = clamp(
    Math.round(finiteNumber(fallback, DEFAULT_RESEARCH_PANE_WIDTH)),
    minimum,
    maximum,
  );
  return clamp(Math.round(finiteNumber(value, normalizedFallback)), minimum, maximum);
}

export function normalizeSecondaryPaneWidths(value, viewportWidth) {
  const source = value && typeof value === "object" ? value : {};
  const normalizedViewportWidth = Math.max(1, finiteNumber(viewportWidth, DEFAULT_VIEWPORT_WIDTH));
  const legacyResearchRatio = Number.isFinite(Number(source.researchWidth))
    ? normalizeResearchPaneWidth(source.researchWidth, normalizedViewportWidth) / normalizedViewportWidth
    : DEFAULT_RESEARCH_PANE_RATIO;
  return {
    documentRatio: normalizeDocumentPaneRatio(source.documentRatio),
    researchRatio: normalizeResearchPaneRatio(source.researchRatio, legacyResearchRatio),
  };
}

export function normalizeSecondaryPaneLayout(value, options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const secondaryPane = normalizeSecondaryPane(source.secondaryPane);
  return {
    secondaryPane,
    activePane: deriveActivePane(source.activePane, secondaryPane),
    widths: normalizeSecondaryPaneWidths(source.widths, options.viewportWidth),
  };
}

/** Returns a JSON-safe snapshot suitable for temporary AI/immersive layout stashing. */
export function createSecondaryPaneLayoutSnapshot(layout, options = {}) {
  return {
    version: SECONDARY_PANE_LAYOUT_SNAPSHOT_VERSION,
    ...normalizeSecondaryPaneLayout(layout, options),
  };
}

export function isSecondaryPaneLayoutSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.version !== SECONDARY_PANE_LAYOUT_SNAPSHOT_VERSION) return false;
  const pane = normalizeSecondaryPane(value.secondaryPane);
  if (value.secondaryPane?.kind !== pane.kind) return false;
  return [ACTIVE_PANE.PRIMARY, ACTIVE_PANE.SECONDARY, "main", "right"].includes(value.activePane);
}

/** Keeps the older visible-pane snapshot when temporary full-window surfaces overlap. */
export function handoffSecondaryPaneLayoutSnapshot(targetSnapshot, leavingSnapshot) {
  if (isSecondaryPaneLayoutSnapshot(targetSnapshot)) return targetSnapshot;
  if (isSecondaryPaneLayoutSnapshot(leavingSnapshot)) return leavingSnapshot;
  return null;
}

/**
 * Hides the pane for a temporary full-window surface and returns the snapshot needed
 * to restore it. The caller owns snapshot lifetime and decides when restoration ends.
 */
export function stashSecondaryPaneLayout(layout, options = {}) {
  const snapshot = createSecondaryPaneLayoutSnapshot(layout, options);
  return {
    snapshot,
    layout: {
      secondaryPane: EMPTY_SECONDARY_PANE,
      activePane: ACTIVE_PANE.PRIMARY,
      widths: { ...snapshot.widths },
    },
  };
}

/** Invalid or future-version snapshots fall back to a caller-provided live layout. */
export function restoreSecondaryPaneLayout(snapshot, options = {}) {
  const source = isSecondaryPaneLayoutSnapshot(snapshot) ? snapshot : options.fallbackLayout;
  return normalizeSecondaryPaneLayout(source, options);
}
