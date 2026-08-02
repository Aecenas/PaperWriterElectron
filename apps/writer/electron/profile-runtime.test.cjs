const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const JSZip = require("jszip");

const { atomicWriteFile } = require("./document-storage.cjs");
const {
  createProfileRuntime,
} = require("./profile-runtime.cjs");

function sampleAiConfig() {
  return {
    activeProvider: "custom",
    activeModelId: "custom:model",
    providers: {
      gemini: {
        provider: "gemini",
        builtin: true,
        transport: "http",
        baseUrl: "https://example.test",
        apiKey: "gemini-secret",
        testedOk: true,
        models: [{
          id: "gemini:model",
          model: "gemini",
          testedOk: true,
          testedAt: "today",
          testMessage: "ok",
        }],
      },
      custom: {
        provider: "custom",
        providerLabel: "Custom",
        builtin: false,
        transport: "http",
        baseUrl: "https://custom.test",
        apiKey: "custom-secret",
        testedOk: true,
        models: [{
          id: "custom:model",
          model: "writer",
          testedOk: true,
        }],
      },
    },
    taskModels: {
      selectionChat: {
        providerId: "custom",
        modelId: "custom:model",
      },
    },
  };
}

async function createHarness(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-profile-"));
  let aiConfig = options.aiConfig || sampleAiConfig();
  let writingAssistance = options.writingAssistance || {
    enabled: true,
    customWords: ["笺间"],
    termRules: [],
  };
  let id = 0;
  const writes = [];
  const runtime = createProfileRuntime({
    fs,
    path,
    JSZip,
    crypto,
    atomicWriteFile,
    getAppVersion: () => "1.2.3",
    readAiConfig: async () => JSON.parse(JSON.stringify(aiConfig)),
    writeAiConfig: async (next) => {
      writes.push(["ai", next]);
      if (options.failAiWrite) throw new Error("AI write failed");
      aiConfig = JSON.parse(JSON.stringify(next));
    },
    readWritingAssistance: async () => (
      JSON.parse(JSON.stringify(writingAssistance))
    ),
    writeWritingAssistance: async (next) => {
      writes.push(["writing", next]);
      if (
        options.failWritingWrite
        && writes.filter(([type]) => type === "writing").length === 1
      ) {
        throw new Error("writing write failed");
      }
      writingAssistance = JSON.parse(JSON.stringify(next));
    },
    now: () => new Date("2026-07-29T00:00:00.000Z"),
    randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    limits: options.limits,
  });
  return {
    root,
    runtime,
    writes,
    getAi: () => aiConfig,
    getWriting: () => writingAssistance,
    setAi: (value) => {
      aiConfig = JSON.parse(JSON.stringify(value));
    },
    setWriting: (value) => {
      writingAssistance = JSON.parse(JSON.stringify(value));
    },
  };
}

test("profile archive omits API keys unless encrypted secrets are requested", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const plain = await harness.runtime.facade.createArchive({
    preferences: {
      theme: "paper",
      recentPath: "C:\\Secret\\draft.letterpaper",
      nested: { exportDirectory: "C:\\Secret" },
    },
    templates: [{ id: "template-1", title: "模板" }],
  });
  const plainParsed = await harness.runtime.facade.parseArchive(plain.buffer);
  assert.equal(plainParsed.manifest.sections.secrets, false);
  assert.deepEqual(plainParsed.preferences, {
    theme: "paper",
    nested: {},
  });
  assert.equal(plainParsed.ai.providers.custom.apiKey, undefined);
  assert.doesNotMatch(plain.buffer.toString("latin1"), /custom-secret/);

  const protectedArchive = await harness.runtime.facade.createArchive({
    includeSecrets: true,
    passphrase: "correct horse battery staple",
  });
  const protectedPreview = await harness.runtime.facade.inspectArchive(
    protectedArchive.buffer,
  );
  assert.equal(protectedPreview.preview.includesSecrets, true);
  const verifiedPreview = await harness.runtime.facade.verifyArchive(
    protectedArchive.buffer,
    { passphrase: "correct horse battery staple" },
  );
  assert.equal(verifiedPreview.verified, true);
  assert.equal(verifiedPreview.preview.includesSecrets, true);
  assert.equal(verifiedPreview.preview.providerCount, 2);
  assert.doesNotMatch(JSON.stringify(verifiedPreview), /custom-secret|gemini-secret/);
  assert.doesNotMatch(
    protectedArchive.buffer.toString("latin1"),
    /custom-secret|gemini-secret/,
  );
  const protectedParsed = await harness.runtime.facade.parseArchive(
    protectedArchive.buffer,
    { passphrase: "correct horse battery staple" },
  );
  assert.deepEqual(protectedParsed.secrets.apiKeys, {
    gemini: "gemini-secret",
    custom: "custom-secret",
  });
  await assert.rejects(
    harness.runtime.facade.verifyArchive(protectedArchive.buffer, {
      passphrase: "this is the wrong password",
    }),
    /口令错误|已损坏/,
  );
});

test("profile archive rejects checksum tampering", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const created = await harness.runtime.facade.createArchive({
    preferences: { theme: "paper" },
  });
  const zip = await JSZip.loadAsync(created.buffer);
  zip.file("preferences.json", JSON.stringify({ theme: "tampered" }));
  const tampered = await zip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(
    harness.runtime.facade.parseArchive(tampered),
    /校验失败/,
  );
});

test("profile export strips secret-like settings, login state, and absolute paths", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const preferences = JSON.parse(`{
    "theme": "paper",
    "apiKey": "plain-secret",
    "codexLoginState": "signed-in",
    "linuxLocation": "/opt/private/draft",
    "fileLocation": "file:///C:/private/draft",
    "nested": {
      "password": "password-secret",
      "safeSetting": true
    },
    "__proto__": {
      "polluted": true
    }
  }`);
  const created = await harness.runtime.facade.createArchive({ preferences });
  const parsed = await harness.runtime.facade.parseArchive(created.buffer);
  assert.deepEqual(parsed.preferences, {
    theme: "paper",
    nested: { safeSetting: true },
  });
  assert.doesNotMatch(
    created.buffer.toString("latin1"),
    /plain-secret|password-secret|signed-in/,
  );
  assert.equal({}.polluted, undefined);
});

test("profile parser rejects schema-valid archives carrying plaintext API keys", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const created = await harness.runtime.facade.createArchive();
  const zip = await JSZip.loadAsync(created.buffer);
  const manifest = JSON.parse(
    await zip.file("manifest.json").async("string"),
  );
  const ai = JSON.parse(await zip.file("ai.json").async("string"));
  ai.providers.custom.apiKey = "must-not-be-plaintext";
  const aiBuffer = Buffer.from(`${JSON.stringify(ai, null, 2)}\n`, "utf8");
  manifest.checksums["ai.json"] = crypto.createHash("sha256")
    .update(aiBuffer)
    .digest("hex");
  zip.file("ai.json", aiBuffer);
  zip.file("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  const malicious = await zip.generateAsync({ type: "nodebuffer" });

  await assert.rejects(
    harness.runtime.facade.parseArchive(malicious),
    /未加密密钥/,
  );
});

test("profile parser preflights forged ZIP entry counts before expansion", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const created = await harness.runtime.facade.createArchive();
  const forged = Buffer.from(created.buffer);
  const eocd = forged.lastIndexOf(
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  );
  assert.notEqual(eocd, -1);
  forged.writeUInt16LE(9, eocd + 8);
  forged.writeUInt16LE(9, eocd + 10);
  await assert.rejects(
    harness.runtime.facade.parseArchive(forged),
    /过多|计数/,
  );
});

test("profile creation rejects oversized JSON before ZIP compression", async (t) => {
  const harness = await createHarness({
    limits: {
      maxEntryBytes: 1024,
      maxExpandedBytes: 4096,
    },
  });
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  await assert.rejects(
    harness.runtime.facade.createArchive({
      templates: [{
        id: "large",
        title: "Large",
        body: "x".repeat(4000),
      }],
    }),
    /大小超出限制/,
  );
});

test("profile schema bounds imported template counts", async (t) => {
  const harness = await createHarness({
    limits: { maxTemplates: 2 },
  });
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  await assert.rejects(
    harness.runtime.facade.createArchive({
      templates: [
        { id: "one" },
        { id: "two" },
        { id: "three" },
      ],
    }),
    /模板数量/,
  );
});

test("import remaps colliding custom providers, resets tests, and merges local data", async (t) => {
  const exporter = await createHarness();
  const importer = await createHarness({
    aiConfig: {
      ...sampleAiConfig(),
      providers: {
        ...sampleAiConfig().providers,
        custom: {
          ...sampleAiConfig().providers.custom,
          providerLabel: "Existing",
          apiKey: "existing-secret",
        },
      },
    },
  });
  t.after(() => Promise.all([
    fs.rm(exporter.root, { recursive: true, force: true }),
    fs.rm(importer.root, { recursive: true, force: true }),
  ]));
  const archive = await exporter.runtime.facade.createArchive({
    preferences: { theme: "paper" },
    templates: [{ id: "same-id", title: "Imported" }],
    includeSecrets: true,
    passphrase: "correct horse battery staple",
  });
  const applied = await importer.runtime.facade.applyArchive(archive.buffer, {
    passphrase: "correct horse battery staple",
    currentPreferences: { zoom: 1.2 },
    currentTemplates: [{ id: "same-id", title: "Local" }],
  });
  assert.deepEqual(applied.preferences, { zoom: 1.2, theme: "paper" });
  assert.equal(applied.templates.length, 2);
  assert.equal(applied.templates[1].title, "Imported（导入）");
  const importedProviderId = applied.providerRemap.custom;
  assert.notEqual(importedProviderId, "custom");
  assert.equal(importer.getAi().providers.custom.providerLabel, "Existing");
  assert.equal(
    importer.getAi().providers[importedProviderId].apiKey,
    "custom-secret",
  );
  assert.equal(
    importer.getAi().providers[importedProviderId].models[0].testedOk,
    false,
  );
  assert.equal(
    importer.getAi().taskModels.selectionChat.providerId,
    importedProviderId,
  );
});

test("profile inspection returns actionable per-section diff and terminology conflicts", async (t) => {
  const exporter = await createHarness({
    writingAssistance: {
      enabled: true,
      customWords: ["远端词"],
      termRules: [{
        id: "imported-account",
        wrong: "帐户",
        preferred: "账户",
      }],
    },
  });
  const importer = await createHarness({
    writingAssistance: {
      enabled: true,
      customWords: ["本机词"],
      termRules: [{
        id: "local-account",
        wrong: "帐户",
        preferred: "帐号",
      }],
    },
  });
  t.after(() => Promise.all([
    fs.rm(exporter.root, { recursive: true, force: true }),
    fs.rm(importer.root, { recursive: true, force: true }),
  ]));
  const archive = await exporter.runtime.facade.createArchive({
    preferences: { theme: "paper", zoom: 1.25 },
    templates: [{ id: "same-id", title: "远端模板" }],
  });
  const inspected = await importer.runtime.facade.inspectArchive(
    archive.buffer,
    {
      currentPreferences: { theme: "dark" },
      currentTemplates: [{ id: "same-id", title: "本机模板" }],
    },
  );
  assert.equal(inspected.preview.sections.preferences.changed, 2);
  assert.equal(inspected.preview.sections.templates.conflicts, 1);
  assert.equal(inspected.preview.sections.ai.conflicts, 1);
  assert.equal(inspected.preview.sections.writingAssistance.conflicts, 1);
  assert.equal(
    inspected.preview.sections.writingAssistance.items[0].action,
    "keep-local",
  );
  assert.match(
    inspected.preview.sections.writingAssistance.warnings[0],
    /保留本机规则/,
  );
});

test("main-process profile writes roll back when a selected section fails", async (t) => {
  const exporter = await createHarness();
  const importer = await createHarness({
    failWritingWrite: true,
    writingAssistance: { enabled: false, customWords: ["local"] },
  });
  t.after(() => Promise.all([
    fs.rm(exporter.root, { recursive: true, force: true }),
    fs.rm(importer.root, { recursive: true, force: true }),
  ]));
  const originalAi = JSON.parse(JSON.stringify(importer.getAi()));
  const archive = await exporter.runtime.facade.createArchive();
  await assert.rejects(
    importer.runtime.facade.applyArchive(archive.buffer),
    /writing write failed/,
  );
  assert.deepEqual(importer.getAi(), originalAi);
  assert.deepEqual(importer.getWriting(), {
    enabled: false,
    customWords: ["local"],
  });
});

test("profile import prepare is side-effect free until an explicit commit", async (t) => {
  const exporter = await createHarness({
    writingAssistance: {
      enabled: true,
      customWords: ["imported"],
      termRules: [],
    },
  });
  const importer = await createHarness({
    writingAssistance: {
      enabled: false,
      customWords: ["local"],
      termRules: [],
    },
  });
  t.after(() => Promise.all([
    fs.rm(exporter.root, { recursive: true, force: true }),
    fs.rm(importer.root, { recursive: true, force: true }),
  ]));
  const previousAi = JSON.parse(JSON.stringify(importer.getAi()));
  const previousWriting = JSON.parse(
    JSON.stringify(importer.getWriting()),
  );
  const archive = await exporter.runtime.facade.createArchive({
    preferences: { theme: "paper" },
  });

  const prepared = await importer.runtime.facade.prepareArchive(
    archive.buffer,
    { currentPreferences: { zoom: 1 } },
  );
  assert.equal(prepared.prepared, true);
  assert.deepEqual(prepared.preferences, {
    zoom: 1,
    theme: "paper",
  });
  assert.deepEqual(importer.getAi(), previousAi);
  assert.deepEqual(importer.getWriting(), previousWriting);
  assert.equal(importer.writes.length, 0);

  const committed = await importer.runtime.facade.commitPrepared(
    prepared.transactionId,
  );
  assert.equal(committed.committed, true);
  assert.notDeepEqual(importer.getWriting(), previousWriting);
  await assert.rejects(
    importer.runtime.facade.commitPrepared(prepared.transactionId),
    /无效或已过期/,
  );
});

test("discarding a prepared profile transaction leaves main-process config untouched", async (t) => {
  const exporter = await createHarness();
  const importer = await createHarness();
  t.after(() => Promise.all([
    fs.rm(exporter.root, { recursive: true, force: true }),
    fs.rm(importer.root, { recursive: true, force: true }),
  ]));
  const originalAi = JSON.parse(JSON.stringify(importer.getAi()));
  const originalWriting = JSON.parse(
    JSON.stringify(importer.getWriting()),
  );
  const archive = await exporter.runtime.facade.createArchive();
  const prepared = await importer.runtime.facade.prepareArchive(
    archive.buffer,
  );
  const rolledBack = await importer.runtime.facade.rollbackPrepared(
    prepared.transactionId,
  );
  assert.equal(rolledBack.discarded, true);
  assert.equal(importer.writes.length, 0);
  assert.deepEqual(importer.getAi(), originalAi);
  assert.deepEqual(importer.getWriting(), originalWriting);
});

test("profile commit rejects a stale prepared transaction before writing", async (t) => {
  const exporter = await createHarness();
  const importer = await createHarness();
  t.after(() => Promise.all([
    fs.rm(exporter.root, { recursive: true, force: true }),
    fs.rm(importer.root, { recursive: true, force: true }),
  ]));
  const archive = await exporter.runtime.facade.createArchive();
  const prepared = await importer.runtime.facade.prepareArchive(
    archive.buffer,
  );
  importer.setAi({
    ...importer.getAi(),
    activeModelId: "changed-after-preview",
  });
  await assert.rejects(
    importer.runtime.facade.commitPrepared(prepared.transactionId),
    (error) => error?.code === "PROFILE_IMPORT_STALE",
  );
  assert.equal(importer.writes.length, 0);
});
