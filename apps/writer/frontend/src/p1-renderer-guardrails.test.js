import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("./styles.css", import.meta.url), "utf8");
const structureInspectorSource = await readFile(new URL("./StructureInspector.jsx", import.meta.url), "utf8");
const uiInteractionsSource = await readFile(new URL("./ui-interactions.js", import.meta.url), "utf8");

function between(startMarker, endMarker, fromIndex = 0) {
  const start = appSource.indexOf(startMarker, fromIndex);
  const end = appSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return appSource.slice(start, end);
}

test("exports freeze an explicit pane and use that pane for every output format", () => {
  const openExport = between("const handleOpenExportDialog = useCallback", "const handleCloseExportDialog");
  assert.match(openExport, /const pane = splitPaneActive \? "right" : "main"/);
  assert.match(openExport, /const tabId = splitPaneActive \? rightSplitTabIdRef\.current : activeTabIdRef\.current/);
  assert.match(openExport, /setExportTarget\(\{\s*pane,\s*tabId,/);

  const resolveExport = between("const resolveExportTarget = useCallback", "useEffect(() => {\n    const handleKeyDown", appSource.indexOf("const handleOpenExportDialog"));
  assert.match(resolveExport, /exportTarget\.pane === "right"/);
  assert.match(resolveExport, /getRightSplitSaveDocument\(\)/);
  assert.match(resolveExport, /canvas: rightCanvasRef\.current/);
  assert.match(resolveExport, /getSaveDocument\(\)/);
  assert.match(resolveExport, /canvas: mainCanvasRef\.current/);

  const handlers = between("const handleExportPdf = useCallback", "const handleInsertImage");
  assert.equal((handlers.match(/resolveExportTarget\(\)/g) || []).length, 3);
  assert.match(handlers, /target\.canvas\?\.querySelector\("\.paper-sheet"\)/);
  assert.match(handlers, /prepareImageExportRects\(targetCanvas\.querySelector\("\.paper-sheet"\)\)/);
  assert.doesNotMatch(handlers, /setDocumentState\(nextDocument\)/);

  assert.match(cssSource, /\.desktop-shell\.print-mode\.export-main-pane \.right-split-pane/);
  assert.match(cssSource, /\.desktop-shell\.print-mode\.export-right-pane \.paper-workspace > \.canvas/);
  assert.match(cssSource, /\.desktop-shell\.print-mode\.export-right-pane \.right-split-pane/);
});

test("read-only documents lock both editors, metadata and top-level mutation controls", () => {
  assert.match(appSource, /editor\.setEditable\(!activeTabReadOnly/);
  assert.match(appSource, /rightSplitEditor\.setEditable\(!rightSplitReadOnly\)/);
  assert.match(appSource, /function PageArticle\([\s\S]*readOnly = false/);
  assert.match(appSource, /className="paper-title-input"[\s\S]*readOnly=\{readOnly\}/);
  assert.match(appSource, /className="paper-author-input"[\s\S]*readOnly=\{readOnly\}/);
  assert.match(appSource, /className="paper-date-input"[\s\S]*readOnly=\{readOnly\}/);
  assert.match(appSource, /editorLocked=\{activeWorkReadOnly \|\|/);
  assert.match(appSource, /documentReadOnly=\{!activeWorkEditor \|\| activeWorkReadOnly\}/);
  assert.match(appSource, /label="保存"[\s\S]*disabled=\{documentReadOnly\}/);
  assert.match(appSource, /const updateRightSplitDocument = useCallback\(\(patch\) => \{\s*if \(rightSplitReadOnly\) return;/);
  assert.match(appSource, /const aiModeTriggerDisabled = aiReadOnly && !aiMode/);
  assert.match(appSource, /disabled=\{aiModeTriggerDisabled\}/);
  assert.match(appSource, /aiReadOnly=\{activeTabReadOnly\}/);

  const aiStateUpdate = between("const updateDocumentAiStateForKey = useCallback", "const updateActiveDocumentAiState");
  assert.match(aiStateUpdate, /targetTab\.readOnly \|\| documentStateRef\.current\?\._readOnlyFutureSchema/);
  assert.match(aiStateUpdate, /targetTab\.readOnly \|\| targetTab\.document\?\._readOnlyFutureSchema/);

  assert.match(appSource, /referenceProps=\{\{[\s\S]*readOnly: activeWorkReadOnly/);
  assert.match(structureInspectorSource, /readOnly = false/);
  assert.match(structureInspectorSource, /\{!readOnly && onAddCitationSource \?/);
  assert.match(structureInspectorSource, /\{!readOnly && onDeleteFootnote \?/);
  assert.match(structureInspectorSource, /\{!readOnly && onDeleteCitationSource \?/);
});

test("focus selects the canvas pane and modal dialogs isolate background shortcuts", () => {
  const canvas = between("function PaperCanvas({", "function DocumentTabs");
  assert.match(canvas, /onFocusCapture=\{onActivate\}/);
  assert.match(appSource, /onFocus: \(\) => setActivePane\("main"\)/);
  assert.match(appSource, /onFocus: \(\) => setActivePane\("right"\)/);

  const shortcuts = between("const handleOpenExportDialog = useCallback", "const handleExportPdf = useCallback");
  assert.match(shortcuts, /if \(isGlobalShortcutBlocked\(event\)\) return;/);
  assert.match(uiInteractionsSource, /export function isGlobalShortcutBlocked\(/);
  assert.match(uiInteractionsSource, /export function useModalFocusTrap\(/);
  assert.match(appSource, /useModalFocusTrap\(open, dialogRef, closeButtonRef\)/);
  assert.match(appSource, /useModalFocusTrap\(open, dialogRef, firstFormatRef, returnFocusRef\)/);
  assert.match(appSource, /useModalFocusTrap\(Boolean\(dialog\), dialogRef/);
});
