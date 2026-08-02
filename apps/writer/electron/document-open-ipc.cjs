function registerDocumentOpenIpcHandlers({
  ipcMain,
  documentModel,
  dialog,
  getMainWindow,
  defaultDocumentsDir,
  canonicalExistingPath,
  authorizeDocumentPath,
  writeDebugLog,
  assertAuthorizedDocument,
  resolveAuthorizedOpenDocument,
  randomUUID,
  storageFacade,
  interchangeFormatExtension,
  pickInterchangeExportPath,
  ensureExtension,
  path,
  consumeExportTarget,
  isPathInside,
  fs,
  atomicWriteFile,
}) {
  const {
    DOCUMENT_FILTERS: documentFilters,
    DOCUMENT_SCHEMA_VERSION: documentSchemaVersion,
    isSupportedDocument,
    normalizeDocument,
    normalizeDocumentId,
  } = documentModel;
  const {
    autosaveSessionIdForPath,
    exportDocument,
    importDocument,
    loadPaperDocumentSnapshot,
    readDiskRevision,
    runDocumentTransaction,
  } = storageFacade;
  ipcMain.handle("document:revision", async (_event, filePath) => {
    const authorizedPath = await assertAuthorizedDocument(filePath);
    return {
      path: authorizedPath,
      diskRevision: await readDiskRevision(authorizedPath),
    };
  });

  ipcMain.handle("document:regenerate-identity", async (_event, filePath, force = false) => {
    const targetPath = await resolveAuthorizedOpenDocument(filePath);
    return runDocumentTransaction(async (transaction) => {
      const sourceSnapshot =
        await transaction.loadPaperDocumentSnapshot(targetPath);
      const expectedRevision = sourceSnapshot.diskRevision;
      const sourceDocument = sourceSnapshot.document;
      if (
        Number(sourceSnapshot.rawDocument?.version || 1)
          > documentSchemaVersion
        || sourceDocument._readOnlyFutureSchema
      ) {
        throw new Error(
          `此信笺使用未来格式 v${Number(sourceSnapshot.rawDocument?.version) || "?"}，当前版本只能只读打开`,
        );
      }
      const previousId = normalizeDocumentId(
        sourceDocument.documentId,
      );
      if (previousId && !force) {
        return {
          canceled: false,
          path: targetPath,
          documentId: previousId,
          diskRevision: expectedRevision,
          changed: false,
        };
      }
      const migrationBackupPath =
        Number(sourceDocument.version || 1)
          < documentSchemaVersion
          ? await transaction.preservePreV2MigrationBackup(
            targetPath,
          )
          : "";
      const documentId = randomUUID();
      const nextDocument = {
        ...sourceDocument,
        version: documentSchemaVersion,
        documentId,
        derivedFrom: previousId || "",
        footnotes: Array.isArray(sourceDocument.footnotes)
          ? sourceDocument.footnotes
          : [],
        citationSources: Array.isArray(
          sourceDocument.citationSources,
        )
          ? sourceDocument.citationSources
          : [],
      };
      const saved = await transaction.savePaperDocument(
        targetPath,
        nextDocument,
        {
          validateTarget: (candidate) => (
            transaction.assertDiskRevision(
              candidate,
              expectedRevision,
            )
          ),
        },
      );
      return {
        canceled: false,
        changed: true,
        path: targetPath,
        documentId,
        document: saved.document,
        diskRevision: saved.diskRevision,
        ...(migrationBackupPath
          ? { migrationBackupPath }
          : {}),
      };
    });
  });

  ipcMain.handle("document:open", async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: "打开信笺",
      defaultPath: defaultDocumentsDir(),
      properties: ["openFile"],
      filters: documentFilters,
    });

    if (result.canceled || !result.filePaths?.[0]) {
      return { canceled: true };
    }

    const filePath = await canonicalExistingPath(result.filePaths[0], "file");
    if (!isSupportedDocument(filePath)) {
      throw new Error("请选择 .letterpaper 或 .paperdoc 信笺文件");
    }
    const metrics = {};
    const loaded = await loadPaperDocumentSnapshot(filePath, metrics);
    const { document, diskRevision } = loaded;
    await authorizeDocumentPath(filePath);
    void writeDebugLog("document:open:loaded", { filePath, ...metrics });
    return {
      canceled: false,
      path: filePath,
      document,
      diskRevision,
      readOnly: Boolean(document._readOnlyFutureSchema),
    };
  });

  ipcMain.handle("document:open-path", async (_event, filePath) => {
    if (!filePath) {
      return { canceled: true };
    }
    if (!isSupportedDocument(filePath)) {
      return { canceled: true };
    }
    try {
      const authorizedPath = await resolveAuthorizedOpenDocument(filePath);
      const metrics = {};
      const loaded = await loadPaperDocumentSnapshot(authorizedPath, metrics);
      const { document, diskRevision } = loaded;
      const recoveryId = autosaveSessionIdForPath(authorizedPath);
      void writeDebugLog("document:open-path:loaded", {
        filePath: authorizedPath,
        ...metrics,
      });
      return {
        canceled: false,
        path: authorizedPath,
        document,
        diskRevision,
        readOnly: Boolean(document._readOnlyFutureSchema),
        ...(recoveryId ? { recoveryId } : {}),
      };
    } catch (error) {
      await writeDebugLog("document:open-path:error", {
        filePath,
        message: error?.message,
        code: error?.code,
      });
      return {
        canceled: true,
        error: String(error?.message || "文档打开失败").slice(0, 500),
      };
    }
  });

  ipcMain.handle("document:import", async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: "导入文档",
      defaultPath: defaultDocumentsDir(),
      properties: ["openFile"],
      filters: [
        {
          name: "可导入文档",
          extensions: ["md", "markdown", "html", "htm", "txt", "docx"],
        },
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "HTML", extensions: ["html", "htm"] },
        { name: "纯文本", extensions: ["txt"] },
        { name: "Word 文档", extensions: ["docx"] },
      ],
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { canceled: true };
    }
    const sourcePath = await canonicalExistingPath(result.filePaths[0], "file");
    const imported = await importDocument({ sourcePath });
    const now = new Date().toISOString();
    const document = normalizeDocument({
      ...imported.document,
      version: documentSchemaVersion,
      documentId: randomUUID(),
      derivedFrom: "",
      comments: [],
      aiState: {},
      createdAt: now,
      updatedAt: now,
    });
    return {
      canceled: false,
      sourcePath,
      format: imported.format,
      document,
      warnings: imported.warnings || [],
    };
  });

  ipcMain.handle("document:export-editable", async (_event, payload = {}) => {
    const format = ["markdown", "html", "txt", "docx"].includes(payload.format)
      ? payload.format
      : "";
    if (!format) {
      throw new Error("不支持的可编辑导出格式");
    }
    const selectedTargetPath = payload.targetPath
      ? ensureExtension(
        path.resolve(String(payload.targetPath)),
        interchangeFormatExtension(format),
      )
      : await pickInterchangeExportPath(
        format,
        payload.document?.title || "未命名信笺",
      );
    if (!selectedTargetPath) {
      return { canceled: true };
    }
    const targetPath = consumeExportTarget(selectedTargetPath, format);
    const exported = await exportDocument({
      format,
      document: normalizeDocument(payload.document || {}),
      targetPath,
      baseName: path.basename(targetPath, path.extname(targetPath)),
      ...(["docx", "html"].includes(format) && typeof payload.renderedHtml === "string"
        ? { renderedHtml: payload.renderedHtml }
        : {}),
    });
    const root = path.dirname(targetPath);
    const writes = [];
    for (const asset of exported.assets || []) {
      const assetPath = path.resolve(root, asset.relativePath);
      if (!isPathInside(root, assetPath)) {
        throw new Error("导出资源路径越过目标文件夹");
      }
      writes.push({ path: assetPath, buffer: asset.buffer });
    }
    // Sidecar assets land first; the main document is the bundle commit point.
    writes.push({ path: targetPath, buffer: exported.buffer });
    for (const write of writes) {
      await fs.mkdir(path.dirname(write.path), { recursive: true });
      await atomicWriteFile(write.path, write.buffer);
    }
    return {
      canceled: false,
      path: targetPath,
      format,
      warnings: exported.warnings || [],
      assets: Math.max(0, writes.length - 1),
    };
  });
}

module.exports = {
  registerDocumentOpenIpcHandlers,
};
