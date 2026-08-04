const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveCodexScopeDirectory } = require("./codex-scope.cjs");
const { createHelpAssistantRuntime } = require("./help-assistant-runtime.cjs");

async function waitFor(predicate) {
  for (let index = 0; index < 50; index += 1) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("等待 AI精灵事件超时");
}

function createHarness(root, overrides = {}) {
  let uuid = 0;
  const events = [];
  const selected = {
    provider: "deepseek",
    providerLabel: "DeepSeek",
    transport: "http",
    protocol: "openai",
    apiKey: "runtime-secret",
    testedOk: true,
    modelId: "deepseek-help",
    modelName: "DeepSeek Help",
    model: "deepseek-chat",
    requestParams: {},
  };
  const storedConfig = overrides.storedConfig || {
    activeProvider: "deepseek",
    activeModelId: "deepseek-help",
    taskModels: { helpAssistant: {} },
  };
  const runtime = createHelpAssistantRuntime({
    fs,
    path,
    atomicWriteFile: async (target, value) => fs.writeFile(target, value, "utf8"),
    getUserDataPath: () => root,
    getTempPath: () => root,
    getAppVersion: () => "1.1.1",
    randomUUID: () => `runtime-${++uuid}-abcdef`,
    readAiConfig: async () => storedConfig,
    taskAiProviderConfig: (_config, assignment = {}) => {
      if ((assignment.providerId || assignment.modelId) && assignment.modelId !== selected.modelId) return null;
      return selected;
    },
    mergeAiRequestParams: (base, task) => ({ ...base, ...task }),
    getCodexRuntimeStatus: () => ({ ready: true, executablePath: "codex.exe" }),
    resolveCodexScopeDirectory,
    streamAiCompletion: overrides.streamAiCompletion || (async (sender, _requestId, _config, messages) => {
      overrides.onMessages?.(messages);
      sender.send("ai:chunk", { delta: "先打开“文件”菜单。" });
      return { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 };
    }),
    streamCodexCompletion: overrides.streamCodexCompletion || (async () => ({})),
    throwIfAiAborted: (signal) => {
      if (signal.aborted) throw signal.reason || new Error("aborted");
    },
    emitRendererEvent: (sender, channel, payload) => sender.send(channel, payload),
    writeDebugLog: async () => {},
    knowledgeIndexPath: path.join(__dirname, "../knowledge/runtime-index.generated.json"),
  });
  const event = { sender: { isDestroyed: () => false, send: (channel, payload) => events.push([channel, payload]) } };
  return { event, events, runtime, selected };
}

test("AI精灵 builds a main-owned isolated request, streams, and restores atomic local history", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-help-runtime-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  let capturedMessages;
  const harness = createHarness(root, { onMessages: (messages) => { capturedMessages = messages; } });
  const initial = await harness.runtime.initialize();
  const sessionId = initial.activeSessionId;

  const rejected = await harness.runtime.facade.generate(harness.event, {
    requestId: "ai-help-invalid-fields",
    sessionId,
    question: "怎么保存？",
    documentHtml: "<p>不得发送的正文</p>",
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "AI_HELP_PAYLOAD_INVALID");

  const started = await harness.runtime.facade.generate(harness.event, {
    requestId: "ai-help-runtime-123456",
    sessionId,
    question: "异常退出后怎么恢复信笺？",
  });
  assert.equal(started.ok, true);
  assert.equal(started.model.modelId, "deepseek-help");
  const done = await waitFor(() => harness.events.find(([channel]) => channel === "help-ai:done"));
  assert.equal(done[1].content, "先打开“文件”菜单。");
  assert.ok(capturedMessages.some((message) => message.role === "system" && /恢复缓存/.test(message.content)));
  assert.doesNotMatch(JSON.stringify(capturedMessages), /不得发送的正文|runtime-secret|apps\/writer/);

  const persisted = JSON.parse(await fs.readFile(path.join(root, "ai-help-history.json"), "utf8"));
  assert.equal(persisted.sessions[0].messages.length, 2);
  assert.equal(persisted.sessions[0].messages[1].status, "done");
  assert.equal(persisted.sessions[0].title, "异常退出后怎么恢复信笺？");

  const restoredHarness = createHarness(root);
  const restored = await restoredHarness.runtime.initialize();
  assert.equal(restored.sessions[0].messages[1].content, "先打开“文件”菜单。");
  assert.equal(restored.activeRequest, null);
});

test("stopping preserves partial output and normalizes an interrupted process after restart", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-help-stop-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const harness = createHarness(root, {
    streamAiCompletion: (sender, _requestId, _config, _messages, signal) => new Promise((resolve, reject) => {
      sender.send("ai:chunk", { delta: "已经生成的部分" });
      signal.addEventListener("abort", () => reject(signal.reason || new Error("aborted")), { once: true });
      void resolve;
    }),
  });
  const initial = await harness.runtime.initialize();
  const started = await harness.runtime.facade.generate(harness.event, {
    requestId: "ai-help-stop-123456",
    sessionId: initial.activeSessionId,
    question: "如何导出？",
  });
  assert.equal(started.ok, true);
  assert.equal((await harness.runtime.facade.cancel(started.requestId)).canceled, true);
  const stopped = await waitFor(() => harness.events.find(([channel]) => channel === "help-ai:error"));
  assert.equal(stopped[1].aborted, true);
  assert.equal(stopped[1].content, "已经生成的部分");
  const current = await harness.runtime.facade.getState();
  assert.equal(current.sessions[0].messages.at(-1).status, "stopped");
  assert.equal(current.sessions[0].messages.at(-1).content, "已经生成的部分");

  const storedPath = path.join(root, "ai-help-history.json");
  const stored = JSON.parse(await fs.readFile(storedPath, "utf8"));
  stored.sessions[0].messages.at(-1).status = "streaming";
  await fs.writeFile(storedPath, JSON.stringify(stored), "utf8");
  const restarted = createHarness(root);
  const normalized = await restarted.runtime.initialize();
  assert.equal(normalized.sessions[0].messages.at(-1).status, "stopped");
});

test("an explicit stale help model fails closed while an unassigned task follows default", async (context) => {
  const staleRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-help-stale-"));
  const defaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-help-default-"));
  context.after(async () => {
    await fs.rm(staleRoot, { recursive: true, force: true });
    await fs.rm(defaultRoot, { recursive: true, force: true });
  });
  const stale = createHarness(staleRoot, {
    storedConfig: { taskModels: { helpAssistant: { providerId: "removed", modelId: "removed-model" } } },
  });
  const staleState = await stale.runtime.initialize();
  const staleResult = await stale.runtime.facade.generate(stale.event, {
    requestId: "ai-help-stale-123456",
    sessionId: staleState.activeSessionId,
    question: "怎么保存？",
  });
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.code, "AI_HELP_MODEL_INVALID");

  const following = createHarness(defaultRoot);
  const followingState = await following.runtime.initialize();
  const followingResult = await following.runtime.facade.generate(following.event, {
    requestId: "ai-help-default-123456",
    sessionId: followingState.activeSessionId,
    question: "怎么保存？",
  });
  assert.equal(followingResult.ok, true);
  assert.equal(followingResult.model.modelId, "deepseek-help");
  await waitFor(() => following.events.find(([channel]) => channel === "help-ai:done"));
});

test("a damaged local history is backed up and replaced without exposing its path", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-help-corrupt-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "ai-help-history.json"), "{not-json", "utf8");
  const harness = createHarness(root);
  const state = await harness.runtime.initialize();
  assert.match(state.notice, /已损坏.*已保留备份/);
  assert.doesNotMatch(state.notice, /[A-Za-z]:\\|\/tmp\//);
  assert.equal(state.sessions.length, 1);
  const files = await fs.readdir(root);
  assert.ok(files.some((name) => name.startsWith("ai-help-history.json.corrupt-")));
  assert.ok(files.includes("ai-help-history.json"));
});
