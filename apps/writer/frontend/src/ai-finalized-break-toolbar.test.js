import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");

function sourceBetween(start, end) {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return appSource.slice(from, to);
}

test("clearing the finalized break removes only that node in one transaction", () => {
  const removeFinalized = sourceBetween("function removeFinalizedBreak", "function insertTableOfContents");
  assert.match(removeFinalized, /node\.type\?\.name === "paperFinalizedBreak"/);
  assert.match(removeFinalized, /editor\.state\.doc\.content\.forEach/);
  assert.doesNotMatch(removeFinalized, /\.doc\.descendants/);
  assert.match(removeFinalized, /editor\.state\.tr\.delete\(finalizedBreakRange\.from, finalizedBreakRange\.to\)/);
  assert.doesNotMatch(removeFinalized, /setContent|clearContent/);
});

test("the finalized-line toolbar action toggles between insert and clear", () => {
  const toolbar = sourceBetween("function AiOptimizeToolbar", "function AiResultPane");
  assert.match(toolbar, /finalizedBreakInserted[\s\S]*?removeFinalizedBreak\(editor\)[\s\S]*?insertFinalizedBreak\(editor, savedSelectionRef\)/);
  assert.match(toolbar, /finalizedBreakInserted \? "清空定稿线" : "插入定稿线"/);
  assert.doesNotMatch(toolbar, /disabled=\{finalizedBreakInserted\}/);
});
