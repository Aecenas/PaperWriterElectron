import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const structureInspectorUrl = new URL("./StructureInspector.jsx", import.meta.url);

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

test("the references sidebar exposes jump, edit, delete and usage status controls", async () => {
  const jsx = await structureInspectorSource();

  assert.match(jsx, /onJumpFootnote/);
  assert.match(jsx, /onEditFootnote/);
  assert.match(jsx, /onDeleteFootnote/);
  assert.match(jsx, /onAddCitationSource/);
  assert.match(jsx, /onEditCitationSource/);
  assert.match(jsx, /onDeleteCitationSource/);
  assert.match(jsx, /onJumpCitationSource/);
  assert.match(jsx, /isUsed \? `已引用/);
  assert.match(jsx, /未使用 ·/);
  assert.match(jsx, /参考文献来源/);
  assert.doesNotMatch(jsx, /bibliographyPresent/);
  assert.doesNotMatch(jsx, /onJumpBibliography/);
});

test("the references sidebar uses collapsible groups, compact actions and ordered rows", async () => {
  const jsx = await structureInspectorSource();

  assert.match(jsx, /footnotesExpanded/);
  assert.match(jsx, /sourcesExpanded/);
  assert.match(jsx, /aria-expanded=\{expanded\}/);
  assert.match(jsx, /aria-label="新增参考文献来源"/);
  assert.doesNotMatch(jsx, />\+ 新增来源</);
  assert.match(jsx, /sourceIndex \+ 1/);
  assert.match(jsx, /structure-order-number/);
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
