function readPaneValue(pane, method, fallback = null) {
  return typeof pane?.[method] === "function" ? pane[method]() : fallback;
}

function readLiveRevision(revisionPort, tabId) {
  const revision = revisionPort?.readLiveRevision?.(tabId);
  return Math.max(0, Math.floor(Number(revision) || 0));
}

function defaultEstimateSerializedBytes(value) {
  if (!value) return 0;
  try {
    const text = JSON.stringify(value);
    if (!text) return 0;
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(text).byteLength;
    }
    return text.length * 2;
  } catch {
    return 0;
  }
}

export function serializePaneDocument({
  inferTitle = () => "未命名信笺",
  letterTemplates,
  liveUpdatedAt,
  normalizeDocument = (document) => document,
  pane,
  sourceDocument,
  stripDerivedHtml = (html) => html,
} = {}) {
  const source = sourceDocument || {};
  const html = stripDerivedHtml(
    readPaneValue(pane, "readHtml", "") || source.html || "<p></p>",
  );
  const title = source.title?.trim()
    || inferTitle(readPaneValue(pane, "readText", "") || "");
  const comments = typeof pane?.readComments === "function"
    ? pane.readComments(source.comments)
    : source.comments;

  return normalizeDocument({
    ...source,
    title,
    html,
    comments,
    updatedAt: liveUpdatedAt || source.updatedAt,
  }, letterTemplates);
}

export function captureLivePaneSnapshots({
  activeDocument,
  activeTabId,
  currentDirty = false,
  currentPath = "",
  includeEditorJson = false,
  mainPane,
  rightPane,
  rightTabId = "",
  runtimePort,
} = {}) {
  const liveSnapshots = new Map();
  const activeUsesRightPane = rightTabId === activeTabId
    && runtimePort?.readEditorSource?.(activeTabId) === "right";
  const activePane = activeUsesRightPane ? rightPane : mainPane;
  const serializedActiveDocument = readPaneValue(
    activePane,
    "serializeDocument",
    null,
  ) || activeDocument;

  liveSnapshots.set(activeTabId, {
    document: serializedActiveDocument,
    path: currentPath,
    dirty: currentDirty,
    editorJson: includeEditorJson
      ? (readPaneValue(activePane, "readEditorJson", null) || null)
      : undefined,
    scrollState: readPaneValue(activePane, "readScrollState", null),
  });

  if (rightTabId && rightTabId !== activeTabId) {
    const rightDocument = readPaneValue(rightPane, "serializeDocument", null);
    if (rightDocument) {
      liveSnapshots.set(rightTabId, {
        document: rightDocument,
        dirty: Boolean(runtimePort?.isDirty?.(rightTabId)),
        editorJson: includeEditorJson
          ? (readPaneValue(rightPane, "readEditorJson", null) || null)
          : undefined,
        scrollState: readPaneValue(rightPane, "readScrollState", null),
        selectionState: readPaneValue(rightPane, "readSelectionState", null),
      });
    }
  }

  return liveSnapshots;
}

export function mergeLivePaneSnapshots({
  estimateSerializedBytes = defaultEstimateSerializedBytes,
  includeEditorJson = false,
  liveSnapshots = new Map(),
  revisionPort,
  tabs = [],
} = {}) {
  return tabs.map((tab) => {
    const live = liveSnapshots.get(tab.id);
    if (!live) {
      return {
        ...tab,
        snapshotRevision: readLiveRevision(revisionPort, tab.id),
      };
    }
    const nextEditorJson = includeEditorJson
      ? (live.editorJson || tab.editorJson)
      : tab.editorJson;
    return {
      ...tab,
      ...live,
      path: live.path ?? tab.path,
      title: live.document?.title || "未命名信笺",
      editorJson: nextEditorJson,
      editorJsonBytes: includeEditorJson
        ? estimateSerializedBytes(nextEditorJson)
        : tab.editorJsonBytes,
      snapshotRevision: readLiveRevision(revisionPort, tab.id),
    };
  });
}

export function captureDocumentWorkspaceSnapshot({
  estimateSerializedBytes,
  revisionPort,
  tabs,
  ...captureOptions
} = {}) {
  const liveSnapshots = captureLivePaneSnapshots(captureOptions);
  return mergeLivePaneSnapshots({
    estimateSerializedBytes,
    includeEditorJson: Boolean(captureOptions.includeEditorJson),
    liveSnapshots,
    revisionPort,
    tabs,
  });
}

export function createPaneEditorHydrator({
  normalizeComments = (comments) => comments,
  pane,
  scheduler,
} = {}) {
  if (typeof pane?.replaceContentWithoutHistory !== "function") {
    throw new TypeError("pane.replaceContentWithoutHistory must be a function");
  }
  if (typeof scheduler?.requestFrame !== "function") {
    throw new TypeError("scheduler.requestFrame must be a function");
  }
  if (typeof scheduler?.defer !== "function") {
    throw new TypeError("scheduler.defer must be a function");
  }

  let generation = 0;
  let applying = false;

  return Object.freeze({
    hydrate(snapshot) {
      // A missing target intentionally does not advance the generation. The
      // current App returns before starting a hydrate when the split is empty.
      if (!snapshot) return generation;

      generation += 1;
      const runId = generation;
      applying = true;
      scheduler.requestFrame(() => {
        if (generation !== runId) return;
        const html = snapshot.html || "<p></p>";
        try {
          pane.replaceContentWithoutHistory(snapshot.editorJson || html);
        } catch {
          pane.replaceContentWithoutHistory(html);
        }
        pane.restoreSelectionWithoutHistory?.(snapshot.selectionState);
        pane.captureSelectionState?.();
        pane.syncComments?.(normalizeComments(snapshot.comments));
        scheduler.requestFrame(() => {
          if (generation === runId) {
            pane.restoreScrollState?.(snapshot.scrollState);
          }
        });
        scheduler.defer(() => {
          if (generation === runId) {
            applying = false;
          }
        });
      });
      return runId;
    },

    isApplying() {
      return applying;
    },

    readGeneration() {
      return generation;
    },
  });
}
