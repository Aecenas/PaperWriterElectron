import {
  assertMermaidSourceWithinLimits,
  MERMAID_SAFETY_LIMITS,
} from "./mermaid-safety.js";

function createDefaultWorker() {
  return new Worker(
    new URL("./mermaid-preflight.worker.js", import.meta.url),
    { type: "module", name: "paper-mermaid-preflight" },
  );
}

function requestError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class MermaidPreflightClient {
  constructor({
    createWorker = createDefaultWorker,
    maxQueue = MERMAID_SAFETY_LIMITS.maxQueue,
    timeoutMs = MERMAID_SAFETY_LIMITS.preflightTimeoutMs,
  } = {}) {
    this.createWorker = createWorker;
    this.maxQueue = maxQueue;
    this.timeoutMs = timeoutMs;
    this.worker = null;
    this.workerEpoch = 0;
    this.active = null;
    this.queue = [];
    this.requestSequence = 0;
  }

  preflight(source, { generation = 0 } = {}) {
    const safeSource = assertMermaidSourceWithinLimits(source);
    if (this.queue.length + (this.active ? 1 : 0) >= this.maxQueue) {
      return Promise.reject(requestError(
        "流程图解析队列已满，请稍后重试",
        "MERMAID_PREFLIGHT_QUEUE_FULL",
      ));
    }
    const requestId = `mermaid-preflight-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      this.queue.push({
        requestId,
        generation,
        source: safeSource,
        resolve,
        reject,
        timeoutId: null,
      });
      this.drain();
    });
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    const epoch = ++this.workerEpoch;
    worker.addEventListener("message", (event) => {
      if (epoch === this.workerEpoch) this.handleMessage(event.data);
    });
    worker.addEventListener("error", () => {
      if (epoch === this.workerEpoch) {
        this.failActive(
          requestError("流程图解析 Worker 异常", "MERMAID_PREFLIGHT_WORKER_ERROR"),
          true,
        );
      }
    });
    this.worker = worker;
    return worker;
  }

  drain() {
    if (this.active || this.queue.length === 0) return;
    const job = this.queue.shift();
    this.active = job;
    let worker;
    try {
      worker = this.ensureWorker();
    } catch {
      this.failActive(
        requestError("当前环境无法启动流程图解析 Worker", "MERMAID_PREFLIGHT_UNAVAILABLE"),
        true,
      );
      return;
    }
    job.timeoutId = globalThis.setTimeout(() => {
      if (this.active !== job) return;
      this.failActive(
        requestError("流程图解析超时", "MERMAID_PREFLIGHT_TIMEOUT"),
        true,
      );
    }, this.timeoutMs);
    worker.postMessage({
      type: "parse",
      requestId: job.requestId,
      generation: job.generation,
      source: job.source,
    });
  }

  handleMessage(message) {
    const job = this.active;
    if (
      !job
      || message?.type !== "result"
      || message.requestId !== job.requestId
      || message.generation !== job.generation
    ) return;
    globalThis.clearTimeout(job.timeoutId);
    this.active = null;
    if (message.ok) {
      job.resolve({
        requestId: job.requestId,
        generation: job.generation,
        diagramType: String(message.diagramType || ""),
      });
    } else {
      job.reject(requestError(
        String(message.message || "Mermaid 语法有误"),
        String(message.code || "MERMAID_PARSE_ERROR"),
      ));
    }
    this.drain();
  }

  failActive(error, resetWorker) {
    const job = this.active;
    if (!job) return;
    globalThis.clearTimeout(job.timeoutId);
    this.active = null;
    if (resetWorker) this.resetWorker();
    job.reject(error);
    this.drain();
  }

  resetWorker() {
    this.workerEpoch += 1;
    this.worker?.terminate();
    this.worker = null;
  }

  dispose() {
    const error = requestError("流程图解析已取消", "MERMAID_PREFLIGHT_DISPOSED");
    if (this.active) {
      globalThis.clearTimeout(this.active.timeoutId);
      this.active.reject(error);
      this.active = null;
    }
    for (const job of this.queue.splice(0)) job.reject(error);
    this.resetWorker();
  }
}

let defaultClient;

export function preflightMermaidSource(source, options) {
  if (!defaultClient) defaultClient = new MermaidPreflightClient();
  return defaultClient.preflight(source, options);
}
