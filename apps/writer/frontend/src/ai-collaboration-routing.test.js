import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCollaborationIntentLocally,
  presentCollaborationError,
} from "./controllers/ai-collaboration-actions.js";

test("clear edit requests use the local collaboration route", () => {
  for (const prompt of [
    "把 8.3 改成 8.4",
    "请添加一个表格",
    "在合适的位置加上标题和表情",
    "将这封信笺拆分成三份",
  ]) {
    assert.equal(classifyCollaborationIntentLocally(prompt)?.mode, "collaborate", prompt);
  }
});

test("clear questions keep the answer route and ambiguous prose still asks the router", () => {
  assert.equal(classifyCollaborationIntentLocally("为什么这里用 8.3？")?.mode, "answer");
  assert.equal(classifyCollaborationIntentLocally("请解释这段话的意思")?.mode, "answer");
  assert.equal(classifyCollaborationIntentLocally("这个表格是什么意思？")?.mode, "answer");
  assert.equal(classifyCollaborationIntentLocally("围绕这段内容聊聊"), null);
});

test("collaboration errors hide Electron IPC internals and give a retry path", () => {
  const message = presentCollaborationError(new Error(
    "Error invoking remote method 'ai-collaboration:plan': Error: operation-4 没有内容",
  ));
  assert.doesNotMatch(message, /remote method|ai-collaboration:plan|operation-/);
  assert.match(message, /第 4 项修改/);
  assert.match(message, /放回输入框|重试/);
});
