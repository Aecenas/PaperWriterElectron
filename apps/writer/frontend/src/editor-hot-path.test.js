import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { summarizeDocumentCache } from "./document-workspace/model.js";

const source = fs.readFileSync(fileURLToPath(new URL("./App.jsx", import.meta.url)), "utf8");
const commentOverlaysSource = fs.readFileSync(fileURLToPath(new URL("./editor/CommentOverlays.jsx", import.meta.url)), "utf8");
const selectionToolbarSource = fs.readFileSync(fileURLToPath(new URL("./editor/SelectionBubbleToolbar.jsx", import.meta.url)), "utf8");
const tableToolbarSource = fs.readFileSync(fileURLToPath(new URL("./editor/TableContextToolbar.jsx", import.meta.url)), "utf8");
const editorDecorationsSource = fs.readFileSync(fileURLToPath(new URL("./editor/decorations.js", import.meta.url)), "utf8");
const knowledgeLifecycleSource = fs.readFileSync(fileURLToPath(new URL("./controllers/knowledge-lifecycle.js", import.meta.url)), "utf8");
const aiDocumentPortSource = fs.readFileSync(fileURLToPath(new URL("./document-workspace/ai-document-port.js", import.meta.url)), "utf8");
const aiStreamRegistrySource = fs.readFileSync(fileURLToPath(new URL("./controllers/ai-stream-registry.js", import.meta.url)), "utf8");
const workspaceGroupsControllerSource = fs.readFileSync(fileURLToPath(new URL("./document-workspace/workspace-groups-controller.js", import.meta.url)), "utf8");
const persistenceControllerSource = fs.readFileSync(fileURLToPath(new URL("./document-workspace/document-persistence-controller.js", import.meta.url)), "utf8");

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
  const start = knowledgeLifecycleSource.indexOf("const synchronize = createKnowledgeUpdateGuard(");
  const end = knowledgeLifecycleSource.indexOf('activeWorkEditor.on("update", synchronize)', start);
  const synchronizationSource = knowledgeLifecycleSource.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(synchronizationSource, /createKnowledgeUpdateGuard/);
  assert.match(synchronizationSource, /synchronizeKnowledgeReferences/);
});

test("document switches rebuild editor state so undo cannot cross tab boundaries", () => {
  assert.match(source, /replaceEditorContentWithoutHistory\(editor,/);
  assert.match(source, /createPaneEditorHydrator\(\{/);
  assert.match(source, /replaceEditorContentWithoutHistory\(runtimeEditor, content\)/);
  assert.doesNotMatch(source, /commands\.setContent\(/);
});

test("autosave includes unnamed tabs and keeps recovery paths separate", () => {
  assert.match(persistenceControllerSource, /documentIoPort\.saveTempDocument/);
  assert.match(persistenceControllerSource, /recoveryPath: update\.path/);
  assert.match(persistenceControllerSource, /recoveryId: update\.recoveryId/);
  assert.match(persistenceControllerSource, /recoveryId: result\.recoveryId/);
  assert.match(persistenceControllerSource, /deleteTempDocument\?\.\(\s*recoveryTabId\(/);
  assert.match(persistenceControllerSource, /recoveryAutosaveRunning/);
});

test("editor groups accept additional tabs without evicting an existing document", () => {
  const start = source.indexOf("const addOrActivateDocumentTab");
  const end = source.indexOf("useEffect(() =>", start);
  const addTabSource = source.slice(start, end);
  assert.match(addTabSource, /addOrActivateWorkspaceDocumentTab\(/);
  assert.match(addTabSource, /snapshotTabs: snapshotLiveTabs/);
  assert.match(workspaceGroupsControllerSource, /const nextTabs = canReplaceBlank\s*\? \[tab\]\s*:\s*\[\.\.\.snapshot, tab\]/);
  assert.match(workspaceGroupsControllerSource, /openWorkspaceDocument\([\s\S]*groupState\.groups,[\s\S]*requestedGroup/);
  assert.doesNotMatch(workspaceGroupsControllerSource, /tabCapacityFull/);
  assert.doesNotMatch(workspaceGroupsControllerSource, /snapshot\.slice\(1\)/);
});

test("dirty tab updates do not reserialize every cached editor document", () => {
  const document = {};
  Object.defineProperty(document, "toJSON", {
    value() {
      throw new Error("cache summaries must not serialize documents");
    },
  });
  assert.deepEqual(summarizeDocumentCache([
    { document, editorJsonBytes: 128 },
    { document, editorJsonBytes: "64" },
    { document, editorJsonBytes: 0 },
  ]), { bytes: 192, count: 2 });
});

test("AI streaming batches chunks and participates in document revisions", () => {
  assert.match(aiDocumentPortSource, /recordTabMutation\(activeSnapshot\.tabId, updatedAt\)/);
  assert.match(aiDocumentPortSource, /recordTabMutation\(targetTab\.id, updatedAt\)/);
  assert.match(aiStreamRegistrySource, /context\.pendingChunks\.push\(delta\)/);
  assert.match(aiStreamRegistrySource, /timerHost\.setTimeout\(\(\) => \{/);
  assert.match(aiStreamRegistrySource, /AI_STREAM_FLUSH_INTERVAL_MS/);
});

test("live statistics are ProseMirror-derived and never parse an HTML template", () => {
  const derivedSource = fs.readFileSync(fileURLToPath(new URL("./editor-derived-state.js", import.meta.url)), "utf8");
  assert.doesNotMatch(derivedSource, /createElement|innerHTML|querySelector/);
  assert.doesNotMatch(source, /createElement\(["']template["']\)/);
  assert.match(editorDecorationsSource, /PAPER_DERIVED_STATE_PLUGIN_KEY/);
  assert.doesNotMatch(source, /\.doc\.descendants\(/);
});

test("status metrics subscribe to primitive fields instead of rerendering the whole status bar", () => {
  const statusModule = fs.readFileSync(fileURLToPath(new URL("./app-shell/StatusBar.jsx", import.meta.url)), "utf8");
  const metricStart = statusModule.indexOf("function LiveStatusMetric");
  const statusStart = statusModule.indexOf("function StatusBar", metricStart);
  assert.match(statusModule.slice(metricStart, statusStart), /stats\[field\]/);
  const statusSource = statusModule.slice(statusStart);
  assert.doesNotMatch(statusSource, /selector:/);
  for (const field of ["words", "paragraphs", "pages", "images"]) {
    assert.match(statusSource, new RegExp(`field="${field}"`));
  }
  assert.doesNotMatch(statusSource, /field="quotes"|label="引用"/);
});

test("closing a right-group document uses the lifecycle snapshot boundary", () => {
  assert.match(source, /<GroupTabStrip[\s\S]*groupId=\{WORKSPACE_GROUP_ID\.SECONDARY\}/);
  assert.match(source, /onClose=\{\(viewId\) => handleCloseGroupView\(WORKSPACE_GROUP_ID\.SECONDARY, viewId\)\}/);
  assert.match(source, /const handleCloseTab = documentPersistenceController\.closeTab/);
  const closeStart = persistenceControllerSource.indexOf("const closeTab = async");
  const closeEnd = persistenceControllerSource.indexOf("const closeWindow = async", closeStart);
  assert.match(persistenceControllerSource.slice(closeStart, closeEnd), /snapshotTabs\(\{ includeEditorJson: true \}\)/);
  assert.doesNotMatch(source, /className="right-split-close"/);
});

test("reopening a document secondary pane restores its selection and scroll snapshot", () => {
  const applyStart = source.indexOf("if (!rightSplitEditor || !rightSplitTabId)");
  const applyEnd = source.indexOf("currentPathRef.current = currentPath", applyStart);
  const applySource = source.slice(applyStart, applyEnd);
  assert.match(applySource, /rightPaneEditorHydrator\.hydrate\(\{/);
  assert.match(applySource, /selectionState: splitTab\?\.selectionState/);
  assert.match(applySource, /scrollState: splitTab\?\.scrollState/);
  assert.match(applySource, /\}, \[rightSplitEditor, rightSplitTabId\]\);/);

  const snapshotStart = source.indexOf("const snapshotLiveTabs");
  const snapshotEnd = source.indexOf("const openSearch", snapshotStart);
  const snapshotSource = source.slice(snapshotStart, snapshotEnd);
  assert.match(snapshotSource, /captureDocumentWorkspaceSnapshot\(\{/);
  assert.match(snapshotSource, /readSelectionState: \(\) => readEditorSelectionState\(rightSplitEditor\)/);
  assert.match(snapshotSource, /readScrollState: \(\) => readCanvasScrollState\(rightCanvasRef\.current\)/);
});

test("comment overlays avoid empty-state transaction renders and coalesce layout work", () => {
  const anchorsStart = commentOverlaysSource.indexOf("function CommentAnchors");
  const highlightsStart = commentOverlaysSource.indexOf("function CommentHighlights", anchorsStart);
  const panelStart = commentOverlaysSource.indexOf("function CommentPanel", highlightsStart);
  const anchorsSource = commentOverlaysSource.slice(anchorsStart, highlightsStart);
  const highlightsSource = commentOverlaysSource.slice(highlightsStart, panelStart);
  assert.match(anchorsSource, /!normalizedComments\.length/);
  assert.match(anchorsSource, /setPositions\(\(current\) => \(current\.length \? \[\] : current\)\)/);
  assert.match(highlightsSource, /!activeCommentId \|\| !normalizedComments\.length/);
  assert.match(highlightsSource, /if \(highlightFrameRef\.current\) return/);
  assert.match(highlightsSource, /cancelAnimationFrame\(highlightFrameRef\.current\)/);
});

test("selection and table overlays coalesce duplicate key and transaction events", () => {
  for (const overlaySource of [selectionToolbarSource, tableToolbarSource]) {
    assert.match(overlaySource, /if \(toolbarFrameRef\.current\) return/);
    assert.match(overlaySource, /cancelAnimationFrame\(toolbarFrameRef\.current\)/);
    assert.doesNotMatch(overlaySource, /const updateSoon = \(\) => window\.requestAnimationFrame/);
  }
});

test("comment decorations map through ordinary typing instead of rebuilding all ranges", () => {
  const start = editorDecorationsSource.indexOf("const DocumentCommentDecorations");
  const end = editorDecorationsSource.indexOf("const HeadingMetadata", start);
  assert.match(editorDecorationsSource.slice(start, end), /previousState\.decorations\.map\(transaction\.mapping, transaction\.doc\)/);
});

test("discard-close aborts when a document changes while confirmation is open", () => {
  const start = persistenceControllerSource.indexOf("const closeWindow = async");
  const end = persistenceControllerSource.indexOf("const runRecoveryAutosave = async", start);
  const closeSource = persistenceControllerSource.slice(start, end);
  assert.match(closeSource, /promptedRevisions/);
  assert.match(closeSource, /changedWhileConfirming/);
  assert.match(closeSource, /latestSnapshot = snapshotTabs\(\)/);
  assert.match(closeSource, /documentIoPort\.closeCanceled/);
  assert.match(closeSource, /sessionStatePort\.beginClose\(\)/);
  assert.match(closeSource, /await saveQueuePort\.waitAll\(\)/);
  assert.match(source, /documentPersistenceControllerRef\.current\?\.startLifecycle\(\{/);
});

test("single-tab close also rechecks the document revision after confirmation", () => {
  const start = persistenceControllerSource.indexOf("const closeTab = async");
  const end = persistenceControllerSource.indexOf("const closeWindow = async", start);
  assert.ok(start >= 0 && end > start, "single-tab close source boundaries must exist");
  const closeSource = persistenceControllerSource.slice(start, end);
  assert.match(closeSource, /promptedRevision/);
  assert.match(closeSource, /revisionPort\.readLiveRevision\(\s*normalizedTabId/);
  assert.match(closeSource, /snapshot = snapshotTabs\(\{ includeEditorJson: true \}\)/);
  assert.match(closeSource, /pendingTabCloses\.add\(normalizedTabId\)/);
  assert.match(closeSource, /await saveQueuePort\.wait\(normalizedTabId\)/);
});

test("autosave skips tabs while close or discard is pending", () => {
  const start = persistenceControllerSource.indexOf("const runRecoveryAutosave = async");
  const end = persistenceControllerSource.indexOf("const flushDirtyWorkspaceTabs = async", start);
  const autosaveSource = persistenceControllerSource.slice(start, end);
  assert.match(autosaveSource, /sessionStatePort\.isClosePending\(\)/);
  assert.match(autosaveSource, /selectAutosaveSnapshotTabs\([\s\S]*pendingTabCloses/);
});

test("successful saves commit clean state before best-effort recovery cleanup", () => {
  const start = persistenceControllerSource.indexOf("const save = async");
  const end = persistenceControllerSource.indexOf("const closeTab = async", start);
  const saveSource = persistenceControllerSource.slice(start, end);
  const stateCommit = saveSource.indexOf("commitTabs(nextTabs)");
  const cleanup = saveSource.indexOf("deleteRecoveryBestEffort");
  assert.ok(stateCommit > 0 && cleanup > stateCommit);
  assert.match(saveSource, /文档已保存，但旧恢复文件清理失败/);
  assert.doesNotMatch(saveSource, /await documentIoPort\.deleteTempDocument/);
});

test("multi-tab save boundaries use revisions captured with the document snapshots", () => {
  const snapshotStart = source.indexOf("const snapshotLiveTabs");
  const snapshotEnd = source.indexOf("const sessionPersistenceDescriptor", snapshotStart);
  const snapshotSource = source.slice(snapshotStart, snapshotEnd);
  assert.match(snapshotSource, /captureDocumentWorkspaceSnapshot\(\{/);
  assert.match(snapshotSource, /revisionPort: documentRevisionPort/);
  assert.doesNotMatch(snapshotSource, /snapshotTabsWithRevisions/);

  const closeStart = persistenceControllerSource.indexOf("const closeWindow = async");
  const autosaveStart = persistenceControllerSource.indexOf("const runRecoveryAutosave = async", closeStart);
  const closeSource = persistenceControllerSource.slice(closeStart, autosaveStart);
  assert.match(closeSource, /tab\.snapshotRevision/);
  assert.match(closeSource, /snapshotRevisionIsCurrent\(tab, revisionPort\)/);
  assert.doesNotMatch(closeSource, /RevisionByTabRef/);

  const autosaveEnd = persistenceControllerSource.indexOf("const flushDirtyWorkspaceTabs = async", autosaveStart);
  const autosaveSource = persistenceControllerSource.slice(autosaveStart, autosaveEnd);
  assert.match(autosaveSource, /snapshotRevision: tab\.snapshotRevision/);
  assert.match(autosaveSource, /snapshotRevisionIsCurrent\(tab, revisionPort\)/);
  assert.doesNotMatch(autosaveSource, /RevisionByTabRef/);
});

test("autosave never queues an old target while Save As is pending", () => {
  const start = persistenceControllerSource.indexOf("const runRecoveryAutosave = async");
  const end = persistenceControllerSource.indexOf("const flushDirtyWorkspaceTabs = async", start);
  const autosaveSource = persistenceControllerSource.slice(start, end);
  assert.match(autosaveSource, /selectAutosaveSnapshotTabs\([\s\S]*saveQueuePort/);
  assert.match(autosaveSource, /saveQueuePort\.hasPending\(tab\.id\)/);
  assert.match(autosaveSource, /sourcePath: tab\.path \|\| ""/);
  assert.match(autosaveSource, /targetUnchanged/);
  assert.match(autosaveSource, /appliedUpdates\.set\(tab\.id, update\)/);
  assert.match(autosaveSource, /appliedUpdates\.forEach\(\(update, tabId\)/);
});
