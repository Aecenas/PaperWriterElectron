const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const {
  fetchAiResponse,
  readReaderChunk,
  readResponseTextLimited,
  throwIfAborted,
} = require("./ai-http-client.cjs");
const {
  createAiHttpRuntime,
} = require("./ai-http-runtime.cjs");
const {
  redactSecrets,
} = require("./ai-config-security.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return source.slice(start, end);
}

function createHttpRuntimeHarness({
  contentType = "application/json",
  responseText = "",
  streamChunks = [],
} = {}) {
  const controller = new AbortController();
  const encoder = new TextEncoder();
  const chunks = streamChunks.map((chunk) => encoder.encode(chunk));
  const events = [];
  const logs = [];
  let canceled = 0;
  let released = 0;
  const reader = {
    async read() {
      if (chunks.length) {
        return { done: false, value: chunks.shift() };
      }
      return { done: true, value: undefined };
    },
    async cancel() {
      canceled += 1;
    },
  };
  const response = {
    ok: true,
    headers: { get: () => contentType },
    body: { getReader: () => reader },
  };
  const runtime = createAiHttpRuntime({
    fetchImpl: async () => response,
    fetchWithAiRedirectPolicy: async () => response,
    fetchAiResponse: async () => ({
      response,
      signal: controller.signal,
      release() {
        released += 1;
      },
    }),
    readReaderChunk,
    readResponseTextLimited: async () => responseText,
    cancelReader(readerToCancel, reason) {
      try {
        readerToCancel.cancel(reason)?.catch?.(() => {});
      } catch {}
    },
    throwIfAborted,
    redactSecrets,
    normalizeProviderBaseUrl: (value) => value,
    buildAiRequest: () => ({
      url: "https://example.com",
      headers: {},
      body: {},
    }),
    extractAiStreamEvent(protocol, payload) {
      if (protocol === "anthropic") {
        if (payload?.type === "error") {
          return {
            error: payload.error?.message
              || "Anthropic 流式请求失败",
          };
        }
        return {
          delta: payload?.delta?.text || "",
          done: payload?.type === "message_stop",
        };
      }
      return {
        delta: payload?.choices?.[0]?.delta?.content || "",
        done: false,
        error: "",
      };
    },
    mergeAiUsage: (_protocol, _payload, usage) => usage,
    emitRendererEvent: (_sender, channel, payload) => {
      events.push([channel, payload]);
    },
    writeDebugLog: (...args) => {
      logs.push(args);
    },
    limits: {
      jsonResponseMaxBytes: 1024,
      streamBufferMaxChars: 1024,
      streamInputMaxBytes: 4096,
      streamMaxMs: 10000,
      streamOutputMaxChars: 4096,
      streamIdleTimeoutMs: 1000,
    },
  });
  return {
    controller,
    events,
    get canceled() {
      return canceled;
    },
    get released() {
      return released;
    },
    logs,
    runtime,
  };
}

function assertSecretAbsent(value, secret) {
  assert.equal(
    JSON.stringify(value).includes(secret),
    false,
    "secret must not appear in any observable field",
  );
}

test("keeps an external abort linked after response headers arrive", async () => {
  const external = new AbortController();
  let fetchSignal = null;
  const fetched = await fetchAiResponse({
    fetchImpl: async () => null,
    fetchWithRedirectPolicy: async (_fetchImpl, _url, options) => {
      fetchSignal = options.signal;
      return { ok: true, body: null };
    },
    url: "https://example.com/v1/chat/completions",
    options: { signal: external.signal },
    headerTimeoutMs: 1000,
  });

  assert.equal(fetchSignal.aborted, false);
  const reason = new Error("stop after headers");
  external.abort(reason);
  assert.equal(fetchSignal.aborted, true);
  assert.equal(fetchSignal.reason, reason);
  fetched.release();
});

test("release detaches the completed response from later external aborts", async () => {
  const external = new AbortController();
  let fetchSignal = null;
  const fetched = await fetchAiResponse({
    fetchImpl: async () => null,
    fetchWithRedirectPolicy: async (_fetchImpl, _url, options) => {
      fetchSignal = options.signal;
      return { ok: true, body: null };
    },
    url: "https://example.com/v1/messages",
    options: { signal: external.signal },
    headerTimeoutMs: 1000,
  });

  fetched.release();
  external.abort(new Error("too late"));
  assert.equal(fetchSignal.aborted, false);
});

test("aborting a pending stream read rejects immediately and cancels its reader", async () => {
  const pendingRead = deferred();
  const controller = new AbortController();
  const cancellations = [];
  const reader = {
    read: () => pendingRead.promise,
    cancel: (reason) => {
      cancellations.push(reason);
      return Promise.resolve();
    },
  };

  const reading = readReaderChunk(reader, {
    signal: controller.signal,
    idleTimeoutMs: 1000,
  });
  const reason = new Error("user stopped");
  controller.abort(reason);
  await assert.rejects(reading, (error) => error === reason);
  assert.deepEqual(cancellations, [reason]);

  pendingRead.resolve({ done: false, value: Buffer.from("stale") });
  await new Promise((resolve) => setImmediate(resolve));
});

test("aborting a non-SSE response body cancels the pending read instead of returning partial text", async () => {
  const pendingRead = deferred();
  const secondReadStarted = deferred();
  const controller = new AbortController();
  let reads = 0;
  let cancelCount = 0;
  const reader = {
    read() {
      reads += 1;
      if (reads === 1) return Promise.resolve({ done: false, value: Buffer.from('{"partial":') });
      secondReadStarted.resolve();
      return pendingRead.promise;
    },
    cancel() {
      cancelCount += 1;
      return Promise.resolve();
    },
  };
  const response = { body: { getReader: () => reader } };

  const reading = readResponseTextLimited(response, 1024, {
    signal: controller.signal,
    idleTimeoutMs: 1000,
  });
  await secondReadStarted.promise;
  controller.abort(new Error("stop JSON response"));
  await assert.rejects(reading, /stop JSON response/);
  assert.ok(cancelCount >= 1);

  pendingRead.resolve({ done: false, value: Buffer.from('"stale"}') });
  await new Promise((resolve) => setImmediate(resolve));
});

test("stream completion emits no chunks after a pending read is canceled", async () => {
  const pendingRead = deferred();
  const firstChunkSent = deferred();
  const controller = new AbortController();
  const events = [];
  let reads = 0;
  let cancelCount = 0;
  let released = false;
  const encoder = new TextEncoder();
  const reader = {
    read() {
      reads += 1;
      if (reads === 1) {
        return Promise.resolve({
          done: false,
          value: encoder.encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n'),
        });
      }
      return pendingRead.promise;
    },
    cancel() {
      cancelCount += 1;
      return Promise.resolve();
    },
  };
  const response = {
    ok: true,
    headers: { get: () => "text/event-stream" },
    body: { getReader: () => reader },
  };
  const runtime = createAiHttpRuntime({
    fetchImpl: async () => response,
    fetchWithAiRedirectPolicy: async () => response,
    fetchAiResponse: async () => ({
      response,
      signal: controller.signal,
      release: () => {
        released = true;
      },
    }),
    readReaderChunk,
    readResponseTextLimited,
    cancelReader(readerToCancel, reason) {
      try {
        readerToCancel.cancel(reason)?.catch?.(() => {});
      } catch {}
    },
    throwIfAborted,
    redactSecrets: (value) => value,
    normalizeProviderBaseUrl: (value) => value,
    buildAiRequest: () => ({
      url: "https://example.com",
      headers: {},
      body: {},
    }),
    extractAiStreamEvent: (_protocol, payload) => ({
      delta: payload?.choices?.[0]?.delta?.content || "",
      done: false,
      error: "",
    }),
    mergeAiUsage: (_protocol, _payload, usage) => usage,
    emitRendererEvent: (_sender, channel, payload) => {
      events.push([channel, payload]);
      firstChunkSent.resolve();
    },
    writeDebugLog: async () => {},
    limits: {
      jsonResponseMaxBytes: 1024,
      streamBufferMaxChars: 1024,
      streamInputMaxBytes: 4096,
      streamMaxMs: 10000,
      streamOutputMaxChars: 4096,
      streamIdleTimeoutMs: 1000,
    },
  });

  const completion = runtime.streamCompletion({}, "ai-cancel-test", {
    apiKey: "secret",
    baseUrl: "https://example.com",
    protocol: "openai",
  }, [{ role: "user", content: "hello" }], controller.signal);
  await firstChunkSent.promise;
  controller.abort(new Error("stop stream"));
  await assert.rejects(completion, /stop stream/);

  pendingRead.resolve({
    done: false,
    value: encoder.encode('data: {"choices":[{"delta":{"content":"stale"}}]}\n\n'),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(events)), [["ai:chunk", { requestId: "ai-cancel-test", delta: "first" }]]);
  assert.ok(cancelCount >= 1);
  assert.equal(released, true);
});

test("does not log malformed SSE payload text", async () => {
  const apiKey = "sk-live-secret";
  const harness = createHttpRuntimeHarness({
    contentType: "text/event-stream",
    streamChunks: [
      `data: ${apiKey}\n\ndata: [DONE]\n\n`,
    ],
  });

  const result = await harness.runtime.streamCompletion(
    {},
    "ai-redact-parse",
    {
      apiKey,
      baseUrl: "https://example.com",
      protocol: "openai",
    },
    [{ role: "user", content: "hello" }],
    harness.controller.signal,
  );

  assert.equal(result, null);
  assert.equal(harness.logs.length, 1);
  assert.equal(harness.logs[0][0], "ai:stream:parse-error");
  assert.equal(harness.logs[0][1].dataCharacters, apiKey.length);
  assert.equal("data" in harness.logs[0][1], false);
  assertSecretAbsent({
    events: harness.events,
    logs: harness.logs,
    result,
  }, apiKey);
});

test("redacts API keys from malformed non-SSE response errors", async () => {
  const apiKey = "sk-live-secret";
  const harness = createHttpRuntimeHarness({
    responseText: apiKey,
  });
  let caught;

  await assert.rejects(
    harness.runtime.streamCompletion(
      {},
      "ai-redact-json",
      {
        apiKey,
        baseUrl: "https://example.com",
        protocol: "openai",
      },
      [{ role: "user", content: "hello" }],
      harness.controller.signal,
    ),
    (error) => {
      caught = error;
      return true;
    },
  );

  assertSecretAbsent({
    error: caught?.message,
    events: harness.events,
    logs: harness.logs,
  }, apiKey);
  assert.equal(harness.events.length, 0);
  assert.equal(harness.released, 1);
});

test("redacts API keys echoed by Anthropic SSE errors before propagation", async () => {
  const apiKey = "sk-live-secret";
  const harness = createHttpRuntimeHarness({
    contentType: "text/event-stream",
    streamChunks: [
      `data: ${JSON.stringify({
        type: "error",
        error: { message: `provider echoed ${apiKey}` },
      })}\n\n`,
    ],
  });
  let caught;

  await assert.rejects(
    harness.runtime.streamCompletion(
      {},
      "ai-redact-anthropic",
      {
        apiKey,
        baseUrl: "https://example.com",
        protocol: "anthropic",
      },
      [{ role: "user", content: "hello" }],
      harness.controller.signal,
    ),
    (error) => {
      caught = error;
      return true;
    },
  );

  assert.match(caught.message, /\[REDACTED\]/);
  assertSecretAbsent({
    error: caught.message,
    events: harness.events,
    logs: harness.logs,
  }, apiKey);
  assert.equal(harness.events.length, 0);
  assert.ok(harness.canceled >= 1);
  assert.equal(harness.released, 1);
});

test("redacts API keys from resolveApply response parsing errors", async () => {
  const apiKey = "sk-live-secret";
  const harness = createHttpRuntimeHarness({
    responseText: apiKey,
  });
  let caught;

  await assert.rejects(
    harness.runtime.resolveApply({
      apiKey,
      baseUrl: "https://example.com",
      protocol: "openai",
      testedOk: true,
    }, [{ role: "user", content: "resolve" }]),
    (error) => {
      caught = error;
      return true;
    },
  );

  assertSecretAbsent({
    error: caught?.message,
    events: harness.events,
    logs: harness.logs,
  }, apiKey);
  assert.equal(harness.events.length, 0);
  assert.equal(harness.released, 1);
});

test("AI request registry keeps canceled entries until identity-safe settlement", async () => {
  const generationRuntime = await fs.readFile(
    path.join(__dirname, "ai-generation-runtime.cjs"),
    "utf8",
  );
  const generateHandler = between(
    generationRuntime,
    "async function generate",
    "async function resolveApply",
  );
  const cancelHandler = between(
    generationRuntime,
    "async function cancel",
    "async function exportChat",
  );

  assert.match(generateHandler, /activeAiRequests\.get\(requestId\) !== controller/);
  assert.match(generateHandler, /finally\s*\{\s*releaseReservation\(\)/);
  assert.match(cancelHandler, /controller\.abort\(new Error\("已停止生成"\)\)/);
  assert.doesNotMatch(cancelHandler, /activeAiRequests\.delete/);
});
