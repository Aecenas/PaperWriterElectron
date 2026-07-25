import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_SESSION_PERSIST_DELAY_MS,
  createDocumentSessionController,
  createDocumentSessionPersistencePatch,
  createDocumentSessionRestoreEntries,
  describeDocumentSessionPersistence,
} from "./document-workspace/document-session-controller.js";
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
} from "./workspace-groups.js";
import {
  createBlankDocument,
  createDocumentTab,
  documentTabResourceKey,
  summarizeSessionTabs,
  summarizeWorkspaceGroups,
  workspaceDocumentView,
} from "./document-workspace/model.js";

function revision(character, mtimeMs = 100) {
  return {
    size: 12,
    mtimeMs,
    sha256: character.repeat(64),
  };
}

function createNamedDocument(title) {
  return {
    ...createBlankDocument(DEFAULT_LETTER_TEMPLATES),
    title,
  };
}

function createStoredTab(id, path, title = id) {
  const tab = createDocumentTab(createNamedDocument(title), path);
  return {
    ...tab,
    id,
  };
}

function createControllerHarness({
  documentState: initialDocumentState,
  getDocumentRevision,
  groups: initialGroups,
  now = () => 12345,
  openDocumentPath,
  restored = false,
  session: initialSession,
  timerPort,
} = {}) {
  const placeholder = createStoredTab(
    "placeholder",
    "",
    "Placeholder",
  );
  let documentState = initialDocumentState || {
    activeTabId: placeholder.id,
    currentPath: "",
    tabs: [placeholder],
  };
  let groups = initialGroups || createWorkspaceGroupsState(
    workspaceDocumentView(placeholder),
  );
  let activePane = "main";
  let session = {
    activePath: "",
    folderPath: "",
    tabs: [],
    ...(initialSession || {}),
  };
  let sessionRestored = restored;
  const events = [];
  const researchItems = {};

  const controller = createDocumentSessionController({
    applyDocument(document, path, dirty) {
      events.push(["apply", document.title, path, dirty]);
      documentState = {
        ...documentState,
        currentPath: path,
      };
    },
    debugPort: {
      log(event, payload) {
        events.push(["debug", event, payload]);
      },
    },
    documentIoPort: {
      getDocumentRevision,
      openDocumentPath,
    },
    documentRuntimePort: {
      ensure(tabId, value) {
        events.push(["runtime", tabId, value]);
      },
    },
    documentStorePort: {
      read: () => documentState,
      commitActiveTabId(activeTabId) {
        documentState = { ...documentState, activeTabId };
        events.push(["active-tab", activeTabId]);
        return activeTabId;
      },
      commitOpenTabs(tabs) {
        documentState = { ...documentState, tabs };
        events.push(["tabs", tabs.map((tab) => tab.id)]);
        return tabs;
      },
    },
    folderLifecyclePort: {
      async restoreSessionFolder(context) {
        events.push([
          "folder",
          context.savedFolderPath,
          context.activePath,
          context.runId,
        ]);
      },
    },
    groupStorePort: {
      read: () => ({ activePane, groups }),
      commitActivePane(value) {
        activePane = value;
        events.push(["pane", value]);
        return value;
      },
      commitWorkspaceGroups(value) {
        groups = value;
        events.push(["groups", value]);
        return value;
      },
    },
    letterTemplates: DEFAULT_LETTER_TEMPLATES,
    now,
    researchStatePort: {
      commitActiveItem(item) {
        events.push(["active-research", item]);
      },
      commitItem(viewId, item) {
        researchItems[viewId] = item;
        events.push(["research", viewId, item]);
      },
    },
    sessionStatePort: {
      commitSessionPatch(patch) {
        const resolved = typeof patch === "function" ? patch(session) : patch;
        session = { ...session, ...(resolved || {}) };
        events.push(["session", resolved]);
        return session;
      },
      isRestored: () => sessionRestored,
      markRestored(value = true) {
        sessionRestored = Boolean(value);
        events.push(["restored", sessionRestored]);
        return sessionRestored;
      },
      read: () => session,
    },
    timerPort,
  });

  return {
    controller,
    events,
    read: () => ({
      activePane,
      documentState,
      groups,
      researchItems,
      session,
      sessionRestored,
    }),
    setDocumentState(value) {
      documentState = value;
    },
  };
}

test("session persistence remains restored-gated, delayed 220 ms, and reads live ports at fire time", () => {
  const active = createStoredTab(
    "active-tab",
    "C:\\letters\\stale.letterpaper",
    "Active",
  );
  const secondary = createStoredTab(
    "secondary-tab",
    "C:\\letters\\secondary.letterpaper",
    "Secondary",
  );
  let groups = createWorkspaceGroupsState(workspaceDocumentView(active));
  groups = openWorkspaceDocument(
    groups,
    WORKSPACE_GROUP_ID.SECONDARY,
    workspaceDocumentView(secondary),
  );
  const scheduled = [];
  const cleared = [];
  const timerPort = {
    clearTimeout(timer) {
      cleared.push(timer);
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
  };
  const harness = createControllerHarness({
    documentState: {
      activeTabId: active.id,
      currentPath: "C:\\letters\\live.letterpaper",
      tabs: [active, secondary],
    },
    groups,
    openDocumentPath: async () => ({ canceled: true }),
    restored: false,
    timerPort,
  });

  const descriptor = harness.controller.readPersistenceDescriptor();
  assert.deepEqual(
    descriptor,
    describeDocumentSessionPersistence({
      activeTabId: active.id,
      currentPath: "C:\\letters\\live.letterpaper",
      groups,
      tabs: [active, secondary],
    }),
  );
  assert.equal(harness.controller.schedulePersistence(), undefined);
  assert.equal(scheduled.length, 0);

  const restoredHarness = createControllerHarness({
    documentState: {
      activeTabId: active.id,
      currentPath: "C:\\letters\\live.letterpaper",
      tabs: [active, secondary],
    },
    groups,
    openDocumentPath: async () => ({ canceled: true }),
    restored: true,
    timerPort,
  });
  const cleanup = restoredHarness.controller.schedulePersistence();
  assert.equal(typeof cleanup, "function");
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, DOCUMENT_SESSION_PERSIST_DELAY_MS);
  assert.equal(DOCUMENT_SESSION_PERSIST_DELAY_MS, 220);
  assert.equal(
    restoredHarness.events.some(([kind]) => kind === "session"),
    false,
  );

  restoredHarness.setDocumentState({
    activeTabId: active.id,
    currentPath: "C:\\letters\\fire-time.letterpaper",
    tabs: [active, secondary],
  });
  scheduled[0].callback();

  const persisted = restoredHarness.read().session;
  assert.equal(persisted.activePath, "C:\\letters\\fire-time.letterpaper");
  assert.equal(
    persisted.tabs[0].path,
    "C:\\letters\\fire-time.letterpaper",
  );
  assert.equal(persisted.workspaceGroups.version, 3);
  assert.equal(
    JSON.stringify(persisted.workspaceGroups).includes(active.id),
    false,
  );
  cleanup();
  assert.equal(cleared.length, 0);

  assert.deepEqual(
    createDocumentSessionPersistencePatch({
      activeTabId: active.id,
      currentPath: "",
      groups,
      tabs: [{ ...active, recoveryPath: "recovery.letterpaper" }, secondary],
    }).activePath,
    "recovery.letterpaper",
  );
});

test("v3 restore resolves fresh runtime ids and restores only the focused active relative research view", async () => {
  const oldPrimary = createStoredTab(
    "old-primary-id",
    "C:\\letters\\primary.letterpaper",
    "Primary",
  );
  const oldSecondary = createStoredTab(
    "old-secondary-id",
    "C:\\letters\\secondary.letterpaper",
    "Secondary",
  );
  let storedGroups = createWorkspaceGroupsState(
    workspaceDocumentView(oldPrimary),
  );
  storedGroups = openWorkspaceDocument(
    storedGroups,
    WORKSPACE_GROUP_ID.SECONDARY,
    workspaceDocumentView(oldSecondary),
  );
  storedGroups = openWorkspaceResearch(storedGroups, {
    libraryId: "library-a",
    relativePath: "sources/inactive.pdf",
    researchType: "pdf",
    viewState: { page: 2 },
  });
  storedGroups = openWorkspaceResearch(storedGroups, {
    libraryId: "library-a",
    relativePath: "sources/active.pdf",
    researchType: "pdf",
    viewState: { page: 8 },
  });
  const storedSnapshot = summarizeWorkspaceGroups(
    storedGroups,
    [oldPrimary, oldSecondary],
  );
  const openedPaths = [];
  const harness = createControllerHarness({
    openDocumentPath: async (path) => {
      openedPaths.push(path);
      return {
        canceled: false,
        document: createNamedDocument(
          path.includes("primary") ? "Restored primary" : "Restored secondary",
        ),
        diskRevision: revision(path.includes("primary") ? "a" : "b"),
        path,
      };
    },
    session: {
      activePath: oldPrimary.path,
      folderPath: "C:\\letters",
      tabs: summarizeSessionTabs([oldPrimary, oldSecondary]),
      workspaceGroups: storedSnapshot,
    },
  });

  const operation = harness.controller.beginRestore();
  const result = await operation.promise;
  const state = harness.read();
  const restoredPrimary = state.documentState.tabs.find(
    (tab) => tab.path === oldPrimary.path,
  );
  const restoredSecondary = state.documentState.tabs.find(
    (tab) => tab.path === oldSecondary.path,
  );
  const primaryView = getActiveWorkspaceView(
    state.groups,
    WORKSPACE_GROUP_ID.PRIMARY,
  );
  const secondaryDocumentView = state.groups.secondary.views.find(
    (view) => view.kind === WORKSPACE_VIEW_KIND.DOCUMENT,
  );
  const activeSecondary = getActiveWorkspaceView(
    state.groups,
    WORKSPACE_GROUP_ID.SECONDARY,
  );

  assert.equal(result.status, "restored");
  assert.deepEqual(openedPaths, [oldPrimary.path, oldSecondary.path]);
  assert.notEqual(restoredPrimary.id, oldPrimary.id);
  assert.notEqual(restoredSecondary.id, oldSecondary.id);
  assert.equal(primaryView.tabId, restoredPrimary.id);
  assert.equal(secondaryDocumentView.tabId, restoredSecondary.id);
  assert.equal(
    secondaryDocumentView.resourceKey,
    documentTabResourceKey(restoredSecondary),
  );
  assert.equal(activeSecondary.kind, WORKSPACE_VIEW_KIND.RESEARCH);
  assert.equal(activeSecondary.relativePath, "sources/active.pdf");
  assert.equal(state.activePane, "right");
  assert.deepEqual(Object.values(state.researchItems), [{
    type: "file",
    relativePath: "sources/active.pdf",
    name: "active.pdf",
  }]);
  assert.equal(
    Object.values(state.researchItems).some(
      (item) => item.relativePath === "sources/inactive.pdf",
    ),
    false,
  );
  assert.equal(state.sessionRestored, true);
  assert.equal(state.session.workspaceGroups.version, 3);
  assert.equal(
    JSON.stringify(state.session.workspaceGroups).includes("old-primary-id"),
    false,
  );
});

test("recovery restore keeps matching bases clean from external conflict and flags mismatches", async () => {
  const matchingBase = revision("c", 200);
  const mismatchingBase = revision("d", 300);
  const currentMismatch = revision("e", 301);
  const matchingPath = "C:\\letters\\matching.letterpaper";
  const mismatchingPath = "C:\\letters\\mismatching.letterpaper";
  const recoveryByPath = new Map([
    ["C:\\recovery\\matching.letterpaper", "Matching recovery"],
    ["C:\\recovery\\mismatching.letterpaper", "Mismatching recovery"],
  ]);
  const harness = createControllerHarness({
    getDocumentRevision: async (path) => ({
      diskRevision: path === matchingPath ? matchingBase : currentMismatch,
    }),
    openDocumentPath: async (path) => ({
      canceled: false,
      document: createNamedDocument(recoveryByPath.get(path)),
      path,
      recoveryId: path.includes("mismatching") ? "recovery-b" : "recovery-a",
    }),
    session: {
      activePath: matchingPath,
      tabs: [
        {
          path: matchingPath,
          recoveryPath: "C:\\recovery\\matching.letterpaper",
          recoveryId: "recovery-a",
          recoverySourcePath: matchingPath,
          recoveryBaseRevision: matchingBase,
        },
        {
          path: mismatchingPath,
          recoveryPath: "C:\\recovery\\mismatching.letterpaper",
          recoveryId: "recovery-b",
          recoverySourcePath: mismatchingPath,
          recoveryBaseRevision: mismatchingBase,
        },
      ],
    },
  });

  const result = await harness.controller.beginRestore().promise;
  const [matching, mismatching] = result.tabs;

  assert.equal(matching.dirty, true);
  assert.equal(matching.recoveredTemporary, true);
  assert.equal(matching.externalChanged, false);
  assert.deepEqual(matching.diskRevision, matchingBase);
  assert.equal(matching.recoveryRevision, 0);
  assert.equal(mismatching.dirty, true);
  assert.equal(mismatching.externalChanged, true);
  assert.deepEqual(mismatching.diskRevision, mismatchingBase);
  assert.equal(
    harness.events.filter(([kind]) => kind === "runtime").length,
    2,
  );
  assert.equal(
    harness.events.find(
      ([kind, tabId]) => kind === "runtime" && tabId === matching.id,
    )[2].lastEditAt,
    12345,
  );
});

test("a canceled restore becomes stale after async open and cannot commit workspace or session state", async () => {
  let resolveOpen;
  let openStarted = false;
  let revisionReads = 0;
  const deferredOpen = new Promise((resolve) => {
    resolveOpen = resolve;
  });
  const path = "C:\\letters\\slow.letterpaper";
  const recoveryPath = "C:\\recovery\\slow.letterpaper";
  const harness = createControllerHarness({
    getDocumentRevision: async () => {
      revisionReads += 1;
      return { diskRevision: revision("f") };
    },
    openDocumentPath: (requestedPath) => {
      assert.equal(requestedPath, recoveryPath);
      openStarted = true;
      return deferredOpen;
    },
    session: {
      activePath: path,
      tabs: [{
        path,
        recoveryPath,
        recoveryBaseRevision: revision("f"),
        recoverySourcePath: path,
      }],
    },
  });

  const operation = harness.controller.beginRestore();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(openStarted, true);
  operation.cancel();
  resolveOpen({
    canceled: false,
    document: createNamedDocument("Slow"),
    path: recoveryPath,
  });
  const result = await operation.promise;

  assert.equal(result.status, "stale");
  assert.equal(revisionReads, 0);
  assert.equal(harness.read().sessionRestored, false);
  assert.equal(
    harness.events.some(
      ([kind]) => ["tabs", "groups", "active-tab", "apply", "session", "restored"].includes(kind),
    ),
    false,
  );
  assert.equal(
    harness.events.some(
      ([kind, event]) => kind === "debug" && event === "renderer:restore:canceled",
    ),
    true,
  );
});

test("restore entries retain the activePath-only compatibility fallback", () => {
  const entries = createDocumentSessionRestoreEntries({
    activePath: "C:\\letters\\active.letterpaper",
    tabs: [
      {
        path: "",
        recoveryPath: "C:\\recovery\\draft.letterpaper",
        temporary: true,
      },
    ],
  });

  assert.deepEqual(entries.map((entry) => ({
    path: entry.path,
    recoveryPath: entry.recoveryPath,
    temporary: entry.temporary,
  })), [
    {
      path: "",
      recoveryPath: "C:\\recovery\\draft.letterpaper",
      temporary: true,
    },
    {
      path: "C:\\letters\\active.letterpaper",
      recoveryPath: undefined,
      temporary: false,
    },
  ]);
});
