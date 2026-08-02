const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");
const {
  extractControlledCitations,
  normalizeCompositionJob,
  outlineResponseSchema,
  parseOutlinePlanResponse,
  parseOutlineResponse,
  parseReviewResponse,
  reviewResponseSchema,
} = require("./composition-model.cjs");

test("composition jobs normalize bounded briefs, stable outlines, and source snapshots", () => {
  const job = normalizeCompositionJob({
    jobId: "job-1",
    status: "drafting",
    brief: { topic: "主题", targetWords: 4000 },
    generatedTitle: "重新拟定的标题",
    sourceSnapshots: [{ sourceId: "source-1", title: "资料", content: "证据" }],
    outline: [
      { sectionId: "intro", title: "开篇", targetWords: 500 },
      { sectionId: "intro", title: "正文", targetWords: 1000 },
    ],
    sections: [{ sectionId: "intro", status: "accepted", draft: "草稿" }],
    reviewedAt: "2026-07-29T01:02:03.000Z",
    modelAssignments: {
      composeDraft: { providerId: "custom-provider", modelId: "model.v2 preview" },
    },
    outputIntent: {
      path: "C:\\docs\\派生稿.letterpaper",
      documentId: "derived-document",
      preparedAt: "2026-07-29T01:02:04.000Z",
    },
  });
  assert.equal(job.version, 1);
  assert.equal(job.brief.targetWords, 4000);
  assert.equal(job.generatedTitle, "重新拟定的标题");
  assert.deepEqual(job.outline.map((item) => item.sectionId), ["intro", "intro-2"]);
  assert.equal(job.sections[0].status, "accepted");
  assert.equal(job.sections[1].status, "pending");
  assert.equal(job.sourceSnapshots[0].content, "证据");
  assert.equal(
    job.sourceSnapshots[0].contentHash,
    createHash("sha256").update("证据", "utf8").digest("hex"),
  );
  assert.equal(job.reviewedAt, "2026-07-29T01:02:03.000Z");
  assert.equal(job.modelAssignments.composeDraft.modelId, "model.v2 preview");
  assert.deepEqual(job.outputIntent, {
    path: "C:\\docs\\派生稿.letterpaper",
    documentId: "derived-document",
    preparedAt: "2026-07-29T01:02:04.000Z",
  });
});

test("outline and review parsers reject non-JSON wrappers and accept the locked schemas", () => {
  assert.throws(() => parseOutlineResponse("这里是大纲"), /JSON/);
  assert.deepEqual(outlineResponseSchema().required, ["documentTitle", "sections"]);
  assert.equal(parseOutlinePlanResponse(JSON.stringify({
    documentTitle: "时间之外的隆中对",
    sections: [{
      sectionId: "opening",
      title: "引言",
      summary: "问题背景",
      targetWords: 400,
    }],
  })).documentTitle, "时间之外的隆中对");
  assert.deepEqual(parseOutlineResponse(JSON.stringify({
    sections: [{
      sectionId: "opening",
      title: "引言",
      summary: "问题背景",
      targetWords: 400,
    }],
  })), [{
    sectionId: "opening",
    title: "引言",
    summary: "问题背景",
    targetWords: 400,
    locked: false,
    order: 0,
  }]);
  assert.equal(parseReviewResponse(JSON.stringify({
    reports: [{
      kind: "terminology",
      severity: "warning",
      sectionId: "opening",
      title: "术语不一致",
      detail: "同一概念用了两个名称",
      suggestion: "统一名称",
    }],
  }))[0].kind, "terminology");
  assert.deepEqual(reviewResponseSchema().properties.reports.items.properties.kind.enum, [
    "missing-section",
    "duplication",
    "terminology",
    "contradiction",
    "missing-citation",
    "unused-citation",
    "unverified-claim",
    "general",
  ]);
});

test("review parser safely normalizes common model variations instead of failing the full draft", () => {
  const reports = parseReviewResponse(JSON.stringify({
    issues: [{
      type: "逻辑一致性",
      level: "medium",
      sectionId: null,
      issue: "时间线需要说明",
      description: ["五年后的经历", "回到原时间点"],
      recommendation: "补一句时间机制说明",
      evidence: "模型附加字段可以忽略",
    }],
    summary: "检查完成",
  }));
  assert.deepEqual(reports.map((report) => ({
    kind: report.kind,
    severity: report.severity,
    sectionId: report.sectionId,
    title: report.title,
    detail: report.detail,
    suggestion: report.suggestion,
  })), [{
    kind: "general",
    severity: "warning",
    sectionId: "",
    title: "时间线需要说明",
    detail: "五年后的经历；回到原时间点",
    suggestion: "补一句时间机制说明",
  }]);
  assert.deepEqual(parseReviewResponse('{"reports":[],"summary":"未发现问题"}'), []);
  assert.throws(() => parseReviewResponse('{"summary":"缺少检查数组"}'), /不符合约定结构/);
});

test("controlled citations accept only selected stable source ids", () => {
  const job = normalizeCompositionJob({
    jobId: "job-1",
    sourceSnapshots: [{ sourceId: "known", content: "资料" }],
  });
  const result = extractControlledCitations(
    "已知 [[cite:known|第3页]]，未知 [[cite:invented]]。",
    job,
  );
  assert.equal(result.citations.length, 2);
  assert.equal(result.citations[0].verified, true);
  assert.deepEqual(result.unknown, ["invented"]);
});
