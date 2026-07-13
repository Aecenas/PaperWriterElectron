const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const test = require("node:test");
const JSZip = require("jszip");
const {
  atomicWriteFile,
  createByteBudgetSemaphore,
  createZipEntryLimitTransform,
  createPathWriteQueue,
  parseSingleByteRange,
  preflightZipBuffer,
  readZipEntryBufferLimited,
  validatePaperArchive,
} = require("./document-storage.cjs");

function findEocd(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function fakeZipEntry({ declaredBytes, compressedBytes = declaredBytes, chunks }) {
  return {
    name: "assets/test.bin",
    _data: { compressedSize: compressedBytes, uncompressedSize: declaredBytes },
    nodeStream: () => Readable.from(chunks),
  };
}

test("atomically replaces a file and removes its temporary file", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-atomic-"));
  const target = path.join(directory, "note.letterpaper");
  try {
    await fs.writeFile(target, "old");
    await atomicWriteFile(target, Buffer.from("new"), { createId: () => "test" });
    assert.equal(await fs.readFile(target, "utf8"), "new");
    assert.deepEqual(await fs.readdir(directory), ["note.letterpaper"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("preserves the original file when atomic replacement fails", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-atomic-fail-"));
  const target = path.join(directory, "note.letterpaper");
  try {
    await fs.writeFile(target, "old");
    const fsApi = {
      ...fs,
      rename: async () => { throw Object.assign(new Error("disk failure"), { code: "EIO" }); },
    };
    await assert.rejects(() => atomicWriteFile(target, Buffer.from("new"), { fsApi, createId: () => "test" }), /disk failure/);
    assert.equal(await fs.readFile(target, "utf8"), "old");
    assert.deepEqual(await fs.readdir(directory), ["note.letterpaper"]);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("serializes writes to the same normalized path", async () => {
  const queue = createPathWriteQueue({ platform: "win32", pathApi: path.win32 });
  const order = [];
  let release;
  const first = queue.run("C:\\Docs\\Note.letterpaper", async () => {
    order.push("first-start");
    await new Promise((resolve) => { release = resolve; });
    order.push("first-end");
  });
  const second = queue.run("c:\\docs\\note.letterpaper", async () => { order.push("second"); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["first-start"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("limits extraction concurrency and aggregate in-flight bytes", async () => {
  const semaphore = createByteBudgetSemaphore({ maxConcurrent: 2, maxReservedBytes: 10 });
  const releaseFirst = await semaphore.acquire(6);
  let secondStarted = false;
  const second = semaphore.acquire(5).then((release) => {
    secondStarted = true;
    return release;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondStarted, false);
  assert.deepEqual(semaphore.stats(), { active: 1, queued: 1, reservedBytes: 6 });
  releaseFirst();
  const releaseSecond = await second;
  assert.equal(secondStarted, true);
  assert.deepEqual(semaphore.stats(), { active: 1, queued: 0, reservedBytes: 5 });
  releaseSecond();
  assert.deepEqual(semaphore.stats(), { active: 0, queued: 0, reservedBytes: 0 });
  await assert.rejects(() => semaphore.acquire(11), /字节预算/);
});

test("rejects a highly compressed document.json before expansion", async () => {
  const zip = new JSZip();
  zip.file("document.json", "A".repeat(8 * 1024 * 1024));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const loaded = await JSZip.loadAsync(buffer);
  assert.throws(() => validatePaperArchive(loaded, { archiveBytes: buffer.length }), /压缩比异常/);
});

test("rejects many individually small compressible entries by aggregate ratio", async () => {
  const zip = new JSZip();
  zip.file("document.json", "{}", { compression: "STORE", createFolders: false });
  for (let index = 0; index < 100; index += 1) {
    zip.file(`assets/small-${index}.bin`, Buffer.alloc(128 * 1024), { createFolders: false });
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  assert.throws(() => preflightZipBuffer(buffer), /总压缩比异常/);
  const loaded = await JSZip.loadAsync(buffer);
  assert.throws(() => validatePaperArchive(loaded, { archiveBytes: buffer.length }), /总压缩比异常/);
});

test("accepts a normal paper archive", async () => {
  const zip = new JSZip();
  zip.file("document.json", JSON.stringify({ title: "测试", html: "<p>正文</p>" }));
  zip.file("assets/image-0001.png", Buffer.from("image"), { compression: "STORE" });
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  assert.equal(preflightZipBuffer(buffer).entries >= 2, true);
  const loaded = await JSZip.loadAsync(buffer);
  const result = validatePaperArchive(loaded, { archiveBytes: buffer.length });
  assert.equal(result.entries, 2);
});

test("accepts a writer-generated highly repetitive long document", async () => {
  const zip = new JSZip();
  const documentJson = JSON.stringify({ version: 1, html: "中".repeat(400000) });
  zip.file("document.json", documentJson, { compression: "STORE" });
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  assert.doesNotThrow(() => preflightZipBuffer(buffer));
  const loaded = await JSZip.loadAsync(buffer);
  assert.doesNotThrow(() => validatePaperArchive(loaded, { archiveBytes: buffer.length }));
  assert.equal(await loaded.file("document.json").async("string"), documentJson);
});

test("rejects a forged central-directory entry count before JSZip allocation", async () => {
  const zip = new JSZip();
  zip.file("document.json", "{}");
  const original = await zip.generateAsync({ type: "nodebuffer" });
  const buffer = Buffer.from(original);
  const eocd = findEocd(buffer);
  assert.notEqual(eocd, -1);
  buffer.writeUInt16LE(3000, eocd + 8);
  buffer.writeUInt16LE(3000, eocd + 10);
  assert.throws(() => preflightZipBuffer(buffer), /过多资源/);
});

test("bounds actual decompression output and rejects forged declared sizes", async () => {
  const oversized = fakeZipEntry({ declaredBytes: 4, chunks: [Buffer.alloc(7)] });
  await assert.rejects(
    () => readZipEntryBufferLimited(oversized, { maxBytes: 6 }),
    /解压后超过安全上限/,
  );

  const mismatched = fakeZipEntry({ declaredBytes: 4, chunks: [Buffer.alloc(5)] });
  await assert.rejects(
    () => readZipEntryBufferLimited(mismatched, { maxBytes: 10 }),
    /实际大小与目录不一致/,
  );
});

test("streaming extraction aborts before writing beyond its runtime limit", async () => {
  const entry = fakeZipEntry({ declaredBytes: 4, chunks: [Buffer.alloc(7)] });
  let written = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      written += chunk.length;
      callback();
    },
  });
  await assert.rejects(
    () => pipeline(entry.nodeStream("nodebuffer"), createZipEntryLimitTransform(entry, { maxBytes: 6 }), sink),
    /解压后超过安全上限/,
  );
  assert.equal(written, 0);
});

test("rejects unexpected archive entries outside document.json and assets", async () => {
  const zip = new JSZip();
  zip.file("document.json", "{}");
  zip.file("metadata/private.txt", "not part of the format");
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const loaded = await JSZip.loadAsync(buffer);
  assert.throws(() => validatePaperArchive(loaded, { archiveBytes: buffer.length }), /不受支持/);
});

test("parses one bounded HTTP byte range", () => {
  assert.equal(parseSingleByteRange(null, 100), null);
  assert.deepEqual(parseSingleByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseSingleByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseSingleByteRange("bytes=-20", 100), { start: 80, end: 99 });
  assert.deepEqual(parseSingleByteRange("bytes=99-200", 100), { start: 99, end: 99 });
  assert.deepEqual(parseSingleByteRange("bytes=100-", 100), { invalid: true });
  assert.deepEqual(parseSingleByteRange("bytes=0-1,4-5", 100), { invalid: true });
  assert.deepEqual(parseSingleByteRange("bytes=0-", 0), { invalid: true });
});
