import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const aiLayoutPortSource = await readFile(new URL("./document-workspace/ai-layout-port.js", import.meta.url), "utf8");
const topNavSource = await readFile(new URL("./app-shell/TopNav.jsx", import.meta.url), "utf8");
const pdfSource = await readFile(new URL("./research/PdfReader.jsx", import.meta.url), "utf8");
const knowledgeDocumentPortSource = await readFile(new URL("./document-workspace/knowledge-document-port.js", import.meta.url), "utf8");
const knowledgeDerivedSource = await readFile(new URL("./controllers/knowledge-derived.js", import.meta.url), "utf8");
const knowledgeReferenceActionsSource = await readFile(new URL("./controllers/knowledge-reference-actions.js", import.meta.url), "utf8");
const knowledgeRelationshipsSource = await readFile(new URL("./controllers/knowledge-relationships.js", import.meta.url), "utf8");

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
  assert.match(appSource, /useKnowledgeDocumentPort\(\{/);
  assert.match(knowledgeDocumentPortSource, /documentTabId: context\.tab\.id/);
  assert.match(knowledgeDocumentPortSource, /selection: \{ from: selection\.from, to: selection\.to \}/);
  assert.match(knowledgeDocumentPortSource, /revision: documentRevisionPort\.readLiveRevision\(context\.tab\.id\)/);
  assert.match(knowledgeDocumentPortSource, /target\.workspaceRoot[\s\S]*writingWorkspaceRootRef\.current/);
  assert.match(knowledgeDocumentPortSource, /location\.groupId !== target\.groupId/);
  assert.match(knowledgeDocumentPortSource, /documentRevisionPort\.readLiveRevision\(tab\.id\) !== target\.revision/);
  assert.doesNotMatch(knowledgeDocumentPortSource, /(?:live|disk)RevisionByTabRef/);
  assert.match(knowledgeReferenceActionsSource, /documentPort\.insertAt\(resolved, \{[\s\S]*type: "paperFootnoteReference"/);
  assert.match(knowledgeReferenceActionsSource, /handleInsertCitationAtTarget\(citationPicker, source, page\)/);
});

test("Elements footnote command opens the multiline footnote dialog before any document mutation", () => {
  const menuStart = topNavSource.indexOf('<MenuItem icon={Hash} label="脚注"');
  const handlerStart = knowledgeReferenceActionsSource.indexOf("const handleAddFootnote = useCallback(() => {");
  const handlerEnd = knowledgeReferenceActionsSource.indexOf("const handleEditFootnote", handlerStart);
  const handler = knowledgeReferenceActionsSource.slice(handlerStart, handlerEnd);

  assert.ok(menuStart >= 0, "脚注必须保留在元素菜单中");
  assert.match(topNavSource.slice(menuStart, menuStart + 180), /runMenuAction\(onInsertFootnote\)/);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "必须存在脚注插入处理器");
  assert.match(handler, /const target = documentPort\.captureInsertTarget\(\)/);
  assert.match(handler, /setFootnoteDialog\(\{ open: true, footnote: null, insertTarget: target \}\)/);
  assert.doesNotMatch(handler, /documentPort\.(?:updateTarget|insertAt)/);
  assert.match(appSource, /<FootnoteDialog/);
  assert.match(appSource, /onSubmit=\{handleSaveFootnoteDialog\}/);
});

test("AI and immersive layouts retain complete group state without closing tabs", () => {
  assert.match(appSource, /useAiLayoutPort\(\{/);
  assert.match(appSource, /aiLayoutPort\.transitionImmersiveLayout\(\{/);
  assert.match(aiLayoutPortSource, /workspaceGroups: workspaceGroupsRef\.current/);
  assert.match(aiLayoutPortSource, /snapshotLiveTabs\(\{ includeEditorJson: true \}\)/);
  assert.match(aiLayoutPortSource, /commitWorkspaceGroups\(savedLayout\.workspaceGroups\)/);
  assert.doesNotMatch(`${appSource}\n${aiLayoutPortSource}`, /closeSecondaryPane|createSecondaryPaneLayoutSnapshot|restoreSecondaryPaneLayout/);
});

test("stale PDF view callbacks cannot overwrite another research tab", () => {
  assert.match(appSource, /active\.viewId !== viewId\) return/);
  assert.match(appSource, /handleResearchViewStateChange\(activeSecondaryView\.viewId, viewState\)/);
  assert.match(appSource, /const next = updateWorkspaceResearchViewState\(current, active\.viewId, viewState\);[\s\S]*if \(next === current\) return/);
});

test("relationship data is invalidated and reloaded when the active document context changes", () => {
  assert.match(appSource, /useWorkspaceRelationshipActions\(\{/);
  assert.match(knowledgeDerivedSource, /const workspaceRelationshipContextKey =/);
  assert.match(knowledgeDerivedSource, /const structureWorkTabId = splitPaneActive \? rightSplitTabId : activeTabId/);
  assert.match(knowledgeDerivedSource, /workspaceRelationshipContextRef\.current = workspaceRelationshipContextKey/);
  assert.match(knowledgeRelationshipsSource, /requestRef\.current \+= 1;[\s\S]*setWorkspaceRelationships\(empty\)/);
  assert.match(knowledgeRelationshipsSource, /invalidateWorkspaceRelationships\(\{[\s\S]*workspaceRelationshipContextKey/);
  assert.match(knowledgeRelationshipsSource, /const relatedPanelActive = leftSidebarMode === "structure" && structureMode === "related";[\s\S]*window\.setTimeout\(refreshWorkspaceRelationships, 48\)/);
  assert.match(knowledgeRelationshipsSource, /await documentPort\.openDocument\(target\.path\);[\s\S]*setStructureMode\("related"\);/);
});

test("a second primary document can create the secondary group from the single-pane tab menu", () => {
  const singlePaneBranch = appSource.match(/\) : \(\s*<GroupTabStrip[\s\S]*?\n\s*<\/GroupTabStrip>|\) : \(\s*<GroupTabStrip[\s\S]*?\n\s*\/\>/)?.[0] || "";
  assert.match(singlePaneBranch, /canMoveDocument=\{\(\) => workspaceGroups\.primary\.views\.length > 1\}/);
  assert.doesNotMatch(singlePaneBranch, /canMoveDocument=\{\(\) => false\}/);
});
