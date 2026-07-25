import { useState } from "react";
import { DEFAULT_AI_CONFIG } from "../ai-settings/model.js";

export function useAiConfigState() {
  const [aiConfig, setAiConfig] = useState(DEFAULT_AI_CONFIG);
  const [aiSelectedProvider, setAiSelectedProvider] = useState(DEFAULT_AI_CONFIG.activeProvider);

  return {
    aiConfig,
    aiSelectedProvider,
    setAiConfig,
    setAiSelectedProvider,
  };
}
