import { useMemo } from "react";
import { createAiChatSelectionId } from "../ai/context.js";

export function createAiChatSelectionActions({
  aiChatSelections,
  editor,
  selectionIdFactory = createAiChatSelectionId,
  showStatus,
  updateChatState,
}) {
  const handleCaptureAiChatSelection = (selection) => {
    if (!selection?.text) {
      showStatus("请先在左侧标记一段文字", "warning");
      return;
    }
    const displayIndex = aiChatSelections.length + 1;
    updateChatState((chat) => ({
      ...chat,
      selectedTexts: [
        ...chat.selectedTexts,
        { ...selection, id: selectionIdFactory() },
      ],
    }));
    showStatus(`已记录标记文字${displayIndex}`, "success");
  };

  const handleRemoveAiChatSelection = (selectionId) => {
    updateChatState((chat) => ({
      ...chat,
      selectedTexts: chat.selectedTexts.filter(
        (selection) => selection.id !== selectionId,
      ),
    }));
  };

  const handleJumpAiChatSelection = (selection) => {
    if (!editor || !selection) {
      return;
    }
    const maxPosition = editor.state.doc.content.size;
    const from = Math.max(
      1,
      Math.min(Number(selection.from) || 1, maxPosition),
    );
    const to = Math.max(
      1,
      Math.min(Number(selection.to) || 1, maxPosition),
    );
    if (from === to) {
      showStatus("这条标记文字的位置已失效", "warning");
      return;
    }
    editor
      .chain()
      .focus()
      .setTextSelection({
        from: Math.min(from, to),
        to: Math.max(from, to),
      })
      .scrollIntoView()
      .run();
  };

  return {
    handleCaptureAiChatSelection,
    handleJumpAiChatSelection,
    handleRemoveAiChatSelection,
  };
}

export function useAiChatSelectionActions(options) {
  return useMemo(
    () => createAiChatSelectionActions(options),
    [
      options.aiChatSelections,
      options.editor,
      options.selectionIdFactory,
      options.showStatus,
      options.updateChatState,
    ],
  );
}
