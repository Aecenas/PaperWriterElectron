import assert from "node:assert/strict";
import test from "node:test";
import { itemIdentity, normalizePdfBytes } from "./research/reader-utils.js";

test("research reader identity keeps stable source identifiers ahead of path fallbacks", () => {
  assert.equal(itemIdentity({ id: "item-id", sourceId: "source-id", relativePath: "folder/file.pdf" }), "item-id");
  assert.equal(itemIdentity({ sourceId: "source-id", relativePath: "folder/file.pdf" }), "source-id");
  assert.equal(itemIdentity({ relativePath: "folder/file.pdf", url: "https://example.com" }), "folder/file.pdf");
  assert.equal(itemIdentity({ url: "https://example.com" }), "https://example.com");
  assert.equal(itemIdentity(null), "");
});

test("research reader byte normalization accepts bridge and browser payload shapes", () => {
  const direct = new Uint8Array([1, 2, 3]);
  assert.equal(normalizePdfBytes(direct), direct);
  assert.deepEqual([...normalizePdfBytes({ bytes: [4, 5] })], [4, 5]);
  assert.equal(normalizePdfBytes(new Uint16Array([0x0102])).byteLength, 2);
  assert.deepEqual([...normalizePdfBytes(new ArrayBuffer(2))], [0, 0]);
  assert.equal(normalizePdfBytes({ bytes: "invalid" }), null);
});
