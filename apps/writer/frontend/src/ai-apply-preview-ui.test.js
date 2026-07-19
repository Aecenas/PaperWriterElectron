import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("./styles.css", import.meta.url), "utf8");
const workspaceStylesSource = await readFile(new URL("./workspace-features.css", import.meta.url), "utf8");

function sourceBetween(start, end) {
  const from = appSource.indexOf(start);
  const to = appSource.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return appSource.slice(from, to);
}

test("direct apply stages a non-mutating inline comparison before confirmation", () => {
  const stage = sourceBetween("const stageAiApplyPreview", "const cancelAiApplyPreview");
  const confirm = sourceBetween("const confirmAiApplyPreview", "useEffect(() => {");
  const automaticApply = sourceBetween("const handleApplyAiBlock", "const handleManualAiApplyTarget");

  assert.match(stage, /setAiApplyPreview\(/);
  assert.doesNotMatch(stage, /insertContentAt\(/);
  assert.match(automaticApply, /stageAiApplyPreview\(resolved/);
  assert.doesNotMatch(automaticApply, /commitAiApplyOperation\(resolved/);
  assert.match(confirm, /commitAiApplyOperation\(aiApplyPreview\.resolved\)/);
});

test("inline comparison renders red originals, blue proposed content and local actions", () => {
  assert.match(appSource, /Decoration\.node[\s\S]*?ai-apply-preview-original/);
  assert.match(appSource, /Decoration\.widget[\s\S]*?ai-apply-preview-card/);
  assert.match(appSource, /label\.textContent = operation\.action === "replace" \? "蓝色：拟替换内容"/);
  assert.match(appSource, /confirm\.textContent = "确认应用"/);
  assert.match(appSource, /cancel\.textContent = "取消"/);
  assert.match(stylesSource, /\.ai-apply-preview-original[\s\S]*?rgba\(222, 75, 75/);
  assert.match(stylesSource, /\.ai-apply-preview-card[\s\S]*?border-left: 4px solid #3b7cc5/);
});

test("result blocks use the concise apply button label without a check icon", () => {
  const actions = sourceBetween("function AiResultBlockActions", "function AiResultBlock(");
  assert.match(actions, /manualFallback \? "选择位置应用" : "应用"/);
  assert.match(actions, /applying \? <RefreshCw[^>]*> : null/);
  assert.doesNotMatch(actions, /<Check/);
  assert.match(workspaceStylesSource, /\.ai-block-actions button\.apply\{min-width:46px\}/);
});

test("cancel clears the comparison without running the editor mutation", () => {
  const cancel = sourceBetween("const cancelAiApplyPreview", "const confirmAiApplyPreview");
  assert.match(cancel, /setAiApplyPreview\(null\)/);
  assert.doesNotMatch(cancel, /commitAiApplyOperation|insertContentAt/);
  assert.match(cancel, /正文保持不变/);
});
