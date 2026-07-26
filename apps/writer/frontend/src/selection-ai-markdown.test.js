import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSelectionAiMarkdownLink,
  parseSelectionAiInlineMarkdown,
  parseSelectionAiMarkdown,
} from "./selection-ai/markdown.js";

function flattenInlineTokens(tokens) {
  return tokens.flatMap((token) => [
    token.type,
    ...(token.children ? flattenInlineTokens(token.children) : []),
  ]);
}

test("selection AI Markdown retains rich block structure without HTML rendering", () => {
  const blocks = parseSelectionAiMarkdown([
    "# 标题",
    "",
    "> 引用 **重点**",
    "",
    "1. 第一项",
    "2. 第二项",
    "",
    "```js",
    "const html = '<img src=x onerror=alert(1)>';",
    "```",
    "",
    "| 项目 | 结果 |",
    "| --- | --- |",
    "| A | B |",
  ].join("\n"));

  assert.deepEqual(blocks.map((block) => block.type), [
    "heading",
    "quote",
    "orderedList",
    "code",
    "table",
  ]);
  assert.equal(
    blocks.find((block) => block.type === "code")?.text,
    "const html = '<img src=x onerror=alert(1)>';",
  );
});

test("selection AI inline Markdown supports emphasis, deletion, code and safe links", () => {
  const tokens = parseSelectionAiInlineMarkdown(
    "**粗体 *嵌套斜体***、~~删除~~、`<script>`、[官网](https://example.com/path)",
  );
  const types = flattenInlineTokens(tokens);

  assert.ok(types.includes("strong"));
  assert.ok(types.includes("emphasis"));
  assert.ok(types.includes("delete"));
  assert.ok(types.includes("code"));
  assert.ok(types.includes("link"));
  assert.equal(
    tokens.find((token) => token.type === "link")?.href,
    "https://example.com/path",
  );
});

test("selection AI Markdown keeps indented continuation text in its ordered list item", () => {
  const blocks = parseSelectionAiMarkdown([
    "1. **第一层标题**",
    "   第一项续行正文",
    "2. **第二层标题**",
    "   第二项续行正文",
  ].join("\n"));

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "orderedList");
  assert.deepEqual(blocks[0].items, [
    {
      number: 1,
      text: "**第一层标题**\n第一项续行正文",
    },
    {
      number: 2,
      text: "**第二层标题**\n第二项续行正文",
    },
  ]);
  assert.ok(
    flattenInlineTokens(
      parseSelectionAiInlineMarkdown(blocks[0].items[0].text),
    ).includes("strong"),
  );
});

test("selection AI Markdown rejects executable and local link protocols", () => {
  assert.equal(normalizeSelectionAiMarkdownLink("javascript:alert(1)"), "");
  assert.equal(normalizeSelectionAiMarkdownLink("data:text/html,test"), "");
  assert.equal(normalizeSelectionAiMarkdownLink("file:///C:/secret.txt"), "");
  assert.equal(
    normalizeSelectionAiMarkdownLink("https://example.com"),
    "https://example.com/",
  );

  const tokens = parseSelectionAiInlineMarkdown(
    "[危险](javascript:alert(1))",
  );
  assert.deepEqual(tokens, [{
    type: "text",
    text: "[危险](javascript:alert(1))",
  }]);
});
