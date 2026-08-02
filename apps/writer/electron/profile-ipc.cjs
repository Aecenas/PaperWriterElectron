const {
  assertBoundedIpcObject,
} = require("./ipc-payload-limits.cjs");

function registerProfileIpcHandlers({
  ipcMain,
  profileFacade,
  dialog,
  getMainWindow,
  path,
  defaultDirectory,
  randomUUID,
  now = () => Date.now(),
}) {
  const pendingImports = new Map();
  const pendingTransactions = new Map();
  const TOKEN_TTL_MS = 10 * 60 * 1000;
  const MAX_VERIFY_ATTEMPTS = 5;
  const MAX_PENDING_IMPORTS = 4;
  const MAX_PENDING_TRANSACTIONS = 4;
  const boundedProfilePayload = (value, label, overrides = {}) => assertBoundedIpcObject(value, {
    label,
    maxBytes: 16 * 1024 * 1024,
    maxNodes: 100_000,
    maxDepth: 32,
    maxArrayLength: 1_000,
    maxObjectKeys: 10_000,
    ...overrides,
  });

  function cleanupTokens() {
    const current = now();
    for (const [token, item] of pendingImports) {
      if (item.expiresAt <= current) pendingImports.delete(token);
    }
    for (const [token, item] of pendingTransactions) {
      if (item.busy || item.expiresAt > current) continue;
      pendingTransactions.delete(token);
      void Promise.resolve(
        profileFacade.rollbackPrepared(item.runtimeTransactionId),
      ).catch(() => {});
    }
  }

  function safePayload(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function senderId(event) {
    const id = Number(event?.sender?.id);
    return Number.isInteger(id) && id >= 0 ? id : null;
  }

  function safePassphrase(value) {
    const passphrase = String(value || "");
    if (passphrase.length > 1024) {
      throw new Error("配置包口令过长");
    }
    return passphrase;
  }

  function createOpaqueToken() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = String(randomUUID() || "");
      if (
        /^[A-Za-z0-9_-]{1,128}$/.test(token)
        && !pendingImports.has(token)
        && !pendingTransactions.has(token)
      ) {
        return token;
      }
    }
    throw new Error("无法创建配置包导入会话");
  }

  function pendingTransaction(event, payload) {
    cleanupTokens();
    const source = safePayload(payload);
    const transactionToken = String(
      source.transactionToken || "",
    ).slice(0, 128);
    const pending = pendingTransactions.get(transactionToken);
    if (
      !pending
      || pending.senderId !== senderId(event)
      || pending.busy
    ) {
      throw new Error("配置导入事务无效或已过期");
    }
    return { transactionToken, pending, source };
  }

  function reservePendingImport(token, value) {
    while (pendingImports.size >= MAX_PENDING_IMPORTS) {
      const oldestToken = pendingImports.keys().next().value;
      if (oldestToken === undefined) break;
      pendingImports.delete(oldestToken);
    }
    pendingImports.set(token, value);
  }

  function pendingImport(event, payload) {
    cleanupTokens();
    const source = safePayload(payload);
    const importToken = String(source.importToken || "").slice(0, 128);
    const pending = pendingImports.get(importToken);
    const currentSenderId = senderId(event);
    if (
      !pending
      || pending.senderId !== currentSenderId
    ) {
      throw new Error("配置包导入会话已过期，请重新选择文件");
    }
    return { importToken, pending, source };
  }

  ipcMain.handle("profile:export", async (_event, payload = {}) => {
    const source = boundedProfilePayload(payload, "配置导出参数");
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: "导出笺间配置",
      defaultPath: path.join(defaultDirectory(), "笺间配置.jianprofile"),
      filters: [{ name: "笺间配置包", extensions: ["jianprofile"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return profileFacade.exportToFile(result.filePath, {
      preferences: safePayload(source.preferences),
      templates: source.templates ?? {},
      includeSecrets: Boolean(source.includeSecrets),
      passphrase: safePassphrase(source.passphrase),
    });
  });

  ipcMain.handle("profile:inspect", async (event, payload = {}) => {
    cleanupTokens();
    const source = boundedProfilePayload(payload, "配置检查参数");
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: "导入笺间配置",
      defaultPath: defaultDirectory(),
      properties: ["openFile"],
      filters: [{ name: "笺间配置包", extensions: ["jianprofile"] }],
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const buffer = await profileFacade.readProfileFile(result.filePaths[0]);
    const inspected = await profileFacade.inspectArchive(buffer, {
      currentPreferences: safePayload(source.currentPreferences),
      currentTemplates: source.currentTemplates ?? {},
    });
    const requiresPassphrase = Boolean(
      inspected.preview?.includesSecrets
      || inspected.manifest?.sections?.secrets,
    );
    const importToken = createOpaqueToken();
    reservePendingImport(importToken, {
      buffer,
      expiresAt: now() + TOKEN_TTL_MS,
      inspection: inspected,
      requiresPassphrase,
      senderId: senderId(event),
      verified: !requiresPassphrase,
      verifyAttempts: 0,
    });
    return {
      canceled: false,
      importToken,
      manifest: inspected.manifest,
      preview: requiresPassphrase ? null : inspected.preview,
      requiresPassphrase,
      verified: !requiresPassphrase,
    };
  });

  ipcMain.handle("profile:verify", async (event, payload = {}) => {
    const bounded = boundedProfilePayload(payload, "配置口令验证参数", {
      maxBytes: 4096,
      maxNodes: 32,
      maxDepth: 4,
      maxArrayLength: 16,
      maxObjectKeys: 16,
    });
    const { importToken, pending, source } = pendingImport(event, bounded);
    if (!pending.requiresPassphrase) {
      return {
        ok: true,
        verified: true,
        manifest: pending.inspection.manifest,
        preview: pending.inspection.preview,
      };
    }
    try {
      const verified = await profileFacade.verifyArchive(pending.buffer, {
        passphrase: safePassphrase(source.passphrase),
      });
      pending.verified = true;
      pending.verifyAttempts = 0;
      pending.expiresAt = now() + TOKEN_TTL_MS;
      return {
        ok: true,
        verified: true,
        manifest: verified.manifest,
        // The inspection preview is already checksum/schema validated and is
        // computed against the renderer's current portable settings. Only
        // release it after the encrypted secret envelope authenticates.
        preview: pending.inspection.preview,
      };
    } catch (error) {
      pending.verifyAttempts += 1;
      if (pending.verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
        pendingImports.delete(importToken);
      }
      throw error;
    }
  });

  ipcMain.handle("profile:import", async (event, payload = {}) => {
    const bounded = boundedProfilePayload(payload, "配置导入参数");
    const { importToken, pending, source } = pendingImport(event, bounded);
    if (pending.requiresPassphrase && !pending.verified) {
      throw new Error("请先验证配置包口令，再查看差异并导入");
    }
    pendingImports.delete(importToken);
    const prepared = await profileFacade.prepareArchive(
      pending.buffer,
      {
        passphrase: safePassphrase(source.passphrase),
        sections: safePayload(source.sections),
        currentPreferences: safePayload(
          source.currentPreferences,
        ),
        currentTemplates: source.currentTemplates ?? {},
      },
    );
    const runtimeTransactionId = String(
      prepared?.transactionId || "",
    );
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(runtimeTransactionId)) {
      throw new Error("主进程未能创建配置导入事务");
    }
    cleanupTokens();
    if (
      pendingTransactions.size
      >= MAX_PENDING_TRANSACTIONS
    ) {
      await profileFacade.rollbackPrepared(runtimeTransactionId);
      throw new Error("待处理的配置导入事务过多");
    }
    const transactionToken = createOpaqueToken();
    pendingTransactions.set(transactionToken, {
      runtimeTransactionId,
      senderId: senderId(event),
      expiresAt: now() + TOKEN_TTL_MS,
      busy: false,
    });
    const {
      transactionId: _transactionId,
      ...publicResult
    } = prepared;
    return {
      ...publicResult,
      transactionToken,
    };
  });

  ipcMain.handle("profile:commit", async (event, payload = {}) => {
    const bounded = boundedProfilePayload(payload, "配置提交参数", {
      maxBytes: 1024,
      maxNodes: 16,
      maxDepth: 2,
      maxArrayLength: 4,
      maxObjectKeys: 8,
    });
    const {
      transactionToken,
      pending,
    } = pendingTransaction(event, bounded);
    pending.busy = true;
    try {
      const result = await profileFacade.commitPrepared(
        pending.runtimeTransactionId,
      );
      pendingTransactions.delete(transactionToken);
      return result;
    } catch (error) {
      pending.busy = false;
      throw error;
    }
  });

  ipcMain.handle("profile:rollback", async (event, payload = {}) => {
    const bounded = boundedProfilePayload(payload, "配置回滚参数", {
      maxBytes: 1024,
      maxNodes: 16,
      maxDepth: 2,
      maxArrayLength: 4,
      maxObjectKeys: 8,
    });
    const {
      transactionToken,
      pending,
    } = pendingTransaction(event, bounded);
    pending.busy = true;
    try {
      const result = await profileFacade.rollbackPrepared(
        pending.runtimeTransactionId,
      );
      pendingTransactions.delete(transactionToken);
      return result;
    } catch (error) {
      pending.busy = false;
      throw error;
    }
  });
}

module.exports = {
  registerProfileIpcHandlers,
};
