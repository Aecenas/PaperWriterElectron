import { useEffect, useState } from "react";

export const AI_MODE_PAGE_TRANSITION_MS = 560;

export function scheduleAiPageTransitionClear(
  clearTransition,
  { timerHost = globalThis } = {},
) {
  const timer = timerHost.setTimeout(
    clearTransition,
    AI_MODE_PAGE_TRANSITION_MS,
  );
  return () => timerHost.clearTimeout(timer);
}

export function useAiModeState() {
  const [aiModeChooserOpen, setAiModeChooserOpen] = useState(false);
  const [aiModeKind, setAiModeKind] = useState("none");
  const [aiPageTransition, setAiPageTransition] = useState("");
  const aiMode = aiModeKind !== "none";
  const aiOptimizeMode = aiModeKind === "optimize";
  const aiChatMode = aiModeKind === "chat";

  useEffect(() => {
    if (!aiPageTransition) return undefined;
    return scheduleAiPageTransitionClear(
      () => setAiPageTransition(""),
      { timerHost: window },
    );
  }, [aiPageTransition]);

  return {
    aiChatMode,
    aiMode,
    aiModeChooserOpen,
    aiModeKind,
    aiOptimizeMode,
    aiPageTransition,
    setAiModeChooserOpen,
    setAiModeKind,
    setAiPageTransition,
  };
}
