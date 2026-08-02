const { createHash } = require("node:crypto");

const COMPOSITION_JOB_VERSION = 1;
const COMPOSITION_JOB_STATUSES = Object.freeze([
  "brief",
  "outline-running",
  "outline-review",
  "drafting",
  "paused",
  "review",
  "finalizing",
  "complete",
  "error",
  "canceled",
]);
const COMPOSITION_JOB_STATUS_SET = new Set(COMPOSITION_JOB_STATUSES);
const COMPOSITION_SECTION_STATUSES = new Set([
  "pending",
  "running",
  "interrupted",
  "draft",
  "accepted",
  "error",
]);
const COMPOSITION_TASK_KEYS = Object.freeze([
  "composeOutline",
  "composeDraft",
  "composeReview",
]);
const COMPOSITION_TASK_KEY_SET = new Set(COMPOSITION_TASK_KEYS);
const MAX_SOURCE_SNAPSHOTS = 64;
const MAX_SOURCE_TOTAL_CHARS = 2 * 1024 * 1024;
const MAX_OUTLINE_SECTIONS = 100;
const MAX_SECTION_DRAFT_CHARS = 500000;
const MAX_ALTERNATIVES = 4;

function stringValue(value, max = 10000) {
  return String(value || "").slice(0, max);
}

function boundedJsonObject(value, maximum = 64 * 1024) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const json = JSON.stringify(value);
    if (json.length > maximum) return {};
    const parsed = JSON.parse(json);
    for (const key of ["__proto__", "prototype", "constructor"]) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) delete parsed[key];
    }
    return parsed;
  } catch {
    return {};
  }
}

function cleanId(value, fallback = "") {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id) ? id : fallback;
}

function normalizeBrief(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    topic: stringValue(source.topic, 12000),
    audience: stringValue(source.audience, 4000),
    genre: stringValue(source.genre, 1000),
    targetWords: Math.min(200000, Math.max(100, Math.trunc(Number(source.targetWords) || 2000))),
    tone: stringValue(source.tone, 2000),
    requirements: stringValue(source.requirements, 30000),
    forbiddenContent: stringValue(source.forbiddenContent, 12000),
    citationRules: stringValue(source.citationRules, 12000),
  };
}

function normalizeSourceSnapshots(value) {
  const candidates = Array.isArray(value) ? value.slice(0, MAX_SOURCE_SNAPSHOTS) : [];
  let remaining = MAX_SOURCE_TOTAL_CHARS;
  return candidates.flatMap((item, index) => {
    if (!item || typeof item !== "object" || remaining <= 0) return [];
    const sourceId = cleanId(item.sourceId || item.id, `source-${index + 1}`);
    const content = stringValue(item.content || item.text, remaining);
    remaining -= content.length;
    if (!content.trim()) return [];
    const contentHash = createHash("sha256")
      .update(content, "utf8")
      .digest("hex");
    const citationSource = item.citationSource && typeof item.citationSource === "object"
      ? item.citationSource
      : item;
    return [{
      sourceId,
      revision: stringValue(item.revision, 256),
      title: stringValue(item.title, 1000),
      content,
      contentHash,
      selectedRange: item.selectedRange && typeof item.selectedRange === "object"
        ? {
          from: Math.max(0, Math.trunc(Number(item.selectedRange.from) || 0)),
          to: Math.max(0, Math.trunc(Number(item.selectedRange.to) || 0)),
        }
        : null,
      capturedAt: stringValue(item.capturedAt, 64),
      citationSource: {
        id: stringValue(citationSource.id, 128),
        citationKey: stringValue(citationSource.citationKey, 200),
        type: stringValue(citationSource.type, 32),
        title: stringValue(citationSource.title || item.title, 1000),
        authors: (Array.isArray(citationSource.authors) ? citationSource.authors : [])
          .slice(0, 100)
          .map((author) => stringValue(author, 200))
          .filter(Boolean),
        year: stringValue(citationSource.year, 32),
        containerTitle: stringValue(citationSource.containerTitle, 1000),
        publisher: stringValue(citationSource.publisher, 500),
        url: stringValue(citationSource.url, 2048),
        doi: stringValue(citationSource.doi, 300),
        isbn: stringValue(citationSource.isbn, 64),
        pages: stringValue(citationSource.pages, 128),
        notes: stringValue(citationSource.notes, 10000),
        csl: boundedJsonObject(citationSource.csl),
      },
    }];
  });
}

function normalizeOutline(value) {
  const used = new Set();
  return (Array.isArray(value) ? value : [])
    .slice(0, MAX_OUTLINE_SECTIONS)
    .map((item, index) => {
      const source = item && typeof item === "object" ? item : {};
      let sectionId = cleanId(source.sectionId, `section-${index + 1}`);
      while (used.has(sectionId)) sectionId = `${sectionId}-${index + 1}`;
      used.add(sectionId);
      return {
        sectionId,
        title: stringValue(source.title, 1000) || `第 ${index + 1} 节`,
        summary: stringValue(source.summary, 12000),
        targetWords: Math.min(50000, Math.max(50, Math.trunc(Number(source.targetWords) || 500))),
        locked: Boolean(source.locked),
        order: index,
      };
    });
}

function normalizeCitation(value) {
  if (!value || typeof value !== "object") return null;
  const sourceId = cleanId(value.sourceId);
  if (!sourceId) return null;
  return {
    sourceId,
    locator: stringValue(value.locator, 256),
    claim: stringValue(value.claim, 4000),
    verified: Boolean(value.verified),
  };
}

function normalizeAlternative(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: cleanId(value.id, `alternative-${Date.now()}`),
    draft: stringValue(value.draft, MAX_SECTION_DRAFT_CHARS),
    createdAt: stringValue(value.createdAt, 64),
  };
}

function normalizeSection(value, outlineItem) {
  const source = value && typeof value === "object" ? value : {};
  const status = COMPOSITION_SECTION_STATUSES.has(source.status)
    ? source.status
    : "pending";
  return {
    sectionId: outlineItem.sectionId,
    status,
    draft: stringValue(source.draft, MAX_SECTION_DRAFT_CHARS),
    acceptedDraft: stringValue(source.acceptedDraft, MAX_SECTION_DRAFT_CHARS),
    alternatives: (Array.isArray(source.alternatives) ? source.alternatives : [])
      .slice(-MAX_ALTERNATIVES)
      .map(normalizeAlternative)
      .filter(Boolean),
    citations: (Array.isArray(source.citations) ? source.citations : [])
      .slice(0, 500)
      .map(normalizeCitation)
      .filter(Boolean),
    error: stringValue(source.error, 4000),
    updatedAt: stringValue(source.updatedAt, 64),
  };
}

function normalizeSections(value, outline) {
  const sourceItems = Array.isArray(value) ? value : [];
  const byId = new Map(sourceItems.map((item) => [String(item?.sectionId || ""), item]));
  return outline.map((item) => normalizeSection(byId.get(item.sectionId), item));
}

function normalizeReviewReport(value) {
  if (!value || typeof value !== "object") return null;
  const kinds = new Set([
    "missing-section",
    "duplication",
    "terminology",
    "contradiction",
    "missing-citation",
    "unused-citation",
    "unverified-claim",
    "general",
  ]);
  return {
    id: cleanId(value.id, `review-${Date.now()}`),
    kind: kinds.has(value.kind) ? value.kind : "general",
    severity: ["info", "warning", "error"].includes(value.severity) ? value.severity : "warning",
    sectionId: cleanId(value.sectionId),
    title: stringValue(value.title, 1000),
    detail: stringValue(value.detail, 12000),
    suggestion: stringValue(value.suggestion, 12000),
    resolved: Boolean(value.resolved),
  };
}

function normalizeModelAssignments(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(COMPOSITION_TASK_KEYS.map((key) => {
    const assignment = source[key] && typeof source[key] === "object" ? source[key] : {};
    return [key, {
      providerId: cleanId(assignment.providerId),
      modelId: stringValue(assignment.modelId, 256)
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim(),
    }];
  }));
}

function normalizeUsage(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    inputTokens: Math.max(0, Math.trunc(Number(source.inputTokens) || 0)),
    outputTokens: Math.max(0, Math.trunc(Number(source.outputTokens) || 0)),
    totalTokens: Math.max(0, Math.trunc(Number(source.totalTokens) || 0)),
    estimatedCost: Math.max(0, Number(source.estimatedCost) || 0),
  };
}

function normalizeDerivedFrom(value) {
  if (!value || typeof value !== "object") return null;
  const documentId = stringValue(value.documentId, 128);
  if (!documentId) return null;
  return {
    documentId,
    revision: stringValue(value.revision, 256),
    path: stringValue(value.path, 32000),
    title: stringValue(value.title, 1000),
  };
}

function normalizeOutputIntent(value) {
  if (!value || typeof value !== "object") return null;
  const outputPath = stringValue(value.path, 32000)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const documentId = cleanId(value.documentId);
  if (!outputPath || !documentId) return null;
  return {
    path: outputPath,
    documentId,
    preparedAt: stringValue(value.preparedAt, 64),
  };
}

function normalizeCompositionJob(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const outline = normalizeOutline(source.outline);
  const status = COMPOSITION_JOB_STATUS_SET.has(source.status)
    ? source.status
    : "brief";
  return {
    version: COMPOSITION_JOB_VERSION,
    jobId: cleanId(source.jobId),
    revision: Math.max(1, Math.trunc(Number(source.revision) || 1)),
    status,
    brief: normalizeBrief(source.brief),
    generatedTitle: stringValue(source.generatedTitle, 1000),
    constraints: stringValue(source.constraints, 30000),
    sourceSnapshots: normalizeSourceSnapshots(source.sourceSnapshots),
    outline,
    sections: normalizeSections(source.sections, outline),
    reviewReports: (Array.isArray(source.reviewReports) ? source.reviewReports : [])
      .slice(0, 1000)
      .map(normalizeReviewReport)
      .filter(Boolean),
    modelAssignments: normalizeModelAssignments(source.modelAssignments),
    usage: normalizeUsage(source.usage),
    derivedFrom: normalizeDerivedFrom(source.derivedFrom),
    outputPath: stringValue(source.outputPath, 32000),
    outputDocumentId: stringValue(source.outputDocumentId, 128),
    outputIntent: normalizeOutputIntent(source.outputIntent),
    activeSectionId: cleanId(source.activeSectionId),
    reviewedAt: stringValue(source.reviewedAt, 64),
    error: stringValue(source.error, 4000),
    createdAt: stringValue(source.createdAt, 64),
    updatedAt: stringValue(source.updatedAt, 64),
  };
}

function outlineResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["documentTitle", "sections"],
    properties: {
      documentTitle: { type: "string", minLength: 1, maxLength: 300 },
      sections: {
        type: "array",
        minItems: 1,
        maxItems: MAX_OUTLINE_SECTIONS,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sectionId", "title", "summary", "targetWords"],
          properties: {
            sectionId: { type: "string", pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$" },
            title: { type: "string", minLength: 1, maxLength: 1000 },
            summary: { type: "string", maxLength: 12000 },
            targetWords: { type: "integer", minimum: 50, maximum: 50000 },
          },
        },
      },
    },
  };
}

function reviewResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["reports"],
    properties: {
      reports: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "severity", "title", "detail", "suggestion"],
          properties: {
            kind: {
              enum: [
                "missing-section",
                "duplication",
                "terminology",
                "contradiction",
                "missing-citation",
                "unused-citation",
                "unverified-claim",
                "general",
              ],
            },
            severity: { enum: ["info", "warning", "error"] },
            sectionId: { type: "string" },
            title: { type: "string" },
            detail: { type: "string" },
            suggestion: { type: "string" },
          },
        },
      },
    },
  };
}

function extractJsonObject(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text) throw new Error("AI 未返回结构化结果");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI 返回的 JSON 无法解析");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI 返回的结构必须是 JSON 对象");
  }
  return parsed;
}

function parseOutlinePlanResponse(raw) {
  const parsed = extractJsonObject(raw);
  if (
    !Array.isArray(parsed.sections)
    || !parsed.sections.length
    || Object.keys(parsed).some((key) => !["documentTitle", "title", "sections"].includes(key))
  ) {
    throw new Error("大纲响应不符合约定结构");
  }
  const allowed = new Set(["sectionId", "title", "summary", "targetWords"]);
  for (const section of parsed.sections) {
    if (
      !section
      || typeof section !== "object"
      || Array.isArray(section)
      || Object.keys(section).some((key) => !allowed.has(key))
      || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(section.sectionId)
      || typeof section.title !== "string"
      || !section.title.trim()
      || typeof section.summary !== "string"
      || !Number.isInteger(section.targetWords)
      || section.targetWords < 50
      || section.targetWords > 50000
    ) {
      throw new Error("大纲响应包含无效章节");
    }
  }
  const outline = normalizeOutline(parsed.sections);
  if (outline.length !== parsed.sections.length || outline.some((item) => !item.title.trim())) {
    throw new Error("大纲响应包含无效章节");
  }
  const documentTitle = stringValue(parsed.documentTitle || parsed.title || outline[0]?.title, 300).trim();
  if (!documentTitle) throw new Error("大纲响应缺少文章标题");
  return { documentTitle, outline };
}

function parseOutlineResponse(raw) {
  return parseOutlinePlanResponse(raw).outline;
}

function parseReviewResponse(raw) {
  const parsed = extractJsonObject(raw);
  const reports = [parsed.reports, parsed.issues, parsed.findings, parsed.checks]
    .find((value) => Array.isArray(value));
  if (!reports) {
    throw new Error("审阅响应不符合约定结构");
  }
  const kinds = new Set([
    "missing-section",
    "duplication",
    "terminology",
    "contradiction",
    "missing-citation",
    "unused-citation",
    "unverified-claim",
    "general",
  ]);
  const text = (value, maximum) => {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean).join("；").slice(0, maximum);
    }
    if (value && typeof value === "object") {
      try {
        return JSON.stringify(value).slice(0, maximum);
      } catch {
        return "";
      }
    }
    return String(value || "").slice(0, maximum);
  };
  const kindFor = (value) => {
    const candidate = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (kinds.has(candidate)) return candidate;
    if (/遗漏|缺少章节|missing.*section|omission/.test(candidate)) return "missing-section";
    if (/重复|duplication|duplicate|repetition/.test(candidate)) return "duplication";
    if (/术语|terminology|term/.test(candidate)) return "terminology";
    if (/矛盾|contradiction|conflict|inconsisten/.test(candidate)) return "contradiction";
    if (/未使用.*引用|unused.*citation/.test(candidate)) return "unused-citation";
    if (/缺少.*引用|missing.*citation|citation.*missing/.test(candidate)) return "missing-citation";
    if (/待核实|未经证实|unverified|fact.*check/.test(candidate)) return "unverified-claim";
    return "general";
  };
  const severityFor = (value) => {
    const candidate = String(value || "").trim().toLowerCase();
    if (["error", "critical", "high", "严重", "高"].includes(candidate)) return "error";
    if (["info", "note", "low", "提示", "低"].includes(candidate)) return "info";
    return "warning";
  };
  return reports.slice(0, 1000).flatMap((report) => {
    const source = report && typeof report === "object" && !Array.isArray(report)
      ? report
      : { detail: report };
    const detail = text(source.detail ?? source.description ?? source.reason ?? source.evidence, 12000);
    const suggestion = text(source.suggestion ?? source.recommendation ?? source.fix ?? source.action, 12000);
    const title = text(source.title ?? source.issue ?? source.summary ?? source.category, 1000)
      || detail.slice(0, 1000)
      || suggestion.slice(0, 1000);
    if (!title.trim()) return [];
    return [normalizeReviewReport({
      id: source.id,
      kind: kindFor(source.kind ?? source.type ?? source.category),
      severity: severityFor(source.severity ?? source.level ?? source.priority),
      sectionId: typeof source.sectionId === "string" ? source.sectionId : "",
      title,
      detail: detail || title,
      suggestion,
      resolved: source.resolved,
    })];
  }).filter(Boolean);
}

function sourceIdSet(job) {
  return new Set(job.sourceSnapshots.map((source) => source.sourceId));
}

function extractControlledCitations(markdown, job) {
  const allowed = sourceIdSet(job);
  const citations = [];
  const unknown = [];
  const pattern = /\[\[cite:([a-zA-Z0-9][a-zA-Z0-9_-]{0,127})(?:\|([^\]]{0,256}))?\]\]/g;
  for (const match of String(markdown || "").matchAll(pattern)) {
    const citation = {
      sourceId: match[1],
      locator: stringValue(match[2], 256),
      claim: "",
      verified: allowed.has(match[1]),
    };
    citations.push(citation);
    if (!citation.verified) unknown.push(citation.sourceId);
  }
  return { citations, unknown: [...new Set(unknown)] };
}

module.exports = {
  COMPOSITION_JOB_STATUSES,
  COMPOSITION_JOB_VERSION,
  COMPOSITION_TASK_KEYS,
  COMPOSITION_TASK_KEY_SET,
  extractControlledCitations,
  normalizeBrief,
  normalizeCompositionJob,
  normalizeOutline,
  outlineResponseSchema,
  parseOutlinePlanResponse,
  parseOutlineResponse,
  parseReviewResponse,
  reviewResponseSchema,
};
