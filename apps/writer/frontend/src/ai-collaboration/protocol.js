import {
  aiResultBlockToSafeHtml,
  aiResultBlockToTiptapContent,
} from "../ai-direct-apply.js";
import { parseAiResponseBlocks } from "../ai/markdown.js";
import { normalizeDocumentTitle } from "../content-limits.js";
import { assertMermaidSourceWithinLimits } from "../editor/mermaid-safety.js";
import { normalizeEmbedWidth } from "../resource-safety.js";

export const COLLABORATION_PROPOSAL_VERSION = 1;
export const COLLABORATION_OPERATION_TYPES = Object.freeze([
  "set_title",
  "replace_blocks",
  "insert_before",
  "insert_after",
  "create_document",
]);

const OPERATION_TYPE_SET = new Set(COLLABORATION_OPERATION_TYPES);
const BLOCK_TYPE_SET = new Set([
  "paragraph",
  "heading",
  "orderedList",
  "bulletList",
  "quote",
  "divider",
  "table",
  "mermaid",
]);
const MAX_OPERATIONS = 50;
const MAX_BLOCKS_PER_OPERATION = 2_000;

function text(value, maximum = 200_000) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maximum)
    : "";
}

function identifier(value, fallback = "") {
  const normalized = text(value, 128).trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : fallback;
}

function operationId(value, index) {
  return identifier(value, `collaboration-operation-${index + 1}`);
}

function normalizeListItems(items) {
  return (Array.isArray(items) ? items : [])
    .slice(0, 1_000)
    .map((item, index) => ({
      text: text(item?.text ?? item, 20_000).trim(),
      number: Math.max(1, Math.floor(Number(item?.number) || index + 1)),
    }))
    .filter((item) => item.text);
}

function normalizeTable(block) {
  const headers = (Array.isArray(block?.headers) ? block.headers : [])
    .slice(0, 50)
    .map((cell) => text(cell, 20_000));
  const rows = (Array.isArray(block?.rows) ? block.rows : [])
    .slice(0, 1_000)
    .map((row) => (Array.isArray(row) ? row.slice(0, 50).map((cell) => text(cell, 20_000)) : []));
  const width = Math.max(headers.length, ...rows.map((row) => row.length), 0);
  if (!width) return null;
  return {
    headers: Array.from({ length: width }, (_, index) => headers[index] || ""),
    rows: rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || "")),
  };
}

export function normalizeCollaborationBlock(block = {}, index = 0) {
  const type = BLOCK_TYPE_SET.has(block?.type) ? block.type : "paragraph";
  if (type === "divider") return { type };
  if (type === "heading") {
    return {
      type,
      level: Math.max(1, Math.min(4, Math.floor(Number(block.level) || 2))),
      text: text(block.text, 100_000).trim(),
    };
  }
  if (type === "orderedList" || type === "bulletList") {
    return { type, items: normalizeListItems(block.items) };
  }
  if (type === "table") {
    const table = normalizeTable(block);
    return table ? { type, ...table } : { type: "paragraph", text: "" };
  }
  if (type === "mermaid") {
    const source = text(block.source, 40_000).trim();
    if (source) assertMermaidSourceWithinLimits(source);
    return {
      type,
      source,
      caption: text(block.caption || "Mermaid 图", 500).trim() || "Mermaid 图",
      width: normalizeEmbedWidth(block.width),
      diagramId: identifier(block.diagramId, `collaboration-mermaid-${index + 1}`),
    };
  }
  return {
    type,
    text: text(block.text, type === "quote" ? 200_000 : 100_000).trim(),
  };
}

export function normalizeCollaborationBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .slice(0, MAX_BLOCKS_PER_OPERATION)
    .map(normalizeCollaborationBlock)
    .filter((block) => {
      if (block.type === "divider") return true;
      if (block.type === "table") return block.headers.length > 0;
      if (block.type === "mermaid") return Boolean(block.source);
      if (block.type === "orderedList" || block.type === "bulletList") return block.items.length > 0;
      return Boolean(block.text);
    });
}

function normalizeSource(source = {}, index = 0) {
  return {
    id: identifier(source.id || source.documentId, `source-${index + 1}`),
    documentId: identifier(source.documentId),
    title: text(source.title || "未命名信笺", 200).trim() || "未命名信笺",
    relativePath: text(source.relativePath, 32768).replace(/\\/g, "/").replace(/^\/+/, ""),
    fingerprint: text(source.fingerprint, 128),
    revision: text(source.revision, 256),
  };
}

function safeRelativeFolder(value) {
  return text(value, 32768).replace(/\\/g, "/").trim();
}

function invalidRelativeFolder(value) {
  const normalized = String(value || "");
  return Boolean(normalized) && (
    normalized.startsWith("/")
    || /^[a-z]:\//i.test(normalized)
    || normalized.endsWith("/")
    || normalized.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))
  );
}

function safeFileName(value, fallback) {
  const normalized = text(value, 240)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  const base = normalized || fallback;
  return /\.letterpaper$/i.test(base) ? base : `${base}.letterpaper`;
}

export function normalizeCollaborationOperation(operation = {}, index = 0) {
  const type = OPERATION_TYPE_SET.has(operation.type) ? operation.type : "";
  if (!type) return null;
  const decision = ["accepted", "rejected"].includes(operation.decision)
    ? operation.decision
    : "pending";
  const common = {
    id: operationId(operation.id, index),
    type,
    label: text(operation.label, 240).trim(),
    decision,
    selected: decision === "accepted",
    edited: Boolean(operation.edited),
    reviewRevision: Number.isFinite(Number(operation.reviewRevision)) ? Number(operation.reviewRevision) : 0,
  };
  if (type === "set_title") {
    return { ...common, title: normalizeDocumentTitle(operation.title) };
  }
  if (type === "create_document") {
    const title = normalizeDocumentTitle(operation.title);
    return {
      ...common,
      title,
      fileName: safeFileName(operation.fileName, title),
      folderRelativePath: safeRelativeFolder(operation.folderRelativePath),
      blocks: normalizeCollaborationBlocks(operation.blocks),
      sourceDocumentIds: (Array.isArray(operation.sourceDocumentIds) ? operation.sourceDocumentIds : [])
        .slice(0, 20)
        .map((value) => identifier(value))
        .filter(Boolean),
      sourceBlockIds: (Array.isArray(operation.sourceBlockIds) ? operation.sourceBlockIds : [])
        .slice(0, 2_000)
        .map((value) => identifier(value))
        .filter(Boolean),
    };
  }
  const blocks = normalizeCollaborationBlocks(operation.blocks);
  if (type === "replace_blocks") {
    return {
      ...common,
      targetBlockIds: (Array.isArray(operation.targetBlockIds) ? operation.targetBlockIds : [])
        .slice(0, 500)
        .map((value) => identifier(value))
        .filter(Boolean),
      blocks,
    };
  }
  return {
    ...common,
    anchorBlockId: identifier(operation.anchorBlockId),
    blocks,
  };
}

export function normalizeCollaborationProposal(proposal = {}) {
  const operations = (Array.isArray(proposal.operations) ? proposal.operations : [])
    .slice(0, MAX_OPERATIONS)
    .map(normalizeCollaborationOperation)
    .filter(Boolean);
  return {
    version: COLLABORATION_PROPOSAL_VERSION,
    id: identifier(proposal.id, `collaboration-${Date.now().toString(36)}`),
    reply: text(proposal.reply || proposal.summary, 200_000).trim(),
    summary: text(proposal.summary || proposal.reply, 2_000).trim(),
    createdAt: Number.isFinite(Number(proposal.createdAt)) ? Number(proposal.createdAt) : Date.now(),
    base: {
      documentId: identifier(proposal.base?.documentId),
      documentFingerprint: text(proposal.base?.documentFingerprint, 128),
      revision: text(proposal.base?.revision, 256),
    },
    sources: (Array.isArray(proposal.sources) ? proposal.sources : []).slice(0, 20).map(normalizeSource),
    operations,
    status: ["pending", "applied", "discarded", "stale"].includes(proposal.status)
      ? proposal.status
      : "pending",
  };
}

export function validateCollaborationProposal(proposal, manifest, { documentId = "" } = {}) {
  const normalized = normalizeCollaborationProposal(proposal);
  const errors = [];
  if (!normalized.operations.length) errors.push("协作方案没有可审阅修改");
  if (documentId && normalized.base.documentId && normalized.base.documentId !== documentId) {
    errors.push("协作方案的目标信笺不匹配");
  }
  if (normalized.base.documentFingerprint && normalized.base.documentFingerprint !== manifest?.documentFingerprint) {
    errors.push("协作方案基于的正文版本已经变化");
  }
  const blockById = new Map((manifest?.blocks || []).map((block) => [block.id, block]));
  const sourceDocumentIds = new Set([
    normalized.base.documentId,
    ...normalized.sources.map((source) => source.documentId),
  ].filter(Boolean));
  const occupied = [];
  normalized.operations.forEach((operation) => {
    if (operation.type === "set_title") return;
    if (operation.type === "create_document") {
      if (invalidRelativeFolder(operation.folderRelativePath)) {
        errors.push(`${operation.label || operation.title} 的目标文件夹无效`);
      }
      if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(operation.fileName)) {
        errors.push(`${operation.label || operation.title} 的文件名是系统保留名称`);
      }
      if (!operation.blocks.length && !operation.sourceBlockIds.length && !operation.sourceDocumentIds.length) {
        errors.push(`${operation.label || operation.title} 没有正文内容`);
      }
      const invalidSourceBlocks = operation.sourceBlockIds.filter((id) => !blockById.has(id));
      if (invalidSourceBlocks.length) errors.push(`${operation.label || operation.title} 引用的来源块无效`);
      const invalidSourceDocuments = operation.sourceDocumentIds.filter((id) => !sourceDocumentIds.has(id));
      if (invalidSourceDocuments.length) errors.push(`${operation.label || operation.title} 引用的来源信笺无效`);
      return;
    }
    if (!operation.blocks.length) errors.push(`${operation.label || operation.id} 没有拟应用内容`);
    if (operation.type === "replace_blocks") {
      const targets = operation.targetBlockIds.map((id) => blockById.get(id)).filter(Boolean);
      if (targets.length !== operation.targetBlockIds.length || !targets.length) {
        errors.push(`${operation.label || operation.id} 的替换目标无效`);
        return;
      }
      if (targets.some((block) => block.protected)) errors.push(`${operation.label || operation.id} 试图修改受保护内容`);
      const indexes = targets.map((block) => block.index).sort((a, b) => a - b);
      if (indexes.some((value, index) => index && value !== indexes[index - 1] + 1)) {
        errors.push(`${operation.label || operation.id} 的替换目标不连续`);
      }
      occupied.push({ id: operation.id, from: targets[0].from, to: targets.at(-1).to });
      return;
    }
    const anchor = blockById.get(operation.anchorBlockId);
    if (!anchor || anchor.protected) errors.push(`${operation.label || operation.id} 的插入位置无效`);
  });
  occupied.sort((left, right) => left.from - right.from);
  for (let index = 1; index < occupied.length; index += 1) {
    if (occupied[index].from < occupied[index - 1].to) errors.push("协作方案包含相互重叠的正文修改");
  }
  return { ok: errors.length === 0, errors, proposal: normalized };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uuid() {
  return globalThis.crypto?.randomUUID?.()
    || "00000000-0000-4000-8000-000000000000";
}

export function collaborationBlockToTiptapContent(block) {
  if (block?.type === "mermaid") {
    assertMermaidSourceWithinLimits(block.source);
    return [{
      type: "paperMermaid",
      attrs: {
        diagramId: /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(block.diagramId || "") ? block.diagramId : uuid(),
        source: block.source,
        caption: block.caption || "Mermaid 图",
        width: normalizeEmbedWidth(block.width),
      },
    }];
  }
  return aiResultBlockToTiptapContent(block);
}

export function collaborationBlocksToTiptapContent(blocks) {
  return normalizeCollaborationBlocks(blocks).flatMap(collaborationBlockToTiptapContent);
}

export function collaborationBlocksToSafeHtml(blocks) {
  return normalizeCollaborationBlocks(blocks).map((block) => {
    if (block.type !== "mermaid") return aiResultBlockToSafeHtml(block);
    const source = assertMermaidSourceWithinLimits(block.source);
    const caption = escapeHtml(block.caption || "Mermaid 图");
    const width = normalizeEmbedWidth(block.width);
    return `<figure data-type="paper-mermaid" data-diagram-id="${escapeHtml(uuid())}" data-mermaid-source="${escapeHtml(source)}" data-caption="${caption}" data-width="${escapeHtml(width)}"><pre>${escapeHtml(source)}</pre><figcaption>${caption}</figcaption></figure>`;
  }).join("");
}

export function createCollaborationEditorOperation(operation, manifest) {
  const blockById = new Map((manifest?.blocks || []).map((block) => [block.id, block]));
  const content = collaborationBlocksToTiptapContent(operation.blocks);
  const html = collaborationBlocksToSafeHtml(operation.blocks);
  if (operation.type === "replace_blocks") {
    const targets = operation.targetBlockIds.map((id) => blockById.get(id)).filter(Boolean);
    if (!targets.length) return null;
    return {
      action: "replace",
      from: targets[0].from,
      to: targets.at(-1).to,
      targetBlockIds: targets.map((block) => block.id),
      content,
      html,
    };
  }
  const anchor = blockById.get(operation.anchorBlockId);
  if (!anchor) return null;
  const before = operation.type === "insert_before";
  const position = before ? anchor.from : anchor.to;
  return {
    action: before ? "insert_before" : "insert_after",
    from: position,
    to: position,
    anchorBlockId: anchor.id,
    content,
    html,
  };
}

export function applyCollaborationEditorOperations(editor, operations, manifest) {
  if (!editor?.state?.tr) return false;
  const resolved = operations
    .filter((operation) => ["replace_blocks", "insert_before", "insert_after"].includes(operation.type))
    .map((operation) => createCollaborationEditorOperation(operation, manifest))
    .filter(Boolean)
    .sort((left, right) => right.from - left.from || right.to - left.to);
  let transaction = editor.state.tr;
  resolved.forEach((operation) => {
    const documentNode = editor.schema.nodeFromJSON({ type: "doc", content: operation.content });
    transaction = transaction.replaceWith(operation.from, operation.to, documentNode.content);
  });
  if (!transaction.docChanged) return true;
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

export function collaborationBlocksToReviewText(blocks) {
  return normalizeCollaborationBlocks(blocks).map((block) => {
    if (block.type === "heading") return `${"#".repeat(block.level)} ${block.text}`;
    if (block.type === "divider") return "---";
    if (block.type === "quote") return block.text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
    if (block.type === "bulletList") return block.items.map((item) => `- ${item.text}`).join("\n");
    if (block.type === "orderedList") return block.items.map((item, index) => `${item.number || index + 1}. ${item.text}`).join("\n");
    if (block.type === "table") {
      return [
        `| ${block.headers.join(" | ")} |`,
        `| ${block.headers.map(() => "---").join(" | ")} |`,
        ...block.rows.map((row) => `| ${row.join(" | ")} |`),
      ].join("\n");
    }
    if (block.type === "mermaid") return `\`\`\`mermaid\n${block.source}\n\`\`\`\n\n图注：${block.caption}`;
    return block.text;
  }).join("\n\n");
}

export function parseCollaborationReviewText(value) {
  const source = text(value, 2 * 1024 * 1024);
  const blocks = [];
  let cursor = 0;
  const pattern = /```mermaid\s*\r?\n([\s\S]*?)```(?:\s*\r?\n\s*图注[:：]\s*([^\r\n]+))?/gi;
  let match;
  while ((match = pattern.exec(source))) {
    blocks.push(...parseAiResponseBlocks(source.slice(cursor, match.index)));
    blocks.push({ type: "mermaid", source: match[1].trim(), caption: match[2]?.trim() || "Mermaid 图" });
    cursor = pattern.lastIndex;
  }
  blocks.push(...parseAiResponseBlocks(source.slice(cursor)));
  return normalizeCollaborationBlocks(blocks);
}
