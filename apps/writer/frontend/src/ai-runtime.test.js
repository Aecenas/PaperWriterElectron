import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildAiChatContextInput,
  buildAiChatContextSignature,
  buildAiPromptInput,
} from "./ai/context.js";
import {
  aiBlockHtml,
  aiBlockPlainText,
  parseAiResponseBlocks,
} from "./ai/markdown.js";
import {
  createEmptyAiState,
  mergeAiStatePatch,
  normalizeAiState,
} from "./ai/state.js";
import {
  chatMessagesToMarkdown,
  estimateTokenCount,
  formatTokenUsage,
  getAiUsageCachedTokens,
  getAiUsageTotalTokens,
} from "./ai/usage.js";

function editorWithContent(content) {
  return {
    getJSON() {
      return { type: "doc", content };
    },
  };
}

test("App consumes the AI domain only through its public barrel", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const imports = [...source.matchAll(/from "(\.\/ai\/[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["./ai/index.js"]);
  assert.doesNotMatch(source, /function (?:buildAiPromptInput|normalizeAiState|AiResultPane|AiChatPane)\b/);
});

test("AI prompt and chat context serialize only the current document snapshot", () => {
  const editor = editorWithContent([
    { type: "paragraph", content: [{ type: "text", text: "已完成部分" }] },
    { type: "paperFinalizedBreak" },
    { type: "paragraph", content: [{ type: "text", text: "待优化部分" }] },
    { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "四级标题" }] },
    {
      type: "image",
      attrs: {
        caption: "结构图",
        alt: "结构图",
        src: "data:image/png;base64,AA==",
        width: "65%",
      },
    },
  ]);
  const document = {
    title: "测试信笺",
    author: "作者",
    displayDate: "2026-07-25",
    researchRoot: "never-serialize-this",
  };

  const prompt = buildAiPromptInput(editor, { showImageCaptions: true });
  assert.match(prompt.prompt, /这是我正在写的文章/);
  assert.match(prompt.prompt, /【已定稿开始】[\s\S]*已完成部分[\s\S]*【已定稿结束】/);
  assert.match(prompt.prompt, /待优化部分/);
  assert.match(prompt.prompt, /#### 四级标题/);
  assert.equal(prompt.assets.images[1].caption, "结构图");

  const signature = buildAiChatContextSignature(editor, document, { showImageCaptions: true });
  const context = buildAiChatContextInput(editor, document, { showImageCaptions: true }, signature);
  assert.match(context.context, /标题：测试信笺[\s\S]*署名：作者[\s\S]*正文：[\s\S]*待优化部分/);
  assert.equal(context.signature, signature);
  assert.doesNotMatch(signature, /never-serialize-this|researchRoot/);
  assert.doesNotMatch(context.context, /never-serialize-this|researchRoot/);
});

test("Mermaid figures share figure numbering and obey the template caption visibility", () => {
  const editor = editorWithContent([
    { type: "paperMermaid", attrs: { caption: "研究流程", source: "flowchart LR\nA-->B" } },
    {
      type: "image",
      attrs: {
        caption: "结果图",
        alt: "结果图",
        src: "data:image/png;base64,AA==",
        width: "65%",
      },
    },
  ]);

  const visible = buildAiPromptInput(editor, { showImageCaptions: true });
  assert.match(visible.body, /\[图1\.研究流程\]/);
  assert.match(visible.body, /\[图2\.结果图\]/);
  assert.equal(visible.assets.images[2].number, 2);

  const hidden = buildAiChatContextInput(editor, { title: "测试" }, { showImageCaptions: false });
  assert.match(hidden.context, /\[Mermaid 图\]/);
  assert.match(hidden.context, /\[图片\]/);
  assert.doesNotMatch(hidden.context, /研究流程|结果图/);
});

test("AI response blocks retain Markdown structure and rich clipboard serialization", () => {
  const blocks = parseAiResponseBlocks([
    "## 结论",
    "#### 细节",
    "",
    "| 项目 | 结果 |",
    "| --- | --- |",
    "| **结构** | 清晰 |",
    "",
    "1. 第一项",
    "2. 第二项",
    "",
    "[引用：保持克制 —— 来源]",
    "",
    "[图1.结构图]",
  ].join("\n"), {
    images: {
      1: {
        src: "data:image/png;base64,AA==",
        alt: "结构图",
      },
    },
  });

  assert.deepEqual(blocks.map((block) => block.type), [
    "heading",
    "heading",
    "table",
    "orderedList",
    "quote",
    "image",
  ]);
  assert.equal(blocks[1].level, 4);
  assert.equal(aiBlockHtml(blocks[1]), "<h4>细节</h4>");
  assert.equal(aiBlockPlainText(blocks[2]), "项目\t结果\n结构\t清晰");
  assert.match(aiBlockHtml(blocks[2]), /^<table>/);
  assert.match(aiBlockHtml(blocks[4]), /<blockquote>[\s\S]*—— 来源/);
  assert.match(aiBlockHtml(blocks[5]), /<figure><img src="data:image\/png;base64,AA=="/);
});

test("AI state normalization preserves versioned defaults and isolated Codex scope", () => {
  const empty = createEmptyAiState();
  assert.equal(empty.version, 4);
  assert.deepEqual(empty.chat.codexScope, { mode: "document-only", relativePath: "" });

  const normalized = normalizeAiState({
    version: 1,
    lastMode: "chat",
    optimize: { status: "unknown", elapsedSeconds: -3 },
    chat: {
      status: "streaming",
      codexScope: { mode: "workspace", relativePath: "private" },
      selectedTexts: [{ text: "标记", from: 2, to: 4 }],
    },
  });
  assert.equal(normalized.version, 4);
  assert.equal(normalized.optimize.status, "ready");
  assert.equal(normalized.optimize.elapsedSeconds, 0);
  assert.deepEqual(normalized.chat.codexScope, { mode: "document-only", relativePath: "" });
  assert.equal(normalized.chat.selectedTexts[0].text, "标记");

  const patched = mergeAiStatePatch(normalized, (current) => ({
    ...current,
    lastMode: "optimize",
  }));
  assert.equal(patched.lastMode, "optimize");
});

test("AI token usage and chat export helpers keep their public formats", () => {
  const usage = {
    total_tokens: 2450,
    prompt_tokens_details: { cached_tokens: 1200 },
  };
  assert.equal(getAiUsageTotalTokens(usage), 2450);
  assert.equal(getAiUsageCachedTokens(usage), 1200);
  assert.equal(formatTokenUsage(2450, false, 1200), "2.45K（缓存：1.2K）");
  assert.ok(estimateTokenCount("中文 words") > 0);

  const markdown = chatMessagesToMarkdown(
    { title: "测试信笺" },
    [
      { role: "system", content: "隐藏" },
      { role: "user", content: "问题" },
      { role: "assistant", content: "回答" },
    ],
  );
  assert.match(markdown, /^# 测试信笺 - AI协作/m);
  assert.match(markdown, /## 我[\s\S]*问题[\s\S]*## AI[\s\S]*回答/);
  assert.doesNotMatch(markdown, /隐藏/);
});
