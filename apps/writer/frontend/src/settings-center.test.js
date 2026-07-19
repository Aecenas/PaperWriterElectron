import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(fileURLToPath(new URL("./SettingsCenter.jsx", import.meta.url)), "utf8");
const css = fs.readFileSync(fileURLToPath(new URL("./settings-center.css", import.meta.url)), "utf8");
const appCss = fs.readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");
const appSource = fs.readFileSync(fileURLToPath(new URL("./App.jsx", import.meta.url)), "utf8");

test("settings center is a first-level launcher with two destinations", () => {
  assert.match(source, /AI 配置/);
  assert.match(source, /模板配置/);
  assert.match(source, /onSelectSection\?\.\(destination\.id\)/);
  assert.match(source, /id: "ai"/);
  assert.match(source, /id: "template"/);
  assert.doesNotMatch(source, /aiContent|templateContent|onSectionChange|activeSection/);
  assert.doesNotMatch(source, /settings-center-sidebar|settings-center-content/);
});

test("settings launcher remains an accessible, dismissible focus-trapped modal", () => {
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-labelledby="settings-center-title"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /event\.target === event\.currentTarget/);
  assert.match(source, /anchorRef\?\.current \|\| previouslyFocusedRef\.current/);
  assert.match(source, /firstDestinationRef\.current\?\.focus/);
  assert.match(source, /destinationSelectedRef\.current = true/);
  assert.match(source, /if \(!destinationSelectedRef\.current\)/);
});

test("settings launcher uses responsive cards without compact-dialog backdrop blur", () => {
  assert.match(css, /backdrop-filter:\s*none/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.settings-center-destination:focus-visible/);
  assert.match(css, /min-height:\s*188px/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /settings-embedded|settings-center-navigation/);
});

test("the launcher exits before opening a standalone second-level panel", () => {
  assert.match(appSource, /useState\(\{ open: false, section: "", targetTabId: "" \}\)/);
  assert.match(appSource, /const openSettings = useCallback\(\(\) => \{[\s\S]*?open: true,[\s\S]*?section: ""/);
  assert.match(appSource, /const openSettingsSection = useCallback\(\(section\) => \{[\s\S]*?open: false,[\s\S]*?section: section === "template" \? "template" : "ai"/);
  assert.match(appSource, /onSelectSection=\{openSettingsSection\}/);
  assert.match(appSource, /<AiSettingsDialog[\s\S]*?open=\{settingsDialog\.section === "ai"\}[\s\S]*?returnFocusRef=\{settingsTriggerRef\}/);
  assert.match(appSource, /settingsDialog\.section === "template"[\s\S]*?<LetterTemplateDialog[\s\S]*?mode="manage"[\s\S]*?returnFocusRef=\{settingsTriggerRef\}/);
  const settingsRender = appSource.slice(appSource.indexOf("<SettingsCenter"), appSource.indexOf("<HelpCenterDialog"));
  assert.doesNotMatch(settingsRender, /\bembedded\b|aiContent|templateContent|onSectionChange/);
  assert.match(appSource, /targetTabId: current\.targetTabId[\s\S]*?activeTabIdRef\.current/);
  assert.match(appSource, /selectionOnly \|\| manageOnly \? "" : selectedLetterTemplate\.id/);
  assert.match(appSource, /manageOnly \? SYSTEM_TEMPLATE_GROUPS\[0\]\.id : getLetterTemplateGroupId\(selectedLetterTemplate\)/);
  assert.match(appSource, /document=\{\{ letterTemplateId: newDocumentTemplateId \}\}/);
  assert.doesNotMatch(appSource, /const settingsTemplateDocument/);
  assert.match(appSource, /\{ \.\.\.current, open: false, section: "" \}/);
});

test("standalone second-level panels trap focus and return to the settings trigger", () => {
  assert.match(appSource, /function dialogFocusableElements/);
  assert.match(appSource, /closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(appSource, /returnFocusRef\?\.current \|\| previouslyFocused/);
  assert.match(appSource, /className=\{embedded \? "template-dialog-embed" : "template-dialog-overlay dialog-scrim dialog-scrim--large"\}[\s\S]*?event\.target === event\.currentTarget/);
  assert.match(appSource, /aria-label=\{selectionOnly \? "关闭模板选择" : manageOnly \? "关闭模板配置" : "关闭信笺模板"\}/);
  assert.match(appSource, /if \(modelEditor\)[\s\S]*?setModelEditor\(null\)[\s\S]*?else if \(providerCreator\)[\s\S]*?onClose\?\.\(\)/);
});

test("AI settings separates base models from a data-driven task-model page", () => {
  assert.match(appSource, /const AI_TASK_MODEL_DEFINITIONS = \[/);
  assert.match(appSource, /id: "applyResolver"[\s\S]*?label: "直接应用定位"/);
  assert.match(appSource, /只判断优化块在正文中的替换或插入位置，不参与内容优化与改写/);
  assert.match(appSource, /<strong>基础模型<\/strong>/);
  assert.match(appSource, /className=\{activePanel === "tasks" \? "ai-task-model-nav selected"/);
  assert.match(appSource, /<h2 id="ai-settings-title">任务模型<\/h2>/);
  assert.match(appSource, /AI_TASK_MODEL_DEFINITIONS\.map\(\(task\) =>/);
  assert.match(appSource, /ariaLabel=\{`\$\{task\.label\}供应商`\}/);
  assert.match(appSource, /ariaLabel=\{`\$\{task\.label\}模型`\}/);
  assert.match(appSource, /title="任务请求参数"/);
  assert.match(appSource, /aiTaskRequestParamsForEditor/);
  assert.match(appSource, /compact[\s\S]*?flat[\s\S]*?title="任务请求参数"/);
  assert.match(appSource, /已显示所选模型参数；修改或新增字段仅用于当前任务/);
  assert.match(appSource, /任务将继承基础模型中的 Codex 推理强度/);
  assert.match(appSource, /requestTaskProviderChange/);
  assert.match(appSource, /taskProviderConfirm/);
  assert.match(appSource, /resolverProviderGroups\.map\(\(provider\) => \(\{ value: provider\.id, label: provider\.label \}\)\)/);
  assert.match(appSource, /value=\{modelAvailable \? effectiveModelKey : ""\}/);
  assert.match(appSource, /未单独指定，当前跟随默认模型/);
  assert.match(appSource, /taskModelNavLabel[\s\S]*?跟随默认/);
  assert.match(appSource, /原任务模型已失效，请重新选择/);
  assert.doesNotMatch(appSource, /<optgroup/);
  assert.doesNotMatch(appSource, /ai-apply-resolver-section/);
});

test("task-model navigation is divided, responsive and keyboard-visible", () => {
  assert.match(appCss, /\.ai-settings-sidebar\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(appCss, /\.ai-task-model-nav-wrap\s*\{[\s\S]*?border-top:/);
  assert.match(appCss, /\.ai-task-model-select \.template-select-trigger/);
  assert.match(appCss, /\.template-select-trigger:focus-visible/);
  assert.match(appCss, /\.ai-task-model-card\.invalid/);
  assert.match(appCss, /\.ai-task-model-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(appCss, /\.ai-task-model-selectors\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(appCss, /minmax\(520px/);
});

test("AI model request parameter controls and subdialogs use product-styled components", () => {
  assert.match(appSource, /className="ai-model-table ai-http-model-table"/);
  assert.match(appSource, /ariaLabel=\{`\$\{model\.name\} 推理强度`\}/);
  assert.match(appSource, /<span>请求参数<\/span>/);
  assert.match(appSource, /className="ai-model-params-control"/);
  assert.match(appSource, /<AiRequestParamsEditor/);
  assert.match(appSource, /disabled=\{busy\}[\s\S]*?flat[\s\S]*?title="请求参数"/);
  assert.match(appSource, /className="ai-request-param-info"/);
  assert.match(appSource, /className="ai-request-param-key-field"[\s\S]*?<input[\s\S]*?className="ai-request-param-error"/);
  assert.match(appSource, /className="ai-request-param-add-button"/);
  assert.match(appSource, /className="ai-request-param-value-input"/);
  assert.doesNotMatch(appSource, /className="ai-request-param-add-select"/);
  assert.match(appSource, /app-info-tooltip-bubble/);
  assert.doesNotMatch(appSource, /title=\{rowHint\}/);
  assert.match(appSource, /ai-request-param-json-field/);
  assert.match(appSource, /expandedJsonRows\.has\(row\.id\)/);
  assert.doesNotMatch(appSource, /<small className="ai-request-param-hint"/);
  assert.match(appSource, /<span>context_window<\/span>/);
  assert.match(appSource, /<span>max_output_tokens<\/span>/);
  assert.match(appSource, /不会作为请求参数发送/);
  assert.match(appSource, /ariaLabel=\{`\$\{row\.key \|\| `参数 \$\{index \+ 1\}`\}类型`\}/);
  assert.doesNotMatch(appSource, /ariaLabel="模型推理强度"/);
  assert.match(appCss, /\.ai-settings-subdialog-backdrop\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.match(appCss, /\.ai-request-param-row\s*\{/);
  assert.match(appCss, /\.ai-request-param-value-input/);
  assert.match(appCss, /\.ai-request-param-key-field > \.ai-request-param-error\s*\{[\s\S]*?grid-column:\s*2/);
  assert.match(appCss, /\.ai-model-capabilities-fields > label\s*\{[\s\S]*?font-size:\s*11\.5px[\s\S]*?font-weight:\s*630/);
  assert.match(appCss, /\.ai-model-capabilities-fields > label:first-child\s*\{[\s\S]*?padding-left:\s*10px/);
  assert.match(appCss, /\.ai-settings-subdialog footer button\s*\{[\s\S]*?font-family:\s*var\(--body-font\)/);
});
