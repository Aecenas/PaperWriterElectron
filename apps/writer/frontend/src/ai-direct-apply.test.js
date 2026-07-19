import assert from "node:assert/strict";
import test from "node:test";
import {
  aiApplyOperationNeedsConfirmation,
  aiResultBlockToSafeHtml,
  aiResultBlockToTiptapContent,
  buildAiApplyBlockManifest,
  createAiDirectApplyOperation,
  createManualAiDirectApplyOperation,
  createRebasedAiDirectApplyOperation,
  doesAiApplyManifestMatchDocument,
  findCommentsOverlappingAiApplyOperation,
  fingerprintAiApplyDocument,
  resolveAiDirectApplyWithRepair,
  toAiApplyResolverManifest,
  shouldRetryAiApplyResolution,
  validateAiApplyResolution,
  validateAiApplyResolutionAgainstManifest,
  validateContinuousAiApplyRange,
} from "./ai-direct-apply.js";

const document = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "定稿标题" }] },
    { type: "paragraph", content: [{ type: "text", text: "定稿正文" }] },
    { type: "paperFinalizedBreak" },
    { type: "paragraph", content: [{ type: "text", text: "待优化一" }] },
    { type: "paragraph", content: [{ type: "text", text: "待优化二" }] },
    { type: "image", attrs: { src: "assets/photo.png" } },
  ],
};

test("builds deterministic block positions, identities and finalized protections", () => {
  const manifest = buildAiApplyBlockManifest(document);
  assert.equal(manifest.blocks.length, 6);
  assert.equal(manifest.finalizedBoundaryIndex, 2);
  assert.equal(manifest.blocks[0].from, 0);
  assert.equal(manifest.blocks[1].from, manifest.blocks[0].to);
  assert.equal(manifest.blocks[0].protected, true);
  assert.deepEqual(manifest.blocks[0].protectionReasons, ["finalized"]);
  assert.equal(manifest.blocks[2].protected, true);
  assert.equal(manifest.blocks[3].protected, false);
  assert.equal(manifest.blocks[5].protected, true);
  assert.deepEqual(buildAiApplyBlockManifest(document), manifest);
  assert.equal(doesAiApplyManifestMatchDocument(manifest, document), true);
  assert.equal(doesAiApplyManifestMatchDocument(manifest, { ...document, content: [...document.content, { type: "paragraph" }] }), false);
  assert.equal(fingerprintAiApplyDocument(document), manifest.documentFingerprint);
});

test("uses ProseMirror node sizes for empty textblocks and leaf atoms", () => {
  const manifest = buildAiApplyBlockManifest({
    type: "doc",
    content: [{ type: "paragraph" }, { type: "paperPageBreak" }, { type: "paragraph" }],
  });
  assert.deepEqual(manifest.blocks.map(({ from, to }) => ({ from, to })), [
    { from: 0, to: 2 },
    { from: 2, to: 3 },
    { from: 3, to: 5 },
  ]);
});

test("produces a resolver payload containing only document block data", () => {
  const manifest = buildAiApplyBlockManifest(document);
  const payload = toAiApplyResolverManifest(manifest);
  assert.deepEqual(Object.keys(payload), ["version", "documentFingerprint", "blocks"]);
  assert.deepEqual(Object.keys(payload.blocks[0]), ["id", "index", "type", "text", "protected"]);
  assert.equal(JSON.stringify(payload).includes("workspace"), false);
  assert.equal(JSON.stringify(payload).includes("research"), false);
});

test("strictly validates the resolver schema and fails closed", () => {
  const fenced = validateAiApplyResolution("```json\n{\"version\":1,\"action\":\"unresolved\",\"confidence\":0,\"reason\":\"x\",\"documentFingerprint\":\"doc-1\"}\n```");
  assert.equal(fenced.ok, true);
  assert.equal(validateAiApplyResolution("{\"version\":1}\n额外解释").code, "invalid_json");
  assert.equal(validateAiApplyResolution({ version: 2, action: "unresolved", confidence: 0, reason: "x" }).code, "unsupported_version");
  assert.equal(validateAiApplyResolution({ version: 1, action: "delete", confidence: 1 }).code, "invalid_action");
  assert.equal(validateAiApplyResolution({ version: 1, action: "replace", targetBlockIds: [], confidence: 1, reason: "没有目标", documentFingerprint: "doc-1" }).code, "invalid_replace");
  const nullable = validateAiApplyResolution({
    version: 1,
    action: "replace",
    targetBlockIds: ["block-1"],
    anchorBlockId: null,
    confidence: 1,
    reason: "匹配",
    documentFingerprint: "doc-1",
  });
  assert.equal(nullable.ok, true);
  assert.equal(Object.hasOwn(nullable.resolution, "anchorBlockId"), false);
  assert.equal(validateAiApplyResolution({ version: 1, action: "replace", targetBlockIds: ["block-1"], anchorBlockId: "", confidence: 1, reason: "匹配", documentFingerprint: "doc-1" }).ok, true);
  assert.equal(validateAiApplyResolution({ version: 1, action: "replace", targetBlockIds: ["block-1"], anchorBlockId: "block-2", confidence: 1, reason: "匹配", documentFingerprint: "doc-1" }).code, "invalid_schema");
  assert.equal(validateAiApplyResolution({ version: 1, action: "replace", targetBlockIds: ["block-1"], confidence: 1, reason: "", documentFingerprint: "doc-1" }).code, "invalid_reason");
  assert.equal(validateAiApplyResolution({ version: 1, action: "replace", targetBlockIds: ["block/1"], confidence: 1, reason: "匹配", documentFingerprint: "doc-1" }).code, "invalid_targets");
  assert.equal(validateAiApplyResolution({ version: 1, action: "insert_after", anchorBlockId: `block-${"x".repeat(129)}`, confidence: 1, reason: "匹配", documentFingerprint: "doc-1" }).code, "invalid_anchor");
  assert.equal(validateAiApplyResolution({ version: 1, action: "unresolved", targetBlockIds: [], anchorBlockId: null, confidence: 0, reason: "定位不可靠", documentFingerprint: "doc-1" }).ok, true);
  assert.equal(validateAiApplyResolution({ version: 1, action: "unresolved", confidence: 0, reason: "定位不可靠", documentFingerprint: "doc-1", extra: true }).code, "invalid_schema");
  assert.equal(shouldRetryAiApplyResolution({ ok: false, code: "invalid_json" }), true);
  assert.equal(shouldRetryAiApplyResolution({ ok: false, code: "low_confidence" }), false);
});

test("accepts only ordered continuous editable replacement ranges", () => {
  const manifest = buildAiApplyBlockManifest(document);
  const first = manifest.blocks[3];
  const second = manifest.blocks[4];
  const valid = validateContinuousAiApplyRange([first.id, second.id], manifest);
  assert.equal(valid.ok, true);
  assert.deepEqual({ from: valid.from, to: valid.to }, { from: first.from, to: second.to });
  assert.equal(validateContinuousAiApplyRange([second.id, first.id], manifest).code, "non_contiguous_target");
  assert.equal(validateContinuousAiApplyRange([first.id, first.id], manifest).code, "duplicate_target");
  assert.equal(validateContinuousAiApplyRange([manifest.blocks[0].id], manifest).code, "protected_target");
  assert.equal(validateContinuousAiApplyRange(["block-forged"], manifest).code, "unknown_target");
});

test("validates confidence, fingerprint and insertion anchors before making an operation", () => {
  const manifest = buildAiApplyBlockManifest(document);
  const target = manifest.blocks[3];
  const base = { version: 1, action: "replace", targetBlockIds: [target.id], confidence: 0.9, reason: "同段落", documentFingerprint: manifest.documentFingerprint };
  const valid = validateAiApplyResolutionAgainstManifest(base, manifest);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.operation.from, target.from);
  assert.equal(validateAiApplyResolutionAgainstManifest({ ...base, confidence: 0.2 }, manifest).code, "low_confidence");
  assert.equal(validateAiApplyResolutionAgainstManifest({ ...base, documentFingerprint: "doc-stale" }, manifest).code, "stale_manifest");
  assert.equal(validateAiApplyResolutionAgainstManifest({ version: 1, action: "replace", targetBlockIds: [target.id], confidence: 1, reason: "匹配" }, manifest).code, "stale_manifest");
  assert.equal(validateAiApplyResolutionAgainstManifest({ version: 1, action: "insert_before", anchorBlockId: manifest.blocks[0].id, confidence: 1, reason: "定稿区", documentFingerprint: manifest.documentFingerprint }, manifest).code, "protected_anchor");
  const insert = validateAiApplyResolutionAgainstManifest({ version: 1, action: "insert_after", anchorBlockId: target.id, confidence: 1, reason: "新增内容", documentFingerprint: manifest.documentFingerprint }, manifest);
  assert.equal(insert.operation.from, target.to);
  assert.equal(insert.operation.from, insert.operation.to);
});

test("converts allowlisted AI blocks to TipTap JSON and escaped HTML", () => {
  const paragraph = { type: "paragraph", text: "你好 **<b>** 与 *世界*\n下一行" };
  const content = aiResultBlockToTiptapContent(paragraph);
  assert.deepEqual(content[0].content, [
    { type: "text", text: "你好 " },
    { type: "text", text: "<b>", marks: [{ type: "bold" }] },
    { type: "text", text: " 与 " },
    { type: "text", text: "世界", marks: [{ type: "italic" }] },
    { type: "hardBreak" },
    { type: "text", text: "下一行" },
  ]);
  assert.equal(aiResultBlockToSafeHtml(paragraph), "<p>你好 <strong>&lt;b&gt;</strong> 与 <em>世界</em><br>下一行</p>");

  const table = aiResultBlockToTiptapContent({ type: "table", headers: ["列"], rows: [["值"]] });
  assert.equal(table[0].content[0].content[0].type, "tableHeader");
  assert.equal(table[0].content[1].content[0].type, "tableCell");
});

test("normalizes safe image sources and degrades unsafe images to text", () => {
  const safe = aiResultBlockToTiptapContent({ type: "image", number: 2, caption: "图示", asset: { src: "assets/photo.png", width: "100%" } });
  assert.equal(safe[0].type, "image");
  assert.equal(safe[0].attrs.src, "assets/photo.png");
  const unsafeBlock = { type: "image", number: 2, caption: "<script>", asset: { src: "javascript:alert(1)" } };
  const unsafe = aiResultBlockToTiptapContent(unsafeBlock);
  assert.equal(unsafe[0].type, "paragraph");
  assert.equal(aiResultBlockToSafeHtml(unsafeBlock), "<p>图2. &lt;script&gt;</p>");
});

test("creates one transaction-ready operation and finds comment overlap", () => {
  const manifest = buildAiApplyBlockManifest(document);
  const target = manifest.blocks[3];
  const result = createAiDirectApplyOperation(
    { version: 1, action: "replace", targetBlockIds: [target.id], confidence: 0.95, reason: "match", documentFingerprint: manifest.documentFingerprint },
    manifest,
    { type: "heading", level: 2, text: "替换标题" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.operation.content[0].type, "heading");
  assert.equal(result.operation.html, "<h2>替换标题</h2>");
  assert.deepEqual(findCommentsOverlappingAiApplyOperation(result.operation, [
    { id: "before", from: 1, to: 2 },
    { id: "inside", from: target.from + 1, to: target.to - 1 },
  ]).map((comment) => comment.id), ["inside"]);
  assert.equal(aiApplyOperationNeedsConfirmation(result.operation, []), false);
  assert.equal(aiApplyOperationNeedsConfirmation(result.operation, [{ id: "inside" }]), true);
  assert.equal(aiApplyOperationNeedsConfirmation({ ...result.operation, targetBlockIds: ["one", "two"] }, []), true);
  assert.equal(aiApplyOperationNeedsConfirmation({ action: "insert_after", anchorBlockId: target.id }, []), true);
});

test("rebases an unchanged target after unrelated edits and rejects changed targets", () => {
  const source = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "前文" }] },
      { type: "paragraph", content: [{ type: "text", text: "目标正文" }] },
      { type: "paragraph", content: [{ type: "text", text: "后文" }] },
    ],
  };
  const manifest = buildAiApplyBlockManifest(source);
  const resolution = {
    version: 1,
    action: "replace",
    targetBlockIds: [manifest.blocks[1].id],
    confidence: 0.95,
    reason: "匹配",
    documentFingerprint: manifest.documentFingerprint,
  };
  const shifted = { ...source, content: [{ type: "paragraph", content: [{ type: "text", text: "新增开头" }] }, ...source.content] };
  const rebased = createRebasedAiDirectApplyOperation(resolution, manifest, shifted, { type: "paragraph", text: "优化正文" });
  assert.equal(rebased.ok, true);
  assert.equal(rebased.operation.targetBlockIds.length, 1);
  assert.equal(rebased.operation.from, buildAiApplyBlockManifest(shifted).blocks[2].from);

  const changed = { ...source, content: source.content.map((node, index) => index === 1 ? { type: "paragraph", content: [{ type: "text", text: "用户已经修改" }] } : node) };
  assert.equal(createRebasedAiDirectApplyOperation(resolution, manifest, changed, { type: "paragraph", text: "优化正文" }).code, "stale_target");
});

test("creates manual replace and insert operations from a user-selected block", () => {
  const manifest = buildAiApplyBlockManifest(document);
  const target = manifest.blocks[3];
  const replacement = createManualAiDirectApplyOperation(manifest, target.id, "replace", { type: "paragraph", text: "手动替换" });
  assert.equal(replacement.ok, true);
  assert.deepEqual({ from: replacement.operation.from, to: replacement.operation.to }, { from: target.from, to: target.to });
  const insertion = createManualAiDirectApplyOperation(manifest, target.id, "insert_after", { type: "paragraph", text: "手动插入" });
  assert.equal(insertion.ok, true);
  assert.equal(insertion.operation.from, target.to);
  assert.equal(insertion.operation.to, target.to);
});

test("repairs one invalid resolver response and never retries unresolved or low confidence", async () => {
  const manifest = buildAiApplyBlockManifest(document);
  const target = manifest.blocks[3];
  const valid = JSON.stringify({
    version: 1,
    action: "replace",
    targetBlockIds: [target.id],
    confidence: 0.95,
    reason: "同段落",
    documentFingerprint: manifest.documentFingerprint,
  });
  const requests = [];
  const repaired = await resolveAiDirectApplyWithRepair({
    resolver: async (request) => {
      requests.push(request);
      return { ok: true, raw: requests.length === 1 ? "{bad" : valid, model: { modelName: "定位模型" } };
    },
    manifest,
    selectedAiBlock: { type: "paragraph", text: "优化正文" },
    optimizationContext: { selectedIndex: 4, totalBlocks: 9 },
    getCurrentDocument: () => document,
  });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.attempts, 2);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].manifest, requests[0].manifest);
  assert.equal(requests[1].repair.code, "invalid_json");
  assert.equal(requests[1].repair.previousRaw, "{bad");

  for (const response of [
    { ...JSON.parse(valid), action: "unresolved", confidence: 0.2, reason: "存在歧义", targetBlockIds: undefined },
    { ...JSON.parse(valid), confidence: 0.2 },
  ]) {
    let calls = 0;
    const result = await resolveAiDirectApplyWithRepair({
      resolver: async () => { calls += 1; return { ok: true, raw: JSON.stringify(response) }; },
      manifest,
      selectedAiBlock: { type: "paragraph", text: "优化正文" },
      getCurrentDocument: () => document,
    });
    assert.equal(calls, 1);
    assert.equal(result.attempts, 1);
    if (response.action === "unresolved") assert.equal(result.unresolved, true);
    else assert.equal(result.code, "low_confidence");
  }
});

test("stops after two invalid resolver responses", async () => {
  const manifest = buildAiApplyBlockManifest(document);
  let calls = 0;
  const result = await resolveAiDirectApplyWithRepair({
    resolver: async () => { calls += 1; return { ok: true, raw: "not json" }; },
    manifest,
    selectedAiBlock: { type: "paragraph", text: "优化正文" },
    getCurrentDocument: () => document,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_json");
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});
