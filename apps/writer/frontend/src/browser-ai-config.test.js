import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_BROWSER_AI_MODELS,
  MAX_BROWSER_AI_PROVIDERS,
  MAX_BROWSER_AI_REQUEST_PARAMS,
  exactBrowserAiProviderConfig,
  normalizeBrowserAiConfig,
  normalizeBrowserAiRequestParams,
  normalizeBrowserExternalUrl,
  publicBrowserAiConfig,
  safeBrowserProviderId,
} from "./browser-ai-config.js";

test("rejects reserved or malformed provider ids before map insertion", () => {
  assert.equal(safeBrowserProviderId("custom-safe_1.2"), "custom-safe_1.2");
  for (const value of ["__proto__", "constructor", "prototype", "toString", "valueOf", "bad/key", "x".repeat(129)]) {
    assert.equal(safeBrowserProviderId(value), "", value);
  }
});

test("normalizes localStorage-shaped AI maps into bounded null-prototype objects", () => {
  const providers = JSON.parse('{"__proto__":{"providerLabel":"polluted"},"constructor":{"providerLabel":"bad"},"prototype":{"providerLabel":"bad"}}');
  providers["custom-rich"] = {
    providerLabel: "供应商".repeat(100),
    apiKey: "k".repeat(20000),
    baseUrl: `https://example.com/${"x".repeat(3000)}`,
    models: Array.from({ length: 300 }, (_, index) => ({
      id: `model-${index}`,
      name: "名称".repeat(300),
      model: `remote-model-${index}`,
      reasoningEffort: "r".repeat(100),
      defaultReasoningEffort: "d".repeat(100),
      supportedReasoningEfforts: Array.from({ length: 50 }, (__, effortIndex) => ({
        reasoningEffort: `effort-${effortIndex}`,
        description: "说明".repeat(400),
      })),
      description: "描述".repeat(2000),
      testedAt: "t".repeat(100),
      testMessage: "消息".repeat(2000),
      requestParams: Object.fromEntries(Array.from({ length: 80 }, (__, paramIndex) => [`param_${paramIndex}`, paramIndex])),
    })),
  };
  for (let index = 0; index < 100; index += 1) providers[`custom-${index}`] = { model: `model-${index}` };

  const normalized = normalizeBrowserAiConfig({ activeProvider: "__proto__", providers });
  assert.equal(Object.getPrototypeOf(normalized.providers), null);
  assert.equal(Object.keys(normalized.providers).length, MAX_BROWSER_AI_PROVIDERS);
  assert.equal(Object.hasOwn(normalized.providers, "__proto__"), false);
  assert.equal(Object.hasOwn(normalized.providers, "constructor"), false);
  assert.equal(Object.hasOwn(normalized.providers, "prototype"), false);
  assert.equal(normalized.activeProvider, "gemini");
  assert.equal({}.providerLabel, undefined);

  const rich = normalized.providers["custom-rich"];
  assert.equal(rich.models.length, MAX_BROWSER_AI_MODELS);
  assert.ok(rich.providerLabel.length <= 120);
  assert.ok(rich.apiKey.length <= 16384);
  assert.ok(rich.baseUrl.length <= 2048);
  assert.ok(rich.models.every((model) => model.id.length <= 256 && model.name.length <= 256 && model.model.length <= 256));
  assert.ok(rich.models.every((model) => model.reasoningEffort === "" && model.defaultReasoningEffort === ""));
  assert.ok(rich.models.every((model) => model.supportedReasoningEfforts.length === 0));
  assert.ok(rich.models.every((model) => Object.keys(model.requestParams).length === MAX_BROWSER_AI_REQUEST_PARAMS));
  assert.ok(rich.models.every((model) => model.description.length <= 2000 && model.testMessage.length <= 2000));
});

test("public browser config keeps a null-prototype provider map and omits secrets", () => {
  const result = publicBrowserAiConfig({
    activeProvider: "custom-safe",
    providers: {
      "custom-safe": {
        providerLabel: "Safe",
        apiKey: "sk-secret-value",
        models: [{ id: "model", name: "Model", model: "model" }],
        activeModelId: "model",
      },
    },
  });
  assert.equal(Object.getPrototypeOf(result.providers), null);
  assert.equal(result.activeProvider, "custom-safe");
  assert.equal(result.providers["custom-safe"].apiKey, undefined);
  assert.equal(result.providers["custom-safe"].hasApiKey, true);
  assert.equal(result.providers["custom-safe"].apiKeyLast4, "alue");
});

test("browser AI config persists exact task-model assignments without fallback", () => {
  const configured = normalizeBrowserAiConfig({
    activeProvider: "gemini",
    activeModelId: "gemini-main",
    providers: {
      gemini: {
        models: [{ id: "gemini-main", name: "Main", model: "gemini-main", testedOk: true }],
        activeModelId: "gemini-main",
      },
      deepseek: {
        models: [{ id: "deepseek-resolver", name: "Resolver", model: "deepseek-resolver", testedOk: true }],
        activeModelId: "deepseek-resolver",
      },
    },
    taskModels: {
      applyResolver: {
        providerId: "deepseek",
        modelId: "deepseek-resolver",
        reasoningEffort: "high",
        requestParams: { thinking: { type: "enabled" }, max_tokens: 2048 },
      },
    },
  });
  assert.deepEqual(configured.taskModels, {
    applyResolver: {
      providerId: "deepseek",
      modelId: "deepseek-resolver",
      requestParams: { thinking: { type: "enabled" }, max_tokens: 2048 },
    },
  });
  assert.deepEqual(publicBrowserAiConfig(configured).taskModels, configured.taskModels);
  assert.equal(exactBrowserAiProviderConfig(configured, configured.taskModels.applyResolver).model.model, "deepseek-resolver");

  const stale = normalizeBrowserAiConfig({
    activeProvider: "gemini",
    providers: configured.providers,
    taskModels: { applyResolver: { providerId: "removed-provider", modelId: "removed-model", requestParams: { temperature: 0.2 } } },
  });
  assert.deepEqual(stale.taskModels.applyResolver, { providerId: "removed-provider", modelId: "removed-model", requestParams: { temperature: 0.2 } });
  assert.equal(exactBrowserAiProviderConfig(stale, stale.taskModels.applyResolver), null);

  const unsafe = normalizeBrowserAiConfig({
    activeProvider: "gemini",
    providers: configured.providers,
    taskModels: { applyResolver: { providerId: "__proto__", modelId: "invented" } },
  });
  assert.deepEqual(unsafe.taskModels.applyResolver, { providerId: "", modelId: "", requestParams: {} });
  assert.deepEqual(normalizeBrowserAiConfig({ providers: configured.providers }).taskModels.applyResolver, { providerId: "", modelId: "", requestParams: {} });
});

test("browser request parameters keep JSON values and remove reserved or dangerous entries", () => {
  const params = JSON.parse('{"temperature":0.4,"enabled":true,"metadata":{"tags":["a",null]},"model":"escape","__proto__":{"polluted":true}}');
  assert.deepEqual(normalizeBrowserAiRequestParams(params), {
    temperature: 0.4,
    enabled: true,
    metadata: { tags: ["a", null] },
  });
  assert.equal({}.polluted, undefined);
});

test("browser external URLs allow only bounded http, https and mailto links", () => {
  assert.equal(normalizeBrowserExternalUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(normalizeBrowserExternalUrl("http://localhost:5174/preview"), "http://localhost:5174/preview");
  assert.equal(normalizeBrowserExternalUrl("mailto:writer@example.com"), "mailto:writer@example.com");
  for (const value of ["javascript:alert(1)", "data:text/html,evil", "file:///C:/secret.txt", "x".repeat(8193), "not a url"]) {
    assert.equal(normalizeBrowserExternalUrl(value), "", value.slice(0, 40));
  }
});

test("browser bridge opens only the normalized external URL", () => {
  const source = fs.readFileSync(fileURLToPath(new URL("./bridge.js", import.meta.url)), "utf8");
  const start = source.indexOf("openExternal: async");
  const end = source.indexOf("loadAutosave:", start);
  const openExternalSource = source.slice(start, end);
  assert.match(openExternalSource, /normalizeBrowserExternalUrl\(url\)/);
  assert.match(openExternalSource, /window\.open\(safeUrl,/);
  assert.doesNotMatch(openExternalSource, /window\.open\(String\(url/);
});
