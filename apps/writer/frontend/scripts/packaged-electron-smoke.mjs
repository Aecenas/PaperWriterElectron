import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
const require = createRequire(import.meta.url);
const JSZip = require("../../electron/node_modules/jszip");

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
const fixturePath = path.join(temporaryAppData, "startup-images.letterpaper");
const fixture = new JSZip();
const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR42mNkYPj/n4GBgQEABQAB/WTN8QAAAABJRU5ErkJggg==";
fixture.file("document.json", JSON.stringify({
  version: 3,
  documentId: "30000000-0000-4000-8000-000000000001",
  title: "Startup recovery regression",
  html: '<section data-type="paper-toc"></section>' + Array.from({ length: 21 }, (_, index) => (
    `<h2>Section ${index + 1}</h2>${Array.from({ length: 20 }, (_, paragraph) => `<p>Startup recovery text ${index + 1} paragraph ${paragraph} ${"long document regression content ".repeat(3)}</p>`).join("")}<figure data-type="paper-image" data-image-id="40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}"><img src="${image}"></figure>`
  )).join(""),
}));
await writeFile(fixturePath, await fixture.generateAsync({ type: "nodebuffer" }));
// An optional real-world fixture is copied into the sandbox; never open the original.
const externalFixture = process.argv[3];
if (externalFixture) await copyFile(path.resolve(externalFixture), fixturePath);
// Both possible userData locations are inside this isolated test directory.
for (const userData of [temporaryAppData, path.join(temporaryAppData, "笺间")]) {
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(userData, "filesystem-access.json"), JSON.stringify({ version: 1, roots: [temporaryAppData], documents: [fixturePath] }));
}
const debugPort = await reserveLoopbackPort();
const diagnostics = [];
let browser;
let child;

try {
  for (let launchIndex = 0; launchIndex < 2; launchIndex++) {
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
  page.on("pageerror", error => process.stderr.write(`[packaged-smoke] renderer error: ${error.message}\n`));
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

  if (launchIndex === 0) {
    await page.evaluate((filePath) => {
      localStorage.setItem("paperwriter.sessionState", JSON.stringify({ folderPath: "", activePath: filePath, tabs: [{ path: filePath, temporary: false }] }));
    }, fixturePath);
    await page.reload();
  }
  await page.waitForFunction((external) => (
    external ? document.querySelector(".tiptap")?.textContent.length > 1000
      : document.querySelectorAll(".tiptap .paper-image-figure").length === 21
        && document.querySelector(".tiptap")?.textContent.includes("Startup recovery text 21")
  ), Boolean(externalFixture), { timeout: 60_000 }).catch(async error => {
    process.stderr.write(JSON.stringify(await page.evaluate(async () => ({
      length: document.querySelector(".tiptap")?.textContent.length,
      images: document.querySelectorAll(".tiptap .paper-image-figure").length,
      boundary: document.querySelector(".app-error-boundary")?.textContent,
      sessionState: localStorage.getItem("paperwriter.sessionState"),
      paths: await window.paperWriter?.getPaths?.(),
      body: document.body?.innerText?.slice(0, 500),
    }))) + "\n");
    process.stderr.write(`[packaged-smoke] main process diagnostics:\n${diagnosticsText()}\n`);
    throw error;
  });
  await page.waitForTimeout(1500);
  assert.equal(await page.locator(".app-error-boundary").count(), 0);
  process.stdout.write(`[packaged-smoke] multi-image session restored on launch ${launchIndex + 1}\n`);

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
  await browser.close().catch(() => undefined);
  browser = null;
  }
  process.stdout.write("Packaged Electron smoke passed: ASAR UI, preload IPC, multi-image session and cold restart.\n");
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
