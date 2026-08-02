import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { readAppStylesSync } from "./style-test-utils.js";

const source = fs.readFileSync(new URL("./GroupTabStrip.jsx", import.meta.url), "utf8");
const contextMenuSource = fs.readFileSync(new URL("./DocumentContextMenu.jsx", import.meta.url), "utf8");
const styles = readAppStylesSync();
const topNav = fs.readFileSync(new URL("./app-shell/TopNav.jsx", import.meta.url), "utf8");

test("top navigation groups export, import, and migration under an undivided interchange menu", () => {
  assert.match(topNav, /<MenuButton\s+icon=\{Download\}\s+label="出入"/);
  assert.doesNotMatch(topNav, /<MenuButton icon=\{ArrowUpDown\} label="交换"/);
  assert.match(topNav, /label="导入文档"/);
  assert.match(topNav, /label="导出信笺"/);
  assert.ok(topNav.indexOf('label="导出信笺"') < topNav.indexOf('label="导入文档"'));
  const interchangeMenu = topNav.match(/<MenuButton\s+icon=\{Download\}\s+label="出入"[\s\S]*?<\/MenuButton>/)?.[0] || "";
  assert.doesNotMatch(interchangeMenu, /<MenuDivider\s*\/>/);
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
  assert.match(source, /moveAllowed=\{moveAllowed\}/);
  assert.match(contextMenuSource, /disabled=\{!moveAllowed\}/);
  assert.match(contextMenuSource, /当前页面视图不支持开启右侧编辑组/);
});

test("group tab strip opens a separate template picker from the context menu", () => {
  assert.match(source, /onOpenTemplatePicker/);
  assert.match(contextMenuSource, /<LayoutTemplate size=\{16\}/);
  assert.match(contextMenuSource, /<span>修改模板<\/span>/);
  assert.match(
    source,
    /onOpenTemplatePicker\?\.\(contextView, returnFocusElement\);/,
  );
  assert.match(source, /data-view-id=.*CSS\.escape\(contextView\.viewId\)/s);
  assert.doesNotMatch(source, /templateOptions|onApplyTemplate/);
  assert.doesNotMatch(source, /role="menuitemradio"|group-tab-template-/);
});

test("document context menu stays keyboard-visible and shares page-view controls", () => {
  assert.match(contextMenuSource, /MENU_WIDTH\s*=\s*184/);
  assert.match(contextMenuSource, /className={`document-context-view-submenu/);
  assert.match(contextMenuSource, /aria-haspopup="menu"/);
  assert.match(contextMenuSource, /role="menuitemradio"/);
  assert.match(contextMenuSource, /onClick=\{\(\) => openPageViewMenu\(false\)\}/);
  assert.doesNotMatch(contextMenuSource, /onPointerLeave=\{\(\) => setPageViewOpen\(false\)\}/);
  assert.match(contextMenuSource, /onDismissRef\.current\?\.\(\)/);
  assert.match(contextMenuSource, /\}, \[menu\]\);/);
  assert.match(contextMenuSource, /版本历史/);
  assert.match(styles, /\.document-context-menu\s*\{[^}]*width:\s*184px/s);
  assert.match(styles, /\.document-context-view-submenu\s*\{[^}]*width:\s*196px/s);
  assert.match(styles, /\.document-context-view-submenu::before\s*\{[^}]*left:\s*-7px[^}]*width:\s*7px/s);
  assert.match(styles, /\.document-context-view-submenu\.opens-left::before\s*\{[^}]*right:\s*-7px[^}]*left:\s*auto/s);
  assert.match(styles, /\.document-context-menu > button:focus-visible[\s\S]*?box-shadow:/s);
  assert.doesNotMatch(styles, /\.group-tab-template-|--group-tab-template-swatch/);
});

test("tab history remembers the invoking tab for modal focus return", () => {
  assert.match(
    source,
    /onOpenHistory\?\.\(contextView\.tabId, returnFocusElement\);/,
  );
  assert.match(
    source,
    /onOpenHistory=\{contextView\.kind === "document"[\s\S]*data-view-id=.*CSS\.escape\(contextView\.viewId\)/,
  );
});
