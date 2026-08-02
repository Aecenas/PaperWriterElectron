import assert from "node:assert/strict";
import test from "node:test";
import { buildVisibleOutlineRows } from "./outline-model.js";

const ITEMS = [
  { id: "toc", type: "toc", level: 1, text: "目录" },
  { id: "chapter-1", type: "heading", level: 1, text: "第一章" },
  { id: "section-1", type: "heading", level: 2, text: "第一节" },
  { id: "detail-1", type: "heading", level: 3, text: "细目" },
  { id: "detail-1-1", type: "heading", level: 4, text: "细目说明" },
  { id: "section-2", type: "heading", level: 2, text: "第二节" },
  { id: "chapter-2", type: "heading", level: 1, text: "第二章" },
];

test("outline rows flag parents without treating the table of contents as a parent", () => {
  const rows = buildVisibleOutlineRows(ITEMS);
  assert.deepEqual(rows.map(({ id, hasChildren }) => ({ id, hasChildren })), [
    { id: "toc", hasChildren: false },
    { id: "chapter-1", hasChildren: true },
    { id: "section-1", hasChildren: true },
    { id: "detail-1", hasChildren: true },
    { id: "detail-1-1", hasChildren: false },
    { id: "section-2", hasChildren: false },
    { id: "chapter-2", hasChildren: false },
  ]);
});

test("collapsing a parent hides only its descendants", () => {
  assert.deepEqual(
    buildVisibleOutlineRows(ITEMS, new Set(["section-1"])).map(({ id }) => id),
    ["toc", "chapter-1", "section-1", "section-2", "chapter-2"],
  );
  assert.deepEqual(
    buildVisibleOutlineRows(ITEMS, new Set(["detail-1"])).map(({ id }) => id),
    ["toc", "chapter-1", "section-1", "detail-1", "section-2", "chapter-2"],
  );
  assert.deepEqual(
    buildVisibleOutlineRows(ITEMS, new Set(["chapter-1"])).map(({ id }) => id),
    ["toc", "chapter-1", "chapter-2"],
  );
});
