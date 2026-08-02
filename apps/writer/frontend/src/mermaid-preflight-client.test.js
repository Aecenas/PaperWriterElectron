import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MermaidPreflightClient } from "./editor/mermaid-preflight-client.js";

class FakeWorker {
  constructor() {
    this.listeners = { error: [], message: [] };
    this.messages = [];
    this.terminated = false;
  }

  addEventListener(type, listener) {
    this.listeners[type].push(listener);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  emitMessage(message) {
    for (const listener of this.listeners.message) listener({ data: message });
  }

  terminate() {
    this.terminated = true;
  }
}

test("Mermaid preflight verifies request and generation identity", async () => {
  const workers = [];
  const client = new MermaidPreflightClient({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    timeoutMs: 1_000,
  });
  const resultPromise = client.preflight("flowchart LR\nA-->B", { generation: 7 });
  const request = workers[0].messages[0];
  workers[0].emitMessage({ type: "result", ...request, generation: 6, ok: true });
  workers[0].emitMessage({
    type: "result",
    requestId: request.requestId,
    generation: 7,
    ok: true,
    diagramType: "flowchart-v2",
  });
  assert.deepEqual(await resultPromise, {
    requestId: request.requestId,
    generation: 7,
    diagramType: "flowchart-v2",
  });
  client.dispose();
});

test("Mermaid preflight timeout terminates and recreates its Worker for queued work", async () => {
  const workers = [];
  const client = new MermaidPreflightClient({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    timeoutMs: 10,
  });
  const timedOut = client.preflight("flowchart LR\nA-->B").then(
    () => null,
    (error) => error,
  );
  const queued = client.preflight("sequenceDiagram\nA->>B: hi", { generation: 2 });
  const timeoutError = await timedOut;
  assert.equal(timeoutError.code, "MERMAID_PREFLIGHT_TIMEOUT");
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 2);
  const request = workers[1].messages[0];
  workers[1].emitMessage({
    type: "result",
    requestId: request.requestId,
    generation: 2,
    ok: true,
    diagramType: "sequence",
  });
  assert.equal((await queued).diagramType, "sequence");
  client.dispose();
});

test("production contract emits an ES module Worker and permits only self workers", async () => {
  const [clientSource, workerSource, viteSource, mainSource] = await Promise.all([
    readFile(new URL("./editor/mermaid-preflight-client.js", import.meta.url), "utf8"),
    readFile(new URL("./editor/mermaid-preflight.worker.js", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.js", import.meta.url), "utf8"),
    readFile(new URL("../../electron/main.cjs", import.meta.url), "utf8"),
  ]);
  assert.match(clientSource, /new Worker\(\s*new URL\("\.\/mermaid-preflight\.worker\.js", import\.meta\.url\)/);
  assert.match(clientSource, /worker\?\.terminate\(\)/);
  assert.match(workerSource, /await mermaid\.parse\(safeSource\)/);
  assert.doesNotMatch(workerSource, /mermaid\.render/);
  assert.match(viteSource, /worker:\s*\{\s*format:\s*"es"/);
  assert.match(mainSource, /"worker-src 'self'"/);
  assert.match(mainSource, /"connect-src 'none'"/);
  assert.match(mainSource, /"frame-src 'none'"/);
});
