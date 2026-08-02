import { diffArrays, diffWordsWithSpace } from "diff";

export function plainTextFromHtml(html) {
  const source = String(html || "");
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(source, "text/html");
    document.querySelectorAll("script, style, template").forEach((node) => node.remove());
    return (document.body.textContent || "").replace(/\s+/g, " ").trim();
  }
  return source
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeBasicHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function textLinesFromHtml(html) {
  const source = String(html || "");
  if (typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(source, "text/html");
    parsed.querySelectorAll("script, style, template").forEach((node) => node.remove());
    const blockSelector = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption, td, th";
    const blocks = [...parsed.body.querySelectorAll(blockSelector)]
      .filter((node) => !node.querySelector(blockSelector))
      .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (blocks.length) return blocks;
    const fallback = (parsed.body.textContent || "").replace(/\s+/g, " ").trim();
    return fallback ? [fallback] : [];
  }
  const lines = decodeBasicHtmlEntities(source
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|pre|figcaption|td|th|tr|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " "));
  return lines
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function contentFingerprint(value) {
  const source = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableJson(value, seen = new WeakSet(), depth = 0) {
  if (depth > 20) return '"[depth-limit]"';
  if (value === null || typeof value !== "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return '"[unserializable]"';
    }
  }
  if (seen.has(value)) return '"[circular]"';
  seen.add(value);
  const result = Array.isArray(value)
    ? `[${value.map((item) => stableJson(item, seen, depth + 1)).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key], seen, depth + 1)}`
    )).join(",")}}`;
  seen.delete(value);
  return result;
}

function attributeValue(attributes, name) {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(String(attributes || ""));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function readableMediaLabel(value) {
  let label = String(value || "").trim();
  if (!label) return "";
  try {
    label = decodeURIComponent(label);
  } catch {
    // Keep the original value when it is not URI encoded.
  }
  label = label.replace(/[?#].*$/, "").trim();
  if (!label || /^(?:data|blob):/i.test(label)) return "";
  if (/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(label)) return "";
  if (/^[a-f0-9]{24,}$/i.test(label)) return "";
  if (/^[a-z0-9+/_=-]{24,}$/i.test(label) && !/[\s.\u3400-\u9fff]/u.test(label)) return "";
  return label.slice(0, 80);
}

function mediaKindLabel(kind) {
  if (kind === "audio") return "音频";
  if (kind === "video") return "视频";
  return "图片";
}

function mediaItemDisplay(item) {
  const kindLabel = mediaKindLabel(item.kind);
  const dimensions = item.width && item.height
    ? ` · ${item.width}×${item.height}`
    : item.width
      ? ` · 宽度 ${item.width}`
      : item.height
        ? ` · 高度 ${item.height}`
        : "";
  return item.label
    ? `${kindLabel}《${item.label}》${dimensions}`
    : `${kindLabel} ${item.index + 1}${dimensions}`;
}

function describeMediaItems(items) {
  if (!items.length) return "无";
  const visible = items.slice(0, 3).map(mediaItemDisplay);
  return `${visible.join("、")}${items.length > visible.length ? ` 等 ${items.length} 项` : ""}`;
}

function mediaSnapshot(document) {
  const html = String(document?.html || "");
  const items = [];
  const consumedRanges = [];

  function addItem(kind, mediaAttributes, figureAttributes = "") {
    const source = attributeValue(mediaAttributes, "src");
    const sourceName = /^(?:data|blob):/i.test(source)
      ? ""
      : source.split(/[\\/]/).pop();
    const label = readableMediaLabel(attributeValue(figureAttributes, "data-caption"))
      || readableMediaLabel(attributeValue(figureAttributes, "data-file-name"))
      || readableMediaLabel(attributeValue(mediaAttributes, "alt"))
      || readableMediaLabel(attributeValue(mediaAttributes, "title"))
      || readableMediaLabel(attributeValue(mediaAttributes, "data-file-name"))
      || readableMediaLabel(attributeValue(mediaAttributes, "data-filename"))
      || readableMediaLabel(sourceName);
    const visibleIdentity = {
      kind,
      label: decodeBasicHtmlEntities(label),
      width: attributeValue(figureAttributes, "data-width")
        || attributeValue(mediaAttributes, "data-width")
        || attributeValue(mediaAttributes, "width"),
      height: attributeValue(mediaAttributes, "height"),
    };
    items.push({
      index: items.length,
      ...visibleIdentity,
      signature: stableJson(visibleIdentity),
    });
  }

  for (const match of html.matchAll(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi)) {
    const figureAttributes = match[1];
    const figureType = attributeValue(figureAttributes, "data-type");
    if (figureType !== "paper-image" && figureType !== "paper-media") continue;
    const mediaMatch = /<(img|audio|video)\b([^>]*)>/i.exec(match[2]);
    if (!mediaMatch) continue;
    addItem(mediaMatch[1].toLowerCase(), mediaMatch[2], figureAttributes);
    consumedRanges.push([match.index, match.index + match[0].length]);
  }

  for (const match of html.matchAll(/<(img|audio|video)\b([^>]*)>/gi)) {
    if (consumedRanges.some(([start, end]) => match.index >= start && match.index < end)) continue;
    addItem(match[1].toLowerCase(), match[2]);
  }

  const signature = stableJson(items.map((item) => item.signature));
  return {
    signature,
    items,
    display: items.length ? `${items.length} 项媒体 · ${describeMediaItems(items)}` : "无媒体",
  };
}

function mediaDeltaDisplay(beforeSnapshot, afterSnapshot) {
  const remainingAfter = [...afterSnapshot.items];
  const removed = beforeSnapshot.items.filter((item) => {
    const matchIndex = remainingAfter.findIndex((candidate) => candidate.signature === item.signature);
    if (matchIndex < 0) return true;
    remainingAfter.splice(matchIndex, 1);
    return false;
  });
  const added = remainingAfter;

  if (!removed.length && !added.length) {
    return {
      before: `原顺序：${describeMediaItems(beforeSnapshot.items)}`,
      after: `调整为：${describeMediaItems(afterSnapshot.items)}`,
    };
  }

  return {
    before: removed.length
      ? `原有：${describeMediaItems(removed)}`
      : "原版本中无对应媒体",
    after: added.length
      ? `${removed.length ? "更新为" : "新增"}：${describeMediaItems(added)}`
      : "当前版本已移除对应媒体",
  };
}

function referenceSnapshot(document) {
  const html = String(document?.html || "");
  const referenceNodes = [...html.matchAll(
    /<[^>]+\bdata-(?:citation-source-id|footnote-(?:id|ref)|equation-id)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/gi,
  )].map((match) => match[0].replace(/\s+/g, " ").trim());
  const sources = Array.isArray(document?.citationSources)
    ? document.citationSources
    : [];
  const footnotes = Array.isArray(document?.footnotes)
    ? document.footnotes
    : [];
  const signature = stableJson({
    referenceNodes,
    sources,
    footnotes,
    citationStyle: document?.citationStyle || null,
  });
  return {
    signature,
    display: `${referenceNodes.length} 处正文引用 · ${sources.length} 条文献 · ${footnotes.length} 条脚注${
      sources.length
        ? ` · ${sources.slice(0, 3).map((source) => source?.title || "未命名文献").join("、")}`
        : ""
    }`,
  };
}

function formattingMarkupSnapshot(html) {
  const ignoredTags = new Set([
    "audio",
    "img",
    "script",
    "source",
    "style",
    "template",
    "track",
    "video",
  ]);
  const formattingAttributes = [
    "align",
    "class",
    "colspan",
    "dir",
    "rowspan",
    "start",
    "style",
    "type",
    "data-code-language",
    "data-code-wrap",
    "data-text-align",
  ];
  const tokens = [...String(html || "").matchAll(
    /<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi,
  )].flatMap((match) => {
    const tag = match[2].toLowerCase();
    if (ignoredTags.has(tag)) return [];
    if (match[1]) return tag === "p" || tag === "div" ? [] : [`/${tag}`];
    const attributes = formattingAttributes.flatMap((name) => {
      const value = attributeValue(match[3], name);
      return value ? [`${name}=${value}`] : [];
    });
    if ((tag === "p" || tag === "div") && !attributes.length) return [];
    return [`${tag}${attributes.length ? `[${attributes.join(";")}]` : ""}`];
  });
  return stableJson(tokens);
}

function formattingSnapshot(document) {
  const customBackground = String(document?.customBackground || "");
  const value = {
    letterTemplateId: document?.letterTemplateId || "",
    templateId: document?.templateId || "",
    fontFamily: document?.fontFamily || "",
    fontSize: document?.fontSize ?? "",
    customBackground: customBackground
      ? contentFingerprint(customBackground)
      : "",
    typography: document?.typography || null,
    presentation: document?.presentation || null,
    lineHeight: document?.lineHeight ?? null,
    letterSpacing: document?.letterSpacing ?? null,
    paragraphSpacing: document?.paragraphSpacing ?? null,
    markup: formattingMarkupSnapshot(document?.html),
  };
  const template = value.letterTemplateId || value.templateId || "默认模板";
  const font = value.fontFamily || "默认字体";
  const size = value.fontSize ? `${value.fontSize}px` : "默认字号";
  const formatLabels = [
    [/<(?:strong|b)\b/i, "加粗"],
    [/<(?:em|i)\b/i, "斜体"],
    [/<u\b/i, "下划线"],
    [/<(?:s|del|strike)\b/i, "删除线"],
    [/<(?:ol|ul)\b/i, "列表"],
    [/<(?:table|tr|td|th)\b/i, "表格"],
    [/<blockquote\b/i, "引用块"],
    [/<(?:pre|code)\b/i, "代码"],
    [/<h[1-6]\b/i, "标题层级"],
  ].flatMap(([pattern, label]) => (pattern.test(String(document?.html || "")) ? [label] : []));
  return {
    signature: stableJson(value),
    display: `${template} · ${font} ${size} · ${
      customBackground ? "自定义背景" : "模板背景"
    } · ${formatLabels.length ? formatLabels.join("、") : "基础段落格式"}`,
  };
}

function splitInlineDiff(before, after) {
  const parts = diffWordsWithSpace(String(before || ""), String(after || ""));
  return {
    beforeParts: parts.flatMap((part, index) => (
      part.added ? [] : [{
        id: `before-${index}`,
        value: part.value,
        kind: part.removed ? "removed" : "same",
      }]
    )),
    afterParts: parts.flatMap((part, index) => (
      part.removed ? [] : [{
        id: `after-${index}`,
        value: part.value,
        kind: part.added ? "added" : "same",
      }]
    )),
  };
}

export function createSplitContentDiff(snapshotHtml, currentHtml) {
  const beforeLines = textLinesFromHtml(snapshotHtml);
  const afterLines = textLinesFromHtml(currentHtml);
  const parts = diffArrays(beforeLines, afterLines);
  const rows = [];
  let beforeLine = 1;
  let afterLine = 1;
  let partIndex = 0;

  while (partIndex < parts.length) {
    const part = parts[partIndex];
    if (!part.added && !part.removed) {
      beforeLine += part.value.length;
      afterLine += part.value.length;
      partIndex += 1;
      continue;
    }

    let removed = [];
    let added = [];
    if (part.removed) removed = part.value;
    if (part.added) added = part.value;
    const next = parts[partIndex + 1];
    if (next && ((part.removed && next.added) || (part.added && next.removed))) {
      if (next.removed) removed = next.value;
      if (next.added) added = next.value;
      partIndex += 1;
    }

    const rowCount = Math.max(removed.length, added.length);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const before = removed[rowIndex] || "";
      const after = added[rowIndex] || "";
      const inline = splitInlineDiff(before, after);
      rows.push({
        id: `${beforeLine + rowIndex}-${afterLine + rowIndex}-${rows.length}`,
        before,
        after,
        beforeLine: before ? beforeLine + rowIndex : null,
        afterLine: after ? afterLine + rowIndex : null,
        kind: before && after ? "changed" : before ? "removed" : "added",
        ...inline,
      });
    }
    beforeLine += removed.length;
    afterLine += added.length;
    partIndex += 1;
  }

  return rows;
}

export function createHistoryDiff(currentDocument, snapshotDocument) {
  const currentText = plainTextFromHtml(currentDocument?.html);
  const snapshotText = plainTextFromHtml(snapshotDocument?.html);
  const words = diffWordsWithSpace(snapshotText, currentText).map((part, index) => ({
    id: `${index}-${part.added ? "added" : part.removed ? "removed" : "same"}`,
    value: part.value,
    kind: part.added ? "added" : part.removed ? "removed" : "same",
  }));
  const currentFormatting = formattingSnapshot(currentDocument);
  const snapshotFormatting = formattingSnapshot(snapshotDocument);
  const currentReferences = referenceSnapshot(currentDocument);
  const snapshotReferences = referenceSnapshot(snapshotDocument);
  const currentMedia = mediaSnapshot(currentDocument);
  const snapshotMedia = mediaSnapshot(snapshotDocument);
  const mediaDisplay = mediaDeltaDisplay(snapshotMedia, currentMedia);
  const contentRows = createSplitContentDiff(snapshotDocument?.html, currentDocument?.html);
  const fields = [
    ["标题", snapshotDocument?.title, currentDocument?.title],
    ["作者", snapshotDocument?.author, currentDocument?.author],
    ["排版", snapshotFormatting.signature, currentFormatting.signature, snapshotFormatting.display, currentFormatting.display],
    ["引用", snapshotReferences.signature, currentReferences.signature, snapshotReferences.display, currentReferences.display],
    ["媒体", snapshotMedia.signature, currentMedia.signature, mediaDisplay.before, mediaDisplay.after],
  ].flatMap(([
    label,
    beforeSignature,
    afterSignature,
    beforeDisplay = beforeSignature,
    afterDisplay = afterSignature,
  ]) => (
    String(beforeSignature ?? "") === String(afterSignature ?? "")
      ? []
      : [{
        label,
        before: String(beforeDisplay ?? ""),
        after: String(afterDisplay ?? ""),
      }]
  ));
  return {
    words,
    fields,
    contentRows,
    changed: contentRows.length > 0 || fields.length > 0,
  };
}

export async function filterCurrentAutomaticHistoryEntries(
  entries,
  {
    currentDocument,
    readSnapshot,
    maxChecks = 5,
  } = {},
) {
  const filtered = Array.isArray(entries) ? entries.slice() : [];
  if (!currentDocument || typeof readSnapshot !== "function") return filtered;

  let checks = 0;
  while (filtered[0]?.kind === "auto" && checks < maxChecks) {
    const candidate = filtered[0];
    let snapshotDocument = null;
    try {
      snapshotDocument = await readSnapshot(candidate);
    } catch {
      break;
    }
    if (!snapshotDocument || createHistoryDiff(currentDocument, snapshotDocument).changed) break;
    filtered.shift();
    checks += 1;
  }
  return filtered;
}

export function historyEntryLabel(entry) {
  if (entry?.name) return entry.name;
  if (entry?.kind === "pre-restore") return "恢复前安全版本";
  if (entry?.kind === "manual") return "命名版本";
  return "自动版本";
}

export function formatHistoryTime(value) {
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
