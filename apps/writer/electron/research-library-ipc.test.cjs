const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

async function sourceOf(fileName) {
  return fs.readFile(path.join(__dirname, fileName), "utf8");
}

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return source.slice(start, end);
}

function loadPreloadApi(source) {
  const invocations = [];
  const listeners = new Map();
  const removed = [];
  let api;
  const ipcRenderer = {
    invoke(...args) {
      invocations.push(args);
      return Promise.resolve({ ok: true });
    },
    on(channel, listener) {
      listeners.set(channel, listener);
    },
    removeListener(channel, listener) {
      removed.push([channel, listener]);
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
  vm.runInNewContext(source, {
    require(moduleName) {
      assert.equal(moduleName, "electron");
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, "paperWriter");
            api = value;
          },
        },
        ipcRenderer,
      };
    },
  }, { filename: "preload.cjs" });
  return { api, invocations, listeners, removed };
}

test("main registers every independent research-library IPC while retaining legacy research handlers", async () => {
  const main = await sourceOf("main.cjs");
  for (const channel of [
    "research:root-get",
    "research:root-pick",
    "research:root-clear",
    "research:folder-list",
    "research:folder-create",
    "research:file-import",
    "research:entry-rename",
    "research:entry-move",
    "research:entry-trash",
    "research:entry-show",
    "research:entry-copy-path",
    "research:source-list",
    "research:source-upsert",
    "research:source-delete",
    "research:web-tree-list",
    "research:web-folder-create",
    "research:web-folder-update",
    "research:web-folder-delete",
    "research:web-source-move",
    "research:web-selection-copy",
    "research:web-source-upsert",
    "research:legacy-import",
    "research:pdf-read",
    "research:preview-read",
    "research:document-open",
    "research:watch",
  ]) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\("${channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `missing ${channel}`);
  }
  for (const legacyChannel of [
    "research:list", "research:create", "research:update", "research:delete",
    "research:relink", "research:read-file", "research:open-external",
    "workspace:identity",
  ]) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\("${legacyChannel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `missing legacy ${legacyChannel}`);
  }
  assert.match(main, /createResearchLibraryManager\(\{ userDataPath: app\.getPath\("userData"\) \}\)/);
  assert.match(main, /researchLibrary\?\.closeWatcher\(\)/);
  assert.match(main, /"research:changed"/);
  assert.match(main, /"research:watch-error"/);
  const sourceMutations = between(main, "async function runResearchSourceMutation", 'ipcMain.handle("research:pdf-read"');
  assert.match(sourceMutations, /error\?\.code !== REVISION_CONFLICT_CODE/);
  assert.match(sourceMutations, /conflict:\s*true/);
  assert.match(sourceMutations, /expectedRevision:\s*error\?\.expectedRevision/);
  assert.match(sourceMutations, /actualRevision:\s*error\?\.actualRevision/);
});

test("privileged import picks source files in main and never accepts renderer absolute source paths", async () => {
  const main = await sourceOf("main.cjs");
  const handler = between(main, 'ipcMain.handle("research:file-import"', 'ipcMain.handle("research:entry-rename"');
  assert.match(handler, /library\.listFolder\(payload\.libraryId, payload\.targetRelativePath/);
  assert.match(handler, /dialog\.showOpenDialog\(mainWindow/);
  assert.match(handler, /properties:\s*\["openFile", "multiSelections"\]/);
  assert.match(handler, /library\.importFiles\(payload\.libraryId, payload\.targetRelativePath \|\| "", picked\.filePaths\)/);
  assert.doesNotMatch(handler, /payload\.(?:filePath|filePaths|sourcePath|sourcePaths)/);
});

test("the shared external-open channel distinguishes new capability payloads from legacy workspace calls", async () => {
  const main = await sourceOf("main.cjs");
  const handler = between(main, 'ipcMain.handle("research:open-external"', 'ipcMain.handle("citation:list"');
  assert.match(handler, /typeof workspacePath === "object"/);
  assert.match(handler, /openEntryExternal\([\s\S]*workspacePath\.libraryId[\s\S]*workspacePath\.relativePath/);
  assert.match(handler, /assertAuthorizedDirectory\(workspacePath\)/);
  assert.match(handler, /resolveSourceFile\(rootPath, source\)/);
});

test("legacy import accepts only an authorized workspace capability and resolves every source file in main", async () => {
  const main = await sourceOf("main.cjs");
  const handler = between(main, 'ipcMain.handle("research:legacy-import"', 'ipcMain.handle("research:pdf-read"');
  assert.match(handler, /assertAuthorizedDirectory\(payload\.workspacePath\)/);
  assert.match(handler, /activeWorkspaceWatchRoot/);
  assert.match(handler, /只能从左侧文件区当前打开的写作工作区导入旧资料库/);
  assert.match(handler, /library\.listSources\(payload\.libraryId\)/);
  assert.match(handler, /listResearchSources\(workspacePath\)/);
  assert.match(handler, /resolveFile:\s*\(source\) => resolveSourceFile\(workspacePath, source\)/);
  assert.match(handler, /importLegacyResearch\(/);
  assert.doesNotMatch(handler, /payload\.(?:filePath|filePaths|sourcePath|sourcePaths)/);
  assert.ok(handler.indexOf("library.listSources(payload.libraryId)") < handler.indexOf("listResearchSources(workspacePath)"));
});

test("preview and document opening resolve only independent-library capabilities", async () => {
  const main = await sourceOf("main.cjs");
  const preview = between(main, 'ipcMain.handle("research:preview-read"', 'ipcMain.handle("research:document-open"');
  assert.match(preview, /readPreview\(payload\.libraryId, payload\.relativePath\)/);
  assert.match(preview, /decodeResearchPreviewText/);
  assert.match(preview, /sanitizeImportedHtml/);
  assert.doesNotMatch(preview, /payload\.(?:path|filePath|absolutePath)/);
  const document = between(main, 'ipcMain.handle("research:document-open"', 'ipcMain.handle("research:watch"');
  assert.match(document, /copyEntryPath\(payload\.libraryId, payload\.relativePath\)/);
  assert.match(document, /isSupportedDocument\(resolved\.path\)/);
  assert.match(document, /authorizeDocumentPath\(resolved\.path\)/);
  assert.match(document, /loadPaperDocumentSnapshot\(filePath/);
  assert.doesNotMatch(document, /payload\.(?:path|filePath|absolutePath)/);
});

test("public web copying is bound to the currently open workspace identity", async () => {
  const main = await sourceOf("main.cjs");
  const handler = between(main, 'ipcMain.handle("research:web-selection-copy"', 'ipcMain.handle("research:web-source-upsert"');
  assert.match(handler, /activeWorkspaceWatchRoot/);
  assert.match(handler, /ensureWorkspace\(activeWorkspaceWatchRoot\)/);
  assert.match(handler, /normalizeWebScopeKey\(selection\.targetScopeKey\)/);
  assert.match(handler, /workspace\.manifest\.workspaceId/);
  assert.doesNotMatch(handler, /payload\.(?:workspacePath|rootPath)/);
});

test("preload forwards exact library capabilities and revisions", async () => {
  const preload = loadPreloadApi(await sourceOf("preload.cjs"));
  const revision = { size: 12, mtimeMs: 34, sha256: "a".repeat(64) };
  const source = { id: "123", type: "note", title: "摘录" };
  const cases = [
    ["getResearchRoot", [], ["research:root-get"]],
    ["pickResearchRoot", [], ["research:root-pick"]],
    ["clearResearchRoot", [], ["research:root-clear"]],
    ["listResearchFolder", ["library", "论文"], ["research:folder-list", { libraryId: "library", relativePath: "论文" }]],
    ["createResearchFolder", ["library", "论文", "2026"], ["research:folder-create", { libraryId: "library", parentRelativePath: "论文", name: "2026" }]],
    ["importResearchFiles", ["library", "论文"], ["research:file-import", { libraryId: "library", targetRelativePath: "论文" }]],
    ["renameResearchEntry", ["library", "a.pdf", "b.pdf"], ["research:entry-rename", { libraryId: "library", relativePath: "a.pdf", nextName: "b.pdf" }]],
    ["moveResearchEntry", ["library", "a.pdf", "归档"], ["research:entry-move", { libraryId: "library", relativePath: "a.pdf", targetFolderRelativePath: "归档" }]],
    ["trashResearchEntry", ["library", "a.pdf"], ["research:entry-trash", { libraryId: "library", relativePath: "a.pdf" }]],
    ["showResearchEntry", ["library", "a.pdf"], ["research:entry-show", { libraryId: "library", relativePath: "a.pdf" }]],
    ["copyResearchEntryPath", ["library", "a.pdf"], ["research:entry-copy-path", { libraryId: "library", relativePath: "a.pdf" }]],
    ["listResearchLibrarySources", ["library"], ["research:source-list", { libraryId: "library" }]],
    ["listResearchWebTree", ["library"], ["research:web-tree-list", { libraryId: "library" }]],
    ["createResearchWebFolder", ["library", { name: "组", scopeKey: "global" }, revision], ["research:web-folder-create", { libraryId: "library", folder: { name: "组", scopeKey: "global" }, expectedRevision: revision }]],
    ["updateResearchWebFolder", ["library", { id: "folder", name: "新组" }, revision], ["research:web-folder-update", { libraryId: "library", folder: { id: "folder", name: "新组" }, expectedRevision: revision }]],
    ["deleteResearchWebFolder", ["library", "folder", revision], ["research:web-folder-delete", { libraryId: "library", folderId: "folder", expectedRevision: revision }]],
    ["moveResearchWebSource", ["library", "source", { scopeKey: "global", folderId: "folder" }, revision], ["research:web-source-move", { libraryId: "library", sourceId: "source", placement: { scopeKey: "global", folderId: "folder" }, expectedRevision: revision }]],
    ["copyResearchWebSelection", ["library", { folderIds: ["folder"], sourceIds: ["source"], targetScopeKey: "workspace:1", expectedTreeRevision: revision }], ["research:web-selection-copy", { libraryId: "library", selection: { folderIds: ["folder"], sourceIds: ["source"], targetScopeKey: "workspace:1", expectedTreeRevision: revision } }]],
    ["upsertResearchWebSource", ["library", source, { scopeKey: "global", folderId: "" }, { source: revision, tree: revision }], ["research:web-source-upsert", { libraryId: "library", source, placement: { scopeKey: "global", folderId: "" }, revisions: { source: revision, tree: revision } }]],
    ["upsertResearchLibrarySource", ["library", source, revision], ["research:source-upsert", { libraryId: "library", source, expectedRevision: revision }]],
    ["deleteResearchLibrarySource", ["library", "source", revision], ["research:source-delete", { libraryId: "library", sourceId: "source", expectedRevision: revision }]],
    ["importLegacyResearch", ["C:\\写作区", "library"], ["research:legacy-import", { workspacePath: "C:\\写作区", libraryId: "library" }]],
    ["readResearchPdf", ["library", "a.pdf"], ["research:pdf-read", { libraryId: "library", relativePath: "a.pdf" }]],
    ["readResearchPreview", ["library", "a.md"], ["research:preview-read", { libraryId: "library", relativePath: "a.md" }]],
    ["openResearchDocument", ["library", "a.letterpaper"], ["research:document-open", { libraryId: "library", relativePath: "a.letterpaper" }]],
    ["openResearchEntryExternal", ["library", "a.pdf"], ["research:open-external", { libraryId: "library", relativePath: "a.pdf" }]],
    ["watchResearchLibrary", ["library"], ["research:watch", { libraryId: "library" }]],
    ["getWorkspaceIdentity", ["C:\\写作区"], ["workspace:identity", "C:\\写作区"]],
  ];
  for (const [method, args, expected] of cases) {
    const before = preload.invocations.length;
    await preload.api[method](...args);
    assert.equal(preload.invocations.length, before + 1, `${method} should invoke once`);
    assert.deepEqual(JSON.parse(JSON.stringify(preload.invocations.at(-1))), expected);
  }
});

test("preload research watcher subscriptions are removable", async () => {
  const preload = loadPreloadApi(await sourceOf("preload.cjs"));
  for (const [method, channel, sample] of [
    ["onResearchLibraryChanged", "research:changed", { libraryId: "l", relativePath: "a.pdf" }],
    ["onResearchLibraryWatchError", "research:watch-error", { libraryId: "l", message: "failed" }],
  ]) {
    let received;
    const unsubscribe = preload.api[method]((payload) => { received = payload; });
    preload.listeners.get(channel)({}, sample);
    assert.deepEqual(received, sample);
    unsubscribe();
    assert.equal(preload.listeners.has(channel), false);
    assert.equal(preload.removed.at(-1)[0], channel);
  }
});
