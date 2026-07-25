import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const controllersIndexSource = await readFile(new URL("./controllers/index.js", import.meta.url), "utf8");
const aiLayoutPortSource = await readFile(new URL("./document-workspace/ai-layout-port.js", import.meta.url), "utf8");
const groupsControllerSource = await readFile(new URL("./document-workspace/workspace-groups-controller.js", import.meta.url), "utf8");
const sessionControllerSource = await readFile(new URL("./document-workspace/document-session-controller.js", import.meta.url), "utf8");
const topNavSource = await readFile(new URL("./app-shell/TopNav.jsx", import.meta.url), "utf8");
const pdfSource = await readFile(new URL("./research/PdfReader.jsx", import.meta.url), "utf8");
const knowledgeDocumentPortSource = await readFile(new URL("./document-workspace/knowledge-document-port.js", import.meta.url), "utf8");
const knowledgeDerivedSource = await readFile(new URL("./controllers/knowledge-derived.js", import.meta.url), "utf8");
const knowledgeReferenceActionsSource = await readFile(new URL("./controllers/knowledge-reference-actions.js", import.meta.url), "utf8");
const knowledgeRelationshipsSource = await readFile(new URL("./controllers/knowledge-relationships.js", import.meta.url), "utf8");

test("App composes session lifecycle effects through the document session controller", () => {
  assert.match(appSource, /describeDocumentSessionPersistence\(\{/);
  assert.match(appSource, /documentSessionControllerRef\.current\?\.schedulePersistence\(\)/);
  assert.match(appSource, /createDocumentSessionController\(\{/);
  assert.match(appSource, /const restoreOperation = documentSessionController\.beginRestore\(\)/);
  assert.match(sessionControllerSource, /const restoredGroups = restoreWorkspaceGroupsSnapshot\(/);
  assert.match(sessionControllerSource, /resolveDocumentTabId: \(resourceKey\)/);
  assert.match(sessionControllerSource, /workspaceGroups: summarizeWorkspaceGroups\(restoredGroups, restoredTabs\)/);
  assert.match(sessionControllerSource, /DOCUMENT_SESSION_PERSIST_DELAY_MS = 220/);
  assert.match(appSource, /folderLifecyclePort: workspaceFileLifecyclePort/);
  assert.doesNotMatch(appSource, /sessionFolderLifecyclePort/);
  assert.doesNotMatch(appSource, /restoreWorkspaceGroupsSnapshot\(sessionRef\.current\.workspaceGroups/);
});

test("App composes file-workspace actions and lifecycle through the public controller barrel", () => {
  assert.match(
    controllersIndexSource,
    /export \{ createWorkspaceFileController \} from "\.\/workspace-file-controller\.js"/,
  );
  assert.match(appSource, /createWorkspaceFileController\(\{/);
  assert.doesNotMatch(
    appSource,
    /from "\.\/controllers\/workspace-file-controller\.js"/,
  );
  const actionMappings = [
    ["handleNew", "workspaceFileOpenPort.newDocument"],
    ["handleOpen", "workspaceFileOpenPort.openDocument"],
    ["handleImportDocument", "workspaceFileOpenPort.importDocument"],
    ["handleOpenFolder", "workspaceFileNavigationPort.chooseFolder"],
    ["handleOpenFolderPath", "workspaceFileNavigationPort.navigateFolder"],
    ["refreshFolder", "workspaceFileNavigationPort.refreshFolder"],
    ["handleOpenFolderFile", "workspaceFileOpenPort.openDocumentPath"],
    ["handleCreateFolderInTree", "workspaceFileMutationPort.createFolder"],
    ["handleCreateDocumentInTree", "workspaceFileMutationPort.createDocument"],
    ["handleRenameTreeEntry", "workspaceFileMutationPort.renameEntry"],
    ["handleBackupTreeDocument", "workspaceFileMutationPort.backupDocument"],
    ["handleMoveTreeEntry", "workspaceFileMutationPort.moveEntry"],
    ["handleToggleFolder", "workspaceFileNavigationPort.toggleFolder"],
  ];
  for (const [name, target] of actionMappings) {
    assert.match(appSource, new RegExp(`const ${name} = ${target.replace(".", "\\.")}`));
  }
  assert.match(appSource, /addOrActivate: addOrActivateDocumentTab/);
  assert.match(appSource, /recordMutation: recordTabMutation/);
  assert.match(appSource, /snapshotTabs: snapshotLiveTabs/);
  assert.match(appSource, /branch: folderBranchRequestControllerRef\.current/);
  assert.match(appSource, /disk: diskRevisionRequestControllerRef\.current/);
  assert.match(appSource, /view: folderRequestControllerRef\.current/);
  assert.match(
    appSource,
    /workspaceFileLifecyclePort\.searchWorkspace\(\{/,
  );
  assert.match(
    appSource,
    /workspaceFileLifecyclePort[\s\S]*\.cancelWorkspaceSearch\(/,
  );
  assert.match(
    appSource,
    /workspaceFileLifecyclePort[\s\S]*\.watchWorkspace\(/,
  );
  assert.match(
    appSource,
    /workspaceFileLifecyclePort\.handleWorkspaceChanged\(/,
  );
  assert.match(
    appSource,
    /workspaceFileLifecyclePort\.verifyOpenDocuments\(\)/,
  );

  const deleteStart = appSource.indexOf("const handleDeleteTreeEntry");
  const deleteEnd = appSource.indexOf("const handleMoveTreeEntry", deleteStart);
  assert.ok(
    deleteStart >= 0 && deleteEnd > deleteStart,
    "delete barrier composition must have explicit source boundaries",
  );
  const deleteComposition = appSource.slice(deleteStart, deleteEnd);
  assert.match(deleteComposition, /tabClosePendingIdsRef\.current\.add\(tabId\)/);
  assert.match(
    deleteComposition,
    /await Promise\.all\(affectedIds\.map\(\(tabId\) => waitForTabSave\(tabId\)\)\)/,
  );
  assert.match(deleteComposition, /showConfirmDialog\(\{/);
  assert.match(deleteComposition, /documentRevisionPort\.readLiveRevision\(tabId\)/);
  assert.match(deleteComposition, /workspaceFileMutationPort\.deleteOnDisk\(entry\)/);
  assert.match(deleteComposition, /workspaceFileMutationPort\.commitDeleteResult\(\{/);
  assert.doesNotMatch(deleteComposition, /bridge\.deleteEntry/);
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
  assert.match(appSource, /commitResearchViewState\(viewId, viewState\)/);
  assert.match(appSource, /handleResearchViewStateChange\(activeSecondaryView\.viewId, viewState\)/);
  assert.match(groupsControllerSource, /active\.viewId !== viewId/);
  assert.match(groupsControllerSource, /updateWorkspaceResearchViewState\([\s\S]*active\.viewId,[\s\S]*viewState/);
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
