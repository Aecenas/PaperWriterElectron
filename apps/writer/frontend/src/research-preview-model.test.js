import assert from "node:assert/strict";
import test from "node:test";
import {
  countPreviewSearchMatches,
  normalizePreviewSearchQuery,
  parseDelimitedPreview,
  segmentPreviewSearch,
  spreadsheetColumnLabel,
} from "./research-preview-model.js";

test("CSV and TSV previews preserve quoted delimiters, newlines and escaped quotes", () => {
  assert.deepEqual(parseDelimitedPreview('名称,摘录\r\n论文,"第一行,含逗号"\r\n记录,"两行\n内容"').rows, [
    ["名称", "摘录"],
    ["论文", "第一行,含逗号"],
    ["记录", "两行\n内容"],
  ]);
  assert.deepEqual(parseDelimitedPreview('名称\t内容\nA\t"他说""你好"""', "\t").rows, [
    ["名称", "内容"],
    ["A", '他说"你好"'],
  ]);
});

test("delimited previews bound rows and columns and report truncation", () => {
  const result = parseDelimitedPreview("a,b,c\n1,2,3\n4,5,6", ",", { maxRows: 2, maxColumns: 2 });
  assert.deepEqual(result.rows, [["a", "b"], ["1", "2"]]);
  assert.equal(result.truncated, true);
});

test("delimited previews form a rectangular grid and expose Excel-style column labels", () => {
  const parsed = parseDelimitedPreview("first\nsecond,third");
  assert.deepEqual(parsed.rows, [["first", ""], ["second", "third"]]);
  assert.equal(parsed.columnCount, 2);
  assert.deepEqual([0, 25, 26, 51, 52, 79].map(spreadsheetColumnLabel), ["A", "Z", "AA", "AZ", "BA", "CB"]);
});

test("preview search is case-insensitive, indexed and bounded", () => {
  assert.equal(normalizePreviewSearchQuery("  资料  "), "资料");
  const result = segmentPreviewSearch("资料 A，资料 a", "A", { startIndex: 3 });
  assert.deepEqual(result.segments.filter((segment) => segment.match), [
    { text: "A", match: true, index: 3 },
    { text: "a", match: true, index: 4 },
  ]);
  assert.equal(result.nextIndex, 5);
  assert.deepEqual(countPreviewSearchMatches("aaaa", "a", 2), { count: 2, truncated: true });
});
