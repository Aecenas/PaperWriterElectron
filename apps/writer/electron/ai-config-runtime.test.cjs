const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createAiConfigRuntime,
} = require("./ai-config-runtime.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultConfig() {
  return {
    activeProvider: "openai",
    activeModelId: "openai:model-a",
    taskModels: { applyResolver: {} },
    providers: {
      openai: {
        provider: "openai",
        providerLabel: "OpenAI",
        protocol: "openai",
        builtin: true,
        transport: "http",
        activeModelId: "openai:model-a",
        model: "model-a",
        models: [{
          id: "openai:model-a",
          name: "Model A",
          model: "model-a",
          requestParams: { temperature: 0.2 },
          testedOk: false,
          testedAt: "",
          testMessage: "",
        }],
        baseUrl: "https://api.openai.com/v1",
        apiKey: "stored-key",
      },
      codex: {
        provider: "codex",
        providerLabel: "Codex",
        protocol: "codex-cli",
        builtin: true,
        transport: "codex-cli",
        activeModelId: "codex:old",
        models: [{
          id: "codex:old",
          name: "Old",
          model: "old",
        }],
        baseUrl: "",
        apiKey: "",
      },
    },
  };
}

function createHarness(options = {}) {
  const calls = {
    atomicWrites: [],
    emittedStatuses: [],
    launchedLogins: [],
    logs: [],
    refreshInputs: [],
    testConfigs: [],
  };
  const state = {
    apiKeyReusable: true,
    config: clone(options.config || defaultConfig()),
    refreshDeferred: options.refreshDeferred || null,
    refreshStatus: options.refreshStatus || {
      installed: true,
      authenticated: true,
      executablePath: "C:\\tools\\codex.exe",
      message: "Codex CLI 可用",
      version: "1.2.3",
      email: "person@example.com",
      models: [{
        id: "codex:new",
        name: "New",
        model: "new",
        catalogDefault: true,
      }],
    },
    testDeferred: options.testDeferred || null,
    testError: options.testError || null,
    writeGate: null,
  };

  function normalizeAiConfig(value) {
    const normalized = clone(value || defaultConfig());
    normalized.taskModels ||= { applyResolver: {} };
    normalized.providers ||= {};
    return normalized;
  }

  const runtime = createAiConfigRuntime({
    fs: {
      async readFile() {
        return JSON.stringify(state.config);
      },
    },
    path,
    safeStorage: {},
    async atomicWriteFile(filePath, content) {
      calls.atomicWrites.push([filePath, content]);
      if (state.writeGate) {
        const gate = state.writeGate;
        state.writeGate = null;
        gate.started.resolve();
        await gate.release.promise;
      }
      state.config = JSON.parse(content);
    },
    getUserDataPath() {
      return "C:\\UserData";
    },
    getAppVersion() {
      return "0.9.11";
    },
    normalizeAiConfig,
    decryptProviderSecrets(value) {
      return value;
    },
    encryptProviderSecrets(value) {
      return value;
    },
    containsPlaintextSecrets() {
      return Boolean(options.containsPlaintextSecrets);
    },
    publicAiConfig(config, runtimes) {
      return {
        activeProvider: config.activeProvider,
        activeModelId: config.activeModelId,
        providers: clone(config.providers),
        runtime: clone(runtimes.codex),
      };
    },
    CODEX_PROVIDER_ID: "codex",
    async refreshCodexStatus(input) {
      calls.refreshInputs.push(input);
      if (state.refreshDeferred) {
        await state.refreshDeferred.promise;
      }
      return clone(state.refreshStatus);
    },
    mergeCodexRefreshedModels(_existing, refreshed) {
      return clone(refreshed);
    },
    launchCodexLogin(executablePath, callback) {
      calls.launchedLogins.push([executablePath, callback]);
    },
    emitCodexStatus(config) {
      calls.emittedStatuses.push(config);
    },
    AI_PROTOCOLS: {
      openai: { baseUrl: "https://api.openai.com/v1" },
      anthropic: { baseUrl: "https://api.anthropic.com/v1" },
    },
    BUILTIN_AI_PROVIDERS: {
      openai: {},
      codex: {},
    },
    normalizeAiRequestParams(value) {
      return clone(value || {});
    },
    exactAiProviderConfig() {
      return null;
    },
    normalizeAiModelConfig(provider, model, index = 0) {
      return {
        testedOk: false,
        testedAt: "",
        testMessage: "",
        requestParams: {},
        ...clone(model || {}),
        id: String(model?.id || `${provider}:model-${index}`),
      };
    },
    createAiModelId(provider, model) {
      return `${provider}:${model}`;
    },
    normalizeAiProtocol(value) {
      return value === "anthropic" ? "anthropic" : "openai";
    },
    normalizeProviderBaseUrl(value) {
      return String(value || "").replace(/\/+$/, "");
    },
    apiKeyCanBeReused() {
      return state.apiKeyReusable;
    },
    createAiTestConfigIdentity(value) {
      return JSON.stringify(value);
    },
    async commitAiTestResultIfCurrent({
      expectedIdentity,
      readCurrent,
      identityFromCurrent,
      commit,
    }) {
      const current = await readCurrent();
      if (identityFromCurrent(current) !== expectedIdentity) {
        return { stale: true, config: current };
      }
      return {
        stale: false,
        config: await commit(current),
      };
    },
    randomUUID() {
      return "11111111-2222-4333-8444-555555555555";
    },
    async testAiConfig(config) {
      calls.testConfigs.push(config);
      if (state.testDeferred) {
        await state.testDeferred.promise;
      }
      if (state.testError) {
        throw state.testError;
      }
      return { ok: true, message: "AI 连接可用" };
    },
    async writeDebugLog(...args) {
      calls.logs.push(args);
    },
    now() {
      return new Date("2026-07-25T12:00:00.000Z");
    },
  });

  return {
    calls,
    runtime,
    state,
  };
}

test("a stale provider test cannot overwrite a newer stored configuration", async () => {
  const connection = deferred();
  const harness = createHarness({ testDeferred: connection });
  const testing = harness.runtime.facade.testConfig({
    provider: "openai",
    modelId: "openai:model-a",
  });
  while (!harness.calls.testConfigs.length) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  harness.state.config.providers.openai.models[0].model = "newer-model";
  harness.state.config.providers.openai.models[0].name = "Newer Model";
  connection.resolve();
  const result = await testing;

  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(result.message, "AI 配置已变化，请重新测试");
  assert.equal(
    result.providers.openai.models[0].model,
    "newer-model",
  );
  assert.deepEqual(harness.calls.atomicWrites, []);
  assert.deepEqual(harness.calls.logs, [[
    "ai:test:stale",
    { provider: "openai", model: "model-a" },
  ]]);
});

test("a current provider test commits with its captured identity and exact public result", async () => {
  const harness = createHarness();
  const result = await harness.runtime.facade.testConfig({
    provider: "openai",
    modelId: "openai:model-a",
    modelName: "Renamed",
    model: "model-new",
    baseUrl: "https://api.openai.com/v1/",
    apiKey: " fresh-key ",
  });

  assert.equal(result.ok, true);
  assert.equal(result.message, "AI 连接可用");
  assert.deepEqual(harness.calls.testConfigs, [{
    provider: "openai",
    providerLabel: "OpenAI",
    protocol: "openai",
    builtin: true,
    modelId: "openai:model-a",
    modelName: "Renamed",
    model: "model-new",
    requestParams: { temperature: 0.2 },
    baseUrl: "https://api.openai.com/v1",
    apiKey: "fresh-key",
  }]);
  assert.equal(
    harness.state.config.providers.openai.models[0].testedOk,
    true,
  );
  assert.equal(
    harness.state.config.providers.openai.models[0].testedAt,
    "2026-07-25T12:00:00.000Z",
  );
  assert.deepEqual(harness.calls.logs, [[
    "ai:test:success",
    { provider: "openai", model: "model-new" },
  ]]);
});

test("a failed cross-origin test neither reuses nor logs the stored secret", async () => {
  const harness = createHarness();
  harness.state.apiKeyReusable = false;
  const result = await harness.runtime.facade.testConfig({
    provider: "openai",
    modelId: "openai:model-a",
    baseUrl: "https://other.example/v1",
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.message,
    "Base URL 的服务来源已改变，请重新输入 API Key 后再测试",
  );
  assert.deepEqual(harness.calls.testConfigs, []);
  assert.equal(
    harness.state.config.providers.openai.baseUrl,
    "https://api.openai.com/v1",
  );
  assert.equal(
    harness.state.config.providers.openai.apiKey,
    "stored-key",
  );
  assert.equal(
    JSON.stringify(harness.calls.logs).includes("stored-key"),
    false,
  );
});

test("a stale failed connection result also preserves the newer configuration", async () => {
  const connection = deferred();
  const harness = createHarness({
    testDeferred: connection,
    testError: new Error("connection failed"),
  });
  const testing = harness.runtime.facade.testConfig({
    provider: "openai",
    modelId: "openai:model-a",
  });
  while (!harness.calls.testConfigs.length) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  harness.state.config.providers.openai.models[0].name =
    "Newer Model";
  connection.resolve();

  const result = await testing;
  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(
    result.providers.openai.models[0].name,
    "Newer Model",
  );
  assert.deepEqual(harness.calls.atomicWrites, []);
  assert.deepEqual(harness.calls.logs, [[
    "ai:test:stale",
    {
      provider: "openai",
      model: undefined,
      message: "connection failed",
    },
  ]]);
});

test("provider create, delete, and save mutations keep public result and audit shapes", async () => {
  const harness = createHarness();
  const created = await harness.runtime.facade.createProvider({
    providerLabel: "Custom",
    protocol: "openai",
  });
  assert.equal(
    created.createdProvider,
    "custom-11111111-2222-4333-8444-555555555555",
  );
  assert.equal(created.ok, true);

  const deleted = await harness.runtime.facade.deleteProvider(
    created.createdProvider,
  );
  assert.equal(deleted.ok, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      deleted.providers,
      created.createdProvider,
    ),
    false,
  );

  const saved = await harness.runtime.facade.saveConfig({
    provider: "openai",
    modelId: "openai:model-a",
    model: "model-saved",
  });
  assert.equal(
    saved.providers.openai.models[0].model,
    "model-saved",
  );
  assert.deepEqual(harness.calls.logs, [
    ["ai:provider:created", {
      provider: created.createdProvider,
      protocol: "openai",
    }],
    ["ai:provider:deleted", {
      provider: created.createdProvider,
    }],
    ["ai:config:saved", {
      provider: "openai",
      model: "model-saved",
      hasApiKey: false,
    }],
  ]);
});

test("Codex refresh re-reads the latest config after a slow scan before merging and persisting", async () => {
  const scan = deferred();
  const harness = createHarness({ refreshDeferred: scan });
  const refreshing = harness.runtime.facade.refreshCodex();
  while (!harness.calls.refreshInputs.length) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  harness.state.config.providers.openai.baseUrl =
    "https://latest.example/v1";
  harness.state.config.providers.custom = {
    provider: "custom",
    providerLabel: "Latest",
    protocol: "openai",
    builtin: false,
    activeModelId: "",
    models: [],
    baseUrl: "https://latest.example/v1",
    apiKey: "latest-key",
  };
  scan.resolve();
  const result = await refreshing;

  assert.equal(
    harness.state.config.providers.openai.baseUrl,
    "https://latest.example/v1",
  );
  assert.equal(
    harness.state.config.providers.custom.providerLabel,
    "Latest",
  );
  assert.equal(
    harness.state.config.providers.codex.activeModelId,
    "codex:new",
  );
  assert.equal(result.ok, true);
  assert.equal(result.message, "Codex CLI 可用");
  assert.equal(result.runtime.ready, true);
  assert.equal(result.runtime.accountLabel, "pe•••@example.com");
  assert.deepEqual(harness.calls.refreshInputs, [{
    previousModels: [{
      id: "codex:old",
      name: "Old",
      model: "old",
    }],
    appVersion: "0.9.11",
  }]);
});

test("all config mutations share one serial tail", async () => {
  const harness = createHarness();
  const gate = {
    release: deferred(),
    started: deferred(),
  };
  harness.state.writeGate = gate;
  const first = harness.runtime.facade.saveConfig({
    provider: "openai",
    modelId: "openai:model-a",
    model: "model-first",
  });
  await gate.started.promise;
  const second = harness.runtime.facade.saveConfig({
    provider: "openai",
    modelId: "openai:model-a",
    model: "model-second",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.calls.atomicWrites.length, 1);

  gate.release.resolve();
  await Promise.all([first, second]);
  assert.equal(harness.calls.atomicWrites.length, 2);
  assert.equal(
    harness.state.config.providers.openai.models[0].model,
    "model-second",
  );
});

test("initialization preserves plaintext migration and login/status facade contracts", async () => {
  const harness = createHarness({
    containsPlaintextSecrets: true,
  });
  await harness.runtime.initialize();
  assert.equal(harness.calls.atomicWrites.length, 1);

  harness.state.refreshStatus = {
    installed: false,
    authenticated: false,
    ready: false,
    message: "未安装",
    models: [],
  };
  const unavailable = await harness.runtime.facade.startLogin();
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.message, "未检测到 Codex CLI");
  assert.deepEqual(harness.calls.launchedLogins, []);
});
