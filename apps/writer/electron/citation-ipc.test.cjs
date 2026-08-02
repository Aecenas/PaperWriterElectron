const assert = require("node:assert/strict");
const test = require("node:test");
const { registerCitationIpcHandlers } = require("./citation-ipc.cjs");

test("citation IPC exposes parsing, formatting, style validation, lookup, and native file flows", async () => {
  const handlers = new Map();
  const calls = [];
  let openOptions = null;
  const facade = {
    parse: (payload) => ({ parsed: payload }),
    exportSources: (payload) => ({ format: payload.format, text: "exported", extension: ".bib" }),
    formatSources: (payload) => ({ entries: [payload.styleId] }),
    builtInStyles: () => [{ styleId: "apa-7" }],
    validateCslStyle: (payload) => ({ valid: Boolean(payload.xml) }),
    lookup: async (payload) => ({ title: payload.value }),
  };
  const fs = {
    stat: async () => ({ isFile: () => true, size: 10 }),
    readFile: async () => "@book{x,title={X}}",
    writeFile: async (...args) => { calls.push(args); },
  };
  const dialog = {
    showOpenDialog: async (_window, options) => {
      openOptions = options;
      return { canceled: false, filePaths: ["C:\\docs\\refs.bib"] };
    },
    showSaveDialog: async () => ({ canceled: false, filePath: "C:\\docs\\out" }),
  };
  registerCitationIpcHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    citationFacade: facade,
    dialog,
    fs,
    path: require("node:path"),
    getMainWindow: () => ({}),
    defaultDocumentsDir: () => "C:\\docs",
  });
  assert.deepEqual([...handlers.keys()], [
    "citation:parse",
    "citation:export",
    "citation:format",
    "citation:styles",
    "citation:validate-style",
    "citation:lookup",
    "citation:pick-style",
    "citation:pick-import",
    "citation:save-export",
  ]);
  assert.equal((await handlers.get("citation:pick-import")()).parsed.format, "bibtex");
  assert.equal((await handlers.get("citation:pick-import")(null, { format: "bibtex" })).parsed.format, "bibtex");
  assert.deepEqual(openOptions.filters[0].extensions, ["bib"]);
  assert.equal((await handlers.get("citation:save-export")(null, { format: "bibtex" })).filePath, "C:\\docs\\out.bib");
  assert.deepEqual(calls[0], ["C:\\docs\\out.bib", "exported", "utf8"]);
});

test("public citation IPC exposes CRUD and one-time workspace migration", async () => {
  const handlers = new Map();
  const calls = [];
  const publicCitationLibrary = {
    listSources: async () => ({ sources: [{ id: "public-1" }] }),
    upsertSource: async (source) => { calls.push(["upsert", source]); return { source }; },
    deleteSource: async (id) => { calls.push(["delete", id]); return { ok: true, id }; },
    migrateWorkspace: async (workspaceId, sources) => {
      calls.push(["migrate", workspaceId, sources]);
      return { migrated: true, sources };
    },
  };
  registerCitationIpcHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    citationFacade: {
      parse() {}, exportSources() {}, formatSources() {}, builtInStyles: () => [], validateCslStyle() {}, lookup() {},
    },
    publicCitationLibrary,
    assertAuthorizedDirectory: async (workspacePath) => `${workspacePath}-authorized`,
    ensureWorkspace: async () => ({ manifest: { workspaceId: "workspace-public-1" } }),
    listCitationSources: async () => ({ sources: [{ id: "legacy-1", title: "旧文献" }] }),
  });

  assert.deepEqual(await handlers.get("citation:public-list")(), { sources: [{ id: "public-1" }] });
  await handlers.get("citation:public-upsert")(null, { id: "public-2", title: "公域文献" });
  await handlers.get("citation:public-delete")(null, "public-2");
  await handlers.get("citation:public-migrate")(null, "C:\\workspace");
  assert.deepEqual(calls, [
    ["upsert", { id: "public-2", title: "公域文献" }],
    ["delete", "public-2"],
    ["migrate", "workspace-public-1", [{ id: "legacy-1", title: "旧文献" }]],
  ]);
});

test("custom CSL picker performs a stable bounded read and returns no local path", async () => {
  const handlers = new Map();
  const xml = '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><title>本地样式</title></info></style>';
  let closed = false;
  registerCitationIpcHandlers({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
    },
    citationFacade: {
      parse() {},
      exportSources() {},
      formatSources() {},
      builtInStyles: () => [],
      lookup() {},
      validateCslStyle: ({ xml: input }) => {
        assert.equal(input, xml);
        return {
          styleId: "custom-abc",
          title: "本地样式",
          hash: "a".repeat(64),
          xml: input,
        };
      },
    },
    dialog: {
      showOpenDialog: async () => ({
        canceled: false,
        filePaths: ["C:\\docs\\local.csl"],
      }),
    },
    fs: {
      open: async () => ({
        stat: async () => ({
          isFile: () => true,
          size: Buffer.byteLength(xml),
          mtimeMs: 123,
        }),
        readFile: async () => Buffer.from(xml),
        close: async () => { closed = true; },
      }),
    },
    path: require("node:path"),
    getMainWindow: () => ({}),
    defaultDocumentsDir: () => "C:\\docs",
  });

  const result = await handlers.get("citation:pick-style")();
  assert.equal(closed, true);
  assert.equal(result.canceled, false);
  assert.equal(result.filePath, undefined);
  assert.deepEqual(result.style, {
    styleId: "custom-abc",
    locale: "zh-CN",
    customStyle: {
      styleId: "custom-abc",
      title: "本地样式",
      hash: "a".repeat(64),
      xml,
    },
  });
});

test("citation IPC rejects oversized renderer payloads before runtime or file dialogs", async () => {
  const handlers = new Map();
  let runtimeCalls = 0;
  let dialogCalls = 0;
  registerCitationIpcHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    citationFacade: {
      parse() { runtimeCalls += 1; },
      exportSources() { runtimeCalls += 1; return { format: "csl-json", text: "[]", extension: ".json" }; },
      formatSources() { runtimeCalls += 1; },
      builtInStyles: () => [],
      validateCslStyle() { runtimeCalls += 1; },
      lookup() { runtimeCalls += 1; },
    },
    dialog: {
      async showSaveDialog() { dialogCalls += 1; return { canceled: true }; },
      async showOpenDialog() { dialogCalls += 1; return { canceled: true }; },
    },
    fs: {},
    path: require("node:path"),
  });

  assert.throws(
    () => handlers.get("citation:parse")({}, { text: "x".repeat(4 * 1024 * 1024 + 4097) }),
    /总大小超过限制/,
  );
  await assert.rejects(
    handlers.get("citation:save-export")({}, {
      sources: Array.from({ length: 5_001 }, () => ({})),
      format: "csl-json",
    }),
    /数组项目数量超过限制/,
  );
  assert.equal(runtimeCalls, 0);
  assert.equal(dialogCalls, 0);
});
