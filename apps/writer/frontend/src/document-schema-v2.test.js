import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_SCHEMA_VERSION,
  UnsupportedDocumentSchemaVersionError,
  createDerivedDocumentIdentity,
  createDocumentId,
  createInternalLinkMetadata,
  getDocumentSchemaCompatibility,
  isDocumentId,
  mergePersistedDocumentIdentity,
  normalizeCitationResearchIdentity,
  normalizeCitationReferenceMetadata,
  normalizeCitationSources,
  normalizeDocumentFootnotes,
  normalizeDocumentId,
  normalizeDocumentSchemaV2,
  normalizeFootnoteReferenceMetadata,
  normalizeInternalLinkMetadata,
  readDocumentSchemaVersion,
} from "./document-schema-v2.js";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];

function idFactorySequence(values = IDS) {
  let index = 0;
  return () => values[index++];
}

const NOW = "2026-07-14T10:00:00.000Z";

test("creates and canonicalizes UUID document identities", () => {
  assert.equal(isDocumentId(IDS[0]), true);
  assert.equal(isDocumentId("not-an-id"), false);
  assert.equal(normalizeDocumentId(IDS[0].toUpperCase()), IDS[0]);
  assert.equal(createDocumentId(() => IDS[1]), IDS[1]);
  assert.throws(() => createDocumentId(() => "bad"), /非法文档 ID/);
  assert.equal(isDocumentId(createDocumentId()), true);
});

test("reports compatibility and rejects unknown future versions", () => {
  assert.equal(readDocumentSchemaVersion({}), 1);
  assert.deepEqual(getDocumentSchemaCompatibility({ version: 1 }), { version: 1, supported: true, readOnly: false, needsUpgrade: true });
  assert.deepEqual(getDocumentSchemaCompatibility({ version: 3 }), { version: 3, supported: false, readOnly: true, needsUpgrade: false });
  assert.throws(
    () => normalizeDocumentSchemaV2({ version: 3 }),
    (error) => error instanceof UnsupportedDocumentSchemaVersionError && error.version === 3,
  );
});

test("upgrades v1 to v2 while preserving content and leaving the input untouched", () => {
  const input = { version: 1, title: "原文", html: "<p>正文</p>", extensionData: { keep: true } };
  const normalized = normalizeDocumentSchemaV2(input, { idFactory: idFactorySequence(), now: NOW });
  assert.equal(normalized.version, DOCUMENT_SCHEMA_VERSION);
  assert.equal(normalized.documentId, IDS[0]);
  assert.equal(normalized.derivedFrom, "");
  assert.deepEqual(normalized.footnotes, []);
  assert.deepEqual(normalized.citationSources, []);
  assert.deepEqual(normalized.extensionData, { keep: true });
  assert.deepEqual(input, { version: 1, title: "原文", html: "<p>正文</p>", extensionData: { keep: true } });
});

test("normalizes footnotes, generates missing IDs and drops duplicate references", () => {
  const normalized = normalizeDocumentFootnotes([
    { id: IDS[0], text: " 第一条 ", createdAt: NOW },
    { id: IDS[0], text: "重复 ID" },
    { text: "自动 ID" },
    { text: "   " },
  ], { idFactory: idFactorySequence([IDS[1]]), now: NOW });
  assert.deepEqual(normalized, [
    { id: IDS[0], text: "第一条", createdAt: NOW, updatedAt: NOW },
    { id: IDS[1], text: "自动 ID", createdAt: NOW, updatedAt: NOW },
  ]);
});

test("normalizes citation sources into a bounded portable snapshot", () => {
  const normalized = normalizeCitationSources([
    {
      id: IDS[0],
      type: "web",
      title: " 官方资料 ",
      authors: "张三；李四",
      year: 2026,
      url: "https://example.com/source",
      doi: "https://doi.org/10.1000/example",
      createdAt: NOW,
    },
    { type: "web", title: "危险地址", url: "javascript:alert(1)" },
    { type: "other" },
  ], { idFactory: idFactorySequence([IDS[1]]), now: NOW });
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0].authors, ["张三", "李四"]);
  assert.equal(normalized[0].url, "https://example.com/source");
  assert.equal(normalized[0].doi, "10.1000/example");
  assert.equal(normalized[1].id, IDS[1]);
  assert.equal(normalized[1].url, "");
});

test("round-trips independent research identity pairs while keeping citation snapshots offline", () => {
  const document = normalizeDocumentSchemaV2({
    version: 2,
    documentId: IDS[0],
    title: "离线信笺",
    html: "<p>正文</p>",
    citationSources: [{
      id: IDS[1],
      type: "pdf",
      title: "独立资料快照",
      authors: ["作者"],
      pages: "42",
      researchLibraryId: IDS[3].toUpperCase(),
      researchSourceId: IDS[4].toUpperCase(),
      researchRootPath: "C:\\不得写入信笺\\资料",
    }],
  }, { now: NOW });

  assert.deepEqual(normalizeCitationResearchIdentity(document.citationSources[0]), {
    researchLibraryId: IDS[3],
    researchSourceId: IDS[4],
  });
  assert.equal(document.citationSources[0].title, "独立资料快照");
  assert.equal(document.citationSources[0].pages, "42");
  assert.equal("researchRootPath" in document.citationSources[0], false);

  const reopened = normalizeDocumentSchemaV2(JSON.parse(JSON.stringify(document)), { now: NOW });
  assert.deepEqual(reopened.citationSources, document.citationSources);
});

test("drops malformed or half independent-library pairs and retains legacy source-only links", () => {
  assert.deepEqual(normalizeCitationResearchIdentity({
    researchLibraryId: IDS[3],
    researchSourceId: IDS[4],
  }), { researchLibraryId: IDS[3], researchSourceId: IDS[4] });
  assert.deepEqual(normalizeCitationResearchIdentity({ researchLibraryId: IDS[3] }), {});
  assert.deepEqual(normalizeCitationResearchIdentity({
    researchLibraryId: "not-a-library",
    researchSourceId: IDS[4],
  }), {});
  assert.deepEqual(normalizeCitationResearchIdentity({ researchSourceId: "legacy_note_01" }), {
    researchSourceId: "legacy_note_01",
  });
  assert.deepEqual(normalizeCitationResearchIdentity({ researchSourceId: "bad id" }), {});
});

test("normalizes internal links and reference-node metadata", () => {
  assert.deepEqual(normalizeInternalLinkMetadata({
    targetDocumentId: IDS[0].toUpperCase(),
    targetTitle: "目标",
    label: "阅读目标",
    pathHint: "资料/目标.letterpaper",
  }), {
    documentId: IDS[0],
    title: "目标",
    label: "阅读目标",
    pathHint: "资料/目标.letterpaper",
  });
  assert.equal(normalizeInternalLinkMetadata({ documentId: "bad" }), null);
  assert.deepEqual(createInternalLinkMetadata({ documentId: IDS[0], title: "目标" }), {
    documentId: IDS[0], title: "目标", label: "目标", pathHint: "",
  });
  assert.deepEqual(normalizeFootnoteReferenceMetadata({ footnoteId: IDS[1] }), { footnoteId: IDS[1] });
  assert.deepEqual(normalizeCitationReferenceMetadata({ sourceId: IDS[2], pages: "12-14", prefix: "参见" }), {
    sourceId: IDS[2], pages: "12-14", prefix: "参见", suffix: "",
  });
});

test("creates a fresh derived identity for Save As and Copy Backup", () => {
  assert.deepEqual(createDerivedDocumentIdentity(IDS[0], { idFactory: () => IDS[1] }), {
    documentId: IDS[1],
    derivedFrom: IDS[0],
  });
  assert.throws(() => createDerivedDocumentIdentity("bad", { idFactory: () => IDS[1] }), /有效的源 documentId/);
  assert.throws(() => createDerivedDocumentIdentity(IDS[0], { idFactory: () => IDS[0] }), /不能与源文档相同/);
});

test("merges a persisted Save As identity without discarding newer live edits", () => {
  const live = { version: 2, documentId: IDS[0], title: "保存期间的新标题", html: "<p>更新后的正文</p>", footnotes: [{ id: IDS[2], text: "新脚注" }] };
  const merged = mergePersistedDocumentIdentity(live, { version: 2, documentId: IDS[1], derivedFrom: IDS[0], title: "旧标题", html: "<p>旧正文</p>" });
  assert.equal(merged.documentId, IDS[1]);
  assert.equal(merged.derivedFrom, IDS[0]);
  assert.equal(merged.title, live.title);
  assert.equal(merged.html, live.html);
  assert.deepEqual(merged.footnotes, live.footnotes);
  assert.throws(() => mergePersistedDocumentIdentity(live, { version: 2, documentId: "bad" }), /documentId/);
});
