const assert = require("node:assert/strict");
const test = require("node:test");

const {
  registerAiConfigIpcHandlers,
} = require("./ai-config-ipc.cjs");

test("registers the complete AI configuration surface through one facade", () => {
  const handlers = new Map();
  registerAiConfigIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false);
        handlers.set(channel, handler);
      },
    },
    configFacade: {
      getConfig() {},
      refreshCodex() {},
      startLogin() {},
      createProvider() {},
      deleteProvider() {},
      saveConfig() {},
      testConfig() {},
    },
  });
  assert.deepEqual([...handlers.keys()].sort(), [
    "ai:create-provider",
    "ai:delete-provider",
    "ai:get-config",
    "ai:refresh-codex",
    "ai:save-config",
    "ai:start-codex-login",
    "ai:test-config",
  ]);
});

test("forwards config payloads while preserving defaults, normalization, and results", async () => {
  const handlers = new Map();
  const calls = [];
  const configFacade = {
    getConfig(...args) {
      calls.push(["getConfig", ...args]);
      return { config: true };
    },
    refreshCodex(...args) {
      calls.push(["refreshCodex", ...args]);
      return { refreshed: true };
    },
    startLogin(...args) {
      calls.push(["startLogin", ...args]);
      return { login: true };
    },
    createProvider(...args) {
      calls.push(["createProvider", ...args]);
      return { created: true };
    },
    deleteProvider(...args) {
      calls.push(["deleteProvider", ...args]);
      return { deleted: true };
    },
    saveConfig(...args) {
      calls.push(["saveConfig", ...args]);
      return { saved: true };
    },
    testConfig(...args) {
      calls.push(["testConfig", ...args]);
      return { tested: true };
    },
  };
  registerAiConfigIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
    configFacade,
  });

  const event = { sender: { id: "renderer" } };
  const createInput = { providerLabel: "Custom" };
  const patch = { provider: "openai" };
  assert.deepEqual(
    await handlers.get("ai:get-config")(event),
    { config: true },
  );
  assert.deepEqual(
    await handlers.get("ai:refresh-codex")(event),
    { refreshed: true },
  );
  assert.deepEqual(
    await handlers.get("ai:start-codex-login")(event),
    { login: true },
  );
  assert.deepEqual(
    await handlers.get("ai:create-provider")(event, createInput),
    { created: true },
  );
  assert.deepEqual(
    await handlers.get("ai:create-provider")(event),
    { created: true },
  );
  assert.deepEqual(
    await handlers.get("ai:delete-provider")(event, 123),
    { deleted: true },
  );
  assert.deepEqual(
    await handlers.get("ai:save-config")(event, patch),
    { saved: true },
  );
  assert.deepEqual(
    await handlers.get("ai:save-config")(event),
    { saved: true },
  );
  assert.deepEqual(
    await handlers.get("ai:test-config")(event),
    { tested: true },
  );
  assert.deepEqual(calls, [
    ["getConfig"],
    ["refreshCodex"],
    ["startLogin"],
    ["createProvider", createInput],
    ["createProvider", {}],
    ["deleteProvider", "123"],
    ["saveConfig", patch],
    ["saveConfig", {}],
    ["testConfig", {}],
  ]);
});
