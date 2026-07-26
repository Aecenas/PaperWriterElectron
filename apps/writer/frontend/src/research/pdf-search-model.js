export const MAX_PDF_SEARCH_MATCHES = 5000;

export function normalizePdfSearchQuery(value) {
  return String(value || "").trim().slice(0, 256);
}

export function createPdfPageSearchIndex(textContent = null) {
  const strings = [];
  for (const item of Array.isArray(textContent?.items) ? textContent.items : []) {
    if (typeof item?.str === "string") strings.push(item.str);
  }

  const offsets = [];
  let text = "";
  strings.forEach((value, itemIndex) => {
    const start = text.length;
    text += value;
    offsets.push({ itemIndex, start, end: text.length });
  });
  return { text, strings, offsets };
}

function segmentsForRange(index, start, end) {
  const segments = [];
  for (const item of index.offsets) {
    if (item.end <= start) continue;
    if (item.start >= end) break;
    const segmentStart = Math.max(start, item.start) - item.start;
    const segmentEnd = Math.min(end, item.end) - item.start;
    if (segmentEnd > segmentStart) {
      segments.push({
        itemIndex: item.itemIndex,
        start: segmentStart,
        end: segmentEnd,
      });
    }
  }
  return segments;
}

export function findPdfPageSearchMatches(
  index,
  query,
  { page = 1, startIndex = 0, maxMatches = MAX_PDF_SEARCH_MATCHES } = {},
) {
  const needle = normalizePdfSearchQuery(query);
  const limit = Math.max(0, Math.trunc(Number(maxMatches) || 0));
  const firstIndex = Math.max(0, Math.trunc(Number(startIndex) || 0));
  const text = String(index?.text || "");
  if (!needle || !text || !limit) {
    return { matches: [], nextIndex: firstIndex, truncated: false };
  }

  const haystack = text.toLocaleLowerCase("zh-CN");
  const normalizedNeedle = needle.toLocaleLowerCase("zh-CN");
  const matches = [];
  let cursor = 0;
  let matchIndex = firstIndex;

  while (cursor < text.length && matches.length < limit) {
    const start = haystack.indexOf(normalizedNeedle, cursor);
    if (start < 0) break;
    const end = start + needle.length;
    matches.push({
      index: matchIndex,
      page: Math.max(1, Math.trunc(Number(page) || 1)),
      start,
      end,
      segments: segmentsForRange(index, start, end),
    });
    cursor = end;
    matchIndex += 1;
  }

  return {
    matches,
    nextIndex: matchIndex,
    truncated: matches.length >= limit && haystack.indexOf(normalizedNeedle, cursor) >= 0,
  };
}

export function preferredPdfSearchMatchIndex(matches, preferredPage = 1) {
  if (!Array.isArray(matches) || !matches.length) return -1;
  const page = Math.max(1, Math.trunc(Number(preferredPage) || 1));
  const exact = matches.findIndex((match) => match.page === page);
  if (exact >= 0) return exact;
  const after = matches.findIndex((match) => match.page > page);
  return after >= 0 ? after : 0;
}
