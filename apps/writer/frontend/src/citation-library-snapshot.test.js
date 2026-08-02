import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCitationPickerSources,
  mergeCitationSourcesWithFallbacks,
} from "./controllers/knowledge-derived.js";

test("document citation snapshots override public and legacy workspace records", () => {
  const privateSnapshot = { id: "shared", title: "信笺保存时的题名" };
  const merged = mergeCitationSourcesWithFallbacks(
    [privateSnapshot],
    [{ id: "shared", title: "公域后来修改的题名" }, { id: "public-only", title: "公域来源" }],
    [{ id: "shared", title: "旧工作区题名" }, { id: "legacy-only", title: "旧工作区来源" }],
  );
  assert.equal(merged.find((source) => source.id === "shared"), privateSnapshot);
  assert.deepEqual(merged.map((source) => source.id), ["shared", "public-only", "legacy-only"]);
});

test("citation picker separates current-document snapshots from public choices", () => {
  const choices = buildCitationPickerSources(
    [{ id: "private", title: "本文文献" }, { id: "shared", title: "本文快照" }],
    [{ id: "public", title: "公域文献" }, { id: "shared", title: "公域版本" }],
    [{ id: "legacy", title: "待迁移文献" }],
  );
  assert.equal(choices.find((source) => source.id === "shared").title, "本文快照");
  assert.equal(choices.find((source) => source.id === "private").libraryScope, "private");
  assert.equal(choices.find((source) => source.id === "public").libraryScope, "public");
  assert.equal(choices.find((source) => source.id === "legacy").legacyWorkspaceSource, true);
});
