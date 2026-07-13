import { EditorState, TextSelection } from "@tiptap/pm/state";

export function replaceEditorContentWithoutHistory(editor, content) {
  if (!editor?.view || !editor?.commands?.setContent) return false;
  editor.commands.setContent(content || "<p></p>", { emitUpdate: false });
  const currentState = editor.state;
  const nextState = EditorState.create({
    schema: currentState.schema,
    doc: currentState.doc,
    selection: TextSelection.atStart(currentState.doc),
    plugins: currentState.plugins,
  });
  editor.view.updateState(nextState);
  editor.view.dispatch(
    editor.state.tr
      .setMeta("addToHistory", false)
      .setMeta("preventUpdate", true),
  );
  return true;
}

export function normalizeDocumentPath(value) {
  return String(value || "")
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLocaleLowerCase("en-US");
}

export function sameDocumentPath(left, right) {
  const normalizedLeft = normalizeDocumentPath(left);
  return Boolean(normalizedLeft) && normalizedLeft === normalizeDocumentPath(right);
}

export function sessionTabSignature(activePath, tabs = []) {
  const values = [String(activePath || ""), ...tabs.map((tab) => (
    `${tab?.path || ""}\u0000${tab?.recoveryPath || ""}`
  ))];
  return values.map((value) => `${value.length}:${value}`).join("|");
}

export function snapshotTabsWithRevisions(tabs = [], revisionByTab) {
  return tabs.map((tab) => ({
    ...tab,
    snapshotRevision: Math.max(0, Math.floor(Number(revisionByTab?.get?.(tab?.id)) || 0)),
  }));
}

export function snapshotRevisionIsCurrent(tab, revisionByTab) {
  if (!tab) return false;
  const currentRevision = Math.max(0, Math.floor(Number(revisionByTab?.get?.(tab.id)) || 0));
  return currentRevision === Math.max(0, Math.floor(Number(tab.snapshotRevision) || 0));
}

export async function deleteRecoveryBestEffort(deleteTempDocument, recoveryId) {
  if (typeof deleteTempDocument !== "function" || !recoveryId) return true;
  try {
    await deleteTempDocument(recoveryId);
    return true;
  } catch {
    return false;
  }
}

export function selectAutosaveSnapshotTabs(tabs = [], pendingSaves, pendingCloses) {
  return tabs.filter((tab) => (
    Boolean(tab?.dirty)
    && !pendingSaves?.has?.(tab.id)
    && !pendingCloses?.has?.(tab.id)
  ));
}
