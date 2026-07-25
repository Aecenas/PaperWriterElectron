const assert = require("node:assert/strict");
const test = require("node:test");

const { createTrustedIpcRegistrar } = require("./ipc-registrar.cjs");

function createHarness() {
  const registrations = new Map();
  const trustedUrl = "file:///app/index.html";
  const ipcMain = {
    handle(channel, listener) {
      registrations.set(channel, listener);
      return `registered:${channel}`;
    },
  };
  const mainFrame = { url: trustedUrl };
  const sender = {
    mainFrame,
    getURL: () => mainFrame.url,
  };
  const mainWindow = {
    isDestroyed: () => false,
    webContents: sender,
  };
  const registrar = createTrustedIpcRegistrar({
    ipcMain,
    getMainWindow: () => mainWindow,
    isTrustedApplicationUrl: (url) => url === trustedUrl,
  });
  return { ipcMain, mainFrame, mainWindow, registrar, registrations, sender };
}

test("registers a trusted handler without changing its event, arguments, or result", async () => {
  const harness = createHarness();
  const event = { sender: harness.sender, senderFrame: harness.mainFrame };
  const result = harness.registrar.handle("document:open", async (receivedEvent, ...args) => {
    assert.equal(receivedEvent, event);
    assert.deepEqual(args, ["path", { readOnly: true }]);
    return { ok: true };
  });

  assert.equal(result, "registered:document:open");
  assert.deepEqual(
    await harness.registrations.get("document:open")(event, "path", { readOnly: true }),
    { ok: true },
  );
});

test("rejects calls from another webContents, a subframe, or an untrusted page", async () => {
  const harness = createHarness();
  harness.registrar.handle("secure:call", async () => "ok");
  const listener = harness.registrations.get("secure:call");

  assert.throws(
    () => listener({ sender: { getURL: () => harness.mainFrame.url } }),
    /拒绝未授权的 IPC 调用/,
  );
  assert.throws(
    () => listener({ sender: harness.sender, senderFrame: { url: harness.mainFrame.url } }),
    /拒绝子框架 IPC 调用/,
  );
  assert.throws(
    () => listener({
      sender: harness.sender,
      senderFrame: { ...harness.mainFrame, url: "https://attacker.invalid" },
    }),
    /拒绝子框架 IPC 调用/,
  );

  harness.mainFrame.url = "https://attacker.invalid";
  assert.throws(
    () => listener({ sender: harness.sender, senderFrame: harness.mainFrame }),
    /拒绝非应用页面 IPC 调用/,
  );
});

test("rejects calls when the application window is missing or destroyed", async () => {
  const registrations = new Map();
  let mainWindow = null;
  const registrar = createTrustedIpcRegistrar({
    ipcMain: { handle: (channel, listener) => registrations.set(channel, listener) },
    getMainWindow: () => mainWindow,
    isTrustedApplicationUrl: () => true,
  });
  registrar.handle("secure:call", async () => "ok");
  const listener = registrations.get("secure:call");

  assert.throws(() => listener({}), /拒绝未授权的 IPC 调用/);
  mainWindow = { isDestroyed: () => true, webContents: {} };
  assert.throws(
    () => listener({ sender: mainWindow.webContents }),
    /拒绝未授权的 IPC 调用/,
  );
});

test("rejects duplicate channels before delegating to Electron", () => {
  const harness = createHarness();
  harness.registrar.handle("document:open", () => null);
  assert.throws(
    () => harness.registrar.handle("document:open", () => null),
    /拒绝重复注册 IPC channel: document:open/,
  );
  assert.equal(harness.registrations.size, 1);
});

test("does not reserve a channel when Electron rejects its registration", () => {
  let attempts = 0;
  const registrar = createTrustedIpcRegistrar({
    ipcMain: {
      handle() {
        attempts += 1;
        if (attempts === 1) throw new Error("registration failed");
      },
    },
    getMainWindow: () => null,
    isTrustedApplicationUrl: () => false,
  });

  assert.throws(() => registrar.handle("retryable", () => null), /registration failed/);
  assert.doesNotThrow(() => registrar.handle("retryable", () => null));
  assert.equal(attempts, 2);
});
