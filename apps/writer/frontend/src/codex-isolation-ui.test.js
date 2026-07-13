import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(fileURLToPath(new URL("./App.jsx", import.meta.url)), "utf8");

test("Codex UI exposes only the isolated current-document scope", () => {
  assert.match(source, /仅当前信笺（隔离）/);
  assert.match(source, /无法读取信笺目录、工作区或其他本地文件/);
  assert.doesNotMatch(source, /function CodexScopeTree|选择工作区子目录|信笺所在目录/);
});

test("legacy saved scopes migrate and outgoing requests remain document-only", () => {
  const normalizeStart = source.indexOf("function normalizeAiChatState");
  const normalizeEnd = source.indexOf("function createEmptyAiState", normalizeStart);
  const normalizeSource = source.slice(normalizeStart, normalizeEnd);
  assert.match(normalizeSource, /normalizeCodexScope\(state\.codexScope\)/);
  assert.match(normalizeSource, /codexScope: \{ \.\.\.CODEX_DOCUMENT_ONLY_SCOPE \}/);

  const sendStart = source.indexOf("const handleSendAiChat");
  const sendEnd = source.indexOf("const handleClearAiChat", sendStart);
  assert.match(source.slice(sendStart, sendEnd), /codexScope: \{ \.\.\.CODEX_DOCUMENT_ONLY_SCOPE \}/);
});
