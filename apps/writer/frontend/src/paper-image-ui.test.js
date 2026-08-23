import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { readAppStylesSync } from "./style-test-utils.js";

const paperNodes = fs.readFileSync(new URL("./editor/paper-nodes.jsx", import.meta.url), "utf8");
const previewDialog = fs.readFileSync(new URL("./editor/ImagePreviewDialog.jsx", import.meta.url), "utf8");
const styles = readAppStylesSync();

test("paper image titles use derived document numbering instead of a live CSS counter", () => {
  assert.match(paperNodes, /getPaperDerivedState\(activeEditor\)\.imageItems/);
  assert.match(paperNodes, /data-image-number=\{imageNumber\}/);
  assert.match(paperNodes, />图\{imageNumber\}\. <\/span>/);
  assert.doesNotMatch(styles, /\.paper-image-caption-prefix::before\s*,?\s*\{[^}]*counter\(paper-figure\)/s);
  assert.match(styles, /\.paper-image-figure figcaption::before\s*\{\s*content: "图" counter\(paper-figure\)/);
});

test("paper image toolbar keeps a four hundred millisecond pointer bridge", () => {
  assert.match(paperNodes, /window\.setTimeout\(\(\) => \{[\s\S]*setToolsOpen\(false\);[\s\S]*\}, 400\)/);
  assert.match(paperNodes, /onPointerEnter=\{cancelToolsClose\}/);
  assert.match(paperNodes, /onPointerLeave=\{scheduleToolsClose\}/);
  assert.match(styles, /\.paper-image-figure\.image-tools-open \.image-size-tools/);
});

test("paper images expose an accessible single-click preview with native copy feedback", () => {
  assert.match(paperNodes, /onClick=\{openPreview\}/);
  assert.doesNotMatch(paperNodes, /onDoubleClick=\{openPreview\}/);
  assert.match(paperNodes, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(paperNodes, /<ImagePreviewDialog/);
  assert.match(previewDialog, /useModalFocusTrap\(true, dialogRef, closeButtonRef, returnFocusRef\)/);
  assert.match(previewDialog, /bridge\.copyImageToClipboard\(\{ \.\.\.point, src \}\)/);
  assert.match(previewDialog, /Ctrl \+ 滚轮可缩放/);
});
