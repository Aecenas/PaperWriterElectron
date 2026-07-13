import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CHAT_MAX_MESSAGES,
  AI_CHAT_MAX_MESSAGE_CHARS,
  AI_CHAT_MAX_TOTAL_CHARS,
  AI_OPTIMIZE_MAX_IMAGES,
  AI_OPTIMIZE_MAX_QUOTES,
  boundedAiImageEntries,
  normalizeBoundedAiChatMessages,
  normalizeBoundedAiQuotes,
  normalizeDocumentTitle,
  normalizeImageCaption,
  normalizeImageText,
  normalizeMediaFileName,
  normalizeMediaMime,
} from "./content-limits.js";

test("caps document titles before they reach controlled inputs and tabs", () => {
  assert.equal(normalizeDocumentTitle("  正常标题  "), "正常标题");
  assert.equal(normalizeDocumentTitle("题".repeat(10000)).length, 200);
  assert.equal(normalizeDocumentTitle("  "), "未命名信笺");
});

test("keeps only recent chat messages within per-message and aggregate budgets", () => {
  const longMessage = "x".repeat(100000);
  const messages = Array.from({ length: 300 }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 ? "assistant" : "user",
    content: longMessage,
  }));
  const normalized = normalizeBoundedAiChatMessages(messages);
  assert.ok(normalized.length <= AI_CHAT_MAX_MESSAGES);
  assert.equal(normalized.at(-1).id, "message-299");
  assert.ok(normalized.every((message) => message.content.length <= AI_CHAT_MAX_MESSAGE_CHARS));
  assert.ok(normalized.reduce((total, message) => total + message.content.length, 0) <= AI_CHAT_MAX_TOTAL_CHARS);
  assert.equal(
    normalizeBoundedAiChatMessages([{ content: "x".repeat(AI_CHAT_MAX_MESSAGE_CHARS + 1) }])[0].content.length,
    AI_CHAT_MAX_MESSAGE_CHARS,
  );
});

test("caps AI image and quote collections before normalization", () => {
  const images = Object.fromEntries(Array.from({ length: 3000 }, (_, index) => [`image-${index}`, { src: "" }]));
  assert.equal(boundedAiImageEntries(images).length, AI_OPTIMIZE_MAX_IMAGES);
  const quotes = Array.from({ length: 2000 }, () => ({ text: "引".repeat(20000) }));
  const normalizedQuotes = normalizeBoundedAiQuotes(quotes);
  assert.equal(normalizedQuotes.length, AI_OPTIMIZE_MAX_QUOTES);
  assert.ok(normalizedQuotes.every((quote) => quote.text.length === 10000));
});

test("caps image and media metadata before controlled DOM rendering", () => {
  assert.equal(normalizeImageCaption("图".repeat(1000)).length, 500);
  assert.equal(normalizeImageText("替".repeat(1000)).length, 240);
  const fileName = normalizeMediaFileName(`  ${"音".repeat(500)}  `);
  assert.ok(fileName.length <= 240);
  assert.equal(fileName, fileName.trim());
  assert.equal(normalizeMediaMime("Audio/MPEG", "audio"), "audio/mpeg");
  assert.equal(normalizeMediaMime("video/mp4", "audio"), "");
  assert.equal(normalizeMediaMime("audio/mpeg\" onload=alert(1)", "audio"), "");
});
