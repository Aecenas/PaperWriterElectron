import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  createTestAiConfig,
  createTestDocument,
  installBrowserPreviewState,
  installDesktopBridgeFixture,
  openPaperWriter,
} from "./support/paperwriter-fixtures.js";

test.describe("P1 interaction regressions", () => {
  test("DOCX research opens as searchable rich content with the current release version", async ({ page }) => {
    await installBrowserPreviewState(page);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/?researchPreview=1&researchKind=docx");
    await page.locator(".paper-workspace").waitFor({ state: "visible" });

    await page.getByRole("tab", { name: "资料", exact: true }).click();
    await page.getByRole("treeitem", { name: "阅读示例.docx", exact: true }).click();

    const reader = page.getByRole("complementary", { name: "资料阅读区" });
    await expect(reader.getByRole("article", { name: "DOCX 资料内容" })).toContainText("DOCX 资料示例");
    await expect(page.locator('[data-group-id="secondary"]')).toContainText("DOCX");

    await reader.getByRole("button", { name: "展开资料搜索", exact: true }).click();
    await reader.getByRole("textbox", { name: "搜索资料内容", exact: true }).fill("DOCX");
    await expect(reader.locator("mark")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "查看版本 0.9.11 的更新历史", exact: true })).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("modal dialogs isolate global shortcuts and keep keyboard focus inside", async ({ page }) => {
    await installBrowserPreviewState(page);
    const pageErrors = await openPaperWriter(page);
    const primaryGroup = page.locator('[data-group-id="primary"]');
    await expect(primaryGroup.getByRole("tab")).toHaveCount(1);

    const exportTrigger = page.getByRole("button", { name: "导出", exact: true });
    await exportTrigger.click();
    await page.getByRole("menuitem", { name: /导出信笺/ }).click();
    const dialog = page.getByRole("dialog", { name: "导出" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Control+N");
    await expect(dialog).toBeVisible();
    await expect(primaryGroup.getByRole("tab")).toHaveCount(1);

    for (let index = 0; index < 10; index += 1) {
      await page.keyboard.press("Tab");
      await expect.poll(() => page.evaluate(() => (
        Boolean(window.document.activeElement?.closest?.('[role="dialog"]'))
      ))).toBe(true);
    }

    await dialog.getByRole("button", { name: "关闭导出窗口" }).click();
    await expect(dialog).toBeHidden();
    await expect(exportTrigger).toBeFocused();

    expect(pageErrors).toEqual([]);
  });

  test("right editor group exports its frozen document rather than the left document", async ({ page }, testInfo) => {
    await installBrowserPreviewState(page);
    const pageErrors = await openPaperWriter(page);
    const primaryGroup = page.locator('[data-group-id="primary"]');

    await page.locator(".canvas.active-pane .paper-title-input").fill("左侧信笺");
    await page.locator(".canvas.active-pane .ProseMirror").fill("LEFT-PANE-SENTINEL");
    await primaryGroup.getByRole("button", { name: "在当前组新建信笺" }).click();
    await expect(primaryGroup.getByRole("tab")).toHaveCount(2);

    await page.locator(".canvas.active-pane .paper-title-input").fill("右侧导出目标");
    await page.locator(".canvas.active-pane .ProseMirror").fill("RIGHT-PANE-SENTINEL");
    await primaryGroup.locator(".group-tab.active").click({ button: "right" });
    await page.getByRole("menuitem", { name: "移到右侧" }).click();

    const secondaryGroup = page.locator('[data-group-id="secondary"]');
    await expect(secondaryGroup.getByRole("tab")).toHaveCount(1);
    await secondaryGroup.getByRole("tab").click();
    await expect(page.locator(".right-split-canvas.active-pane .paper-title-input")).toHaveValue("右侧导出目标");

    await page.getByRole("button", { name: "导出", exact: true }).click();
    await page.getByRole("menuitem", { name: /导出信笺/ }).click();
    const dialog = page.getByRole("dialog", { name: "导出" });
    await dialog.getByRole("radio", { name: /Markdown/ }).check();
    await dialog.getByRole("button", { name: "选择位置" }).click();
    await expect(dialog.getByLabel("导出路径")).toHaveValue("右侧导出目标.md");

    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "开始导出" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("右侧导出目标.md");
    const downloadedPath = testInfo.outputPath("right-pane-export.md");
    await download.saveAs(downloadedPath);
    const markdown = await fs.readFile(downloadedPath, "utf8");
    expect(markdown).toContain("RIGHT-PANE-SENTINEL");
    expect(markdown).not.toContain("LEFT-PANE-SENTINEL");

    expect(pageErrors).toEqual([]);
  });

  test("an opened document keeps its path and revision contract when edited and saved", async ({ page }) => {
    const documentPath = "C:\\e2e\\editable.letterpaper";
    await installDesktopBridgeFixture(page, {
      documents: {
        [documentPath]: createTestDocument({
          documentId: "50000000-0000-4000-8000-000000000001",
          title: "待编辑信笺",
          body: "SAVE-BEFORE-SENTINEL",
        }),
      },
      activePath: documentPath,
    });
    const pageErrors = await openPaperWriter(page);

    await page.getByLabel("文章标题").fill("已保存信笺");
    await page.locator(".canvas.active-pane .ProseMirror").fill("SAVE-AFTER-SENTINEL");
    await page.keyboard.press("Control+s");

    await expect.poll(() => page.evaluate(() => (
      window.__paperWriterE2E.calls.saveDocument.length
    ))).toBe(1);
    const saved = await page.evaluate(() => (
      window.__paperWriterE2E.calls.saveDocument.at(-1)
    ));
    expect(saved.currentPath).toBe(documentPath);
    expect(saved.saveAs).toBe(false);
    expect(saved.document.title).toBe("已保存信笺");
    expect(saved.document.html).toContain("SAVE-AFTER-SENTINEL");
    expect(saved.expectedRevision).toEqual({
      size: expect.any(Number),
      mtimeMs: 1,
      sha256: "a".repeat(64),
    });
    await expect(page.locator(".statusbar")).toContainText("已写入工作区");

    expect(pageErrors).toEqual([]);
  });

  test("editable export keeps the selected format, target, and frozen document contract", async ({ page }) => {
    const documentPath = "C:\\e2e\\export-source.letterpaper";
    await installDesktopBridgeFixture(page, {
      documents: {
        [documentPath]: createTestDocument({
          documentId: "50000000-0000-4000-8000-000000000002",
          title: "交换格式导出",
          body: "EDITABLE-EXPORT-SENTINEL",
        }),
      },
      activePath: documentPath,
    });
    const pageErrors = await openPaperWriter(page);

    await page.getByRole("button", { name: "导出", exact: true }).click();
    await page.getByRole("menuitem", { name: /导出信笺/ }).click();
    const dialog = page.getByRole("dialog", { name: "导出" });
    await dialog.getByRole("radio", { name: /Markdown/ }).check();
    await dialog.getByRole("button", { name: "选择位置" }).click();
    await expect(dialog.getByLabel("导出路径")).toHaveValue("交换格式导出.md");
    await dialog.getByRole("button", { name: "开始导出" }).click();
    await expect(dialog.getByText("MARKDOWN 导出完成")).toBeVisible();

    const exportCalls = await page.evaluate(() => ({
      pick: window.__paperWriterE2E.calls.pickExportPath.at(-1),
      editable: window.__paperWriterE2E.calls.exportEditable.at(-1),
    }));
    expect(exportCalls.pick).toEqual({
      format: "markdown",
      suggestedName: "交换格式导出",
      initialDirectory: "",
    });
    expect(exportCalls.editable.format).toBe("markdown");
    expect(exportCalls.editable.targetPath).toBe("交换格式导出.md");
    expect(exportCalls.editable.document.title).toBe("交换格式导出");
    expect(exportCalls.editable.document.html).toContain("EDITABLE-EXPORT-SENTINEL");

    expect(pageErrors).toEqual([]);
  });

  test("a clean workspace acknowledges the Electron close handshake exactly once", async ({ page }) => {
    const documentPath = "C:\\e2e\\close-ready.letterpaper";
    await installDesktopBridgeFixture(page, {
      documents: {
        [documentPath]: createTestDocument({
          documentId: "50000000-0000-4000-8000-000000000003",
          title: "关闭握手",
        }),
      },
      activePath: documentPath,
    });
    const pageErrors = await openPaperWriter(page);

    await page.evaluate(() => {
      window.__paperWriterE2E.emit("app:close-request", { requestId: "close-e2e-1" });
    });

    await expect.poll(() => page.evaluate(() => (
      window.__paperWriterE2E.calls.closeReady.length
    ))).toBe(1);
    const handshake = await page.evaluate(() => ({
      ready: window.__paperWriterE2E.calls.closeReady,
      canceled: window.__paperWriterE2E.calls.closeCanceled,
    }));
    expect(handshake.ready).toEqual([{ requestId: "close-e2e-1" }]);
    expect(handshake.canceled).toEqual([]);

    expect(pageErrors).toEqual([]);
  });

  test("read-only documents lock editing, AI entry, save, and citation mutations", async ({ page }) => {
    const documentPath = "C:\\e2e\\future-format.letterpaper";
    const readOnlyDocument = createTestDocument({
      version: 99,
      title: "未来格式只读信笺",
      body: "READ-ONLY-SENTINEL",
      footnotes: [{
        id: "20000000-0000-4000-8000-000000000001",
        label: "1",
        text: "只读脚注",
      }],
      citationSources: [{
        id: "30000000-0000-4000-8000-000000000001",
        title: "只读参考来源",
        authors: ["测试作者"],
        year: "2026",
      }],
    });
    await installDesktopBridgeFixture(page, {
      documents: { [documentPath]: readOnlyDocument },
      activePath: documentPath,
      readOnlyPaths: [documentPath],
    });
    const pageErrors = await openPaperWriter(page);

    await expect(page.getByRole("tab", { name: /未来格式只读信笺/ })).toBeVisible();
    await expect(page.getByLabel("文章标题")).toHaveAttribute("readonly", "");
    await expect(page.locator(".canvas.active-pane .ProseMirror")).toHaveAttribute("contenteditable", "false");
    await expect(page.locator(".ai-feature-trigger")).toBeDisabled();
    await expect(page.locator(".ai-feature-trigger")).toHaveAttribute("title", "当前信笺为只读，不能进入 AI 模式");
    await expect(page.getByRole("button", { name: "元素", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "在文尾生成参考文献" })).toBeDisabled();

    await page.getByRole("button", { name: "文件", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: /保存.*写入当前文件/ })).toBeDisabled();
    await expect(page.getByRole("menuitem", { name: /另存为.*保存为新信笺/ })).toBeDisabled();
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);

    await page.getByRole("tab", { name: "结构", exact: true }).click();
    await page.getByRole("tab", { name: "注引", exact: true }).click();
    await expect(page.getByRole("button", { name: "新增参考文献来源" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /编辑脚注/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /删除脚注/ })).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test("clean, recovered, and externally changed tabs keep independent status-bar state", async ({ page }) => {
    const cleanPath = "C:\\e2e\\clean.letterpaper";
    const recoveryPath = "C:\\e2e\\recovered.tmp.letterpaper";
    const externalPath = "C:\\e2e\\external.letterpaper";
    const externalRecoveryPath = "C:\\e2e\\external.tmp.letterpaper";
    const recoveryBaseRevision = {
      size: 101,
      mtimeMs: 1,
      sha256: "a".repeat(64),
    };

    await installDesktopBridgeFixture(page, {
      documents: {
        [cleanPath]: createTestDocument({
          documentId: "40000000-0000-4000-8000-000000000001",
          title: "干净标签",
        }),
        [recoveryPath]: createTestDocument({
          documentId: "40000000-0000-4000-8000-000000000002",
          title: "恢复缓存标签",
        }),
        [externalPath]: createTestDocument({
          documentId: "40000000-0000-4000-8000-000000000003",
          title: "磁盘原稿",
        }),
        [externalRecoveryPath]: createTestDocument({
          documentId: "40000000-0000-4000-8000-000000000003",
          title: "外部变更标签",
        }),
      },
      activePath: cleanPath,
      sessionTabs: [
        {
          path: cleanPath,
          recoveryPath: "",
          recoveryId: "",
          recoverySourcePath: "",
          recoveryBaseRevision: null,
          temporary: false,
        },
        {
          path: "",
          recoveryPath,
          recoveryId: "recovered-only",
          recoverySourcePath: "",
          recoveryBaseRevision: null,
          temporary: true,
        },
        {
          path: externalPath,
          recoveryPath: externalRecoveryPath,
          recoveryId: "external-changed",
          recoverySourcePath: externalPath,
          recoveryBaseRevision,
          temporary: false,
        },
      ],
      revisions: {
        [externalPath]: {
          size: 202,
          mtimeMs: 2,
          sha256: "b".repeat(64),
        },
      },
    });
    const pageErrors = await openPaperWriter(page);
    const primaryGroup = page.locator('[data-group-id="primary"]');
    const statusBar = page.locator(".statusbar");

    await expect(primaryGroup.getByRole("tab")).toHaveCount(3);
    await expect(statusBar).toContainText("已写入工作区");

    await primaryGroup.getByRole("tab", { name: /恢复缓存标签/ }).click();
    await expect(statusBar).toContainText("已写入恢复缓存");

    await primaryGroup.getByRole("tab", { name: /外部变更标签/ }).click();
    await expect(statusBar).toContainText("检测到外部版本");

    await primaryGroup.getByRole("tab", { name: /干净标签/ }).click();
    await expect(statusBar).toContainText("已写入工作区");

    expect(pageErrors).toEqual([]);
  });

  test("stopped AI work ignores late chunks and completion from the canceled request", async ({ page }) => {
    await installBrowserPreviewState(page, { aiConfig: createTestAiConfig() });
    const pageErrors = await openPaperWriter(page);
    await page.locator(".canvas.active-pane .ProseMirror").fill("需要进行离线优化的正文。");

    await page.locator(".ai-feature-trigger").click();
    const chooser = page.getByRole("dialog", { name: "选择 AI 模式" });
    await chooser.getByRole("button", { name: /AI优化/ }).click();
    await expect(page.getByRole("button", { name: "开始优化" })).toBeVisible();

    await page.getByRole("button", { name: "开始优化" }).click();
    await expect(page.getByRole("button", { name: "停止" })).toBeVisible();
    await page.getByRole("button", { name: "停止" }).click();
    await expect(page.getByRole("button", { name: "开始优化" })).toBeVisible();

    await page.waitForTimeout(700);
    await expect(page.getByText("这是一段浏览器预览 AI 回复。")).toHaveCount(0);
    await expect(page.getByText("AI 优化结果已生成")).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });
});
