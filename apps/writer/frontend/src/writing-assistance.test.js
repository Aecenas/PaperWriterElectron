import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { WritingAssistanceSession } from "./writing-assistance/controller.js";
import {
  applyReplacementTransaction,
  changedRangesFromTransaction,
  collectCheckableTextBlocks,
  dedupeReplacementIssues,
  normalizeWritingAssistanceConfig,
  scanWritingIssues,
  serializeWritingAssistanceConfig,
} from "./writing-assistance/model.js";

const terminologyConfig = {
  enabled: true,
  language: "zh-CN",
  customWords: ["笺间", "笺间", " TipTap "],
  terminologyRules: [{
    id: "account",
    incorrect: "帐户",
    preferred: "账户",
    description: "统一使用“账户”。",
    caseSensitive: false,
    wholeWord: false,
    enabled: true,
  }],
};

const fixtureDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "此处使用帐", marks: [{ type: "bold" }] },
        { type: "text", text: "户。" },
        { type: "text", text: "https://example.com/帐户" },
      ],
    },
    { type: "codeBlock", content: [{ type: "text", text: "代码中的帐户" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "帐" },
        { type: "image", attrs: { src: "asset://one" } },
        { type: "text", text: "户" },
        { type: "text", text: " 链接帐户", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
      ],
    },
    {
      type: "paperBibliography",
      content: [{ type: "paragraph", content: [{ type: "text", text: "参考文献帐户" }] }],
    },
  ],
};

test("writing config normalizes custom words and terminology settings", () => {
  const normalized = normalizeWritingAssistanceConfig(terminologyConfig);
  assert.deepEqual(normalized.customWords, ["笺间", "TipTap"]);
  assert.equal(normalized.terminologyRules.length, 1);
  assert.equal(normalized.terminologyRules[0].preferred, "账户");
  assert.equal(normalized.termRules[0].wrong, "帐户");
  assert.deepEqual(serializeWritingAssistanceConfig(normalized).languages, ["zh-CN"]);
});

test("writing config accepts the persisted main-process aliases", () => {
  const normalized = normalizeWritingAssistanceConfig({
    enabled: true,
    languages: ["en-US"],
    termRules: [{ id: "colour", wrong: "colour", preferred: "color" }],
  });
  assert.equal(normalized.language, "en-US");
  assert.equal(normalized.terminologyRules[0].incorrect, "colour");
});

test("writing config round-trips the bilingual spelling mode", () => {
  const fromUi = normalizeWritingAssistanceConfig({ language: "zh-CN+en-US" });
  assert.equal(fromUi.language, "zh-CN+en-US");
  assert.deepEqual(fromUi.languages, ["zh-CN", "en-US"]);
  assert.deepEqual(serializeWritingAssistanceConfig(fromUi).languages, ["zh-CN", "en-US"]);
  const fromStorage = normalizeWritingAssistanceConfig({ languages: ["en-US", "zh-CN"] });
  assert.equal(fromStorage.language, "zh-CN+en-US");
});

test("built-in Chinese typo checks flag 什莫 and respect the whitelist", () => {
  const doc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "这究竟是什莫情况？" }] }],
  };
  const issues = scanWritingIssues({
    doc,
    config: { enabled: true, language: "zh-CN", terminologyRules: [] },
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "spelling");
  assert.equal(issues[0].actual, "什莫");
  assert.equal(issues[0].preferred, "什么");
  assert.equal(scanWritingIssues({
    doc,
    config: { enabled: true, language: "zh-CN", customWords: ["什莫"] },
  }).length, 0);
  assert.equal(scanWritingIssues({
    doc,
    config: { enabled: true, language: "en-US" },
  }).length, 0);
});

test("term scanner crosses marks while excluding code, URLs, media gaps, links, and bibliography", () => {
  const blocks = collectCheckableTextBlocks(fixtureDocument);
  assert.equal(blocks.length, 2);
  const issues = scanWritingIssues({ doc: fixtureDocument, config: terminologyConfig });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].actual, "帐户");
  assert.equal(issues[0].preferred, "账户");
  assert.match(issues[0].context, /此处使用帐户/);
});

test("incremental scans only return issues in affected text blocks", () => {
  const allIssues = scanWritingIssues({ doc: fixtureDocument, config: terminologyConfig });
  assert.equal(allIssues.length, 1);
  assert.equal(scanWritingIssues({
    doc: fixtureDocument,
    config: terminologyConfig,
    ranges: [{ from: 1000, to: 1001 }],
  }).length, 0);
  assert.equal(scanWritingIssues({
    doc: fixtureDocument,
    config: terminologyConfig,
    ranges: [{ from: allIssues[0].from, to: allIssues[0].to }],
  }).length, 1);
});

test("whole-word and case settings behave deterministically", () => {
  const doc = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "API api APIClient API" }] }],
  };
  const config = {
    terminologyRules: [{
      id: "api",
      incorrect: "API",
      preferred: "接口",
      caseSensitive: true,
      wholeWord: true,
    }],
  };
  assert.deepEqual(scanWritingIssues({ doc, config }).map((issue) => issue.actual), ["API", "API"]);
});

test("changed transaction ranges merge adjacent step-map output", () => {
  const transaction = {
    docChanged: true,
    mapping: {
      maps: [
        { forEach(callback) { callback(4, 5, 4, 7); } },
        { forEach(callback) { callback(7, 7, 7, 8); } },
      ],
    },
  };
  assert.deepEqual(changedRangesFromTransaction(transaction), [{ from: 3, to: 9 }]);
});

test("replace-all deduplicates overlap and dispatches one undoable transaction", () => {
  const calls = [];
  const transaction = {
    docChanged: false,
    insertText(text, from, to) {
      calls.push({ text, from, to });
      this.docChanged = true;
      return this;
    },
    setMeta(key, value) {
      calls.push({ meta: key, value });
      return this;
    },
    scrollIntoView() { return this; },
  };
  const editor = {
    state: {
      tr: transaction,
      doc: { textBetween: () => "帐户" },
    },
    view: {
      dispatch(value) {
        calls.push({ dispatch: value });
      },
    },
  };
  const issues = [
    { id: "a", ruleId: "account", from: 2, to: 4, actual: "帐户", preferred: "账户" },
    { id: "b", ruleId: "account", from: 9, to: 11, actual: "帐户", preferred: "账户" },
    { id: "overlap", ruleId: "account", from: 9, to: 10, actual: "帐", preferred: "账" },
  ];
  assert.deepEqual(dedupeReplacementIssues(issues).map((issue) => issue.id), ["b", "a"]);
  assert.equal(applyReplacementTransaction(editor, issues), true);
  assert.deepEqual(calls.filter((call) => call.text).map((call) => call.from), [9, 2]);
  assert.equal(calls.filter((call) => call.dispatch).length, 1);
  assert.equal(calls.find((call) => call.meta)?.value.action, "replace-all");
});

test("each editor session owns an independent ignore-once set", () => {
  const issue = { id: "account:1:3", ruleId: "account", from: 1, to: 3 };
  const primary = new WritingAssistanceSession({ editorId: "primary" });
  const secondary = new WritingAssistanceSession({ editorId: "secondary" });
  primary.issues = [issue];
  secondary.issues = [issue];
  assert.equal(primary.ignoreOnce(issue.id), true);
  assert.equal(primary.getIssues().length, 0);
  assert.equal(secondary.getIssues().length, 1);
  primary.resetDocument();
  assert.equal(primary.ignored.size, 0);
});

test("writing assistance pane exposes jump, ignore, replace-once, and replace-all controls", () => {
  const source = readFileSync(new URL("./writing-assistance/WritingAssistancePane.jsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./writing-assistance/writing-assistance.css", import.meta.url), "utf8");
  [
    "onJump?.(issue)",
    "onIgnoreOnce?.(issue)",
    "onReplaceOnce?.(issue)",
    "onReplaceAll?.(issue)",
    'aria-busy={scanning || undefined}',
    'aria-label="检查设置"',
    "onClick={onOpenSettings}",
    "settingsButtonRef",
    "<Settings size={15}",
    'className="writing-assistance-pane-title"',
    'className="writing-assistance-pane-count"',
    'className="writing-assistance-compact-empty"',
    'className="writing-assistance-card-main"',
    'writing-assistance-card-kind',
    'writing-assistance-card-change',
    'issue.kind === "spelling" ? "拼写" : "用词"',
    'title={`定位到正文：${issue.actual} → ${issue.preferred}`}',
    'title="忽略一次"',
    'title="替换"',
    'title="全文替换"',
    "正文还没有发现需要纠正的内容",
  ].forEach((marker) => assert.ok(source.includes(marker), `missing writing pane marker: ${marker}`));
  assert.doesNotMatch(source, /writing-assistance-complete/);
  assert.doesNotMatch(source, /HighlightedContext|writing-assistance-context/);
  assert.match(css, /\.writing-assistance-card\s*\{[\s\S]*?min-height:\s*48px[\s\S]*?display:\s*flex/);
  assert.match(css, /\.writing-assistance-card-kind\s*\{[\s\S]*?border-right:[\s\S]*?font-size:\s*10px/);
  assert.match(css, /\.writing-assistance-card-main\s*\{[\s\S]*?font-size:\s*10px/);
  assert.match(css, /\.writing-assistance-card \.writing-assistance-card-main\s*\{[\s\S]*?font-size:\s*10px/);
  assert.match(css, /\.writing-assistance-actions button\s*\{[\s\S]*?width:\s*26px[\s\S]*?height:\s*26px/);
  assert.match(css, /\.writing-assistance-compact-empty\s*\{[\s\S]*?font-size:\s*10px/);
});

test("writing settings use the product-styled card hierarchy and accessible controls", () => {
  const source = readFileSync(new URL("./writing-assistance/WritingAssistanceSettings.jsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./writing-assistance/writing-assistance.css", import.meta.url), "utf8");
  [
    'className="writing-assistance-overview"',
    'className="writing-assistance-overview-controls"',
    'role="switch"',
    'aria-checked={config.enabled}',
    'className="writing-assistance-section writing-assistance-whitelist-section"',
    'role="radiogroup"',
    'role="radio"',
    'label: "中英"',
    "加入后不再标记为拼写错误",
    "添加名单",
    'className="writing-assistance-whitelist"',
    "openWhitelistEditor(event.currentTarget)",
    "添加白名单",
    "从白名单删除",
    'if (event.key !== "Enter") return;',
    "useModalFocusTrap(\n    whitelistEditorOpen",
    "用词规范",
    'className="writing-assistance-section writing-assistance-terminology-section"',
    'className="writing-assistance-rule-map"',
    "openRuleEditor(null, event.currentTarget)",
    "createPortal(",
    "useModalFocusTrap(Boolean(ruleEditor)",
    "编辑用词规范",
    "删除用词规范",
  ].forEach((marker) => assert.ok(source.includes(marker), `missing settings marker: ${marker}`));
  assert.doesNotMatch(source, /同步到系统词典/);
  assert.doesNotMatch(source, /<textarea/);
  assert.doesNotMatch(source, /writing-assistance-basic-grid/);
  assert.match(css, /\.writing-assistance-overview\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.writing-assistance-overview-controls\s*,[\s\S]*?\.writing-assistance-inline-language/);
  assert.match(css, /\.writing-assistance-language-options\s*\{[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.writing-assistance-rules-heading > \.writing-assistance-section-heading\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.writing-assistance-whitelist\s*\{[\s\S]*?flex-wrap:\s*wrap/);
  assert.match(css, /\.writing-assistance-whitelist-item\s*\{[\s\S]*?display:\s*inline-flex/);
  assert.match(css, /\.writing-assistance-rule\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.writing-assistance-rule-editor-layer\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(css, /\.writing-assistance-rule-editor-dialog\s*\{[\s\S]*?width:\s*min\(480px/);
  assert.match(css, /\.writing-assistance-whitelist-editor-dialog\s*\{[\s\S]*?width:\s*min\(400px/);
  assert.match(css, /\.writing-assistance-switch\.checked i\s*\{[\s\S]*?translateX\(18px\)/);
});
