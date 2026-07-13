import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { computePaperDerivedState } from "./editor-derived-state.js";

function node(type, options = {}) {
  return {
    type: { name: type },
    attrs: options.attrs || {},
    isText: Boolean(options.isText),
    isTextblock: Boolean(options.isTextblock),
    text: options.text || "",
    textContent: options.textContent ?? options.text ?? "",
    nodeSize: options.nodeSize ?? (options.text?.length || 1),
  };
}

function fakeDoc(entries) {
  return {
    descendants(callback) {
      entries.forEach(([item, position]) => callback(item, position));
    },
  };
}

test("derives CJK and Latin words, text blocks and structural counts in one document walk", () => {
  const derived = computePaperDerivedState(fakeDoc([
    [node("paragraph", { isTextblock: true, textContent: "中文 hello-world" }), 0],
    [node("text", { isText: true, text: "中文 ", nodeSize: 3 }), 1],
    [node("text", { isText: true, text: "hello-", nodeSize: 6 }), 4],
    [node("text", { isText: true, text: "world", nodeSize: 5 }), 10],
    [node("blockquote"), 17],
    [node("paragraph", { isTextblock: true, textContent: "引用" }), 18],
    [node("text", { isText: true, text: "引用", nodeSize: 2 }), 19],
    [node("tableCell"), 23],
    [node("paragraph", { isTextblock: true, textContent: "A1" }), 24],
    [node("text", { isText: true, text: "A1", nodeSize: 2 }), 25],
    [node("image"), 29],
    [node("paperPageBreak"), 31],
    [node("paperPageBreak"), 33],
  ]));
  assert.deepEqual(derived.stats, {
    words: 6,
    paragraphs: 3,
    images: 1,
    quotes: 1,
    pageBreaks: 2,
    pages: 3,
  });
  assert.equal(derived.imageCount, 1);
});

test("derives outline, contents and finalized boundary state", () => {
  const derived = computePaperDerivedState(fakeDoc([
    [node("paperTableOfContents"), 0],
    [node("heading", { attrs: { level: 1 }, textContent: "第一章" }), 5],
    [node("heading", { attrs: { level: 4 }, textContent: "忽略" }), 12],
    [node("paperFinalizedBreak"), 20],
  ]));
  assert.deepEqual(derived.outlineItems, [
    { id: "toc-0", type: "toc", level: 1, text: "目录", pos: 0 },
    { id: "5-1-第一章", type: "heading", level: 1, text: "第一章", pos: 5 },
  ]);
  assert.equal(derived.hasTableOfContents, true);
  assert.equal(derived.hasFinalizedBreak, true);
});

test("keeps a 5000+ character, multi-image derived-state pass below the key-path budget", () => {
  const entries = [];
  let position = 0;
  for (let paragraph = 0; paragraph < 100; paragraph += 1) {
    const text = `${"长文性能回归".repeat(10)} section-${paragraph}`;
    entries.push([node("paragraph", { isTextblock: true, textContent: text }), position]);
    position += 1;
    entries.push([node("text", { isText: true, text, nodeSize: text.length }), position]);
    position += text.length + 1;
  }
  for (let image = 0; image < 10; image += 1) {
    entries.push([node("image"), position]);
    position += 2;
  }
  const document = fakeDoc(entries);
  for (let warmup = 0; warmup < 20; warmup += 1) computePaperDerivedState(document);
  const durations = [];
  for (let sample = 0; sample < 100; sample += 1) {
    const startedAt = performance.now();
    const derived = computePaperDerivedState(document);
    durations.push(performance.now() - startedAt);
    assert.equal(derived.stats.paragraphs, 100);
    assert.equal(derived.stats.images, 10);
  }
  durations.sort((left, right) => left - right);
  const p95 = durations[Math.floor(durations.length * 0.95)];
  assert.ok(p95 < 10, `derived-state P95 was ${p95.toFixed(2)} ms`);
});
