import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const executablePath = path.resolve(process.argv[2] || "");
const userDataPath = path.resolve(process.argv[3] || "");
assert.ok(process.argv[2], "usage: node scripts/packaged-spell-smoke.mjs <exe> <user-data-dir>");
assert.ok(process.argv[3], "a disposable user-data directory is required");

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitForCdp(port) {
  const endpoint = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return endpoint;
    } catch {
      // The packaged main process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the packaged Chromium debugging endpoint did not start");
}

async function listeningPortsForProcess(processId) {
  const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const ports = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (match && Number(match[2]) === processId) ports.add(Number(match[1]));
  }
  return [...ports];
}

async function findBundledDictionary(processId, debugPort) {
  const expectedDigest = "a075b01d9b015c616511a9e87da77da3d9881621db32f584e4606ddabf1c1100";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    for (const port of await listeningPortsForProcess(processId)) {
      if (port === debugPort) continue;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/en-us.bdic`);
        if (!response.ok) continue;
        const bytes = Buffer.from(await response.arrayBuffer());
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (bytes.length === 451_968 && digest === expectedDigest) {
          return { bytes: bytes.length, digest, port };
        }
      } catch {
        // Probe only loopback listeners owned by the exact packaged process.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the packaged process did not expose its verified offline dictionary");
}

const debugPort = await reservePort();
const { spawn } = await import("node:child_process");
const application = spawn(executablePath, [
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataPath}`,
  "--disable-gpu",
], {
  detached: false,
  stdio: "ignore",
  windowsHide: true,
});

let browser;
try {
  const endpoint = await waitForCdp(debugPort);
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent("page");
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.locator(".paper-workspace").waitFor({ state: "visible", timeout: 30_000 });

  const writingConfig = await page.evaluate(() => window.paperWriter.getWritingAssistance());
  assert.equal(writingConfig.enabled, true);
  assert.ok(writingConfig.languages.includes("en-US"));

  await page.getByRole("button", { name: "元素", exact: true }).click();
  await page.getByRole("menuitem", { name: "Mermaid 图", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "插入 Mermaid 图" });
  await dialog.getByLabel("Mermaid 源码").fill("flowchart LR\nA[离线] --> B[完成]");
  await dialog.locator(".mermaid-dialog-svg svg").waitFor({ state: "visible", timeout: 20_000 });
  assert.deepEqual(pageErrors, []);

  const dictionary = await findBundledDictionary(application.pid, debugPort);
  process.stdout.write(`${JSON.stringify({
    dictionaryBytes: dictionary.bytes,
    dictionarySha256: dictionary.digest,
    mermaidWorkerRendered: true,
    writingLanguages: writingConfig.languages,
  })}\n`);
} finally {
  await browser?.close().catch(() => {});
  if (!application.killed) application.kill();
  await Promise.race([
    new Promise((resolve) => application.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}
