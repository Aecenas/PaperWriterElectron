import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  getAiModeLabel,
  shouldConfirmAiModeChange,
  shouldConfirmAiModeExit,
} from "./ai-mode-chooser-model.js";
import { AI_MODEL_REQUIRED_MESSAGE } from "./ai-settings/model.js";
import { readAppStylesSync } from "./style-test-utils.js";

const appSource = fs.readFileSync(fileURLToPath(new URL("./App.jsx", import.meta.url)), "utf8");
const modeActionsSource = fs.readFileSync(fileURLToPath(new URL("./controllers/ai-mode-actions.js", import.meta.url)), "utf8");
const modeStateSource = fs.readFileSync(fileURLToPath(new URL("./controllers/ai-mode-state.js", import.meta.url)), "utf8");
const topNavSource = fs.readFileSync(fileURLToPath(new URL("./app-shell/TopNav.jsx", import.meta.url)), "utf8");
const chooserSource = fs.readFileSync(fileURLToPath(new URL("./AiModeChooser.jsx", import.meta.url)), "utf8");
const chooserCss = fs.readFileSync(fileURLToPath(new URL("./ai-mode-chooser.css", import.meta.url)), "utf8");
const appCss = readAppStylesSync();
const modeArtwork = [
  "./assets/ai-modes/ai-optimize-card-idle-v3.png",
  "./assets/ai-modes/ai-optimize-card-selected-v3.png",
  "./assets/ai-modes/ai-chat-card-idle-v3.png",
  "./assets/ai-modes/ai-chat-card-selected-v3.png",
  "./assets/ai-modes/ai-compose-card-idle-v3.png",
  "./assets/ai-modes/ai-compose-card-selected-v3.png",
];

test("describes AI modes and confirms only destructive active transitions", () => {
  assert.equal(getAiModeLabel("optimize"), "AI优化");
  assert.equal(getAiModeLabel("chat"), "AI协作");
  assert.equal(getAiModeLabel("compose"), "AI起稿");
  assert.equal(getAiModeLabel("none"), "未启用");
  assert.equal(shouldConfirmAiModeChange({ currentMode: "optimize", nextMode: "chat", busy: true }), true);
  assert.equal(shouldConfirmAiModeChange({ currentMode: "optimize", nextMode: "optimize", busy: true }), false);
  assert.equal(shouldConfirmAiModeChange({ currentMode: "none", nextMode: "chat", busy: true }), false);
  assert.equal(shouldConfirmAiModeExit({ currentMode: "chat", busy: true }), true);
  assert.equal(shouldConfirmAiModeExit({ currentMode: "chat", busy: false }), false);
});

test("keeps mode button labels stable and replaces the old AI dropdown", () => {
  assert.match(topNavSource, /<span>AI模式<\/span>/);
  assert.doesNotMatch(topNavSource, /<span>退出 AI<\/span>/);
  assert.doesNotMatch(topNavSource, /menuId="ai"/);
  assert.match(topNavSource, /aria-pressed=\{aiMode\}/);
  assert.match(topNavSource, /aria-expanded=\{aiModeChooserOpen\}/);
  assert.match(appSource, /requestAiModeChange/);
  assert.match(appSource, /requestExitAiMode/);
  assert.match(appSource, /onToggleAiModeChooser=\{toggleAiModeChooser\}/);
  assert.match(modeActionsSource, /if \(!aiHasUsableProvider\) \{[\s\S]*?openAiSettings\(\);[\s\S]*?duration: 5000, dismissible: true/);
  assert.equal(AI_MODEL_REQUIRED_MESSAGE, "必须配置好至少一个可用模型，才能进入 AI 模式。配置完成后，再次点击“AI模式”即可。");
  assert.match(appSource, /<StatusToast status=\{status\} onClose=\{dismissStatus\}/);
  assert.match(appCss, /\.status-toast\s*\{[\s\S]*?z-index:\s*280[\s\S]*?backdrop-filter:\s*none/);
  assert.match(appCss, /\.status-toast-dismiss/);
});

test("renders three accessible mode cards with an independent composition entry", () => {
  assert.match(chooserSource, /role="dialog"/);
  assert.match(chooserSource, /aria-modal="true"/);
  assert.match(chooserSource, /aria-label="选择 AI 模式"/);
  assert.match(chooserSource, /tabIndex=\{-1\}/);
  assert.match(chooserSource, /panelRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(chooserSource, /onKeyDown=\{handleKeyDown\}/);
  assert.match(chooserSource, /event\.key !== "ArrowLeft" && event\.key !== "ArrowRight"/);
  assert.match(chooserSource, /modeButtonRefs\.current\[nextIndex\]\?\.focus\(\)/);
  assert.match(chooserSource, /const disabled = !configured \|\| \(mode\.id === "compose" && !compositionAvailable\)/);
  assert.match(chooserSource, /disabled=\{disabled\}/);
  assert.match(chooserSource, /aria-pressed=\{active\}/);
  assert.match(chooserSource, /const visuallyActive = configured && \(previewMode === mode\.id \|\| committingMode === mode\.id\)/);
  assert.match(chooserSource, /onPointerEnter=\{\(\) => setPreviewMode\(mode\.id\)\}/);
  assert.match(chooserSource, /onFocus=\{\(\) => setPreviewMode\(mode\.id\)\}/);
  assert.match(chooserSource, /onClick=\{\(\) => void handleSelectMode\(mode\.id\)\}/);
  assert.match(chooserSource, /window\.setTimeout\(resolve, 220\)/);
  assert.match(chooserSource, /aria-busy=\{Boolean\(committingMode\)\}/);
  assert.match(chooserSource, /committingMode === mode\.id \? "is-committing"/);
  assert.match(chooserSource, /target\.closest\("\.ai-mode-card, \.ai-mode-exit-button, \.ai-mode-settings-button"\)/);
  assert.match(chooserSource, /!configured \? \(/);
  assert.match(chooserSource, />配置 AI<\/span>/);
  assert.doesNotMatch(chooserSource, /ai-mode-current-badge/);
  assert.doesNotMatch(chooserSource, /ai-mode-chooser-footer/);
  assert.doesNotMatch(chooserSource, /ai-mode-model-status/);
  assert.doesNotMatch(chooserSource, /providerLabel|modelLabel|modelStatusText/);
  assert.match(chooserSource, /onClick=\{onExitMode\}/);
  assert.match(chooserSource, /退出 AI 模式/);
  assert.match(chooserSource, /<LogOut size=\{15\}/);
  assert.doesNotMatch(chooserSource, /推荐/);
  assert.doesNotMatch(chooserSource, /ai-mode-chooser-header/);
  assert.match(chooserSource, /润色、改写、提炼表达/);
  assert.match(chooserSource, /问答、审阅并生成可控修改/);
  assert.match(chooserSource, /从简报和大纲生成完整文章/);
  assert.match(chooserSource, /className="ai-mode-card-copy"/);
  assert.match(chooserSource, /className="ai-mode-card-title"/);
  assert.match(chooserSource, /className="ai-mode-card-description"/);
  assert.match(chooserSource, /mode\.description/);
  assert.doesNotMatch(chooserSource, /getAiModeChooserPosition/);
  assert.match(chooserSource, /ai-optimize-card-idle-v3\.png/);
  assert.match(chooserSource, /ai-optimize-card-selected-v3\.png/);
  assert.match(chooserSource, /ai-chat-card-idle-v3\.png/);
  assert.match(chooserSource, /ai-chat-card-selected-v3\.png/);
  assert.match(chooserSource, /ai-compose-card-idle-v3\.png/);
  assert.match(chooserSource, /ai-compose-card-selected-v3\.png/);
  assert.match(chooserSource, /className="ai-mode-card-image idle"/);
  assert.match(chooserSource, /className="ai-mode-card-image selected"/);
  assert.match(chooserSource, /mode\.id === "compose" \? <span className="ai-mode-card-mark"/);
  assert.doesNotMatch(chooserSource, /ai-mode-recommendation-cover/);
  assert.match(chooserCss, /\.ai-mode-chooser-layer\s*\{[^}]*position:\s*fixed/s);
  assert.match(chooserCss, /\.ai-mode-chooser-layer\s*\{[^}]*inset:\s*var\(--desktop-titlebar-height, 40px\) 0 0/s);
  assert.doesNotMatch(chooserCss, /\.ai-mode-chooser-layer\s*\{[^}]*inset:\s*0;/s);
  assert.match(chooserCss, /\.ai-mode-chooser-layer\s*\{[^}]*place-items:\s*center/s);
  assert.match(chooserCss, /\.ai-mode-chooser-layer\s*\{[^}]*backdrop-filter:\s*none/s);
  assert.match(chooserCss, /\.ai-mode-chooser\s*\{[^}]*width:\s*min\(1100px, 100%\)/s);
  assert.match(chooserCss, /max-height:\s*calc\(100dvh - var\(--desktop-titlebar-height, 40px\) - 48px\)/);
  assert.match(chooserCss, /\.ai-mode-chooser\s*\{[^}]*border:\s*0[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s);
  assert.match(chooserCss, /\.ai-mode-chooser:focus\s*\{[^}]*outline:\s*none/s);
  assert.match(chooserCss, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(chooserCss, /\.ai-mode-card\[data-mode="compose"\]/);
  assert.match(chooserCss, /\.ai-mode-card-grid\s*\{[^}]*padding:\s*0/s);
  assert.match(chooserCss, /\.ai-mode-card\s*\{[^}]*aspect-ratio:\s*4 \/ 5/s);
  assert.match(chooserCss, /\.ai-mode-card\s*\{[^}]*border-radius:\s*20px/s);
  assert.match(chooserCss, /\.ai-mode-card-image\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*cover/s);
  assert.doesNotMatch(chooserCss, /width:\s*128%/);
  assert.match(chooserCss, /\.ai-mode-card-copy\s*\{[^}]*top:\s*65%[^}]*text-align:\s*center/s);
  assert.match(chooserCss, /\.ai-mode-card-title\s*\{[^}]*font-size:\s*clamp\(25px, 8\.4cqi, 44px\)/s);
  assert.match(chooserCss, /\.ai-mode-card\.visual-active:not\(:disabled\) \.ai-mode-card-image\.selected\s*\{[^}]*opacity:\s*1/s);
  assert.match(chooserCss, /\.ai-mode-card-mark\s*\{[^}]*bottom:\s*3\.7%[^}]*left:\s*50%[^}]*clip-path:/s);
  assert.match(chooserCss, /\.ai-mode-card\.visual-active:not\(:disabled\) \.ai-mode-card-mark/);
  assert.match(chooserCss, /@keyframes aiModeCardCommit/);
  assert.match(chooserCss, /\.ai-mode-exit-icon\s*\{/);
  assert.doesNotMatch(chooserCss, /\.ai-mode-recommendation-cover\s*\{/);
  assert.doesNotMatch(chooserCss, /\[aria-pressed=["']true["']\]/);
  assert.doesNotMatch(chooserCss, /\.ai-mode-chooser-footer|\.ai-mode-model-status|\.ai-mode-current-badge/);
  assert.match(chooserCss, /\.ai-mode-card:focus-visible,[\s\S]*outline:\s*3px solid/);
  assert.match(chooserCss, /@media \(max-width: 520px\)/);
  assert.match(chooserCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test("uses six clean portrait AI game-card artworks", () => {
  modeArtwork.forEach((relativePath) => {
    const png = fs.readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)));
    assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.ok(height > width);
    assert.ok(width / height >= 0.6 && width / height <= 0.81);
  });
});

test("uses flowing active-state color with a reduced-motion fallback", () => {
  assert.match(appCss, /animation:\s*aiModeTextFlow 3\.6s cubic-bezier\(0\.45, 0, 0\.55, 1\) infinite/);
  assert.match(appCss, /animation:\s*focusModeTextFlow 3s cubic-bezier\(0\.45, 0, 0\.55, 1\) infinite/);
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(appCss, /\.nav-menu-trigger\.focus-mode-trigger\.active > svg/);
  assert.match(appCss, /\.nav-menu-trigger\.ai-feature-trigger\.active > span/);
  assert.match(modeActionsSource, /setAiPageTransition\(kind\)/);
  assert.match(modeStateSource, /AI_MODE_PAGE_TRANSITION_MS = 560/);
  assert.match(appSource, /ai-mode-page-enter/);
  assert.match(appCss, /@keyframes aiModePageReveal/);
  assert.match(appCss, /\.app-shell\.ai-mode-page-enter \.work-surface/);
});
