import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readAppStylesSync } from "./style-test-utils.js";

const appCss = readAppStylesSync();
const appSource = fs.readFileSync(fileURLToPath(new URL("./App.jsx", import.meta.url)), "utf8");
const workspaceStyles = fs.readFileSync(fileURLToPath(new URL("./workspace-features.css", import.meta.url)), "utf8");
const templateDialogSource = fs.readFileSync(fileURLToPath(new URL("./templates/LetterTemplateDialog.jsx", import.meta.url)), "utf8");
const aiSettingsSource = [
  "./ai-settings/AiSettingsDialog.jsx",
  "./ai-settings/AiProviderSidebar.jsx",
  "./ai-settings/AiTaskModelsPanel.jsx",
  "./ai-settings/AiProviderPanel.jsx",
].map((path) => fs.readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")).join("\n");
const aiRequestParamsSource = fs.readFileSync(fileURLToPath(new URL("./ai-settings/AiRequestParamsEditor.jsx", import.meta.url)), "utf8");
const aiSettingsModelSource = fs.readFileSync(fileURLToPath(new URL("./ai-settings/model.js", import.meta.url)), "utf8");
const uiInteractionsSource = fs.readFileSync(fileURLToPath(new URL("./ui-interactions.js", import.meta.url)), "utf8");
const topNavSource = fs.readFileSync(fileURLToPath(new URL("./app-shell/TopNav.jsx", import.meta.url)), "utf8");

test("settings is a two-item toolbar menu while migration lives in Export", () => {
  const settingsMenu = topNavSource.slice(topNavSource.indexOf('menuId="settings"'), topNavSource.indexOf("</MenuButton>", topNavSource.indexOf('menuId="settings"')));
  assert.match(settingsMenu, /label="AI 配置"/);
  assert.match(settingsMenu, /label="模板配置"/);
  assert.match(settingsMenu, /showDisclosure=\{false\}/);
  assert.equal((settingsMenu.match(/<MenuItem/g) || []).length, 2);
  assert.doesNotMatch(settingsMenu, /写作检查|备份与迁移/);
  assert.match(settingsMenu, /onOpenSettings\?\.\("ai"\)/);
  assert.match(settingsMenu, /onOpenSettings\?\.\("template"\)/);
  assert.match(topNavSource, /label="备份与迁移"/);
  assert.match(topNavSource, /runMenuAction\(onOpenProfileMigration\)/);
});

test("settings menu reuses the descriptive warm-paper menu presentation", () => {
  assert.match(workspaceStyles, /#nav-menu-interchange,\s*#nav-menu-help,\s*#nav-menu-settings\{width:268px\}/);
  assert.match(workspaceStyles, /#nav-menu-settings \.nav-menu-item\.with-description/);
  assert.match(workspaceStyles, /#nav-menu-settings \.nav-menu-item:focus-visible/);
});

test("settings menu opens standalone second-level panels directly", () => {
  assert.match(appSource, /const \[settingsDialog, setSettingsDialog\] = useState\(\{[\s\S]*?section: "",[\s\S]*?targetTabId: "",[\s\S]*?aiInitialPanel: "provider"/);
  assert.doesNotMatch(appSource, /import SettingsCenter|<SettingsCenter|settingsDialog\.open|const openSettings =/);
  assert.match(appSource, /onOpenSettings=\{openSettingsSection\}/);
  assert.match(appSource, /const openSettingsSection = useCallback\(\(section\) => \{[\s\S]*?section: \["ai", "template", "writing", "profile"\]\.includes\(section\)[\s\S]*?\? section[\s\S]*?: "ai"/);
  assert.match(appSource, /<AiSettingsDialog[\s\S]*?open=\{settingsDialog\.section === "ai"\}[\s\S]*?returnFocusRef=\{settingsTriggerRef\}/);
  assert.match(appSource, /settingsDialog\.section === "template"[\s\S]*?<LetterTemplateDialog[\s\S]*?mode="manage"[\s\S]*?returnFocusRef=\{settingsTriggerRef\}/);
  assert.match(appSource, /targetTabId: current\.targetTabId[\s\S]*?activeTabIdRef\.current/);
  assert.match(templateDialogSource, /selectionOnly \|\| manageOnly \? "" : selectedLetterTemplate\.id/);
  assert.match(templateDialogSource, /manageOnly \? SYSTEM_TEMPLATE_GROUPS\[0\]\.id : getLetterTemplateGroupId\(selectedLetterTemplate\)/);
  assert.match(appSource, /document=\{\{ letterTemplateId: newDocumentTemplateId \}\}/);
  assert.doesNotMatch(appSource, /const settingsTemplateDocument/);
  assert.match(appSource, /\{ \.\.\.current, section: "" \}/);
});

test("writing check settings open from the structure check pane instead of the settings launcher", () => {
  const paneSource = fs.readFileSync(fileURLToPath(new URL("./writing-assistance/WritingAssistancePane.jsx", import.meta.url)), "utf8");
  assert.match(paneSource, /aria-label="检查设置"/);
  assert.match(paneSource, /onClick=\{onOpenSettings\}/);
  assert.match(appSource, /settingsButtonRef: writingSettingsTriggerRef/);
  assert.match(appSource, /onOpenSettings: \(\) => openSettingsSection\("writing"\)/);
  assert.match(appSource, /useModalFocusTrap\([\s\S]*settingsDialog\.section === "writing"[\s\S]*writingSettingsTriggerRef/);
  assert.match(appSource, /id="writing-settings-dialog-title">检查设置/);
});

test("standalone second-level panels trap focus and return to the settings trigger", () => {
  assert.match(uiInteractionsSource, /export function dialogFocusableElements/);
  assert.match(templateDialogSource, /closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(templateDialogSource, /returnFocusRef\?\.current \|\| previouslyFocused/);
  assert.match(templateDialogSource, /className=\{embedded \? "template-dialog-embed" : "template-dialog-overlay dialog-scrim dialog-scrim--large"\}[\s\S]*?event\.target === event\.currentTarget/);
  assert.match(templateDialogSource, /aria-label=\{selectionOnly \? "关闭模板选择" : manageOnly \? "关闭模板配置" : "关闭信笺模板"\}/);
  assert.match(aiSettingsSource, /if \(modelEditor\)[\s\S]*?setModelEditor\(null\)[\s\S]*?else if \(providerCreator\)[\s\S]*?onClose\?\.\(\)/);
});

test("AI settings separates base models from a data-driven task-model page", () => {
  assert.match(aiSettingsModelSource, /export const AI_TASK_MODEL_DEFINITIONS = \[/);
  assert.match(aiSettingsModelSource, /id: "applyResolver"[\s\S]*?label: "直接应用定位"/);
  assert.match(aiSettingsModelSource, /id: "selectionChat"[\s\S]*?label: "选区问答"/);
  assert.match(aiSettingsModelSource, /id: "composeDraft"[\s\S]*?label: "AI 起稿"/);
  assert.equal([...aiSettingsModelSource.matchAll(/label: "AI 起稿"/g)].length, 1);
  assert.doesNotMatch(aiSettingsModelSource, /AI 起稿 · (?:大纲|正文|审阅)/);
  assert.match(aiSettingsModelSource, /整个起稿流程统一使用这一模型/);
  assert.match(aiSettingsModelSource, /只判断优化块在正文中的替换或插入位置，不参与内容优化与改写/);
  assert.match(aiSettingsSource, /<strong>基础模型<\/strong>/);
  assert.match(aiSettingsSource, /className=\{activePanel === "tasks" \? "ai-task-model-nav selected"/);
  assert.match(aiSettingsSource, /<h2 id="ai-settings-title">任务模型<\/h2>/);
  assert.match(aiSettingsSource, /AI_TASK_MODEL_DEFINITIONS\.map\(\(task\) =>/);
  assert.match(aiSettingsSource, /ariaLabel=\{`\$\{task\.label\}供应商`\}/);
  assert.match(aiSettingsSource, /ariaLabel=\{`\$\{task\.label\}模型`\}/);
  assert.match(aiSettingsSource, /title="任务请求参数"/);
  assert.match(aiSettingsSource, /aiTaskRequestParamsForEditor/);
  assert.match(aiSettingsSource, /compact[\s\S]*?flat[\s\S]*?title="任务请求参数"/);
  assert.match(aiSettingsSource, /已显示所选模型参数；修改或新增字段仅用于当前任务/);
  assert.match(aiSettingsSource, /任务将继承基础模型中的 Codex 推理强度/);
  assert.match(aiSettingsSource, /requestTaskProviderChange/);
  assert.match(aiSettingsSource, /taskProviderConfirm/);
  assert.match(aiSettingsSource, /resolverProviderGroups\.map\(\(provider\) => \(\{ value: provider\.id, label: provider\.label \}\)\)/);
  assert.match(aiSettingsSource, /value=\{modelAvailable \? effectiveModelKey : ""\}/);
  assert.match(aiSettingsSource, /未单独指定，当前跟随默认模型/);
  assert.match(aiSettingsSource, /taskModelNavLabel[\s\S]*?跟随默认/);
  assert.match(aiSettingsSource, /原任务模型已失效，请重新选择/);
  assert.doesNotMatch(aiSettingsSource, /<optgroup/);
  assert.doesNotMatch(aiSettingsSource, /ai-apply-resolver-section/);
});

test("Codex model saves omit display-only Base URLs and surface action feedback", () => {
  assert.match(aiSettingsModelSource, /id: "codex-cli"[\s\S]*?baseUrl: ""/);
  assert.match(aiSettingsModelSource, /export function getAiProviderSaveBaseUrl/);
  assert.match(aiSettingsSource, /baseUrl: getAiProviderSaveBaseUrl\(selectedDraft\)/);
  assert.match(aiSettingsSource, /className=\{`ai-provider-feedback \$\{status\.tone\}`\}/);
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

test("task-model cards are independent accessible disclosures with one-session state", () => {
  assert.match(aiSettingsSource, /initialTaskId = ""/);
  assert.match(
    aiSettingsSource,
    /AI_TASK_MODEL_DEFINITIONS\.some\(\(task\) => task\.id === initialTaskId\)/,
  );
  assert.match(
    aiSettingsSource,
    /setExpandedTaskIds\(requestedTaskId \? \[requestedTaskId\] : \[\]\)/,
  );
  assert.match(aiSettingsSource, /expandedTaskIds=\{expandedTaskIds\}/);
  assert.match(aiSettingsSource, /focusTaskId=\{taskFocusRequestId\}/);
  assert.match(aiSettingsSource, /current\.filter\(\(id\) => id !== taskId\)/);
  assert.match(aiSettingsSource, /\[\.\.\.current, taskId\]/);
  assert.match(aiSettingsSource, /className="ai-task-model-summary"/);
  assert.match(aiSettingsSource, /aria-expanded=\{isExpanded\}/);
  assert.match(aiSettingsSource, /aria-controls=\{bodyId\}/);
  assert.match(aiSettingsSource, /aria-hidden=\{!isExpanded\}/);
  assert.match(aiSettingsSource, /inert=\{isExpanded \? undefined : true\}/);
  assert.match(aiSettingsSource, /taskHeaderRefs\.current\[focusTaskId\]\?\.focus/);
  assert.match(aiSettingsSource, /默认模型 · /);
  assert.doesNotMatch(aiSettingsSource, /ai-task-model-badge default/);
  assert.match(aiSettingsSource, />参数未保存<\/span>/);
  assert.match(aiSettingsSource, />需重选<\/span>/);
  assert.match(aiSettingsSource, /normalizeUiAiRequestParams,/);
  assert.match(appCss, /\.ai-task-model-body-shell\s*\{[\s\S]*?grid-template-rows:\s*0fr/);
  assert.match(appCss, /\.ai-task-model-card\.expanded \.ai-task-model-body-shell\s*\{[\s\S]*?grid-template-rows:\s*1fr/);
  assert.match(appCss, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.ai-task-model-chevron/);
});

test("AI model request parameter controls and subdialogs use product-styled components", () => {
  assert.match(aiSettingsSource, /className="ai-model-table ai-http-model-table"/);
  assert.match(aiSettingsSource, /ariaLabel=\{`\$\{model\.name\} 推理强度`\}/);
  assert.match(aiSettingsSource, /<span>请求参数<\/span>/);
  assert.match(aiSettingsSource, /className="ai-model-params-control"/);
  assert.match(aiSettingsSource, /<AiRequestParamsEditor/);
  assert.match(aiSettingsSource, /disabled=\{busy\}[\s\S]*?flat[\s\S]*?title="请求参数"/);
  assert.match(aiRequestParamsSource, /className="ai-request-param-info"/);
  assert.match(aiRequestParamsSource, /className="ai-request-param-key-field"[\s\S]*?<input[\s\S]*?className="ai-request-param-error"/);
  assert.match(aiRequestParamsSource, /className="ai-request-param-add-button"/);
  assert.match(aiRequestParamsSource, /className="ai-request-param-value-input"/);
  assert.doesNotMatch(aiRequestParamsSource, /className="ai-request-param-add-select"/);
  assert.match(aiRequestParamsSource, /app-info-tooltip-bubble/);
  assert.doesNotMatch(aiRequestParamsSource, /title=\{rowHint\}/);
  assert.match(aiRequestParamsSource, /ai-request-param-json-field/);
  assert.match(aiRequestParamsSource, /expandedJsonRows\.has\(row\.id\)/);
  assert.doesNotMatch(aiRequestParamsSource, /<small className="ai-request-param-hint"/);
  assert.match(aiSettingsSource, /<span>context_window<\/span>/);
  assert.match(aiSettingsSource, /<span>max_output_tokens<\/span>/);
  assert.match(aiSettingsSource, /不会作为请求参数发送/);
  assert.match(aiRequestParamsSource, /ariaLabel=\{`\$\{row\.key \|\| `参数 \$\{index \+ 1\}`\}类型`\}/);
  assert.doesNotMatch(aiSettingsSource, /ariaLabel="模型推理强度"/);
  assert.match(appCss, /\.ai-settings-subdialog-backdrop\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.match(appCss, /\.ai-request-param-row\s*\{/);
  assert.match(appCss, /\.ai-request-param-value-input/);
  assert.match(appCss, /\.ai-request-param-key-field > \.ai-request-param-error\s*\{[\s\S]*?grid-column:\s*2/);
  assert.match(appCss, /\.ai-model-capabilities-fields > label\s*\{[\s\S]*?font-size:\s*11\.5px[\s\S]*?font-weight:\s*630/);
  assert.match(appCss, /\.ai-model-capabilities-fields > label:first-child\s*\{[\s\S]*?padding-left:\s*10px/);
  assert.match(appCss, /\.ai-settings-subdialog footer button\s*\{[\s\S]*?font-family:\s*var\(--body-font\)/);
});
