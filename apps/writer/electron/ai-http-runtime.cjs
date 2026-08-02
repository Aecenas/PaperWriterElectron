const DEFAULT_AI_HTTP_LIMITS = Object.freeze({
  errorBodyMaxBytes: 64 * 1024,
  jsonResponseMaxBytes: 8 * 1024 * 1024,
  streamBufferMaxChars: 1024 * 1024,
  streamOutputMaxChars: 8 * 1024 * 1024,
  fetchHeaderTimeoutMs: 30 * 1000,
  streamIdleTimeoutMs: 60 * 1000,
  streamMaxMs: 10 * 60 * 1000,
  streamInputMaxBytes: 64 * 1024 * 1024,
});

function createAiHttpRuntime({
  fetchImpl,
  fetchWithAiRedirectPolicy,
  fetchAiResponse,
  readReaderChunk,
  readResponseTextLimited,
  cancelReader,
  throwIfAborted,
  redactSecrets,
  normalizeProviderBaseUrl,
  buildAiRequest,
  extractAiStreamEvent,
  mergeAiUsage,
  emitRendererEvent,
  writeDebugLog,
  limits = {},
  TextDecoderApi = TextDecoder,
  now = Date.now,
}) {
  const policy = {
    ...DEFAULT_AI_HTTP_LIMITS,
    ...limits,
  };

  function aiFetch(url, options = {}) {
    return fetchAiResponse({
      fetchImpl,
      fetchWithRedirectPolicy: fetchWithAiRedirectPolicy,
      url,
      options,
      headerTimeoutMs: policy.fetchHeaderTimeoutMs,
    });
  }

  function readStreamChunk(reader, signal) {
    return readReaderChunk(reader, {
      signal,
      idleTimeoutMs: policy.streamIdleTimeoutMs,
      timeoutMessage: "AI 流式响应超时",
    });
  }

  function redactProviderText(value, config) {
    return redactSecrets(value, [config?.apiKey]);
  }

  function providerResponseError(error, config) {
    const safeError = new Error(
      redactProviderText(
        error?.message || error || "AI 响应解析失败",
        config,
      ),
    );
    if (typeof error?.code === "string") {
      safeError.code = error.code;
    }
    return safeError;
  }

  function parseProviderJson(value, config) {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw providerResponseError(error, config);
    }
  }

  async function readErrorBody(response, signal) {
    try {
      const text = await readResponseTextLimited(
        response,
        policy.errorBodyMaxBytes,
        {
          signal,
          idleTimeoutMs: policy.streamIdleTimeoutMs,
          timeoutMessage: "AI 错误响应超时",
        },
      );
      return text.replace(/\s+/g, " ").slice(0, 500);
    } catch {
      return "";
    }
  }

  async function assertResponseOk(response, secrets = [], signal) {
    throwIfAborted(signal);
    if (response.ok) {
      return;
    }
    const details = redactSecrets(
      await readErrorBody(response, signal),
      secrets,
    );
    throw new Error(
      `AI 请求失败 ${response.status}${details ? `：${details}` : ""}`,
    );
  }

  async function testConfig(config) {
    if (!config.apiKey) {
      throw new Error("请先填写 API Key");
    }
    if (!config.model) {
      throw new Error("请先添加模型");
    }
    const securedConfig = {
      ...config,
      baseUrl: normalizeProviderBaseUrl(config.baseUrl),
    };
    const request = buildAiRequest(
      securedConfig,
      [{ role: "user", content: "请只回复 OK" }],
      { test: true },
    );
    const fetched = await aiFetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    try {
      await assertResponseOk(
        fetched.response,
        [config.apiKey],
        fetched.signal,
      );
      await fetched.response.body?.cancel().catch(() => {});
      return { ok: true, message: "AI 连接可用" };
    } finally {
      fetched.release();
    }
  }

  async function resolveApply(config, messages) {
    if (!config?.testedOk) {
      throw new Error("应用裁决模型尚未通过可用性测试");
    }
    if (!config.apiKey) {
      throw new Error("应用裁决模型缺少 API Key");
    }
    const request = buildAiRequest(config, messages, { stream: false });
    const fetched = await aiFetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
    try {
      await assertResponseOk(
        fetched.response,
        [config.apiKey],
        fetched.signal,
      );
      const raw = await readResponseTextLimited(
        fetched.response,
        512 * 1024,
        {
          signal: fetched.signal,
          idleTimeoutMs: policy.streamIdleTimeoutMs,
        },
      );
      const payload = parseProviderJson(raw, config);
      const output = config.protocol === "anthropic"
        ? (payload?.content || [])
          .filter((item) => item?.type === "text")
          .map((item) => item.text || "")
          .join("")
        : String(payload?.choices?.[0]?.message?.content || "");
      if (!output.trim()) {
        throw new Error("应用裁决模型没有返回结果");
      }
      return output.trim();
    } finally {
      fetched.release();
    }
  }

  async function streamCompletion(
    sender,
    requestId,
    config,
    messages,
    signal,
  ) {
    if (!config.apiKey) {
      throw new Error("请先在 AI 设置里填写 API Key");
    }
    const securedConfig = {
      ...config,
      baseUrl: normalizeProviderBaseUrl(config.baseUrl),
    };
    const request = buildAiRequest(
      securedConfig,
      messages,
      { stream: true },
    );
    const fetched = await aiFetch(request.url, {
      method: "POST",
      headers: request.headers,
      signal,
      body: JSON.stringify(request.body),
    });
    try {
      const response = fetched.response;
      const responseSignal = fetched.signal;
      await assertResponseOk(response, [config.apiKey], responseSignal);
      const contentType = response.headers.get("content-type") || "";
      if (
        !response.body
        || !contentType.toLowerCase().includes("text/event-stream")
      ) {
        const rawPayload = await readResponseTextLimited(
          response,
          policy.jsonResponseMaxBytes,
          {
            signal: responseSignal,
            idleTimeoutMs: policy.streamIdleTimeoutMs,
          },
        );
        throwIfAborted(responseSignal);
        const payload = parseProviderJson(rawPayload, config);
        const delta = config.protocol === "anthropic"
          ? (payload?.content || [])
            .filter((item) => item?.type === "text")
            .map((item) => item.text || "")
            .join("")
          : extractAiStreamEvent(config.protocol, payload).delta;
        throwIfAborted(responseSignal);
        if (delta) {
          emitRendererEvent(sender, "ai:chunk", { requestId, delta });
        }
        return mergeAiUsage(config.protocol, payload, null);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoderApi();
      let buffer = "";
      let usage = null;
      let outputCharacters = 0;
      let parseErrors = 0;
      let inputBytes = 0;
      const streamStartedAt = now();
      try {
        while (true) {
          throwIfAborted(responseSignal);
          if (now() - streamStartedAt > policy.streamMaxMs) {
            throw new Error("AI 流式生成超时");
          }
          const { done, value } = await readStreamChunk(
            reader,
            responseSignal,
          );
          throwIfAborted(responseSignal);
          if (done) {
            break;
          }
          inputBytes += value.byteLength;
          if (inputBytes > policy.streamInputMaxBytes) {
            throw new Error("AI 流式响应数据过大");
          }
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > policy.streamBufferMaxChars) {
            throw new Error("AI 流式响应单行过大");
          }
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const line of lines) {
            throwIfAborted(responseSignal);
            const trimmed = line.trim();
            if (
              !trimmed
              || trimmed.startsWith(":")
              || !trimmed.startsWith("data:")
            ) {
              continue;
            }
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              throwIfAborted(responseSignal);
              return usage;
            }
            let payload;
            try {
              payload = JSON.parse(data);
            } catch (error) {
              parseErrors += 1;
              if (parseErrors <= 3) {
                void writeDebugLog("ai:stream:parse-error", {
                  message: redactProviderText(
                    error?.message,
                    config,
                  ),
                  dataCharacters: data.length,
                });
              }
              continue;
            }
            usage = mergeAiUsage(config.protocol, payload, usage);
            const streamEvent = extractAiStreamEvent(
              config.protocol,
              payload,
            );
            if (streamEvent.error) {
              throw new Error(
                redactProviderText(streamEvent.error, config),
              );
            }
            if (streamEvent.delta) {
              outputCharacters += streamEvent.delta.length;
              if (outputCharacters > policy.streamOutputMaxChars) {
                throw new Error("AI 生成内容超过安全上限");
              }
              throwIfAborted(responseSignal);
              emitRendererEvent(sender, "ai:chunk", {
                requestId,
                delta: streamEvent.delta,
              });
            }
            if (streamEvent.done) {
              throwIfAborted(responseSignal);
              return usage;
            }
          }
        }
        throwIfAborted(responseSignal);
        return usage;
      } finally {
        cancelReader(reader, responseSignal.reason);
      }
    } finally {
      fetched.release();
    }
  }

  return Object.freeze({
    resolveApply,
    streamCompletion,
    testConfig,
  });
}

module.exports = {
  createAiHttpRuntime,
};
