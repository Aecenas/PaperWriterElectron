const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  createAiGenerationRuntime,
} = require("./ai-generation-runtime.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHarness(options = {}) {
  const calls = {
    activeConfigs: [],
    applyParams: [],
    atomicWrites: [],
    codexScopes: [],
    codexStreams: [],
    debugLogs: [],
    httpApply: [],
    httpStreams: [],
    materializedImages: [],
    mergedParams: [],
    configReads: 0,
    rendererEvents: [],
    saveDialogs: [],
    taskResolvers: [],
  };
  const state = {
    aiConfig: options.aiConfig || {
      taskModels: { applyResolver: {} },
    },
    codexCompletion: options.codexCompletion || deferred(),
    httpCompletion: options.httpCompletion || deferred(),
    resolver: Object.prototype.hasOwnProperty.call(options, "resolver")
      ? options.resolver
      : {
        transport: "http",
        provider: "openai",
        providerLabel: "OpenAI",
        protocol: "openai",
        modelId: "openai:gpt-5",
        modelName: "GPT-5",
        model: "gpt-5",
        apiKey: "secret",
        testedOk: true,
        requestParams: { temperature: 0.2 },
      },
    runtimeStatus: options.runtimeStatus || {
      ready: true,
      executablePath: "C:\\tools\\codex.exe",
      message: "Codex CLI 可用",
    },
    selectedConfig: Object.prototype.hasOwnProperty.call(
      options,
      "selectedConfig",
    )
      ? options.selectedConfig
      : {
        transport: "http",
        provider: "openai",
        providerLabel: "OpenAI",
        protocol: "openai",
        modelId: "openai:gpt-5",
        modelName: "GPT-5",
        model: "gpt-5",
        apiKey: "secret",
        testedOk: true,
      },
  };
  const mainWindow = { id: "main-window" };
  const runtime = createAiGenerationRuntime({
    async readAiConfig() {
      calls.configReads += 1;
      if (options.readAiConfigImpl) {
        return options.readAiConfigImpl(calls.configReads);
      }
      return state.aiConfig;
    },
    activeAiProviderConfig(config, provider, modelId) {
      calls.activeConfigs.push([config, provider, modelId]);
      return state.selectedConfig;
    },
    getCodexRuntimeStatus() {
      return state.runtimeStatus;
    },
    streamAiCompletion(...args) {
      calls.httpStreams.push(args);
      return state.httpCompletion.promise;
    },
    async resolveAiApplyHttp(...args) {
      calls.httpApply.push(args);
      return options.resolverRaw
        || "{\"operation\":\"insert_after\"}";
    },
    throwIfAiAborted(signal) {
      if (signal.aborted) {
        throw signal.reason || new Error("aborted");
      }
    },
    taskAiProviderConfig(config, taskModel) {
      calls.taskResolvers.push([config, taskModel]);
      return state.resolver;
    },
    aiApplyResolverRequestParams(provider, protocol, requestParams) {
      calls.applyParams.push([provider, protocol, requestParams]);
      return { ...requestParams, normalized: true };
    },
    mergeAiRequestParams(base, patch) {
      calls.mergedParams.push([base, patch]);
      return { ...base, ...patch };
    },
    async resolveCodexScopeDirectory(input) {
      calls.codexScopes.push(input);
      return {
        cwd: "C:\\isolated",
        scope: { mode: "isolated-test", relativePath: "" },
        cleanup: async () => {},
      };
    },
    async streamCodexCompletion(input) {
      calls.codexStreams.push(input);
      if (options.codexStreamImpl) {
        return options.codexStreamImpl(input);
      }
      return state.codexCompletion.promise;
    },
    normalizeCodexImageMode(value) {
      return value === "original" ? "original" : "none";
    },
    async materializeCodexImageAttachments(input) {
      calls.materializedImages.push(input);
      return {
        attachments: [{ name: "image-1" }],
        imagePaths: ["C:\\temp\\image.png"],
        cleanup: async () => {},
      };
    },
    readProtocolAsset: options.readProtocolAsset || (() => {}),
    path,
    getTempPath() {
      return "C:\\Temp";
    },
    emitRendererEvent(...args) {
      calls.rendererEvents.push(args);
    },
    async writeDebugLog(...args) {
      calls.debugLogs.push(args);
    },
    dialog: {
      async showSaveDialog(...args) {
        calls.saveDialogs.push(args);
        return options.dialogResult || {
          canceled: false,
          filePath: "C:\\exports\\chat.md",
        };
      },
    },
    getMainWindow() {
      return mainWindow;
    },
    defaultDocumentsDir() {
      return "C:\\Documents";
    },
    sanitizeName(value) {
      return `safe-${value}`;
    },
    timestampForFileName() {
      return "20260725-120000";
    },
    async atomicWriteFile(...args) {
      calls.atomicWrites.push(args);
    },
    concurrentRequestLimit: options.concurrentRequestLimit,
  });
  return {
    calls,
    mainWindow,
    runtime,
    state,
  };
}

function validPayload(overrides = {}) {
  return {
    requestId: "ai-abc123",
    messages: [{ role: "user", content: "hello" }],
    ...overrides,
  };
}

test("generation rejects malformed, duplicate, and over-limit request ids without replacing controllers", async () => {
  const harness = createHarness({ concurrentRequestLimit: 4 });
  const event = { sender: { id: "renderer" } };

  assert.deepEqual(
    await harness.runtime.facade.generate(
      event,
      validPayload({ requestId: "ai-short" }),
    ),
    { ok: false, message: "AI 请求缺少内容" },
  );
  assert.deepEqual(
    await harness.runtime.facade.generate(
      event,
      validPayload({ messages: [{ role: "user", content: "  " }] }),
    ),
    { ok: false, message: "AI 请求缺少内容" },
  );
  assert.equal(harness.calls.activeConfigs.length, 0);

  assert.deepEqual(
    await harness.runtime.facade.generate(event, validPayload()),
    { ok: true, requestId: "ai-abc123" },
  );
  const originalSignal = harness.calls.httpStreams[0][4];
  assert.deepEqual(
    await harness.runtime.facade.generate(event, validPayload()),
    { ok: false, message: "AI 请求标识重复" },
  );
  assert.equal(harness.calls.httpStreams.length, 1);
  assert.equal(harness.calls.httpStreams[0][4], originalSignal);

  for (const requestId of [
    "ai-active00",
    "ai-active01",
    "ai-active02",
  ]) {
    assert.equal(
      (
        await harness.runtime.facade.generate(
          event,
          validPayload({ requestId }),
        )
      ).ok,
      true,
    );
  }
  assert.deepEqual(
    await harness.runtime.facade.generate(
      event,
      validPayload({ requestId: "ai-overlimit" }),
    ),
    {
      ok: false,
      message: "同时运行的 AI 请求过多，请等待当前生成完成",
    },
  );
  assert.equal(harness.runtime.getActiveRequestCount(), 4);
  harness.runtime.abortAll();
});

test("reserves a request id before a deferred configuration read can admit a duplicate", async () => {
  const configRead = deferred();
  const harness = createHarness({
    readAiConfigImpl: () => configRead.promise,
  });
  const event = { sender: { id: "renderer" } };

  const first = harness.runtime.facade.generate(
    event,
    validPayload(),
  );
  assert.equal(harness.runtime.getActiveRequestCount(), 1);
  assert.equal(harness.calls.configReads, 1);
  assert.deepEqual(
    await harness.runtime.facade.generate(event, validPayload()),
    { ok: false, message: "AI 请求标识重复" },
  );
  assert.equal(harness.calls.configReads, 1);

  configRead.resolve(harness.state.aiConfig);
  assert.deepEqual(await first, {
    ok: true,
    requestId: "ai-abc123",
  });
  assert.equal(harness.calls.httpStreams.length, 1);
  harness.runtime.abortAll();
});

test("counts every deferred configuration reservation toward the concurrent request limit", async () => {
  const configRead = deferred();
  const harness = createHarness({
    concurrentRequestLimit: 2,
    readAiConfigImpl: () => configRead.promise,
  });
  const event = { sender: { id: "renderer" } };

  const first = harness.runtime.facade.generate(
    event,
    validPayload({ requestId: "ai-limit01" }),
  );
  const second = harness.runtime.facade.generate(
    event,
    validPayload({ requestId: "ai-limit02" }),
  );
  assert.equal(harness.runtime.getActiveRequestCount(), 2);
  assert.equal(harness.calls.configReads, 2);
  assert.deepEqual(
    await harness.runtime.facade.generate(
      event,
      validPayload({ requestId: "ai-limit03" }),
    ),
    {
      ok: false,
      message: "同时运行的 AI 请求过多，请等待当前生成完成",
    },
  );
  assert.equal(harness.calls.configReads, 2);

  configRead.resolve(harness.state.aiConfig);
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(harness.calls.httpStreams.length, 2);
  harness.runtime.abortAll();
});

test("cancel sees a request waiting for configuration and prevents its transport from starting", async () => {
  const configRead = deferred();
  const harness = createHarness({
    readAiConfigImpl: () => configRead.promise,
  });
  const generation = harness.runtime.facade.generate(
    { sender: { id: "renderer" } },
    validPayload(),
  );

  assert.equal(harness.runtime.getActiveRequestCount(), 1);
  assert.deepEqual(
    await harness.runtime.facade.cancel("ai-abc123"),
    { ok: true, canceled: true },
  );
  assert.equal(harness.runtime.getActiveRequestCount(), 1);
  configRead.resolve(harness.state.aiConfig);

  assert.deepEqual(await generation, {
    ok: false,
    message: "已停止生成",
  });
  assert.equal(harness.runtime.getActiveRequestCount(), 0);
  assert.deepEqual(harness.calls.httpStreams, []);
  assert.deepEqual(harness.calls.codexStreams, []);
  assert.deepEqual(harness.calls.rendererEvents, []);
  assert.deepEqual(harness.calls.debugLogs, []);
});

test("abortAll clears requests waiting for configuration and prevents late startup", async () => {
  const configRead = deferred();
  const harness = createHarness({
    readAiConfigImpl: () => configRead.promise,
  });
  const generation = harness.runtime.facade.generate(
    { sender: { id: "renderer" } },
    validPayload(),
  );

  assert.equal(harness.runtime.getActiveRequestCount(), 1);
  harness.runtime.abortAll();
  assert.equal(harness.runtime.getActiveRequestCount(), 0);
  configRead.resolve(harness.state.aiConfig);

  assert.deepEqual(await generation, {
    ok: false,
    message: "已停止生成",
  });
  assert.equal(harness.runtime.getActiveRequestCount(), 0);
  assert.deepEqual(harness.calls.httpStreams, []);
  assert.deepEqual(harness.calls.codexStreams, []);
  assert.deepEqual(harness.calls.rendererEvents, []);
});

test("a stale configuration read cannot delete or start over a newer same-id reservation", async () => {
  const oldConfigRead = deferred();
  const newConfigRead = deferred();
  const configReads = [oldConfigRead, newConfigRead];
  const harness = createHarness({
    readAiConfigImpl: () => configReads.shift().promise,
  });
  const oldGeneration = harness.runtime.facade.generate(
    { sender: { id: "old-renderer" } },
    validPayload(),
  );
  harness.runtime.abortAll();

  const newSender = { id: "new-renderer" };
  const newGeneration = harness.runtime.facade.generate(
    { sender: newSender },
    validPayload(),
  );
  assert.equal(harness.runtime.getActiveRequestCount(), 1);
  newConfigRead.resolve(harness.state.aiConfig);
  assert.deepEqual(await newGeneration, {
    ok: true,
    requestId: "ai-abc123",
  });
  assert.equal(harness.calls.httpStreams.length, 1);
  const newSignal = harness.calls.httpStreams[0][4];
  assert.equal(newSignal.aborted, false);

  oldConfigRead.resolve(harness.state.aiConfig);
  assert.deepEqual(await oldGeneration, {
    ok: false,
    message: "已停止生成",
  });
  assert.equal(harness.runtime.getActiveRequestCount(), 1);
  assert.equal(harness.calls.httpStreams.length, 1);
  assert.equal(harness.calls.httpStreams[0][4], newSignal);
  assert.deepEqual(harness.calls.rendererEvents, []);

  const usage = { outputTokens: 7 };
  harness.state.httpCompletion.resolve(usage);
  await flushAsyncWork();
  assert.deepEqual(harness.calls.rendererEvents, [[
    newSender,
    "ai:done",
    { requestId: "ai-abc123", usage },
  ]]);
  assert.equal(harness.runtime.getActiveRequestCount(), 0);
});

test("configuration read failures release only their own reservation", async () => {
  const harness = createHarness({
    readAiConfigImpl(readNumber) {
      if (readNumber === 1) {
        throw new Error("config unavailable");
      }
      return harness.state.aiConfig;
    },
  });
  const event = { sender: { id: "renderer" } };

  await assert.rejects(
    harness.runtime.facade.generate(event, validPayload()),
    /config unavailable/,
  );
  assert.equal(harness.runtime.getActiveRequestCount(), 0);
  assert.deepEqual(
    await harness.runtime.facade.generate(event, validPayload()),
    { ok: true, requestId: "ai-abc123" },
  );
  assert.equal(harness.runtime.getActiveRequestCount(), 1);
  harness.runtime.abortAll();
});

test("generate returns immediately, emits done, and deletes only its own settled controller", async () => {
  const harness = createHarness();
  const sender = { id: "renderer" };
  const payload = validPayload({
    provider: "openai",
    modelId: "openai:gpt-5",
  });

  assert.deepEqual(
    await harness.runtime.facade.generate({ sender }, payload),
    { ok: true, requestId: "ai-abc123" },
  );
  const signal = harness.calls.httpStreams[0][4];
  assert.ok(signal instanceof AbortSignal);
  assert.deepEqual(harness.calls.activeConfigs, [[
    harness.state.aiConfig,
    "openai",
    "openai:gpt-5",
  ]]);
  assert.equal(harness.calls.httpStreams[0][0], sender);
  assert.equal(harness.calls.httpStreams[0][1], "ai-abc123");
  assert.equal(harness.calls.httpStreams[0][2], harness.state.selectedConfig);
  assert.deepEqual(harness.calls.httpStreams[0][3], payload.messages);
  assert.equal(harness.calls.httpStreams[0][4], signal);

  const usage = { inputTokens: 12, outputTokens: 34 };
  harness.state.httpCompletion.resolve(usage);
  await flushAsyncWork();

  assert.deepEqual(harness.calls.rendererEvents, [[
    sender,
    "ai:done",
    { requestId: "ai-abc123", usage },
  ]]);
  assert.equal(harness.runtime.getActiveRequestCount(), 0);
});

test("generation requires tested HTTP credentials and a ready Codex runtime before starting", async () => {
  const event = { sender: { id: "renderer" } };
  const http = createHarness({
    selectedConfig: {
      transport: "http",
      apiKey: "",
      testedOk: false,
    },
  });
  assert.deepEqual(
    await http.runtime.facade.generate(event, validPayload()),
    { ok: false, message: "请选择已测试可用的 AI 模型" },
  );
  assert.deepEqual(http.calls.httpStreams, []);
  assert.equal(http.runtime.getActiveRequestCount(), 0);

  const codex = createHarness({
    selectedConfig: {
      transport: "codex-cli",
      model: "gpt-5",
    },
    runtimeStatus: {
      ready: false,
      executablePath: "",
      message: "Codex 尚未登录",
    },
  });
  assert.deepEqual(
    await codex.runtime.facade.generate(event, validPayload()),
    { ok: false, message: "Codex 尚未登录" },
  );
  assert.deepEqual(codex.calls.codexStreams, []);
  assert.equal(codex.runtime.getActiveRequestCount(), 0);
});

test("cancel aborts only the current controller and waits for identity-safe settlement", async () => {
  const harness = createHarness();
  const sender = { id: "renderer" };
  await harness.runtime.facade.generate({ sender }, validPayload());
  const signal = harness.calls.httpStreams[0][4];

  assert.deepEqual(
    await harness.runtime.facade.cancel("ai-abc123"),
    { ok: true, canceled: true },
  );
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.message, "已停止生成");
  assert.equal(harness.runtime.getActiveRequestCount(), 1);
  assert.deepEqual(
    await harness.runtime.facade.cancel("ai-missing"),
    { ok: true, canceled: false },
  );

  harness.state.httpCompletion.reject(signal.reason);
  await flushAsyncWork();

  assert.deepEqual(harness.calls.debugLogs, [[
    "ai:generate:error",
    {
      requestId: "ai-abc123",
      aborted: true,
      message: "已停止生成",
    },
  ]]);
  assert.deepEqual(harness.calls.rendererEvents, [[
    sender,
    "ai:error",
    {
      requestId: "ai-abc123",
      message: "已停止生成",
      aborted: true,
    },
  ]]);
  assert.equal(harness.runtime.getActiveRequestCount(), 0);
});

test("abortAll clears the registry and a late old settlement cannot emit or delete a newer same-id request", async () => {
  const oldCompletion = deferred();
  const harness = createHarness({ httpCompletion: oldCompletion });
  const oldSender = { id: "old-renderer" };
  await harness.runtime.facade.generate(
    { sender: oldSender },
    validPayload(),
  );
  const oldSignal = harness.calls.httpStreams[0][4];

  harness.runtime.abortAll();
  assert.equal(oldSignal.aborted, true);
  assert.equal(harness.runtime.getActiveRequestCount(), 0);

  const newCompletion = deferred();
  harness.state.httpCompletion = newCompletion;
  const newSender = { id: "new-renderer" };
  await harness.runtime.facade.generate(
    { sender: newSender },
    validPayload(),
  );
  const newSignal = harness.calls.httpStreams[1][4];
  assert.notEqual(newSignal, oldSignal);

  oldCompletion.reject(new Error("late old failure"));
  await flushAsyncWork();
  assert.equal(harness.runtime.getActiveRequestCount(), 1);
  assert.equal(harness.calls.httpStreams[1][4], newSignal);
  assert.deepEqual(harness.calls.debugLogs, []);
  assert.deepEqual(harness.calls.rendererEvents, []);

  const usage = { outputTokens: 8 };
  newCompletion.resolve(usage);
  await flushAsyncWork();
  assert.deepEqual(harness.calls.rendererEvents, [[
    newSender,
    "ai:done",
    { requestId: "ai-abc123", usage },
  ]]);
  assert.equal(harness.runtime.getActiveRequestCount(), 0);
});

test("Codex generation keeps the payload scope, assets, cancellation signal, and event contract", async () => {
  const harness = createHarness({
    selectedConfig: {
      transport: "codex-cli",
      provider: "codex",
      model: "gpt-5",
    },
  });
  const event = { sender: { id: "renderer" }, frameId: 7 };
  const payload = validPayload({
    codexScope: { mode: "document-only", relativePath: "" },
    codexImageMode: "original",
    codexImages: [{ id: "image-1" }],
  });

  assert.deepEqual(
    await harness.runtime.facade.generate(event, payload),
    { ok: true, requestId: "ai-abc123" },
  );
  await flushAsyncWork();
  assert.deepEqual(harness.calls.codexScopes, [{
    scope: payload.codexScope,
    tempRoot: path.join("C:\\Temp", "PaperWriterCodex"),
  }]);
  assert.equal(harness.calls.materializedImages.length, 1);
  assert.equal(
    harness.calls.materializedImages[0].readProtocolAsset
      instanceof Function,
    true,
  );
  const signal = harness.calls.codexStreams[0].signal;
  assert.ok(signal instanceof AbortSignal);
  assert.deepEqual(
    harness.calls.codexStreams[0].attachments,
    [{ name: "image-1" }],
  );

  harness.calls.codexStreams[0].onDelta("chunk");
  assert.deepEqual(harness.calls.rendererEvents, [[
    event.sender,
    "ai:chunk",
    { requestId: "ai-abc123", delta: "chunk" },
  ]]);
  harness.state.codexCompletion.resolve({ outputTokens: 3 });
  await flushAsyncWork();
  assert.equal(harness.runtime.getActiveRequestCount(), 0);
});

test("apply resolver merges explicit HTTP parameters and gives Codex a document-only scope", async () => {
  const taskModel = {
    providerId: "openai",
    modelId: "openai:gpt-5",
    requestParams: { temperature: 0.7, maxTokens: 900 },
  };
  const harness = createHarness({
    aiConfig: {
      taskModels: { applyResolver: taskModel },
    },
  });
  const payload = {
    manifest: { documentFingerprint: "doc", blocks: [] },
    selectedBlock: { type: "paragraph", text: "optimized" },
    optimizationContext: { selectedIndex: 2 },
    repair: { code: "invalid_anchor", previousRaw: "{bad}" },
  };

  const result = await harness.runtime.facade.resolveApply(payload);
  assert.deepEqual(harness.calls.taskResolvers, [[
    harness.state.aiConfig,
    taskModel,
  ]]);
  assert.deepEqual(harness.calls.mergedParams, [[
    { temperature: 0.2 },
    taskModel.requestParams,
  ]]);
  assert.deepEqual(harness.calls.applyParams, [[
    "openai",
    "openai",
    { temperature: 0.7, maxTokens: 900 },
  ]]);
  assert.equal(harness.calls.httpApply.length, 1);
  assert.deepEqual(
    harness.calls.httpApply[0][0].requestParams,
    {
      temperature: 0.7,
      maxTokens: 900,
      normalized: true,
    },
  );
  assert.deepEqual(result, {
    ok: true,
    raw: "{\"operation\":\"insert_after\"}",
    model: {
      providerId: "openai",
      providerLabel: "OpenAI",
      modelId: "openai:gpt-5",
      modelName: "GPT-5",
    },
  });

  const codex = createHarness({
    resolver: {
      transport: "codex-cli",
      provider: "codex",
      providerLabel: "Codex",
      modelId: "codex:gpt-5",
      modelName: "GPT-5",
      model: "gpt-5",
      testedOk: true,
      requestParams: { ignored: true },
    },
    codexStreamImpl(input) {
      input.onDelta("{\"action\":\"unresolved\"}");
      return Promise.resolve();
    },
  });
  await codex.runtime.facade.resolveApply({});
  assert.deepEqual(codex.calls.mergedParams, []);
  assert.deepEqual(codex.calls.applyParams, []);
  assert.deepEqual(codex.calls.codexStreams[0].scope, {
    mode: "document-only",
    relativePath: "",
  });
  assert.equal(codex.calls.codexStreams[0].cwd, "C:\\Temp");
});

test("apply resolver preserves explicit, default, and Codex readiness errors", async () => {
  const missingExplicit = createHarness({
    aiConfig: {
      taskModels: {
        applyResolver: {
          providerId: "missing",
          modelId: "missing:model",
        },
      },
    },
    resolver: null,
  });
  await assert.rejects(
    missingExplicit.runtime.facade.resolveApply({}),
    /应用裁决模型已失效，请在“AI 配置 → 任务模型”中重新选择/,
  );

  const missingDefault = createHarness({ resolver: null });
  await assert.rejects(
    missingDefault.runtime.facade.resolveApply({}),
    /请先在“AI 配置”中配置并测试至少一个可用的默认模型/,
  );

  const invalidDefault = createHarness({
    resolver: {
      transport: "http",
      apiKey: "",
      testedOk: false,
    },
  });
  await assert.rejects(
    invalidDefault.runtime.facade.resolveApply({}),
    /默认模型不可用，请在“AI 配置”中重新配置并测试/,
  );

  const unavailableCodex = createHarness({
    resolver: {
      transport: "codex-cli",
      testedOk: true,
    },
    runtimeStatus: { ready: false },
  });
  await assert.rejects(
    unavailableCodex.runtime.facade.resolveApply({}),
    /默认 Codex CLI 当前不可用，请在“AI 配置”中重新检查/,
  );
});

test("chat export preserves picker, atomic write, cancellation, and size-limit contracts", async () => {
  const harness = createHarness();
  assert.deepEqual(
    await harness.runtime.facade.exportChat({
      title: "Discussion",
      markdown: "# Chat",
    }),
    { canceled: false, path: "C:\\exports\\chat.md" },
  );
  assert.deepEqual(harness.calls.saveDialogs[0], [
    harness.mainWindow,
    {
      title: "另存 AI 问答记录",
      defaultPath: path.join(
        "C:\\Documents",
        "safe-Discussion-AI问答-20260725-120000.md",
      ),
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "Text", extensions: ["txt"] },
      ],
    },
  ]);
  assert.deepEqual(harness.calls.atomicWrites, [[
    "C:\\exports\\chat.md",
    "# Chat",
  ]]);

  const canceled = createHarness({
    dialogResult: { canceled: true },
  });
  assert.deepEqual(
    await canceled.runtime.facade.exportChat({}),
    { canceled: true },
  );
  assert.deepEqual(canceled.calls.atomicWrites, []);

  const oversized = createHarness();
  await assert.rejects(
    oversized.runtime.facade.exportChat({
      markdown: "x".repeat((16 * 1024 * 1024) + 1),
    }),
    /AI 问答记录过大，已拒绝导出/,
  );
  assert.deepEqual(oversized.calls.atomicWrites, []);
});
