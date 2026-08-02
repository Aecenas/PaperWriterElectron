const assert = require("node:assert/strict");
const test = require("node:test");

const {
  registerWritingAssistanceIpcHandlers,
} = require("./writing-assistance-ipc.cjs");

test("writing assistance IPC exposes bounded config and dictionary commands", async () => {
  const handlers = new Map();
  const calls = [];
  registerWritingAssistanceIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
    writingAssistanceFacade: {
      async getConfig(...args) { calls.push(["get", ...args]); return {}; },
      async saveConfig(...args) { calls.push(["save", ...args]); return {}; },
      async addWord(...args) { calls.push(["add", ...args]); return {}; },
      async removeWord(...args) { calls.push(["remove", ...args]); return {}; },
    },
  });
  assert.deepEqual([...handlers.keys()].sort(), [
    "writing-assistance:add-word",
    "writing-assistance:get",
    "writing-assistance:remove-word",
    "writing-assistance:save",
  ]);
  await handlers.get("writing-assistance:save")({}, {
    enabled: false,
    languages: [...Array(10)].map((_, index) => `en-${index}`),
    customWords: ["word", 42],
    termRules: [{
      id: "x".repeat(200),
      wrong: "w".repeat(250),
      preferred: "right",
      description: "d".repeat(600),
      wholeWord: true,
    }],
    unexpected: "discarded",
  });
  await assert.rejects(
    handlers.get("writing-assistance:add-word")({}, "x".repeat(200)),
    /过长/,
  );
  await handlers.get("writing-assistance:add-word")({}, "x".repeat(100));
  await handlers.get("writing-assistance:remove-word")({}, "笺间");
  assert.deepEqual(calls, [
    ["save", {
      enabled: false,
      languages: [...Array(8)].map((_, index) => `en-${index}`),
      customWords: ["word", ""],
      termRules: [{
        id: "x".repeat(128),
        wrong: "w".repeat(200),
        preferred: "right",
        description: "d".repeat(500),
        caseSensitive: false,
        wholeWord: true,
        enabled: true,
      }],
    }],
    ["add", "x".repeat(100)],
    ["remove", "笺间"],
  ]);
});

test("writing assistance IPC rejects non-object, oversized patches and non-string words before runtime", async () => {
  const handlers = new Map();
  const calls = [];
  registerWritingAssistanceIpcHandlers({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
    },
    writingAssistanceFacade: {
      async getConfig() { return {}; },
      async saveConfig(value) { calls.push(value); return {}; },
      async addWord() { return {}; },
      async removeWord() { return {}; },
    },
  });
  await assert.rejects(
    handlers.get("writing-assistance:save")({}, []),
    /必须是对象/,
  );
  await assert.rejects(
    handlers.get("writing-assistance:save")({}, {
      customWords: Array.from({ length: 5_001 }, () => "word"),
    }),
    /数组项目数量超过限制/,
  );
  assert.deepEqual(calls, []);
  await assert.rejects(
    handlers.get("writing-assistance:add-word")({}, { word: "bad" }),
    /无效/,
  );
});
