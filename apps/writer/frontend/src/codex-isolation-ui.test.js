import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeAiChatState } from "./ai/state.js";

const selectorsSource = fs.readFileSync(fileURLToPath(new URL("./ai/Selectors.jsx", import.meta.url)), "utf8");
const requestActionsSource = fs.readFileSync(fileURLToPath(new URL("./controllers/ai-request-actions.js", import.meta.url)), "utf8");

test("Codex UI exposes only the isolated current-document scope", () => {
  assert.match(selectorsSource, /仅当前信笺（隔离）/);
  assert.match(selectorsSource, /无法读取信笺目录、工作区或其他本地文件/);
  assert.doesNotMatch(selectorsSource, /function CodexScopeTree|选择工作区子目录|信笺所在目录/);
});

test("legacy saved scopes migrate and outgoing requests remain document-only", () => {
  assert.deepEqual(
    normalizeAiChatState({ codexScope: { mode: "workspace", relativePath: "private" } }).codexScope,
    { mode: "document-only", relativePath: "" },
  );

  const sendStart = requestActionsSource.indexOf("const handleSendAiChat");
  const sendEnd = requestActionsSource.indexOf("const handleClearAiChat", sendStart);
  assert.match(requestActionsSource.slice(sendStart, sendEnd), /codexScope: \{ \.\.\.CODEX_DOCUMENT_ONLY_SCOPE \}/);
});
