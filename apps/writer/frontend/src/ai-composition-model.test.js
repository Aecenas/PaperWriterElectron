import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSITION_DRAFT_STORAGE_KEY,
  compositionStepForJob,
  createSourceSnapshots,
  estimateCompositionContext,
  loadCompositionDraft,
  moveOutlineSection,
  normalizeCompositionDraft,
  parseCompositionOutlineText,
  reorderOutlineSection,
  saveCompositionDraft,
  sectionCompletion,
  sourceChangesForJob,
  validateCompositionBrief,
} from "./ai-composition/model.js";

test("composition definition drafts persist locally with bounded fields and source ids", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(loadCompositionDraft(storage), null);
  const saved = saveCompositionDraft({
    brief: {
      topic: "上次主题",
      audience: "读者",
      targetWords: 3500,
      requirements: "保留输入",
    },
    selectedSourceIds: ["source-1", "source-1", "source-2"],
  }, storage);
  assert.equal(saved.brief.topic, "上次主题");
  assert.equal(values.has(COMPOSITION_DRAFT_STORAGE_KEY), true);
  assert.deepEqual(loadCompositionDraft(storage).selectedSourceIds, ["source-1", "source-2"]);
  assert.equal(normalizeCompositionDraft({}, "当前信笺").brief.topic, "当前信笺");
});

test("composition brief requires a topic and bounded target length", () => {
  assert.deepEqual(validateCompositionBrief({ topic: "", targetWords: 50 }), {
    topic: "请填写写作主题",
    targetWords: "目标字数需在 100 到 200000 之间",
  });
  assert.deepEqual(validateCompositionBrief({ topic: "主题", targetWords: 2000 }), {});
});

test("composition sources are explicit snapshots with a visible context estimate", async () => {
  const candidates = [
    { id: "a", revision: "1", title: "甲", content: "一".repeat(100) },
    { id: "b", revision: "2", title: "乙", content: "二".repeat(200) },
  ];
  const snapshots = await createSourceSnapshots(candidates, ["b"], "2026-07-29T00:00:00.000Z");
  assert.deepEqual(snapshots.map((source) => source.sourceId), ["b"]);
  assert.match(snapshots[0].contentHash, /^[a-f0-9]{64}$/);
  assert.equal(estimateCompositionContext({ brief: { topic: "主题" }, sources: snapshots }).sourceCount, 1);
  assert.deepEqual(await sourceChangesForJob({ sourceSnapshots: snapshots }, [
    { id: "b", revision: "3" },
  ]), [{ sourceId: "b", title: "乙", kind: "changed" }]);
  assert.deepEqual(await sourceChangesForJob({ sourceSnapshots: snapshots }, [
    { id: "b", revision: "2", title: "乙", content: "内容已经变化" },
  ]), [{ sourceId: "b", title: "乙", kind: "changed" }]);
});

test("composition outline ordering and progress remain stable", () => {
  const outline = [
    { sectionId: "a", title: "甲", order: 0 },
    { sectionId: "b", title: "乙", order: 1 },
  ];
  assert.deepEqual(moveOutlineSection(outline, "b", "up").map((item) => item.sectionId), ["b", "a"]);
  assert.deepEqual(reorderOutlineSection([
    ...outline,
    { sectionId: "c", title: "丙", order: 2 },
  ], "c", "a").map((item) => item.sectionId), ["c", "a", "b"]);
  assert.deepEqual(
    parseCompositionOutlineText("# 引言\n2. 方法 :: 说明\n- 结论 [锁定]", 1800)
      .map(({ title, summary, locked, targetWords }) => ({ title, summary, locked, targetWords })),
    [
      { title: "引言", summary: "", locked: false, targetWords: 600 },
      { title: "方法", summary: "说明", locked: false, targetWords: 600 },
      { title: "结论", summary: "", locked: true, targetWords: 600 },
    ],
  );
  assert.deepEqual(sectionCompletion({
    sections: [{ status: "accepted" }, { status: "draft" }, { status: "pending" }],
  }), { done: 2, accepted: 1, total: 3 });
  assert.equal(compositionStepForJob({ status: "outline-review", outline }), "outline");
  assert.equal(compositionStepForJob({ status: "complete", outline }), "complete");
  assert.equal(compositionStepForJob({ status: "error", outline: [] }), "brief");
  assert.equal(compositionStepForJob({
    status: "error",
    outline,
    sections: [{ draft: "甲" }, { draft: "" }],
  }), "draft");
});
