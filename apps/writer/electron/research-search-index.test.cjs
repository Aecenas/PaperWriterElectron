const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const test = require("node:test");

const { atomicWriteFile } = require("./document-storage.cjs");
const {
  createResearchSearchManager,
} = require("./research-search-index.cjs");

function createLibraryHarness(rootPath) {
  const state = {
    pdfMtime: 100,
    pdfBody: "第一页内容\n第二页研究方法",
    extractCalls: [],
    failPaths: new Set(),
  };
  const library = {
    getRoot() {
      return {
        configured: true,
        available: true,
        libraryId: "library-1",
        rootPath,
      };
    },
    async listFolder(libraryId, relativePath) {
      assert.equal(libraryId, "library-1");
      if (!relativePath) {
        return {
          entries: [
            {
              kind: "folder",
              name: "论文",
              relativePath: "论文",
            },
            {
              kind: "file",
              name: "孤立资料.txt",
              relativePath: "孤立资料.txt",
              previewKind: "text",
              size: 10,
              mtimeMs: 10,
            },
          ],
        };
      }
      if (relativePath === "论文") {
        return {
          entries: [
            {
              kind: "file",
              name: "方法.pdf",
              relativePath: "论文/方法.pdf",
              previewKind: "pdf",
              size: 100,
              mtimeMs: state.pdfMtime,
            },
            {
              kind: "file",
              name: "笔记.md",
              relativePath: "论文/笔记.md",
              previewKind: "markdown",
              size: 20,
              mtimeMs: 20,
            },
          ],
        };
      }
      throw new Error("unexpected folder");
    },
    async listSources() {
      return {
        sources: [
          {
            id: "file-source-01",
            type: "file",
            title: "稳定笔记标题",
            relativePath: "论文/笔记.md",
            excerpt: "方法论摘录",
            notes: "文件来源备注",
            updatedAt: "2026-07-20T00:00:00.000Z",
            diskRevision: {
              size: 1,
              mtimeMs: 1,
              sha256: "a".repeat(64),
            },
            bibliographic: {
              authors: ["甲", "乙"],
              year: "2026",
            },
          },
          {
            id: "global-web-01",
            type: "web",
            title: "研究方法公区网页",
            url: "https://example.com/global",
            excerpt: "公区摘录",
            notes: "",
            updatedAt: "2026-07-21T00:00:00.000Z",
            bibliographic: {},
          },
          {
            id: "private-web-01",
            type: "web",
            title: "研究方法私区网页",
            url: "https://example.com/private",
            excerpt: "私区摘录",
            notes: "",
            updatedAt: "2026-07-22T00:00:00.000Z",
            bibliographic: {},
          },
          {
            id: "unplaced-web-01",
            type: "web",
            title: "未放置的私密网页",
            url: "https://example.com/unplaced",
            excerpt: "",
            notes: "",
            updatedAt: "2026-07-23T00:00:00.000Z",
            bibliographic: {},
          },
        ],
      };
    },
    async listWebTree() {
      return {
        placements: {
          "global-web-01": {
            scopeKey: "global",
            folderId: "",
          },
          "private-web-01": {
            scopeKey: "workspace:11111111-1111-4111-8111-111111111111",
            folderId: "private-folder",
          },
        },
      };
    },
  };
  const extractFile = async (_libraryId, entry) => {
    state.extractCalls.push(entry.relativePath);
    if (state.failPaths.has(entry.relativePath)) {
      throw new Error(`无法解析 C:\\Private\\${entry.relativePath}`);
    }
    if (entry.previewKind === "pdf") {
      return {
        body: state.pdfBody,
        pages: [
          { page: 1, start: 0, end: 5 },
          {
            page: 2,
            start: 6,
            end: state.pdfBody.length,
          },
        ],
        truncated: false,
      };
    }
    if (entry.relativePath === "论文/笔记.md") {
      return {
        body: "正文中的研究方法",
        pages: [],
        truncated: false,
      };
    }
    return {
      body: "没有稳定来源标识也可以搜索",
      pages: [],
      truncated: false,
    };
  };
  return { extractFile, library, state };
}

async function createTemporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "research-search-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

test("research index searches physical files plus public/current-private web metadata and maps PDF pages", async (t) => {
  const rootPath = await createTemporaryRoot(t);
  const harness = createLibraryHarness(rootPath);
  const manager = createResearchSearchManager({
    library: harness.library,
    userDataPath: path.join(rootPath, "user-data"),
    extractFile: harness.extractFile,
    atomicWriteFile,
    limits: {
      extractionConcurrency: 1,
    },
  });

  const publicOnly = await manager.search({
    libraryId: "library-1",
    requestId: "public-search",
    query: "研究方法",
    scopeKey: "global",
    limit: 20,
  });
  assert.equal(publicOnly.canceled, false);
  assert.deepEqual(
    publicOnly.results.filter((result) => result.kind === "web")
      .map((result) => result.sourceId),
    ["global-web-01"],
  );
  const pdf = publicOnly.results.find(
    (result) => result.relativePath === "论文/方法.pdf",
  );
  assert.equal(pdf.page, 2);
  assert.equal(pdf.matchField, "body");

  const hiddenWebMetadata = await manager.search({
    libraryId: "library-1",
    requestId: "hidden-web-metadata",
    query: "公区摘录",
    scopeKey: "global",
  });
  assert.equal(
    hiddenWebMetadata.results.some((result) => result.kind === "web"),
    false,
  );
  const unplacedWeb = await manager.search({
    libraryId: "library-1",
    requestId: "unplaced-web",
    query: "未放置的私密网页",
    scopeKey: "global",
  });
  assert.equal(unplacedWeb.results.length, 0);

  const withPrivate = await manager.search({
    libraryId: "library-1",
    requestId: "private-search",
    query: "研究方法",
    scopeKey: "global",
    workspaceScopeKey: "workspace:11111111-1111-4111-8111-111111111111",
    limit: 20,
  });
  assert.deepEqual(
    withPrivate.results.filter((result) => result.kind === "web")
      .map((result) => result.sourceId).sort(),
    ["global-web-01", "private-web-01"],
  );

  const orphan = await manager.search({
    libraryId: "library-1",
    requestId: "orphan-search",
    query: "稳定来源标识",
  });
  assert.equal(orphan.results[0].relativePath, "孤立资料.txt");
  assert.equal("sourceId" in orphan.results[0], false);
  assert.equal(harness.state.extractCalls.length, 3);
  manager.shutdown();
});

test("research index reuses bounded cache and invalidation refreshes changed files", async (t) => {
  const rootPath = await createTemporaryRoot(t);
  const harness = createLibraryHarness(rootPath);
  const options = {
    library: harness.library,
    userDataPath: path.join(rootPath, "user-data"),
    extractFile: harness.extractFile,
    atomicWriteFile,
    limits: { extractionConcurrency: 1 },
  };
  const first = createResearchSearchManager(options);
  await first.search({
    libraryId: "library-1",
    requestId: "first",
    query: "研究方法",
  });
  assert.equal(harness.state.extractCalls.length, 3);
  first.shutdown();

  const second = createResearchSearchManager(options);
  await second.search({
    libraryId: "library-1",
    requestId: "cached",
    query: "研究方法",
  });
  assert.equal(harness.state.extractCalls.length, 3);

  harness.state.pdfBody = "变更后的独特内容";
  second.invalidate({ libraryId: "library-1", relativePath: "论文/方法.pdf" });
  const changed = await second.search({
    libraryId: "library-1",
    requestId: "changed",
    query: "独特内容",
  });
  assert.equal(changed.results[0].relativePath, "论文/方法.pdf");
  assert.equal(harness.state.extractCalls.length, 4);
  second.shutdown();
});

test("failed and total-budget-limited extraction keeps metadata searchable without leaking paths", async (t) => {
  const rootPath = await createTemporaryRoot(t);
  const harness = createLibraryHarness(rootPath);
  harness.state.failPaths.add("论文/方法.pdf");
  const progress = [];
  const manager = createResearchSearchManager({
    library: harness.library,
    userDataPath: path.join(rootPath, "user-data"),
    extractFile: harness.extractFile,
    atomicWriteFile,
    limits: {
      extractionConcurrency: 1,
      maxTotalIndexedCharacters: 5,
    },
  });

  const failed = await manager.search({
    libraryId: "library-1",
    requestId: "failed-metadata",
    query: "方法.pdf",
  }, {
    onProgress: (event) => progress.push(event),
  });
  const failedResult = failed.results.find(
    (result) => result.relativePath === "论文/方法.pdf",
  );
  assert.equal(failedResult.indexedTextSkipped, true);
  assert.equal(failedResult.indexWarning.includes("C:\\Private"), false);

  const budgetLimited = await manager.search({
    libraryId: "library-1",
    requestId: "budget-metadata",
    query: "孤立资料",
  });
  assert.equal(budgetLimited.results[0].indexedTextSkipped, true);
  assert.ok(budgetLimited.warnings.some(
    (warning) => warning.code === "INDEX_CHARACTER_BUDGET",
  ));

  const percents = progress
    .map((event) => event.percent)
    .filter((percent) => Number.isFinite(percent));
  assert.deepEqual(percents, [...percents].sort((left, right) => left - right));
  assert.equal(progress.every((event) => Number.isSafeInteger(event.indexGeneration)), true);
  assert.equal(progress.every((event) => (
    ["indexed", "reused", "skipped", "failed"].every(
      (field) => Number.isFinite(Number(event[field])),
    )
  )), true);
  manager.shutdown();
});

test("document traversal stops at the configured file cap and returns a warning instead of failing", async (t) => {
  const rootPath = await createTemporaryRoot(t);
  const harness = createLibraryHarness(rootPath);
  const manager = createResearchSearchManager({
    library: harness.library,
    userDataPath: path.join(rootPath, "user-data"),
    extractFile: harness.extractFile,
    atomicWriteFile,
    limits: {
      extractionConcurrency: 1,
      maxDocuments: 2,
    },
  });
  const result = await manager.search({
    libraryId: "library-1",
    requestId: "file-cap",
    query: "资料",
  });
  assert.equal(result.canceled, false);
  assert.ok(result.warnings.some((warning) => warning.code === "MAX_DOCUMENTS"));
  assert.ok(result.results.some((entry) => entry.relativePath === "孤立资料.txt"));
  manager.shutdown();
});

test("clearing a detached root deletes its prior-session derived cache without first opening an index", async (t) => {
  const rootPath = await createTemporaryRoot(t);
  const userDataPath = path.join(rootPath, "user-data");
  const cacheKey = createHash("sha256")
    .update(`library-1\u0000${path.resolve(rootPath)}`)
    .digest("hex");
  const cachePath = path.join(
    userDataPath,
    "research-search",
    `${cacheKey}.json`,
  );
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, "{}");
  const harness = createLibraryHarness(rootPath);
  const manager = createResearchSearchManager({
    library: harness.library,
    userDataPath,
    extractFile: harness.extractFile,
    atomicWriteFile,
  });
  await manager.clear({
    deleteCache: true,
    libraryId: "library-1",
    rootPath,
  });
  await assert.rejects(fs.stat(cachePath), (error) => error?.code === "ENOENT");
  manager.shutdown();
});

test("canceling a query detaches it without starving the shared initial build", async (t) => {
  const rootPath = await createTemporaryRoot(t);
  const harness = createLibraryHarness(rootPath);
  let releaseExtraction;
  let startedExtraction;
  const started = new Promise((resolve) => {
    startedExtraction = resolve;
  });
  const gate = new Promise((resolve) => {
    releaseExtraction = resolve;
  });
  const originalExtractor = harness.extractFile;
  let first = true;
  const manager = createResearchSearchManager({
    library: harness.library,
    userDataPath: path.join(rootPath, "user-data"),
    extractFile: async (...args) => {
      if (first) {
        first = false;
        startedExtraction();
        await gate;
      }
      return originalExtractor(...args);
    },
    atomicWriteFile,
    limits: { extractionConcurrency: 1 },
  });

  const canceledPromise = manager.search({
    libraryId: "library-1",
    requestId: "cancel-me",
    query: "研究方法",
  });
  await started;
  assert.equal(manager.cancel("library-1", "cancel-me"), true);
  const waitingPromise = manager.search({
    libraryId: "library-1",
    requestId: "keep-building",
    query: "研究方法",
  });
  assert.deepEqual(await canceledPromise, {
    requestId: "cancel-me",
    query: "研究方法",
    canceled: true,
    results: [],
    totalMatches: 0,
    limited: false,
  });
  releaseExtraction();
  const completed = await waitingPromise;
  assert.equal(completed.canceled, false);
  assert.ok(completed.results.length >= 1);
  manager.shutdown();
});

test("the shared build stops after its final waiter remains canceled beyond the debounce grace period", async (t) => {
  const rootPath = await createTemporaryRoot(t);
  const harness = createLibraryHarness(rootPath);
  let startedExtraction;
  const started = new Promise((resolve) => {
    startedExtraction = resolve;
  });
  let abortObserved = false;
  const manager = createResearchSearchManager({
    library: harness.library,
    userDataPath: path.join(rootPath, "user-data"),
    extractFile: async (_libraryId, _entry, { signal } = {}) => (
      new Promise((resolve, reject) => {
        startedExtraction();
        signal.addEventListener("abort", () => {
          abortObserved = true;
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      })
    ),
    atomicWriteFile,
    limits: { extractionConcurrency: 1 },
  });
  const pending = manager.search({
    libraryId: "library-1",
    requestId: "cancel-last-waiter",
    query: "研究",
  });
  await started;
  assert.equal(manager.cancel("library-1", "cancel-last-waiter"), true);
  assert.equal((await pending).canceled, true);
  await new Promise((resolve) => setTimeout(resolve, 425));
  assert.equal(abortObserved, true);
  manager.shutdown();
});
