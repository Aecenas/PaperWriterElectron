const RESEARCH_FILE_FILTER = {
  name: "研究资料",
  extensions: [
    "pdf",
    "docx",
    "md",
    "txt",
    "html",
    "htm",
    "png",
    "jpg",
    "jpeg",
    "webp",
  ],
};

function registerWorkspaceResearchIpcHandlers({
  ipcMain,
  app,
  dialog,
  fs,
  path,
  shell,
  researchReadMaxBytes,
  getMainWindow,
  researchFacade,
  assertAuthorizedDirectory,
  ensureWorkspace,
  canonicalExistingPath,
  createResearchSource,
  updateResearchSource,
  deleteResearchSource,
  readResearchSource,
  relinkResearchSource,
  resolveSourceFile,
  listCitationSources,
  upsertCitationSource,
  deleteCitationSource,
}) {
  const {
    listPayload: researchListPayload,
    requireLibrary: requireResearchLibrary,
  } = researchFacade;

  ipcMain.handle("research:list", async (_event, workspacePath) => {
    const rootPath = await assertAuthorizedDirectory(workspacePath);
    await ensureWorkspace(rootPath);
    return { rootPath, ...(await researchListPayload(rootPath)) };
  });

  ipcMain.handle("workspace:identity", async (_event, workspacePath) => {
    const rootPath = await assertAuthorizedDirectory(workspacePath);
    const workspace = await ensureWorkspace(rootPath);
    return {
      workspaceId: workspace.manifest.workspaceId,
      workspaceName: path.basename(rootPath) || "当前工作区",
    };
  });

  ipcMain.handle("research:create", async (_event, workspacePath, source = {}) => {
    const rootPath = await assertAuthorizedDirectory(workspacePath);
    const nextSource = { ...source };
    // This legacy v0.9.5 route remains only for compatibility. Never trust a
    // renderer-provided absolute path: every local file must come from the
    // privileged system picker, just like the v0.9.6 research-library routes.
    delete nextSource.filePath;
    if (nextSource.type === "file") {
      const picked = await dialog.showOpenDialog(getMainWindow(), {
        title: nextSource.storage === "managed"
          ? "选择要托管的研究资料"
          : "选择工作区内的研究资料",
        defaultPath: nextSource.storage === "managed"
          ? app.getPath("documents")
          : rootPath,
        properties: ["openFile"],
        filters: [RESEARCH_FILE_FILTER],
      });
      if (picked.canceled || !picked.filePaths?.[0]) {
        return { canceled: true };
      }
      nextSource.filePath = await canonicalExistingPath(
        picked.filePaths[0],
        "file",
      );
    }
    const created = await createResearchSource(rootPath, nextSource);
    return {
      canceled: false,
      source: created,
      ...(await researchListPayload(rootPath)),
    };
  });

  ipcMain.handle("research:update", async (_event, workspacePath, sourceId, patch = {}) => {
    const rootPath = await assertAuthorizedDirectory(workspacePath);
    const source = await updateResearchSource(
      rootPath,
      sourceId,
      patch,
    );
    return { source, ...(await researchListPayload(rootPath)) };
  });

  ipcMain.handle("research:delete", async (_event, workspacePath, sourceId) => {
    const rootPath = await assertAuthorizedDirectory(workspacePath);
    await deleteResearchSource(rootPath, sourceId);
    return { ok: true, ...(await researchListPayload(rootPath)) };
  });

  ipcMain.handle("research:relink", async (_event, workspacePath, sourceId) => {
    const rootPath = await assertAuthorizedDirectory(workspacePath);
    const previous = await readResearchSource(rootPath, sourceId);
    if (previous.type !== "file") {
      throw new Error("只有本地文件资料可以重新定位");
    }
    const picked = await dialog.showOpenDialog(getMainWindow(), {
      title: "重新定位研究资料",
      defaultPath: previous.storage === "managed"
        ? app.getPath("documents")
        : rootPath,
      properties: ["openFile"],
      filters: [RESEARCH_FILE_FILTER],
    });
    if (picked.canceled || !picked.filePaths?.[0]) {
      return { canceled: true };
    }
    const filePath = await canonicalExistingPath(
      picked.filePaths[0],
      "file",
    );
    const source = await relinkResearchSource(rootPath, sourceId, filePath);
    return {
      canceled: false,
      source,
      ...(await researchListPayload(rootPath)),
    };
  });

  ipcMain.handle("research:read-file", async (_event, workspacePath, sourceId) => {
    const rootPath = await assertAuthorizedDirectory(workspacePath);
    const source = await readResearchSource(rootPath, sourceId);
    if (source.type !== "file") {
      throw new Error("该资料不是本地文件");
    }
    const resolved = await resolveSourceFile(rootPath, source);
    const filePath = resolved.filePath;
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > researchReadMaxBytes) {
      throw new Error("研究资料过大，无法内嵌读取；请使用系统应用打开");
    }
    return {
      source,
      bytes: await fs.readFile(filePath),
      size: stat.size,
    };
  });

  ipcMain.handle("research:open-external", async (_event, workspacePath, sourceId) => {
    if (
      workspacePath
      && typeof workspacePath === "object"
      && !Array.isArray(workspacePath)
    ) {
      return requireResearchLibrary().openEntryExternal(
        workspacePath.libraryId,
        workspacePath.relativePath,
        shell.openPath.bind(shell),
      );
    }
    const rootPath = await assertAuthorizedDirectory(workspacePath);
    const source = await readResearchSource(rootPath, sourceId);
    if (source.type === "web") {
      let url;
      try {
        url = new URL(source.url);
      } catch {
        throw new Error("资料网址无效");
      }
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("资料网址协议不受支持");
      }
      await shell.openExternal(url.href);
      return { ok: true };
    }
    if (source.type !== "file") return { ok: false };
    const resolved = await resolveSourceFile(rootPath, source);
    const error = await shell.openPath(resolved.filePath);
    return { ok: !error, error };
  });

  ipcMain.handle("citation:list", async (_event, workspacePath) => {
    const rootPath = await assertAuthorizedDirectory(workspacePath);
    return { rootPath, ...(await listCitationSources(rootPath)) };
  });

  ipcMain.handle("citation:upsert", async (_event, workspacePath, source = {}) => {
    const rootPath = await assertAuthorizedDirectory(workspacePath);
    const saved = await upsertCitationSource(rootPath, source);
    return {
      source: saved,
      rootPath,
      ...(await listCitationSources(rootPath)),
    };
  });

  ipcMain.handle("citation:delete", async (_event, workspacePath, sourceId) => {
    const rootPath = await assertAuthorizedDirectory(workspacePath);
    const deleted = await deleteCitationSource(rootPath, sourceId);
    return {
      ...deleted,
      rootPath,
      ...(await listCitationSources(rootPath)),
    };
  });
}

module.exports = {
  registerWorkspaceResearchIpcHandlers,
};
