const http = require("node:http");
const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");

const DICTIONARY_FILENAME = "en-US-10-1.bdic";
const DICTIONARY_BYTES = 451_968;
const DICTIONARY_SHA256 =
  "a075b01d9b015c616511a9e87da77da3d9881621db32f584e4606ddabf1c1100";
const FAIL_CLOSED_DICTIONARY_URL = "http://127.0.0.1:9/";
const SUPPORTED_PATHS = new Set([
  "/en-us.bdic",
  "/en-us-10-1.bdic",
]);

function createOfflineDictionaryRuntime({
  dictionaryPath,
  readFile = fs.readFile,
  createServer = http.createServer,
} = {}) {
  if (!dictionaryPath) {
    throw new TypeError("缺少离线词典路径");
  }

  let server = null;
  let dictionaryUrl = "";
  let startPromise = null;

  async function loadVerifiedDictionary() {
    const buffer = await readFile(dictionaryPath);
    if (!Buffer.isBuffer(buffer) || buffer.length !== DICTIONARY_BYTES) {
      throw new Error("离线词典大小校验失败");
    }
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (digest !== DICTIONARY_SHA256) {
      throw new Error("离线词典完整性校验失败");
    }
    return buffer;
  }

  function sendText(response, statusCode, message) {
    const body = Buffer.from(message, "utf8");
    response.writeHead(statusCode, {
      "Cache-Control": "no-store",
      "Content-Length": body.length,
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  }

  function createRequestHandler(dictionaryBuffer) {
    return (request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        sendText(response, 405, "Method Not Allowed");
        return;
      }

      let requestUrl;
      const rawUrl = String(request.url || "");
      if (
        rawUrl.includes("..")
        || rawUrl.includes("\\")
        || /%(?:2e|2f|5c)/i.test(rawUrl)
      ) {
        sendText(response, 404, "Not Found");
        return;
      }
      try {
        requestUrl = new URL(
          rawUrl,
          "http://127.0.0.1/",
        );
      } catch {
        sendText(response, 400, "Bad Request");
        return;
      }
      if (
        requestUrl.search
        || !SUPPORTED_PATHS.has(requestUrl.pathname.toLowerCase())
      ) {
        sendText(response, 404, "Not Found");
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": dictionaryBuffer.length,
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : dictionaryBuffer);
    };
  }

  async function startServer() {
    const dictionaryBuffer = await loadVerifiedDictionary();
    const candidate = createServer(
      createRequestHandler(dictionaryBuffer),
    );
    candidate.unref?.();

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        candidate.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        candidate.removeListener("error", onError);
        resolve();
      };
      candidate.once("error", onError);
      candidate.once("listening", onListening);
      candidate.listen(0, "127.0.0.1");
    }).catch((error) => {
      candidate.close?.();
      throw error;
    });

    const address = candidate.address();
    if (!address || typeof address === "string" || !address.port) {
      candidate.close?.();
      throw new Error("无法确定离线词典服务地址");
    }
    server = candidate;
    dictionaryUrl = `http://127.0.0.1:${address.port}/`;
    return dictionaryUrl;
  }

  async function start() {
    if (dictionaryUrl) return dictionaryUrl;
    if (!startPromise) {
      startPromise = startServer().finally(() => {
        startPromise = null;
      });
    }
    return startPromise;
  }

  async function stop() {
    if (startPromise) {
      await startPromise.catch(() => undefined);
    }
    const activeServer = server;
    server = null;
    dictionaryUrl = "";
    if (!activeServer) return;
    await new Promise((resolve) => {
      activeServer.close(() => resolve());
      activeServer.closeAllConnections?.();
    });
  }

  return Object.freeze({
    start,
    stop,
  });
}

module.exports = {
  DICTIONARY_BYTES,
  DICTIONARY_FILENAME,
  DICTIONARY_SHA256,
  FAIL_CLOSED_DICTIONARY_URL,
  createOfflineDictionaryRuntime,
};
