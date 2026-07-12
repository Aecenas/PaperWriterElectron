import assert from "node:assert/strict";
import test from "node:test";

import { groupTestedAiProviders } from "./ai-provider-selector.js";

test("groups built-in and custom tested models by their dynamic provider ids", () => {
  const groups = groupTestedAiProviders([
    { id: "gemini::default", provider: "gemini", providerLabel: "Gemini", modelId: "default", builtin: true },
    { id: "custom-a::one", provider: "custom-a", providerLabel: "团队网关", modelId: "one", protocol: "anthropic" },
    { id: "custom-a::two", provider: "custom-a", providerLabel: "团队网关", modelId: "two", protocol: "anthropic" },
    { id: "custom-b::one", provider: "custom-b", providerLabel: "兼容接口", modelId: "one", protocol: "openai" },
  ], [
    { id: "gemini", label: "Gemini", protocol: "openai", builtin: true },
  ]);

  assert.deepEqual(groups.map(({ id, label, protocol, builtin, models }) => ({
    id,
    label,
    protocol,
    builtin,
    models: models.map((model) => model.id),
  })), [
    { id: "gemini", label: "Gemini", protocol: "openai", builtin: true, models: ["gemini::default"] },
    { id: "custom-a", label: "团队网关", protocol: "anthropic", builtin: false, models: ["custom-a::one", "custom-a::two"] },
    { id: "custom-b", label: "兼容接口", protocol: "openai", builtin: false, models: ["custom-b::one"] },
  ]);
});
