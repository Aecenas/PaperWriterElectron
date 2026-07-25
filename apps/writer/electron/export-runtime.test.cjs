const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const {
  createExportRuntime,
} = require("./export-runtime.cjs");

function createHarness(options = {}) {
  let currentTime = Object.hasOwn(options, "now") ? options.now : 1_000_000;
  const mainWindow = { id: "main-window" };
  const saveDialogResults = [...(options.saveDialogResults || [])];
  const openDialogResults = [...(options.openDialogResults || [])];
  const calls = {
    ensuredExtensions: [],
    openDialogs: [],
    sanitizedNames: [],
    saveDialogs: [],
    stats: [],
  };
  const directories = new Set(options.directories || ["C:\\remembered"]);
  const runtime = createExportRuntime({
    path,
    fs: {
      async stat(filePath) {
        calls.stats.push(filePath);
        if (options.statError) throw options.statError;
        return {
          isDirectory: () => directories.has(filePath),
        };
      },
    },
    dialog: {
      async showSaveDialog(...args) {
        calls.saveDialogs.push(args);
        return saveDialogResults.shift() || { canceled: true };
      },
      async showOpenDialog(...args) {
        calls.openDialogs.push(args);
        return openDialogResults.shift() || { canceled: true };
      },
    },
    getMainWindow() {
      return mainWindow;
    },
    defaultDocumentsDir() {
      return "C:\\Documents";
    },
    ensureExtension(filePath, extension) {
      calls.ensuredExtensions.push([filePath, extension]);
      return filePath.toLowerCase().endsWith(extension)
        ? filePath
        : `${filePath}${extension}`;
    },
    sanitizeFilesystemName(...args) {
      calls.sanitizedNames.push(args);
      return `safe-${args[0] || args[1]}`;
    },
    platform: options.platform || "win32",
    now() {
      return currentTime;
    },
  });

  return {
    advance(milliseconds) {
      currentTime += milliseconds;
    },
    calls,
    mainWindow,
    resetTime(value) {
      currentTime = value;
    },
    runtime,
  };
}

test("capabilities bind kind plus normalized path and are single-consume on Windows", () => {
  const harness = createHarness();
  const authorized = harness.runtime.authorizeExportTarget(
    "C:\\Exports\\Draft.PDF",
    "pdf",
  );
  assert.equal(authorized, "C:\\Exports\\Draft.PDF");

  assert.throws(
    () => harness.runtime.consumeExportTarget(
      "C:\\EXPORTS\\draft.pdf",
      "images",
    ),
    /导出位置授权已失效，请重新选择保存位置/,
  );
  assert.equal(
    harness.runtime.consumeExportTarget("C:\\EXPORTS\\draft.pdf", "pdf"),
    "C:\\EXPORTS\\draft.pdf",
  );
  assert.throws(
    () => harness.runtime.consumeExportTarget(
      "C:\\Exports\\Draft.PDF",
      "pdf",
    ),
    /导出位置授权已失效，请重新选择保存位置/,
  );
});

test("capability TTL is exactly 30 minutes and expired consume deletes before checking age", () => {
  const harness = createHarness({ now: 0 });
  harness.runtime.authorizeExportTarget("C:\\exports\\draft.pdf", "pdf");
  harness.advance(30 * 60 * 1000);
  assert.equal(
    harness.runtime.consumeExportTarget("C:\\exports\\draft.pdf", "pdf"),
    "C:\\exports\\draft.pdf",
  );

  harness.runtime.authorizeExportTarget("C:\\exports\\expired.pdf", "pdf");
  harness.advance((30 * 60 * 1000) + 1);
  assert.throws(
    () => harness.runtime.consumeExportTarget(
      "C:\\exports\\expired.pdf",
      "pdf",
    ),
    /导出位置授权已失效，请重新选择保存位置/,
  );
  harness.resetTime(1);
  assert.throws(
    () => harness.runtime.consumeExportTarget(
      "C:\\exports\\expired.pdf",
      "pdf",
    ),
    /导出位置授权已失效，请重新选择保存位置/,
  );
});

test("interchange picker preserves formats, remembered directory, filters, extension, and capability", async () => {
  const harness = createHarness({
    saveDialogResults: [{
      canceled: false,
      filePath: "C:\\chosen\\Draft",
    }],
  });

  assert.equal(
    await harness.runtime.pickInterchangeExportPath(
      "markdown",
      "Draft",
      "  C:\\remembered  ",
    ),
    "C:\\chosen\\Draft.md",
  );
  assert.deepEqual(harness.calls.stats, ["C:\\remembered"]);
  assert.deepEqual(harness.calls.sanitizedNames, [[
    "Draft",
    "未命名信笺",
    60,
  ]]);
  assert.deepEqual(harness.calls.saveDialogs, [[
    harness.mainWindow,
    {
      title: "导出 Markdown",
      defaultPath: "C:\\remembered\\safe-Draft.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    },
  ]]);
  assert.deepEqual(harness.calls.ensuredExtensions, [[
    "C:\\chosen\\Draft",
    ".md",
  ]]);
  assert.equal(
    harness.runtime.consumeExportTarget("C:\\CHOSEN\\draft.md", "markdown"),
    "C:\\CHOSEN\\draft.md",
  );
});

test("interchange picker rejects unsupported formats and ignores unsafe or missing remembered directories", async () => {
  const harness = createHarness({
    saveDialogResults: [{ canceled: true }],
  });
  await assert.rejects(
    harness.runtime.pickInterchangeExportPath("pdf", "Draft"),
    /不支持的可编辑导出格式/,
  );
  assert.deepEqual(harness.calls.saveDialogs, []);

  assert.equal(
    await harness.runtime.pickInterchangeExportPath(
      "html",
      "Draft",
      "relative\\directory",
    ),
    "",
  );
  assert.deepEqual(harness.calls.stats, []);
  assert.equal(
    harness.calls.saveDialogs[0][1].defaultPath,
    "C:\\Documents\\safe-Draft.html",
  );
});

test("image picker preserves directory memory, native options, and images capability", async () => {
  const harness = createHarness({
    openDialogResults: [{
      canceled: false,
      filePaths: ["C:\\chosen\\pages"],
    }],
  });

  assert.deepEqual(
    await harness.runtime.pickDocumentExportPath(
      "images",
      "Draft",
      "C:\\remembered",
    ),
    {
      canceled: false,
      path: "C:\\chosen\\pages",
      directory: "C:\\chosen\\pages",
      format: "images",
    },
  );
  assert.deepEqual(harness.calls.openDialogs, [[
    harness.mainWindow,
    {
      title: "选择分页图片导出文件夹",
      defaultPath: "C:\\remembered",
      properties: ["openDirectory", "createDirectory"],
    },
  ]]);
  assert.equal(
    harness.runtime.consumeExportTarget("C:\\CHOSEN\\PAGES", "images"),
    "C:\\CHOSEN\\PAGES",
  );
});

test("PDF picker preserves fallback directory, filters, extension, and PDF capability", async () => {
  const harness = createHarness({
    saveDialogResults: [{
      canceled: false,
      filePath: "C:\\chosen\\Draft",
    }],
  });

  assert.deepEqual(
    await harness.runtime.pickDocumentExportPath(
      "pdf",
      "Draft",
      "C:\\missing",
    ),
    {
      canceled: false,
      path: "C:\\chosen\\Draft.pdf",
      directory: "C:\\chosen",
      format: "pdf",
    },
  );
  assert.deepEqual(harness.calls.saveDialogs, [[
    harness.mainWindow,
    {
      title: "选择 PDF 导出位置",
      defaultPath: "C:\\Documents\\safe-Draft.pdf",
      filters: [
        { name: "PDF 文档", extensions: ["pdf"] },
        { name: "All Files", extensions: ["*"] },
      ],
    },
  ]]);
  assert.equal(
    harness.runtime.consumeExportTarget("C:\\chosen\\Draft.pdf", "pdf"),
    "C:\\chosen\\Draft.pdf",
  );
});

test("safe naming and progress preserve exact sanitization and sender lifecycle behavior", () => {
  const harness = createHarness();
  assert.equal(harness.runtime.exportSafeName("Draft<>"), "safe-Draft<>");
  assert.deepEqual(harness.calls.sanitizedNames, [[
    "Draft<>",
    "未命名信笺",
    60,
  ]]);

  const sent = [];
  const event = {
    sender: {
      isDestroyed: () => false,
      send(...args) {
        sent.push(args);
      },
    },
  };
  const payload = { format: "pdf", percent: 50 };
  harness.runtime.sendExportProgress(event, payload);
  harness.runtime.sendExportProgress({
    sender: {
      isDestroyed: () => true,
      send() {
        assert.fail("destroyed sender must not receive progress");
      },
    },
  }, payload);
  assert.throws(
    () => harness.runtime.sendExportProgress({}, payload),
    TypeError,
  );
  assert.deepEqual(sent, [[
    "document:export-progress",
    payload,
  ]]);
});

test("runtime owns TTL, private capability map, key normalization, and delete-before-expiry safety", async () => {
  const source = await fsPromises.readFile(
    path.join(__dirname, "export-runtime.cjs"),
    "utf8",
  );
  assert.match(source, /const EXPORT_CAPABILITY_TTL_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
  assert.match(source, /const exportCapabilities = new Map\(\)/);
  assert.match(source, /return `\$\{kind\}:\$\{pathKey\}`/);
  assert.match(source, /platform === "win32"[\s\S]*toLocaleLowerCase\("en-US"\)/);
  assert.match(
    source,
    /const expiresAt = exportCapabilities\.get\(key\) \|\| 0;[\s\S]*exportCapabilities\.delete\(key\);[\s\S]*if \(expiresAt < now\(\)\)/,
  );
});

test("main creates one export runtime and only adapts its narrow methods into registrars", async () => {
  const source = await fsPromises.readFile(path.join(__dirname, "main.cjs"), "utf8");
  const outputIpcSource = await fsPromises.readFile(
    path.join(__dirname, "document-output-ipc.cjs"),
    "utf8",
  );
  assert.match(source, /require\("\.\/export-runtime\.cjs"\)/);
  assert.equal((source.match(/createExportRuntime\(\{/g) || []).length, 1);
  assert.match(source, /const exportRuntime = createExportRuntime\(\{/);
  assert.doesNotMatch(source, /EXPORT_CAPABILITY_TTL_MS|exportCapabilities|function exportCapabilityKey/);
  assert.doesNotMatch(
    source,
    /function (?:authorizeExportTarget|consumeExportTarget|interchangeFormatExtension|existingExportPickerDirectory|pickInterchangeExportPath|exportSafeName|pickDocumentExportPath|sendExportProgress)/,
  );
  assert.match(
    source,
    /interchangeFormatExtension:\s*exportRuntime\.interchangeFormatExtension/,
  );
  assert.match(
    source,
    /pickDocumentExportPath:\s*exportRuntime\.pickDocumentExportPath/,
  );
  assert.doesNotMatch(outputIpcSource, /sanitizeFilesystemName/);
  assert.match(
    outputIpcSource,
    /const safeName = exportSafeName\(suggestedName\)/,
  );
});
