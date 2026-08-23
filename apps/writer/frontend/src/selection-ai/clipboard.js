export function copySelectionAiPlainText(event, selection = globalThis.getSelection?.()) {
  const root = event?.currentTarget;
  if (
    !event?.clipboardData
    || !root
    || !selection
    || selection.isCollapsed
    || !selection.anchorNode
    || !selection.focusNode
    || !root.contains?.(selection.anchorNode)
    || !root.contains?.(selection.focusNode)
  ) {
    return false;
  }

  const text = selection.toString();
  if (!text) return false;

  event.preventDefault();
  event.clipboardData.clearData?.();
  event.clipboardData.setData("text/plain", text);
  return true;
}
