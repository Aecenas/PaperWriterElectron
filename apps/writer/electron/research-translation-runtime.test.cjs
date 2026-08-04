const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { createResearchTranslationRuntime } = require("./research-translation-runtime.cjs");

function model(id, overrides = {}) {
  return {
    provider: id,
    providerLabel: id,
    modelId: `${id}-model`,
    modelName: `${id} model`,
    model: `${id}-remote`,
    protocol: "openai",
    transport: "http",
    apiKey: "secret",
    testedOk: true,
    requestParams: { temperature: 0.3 },
    ...overrides,
  };
}

function translationPayload(blocks = [{ id: "a", text: "Alpha" }]) {
  return {
    requestId: "ai-research-translation-runtime-123456",
    kind: "text",
    targetLanguage: "zh-CN",
    blocks,
  };
}

function createHarness({ assignment = {}, stream, config } = {}) {
  const defaults = model("gemini");
  const dedicated = model("dedicated", { protocol: "anthropic" });
  const events = [];
  const calls = [];
  const runtime = createResearchTranslationRuntime({
    readAiConfig: async () => config || { defaultModel: defaults, taskModels: { researchTranslation: assignment } },
    taskAiProviderConfig(stored, selected) {
      if (selected.providerId || selected.modelId) {
        return selected.providerId === "dedicated" && selected.modelId === "dedicated-model" ? dedicated : null;
      }
      return stored.defaultModel;
    },
    mergeAiRequestParams: (left, right) => ({ ...(left || {}), ...(right || {}) }),
    getCodexRuntimeStatus: () => ({ ready: false }),
    async streamAiCompletion(sender, requestId, selected, messages, signal) {
      calls.push({ requestId, selected, messages, signal });
      if (stream) return stream({ sender, requestId, selected, messages, signal, calls });
      const input = JSON.parse(messages[1].content);
      sender.send("ai:chunk", { delta: JSON.stringify({ translations: input.blocks.map((block) => ({ id: block.id, text: `中:${block.text}` })) }) });
      return { inputTokens: 2, outputTokens: 3, totalTokens: 5 };
    },
    streamCodexCompletion: async () => { throw new Error("unexpected codex call"); },
    throwIfAiAborted(signal) {
      if (signal.aborted) {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      }
    },
    resolveCodexScopeDirectory: async () => ({ cwd: "", scope: {}, cleanup: async () => {} }),
    path,
    getTempPath: () => "C:\\Temp",
    emitRendererEvent(_sender, channel, value) { events.push([channel, value]); },
    writeDebugLog: async () => {},
  });
  return { runtime, calls, events };
}

test("research translation follows the default model and reports sequential batch progress and usage", async () => {
  const harness = createHarness();
  const result = await harness.runtime.facade.translate({ sender: {} }, translationPayload([
    { id: "a", text: "a".repeat(8_000) },
    { id: "b", text: "b".repeat(8_000) },
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.model.providerId, "gemini");
  assert.equal(result.translations.length, 2);
  assert.equal(result.usage.totalTokens, 10);
  assert.equal(harness.calls.length, 2);
  assert.deepEqual(harness.events.map(([, value]) => value.completedBatches), [0, 1, 2]);
  assert.ok(harness.calls.every((call) => call.selected.requestParams.response_format?.type === "json_object"));
});

test("validation failures retain a valid original request id", async () => {
  const harness = createHarness();
  const result = await harness.runtime.facade.translate({ sender: {} }, {
    ...translationPayload(),
    targetLanguage: "en-US",
  });
  assert.equal(result.ok, false);
  assert.equal(result.requestId, "ai-research-translation-runtime-123456");
  assert.equal(result.code, "AI_RESEARCH_TRANSLATION_PAYLOAD_INVALID");
  assert.equal(harness.calls.length, 0);
});

test("an explicit task model merges task parameters and never silently falls back", async () => {
  const assignment = {
    providerId: "dedicated",
    modelId: "dedicated-model",
    requestParams: { temperature: 0.1, max_tokens: 2048 },
  };
  const harness = createHarness({ assignment });
  const result = await harness.runtime.facade.translate({ sender: {} }, translationPayload());
  assert.equal(result.ok, true);
  assert.equal(result.model.providerId, "dedicated");
  assert.deepEqual(harness.calls[0].selected.requestParams, { temperature: 0.1, max_tokens: 2048 });

  const stale = createHarness({ assignment: { providerId: "removed", modelId: "removed-model" } });
  const staleResult = await stale.runtime.facade.translate({ sender: {} }, translationPayload());
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.code, "AI_RESEARCH_TRANSLATION_MODEL_INVALID");
  assert.equal(stale.calls.length, 0);
});

test("invalid structured output is repaired once and final failure applies no partial translations", async () => {
  let callIndex = 0;
  const repaired = createHarness({
    stream: async ({ sender, messages }) => {
      callIndex += 1;
      if (callIndex === 1) sender.send("ai:chunk", { delta: "not json" });
      else {
        const input = JSON.parse(messages[1].content);
        sender.send("ai:chunk", { delta: JSON.stringify({ translations: input.blocks.map((block) => ({ id: block.id, text: "已修复" })) }) });
      }
      return { totalTokens: 1 };
    },
  });
  const repairedResult = await repaired.runtime.facade.translate({ sender: {} }, translationPayload());
  assert.equal(repairedResult.ok, true);
  assert.equal(repaired.calls.length, 2);
  assert.match(repaired.calls[1].messages[1].content, /repair-translation-json/);

  const failed = createHarness({
    stream: async ({ sender, messages }) => {
      const input = JSON.parse(messages[1].content);
      if (input.blocks[0].id === "first") {
        sender.send("ai:chunk", { delta: JSON.stringify({ translations: [{ id: "first", text: "第一批" }] }) });
      } else sender.send("ai:chunk", { delta: "invalid" });
      return {};
    },
  });
  const failedResult = await failed.runtime.facade.translate({ sender: {} }, translationPayload([
    { id: "first", text: "a".repeat(8_000) },
    { id: "second", text: "b".repeat(8_000) },
  ]));
  assert.equal(failedResult.ok, false);
  assert.equal(failedResult.code, "AI_RESEARCH_TRANSLATION_OUTPUT_INVALID");
  assert.equal(Object.hasOwn(failedResult, "translations"), false);
});

test("cancel and application shutdown abort active translations and discard late completion", async () => {
  let unblock;
  const waiting = new Promise((resolve) => { unblock = resolve; });
  const harness = createHarness({
    stream: async ({ sender, messages, signal }) => {
      await waiting;
      if (!signal.aborted) {
        const input = JSON.parse(messages[1].content);
        sender.send("ai:chunk", { delta: JSON.stringify({ translations: [{ id: input.blocks[0].id, text: "迟到结果" }] }) });
      }
      return {};
    },
  });
  const request = harness.runtime.facade.translate({ sender: {} }, translationPayload());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.runtime.getActiveRequestCount(), 1);
  assert.deepEqual(await harness.runtime.facade.cancel("ai-research-translation-runtime-123456"), { ok: true, canceled: true });
  unblock();
  const result = await request;
  assert.equal(result.ok, false);
  assert.equal(result.canceled, true);
  assert.equal(result.code, "AI_RESEARCH_TRANSLATION_CANCELED");

  const secondHarness = createHarness({ stream: async () => new Promise(() => {}) });
  void secondHarness.runtime.facade.translate({ sender: {} }, translationPayload());
  await new Promise((resolve) => setImmediate(resolve));
  secondHarness.runtime.abortAll();
  assert.equal(secondHarness.runtime.getActiveRequestCount(), 0);
});
