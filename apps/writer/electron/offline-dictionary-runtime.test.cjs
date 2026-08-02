const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const {
  DICTIONARY_BYTES,
  DICTIONARY_FILENAME,
  DICTIONARY_SHA256,
  FAIL_CLOSED_DICTIONARY_URL,
  createOfflineDictionaryRuntime,
} = require("./offline-dictionary-runtime.cjs");

const dictionaryPath = path.join(
  __dirname,
  "assets",
  "dictionaries",
  DICTIONARY_FILENAME,
);

function request(url, { method = "GET", pathName = "" } = {}) {
  return new Promise((resolve, reject) => {
    const base = new URL(url);
    const requestValue = http.request({
      hostname: base.hostname,
      method,
      path: pathName || base.pathname,
      port: base.port,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        statusCode: response.statusCode,
      }));
    });
    requestValue.once("error", reject);
    requestValue.end();
  });
}

test("bundled English dictionary has the pinned Electron release digest", async () => {
  const dictionary = await fs.readFile(dictionaryPath);
  assert.equal(dictionary.length, DICTIONARY_BYTES);
  assert.equal(
    createHash("sha256").update(dictionary).digest("hex"),
    DICTIONARY_SHA256,
  );
});

test("offline dictionary server exposes only bounded loopback aliases", async (t) => {
  const runtime = createOfflineDictionaryRuntime({ dictionaryPath });
  t.after(() => runtime.stop());
  const baseUrl = await runtime.start();
  assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.notEqual(baseUrl, FAIL_CLOSED_DICTIONARY_URL);
  assert.equal(await runtime.start(), baseUrl);

  const primary = await request(baseUrl, {
    pathName: "/en-US.bdic",
  });
  assert.equal(primary.statusCode, 200);
  assert.equal(primary.body.length, DICTIONARY_BYTES);
  assert.equal(
    createHash("sha256").update(primary.body).digest("hex"),
    DICTIONARY_SHA256,
  );
  assert.equal(primary.headers["content-type"], "application/octet-stream");

  const versioned = await request(baseUrl, {
    pathName: "/EN-us-10-1.bdic",
  });
  assert.equal(versioned.statusCode, 200);
  assert.equal(versioned.body.length, DICTIONARY_BYTES);

  const head = await request(baseUrl, {
    method: "HEAD",
    pathName: "/en-US.bdic",
  });
  assert.equal(head.statusCode, 200);
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers["content-length"]), DICTIONARY_BYTES);

  assert.equal((await request(baseUrl, {
    pathName: "/fr-FR.bdic",
  })).statusCode, 404);
  assert.equal((await request(baseUrl, {
    pathName: "/en-US.bdic?remote=1",
  })).statusCode, 404);
  assert.equal((await request(baseUrl, {
    pathName: "/%2e%2e/en-US.bdic",
  })).statusCode, 404);
  assert.equal((await request(baseUrl, {
    method: "POST",
    pathName: "/en-US.bdic",
  })).statusCode, 405);
});

test("offline dictionary server refuses an unverified payload", async () => {
  const runtime = createOfflineDictionaryRuntime({
    dictionaryPath,
    readFile: async () => Buffer.from("not a Chromium dictionary"),
  });
  await assert.rejects(runtime.start(), /大小校验失败/);
  await runtime.stop();
});

test("main configures the local URL before enabling spell-check languages", async () => {
  const mainSource = await fs.readFile(
    path.join(__dirname, "main.cjs"),
    "utf8",
  );
  const downloadUrlIndex = mainSource.indexOf(
    "setSpellCheckerDictionaryDownloadURL",
  );
  const initializeIndex = mainSource.indexOf(
    "writingAssistanceRuntime.initialize",
  );
  assert.ok(downloadUrlIndex >= 0);
  assert.ok(initializeIndex > downloadUrlIndex);
  assert.match(mainSource, /offlineDictionaryRuntime\.stop\(\)/);
});
