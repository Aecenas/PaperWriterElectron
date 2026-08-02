const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const { createCompositionJobStore } = require("./composition-job-store.cjs");

async function withStore(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jianjian-composition-"));
  const store = createCompositionJobStore({
    fs,
    path,
    getUserDataPath: () => root,
    atomicWriteFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    randomUUID,
    now: () => new Date("2026-07-29T10:00:00.000Z"),
  });
  try {
    await callback(store, root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("composition job store persists revision-checked atomic jobs outside documents", async () => {
  await withStore(async (store, root) => {
    const created = await store.create({
      brief: { topic: "一篇文章" },
      sourceSnapshots: [{ sourceId: "source-1", content: "资料快照" }],
    });
    assert.equal(created.revision, 1);
    assert.equal(created.status, "brief");
    assert.match(root, /jianjian-composition-/);
    const updated = await store.mutate(created.jobId, { status: "outline-running" }, 1);
    assert.equal(updated.revision, 2);
    await assert.rejects(
      store.mutate(created.jobId, { status: "paused" }, 1),
      (error) => error.code === "COMPOSITION_REVISION_CONFLICT",
    );
    assert.equal((await store.list())[0].jobId, created.jobId);
  });
});

test("startup recovery marks running sections interrupted without losing partial text", async () => {
  await withStore(async (store) => {
    const created = await store.create({
      brief: { topic: "恢复任务" },
      outline: [{ sectionId: "one", title: "第一节" }],
    });
    assert.equal(created.status, "outline-review");
    await store.mutate(created.jobId, (job) => ({
      status: "drafting",
      activeSectionId: "one",
      sections: job.sections.map((section) => ({
        ...section,
        status: "running",
        draft: "已生成的部分",
      })),
    }));
    const recovered = await store.recoverInterrupted();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].status, "paused");
    assert.equal(recovered[0].sections[0].status, "interrupted");
    assert.equal(recovered[0].sections[0].draft, "已生成的部分");
  });
});

test("startup recovery reconciles persisted output intents before interrupting finalization", async () => {
  await withStore(async (store) => {
    const committed = await store.create({
      brief: { topic: "已提交派生稿" },
      outline: [{ sectionId: "one", title: "第一节" }],
    });
    await store.mutate(committed.jobId, {
      status: "finalizing",
      outputIntent: {
        path: "C:\\docs\\已提交.letterpaper",
        documentId: "derived-committed",
        preparedAt: "2026-07-29T09:59:00.000Z",
      },
    });
    const missing = await store.create({
      brief: { topic: "未提交派生稿" },
      outline: [{ sectionId: "one", title: "第一节" }],
    });
    await store.mutate(missing.jobId, {
      status: "finalizing",
      outputIntent: {
        path: "C:\\docs\\未提交.letterpaper",
        documentId: "derived-missing",
        preparedAt: "2026-07-29T09:59:30.000Z",
      },
    });
    const indeterminate = await store.create({
      brief: { topic: "待确认派生稿" },
      outline: [{ sectionId: "one", title: "第一节" }],
    });
    await store.mutate(indeterminate.jobId, {
      status: "finalizing",
      outputIntent: {
        path: "C:\\docs\\待确认.letterpaper",
        documentId: "derived-indeterminate",
        preparedAt: "2026-07-29T09:59:45.000Z",
      },
    });

    const recovered = await store.recoverInterrupted({
      reconcileOutputIntent: async (intent) => {
        if (intent.documentId === "derived-committed") {
          return {
            state: "committed",
            path: intent.path,
            documentId: intent.documentId,
          };
        }
        if (intent.documentId === "derived-indeterminate") {
          return { state: "indeterminate", error: "暂时无法读取派生文件" };
        }
        return { state: "missing" };
      },
    });

    assert.equal(recovered.length, 3);
    const committedAfter = await store.get(committed.jobId);
    assert.equal(committedAfter.status, "complete");
    assert.equal(committedAfter.outputDocumentId, "derived-committed");
    assert.equal(committedAfter.outputIntent, null);
    const missingAfter = await store.get(missing.jobId);
    assert.equal(missingAfter.status, "paused");
    assert.equal(missingAfter.outputIntent, null);
    const indeterminateAfter = await store.get(indeterminate.jobId);
    assert.equal(indeterminateAfter.status, "paused");
    assert.equal(
      indeterminateAfter.outputIntent.documentId,
      "derived-indeterminate",
    );
    assert.match(indeterminateAfter.error, /暂时无法读取/);
  });
});
