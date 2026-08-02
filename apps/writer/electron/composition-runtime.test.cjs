const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { randomUUID } = require("node:crypto");
const { createCompositionJobStore } = require("./composition-job-store.cjs");
const {
  createCompositionRuntime,
  mergeLockedOutline,
  stripLeadingDuplicateSectionHeading,
} = require("./composition-runtime.cjs");

function waitForEvent(events, type, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const existing = events.find((event) => event.type === type);
    if (existing) return resolve(existing);
    const timer = setTimeout(() => reject(new Error(`missing event ${type}`)), timeoutMs);
    events.listeners.push((event) => {
      if (event.type !== type) return;
      clearTimeout(timer);
      resolve(event);
    });
  });
}

test("outline regeneration preserves locked chapters at their original positions", () => {
  const merged = mergeLockedOutline([
    { sectionId: "opening", title: "开篇", locked: false },
    { sectionId: "method", title: "固定方法", summary: "不能改", targetWords: 800, locked: true },
    { sectionId: "ending", title: "结尾", locked: false },
  ], [
    { sectionId: "new-opening", title: "新开篇" },
    { sectionId: "generated-method", title: "固定方法" },
    { sectionId: "new-ending", title: "新结尾" },
  ]);
  assert.deepEqual(merged.map((section) => section.sectionId), [
    "new-opening",
    "method",
    "new-ending",
  ]);
  assert.equal(merged[1].summary, "不能改");
  assert.equal(merged[1].locked, true);
});

test("duplicate model-authored section headings are removed before full-draft assembly", () => {
  assert.equal(
    stripLeadingDuplicateSectionHeading(
      "## 星移五载，魂坠当代\n\n诸葛亮醒来时，已卧在异乡的旷野上。",
      "星移五载，魂坠当代",
    ),
    "诸葛亮醒来时，已卧在异乡的旷野上。",
  );
  assert.equal(
    stripLeadingDuplicateSectionHeading(
      "### 2. 归去来兮：携策而返 ###\n\n那一夜，长安城的灯火渐渐熄灭。",
      "归去来兮：携策而返",
    ),
    "那一夜，长安城的灯火渐渐熄灭。",
  );
  assert.equal(
    stripLeadingDuplicateSectionHeading(
      "正文第一句恰好提及星移五载，魂坠当代，但不是标题。",
      "星移五载，魂坠当代",
    ),
    "正文第一句恰好提及星移五载，魂坠当代，但不是标题。",
  );
});

test("composition runtime repairs one outline, drafts sequentially, reviews, and finalizes a derived document", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jianjian-composition-runtime-"));
  const store = createCompositionJobStore({
    fs,
    path,
    getUserDataPath: () => root,
    atomicWriteFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    randomUUID,
  });
  const events = [];
  events.listeners = [];
  let outlineCalls = 0;
  const assignmentsSeen = [];
  const runtime = createCompositionRuntime({
    store,
    checkpointIntervalMs: 1,
    resolveModelAssignments: async () => ({
      composeOutline: { providerId: "frozen-provider", modelId: "outline-model" },
      composeDraft: { providerId: "frozen-provider", modelId: "draft-model" },
      composeReview: { providerId: "frozen-provider", modelId: "review-model" },
    }),
    completeTask: async ({ taskKey, modelAssignment, onDelta }) => {
      assignmentsSeen.push([taskKey, modelAssignment]);
      if (taskKey === "composeOutline") {
        outlineCalls += 1;
        if (outlineCalls === 1) {
          return {
            text: JSON.stringify({
              documentTitle: "这是一段超过二十四个字符并会被模型错误照搬的写作要求",
              sections: [{
                sectionId: "opening",
                title: "开篇",
                summary: "说明问题",
                targetWords: 500,
              }],
            }),
          };
        }
        return {
          text: JSON.stringify({
            documentTitle: "AI 重新拟定的文章标题",
            sections: [{
              sectionId: "opening",
              title: "开篇",
              summary: "说明问题",
              targetWords: 500,
            }],
          }),
          usage: { totalTokens: 20 },
          model: { providerId: "provider", modelId: "model" },
        };
      }
      if (taskKey === "composeDraft") {
        onDelta("这是正文");
        onDelta(" [[cite:source-1]]");
        return { text: "", usage: { totalTokens: 30 } };
      }
      if (taskKey === "composeReview") {
        return {
          text: JSON.stringify({
            reports: [{
              kind: "general",
              severity: "info",
              sectionId: "opening",
              title: "结构完整",
              detail: "未发现章节遗漏",
              suggestion: "可直接落稿",
            }],
          }),
          usage: { totalTokens: 10 },
        };
      }
      throw new Error("unexpected task");
    },
    finalizeDocument: async ({ markdown, job, onIntent }) => {
      assert.match(markdown, /人工修订正文/);
      assert.equal(job.derivedFrom.documentId, "source-document");
      await onIntent({
        path: "C:\\docs\\派生稿.letterpaper",
        documentId: "derived-document",
        preparedAt: "2026-07-29T00:00:00.000Z",
      });
      return { path: "C:\\docs\\派生稿.letterpaper", documentId: "derived-document" };
    },
    emitEvent: (_sender, event) => {
      events.push(event);
      for (const listener of events.listeners) listener(event);
    },
  });
  try {
    let job = await runtime.create({
      brief: { topic: "这是一段超过二十四个字符并会被模型错误照搬的写作要求", targetWords: 1000 },
      sourceSnapshots: [{ sourceId: "source-1", content: "可信资料" }],
      derivedFrom: { documentId: "source-document", revision: "rev-1" },
    });
    assert.equal(job.modelAssignments.composeDraft.modelId, "draft-model");
    await runtime.generateOutline({}, { jobId: job.jobId, expectedRevision: job.revision });
    job = (await waitForEvent(events, "outline-complete")).job;
    assert.equal(outlineCalls, 2);
    assert.equal(job.status, "outline-review");
    assert.equal(job.generatedTitle, "AI 重新拟定的文章标题");

    await runtime.resume({}, { jobId: job.jobId });
    job = (await waitForEvent(events, "drafting-complete")).job;
    assert.equal(job.sections[0].status, "draft");
    assert.equal(job.sections[0].citations[0].verified, true);
    job = await runtime.update({
      jobId: job.jobId,
      expectedRevision: job.revision,
      action: "section-draft",
      sectionId: "opening",
      draft: "人工修订正文 [[cite:source-1]]",
    });
    assert.equal(job.sections[0].draft, "人工修订正文 [[cite:source-1]]");
    assert.match(job.sections[0].alternatives[0].draft, /这是正文/);

    await assert.rejects(
      runtime.finalize({}, { jobId: job.jobId, expectedRevision: job.revision }),
      /全局一致性与引用检查/,
    );
    await runtime.review({}, { jobId: job.jobId, expectedRevision: job.revision });
    job = (await waitForEvent(events, "review-complete")).job;
    assert.equal(job.reviewReports[0].title, "结构完整");

    await runtime.finalize({}, { jobId: job.jobId, expectedRevision: job.revision });
    job = (await waitForEvent(events, "complete")).job;
    assert.equal(job.status, "complete");
    assert.equal(job.outputDocumentId, "derived-document");
    assert.equal(job.outputIntent, null);
    assert.equal(job.usage.totalTokens, 60);
    assert.ok(assignmentsSeen
      .filter(([taskKey]) => taskKey === "composeOutline")
      .every(([, assignment]) => assignment.modelId === "outline-model"));
    assert.equal(
      assignmentsSeen.find(([taskKey]) => taskKey === "composeDraft")[1].modelId,
      "draft-model",
    );
    assert.equal(
      assignmentsSeen.find(([taskKey]) => taskKey === "composeReview")[1].modelId,
      "review-model",
    );
  } finally {
    await runtime.abortAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("resume preserves completed drafts and only generates unfinished sections", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jianjian-composition-resume-"));
  const store = createCompositionJobStore({
    fs,
    path,
    getUserDataPath: () => root,
    atomicWriteFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    randomUUID,
  });
  const events = [];
  events.listeners = [];
  let draftCalls = 0;
  const runtime = createCompositionRuntime({
    store,
    checkpointIntervalMs: 1,
    completeTask: async ({ taskKey, onDelta }) => {
      assert.equal(taskKey, "composeDraft");
      draftCalls += 1;
      onDelta("第二节新稿");
      return { text: "" };
    },
    finalizeDocument: async () => ({}),
    emitEvent: (_sender, event) => {
      events.push(event);
      for (const listener of events.listeners) listener(event);
    },
  });
  try {
    let job = await runtime.create({
      brief: { topic: "恢复测试" },
      outline: [
        { sectionId: "done", title: "已完成" },
        { sectionId: "pending", title: "待完成" },
      ],
    });
    job = await store.mutate(job.jobId, (current) => ({
      status: "paused",
      sections: current.sections.map((section) => (
        section.sectionId === "done"
          ? { ...section, status: "draft", draft: "第一节原稿" }
          : section
      )),
    }));
    await runtime.resume({}, { jobId: job.jobId });
    const completed = (await waitForEvent(events, "drafting-complete")).job;
    assert.equal(draftCalls, 1);
    assert.equal(completed.sections[0].draft, "第一节原稿");
    assert.equal(completed.sections[0].alternatives.length, 0);
    assert.equal(completed.sections[1].draft, "第二节新稿");
  } finally {
    await runtime.abortAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("generation errors publish the latest revision so a failed section can retry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jianjian-composition-retry-"));
  const store = createCompositionJobStore({
    fs,
    path,
    getUserDataPath: () => root,
    atomicWriteFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    randomUUID,
  });
  const events = [];
  events.listeners = [];
  let attempts = 0;
  const runtime = createCompositionRuntime({
    store,
    checkpointIntervalMs: 1,
    completeTask: async ({ onDelta }) => {
      attempts += 1;
      onDelta(attempts === 1 ? "中断前正文" : "重试成功");
      if (attempts === 1) throw new Error("模型暂时不可用");
      return { text: "" };
    },
    finalizeDocument: async () => ({}),
    emitEvent: (_sender, event) => {
      events.push(event);
      for (const listener of events.listeners) listener(event);
    },
  });
  try {
    const job = await runtime.create({
      brief: { topic: "失败重试" },
      outline: [{ sectionId: "one", title: "第一节" }],
    });
    await runtime.generateSection({}, {
      jobId: job.jobId,
      sectionId: "one",
      expectedRevision: job.revision,
    });
    const failed = await waitForEvent(events, "error");
    assert.equal(failed.job.status, "error");
    assert.equal(failed.job.sections[0].status, "error");
    assert.match(failed.job.sections[0].draft, /中断前正文/);

    await runtime.generateSection({}, {
      jobId: job.jobId,
      sectionId: "one",
      expectedRevision: failed.job.revision,
    });
    const retried = (await waitForEvent(events, "section-complete")).job;
    assert.equal(retried.sections[0].draft, "重试成功");
    assert.equal(retried.sections[0].status, "draft");
  } finally {
    await runtime.abortAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("pause flushes the latest streamed tail before marking a section interrupted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jianjian-composition-pause-"));
  const store = createCompositionJobStore({
    fs,
    path,
    getUserDataPath: () => root,
    atomicWriteFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    randomUUID,
  });
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const runtime = createCompositionRuntime({
    store,
    checkpointIntervalMs: 60_000,
    completeTask: ({ signal, onDelta }) => new Promise((_resolve, reject) => {
      onDelta("尚未到定时检查点的尾块");
      markStarted();
      signal.addEventListener("abort", () => reject(signal.reason || new Error("aborted")), { once: true });
    }),
    finalizeDocument: async () => ({}),
  });
  try {
    const job = await runtime.create({
      brief: { topic: "暂停测试" },
      outline: [{ sectionId: "one", title: "第一节" }],
    });
    await runtime.generateSection({}, {
      jobId: job.jobId,
      sectionId: "one",
      expectedRevision: job.revision,
    });
    await started;
    const paused = await runtime.pause(job.jobId);
    assert.equal(paused.status, "paused");
    assert.equal(paused.sections[0].status, "interrupted");
    assert.equal(paused.sections[0].draft, "尚未到定时检查点的尾块");
  } finally {
    await runtime.abortAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("final document intent is durable before the non-cancelable commit boundary", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jianjian-composition-commit-"));
  const store = createCompositionJobStore({
    fs,
    path,
    getUserDataPath: () => root,
    atomicWriteFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    randomUUID,
  });
  const events = [];
  events.listeners = [];
  let beginCommit;
  const commitStarted = new Promise((resolve) => {
    beginCommit = resolve;
  });
  let finishCommit;
  const commitGate = new Promise((resolve) => {
    finishCommit = resolve;
  });
  const runtime = createCompositionRuntime({
    store,
    completeTask: async () => ({ text: "" }),
    finalizeDocument: async ({ signal, job, onIntent }) => {
      assert.equal(signal.aborted, false);
      await onIntent({
        path: "C:\\docs\\派生稿.letterpaper",
        documentId: "derived-document",
        preparedAt: "2026-07-29T00:00:00.000Z",
      });
      const prepared = await store.get(job.jobId);
      assert.equal(prepared.status, "finalizing");
      assert.equal(prepared.outputIntent.documentId, "derived-document");
      beginCommit();
      await commitGate;
      assert.equal(signal.aborted, false);
      return { path: "C:\\docs\\派生稿.letterpaper", documentId: "derived-document" };
    },
    emitEvent: (_sender, event) => {
      events.push(event);
      for (const listener of events.listeners) listener(event);
    },
  });
  try {
    let job = await runtime.create({
      brief: { topic: "落稿竞态" },
      outline: [{ sectionId: "one", title: "第一节" }],
    });
    job = await store.mutate(job.jobId, (current) => ({
      status: "review",
      reviewedAt: "2026-07-29T00:00:00.000Z",
      sections: current.sections.map((section) => ({
        ...section,
        status: "draft",
        draft: "已审阅正文",
      })),
    }));
    await runtime.finalize({}, {
      jobId: job.jobId,
      expectedRevision: job.revision,
    });
    await commitStarted;
    const pauseResult = runtime.pause(job.jobId);
    const completeEvent = waitForEvent(events, "complete");
    finishCommit();
    const completed = (await completeEvent).job;
    const afterPause = await pauseResult;
    assert.equal(completed.status, "complete");
    assert.equal(afterPause.status, "complete");
    assert.equal(afterPause.outputDocumentId, "derived-document");
    assert.equal(afterPause.outputIntent, null);
  } finally {
    await runtime.abortAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a post-commit finalizer failure reconciles the durable intent instead of orphaning output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jianjian-composition-reconcile-"));
  const store = createCompositionJobStore({
    fs,
    path,
    getUserDataPath: () => root,
    atomicWriteFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    randomUUID,
  });
  const events = [];
  events.listeners = [];
  const runtime = createCompositionRuntime({
    store,
    completeTask: async () => ({ text: "" }),
    finalizeDocument: async ({ onIntent }) => {
      await onIntent({
        path: "C:\\docs\\已落盘.letterpaper",
        documentId: "derived-after-error",
        preparedAt: "2026-07-29T00:00:00.000Z",
      });
      throw new Error("提交后的授权刷新失败");
    },
    reconcileOutputIntent: async (intent) => ({
      state: "committed",
      path: intent.path,
      documentId: intent.documentId,
    }),
    emitEvent: (_sender, event) => {
      events.push(event);
      for (const listener of events.listeners) listener(event);
    },
  });
  try {
    let job = await runtime.create({
      brief: { topic: "提交后对账" },
      outline: [{ sectionId: "one", title: "第一节" }],
    });
    job = await store.mutate(job.jobId, (current) => ({
      status: "review",
      reviewedAt: "2026-07-29T00:00:00.000Z",
      sections: current.sections.map((section) => ({
        ...section,
        status: "draft",
        draft: "已审阅正文",
      })),
    }));
    await runtime.finalize({}, {
      jobId: job.jobId,
      expectedRevision: job.revision,
    });
    const completed = (await waitForEvent(events, "complete")).job;
    assert.equal(completed.status, "complete");
    assert.equal(completed.outputDocumentId, "derived-after-error");
    assert.equal(completed.outputIntent, null);
    assert.equal(events.some((event) => event.type === "error"), false);
  } finally {
    await runtime.abortAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("re-editing brief and sources preserves drafts but invalidates acceptance and review", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jianjian-composition-rebrief-"));
  const store = createCompositionJobStore({
    fs,
    path,
    getUserDataPath: () => root,
    atomicWriteFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    randomUUID,
  });
  const runtime = createCompositionRuntime({
    store,
    completeTask: async () => ({ text: "" }),
    finalizeDocument: async () => ({}),
  });
  try {
    let job = await runtime.create({
      brief: { topic: "旧主题" },
      sourceSnapshots: [{ sourceId: "old-source", content: "旧资料" }],
      outline: [{ sectionId: "one", title: "第一节" }],
    });
    job = await store.mutate(job.jobId, (current) => ({
      status: "review",
      reviewedAt: "2026-07-29T00:00:00.000Z",
      reviewReports: [{
        id: "review-1",
        kind: "general",
        severity: "info",
        title: "旧检查",
        detail: "旧结果",
        suggestion: "",
      }],
      sections: current.sections.map((section) => ({
        ...section,
        status: "accepted",
        draft: "人工草稿",
        acceptedDraft: "已接受正文",
        citations: [{ sourceId: "old-source", verified: true }],
      })),
    }));

    const updated = await runtime.update({
      jobId: job.jobId,
      expectedRevision: job.revision,
      action: "brief",
      brief: { topic: "新主题", targetWords: 3000 },
      constraints: "新约束",
      sourceSnapshots: [{ sourceId: "new-source", content: "新资料" }],
    });

    assert.equal(updated.status, "outline-review");
    assert.equal(updated.brief.topic, "新主题");
    assert.deepEqual(updated.sourceSnapshots.map((source) => source.sourceId), ["new-source"]);
    assert.match(updated.sourceSnapshots[0].contentHash, /^[a-f0-9]{64}$/);
    assert.equal(updated.sections[0].status, "draft");
    assert.equal(updated.sections[0].draft, "已接受正文");
    assert.equal(updated.sections[0].acceptedDraft, "");
    assert.deepEqual(updated.sections[0].citations, []);
    assert.deepEqual(updated.reviewReports, []);
    assert.equal(updated.reviewedAt, "");
  } finally {
    await runtime.abortAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("an indeterminate output intent freezes task mutation, cancellation, and deletion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jianjian-composition-frozen-intent-"));
  const store = createCompositionJobStore({
    fs,
    path,
    getUserDataPath: () => root,
    atomicWriteFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    randomUUID,
  });
  const runtime = createCompositionRuntime({
    store,
    completeTask: async () => ({ text: "" }),
    finalizeDocument: async () => ({}),
  });
  try {
    let job = await runtime.create({
      brief: { topic: "待对账任务" },
      outline: [{ sectionId: "one", title: "第一节" }],
    });
    job = await store.mutate(job.jobId, {
      status: "paused",
      outputIntent: {
        path: "C:\\docs\\待对账.letterpaper",
        documentId: "derived-pending-check",
        preparedAt: "2026-07-29T00:00:00.000Z",
      },
    });
    await assert.rejects(runtime.update({
      jobId: job.jobId,
      expectedRevision: job.revision,
      action: "brief",
      brief: { topic: "不得修改" },
    }), /尚未确认/);
    await assert.rejects(runtime.generateSection({}, {
      jobId: job.jobId,
      sectionId: "one",
      expectedRevision: job.revision,
    }), /尚未确认/);
    await assert.rejects(runtime.cancel(job.jobId), /状态确认前不能取消/);
    await assert.rejects(runtime.delete(job.jobId), /状态确认前不能删除/);
    assert.equal((await runtime.get(job.jobId)).outputIntent.documentId, "derived-pending-check");
  } finally {
    await runtime.abortAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});
