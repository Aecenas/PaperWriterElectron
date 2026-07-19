import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const RESEARCH_STATE_PATTERN = /researchRoot|researchEntries|librarySources|activeLibraryItem|researchTree|readResearchPdf|source\.excerpt|bibliographic|pendingCitationPage/;

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return source.slice(start, end);
}

test("every AI request path stays independent from the research library state", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const requestPaths = [
    between(app, "const handleStartAiOptimize", "const handleAiChatPresetSelect"),
    between(app, "const handleSendAiChat", "const handleClearAiChat"),
    between(app, "const handleApplyAiBlock", "const shellClassName"),
  ];
  for (const requestPath of requestPaths) {
    assert.doesNotMatch(requestPath, RESEARCH_STATE_PATTERN);
  }
});

test("AI context builders serialize only writing metadata, body, and document images", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const builders = between(app, "function buildAiPromptInput", "function summarizeSelectedText");
  assert.doesNotMatch(builders, RESEARCH_STATE_PATTERN);
  assert.doesNotMatch(builders, /citationSources|footnotes|workspacePath|relativePath|url|notes/);
  assert.match(builders, /title/);
  assert.match(builders, /author/);
  assert.match(builders, /displayDate/);
  assert.match(builders, /extractAiBodyContent/);
});

test("optimization requests remain free-form and receive no direct-apply placement protocol", async () => {
  const app = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const builder = between(app, "function buildAiPromptInput", "function buildAiChatContextSignature");
  const optimizeRequest = between(app, "const handleStartAiOptimize", "const handleAiChatPresetSelect");
  assert.match(builder, /AI_PROMPT_PREFIX/);
  assert.match(builder, /promptParts\.filter\(Boolean\)\.join\("\\n\\n"\)/);
  assert.doesNotMatch(builder, /manifest|optimizationContext|targetBlockIds|anchorBlockId/);
  assert.doesNotMatch(optimizeRequest, /resolveAiApply|optimizationContext|selectedBlock|targetBlockIds|anchorBlockId/);
});
