import { expect, test } from "@playwright/test";
import {
  createTestAiConfig,
  createTestDocument,
  installBrowserPreviewState,
  installDesktopBridgeFixture,
  openPaperWriter,
} from "./support/paperwriter-fixtures.js";

async function openReleasePreview(page, {
  aiConfig = null,
  researchKind = "",
} = {}) {
  await installBrowserPreviewState(page, { aiConfig });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const search = new URLSearchParams({ researchPreview: "1" });
  if (researchKind) search.set("researchKind", researchKind);
  await page.goto(`/?${search.toString()}`);
  await page.locator(".paper-workspace").waitFor({ state: "visible" });
  await page.locator(".paper-sheet").first().waitFor({ state: "visible" });
  return pageErrors;
}

async function selectEditorText(page, text) {
  const editor = page.locator(".canvas.active-pane .ProseMirror");
  await editor.fill(text);
  await editor.click();
  await page.keyboard.press("Control+A");
  await expect(page.getByRole("button", { name: "询问 AI", exact: true })).toBeVisible();
  return editor;
}

test.describe("1.0.0 release regressions", () => {
  test("PDF search highlights every page match and navigates the global result count", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const pageErrors = await openReleasePreview(page, { researchKind: "pdf" });
    await page.getByRole("tab", { name: "资料", exact: true }).click();
    await page.getByRole("treeitem", { name: "阅读示例.pdf", exact: true }).click();
    const reader = page.getByRole("complementary", { name: "资料阅读区" });
    const toolbar = reader.getByRole("toolbar", { name: "PDF 阅读控制" });

    await toolbar.getByRole("button", { name: "展开 PDF 搜索" }).click();
    const search = toolbar.getByRole("search");
    const query = search.getByRole("textbox", { name: "搜索 PDF 文字" });
    await query.fill("research");
    await query.press("Enter");

    await expect(search.locator(":scope > span")).toHaveText("1/3");
    await expect(reader.locator(".secondary-pdf-text-layer mark")).toHaveCount(1);
    await expect(reader.locator(".secondary-pdf-text-layer mark.is-active")).toHaveText(/Research/i);

    await query.press("Enter");
    await expect(toolbar.getByRole("textbox", { name: "当前 PDF 页码" })).toHaveValue("2");
    await expect(search.locator(":scope > span")).toHaveText("2/3");
    await expect(reader.locator(".secondary-pdf-text-layer mark")).toHaveCount(2);
    await expect(reader.locator(".secondary-pdf-text-layer mark.is-active")).toHaveCount(1);

    await search.getByRole("button", { name: "下一个 PDF 匹配" }).click();
    await expect(search.locator(":scope > span")).toHaveText("3/3");
    await search.getByRole("button", { name: "上一个 PDF 匹配" }).click();
    await expect(search.locator(":scope > span")).toHaveText("2/3");

    if (process.env.PAPERWRITER_PDF_SEARCH_SCREENSHOT) {
      await page.screenshot({
        path: process.env.PAPERWRITER_PDF_SEARCH_SCREENSHOT,
        fullPage: false,
      });
    }
    expect(pageErrors).toEqual([]);
  });

  test("help center explains research search and the non-AI-mode selection assistant", async ({ page }) => {
    const pageErrors = await openReleasePreview(page);
    await page.getByRole("button", { name: "帮助", exact: true }).click();
    const help = page.getByRole("dialog", { name: "帮助中心" });

    await help.getByRole("button", { name: "文档、文件夹与资料搜索" }).click();
    await expect(help).toContainText("从顶部搜索菜单选择资料搜索");
    await expect(help).toContainText("图片及不支持格式只搜索名称和路径");

    await help.getByRole("button", { name: "选区格式、链接与轻量 AI" }).click();
    await expect(help).toContainText("点击悬浮条中的问 AI");
    await expect(help).toContainText("AI 小精灵");
    await expect(help).toContainText("不会读取其他正文或资料");

    expect(pageErrors).toEqual([]);
  });

  test("research search opens an indexed result and positions its body match", async ({ page }) => {
    const pageErrors = await openReleasePreview(page, { researchKind: "markdown" });

    await page.getByRole("button", { name: "选择搜索范围" }).click();
    const researchSearchItem = page.getByRole("menuitem", { name: /资料搜索/ });
    await expect(researchSearchItem).toBeEnabled();
    await researchSearchItem.click();

    const dialog = page.getByRole("dialog", { name: "资料搜索" });
    const query = dialog.getByRole("combobox");
    await expect(query).toBeFocused();
    await query.fill("人物关系");

    const result = dialog.getByRole("option", { name: /scene\.md/ });
    await expect(result).toBeVisible();
    await expect(result).toContainText("人物关系");
    await page.keyboard.press("Enter");

    await expect(dialog).toBeHidden();
    const reader = page.getByRole("complementary", { name: "资料阅读区" });
    const article = reader.getByRole("article", { name: "Markdown 资料内容" });
    await expect(article).toContainText("人物关系");
    await expect(article.locator("mark.is-active")).toHaveText("人物关系");

    expect(pageErrors).toEqual([]);
  });

  test("selection AI renders assistant Markdown while preserving user messages as plain text", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const documentPath = "C:\\e2e\\selection-markdown.letterpaper";
    const response = [
      "**加粗结论**与*斜体补充*。",
      "",
      "1. **第一层标题**",
      "   第一项续行正文",
      "2. **第二层标题**",
      "   第二项续行正文含 `const ok = true`",
      "",
      "~~已删除内容~~",
      "",
      "安全[文档](https://example.com/guide)，危险[链接](javascript:alert(1))。",
    ].join("\n");
    const aiConfig = createTestAiConfig();
    aiConfig.providers.gemini.hasApiKey = true;
    await installDesktopBridgeFixture(page, {
      documents: {
        [documentPath]: createTestDocument({
          body: "用于验证选区 AI Markdown 的正文。",
        }),
      },
      activePath: documentPath,
      aiConfig,
      selectionAiResponse: response,
    });
    const pageErrors = await openPaperWriter(page);

    await selectEditorText(page, "用于验证选区 AI Markdown 的正文。");
    await page.getByRole("button", { name: "询问 AI", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "选区 AI 问答" });
    const question = dialog.getByRole("textbox", { name: "选区问答问题" });
    await question.fill("请保留 **用户星号** 与 `用户代码` 为纯文本");
    await question.press("Enter");

    const userBubble = dialog.locator(".selection-ai-message.user > p");
    await expect(userBubble).toHaveText(
      "请保留 **用户星号** 与 `用户代码` 为纯文本",
    );
    await expect(userBubble.locator("strong, em, del, code, ol, ul")).toHaveCount(0);

    const assistantMarkdown = dialog.locator(
      ".selection-ai-message.assistant .selection-ai-markdown",
    );
    const firstBold = assistantMarkdown.locator("strong").first();
    await expect(firstBold).toHaveText("加粗结论");
    expect(await firstBold.evaluate((element) => ({
      bold: getComputedStyle(element).fontSize,
      parent: getComputedStyle(element.parentElement).fontSize,
    }))).toEqual({
      bold: "12.5px",
      parent: "12.5px",
    });
    await expect(assistantMarkdown.locator("em")).toHaveText("斜体补充");
    const orderedItems = assistantMarkdown.locator("ol > li");
    await expect(orderedItems).toHaveCount(2);
    await expect(orderedItems.nth(0).locator("strong")).toHaveText("第一层标题");
    await expect(orderedItems.nth(0)).toContainText("第一项续行正文");
    expect(await orderedItems.nth(0).textContent()).toContain(
      "第一层标题\n第一项续行正文",
    );
    await expect(orderedItems.nth(0)).toHaveCSS("white-space", "pre-wrap");
    await expect(orderedItems.nth(1).locator("strong")).toHaveText("第二层标题");
    await expect(orderedItems.nth(1)).toContainText(
      "第二项续行正文含 const ok = true",
    );
    await expect(assistantMarkdown.locator("code")).toHaveText("const ok = true");
    await expect(assistantMarkdown.locator("del")).toHaveText("已删除内容");
    await expect(assistantMarkdown.locator("a")).toHaveCount(1);
    await expect(assistantMarkdown.locator("a")).toHaveAttribute(
      "href",
      "https://example.com/guide",
    );
    await expect(assistantMarkdown).toContainText(
      "[链接](javascript:alert(1))",
    );
    await expect(assistantMarkdown).not.toContainText("**加粗结论**");
    await expect(assistantMarkdown).not.toContainText("*斜体补充*");
    await expect(assistantMarkdown).not.toContainText("`const ok = true`");
    if (process.env.PAPERWRITER_SELECTION_MARKDOWN_SCREENSHOT) {
      await page.screenshot({
        path: process.env.PAPERWRITER_SELECTION_MARKDOWN_SCREENSHOT,
        fullPage: false,
      });
    }

    expect(pageErrors).toEqual([]);
  });

  test("selection AI keeps multiple frozen sessions and minimizes to its document sprite", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const pageErrors = await openReleasePreview(page, {
      aiConfig: createTestAiConfig(),
    });
    const selectedText = "这是用于验证选区快照与焦点恢复的文字。";
    const editor = await selectEditorText(page, selectedText);

    await page.getByRole("button", { name: "询问 AI", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "选区 AI 问答" });
    await expect(dialog).toBeVisible();
    const question = dialog.getByRole("textbox", { name: "选区问答问题" });
    await expect(question).toBeFocused();
    await dialog.getByRole("button", { name: "更多会话操作" }).click();
    await dialog.getByRole("menuitem", { name: "关闭全部会话" }).click();
    const closeAllPrompt = page.getByRole("dialog", { name: "关闭全部 1 个会话？" });
    await expect(closeAllPrompt).toBeVisible();
    await closeAllPrompt.getByRole("button", { name: "取消" }).click();
    await expect(dialog).toBeVisible();
    const dragHandle = dialog.locator(".selection-ai-popover-header");
    const initialBounds = await dialog.boundingBox();
    await dragHandle.hover({ position: { x: 230, y: 26 } });
    await page.mouse.down();
    await page.mouse.move(
      initialBounds.x + 310,
      initialBounds.y + 74,
      { steps: 4 },
    );
    await page.mouse.up();
    const draggedBounds = await dialog.boundingBox();
    expect(draggedBounds.x).toBeGreaterThan(initialBounds.x + 40);
    expect(draggedBounds.y).toBeGreaterThanOrEqual(12);
    expect(draggedBounds.y + draggedBounds.height).toBeLessThanOrEqual(720 - 48 + 1);
    await dragHandle.focus();
    await dragHandle.press("Shift+ArrowLeft");
    const keyboardMovedBounds = await dialog.boundingBox();
    expect(keyboardMovedBounds.x).toBeLessThan(draggedBounds.x - 40);
    const sessionTabs = dialog.getByRole("tab");
    await expect(sessionTabs).toHaveCount(1);
    const snapshotTrigger = dialog.locator(".selection-ai-snapshot-trigger");
    await expect(snapshotTrigger).toContainText(selectedText);
    await expect(dialog.getByRole("region", { name: "完整选中内容快照" })).toHaveCount(0);
    await snapshotTrigger.focus();
    await snapshotTrigger.press("Enter");
    const fullSnapshot = dialog.getByRole("region", { name: "完整选中内容快照" });
    await expect(fullSnapshot).toContainText(selectedText);
    await page.keyboard.press("Escape");
    await expect(fullSnapshot).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(snapshotTrigger).toBeFocused();
    if (process.env.PAPERWRITER_SELECTION_SCREENSHOT) {
      await page.screenshot({
        path: process.env.PAPERWRITER_SELECTION_SCREENSHOT,
        fullPage: false,
      });
    }

    await question.fill("第一行问题");
    await question.press("Shift+Enter");
    await expect(question).toHaveValue("第一行问题\n");
    await expect(dialog.locator(".selection-ai-message.user")).toHaveCount(0);
    await question.pressSequentially("第二行");
    await question.press("Enter");

    await expect(dialog.locator(".selection-ai-message.user")).toHaveCount(1);
    await expect(dialog.locator(".selection-ai-message.user").first()).toContainText("第一行问题");
    await expect(dialog.locator(".selection-ai-message.user").first()).toContainText("第二行");
    await expect(dialog.locator(".selection-ai-message.assistant").first()).toContainText(
      "这是选区问答的浏览器预览回复。",
    );

    await question.fill("第二轮只沿用冻结快照");
    await question.press("Enter");
    await expect(dialog.locator(".selection-ai-message.user")).toHaveCount(2);
    await expect(dialog.locator(".selection-ai-message.assistant")).toHaveCount(2);
    await expect(dialog.locator(".selection-ai-message.assistant").last()).toContainText(
      "这是选区问答的浏览器预览回复。",
    );
    await expect(snapshotTrigger).toContainText(selectedText);
    await dialog.getByRole("button", { name: "关闭当前选区问答会话" }).click();
    const closeSessionPrompt = page.getByRole("dialog", { name: "关闭当前会话？" });
    await expect(closeSessionPrompt).toContainText("只会关闭当前会话");
    await closeSessionPrompt.getByRole("button", { name: "取消" }).click();
    await expect(dialog.locator(".selection-ai-message.user")).toHaveCount(2);

    await dialog.getByRole("button", { name: "基于当前选区开始新会话" }).click();
    await expect(sessionTabs).toHaveCount(2);
    await expect(sessionTabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(dialog.locator(".selection-ai-message")).toHaveCount(0);
    await dialog.getByRole("button", { name: "关闭当前选区问答会话" }).click();
    await expect(sessionTabs).toHaveCount(1);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".selection-ai-message.user")).toHaveCount(2);

    await dialog.getByRole("button", { name: "基于当前选区开始新会话" }).click();
    await question.fill("停止这一轮");
    await question.press("Enter");
    await dialog.getByRole("button", { name: "停止生成" }).click();
    await expect(dialog.locator(".selection-ai-message.assistant.stopped")).toContainText("已停止");
    await page.waitForTimeout(650);
    await expect(dialog).not.toContainText("这是选区问答的浏览器预览回复。");

    await question.fill("最小化后继续在后台回答");
    await question.press("Enter");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const sprite = page.getByRole("button", { name: /选区问答，2 个会话/ });
    await expect(sprite).toBeVisible();
    await expect(sprite).toHaveAccessibleName(/1 个正在生成/);
    await expect(editor).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() || "")).toBe(selectedText);
    await expect(sprite).toHaveAccessibleName(/1 个新回复/);
    if (process.env.PAPERWRITER_SPRITE_SCREENSHOT) {
      await page.screenshot({
        path: process.env.PAPERWRITER_SPRITE_SCREENSHOT,
        fullPage: false,
      });
    }

    await sprite.click();
    await expect(dialog).toBeVisible();
    await expect(sessionTabs).toHaveCount(2);
    await expect(sprite).toHaveCount(0);
    await page.waitForTimeout(220);
    const restoredBounds = await dialog.boundingBox();
    expect(restoredBounds.x).toBeCloseTo(keyboardMovedBounds.x, 0);
    expect(restoredBounds.y).toBeCloseTo(keyboardMovedBounds.y, 0);
    await expect(dialog.locator(".selection-ai-message.assistant").last()).toContainText(
      "这是选区问答的浏览器预览回复。",
    );

    await dialog.getByRole("button", { name: "最小化选区问答" }).click();
    const secondSelectedText = "第二个独立选区会话。";
    await selectEditorText(page, secondSelectedText);
    await page.getByRole("button", { name: "询问 AI", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(sessionTabs).toHaveCount(3);
    await expect(sessionTabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(dialog.locator(".selection-ai-snapshot-trigger")).toContainText(secondSelectedText);
    await sessionTabs.nth(2).focus();
    await sessionTabs.nth(2).press("Home");
    await expect(sessionTabs.first()).toHaveAttribute("aria-selected", "true");
    await sessionTabs.first().press("End");
    await expect(sessionTabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await sessionTabs.first().click();
    await expect(dialog.locator(".selection-ai-snapshot-trigger")).toContainText(selectedText);
    await expect(dialog.locator(".selection-ai-message.user")).toHaveCount(2);

    expect(pageErrors).toEqual([]);
  });

  test("task-model disclosures default closed, expand independently, and deep-link selection chat", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const taskModelConfig = createTestAiConfig();
    taskModelConfig.providers.deepseek = {
      provider: "deepseek",
      providerLabel: "DeepSeek",
      protocol: "openai",
      builtin: true,
      baseUrl: "https://example.invalid/v1",
      apiKey: "offline-deepseek-key",
      activeModelId: "deepseek-e2e",
      models: [{
        id: "deepseek-e2e",
        name: "DeepSeek 离线测试模型",
        model: "deepseek-offline-e2e",
        testedOk: true,
        testedAt: "2026-07-25T08:00:00.000Z",
        testMessage: "离线 fixture",
      }],
    };
    taskModelConfig.taskModels.applyResolver = {
      providerId: "gemini",
      modelId: "gemini-e2e",
      requestParams: {
        custom_task_hint: { value: "keep-until-confirmed" },
      },
    };
    const pageErrors = await openReleasePreview(page, {
      aiConfig: taskModelConfig,
    });

    await page.getByRole("button", { name: "打开设置" }).click();
    const settingsCenter = page.getByRole("dialog", { name: "设置" });
    await settingsCenter.getByRole("button", { name: /AI 配置/ }).click();
    let aiSettings = page.locator(".ai-settings-dialog");
    await aiSettings.getByRole("button", { name: /任务模型/ }).click();

    const taskList = aiSettings.getByRole("region", { name: "任务模型列表" });
    const taskHeaders = taskList.locator(".ai-task-model-summary");
    await expect(taskHeaders).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(taskHeaders.nth(index)).toHaveAttribute("aria-expanded", "false");
    }
    await expect(taskHeaders.locator(".ai-task-model-badge.default")).toHaveCount(0);
    if (process.env.PAPERWRITER_TASK_MODEL_SCREENSHOT) {
      await page.screenshot({
        path: process.env.PAPERWRITER_TASK_MODEL_SCREENSHOT,
        fullPage: false,
      });
    }

    await taskHeaders.nth(0).click();
    await taskHeaders.nth(1).click();
    await expect(taskHeaders.nth(0)).toHaveAttribute("aria-expanded", "true");
    await expect(taskHeaders.nth(1)).toHaveAttribute("aria-expanded", "true");
    const selectionProvider = aiSettings.getByRole("button", { name: "选区问答供应商" });
    await selectionProvider.click();
    await page.getByRole("listbox", { name: "选区问答供应商" })
      .getByRole("option", { name: "DeepSeek" })
      .click();
    await expect(selectionProvider).toContainText("DeepSeek");
    await expect(aiSettings.getByRole("button", { name: "选区问答模型" }))
      .toContainText("DeepSeek 离线测试模型");
    await expect.poll(() => page.evaluate(() => {
      const stored = JSON.parse(window.localStorage.getItem("paperwriter.aiConfig") || "{}");
      return stored.taskModels?.selectionChat;
    })).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-e2e",
      requestParams: {},
    });
    const applyProvider = aiSettings.getByRole("button", { name: "直接应用定位供应商" });
    await applyProvider.click();
    await page.getByRole("listbox", { name: "直接应用定位供应商" })
      .getByRole("option", { name: "DeepSeek" })
      .click();
    const providerSwitchConfirm = aiSettings.getByRole("alertdialog", { name: "切换任务供应商" });
    await expect(providerSwitchConfirm).toContainText("当前任务参数将被清空");
    await expect(applyProvider).toContainText("Gemini");
    await providerSwitchConfirm.getByRole("button", { name: "清空并切换" }).click();
    await expect(applyProvider).toContainText("DeepSeek");
    await expect.poll(() => page.evaluate(() => {
      const stored = JSON.parse(window.localStorage.getItem("paperwriter.aiConfig") || "{}");
      return stored.taskModels?.applyResolver;
    })).toEqual({
      providerId: "deepseek",
      modelId: "deepseek-e2e",
      requestParams: {},
    });
    await taskHeaders.nth(0).click();
    await expect(taskHeaders.nth(0)).toHaveAttribute("aria-expanded", "false");
    await expect(taskHeaders.nth(1)).toHaveAttribute("aria-expanded", "true");

    await aiSettings.getByRole("button", { name: "关闭 AI 设置" }).click();
    await page.getByRole("button", { name: "打开设置" }).click();
    await page.getByRole("dialog", { name: "设置" })
      .getByRole("button", { name: /AI 配置/ })
      .click();
    aiSettings = page.locator(".ai-settings-dialog");
    await aiSettings.getByRole("button", { name: /任务模型/ }).click();
    const reopenedTaskHeaders = aiSettings.locator(".ai-task-model-summary");
    await expect(reopenedTaskHeaders).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(reopenedTaskHeaders.nth(index)).toHaveAttribute("aria-expanded", "false");
    }
    await aiSettings.getByRole("button", { name: "关闭 AI 设置" }).click();

    const invalidConfig = createTestAiConfig();
    invalidConfig.taskModels.selectionChat = {
      providerId: "gemini",
      modelId: "missing-selection-model",
      requestParams: {},
    };
    await installBrowserPreviewState(page, { aiConfig: invalidConfig });
    await page.reload();
    await page.locator(".paper-workspace").waitFor({ state: "visible" });
    await page.locator(".paper-sheet").first().waitFor({ state: "visible" });
    await selectEditorText(page, "深链打开选区问答任务模型。");
    await page.getByRole("button", { name: "询问 AI", exact: true }).click();
    const selectionDialog = page.getByRole("dialog", { name: "选区 AI 问答" });
    const question = selectionDialog.getByRole("textbox", { name: "选区问答问题" });
    await question.fill("触发失效模型提示");
    await question.press("Enter");
    await selectionDialog.getByRole("button", { name: "去配置" }).click();

    aiSettings = page.locator(".ai-settings-dialog");
    const selectionTaskHeader = aiSettings.locator("#ai-task-model-header-selectionChat");
    await expect(selectionTaskHeader).toHaveAttribute("aria-expanded", "true");
    await expect(selectionTaskHeader).toBeFocused();
    await expect(aiSettings.locator("#ai-task-model-header-applyResolver")).toHaveAttribute("aria-expanded", "false");

    expect(pageErrors).toEqual([]);
  });

  test("split editor groups keep document-owned sprites while only one assistant is expanded", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const pageErrors = await openReleasePreview(page, {
      aiConfig: createTestAiConfig(),
    });
    const primaryGroup = page.locator('[data-group-id="primary"]');

    await page.locator(".canvas.active-pane .paper-title-input").fill("左侧会话信笺");
    await page.locator(".canvas.active-pane .ProseMirror").fill("左侧选区快照");
    await primaryGroup.getByRole("button", { name: "在当前组新建信笺" }).click();
    await page.locator(".canvas.active-pane .paper-title-input").fill("右侧会话信笺");
    await page.locator(".canvas.active-pane .ProseMirror").fill("右侧选区快照");
    await primaryGroup.locator(".group-tab.active").click({ button: "right" });
    await page.getByRole("menuitem", { name: "移到右侧" }).click();

    const secondaryGroup = page.locator('[data-group-id="secondary"]');
    await secondaryGroup.getByRole("tab").click();
    await selectEditorText(page, "右侧选区快照");
    await page.getByRole("button", { name: "询问 AI", exact: true }).click();
    let assistant = page.getByRole("dialog", { name: "选区 AI 问答" });
    await expect(assistant.locator(".selection-ai-snapshot-trigger")).toContainText("右侧选区快照");
    await assistant.getByRole("button", { name: "最小化选区问答" }).click();

    await primaryGroup.getByRole("tab").click();
    await selectEditorText(page, "左侧选区快照");
    await page.getByRole("button", { name: "询问 AI", exact: true }).click();
    assistant = page.getByRole("dialog", { name: "选区 AI 问答" });
    await expect(assistant.locator(".selection-ai-snapshot-trigger")).toContainText("左侧选区快照");
    await assistant.getByRole("button", { name: "最小化选区问答" }).click();

    const sprites = page.getByRole("button", { name: /选区问答，1 个会话/ });
    await expect(sprites).toHaveCount(2);
    const firstSpriteBounds = await sprites.nth(0).boundingBox();
    const secondSpriteBounds = await sprites.nth(1).boundingBox();
    const rightSpriteIndex = firstSpriteBounds.x > secondSpriteBounds.x ? 0 : 1;
    await sprites.nth(rightSpriteIndex).click();
    await expect(page.getByRole("dialog", { name: "选区 AI 问答" })).toHaveCount(1);
    await expect(
      page.getByRole("dialog", { name: "选区 AI 问答" })
        .locator(".selection-ai-snapshot-trigger"),
    ).toContainText("右侧选区快照");
    await expect(sprites).toHaveCount(1);

    await sprites.first().click();
    await expect(page.getByRole("dialog", { name: "选区 AI 问答" })).toHaveCount(1);
    await expect(
      page.getByRole("dialog", { name: "选区 AI 问答" })
        .locator(".selection-ai-snapshot-trigger"),
    ).toContainText("左侧选区快照");
    await expect(sprites).toHaveCount(1);

    expect(pageErrors).toEqual([]);
  });
});
