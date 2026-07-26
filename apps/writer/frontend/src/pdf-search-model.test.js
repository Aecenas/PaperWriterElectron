import assert from "node:assert/strict";
import test from "node:test";
import {
  createPdfPageSearchIndex,
  findPdfPageSearchMatches,
  normalizePdfSearchQuery,
  preferredPdfSearchMatchIndex,
} from "./research/pdf-search-model.js";

test("PDF search index keeps text item geometry mapping and ignores marked-content controls", () => {
  const index = createPdfPageSearchIndex({
    items: [
      { type: "beginMarkedContent" },
      { str: "资料" },
      { str: "搜索" },
      { type: "endMarkedContent" },
    ],
  });

  assert.equal(index.text, "资料搜索");
  assert.deepEqual(index.strings, ["资料", "搜索"]);
  assert.deepEqual(index.offsets, [
    { itemIndex: 0, start: 0, end: 2 },
    { itemIndex: 1, start: 2, end: 4 },
  ]);
});

test("PDF search finds case-insensitive non-overlapping matches across text items", () => {
  const index = createPdfPageSearchIndex({
    items: [{ str: "Research " }, { str: "PREVIEW research" }],
  });
  const result = findPdfPageSearchMatches(index, "research", { page: 7, startIndex: 3 });

  assert.equal(result.nextIndex, 5);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.matches.map(({ index: matchIndex, page, segments }) => ({ matchIndex, page, segments })), [
    {
      matchIndex: 3,
      page: 7,
      segments: [{ itemIndex: 0, start: 0, end: 8 }],
    },
    {
      matchIndex: 4,
      page: 7,
      segments: [{ itemIndex: 1, start: 8, end: 16 }],
    },
  ]);

  const acrossItems = findPdfPageSearchMatches(index, "ch preview", { page: 7 });
  assert.deepEqual(acrossItems.matches[0].segments, [
    { itemIndex: 0, start: 6, end: 9 },
    { itemIndex: 1, start: 0, end: 7 },
  ]);
});

test("PDF search reports truncated limits and chooses a preferred page deterministically", () => {
  const index = createPdfPageSearchIndex({ items: [{ str: "高高高高" }] });
  const result = findPdfPageSearchMatches(index, "高", { page: 2, maxMatches: 2 });
  assert.equal(result.matches.length, 2);
  assert.equal(result.truncated, true);

  const matches = [
    { page: 1 },
    { page: 3 },
    { page: 3 },
    { page: 8 },
  ];
  assert.equal(preferredPdfSearchMatchIndex(matches, 3), 1);
  assert.equal(preferredPdfSearchMatchIndex(matches, 5), 3);
  assert.equal(preferredPdfSearchMatchIndex(matches, 9), 0);
  assert.equal(preferredPdfSearchMatchIndex([], 1), -1);
});

test("PDF search query is trimmed and bounded", () => {
  assert.equal(normalizePdfSearchQuery("  资料  "), "资料");
  assert.equal(normalizePdfSearchQuery("x".repeat(300)).length, 256);
});
