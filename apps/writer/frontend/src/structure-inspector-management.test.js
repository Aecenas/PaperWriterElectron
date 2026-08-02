import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const structureInspectorUrl = new URL("./StructureInspector.jsx", import.meta.url);
const appUrl = new URL("./App.jsx", import.meta.url);

async function structureInspectorSource() {
  return readFile(structureInspectorUrl, "utf8");
}

test("the references sidebar manages knowledge records without inserting body nodes", async () => {
  const jsx = await structureInspectorSource();

  assert.doesNotMatch(jsx, /onAddFootnote/);
  assert.doesNotMatch(jsx, /onInsertCitation/);
  assert.doesNotMatch(jsx, /onInsertBibliography/);
  assert.doesNotMatch(jsx, />\s*新建\s*</);
  assert.doesNotMatch(jsx, /插入自动参考文献块/);
  assert.match(jsx, /请从顶部“元素”菜单添加/);
});

test("the 脚注 sidebar contains only current-document footnotes", async () => {
  const jsx = await structureInspectorSource();
  const footnotePane = jsx.slice(jsx.indexOf("export function ReferencesPane"), jsx.indexOf("function useEditorBookmarks"));

  assert.match(jsx, /\{ id: "references", label: "脚注"/);
  assert.match(footnotePane, /onJumpFootnote/);
  assert.match(footnotePane, /onEditFootnote/);
  assert.match(footnotePane, /onDeleteFootnote/);
  assert.doesNotMatch(footnotePane, /onJumpCitationSource/);
  assert.doesNotMatch(footnotePane, /正文引文/);
  assert.doesNotMatch(footnotePane, /citationOrder/);
  assert.doesNotMatch(footnotePane, /onAddCitationSource/);
  assert.doesNotMatch(footnotePane, /onDeleteCitationSource/);
});

test("the 文献 sidebar owns manual source creation, editing, and deletion", async () => {
  const [app, panel] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(new URL("./professional-content/CitationLibraryPanel.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(app, /citationLibraryProps=\{\{[\s\S]*?onAddSource:\s*handleAddCitationSource/);
  assert.match(app, /citationLibraryProps=\{\{[\s\S]*?onEditSource:\s*handleEditCitationSource/);
  assert.match(app, /citationLibraryProps=\{\{[\s\S]*?onDeleteSource:\s*handleDeleteCitationSource/);
  assert.match(app, /citationLibraryProps=\{\{[\s\S]*?onCopyToPublic:\s*handleCopyCitationToPublic/);
  assert.match(app, /citationLibraryProps=\{\{[\s\S]*?onAttachPublic:\s*handleAttachPublicCitation/);
  assert.match(panel, /引用文献/);
  assert.match(panel, /当前信笺的私域文献目录/);
  assert.match(panel, /onJumpCitationSource/);
});

test("the footnote sidebar remains collapsible without a body-citation group", async () => {
  const jsx = await structureInspectorSource();
  const footnotePane = jsx.slice(jsx.indexOf("export function ReferencesPane"), jsx.indexOf("function useEditorBookmarks"));

  assert.match(footnotePane, /footnotesExpanded/);
  assert.doesNotMatch(footnotePane, /sourcesExpanded/);
  assert.match(jsx, /aria-expanded=\{expanded\}/);
  assert.match(footnotePane, /structure-order-number/);
});

test("the structure inspector exposes a sixth bookmark mode with jump, rename, and delete", async () => {
  const jsx = await structureInspectorSource();

  assert.match(jsx, /\{ id: "bookmarks", label: "书签"/);
  assert.match(jsx, /export function BookmarksPane/);
  assert.match(jsx, /collectBookmarks/);
  assert.match(jsx, /onJump\?\.\(item\)/);
  assert.match(jsx, /onRename\(item\)/);
  assert.match(jsx, /编辑书签名/);
  assert.match(jsx, /onDelete\(item\)/);
  assert.match(jsx, /书签固定在段落左侧，不占用正文位置/);
});

test("multi-paragraph footnotes summarize only the first paragraph with an ellipsis", async () => {
  const jsx = await structureInspectorSource();

  assert.match(jsx, /export function summarizeFootnoteText/);
  assert.match(jsx, /split\(\/\\r\?\\n\//);
  assert.match(jsx, /paragraphs\.length > 1 \? "…"/);
  assert.match(jsx, /summarizeFootnoteText\(footnote\.text\)/);
});

test("the related sidebar uses ordered rows, collapsible groups and persistent usage progress", async () => {
  const jsx = await structureInspectorSource();

  assert.match(jsx, /linksExpanded/);
  assert.match(jsx, /backlinksExpanded/);
  assert.match(jsx, /label="本文关联" count=\{links\.length\}/);
  assert.match(jsx, /label="反向关联" count=\{backlinks\.length\}/);
  assert.match(jsx, /从顶部“元素”菜单插入关联信笺/);
  assert.match(jsx, /关联 \$\{linkIndex \+ 1\}/);
  assert.match(jsx, /反向关联 \$\{linkIndex \+ 1\}/);
  assert.match(jsx, /className="structure-order-number"/);
  assert.match(jsx, /className="structure-related-progress"/);
  assert.match(jsx, /\{progress\.current\}\/\{progress\.total\}/);
  assert.match(jsx, /window\.setTimeout\([\s\S]*10_000/);
  assert.match(jsx, /window\.clearTimeout\(usageProgressTimersRef\.current\.get\(rowKey\)\)/);
  assert.match(jsx, /className="structure-related-jump"/);
  assert.match(jsx, /<LocateFixed size=\{13\}/);
  assert.match(jsx, /onJumpUsage\?\.\(link\)/);
  assert.match(jsx, /jumpToNextUsage\(link, rowKey\)[\s\S]*title="移除关联"/);
  assert.doesNotMatch(jsx, />←<\/button>/);
});
