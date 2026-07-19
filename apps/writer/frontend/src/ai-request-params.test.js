import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_REQUEST_PARAM_CUSTOM_OPTION,
  aiApplyResolverEditableRequestParams,
  aiModelCapabilities,
  aiRequestParamPreset,
  aiRequestParamPresetOptions,
  aiRequestParamsWithProviderDefaults,
  aiTaskRequestParamsForEditor,
  createAiRequestParamRow,
  parseAiRequestParamRows,
  requestParamsToRows,
} from "./ai-request-params.js";

test("request parameter rows preserve string, number, boolean, object and array values", () => {
  const input = {
    label: "stable",
    temperature: 0.4,
    enabled: true,
    metadata: { tags: ["draft", null] },
    stop: ["END"],
  };
  const parsed = parseAiRequestParamRows(requestParamsToRows(input));
  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.requestParams, input);
});

test("request parameter rows reject empty, duplicate, reserved, dangerous and malformed values", () => {
  const cases = [
    [createAiRequestParamRow({ key: "", type: "string", valueText: "x" })],
    [
      createAiRequestParamRow({ key: "temperature", type: "number", valueText: "1" }),
      createAiRequestParamRow({ key: "temperature", type: "number", valueText: "2" }),
    ],
    [createAiRequestParamRow({ key: "model", type: "string", valueText: "escape" })],
    [createAiRequestParamRow({ key: "__proto__", type: "json", valueText: "{}" })],
    [createAiRequestParamRow({ key: "extra_body", type: "json", valueText: "not-json" })],
    [createAiRequestParamRow({ key: "scalar", type: "json", valueText: "42" })],
  ];
  for (const rows of cases) assert.equal(parseAiRequestParamRows(rows).valid, false);
});

test("Gemini blocks duplicate thinking controls while DeepSeek warns about ignored sampling", () => {
  const gemini = parseAiRequestParamRows([
    createAiRequestParamRow({ key: "reasoning_effort", type: "string", valueText: "high" }),
    createAiRequestParamRow({ key: "extra_body", type: "json", valueText: '{"google":{"thinking_config":{"thinking_level":"high"}}}' }),
  ], { providerId: "gemini" });
  assert.equal(gemini.valid, false);
  assert.match(gemini.error, /不能同时使用/);

  const deepseek = parseAiRequestParamRows([
    createAiRequestParamRow({ key: "thinking", type: "json", valueText: '{"type":"enabled"}' }),
    createAiRequestParamRow({ key: "temperature", type: "number", valueText: "0.7" }),
    createAiRequestParamRow({ key: "top_p", type: "number", valueText: "0.9" }),
  ], { providerId: "deepseek" });
  assert.equal(deepseek.valid, true);
  assert.match(deepseek.warning, /temperature、top_p/);
});

test("built-in presets are opt-in and custom providers only expose a custom field", () => {
  assert.equal(aiRequestParamPreset("gemini", "reasoning_effort")?.valueText, "high");
  assert.equal(aiRequestParamPreset("deepseek", "thinking")?.type, "json");
  assert.equal(aiRequestParamPreset("gemini", "extra_body"), null);
  assert.equal(aiRequestParamPreset("deepseek", "reasoning_effort")?.valueText, "max");
  assert.equal(aiRequestParamPreset("deepseek", "max_tokens")?.valueText, "384000");
  assert.deepEqual(aiRequestParamPresetOptions("custom-provider"), [
    { value: "", label: "添加参数" },
    { value: AI_REQUEST_PARAM_CUSTOM_OPTION, label: "自定义参数" },
  ]);
  assert.deepEqual(aiRequestParamPresetOptions("gemini").find((option) => option.value === "reasoning_effort"), {
    value: "reasoning_effort",
    label: "reasoning_effort",
  });
});

test("built-in model editors expose the provider defaults that are currently effective", () => {
  assert.deepEqual(aiRequestParamsWithProviderDefaults("gemini", {}, "gemini-3.1-pro-preview"), {
    reasoning_effort: "high",
    service_tier: "standard",
    temperature: 1,
  });
  assert.deepEqual(aiRequestParamsWithProviderDefaults("deepseek", {}, "deepseek-v4-flash"), {
    thinking: { type: "enabled" },
    reasoning_effort: "max",
    max_tokens: 384_000,
    response_format: { type: "text" },
    temperature: 1,
    top_p: 1,
  });
  assert.deepEqual(aiRequestParamsWithProviderDefaults("deepseek", {}, "deepseek-chat"), {
    thinking: { type: "disabled" },
    max_tokens: 384_000,
    response_format: { type: "text" },
    temperature: 1,
    top_p: 1,
  });
  assert.deepEqual(aiRequestParamsWithProviderDefaults("gemini", {
    extra_body: { google: { thinking_config: { thinking_level: "medium" } } },
  }, "gemini-3.1-pro-preview"), {
    service_tier: "standard",
    temperature: 1,
    extra_body: { google: { thinking_config: { thinking_level: "medium" } } },
  });
  assert.deepEqual(aiRequestParamsWithProviderDefaults("custom-provider", { temperature: 0.5 }), { temperature: 0.5 });
  assert.deepEqual(aiModelCapabilities("deepseek", "deepseek-v4-flash"), {
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
  });
  assert.equal(aiModelCapabilities("custom-provider", "custom-model"), null);
});

test("task parameter editors start from effective model parameters and let task values override them", () => {
  assert.deepEqual(aiTaskRequestParamsForEditor("deepseek", {
    temperature: 0.8,
    max_tokens: 4096,
  }, {
    max_tokens: 8192,
    response_format: { type: "json_object" },
  }, "deepseek-v4-flash"), {
    thinking: { type: "enabled" },
    reasoning_effort: "max",
    max_tokens: 8192,
    response_format: { type: "json_object" },
    temperature: 0.8,
    top_p: 1,
  });
  assert.deepEqual(aiTaskRequestParamsForEditor("custom-provider", {
    temperature: 0.5,
  }, {
    temperature: 0.2,
    metadata: { task: "resolver" },
  }), {
    temperature: 0.2,
    metadata: { task: "resolver" },
  });
});

test("built-in direct-apply editors hide request fields fixed by the resolver transport", () => {
  const params = {
    max_tokens: 384_000,
    response_format: { type: "text" },
    temperature: 0.7,
  };
  assert.deepEqual(aiApplyResolverEditableRequestParams("deepseek", params), { temperature: 0.7 });
  assert.deepEqual(aiApplyResolverEditableRequestParams("gemini", params), { temperature: 0.7 });
  assert.deepEqual(aiApplyResolverEditableRequestParams("custom-provider", params), params);
});
