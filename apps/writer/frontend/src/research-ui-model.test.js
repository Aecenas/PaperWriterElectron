import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH_CONTEXT_ACTIONS,
  clampResearchPaneWidth,
  flattenVisibleResearchEntries,
  formatResearchFileSize,
  getResearchEntryKey,
  isDangerousResearchFile,
  isVisibleResearchEntry,
  normalizeExpandedFolders,
  normalizeResearchRelativePath,
  parentResearchRelativePath,
  canOpenResearchItem,
  researchPathLabel,
  researchItemKind,
  researchPreviewKind,
  sourceDisplayName,
} from "./research-ui-model.js";

test("research tree hides reserved metadata and link-like entries", () => {
  assert.equal(isVisibleResearchEntry({ kind: "folder", name: ".jianjian" }), false);
  assert.equal(isVisibleResearchEntry({ kind: "folder", name: "资料", isJunction: true }), false);
  assert.equal(isVisibleResearchEntry({ kind: "file", name: "论文.pdf", relativePath: "论文.pdf" }), true);
  assert.equal(getResearchEntryKey({ relativePath: "专题/论文.pdf", path: "ignored" }), "专题/论文.pdf");
});

test("expanded folder inputs normalize without leaking mutable state", () => {
  const source = new Set(["甲"]);
  const normalized = normalizeExpandedFolders(source);
  normalized.add("乙");
  assert.deepEqual([...source], ["甲"]);
  assert.deepEqual([...normalizeExpandedFolders(["甲", "乙"])], ["甲", "乙"]);
  assert.deepEqual([...normalizeExpandedFolders({ 甲: true, 乙: { expanded: true }, 丙: { expanded: false } })], ["甲", "乙"]);
});

test("research browsing paths stay relative and expose parent/root navigation", () => {
  assert.equal(normalizeResearchRelativePath("/课题\\一组/./论文/"), "课题/一组/论文");
  assert.equal(normalizeResearchRelativePath("课题/一组/../二组"), "课题/二组");
  assert.equal(normalizeResearchRelativePath("../../课题"), "课题");
  assert.equal(parentResearchRelativePath("课题/一组/论文"), "课题/一组");
  assert.equal(parentResearchRelativePath("课题"), "");
  assert.equal(researchPathLabel("资料库", "课题/一组"), "资料库 / 课题 / 一组");
});

test("flattened rows include only expanded, safe descendants", () => {
  const rows = flattenVisibleResearchEntries([
    {
      kind: "folder",
      name: "课题",
      relativePath: "课题",
      children: [
        { kind: "file", name: "论文.pdf", relativePath: "课题/论文.pdf" },
        { kind: "folder", name: ".jianjian", relativePath: "课题/.jianjian" },
      ],
    },
    { kind: "file", name: "索引.txt", relativePath: "索引.txt" },
  ], new Set(["课题"]));
  assert.deepEqual(rows.map(({ entry, depth }) => [entry.name, depth]), [["课题", 0], ["论文.pdf", 1], ["索引.txt", 0]]);
});

test("research item routing uses the explicit static-preview whitelist", () => {
  assert.equal(researchItemKind({ type: "file", relativePath: "甲/论文.PDF" }), "pdf");
  assert.equal(researchItemKind({ kind: "file", name: "没有扩展名", isPdf: true }), "pdf");
  assert.equal(researchItemKind({ type: "file", name: "提纲.docx" }), "unsupported");
  assert.equal(researchPreviewKind({ type: "file", name: "信笺.letterpaper" }), "document");
  assert.equal(researchPreviewKind({ type: "file", name: "说明.markdown" }), "markdown");
  assert.equal(researchPreviewKind({ type: "file", name: "记录.LOG" }), "text");
  assert.equal(researchPreviewKind({ type: "file", name: "数据.tsv" }), "table");
  assert.equal(researchPreviewKind({ type: "file", name: "照片.webp" }), "image");
  assert.equal(canOpenResearchItem({ type: "file", name: "提纲.docx" }), false);
  assert.equal(canOpenResearchItem({ type: "file", name: "说明.md" }), true);
  assert.equal(researchItemKind({ kind: "url", url: "https://example.com" }), "web");
  assert.equal(researchItemKind({ type: "note" }), "empty");
  assert.equal(researchItemKind(null), "empty");
});

test("dangerous research files cannot be offered for direct launch", () => {
  assert.equal(isDangerousResearchFile({ name: "installer.EXE" }), true);
  assert.equal(isDangerousResearchFile({ name: "script.ps1" }), true);
  assert.equal(isDangerousResearchFile({ name: "reading.html" }), false);
  assert.equal(isDangerousResearchFile({ name: "paper.pdf" }), false);
});

test("reader width stays inside configured bounds", () => {
  assert.equal(clampResearchPaneWidth(100, { minWidth: 360, maxWidth: 800 }), 360);
  assert.equal(clampResearchPaneWidth(640, { minWidth: 360, maxWidth: 800 }), 640);
  assert.equal(clampResearchPaneWidth(900, { minWidth: 360, maxWidth: 800 }), 800);
  assert.equal(clampResearchPaneWidth("invalid", { minWidth: 420, maxWidth: 900 }), 420);
});

test("research metadata helpers remain deterministic", () => {
  assert.equal(sourceDisplayName({ title: "标题", fileName: "ignored.pdf" }), "标题");
  assert.equal(sourceDisplayName({ fileName: "论文.pdf" }), "论文.pdf");
  assert.equal(formatResearchFileSize(0), "0 B");
  assert.equal(formatResearchFileSize(1536), "1.5 KB");
  assert.equal(formatResearchFileSize(5 * 1024 * 1024), "5.0 MB");
  assert.deepEqual(RESEARCH_CONTEXT_ACTIONS.file, ["rename", "move", "copyPath", "showInFolder", "trash"]);
});
