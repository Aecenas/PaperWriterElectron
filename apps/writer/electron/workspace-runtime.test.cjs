const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { createWorkspaceRuntime } = require("./workspace-runtime.cjs");

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createDirent(name, kind) {
  return {
    name,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
  };
}

function createHarness() {
  const pathApi = path.win32;
  const calls = {
    authorizedDirectories: [],
    cachePaths: [],
    canceled: [],
    indexInitializes: [],
    indexRefreshes: [],
    logs: [],
    mapConcurrency: [],
    reads: [],
    readdir: [],
    searches: [],
    sent: [],
    stats: [],
    timers: [],
    watchers: [],
  };
  const state = {
    accessibleDirectories: new Set(),
    authorizationErrors: new Map(),
    authorizationGates: new Map(),
    canonicalPaths: new Map(),
    date: new Date("2026-07-25T08:09:10.000Z"),
    folderEntries: new Map(),
    indexRefreshGates: new Map(),
    now: 1000,
    readDocuments: new Map(),
    searchResult: {
      requestId: "search-result",
      query: "paper",
      canceled: false,
      results: [{ path: "C:\\Workspace\\Draft.letterpaper" }],
      totalMatches: 1,
    },
    stats: new Map(),
    walkedDocuments: [],
    watchError: null,
  };
  const normalizeKey = (value) => (
    pathApi.resolve(String(value || "")).toLocaleLowerCase("en-US")
  );
  const indexes = new Map();
  const filesystemAccess = {
    async assertAuthorizedDirectory(folderPath) {
      calls.authorizedDirectories.push(folderPath);
      const gate = state.authorizationGates.get(folderPath);
      if (gate) {
        gate.started.resolve();
        await gate.release.promise;
      }
      const error = state.authorizationErrors.get(folderPath);
      if (error) throw error;
      return state.canonicalPaths.get(normalizeKey(folderPath)) || folderPath;
    },
    canAccessDirectory(folderPath) {
      return state.accessibleDirectories.has(normalizeKey(folderPath));
    },
  };
  const createWorkspaceSearchIndex = ({ rootPath, cachePath }) => {
    calls.cachePaths.push([rootPath, cachePath]);
    const index = {
      rootPath,
      async initialize() {
        calls.indexInitializes.push(rootPath);
      },
      async refresh() {
        calls.indexRefreshes.push(rootPath);
        const gate = state.indexRefreshGates.get(rootPath);
        if (gate) {
          gate.started.resolve();
          await gate.release.promise;
        }
      },
      async search(query, options) {
        calls.searches.push([rootPath, query, options]);
        return state.searchResult;
      },
      cancel(requestId) {
        calls.canceled.push([rootPath, requestId]);
        return requestId === "cancel-me";
      },
    };
    indexes.set(rootPath, index);
    return index;
  };
  const nativeFs = {
    watch(rootPath, options, callback) {
      if (state.watchError) throw state.watchError;
      const watcher = {
        callback,
        closed: false,
        errorHandler: null,
        options,
        rootPath,
        close() {
          this.closed = true;
        },
        on(eventName, handler) {
          assert.equal(eventName, "error");
          this.errorHandler = handler;
          return this;
        },
      };
      calls.watchers.push(watcher);
      return watcher;
    },
  };
  const runtime = createWorkspaceRuntime({
    filesystemAccess,
    fs: {
      async readdir(folderPath, options) {
        calls.readdir.push([folderPath, options]);
        const value = state.folderEntries.get(folderPath);
        if (value instanceof Error) throw value;
        return value || [];
      },
      async stat(filePath) {
        calls.stats.push(filePath);
        const value = state.stats.get(filePath);
        if (value instanceof Error) throw value;
        if (!value) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        return value;
      },
    },
    nativeFs,
    path: pathApi,
    platform: "win32",
    createHash,
    createWorkspaceSearchIndex,
    walkWorkspaceDocuments: async () => ({
      documents: state.walkedDocuments,
    }),
    readSearchDocument: async (filePath) => {
      calls.reads.push(filePath);
      const value = state.readDocuments.get(filePath);
      if (value instanceof Error) throw value;
      return value || {};
    },
    normalizeDocumentId(value) {
      const normalized = String(value || "").toLowerCase();
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
        ? normalized
        : "";
    },
    isWorkspaceRelationshipCandidate(record, context) {
      return (
        record.documentId !== context.currentDocumentId
        && pathApi.resolve(record.path)
          !== pathApi.resolve(context.currentPath || "")
      );
    },
    async mapWithConcurrency(items, concurrency, worker) {
      calls.mapConcurrency.push(concurrency);
      return Promise.all(items.map(worker));
    },
    isPathInside(rootPath, targetPath) {
      const relative = pathApi.relative(rootPath, targetPath);
      return (
        relative === ""
        || (
          !relative.startsWith(`..${pathApi.sep}`)
          && relative !== ".."
          && !pathApi.isAbsolute(relative)
        )
      );
    },
    isSupportedDocument(filePath) {
      return [".letterpaper", ".paperwriter"].includes(
        pathApi.extname(filePath).toLowerCase(),
      );
    },
    isReservedWorkspaceMetadataPath(filePath) {
      return pathApi.basename(filePath).toLowerCase() === ".jianjian";
    },
    randomUUID: () => "generated-request-id",
    getUserDataPath: () => "C:\\UserData",
    getRendererWebContents: () => ({ id: "renderer" }),
    sendRendererEvent: (...args) => {
      calls.sent.push(args);
    },
    writeDebugLog: async (...args) => {
      calls.logs.push(args);
    },
    now: () => state.now,
    createDate: () => state.date,
    setTimeoutFn(callback, delay) {
      const timer = {
        callback,
        cleared: false,
        delay,
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        },
      };
      calls.timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
  });
  return {
    calls,
    facade: runtime.facade,
    indexes,
    normalizeKey,
    runtime,
    state,
  };
}

test("search keeps the cache path, Windows key, dirty override bounds, refresh, and cancellation contracts", async () => {
  const harness = createHarness();
  harness.state.canonicalPaths.set(
    harness.normalizeKey("C:\\Workspace"),
    "C:\\Workspace",
  );

  assert.deepEqual(await harness.facade.search({ requestId: "empty" }), {
    requestId: "empty",
    query: "",
    canceled: false,
    results: [],
    totalMatches: 0,
  });

  const overrides = Array.from(
    { length: 105 },
    (_, index) => ({ index }),
  );
  const requestId = "r".repeat(150);
  assert.equal(
    await harness.facade.search({
      folderPath: "C:\\WORKSPACE",
      query: "paper",
      requestId,
      limit: 999,
      refresh: true,
      overrides,
    }),
    harness.state.searchResult,
  );
  const cacheKey = createHash("sha256")
    .update(path.win32.resolve("C:\\Workspace"))
    .digest("hex");
  assert.deepEqual(harness.calls.cachePaths, [[
    "C:\\Workspace",
    `C:\\UserData\\workspace-search\\${cacheKey}.json`,
  ]]);
  assert.deepEqual(harness.calls.indexInitializes, ["C:\\Workspace"]);
  assert.deepEqual(harness.calls.indexRefreshes, []);
  assert.equal(harness.calls.searches[0][1], "paper");
  assert.equal(
    harness.calls.searches[0][2].requestId,
    requestId.slice(0, 128),
  );
  assert.equal(harness.calls.searches[0][2].limit, 200);
  assert.equal(harness.calls.searches[0][2].overrides.length, 100);

  await harness.facade.search({
    folderPath: "c:\\workspace",
    query: "again",
    refresh: true,
  });
  assert.equal(harness.calls.cachePaths.length, 1);
  assert.deepEqual(harness.calls.indexRefreshes, ["C:\\Workspace"]);
  assert.equal(
    harness.calls.searches[1][2].requestId,
    "generated-request-id",
  );

  assert.equal(await harness.facade.cancelSearch("", "cancel-me"), false);
  assert.equal(
    await harness.facade.cancelSearch("c:\\workspace", "cancel-me"),
    true,
  );
  assert.deepEqual(harness.calls.canceled, [[
    "C:\\Workspace",
    "cancel-me",
  ]]);
});

test("relationships preserve dirty overrides, bounds, backlinks, missing links, and duplicates", async () => {
  const harness = createHarness();
  const currentId = "11111111-1111-4111-8111-111111111111";
  const targetId = "22222222-2222-4222-8222-222222222222";
  const missingId = "33333333-3333-4333-8333-333333333333";
  const rootPath = "C:\\Workspace";
  const currentPath = `${rootPath}\\Current.letterpaper`;
  const targetPath = `${rootPath}\\Target.letterpaper`;
  const duplicatePath = `${rootPath}\\Duplicate.letterpaper`;
  const noIdentityPath = `${rootPath}\\Untitled.letterpaper`;
  const unreadablePath = `${rootPath}\\Broken.letterpaper`;
  harness.state.walkedDocuments = [
    currentPath,
    targetPath,
    duplicatePath,
    noIdentityPath,
    unreadablePath,
  ];
  harness.state.readDocuments.set(currentPath, {
    documentId: currentId,
    title: "Current",
    html: `<a data-document-id="${targetId}"></a>`,
  });
  harness.state.readDocuments.set(
    targetPath,
    new Error("override should win"),
  );
  harness.state.readDocuments.set(duplicatePath, {
    documentId: targetId,
    title: "Duplicate",
    html: "",
  });
  harness.state.readDocuments.set(noIdentityPath, {
    title: "Untitled",
    html: "",
  });
  harness.state.readDocuments.set(
    unreadablePath,
    new Error("broken"),
  );

  const result = await harness.facade.relationships({
    folderPath: rootPath,
    documentId: currentId,
    currentPath,
    overrides: [{
      path: targetPath.toLowerCase(),
      document: {
        documentId: targetId,
        title: "Target override",
        html: `<a data-document-id="${currentId}"></a>`,
      },
    }],
    currentLinks: [
      { targetDocumentId: targetId, title: "Old target" },
      { documentId: missingId, title: "Missing target" },
      { documentId: "invalid" },
    ],
  });

  assert.deepEqual(harness.calls.mapConcurrency, [8]);
  assert.equal(harness.calls.reads.includes(targetPath), false);
  assert.equal(result.rootPath, rootPath);
  assert.deepEqual(
    result.documents.map((record) => record.title),
    ["Target override", "Duplicate", "Untitled"],
  );
  assert.equal(result.documents[2].needsIdentity, true);
  assert.deepEqual(result.links, [
    {
      targetDocumentId: targetId,
      title: "Target override",
      documentId: targetId,
      path: targetPath,
      relativePath: "Target.letterpaper",
      missing: false,
    },
    {
      documentId: missingId,
      title: "Missing target",
      targetDocumentId: missingId,
      path: "",
      relativePath: "",
      missing: true,
    },
  ]);
  assert.deepEqual(
    result.backlinks.map((record) => record.title),
    ["Target override"],
  );
  assert.deepEqual(
    result.duplicates.map((record) => record.title),
    ["Duplicate"],
  );
  for (const record of [
    ...result.documents,
    ...result.backlinks,
    ...result.duplicates,
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(record, "links"),
      false,
    );
  }
});

test("watch authorization generation rejects older starts and starts invalidated by stop", async () => {
  const harness = createHarness();
  const olderGate = {
    started: deferred(),
    release: deferred(),
  };
  harness.state.authorizationGates.set("older", olderGate);
  const older = harness.facade.startWatcher("older");
  await olderGate.started.promise;
  await harness.facade.startWatcher("newer");
  olderGate.release.resolve();
  await older;

  assert.deepEqual(
    harness.calls.watchers.map((watcher) => watcher.rootPath),
    ["newer"],
  );
  assert.equal(harness.calls.watchers[0].closed, false);
  assert.equal(harness.runtime.getActiveRoot(), "newer");

  const stoppedGate = {
    started: deferred(),
    release: deferred(),
  };
  harness.state.authorizationGates.set("stopped", stoppedGate);
  const stopped = harness.facade.startWatcher("stopped");
  await stoppedGate.started.promise;
  harness.facade.stopWatcher();
  stoppedGate.release.resolve();
  await stopped;

  assert.deepEqual(
    harness.calls.watchers.map((watcher) => watcher.rootPath),
    ["newer"],
  );
  assert.equal(harness.calls.watchers[0].closed, true);
  assert.equal(harness.runtime.getActiveRoot(), "");
});

test("stale watcher callbacks and timers cannot refresh indexes, log errors, or send renderer events", async () => {
  const harness = createHarness();
  await harness.facade.startWatcher("A");
  const watcherA = harness.calls.watchers[0];
  watcherA.callback("rename", "Old.letterpaper");
  const timerA = harness.calls.timers[0];
  assert.equal(timerA.delay, 180);
  assert.equal(timerA.unrefCalled, true);

  await harness.facade.startWatcher("B");
  const watcherB = harness.calls.watchers[1];
  assert.equal(watcherA.closed, true);
  assert.equal(timerA.cleared, true);

  watcherA.callback("change", "Stale.letterpaper");
  watcherA.errorHandler(new Error("stale watcher"));
  assert.equal(harness.calls.timers.length, 1);
  await timerA.callback();
  assert.deepEqual(harness.calls.indexRefreshes, []);
  assert.deepEqual(harness.calls.sent, []);
  assert.deepEqual(harness.calls.logs, []);

  watcherB.callback("rename", "Current.letterpaper");
  const timerB = harness.calls.timers[1];
  await timerB.callback();
  assert.deepEqual(harness.calls.indexRefreshes, ["B"]);
  assert.deepEqual(harness.calls.sent[0], [
    { id: "renderer" },
    "workspace:changed",
    {
      rootPath: "B",
      eventType: "rename",
      relativePath: "Current.letterpaper",
      changedAt: "2026-07-25T08:09:10.000Z",
    },
  ]);

  watcherB.errorHandler(new Error("watch failed"));
  assert.deepEqual(harness.calls.logs.at(-1), [
    "workspace:watch:error",
    { rootPath: "B", message: "watch failed" },
  ]);
  assert.deepEqual(harness.calls.sent.at(-1), [
    { id: "renderer" },
    "workspace:watch-error",
    { rootPath: "B", message: "watch failed" },
  ]);

  await harness.facade.startWatcher("B");
  assert.equal(harness.calls.watchers.length, 2);
  watcherB.callback("change", "Same-root.letterpaper");
  await harness.calls.timers.at(-1).callback();
  assert.equal(
    harness.calls.sent.at(-1)[2].relativePath,
    "Same-root.letterpaper",
  );
});

test("a watcher made stale during index refresh cannot send its completion event", async () => {
  const harness = createHarness();
  await harness.facade.startWatcher("A");
  const watcherA = harness.calls.watchers[0];
  const refreshGate = {
    started: deferred(),
    release: deferred(),
  };
  harness.state.indexRefreshGates.set("A", refreshGate);
  watcherA.callback("change", "A.letterpaper");
  const timerPromise = harness.calls.timers[0].callback();
  await refreshGate.started.promise;

  await harness.facade.startWatcher("B");
  refreshGate.release.resolve();
  await timerPromise;

  assert.deepEqual(harness.calls.indexRefreshes, ["A"]);
  assert.deepEqual(harness.calls.sent, []);
  assert.equal(harness.runtime.getActiveRoot(), "B");
});

test("a watcher made stale while resolving its index cannot start refresh or send", async () => {
  const harness = createHarness();
  await harness.facade.startWatcher("A");
  const watcherA = harness.calls.watchers[0];
  const indexAuthorizationGate = {
    started: deferred(),
    release: deferred(),
  };
  harness.state.authorizationGates.set("A", indexAuthorizationGate);
  watcherA.callback("change", "A.letterpaper");
  const timerPromise = harness.calls.timers[0].callback();
  await indexAuthorizationGate.started.promise;

  await harness.facade.startWatcher("B");
  indexAuthorizationGate.release.resolve();
  await timerPromise;

  assert.deepEqual(harness.calls.indexInitializes, ["A"]);
  assert.deepEqual(harness.calls.indexRefreshes, []);
  assert.deepEqual(harness.calls.sent, []);
  assert.equal(harness.runtime.getActiveRoot(), "B");
});

test("folder listing preserves metadata filtering, sorting, parent access, limits, and failure shapes", async () => {
  const harness = createHarness();
  const rootPath = "C:\\Workspace";
  harness.state.accessibleDirectories.add(
    harness.normalizeKey("C:\\"),
  );
  harness.state.accessibleDirectories.add(
    harness.normalizeKey(rootPath),
  );
  harness.state.folderEntries.set(rootPath, [
    createDirent(".jianjian", "directory"),
    createDirent("乙", "directory"),
    createDirent("甲", "directory"),
    createDirent("B.letterpaper", "file"),
    createDirent("A.paperwriter", "file"),
    createDirent("notes.txt", "file"),
  ]);
  harness.state.stats.set(`${rootPath}\\B.letterpaper`, {
    mtime: new Date("2026-07-25T01:00:00.000Z"),
    size: 20,
  });
  harness.state.stats.set(`${rootPath}\\A.paperwriter`, {
    mtime: new Date("2026-07-25T02:00:00.000Z"),
    size: 10,
  });

  const listed = await harness.facade.listFolderEntries(rootPath);
  assert.deepEqual(harness.calls.readdir, [[
    rootPath,
    { withFileTypes: true },
  ]]);
  assert.deepEqual(harness.calls.mapConcurrency, [32]);
  assert.equal(listed.parentPath, "C:\\");
  assert.deepEqual(
    listed.folders.map((entry) => entry.name),
    ["甲", "乙"],
  );
  assert.deepEqual(
    listed.files.map((entry) => entry.displayName),
    ["A", "B"],
  );
  assert.deepEqual(
    listed.entries.map((entry) => entry.name),
    ["甲", "乙", "A.paperwriter", "B.letterpaper"],
  );
  assert.equal(
    harness.calls.logs.some(
      ([event]) => event === "folder:entries:readdir",
    ),
    true,
  );

  assert.deepEqual(
    await harness.facade.listAuthorizedFolderEntries("C:\\Denied"),
    {
      folderPath: "",
      parentPath: "",
      folders: [],
      files: [],
      entries: [],
    },
  );
  await assert.rejects(
    harness.facade.listFolderEntries("C:\\Workspace\\.jianjian"),
    /\.jianjian 是工作区内部目录/,
  );

  assert.deepEqual(await harness.facade.listFolder(""), {
    canceled: true,
    files: [],
    folders: [],
    entries: [],
  });
  assert.deepEqual(harness.calls.logs.at(-1), [
    "folder:list:empty-path",
  ]);
  harness.state.authorizationErrors.set(
    "C:\\Denied",
    Object.assign(new Error("denied"), { code: "EACCES" }),
  );
  assert.deepEqual(await harness.facade.listFolder("C:\\Denied"), {
    canceled: true,
    folderPath: "",
    files: [],
    folders: [],
    entries: [],
  });
  assert.equal(harness.calls.logs.at(-1)[0], "folder:list:error");
  assert.equal(harness.calls.logs.at(-1)[1].code, "EACCES");
});

test("shutdown invalidates pending timers, closes the watcher, and clears the active root", async () => {
  const harness = createHarness();
  await harness.facade.startWatcher("C:\\Workspace");
  const watcher = harness.calls.watchers[0];
  watcher.callback("change", "Draft.letterpaper");
  const timer = harness.calls.timers[0];

  harness.runtime.shutdown();

  assert.equal(timer.cleared, true);
  assert.equal(watcher.closed, true);
  assert.equal(harness.runtime.getActiveRoot(), "");
  await timer.callback();
  assert.deepEqual(harness.calls.sent, []);
});

test("runtime owns workspace lifecycle while main only composes one instance and narrow facades", async () => {
  const runtimeSource = await fsPromises.readFile(
    path.join(__dirname, "workspace-runtime.cjs"),
    "utf8",
  );
  const mainSource = await fsPromises.readFile(
    path.join(__dirname, "main.cjs"),
    "utf8",
  );
  const registrarSource = await fsPromises.readFile(
    path.join(__dirname, "workspace-folder-ipc.cjs"),
    "utf8",
  );

  assert.match(
    runtimeSource,
    /const WORKSPACE_SEARCH_CACHE_FOLDER = "workspace-search"/,
  );
  assert.match(runtimeSource, /const workspaceSearchIndexes = new Map\(\)/);
  assert.match(runtimeSource, /let activeWorkspaceWatchGeneration = 0/);
  assert.match(
    runtimeSource,
    /function isCurrentWorkspaceWatch\(context\)[\s\S]*context\.generation === activeWorkspaceWatchGeneration[\s\S]*context\.watcher === activeWorkspaceWatcher[\s\S]*context\.rootPath === activeWorkspaceWatchRoot/,
  );
  assert.doesNotMatch(
    runtimeSource,
    /require\(["'][^"']*(?:document|research)/,
  );

  assert.equal(
    (mainSource.match(/createWorkspaceRuntime\(\{/g) || []).length,
    1,
  );
  assert.match(
    mainSource,
    /const workspaceRuntime = createWorkspaceRuntime\(\{/,
  );
  assert.doesNotMatch(
    mainSource,
    /WORKSPACE_SEARCH_CACHE_FOLDER|workspaceSearchIndexes|activeWorkspaceWatcher|activeWorkspaceWatchRoot|activeWorkspaceWatchTimer|activeWorkspaceWatchGeneration/,
  );
  assert.doesNotMatch(
    mainSource,
    /function (?:workspaceSearchCachePath|getWorkspaceSearchIndex|cancelWorkspaceSearch|startWorkspaceWatcher|stopWorkspaceWatcher|listFolderEntries|listAuthorizedFolderEntries)/,
  );
  assert.match(
    mainSource,
    /workspaceFacade:\s*workspaceRuntime\.facade/,
  );
  assert.match(
    mainSource,
    /getActiveWorkspaceRoot:\s*workspaceRuntime\.getActiveRoot/,
  );
  assert.match(
    mainSource,
    /app\.on\("before-quit",[\s\S]*workspaceRuntime\.shutdown\(\)/,
  );
  assert.match(
    registrarSource,
    /"folder:search",[\s\S]*search\(payload\)/,
  );
  assert.match(
    registrarSource,
    /"workspace:relationships",[\s\S]*relationships\(payload\)/,
  );
  assert.doesNotMatch(
    registrarSource,
    /workspaceSearchIndexes|walkWorkspaceDocuments|overrideByPath|activeWorkspaceWatch/,
  );
});
