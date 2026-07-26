import { expect, test } from "@playwright/test";
import {
  createTestDocument,
  installDesktopBridgeFixture,
  openPaperWriter,
} from "./support/paperwriter-fixtures.js";

const DOCUMENT_PATH = "C:\\e2e\\update-progress.letterpaper";
const PREPARING_DOWNLOAD = {
  status: "downloading",
  message: "准备更新",
  version: "1.0.0",
  progressKnown: false,
  installPending: false,
};
const DOWNLOADING_42_PERCENT = {
  status: "downloading",
  message: "更新中 42%",
  version: "1.0.0",
  progressKnown: true,
  percent: 42,
  transferred: 42 * 1024 * 1024,
  total: 100 * 1024 * 1024,
  bytesPerSecond: 2 * 1024 * 1024,
  installPending: false,
};

test.use({ viewport: { width: 1280, height: 720 } });

test("update status renders determinate progress, clears stale fields, and honors reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installDesktopBridgeFixture(page, {
    documents: {
      [DOCUMENT_PATH]: createTestDocument({ title: "更新进度回归" }),
    },
    activePath: DOCUMENT_PATH,
    updateState: PREPARING_DOWNLOAD,
  });
  const pageErrors = await openPaperWriter(page);

  const updateButton = page.locator(".statusbar-update");
  const progressbar = page.getByRole("progressbar", { name: "更新下载进度" });
  const progressValue = updateButton.locator(".statusbar-update-progress-value");

  await expect(updateButton).toContainText("准备更新");
  await expect(updateButton.locator(".statusbar-update-progress-icon.preparing")).toHaveCount(1);
  await expect(updateButton.locator(":scope > img")).toHaveCount(0);
  await expect(progressbar).not.toHaveAttribute("aria-valuenow");
  await expect(progressbar).toHaveAttribute("aria-valuetext", "准备更新");
  await expect(progressValue).toHaveCSS("animation-name", "none");

  await page.evaluate((state) => {
    window.__paperWriterE2E.setUpdateState(state);
  }, DOWNLOADING_42_PERCENT);

  await expect(updateButton).toBeDisabled();
  await expect(updateButton).toHaveAttribute("aria-busy", "true");
  await expect(updateButton).toContainText("42%");
  await expect(updateButton).toHaveAttribute(
    "aria-label",
    /更新中 42%（42 MB \/ 100 MB · 2 MB\/s）/,
  );
  await expect(progressbar).toHaveAttribute("aria-valuemin", "0");
  await expect(progressbar).toHaveAttribute("aria-valuemax", "100");
  await expect(progressbar).toHaveAttribute("aria-valuenow", "42");
  await expect(progressValue).toHaveCSS("transition-duration", "0s");
  await expect.poll(async () => Number(await progressValue.getAttribute("stroke-dashoffset"))).toBeCloseTo(
    2 * Math.PI * 8 * 0.58,
    4,
  );
  if (process.env.PAPERWRITER_RELEASE_SCREENSHOT) {
    await page.screenshot({
      path: process.env.PAPERWRITER_RELEASE_SCREENSHOT,
      fullPage: false,
    });
  }

  await page.evaluate(() => {
    window.__paperWriterE2E.setUpdateState({
      status: "downloaded",
      message: "更新已下载",
      version: "1.0.0",
      installPending: true,
    });
  });

  await expect(updateButton).toContainText("准备安装");
  await expect(updateButton).toBeDisabled();
  await expect(updateButton).toHaveAttribute("aria-busy", "true");
  await expect(updateButton).toHaveAttribute("aria-label", "更新已下载");
  await expect(progressbar).toHaveCount(0);
  await expect(updateButton).not.toHaveAttribute("aria-label", /MB|%/);
  await expect(page.getByRole("status")).toHaveText("更新已下载，正在准备重启安装");

  await page.evaluate(() => {
    window.__paperWriterE2E.setUpdateState({
      status: "idle",
      message: "尚未检查更新",
      version: "1.0.0",
    });
  });

  await expect(updateButton).toContainText("检查更新");
  await expect(updateButton).toBeEnabled();
  await expect(updateButton).not.toHaveAttribute("aria-busy");
  await expect(updateButton).toHaveAttribute("aria-label", "尚未检查更新");
  await expect(progressbar).toHaveCount(0);
  await expect(updateButton.locator(".statusbar-update-progress-icon")).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});
