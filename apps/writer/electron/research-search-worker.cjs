const { isMainThread, parentPort } = require("node:worker_threads");

const mammoth = require("mammoth");

const {
  preflightZipBuffer,
} = require("./document-storage.cjs");

const DEFAULT_WORKER_LIMITS = Object.freeze({
  maxCharacters: 2_000_000,
  maxPdfPages: 2000,
  maxDocxEntries: 10_000,
  maxDocxExpandedBytes: 256 * 1024 * 1024,
  maxDocxCompressionRatio: 300,
  maxInputBytes: 128 * 1024 * 1024,
});

function resolveWorkerLimits(value = {}) {
  const resolved = { ...DEFAULT_WORKER_LIMITS, ...(value || {}) };
  for (const [name, fallback] of Object.entries(DEFAULT_WORKER_LIMITS)) {
    if (!Number.isSafeInteger(resolved[name]) || resolved[name] <= 0) {
      resolved[name] = fallback;
    }
  }
  return resolved;
}

function boundedWorkerText(value, maximum) {
  const source = String(value || "");
  return source.length <= maximum ? source : source.slice(0, maximum);
}

function normalizeWorkerBytes(value, maximum) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(value instanceof Uint8Array ? value : value || []);
  if (bytes.length > maximum) {
    throw new Error("资料文件超过全文索引读取上限");
  }
  return bytes;
}

function pdfNeedsWordSeparator(left, right) {
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

function normalizePdfPageItems(items) {
  let text = "";
  for (const item of Array.isArray(items) ? items : []) {
    const value = String(item?.str || "");
    if (!value) {
      if (item?.hasEOL && text && !text.endsWith("\n")) text += "\n";
      continue;
    }
    if (text && !text.endsWith("\n") && pdfNeedsWordSeparator(text, value)) {
      text += " ";
    }
    text += value;
    if (item?.hasEOL && !text.endsWith("\n")) text += "\n";
  }
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

async function extractPdfText(bytes, limits, onProgress = () => {}) {
  const input = normalizeWorkerBytes(bytes, limits.maxInputBytes);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(
      input.buffer,
      input.byteOffset,
      input.byteLength,
    ),
    isEvalSupported: false,
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  let document = null;
  try {
    document = await loadingTask.promise;
    const pageCount = Math.min(document.numPages, limits.maxPdfPages);
    const pages = [];
    let body = "";
    let truncated = document.numPages > pageCount;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (body.length >= limits.maxCharacters) {
        truncated = true;
        break;
      }
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const remaining = Math.max(0, limits.maxCharacters - body.length);
      const pageText = boundedWorkerText(
        normalizePdfPageItems(content.items),
        remaining,
      );
      const start = body.length;
      if (body && pageText) body += "\n";
      const contentStart = body.length;
      body += pageText;
      pages.push({
        page: pageNumber,
        start: contentStart,
        end: body.length,
      });
      if (pageText.length >= remaining && pageText.length > 0) truncated = true;
      onProgress({
        completed: pageNumber,
        total: pageCount,
        page: pageNumber,
      });
      page.cleanup?.();
      if (body.length === start && !pageText) {
        // Keep the page represented without spending the character budget.
        pages[pages.length - 1].start = body.length;
        pages[pages.length - 1].end = body.length;
      }
    }
    return {
      body,
      pages,
      truncated,
      pageCount: document.numPages,
      warnings: [],
    };
  } finally {
    await document?.destroy?.().catch?.(() => {});
    await loadingTask.destroy?.().catch?.(() => {});
  }
}

async function extractDocxText(bytes, limits) {
  const input = normalizeWorkerBytes(bytes, limits.maxInputBytes);
  preflightZipBuffer(input, {
    limits: {
      maxArchiveBytes: limits.maxInputBytes,
      maxEntries: limits.maxDocxEntries,
      maxExpandedBytes: limits.maxDocxExpandedBytes,
      maxArchiveRatio: limits.maxDocxCompressionRatio,
    },
  });
  const converted = await mammoth.extractRawText({ buffer: input });
  const source = String(converted?.value || "");
  return {
    body: boundedWorkerText(source, limits.maxCharacters),
    pages: [],
    truncated: source.length > limits.maxCharacters,
    pageCount: 0,
    warnings: (converted?.messages || []).slice(0, 50).map((message) => ({
      type: String(message?.type || "warning").slice(0, 32),
      message: String(message?.message || "").slice(0, 1000),
    })),
  };
}

async function runWorkerTask(payload = {}, onProgress = () => {}) {
  const limits = resolveWorkerLimits(payload.limits);
  if (payload.kind === "pdf") {
    return extractPdfText(payload.bytes, limits, onProgress);
  }
  if (payload.kind === "docx") {
    return extractDocxText(payload.bytes, limits);
  }
  throw new Error("不支持的资料全文提取类型");
}

if (!isMainThread && parentPort) {
  parentPort.once("message", async (payload = {}) => {
    try {
      const result = await runWorkerTask(payload, (progress) => {
        parentPort.postMessage({ type: "progress", progress });
      });
      parentPort.postMessage({ type: "result", result });
    } catch (error) {
      parentPort.postMessage({
        type: "error",
        error: {
          code: String(error?.code || "EXTRACTION_FAILED").slice(0, 128),
          message: String(error?.message || "资料全文提取失败").slice(0, 2000),
        },
      });
    }
  });
}

module.exports = {
  DEFAULT_WORKER_LIMITS,
  extractDocxText,
  extractPdfText,
  normalizePdfPageItems,
  resolveWorkerLimits,
  runWorkerTask,
};
