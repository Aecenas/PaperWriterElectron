import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createHistoryDiff,
  createSplitContentDiff,
  filterCurrentAutomaticHistoryEntries,
  historyEntryLabel,
  plainTextFromHtml,
  textLinesFromHtml,
} from "./history/model.js";

test("history preview creates word and metadata changes without rendering archive HTML", () => {
  const diff = createHistoryDiff(
    { title: "当前", author: "甲", html: "<p>今天写新内容</p><img src='x'>" },
    { title: "旧稿", author: "甲", html: "<p>昨天写内容</p>" },
  );
  assert.equal(diff.changed, true);
  assert.ok(diff.words.some((part) => part.kind === "added"));
  assert.equal(diff.contentRows.length, 1);
  assert.equal(diff.contentRows[0].before, "昨天写内容");
  assert.equal(diff.contentRows[0].after, "今天写新内容");
  assert.ok(diff.fields.some((field) => field.label === "标题"));
  assert.ok(diff.fields.some((field) => field.label === "媒体"));
  assert.equal(plainTextFromHtml("<script>bad()</script><p>安全文本</p>"), "安全文本");
});

test("history content diff omits unchanged paragraphs and aligns changed lines side by side", () => {
  const rows = createSplitContentDiff(
    "<p>保留第一段</p><p>旧的第二段</p><p>保留结尾</p>",
    "<p>保留第一段</p><p>新的第二段</p><p>保留结尾</p><p>新增段落</p>",
  );
  assert.deepEqual(textLinesFromHtml("<p>甲</p><p>乙</p>"), ["甲", "乙"]);
  assert.deepEqual(rows.map((row) => [row.before, row.after]), [
    ["旧的第二段", "新的第二段"],
    ["", "新增段落"],
  ]);
  assert.equal(rows.some((row) => row.before.includes("保留") || row.after.includes("保留")), false);
});

test("history entry labels distinguish automatic, named, and safety versions", () => {
  assert.equal(historyEntryLabel({ kind: "auto" }), "自动版本");
  assert.equal(historyEntryLabel({ kind: "manual", name: "交付前" }), "交付前");
  assert.equal(historyEntryLabel({ kind: "pre-restore" }), "恢复前安全版本");
});

test("history metadata diff detects formatting and visible same-count media replacements", () => {
  const diff = createHistoryDiff(
    {
      title: "同一标题",
      author: "甲",
      letterTemplateId: "modern",
      fontFamily: "Noto Serif SC",
      fontSize: 18,
      citationStyle: { styleId: "apa-7", locale: "zh-CN" },
      citationSources: [{ id: "source-1", title: "新文献" }],
      footnotes: [],
      html: '<p><span data-citation-source-id="source-1">[1]</span></p><img src="asset://new" alt="新版配图">',
    },
    {
      title: "同一标题",
      author: "甲",
      letterTemplateId: "classic",
      fontFamily: "KaiTi",
      fontSize: 16,
      citationStyle: { styleId: "apa-7", locale: "zh-CN" },
      citationSources: [{ id: "source-1", title: "旧文献" }],
      footnotes: [],
      html: '<p><span data-citation-source-id="source-1">[1]</span></p><img src="asset://old" alt="旧版配图">',
    },
  );
  assert.deepEqual(
    diff.fields.map((field) => field.label),
    ["排版", "引用", "媒体"],
  );
  assert.match(diff.fields.find((field) => field.label === "媒体").before, /原有：图片《旧版配图》/);
  assert.match(diff.fields.find((field) => field.label === "媒体").after, /更新为：图片《新版配图》/);
  assert.doesNotMatch(diff.fields.map((field) => `${field.before} ${field.after}`).join(" "), /内容 [a-f0-9]{8}/);
});

test("history media diff ignores opaque source churn when visible media is unchanged", () => {
  const oldOpaqueId = "730b30b6-d325-4be7-87fb-2e887c569dfd";
  const newOpaqueData = "8DRtHhBhP7Q1UAAAAASUVORK5CYII=";
  const diff = createHistoryDiff(
    { html: `<p>正文</p><img src="${newOpaqueData}"><img src="asset://chart.png" alt="融资余额">` },
    { html: `<p>正文</p><img src="${oldOpaqueId}"><img src="asset://chart.png" alt="融资余额">` },
  );
  assert.equal(diff.fields.some((field) => field.label === "媒体"), false);
  assert.equal(diff.changed, false);
});

test("history media diff reports the concrete label and size that changed", () => {
  const diff = createHistoryDiff(
    {
      html: '<figure data-type="paper-image" data-caption="现金流图" data-width="62%"><img src="asset://new"></figure>',
    },
    {
      html: '<figure data-type="paper-image" data-caption="营收图" data-width="78%"><img src="asset://old"></figure>',
    },
  );
  const media = diff.fields.find((field) => field.label === "媒体");
  assert.match(media.before, /图片《营收图》 · 宽度 78%/);
  assert.match(media.after, /图片《现金流图》 · 宽度 62%/);
  assert.doesNotMatch(`${media.before} ${media.after}`, /asset:\/\//);
});

test("history formatting diff detects mark-only changes with identical body text", () => {
  const diff = createHistoryDiff(
    { title: "标题", author: "甲", html: "<p><strong>相同正文</strong></p>" },
    { title: "标题", author: "甲", html: "<p>相同正文</p>" },
  );
  assert.equal(diff.words.every((part) => part.kind === "same"), true);
  assert.deepEqual(diff.fields.map((field) => field.label), ["排版"]);
});

test("history list removes leading automatic snapshots that match the current document", async () => {
  const entries = [
    { id: "same", kind: "auto" },
    { id: "changed", kind: "auto" },
    { id: "named", kind: "manual", name: "交付前" },
  ];
  const snapshots = {
    same: { title: "正文", html: "<p>当前内容</p>" },
    changed: { title: "正文", html: "<p>历史内容</p>" },
  };
  const filtered = await filterCurrentAutomaticHistoryEntries(entries, {
    currentDocument: { title: "正文", html: "<p>当前内容</p>" },
    readSnapshot: async (entry) => snapshots[entry.id],
  });
  assert.deepEqual(filtered.map((entry) => entry.id), ["changed", "named"]);
});

test("history dialog keeps version management in the footer", () => {
  const source = readFileSync(
    new URL("./history/DocumentHistoryDialog.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /className="history-footer-actions"/);
  assert.match(source, /修改名称/);
  assert.match(source, /删除版本/);
  assert.match(source, /全部清除/);
  assert.match(source, /name,\s*pinned: selected\.pinned/s);
  assert.doesNotMatch(source, /history-entry-menu|MoreHorizontal|<Plus/);
  assert.doesNotMatch(source, /history-entry-dot/);
  assert.doesNotMatch(source, /左侧为历史版本，右侧为当前版本/);
});

test("destructive history actions use the standard confirmation dialog", () => {
  const source = readFileSync(
    new URL("./history/DocumentHistoryDialog.jsx", import.meta.url),
    "utf8",
  );
  assert.equal((source.match(/showConfirmDialog\?\.\(/g) || []).length, 3);
  assert.match(source, /title: "清除全部历史版本？"/);
  assert.match(source, /title: "删除这个历史版本？"/);
  assert.match(source, /title: "恢复到这个历史版本？"/);
  assert.doesNotMatch(source, /confirmDeleteId|confirmClearAll|确认全部清除/);
});

test("history preview is a two-pane diff with a single primary restore action", () => {
  const source = readFileSync(
    new URL("./history/DocumentHistoryDialog.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /className="history-dialog-body"/);
  assert.match(source, /className="history-timeline"/);
  assert.match(source, /className="history-diff-scroll"/);
  assert.match(source, /history-diff-column-headings/);
  assert.match(source, /diff\.contentRows\.map/);
  assert.doesNotMatch(source, /仅显示发生变化的内容/);
  assert.doesNotMatch(source, /diff\.words\.map/);
  assert.equal((source.match(/className="history-restore"/g) || []).length, 1);
  assert.doesNotMatch(source, /文件安全/);
});

test("history dialog traps focus, starts at close, and restores the invoking control", () => {
  const source = readFileSync(
    new URL("./history/DocumentHistoryDialog.jsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /useModalFocusTrap\(open, dialogRef, closeButtonRef, returnFocusRef\)/,
  );
  assert.match(source, /<section ref=\{dialogRef\}/);
  assert.match(source, /<button ref=\{closeButtonRef\}/);
  assert.doesNotMatch(source, /const previous = window\.document\.activeElement/);
});

test("renames update the selected entry and restores wait for a durable boundary", () => {
  const source = readFileSync(
    new URL("./history/DocumentHistoryDialog.jsx", import.meta.url),
    "utf8",
  );
  const renameCall = source.indexOf("bridge.updateDocumentHistory");
  const restorePreparation = source.indexOf('action: "restore"');
  const restoreCall = source.indexOf("bridge.restoreDocumentHistory");

  assert.ok(renameCall >= 0);
  assert.ok(restorePreparation >= 0 && restorePreparation < restoreCall);
  assert.doesNotMatch(source, /bridge\.createDocumentHistory/);
  assert.match(source, /expectedRevision/);
  assert.match(source, /恢复操作已取消/);
});

test("App supplies history preparation and restores focus for tab and canvas entry points", () => {
  const source = readFileSync(
    new URL("./App.jsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /onPrepareOperation=\{handlePrepareDocumentHistoryOperation\}/,
  );
  assert.match(source, /showConfirmDialog=\{showConfirmDialog\}/);
  assert.match(source, /returnFocusRef=\{historyReturnFocusRef\}/);
  assert.match(
    source,
    /onOpenHistory=\{\(\) => handleOpenDocumentHistory\([\s\S]*rightSplitEditor\?\.view\?\.dom[\s\S]*editor\?\.view\?\.dom/,
  );
});
