export function parseDelimitedPreview(value, delimiter = ",", { maxRows = 2000, maxColumns = 80 } = {}) {
  const source = String(value || "").replace(/^\ufeff/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let truncated = false;
  const pushCell = () => {
    if (row.length < maxColumns) row.push(cell);
    else truncated = true;
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (rows.length < maxRows) rows.push(row);
    else truncated = true;
    row = [];
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"' && !cell) quoted = true;
    else if (character === delimiter) pushCell();
    else if (character === "\n") pushRow();
    else if (character !== "\r") cell += character;
  }
  if (cell || row.length || (!rows.length && source)) pushRow();
  const columnCount = rows.reduce((maximum, current) => Math.max(maximum, current.length), 0);
  const rectangularRows = rows.map((current) => Array.from(
    { length: columnCount },
    (_, columnIndex) => current[columnIndex] ?? "",
  ));
  return { rows: rectangularRows, columnCount, truncated };
}

export function spreadsheetColumnLabel(index) {
  let value = Math.max(0, Math.trunc(Number(index) || 0)) + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function normalizePreviewSearchQuery(value) {
  return String(value || "").trim().slice(0, 200);
}

export function segmentPreviewSearch(value, query, { startIndex = 0, maxMatches = 5000 } = {}) {
  const text = String(value ?? "");
  const needle = normalizePreviewSearchQuery(query);
  const firstIndex = Math.max(0, Math.trunc(Number(startIndex) || 0));
  const limit = Math.max(0, Math.trunc(Number(maxMatches) || 0));
  if (!needle || !text || !limit) {
    return { segments: [{ text, match: false, index: -1 }], nextIndex: firstIndex, truncated: false };
  }
  const haystack = text.toLocaleLowerCase("zh-CN");
  const normalizedNeedle = needle.toLocaleLowerCase("zh-CN");
  const segments = [];
  let cursor = 0;
  let matchIndex = firstIndex;
  let matches = 0;
  while (cursor < text.length && matches < limit) {
    const found = haystack.indexOf(normalizedNeedle, cursor);
    if (found < 0) break;
    if (found > cursor) segments.push({ text: text.slice(cursor, found), match: false, index: -1 });
    segments.push({ text: text.slice(found, found + needle.length), match: true, index: matchIndex });
    cursor = found + needle.length;
    matchIndex += 1;
    matches += 1;
  }
  const nextMatch = cursor < text.length ? haystack.indexOf(normalizedNeedle, cursor) : -1;
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false, index: -1 });
  return {
    segments: segments.length ? segments : [{ text, match: false, index: -1 }],
    nextIndex: matchIndex,
    truncated: matches >= limit && nextMatch >= 0,
  };
}

export function countPreviewSearchMatches(value, query, maximum = 5000) {
  const result = segmentPreviewSearch(value, query, { maxMatches: maximum });
  return { count: result.nextIndex, truncated: result.truncated };
}
