const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const documentModel = require("./document-model.cjs");

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];

test("exports the unchanged document extensions, filters, schema, and naming helpers", () => {
  assert.equal(documentModel.DOCUMENT_EXTENSION, ".letterpaper");
  assert.equal(documentModel.LEGACY_DOCUMENT_EXTENSION, ".paperdoc");
  assert.equal(documentModel.DOCUMENT_SCHEMA_VERSION, 3);
  assert.deepEqual(documentModel.DOCUMENT_FILTERS, [
    { name: "笺间文档", extensions: ["letterpaper"] },
    {
      name: "旧版 PaperWriter 文档",
      extensions: ["paperdoc"],
    },
    { name: "All Files", extensions: ["*"] },
  ]);
  assert.equal(
    documentModel.isSupportedDocument("C:\\稿件\\A.LETTERPAPER"),
    true,
  );
  assert.equal(
    documentModel.isSupportedDocument("C:\\稿件\\A.paperdoc"),
    true,
  );
  assert.equal(
    documentModel.isSupportedDocument("C:\\稿件\\A.docx"),
    false,
  );
  assert.equal(
    documentModel.sanitizeName("  CON<>  ", "未命名"),
    "未命名",
  );
  assert.equal(
    documentModel.timestampForFileName(
      new Date(2026, 6, 25, 9, 8, 7),
    ),
    "20260725_090807",
  );
  assert.equal(
    documentModel.formatPaperDate("2026-07-25T00:00:00"),
    "2026 年 7 月 25 日",
  );
  assert.equal(documentModel.formatPaperDate("invalid"), "今天");
});

test("v2 document normalization migrates to v3 and round-trips stable model fields", () => {
  const source = {
    version: 2,
    documentId: IDS[0].toUpperCase(),
    derivedFrom: IDS[1],
    title: "  标题  ",
    author: " 作者 ",
    html: "<p>正文</p>",
    letterTemplateId: "letter",
    templateId: "warm",
    fontFamily: "Test Font",
    fontSize: 20,
    layoutMode: "legacy-layout",
    customBackground: "data:image/png;base64,AA==",
    createdAt: "2026-07-24T00:00:00.000Z",
    displayDate: "七月二十四日",
    updatedAt: "2026-07-25T00:00:00.000Z",
    footnotes: [{
      id: IDS[2],
      text: " 脚注 ",
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    }],
    citationSources: [{
      id: IDS[3],
      type: "book",
      title: " 书名 ",
      authors: [" 作者甲 "],
      year: "2026",
      researchSourceId: "legacy_note_01",
    }],
    comments: [{
      id: "comment-1",
      from: 2,
      to: 5,
      text: " 评论 ",
      quote: " 正文 ",
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    }],
    aiState: documentModel.createEmptyAiState(),
    preservedExtensionField: { keep: true },
  };
  const once = documentModel.normalizeDocument(source);
  const twice = documentModel.normalizeDocument(once);

  assert.deepEqual(twice, once);
  assert.equal(once.version, 3);
  assert.equal(once.documentId, IDS[0]);
  assert.equal(once.title, "标题");
  assert.equal(Object.hasOwn(once, "layoutMode"), false);
  assert.deepEqual(once.preservedExtensionField, { keep: true });
  assert.equal(once.footnotes[0].text, "脚注");
  assert.equal(once.citationSources[0].researchSourceId, "legacy_note_01");
  assert.equal(once.comments[0].text, "评论");
});

test("legacy schemas migrate to v3 while future schemas preserve read-only boundaries", () => {
  const legacy = documentModel.normalizeDocument({
    version: 1,
    title: "",
    html: "",
    fontSize: 99,
    unknownLegacyField: "drop-me",
  });
  assert.equal(legacy.version, 3);
  assert.match(legacy.documentId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(legacy.footnotes, []);
  assert.deepEqual(legacy.citationSources, []);
  assert.equal("unknownLegacyField" in legacy, false);
  assert.equal(legacy.title, "未命名信笺");
  assert.equal(legacy.html, "<p></p>");
  assert.equal(legacy.fontSize, 32);
  assert.equal(Object.hasOwn(legacy, "layoutMode"), false);

  const future = documentModel.normalizeDocument({
    version: 9,
    documentId: IDS[0],
    title: "未来信笺",
    html: "<p>未来</p>",
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-25T00:00:00.000Z",
    layoutMode: "legacy-layout",
    futureOnlyField: { retain: true },
  });
  assert.equal(future.version, 9);
  assert.equal(future.documentId, IDS[0]);
  assert.equal(future._readOnlyFutureSchema, true);
  assert.equal(Object.hasOwn(future, "layoutMode"), false);
  assert.deepEqual(future.futureOnlyField, { retain: true });
  assert.equal(
    "_readOnlyFutureSchema"
      in documentModel.normalizeDocument({ version: 2 }),
    false,
  );
});

test("footnotes normalize UUIDs, timestamps, bounds, and duplicate identities", () => {
  const normalized = documentModel.normalizeDocumentFootnotes([
    {
      id: IDS[0].toUpperCase(),
      text: " 第一条 ",
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "invalid",
    },
    {
      id: IDS[0],
      text: "重复条目",
    },
    {
      id: "invalid",
      text: " 第二条 ",
    },
    {
      id: IDS[1],
      text: "   ",
    },
  ]);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0], {
    id: IDS[0],
    text: "第一条",
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
  });
  assert.match(
    normalized[1].id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(normalized[1].text, "第二条");
  assert.equal(
    Number.isFinite(Date.parse(normalized[1].createdAt)),
    true,
  );
});

test("citation snapshots retain only portable paired or legacy research identities", () => {
  const normalized = documentModel.normalizeCitationSources([
    {
      id: IDS[0],
      type: "pdf",
      title: "独立资料",
      researchLibraryId: IDS[3].toUpperCase(),
      researchSourceId: IDS[4].toUpperCase(),
      absolutePath: "C:\\private\\source.pdf",
    },
    {
      id: IDS[1],
      title: "坏配对",
      researchLibraryId: IDS[3],
    },
    {
      id: IDS[2],
      title: "旧版来源",
      researchSourceId: "legacy_note_01",
    },
  ]);
  assert.deepEqual(
    {
      researchLibraryId: normalized[0].researchLibraryId,
      researchSourceId: normalized[0].researchSourceId,
    },
    {
      researchLibraryId: IDS[3],
      researchSourceId: IDS[4],
    },
  );
  assert.equal("absolutePath" in normalized[0], false);
  assert.equal("researchLibraryId" in normalized[1], false);
  assert.equal("researchSourceId" in normalized[1], false);
  assert.equal(normalized[2].researchSourceId, "legacy_note_01");
  assert.deepEqual(
    documentModel.normalizeCitationSources(normalized),
    normalized,
  );
});

test("v3 citation styles preserve only hash-bound passive custom CSL", () => {
  const xml = '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><title>本地样式</title><id>local</id></info><citation><layout><text variable="title"/></layout></citation><bibliography><layout><text variable="title"/></layout></bibliography></style>';
  const hash = createHash("sha256").update(xml, "utf8").digest("hex");
  const styleId = `custom-${hash.slice(0, 24)}`;
  const normalized = documentModel.normalizeCitationStyle({
    styleId,
    locale: "zh-CN",
    customStyle: {
      styleId,
      title: "本地样式",
      hash,
      xml,
    },
  });
  assert.equal(normalized.customStyle.hash, hash);
  assert.equal(normalized.customStyle.xml, xml);
  assert.deepEqual(
    documentModel.normalizeCitationStyle({
      ...normalized,
      customStyle: { ...normalized.customStyle, hash: "0".repeat(64) },
    }),
    { styleId, locale: "zh-CN" },
  );
  assert.equal(
    documentModel.normalizeCitationStyle({
      styleId,
      customStyle: {
        styleId,
        hash,
        xml: '<!DOCTYPE style><style xmlns="http://purl.org/net/xbiblio/csl"></style>',
      },
    }).customStyle,
    undefined,
  );
});

test("comments preserve ranges and timestamps while rejecting empty anchors", () => {
  const normalized = documentModel.normalizeDocumentComments([
    {
      id: "same",
      from: 9,
      to: 2,
      text: " 评论 ",
      quote: " 引文 ",
      createdAt: "created",
      updatedAt: "updated",
    },
    {
      id: "same",
      from: 1,
      to: 3,
      text: "第二条",
    },
    {
      id: "empty",
      from: 1,
      to: 1,
      text: "无范围",
    },
  ]);
  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized[0], {
    id: "same",
    from: 2,
    to: 9,
    text: "评论",
    quote: "引文",
    createdAt: "created",
    updatedAt: "updated",
  });
  assert.equal(normalized[1].id, "same-1");
});

test("saved AI state keeps schema defaults, bounds, own images, and safe Codex modes", () => {
  const inheritedImages = {
    inherited: { src: "must-not-survive" },
  };
  const images = Object.create(inheritedImages);
  images.own = {
    number: 0,
    caption: "图",
    src: "asset://image",
    width: "90%",
  };
  const normalized = documentModel.normalizeSavedAiState({
    version: 99,
    lastMode: "chat",
    optimize: {
      status: "streaming",
      output: "result",
      assets: {
        images,
        quotes: [{ text: "摘录" }],
      },
      elapsedSeconds: -1,
      tokenStats: {
        totalTokens: -2,
        cachedTokens: 3,
        estimated: true,
      },
    },
    chat: {
      status: "streaming",
      codexScope: {
        mode: "directory",
        relativePath: "../../private",
      },
      codexImageMode: "unsafe",
      messages: [{
        id: "message",
        role: "system",
        content: "hello",
        status: "unknown",
        createdAt: 123,
      }],
      selectedTexts: [{
        id: "",
        text: "选择",
        from: 2,
        to: 4,
      }],
    },
  });

  assert.equal(normalized.version, 3);
  assert.equal(normalized.lastMode, "chat");
  assert.deepEqual(Object.keys(normalized.optimize.assets.images), [
    "own",
  ]);
  assert.equal(normalized.optimize.assets.images.own.number, 1);
  assert.equal(normalized.optimize.status, "ready");
  assert.equal(normalized.optimize.elapsedSeconds, 0);
  assert.deepEqual(normalized.optimize.tokenStats, {
    totalTokens: 0,
    estimated: true,
    cachedTokens: 3,
  });
  assert.deepEqual(normalized.chat.codexScope, {
    mode: "document-only",
    relativePath: "",
  });
  assert.equal(normalized.chat.codexImageMode, "original");
  assert.equal(normalized.chat.messages[0].role, "user");
  assert.equal(normalized.chat.messages[0].status, "done");
  assert.equal(normalized.chat.selectedTexts[0].id, "selection-0");
  assert.equal(normalized.chat.status, "idle");
});

test("main, storage runtime, and registrars share one document model boundary", async () => {
  const [
    mainSource,
    modelSource,
    openSource,
    saveSource,
    workspaceSource,
    researchSource,
    storageSource,
  ] = await Promise.all([
    fs.readFile(path.join(__dirname, "main.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "document-model.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "document-open-ipc.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "document-save-ipc.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "workspace-folder-ipc.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "research-library-ipc.cjs"), "utf8"),
    fs.readFile(path.join(__dirname, "document-storage-runtime.cjs"), "utf8"),
  ]);

  assert.equal(
    (mainSource.match(/require\("\.\/document-model\.cjs"\)/g) || []).length,
    1,
  );
  assert.doesNotMatch(
    mainSource,
    /function (?:normalizeDocument|normalizeDocumentId|normalizeSavedAiState|normalizeCitationSources|normalizeDocumentFootnotes|normalizeDocumentComments|createEmptyAiState|formatPaperDate|isSupportedDocument|sanitizeName|timestampForFileName)\b/,
  );
  assert.equal(
    (mainSource.match(/\bdocumentModel,\s*$/gm) || []).length,
    5,
  );

  for (const source of [
    openSource,
    saveSource,
    workspaceSource,
    researchSource,
  ]) {
    assert.match(source, /\bdocumentModel,/);
    assert.match(source, /\}\s*=\s*documentModel;/);
  }

  assert.doesNotMatch(
    modelSource,
    /require\("\.\/(?:asset-packager|document-assets|document-storage|autosave-ipc)\.cjs"\)/,
  );
  assert.doesNotMatch(
    modelSource,
    /\b(?:assetZipCache|assetZipPending|documentSaveQueues|runDocumentMutation|autosaveSessionPath)\b/,
  );
  assert.match(storageSource, /\bdocumentModel,/);
  assert.match(storageSource, /const documentWriteQueue = createPathWriteQueue/);
  assert.match(storageSource, /const documentMutationQueue = createPathWriteQueue/);
  assert.doesNotMatch(
    mainSource,
    /\b(?:documentWriteQueue|documentMutationQueue|savePaperDocumentWithinTransaction|canonicalAutosaveRoot)\b/,
  );
});
