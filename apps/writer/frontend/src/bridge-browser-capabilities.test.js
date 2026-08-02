import assert from "node:assert/strict";
import test from "node:test";
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
    const withSelectionChat = await browserBridge.saveAiConfig({
      taskModels: {
        selectionChat: {
          providerId: "deepseek",
          modelId: "deepseek-resolver",
          requestParams: { temperature: 0.1 },
        },
      },
    });
    assert.deepEqual(withSelectionChat.taskModels.selectionChat, {
      providerId: "deepseek",
      modelId: "deepseek-resolver",
      requestParams: { temperature: 0.1 },
    });
    assert.deepEqual(
      withSelectionChat.taskModels.applyResolver,
      saved.taskModels.applyResolver,
    );
    const followingDefault = await browserBridge.saveAiConfig({
      taskModels: {
        selectionChat: {
          providerId: "",
          modelId: "",
          requestParams: {},
        },
      },
    });
    assert.deepEqual(followingDefault.taskModels.selectionChat, {
      providerId: "",
      modelId: "",
      requestParams: {},
    });
    assert.deepEqual(
      followingDefault.taskModels.applyResolver,
      saved.taskModels.applyResolver,
    );
    await assert.rejects(
      () => browserBridge.saveAiConfig({
        taskModels: { applyResolver: { providerId: "deepseek", modelId: "deepseek-resolver", requestParams: { model: "escape" } } },
      }),
      /请求参数/,
    );
    for (const taskModels of [
      null,
      { unknownTask: {} },
      {
        selectionChat: {
          providerId: "deepseek",
          requestParams: {},
        },
      },
      {
        selectionChat: {
          providerId: "",
          modelId: "",
          requestParams: null,
        },
      },
      {
        selectionChat: {
          providerId: "",
          modelId: "",
          requestParams: {},
          extra: true,
        },
      },
    ]) {
      await assert.rejects(
        () => browserBridge.saveAiConfig({ taskModels }),
        /任务模型|请求参数/,
      );
    }
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

test("browser selection generation honors its task model and exact cancel registry", async () => {
  const memory = new Map();
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
  });
  globalThis.window = globalThis;
  const errors = [];
  const unsubscribe = browserBridge.onAiError((event) => errors.push(event));
  try {
    memory.set("paperwriter.aiConfig", JSON.stringify({
      activeProvider: "gemini",
      activeModelId: "gemini-main",
      taskModels: {
        selectionChat: {
          providerId: "deepseek",
          modelId: "deepseek-selection",
          requestParams: {},
        },
      },
      providers: {
        gemini: {
          apiKey: "default-key",
          activeModelId: "gemini-main",
          models: [{
            id: "gemini-main",
            name: "Default",
            model: "gemini-main",
            testedOk: true,
          }],
        },
        deepseek: {
          apiKey: "selection-key",
          activeModelId: "deepseek-selection",
          models: [{
            id: "deepseek-selection",
            name: "Selection",
            model: "deepseek-selection",
            testedOk: true,
          }],
        },
      },
    }));
    const generated = await browserBridge.generateSelectionAi({
      requestId: "ai-selection-browser-123",
      selectedText: "只发送冻结选区",
      history: [],
      question: "解释它",
    });
    assert.equal(generated.ok, true);
    assert.equal(generated.model.providerId, "deepseek");
    assert.equal(generated.model.modelId, "deepseek-selection");

    const canceled = await browserBridge.cancelAi(
      "ai-selection-browser-123",
    );
    assert.deepEqual(canceled, { ok: true, canceled: true });
    assert.deepEqual(errors, [{
      requestId: "ai-selection-browser-123",
      message: "已停止生成",
      aborted: true,
    }]);

    const stored = JSON.parse(memory.get("paperwriter.aiConfig"));
    stored.taskModels.selectionChat.modelId = "deepseek-deleted";
    memory.set("paperwriter.aiConfig", JSON.stringify(stored));
    const stale = await browserBridge.generateSelectionAi({
      requestId: "ai-selection-browser-124",
      selectedText: "选区",
      history: [],
      question: "继续",
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, "AI_SELECTION_CHAT_MODEL_INVALID");

    stored.taskModels.selectionChat.modelId = "deepseek-selection";
    memory.set("paperwriter.aiConfig", JSON.stringify(stored));
    const activeIds = [];
    for (let index = 0; index < 4; index += 1) {
      const requestId = `ai-selection-browser-limit-${index}`;
      const started = await browserBridge.generateSelectionAi({
        requestId,
        selectedText: "选区",
        history: [],
        question: "限流测试",
      });
      assert.equal(started.ok, true);
      activeIds.push(requestId);
    }
    const limited = await browserBridge.generateSelectionAi({
      requestId: "ai-selection-browser-limit-4",
      selectedText: "选区",
      history: [],
      question: "第五个请求",
    });
    assert.equal(limited.code, "AI_SELECTION_REQUEST_LIMIT");
    await Promise.all(activeIds.map(
      (requestId) => browserBridge.cancelAi(requestId),
    ));
  } finally {
    unsubscribe();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
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

test("browser public citations migrate once and remain independent from document snapshots", async () => {
  const memory = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
    },
  });
  const workspace = "browser-public-citation-migration";
  try {
    const snapshot = await browserBridge.upsertCitation(workspace, {
      title: "信笺快照",
      authors: ["甲"],
      year: 2026,
      doi: "10.1000/public-test",
    });
    const migrated = await browserBridge.migrateWorkspaceCitationsToPublic(workspace);
    assert.equal(migrated.migrated, true);
    assert.equal(migrated.imported, 1);
    const repeated = await browserBridge.migrateWorkspaceCitationsToPublic(workspace);
    assert.equal(repeated.alreadyMigrated, true);
    assert.equal(repeated.sources.length, 1);

    const publicUpdate = await browserBridge.upsertPublicCitation({
      ...repeated.sources[0],
      title: "公域修订标题",
    });
    assert.equal(publicUpdate.source.title, "公域修订标题");
    assert.equal((await browserBridge.listCitations(workspace)).sources[0].title, "信笺快照");

    await browserBridge.deletePublicCitation(publicUpdate.source.id);
    assert.equal((await browserBridge.listPublicCitations()).sources.length, 0);
    assert.equal((await browserBridge.listCitations(workspace)).sources[0].id, snapshot.source.id);
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

test("browser bridge exposes the desktop feature surface with explicit browser fallbacks", async () => {
  for (const capability of [
    "importDocument", "exportEditable", "searchFolder", "cancelFolderSearch", "getWorkspaceRelationships",
    "watchWorkspace", "getDocumentRevision", "regenerateDocumentIdentity", "listResearch", "createResearch",
    "updateResearch", "deleteResearch", "relinkResearch", "readResearchFile", "openResearchExternal",
    "listCitations", "upsertCitation", "deleteCitation",
    "listPublicCitations", "upsertPublicCitation", "deletePublicCitation", "migrateWorkspaceCitationsToPublic",
    "getResearchRoot", "pickResearchRoot", "clearResearchRoot", "listResearchFolder", "createResearchFolder",
    "importResearchFiles", "importLegacyResearch", "renameResearchEntry", "moveResearchEntry", "trashResearchEntry", "showResearchEntry",
    "copyResearchEntryPath", "listResearchLibrarySources", "upsertResearchLibrarySource", "deleteResearchLibrarySource",
    "listResearchWebTree", "upsertResearchWebSource", "createResearchWebFolder", "updateResearchWebFolder",
    "deleteResearchWebFolder", "moveResearchWebSource", "copyResearchWebSelection", "getWorkspaceIdentity",
    "listLibrarySources", "upsertLibrarySource", "deleteLibrarySource", "readResearchPdf", "openResearchEntryExternal",
    "searchResearch", "cancelResearchSearch", "watchResearchLibrary", "onResearchLibraryChanged", "onResearchLibraryWatchError",
    "onResearchSearchProgress",
    "showResearchWebView", "updateResearchWebViewBounds", "hideResearchWebView", "controlResearchWebView",
    "destroyResearchWebView", "onResearchWebViewState",
    "writeClipboardContent",
    "setFullscreen", "getFullscreen", "onFullscreenChanged", "onWorkspaceChanged", "onWindowFocus", "onWindowBlur",
  ]) {
    assert.equal(typeof browserBridge[capability], "function", capability);
  }
  await assert.rejects(
    () => browserBridge.pickExportPath("docx"),
    /浏览器预览暂不支持 DOCX 导出/,
  );
});
