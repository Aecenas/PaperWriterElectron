const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  materializeCodexImageAttachments,
  normalizeCodexImageMode,
} = require("./codex-image-attachments.cjs");

test("normalizes legacy Codex image mode to original", () => {
  assert.equal(normalizeCodexImageMode(), "original");
  assert.equal(normalizeCodexImageMode("caption-only"), "caption-only");
  assert.equal(normalizeCodexImageMode("invalid"), "original");
});

test("materializes data URLs and packaged assets in image-number order", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-codex-images-test-"));
  try {
    const result = await materializeCodexImageAttachments({
      tempRoot: root,
      images: [
        { number: 1, caption: "中文标题", src: "data:image/png;base64,aGVsbG8=" },
        { number: 2, caption: "资料图", src: "paperwriter-asset://document/example?asset=assets%2Fimage.png" },
      ],
      readProtocolAsset: async () => ({ mime: "image/jpeg", buffer: Buffer.from("world") }),
    });
    assert.deepEqual(result.attachments.map((item) => [item.number, item.caption, path.extname(item.path)]), [
      [1, "中文标题", ".png"],
      [2, "资料图", ".jpg"],
    ]);
    assert.equal((await fs.readFile(result.imagePaths[0], "utf8")), "hello");
    await result.cleanup();
    await assert.rejects(() => fs.stat(result.imagePaths[0]));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects an unreadable image without silently dropping it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-codex-images-error-test-"));
  try {
    await assert.rejects(
      () => materializeCodexImageAttachments({
        tempRoot: root,
        images: [{ number: 3, caption: "失效图片", src: "broken" }],
      }),
      /图3.*失效图片.*仅标题/,
    );
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
