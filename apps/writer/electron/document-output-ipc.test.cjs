const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
  registerDocumentOutputIpcHandlers,
} = require("./document-output-ipc.cjs");

const OUTPUT_CHANNELS = [
  "document:export-page-images",
  "document:export-pdf",
  "document:pick-export-path",
];

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function createHarness(options = {}) {
  const handlers = new Map();
  const calls = {
    atomicWrites: [],
    debuggerAttach: [],
    debuggerDetach: 0,
    debuggerCommands: [],
    ensuredExtensions: [],
    interchangePicks: [],
    mkdirs: [],
    outputPicks: [],
    printToPdf: [],
    progress: [],
    sanitizedNames: [],
    targetConsumes: [],
  };
  let debuggerAttached = Boolean(options.debuggerAttached);
  const debuggerApi = {
    isAttached() {
      return debuggerAttached;
    },
    attach(version) {
      calls.debuggerAttach.push(version);
      debuggerAttached = true;
    },
    detach() {
      calls.debuggerDetach += 1;
      debuggerAttached = false;
    },
    async sendCommand(command, params) {
      calls.debuggerCommands.push([command, params]);
      if (options.debuggerError && command === options.debuggerError.command) {
        throw options.debuggerError.error;
      }
      if (command === "Page.captureScreenshot") {
        return {
          data: Buffer.from(
            `capture:${params.clip.x},${params.clip.y},${params.clip.width},${params.clip.height}`,
          ).toString("base64"),
        };
      }
      return {};
    },
  };
  const mainWindow = {
    webContents: {
      debugger: debuggerApi,
      async printToPDF(value) {
        calls.printToPdf.push(value);
        if (options.printError) throw options.printError;
        return options.pdfBuffer || Buffer.from("pdf-bytes");
      },
    },
  };

  registerDocumentOutputIpcHandlers({
    ipcMain: {
      handle(channel, handler) {
        assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
        handlers.set(channel, handler);
      },
    },
    async pickInterchangeExportPath(...args) {
      calls.interchangePicks.push(args);
      return hasOwn(options, "interchangePath")
        ? options.interchangePath
        : "C:\\exports\\draft.md";
    },
    async pickDocumentExportPath(...args) {
      calls.outputPicks.push(args);
      if (hasOwn(options, "outputDestination")) {
        return options.outputDestination;
      }
      const format = args[0];
      return format === "images"
        ? { canceled: false, path: "C:\\exports\\pages", format: "images" }
        : { canceled: false, path: "C:\\exports\\draft.pdf", format: "pdf" };
    },
    exportSafeName(value) {
      return `safe-${value}`;
    },
    sendExportProgress(...args) {
      calls.progress.push(args);
    },
    sanitizeFilesystemName(...args) {
      calls.sanitizedNames.push(args);
      return `safe-${args[0]}`;
    },
    ensureExtension(filePath, extension) {
      calls.ensuredExtensions.push([filePath, extension]);
      return filePath.toLowerCase().endsWith(extension)
        ? filePath
        : `${filePath}${extension}`;
    },
    consumeExportTarget(...args) {
      calls.targetConsumes.push(args);
      if (options.consumeError) throw options.consumeError;
      return hasOwn(options, "consumedTarget")
        ? options.consumedTarget
        : args[0];
    },
    getMainWindow() {
      return mainWindow;
    },
    async atomicWriteFile(...args) {
      calls.atomicWrites.push(args);
      if (options.writeError) throw options.writeError;
    },
    fs: {
      async mkdir(...args) {
        calls.mkdirs.push(args);
      },
    },
    path,
  });

  return {
    calls,
    debuggerApi,
    handlers,
    mainWindow,
  };
}

test("registers exactly the document output IPC surface", () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()].sort(), OUTPUT_CHANNELS);
});

test("export picker preserves editable formats and PDF/images capability selection", async () => {
  const harness = createHarness();
  const pick = harness.handlers.get("document:pick-export-path");

  assert.deepEqual(
    await pick({}, "markdown", "Draft", "C:\\remembered"),
    {
      canceled: false,
      path: "C:\\exports\\draft.md",
      directory: "C:\\exports",
      format: "markdown",
    },
  );
  assert.deepEqual(harness.calls.interchangePicks, [[
    "markdown",
    "Draft",
    "C:\\remembered",
  ]]);

  assert.deepEqual(
    await pick({}, "images", "Draft", "C:\\remembered"),
    { canceled: false, path: "C:\\exports\\pages", format: "images" },
  );
  assert.deepEqual(
    await pick({}, "unexpected", "Draft", "C:\\remembered"),
    { canceled: false, path: "C:\\exports\\draft.pdf", format: "pdf" },
  );
  assert.deepEqual(harness.calls.outputPicks, [
    ["images", "Draft", "C:\\remembered"],
    ["pdf", "Draft", "C:\\remembered"],
  ]);

  const canceled = createHarness({ interchangePath: "" });
  assert.deepEqual(
    await canceled.handlers.get("document:pick-export-path")(
      {},
      "docx",
      "Draft",
      "",
    ),
    { canceled: true },
  );
});

test("PDF export consumes one capability, prints exact options, atomically writes, and reports progress", async () => {
  const harness = createHarness({
    consumedTarget: "C:\\authorized\\draft.pdf",
  });
  const event = { sender: { id: "renderer" }, frameId: 1 };

  assert.deepEqual(
    await harness.handlers.get("document:export-pdf")(
      event,
      "Draft",
      "C:\\selected\\draft",
    ),
    { canceled: false, path: "C:\\authorized\\draft.pdf" },
  );
  assert.deepEqual(harness.calls.ensuredExtensions, [[
    "C:\\selected\\draft",
    ".pdf",
  ]]);
  assert.deepEqual(harness.calls.targetConsumes, [[
    "C:\\selected\\draft.pdf",
    "pdf",
  ]]);
  assert.deepEqual(harness.calls.printToPdf, [{
    printBackground: true,
    preferCSSPageSize: true,
    landscape: false,
    margins: { marginType: "none" },
  }]);
  assert.deepEqual(harness.calls.atomicWrites, [[
    "C:\\authorized\\draft.pdf",
    Buffer.from("pdf-bytes"),
  ]]);
  assert.deepEqual(harness.calls.progress, [
    [event, { format: "pdf", percent: 12, message: "正在整理信笺版面…" }],
    [event, { format: "pdf", percent: 78, message: "正在写入 PDF 文件…" }],
    [event, { format: "pdf", percent: 100, message: "PDF 导出完成" }],
  ]);
});

test("PDF export cancellation never consumes a capability or prints", async () => {
  const harness = createHarness({
    outputDestination: { canceled: true },
  });
  assert.deepEqual(
    await harness.handlers.get("document:export-pdf")({}, "Draft"),
    { canceled: true },
  );
  assert.deepEqual(harness.calls.outputPicks, [["pdf", "safe-Draft"]]);
  assert.deepEqual(harness.calls.targetConsumes, []);
  assert.deepEqual(harness.calls.printToPdf, []);
});

test("page image export rejects count, rectangle, and aggregate pixel abuse before capability use", async () => {
  const tooMany = createHarness();
  await assert.rejects(
    tooMany.handlers.get("document:export-page-images")(
      {},
      "Draft",
      Array.from({ length: 501 }, () => ({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      })),
      "C:\\pages",
    ),
    /分页图片数量过多，已拒绝导出/,
  );
  assert.deepEqual(tooMany.calls.targetConsumes, []);

  const invalid = createHarness();
  assert.deepEqual(
    await invalid.handlers.get("document:export-page-images")(
      {},
      "Draft",
      [
        { x: -1, y: 0, width: 100, height: 100 },
        { x: 0, y: 0, width: 10001, height: 100 },
        { x: 0, y: 0, width: 100, height: 8001 },
        { x: "bad", y: 0, width: 100, height: 100 },
      ],
      "C:\\pages",
    ),
    { canceled: true },
  );
  assert.deepEqual(invalid.calls.targetConsumes, []);

  const tooLarge = createHarness();
  await assert.rejects(
    tooLarge.handlers.get("document:export-page-images")(
      {},
      "Draft",
      Array.from({ length: 7 }, () => ({
        x: 0,
        y: 0,
        width: 10000,
        height: 8000,
      })),
      "C:\\pages",
    ),
    /分页图片总像素过大，请减少内容后重试/,
  );
  assert.deepEqual(tooLarge.calls.targetConsumes, []);
});

test("page image export captures bounded clips, writes in order, and detaches its debugger", async () => {
  const harness = createHarness({
    consumedTarget: "C:\\authorized\\pages",
  });
  const event = { sender: { id: "renderer" }, frameId: 1 };
  const rects = [
    { x: "1", y: "2", width: "300", height: "400" },
    { x: 10, y: 20, width: 500, height: 600 },
  ];

  assert.deepEqual(
    await harness.handlers.get("document:export-page-images")(
      event,
      "Draft",
      rects,
      "C:\\selected\\pages",
    ),
    {
      canceled: false,
      path: "C:\\authorized\\pages",
      files: [
        "C:\\authorized\\pages\\safe-Draft-01.png",
        "C:\\authorized\\pages\\safe-Draft-02.png",
      ],
      count: 2,
    },
  );
  assert.deepEqual(harness.calls.targetConsumes, [[
    "C:\\selected\\pages",
    "images",
  ]]);
  assert.deepEqual(harness.calls.mkdirs, [[
    "C:\\authorized\\pages",
    { recursive: true },
  ]]);
  assert.deepEqual(harness.calls.debuggerAttach, ["1.3"]);
  assert.equal(harness.calls.debuggerDetach, 1);
  assert.deepEqual(harness.calls.debuggerCommands, [
    ["Page.enable", undefined],
    ["Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 1, y: 2, width: 300, height: 400, scale: 1 },
    }],
    ["Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 10, y: 20, width: 500, height: 600, scale: 1 },
    }],
  ]);
  assert.deepEqual(
    harness.calls.atomicWrites.map(([filePath, buffer]) => [
      filePath,
      buffer.toString(),
    ]),
    [
      [
        "C:\\authorized\\pages\\safe-Draft-01.png",
        "capture:1,2,300,400",
      ],
      [
        "C:\\authorized\\pages\\safe-Draft-02.png",
        "capture:10,20,500,600",
      ],
    ],
  );
  assert.deepEqual(harness.calls.progress, [
    [
      event,
      {
        format: "images",
        percent: 8,
        message: "正在准备 2 张分页图片…",
      },
    ],
    [
      event,
      {
        format: "images",
        percent: 14,
        message: "已准备图像渲染环境",
      },
    ],
    [
      event,
      {
        format: "images",
        percent: 57,
        message: "正在导出第 1 / 2 张图片",
        completed: 1,
        total: 2,
      },
    ],
    [
      event,
      {
        format: "images",
        percent: 100,
        message: "正在导出第 2 / 2 张图片",
        completed: 2,
        total: 2,
      },
    ],
  ]);
});

test("page image export leaves an existing debugger attached and detaches its own on failure", async () => {
  const existing = createHarness({ debuggerAttached: true });
  await existing.handlers.get("document:export-page-images")(
    {},
    "Draft",
    [{ x: 0, y: 0, width: 100, height: 100 }],
    "C:\\pages",
  );
  assert.deepEqual(existing.calls.debuggerAttach, []);
  assert.equal(existing.calls.debuggerDetach, 0);

  const failed = createHarness({
    debuggerError: {
      command: "Page.captureScreenshot",
      error: new Error("capture failed"),
    },
  });
  await assert.rejects(
    failed.handlers.get("document:export-page-images")(
      {},
      "Draft",
      [{ x: 0, y: 0, width: 100, height: 100 }],
      "C:\\pages",
    ),
    /capture failed/,
  );
  assert.equal(failed.calls.debuggerDetach, 1);
});

test("main delegates output handlers and trusted registrar remains their sender/frame gate", async () => {
  const source = await fsPromises.readFile(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(source, /require\("\.\/document-output-ipc\.cjs"\)/);
  assert.match(source, /registerDocumentOutputIpcHandlers\(\{/);
  assert.match(source, /pickDocumentExportPath,/);
  assert.match(source, /consumeExportTarget,/);
  assert.match(source, /getMainWindow:\s*\(\)\s*=>\s*mainWindow/);
  assert.match(source, /const ipcMain = createTrustedIpcRegistrar\(\{/);
  assert.doesNotMatch(
    source,
    /ipcMain\.handle\("document:(?:pick-export-path|export-pdf|export-page-images)"/,
  );
});
