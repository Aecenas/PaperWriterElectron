import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (relativePath) => (await readFile(new URL(relativePath, import.meta.url), "utf8")).replace(/\r\n?/g, "\n");
const [topNav, dialog, app, styles, taskModel, workspaceStyles] = await Promise.all([
  read("./app-shell/TopNav.jsx"),
  read("./help-assistant/HelpAssistantDialog.jsx"),
  read("./App.jsx"),
  read("./styles-status-export-help.css"),
  read("./ai-settings/model.js"),
  read("./workspace-features.css"),
]);

test("help is one two-item menu and preserves the existing help center entry", () => {
  const menu = topNav.slice(topNav.indexOf('menuId="help"'), topNav.indexOf('menuId="settings"'));
  assert.match(menu, /label="帮助文档"/);
  assert.match(menu, /label="AI精灵"/);
  assert.match(menu, /showDisclosure=\{false\}/);
  assert.equal((menu.match(/<MenuItem/g) || []).length, 2);
  assert.doesNotMatch(menu, /onClick=\{\(\) => runMenuAction\(onOpenHelp\)\}[\s\S]*?<span>帮助<\/span>/);
  assert.match(app, /onOpenHelpAssistant=\{handleOpenHelpAssistant\}/);
  assert.match(app, /initialTopicId=\{helpTargetTopicId\}/);
  assert.match(workspaceStyles, /#nav-menu-interchange,\s*#nav-menu-help,\s*#nav-menu-settings\{width:268px\}/);
  assert.match(workspaceStyles, /#nav-menu-help \.nav-menu-item\.with-description/);
});

test("AI精灵 UI includes persistent multi-session controls, dedicated streaming, and source jumps", () => {
  [
    "getHelpAssistantState",
    "createHelpAssistantSession",
    "setActiveHelpAssistantSession",
    "renameHelpAssistantSession",
    "deleteHelpAssistantSession",
    "generateHelpAssistant",
    "cancelHelpAssistant",
    "onHelpAssistantChunk",
    "onHelpAssistantDone",
    "onHelpAssistantError",
  ].forEach((method) => assert.match(dialog, new RegExp(`bridge\\.${method}`), method));
  assert.match(dialog, /Enter 发送，Shift\+Enter 换行/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /useModalFocusTrap\(open, dialogRef, closeButtonRef, returnFocusRef\)/);
  assert.match(dialog, /aria-live="polite"/);
  assert.match(dialog, /source\.kind === "detail" \? "补充知识" : "帮助文档"/);
  assert.match(dialog, /onOpenHelpTopic\?\.\(source\.helpTopicId\)/);
  assert.match(dialog, /只回答“笺间”的功能与使用问题/);
  assert.match(dialog, /不会读取当前正文、文件路径、资料区或其他 AI 记录/);
  assert.match(dialog, /每个问题都会交给你配置的 AI/);
  assert.match(dialog, /AI_ASSISTANT_WELCOME_MARK/);
  assert.match(dialog, /help-assistant-model-info/);
  assert.doesNotMatch(dialog, /help-assistant-model-info-icon/);
  assert.match(dialog, /<strong>\{modelStatus\.label\}<\/strong>[\s\S]*?<small>当前回答模型 · \{modelStatus\.message\}<\/small>/);
  assert.doesNotMatch(dialog, /help-assistant-model-strip/);
  assert.match(dialog, /可以这样问/);
});

test("AI精灵 has an independent task model and responsive accessible presentation", () => {
  assert.match(taskModel, /id: "helpAssistant"[\s\S]*?label: "AI精灵"/);
  assert.match(app, /openAiSettings\(\{ panel: "tasks", taskId: "helpAssistant" \}\)/);
  assert.match(styles, /\.help-assistant-dialog\s*\{[\s\S]*?grid-template-columns:\s*270px minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 860px\), \(max-height: 640px\)[\s\S]*?\.help-assistant-dialog\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.help-assistant-dialog button:focus-visible/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
