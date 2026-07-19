import { normalizeImageCaption, normalizeImageText } from "./content-limits.js";
import { normalizeEmbedWidth, normalizeImageSource } from "./resource-safety.js";

export const AI_APPLY_RESOLUTION_VERSION = 1;
export const DEFAULT_AI_APPLY_MINIMUM_CONFIDENCE = 0.7;

const ALLOWED_ACTIONS = new Set(["replace", "insert_before", "insert_after", "unresolved"]);
const DEFAULT_PROTECTED_BLOCK_TYPES = new Set([
  "paperFinalizedBreak",
  "paperTableOfContents",
  "paperFootnoteList",
  "paperBibliography",
  "paperPageBreak",
  "paperHorizontalRule",
  "paperMedia",
  "image",
]);
const JSON_LEAF_NODE_TYPES = new Set([
  "hardBreak",
  "horizontalRule",
  "image",
  "paperFinalizedBreak",
  "paperHorizontalRule",
  "paperMedia",
  "paperPageBreak",
  "paperTableOfContents",
  "paperFootnoteList",
  "paperBibliography",
]);
const MAX_BLOCK_TEXT_CHARS = 100_000;
const MAX_RESOLUTION_IDS = 1_000;
const AI_APPLY_REPAIRABLE_CODES = new Set([
  "invalid_json",
  "invalid_schema",
  "unsupported_version",
  "invalid_action",
  "invalid_confidence",
  "invalid_reason",
  "invalid_targets",
  "invalid_anchor",
  "invalid_replace",
  "invalid_insert",
  "invalid_unresolved",
  "stale_manifest",
  "empty_range",
  "duplicate_target",
  "unknown_target",
  "protected_target",
  "non_contiguous_target",
  "unknown_anchor",
  "protected_anchor",
]);

function typeName(node) {
  return typeof node?.type === "string" ? node.type : (node?.type?.name || "");
}

function toJsonDocument(document) {
  const value = typeof document?.toJSON === "function" ? document.toJSON() : document;
  return value && typeof value === "object" ? value : { type: "doc", content: [] };
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

function hashString(value) {
  let hash = 0x811c9dc5;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function fingerprintAiApplyDocument(document) {
  return `doc-${hashString(stableSerialize(toJsonDocument(document)))}`;
}

function jsonNodeSize(node, root = false) {
  if (!node || typeof node !== "object") return 0;
  if (node.type === "text") return String(node.text || "").length;
  const children = Array.isArray(node.content) ? node.content : [];
  const contentSize = children.reduce((total, child) => total + jsonNodeSize(child), 0);
  if (root || node.type === "doc") return contentSize;
  return JSON_LEAF_NODE_TYPES.has(node.type) ? 1 : contentSize + 2;
}

function nodePlainText(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return String(node.text || "");
  if (node.type === "hardBreak") return "\n";
  const children = Array.isArray(node.content) ? node.content : [];
  const separator = new Set(["blockquote", "bulletList", "orderedList", "listItem", "table", "tableRow", "tableCell", "tableHeader"]).has(node.type)
    ? "\n"
    : "";
  return children.map(nodePlainText).filter(Boolean).join(separator).slice(0, MAX_BLOCK_TEXT_CHARS);
}

/**
 * Creates a deterministic, ephemeral root-block manifest. Positions are valid
 * for the exact document fingerprint only and are suitable for one transaction.
 */
export function buildAiApplyBlockManifest(document, options = {}) {
  const json = toJsonDocument(document);
  const content = Array.isArray(json.content) ? json.content : [];
  const protectedTypes = new Set(options.protectedBlockTypes || DEFAULT_PROTECTED_BLOCK_TYPES);
  const finalizedBoundaryIndex = content.findIndex((node) => typeName(node) === "paperFinalizedBreak");
  const documentFingerprint = fingerprintAiApplyDocument(json);
  let position = 0;
  const blocks = content.map((node, index) => {
    const type = typeName(node) || "unknown";
    const nodeSize = jsonNodeSize(node);
    const signature = hashString(`${index}:${stableSerialize(node)}`);
    const protectionReasons = [];
    if (finalizedBoundaryIndex >= 0 && index < finalizedBoundaryIndex) protectionReasons.push("finalized");
    if (protectedTypes.has(type)) protectionReasons.push("structural");
    if (node?.attrs?.locked || node?.attrs?.aiProtected || node?.attrs?.protected) protectionReasons.push("locked");
    const block = {
      id: `block-${index + 1}-${signature}`,
      index,
      type,
      text: nodePlainText(node),
      canonical: stableSerialize(node),
      from: position,
      to: position + nodeSize,
      nodeSize,
      signature,
      protected: protectionReasons.length > 0,
      protectionReasons: [...new Set(protectionReasons)],
    };
    position += nodeSize;
    return block;
  });
  return {
    version: AI_APPLY_RESOLUTION_VERSION,
    documentFingerprint,
    finalizedBoundaryIndex,
    blocks,
  };
}

/** Returns the minimal document-only payload that may be sent to the resolver model. */
export function toAiApplyResolverManifest(manifest) {
  return {
    version: AI_APPLY_RESOLUTION_VERSION,
    documentFingerprint: String(manifest?.documentFingerprint || ""),
    blocks: Array.isArray(manifest?.blocks) ? manifest.blocks.map((block) => ({
      id: block.id,
      index: block.index,
      type: block.type,
      text: block.text,
      protected: Boolean(block.protected),
    })) : [],
  };
}

export function doesAiApplyManifestMatchDocument(manifest, document) {
  return Boolean(manifest?.documentFingerprint)
    && manifest.documentFingerprint === fingerprintAiApplyDocument(document);
}

function failure(code, error) {
  return { ok: false, code, error };
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeBlockId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return id && id.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(id) ? id : "";
}

function parseResolutionJson(input) {
  if (typeof input !== "string") return input;
  const source = input.trim();
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(source);
  const json = fenced ? fenced[1].trim() : source;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

/** Strictly parses the model response. A single enclosing JSON fence is tolerated. */
export function validateAiApplyResolution(input) {
  const value = parseResolutionJson(input);
  if (value === null && typeof input === "string") return failure("invalid_json", "裁决结果不是有效 JSON");
  if (!isPlainObject(value)) return failure("invalid_schema", "裁决结果必须是对象");
  if (Number(value.version) !== AI_APPLY_RESOLUTION_VERSION) {
    return failure("unsupported_version", `裁决版本必须为 ${AI_APPLY_RESOLUTION_VERSION}`);
  }
  if (!ALLOWED_ACTIONS.has(value.action)) return failure("invalid_action", "裁决动作不受支持");
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return failure("invalid_confidence", "confidence 必须位于 0 到 1 之间");
  }
  const reason = typeof value.reason === "string" ? value.reason.trim().slice(0, 2_000) : "";
  if (!reason) return failure("invalid_reason", "reason 必须是非空字符串");
  const targetSource = value.targetBlockIds === undefined || value.targetBlockIds === null ? [] : value.targetBlockIds;
  if (!Array.isArray(targetSource) || targetSource.length > MAX_RESOLUTION_IDS) {
    return failure("invalid_targets", "targetBlockIds 必须是有限数组");
  }
  const targetBlockIds = targetSource.map(normalizeBlockId);
  if (targetBlockIds.some((id) => !id)) return failure("invalid_targets", "targetBlockIds 包含非法 ID");
  const emptyAnchor = value.anchorBlockId === undefined || value.anchorBlockId === null || value.anchorBlockId === "";
  const anchorBlockId = emptyAnchor ? "" : normalizeBlockId(value.anchorBlockId);
  if (!emptyAnchor && !anchorBlockId) return failure("invalid_anchor", "anchorBlockId 非法");
  const documentFingerprint = typeof value.documentFingerprint === "string"
    ? value.documentFingerprint.trim().slice(0, 128)
    : "";

  const allowedKeys = new Set(["version", "action", "confidence", "reason", "documentFingerprint"]);
  if (value.action === "replace") allowedKeys.add("targetBlockIds");
  if (value.action === "insert_before" || value.action === "insert_after") allowedKeys.add("anchorBlockId");
  const ignoredEmptyKeys = new Set();
  if (value.action !== "replace" && targetBlockIds.length === 0) ignoredEmptyKeys.add("targetBlockIds");
  if (value.action !== "insert_before" && value.action !== "insert_after" && !anchorBlockId) ignoredEmptyKeys.add("anchorBlockId");
  const normalizedForKeys = Object.fromEntries(Object.entries(value).filter(([key]) => !ignoredEmptyKeys.has(key)));
  if (!hasOnlyKeys(normalizedForKeys, allowedKeys)) {
    return failure("invalid_schema", "裁决结果包含当前动作不允许的字段");
  }

  if (value.action === "replace" && (!targetBlockIds.length || anchorBlockId)) {
    return failure("invalid_replace", "替换动作必须且只能提供 targetBlockIds");
  }
  if ((value.action === "insert_before" || value.action === "insert_after") && (!anchorBlockId || targetBlockIds.length)) {
    return failure("invalid_insert", "插入动作必须且只能提供 anchorBlockId");
  }
  if (value.action === "unresolved" && (targetBlockIds.length || anchorBlockId || !reason)) {
    return failure("invalid_unresolved", "无法定位时只能提供非空 reason");
  }

  return {
    ok: true,
    resolution: {
      version: AI_APPLY_RESOLUTION_VERSION,
      action: value.action,
      confidence,
      reason,
      documentFingerprint,
      ...(value.action === "replace" ? { targetBlockIds } : {}),
      ...(value.action === "insert_before" || value.action === "insert_after" ? { anchorBlockId } : {}),
    },
  };
}

export function validateContinuousAiApplyRange(targetBlockIds, manifest) {
  if (!Array.isArray(targetBlockIds) || !targetBlockIds.length) {
    return failure("empty_range", "没有可替换的正文块");
  }
  const blocks = Array.isArray(manifest?.blocks) ? manifest.blocks : [];
  const byId = new Map(blocks.map((block) => [block.id, block]));
  if (new Set(targetBlockIds).size !== targetBlockIds.length) {
    return failure("duplicate_target", "替换范围包含重复正文块");
  }
  const selected = targetBlockIds.map((id) => byId.get(id));
  if (selected.some((block) => !block)) return failure("unknown_target", "替换范围包含不存在的正文块");
  if (selected.some((block) => block.protected)) return failure("protected_target", "替换范围包含定稿区或受保护结构块");
  for (let index = 1; index < selected.length; index += 1) {
    if (selected[index].index !== selected[index - 1].index + 1) {
      return failure("non_contiguous_target", "替换范围必须按正文顺序连续排列");
    }
  }
  return {
    ok: true,
    blocks: selected,
    from: selected[0].from,
    to: selected[selected.length - 1].to,
  };
}

export function validateAiApplyResolutionAgainstManifest(input, manifest, options = {}) {
  const parsed = validateAiApplyResolution(input);
  if (!parsed.ok) return parsed;
  const resolution = parsed.resolution;
  if (!resolution.documentFingerprint || resolution.documentFingerprint !== manifest?.documentFingerprint) {
    return failure("stale_manifest", "裁决结果对应的正文版本已经过期");
  }
  if (resolution.action === "unresolved") {
    return { ok: true, unresolved: true, resolution, operation: null };
  }
  const minimumConfidence = Number.isFinite(Number(options.minimumConfidence))
    ? Math.max(0, Math.min(1, Number(options.minimumConfidence)))
    : DEFAULT_AI_APPLY_MINIMUM_CONFIDENCE;
  if (resolution.confidence < minimumConfidence) {
    return failure("low_confidence", "裁决可信度不足，正文未修改");
  }

  if (resolution.action === "replace") {
    const range = validateContinuousAiApplyRange(resolution.targetBlockIds, manifest);
    if (!range.ok) return range;
    return {
      ok: true,
      unresolved: false,
      resolution,
      operation: {
        action: "replace",
        from: range.from,
        to: range.to,
        targetBlockIds: [...resolution.targetBlockIds],
        documentFingerprint: manifest.documentFingerprint,
      },
    };
  }

  const anchor = manifest?.blocks?.find((block) => block.id === resolution.anchorBlockId);
  if (!anchor) return failure("unknown_anchor", "插入锚点不存在");
  if (anchor.protected) return failure("protected_anchor", "不能以定稿区或受保护结构块作为插入锚点");
  const position = resolution.action === "insert_before" ? anchor.from : anchor.to;
  return {
    ok: true,
    unresolved: false,
    resolution,
    operation: {
      action: resolution.action,
      from: position,
      to: position,
      anchorBlockId: anchor.id,
      documentFingerprint: manifest.documentFingerprint,
    },
  };
}

export function shouldRetryAiApplyResolution(result) {
  return Boolean(result && !result.ok && AI_APPLY_REPAIRABLE_CODES.has(result.code));
}

function rawResolutionText(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

/** Runs at most two resolver attempts while keeping the first document snapshot fixed. */
export async function resolveAiDirectApplyWithRepair({
  resolver,
  manifest,
  selectedAiBlock,
  optimizationContext = {},
  getCurrentDocument,
}) {
  if (typeof resolver !== "function" || typeof getCurrentDocument !== "function") {
    return { ...failure("resolver_unavailable", "定位模型暂时不可用"), attempts: 0 };
  }
  const request = {
    manifest: toAiApplyResolverManifest(manifest),
    selectedBlock: selectedAiBlock,
    optimizationContext,
  };
  let response;
  try {
    response = await resolver(request);
  } catch {
    return { ...failure("resolver_unavailable", "定位模型暂时不可用"), attempts: 1 };
  }
  if (!response?.ok) return { ...failure("resolver_unavailable", "定位模型暂时不可用"), attempts: 1 };
  let result = createRebasedAiDirectApplyOperation(response.raw, manifest, getCurrentDocument(), selectedAiBlock);
  if (!result.ok && shouldRetryAiApplyResolution(result)) {
    try {
      response = await resolver({
        ...request,
        repair: {
          code: result.code,
          message: result.error,
          previousRaw: rawResolutionText(response.raw),
        },
      });
    } catch {
      return { ...failure("resolver_unavailable", "定位模型暂时不可用"), attempts: 2 };
    }
    if (!response?.ok) return { ...failure("resolver_unavailable", "定位模型暂时不可用"), attempts: 2 };
    result = createRebasedAiDirectApplyOperation(response.raw, manifest, getCurrentDocument(), selectedAiBlock);
    return { ...result, attempts: 2, model: response.model || null };
  }
  return { ...result, attempts: 1, model: response.model || null };
}

function sameSnapshotBlock(left, right) {
  return Boolean(left && right && left.type === right.type && left.canonical === right.canonical);
}

function contextMatchScore(sourceBlocks, sourceStart, sourceLength, currentBlocks, currentStart) {
  let score = 0;
  if (sourceStart > 0 && currentStart > 0 && sameSnapshotBlock(sourceBlocks[sourceStart - 1], currentBlocks[currentStart - 1])) score += 1;
  const sourceAfter = sourceStart + sourceLength;
  const currentAfter = currentStart + sourceLength;
  if (sourceAfter < sourceBlocks.length && currentAfter < currentBlocks.length
    && sameSnapshotBlock(sourceBlocks[sourceAfter], currentBlocks[currentAfter])) score += 1;
  return score;
}

function chooseUniqueRebasedStart(sourceBlocks, sourceStart, sourceLength, currentBlocks) {
  if (sourceStart < 0 || sourceLength < 1) return -1;
  const candidates = [];
  for (let currentStart = 0; currentStart + sourceLength <= currentBlocks.length; currentStart += 1) {
    let matches = true;
    for (let offset = 0; offset < sourceLength; offset += 1) {
      if (!sameSnapshotBlock(sourceBlocks[sourceStart + offset], currentBlocks[currentStart + offset])) {
        matches = false;
        break;
      }
    }
    if (matches) {
      candidates.push({
        start: currentStart,
        score: contextMatchScore(sourceBlocks, sourceStart, sourceLength, currentBlocks, currentStart),
      });
    }
  }
  if (candidates.length === 1) return candidates[0].start;
  if (!candidates.length) return -1;
  const maximum = Math.max(...candidates.map((candidate) => candidate.score));
  const strongest = candidates.filter((candidate) => candidate.score === maximum);
  return maximum > 0 && strongest.length === 1 ? strongest[0].start : -1;
}

/** Reuses a valid resolver decision after unrelated document edits. */
export function rebaseAiApplyResolution(resolutionInput, sourceManifest, currentDocument) {
  const validated = validateAiApplyResolutionAgainstManifest(resolutionInput, sourceManifest);
  if (!validated.ok || validated.unresolved) return validated;
  const currentManifest = buildAiApplyBlockManifest(currentDocument);
  if (currentManifest.documentFingerprint === sourceManifest.documentFingerprint) {
    return { ok: true, resolution: validated.resolution, manifest: currentManifest };
  }

  const sourceBlocks = Array.isArray(sourceManifest?.blocks) ? sourceManifest.blocks : [];
  const currentBlocks = currentManifest.blocks;
  if (validated.resolution.action === "replace") {
    const sourceStart = sourceBlocks.findIndex((block) => block.id === validated.resolution.targetBlockIds[0]);
    const sourceLength = validated.resolution.targetBlockIds.length;
    const currentStart = chooseUniqueRebasedStart(sourceBlocks, sourceStart, sourceLength, currentBlocks);
    if (currentStart < 0) return failure("stale_target", "原文目标已经变化或无法唯一定位");
    const targets = currentBlocks.slice(currentStart, currentStart + sourceLength);
    if (targets.some((block) => block.protected)) return failure("protected_target", "替换范围包含定稿区或受保护结构块");
    return {
      ok: true,
      manifest: currentManifest,
      resolution: {
        ...validated.resolution,
        targetBlockIds: targets.map((block) => block.id),
        documentFingerprint: currentManifest.documentFingerprint,
      },
    };
  }

  const sourceStart = sourceBlocks.findIndex((block) => block.id === validated.resolution.anchorBlockId);
  const currentStart = chooseUniqueRebasedStart(sourceBlocks, sourceStart, 1, currentBlocks);
  if (currentStart < 0) return failure("stale_target", "原文插入位置已经变化或无法唯一定位");
  const anchor = currentBlocks[currentStart];
  if (anchor.protected) return failure("protected_anchor", "不能以定稿区或受保护结构块作为插入锚点");
  return {
    ok: true,
    manifest: currentManifest,
    resolution: {
      ...validated.resolution,
      anchorBlockId: anchor.id,
      documentFingerprint: currentManifest.documentFingerprint,
    },
  };
}

function trimText(value, maximum = MAX_BLOCK_TEXT_CHARS) {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function splitInlineMarkdown(text) {
  const source = trimText(text);
  const parts = [];
  let plainStart = 0;
  let index = 0;
  const pushPlain = (end) => {
    if (end > plainStart) parts.push({ text: source.slice(plainStart, end), marks: [] });
  };
  while (index < source.length) {
    if (source.startsWith("**", index)) {
      const end = source.indexOf("**", index + 2);
      if (end > index + 2) {
        pushPlain(index);
        parts.push({ text: source.slice(index + 2, end), marks: [{ type: "bold" }] });
        index = end + 2;
        plainStart = index;
        continue;
      }
    }
    if (source[index] === "*" && source[index - 1] !== "*" && source[index + 1] !== "*") {
      const end = source.indexOf("*", index + 1);
      if (end > index + 1) {
        pushPlain(index);
        parts.push({ text: source.slice(index + 1, end), marks: [{ type: "italic" }] });
        index = end + 1;
        plainStart = index;
        continue;
      }
    }
    index += 1;
  }
  pushPlain(source.length);
  return parts.filter((part) => part.text);
}

function inlineTiptapContent(text) {
  const lines = trimText(text).split("\n");
  const content = [];
  lines.forEach((line, lineIndex) => {
    if (lineIndex) content.push({ type: "hardBreak" });
    splitInlineMarkdown(line).forEach((part) => {
      content.push({
        type: "text",
        text: part.text,
        ...(part.marks.length ? { marks: part.marks } : {}),
      });
    });
  });
  return content;
}

function paragraphNode(text) {
  const content = inlineTiptapContent(text);
  return { type: "paragraph", ...(content.length ? { content } : {}) };
}

function normalizeListItems(items) {
  return Array.isArray(items)
    ? items.slice(0, 1_000).map((item) => ({ text: trimText(item?.text, 20_000), number: Number(item?.number) || 0 })).filter((item) => item.text)
    : [];
}

function normalizeTable(block) {
  const headers = Array.isArray(block?.headers) ? block.headers.slice(0, 50).map((cell) => trimText(cell, 20_000)) : [];
  const rows = Array.isArray(block?.rows) ? block.rows.slice(0, 1_000) : [];
  const width = Math.max(headers.length, ...rows.map((row) => (Array.isArray(row) ? Math.min(50, row.length) : 0)), 0);
  if (!width) return null;
  const normalizedHeaders = Array.from({ length: width }, (_, index) => headers[index] || "");
  const normalizedRows = rows.map((row) => Array.from({ length: width }, (_, index) => trimText(Array.isArray(row) ? row[index] : "", 20_000)));
  return { headers: normalizedHeaders, rows: normalizedRows };
}

/** Converts one rendered AI result block without evaluating model-provided HTML. */
export function aiResultBlockToTiptapContent(block) {
  const type = typeof block?.type === "string" ? block.type : "paragraph";
  if (type === "divider") return [{ type: "paperHorizontalRule" }];
  if (type === "heading") {
    const level = Math.max(1, Math.min(3, Math.floor(Number(block.level) || 2)));
    return [{ type: "heading", attrs: { level }, content: inlineTiptapContent(block.text) }];
  }
  if (type === "orderedList" || type === "bulletList") {
    const items = normalizeListItems(block.items);
    if (!items.length) return [];
    const list = {
      type,
      content: items.map((item) => ({ type: "listItem", content: [paragraphNode(item.text)] })),
    };
    if (type === "orderedList") list.attrs = { start: Math.max(1, Math.floor(items[0].number || 1)) };
    return [list];
  }
  if (type === "table") {
    const table = normalizeTable(block);
    if (!table) return [];
    const rowNode = (cells, cellType) => ({
      type: "tableRow",
      content: cells.map((cell) => ({ type: cellType, content: [paragraphNode(cell)] })),
    });
    return [{
      type: "table",
      content: [rowNode(table.headers, "tableHeader"), ...table.rows.map((row) => rowNode(row, "tableCell"))],
    }];
  }
  if (type === "quote") {
    const paragraphs = trimText(block.text).split(/\n+/).filter(Boolean).map(paragraphNode);
    return paragraphs.length ? [{ type: "blockquote", content: paragraphs }] : [];
  }
  if (type === "image") {
    const src = normalizeImageSource(block.asset?.src);
    const caption = normalizeImageCaption(block.caption || block.asset?.caption || "图片");
    if (!src) return [paragraphNode(`图${Math.max(1, Number(block.number) || 1)}. ${caption}`)];
    return [{
      type: "image",
      attrs: {
        src,
        alt: normalizeImageText(block.asset?.alt || caption),
        title: normalizeImageText(block.asset?.title),
        width: normalizeEmbedWidth(block.asset?.width),
        caption,
      },
    }];
  }
  return [paragraphNode(block?.text || "")];
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineSafeHtml(text) {
  return trimText(text).split("\n").map((line) => splitInlineMarkdown(line).map((part) => {
    const escaped = escapeHtml(part.text);
    if (part.marks.some((mark) => mark.type === "bold")) return `<strong>${escaped}</strong>`;
    if (part.marks.some((mark) => mark.type === "italic")) return `<em>${escaped}</em>`;
    return escaped;
  }).join("")).join("<br>");
}

/** Constructs allowlisted HTML; it never passes through model-provided markup. */
export function aiResultBlockToSafeHtml(block) {
  const type = typeof block?.type === "string" ? block.type : "paragraph";
  if (type === "divider") return "<hr>";
  if (type === "heading") {
    const level = Math.max(1, Math.min(3, Math.floor(Number(block.level) || 2)));
    return `<h${level}>${inlineSafeHtml(block.text)}</h${level}>`;
  }
  if (type === "orderedList" || type === "bulletList") {
    const tag = type === "orderedList" ? "ol" : "ul";
    const items = normalizeListItems(block.items);
    const start = type === "orderedList" && items.length && items[0].number > 1 ? ` start="${Math.floor(items[0].number)}"` : "";
    return `<${tag}${start}>${items.map((item) => `<li>${inlineSafeHtml(item.text)}</li>`).join("")}</${tag}>`;
  }
  if (type === "table") {
    const table = normalizeTable(block);
    if (!table) return "";
    return `<table><thead><tr>${table.headers.map((cell) => `<th>${inlineSafeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineSafeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  if (type === "quote") {
    return `<blockquote>${trimText(block.text).split(/\n+/).filter(Boolean).map((line) => `<p>${inlineSafeHtml(line)}</p>`).join("")}</blockquote>`;
  }
  if (type === "image") {
    const src = normalizeImageSource(block.asset?.src);
    const caption = normalizeImageCaption(block.caption || block.asset?.caption || "图片");
    if (!src) return `<p>${escapeHtml(`图${Math.max(1, Number(block.number) || 1)}. ${caption}`)}</p>`;
    const alt = normalizeImageText(block.asset?.alt || caption);
    const width = normalizeEmbedWidth(block.asset?.width);
    return `<figure data-type="paper-image" data-width="${escapeHtml(width)}" data-caption="${escapeHtml(caption)}"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
  }
  return `<p>${inlineSafeHtml(block?.text || "")}</p>`;
}

export function createAiDirectApplyOperation(resolution, manifest, selectedAiBlock, options = {}) {
  const validated = validateAiApplyResolutionAgainstManifest(resolution, manifest, options);
  if (!validated.ok || validated.unresolved) return validated;
  const content = aiResultBlockToTiptapContent(selectedAiBlock);
  if (!content.length) return failure("empty_content", "选中的优化块没有可应用内容");
  return {
    ...validated,
    operation: {
      ...validated.operation,
      content,
      html: aiResultBlockToSafeHtml(selectedAiBlock),
    },
  };
}

export function createRebasedAiDirectApplyOperation(resolution, sourceManifest, currentDocument, selectedAiBlock, options = {}) {
  const rebased = rebaseAiApplyResolution(resolution, sourceManifest, currentDocument);
  if (!rebased.ok || rebased.unresolved) return rebased;
  const created = createAiDirectApplyOperation(rebased.resolution, rebased.manifest, selectedAiBlock, options);
  return created.ok ? { ...created, manifest: rebased.manifest } : created;
}

export function createManualAiDirectApplyOperation(manifest, targetBlockId, action, selectedAiBlock) {
  const resolution = {
    version: AI_APPLY_RESOLUTION_VERSION,
    action,
    confidence: 1,
    reason: "用户手动选择位置",
    documentFingerprint: manifest?.documentFingerprint || "",
    ...(action === "replace" ? { targetBlockIds: [targetBlockId] } : { anchorBlockId: targetBlockId }),
  };
  const created = createAiDirectApplyOperation(resolution, manifest, selectedAiBlock, { minimumConfidence: 0 });
  return created.ok ? { ...created, manifest } : created;
}

export function findCommentsOverlappingAiApplyOperation(operation, comments = []) {
  if (!operation || !Array.isArray(comments)) return [];
  if (operation.from === operation.to) {
    return comments.filter((comment) => Number(comment?.from) < operation.from && Number(comment?.to) > operation.from);
  }
  return comments.filter((comment) => Number(comment?.from) < operation.to && Number(comment?.to) > operation.from);
}

export function aiApplyOperationNeedsConfirmation(operation, overlappingComments = []) {
  const simpleReplace = operation?.action === "replace" && operation?.targetBlockIds?.length === 1;
  return !simpleReplace || (Array.isArray(overlappingComments) && overlappingComments.length > 0);
}
