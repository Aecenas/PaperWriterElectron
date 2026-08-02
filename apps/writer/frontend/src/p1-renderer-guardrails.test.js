import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createExportExecutionActions,
  openExportDialog,
} from "./controllers/export.js";
import { readAppStyles } from "./style-test-utils.js";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const exportControllerSource = await readFile(new URL("./controllers/export.js", import.meta.url), "utf8");
const professionalDocxRendererSource = await readFile(
  new URL("./export/professional-docx-renders.js", import.meta.url),
  "utf8",
);
const topNavSource = await readFile(new URL("./app-shell/TopNav.jsx", import.meta.url), "utf8");
const helpCenterSource = await readFile(new URL("./app-shell/HelpCenter.jsx", import.meta.url), "utf8");
const appDialogsSource = await readFile(new URL("./app-shell/AppDialogs.jsx", import.meta.url), "utf8");
const aiDocumentPortSource = await readFile(new URL("./document-workspace/ai-document-port.js", import.meta.url), "utf8");
const pageArticleSource = await readFile(new URL("./editor/PageArticle.jsx", import.meta.url), "utf8");
const paperCanvasSource = await readFile(new URL("./editor/PaperCanvas.jsx", import.meta.url), "utf8");
const exportDialogSource = await readFile(new URL("./export/ExportDialog.jsx", import.meta.url), "utf8");
const cssSource = await readAppStyles();
const structureInspectorSource = await readFile(new URL("./StructureInspector.jsx", import.meta.url), "utf8");
const uiInteractionsSource = await readFile(new URL("./ui-interactions.js", import.meta.url), "utf8");

function between(startMarker, endMarker, fromIndex = 0) {
  const normalizedSource = appSource.replace(/\r\n/g, "\n");
  const start = normalizedSource.indexOf(startMarker, fromIndex);
  const end = normalizedSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return normalizedSource.slice(start, end);
}

test("exports freeze an explicit pane and use that pane for every output format", () => {
  const targets = [];
  const dialogStates = [];
  openExportDialog({
    activeTabIdRef: { current: "main-tab" },
    activeWorkDocument: { title: "实时右侧信笺" },
    activeWorkEditor: {},
    rightSplitTabIdRef: { current: "right-tab" },
    setExportDialogOpen: (open) => dialogStates.push(open),
    setExportTarget: (target) => targets.push(target),
    showStatus: () => assert.fail("valid export target must not warn"),
    splitPaneActive: true,
  });
  assert.deepEqual(targets, [{
    pane: "right",
    tabId: "right-tab",
    title: "实时右侧信笺",
  }]);
  assert.deepEqual(dialogStates, [true]);

  const resolveExport = between("const resolveExportTarget = useCallback", "useEffect(() => {\n    const handleKeyDown");
  assert.match(resolveExport, /exportTarget\.pane === "right"/);
  assert.match(resolveExport, /getRightSplitSaveDocument\(\)/);
  assert.match(resolveExport, /canvas: rightCanvasRef\.current/);
  assert.match(resolveExport, /getSaveDocument\(\)/);
  assert.match(resolveExport, /canvas: mainCanvasRef\.current/);

  assert.equal((exportControllerSource.match(/resolveExportTarget\(\)/g) || []).length, 3);
  assert.match(exportControllerSource, /target\.canvas\?\.querySelector\("\.paper-sheet"\)/);
  assert.match(exportControllerSource, /capturePageMapSnapshot = capturePageMapExportSnapshot/);
  assert.match(exportControllerSource, /capturePageMap\(targetCanvas\)/);
  assert.match(exportControllerSource, /pageMapSnapshot[\s\S]*?preparePageMapRects\(pageMapSnapshot\)[\s\S]*?: await prepareImageRects\(targetCanvas\.querySelector\("\.paper-sheet"\)\)/);
  assert.doesNotMatch(exportControllerSource, /setDocumentState\(nextDocument\)/);

  assert.match(cssSource, /\.desktop-shell\.print-mode\.export-main-pane \.right-split-pane/);
  assert.match(cssSource, /\.desktop-shell\.print-mode\.export-right-pane \.paper-workspace > \.canvas/);
  assert.match(cssSource, /\.desktop-shell\.print-mode\.export-right-pane \.right-split-pane/);
});

test("export executions retain live snapshots, render staging, and finally cleanup", async () => {
  const calls = [];
  const bodyClasses = new Set();
  const sheet = { id: "paper-sheet" };
  const canvas = {
    scrollTop: 42,
    scrollLeft: 7,
    querySelector: (selector) => {
      assert.equal(selector, ".paper-sheet");
      return sheet;
    },
  };
  const sourceDocument = {
    title: "实时文档",
    html: '<p>公式 <span data-type="inline-math" data-latex="x^2"></span></p>',
    comments: [{ id: "comment-1" }],
    aiState: { optimize: { output: "private" } },
  };
  const editablePayloads = [];
  const professionalRenderCalls = [];
  let resolveCount = 0;
  const actions = createExportExecutionActions({
    applyPrintBackground: (targetSheet) => {
      calls.push(["print-background", targetSheet]);
      return () => calls.push(["print-background-restore"]);
    },
    cleanupImageStage: () => calls.push(["image-stage-cleanup"]),
    capturePageMapSnapshot: () => null,
    exportBridge: {
      exportPdf: async (...args) => {
        calls.push(["pdf", ...args]);
        return { canceled: false };
      },
      exportPageImages: async (...args) => {
        calls.push(["images", ...args]);
        return { canceled: false, count: 2 };
      },
      exportEditable: async (document, ...args) => {
        editablePayloads.push([document, ...args]);
        calls.push(["editable", ...args]);
        return { canceled: false, warnings: [] };
      },
    },
    prepareProfessionalDocxHtml: async (input) => {
      professionalRenderCalls.push(input);
      return {
        renderedHtml: '<p>公式 <img src="data:image/png;base64,AA==" alt="TeX：x^2"></p>',
      };
    },
    prepareImageRects: async (targetSheet) => {
      calls.push(["prepare-images", targetSheet]);
      return [{ x: 0 }, { x: 1 }];
    },
    readCanvasScroll: () => ({ top: 42, left: 7 }),
    resolveExportTarget: () => {
      resolveCount += 1;
      return { pane: "right", document: sourceDocument, canvas };
    },
    restoreCanvasScroll: (targetCanvas, scroll) => calls.push(["scroll-restore", targetCanvas, scroll]),
    setExportRenderPane: (pane) => calls.push(["render-pane", pane]),
    setImageExportMode: (active) => calls.push(["image-mode", active]),
    setPrintMode: (active) => calls.push(["print-mode", active]),
    showStatus: (...args) => calls.push(["status", ...args]),
    windowObject: {
      document: {
        body: {
          classList: {
            add: (name) => bodyClasses.add(name),
            remove: (name) => bodyClasses.delete(name),
          },
        },
      },
      requestAnimationFrame: (callback) => {
        calls.push(["raf"]);
        callback();
        return calls.length;
      },
      scrollTo: (...args) => calls.push(["window-scroll", ...args]),
    },
  });

  await actions.handleExportPdf("letter.pdf");
  assert.ok(calls.some(([kind]) => kind === "print-background"));
  assert.ok(calls.some(([kind]) => kind === "print-background-restore"));
  assert.deepEqual(calls.filter(([kind]) => kind === "print-mode").map(([, value]) => value), [true, false]);

  await actions.handleExportImages("images");
  assert.equal(canvas.scrollTop, 0);
  assert.equal(canvas.scrollLeft, 0);
  assert.equal(bodyClasses.has("image-export-body"), false);
  assert.ok(calls.some(([kind]) => kind === "scroll-restore"));
  assert.ok(calls.some(([kind]) => kind === "image-stage-cleanup"));
  assert.deepEqual(calls.filter(([kind]) => kind === "image-mode").map(([, value]) => value), [true, false]);

  await actions.handleExportEditable("docx", "letter.docx");
  await actions.handleExportEditable("html", "letter.html");
  assert.equal(resolveCount, 4);
  assert.equal(professionalRenderCalls.length, 2);
  assert.equal(professionalRenderCalls[0].canvas, canvas);
  assert.equal(professionalRenderCalls[0].html, sourceDocument.html);
  assert.equal(editablePayloads[0][0].title, sourceDocument.title);
  assert.equal(editablePayloads[0][0].html, sourceDocument.html);
  assert.deepEqual(editablePayloads[0][0].comments, []);
  assert.notDeepEqual(editablePayloads[0][0].aiState, sourceDocument.aiState);
  assert.deepEqual(editablePayloads[0].slice(1, 3), ["docx", "letter.docx"]);
  assert.equal(
    editablePayloads[0][3],
    '<p>公式 <img src="data:image/png;base64,AA==" alt="TeX：x^2"></p>',
  );
  assert.deepEqual(editablePayloads[1].slice(1, 3), ["html", "letter.html"]);
  assert.equal(
    editablePayloads[1][3],
    '<p>公式 <img src="data:image/png;base64,AA==" alt="TeX：x^2"></p>',
  );
  assert.deepEqual(sourceDocument.comments, [{ id: "comment-1" }]);
});

test("DOCX formula rasterization is lazy, untainted, bounded, and aborts before IPC on failure", async () => {
  assert.match(professionalDocxRendererSource, /await import\("html2canvas"\)/);
  assert.match(professionalDocxRendererSource, /allowTaint: false/);
  assert.match(professionalDocxRendererSource, /foreignObjectRendering: false/);
  assert.match(professionalDocxRendererSource, /useCORS: false/);
  assert.match(professionalDocxRendererSource, /logging: false/);
  assert.match(professionalDocxRendererSource, /removeContainer: true/);
  assert.match(professionalDocxRendererSource, /maxCanvasPixels/);
  assert.match(professionalDocxRendererSource, /公式栅格化结果为空或完全透明/);
  assert.match(professionalDocxRendererSource, /return expectedIdentity \? null : fallback/);

  const sourceDocument = {
    html: '<div data-type="block-math" data-latex="x"></div>',
    comments: [{ id: "keep" }],
  };
  const before = structuredClone(sourceDocument);
  let bridgeCalls = 0;
  const actions = createExportExecutionActions({
    exportBridge: {
      exportEditable: async () => {
        bridgeCalls += 1;
        return { canceled: false };
      },
    },
    prepareProfessionalDocxHtml: async () => {
      throw new Error("公式栅格化失败");
    },
    resolveExportTarget: () => ({
      canvas: {},
      document: sourceDocument,
      pane: "main",
    }),
    showStatus: () => {},
  });
  await assert.rejects(
    actions.handleExportEditable("docx", "letter.docx"),
    /公式栅格化失败/,
  );
  assert.equal(bridgeCalls, 0);
  assert.deepEqual(sourceDocument, before);
});

test("read-only documents lock both editors, metadata and top-level mutation controls", () => {
  assert.match(appSource, /editor\.setEditable\(!activeTabReadOnly/);
  assert.match(appSource, /rightSplitEditor\.setEditable\(!rightSplitReadOnly\)/);
  assert.match(pageArticleSource, /function PageArticle\([\s\S]*readOnly = false/);
  assert.match(pageArticleSource, /className="paper-title-input"[\s\S]*readOnly=\{readOnly\}/);
  assert.match(pageArticleSource, /className="paper-author-input"[\s\S]*readOnly=\{readOnly\}/);
  assert.match(pageArticleSource, /className="paper-date-input"[\s\S]*readOnly=\{readOnly\}/);
  assert.match(appSource, /editorLocked=\{activeWorkReadOnly \|\|/);
  assert.match(appSource, /documentReadOnly=\{!activeWorkEditor \|\| activeWorkReadOnly\}/);
  assert.match(topNavSource, /label="保存"[\s\S]*disabled=\{documentReadOnly\}/);
  assert.match(appSource, /const updateRightSplitDocument = useCallback\(\(patch\) => \{\s*if \(rightSplitReadOnly\) return;/);
  assert.match(topNavSource, /const aiModeTriggerDisabled = aiReadOnly && !aiMode/);
  assert.match(topNavSource, /disabled=\{aiModeTriggerDisabled\}/);
  assert.match(appSource, /aiReadOnly=\{activeTabReadOnly\}/);

  assert.match(appSource, /useAiDocumentPort\(\{/);
  assert.doesNotMatch(appSource, /const updateDocumentAiStateForKey = useCallback/);
  assert.match(aiDocumentPortSource, /activeSnapshot\.readOnly/);
  assert.match(aiDocumentPortSource, /targetTab\.readOnly \|\| targetTab\.document\?\._readOnlyFutureSchema/);

  assert.match(appSource, /referenceProps=\{\{[\s\S]*readOnly: activeWorkReadOnly/);
  assert.match(structureInspectorSource, /readOnly = false/);
  assert.match(structureInspectorSource, /\{!readOnly && onDeleteFootnote \?/);
  assert.match(structureInspectorSource, /\{!readOnly && onDelete \?/);
  assert.match(structureInspectorSource, /activeMode === "bibliography"[\s\S]*?<CitationLibraryPanel/);
});

test("focus selects the canvas pane and modal dialogs isolate background shortcuts", () => {
  assert.match(paperCanvasSource, /onFocusCapture=\{onActivate\}/);
  assert.match(appSource, /onFocus: \(\) => setActivePane\("main"\)/);
  assert.match(appSource, /onFocus: \(\) => setActivePane\("right"\)/);

  const shortcuts = between("const resolveExportTarget = useCallback", "useExportExecutionActions({");
  assert.match(shortcuts, /if \(isGlobalShortcutBlocked\(event\)\) return;/);
  assert.match(uiInteractionsSource, /export function isGlobalShortcutBlocked\(/);
  assert.match(uiInteractionsSource, /export function useModalFocusTrap\(/);
  assert.match(helpCenterSource, /useModalFocusTrap\(open, dialogRef, closeButtonRef\)/);
  assert.match(exportDialogSource, /useModalFocusTrap\(open, dialogRef, firstFormatRef, returnFocusRef\)/);
  assert.match(appDialogsSource, /useModalFocusTrap\(Boolean\(dialog\), dialogRef/);
});
