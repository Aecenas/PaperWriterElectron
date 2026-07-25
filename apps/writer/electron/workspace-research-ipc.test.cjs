const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  registerWorkspaceResearchIpcHandlers,
} = require("./workspace-research-ipc.cjs");

const WORKSPACE_RESEARCH_CHANNELS = [
  "citation:delete",
  "citation:list",
  "citation:upsert",
  "research:create",
  "research:delete",
  "research:list",
  "research:open-external",
  "research:read-file",
  "research:relink",
  "research:update",
  "workspace:identity",
];

function createHarness() {
  const handlers = new Map();
  const calls = {
    authorizedDirectories: [],
    canonicalPaths: [],
    citationDeletes: [],
    citationLists: [],
    citationUpserts: [],
    creates: [],
    deletes: [],
    dialogs: [],
    externalLibrary: [],
    openExternal: [],
    openPaths: [],
    reads: [],
    relinks: [],
    resolved: [],
    sourceLists: [],
    updates: [],
    workspaces: [],
  };
  const state = {
    dialogResults: [],
    fileBytes: Buffer.from("research bytes"),
    fileSize: 14,
    isFile: true,
    openPathError: "",
    source: {
      id: "source-1",
      type: "file",
      storage: "linked",
      title: "Source",
    },
  };
  const library = {
    async openEntryExternal(libraryId, relativePath, openPath) {
      calls.externalLibrary.push([libraryId, relativePath, openPath]);
      return { ok: true, libraryId, relativePath };
    },
  };

  registerWorkspaceResearchIpcHandlers({
    ipcMain: {
      handle(channel, listener) {
        assert.equal(handlers.has(channel), false, `duplicate test handler: ${channel}`);
        handlers.set(channel, listener);
      },
    },
    app: {
      getPath(name) {
        assert.equal(name, "documents");
        return "C:\\Documents";
      },
    },
    dialog: {
      async showOpenDialog(window, options) {
        calls.dialogs.push([window, options]);
        return state.dialogResults.shift() || {
          canceled: true,
          filePaths: [],
        };
      },
    },
    fs: {
      async stat(filePath) {
        calls.statPath = filePath;
        return {
          size: state.fileSize,
          isFile: () => state.isFile,
        };
      },
      async readFile(filePath) {
        calls.readFilePath = filePath;
        return state.fileBytes;
      },
    },
    path: path.win32,
    shell: {
      async openExternal(url) {
        calls.openExternal.push(url);
      },
      async openPath(filePath) {
        calls.openPaths.push(filePath);
        return state.openPathError;
      },
    },
    researchReadMaxBytes: 1024,
    getMainWindow: () => ({ id: "main-window" }),
    researchFacade: {
      requireLibrary: () => library,
      listPayload: async (rootPath) => {
        calls.sourceLists.push(rootPath);
        return {
          workspaceId: "workspace-id",
          sources: [{ id: "listed" }],
          warnings: [],
        };
      },
    },
    assertAuthorizedDirectory: async (workspacePath) => {
      calls.authorizedDirectories.push(workspacePath);
      return workspacePath;
    },
    ensureWorkspace: async (rootPath) => {
      calls.workspaces.push(rootPath);
      return {
        manifest: {
          workspaceId: "workspace-id",
        },
      };
    },
    canonicalExistingPath: async (filePath, kind) => {
      calls.canonicalPaths.push([filePath, kind]);
      return `canonical:${filePath}`;
    },
    createResearchSource: async (rootPath, source) => {
      calls.creates.push([rootPath, source]);
      return { ...source, id: "created" };
    },
    updateResearchSource: async (rootPath, sourceId, patch) => {
      calls.updates.push([rootPath, sourceId, patch]);
      return { id: sourceId, ...patch };
    },
    deleteResearchSource: async (rootPath, sourceId) => {
      calls.deletes.push([rootPath, sourceId]);
    },
    readResearchSource: async (rootPath, sourceId) => {
      calls.reads.push([rootPath, sourceId]);
      return state.source;
    },
    relinkResearchSource: async (rootPath, sourceId, filePath) => {
      calls.relinks.push([rootPath, sourceId, filePath]);
      return { ...state.source, id: sourceId, filePath };
    },
    resolveSourceFile: async (rootPath, source) => {
      calls.resolved.push([rootPath, source]);
      return { filePath: `${rootPath}\\resolved.pdf` };
    },
    listCitationSources: async (rootPath) => {
      calls.citationLists.push(rootPath);
      return {
        workspaceId: "workspace-id",
        sources: [{ id: "citation-1" }],
        warnings: [],
      };
    },
    upsertCitationSource: async (rootPath, source) => {
      calls.citationUpserts.push([rootPath, source]);
      return { ...source, id: "citation-saved" };
    },
    deleteCitationSource: async (rootPath, sourceId) => {
      calls.citationDeletes.push([rootPath, sourceId]);
      return { ok: true, deleted: true };
    },
  });

  return {
    calls,
    handlers,
    library,
    state,
  };
}

test("registers the complete legacy workspace research and citation surface", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()].sort(), WORKSPACE_RESEARCH_CHANNELS);
});

test("lists research and returns workspace identity only after path authorization", async () => {
  const harness = createHarness();

  assert.deepEqual(
    await harness.handlers.get("research:list")({}, "C:\\Workspace"),
    {
      rootPath: "C:\\Workspace",
      workspaceId: "workspace-id",
      sources: [{ id: "listed" }],
      warnings: [],
    },
  );
  assert.deepEqual(
    await harness.handlers.get("workspace:identity")({}, "C:\\Workspace"),
    {
      workspaceId: "workspace-id",
      workspaceName: "Workspace",
    },
  );
  assert.deepEqual(harness.calls.authorizedDirectories, [
    "C:\\Workspace",
    "C:\\Workspace",
  ]);
  assert.deepEqual(harness.calls.workspaces, [
    "C:\\Workspace",
    "C:\\Workspace",
  ]);
});

test("legacy creation strips renderer file paths and uses the privileged picker", async () => {
  const harness = createHarness();
  const create = harness.handlers.get("research:create");

  assert.deepEqual(
    await create({}, "C:\\Workspace", {
      type: "web",
      title: "Web",
      filePath: "C:\\Renderer\\secret.pdf",
    }),
    {
      canceled: false,
      source: { type: "web", title: "Web", id: "created" },
      workspaceId: "workspace-id",
      sources: [{ id: "listed" }],
      warnings: [],
    },
  );
  assert.deepEqual(harness.calls.creates[0], [
    "C:\\Workspace",
    { type: "web", title: "Web" },
  ]);

  harness.state.dialogResults.push(
    { canceled: true, filePaths: [] },
    { canceled: false, filePaths: ["C:\\Picked\\source.pdf"] },
  );
  assert.deepEqual(
    await create({}, "C:\\Workspace", {
      type: "file",
      storage: "managed",
      filePath: "C:\\Renderer\\secret.pdf",
    }),
    { canceled: true },
  );
  assert.deepEqual(
    await create({}, "C:\\Workspace", {
      type: "file",
      storage: "managed",
      filePath: "C:\\Renderer\\secret.pdf",
    }),
    {
      canceled: false,
      source: {
        type: "file",
        storage: "managed",
        filePath: "canonical:C:\\Picked\\source.pdf",
        id: "created",
      },
      workspaceId: "workspace-id",
      sources: [{ id: "listed" }],
      warnings: [],
    },
  );
  assert.deepEqual(harness.calls.canonicalPaths, [[
    "C:\\Picked\\source.pdf",
    "file",
  ]]);
  assert.equal(
    JSON.stringify(harness.calls.creates).includes("C:\\\\Renderer\\\\secret.pdf"),
    false,
  );
  assert.deepEqual(harness.calls.dialogs[0][1].properties, ["openFile"]);
  assert.equal(harness.calls.dialogs[0][1].defaultPath, "C:\\Documents");
});

test("updates and deletes legacy sources while returning refreshed list payloads", async () => {
  const harness = createHarness();
  const patch = { title: "Updated" };

  assert.deepEqual(
    await harness.handlers.get("research:update")(
      {},
      "C:\\Workspace",
      "source-1",
      patch,
    ),
    {
      source: { id: "source-1", title: "Updated" },
      workspaceId: "workspace-id",
      sources: [{ id: "listed" }],
      warnings: [],
    },
  );
  assert.deepEqual(
    await harness.handlers.get("research:delete")(
      {},
      "C:\\Workspace",
      "source-1",
    ),
    {
      ok: true,
      workspaceId: "workspace-id",
      sources: [{ id: "listed" }],
      warnings: [],
    },
  );
  assert.deepEqual(harness.calls.updates, [[
    "C:\\Workspace",
    "source-1",
    patch,
  ]]);
  assert.deepEqual(harness.calls.deletes, [[
    "C:\\Workspace",
    "source-1",
  ]]);
});

test("relinks only file sources selected by the native picker", async () => {
  const harness = createHarness();
  const relink = harness.handlers.get("research:relink");

  harness.state.source = { id: "web-1", type: "web" };
  await assert.rejects(
    () => relink({}, "C:\\Workspace", "web-1"),
    /只有本地文件资料可以重新定位/,
  );

  harness.state.source = {
    id: "source-1",
    type: "file",
    storage: "linked",
  };
  harness.state.dialogResults.push(
    { canceled: true, filePaths: [] },
    { canceled: false, filePaths: ["C:\\Picked\\new.pdf"] },
  );
  assert.deepEqual(
    await relink({}, "C:\\Workspace", "source-1"),
    { canceled: true },
  );
  assert.deepEqual(
    await relink({}, "C:\\Workspace", "source-1"),
    {
      canceled: false,
      source: {
        id: "source-1",
        type: "file",
        storage: "linked",
        filePath: "canonical:C:\\Picked\\new.pdf",
      },
      workspaceId: "workspace-id",
      sources: [{ id: "listed" }],
      warnings: [],
    },
  );
  assert.deepEqual(harness.calls.relinks, [[
    "C:\\Workspace",
    "source-1",
    "canonical:C:\\Picked\\new.pdf",
  ]]);
  assert.equal(harness.calls.dialogs.at(-1)[1].defaultPath, "C:\\Workspace");
});

test("reads only bounded resolved file sources", async () => {
  const harness = createHarness();
  const read = harness.handlers.get("research:read-file");

  assert.deepEqual(
    await read({}, "C:\\Workspace", "source-1"),
    {
      source: harness.state.source,
      bytes: Buffer.from("research bytes"),
      size: 14,
    },
  );
  assert.equal(harness.calls.statPath, "C:\\Workspace\\resolved.pdf");
  assert.equal(harness.calls.readFilePath, "C:\\Workspace\\resolved.pdf");

  harness.state.source = { id: "web-1", type: "web" };
  await assert.rejects(
    () => read({}, "C:\\Workspace", "web-1"),
    /该资料不是本地文件/,
  );

  harness.state.source = { id: "large", type: "file" };
  harness.state.fileSize = 2048;
  await assert.rejects(
    () => read({}, "C:\\Workspace", "large"),
    /研究资料过大/,
  );
});

test("external opening preserves independent capability and legacy web/file shapes", async () => {
  const harness = createHarness();
  const open = harness.handlers.get("research:open-external");

  assert.deepEqual(
    await open({}, { libraryId: "lib", relativePath: "a.pdf" }, "ignored"),
    { ok: true, libraryId: "lib", relativePath: "a.pdf" },
  );
  assert.deepEqual(harness.calls.externalLibrary[0].slice(0, 2), [
    "lib",
    "a.pdf",
  ]);
  assert.equal(typeof harness.calls.externalLibrary[0][2], "function");
  assert.deepEqual(harness.calls.authorizedDirectories, []);

  harness.state.source = {
    id: "web-1",
    type: "web",
    url: "https://example.com/paper",
  };
  assert.deepEqual(
    await open({}, "C:\\Workspace", "web-1"),
    { ok: true },
  );
  assert.deepEqual(harness.calls.openExternal, ["https://example.com/paper"]);

  harness.state.source = { id: "file-1", type: "file" };
  harness.state.openPathError = "system error";
  assert.deepEqual(
    await open({}, "C:\\Workspace", "file-1"),
    { ok: false, error: "system error" },
  );
  assert.deepEqual(harness.calls.openPaths, ["C:\\Workspace\\resolved.pdf"]);

  harness.state.source = { id: "note-1", type: "note" };
  assert.deepEqual(
    await open({}, "C:\\Workspace", "note-1"),
    { ok: false },
  );

  harness.state.source = {
    id: "bad-web",
    type: "web",
    url: "file:///C:/secret.txt",
  };
  await assert.rejects(
    () => open({}, "C:\\Workspace", "bad-web"),
    /资料网址协议不受支持/,
  );
});

test("citation routes authorize the workspace before every list or mutation", async () => {
  const harness = createHarness();
  const citation = { title: "Paper" };

  assert.deepEqual(
    await harness.handlers.get("citation:list")({}, "C:\\Workspace"),
    {
      rootPath: "C:\\Workspace",
      workspaceId: "workspace-id",
      sources: [{ id: "citation-1" }],
      warnings: [],
    },
  );
  assert.deepEqual(
    await harness.handlers.get("citation:upsert")(
      {},
      "C:\\Workspace",
      citation,
    ),
    {
      source: { title: "Paper", id: "citation-saved" },
      rootPath: "C:\\Workspace",
      workspaceId: "workspace-id",
      sources: [{ id: "citation-1" }],
      warnings: [],
    },
  );
  assert.deepEqual(
    await harness.handlers.get("citation:delete")(
      {},
      "C:\\Workspace",
      "citation-1",
    ),
    {
      ok: true,
      deleted: true,
      rootPath: "C:\\Workspace",
      workspaceId: "workspace-id",
      sources: [{ id: "citation-1" }],
      warnings: [],
    },
  );
  assert.deepEqual(harness.calls.citationUpserts, [[
    "C:\\Workspace",
    citation,
  ]]);
  assert.deepEqual(harness.calls.citationDeletes, [[
    "C:\\Workspace",
    "citation-1",
  ]]);
  assert.equal(harness.calls.citationLists.length, 3);
});
