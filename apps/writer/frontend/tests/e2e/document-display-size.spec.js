import { expect, test } from "@playwright/test";
import {
  createTestAiConfig,
  createTestDocument,
  installBrowserPreviewState,
  installDesktopBridgeFixture,
  openPaperWriter,
} from "./support/paperwriter-fixtures.js";

async function openCanvasDisplaySize(page) {
  await page.locator(".canvas.active-pane .ProseMirror").click({ button: "right" });
  await page.getByRole("menuitem", { name: /显示大小，当前/ }).click();
}

async function selectCanvasDisplaySize(page, name) {
  await openCanvasDisplaySize(page);
  await page.getByRole("menuitemradio", { name }).click();
}

async function selectCanvasPageView(page, name) {
  await page.locator(".canvas.active-pane .ProseMirror").click({ button: "right" });
  await page.getByRole("menuitem", { name: /页面视图，当前/ }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}

test("canvas display presets scale without reflow and survive page and AI mode changes", async ({ page }) => {
  await installBrowserPreviewState(page, { aiConfig: createTestAiConfig() });
  const pageErrors = await openPaperWriter(page);
  const canvas = page.locator(".canvas.active-pane");
  const sheet = canvas.locator(".paper-sheet");
  const editor = canvas.locator(".ProseMirror");
  await editor.fill("正文显示大小回归。".repeat(80));

  const mediumGeometry = await sheet.evaluate((element) => ({
    visualWidth: element.getBoundingClientRect().width,
    layoutWidth: element.offsetWidth,
  }));
  await selectCanvasDisplaySize(page, /^大 125%$/);
  await expect(canvas).toHaveAttribute("data-page-display-scale", "1.25");
  await expect(canvas).toHaveClass(/has-continuous-page-scale/);
  const largeGeometry = await sheet.evaluate((element) => ({
    visualWidth: element.getBoundingClientRect().width,
    layoutWidth: element.offsetWidth,
  }));
  expect(largeGeometry.visualWidth / mediumGeometry.visualWidth).toBeCloseTo(1.25, 1);
  expect(largeGeometry.layoutWidth).toBe(mediumGeometry.layoutWidth);
  await expect.poll(() => canvas.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

  await selectCanvasPageView(page, "单页");
  await expect(canvas).toHaveClass(/page-view-single/);
  await expect(canvas.locator(".page-view-fit")).toHaveText("125%");
  await selectCanvasPageView(page, "连续");
  await expect(canvas).toHaveAttribute("data-page-display-scale", "1.25");

  await page.locator(".ai-feature-trigger").click();
  await page.getByRole("dialog", { name: "选择 AI 模式" }).getByRole("button", { name: /AI优化/ }).click();
  const aiSourceCanvas = page.locator(".canvas.ai-source-canvas");
  await expect(aiSourceCanvas).toHaveAttribute("data-page-display-scale", "1");
  await expect(aiSourceCanvas).not.toHaveClass(/has-continuous-page-scale/);
  await page.locator(".ai-feature-trigger").click();
  await page.getByRole("dialog", { name: "选择 AI 模式" }).getByRole("button", { name: "退出 AI 模式" }).click();
  await expect(canvas).toHaveAttribute("data-page-display-scale", "1.25");

  await selectCanvasDisplaySize(page, /^中 100%$/);
  await expect(canvas).toHaveAttribute("data-page-display-scale", "1");
  await expect(canvas).not.toHaveClass(/has-continuous-page-scale/);
  expect(pageErrors).toEqual([]);
});

test("tab context menu changes only its target document display size", async ({ page }) => {
  const firstPath = "C:\\e2e\\显示大小甲.letterpaper";
  const secondPath = "C:\\e2e\\显示大小乙.letterpaper";
  await installDesktopBridgeFixture(page, {
    documents: {
      [firstPath]: createTestDocument({ title: "显示大小甲", html: "<p>甲文档</p>" }),
      [secondPath]: createTestDocument({
        documentId: "10000000-0000-4000-8000-000000000002",
        title: "显示大小乙",
        html: "<p>乙文档</p>",
      }),
    },
    activePath: firstPath,
  });
  const pageErrors = await openPaperWriter(page);
  const firstTab = page.getByRole("tab", { name: /显示大小甲/ });
  const secondTab = page.getByRole("tab", { name: /显示大小乙/ });
  await expect(firstTab).toHaveAttribute("aria-selected", "true");

  await secondTab.click({ button: "right" });
  await page.getByRole("menuitem", { name: /显示大小，当前中/ }).click();
  await page.getByRole("menuitemradio", { name: /^极大 150%$/ }).click();
  await expect(firstTab).toHaveAttribute("aria-selected", "true");

  await secondTab.click();
  await expect(page.locator(".canvas.active-pane")).toHaveAttribute("data-page-display-scale", "1.5");
  await firstTab.click();
  await expect(page.locator(".canvas.active-pane")).toHaveAttribute("data-page-display-scale", "1");
  expect(pageErrors).toEqual([]);
});
