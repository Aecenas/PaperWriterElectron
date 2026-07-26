const path = require("node:path");
const { Worker } = require("node:worker_threads");

const RESEARCH_SEARCH_WORKER_PATH = path.join(
  __dirname,
  "research-search-worker.cjs",
);

function abortError(message = "资料搜索已取消") {
  const error = new Error(message);
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

function safeWorkerError(value) {
  const error = new Error(
    String(value?.message || "资料全文提取失败").slice(0, 2000),
  );
  error.code = String(value?.code || "EXTRACTION_FAILED").slice(0, 128);
  return error;
}

function exactTransferBuffer(value) {
  const source = Buffer.isBuffer(value)
    ? value
    : Buffer.from(value instanceof Uint8Array ? value : value || []);
  const copy = new Uint8Array(source.length);
  copy.set(source);
  return copy.buffer;
}

function runResearchExtractionWorker(
  payload,
  {
    signal,
    onProgress,
    WorkerApi = Worker,
    workerPath = RESEARCH_SEARCH_WORKER_PATH,
  } = {},
) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const worker = new WorkerApi(workerPath);
    let settled = false;
    const finish = async (error, result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", handleAbort);
      worker.removeAllListeners?.();
      await worker.terminate?.().catch?.(() => {});
      if (error) reject(error);
      else resolve(result);
    };
    const handleAbort = () => {
      void finish(abortError());
    };
    signal?.addEventListener?.("abort", handleAbort, { once: true });
    worker.once("error", (error) => {
      void finish(error);
    });
    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        void finish(new Error(`资料全文提取进程异常退出（${code}）`));
      }
    });
    worker.on("message", (message = {}) => {
      if (settled) return;
      if (message.type === "progress") {
        onProgress?.(message.progress || {});
        return;
      }
      if (message.type === "error") {
        void finish(safeWorkerError(message.error));
        return;
      }
      if (message.type === "result") {
        void finish(null, message.result || {});
      }
    });
    const transferBuffer = exactTransferBuffer(payload?.bytes);
    worker.postMessage(
      {
        ...payload,
        bytes: transferBuffer,
      },
      [transferBuffer],
    );
  });
}

function normalizeAuthors(source) {
  const authors = Array.isArray(source?.bibliographic?.authors)
    ? source.bibliographic.authors
    : [];
  return authors
    .map((author) => String(author || "").trim())
    .filter(Boolean)
    .join("；")
    .slice(0, 10_000);
}

function createResearchFileExtractor({
  library,
  readSearchDocument,
  htmlToSearchText,
  decodePreviewText,
  worker = runResearchExtractionWorker,
} = {}) {
  if (!library) throw new Error("缺少资料库读取能力");
  if (typeof readSearchDocument !== "function") {
    throw new Error("缺少笺间文档全文提取能力");
  }
  if (typeof htmlToSearchText !== "function") {
    throw new Error("缺少 HTML 文字提取能力");
  }
  if (typeof decodePreviewText !== "function") {
    throw new Error("缺少资料文本解码能力");
  }

  return async function extractResearchFile(
    libraryId,
    entry,
    {
      maxCharacters = 2_000_000,
      maxPdfPages = 2000,
      signal,
      onProgress,
    } = {},
  ) {
    if (signal?.aborted) throw abortError();
    const previewKind = String(entry?.previewKind || "unsupported");
    if (previewKind === "document") {
      const resolved = await library.copyEntryPath(
        libraryId,
        entry.relativePath,
      );
      if (signal?.aborted) throw abortError();
      const document = await readSearchDocument(resolved.path);
      const body = htmlToSearchText(document?.html || "");
      return {
        title: String(document?.title || "").slice(0, 500),
        author: String(document?.author || "").slice(0, 500),
        body: body.slice(0, maxCharacters),
        pages: [],
        truncated: body.length > maxCharacters,
        diskRevision: null,
        warnings: [],
      };
    }

    if (previewKind === "pdf") {
      const snapshot = await library.readPdf(
        libraryId,
        entry.relativePath,
      );
      if (signal?.aborted) throw abortError();
      const extracted = await worker(
        {
          kind: "pdf",
          bytes: snapshot.bytes,
          limits: {
            maxCharacters,
            maxPdfPages,
            maxInputBytes: 128 * 1024 * 1024,
          },
        },
        { signal, onProgress },
      );
      return {
        title: "",
        author: "",
        body: String(extracted?.body || ""),
        pages: Array.isArray(extracted?.pages) ? extracted.pages : [],
        truncated: Boolean(extracted?.truncated),
        diskRevision: snapshot.diskRevision || null,
        warnings: Array.isArray(extracted?.warnings)
          ? extracted.warnings
          : [],
      };
    }

    if (previewKind === "docx") {
      const snapshot = await library.readPreview(
        libraryId,
        entry.relativePath,
      );
      if (signal?.aborted) throw abortError();
      const extracted = await worker(
        {
          kind: "docx",
          bytes: snapshot.bytes,
          limits: {
            maxCharacters,
            maxInputBytes: 64 * 1024 * 1024,
          },
        },
        { signal, onProgress },
      );
      return {
        title: "",
        author: "",
        body: String(extracted?.body || ""),
        pages: [],
        truncated: Boolean(extracted?.truncated),
        diskRevision: snapshot.diskRevision || null,
        warnings: Array.isArray(extracted?.warnings)
          ? extracted.warnings
          : [],
      };
    }

    if (["markdown", "text", "table"].includes(previewKind)) {
      const snapshot = await library.readPreview(
        libraryId,
        entry.relativePath,
      );
      if (signal?.aborted) throw abortError();
      const body = decodePreviewText(snapshot.bytes);
      return {
        title: "",
        author: "",
        body: String(body || "").slice(0, maxCharacters),
        pages: [],
        truncated: String(body || "").length > maxCharacters,
        diskRevision: snapshot.diskRevision || null,
        warnings: [],
      };
    }

    return {
      title: "",
      author: "",
      body: "",
      pages: [],
      truncated: false,
      diskRevision: null,
      warnings: [],
    };
  };
}

module.exports = {
  RESEARCH_SEARCH_WORKER_PATH,
  abortError,
  createResearchFileExtractor,
  normalizeAuthors,
  runResearchExtractionWorker,
};
