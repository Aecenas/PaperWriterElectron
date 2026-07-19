import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDocumentTextReplacements,
  buildDocumentTextMap,
  createDocumentSearchState,
  findDocumentTextMatches,
  moveActiveDocumentSearchMatch,
  plainTextRangeToDocumentRange,
  searchDocumentText,
  setActiveDocumentSearchMatch,
} from "./document-search.js";

const jsonDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "跨越" },
        { type: "text", marks: [{ type: "bold" }], text: "粗体" },
        { type: "text", marks: [{ type: "link", attrs: { href: "https://example.com" } }], text: "链接" },
      ],
    },
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Second TITLE" }] },
  ],
};

test("maps plain text through adjacent marked nodes to exact ProseMirror positions", () => {
  const textMap = buildDocumentTextMap(jsonDocument);
  assert.equal(textMap.text, "跨越粗体链接\nSecond TITLE");
  assert.deepEqual(plainTextRangeToDocumentRange(textMap, 1, 6), { from: 2, to: 7 });

  const result = findDocumentTextMatches(textMap, "越粗体链");
  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0], {
    index: 0,
    plainStart: 1,
    plainEnd: 5,
    from: 2,
    to: 6,
    text: "越粗体链",
  });
});

test("maps a match spanning textblocks across the projected separator", () => {
  const result = findDocumentTextMatches(jsonDocument, "链接\nSecond");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].from, 5);
  assert.equal(result.matches[0].to, 15);
});

test("performs literal Unicode-aware case-insensitive searches without regex semantics", () => {
  const result = findDocumentTextMatches(jsonDocument, "second title");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].text, "Second TITLE");
  assert.equal(findDocumentTextMatches(jsonDocument, ".*").matches.length, 0);

  const unicodeDocument = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "İstanbul" }] }] };
  assert.equal(findDocumentTextMatches(unicodeDocument, "i").matches[0].text, "İ");
});

test("limits matches and reports truncation", () => {
  const document = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a a a" }] }] };
  const result = findDocumentTextMatches(document, "a", { maxMatches: 2 });
  assert.equal(result.matches.length, 2);
  assert.equal(result.truncated, true);
});

test("creates, selects and wraps search state", () => {
  const state = searchDocumentText(jsonDocument, "e");
  assert.equal(state.total, 2);
  assert.equal(state.activeIndex, 0);
  assert.equal(moveActiveDocumentSearchMatch(state, -1).activeIndex, 1);
  assert.equal(moveActiveDocumentSearchMatch(state, 1).activeIndex, 1);
  assert.equal(setActiveDocumentSearchMatch(state, 99).activeIndex, 1);
  assert.equal(createDocumentSearchState({ query: "none", matches: [] }).activeMatch, null);
});

test("supports ProseMirror-style descendants documents", () => {
  const firstParent = { isTextblock: true };
  const secondParent = { isTextblock: true };
  const doc = {
    descendants(callback) {
      callback({ isText: true, text: "Hello" }, 1, firstParent);
      callback({ isText: true, text: "World" }, 6, firstParent);
      callback({ isText: true, text: "Next" }, 13, secondParent);
    },
  };
  const textMap = buildDocumentTextMap(doc);
  assert.equal(textMap.text, "HelloWorld\nNext");
  assert.deepEqual(findDocumentTextMatches(textMap, "loWo").matches[0], {
    index: 0,
    plainStart: 3,
    plainEnd: 7,
    from: 4,
    to: 8,
    text: "loWo",
  });
});

test("accounts for empty textblocks when calculating JSON document positions", () => {
  const document = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "A" }] },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "B" }] },
    ],
  };
  const result = findDocumentTextMatches(document, "B");
  assert.deepEqual({ from: result.matches[0].from, to: result.matches[0].to }, { from: 6, to: 7 });
});

test("applies replace-all ranges from right to left in one caller-owned transaction", () => {
  const calls = [];
  const transaction = {
    insertText(text, from, to) {
      calls.push({ text, from, to });
      return this;
    },
  };
  const result = applyDocumentTextReplacements(transaction, [
    { from: 2, to: 4 },
    { from: 8, to: 10 },
    { from: -1, to: 3 },
  ], "替换");
  assert.equal(result.transaction, transaction);
  assert.equal(result.count, 2);
  assert.deepEqual(calls, [
    { text: "替换", from: 8, to: 10 },
    { text: "替换", from: 2, to: 4 },
  ]);
});
