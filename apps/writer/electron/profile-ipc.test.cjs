const assert = require("node:assert/strict");
const test = require("node:test");

const { registerProfileIpcHandlers } = require("./profile-ipc.cjs");

function createHarness({ includesSecrets = false } = {}) {
  const handlers = new Map();
  const calls = [];
  let tokenId = 0;
  let clock = 1000;
  const profileFacade = {
    async exportToFile(...args) {
      calls.push(["export", ...args]);
      return { ok: true, path: args[0] };
    },
    async readProfileFile(...args) {
      calls.push(["read", ...args]);
      return Buffer.from("profile");
    },
    async inspectArchive(...args) {
      calls.push(["inspect", ...args]);
      return {
        manifest: { sections: { secrets: includesSecrets } },
        preview: { includesSecrets, providerCount: 2 },
      };
    },
    async verifyArchive(...args) {
      calls.push(["verify", ...args]);
      if (args[1]?.passphrase !== "correct horse battery staple") {
        throw new Error("配置包口令错误或密钥数据已损坏");
      }
      return {
        verified: true,
        manifest: { sections: { secrets: true } },
        preview: { includesSecrets: true, providerCount: 2 },
      };
    },
    async prepareArchive(...args) {
      calls.push(["prepare", ...args]);
      return {
        ok: true,
        prepared: true,
        transactionId: "runtime-transaction-1",
        preferences: { theme: "imported" },
        templates: [],
      };
    },
    async commitPrepared(...args) {
      calls.push(["commit", ...args]);
      return { ok: true, committed: true };
    },
    async rollbackPrepared(...args) {
      calls.push(["rollback", ...args]);
      return { ok: true, rolledBack: true };
    },
  };
  const dialog = {
    async showSaveDialog(_window, options) {
      calls.push(["save-dialog", options]);
      return { canceled: false, filePath: "C:\\config.jianprofile" };
    },
    async showOpenDialog(_window, options) {
      calls.push(["open-dialog", options]);
      return {
        canceled: false,
        filePaths: ["C:\\config.jianprofile"],
      };
    },
  };
  registerProfileIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
    profileFacade,
    dialog,
    getMainWindow: () => ({ id: "main" }),
    path: require("node:path").win32,
    defaultDirectory: () => "C:\\Documents",
    randomUUID: () => `token-${++tokenId}`,
    now: () => clock,
  });
  return {
    handlers,
    calls,
    advance(milliseconds) {
      clock += milliseconds;
    },
  };
}

test("profile IPC uses native pickers and one-time import tokens", async () => {
  const { handlers, calls } = createHarness();
  assert.deepEqual([...handlers.keys()].sort(), [
    "profile:commit",
    "profile:export",
    "profile:import",
    "profile:inspect",
    "profile:rollback",
    "profile:verify",
  ]);
  await handlers.get("profile:export")({}, {
    preferences: { theme: "paper" },
    templates: [],
    includeSecrets: false,
  });
  assert.equal(calls.find(([type]) => type === "export")[1], "C:\\config.jianprofile");

  const inspected = await handlers.get("profile:inspect")({}, {});
  assert.equal(inspected.importToken, "token-1");
  assert.equal(inspected.verified, true);
  assert.deepEqual(inspected.preview, { includesSecrets: false, providerCount: 2 });
  const prepared = await handlers.get("profile:import")({}, {
    importToken: inspected.importToken,
    sections: { ai: true },
    currentPreferences: { zoom: 1 },
    currentTemplates: [],
  });
  assert.equal(calls.at(-1)[0], "prepare");
  assert.equal(prepared.transactionToken, "token-2");
  assert.equal(prepared.transactionId, undefined);
  assert.equal(
    calls.some(([type]) => type === "commit"),
    false,
  );
  await handlers.get("profile:commit")({}, {
    transactionToken: prepared.transactionToken,
  });
  assert.deepEqual(calls.at(-1), [
    "commit",
    "runtime-transaction-1",
  ]);
  await assert.rejects(
    handlers.get("profile:import")({}, {
      importToken: inspected.importToken,
    }),
    /已过期/,
  );
});

test("encrypted profile IPC verifies the token-bound password before exposing preview", async () => {
  const { handlers, calls } = createHarness({ includesSecrets: true });
  const event = { sender: { id: 7 } };
  const inspected = await handlers.get("profile:inspect")(event, {});
  assert.equal(inspected.requiresPassphrase, true);
  assert.equal(inspected.verified, false);
  assert.equal(inspected.preview, null);

  await assert.rejects(
    handlers.get("profile:import")(event, {
      importToken: inspected.importToken,
      passphrase: "correct horse battery staple",
    }),
    /先验证/,
  );
  await assert.rejects(
    handlers.get("profile:verify")(event, {
      importToken: inspected.importToken,
      passphrase: "this is the wrong password",
    }),
    /口令错误/,
  );
  const verified = await handlers.get("profile:verify")(event, {
    importToken: inspected.importToken,
    passphrase: "correct horse battery staple",
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.preview.providerCount, 2);
  assert.equal(calls.filter(([type]) => type === "verify").length, 2);

  await assert.rejects(
    handlers.get("profile:verify")({ sender: { id: 8 } }, {
      importToken: inspected.importToken,
      passphrase: "correct horse battery staple",
    }),
    /已过期/,
  );
  const prepared = await handlers.get("profile:import")(event, {
    importToken: inspected.importToken,
    passphrase: "correct horse battery staple",
    sections: { ai: true },
  });
  assert.equal(calls.at(-1)[0], "prepare");
  await handlers.get("profile:rollback")(event, {
    transactionToken: prepared.transactionToken,
  });
  assert.deepEqual(calls.at(-1), [
    "rollback",
    "runtime-transaction-1",
  ]);
});

test("encrypted profile verification retires a token after five failed passwords", async () => {
  const { handlers } = createHarness({ includesSecrets: true });
  const event = { sender: { id: 11 } };
  const inspected = await handlers.get("profile:inspect")(event, {});
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      handlers.get("profile:verify")(event, {
        importToken: inspected.importToken,
        passphrase: "this is the wrong password",
      }),
      /口令错误/,
    );
  }
  await assert.rejects(
    handlers.get("profile:verify")(event, {
      importToken: inspected.importToken,
      passphrase: "correct horse battery staple",
    }),
    /已过期/,
  );
});

test("profile IPC bounds pending archive buffers and requires the exact sender", async () => {
  const { handlers } = createHarness();
  const event = { sender: { id: 21 } };
  const sessions = [];
  for (let index = 0; index < 5; index += 1) {
    sessions.push(await handlers.get("profile:inspect")(event, {}));
  }
  await assert.rejects(
    handlers.get("profile:import")(event, {
      importToken: sessions[0].importToken,
    }),
    /已过期/,
  );
  await assert.rejects(
    handlers.get("profile:import")({}, {
      importToken: sessions.at(-1).importToken,
    }),
    /已过期/,
  );
  const prepared = await handlers.get("profile:import")(event, {
    importToken: sessions.at(-1).importToken,
  });
  await assert.rejects(
    handlers.get("profile:commit")({}, {
      transactionToken: prepared.transactionToken,
    }),
    /无效或已过期/,
  );
  await handlers.get("profile:rollback")(event, {
    transactionToken: prepared.transactionToken,
  });
});

test("profile IPC rejects overlong passphrases instead of truncating them", async () => {
  const { handlers, calls } = createHarness();
  await assert.rejects(
    handlers.get("profile:export")({}, {
      includeSecrets: true,
      passphrase: "x".repeat(1025),
    }),
    /口令过长/,
  );
  assert.equal(calls.some(([type]) => type === "export"), false);
});

test("profile IPC transaction tokens are one-use and sender-bound", async () => {
  const { handlers, calls } = createHarness();
  const event = { sender: { id: 31 } };
  const inspected = await handlers.get("profile:inspect")(event, {});
  const prepared = await handlers.get("profile:import")(event, {
    importToken: inspected.importToken,
  });
  await assert.rejects(
    handlers.get("profile:commit")({ sender: { id: 32 } }, {
      transactionToken: prepared.transactionToken,
    }),
    /无效或已过期/,
  );
  await handlers.get("profile:commit")(event, {
    transactionToken: prepared.transactionToken,
  });
  await assert.rejects(
    handlers.get("profile:rollback")(event, {
      transactionToken: prepared.transactionToken,
    }),
    /无效或已过期/,
  );
  assert.equal(
    calls.filter(([type]) => type === "commit").length,
    1,
  );
});

test("expired profile transactions are discarded without committing main config", async () => {
  const { handlers, calls, advance } = createHarness();
  const event = { sender: { id: 41 } };
  const inspected = await handlers.get("profile:inspect")(event, {});
  const prepared = await handlers.get("profile:import")(event, {
    importToken: inspected.importToken,
  });
  advance(10 * 60 * 1000 + 1);
  await assert.rejects(
    handlers.get("profile:commit")(event, {
      transactionToken: prepared.transactionToken,
    }),
    /无效或已过期/,
  );
  assert.equal(calls.some(([type]) => type === "commit"), false);
  assert.deepEqual(calls.at(-1), [
    "rollback",
    "runtime-transaction-1",
  ]);
});

test("profile IPC rejects oversized current settings before opening a picker or entering runtime", async () => {
  const { handlers, calls } = createHarness();
  await assert.rejects(
    handlers.get("profile:export")({}, {
      preferences: {},
      templates: Array.from({ length: 1_001 }, (_, index) => ({ id: `template-${index}` })),
    }),
    /数组项目数量超过限制/,
  );
  await assert.rejects(
    handlers.get("profile:inspect")({}, {
      currentPreferences: {},
      currentTemplates: Array.from({ length: 1_001 }, (_, index) => ({ id: `template-${index}` })),
    }),
    /数组项目数量超过限制/,
  );
  assert.equal(calls.some(([type]) => type.endsWith("-dialog")), false);
  assert.equal(calls.some(([type]) => ["export", "read", "inspect"].includes(type)), false);
});
