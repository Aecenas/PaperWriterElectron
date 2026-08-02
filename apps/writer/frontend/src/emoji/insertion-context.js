function selectionSnapshot(editor) {
  const selection = editor?.state?.selection;
  if (!selection) return null;
  const from = Number(selection.from);
  const to = Number(selection.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return null;
  return Object.freeze({ from, to });
}

function sameIdentity(left, right) {
  return String(left ?? "") === String(right ?? "");
}

export function isSingleUnicodeGrapheme(value) {
  const text = String(value || "");
  if (!text || /[\u0000-\u001f\u007f]/u.test(text)) return false;
  const looksLikeEmoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\ufe0f?\u20e3/u.test(text);
  if (!looksLikeEmoji) return false;
  if (typeof Intl?.Segmenter === "function") {
    const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)];
    return segments.length === 1 && segments[0].segment === text;
  }
  return !/\s/u.test(text) && Array.from(text).length <= 16;
}

export function captureEmojiInsertionContext({
  tabId,
  documentId,
  editorId,
  editor,
  revision,
} = {}) {
  const selection = selectionSnapshot(editor);
  if (!editor || !selection) return null;
  return Object.freeze({
    tabId: String(tabId ?? ""),
    documentId: String(documentId ?? ""),
    editorId: String(editorId ?? ""),
    editor,
    editorDocument: editor.state?.doc || null,
    selection,
    revision: revision ?? null,
  });
}

export function validateEmojiInsertionContext(context, {
  tabId,
  documentId,
  editorId,
  editor,
  revision,
} = {}) {
  if (!context?.editor || !editor) return { valid: false, reason: "editor-missing" };
  if (context.editor !== editor || !sameIdentity(context.editorId, editorId)) {
    return { valid: false, reason: "editor-changed" };
  }
  if (!sameIdentity(context.tabId, tabId)) return { valid: false, reason: "tab-changed" };
  if (!sameIdentity(context.documentId, documentId)) return { valid: false, reason: "document-changed" };
  if (!sameIdentity(context.revision, revision)) return { valid: false, reason: "revision-changed" };
  if (editor.isDestroyed || editor.isEditable === false) return { valid: false, reason: "editor-readonly" };

  const currentSelection = selectionSnapshot(editor);
  if (!currentSelection
    || currentSelection.from !== context.selection.from
    || currentSelection.to !== context.selection.to) {
    return { valid: false, reason: "selection-changed" };
  }
  const currentDocument = editor.state?.doc;
  if (context.editorDocument && currentDocument) {
    const unchanged = typeof currentDocument.eq === "function"
      ? currentDocument.eq(context.editorDocument)
      : currentDocument === context.editorDocument;
    if (!unchanged) return { valid: false, reason: "content-changed" };
  }
  return { valid: true, reason: "" };
}

export function insertEmojiFromContext(context, currentContext, unicode) {
  const validation = validateEmojiInsertionContext(context, currentContext);
  if (!validation.valid) return validation;
  if (!isSingleUnicodeGrapheme(unicode)) return { valid: false, reason: "invalid-grapheme" };

  const editor = currentContext.editor;
  try {
    const applied = editor
      .chain()
      .focus()
      .setTextSelection({ from: context.selection.from, to: context.selection.to })
      .insertContent(String(unicode))
      .run();
    return applied === false
      ? { valid: false, reason: "insert-rejected" }
      : { valid: true, reason: "", unicode: String(unicode) };
  } catch {
    return { valid: false, reason: "insert-failed" };
  }
}
