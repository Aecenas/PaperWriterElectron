import { useMemo } from "react";
import { Square } from "lucide-react";
import { bridge } from "../bridge.js";
import { normalizeAiState } from "../ai/state.js";
import {
  shouldConfirmAiModeChange,
  shouldConfirmAiModeExit,
} from "../ai-mode-chooser-model.js";
import { AI_MODEL_REQUIRED_MESSAGE } from "../ai-settings/model.js";

export function createAiModeChooserActions({
  activeTabReadOnly,
  aiCollaborationPending = false,
  aiHasUsableProvider,
  aiModeChooserOpen,
  openAiSettings,
  setAiModeChooserOpen,
  showStatus,
}) {
  const toggleAiModeChooser = () => {
    if (aiCollaborationPending) {
      setAiModeChooserOpen(false);
      showStatus("请先完成或取消待审阅的 AI 协作", "warning");
      return;
    }
    if (aiModeChooserOpen) {
      setAiModeChooserOpen(false);
      return;
    }
    if (activeTabReadOnly) {
      showStatus("当前信笺为只读，不能进入 AI 模式", "warning");
      return;
    }
    if (!aiHasUsableProvider) {
      openAiSettings();
      showStatus(
        AI_MODEL_REQUIRED_MESSAGE,
        "warning",
        { duration: 5000, dismissible: true },
      );
      return;
    }
    setAiModeChooserOpen(true);
  };

  return { toggleAiModeChooser };
}

export function useAiModeChooserActions(options) {
  return useMemo(
    () => createAiModeChooserActions(options),
    [
      options.activeTabReadOnly,
      options.aiCollaborationPending,
      options.aiHasUsableProvider,
      options.aiModeChooserOpen,
      options.openAiSettings,
      options.setAiModeChooserOpen,
      options.showStatus,
    ],
  );
}

export function createAiModeTransitionActions({
  activePane,
  activeTabReadOnly,
  aiBridge = bridge,
  aiHasUsableProvider,
  aiCollaborationPending = false,
  aiModeKind,
  aiStatus,
  effectiveAiProvider,
  getActiveDocumentSnapshot,
  immersiveMode,
  layoutPort,
  leftSidebarCollapsed,
  openAiSettings,
  setAiModeChooserOpen,
  setAiModeKind,
  setAiPageTransition,
  setAiSelectedProvider,
  showConfirmDialog,
  showStatus,
  streamRegistry,
  updateActiveDocumentAiState,
}) {
  const cancelActiveStream = () => {
    streamRegistry.cancelActive((requestId) => aiBridge.cancelAi?.(requestId));
  };

  const exitAiMode = () => {
    if (aiStatus === "streaming") {
      cancelActiveStream();
    }
    streamRegistry.clearActive();
    setAiModeKind("none");
    setAiModeChooserOpen(false);
    layoutPort.exitAiLayout({ immersiveMode });
  };

  const activateAiMode = (kind) => {
    if (kind !== "optimize" && kind !== "chat") {
      return false;
    }
    if (activeTabReadOnly) {
      showStatus("当前信笺为只读，不能进入 AI 模式", "warning");
      return false;
    }
    if (!aiHasUsableProvider) {
      showStatus("请先在“设置 > AI 配置”中配置并测试可用模型", "warning");
      return false;
    }
    if (aiModeKind === kind) return true;

    const enteringAiMode = aiModeKind === "none";
    setAiSelectedProvider(effectiveAiProvider);
    if (enteringAiMode) {
      layoutPort.enterAiLayout({
        activePane,
        immersiveMode,
        leftSidebarCollapsed,
      });
    }
    setAiModeKind(kind);
    const activeDocument = getActiveDocumentSnapshot()?.document;
    if (normalizeAiState(activeDocument?.aiState).lastMode !== kind) {
      updateActiveDocumentAiState((previous) => ({
        ...previous,
        lastMode: kind,
      }));
    }
    if (kind === "chat") {
      streamRegistry.resetChatContext();
    }
    streamRegistry.clearActive();
    return true;
  };

  const requestAiModeChange = async (kind) => {
    if (aiCollaborationPending && kind !== aiModeKind) {
      setAiModeChooserOpen(false);
      showStatus("请先完成或取消待审阅的 AI 协作", "warning");
      return false;
    }
    if (activeTabReadOnly) {
      setAiModeChooserOpen(false);
      showStatus("当前信笺为只读，不能进入 AI 模式", "warning");
      return false;
    }
    if (!aiHasUsableProvider) {
      openAiSettings();
      showStatus(
        AI_MODEL_REQUIRED_MESSAGE,
        "warning",
        { duration: 5000, dismissible: true },
      );
      return false;
    }
    if (aiModeKind === kind) {
      setAiModeChooserOpen(false);
      return true;
    }
    if (shouldConfirmAiModeChange({
      currentMode: aiModeKind,
      nextMode: kind,
      busy: aiStatus === "streaming",
    })) {
      const currentLabel = aiModeKind === "chat" ? "AI协作" : "AI优化";
      const nextLabel = kind === "chat" ? "AI协作" : "AI优化";
      const decision = await showConfirmDialog({
        tone: "warning",
        icon: Square,
        eyebrow: "切换 AI 模式",
        title: `停止${currentLabel}并切换到${nextLabel}？`,
        message: "当前生成会停止，已经产生的内容会保留。",
        cancelValue: "cancel",
        actions: [
          {
            value: "switch",
            label: "停止并切换",
            variant: "primary",
            autoFocus: true,
          },
          {
            value: "cancel",
            label: "继续当前生成",
            variant: "ghost",
          },
        ],
      });
      if (decision !== "switch") return false;
      cancelActiveStream();
    }
    const activated = activateAiMode(kind);
    if (activated) {
      setAiPageTransition(kind);
      setAiModeChooserOpen(false);
    }
    return activated;
  };

  const requestExitAiMode = async () => {
    if (aiCollaborationPending) {
      setAiModeChooserOpen(false);
      showStatus("请先完成或取消待审阅的 AI 协作", "warning");
      return false;
    }
    if (aiModeKind === "none") {
      setAiModeChooserOpen(false);
      return true;
    }
    if (shouldConfirmAiModeExit({
      currentMode: aiModeKind,
      busy: aiStatus === "streaming",
    })) {
      const currentLabel = aiModeKind === "chat" ? "AI协作" : "AI优化";
      const decision = await showConfirmDialog({
        tone: "warning",
        icon: Square,
        eyebrow: "退出 AI 模式",
        title: `停止并退出${currentLabel}？`,
        message: "当前生成会停止，已经产生的内容会保留。",
        cancelValue: "cancel",
        actions: [
          {
            value: "exit",
            label: "停止并退出",
            variant: "primary",
            autoFocus: true,
          },
          {
            value: "cancel",
            label: "继续当前生成",
            variant: "ghost",
          },
        ],
      });
      if (decision !== "exit") return false;
    }
    exitAiMode();
    return true;
  };

  return {
    activateAiMode,
    exitAiMode,
    requestAiModeChange,
    requestExitAiMode,
  };
}

export function useAiModeTransitionActions(options) {
  return useMemo(
    () => createAiModeTransitionActions(options),
    [
      options.activePane,
      options.activeTabReadOnly,
      options.aiBridge,
      options.aiHasUsableProvider,
      options.aiCollaborationPending,
      options.aiModeKind,
      options.aiStatus,
      options.effectiveAiProvider,
      options.getActiveDocumentSnapshot,
      options.immersiveMode,
      options.layoutPort,
      options.leftSidebarCollapsed,
      options.openAiSettings,
      options.setAiModeChooserOpen,
      options.setAiModeKind,
      options.setAiPageTransition,
      options.setAiSelectedProvider,
      options.showConfirmDialog,
      options.showStatus,
      options.streamRegistry,
      options.updateActiveDocumentAiState,
    ],
  );
}
