function abortError(signal, fallbackMessage = "AI 请求已取消") {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error(typeof signal?.reason === "string" && signal.reason ? signal.reason : fallbackMessage);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function cancelReader(reader, reason) {
  try {
    const cancellation = reader?.cancel?.(reason);
    cancellation?.catch?.(() => {});
  } catch {
    // The response is already closed or the reader implementation rejected synchronously.
  }
}

function waitForPromise(promise, {
  signal,
  timeoutMs = 0,
  timeoutMessage = "AI 响应超时",
  onAbort,
} = {}) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", handleAbort);
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const handleAbort = () => {
      const error = abortError(signal);
      settle(reject, error);
      onAbort?.(error);
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        const error = new Error(timeoutMessage);
        settle(reject, error);
        onAbort?.(error);
      }, timeoutMs);
    }
    Promise.resolve(promise).then(
      (value) => {
        if (signal?.aborted) {
          handleAbort();
          return;
        }
        settle(resolve, value);
      },
      (error) => settle(reject, error),
    );
  });
}

function readReaderChunk(reader, {
  signal,
  idleTimeoutMs = 0,
  timeoutMessage = "AI 流式响应超时",
} = {}) {
  try {
    throwIfAborted(signal);
  } catch (error) {
    cancelReader(reader, error);
    return Promise.reject(error);
  }
  let readPromise;
  try {
    readPromise = reader.read();
  } catch (error) {
    return Promise.reject(error);
  }
  return waitForPromise(readPromise, {
    signal,
    timeoutMs: idleTimeoutMs,
    timeoutMessage,
    onAbort: (error) => cancelReader(reader, error),
  });
}

async function readResponseTextLimited(response, maximumBytes, {
  signal,
  idleTimeoutMs = 0,
  timeoutMessage = "AI 响应超时",
} = {}) {
  throwIfAborted(signal);
  if (!response?.body?.getReader) {
    const text = await waitForPromise(Promise.resolve().then(() => response.text()), {
      signal,
      timeoutMs: idleTimeoutMs,
      timeoutMessage,
      onAbort: (error) => {
        try {
          const cancellation = response?.body?.cancel?.(error);
          cancellation?.catch?.(() => {});
        } catch {
          // The response body does not expose a cancellable stream.
        }
      },
    });
    if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new Error("AI 响应数据过大");
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await readReaderChunk(reader, {
        signal,
        idleTimeoutMs,
        timeoutMessage,
      });
      throwIfAborted(signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        const error = new Error("AI 响应数据过大");
        cancelReader(reader, error);
        throw error;
      }
      text += decoder.decode(value, { stream: true });
    }
    throwIfAborted(signal);
    return text + decoder.decode();
  } catch (error) {
    cancelReader(reader, error);
    throw error;
  }
}

async function fetchAiResponse({
  fetchImpl,
  fetchWithRedirectPolicy,
  url,
  options = {},
  headerTimeoutMs,
  headerTimeoutMessage = "AI 服务连接超时",
}) {
  if (typeof fetchWithRedirectPolicy !== "function") throw new Error("AI 网络请求服务不可用");
  const controller = new AbortController();
  const externalSignal = options.signal;
  const handleExternalAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal?.aborted) handleExternalAbort();
  else externalSignal?.addEventListener("abort", handleExternalAbort, { once: true });

  let timedOut = false;
  let released = false;
  let timer = null;
  const release = () => {
    if (released) return;
    released = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    externalSignal?.removeEventListener("abort", handleExternalAbort);
  };
  if (Number.isFinite(headerTimeoutMs) && headerTimeoutMs > 0) {
    timer = setTimeout(() => {
      if (controller.signal.aborted) return;
      timedOut = true;
      controller.abort(new Error(headerTimeoutMessage));
    }, headerTimeoutMs);
  }

  try {
    const response = await fetchWithRedirectPolicy(fetchImpl, url, {
      ...options,
      signal: controller.signal,
    });
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    throwIfAborted(controller.signal);
    return {
      response,
      signal: controller.signal,
      release,
    };
  } catch (error) {
    release();
    if (timedOut) throw new Error(headerTimeoutMessage, { cause: error });
    throw error;
  }
}

module.exports = {
  cancelReader,
  fetchAiResponse,
  readReaderChunk,
  readResponseTextLimited,
  throwIfAborted,
};
