import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PERSISTENCE_ERROR_NOTICE_INTERVAL_MS,
  RECOVERY_AUTOSAVE_INTERVAL_MS,
  WORKSPACE_FLUSH_INTERVAL_MS,
  WORKSPACE_IDLE_FLUSH_AGE_MS,
  createDocumentPersistenceController,
  createDocumentPersistenceRuntimeState,
} from "./document-workspace/document-persistence-controller.js";
import {
  createDocumentRuntimeKernel,
} from "./document-workspace/document-runtime-kernel.js";
import {
  createBlankDocument,
  createDocumentTab,
  documentRuntimeKey,
  workspaceDocumentView,
} from "./document-workspace/model.js";
import {
  DEFAULT_LETTER_TEMPLATES,
} from "./templates/model.js";
import {
  WORKSPACE_GROUP_ID,
  createWorkspaceGroupsState,
  openWorkspaceDocument,
} from "./workspace-groups.js";

function diskRevision(character, mtimeMs = 100) {
  return {
    size: 100,
    mtimeMs,
    sha256: character.repeat(64),
  };
}

function createTestDocument(title, html = `<p>${title}</p>`) {
  return {
    ...createBlankDocument(DEFAULT_LETTER_TEMPLATES),
    title,
    html,
  };
}

function createTestTab(id, {
  dirty = true,
  diskRevision: revision = diskRevision("a"),
  document = createTestDocument(id),
  externalChanged = false,
  path = `C:\\letters\\${id}.letterpaper`,
  readOnly = false,
  recoveryBaseRevision = null,
  recoveryId = "",
  recoveryPath = "",
  recoveryRevision = null,
  recoverySourcePath = "",
} = {}) {
  return {
    ...createDocumentTab(document, path, dirty, {
      diskRevision: revision,
      externalChanged,
      readOnly,
      recoveryBaseRevision,
      recoveryId,
      recoveryPath,
      recoveryRevision,
      recoverySourcePath,
      recoveredTemporary: Boolean(recoveryPath),
    }),
    id,
  };
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createPersistenceHarness({
  activeTabId,
  confirmTabClose = async () => "close",
  confirmWindowClose = async () => "save",
  initialClosePending = false,
  lastEditAtByTab = {},
  liveRevisionByTab = {},
  now: initialNow = 1_000_000,
  onDeleteTempDocument,
  onOpenDocumentPath,
  onSaveDocument,
  onSaveTempDocument,
  resolveSaveConflict = async () => "cancel",
  runtimeState,
  tabs: initialTabs,
} = {}) {
  const tabs = initialTabs || [createTestTab("tab-a")];
  let currentNow = initialNow;
  const kernel = createDocumentRuntimeKernel({
    deferCommit: () => Promise.resolve(),
    now: () => currentNow,
  });
  tabs.forEach((tab) => {
    kernel.tabRuntimePort.register(tab.id, {
      dirty: tab.dirty,
      diskRevision: tab.diskRevision,
      lastEditAt: lastEditAtByTab[tab.id] ?? (
        tab.dirty ? currentNow - WORKSPACE_IDLE_FLUSH_AGE_MS : null
      ),
      liveRevision: liveRevisionByTab[tab.id] ?? (tab.dirty ? 1 : 0),
      recoveryRevision: tab.recoveryRevision,
    });
  });

  const selectedTabId = activeTabId || tabs[0].id;
  const selectedTab = tabs.find((tab) => tab.id === selectedTabId) || tabs[0];
  let documentState = {
    activeTabId: selectedTab.id,
    currentPath: selectedTab.path,
    dirty: selectedTab.dirty,
    document: selectedTab.document,
    tabs,
  };
  let groups = createWorkspaceGroupsState(
    workspaceDocumentView(tabs[0]),
  );
  for (const tab of tabs.slice(1)) {
    groups = openWorkspaceDocument(
      groups,
      WORKSPACE_GROUP_ID.PRIMARY,
      workspaceDocumentView(tab),
    );
  }
  let activePane = "main";
  let closePending = initialClosePending;
  let session = {
    activePath: selectedTab.path,
    folderPath: "C:\\letters",
    tabs: [],
  };
  let blockedByResearch = false;
  let saveTargetId = selectedTab.id;
  let saveTargetIsRightSplit = false;
  const events = [];
  const intervals = [];
  const clearedIntervals = [];
  const lifecycle = {
    blur: null,
    close: null,
  };

  const commitOpenTabs = (value) => {
    const tabsValue = typeof value === "function"
      ? value(documentState.tabs)
      : value;
    documentState = { ...documentState, tabs: tabsValue };
    events.push(["tabs", tabsValue]);
    return tabsValue;
  };

  const documentIoPort = {
    async closeCanceled(payload) {
      events.push(["close-canceled", payload]);
    },
    async closeReady(payload) {
      events.push(["close-ready", payload]);
    },
    async deleteTempDocument(recoveryId) {
      events.push(["delete-temp", recoveryId]);
      return onDeleteTempDocument?.(recoveryId);
    },
    async openDocumentPath(path) {
      events.push(["open", path]);
      if (onOpenDocumentPath) return onOpenDocumentPath(path);
      return {
        canceled: false,
        diskRevision: diskRevision("b", 200),
        document: createTestDocument("Disk"),
        path,
      };
    },
    async saveDocument(...args) {
      events.push(["save-document", ...args]);
      if (onSaveDocument) return onSaveDocument(...args);
      return {
        canceled: false,
        diskRevision: diskRevision("b", 200),
        document: args[0],
        path: args[1] || "C:\\letters\\saved.letterpaper",
      };
    },
    async saveTempDocument(...args) {
      events.push(["save-temp", ...args]);
      if (onSaveTempDocument) return onSaveTempDocument(...args);
      return {
        canceled: false,
        path: `C:\\recovery\\${args[1]}.letterpaper`,
        recoveryId: args[1],
      };
    },
  };

  const controller = createDocumentPersistenceController({
    applicationPort: {
      applyDocument(document, path, dirty, options) {
        documentState = {
          ...documentState,
          currentPath: path,
          dirty,
          document,
        };
        events.push(["apply", document, path, dirty, options]);
      },
      captureSaveDocument(context) {
        return documentState.tabs.find(
          (tab) => tab.id === context?.targetTab?.id,
        )?.document || null;
      },
      readSaveContext() {
        if (blockedByResearch) return { blockedByResearch: true };
        const targetTab = documentState.tabs.find(
          (tab) => tab.id === saveTargetId,
        );
        return {
          blockedByResearch: false,
          isRightSplit: saveTargetIsRightSplit,
          targetTab,
        };
      },
      commitActiveResearchItem(item) {
        events.push(["active-research", item]);
      },
      migrateDocumentRuntimeKey(previousKey, nextKey) {
        events.push(["migrate-key", previousKey, nextKey]);
      },
      openConflictComparison(value) {
        events.push(["comparison", value]);
      },
      refreshFolder() {
        events.push(["refresh-folder"]);
      },
      resolveResearchItem(view) {
        return { relativePath: view.relativePath, type: "file" };
      },
    },
    dialogPort: {
      async confirmTabClose(input) {
        events.push(["confirm-tab-close", input]);
        return confirmTabClose(input);
      },
      async confirmWindowClose(input) {
        events.push(["confirm-window-close", input]);
        return confirmWindowClose(input);
      },
      async resolveSaveConflict(input) {
        events.push(["resolve-conflict", input]);
        return resolveSaveConflict(input);
      },
    },
    dirtyPort: kernel.dirtyPort,
    documentIoPort,
    documentStorePort: {
      commitActiveTabId(value) {
        documentState = { ...documentState, activeTabId: value };
        events.push(["active-tab", value]);
        return value;
      },
      commitCurrentPath(value) {
        documentState = { ...documentState, currentPath: value };
        events.push(["current-path", value]);
        return value;
      },
      commitDirty(value) {
        documentState = { ...documentState, dirty: value };
        events.push(["dirty", value]);
        return value;
      },
      commitDocumentState(value) {
        documentState = { ...documentState, document: value };
        events.push(["document-state", value]);
        return value;
      },
      commitOpenTabs,
      read: () => documentState,
    },
    groupStorePort: {
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
      read: () => ({ activePane, groups }),
    },
    letterTemplates: DEFAULT_LETTER_TEMPLATES,
    lifecyclePort: {
      onCloseRequest(callback) {
        lifecycle.close = callback;
        events.push(["subscribe-close"]);
        return () => {
          lifecycle.close = null;
          events.push(["unsubscribe-close"]);
        };
      },
      onWindowBlur(callback) {
        lifecycle.blur = callback;
        events.push(["subscribe-blur"]);
        return () => {
          lifecycle.blur = null;
          events.push(["unsubscribe-blur"]);
        };
      },
    },
    newDocumentTemplateId: DEFAULT_LETTER_TEMPLATES[0].id,
    notificationPort: {
      show(message, tone) {
        events.push(["status", message, tone]);
      },
    },
    now: () => currentNow,
    revisionPort: kernel.revisionPort,
    runtimeState,
    saveQueuePort: kernel.saveQueuePort,
    sessionStatePort: {
      beginClose() {
        if (closePending) return false;
        closePending = true;
        events.push(["begin-close"]);
        return true;
      },
      commitSessionPatch(patch) {
        session = { ...session, ...(patch || {}) };
        events.push(["session", patch]);
        return session;
      },
      endClose() {
        closePending = false;
        events.push(["end-close"]);
        return false;
      },
      isClosePending: () => closePending,
    },
    snapshotPort: {
      snapshot(options) {
        const snapshot = documentState.tabs.map((tab) => ({
          ...tab,
          document: { ...tab.document },
          snapshotRevision: kernel.revisionPort.readLiveRevision(tab.id),
        }));
        events.push(["snapshot", options, snapshot]);
        return snapshot;
      },
    },
    tabRuntimePort: {
      release(tabId) {
        events.push(["release", tabId]);
        return kernel.tabRuntimePort.release(tabId);
      },
    },
    timerPort: {
      clearInterval(timer) {
        clearedIntervals.push(timer);
      },
      setInterval(callback, delay) {
        const timer = { callback, delay };
        intervals.push(timer);
        return timer;
      },
    },
  });

  const mutateTab = (tabId, patch = {}) => {
    const mutation = kernel.revisionPort.recordMutation(tabId);
    const nextTabs = documentState.tabs.map((tab) => (
      tab.id === tabId
        ? {
            ...tab,
            ...patch,
            dirty: true,
            recoveryRevision: null,
          }
        : tab
    ));
    documentState = {
      ...documentState,
      tabs: nextTabs,
      ...(documentState.activeTabId === tabId
        ? {
            dirty: true,
            document: nextTabs.find((tab) => tab.id === tabId).document,
            currentPath: nextTabs.find((tab) => tab.id === tabId).path,
          }
        : {}),
    };
    return mutation;
  };

  return {
    clearedIntervals,
    controller,
    events,
    intervals,
    kernel,
    lifecycle,
    mutateTab,
    read: () => ({
      activePane,
      blockedByResearch,
      closePending,
      documentState,
      groups,
      saveTargetId,
      saveTargetIsRightSplit,
      session,
    }),
    setBlockedByResearch(value) {
      blockedByResearch = value;
    },
    setClosePending(value) {
      closePending = value;
    },
    setNow(value) {
      currentNow = value;
    },
    setSaveTarget(tabId, isRightSplit = false) {
      saveTargetId = tabId;
      saveTargetIsRightSplit = isRightSplit;
    },
    setTab(tabId, patch) {
      documentState = {
        ...documentState,
        tabs: documentState.tabs.map((tab) => (
          tab.id === tabId ? { ...tab, ...patch } : tab
        )),
      };
    },
  };
}

test("save-during-edit writes the captured disk version then queues the newer live version to recovery", async () => {
  const initialDiskRevision = diskRevision("a", 100);
  const committedDiskRevision = diskRevision("b", 200);
  const initialDocument = createTestDocument("Before save");
  const newerDocument = {
    ...initialDocument,
    title: "Edited while saving",
    html: "<p>newer</p>",
  };
  const diskWrite = deferred();
  const recoveryWrites = [];
  const harness = createPersistenceHarness({
    onSaveDocument: () => diskWrite.promise,
    onSaveTempDocument: async (document, recoveryId) => {
      recoveryWrites.push({ document, recoveryId });
      return {
        path: "C:\\recovery\\tab-a.letterpaper",
        recoveryId: "tab-a",
      };
    },
    tabs: [createTestTab("tab-a", {
      diskRevision: initialDiskRevision,
      document: initialDocument,
    })],
  });

  const saving = harness.controller.save(false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    harness.events.filter(([kind]) => kind === "save-document").length,
    1,
  );
  harness.mutateTab("tab-a", { document: newerDocument });
  diskWrite.resolve({
    canceled: false,
    diskRevision: committedDiskRevision,
    document: initialDocument,
    path: "C:\\letters\\tab-a.letterpaper",
  });
  const result = await saving;
  const savedTab = harness.read().documentState.tabs[0];

  assert.equal(result.status, "saved-with-newer-edits");
  assert.equal(recoveryWrites.length, 1);
  assert.equal(recoveryWrites[0].document.title, "Edited while saving");
  assert.equal(savedTab.dirty, true);
  assert.equal(savedTab.recoveryPath, "C:\\recovery\\tab-a.letterpaper");
  assert.equal(savedTab.recoverySourcePath, savedTab.path);
  assert.deepEqual(savedTab.recoveryBaseRevision, committedDiskRevision);
  assert.equal(savedTab.recoveryRevision, 2);
  assert.equal(harness.kernel.dirtyPort.isDirty("tab-a"), true);
  assert.equal(harness.kernel.dirtyPort.readRecoveryRevision("tab-a"), 2);
  assert.deepEqual(
    harness.kernel.revisionPort.readDiskRevision("tab-a"),
    committedDiskRevision,
  );
  assert.equal(
    harness.events.some(
      ([kind, message]) => kind === "status"
        && message === "已写入点击保存时的版本；保存期间的新编辑已写入恢复缓存",
    ),
    true,
  );
  assert.deepEqual(
    harness.events
      .filter(([kind]) => kind === "save-document" || kind === "save-temp")
      .map(([kind]) => kind),
    ["save-document", "save-temp"],
  );
});

test("Save As migrates the AI request runtime key exactly once", async () => {
  const harness = createPersistenceHarness({
    tabs: [createTestTab("tab-a", { path: "" })],
  });
  const result = await harness.controller.save(true);
  const migrations = harness.events.filter(
    ([kind]) => kind === "migrate-key",
  );

  assert.equal(result.status, "saved");
  assert.deepEqual(migrations, [[
    "migrate-key",
    documentRuntimeKey("", "tab-a"),
    documentRuntimeKey(result.tab.path, "tab-a"),
  ]]);
});

test("save conflict compare, reload, overwrite, and cancel preserve their distinct contracts", async (t) => {
  const actualRevision = diskRevision("c", 300);
  const committedRevision = diskRevision("d", 400);

  await t.test("compare", async () => {
    const harness = createPersistenceHarness({
      onSaveDocument: async () => ({
        actualRevision,
        conflict: true,
        conflictCopyPath: "C:\\letters\\conflict-copy.letterpaper",
      }),
      resolveSaveConflict: async () => "compare",
    });
    const result = await harness.controller.save(false);
    assert.equal(result.status, "comparison-opened");
    assert.equal(harness.read().documentState.tabs[0].externalChanged, true);
    const comparison = harness.events.find(([kind]) => kind === "comparison");
    assert.match(comparison[1].document.title, /（磁盘版本对照）$/);
    assert.equal(
      harness.events.filter(([kind]) => kind === "open").length,
      1,
    );
  });

  await t.test("reload", async () => {
    const recoveryPath = "C:\\recovery\\tab-a.letterpaper";
    const harness = createPersistenceHarness({
      onOpenDocumentPath: async (path) => ({
        canceled: false,
        diskRevision: committedRevision,
        document: createTestDocument("Reloaded"),
        path,
      }),
      onSaveDocument: async () => ({
        actualRevision,
        conflict: true,
        conflictCopyPath: "copy",
      }),
      resolveSaveConflict: async () => "reload",
      tabs: [createTestTab("tab-a", {
        recoveryId: "recovery-a",
        recoveryPath,
      })],
    });
    const result = await harness.controller.save(false);
    const tab = harness.read().documentState.tabs[0];
    assert.equal(result.status, "reloaded");
    assert.equal(tab.document.title, "Reloaded");
    assert.equal(tab.dirty, false);
    assert.equal(tab.externalChanged, false);
    assert.equal(tab.recoveryPath, "");
    assert.deepEqual(
      harness.kernel.revisionPort.readDiskRevision("tab-a"),
      committedRevision,
    );
    assert.equal(harness.kernel.dirtyPort.isDirty("tab-a"), false);
    assert.equal(
      harness.events.some(
        ([kind, id]) => kind === "delete-temp" && id === "recovery-a",
      ),
      true,
    );
    assert.equal(
      harness.events.some(([kind]) => kind === "apply"),
      true,
    );
  });

  await t.test("overwrite", async () => {
    const calls = [];
    const harness = createPersistenceHarness({
      onSaveDocument: async (...args) => {
        calls.push(args);
        if (calls.length === 1) {
          return {
            actualRevision,
            conflict: true,
            conflictCopyPath: "copy",
          };
        }
        return {
          diskRevision: committedRevision,
          document: args[0],
          path: args[1],
        };
      },
      resolveSaveConflict: async () => "overwrite",
    });
    const result = await harness.controller.save(true);
    assert.equal(result.status, "saved");
    assert.equal(calls.length, 2);
    assert.equal(calls[0][2], true);
    assert.equal(calls[1][2], false);
    assert.deepEqual(calls[1][4], actualRevision);
    assert.deepEqual(calls[1][5], { conflictAction: "overwrite" });
    assert.equal(harness.read().documentState.tabs[0].dirty, false);
  });

  await t.test("cancel", async () => {
    const harness = createPersistenceHarness({
      onSaveDocument: async () => ({
        actualRevision,
        conflict: true,
        conflictCopyPath: "copy",
      }),
      resolveSaveConflict: async () => "cancel",
    });
    const result = await harness.controller.save(false);
    assert.equal(result.status, "conflict-preserved");
    assert.equal(harness.read().documentState.tabs[0].externalChanged, true);
    assert.equal(
      harness.events.filter(([kind]) => kind === "save-document").length,
      1,
    );
    assert.equal(
      harness.events.filter(([kind]) => kind === "open").length,
      0,
    );
  });
});

test("single-tab close holds the autosave gate and rejects a stale confirmation", async () => {
  const confirmation = deferred();
  const tempWrites = [];
  const harness = createPersistenceHarness({
    confirmTabClose: () => confirmation.promise,
    onSaveTempDocument: async (...args) => {
      tempWrites.push(args);
      return { path: "unexpected" };
    },
  });

  const closing = harness.controller.closeTab("tab-a");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    harness.controller.diskMutationBarrierPort.hasPending("tab-a"),
    true,
  );
  const autosave = await harness.controller.runRecoveryAutosave();
  assert.equal(autosave.status, "empty");
  assert.equal(tempWrites.length, 0);

  harness.mutateTab("tab-a", {
    document: createTestDocument("Changed during confirm"),
  });
  confirmation.resolve("close");
  const result = await closing;

  assert.equal(result.status, "changed");
  assert.equal(
    harness.controller.diskMutationBarrierPort.hasPending("tab-a"),
    false,
  );
  assert.equal(
    harness.events.some(([kind]) => kind === "release"),
    false,
  );
  assert.equal(
    harness.events.some(
      ([kind, message]) => kind === "status"
        && message === "关闭确认期间信笺又有修改，请再次确认",
    ),
    true,
  );
});

test("closing the last tab cleans recovery and installs one blank primary tab", async () => {
  const harness = createPersistenceHarness({
    tabs: [createTestTab("tab-a", {
      dirty: false,
      recoveryId: "recovery-a",
      recoveryPath: "C:\\recovery\\tab-a.letterpaper",
    })],
  });
  const result = await harness.controller.closeTab("tab-a");
  const state = harness.read();

  assert.equal(result.status, "closed");
  assert.equal(state.documentState.tabs.length, 1);
  assert.notEqual(state.documentState.tabs[0].id, "tab-a");
  assert.equal(state.documentState.activeTabId, state.documentState.tabs[0].id);
  assert.equal(state.groups.primary.views.length, 1);
  assert.equal(state.activePane, "main");
  assert.equal(
    harness.events.some(
      ([kind, value]) => kind === "delete-temp" && value === "recovery-a",
    ),
    true,
  );
  assert.equal(
    harness.events.some(
      ([kind, value]) => kind === "release" && value === "tab-a",
    ),
    true,
  );
});

test("window close cancel is single-shot, reentrant-safe, and resets the close gate", async () => {
  const confirmation = deferred();
  const harness = createPersistenceHarness({
    confirmWindowClose: () => confirmation.promise,
  });
  const payload = { reason: "window" };
  const first = harness.controller.closeWindow(payload);
  await new Promise((resolve) => setImmediate(resolve));
  const second = await harness.controller.closeWindow(payload);
  assert.equal(second.status, "pending");
  confirmation.resolve("cancel");
  const result = await first;

  assert.equal(result.status, "canceled");
  assert.equal(harness.read().closePending, false);
  assert.equal(
    harness.events.filter(([kind]) => kind === "close-canceled").length,
    1,
  );
  assert.equal(
    harness.events.filter(([kind]) => kind === "close-ready").length,
    0,
  );
  assert.equal(
    harness.events.filter(([kind]) => kind === "end-close").length,
    1,
  );
});

test("window save-close persists named and unnamed tabs then sends closeReady exactly once", async () => {
  const named = createTestTab("named");
  const unnamed = createTestTab("unnamed", {
    diskRevision: null,
    path: "",
  });
  const harness = createPersistenceHarness({
    tabs: [named, unnamed],
  });
  const payload = { reason: "update" };
  const result = await harness.controller.closeWindow(payload);
  const sessionTabs = harness.read().session.tabs;

  assert.equal(result.status, "ready");
  assert.equal(sessionTabs.length, 2);
  assert.equal(sessionTabs[0].path, named.path);
  assert.equal(sessionTabs[0].recoveryPath, "");
  assert.equal(sessionTabs[1].path, "");
  assert.match(sessionTabs[1].recoveryPath, /C:\\recovery\\/);
  assert.equal(harness.read().closePending, true);
  assert.equal(
    harness.events.filter(([kind]) => kind === "close-ready").length,
    1,
  );
  assert.equal(
    harness.events.filter(([kind]) => kind === "close-canceled").length,
    0,
  );
  const repeated = await harness.controller.closeWindow(payload);
  assert.equal(repeated.status, "pending");
  assert.equal(
    harness.events.filter(([kind]) => kind === "close-ready").length,
    1,
  );
});

test("window close commits a returned disk revision but cancels when the live revision changes during save", async () => {
  const write = deferred();
  const nextDiskRevision = diskRevision("e", 500);
  const harness = createPersistenceHarness({
    onSaveDocument: () => write.promise,
  });
  const closing = harness.controller.closeWindow({ reason: "window" });
  await new Promise((resolve) => setImmediate(resolve));
  harness.mutateTab("tab-a", {
    document: createTestDocument("Changed during close save"),
  });
  write.resolve({
    diskRevision: nextDiskRevision,
    document: createTestDocument("Saved snapshot"),
    path: "C:\\letters\\tab-a.letterpaper",
  });
  const result = await closing;

  assert.equal(result.status, "changed");
  assert.deepEqual(
    harness.kernel.revisionPort.readDiskRevision("tab-a"),
    nextDiskRevision,
  );
  assert.equal(harness.read().closePending, false);
  assert.equal(
    harness.events.filter(([kind]) => kind === "close-canceled").length,
    1,
  );
  assert.equal(
    harness.events.filter(([kind]) => kind === "close-ready").length,
    0,
  );
});

test("recovery autosave respects close and disk-mutation gates then commits only an unchanged target", async () => {
  const recoveryWrite = deferred();
  const writes = [];
  const harness = createPersistenceHarness({
    onSaveTempDocument: (...args) => {
      writes.push(args);
      return recoveryWrite.promise;
    },
  });

  harness.setClosePending(true);
  assert.equal(
    (await harness.controller.runRecoveryAutosave()).status,
    "gated",
  );
  harness.setClosePending(false);

  const barrier = await harness.controller.diskMutationBarrierPort.acquire([
    "tab-a",
  ]);
  assert.equal(
    (await harness.controller.runRecoveryAutosave()).status,
    "empty",
  );
  barrier.release();

  const first = harness.controller.runRecoveryAutosave();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await harness.controller.runRecoveryAutosave()).status,
    "gated",
  );
  recoveryWrite.resolve({
    path: "C:\\recovery\\tab-a.letterpaper",
    recoveryId: "recovery-a",
  });
  const result = await first;
  const tab = harness.read().documentState.tabs[0];

  assert.equal(result.status, "saved");
  assert.equal(writes.length, 1);
  assert.equal(tab.recoveryPath, "C:\\recovery\\tab-a.letterpaper");
  assert.equal(tab.recoverySourcePath, tab.path);
  assert.equal(tab.recoveryRevision, 1);
  assert.equal(
    harness.kernel.dirtyPort.readRecoveryRevision("tab-a"),
    1,
  );
  assert.equal(harness.read().session.tabs[0].recoveryId, "recovery-a");
});

test("the disk mutation barrier shares the tab queue and exposes no D3 dependency", async () => {
  const heldWrite = deferred();
  const harness = createPersistenceHarness();
  const queued = harness.kernel.saveQueuePort.enqueue(
    "tab-a",
    () => heldWrite.promise,
  );
  let acquired = false;
  const acquiring = harness.controller.diskMutationBarrierPort
    .acquire(["tab-a", "tab-a"])
    .then((barrier) => {
      acquired = true;
      return barrier;
    });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(acquired, false);
  assert.equal(
    harness.controller.diskMutationBarrierPort.hasPending("tab-a"),
    true,
  );
  assert.equal(
    (await harness.controller.runRecoveryAutosave()).status,
    "empty",
  );

  heldWrite.resolve("written");
  await queued;
  const barrier = await acquiring;
  assert.deepEqual(barrier.tabIds, ["tab-a"]);
  assert.equal(barrier.release(), true);
  assert.equal(barrier.release(), false);
  assert.equal(
    harness.controller.diskMutationBarrierPort.hasPending("tab-a"),
    false,
  );
});

test("recreated controllers share persistence gates and error throttling through one runtime", async () => {
  const runtimeState = createDocumentPersistenceRuntimeState();
  const firstBarrierHarness = createPersistenceHarness({ runtimeState });
  const secondBarrierHarness = createPersistenceHarness({ runtimeState });
  const barrier = await firstBarrierHarness.controller.diskMutationBarrierPort
    .acquire(["tab-a"]);

  assert.equal(
    secondBarrierHarness.controller.diskMutationBarrierPort.hasPending("tab-a"),
    true,
  );
  assert.equal(
    (await secondBarrierHarness.controller.runRecoveryAutosave()).status,
    "empty",
  );
  barrier.release();
  assert.equal(
    secondBarrierHarness.controller.diskMutationBarrierPort.hasPending("tab-a"),
    false,
  );

  const recoveryWrite = deferred();
  const firstAutosaveHarness = createPersistenceHarness({
    onSaveTempDocument: () => recoveryWrite.promise,
    runtimeState,
  });
  const secondAutosaveHarness = createPersistenceHarness({ runtimeState });
  const runningAutosave = firstAutosaveHarness.controller.runRecoveryAutosave();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await secondAutosaveHarness.controller.runRecoveryAutosave()).status,
    "gated",
  );
  recoveryWrite.resolve({
    path: "C:\\recovery\\tab-a.letterpaper",
    recoveryId: "recovery-a",
  });
  await runningAutosave;

  const firstErrorHarness = createPersistenceHarness({
    onSaveTempDocument: async () => {
      throw new Error("first shared failure");
    },
    runtimeState,
  });
  const secondErrorHarness = createPersistenceHarness({
    onSaveTempDocument: async () => {
      throw new Error("second shared failure");
    },
    runtimeState,
  });
  await firstErrorHarness.controller.runRecoveryAutosave();
  await secondErrorHarness.controller.runRecoveryAutosave();

  assert.equal(
    firstErrorHarness.events.filter(([kind]) => kind === "status").length,
    1,
  );
  assert.equal(
    secondErrorHarness.events.filter(([kind]) => kind === "status").length,
    0,
  );
});

test("workspace flush advances disk revision before stale recheck and retains dirty recovery state", async () => {
  const write = deferred();
  const nextDiskRevision = diskRevision("f", 600);
  const recoveryPath = "C:\\recovery\\tab-a.letterpaper";
  const harness = createPersistenceHarness({
    onSaveDocument: () => write.promise,
    tabs: [createTestTab("tab-a", {
      recoveryId: "recovery-a",
      recoveryPath,
      recoveryRevision: 1,
    })],
  });

  const flushing = harness.controller.flushDirtyWorkspaceTabs({
    idleOnly: false,
  });
  await new Promise((resolve) => setImmediate(resolve));
  harness.mutateTab("tab-a", {
    document: createTestDocument("Edited during flush"),
  });
  write.resolve({
    diskRevision: nextDiskRevision,
    document: createTestDocument("Flushed snapshot"),
    path: "C:\\letters\\tab-a.letterpaper",
  });
  const result = await flushing;
  const tab = harness.read().documentState.tabs[0];

  assert.deepEqual(
    harness.kernel.revisionPort.readDiskRevision("tab-a"),
    nextDiskRevision,
  );
  assert.equal(result.writtenTabIds.length, 0);
  assert.equal(tab.dirty, true);
  assert.equal(tab.recoveryPath, recoveryPath);
  assert.equal(
    harness.events.some(([kind]) => kind === "delete-temp"),
    false,
  );
  assert.equal(
    harness.events.filter(([kind]) => kind === "session").length,
    1,
  );
});

test("workspace idle/blur lifecycle preserves both 30s schedules and conflict handling", async () => {
  const harness = createPersistenceHarness({
    lastEditAtByTab: {
      "tab-a": 1_000_000,
    },
    now: 1_000_000,
    onSaveDocument: async () => ({
      conflict: true,
      conflictCopyPath: "copy",
    }),
  });
  const dispose = harness.controller.startLifecycle();

  assert.deepEqual(
    harness.intervals.map((timer) => timer.delay),
    [RECOVERY_AUTOSAVE_INTERVAL_MS, WORKSPACE_FLUSH_INTERVAL_MS],
  );
  assert.equal(RECOVERY_AUTOSAVE_INTERVAL_MS, 30_000);
  assert.equal(WORKSPACE_FLUSH_INTERVAL_MS, 30_000);
  assert.equal(WORKSPACE_IDLE_FLUSH_AGE_MS, 300_000);
  assert.equal(PERSISTENCE_ERROR_NOTICE_INTERVAL_MS, 300_000);

  await harness.intervals[1].callback();
  assert.equal(
    harness.events.filter(([kind]) => kind === "save-document").length,
    0,
  );
  await harness.lifecycle.blur();
  assert.equal(
    harness.events.filter(([kind]) => kind === "save-document").length,
    1,
  );
  assert.equal(harness.read().documentState.tabs[0].externalChanged, true);
  assert.equal(
    harness.events.some(
      ([kind, message]) => kind === "status"
        && message === "检测到外部版本；本机稿已保留为冲突副本",
    ),
    true,
  );

  dispose();
  assert.equal(harness.clearedIntervals.length, 2);
  assert.equal(harness.lifecycle.close, null);
  assert.equal(harness.lifecycle.blur, null);
});

test("one lifecycle subscription delegates close, autosave, and flush work to the latest controller", async () => {
  const runtimeState = createDocumentPersistenceRuntimeState();
  const lifecycleHarness = createPersistenceHarness({ runtimeState });
  const latestHarness = createPersistenceHarness({ runtimeState });
  let currentController = lifecycleHarness.controller;
  const dispose = lifecycleHarness.controller.startLifecycle({
    resolveController: () => currentController,
  });
  currentController = latestHarness.controller;

  assert.equal(lifecycleHarness.intervals.length, 2);
  assert.equal(latestHarness.intervals.length, 0);

  await lifecycleHarness.intervals[0].callback();
  assert.equal(
    latestHarness.events.filter(([kind]) => kind === "save-temp").length,
    1,
  );
  assert.equal(
    lifecycleHarness.events.filter(([kind]) => kind === "save-temp").length,
    0,
  );
  await new Promise((resolve) => setImmediate(resolve));

  await lifecycleHarness.intervals[1].callback();
  assert.equal(
    latestHarness.events.filter(([kind]) => kind === "save-document").length,
    1,
  );
  await new Promise((resolve) => setImmediate(resolve));
  latestHarness.mutateTab("tab-a", {
    document: createTestDocument("Edited before blur"),
  });
  await lifecycleHarness.lifecycle.blur();
  assert.equal(
    latestHarness.events.filter(([kind]) => kind === "save-document").length,
    2,
  );

  await lifecycleHarness.lifecycle.close({ reason: "window" });
  assert.equal(
    latestHarness.events.filter(([kind]) => kind === "close-ready").length,
    1,
  );
  assert.equal(
    lifecycleHarness.events.filter(([kind]) => kind === "close-ready").length,
    0,
  );

  dispose();
  assert.equal(lifecycleHarness.clearedIntervals.length, 2);
});

test("persistence controller remains free of React, bridge, icon, and D3 imports", async () => {
  const source = await readFile(
    new URL(
      "./document-workspace/document-persistence-controller.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /from\s+["']react["']|useEffect|useCallback|useRef|window\.|bridge\.|lucide-react|\b(?:FileText|RefreshCw|Trash2)\b/,
  );
  assert.doesNotMatch(
    source,
    /workspace-file-controller|workspace-file-lifecycle|controllers\//,
  );
  assert.match(source, /diskMutationBarrierPort/);
  assert.match(source, /applicationPort\.readSaveContext/);
  assert.match(source, /dialogPort\.confirmWindowClose/);
});
