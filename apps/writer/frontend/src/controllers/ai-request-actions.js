import { useMemo } from "react";
import { bridge } from "../bridge.js";
import {
  AI_CHAT_SYSTEM_PREFIX,
  CODEX_DOCUMENT_ONLY_SCOPE,
} from "../ai/constants.js";
import {
  buildAiChatContextInput,
  buildAiChatContextSignature,
  buildAiPromptInput,
  createAiRequestId,
} from "../ai/context.js";
import {
  createEmptyAiChatState,
  createEmptyAiOptimizeState,
} from "../ai/state.js";
import {
  chatMessagesToMarkdown,
  copyAiBlockToClipboard,
  estimateTokenCount,
} from "../ai/usage.js";
import { normalizeCodexImageMode } from "../codex-scope.js";
import { getLetterTemplate } from "../templates/model.js";

export function createAiRequestActions({
  activeTabReadOnly,
  aiBridge = bridge,
  aiChatCodexImageMode,
  aiChatInput,
  aiChatMessages,
  aiChatSelections,
  aiHasUsableProvider,
  aiStatus,
  currentPath,
  effectiveAiConfig,
  editor,
  getActiveDocumentKey,
  getActiveDocumentSnapshot,
  letterTemplates,
  now = Date.now,
  openAiSettings,
  registry,
  requestIdFactory = createAiRequestId,
  showStatus,
  updateChatState,
  updateChatStateForKey,
  updateOptimizeState,
  updateOptimizeStateForKey,
  writingWorkspaceRoot,
}) {
  const handleStopAi = () => {
    registry.cancelActive((requestId) => aiBridge.cancelAi?.(requestId));
  };

  const handleStartAiOptimize = async () => {
    if (aiStatus === "streaming") return;
    if (activeTabReadOnly) {
      showStatus("当前信笺为只读，不能启动 AI 优化", "warning");
      return;
    }
    if (!aiHasUsableProvider) {
      openAiSettings();
      showStatus("请先配置模型", "warning");
      return;
    }
    const activeDocument = getActiveDocumentSnapshot()?.document;
    const activePresentation = getLetterTemplate(activeDocument, letterTemplates).presentation;
    const aiInput = buildAiPromptInput(editor, activePresentation);
    if (!aiInput.body) {
      showStatus("正文为空，暂时没有可交给 AI 优化的内容", "warning");
      return;
    }
    const requestId = requestIdFactory();
    const documentKey = getActiveDocumentKey();
    const startedAt = now();
    const promptTokenEstimate = estimateTokenCount(aiInput.prompt);
    updateOptimizeStateForKey(documentKey, {
      output: "",
      status: "streaming",
      error: "",
      assets: aiInput.assets,
      elapsedSeconds: 0,
      tokenStats: null,
      provider: effectiveAiConfig.provider,
      modelId: effectiveAiConfig.modelId,
      modelName: effectiveAiConfig.modelName || effectiveAiConfig.model,
    });
    registry.startRequest({
      documentKey,
      kind: "optimize",
      promptTokenEstimate,
      requestId,
      startedAt,
    });
    const result = await aiBridge.generateAi?.({
      requestId,
      provider: effectiveAiConfig.provider,
      modelId: effectiveAiConfig.modelId,
      prompt: aiInput.prompt,
      workspacePath: writingWorkspaceRoot,
      documentPath: currentPath,
    });
    if (!result?.ok) {
      registry.retireStartFailure(requestId);
      updateOptimizeStateForKey(documentKey, {
        status: "error",
        error: result?.message || "AI 生成启动失败",
        elapsedSeconds: 0,
      });
      showStatus(result?.message || "AI 生成启动失败", "warning");
    }
  };

  const handleSendAiChat = async () => {
    const question = aiChatInput.trim();
    if (!question || aiStatus === "streaming") return;
    if (activeTabReadOnly) {
      showStatus("当前信笺为只读，不能发送 AI 问答", "warning");
      return;
    }
    if (!aiHasUsableProvider) {
      openAiSettings();
      showStatus("请先配置模型", "warning");
      return;
    }

    const activeDocument = getActiveDocumentSnapshot()?.document;
    const activePresentation = getLetterTemplate(activeDocument, letterTemplates).presentation;
    const nextSignature = buildAiChatContextSignature(
      editor,
      activeDocument,
      activePresentation,
    );
    const chatContext = registry.resolveChatContext(
      nextSignature,
      () => buildAiChatContextInput(
        editor,
        activeDocument,
        activePresentation,
        nextSignature,
      ),
    );
    const selectedTextBlocks = aiChatSelections
      .map((selection, index) => {
        const text = selection.text?.trim();
        return text
          ? `<<<SELECTED_TEXT_${index + 1}\n${text}\nSELECTED_TEXT_${index + 1}>>>`
          : "";
      })
      .filter(Boolean);
    const selectedTextContext = selectedTextBlocks.length
      ? `\n\n用户额外标记的文字：\n${selectedTextBlocks.join("\n\n")}`
      : "";

    const createdAt = now();
    const userMessage = {
      id: `user-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      role: "user",
      content: question,
      status: "done",
      createdAt,
    };
    const assistantMessage = {
      id: `assistant-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      role: "assistant",
      content: "",
      status: "streaming",
      elapsedSeconds: 0,
      createdAt,
    };
    const history = registry.getChatMessages()
      .filter((message) => (
        (message.role === "user" || message.role === "assistant")
        && message.content?.trim()
      ))
      .map((message) => ({ role: message.role, content: message.content }));
    const isCodexChat = effectiveAiConfig.transport === "codex-cli";
    const attachOriginalImages = isCodexChat
      && aiChatCodexImageMode === "original"
      && chatContext.images.length > 0;
    const imageContextInstruction = attachOriginalImages
      ? "当前信笺的全部原图已作为图片附件提供；正文中的 [图N.标题] 与附件顺序一一对应。"
      : "当前信笺图片未提供原图，只能依据正文中的 [图N.标题] 占位理解图片。";
    const messages = [
      {
        role: "system",
        content: `${AI_CHAT_SYSTEM_PREFIX}\n${imageContextInstruction}\n\n当前信笺内容：\n${chatContext.context}${selectedTextContext}`,
      },
      ...history,
      { role: "user", content: question },
    ];
    const requestId = requestIdFactory();
    const documentKey = getActiveDocumentKey();
    const startedAt = now();
    const promptTokenEstimate = estimateTokenCount(
      messages.map((message) => message.content).join("\n"),
    );

    updateChatStateForKey(documentKey, (chat) => ({
      ...chat,
      input: "",
      messages: [...chat.messages, userMessage, assistantMessage],
      status: "streaming",
      error: "",
    }));
    registry.startRequest({
      assistantId: assistantMessage.id,
      documentKey,
      kind: "chat",
      promptTokenEstimate,
      requestId,
      startedAt,
    });

    const result = await aiBridge.generateAi?.({
      requestId,
      provider: effectiveAiConfig.provider,
      modelId: effectiveAiConfig.modelId,
      messages,
      workspacePath: writingWorkspaceRoot,
      documentPath: currentPath,
      codexScope: { ...CODEX_DOCUMENT_ONLY_SCOPE },
      ...(isCodexChat ? {
        codexImageMode: aiChatCodexImageMode,
        codexImages: attachOriginalImages ? chatContext.images : [],
      } : {}),
    });
    if (!result?.ok) {
      const message = result?.message || "AI 生成启动失败";
      registry.retireStartFailure(requestId);
      updateChatStateForKey(documentKey, (chat) => ({
        ...chat,
        status: "error",
        error: message,
        messages: chat.messages.map((item) => (
          item.id === assistantMessage.id
            ? { ...item, content: message, status: "error" }
            : item
        )),
      }));
      showStatus(message, "warning");
    }
  };

  const handleClearAiChat = () => {
    if (aiStatus === "streaming") return;
    updateChatState({
      ...createEmptyAiChatState(),
      codexImageMode: aiChatCodexImageMode,
    });
  };

  const handleCodexImageModeChange = (codexImageMode) => {
    updateChatState({
      codexImageMode: normalizeCodexImageMode(codexImageMode),
    });
  };

  const handleClearAiOptimize = () => {
    if (aiStatus === "streaming") return;
    updateOptimizeState(createEmptyAiOptimizeState());
  };

  const handleExportAiChat = async () => {
    if (!aiChatMessages.length) {
      showStatus("当前没有可导出的问答记录", "warning");
      return;
    }
    const activeDocument = getActiveDocumentSnapshot()?.document;
    const markdown = chatMessagesToMarkdown(activeDocument, aiChatMessages);
    const result = await aiBridge.exportAiChat?.({
      title: activeDocument?.title || "AI问答",
      markdown,
    });
    if (!result?.canceled) {
      showStatus("AI 问答记录已导出", "success");
    }
  };

  const handleCopyAiBlock = async (block) => {
    try {
      await copyAiBlockToClipboard(block);
      showStatus("已复制这一块", "success");
    } catch (error) {
      showStatus(error?.message || "复制失败", "warning");
    }
  };

  return {
    handleClearAiChat,
    handleClearAiOptimize,
    handleCodexImageModeChange,
    handleCopyAiBlock,
    handleExportAiChat,
    handleSendAiChat,
    handleStartAiOptimize,
    handleStopAi,
  };
}

export function useAiRequestActions(options) {
  return useMemo(
    () => createAiRequestActions(options),
    [
      options.activeTabReadOnly,
      options.aiBridge,
      options.aiChatCodexImageMode,
      options.aiChatInput,
      options.aiChatMessages,
      options.aiChatSelections,
      options.aiHasUsableProvider,
      options.aiStatus,
      options.currentPath,
      options.editor,
      options.effectiveAiConfig,
      options.getActiveDocumentKey,
      options.getActiveDocumentSnapshot,
      options.letterTemplates,
      options.openAiSettings,
      options.registry,
      options.showStatus,
      options.updateChatState,
      options.updateChatStateForKey,
      options.updateOptimizeState,
      options.updateOptimizeStateForKey,
      options.writingWorkspaceRoot,
    ],
  );
}
