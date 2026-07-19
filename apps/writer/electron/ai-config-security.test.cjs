const test = require("node:test");
const assert = require("node:assert/strict");
const {
  apiKeyCanBeReused,
  aiTestConfigIdentityMatches,
  commitAiTestResultIfCurrent,
  containsPlaintextSecrets,
  createAiTestConfigIdentity,
  decryptProviderSecrets,
  encryptProviderSecrets,
  fetchWithAiRedirectPolicy,
  normalizeAiRequestUrl,
  normalizeProviderBaseUrl,
  redactSecrets,
} = require("./ai-config-security.cjs");

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
  decryptString: (buffer) => buffer.toString("utf8").replace(/^protected:/, ""),
};

test("stores API keys encrypted and restores them only in memory", () => {
  const config = { providers: { custom: { apiKey: "sk-secret", baseUrl: "https://api.example.com/v1" } } };
  const stored = encryptProviderSecrets(config, fakeSafeStorage);
  assert.equal(stored.providers.custom.apiKey, undefined);
  assert.doesNotMatch(JSON.stringify(stored), /sk-secret/);
  assert.equal(stored.providers.custom.encryptedApiKey, Buffer.from("protected:sk-secret").toString("base64"));
  assert.equal(decryptProviderSecrets(stored, fakeSafeStorage).providers.custom.apiKey, "sk-secret");
  assert.equal(containsPlaintextSecrets(config), true);
  assert.equal(containsPlaintextSecrets(stored), false);
});

test("refuses plaintext secret persistence without OS encryption", () => {
  assert.throws(
    () => encryptProviderSecrets({ providers: { custom: { apiKey: "secret" } } }, { isEncryptionAvailable: () => false }),
    /加密服务不可用/,
  );
});

test("requires HTTPS except for loopback and rejects credential-bearing URLs", () => {
  assert.equal(normalizeProviderBaseUrl("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.equal(normalizeProviderBaseUrl("http://127.0.0.1:11434/v1"), "http://127.0.0.1:11434/v1");
  assert.equal(normalizeProviderBaseUrl("http://[::1]:11434/v1"), "http://[::1]:11434/v1");
  assert.throws(() => normalizeProviderBaseUrl("http://192.168.1.20/v1"), /必须使用 HTTPS/);
  assert.throws(() => normalizeProviderBaseUrl("https://user:pass@example.com/v1"), /用户名或密码/);
  assert.throws(() => normalizeProviderBaseUrl("https://example.com/v1?target=other"), /查询参数/);
});

test("never reuses a stored key across origins", () => {
  assert.equal(apiKeyCanBeReused("https://api.example.com/v1", "https://api.example.com/v2"), true);
  assert.equal(apiKeyCanBeReused("https://api.example.com/v1", "https://evil.example/v1"), false);
  assert.equal(apiKeyCanBeReused("https://api.example.com/v1", "http://127.0.0.1:11434/v1"), false);
});

test("validates every AI request URL, including redirect targets", () => {
  assert.equal(normalizeAiRequestUrl("https://api.example.com/v1/chat/completions"), "https://api.example.com/v1/chat/completions");
  assert.equal(normalizeAiRequestUrl("http://localhost:11434/v1/chat/completions"), "http://localhost:11434/v1/chat/completions");
  assert.throws(() => normalizeAiRequestUrl("http://192.168.1.20/v1/chat/completions"), /必须使用 HTTPS/);
  assert.throws(() => normalizeAiRequestUrl("file:///etc/passwd"), /仅支持/);
});

test("follows only same-origin method-preserving AI redirects", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return {
        status: 307,
        url,
        headers: new Headers({ location: "/v1/redirected" }),
        body: { cancel: async () => {} },
      };
    }
    return { status: 200, url, headers: new Headers(), body: null };
  };
  const response = await fetchWithAiRedirectPolicy(
    fetchImpl,
    "https://api.example.com/v1/chat/completions",
    { method: "POST", headers: { authorization: "Bearer secret" } },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://api.example.com/v1/chat/completions",
    "https://api.example.com/v1/redirected",
  ]);
  assert.equal(calls.every((call) => call.options.redirect === "manual"), true);
  assert.equal(calls.every((call) => call.options.method === "POST"), true);
});

test("refuses cross-origin and method-changing AI redirects before replaying credentials", async () => {
  let calls = 0;
  let canceled = false;
  const crossOriginFetch = async (url) => {
    calls += 1;
    return {
      status: 307,
      url,
      headers: new Headers({ location: "https://evil.example/collect" }),
      body: { cancel: async () => { canceled = true; } },
    };
  };
  await assert.rejects(
    () => fetchWithAiRedirectPolicy(crossOriginFetch, "https://api.example.com/v1/chat/completions", { method: "POST" }),
    /其他来源/,
  );
  assert.equal(calls, 1);
  assert.equal(canceled, true);

  await assert.rejects(
    () => fetchWithAiRedirectPolicy(async (url) => ({
      status: 302,
      url,
      headers: new Headers({ location: "/login" }),
      body: { cancel: async () => {} },
    }), "https://api.example.com/v1/chat/completions", { method: "POST" }),
    /方法变更/,
  );
});

test("redacts provider secrets from server-controlled diagnostics", () => {
  assert.equal(redactSecrets("request failed for sk-secret", ["sk-secret"]), "request failed for [REDACTED]");
});

test("secret maps cannot trigger prototype setters and are bounded", () => {
  const providers = JSON.parse('{"__proto__":{"apiKey":"secret"},"constructor":{"apiKey":"other"}}');
  for (let index = 0; index < 140; index += 1) providers[`custom-${index}`] = { apiKey: `key-${index}` };
  const stored = encryptProviderSecrets({ providers }, fakeSafeStorage);
  assert.equal(Object.getPrototypeOf(stored.providers), null);
  assert.equal(Object.hasOwn(stored.providers, "__proto__"), true);
  assert.equal(Object.keys(stored.providers).length, 128);
  assert.equal({}.apiKey, undefined);
  const restored = decryptProviderSecrets(stored, fakeSafeStorage);
  assert.equal(Object.getPrototypeOf(restored.providers), null);
  assert.equal(restored.providers.__proto__.apiKey, "secret");
});

test("AI test identities compare API keys by a non-reversible fingerprint", () => {
  const base = {
    provider: "custom-safe",
    protocol: "openai",
    modelId: "model-1",
    modelPresent: true,
    modelName: "Model 1",
    model: "remote-model-1",
    requestParams: { temperature: 0.4, metadata: { purpose: "test" } },
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-super-secret",
  };
  const expected = createAiTestConfigIdentity(base);
  assert.equal(aiTestConfigIdentityMatches(expected, createAiTestConfigIdentity({ ...base })), true);
  assert.equal(aiTestConfigIdentityMatches(expected, createAiTestConfigIdentity({ ...base, apiKey: "sk-changed" })), false);
  assert.doesNotMatch(JSON.stringify(expected), /sk-super-secret/);
  for (const patch of [
    { provider: "other" },
    { protocol: "anthropic" },
    { modelId: "model-2" },
    { modelPresent: false },
    { modelName: "Renamed" },
    { model: "remote-model-2" },
    { requestParams: { temperature: 0.8, metadata: { purpose: "test" } } },
    { baseUrl: "https://other.example/v1" },
  ]) {
    assert.equal(aiTestConfigIdentityMatches(expected, createAiTestConfigIdentity({ ...base, ...patch })), false);
  }
  assert.equal(aiTestConfigIdentityMatches(expected, createAiTestConfigIdentity({ ...base, reasoningEffort: "high" })), true);
});

test("a stale AI connection test never commits old URL, key, or tested state", async () => {
  const beforeTest = {
    provider: "custom-safe",
    protocol: "openai",
    modelId: "model-1",
    modelPresent: true,
    modelName: "Model 1",
    model: "remote-model-1",
    baseUrl: "https://old.example/v1",
    apiKey: "sk-old",
    testedOk: false,
  };
  const expectedIdentity = createAiTestConfigIdentity(beforeTest);
  const current = {
    ...beforeTest,
    baseUrl: "https://new.example/v1",
    apiKey: "sk-new",
    testedOk: false,
  };
  let commitCalls = 0;
  const result = await commitAiTestResultIfCurrent({
    expectedIdentity,
    readCurrent: async () => current,
    identityFromCurrent: createAiTestConfigIdentity,
    commit: async (latest) => {
      commitCalls += 1;
      return { ...latest, baseUrl: beforeTest.baseUrl, apiKey: beforeTest.apiKey, testedOk: true };
    },
  });
  assert.equal(result.stale, true);
  assert.strictEqual(result.config, current);
  assert.equal(commitCalls, 0);
  assert.deepEqual(
    { baseUrl: current.baseUrl, apiKey: current.apiKey, testedOk: current.testedOk },
    { baseUrl: "https://new.example/v1", apiKey: "sk-new", testedOk: false },
  );
});
