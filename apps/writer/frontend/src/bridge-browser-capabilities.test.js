import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateAiApplyResolutionAgainstManifest } from "./ai-direct-apply.js";
import { browserBridge } from "./bridge.js";

test("browser apply resolver fails closed without changing or echoing AI content", async () => {
  const result = await browserBridge.resolveAiApply({
    manifest: { documentFingerprint: "doc-safe", blocks: [{ id: "block-1", text: "私密正文" }] },
    selectedBlock: { text: "绝不能由浏览器裁决改写" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.raw, {
    version: 1,
    action: "unresolved",
    targetBlockIds: [],
    confidence: 0,
    reason: "浏览器预览不会调用应用裁决模型；请在桌面端使用直接应用，或复制后手动粘贴。",
    documentFingerprint: "doc-safe",
  });
  assert.doesNotMatch(JSON.stringify(result), /私密正文|绝不能/);
  const validated = validateAiApplyResolutionAgainstManifest(result.raw, {
    documentFingerprint: "doc-safe",
    blocks: [{ id: "block-1", index: 0, protected: false }],
  });
  assert.equal(validated.ok, true);
  assert.equal(validated.unresolved, true);
});

test("browser bridge saves applyResolver independently from the active model", async () => {
  const memory = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
  });
  try {
    memory.set("paperwriter.aiConfig", JSON.stringify({
      activeProvider: "gemini",
      activeModelId: "gemini-main",
      providers: {
        gemini: { activeModelId: "gemini-main", models: [{ id: "gemini-main", name: "Main", model: "gemini-main", testedOk: true }] },
        deepseek: { apiKey: "deepseek-key", activeModelId: "deepseek-resolver", models: [{ id: "deepseek-resolver", name: "Resolver", model: "deepseek-resolver", testedOk: true }] },
      },
    }));
    const saved = await browserBridge.saveAiConfig({
      taskModels: {
        applyResolver: {
          providerId: "deepseek",
          modelId: "deepseek-resolver",
          requestParams: { thinking: { type: "enabled" }, max_tokens: 2048 },
        },
      },
    });
    assert.equal(saved.activeProvider, "gemini");
    assert.deepEqual(saved.taskModels.applyResolver, {
      providerId: "deepseek",
      modelId: "deepseek-resolver",
      requestParams: { thinking: { type: "enabled" }, max_tokens: 2048 },
    });
    assert.deepEqual(JSON.parse(memory.get("paperwriter.aiConfig")).taskModels.applyResolver, saved.taskModels.applyResolver);
    await assert.rejects(
      () => browserBridge.saveAiConfig({
        taskModels: { applyResolver: { providerId: "deepseek", modelId: "deepseek-resolver", requestParams: { model: "escape" } } },
      }),
      /请求参数/,
    );
  } finally {
    delete globalThis.localStorage;
  }
});

test("browser bridge rejects disconnected or untested task models", async () => {
  const memory = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
  });
  try {
    memory.set("paperwriter.aiConfig", JSON.stringify({
      activeProvider: "gemini",
      providers: {
        gemini: {
          activeModelId: "gemini-main",
          models: [{ id: "gemini-main", name: "Main", model: "gemini-main", testedOk: true }],
        },
        deepseek: {
          apiKey: "deepseek-key",
          activeModelId: "deepseek-resolver",
          models: [{ id: "deepseek-resolver", name: "Resolver", model: "deepseek-resolver", testedOk: false }],
        },
      },
    }));
    await assert.rejects(
      () => browserBridge.saveAiConfig({
        taskModels: { applyResolver: { providerId: "gemini", modelId: "gemini-main" } },
      }),
      /已连接供应商中的已连接模型/,
    );
    await assert.rejects(
      () => browserBridge.saveAiConfig({
        taskModels: { applyResolver: { providerId: "deepseek", modelId: "deepseek-resolver" } },
      }),
      /已连接供应商中的已连接模型/,
    );
  } finally {
    delete globalThis.localStorage;
  }
});

test("browser workspace search is bounded to unsaved overrides", async () => {
  const result = await browserBridge.searchFolder({
    folderPath: "browser-preview",
    query: "needle",
    requestId: "request-1",
    overrides: [
      { path: "notes/one.letterpaper", document: { title: "One", author: "A", html: "<p>Find NEEDLE here</p>", updatedAt: "2026-01-01T00:00:00.000Z" } },
      { path: "notes/two.letterpaper", document: { title: "Two", author: "B", html: "<p>Nothing</p>" } },
    ],
  });
  assert.equal(result.canceled, false);
  assert.equal(result.browserOnly, true);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, "notes/one.letterpaper");
  assert.equal(result.results[0].snippet.slice(result.results[0].snippetMatchStart, result.results[0].snippetMatchStart + result.results[0].snippetMatchLength).toLowerCase(), "needle");
});

test("browser source library migrates web research, removes legacy notes and keeps citations isolated", async () => {
  const memory = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
  });
  const workspace = "browser-citation-workspace";
  const legacyKey = `paperwriter.preview.research.${workspace}`;
  try {
    memory.set(legacyKey, JSON.stringify([
      {
        id: "research-web-01",
        type: "web",
        title: "旧网页资料",
        url: "https://example.com/research",
      },
      {
        id: "research-note-01",
        type: "note",
        title: "旧研究笔记",
        notes: "legacy",
      },
    ]));
    const migrated = await browserBridge.listResearch(workspace);
    assert.equal(migrated.sources.length, 1);
    assert.equal(migrated.sources[0].title, "旧网页资料");

    const created = await browserBridge.upsertCitation(workspace, {
      type: "article",
      title: "来源标题",
      authors: "甲；乙",
      year: 2026,
      containerTitle: "期刊",
      url: "https://example.com/source",
      doi: "https://doi.org/10.1000/test",
      researchSourceId: "research-web-01",
    });
    assert.match(created.source.id, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    assert.deepEqual(created.source.authors, ["甲", "乙"]);
    assert.equal(created.source.doi, "10.1000/test");
    assert.equal((await browserBridge.listResearch(workspace)).sources.length, 1);
    assert.equal((await browserBridge.listCitations(workspace)).sources.length, 1);

    const stored = JSON.parse(memory.get(`paperwriter.preview.sources.${workspace}`));
    assert.deepEqual(stored.map((source) => source.kind).sort(), ["citation", "research"]);
    assert.equal(memory.has(legacyKey), false);

    const updated = await browserBridge.upsertCitation(workspace, { id: created.source.id, title: "修订标题" });
    assert.equal(updated.source.containerTitle, "期刊");
    assert.equal(updated.source.title, "修订标题");
    const removed = await browserBridge.deleteCitation(workspace, created.source.id);
    assert.equal(removed.sources.length, 0);
    assert.equal((await browserBridge.listResearch(workspace)).sources[0].title, "旧网页资料");
  } finally {
    delete globalThis.localStorage;
  }
});

test("browser citation snapshots round-trip independent library identities while offline", async () => {
  const memory = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
  });
  const workspace = "browser-independent-citation";
  const researchLibraryId = "11111111-1111-4111-8111-111111111111";
  const researchSourceId = "22222222-2222-4222-8222-222222222222";
  try {
    const created = await browserBridge.upsertCitation(workspace, {
      type: "pdf",
      title: "离线书目信息快照",
      pages: "18",
      researchLibraryId: researchLibraryId.toUpperCase(),
      researchSourceId: researchSourceId.toUpperCase(),
      researchRootPath: "C:\\不得进入浏览器存储\\资料",
    });
    assert.equal(created.source.researchLibraryId, researchLibraryId);
    assert.equal(created.source.researchSourceId, researchSourceId);

    const stored = JSON.parse(memory.get(`paperwriter.preview.sources.${workspace}`));
    assert.equal("researchRootPath" in stored[0], false);
    memory.delete(`paperwriter.preview.research-library.${researchLibraryId}.sources`);
    const offline = await browserBridge.listCitations(workspace);
    assert.equal(offline.sources[0].title, "离线书目信息快照");
    assert.equal(offline.sources[0].researchLibraryId, researchLibraryId);
    assert.equal(offline.sources[0].researchSourceId, researchSourceId);

    const half = await browserBridge.upsertCitation(workspace, {
      title: "半对标识",
      researchLibraryId,
    });
    assert.equal("researchLibraryId" in half.source, false);
    assert.equal("researchSourceId" in half.source, false);
    const invalid = await browserBridge.upsertCitation(workspace, {
      title: "非法配对",
      researchLibraryId: "invalid",
      researchSourceId,
    });
    assert.equal("researchLibraryId" in invalid.source, false);
    assert.equal("researchSourceId" in invalid.source, false);
    await assert.rejects(
      browserBridge.upsertCitation(workspace, { title: "旧版悬空标识", researchSourceId: "missing_source" }),
      /研究资料不存在/,
    );
  } finally {
    delete globalThis.localStorage;
  }
});

test("browser relationship derivation never scans outside supplied overrides", async () => {
  const targetId = "11111111-1111-4111-8111-111111111111";
  const currentId = "22222222-2222-4222-8222-222222222222";
  const result = await browserBridge.getWorkspaceRelationships({
    folderPath: "browser-preview",
    documentId: currentId,
    currentLinks: [{ documentId: targetId, title: "旧标题" }],
    overrides: [
      { path: "target.letterpaper", document: { documentId: targetId, title: "目标", html: "<p></p>" } },
      { path: "backlink.letterpaper", document: { documentId: "33333333-3333-4333-8333-333333333333", title: "反链", html: `<a data-document-id="${currentId}">当前</a>` } },
    ],
  });
  assert.equal(result.browserOnly, true);
  assert.equal(result.links[0].missing, false);
  assert.equal(result.links[0].title, "目标");
  assert.equal(result.backlinks.length, 1);
});

test("browser relationships keep legacy candidates without identities and exclude only the current path", async () => {
  const result = await browserBridge.getWorkspaceRelationships({
    folderPath: "browser-preview",
    currentPath: "CURRENT.letterpaper",
    documentId: "",
    overrides: [
      { path: "current.letterpaper", document: { title: "当前旧稿", html: "<p></p>" } },
      { path: "folder/legacy.letterpaper", document: { title: "可关联旧稿", html: "<p></p>" } },
      { path: "identified.letterpaper", document: { documentId: "11111111-1111-4111-8111-111111111111", title: "新版", html: "<p></p>" } },
    ],
  });
  assert.deepEqual(result.documents.map((document) => document.path), ["folder/legacy.letterpaper", "identified.letterpaper"]);
});

test("browser bridge exposes the desktop feature surface with explicit browser fallbacks", () => {
  const source = fs.readFileSync(fileURLToPath(new URL("./bridge.js", import.meta.url)), "utf8");
  for (const capability of [
    "importDocument", "exportEditable", "searchFolder", "cancelFolderSearch", "getWorkspaceRelationships",
    "watchWorkspace", "getDocumentRevision", "regenerateDocumentIdentity", "listResearch", "createResearch",
    "updateResearch", "deleteResearch", "relinkResearch", "readResearchFile", "openResearchExternal",
    "listCitations", "upsertCitation", "deleteCitation",
    "getResearchRoot", "pickResearchRoot", "clearResearchRoot", "listResearchFolder", "createResearchFolder",
    "importResearchFiles", "importLegacyResearch", "renameResearchEntry", "moveResearchEntry", "trashResearchEntry", "showResearchEntry",
    "copyResearchEntryPath", "listResearchLibrarySources", "upsertResearchLibrarySource", "deleteResearchLibrarySource",
    "listResearchWebTree", "upsertResearchWebSource", "createResearchWebFolder", "updateResearchWebFolder",
    "deleteResearchWebFolder", "moveResearchWebSource", "copyResearchWebSelection", "getWorkspaceIdentity",
    "listLibrarySources", "upsertLibrarySource", "deleteLibrarySource", "readResearchPdf", "openResearchEntryExternal",
    "watchResearchLibrary", "onResearchLibraryChanged", "onResearchLibraryWatchError",
    "showResearchWebView", "updateResearchWebViewBounds", "hideResearchWebView", "controlResearchWebView",
    "destroyResearchWebView", "onResearchWebViewState",
    "writeClipboardContent",
    "setFullscreen", "getFullscreen", "onFullscreenChanged", "onWorkspaceChanged", "onWindowFocus", "onWindowBlur",
  ]) {
    assert.match(source, new RegExp(`\\b${capability}:`), capability);
  }
  assert.match(source, /浏览器预览暂不支持 DOCX 导出/);
});
