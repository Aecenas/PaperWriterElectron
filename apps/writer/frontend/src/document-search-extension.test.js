import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { documentSearchPluginKey, scheduleDocumentSearchState } from "./document-search-extension.js";

function createEditorHarness() {
  const schema = new Schema({ nodes: {
    doc: { content: "text*" },
    text: {},
  } });
  const transactions = [];
  const editor = {
    isDestroyed: false,
    state: EditorState.create({ schema, doc: schema.node("doc", null, [schema.text("example")]) }),
    view: { dispatch: transaction => transactions.push(transaction) },
  };
  return { editor, transactions };
}

test("search decorations wait for node-view construction and use the current editor state", async () => {
  const { editor, transactions } = createEditorHarness();
  scheduleDocumentSearchState(editor, { matches: [{ from: 0, to: 3 }], activeIndex: 0 });
  assert.equal(transactions.length, 0);
  editor.state = editor.state.apply(editor.state.tr.insertText("new ", 0));
  await Promise.resolve();
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].before, editor.state.doc);
  assert.equal(transactions[0].getMeta(documentSearchPluginKey).matches.length, 1);
});

test("effect cleanup cancels outdated highlights and destroyed editors are ignored", async () => {
  const { editor, transactions } = createEditorHarness();
  const cancel = scheduleDocumentSearchState(editor, { matches: [{ from: 0, to: 3 }] });
  cancel();
  scheduleDocumentSearchState(editor, null);
  await Promise.resolve();
  assert.equal(transactions.length, 1);
  assert.deepEqual(transactions[0].getMeta(documentSearchPluginKey).matches, []);
  scheduleDocumentSearchState(editor, null);
  editor.isDestroyed = true;
  await Promise.resolve();
  assert.equal(transactions.length, 1);
});
