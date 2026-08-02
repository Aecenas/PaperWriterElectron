export const COMPOSITION_STEPS = Object.freeze([
  "brief",
  "outline",
  "draft",
  "review",
  "complete",
]);

export const EMPTY_COMPOSITION_BRIEF = Object.freeze({
  topic: "",
  audience: "",
  genre: "长文",
  targetWords: 2000,
  tone: "",
  requirements: "",
  forbiddenContent: "",
  citationRules: "引用资料时标注来源；无法证实时标为待核实。",
});

export const COMPOSITION_DRAFT_STORAGE_KEY = "paperwriter.aiCompositionDraft.v1";

function boundedCompositionDraftText(value, maximum) {
  return String(value || "").slice(0, maximum);
}

export function normalizeCompositionDraft(value = {}, fallbackTopic = "") {
  const source = value && typeof value === "object" ? value : {};
  const brief = source.brief && typeof source.brief === "object" ? source.brief : {};
  const targetWords = Math.min(
    200000,
    Math.max(100, Math.trunc(Number(brief.targetWords) || EMPTY_COMPOSITION_BRIEF.targetWords)),
  );
  const selectedSourceIds = [...new Set(
    (Array.isArray(source.selectedSourceIds) ? source.selectedSourceIds : [])
      .slice(0, 64)
      .map((sourceId) => String(sourceId || "").slice(0, 128).trim())
      .filter(Boolean),
  )];
  return {
    brief: {
      ...EMPTY_COMPOSITION_BRIEF,
      topic: boundedCompositionDraftText(brief.topic || fallbackTopic, 12000),
      audience: boundedCompositionDraftText(brief.audience, 4000),
      genre: boundedCompositionDraftText(brief.genre || EMPTY_COMPOSITION_BRIEF.genre, 1000),
      targetWords,
      tone: boundedCompositionDraftText(brief.tone, 2000),
      requirements: boundedCompositionDraftText(brief.requirements, 30000),
      forbiddenContent: boundedCompositionDraftText(brief.forbiddenContent, 12000),
      citationRules: boundedCompositionDraftText(
        brief.citationRules || EMPTY_COMPOSITION_BRIEF.citationRules,
        12000,
      ),
    },
    selectedSourceIds,
  };
}

export function loadCompositionDraft(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(COMPOSITION_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return normalizeCompositionDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveCompositionDraft(value, storage = globalThis.localStorage) {
  const normalized = normalizeCompositionDraft(value);
  try {
    storage?.setItem?.(COMPOSITION_DRAFT_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // A storage failure must not block drafting in the current session.
  }
  return normalized;
}

export function compositionStepForJob(job) {
  if (!job) return "brief";
  if (job.status === "complete") return "complete";
  if (job.status === "error") {
    if (!job.outline?.length) return "brief";
    const sections = job.sections || [];
    return sections.length && sections.every((section) => (
      Boolean((section.acceptedDraft || section.draft || "").trim())
    )) ? "review" : "draft";
  }
  if (["brief", "outline-running"].includes(job.status) && !job.outline?.length) return "brief";
  if (["outline-review"].includes(job.status)) return "outline";
  if (["drafting", "paused"].includes(job.status)) return "draft";
  if (["review", "finalizing"].includes(job.status)) return "review";
  return job.outline?.length ? "draft" : "brief";
}

export function validateCompositionBrief(brief) {
  const errors = {};
  if (!String(brief?.topic || "").trim()) errors.topic = "请填写写作主题";
  const targetWords = Math.trunc(Number(brief?.targetWords) || 0);
  if (targetWords < 100 || targetWords > 200000) {
    errors.targetWords = "目标字数需在 100 到 200000 之间";
  }
  return errors;
}

export function estimateCompositionContext({ brief, sources = [], outline = [] } = {}) {
  const briefCharacters = Object.values(brief || {}).reduce(
    (total, value) => total + String(value || "").length,
    0,
  );
  const sourceCharacters = sources.reduce(
    (total, source) => total + String(source?.content || source?.text || "").length,
    0,
  );
  const outlineCharacters = outline.reduce(
    (total, section) => total + String(section?.title || "").length + String(section?.summary || "").length,
    0,
  );
  const characters = briefCharacters + sourceCharacters + outlineCharacters;
  return {
    characters,
    estimatedTokens: Math.max(1, Math.ceil(characters / 2.4)),
    sourceCount: sources.length,
  };
}

export async function compositionContentHash(value) {
  const bytes = new TextEncoder().encode(String(value || ""));
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(8);
}

export async function createSourceSnapshots(candidates, selectedIds, capturedAt = new Date().toISOString()) {
  const selected = new Set(selectedIds || []);
  const snapshots = (Array.isArray(candidates) ? candidates : []).flatMap((source, index) => {
    const sourceId = String(source?.sourceId || source?.id || "");
    if (!selected.has(sourceId)) return [];
    const content = String(source?.content || source?.text || "");
    if (!content.trim()) return [];
    return [{
      sourceId: sourceId || `source-${index + 1}`,
      revision: String(source?.revision || source?.updatedAt || ""),
      title: String(source?.title || source?.name || "未命名资料"),
      content,
      contentHash: "",
      selectedRange: source?.selectedRange || null,
      capturedAt,
      citationSource: source.citationSource || {
        id: source.id,
        citationKey: source.citationKey,
        type: source.type,
        title: source.title || source.name,
        authors: source.authors,
        year: source.year,
        containerTitle: source.containerTitle,
        publisher: source.publisher,
        url: source.url,
        doi: source.doi,
        isbn: source.isbn,
        pages: source.pages,
        notes: source.notes,
        csl: source.csl,
      },
    }];
  });
  return Promise.all(snapshots.map(async (snapshot) => ({
    ...snapshot,
    contentHash: await compositionContentHash(snapshot.content),
  })));
}

export async function sourceChangesForJob(job, candidates) {
  const current = new Map((Array.isArray(candidates) ? candidates : []).map((source) => [
    String(source?.sourceId || source?.id || ""),
    source,
  ]));
  const changes = [];
  for (const snapshot of job?.sourceSnapshots || []) {
    const candidate = current.get(snapshot.sourceId);
    if (!candidate) {
      changes.push({ sourceId: snapshot.sourceId, title: snapshot.title, kind: "missing" });
      continue;
    }
    const snapshotHash = String(snapshot.contentHash || "").toLowerCase();
    if (/^[a-f0-9]{64}$/.test(snapshotHash)) {
      const candidateContent = String(candidate?.content || candidate?.text || "");
      const candidateHash = await compositionContentHash(candidateContent);
      if (candidateHash !== snapshotHash) {
        changes.push({ sourceId: snapshot.sourceId, title: snapshot.title, kind: "changed" });
      }
      continue;
    }
    const currentRevision = String(candidate?.revision || candidate?.updatedAt || "");
    if (currentRevision !== String(snapshot.revision || "")) {
      changes.push({ sourceId: snapshot.sourceId, title: snapshot.title, kind: "changed" });
    }
  }
  return changes;
}

export function moveOutlineSection(outline, sectionId, direction) {
  const items = [...(outline || [])];
  const index = items.findIndex((item) => item.sectionId === sectionId);
  const nextIndex = index + (direction === "up" ? -1 : 1);
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items;
  [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
  return items.map((item, order) => ({ ...item, order }));
}

export function reorderOutlineSection(outline, sectionId, beforeSectionId) {
  const items = [...(outline || [])];
  const from = items.findIndex((item) => item.sectionId === sectionId);
  const target = items.findIndex((item) => item.sectionId === beforeSectionId);
  if (from < 0 || target < 0 || from === target) return items;
  const [moved] = items.splice(from, 1);
  const adjustedTarget = items.findIndex((item) => item.sectionId === beforeSectionId);
  items.splice(adjustedTarget < 0 ? items.length : adjustedTarget, 0, moved);
  return items.map((item, order) => ({ ...item, order }));
}

export function parseCompositionOutlineText(value, targetWords = 2000) {
  const rawLines = String(value || "").split(/\r?\n/).slice(0, 300);
  const titles = rawLines.flatMap((rawLine) => {
    const withoutFence = rawLine.trim();
    if (!withoutFence || /^```/.test(withoutFence)) return [];
    const cleaned = withoutFence
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(?:[-*+•]\s+|\d{1,3}[.)、]\s*)/, "")
      .trim();
    if (!cleaned) return [];
    const locked = /(?:\[锁定\]|🔒)\s*$/.test(cleaned);
    const unlocked = cleaned.replace(/(?:\[锁定\]|🔒)\s*$/, "").trim();
    const [title, ...summaryParts] = unlocked.split(/\s*::\s*/);
    if (!title?.trim()) return [];
    return [{
      title: title.trim().slice(0, 1000),
      summary: summaryParts.join(" :: ").trim().slice(0, 12000),
      locked,
    }];
  }).slice(0, 100);
  if (!titles.length) return [];
  const wordsPerSection = Math.max(
    50,
    Math.min(50000, Math.round(Math.max(100, Number(targetWords) || 2000) / titles.length)),
  );
  return titles.map((item, index) => ({
    sectionId: `section-${index + 1}`,
    title: item.title,
    summary: item.summary,
    targetWords: wordsPerSection,
    locked: item.locked,
    order: index,
  }));
}

export function compositionRequestId(step, jobId, random = () => crypto.randomUUID()) {
  const safeStep = String(step || "task").replace(/[^a-z0-9-]/gi, "").slice(0, 24) || "task";
  const suffix = String(random()).replace(/[^a-z0-9-]/gi, "").slice(0, 48);
  return `composition-${safeStep}-${String(jobId || "new").slice(0, 24)}-${suffix}`;
}

export function sectionCompletion(job) {
  const sections = job?.sections || [];
  const done = sections.filter((section) => ["draft", "accepted"].includes(section.status)).length;
  const accepted = sections.filter((section) => section.status === "accepted").length;
  return { done, accepted, total: sections.length };
}
