import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..");
const electronRoot = path.resolve(frontendRoot, "..", "electron");
const frontendEntry = path.join(frontendRoot, "dist", "index.html");
const require = createRequire(import.meta.url);

async function withTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function stage(message) {
  process.stdout.write(`[electron-smoke] ${message}\n`);
}

async function terminateElectronApp(app, child) {
  if (!child || child.exitCode !== null) return;
  await withTimeout(
    Promise.resolve().then(() => app?.close?.()),
    5_000,
    "timed out while closing Electron after smoke",
  ).catch(() => undefined);
  if (child.exitCode === null) {
    child.kill();
    await withTimeout(
      new Promise((resolve) => child.once("exit", resolve)),
      5_000,
      "timed out while terminating Electron after smoke",
    ).catch(() => undefined);
  }
}

await access(frontendEntry).catch(() => {
  throw new Error("Electron smoke requires a production frontend build; run npm run build first.");
});
const electronExecutable = require(path.join(
  electronRoot,
  "node_modules",
  "electron",
));
const temporaryUserData = await mkdtemp(path.join(os.tmpdir(), "paperwriter-electron-smoke-"));
let electronApp = null;
let electronProcess = null;

try {
  stage(`launching with temporary userData: ${temporaryUserData}`);
  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [electronRoot],
    cwd: electronRoot,
    env: {
      ...process.env,
      PAPERWRITER_FRONTEND_URL: "",
      PAPERWRITER_SMOKE_TEST: "1",
      PAPERWRITER_SMOKE_USER_DATA_DIR: temporaryUserData,
    },
    timeout: 60_000,
  });
  electronProcess = electronApp.process();

  stage("waiting for the first BrowserWindow");
  const page = await electronApp.firstWindow({ timeout: 60_000 });
  stage("waiting for preload and application shell");
  await page.waitForFunction(
    () => window.paperWriter?.isElectron === true,
    null,
    { timeout: 60_000 },
  );
  await page.locator(".desktop-shell").waitFor({ state: "visible", timeout: 60_000 });

  const mainUserData = await electronApp.evaluate(({ app }) => app.getPath("userData"));
  assert.equal(path.resolve(mainUserData), path.resolve(temporaryUserData));

  const bridgeResult = await page.evaluate(async () => {
    const paths = await window.paperWriter.getPaths();
    const fullscreen = await window.paperWriter.getFullscreen();
    return {
      documents: paths?.documents,
      fullscreen,
      isElectron: window.paperWriter.isElectron,
    };
  });
  assert.equal(bridgeResult.isElectron, true);
  assert.equal(typeof bridgeResult.documents, "string");
  assert.deepEqual(bridgeResult.fullscreen, { fullscreen: false });
  stage("preload IPC verified; requesting native window close");

  let closeRequests = 0;
  let resolveCloseRequest;
  const closeRequestObserved = new Promise((resolve) => {
    resolveCloseRequest = resolve;
  });
  await page.exposeFunction("__paperWriterSmokeCloseRequested", () => {
    closeRequests += 1;
    resolveCloseRequest();
  });
  await page.evaluate(() => {
    window.paperWriter.onCloseRequest(async (payload) => {
      await window.__paperWriterSmokeCloseRequested();
      // Complete the native request/ready round trip explicitly. The default
      // untitled document may legitimately require a user decision, which a
      // non-interactive CI smoke must not guess on the user's behalf.
      await window.paperWriter.closeReady({
        ...payload,
        smoke: true,
      });
    });
  });

  const processExited = new Promise((resolve, reject) => {
    const child = electronProcess;
    child.once("exit", (code, signal) => {
      if (code === 0 || code === null) resolve({ code, signal });
      else reject(new Error(`Electron exited with code ${code}${signal ? ` (${signal})` : ""}`));
    });
    child.once("error", reject);
  });
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  }).catch((error) => {
    if (!/closed|destroyed|Target page, context or browser has been closed/i.test(String(error?.message || error))) {
      throw error;
    }
  });
  await withTimeout(
    closeRequestObserved,
    15_000,
    "renderer did not receive app:close-request",
  );
  await withTimeout(
    processExited,
    30_000,
    "Electron did not finish the close request/ready handshake",
  );
  assert.equal(closeRequests, 1);
  electronApp = null;
  electronProcess = null;
  process.stdout.write("Electron smoke passed: temporary userData, preload IPC, and close request/ready handshake.\n");
} finally {
  if (electronApp || electronProcess) {
    await terminateElectronApp(electronApp, electronProcess);
  }
  await rm(temporaryUserData, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  }).catch((error) => {
    process.stderr.write(`[electron-smoke] temporary cleanup failed: ${error.message}\n`);
  });
}
