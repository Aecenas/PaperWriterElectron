import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  getSafeSelectionRange,
  getSelectedPlainText,
  normalizeLinkUrl,
} from "./editor/commands.js";
import {
  assignDocumentCommentPresentations,
} from "./editor/comment-model.js";
import {
  normalizeBackgroundColorValue,
  normalizeUnderlineStyle,
} from "./editor/formatting.js";
import { numberHeadingItems, numberOutlineItems } from "./editor/decorations.js";

test("editor formatting normalizers preserve the existing allowlists", () => {
  assert.equal(normalizeUnderlineStyle("wavy"), "wavy");
  assert.equal(normalizeUnderlineStyle("unsupported"), "solid");
  assert.equal(normalizeBackgroundColorValue("rgb(246, 226, 169)"), "#f6e2a9");
  assert.equal(normalizeBackgroundColorValue("#F2C8C3"), "#f2c8c3");
  assert.equal(normalizeBackgroundColorValue("rgba(0, 0, 0, 0)"), "");
});

test("selection helpers clamp stale ranges without mutating editor state", () => {
  const editor = {
    state: {
      doc: {
        content: { size: 12 },
        textBetween(from, to) {
          assert.equal(from, 1);
          assert.equal(to, 12);
          return " 第一段 \n 第二段 ";
        },
      },
    },
  };
  const savedSelectionRef = { current: { from: -20, to: 99 } };

  assert.deepEqual(getSafeSelectionRange(editor, savedSelectionRef), { from: 1, to: 12 });
  const selected = getSelectedPlainText(editor, savedSelectionRef);
  assert.equal(selected.text, "第一段\n 第二段");
  assert.equal(selected.from, 1);
  assert.equal(selected.to, 12);
  assert.equal(typeof selected.capturedAt, "number");
});

test("editor links retain the public protocol and validation contract", () => {
  assert.deepEqual(normalizeLinkUrl("example.com/path"), {
    ok: true,
    url: "https://example.com/path",
  });
  assert.deepEqual(normalizeLinkUrl("javascript:alert(1)"), {
    ok: false,
    error: "链接地址格式不正确，仅支持 http、https 和邮箱链接",
  });
  assert.deepEqual(normalizeLinkUrl(""), {
    ok: false,
    error: "请输入链接地址",
  });
});

test("comment tracks and heading numbers remain deterministic", () => {
  const comments = [
    { id: "one", from: 1, to: 3, text: "一", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "two", from: 4, to: 6, text: "二", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    { id: "three", from: 7, to: 9, text: "三", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ];
  const presentations = assignDocumentCommentPresentations(comments, new Map([
    ["one", 100],
    ["two", 110],
    ["three", 180],
  ]));
  assert.equal(presentations.get("one").trackIndex, 0);
  assert.equal(presentations.get("two").trackIndex, 1);
  assert.equal(presentations.get("three").trackIndex, 0);

  const headings = numberHeadingItems([
    { id: "h1", level: 1, text: "第一章", pos: 0, numberingMode: "inherit" },
    { id: "h2", level: 2, text: "第一节", pos: 5, numberingMode: "inherit" },
    { id: "h3", level: 3, text: "第一目", pos: 10, numberingMode: "inherit" },
    { id: "h4", level: 4, text: "第一细目", pos: 15, numberingMode: "inherit" },
    { id: "off", level: 2, text: "不编号", pos: 20, numberingMode: "off" },
    { id: "next", level: 1, text: "第二章", pos: 25, numberingMode: "inherit" },
  ], { 1: true, 2: true, 3: true, 4: true });
  assert.deepEqual(headings.map(({ id, number, numbered }) => ({ id, number, numbered })), [
    { id: "h1", number: "1", numbered: true },
    { id: "h2", number: "1.1", numbered: true },
    { id: "h3", number: "1.1.1", numbered: true },
    { id: "h4", number: "1.1.1.1", numbered: true },
    { id: "off", number: "", numbered: false },
    { id: "next", number: "2", numbered: true },
  ]);

  const outline = numberOutlineItems([
    { id: "toc", type: "toc", level: 1, text: "目录", pos: 0 },
    { id: "h1", type: "heading", level: 1, text: "第一章", pos: 5, numberingMode: "inherit" },
    { id: "h2", type: "heading", level: 2, text: "第一节", pos: 10, numberingMode: "off" },
    { id: "h4", type: "heading", level: 4, text: "第四级", pos: 15, numberingMode: "inherit" },
  ], { 1: true, 2: true, 3: true, 4: true });
  assert.deepEqual(outline.map(({ id, number }) => ({ id, number })), [
    { id: "toc", number: undefined },
    { id: "h1", number: "1" },
    { id: "h2", number: "" },
    { id: "h4", number: "1.1" },
  ]);

  const unnumberedTemplateOutline = numberOutlineItems([
    { id: "plain", type: "heading", level: 1, text: "无编号模板", pos: 15, numberingMode: "inherit" },
    { id: "forced", type: "heading", level: 2, text: "单独开启", pos: 20, numberingMode: "on" },
  ], { 1: false, 2: false, 3: false, 4: false });
  assert.deepEqual(unnumberedTemplateOutline.map(({ id, number }) => ({ id, number })), [
    { id: "plain", number: "" },
    { id: "forced", number: "1" },
  ]);
});

test("the editor extension assembly keeps its exact order and plugin-key ownership", () => {
  const extensionSource = fs.readFileSync(fileURLToPath(new URL("./editor/extensions.js", import.meta.url)), "utf8");
  const decorationSource = fs.readFileSync(fileURLToPath(new URL("./editor/decorations.js", import.meta.url)), "utf8");
  const assembly = extensionSource.slice(
    extensionSource.indexOf("return ["),
    extensionSource.indexOf("];", extensionSource.indexOf("return [")),
  );
  const orderedMarkers = [
    "StarterKit.configure",
    "TextStyle",
    "Color.configure",
    "StyledUnderlineExtension",
    "Highlight.configure",
    "FontFamily",
    "PaperDerivedState",
    "HeadingMetadata",
    "Table.configure",
    "TableRow",
    "TableHeader",
    "TableCell",
    "PaperImage.configure",
    "PaperMedia",
    "PaperPageBreak",
    "PaperHorizontalRule",
    "PaperFinalizedBreak",
    "PaperTableOfContents",
    "createStructuredInlineExtensions",
    "createKnowledgeExtensions",
    "DocumentSearchExtension",
    "AiChatSelectionDecorations",
    "AiApplyPreviewDecorations",
    "DocumentCommentDecorations",
    "TextAlign.configure",
    "Placeholder.configure",
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const current = assembly.indexOf(marker);
    assert.ok(current > previous, `${marker} must retain its extension order`);
    previous = current;
  }
  for (const keyName of [
    "AI_CHAT_SELECTION_PLUGIN_KEY",
    "AI_APPLY_PREVIEW_PLUGIN_KEY",
    "DOCUMENT_COMMENT_PLUGIN_KEY",
    "HEADING_NUMBERING_PLUGIN_KEY",
    "PAPER_DERIVED_STATE_PLUGIN_KEY",
  ]) {
    assert.equal((decorationSource.match(new RegExp(`export const ${keyName} = new PluginKey`, "g")) || []).length, 1);
  }
});
