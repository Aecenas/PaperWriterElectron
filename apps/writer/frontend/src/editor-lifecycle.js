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

export function readEditorSelectionState(editor) {
  const selection = editor?.state?.selection;
  if (!selection || !Number.isFinite(selection.from) || !Number.isFinite(selection.to)) {
    return null;
  }
  return {
    from: selection.from,
    to: selection.to,
  };
}

export function restoreEditorSelectionWithoutHistory(editor, selectionState) {
  if (!editor?.view || !editor?.state?.doc) return false;
  const requestedFrom = Number(selectionState?.from);
  const requestedTo = Number(selectionState?.to);
  if (!Number.isFinite(requestedFrom) || !Number.isFinite(requestedTo)) return false;

  const maximumPosition = Math.max(0, editor.state.doc.content.size);
  const from = Math.max(0, Math.min(maximumPosition, Math.floor(Math.min(requestedFrom, requestedTo))));
  const to = Math.max(from, Math.min(maximumPosition, Math.floor(Math.max(requestedFrom, requestedTo))));
  const nextSelection = TextSelection.between(
    editor.state.doc.resolve(from),
    editor.state.doc.resolve(to),
    1,
  );
  editor.view.dispatch(
    editor.state.tr
      .setSelection(nextSelection)
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

function readLiveRevision(revisionSource, tabId) {
  const revision = typeof revisionSource?.readLiveRevision === "function"
    ? revisionSource.readLiveRevision(tabId)
    : revisionSource?.get?.(tabId);
  return Math.max(0, Math.floor(Number(revision) || 0));
}

export function snapshotTabsWithRevisions(tabs = [], revisionSource) {
  return tabs.map((tab) => ({
    ...tab,
    snapshotRevision: readLiveRevision(revisionSource, tab?.id),
  }));
}

export function snapshotRevisionIsCurrent(tab, revisionSource) {
  if (!tab) return false;
  const currentRevision = readLiveRevision(revisionSource, tab.id);
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
    && !(typeof pendingSaves?.hasPending === "function"
      ? pendingSaves.hasPending(tab.id)
      : pendingSaves?.has?.(tab.id))
    && !pendingCloses?.has?.(tab.id)
  ));
}
