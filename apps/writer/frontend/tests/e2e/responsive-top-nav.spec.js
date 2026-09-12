import { expect, test } from "@playwright/test";
import {
  installBrowserPreviewState,
  openPaperWriter,
} from "./support/paperwriter-fixtures.js";

for (const width of [1080, 800]) {
  test(`toolbar menus remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await installBrowserPreviewState(page);
    const pageErrors = await openPaperWriter(page);

    const toolbar = page.locator(".nav-tools");
    await page.getByRole("button", { name: "元素", exact: true }).click();

    const menu = page.locator("#nav-menu-elements");
    await expect(menu).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "表情", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Mermaid 图", exact: true })).toBeVisible();

    const overflow = await toolbar.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { x: style.overflowX, y: style.overflowY };
    });
    expect(overflow).toEqual({ x: "visible", y: "visible" });

    const toolbarBox = await toolbar.boundingBox();
    const menuBox = await menu.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(menuBox).not.toBeNull();
    expect(menuBox.y).toBeGreaterThan(toolbarBox.y);
    expect(menuBox.height).toBeGreaterThan(toolbarBox.height);
    expect(pageErrors).toEqual([]);
  });
}
