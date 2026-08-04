const assert = require("node:assert/strict");
const test = require("node:test");
const { registerHelpAssistantIpcHandlers } = require("./help-assistant-ipc.cjs");

test("AI精灵 IPC exposes only its isolated session and generation contract", async () => {
  const handlers = new Map();
  const calls = [];
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(handlers.has(channel), false);
      handlers.set(channel, handler);
    },
  };
  const facade = Object.fromEntries([
    "getState", "createSession", "setActiveSession", "renameSession",
    "deleteSession", "generate", "cancel",
  ].map((method) => [method, async (...args) => {
    calls.push([method, ...args]);
    return { ok: true };
  }]));
  registerHelpAssistantIpcHandlers({ ipcMain, helpAssistantFacade: facade });
  assert.deepEqual([...handlers.keys()].sort(), [
    "help-ai:cancel",
    "help-ai:create-session",
    "help-ai:delete-session",
    "help-ai:generate",
    "help-ai:get-state",
    "help-ai:rename-session",
    "help-ai:set-active-session",
  ]);
  const event = { sender: { id: 1 } };
  await handlers.get("help-ai:get-state")(event);
  await handlers.get("help-ai:create-session")(event);
  await handlers.get("help-ai:set-active-session")(event, "help-session-123456");
  await handlers.get("help-ai:rename-session")(event, { sessionId: "help-session-123456", title: "名字" });
  await handlers.get("help-ai:delete-session")(event, "help-session-123456");
  await handlers.get("help-ai:generate")(event, { requestId: "ai-help-123456", sessionId: "help-session-123456", question: "问题" });
  await handlers.get("help-ai:cancel")(event, "ai-help-123456");
  assert.equal(calls.length, 7);
  assert.equal(calls[5][0], "generate");
  assert.equal(calls[5][1], event);
  assert.deepEqual(calls[5][2], { requestId: "ai-help-123456", sessionId: "help-session-123456", question: "问题" });
});
