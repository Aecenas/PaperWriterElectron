import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("AI composition exposes one definition form and automatically completes the full-draft pipeline", async () => {
  const [workspace, hook] = await Promise.all([
    fs.readFile(new URL("./ai-composition/AiCompositionWorkspace.jsx", import.meta.url), "utf8"),
    fs.readFile(new URL("./ai-composition/useCompositionJob.js", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /定义这篇文章/);
  assert.match(workspace, /生成全稿/);
  assert.match(workspace, /outline:\s*\[\]/);
  assert.match(workspace, /event\.type === "outline-complete"[\s\S]*?controller\.actions\.resume/);
  assert.match(workspace, /event\.type === "drafting-complete"[\s\S]*?controller\.actions\.review/);
  assert.match(workspace, /event\.type === "review-complete"[\s\S]*?controller\.actions\.finalize/);
  assert.doesNotMatch(workspace, /function (?:JobLibrary|CompositionSteps|OutlineEditor|DraftingWorkspace|ReviewWorkspace)/);
  assert.match(hook, /\["outline-complete", "drafting-complete", "review-complete", "complete", "error"\]\.includes\(event\.type\)/);
  assert.match(hook, /setLastEvent\(\{ \.\.\.event, sequence: \+\+eventSequenceRef\.current \}\)/);
  assert.match(hook, /lastEvent,/);
});

test("AI composition keeps source selection explicit and uses the standard document-dialog visual contract", async () => {
  const [workspace, styles] = await Promise.all([
    fs.readFile(new URL("./ai-composition/AiCompositionWorkspace.jsx", import.meta.url), "utf8"),
    fs.readFile(new URL("./styles-ai-composition.css", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /参考资料（可选）/);
  assert.match(workspace, /仅会向 AI 发送你明确勾选的内容/);
  assert.match(workspace, /selectedSourceIds:\s*selectedSources/);
  assert.match(workspace, /role="dialog"/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(workspace, /useModalFocusTrap\(true, dialogRef\)/);
  assert.match(styles, /\.ai-composition-workspace\s*\{[\s\S]*?width:\s*min\(760px/);
  assert.match(styles, /background:\s*linear-gradient\(180deg, rgba\(255, 253, 248/);
  assert.match(styles, /\.composition-dialog-header\s*\{[\s\S]*?grid-template-columns:\s*42px minmax\(0, 1fr\) 38px/);
  assert.match(styles, /\.composition-dialog-footer button\.primary/);
  assert.match(styles, /@media \(max-width:\s*620px\)[\s\S]*?\.composition-form-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/);
});

test("AI composition blocks accidental dismissal while generating and restores the latest definition", async () => {
  const [workspace, app] = await Promise.all([
    fs.readFile(new URL("./ai-composition/AiCompositionWorkspace.jsx", import.meta.url), "utf8"),
    fs.readFile(new URL("./App.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /pipelineActiveRef\.current && view === "running"[\s\S]*?return/);
  assert.match(workspace, /event\.stopImmediatePropagation\?\.\(\)/);
  assert.match(workspace, /生成期间暂不能关闭/);
  assert.match(workspace, />停止生成<\/button>/);
  assert.match(app, /className="ai-composition-overlay"[\s\S]*?event\.target !== event\.currentTarget[\s\S]*?event\.stopPropagation/);
  assert.match(workspace, /loadCompositionDraft\(\)/);
  assert.match(workspace, /controller\.jobs\[0\]/);
  assert.match(workspace, /saveCompositionDraft\(payload\)/);
  assert.doesNotMatch(workspace, /本页输入会自动保存在本机，下次起稿时继续显示/);
  assert.doesNotMatch(workspace, /不选资料也可以直接生成/);
});
