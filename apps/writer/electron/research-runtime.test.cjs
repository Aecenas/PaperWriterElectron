const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { createResearchRuntime } = require("./research-runtime.cjs");

function createHarness() {
  const calls = {
    decodeText: [],
    emits: [],
    libraryCreates: [],
    listRoots: [],
    mapConcurrency: [],
    operations: [],
    resolvedSources: [],
    webCreates: [],
    webMethods: [],
  };
  const state = {
    activeWorkspaceRoot: "C:\\Workspace",
    listed: {
      workspaceId: "workspace-id",
      sources: [],
      warnings: [],
    },
    resolutionErrors: new Map(),
  };
  const library = {
    marker: "library",
    async initialize() {
      calls.operations.push("library:initialize");
    },
    closeWatcher() {
      calls.operations.push("library:close-watcher");
    },
  };
  const webViews = {
    marker: "web-views",
    show(payload) {
      calls.webMethods.push(["show", payload]);
      return { ok: true, method: "show", payload };
    },
    updateBounds(payload) {
      calls.webMethods.push(["updateBounds", payload]);
      return { ok: true, method: "updateBounds", payload };
    },
    hide(viewId) {
      calls.webMethods.push(["hide", viewId]);
      return { ok: true, method: "hide", viewId };
    },
    control(payload) {
      calls.webMethods.push(["control", payload]);
      return { ok: true, method: "control", payload };
    },
    destroy(viewId) {
      calls.webMethods.push(["destroy", viewId]);
      return { ok: true, method: "destroy", viewId };
    },
    destroyAll() {
      calls.operations.push("web-views:destroy-all");
    },
  };
  const runtime = createResearchRuntime({
    createResearchLibraryManager(options) {
      calls.libraryCreates.push(options);
      calls.operations.push("library:create");
      return library;
    },
    createResearchWebViewManager(options) {
      calls.webCreates.push(options);
      calls.operations.push("web-views:create");
      return webViews;
    },
    getUserDataPath: () => "C:\\UserData",
    WebContentsView: function WebContentsView() {},
    session: { id: "session" },
    shell: { id: "shell" },
    dialog: { id: "dialog" },
    getWindow: () => ({ id: "main-window" }),
    getActiveWorkspaceRoot: () => state.activeWorkspaceRoot,
    emitRendererEvent(channel, payload) {
      calls.emits.push([channel, payload]);
    },
    decodeTextBuffer(buffer, encoding, iconvLite) {
      calls.decodeText.push([Buffer.from(buffer), encoding, iconvLite]);
      return "decoded-bom";
    },
    iconvLite: {
      decode(buffer, encoding) {
        calls.decodeText.push([Buffer.from(buffer), encoding]);
        return "decoded-gb18030";
      },
    },
    async listResearchSources(rootPath) {
      calls.listRoots.push(rootPath);
      return state.listed;
    },
    async resolveSourceFile(rootPath, source) {
      calls.resolvedSources.push([rootPath, source]);
      const error = state.resolutionErrors.get(source.id);
      if (error) throw error;
      return { filePath: `${rootPath}\\${source.id}.pdf` };
    },
    async mapWithConcurrency(items, concurrency, worker) {
      calls.mapConcurrency.push(concurrency);
      return Promise.all(items.map(worker));
    },
  });
  return {
    calls,
    library,
    runtime,
    state,
    webViews,
  };
}

test("initialization creates the library before web views and exposes only stable facades", async () => {
  const harness = createHarness();
  assert.equal(harness.runtime.getLibrary(), null);
  assert.equal(harness.runtime.getWebViews(), null);
  assert.throws(
    () => harness.runtime.libraryFacade.requireLibrary(),
    /独立资料库尚未初始化/,
  );
  assert.deepEqual(harness.runtime.webViewFacade.show(), {
    ok: false,
    unsupported: true,
  });
  assert.deepEqual(harness.runtime.webViewFacade.hide(), { ok: true });

  await harness.runtime.initialize();

  assert.deepEqual(harness.calls.operations, [
    "library:create",
    "library:initialize",
    "web-views:create",
  ]);
  assert.deepEqual(harness.calls.libraryCreates, [{
    userDataPath: "C:\\UserData",
  }]);
  assert.equal(harness.runtime.getLibrary(), harness.library);
  assert.equal(harness.runtime.getWebViews(), harness.webViews);
  assert.equal(
    harness.runtime.libraryFacade.requireLibrary(),
    harness.library,
  );
  assert.equal(
    harness.runtime.libraryFacade.getActiveWorkspaceRoot(),
    "C:\\Workspace",
  );

  const webOptions = harness.calls.webCreates[0];
  assert.equal(webOptions.session.id, "session");
  assert.equal(webOptions.shell.id, "shell");
  assert.equal(webOptions.dialog.id, "dialog");
  assert.deepEqual(webOptions.getWindow(), { id: "main-window" });
  webOptions.sendState({ viewId: "view-1" });
  assert.deepEqual(harness.calls.emits, [[
    "research:web-view-state",
    { viewId: "view-1" },
  ]]);
});

test("web-view facade preserves payloads, defaults, and manager return values", async () => {
  const harness = createHarness();
  await harness.runtime.initialize();
  const payload = {
    viewId: "view-1",
    url: "https://example.com",
    nested: { keep: true },
  };

  assert.deepEqual(
    harness.runtime.webViewFacade.show(payload),
    { ok: true, method: "show", payload },
  );
  assert.deepEqual(
    harness.runtime.webViewFacade.updateBounds(payload),
    { ok: true, method: "updateBounds", payload },
  );
  assert.deepEqual(
    harness.runtime.webViewFacade.hide(),
    { ok: true, method: "hide", viewId: "" },
  );
  assert.deepEqual(
    harness.runtime.webViewFacade.control(),
    { ok: true, method: "control", payload: {} },
  );
  assert.deepEqual(
    harness.runtime.webViewFacade.destroy(),
    { ok: true, method: "destroy", viewId: "" },
  );
  assert.deepEqual(harness.calls.webMethods, [
    ["show", payload],
    ["updateBounds", payload],
    ["hide", ""],
    ["control", {}],
    ["destroy", ""],
  ]);
});

test("preview decoding preserves BOM handling, strict UTF-8, and GB18030 fallback", () => {
  const harness = createHarness();
  assert.equal(
    harness.runtime.libraryFacade.decodePreviewText(
      Buffer.from([0xef, 0xbb, 0xbf, 0x61]),
    ),
    "decoded-bom",
  );
  assert.equal(harness.calls.decodeText[0][1], "utf8");

  assert.equal(
    harness.runtime.libraryFacade.decodePreviewText(
      Buffer.from("中文", "utf8"),
    ),
    "中文",
  );
  assert.equal(
    harness.runtime.libraryFacade.decodePreviewText(
      Buffer.from([0x81]),
    ),
    "decoded-gb18030",
  );
  assert.equal(harness.calls.decodeText.at(-1)[1], "gb18030");
});

test("legacy research list payload preserves concurrency, source identity, and missing markers", async () => {
  const harness = createHarness();
  const webSource = { id: "web", type: "web", title: "Web" };
  const available = { id: "available", type: "file", title: "PDF" };
  const missing = { id: "missing", type: "file", title: "Missing" };
  harness.state.listed = {
    workspaceId: "workspace-id",
    sources: [webSource, available, missing],
    warnings: ["legacy-warning"],
  };
  harness.state.resolutionErrors.set(
    "missing",
    new Error("资料文件不存在"),
  );

  assert.deepEqual(
    await harness.runtime.libraryFacade.listPayload("C:\\Workspace"),
    {
      workspaceId: "workspace-id",
      sources: [
        webSource,
        { ...available, missing: false },
        {
          ...missing,
          missing: true,
          missingReason: "资料文件不存在",
        },
      ],
      warnings: ["legacy-warning"],
    },
  );
  assert.deepEqual(harness.calls.listRoots, ["C:\\Workspace"]);
  assert.deepEqual(harness.calls.mapConcurrency, [12]);
  assert.deepEqual(
    harness.calls.resolvedSources.map(([, source]) => source.id),
    ["available", "missing"],
  );
  assert.equal(webSource.missing, undefined);
});

test("window cleanup destroys only web views while shutdown also closes the library watcher", async () => {
  const harness = createHarness();
  await harness.runtime.initialize();
  harness.calls.operations.length = 0;

  harness.runtime.destroyWebViews();
  assert.deepEqual(harness.calls.operations, [
    "web-views:destroy-all",
  ]);
  assert.equal(
    harness.runtime.libraryFacade.requireLibrary(),
    harness.library,
  );

  harness.runtime.shutdown();
  assert.deepEqual(harness.calls.operations, [
    "web-views:destroy-all",
    "library:close-watcher",
    "web-views:destroy-all",
  ]);
});

test("library facade emits watcher events without changing their channel or payload", () => {
  const harness = createHarness();
  const payload = {
    libraryId: "library",
    generation: 3,
    relativePath: "资料.pdf",
  };
  harness.runtime.libraryFacade.sendEvent("research:changed", payload);
  assert.deepEqual(harness.calls.emits, [[
    "research:changed",
    payload,
  ]]);
});

test("runtime owns research lifecycle and main composes one instance with the correct close boundaries", async () => {
  const runtimeSource = await fs.readFile(
    path.join(__dirname, "research-runtime.cjs"),
    "utf8",
  );
  const mainSource = await fs.readFile(
    path.join(__dirname, "main.cjs"),
    "utf8",
  );
  const libraryIpcSource = await fs.readFile(
    path.join(__dirname, "research-library-ipc.cjs"),
    "utf8",
  );
  const workspaceIpcSource = await fs.readFile(
    path.join(__dirname, "workspace-research-ipc.cjs"),
    "utf8",
  );

  assert.match(runtimeSource, /let researchLibrary = null/);
  assert.match(runtimeSource, /let researchWebViews = null/);
  assert.match(
    runtimeSource,
    /require\(["']\.\/research-search-extractors\.cjs["']\)/,
  );
  assert.match(
    runtimeSource,
    /require\(["']\.\/research-search-index\.cjs["']\)/,
  );
  assert.doesNotMatch(
    runtimeSource,
    /require\(["']\.\/(?:main|application-ipc|research-library-ipc|workspace-research-ipc)\.cjs["']\)/,
  );
  assert.equal(
    (mainSource.match(/createResearchRuntime\(\{/g) || []).length,
    1,
  );
  assert.match(
    mainSource,
    /getActiveWorkspaceRoot:\s*workspaceRuntime\.getActiveRoot/,
  );
  assert.doesNotMatch(
    mainSource,
    /let researchLibrary|let researchWebViews|function requireResearchLibrary|function decodeResearchPreviewText|function researchListPayload/,
  );
  assert.match(
    mainSource,
    /mainWindow\.on\("closed",[\s\S]*researchRuntime\.destroyWebViews\(\)[\s\S]*mainWindow = null/,
  );
  const closedBlock = mainSource.slice(
    mainSource.indexOf('mainWindow.on("closed"'),
    mainSource.indexOf("if (FRONTEND_URL)", mainSource.indexOf('mainWindow.on("closed"')),
  );
  assert.doesNotMatch(closedBlock, /shutdown|closeWatcher/);
  assert.match(
    mainSource,
    /app\.on\("before-quit",[\s\S]*researchRuntime\.shutdown\(\)/,
  );
  assert.match(
    mainSource,
    /webViewFacade:\s*researchRuntime\.webViewFacade/,
  );
  assert.equal(
    (mainSource.match(/researchFacade:\s*researchRuntime\.libraryFacade/g) || []).length,
    2,
  );
  assert.match(libraryIpcSource, /researchFacade,/);
  assert.match(workspaceIpcSource, /researchFacade,/);
});
