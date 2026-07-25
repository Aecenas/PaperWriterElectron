import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readAppStyles } from "./style-test-utils.js";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const applyActionsSource = await readFile(new URL("./controllers/ai-apply-actions.js", import.meta.url), "utf8");
const editorDecorationsSource = await readFile(new URL("./editor/decorations.js", import.meta.url), "utf8");
const aiResultBlocksSource = await readFile(new URL("./ai/ResultBlocks.jsx", import.meta.url), "utf8");
const stylesSource = await readAppStyles();
const workspaceStylesSource = await readFile(new URL("./workspace-features.css", import.meta.url), "utf8");

function sourceBetween(start, end, source = appSource) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test("direct apply stages a non-mutating inline comparison before confirmation", () => {
  const stage = sourceBetween(
    "const stageAiApplyPreview",
    "const cancelManualAiApply",
    applyActionsSource,
  );
  const confirm = sourceBetween(
    "const confirmAiApplyPreview",
    "return {\n    beginManualAiApply",
    applyActionsSource,
  );
  const automaticApply = sourceBetween(
    "const handleApplyAiBlock",
    "const handleManualAiApplyTarget",
    applyActionsSource,
  );

  assert.match(stage, /setAiApplyPreview\(/);
  assert.doesNotMatch(stage, /insertContentAt\(/);
  assert.match(automaticApply, /stageAiApplyPreview\(\s*resolved/);
  assert.doesNotMatch(automaticApply, /commitAiApplyOperation\(resolved/);
  assert.match(confirm, /commitAiApplyOperation\(aiApplyPreview\.resolved\)/);
});

test("inline comparison renders red originals, blue proposed content and local actions", () => {
  assert.match(editorDecorationsSource, /Decoration\.node[\s\S]*?ai-apply-preview-original/);
  assert.match(editorDecorationsSource, /Decoration\.widget[\s\S]*?ai-apply-preview-card/);
  assert.match(editorDecorationsSource, /label\.textContent = operation\.action === "replace" \? "蓝色：拟替换内容"/);
  assert.match(editorDecorationsSource, /confirm\.textContent = "确认应用"/);
  assert.match(editorDecorationsSource, /cancel\.textContent = "取消"/);
  assert.match(stylesSource, /\.ai-apply-preview-original[\s\S]*?rgba\(222, 75, 75/);
  assert.match(stylesSource, /\.ai-apply-preview-card[\s\S]*?border-left: 4px solid #3b7cc5/);
});

test("result blocks use the concise apply button label without a check icon", () => {
  const actions = sourceBetween("function AiResultBlockActions", "function AiResultBlock(", aiResultBlocksSource);
  assert.match(actions, /manualFallback \? "选择位置应用" : "应用"/);
  assert.match(actions, /applying \? <RefreshCw[^>]*> : null/);
  assert.doesNotMatch(actions, /<Check/);
  assert.match(workspaceStylesSource, /\.ai-block-actions button\.apply\{min-width:46px\}/);
});

test("cancel clears the comparison without running the editor mutation", () => {
  const cancel = sourceBetween(
    "const cancelAiApplyPreview",
    "const confirmAiApplyPreview",
    applyActionsSource,
  );
  assert.match(cancel, /setAiApplyPreview\(null\)/);
  assert.doesNotMatch(cancel, /commitAiApplyOperation|insertContentAt/);
  assert.match(cancel, /正文保持不变/);
});
