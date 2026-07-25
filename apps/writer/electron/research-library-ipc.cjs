async function runResearchSourceMutation(task, revisionConflictCode) {
  try {
    return { ok: true, ...(await task()) };
  } catch (error) {
    if (error?.code !== revisionConflictCode) throw error;
    return {
      ok: false,
      conflict: true,
      code: revisionConflictCode,
      message: error?.message || "资料来源已被外部修改",
      expectedRevision: error?.expectedRevision || null,
      actualRevision: error?.actualRevision || null,
    };
  }
}

function registerResearchLibraryIpcHandlers({
  ipcMain,
  app,
  clipboard,
  dialog,
  fs,
  path,
  platform,
  shell,
  revisionConflictCode,
  getMainWindow,
  researchFacade,
  ensureWorkspace,
  normalizeWebScopeKey,
  assertAuthorizedDirectory,
  listResearchSources,
  importLegacyResearch,
  resolveSourceFile,
  markdownToHtml,
  sanitizeImportedHtml,
  documentModel,
  authorizeDocumentPath,
  storageFacade,
  writeDebugLog,
}) {
  const {
    decodePreviewText: decodeResearchPreviewText,
    getActiveWorkspaceRoot,
    requireLibrary: requireResearchLibrary,
    sendEvent: sendResearchEvent,
  } = researchFacade;
  const {
    autosaveSessionIdForPath,
    importDocument,
    loadPaperDocumentSnapshot,
  } = storageFacade;
  const { isSupportedDocument } = documentModel;
  const mutateSource = (task) => runResearchSourceMutation(task, revisionConflictCode);

  ipcMain.handle("research:root-get", async () => (
    requireResearchLibrary().getRoot()
  ));

  ipcMain.handle("research:root-pick", async () => {
    const previous = requireResearchLibrary().getRoot();
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: "选择资料目录",
      defaultPath: previous.rootPath || app.getPath("documents"),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { canceled: true, ...previous };
    }
    const selected = await requireResearchLibrary().selectRoot(result.filePaths[0]);
    return { canceled: false, ...selected };
  });

  ipcMain.handle("research:root-clear", async () => (
    requireResearchLibrary().clearRoot()
  ));

  ipcMain.handle("research:folder-list", async (_event, payload = {}) => (
    requireResearchLibrary().listFolder(
      payload.libraryId,
      payload.relativePath || "",
    )
  ));

  ipcMain.handle("research:folder-create", async (_event, payload = {}) => (
    requireResearchLibrary().createFolder(
      payload.libraryId,
      payload.parentRelativePath || "",
      payload.name || "",
    )
  ));

  ipcMain.handle("research:file-import", async (_event, payload = {}) => {
    const library = requireResearchLibrary();
    // Validate the capability and target before showing a privileged file picker.
    await library.listFolder(
      payload.libraryId,
      payload.targetRelativePath || "",
    );
    const picked = await dialog.showOpenDialog(getMainWindow(), {
      title: "导入资料文件",
      defaultPath: app.getPath("documents"),
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "所有资料文件", extensions: ["*"] }],
    });
    if (picked.canceled || !picked.filePaths?.length) {
      return {
        canceled: true,
        libraryId: payload.libraryId || "",
        targetRelativePath: payload.targetRelativePath || "",
        imported: [],
      };
    }
    return library.importFiles(
      payload.libraryId,
      payload.targetRelativePath || "",
      picked.filePaths,
    );
  });

  ipcMain.handle("research:entry-rename", async (_event, payload = {}) => (
    requireResearchLibrary().renameEntry(
      payload.libraryId,
      payload.relativePath,
      payload.nextName,
    )
  ));

  ipcMain.handle("research:entry-move", async (_event, payload = {}) => (
    requireResearchLibrary().moveEntry(
      payload.libraryId,
      payload.relativePath,
      payload.targetFolderRelativePath || "",
    )
  ));

  ipcMain.handle("research:entry-trash", async (_event, payload = {}) => (
    requireResearchLibrary().trashEntry(
      payload.libraryId,
      payload.relativePath,
      shell.trashItem?.bind(shell),
    )
  ));

  ipcMain.handle("research:entry-show", async (_event, payload = {}) => (
    requireResearchLibrary().showEntry(
      payload.libraryId,
      payload.relativePath || "",
      shell.showItemInFolder?.bind(shell),
    )
  ));

  ipcMain.handle("research:entry-copy-path", async (_event, payload = {}) => {
    const resolved = await requireResearchLibrary().copyEntryPath(
      payload.libraryId,
      payload.relativePath || "",
    );
    clipboard.writeText(resolved.path);
    return {
      ok: true,
      libraryId: resolved.libraryId,
      relativePath: resolved.relativePath,
    };
  });

  ipcMain.handle("research:source-list", async (_event, payload = {}) => (
    requireResearchLibrary().listSources(payload.libraryId)
  ));

  ipcMain.handle("research:source-upsert", async (_event, payload = {}) => (
    mutateSource(() => requireResearchLibrary().upsertSource(
      payload.libraryId,
      payload.source || {},
      payload.expectedRevision || null,
    ))
  ));

  ipcMain.handle("research:source-delete", async (_event, payload = {}) => (
    mutateSource(() => requireResearchLibrary().deleteSource(
      payload.libraryId,
      payload.sourceId,
      payload.expectedRevision || null,
    ))
  ));

  ipcMain.handle("research:web-tree-list", async (_event, payload = {}) => (
    requireResearchLibrary().listWebTree(payload.libraryId)
  ));

  ipcMain.handle("research:web-folder-create", async (_event, payload = {}) => (
    mutateSource(() => requireResearchLibrary().createWebFolder(
      payload.libraryId,
      payload.folder || {},
      payload.expectedRevision || null,
    ))
  ));

  ipcMain.handle("research:web-folder-update", async (_event, payload = {}) => (
    mutateSource(() => requireResearchLibrary().updateWebFolder(
      payload.libraryId,
      payload.folder || {},
      payload.expectedRevision || null,
    ))
  ));

  ipcMain.handle("research:web-folder-delete", async (_event, payload = {}) => (
    mutateSource(() => requireResearchLibrary().deleteWebFolder(
      payload.libraryId,
      payload.folderId,
      payload.expectedRevision || null,
    ))
  ));

  ipcMain.handle("research:web-source-move", async (_event, payload = {}) => (
    mutateSource(() => requireResearchLibrary().moveWebSource(
      payload.libraryId,
      payload.sourceId,
      payload.placement || {},
      payload.expectedRevision || null,
    ))
  ));

  ipcMain.handle("research:web-selection-copy", async (_event, payload = {}) => (
    mutateSource(async () => {
      const activeWorkspaceRoot = getActiveWorkspaceRoot();
      if (!activeWorkspaceRoot) {
        throw new Error("当前没有打开的写作工作区");
      }
      const workspace = await ensureWorkspace(activeWorkspaceRoot);
      const selection = payload.selection && typeof payload.selection === "object"
        ? payload.selection
        : {};
      const targetScopeKey = normalizeWebScopeKey(selection.targetScopeKey);
      if (
        targetScopeKey
        !== `workspace:${String(
          workspace.manifest.workspaceId || "",
        ).toLocaleLowerCase("en-US")}`
      ) {
        throw new Error("只能复制到当前打开工作区的私区");
      }
      return requireResearchLibrary().copyWebSelection(payload.libraryId, {
        ...selection,
        targetScopeKey,
      });
    })
  ));

  ipcMain.handle("research:web-source-upsert", async (_event, payload = {}) => (
    mutateSource(async () => {
      const library = requireResearchLibrary();
      const revisions = payload.revisions && typeof payload.revisions === "object"
        ? payload.revisions
        : {};
      const saved = await library.upsertSource(
        payload.libraryId,
        payload.source || {},
        revisions.source || null,
      );
      try {
        const tree = await library.moveWebSource(
          payload.libraryId,
          saved.source.id,
          payload.placement || { scopeKey: "global", folderId: "" },
          revisions.tree || null,
        );
        return { ...saved, tree, placementFallback: false };
      } catch (error) {
        return {
          ...saved,
          tree: await library.listWebTree(payload.libraryId),
          placementFallback: true,
          warning: error?.code === revisionConflictCode
            ? "网页已保存，但分组索引发生冲突；新网页暂时回退到全局未分组。"
            : `网页已保存，但分组位置未能写入：${error?.message || "未知错误"}`,
        };
      }
    })
  ));

  ipcMain.handle("research:legacy-import", async (_event, payload = {}) => {
    const workspacePath = await assertAuthorizedDirectory(payload.workspacePath);
    const workspaceKey = platform === "win32"
      ? workspacePath.toLocaleLowerCase("en-US")
      : workspacePath;
    const activeWorkspaceRoot = getActiveWorkspaceRoot();
    const activeWorkspaceKey = platform === "win32"
      ? activeWorkspaceRoot.toLocaleLowerCase("en-US")
      : activeWorkspaceRoot;
    if (!activeWorkspaceKey || workspaceKey !== activeWorkspaceKey) {
      throw new Error("只能从左侧文件区当前打开的写作工作区导入旧资料库");
    }
    const library = requireResearchLibrary();
    // Validate the target capability before reading anything from the legacy workspace.
    await library.listSources(payload.libraryId);
    const legacy = await listResearchSources(workspacePath);
    return importLegacyResearch({
      manager: library,
      libraryId: payload.libraryId,
      workspaceId: legacy.workspaceId,
      sources: legacy.sources,
      warnings: legacy.warnings,
      resolveFile: (source) => resolveSourceFile(workspacePath, source),
    });
  });

  ipcMain.handle("research:pdf-read", async (_event, payload = {}) => (
    requireResearchLibrary().readPdf(payload.libraryId, payload.relativePath)
  ));

  ipcMain.handle("research:preview-read", async (_event, payload = {}) => {
    const preview = await requireResearchLibrary().readPreview(
      payload.libraryId,
      payload.relativePath,
    );
    const common = {
      libraryId: preview.libraryId,
      relativePath: preview.relativePath,
      name: preview.name,
      previewKind: preview.previewKind,
      mime: preview.mime,
      size: preview.size,
      diskRevision: preview.diskRevision,
    };
    if (preview.previewKind === "image") {
      return { ...common, bytes: preview.bytes };
    }
    if (preview.previewKind === "docx") {
      const imported = await importDocument({
        format: "docx",
        sourcePath: preview.path,
        buffer: preview.bytes,
      });
      return {
        ...common,
        html: imported.document.html,
        warnings: imported.warnings || [],
      };
    }
    const text = decodeResearchPreviewText(preview.bytes);
    if (preview.previewKind !== "markdown") return { ...common, text };
    const converted = markdownToHtml(text);
    const sanitized = await sanitizeImportedHtml(converted.html, {
      sourcePath: preview.path,
      fsApi: fs,
      pathApi: path,
    });
    return {
      ...common,
      html: sanitized.html,
      warnings: sanitized.warnings || [],
    };
  });

  ipcMain.handle("research:document-open", async (_event, payload = {}) => {
    const resolved = await requireResearchLibrary().copyEntryPath(
      payload.libraryId,
      payload.relativePath,
    );
    if (!isSupportedDocument(resolved.path)) {
      throw new Error("该资料不是笺间文档");
    }
    const filePath = await authorizeDocumentPath(resolved.path);
    const metrics = {};
    const loaded = await loadPaperDocumentSnapshot(filePath, metrics);
    const recoveryId = autosaveSessionIdForPath(filePath);
    void writeDebugLog("research:document-open:loaded", {
      filePath,
      ...metrics,
    });
    return {
      canceled: false,
      path: filePath,
      document: loaded.document,
      diskRevision: loaded.diskRevision,
      readOnly: Boolean(loaded.document._readOnlyFutureSchema),
      ...(recoveryId ? { recoveryId } : {}),
    };
  });

  ipcMain.handle("research:watch", async (_event, payload = {}) => (
    requireResearchLibrary().watchLibrary(payload.libraryId, {
      onChange: (change) => sendResearchEvent("research:changed", change),
      onError: (error) => sendResearchEvent("research:watch-error", error),
    })
  ));
}

module.exports = {
  registerResearchLibraryIpcHandlers,
  runResearchSourceMutation,
};
