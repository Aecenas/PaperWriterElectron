import { expect, test } from "@playwright/test";
import {
  createTestDocument,
  installDesktopBridgeFixture,
  openPaperWriter,
} from "./support/paperwriter-fixtures.js";

const FIRST_IMAGE_ID = "20000000-0000-4000-8000-000000000001";
const SECOND_IMAGE_ID = "20000000-0000-4000-8000-000000000002";
const TEST_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR42mNkYPj/n4GBgQEABQAB/WTN8QAAAABJRU5ErkJggg==";

function imageFigure(imageId, caption, alt) {
  return `<figure data-type="paper-image" data-image-id="${imageId}" data-width="78%" data-caption="${caption}"><img src="${TEST_IMAGE}" alt="${alt}"><figcaption>${caption}</figcaption></figure>`;
}

test("image preview zooms, copies, restores focus, and deletion renumbers title and reference", async ({ page }) => {
  const documentPath = "C:\\e2e\\图片预览回归.letterpaper";
  const document = createTestDocument({
    title: "图片预览回归",
    html: [
      imageFigure(FIRST_IMAGE_ID, "第一张图", "第一张测试图"),
      imageFigure(SECOND_IMAGE_ID, "第二张图", "第二张测试图"),
      `<p>正文引用 <span data-paper-image-reference="true" data-image-id="${SECOND_IMAGE_ID}" data-image-number="9" data-missing="false">图9</span></p>`,
    ].join(""),
  });
  await installDesktopBridgeFixture(page, {
    documents: { [documentPath]: document },
    activePath: documentPath,
  });
  const pageErrors = await openPaperWriter(page);

  const figures = page.locator(".paper-image-figure");
  await expect(figures).toHaveCount(2);
  await expect(figures.nth(0).locator(".paper-image-caption-prefix")).toHaveText("图1. ");
  await expect(figures.nth(1).locator(".paper-image-caption-prefix")).toHaveText("图2. ");
  await expect(page.locator(".paper-image-reference-label")).toHaveText("图2");

  const secondFigure = figures.nth(1);
  const sizeTools = secondFigure.locator(".image-size-tools");
  await secondFigure.hover();
  await expect(secondFigure).toHaveClass(/image-tools-open/);
  const figureBox = await secondFigure.boundingBox();
  await page.mouse.move(figureBox.x - 8, figureBox.y + 12);
  await page.waitForTimeout(200);
  await expect(secondFigure).toHaveClass(/image-tools-open/);
  await secondFigure.hover();
  await page.waitForTimeout(450);
  await expect(secondFigure).toHaveClass(/image-tools-open/);
  await page.mouse.move(figureBox.x - 8, figureBox.y + 12);
  await page.waitForTimeout(450);
  await expect(secondFigure).not.toHaveClass(/image-tools-open/);
  await secondFigure.hover();
  await expect(sizeTools).toBeVisible();

  const secondImage = figures.nth(1).locator(".paper-image-frame img");
  await secondImage.click();
  const dialog = page.getByRole("dialog", { name: "图2. 第二张图" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /当前缩放/ })).toContainText("100%");

  await dialog.getByRole("button", { name: "放大图片" }).click();
  await expect(dialog.getByRole("button", { name: /当前缩放/ })).toContainText("125%");
  await dialog.locator(".paper-image-preview-stage").hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await expect(dialog.getByRole("button", { name: /当前缩放/ })).toContainText("150%");

  await dialog.getByRole("button", { name: "复制图片" }).click();
  await expect(dialog.getByRole("button", { name: "已复制" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__paperWriterE2E.calls.copyImageToClipboard.length)).toBe(1);
  const copyPayload = await page.evaluate(() => window.__paperWriterE2E.calls.copyImageToClipboard[0]);
  expect(copyPayload.src).toBe(TEST_IMAGE);
  expect(Number.isInteger(copyPayload.x)).toBe(true);
  expect(Number.isInteger(copyPayload.y)).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(secondImage).toBeFocused();

  await figures.nth(0).hover();
  await figures.nth(0).getByRole("button", { name: "删除图片" }).click();
  await expect(figures).toHaveCount(1);
  await expect(figures.nth(0).locator(".paper-image-caption-prefix")).toHaveText("图1. ");
  await expect(page.locator(".paper-image-reference-label")).toHaveText("图1");
  expect(pageErrors).toEqual([]);
});
