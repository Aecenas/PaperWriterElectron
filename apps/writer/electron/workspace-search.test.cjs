const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const JSZip = require("jszip");
const {
  createSearchRecord,
  createWorkspaceSearchIndex,
  htmlToSearchText,
  isWorkspaceRelationshipCandidate,
  readSearchDocument,
  searchWorkspaceRecords,
  walkWorkspaceDocuments,
} = require("./workspace-search.cjs");

test("relationship candidates with missing identities are excluded only by current path", () => {
  const options = {
    currentDocumentId: "",
    currentPath: "C:\\写作\\当前.letterpaper",
    pathApi: path.win32,
    platform: "win32",
  };
  assert.equal(isWorkspaceRelationshipCandidate({ path: "c:/写作/当前.letterpaper", documentId: "" }, options), false);
  assert.equal(isWorkspaceRelationshipCandidate({ path: "C:\\写作\\子目录\\旧稿.letterpaper", documentId: "" }, options), true);
  assert.equal(isWorkspaceRelationshipCandidate({ path: "C:\\写作\\新稿.letterpaper", documentId: "same-id" }, {
    ...options,
    currentDocumentId: "same-id",
  }), false);
});

async function writePaper(filePath, document, { assetText = "", extensionEntries = [] } = {}) {
  const zip = new JSZip();
  zip.file("document.json", JSON.stringify(document), { compression: "STORE" });
  if (assetText) zip.file("assets/secret.txt", assetText, { compression: "STORE" });
  for (const [name, value] of extensionEntries) zip.file(name, value, { compression: "STORE" });
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

test("converts formatted HTML into searchable text across inline marks", () => {
  assert.equal(
    htmlToSearchText("<h1>研究</h1><p>跨<strong>格式</strong>中文 &amp; English</p><script>秘密</script>"),
    "研究\n跨格式中文 & English",
  );
  assert.throws(() => createWorkspaceSearchIndex(), /缺少工作区路径/);
});

test("recursively indexes only supported paper archives and searches Chinese literally", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-search-"));
  const cachePath = path.join(os.tmpdir(), `paperwriter-search-${Date.now()}.json`);
  try {
    await writePaper(path.join(directory, "甲.letterpaper"), {
      title: "乡土研究",
      author: "王明",
      html: "<p>跨<strong>格式</strong>中文匹配</p>",
      aiState: { chat: { messages: [{ content: "不应搜索" }] } },
    }, { assetText: "附件秘密" });
    await writePaper(path.join(directory, "子目录", "乙.paperdoc"), {
      title: "旧稿",
      author: "李华",
      html: "<p>另一段正文</p>",
    });
    await fs.writeFile(path.join(directory, "忽略.txt"), "跨格式中文匹配", "utf8");

    const index = createWorkspaceSearchIndex({ rootPath: directory, cachePath });
    const initialized = await index.initialize();
    assert.equal(initialized.total, 2);

    const body = await index.search("跨格式中文", { requestId: "body" });
    assert.equal(body.canceled, false);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].matchField, "body");
    assert.equal(body.results[0].snippet.slice(body.results[0].snippetMatchStart, body.results[0].snippetMatchStart + body.results[0].snippetMatchLength), "跨格式中文");

    assert.equal((await index.search("附件秘密")).results.length, 0);
    assert.equal((await index.search("不应搜索")).results.length, 0);
    assert.equal((await index.search("王明")).results[0].matchField, "author");
    assert.match((await index.search("另一段正文")).results[0].relativePath, /子目录/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(cachePath, { force: true });
  }
});

test("uses the cache for unchanged files and refreshes changed and deleted documents", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-cache-"));
  const cachePath = path.join(os.tmpdir(), `paperwriter-cache-${Date.now()}.json`);
  const target = path.join(directory, "缓存.letterpaper");
  let reads = 0;
  const countedReader = async (...args) => {
    reads += 1;
    return readSearchDocument(...args);
  };
  try {
    await writePaper(target, { title: "缓存", html: "<p>第一版内容</p>" });
    const firstIndex = createWorkspaceSearchIndex({ rootPath: directory, cachePath, readDocument: countedReader });
    await firstIndex.initialize();
    assert.equal(reads, 1);

    const secondIndex = createWorkspaceSearchIndex({ rootPath: directory, cachePath, readDocument: countedReader });
    const secondRefresh = await secondIndex.initialize();
    assert.equal(secondRefresh.reused, 1);
    assert.equal(reads, 1);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await writePaper(target, { title: "缓存", html: "<p>第二版内容更长</p>" });
    const changed = await secondIndex.refresh();
    assert.equal(changed.indexed, 1);
    assert.equal(reads, 2);
    assert.equal((await secondIndex.search("第二版")).results.length, 1);

    await fs.rm(target);
    const deleted = await secondIndex.refresh();
    assert.equal(deleted.total, 0);
    assert.equal((await secondIndex.search("第二版")).results.length, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(cachePath, { force: true });
  }
});

test("open unsaved documents override the disk index without expanding workspace scope", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-overlay-"));
  const target = path.join(directory, "覆盖.letterpaper");
  try {
    await writePaper(target, { title: "覆盖", html: "<p>磁盘内容</p>" });
    const index = createWorkspaceSearchIndex({ rootPath: directory });
    await index.initialize();
    const override = [{ path: target, document: { title: "覆盖", html: "<p>未保存的新内容</p>" } }];
    assert.equal((await index.search("磁盘内容", { overrides: override })).results.length, 0);
    assert.equal((await index.search("新内容", { overrides: override })).results.length, 1);
    const outside = [{ path: path.join(os.tmpdir(), "外部.letterpaper"), document: { html: "<p>范围外秘密</p>" } }];
    assert.equal((await index.search("范围外秘密", { overrides: outside })).results.length, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("limits results and returns bounded snippets", async () => {
  const records = Array.from({ length: 5 }, (_, index) => createSearchRecord(
    path.win32.join("C:\\写作", `${index}.letterpaper`),
    { title: `标题 ${index}`, html: `<p>${"前".repeat(100)}命中词${"后".repeat(100)}</p>` },
    { size: 1, mtimeMs: index + 1 },
    { rootPath: "C:\\写作", pathApi: path.win32, platform: "win32", limits: { maxSnippetCharacters: 40 } },
  ));
  const result = await searchWorkspaceRecords(records, "命中词", {
    requestId: "limited",
    limit: 2,
    limits: { maxResults: 2, maxSnippetCharacters: 40 },
  });
  assert.equal(result.results.length, 2);
  assert.equal(result.totalMatches, 5);
  assert.equal(result.limited, true);
  assert.ok(result.results.every((item) => item.snippet.length <= 42));
});

test("a newer request id cancels an older in-flight search", async () => {
  const records = Array.from({ length: 250 }, (_, index) => ({
    path: `${index}.letterpaper`, relativePath: `${index}.letterpaper`, fileName: `${index}.letterpaper`, displayName: `${index}`,
    title: "", author: "", body: "共同查询", updatedAt: "", size: 1, truncated: false,
  }));
  let canceled = false;
  setImmediate(() => { canceled = true; });
  const result = await searchWorkspaceRecords(records, "共同查询", {
    requestId: "old-request",
    limits: { searchYieldEvery: 1 },
    isCanceled: () => canceled,
  });
  assert.equal(result.canceled, true);
  assert.deepEqual(result.results, []);
});

test("does not traverse directory links outside the workspace", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-link-root-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-link-outside-"));
  try {
    await writePaper(path.join(outside, "秘密.letterpaper"), { html: "<p>外部秘密</p>" });
    try {
      await fs.symlink(outside, path.join(directory, "外部链接"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        t.skip(`当前环境不能创建目录链接：${error.code}`);
        return;
      }
      throw error;
    }
    const walked = await walkWorkspaceDocuments(directory);
    assert.deepEqual(walked.documents, []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("rejects unexpected ZIP entries while extracting no asset content", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-unsafe-"));
  const target = path.join(directory, "不安全.letterpaper");
  try {
    await writePaper(target, { html: "<p>正文</p>" }, { extensionEntries: [["metadata/private.txt", "秘密"]] });
    await assert.rejects(() => readSearchDocument(target), /不受支持的压缩包条目/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
