import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalizeBrowserExportPageBreaks } from "./browser-bridge/document-export.js";
import { readAppStyles } from "./style-test-utils.js";

const executionSource = await readFile(new URL("./controllers/export.js", import.meta.url), "utf8");
const presentationSource = await readFile(new URL("./export/presentation.js", import.meta.url), "utf8");
const stylesSource = await readAppStyles();

test("image export measures the same hidden clone that Electron captures", () => {
  const start = presentationSource.indexOf("function prepareImageExportRects");
  const source = presentationSource.slice(start);
  assert.ok(start >= 0);
  assert.ok(source.indexOf("stage.append(clone)") < source.indexOf("getFlowExportSegments(clone)"));
  assert.ok(source.indexOf("await waitForImageExportAssets(clone)") < source.indexOf("getFlowExportSegments(clone)"));
  assert.doesNotMatch(source, /getFlowExportSegments\(sheet\)/);
  assert.match(source, /const cloneRect = clone\.getBoundingClientRect\(\)/);
  assert.match(executionSource, /const pageRects = await prepareImageRects\(targetCanvas\.querySelector\("\.paper-sheet"\)\)/);
});

test("PDF print mode hides current workspace chrome and paints the complete page background", () => {
  assert.match(stylesSource, /\.desktop-shell\.print-mode \.group-tabs,/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode \.editor-groups-top-strip,/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode\.export-main-pane \.right-split-pane,/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode\.export-right-pane \.paper-workspace > \.canvas/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode\.export-right-pane \.right-split-pane/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode \{[^}]*--print-paper-repeat-bg/s);
  assert.match(stylesSource, /@media print[\s\S]*?html,[\s\S]*?#root \{[^}]*--print-paper-repeat-bg/s);
  assert.match(presentationSource, /function applyPrintPaperBackground[\s\S]*?--paper-repeat-bg/);
  assert.match(presentationSource, /function applyPrintPaperBackground[\s\S]*?getFlowExportSegments\(sheet\)[\s\S]*?--print-sheet-min-height/);
  assert.match(stylesSource, /min-height: var\(--print-sheet-min-height, 1123px\)/);
  assert.match(executionSource, /const handleExportPdf[\s\S]*?applyPrintBackground\(printSheet\)[\s\S]*?restorePrintPaperBackground\(\)/);
});

test("browser editable exports strip the visible page-break label", () => {
  const marker = '<div data-type="paper-page-break"></div>';
  assert.equal(
    canonicalizeBrowserExportPageBreaks('<div class="page-break" data-type="paper-page-break"><span>分页符</span></div>'),
    marker,
  );
  assert.equal(
    canonicalizeBrowserExportPageBreaks('<hr aria-label="分页符" data-type="paper-page-break">'),
    marker,
  );
});
