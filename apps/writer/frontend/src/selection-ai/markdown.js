import { parseAiResponseBlocks } from "../ai/markdown.js";

const MAX_INLINE_NESTING = 8;
const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const ESCAPABLE_MARKDOWN_CHARACTERS = new Set([
  "\\",
  "`",
  "*",
  "_",
  "~",
  "[",
  "]",
  "(",
  ")",
]);

function pushTextToken(tokens, text) {
  if (!text) return;
  const previous = tokens[tokens.length - 1];
  if (previous?.type === "text") {
    previous.text += text;
    return;
  }
  tokens.push({ type: "text", text });
}

export function normalizeSelectionAiMarkdownLink(value) {
  const source = String(value || "").trim();
  if (!source || source.length > 2048) return "";
  try {
    const url = new URL(source);
    return SAFE_LINK_PROTOCOLS.has(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function findEmphasisEnd(value, marker, startIndex) {
  let endIndex = value.indexOf(marker, startIndex + marker.length);
  while (endIndex >= 0) {
    if (marker.length === 2 && marker[0] === marker[1]) {
      let markerRunLength = marker.length;
      while (
        value[endIndex + markerRunLength] === marker[0]
      ) {
        markerRunLength += 1;
      }
      endIndex += markerRunLength - marker.length;
    }
    const content = value.slice(startIndex + marker.length, endIndex);
    if (content.trim()) return endIndex;
    endIndex = value.indexOf(marker, endIndex + marker.length);
  }
  return -1;
}

function parseSelectionAiInlineMarkdownAtDepth(text, depth) {
  const value = String(text || "");
  if (!value || depth >= MAX_INLINE_NESTING) {
    return value ? [{ type: "text", text: value }] : [];
  }

  const tokens = [];
  let plainText = "";
  const flushPlainText = () => {
    pushTextToken(tokens, plainText);
    plainText = "";
  };

  for (let index = 0; index < value.length;) {
    const character = value[index];

    if (
      character === "\\"
      && index + 1 < value.length
      && ESCAPABLE_MARKDOWN_CHARACTERS.has(value[index + 1])
    ) {
      plainText += value[index + 1];
      index += 2;
      continue;
    }

    if (character === "`") {
      let markerLength = 1;
      while (value[index + markerLength] === "`") markerLength += 1;
      const marker = "`".repeat(markerLength);
      const endIndex = value.indexOf(marker, index + markerLength);
      if (endIndex > index + markerLength) {
        flushPlainText();
        tokens.push({
          type: "code",
          text: value.slice(index + markerLength, endIndex),
        });
        index = endIndex + markerLength;
        continue;
      }
    }

    if (character === "[") {
      const labelEnd = value.indexOf("](", index + 1);
      const hrefEnd = labelEnd >= 0 ? value.indexOf(")", labelEnd + 2) : -1;
      if (labelEnd > index + 1 && hrefEnd > labelEnd + 2) {
        const literal = value.slice(index, hrefEnd + 1);
        const href = normalizeSelectionAiMarkdownLink(
          value.slice(labelEnd + 2, hrefEnd),
        );
        flushPlainText();
        if (href) {
          tokens.push({
            type: "link",
            href,
            children: parseSelectionAiInlineMarkdownAtDepth(
              value.slice(index + 1, labelEnd),
              depth + 1,
            ),
          });
        } else {
          pushTextToken(tokens, literal);
        }
        index = hrefEnd + 1;
        continue;
      }
    }

    const pairedMarker = value.startsWith("**", index)
      ? { marker: "**", type: "strong" }
      : value.startsWith("__", index)
        ? { marker: "__", type: "strong" }
        : value.startsWith("~~", index)
          ? { marker: "~~", type: "delete" }
          : null;
    if (pairedMarker) {
      const endIndex = findEmphasisEnd(value, pairedMarker.marker, index);
      if (endIndex >= 0) {
        flushPlainText();
        tokens.push({
          type: pairedMarker.type,
          children: parseSelectionAiInlineMarkdownAtDepth(
            value.slice(index + pairedMarker.marker.length, endIndex),
            depth + 1,
          ),
        });
        index = endIndex + pairedMarker.marker.length;
        continue;
      }
    }

    if (
      (character === "*" || character === "_")
      && value[index - 1] !== character
      && value[index + 1] !== character
    ) {
      const underscoreInsideWord = character === "_"
        && /[\p{L}\p{N}]/u.test(value[index - 1] || "")
        && /[\p{L}\p{N}]/u.test(value[index + 1] || "");
      const endIndex = underscoreInsideWord
        ? -1
        : findEmphasisEnd(value, character, index);
      if (endIndex >= 0) {
        flushPlainText();
        tokens.push({
          type: "emphasis",
          children: parseSelectionAiInlineMarkdownAtDepth(
            value.slice(index + 1, endIndex),
            depth + 1,
          ),
        });
        index = endIndex + 1;
        continue;
      }
    }

    plainText += character;
    index += 1;
  }

  flushPlainText();
  return tokens;
}

export function parseSelectionAiInlineMarkdown(text) {
  return parseSelectionAiInlineMarkdownAtDepth(text, 0);
}

function selectionAiListItemStart(line) {
  const ordered = String(line || "").match(/^\s{0,3}(\d+)[.)]\s+(.+)$/);
  if (ordered) {
    return {
      type: "orderedList",
      number: Number(ordered[1]),
      text: ordered[2].trim(),
    };
  }
  const bullet = String(line || "").match(/^\s{0,3}[-+*]\s+(.+)$/);
  if (bullet) {
    return {
      type: "bulletList",
      text: bullet[1].trim(),
    };
  }
  return null;
}

function selectionAiListContinuation(line) {
  const match = String(line || "").match(/^(?:\t| {2,4})(.*)$/);
  if (!match || !match[1].trim()) return null;
  return match[1].trimEnd();
}

function parsePlainBlocks(lines, blocks) {
  if (!lines.length) return;
  const regularLines = [];
  const flushRegularLines = () => {
    if (!regularLines.length) return;
    blocks.push(...parseAiResponseBlocks(regularLines.join("\n")));
    regularLines.length = 0;
  };

  for (let index = 0; index < lines.length;) {
    const firstItem = selectionAiListItemStart(lines[index]);
    if (!firstItem) {
      regularLines.push(lines[index]);
      index += 1;
      continue;
    }

    flushRegularLines();
    const listBlock = { type: firstItem.type, items: [] };
    while (index < lines.length) {
      const item = selectionAiListItemStart(lines[index]);
      if (!item || item.type !== listBlock.type) break;
      const itemLines = [item.text];
      index += 1;
      while (index < lines.length) {
        if (selectionAiListItemStart(lines[index])) break;
        const continuation = selectionAiListContinuation(lines[index]);
        if (continuation === null) break;
        itemLines.push(continuation);
        index += 1;
      }
      listBlock.items.push({
        ...(item.number ? { number: item.number } : {}),
        text: itemLines.join("\n"),
      });
    }
    blocks.push(listBlock);
  }

  flushRegularLines();
  lines.length = 0;
}

function fenceStart(line) {
  const match = String(line || "").match(/^\s{0,3}(`{3,}|~{3,})\s*([^`]*)$/);
  if (!match) return null;
  return {
    character: match[1][0],
    length: match[1].length,
    language: match[2].trim().slice(0, 40),
  };
}

function isFenceEnd(line, fence) {
  const trimmed = String(line || "").trim();
  if (trimmed.length < fence.length) return false;
  return [...trimmed].every((character) => character === fence.character);
}

export function parseSelectionAiMarkdown(text) {
  const blocks = [];
  const plainLines = [];
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = fenceStart(line);
    if (fence) {
      parsePlainBlocks(plainLines, blocks);
      const codeLines = [];
      index += 1;
      while (index < lines.length && !isFenceEnd(lines[index], fence)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({
        type: "code",
        language: fence.language,
        text: codeLines.join("\n"),
      });
      continue;
    }

    const quoteMatch = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quoteMatch) {
      parsePlainBlocks(plainLines, blocks);
      const quoteLines = [quoteMatch[1]];
      while (index + 1 < lines.length) {
        const nextQuote = lines[index + 1].match(/^\s{0,3}>\s?(.*)$/);
        if (!nextQuote) break;
        quoteLines.push(nextQuote[1]);
        index += 1;
      }
      blocks.push({ type: "quote", text: quoteLines.join("\n").trim() });
      continue;
    }

    plainLines.push(line);
  }

  parsePlainBlocks(plainLines, blocks);
  return blocks;
}
