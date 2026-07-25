const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { checkPreloadBundle, collectPreloadModules } = require("./build-preload.cjs");

const EXPECTED_API_KEYS = [
  "backupDocument",
  "cancelAi",
  "cancelFolderSearch",
  "checkForUpdates",
  "clearAutosave",
  "clearResearchRoot",
  "closeCanceled",
  "closeReady",
  "confirmClose",
  "controlResearchWebView",
  "copyFolderPath",
  "copyImageReference",
  "copyResearchEntryPath",
  "copyResearchWebSelection",
  "createAiProvider",
  "createDocumentInFolder",
  "createFolder",
  "createResearch",
  "createResearchFolder",
  "createResearchWebFolder",
  "debugLog",
  "deleteAiProvider",
  "deleteCitation",
  "deleteEntry",
  "deleteResearch",
  "deleteResearchLibrarySource",
  "deleteResearchWebFolder",
  "deleteTempDocument",
  "destroyResearchWebView",
  "downloadUpdate",
  "exportAiChat",
  "exportEditable",
  "exportPageImages",
  "exportPdf",
  "generateAi",
  "getAiConfig",
  "getDocumentRevision",
  "getFullscreen",
  "getPaths",
  "getResearchRoot",
  "getUpdateState",
  "getWorkspaceIdentity",
  "getWorkspaceRelationships",
  "hideResearchWebView",
  "importDocument",
  "importLegacyResearch",
  "importResearchFiles",
  "installUpdate",
  "isElectron",
  "listCitations",
  "listFolder",
  "listResearch",
  "listResearchFolder",
  "listResearchLibrarySources",
  "listResearchWebTree",
  "loadAutosave",
  "moveEntry",
  "moveResearchEntry",
  "moveResearchWebSource",
  "onAiChunk",
  "onAiDone",
  "onAiError",
  "onCloseRequest",
  "onCodexCliStatus",
  "onExportProgress",
  "onFullscreenChanged",
  "onResearchLibraryChanged",
  "onResearchLibraryWatchError",
  "onResearchWebViewState",
  "onUpdateState",
  "onWindowBlur",
  "onWindowFocus",
  "onWorkspaceChanged",
  "onWorkspaceWatchError",
  "openDocument",
  "openDocumentPath",
  "openExternal",
  "openFolder",
  "openResearchDocument",
  "openResearchEntryExternal",
  "openResearchExternal",
  "pickAudio",
  "pickExportPath",
  "pickImage",
  "pickResearchRoot",
  "pickVideo",
  "readResearchFile",
  "readResearchPdf",
  "readResearchPreview",
  "refreshCodexCliStatus",
  "regenerateDocumentIdentity",
  "relinkResearch",
  "renameEntry",
  "renameResearchEntry",
  "resolveAiApply",
  "saveAiConfig",
  "saveAutosave",
  "saveDocument",
  "saveTempDocument",
  "searchFolder",
  "setFullscreen",
  "setWindowModalOverlay",
  "showFolder",
  "showResearchEntry",
  "showResearchWebView",
  "startCodexCliLogin",
  "testAiConfig",
  "trashResearchEntry",
  "updateResearch",
  "updateResearchWebFolder",
  "updateResearchWebViewBounds",
  "upsertCitation",
  "upsertResearchLibrarySource",
  "upsertResearchWebSource",
  "watchResearchLibrary",
  "watchWorkspace",
  "writeClipboardContent",
];

const documentValue = { title: "契约稿", html: "<p>正文</p>" };
const revision = { size: 42, mtimeMs: 1234, sha256: "a".repeat(64) };
const sourceValue = { id: "source-1", title: "资料", filePath: "C:\\private\\source.pdf" };
const placement = { scopeKey: "global", folderId: "folder-1" };
const payload = { value: 1 };

const INVOKE_CONTRACTS = [
  ["getPaths", [], ["app:get-paths"]],
  ["debugLog", ["event", payload], ["debug:log", "event", payload]],
  ["setWindowModalOverlay", [1], ["window:set-modal-overlay", true]],
  ["getAiConfig", [], ["ai:get-config"]],
  ["refreshCodexCliStatus", [], ["ai:refresh-codex"]],
  ["startCodexCliLogin", [], ["ai:start-codex-login"]],
  ["createAiProvider", [payload], ["ai:create-provider", payload]],
  ["deleteAiProvider", ["provider-1"], ["ai:delete-provider", "provider-1"]],
  ["saveAiConfig", [payload], ["ai:save-config", payload]],
  ["testAiConfig", [payload], ["ai:test-config", payload]],
  ["generateAi", [payload], ["ai:generate", payload]],
  ["resolveAiApply", [payload], ["ai:resolve-apply", payload]],
  ["cancelAi", ["request-1"], ["ai:cancel", "request-1"]],
  ["exportAiChat", [payload], ["ai:export-chat", payload]],
  ["openDocument", [], ["document:open"]],
  ["openDocumentPath", ["C:\\稿件.letterpaper"], ["document:open-path", "C:\\稿件.letterpaper"]],
  ["importDocument", [], ["document:import"]],
  ["exportEditable", [documentValue, "markdown", "C:\\稿件.md"], ["document:export-editable", {
    document: documentValue,
    format: "markdown",
    targetPath: "C:\\稿件.md",
  }]],
  ["openFolder", [], ["folder:open"]],
  ["listFolder", ["C:\\工作区"], ["folder:list", "C:\\工作区"]],
  ["searchFolder", [payload], ["folder:search", payload]],
  ["cancelFolderSearch", ["C:\\工作区", "search-1"], ["folder:search-cancel", "C:\\工作区", "search-1"]],
  ["getWorkspaceRelationships", [payload], ["workspace:relationships", payload]],
  ["watchWorkspace", ["C:\\工作区"], ["workspace:watch", "C:\\工作区"]],
  ["getDocumentRevision", ["C:\\稿件.letterpaper"], ["document:revision", "C:\\稿件.letterpaper"]],
  ["regenerateDocumentIdentity", ["C:\\稿件.letterpaper", 1], ["document:regenerate-identity", "C:\\稿件.letterpaper", true]],
  ["copyFolderPath", ["C:\\工作区"], ["folder:copy-path", "C:\\工作区"]],
  ["showFolder", ["C:\\工作区"], ["folder:show", "C:\\工作区"]],
  ["createFolder", ["C:\\工作区", "新目录"], ["folder:create", "C:\\工作区", "新目录"]],
  ["createDocumentInFolder", ["C:\\工作区", "新稿", documentValue], ["document:create-in-folder", "C:\\工作区", "新稿", documentValue]],
  ["renameEntry", ["C:\\旧稿", "新稿"], ["entry:rename", "C:\\旧稿", "新稿"]],
  ["deleteEntry", ["C:\\旧稿"], ["entry:delete", "C:\\旧稿"]],
  ["moveEntry", ["C:\\旧稿", "C:\\归档"], ["entry:move", "C:\\旧稿", "C:\\归档"]],
  ["backupDocument", ["C:\\稿件.letterpaper"], ["document:backup", "C:\\稿件.letterpaper"]],
  ["saveDocument", [documentValue, "C:\\稿件.letterpaper", 1, ["C:\\关联稿.letterpaper"], revision, payload], [
    "document:save",
    documentValue,
    "C:\\稿件.letterpaper",
    true,
    ["C:\\关联稿.letterpaper"],
    revision,
    payload,
  ]],
  ["saveTempDocument", [documentValue, "tab-1"], ["autosave:save-tab", documentValue, "tab-1"]],
  ["deleteTempDocument", ["tab-1"], ["autosave:delete-tab", "tab-1"]],
  ["pickExportPath", ["docx", "契约稿", "C:\\导出"], ["document:pick-export-path", "docx", "契约稿", "C:\\导出"]],
  ["exportPdf", ["契约稿", "C:\\导出\\契约稿.pdf"], ["document:export-pdf", "契约稿", "C:\\导出\\契约稿.pdf"]],
  ["exportPageImages", ["契约稿", [{ x: 1 }], "C:\\分页"], ["document:export-page-images", "契约稿", [{ x: 1 }], "C:\\分页"]],
  ["pickImage", [], ["asset:pick-image"]],
  ["pickAudio", [], ["asset:pick-audio"]],
  ["pickVideo", [], ["asset:pick-video"]],
  ["writeClipboardContent", [payload], ["clipboard:write-content", payload]],
  ["copyImageReference", [payload], ["clipboard:write-image-reference", payload]],
  ["openExternal", ["https://example.com"], ["external:open", "https://example.com"]],
  ["showResearchWebView", [payload], ["research:web-view-show", payload]],
  ["updateResearchWebViewBounds", [payload], ["research:web-view-bounds", payload]],
  ["hideResearchWebView", ["view-1"], ["research:web-view-hide", "view-1"]],
  ["controlResearchWebView", ["view-1", "reload"], ["research:web-view-control", { viewId: "view-1", action: "reload" }]],
  ["destroyResearchWebView", ["view-1"], ["research:web-view-destroy", "view-1"]],
  ["getResearchRoot", [], ["research:root-get"]],
  ["pickResearchRoot", [], ["research:root-pick"]],
  ["clearResearchRoot", [], ["research:root-clear"]],
  ["listResearchFolder", ["library-1", "论文"], ["research:folder-list", { libraryId: "library-1", relativePath: "论文" }]],
  ["createResearchFolder", ["library-1", "论文", "待读"], ["research:folder-create", {
    libraryId: "library-1",
    parentRelativePath: "论文",
    name: "待读",
  }]],
  ["importResearchFiles", ["library-1", "论文"], ["research:file-import", { libraryId: "library-1", targetRelativePath: "论文" }]],
  ["renameResearchEntry", ["library-1", "旧.pdf", "新.pdf"], ["research:entry-rename", {
    libraryId: "library-1",
    relativePath: "旧.pdf",
    nextName: "新.pdf",
  }]],
  ["moveResearchEntry", ["library-1", "旧.pdf", "归档"], ["research:entry-move", {
    libraryId: "library-1",
    relativePath: "旧.pdf",
    targetFolderRelativePath: "归档",
  }]],
  ["trashResearchEntry", ["library-1", "旧.pdf"], ["research:entry-trash", { libraryId: "library-1", relativePath: "旧.pdf" }]],
  ["showResearchEntry", ["library-1", "论文"], ["research:entry-show", { libraryId: "library-1", relativePath: "论文" }]],
  ["copyResearchEntryPath", ["library-1", "论文"], ["research:entry-copy-path", { libraryId: "library-1", relativePath: "论文" }]],
  ["listResearchLibrarySources", ["library-1"], ["research:source-list", { libraryId: "library-1" }]],
  ["listResearchWebTree", ["library-1"], ["research:web-tree-list", { libraryId: "library-1" }]],
  ["upsertResearchWebSource", ["library-1", sourceValue, placement, { source: revision }], ["research:web-source-upsert", {
    libraryId: "library-1",
    source: sourceValue,
    placement,
    revisions: { source: revision },
  }]],
  ["createResearchWebFolder", ["library-1", payload, revision], ["research:web-folder-create", {
    libraryId: "library-1",
    folder: payload,
    expectedRevision: revision,
  }]],
  ["updateResearchWebFolder", ["library-1", payload, revision], ["research:web-folder-update", {
    libraryId: "library-1",
    folder: payload,
    expectedRevision: revision,
  }]],
  ["deleteResearchWebFolder", ["library-1", "folder-1", revision], ["research:web-folder-delete", {
    libraryId: "library-1",
    folderId: "folder-1",
    expectedRevision: revision,
  }]],
  ["moveResearchWebSource", ["library-1", "source-1", placement, revision], ["research:web-source-move", {
    libraryId: "library-1",
    sourceId: "source-1",
    placement,
    expectedRevision: revision,
  }]],
  ["copyResearchWebSelection", ["library-1", payload], ["research:web-selection-copy", {
    libraryId: "library-1",
    selection: payload,
  }]],
  ["upsertResearchLibrarySource", ["library-1", sourceValue, revision], ["research:source-upsert", {
    libraryId: "library-1",
    source: sourceValue,
    expectedRevision: revision,
  }]],
  ["deleteResearchLibrarySource", ["library-1", "source-1", revision], ["research:source-delete", {
    libraryId: "library-1",
    sourceId: "source-1",
    expectedRevision: revision,
  }]],
  ["importLegacyResearch", ["C:\\工作区", "library-1"], ["research:legacy-import", {
    workspacePath: "C:\\工作区",
    libraryId: "library-1",
  }]],
  ["readResearchPdf", ["library-1", "论文.pdf"], ["research:pdf-read", { libraryId: "library-1", relativePath: "论文.pdf" }]],
  ["readResearchPreview", ["library-1", "论文.docx"], ["research:preview-read", { libraryId: "library-1", relativePath: "论文.docx" }]],
  ["openResearchDocument", ["library-1", "论文.docx"], ["research:document-open", { libraryId: "library-1", relativePath: "论文.docx" }]],
  ["openResearchEntryExternal", ["library-1", "论文.pdf"], ["research:open-external", { libraryId: "library-1", relativePath: "论文.pdf" }]],
  ["watchResearchLibrary", ["library-1"], ["research:watch", { libraryId: "library-1" }]],
  ["listResearch", ["C:\\工作区"], ["research:list", "C:\\工作区"]],
  ["createResearch", ["C:\\工作区", sourceValue], ["research:create", "C:\\工作区", {
    id: "source-1",
    title: "资料",
  }]],
  ["updateResearch", ["C:\\工作区", "source-1", payload], ["research:update", "C:\\工作区", "source-1", payload]],
  ["deleteResearch", ["C:\\工作区", "source-1"], ["research:delete", "C:\\工作区", "source-1"]],
  ["relinkResearch", ["C:\\工作区", "source-1"], ["research:relink", "C:\\工作区", "source-1"]],
  ["readResearchFile", ["C:\\工作区", "source-1"], ["research:read-file", "C:\\工作区", "source-1"]],
  ["openResearchExternal", ["C:\\工作区", "source-1"], ["research:open-external", "C:\\工作区", "source-1"]],
  ["listCitations", ["C:\\工作区"], ["citation:list", "C:\\工作区"]],
  ["getWorkspaceIdentity", ["C:\\工作区"], ["workspace:identity", "C:\\工作区"]],
  ["upsertCitation", ["C:\\工作区", sourceValue], ["citation:upsert", "C:\\工作区", sourceValue]],
  ["deleteCitation", ["C:\\工作区", "source-1"], ["citation:delete", "C:\\工作区", "source-1"]],
  ["setFullscreen", [1], ["window:set-fullscreen", true]],
  ["getFullscreen", [], ["window:get-fullscreen"]],
  ["loadAutosave", [], ["autosave:load"]],
  ["saveAutosave", [documentValue], ["autosave:save", documentValue]],
  ["clearAutosave", [], ["autosave:clear"]],
  ["getUpdateState", [], ["update:get-state"]],
  ["checkForUpdates", [], ["update:check"]],
  ["downloadUpdate", [], ["update:download"]],
  ["installUpdate", [], ["update:install"]],
  ["confirmClose", [payload], ["app:confirm-close", payload]],
  ["closeReady", [payload], ["app:close-ready", payload]],
  ["closeCanceled", [payload], ["app:close-canceled", payload]],
];

const EVENT_CONTRACTS = [
  ["onAiChunk", "ai:chunk", false],
  ["onAiDone", "ai:done", false],
  ["onAiError", "ai:error", false],
  ["onCodexCliStatus", "ai:codex-status", false],
  ["onExportProgress", "document:export-progress", false],
  ["onResearchWebViewState", "research:web-view-state", false],
  ["onUpdateState", "update:state", false],
  ["onCloseRequest", "app:close-request", true],
  ["onWorkspaceChanged", "workspace:changed", true],
  ["onWorkspaceWatchError", "workspace:watch-error", true],
  ["onResearchLibraryChanged", "research:changed", true],
  ["onResearchLibraryWatchError", "research:watch-error", true],
  ["onWindowFocus", "window:focus", true],
  ["onWindowBlur", "window:blur", true],
  ["onFullscreenChanged", "window:fullscreen-changed", true],
];

function normalize(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadPreloadApi() {
  const invocations = [];
  const listeners = new Map();
  const removed = [];
  const exposures = [];
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
  const contextBridge = {
    exposeInMainWorld(name, api) {
      exposures.push([name, api]);
    },
  };
  const preloadPath = path.join(__dirname, "preload.cjs");
  const source = fs.readFileSync(preloadPath, "utf8");
  vm.runInNewContext(source, {
    require(moduleName) {
      if (moduleName === "electron") return { contextBridge, ipcRenderer };
      if (moduleName.startsWith("./")) return require(path.resolve(__dirname, moduleName));
      throw new Error(`Unexpected preload dependency: ${moduleName}`);
    },
  }, { filename: preloadPath });
  assert.equal(exposures.length, 1, "preload must expose exactly one facade");
  assert.equal(exposures[0][0], "paperWriter");
  return {
    api: exposures[0][1],
    invocations,
    listeners,
    removed,
  };
}

test("preload exposes the exact flat paperWriter API once", () => {
  const { api } = loadPreloadApi();
  assert.equal(api.isElectron, true);
  assert.deepEqual(Object.keys(api).sort(), EXPECTED_API_KEYS);
});

test("sandbox preload bundle is current with every domain source included", () => {
  assert.equal(checkPreloadBundle(), path.join(__dirname, "preload.cjs"));
  assert.deepEqual(
    collectPreloadModules().map((filePath) => path.basename(filePath)).sort(),
    [
      "ai-api.cjs",
      "document-api.cjs",
      "facade.cjs",
      "research-api.cjs",
      "subscriptions.cjs",
      "window-update-api.cjs",
      "workspace-api.cjs",
    ],
  );
});

test("every preload command preserves its IPC channel and argument shape", async () => {
  const preload = loadPreloadApi();
  assert.equal(INVOKE_CONTRACTS.length, EXPECTED_API_KEYS.length - EVENT_CONTRACTS.length - 1);
  for (const [method, args, expected] of INVOKE_CONTRACTS) {
    const before = preload.invocations.length;
    await preload.api[method](...args);
    assert.equal(preload.invocations.length, before + 1, `${method} must invoke exactly once`);
    assert.deepEqual(normalize(preload.invocations.at(-1)), expected, method);
  }
});

test("every preload event subscription forwards payloads and removes its exact listener", () => {
  const preload = loadPreloadApi();
  for (const [method, channel, emptyObjectFallback] of EVENT_CONTRACTS) {
    let received = Symbol("not-called");
    const unsubscribe = preload.api[method]((value) => {
      received = value;
    });
    const listener = preload.listeners.get(channel);
    assert.equal(typeof listener, "function", `${method} must register ${channel}`);
    listener({}, null);
    assert.deepEqual(normalize(received), emptyObjectFallback ? {} : null, method);
    unsubscribe();
    assert.equal(preload.listeners.has(channel), false, `${method} must remove ${channel}`);
    assert.equal(preload.removed.at(-1)[0], channel);
    assert.equal(preload.removed.at(-1)[1], listener);
    assert.equal(typeof preload.api[method](null), "function", `${method} invalid callback fallback`);
    assert.equal(preload.listeners.has(channel), false, `${method} must ignore invalid callbacks`);
  }
});
