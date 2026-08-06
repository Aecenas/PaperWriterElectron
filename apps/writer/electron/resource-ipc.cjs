function registerResourceIpcHandlers({
  ipcMain,
  dialog,
  getMainWindow,
  imageExtensions,
  audioExtensions,
  videoExtensions,
  imageMaxBytes,
  imageMaxDimension,
  imageMaxPixels,
  audioMaxBytes,
  videoMaxBytes,
  path,
  fs,
  assetsFacade,
  clipboard,
  shell,
}) {
  const {
    isStagedAssetReady,
    mimeFromPath,
    stageAsset,
  } = assetsFacade;

  async function pickLocalMediaAsset(kind) {
    const isAudio = kind === "audio";
    const extensions = isAudio ? audioExtensions : videoExtensions;
    const maxBytes = isAudio ? audioMaxBytes : videoMaxBytes;
    const label = isAudio ? "音频" : "视频";
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: `选择${label}`,
      properties: ["openFile"],
      filters: [
        { name: label, extensions },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePaths?.[0]) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const extension = path.extname(filePath).toLowerCase().replace(/^\./, "");
    if (!extensions.includes(extension)) {
      return { canceled: false, error: "unsupported-type", kind, extension };
    }
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > maxBytes) {
        return {
          canceled: false,
          error: "too-large",
          kind,
          size: stat.size,
          maxBytes,
        };
      }
      if (!isStagedAssetReady()) {
        throw new Error("资源暂存服务尚未就绪");
      }
      const staged = await stageAsset(filePath, {
        mime: mimeFromPath(filePath),
        name: path.basename(filePath),
        maxBytes,
      });
      return {
        canceled: false,
        kind,
        name: path.basename(filePath, path.extname(filePath)),
        fileName: path.basename(filePath),
        mime: mimeFromPath(filePath),
        size: staged.size,
        src: staged.src,
      };
    } catch {
      return { canceled: false, error: "read-failed", kind };
    }
  }

  ipcMain.handle("asset:pick-image", async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: "选择图片",
      properties: ["openFile"],
      filters: [
        { name: "Images", extensions: imageExtensions },
      ],
    });

    if (result.canceled || !result.filePaths?.[0]) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const extension = path.extname(filePath).slice(1).toLowerCase();
    if (!imageExtensions.includes(extension)) {
      return {
        canceled: false,
        error: "unsupported-type",
        kind: "image",
        extension,
      };
    }
    const stat = await fs.stat(filePath);
    if (typeof stat.isFile === "function" && !stat.isFile()) {
      return { canceled: false, error: "read-failed", kind: "image" };
    }
    if (stat.size > imageMaxBytes) {
      return {
        canceled: false,
        error: "too-large",
        kind: "image",
        size: stat.size,
        maxBytes: imageMaxBytes,
      };
    }
    if (!isStagedAssetReady()) {
      throw new Error("图片暂存服务尚未就绪，请重启应用后重试");
    }
    const fileName = path.basename(filePath);
    const mime = mimeFromPath(filePath);
    const staged = await stageAsset(filePath, {
      mime,
      name: fileName,
      maxBytes: imageMaxBytes,
      validateImage: true,
      maxImageDimension: imageMaxDimension,
      maxImagePixels: imageMaxPixels,
    }).catch((error) => {
      if (error?.code === "INVALID_IMAGE") return null;
      throw error;
    });
    if (!staged) {
      return { canceled: false, error: "invalid-image", kind: "image" };
    }
    return {
      canceled: false,
      name: path.basename(filePath, path.extname(filePath)),
      fileName,
      mime,
      size: staged.size,
      src: staged.src,
    };
  });

  ipcMain.handle("asset:pick-audio", async () => pickLocalMediaAsset("audio"));
  ipcMain.handle("asset:pick-video", async () => pickLocalMediaAsset("video"));

  function safeClipboardUuid(value) {
    const id = String(value || "").trim().toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
      ? id
      : "";
  }

  function safeClipboardContent(value, maximumLength) {
    return typeof value === "string" ? value.slice(0, maximumLength) : "";
  }

  ipcMain.handle("clipboard:write-content", async (_event, payload = {}) => {
    const text = safeClipboardContent(payload?.text, 2_000_000);
    const html = safeClipboardContent(payload?.html, 4_000_000);
    if (!text && !html) {
      return { ok: false, message: "没有可复制的内容" };
    }
    clipboard.write(html ? { text, html } : { text });
    return { ok: true };
  });

  ipcMain.handle("clipboard:write-image-reference", async (_event, payload = {}) => {
    const documentId = safeClipboardUuid(payload?.documentId);
    const imageId = safeClipboardUuid(payload?.imageId);
    const number = Math.max(
      1,
      Math.min(5_000, Number.parseInt(payload?.number, 10) || 1),
    );
    if (!documentId || !imageId) {
      return { ok: false, message: "图片引用身份无效" };
    }
    const label = `图${number}`;
    const html = `<span data-paper-image-reference="true" data-image-id="${imageId}" data-image-number="${number}" data-missing="false" data-source-document-id="${documentId}">${label}</span>`;
    clipboard.write({ text: label, html });
    return { ok: true };
  });

  ipcMain.handle("external:open", async (_event, urlValue) => {
    try {
      const rawUrl = String(urlValue || "");
      if (rawUrl.length > 8192) {
        return { ok: false, error: "url-too-long" };
      }
      const url = new URL(rawUrl);
      if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
        return { ok: false, error: "unsupported-protocol" };
      }
      await shell.openExternal(url.toString());
      return { ok: true };
    } catch {
      return { ok: false, error: "invalid-url" };
    }
  });
}

module.exports = {
  registerResourceIpcHandlers,
};
