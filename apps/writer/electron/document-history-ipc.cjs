const {
  normalizeDiskRevision,
} = require("./document-revision.cjs");
const {
  assertBoundedIpcObject,
  assertBoundedIpcPayload,
} = require("./ipc-payload-limits.cjs");

function registerDocumentHistoryIpcHandlers({
  ipcMain,
  historyFacade,
  assertAuthorizedDocument,
  createDocumentSnapshot,
}) {
  const safeText = (value, maximum = 128) => (
    String(value || "").slice(0, maximum)
  );
  const safePayload = (value) => (
    assertBoundedIpcObject(value, {
      label: "版本历史参数",
      maxBytes: 32 * 1024 * 1024,
      maxNodes: 250_000,
      maxDepth: 64,
      maxArrayLength: 50_000,
      maxObjectKeys: 20_000,
    })
  );
  const safeDocumentId = (value) => {
    assertBoundedIpcPayload(value, {
      label: "版本历史文档 ID",
      maxBytes: 512,
      maxNodes: 2,
      maxDepth: 1,
      maxArrayLength: 1,
      maxObjectKeys: 1,
    });
    return safeText(value);
  };

  ipcMain.handle("history:list", async (_event, documentId, currentSha256 = "") => ({
    ok: true,
    entries: await historyFacade.list(
      safeDocumentId(documentId),
      { excludeAutoSha256: safeText(currentSha256, 64) },
    ),
  }));

  ipcMain.handle("history:read", async (_event, payload = {}) => {
    const source = safePayload(payload);
    return {
      ok: true,
      ...await historyFacade.read(
        safeText(source.documentId),
        safeText(source.entryId),
      ),
    };
  });

  ipcMain.handle("history:create", async (_event, payload = {}) => {
    const source = safePayload(payload);
    const documentId = safeText(source.documentId);
    const name = safeText(source.name, 200);
    const pinned = Boolean(source.pinned);
    if (source.document !== undefined) {
      if (
        !source.document
        || typeof source.document !== "object"
        || Array.isArray(source.document)
        || typeof createDocumentSnapshot !== "function"
      ) {
        throw new Error("历史快照文档无效");
      }
      return {
        ok: true,
        ...await createDocumentSnapshot({
          documentId,
          document: source.document,
          name,
          pinned,
        }),
      };
    }
    const filePath = await assertAuthorizedDocument(
      safeText(source.filePath, 32768),
    );
    return {
      ok: true,
      ...await historyFacade.createSnapshot({
        documentId,
        filePath,
        kind: "manual",
        name,
        pinned,
      }),
    };
  });

  ipcMain.handle("history:pin", async (_event, payload = {}) => {
    const source = safePayload(payload);
    return {
      ok: true,
      entry: await historyFacade.updateEntry(
        safeText(source.documentId),
        safeText(source.entryId),
        {
          pinned: Boolean(source.pinned),
          ...(source.name === undefined
            ? {}
            : { name: safeText(source.name, 200) }),
        },
      ),
    };
  });

  ipcMain.handle("history:delete", async (_event, payload = {}) => {
    const source = safePayload(payload);
    return historyFacade.remove(
      safeText(source.documentId),
      safeText(source.entryId),
    );
  });

  ipcMain.handle("history:restore", async (_event, payload = {}) => {
    const source = safePayload(payload);
    const targetPath = await assertAuthorizedDocument(
      safeText(source.targetPath, 32768),
    );
    return historyFacade.restore({
      documentId: safeText(source.documentId),
      entryId: safeText(source.entryId),
      targetPath,
      expectedRevision: normalizeDiskRevision(
        source.expectedRevision ?? null,
      ),
    });
  });

  ipcMain.handle("history:clear-auto", async (_event, documentId) => (
    historyFacade.clearAuto(safeDocumentId(documentId))
  ));

  ipcMain.handle("history:clear", async (_event, documentId) => (
    historyFacade.clear(safeDocumentId(documentId))
  ));
}

module.exports = {
  registerDocumentHistoryIpcHandlers,
};
