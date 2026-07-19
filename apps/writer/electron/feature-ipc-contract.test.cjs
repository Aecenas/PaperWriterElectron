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

function occurrences(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function loadPreloadApi(source) {
  const invocations = [];
  const listeners = new Map();
  const removed = [];
  let api = null;
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
    exposeInMainWorld(name, value) {
      assert.equal(name, "paperWriter");
      api = value;
    },
  };
  vm.runInNewContext(source, {
    require(moduleName) {
      assert.equal(moduleName, "electron");
      return { contextBridge, ipcRenderer };
    },
  }, { filename: "preload.cjs" });
  assert.ok(api, "preload did not expose paperWriter");
  return { api, invocations, listeners, removed };
}

test("opens documents with a disk revision and forwards the expected revision on save", async () => {
  const main = await sourceOf("main.cjs");
  const openHandler = between(main, 'ipcMain.handle("document:open"', 'ipcMain.handle("document:open-path"');
  const openPathHandler = between(main, 'ipcMain.handle("document:open-path"', 'ipcMain.handle("document:import"');
  const saveHandler = between(main, 'ipcMain.handle("document:save"', "function exportSafeName");

  for (const handler of [openHandler, openPathHandler]) {
    assert.match(handler, /const loaded = await loadPaperDocumentSnapshot\(/);
    assert.match(handler, /const \{ document, diskRevision \} = loaded/);
    assert.match(handler, /return \{[^}]*canceled: false[^}]*document[^}]*diskRevision/s);
  }
  assert.match(saveHandler, /expectedRevision\s*=\s*null/);
  assert.match(saveHandler, /await assertDiskRevision\(filePath, expectedRevision\)/);
  assert.match(saveHandler, /validateTarget:\s*async \(targetPath\)/);
  assert.match(saveHandler, /await assertDiskRevision\(authorizedTarget, expectedRevision\)/);
  assert.match(saveHandler, /return \{[^}]*document: saved\.document[^}]*diskRevision: saved\.diskRevision/s);
  assert.doesNotMatch(saveHandler, /conflictAction\s*!==\s*"overwrite"/);

  const preload = loadPreloadApi(await sourceOf("preload.cjs"));
  const document = { title: "同步稿" };
  const revision = { size: 42, mtimeMs: 1234, sha256: "a".repeat(64) };
  const options = { conflictAction: "compare" };
  await preload.api.saveDocument(document, "C:\\同步\\文章.letterpaper", false, ["C:\\另一篇.letterpaper"], revision, options);
  assert.deepEqual(JSON.parse(JSON.stringify(preload.invocations.at(-1))), [
    "document:save",
    document,
    "C:\\同步\\文章.letterpaper",
    false,
    ["C:\\另一篇.letterpaper"],
    revision,
    options,
  ]);
});

test("revalidates the target before and after packaging and preserves both versions on a replacement race", async () => {
  const main = await sourceOf("main.cjs");
  const writer = between(main, "async function savePaperDocumentWithinMutation", "async function savePaperDocument(filePath");
  const validation = "await validateTarget(targetPath)";
  assert.equal(occurrences(writer, /await validateTarget\(targetPath\)/g), 2);
  const firstValidation = writer.indexOf(validation);
  const packageStart = writer.indexOf("const normalized = normalizeDocument(document)");
  const archivePreflight = writer.indexOf("preflightZipBuffer(output)");
  const secondValidation = writer.lastIndexOf(validation);
  const commit = writer.indexOf("await atomicWriteFile(targetPath, output)");
  assert.ok(firstValidation < packageStart, "first revision check must precede packaging");
  assert.ok(packageStart < archivePreflight && archivePreflight < secondValidation, "second revision check must follow archive generation");
  assert.ok(secondValidation < commit, "the final revision check must immediately guard the atomic replacement");
  assert.match(writer, /const committedRevision = await readDiskRevision\(targetPath\)/);
  assert.match(writer, /const outputSha256 = createHash\("sha256"\)\.update\(output\)\.digest\("hex"\)/);
  assert.match(writer, /committedRevision\.sha256 !== outputSha256/);

  const saveHandler = between(main, 'ipcMain.handle("document:save"', "function exportSafeName");
  assert.match(saveHandler, /targetIdentity\s*=\s*targetStat\?\.isFile\(\)\s*\?\s*\{\s*dev:\s*targetStat\.dev,\s*ino:\s*targetStat\.ino\s*\}/s);
  assert.match(saveHandler, /currentStat\.dev\s*!==\s*targetIdentity\.dev\s*\|\|\s*currentStat\.ino\s*!==\s*targetIdentity\.ino/);
  assert.match(saveHandler, /throw new DocumentRevisionConflictError\("保存期间目标信笺已被移动、删除或替换"/);
  assert.match(saveHandler, /catch \(error\) \{[\s\S]*error\?\.code === REVISION_CONFLICT_CODE[\s\S]*return writeConflictCopy\(error\)/);

  const conflictWriter = between(saveHandler, "const writeConflictCopy = async", "if (!userSelectedTarget");
  assert.match(conflictWriter, /createConflictCopyPath\(filePath/);
  assert.match(conflictWriter, /documentId:\s*randomUUID\(\)/);
  assert.match(conflictWriter, /derivedFrom:\s*normalizeDocumentId/);
  assert.match(conflictWriter, /await savePaperDocument\(conflictCopyPath, conflictDocument\)/);
  assert.match(conflictWriter, /conflict:\s*true/);
  assert.match(conflictWriter, /conflictCopyPath/);
  assert.match(conflictWriter, /expectedRevision:/);
  assert.match(conflictWriter, /actualRevision:/);
});

test("AI apply resolver serializes only the manifest and selected optimization block allowlists", async () => {
  const main = await sourceOf("main.cjs");
  const functionSource = between(main, "function aiApplyResolverMessages", "async function resolveAiApplyWithModel");
  const createMessages = vm.runInNewContext(
    `const AI_INPUT_MAX_CHARS = 500000; ${functionSource}; aiApplyResolverMessages`,
    {},
    { filename: "ai-apply-resolver-extract.cjs" },
  );
  const messages = createMessages({
    documentFingerprint: "fingerprint-1",
    workspacePath: "C:\\绝密工作区",
    documentPath: "C:\\绝密工作区\\稿件.letterpaper",
    research: [{ notes: "不应发送的研究摘录" }],
    otherDocuments: [{ body: "不应发送的其他文档" }],
    blocks: [{
      id: "block-1",
      index: 0,
      type: "paragraph",
      text: "当前信笺正文",
      protected: false,
      filePath: "C:\\绝密工作区\\稿件.letterpaper",
      research: "不应发送的块资料",
    }],
  }, {
    type: "paragraph",
    text: "选中的优化结果",
    caption: "说明",
    sourcePath: "C:\\绝密工作区\\资料.pdf",
    research: "不应发送的选中块资料",
    items: [{ text: "条目", sourceId: "secret-source" }],
  }, {
    selectedIndex: 3,
    totalBlocks: 8,
    previousBlocks: [{ type: "heading", text: "相邻标题", sourcePath: "C:\\绝密工作区\\标题.md" }],
    nextBlocks: [{ type: "paragraph", text: "相邻正文", research: "不应发送的相邻资料" }],
  });

  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /只能决定.*落点.*绝不能改写优化块内容/);
  const sent = JSON.parse(messages[1].content);
  assert.deepEqual(Object.keys(sent).sort(), ["manifest", "optimizationContext", "selectedOptimizationBlock"]);
  assert.deepEqual(Object.keys(sent.manifest).sort(), ["blocks", "documentFingerprint", "version"]);
  assert.deepEqual(Object.keys(sent.manifest.blocks[0]).sort(), ["id", "index", "protected", "text", "type"]);
  assert.deepEqual(Object.keys(sent.selectedOptimizationBlock).sort(), ["caption", "headers", "items", "rows", "text", "type"]);
  assert.deepEqual(Object.keys(sent.selectedOptimizationBlock.items[0]), ["text"]);
  assert.deepEqual(Object.keys(sent.optimizationContext).sort(), ["nextBlocks", "previousBlocks", "selectedIndex", "totalBlocks"]);
  assert.equal(sent.optimizationContext.previousBlocks[0].text, "相邻标题");
  assert.equal(sent.optimizationContext.nextBlocks[0].text, "相邻正文");
  assert.doesNotMatch(messages[1].content, /绝密工作区|研究摘录|其他文档|块资料|相邻资料|secret-source/);

  const repairMessages = createMessages(
    { documentFingerprint: "fingerprint-1", blocks: [] },
    { type: "paragraph", text: "优化结果" },
    {},
    { code: "invalid_anchor", message: "anchorBlockId 非法", previousRaw: "{bad}", secret: "绝密工作区" },
  );
  assert.equal(repairMessages.length, 4);
  assert.equal(repairMessages[2].content, "{bad}");
  assert.match(repairMessages[3].content, /invalid_anchor/);
  assert.match(repairMessages[3].content, /不要重新判断或改写优化内容/);
  assert.doesNotMatch(repairMessages[3].content, /绝密工作区/);

  const handler = between(main, 'ipcMain.handle("ai:resolve-apply"', 'ipcMain.handle("ai:cancel"');
  assert.match(handler, /payload\.optimizationContext/);
  assert.match(handler, /payload\.repair/);
  assert.match(handler, /transport === "codex-cli"\s*\? \{\}/);
  assert.match(handler, /aiApplyResolverRequestParams/);
  assert.match(handler, /resolveAiApplyWithModel\(resolver, messages\)/);
  assert.doesNotMatch(handler, /workspacePath|documentPath|research|filePath|JSON\.stringify\(payload\)/);
});

test("main and preload expose fullscreen, workspace watch, research relink, and identity IPC contracts", async () => {
  const main = await sourceOf("main.cjs");
  const mainChannels = [
    "workspace:watch",
    "document:revision",
    "document:regenerate-identity",
    "window:set-fullscreen",
    "window:get-fullscreen",
    "research:list",
    "research:create",
    "research:update",
    "research:delete",
    "research:relink",
    "research:read-file",
    "research:open-external",
  ];
  for (const channel of mainChannels) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\("${channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), `missing main handler ${channel}`);
  }
  assert.match(main, /mainWindow\.on\("enter-full-screen"[\s\S]*"window:fullscreen-changed"[\s\S]*fullscreen:\s*true/);
  assert.match(main, /mainWindow\.on\("leave-full-screen"[\s\S]*"window:fullscreen-changed"[\s\S]*fullscreen:\s*false/);
  assert.match(main, /sendRendererEvent\(mainWindow\?\.webContents, "workspace:changed"/);
  assert.match(main, /sendRendererEvent\(mainWindow\?\.webContents, "workspace:watch-error"/);

  const identityHandler = between(main, 'ipcMain.handle("document:regenerate-identity"', 'ipcMain.handle("window:set-fullscreen"');
  assert.match(identityHandler, /resolveAuthorizedOpenDocument\(filePath\)/);
  assert.match(identityHandler, /sourceSnapshot = await loadPaperDocumentSnapshot\(targetPath\)/);
  assert.match(identityHandler, /expectedRevision = sourceSnapshot\.diskRevision/);
  assert.match(identityHandler, /documentId = randomUUID\(\)/);
  assert.match(identityHandler, /derivedFrom:\s*previousId \|\| ""/);
  assert.match(identityHandler, /assertDiskRevision\(candidate, expectedRevision\)/);

  const relinkHandler = between(main, 'ipcMain.handle("research:relink"', 'ipcMain.handle("research:read-file"');
  assert.match(relinkHandler, /assertAuthorizedDirectory\(workspacePath\)/);
  assert.match(relinkHandler, /canonicalExistingPath\(picked\.filePaths\[0\], "file"\)/);
  assert.match(relinkHandler, /relinkResearchSource\(rootPath, sourceId, filePath\)/);

  const preload = loadPreloadApi(await sourceOf("preload.cjs"));
  const cases = [
    ["resolveAiApply", [{ manifest: {}, selectedBlock: {} }], ["ai:resolve-apply", { manifest: {}, selectedBlock: {} }]],
    ["watchWorkspace", ["C:\\工作区"], ["workspace:watch", "C:\\工作区"]],
    ["getDocumentRevision", ["C:\\工作区\\稿件.letterpaper"], ["document:revision", "C:\\工作区\\稿件.letterpaper"]],
    ["regenerateDocumentIdentity", ["C:\\工作区\\稿件.letterpaper", true], ["document:regenerate-identity", "C:\\工作区\\稿件.letterpaper", true]],
    ["listResearch", ["C:\\工作区"], ["research:list", "C:\\工作区"]],
    ["createResearch", ["C:\\工作区", { type: "note" }], ["research:create", "C:\\工作区", { type: "note" }]],
    ["updateResearch", ["C:\\工作区", "source-1", { title: "新标题" }], ["research:update", "C:\\工作区", "source-1", { title: "新标题" }]],
    ["deleteResearch", ["C:\\工作区", "source-1"], ["research:delete", "C:\\工作区", "source-1"]],
    ["relinkResearch", ["C:\\工作区", "source-1"], ["research:relink", "C:\\工作区", "source-1"]],
    ["readResearchFile", ["C:\\工作区", "source-1"], ["research:read-file", "C:\\工作区", "source-1"]],
    ["openResearchExternal", ["C:\\工作区", "source-1"], ["research:open-external", "C:\\工作区", "source-1"]],
    ["setFullscreen", [1], ["window:set-fullscreen", true]],
    ["getFullscreen", [], ["window:get-fullscreen"]],
  ];
  for (const [method, args, expected] of cases) {
    const before = preload.invocations.length;
    await preload.api[method](...args);
    assert.equal(preload.invocations.length, before + 1, `${method} must invoke exactly one IPC channel`);
    assert.deepEqual(JSON.parse(JSON.stringify(preload.invocations.at(-1))), expected);
  }

  for (const [method, channel, sample] of [
    ["onWorkspaceChanged", "workspace:changed", { relativePath: "稿件.letterpaper" }],
    ["onWorkspaceWatchError", "workspace:watch-error", { message: "watch failed" }],
    ["onFullscreenChanged", "window:fullscreen-changed", { fullscreen: true }],
  ]) {
    let received = null;
    const unsubscribe = preload.api[method]((payload) => { received = payload; });
    const listener = preload.listeners.get(channel);
    assert.equal(typeof listener, "function", `${method} must subscribe to ${channel}`);
    listener({}, sample);
    assert.deepEqual(received, sample);
    unsubscribe();
    assert.equal(preload.listeners.has(channel), false, `${method} unsubscribe must remove ${channel}`);
    assert.equal(preload.removed.at(-1)[0], channel);
  }
});

test("legacy research creation cannot accept a renderer-provided absolute file path", async () => {
  const main = await sourceOf("main.cjs");
  const createHandler = between(main, 'ipcMain.handle("research:create"', 'ipcMain.handle("research:update"');
  assert.match(createHandler, /delete nextSource\.filePath/);
  assert.match(createHandler, /if \(nextSource\.type === "file"\) \{[\s\S]*dialog\.showOpenDialog/);
  assert.doesNotMatch(createHandler, /nextSource\.type === "file" && !nextSource\.filePath/);

  const preload = loadPreloadApi(await sourceOf("preload.cjs"));
  await preload.api.createResearch("C:\\工作区", {
    type: "file",
    storage: "managed",
    title: "资料",
    filePath: "C:\\任意位置\\secret.pdf",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(preload.invocations.at(-1))), [
    "research:create",
    "C:\\工作区",
    { type: "file", storage: "managed", title: "资料" },
  ]);
});

test("image references use a validated rich clipboard IPC contract", async () => {
  const main = await sourceOf("main.cjs");
  const handler = between(main, 'ipcMain.handle("clipboard:write-image-reference"', 'ipcMain.handle("external:open"');
  assert.match(handler, /safeClipboardUuid\(payload\?\.documentId\)/);
  assert.match(handler, /safeClipboardUuid\(payload\?\.imageId\)/);
  assert.match(handler, /Math\.max\(1, Math\.min\(5_000/);
  assert.match(handler, /clipboard\.write\(\{ text: label, html \}\)/);
  assert.match(handler, /data-source-document-id/);

  const preload = loadPreloadApi(await sourceOf("preload.cjs"));
  const payload = {
    documentId: "33333333-3333-4333-8333-333333333333",
    imageId: "11111111-1111-4111-8111-111111111111",
    number: 2,
  };
  await preload.api.copyImageReference(payload);
  assert.deepEqual(JSON.parse(JSON.stringify(preload.invocations.at(-1))), ["clipboard:write-image-reference", payload]);
});

test("AI rich text copy uses the bounded native clipboard IPC contract", async () => {
  const main = await sourceOf("main.cjs");
  const handler = between(main, 'ipcMain.handle("clipboard:write-content"', 'ipcMain.handle("clipboard:write-image-reference"');
  assert.match(handler, /safeClipboardContent\(payload\?\.text, 2_000_000\)/);
  assert.match(handler, /safeClipboardContent\(payload\?\.html, 4_000_000\)/);
  assert.match(handler, /clipboard\.write\(html \? \{ text, html \} : \{ text \}\)/);

  const preload = loadPreloadApi(await sourceOf("preload.cjs"));
  const payload = { text: "优化结果", html: "<p>优化结果</p>" };
  await preload.api.writeClipboardContent(payload);
  assert.deepEqual(JSON.parse(JSON.stringify(preload.invocations.at(-1))), ["clipboard:write-content", payload]);
});
