import { expect, test } from "@playwright/test";
import {
  installBrowserPreviewState,
  openPaperWriter,
} from "./support/paperwriter-fixtures.js";

async function openElementsMenu(page) {
  await page.getByRole("button", { name: "元素", exact: true }).click();
}

async function selectPageView(page, name) {
  await page.getByRole("menuitem", { name: /页面视图，当前/ }).click();
  const option = page.getByRole("menuitemradio", { name, exact: true });
  await expect(option).toBeVisible();
  await option.click();
}

test("professional elements remain editable while switching continuous, single, and spread views", async ({ page }) => {
  await installBrowserPreviewState(page);
  const pageErrors = await openPaperWriter(page);
  const editor = page.locator(".canvas.active-pane .ProseMirror");

  await editor.fill("正文");
  await editor.click();
  await page.keyboard.press("End");

  await openElementsMenu(page);
  await page.getByRole("menuitem", { name: "表情", exact: true }).click();
  const emojiDialog = page.getByRole("dialog", { name: "插入表情" });
  await emojiDialog.getByRole("searchbox", { name: "搜索表情" }).fill("火箭");
  const emojiCell = emojiDialog.getByRole("gridcell").first();
  await expect(emojiCell).toBeVisible();
  const emoji = (await emojiCell.textContent())?.trim() || "";
  expect(emoji.length).toBeGreaterThan(0);
  await emojiCell.click();
  await expect(emojiDialog).toBeHidden();
  await expect(editor).toContainText(`正文${emoji}`);

  await openElementsMenu(page);
  await page.getByRole("menuitem", { name: "公式", exact: true }).click();
  const mathDialog = page.getByRole("dialog", { name: "插入公式" });
  await mathDialog.getByRole("radio", { name: "块公式", exact: true }).click();
  await mathDialog.getByLabel("TeX 源码").fill(String.raw`E=mc^2`);
  await mathDialog.getByLabel("标签").fill("质能方程");
  await expect(mathDialog.getByLabel("公式实时预览").locator(".katex")).toBeVisible();
  await mathDialog.getByRole("button", { name: "插入公式", exact: true }).click();
  await expect(page.locator(".canvas.active-pane [data-type='block-math']")).toHaveCount(1);

  await openElementsMenu(page);
  await page.getByRole("menuitem", { name: "Mermaid 图", exact: true }).click();
  const mermaidDialog = page.getByRole("dialog", { name: "插入 Mermaid 图" });
  await mermaidDialog.getByLabel("Mermaid 源码").fill("flowchart LR\nA[开始] --> B[完成]");
  await expect(mermaidDialog.locator(".mermaid-dialog-svg svg")).toBeVisible({ timeout: 15_000 });
  await mermaidDialog.getByRole("button", { name: "插入 Mermaid 图", exact: true }).click();
  const mermaidNode = page.locator(".canvas.active-pane [data-type='paper-mermaid']");
  await expect(mermaidNode).toHaveAttribute("data-mermaid-render-state", "ready", { timeout: 15_000 });
  await expect.poll(() => mermaidNode.evaluate((node) => {
    const host = node.querySelector(".paper-mermaid-svg");
    if (!host?.shadowRoot?.querySelector("svg")) return false;
    const range = document.createRange();
    range.selectNode(host);
    return Boolean(range.cloneContents().querySelector(".paper-mermaid-svg")?.shadowRoot?.querySelector("svg"));
  })).toBe(true);

  await page.evaluate(() => {
    window.__paperWriterEditorIdentity = document.querySelector(".canvas.active-pane .ProseMirror");
  });
  await editor.click({ button: "right" });
  await selectPageView(page, "单页");
  await expect(page.locator(".canvas.active-pane.page-view-single")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window.__paperWriterEditorIdentity === document.querySelector(".canvas.active-pane .ProseMirror")
  ))).toBe(true);

  await editor.click({ button: "right" });
  await selectPageView(page, "双页");
  await expect(page.locator(".canvas.active-pane.page-view-spread")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window.__paperWriterEditorIdentity === document.querySelector(".canvas.active-pane .ProseMirror")
  ))).toBe(true);

  await editor.click({ button: "right" });
  await selectPageView(page, "连续");
  await expect(page.locator(".canvas.active-pane.has-paginated-editor")).toHaveCount(0);
  await expect(editor).toContainText("正文");
  expect(pageErrors).toEqual([]);
});

test("脚注与文献按职责分栏，并可进入私域公域管理完整流程", async ({ page }) => {
  await installBrowserPreviewState(page);
  const pageErrors = await openPaperWriter(page);

  await page.getByRole("tab", { name: "结构", exact: true }).click();

  await page.getByRole("tab", { name: "脚注", exact: true }).click();
  const footnotePanel = page.getByRole("tabpanel", { name: "脚注" });
  await expect(footnotePanel).toContainText("正文还没有脚注");
  await expect(footnotePanel).not.toContainText("引用文献");
  await expect(footnotePanel).not.toContainText("文献库");

  await page.getByRole("tab", { name: "文献", exact: true }).click();
  const bibliographyPanel = page.getByRole("tabpanel", { name: "文献" });
  await expect(bibliographyPanel.getByText("引用文献", { exact: true })).toBeVisible();
  await expect(bibliographyPanel.getByText("文献库", { exact: true })).toBeVisible();

  await bibliographyPanel.getByRole("button", { name: "管理文献库", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "文献库管理" });
  await expect(manager).toBeVisible();
  await expect(manager.getByRole("tab", { name: /私域/ })).toHaveAttribute("aria-selected", "true");
  await expect(manager.getByRole("button", { name: "新增文献", exact: true })).toBeVisible();
  await expect(manager.getByRole("button", { name: "导入 BibTeX", exact: true })).toBeVisible();

  await manager.getByRole("tab", { name: /公域/ }).click();
  await expect(manager.getByRole("tab", { name: /公域/ })).toHaveAttribute("aria-selected", "true");
  await manager.getByRole("button", { name: /更多工具与引用设置/ }).click();
  await expect(manager.getByText("其他格式", { exact: true })).toBeVisible();
  const formatSelect = manager.getByRole("button", { name: "其他文献格式" });
  await expect(formatSelect).toContainText("RIS");
  await formatSelect.click();
  const formatOptions = manager.getByRole("listbox", { name: "其他文献格式" });
  await expect(formatOptions.getByRole("option")).toHaveText(["RIS", "CSL-JSON"]);
  await formatOptions.getByRole("option", { name: "RIS", exact: true }).click();
  await expect(manager.getByText("当前信笺引用样式", { exact: true })).toBeVisible();
  await expect(manager.getByText("联网补全书目信息", { exact: true })).toBeVisible();

  await manager.getByRole("button", { name: "完成", exact: true }).click();
  await expect(manager).toBeHidden();
  expect(pageErrors).toEqual([]);
});
