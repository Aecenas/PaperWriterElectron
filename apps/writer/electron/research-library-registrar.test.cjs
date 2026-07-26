const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  registerResearchLibraryIpcHandlers,
} = require("./research-library-ipc.cjs");

const RESEARCH_LIBRARY_CHANNELS = [
  "research:document-open",
  "research:entry-copy-path",
  "research:entry-move",
  "research:entry-rename",
  "research:entry-show",
  "research:entry-trash",
  "research:file-import",
  "research:folder-create",
  "research:folder-list",
  "research:legacy-import",
  "research:pdf-read",
  "research:preview-read",
  "research:root-clear",
  "research:root-get",
  "research:root-pick",
  "research:search",
  "research:search-cancel",
  "research:source-delete",
  "research:source-list",
  "research:source-upsert",
  "research:watch",
  "research:web-folder-create",
  "research:web-folder-delete",
  "research:web-folder-update",
  "research:web-selection-copy",
  "research:web-source-move",
  "research:web-source-upsert",
  "research:web-tree-list",
];

function createHarness() {
  const handlers = new Map();
  const calls = {
    authorizedDirectories: [],
    clipboard: [],
    dialogs: [],
    documentImports: [],
    documentLoads: [],
    events: [],
    legacyImports: [],
    library: [],
    logs: [],
    markdown: [],
    resolvedLegacyFiles: [],
    searchCancels: [],
    searchClears: [],
    searchInvalidations: [],
    searches: [],
    sanitized: [],
    workspaces: [],
  };
  const state = {
    activeWorkspaceRoot: "C:\\Workspace",
    dialogResults: [],
    libraryImplementations: new Map(),
    preview: {
      libraryId: "library-1",
      relativePath: "note.md",
      name: "note.md",
      previewKind: "markdown",
      mime: "text/markdown",
      size: 12,
      diskRevision: { size: 12 },
      path: "C:\\Library\\note.md",
      bytes: Buffer.from("# Note"),
    },
    root: {
      configured: true,
      available: true,
      libraryId: "library-1",
      rootPath: "C:\\Library",
    },
    workspaceId: "ABCDEFAB-1234-4234-9234-ABCDEFABCDEF",
  };

  function callLibrary(method, args) {
    calls.library.push([method, ...args]);
    const implementation = state.libraryImplementations.get(method);
    if (typeof implementation === "function") return implementation(...args);
    if (implementation instanceof Error) throw implementation;
    if (implementation !== undefined) return implementation;
    if (method === "getRoot") return state.root;
    if (method === "copyEntryPath") {
      return {
        libraryId: args[0],
        relativePath: args[1],
        path: "C:\\Library\\Draft.letterpaper",
      };
    }
    if (method === "readPreview") return state.preview;
    return { method };
  }

  const library = new Proxy({}, {
    get(_target, property) {
      return (...args) => callLibrary(property, args);
    },
  });

  registerResearchLibraryIpcHandlers({
    ipcMain: {
      handle(channel, listener) {
        assert.equal(handlers.has(channel), false, `duplicate test handler: ${channel}`);
        handlers.set(channel, listener);
      },
    },
    app: {
      getPath(name) {
        if (name === "documents") return "C:\\Documents";
        throw new Error(`unexpected app path: ${name}`);
      },
    },
    clipboard: {
      writeText(value) {
        calls.clipboard.push(value);
      },
    },
    dialog: {
      async showOpenDialog(window, options) {
        calls.dialogs.push([window, options]);
        return state.dialogResults.shift() || { canceled: true, filePaths: [] };
      },
    },
    fs: { marker: "fs-api" },
    path: path.win32,
    platform: "win32",
    shell: {
      async trashItem() {},
      showItemInFolder() {},
    },
    revisionConflictCode: "DOCUMENT_REVISION_CONFLICT",
    getMainWindow: () => ({ id: "main-window" }),
    researchFacade: {
      requireLibrary: () => library,
      getActiveWorkspaceRoot: () => state.activeWorkspaceRoot,
      decodePreviewText: (bytes) => Buffer.from(bytes).toString("utf8"),
      searchResearch: async (payload, options = {}) => {
        calls.searches.push(payload);
        options.onProgress?.({
          libraryId: payload.libraryId,
          requestId: payload.requestId,
          phase: "searching",
          percent: 50,
        });
        return {
          requestId: payload.requestId,
          query: payload.query,
          canceled: false,
          results: [],
        };
      },
      cancelResearchSearch: (libraryId, requestId) => {
        calls.searchCancels.push([libraryId, requestId]);
        return true;
      },
      clearResearchSearch: async (options) => {
        calls.searchClears.push(options);
      },
      invalidateResearchSearch: (change) => {
        calls.searchInvalidations.push(change);
      },
      sendEvent: (channel, payload) => {
        calls.events.push([channel, payload]);
      },
    },
    ensureWorkspace: async (rootPath) => {
      calls.workspaces.push(rootPath);
      return { manifest: { workspaceId: state.workspaceId } };
    },
    normalizeWebScopeKey: (value) => String(value || "").toLocaleLowerCase("en-US"),
    assertAuthorizedDirectory: async (workspacePath) => {
      calls.authorizedDirectories.push(workspacePath);
      return workspacePath;
    },
    listResearchSources: async (workspacePath) => {
      calls.legacyListPath = workspacePath;
      return {
        workspaceId: "legacy-workspace",
        sources: [{ id: "legacy-source" }],
        warnings: ["legacy-warning"],
      };
    },
    importLegacyResearch: async (options) => {
      calls.legacyImports.push(options);
      return { imported: 1 };
    },
    resolveSourceFile: async (workspacePath, source) => {
      calls.resolvedLegacyFiles.push([workspacePath, source]);
      return { filePath: `${workspacePath}\\source.pdf` };
    },
    storageFacade: {
      async importDocument(options) {
        calls.documentImports.push(options);
        return {
          document: { html: "<p>DOCX</p>" },
          warnings: ["docx-warning"],
        };
      },
      async loadPaperDocumentSnapshot(filePath, metrics) {
        calls.documentLoads.push(filePath);
        metrics.readMs = 7;
        return {
          document: {
            title: "Draft",
            _readOnlyFutureSchema: false,
          },
          diskRevision: { size: 42 },
        };
      },
      autosaveSessionIdForPath: () => "recovery-1",
    },
    markdownToHtml: (text) => {
      calls.markdown.push(text);
      return { html: `<h1>${text.slice(2)}</h1>` };
    },
    sanitizeImportedHtml: async (html, options) => {
      calls.sanitized.push([html, options]);
      return { html: `<article>${html}</article>`, warnings: ["sanitized"] };
    },
    documentModel: {
      isSupportedDocument: (filePath) => filePath.endsWith(".letterpaper"),
    },
    authorizeDocumentPath: async (filePath) => `authorized:${filePath}`,
    writeDebugLog: async (...args) => {
      calls.logs.push(args);
    },
  });

  return {
    calls,
    handlers,
    library,
    state,
  };
}

test("registers the complete independent research-library surface exactly once", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()].sort(), RESEARCH_LIBRARY_CHANNELS);
});

test("forwards simple capability payloads without changing defaults or native callbacks", async () => {
  const harness = createHarness();
  const cases = [
    ["research:root-get", [], ["getRoot"]],
    ["research:root-clear", [], ["clearRoot"]],
    ["research:folder-list", [{ libraryId: "lib", relativePath: "论文" }], ["listFolder", "lib", "论文"]],
    ["research:folder-create", [{ libraryId: "lib", name: "2026" }], ["createFolder", "lib", "", "2026"]],
    ["research:entry-rename", [{ libraryId: "lib", relativePath: "a.pdf", nextName: "b.pdf" }], ["renameEntry", "lib", "a.pdf", "b.pdf"]],
    ["research:entry-move", [{ libraryId: "lib", relativePath: "a.pdf" }], ["moveEntry", "lib", "a.pdf", ""]],
    ["research:source-list", [{ libraryId: "lib" }], ["listSources", "lib"]],
    ["research:web-tree-list", [{ libraryId: "lib" }], ["listWebTree", "lib"]],
    ["research:pdf-read", [{ libraryId: "lib", relativePath: "a.pdf" }], ["readPdf", "lib", "a.pdf"]],
  ];

  for (const [channel, args, expectedCall] of cases) {
    const before = harness.calls.library.length;
    await harness.handlers.get(channel)({}, ...args);
    if (channel === "research:root-clear") {
      assert.deepEqual(harness.calls.library.slice(before), [
        ["getRoot"],
        ["clearRoot"],
      ]);
    } else {
      assert.deepEqual(harness.calls.library[before], expectedCall);
    }
  }

  await harness.handlers.get("research:entry-trash")({}, {
    libraryId: "lib",
    relativePath: "a.pdf",
  });
  assert.deepEqual(harness.calls.library.at(-1).slice(0, 3), [
    "trashEntry",
    "lib",
    "a.pdf",
  ]);
  assert.equal(typeof harness.calls.library.at(-1)[3], "function");

  await harness.handlers.get("research:entry-show")({}, {
    libraryId: "lib",
    relativePath: "a.pdf",
  });
  assert.deepEqual(harness.calls.library.at(-1).slice(0, 3), [
    "showEntry",
    "lib",
    "a.pdf",
  ]);
  assert.equal(typeof harness.calls.library.at(-1)[3], "function");

  assert.deepEqual(
    await harness.handlers.get("research:entry-copy-path")({}, {
      libraryId: "lib",
      relativePath: "Draft.letterpaper",
    }),
    {
      ok: true,
      libraryId: "lib",
      relativePath: "Draft.letterpaper",
    },
  );
  assert.deepEqual(harness.calls.clipboard, ["C:\\Library\\Draft.letterpaper"]);
});

test("research search validates web scopes, reports keyed progress, and cancels exact requests", async () => {
  const harness = createHarness();
  const privateScope = `workspace:${harness.state.workspaceId.toLowerCase()}`;
  const result = await harness.handlers.get("research:search")({}, {
    libraryId: "library-1",
    requestId: "search-1",
    query: "研究方法",
    scopeKey: "global",
    workspaceScopeKey: privateScope,
    limit: 500,
    kinds: ["pdf"],
    rootPath: "C:\\Renderer\\secret",
  });
  assert.equal(result.requestId, "search-1");
  assert.deepEqual(harness.calls.searches, [{
    libraryId: "library-1",
    requestId: "search-1",
    query: "研究方法",
    scopeKey: "global",
    workspaceScopeKey: privateScope,
    limit: 200,
    includeFiles: true,
    includeWeb: true,
    kinds: ["pdf"],
  }]);
  assert.deepEqual(harness.calls.events.at(-1), [
    "research:search-progress",
    {
      libraryId: "library-1",
      requestId: "search-1",
      phase: "searching",
      percent: 50,
    },
  ]);
  assert.deepEqual(
    await harness.handlers.get("research:search-cancel")({}, {
      libraryId: "library-1",
      requestId: "search-1",
    }),
    { ok: true },
  );
  assert.deepEqual(harness.calls.searchCancels, [[
    "library-1",
    "search-1",
  ]]);

  await assert.rejects(
    () => harness.handlers.get("research:search")({}, {
      libraryId: "library-1",
      requestId: "search-2",
      query: "越界",
      workspaceScopeKey: "workspace:someone-else",
    }),
    /只能搜索当前打开工作区的私区网页/,
  );
  assert.equal(harness.calls.searches.length, 1);
});

test("root and file pickers preserve capability-first validation and ignore renderer paths", async () => {
  const harness = createHarness();
  harness.state.dialogResults.push(
    { canceled: true, filePaths: [] },
    { canceled: false, filePaths: ["C:\\Picked\\a.pdf", "C:\\Picked\\b.pdf"] },
  );

  assert.deepEqual(await harness.handlers.get("research:root-pick")(), {
    canceled: true,
    ...harness.state.root,
  });
  assert.deepEqual(harness.calls.dialogs[0], [
    { id: "main-window" },
    {
      title: "选择资料目录",
      defaultPath: "C:\\Library",
      properties: ["openDirectory", "createDirectory"],
    },
  ]);

  const result = await harness.handlers.get("research:file-import")({}, {
    libraryId: "lib",
    targetRelativePath: "论文",
    filePaths: ["C:\\Renderer\\secret.pdf"],
  });
  assert.deepEqual(harness.calls.library.slice(-2), [
    ["listFolder", "lib", "论文"],
    [
      "importFiles",
      "lib",
      "论文",
      ["C:\\Picked\\a.pdf", "C:\\Picked\\b.pdf"],
    ],
  ]);
  assert.deepEqual(result, { method: "importFiles" });
  assert.deepEqual(harness.calls.dialogs[1][1].properties, [
    "openFile",
    "multiSelections",
  ]);
});

test("maps source revision conflicts without swallowing unrelated failures", async () => {
  const harness = createHarness();
  const revision = { size: 1, mtimeMs: 2, sha256: "a".repeat(64) };
  harness.state.libraryImplementations.set("upsertSource", {
    source: { id: "source-1" },
    diskRevision: revision,
  });

  assert.deepEqual(
    await harness.handlers.get("research:source-upsert")({}, {
      libraryId: "lib",
      source: { id: "source-1" },
      expectedRevision: revision,
    }),
    {
      ok: true,
      source: { id: "source-1" },
      diskRevision: revision,
    },
  );
  assert.deepEqual(harness.calls.library.at(-1), [
    "upsertSource",
    "lib",
    { id: "source-1" },
    revision,
  ]);

  harness.state.libraryImplementations.set(
    "deleteSource",
    Object.assign(new Error("changed outside"), {
      code: "DOCUMENT_REVISION_CONFLICT",
      expectedRevision: revision,
      actualRevision: { size: 3 },
    }),
  );
  assert.deepEqual(
    await harness.handlers.get("research:source-delete")({}, {
      libraryId: "lib",
      sourceId: "source-1",
      expectedRevision: revision,
    }),
    {
      ok: false,
      conflict: true,
      code: "DOCUMENT_REVISION_CONFLICT",
      message: "changed outside",
      expectedRevision: revision,
      actualRevision: { size: 3 },
    },
  );

  harness.state.libraryImplementations.set(
    "deleteSource",
    Object.assign(new Error("permission denied"), { code: "EACCES" }),
  );
  await assert.rejects(
    () => harness.handlers.get("research:source-delete")({}, {
      libraryId: "lib",
      sourceId: "source-1",
    }),
    /permission denied/,
  );
});

test("forwards every web-tree mutation with its exact revision and payload defaults", async () => {
  const harness = createHarness();
  const revision = { size: 7 };
  const cases = [
    [
      "research:web-folder-create",
      { libraryId: "lib", folder: { name: "Group" }, expectedRevision: revision },
      ["createWebFolder", "lib", { name: "Group" }, revision],
    ],
    [
      "research:web-folder-update",
      { libraryId: "lib", folder: { id: "folder" }, expectedRevision: revision },
      ["updateWebFolder", "lib", { id: "folder" }, revision],
    ],
    [
      "research:web-folder-delete",
      { libraryId: "lib", folderId: "folder", expectedRevision: revision },
      ["deleteWebFolder", "lib", "folder", revision],
    ],
    [
      "research:web-source-move",
      {
        libraryId: "lib",
        sourceId: "source",
        placement: { scopeKey: "global", folderId: "folder" },
        expectedRevision: revision,
      },
      [
        "moveWebSource",
        "lib",
        "source",
        { scopeKey: "global", folderId: "folder" },
        revision,
      ],
    ],
  ];

  for (const [channel, payload, expectedCall] of cases) {
    assert.deepEqual(
      await harness.handlers.get(channel)({}, payload),
      { ok: true, method: expectedCall[0] },
    );
    assert.deepEqual(harness.calls.library.at(-1), expectedCall);
  }
});

test("binds public web copying to the current workspace identity only", async () => {
  const harness = createHarness();
  const selection = {
    sourceIds: ["source-1"],
    targetScopeKey: `workspace:${harness.state.workspaceId.toLowerCase()}`,
  };

  assert.deepEqual(
    await harness.handlers.get("research:web-selection-copy")({}, {
      libraryId: "lib",
      selection,
      workspacePath: "C:\\RendererControlled",
    }),
    { ok: true, method: "copyWebSelection" },
  );
  assert.deepEqual(harness.calls.workspaces, ["C:\\Workspace"]);
  assert.deepEqual(harness.calls.library.at(-1), [
    "copyWebSelection",
    "lib",
    selection,
  ]);

  await assert.rejects(
    () => harness.handlers.get("research:web-selection-copy")({}, {
      libraryId: "lib",
      selection: { targetScopeKey: "workspace:someone-else" },
    }),
    /只能复制到当前打开工作区的私区/,
  );

  harness.state.activeWorkspaceRoot = "";
  await assert.rejects(
    () => harness.handlers.get("research:web-selection-copy")({}, {
      libraryId: "lib",
      selection,
    }),
    /当前没有打开的写作工作区/,
  );
});

test("keeps saved web sources when placement falls back after a tree conflict", async () => {
  const harness = createHarness();
  const sourceRevision = { size: 1 };
  const treeRevision = { size: 2 };
  harness.state.libraryImplementations.set("upsertSource", {
    source: { id: "web-1" },
    diskRevision: sourceRevision,
  });
  harness.state.libraryImplementations.set(
    "moveWebSource",
    Object.assign(new Error("tree changed"), {
      code: "DOCUMENT_REVISION_CONFLICT",
    }),
  );
  harness.state.libraryImplementations.set("listWebTree", {
    folders: [],
    placements: [],
    diskRevision: treeRevision,
  });

  assert.deepEqual(
    await harness.handlers.get("research:web-source-upsert")({}, {
      libraryId: "lib",
      source: { title: "Web" },
      placement: { scopeKey: "global", folderId: "folder" },
      revisions: {
        source: sourceRevision,
        tree: treeRevision,
      },
    }),
    {
      ok: true,
      source: { id: "web-1" },
      diskRevision: sourceRevision,
      tree: {
        folders: [],
        placements: [],
        diskRevision: treeRevision,
      },
      placementFallback: true,
      warning: "网页已保存，但分组索引发生冲突；新网页暂时回退到全局未分组。",
    },
  );
  assert.deepEqual(harness.calls.library.slice(-3), [
    ["upsertSource", "lib", { title: "Web" }, sourceRevision],
    [
      "moveWebSource",
      "lib",
      "web-1",
      { scopeKey: "global", folderId: "folder" },
      treeRevision,
    ],
    ["listWebTree", "lib"],
  ]);
});

test("legacy import requires both the active workspace and target library capabilities", async () => {
  const harness = createHarness();
  const result = await harness.handlers.get("research:legacy-import")({}, {
    workspacePath: "c:\\workspace",
    libraryId: "lib",
    sourcePaths: ["C:\\Renderer\\secret.pdf"],
  });

  assert.deepEqual(result, { imported: 1 });
  assert.deepEqual(harness.calls.authorizedDirectories, ["c:\\workspace"]);
  assert.deepEqual(harness.calls.library.at(-1), ["listSources", "lib"]);
  assert.equal(harness.calls.legacyListPath, "c:\\workspace");
  const options = harness.calls.legacyImports[0];
  assert.equal(options.manager, harness.library);
  assert.equal(options.libraryId, "lib");
  assert.equal(options.workspaceId, "legacy-workspace");
  assert.deepEqual(options.sources, [{ id: "legacy-source" }]);
  assert.deepEqual(options.warnings, ["legacy-warning"]);
  assert.deepEqual(
    await options.resolveFile({ id: "legacy-source" }),
    { filePath: "c:\\workspace\\source.pdf" },
  );

  const denied = createHarness();
  denied.state.activeWorkspaceRoot = "C:\\Other";
  await assert.rejects(
    () => denied.handlers.get("research:legacy-import")({}, {
      workspacePath: "C:\\Workspace",
      libraryId: "lib",
    }),
    /只能从左侧文件区当前打开的写作工作区导入旧资料库/,
  );
  assert.equal(
    denied.calls.library.some(([method]) => method === "listSources"),
    false,
  );
});

test("renders preview variants only after resolving independent-library capabilities", async () => {
  const harness = createHarness();
  const preview = harness.handlers.get("research:preview-read");

  harness.state.preview = {
    ...harness.state.preview,
    previewKind: "image",
    mime: "image/png",
    bytes: Buffer.from([1, 2, 3]),
  };
  const image = await preview({}, {
    libraryId: "lib",
    relativePath: "image.png",
    path: "C:\\Renderer\\secret.png",
  });
  assert.deepEqual(image.bytes, Buffer.from([1, 2, 3]));

  harness.state.preview = {
    ...harness.state.preview,
    previewKind: "docx",
    path: "C:\\Library\\paper.docx",
    bytes: Buffer.from("docx"),
  };
  const docx = await preview({}, {
    libraryId: "lib",
    relativePath: "paper.docx",
  });
  assert.equal(docx.html, "<p>DOCX</p>");
  assert.deepEqual(harness.calls.documentImports[0], {
    format: "docx",
    sourcePath: "C:\\Library\\paper.docx",
    buffer: Buffer.from("docx"),
  });

  harness.state.preview = {
    ...harness.state.preview,
    previewKind: "markdown",
    path: "C:\\Library\\note.md",
    bytes: Buffer.from("# Note"),
  };
  const markdown = await preview({}, {
    libraryId: "lib",
    relativePath: "note.md",
  });
  assert.equal(markdown.html, "<article><h1>Note</h1></article>");
  assert.deepEqual(harness.calls.sanitized[0][1], {
    sourcePath: "C:\\Library\\note.md",
    fsApi: { marker: "fs-api" },
    pathApi: path.win32,
  });
});

test("opens library documents with revisions and forwards removable watcher events", async () => {
  const harness = createHarness();
  const opened = await harness.handlers.get("research:document-open")({}, {
    libraryId: "lib",
    relativePath: "Draft.letterpaper",
    filePath: "C:\\Renderer\\secret.letterpaper",
  });
  assert.deepEqual(opened, {
    canceled: false,
    path: "authorized:C:\\Library\\Draft.letterpaper",
    document: { title: "Draft", _readOnlyFutureSchema: false },
    diskRevision: { size: 42 },
    readOnly: false,
    recoveryId: "recovery-1",
  });
  assert.deepEqual(harness.calls.documentLoads, [
    "authorized:C:\\Library\\Draft.letterpaper",
  ]);
  assert.deepEqual(harness.calls.logs, [[
    "research:document-open:loaded",
    {
      filePath: "authorized:C:\\Library\\Draft.letterpaper",
      readMs: 7,
    },
  ]]);

  harness.state.libraryImplementations.set(
    "watchLibrary",
    (_libraryId, callbacks) => {
      callbacks.onChange({ relativePath: "a.pdf" });
      callbacks.onError({ message: "watch failed" });
      return { ok: true };
    },
  );
  assert.deepEqual(
    await harness.handlers.get("research:watch")({}, { libraryId: "lib" }),
    { ok: true },
  );
  assert.deepEqual(harness.calls.events, [
    ["research:changed", { relativePath: "a.pdf" }],
    ["research:watch-error", { message: "watch failed" }],
  ]);
});
