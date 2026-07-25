const assert = require("node:assert/strict");
const test = require("node:test");

const {
  registerAiGenerationIpcHandlers,
} = require("./ai-generation-ipc.cjs");

test("registers only the AI generation channels through one facade", () => {
  const handlers = new Map();
  registerAiGenerationIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false);
        handlers.set(channel, handler);
      },
    },
    generationFacade: {
      generate() {},
      resolveApply() {},
      cancel() {},
      exportChat() {},
    },
  });
  assert.deepEqual([...handlers.keys()].sort(), [
    "ai:cancel",
    "ai:export-chat",
    "ai:generate",
    "ai:resolve-apply",
  ]);
});

test("forwards generation payloads without changing events, ids, defaults, or results", async () => {
  const handlers = new Map();
  const calls = [];
  const generationFacade = {
    generate(...args) {
      calls.push(["generate", ...args]);
      return { ok: true, requestId: "ai-abc123" };
    },
    resolveApply(...args) {
      calls.push(["resolveApply", ...args]);
      return { ok: true, raw: "{}" };
    },
    cancel(...args) {
      calls.push(["cancel", ...args]);
      return { ok: true, canceled: true };
    },
    exportChat(...args) {
      calls.push(["exportChat", ...args]);
      return { canceled: false, path: "chat.md" };
    },
  };
  registerAiGenerationIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
    generationFacade,
  });

  const event = { sender: { id: "renderer" } };
  const generatePayload = {
    requestId: "ai-abc123",
    prompt: "hello",
  };
  const resolvePayload = { manifest: { version: 1 } };
  const exportPayload = { markdown: "# Chat" };
  assert.deepEqual(
    await handlers.get("ai:generate")(event, generatePayload),
    { ok: true, requestId: "ai-abc123" },
  );
  assert.deepEqual(
    await handlers.get("ai:resolve-apply")(event, resolvePayload),
    { ok: true, raw: "{}" },
  );
  assert.deepEqual(
    await handlers.get("ai:resolve-apply")(event),
    { ok: true, raw: "{}" },
  );
  assert.deepEqual(
    await handlers.get("ai:cancel")(event, "ai-abc123"),
    { ok: true, canceled: true },
  );
  assert.deepEqual(
    await handlers.get("ai:export-chat")(event, exportPayload),
    { canceled: false, path: "chat.md" },
  );
  assert.deepEqual(calls, [
    ["generate", event, generatePayload],
    ["resolveApply", resolvePayload],
    ["resolveApply", {}],
    ["cancel", "ai-abc123"],
    ["exportChat", exportPayload],
  ]);
});
