import assert from "node:assert/strict";
import test from "node:test";
import {
  collaborationBlocksToReviewText,
  collaborationBlocksToTiptapContent,
  normalizeCollaborationProposal,
  parseCollaborationReviewText,
  validateCollaborationProposal,
} from "./ai-collaboration/protocol.js";

const manifest = {
  documentFingerprint: "doc-fingerprint",
  blocks: [
    { id: "block-1-a", index: 0, from: 0, to: 5, protected: false },
    { id: "block-2-b", index: 1, from: 5, to: 10, protected: false },
  ],
};

test("collaboration proposal accepts only current-document and derived-document operations", () => {
  const result = validateCollaborationProposal({
    version: 1,
    base: { documentId: "document-1", documentFingerprint: "doc-fingerprint" },
    operations: [
      { id: "title", type: "set_title", title: "新标题 😀" },
      {
        id: "table",
        type: "insert_after",
        anchorBlockId: "block-1-a",
        blocks: [{ type: "table", headers: ["项目", "值"], rows: [["A", "1"]] }],
      },
      {
        id: "derived",
        type: "create_document",
        title: "拆分一",
        fileName: "拆分一",
        blocks: [{ type: "paragraph", text: "派生正文" }],
      },
    ],
  }, manifest, { documentId: "document-1" });
  assert.equal(result.ok, true);
  assert.equal(result.proposal.operations[2].fileName, "拆分一.letterpaper");
});

test("collaboration proposal rejects stale, protected, and overlapping targets", () => {
  const protectedManifest = {
    ...manifest,
    blocks: manifest.blocks.map((block, index) => ({ ...block, protected: index === 1 })),
  };
  const result = validateCollaborationProposal({
    base: { documentFingerprint: "stale" },
    operations: [{
      type: "replace_blocks",
      targetBlockIds: ["block-1-a", "block-2-b"],
      blocks: [{ type: "paragraph", text: "替换" }],
    }],
  }, protectedManifest);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /版本已经变化/);
  assert.match(result.errors.join("\n"), /受保护/);
});

test("review text round trips tables and Mermaid into native nodes", () => {
  const blocks = [
    { type: "heading", level: 2, text: "数据" },
    { type: "table", headers: ["项目", "值"], rows: [["A", "1"]] },
    { type: "mermaid", source: "flowchart LR\nA-->B", caption: "数据流" },
  ];
  const reviewText = collaborationBlocksToReviewText(blocks);
  const parsed = parseCollaborationReviewText(reviewText);
  assert.deepEqual(parsed.map((block) => block.type), ["heading", "table", "mermaid"]);
  const nodes = collaborationBlocksToTiptapContent(parsed);
  assert.equal(nodes.at(-1).type, "paperMermaid");
  assert.equal(nodes.at(-1).attrs.caption, "数据流");
});

test("unknown operation types are removed during normalization", () => {
  const proposal = normalizeCollaborationProposal({
    operations: [
      { type: "delete_document", path: "anything" },
      { type: "paragraph", text: "anything" },
    ],
  });
  assert.deepEqual(proposal.operations, []);
});

test("collaboration operations start unreviewed and retain explicit decisions", () => {
  const proposal = normalizeCollaborationProposal({
    operations: [
      { id: "pending", type: "set_title", title: "待审阅", selected: true },
      { id: "accepted", type: "set_title", title: "已接受", decision: "accepted" },
      { id: "rejected", type: "set_title", title: "已拒绝", decision: "rejected" },
    ],
  });
  assert.deepEqual(
    proposal.operations.map((operation) => [operation.decision, operation.selected]),
    [["pending", false], ["accepted", true], ["rejected", false]],
  );
});

test("derived documents may copy validated current rich-text blocks without model rewrites", () => {
  const result = validateCollaborationProposal({
    base: { documentId: "document-1", documentFingerprint: "doc-fingerprint" },
    operations: [{
      id: "split",
      type: "create_document",
      title: "拆分稿",
      fileName: "拆分稿",
      folderRelativePath: ".paperwriter/private",
      sourceDocumentIds: ["document-1"],
      sourceBlockIds: ["block-1-a"],
      blocks: [],
    }],
  }, manifest, { documentId: "document-1" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("；"), /目标文件夹无效/);
  assert.equal(result.proposal.operations[0].folderRelativePath, ".paperwriter/private");
  assert.deepEqual(result.proposal.operations[0].sourceBlockIds, ["block-1-a"]);

  const stale = validateCollaborationProposal({
    ...result.proposal,
    operations: [{ ...result.proposal.operations[0], sourceBlockIds: ["missing"] }],
  }, manifest, { documentId: "document-1" });
  assert.equal(stale.ok, false);
});
