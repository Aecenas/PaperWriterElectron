import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const popoverSource = source("./selection-ai/SelectionAiPopover.jsx");
const markdownSource = source("./selection-ai/SelectionAiMarkdown.jsx");
const popoverCss = source("./selection-ai/SelectionAiPopover.css");
const appSource = source("./App.jsx");
const toolbarSource = source("./editor/SelectionBubbleToolbar.jsx");
const paperCanvasSource = source("./editor/PaperCanvas.jsx");
const settingsSource = source("./ai-settings/AiSettingsDialog.jsx");
const taskModelsSource = source("./ai-settings/AiTaskModelsPanel.jsx");

test("selection AI assistant keeps temporary privacy, multi-session, minimize, and accessibility controls", () => {
  assert.match(popoverSource, /role="dialog"/);
  assert.match(popoverSource, /aria-describedby="selection-ai-privacy-note"/);
  assert.match(popoverSource, /仅发送选中内容快照、你的问题和当前会话历史/);
  assert.match(popoverSource, /onCopy=\{controller\.copyReply\}/);
  assert.match(popoverSource, /<SelectionAiMarkdown text=\{message\.content\}/);
  assert.match(markdownSource, /parseSelectionAiMarkdown/);
  assert.match(markdownSource, /bridge\.openExternal\?\.\(token\.href\)/);
  assert.doesNotMatch(markdownSource, /dangerouslySetInnerHTML/);
  assert.match(popoverSource, /controller\.newConversation\?\./);
  assert.match(popoverSource, /新会话（保留当前选区）/);
  assert.match(popoverSource, /role="tablist"/);
  assert.match(popoverSource, /SelectionAiSnapshot/);
  assert.match(popoverSource, /controller\.minimize\?\./);
  assert.match(popoverSource, /export function SelectionAiSprite/);
  assert.doesNotMatch(popoverSource, /dangerouslySetInnerHTML/);
  assert.match(popoverCss, /\.selection-ai-popover\s*\{/);
  assert.match(popoverCss, /\.selection-ai-sprite\s*\{/);
  assert.match(popoverCss, /prefers-reduced-motion/);
});

test("read-only paper selection exposes only the selection AI action", () => {
  assert.match(
    paperCanvasSource,
    /disabled=\{printMode \|\| imageExportMode\}[\s\S]*?readOnly=\{readOnly\}/,
  );
  assert.match(
    toolbarSource,
    /disabled \|\| \(readOnly && !selectionAiEnabled\)/,
  );
  assert.match(toolbarSource, /\{!readOnly \? \([\s\S]*?<IconButton/);
  assert.match(toolbarSource, /\{selectionAiEnabled \? \([\s\S]*?>问 AI</);
  assert.match(toolbarSource, /\{aiCaptureEnabled && !readOnly \? \(/);
});

test("selection settings can open task models and always restore following default", () => {
  assert.match(settingsSource, /initialPanel = "provider"/);
  assert.match(
    settingsSource,
    /setActivePanel\(requestedTaskId \|\| initialPanel === "tasks" \? "tasks" : "provider"\)/,
  );
  assert.match(taskModelsSource, /\{ value: "", label: "跟随默认模型" \}/);
  assert.match(taskModelsSource, /disabled=\{busy\}/);
  assert.doesNotMatch(
    taskModelsSource,
    /disabled=\{busy \|\| !resolverModels\.length\}/,
  );
});

test("App mounts one in-memory multi-session controller and pane-local sprites", () => {
  assert.match(appSource, /useSelectionAiController\(\{[\s\S]*?aiConfig/);
  assert.match(
    appSource,
    /onOpenSettings:\s*openAiSettings[\s\S]*?onStatus:\s*showStatus/,
  );
  assert.match(
    appSource,
    /openSelectionAiForPane\("main", selection, anchor\)/,
  );
  assert.match(
    appSource,
    /openSelectionAiForPane\("right", selection, anchor\)/,
  );
  assert.match(appSource, /<SelectionAiPopover[\s\S]*?controller=\{selectionAi\}/);
  assert.match(appSource, /<SelectionAiSprite[\s\S]*?tabId=\{activeTabId\}/);
  assert.match(appSource, /<SelectionAiSprite[\s\S]*?tabId=\{rightSplitTabId\}/);
  assert.match(appSource, /selectionAi\.syncOpenTabs\(openTabs\)/);
  assert.match(
    appSource,
    /initialPanel=\{settingsDialog\.aiInitialPanel \|\| "provider"\}/,
  );
  assert.match(
    appSource,
    /initialTaskId=\{settingsDialog\.aiInitialTaskId \|\| ""\}/,
  );
});
