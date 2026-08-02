const {
  preflightZipBuffer: defaultPreflightZipBuffer,
} = require("./document-storage.cjs");

const PROFILE_EXTENSION = ".jianprofile";
const PROFILE_SCHEMA_VERSION = 1;
const PROFILE_ALLOWED_ENTRIES = new Set([
  "manifest.json",
  "preferences.json",
  "templates.json",
  "ai.json",
  "writing-assistance.json",
  "secrets.enc",
]);
const PROFILE_LIMITS = Object.freeze({
  maxArchiveBytes: 16 * 1024 * 1024,
  maxExpandedBytes: 32 * 1024 * 1024,
  maxEntryBytes: 8 * 1024 * 1024,
  maxEntries: 8,
  maxArchiveRatio: 500,
  maxJsonDepth: 32,
  maxJsonNodes: 100_000,
  maxTemplates: 1000,
  maxProviders: 128,
  maxTaskModels: 128,
});
const SCRYPT_PARAMETERS = Object.freeze({
  N: 32768,
  r: 8,
  p: 1,
});
const PREPARED_IMPORT_TTL_MS = 10 * 60 * 1000;
const MAX_PREPARED_IMPORTS = 4;

function createProfileRuntime({
  fs,
  path,
  JSZip,
  crypto,
  atomicWriteFile,
  getAppVersion,
  readAiConfig,
  writeAiConfig,
  readWritingAssistance,
  writeWritingAssistance,
  now = () => new Date(),
  randomUUID = crypto.randomUUID,
  preflightZipBuffer = defaultPreflightZipBuffer,
  limits = {},
}) {
  const resolvedLimits = { ...PROFILE_LIMITS, ...(limits || {}) };
  let mutationTail = Promise.resolve();
  const preparedImports = new Map();

  function jsonBuffer(value, label = "配置包文件") {
    let serialized;
    try {
      serialized = `${JSON.stringify(value, null, 2)}\n`;
    } catch {
      throw new Error(`${label}无法序列化`);
    }
    const buffer = Buffer.from(serialized, "utf8");
    if (buffer.length > resolvedLimits.maxEntryBytes) {
      throw new Error(`${label}大小超出限制`);
    }
    return buffer;
  }

  function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  function currentTimeMs() {
    const value = now();
    const timestamp = value instanceof Date
      ? value.getTime()
      : Number(value);
    if (!Number.isFinite(timestamp)) {
      throw new Error("配置导入事务时间无效");
    }
    return timestamp;
  }

  function configurationFingerprint(value) {
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      throw new Error("配置导入事务无法校验当前设置");
    }
    return sha256(Buffer.from(serialized || "null", "utf8"));
  }

  function createPreparedImportId() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = String(randomUUID() || "");
      if (
        /^[A-Za-z0-9_-]{1,128}$/.test(id)
        && !preparedImports.has(id)
      ) {
        return id;
      }
    }
    throw new Error("无法创建配置导入事务");
  }

  function cleanupPreparedImports() {
    const timestamp = currentTimeMs();
    for (const [id, transaction] of preparedImports) {
      if (
        (
          transaction.state === "prepared"
          || transaction.state === "rolled-back"
          || transaction.state === "discarded"
        )
        && transaction.expiresAt <= timestamp
      ) {
        preparedImports.delete(id);
      }
    }
  }

  function requirePreparedImport(transactionId) {
    cleanupPreparedImports();
    const safeId = String(transactionId || "").slice(0, 128);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(safeId)) {
      throw new Error("配置导入事务无效或已过期");
    }
    const transaction = preparedImports.get(safeId);
    if (!transaction) throw new Error("配置导入事务无效或已过期");
    return { id: safeId, transaction };
  }

  function safeObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function cloneJson(value, fallback) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return fallback;
    }
  }

  function isUnsafeObjectKey(key) {
    return key === "__proto__"
      || key === "prototype"
      || key === "constructor";
  }

  function assertSafeJsonTree(value, label) {
    const stack = [{ value, depth: 0 }];
    let nodes = 0;
    while (stack.length) {
      const current = stack.pop();
      nodes += 1;
      if (nodes > resolvedLimits.maxJsonNodes) {
        throw new Error(`${label}包含过多数据`);
      }
      if (current.depth > resolvedLimits.maxJsonDepth) {
        throw new Error(`${label}嵌套过深`);
      }
      if (!current.value || typeof current.value !== "object") continue;
      const entries = Array.isArray(current.value)
        ? current.value.map((item, index) => [String(index), item])
        : Object.entries(current.value);
      for (const [key, child] of entries) {
        if (!Array.isArray(current.value)) {
          if (isUnsafeObjectKey(key)) {
            throw new Error(`${label}包含不安全的字段名`);
          }
          if (key.length > 256) {
            throw new Error(`${label}字段名过长`);
          }
        }
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }

  function assertPlainObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`${label}格式无效`);
    }
    return value;
  }

  function sanitizePreferences(value, depth = 0) {
    if (depth > 8) return undefined;
    if (Array.isArray(value)) {
      return value
        .slice(0, 1000)
        .map((item) => sanitizePreferences(item, depth + 1))
        .filter((item) => item !== undefined);
    }
    if (value && typeof value === "object") {
      const output = {};
      for (const [key, item] of Object.entries(value).slice(0, 1000)) {
        if (
          isUnsafeObjectKey(key)
          || /(path|directory|recent|session|autosave|cache|logs?|oauth|token|emoji|api.?key|secret|pass(?:word|phrase)|credential|authorization|cookie|codex.*(?:login|auth)|(?:login|auth).*codex)/i
            .test(key)
        ) {
          continue;
        }
        const sanitized = sanitizePreferences(item, depth + 1);
        if (sanitized !== undefined) output[key.slice(0, 200)] = sanitized;
      }
      return output;
    }
    if (typeof value === "string") {
      const string = value.slice(0, 100_000);
      if (/^(?:[A-Za-z]:[\\/]|\\\\|\/|file:)/i.test(string)) {
        return undefined;
      }
      return string;
    }
    if (
      typeof value === "number"
      || typeof value === "boolean"
      || value === null
    ) {
      return value;
    }
    return undefined;
  }

  function safePassphrase(value) {
    const passphrase = String(value || "");
    if (passphrase.length < 12) {
      throw new Error("配置包口令至少需要 12 个字符");
    }
    if (passphrase.length > 1024) {
      throw new Error("配置包口令过长");
    }
    return passphrase;
  }

  function deriveKey(passphrase, salt) {
    return new Promise((resolve, reject) => {
      crypto.scrypt(
        safePassphrase(passphrase),
        salt,
        32,
        {
          ...SCRYPT_PARAMETERS,
          maxmem: 64 * 1024 * 1024,
        },
        (error, key) => {
          if (error) reject(error);
          else resolve(key);
        },
      );
    });
  }

  async function encryptSecrets(value, passphrase) {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = await deriveKey(passphrase, salt);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(jsonBuffer(value, "配置包密钥数据")),
      cipher.final(),
    ]);
    return jsonBuffer({
      version: 1,
      kdf: {
        name: "scrypt",
        salt: salt.toString("base64"),
        ...SCRYPT_PARAMETERS,
      },
      cipher: {
        name: "aes-256-gcm",
        iv: iv.toString("base64"),
        tag: cipher.getAuthTag().toString("base64"),
      },
      ciphertext: encrypted.toString("base64"),
    }, "配置包密钥信封");
  }

  async function decryptSecrets(buffer, passphrase) {
    let envelope;
    try {
      envelope = JSON.parse(buffer.toString("utf8"));
    } catch {
      throw new Error("密钥包格式无效");
    }
    if (
      envelope?.version !== 1
      || envelope?.kdf?.name !== "scrypt"
      || envelope?.kdf?.N !== SCRYPT_PARAMETERS.N
      || envelope?.kdf?.r !== SCRYPT_PARAMETERS.r
      || envelope?.kdf?.p !== SCRYPT_PARAMETERS.p
      || envelope?.cipher?.name !== "aes-256-gcm"
    ) {
      throw new Error("密钥包加密参数无效");
    }
    try {
      const salt = Buffer.from(String(envelope.kdf.salt || ""), "base64");
      const iv = Buffer.from(String(envelope.cipher.iv || ""), "base64");
      const tag = Buffer.from(String(envelope.cipher.tag || ""), "base64");
      const ciphertext = Buffer.from(
        String(envelope.ciphertext || ""),
        "base64",
      );
      if (
        salt.length !== 16
        || iv.length !== 12
        || tag.length !== 16
        || ciphertext.length === 0
        || ciphertext.length > resolvedLimits.maxEntryBytes
      ) {
        throw new Error("invalid envelope");
      }
      const key = await deriveKey(passphrase, salt);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return JSON.parse(
        Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]).toString("utf8"),
      );
    } catch {
      throw new Error("配置包口令错误或密钥数据已损坏");
    }
  }

  function splitAiConfig(input, includeSecrets) {
    const ai = cloneJson(safeObject(input), {});
    const apiKeys = Object.create(null);
    const providers = safeObject(ai.providers);
    for (const providerId of Object.keys(providers).slice(0, 128)) {
      const provider = safeObject(providers[providerId]);
      if (
        includeSecrets
        && provider.transport !== "codex-cli"
        && typeof provider.apiKey === "string"
        && provider.apiKey
      ) {
        apiKeys[providerId] = provider.apiKey.slice(0, 16384);
      }
      delete provider.apiKey;
      delete provider.encryptedApiKey;
      providers[providerId] = provider;
    }
    ai.providers = providers;
    return { ai, apiKeys };
  }

  function resetAiTestState(config) {
    const next = cloneJson(safeObject(config), {});
    for (const provider of Object.values(safeObject(next.providers))) {
      if (!provider || typeof provider !== "object") continue;
      provider.testedOk = false;
      provider.testedAt = "";
      provider.testMessage = "";
      if (Array.isArray(provider.models)) {
        provider.models = provider.models.map((model) => ({
          ...safeObject(model),
          testedOk: false,
          testedAt: "",
          testMessage: "",
        }));
      }
    }
    return next;
  }

  function uniqueProviderId(base, occupied) {
    const safeBase = String(base || "provider")
      .replace(/[^A-Za-z0-9_-]/g, "-")
      .slice(0, 96) || "provider";
    let candidate;
    do {
      candidate = `${safeBase}-imported-${randomUUID()
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 8)}`;
    } while (occupied.has(candidate));
    return candidate;
  }

  function mergeAiConfig(currentInput, importedInput, secretInput = {}) {
    const current = cloneJson(safeObject(currentInput), {});
    const imported = resetAiTestState(importedInput);
    current.providers = safeObject(current.providers);
    const importedProviders = safeObject(imported.providers);
    const importedSecrets = safeObject(secretInput.apiKeys);
    const occupied = new Set(Object.keys(current.providers));
    const providerRemap = new Map();
    const builtinIds = new Set(
      Object.entries(current.providers)
        .filter(([, provider]) => Boolean(provider?.builtin))
        .map(([providerId]) => providerId),
    );

    for (const [providerId, providerValue] of Object.entries(importedProviders)) {
      const provider = cloneJson(safeObject(providerValue), {});
      let targetId = providerId;
      if (occupied.has(targetId) && !builtinIds.has(targetId)) {
        targetId = uniqueProviderId(targetId, occupied);
        provider.provider = targetId;
        provider.providerLabel = `${provider.providerLabel || "自定义供应商"}（导入）`;
      }
      providerRemap.set(providerId, targetId);
      occupied.add(targetId);
      const existing = safeObject(current.providers[targetId]);
      current.providers[targetId] = {
        ...existing,
        ...provider,
        ...(typeof importedSecrets[providerId] === "string"
          ? { apiKey: importedSecrets[providerId].slice(0, 16384) }
          : (existing.apiKey ? { apiKey: existing.apiKey } : {})),
      };
    }

    const activeProvider = providerRemap.get(imported.activeProvider);
    if (activeProvider) current.activeProvider = activeProvider;
    if (typeof imported.activeModelId === "string") {
      current.activeModelId = imported.activeModelId.slice(0, 256);
    }
    if (imported.taskModels && typeof imported.taskModels === "object") {
      current.taskModels = Object.fromEntries(
        Object.entries(imported.taskModels).map(([key, assignment]) => {
          const source = safeObject(assignment);
          return [key, {
            ...source,
            providerId: providerRemap.get(source.providerId)
              || source.providerId
              || "",
          }];
        }),
      );
    }
    return { config: current, providerRemap: Object.fromEntries(providerRemap) };
  }

  function templateCollection(value) {
    if (Array.isArray(value)) return { shape: "array", templates: value };
    if (value && typeof value === "object" && Array.isArray(value.templates)) {
      return { shape: "object", templates: value.templates, source: value };
    }
    return { shape: "object", templates: [], source: safeObject(value) };
  }

  function validateParsedSections({
    manifest,
    preferences,
    templates,
    ai,
    writingAssistance,
    secrets,
  }) {
    assertPlainObject(manifest, "配置包清单");
    assertSafeJsonTree(manifest, "配置包清单");
    const sections = assertPlainObject(
      manifest.sections,
      "配置包分项清单",
    );
    for (const required of [
      "preferences",
      "templates",
      "ai",
      "writingAssistance",
    ]) {
      if (sections[required] !== true) {
        throw new Error("配置包分项清单不完整");
      }
    }
    if (typeof sections.secrets !== "boolean") {
      throw new Error("配置包密钥清单无效");
    }

    assertPlainObject(preferences, "配置包偏好设置");
    assertSafeJsonTree(preferences, "配置包偏好设置");
    if (
      !Array.isArray(templates)
      && (!templates || typeof templates !== "object")
    ) {
      throw new Error("配置包模板格式无效");
    }
    if (
      !Array.isArray(templates)
      && templates.templates !== undefined
      && !Array.isArray(templates.templates)
    ) {
      throw new Error("配置包模板格式无效");
    }
    assertSafeJsonTree(templates, "配置包模板");
    const templateItems = templateCollection(templates).templates;
    if (templateItems.length > resolvedLimits.maxTemplates) {
      throw new Error("配置包模板数量超出限制");
    }
    if (templateItems.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )) {
      throw new Error("配置包模板格式无效");
    }

    assertPlainObject(ai, "配置包 AI 设置");
    assertSafeJsonTree(ai, "配置包 AI 设置");
    if (
      ai.providers !== undefined
      && (
        !ai.providers
        || typeof ai.providers !== "object"
        || Array.isArray(ai.providers)
      )
    ) {
      throw new Error("配置包 AI 服务商格式无效");
    }
    const providerIds = Object.keys(safeObject(ai.providers));
    if (
      providerIds.length > resolvedLimits.maxProviders
      || providerIds.some(
        (providerId) => !/^[A-Za-z0-9_-]{1,128}$/.test(providerId),
      )
    ) {
      throw new Error("配置包 AI 服务商数量或身份无效");
    }
    if (Object.values(safeObject(ai.providers)).some(
      (provider) => provider
        && typeof provider === "object"
        && (
          Object.hasOwn(provider, "apiKey")
          || Object.hasOwn(provider, "encryptedApiKey")
        ),
    )) {
      throw new Error("配置包 AI 设置包含未加密密钥");
    }
    if (
      ai.taskModels !== undefined
      && (
        !ai.taskModels
        || typeof ai.taskModels !== "object"
        || Array.isArray(ai.taskModels)
      )
    ) {
      throw new Error("配置包任务模型格式无效");
    }
    if (
      Object.keys(safeObject(ai.taskModels)).length
      > resolvedLimits.maxTaskModels
    ) {
      throw new Error("配置包任务模型数量超出限制");
    }

    assertPlainObject(
      writingAssistance,
      "配置包写作检查设置",
    );
    assertSafeJsonTree(
      writingAssistance,
      "配置包写作检查设置",
    );
    if (
      writingAssistance.customWords !== undefined
      && !Array.isArray(writingAssistance.customWords)
    ) {
      throw new Error("配置包自定义词典格式无效");
    }
    if (
      writingAssistance.termRules !== undefined
      && !Array.isArray(writingAssistance.termRules)
    ) {
      throw new Error("配置包术语规则格式无效");
    }
    if (
      writingAssistance.customWords?.length > 5000
      || writingAssistance.termRules?.length > 2000
    ) {
      throw new Error("配置包写作检查数据超出限制");
    }

    assertPlainObject(secrets, "配置包密钥数据");
    assertSafeJsonTree(secrets, "配置包密钥数据");
    if (
      secrets.apiKeys !== undefined
      && (
        !secrets.apiKeys
        || typeof secrets.apiKeys !== "object"
        || Array.isArray(secrets.apiKeys)
      )
    ) {
      throw new Error("配置包密钥数据无效");
    }
    const apiKeys = safeObject(secrets.apiKeys);
    const secretProviderIds = Object.keys(apiKeys);
    if (
      secretProviderIds.length > resolvedLimits.maxProviders
      || secretProviderIds.some(
        (providerId) => !/^[A-Za-z0-9_-]{1,128}$/.test(providerId)
          || typeof apiKeys[providerId] !== "string"
          || apiKeys[providerId].length > 16384,
      )
    ) {
      throw new Error("配置包密钥数据无效");
    }
  }

  function mergeTemplates(currentValue, importedValue) {
    const current = templateCollection(cloneJson(currentValue, {}));
    const imported = templateCollection(cloneJson(importedValue, {}));
    const occupied = new Set(
      current.templates.map((item) => String(item?.id || "")).filter(Boolean),
    );
    const appended = imported.templates.map((item) => {
      const source = safeObject(item);
      let id = String(source.id || randomUUID()).slice(0, 128);
      let title = String(source.title || source.name || "导入模板").slice(0, 200);
      if (occupied.has(id)) {
        id = randomUUID();
        title = `${title}（导入）`.slice(0, 200);
      }
      occupied.add(id);
      return {
        ...source,
        id,
        ...(Object.hasOwn(source, "title")
          ? { title }
          : { name: title }),
      };
    });
    const templates = [...current.templates, ...appended];
    if (current.shape === "array") return templates;
    return { ...current.source, templates };
  }

  function mergeWritingAssistance(currentValue, importedValue) {
    const current = cloneJson(safeObject(currentValue), {});
    const imported = cloneJson(safeObject(importedValue), {});
    const customWords = [...new Set([
      ...(Array.isArray(current.customWords) ? current.customWords : []),
      ...(Array.isArray(imported.customWords) ? imported.customWords : []),
    ])].slice(0, 5000);
    const termRules = Array.isArray(current.termRules)
      ? current.termRules.slice(0, 2000)
      : [];
    const occupiedTerms = new Set(
      termRules.map((rule) => String(rule?.wrong || "").normalize("NFC")),
    );
    let termConflicts = 0;
    for (const rule of Array.isArray(imported.termRules)
      ? imported.termRules
      : []) {
      const key = String(rule?.wrong || "").normalize("NFC");
      if (!key || occupiedTerms.has(key)) {
        if (key) termConflicts += 1;
        continue;
      }
      occupiedTerms.add(key);
      termRules.push(rule);
      if (termRules.length >= 2000) break;
    }
    return {
      config: {
        ...current,
        ...imported,
        customWords,
        termRules,
      },
      termConflicts,
    };
  }

  async function createArchive({
    preferences = {},
    templates = {},
    includeSecrets = false,
    passphrase = "",
  } = {}) {
    const [rawAiConfig, writingAssistance] = await Promise.all([
      readAiConfig(),
      readWritingAssistance(),
    ]);
    const { ai, apiKeys } = splitAiConfig(rawAiConfig, includeSecrets);
    if (includeSecrets) safePassphrase(passphrase);
    const portablePreferences = sanitizePreferences(preferences) || {};
    const portableTemplates = cloneJson(templates, {});
    const secretPayload = includeSecrets ? { apiKeys } : {};
    const manifest = {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      appVersion: String(getAppVersion() || "").slice(0, 64),
      createdAt: now().toISOString(),
      sections: {
        preferences: true,
        templates: true,
        ai: true,
        writingAssistance: true,
        secrets: includeSecrets,
      },
      checksums: {},
    };
    validateParsedSections({
      manifest,
      preferences: portablePreferences,
      templates: portableTemplates,
      ai,
      writingAssistance,
      secrets: secretPayload,
    });
    const files = {
      "preferences.json": jsonBuffer(
        portablePreferences,
        "偏好设置",
      ),
      "templates.json": jsonBuffer(
        portableTemplates,
        "模板设置",
      ),
      "ai.json": jsonBuffer(ai, "AI 设置"),
      "writing-assistance.json": jsonBuffer(
        writingAssistance,
        "写作检查设置",
      ),
    };
    if (includeSecrets) {
      files["secrets.enc"] = await encryptSecrets(
        secretPayload,
        passphrase,
      );
    }
    manifest.checksums = Object.fromEntries(
      Object.entries(files).map(([name, buffer]) => [name, sha256(buffer)]),
    );
    files["manifest.json"] = jsonBuffer(manifest, "配置包清单");
    const expandedBytes = Object.values(files).reduce(
      (total, file) => total + file.length,
      0,
    );
    if (expandedBytes > resolvedLimits.maxExpandedBytes) {
      throw new Error("配置包展开后大小超出限制");
    }
    const zip = new JSZip();
    for (const [name, buffer] of Object.entries(files)) zip.file(name, buffer);
    const output = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    if (output.length > resolvedLimits.maxArchiveBytes) {
      throw new Error("配置包大小超出限制");
    }
    return { buffer: output, manifest };
  }

  async function parseArchive(input, {
    passphrase = "",
    decryptIncludedSecrets = true,
  } = {}) {
    const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
    if (!buffer.length || buffer.length > resolvedLimits.maxArchiveBytes) {
      throw new Error("配置包大小无效");
    }
    preflightZipBuffer(buffer, {
      limits: resolvedLimits,
    });
    let zip;
    try {
      zip = await JSZip.loadAsync(buffer, {
        checkCRC32: true,
        createFolders: false,
      });
    } catch {
      throw new Error("无法读取配置包");
    }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (
      entries.length === 0
      || entries.length > resolvedLimits.maxEntries
      || entries.some(
        (entry) => !PROFILE_ALLOWED_ENTRIES.has(entry.name)
          || entry.name.includes("/")
          || entry.name.includes("\\"),
      )
    ) {
      throw new Error("配置包包含不允许的文件");
    }
    let expandedBytes = 0;
    const files = {};
    for (const entry of entries) {
      const expectedSize = Number(entry?._data?.uncompressedSize);
      if (
        Number.isFinite(expectedSize)
        && expectedSize > resolvedLimits.maxEntryBytes
      ) {
        throw new Error("配置包条目过大");
      }
      const value = await entry.async("nodebuffer");
      expandedBytes += value.length;
      if (
        value.length > resolvedLimits.maxEntryBytes
        || expandedBytes > resolvedLimits.maxExpandedBytes
      ) {
        throw new Error("配置包展开后过大");
      }
      files[entry.name] = value;
    }
    if (!files["manifest.json"]) throw new Error("配置包缺少清单");
    let manifest;
    try {
      manifest = JSON.parse(files["manifest.json"].toString("utf8"));
    } catch {
      throw new Error("配置包清单无效");
    }
    assertPlainObject(manifest, "配置包清单");
    assertSafeJsonTree(manifest, "配置包清单");
    if (manifest.schemaVersion !== PROFILE_SCHEMA_VERSION) {
      throw new Error(
        Number(manifest?.schemaVersion) > PROFILE_SCHEMA_VERSION
          ? "配置包来自更高版本的笺间"
          : "配置包版本不受支持",
      );
    }
    for (const [name, checksum] of Object.entries(
      safeObject(manifest.checksums),
    )) {
      if (
        name === "manifest.json"
        || !files[name]
        || !/^[a-f0-9]{64}$/.test(String(checksum))
        || sha256(files[name]) !== checksum
      ) {
        throw new Error("配置包校验失败");
      }
    }
    const archivedContentNames = Object.keys(files)
      .filter((name) => name !== "manifest.json")
      .sort();
    const checksummedNames = Object.keys(safeObject(manifest.checksums)).sort();
    if (
      archivedContentNames.length !== checksummedNames.length
      || archivedContentNames.some(
        (name, index) => name !== checksummedNames[index],
      )
    ) {
      throw new Error("配置包校验清单不完整");
    }
    const required = [
      "preferences.json",
      "templates.json",
      "ai.json",
      "writing-assistance.json",
    ];
    if (required.some((name) => !files[name] || !manifest.checksums?.[name])) {
      throw new Error("配置包内容不完整");
    }
    if (Boolean(manifest.sections?.secrets) !== Boolean(files["secrets.enc"])) {
      throw new Error("配置包密钥清单不一致");
    }
    const parseJson = (name) => {
      let parsed;
      try {
        parsed = JSON.parse(files[name].toString("utf8"));
      } catch {
        throw new Error(`配置包文件无效：${name}`);
      }
      assertSafeJsonTree(parsed, `配置包文件 ${name}`);
      return parsed;
    };
    const rawPreferences = parseJson("preferences.json");
    const templates = parseJson("templates.json");
    const rawAi = parseJson("ai.json");
    const writingAssistance = parseJson("writing-assistance.json");
    const secrets = files["secrets.enc"] && decryptIncludedSecrets
      ? await decryptSecrets(files["secrets.enc"], passphrase)
      : {};
    validateParsedSections({
      manifest,
      preferences: rawPreferences,
      templates,
      ai: rawAi,
      writingAssistance,
      secrets,
    });
    const { ai } = splitAiConfig(rawAi, false);
    return {
      manifest,
      preferences: sanitizePreferences(rawPreferences) || {},
      templates,
      ai,
      writingAssistance,
      secrets,
    };
  }

  function jsonValuesEqual(left, right) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  function previewParsedArchive(parsed, {
    currentPreferences = {},
    currentTemplates = {},
    currentAi = {},
    currentWritingAssistance = {},
  } = {}) {
    const importedPreferences = safeObject(parsed.preferences);
    const localPreferences = safeObject(currentPreferences);
    const preferenceChanges = Object.keys(importedPreferences)
      .sort()
      .slice(0, 256)
      .map((key) => ({
        key,
        action: Object.hasOwn(localPreferences, key)
          ? (
            jsonValuesEqual(localPreferences[key], importedPreferences[key])
              ? "unchanged"
              : "overwrite"
          )
          : "add",
      }));

    const localTemplateIds = new Set(
      templateCollection(currentTemplates).templates
        .map((item) => String(item?.id || ""))
        .filter(Boolean),
    );
    const templateChanges = templateCollection(parsed.templates).templates
      .slice(0, 256)
      .map((item, index) => {
        const id = String(item?.id || "").slice(0, 128);
        return {
          id,
          title: String(
            item?.title || item?.name || `模板 ${index + 1}`,
          ).slice(0, 200),
          action: id && localTemplateIds.has(id) ? "remap" : "add",
        };
      });

    const localProviders = safeObject(currentAi?.providers);
    const providerChanges = Object.entries(safeObject(parsed.ai?.providers))
      .slice(0, 128)
      .map(([providerId, provider]) => {
        const existing = safeObject(localProviders[providerId]);
        return {
          id: providerId,
          title: String(
            provider?.providerLabel || provider?.label || providerId,
          ).slice(0, 200),
          action: Object.hasOwn(localProviders, providerId)
            ? (existing.builtin ? "overwrite" : "remap")
            : "add",
        };
      });

    const localWords = new Set(
      (Array.isArray(currentWritingAssistance?.customWords)
        ? currentWritingAssistance.customWords
        : [])
        .map((word) => String(word || "").normalize("NFC")),
    );
    const importedWords = Array.isArray(parsed.writingAssistance?.customWords)
      ? parsed.writingAssistance.customWords
      : [];
    const localRules = Array.isArray(currentWritingAssistance?.termRules)
      ? currentWritingAssistance.termRules
      : [];
    const localRuleTerms = new Set(
      localRules
        .map((rule) => String(rule?.wrong || "").normalize("NFC"))
        .filter(Boolean),
    );
    const importedRules = Array.isArray(parsed.writingAssistance?.termRules)
      ? parsed.writingAssistance.termRules
      : [];
    const allTermChanges = importedRules.map((rule) => {
      const wrong = String(rule?.wrong || "").normalize("NFC").slice(0, 200);
      return {
        wrong,
        preferred: String(rule?.preferred || "").slice(0, 200),
        action: wrong && localRuleTerms.has(wrong) ? "keep-local" : "add",
      };
    });
    const termChanges = allTermChanges.slice(0, 256);
    const termConflicts = allTermChanges.filter(
      (item) => item.action === "keep-local",
    ).length;
    const addedTerms = allTermChanges.length - termConflicts;
    const customWordAdds = importedWords.filter(
      (word) => !localWords.has(String(word || "").normalize("NFC")),
    ).length;

    return {
      preferenceKeys: Object.keys(importedPreferences).slice(0, 256),
      templateCount: templateCollection(parsed.templates).templates.length,
      providerCount: Object.keys(safeObject(parsed.ai?.providers)).length,
      termRuleCount: Array.isArray(parsed.writingAssistance?.termRules)
        ? parsed.writingAssistance.termRules.length
        : 0,
      includesSecrets: Boolean(parsed.manifest.sections?.secrets),
      sections: {
        preferences: {
          changed: preferenceChanges.filter(
            (item) => item.action !== "unchanged",
          ).length,
          unchanged: preferenceChanges.filter(
            (item) => item.action === "unchanged",
          ).length,
          items: preferenceChanges,
          summary: `${preferenceChanges.length} 个导入键，其中 ${
            preferenceChanges.filter((item) => item.action === "overwrite").length
          } 个将覆盖本机设置。`,
        },
        templates: {
          added: templateChanges.length,
          conflicts: templateChanges.filter(
            (item) => item.action === "remap",
          ).length,
          items: templateChanges,
          summary: `${templateChanges.length} 个模板将追加；同 ID 模板会生成新 ID 并标记“（导入）”。`,
        },
        ai: {
          changed: providerChanges.length,
          conflicts: providerChanges.filter(
            (item) => item.action === "remap",
          ).length,
          items: providerChanges,
          summary: `${providerChanges.length} 个 AI 服务商将导入；自定义服务商冲突会重映射 ID。`,
        },
        writingAssistance: {
          changed: allTermChanges.length + customWordAdds,
          added: addedTerms + customWordAdds,
          conflicts: termConflicts,
          items: termChanges,
          summary: `${customWordAdds} 个自定义词将加入词典，${allTermChanges.length} 条术语规则将检查合并。`,
          warnings: termConflicts
            ? [`${termConflicts} 条术语规则与本机冲突，将保留本机规则。`]
            : [],
        },
      },
    };
  }

  async function inspectArchive(input, {
    currentPreferences = {},
    currentTemplates = {},
  } = {}) {
    const parsed = await parseArchive(input, {
      decryptIncludedSecrets: false,
    });
    const [currentAi, currentWritingAssistance] = await Promise.all([
      readAiConfig(),
      readWritingAssistance(),
    ]);
    return {
      manifest: parsed.manifest,
      preview: previewParsedArchive(parsed, {
        currentPreferences,
        currentTemplates,
        currentAi,
        currentWritingAssistance,
      }),
    };
  }

  async function verifyArchive(input, { passphrase = "" } = {}) {
    const parsed = await parseArchive(input, {
      passphrase,
      decryptIncludedSecrets: true,
    });
    return {
      verified: true,
      manifest: parsed.manifest,
      preview: previewParsedArchive(parsed),
    };
  }

  function queueMutation(task) {
    const pending = mutationTail.catch(() => {}).then(task);
    mutationTail = pending;
    return pending;
  }

  function prepareArchive(input, {
    passphrase = "",
    sections = {},
    currentPreferences = {},
    currentTemplates = {},
  } = {}) {
    return queueMutation(async () => {
      cleanupPreparedImports();
      if (preparedImports.size >= MAX_PREPARED_IMPORTS) {
        throw new Error("待处理的配置导入事务过多，请先完成或取消已有导入");
      }
      const parsed = await parseArchive(input, { passphrase });
      const selected = {
        preferences: sections.preferences !== false,
        templates: sections.templates !== false,
        ai: sections.ai !== false,
        writingAssistance: sections.writingAssistance !== false,
      };
      const [previousAi, previousWritingAssistance] = await Promise.all([
        readAiConfig(),
        readWritingAssistance(),
      ]);
      const aiMerge = selected.ai
        ? mergeAiConfig(previousAi, parsed.ai, parsed.secrets)
        : { config: previousAi, providerRemap: {} };
      const writingMerge = selected.writingAssistance
        ? mergeWritingAssistance(
          previousWritingAssistance,
          parsed.writingAssistance,
        )
        : { config: previousWritingAssistance, termConflicts: 0 };
      const transactionId = createPreparedImportId();
      const timestamp = currentTimeMs();
      preparedImports.set(transactionId, {
        state: "prepared",
        createdAt: timestamp,
        expiresAt: timestamp + PREPARED_IMPORT_TTL_MS,
        selected,
        previousAi: cloneJson(previousAi, {}),
        previousWritingAssistance: cloneJson(
          previousWritingAssistance,
          {},
        ),
        previousAiFingerprint: configurationFingerprint(previousAi),
        previousWritingFingerprint: configurationFingerprint(
          previousWritingAssistance,
        ),
        nextAi: cloneJson(aiMerge.config, {}),
        nextWritingAssistance: cloneJson(writingMerge.config, {}),
        providerRemap: cloneJson(aiMerge.providerRemap, {}),
        termConflicts: writingMerge.termConflicts,
      });
      return {
        ok: true,
        prepared: true,
        transactionId,
        manifest: parsed.manifest,
        preferences: selected.preferences
          ? { ...safeObject(currentPreferences), ...safeObject(parsed.preferences) }
          : currentPreferences,
        templates: selected.templates
          ? mergeTemplates(currentTemplates, parsed.templates)
          : currentTemplates,
        providerRemap: aiMerge.providerRemap,
        termConflicts: writingMerge.termConflicts,
      };
    });
  }

  function commitPrepared(transactionId) {
    return queueMutation(async () => {
      const { id, transaction } = requirePreparedImport(transactionId);
      if (transaction.state !== "prepared") {
        throw new Error("配置导入事务当前无法提交");
      }
      const [currentAi, currentWritingAssistance] = await Promise.all([
        readAiConfig(),
        readWritingAssistance(),
      ]);
      if (
        (
          transaction.selected.ai
          && configurationFingerprint(currentAi)
            !== transaction.previousAiFingerprint
        )
        || (
          transaction.selected.writingAssistance
          && configurationFingerprint(currentWritingAssistance)
            !== transaction.previousWritingFingerprint
        )
      ) {
        transaction.state = "discarded";
        const error = new Error(
          "导入预览后本机配置已发生变化，请重新检查配置包",
        );
        error.code = "PROFILE_IMPORT_STALE";
        throw error;
      }

      transaction.state = "committing";
      try {
        if (transaction.selected.ai) {
          await writeAiConfig(cloneJson(transaction.nextAi, {}));
        }
        if (transaction.selected.writingAssistance) {
          await writeWritingAssistance(
            cloneJson(transaction.nextWritingAssistance, {}),
          );
        }
      } catch (error) {
        transaction.state = "rollback-needed";
        const rollbackResults = await Promise.allSettled([
          transaction.selected.ai
            ? writeAiConfig(cloneJson(transaction.previousAi, {}))
            : Promise.resolve(),
          transaction.selected.writingAssistance
            ? writeWritingAssistance(cloneJson(
              transaction.previousWritingAssistance,
              {},
            ))
            : Promise.resolve(),
        ]);
        const rollbackFailed = rollbackResults.some(
          (result) => result.status === "rejected",
        );
        if (!rollbackFailed) transaction.state = "rolled-back";
        if (rollbackFailed) {
          const rollbackError = new Error(
            `${error?.message || error}；自动回滚未完全成功，请重试回滚`,
          );
          rollbackError.code = "PROFILE_IMPORT_ROLLBACK_REQUIRED";
          rollbackError.cause = error;
          throw rollbackError;
        }
        throw error;
      }

      preparedImports.delete(id);
      return {
        ok: true,
        committed: true,
        providerRemap: cloneJson(transaction.providerRemap, {}),
        termConflicts: transaction.termConflicts,
      };
    });
  }

  function rollbackPrepared(transactionId) {
    return queueMutation(async () => {
      const { id, transaction } = requirePreparedImport(transactionId);
      if (transaction.state === "prepared") {
        preparedImports.delete(id);
        return { ok: true, rolledBack: true, discarded: true };
      }
      if (
        transaction.state === "rolled-back"
        || transaction.state === "discarded"
      ) {
        const discarded = transaction.state === "discarded";
        preparedImports.delete(id);
        return {
          ok: true,
          rolledBack: true,
          discarded,
          alreadyRolledBack: true,
        };
      }
      if (transaction.state !== "rollback-needed") {
        throw new Error("配置导入事务当前无法回滚");
      }
      const results = await Promise.allSettled([
        transaction.selected.ai
          ? writeAiConfig(cloneJson(transaction.previousAi, {}))
          : Promise.resolve(),
        transaction.selected.writingAssistance
          ? writeWritingAssistance(cloneJson(
            transaction.previousWritingAssistance,
            {},
          ))
          : Promise.resolve(),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("配置导入事务回滚失败，请重试");
      }
      preparedImports.delete(id);
      return { ok: true, rolledBack: true, discarded: false };
    });
  }

  async function applyArchive(input, options = {}) {
    const prepared = await prepareArchive(input, options);
    try {
      await commitPrepared(prepared.transactionId);
    } catch (error) {
      await rollbackPrepared(prepared.transactionId).catch(() => undefined);
      throw error;
    }
    const { transactionId: _transactionId, prepared: _prepared, ...result } = prepared;
    return result;
  }

  async function exportToFile(filePath, payload = {}) {
    const targetPath = path.extname(filePath).toLowerCase() === PROFILE_EXTENSION
      ? filePath
      : `${filePath}${PROFILE_EXTENSION}`;
    const result = await createArchive(payload);
    await atomicWriteFile(targetPath, result.buffer);
    return { ok: true, path: targetPath, manifest: result.manifest };
  }

  async function readProfileFile(filePath) {
    let handle;
    try {
      handle = await fs.open(filePath, "r");
      const before = await handle.stat();
      if (
        !before.isFile()
        || before.size <= 0
        || before.size > resolvedLimits.maxArchiveBytes
      ) {
        throw new Error("配置包大小无效");
      }
      const buffer = await handle.readFile();
      const after = await handle.stat();
      if (
        buffer.length !== after.size
        || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs
        || (
          before.dev != null
          && after.dev != null
          && before.dev !== after.dev
        )
        || (
          before.ino != null
          && after.ino != null
          && before.ino !== after.ino
        )
      ) {
        throw new Error("配置包在读取期间发生变化");
      }
      return buffer;
    } finally {
      await handle?.close();
    }
  }

  return {
    facade: Object.freeze({
      applyArchive,
      commitPrepared,
      createArchive,
      exportToFile,
      inspectArchive,
      mergeAiConfig,
      mergeTemplates,
      mergeWritingAssistance,
      parseArchive,
      prepareArchive,
      readProfileFile,
      rollbackPrepared,
      verifyArchive,
    }),
  };
}

module.exports = {
  PROFILE_EXTENSION,
  PROFILE_LIMITS,
  PROFILE_SCHEMA_VERSION,
  SCRYPT_PARAMETERS,
  createProfileRuntime,
};
