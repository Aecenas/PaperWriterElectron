import { useEffect } from "react";
import { buildAiApplyBlockManifest } from "../ai-direct-apply.js";
import { syncAiApplyPreviewDecorations } from "../editor/decorations.js";
import { isGlobalShortcutBlocked } from "../ui-interactions.js";

export function resetAiApplyTransientState({
  setAiApplyPreview,
  setManualAiApply,
  setManualFallbackAiBlockIndexes,
}) {
  setManualFallbackAiBlockIndexes([]);
  setManualAiApply(null);
  setAiApplyPreview(null);
}

export function useAiApplyResetLifecycle({
  activeDocumentKey,
  aiOutput,
  setAiApplyPreview,
  setManualAiApply,
  setManualFallbackAiBlockIndexes,
}) {
  useEffect(() => {
    resetAiApplyTransientState({
      setAiApplyPreview,
      setManualAiApply,
      setManualFallbackAiBlockIndexes,
    });
  }, [activeDocumentKey, aiOutput]);
}

export function subscribeAiApplyPreview({
  aiApplyPreview,
  cancelAiApplyPreview,
  confirmAiApplyPreview,
  editor,
  eventHost = globalThis,
  shortcutBlocked = isGlobalShortcutBlocked,
  syncPreviewDecorations = syncAiApplyPreviewDecorations,
}) {
  if (!editor) return undefined;
  syncPreviewDecorations(
    editor,
    aiApplyPreview
      ? {
          ...aiApplyPreview,
          onConfirm: confirmAiApplyPreview,
          onCancel: cancelAiApplyPreview,
        }
      : null,
  );
  if (!aiApplyPreview) return undefined;
  const handleKeyDown = (event) => {
    if (shortcutBlocked(event)) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    cancelAiApplyPreview();
  };
  eventHost.addEventListener("keydown", handleKeyDown, true);
  return () => {
    eventHost.removeEventListener("keydown", handleKeyDown, true);
    syncPreviewDecorations(editor, null);
  };
}

export function useAiApplyPreviewLifecycle(options) {
  useEffect(
    () => subscribeAiApplyPreview({
      ...options,
      eventHost: window,
    }),
    [
      options.aiApplyPreview,
      options.cancelAiApplyPreview,
      options.confirmAiApplyPreview,
      options.editor,
    ],
  );
}

export function subscribeManualAiApplyTargeting({
  buildManifest = buildAiApplyBlockManifest,
  editor,
  elementType = globalThis.Element,
  eventHost = globalThis,
  handleManualAiApplyTarget,
  manualAiApply,
  setManualAiApply,
  shortcutBlocked = isGlobalShortcutBlocked,
  showStatus,
}) {
  if (!editor || !manualAiApply) return undefined;
  const root = editor.view.dom;
  let hoverManifest = buildManifest(editor.state.doc);
  let hovered = null;
  const clearHovered = () => {
    hovered?.classList?.remove("ai-manual-apply-hover");
    hovered?.classList?.remove("ai-manual-apply-protected");
    hovered = null;
  };
  const rootChildFromEvent = (event) => {
    let element = elementType && event.target instanceof elementType
      ? event.target
      : event.target?.parentElement;
    while (element && element.parentElement !== root) {
      element = element.parentElement;
    }
    return element?.parentElement === root ? element : null;
  };
  const handlePointerMove = (event) => {
    const next = rootChildFromEvent(event);
    if (next === hovered) return;
    clearHovered();
    hovered = next;
    if (!hovered) return;
    const domIndex = Array.prototype.indexOf.call(
      root.children,
      hovered,
    );
    const target = domIndex >= 0
      ? hoverManifest.blocks[domIndex]
      : null;
    hovered.classList.add(
      target?.protected
        ? "ai-manual-apply-protected"
        : "ai-manual-apply-hover",
    );
  };
  const handleClick = (event) => {
    const located = editor.view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    });
    if (!located) return;
    const manifest = buildManifest(editor.state.doc);
    const target = manifest.blocks.find(
      (block) => located.pos >= block.from && located.pos < block.to,
    ) || manifest.blocks.at(-1);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if (target.protected) {
      showStatus(
        "定稿区或受保护结构不能作为应用位置",
        "warning",
      );
      return;
    }
    void handleManualAiApplyTarget(target.id);
  };
  const handleKeyDown = (event) => {
    if (shortcutBlocked(event)) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    setManualAiApply(null);
    showStatus("已取消选择应用位置", "success");
  };
  const refreshHoverManifest = () => {
    hoverManifest = buildManifest(editor.state.doc);
  };
  root.classList.add("ai-manual-apply-targeting");
  root.addEventListener("pointermove", handlePointerMove);
  root.addEventListener("pointerleave", clearHovered);
  root.addEventListener("click", handleClick, true);
  eventHost.addEventListener("keydown", handleKeyDown, true);
  editor.on("update", refreshHoverManifest);
  return () => {
    clearHovered();
    root.classList.remove("ai-manual-apply-targeting");
    root.removeEventListener("pointermove", handlePointerMove);
    root.removeEventListener("pointerleave", clearHovered);
    root.removeEventListener("click", handleClick, true);
    eventHost.removeEventListener("keydown", handleKeyDown, true);
    editor.off("update", refreshHoverManifest);
  };
}

export function useAiManualApplyLifecycle(options) {
  useEffect(
    () => subscribeManualAiApplyTargeting({
      ...options,
      elementType: window.Element,
      eventHost: window,
    }),
    [
      options.editor,
      options.handleManualAiApplyTarget,
      options.manualAiApply,
      options.setManualAiApply,
      options.showStatus,
    ],
  );
}
