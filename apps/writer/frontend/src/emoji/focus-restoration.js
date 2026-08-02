function focusCandidate(value, body) {
  return value
    && value !== body
    && value.isConnected !== false
    && typeof value.focus === "function";
}

export function resolveEmojiFocusTarget({
  returnFocus = null,
  previousFocus = null,
  editorFocus = null,
  body = globalThis.document?.body || null,
} = {}) {
  return [returnFocus, previousFocus, editorFocus]
    .find((candidate) => focusCandidate(candidate, body)) || null;
}

export function restoreEmojiPickerFocus({
  returnFocus = null,
  previousFocus = null,
  editorFocus = null,
  body = globalThis.document?.body || null,
  requestFrame = globalThis.requestAnimationFrame,
} = {}) {
  const focus = () => {
    const target = resolveEmojiFocusTarget({
      returnFocus,
      previousFocus,
      editorFocus,
      body,
    });
    target?.focus({ preventScroll: true });
    return target;
  };
  if (typeof requestFrame === "function") {
    requestFrame(focus);
    return true;
  }
  return Boolean(focus());
}
