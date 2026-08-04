import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPlainTextTranslationPlan,
  applyTableTranslationPlan,
  createPdfTranslationPlan,
  createPlainTextTranslationPlan,
  createTableTranslationPlan,
  measurePdfTranslationBlocks,
  translationCharacterCount,
} from "./research/research-translation-model.js";

test("plain-text translation preserves every original line break", () => {
  const plan = createPlainTextTranslationPlan("Hello world\r\n\r\nSecond paragraph\n");
  assert.deepEqual(plan.blocks.map((block) => block.text), ["Hello world", "Second paragraph"]);
  assert.equal(applyPlainTextTranslationPlan(plan, [
    { id: plan.blocks[0].id, text: "你好，世界" },
    { id: plan.blocks[1].id, text: "第二段" },
  ]), "你好，世界\r\n\r\n第二段\n");
});

test("table translation maps text cells while leaving numeric cells unchanged", () => {
  const plan = createTableTranslationPlan([
    ["Revenue", "1,200", "2026-08-04"],
    ["North America", "42%", ""],
  ]);
  assert.deepEqual(plan.blocks.map((block) => [block.rowIndex, block.columnIndex]), [[0, 0], [1, 0]]);
  const rows = applyTableTranslationPlan(plan, plan.blocks.map((block) => ({
    id: block.id,
    text: block.text === "Revenue" ? "收入" : "北美",
  })));
  assert.deepEqual(rows, [
    ["收入", "1,200", "2026-08-04"],
    ["北美", "42%", ""],
  ]);
});

test("PDF text items form stable page blocks and retain source item indexes", () => {
  const plan = createPdfTranslationPlan({ items: [
    { str: "Hello", transform: [1, 0, 0, 10, 10, 100], height: 10 },
    { str: "world", transform: [1, 0, 0, 10, 50, 100], height: 10, hasEOL: true },
    { str: "Second line", transform: [1, 0, 0, 10, 10, 80], height: 10 },
    { str: "", transform: [1, 0, 0, 10, 10, 60], height: 10 },
  ] });
  assert.deepEqual(plan.blocks, [
    { id: "pdf-0-1", text: "Hello world", itemIndexes: [0, 1] },
    { id: "pdf-2-2", text: "Second line", itemIndexes: [2] },
  ]);
});

test("PDF translation geometry is measured relative to the scaled page surface", () => {
  const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });
  const geometry = measurePdfTranslationBlocks(
    [{ id: "pdf-0-1", text: "Hello world", itemIndexes: [0, 1] }],
    [
      { getBoundingClientRect: () => rect(110, 220, 145, 236) },
      { getBoundingClientRect: () => rect(148, 220, 190, 236) },
    ],
    { getBoundingClientRect: () => rect(100, 200, 700, 1000) },
  );
  assert.deepEqual(geometry, [{
    id: "pdf-0-1",
    text: "Hello world",
    left: 9,
    top: 19,
    width: 82,
    height: 18,
  }]);
});

test("translation character counting enforces the same 200,000-character body boundary", () => {
  assert.equal(translationCharacterCount([{ text: "x".repeat(200_000) }]), 200_000);
  assert.equal(translationCharacterCount([{ text: "x".repeat(200_001) }]), 200_001);
});
