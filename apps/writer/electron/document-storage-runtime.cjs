function createDocumentStorageRuntime({
  app,
  fs,
  path,
  platform = process.platform,
  appRoot,
  JSZip,
  createHash,
  randomUUID,
  documentModel,
  assetsFacade,
  archiveLimits,
  assertZipEntryReadable,
  atomicWriteFile,
  createPathWriteQueue,
  preflightZipBuffer,
  readZipEntryBufferLimited,
  validatePaperArchive,
  DocumentRevisionConflictError,
  assertDiskRevision,
  createConflictCopyPath,
  readFileSnapshot,
  readDiskRevision,
  createDocumentInterchange,
  mammoth,
  docx,
  iconvLite,
  readSearchDocument,
  sanitizeFilesystemName,
  writeDebugLog,
  migrationBackupFolder = "migration-backups",
  mutationLockName = ".paperwriter-document-mutation.lock",
  now = Date.now,
}) {
  const {
    DOCUMENT_EXTENSION,
    DOCUMENT_SCHEMA_VERSION,
    isSupportedDocument,
    normalizeDocument,
    timestampForFileName,
  } = documentModel;
  const {
    commitPackagedAssetReferences,
    createPackager,
    invalidateDocumentCachesForPath,
    linkPaperDocument,
    packageAiStateAssets,
    readProtocolAsset,
    rememberAssetZip,
    rebaseAssetPathReferences,
  } = assetsFacade;

  const documentWriteQueue = createPathWriteQueue({
    pathApi: path,
    platform,
  });
  const documentMutationQueue = createPathWriteQueue({
    pathApi: path,
    platform,
  });
  const documentMutationLockKey = path.join(
    appRoot,
    mutationLockName,
  );
  const pendingMutations = new Set();

  let canonicalAutosaveRoot = "";
  let canonicalAutosaveSessionRoot = "";
  let documentInterchange = null;
  let shutdownStarted = false;
  let shutdownComplete = false;
  let shutdownPromise = null;

  function isResolvedPathInside(rootPath, targetPath) {
    const relative = path.relative(rootPath, targetPath);
    return relative === ""
      || (
        !relative.startsWith(`..${path.sep}`)
        && relative !== ".."
        && !path.isAbsolute(relative)
      );
  }

  async function initializeAutosaveStorage() {
    const requestedUserData = path.resolve(
      app.getPath("userData"),
    );
    await fs.mkdir(requestedUserData, { recursive: true });
    const userDataRoot = await fs.realpath(requestedUserData);
    const requestedAutosaveRoot = path.join(
      requestedUserData,
      "Autosave",
    );
    await fs.mkdir(requestedAutosaveRoot, { recursive: true });
    const resolvedAutosaveRoot = await fs.realpath(
      requestedAutosaveRoot,
    );
    if (
      !isResolvedPathInside(
        userDataRoot,
        resolvedAutosaveRoot,
      )
    ) {
      throw new Error(
        "自动保存目录指向应用数据目录之外，已拒绝使用",
      );
    }
    const requestedSessionRoot = path.join(
      resolvedAutosaveRoot,
      "Session",
    );
    await fs.mkdir(requestedSessionRoot, { recursive: true });
    const resolvedSessionRoot = await fs.realpath(
      requestedSessionRoot,
    );
    if (
      !isResolvedPathInside(
        resolvedAutosaveRoot,
        resolvedSessionRoot,
      )
    ) {
      throw new Error(
        "临时会话目录指向自动保存目录之外，已拒绝使用",
      );
    }
    canonicalAutosaveRoot = resolvedAutosaveRoot;
    canonicalAutosaveSessionRoot = resolvedSessionRoot;
    return {
      autosaveRoot: canonicalAutosaveRoot,
      sessionRoot: canonicalAutosaveSessionRoot,
    };
  }

  function initializeDocumentInterchange() {
    if (!documentInterchange) {
      documentInterchange = createDocumentInterchange({
        mammoth,
        docx,
        iconvLite,
        resolveAsset: readProtocolAsset,
      });
    }
    return documentInterchange;
  }

  function requireDocumentInterchange() {
    if (!documentInterchange) {
      throw new Error("文档导入导出服务尚未初始化");
    }
    return documentInterchange;
  }

  function autosavePath() {
    const root = canonicalAutosaveRoot
      || path.join(app.getPath("userData"), "Autosave");
    return path.join(
      root,
      `autosave${DOCUMENT_EXTENSION}`,
    );
  }

  function autosaveSessionPath(tabId = "") {
    const safeId = String(tabId || "");
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(safeId)) {
      throw new Error("无效的临时会话标识");
    }
    const root = canonicalAutosaveSessionRoot
      || path.join(
        app.getPath("userData"),
        "Autosave",
        "Session",
      );
    return path.join(root, `${safeId}${DOCUMENT_EXTENSION}`);
  }

  function autosaveSessionIdForPath(value) {
    const resolved = path.resolve(String(value || ""));
    const sessionRoot = canonicalAutosaveSessionRoot;
    const relative = sessionRoot
      ? path.relative(sessionRoot, resolved)
      : "";
    if (
      !sessionRoot
      || !relative
      || relative.startsWith(`..${path.sep}`)
      || relative === ".."
      || path.isAbsolute(relative)
      || relative.includes(path.sep)
      || path.extname(relative).toLowerCase()
        !== DOCUMENT_EXTENSION
    ) {
      return "";
    }
    const recoveryId = path.basename(
      relative,
      path.extname(relative),
    );
    return /^[a-zA-Z0-9_-]{1,80}$/.test(recoveryId)
      ? recoveryId
      : "";
  }

  async function savePaperDocumentWithinTransaction(
    filePath,
    document,
    { validateTarget, afterCommit } = {},
  ) {
    const targetPath = path.resolve(
      String(filePath || ""),
    );
    if (!targetPath || !isSupportedDocument(targetPath)) {
      throw new Error("无效的信笺保存路径");
    }
    if (
      Number(document?.version || 1)
        > DOCUMENT_SCHEMA_VERSION
      || document?._readOnlyFutureSchema
    ) {
      throw new Error(
        `此信笺使用未来格式 v${Number(document?.version) || "?"}，当前版本只能只读打开`,
      );
    }
    return documentWriteQueue.run(targetPath, async () => {
      if (typeof validateTarget === "function") {
        await validateTarget(targetPath);
      }
      const normalized = normalizeDocument(document);
      const zip = new JSZip();
      const packagedDocument = { ...normalized };
      const packager = createPackager(zip);

      packagedDocument.html = await packager.packageHtml(
        packagedDocument.html,
      );
      if (packagedDocument.customBackground) {
        if (
          /^data:/i.test(packagedDocument.customBackground)
          && !/^data:image\//i.test(
            packagedDocument.customBackground,
          )
        ) {
          throw new Error(
            "自定义背景不是受支持的图片数据，文档未保存",
          );
        }
        packagedDocument.customBackground =
          await packager.packageSource(
            packagedDocument.customBackground,
          );
      }
      packagedDocument.aiState = await packageAiStateAssets(
        packagedDocument.aiState,
        packager,
      );

      const serializedDocument = JSON.stringify(
        packagedDocument,
        null,
        2,
      );
      if (
        Buffer.byteLength(serializedDocument, "utf8")
          > archiveLimits.maxDocumentJsonBytes
      ) {
        throw new Error(
          "信笺正文与元数据超过安全写入上限，文档未保存",
        );
      }
      zip.file("document.json", serializedDocument, {
        compression: "STORE",
      });
      const output = await zip.generateAsync({
        type: "nodebuffer",
        compression: "STORE",
      });
      if (output.length > archiveLimits.maxArchiveBytes) {
        throw new Error(
          "信笺文件超过安全写入上限，文档未保存",
        );
      }
      preflightZipBuffer(output);

      // Asset packaging may yield for long enough that a sync client replaces
      // the target. Validate again at the atomic replacement boundary.
      if (typeof validateTarget === "function") {
        await validateTarget(targetPath);
      }
      await atomicWriteFile(targetPath, output);
      const committedRevision = await readDiskRevision(
        targetPath,
      );
      const outputSha256 = createHash("sha256")
        .update(output)
        .digest("hex");
      if (
        !committedRevision
        || committedRevision.size !== output.length
        || committedRevision.sha256 !== outputSha256
      ) {
        throw new DocumentRevisionConflictError(
          "工作区文件在写入完成后立即被外部版本替换",
          {
            filePath: targetPath,
            expectedRevision: {
              size: output.length,
              mtimeMs:
                committedRevision?.mtimeMs || now(),
              sha256: outputSha256,
            },
            actualRevision: committedRevision,
          },
        );
      }
      commitPackagedAssetReferences(targetPath, packager);
      const result = {
        path: targetPath,
        document: linkPaperDocument(
          targetPath,
          packagedDocument,
        ),
        diskRevision: committedRevision,
      };
      if (typeof afterCommit === "function") {
        await afterCommit(result);
      }
      return result;
    });
  }

  async function loadPaperDocumentSnapshot(
    filePath,
    metrics = null,
  ) {
    const startedAt = now();
    const sourcePath = path.resolve(String(filePath || ""));
    const snapshot = await readFileSnapshot(sourcePath, {
      maxBytes: archiveLimits.maxArchiveBytes,
    });
    if (!snapshot) {
      throw new Error("信笺文件不存在或已被移动");
    }
    const {
      buffer,
      revision: diskRevision,
      stat: sourceStat,
    } = snapshot;
    if (metrics) {
      metrics.readMs = now() - startedAt;
      metrics.fileBytes = buffer.byteLength;
    }
    const zipStartedAt = now();
    preflightZipBuffer(buffer);
    const zip = await JSZip.loadAsync(buffer);
    validatePaperArchive(zip, {
      archiveBytes: buffer.length,
    });
    rememberAssetZip(sourcePath, sourceStat, zip);
    if (metrics) {
      metrics.zipLoadMs = now() - zipStartedAt;
    }
    const documentFile = zip.file("document.json");
    assertZipEntryReadable(documentFile, {
      maxBytes: archiveLimits.maxDocumentJsonBytes,
      maxRatio: archiveLimits.maxDocumentJsonRatio,
    });

    const jsonStartedAt = now();
    const raw = (
      await readZipEntryBufferLimited(documentFile, {
        maxBytes: archiveLimits.maxDocumentJsonBytes,
        maxRatio: archiveLimits.maxDocumentJsonRatio,
      })
    ).toString("utf8");
    const parsedDocument = JSON.parse(raw);
    if (metrics) {
      metrics.jsonMs = now() - jsonStartedAt;
      metrics.documentJsonBytes = Buffer.byteLength(
        raw,
        "utf8",
      );
    }
    if (!parsedDocument.createdAt) {
      parsedDocument.createdAt =
        sourceStat.birthtime?.toISOString?.()
        || sourceStat.ctime?.toISOString?.()
        || parsedDocument.updatedAt;
    }
    const document = linkPaperDocument(
      sourcePath,
      parsedDocument,
      metrics,
    );
    if (metrics) {
      metrics.totalMs = now() - startedAt;
    }
    return {
      document,
      diskRevision,
      rawDocument: parsedDocument,
    };
  }

  async function loadPaperDocument(filePath, metrics = null) {
    return (
      await loadPaperDocumentSnapshot(filePath, metrics)
    ).document;
  }

  async function preservePreV2MigrationBackupWithinTransaction(
    filePath,
  ) {
    try {
      const rawDocument = await readSearchDocument(filePath);
      if (
        Number(rawDocument?.version || 1)
          >= DOCUMENT_SCHEMA_VERSION
      ) {
        return "";
      }
      const backupRoot = path.join(
        app.getPath("userData"),
        migrationBackupFolder,
      );
      await fs.mkdir(backupRoot, { recursive: true });
      const safeName = sanitizeFilesystemName(
        path.basename(filePath, path.extname(filePath)),
        "未命名信笺",
        72,
      );
      const backupPath = path.join(
        backupRoot,
        `${safeName}_pre-v2_${timestampForFileName()}_${randomUUID().slice(0, 8)}${DOCUMENT_EXTENSION}`,
      );
      await fs.copyFile(filePath, backupPath);
      return backupPath;
    } catch (error) {
      if (error?.code === "ENOENT") return "";
      await writeDebugLog(
        "document:migration-backup:error",
        {
          filePath,
          message: error?.message,
        },
      );
      throw new Error(
        "无法建立格式迁移备份，已取消保存",
        { cause: error },
      );
    }
  }

  function createTransactionFacade() {
    let active = true;
    const requireActive = () => {
      if (!active) {
        throw new Error("文档事务已经结束");
      }
    };
    const transaction = Object.freeze({
      assertDiskRevision(...args) {
        requireActive();
        return assertDiskRevision(...args);
      },
      createConflictCopyPath(...args) {
        requireActive();
        return createConflictCopyPath(...args);
      },
      invalidateDocumentPath(...args) {
        requireActive();
        return invalidateDocumentCachesForPath(...args);
      },
      loadPaperDocumentSnapshot(...args) {
        requireActive();
        return loadPaperDocumentSnapshot(...args);
      },
      preservePreV2MigrationBackup(...args) {
        requireActive();
        return preservePreV2MigrationBackupWithinTransaction(
          ...args,
        );
      },
      readDiskRevision(...args) {
        requireActive();
        return readDiskRevision(...args);
      },
      rebaseDocumentPath(...args) {
        requireActive();
        return rebaseAssetPathReferences(...args);
      },
      savePaperDocument(...args) {
        requireActive();
        return savePaperDocumentWithinTransaction(...args);
      },
    });
    return {
      close() {
        active = false;
      },
      transaction,
    };
  }

  function trackMutation(operation) {
    pendingMutations.add(operation);
    operation.then(
      () => pendingMutations.delete(operation),
      () => pendingMutations.delete(operation),
    );
    return operation;
  }

  function runDocumentTransaction(task) {
    if (typeof task !== "function") {
      return Promise.reject(
        new Error("缺少文档事务任务"),
      );
    }
    if (shutdownStarted) {
      return Promise.reject(
        new Error("文档存储服务正在退出"),
      );
    }
    const operation = documentMutationQueue.run(
      documentMutationLockKey,
      async () => {
        const {
          close,
          transaction,
        } = createTransactionFacade();
        try {
          return await task(transaction);
        } finally {
          close();
        }
      },
    );
    return trackMutation(operation);
  }

  function savePaperDocument(filePath, document, options = {}) {
    return runDocumentTransaction((transaction) => (
      transaction.savePaperDocument(
        filePath,
        document,
        options,
      )
    ));
  }

  function preservePreV2MigrationBackup(filePath) {
    return runDocumentTransaction((transaction) => (
      transaction.preservePreV2MigrationBackup(filePath)
    ));
  }

  async function loadAutosave() {
    const filePath = autosavePath();
    try {
      await fs.access(filePath);
      return {
        exists: true,
        path: filePath,
        document: await loadPaperDocument(filePath),
      };
    } catch {
      return { exists: false };
    }
  }

  async function saveAutosave(document) {
    const filePath = autosavePath();
    const saved = await savePaperDocument(filePath, document);
    return {
      path: filePath,
      document: saved.document,
    };
  }

  async function saveAutosaveTab(document, tabId) {
    const filePath = autosaveSessionPath(tabId);
    const saved = await savePaperDocument(filePath, document);
    return {
      canceled: false,
      path: filePath,
      recoveryId: path.basename(
        filePath,
        path.extname(filePath),
      ),
      document: saved.document,
    };
  }

  function deleteAutosaveTab(tabId) {
    return runDocumentTransaction(async (transaction) => {
      const filePath = autosaveSessionPath(tabId);
      await fs.rm(filePath, { force: true });
      transaction.invalidateDocumentPath(
        filePath,
        false,
        { revokeReferences: true },
      );
      return { ok: true };
    });
  }

  function clearAutosave() {
    return runDocumentTransaction(async (transaction) => {
      const filePath = autosavePath();
      try {
        await fs.rm(filePath, { force: true });
      } catch {
        // No-op.
      }
      transaction.invalidateDocumentPath(
        filePath,
        false,
        { revokeReferences: true },
      );
      return { ok: true };
    });
  }

  function importDocument(options) {
    return requireDocumentInterchange().importDocument(options);
  }

  function exportDocument(options) {
    return requireDocumentInterchange().exportDocument(options);
  }

  function shutdown() {
    if (shutdownComplete) {
      return {
        pending: false,
        started: false,
        promise: null,
      };
    }
    shutdownStarted = true;
    if (shutdownPromise) {
      return {
        pending: true,
        started: false,
        promise: shutdownPromise,
      };
    }
    if (pendingMutations.size === 0) {
      shutdownComplete = true;
      return {
        pending: false,
        started: false,
        promise: null,
      };
    }
    shutdownPromise = Promise.allSettled([
      ...pendingMutations,
    ]).finally(() => {
      shutdownComplete = true;
    });
    return {
      pending: true,
      started: true,
      promise: shutdownPromise,
    };
  }

  const facade = Object.freeze({
    DocumentRevisionConflictError,
    assertDiskRevision,
    autosaveSessionIdForPath,
    clearAutosave,
    createConflictCopyPath,
    deleteAutosaveTab,
    exportDocument,
    importDocument,
    loadAutosave,
    loadPaperDocument,
    loadPaperDocumentSnapshot,
    preservePreV2MigrationBackup,
    readDiskRevision,
    runDocumentTransaction,
    saveAutosave,
    saveAutosaveTab,
    savePaperDocument,
  });

  return {
    facade,
    initializeAutosaveStorage,
    initializeDocumentInterchange,
    shutdown,
  };
}

module.exports = {
  createDocumentStorageRuntime,
};
