import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true, stdio: "ignore", timeout: 5_000,
      });
    } else {
      child.kill();
    }
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
const temporaryUserData = await realpath(await mkdtemp(path.join(os.tmpdir(), "paperwriter-electron-smoke-")));
const currentFolder = path.join(temporaryUserData, "复盘");
const externalFolder = path.join(temporaryUserData, "claude");
const currentDocument = path.join(currentFolder, "当前信笺.letterpaper");
const externalDocument = path.join(externalFolder, "大A本轮牛市复盘.letterpaper");
const legacyDocument = path.join(externalFolder, "旧版 信笺.paperdoc");
const unauthorizedSibling = path.join(externalFolder, "其他信笺.letterpaper");
const smokeEnv = {
  ...process.env,
  PAPERWRITER_FRONTEND_URL: "",
  PAPERWRITER_SMOKE_TEST: "1",
  PAPERWRITER_SMOKE_USER_DATA_DIR: temporaryUserData,
};
const JSZip = require(path.join(electronRoot, "node_modules", "jszip"));
await mkdir(currentFolder, { recursive: true });
await mkdir(externalFolder, { recursive: true });
for (const filePath of [currentDocument, externalDocument, legacyDocument, unauthorizedSibling]) {
  const fixture = new JSZip();
  fixture.file("document.json", JSON.stringify({
    version: 2,
    title: path.basename(filePath, path.extname(filePath)),
    html: `<p>External open regression: ${path.basename(filePath)}</p>`,
  }));
  await writeFile(filePath, await fixture.generateAsync({ type: "nodebuffer" }));
}
await writeFile(path.join(temporaryUserData, "filesystem-access.json"), JSON.stringify({
  version: 1, roots: [currentFolder], documents: [],
}));

async function openInRunningInstance(filePath) {
  const child = spawn(electronExecutable, [electronRoot, path.basename(filePath)], {
    cwd: path.dirname(filePath), env: smokeEnv, stdio: "ignore", windowsHide: true,
  });
  try {
    await withTimeout(new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Second instance exited with ${code}`)));
    }), 20_000, "second instance did not hand its file to the running app");
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

async function waitForActiveDocument(page, title) {
  await page.waitForFunction((expected) => (
    document.querySelector(".group-tab.active, .document-tab.active")?.textContent.includes(expected)
    && document.querySelector(".canvas.active-pane .ProseMirror")?.textContent.includes(expected)
  ), title, { timeout: 30_000 });
}

let electronApp = null;
let electronProcess = null;

try {
  stage(`launching with temporary userData: ${temporaryUserData}`);
  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [electronRoot, currentDocument],
    cwd: electronRoot,
    env: smokeEnv,
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
  stage("checking cold-start file open, then restoring the current folder");
  await waitForActiveDocument(page, "当前信笺");
  await page.evaluate(({ folderPath, documentPath }) => {
    localStorage.setItem("paperwriter.sessionState", JSON.stringify({
      folderPath, activePath: documentPath, tabs: [{ path: documentPath }],
    }));
  }, { folderPath: currentFolder, documentPath: currentDocument });
  await page.reload();
  await waitForActiveDocument(page, "当前信笺");
  const deniedBefore = await page.evaluate((filePath) => window.paperWriter.openDocumentPath(filePath), unauthorizedSibling);
  assert.equal(deniedBefore.canceled, true);

  stage("checking a real second-instance open from another folder and preserving unsaved edits");
  await openInRunningInstance(externalDocument);
  await waitForActiveDocument(page, "大A本轮牛市复盘");
  const tabCount = await page.locator(".group-tab:not(.add)").count();
  await page.locator(".canvas.active-pane .ProseMirror").fill("大A本轮牛市复盘 未保存的修改");
  await page.locator(".group-tab.active .group-tab-dot").waitFor();
  await openInRunningInstance(currentDocument);
  await waitForActiveDocument(page, "当前信笺");
  await openInRunningInstance(externalDocument);
  await waitForActiveDocument(page, "大A本轮牛市复盘");
  await page.waitForFunction(() => document.querySelector(".canvas.active-pane .ProseMirror")?.textContent.includes("未保存的修改"));
  assert.equal(await page.locator(".group-tab:not(.add)").count(), tabCount);
  const savedSession = await page.evaluate(() => JSON.parse(localStorage.getItem("paperwriter.sessionState")));
  assert.equal(savedSession.folderPath, currentFolder);
  const deniedAfter = await page.evaluate((filePath) => window.paperWriter.openDocumentPath(filePath), unauthorizedSibling);
  assert.equal(deniedAfter.canceled, true);
  const grants = JSON.parse(await readFile(path.join(temporaryUserData, "filesystem-access.json"), "utf8"));
  assert.ok(grants.documents.includes(externalDocument));
  assert.ok(!grants.roots.includes(externalFolder));

  stage("checking half-screen minimum size and sidebar toggle");
  const geometry = await electronApp.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const area = screen.getDisplayMatching(window.getBounds()).workAreaSize;
    window.setSize(100, 100);
    return { minimum: window.getMinimumSize(), expected: [Math.ceil(area.width / 2), Math.ceil(area.height / 2)] };
  });
  assert.deepEqual(geometry.minimum, geometry.expected);
  await page.waitForFunction(() => document.querySelector(".nav-sidebar-toggle"));
  const actualSize = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  assert.ok(actualSize[0] >= geometry.minimum[0] && actualSize[1] >= geometry.minimum[1]);
  const sidebarToggle = page.locator('.nav-sidebar-toggle[aria-controls="left-sidebar"]');
  if (await sidebarToggle.getAttribute("aria-expanded") === "true") await sidebarToggle.click();
  await page.locator("#left-sidebar").waitFor({ state: "detached" });
  await sidebarToggle.click();
  await page.locator("#left-sidebar").waitFor({ state: "visible" });
  await sidebarToggle.click();
  await page.locator("#left-sidebar").waitFor({ state: "detached" });
  stage("preload IPC and window sizing verified; requesting native window close");

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

  stage("checking cold-start legacy file open after restoring a previous session");
  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [electronRoot, legacyDocument],
    cwd: electronRoot,
    env: smokeEnv,
    timeout: 60_000,
  });
  electronProcess = electronApp.process();
  const restoredPage = await electronApp.firstWindow({ timeout: 60_000 });
  await waitForActiveDocument(restoredPage, "旧版 信笺");
  assert.ok(await restoredPage.locator(".group-tab:not(.add)").count() > 1);
  await restoredPage.waitForFunction((expected) => {
    const saved = JSON.parse(localStorage.getItem("paperwriter.sessionState") || "{}");
    return saved.activePath === expected && saved.tabs?.some((tab) => tab.path === expected);
  }, legacyDocument);
  await restoredPage.reload();
  await waitForActiveDocument(restoredPage, "旧版 信笺");
  await electronApp.evaluate(({ app }) => app.exit(0)).catch((error) => {
    if (!/closed|destroyed/i.test(String(error?.message || error))) throw error;
  });
  electronApp = null;
  electronProcess = null;
  process.stdout.write("Electron smoke passed: external file opens, session recovery, unsaved edits, scoped file access, preload IPC, and close handshake.\n");
} catch (error) {
  process.stderr.write(`[electron-smoke] failed: ${error.stack || error}\n`);
  const diagnosticPage = electronApp?.windows?.().find((candidate) => !candidate.isClosed());
  if (diagnosticPage) {
    const state = await diagnosticPage.evaluate(() => ({
      tabs: Array.from(document.querySelectorAll(".group-tab")).map((tab) => ({ text: tab.textContent, className: tab.className })),
      editor: document.querySelector(".canvas.active-pane .ProseMirror")?.textContent,
      status: Array.from(document.querySelectorAll(".status-toast, .status-bar")).map((node) => node.textContent),
      session: localStorage.getItem("paperwriter.sessionState"),
    })).catch(() => null);
    process.stderr.write(`[electron-smoke] state: ${JSON.stringify(state)}\n`);
  }
  process.stderr.write(await readFile(path.join(temporaryUserData, "Logs", "ai-debug.log"), "utf8").catch(() => ""));
  throw error;
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
