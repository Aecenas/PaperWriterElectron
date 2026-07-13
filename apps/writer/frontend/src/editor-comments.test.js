import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { Mapping, StepMap } from "@tiptap/pm/transform";
import { mapDocumentCommentsThroughTransaction } from "./editor-comments.js";

const baseComment = { id: "comment-1", from: 2, to: 8, text: "评注", createdAt: "2026-01-01", updatedAt: "2026-01-01" };

function transactionFor(stepMap) {
  const mapping = new Mapping();
  mapping.appendMap(stepMap);
  return { docChanged: true, mapping };
}

test("maps comment ranges through insert, delete and undo mappings", () => {
  const insertion = new StepMap([4, 0, 2]);
  const inserted = mapDocumentCommentsThroughTransaction([baseComment], transactionFor(insertion), 20);
  assert.deepEqual([inserted[0].from, inserted[0].to], [2, 10]);

  const deletion = new StepMap([5, 3, 0]);
  const deleted = mapDocumentCommentsThroughTransaction(inserted, transactionFor(deletion), 20);
  assert.deepEqual([deleted[0].from, deleted[0].to], [2, 7]);

  const undone = mapDocumentCommentsThroughTransaction(inserted, transactionFor(insertion.invert()), 20);
  assert.deepEqual([undone[0].from, undone[0].to], [2, 8]);
});

test("drops a comment when its complete range is deleted", () => {
  const deletion = new StepMap([1, 10, 0]);
  assert.deepEqual(mapDocumentCommentsThroughTransaction([baseComment], transactionFor(deletion), 20), []);
});

test("reuses normalized comment references when a transaction does not move them", () => {
  const comments = [
    { ...baseComment, id: "before", from: 2, to: 4 },
    { ...baseComment, id: "after", from: 12, to: 16 },
  ];
  assert.strictEqual(mapDocumentCommentsThroughTransaction(comments, { docChanged: false }, 30), comments);

  const afterAllComments = mapDocumentCommentsThroughTransaction(comments, transactionFor(new StepMap([25, 0, 2])), 40);
  assert.strictEqual(afterAllComments, comments);

  const partlyMoved = mapDocumentCommentsThroughTransaction(comments, transactionFor(new StepMap([10, 0, 2])), 40);
  assert.notStrictEqual(partlyMoved, comments);
  assert.strictEqual(partlyMoved[0], comments[0]);
  assert.notStrictEqual(partlyMoved[1], comments[1]);
  assert.deepEqual([partlyMoved[1].from, partlyMoved[1].to], [14, 18]);
});

test("maps 5000 normalized comments across continuous transactions without re-normalizing or reallocating", () => {
  const comments = Array.from({ length: 5000 }, (_, index) => ({
    ...baseComment,
    id: `comment-${index}`,
    from: index * 3 + 1,
    to: index * 3 + 3,
  }));
  const transaction = transactionFor(new StepMap([20000, 0, 1]));
  let current = comments;
  const startedAt = performance.now();
  for (let index = 0; index < 100; index += 1) {
    current = mapDocumentCommentsThroughTransaction(current, transaction, 25000);
    assert.strictEqual(current, comments);
  }
  const elapsed = performance.now() - startedAt;
  assert.ok(elapsed < 250, `5000-comment transaction mapping took ${elapsed.toFixed(2)} ms`);
});
