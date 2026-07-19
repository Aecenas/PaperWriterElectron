import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORKSPACE_SPLIT_RATIO,
  MAX_WORKSPACE_SPLIT_RATIO,
  MIN_WORKSPACE_SPLIT_RATIO,
  WORKSPACE_GROUPS_SNAPSHOT_VERSION,
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  closeWorkspaceView,
  createDocumentWorkspaceView,
  createResearchWorkspaceView,
  createResearchWorkspaceViewId,
  createWorkspaceGroupsSnapshot,
  createWorkspaceGroupsState,
  findWorkspaceView,
  getActiveWorkspaceView,
  isWorkspaceGroupsSnapshot,
  migrateWorkspaceGroupsSnapshot,
  moveWorkspaceDocument,
  normalizeResearchViewState,
  normalizeWorkspaceGroupsState,
  normalizeWorkspaceRelativePath,
  normalizeWorkspaceSplitRatio,
  openWorkspaceDocument,
  openWorkspaceResearch,
  removeWorkspaceViews,
  reorderWorkspaceView,
  restoreWorkspaceGroupsSnapshot,
  selectWorkspaceView,
  updateWorkspaceResearchTarget,
  updateWorkspaceResearchViewState,
} from "./workspace-groups.js";

const documentA = { tabId: "tab-a", resourceKey: "path:letters/a.letterpaper" };
const documentB = { tabId: "tab-b", resourceKey: "path:letters/b.letterpaper" };
const documentC = { tabId: "tab-c", resourceKey: "recovery:draft-c" };

function stateWithThreePrimaryDocuments() {
  let state = createWorkspaceGroupsState(documentA);
  state = openWorkspaceDocument(state, WORKSPACE_GROUP_ID.PRIMARY, documentB);
  state = openWorkspaceDocument(state, WORKSPACE_GROUP_ID.PRIMARY, documentC);
  return state;
}

test("creates a primary-only workspace and bounds the shared split ratio", () => {
  const state = createWorkspaceGroupsState(documentA, { splitRatio: 0.62 });
  assert.deepEqual(state, {
    primary: {
      views: [{
        kind: WORKSPACE_VIEW_KIND.DOCUMENT,
        viewId: "document:tab-a",
        tabId: "tab-a",
        resourceKey: documentA.resourceKey,
      }],
      activeViewId: "document:tab-a",
    },
    secondary: { views: [], activeViewId: "" },
    focusedGroup: WORKSPACE_GROUP_ID.PRIMARY,
    splitRatio: 0.62,
  });
  assert.equal(normalizeWorkspaceSplitRatio(undefined), DEFAULT_WORKSPACE_SPLIT_RATIO);
  assert.equal(normalizeWorkspaceSplitRatio(0.01), MIN_WORKSPACE_SPLIT_RATIO);
  assert.equal(normalizeWorkspaceSplitRatio(0.99), MAX_WORKSPACE_SPLIT_RATIO);
  assert.throws(() => createWorkspaceGroupsState(null), /primary document/i);
});

test("normalizes unsafe runtime input, keeps primary document-only, and deduplicates documents globally", () => {
  const normalized = normalizeWorkspaceGroupsState({
    primary: {
      views: [
        documentA,
        { kind: "research", libraryId: "library-a", sourceId: "web-a" },
        { tabId: "tab-a-duplicate", resourceKey: documentA.resourceKey },
      ],
      activeViewId: "missing",
    },
    secondary: {
      views: [
        documentA,
        documentB,
        { kind: "research", id: "not-a-document", libraryId: "library-a", sourceId: "web-a" },
        { kind: "research", libraryId: "library-a", sourceId: "web-a" },
      ],
      activeViewId: "missing",
    },
    focusedGroup: "secondary",
    splitRatio: 8,
  });
  assert.deepEqual(normalized.primary.views.map((view) => view.tabId), ["tab-a"]);
  assert.deepEqual(normalized.secondary.views.map((view) => view.kind), ["document", "research"]);
  assert.equal(normalized.secondary.views[0].tabId, "tab-b");
  assert.equal(normalized.secondary.views[1].sourceId, "web-a");
  assert.equal(normalized.primary.activeViewId, "document:tab-a");
  assert.equal(normalized.secondary.activeViewId, "document:tab-b");
  assert.equal(normalized.focusedGroup, "secondary");
  assert.equal(normalized.splitRatio, MAX_WORKSPACE_SPLIT_RATIO);
});

test("normalization can restore the primary invariant with a caller-provided document", () => {
  const normalized = normalizeWorkspaceGroupsState({
    primary: { views: [], activeViewId: "" },
    secondary: {
      views: [{ kind: "research", libraryId: "library-a", relativePath: "books/a.pdf" }],
      activeViewId: "",
    },
    focusedGroup: "secondary",
  }, { fallbackPrimaryDocument: documentA });
  assert.equal(normalized.primary.views[0].tabId, documentA.tabId);
  assert.equal(normalized.focusedGroup, "secondary");
});

test("opening documents activates an existing member instead of duplicating or moving it", () => {
  let state = createWorkspaceGroupsState(documentA);
  state = openWorkspaceDocument(state, WORKSPACE_GROUP_ID.SECONDARY, { tabId: documentA.tabId });
  assert.equal(state.primary.views[0].resourceKey, documentA.resourceKey);
  state = openWorkspaceDocument(state, WORKSPACE_GROUP_ID.SECONDARY, documentB);
  assert.deepEqual(state.secondary.views.map((view) => view.tabId), ["tab-b"]);
  state = openWorkspaceDocument(state, WORKSPACE_GROUP_ID.SECONDARY, {
    tabId: "tab-a-new-runtime-id",
    resourceKey: documentA.resourceKey,
  });
  assert.deepEqual(state.primary.views.map((view) => view.tabId), ["tab-a-new-runtime-id"]);
  assert.equal(state.secondary.views.length, 1);
  assert.equal(state.focusedGroup, WORKSPACE_GROUP_ID.PRIMARY);
  assert.equal(getActiveWorkspaceView(state).resourceKey, documentA.resourceKey);
});

test("research views always open in secondary and duplicate targets activate the existing stable view", () => {
  let state = createWorkspaceGroupsState(documentA);
  const fileTarget = { libraryId: "library-a", fileRelativePath: ".\\books\\one.pdf" };
  state = openWorkspaceResearch(state, fileTarget);
  const original = state.secondary.views[0];
  assert.equal(original.relativePath, "books/one.pdf");
  assert.equal(original.viewId, createResearchWorkspaceViewId(fileTarget));
  state = openWorkspaceResearch(state, { ...fileTarget, viewState: { page: 99 } });
  assert.equal(state.secondary.views.length, 1);
  assert.equal(state.secondary.views[0], original);

  state = openWorkspaceResearch(state, {
    ...fileTarget,
    titleSnapshot: "更新后的资料名",
    researchType: "pdf",
  });
  assert.equal(state.secondary.views.length, 1);
  assert.equal(state.secondary.views[0].viewId, original.viewId);
  assert.equal(state.secondary.views[0].titleSnapshot, "更新后的资料名");
  assert.equal(state.secondary.views[0].researchType, "pdf");

  state = openWorkspaceResearch(state, { libraryId: "library-a", sourceId: "web-one" });
  assert.equal(state.secondary.views.length, 2);
  assert.equal(getActiveWorkspaceView(state).sourceId, "web-one");
});

test("select resolves both view ids and document tab ids", () => {
  let state = createWorkspaceGroupsState(documentA);
  state = openWorkspaceDocument(state, "secondary", documentB);
  state = openWorkspaceResearch(state, { libraryId: "library-a", sourceId: "web-one" });
  state = selectWorkspaceView(state, "secondary", documentB.tabId);
  assert.equal(getActiveWorkspaceView(state).tabId, documentB.tabId);
  assert.equal(findWorkspaceView(state, "document:tab-b").groupId, "secondary");
  assert.equal(selectWorkspaceView(state, "primary", "missing"), state);
});

test("closing the active tab selects its right neighbor, then its left neighbor", () => {
  let state = stateWithThreePrimaryDocuments();
  state = selectWorkspaceView(state, "primary", documentB.tabId);
  state = closeWorkspaceView(state, "primary", documentB.tabId);
  assert.deepEqual(state.primary.views.map((view) => view.tabId), ["tab-a", "tab-c"]);
  assert.equal(getActiveWorkspaceView(state).tabId, "tab-c");
  state = closeWorkspaceView(state, "primary", documentC.tabId);
  assert.equal(getActiveWorkspaceView(state).tabId, "tab-a");
  assert.equal(closeWorkspaceView(state, "primary", documentA.tabId), state);
});

test("closing inactive tabs preserves selection and the last secondary tab collapses the group", () => {
  let state = createWorkspaceGroupsState(documentA);
  state = openWorkspaceDocument(state, "secondary", documentB);
  state = openWorkspaceResearch(state, { libraryId: "library-a", sourceId: "web-one" });
  state = closeWorkspaceView(state, "secondary", documentB.tabId);
  assert.equal(getActiveWorkspaceView(state).sourceId, "web-one");
  state = closeWorkspaceView(state, "secondary", state.secondary.activeViewId);
  assert.deepEqual(state.secondary, { views: [], activeViewId: "" });
  assert.equal(state.focusedGroup, WORKSPACE_GROUP_ID.PRIMARY);
});

test("reorders a mixed secondary tab strip without changing its active item", () => {
  let state = createWorkspaceGroupsState(documentA);
  state = openWorkspaceDocument(state, "secondary", documentB);
  state = openWorkspaceResearch(state, { libraryId: "library-a", sourceId: "web-one" });
  const researchId = state.secondary.activeViewId;
  state = reorderWorkspaceView(state, "secondary", researchId, 0);
  assert.deepEqual(state.secondary.views.map((view) => view.kind), ["research", "document"]);
  assert.equal(state.secondary.activeViewId, researchId);
});

test("moves documents between groups as a single instance and refuses the last primary move", () => {
  let state = createWorkspaceGroupsState(documentA);
  assert.equal(moveWorkspaceDocument(state, documentA.tabId, "secondary", 0), state);
  state = openWorkspaceDocument(state, "primary", documentB);
  state = moveWorkspaceDocument(state, documentB.tabId, "secondary", 0);
  assert.deepEqual(state.primary.views.map((view) => view.tabId), ["tab-a"]);
  assert.deepEqual(state.secondary.views.map((view) => view.tabId), ["tab-b"]);
  assert.equal(state.focusedGroup, "secondary");
  state = moveWorkspaceDocument(state, documentB.tabId, "primary", 0);
  assert.deepEqual(state.primary.views.map((view) => view.tabId), ["tab-b", "tab-a"]);
  assert.equal(state.secondary.views.length, 0);
  assert.equal(state.focusedGroup, "primary");
});

test("updates a research target without changing view identity and merges a duplicate target", () => {
  let state = createWorkspaceGroupsState(documentA);
  state = openWorkspaceResearch(state, { libraryId: "library-a", relativePath: "old/book.pdf" });
  const stableViewId = state.secondary.activeViewId;
  state = updateWorkspaceResearchTarget(state, stableViewId, {
    libraryId: "library-a",
    relativePath: "renamed/book.pdf",
  });
  assert.equal(state.secondary.views[0].viewId, stableViewId);
  assert.equal(state.secondary.views[0].relativePath, "renamed/book.pdf");

  state = openWorkspaceResearch(state, { libraryId: "library-a", sourceId: "source-a" });
  const duplicateId = state.secondary.activeViewId;
  state = updateWorkspaceResearchTarget(state, stableViewId, {
    libraryId: "library-a",
    sourceId: "source-a",
  });
  assert.equal(state.secondary.views.length, 1);
  assert.equal(state.secondary.activeViewId, duplicateId);
});

test("whitelists and clamps PDF reading state while accepting the old zoom field", () => {
  assert.deepEqual(normalizeResearchViewState({
    page: 4.9,
    zoomMode: "manual",
    zoom: 9,
    scrollTop: 15.6,
    scrollLeft: -20,
    query: "must not persist",
    itemKey: "C:\\private\\book.pdf",
  }), {
    page: 4,
    zoomMode: "manual",
    scale: 2.5,
    scrollTop: 16,
    scrollLeft: 0,
  });
  let state = createWorkspaceGroupsState(documentA);
  state = openWorkspaceResearch(state, { libraryId: "library-a", relativePath: "book.pdf" });
  const viewId = state.secondary.activeViewId;
  state = updateWorkspaceResearchViewState(state, viewId, { page: 18, scale: 0.1, scrollTop: 33 });
  assert.deepEqual(state.secondary.views[0].viewState, {
    page: 18,
    zoomMode: "fit",
    scale: 0.35,
    scrollTop: 33,
    scrollLeft: 0,
  });
  const acknowledged = updateWorkspaceResearchViewState(state, viewId, {
    ...state.secondary.views[0].viewState,
    scrollTop: 33.4,
    itemKey: "must-not-affect-state",
  });
  assert.equal(acknowledged, state, "a normalized reader acknowledgement must not schedule another App update");
});

test("bulk removal handles resource updates while protecting one primary document", () => {
  let state = stateWithThreePrimaryDocuments();
  state = openWorkspaceResearch(state, { libraryId: "library-a", relativePath: "folder/a.pdf" });
  state = openWorkspaceResearch(state, { libraryId: "library-a", relativePath: "folder/b.pdf" });
  state = removeWorkspaceViews(state, (view) => (
    view.kind === "document" || view.relativePath?.startsWith("folder/")
  ));
  assert.equal(state.primary.views.length, 1);
  assert.equal(state.primary.views[0].tabId, "tab-c");
  assert.equal(state.secondary.views.length, 0);
  assert.equal(state.focusedGroup, "primary");
  assert.equal(removeWorkspaceViews(state, {}), state);
});

test("rejects absolute, traversal and ambiguous research targets", () => {
  assert.equal(normalizeWorkspaceRelativePath(".\\books\\one.pdf"), "books/one.pdf");
  assert.equal(normalizeWorkspaceRelativePath("../private.pdf"), "");
  assert.equal(normalizeWorkspaceRelativePath("C:\\private.pdf"), "");
  assert.equal(createResearchWorkspaceView({ libraryId: "library-a", relativePath: "/private.pdf" }), null);
  assert.equal(createResearchWorkspaceView({
    libraryId: "library-a",
    relativePath: "one.pdf",
    sourceId: "also-a-source",
  }), null);
});

test("serializes a canonical v3 snapshot using resource keys instead of runtime tab ids", () => {
  let state = createWorkspaceGroupsState(documentA);
  state = openWorkspaceDocument(state, "primary", { tabId: "tab-b" });
  state = openWorkspaceResearch(state, {
    libraryId: "library-a",
    relativePath: "papers/one.pdf",
    absolutePath: "C:\\private\\one.pdf",
    content: "private PDF text",
    excerpt: "private excerpt",
    url: "https://private.example/path",
    titleSnapshot: "private note title",
    researchType: "pdf",
    viewState: { page: 7, scale: 1.2, query: "private phrase" },
  });
  const snapshot = createWorkspaceGroupsSnapshot(state, {
    getDocumentResourceKey: (tabId) => (tabId === "tab-b" ? documentB.resourceKey : ""),
  });
  assert.equal(snapshot.version, WORKSPACE_GROUPS_SNAPSHOT_VERSION);
  assert.deepEqual(snapshot.primary.views, [
    { kind: "document", resourceKey: documentA.resourceKey },
    { kind: "document", resourceKey: documentB.resourceKey },
  ]);
  assert.equal(snapshot.secondary.views[0].relativePath, "papers/one.pdf");
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /tab-a|tab-b|absolutePath|private PDF text|private excerpt|private note title|private\.example|private phrase|researchType|titleSnapshot|C:\\\\private/);
  assert.equal(isWorkspaceGroupsSnapshot(snapshot), true);
  assert.deepEqual(JSON.parse(serialized), snapshot);
});

test("snapshot resource resolution prefers live Save As identities before deduplication", () => {
  const savedAsView = createDocumentWorkspaceView({
    tabId: "saved-as-tab",
    resourceKey: "path:letters/original.letterpaper",
  });
  const reopenedOriginalView = createDocumentWorkspaceView({
    tabId: "reopened-original-tab",
    resourceKey: "path:letters/original.letterpaper",
  });
  const state = {
    ...createWorkspaceGroupsState(savedAsView),
    primary: {
      views: [savedAsView, reopenedOriginalView],
      activeViewId: reopenedOriginalView.viewId,
    },
  };
  const calls = [];
  const snapshot = createWorkspaceGroupsSnapshot(state, {
    getDocumentResourceKey(tabId) {
      calls.push(tabId);
      if (tabId === "saved-as-tab") return "path:letters/saved-as.letterpaper";
      return "";
    },
  });
  assert.deepEqual(snapshot.primary.views, [
    { kind: "document", resourceKey: "path:letters/saved-as.letterpaper" },
    { kind: "document", resourceKey: "path:letters/original.letterpaper" },
  ]);
  assert.ok(calls.includes("saved-as-tab"));
  assert.equal(snapshot.primary.activeViewKey, "document:path~3Aletters~2Foriginal.letterpaper");
});

test("snapshot callbacks fail closed to the last stable resource without aborting persistence", () => {
  const state = createWorkspaceGroupsState(documentA);
  const snapshot = createWorkspaceGroupsSnapshot(state, {
    getDocumentResourceKey() {
      throw new Error("live tab registry unavailable");
    },
  });
  assert.deepEqual(snapshot.primary.views, [
    { kind: "document", resourceKey: documentA.resourceKey },
  ]);
});

test("long and malformed resource keys retain a bounded active identity", () => {
  const longKey = `path:${"资料/".repeat(900)}active.letterpaper`;
  let state = createWorkspaceGroupsState(documentA);
  state = openWorkspaceDocument(state, "primary", {
    tabId: "long-tab",
    resourceKey: `${longKey}\ud800`,
  });
  const snapshot = createWorkspaceGroupsSnapshot(state);
  assert.ok(snapshot.primary.activeViewKey.length <= 1024);
  assert.equal(snapshot.primary.views.length, 2);
  assert.equal(isWorkspaceGroupsSnapshot(snapshot), true);
  const restored = restoreWorkspaceGroupsSnapshot(snapshot, {
    documents: [
      { tabId: "new-a", resourceKey: documentA.resourceKey },
      { tabId: "new-long", resourceKey: `${longKey}\ud800` },
    ],
    fallbackPrimaryDocument: documentC,
  });
  assert.equal(restored.primary.activeViewId, "document:new-long");
});

test("restores v3 groups by resolving document resource keys to fresh runtime ids", () => {
  let state = createWorkspaceGroupsState(documentA, { splitRatio: 0.58 });
  state = openWorkspaceDocument(state, "secondary", documentB);
  state = openWorkspaceResearch(state, {
    libraryId: "library-a",
    sourceId: "web-one",
    viewState: { page: 3, scale: 1.4, scrollTop: 50 },
  });
  const researchId = state.secondary.activeViewId;
  const snapshot = createWorkspaceGroupsSnapshot(state);
  const restored = restoreWorkspaceGroupsSnapshot(snapshot, {
    documents: [
      { tabId: "new-tab-a", resourceKey: documentA.resourceKey },
      { tabId: "new-tab-b", resourceKey: documentB.resourceKey },
    ],
    fallbackPrimaryDocument: { tabId: "fallback", resourceKey: "recovery:fallback" },
  });
  assert.deepEqual(restored.primary.views.map((view) => view.tabId), ["new-tab-a"]);
  assert.deepEqual(restored.secondary.views.map((view) => view.kind), ["document", "research"]);
  assert.equal(restored.secondary.views[0].tabId, "new-tab-b");
  assert.equal(restored.secondary.views[1].viewId, researchId);
  assert.equal(restored.secondary.activeViewId, researchId);
  assert.equal(restored.focusedGroup, "secondary");
  assert.equal(restored.splitRatio, 0.58);
});

test("migrates a v2 singleton document split into two v3 groups", () => {
  const migrated = migrateWorkspaceGroupsSnapshot({
    version: 2,
    secondaryPane: { kind: "document", tabId: "tab-b" },
    activePane: "right",
    widths: { documentRatio: 0.44, researchRatio: 0.61 },
  }, {
    documentResources: [documentA, documentB],
    activePrimaryTabId: "tab-a",
  });
  assert.deepEqual(migrated.primary.views, [
    { kind: "document", resourceKey: documentA.resourceKey },
  ]);
  assert.deepEqual(migrated.secondary.views, [
    { kind: "document", resourceKey: documentB.resourceKey },
  ]);
  assert.equal(migrated.focusedGroup, "secondary");
  assert.equal(migrated.splitRatio, 0.44);
});

test("migrates legacy research aliases and uses the research ratio", () => {
  const migrated = migrateWorkspaceGroupsSnapshot({
    secondaryPane: {
      kind: "research",
      libraryId: "library-a",
      fileRelativePath: ".\\papers\\one.pdf",
      absolutePath: "C:\\private\\one.pdf",
    },
    activePane: "secondary",
    widths: { documentRatio: 0.4, researchRatio: 0.57 },
  }, { primaryResourceKeys: [documentA.resourceKey] });
  assert.equal(migrated.version, 3);
  assert.equal(migrated.secondary.views[0].relativePath, "papers/one.pdf");
  assert.equal(migrated.splitRatio, 0.43);
  assert.doesNotMatch(JSON.stringify(migrated), /absolutePath|C:\\\\private/);
});

test("migrates a legacy single-group session without inventing a secondary group", () => {
  const migrated = migrateWorkspaceGroupsSnapshot({
    version: 2,
    activePane: "main",
  }, {
    documentResources: [documentA, documentB, documentC],
    activePrimaryTabId: documentB.tabId,
  });
  assert.deepEqual(migrated.primary.views.map((view) => view.resourceKey), [
    documentA.resourceKey,
    documentB.resourceKey,
    documentC.resourceKey,
  ]);
  assert.equal(migrated.primary.activeViewKey, "document:path~3Aletters~2Fb.letterpaper");
  assert.deepEqual(migrated.secondary, { views: [], activeViewKey: "" });
  assert.equal(migrated.focusedGroup, "primary");
});

test("legacy migration prefers the live document registry after Save As", () => {
  const migrated = migrateWorkspaceGroupsSnapshot({
    version: 2,
    secondaryPane: { kind: "document", tabId: "tab-b", resourceKey: "path:stale.letterpaper" },
    activePane: "right",
    widths: { documentRatio: 0.5 },
  }, {
    documentResources: [
      documentA,
      { tabId: "tab-b", resourceKey: "path:current.letterpaper" },
    ],
    activePrimaryTabId: documentA.tabId,
  });
  assert.deepEqual(migrated.secondary.views, [
    { kind: "document", resourceKey: "path:current.letterpaper" },
  ]);
});

test("future or unusable snapshots safely restore the caller-provided fallback", () => {
  const fallback = createWorkspaceGroupsState(documentC, { splitRatio: 0.64 });
  const future = restoreWorkspaceGroupsSnapshot({ version: 99, privateData: "do not read" }, {
    fallbackState: fallback,
  });
  assert.deepEqual(future, fallback);
  assert.equal(isWorkspaceGroupsSnapshot({ version: 99 }), false);
  assert.deepEqual(restoreWorkspaceGroupsSnapshot({ version: "99" }, { fallbackState: fallback }), fallback);

  const unavailable = restoreWorkspaceGroupsSnapshot({
    version: 3,
    primary: {
      views: [{ kind: "document", resourceKey: "path:missing.letterpaper" }],
      activeViewKey: "document:path~3Amissing.letterpaper",
    },
    secondary: { views: [], activeViewKey: "" },
    focusedGroup: "primary",
    splitRatio: 0.5,
  }, { fallbackState: fallback });
  assert.deepEqual(unavailable, fallback);
});

test("restore ignores a broken resolver and falls back to the document lookup", () => {
  const snapshot = createWorkspaceGroupsSnapshot(createWorkspaceGroupsState(documentA));
  const restored = restoreWorkspaceGroupsSnapshot(snapshot, {
    documents: [{ tabId: "fresh-tab-a", resourceKey: documentA.resourceKey }],
    resolveDocumentTabId() {
      return {};
    },
    fallbackPrimaryDocument: documentC,
  });
  assert.equal(restored.primary.views[0].tabId, "fresh-tab-a");
});

test("snapshot validation strips duplicate resources, unsafe research and primary research views", () => {
  const snapshot = {
    version: 3,
    primary: {
      views: [
        { kind: "document", resourceKey: documentA.resourceKey, tabId: "must-not-survive" },
        { kind: "research", libraryId: "library-a", sourceId: "not-allowed" },
      ],
      activeViewKey: "missing",
    },
    secondary: {
      views: [
        { kind: "document", resourceKey: documentA.resourceKey },
        { kind: "research", libraryId: "library-a", relativePath: "../escape.pdf" },
        { kind: "research", libraryId: "library-a", sourceId: "web-one", content: "secret" },
      ],
      activeViewKey: "missing",
    },
    focusedGroup: "secondary",
    splitRatio: "0.6",
  };
  const migrated = migrateWorkspaceGroupsSnapshot(snapshot);
  assert.equal(migrated.primary.views.length, 1);
  assert.deepEqual(migrated.secondary.views.map((view) => view.kind), ["research"]);
  assert.equal(migrated.secondary.views[0].sourceId, "web-one");
  assert.doesNotMatch(JSON.stringify(migrated), /must-not-survive|secret|escape/);
});

test("document and research view factories expose only state-owned fields", () => {
  assert.deepEqual(createDocumentWorkspaceView({
    tabId: " tab-a ",
    resourceKey: " resource-a ",
    document: { html: "secret" },
    path: "C:\\secret.letterpaper",
  }), {
    kind: "document",
    viewId: "document:tab-a",
    tabId: "tab-a",
    resourceKey: "resource-a",
  });
  const research = createResearchWorkspaceView({
    libraryId: " library-a ",
    sourceId: " source-a ",
    titleSnapshot: `  ${"资料标题".repeat(100)}  `,
    researchType: "web",
    url: "https://private.example",
    excerpt: "secret",
  });
  assert.equal(research.kind, "research");
  assert.equal(research.viewId, "research:library-a:source:source-a");
  assert.equal(research.libraryId, "library-a");
  assert.equal(research.sourceId, "source-a");
  assert.equal(research.titleSnapshot.length, 256);
  assert.equal(research.researchType, "web");
  assert.deepEqual(research.viewState, {
    page: 1,
    zoomMode: "fit",
    scale: 1,
    scrollTop: 0,
    scrollLeft: 0,
  });
  assert.doesNotMatch(JSON.stringify(research), /private\.example|secret/);
});
