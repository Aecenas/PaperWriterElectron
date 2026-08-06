const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
  registerResourceIpcHandlers,
} = require("./resource-ipc.cjs");

const RESOURCE_CHANNELS = [
  "asset:pick-audio",
  "asset:pick-image",
  "asset:pick-video",
  "clipboard:write-content",
  "clipboard:write-image-reference",
  "external:open",
];

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function createHarness(options = {}) {
  const handlers = new Map();
  const mainWindow = { id: "main-window" };
  const dialogResults = [...(options.dialogResults || [{
    canceled: false,
    filePaths: ["C:\\media\\asset.png"],
  }])];
  const calls = {
    clipboardWrites: [],
    mimePaths: [],
    openDialogs: [],
    openExternal: [],
    stages: [],
    stats: [],
  };
  const stagedAssetStore = {
    async stage(...args) {
      calls.stages.push(args);
      if (options.stageError) throw options.stageError;
      return options.staged || {
        size: 1234,
        src: "paper-asset://staged/token",
      };
    },
  };
  const state = {
    stagedAssetStore: hasOwn(options, "stagedAssetStore")
      ? options.stagedAssetStore
      : stagedAssetStore,
  };

  registerResourceIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
        handlers.set(channel, handler);
      },
    },
    dialog: {
      async showOpenDialog(...args) {
        calls.openDialogs.push(args);
        return dialogResults.shift() || { canceled: true };
      },
    },
    getMainWindow() {
      return mainWindow;
    },
    imageExtensions: ["png", "jpg"],
    audioExtensions: ["mp3", "wav"],
    videoExtensions: ["mp4", "webm"],
    imageMaxBytes: 32 * 1024 * 1024,
    imageMaxDimension: 16_384,
    imageMaxPixels: 40_000_000,
    audioMaxBytes: 20 * 1024 * 1024,
    videoMaxBytes: 100 * 1024 * 1024,
    path,
    fs: {
      async stat(filePath) {
        calls.stats.push(filePath);
        if (options.statError) throw options.statError;
        return {
          size: options.statSize || 1024,
          isFile: () => options.statIsFile !== false,
        };
      },
    },
    assetsFacade: {
      isStagedAssetReady() {
        return Boolean(state.stagedAssetStore);
      },
      mimeFromPath(filePath) {
        calls.mimePaths.push(filePath);
        const extension = path.extname(filePath).toLowerCase();
        return {
          ".png": "image/png",
          ".mp3": "audio/mpeg",
          ".mp4": "video/mp4",
        }[extension] || "application/octet-stream";
      },
      async stageAsset(...args) {
        if (!state.stagedAssetStore) {
          throw new Error("资源暂存服务尚未就绪");
        }
        return state.stagedAssetStore.stage(...args);
      },
    },
    clipboard: {
      write(value) {
        calls.clipboardWrites.push(value);
      },
    },
    shell: {
      async openExternal(value) {
        calls.openExternal.push(value);
        if (options.openExternalError) throw options.openExternalError;
      },
    },
  });

  return {
    calls,
    handlers,
    mainWindow,
    stagedAssetStore,
    state,
  };
}

test("registers exactly the staged assets, clipboard, and external URL surface", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()].sort(), RESOURCE_CHANNELS);
});

test("image picker stages only an allowlisted native-selected image without exposing its path", async () => {
  const harness = createHarness({
    dialogResults: [{
      canceled: false,
      filePaths: ["C:\\private\\Hero.PNG"],
    }],
  });

  const result = await harness.handlers.get("asset:pick-image")();
  assert.deepEqual(harness.calls.openDialogs, [[
    harness.mainWindow,
    {
      title: "选择图片",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg"] }],
    },
  ]]);
  assert.deepEqual(harness.calls.stages, [[
    "C:\\private\\Hero.PNG",
    {
      mime: "image/png",
      name: "Hero.PNG",
      maxBytes: 32 * 1024 * 1024,
      validateImage: true,
      maxImageDimension: 16_384,
      maxImagePixels: 40_000_000,
    },
  ]]);
  assert.deepEqual(result, {
    canceled: false,
    name: "Hero",
    fileName: "Hero.PNG",
    mime: "image/png",
    size: 1234,
    src: "paper-asset://staged/token",
  });
  assert.equal(Object.hasOwn(result, "path"), false);
});

test("image picker preserves cancellation, extension rejection, and unavailable-store errors", async () => {
  const canceled = createHarness({
    dialogResults: [{ canceled: true }],
  });
  assert.deepEqual(
    await canceled.handlers.get("asset:pick-image")(),
    { canceled: true },
  );

  const unsupported = createHarness({
    dialogResults: [{
      canceled: false,
      filePaths: ["C:\\private\\payload.exe"],
    }],
  });
  assert.deepEqual(
    await unsupported.handlers.get("asset:pick-image")(),
    {
      canceled: false,
      error: "unsupported-type",
      kind: "image",
      extension: "exe",
    },
  );
  assert.deepEqual(unsupported.calls.stages, []);

  const unavailable = createHarness({ stagedAssetStore: null });
  await assert.rejects(
    unavailable.handlers.get("asset:pick-image")(),
    /图片暂存服务尚未就绪，请重启应用后重试/,
  );
});

test("image picker rejects oversized or non-file input before staging", async () => {
  const oversized = createHarness({
    statSize: (32 * 1024 * 1024) + 1,
  });
  assert.deepEqual(
    await oversized.handlers.get("asset:pick-image")(),
    {
      canceled: false,
      error: "too-large",
      kind: "image",
      size: (32 * 1024 * 1024) + 1,
      maxBytes: 32 * 1024 * 1024,
    },
  );
  assert.deepEqual(oversized.calls.stages, []);

  const notAFile = createHarness({ statIsFile: false });
  assert.deepEqual(
    await notAFile.handlers.get("asset:pick-image")(),
    { canceled: false, error: "read-failed", kind: "image" },
  );
  assert.deepEqual(notAFile.calls.stages, []);
});

test("audio and video pickers enforce independent extension and byte limits", async () => {
  const oversizedAudio = createHarness({
    dialogResults: [{
      canceled: false,
      filePaths: ["C:\\media\\large.mp3"],
    }],
    statSize: (20 * 1024 * 1024) + 1,
  });
  assert.deepEqual(
    await oversizedAudio.handlers.get("asset:pick-audio")(),
    {
      canceled: false,
      error: "too-large",
      kind: "audio",
      size: (20 * 1024 * 1024) + 1,
      maxBytes: 20 * 1024 * 1024,
    },
  );
  assert.deepEqual(oversizedAudio.calls.stages, []);

  const unsupportedVideo = createHarness({
    dialogResults: [{
      canceled: false,
      filePaths: ["C:\\media\\movie.mov"],
    }],
  });
  assert.deepEqual(
    await unsupportedVideo.handlers.get("asset:pick-video")(),
    {
      canceled: false,
      error: "unsupported-type",
      kind: "video",
      extension: "mov",
    },
  );
  assert.deepEqual(unsupportedVideo.calls.stats, []);
});

test("media picker stages bounded content and maps read or staging failures", async () => {
  const harness = createHarness({
    dialogResults: [{
      canceled: false,
      filePaths: ["C:\\media\\song.mp3"],
    }],
    statSize: 4096,
  });
  assert.deepEqual(
    await harness.handlers.get("asset:pick-audio")(),
    {
      canceled: false,
      kind: "audio",
      name: "song",
      fileName: "song.mp3",
      mime: "audio/mpeg",
      size: 1234,
      src: "paper-asset://staged/token",
    },
  );
  assert.deepEqual(harness.calls.stages, [[
    "C:\\media\\song.mp3",
    {
      mime: "audio/mpeg",
      name: "song.mp3",
      maxBytes: 20 * 1024 * 1024,
    },
  ]]);

  const failed = createHarness({
    dialogResults: [{
      canceled: false,
      filePaths: ["C:\\media\\song.mp3"],
    }],
    stageError: new Error("stage failed"),
  });
  assert.deepEqual(
    await failed.handlers.get("asset:pick-audio")(),
    { canceled: false, error: "read-failed", kind: "audio" },
  );
});

test("rich clipboard content rejects empty input and applies exact text and HTML bounds", async () => {
  const harness = createHarness();
  const write = harness.handlers.get("clipboard:write-content");

  assert.deepEqual(
    await write({}, { text: 42, html: null }),
    { ok: false, message: "没有可复制的内容" },
  );
  assert.deepEqual(harness.calls.clipboardWrites, []);

  assert.deepEqual(
    await write({}, {
      text: "t".repeat(2_000_001),
      html: "h".repeat(4_000_001),
    }),
    { ok: true },
  );
  assert.equal(harness.calls.clipboardWrites[0].text.length, 2_000_000);
  assert.equal(harness.calls.clipboardWrites[0].html.length, 4_000_000);

  assert.deepEqual(await write({}, { text: "plain" }), { ok: true });
  assert.deepEqual(harness.calls.clipboardWrites[1], { text: "plain" });
});

test("image-reference clipboard validates UUIDs, normalizes case, and clamps numbering", async () => {
  const harness = createHarness();
  const write = harness.handlers.get("clipboard:write-image-reference");
  const documentId = "33333333-3333-4333-8333-333333333333";
  const imageId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";

  assert.deepEqual(
    await write({}, { documentId, imageId, number: 9000 }),
    { ok: true },
  );
  assert.deepEqual(harness.calls.clipboardWrites, [{
    text: "图5000",
    html: `<span data-paper-image-reference="true" data-image-id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" data-image-number="5000" data-missing="false" data-source-document-id="${documentId}">图5000</span>`,
  }]);

  assert.deepEqual(
    await write({}, { documentId: "not-a-uuid", imageId, number: -5 }),
    { ok: false, message: "图片引用身份无效" },
  );
  assert.equal(harness.calls.clipboardWrites.length, 1);
});

test("external opening allows only bounded HTTP, HTTPS, and mailto URLs", async () => {
  const harness = createHarness();
  const open = harness.handlers.get("external:open");

  assert.deepEqual(
    await open({}, "https://example.com/path?q=1"),
    { ok: true },
  );
  assert.deepEqual(
    await open({}, "mailto:editor@example.com"),
    { ok: true },
  );
  assert.deepEqual(
    await open({}, `https://example.com/${"x".repeat(8192)}`),
    { ok: false, error: "url-too-long" },
  );
  assert.deepEqual(
    await open({}, "file:///C:/private.txt"),
    { ok: false, error: "unsupported-protocol" },
  );
  assert.deepEqual(
    await open({}, "not a URL"),
    { ok: false, error: "invalid-url" },
  );
  assert.deepEqual(harness.calls.openExternal, [
    "https://example.com/path?q=1",
    "mailto:editor@example.com",
  ]);
});

test("external open maps native shell failures without leaking exceptions", async () => {
  const harness = createHarness({
    openExternalError: new Error("native failure"),
  });
  assert.deepEqual(
    await harness.handlers.get("external:open")({}, "https://example.com"),
    { ok: false, error: "invalid-url" },
  );
});

test("main delegates resource handlers through the shared assets facade", async () => {
  const source = await fsPromises.readFile(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(source, /require\("\.\/resource-ipc\.cjs"\)/);
  assert.match(source, /registerResourceIpcHandlers\(\{/);
  assert.match(source, /registerResourceIpcHandlers\(\{[\s\S]*assetsFacade,/);
  assert.doesNotMatch(
    source,
    /ipcMain\.handle\("(?:asset:pick-(?:image|audio|video)|clipboard:write-(?:content|image-reference)|external:open)"/,
  );
});
