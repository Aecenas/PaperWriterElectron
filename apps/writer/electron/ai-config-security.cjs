const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
const { lookup: dnsLookup } = require("node:dns/promises");
const { BlockList, isIP } = require("node:net");

const MAX_STORED_AI_PROVIDERS = 128;
const MAX_ENCRYPTED_SECRET_CHARS = 128 * 1024;
const MAX_API_KEY_CHARS = 16 * 1024;
const AI_TEST_FINGERPRINT_KEY = randomBytes(32);
const NON_PUBLIC_IPV4 = new BlockList();
const NON_PUBLIC_IPV6 = new BlockList();

for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
]) NON_PUBLIC_IPV4.addSubnet(address, prefix, "ipv4");

for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96],
  ["64:ff9b::", 96], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8],
]) NON_PUBLIC_IPV6.addSubnet(address, prefix, "ipv6");

function apiKeyFingerprint(value) {
  const apiKey = typeof value === "string" ? value.slice(0, MAX_API_KEY_CHARS) : "";
  return createHmac("sha256", AI_TEST_FINGERPRINT_KEY).update(apiKey, "utf8").digest();
}

function createAiTestConfigIdentity(config = {}) {
  const source = config && typeof config === "object" ? config : {};
  let requestParamsJson = "{}";
  try {
    requestParamsJson = JSON.stringify(source.requestParams && typeof source.requestParams === "object" ? source.requestParams : {});
  } catch {
    requestParamsJson = "{}";
  }
  return {
    provider: typeof source.provider === "string" ? source.provider.slice(0, 128) : "",
    protocol: typeof source.protocol === "string" ? source.protocol.slice(0, 32) : "",
    modelId: typeof source.modelId === "string" ? source.modelId.slice(0, 256) : "",
    modelPresent: Boolean(source.modelPresent),
    modelName: typeof source.modelName === "string" ? source.modelName.slice(0, 256) : "",
    model: typeof source.model === "string" ? source.model.slice(0, 256) : "",
    requestParamsJson: requestParamsJson.slice(0, 32 * 1024),
    baseUrl: typeof source.baseUrl === "string" ? source.baseUrl.slice(0, 2048) : "",
    apiKeyFingerprint: apiKeyFingerprint(source.apiKey),
  };
}

function aiTestConfigIdentityMatches(expected, current) {
  if (!expected || !current) return false;
  for (const key of ["provider", "protocol", "modelId", "modelPresent", "modelName", "model", "requestParamsJson", "baseUrl"]) {
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

function canonicalHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isLoopbackHostname(hostname) {
  const normalized = canonicalHostname(hostname);
  return normalized === "localhost"
    || normalized === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function isNonPublicIpAddress(address) {
  const normalized = canonicalHostname(address).replace(/%.+$/, "");
  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized)?.[1];
  if (mappedIpv4) return NON_PUBLIC_IPV4.check(mappedIpv4, "ipv4");
  const family = isIP(normalized);
  if (family === 4) return NON_PUBLIC_IPV4.check(normalized, "ipv4");
  if (family === 6) return NON_PUBLIC_IPV6.check(normalized, "ipv6");
  return true;
}

function assertAiHostnameLiteralAllowed(hostname) {
  const normalized = canonicalHostname(hostname);
  if (isLoopbackHostname(normalized)) return;
  if (isIP(normalized) && isNonPublicIpAddress(normalized)) {
    const error = new Error("AI 服务不能使用私网、本机链路或保留地址");
    error.code = "AI_PRIVATE_NETWORK_BLOCKED";
    throw error;
  }
}

async function defaultResolveHostname(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function resolvedAddresses(value) {
  const records = Array.isArray(value)
    ? value
    : (Array.isArray(value?.endpoints) ? value.endpoints : [value]);
  return records
    .map((record) => (typeof record === "string" ? record : record?.address))
    .filter((address) => typeof address === "string" && address);
}

async function assertAiRequestTargetAllowed(value, {
  resolveHostname = defaultResolveHostname,
} = {}) {
  const normalizedUrl = normalizeAiRequestUrl(value);
  const parsed = new URL(normalizedUrl);
  const hostname = canonicalHostname(parsed.hostname);
  if (isLoopbackHostname(hostname)) return normalizedUrl;
  if (isIP(hostname)) {
    assertAiHostnameLiteralAllowed(hostname);
    return normalizedUrl;
  }
  let addresses;
  try {
    addresses = resolvedAddresses(await resolveHostname(hostname));
  } catch (error) {
    throw new Error("无法安全解析 AI 服务地址", { cause: error });
  }
  if (!addresses.length) throw new Error("AI 服务地址没有可验证的 DNS 结果");
  if (addresses.some((address) => isNonPublicIpAddress(address))) {
    const error = new Error("AI 服务域名解析到了私网、本机链路或保留地址");
    error.code = "AI_PRIVATE_NETWORK_BLOCKED";
    throw error;
  }
  return normalizedUrl;
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
  assertAiHostnameLiteralAllowed(parsed.hostname);
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
  assertAiHostnameLiteralAllowed(parsed.hostname);
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
  resolveHostname = defaultResolveHostname,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("AI 网络请求服务不可用");
  const initialUrl = normalizeAiRequestUrl(url);
  const expectedOrigin = new URL(initialUrl).origin;
  let currentUrl = initialUrl;
  let redirects = 0;
  while (true) {
    // This blocks known-private answers before every request and redirect. The
    // fetch transport still performs its own connection-time lookup, so this
    // is best-effort rebinding resistance rather than DNS pinning.
    await assertAiRequestTargetAllowed(currentUrl, { resolveHostname });
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
  assertAiRequestTargetAllowed,
  aiTestConfigIdentityMatches,
  commitAiTestResultIfCurrent,
  containsPlaintextSecrets,
  createAiTestConfigIdentity,
  decryptProviderSecrets,
  encryptProviderSecrets,
  fetchWithAiRedirectPolicy,
  isLoopbackHostname,
  isNonPublicIpAddress,
  normalizeAiRequestUrl,
  normalizeProviderBaseUrl,
  redactSecrets,
  safeStorageAvailable,
};
