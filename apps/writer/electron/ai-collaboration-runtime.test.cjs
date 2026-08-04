const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAiCollaborationRuntime } = require("./ai-collaboration-runtime.cjs");

function inside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function runtimeHarness(root, overrides = {}) {
  const runtime = createAiCollaborationRuntime({
    completeTask: overrides.completeTask || (async () => ({ text: "{}", model: {} })),
    fs,
    path,
    createHash: crypto.createHash,
    randomUUID: crypto.randomUUID,
    getUserDataPath: () => root,
    atomicWriteFile: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
    assertAuthorizedDirectory: async (folderPath) => {
      if (path.resolve(folderPath) !== path.resolve(root)) throw new Error("unauthorized");
      return root;
    },
    isPathInside: inside,
    isSupportedDocument: (filePath) => filePath.endsWith(".letterpaper"),
    walkWorkspaceDocuments: async () => ({ documents: [] }),
    readSearchDocument: async () => ({}),
    searchWorkspace: async () => ({ results: [] }),
    loadPaperDocument: async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8")),
    savePaperDocument: async (filePath, document) => {
      await fs.writeFile(filePath, JSON.stringify(document), "utf8");
      return { document, diskRevision: { size: JSON.stringify(document).length, mtimeMs: 1, sha256: "a".repeat(64) } };
    },
    authorizeDocumentPath: async () => {},
    normalizeDocument: (document) => document,
    createEmptyAiState: () => ({ version: 4, chat: { pendingReview: null }, optimize: {} }),
    htmlToSearchText: (html) => String(html).replace(/<[^>]+>/g, " "),
    emitEvent: overrides.emitEvent,
    writeDebugLog: overrides.writeDebugLog,
  });
  await runtime.initialize();
  return runtime.facade;
}

test("collaboration planning reports model stages and keeps valid edits without a second request for an empty sibling", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-collaboration-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const events = [];
  const logs = [];
  let requests = 0;
  const facade = await runtimeHarness(root, {
    emitEvent: (_sender, payload) => events.push(payload),
    writeDebugLog: async (name, payload) => logs.push({ name, payload }),
    completeTask: async ({ onDelta }) => {
      requests += 1;
      onDelta?.("{");
      return {
        text: JSON.stringify({
          type: "proposal",
          reply: "已整理",
          operations: [
            { type: "replace_blocks", targetBlockIds: ["block-1"], blocks: [{ type: "paragraph", text: "整理后的正文" }] },
            { type: "insert_after", anchorBlockId: "block-1", blocks: [] },
          ],
        }),
        model: { modelId: "test" },
      };
    },
  });
  const result = await facade.plan({}, {
    requestId: "ai-collaboration-test-plan",
    provider: "test",
    modelId: "test",
    question: "整理正文",
    current: {
      documentId: "document-1",
      title: "测试信笺",
      content: "原正文",
      revision: "1",
      manifest: {
        documentFingerprint: "doc-1",
        blocks: [{ id: "block-1", index: 0, type: "paragraph", text: "原正文", protected: false }],
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(requests, 1);
  assert.equal(result.proposal.operations.length, 1);
  assert.equal(result.timing.modelRequests, 1);
  assert.deepEqual(
    events.filter((entry) => ["waiting-model", "receiving-model", "validating", "normalizing"].includes(entry.type)).map((entry) => entry.type),
    ["waiting-model", "receiving-model", "validating", "normalizing"],
  );
  assert.equal(logs.some((entry) => entry.name === "ai-collaboration:model-request"), true);
});

test("collaboration commit stages derived files, copies rich blocks, and keeps only referenced metadata", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-collaboration-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const facade = await runtimeHarness(root);
  const sourceDocument = {
    documentId: "10000000-0000-4000-8000-000000000001",
    title: "来源",
    html: "<p>来源正文</p>",
    templateId: "fiber",
    letterTemplateId: "fiber-letter",
    footnotes: [
      { id: "20000000-0000-4000-8000-000000000001", text: "保留脚注" },
      { id: "20000000-0000-4000-8000-000000000002", text: "丢弃脚注" },
    ],
    citationSources: [
      { id: "30000000-0000-4000-8000-000000000001", title: "保留文献" },
      { id: "30000000-0000-4000-8000-000000000002", title: "丢弃文献" },
    ],
    comments: [{ id: "comment" }],
    aiState: { version: 4, chat: { messages: [{ role: "user", content: "secret" }] } },
  };
  const prepared = await facade.prepareCommit({
    workspaceRoot: root,
    proposalId: "proposal-1",
    currentDocumentId: sourceDocument.documentId,
    sourceDocument,
    sources: [],
    outputs: [{
      title: "派生稿",
      fileName: "派生稿.letterpaper",
      folderRelativePath: "",
      html: "<h2>新标题</h2>",
      copiedHtml: `<p><sup data-footnote-id="${sourceDocument.footnotes[0].id}"></sup><span data-citation-source-id="${sourceDocument.citationSources[0].id}"></span>原样块</p>`,
      sourceDocumentIds: [sourceDocument.documentId],
      sourceBlockIds: ["block-1"],
    }],
  });
  assert.equal(prepared.ok, true);
  assert.equal(await fs.stat(path.join(root, "派生稿.letterpaper")).then(() => true).catch(() => false), false);

  const committed = await facade.commitPrepared(prepared.commitId);
  assert.equal(committed.ok, true);
  const derived = JSON.parse(await fs.readFile(path.join(root, "派生稿.letterpaper"), "utf8"));
  assert.equal(derived.title, "派生稿");
  assert.equal(derived.letterTemplateId, sourceDocument.letterTemplateId);
  assert.match(derived.html, /新标题/);
  assert.match(derived.html, /原样块/);
  assert.deepEqual(derived.footnotes.map((item) => item.id), [sourceDocument.footnotes[0].id]);
  assert.deepEqual(derived.citationSources.map((item) => item.id), [sourceDocument.citationSources[0].id]);
  assert.deepEqual(derived.comments, []);
  assert.deepEqual(derived.aiState.chat.pendingReview, null);
});

test("collaboration prepare rejects conflicts and hidden target folders without overwriting", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-collaboration-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const facade = await runtimeHarness(root);
  await fs.writeFile(path.join(root, "已存在.letterpaper"), "unchanged", "utf8");
  const payload = {
    workspaceRoot: root,
    currentDocumentId: "document-1",
    sourceDocument: { documentId: "document-1", title: "来源", html: "<p>来源</p>" },
    sources: [],
    outputs: [{ title: "新稿", fileName: "已存在.letterpaper", folderRelativePath: "", html: "<p>新稿</p>" }],
  };
  await assert.rejects(() => facade.prepareCommit(payload), /文件已存在/);
  assert.equal(await fs.readFile(path.join(root, "已存在.letterpaper"), "utf8"), "unchanged");
  await assert.rejects(() => facade.prepareCommit({
    ...payload,
    outputs: [{ ...payload.outputs[0], fileName: "新稿.letterpaper", folderRelativePath: ".paperwriter" }],
  }), /目录无效/);
});

test("restored collaboration review becomes stale when a read source changed on disk", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-collaboration-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const facade = await runtimeHarness(root);
  const sourcePath = path.join(root, "来源.letterpaper");
  const source = {
    documentId: "10000000-0000-4000-8000-000000000002",
    title: "来源",
    html: "<p>原始内容</p>",
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
  await fs.writeFile(sourcePath, JSON.stringify(source), "utf8");
  const stat = await fs.stat(sourcePath);
  const fingerprint = `source-${crypto.createHash("sha256").update(JSON.stringify({
    documentId: source.documentId,
    title: source.title,
    html: source.html,
    updatedAt: source.updatedAt,
  })).digest("hex").slice(0, 32)}`;
  const payload = {
    workspaceRoot: root,
    currentDocumentId: "current-document",
    sources: [{
      documentId: source.documentId,
      title: source.title,
      relativePath: "来源.letterpaper",
      fingerprint,
      revision: `${stat.size}:${stat.mtimeMs}`,
    }],
  };
  assert.deepEqual(await facade.validateProposalSources(payload), { ok: true, stale: false });
  await fs.writeFile(sourcePath, JSON.stringify({ ...source, html: "<p>已经发生很长的外部修改</p>" }), "utf8");
  const stale = await facade.validateProposalSources(payload);
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.match(stale.message, /外部修改|版本已变化/);
});
