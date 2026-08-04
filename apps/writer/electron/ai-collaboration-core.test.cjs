const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeIntentRoute,
  normalizeProposal,
  normalizeToolCalls,
  parseJsonResponse,
  planningMessages,
  validateProposal,
} = require("./ai-collaboration-core.cjs");

test("collaboration intent route distinguishes answers from mutations", () => {
  assert.equal(normalizeIntentRoute('{"mode":"answer","confidence":0.9}').mode, "answer");
  assert.equal(normalizeIntentRoute('{"mode":"collaborate","confidence":0.8}').mode, "collaborate");
  assert.throws(() => parseJsonResponse("not-json"));
});

test("collaboration tools allow only bounded search and read calls", () => {
  const calls = normalizeToolCalls({
    type: "tool_calls",
    calls: [
      { tool: "search_workspace_letters", query: "复盘", limit: 500 },
      { tool: "read_workspace_letters", paths: ["a.letterpaper", "../secret.letterpaper"] },
      { tool: "delete_document", path: "a.letterpaper" },
    ],
  });
  assert.deepEqual(calls.map((call) => call.tool), ["search_workspace_letters", "read_workspace_letters"]);
  assert.equal(calls[0].limit, 30);
  assert.deepEqual(calls[1].paths, ["a.letterpaper"]);
});

test("collaboration proposal drops file-management operations and validates block targets", () => {
  const proposal = normalizeProposal({
    type: "proposal",
    operations: [
      { type: "delete_document", path: "a.letterpaper" },
      { type: "set_title", title: "新标题" },
      { type: "insert_after", anchorBlockId: "block-1", blocks: [{ type: "mermaid", source: "flowchart LR\nA-->B" }] },
    ],
  }, {
    documentId: "document-1",
    documentFingerprint: "doc-1",
    sources: [{ documentId: "document-2", title: "来源稿", relativePath: "来源稿.letterpaper" }],
  });
  assert.deepEqual(proposal.operations.map((operation) => operation.type), ["set_title", "insert_after"]);
  assert.equal(validateProposal(proposal, { blocks: [{ id: "block-1", protected: false }] }).ok, true);
});

test("collaboration proposal recovers safe text aliases and ignores empty operations beside valid edits", () => {
  const proposal = normalizeProposal({
    operations: [
      { type: "replace_blocks", targetBlockIds: ["block-1"], blocks: [] },
      { type: "insert_after", anchorBlockId: "block-1", content: "整理后的补充内容" },
      { type: "insert_after", anchorBlockId: "block-1", blocks: [{ type: "mermaid", code: "flowchart LR\nA-->B" }] },
    ],
  }, { documentId: "document-1", documentFingerprint: "doc-1" });
  assert.deepEqual(proposal.operations.map((operation) => operation.type), ["insert_after", "insert_after"]);
  assert.equal(proposal.operations[0].blocks[0].text, "整理后的补充内容");
  assert.equal(proposal.operations[1].blocks[0].source, "flowchart LR\nA-->B");
  assert.equal(validateProposal(proposal, { blocks: [{ id: "block-1", protected: false }] }).ok, true);
});

test("collaboration planning sends block text once in a bounded valid JSON payload", () => {
  const marker = "只应出现一次的正文标记";
  const messages = planningMessages({
    current: {
      documentId: "document-1",
      title: "测试",
      content: marker,
      manifest: {
        documentFingerprint: "doc-1",
        blocks: [{ id: "block-1", index: 0, type: "paragraph", text: marker, protected: false }],
      },
    },
    question: "整理正文",
  });
  const payload = messages.at(-1).content;
  assert.doesNotThrow(() => JSON.parse(payload));
  assert.equal(payload.split(marker).length - 1, 1);
  assert.equal(JSON.parse(payload).currentLetter.contentCharacters, marker.length);

  const largePayload = planningMessages({
    current: {
      documentId: "document-1",
      title: "长文",
      content: "长".repeat(2 * 1024 * 1024),
      manifest: {
        documentFingerprint: "doc-1",
        blocks: Array.from({ length: 5000 }, (_, index) => ({
          id: `block_${String(index).padStart(5, "0")}_${"x".repeat(80)}`,
          index,
          type: "paragraph",
          text: "正文".repeat(300),
          protected: false,
        })),
      },
    },
    question: "整理长文",
  }).at(-1).content;
  assert.equal(largePayload.length < 2 * 1024 * 1024, true);
  assert.equal(JSON.parse(largePayload).currentLetter.contentTruncated, true);
});

test("derived collaboration documents retain only validated source references", () => {
  const proposal = normalizeProposal({
    operations: [{
      type: "create_document",
      title: "拆分稿",
      fileName: "拆分稿.letterpaper",
      folderRelativePath: ".paperwriter/private",
      sourceDocumentIds: ["document-2"],
      sourceBlockIds: ["block-1"],
      blocks: [],
    }],
  }, {
    documentId: "document-1",
    documentFingerprint: "doc-1",
    sources: [{ documentId: "document-2", title: "来源稿", relativePath: "来源稿.letterpaper" }],
  });
  assert.equal(proposal.operations[0].folderRelativePath, ".paperwriter/private");
  assert.deepEqual(proposal.operations[0].sourceBlockIds, ["block-1"]);
  assert.equal(validateProposal(proposal, { blocks: [{ id: "block-1", protected: false }] }).ok, false);
  proposal.operations[0].folderRelativePath = "派生";
  assert.equal(validateProposal(proposal, { blocks: [{ id: "block-1", protected: false }] }).ok, true);
  proposal.operations[0].sourceBlockIds = ["missing"];
  assert.equal(validateProposal(proposal, { blocks: [{ id: "block-1", protected: false }] }).ok, false);
});
