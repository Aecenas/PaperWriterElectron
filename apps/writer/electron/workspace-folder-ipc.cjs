function registerWorkspaceFolderIpcHandlers({
  ipcMain,
  app,
  clipboard,
  dialog,
  filesystemRuntime,
  workspaceFacade,
  fs,
  path,
  shell,
  documentModel,
  getMainWindow,
  assertMutableWorkspaceEntry,
  uniquePath,
  storageFacade,
}) {
  const {
    DOCUMENT_EXTENSION: documentExtension,
    LEGACY_DOCUMENT_EXTENSION: legacyDocumentExtension,
    isSupportedDocument,
    sanitizeName,
  } = documentModel;
  const { runDocumentTransaction } = storageFacade;
  const {
    assertAuthorizedDirectory,
    assertAuthorizedEntry,
    authorizeFilesystemRoot,
    rebaseFilesystemAccess,
    revokeFilesystemAccess,
  } = filesystemRuntime;
  const {
    cancelSearch,
    listAuthorizedFolderEntries,
    listFolder,
    listFolderEntries,
    relationships,
    search,
    startWatcher,
    stopWatcher,
  } = workspaceFacade;

  ipcMain.handle(
    "folder:search",
    async (_event, payload = {}) => search(payload),
  );

  ipcMain.handle("folder:search-cancel", async (_event, folderPath, requestId) => {
    return { ok: Boolean(await cancelSearch(folderPath, requestId)) };
  });

  ipcMain.handle(
    "workspace:relationships",
    async (_event, payload = {}) => relationships(payload),
  );

  ipcMain.handle("workspace:watch", async (_event, folderPath) => {
    if (!folderPath) {
      stopWatcher();
      return { ok: true, rootPath: "" };
    }
    return { ok: true, rootPath: await startWatcher(folderPath) };
  });

  ipcMain.handle("folder:open", async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: "打开信笺文件夹",
      defaultPath: app.getPath("desktop"),
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || !result.filePaths?.[0]) {
      return { canceled: true };
    }

    const folderPath = await authorizeFilesystemRoot(result.filePaths[0]);
    return { canceled: false, ...(await listFolderEntries(folderPath)) };
  });

  ipcMain.handle(
    "folder:list",
    async (_event, folderPath) => listFolder(folderPath),
  );

  ipcMain.handle("folder:copy-path", async (_event, folderPath) => {
    if (!folderPath) return { ok: false };
    const authorizedPath = await assertAuthorizedDirectory(folderPath);
    clipboard.writeText(authorizedPath);
    return { ok: true };
  });

  ipcMain.handle("folder:show", async (_event, folderPath) => {
    if (!folderPath) return { ok: false };
    const authorizedPath = await assertAuthorizedDirectory(folderPath);
    const error = await shell.openPath(authorizedPath);
    return { ok: !error, error };
  });

  ipcMain.handle("folder:create", async (_event, parentPath, name) => {
    if (!parentPath) return { ok: false, message: "缺少目标文件夹" };
    const authorizedParent = await assertAuthorizedDirectory(parentPath);
    const folderName = sanitizeName(name, "新建文件夹");
    if (folderName.toLocaleLowerCase("en-US") === ".jianjian") {
      throw new Error("该名称由笺间工作区保留");
    }
    const targetPath = await uniquePath(path.join(authorizedParent, folderName));
    assertMutableWorkspaceEntry(authorizedParent);
    assertMutableWorkspaceEntry(targetPath);
    await fs.mkdir(targetPath, { recursive: false });
    return {
      ok: true,
      path: targetPath,
      ...(await listFolderEntries(authorizedParent)),
    };
  });

  ipcMain.handle("entry:rename", async (_event, targetPath, nextName) => {
    if (!targetPath) return { ok: false, message: "缺少目标路径" };
    return runDocumentTransaction(async (transaction) => {
      const authorizedEntry = await assertAuthorizedEntry(targetPath, {
        destructive: true,
      });
      const currentPath = authorizedEntry.path;
      assertMutableWorkspaceEntry(currentPath);
      const stat = authorizedEntry.stat;
      const parsed = path.parse(currentPath);
      let safeName = sanitizeName(nextName, parsed.name);
      if (stat.isFile() && isSupportedDocument(currentPath)) {
        const typedExtension = path.extname(safeName).toLowerCase();
        if (
          typedExtension === documentExtension
          || typedExtension === legacyDocumentExtension
        ) {
          safeName = path.basename(safeName, typedExtension);
        }
      }
      const nextPath = path.join(
        parsed.dir,
        stat.isFile() && isSupportedDocument(currentPath)
          ? `${safeName}${documentExtension}`
          : safeName,
      );
      assertMutableWorkspaceEntry(nextPath);
      if (nextPath === currentPath) {
        return {
          ok: true,
          path: currentPath,
          ...(await listAuthorizedFolderEntries(parsed.dir)),
        };
      }
      try {
        await fs.access(nextPath);
        return { ok: false, message: "同名项目已经存在" };
      } catch {
        await fs.rename(currentPath, nextPath);
        transaction.rebaseDocumentPath(
          currentPath,
          nextPath,
        );
        await rebaseFilesystemAccess(currentPath, nextPath);
        return {
          ok: true,
          oldPath: currentPath,
          path: nextPath,
          ...(await listAuthorizedFolderEntries(parsed.dir)),
        };
      }
    });
  });

  ipcMain.handle("entry:delete", async (_event, targetPath) => {
    if (!targetPath) return { ok: false, message: "缺少目标路径" };
    return runDocumentTransaction(async (transaction) => {
      const authorizedEntry = await assertAuthorizedEntry(targetPath, {
        destructive: true,
      });
      const currentPath = authorizedEntry.path;
      assertMutableWorkspaceEntry(currentPath);
      const parentPath = path.dirname(currentPath);
      if (typeof shell.trashItem === "function") {
        await shell.trashItem(currentPath);
      } else {
        await fs.rm(currentPath, {
          recursive: authorizedEntry.stat.isDirectory(),
          force: true,
        });
      }
      transaction.invalidateDocumentPath(
        currentPath,
        true,
        { revokeReferences: true },
      );
      await revokeFilesystemAccess(
        currentPath,
        authorizedEntry.stat.isDirectory(),
      );
      return {
        ok: true,
        deletedPath: currentPath,
        ...(await listAuthorizedFolderEntries(parentPath)),
      };
    });
  });

  ipcMain.handle("entry:move", async (_event, sourcePath, targetFolderPath) => {
    if (!sourcePath || !targetFolderPath) {
      return { ok: false, message: "缺少移动路径" };
    }
    return runDocumentTransaction(async (transaction) => {
      const authorizedSource = await assertAuthorizedEntry(sourcePath, {
        destructive: true,
      });
      const fromPath = authorizedSource.path;
      const toFolder = await assertAuthorizedDirectory(targetFolderPath);
      assertMutableWorkspaceEntry(fromPath);
      assertMutableWorkspaceEntry(toFolder);
      const sourceStat = authorizedSource.stat;
      if (sourceStat.isDirectory()) {
        const relative = path.relative(fromPath, toFolder);
        if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
          return { ok: false, message: "不能把文件夹移动到自身内部" };
        }
      }

      const sourceParent = path.dirname(fromPath);
      if (sourceParent === toFolder) {
        return { ok: false, message: "已经在这个文件夹里" };
      }

      const targetPath = await uniquePath(
        path.join(toFolder, path.basename(fromPath)),
      );
      await fs.rename(fromPath, targetPath);
      transaction.rebaseDocumentPath(fromPath, targetPath);
      await rebaseFilesystemAccess(fromPath, targetPath);
      return {
        ok: true,
        oldPath: fromPath,
        path: targetPath,
        sourceParent,
        targetFolderPath: toFolder,
      };
    });
  });
}

module.exports = {
  registerWorkspaceFolderIpcHandlers,
};
