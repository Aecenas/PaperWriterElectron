import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(fileURLToPath(new URL("./App.jsx", import.meta.url)), "utf8");

test("editor update handlers do not serialize or publish the complete document", () => {
  const mainStart = source.indexOf("onUpdate: ({ transaction }) => {", source.indexOf("const mainEditorOptions"));
  const mainEnd = source.indexOf("const rightEditorOptions", mainStart);
  const rightStart = source.indexOf("onUpdate: ({ transaction }) => {", mainEnd);
  const rightEnd = source.indexOf("const rightSplitTab", rightStart);
  assert.ok(mainStart > 0 && mainEnd > mainStart && rightStart > mainEnd && rightEnd > rightStart);
  for (const updateHandler of [source.slice(mainStart, mainEnd), source.slice(rightStart, rightEnd)]) {
    assert.doesNotMatch(updateHandler, /getHTML|getJSON|setDocumentState|document:\s*\{/);
    assert.match(updateHandler, /paperKnowledgeDerived/);
  }
});

test("knowledge synchronization cannot re-enter through its own derived transactions", () => {
  const start = source.indexOf("const synchronize = createKnowledgeUpdateGuard(");
  const end = source.indexOf('activeWorkEditor.on("update", synchronize)', start);
  const synchronizationSource = source.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(synchronizationSource, /createKnowledgeUpdateGuard/);
  assert.match(synchronizationSource, /synchronizeKnowledgeReferences/);
});

test("document switches rebuild editor state so undo cannot cross tab boundaries", () => {
  assert.match(source, /replaceEditorContentWithoutHistory\(editor,/);
  assert.match(source, /replaceEditorContentWithoutHistory\(rightSplitEditor,/);
  assert.doesNotMatch(source, /commands\.setContent\(/);
});

test("autosave includes unnamed tabs and keeps recovery paths separate", () => {
  assert.match(source, /bridge\.saveTempDocument/);
  assert.match(source, /recoveryPath: update\.path/);
  assert.match(source, /recoveryId: update\.recoveryId/);
  assert.match(source, /recoveryId: result\.recoveryId/);
  assert.match(source, /deleteTempDocument\?\.\(recoveryTabId\(/);
  assert.match(source, /autosaveRunningRef\.current/);
});

test("editor groups accept additional tabs without evicting an existing document", () => {
  const start = source.indexOf("const addOrActivateDocumentTab");
  const end = source.indexOf("useEffect(() =>", start);
  const addTabSource = source.slice(start, end);
  assert.match(addTabSource, /const nextTabs = canReplaceBlank \? \[tab\] : \[\.\.\.snapshot, tab\]/);
  assert.match(addTabSource, /openWorkspaceDocument\(workspaceGroupsRef\.current, requestedGroup/);
  assert.doesNotMatch(addTabSource, /tabCapacityFull/);
  assert.doesNotMatch(addTabSource, /snapshot\.slice\(1\)/);
});

test("dirty tab updates do not reserialize every cached editor document", () => {
  const start = source.indexOf("function summarizeDocumentCache");
  const end = source.indexOf("function formatCacheBytes", start);
  const summarySource = source.slice(start, end);
  assert.doesNotMatch(summarySource, /JSON\.stringify|estimateSerializedBytes/);
  assert.match(summarySource, /editorJsonBytes/);
});

test("AI streaming batches chunks and participates in document revisions", () => {
  const mutationStart = source.indexOf("const updateDocumentAiStateForKey");
  const mutationEnd = source.indexOf("const updateActiveDocumentAiState", mutationStart);
  assert.match(source.slice(mutationStart, mutationEnd), /recordTabMutation/);
  assert.match(source, /pendingChunks\.push\(payload\.delta\)/);
  assert.match(source, /setTimeout\(\(\) => flushContext\(context\), 50\)/);
});

test("live statistics are ProseMirror-derived and never parse an HTML template", () => {
  const derivedSource = fs.readFileSync(fileURLToPath(new URL("./editor-derived-state.js", import.meta.url)), "utf8");
  assert.doesNotMatch(derivedSource, /createElement|innerHTML|querySelector/);
  assert.doesNotMatch(source, /createElement\(["']template["']\)/);
  assert.match(source, /PAPER_DERIVED_STATE_PLUGIN_KEY/);
  assert.doesNotMatch(source, /\.doc\.descendants\(/);
});

test("status metrics subscribe to primitive fields instead of rerendering the whole status bar", () => {
  const metricStart = source.indexOf("function LiveStatusMetric");
  const statusStart = source.indexOf("function StatusBar", metricStart);
  const statusEnd = source.indexOf("function createTabId", statusStart);
  assert.match(source.slice(metricStart, statusStart), /stats\[field\]/);
  const statusSource = source.slice(statusStart, statusEnd);
  assert.doesNotMatch(statusSource, /selector:/);
  for (const field of ["words", "paragraphs", "pages", "images"]) {
    assert.match(statusSource, new RegExp(`field="${field}"`));
  }
  assert.doesNotMatch(statusSource, /field="quotes"|label="引用"/);
});

test("closing a right-group document uses the lifecycle snapshot boundary", () => {
  assert.match(source, /<GroupTabStrip[\s\S]*groupId=\{WORKSPACE_GROUP_ID\.SECONDARY\}/);
  assert.match(source, /onClose=\{\(viewId\) => handleCloseGroupView\(WORKSPACE_GROUP_ID\.SECONDARY, viewId\)\}/);
  const closeStart = source.indexOf("const handleCloseTab");
  const closeEnd = source.indexOf("const handleCloseGroupView", closeStart);
  assert.match(source.slice(closeStart, closeEnd), /snapshotLiveTabs\(\{ includeEditorJson: true \}\)/);
  assert.doesNotMatch(source, /className="right-split-close"/);
});

test("reopening a document secondary pane restores its selection and scroll snapshot", () => {
  const applyStart = source.indexOf("if (!rightSplitEditor || !rightSplitTabId)");
  const applyEnd = source.indexOf("activeDocumentKeyRef.current = activeDocumentKey", applyStart);
  const applySource = source.slice(applyStart, applyEnd);
  assert.match(applySource, /restoreEditorSelectionWithoutHistory\(rightSplitEditor, splitTab\?\.selectionState\)/);
  assert.match(applySource, /rightSplitSelectionRef\.current = readEditorSelectionState\(rightSplitEditor\)/);
  assert.match(applySource, /restoreCanvasScrollState\(rightCanvasRef\.current, splitTab\?\.scrollState\)/);

  const snapshotStart = source.indexOf("const snapshotLiveTabs");
  const snapshotEnd = source.indexOf("const openSearch", snapshotStart);
  const snapshotSource = source.slice(snapshotStart, snapshotEnd);
  assert.match(snapshotSource, /selectionState: readEditorSelectionState\(rightSplitEditor\)/);
  assert.match(snapshotSource, /scrollState: readCanvasScrollState\(rightCanvasRef\.current\)/);
});

test("comment overlays avoid empty-state transaction renders and coalesce layout work", () => {
  const anchorsStart = source.indexOf("function CommentAnchors");
  const highlightsStart = source.indexOf("function CommentHighlights", anchorsStart);
  const panelStart = source.indexOf("function CommentPanel", highlightsStart);
  const anchorsSource = source.slice(anchorsStart, highlightsStart);
  const highlightsSource = source.slice(highlightsStart, panelStart);
  assert.match(anchorsSource, /!normalizedComments\.length/);
  assert.match(anchorsSource, /setPositions\(\(current\) => \(current\.length \? \[\] : current\)\)/);
  assert.match(highlightsSource, /!activeCommentId \|\| !normalizedComments\.length/);
  assert.match(highlightsSource, /if \(highlightFrameRef\.current\) return/);
  assert.match(highlightsSource, /cancelAnimationFrame\(highlightFrameRef\.current\)/);
});

test("selection and table overlays coalesce duplicate key and transaction events", () => {
  const selectionStart = source.indexOf("function SelectionBubbleToolbar");
  const commentStart = source.indexOf("function CommentAnchors", selectionStart);
  const tableStart = source.indexOf("function TableContextToolbar", commentStart);
  const tableEnd = source.indexOf("function ", tableStart + "function ".length);
  const selectionSource = source.slice(selectionStart, commentStart);
  const tableSource = source.slice(tableStart, tableEnd);
  for (const overlaySource of [selectionSource, tableSource]) {
    assert.match(overlaySource, /if \(toolbarFrameRef\.current\) return/);
    assert.match(overlaySource, /cancelAnimationFrame\(toolbarFrameRef\.current\)/);
    assert.doesNotMatch(overlaySource, /const updateSoon = \(\) => window\.requestAnimationFrame/);
  }
});

test("comment decorations map through ordinary typing instead of rebuilding all ranges", () => {
  const start = source.indexOf("const DocumentCommentDecorations");
  const end = source.indexOf("const HeadingMetadata", start);
  assert.match(source.slice(start, end), /previousState\.decorations\.map\(transaction\.mapping, transaction\.doc\)/);
});

test("discard-close aborts when a document changes while confirmation is open", () => {
  const start = source.indexOf("bridge.onCloseRequest");
  const end = source.indexOf("bridge.onCloseRequest", start + 1);
  const closeSource = source.slice(start, end > start ? end : undefined);
  assert.match(closeSource, /promptedRevisions/);
  assert.match(closeSource, /changedWhileConfirming/);
  assert.match(closeSource, /latestSnapshot = snapshotLiveTabs\(\)/);
  assert.match(closeSource, /bridge\.closeCanceled/);
  assert.match(closeSource, /sessionClosePendingRef\.current = true/);
  assert.match(closeSource, /Promise\.all\(\[\.\.\.saveQueueByTabRef\.current\.values\(\)\]\)/);
});

test("single-tab close also rechecks the document revision after confirmation", () => {
  const start = source.indexOf("const handleCloseTab");
  const end = source.indexOf("const handleNew", start);
  const closeSource = source.slice(start, end);
  assert.match(closeSource, /promptedRevision/);
  assert.match(closeSource, /liveRevisionByTabRef\.current\.get\(tabId\)/);
  assert.match(closeSource, /snapshot = snapshotLiveTabs\(\{ includeEditorJson: true \}\)/);
  assert.match(closeSource, /tabClosePendingIdsRef\.current\.add\(tabId\)/);
  assert.match(closeSource, /await waitForTabSave\(tabId\)/);
});

test("autosave skips tabs while close or discard is pending", () => {
  const start = source.indexOf("const timer = window.setInterval(async () =>");
  const end = source.indexOf("}, 60000)", start);
  const autosaveSource = source.slice(start, end);
  assert.match(autosaveSource, /sessionClosePendingRef\.current/);
  assert.match(autosaveSource, /selectAutosaveSnapshotTabs\([\s\S]*tabClosePendingIdsRef\.current/);
});

test("successful saves commit clean state before best-effort recovery cleanup", () => {
  const start = source.indexOf("const handleSave = useCallback");
  const end = source.indexOf("bridge.onCloseRequest", start);
  const saveSource = source.slice(start, end);
  const stateCommit = saveSource.indexOf("openTabsRef.current = nextTabs");
  const cleanup = saveSource.indexOf("deleteRecoveryBestEffort");
  assert.ok(stateCommit > 0 && cleanup > stateCommit);
  assert.match(saveSource, /文档已保存，但旧恢复文件清理失败/);
  assert.doesNotMatch(saveSource, /await bridge\.deleteTempDocument/);
});

test("multi-tab save boundaries use revisions captured with the document snapshots", () => {
  const snapshotStart = source.indexOf("const snapshotLiveTabs");
  const snapshotEnd = source.indexOf("const activeSessionPath", snapshotStart);
  assert.match(source.slice(snapshotStart, snapshotEnd), /snapshotTabsWithRevisions\(documentSnapshots, liveRevisionByTabRef\.current\)/);

  const closeStart = source.indexOf("bridge.onCloseRequest");
  const autosaveStart = source.indexOf("const timer = window.setInterval", closeStart);
  const closeSource = source.slice(closeStart, autosaveStart);
  assert.match(closeSource, /tab\.snapshotRevision/);
  assert.match(closeSource, /snapshotRevisionIsCurrent\(tab, liveRevisionByTabRef\.current\)/);
  assert.doesNotMatch(closeSource, /const revision = liveRevisionByTabRef\.current\.get\(tab\.id\)/);

  const autosaveEnd = source.indexOf("const handleKeyDown", autosaveStart);
  const autosaveSource = source.slice(autosaveStart, autosaveEnd);
  assert.match(autosaveSource, /snapshotRevision: tab\.snapshotRevision/);
  assert.match(autosaveSource, /snapshotRevisionIsCurrent\(tab, liveRevisionByTabRef\.current\)/);
  assert.doesNotMatch(autosaveSource, /const revision = liveRevisionByTabRef\.current\.get\(tab\.id\)/);
});

test("autosave never queues an old target while Save As is pending", () => {
  const start = source.indexOf("const timer = window.setInterval");
  const end = source.indexOf("const handleKeyDown", start);
  const autosaveSource = source.slice(start, end);
  assert.match(autosaveSource, /selectAutosaveSnapshotTabs\([\s\S]*saveQueueByTabRef\.current/);
  assert.match(autosaveSource, /if \(saveQueueByTabRef\.current\.has\(tab\.id\)/);
  assert.match(autosaveSource, /sourcePath: tab\.path \|\| ""/);
  assert.match(autosaveSource, /targetUnchanged/);
});
