const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
  registerDiagnosticsIpcHandlers,
  sanitizeDebugLogData,
} = require("./diagnostics-ipc.cjs");

test("debug payloads redact paths, content, credentials, and URL details", () => {
  const circular = {};
  circular.self = circular;
  const sanitized = sanitizeDebugLogData({
    filePath: "C:\\Users\\Alice\\Private\\draft.letterpaper",
    apiKey: "sk-super-secret-value",
    baseUrl: "https://api.example.com/v1?account=alice",
    content: "private draft body",
    message: "failed at C:\\Users\\Alice\\Private\\draft.letterpaper with Bearer abc123",
    circular,
  });
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /Alice|draft\.letterpaper|private draft body|super-secret|abc123|account=/i);
  assert.equal(sanitized.baseUrl, "https://api.example.com");
  assert.equal(sanitized.apiKey, "[REDACTED]");
  assert.equal(sanitized.content, "[CONTENT_REDACTED]");
  assert.match(sanitized.filePath, /^\[PATH:[a-f0-9]{12}\]$/);
  assert.equal(sanitized.circular.self, "[TRUNCATED]");
});

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
    await handlers.get("debug:log")({}, "renderer:test-event", { ms: 1, note: "drop me" }),
    { ok: true },
  );
  assert.deepEqual(
    await handlers.get("debug:log")({}, "", null),
    { ok: false, error: "unsupported-event" },
  );
  assert.deepEqual(
    await handlers.get("debug:log")({}, "renderer:private", {
      note: "private body",
      content: "another private body",
      path: "C:\\Users\\Alice\\draft.letterpaper",
      ms: 12,
    }),
    { ok: true },
  );
  assert.deepEqual(logs, [
    ["renderer:test-event", { ms: 1 }],
    ["renderer:private", {
      path: sanitizeDebugLogData("C:\\Users\\Alice\\draft.letterpaper", "path"),
      ms: 12,
    }],
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /private body|another private body|Alice|draft\.letterpaper/);
});

test("main delegates diagnostics without mixing debug logging into AI handlers", async () => {
  const source = await fs.readFile(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(source, /require\("\.\/diagnostics-ipc\.cjs"\)/);
  assert.match(source, /registerDiagnosticsIpcHandlers\(\{/);
  assert.match(source, /writeDebugLog:\s*writeAiDebugLog/);
  assert.doesNotMatch(source, /ipcMain\.handle\("debug:log"/);
});
