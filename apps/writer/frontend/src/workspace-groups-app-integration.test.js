import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const pdfSource = await readFile(new URL("./SecondaryResearchPane.jsx", import.meta.url), "utf8");

test("App persists and restores the v3 two-group session by stable resources", () => {
  assert.match(appSource, /summarizeWorkspaceGroups\(workspaceGroupsRef\.current, liveTabs\)/);
  assert.match(appSource, /restoreWorkspaceGroupsSnapshot\(sessionRef\.current\.workspaceGroups/);
  assert.match(appSource, /resolveDocumentTabId: \(resourceKey\)/);
  assert.match(appSource, /workspaceGroups: summarizeWorkspaceGroups\(restoredGroups, restoredTabs\)/);
  assert.match(appSource, /220\);/);
});

test("global shortcuts resolve the focused group and route PDF search", () => {
  assert.match(appSource, /key === "w"[\s\S]*handleCloseGroupView\(focusedGroupId, focusedView\.viewId\)/);
  assert.match(appSource, /focusedResearch[\s\S]*new CustomEvent\("paper-pdf-find"\)/);
  assert.match(appSource, /当前活动标签是资料；请先切回信笺再保存/);
  assert.match(pdfSource, /addEventListener\("paper-pdf-find", openPdfSearch\)/);
});

test("element pickers retain a document, group, selection and revision boundary", () => {
  assert.match(appSource, /documentTabId: tab\.id/);
  assert.match(appSource, /selection: \{ from: selection\.from, to: selection\.to \}/);
  assert.match(appSource, /revision: liveRevisionByTabRef\.current\.get\(tab\.id\) \|\| 0/);
  assert.match(appSource, /location\.groupId !== target\.groupId/);
  assert.match(appSource, /liveRevisionByTabRef\.current\.get\(tab\.id\)[\s\S]*!== target\.revision/);
  assert.match(appSource, /insertAtCapturedSelection\(resolved, \{ type: "paperFootnoteReference"/);
  assert.match(appSource, /handleInsertCitationAtTarget\(citationPicker, source, page\)/);
});

test("Elements footnote command opens the multiline footnote dialog before any document mutation", () => {
  const menuStart = appSource.indexOf('<MenuItem icon={Hash} label="脚注"');
  const handlerStart = appSource.indexOf("const handleAddFootnote = useCallback(() => {");
  const handlerEnd = appSource.indexOf("const handleEditFootnote", handlerStart);
  const handler = appSource.slice(handlerStart, handlerEnd);

  assert.ok(menuStart >= 0, "脚注必须保留在元素菜单中");
  assert.match(appSource.slice(menuStart, menuStart + 180), /runMenuAction\(onInsertFootnote\)/);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "必须存在脚注插入处理器");
  assert.match(handler, /const target = captureElementInsertTarget\(\)/);
  assert.match(handler, /setFootnoteDialog\(\{ open: true, footnote: null, insertTarget: target \}\)/);
  assert.doesNotMatch(handler, /updateKnowledgeDocumentForTarget|insertAtCapturedSelection/);
  assert.match(appSource, /<FootnoteDialog/);
  assert.match(appSource, /onSubmit=\{handleSaveFootnoteDialog\}/);
});

test("AI and immersive layouts retain complete group state without closing tabs", () => {
  assert.match(appSource, /aiSecondaryPaneLayoutRef\.current[\s\S]*\{ workspaceGroups: workspaceGroupsRef\.current, activePane \}/);
  assert.match(appSource, /immersiveSecondaryPaneLayoutRef\.current[\s\S]*\{ workspaceGroups: workspaceGroupsRef\.current, activePane \}/);
  assert.match(appSource, /commitWorkspaceGroups\(savedLayout\.workspaceGroups\)/);
  assert.doesNotMatch(appSource, /closeSecondaryPane|createSecondaryPaneLayoutSnapshot|restoreSecondaryPaneLayout/);
});

test("stale PDF view callbacks cannot overwrite another research tab", () => {
  assert.match(appSource, /active\.viewId !== viewId\) return/);
  assert.match(appSource, /handleResearchViewStateChange\(activeSecondaryView\.viewId, viewState\)/);
  assert.match(appSource, /const next = updateWorkspaceResearchViewState\(current, active\.viewId, viewState\);[\s\S]*if \(next === current\) return/);
});

test("relationship data is invalidated and reloaded when the active document context changes", () => {
  assert.match(appSource, /const workspaceRelationshipContextKey =/);
  assert.match(appSource, /const structureWorkTabId = splitPaneActive \? rightSplitTabId : activeTabId/);
  assert.match(appSource, /workspaceRelationshipRequestRef\.current \+= 1;[\s\S]*setWorkspaceRelationships\(\{ documents: \[\], links: \[\], backlinks: \[\], duplicates: \[\] \}\);[\s\S]*\}, \[workspaceRelationshipContextKey\]\);/);
  assert.match(appSource, /const relatedPanelActive = leftSidebarMode === "structure" && structureMode === "related";[\s\S]*window\.setTimeout\(refreshWorkspaceRelationships, 48\)/);
  assert.match(appSource, /await handleOpenFolderFile\(target\.path\);[\s\S]*setStructureMode\("related"\);/);
});

test("a second primary document can create the secondary group from the single-pane tab menu", () => {
  const singlePaneBranch = appSource.match(/\) : \(\s*<GroupTabStrip[\s\S]*?\n\s*<\/GroupTabStrip>|\) : \(\s*<GroupTabStrip[\s\S]*?\n\s*\/\>/)?.[0] || "";
  assert.match(singlePaneBranch, /canMoveDocument=\{\(\) => workspaceGroups\.primary\.views\.length > 1\}/);
  assert.doesNotMatch(singlePaneBranch, /canMoveDocument=\{\(\) => false\}/);
});
