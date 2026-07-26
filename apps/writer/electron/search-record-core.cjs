const { randomUUID } = require("node:crypto");

const DEFAULT_RECORD_SEARCH_LIMITS = Object.freeze({
  maxQueryCharacters: 256,
  maxResults: 200,
  maxSnippetCharacters: 180,
  searchYieldEvery: 100,
});

const DEFAULT_SEARCH_FIELDS = Object.freeze([
  Object.freeze({ name: "fileName", weight: 500 }),
  Object.freeze({ name: "relativePath", weight: 450 }),
  Object.freeze({ name: "title", weight: 400 }),
  Object.freeze({ name: "authors", weight: 350 }),
  Object.freeze({ name: "url", weight: 300 }),
  Object.freeze({ name: "excerpt", weight: 240 }),
  Object.freeze({ name: "notes", weight: 220 }),
  Object.freeze({ name: "body", weight: 100 }),
]);

function resolveRecordSearchLimits(limits = {}) {
  const resolved = { ...DEFAULT_RECORD_SEARCH_LIMITS, ...(limits || {}) };
  for (const [name, fallback] of Object.entries(DEFAULT_RECORD_SEARCH_LIMITS)) {
    if (!Number.isSafeInteger(resolved[name]) || resolved[name] <= 0) {
      resolved[name] = fallback;
    }
  }
  return resolved;
}

function foldLiteral(value) {
  const source = String(value || "");
  let folded = "";
  const starts = [];
  const ends = [];
  let sourceOffset = 0;
  for (const character of source) {
    const sourceStart = sourceOffset;
    sourceOffset += character.length;
    const foldedCharacter = character.toLocaleLowerCase("en-US");
    folded += foldedCharacter;
    for (let index = 0; index < foldedCharacter.length; index += 1) {
      starts.push(sourceStart);
      ends.push(sourceOffset);
    }
  }
  return { source, folded, starts, ends };
}

function findLiteralMatch(value, query) {
  const haystack = foldLiteral(value);
  const needle = foldLiteral(query).folded;
  if (!needle) return null;
  const foldedStart = haystack.folded.indexOf(needle);
  if (foldedStart < 0) return null;
  const foldedEnd = foldedStart + needle.length - 1;
  const start = haystack.starts[foldedStart] ?? 0;
  const end = haystack.ends[foldedEnd] ?? start;
  return {
    start,
    end,
    length: Math.max(0, end - start),
  };
}

function createSearchSnippet(value, match, maximumCharacters) {
  const source = String(value || "");
  const maximum = Math.max(
    Math.max(1, Number(match?.length) || 0),
    Math.max(1, Number(maximumCharacters) || 1),
  );
  if (!match || match.start < 0) {
    return {
      text: source.slice(0, maximum),
      matchStart: -1,
      matchLength: 0,
    };
  }
  const context = Math.max(
    0,
    Math.floor((maximum - Math.max(1, match.length)) / 2),
  );
  let start = Math.max(0, match.start - context);
  let end = Math.min(source.length, start + maximum);
  if (end - start < maximum) start = Math.max(0, end - maximum);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
  return {
    text: `${prefix}${source.slice(start, end)}${suffix}`,
    matchStart: prefix.length + match.start - start,
    matchLength: match.length,
  };
}

function normalizeSearchFields(fields = DEFAULT_SEARCH_FIELDS) {
  const normalized = [];
  for (const candidate of Array.isArray(fields) ? fields : []) {
    const name = String(candidate?.name || "").trim();
    const weight = Number(candidate?.weight);
    if (!name || !Number.isFinite(weight)) continue;
    normalized.push({ name, weight });
  }
  return normalized.length ? normalized : [...DEFAULT_SEARCH_FIELDS];
}

function matchSearchRecord(
  record,
  query,
  {
    fields = DEFAULT_SEARCH_FIELDS,
    limits = DEFAULT_RECORD_SEARCH_LIMITS,
  } = {},
) {
  const resolvedLimits = resolveRecordSearchLimits(limits);
  const searchFields = record?.searchFields
    && typeof record.searchFields === "object"
    && !Array.isArray(record.searchFields)
    ? record.searchFields
    : {};
  for (const field of normalizeSearchFields(fields)) {
    const value = String(searchFields[field.name] || "");
    if (!value) continue;
    const match = findLiteralMatch(value, query);
    if (!match) continue;
    const snippet = createSearchSnippet(
      value,
      match,
      resolvedLimits.maxSnippetCharacters,
    );
    return {
      field: field.name,
      start: match.start,
      length: match.length,
      score: field.weight - Math.min(match.start, 99),
      snippet: snippet.text,
      snippetMatchStart: snippet.matchStart,
      snippetMatchLength: snippet.matchLength,
    };
  }
  return null;
}

async function searchRecords(
  records,
  query,
  {
    requestId = randomUUID(),
    limit,
    fields = DEFAULT_SEARCH_FIELDS,
    limits = DEFAULT_RECORD_SEARCH_LIMITS,
    signal,
    isCanceled = () => false,
    includeRecord = () => true,
    mapResult = (record, match) => ({
      ...(record?.result || {}),
      matchField: match.field,
      matchStart: match.start,
      matchLength: match.length,
      snippet: match.snippet,
      snippetMatchStart: match.snippetMatchStart,
      snippetMatchLength: match.snippetMatchLength,
      score: match.score,
    }),
    onProgress,
  } = {},
) {
  const resolvedLimits = resolveRecordSearchLimits(limits);
  const literalQuery = String(query || "")
    .trim()
    .slice(0, resolvedLimits.maxQueryCharacters);
  const maximumResults = Math.max(
    1,
    Math.min(
      Number(limit) || resolvedLimits.maxResults,
      resolvedLimits.maxResults,
    ),
  );
  if (!literalQuery) {
    return {
      requestId,
      query: "",
      canceled: false,
      results: [],
      totalMatches: 0,
      limited: false,
    };
  }
  const source = Array.isArray(records) ? records : [];
  const results = [];
  let totalMatches = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (signal?.aborted || isCanceled(requestId)) {
      return {
        requestId,
        query: literalQuery,
        canceled: true,
        results: [],
        totalMatches: 0,
        limited: false,
      };
    }
    if (index > 0 && index % resolvedLimits.searchYieldEvery === 0) {
      onProgress?.({ completed: index, total: source.length });
      await new Promise((resolve) => setImmediate(resolve));
    }
    const record = source[index];
    if (!includeRecord(record)) continue;
    const match = matchSearchRecord(record, literalQuery, {
      fields,
      limits: resolvedLimits,
    });
    if (!match) continue;
    totalMatches += 1;
    results.push(mapResult(record, match));
  }
  onProgress?.({ completed: source.length, total: source.length });
  results.sort((left, right) => (
    Number(right.score || 0) - Number(left.score || 0)
    || Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0)
    || String(left.relativePath || left.title || "").localeCompare(
      String(right.relativePath || right.title || ""),
      "zh-CN",
    )
  ));
  return {
    requestId,
    query: literalQuery,
    canceled: false,
    results: results.slice(0, maximumResults),
    totalMatches,
    limited: totalMatches > maximumResults,
  };
}

module.exports = {
  DEFAULT_RECORD_SEARCH_LIMITS,
  DEFAULT_SEARCH_FIELDS,
  createSearchSnippet,
  findLiteralMatch,
  foldLiteral,
  matchSearchRecord,
  resolveRecordSearchLimits,
  searchRecords,
};
