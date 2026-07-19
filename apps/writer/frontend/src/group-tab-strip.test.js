import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./GroupTabStrip.jsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("top navigation puts exporting the letter before importing a document", () => {
  assert.match(app, /<MenuButton\s+icon=\{Download\}\s+label="导出"/);
  assert.doesNotMatch(app, /<MenuButton icon=\{ArrowUpDown\} label="交换"/);
  assert.match(app, /label="导入文档"/);
  assert.match(app, /label="导出信笺"/);
  assert.ok(app.indexOf('label="导出信笺"') < app.indexOf('label="导入文档"'));
});

test("group tab strip supports scrolling, mixed research tabs and document moves", () => {
  assert.match(source, /group-tab-list/);
  assert.match(source, /data-view-kind/);
  assert.match(source, /onReorder/);
  assert.match(source, /onMoveDocument/);
  assert.match(source, /researchIcon/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /scrollGroupTabListOnWheel/);
  assert.match(source, /onWheel=/);
  assert.match(styles, /\.group-tab\s*\{[^}]*flex:\s*1 1 156px[^}]*min-width:\s*96px/s);
});

test("group tab strip blocks unsupported moves without hiding the action", () => {
  assert.match(source, /canMoveDocument/);
  assert.match(source, /左侧编辑组至少需要保留一个信笺/);
  assert.match(source, /disabled=\{!moveAllowed\}/);
});

test("group tab strip opens a separate template picker from the context menu", () => {
  assert.match(source, /onOpenTemplatePicker/);
  assert.match(source, /<LayoutTemplate size=\{15\}/);
  assert.match(source, /<span>修改模板<\/span>/);
  assert.match(
    source,
    /onOpenTemplatePicker\?\.\(contextView, returnFocusElement\);/,
  );
  assert.match(source, /data-view-id=.*CSS\.escape\(contextView\.viewId\)/s);
  assert.doesNotMatch(source, /templateOptions|onApplyTemplate/);
  assert.doesNotMatch(source, /role="menuitemradio"|group-tab-template-/);
});

test("group tab context menu stays keyboard-visible without embedded template-list styles", () => {
  assert.match(source, /GROUP_TAB_MENU_WIDTH\s*=\s*160/);
  assert.match(styles, /\.group-tab-menu\s*\{[^}]*width:\s*min\(160px/s);
  assert.match(styles, /\.group-tab-menu button:focus-visible\s*\{[^}]*outline:/s);
  assert.doesNotMatch(styles, /\.group-tab-template-|--group-tab-template-swatch/);
});
