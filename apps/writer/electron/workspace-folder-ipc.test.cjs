const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { registerWorkspaceFolderIpcHandlers } = require("./workspace-folder-ipc.cjs");

const WORKSPACE_FOLDER_CHANNELS = [
  "entry:delete",
  "entry:move",
  "entry:rename",
  "folder:copy-path",
  "folder:create",
  "folder:list",
  "folder:open",
  "folder:search",
  "folder:search-cancel",
  "folder:show",
  "workspace:relationships",
  "workspace:watch",
];

function fileStat() {
  return {
    isDirectory: () => false,
    isFile: () => true,
  };
}

function directoryStat() {
  return {
    isDirectory: () => true,
    isFile: () => false,
  };
}

function createHarness() {
  const handlers = new Map();
  const pathApi = path.win32;
  const calls = {
    access: [],
    authorizedDirectories: [],
    authorizedEntries: [],
    authorizedRoots: [],
    cacheInvalidations: [],
    canceledSearches: [],
    clipboard: [],
    folderLists: [],
    logs: [],
    mkdir: [],
    mutations: 0,
    openDialogs: [],
    openPaths: [],
    pathRebases: [],
    persistedAccess: 0,
    readDocuments: [],
    relationshipRequests: [],
    renames: [],
    revocations: [],
    rms: [],
    searchIndexRequests: [],
    searches: [],
    starts: [],
    stops: 0,
    trash: [],
  };
  const state = {
    accessExists: false,
    authorizedEntry: {
      path: "C:\\Workspace\\Old.letterpaper",
      stat: fileStat(),
    },
    cancelResult: true,
    directoryError: null,
    dialogResult: { canceled: true, filePaths: [] },
    listError: null,
    listed: {
      folderPath: "C:\\Workspace",
      files: [{ path: "C:\\Workspace\\Draft.letterpaper" }],
      folders: [{ path: "C:\\Workspace\\Notes" }],
      entries: [],
    },
    openPathError: "",
    readDocuments: new Map(),
    searchResult: {
      requestId: "search-result",
      query: "paper",
      canceled: false,
      results: [{ path: "C:\\Workspace\\Draft.letterpaper" }],
      totalMatches: 1,
    },
    uniquePath: "",
    walkedDocuments: [],
  };
  const filesystemRuntime = {
    async authorizeFilesystemRoot(folderPath) {
      calls.authorizedRoots.push(folderPath);
      return "C:\\Authorized";
    },
    async assertAuthorizedDirectory(folderPath) {
      calls.authorizedDirectories.push(folderPath);
      if (state.directoryError) throw state.directoryError;
      return folderPath;
    },
    async assertAuthorizedEntry(targetPath, options) {
      calls.authorizedEntries.push([targetPath, options]);
      return state.authorizedEntry;
    },
    async rebaseFilesystemAccess(fromPath, toPath) {
      calls.pathRebases.push(["capability", fromPath, toPath]);
      calls.persistedAccess += 1;
    },
    async revokeFilesystemAccess(targetPath, recursive) {
      calls.revocations.push([targetPath, recursive]);
      calls.persistedAccess += 1;
    },
  };
  const workspaceFacade = {
    async search(payload) {
      if (!payload.folderPath) {
        return {
          requestId: payload.requestId || "",
          query: "",
          canceled: false,
          results: [],
          totalMatches: 0,
        };
      }
      calls.searches.push(payload);
      return state.searchResult;
    },
    async cancelSearch(folderPath, requestId) {
      if (!folderPath || !requestId) return false;
      calls.canceledSearches.push([folderPath, requestId]);
      return state.cancelResult;
    },
    async relationships(payload) {
      calls.relationshipRequests.push(payload);
      return state.relationshipResult;
    },
    async startWatcher(folderPath) {
      calls.starts.push(folderPath);
      return `authorized:${folderPath}`;
    },
    stopWatcher() {
      calls.stops += 1;
    },
    async listFolder(folderPath) {
      calls.folderLists.push(["listed", folderPath]);
      if (!folderPath) {
        return { canceled: true, files: [], folders: [], entries: [] };
      }
      if (state.directoryError || state.listError) {
        return {
          canceled: true,
          folderPath: "",
          files: [],
          folders: [],
          entries: [],
        };
      }
      return {
        canceled: false,
        ...state.listed,
        folderPath,
      };
    },
    async listFolderEntries(folderPath) {
      calls.folderLists.push(["normal", folderPath]);
      if (state.listError) throw state.listError;
      return { ...state.listed, folderPath };
    },
    async listAuthorizedFolderEntries(folderPath) {
      calls.folderLists.push(["authorized", folderPath]);
      return { ...state.listed, folderPath };
    },
  };
  const shell = {
    async openPath(targetPath) {
      calls.openPaths.push(targetPath);
      return state.openPathError;
    },
    async trashItem(targetPath) {
      calls.trash.push(targetPath);
    },
  };

  registerWorkspaceFolderIpcHandlers({
    ipcMain: {
      handle(channel, listener) {
        assert.equal(handlers.has(channel), false, `duplicate test handler: ${channel}`);
        handlers.set(channel, listener);
      },
    },
    app: {
      getPath(name) {
        assert.equal(name, "desktop");
        return "C:\\Desktop";
      },
    },
    clipboard: {
      writeText(value) {
        calls.clipboard.push(value);
      },
    },
    dialog: {
      async showOpenDialog(window, options) {
        calls.openDialogs.push([window, options]);
        return state.dialogResult;
      },
    },
    filesystemRuntime,
    workspaceFacade,
    fs: {
      async access(targetPath) {
        calls.access.push(targetPath);
        if (!state.accessExists) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
      },
      async mkdir(targetPath, options) {
        calls.mkdir.push([targetPath, options]);
      },
      async rename(fromPath, toPath) {
        calls.renames.push([fromPath, toPath]);
      },
      async rm(targetPath, options) {
        calls.rms.push([targetPath, options]);
      },
    },
    path: pathApi,
    shell,
    documentModel: {
      DOCUMENT_EXTENSION: ".letterpaper",
      LEGACY_DOCUMENT_EXTENSION: ".paperwriter",
      sanitizeName: (name, fallback) => String(name || fallback).trim(),
      isSupportedDocument: (targetPath) => (
        [".letterpaper", ".paperwriter"].includes(pathApi.extname(targetPath).toLowerCase())
      ),
    },
    getMainWindow: () => ({ id: "main-window" }),
    assertMutableWorkspaceEntry: (targetPath) => {
      calls.mutablePaths = [...(calls.mutablePaths || []), targetPath];
    },
    uniquePath: async (targetPath) => state.uniquePath || targetPath,
    storageFacade: {
      async runDocumentTransaction(task) {
        calls.mutations += 1;
        return task({
          rebaseDocumentPath(fromPath, toPath) {
            calls.pathRebases.push([
              "assets",
              fromPath,
              toPath,
            ]);
          },
          invalidateDocumentPath(...args) {
            calls.cacheInvalidations.push(args);
          },
        });
      },
    },
  });

  return {
    calls,
    filesystemRuntime,
    workspaceFacade,
    handlers,
    pathApi,
    shell,
    state,
  };
}

test("registers the complete workspace and folder IPC surface exactly once", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()].sort(), WORKSPACE_FOLDER_CHANNELS);
});

test("forwards folder search and cancellation through the workspace facade", async () => {
  const harness = createHarness();
  const search = harness.handlers.get("folder:search");
  const cancel = harness.handlers.get("folder:search-cancel");

  assert.deepEqual(await search(), {
    requestId: "",
    query: "",
    canceled: false,
    results: [],
    totalMatches: 0,
  });

  const payload = {
    folderPath: "C:\\Workspace",
    query: "paper",
    requestId: "request",
    limit: 999,
    refresh: 1,
    overrides: [{ path: "dirty" }],
  };
  assert.equal(
    await search({}, payload),
    harness.state.searchResult,
  );
  assert.deepEqual(harness.calls.searches, [payload]);

  assert.deepEqual(await cancel({}, "", "request"), { ok: false });
  assert.deepEqual(await cancel({}, "C:\\Workspace", ""), { ok: false });
  assert.deepEqual(
    await cancel({}, "C:\\Workspace", "request"),
    { ok: true },
  );
  assert.deepEqual(harness.calls.canceledSearches, [[
    "C:\\Workspace",
    "request",
  ]]);
});

test("forwards workspace relationship payloads without reshaping results", async () => {
  const harness = createHarness();
  const payload = {
    folderPath: "C:\\Workspace",
    documentId: "11111111-1111-4111-8111-111111111111",
    currentPath: "C:\\Workspace\\Current.letterpaper",
    overrides: [{
      path: "C:\\Workspace\\Dirty.letterpaper",
      document: { title: "Dirty" },
    }],
    currentLinks: [{ documentId: "target" }],
  };
  harness.state.relationshipResult = {
    rootPath: "C:\\Workspace",
    documents: [{ title: "Result" }],
    links: [],
    backlinks: [],
    duplicates: [],
  };

  assert.equal(
    await harness.handlers.get("workspace:relationships")({}, payload),
    harness.state.relationshipResult,
  );
  assert.deepEqual(harness.calls.relationshipRequests, [payload]);
});

test("starts and stops the single injected workspace watcher without changing responses", async () => {
  const harness = createHarness();
  const watch = harness.handlers.get("workspace:watch");

  assert.deepEqual(await watch({}, ""), { ok: true, rootPath: "" });
  assert.equal(harness.calls.stops, 1);
  assert.deepEqual(
    await watch({}, "C:\\Workspace"),
    { ok: true, rootPath: "authorized:C:\\Workspace" },
  );
  assert.deepEqual(harness.calls.starts, ["C:\\Workspace"]);
});

test("opens and lists only authorized folders while preserving failure fallbacks", async () => {
  const harness = createHarness();
  const open = harness.handlers.get("folder:open");
  const list = harness.handlers.get("folder:list");

  assert.deepEqual(await open(), { canceled: true });
  assert.deepEqual(harness.calls.openDialogs[0], [
    { id: "main-window" },
    {
      title: "打开信笺文件夹",
      defaultPath: "C:\\Desktop",
      properties: ["openDirectory", "createDirectory"],
    },
  ]);

  harness.state.dialogResult = {
    canceled: false,
    filePaths: ["C:\\Picked"],
  };
  assert.deepEqual(await open(), {
    canceled: false,
    ...harness.state.listed,
    folderPath: "C:\\Authorized",
  });
  assert.deepEqual(harness.calls.authorizedRoots, ["C:\\Picked"]);

  assert.deepEqual(await list({}, ""), {
    canceled: true,
    files: [],
    folders: [],
    entries: [],
  });

  assert.deepEqual(await list({}, "C:\\Workspace"), {
    canceled: false,
    ...harness.state.listed,
    folderPath: "C:\\Workspace",
  });

  harness.state.directoryError = Object.assign(new Error("denied"), {
    code: "EACCES",
  });
  assert.deepEqual(await list({}, "C:\\Denied"), {
    canceled: true,
    folderPath: "",
    files: [],
    folders: [],
    entries: [],
  });
});

test("copies, shows, and creates folders only after capability and metadata checks", async () => {
  const harness = createHarness();
  const copy = harness.handlers.get("folder:copy-path");
  const show = harness.handlers.get("folder:show");
  const create = harness.handlers.get("folder:create");

  assert.deepEqual(await copy({}, ""), { ok: false });
  assert.deepEqual(await copy({}, "C:\\Workspace"), { ok: true });
  assert.deepEqual(harness.calls.clipboard, ["C:\\Workspace"]);

  assert.deepEqual(await show({}, ""), { ok: false });
  harness.state.openPathError = "system rejected";
  assert.deepEqual(await show({}, "C:\\Workspace"), {
    ok: false,
    error: "system rejected",
  });
  assert.deepEqual(harness.calls.openPaths, ["C:\\Workspace"]);

  assert.deepEqual(await create({}, "", "New"), {
    ok: false,
    message: "缺少目标文件夹",
  });
  await assert.rejects(
    () => create({}, "C:\\Workspace", ".JianJian"),
    /该名称由笺间工作区保留/,
  );

  harness.state.uniquePath = "C:\\Workspace\\New (2)";
  assert.deepEqual(await create({}, "C:\\Workspace", "New"), {
    ok: true,
    path: "C:\\Workspace\\New (2)",
    ...harness.state.listed,
    folderPath: "C:\\Workspace",
  });
  assert.deepEqual(harness.calls.mutablePaths, [
    "C:\\Workspace",
    "C:\\Workspace\\New (2)",
  ]);
  assert.deepEqual(harness.calls.mkdir, [[
    "C:\\Workspace\\New (2)",
    { recursive: false },
  ]]);
});

test("renames supported documents inside the shared mutation and capability queues", async () => {
  const harness = createHarness();
  const rename = harness.handlers.get("entry:rename");

  assert.deepEqual(await rename({}, "", "New"), {
    ok: false,
    message: "缺少目标路径",
  });
  assert.deepEqual(
    await rename({}, "C:\\Workspace\\Old.letterpaper", "New.paperwriter"),
    {
      ok: true,
      oldPath: "C:\\Workspace\\Old.letterpaper",
      path: "C:\\Workspace\\New.letterpaper",
      ...harness.state.listed,
      folderPath: "C:\\Workspace",
    },
  );
  assert.equal(harness.calls.mutations, 1);
  assert.deepEqual(harness.calls.authorizedEntries, [[
    "C:\\Workspace\\Old.letterpaper",
    { destructive: true },
  ]]);
  assert.deepEqual(harness.calls.renames, [[
    "C:\\Workspace\\Old.letterpaper",
    "C:\\Workspace\\New.letterpaper",
  ]]);
  assert.deepEqual(harness.calls.pathRebases, [
    [
      "assets",
      "C:\\Workspace\\Old.letterpaper",
      "C:\\Workspace\\New.letterpaper",
    ],
    [
      "capability",
      "C:\\Workspace\\Old.letterpaper",
      "C:\\Workspace\\New.letterpaper",
    ],
  ]);
  assert.equal(harness.calls.persistedAccess, 1);

  const duplicate = createHarness();
  duplicate.state.accessExists = true;
  assert.deepEqual(
    await duplicate.handlers.get("entry:rename")(
      {},
      "C:\\Workspace\\Old.letterpaper",
      "New",
    ),
    { ok: false, message: "同名项目已经存在" },
  );
  assert.deepEqual(duplicate.calls.renames, []);
  assert.equal(duplicate.calls.persistedAccess, 0);
});

test("deletes through trash and revokes document caches and filesystem capabilities", async () => {
  const harness = createHarness();
  const remove = harness.handlers.get("entry:delete");

  assert.deepEqual(await remove({}, ""), {
    ok: false,
    message: "缺少目标路径",
  });
  assert.deepEqual(
    await remove({}, "C:\\Workspace\\Old.letterpaper"),
    {
      ok: true,
      deletedPath: "C:\\Workspace\\Old.letterpaper",
      ...harness.state.listed,
      folderPath: "C:\\Workspace",
    },
  );
  assert.equal(harness.calls.mutations, 1);
  assert.deepEqual(harness.calls.trash, ["C:\\Workspace\\Old.letterpaper"]);
  assert.deepEqual(harness.calls.cacheInvalidations, [[
    "C:\\Workspace\\Old.letterpaper",
    true,
    { revokeReferences: true },
  ]]);
  assert.deepEqual(harness.calls.revocations, [[
    "C:\\Workspace\\Old.letterpaper",
    false,
  ]]);
  assert.equal(harness.calls.persistedAccess, 1);

  const fallback = createHarness();
  fallback.shell.trashItem = undefined;
  fallback.state.authorizedEntry = {
    path: "C:\\Workspace\\Folder",
    stat: directoryStat(),
  };
  await fallback.handlers.get("entry:delete")({}, "C:\\Workspace\\Folder");
  assert.deepEqual(fallback.calls.rms, [[
    "C:\\Workspace\\Folder",
    { recursive: true, force: true },
  ]]);
});

test("rejects unsafe moves and rebases successful moves inside the document mutation", async () => {
  const harness = createHarness();
  const move = harness.handlers.get("entry:move");

  assert.deepEqual(await move({}, "", ""), {
    ok: false,
    message: "缺少移动路径",
  });

  harness.state.authorizedEntry = {
    path: "C:\\Workspace\\Folder",
    stat: directoryStat(),
  };
  assert.deepEqual(
    await move(
      {},
      "C:\\Workspace\\Folder",
      "C:\\Workspace\\Folder\\Nested",
    ),
    { ok: false, message: "不能把文件夹移动到自身内部" },
  );

  harness.state.authorizedEntry = {
    path: "C:\\Workspace\\Old.letterpaper",
    stat: fileStat(),
  };
  assert.deepEqual(
    await move(
      {},
      "C:\\Workspace\\Old.letterpaper",
      "C:\\Workspace",
    ),
    { ok: false, message: "已经在这个文件夹里" },
  );

  harness.state.uniquePath = "C:\\Archive\\Old (2).letterpaper";
  assert.deepEqual(
    await move(
      {},
      "C:\\Workspace\\Old.letterpaper",
      "C:\\Archive",
    ),
    {
      ok: true,
      oldPath: "C:\\Workspace\\Old.letterpaper",
      path: "C:\\Archive\\Old (2).letterpaper",
      sourceParent: "C:\\Workspace",
      targetFolderPath: "C:\\Archive",
    },
  );
  assert.deepEqual(harness.calls.renames, [[
    "C:\\Workspace\\Old.letterpaper",
    "C:\\Archive\\Old (2).letterpaper",
  ]]);
  assert.deepEqual(harness.calls.pathRebases.slice(-2), [
    [
      "assets",
      "C:\\Workspace\\Old.letterpaper",
      "C:\\Archive\\Old (2).letterpaper",
    ],
    [
      "capability",
      "C:\\Workspace\\Old.letterpaper",
      "C:\\Archive\\Old (2).letterpaper",
    ],
  ]);
  assert.equal(harness.calls.persistedAccess, 1);
  assert.equal(harness.calls.mutations, 3);
});

test("main injects workspace, filesystem, and the storage facade", async () => {
  const source = await fs.readFile(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(source, /require\("\.\/workspace-folder-ipc\.cjs"\)/);
  assert.match(source, /registerWorkspaceFolderIpcHandlers\(\{/);
  assert.match(source, /workspaceFacade:\s*workspaceRuntime\.facade/);
  assert.match(source, /filesystemRuntime,/);
  assert.match(
    source,
    /registerWorkspaceFolderIpcHandlers\(\{[\s\S]*?storageFacade,/,
  );
  assert.doesNotMatch(source, /ipcMain\.handle\("(?:folder:(?:search|search-cancel|open|list|copy-path|show|create)|workspace:(?:relationships|watch)|entry:(?:rename|delete|move))"/);
  assert.match(source, /require\("\.\/document-save-ipc\.cjs"\)/);
  assert.match(source, /registerDocumentSaveIpcHandlers\(\{/);
  assert.doesNotMatch(source, /ipcMain\.handle\("document:(?:create-in-folder|backup)"/);
});
