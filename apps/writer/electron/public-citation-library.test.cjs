const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const documentModel = require("./document-model.cjs");
const { atomicWriteFile } = require("./document-storage.cjs");
const {
  PUBLIC_CITATION_LIBRARY_FILE,
  createPublicCitationLibraryRuntime,
} = require("./public-citation-library.cjs");

async function createHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-public-citations-"));
  let id = 0;
  const runtime = createPublicCitationLibraryRuntime({
    fs,
    path,
    atomicWriteFile,
    getUserDataPath: () => root,
    normalizeCitationSources: documentModel.normalizeCitationSources,
    randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  });
  return { root, runtime };
}

test("public citation library persists independent application sources", async (t) => {
  const { root, runtime } = await createHarness();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const created = await runtime.facade.upsertSource({
    title: "公共文献",
    authors: ["作者"],
    year: "2026",
    doi: "10.1000/example",
  });
  assert.equal(created.sources.length, 1);
  assert.equal(created.source.title, "公共文献");
  const onDisk = JSON.parse(await fs.readFile(
    path.join(root, "Citation", PUBLIC_CITATION_LIBRARY_FILE),
    "utf8",
  ));
  assert.equal(onDisk.sources[0].id, created.source.id);
  const reopened = await runtime.facade.listSources();
  assert.deepEqual(reopened.sources, created.sources);
});

test("workspace migration is idempotent and fills only missing public fields", async (t) => {
  const { root, runtime } = await createHarness();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await runtime.facade.upsertSource({
    id: "00000000-0000-4000-8000-000000000101",
    title: "保留的公域题名",
    doi: "10.1000/shared",
  });
  const first = await runtime.facade.migrateWorkspace("workspace-0001", [{
    id: "00000000-0000-4000-8000-000000000202",
    title: "旧工作区题名",
    authors: ["旧作者"],
    year: "2024",
    doi: "10.1000/shared",
  }, {
    id: "00000000-0000-4000-8000-000000000303",
    title: "新增旧文献",
  }]);
  assert.equal(first.migrated, true);
  assert.equal(first.imported, 1);
  assert.equal(first.sources.length, 2);
  const merged = first.sources.find((source) => source.doi === "10.1000/shared");
  assert.equal(merged.title, "保留的公域题名");
  assert.deepEqual(merged.authors, ["旧作者"]);
  const second = await runtime.facade.migrateWorkspace("workspace-0001", [{ title: "不应再次写入" }]);
  assert.equal(second.alreadyMigrated, true);
  assert.equal(second.sources.length, 2);
});

test("deleting a public source does not touch any document snapshot", async (t) => {
  const { root, runtime } = await createHarness();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const created = await runtime.facade.upsertSource({ title: "可删除公域来源" });
  const snapshot = { ...created.source };
  const removed = await runtime.facade.deleteSource(created.source.id);
  assert.equal(removed.sources.length, 0);
  assert.equal(snapshot.title, "可删除公域来源");
});

test("a corrupted public library fails closed instead of being overwritten", async (t) => {
  const { root, runtime } = await createHarness();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "Citation", PUBLIC_CITATION_LIBRARY_FILE);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "{broken-json", "utf8");
  await assert.rejects(runtime.facade.upsertSource({ title: "不得覆盖" }), /文件已损坏/);
  assert.equal(await fs.readFile(target, "utf8"), "{broken-json");
});
