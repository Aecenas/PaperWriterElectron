const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
  registerDiagnosticsIpcHandlers,
} = require("./diagnostics-ipc.cjs");

test("diagnostics registrar keeps the debug logging contract isolated", async () => {
  const handlers = new Map();
  const logs = [];
  registerDiagnosticsIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
    async writeDebugLog(...args) {
      logs.push(args);
    },
  });

  assert.deepEqual([...handlers.keys()], ["debug:log"]);
  assert.deepEqual(
    await handlers.get("debug:log")({}, "renderer-event", { value: 1 }),
    { ok: true },
  );
  assert.deepEqual(
    await handlers.get("debug:log")({}, "", null),
    { ok: true },
  );
  assert.deepEqual(logs, [
    ["renderer-event", { value: 1 }],
    ["renderer", {}],
  ]);
});

test("main delegates diagnostics without mixing debug logging into AI handlers", async () => {
  const source = await fs.readFile(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(source, /require\("\.\/diagnostics-ipc\.cjs"\)/);
  assert.match(source, /registerDiagnosticsIpcHandlers\(\{/);
  assert.match(source, /writeDebugLog:\s*writeAiDebugLog/);
  assert.doesNotMatch(source, /ipcMain\.handle\("debug:log"/);
});
