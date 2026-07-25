const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeCitationSources,
} = require("./document-model.cjs");

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
];

test("Electron document normalization round-trips portable independent-library citation snapshots", async () => {
  const once = normalizeCitationSources([{
    id: IDS[0],
    type: "pdf",
    title: "离线仍可显示的引用快照",
    authors: ["作者"],
    pages: "88",
    researchLibraryId: IDS[3].toUpperCase(),
    researchSourceId: IDS[4].toUpperCase(),
    researchRootPath: "C:\\不得写入 letterpaper\\资料",
    absolutePath: "C:\\不得写入 letterpaper\\paper.pdf",
  }]);
  const portable = JSON.parse(JSON.stringify(once));

  assert.equal(portable[0].researchLibraryId, IDS[3]);
  assert.equal(portable[0].researchSourceId, IDS[4]);
  assert.equal(portable[0].title, "离线仍可显示的引用快照");
  assert.equal(portable[0].pages, "88");
  assert.equal("researchRootPath" in portable[0], false);
  assert.equal("absolutePath" in portable[0], false);
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeCitationSources(portable))), portable);
});

test("Electron document normalization drops bad pairs and retains v0.9.5 source-only identities", async () => {
  const normalized = JSON.parse(JSON.stringify(normalizeCitationSources([
    { id: IDS[0], title: "完整配对", researchLibraryId: IDS[3], researchSourceId: IDS[4] },
    { id: IDS[1], title: "缺少来源", researchLibraryId: IDS[3] },
    { id: IDS[2], title: "非法资料库", researchLibraryId: "invalid", researchSourceId: IDS[4] },
    { id: IDS[5], title: "旧版来源", researchSourceId: "legacy_note_01" },
  ])));

  assert.deepEqual(
    { researchLibraryId: normalized[0].researchLibraryId, researchSourceId: normalized[0].researchSourceId },
    { researchLibraryId: IDS[3], researchSourceId: IDS[4] },
  );
  assert.equal("researchLibraryId" in normalized[1], false);
  assert.equal("researchSourceId" in normalized[1], false);
  assert.equal("researchLibraryId" in normalized[2], false);
  assert.equal("researchSourceId" in normalized[2], false);
  assert.equal(normalized[3].researchSourceId, "legacy_note_01");
});
