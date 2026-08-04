import { expect, test } from "@playwright/test";
import {
  createTestAiConfig,
  installBrowserPreviewState,
} from "./support/paperwriter-fixtures.js";

test("帮助下拉中的 AI精灵完成流式问答、恢复历史并跳转来源", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installBrowserPreviewState(page, { aiConfig: createTestAiConfig() });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.locator(".paper-workspace").waitFor({ state: "visible" });

  const helpButton = page.getByRole("button", { name: "帮助", exact: true });
  await helpButton.click();
  const helpMenu = page.getByRole("menu");
  await expect(helpMenu.getByRole("menuitem")).toHaveCount(2);
  await helpMenu.getByRole("menuitem", { name: /AI精灵/ }).click();

  let assistant = page.locator(".help-assistant-dialog");
  await expect(assistant).toBeVisible();
  await assistant.getByRole("button", { name: "未保存就退出，信笺还能恢复吗？" }).click();
  await expect(assistant).toContainText("这是 AI精灵的浏览器预览回答。");
  await expect(assistant.getByRole("button", { name: "帮助文档 · 保存、自动保存与恢复" })).toBeVisible();
  await expect(assistant.getByRole("option", { name: /未保存就退出，信笺还能恢复吗/ })).toBeVisible();

  await assistant.getByRole("button", { name: "关闭 AI精灵" }).click();
  await expect(assistant).toBeHidden();
  await helpButton.click();
  await page.getByRole("menuitem", { name: /AI精灵/ }).click();
  assistant = page.locator(".help-assistant-dialog");
  await expect(assistant).toContainText("这是 AI精灵的浏览器预览回答。");

  const question = assistant.getByRole("textbox", { name: "向 AI精灵提问" });
  await question.fill("关闭窗口后，回答还会继续生成吗？");
  await question.press("Enter");
  await expect(assistant.getByRole("button", { name: "停止" })).toBeVisible();
  await assistant.getByRole("button", { name: "关闭 AI精灵" }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("paperwriter.helpAssistant.v1") || "{}");
    return state.sessions?.[0]?.messages?.at(-1)?.status;
  })).toBe("done");
  await helpButton.click();
  await page.getByRole("menuitem", { name: /AI精灵/ }).click();
  assistant = page.locator(".help-assistant-dialog");
  await expect(assistant).toContainText("关闭窗口后，回答还会继续生成吗？");

  await assistant.getByRole("textbox", { name: "向 AI精灵提问" }).fill("这个软件是干嘛的？");
  await assistant.getByRole("textbox", { name: "向 AI精灵提问" }).press("Enter");
  await expect(assistant).toContainText("笺间是一款面向 Windows 的本地优先写作软件");
  await expect(assistant.getByRole("button", { name: "补充知识 · 笺间是什么与主要用途" })).toBeVisible();

  await assistant.getByRole("button", { name: "帮助文档 · 保存、自动保存与恢复" }).click();
  await expect(assistant).toBeHidden();
  const help = page.getByRole("dialog", { name: "帮助中心" });
  await expect(help.getByRole("heading", { name: "保存、恢复、同步冲突与格式兼容" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(window.localStorage.getItem("paperwriter.helpAssistant.v1") || "{}");
    return state.sessions?.[0]?.messages?.at(-1)?.status;
  })).toBe("done");
  expect(pageErrors).toEqual([]);
});
