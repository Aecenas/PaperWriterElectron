const assert = require("node:assert/strict");
const test = require("node:test");

const {
  registerCompositionIpcHandlers,
} = require("./composition-ipc.cjs");

function createHarness() {
  const handlers = new Map();
  const calls = [];
  const compositionFacade = {};
  for (const method of [
    "list",
    "get",
    "create",
    "update",
    "delete",
    "generateOutline",
    "generateSection",
    "review",
    "pause",
    "resume",
    "cancel",
    "finalize",
  ]) {
    compositionFacade[method] = (...args) => {
      calls.push([method, ...args]);
      return { ok: true };
    };
  }
  registerCompositionIpcHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    compositionFacade,
  });
  return { calls, handlers };
}

test("composition IPC exposes the persistent job command surface with bounded arguments", () => {
  const { calls, handlers } = createHarness();
  assert.deepEqual([...handlers.keys()].sort(), [
    "composition:cancel",
    "composition:create",
    "composition:delete",
    "composition:finalize",
    "composition:generate-outline",
    "composition:generate-section",
    "composition:get",
    "composition:list",
    "composition:pause",
    "composition:resume",
    "composition:review",
    "composition:update",
  ]);
  const sender = { id: 7 };
  handlers.get("composition:create")({}, { brief: { topic: "测试" } });
  handlers.get("composition:generate-outline")({ sender }, { jobId: "job-1" });
  handlers.get("composition:get")({}, "job-1");
  assert.deepEqual(calls, [
    ["create", { brief: { topic: "测试" } }],
    ["generateOutline", sender, { jobId: "job-1" }],
    ["get", "job-1"],
  ]);
});

test("composition IPC rejects oversized or malformed renderer arguments before runtime", () => {
  const { calls, handlers } = createHarness();
  assert.throws(
    () => handlers.get("composition:create")({}, {
      sourceSnapshots: Array.from({ length: 5_001 }, () => ({})),
    }),
    /数组项目数量超过限制/,
  );
  assert.throws(
    () => handlers.get("composition:get")({}, "x".repeat(513)),
    /总大小超过限制/,
  );
  assert.throws(
    () => handlers.get("composition:update")({}, []),
    /必须是对象/,
  );
  assert.deepEqual(calls, []);
});
