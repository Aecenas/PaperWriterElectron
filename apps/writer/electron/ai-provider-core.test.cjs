const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAiRequest,
  extractAiStreamEvent,
  mergeAiUsage,
  normalizeAiConfig,
  publicAiConfig,
} = require("./ai-provider-core.cjs");

test("migrates legacy provider config and keeps built-ins", () => {
  const config = normalizeAiConfig({
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: "secret-key",
    testedOk: true,
  });
  assert.equal(config.activeProvider, "deepseek");
  assert.equal(config.providers.deepseek.models[0].model, "deepseek-chat");
  assert.ok(config.providers.gemini);
  assert.ok(config.providers["codex-cli"]);
  assert.equal(config.providers["codex-cli"].transport, "codex-cli");
  assert.deepEqual(config.providers["codex-cli"].models, []);
});

test("publishes Codex runtime readiness without credentials", () => {
  const publicConfig = publicAiConfig({
    providers: {
      "codex-cli": {
        activeModelId: "gpt-model",
        models: [{ id: "gpt-model", name: "GPT", model: "gpt-test", reasoningEffort: "high" }],
      },
    },
  }, {
    "codex-cli": { ready: true, authenticated: true, email: "secret@example.com", models: ["private"] },
  });
  const codex = publicConfig.providers["codex-cli"];
  assert.equal(codex.models[0].testedOk, true);
  assert.equal(codex.models[0].reasoningEffort, "high");
  assert.equal(JSON.stringify(codex).includes("secret@example.com"), false);
  assert.equal(JSON.stringify(codex).includes("private"), false);
});

test("preserves a custom provider with an empty model list", () => {
  const config = normalizeAiConfig({
    providers: {
      custom: {
        providerLabel: "公司网关",
        protocol: "anthropic",
        baseUrl: "https://gateway.example/v1",
        models: [],
      },
    },
  });
  assert.equal(config.providers.custom.providerLabel, "公司网关");
  assert.equal(config.providers.custom.protocol, "anthropic");
  assert.deepEqual(config.providers.custom.models, []);
  assert.equal(config.providers.custom.activeModelId, "");
});

test("public config never exposes an API key", () => {
  const publicConfig = publicAiConfig({
    providers: {
      custom: {
        providerLabel: "OpenAI 网关",
        protocol: "openai",
        baseUrl: "https://gateway.example/v1",
        apiKey: "top-secret-1234",
        models: [{ id: "m1", name: "模型", model: "gpt-test" }],
      },
    },
  });
  assert.equal(publicConfig.providers.custom.hasApiKey, true);
  assert.equal(publicConfig.providers.custom.apiKeyLast4, "1234");
  assert.equal(JSON.stringify(publicConfig).includes("top-secret"), false);
});

test("builds OpenAI-compatible chat completion requests", () => {
  const request = buildAiRequest({
    provider: "custom",
    protocol: "openai",
    builtin: false,
    baseUrl: "https://gateway.example/v1/",
    apiKey: "key",
    model: "gpt-test",
  }, [{ role: "user", content: "你好" }], { stream: true });
  assert.equal(request.url, "https://gateway.example/v1/chat/completions");
  assert.equal(request.headers.authorization, "Bearer key");
  assert.equal(request.body.stream, true);
  assert.equal("reasoning_effort" in request.body, false);
  assert.equal("stream_options" in request.body, false);
});

test("builds Anthropic requests and separates system content", () => {
  const request = buildAiRequest({
    provider: "custom",
    protocol: "anthropic",
    builtin: false,
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "key",
    model: "claude-test",
  }, [
    { role: "system", content: "系统规则" },
    { role: "user", content: "你好" },
  ], { stream: true });
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.headers["x-api-key"], "key");
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.body.system, "系统规则");
  assert.equal(request.body.messages[0].role, "user");
  assert.equal(request.body.max_tokens, 8192);
});

test("parses Anthropic text deltas, usage, completion and errors", () => {
  assert.deepEqual(extractAiStreamEvent("anthropic", {
    type: "content_block_delta",
    delta: { type: "text_delta", text: "你好" },
  }), { delta: "你好" });
  const startUsage = mergeAiUsage("anthropic", { type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 1 } } });
  const usage = mergeAiUsage("anthropic", { type: "message_delta", usage: { output_tokens: 7 } }, startUsage);
  assert.deepEqual(usage, { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 });
  assert.deepEqual(extractAiStreamEvent("anthropic", { type: "message_stop" }), { done: true });
  assert.deepEqual(extractAiStreamEvent("anthropic", { type: "error", error: { message: "overloaded" } }), { error: "overloaded" });
});

test("rejects prototype-like provider ids without mutating object prototypes", () => {
  const malicious = JSON.parse(`{
    "activeProvider": "__proto__",
    "providers": {
      "__proto__": { "providerLabel": "polluted", "model": "evil" },
      "constructor": { "providerLabel": "constructor", "model": "evil" },
      "toString": { "providerLabel": "toString", "model": "evil" },
      "custom-safe": { "providerLabel": "Safe", "models": [{ "id": "safe", "model": "safe-model" }] }
    }
  }`);
  const config = normalizeAiConfig(malicious);
  assert.equal(Object.getPrototypeOf(config.providers), null);
  assert.equal(Object.hasOwn(config.providers, "__proto__"), false);
  assert.equal(Object.hasOwn(config.providers, "constructor"), false);
  assert.equal(Object.hasOwn(config.providers, "toString"), false);
  assert.equal(Object.hasOwn(config.providers, "custom-safe"), true);
  assert.equal(config.activeProvider, "gemini");
  assert.equal({}.polluted, undefined);
});

test("bounds custom providers, models, reasoning options and metadata", () => {
  const providers = {};
  for (let providerIndex = 0; providerIndex < 70; providerIndex += 1) {
    providers[`custom-${providerIndex}`] = {
      providerLabel: "P".repeat(200),
      apiKey: "k".repeat(20000),
      models: providerIndex === 0 ? Array.from({ length: 300 }, (_value, modelIndex) => ({
        id: `model-${modelIndex}-${"i".repeat(300)}`,
        name: "N".repeat(300),
        model: `gpt-${modelIndex}-${"m".repeat(300)}`,
        description: "D".repeat(3000),
        supportedReasoningEfforts: Array.from({ length: 40 }, () => ({
          reasoningEffort: "e".repeat(100),
          description: "x".repeat(1000),
        })),
      })) : [],
    };
  }
  const config = normalizeAiConfig({ providers });
  const customProviders = Object.keys(config.providers).filter((provider) => provider.startsWith("custom-"));
  assert.equal(customProviders.length, 64);
  const first = config.providers[customProviders[0]];
  assert.equal(first.providerLabel.length, 120);
  assert.equal(first.apiKey.length, 16384);
  assert.equal(first.models.length, 256);
  assert.equal(first.models[0].id.length, 256);
  assert.equal(first.models[0].name.length, 256);
  assert.equal(first.models[0].model.length, 256);
  assert.equal(first.models[0].description.length, 2000);
  assert.equal(first.models[0].supportedReasoningEfforts.length, 32);
  assert.equal(first.models[0].supportedReasoningEfforts[0].reasoningEffort.length, 64);
  assert.equal(first.models[0].supportedReasoningEfforts[0].description.length, 500);
});
