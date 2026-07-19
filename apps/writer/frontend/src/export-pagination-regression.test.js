import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("./styles.css", import.meta.url), "utf8");
const bridgeSource = await readFile(new URL("./bridge.js", import.meta.url), "utf8");

test("image export measures the same hidden clone that Electron captures", () => {
  const start = appSource.indexOf("function prepareImageExportRects");
  const end = appSource.indexOf("export default function App", start);
  const source = appSource.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(source.indexOf("stage.append(clone)") < source.indexOf("getFlowExportSegments(clone)"));
  assert.doesNotMatch(source, /getFlowExportSegments\(sheet\)/);
  assert.match(source, /const cloneRect = clone\.getBoundingClientRect\(\)/);
});

test("PDF print mode hides current workspace chrome and paints the complete page background", () => {
  assert.match(stylesSource, /\.desktop-shell\.print-mode \.group-tabs,/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode \.editor-groups-top-strip,/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode \.right-split-pane,/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode \{[^}]*--print-paper-repeat-bg/s);
  assert.match(stylesSource, /@media print[\s\S]*?html,[\s\S]*?#root \{[^}]*--print-paper-repeat-bg/s);
  assert.match(appSource, /function applyPrintPaperBackground[\s\S]*?--paper-repeat-bg/);
  assert.match(appSource, /function applyPrintPaperBackground[\s\S]*?getFlowExportSegments\(sheet\)[\s\S]*?--print-sheet-min-height/);
  assert.match(stylesSource, /min-height: var\(--print-sheet-min-height, 1123px\)/);
  assert.match(appSource, /const handleExportPdf[\s\S]*?applyPrintPaperBackground\(printSheet\)[\s\S]*?restorePrintPaperBackground\(\)/);
});

test("browser editable exports strip the visible page-break label", () => {
  assert.match(bridgeSource, /function canonicalizeBrowserExportPageBreaks/);
  assert.match(bridgeSource, /canonicalizeBrowserExportPageBreaks\(sanitizeBrowserImportedHtml/);
});
