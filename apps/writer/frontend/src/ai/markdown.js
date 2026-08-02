import { normalizeImageSource } from "../resource-safety.js";

export function splitQuoteForDisplay(text) {
  const value = String(text || "").trim();
  const parts = value.split(/\s+——\s+/);
  if (parts.length <= 1) {
    return { bodyParts: value ? [value] : [], source: "" };
  }
  const source = parts.pop();
  const bodyParts = parts.map((part) => part.trim()).filter(Boolean);
  return { bodyParts, source };
}

export function splitMarkdownTableRow(line) {
  const value = String(line || "").trim();
  if (!value.includes("|")) {
    return [];
  }
  const trimmed = value.replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

export function isMarkdownTableDivider(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

export function isMarkdownTableStart(lines, index) {
  const current = lines[index]?.trim() || "";
  const next = lines[index + 1]?.trim() || "";
  return current.includes("|") && splitMarkdownTableRow(current).length > 1 && isMarkdownTableDivider(next);
}

export function normalizeMarkdownTableRow(cells, width) {
  const normalized = cells.slice(0, width);
  while (normalized.length < width) {
    normalized.push("");
  }
  return normalized;
}

export function parseAiResponseBlocks(text, assets = { images: {} }) {
  const blocks = [];
  let paragraphLines = [];
  let listBlock = null;
  const flushParagraph = () => {
    const textValue = paragraphLines.join("\n").trim();
    if (textValue) {
      blocks.push({ type: "paragraph", text: textValue });
    }
    paragraphLines = [];
  };
  const flushList = () => {
    if (listBlock?.items?.length) {
      blocks.push(listBlock);
    }
    listBlock = null;
  };
  const pushListItem = (type, item) => {
    flushParagraph();
    if (!listBlock || listBlock.type !== type) {
      flushList();
      listBlock = { type, items: [] };
    }
    listBlock.items.push(item);
  };

  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (isMarkdownTableStart(lines, index)) {
      flushParagraph();
      flushList();
      const headers = splitMarkdownTableRow(line);
      const width = headers.length;
      const rows = [];
      index += 2;
      while (index < lines.length) {
        const rowLine = lines[index].trim();
        if (!rowLine || !rowLine.includes("|") || isMarkdownTableDivider(rowLine)) {
          index -= 1;
          break;
        }
        const cells = splitMarkdownTableRow(rowLine);
        if (cells.length < 2) {
          index -= 1;
          break;
        }
        rows.push(normalizeMarkdownTableRow(cells, width));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "divider" });
      continue;
    }
    const imageMatch = line.match(/^\[图\s*(\d+)\.\s*([^\]]*)\]$/);
    if (imageMatch) {
      flushParagraph();
      flushList();
      const number = Number(imageMatch[1]);
      const asset = assets.images?.[number];
      blocks.push({
        type: "image",
        number,
        caption: imageMatch[2]?.trim() || asset?.caption || "图片",
        asset,
      });
      continue;
    }
    const quoteMatch = line.match(/^\[引用[:：]\s*([\s\S]*?)\]$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: quoteMatch[1].trim() });
      continue;
    }
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: Math.min(4, headingMatch[1].length), text: headingMatch[2].trim() });
      continue;
    }
    const orderedListMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (orderedListMatch) {
      pushListItem("orderedList", {
        number: Number(orderedListMatch[1]),
        text: orderedListMatch[2].trim(),
      });
      continue;
    }
    const bulletListMatch = line.match(/^[-+*]\s+(.+)$/);
    if (bulletListMatch) {
      pushListItem("bulletList", { text: bulletListMatch[1].trim() });
      continue;
    }
    flushList();
    paragraphLines.push(rawLine);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function splitInlineMarkdown(text) {
  const parts = [];
  const value = String(text || "");
  let lastIndex = 0;
  let index = 0;
  const pushPlain = (endIndex) => {
    if (endIndex > lastIndex) {
      parts.push({ text: value.slice(lastIndex, endIndex) });
    }
  };

  while (index < value.length) {
    if (value.startsWith("**", index)) {
      const endIndex = value.indexOf("**", index + 2);
      if (endIndex > index + 2) {
        pushPlain(index);
        parts.push({ text: value.slice(index + 2, endIndex), strong: true });
        index = endIndex + 2;
        lastIndex = index;
        continue;
      }
    }

    if (value[index] === "*" && value[index - 1] !== "*" && value[index + 1] !== "*") {
      let endIndex = -1;
      for (let candidate = index + 1; candidate < value.length; candidate += 1) {
        if (value[candidate] === "*" && value[candidate - 1] !== "*" && value[candidate + 1] !== "*") {
          endIndex = candidate;
          break;
        }
      }
      const emphasisText = endIndex > index + 1 ? value.slice(index + 1, endIndex).trim() : "";
      if (emphasisText) {
        pushPlain(index);
        parts.push({ text: emphasisText, emphasis: true });
        index = endIndex + 1;
        lastIndex = index;
        continue;
      }
    }

    index += 1;
  }

  if (lastIndex < value.length) {
    parts.push({ text: value.slice(lastIndex) });
  }
  return parts.length ? parts : [{ text: value }];
}

export function splitStrongMarkdown(text) {
  return splitInlineMarkdown(text);
}

export function stripStrongMarkdown(text) {
  return splitInlineMarkdown(text).map((part) => part.text).join("");
}

export function inlineStrongHtml(text) {
  return splitInlineMarkdown(text)
    .map((part) => {
      if (part.strong) {
        return `<strong>${escapeHtml(part.text)}</strong>`;
      }
      if (part.emphasis) {
        return `<em>${escapeHtml(part.text)}</em>`;
      }
      return escapeHtml(part.text);
    })
    .join("");
}

export function aiBlockPlainText(block) {
  if (block.type === "divider") {
    return "---";
  }
  if (block.type === "orderedList") {
    return block.items.map((item, index) => `${item.number || index + 1}. ${stripStrongMarkdown(item.text)}`).join("\n");
  }
  if (block.type === "bulletList") {
    return block.items.map((item) => `- ${stripStrongMarkdown(item.text)}`).join("\n");
  }
  if (block.type === "table") {
    const header = block.headers.map(stripStrongMarkdown).join("\t");
    const rows = block.rows.map((row) => row.map(stripStrongMarkdown).join("\t"));
    return [header, ...rows].filter(Boolean).join("\n");
  }
  if (block.type === "image") {
    return `图${block.number}. ${block.caption}`;
  }
  if (block.type === "quote") {
    return `引用：${stripStrongMarkdown(block.text)}`;
  }
  return stripStrongMarkdown(block.text || "");
}

export function aiBlockHtml(block) {
  if (block.type === "divider") {
    return "<hr>";
  }
  if (block.type === "orderedList") {
    return `<ol>${block.items.map((item, index) => `<li value="${Number(item.number) || index + 1}">${inlineStrongHtml(item.text)}</li>`).join("")}</ol>`;
  }
  if (block.type === "bulletList") {
    return `<ul>${block.items.map((item) => `<li>${inlineStrongHtml(item.text)}</li>`).join("")}</ul>`;
  }
  if (block.type === "table") {
    const headers = block.headers || [];
    const rows = block.rows || [];
    return `<table><thead><tr>${headers.map((cell) => `<th>${inlineStrongHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineStrongHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  if (block.type === "image") {
    const src = normalizeImageSource(block.asset?.src);
    const caption = `图${block.number}. ${block.caption}`;
    return src
      ? `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(block.asset?.alt || block.caption)}"><figcaption>${escapeHtml(caption)}</figcaption></figure>`
      : `<p>${escapeHtml(caption)}</p>`;
  }
  if (block.type === "quote") {
    const { bodyParts, source } = splitQuoteForDisplay(block.text);
    const bodyHtml = bodyParts.map((part) => `<p>${inlineStrongHtml(part)}</p>`).join("");
    return `<blockquote>${bodyHtml}${source ? `<p>—— ${inlineStrongHtml(source)}</p>` : ""}</blockquote>`;
  }
  if (block.type === "heading") {
    const tag = `h${Math.max(1, Math.min(4, block.level || 2))}`;
    return `<${tag}>${inlineStrongHtml(block.text)}</${tag}>`;
  }
  return `<p>${inlineStrongHtml(block.text).replace(/\n/g, "<br>")}</p>`;
}
