import assert from "node:assert/strict";
import test from "node:test";
import { waitForImageExportAssets } from "./image-export-readiness.js";

class FakeImage extends EventTarget {
  constructor({ complete = true, naturalWidth = 640, naturalHeight = 360, decode = async () => {} } = {}) {
    super();
    this.complete = complete;
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    this.decode = decode;
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

function rootWith(...images) {
  return { querySelectorAll: (selector) => selector === "img[src]" ? images : [] };
}

test("image export eagerly decodes every cloned image before capture", async () => {
  let decoded = 0;
  const image = new FakeImage({ decode: async () => { decoded += 1; } });
  const result = await waitForImageExportAssets(rootWith(image), 50);
  assert.deepEqual(result, { count: 1 });
  assert.equal(decoded, 1);
  assert.equal(image.attributes.get("loading"), "eager");
  assert.equal(image.attributes.get("decoding"), "sync");
});

test("image export waits for a delayed clone load before decoding", async () => {
  const image = new FakeImage({ complete: false });
  const waiting = waitForImageExportAssets(rootWith(image), 100);
  setTimeout(() => {
    image.complete = true;
    image.dispatchEvent(new Event("load"));
  }, 5);
  await waiting;
});

test("image export fails instead of capturing an empty image frame", async () => {
  const missing = new FakeImage({ naturalWidth: 0, naturalHeight: 0 });
  await assert.rejects(
    waitForImageExportAssets(rootWith(missing), 50),
    /原图加载失败/,
  );
});

test("image export reports a readable error when clone decoding fails", async () => {
  const undecodable = new FakeImage({ decode: async () => { throw new Error("decode failed"); } });
  await assert.rejects(
    waitForImageExportAssets(rootWith(undecodable), 50),
    /原图解码失败/,
  );
});

test("image export reports a bounded timeout for a clone that never loads", async () => {
  const stalled = new FakeImage({ complete: false });
  await assert.rejects(
    waitForImageExportAssets(rootWith(stalled), 10),
    /原图加载超时/,
  );
});
