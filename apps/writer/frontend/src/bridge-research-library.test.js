import assert from "node:assert/strict";
import test from "node:test";
import { browserBridge } from "./bridge.js";

const LIBRARY_ID = "11111111-1111-4111-8111-111111111111";

function installMemoryStorage() {
  const memory = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
  });
  return memory;
}

test("browser research root and file operations fail closed without exposing local paths", async () => {
  const root = await browserBridge.getResearchRoot();
  assert.deepEqual(root, {
    configured: false,
    available: false,
    unsupported: true,
    browserOnly: true,
  });
  assert.equal((await browserBridge.pickResearchRoot()).canceled, true);

  const listed = await browserBridge.listResearchFolder(LIBRARY_ID, "论文/待读");
  assert.equal(listed.unsupported, true);
  assert.equal(listed.relativePath, "论文/待读");
  assert.deepEqual(listed.entries, []);

  await assert.rejects(
    () => browserBridge.listResearchFolder(LIBRARY_ID, "C:\\private\\资料"),
    /相对路径/,
  );
  await assert.rejects(
    () => browserBridge.openResearchEntryExternal(LIBRARY_ID, "../程序.exe"),
    /越过根目录/,
  );
  await assert.rejects(
    () => browserBridge.copyResearchEntryPath(LIBRARY_ID, ".jianjian/manifest.json"),
    /保留目录/,
  );

  const safeCopy = await browserBridge.copyResearchEntryPath(LIBRARY_ID, "资料.pdf");
  assert.equal(safeCopy.unsupported, true);
  assert.equal(Object.hasOwn(safeCopy, "path"), false);

  const secretWorkspacePath = "C:\\Users\\writer\\private-workspace";
  const legacyImport = await browserBridge.importLegacyResearch(secretWorkspacePath, LIBRARY_ID);
  assert.equal(legacyImport.ok, false);
  assert.equal(legacyImport.unsupported, true);
  assert.equal(legacyImport.libraryId, LIBRARY_ID);
  assert.equal(JSON.stringify(legacyImport).includes(secretWorkspacePath), false);
  assert.equal(Object.hasOwn(legacyImport, "workspacePath"), false);
});

test("explicit browser visual preview exposes bounded PDF and static fixtures without local paths", async () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { search: "?researchPreview=1" } },
  });
  try {
    const root = await browserBridge.getResearchRoot();
    assert.equal(root.available, true);
    assert.equal(root.preview, true);
    assert.match(root.libraryId, /^[0-9a-f-]{36}$/);
    assert.equal(Object.hasOwn(root, "rootPath"), true);

    const listed = await browserBridge.listResearchFolder(root.libraryId, "");
    assert.equal(listed.entries.length, 1);
    assert.equal(listed.entries[0].relativePath, "阅读示例.pdf");
    const pdf = await browserBridge.readResearchPdf(root.libraryId, listed.entries[0].relativePath);
    assert.equal(pdf.preview, true);
    assert.equal(pdf.bytes instanceof Uint8Array, true);
    assert.equal(new TextDecoder().decode(pdf.bytes.slice(0, 8)), "%PDF-1.4");

    globalThis.window.location.search = "?researchPreview=1&researchKind=table";
    const tableList = await browserBridge.listResearchFolder(root.libraryId, "");
    assert.equal(tableList.entries.length, 1);
    assert.equal(tableList.entries[0].previewKind, "table");
    assert.equal(Object.hasOwn(tableList.entries[0], "path"), false);
    const table = await browserBridge.readResearchPreview(root.libraryId, tableList.entries[0].relativePath);
    assert.equal(table.previewKind, "table");
    assert.match(table.text, /研究任务 01/);
    assert.equal(Object.hasOwn(table, "path"), false);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }
});

test("browser research source CRUD is library-scoped, revision-safe and limited to web", async () => {
  const memory = installMemoryStorage();
  const changes = [];
  const unsubscribe = browserBridge.onResearchLibraryChanged((payload) => changes.push(payload));
  try {
    const created = await browserBridge.upsertResearchLibrarySource(LIBRARY_ID, {
      type: "web",
      title: "论文网页",
      url: "https://example.com/paper",
      excerpt: "待引用摘录",
      bibliographic: { authors: ["甲", "乙"], year: 2026 },
    });
    assert.equal(created.libraryId, LIBRARY_ID);
    assert.equal(created.source.type, "web");
    assert.equal(created.source.url, "https://example.com/paper");
    assert.deepEqual(created.source.bibliographic.authors, ["甲", "乙"]);
    assert.match(created.source.id, /^[0-9a-f-]{36}$/);
    assert.match(created.source.diskRevision.sha256, /^[0-9a-f]{64}$/);
    assert.equal(changes.at(-1).libraryId, LIBRARY_ID);

    const listed = await browserBridge.listResearchLibrarySources(LIBRARY_ID);
    assert.equal(listed.sources.length, 1);
    assert.equal((await browserBridge.listLibrarySources(LIBRARY_ID)).sources.length, 1);
    assert.equal(JSON.stringify([...memory.keys()]).includes(LIBRARY_ID), true);

    const staleRevision = { ...created.source.diskRevision, sha256: "0".repeat(64) };
    const staleUpdate = await browserBridge.upsertResearchLibrarySource(
      LIBRARY_ID,
      { ...created.source, title: "不应覆盖" },
      staleRevision,
    );
    assert.equal(staleUpdate.ok, false);
    assert.equal(staleUpdate.conflict, true);
    assert.equal(staleUpdate.code, "DOCUMENT_REVISION_CONFLICT");
    assert.equal(staleUpdate.actualRevision.sha256, created.source.diskRevision.sha256);

    const updated = await browserBridge.upsertLibrarySource(
      LIBRARY_ID,
      { ...created.source, title: "修订标题" },
      created.source.diskRevision,
    );
    assert.equal(updated.source.title, "修订标题");
    assert.notEqual(updated.source.diskRevision.sha256, created.source.diskRevision.sha256);

    const staleDelete = await browserBridge.deleteResearchLibrarySource(
      LIBRARY_ID,
      updated.source.id,
      created.source.diskRevision,
    );
    assert.equal(staleDelete.conflict, true);
    assert.equal(staleDelete.code, "DOCUMENT_REVISION_CONFLICT");
    const removed = await browserBridge.deleteLibrarySource(
      LIBRARY_ID,
      updated.source.id,
      updated.source.diskRevision,
    );
    assert.equal(removed.ok, true);
    assert.equal((await browserBridge.listResearchLibrarySources(LIBRARY_ID)).sources.length, 0);

    await assert.rejects(
      () => browserBridge.upsertResearchLibrarySource(LIBRARY_ID, { type: "file", relativePath: "a.pdf" }),
      /不能访问|桌面版/,
    );
    await assert.rejects(
      () => browserBridge.upsertResearchLibrarySource(LIBRARY_ID, { type: "note", title: "旧笔记" }),
      /仅支持网页/,
    );
    await assert.rejects(
      () => browserBridge.upsertResearchLibrarySource(LIBRARY_ID, { type: "web", url: "file:///secret" }),
      /HTTP|HTTPS/,
    );
    await assert.rejects(
      () => browserBridge.upsertResearchLibrarySource(LIBRARY_ID, { type: "web", url: "https://user:pass@example.com" }),
      /账号信息/,
    );
  } finally {
    unsubscribe();
    delete globalThis.localStorage;
  }
});

test("browser preview persists a global nested web tree while refusing workspace binding", async () => {
  installMemoryStorage();
  try {
    const initial = await browserBridge.listResearchWebTree(LIBRARY_ID);
    assert.equal(initial.diskRevision, null);
    const folderState = await browserBridge.createResearchWebFolder(LIBRARY_ID, { name: "论文", scopeKey: "global" }, null);
    const folder = folderState.folders[0];
    const saved = await browserBridge.upsertResearchWebSource(
      LIBRARY_ID,
      { type: "web", title: "分组网页", url: "https://example.com/grouped" },
      { scopeKey: "global", folderId: folder.id },
      { source: null, tree: folderState.diskRevision },
    );
    assert.equal(saved.placementFallback, false);
    assert.equal(saved.tree.placements[saved.source.id].folderId, folder.id);
    const childState = await browserBridge.createResearchWebFolder(LIBRARY_ID, { name: "子组", parentId: folder.id, scopeKey: "global" }, saved.tree.diskRevision);
    const deleted = await browserBridge.deleteResearchWebFolder(LIBRARY_ID, folder.id, childState.diskRevision);
    assert.equal(deleted.folders[0].parentId, "");
    assert.equal(deleted.placements[saved.source.id].folderId, "");
    const identity = await browserBridge.getWorkspaceIdentity("C:\\private");
    assert.equal(identity.unsupported, true);
    assert.equal(Object.hasOwn(identity, "workspaceId"), false);
    const copy = await browserBridge.copyResearchWebSelection(LIBRARY_ID, { sourceIds: [saved.source.id] });
    assert.equal(copy.unsupported, true);
    assert.match(copy.message, /桌面版/);
  } finally {
    delete globalThis.localStorage;
  }
});
