export const RESEARCH_TRANSLATION_MAX_CHARACTERS = 200_000;
export const RESEARCH_TRANSLATION_TARGET_LANGUAGE = "zh-CN";
export const RESEARCH_TRANSLATION_TEXT_CHUNK_CHARACTERS = 6_000;

const PROTECTED_RICH_TEXT_SELECTOR = "pre, code, math, svg, script, style";

function needsLatinSeparator(left, right) {
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

function splitBoundedText(value, maximum = RESEARCH_TRANSLATION_TEXT_CHUNK_CHARACTERS) {
  const source = String(value || "");
  if (source.length <= maximum) return [{ start: 0, end: source.length, text: source }];
  const parts = [];
  let start = 0;
  while (start < source.length) {
    let end = Math.min(source.length, start + maximum);
    if (end < source.length) {
      const preferred = Math.max(
        source.lastIndexOf("。", end),
        source.lastIndexOf("！", end),
        source.lastIndexOf("？", end),
        source.lastIndexOf(". ", end),
        source.lastIndexOf("; ", end),
        source.lastIndexOf(" ", end),
      );
      if (preferred > start + Math.floor(maximum * 0.55)) end = preferred + 1;
    }
    parts.push({ start, end, text: source.slice(start, end) });
    start = end;
  }
  return parts;
}

export function translationCharacterCount(blocks = []) {
  return blocks.reduce((total, block) => total + String(block?.text || "").length, 0);
}

export function translationMap(entries = []) {
  return new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry.id, entry.text]));
}

export function createPlainTextTranslationPlan(value) {
  const source = String(value || "");
  const blocks = [];
  const linePattern = /[^\r\n]+/g;
  let match;
  let lineIndex = 0;
  while ((match = linePattern.exec(source))) {
    if (!match[0].trim()) continue;
    splitBoundedText(match[0]).forEach((part, partIndex) => {
      blocks.push({
        id: `text-${lineIndex}-${partIndex}`,
        text: part.text,
        start: match.index + part.start,
        end: match.index + part.end,
      });
    });
    lineIndex += 1;
  }
  return { source, blocks };
}

export function applyPlainTextTranslationPlan(plan, translations) {
  const map = translations instanceof Map ? translations : translationMap(translations);
  let output = "";
  let cursor = 0;
  for (const block of plan?.blocks || []) {
    output += plan.source.slice(cursor, block.start);
    output += map.get(block.id) ?? block.text;
    cursor = block.end;
  }
  output += String(plan?.source || "").slice(cursor);
  return output;
}

function isTranslatableTableCell(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return !/^[\s\d.,:+\-*/%=()\[\]{}<>¥￥$€£%‰年月日时分秒]+$/u.test(text);
}

export function createTableTranslationPlan(rows = []) {
  const sourceRows = (Array.isArray(rows) ? rows : []).map((row) => (
    (Array.isArray(row) ? row : []).map((cell) => String(cell ?? ""))
  ));
  const blocks = [];
  sourceRows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      if (!isTranslatableTableCell(cell)) return;
      splitBoundedText(cell).forEach((part, partIndex) => {
        blocks.push({
          id: `cell-${rowIndex}-${columnIndex}-${partIndex}`,
          text: part.text,
          rowIndex,
          columnIndex,
          partIndex,
        });
      });
    });
  });
  return { rows: sourceRows, blocks };
}

export function applyTableTranslationPlan(plan, translations) {
  const map = translations instanceof Map ? translations : translationMap(translations);
  const rows = (plan?.rows || []).map((row) => [...row]);
  const partsByCell = new Map();
  for (const block of plan?.blocks || []) {
    const key = `${block.rowIndex}:${block.columnIndex}`;
    const list = partsByCell.get(key) || [];
    list.push(map.get(block.id) ?? block.text);
    partsByCell.set(key, list);
  }
  for (const [key, parts] of partsByCell) {
    const [rowIndex, columnIndex] = key.split(":").map(Number);
    if (rows[rowIndex]) rows[rowIndex][columnIndex] = parts.join("");
  }
  return rows;
}

export function createRichTextTranslationPlan(html, documentApi = globalThis.document) {
  if (!documentApi?.createElement || !documentApi?.createTreeWalker) {
    return { html: String(html || ""), blocks: [] };
  }
  const root = documentApi.createElement("div");
  root.innerHTML = String(html || "");
  const blocks = [];
  const walker = documentApi.createTreeWalker(root, documentApi.defaultView?.NodeFilter?.SHOW_TEXT || 4);
  const nodes = [];
  let node = walker.nextNode();
  while (node) {
    if (
      node.parentElement
      && !node.parentElement.closest(PROTECTED_RICH_TEXT_SELECTOR)
      && String(node.nodeValue || "").trim()
    ) nodes.push(node);
    node = walker.nextNode();
  }
  nodes.forEach((textNode, nodeIndex) => {
    const source = String(textNode.nodeValue || "");
    const leading = source.match(/^\s*/u)?.[0] || "";
    const trailing = source.match(/\s*$/u)?.[0] || "";
    const text = source.slice(leading.length, source.length - trailing.length);
    if (!text) return;
    const fragment = documentApi.createDocumentFragment();
    if (leading) fragment.append(documentApi.createTextNode(leading));
    splitBoundedText(text).forEach((part, partIndex) => {
      const id = `rich-${nodeIndex}-${partIndex}`;
      const marker = documentApi.createElement("span");
      marker.dataset.researchTranslationId = id;
      marker.textContent = part.text;
      fragment.append(marker);
      blocks.push({ id, text: part.text });
    });
    if (trailing) fragment.append(documentApi.createTextNode(trailing));
    textNode.replaceWith(fragment);
  });
  return { html: root.innerHTML, blocks };
}

export function applyRichTextTranslationPlan(plan, translations, documentApi = globalThis.document) {
  if (!documentApi?.createElement || !documentApi?.createTreeWalker) return String(plan?.html || "");
  const map = translations instanceof Map ? translations : translationMap(translations);
  const root = documentApi.createElement("div");
  root.innerHTML = String(plan?.html || "");
  for (const block of plan?.blocks || []) {
    const marker = root.querySelector(`[data-research-translation-id="${block.id}"]`);
    marker?.replaceWith(documentApi.createTextNode(map.get(block.id) ?? block.text));
  }
  return root.innerHTML;
}

export function createPdfTranslationPlan(textContent = null) {
  const items = (Array.isArray(textContent?.items) ? textContent.items : [])
    .filter((item) => typeof item?.str === "string")
    .map((item, itemIndex) => ({
      itemIndex,
      text: item.str,
      hasEOL: Boolean(item.hasEOL),
      x: Number(item.transform?.[4]) || 0,
      y: Number(item.transform?.[5]) || 0,
      height: Math.max(1, Math.abs(Number(item.height)) || Math.hypot(Number(item.transform?.[2]) || 0, Number(item.transform?.[3]) || 0) || 1),
    }));
  const lines = [];
  let current = [];
  const flush = () => {
    if (!current.length) return;
    let text = "";
    current.forEach((item) => {
      if (text && needsLatinSeparator(text, item.text)) text += " ";
      text += item.text;
    });
    if (text.trim()) {
      lines.push({
        id: `pdf-${current[0].itemIndex}-${current.at(-1).itemIndex}`,
        text,
        itemIndexes: current.map((item) => item.itemIndex),
      });
    }
    current = [];
  };
  for (const item of items) {
    const previous = current.at(-1);
    const sameLine = !previous
      || Math.abs(previous.y - item.y) <= Math.max(2, Math.min(previous.height, item.height) * 0.55);
    if (previous && !sameLine) flush();
    current.push(item);
    if (item.hasEOL) flush();
  }
  flush();
  return { blocks: lines };
}

export function measurePdfTranslationBlocks(blocks, textDivs, pageSurface) {
  if (!pageSurface?.getBoundingClientRect || !Array.isArray(textDivs)) return [];
  const pageRect = pageSurface.getBoundingClientRect();
  return (blocks || []).map((block) => {
    const rects = block.itemIndexes
      .map((itemIndex) => textDivs[itemIndex]?.getBoundingClientRect?.())
      .filter((rect) => rect && rect.width >= 0 && rect.height >= 0);
    if (!rects.length) return null;
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return {
      id: block.id,
      text: block.text,
      left: Math.max(0, left - pageRect.left - 1),
      top: Math.max(0, top - pageRect.top - 1),
      width: Math.max(8, right - left + 2),
      height: Math.max(8, bottom - top + 2),
    };
  }).filter(Boolean);
}
