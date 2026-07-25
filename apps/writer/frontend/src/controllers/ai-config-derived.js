import { useMemo } from "react";
import {
  createAiModelKey,
  getAiProviderRuntimeConfig,
  getTestedAiProviders,
} from "../ai-settings/model.js";

export function resolveAiApplyResolverLabel(aiConfig, availableAiProviders) {
  const assignment = aiConfig.taskModels?.applyResolver || {};
  const assignedKey = assignment.providerId && assignment.modelId
    ? createAiModelKey(assignment.providerId, assignment.modelId)
    : aiConfig.activeModelKey;
  const model = availableAiProviders.find((candidate) => candidate.id === assignedKey);
  return model
    ? `${model.providerLabel || model.label || "AI"} · ${model.modelName || model.model || "定位模型"}`
    : "直接应用定位模型";
}

export function resolveEffectiveAiProvider(aiConfig, aiSelectedProvider, availableAiProviders) {
  if (availableAiProviders.some((provider) => provider.id === aiSelectedProvider)) {
    return aiSelectedProvider;
  }
  if (availableAiProviders.some((provider) => provider.id === aiConfig.activeModelKey)) {
    return aiConfig.activeModelKey;
  }
  return availableAiProviders[0]?.id || aiConfig.activeModelKey;
}

export function useAiConfigDerived({
  aiConfig,
  aiSelectedProvider,
}) {
  const availableAiProviders = useMemo(() => getTestedAiProviders(aiConfig), [aiConfig]);
  const aiHasUsableProvider = availableAiProviders.length > 0;
  const aiApplyResolverLabel = useMemo(
    () => resolveAiApplyResolverLabel(aiConfig, availableAiProviders),
    [aiConfig.activeModelKey, aiConfig.taskModels, availableAiProviders],
  );
  const effectiveAiProvider = useMemo(
    () => resolveEffectiveAiProvider(aiConfig, aiSelectedProvider, availableAiProviders),
    [aiConfig.activeModelKey, aiSelectedProvider, availableAiProviders],
  );
  const effectiveAiConfig = useMemo(
    () => getAiProviderRuntimeConfig(aiConfig, effectiveAiProvider),
    [aiConfig, effectiveAiProvider],
  );
  const effectiveAiChoice = useMemo(
    () => availableAiProviders.find((provider) => provider.id === effectiveAiProvider)
      || availableAiProviders[0]
      || null,
    [availableAiProviders, effectiveAiProvider],
  );

  return {
    aiApplyResolverLabel,
    aiHasUsableProvider,
    availableAiProviders,
    effectiveAiChoice,
    effectiveAiConfig,
    effectiveAiProvider,
  };
}
