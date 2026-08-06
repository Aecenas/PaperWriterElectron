import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const executable = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : null;
if (!executable) throw new Error("Pass the packaged Electron executable path.");
await access(executable).catch(() => {
  throw new Error(`Packaged Electron executable does not exist: ${executable}`);
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function connectToPackagedApp(endpoint, child, diagnostics) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Packaged Electron exited before its UI was ready (code ${child.exitCode}).\n${diagnostics()}`);
    }
    try {
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw new Error(`Timed out connecting to packaged Electron: ${lastError?.message || "unknown error"}\n${diagnostics()}`);
}

async function waitForApplicationPage(browser) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      const page = context.pages().find((candidate) => candidate.url().startsWith("file:"));
      if (page) return page;
    }
    await delay(100);
  }
  throw new Error("Packaged Electron did not create its application page.");
}

const temporaryAppData = await mkdtemp(path.join(os.tmpdir(), "paperwriter-packaged-smoke-"));
const debugPort = await reserveLoopbackPort();
const diagnostics = [];
let browser;
let child;

try {
  process.stdout.write(`[packaged-smoke] launching ${executable}\n`);
  process.stdout.write(`[packaged-smoke] isolated APPDATA: ${temporaryAppData}\n`);
  child = spawn(executable, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${temporaryAppData}`,
  ], {
    cwd: path.dirname(executable),
    env: {
      ...process.env,
      APPDATA: temporaryAppData,
      LOCALAPPDATA: temporaryAppData,
      PAPERWRITER_FRONTEND_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk) => {
      diagnostics.push(String(chunk));
      if (diagnostics.length > 100) diagnostics.shift();
    });
  }
  const diagnosticsText = () => diagnostics.join("").slice(-8_000);
  browser = await connectToPackagedApp(
    `http://127.0.0.1:${debugPort}`,
    child,
    diagnosticsText,
  );
  const page = await waitForApplicationPage(browser);
  await page.waitForFunction(
    () => window.paperWriter?.isElectron === true,
    null,
    { timeout: 60_000 },
  );
  await page.locator(".desktop-shell").waitFor({ state: "visible", timeout: 60_000 });

  const bridgeResult = await page.evaluate(async () => ({
    paths: await window.paperWriter.getPaths(),
    fullscreen: await window.paperWriter.getFullscreen(),
    isElectron: window.paperWriter.isElectron,
  }));
  assert.equal(bridgeResult.isElectron, true);
  assert.equal(typeof bridgeResult.paths?.documents, "string");
  assert.deepEqual(bridgeResult.fullscreen, { fullscreen: false });

  const processExited = new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  await page.evaluate(() => window.close());
  const exitCode = await Promise.race([
    processExited,
    delay(30_000).then(() => {
      throw new Error("Packaged Electron did not finish the close request/ready handshake.");
    }),
  ]);
  assert.ok(exitCode === 0 || exitCode === null, `unexpected packaged exit code: ${exitCode}`);
  child = null;
  process.stdout.write("Packaged Electron smoke passed: ASAR UI and preload IPC.\n");
} finally {
  await browser?.close().catch(() => undefined);
  if (child && child.exitCode === null) {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  }
  await rm(temporaryAppData, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  }).catch((error) => {
    process.stderr.write(`[packaged-smoke] temporary cleanup failed: ${error.message}\n`);
  });
}
