import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("formula UI provides inline/block editing, live KaTeX preview, numbering, labels, and references", async () => {
  const [source, extension] = await Promise.all([
    read("./professional-content/MathDialogs.jsx"),
    read("./editor/professional-content-extensions.js"),
  ]);

  assert.match(source, /katex\.renderToString/);
  assert.match(source, /output:\s*"htmlAndMathml"/);
  assert.match(source, /MATH_MODES\.map/);
  assert.match(source, /TeX 源码/);
  assert.match(source, /实时预览/);
  assert.match(source, /显示自动编号并允许交叉引用/);
  assert.match(source, /collectEquationTargets/);
  assert.match(source, /insertEquationReference/);
  assert.match(source, /引用编号随正文中的公式顺序自动更新/);
  assert.match(extension, /PAPER_MATH_EDIT_REQUEST_EVENT/);
  assert.match(extension, /onDoubleClick/);
  assert.match(extension, /复制公式引用/);
  assert.match(extension, /删除公式/);
  assert.match(extension, /className:\s*"paper-equation-number"/);
  assert.match(extension, /className:\s*"paper-equation-hover-label"/);
  assert.match(extension, /PaperEquationReferenceNodeView/);
  assert.match(extension, /createElement\(Sigma/);
});

test("Mermaid dialog shares the strict sanitized renderer and keeps source available after errors", async () => {
  const [dialog, extension] = await Promise.all([
    read("./professional-content/MermaidDialog.jsx"),
    read("./editor/professional-content-extensions.js"),
  ]);

  assert.match(dialog, /renderMermaidSafely/);
  assert.match(dialog, /mermaid-source-pane/);
  assert.match(dialog, /mermaid-preview-pane/);
  assert.match(dialog, /源码没有被清空/);
  assert.match(dialog, /保存源码/);
  assert.match(dialog, /MERMAID_WIDTH_OPTIONS\.map/);
  assert.match(dialog, /铺满程度/);
  assert.doesNotMatch(dialog, /strict · 已消毒 SVG/);
  assert.match(extension, /export async function renderMermaidSafely/);
  assert.match(extension, /securityLevel:\s*"strict"/);
  assert.match(extension, /DOMPurify\.sanitize/);
  assert.match(extension, /FORBID_TAGS/);
  assert.match(extension, /PAPER_MERMAID_EDIT_REQUEST_EVENT/);
  assert.match(extension, /复制 Mermaid 图引用/);
  assert.match(extension, /编辑 Mermaid 图/);
  assert.match(extension, /删除 Mermaid 图/);
  assert.match(extension, /paper-mermaid-caption/);
  assert.match(extension, /PaperMermaidReferenceNodeView/);
});

test("formula and Mermaid references use compact icon-label pairs without synthetic spacing", async () => {
  const styles = await read("./styles-professional-content.css");
  assert.match(styles, /\.paper-equation-reference\s*\{[^}]*display:\s*inline;/s);
  assert.match(styles, /\.paper-equation-reference-icon\s*\{[^}]*margin:\s*0;/s);
  assert.match(styles, /\.paper-mermaid-reference-icon\s*\{[^}]*margin:\s*0;/s);
  assert.match(styles, /\.paper-mermaid-tools/);
  assert.match(styles, /counter-increment:\s*paper-figure/);
});

test("Mermaid captions follow the shared template figure-title visibility and numbering controls", async () => {
  const [styles, pageArticle, templateDetail, topNav] = await Promise.all([
    read("./styles-professional-content.css"),
    read("./editor/PageArticle.jsx"),
    read("./templates/TemplateDetailView.jsx"),
    read("./app-shell/TopNav.jsx"),
  ]);
  assert.match(topNav, /label="Mermaid 图"/);
  assert.match(pageArticle, /showImageCaptions \? "shows-image-captions" : "hides-image-captions"/);
  assert.match(styles, /\.paper-sheet\.hides-image-captions \.paper-mermaid-caption\s*\{[^}]*display:\s*none;/s);
  assert.match(styles, /\.paper-sheet\.plain-image-captions \.paper-mermaid-caption::before/);
  assert.match(templateDetail, /统一控制图片与 Mermaid 图/);
  assert.match(templateDetail, /图片与 Mermaid 图按正文顺序统一编号/);
});

test("code block panel switches language and wrapping for insertion or the active block", async () => {
  const [panel, commands, extension, styles] = await Promise.all([
    read("./professional-content/CodeBlockPanel.jsx"),
    read("./professional-content/editor-commands.js"),
    read("./editor/professional-content-extensions.js"),
    read("./styles-professional-content.css"),
  ]);

  assert.match(panel, /CODE_LANGUAGES\.map/);
  assert.match(panel, /自动换行/);
  assert.match(panel, /readActiveCodeBlockOptions/);
  assert.match(panel, /applyCodeBlockOptions/);
  assert.match(commands, /updateAttributes\("codeBlock", value\)/);
  assert.match(commands, /setCodeBlock\(value\)/);
  assert.match(commands, /export function insertCodeBlock/);
  assert.match(commands, /codeBlockType\.createAndFill\(value\)/);
  assert.match(commands, /\$from\.after\(1\)/);
  assert.match(extension, /PaperCodeBlockNodeView/);
  assert.match(extension, /paper-code-language-menu/);
  assert.match(extension, /paper-code-line-numbers/);
  assert.match(extension, /删除代码块/);
  assert.match(extension, /MAX_CODE_HIGHLIGHT_CHARS/);
  assert.match(extension, /data-highlight-limited/);
  assert.match(styles, /--paper-code-font-size:\s*13px/);
  assert.match(styles, /\.paper-code-line-numbers\s*\{[^}]*font-size:\s*var\(--paper-code-font-size\)[^}]*line-height:\s*var\(--paper-code-line-height\)/s);
  assert.match(styles, /\.paper-code-shell \.paper-code-block\s*\{[^}]*font-size:\s*var\(--paper-code-font-size\)[^}]*line-height:\s*var\(--paper-code-line-height\)/s);
  assert.match(styles, /\.paper-code-tool\s*\{[^}]*width:\s*30px/s);
  assert.match(styles, /\.paper-code-block \.hljs-keyword/);
  assert.match(styles, /\.paper-code-block \.hljs-string/);
});

test("bookmark primitive persists a stable inline anchor without occupying body width", async () => {
  const [extension, commands, model, styles] = await Promise.all([
    read("./editor/professional-content-extensions.js"),
    read("./professional-content/editor-commands.js"),
    read("./professional-content/model.js"),
    read("./styles-professional-content.css"),
  ]);

  assert.match(extension, /name:\s*"paperBookmark"/);
  const bookmarkExtension = extension.slice(
    extension.indexOf("export const PaperBookmark"),
    extension.indexOf("const equationNumberingPluginKey"),
  );
  assert.match(bookmarkExtension, /selectable:\s*false/);
  assert.match(extension, /handleClick\(view,[\s\S]*?dispatchBookmarkActivation\(view, element\);\s*return true;/);
  assert.match(extension, /insertPaperBookmark/);
  assert.match(extension, /data-type":\s*"paper-bookmark"/);
  assert.match(commands, /export function insertBookmark/);
  assert.match(model, /export function collectBookmarks/);
  assert.match(styles, /\.paper-bookmark/);
  assert.match(styles, /\.paper-bookmark\s*\{[^}]*position:\s*absolute/s);
  assert.match(styles, /\.paper-bookmark\s*\{[^}]*left:\s*-56px/s);
  assert.match(styles, /--paper-bookmark-asset:\s*url\("\.\/assets\/decor\/bookmarks\/bookmark-teal-woven\.svg"\)/);
  assert.match(styles, /:has\(>\s*\.paper-bookmark\)/);
});

test("the literature panel separates cited snapshots from private and public library management", async () => {
  const [source, styles] = await Promise.all([
    read("./professional-content/CitationLibraryPanel.jsx"),
    read("./professional-content/citation-library-panel.css"),
  ]);

  assert.match(source, /embedded = true/);
  assert.match(source, /引用文献/);
  assert.match(source, /按正文首次出现顺序排列，点击即可定位/);
  assert.match(source, /当前信笺的私域文献目录/);
  assert.match(source, /settings-feature-overlay citation-library-overlay dialog-scrim dialog-scrim--large/);
  assert.match(source, /settings-feature-dialog citation-library-dialog/);
  assert.match(source, /文献库管理/);
  assert.match(source, /citation-library-eyebrow/);
  assert.match(source, /文献库 · \{scope === "public" \? "公域" : "私域"\}/);
  assert.match(source, /citation-library-command-panel/);
  assert.match(source, /文献范围/);
  assert.match(source, /citation-library-list-tools/);
  assert.match(source, /aria-label="搜索文献"/);
  assert.match(source, /citation-library-list-shell/);
  assert.match(source, /所有信笺可用的参考文献/);
  assert.match(source, /当前信笺的参考文献/);
  assert.match(source, /role="tab" aria-selected=\{scope === "private"\}/);
  assert.match(source, /role="tab" aria-selected=\{scope === "public"\}/);
  assert.match(source, /onAddSource/);
  assert.match(source, /onEditSource/);
  assert.match(source, /onDeleteSource/);
  assert.match(source, /onCopyToPublic/);
  assert.match(source, /onAttachPublic/);
  assert.match(source, /导入 BibTeX/);
  assert.match(source, /exportSources\("bibtex", source\)/);
  assert.match(source, /导出此文献为 BibTeX/);
  assert.match(source, /sources: source \? \[source\] : activeSources/);
  assert.match(source, /citation-tool-card citation-tool-card--format/);
  assert.match(source, /citation-tool-card citation-style-controls/);
  assert.match(source, /citation-tool-card citation-lookup/);
  assert.match(source, /function CitationSelect/);
  assert.match(source, /citation-custom-select-menu/);
  assert.doesNotMatch(source, /<select/);
  assert.match(source, /<Check size=\{16\} \/>完成/);
  assert.match(source, /RIS、CSL-JSON、引用样式与 DOI \/ ISBN 补全/);
  assert.match(source, /listCitationStyles/);
  assert.match(source, /pickCitationStyle/);
  assert.match(source, /导入 \.csl/);
  assert.match(styles, /\.citation-tool-controls-row--style\s*>\s*button\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(styles, /\.citation-tool-controls-row--style\s*>\s*button\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(styles, /\.citation-tool-controls-row--style\s*>\s*button\s*\{[^}]*font-size:\s*9\.5px/s);
  assert.match(source, /styleChoice\.locale/);
  assert.match(source, /lookupCitation/);
  assert.match(source, /privacyConsent:\s*true/);
  assert.match(source, /只会向 DOI\.org、Crossref、DataCite 或 Open Library 发送/);
  assert.match(source, /CitationConflictPreview/);
  assert.match(source, /合并（只补齐空字段）/);
  assert.match(source, /保留两份/);
  assert.match(source, /跳过/);
  assert.match(source, /defaultConflictDecision:\s*"merge"/);
  assert.match(source, /mergeCitationImportPreview/);
});

test("professional content UI owns isolated style entries and does not require the shared style bundle", async () => {
  const [entry, styles] = await Promise.all([
    read("./professional-content/index.js"),
    read("./professional-content/professional-content.css"),
  ]);

  assert.match(entry, /katex\/dist\/katex\.min\.css/);
  assert.match(entry, /\.\.\/styles-professional-content\.css/);
  assert.match(entry, /\.\/professional-content\.css/);
  assert.match(styles, /\.professional-dialog-layer/);
  assert.match(styles, /\.citation-library-panel\.is-embedded/);
  assert.match(styles, /\.mermaid-editor-grid/);
});
