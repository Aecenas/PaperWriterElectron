const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createSource,
  deleteCitationSource,
  deleteSource,
  ensureWorkspace,
  isPathInside,
  listCitationSources,
  listSources,
  normalizeCitationResearchIdentity,
  readCitationSource,
  relinkSource,
  resolveSourceFile,
  sourceMetadataPath,
  upsertCitationSource,
  updateSource,
  writeSource,
} = require("./workspace-research.cjs");

async function withWorkspace(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-research-"));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("creates a workspace manifest and shared web source while rejecting notes", async () => withWorkspace(async (root) => {
  const workspace = await ensureWorkspace(root);
  assert.match(workspace.manifest.workspaceId, /^[a-z0-9-]{8,}$/i);
  const web = await createSource(root, { type: "web", title: "研究网页", url: "https://example.com/research", notes: "一段摘录" });
  const listed = await listSources(root);
  assert.equal(listed.sources.length, 1);
  assert.equal(listed.sources[0].id, web.id);
  assert.equal(listed.sources[0].notes, "一段摘录");
  await assert.rejects(createSource(root, { type: "note", title: "旧笔记" }), /仅支持文件或网页/);
}));

test("keeps linked files inside the workspace and resolves them safely", async () => withWorkspace(async (root) => {
  const filePath = path.join(root, "paper.pdf");
  await fs.writeFile(filePath, "%PDF-test");
  const source = await createSource(root, { type: "file", storage: "linked", filePath });
  assert.equal(source.title, "paper.pdf");
  const resolved = await resolveSourceFile(root, source.id);
  assert.equal(resolved.filePath, filePath);
  await assert.rejects(
    createSource(root, { type: "file", storage: "linked", filePath: __filename }),
    /必须位于当前工作区/,
  );
}));

test("relinks a linked source to another workspace-relative file", async () => withWorkspace(async (root) => {
  const firstPath = path.join(root, "papers", "first.pdf");
  const secondPath = path.join(root, "archive", "second.pdf");
  await fs.mkdir(path.dirname(firstPath), { recursive: true });
  await fs.mkdir(path.dirname(secondPath), { recursive: true });
  await fs.writeFile(firstPath, "first");
  await fs.writeFile(secondPath, "second edition");
  const source = await createSource(root, { type: "file", storage: "linked", filePath: firstPath });

  const relinked = await relinkSource(root, source.id, secondPath);
  assert.equal(relinked.id, source.id);
  assert.equal(relinked.storage, "linked");
  assert.equal(relinked.relativePath, "archive/second.pdf");
  assert.equal(relinked.size, Buffer.byteLength("second edition"));
  const resolved = await resolveSourceFile(root, source.id);
  assert.equal(resolved.filePath, secondPath);

  await assert.rejects(relinkSource(root, source.id, __filename), /必须位于当前工作区/);
}));

test("copies managed files and removes only the managed copy", async () => withWorkspace(async (root) => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-source-"));
  try {
    const original = path.join(outside, "source.txt");
    await fs.writeFile(original, "source");
    const source = await createSource(root, { type: "file", storage: "managed", filePath: original });
    const resolved = await resolveSourceFile(root, source.id);
    assert.notEqual(resolved.filePath, original);
    assert.equal(await fs.readFile(resolved.filePath, "utf8"), "source");
    await deleteSource(root, source.id);
    await assert.rejects(fs.stat(resolved.filePath), { code: "ENOENT" });
    assert.equal(await fs.readFile(original, "utf8"), "source");
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
}));

test("relinks a managed source by replacing it with a managed copy", async () => withWorkspace(async (root) => {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-source-"));
  try {
    const first = path.join(outside, "first.txt");
    const replacement = path.join(outside, "replacement.txt");
    await fs.writeFile(first, "first");
    await fs.writeFile(replacement, "replacement");
    const source = await createSource(root, { type: "file", storage: "managed", filePath: first });

    const relinked = await relinkSource(root, source.id, replacement);
    assert.equal(relinked.id, source.id);
    assert.equal(relinked.storage, "managed");
    assert.equal(relinked.managedFileName, "replacement.txt");
    assert.equal(relinked.relativePath, `.jianjian/research/${source.id}/replacement.txt`);
    const resolved = await resolveSourceFile(root, source.id);
    assert.notEqual(resolved.filePath, replacement);
    assert.equal(await fs.readFile(resolved.filePath, "utf8"), "replacement");
    assert.equal(await fs.readFile(replacement, "utf8"), "replacement");
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
}));

test("reports missing files and rejects forged paths outside their storage boundary", async () => withWorkspace(async (root) => {
  const linkedPath = path.join(root, "linked.txt");
  await fs.writeFile(linkedPath, "linked");
  const linked = await createSource(root, { type: "file", storage: "linked", filePath: linkedPath });
  await fs.rm(linkedPath);
  await assert.rejects(resolveSourceFile(root, linked.id), /资料文件不存在/);

  const outside = path.join(path.dirname(root), "outside.txt");
  await fs.writeFile(outside, "outside");
  try {
    const escaped = await writeSource(root, {
      ...linked,
      relativePath: "../outside.txt",
    });
    await assert.rejects(resolveSourceFile(root, escaped.id), /越过工作区边界/);

    const forgedManaged = await writeSource(root, {
      ...linked,
      id: "managed_path_test",
      storage: "managed",
      relativePath: "ordinary-file.txt",
      managedFileName: "ordinary-file.txt",
    });
    await fs.writeFile(path.join(root, "ordinary-file.txt"), "not managed");
    await assert.rejects(resolveSourceFile(root, forgedManaged.id), /托管资料路径无效/);
  } finally {
    await fs.rm(outside, { force: true });
  }
}));

test("rejects a workspace symlink that resolves outside the workspace", async (context) => withWorkspace(async (root) => {
  const outside = path.join(path.dirname(root), `outside-${path.basename(root)}.txt`);
  const linkPath = path.join(root, "escaped-link.txt");
  await fs.writeFile(outside, "outside");
  try {
    try {
      await fs.symlink(outside, linkPath, "file");
    } catch (error) {
      if (["EACCES", "EPERM", "UNKNOWN"].includes(error?.code)) {
        context.skip("当前 Windows 环境不允许创建符号链接");
        return;
      }
      throw error;
    }
    await assert.rejects(
      createSource(root, { type: "file", storage: "linked", filePath: linkPath }),
      /必须位于当前工作区/,
    );
  } finally {
    await fs.rm(outside, { force: true });
  }
}));

test("updates metadata without changing file identity", async () => withWorkspace(async (root) => {
  const source = await createSource(root, { type: "web", title: "旧标题", url: "https://example.com/a" });
  const updated = await updateSource(root, source.id, { title: "新标题", notes: "批注" });
  assert.equal(updated.id, source.id);
  assert.equal(updated.title, "新标题");
  assert.equal(updated.notes, "批注");
}));

test("path containment rejects sibling prefixes", () => {
  assert.equal(isPathInside("C:\\Work", "C:\\Work\\notes\\a.pdf", path.win32, "win32"), true);
  assert.equal(isPathInside("C:\\Work", "C:\\Workspace\\a.pdf", path.win32, "win32"), false);
});

test("stores citations beside research metadata while keeping research lists filtered", async () => withWorkspace(async (root) => {
  const workspace = await ensureWorkspace(root);
  const legacyId = "legacy_note_01";
  await fs.writeFile(sourceMetadataPath(root, legacyId), JSON.stringify({
    version: 1,
    id: legacyId,
    type: "note",
    title: "旧版研究资料",
    notes: "没有 kind 的旧数据",
  }), "utf8");
  const citation = await upsertCitationSource(root, {
    type: "article",
    title: "A structured source",
    authors: ["Ada", "  Turing  "],
    year: 2026,
  });

  const stored = JSON.parse(await fs.readFile(sourceMetadataPath(root, citation.id), "utf8"));
  assert.equal(stored.kind, "citation");
  assert.equal(citation.id, citation.id.toLowerCase());
  assert.match(citation.id, /^[0-9a-f-]{36}$/);

  const research = await listSources(root);
  assert.equal(research.workspaceId, workspace.manifest.workspaceId);
  assert.deepEqual(research.sources.map((source) => source.id), []);
  assert.equal((await fs.stat(sourceMetadataPath(root, legacyId))).isFile(), true);

  const citations = await listCitationSources(root);
  assert.deepEqual(citations.sources.map((source) => source.id), [citation.id]);
  assert.deepEqual(citations.sources[0].authors, ["Ada", "Turing"]);
  assert.equal(citations.sources[0].year, "2026");
}));

test("upserts canonical citation fields and preserves omitted values", async () => withWorkspace(async (root) => {
  const research = await createSource(root, { type: "web", title: "摘录卡", url: "https://example.com/card" });
  const citation = await upsertCitationSource(root, {
    type: "article",
    title: "A paper",
    authors: "甲；乙, 丙",
    year: 2024,
    containerTitle: "Journal",
    publisher: "Press",
    url: "https://example.com/paper",
    doi: "https://doi.org/10.1000/example",
    isbn: "978-0-00",
    accessedAt: "2026-07-14T00:00:00.000Z",
    pages: "12-18",
    notes: "重点来源",
    researchSourceId: research.id,
  });
  assert.deepEqual(citation.authors, ["甲", "乙", "丙"]);
  assert.equal(citation.doi, "10.1000/example");
  assert.equal(citation.researchSourceId, research.id);

  const updated = await upsertCitationSource(root, { id: citation.id, title: "A revised paper", notes: "" });
  assert.equal(updated.id, citation.id);
  assert.equal(updated.title, "A revised paper");
  assert.equal(updated.containerTitle, "Journal");
  assert.equal(updated.notes, "");
  assert.equal(updated.createdAt, citation.createdAt);
  assert.equal((await readCitationSource(root, citation.id)).publisher, "Press");
}));

test("persists independent-library UUID pairs without requiring the legacy workspace source", async () => withWorkspace(async (root) => {
  const researchLibraryId = "11111111-1111-4111-8111-111111111111";
  const researchSourceId = "22222222-2222-4222-8222-222222222222";
  const citation = await upsertCitationSource(root, {
    type: "pdf",
    title: "可离线使用的书目信息快照",
    authors: ["作者"],
    pages: "31-32",
    researchLibraryId: researchLibraryId.toUpperCase(),
    researchSourceId: researchSourceId.toUpperCase(),
    researchRootPath: "C:\\不得写入工作区\\资料",
    absolutePath: "C:\\不得持久化\\paper.pdf",
  });

  assert.equal(citation.researchLibraryId, researchLibraryId);
  assert.equal(citation.researchSourceId, researchSourceId);
  const stored = JSON.parse(await fs.readFile(sourceMetadataPath(root, citation.id), "utf8"));
  assert.equal(stored.researchLibraryId, researchLibraryId);
  assert.equal(stored.researchSourceId, researchSourceId);
  assert.equal("researchRootPath" in stored, false);
  assert.equal("absolutePath" in stored, false);

  const reopened = await readCitationSource(root, citation.id);
  assert.equal(reopened.title, "可离线使用的书目信息快照");
  assert.equal(reopened.researchLibraryId, researchLibraryId);
  assert.equal(reopened.researchSourceId, researchSourceId);
  const updated = await upsertCitationSource(root, { id: citation.id, title: "离线修订快照" });
  assert.equal(updated.researchLibraryId, researchLibraryId);
  assert.equal(updated.researchSourceId, researchSourceId);
}));

test("drops invalid or half independent-library pairs without weakening legacy validation", async () => withWorkspace(async (root) => {
  const libraryId = "11111111-1111-4111-8111-111111111111";
  const sourceId = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(normalizeCitationResearchIdentity({ researchLibraryId: libraryId }), {});
  assert.deepEqual(normalizeCitationResearchIdentity({ researchLibraryId: "invalid", researchSourceId: sourceId }), {});

  const half = await upsertCitationSource(root, { title: "缺少来源", researchLibraryId: libraryId });
  assert.equal("researchLibraryId" in half, false);
  assert.equal("researchSourceId" in half, false);
  const invalid = await upsertCitationSource(root, {
    title: "非法配对",
    researchLibraryId: "invalid",
    researchSourceId: sourceId,
  });
  assert.equal("researchLibraryId" in invalid, false);
  assert.equal("researchSourceId" in invalid, false);

  await assert.rejects(
    upsertCitationSource(root, { title: "旧版非法标识", researchSourceId: "bad id" }),
    /研究资料标识无效/,
  );
  await assert.rejects(
    upsertCitationSource(root, { title: "旧版悬空标识", researchSourceId: "missing_source" }),
    /ENOENT|no such file/i,
  );
}));

test("citation operations reject invalid links, kind confusion, and shared-limit overflow", async () => withWorkspace(async (root) => {
  const research = await createSource(root, { type: "web", title: "研究资料", url: "https://example.com/research" });
  await assert.rejects(
    upsertCitationSource(root, { title: "坏链接", url: "file:///C:/secret", researchSourceId: research.id }),
    /http 或 https/,
  );
  await assert.rejects(
    upsertCitationSource(root, { title: "悬空链接", researchSourceId: "missing_source" }),
    /ENOENT|no such file/i,
  );
  await assert.rejects(
    upsertCitationSource(root, { title: "超过上限" }, { sourceLimit: 1 }),
    /已达上限/,
  );

  const citation = await upsertCitationSource(root, { title: "可删除来源" });
  await assert.rejects(deleteSource(root, citation.id), /参考文献来源/);
  await assert.rejects(deleteCitationSource(root, research.id), /UUID|研究资料/);
  await deleteCitationSource(root, citation.id);
  await assert.rejects(readCitationSource(root, citation.id), { code: "ENOENT" });
}));

test("citation metadata symlinks cannot escape the shared sources directory", async (context) => withWorkspace(async (root) => {
  const workspace = await ensureWorkspace(root);
  const citationId = "11111111-1111-4111-8111-111111111111";
  const outside = path.join(path.dirname(root), `citation-${path.basename(root)}.json`);
  const linkPath = sourceMetadataPath(root, citationId);
  await fs.writeFile(outside, JSON.stringify({ kind: "citation", id: citationId, title: "outside" }), "utf8");
  try {
    try {
      await fs.symlink(outside, linkPath, "file");
    } catch (error) {
      if (["EACCES", "EPERM", "UNKNOWN"].includes(error?.code)) {
        context.skip("当前 Windows 环境不允许创建符号链接");
        return;
      }
      throw error;
    }
    await assert.rejects(readCitationSource(workspace.root, citationId), /元数据无效|越过工作区边界/);
  } finally {
    await fs.rm(outside, { force: true });
  }
}));

test("the shared sources directory cannot be replaced by an escaping symlink", async (context) => withWorkspace(async (root) => {
  const workspace = await ensureWorkspace(root);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-sources-"));
  try {
    await fs.rm(workspace.sourcesRoot, { recursive: true, force: true });
    try {
      await fs.symlink(outside, workspace.sourcesRoot, "junction");
    } catch (error) {
      if (["EACCES", "EPERM", "UNKNOWN"].includes(error?.code)) {
        context.skip("当前 Windows 环境不允许创建目录链接");
        return;
      }
      throw error;
    }
    await assert.rejects(upsertCitationSource(root, { title: "不得写到工作区之外" }), /资料目录无效|越过工作区边界/);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await fs.rm(outside, { recursive: true, force: true });
  }
}));

test("wires citation library IPC through the sandboxed preload bridge", async () => {
  const [mainSource, preloadSource] = await Promise.all([
    fs.readFile(path.join(__dirname, "main.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "preload.cjs"), "utf8"),
  ]);
  for (const channel of ["citation:list", "citation:upsert", "citation:delete"]) {
    assert.match(mainSource, new RegExp(`ipcMain\\.handle\\("${channel.replace(":", "\\:")}"`));
    assert.match(preloadSource, new RegExp(`ipcRenderer\\.invoke\\("${channel.replace(":", "\\:")}"`));
  }
  assert.match(mainSource, /citation:list[\s\S]*assertAuthorizedDirectory\(workspacePath\)[\s\S]*listCitationSources\(rootPath\)/);
  assert.match(mainSource, /citation:upsert[\s\S]*assertAuthorizedDirectory\(workspacePath\)[\s\S]*upsertCitationSource\(rootPath, source\)/);
  assert.match(mainSource, /citation:delete[\s\S]*assertAuthorizedDirectory\(workspacePath\)[\s\S]*deleteCitationSource\(rootPath, sourceId\)/);
});
