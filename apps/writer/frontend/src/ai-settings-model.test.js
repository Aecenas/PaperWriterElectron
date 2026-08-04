import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_PROVIDER_OPTIONS,
  AI_TASK_MODEL_DEFINITIONS,
  createAiModelKey,
  getAiProviderConnectionMeta,
  getAiProviderRuntimeConfig,
  getAiReasoningEffortOptions,
  getTestedAiProviders,
  normalizePublicAiConfig,
  normalizePublicAiTaskModelAssignment,
} from "./ai-settings/model.js";

test("AI settings model preserves the built-in provider and legacy config contract", () => {
  assert.deepEqual(AI_PROVIDER_OPTIONS.map((provider) => provider.id), ["gemini", "deepseek", "codex-cli"]);

  const normalized = normalizePublicAiConfig({
    provider: "deepseek",
    activeModelId: "legacy-deepseek",
    modelId: "legacy-deepseek",
    modelName: "Legacy DeepSeek",
    model: "deepseek-chat",
    hasApiKey: true,
    testedOk: true,
  });

  assert.equal(normalized.activeProvider, "deepseek");
  assert.equal(normalized.activeModelId, "legacy-deepseek");
  assert.equal(normalized.activeModelKey, "deepseek::legacy-deepseek");
  assert.equal(normalized.providerLabel, "DeepSeek");
  assert.equal(normalized.hasApiKey, true);
  assert.equal(normalized.testedOk, true);
  assert.deepEqual(Object.keys(normalized.providers), ["gemini", "deepseek", "codex-cli"]);
});

test("custom provider models, task overrides and runtime selection round-trip unchanged", () => {
  const input = {
    activeProvider: "team-gateway",
    activeModelId: "writer-model",
    providers: {
      "team-gateway": {
        providerLabel: "Team Gateway",
        protocol: "anthropic",
        baseUrl: "https://gateway.example/v1",
        hasApiKey: true,
        apiKeyLast4: "1234",
        activeModelId: "writer-model",
        models: [{
          id: "writer-model",
          name: "Writer",
          model: "claude-writer",
          testedOk: true,
          requestParams: { temperature: 0.25, metadata: { team: "writing" } },
        }],
      },
    },
    taskModels: {
      selectionChat: {
        providerId: "team-gateway",
        modelId: "writer-model",
        requestParams: { temperature: 0.15 },
      },
      applyResolver: {
        providerId: "team-gateway",
        modelId: "writer-model",
        requestParams: { temperature: 0.1 },
      },
    },
  };

  const normalized = normalizePublicAiConfig(input);
  const provider = normalized.providers["team-gateway"];
  assert.equal(provider.providerLabel, "Team Gateway");
  assert.equal(provider.protocol, "anthropic");
  assert.equal(provider.baseUrl, "https://gateway.example/v1");
  assert.deepEqual(provider.models[0].requestParams, {
    temperature: 0.25,
    metadata: { team: "writing" },
  });
  assert.deepEqual(normalized.taskModels.applyResolver, {
    providerId: "team-gateway",
    modelId: "writer-model",
    requestParams: { temperature: 0.1 },
  });
  assert.deepEqual(normalized.taskModels.selectionChat, {
    providerId: "team-gateway",
    modelId: "writer-model",
    requestParams: { temperature: 0.15 },
  });

  assert.deepEqual(getTestedAiProviders(normalized).map((model) => model.id), ["team-gateway::writer-model"]);
  const runtime = getAiProviderRuntimeConfig(normalized, "team-gateway::writer-model");
  assert.equal(runtime.provider, "team-gateway");
  assert.equal(runtime.modelId, "writer-model");
  assert.equal(runtime.model, "claude-writer");
  assert.equal(runtime.hasApiKey, true);
});

test("task assignments reject unsafe provider ids and incomplete pairs", () => {
  assert.deepEqual(normalizePublicAiTaskModelAssignment({
    providerId: "__proto__",
    modelId: "model",
    requestParams: { temperature: 0.2 },
  }), {
    providerId: "",
    modelId: "",
    requestParams: {},
  });
  assert.deepEqual(normalizePublicAiTaskModelAssignment({
    providerId: "gemini",
    modelId: "",
    requestParams: { temperature: 0.2 },
  }), {
    providerId: "",
    modelId: "",
    requestParams: {},
  });
});

test("legacy configs gain empty selection-chat and research-translation assignments without changing applyResolver", () => {
  const normalized = normalizePublicAiConfig({
    taskModels: {
      applyResolver: {
        providerId: "deepseek",
        modelId: "deepseek-default",
      },
      unknownTask: {
        providerId: "gemini",
        modelId: "gemini-default",
      },
    },
  });
  assert.deepEqual(normalized.taskModels.selectionChat, {
    providerId: "",
    modelId: "",
    requestParams: {},
  });
  assert.deepEqual(normalized.taskModels.researchTranslation, {
    providerId: "",
    modelId: "",
    requestParams: {},
  });
  assert.equal(AI_TASK_MODEL_DEFINITIONS.find((task) => task.id === "researchTranslation")?.label, "资料翻译");
  assert.equal(Object.hasOwn(normalized.taskModels, "unknownTask"), false);
  assert.equal(normalized.taskModels.applyResolver.providerId, "deepseek");
});

test("connection metadata and reasoning choices remain presentation-ready", () => {
  assert.deepEqual(getAiProviderConnectionMeta({
    transport: "http",
    hasApiKey: true,
    models: [{ testedOk: true }],
  }), {
    tone: "connected",
    label: "已连接",
    shortLabel: "已连接",
    statusLabel: "可用",
  });
  assert.equal(getAiProviderConnectionMeta({
    transport: "codex-cli",
    runtime: { installed: true, authenticated: false },
  }).statusLabel, "未登录");

  const choices = getAiReasoningEffortOptions({
    reasoningEffort: "high",
    supportedReasoningEfforts: ["low", "high"],
  }, { inherit: true });
  assert.equal(choices[0].value, "");
  assert.match(choices[0].label, /跟随模型设置/);
  assert.deepEqual(choices.slice(1).map((choice) => choice.value), ["low", "high"]);
  assert.equal(createAiModelKey("gemini", "writer"), "gemini::writer");
  assert.equal(createAiModelKey("gemini", ""), "");
});
