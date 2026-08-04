import { expect, test } from "@playwright/test";
import {
  createTestAiConfig,
  installBrowserPreviewState,
} from "./support/paperwriter-fixtures.js";

async function openResearchPreview(page, kind) {
  await installBrowserPreviewState(page, { aiConfig: createTestAiConfig() });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`/?researchPreview=1&researchKind=${kind}`);
  await page.locator(".paper-workspace").waitFor({ state: "visible" });
  await page.getByRole("tab", { name: "资料", exact: true }).click();
  return pageErrors;
}

test.describe("research translation", () => {
  test("DOCX translates from the context menu and restores the original structure", async ({ page }) => {
    const pageErrors = await openResearchPreview(page, "docx");
    await page.getByRole("treeitem", { name: "阅读示例.docx", exact: true }).click();

    const reader = page.getByRole("complementary", { name: "资料阅读区" });
    const article = reader.getByRole("article", { name: "DOCX 资料内容" });
    await expect(article).toContainText("DOCX 资料示例");
    await article.click({ button: "right" });
    await page.getByRole("menuitem", { name: "翻译当前内容", exact: true }).click();

    await expect(article).toContainText("【简体中文预览】DOCX 资料示例");
    await expect(reader.getByRole("button", { name: "取消翻译后可搜索资料", exact: true })).toBeDisabled();
    await expect(article.locator("h1")).toHaveCount(1);
    await expect(article.locator("ul > li")).toHaveCount(2);
    await expect(article.locator("table")).toHaveCount(1);

    await article.click({ button: "right" });
    await page.getByRole("menuitem", { name: "取消翻译", exact: true }).click();
    await expect(article).toContainText("DOCX 资料示例");
    await expect(article).not.toContainText("【简体中文预览】");
    await expect(reader.getByRole("button", { name: "展开资料搜索", exact: true })).toBeEnabled();
    expect(pageErrors).toEqual([]);
  });

  test("table translation preserves the grid and numeric cells", async ({ page }) => {
    const pageErrors = await openResearchPreview(page, "table");
    await page.getByRole("treeitem", { name: "新建 Microsoft Excel 工作表.csv", exact: true }).click();

    const reader = page.getByRole("complementary", { name: "资料阅读区" });
    const grid = reader.getByLabel("可上下左右滚动的表格资料", { exact: true });
    await expect(grid.locator("tbody tr")).toHaveCount(29);
    await expect(grid.locator("tbody tr").nth(1).locator("td").nth(7)).toHaveText("1200");
    await grid.click({ button: "right" });
    await page.getByRole("menuitem", { name: "翻译当前内容", exact: true }).click();

    await expect(grid).toContainText("【简体中文预览】Project");
    await expect(grid.locator("tbody tr")).toHaveCount(29);
    await expect(grid.locator("tbody tr").nth(1).locator("td").nth(7)).toHaveText("1200");
    await expect(reader.getByRole("button", { name: "取消翻译后可搜索资料", exact: true })).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });

  test("PDF supports Shift+F10, repositions translations on zoom, and resets on page change", async ({ page }) => {
    const pageErrors = await openResearchPreview(page, "pdf");
    await page.getByRole("treeitem", { name: "阅读示例.pdf", exact: true }).click();

    const reader = page.getByRole("complementary", { name: "资料阅读区" });
    const viewport = reader.getByLabel("PDF 第 1 页。可用方向键、PageUp、PageDown、空格、Home 和 End 翻页。", { exact: true });
    await viewport.focus();
    await viewport.press("Shift+F10");
    await expect(page.getByRole("menuitem", { name: "翻译当页", exact: true })).toBeFocused();
    await page.getByRole("menuitem", { name: "翻译当页", exact: true }).click();

    const translation = reader.getByRole("document", { name: "PDF 第 1 页简体中文译文", exact: true });
    await expect(translation).toBeVisible();
    await expect(reader.getByRole("button", { name: "取消翻译后可搜索 PDF", exact: true })).toBeDisabled();
    const before = await translation.evaluate((element) => ({
      width: element.getBoundingClientRect().width,
      left: element.firstElementChild?.style.left,
      top: element.firstElementChild?.style.top,
    }));

    await reader.getByRole("button", { name: "放大 PDF", exact: true }).click();
    await expect.poll(async () => translation.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(before.width);
    const after = await translation.evaluate((element) => ({
      left: element.firstElementChild?.style.left,
      top: element.firstElementChild?.style.top,
    }));
    expect(after).not.toEqual({ left: before.left, top: before.top });

    await reader.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(reader.getByRole("document", { name: "PDF 第 1 页简体中文译文", exact: true })).toHaveCount(0);
    await expect(reader.getByRole("button", { name: "展开 PDF 搜索", exact: true })).toBeEnabled();

    await reader.getByRole("button", { name: "上一页", exact: true }).click();
    const restoredViewport = reader.getByLabel("PDF 第 1 页。可用方向键、PageUp、PageDown、空格、Home 和 End 翻页。", { exact: true });
    await restoredViewport.click({ button: "right" });
    await page.getByRole("menuitem", { name: "翻译当页", exact: true }).click();
    await expect(reader.getByText("已从本次运行的缓存恢复译文", { exact: true })).toBeVisible();
    await expect(reader.getByRole("document", { name: "PDF 第 1 页简体中文译文", exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
