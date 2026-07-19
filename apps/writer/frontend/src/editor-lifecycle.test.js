import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import {
  deleteRecoveryBestEffort,
  readEditorSelectionState,
  replaceEditorContentWithoutHistory,
  restoreEditorSelectionWithoutHistory,
  sameDocumentPath,
  selectAutosaveSnapshotTabs,
  sessionTabSignature,
  snapshotRevisionIsCurrent,
  snapshotTabsWithRevisions,
} from "./editor-lifecycle.js";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
});

function docWithText(text) {
  return schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]);
}

test("document replacement rebuilds plugin state and clears undo history", () => {
  let state = EditorState.create({ schema, doc: docWithText("A"), plugins: [history()] });
  state = state.apply(state.tr.insertText(" changed", 2));
  assert.equal(undo(state, () => {}), true);

  const editor = {
    get state() { return state; },
    commands: {
      setContent(_content, options) {
        assert.deepEqual(options, { emitUpdate: false });
        state = state.apply(state.tr.replaceWith(0, state.doc.content.size, docWithText("B").content));
      },
    },
    view: {
      updateState(nextState) { state = nextState; },
      dispatch(transaction) { state = state.apply(transaction); },
    },
  };

  assert.equal(replaceEditorContentWithoutHistory(editor, "B"), true);
  assert.equal(state.doc.textContent, "B");
  assert.equal(undo(state, () => {}), false);
});

test("a remounted secondary editor restores its saved selection without changing content or undo history", () => {
  let state = EditorState.create({ schema, doc: docWithText("secondary pane"), plugins: [history()] });
  state = state.apply(state.tr.insertText(" edited", 10));
  const documentBeforeRestore = state.doc.toJSON();
  const dispatch = (transaction) => { state = state.apply(transaction); };
  const editor = {
    get state() { return state; },
    view: { dispatch },
  };

  const savedSelection = { from: 3, to: 8 };
  assert.equal(restoreEditorSelectionWithoutHistory(editor, savedSelection), true);
  assert.deepEqual(readEditorSelectionState(editor), savedSelection);
  assert.deepEqual(state.doc.toJSON(), documentBeforeRestore);

  let undone = null;
  assert.equal(undo(state, (transaction) => { undone = state.apply(transaction); }), true);
  assert.equal(undone.doc.textContent, "secondary pane");
});

test("Windows document paths compare case-insensitively with either separator", () => {
  assert.equal(sameDocumentPath("C:\\Work\\A.letterpaper", "c:/work/a.letterpaper"), true);
  assert.equal(sameDocumentPath("C:\\Work\\A.letterpaper", "C:\\Work\\B.letterpaper"), false);
});

test("session signatures include recovery paths without serializing document bodies", () => {
  const first = sessionTabSignature("", [{ path: "", recoveryPath: "temp-a" }]);
  const second = sessionTabSignature("", [{ path: "", recoveryPath: "temp-b" }]);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /html|aiState/);
});

test("tab snapshots freeze each document together with its revision", () => {
  const revisions = new Map([["tab-a", 3], ["tab-b", 7]]);
  const snapshots = snapshotTabsWithRevisions([
    { id: "tab-a", document: { html: "A" } },
    { id: "tab-b", document: { html: "B-before" } },
  ], revisions);
  revisions.set("tab-b", 8);
  assert.equal(snapshots[1].document.html, "B-before");
  assert.equal(snapshots[1].snapshotRevision, 7);
  assert.equal(snapshotRevisionIsCurrent(snapshots[0], revisions), true);
  assert.equal(snapshotRevisionIsCurrent(snapshots[1], revisions), false);
});

test("recovery cleanup is best effort after a successful document save", async () => {
  let requestedId = "";
  assert.equal(await deleteRecoveryBestEffort(async (recoveryId) => {
    requestedId = recoveryId;
    throw new Error("locked");
  }, "recovery-a"), false);
  assert.equal(requestedId, "recovery-a");
  assert.equal(await deleteRecoveryBestEffort(async () => {}, "recovery-b"), true);
});

test("autosave skips a tab while Save As crosses the timer and later uses the new path", () => {
  const pendingSaves = new Map([["tab-a", Promise.resolve()]]);
  const pendingCloses = new Set();
  const beforeSaveAs = snapshotTabsWithRevisions([
    { id: "tab-a", path: "C:\\Docs\\A.letterpaper", dirty: true, document: { html: "snapshot" } },
  ], new Map([["tab-a", 4]]));
  assert.deepEqual(selectAutosaveSnapshotTabs(beforeSaveAs, pendingSaves, pendingCloses), []);

  pendingSaves.delete("tab-a");
  const afterSaveAs = snapshotTabsWithRevisions([
    { ...beforeSaveAs[0], path: "C:\\Docs\\B.letterpaper" },
  ], new Map([["tab-a", 4]]));
  const eligible = selectAutosaveSnapshotTabs(afterSaveAs, pendingSaves, pendingCloses);
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].path, "C:\\Docs\\B.letterpaper");
});
