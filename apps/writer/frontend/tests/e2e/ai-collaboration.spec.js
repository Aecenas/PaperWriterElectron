import { expect, test } from "@playwright/test";
import {
  createTestAiConfig,
  installBrowserPreviewState,
  openPaperWriter,
} from "./support/paperwriter-fixtures.js";

test.describe("AI collaboration review", () => {
  test.beforeEach(async ({ page }) => {
    await installBrowserPreviewState(page, { aiConfig: createTestAiConfig() });
  });

  test("keeps changes frozen until review and commits selected title and Emoji edits", async ({ page }) => {
    const pageErrors = await openPaperWriter(page);
    const editor = page.locator(".canvas:not(.ai-chat-canvas) .ProseMirror").first();
    await editor.fill("协作流程回归正文");

    await page.locator(".ai-feature-trigger").click();
    const chooser = page.getByRole("dialog", { name: "选择 AI 模式" });
    await chooser.getByRole("button", { name: /AI协作/ }).click();

    const composer = page.locator(".ai-chat-composer textarea");
    await composer.fill("请添加标题和 Emoji");
    await page.locator(".ai-chat-send-button").click();

    const running = page.locator(".ai-collaboration-running-message");
    await expect(running).toBeVisible();
    await expect(running).toContainText(/正在等待 AI|AI 已开始返回|正在本地检查/);
    await expect(running).toContainText("已用时");

    const review = page.getByRole("region", { name: "待审阅修改" });
    await expect(review).toBeVisible();
    await expect(page.locator(".ai-chat-message.assistant")).toContainText("AI 实际读取");
    await expect(editor).toHaveAttribute("contenteditable", "false");
    await expect(review).toContainText("已经审阅");
    await expect(review.getByRole("button", { name: /未审阅的全部接受（2）/ })).toBeVisible();

    const inlineReviews = editor.locator(".ai-collaboration-inline-preview");
    await expect(inlineReviews).toHaveCount(2);
    const titleReview = inlineReviews.filter({ hasText: "拟修改标题" });
    await titleReview.getByRole("button", { name: "编辑" }).click();
    await titleReview.getByLabel("拟应用标题").fill("协作后的标题 ✨");
    await titleReview.getByRole("button", { name: "保存修改" }).click();
    await titleReview.getByRole("button", { name: "接受", exact: true }).click();
    await inlineReviews.filter({ hasText: "添加表情提示" }).getByRole("button", { name: "接受", exact: true }).click();
    await expect(review).toContainText("全部修改已审阅");
    await review.getByRole("button", { name: "提交审阅结果" }).click();

    await expect(review).toHaveCount(0);
    await expect(page.locator(".paper-title-input")).toHaveValue("协作后的标题 ✨");
    await expect(editor).toContainText("✨ 这里是 AI 协作生成的浏览器预览内容。");
    await expect(editor).toHaveAttribute("contenteditable", "true");
    expect(pageErrors).toEqual([]);
  });

  test("rejecting a table proposal leaves the document unchanged", async ({ page }) => {
    const pageErrors = await openPaperWriter(page);
    const editor = page.locator(".canvas:not(.ai-chat-canvas) .ProseMirror").first();
    await editor.fill("不会被修改的正文");

    await page.locator(".ai-feature-trigger").click();
    await page.getByRole("dialog", { name: "选择 AI 模式" }).getByRole("button", { name: /AI协作/ }).click();
    await page.locator(".ai-chat-composer textarea").fill("请添加一个表格");
    await page.locator(".ai-chat-send-button").click();

    const review = page.getByRole("region", { name: "待审阅修改" });
    const inlineReview = editor.locator(".ai-collaboration-inline-preview");
    await expect(inlineReview).toContainText("添加表格");
    await inlineReview.getByRole("button", { name: "拒绝", exact: true }).click();
    await expect(review).toContainText("全部修改已审阅");
    await review.getByRole("button", { name: "提交审阅结果" }).click();

    await expect(review).toHaveCount(0);
    await expect(editor).toHaveText("不会被修改的正文");
    expect(pageErrors).toEqual([]);
  });
});
