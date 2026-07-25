const WORKSPACE_SEARCH_CACHE_FOLDER = "workspace-search";

function createWorkspaceRuntime({
  filesystemAccess,
  fs,
  nativeFs,
  path,
  platform = process.platform,
  createHash,
  createWorkspaceSearchIndex,
  walkWorkspaceDocuments,
  readSearchDocument,
  normalizeDocumentId,
  isWorkspaceRelationshipCandidate,
  mapWithConcurrency,
  isPathInside,
  isSupportedDocument,
  isReservedWorkspaceMetadataPath,
  randomUUID,
  getUserDataPath,
  getRendererWebContents,
  sendRendererEvent,
  writeDebugLog,
  now = Date.now,
  createDate = () => new Date(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  const workspaceSearchIndexes = new Map();
  let activeWorkspaceWatcher = null;
  let activeWorkspaceWatchRoot = "";
  let activeWorkspaceWatchTimer = null;
  let activeWorkspaceWatchGeneration = 0;
  let activeWorkspaceWatchContext = null;

  function workspaceSearchCachePath(rootPath) {
    const key = createHash("sha256")
      .update(path.resolve(rootPath))
      .digest("hex");
    return path.join(
      getUserDataPath(),
      WORKSPACE_SEARCH_CACHE_FOLDER,
      `${key}.json`,
    );
  }

  function workspaceSearchKey(rootPath) {
    return platform === "win32"
      ? rootPath.toLocaleLowerCase("en-US")
      : rootPath;
  }

  async function getWorkspaceSearchIndex(
    folderPath,
    { refresh = false } = {},
  ) {
    const rootPath = await filesystemAccess.assertAuthorizedDirectory(
      folderPath,
    );
    const key = workspaceSearchKey(rootPath);
    let index = workspaceSearchIndexes.get(key);
    if (!index) {
      index = createWorkspaceSearchIndex({
        rootPath,
        cachePath: workspaceSearchCachePath(rootPath),
      });
      workspaceSearchIndexes.set(key, index);
      await index.initialize();
    } else if (refresh) {
      await index.refresh();
    }
    return { index, rootPath };
  }

  async function search(payload = {}) {
    const folderPath = String(payload.folderPath || "");
    if (!folderPath) {
      return {
        requestId: payload.requestId || "",
        query: "",
        canceled: false,
        results: [],
        totalMatches: 0,
      };
    }
    const { index } = await getWorkspaceSearchIndex(folderPath, {
      refresh: Boolean(payload.refresh),
    });
    return index.search(payload.query, {
      requestId: String(payload.requestId || randomUUID()).slice(0, 128),
      limit: Math.min(200, Math.max(1, Number(payload.limit) || 100)),
      overrides: Array.isArray(payload.overrides)
        ? payload.overrides.slice(0, 100)
        : [],
    });
  }

  async function cancelSearch(folderPath, requestId) {
    if (!folderPath || !requestId) return false;
    const rootPath = await filesystemAccess.assertAuthorizedDirectory(
      folderPath,
    );
    return Boolean(
      workspaceSearchIndexes
        .get(workspaceSearchKey(rootPath))
        ?.cancel(String(requestId)),
    );
  }

  async function relationships(payload = {}) {
    const rootPath = await filesystemAccess.assertAuthorizedDirectory(
      payload.folderPath,
    );
    const walked = await walkWorkspaceDocuments(rootPath);
    const overrideByPath = new Map(
      (Array.isArray(payload.overrides) ? payload.overrides : [])
        .slice(0, 100)
        .filter(
          (item) => (
            item?.path
            && item?.document
            && isPathInside(rootPath, item.path)
          ),
        )
        .map((item) => [
          platform === "win32"
            ? path.resolve(item.path).toLocaleLowerCase("en-US")
            : path.resolve(item.path),
          item.document,
        ]),
    );
    const records = (
      await mapWithConcurrency(
        walked.documents,
        8,
        async (filePath) => {
          try {
            const key = platform === "win32"
              ? path.resolve(filePath).toLocaleLowerCase("en-US")
              : path.resolve(filePath);
            const document = overrideByPath.get(key)
              || await readSearchDocument(filePath);
            const documentId = normalizeDocumentId(document.documentId);
            const links = [
              ...String(document.html || "").matchAll(
                /data-document-id=["']([0-9a-f-]{36})["']/gi,
              ),
            ]
              .map((match) => normalizeDocumentId(match[1]))
              .filter(Boolean);
            return {
              documentId,
              needsIdentity: !documentId,
              title: typeof document.title === "string"
                ? document.title.slice(0, 200)
                : path.basename(filePath, path.extname(filePath)),
              path: filePath,
              relativePath: path.relative(rootPath, filePath),
              links: [...new Set(links)],
            };
          } catch {
            return null;
          }
        },
      )
    ).filter(Boolean);
    const byId = new Map();
    records.forEach((record) => {
      if (!record.documentId) return;
      const group = byId.get(record.documentId) || [];
      group.push(record);
      byId.set(record.documentId, group);
    });
    const currentId = normalizeDocumentId(payload.documentId);
    const currentLinks = (
      Array.isArray(payload.currentLinks) ? payload.currentLinks : []
    )
      .slice(0, 5000)
      .map((link) => ({
        ...link,
        targetDocumentId: normalizeDocumentId(
          link?.targetDocumentId || link?.documentId,
        ),
      }))
      .filter((link) => link.targetDocumentId);
    const resolvedLinks = currentLinks.map((link) => {
      const target = byId.get(link.targetDocumentId)?.[0];
      return {
        ...link,
        documentId: link.targetDocumentId,
        targetDocumentId: link.targetDocumentId,
        title: target?.title || link.title || "未知笺记",
        path: target?.path || "",
        relativePath: target?.relativePath || "",
        missing: !target,
      };
    });
    return {
      rootPath,
      documents: records
        .filter(
          (record) => isWorkspaceRelationshipCandidate(record, {
            currentDocumentId: currentId,
            currentPath: payload.currentPath,
          }),
        )
        .map(({ links: _links, ...record }) => record),
      links: resolvedLinks,
      backlinks: currentId
        ? records
          .filter(
            (record) => (
              record.documentId !== currentId
              && record.links.includes(currentId)
            ),
          )
          .map(({ links: _links, ...record }) => record)
        : [],
      duplicates: [...byId.values()]
        .filter((group) => group.length > 1)
        .flatMap(
          (group) => (
            group
              .slice(1)
              .map(({ links: _links, ...record }) => record)
          ),
        ),
    };
  }

  function isCurrentWorkspaceWatch(context) {
    return Boolean(
      context
      && context === activeWorkspaceWatchContext
      && context.generation === activeWorkspaceWatchGeneration
      && context.watcher === activeWorkspaceWatcher
      && context.rootPath === activeWorkspaceWatchRoot,
    );
  }

  function stopWatcher({ invalidatePending = true } = {}) {
    if (invalidatePending) activeWorkspaceWatchGeneration += 1;
    if (activeWorkspaceWatchTimer) {
      clearTimeoutFn(activeWorkspaceWatchTimer);
      activeWorkspaceWatchTimer = null;
    }
    activeWorkspaceWatcher?.close?.();
    activeWorkspaceWatcher = null;
    activeWorkspaceWatchRoot = "";
    activeWorkspaceWatchContext = null;
  }

  async function startWatcher(folderPath) {
    const generation = activeWorkspaceWatchGeneration + 1;
    activeWorkspaceWatchGeneration = generation;
    const rootPath = await filesystemAccess.assertAuthorizedDirectory(
      folderPath,
    );
    if (generation !== activeWorkspaceWatchGeneration) return rootPath;
    if (
      activeWorkspaceWatcher
      && activeWorkspaceWatchRoot === rootPath
      && activeWorkspaceWatchContext
    ) {
      activeWorkspaceWatchContext.generation = generation;
      return rootPath;
    }
    stopWatcher({ invalidatePending: false });
    // This is also the main-process identity of the currently open writing
    // workspace. Keep it even when the host cannot provide recursive watching.
    activeWorkspaceWatchRoot = rootPath;
    try {
      const context = {
        generation,
        rootPath,
        watcher: null,
      };
      let nextWatcher = null;
      nextWatcher = nativeFs.watch(
        rootPath,
        { recursive: true, encoding: "utf8" },
        (eventType, fileName) => {
          if (!isCurrentWorkspaceWatch(context)) return;
          if (activeWorkspaceWatchTimer) {
            clearTimeoutFn(activeWorkspaceWatchTimer);
          }
          let nextTimer = null;
          nextTimer = setTimeoutFn(async () => {
            if (activeWorkspaceWatchTimer === nextTimer) {
              activeWorkspaceWatchTimer = null;
            }
            if (!isCurrentWorkspaceWatch(context)) return;
            try {
              const { index } = await getWorkspaceSearchIndex(rootPath);
              if (!isCurrentWorkspaceWatch(context)) return;
              await index.refresh();
            } catch (error) {
              if (!isCurrentWorkspaceWatch(context)) return;
              await writeDebugLog("workspace:watch:refresh-error", {
                rootPath,
                message: error?.message,
              });
            }
            if (!isCurrentWorkspaceWatch(context)) return;
            sendRendererEvent(
              getRendererWebContents(),
              "workspace:changed",
              {
                rootPath,
                eventType: String(eventType || "change"),
                relativePath: typeof fileName === "string"
                  ? fileName.slice(0, 32768)
                  : "",
                changedAt: createDate().toISOString(),
              },
            );
          }, 180);
          activeWorkspaceWatchTimer = nextTimer;
          nextTimer.unref?.();
        },
      );
      context.watcher = nextWatcher;
      activeWorkspaceWatcher = nextWatcher;
      activeWorkspaceWatchContext = context;
      nextWatcher.on?.("error", (error) => {
        if (!isCurrentWorkspaceWatch(context)) return;
        void writeDebugLog("workspace:watch:error", {
          rootPath,
          message: error?.message,
        });
        if (!isCurrentWorkspaceWatch(context)) return;
        sendRendererEvent(
          getRendererWebContents(),
          "workspace:watch-error",
          {
            rootPath,
            message: error?.message || "文件监听失败",
          },
        );
      });
    } catch (error) {
      await writeDebugLog("workspace:watch:unavailable", {
        rootPath,
        message: error?.message,
      });
      return rootPath;
    }
    return rootPath;
  }

  function getActiveRoot() {
    return activeWorkspaceWatchRoot;
  }

  async function listFolder(folderPath) {
    const startedAt = now();
    if (!folderPath) {
      await writeDebugLog("folder:list:empty-path");
      return { canceled: true, files: [], folders: [], entries: [] };
    }
    try {
      void writeDebugLog("folder:list:start", { folderPath });
      const authorizedPath = await filesystemAccess.assertAuthorizedDirectory(
        folderPath,
      );
      const listed = await listFolderEntries(authorizedPath);
      void writeDebugLog("folder:list:success", {
        folderPath,
        ms: now() - startedAt,
        folders: listed.folders.length,
        files: listed.files.length,
      });
      return { canceled: false, ...listed };
    } catch (error) {
      await writeDebugLog("folder:list:error", {
        folderPath,
        ms: now() - startedAt,
        name: error?.name,
        code: error?.code,
        message: error?.message,
      });
      return {
        canceled: true,
        folderPath: "",
        files: [],
        folders: [],
        entries: [],
      };
    }
  }

  async function listAuthorizedFolderEntries(folderPath) {
    if (!filesystemAccess.canAccessDirectory(folderPath)) {
      return {
        folderPath: "",
        parentPath: "",
        folders: [],
        files: [],
        entries: [],
      };
    }
    return listFolderEntries(folderPath);
  }

  async function listFolderEntries(folderPath) {
    if (isReservedWorkspaceMetadataPath(folderPath)) {
      throw new Error(".jianjian 是工作区内部目录");
    }
    const startedAt = now();
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    if (entries.length > 20000) {
      throw new Error(
        "这个文件夹包含过多项目，请选择更具体的信笺文件夹",
      );
    }
    void writeDebugLog("folder:entries:readdir", {
      folderPath,
      ms: now() - startedAt,
      count: entries.length,
    });
    const parent = path.dirname(folderPath);
    const parentPath = (
      parent
      && parent !== folderPath
      && filesystemAccess.canAccessDirectory(parent)
    )
      ? parent
      : "";
    const folders = [];
    const fileReads = [];
    for (const entry of entries) {
      if (entry.name.toLocaleLowerCase("en-US") === ".jianjian") continue;
      const filePath = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        folders.push({
          type: "folder",
          name: entry.name,
          path: filePath,
          hasLetterpapers: null,
          updatedAt: "",
        });
        continue;
      }
      if (!entry.isFile() || !isSupportedDocument(filePath)) continue;
      fileReads.push({ entry, filePath });
    }

    const files = await mapWithConcurrency(
      fileReads,
      32,
      async ({ entry, filePath }) => {
        try {
          const stat = await fs.stat(filePath);
          const displayName = path.basename(
            entry.name,
            path.extname(entry.name),
          );
          return {
            type: "file",
            name: entry.name,
            displayName,
            path: filePath,
            extension: path.extname(entry.name).toLowerCase(),
            updatedAt: stat.mtime.toISOString(),
            size: stat.size,
          };
        } catch (error) {
          await writeDebugLog("folder:file-stat:error", {
            filePath,
            code: error?.code,
            message: error?.message,
          });
          return null;
        }
      },
    );
    const readableFiles = files.filter(Boolean);
    folders.sort(
      (left, right) => left.name.localeCompare(right.name, "zh-CN"),
    );
    readableFiles.sort(
      (left, right) => (
        left.displayName.localeCompare(right.displayName, "zh-CN")
      ),
    );
    return {
      folderPath,
      parentPath,
      folders,
      files: readableFiles,
      entries: [...folders, ...readableFiles],
    };
  }

  function shutdown() {
    stopWatcher();
  }

  const facade = Object.freeze({
    cancelSearch,
    listAuthorizedFolderEntries,
    listFolder,
    listFolderEntries,
    relationships,
    search,
    startWatcher,
    stopWatcher,
  });

  return {
    facade,
    getActiveRoot,
    shutdown,
  };
}

module.exports = {
  createWorkspaceRuntime,
};
