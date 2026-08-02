import {
  AI_FINALIZED_END,
  AI_FINALIZED_INSTRUCTION,
  AI_FINALIZED_START,
  AI_PROMPT_PREFIX,
} from "./constants.js";
import {
  DEFAULT_TEMPLATE_PRESENTATION,
  normalizeTemplatePresentation,
} from "../templates/model.js";
import {
  normalizeImageCaption,
  normalizeImageText,
  normalizeMediaFileName,
} from "../content-limits.js";
import { normalizeEmbedWidth, normalizeImageSource } from "../resource-safety.js";

export function createAiRequestId() {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function textFromJsonNode(node) {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.text || "";
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  return (node.content || []).map(textFromJsonNode).join("");
}

export function quoteTextFromNode(node) {
  const parts = (node.content || [])
    .map((child) => textFromJsonNode(child).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (parts.length > 1) {
    const source = parts[parts.length - 1].replace(/^[-—–]+\s*/, "").trim();
    return [...parts.slice(0, -1), source].filter(Boolean).join(" —— ");
  }
  return parts.join(" —— ");
}

export function listTextFromNode(node, level = 0) {
  const lines = [];
  (node.content || []).forEach((child, index) => {
    if (child.type === "listItem") {
      const itemText = (child.content || [])
        .filter((itemChild) => itemChild.type !== "bulletList" && itemChild.type !== "orderedList")
        .map(textFromJsonNode)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (itemText) {
        const prefix = node.type === "orderedList" ? `${index + 1}. ` : "- ";
        lines.push(`${"  ".repeat(level)}${prefix}${itemText}`);
      }
      (child.content || [])
        .filter((itemChild) => itemChild.type === "bulletList" || itemChild.type === "orderedList")
        .forEach((nestedList) => {
          const nested = listTextFromNode(nestedList, level + 1);
          if (nested) {
            lines.push(nested);
          }
        });
    }
  });
  return lines.filter(Boolean).join("\n");
}

export function tableTextFromNode(node) {
  const rows = (node.content || [])
    .filter((child) => child.type === "tableRow")
    .map((row) => (row.content || [])
      .filter((cell) => cell.type === "tableCell" || cell.type === "tableHeader")
      .map((cell) => textFromJsonNode(cell).replace(/\s+/g, " ").trim()));
  if (!rows.length || !rows.some((row) => row.some(Boolean))) {
    return "";
  }
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizeRow = (row) => {
    const normalized = row.slice(0, columnCount);
    while (normalized.length < columnCount) {
      normalized.push("");
    }
    return normalized.map((cell) => cell.replace(/\|/g, "\\|"));
  };
  const [firstRow, ...bodyRows] = rows.map(normalizeRow);
  const divider = Array.from({ length: columnCount }, () => "---");
  return [firstRow, divider, ...bodyRows]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

export function extractAiBodyContent(editor, { includeFinalizedBoundary = true, includeImageCaptions = true } = {}) {
  const json = editor?.getJSON?.();
  const rootBlocks = json?.content || [];
  const lines = [];
  const assets = { images: {}, quotes: [] };
  let figureIndex = 0;
  let skipNextTocList = false;
  let finalizedBoundaryIndex = -1;

  const pushLine = (line) => {
    if (line) {
      lines.push(line);
    }
  };

  rootBlocks.forEach((node) => {
    if (skipNextTocList && (node.type === "bulletList" || node.type === "orderedList")) {
      skipNextTocList = false;
      return;
    }
    skipNextTocList = false;

    if (node.type === "paperFinalizedBreak") {
      if (includeFinalizedBoundary) {
        finalizedBoundaryIndex = lines.length;
      }
      return;
    }

    if (node.type === "paperPageBreak") {
      return;
    }

    if (node.type === "paperHorizontalRule") {
      pushLine("---");
      return;
    }

    if (node.type === "paperTableOfContents") {
      return;
    }

    if (node.type === "paperFootnoteList" || node.type === "paperBibliography") {
      return;
    }

    if (node.type === "heading") {
      const text = textFromJsonNode(node).replace(/\s+/g, " ").trim();
      if (!text) {
        return;
      }
      if (text === "目录") {
        skipNextTocList = true;
        return;
      }
      const level = Math.max(1, Math.min(4, Number(node.attrs?.level) || 1));
      pushLine(`${"#".repeat(level)} ${text}`);
      return;
    }

    if (node.type === "paragraph") {
      const text = textFromJsonNode(node).replace(/\s+/g, " ").trim();
      pushLine(text);
      return;
    }

    if (node.type === "blockquote") {
      const quote = quoteTextFromNode(node);
      if (quote) {
        assets.quotes.push({ text: quote });
        pushLine(`[引用：${quote}]`);
      }
      return;
    }

    if (node.type === "image") {
      figureIndex += 1;
      const caption = includeImageCaptions
        ? normalizeImageCaption(node.attrs?.caption || normalizeImageText(node.attrs?.alt) || "图片").trim()
        : "图片";
      assets.images[figureIndex] = {
        number: figureIndex,
        caption,
        src: normalizeImageSource(node.attrs?.src),
        alt: normalizeImageText(node.attrs?.alt || caption),
        width: normalizeEmbedWidth(node.attrs?.width),
      };
      pushLine(includeImageCaptions ? `[图${figureIndex}.${caption}]` : "[图片]");
      return;
    }

    if (node.type === "paperMermaid") {
      figureIndex += 1;
      const caption = normalizeImageCaption(node.attrs?.caption || "Mermaid 图").trim() || "Mermaid 图";
      pushLine(includeImageCaptions ? `[图${figureIndex}.${caption}]` : "[Mermaid 图]");
      return;
    }

    if (node.type === "paperMedia") {
      const kind = node.attrs?.kind === "video" ? "视频" : "音频";
      const fileName = normalizeMediaFileName(node.attrs?.fileName, `未命名${kind}`);
      pushLine(`[${kind}：${fileName}]`);
      return;
    }

    if (node.type === "table") {
      pushLine(tableTextFromNode(node));
      return;
    }

    if (node.type === "bulletList" || node.type === "orderedList") {
      const listText = listTextFromNode(node);
      pushLine(listText);
    }
  });

  const hasFinalizedBoundary = finalizedBoundaryIndex >= 0;
  if (hasFinalizedBoundary) {
    lines.splice(finalizedBoundaryIndex, 0, AI_FINALIZED_END);
    lines.unshift(AI_FINALIZED_START);
  }
  const body = lines.join("\n\n").trim();
  return { body, assets, json, hasFinalizedBoundary };
}

export function imageMimeFromSource(source = "") {
  const dataMime = /^data:(image\/[a-z0-9.+-]+);/i.exec(source)?.[1];
  if (dataMime) return dataMime.toLowerCase();
  const extension = /(?:\.|%2e)(png|jpe?g|gif|webp|bmp|svg)(?:$|[?&#%])/i.exec(source)?.[1]?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "svg") return "image/svg+xml";
  return extension ? `image/${extension}` : "";
}

export function aiChatImagesFromAssets(assets = {}) {
  return Object.values(assets.images || {}).map((image, index) => {
    const source = normalizeImageSource(image?.src);
    return {
      number: Math.max(1, Number(image?.number) || index + 1),
      caption: String(image?.caption || image?.alt || "图片").trim() || "图片",
      src: source,
      mime: imageMimeFromSource(source),
    };
  });
}

export function buildAiPromptInput(editor, presentation = DEFAULT_TEMPLATE_PRESENTATION) {
  const normalizedPresentation = normalizeTemplatePresentation(presentation);
  const { body, assets, hasFinalizedBoundary } = extractAiBodyContent(editor, {
    includeFinalizedBoundary: true,
    includeImageCaptions: normalizedPresentation.showImageCaptions,
  });
  const promptParts = hasFinalizedBoundary
    ? [AI_PROMPT_PREFIX, AI_FINALIZED_INSTRUCTION, body]
    : [AI_PROMPT_PREFIX, body];
  return {
    body,
    prompt: promptParts.filter(Boolean).join("\n\n"),
    assets,
  };
}

export function buildAiChatContextSignature(editor, document, presentation = DEFAULT_TEMPLATE_PRESENTATION) {
  const json = editor?.getJSON?.();
  const title = (document?.title || "未命名信笺").trim();
  const author = (document?.author || "").trim();
  const displayDate = (document?.displayDate || "").trim();
  return JSON.stringify({
    title,
    author,
    displayDate,
    showImageCaptions: normalizeTemplatePresentation(presentation).showImageCaptions,
    content: json?.content || [],
  });
}

export function buildAiChatContextInput(editor, document, presentation = DEFAULT_TEMPLATE_PRESENTATION, signature = "") {
  const normalizedPresentation = normalizeTemplatePresentation(presentation);
  const { body, assets } = extractAiBodyContent(editor, {
    includeFinalizedBoundary: false,
    includeImageCaptions: normalizedPresentation.showImageCaptions,
  });
  const title = (document?.title || "未命名信笺").trim();
  const author = (document?.author || "").trim();
  const displayDate = (document?.displayDate || "").trim();
  const metaLines = [
    `标题：${title}`,
    author ? `署名：${author}` : "",
    displayDate ? `日期：${displayDate}` : "",
  ].filter(Boolean);
  const context = `${metaLines.join("\n")}\n\n正文：\n${body || "（正文为空）"}`.trim();
  return {
    context,
    images: aiChatImagesFromAssets(assets),
    signature: signature || buildAiChatContextSignature(editor, document, normalizedPresentation),
  };
}

export function summarizeSelectedText(text, maxLength = 34) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

export function summarizeChatMessage(text, maxLength = 74) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) {
    return "正在思考...";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

export function formatChatMessageTime(message) {
  const match = String(message?.id || "").match(/^[^-]+-([a-z0-9]+)/i);
  const timestamp = Number(message?.createdAt) || (match ? parseInt(match[1], 36) : 0);
  const date = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : new Date();
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function createAiChatSelectionId() {
  return `selection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function buildAiOptimizationContext(blocks, selectedIndex) {
  const source = Array.isArray(blocks) ? blocks : [];
  const index = Math.max(0, Math.min(source.length - 1, Math.floor(Number(selectedIndex) || 0)));
  return {
    selectedIndex: index,
    totalBlocks: source.length,
    previousBlocks: source.slice(Math.max(0, index - 2), index),
    nextBlocks: source.slice(index + 1, index + 3),
  };
}

export function summarizeAiApplyTarget(operation, manifest, maximum = 88) {
  const blocks = Array.isArray(manifest?.blocks) ? manifest.blocks : [];
  const selected = operation?.action === "replace"
    ? blocks.filter((block) => operation.targetBlockIds?.includes(block.id))
    : blocks.filter((block) => block.id === operation?.anchorBlockId);
  const text = selected.map((block) => block.text || `[${block.type}]`).filter(Boolean).join(" / ").replace(/\s+/g, " ").trim();
  if (!text) return "目标位置附近没有可显示的文字";
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
}
