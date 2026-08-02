const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { atomicWriteFile } = require("./document-storage.cjs");
const {
  DOCUMENT_CONTEXT_MENU_CHANNEL,
  MAX_CONFIG_BYTES,
  createWritingAssistanceRuntime,
  installSpellingContextMenu,
} = require("./writing-assistance-runtime.cjs");

async function createHarness() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "paperwriter-writing-assistance-"),
  );
  let id = 0;
  const sessionCalls = [];
  const session = {
    availableSpellCheckerLanguages: ["zh-CN", "en-US", "en-GB", "fr"],
    setSpellCheckerLanguages(languages) {
      sessionCalls.push(["languages", languages]);
    },
    addWordToSpellCheckerDictionary(word) {
      sessionCalls.push(["add", word]);
    },
    removeWordFromSpellCheckerDictionary(word) {
      sessionCalls.push(["remove", word]);
    },
  };
  const runtime = createWritingAssistanceRuntime({
    fs,
    path,
    atomicWriteFile,
    getUserDataPath: () => root,
    randomUUID: () => `rule-${++id}`,
  });
  await runtime.initialize(session);
  return { root, runtime, sessionCalls };
}

test("writing assistance normalizes, persists, and applies local spell settings", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const saved = await harness.runtime.facade.saveConfig({
    languages: ["zh-CN", "en-US", "invalid language"],
    customWords: [" 笺间 ", "笺间", "\u0000bad"],
    termRules: [{
      wrong: "帐号",
      preferred: "账号",
      description: "统一用词",
      wholeWord: true,
      enabled: false,
    }, {
      wrong: "same",
      preferred: "same",
    }],
  });
  assert.deepEqual(saved.languages, ["zh-CN", "en-US"]);
  assert.deepEqual(saved.customWords, ["笺间", "bad"]);
  assert.equal(saved.termRules.length, 1);
  assert.equal(saved.termRules[0].id, "rule-1");
  assert.equal(saved.termRules[0].enabled, false);
  assert.deepEqual(
    harness.sessionCalls.filter(([type]) => type === "languages").at(-1),
    ["languages", ["en-US"]],
  );
  assert.deepEqual(
    harness.sessionCalls.filter(([type]) => type === "add"),
    [["add", "笺间"], ["add", "bad"]],
  );

  await harness.runtime.facade.removeWord("笺间");
  assert.deepEqual(harness.sessionCalls.at(-1), ["remove", "笺间"]);
  const reloaded = await harness.runtime.facade.getConfig();
  assert.deepEqual(reloaded.customWords, ["bad"]);
  assert.equal(reloaded.termRules[0].enabled, false);
});

test("disabling assistance clears spell languages and applied custom words", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  await harness.runtime.facade.addWord("PaperWriter");
  await harness.runtime.facade.saveConfig({ enabled: false });
  assert.deepEqual(
    harness.sessionCalls.filter(([type]) => type === "languages").at(-1),
    ["languages", []],
  );
  assert.deepEqual(harness.sessionCalls.at(-1), ["remove", "PaperWriter"]);
});

test("reinitializing with another Electron session reapplies custom words", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  await harness.runtime.facade.addWord("PaperWriter");
  const secondCalls = [];
  await harness.runtime.initialize({
    availableSpellCheckerLanguages: ["en-US"],
    setSpellCheckerLanguages(languages) {
      secondCalls.push(["languages", languages]);
    },
    addWordToSpellCheckerDictionary(word) {
      secondCalls.push(["add", word]);
    },
  });
  assert.deepEqual(secondCalls, [
    ["languages", ["en-US"]],
    ["add", "PaperWriter"],
  ]);
});

test("writing assistance refuses oversized on-disk configuration", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(harness.root, "writing-assistance.json"),
    Buffer.alloc(MAX_CONFIG_BYTES + 1, 0x20),
  );
  await assert.rejects(
    harness.runtime.facade.getConfig(),
    /大小无效/,
  );
});

test("native spelling context menu limits suggestions and persists dictionary words", async () => {
  const listeners = new Map();
  const replacements = [];
  const added = [];
  const sent = [];
  let template = null;
  let popupOptions = null;
  const webContents = {
    on(channel, listener) { listeners.set(channel, listener); },
    removeListener(channel) { listeners.delete(channel); },
    send(channel, payload) { sent.push([channel, payload]); },
    replaceMisspelling(value) { replacements.push(value); },
    getOwnerBrowserWindow() { return { id: "window" }; },
  };
  const dispose = installSpellingContextMenu({
    webContents,
    Menu: {
      buildFromTemplate(value) {
        template = value;
        return { popup(options) { popupOptions = options; } };
      },
    },
    getConfig: async () => ({ enabled: true }),
    addWord: async (word) => { added.push(word); },
  });
  await listeners.get("context-menu")({}, {
    misspelledWord: "te\u0000h",
    dictionarySuggestions: [
      "th\u0000e",
      "tech",
      "ten",
      "tea",
      "Ted",
      "sixth",
    ],
  });
  assert.equal(template.filter((item) => item.label && item.enabled !== false).length, 6);
  template[0].click();
  assert.deepEqual(replacements, ["the"]);
  template.at(-1).click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(added, ["teh"]);
  assert.equal(popupOptions.window.id, "window");
  assert.deepEqual(sent, []);
  dispose();
  assert.equal(listeners.has("context-menu"), false);
});

test("ordinary and disabled spelling context menus delegate to the renderer", async () => {
  const listeners = new Map();
  const sent = [];
  let prevented = 0;
  const webContents = {
    on(channel, listener) { listeners.set(channel, listener); },
    removeListener(channel) { listeners.delete(channel); },
    send(channel, payload) { sent.push([channel, payload]); },
  };
  let enabled = true;
  const dispose = installSpellingContextMenu({
    webContents,
    Menu: {
      buildFromTemplate() {
        assert.fail("renderer-delegated context menus must not create a native menu");
      },
    },
    getConfig: async () => ({ enabled }),
    addWord: async () => {},
  });
  const event = { preventDefault() { prevented += 1; } };

  await listeners.get("context-menu")(event, { x: 12.4, y: 34.6 });
  enabled = false;
  await listeners.get("context-menu")(event, {
    x: -20,
    y: 200_000,
    misspelledWord: "teh",
    dictionarySuggestions: ["the"],
  });

  assert.deepEqual(sent, [
    [DOCUMENT_CONTEXT_MENU_CHANNEL, { x: 12, y: 35 }],
    [DOCUMENT_CONTEXT_MENU_CHANNEL, { x: 0, y: 100_000 }],
  ]);
  assert.equal(prevented, 2);
  dispose();
});

test("a failed native spelling menu falls back to the renderer menu", async () => {
  const listeners = new Map();
  const sent = [];
  const webContents = {
    on(channel, listener) { listeners.set(channel, listener); },
    removeListener(channel) { listeners.delete(channel); },
    send(channel, payload) { sent.push([channel, payload]); },
  };
  installSpellingContextMenu({
    webContents,
    Menu: {
      buildFromTemplate() {
        throw new Error("native menu unavailable");
      },
    },
    getConfig: async () => ({ enabled: true }),
    addWord: async () => {},
  });

  await listeners.get("context-menu")({}, {
    x: 21,
    y: 43,
    misspelledWord: "teh",
    dictionarySuggestions: ["the"],
  });
  assert.deepEqual(sent, [
    [DOCUMENT_CONTEXT_MENU_CHANNEL, { x: 21, y: 43 }],
  ]);
});
