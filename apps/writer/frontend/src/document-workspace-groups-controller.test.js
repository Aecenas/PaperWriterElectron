import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createWorkspaceGroupsController,
  deriveWorkspaceGroupItems,
  reconcileWorkspaceGroupsWithTabs,
} from "./document-workspace/workspace-groups-controller.js";
import {
  DEFAULT_LETTER_TEMPLATES,
} from "./templates/model.js";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  createWorkspaceGroupsState,
  getActiveWorkspaceView,
  openWorkspaceDocument,
  openWorkspaceResearch,
  selectWorkspaceView,
} from "./workspace-groups.js";
import {
  activeSecondaryDocumentTabId,
  workspaceDocumentView,
} from "./document-workspace/model.js";

function createTab(id, {
  dirty = false,
  letterTemplateId = DEFAULT_LETTER_TEMPLATES[0].id,
  path = `${id}.letterpaper`,
  title = id,
} = {}) {
  return {
    id,
    path,
    title,
    dirty,
    document: {
      title,
      letterTemplateId,
    },
  };
}

function createControllerHarness({
  activeTabId: initialActiveTabId,
  currentPath = "",
  dirty = false,
  groups: initialGroups,
  items: initialItems = {},
  tabs: initialTabs,
} = {}) {
  let activeTabId = initialActiveTabId || initialTabs?.[0]?.id || "";
  let activeItem = null;
  let activePane = "main";
  let groups = initialGroups;
  let items = { ...initialItems };
  let tabs = initialTabs;
  const events = [];
  const documentStorePort = {
    read: () => ({
      activeTabId,
      currentPath,
      dirty,
      tabs,
    }),
    commitActiveTabId(next) {
      activeTabId = typeof next === "function"
        ? next(activeTabId)
        : next;
      events.push(["active-tab", activeTabId]);
      return activeTabId;
    },
    commitOpenTabs(next) {
      tabs = typeof next === "function" ? next(tabs) : next;
      events.push(["tabs", tabs.map((tab) => tab.id)]);
      return tabs;
    },
  };
  const groupStorePort = {
    read: () => ({
      activePane,
      groups,
      rightSplitTabId: activeSecondaryDocumentTabId(groups),
    }),
    commitActivePane(next) {
      activePane = typeof next === "function" ? next(activePane) : next;
      events.push(["pane", activePane]);
      return activePane;
    },
    commitWorkspaceGroups(next) {
      groups = typeof next === "function" ? next(groups) : next;
      events.push([
        "groups",
        groups.primary.views.map((view) => view.viewId),
        groups.secondary.views.map((view) => view.viewId),
        groups.secondary.activeViewId,
      ]);
      return groups;
    },
  };
  const researchResolver = {
    clearError() {
      events.push(["error", ""]);
    },
    commitItem(viewId, item) {
      items[viewId] = item;
      events.push(["item", viewId, item]);
    },
    destroyView(viewId) {
      events.push(["destroy", viewId]);
    },
    removeItems(viewIds) {
      viewIds.forEach((viewId) => delete items[viewId]);
      events.push(["remove-items", [...viewIds]]);
    },
    renameItems(viewIds, options) {
      for (const viewId of viewIds) {
        if (!items[viewId]) continue;
        items[viewId] = {
          ...items[viewId],
          ...options.itemPatch,
          relativePath: `${options.nextPath}${String(
            items[viewId].relativePath || "",
          ).slice(options.previousPath.length)}`,
        };
      }
      events.push(["rename-items", [...viewIds], options]);
    },
    resolveItem(view) {
      return items[view.viewId] || null;
    },
    setActiveItem(item) {
      activeItem = item;
      events.push(["active-item", item]);
    },
  };
  return {
    controller: createWorkspaceGroupsController({
      documentStorePort,
      groupStorePort,
      letterTemplates: DEFAULT_LETTER_TEMPLATES,
      now: () => 1234,
      researchResolver,
      statusPort: {
        show(message, tone) {
          events.push(["status", message, tone]);
        },
      },
    }),
    events,
    read: () => ({
      activeItem,
      activePane,
      activeTabId,
      currentPath,
      dirty,
      groups,
      items,
      tabs,
    }),
  };
}

test("group item derivation keeps live primary templates and stable research labels", () => {
  const primary = createTab("primary", {
    letterTemplateId: DEFAULT_LETTER_TEMPLATES[0].id,
    title: "Primary",
  });
  const secondary = createTab("secondary", {
    dirty: true,
    letterTemplateId: DEFAULT_LETTER_TEMPLATES[1].id,
    title: "Secondary",
  });
  let groups = createWorkspaceGroupsState(workspaceDocumentView(primary));
  groups = openWorkspaceDocument(
    groups,
    WORKSPACE_GROUP_ID.SECONDARY,
    workspaceDocumentView(secondary),
  );
  groups = openWorkspaceResearch(groups, {
    libraryId: "library-a",
    relativePath: "sources/book.pdf",
    researchType: "pdf",
    titleSnapshot: "Cached title",
    viewState: { page: 7 },
  });
  const activeSecondaryView = getActiveWorkspaceView(
    groups,
    WORKSPACE_GROUP_ID.SECONDARY,
  );
  const livePrimaryDocument = {
    ...primary.document,
    letterTemplateId: DEFAULT_LETTER_TEMPLATES[2].id,
  };
  const researchItem = {
    name: "Resolved book",
    relativePath: "sources/book.pdf",
    type: "file",
  };

  const primaryItems = deriveWorkspaceGroupItems({
    activeDocument: livePrimaryDocument,
    activeTabId: primary.id,
    groupId: WORKSPACE_GROUP_ID.PRIMARY,
    letterTemplates: DEFAULT_LETTER_TEMPLATES,
    openTabs: [primary, secondary],
    views: groups.primary.views,
  });
  const secondaryItems = deriveWorkspaceGroupItems({
    activeResearchItem: { name: "Fallback active" },
    activeSecondaryView,
    groupId: WORKSPACE_GROUP_ID.SECONDARY,
    letterTemplates: DEFAULT_LETTER_TEMPLATES,
    openTabs: [primary, secondary],
    researchItemsByViewId: {
      [activeSecondaryView.viewId]: researchItem,
    },
    views: groups.secondary.views,
  });

  assert.equal(
    primaryItems[0].letterTemplateId,
    DEFAULT_LETTER_TEMPLATES[2].id,
  );
  assert.deepEqual(secondaryItems[0], {
    viewId: `document:${secondary.id}`,
    tabId: secondary.id,
    kind: WORKSPACE_VIEW_KIND.DOCUMENT,
    title: "Secondary",
    path: "secondary.letterpaper",
    dirty: true,
    letterTemplateId: DEFAULT_LETTER_TEMPLATES[1].id,
  });
  assert.deepEqual(secondaryItems[1], {
    viewId: activeSecondaryView.viewId,
    kind: WORKSPACE_VIEW_KIND.RESEARCH,
    researchType: "pdf",
    title: "Resolved book",
    path: "sources/book.pdf",
    metaLabel: "PDF · 7",
  });
});

test("tab reconciliation appends unassigned documents and preserves research views idempotently", () => {
  const first = createTab("first");
  const second = createTab("second");
  let groups = createWorkspaceGroupsState(workspaceDocumentView(first));
  groups = openWorkspaceResearch(groups, {
    libraryId: "library-a",
    relativePath: "source.pdf",
    titleSnapshot: "Source",
  });
  const researchViewId = groups.secondary.activeViewId;

  const reconciled = reconcileWorkspaceGroupsWithTabs(
    groups,
    [first, second],
  );

  assert.deepEqual(
    reconciled.primary.views.map((view) => view.tabId),
    [first.id, second.id],
  );
  assert.equal(reconciled.secondary.views[0].viewId, researchViewId);
  assert.equal(
    reconcileWorkspaceGroupsWithTabs(reconciled, [first, second]),
    reconciled,
  );
});

test("blank replacement commits snapshot, runtime, tabs, groups, focus, and apply in legacy order", () => {
  const blank = createTab("blank", {
    path: "",
    title: "未命名信笺",
  });
  const groups = createWorkspaceGroupsState(workspaceDocumentView(blank));
  const harness = createControllerHarness({
    groups,
    tabs: [blank],
  });
  const nextDocument = {
    title: "Opened",
    html: "<p>opened</p>",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };

  const tabId = harness.controller.addOrActivateDocumentTab(
    nextDocument,
    "C:\\letters\\opened.letterpaper",
    false,
    {},
    {
      applyDocument(document, path, dirty, options) {
        harness.events.push([
          "apply",
          document.title,
          path,
          dirty,
          options,
        ]);
      },
      initializeTabRuntime(runtimeTabId, initialState) {
        harness.events.push([
          "runtime",
          runtimeTabId,
          initialState,
        ]);
      },
      snapshotTabs(options) {
        harness.events.push(["snapshot", options]);
        return [blank];
      },
    },
  );

  const state = harness.read();
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].id, tabId);
  assert.notEqual(tabId, blank.id);
  assert.equal(state.groups.primary.views[0].tabId, tabId);
  assert.equal(state.activeTabId, tabId);
  assert.equal(state.activePane, "main");
  assert.deepEqual(harness.events.map((event) => event[0]), [
    "snapshot",
    "runtime",
    "tabs",
    "groups",
    "active-tab",
    "pane",
    "apply",
  ]);
  assert.deepEqual(harness.events[1][2], {
    dirty: false,
    diskRevision: undefined,
    lastEditAt: null,
    liveUpdatedAt: "2026-07-26T00:00:00.000Z",
    recoveryRevision: null,
  });
});

test("same-path activation reuses the tab and applies its captured snapshot without creating runtime", () => {
  const first = createTab("first", {
    path: "C:\\letters\\first.letterpaper",
  });
  const existing = createTab("existing", {
    dirty: true,
    path: "C:\\Letters\\Existing.letterpaper",
  });
  let groups = createWorkspaceGroupsState(workspaceDocumentView(first));
  groups = openWorkspaceDocument(
    groups,
    WORKSPACE_GROUP_ID.PRIMARY,
    workspaceDocumentView(existing),
  );
  groups = selectWorkspaceView(
    groups,
    WORKSPACE_GROUP_ID.PRIMARY,
    `document:${first.id}`,
  );
  const harness = createControllerHarness({
    activeTabId: first.id,
    groups,
    tabs: [first, existing],
  });
  const capturedExisting = {
    ...existing,
    editorJson: { type: "doc", captured: true },
    scrollState: { top: 42, left: 1 },
  };

  const tabId = harness.controller.addOrActivateDocumentTab(
    { title: "Ignored duplicate" },
    "c:/letters/existing.letterpaper",
    false,
    {},
    {
      applyDocument(document, path, dirty, options) {
        harness.events.push([
          "apply",
          document,
          path,
          dirty,
          options,
        ]);
      },
      initializeTabRuntime() {
        assert.fail("same-path activation must not create a new runtime");
      },
      snapshotTabs(options) {
        harness.events.push(["snapshot", options]);
        return [first, capturedExisting];
      },
    },
  );

  assert.equal(tabId, existing.id);
  assert.equal(harness.read().tabs.length, 2);
  assert.equal(harness.read().activeTabId, existing.id);
  assert.equal(harness.events.at(-1)[0], "apply");
  assert.deepEqual(harness.events.map((event) => event[0]), [
    "snapshot",
    "tabs",
    "groups",
    "active-tab",
    "pane",
    "apply",
  ]);
  assert.deepEqual(harness.events.at(-1).at(-1), {
    editorJson: capturedExisting.editorJson,
    scrollState: capturedExisting.scrollState,
  });
});

test("a dirty blank tab is retained when a new document appends", () => {
  const dirtyBlank = createTab("dirty-blank", {
    dirty: true,
    path: "",
    title: "Unsaved",
  });
  const groups = createWorkspaceGroupsState(
    workspaceDocumentView(dirtyBlank),
  );
  const harness = createControllerHarness({
    activeTabId: dirtyBlank.id,
    dirty: true,
    groups,
    tabs: [dirtyBlank],
  });

  const tabId = harness.controller.addOrActivateDocumentTab(
    {
      title: "Imported",
      html: "<p>imported</p>",
      updatedAt: "2026-07-26T01:00:00.000Z",
    },
    "D:\\letters\\imported.letterpaper",
    false,
    {},
    {
      applyDocument() {
        harness.events.push(["apply"]);
      },
      initializeTabRuntime(runtimeTabId) {
        harness.events.push(["runtime", runtimeTabId]);
      },
      snapshotTabs() {
        harness.events.push(["snapshot"]);
        return [dirtyBlank];
      },
    },
  );

  assert.deepEqual(
    harness.read().tabs.map((tab) => tab.id),
    [dirtyBlank.id, tabId],
  );
  assert.deepEqual(
    harness.read().groups.primary.views.map((view) => view.tabId),
    [dirtyBlank.id, tabId],
  );
  assert.equal(harness.read().tabs[0].dirty, true);
});

test("moving and reordering documents preserve snapshot-to-focus sequencing", () => {
  const first = createTab("first");
  const second = createTab("second", { dirty: true });
  const third = createTab("third");
  let groups = createWorkspaceGroupsState(workspaceDocumentView(first));
  groups = openWorkspaceDocument(
    groups,
    WORKSPACE_GROUP_ID.PRIMARY,
    workspaceDocumentView(second),
  );
  groups = openWorkspaceDocument(
    groups,
    WORKSPACE_GROUP_ID.PRIMARY,
    workspaceDocumentView(third),
  );
  groups = selectWorkspaceView(
    groups,
    WORKSPACE_GROUP_ID.PRIMARY,
    `document:${second.id}`,
  );
  const harness = createControllerHarness({
    activeTabId: second.id,
    groups,
    tabs: [first, second, third],
  });
  const snapshot = [first, second, third];

  harness.controller.moveGroupDocument(
    `document:${second.id}`,
    WORKSPACE_GROUP_ID.SECONDARY,
    null,
    {
      applyDocument(document) {
        harness.events.push(["apply", document.title]);
      },
      snapshotTabs(options) {
        harness.events.push(["snapshot", options]);
        return snapshot;
      },
    },
  );

  assert.deepEqual(harness.events.map((event) => event[0]), [
    "snapshot",
    "tabs",
    "groups",
    "active-tab",
    "apply",
    "pane",
  ]);
  assert.equal(harness.read().activePane, "right");
  assert.equal(
    harness.read().groups.secondary.views[0].tabId,
    second.id,
  );
  const activePrimary = getActiveWorkspaceView(
    harness.read().groups,
    WORKSPACE_GROUP_ID.PRIMARY,
  );
  assert.equal(harness.read().activeTabId, activePrimary.tabId);

  harness.events.length = 0;
  harness.controller.reorderGroupView(
    WORKSPACE_GROUP_ID.PRIMARY,
    `document:${third.id}`,
    `document:${first.id}`,
  );
  assert.deepEqual(
    harness.read().groups.primary.views.map((view) => view.tabId),
    [third.id, first.id],
  );
  assert.deepEqual(harness.events.map((event) => event[0]), ["groups"]);
});

test("split toggling protects the last primary document and reports successful moves", () => {
  const first = createTab("first");
  const second = createTab("second");
  let groups = createWorkspaceGroupsState(workspaceDocumentView(first));
  const blocked = createControllerHarness({
    groups,
    tabs: [first],
  });

  blocked.controller.toggleRightSplit(first.id, {
    applyDocument() {
      assert.fail("the last primary document cannot be applied to the right");
    },
    snapshotTabs() {
      assert.fail("the last primary document cannot be snapshotted for a move");
    },
  });
  assert.deepEqual(blocked.events, [[
    "status",
    "左侧编辑组至少需要保留一个信笺",
    "warning",
  ]]);

  groups = openWorkspaceDocument(
    groups,
    WORKSPACE_GROUP_ID.PRIMARY,
    workspaceDocumentView(second),
  );
  const moved = createControllerHarness({
    activeTabId: second.id,
    groups,
    tabs: [first, second],
  });
  moved.controller.toggleRightSplit(second.id, {
    applyDocument(document) {
      moved.events.push(["apply", document.title]);
    },
    snapshotTabs() {
      moved.events.push(["snapshot"]);
      return [first, second];
    },
  });

  assert.equal(moved.read().groups.secondary.views[0].tabId, second.id);
  assert.equal(moved.read().activePane, "right");
  assert.deepEqual(moved.events.map((event) => event[0]), [
    "snapshot",
    "tabs",
    "groups",
    "active-tab",
    "apply",
    "pane",
    "status",
  ]);
  assert.deepEqual(moved.events.at(-1), [
    "status",
    "已移到右侧编辑组",
    "success",
  ]);
});

test("research preview snapshots a replaced secondary editor and reuses its stable view", () => {
  const primary = createTab("primary");
  const secondary = createTab("secondary");
  let groups = createWorkspaceGroupsState(workspaceDocumentView(primary));
  groups = openWorkspaceDocument(
    groups,
    WORKSPACE_GROUP_ID.SECONDARY,
    workspaceDocumentView(secondary),
  );
  const harness = createControllerHarness({
    groups,
    tabs: [primary, secondary],
  });
  const firstItem = {
    name: "First",
    relativePath: "book.pdf",
    type: "file",
  };
  const target = {
    libraryId: "library-a",
    relativePath: "book.pdf",
  };
  const snapshot = [
    { ...primary, title: "Primary snapshot" },
    { ...secondary, dirty: true },
  ];

  const firstViewId = harness.controller.researchViewsPort.openResearchPreviewView({
    item: firstItem,
    researchType: "pdf",
    target,
    titleSnapshot: "Book",
  }, {
    snapshotTabs(options) {
      assert.deepEqual(options, { includeEditorJson: true });
      harness.events.push(["snapshot"]);
      return snapshot;
    },
  });
  const secondItem = { ...firstItem, name: "Updated" };
  const secondViewId = harness.controller.researchViewsPort.openResearchPreviewView({
    item: secondItem,
    researchType: "pdf",
    target,
    titleSnapshot: "Updated title",
  });

  assert.equal(secondViewId, firstViewId);
  assert.equal(
    harness.read().groups.secondary.views.filter(
      (view) => view.kind === WORKSPACE_VIEW_KIND.RESEARCH,
    ).length,
    1,
  );
  assert.equal(harness.read().items[firstViewId], secondItem);
  assert.equal(harness.read().tabs, snapshot);
  assert.deepEqual(harness.events.slice(0, 7).map((event) => event[0]), [
    "snapshot",
    "tabs",
    "groups",
    "item",
    "pane",
    "active-item",
    "error",
  ]);
});

test("research target rename and removal preserve surviving stable view identities", () => {
  const primary = createTab("primary");
  let groups = createWorkspaceGroupsState(workspaceDocumentView(primary));
  groups = openWorkspaceResearch(groups, {
    libraryId: "library-a",
    relativePath: "folder/a.pdf",
    titleSnapshot: "A",
  });
  const firstView = getActiveWorkspaceView(
    groups,
    WORKSPACE_GROUP_ID.SECONDARY,
  );
  groups = openWorkspaceResearch(groups, {
    libraryId: "library-a",
    relativePath: "folder/b.pdf",
    titleSnapshot: "B",
  });
  const secondView = getActiveWorkspaceView(
    groups,
    WORKSPACE_GROUP_ID.SECONDARY,
  );
  const harness = createControllerHarness({
    groups,
    tabs: [primary],
    items: {
      [firstView.viewId]: {
        name: "A",
        relativePath: "folder/a.pdf",
      },
      [secondView.viewId]: {
        name: "B",
        relativePath: "folder/b.pdf",
      },
    },
  });

  harness.controller.researchViewsPort.updateOpenResearchTargets(
    "library-a",
    "folder",
    "renamed",
    { renamed: true },
  );
  const renamedViews = harness.read().groups.secondary.views;
  assert.deepEqual(
    renamedViews.map((view) => view.viewId),
    [firstView.viewId, secondView.viewId],
  );
  assert.deepEqual(
    renamedViews.map((view) => view.relativePath),
    ["renamed/a.pdf", "renamed/b.pdf"],
  );
  assert.equal(
    harness.read().items[firstView.viewId].relativePath,
    "renamed/a.pdf",
  );
  assert.equal(harness.read().items[firstView.viewId].renamed, true);

  harness.controller.researchViewsPort.removeOpenResearchViews(
    (view) => view.viewId === firstView.viewId,
  );
  assert.deepEqual(
    harness.read().groups.secondary.views.map((view) => view.viewId),
    [secondView.viewId],
  );
  assert.equal(harness.read().items[firstView.viewId], undefined);
  assert.equal(harness.read().items[secondView.viewId].name, "B");
  assert.equal(
    harness.events.some(
      (event) => event[0] === "destroy" && event[1] === firstView.viewId,
    ),
    true,
  );
});

test("research view state updates only the active stable view", () => {
  const primary = createTab("primary");
  let groups = createWorkspaceGroupsState(workspaceDocumentView(primary));
  groups = openWorkspaceResearch(groups, {
    libraryId: "library-a",
    relativePath: "a.pdf",
    viewState: { page: 1 },
  });
  const firstView = getActiveWorkspaceView(
    groups,
    WORKSPACE_GROUP_ID.SECONDARY,
  );
  groups = openWorkspaceResearch(groups, {
    libraryId: "library-a",
    relativePath: "b.pdf",
    viewState: { page: 2 },
  });
  const secondView = getActiveWorkspaceView(
    groups,
    WORKSPACE_GROUP_ID.SECONDARY,
  );
  const harness = createControllerHarness({
    groups,
    tabs: [primary],
  });

  harness.controller.updateResearchViewState(firstView.viewId, { page: 9 });
  assert.equal(harness.events.length, 0);
  harness.controller.updateResearchViewState(secondView.viewId, { page: 11 });

  const active = getActiveWorkspaceView(
    harness.read().groups,
    WORKSPACE_GROUP_ID.SECONDARY,
  );
  assert.equal(active.viewId, secondView.viewId);
  assert.equal(active.viewState.page, 11);
  assert.equal(harness.events.filter((event) => event[0] === "groups").length, 1);
});

test("group close delegates document transactions through the injected boundary", async () => {
  const primary = createTab("primary");
  const groups = createWorkspaceGroupsState(workspaceDocumentView(primary));
  const harness = createControllerHarness({
    groups,
    tabs: [primary],
  });

  await harness.controller.closeGroupView(
    WORKSPACE_GROUP_ID.PRIMARY,
    `document:${primary.id}`,
    {
      async closeDocumentTab(tabId) {
        harness.events.push(["close-document", tabId]);
      },
    },
  );

  assert.deepEqual(harness.events, [["close-document", primary.id]]);
  assert.equal(harness.read().groups, groups);
});

test("App keeps workspace lifecycle anchors and injects only narrow controller ports", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const controller = await readFile(
    new URL("./document-workspace/workspace-groups-controller.js", import.meta.url),
    "utf8",
  );

  assert.match(app, /createWorkspaceGroupsController\(\{/);
  assert.match(app, /reconcileWorkspaceTabs\(openTabs\);\s*\}, \[openTabs\]\);/);
  assert.match(app, /addOrActivateWorkspaceDocumentTab\(/);
  assert.match(app, /selectWorkspaceTab\(tabId, \{/);
  assert.match(app, /moveWorkspaceGroupDocument\(/);
  assert.match(
    app,
    /closeWorkspaceGroupView\([\s\S]*closeDocumentTab: handleCloseTab/,
  );
  assert.doesNotMatch(
    controller,
    /documentSaveQueuePort|saveQueueByTab|RevisionByTabRef|sessionRef|restoreSession|folderState|bridge\./,
  );
});
