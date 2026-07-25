import { useEffect } from "react";
import { bridge } from "../bridge.js";
import { normalizePublicAiConfig } from "../ai-settings/model.js";

export function applyLoadedAiConfig(config, {
  setAiConfig,
  setAiSelectedProvider,
}) {
  if (!config) return null;
  const normalized = normalizePublicAiConfig(config);
  setAiConfig(normalized);
  setAiSelectedProvider(normalized.activeModelKey);
  return normalized;
}

export function applyCodexStatusAiConfig(config, setAiConfig) {
  const normalized = normalizePublicAiConfig(config);
  setAiConfig(normalized);
  return normalized;
}

export function useAiConfigLifecycle({
  aiBridge = bridge,
  aiConfigActiveModelKey,
  aiMode,
  setAiConfig,
  setAiSelectedProvider,
}) {
  useEffect(() => {
    let mounted = true;
    aiBridge.getAiConfig?.().then((config) => {
      if (mounted && config) {
        applyLoadedAiConfig(config, {
          setAiConfig,
          setAiSelectedProvider,
        });
      }
    }).catch((error) => {
      aiBridge.debugLog?.("renderer:ai-config:error", { message: error?.message });
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => aiBridge.onCodexCliStatus?.((config) => {
    applyCodexStatusAiConfig(config, setAiConfig);
  }), []);

  useEffect(() => {
    if (!aiMode) {
      setAiSelectedProvider(aiConfigActiveModelKey);
    }
  }, [aiConfigActiveModelKey, aiMode]);
}
