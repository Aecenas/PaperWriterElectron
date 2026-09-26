const constructing = new WeakMap();
const pending = new WeakMap();

export function withEditorNodeViewConstruction(editor, create) {
  constructing.set(editor, (constructing.get(editor) || 0) + 1);
  try {
    return create();
  } finally {
    const depth = constructing.get(editor) - 1;
    if (depth) constructing.set(editor, depth);
    else constructing.delete(editor);
  }
}

// React node views flush passive effects synchronously while ProseMirror's
// view tree is only partially built. Coalesce view-only updates until the
// outer editor update has returned. Outside that boundary, retain sync APIs.
export function deferEditorViewUpdate(editor, key, update) {
  if (!editor || (!constructing.has(editor) && !pending.has(editor))) return false;
  let updates = pending.get(editor);
  if (!updates) {
    updates = new Map();
    pending.set(editor, updates);
    queueMicrotask(() => {
      pending.delete(editor);
      if (editor.isDestroyed) return;
      for (const apply of updates.values()) {
        if (editor.isDestroyed) break;
        apply();
      }
    });
  }
  updates.set(key, update);
  return true;
}

export function setEditorEditable(editor, editable) {
  if (!editor || editor.isDestroyed) return;
  if (deferEditorViewUpdate(editor, "editable", () => setEditorEditable(editor, editable))) return;
  editor.setEditable(editable);
}
