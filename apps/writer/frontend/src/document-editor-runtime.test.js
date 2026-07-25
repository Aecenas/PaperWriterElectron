import assert from "node:assert/strict";
import test from "node:test";
import {
  captureDocumentWorkspaceSnapshot,
  createPaneEditorHydrator,
  serializePaneDocument,
} from "./document-workspace/editor-runtime.js";

function createPaneHarness(name, values = {}, events = []) {
  return {
    events,
    port: {
      serializeDocument() {
        events.push([name, "serialize"]);
        return values.document;
      },
      readEditorJson() {
        events.push([name, "json"]);
        if (values.failOnJsonRead) throw new Error("JSON must stay cold");
        return values.editorJson;
      },
      readScrollState() {
        events.push([name, "scroll"]);
        return values.scrollState;
      },
      readSelectionState() {
        events.push([name, "selection"]);
        return values.selectionState;
      },
    },
  };
}

function createSchedulerHarness() {
  const frames = [];
  const deferred = [];
  return {
    port: {
      requestFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
      defer(callback) {
        deferred.push(callback);
        return deferred.length;
      },
    },
    flushFrame() {
      const batch = frames.splice(0);
      batch.forEach((callback) => callback());
    },
    flushDeferred() {
      const batch = deferred.splice(0);
      batch.forEach((callback) => callback());
    },
    counts() {
      return {
        deferred: deferred.length,
        frames: frames.length,
      };
    },
  };
}

test("serializePaneDocument keeps live HTML, comments, and updatedAt together", () => {
  const sourceDocument = {
    title: "   ",
    html: "<p>cached</p>",
    comments: [{ id: "cached" }],
    updatedAt: "cached-time",
    documentId: "document-a",
  };
  const liveComments = [{ id: "live" }];
  const calls = [];
  const result = serializePaneDocument({
    sourceDocument,
    liveUpdatedAt: "live-time",
    letterTemplates: ["template-a"],
    pane: {
      readHtml() {
        calls.push("html");
        return '<p data-derived="true">live body</p>';
      },
      readText() {
        calls.push("text");
        return "Live inferred title";
      },
      readComments(fallback) {
        calls.push(["comments", fallback]);
        return liveComments;
      },
    },
    stripDerivedHtml(html) {
      calls.push(["strip", html]);
      return "<p>live body</p>";
    },
    inferTitle(text) {
      calls.push(["infer", text]);
      return "Inferred title";
    },
    normalizeDocument(document, templates) {
      calls.push(["normalize", templates]);
      return { ...document, normalized: true };
    },
  });

  assert.deepEqual(result, {
    ...sourceDocument,
    title: "Inferred title",
    html: "<p>live body</p>",
    comments: liveComments,
    updatedAt: "live-time",
    normalized: true,
  });
  assert.deepEqual(calls, [
    "html",
    ["strip", '<p data-derived="true">live body</p>'],
    "text",
    ["infer", "Live inferred title"],
    ["comments", sourceDocument.comments],
    ["normalize", ["template-a"]],
  ]);
});

test("workspace snapshots freeze main and inactive-right pane state at the current revision", () => {
  const events = [];
  const mainDocument = { title: "Main live", html: "<p>main</p>" };
  const rightDocument = { title: "Right live", html: "<p>right</p>" };
  const mainJson = { type: "doc", pane: "main", bytes: 11 };
  const rightJson = { type: "doc", pane: "right", bytes: 17 };
  const mainScroll = { top: 31, left: 2 };
  const rightScroll = { top: 210, left: 3 };
  const rightSelection = { from: 4, to: 9 };
  const main = createPaneHarness("main", {
    document: mainDocument,
    editorJson: mainJson,
    scrollState: mainScroll,
  }, events);
  const right = createPaneHarness("right", {
    document: rightDocument,
    editorJson: rightJson,
    scrollState: rightScroll,
    selectionState: rightSelection,
  }, events);
  const cachedThirdDocument = { title: "Cached third" };
  const tabs = [
    { id: "tab-a", path: "old-main", title: "Cached main", document: {}, dirty: false, editorJson: null, editorJsonBytes: 0 },
    { id: "tab-b", path: "right-path", title: "Cached right", document: {}, dirty: false, editorJson: null, editorJsonBytes: 0 },
    { id: "tab-c", path: "third-path", title: "Cached third", document: cachedThirdDocument, dirty: false, editorJson: null, editorJsonBytes: 0 },
  ];
  const originalTabs = structuredClone(tabs);
  const revisions = new Map([["tab-a", 3], ["tab-b", 8], ["tab-c", 13]]);

  const snapshot = captureDocumentWorkspaceSnapshot({
    tabs,
    activeTabId: "tab-a",
    rightTabId: "tab-b",
    currentPath: "main-path",
    currentDirty: true,
    activeDocument: { title: "stale active" },
    includeEditorJson: true,
    mainPane: main.port,
    rightPane: right.port,
    runtimePort: {
      readEditorSource: () => "main",
      isDirty: (tabId) => tabId === "tab-b",
    },
    revisionPort: {
      readLiveRevision: (tabId) => revisions.get(tabId),
    },
    estimateSerializedBytes: (value) => value?.bytes || 0,
  });

  assert.deepEqual(tabs, originalTabs);
  assert.notEqual(snapshot, tabs);
  assert.deepEqual(snapshot[0], {
    ...tabs[0],
    document: mainDocument,
    path: "main-path",
    title: "Main live",
    dirty: true,
    editorJson: mainJson,
    editorJsonBytes: 11,
    scrollState: mainScroll,
    snapshotRevision: 3,
  });
  assert.deepEqual(snapshot[1], {
    ...tabs[1],
    document: rightDocument,
    title: "Right live",
    dirty: true,
    editorJson: rightJson,
    editorJsonBytes: 17,
    scrollState: rightScroll,
    selectionState: rightSelection,
    snapshotRevision: 8,
  });
  assert.deepEqual(snapshot[2], {
    ...tabs[2],
    snapshotRevision: 13,
  });
  assert.deepEqual(events, [
    ["main", "serialize"],
    ["main", "json"],
    ["main", "scroll"],
    ["right", "serialize"],
    ["right", "json"],
    ["right", "scroll"],
    ["right", "selection"],
  ]);
});

test("workspace snapshots never read editor JSON on the hot path when it is not requested", () => {
  const cachedMainJson = { cached: "main" };
  const cachedRightJson = { cached: "right" };
  const events = [];
  const main = createPaneHarness("main", {
    document: { title: "Main" },
    editorJson: { forbidden: true },
    failOnJsonRead: true,
    scrollState: { top: 1, left: 0 },
  }, events);
  const right = createPaneHarness("right", {
    document: { title: "Right" },
    editorJson: { forbidden: true },
    failOnJsonRead: true,
    scrollState: { top: 2, left: 0 },
    selectionState: { from: 2, to: 3 },
  }, events);
  const snapshot = captureDocumentWorkspaceSnapshot({
    tabs: [
      { id: "tab-a", document: {}, editorJson: cachedMainJson, editorJsonBytes: 21 },
      { id: "tab-b", document: {}, editorJson: cachedRightJson, editorJsonBytes: 34 },
    ],
    activeTabId: "tab-a",
    rightTabId: "tab-b",
    includeEditorJson: false,
    mainPane: main.port,
    rightPane: right.port,
    runtimePort: {
      isDirty: () => true,
      readEditorSource: () => "main",
    },
    revisionPort: {
      readLiveRevision: () => 1,
    },
  });

  assert.equal(snapshot[0].editorJson, cachedMainJson);
  assert.equal(snapshot[0].editorJsonBytes, 21);
  assert.equal(snapshot[1].editorJson, cachedRightJson);
  assert.equal(snapshot[1].editorJsonBytes, 34);
  assert.equal(events.some((event) => event[1] === "json"), false);
});

test("an active right pane supplies the live snapshot without persisting its selection", () => {
  const events = [];
  const main = createPaneHarness("main", {
    document: { title: "Wrong pane" },
    editorJson: { pane: "main" },
    scrollState: { top: 1, left: 0 },
  }, events);
  const rightDocument = { title: "Right active", html: "<p>right</p>" };
  const rightJson = { type: "doc", pane: "right", bytes: 23 };
  const rightScroll = { top: 144, left: 5 };
  const right = createPaneHarness("right", {
    document: rightDocument,
    editorJson: rightJson,
    scrollState: rightScroll,
    selectionState: { from: 7, to: 12 },
  }, events);
  const tabs = [{
    id: "tab-a",
    path: "old-path",
    title: "Cached",
    document: {},
    dirty: false,
    editorJson: null,
    editorJsonBytes: 0,
  }];

  const [snapshot] = captureDocumentWorkspaceSnapshot({
    tabs,
    activeTabId: "tab-a",
    rightTabId: "tab-a",
    currentPath: "active-path",
    currentDirty: true,
    activeDocument: { title: "Stale active" },
    includeEditorJson: true,
    mainPane: main.port,
    rightPane: right.port,
    runtimePort: {
      isDirty: () => false,
      readEditorSource: () => "right",
    },
    revisionPort: {
      readLiveRevision: () => 6,
    },
    estimateSerializedBytes: (value) => value?.bytes || 0,
  });

  assert.deepEqual(snapshot, {
    ...tabs[0],
    document: rightDocument,
    path: "active-path",
    title: "Right active",
    dirty: true,
    editorJson: rightJson,
    editorJsonBytes: 23,
    scrollState: rightScroll,
    snapshotRevision: 6,
  });
  assert.equal(Object.hasOwn(snapshot, "selectionState"), false);
  assert.deepEqual(events, [
    ["right", "serialize"],
    ["right", "json"],
    ["right", "scroll"],
  ]);
});

test("pane hydration falls back from JSON to HTML and preserves frame ordering", () => {
  const scheduler = createSchedulerHarness();
  const events = [];
  const editorJson = { type: "doc", id: "right-b" };
  const selectionState = { from: 3, to: 8 };
  const comments = [{ id: "comment-b" }];
  const scrollState = { top: 88, left: 4 };
  const hydrator = createPaneEditorHydrator({
    scheduler: scheduler.port,
    normalizeComments(value) {
      events.push(["normalize-comments", value]);
      return value;
    },
    pane: {
      replaceContentWithoutHistory(content) {
        events.push(["replace", content]);
        if (content === editorJson) throw new Error("cached JSON rejected");
      },
      restoreSelectionWithoutHistory(value) {
        events.push(["selection", value]);
      },
      captureSelectionState() {
        events.push(["capture-selection"]);
      },
      syncComments(value) {
        events.push(["comments", value]);
      },
      restoreScrollState(value) {
        events.push(["scroll", value]);
      },
    },
  });

  hydrator.hydrate({
    editorJson,
    html: "<p>fallback body</p>",
    selectionState,
    comments,
    scrollState,
  });
  assert.equal(hydrator.isApplying(), true);
  assert.deepEqual(events, []);

  scheduler.flushFrame();
  assert.deepEqual(events, [
    ["replace", editorJson],
    ["replace", "<p>fallback body</p>"],
    ["selection", selectionState],
    ["capture-selection"],
    ["normalize-comments", comments],
    ["comments", comments],
  ]);
  assert.deepEqual(scheduler.counts(), { deferred: 1, frames: 1 });
  assert.equal(hydrator.isApplying(), true);

  scheduler.flushFrame();
  assert.deepEqual(events.at(-1), ["scroll", scrollState]);
  assert.equal(hydrator.isApplying(), true);
  scheduler.flushDeferred();
  assert.equal(hydrator.isApplying(), false);
});

test("an empty pane hydration does not advance the generation or schedule work", () => {
  const scheduler = createSchedulerHarness();
  const hydrator = createPaneEditorHydrator({
    scheduler: scheduler.port,
    pane: {
      replaceContentWithoutHistory() {
        assert.fail("an empty target must not replace editor content");
      },
    },
  });

  assert.equal(hydrator.readGeneration(), 0);
  assert.equal(hydrator.hydrate(null), 0);
  assert.equal(hydrator.readGeneration(), 0);
  assert.equal(hydrator.isApplying(), false);
  assert.deepEqual(scheduler.counts(), { deferred: 0, frames: 0 });
});

test("a newer pane hydration generation prevents an older queued run from landing", () => {
  const scheduler = createSchedulerHarness();
  const events = [];
  const hydrator = createPaneEditorHydrator({
    scheduler: scheduler.port,
    pane: {
      replaceContentWithoutHistory(content) {
        events.push(["replace", content]);
      },
      restoreSelectionWithoutHistory(value) {
        events.push(["selection", value]);
      },
      captureSelectionState() {
        events.push(["capture-selection"]);
      },
      syncComments(value) {
        events.push(["comments", value]);
      },
      restoreScrollState(value) {
        events.push(["scroll", value]);
      },
    },
  });

  const firstRun = hydrator.hydrate({
    html: "<p>A</p>",
    selectionState: { from: 1, to: 1 },
    comments: ["A"],
    scrollState: { top: 10, left: 0 },
  });
  const secondRun = hydrator.hydrate({
    html: "<p>B</p>",
    selectionState: { from: 2, to: 2 },
    comments: ["B"],
    scrollState: { top: 20, left: 0 },
  });
  assert.ok(secondRun > firstRun);

  scheduler.flushFrame();
  assert.deepEqual(events, [
    ["replace", "<p>B</p>"],
    ["selection", { from: 2, to: 2 }],
    ["capture-selection"],
    ["comments", ["B"]],
  ]);
  scheduler.flushFrame();
  scheduler.flushDeferred();
  assert.deepEqual(events, [
    ["replace", "<p>B</p>"],
    ["selection", { from: 2, to: 2 }],
    ["capture-selection"],
    ["comments", ["B"]],
    ["scroll", { top: 20, left: 0 }],
  ]);
  assert.equal(hydrator.isApplying(), false);
});

test("App composes editor serialization, snapshots, and right-pane hydration through the runtime leaf", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

  assert.match(source, /captureDocumentWorkspaceSnapshot/);
  assert.match(source, /createPaneEditorHydrator/);
  assert.match(source, /serializePaneDocument/);

  const snapshotStart = source.indexOf("const snapshotLiveTabs");
  const snapshotEnd = source.indexOf("const openSearch", snapshotStart);
  const snapshotSource = source.slice(snapshotStart, snapshotEnd);
  assert.ok(snapshotStart > 0 && snapshotEnd > snapshotStart);
  assert.match(snapshotSource, /return captureDocumentWorkspaceSnapshot\(\{/);
  assert.match(snapshotSource, /revisionPort: documentRevisionPort/);

  const mainSaveStart = source.indexOf("const getSaveDocument = useCallback");
  const rightSaveStart = source.indexOf("const getRightSplitSaveDocument = useCallback", mainSaveStart);
  const saveEnd = source.indexOf("useEffect(() =>", rightSaveStart);
  assert.ok(mainSaveStart > 0 && rightSaveStart > mainSaveStart && saveEnd > rightSaveStart);
  assert.match(source.slice(mainSaveStart, rightSaveStart), /return serializePaneDocument\(\{/);
  assert.match(source.slice(rightSaveStart, saveEnd), /return serializePaneDocument\(\{/);

  const hydrateStart = source.indexOf("if (!rightSplitEditor || !rightSplitTabId)");
  const hydrateEnd = source.indexOf("currentPathRef.current = currentPath", hydrateStart);
  const hydrateSource = source.slice(hydrateStart, hydrateEnd);
  assert.ok(hydrateStart > 0 && hydrateEnd > hydrateStart);
  assert.match(hydrateSource, /if \(!splitDocument\) \{\s*return;\s*\}/);
  assert.match(hydrateSource, /rightPaneEditorHydrator\.hydrate\(\{/);
  assert.match(hydrateSource, /\}, \[rightSplitEditor, rightSplitTabId\]\);/);

  const rightOptionsStart = source.indexOf("const rightEditorOptions");
  const rightOptionsEnd = source.indexOf("const rightSplitTab", rightOptionsStart);
  assert.match(
    source.slice(rightOptionsStart, rightOptionsEnd),
    /rightPaneEditorHydrator\.isApplying\(\)/,
  );
  assert.doesNotMatch(source, /rightSplitApplyingRef|rightSplitApplyRunRef/);
  assert.doesNotMatch(snapshotSource, /snapshotTabsWithRevisions/);
});
