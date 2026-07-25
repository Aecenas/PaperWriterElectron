function registerDocumentOutputIpcHandlers({
  ipcMain,
  pickInterchangeExportPath,
  pickDocumentExportPath,
  exportSafeName,
  sendExportProgress,
  ensureExtension,
  consumeExportTarget,
  getMainWindow,
  atomicWriteFile,
  fs,
  path,
}) {
  ipcMain.handle("document:pick-export-path", async (
    _event,
    format,
    suggestedName,
    initialDirectory,
  ) => {
    if (["markdown", "html", "txt", "docx"].includes(format)) {
      const targetPath = await pickInterchangeExportPath(
        format,
        suggestedName,
        initialDirectory,
      );
      return targetPath
        ? {
          canceled: false,
          path: targetPath,
          directory: path.dirname(targetPath),
          format,
        }
        : { canceled: true };
    }
    return pickDocumentExportPath(
      format === "images" ? "images" : "pdf",
      suggestedName,
      initialDirectory,
    );
  });

  ipcMain.handle("document:export-pdf", async (
    event,
    suggestedName,
    targetPath,
  ) => {
    const safeName = exportSafeName(suggestedName);
    const destination = targetPath
      ? { canceled: false, path: ensureExtension(String(targetPath), ".pdf") }
      : await pickDocumentExportPath("pdf", safeName);
    if (destination.canceled || !destination.path) {
      return { canceled: true };
    }

    const filePath = consumeExportTarget(destination.path, "pdf");
    sendExportProgress(event, {
      format: "pdf",
      percent: 12,
      message: "正在整理信笺版面…",
    });
    const mainWindow = getMainWindow();
    const pdf = await mainWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      landscape: false,
      margins: {
        marginType: "none",
      },
    });
    sendExportProgress(event, {
      format: "pdf",
      percent: 78,
      message: "正在写入 PDF 文件…",
    });
    await atomicWriteFile(filePath, pdf);
    sendExportProgress(event, {
      format: "pdf",
      percent: 100,
      message: "PDF 导出完成",
    });
    return { canceled: false, path: filePath };
  });

  ipcMain.handle("document:export-page-images", async (
    event,
    suggestedName,
    pageRects,
    targetPath,
  ) => {
    const safeName = exportSafeName(suggestedName);
    if (Array.isArray(pageRects) && pageRects.length > 500) {
      throw new Error("分页图片数量过多，已拒绝导出");
    }
    const rects = Array.isArray(pageRects)
      ? pageRects
          .map((rect) => ({
            x: Number(rect.x),
            y: Number(rect.y),
            width: Number(rect.width),
            height: Number(rect.height),
          }))
          .filter((rect) => (
            Number.isFinite(rect.x)
            && Number.isFinite(rect.y)
            && Number.isFinite(rect.width)
            && Number.isFinite(rect.height)
            && rect.x >= 0
            && rect.y >= 0
            && rect.width > 0
            && rect.width <= 10000
            && rect.height > 0
            && rect.height <= 8000
          ))
      : [];

    if (!rects.length) {
      return { canceled: true };
    }
    const totalPixels = rects.reduce(
      (total, rect) => total + rect.width * rect.height,
      0,
    );
    if (totalPixels > 512 * 1024 * 1024) {
      throw new Error("分页图片总像素过大，请减少内容后重试");
    }

    const destination = targetPath
      ? { canceled: false, path: String(targetPath) }
      : await pickDocumentExportPath("images", safeName);
    if (destination.canceled || !destination.path) {
      return { canceled: true };
    }

    const outputDir = consumeExportTarget(destination.path, "images");
    sendExportProgress(event, {
      format: "images",
      percent: 8,
      message: `正在准备 ${rects.length} 张分页图片…`,
    });
    await fs.mkdir(outputDir, { recursive: true });
    const mainWindow = getMainWindow();
    const debuggerApi = mainWindow.webContents.debugger;
    let attachedHere = false;
    try {
      if (!debuggerApi.isAttached()) {
        debuggerApi.attach("1.3");
        attachedHere = true;
      }
      await debuggerApi.sendCommand("Page.enable");
      sendExportProgress(event, {
        format: "images",
        percent: 14,
        message: "已准备图像渲染环境",
      });
      const files = [];
      for (let index = 0; index < rects.length; index += 1) {
        const rect = rects[index];
        const capture = await debuggerApi.sendCommand("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: true,
          clip: {
            x: Math.max(0, rect.x),
            y: Math.max(0, rect.y),
            width: rect.width,
            height: rect.height,
            scale: 1,
          },
        });
        const filePath = path.join(
          outputDir,
          `${safeName}-${String(index + 1).padStart(2, "0")}.png`,
        );
        await atomicWriteFile(
          filePath,
          Buffer.from(capture.data, "base64"),
        );
        files.push(filePath);
        const completed = index + 1;
        sendExportProgress(event, {
          format: "images",
          percent: Math.round(14 + (completed / rects.length) * 86),
          message: `正在导出第 ${completed} / ${rects.length} 张图片`,
          completed,
          total: rects.length,
        });
      }
      return {
        canceled: false,
        path: outputDir,
        files,
        count: files.length,
      };
    } finally {
      if (attachedHere && debuggerApi.isAttached()) {
        debuggerApi.detach();
      }
    }
  });
}

module.exports = {
  registerDocumentOutputIpcHandlers,
};
