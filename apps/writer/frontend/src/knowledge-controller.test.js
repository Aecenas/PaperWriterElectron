import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDocumentId } from "./document-schema-v2.js";
import { createKnowledgeDocumentPort } from "./document-workspace/knowledge-document-port.js";
import {
  WORKSPACE_GROUP_ID,
  createDocumentWorkspaceView,
  createWorkspaceGroupsState,
} from "./workspace-groups.js";
import {
  invalidateWorkspaceRelationships,
  refreshWorkspaceRelationshipsCore,
} from "./controllers/knowledge-relationships.js";

function createDocument(overrides = {}) {
  const now = "2026-07-25T00:00:00.000Z";
  return {
    version: 2,
    documentId: createDocumentId(),
    derivedFrom: "",
    title: "测试信笺",
    author: "",
    html: "<p>正文</p>",
    footnotes: [],
    citationSources: [],
    comments: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createEditor(name, selection = { from: 3, to: 5 }) {
  const calls = [];
  const chain = {
    focus() {
      calls.push(["focus"]);
      return chain;
    },
    insertContentAt(range, content) {
      calls.push(["insertContentAt", range, content]);
      return chain;
    },
    setTextSelection(value) {
      calls.push(["setTextSelection", value]);
      return chain;
    },
    scrollIntoView() {
      calls.push(["scrollIntoView"]);
      return chain;
    },
    run() {
      calls.push(["run"]);
      return true;
    },
  };
  return {
    name,
    calls,
    state: {
      selection,
      doc: {
        content: { size: 20 },
        descendants() {},
        nodeAt() {
          return null;
        },
      },
    },
    view: { dom: { name } },
    chain() {
      return chain;
    },
  };
}

function createPortFixture(options = {}) {
  const primaryDocument = options.primaryDocument || createDocument();
  const secondaryDocument = options.secondaryDocument || createDocument({ title: "右侧信笺" });
  const primaryTab = {
    id: "tab-primary",
    path: "C:\\workspace\\primary.letterpaper",
    title: primaryDocument.title,
    document: primaryDocument,
    dirty: false,
    readOnly: Boolean(options.primaryReadOnly),
  };
  const secondaryTab = {
    id: "tab-secondary",
    path: "C:\\workspace\\secondary.letterpaper",
    title: secondaryDocument.title,
    document: secondaryDocument,
    dirty: false,
    readOnly: Boolean(options.secondaryReadOnly),
  };
  const openTabsRef = { current: [primaryTab, secondaryTab] };
  const workspaceGroupsRef = {
    current: createWorkspaceGroupsState({ tabId: primaryTab.id }),
  };
  const secondaryView = createDocumentWorkspaceView({ tabId: secondaryTab.id });
  workspaceGroupsRef.current.secondary = {
    views: [secondaryView],
    activeViewId: secondaryView.viewId,
  };
  const documentStateRef = { current: primaryDocument };
  const activeTabIdRef = { current: primaryTab.id };
  const rightSplitTabIdRef = { current: secondaryTab.id };
  const currentPathRef = { current: primaryTab.path };
  const dirtyRef = { current: false };
  const liveRevisionByTabRef = {
    current: new Map([
      [primaryTab.id, 7],
      [secondaryTab.id, 11],
    ]),
  };
  const diskRevisionByTabRef = { current: new Map() };
  const writingWorkspaceRootRef = { current: "C:\\workspace" };
  const mainEditor = createEditor("main");
  const secondaryEditor = createEditor("secondary", { from: 8, to: 8 });
  const mutations = [];
  const statuses = [];
  const documentStates = [];
  const tabStates = [];
  const activePanes = [];

  const port = createKnowledgeDocumentPort({
    activePane: options.activePane || "main",
    activeTabIdRef,
    activeWorkReadOnly: Boolean(options.activeWorkReadOnly),
    currentPathRef,
    dirtyRef,
    diskRevisionByTabRef,
    documentStateRef,
    editor: mainEditor,
    handleOpenFolderFile: async () => {},
    letterTemplates: undefined,
    liveRevisionByTabRef,
    openTabsRef,
    recordTabMutation(tabId, updatedAt) {
      mutations.push({ tabId, updatedAt });
      liveRevisionByTabRef.current.set(
        tabId,
        (liveRevisionByTabRef.current.get(tabId) || 0) + 1,
      );
    },
    rightSplitDocument: secondaryDocument,
    rightSplitEditor: secondaryEditor,
    rightSplitTabIdRef,
    setActivePane(value) {
      activePanes.push(value);
    },
    setDocumentState(value) {
      documentStates.push(value);
    },
    setOpenTabs(value) {
      tabStates.push(value);
    },
    showStatus(message, tone) {
      statuses.push({ message, tone });
    },
    snapshotLiveTabs() {
      return openTabsRef.current;
    },
    splitPaneActive: Boolean(options.splitPaneActive),
    workspaceGroupsRef,
    writingWorkspaceRootRef,
  });

  return {
    activePanes,
    activeTabIdRef,
    currentPathRef,
    dirtyRef,
    diskRevisionByTabRef,
    documentStateRef,
    documentStates,
    liveRevisionByTabRef,
    mainEditor,
    mutations,
    openTabsRef,
    port,
    primaryTab,
    secondaryEditor,
    secondaryTab,
    statuses,
    tabStates,
    workspaceGroupsRef,
    writingWorkspaceRootRef,
  };
}

test("captured knowledge targets retain group, tab, selection, revision, and workspace boundaries", () => {
  const fixture = createPortFixture();
  const target = fixture.port.captureInsertTarget();
  assert.deepEqual(
    {
      groupId: target.groupId,
      documentTabId: target.documentTabId,
      selection: target.selection,
      revision: target.revision,
      workspaceRoot: target.workspaceRoot,
    },
    {
      groupId: WORKSPACE_GROUP_ID.PRIMARY,
      documentTabId: "tab-primary",
      selection: { from: 3, to: 5 },
      revision: 7,
      workspaceRoot: "C:\\workspace",
    },
  );
  assert.equal(fixture.port.resolveTarget(target)?.editor, fixture.mainEditor);

  fixture.liveRevisionByTabRef.current.set(target.documentTabId, 8);
  assert.equal(fixture.port.resolveTarget(target), null, "a changed revision invalidates the target");
  fixture.liveRevisionByTabRef.current.set(target.documentTabId, 7);

  fixture.writingWorkspaceRootRef.current = "C:\\other-workspace";
  assert.equal(fixture.port.resolveTarget(target), null, "a workspace switch invalidates the target");
  fixture.writingWorkspaceRootRef.current = "C:\\workspace";

  const secondPrimaryView = createDocumentWorkspaceView({ tabId: fixture.secondaryTab.id });
  fixture.workspaceGroupsRef.current.primary.views.push(secondPrimaryView);
  fixture.workspaceGroupsRef.current.primary.activeViewId = secondPrimaryView.viewId;
  fixture.activeTabIdRef.current = fixture.secondaryTab.id;
  assert.equal(fixture.port.resolveTarget(target), null, "an active-view switch invalidates the target");
});

test("secondary-pane targets preserve pane identity and reject a changed active view", () => {
  const fixture = createPortFixture({ activePane: "right", splitPaneActive: true });
  const target = fixture.port.captureInsertTarget();
  assert.equal(target.groupId, WORKSPACE_GROUP_ID.SECONDARY);
  assert.equal(target.documentTabId, fixture.secondaryTab.id);
  assert.deepEqual(target.selection, { from: 8, to: 8 });
  assert.equal(fixture.port.resolveTarget(target)?.editor, fixture.secondaryEditor);

  fixture.workspaceGroupsRef.current.secondary.activeViewId = "";
  assert.equal(fixture.port.resolveTarget(target), null);
});

test("read-only and future-schema documents cannot capture or update knowledge targets", () => {
  const readOnly = createPortFixture({
    activeWorkReadOnly: true,
    primaryReadOnly: true,
  });
  assert.equal(readOnly.port.captureInsertTarget(), null);
  assert.equal(readOnly.port.captureManagementTarget(), null);
  assert.equal(readOnly.port.updateActive((document) => ({ ...document, title: "不可写" })), null);
  assert.equal(readOnly.mutations.length, 0);
  assert.match(readOnly.statuses[0].message, /只读/);

  const future = createPortFixture({
    activeWorkReadOnly: true,
    primaryDocument: createDocument({ version: 99, _readOnlyFutureSchema: true }),
  });
  assert.equal(future.port.captureInsertTarget(), null);
  assert.equal(future.port.updateActive({ title: "不可写" }), null);

  const changedWhileOpen = createPortFixture();
  const captured = changedWhileOpen.port.captureInsertTarget();
  changedWhileOpen.openTabsRef.current[0] = {
    ...changedWhileOpen.openTabsRef.current[0],
    readOnly: true,
  };
  assert.equal(
    changedWhileOpen.port.updateTarget(captured, { title: "不可写" }),
    null,
    "a target that becomes read-only after capture must fail closed",
  );
  assert.equal(changedWhileOpen.mutations.length, 0);
});

test("the citation fallback may tolerate only revision drift and still records a v1-to-v2 mutation", () => {
  const fixture = createPortFixture({
    primaryDocument: createDocument({
      version: 1,
      documentId: undefined,
      footnotes: undefined,
      citationSources: undefined,
    }),
  });
  const target = fixture.port.captureInsertTarget();
  fixture.liveRevisionByTabRef.current.set(target.documentTabId, target.revision + 1);

  const updater = (document) => ({
    ...document,
    citationSources: [{
      id: createDocumentId(),
      type: "other",
      title: "保留的来源",
    }],
  });
  assert.equal(fixture.port.updateTarget(target, updater), null);
  const result = fixture.port.updateTarget(target, updater, { allowRevisionChange: true });

  assert.equal(result.document.version, 2);
  assert.match(result.document.documentId, /^[0-9a-f-]{36}$/);
  assert.equal(result.document.citationSources[0].title, "保留的来源");
  assert.equal(fixture.documentStateRef.current, result.document);
  assert.equal(
    fixture.openTabsRef.current.find((tab) => tab.id === target.documentTabId).document,
    result.document,
  );
  assert.equal(
    fixture.openTabsRef.current.find((tab) => tab.id === target.documentTabId).dirty,
    true,
  );
  assert.equal(fixture.mutations.length, 1);
  assert.match(fixture.statuses[0].message, /格式 v2/);
});

test("identity reconciliation updates only clean cached tabs and the clean active document", () => {
  const fixture = createPortFixture();
  const nextDocument = createDocument({ title: "磁盘身份已更新" });
  const diskRevision = { mtimeMs: 123, size: 456 };
  fixture.port.reconcileIdentityResult({
    path: fixture.primaryTab.path,
    documentId: nextDocument.documentId,
    document: nextDocument,
    diskRevision,
  });

  assert.equal(fixture.openTabsRef.current[0].document, nextDocument);
  assert.equal(fixture.documentStateRef.current.documentId, nextDocument.documentId);
  assert.deepEqual(
    fixture.diskRevisionByTabRef.current.get(fixture.primaryTab.id),
    diskRevision,
  );

  fixture.openTabsRef.current[0] = {
    ...fixture.openTabsRef.current[0],
    dirty: true,
  };
  fixture.dirtyRef.current = true;
  const ignoredDocument = createDocument({ title: "不应覆盖脏缓存" });
  fixture.port.reconcileIdentityResult({
    path: fixture.primaryTab.path,
    documentId: ignoredDocument.documentId,
    document: ignoredDocument,
  });
  assert.notEqual(fixture.openTabsRef.current[0].document.documentId, ignoredDocument.documentId);
  assert.notEqual(fixture.documentStateRef.current.documentId, ignoredDocument.documentId);
});

test("relationship refresh is latest-wins and rejects stale render-synchronous contexts", async () => {
  let resolveFirst;
  let callCount = 0;
  const payloads = [];
  const firstResult = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const latest = {
    documents: [{ documentId: createDocumentId(), path: "C:\\workspace\\latest.letterpaper" }],
    links: [],
    backlinks: [],
    duplicates: [],
  };
  const bridgeApi = {
    async getWorkspaceRelationships(payload) {
      payloads.push(payload);
      callCount += 1;
      return callCount === 1 ? firstResult : latest;
    },
  };
  const requestRef = { current: 0 };
  const contextKeyRef = { current: "workspace\\ntab-a\\npath-a\\nid-a" };
  const committed = [];
  const documentPort = {
    getWorkspaceRoot: () => "C:\\workspace",
    snapshotDirtyTabs: () => [{
      path: "C:\\workspace\\dirty.letterpaper",
      document: createDocument(),
    }],
  };
  const parameters = {
    bridgeApi,
    contextKeyRef,
    documentId: "id-a",
    documentPort,
    editor: null,
    path: "C:\\workspace\\current.letterpaper",
    requestRef,
    setWorkspaceRelationships(value) {
      committed.push(value);
    },
    showStatus() {},
  };

  const staleRequest = refreshWorkspaceRelationshipsCore(parameters);
  const latestRequest = refreshWorkspaceRelationshipsCore(parameters);
  assert.equal(requestRef.current, 2);
  assert.equal(await latestRequest, latest);
  contextKeyRef.current = "workspace\\ntab-b\\npath-b\\nid-b";
  resolveFirst(createEmptyRelationshipResult("old"));
  const stale = await staleRequest;

  assert.equal(stale.stale, true);
  assert.deepEqual(committed, [latest]);
  assert.equal(payloads[0].folderPath, "C:\\workspace");
  assert.equal(payloads[0].currentPath, "C:\\workspace\\current.letterpaper");
  assert.equal(payloads[0].overrides.length, 1);
});

test("context invalidation increments relationship generation and clears all result buckets", () => {
  const requestRef = { current: 9 };
  const committed = [];
  const empty = invalidateWorkspaceRelationships({
    requestRef,
    setWorkspaceRelationships(value) {
      committed.push(value);
    },
  });
  assert.equal(requestRef.current, 10);
  assert.deepEqual(empty, {
    documents: [],
    links: [],
    backlinks: [],
    duplicates: [],
  });
  assert.deepEqual(committed, [empty]);
});

test("knowledge controllers use the document port instead of raw workspace mutation refs", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const controllerSources = await Promise.all([
    "./controllers/knowledge-lifecycle.js",
    "./controllers/knowledge-reference-actions.js",
    "./controllers/knowledge-relationships.js",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.match(app, /useKnowledgeReferenceState\(\)/);
  assert.match(app, /useKnowledgeReferenceDerived\(\{/);
  assert.match(app, /useKnowledgeDocumentPort\(\{/);
  assert.match(app, /useWorkspaceRelationshipActions\(\{/);
  for (const source of controllerSources) {
    assert.doesNotMatch(
      source,
      /\b(?:setDocumentState|setOpenTabs|liveRevisionByTabRef|openTabsRef|documentStateRef)\b/,
    );
  }
});

function createEmptyRelationshipResult(label) {
  return {
    documents: [{ title: label }],
    links: [],
    backlinks: [],
    duplicates: [],
  };
}
