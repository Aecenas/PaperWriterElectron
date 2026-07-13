export const EMPTY_PAPER_DERIVED_STATE = Object.freeze({
  stats: Object.freeze({ words: 0, paragraphs: 0, images: 0, quotes: 0, pageBreaks: 0, pages: 1 }),
  outlineItems: Object.freeze([]),
  headingItems: Object.freeze([]),
  tableOfContentsPositions: Object.freeze([]),
  hasFinalizedBreak: false,
  hasTableOfContents: false,
  imageCount: 0,
});

export function computePaperDerivedState(doc) {
  if (!doc?.descendants) return EMPTY_PAPER_DERIVED_STATE;
  const outlineItems = [];
  const headingItems = [];
  const tableOfContentsPositions = [];
  let lastTextEnd = null;
  let words = 0;
  let insideLatinWord = false;
  let paragraphs = 0;
  let images = 0;
  let quotes = 0;
  let pageBreaks = 0;
  let hasFinalizedBreak = false;
  let hasTableOfContents = false;

  doc.descendants((node, pos) => {
    const type = node.type?.name || "";
    if (node.isText) {
      if (lastTextEnd !== null && pos > lastTextEnd) insideLatinWord = false;
      const text = node.text || node.textContent || "";
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        const code = text.charCodeAt(index);
        if (code >= 0x4e00 && code <= 0x9fff) {
          words += 1;
          insideLatinWord = false;
        } else if (
          (code >= 0x30 && code <= 0x39)
          || (code >= 0x41 && code <= 0x5a)
          || (code >= 0x61 && code <= 0x7a)
        ) {
          if (!insideLatinWord) words += 1;
          insideLatinWord = true;
        } else if (!(insideLatinWord && (character === "-" || character === "'"))) {
          insideLatinWord = false;
        }
      }
      lastTextEnd = pos + node.nodeSize;
      return;
    }
    if (node.isTextblock && node.textContent?.trim()) paragraphs += 1;
    if (type === "image") images += 1;
    if (type === "blockquote") quotes += 1;
    if (type === "paperPageBreak") pageBreaks += 1;
    if (type === "paperFinalizedBreak") hasFinalizedBreak = true;
    if (type === "paperTableOfContents") {
      hasTableOfContents = true;
      tableOfContentsPositions.push({ pos, nodeSize: node.nodeSize });
      outlineItems.push({ id: `toc-${pos}`, type: "toc", level: 1, text: "目录", pos });
      return false;
    }
    if (type === "heading") {
      const level = Number(node.attrs?.level) || 1;
      const text = node.textContent?.trim();
      if (level >= 1 && level <= 3 && text) {
        headingItems.push({
          id: `heading-${pos}-${level}`,
          level,
          text,
          pos,
          numberingMode: ["inherit", "on", "off"].includes(node.attrs?.numberingMode) ? node.attrs.numberingMode : "inherit",
        });
        outlineItems.push({ id: `${pos}-${level}-${text}`, type: "heading", level, text, pos });
      }
    }
    return true;
  });

  return {
    stats: {
      words,
      paragraphs,
      images,
      quotes,
      pageBreaks,
      pages: pageBreaks + 1,
    },
    outlineItems,
    headingItems,
    tableOfContentsPositions,
    hasFinalizedBreak,
    hasTableOfContents,
    imageCount: images,
  };
}
