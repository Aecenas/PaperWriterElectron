const assert = require("node:assert/strict");
const test = require("node:test");

const { registerResearchTranslationIpcHandlers } = require("./research-translation-ipc.cjs");

test("research translation IPC exposes translate and cancel without widening payloads", async () => {
  const handlers = new Map();
  const calls = [];
  const event = { sender: { id: 7 } };
  registerResearchTranslationIpcHandlers({
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    researchTranslationFacade: {
      async translate(...args) { calls.push(["translate", ...args]); return { ok: true }; },
      async cancel(...args) { calls.push(["cancel", ...args]); return { ok: true }; },
    },
  });
  assert.deepEqual([...handlers.keys()].sort(), [
    "research-translation:cancel",
    "research-translation:translate",
  ]);
  const value = { requestId: "ai-research-translation-test-123456", blocks: [] };
  await handlers.get("research-translation:translate")(event, value);
  await handlers.get("research-translation:cancel")(event, value.requestId);
  assert.deepEqual(calls, [
    ["translate", event, value],
    ["cancel", value.requestId],
  ]);
});
