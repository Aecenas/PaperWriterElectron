import { expect, test } from "@playwright/test";
import { createTestDocument, installDesktopBridgeFixture } from "./support/paperwriter-fixtures.js";

const IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR42mNkYPj/n4GBgQEABQAB/WTN8QAAAABJRU5ErkJggg==";

test("restored multi-image documents survive writing-check refreshes, tab changes and reload", async ({ page }) => {
  const docPath = "C:/e2e/startup-images.letterpaper";
  const otherPath = "C:/e2e/plain.letterpaper";
  const html = '<section data-type="paper-toc"></section>' + Array.from({ length: 21 }, (_, index) => (
    `<h2>章节 ${index + 1}</h2><p>启动恢复正文 ${index + 1}</p>${Array.from({ length: 20 }, (_, paragraph) => `<p>段落 ${paragraph} ${"长文档恢复回归验证。".repeat(7)}</p>`).join("")}<figure data-type="paper-image" data-image-id="20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}" data-width="78%"><img src="${IMAGE}"></figure>`
  )).join("");
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && message.text().includes("renderer crashed")) errors.push(message.text()); });
  await installDesktopBridgeFixture(page, { documents: {
    [otherPath]: createTestDocument({ title: "普通信笺", html: "<p>普通正文</p>" }),
    [docPath]: createTestDocument({ title: "多图启动恢复", html }),
  }, activePath: docPath });
  await page.goto("/");
  for (let pass = 0; pass < 2; pass++) {
    await expect(page.locator(".tiptap .paper-image-figure")).toHaveCount(21);
    await page.keyboard.press("Control+f");
    await page.getByLabel("在当前文档中查找", { exact: true }).fill("启动恢复正文");
    await expect(page.locator(".paper-search-match")).toHaveCount(21);
    await page.getByRole("button", { name: "关闭查找", exact: true }).click();
    await page.getByRole("tab", { name: /普通信笺/ }).click();
    await expect(page.locator(".tiptap")).toContainText("普通正文");
    await page.getByRole("tab", { name: /多图启动恢复/ }).click();
    await expect(page.locator(".tiptap .paper-image-figure")).toHaveCount(21);
    await expect(page.locator(".app-error-boundary")).toHaveCount(0);
    expect(errors).toEqual([]);
    if (!pass) await page.reload();
  }
});
