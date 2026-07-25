const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  fetchAiResponse,
  readReaderChunk,
  readResponseTextLimited,
  throwIfAborted,
} = require("./ai-http-client.cjs");

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
  const main = await fs.readFile(path.join(__dirname, "main.cjs"), "utf8");
  const functionSource = between(main, "async function streamAiCompletion", "async function streamCodexForPayload");
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
  const streamAiCompletion = vm.runInNewContext(
    `${functionSource}; streamAiCompletion`,
    {
      AI_JSON_RESPONSE_MAX_BYTES: 1024,
      AI_STREAM_BUFFER_MAX_CHARS: 1024,
      AI_STREAM_INPUT_MAX_BYTES: 4096,
      AI_STREAM_MAX_MS: 10000,
      AI_STREAM_OUTPUT_MAX_CHARS: 4096,
      TextDecoder,
      assertAiResponseOk: async () => {},
      buildAiRequest: () => ({ url: "https://example.com", headers: {}, body: {} }),
      cancelAiResponseReader(readerToCancel, reason) {
        try {
          readerToCancel.cancel(reason)?.catch?.(() => {});
        } catch {}
      },
      extractAiStreamEvent: (_protocol, payload) => ({
        delta: payload?.choices?.[0]?.delta?.content || "",
        done: false,
        error: "",
      }),
      mergeAiUsage: (_protocol, _payload, usage) => usage,
      normalizeProviderBaseUrl: (value) => value,
      readAiStreamChunk: (readerToRead, signal) => readReaderChunk(readerToRead, {
        signal,
        idleTimeoutMs: 1000,
      }),
      readResponseTextLimited,
      sendRendererEvent: (_sender, channel, payload) => {
        events.push([channel, payload]);
        firstChunkSent.resolve();
      },
      throwIfAiAborted: throwIfAborted,
      writeAiDebugLog: async () => {},
      aiFetch: async () => ({
        response,
        signal: controller.signal,
        release: () => {
          released = true;
        },
      }),
    },
    { filename: "stream-ai-completion-extract.cjs" },
  );

  const completion = streamAiCompletion({}, "ai-cancel-test", {
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

test("AI request registry keeps canceled entries until identity-safe settlement", async () => {
  const main = await fs.readFile(path.join(__dirname, "main.cjs"), "utf8");
  const generateHandler = between(main, 'ipcMain.handle("ai:generate"', 'ipcMain.handle("ai:resolve-apply"');
  const cancelHandler = between(main, 'ipcMain.handle("ai:cancel"', 'ipcMain.handle("ai:export-chat"');

  assert.match(generateHandler, /activeAiRequests\.get\(requestId\) !== controller/);
  assert.match(generateHandler, /finally\s*\{[\s\S]*activeAiRequests\.get\(requestId\) === controller[\s\S]*activeAiRequests\.delete\(requestId\)/);
  assert.match(cancelHandler, /controller\.abort\(new Error\("已停止生成"\)\)/);
  assert.doesNotMatch(cancelHandler, /activeAiRequests\.delete/);
});
