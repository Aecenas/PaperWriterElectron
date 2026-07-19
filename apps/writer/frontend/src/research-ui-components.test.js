import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(name) {
  return readFile(new URL(name, import.meta.url), "utf8");
}

function cssRuleBody(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
}

test("research sidebar exposes an accessible lazy tree and keyboard context actions", async () => {
  const jsx = await source("./ResearchSidebar.jsx");
  const sharedTree = await source("./HierarchicalTree.jsx");
  assert.match(jsx, /<HierarchicalTree/);
  assert.match(sharedTree, /role="tree"/);
  assert.match(sharedTree, /role="treeitem"/);
  assert.match(sharedTree, /aria-expanded=/);
  assert.match(sharedTree, /event\.key === "ArrowRight"/);
  assert.match(sharedTree, /event\.key === "F10" && event\.shiftKey/);
  assert.match(sharedTree, /event\.key === "Enter" && branch && onNavigate/);
  assert.match(jsx, /role="menu"/);
  assert.match(jsx, /role="alert"/);
});

test("research sidebar orders location, collapsible files, then web and removes note controls", async () => {
  const jsx = await source("./ResearchSidebar.jsx");
  const location = jsx.indexOf("资料区位置");
  const files = jsx.indexOf("<strong>资料</strong>");
  const web = jsx.indexOf('<WebSourceGroup');
  assert.ok(location >= 0 && files > location && web > files);
  assert.match(jsx, /filesExpanded/);
  assert.match(jsx, /aria-controls="research-files-content"/);
  assert.match(jsx, /<LibraryBig size=\{15\}/);
  assert.match(jsx, /className="research-create-folder-gap"/);
  assert.match(jsx, /actions: \["createFolder"\]/);
  assert.match(jsx, /const libraryAvailable = Boolean\(rootPath && libraryId\)/);
  assert.match(jsx, /选择资料文件夹后即可管理资料/);
  assert.match(jsx, /选择资料文件夹后即可管理网页/);
  assert.match(jsx, /disabled=\{!libraryAvailable\}/);
  assert.doesNotMatch(jsx, /className="research-root-empty"/);
  assert.doesNotMatch(jsx, /noteSources|onAddNote|onClearRoot|onRefresh|onImportLegacy|导入旧资料库|label="笔记"/);
});

test("research and web sections expose connected hierarchy guides and shared tree semantics", async () => {
  const jsx = await source("./ResearchSidebar.jsx");
  const css = await source("./research-workspace.css");
  assert.match(jsx, /childrenClassName="research-tree-children"/);
  assert.match(jsx, /childrenClassName="research-web-tree-children"/);
  assert.match(jsx, /ariaLabel=\{workspaceConnected \? "工作区私区网页树" : "公区网页树"\}/);
  assert.match(css, /\.research-section-tree-body[\s\S]*border-left:/);
  assert.match(css, /\.research-tree-children,[\s\S]*\.research-web-tree-children[\s\S]*border-left:/);
  assert.match(css, /\.research-web-tree-children > \.research-web-tree-branch::before/);
  assert.doesNotMatch(jsx, /research-tree-disclosure/);
  assert.doesNotMatch(css, /\.research-tree-disclosure/);
  const webFolderRow = jsx.slice(jsx.indexOf('className="research-web-folder-main"'), jsx.indexOf('className="research-source-item-actions"'));
  assert.doesNotMatch(webFolderRow, /<Chevron(?:Down|Right)/);
  assert.match(webFolderRow, /className="research-web-folder-icon"/);
  assert.match(webFolderRow, /FOLDER_FULL_ICON/);
  assert.match(webFolderRow, /className="research-web-entry-icon is-folder"/);
  assert.match(jsx, /className="research-web-entry-icon research-web-source-icon"/);
  assert.match(cssRuleBody(css, ".research-web-entry-icon"), /width:\s*22px/);
  assert.match(cssRuleBody(css, ".research-web-entry-icon"), /justify-self:\s*center/);
  assert.match(cssRuleBody(css, ".research-web-folder-icon"), /width:\s*26px/);
  assert.match(cssRuleBody(css, ".research-web-source-icon"), /color:\s*#46728f/);
  assert.match(cssRuleBody(css, ".research-web-source-icon"), /background:\s*rgba\(/);
  assert.match(jsx, /className=\{`research-web-root-dropzone\$\{dragged \? " is-active" : ""\}`\}/);
  assert.match(jsx, /放到这里，移至网页根级/);
  assert.match(cssRuleBody(css, ".research-web-root-dropzone"), /min-height:\s*48px/);
});

test("workspace private web scope offers an accessible non-blurred public copy dialog", async () => {
  const app = await source("./App.jsx");
  const sidebar = await source("./ResearchSidebar.jsx");
  const css = await source("./styles.css");
  assert.match(sidebar, /workspaceConnected \? <button[^>]*onClick=\{onCopyFromGlobal\}/);
  assert.match(app, /function WebCopyDialog/);
  assert.match(app, /aria-checked=\{mixed \? "mixed" : checked\}/);
  assert.match(app, /folderIds: \[\.\.\.selectedEmptyFolderIds\]/);
  assert.match(app, /sourceIds: \[\.\.\.selectedSourceIds\]/);
  assert.match(app, /copyResearchWebSelection/);
  assert.match(app, /\|\| webCopyDialog\.open/);
  assert.match(app, /已复制 \$\{result\.copiedSourceCount/);
  const overlay = cssRuleBody(css, ".web-copy-overlay");
  assert.match(overlay, /background:\s*rgba\(/);
  assert.doesNotMatch(overlay, /backdrop-filter/);
});

test("web folder create, rename and delete dialogs use a non-blurred backdrop", async () => {
  const app = await source("./App.jsx");
  const css = await source("./styles.css");
  assert.match(app, /title: "新建网页文件夹"/);
  assert.match(app, /title: "重命名网页文件夹"/);
  assert.match(app, /title: "删除网页文件夹"/);
  assert.doesNotMatch(app, /noBackdropBlur|no-backdrop-blur/);
  assert.match(app, /className="app-confirm-overlay dialog-scrim"/);
  const noBlurBackdrop = cssRuleBody(css, ".dialog-scrim");
  assert.match(noBlurBackdrop, /backdrop-filter:\s*none/);
  assert.match(noBlurBackdrop, /-webkit-backdrop-filter:\s*none/);
});

test("new web sources and research folders also use a non-blurred backdrop", async () => {
  const app = await source("./App.jsx");
  assert.match(app, /function WebSourceDialog[\s\S]*?app-confirm-overlay dialog-scrim/);
  assert.match(app, /title: "新建资料文件夹"/);
});

test("web sources use one validated form and an Electron WebContentsView bridge", async () => {
  const app = await source("./App.jsx");
  const pane = await source("./SecondaryResearchPane.jsx");
  assert.match(app, /function WebSourceDialog/);
  assert.match(app, /<span>网址<\/span>/);
  assert.match(app, /<span>标题<\/span>/);
  assert.match(app, /摘录（可留空）/);
  assert.match(app, /parsed\.username \|\| parsed\.password/);
  assert.match(app, /setTitle\(parseUrl\(\)\.hostname\)/);
  assert.match(pane, /showResearchWebView/);
  assert.match(pane, /updateResearchWebViewBounds/);
  assert.match(pane, /hideResearchWebView/);
  assert.match(pane, /new ResizeObserver/);
  assert.match(pane, /controlResearchWebView\?\.\(viewId, action\)/);
  assert.match(pane, /onOpenExternal\?\.\(\{ \.\.\.item, url: currentUrl \}\)/);
});

test("file and research trees share the business-agnostic hierarchy primitives", async () => {
  const app = await source("./App.jsx");
  const research = await source("./ResearchSidebar.jsx");
  const sharedTree = await source("./HierarchicalTree.jsx");
  assert.match(app, /<HierarchicalTreeRows/);
  assert.match(app, /<TreeItemButton/);
  assert.match(research, /<HierarchicalTree/);
  assert.match(research, /<TreeItemButton/);
  assert.doesNotMatch(sharedTree, /letterpaper|citation|researchRoot|workspacePath/i);
});

test("research browsing path resets with the root and closes a stale research pane", async () => {
  const app = await source("./App.jsx");
  const sidebar = await source("./ResearchSidebar.jsx");
  assert.match(app, /researchCurrentRelativePathRef\.current = ""/);
  assert.match(app, /setResearchCurrentRelativePath\(""\)/);
  assert.match(app, /workspaceGroupsRef\.current\.secondary\.views\.some\(\(view\) => view\.kind === WORKSPACE_VIEW_KIND\.RESEARCH/);
  assert.match(app, /removeOpenResearchViews\(\(view\) => !libraryId \|\| view\.libraryId !== libraryId\)/);
  assert.match(app, /if \(researchRootRef\.current\?\.libraryId !== libraryId\) return entries/);
  assert.match(app, /currentRelativePath=\{researchCurrentRelativePath\}/);
  assert.match(app, /onNavigatePath=\{handleNavigateResearchPath\}/);
  assert.match(sidebar, /资料区位置/);
  assert.match(sidebar, /<span>\.\.\.<\/span>/);
  assert.match(sidebar, /返回上级资料文件夹/);
});

test("research root refresh stays independent from volatile open-view caches", async () => {
  const app = await source("./App.jsx");
  const start = app.indexOf("const removeOpenResearchViews");
  const end = app.indexOf("const handleToggleRightSplit", start);
  assert.ok(start >= 0 && end > start);
  const callback = app.slice(start, end);

  assert.match(app, /const librarySourcesRef = useRef\(librarySources\)/);
  assert.match(app, /const researchItemsByViewIdRef = useRef\(researchItemsByViewId\)/);
  assert.match(callback, /researchItemsByViewIdRef\.current\[active\.viewId\]/);
  assert.match(callback, /librarySourcesRef\.current\.find/);
  assert.match(callback, /\}, \[commitWorkspaceGroups\]\);/);
  assert.doesNotMatch(callback, /\[commitWorkspaceGroups,\s*librarySources,\s*researchItemsByViewId\]/);
  assert.match(app, /useEffect\(\(\) => \{\s*void refreshResearchRoot\(\);\s*\}, \[refreshResearchRoot\]\);/);
});

test("secondary research pane is a fill container with a shared accessible PDF toolbar", async () => {
  const jsx = await source("./SecondaryResearchPane.jsx");
  const css = await source("./secondary-research-pane.css");
  assert.doesNotMatch(jsx, /role="separator"|secondary-pane-resizer|secondary-research-header|secondary-research-ai-boundary/);
  assert.doesNotMatch(jsx, /style=\{\{\s*width/);
  assert.match(css, /\.secondary-research-pane[\s\S]*inline-size:\s*100%/);
  assert.match(css, /\.secondary-research-body\.is-pdf[\s\S]*padding:\s*0/);
  assert.match(jsx, /<PreviewToolbar item=\{source\}[^>]*className="secondary-pdf-toolbar"[^>]*ariaLabel="PDF 阅读控制"/);
  assert.doesNotMatch(jsx, /secondary-pdf-hud/);
  assert.match(jsx, /role="search"/);
  assert.match(jsx, /aria-expanded=\{searchOpen\}/);
  assert.match(jsx, /new ResizeObserver/);
  assert.match(jsx, /zoomMode === "fit"/);
  assert.match(jsx, /AbortController/);
  assert.match(jsx, /if \(disposed\) return;[\s\S]*pdfjs\.GlobalWorkerOptions\.workerSrc/);
  assert.match(jsx, /RenderingCancelledException/);
  assert.match(jsx, /aria-live="polite"/);
  assert.doesNotMatch(jsx, /将第 \$\{page\} 页设为引用页码|BookmarkPlus|BookPlus/);
  assert.doesNotMatch(css, /linear-gradient/);
});

test("PDF reading shortcuts avoid inputs and cover search, previous, next, first and last page", async () => {
  const jsx = await source("./SecondaryResearchPane.jsx");
  assert.match(jsx, /if \(isTextEntryTarget\(event\.target\)\) return/);
  assert.match(jsx, /event\.key\.toLocaleLowerCase\("en-US"\) === "f"/);
  assert.match(jsx, /setSearchOpen\(true\)/);
  assert.match(jsx, /event\.key === "ArrowLeft" \|\| event\.key === "PageUp"/);
  assert.match(jsx, /event\.key === "ArrowRight" \|\| event\.key === "PageDown" \|\| event\.key === " "/);
  assert.match(jsx, /event\.key === "Home"/);
  assert.match(jsx, /event\.key === "End"/);
  assert.match(jsx, /tabIndex=\{0\}/);
  assert.match(jsx, /focus\(\{ preventScroll: true \}\)/);
  assert.match(jsx, /className="secondary-pdf-reader" onKeyDown=\{handleReaderKeyDown\}/);
  assert.match(jsx, /focusedAction && \(event\.key === " " \|\| event\.key === "Spacebar"\)/);
  assert.match(jsx, /activeElement\.closest\?\.\("\[role='treeitem'\]"\)/);
});

test("PDF reader exposes restorable per-tab page, zoom and scroll view state", async () => {
  const jsx = await source("./SecondaryResearchPane.jsx");
  assert.match(jsx, /export function normalizePdfViewState/);
  assert.match(jsx, /viewState = null/);
  assert.match(jsx, /defaultViewState = null/);
  assert.match(jsx, /onViewStateChange/);
  assert.match(jsx, /zoomMode:\s*"fit"/);
  assert.match(jsx, /scale:\s*clampPdfScale/);
  assert.match(jsx, /scrollLeft:\s*nonNegativeNumber/);
  assert.match(jsx, /scrollTop:\s*nonNegativeNumber/);
  assert.match(jsx, /onScroll=\{handleViewportScroll\}/);
  assert.match(jsx, /PDF_SCROLL_COMMIT_DELAY\s*=\s*120/);
  assert.match(jsx, /window\.setTimeout\(\(\) => \{[\s\S]*publishViewState\(scrollPositionRef\.current\)/);
  assert.match(jsx, /if \(scrollingRef\.current\) return/);
  assert.match(jsx, /observer\.observe\(stage\)/);
  assert.doesNotMatch(jsx, /observer\.observe\(viewport\)/);
  assert.match(jsx, /pendingScrollRef/);
  assert.match(jsx, /itemKey:\s*sourceKey/);
  assert.match(jsx, /if \(samePdfViewState\(base, next\)\) return/);
  assert.match(jsx, /if \(samePdfViewState\(current, controlled\)\) return/);
  assert.match(jsx, /onViewStateChangeRef\.current\?\.\(normalizePdfViewState\(next\)\)/);
  assert.match(jsx, /className="secondary-pdf-page-form"/);
  assert.match(jsx, /commitPageDraft/);
  assert.match(jsx, /setPageDraft\(String\(page\)\)/);
  assert.match(jsx, /searchRunRef\.current \+= 1;[\s\S]*setQuery\(""\);[\s\S]*setSearchMessage\(""\)/);
});

test("static research previews cover sanitized markdown, text, tables and revocable image blobs", async () => {
  const jsx = await source("./SecondaryResearchPane.jsx");
  const css = await source("./secondary-research-pane.css");
  assert.match(jsx, /readResearchPreview|loadPreview/);
  assert.match(jsx, /dangerouslySetInnerHTML=\{\{ __html: markdownRender\.html/);
  assert.match(jsx, /mark\.textContent = segment\.text/);
  assert.match(jsx, /parseDelimitedPreview/);
  assert.match(jsx, /PreviewSearchForm/);
  assert.match(jsx, /segmentPreviewSearch/);
  assert.match(jsx, /setContentScale/);
  assert.match(jsx, /data-preview-search-index/);
  assert.match(jsx, /setSearchQuery\(""\)/);
  assert.match(jsx, /setActiveSearchIndex\(0\)/);
  assert.match(jsx, /className="secondary-table-scroll"/);
  assert.match(jsx, /URL\.createObjectURL/);
  assert.match(jsx, /URL\.revokeObjectURL/);
  assert.match(jsx, /\["markdown", "text", "table", "image"\]/);
  assert.match(css, /\.secondary-markdown-preview/);
  assert.match(css, /\.secondary-text-preview/);
  assert.match(css, /\.secondary-table-preview/);
  assert.match(css, /\.secondary-table-scroll[\s\S]*overflow:\s*auto/);
  assert.match(css, /border-collapse:\s*separate/);
  assert.match(css, /border-spacing:\s*0/);
  assert.match(jsx, /secondary-table-corner/);
  assert.match(jsx, /spreadsheetColumnLabel/);
  assert.match(css, /font-size:\s*calc\([^\n]*--research-preview-scale/);
  assert.match(css, /\.secondary-image-preview/);
  assert.match(css, /scrollbar-gutter:\s*stable both-edges/);
});

test("the unified group tab strip owns all research title chrome", async () => {
  const jsx = await source("./SecondaryResearchPane.jsx");
  const app = await source("./App.jsx");
  assert.doesNotMatch(jsx, /ResearchPaneTab|secondary-research-header/);
  assert.match(app, /<GroupTabStrip[\s\S]*groupId=\{WORKSPACE_GROUP_ID\.SECONDARY\}/);
  assert.match(app, /metaLabel: researchType === "pdf" \? `PDF · \$\{page\}`/);
});

test("secondary document and research panes share one aligned hard split", async () => {
  const app = await source("./App.jsx");
  const css = await source("./styles.css");
  assert.match(app, /className="editor-groups-top-strip" style=\{secondaryGridStyle\}/);
  assert.match(app, /className=\{\[\s*"paper-workspace"/);
  assert.match(app, /\? secondaryGridStyle/);
  assert.match(app, /primaryGroupTabs/);
  assert.match(app, /secondaryGroupTabs/);
  assert.match(app, /activeSecondaryView\?\.kind === WORKSPACE_VIEW_KIND\.DOCUMENT/);
  assert.match(app, /activeSecondaryView\?\.kind === WORKSPACE_VIEW_KIND\.RESEARCH/);
  assert.match(app, /className="secondary-research-slot"/);
  assert.match(css, /\.editor-groups-top-strip\s*\{[\s\S]*display:\s*grid/);
});

test("research split uses a stable ratio and App-owned accessible resizing", async () => {
  const app = await source("./App.jsx");
  assert.match(app, /paperwriter\.workspaceSplitRatio/);
  assert.match(app, /secondaryPrimaryRatio/);
  assert.match(app, /secondarySideRatio = 1 - secondaryPrimaryRatio/);
  assert.match(app, /new ResizeObserver\(measure\)/);
  assert.match(app, /aria-label="调整左右编辑组宽度"/);
  assert.match(app, /onPointerDown=\{startDocumentSplitResize\}/);
  assert.match(app, /updateDocumentSplitRatio\(workspaceGroups\.splitRatio/);
  assert.doesNotMatch(app, /paperwriter\.(?:researchPaneWidth|researchPaneRatio|documentPaneRatio)/);
});

test("Elements opens the association picker without requiring typed brackets", async () => {
  const app = await source("./App.jsx");
  const handlerStart = app.indexOf("const handleOpenInternalLinkPicker");
  const handlerEnd = app.indexOf("const handleOpenRelatedDocument", handlerStart);
  const handler = app.slice(handlerStart, handlerEnd);
  assert.match(app, /<MenuItem icon=\{Link2\} label="关联信笺"/);
  assert.match(app, /onInsertInternalLink=\{handleOpenInternalLinkPicker\}/);
  assert.match(app, /setInternalLinkPicker\(\{ \.\.\.target, direct: true \}\)/);
  assert.ok(handler.indexOf("await refreshWorkspaceRelationships()") < handler.indexOf("setInternalLinkPicker({ ...target, direct: true })"));
  assert.doesNotMatch(handler, /void refreshWorkspaceRelationships\(\)/);
  assert.match(handler, /resolveElementInsertTarget\(target\)/);
  assert.match(app, /workspaceRelationshipRequestRef\.current/);
  assert.match(app, /requestContextKey !== workspaceRelationshipContextRef\.current/);
  assert.match(app, /不能将当前信笺关联到自身/);
  assert.match(app, /insertAtCapturedSelection\(resolved, nodeContent\)/);
  assert.doesNotMatch(app, /paper-internal-link-trigger/);
});

test("Elements menu groups writing blocks, separators, then knowledge references", async () => {
  const app = await source("./App.jsx");
  const start = app.indexOf('menuId="elements"');
  const end = app.indexOf("</MenuButton>", start);
  const menu = app.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(menu.indexOf('label={editor?.isActive("blockquote") ? "取消引文" : "引文"}') < menu.indexOf('label="表格"'));
  assert.ok(menu.indexOf('label="表格"') < menu.indexOf('label="分割线"'));
  assert.ok(menu.indexOf('label="分页符"') < menu.indexOf('label="关联信笺"'));
  assert.ok(menu.indexOf('label="关联信笺"') < menu.indexOf('label="脚注"'));
  assert.ok(menu.indexOf('label="脚注"') < menu.indexOf('label="文献引用"'));
});

test("association picker mirrors workspace search placement and keyboard navigation", async () => {
  const app = await source("./App.jsx");
  const css = await source("./workspace-features.css");

  assert.match(app, /aria-label="插入关联信笺"/);
  assert.match(app, /event\.key === "ArrowDown"/);
  assert.match(app, /event\.key === "ArrowUp"/);
  assert.match(app, /role="listbox"/);
  assert.match(app, /当前工作区及全部子文件夹/);
  assert.match(app, /matchingDocuments\.slice\(0, 500\)/);
  assert.doesNotMatch(app, /documents\.slice\(0, 40\)/);
  assert.match(css, /\.internal-link-picker-overlay\{[^}]*padding:76px 20px 20px 350px/s);
  assert.match(css, /\.internal-link-picker\{[^}]*width:min\(680px/s);
  assert.match(css, /\.internal-link-picker-overlay\{[^}]*backdrop-filter:none/s);
  assert.match(css, /\.paper-document-link\{display:inline;vertical-align:baseline\}/);
  assert.match(css, /\.paper-document-link::before\{[^}]*margin-right:\.12em/s);
});

test("structure inspector implements the complete tab pattern", async () => {
  const jsx = await source("./StructureInspector.jsx");
  assert.match(jsx, /role="tablist"/);
  assert.match(jsx, /role="tab"/);
  assert.match(jsx, /role="tabpanel"/);
  assert.match(jsx, /aria-controls=/);
  assert.match(jsx, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"/);
});

test("new research surfaces do not inherit the retired cold-green palette", async () => {
  const css = await source("./research-workspace.css");
  assert.doesNotMatch(css, /#31584d|#3f5b52|#426d60|rgba\(73,\s*100,\s*91/i);
  assert.match(css, /var\(--sidebar/);
  assert.match(css, /var\(--ink/);
  assert.match(css, /--research-accent:/);
});

test("left research and structure surfaces expose the parent sidebar texture", async () => {
  const css = await source("./research-workspace.css");
  const baseCss = await source("./styles.css");
  const transparentSurfaces = [
    ".research-sidebar",
    ".research-root-bar",
    ".research-sidebar-scroll",
    ".research-files-section",
    ".research-local-boundary",
    ".research-root-empty",
    ".structure-inspector",
    ".structure-tabs",
    ".structure-panel",
    ".structure-outline",
    ".structure-related",
    ".structure-related-item",
  ];

  assert.match(baseCss, /\.sidebar\s*\{[^}]*sidebar-literary-watermark-v1\.png/s);
  for (const selector of transparentSurfaces) {
    assert.match(cssRuleBody(css, selector), /background:\s*transparent\s*;/, `${selector} must not cover the sidebar skin`);
  }
  assert.match(cssRuleBody(css, ".research-local-boundary"), /color:\s*rgba\([^;]+0\.42\)/);
  assert.match(cssRuleBody(css, ".research-tree-row:focus-within"), /background:\s*rgba\(/);
  assert.match(cssRuleBody(css, ".structure-tabs button.is-active"), /background:\s*var\(--research-selected\)/);
  assert.match(cssRuleBody(css, ".structure-related-item:focus-within"), /background:\s*rgba\(/);
});

test("retired auxiliary dock selectors are removed from the shared feature stylesheet", async () => {
  const css = await source("./workspace-features.css");
  assert.doesNotMatch(css, /\.auxiliary-dock|\.aux-dock-|\.paper-workspace\.aux-dock-open/);
  assert.doesNotMatch(css, /\.pdf-reader(?:[^-\w]|$)|\.references-pane|\.related-pane/);
});

test("outline navigation targets the currently active writing canvas", async () => {
  const app = await source("./App.jsx");
  const start = app.indexOf("const handleOutlineItemClick");
  const end = app.indexOf("const handleSave", start);
  assert.ok(start >= 0 && end > start);
  const handler = app.slice(start, end);
  assert.match(handler, /structureWorkEditor\.state\.doc/);
  assert.match(handler, /structureWorkEditor\.chain\(\)\.focus\(\)/);
  assert.match(handler, /structureWorkEditor\.view\.nodeDOM/);
  assert.match(handler, /setActivePane\(structureWorkEditor === rightSplitEditor/);
  assert.doesNotMatch(handler, /\beditor\.(?:state|chain|view)\b/);
});
