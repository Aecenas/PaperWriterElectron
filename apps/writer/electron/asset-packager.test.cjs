const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("jszip");
const { createAssetPackager, dataUrlToBuffer, extensionFromMime } = require("./asset-packager.cjs");

function nextAssetPath(zip, preferredPath, extension) {
  if (preferredPath && !zip.file(preferredPath)) return preferredPath;
  let index = 1;
  let candidate;
  do {
    candidate = `assets/image-${String(index++).padStart(4, "0")}${extension}`;
  } while (zip.file(candidate));
  return candidate;
}

test("packages staged, document and legacy data sources while deduplicating identical bytes", async () => {
  const stagedUrl = "paperwriter-asset://staged/11111111-1111-4111-8111-111111111111";
  const documentUrl = "paperwriter-asset://document/example.letterpaper?asset=assets%2Fold.gif";
  const shared = Buffer.from("same-original-bytes");
  const distinct = Buffer.from("document-original-bytes");
  const dataUrl = `data:image/png;base64,${shared.toString("base64")}`;
  const zip = new JSZip();
  const packager = createAssetPackager({
    zip,
    nextAssetPath,
    readProtocolAsset: async (sourceUrl) => {
      if (sourceUrl === stagedUrl) return { kind: "staged", mime: "image/png", extension: ".png", buffer: shared };
      if (sourceUrl === documentUrl) return { kind: "document", mime: "image/gif", assetPath: "assets/old.gif", buffer: distinct };
      throw new Error("missing");
    },
  });
  const html = await packager.packageHtml(`<p><img src="${stagedUrl}"><img src="${stagedUrl}"><img src="${dataUrl}"><img src="${documentUrl}"></p>`);
  assert.doesNotMatch(html, /paperwriter-asset:|data:image/);
  const sources = [...html.matchAll(/src="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(sources).size, 2);
  assert.equal(Object.keys(zip.files).filter((name) => !zip.files[name].dir).length, 2);
  assert.deepEqual(await zip.file(sources[0]).async("nodebuffer"), shared);
  assert.deepEqual(await zip.file(sources[3]).async("nodebuffer"), distinct);
});

test("fails explicitly instead of writing an unresolved staged URL", async () => {
  const zip = new JSZip();
  const packager = createAssetPackager({
    zip,
    nextAssetPath,
    readProtocolAsset: async () => { throw new Error("token 未注册"); },
  });
  await assert.rejects(
    () => packager.packageHtml('<img src="paperwriter-asset://staged/22222222-2222-4222-8222-222222222222">'),
    /未注册.*文档未保存|文档未保存.*未注册/,
  );
});

test("refuses to persist runtime blob or remote resource URLs", async () => {
  const zip = new JSZip();
  const packager = createAssetPackager({
    zip,
    nextAssetPath,
    readProtocolAsset: async () => { throw new Error("unused"); },
  });
  await assert.rejects(
    () => packager.packageHtml('<p><img src="blob:http://127.0.0.1/11111111-1111-4111-8111-111111111111"></p>'),
    /未暂存.*文档未保存/,
  );
  await assert.rejects(() => packager.packageSource("https://example.com/image.png"), /未暂存.*文档未保存/);
  await assert.rejects(() => packager.packageSource("assets/missing.png"), /尚未暂存|已经失效/);
  zip.file("assets/image-0001.png", Buffer.from("existing"), { compression: "STORE", createFolders: false });
  assert.equal(await packager.packageSource("assets/image-0001.png"), "assets/image-0001.png");
});

test("rejects oversized data and protocol assets before adding them to the archive", async () => {
  const zip = new JSZip();
  const packager = createAssetPackager({
    zip,
    nextAssetPath,
    maxAssetBytes: 3,
    readProtocolAsset: async (_sourceUrl, options) => {
      assert.equal(options.maxBytes, 3);
      return { mime: "image/png", buffer: Buffer.from("four") };
    },
  });
  await assert.rejects(() => packager.packageSource("data:image/png;base64,Zm91cg=="), /大小上限/);
  await assert.rejects(
    () => packager.packageSource("paperwriter-asset://staged/22222222-2222-4222-8222-222222222222"),
    /大小上限/,
  );
});

test("bounds each resource read by the remaining archive budget", async () => {
  const zip = new JSZip();
  const seenLimits = [];
  const firstUrl = "paperwriter-asset://staged/11111111-1111-4111-8111-111111111111";
  const secondUrl = "paperwriter-asset://staged/22222222-2222-4222-8222-222222222222";
  const packager = createAssetPackager({
    zip,
    nextAssetPath,
    maxAssetBytes: 5,
    maxTotalAssetBytes: 5,
    readProtocolAsset: async (sourceUrl, options) => {
      seenLimits.push(options.maxBytes);
      return {
        mime: "image/png",
        extension: sourceUrl === firstUrl ? ".foo" : ".png",
        buffer: Buffer.from(sourceUrl === firstUrl ? "abc" : "def"),
      };
    },
  });
  const firstPath = await packager.packageSource(firstUrl);
  assert.match(firstPath, /\.png$/);
  await assert.rejects(() => packager.packageSource(secondUrl), /总量超过安全上限/);
  assert.deepEqual(seenLimits, [5, 2]);
});

test("reserves one archive entry for document.json", () => {
  const zip = new JSZip();
  const packager = createAssetPackager({
    zip,
    nextAssetPath,
    maxAssetEntries: 2,
    readProtocolAsset: async () => { throw new Error("unused"); },
  });
  packager.addBuffer({ mime: "image/png", buffer: Buffer.from("one") });
  packager.addBuffer({ mime: "image/png", buffer: Buffer.from("two") });
  assert.equal(zip.files["assets/"], undefined);
  assert.throws(
    () => packager.addBuffer({ mime: "image/png", buffer: Buffer.from("three") }),
    /过多独立资源/,
  );
});

test("keeps legacy base64 data URLs compatible when lines are wrapped", () => {
  const original = Buffer.from("legacy-image-bytes");
  const wrapped = original.toString("base64").replace(/(.{8})/g, "$1\r\n");
  const decoded = dataUrlToBuffer(`data:image/png;base64,${wrapped}`);
  assert.deepEqual(decoded.buffer, original);
  assert.equal(dataUrlToBuffer("data:image/png;base64,not_base64!"), null);
  assert.equal(extensionFromMime("image/jpg"), ".jpg");
});
