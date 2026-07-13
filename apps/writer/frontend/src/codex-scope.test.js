import assert from "node:assert/strict";
import test from "node:test";
import { codexScopeLabel, normalizeCodexImageMode, normalizeCodexScope, relativeCodexScopePath } from "./codex-scope.js";

test("keeps parsing legacy scope values for document migration", () => {
  assert.deepEqual(normalizeCodexScope(), { mode: "workspace", relativePath: "" });
  assert.equal(normalizeCodexImageMode(), "original");
  assert.equal(normalizeCodexImageMode("caption-only"), "caption-only");
});

test("legacy scope parser validates all historical modes and portable paths", () => {
  assert.deepEqual(normalizeCodexScope({ mode: "document-only" }), { mode: "document-only", relativePath: "" });
  assert.deepEqual(normalizeCodexScope({ mode: "document-directory" }), { mode: "document-directory", relativePath: "" });
  assert.deepEqual(normalizeCodexScope({ mode: "subdirectory", relativePath: "素材\\参考/" }), { mode: "subdirectory", relativePath: "素材/参考" });
  assert.deepEqual(normalizeCodexScope({ mode: "subdirectory", relativePath: "../secret" }), { mode: "subdirectory", relativePath: "" });
});

test("creates workspace-relative paths for Windows paths", () => {
  assert.equal(relativeCodexScopePath("C:\\项目 根", "C:\\项目 根\\素材\\参考"), "素材/参考");
  assert.equal(relativeCodexScopePath("C:\\项目", "C:\\项目二\\素材"), null);
});

test("formats the selected scope label", () => {
  assert.equal(codexScopeLabel({ mode: "subdirectory", relativePath: "素材/参考" }), "素材/参考");
  assert.equal(codexScopeLabel({ mode: "workspace" }), "整个工作区");
});
