import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { formatElapsedSeconds } from "./ai/usage.js";
import { AI_ELAPSED_INTERVAL_MS } from "./controllers/ai-stream-lifecycle.js";
import { readAppStyles } from "./style-test-utils.js";

const aiStreamLifecycleSource = await readFile(new URL("./controllers/ai-stream-lifecycle.js", import.meta.url), "utf8");
const aiPanesSource = await readFile(new URL("./ai/Panes.jsx", import.meta.url), "utf8");
const stylesSource = await readAppStyles();

test("AI elapsed time refreshes at the displayed tenth-second precision", () => {
  assert.equal(formatElapsedSeconds(0), "0.0 s");
  assert.equal(formatElapsedSeconds(1.26), "1.3 s");
  assert.equal(AI_ELAPSED_INTERVAL_MS, 100);
  assert.match(aiStreamLifecycleSource, /window\.setInterval\(updateElapsed, AI_ELAPSED_INTERVAL_MS\)/);
  assert.doesNotMatch(aiStreamLifecycleSource, /500/);
});

test("optimization waiting and completed content share the normal headed-paper body spacing", () => {
  const resultPaneStart = aiPanesSource.indexOf("function AiResultPane");
  const resultPaneEnd = aiPanesSource.indexOf("function AiChatPane", resultPaneStart);
  const resultPaneSource = aiPanesSource.slice(resultPaneStart, resultPaneEnd);
  const resultBodyStart = resultPaneSource.indexOf('<div className="paper-editor ai-result-body">');
  const resultBodyEnd = resultPaneSource.indexOf("</div>", resultBodyStart);
  const resultBodySource = resultPaneSource.slice(resultBodyStart, resultBodyEnd);
  assert.match(resultPaneSource, /customHeaderLayout/);
  assert.match(resultBodySource, /isStreaming && !blocks\.length && !error/);
  assert.match(resultBodySource, /className="ai-result-loading">AI优化中…/);
  assert.doesNotMatch(aiPanesSource, /AI 正在阅读这篇信笺/);
  assert.match(stylesSource, /\.ai-chat-message-summary\.thinking,[\s\S]*?\.ai-result-loading/);
  assert.match(stylesSource, /\.ai-chat-message-summary\.thinking::before,[\s\S]*?\.ai-result-loading::before/);
  assert.match(stylesSource, /\.ai-result-body > \.ai-result-loading \{[\s\S]*?margin-top: 0;[\s\S]*?font-weight: 760/);
  assert.match(stylesSource, /\.ai-result-body > \.ai-result-loading \{[^}]*text-indent: 0;/);
  assert.match(stylesSource, /\.paper-sheet\.indents-paragraphs \.ai-result-body > \.ai-result-loading \{[^}]*text-indent: 0;/);
  assert.match(stylesSource, /\.ai-result-header \{[\s\S]*?padding-bottom: 0;/);
  assert.doesNotMatch(stylesSource, /\.ai-result-loading[^}]*border-bottom/);
});
