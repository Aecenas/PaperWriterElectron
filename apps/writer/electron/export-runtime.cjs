const EXPORT_CAPABILITY_TTL_MS = 30 * 60 * 1000;

function createExportRuntime({
  path,
  fs,
  dialog,
  getMainWindow,
  defaultDocumentsDir,
  ensureExtension,
  sanitizeFilesystemName,
  platform = process.platform,
  now = Date.now,
}) {
  const exportCapabilities = new Map();

  function exportCapabilityKey(value, kind) {
    const resolved = path.resolve(String(value || ""));
    const pathKey = platform === "win32"
      ? resolved.toLocaleLowerCase("en-US")
      : resolved;
    return `${kind}:${pathKey}`;
  }

  function authorizeExportTarget(value, kind) {
    const resolved = path.resolve(String(value || ""));
    for (const [key, expiresAt] of exportCapabilities) {
      if (expiresAt < now()) exportCapabilities.delete(key);
    }
    exportCapabilities.set(
      exportCapabilityKey(resolved, kind),
      now() + EXPORT_CAPABILITY_TTL_MS,
    );
    return resolved;
  }

  function consumeExportTarget(value, kind) {
    const key = exportCapabilityKey(value, kind);
    const expiresAt = exportCapabilities.get(key) || 0;
    exportCapabilities.delete(key);
    if (expiresAt < now()) {
      throw new Error("导出位置授权已失效，请重新选择保存位置");
    }
    return path.resolve(String(value || ""));
  }

  function interchangeFormatExtension(format) {
    return ({
      markdown: ".md",
      html: ".html",
      txt: ".txt",
      docx: ".docx",
    })[format] || "";
  }

  async function existingExportPickerDirectory(value) {
    const candidate = typeof value === "string"
      ? value.trim().slice(0, 32768)
      : "";
    if (
      !candidate
      || /[\u0000-\u001f\u007f]/.test(candidate)
      || !path.isAbsolute(candidate)
    ) {
      return "";
    }
    try {
      const stats = await fs.stat(candidate);
      return stats.isDirectory() ? candidate : "";
    } catch {
      return "";
    }
  }

  function exportSafeName(suggestedName) {
    return sanitizeFilesystemName(suggestedName, "未命名信笺", 60);
  }

  async function pickInterchangeExportPath(
    format,
    suggestedName,
    initialDirectory = "",
  ) {
    const extension = interchangeFormatExtension(format);
    if (!extension) {
      throw new Error("不支持的可编辑导出格式");
    }
    const labels = {
      markdown: "Markdown",
      html: "HTML",
      txt: "纯文本",
      docx: "Word 文档",
    };
    const baseDirectory = await existingExportPickerDirectory(initialDirectory)
      || defaultDocumentsDir();
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: `导出 ${labels[format]}`,
      defaultPath: path.join(
        baseDirectory,
        `${exportSafeName(suggestedName)}${extension}`,
      ),
      filters: [{
        name: labels[format],
        extensions: [extension.slice(1)],
      }],
    });
    return result.canceled || !result.filePath
      ? ""
      : authorizeExportTarget(
        ensureExtension(result.filePath, extension),
        format,
      );
  }

  async function pickDocumentExportPath(
    format,
    suggestedName,
    initialDirectory = "",
  ) {
    const safeName = exportSafeName(suggestedName);
    const rememberedDirectory = await existingExportPickerDirectory(
      initialDirectory,
    );
    if (format === "images") {
      const result = await dialog.showOpenDialog(getMainWindow(), {
        title: "选择分页图片导出文件夹",
        defaultPath: rememberedDirectory
          || path.join(defaultDocumentsDir(), safeName),
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { canceled: true };
      }
      const targetPath = authorizeExportTarget(
        result.filePaths[0],
        "images",
      );
      return {
        canceled: false,
        path: targetPath,
        directory: targetPath,
        format: "images",
      };
    }

    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: "选择 PDF 导出位置",
      defaultPath: path.join(
        rememberedDirectory || defaultDocumentsDir(),
        `${safeName}.pdf`,
      ),
      filters: [
        { name: "PDF 文档", extensions: ["pdf"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    const targetPath = authorizeExportTarget(
      ensureExtension(result.filePath, ".pdf"),
      "pdf",
    );
    return {
      canceled: false,
      path: targetPath,
      directory: path.dirname(targetPath),
      format: "pdf",
    };
  }

  function sendExportProgress(event, payload) {
    if (!event?.sender?.isDestroyed?.()) {
      event.sender.send("document:export-progress", payload);
    }
  }

  return {
    authorizeExportTarget,
    consumeExportTarget,
    exportSafeName,
    interchangeFormatExtension,
    pickDocumentExportPath,
    pickInterchangeExportPath,
    sendExportProgress,
  };
}

module.exports = {
  createExportRuntime,
};
