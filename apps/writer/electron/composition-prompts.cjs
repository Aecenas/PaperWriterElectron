const {
  outlineResponseSchema,
  reviewResponseSchema,
} = require("./composition-model.cjs");

function sourceContext(job) {
  if (!job.sourceSnapshots.length) return "未选择资料；不得虚构来源。";
  return job.sourceSnapshots.map((source) => [
    `<source id="${source.sourceId}" revision="${source.revision}">`,
    `标题：${source.title || "未命名资料"}`,
    source.content,
    "</source>",
  ].join("\n")).join("\n\n");
}

function briefPayload(job) {
  return JSON.stringify({
    brief: job.brief,
    constraints: job.constraints,
    outline: job.outline,
  }, null, 2);
}

const PRECEDING_SUMMARY_MAX_CHARS = 12000;
const RECENT_BODY_MAX_CHARS = 8000;

function plainTextForSummary(value) {
  const raw = String(value || "");
  const bounded = raw.length <= 120000
    ? raw
    : `${raw.slice(0, 60000)}\n[正文中段省略]\n${raw.slice(-60000)}`;
  return bounded
    .replace(/```[\s\S]*?```/g, " [代码块] ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, " $1 ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, " $1 ")
    .replace(/\[\[cite:([a-zA-Z0-9_-]+)(?:\|[^\]]*)?\]\]/g, "（来源 $1）")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+•]|\d+[.)、])\s+/gm, "")
    .replace(/[*_~`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function deterministicSummary(value, maximum = 600) {
  const limit = Math.max(24, Math.trunc(Number(maximum) || 600));
  const text = plainTextForSummary(value);
  if (text.length <= limit) return text;
  const separator = " … ";
  const available = Math.max(1, limit - separator.length);
  const leadLength = Math.ceil(available * 0.68);
  const tailLength = Math.max(1, available - leadLength);
  const lead = text.slice(0, leadLength).replace(/\s+\S*$/, "").trim()
    || text.slice(0, leadLength);
  const tailCandidate = text.slice(-tailLength);
  const tail = tailCandidate.replace(/^\S*\s+/, "").trim() || tailCandidate;
  return `${lead}${separator}${tail}`.slice(0, limit);
}

function precedingSectionContext(job, sectionIndex) {
  const preceding = job.outline.slice(0, Math.max(0, sectionIndex)).map((outline, index) => {
    const section = job.sections[index] || {};
    const draft = section.acceptedDraft || section.draft || "";
    return {
      sectionId: outline.sectionId,
      title: outline.title,
      draft,
      outlineSummary: outline.summary,
    };
  });
  if (!preceding.length) {
    return { sectionSummaries: "", recentBody: "" };
  }
  const separatorsLength = preceding.length - 1;
  const perEntryLimit = Math.min(
    1000,
    Math.max(
      24,
      Math.floor((PRECEDING_SUMMARY_MAX_CHARS - separatorsLength) / preceding.length),
    ),
  );
  const sectionSummaries = preceding
    .map((item) => {
      const identityLimit = Math.max(24, Math.min(180, Math.floor(perEntryLimit * 0.3)));
      const identity = deterministicSummary(
        `[${item.sectionId}] ${item.title}`,
        identityLimit,
      );
      const summary = deterministicSummary(
        item.outlineSummary
          ? `大纲摘要：${item.outlineSummary}；正文要点：${item.draft}`
          : item.draft,
        Math.max(24, perEntryLimit - identity.length - 1),
      );
      return `${identity}：${summary}`.slice(0, perEntryLimit);
    })
    .join("\n")
    .slice(0, PRECEDING_SUMMARY_MAX_CHARS);
  const recentParts = [];
  let recentRemaining = RECENT_BODY_MAX_CHARS;
  for (let index = preceding.length - 1; index >= 0 && recentRemaining > 0; index -= 1) {
    const draft = preceding[index].draft;
    if (!draft) continue;
    const separatorLength = recentParts.length ? 2 : 0;
    if (separatorLength >= recentRemaining) break;
    recentRemaining -= separatorLength;
    const part = draft.slice(-recentRemaining);
    recentParts.unshift(part);
    recentRemaining -= part.length;
  }
  return {
    sectionSummaries,
    recentBody: recentParts.join("\n\n").slice(-RECENT_BODY_MAX_CHARS),
  };
}

function createOutlineMessages(job, repair) {
  const messages = [
    {
      role: "system",
      content: [
        "你是笺间的长文大纲设计器。",
        "严格依据写作简报与已选择资料生成完整大纲。",
        "只返回 JSON，不要返回 Markdown 代码围栏或解释。",
        `输出必须符合此 JSON Schema：${JSON.stringify(outlineResponseSchema())}`,
        "documentTitle 必须是根据全文主题重新拟定的简洁文章标题，不得直接复制用户的写作要求。",
        "sectionId 必须稳定、简短，只含英文字母、数字、下划线或连字符。",
        "若输入大纲中有 locked=true 的章节，必须原样保留其 sectionId、标题、摘要、目标字数和相对位置。",
        "不要在大纲阶段撰写正文。不得使用输入中不存在的来源。",
      ].join("\n"),
    },
    {
      role: "user",
      content: `写作任务：\n${briefPayload(job)}\n\n已选择资料：\n${sourceContext(job)}`,
    },
  ];
  if (repair) {
    messages.push(
      { role: "assistant", content: String(repair.raw || "").slice(0, 100000) },
      {
        role: "user",
        content: `上次输出未通过本地结构校验：${String(repair.message || "").slice(0, 1000)}。只修复 JSON 结构，不要改变写作任务，也不要添加解释。`,
      },
    );
  }
  return messages;
}

function createSectionMessages(job, sectionId) {
  const index = job.outline.findIndex((section) => section.sectionId === sectionId);
  if (index < 0) throw new Error("待生成章节不存在");
  const section = job.outline[index];
  const preceding = precedingSectionContext(job, index);
  return [
    {
      role: "system",
      content: [
        "你是笺间的长文分节写作器。",
        "只撰写指定章节，不要输出章节之外的说明。",
        "不要重复输出章节标题；从本章第一段正文直接开始。",
        "正文使用 Markdown；禁止原始 HTML。",
        "需要引用已选择资料时，只能使用 [[cite:sourceId]] 或 [[cite:sourceId|页码/位置]]。",
        "不得创建输入中不存在的 sourceId；无法证实时明确写“待核实”。",
        "遵循完整大纲，避免重复前文，并保持术语、立场、时态和叙述视角一致。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `写作任务：\n${briefPayload(job)}`,
        `当前章节：\n${JSON.stringify(section, null, 2)}`,
        `前文章节摘要：\n${preceding.sectionSummaries || "（无）"}`,
        `最近正文（仅用于衔接）：\n${preceding.recentBody || "（无）"}`,
        `已选择资料：\n${sourceContext(job)}`,
      ].join("\n\n"),
    },
  ];
}

function createReviewMessages(job, repair) {
  const body = job.outline.map((outline, index) => ({
    sectionId: outline.sectionId,
    title: outline.title,
    draft: job.sections[index]?.acceptedDraft || job.sections[index]?.draft || "",
  }));
  const messages = [
    {
      role: "system",
      content: [
        "你是笺间的长文一致性审阅器。",
        "检查章节遗漏、重复、术语不一致、前后矛盾、缺引用、未使用引用和待核实论断。",
        "只提出建议，不重写任何已接受章节。",
        "只返回 JSON，不要返回 Markdown 代码围栏或解释。",
        `输出必须符合此 JSON Schema：${JSON.stringify(reviewResponseSchema())}`,
        "kind 只能使用 Schema 列出的英文枚举值，severity 只能是 info、warning 或 error。",
        "如果没有发现问题，返回 {\"reports\":[]}。",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `写作任务：\n${briefPayload(job)}`,
        `完整正文：\n${JSON.stringify(body)}`,
        `可用来源 ID：${job.sourceSnapshots.map((source) => source.sourceId).join(", ") || "无"}`,
      ].join("\n\n"),
    },
  ];
  if (repair) {
    messages.push(
      { role: "assistant", content: String(repair.raw || "").slice(0, 100000) },
      {
        role: "user",
        content: `上次输出未通过本地结构校验：${String(repair.message || "").slice(0, 1000)}。只修复 JSON 结构，不要重写正文，也不要添加解释。`,
      },
    );
  }
  return messages;
}

module.exports = {
  createOutlineMessages,
  createReviewMessages,
  createSectionMessages,
  deterministicSummary,
  precedingSectionContext,
};
