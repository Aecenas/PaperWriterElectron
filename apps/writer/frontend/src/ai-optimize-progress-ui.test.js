import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("./styles.css", import.meta.url), "utf8");

test("AI elapsed time refreshes at the displayed tenth-second precision", () => {
  assert.match(appSource, /function formatElapsedSeconds[\s\S]*?toFixed\(1\)/);
  assert.match(appSource, /window\.setInterval\(updateElapsed, 100\)/);
  assert.doesNotMatch(appSource, /window\.setInterval\(updateElapsed, 500\)/);
});

test("optimization waiting and completed content share the normal headed-paper body spacing", () => {
  const resultPaneStart = appSource.indexOf("function AiResultPane");
  const resultPaneEnd = appSource.indexOf("function AiChatPane", resultPaneStart);
  const resultPaneSource = appSource.slice(resultPaneStart, resultPaneEnd);
  const resultBodyStart = resultPaneSource.indexOf('<div className="paper-editor ai-result-body">');
  const resultBodyEnd = resultPaneSource.indexOf("</div>", resultBodyStart);
  const resultBodySource = resultPaneSource.slice(resultBodyStart, resultBodyEnd);
  assert.match(resultPaneSource, /customHeaderLayout/);
  assert.match(resultBodySource, /isStreaming && !blocks\.length && !error/);
  assert.match(resultBodySource, /className="ai-result-loading">AI优化中…/);
  assert.doesNotMatch(appSource, /AI 正在阅读这篇信笺/);
  assert.match(stylesSource, /\.ai-chat-message-summary\.thinking,[\s\S]*?\.ai-result-loading/);
  assert.match(stylesSource, /\.ai-chat-message-summary\.thinking::before,[\s\S]*?\.ai-result-loading::before/);
  assert.match(stylesSource, /\.ai-result-body > \.ai-result-loading \{[\s\S]*?margin-top: 0;[\s\S]*?font-weight: 760/);
  assert.match(stylesSource, /\.ai-result-body > \.ai-result-loading \{[^}]*text-indent: 0;/);
  assert.match(stylesSource, /\.paper-sheet\.indents-paragraphs \.ai-result-body > \.ai-result-loading \{[^}]*text-indent: 0;/);
  assert.match(stylesSource, /\.ai-result-header \{[\s\S]*?padding-bottom: 0;/);
  assert.doesNotMatch(stylesSource, /\.ai-result-loading[^}]*border-bottom/);
});
