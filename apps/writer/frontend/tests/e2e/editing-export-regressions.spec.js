import { expect, test } from "@playwright/test";
import {
  createTestAiConfig,
  createTestDocument,
  installBrowserPreviewState,
  installDesktopBridgeFixture,
  openPaperWriter,
} from "./support/paperwriter-fixtures.js";

const APP_ORIGIN = "http://127.0.0.1:4174";

async function grantClipboard(context) {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: APP_ORIGIN,
  });
}

async function readClipboard(page) {
  return page.evaluate(async () => ({
    text: await navigator.clipboard.readText(),
    types: (await navigator.clipboard.read())[0]?.types || [],
  }));
}

async function selectCanvasPageView(page, name) {
  const editor = page.locator(".canvas.active-pane .ProseMirror");
  const contextTarget = editor.locator(
    ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > p",
  ).first();
  await contextTarget.scrollIntoViewIfNeeded();
  const targetBox = await contextTarget.boundingBox();
  const usesDesktopBridge = await page.evaluate(() => Boolean(window.paperWriter?.isElectron));
  if (usesDesktopBridge) {
    await page.evaluate(({ x, y }) => {
      window.__paperWriterE2E.emit("document:context:menu:request", { x, y });
    }, {
      x: targetBox.x + Math.min(12, targetBox.width / 2),
      y: targetBox.y + Math.min(12, targetBox.height / 2),
    });
  } else {
    await contextTarget.click({ button: "right" });
  }
  await page.getByRole("menuitem", { name: /页面视图，当前/ }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}

test("cross-block AI optimization copy excludes action labels", async ({ page, context }) => {
  await grantClipboard(context);
  await installBrowserPreviewState(page, { aiConfig: createTestAiConfig() });
  const pageErrors = await openPaperWriter(page);
  await page.locator(".canvas.active-pane .ProseMirror").fill("需要优化的正文。");

  await page.locator(".ai-feature-trigger").click();
  await page.getByRole("dialog", { name: "选择 AI 模式" })
    .getByRole("button", { name: /AI优化/ })
    .click();
  await page.getByRole("button", { name: "开始优化" }).click();
  await expect(page.locator(".ai-result-block")).toHaveCount(2);

  const resultBody = page.locator(".ai-result-body");
  await resultBody.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press("Control+c");
  const copied = await readClipboard(page);
  expect(copied.text).toContain("这是一段浏览器预览 AI 回复。");
  expect(copied.text).toContain("桌面端会使用当前已测试的默认供应商和模型流式生成真实内容。");
  expect(copied.text).not.toMatch(/应用|定位中|正文中确认|选择位置应用/);

  const applyButton = page.locator(".ai-block-actions button.apply").first();
  await applyButton.focus();
  await expect(applyButton).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test("selection AI native copy pastes plain text that inherits the editor font", async ({ page, context }) => {
  await grantClipboard(context);
  const documentPath = "C:\\e2e\\selection-copy.letterpaper";
  const aiConfig = createTestAiConfig();
  aiConfig.providers.gemini.hasApiKey = true;
  await installDesktopBridgeFixture(page, {
    documents: {
      [documentPath]: createTestDocument({ body: "选中这段正文后提问。" }),
    },
    activePath: documentPath,
    aiConfig,
    selectionAiResponse: "建议改为 **确认后触发**，并删除多余说明。",
  });
  const pageErrors = await openPaperWriter(page);
  const editor = page.locator(".canvas.active-pane .ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "询问 AI", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "选区 AI 问答" });
  await dialog.getByRole("textbox", { name: "选区问答问题" }).fill("怎么修改？");
  await dialog.getByRole("textbox", { name: "选区问答问题" }).press("Enter");

  const assistant = dialog.locator(".selection-ai-message.assistant");
  await expect(assistant.locator(".selection-ai-markdown strong")).toHaveText("确认后触发");
  await assistant.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press("Control+c");
  const copied = await readClipboard(page);
  expect(copied.types).toEqual(["text/plain"]);
  expect(copied.text).toContain("建议改为 确认后触发，并删除多余说明。");
  expect(copied.text).not.toContain("AI");
  expect(copied.text).not.toContain("**");

  await dialog.getByRole("button", { name: "最小化选区问答" }).click();
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+v");
  await expect(editor).toContainText("确认后触发");
  await expect(editor.locator("strong, em, [style*='font-family'], [style*='color']"))
    .toHaveCount(0);
  const fonts = await editor.locator("p").first().evaluate((paragraph) => ({
    editor: getComputedStyle(paragraph.closest(".ProseMirror")).fontFamily,
    paragraph: getComputedStyle(paragraph).fontFamily,
  }));
  expect(fonts.paragraph).toBe(fonts.editor);
  expect(pageErrors).toEqual([]);
});

test("English words break at visible soft-hyphen points without changing copied or saved text", async ({ page, context }) => {
  await grantClipboard(context);
  const documentPath = "C:\\e2e\\hyphenation.letterpaper";
  await installDesktopBridgeFixture(page, {
    documents: {
      [documentPath]: createTestDocument({ body: "abandonment" }),
    },
    activePath: documentPath,
  });
  const pageErrors = await openPaperWriter(page);
  const editor = page.locator(".canvas.active-pane .ProseMirror");
  await editor.evaluate((element) => {
    Object.assign(element.style, {
      width: "72px",
      minHeight: "0",
      padding: "0",
      fontFamily: "Arial",
      fontSize: "20px",
      lineHeight: "24px",
    });
  });

  const points = editor.locator(".paper-english-hyphenation-point");
  await expect(points).toHaveCount(2);
  expect(await points.first().evaluate((element) => (
    getComputedStyle(element, "::after").content
  ))).not.toBe("none");
  const geometry = await editor.evaluate((element) => {
    const textNode = element.querySelector("p")?.firstChild;
    const range = document.createRange();
    range.selectNodeContents(element.querySelector("p"));
    return {
      lines: range.getClientRects().length,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      text: textNode?.parentElement?.textContent || "",
    };
  });
  expect(geometry.lines).toBeGreaterThan(1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.text).toBe("abandonment");

  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+c");
  expect((await readClipboard(page)).text).toBe("abandonment");

  await editor.fill("abandonment confirmation");
  await page.keyboard.press("Control+s");
  await expect.poll(() => page.evaluate(() => (
    window.__paperWriterE2E.calls.saveDocument.length
  ))).toBe(1);
  const savedHtml = await page.evaluate(() => (
    window.__paperWriterE2E.calls.saveDocument.at(-1).document.html
  ));
  expect(savedHtml).toContain("abandonment confirmation");
  expect(savedHtml).not.toContain("\u00ad");
  expect(savedHtml).not.toContain("paper-english-hyphenation-point");
  expect(pageErrors).toEqual([]);
});

test("long table of contents starts on its first page and fragments into the next column", async ({ page }) => {
  const documentPath = "C:\\e2e\\long-toc.letterpaper";
  const headings = Array.from({ length: 28 }, (_, index) => (
    `<h3>目录分页条目 ${String(index + 1).padStart(2, "0")}</h3>`
  )).join("");
  await installDesktopBridgeFixture(page, {
    documents: {
      [documentPath]: createTestDocument({
        html: `<section data-type="paper-toc"></section>${headings}`,
      }),
    },
    activePath: documentPath,
  });
  const pageErrors = await openPaperWriter(page);
  await selectCanvasPageView(page, "单页");

  const items = page.locator(".canvas.active-pane .paper-toc-list li");
  await expect(items).toHaveCount(28);
  const layout = await page.locator(".canvas.active-pane .paper-toc").evaluate((toc) => {
    const editor = toc.closest(".ProseMirror");
    const title = toc.querySelector(".paper-toc-title").getBoundingClientRect();
    const entries = [...toc.querySelectorAll(".paper-toc-list li")];
    const first = entries[0].getBoundingClientRect();
    const last = entries.at(-1).getBoundingClientRect();
    return {
      editorLeft: editor.getBoundingClientRect().left,
      titleLeft: title.left,
      firstLeft: first.left,
      lastLeft: last.left,
      itemFragmentCounts: entries.map((entry) => entry.getClientRects().length),
    };
  });
  expect(layout.firstLeft - layout.editorLeft).toBeLessThan(700);
  expect(Math.abs(layout.firstLeft - layout.titleLeft)).toBeLessThan(100);
  expect(layout.lastLeft - layout.firstLeft).toBeGreaterThan(700);
  expect(layout.itemFragmentCounts.every((count) => count === 1)).toBe(true);
  expect(pageErrors).toEqual([]);
});
