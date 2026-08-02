const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeCompositionJob } = require("./composition-model.cjs");
const {
  createSectionMessages,
  deterministicSummary,
  precedingSectionContext,
} = require("./composition-prompts.cjs");

test("section prompts use bounded deterministic summaries plus only the recent body tail", () => {
  const hiddenMiddle = "RAW_MIDDLE_MUST_NOT_LEAK";
  const longDraft = [
    "这是开头。",
    "甲".repeat(16000),
    hiddenMiddle,
    "乙".repeat(16000),
    "这是结尾。",
  ].join("");
  const job = normalizeCompositionJob({
    jobId: "job-prompts",
    brief: { topic: "长文上下文" },
    outline: [
      { sectionId: "one", title: "第一节", summary: "第一节概要" },
      { sectionId: "two", title: "第二节", summary: "第二节概要" },
      { sectionId: "three", title: "第三节" },
    ],
    sections: [
      { sectionId: "one", status: "accepted", acceptedDraft: longDraft },
      { sectionId: "two", status: "accepted", acceptedDraft: "离目标章节最近的正文。" },
      { sectionId: "three", status: "pending" },
    ],
  });

  const first = precedingSectionContext(job, 2);
  const second = precedingSectionContext(job, 2);
  assert.deepEqual(first, second);
  assert.ok(first.sectionSummaries.length <= 12000);
  assert.ok(first.recentBody.length <= 8000);
  assert.match(first.sectionSummaries, /\[one\]/);
  assert.match(first.sectionSummaries, /\[two\]/);
  assert.doesNotMatch(first.sectionSummaries, new RegExp(hiddenMiddle));
  assert.doesNotMatch(first.recentBody, new RegExp(hiddenMiddle));
  assert.match(first.recentBody, /离目标章节最近的正文/);

  const userMessage = createSectionMessages(job, "three")[1].content;
  const systemMessage = createSectionMessages(job, "three")[0].content;
  assert.match(systemMessage, /不要重复输出章节标题/);
  assert.match(userMessage, /前文章节摘要：/);
  assert.match(userMessage, /最近正文（仅用于衔接）：/);
  assert.doesNotMatch(userMessage, /已接受前文：/);
  assert.doesNotMatch(userMessage, new RegExp(hiddenMiddle));
});

test("deterministic summaries are stable and honor their exact character bound", () => {
  const input = `# 标题\n${"内容。".repeat(500)}`;
  const left = deterministicSummary(input, 240);
  const right = deterministicSummary(input, 240);
  assert.equal(left, right);
  assert.ok(left.length <= 240);
  assert.doesNotMatch(left, /^#/);
});
