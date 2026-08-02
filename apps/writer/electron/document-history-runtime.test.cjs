const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { atomicWriteFile } = require("./document-storage.cjs");
const {
  createDocumentHistoryRuntime,
} = require("./document-history-runtime.cjs");

async function createHarness(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-history-"));
  let clock = Date.parse("2026-07-29T00:00:00.000Z");
  let id = 0;
  const revisions = [];
  const runtime = createDocumentHistoryRuntime({
    fs,
    path,
    createHash,
    randomUUID: () => `history-${++id}`,
    atomicWriteFile,
    getUserDataPath: () => root,
    assertDiskRevision: async (filePath, revision) => {
      revisions.push([filePath, revision]);
      if (
        options.conflict
        || options.conflictAt === revisions.length
      ) throw Object.assign(new Error("conflict"), {
        code: "DOCUMENT_REVISION_CONFLICT",
      });
    },
    readDiskRevision: async (filePath) => ({
      size: (await fs.stat(filePath)).size,
      sha256: createHash("sha256")
        .update(await fs.readFile(filePath))
        .digest("hex"),
    }),
    loadPaperDocumentSnapshot: options.loadPaperDocumentSnapshot,
    now: () => new Date(clock),
    limits: options.limits,
  });
  await runtime.initialize();
  return {
    root,
    runtime,
    revisions,
    tick(milliseconds) {
      clock += milliseconds;
    },
  };
}

test("auto history coalesces within ten minutes and deduplicates identical saves", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "draft.letterpaper");
  await fs.writeFile(source, "version-one");

  const first = await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
  });
  const duplicate = await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
  });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.entry.id, first.entry.id);

  harness.tick(60_000);
  await fs.writeFile(source, "version-two");
  const coalesced = await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
  });
  assert.equal(coalesced.coalesced, true);
  assert.equal(coalesced.entry.id, first.entry.id);
  assert.equal((await harness.runtime.facade.list("doc-1")).length, 1);

  harness.tick(11 * 60_000);
  await fs.writeFile(source, "version-three");
  await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
  });
  assert.equal((await harness.runtime.facade.list("doc-1")).length, 2);
});

test("prepared history commits the previous bytes with their save time and excludes the current auto snapshot", async (t) => {
  const harness = await createHarness({
    loadPaperDocumentSnapshot: async (filePath) => {
      const buffer = await fs.readFile(filePath);
      return {
        document: { documentId: "doc-1", title: "旧稿" },
        diskRevision: {
          sha256: createHash("sha256").update(buffer).digest("hex"),
        },
      };
    },
    limits: { coalesceMs: 0 },
  });
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "draft.letterpaper");
  await fs.writeFile(source, "previous-save");

  const prepared = await harness.runtime.facade.prepareSnapshot({
    documentId: "doc-1",
    filePath: source,
    kind: "auto",
    savedAt: 1_234_567,
  });
  await fs.writeFile(source, "current-save");
  const committed = await prepared.commit();

  assert.equal(committed.entry.savedAt, 1_234_567);
  assert.equal(
    await fs.readFile(
      path.join(harness.root, "History", "doc-1", "blobs", `${committed.entry.sha256}.letterpaper`),
      "utf8",
    ),
    "previous-save",
  );
  assert.equal(
    (await harness.runtime.facade.list("doc-1", {
      excludeAutoSha256: committed.entry.sha256,
    })).length,
    0,
  );
  assert.deepEqual(await harness.runtime.facade.clear("doc-1"), {
    ok: true,
    removed: 1,
  });
  assert.equal((await harness.runtime.facade.list("doc-1")).length, 0);
});

test("history blobs are hash-deduplicated and retained while referenced", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "draft.letterpaper");
  await fs.writeFile(source, "same-content");
  const auto = await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
  });
  const manual = await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
    kind: "manual",
    name: "里程碑",
  });
  assert.notEqual(auto.entry.id, manual.entry.id);
  const blobs = await fs.readdir(
    path.join(harness.root, "History", "doc-1", "blobs"),
  );
  assert.equal(blobs.length, 1);

  await harness.runtime.facade.clearAuto("doc-1");
  assert.equal(
    (await harness.runtime.facade.read("doc-1", manual.entry.id)).archive
      .toString("utf8"),
    "same-content",
  );
});

test("restore creates a pinned safety version and rechecks the expected revision", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "draft.letterpaper");
  await fs.writeFile(source, "old");
  const saved = await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
    kind: "manual",
  });
  await fs.writeFile(source, "current");
  const expectedRevision = { sha256: "expected" };
  const restored = await harness.runtime.facade.restore({
    documentId: "doc-1",
    entryId: saved.entry.id,
    targetPath: source,
    expectedRevision,
  });
  assert.equal(await fs.readFile(source, "utf8"), "old");
  assert.equal(restored.safetyEntry.kind, "pre-restore");
  assert.equal(restored.safetyEntry.pinned, true);
  assert.equal(harness.revisions.length, 3);
  assert.deepEqual(harness.revisions[0][1], expectedRevision);
  assert.deepEqual(harness.revisions[1][1], expectedRevision);
  assert.deepEqual(harness.revisions[2][1], expectedRevision);
});

test("restore does not create or overwrite anything after a revision conflict", async (t) => {
  const harness = await createHarness({ conflict: true });
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "draft.letterpaper");
  await fs.writeFile(source, "old");
  const saved = await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
    kind: "manual",
  });
  await fs.writeFile(source, "current");
  await assert.rejects(
    harness.runtime.facade.restore({
      documentId: "doc-1",
      entryId: saved.entry.id,
      targetPath: source,
      expectedRevision: { sha256: "stale" },
    }),
    /conflict/,
  );
  assert.equal(await fs.readFile(source, "utf8"), "current");
  assert.equal(
    (await harness.runtime.facade.list("doc-1"))
      .filter((entry) => entry.kind === "pre-restore").length,
    0,
  );
});

test("restore rejects a late revision conflict after creating its safety version", async (t) => {
  const harness = await createHarness({ conflictAt: 3 });
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "draft.letterpaper");
  await fs.writeFile(source, "old");
  const saved = await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
    kind: "manual",
  });
  await fs.writeFile(source, "current");

  await assert.rejects(
    harness.runtime.facade.restore({
      documentId: "doc-1",
      entryId: saved.entry.id,
      targetPath: source,
      expectedRevision: { sha256: "expected" },
    }),
    /conflict/,
  );

  assert.equal(await fs.readFile(source, "utf8"), "current");
  assert.equal(harness.revisions.length, 3);
  assert.equal(
    (await harness.runtime.facade.list("doc-1"))
      .filter((entry) => entry.kind === "pre-restore").length,
    1,
  );
});

test("automatic history enforces the per-document entry limit", async (t) => {
  const harness = await createHarness({
    limits: { autoEntriesPerDocument: 2, coalesceMs: 0 },
  });
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "draft.letterpaper");
  for (let index = 0; index < 3; index += 1) {
    await fs.writeFile(source, `version-${index}`);
    await harness.runtime.facade.createSnapshot({
      documentId: "doc-1",
      filePath: source,
    });
    harness.tick(1);
  }
  const entries = await harness.runtime.facade.list("doc-1");
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.createdAt), [
    Date.parse("2026-07-29T00:00:00.002Z"),
    Date.parse("2026-07-29T00:00:00.001Z"),
  ]);
});

test("history entries do not persist source paths and sanitize display names", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "private", "draft.letterpaper");
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.writeFile(source, "content");

  const created = await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
    kind: "manual",
    name: "\u0000  版本\n名称 \u007f",
  });
  assert.equal(created.entry.name, "版本 名称");
  assert.equal(Object.hasOwn(created.entry, "sourcePath"), false);

  const index = JSON.parse(await fs.readFile(
    path.join(harness.root, "History", "doc-1", "index.json"),
    "utf8",
  ));
  assert.equal(Object.hasOwn(index.entries[0], "sourcePath"), false);
  assert.equal(JSON.stringify(index).includes(source), false);
});

test("history reads reject blobs whose content no longer matches the indexed hash", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "draft.letterpaper");
  await fs.writeFile(source, "trusted");
  const created = await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
    kind: "manual",
  });
  await fs.writeFile(
    path.join(
      harness.root,
      "History",
      "doc-1",
      "blobs",
      `${created.entry.sha256}.letterpaper`,
    ),
    "tampered",
  );

  await assert.rejects(
    harness.runtime.facade.read("doc-1", created.entry.id),
    /校验失败/,
  );
});

test("global automatic history quota uses actual blob sizes instead of index metadata", async (t) => {
  const harness = await createHarness({
    limits: { autoBytesGlobal: 12, coalesceMs: 0 },
  });
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "draft.letterpaper");
  await fs.writeFile(source, "first-value");
  await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
  });

  const firstIndexPath = path.join(
    harness.root,
    "History",
    "doc-1",
    "index.json",
  );
  const firstIndex = JSON.parse(await fs.readFile(firstIndexPath, "utf8"));
  firstIndex.entries[0].size = 0;
  await fs.writeFile(firstIndexPath, JSON.stringify(firstIndex), "utf8");

  harness.tick(1);
  await fs.writeFile(source, "second-data");
  await harness.runtime.facade.createSnapshot({
    documentId: "doc-2",
    filePath: source,
  });

  assert.equal((await harness.runtime.facade.list("doc-1")).length, 0);
  assert.equal((await harness.runtime.facade.list("doc-2")).length, 1);
});

test("a corrupt history index fails closed without deleting blobs or blocking other documents", async (t) => {
  const harness = await createHarness();
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "draft.letterpaper");
  await fs.writeFile(source, "protected-version");
  await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
    kind: "manual",
  });
  const blobsDirectory = path.join(
    harness.root,
    "History",
    "doc-1",
    "blobs",
  );
  const originalBlobs = await fs.readdir(blobsDirectory);
  await fs.writeFile(
    path.join(harness.root, "History", "doc-1", "index.json"),
    "{",
    "utf8",
  );

  await fs.writeFile(source, "new-version");
  await assert.rejects(
    harness.runtime.facade.createSnapshot({
      documentId: "doc-1",
      filePath: source,
    }),
    /索引已损坏/,
  );
  assert.deepEqual(await fs.readdir(blobsDirectory), originalBlobs);

  await harness.runtime.facade.createSnapshot({
    documentId: "doc-2",
    filePath: source,
  });
  assert.equal((await harness.runtime.facade.list("doc-2")).length, 1);
  assert.deepEqual(await fs.readdir(blobsDirectory), originalBlobs);
});

test("untrusted history mutations bind snapshots and restore targets to the document id", async (t) => {
  const harness = await createHarness({
    loadPaperDocumentSnapshot: async (filePath) => {
      const buffer = await fs.readFile(filePath);
      return {
        document: { documentId: "doc-2" },
        diskRevision: {
          sha256: createHash("sha256").update(buffer).digest("hex"),
        },
      };
    },
  });
  t.after(() => fs.rm(harness.root, { recursive: true, force: true }));
  const source = path.join(harness.root, "draft.letterpaper");
  await fs.writeFile(source, "content");

  await assert.rejects(
    harness.runtime.facade.createSnapshot({
      documentId: "doc-1",
      filePath: source,
      kind: "manual",
    }),
    /身份不匹配/,
  );
  assert.equal(
    await fs.stat(
      path.join(harness.root, "History", "doc-1"),
    ).then(() => true, (error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    }),
    false,
  );

  const saved = await harness.runtime.facade.createSnapshot({
    documentId: "doc-1",
    filePath: source,
    kind: "manual",
    trustedDocumentId: true,
  });
  await assert.rejects(
    harness.runtime.facade.restore({
      documentId: "doc-1",
      entryId: saved.entry.id,
      targetPath: source,
      expectedRevision: null,
    }),
    /身份不匹配/,
  );
  assert.equal(await fs.readFile(source, "utf8"), "content");
});
