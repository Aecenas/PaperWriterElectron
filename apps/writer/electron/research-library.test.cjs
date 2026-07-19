const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { EventEmitter } = require("node:events");

const {
  CONFIG_FILE,
  IMAGE_PREVIEW_MAX_BYTES,
  PDF_READ_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  WEB_TREE_FILE,
  classifyEntry,
  createResearchLibraryManager,
  ensureLibrary,
  externalOpenAllowed,
  importLegacyResearch,
  normalizeEntryName,
  normalizeRelativePath,
  normalizeWebScopeKey,
} = require("./research-library.cjs");

async function withLibrary(run, options = {}) {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "jianjian-library-"));
  const userDataPath = path.join(sandbox, "user-data");
  const rootPath = path.join(sandbox, "资料");
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.mkdir(rootPath, { recursive: true });
  const manager = createResearchLibraryManager({ userDataPath, ...options });
  try {
    await run({ sandbox, userDataPath, rootPath, manager });
  } finally {
    manager.closeWatcher();
    await fs.rm(sandbox, { recursive: true, force: true });
  }
}

test("persists only the selected root in userData and reuses the stable library id", async () => withLibrary(async ({ userDataPath, rootPath, manager }) => {
  assert.deepEqual(await manager.initialize(), { configured: false, available: false });
  const selected = await manager.selectRoot(rootPath);
  assert.equal(selected.available, true);
  assert.match(selected.libraryId, /^[0-9a-f-]{36}$/);

  const config = JSON.parse(await fs.readFile(path.join(userDataPath, CONFIG_FILE), "utf8"));
  assert.deepEqual(Object.keys(config).sort(), ["rootPath", "version"]);
  assert.equal(config.rootPath, await fs.realpath(rootPath));
  const manifest = JSON.parse(await fs.readFile(path.join(rootPath, ".jianjian", "research-library", "manifest.json"), "utf8"));
  assert.equal(manifest.libraryId, selected.libraryId);

  const reopened = createResearchLibraryManager({ userDataPath });
  assert.equal((await reopened.initialize()).libraryId, selected.libraryId);
  assert.equal(reopened.getRoot().rootPath, await fs.realpath(rootPath));
}));

test("clearing a root revokes its in-memory library capability", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  assert.deepEqual(await manager.clearRoot(), { configured: false, available: false });
  await assert.rejects(() => manager.listFolder(selected.libraryId, ""), /未授权|失效/);
}));

test("reports a configured but unavailable root without authorizing it", async () => withLibrary(async ({ userDataPath, rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  await fs.rm(rootPath, { recursive: true, force: true });
  const reopened = createResearchLibraryManager({ userDataPath });
  const state = await reopened.initialize();
  assert.equal(state.configured, true);
  assert.equal(state.available, false);
  assert.match(state.error, /ENOENT|不存在|无效/);
  await assert.rejects(() => reopened.listFolder(selected.libraryId, ""), /未授权|失效/);
}));

test("rejects symbolic-link roots and protected library directory links", async (context) => withLibrary(async ({ sandbox, rootPath, manager }) => {
  const outside = path.join(sandbox, "outside");
  const linkedRoot = path.join(sandbox, "linked-root");
  await fs.mkdir(outside);
  try {
    await fs.symlink(outside, linkedRoot, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    context.skip(`当前环境不能创建目录链接：${error.message}`);
    return;
  }
  await assert.rejects(() => manager.selectRoot(linkedRoot), /符号链接|目录联接/);

  await fs.mkdir(path.join(rootPath, ".jianjian"));
  await fs.symlink(outside, path.join(rootPath, ".jianjian", "research-library"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => manager.selectRoot(rootPath), /符号链接|目录联接/);
}));

test("normalizes relative paths and entry names without permitting absolute, traversal, or reserved paths", () => {
  assert.equal(normalizeRelativePath("章节\\资料.pdf"), "章节/资料.pdf");
  for (const value of ["C:\\secret.pdf", "../secret.pdf", "/secret.pdf", "\\\\server\\share", ".jianjian/x"] ) {
    assert.throws(() => normalizeRelativePath(value), /相对路径|越过|保留目录/);
  }
  assert.equal(normalizeEntryName("研究 01"), "研究 01");
  for (const value of [".jianjian", "../x", "CON", "bad?.pdf", "尾随."]) {
    assert.throws(() => normalizeEntryName(value), /保留|名称|字符|系统/);
  }
});

test("lists folders before files, hides .jianjian, skips links, and classifies safe external types", async (context) => withLibrary(async ({ sandbox, rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  await fs.mkdir(path.join(rootPath, "乙目录"));
  await fs.mkdir(path.join(rootPath, "甲目录"));
  await fs.writeFile(path.join(rootPath, "文章.pdf"), "%PDF-test");
  await fs.writeFile(path.join(rootPath, "程序.exe"), "MZ");
  try {
    await fs.symlink(path.join(sandbox, "missing"), path.join(rootPath, "链接"), "file");
  } catch {
    // Link creation is optional on restricted Windows hosts.
  }
  const listed = await manager.listFolder(selected.libraryId, "");
  assert.deepEqual(listed.entries.map((entry) => entry.name), ["甲目录", "乙目录", "程序.exe", "文章.pdf"]);
  assert.equal(listed.files.find((entry) => entry.name === "文章.pdf").isPdf, true);
  assert.equal(listed.files.find((entry) => entry.name === "文章.pdf").canOpenExternally, true);
  assert.equal(listed.files.find((entry) => entry.name === "程序.exe").canOpenExternally, false);
  assert.equal(listed.entries.some((entry) => entry.name === ".jianjian"), false);
}));

test("enforces the directory entry safety limit", async () => withLibrary(async ({ rootPath, manager }) => {
  const limited = createResearchLibraryManager({
    userDataPath: path.join(path.dirname(rootPath), "limited-user-data"),
    directoryEntryLimit: 2,
  });
  await fs.mkdir(path.join(path.dirname(rootPath), "limited-user-data"), { recursive: true });
  const selected = await limited.selectRoot(rootPath);
  await Promise.all(["a", "b", "c"].map((name) => fs.writeFile(path.join(rootPath, `${name}.txt`), name)));
  await assert.rejects(() => limited.listFolder(selected.libraryId, ""), /超过 2 项/);
}));

test("creates folders and imports copies with deterministic collision suffixes", async () => withLibrary(async ({ sandbox, rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  const created = await manager.createFolder(selected.libraryId, "", "收集");
  assert.equal(created.relativePath, "收集");
  const source = path.join(sandbox, "论文.pdf");
  await fs.writeFile(source, "%PDF imported");
  const first = await manager.importFiles(selected.libraryId, "收集", [source]);
  const second = await manager.importFiles(selected.libraryId, "收集", [source]);
  assert.deepEqual(first.imported.map((entry) => entry.relativePath), ["收集/论文.pdf"]);
  assert.deepEqual(second.imported.map((entry) => entry.relativePath), ["收集/论文 (2).pdf"]);
  assert.equal(await fs.readFile(path.join(rootPath, "收集", "论文.pdf"), "utf8"), "%PDF imported");
}));

test("rejects linked and oversized import sources", async (context) => withLibrary(async ({ sandbox, rootPath }) => {
  const manager = createResearchLibraryManager({ userDataPath: path.join(sandbox, "small-user"), importFileMaxBytes: 4 });
  await fs.mkdir(path.join(sandbox, "small-user"));
  const selected = await manager.selectRoot(rootPath);
  const large = path.join(sandbox, "large.txt");
  await fs.writeFile(large, "12345");
  await assert.rejects(() => manager.importFiles(selected.libraryId, "", [large]), /512MB|安全上限/);

  const link = path.join(sandbox, "linked.txt");
  try {
    await fs.symlink(large, link, "file");
  } catch (error) {
    context.skip(`当前环境不能创建文件链接：${error.message}`);
    return;
  }
  await assert.rejects(() => manager.importFiles(selected.libraryId, "", [link]), /符号链接/);
}));

test("source upsert and delete require exact disk revisions", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  const created = await manager.upsertSource(selected.libraryId, {
    type: "web",
    title: "OpenAI",
    url: "https://openai.com/research",
    excerpt: "摘录",
  }, null);
  assert.equal(created.source.url, "https://openai.com/research");
  assert.match(created.source.diskRevision.sha256, /^[a-f0-9]{64}$/);

  const sourcePath = path.join(rootPath, ".jianjian", "research-library", "sources", `${created.source.id}.json`);
  const external = JSON.parse(await fs.readFile(sourcePath, "utf8"));
  external.title = "外部更新";
  await fs.writeFile(sourcePath, `${JSON.stringify(external, null, 2)}\n`);
  await assert.rejects(
    () => manager.upsertSource(selected.libraryId, { ...created.source, title: "本机更新" }, created.source.diskRevision),
    (error) => error instanceof Error && error.code === "DOCUMENT_REVISION_CONFLICT",
  );

  const current = (await manager.listSources(selected.libraryId)).sources[0];
  await assert.rejects(
    () => manager.deleteSource(selected.libraryId, current.id, created.source.diskRevision),
    (error) => error instanceof Error && error.code === "DOCUMENT_REVISION_CONFLICT",
  );
  assert.equal((await manager.deleteSource(selected.libraryId, current.id, current.diskRevision)).ok, true);
  assert.equal((await manager.listSources(selected.libraryId)).sources.length, 0);
}));

test("validates web sources and file sources inside the authorized library", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  await assert.rejects(() => manager.upsertSource(selected.libraryId, { type: "web", url: "file:///etc/passwd" }, null), /HTTP|HTTPS|网址/);
  await assert.rejects(() => manager.upsertSource(selected.libraryId, { type: "web", url: "https://u:p@example.com" }, null), /账号|网址/);
  await assert.rejects(() => manager.upsertSource(selected.libraryId, { type: "file", relativePath: "missing.pdf" }, null), /ENOENT|不存在/);

  await fs.writeFile(path.join(rootPath, "存在.pdf"), "%PDF");
  const result = await manager.upsertSource(selected.libraryId, { type: "file", relativePath: "存在.pdf" }, null);
  assert.equal(result.source.relativePath, "存在.pdf");
  assert.equal(result.source.size, 4);
}));

test("renames and moves entries while rebasing file-source identities", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  await fs.mkdir(path.join(rootPath, "原目录"));
  await fs.mkdir(path.join(rootPath, "归档"));
  await fs.writeFile(path.join(rootPath, "原目录", "论文.pdf"), "%PDF");
  await manager.upsertSource(selected.libraryId, { type: "file", title: "论文", relativePath: "原目录/论文.pdf" }, null);

  const renamed = await manager.renameEntry(selected.libraryId, "原目录", "新目录");
  assert.equal(renamed.relativePath, "新目录");
  assert.deepEqual(renamed.warnings, []);
  assert.equal((await manager.listSources(selected.libraryId)).sources[0].relativePath, "新目录/论文.pdf");

  const moved = await manager.moveEntry(selected.libraryId, "新目录/论文.pdf", "归档");
  assert.equal(moved.relativePath, "归档/论文.pdf");
  assert.equal((await manager.listSources(selected.libraryId)).sources[0].relativePath, "归档/论文.pdf");
}));

test("trash, show, and copy-path resolve capabilities without accepting renderer absolute paths", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  const target = path.join(rootPath, "资料.txt");
  await fs.writeFile(target, "text");
  let shown = "";
  assert.equal((await manager.showEntry(selected.libraryId, "资料.txt", (value) => { shown = value; })).ok, true);
  assert.equal(shown, await fs.realpath(target));
  assert.equal((await manager.copyEntryPath(selected.libraryId, "资料.txt")).path, await fs.realpath(target));
  let trashed = "";
  await manager.trashEntry(selected.libraryId, "资料.txt", async (value) => { trashed = value; });
  assert.equal(trashed, await fs.realpath(target));
  await assert.rejects(() => manager.copyEntryPath(selected.libraryId, target), /相对路径/);
}));

test("reads only PDFs within the 128MB policy and blocks unsafe external types", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  await fs.writeFile(path.join(rootPath, "资料.pdf"), "%PDF-safe");
  await fs.writeFile(path.join(rootPath, "说明.txt"), "safe");
  await fs.writeFile(path.join(rootPath, "程序.exe"), "unsafe");
  const pdf = await manager.readPdf(selected.libraryId, "资料.pdf");
  assert.equal(pdf.bytes.toString("utf8"), "%PDF-safe");
  assert.match(pdf.diskRevision.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(() => manager.readPdf(selected.libraryId, "说明.txt"), /只有 PDF/);

  let opened = "";
  assert.equal((await manager.openEntryExternal(selected.libraryId, "说明.txt", async (value) => { opened = value; return ""; })).ok, true);
  assert.equal(opened, await fs.realpath(path.join(rootPath, "说明.txt")));
  await assert.rejects(() => manager.openEntryExternal(selected.libraryId, "程序.exe", async () => ""), /不能从笺间直接启动/);
  assert.equal(externalOpenAllowed("x.docx"), false);
  assert.equal(externalOpenAllowed("x.markdown"), true);
  assert.equal(externalOpenAllowed("x.cmd"), false);
  assert.equal(PDF_READ_MAX_BYTES, 128 * 1024 * 1024);
}));

test("classifies the static preview whitelist and reads bounded text and image bytes", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  const expected = new Map([
    ["手稿.LETTERPAPER", "document"],
    ["旧稿.paperdoc", "document"],
    ["论文.pdf", "pdf"],
    ["说明.markdown", "markdown"],
    ["记录.LOG", "text"],
    ["数据.tsv", "table"],
    ["照片.webp", "image"],
    ["网页.html", "unsupported"],
    ["文档.docx", "unsupported"],
  ]);
  for (const name of expected.keys()) await fs.writeFile(path.join(rootPath, name), name.endsWith(".webp") ? Buffer.from([1, 2, 3]) : "内容");
  const listed = await manager.listFolder(selected.libraryId, "");
  for (const [name, previewKind] of expected) {
    const entry = listed.files.find((candidate) => candidate.name === name);
    assert.equal(entry.previewKind, previewKind, name);
    assert.equal(entry.canOpenInApp, previewKind !== "unsupported", name);
  }
  assert.deepEqual(classifyEntry("A.CSV"), {
    extension: ".csv",
    isPdf: false,
    previewKind: "table",
    canOpenInApp: true,
    canOpenExternally: true,
  });
  const text = await manager.readPreview(selected.libraryId, "记录.LOG");
  assert.equal(text.previewKind, "text");
  assert.equal(text.bytes.toString("utf8"), "内容");
  const image = await manager.readPreview(selected.libraryId, "照片.webp");
  assert.equal(image.mime, "image/webp");
  assert.deepEqual([...image.bytes], [1, 2, 3]);
  await assert.rejects(() => manager.readPreview(selected.libraryId, "网页.html"), /不支持静态资料预览/);
  const oversizedTextPath = path.join(rootPath, "过大.txt");
  const oversizedImagePath = path.join(rootPath, "过大.png");
  await fs.writeFile(oversizedTextPath, "");
  await fs.writeFile(oversizedImagePath, "");
  await fs.truncate(oversizedTextPath, TEXT_PREVIEW_MAX_BYTES + 1);
  await fs.truncate(oversizedImagePath, IMAGE_PREVIEW_MAX_BYTES + 1);
  await assert.rejects(() => manager.readPreview(selected.libraryId, "过大.txt"), /超过 8MB/);
  await assert.rejects(() => manager.readPreview(selected.libraryId, "过大.png"), /超过 64MB/);
  assert.equal(TEXT_PREVIEW_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(IMAGE_PREVIEW_MAX_BYTES, 64 * 1024 * 1024);
}));

test("watch replaces the active watcher and emits only safe relative changes", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  const watchers = [];
  const createWatcher = (_root, options, listener) => {
    const emitter = new EventEmitter();
    emitter.closed = false;
    emitter.close = () => { emitter.closed = true; };
    emitter.listener = listener;
    emitter.options = options;
    watchers.push(emitter);
    return emitter;
  };
  const changes = [];
  await manager.watchLibrary(selected.libraryId, { watchFactory: createWatcher, onChange: (value) => changes.push(value) });
  await manager.watchLibrary(selected.libraryId, { watchFactory: createWatcher, onChange: (value) => changes.push(value) });
  assert.equal(watchers[0].closed, true);
  assert.equal(watchers[1].options.recursive, true);
  watchers[1].listener("rename", "子目录\\资料.pdf");
  watchers[1].listener("change", ".jianjian\\unrelated.txt");
  watchers[1].listener("change", ".jianjian\\research-library\\sources\\x.json");
  assert.deepEqual(changes.map((item) => item.relativePath), ["子目录/资料.pdf", ""]);
}));

test("rejects future, malformed, and escaping library metadata", async (context) => withLibrary(async ({ sandbox, rootPath }) => {
  const workspace = await ensureLibrary(rootPath);
  const manifest = JSON.parse(await fs.readFile(workspace.manifestPath, "utf8"));
  await fs.writeFile(workspace.manifestPath, `${JSON.stringify({ ...manifest, version: 99 })}\n`);
  await assert.rejects(() => ensureLibrary(rootPath), /更高版本/);

  await fs.rm(workspace.libraryRoot, { recursive: true, force: true });
  const outside = path.join(sandbox, "outside-library");
  await fs.mkdir(outside);
  try {
    await fs.symlink(outside, workspace.libraryRoot, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    context.skip(`当前环境不能创建目录链接：${error.message}`);
    return;
  }
  await assert.rejects(() => ensureLibrary(rootPath), /符号链接|目录联接/);
}));

test("imports legacy web and file sources, skips notes, and never exposes or deletes source paths", async () => withLibrary(async ({ sandbox, rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  const legacyFile = path.join(sandbox, "旧论文.pdf");
  await fs.writeFile(legacyFile, "%PDF legacy");
  const sources = [
    { id: "legacy_web_001", type: "web", title: "旧网页", url: "https://example.com/source", notes: "网页摘录" },
    { id: "legacy_note_01", type: "note", title: "旧笔记", notes: "笔记内容" },
    { id: "legacy_file_01", type: "file", title: "旧论文", mime: "application/pdf", size: 11 },
  ];
  const first = await importLegacyResearch({
    manager,
    libraryId: selected.libraryId,
    workspaceId: "legacy_workspace_01",
    sources,
    resolveFile: async (source) => {
      assert.equal(source.id, "legacy_file_01");
      return { filePath: legacyFile };
    },
  });
  assert.equal(first.ok, true);
  assert.equal(first.imported.length, 2);
  assert.deepEqual(new Set(first.imported.map((source) => source.id)), new Set(["legacy_web_001", "legacy_file_01"]));
  assert.deepEqual(first.skipped, [{ sourceId: "legacy_note_01", reason: "notes-removed" }]);
  const importedFile = first.imported.find((source) => source.type === "file");
  assert.equal(importedFile.relativePath, "旧资料导入/旧论文.pdf");
  assert.equal(await fs.readFile(path.join(rootPath, ...importedFile.relativePath.split("/")), "utf8"), "%PDF legacy");
  assert.equal(await fs.readFile(legacyFile, "utf8"), "%PDF legacy");
  assert.deepEqual(importedFile.importedFrom, { workspaceId: "legacy_workspace_01", sourceId: "legacy_file_01" });
  const serializedMetadata = await fs.readFile(path.join(rootPath, ".jianjian", "research-library", "sources", "legacy_file_01.json"), "utf8");
  assert.equal(serializedMetadata.includes(legacyFile), false);

  const second = await importLegacyResearch({
    manager,
    libraryId: selected.libraryId,
    workspaceId: "legacy_workspace_01",
    sources,
    resolveFile: async () => ({ filePath: legacyFile }),
  });
  assert.equal(second.imported.length, 0);
  assert.equal(second.skipped.length, 3);
  assert.equal((await manager.listFolder(selected.libraryId, "旧资料导入")).files.length, 1);
}));

test("legacy import generates a new identity on collision and records per-source failures", async () => withLibrary(async ({ sandbox, rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  await manager.upsertSource(selected.libraryId, { id: "conflict_id", type: "web", title: "现有来源", url: "https://example.com/existing" }, null);
  await fs.writeFile(path.join(rootPath, "旧资料导入"), "name collision");
  const legacyFile = path.join(sandbox, "资料.pdf");
  await fs.writeFile(legacyFile, "%PDF");
  const result = await importLegacyResearch({
    manager,
    libraryId: selected.libraryId,
    workspaceId: "legacy_workspace_02",
    sources: [
      { id: "conflict_id", type: "web", title: "冲突来源", url: "https://example.org" },
      { id: "legacy_file_02", type: "file", title: "可复制" },
      { id: "legacy_file_03", type: "file", title: "已丢失" },
    ],
    resolveFile: async (source) => {
      if (source.id === "legacy_file_03") throw new Error("旧文件不存在");
      return { filePath: legacyFile };
    },
  });
  assert.equal(result.imported.length, 2);
  assert.notEqual(result.imported.find((source) => source.title === "冲突来源").id, "conflict_id");
  assert.equal(result.importFolderRelativePath, "旧资料导入 (2)");
  assert.deepEqual(result.warnings.at(-1), { sourceId: "legacy_file_03", message: "旧文件不存在" });
  assert.equal(await fs.readFile(path.join(rootPath, "旧资料导入"), "utf8"), "name collision");
}));

test("listing a v1 library safely removes note records while retaining web, malformed data, and the manifest", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  const web = await manager.upsertSource(selected.libraryId, {
    id: "retained_web_01",
    type: "web",
    title: "保留网页",
    url: "https://example.com/retained",
  }, null);
  const sourcesRoot = path.join(rootPath, ".jianjian", "research-library", "sources");
  const notePath = path.join(sourcesRoot, "removed_note_01.json");
  const malformedPath = path.join(sourcesRoot, "malformed_001.json");
  await fs.writeFile(notePath, `${JSON.stringify({
    version: 1,
    kind: "research",
    id: "removed_note_01",
    type: "note",
    title: "待清理笔记",
    revision: "note-revision-1",
  })}\n`, "utf8");
  await fs.writeFile(malformedPath, "{not json", "utf8");

  const listed = await manager.listSources(selected.libraryId);
  assert.deepEqual(listed.sources.map((source) => source.id), [web.source.id]);
  assert.deepEqual(listed.removedNoteSourceIds, ["removed_note_01"]);
  assert.match(listed.warnings.find((warning) => warning.file === "malformed_001.json")?.message || "", /无法解析/);
  await assert.rejects(fs.stat(notePath), { code: "ENOENT" });
  assert.equal(await fs.readFile(malformedPath, "utf8"), "{not json");
  const manifest = JSON.parse(await fs.readFile(path.join(rootPath, ".jianjian", "research-library", "manifest.json"), "utf8"));
  assert.equal(manifest.version, 1);
}));

test("web tree keeps global and workspace scopes independent and promotes folder contents on delete", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  const source = await manager.upsertSource(selected.libraryId, {
    id: "web_tree_source_01",
    type: "web",
    title: "作用域网页",
    url: "https://example.com/tree",
  }, null);
  const initial = await manager.listWebTree(selected.libraryId);
  assert.equal(initial.diskRevision, null);
  const rootFolderState = await manager.createWebFolder(selected.libraryId, {
    name: "工作区资料",
    scopeKey: "workspace:11111111-1111-4111-8111-111111111111",
  }, initial.diskRevision);
  const rootFolder = rootFolderState.folders[0];
  const childState = await manager.createWebFolder(selected.libraryId, {
    name: "子文件夹",
    parentId: rootFolder.id,
    scopeKey: rootFolder.scopeKey,
  }, rootFolderState.diskRevision);
  const childFolder = childState.folders.find((folder) => folder.parentId === rootFolder.id);
  const placed = await manager.moveWebSource(selected.libraryId, source.source.id, {
    scopeKey: rootFolder.scopeKey,
    folderId: rootFolder.id,
  }, childState.diskRevision);
  assert.deepEqual(placed.placements[source.source.id], { scopeKey: rootFolder.scopeKey, folderId: rootFolder.id });
  const deleted = await manager.deleteWebFolder(selected.libraryId, rootFolder.id, placed.diskRevision);
  assert.equal(deleted.folders.find((folder) => folder.id === childFolder.id).parentId, "");
  assert.equal(deleted.placements[source.source.id].folderId, "");
  assert.equal(deleted.placements[source.source.id].scopeKey, rootFolder.scopeKey);
  assert.equal(JSON.parse(await fs.readFile(path.join(rootPath, ".jianjian", "research-library", "web-tree.json"), "utf8")).version, 1);
}));

test("copies public web subtrees into independent workspace scopes while preserving paths and skipping duplicates", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  const rootState = await manager.createWebFolder(selected.libraryId, { name: "参考", scopeKey: "global" }, null);
  const publicRoot = rootState.folders.find((folder) => folder.name === "参考");
  const childState = await manager.createWebFolder(selected.libraryId, { name: "搜索", parentId: publicRoot.id, scopeKey: "global" }, rootState.diskRevision);
  const publicChild = childState.folders.find((folder) => folder.parentId === publicRoot.id && folder.name === "搜索");
  const emptyState = await manager.createWebFolder(selected.libraryId, { name: "空组", parentId: publicRoot.id, scopeKey: "global" }, childState.diskRevision);
  const source = await manager.upsertSource(selected.libraryId, {
    id: "public_web_source_01",
    type: "web",
    title: "Google",
    url: "https://www.google.com/",
    excerpt: "公区摘录",
  }, null);
  const placed = await manager.moveWebSource(selected.libraryId, source.source.id, { scopeKey: "global", folderId: publicChild.id }, emptyState.diskRevision);
  const targetScopeKey = "workspace:11111111-1111-4111-8111-111111111111";
  const copied = await manager.copyWebSelection(selected.libraryId, {
    folderIds: [publicRoot.id],
    sourceIds: [source.source.id],
    targetScopeKey,
    expectedTreeRevision: placed.diskRevision,
  });
  assert.equal(copied.createdFolderCount, 3);
  assert.equal(copied.copiedSourceCount, 1);
  assert.equal(copied.skippedDuplicateCount, 0);
  const copiedSource = copied.createdSources[0];
  assert.notEqual(copiedSource.id, source.source.id);
  assert.equal(copiedSource.url, source.source.url);
  assert.equal(copiedSource.excerpt, "公区摘录");
  const privateRoot = copied.folders.find((folder) => folder.scopeKey === targetScopeKey && folder.name === "参考" && !folder.parentId);
  const privateChild = copied.folders.find((folder) => folder.scopeKey === targetScopeKey && folder.name === "搜索" && folder.parentId === privateRoot.id);
  assert.ok(copied.folders.some((folder) => folder.scopeKey === targetScopeKey && folder.name === "空组" && folder.parentId === privateRoot.id));
  assert.deepEqual(copied.placements[copiedSource.id], { scopeKey: targetScopeKey, folderId: privateChild.id });
  assert.deepEqual(copied.placements[source.source.id], { scopeKey: "global", folderId: publicChild.id });

  const repeated = await manager.copyWebSelection(selected.libraryId, {
    folderIds: [publicRoot.id],
    sourceIds: [],
    targetScopeKey,
    expectedTreeRevision: copied.diskRevision,
  });
  assert.equal(repeated.createdFolderCount, 0);
  assert.equal(repeated.copiedSourceCount, 0);
  assert.equal(repeated.skippedDuplicateCount, 1);

  const secondScopeKey = "workspace:22222222-2222-4222-8222-222222222222";
  const individual = await manager.copyWebSelection(selected.libraryId, {
    folderIds: [],
    sourceIds: [source.source.id],
    targetScopeKey: secondScopeKey,
    expectedTreeRevision: repeated.diskRevision,
  });
  assert.equal(individual.createdFolderCount, 2);
  assert.equal(individual.copiedSourceCount, 1);
  const secondRoot = individual.folders.find((folder) => folder.scopeKey === secondScopeKey && folder.name === "参考");
  const secondChild = individual.folders.find((folder) => folder.scopeKey === secondScopeKey && folder.name === "搜索" && folder.parentId === secondRoot.id);
  assert.equal(individual.placements[individual.createdSources[0].id].folderId, secondChild.id);

  await manager.upsertSource(selected.libraryId, { ...copiedSource, title: "私区标题" }, copiedSource.diskRevision);
  const listed = await manager.listSources(selected.libraryId);
  assert.equal(listed.sources.find((item) => item.id === source.source.id).title, "Google");
  assert.equal(listed.sources.find((item) => item.id === copiedSource.id).title, "私区标题");
  await assert.rejects(() => manager.copyWebSelection(selected.libraryId, {
    folderIds: [publicRoot.id],
    sourceIds: [],
    targetScopeKey,
    expectedTreeRevision: copied.diskRevision,
  }), /修改|重新载入/);
}));

test("public web copying removes newly written sources when the tree commit fails", async () => {
  let failNextTreeRename = false;
  const fsApi = {
    ...fs,
    rename: async (from, to) => {
      if (failNextTreeRename && path.basename(to) === WEB_TREE_FILE) {
        failNextTreeRename = false;
        throw new Error("simulated web tree commit failure");
      }
      return fs.rename(from, to);
    },
  };
  await withLibrary(async ({ rootPath, manager }) => {
    const selected = await manager.selectRoot(rootPath);
    const folderState = await manager.createWebFolder(selected.libraryId, { name: "公区", scopeKey: "global" }, null);
    const folder = folderState.folders[0];
    const source = await manager.upsertSource(selected.libraryId, {
      id: "rollback_web_source_01",
      type: "web",
      title: "回滚测试",
      url: "https://example.com/rollback",
    }, null);
    const placed = await manager.moveWebSource(selected.libraryId, source.source.id, { scopeKey: "global", folderId: folder.id }, folderState.diskRevision);
    failNextTreeRename = true;
    await assert.rejects(() => manager.copyWebSelection(selected.libraryId, {
      folderIds: [folder.id],
      sourceIds: [],
      targetScopeKey: "workspace:33333333-3333-4333-8333-333333333333",
      expectedTreeRevision: placed.diskRevision,
    }), /simulated web tree commit failure/);
    const listed = await manager.listSources(selected.libraryId);
    assert.deepEqual(listed.sources.map((item) => item.id), [source.source.id]);
    const tree = await manager.listWebTree(selected.libraryId);
    assert.equal(tree.folders.filter((item) => item.scopeKey.startsWith("workspace:")).length, 0);
    assert.equal(Object.keys(tree.placements).length, 1);
  }, { fsApi });
});

test("web tree rejects cycles, cross-scope parents and preserves a corrupt index read-only", async () => withLibrary(async ({ rootPath, manager }) => {
  const selected = await manager.selectRoot(rootPath);
  const globalState = await manager.createWebFolder(selected.libraryId, { name: "全局", scopeKey: "global" }, null);
  const globalFolder = globalState.folders[0];
  await assert.rejects(() => manager.createWebFolder(selected.libraryId, {
    name: "跨区",
    scopeKey: "workspace:11111111-1111-4111-8111-111111111111",
    parentId: globalFolder.id,
  }, globalState.diskRevision), /作用域不同/);
  assert.equal(normalizeWebScopeKey("GLOBAL"), "global");
  const indexPath = path.join(rootPath, ".jianjian", "research-library", "web-tree.json");
  await fs.writeFile(indexPath, "{broken", "utf8");
  const corrupted = await manager.listWebTree(selected.libraryId);
  assert.equal(corrupted.readOnly, true);
  assert.equal(corrupted.warnings.length, 1);
  await assert.rejects(() => manager.createWebFolder(selected.libraryId, { name: "不能覆盖", scopeKey: "global" }, corrupted.diskRevision), /损坏/);
  assert.equal(await fs.readFile(indexPath, "utf8"), "{broken");
}));
