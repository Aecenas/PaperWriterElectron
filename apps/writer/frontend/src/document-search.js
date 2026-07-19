const DEFAULT_BLOCK_SEPARATOR = "\n";
const DEFAULT_MAX_MATCHES = 10_000;

const JSON_TEXTBLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "codeBlock",
  "tableCell",
  "tableHeader",
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

function nodeTypeName(node) {
  return typeof node?.type === "string" ? node.type : (node?.type?.name || "");
}

function jsonNodeSize(node, isRoot = false) {
  if (!node || typeof node !== "object") return 0;
  if (node.type === "text") return String(node.text || "").length;
  const content = Array.isArray(node.content) ? node.content : [];
  const contentSize = content.reduce((total, child) => total + jsonNodeSize(child), 0);
  if (isRoot || node.type === "doc") return contentSize;
  return JSON_LEAF_NODE_TYPES.has(node.type) ? 1 : contentSize + 2;
}

function collectJsonTextEntries(root) {
  const entries = [];

  const visit = (node, position, textblockKey, path, isRoot = false) => {
    if (!node || typeof node !== "object") return;
    const type = node.type || "";
    if (type === "text") {
      const text = String(node.text || "");
      if (text) {
        entries.push({ text, from: position, to: position + text.length, blockKey: textblockKey || path, kind: "text" });
      }
      return;
    }
    if (type === "hardBreak") {
      entries.push({ text: "\n", from: position, to: position + 1, blockKey: textblockKey || path, kind: "hardBreak" });
      return;
    }

    const nextTextblockKey = JSON_TEXTBLOCK_TYPES.has(type) ? path : textblockKey;
    const content = Array.isArray(node.content) ? node.content : [];
    let childPosition = isRoot || type === "doc" ? position : position + 1;
    content.forEach((child, index) => {
      const childPath = `${path}.${index}`;
      visit(child, childPosition, nextTextblockKey, childPath);
      childPosition += jsonNodeSize(child);
    });
  };

  visit(root, 0, "", "root", true);
  return entries;
}

function collectProseMirrorTextEntries(doc) {
  const entries = [];
  const textblockIds = new WeakMap();
  let nextTextblockId = 1;
  const getTextblockKey = (parent, fallbackPosition) => {
    if (!parent || typeof parent !== "object") return `block-${fallbackPosition}`;
    if (!textblockIds.has(parent)) textblockIds.set(parent, `block-${nextTextblockId++}`);
    return textblockIds.get(parent);
  };

  doc.descendants((node, position, parent) => {
    const type = nodeTypeName(node);
    const blockKey = getTextblockKey(parent, position);
    if (node?.isText) {
      const text = String(node.text ?? node.textContent ?? "");
      if (text) entries.push({ text, from: position, to: position + text.length, blockKey, kind: "text" });
      return;
    }
    if (type === "hardBreak") {
      entries.push({ text: "\n", from: position, to: position + Math.max(1, Number(node.nodeSize) || 1), blockKey, kind: "hardBreak" });
    }
  });
  return entries;
}

function normalizeSourceDocument(document) {
  if (document?.descendants && typeof document.descendants === "function") {
    return collectProseMirrorTextEntries(document);
  }
  const json = typeof document?.toJSON === "function" ? document.toJSON() : document;
  return collectJsonTextEntries(json && typeof json === "object" ? json : { type: "doc", content: [] });
}

/**
 * Builds a searchable plain-text projection while retaining exact ProseMirror
 * positions for every projected segment. Adjacent text nodes in one textblock
 * stay contiguous, so matches can cross bold/link mark boundaries.
 */
export function buildDocumentTextMap(document, options = {}) {
  const blockSeparator = typeof options.blockSeparator === "string"
    ? options.blockSeparator
    : DEFAULT_BLOCK_SEPARATOR;
  const entries = normalizeSourceDocument(document).sort((left, right) => left.from - right.from);
  const segments = [];
  let text = "";
  let previousEntry = null;

  entries.forEach((entry) => {
    if (previousEntry && previousEntry.blockKey !== entry.blockKey && blockSeparator) {
      const plainStart = text.length;
      text += blockSeparator;
      segments.push({
        kind: "separator",
        text: blockSeparator,
        plainStart,
        plainEnd: text.length,
        from: previousEntry.to,
        to: entry.from,
      });
    }
    const plainStart = text.length;
    text += entry.text;
    segments.push({
      kind: entry.kind,
      text: entry.text,
      plainStart,
      plainEnd: text.length,
      from: entry.from,
      to: entry.to,
    });
    previousEntry = entry;
  });

  return { text, segments, blockSeparator };
}

function mapStartBoundary(textMap, plainOffset) {
  const segment = textMap.segments.find((item) => plainOffset >= item.plainStart && plainOffset < item.plainEnd);
  if (!segment) return null;
  if (segment.kind === "separator") return segment.from;
  return Math.min(segment.to, segment.from + (plainOffset - segment.plainStart));
}

function mapEndBoundary(textMap, plainOffset) {
  const segment = textMap.segments.find((item) => plainOffset > item.plainStart && plainOffset <= item.plainEnd);
  if (!segment) return null;
  if (segment.kind === "separator") return segment.to;
  return Math.min(segment.to, segment.from + (plainOffset - segment.plainStart));
}

export function plainTextRangeToDocumentRange(textMap, plainStart, plainEnd) {
  if (!textMap || !Array.isArray(textMap.segments)) return null;
  const start = Math.max(0, Math.floor(Number(plainStart)));
  const end = Math.min(textMap.text.length, Math.floor(Number(plainEnd)));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
  const from = mapStartBoundary(textMap, start);
  const to = mapEndBoundary(textMap, end);
  return Number.isFinite(from) && Number.isFinite(to) && from < to ? { from, to } : null;
}

function foldForLiteralSearch(value) {
  let folded = "";
  const starts = [];
  const ends = [];
  let sourceOffset = 0;
  for (const character of String(value || "")) {
    const sourceStart = sourceOffset;
    sourceOffset += character.length;
    const foldedCharacter = character.toLocaleLowerCase();
    folded += foldedCharacter;
    for (let index = 0; index < foldedCharacter.length; index += 1) {
      starts.push(sourceStart);
      ends.push(sourceOffset);
    }
  }
  return { folded, starts, ends };
}

/** Finds non-overlapping, literal matches. */
export function findDocumentTextMatches(documentOrMap, query, options = {}) {
  const textMap = documentOrMap?.segments && typeof documentOrMap.text === "string"
    ? documentOrMap
    : buildDocumentTextMap(documentOrMap, options);
  const normalizedQuery = String(query || "");
  if (!normalizedQuery) return { query: normalizedQuery, textMap, matches: [], truncated: false };

  const caseSensitive = Boolean(options.caseSensitive);
  const source = caseSensitive
    ? { folded: textMap.text, starts: null, ends: null }
    : foldForLiteralSearch(textMap.text);
  const needle = caseSensitive ? normalizedQuery : foldForLiteralSearch(normalizedQuery).folded;
  if (!needle) return { query: normalizedQuery, textMap, matches: [], truncated: false };

  const maxMatches = Math.max(1, Math.floor(Number(options.maxMatches) || DEFAULT_MAX_MATCHES));
  const matches = [];
  let cursor = 0;
  let truncated = false;
  while (cursor <= source.folded.length - needle.length) {
    const found = source.folded.indexOf(needle, cursor);
    if (found < 0) break;
    const plainStart = caseSensitive ? found : source.starts[found];
    const plainEnd = caseSensitive ? found + needle.length : source.ends[found + needle.length - 1];
    const documentRange = plainTextRangeToDocumentRange(textMap, plainStart, plainEnd);
    if (documentRange) {
      matches.push({
        index: matches.length,
        plainStart,
        plainEnd,
        from: documentRange.from,
        to: documentRange.to,
        text: textMap.text.slice(plainStart, plainEnd),
      });
    }
    cursor = found + Math.max(1, needle.length);
    if (matches.length >= maxMatches) {
      truncated = source.folded.indexOf(needle, cursor) >= 0;
      break;
    }
  }
  return { query: normalizedQuery, textMap, matches, truncated };
}

export function createDocumentSearchState(searchResult = {}, activeIndex = 0) {
  const matches = Array.isArray(searchResult.matches) ? searchResult.matches : [];
  const normalizedIndex = matches.length
    ? ((Math.floor(Number(activeIndex) || 0) % matches.length) + matches.length) % matches.length
    : -1;
  return {
    query: typeof searchResult.query === "string" ? searchResult.query : "",
    matches,
    total: matches.length,
    activeIndex: normalizedIndex,
    activeMatch: normalizedIndex >= 0 ? matches[normalizedIndex] : null,
    truncated: Boolean(searchResult.truncated),
    textMap: searchResult.textMap || null,
  };
}

export function searchDocumentText(document, query, options = {}) {
  return createDocumentSearchState(findDocumentTextMatches(document, query, options), options.activeIndex || 0);
}

export function moveActiveDocumentSearchMatch(state, delta = 1) {
  return createDocumentSearchState(state, (Number(state?.activeIndex) || 0) + (Number(delta) || 0));
}

export function setActiveDocumentSearchMatch(state, index) {
  return createDocumentSearchState(state, index);
}

/** Applies literal replacements from the end of the document in one caller-owned transaction. */
export function applyDocumentTextReplacements(transaction, matches, replacement = "") {
  if (!transaction || typeof transaction.insertText !== "function") return { transaction, count: 0 };
  const safeMatches = (Array.isArray(matches) ? matches : [])
    .map((match) => ({ from: Number(match?.from), to: Number(match?.to) }))
    .filter((match) => Number.isFinite(match.from) && Number.isFinite(match.to) && match.from >= 0 && match.to > match.from)
    .sort((left, right) => right.from - left.from);
  safeMatches.forEach((match) => transaction.insertText(String(replacement ?? ""), match.from, match.to));
  return { transaction, count: safeMatches.length };
}
