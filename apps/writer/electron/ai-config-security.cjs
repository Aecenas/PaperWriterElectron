const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");

const MAX_STORED_AI_PROVIDERS = 128;
const MAX_ENCRYPTED_SECRET_CHARS = 128 * 1024;
const MAX_API_KEY_CHARS = 16 * 1024;
const AI_TEST_FINGERPRINT_KEY = randomBytes(32);

function apiKeyFingerprint(value) {
  const apiKey = typeof value === "string" ? value.slice(0, MAX_API_KEY_CHARS) : "";
  return createHmac("sha256", AI_TEST_FINGERPRINT_KEY).update(apiKey, "utf8").digest();
}

function createAiTestConfigIdentity(config = {}) {
  const source = config && typeof config === "object" ? config : {};
  return {
    provider: typeof source.provider === "string" ? source.provider.slice(0, 128) : "",
    protocol: typeof source.protocol === "string" ? source.protocol.slice(0, 32) : "",
    modelId: typeof source.modelId === "string" ? source.modelId.slice(0, 256) : "",
    modelPresent: Boolean(source.modelPresent),
    modelName: typeof source.modelName === "string" ? source.modelName.slice(0, 256) : "",
    model: typeof source.model === "string" ? source.model.slice(0, 256) : "",
    baseUrl: typeof source.baseUrl === "string" ? source.baseUrl.slice(0, 2048) : "",
    apiKeyFingerprint: apiKeyFingerprint(source.apiKey),
  };
}

function aiTestConfigIdentityMatches(expected, current) {
  if (!expected || !current) return false;
  for (const key of ["provider", "protocol", "modelId", "modelPresent", "modelName", "model", "baseUrl"]) {
    if (expected[key] !== current[key]) return false;
  }
  const expectedFingerprint = expected.apiKeyFingerprint;
  const currentFingerprint = current.apiKeyFingerprint;
  return Buffer.isBuffer(expectedFingerprint)
    && Buffer.isBuffer(currentFingerprint)
    && expectedFingerprint.length === currentFingerprint.length
    && timingSafeEqual(expectedFingerprint, currentFingerprint);
}

async function commitAiTestResultIfCurrent({ expectedIdentity, readCurrent, identityFromCurrent, commit }) {
  if (typeof readCurrent !== "function" || typeof identityFromCurrent !== "function" || typeof commit !== "function") {
    throw new TypeError("AI 测试结果提交器缺少必要回调");
  }
  const current = await readCurrent();
  if (!aiTestConfigIdentityMatches(expectedIdentity, identityFromCurrent(current))) {
    return { stale: true, config: current };
  }
  return { stale: false, config: await commit(current) };
}

function safeStorageAvailable(safeStorage) {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

function decryptProviderSecrets(rawConfig, safeStorage) {
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const providers = source.providers && typeof source.providers === "object" ? source.providers : {};
  const restoredProviders = Object.create(null);
  let restoredCount = 0;
  for (const providerId in providers) {
    if (!Object.prototype.hasOwnProperty.call(providers, providerId)) continue;
    const provider = providers[providerId];
    const nextProvider = provider && typeof provider === "object" ? { ...provider } : {};
    const encrypted = typeof nextProvider.encryptedApiKey === "string" ? nextProvider.encryptedApiKey : "";
    if (encrypted) {
      nextProvider.apiKey = "";
      if (encrypted.length <= MAX_ENCRYPTED_SECRET_CHARS && safeStorageAvailable(safeStorage)) {
        try {
          nextProvider.apiKey = safeStorage.decryptString(Buffer.from(encrypted, "base64"));
        } catch {
          // A secret encrypted for another OS account must not become plaintext or block the app.
        }
      }
    }
    delete nextProvider.encryptedApiKey;
    restoredProviders[providerId] = nextProvider;
    restoredCount += 1;
    if (restoredCount >= MAX_STORED_AI_PROVIDERS) break;
  }
  return { ...source, providers: restoredProviders };
}

function encryptProviderSecrets(config, safeStorage) {
  const source = config && typeof config === "object" ? config : {};
  const providers = source.providers && typeof source.providers === "object" ? source.providers : {};
  const storedProviders = Object.create(null);
  let storedCount = 0;
  for (const providerId in providers) {
    if (!Object.prototype.hasOwnProperty.call(providers, providerId)) continue;
    const provider = providers[providerId];
    const nextProvider = provider && typeof provider === "object" ? { ...provider } : {};
    const apiKey = typeof nextProvider.apiKey === "string" ? nextProvider.apiKey.slice(0, MAX_API_KEY_CHARS) : "";
    delete nextProvider.apiKey;
    delete nextProvider.encryptedApiKey;
    if (apiKey) {
      if (!safeStorageAvailable(safeStorage)) {
        throw new Error("系统凭据加密服务不可用，暂时无法保存 API Key");
      }
      nextProvider.encryptedApiKey = safeStorage.encryptString(apiKey).toString("base64");
    }
    storedProviders[providerId] = nextProvider;
    storedCount += 1;
    if (storedCount >= MAX_STORED_AI_PROVIDERS) break;
  }
  return { ...source, providers: storedProviders };
}

function containsPlaintextSecrets(rawConfig) {
  const providers = rawConfig?.providers && typeof rawConfig.providers === "object" ? rawConfig.providers : {};
  for (const providerId in providers) {
    if (!Object.prototype.hasOwnProperty.call(providers, providerId)) continue;
    if (typeof providers[providerId]?.apiKey === "string" && providers[providerId].apiKey.length > 0) return true;
  }
  return false;
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost"
    || hostname === "::1"
    || hostname === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function normalizeAiRequestUrl(value) {
  const raw = String(value || "");
  if (raw.length > 4096) throw new Error("AI 请求地址过长");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("AI 请求地址无效");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("AI 请求仅支持 HTTP 或 HTTPS");
  if (parsed.username || parsed.password) throw new Error("AI 请求地址不能包含用户名或密码");
  if (parsed.hash) throw new Error("AI 请求地址不能包含片段");
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("远程 AI 服务必须使用 HTTPS；HTTP 仅允许本机地址");
  }
  return parsed.toString();
}

function normalizeProviderBaseUrl(value) {
  const input = String(value || "");
  if (input.length > 2048) throw new Error("Base URL 过长");
  const raw = input.trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("请输入有效的 Base URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Base URL 仅支持 HTTP 或 HTTPS");
  }
  if (parsed.username || parsed.password) throw new Error("Base URL 不能包含用户名或密码");
  if (parsed.search || parsed.hash) throw new Error("Base URL 不能包含查询参数或片段");
  if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error("远程 AI 服务必须使用 HTTPS；HTTP 仅允许本机地址");
  }
  if (/\/(chat\/completions|messages)$/i.test(parsed.pathname.replace(/\/+$/, ""))) {
    throw new Error("Base URL 不需要包含具体请求端点");
  }
  return parsed.toString().replace(/\/$/, "");
}

function redactSecrets(value, secrets = []) {
  let result = String(value || "");
  for (const candidate of Array.isArray(secrets) ? secrets : [secrets]) {
    const secret = String(candidate || "");
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

async function fetchWithAiRedirectPolicy(fetchImpl, url, options = {}, {
  maxRedirects = 3,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("AI 网络请求服务不可用");
  const initialUrl = normalizeAiRequestUrl(url);
  const expectedOrigin = new URL(initialUrl).origin;
  let currentUrl = initialUrl;
  let redirects = 0;
  while (true) {
    const response = await fetchImpl(currentUrl, { ...options, redirect: "manual" });
    if (response?.url) {
      const responseUrl = normalizeAiRequestUrl(response.url);
      if (new URL(responseUrl).origin !== expectedOrigin) {
        await response.body?.cancel?.().catch?.(() => {});
        throw new Error("AI 服务响应来自未授权的来源");
      }
    }
    if (![301, 302, 303, 307, 308].includes(Number(response?.status))) return response;

    const location = response.headers?.get?.("location") || "";
    await response.body?.cancel?.().catch?.(() => {});
    if (!location) throw new Error("AI 服务返回了无效重定向");
    if (![307, 308].includes(Number(response.status))) {
      throw new Error("AI 服务返回了不安全的方法变更重定向");
    }
    if (redirects >= maxRedirects) throw new Error("AI 服务重定向次数过多");
    const nextUrl = normalizeAiRequestUrl(new URL(location, currentUrl).toString());
    if (new URL(nextUrl).origin !== expectedOrigin) {
      throw new Error("拒绝把 AI 请求和凭据重定向到其他来源");
    }
    currentUrl = nextUrl;
    redirects += 1;
  }
}

function providerOrigin(value) {
  return new URL(normalizeProviderBaseUrl(value)).origin;
}

function apiKeyCanBeReused(previousBaseUrl, nextBaseUrl) {
  try {
    return providerOrigin(previousBaseUrl) === providerOrigin(nextBaseUrl);
  } catch {
    return false;
  }
}

module.exports = {
  apiKeyCanBeReused,
  aiTestConfigIdentityMatches,
  commitAiTestResultIfCurrent,
  containsPlaintextSecrets,
  createAiTestConfigIdentity,
  decryptProviderSecrets,
  encryptProviderSecrets,
  fetchWithAiRedirectPolicy,
  isLoopbackHostname,
  normalizeAiRequestUrl,
  normalizeProviderBaseUrl,
  redactSecrets,
  safeStorageAvailable,
};
