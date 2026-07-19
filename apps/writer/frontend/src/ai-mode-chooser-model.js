export function getAiModeLabel(mode) {
  if (mode === "optimize") return "AI优化";
  if (mode === "chat") return "AI问答";
  return "未启用";
}

export function shouldConfirmAiModeChange({ currentMode, nextMode, busy }) {
  return Boolean(busy && currentMode !== "none" && currentMode !== nextMode);
}

export function shouldConfirmAiModeExit({ currentMode, busy }) {
  return Boolean(busy && currentMode !== "none");
}
