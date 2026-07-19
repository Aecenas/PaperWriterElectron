const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  REVISION_CONFLICT_CODE,
  assertDiskRevision,
  assertExpectedRevision,
  createConflictCopyPath,
  diskRevisionsEqual,
  normalizeDiskRevision,
  readFileSnapshot,
  readDiskRevision,
} = require("./document-revision.cjs");

test("reads stable size, modification time, and SHA-256 revisions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-revision-"));
  const target = path.join(directory, "中文信笺.letterpaper");
  try {
    await fs.writeFile(target, "第一版", "utf8");
    const first = await readDiskRevision(target);
    assert.equal(first.size, Buffer.byteLength("第一版"));
    assert.match(first.sha256, /^[a-f0-9]{64}$/);
    assert.equal(diskRevisionsEqual(first, { ...first, sha256: first.sha256.toUpperCase() }), true);

    await fs.writeFile(target, "第二个版本", "utf8");
    const second = await readDiskRevision(target);
    assert.equal(diskRevisionsEqual(first, second), false);
    assert.deepEqual(await assertDiskRevision(target, second), second);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("binds the returned bytes and revision to one opened file snapshot", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-revision-snapshot-"));
  const target = path.join(directory, "快照.letterpaper");
  try {
    await fs.writeFile(target, "同一份字节", "utf8");
    const snapshot = await readFileSnapshot(target, { maxBytes: 1024 });
    assert.equal(snapshot.buffer.toString("utf8"), "同一份字节");
    assert.equal(snapshot.revision.size, snapshot.buffer.length);
    assert.equal(snapshot.revision.sha256, require("node:crypto").createHash("sha256").update(snapshot.buffer).digest("hex"));
    assert.equal(snapshot.stat.isFile(), true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("detects an in-place external rewrite even when the file size is unchanged", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-revision-in-place-"));
  const target = path.join(directory, "同步稿.letterpaper");
  try {
    await fs.writeFile(target, "版本甲", "utf8");
    const expected = await readDiskRevision(target);
    await fs.writeFile(target, "版本乙", "utf8");
    const actual = await readDiskRevision(target);
    assert.equal(actual.size, expected.size);
    assert.notEqual(actual.sha256, expected.sha256);
    await assert.rejects(
      assertDiskRevision(target, expected),
      (error) => {
        assert.equal(error.code, REVISION_CONFLICT_CODE);
        assert.deepEqual(error.expectedRevision, expected);
        assert.deepEqual(error.actualRevision, actual);
        return true;
      },
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("represents a missing document as a null revision", async () => {
  const target = path.join(os.tmpdir(), `missing-${Date.now()}.letterpaper`);
  assert.equal(await readDiskRevision(target), null);
  assert.equal(diskRevisionsEqual(null, null), true);
  assert.equal(assertExpectedRevision(null, null), null);
});

test("throws a structured conflict without discarding either revision", () => {
  const expected = { size: 1, mtimeMs: 10, sha256: "a".repeat(64) };
  const actual = { size: 2, mtimeMs: 20, sha256: "b".repeat(64) };
  assert.throws(
    () => assertExpectedRevision(actual, expected, { filePath: "C:\\同步\\文章.letterpaper" }),
    (error) => {
      assert.equal(error.code, REVISION_CONFLICT_CODE);
      assert.deepEqual(error.expectedRevision, expected);
      assert.deepEqual(error.actualRevision, actual);
      assert.match(error.filePath, /文章\.letterpaper$/);
      return true;
    },
  );
});

test("rejects malformed revision values", () => {
  assert.throws(() => normalizeDiskRevision({ size: -1, mtimeMs: 1, sha256: "a".repeat(64) }), /文件大小/);
  assert.throws(() => normalizeDiskRevision({ size: 1, mtimeMs: 1, sha256: "not-a-hash" }), /SHA-256/);
  assert.equal(diskRevisionsEqual({ size: 1 }, { size: 1 }), false);
});

test("creates deterministic Windows-safe conflict copy names and preserves extensions", () => {
  const date = new Date(2026, 6, 14, 9, 8, 7);
  assert.equal(
    createConflictCopyPath("C:\\写作\\长文.letterpaper", { date, pathApi: path.win32 }),
    "C:\\写作\\长文_本机冲突副本_20260714_090807.letterpaper",
  );
  assert.equal(
    createConflictCopyPath("C:\\写作\\旧稿.paperdoc", { date, sequence: 1, label: "本机:冲突?", pathApi: path.win32 }),
    "C:\\写作\\旧稿_本机 冲突_20260714_090807_2.paperdoc",
  );
  const longName = `${"章".repeat(300)}.letterpaper`;
  const candidate = createConflictCopyPath(path.win32.join("C:\\写作", longName), { date, pathApi: path.win32 });
  assert.ok(path.win32.basename(candidate).length <= 240);
  assert.equal(path.win32.extname(candidate), ".letterpaper");
  const emojiCandidate = createConflictCopyPath(path.win32.join("C:\\写作", `${"😀".repeat(200)}.letterpaper`), { date, pathApi: path.win32 });
  assert.ok(path.win32.basename(emojiCandidate).length <= 240);
  assert.equal(emojiCandidate.includes("�"), false);
});
