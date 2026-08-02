function historyDocumentFingerprint(document) {
  const visit = (value, depth = 0) => {
    if (value === null || typeof value !== "object") return value;
    if (depth > 64) return "[depth-limit]";
    if (Array.isArray(value)) {
      return value.map((item) => visit(item, depth + 1));
    }
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !(depth === 0 && key === "updatedAt"))
        .sort()
        .map((key) => [key, visit(value[key], depth + 1)]),
    );
  };
  return JSON.stringify(visit(document || {}));
}

function registerDocumentSaveIpcHandlers({
  ipcMain,
  documentModel,
  revisionConflictCode: REVISION_CONFLICT_CODE,
  storageFacade,
  assertAuthorizedDirectory,
  assertMutableWorkspaceEntry,
  uniquePath,
  path,
  randomUUID,
  listFolderEntries,
  assertAuthorizedDocument,
  authorizeDocumentPath,
  listAuthorizedFolderEntries,
  sanitizeFilesystemName,
  dialog,
  getMainWindow,
  defaultDocumentsDir,
  ensureExtension,
  resolveDocumentTargetPath,
  platform,
  assertAuthorizedDocumentTarget,
  fs,
  historyFacade = null,
  writeDebugLog = async () => {},
}) {
  const {
    DOCUMENT_EXTENSION,
    DOCUMENT_FILTERS,
    DOCUMENT_SCHEMA_VERSION,
    isSupportedDocument,
    normalizeDocument,
    normalizeDocumentId,
    sanitizeName,
    timestampForFileName,
  } = documentModel;
  const {
    DocumentRevisionConflictError,
    runDocumentTransaction,
  } = storageFacade;
  ipcMain.handle("document:create-in-folder", async (
    _event,
    folderPath,
    title,
    templateDocument = {},
  ) => {
    if (!folderPath) {
      return { ok: false, message: "缺少目标文件夹" };
    }
    return runDocumentTransaction(async (transaction) => {
      const authorizedFolder = await assertAuthorizedDirectory(folderPath);
      assertMutableWorkspaceEntry(authorizedFolder);
      const safeTitle = sanitizeName(title, "未命名信笺");
      const filePath = await uniquePath(
        path.join(authorizedFolder, `${safeTitle}${DOCUMENT_EXTENSION}`),
      );
      const document = normalizeDocument({
        ...templateDocument,
        version: DOCUMENT_SCHEMA_VERSION,
        documentId: normalizeDocumentId(templateDocument?.documentId) || randomUUID(),
        derivedFrom: "",
        title: safeTitle,
        html: "<p></p>",
      });
      const saved = await transaction.savePaperDocument(
        filePath,
        document,
      );
      return {
        ok: true,
        path: filePath,
        document: saved.document,
        diskRevision: saved.diskRevision,
        ...(await listFolderEntries(authorizedFolder)),
      };
    });
  });

  ipcMain.handle("document:backup", async (_event, filePath) => {
    if (!filePath || !isSupportedDocument(filePath)) {
      return { ok: false, message: "只能备份信笺文件" };
    }
    return runDocumentTransaction(async (transaction) => {
      const sourcePath = await assertAuthorizedDocument(filePath);
      const parsed = path.parse(sourcePath);
      const backupPath = await uniquePath(
        path.join(
          parsed.dir,
          `${parsed.name}_备份_${timestampForFileName()}${DOCUMENT_EXTENSION}`,
        ),
      );
      const sourceSnapshot =
        await transaction.loadPaperDocumentSnapshot(sourcePath);
      if (
        Number(sourceSnapshot.rawDocument?.version || 1) > DOCUMENT_SCHEMA_VERSION
        || sourceSnapshot.document._readOnlyFutureSchema
      ) {
        throw new Error(
          `此信笺使用未来格式 v${Number(sourceSnapshot.rawDocument?.version) || "?"}，当前版本不能复制备份`,
        );
      }
      let sourceDocument = sourceSnapshot.document;
      let sourceDiskRevision = sourceSnapshot.diskRevision;
      let migrationBackupPath = "";
      const rawSourceId = normalizeDocumentId(sourceSnapshot.rawDocument?.documentId);
      if (
        Number(sourceSnapshot.rawDocument?.version || 1) < DOCUMENT_SCHEMA_VERSION
        || !rawSourceId
      ) {
        migrationBackupPath =
          await transaction.preservePreV2MigrationBackup(
            sourcePath,
          );
        sourceDocument = {
          ...sourceDocument,
          version: DOCUMENT_SCHEMA_VERSION,
          documentId: rawSourceId || randomUUID(),
          derivedFrom: normalizeDocumentId(sourceDocument.derivedFrom),
          footnotes: Array.isArray(sourceDocument.footnotes)
            ? sourceDocument.footnotes
            : [],
          citationSources: Array.isArray(sourceDocument.citationSources)
            ? sourceDocument.citationSources
            : [],
        };
        const migrated = await transaction.savePaperDocument(
          sourcePath,
          sourceDocument,
          {
            validateTarget: (candidate) => (
              transaction.assertDiskRevision(
                candidate,
                sourceDiskRevision,
              )
            ),
          },
        );
        sourceDocument = migrated.document;
        sourceDiskRevision = migrated.diskRevision;
      }
      const parentId = normalizeDocumentId(sourceDocument.documentId);
      if (!parentId) {
        throw new Error("源信笺缺少有效文档身份，无法建立备份关系");
      }
      const backupDocument = {
        ...sourceDocument,
        version: DOCUMENT_SCHEMA_VERSION,
        documentId: randomUUID(),
        derivedFrom: parentId,
        title: `${sourceDocument.title || parsed.name}（备份）`,
      };
      const savedBackup = await transaction.savePaperDocument(
        backupPath,
        backupDocument,
      );
      await authorizeDocumentPath(backupPath);
      return {
        ok: true,
        path: backupPath,
        diskRevision: savedBackup.diskRevision,
        sourcePath,
        sourceDocument,
        sourceDiskRevision,
        ...(migrationBackupPath ? { migrationBackupPath } : {}),
        ...(await listAuthorizedFolderEntries(parsed.dir)),
      };
    });
  });

  ipcMain.handle("document:save", async (
    _event,
    document,
    currentPath,
    saveAs,
    reservedPaths = [],
    expectedRevision = null,
    saveOptions = {},
  ) => {
    if (
      Number(document?.version || 1) > DOCUMENT_SCHEMA_VERSION
      || document?._readOnlyFutureSchema
    ) {
      throw new Error(
        `此信笺使用未来格式 v${Number(document?.version) || "?"}，当前版本只能只读打开`,
      );
    }
    const sourcePath = currentPath && isSupportedDocument(currentPath)
      ? path.resolve(String(currentPath))
      : "";
    let filePath = currentPath;
    let userSelectedTarget = false;
    if (saveAs || !filePath) {
      const safeTitle = sanitizeFilesystemName(
        normalizeDocument(document).title,
        "未命名信笺",
        60,
      );
      const result = await dialog.showSaveDialog(getMainWindow(), {
        title: "保存信笺",
        defaultPath: path.join(
          defaultDocumentsDir(),
          `${safeTitle}${DOCUMENT_EXTENSION}`,
        ),
        filters: DOCUMENT_FILTERS,
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      filePath = isSupportedDocument(result.filePath)
        ? result.filePath
        : ensureExtension(result.filePath, DOCUMENT_EXTENSION);
      userSelectedTarget = true;
    }

    filePath = await resolveDocumentTargetPath(filePath);

    const targetKey = platform === "win32"
      ? path.resolve(filePath).toLocaleLowerCase("en-US")
      : path.resolve(filePath);
    const conflictsWithOpenDocument = (Array.isArray(reservedPaths) ? reservedPaths : [])
      .slice(0, 100)
      .some((value) => {
        if (!value) return false;
        const candidate = path.resolve(String(value).slice(0, 32768));
        return (platform === "win32"
          ? candidate.toLocaleLowerCase("en-US")
          : candidate) === targetKey;
      });
    if (conflictsWithOpenDocument) {
      throw new Error(
        "该保存位置已被另一个打开的标签占用，请选择其他文件名",
      );
    }

    if (userSelectedTarget) {
      await authorizeDocumentPath(filePath, { mustExist: false });
    } else {
      filePath = await assertAuthorizedDocumentTarget(filePath);
    }

    const sourceKey = sourcePath
      ? (platform === "win32"
        ? sourcePath.toLocaleLowerCase("en-US")
        : sourcePath)
      : "";
    return runDocumentTransaction(async (transaction) => {
      const targetStat = await fs.stat(filePath).catch(
        (error) => {
          if (error?.code === "ENOENT") return null;
          throw error;
        },
      );
      const targetIdentity = targetStat?.isFile()
        ? { dev: targetStat.dev, ino: targetStat.ino }
        : null;
      let documentToSave = document;
      if (
        userSelectedTarget
        && sourcePath
        && targetKey !== sourceKey
      ) {
        const parentId = normalizeDocumentId(
          document?.documentId,
        );
        documentToSave = {
          ...document,
          version: DOCUMENT_SCHEMA_VERSION,
          documentId: randomUUID(),
          derivedFrom: parentId,
        };
      }

      const writeConflictCopy = async (error) => {
        let conflictCopyPath =
          transaction.createConflictCopyPath(filePath);
        for (
          let sequence = 0;
          sequence < 100;
          sequence += 1
        ) {
          conflictCopyPath =
            transaction.createConflictCopyPath(
              filePath,
              { sequence },
            );
          try {
            await fs.access(conflictCopyPath);
          } catch (accessError) {
            if (accessError?.code === "ENOENT") break;
            throw accessError;
          }
        }
        const conflictDocument = {
          ...documentToSave,
          version: DOCUMENT_SCHEMA_VERSION,
          documentId: randomUUID(),
          derivedFrom: normalizeDocumentId(
            documentToSave?.documentId,
          ),
          title: `${normalizeDocument(documentToSave).title}（本机冲突副本）`,
        };
        const conflictSaved =
          await transaction.savePaperDocument(
            conflictCopyPath,
            conflictDocument,
          );
        await authorizeDocumentPath(conflictCopyPath);
        return {
          canceled: false,
          conflict: true,
          code: REVISION_CONFLICT_CODE,
          path: filePath,
          conflictCopyPath,
          conflictDocument: conflictSaved.document,
          expectedRevision:
            error.expectedRevision || expectedRevision,
          actualRevision:
            error.actualRevision
            || await transaction.readDiskRevision(filePath),
        };
      };

      if (!userSelectedTarget && sourcePath) {
        try {
          await transaction.assertDiskRevision(
            filePath,
            expectedRevision,
          );
        } catch (error) {
          if (error?.code !== REVISION_CONFLICT_CODE) {
            throw error;
          }
          return writeConflictCopy(error);
        }
      }

      const migrationBackupPath = sourcePath
        && Number(documentToSave?.version || 1)
          >= DOCUMENT_SCHEMA_VERSION
        ? await transaction.preservePreV2MigrationBackup(
          filePath,
        )
        : "";
      let historyWarning = "";
      let preparedHistory = null;
      if (
        historyFacade
        && typeof historyFacade.prepareSnapshot === "function"
        && !userSelectedTarget
        && sourcePath
        && targetStat?.isFile()
        && normalizeDocumentId(documentToSave?.documentId)
      ) {
        try {
          preparedHistory = await historyFacade.prepareSnapshot({
            documentId: normalizeDocumentId(documentToSave.documentId),
            filePath,
            kind: "auto",
            savedAt: targetStat.mtimeMs,
          });
        } catch (error) {
          historyWarning = "文档已保存，但未能创建本地历史版本";
          await writeDebugLog("history:auto-snapshot:error", {
            message: error?.message,
            documentId: normalizeDocumentId(documentToSave?.documentId),
          });
        }
      }
      let saved;
      try {
        saved = await transaction.savePaperDocument(
          filePath,
          documentToSave,
          {
            validateTarget: async (targetPath) => {
              const authorizedTarget =
                await assertAuthorizedDocumentTarget(
                  targetPath,
                );
              if (!userSelectedTarget && sourcePath) {
                await transaction.assertDiskRevision(
                  authorizedTarget,
                  expectedRevision,
                );
              }
              const currentStat = await fs.stat(
                authorizedTarget,
              ).catch((error) => {
                if (error?.code === "ENOENT") return null;
                throw error;
              });
              if (targetIdentity) {
                if (
                  !currentStat?.isFile()
                  || currentStat.dev !== targetIdentity.dev
                  || currentStat.ino !== targetIdentity.ino
                ) {
                  throw new DocumentRevisionConflictError(
                    "保存期间目标信笺已被移动、删除或替换",
                    {
                      filePath: authorizedTarget,
                      expectedRevision,
                      actualRevision:
                        await transaction.readDiskRevision(
                          authorizedTarget,
                        ),
                    },
                  );
                }
              } else if (!targetIdentity && currentStat) {
                throw new DocumentRevisionConflictError(
                  "保存期间目标位置出现了同名文件",
                  {
                    filePath: authorizedTarget,
                    expectedRevision: null,
                    actualRevision:
                      await transaction.readDiskRevision(
                        authorizedTarget,
                      ),
                  },
                );
              }
            },
            afterCommit:
              userSelectedTarget
              && sourceKey
              && sourceKey !== targetKey
                ? async () => (
                  transaction.rebaseDocumentPath(
                    sourcePath,
                    filePath,
                  )
                )
                : undefined,
          },
        );
      } catch (error) {
        if (
          !userSelectedTarget
          && sourcePath
          && error?.code === REVISION_CONFLICT_CODE
        ) {
          return writeConflictCopy(error);
        }
        throw error;
      }
      if (
        preparedHistory
        && typeof preparedHistory.commit === "function"
        && historyDocumentFingerprint(preparedHistory.document)
          !== historyDocumentFingerprint(saved.document)
      ) {
        try {
          await preparedHistory.commit();
        } catch (error) {
          historyWarning = "文档已保存，但未能创建本地历史版本";
          await writeDebugLog("history:auto-snapshot:error", {
            message: error?.message,
            documentId: normalizeDocumentId(saved.document?.documentId),
          });
        }
      }
      return {
        canceled: false,
        path: filePath,
        document: saved.document,
        diskRevision: saved.diskRevision,
        ...(historyWarning ? { historyWarning } : {}),
        ...(migrationBackupPath
          ? { migrationBackupPath }
          : {}),
      };
    });
  });
}

module.exports = {
  registerDocumentSaveIpcHandlers,
};
