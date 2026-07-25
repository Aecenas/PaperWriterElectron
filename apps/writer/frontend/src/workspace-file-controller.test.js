import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceFileController } from "./controllers/workspace-file-controller.js";

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function diskRevision(seed) {
  return {
    size: seed,
    mtimeMs: seed * 10,
    sha256: String(seed).padStart(64, "0"),
  };
}

function createHarness({
  activeTabId: initialActiveTabId = "",
  currentDocument: initialDocument = { title: "Current" },
  currentPath: initialCurrentPath = "",
  expanded: initialExpanded = {},
  folderState: initialFolderState = {
    rootPath: "C:\\Root",
    path: "C:\\Root",
    parentPath: "C:\\",
    folders: [],
    files: [],
    entries: [],
    loading: false,
    error: "",
  },
  focusedDocumentTabId = "",
  io: ioOverrides = {},
  promptValues = [],
  revisions: initialRevisions = {},
  rightSplitTabId = "",
  tabs: initialTabs = [],
} = {}) {
  let activeTabId = initialActiveTabId;
  let currentDocument = initialDocument;
  let currentPath = initialCurrentPath;
  let expanded = initialExpanded;
  let folderPath = initialFolderState.path;
  let folderState = initialFolderState;
  let rightSplit = rightSplitTabId;
  let tabs = initialTabs;
  let tabSequence = 0;
  const events = [];
  const prompts = [...promptValues];
  const diskRevisions = new Map(Object.entries(initialRevisions));

  const callIo = async (name, args, fallback) => {
    events.push(["io", name, ...args]);
    if (typeof ioOverrides[name] === "function") {
      return ioOverrides[name](...args);
    }
    if (Object.hasOwn(ioOverrides, name)) return ioOverrides[name];
    return typeof fallback === "function" ? fallback() : fallback;
  };

  const ioPort = {
    backupDocument: (path) => callIo(
      "backupDocument",
      [path],
      { ok: true, folderPath: folderState.path },
    ),
    cancelFolderSearch: (rootPath, requestId) => callIo(
      "cancelFolderSearch",
      [rootPath, requestId],
      undefined,
    ),
    createDocumentInFolder: (path, title, document) => callIo(
      "createDocumentInFolder",
      [path, title, document],
      {
        ok: true,
        path: `${path}\\${title}.letterpaper`,
        document,
      },
    ),
    createFolder: (path, name) => callIo(
      "createFolder",
      [path, name],
      { ok: true },
    ),
    debugLog(name, payload) {
      events.push(["debug", name, payload]);
    },
    deleteEntry: (path) => callIo(
      "deleteEntry",
      [path],
      { ok: true, folderPath: folderState.path },
    ),
    getDocumentRevision: (path) => callIo(
      "getDocumentRevision",
      [path],
      { diskRevision: null },
    ),
    getPaths: () => callIo(
      "getPaths",
      [],
      { documents: "" },
    ),
    importDocument: () => callIo(
      "importDocument",
      [],
      { canceled: true },
    ),
    listFolder: (path) => callIo(
      "listFolder",
      [path],
      {
        folderPath: path,
        parentPath: "",
        folders: [],
        files: [],
      },
    ),
    moveEntry: (path, targetFolderPath) => callIo(
      "moveEntry",
      [path, targetFolderPath],
      { ok: true, oldPath: path, path: `${targetFolderPath}\\Moved` },
    ),
    openDocument: () => callIo(
      "openDocument",
      [],
      { canceled: true },
    ),
    openDocumentPath: (path) => callIo(
      "openDocumentPath",
      [path],
      { canceled: true },
    ),
    openFolder: () => callIo(
      "openFolder",
      [],
      { canceled: true },
    ),
    renameEntry: (path, nextName) => callIo(
      "renameEntry",
      [path, nextName],
      { ok: true, path },
    ),
    searchFolder: (options) => callIo(
      "searchFolder",
      [options],
      { results: [] },
    ),
    watchWorkspace: (rootPath) => callIo(
      "watchWorkspace",
      [rootPath],
      undefined,
    ),
  };

  const folderPort = {
    readExpanded: () => expanded,
    readPath: () => folderPath,
    readState: () => folderState,
    updateExpanded(updater) {
      expanded = typeof updater === "function" ? updater(expanded) : updater;
      events.push(["expanded-state", expanded]);
      return expanded;
    },
    updateState(updater) {
      folderState = typeof updater === "function" ? updater(folderState) : updater;
      events.push(["folder-state", folderState]);
      return folderState;
    },
    writeExpanded(next) {
      expanded = next;
      events.push(["expanded-ref", next]);
    },
    writePath(next) {
      folderPath = next;
      events.push(["folder-path", next]);
    },
  };

  const documentPort = {
    addOrActivate(document, path, dirty, options) {
      const id = `added-${++tabSequence}`;
      events.push(["add", document, path, dirty, options, id]);
      if (options?.rejectForTest) return "";
      tabs = [
        ...tabs,
        {
          id,
          title: document?.title || "",
          document,
          path,
          dirty,
          diskRevision: options?.diskRevision,
          readOnly: options?.readOnly,
        },
      ];
      activeTabId = id;
      currentDocument = document;
      currentPath = path;
      return id;
    },
    applyDocument(document, path, dirty, options) {
      currentDocument = document;
      currentPath = path;
      events.push(["apply-document", document, path, dirty, options]);
    },
    commitActiveTab(next) {
      activeTabId = next;
      events.push(["active-tab", next]);
    },
    commitCurrentPath(next) {
      currentPath = next;
      events.push(["current-path", next]);
    },
    commitDocument(next) {
      currentDocument = next;
      events.push(["current-document", next]);
    },
    commitTabs(next) {
      tabs = next;
      events.push(["tabs", next]);
    },
    read: () => ({
      activeTabId,
      currentPath,
      document: currentDocument,
      tabs,
    }),
    recordMutation(id, updatedAt) {
      events.push(["record-mutation", id, updatedAt]);
      tabs = tabs.map((tab) => (
        tab.id === id
          ? {
            ...tab,
            dirty: true,
            document: { ...tab.document, updatedAt },
          }
          : tab
      ));
    },
    selectTab(id) {
      activeTabId = id;
      events.push(["select-tab", id]);
    },
    snapshotTabs(options) {
      events.push(["snapshot", options]);
      return tabs.map((tab) => ({ ...tab }));
    },
  };

  const factories = {
    createBlank() {
      const blank = { title: "Blank", body: "<p></p>" };
      events.push(["create-blank", blank]);
      return blank;
    },
    createTab(document) {
      const tab = {
        id: "blank-tab",
        title: document.title,
        document,
        path: "",
        dirty: false,
      };
      events.push(["create-tab", tab]);
      return tab;
    },
    mergePersistedIdentity(document, persisted) {
      const merged = {
        ...document,
        documentId: persisted.documentId,
        createdAt: persisted.createdAt,
      };
      events.push(["merge-identity", document, persisted, merged]);
      return merged;
    },
    summarizeTabs(nextTabs) {
      const summary = nextTabs.map((tab) => ({
        id: tab.id,
        path: tab.path,
      }));
      events.push(["summarize-tabs", summary]);
      return summary;
    },
  };

  const revisionPort = {
    commitDiskRevision(id, revision) {
      diskRevisions.set(id, revision);
      events.push(["disk-revision", id, revision]);
    },
    readDiskRevision: (id) => diskRevisions.get(id) || null,
  };

  const groupPort = {
    clearRightSplit() {
      rightSplit = "";
      events.push(["clear-right-split"]);
    },
    commitActivePane(pane) {
      events.push(["active-pane", pane]);
    },
    read: () => ({
      focusedDocumentTabId,
      rightSplitTabId: rightSplit,
    }),
  };

  const sessionPort = {
    commitPatch(patch) {
      events.push(["session", patch]);
    },
  };

  const tabLifecyclePort = {
    releaseRuntime(id) {
      events.push(["release-runtime", id]);
    },
  };

  const uiPort = {
    icons: {
      filePlus: "file-plus",
      folderPlus: "folder-plus",
      pencil: "pencil",
    },
    async prompt(options) {
      events.push(["prompt", options]);
      return prompts.shift();
    },
    status(message, tone) {
      events.push(["status", message, tone]);
    },
  };

  const controller = createWorkspaceFileController({
    clock: {
      monotonicNow: (() => {
        const values = [100, 112.4];
        return () => values.shift() ?? 112.4;
      })(),
      nowIso: () => "2026-07-26T01:02:03.000Z",
    },
    documentPort,
    factories,
    folderPort,
    groupPort,
    ioPort,
    revisionPort,
    sessionPort,
    tabLifecyclePort,
    uiPort,
  });

  return {
    controller,
    events,
    read: () => ({
      activeTabId,
      currentDocument,
      currentPath,
      diskRevisions,
      expanded,
      folderPath,
      folderState,
      rightSplit,
      tabs,
    }),
    setActiveTabId(next) {
      activeTabId = next;
    },
    setCurrentPath(next) {
      currentPath = next;
    },
    setDiskRevision(id, revision) {
      if (revision) diskRevisions.set(id, revision);
      else diskRevisions.delete(id);
    },
    setTabs(next) {
      tabs = next;
    },
  };
}

function eventNames(events) {
  return events.map((event) => event[0] === "io" ? `io:${event[1]}` : event[0]);
}

test("folder selection resets root before publishing expansion UI and navigation is latest-wins", async () => {
  const firstNavigation = deferred();
  const secondNavigation = deferred();
  const harness = createHarness({
    expanded: {
      "C:\\Old\\Open": { expanded: true, entries: [{ path: "stale" }] },
    },
    io: {
      openFolder: {
        folderPath: "D:\\Workspace",
        parentPath: "D:\\",
        folders: [{ path: "D:\\Workspace\\Folder", type: "folder" }],
        files: [{ path: "D:\\Workspace\\Paper.letterpaper", type: "file" }],
      },
      listFolder(path) {
        if (path === "D:\\Workspace\\A") return firstNavigation.promise;
        if (path === "D:\\Workspace\\B") return secondNavigation.promise;
        throw new Error(`unexpected folder ${path}`);
      },
    },
  });

  await harness.controller.navigationPort.chooseFolder();
  assert.deepEqual(harness.read().folderState, {
    rootPath: "D:\\Workspace",
    path: "D:\\Workspace",
    parentPath: "D:\\",
    folders: [{ path: "D:\\Workspace\\Folder", type: "folder" }],
    files: [{ path: "D:\\Workspace\\Paper.letterpaper", type: "file" }],
    entries: [
      { path: "D:\\Workspace\\Folder", type: "folder" },
      { path: "D:\\Workspace\\Paper.letterpaper", type: "file" },
    ],
    loading: false,
    error: "",
  });
  assert.deepEqual(harness.read().expanded, {});
  const selectionEvents = eventNames(harness.events);
  assert.deepEqual(
    selectionEvents.slice(
      selectionEvents.indexOf("folder-path"),
      selectionEvents.indexOf("status") + 1,
    ),
    [
      "folder-path",
      "expanded-ref",
      "folder-state",
      "expanded-state",
      "status",
    ],
  );

  const navigateFirst = harness.controller.navigationPort.navigateFolder(
    "D:\\Workspace\\A",
  );
  const navigateSecond = harness.controller.navigationPort.navigateFolder(
    "D:\\Workspace\\B",
  );
  secondNavigation.resolve({
    folderPath: "d:\\workspace\\B\\",
    parentPath: "D:\\Workspace",
    entries: [{ path: "D:\\Workspace\\B\\current.letterpaper" }],
  });
  await navigateSecond;
  firstNavigation.resolve({
    folderPath: "D:\\Workspace\\A",
    entries: [{ path: "D:\\Workspace\\A\\stale.letterpaper" }],
  });
  await navigateFirst;

  assert.equal(harness.read().folderPath, "d:\\workspace\\B\\");
  assert.equal(harness.read().folderState.rootPath, "D:\\Workspace");
  assert.equal(harness.read().folderState.path, "d:\\workspace\\B\\");
  assert.deepEqual(
    harness.read().folderState.entries,
    [{ path: "D:\\Workspace\\B\\current.letterpaper" }],
  );
});

test("collapsed folder invalidates its in-flight branch result", async () => {
  const listing = deferred();
  const harness = createHarness({
    io: {
      listFolder: () => listing.promise,
    },
  });
  const path = "C:\\Root\\Drafts";

  const expand = harness.controller.navigationPort.toggleFolder(path);
  assert.deepEqual(harness.read().expanded[path], {
    expanded: true,
    loading: true,
    error: "",
  });
  await harness.controller.navigationPort.toggleFolder(path);
  assert.equal(harness.read().expanded[path].expanded, false);
  listing.resolve({
    entries: [{ path: `${path}\\late.letterpaper`, type: "file" }],
  });
  await expand;

  assert.equal(harness.read().expanded[path].expanded, false);
  assert.equal(harness.read().expanded[path].loading, false);
  assert.equal(harness.read().expanded[path].entries, undefined);
});

test("refresh publishes the returned canonical state path without rewriting the path mirror", async () => {
  const harness = createHarness({
    folderState: {
      rootPath: "C:\\Root",
      path: "C:\\Root\\Drafts",
      parentPath: "C:\\Root",
      folders: [],
      files: [],
      entries: [],
      loading: false,
      error: "",
    },
    io: {
      listFolder: {
        folderPath: "c:\\ROOT\\DRAFTS\\",
        parentPath: "c:\\ROOT",
        entries: [{ path: "c:\\ROOT\\DRAFTS\\Paper.letterpaper" }],
      },
    },
  });

  await harness.controller.navigationPort.refreshFolder();

  assert.equal(harness.read().folderPath, "C:\\Root\\Drafts");
  assert.equal(harness.read().folderState.path, "c:\\ROOT\\DRAFTS\\");
  assert.equal(harness.read().folderState.rootPath, "C:\\Root");
  assert.deepEqual(
    harness.read().folderState.entries,
    [{ path: "c:\\ROOT\\DRAFTS\\Paper.letterpaper" }],
  );
});

test("session folder restore selects the default Documents path through the shared view generation", async () => {
  const harness = createHarness({
    folderState: {
      rootPath: "",
      path: "",
      parentPath: "",
      folders: [],
      files: [],
      entries: [],
      loading: false,
      error: "",
    },
    io: {
      getPaths: {
        documents: "C:\\Users\\Writer\\Documents",
      },
      listFolder: {
        folderPath: "c:\\users\\writer\\Documents\\",
        parentPath: "C:\\Users\\Writer",
        folders: [{ path: "C:\\Users\\Writer\\Documents\\Drafts" }],
        files: [{ path: "C:\\Users\\Writer\\Documents\\Paper.letterpaper" }],
      },
    },
  });

  await harness.controller.lifecyclePort.restoreSessionFolder({
    isActiveRestore: () => true,
    savedFolderPath: "",
  });

  assert.deepEqual(
    harness.events
      .filter((event) => event[0] === "io")
      .map((event) => [event[1], event[2]]),
    [
      ["getPaths", undefined],
      ["listFolder", "C:\\Users\\Writer\\Documents"],
    ],
  );
  assert.equal(
    harness.read().folderPath,
    "c:\\users\\writer\\Documents\\",
  );
  assert.equal(
    harness.read().folderState.rootPath,
    "C:\\Users\\Writer\\Documents",
  );
  assert.equal(
    harness.read().folderState.path,
    "c:\\users\\writer\\Documents\\",
  );
  assert.deepEqual(
    harness.events.find(
      (event) => (
        event[0] === "debug"
        && event[1] === "renderer:restore:folder-selected"
      ),
    )[2],
    {
      folderPath: "C:\\Users\\Writer\\Documents",
      source: "documents-default",
    },
  );
  assert.equal(
    harness.events.some((event) => event[0] === "session"),
    false,
  );
});

test("failed saved-folder restore retries Documents and clears the persisted active path", async () => {
  const harness = createHarness({
    io: {
      getPaths: {
        documents: "C:\\Users\\Writer\\Documents",
      },
      listFolder(path) {
        if (path === "Z:\\Missing") {
          throw new Error("missing folder");
        }
        return {
          folderPath: "C:\\Users\\Writer\\Documents",
          parentPath: "C:\\Users\\Writer",
          entries: [{ path: `${path}\\Recovered.letterpaper` }],
        };
      },
    },
  });

  await harness.controller.lifecyclePort.restoreSessionFolder({
    isActiveRestore: () => true,
    savedFolderPath: "Z:\\Missing",
  });

  assert.deepEqual(
    harness.events
      .filter((event) => event[0] === "io")
      .map((event) => [event[1], event[2]]),
    [
      ["listFolder", "Z:\\Missing"],
      ["getPaths", undefined],
      ["listFolder", "C:\\Users\\Writer\\Documents"],
    ],
  );
  assert.equal(
    harness.read().folderState.rootPath,
    "C:\\Users\\Writer\\Documents",
  );
  assert.equal(
    harness.events.some((event) => (
      event[0] === "debug"
      && event[1] === "renderer:restore:folder-fallback"
      && event[2].message === "missing folder"
    )),
    true,
  );
  assert.deepEqual(
    harness.events.find((event) => event[0] === "session"),
    [
      "session",
      {
        folderPath: "C:\\Users\\Writer\\Documents",
        activePath: "",
      },
    ],
  );
});

test("new folder navigation invalidates a pending session-folder restore without fallback", async () => {
  const restoreListing = deferred();
  const harness = createHarness({
    io: {
      getPaths() {
        throw new Error("fallback must not run for a stale request");
      },
      listFolder(path) {
        if (path === "Z:\\Saved") return restoreListing.promise;
        if (path === "D:\\UserChoice") {
          return {
            folderPath: "D:\\UserChoice",
            entries: [{ path: "D:\\UserChoice\\Current.letterpaper" }],
          };
        }
        throw new Error(`unexpected path ${path}`);
      },
    },
  });

  const restore = harness.controller.lifecyclePort.restoreSessionFolder({
    isActiveRestore: () => true,
    savedFolderPath: "Z:\\Saved",
  });
  await harness.controller.navigationPort.navigateFolder("D:\\UserChoice");
  restoreListing.reject(new Error("saved folder unavailable"));
  await restore;

  assert.equal(harness.read().folderPath, "D:\\UserChoice");
  assert.equal(harness.read().folderState.path, "D:\\UserChoice");
  assert.deepEqual(
    harness.read().folderState.entries,
    [{ path: "D:\\UserChoice\\Current.letterpaper" }],
  );
  assert.equal(
    harness.events.some(
      (event) => event[0] === "io" && event[1] === "getPaths",
    ),
    false,
  );
});

test("new, picker-open, import, path-open, and existing-path selection keep their call shapes", async () => {
  const openedRevision = diskRevision(1);
  const harness = createHarness({
    activeTabId: "existing-other",
    io: {
      importDocument: {
        document: { title: "Imported" },
        warnings: ["table", "font"],
      },
      openDocument: {
        document: { title: "Picker" },
        path: "C:\\Root\\Picker.letterpaper",
        diskRevision: openedRevision,
        readOnly: true,
      },
      openDocumentPath: {
        document: { title: "Direct" },
        path: "C:\\Root\\Direct.letterpaper",
        diskRevision: diskRevision(2),
        readOnly: false,
      },
    },
    tabs: [{
      id: "existing",
      path: "C:\\ROOT\\Already.letterpaper",
      document: { title: "Already" },
      dirty: false,
    }],
  });

  const existingId = await harness.controller.openPort.openDocumentPath(
    "c:/root/already.letterpaper",
  );
  const blankId = harness.controller.openPort.newDocument("secondary");
  const pickerId = await harness.controller.openPort.openDocument();
  const importedId = await harness.controller.openPort.importDocument();
  const directId = await harness.controller.openPort.openDocumentPath(
    "C:\\Root\\Direct.letterpaper",
  );

  assert.equal(existingId, "existing");
  assert.match(blankId, /^added-/);
  assert.match(pickerId, /^added-/);
  assert.match(importedId, /^added-/);
  assert.match(directId, /^added-/);
  assert.equal(
    harness.events.filter(
      (event) => event[0] === "io" && event[1] === "openDocumentPath",
    ).length,
    1,
  );
  assert.deepEqual(
    harness.events.find((event) => event[0] === "select-tab"),
    ["select-tab", "existing"],
  );
  const addEvents = harness.events.filter((event) => event[0] === "add");
  assert.deepEqual(addEvents[0].slice(2, 5), ["", false, { groupId: "secondary" }]);
  assert.deepEqual(addEvents[1].slice(2, 5), [
    "C:\\Root\\Picker.letterpaper",
    false,
    { diskRevision: openedRevision, readOnly: true },
  ]);
  assert.deepEqual(addEvents[2].slice(2, 5), [
    "",
    true,
    { replaceBlank: true },
  ]);
  assert.deepEqual(
    harness.events.find((event) => event[0] === "debug"),
    [
      "debug",
      "renderer:document:open-path:return",
      {
        path: "C:\\Root\\Direct.letterpaper",
        canceled: false,
        hasDocument: true,
        ipcMs: 12,
      },
    ],
  );
  assert.equal(
    harness.events.some((event) => (
      event[0] === "status"
      && event[1] === "文档已导入；2 项内容已降级，保存后才会生成 .letterpaper"
      && event[2] === "warning"
    )),
    true,
  );
});

test("tree creation passes untrimmed names and refreshes before opening the new document", async () => {
  const harness = createHarness({
    promptValues: ["  Folder Name  ", "  Letter Name  "],
    io: {
      createDocumentInFolder(path, title, blank) {
        return {
          ok: true,
          path: `${path}\\Letter Name.letterpaper`,
          document: { ...blank, title: title.trim() },
          diskRevision: diskRevision(3),
        };
      },
    },
  });

  await harness.controller.mutationPort.createFolder(null);
  await harness.controller.mutationPort.createDocument(null);

  const createFolderEvent = harness.events.find(
    (event) => event[0] === "io" && event[1] === "createFolder",
  );
  const createDocumentEvent = harness.events.find(
    (event) => event[0] === "io" && event[1] === "createDocumentInFolder",
  );
  assert.equal(createFolderEvent[3], "  Folder Name  ");
  assert.equal(createDocumentEvent[3], "  Letter Name  ");
  const names = eventNames(harness.events);
  const createDocumentIndex = names.indexOf("io:createDocumentInFolder");
  const refreshIndex = names.indexOf("io:listFolder", createDocumentIndex);
  const addIndex = names.indexOf("add", createDocumentIndex);
  assert.ok(refreshIndex > createDocumentIndex);
  assert.ok(addIndex > refreshIndex);
});

test("rename uses the input prefix, marks a file dirty, and leaves recovery identity untouched", async () => {
  const originalRecovery = "C:\\Recovery\\source.letterpaper";
  const harness = createHarness({
    activeTabId: "paper",
    currentDocument: {
      title: "Old",
      stableField: true,
    },
    currentPath: "c:/root/OLD.letterpaper",
    promptValues: ["  Renamed  "],
    io: {
      renameEntry: {
        ok: true,
        oldPath: "C:\\Wrong\\ServerOld.letterpaper",
        path: "C:\\Root\\Renamed.letterpaper",
        folderPath: "C:\\Root",
      },
    },
    tabs: [{
      id: "paper",
      title: "Old",
      path: "C:\\Root\\Old.letterpaper",
      recoverySourcePath: originalRecovery,
      document: { title: "Old", stableField: true },
      dirty: false,
    }],
  });

  await harness.controller.mutationPort.renameEntry({
    type: "file",
    name: "Old.letterpaper",
    path: "C:\\ROOT\\Old.letterpaper",
  });

  const [tab] = harness.read().tabs;
  assert.equal(tab.path, "C:\\Root\\Renamed.letterpaper");
  assert.equal(tab.title, "Renamed");
  assert.equal(tab.document.title, "Renamed");
  assert.equal(tab.document.updatedAt, "2026-07-26T01:02:03.000Z");
  assert.equal(tab.dirty, true);
  assert.equal(tab.recoverySourcePath, originalRecovery);
  assert.equal(harness.read().currentPath, "C:\\Root\\Renamed.letterpaper");
  assert.equal(harness.read().currentDocument.title, "Renamed");
  const names = eventNames(harness.events);
  assert.ok(names.indexOf("record-mutation") < names.indexOf("tabs"));
  assert.ok(names.indexOf("tabs") < names.indexOf("current-path"));
  assert.deepEqual(
    harness.events.find(
      (event) => event[0] === "io" && event[1] === "renameEntry",
    ).slice(2),
    ["C:\\ROOT\\Old.letterpaper", "  Renamed  "],
  );
});

test("folder rename rebases case-insensitive descendants but preserves inherited root and cached child paths", async () => {
  const cachedEntries = [{
    path: "C:\\Root\\Folder\\Child\\cached.letterpaper",
    type: "file",
  }];
  const harness = createHarness({
    currentPath: "C:\\ROOT\\folder\\Open.letterpaper",
    expanded: {
      "C:\\Root\\Folder": {
        expanded: true,
        entries: cachedEntries,
      },
      "C:\\Root\\Elsewhere": {
        expanded: true,
        entries: [],
      },
    },
    folderState: {
      rootPath: "C:\\Root\\Folder",
      path: "c:\\root\\FOLDER\\Child",
      parentPath: "C:\\Root",
      folders: [],
      files: [],
      entries: cachedEntries,
      loading: false,
      error: "",
    },
    promptValues: ["Renamed"],
    io: {
      listFolder(path) {
        return {
          folderPath: path,
          parentPath: "C:\\Root",
          folders: [],
          files: [],
        };
      },
      renameEntry: {
        ok: true,
        path: "C:\\Root\\Renamed",
        folderPath: "C:\\Root",
      },
    },
    tabs: [{
      id: "nested",
      path: "C:\\Root\\Folder\\Open.letterpaper",
      recoverySourcePath: "C:\\Root\\Folder\\Recovery.letterpaper",
      document: { title: "Open" },
      dirty: false,
    }],
  });

  await harness.controller.mutationPort.renameEntry({
    type: "folder",
    name: "Folder",
    path: "C:\\ROOT\\Folder",
  });

  assert.equal(
    harness.read().tabs[0].path,
    "C:\\Root\\Renamed\\Open.letterpaper",
  );
  assert.equal(
    harness.read().tabs[0].recoverySourcePath,
    "C:\\Root\\Folder\\Recovery.letterpaper",
  );
  assert.equal(harness.read().folderPath, "C:\\Root\\Renamed\\Child");
  assert.equal(harness.read().folderState.path, "C:\\Root\\Renamed\\Child");
  assert.equal(harness.read().folderState.rootPath, "C:\\Root\\Folder");
  assert.equal(harness.read().folderState.parentPath, "C:\\Root");
  assert.equal(
    harness.read().expanded["C:\\Root\\Renamed"].entries,
    cachedEntries,
  );
  assert.equal(
    harness.read().expanded["C:\\Root\\Renamed"].entries[0].path,
    "C:\\Root\\Folder\\Child\\cached.letterpaper",
  );
});

test("backup blocks dirty sources and commits the captured tab identity before tab publication", async () => {
  const dirtyHarness = createHarness({
    tabs: [{
      id: "dirty",
      path: "C:\\Root\\Dirty.letterpaper",
      document: { title: "Dirty" },
      dirty: true,
    }],
  });
  await dirtyHarness.controller.mutationPort.backupDocument({
    type: "file",
    path: "C:\\Root\\Dirty.letterpaper",
  });
  assert.equal(
    dirtyHarness.events.some(
      (event) => event[0] === "io" && event[1] === "backupDocument",
    ),
    false,
  );

  const pendingBackup = deferred();
  const nextRevision = diskRevision(4);
  const source = {
    id: "source",
    path: "C:\\Root\\Source.letterpaper",
    document: { title: "Source", documentId: "old" },
    dirty: false,
  };
  const harness = createHarness({
    activeTabId: "source",
    currentDocument: source.document,
    currentPath: source.path,
    io: {
      backupDocument: () => pendingBackup.promise,
    },
    tabs: [source],
  });
  const backup = harness.controller.mutationPort.backupDocument({
    type: "file",
    path: source.path,
  });
  harness.setTabs([{
    ...source,
    path: "C:\\Root\\MovedWhilePending.letterpaper",
    dirty: true,
  }]);
  pendingBackup.resolve({
    ok: true,
    folderPath: "C:\\Root",
    sourceDocument: {
      documentId: "stable-id",
      createdAt: "2025-01-01T00:00:00.000Z",
    },
    sourceDiskRevision: nextRevision,
  });
  await backup;

  assert.equal(
    harness.read().tabs[0].path,
    "C:\\Root\\MovedWhilePending.letterpaper",
  );
  assert.equal(harness.read().tabs[0].document.documentId, "stable-id");
  assert.equal(harness.read().tabs[0].dirty, true);
  assert.equal(harness.read().diskRevisions.get("source"), nextRevision);
  const names = eventNames(harness.events);
  assert.ok(names.indexOf("disk-revision") < names.indexOf("tabs"));
  assert.ok(names.indexOf("tabs") < names.indexOf("current-document"));
  assert.ok(names.indexOf("current-document") < names.indexOf("session"));
});

test("delete disk mutation and success reconciliation remain separate and use the input path", async () => {
  const victim = {
    id: "victim",
    path: "C:\\Root\\Victim\\Paper.letterpaper",
    recoveryPath: "C:\\Recovery\\victim.tmp",
    document: { title: "Victim" },
    dirty: true,
    editorJson: { type: "doc" },
    scrollState: { top: 9 },
  };
  const harness = createHarness({
    activeTabId: "victim",
    currentDocument: victim.document,
    currentPath: victim.path,
    rightSplitTabId: "victim",
    tabs: [victim],
    io: {
      deleteEntry: {
        ok: true,
        deletedPath: "C:\\Root\\DifferentServerPath",
        folderPath: "C:\\Root",
      },
    },
  });
  const entry = {
    type: "folder",
    name: "Victim",
    path: "C:\\ROOT\\Victim",
  };

  const result = await harness.controller.mutationPort.deleteOnDisk(entry);
  assert.equal(
    harness.events.some((event) => event[0] === "tabs"),
    false,
  );
  assert.equal(
    harness.events.some(
      (event) => event[0] === "status" && event[1] === "已删除",
    ),
    false,
  );
  await harness.controller.mutationPort.commitDeleteResult({
    entry,
    fallbackFolderPath: "C:\\Fallback",
    result,
    snapshot: [victim],
  });

  assert.deepEqual(
    harness.events.find(
      (event) => event[0] === "io" && event[1] === "deleteEntry",
    ).slice(2),
    ["C:\\ROOT\\Victim"],
  );
  assert.equal(harness.read().tabs.length, 1);
  assert.equal(harness.read().tabs[0].id, "blank-tab");
  assert.equal(harness.read().activeTabId, "blank-tab");
  assert.equal(harness.read().rightSplit, "");
  assert.deepEqual(
    eventNames(harness.events).filter((name) => [
      "clear-right-split",
      "active-pane",
      "tabs",
      "release-runtime",
      "active-tab",
      "apply-document",
      "session",
    ].includes(name)),
    [
      "clear-right-split",
      "active-pane",
      "tabs",
      "release-runtime",
      "active-tab",
      "apply-document",
      "session",
    ],
  );
});

test("move trusts returned oldPath, refreshes source before target, and preserves cached metadata gaps", async () => {
  const cachedEntries = [{
    path: "C:\\Authoritative\\Child\\cached.letterpaper",
  }];
  const harness = createHarness({
    currentPath: "c:\\authoritative\\Open.letterpaper",
    expanded: {
      "C:\\": {
        expanded: true,
        entries: [],
      },
      "C:\\Authoritative": {
        expanded: true,
        entries: cachedEntries,
      },
      "D:\\Target": {
        expanded: true,
        entries: [],
      },
    },
    folderState: {
      rootPath: "C:\\Authoritative",
      path: "C:\\Authoritative\\Child",
      parentPath: "C:\\",
      folders: [],
      files: [],
      entries: cachedEntries,
      loading: false,
      error: "",
    },
    io: {
      moveEntry: {
        ok: true,
        oldPath: "C:\\Authoritative",
        path: "D:\\Target\\Authoritative",
        sourceParent: "C:\\",
        targetFolderPath: "D:\\Target",
      },
    },
    tabs: [
      {
        id: "server-old",
        path: "C:\\Authoritative\\Open.letterpaper",
        recoverySourcePath: "C:\\Authoritative\\Recovery.letterpaper",
        document: { title: "Open" },
      },
      {
        id: "input-old",
        path: "C:\\Input\\Untouched.letterpaper",
        document: { title: "Untouched" },
      },
    ],
  });
  const entry = {
    type: "folder",
    path: "C:\\Input",
  };

  await harness.controller.mutationPort.moveEntry(entry, "D:\\Target");

  assert.deepEqual(
    harness.events.find(
      (event) => event[0] === "io" && event[1] === "moveEntry",
    ).slice(2),
    ["C:\\Input", "D:\\Target"],
  );
  assert.equal(
    harness.read().tabs[0].path,
    "D:\\Target\\Authoritative\\Open.letterpaper",
  );
  assert.equal(
    harness.read().tabs[0].recoverySourcePath,
    "C:\\Authoritative\\Recovery.letterpaper",
  );
  assert.equal(
    harness.read().tabs[1].path,
    "C:\\Input\\Untouched.letterpaper",
  );
  assert.equal(
    harness.read().currentPath,
    "D:\\Target\\Authoritative\\Open.letterpaper",
  );
  assert.equal(
    harness.read().folderState.path,
    "D:\\Target\\Authoritative\\Child",
  );
  assert.equal(harness.read().folderState.rootPath, "C:\\Authoritative");
  assert.equal(
    harness.read().expanded["D:\\Target\\Authoritative"].entries,
    cachedEntries,
  );
  const listedPaths = harness.events
    .filter((event) => event[0] === "io" && event[1] === "listFolder")
    .map((event) => event[2]);
  assert.deepEqual(listedPaths, [
    "D:\\Target\\Authoritative\\Child",
    "C:\\",
    "D:\\Target\\Authoritative\\Child",
    "D:\\Target",
  ]);
});

test("external verification is latest-wins and guards both path and expected revision", async () => {
  const first = deferred();
  const second = deferred();
  let revisionCall = 0;
  const expected = diskRevision(5);
  const harness = createHarness({
    activeTabId: "paper",
    io: {
      getDocumentRevision() {
        revisionCall += 1;
        return revisionCall === 1 ? first.promise : second.promise;
      },
    },
    revisions: {
      paper: expected,
    },
    tabs: [{
      id: "paper",
      path: "C:\\Root\\Paper.letterpaper",
      document: { title: "Paper" },
      diskRevision: expected,
      externalChanged: false,
    }],
  });

  const staleVerification = harness.controller.lifecyclePort.verifyOpenDocuments();
  const currentVerification = harness.controller.lifecyclePort.verifyOpenDocuments();
  second.resolve({ diskRevision: expected });
  assert.deepEqual(
    [...await currentVerification],
    [],
  );
  first.resolve({ diskRevision: diskRevision(6) });
  assert.deepEqual(
    [...await staleVerification],
    [],
  );
  assert.equal(harness.read().tabs[0].externalChanged, false);

  const expectedA = diskRevision(7);
  const expectedC = diskRevision(8);
  const actualA = diskRevision(9);
  const baselineB = diskRevision(10);
  const outcomes = {
    "C:\\Root\\A.letterpaper": { diskRevision: actualA },
    "C:\\Root\\B.letterpaper": { diskRevision: baselineB },
    "C:\\Root\\C.letterpaper": { diskRevision: diskRevision(11) },
  };
  const guardedHarness = createHarness({
    activeTabId: "a",
    focusedDocumentTabId: "a",
    io: {
      getDocumentRevision(path) {
        return outcomes[path];
      },
    },
    revisions: {
      a: expectedA,
      c: expectedC,
    },
    tabs: [
      {
        id: "a",
        path: "C:\\Root\\A.letterpaper",
        diskRevision: expectedA,
        externalChanged: false,
        document: { title: "A" },
      },
      {
        id: "b",
        path: "C:\\Root\\B.letterpaper",
        externalChanged: false,
        document: { title: "B" },
      },
      {
        id: "c",
        path: "C:\\Root\\C.letterpaper",
        diskRevision: expectedC,
        externalChanged: false,
        document: { title: "C" },
      },
    ],
  });
  const guardedVerification = guardedHarness.controller.lifecyclePort
    .verifyOpenDocuments();
  guardedHarness.setDiskRevision("c", diskRevision(12));
  const changed = await guardedVerification;

  assert.deepEqual([...changed], ["a"]);
  assert.equal(
    guardedHarness.read().tabs.find((tab) => tab.id === "a").externalChanged,
    true,
  );
  assert.equal(
    guardedHarness.read().tabs.find((tab) => tab.id === "b").externalChanged,
    false,
  );
  assert.equal(
    guardedHarness.read().tabs.find((tab) => tab.id === "c").externalChanged,
    false,
  );
  assert.equal(
    guardedHarness.read().diskRevisions.get("b"),
    baselineB,
  );
  const names = eventNames(guardedHarness.events);
  assert.ok(names.indexOf("disk-revision") < names.indexOf("tabs"));
  assert.equal(
    guardedHarness.events.some((event) => (
      event[0] === "status"
      && event[1] === "检测到磁盘上的外部版本；保存时会保护两个版本"
      && event[2] === "warning"
    )),
    true,
  );
});

test("workspace search sends only dirty document overrides and maps snippet ranges", async () => {
  const harness = createHarness({
    io: {
      searchFolder(options) {
        return {
          query: "server-query",
          results: [
            {
              path: "C:\\Root\\A.letterpaper",
              snippetMatchStart: 4,
              snippetMatchLength: 3,
            },
            {
              path: "C:\\Root\\B.letterpaper",
              snippetMatchStart: -1,
              snippetMatchLength: 0,
            },
          ],
          received: options,
        };
      },
    },
    tabs: [
      {
        id: "dirty",
        path: "C:\\Root\\Dirty.letterpaper",
        document: { title: "Dirty" },
        dirty: true,
      },
      {
        id: "clean",
        path: "C:\\Root\\Clean.letterpaper",
        document: { title: "Clean" },
        dirty: false,
      },
      {
        id: "untitled",
        path: "",
        document: { title: "Untitled" },
        dirty: true,
      },
    ],
  });

  const result = await harness.controller.lifecyclePort.searchWorkspace({
    rootPath: "C:\\Root",
    query: "query",
    requestId: "request-1",
  });

  const searchCall = harness.events.find(
    (event) => event[0] === "io" && event[1] === "searchFolder",
  )[2];
  assert.deepEqual(searchCall, {
    folderPath: "C:\\Root",
    query: "query",
    requestId: "request-1",
    overrides: [{
      path: "C:\\Root\\Dirty.letterpaper",
      document: { title: "Dirty" },
    }],
    limit: 100,
  });
  assert.deepEqual(result.results[0].snippetRanges, [{ from: 4, to: 7 }]);
  assert.deepEqual(result.results[1].snippetRanges, []);
  assert.equal(result.results[0].query, "server-query");
});
