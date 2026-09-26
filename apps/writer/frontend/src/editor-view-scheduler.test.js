import assert from "node:assert/strict";
import test from "node:test";
import { deferEditorViewUpdate, setEditorEditable, withEditorNodeViewConstruction } from "./editor-view-scheduler.js";
import { publishWritingIssues } from "./writing-assistance/extension.js";

test("node-view construction defers writing checks and coalesces later updates", async () => {
  const published = [];
  const editor = { commands: { setWritingAssistanceIssues: issues => published.push(issues) } };
  withEditorNodeViewConstruction(editor, () => {
    publishWritingIssues(editor, ["old"]);
    withEditorNodeViewConstruction(editor, () => publishWritingIssues(editor, ["nested"]));
    assert.deepEqual(published, []);
  });
  publishWritingIssues(editor, ["latest"]);
  assert.deepEqual(published, []);
  await Promise.resolve();
  assert.deepEqual(published, [["latest"]]);
  publishWritingIssues(editor, ["synchronous"]);
  assert.equal(published.length, 2);
});

test("independent decoration channels survive and destroyed editors cancel queued writes", async () => {
  const editor = {};
  const calls = [];
  withEditorNodeViewConstruction(editor, () => {
    deferEditorViewUpdate(editor, "comments", () => calls.push("comments"));
    deferEditorViewUpdate(editor, "visibility", () => calls.push("visibility"));
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["comments", "visibility"]);
  withEditorNodeViewConstruction(editor, () => deferEditorViewUpdate(editor, "late", () => calls.push("late")));
  editor.isDestroyed = true;
  await Promise.resolve();
  assert.equal(calls.length, 2);
});

test("construction errors release the guard, and editable updates retain the latest state", async () => {
  const changes = [];
  const editor = { setEditable: value => changes.push(value) };
  assert.throws(() => withEditorNodeViewConstruction(editor, () => { throw new Error("test"); }));
  setEditorEditable(editor, true);
  assert.deepEqual(changes, [true]);
  withEditorNodeViewConstruction(editor, () => {
    setEditorEditable(editor, true);
    setEditorEditable(editor, false);
  });
  await Promise.resolve();
  assert.deepEqual(changes, [true, false]);
});
