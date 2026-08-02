import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createEmojiCatalog,
  filterEmojiCatalog,
  resolveEmojiVariant,
} from "./emoji/catalog.js";
import { loadEmojiCatalog, resetEmojiCatalogForTests } from "./emoji/data.js";
import {
  addEmojiRecent,
  normalizeEmojiRecents,
  parseEmojiRecents,
} from "./emoji/recent-storage.js";
import {
  captureEmojiInsertionContext,
  insertEmojiFromContext,
  isSingleUnicodeGrapheme,
  validateEmojiInsertionContext,
} from "./emoji/insertion-context.js";
import {
  resolveEmojiFocusTarget,
  restoreEmojiPickerFocus,
} from "./emoji/focus-restoration.js";
import { createBrowserEditableExport } from "./browser-bridge/document-export.js";
import { fontStack } from "./templates/model.js";

const fixtureChinese = [
  { group: 0, hexcode: "1F600", label: "嘿嘿", order: 1, tags: ["笑脸", "高兴"], unicode: "😀" },
  {
    group: 1,
    hexcode: "1F44B",
    label: "挥手",
    order: 2,
    tags: ["你好"],
    unicode: "👋",
    skins: [
      { hexcode: "1F44B-1F3FB", label: "挥手: 较浅肤色", unicode: "👋🏻" },
      { hexcode: "1F44B-1F3FC", label: "挥手: 中等-浅肤色", unicode: "👋🏼" },
      { hexcode: "1F44B-1F3FD", label: "挥手: 中等肤色", unicode: "👋🏽" },
      { hexcode: "1F44B-1F3FE", label: "挥手: 中等-深肤色", unicode: "👋🏾" },
      { hexcode: "1F44B-1F3FF", label: "挥手: 较深肤色", unicode: "👋🏿" },
    ],
  },
  { group: 9, hexcode: "1F1E8-1F1F3", label: "旗: 中国", order: 3, tags: ["CN"], unicode: "🇨🇳" },
];

const fixtureEnglish = [
  { group: 0, hexcode: "1F600", label: "grinning face", order: 1, tags: ["happy"], unicode: "😀" },
  { group: 1, hexcode: "1F44B", label: "waving hand", order: 2, tags: ["hello"], unicode: "👋" },
  { group: 9, hexcode: "1F1E8-1F1F3", label: "flag: China", order: 3, tags: ["flag"], unicode: "🇨🇳" },
];

test("emoji catalog supports bilingual search, categories, and skin tones", () => {
  const catalog = createEmojiCatalog(fixtureChinese, fixtureEnglish);
  assert.equal(filterEmojiCatalog({ catalog, query: "高兴", category: "smileys-emotion" })[0].unicode, "😀");
  assert.equal(filterEmojiCatalog({ catalog, query: "hello", category: "people-body" })[0].unicode, "👋");
  assert.equal(filterEmojiCatalog({ catalog, query: "China", category: "flags" })[0].unicode, "🇨🇳");
  assert.equal(filterEmojiCatalog({ catalog, query: "China", category: "smileys-emotion" })[0].unicode, "🇨🇳");
  assert.equal(resolveEmojiVariant(catalog[1], 3).unicode, "👋🏽");
});

test("packaged Chinese and English emojibase datasets load fully offline", async () => {
  resetEmojiCatalogForTests();
  const catalog = await loadEmojiCatalog();
  assert.ok(catalog.length > 1500);
  assert.equal(filterEmojiCatalog({ catalog, query: "waving hand", category: "people-body" })[0].unicode, "👋");
  assert.equal(filterEmojiCatalog({ catalog, query: "挥手", category: "people-body" })[0].unicode, "👋");
});

test("emoji recents are unique, newest-first, bounded to thirty, and tolerate bad storage", () => {
  const values = Array.from({ length: 35 }, (_, index) => `emoji-${index}`);
  const normalized = normalizeEmojiRecents([...values, "emoji-0"]);
  assert.equal(normalized.length, 30);
  assert.deepEqual(addEmojiRecent(["😀", "👩‍💻", "😀"], "🇨🇳"), ["🇨🇳", "😀", "👩‍💻"]);
  assert.deepEqual(parseEmojiRecents("{not-json"), []);
});

test("emoji validation accepts full graphemes including ZWJ, skin, and flags", () => {
  assert.equal(isSingleUnicodeGrapheme("😀"), true);
  assert.equal(isSingleUnicodeGrapheme("👩‍💻"), true);
  assert.equal(isSingleUnicodeGrapheme("👋🏽"), true);
  assert.equal(isSingleUnicodeGrapheme("🇨🇳"), true);
  assert.equal(isSingleUnicodeGrapheme("A"), false);
  assert.equal(isSingleUnicodeGrapheme("😀😀"), false);
  assert.equal(isSingleUnicodeGrapheme(""), false);
});

function fakeEditor() {
  const inserted = [];
  const document = { eq: (other) => other === document };
  const editor = {
    isDestroyed: false,
    isEditable: true,
    state: { selection: { from: 4, to: 7 }, doc: document },
    chain() {
      return {
        focus() { return this; },
        setTextSelection(selection) { inserted.push({ selection }); return this; },
        insertContent(unicode) { inserted.push({ unicode }); return this; },
        run() { return true; },
      };
    },
  };
  return { editor, inserted };
}

test("emoji insertion rejects stale tab, document, editor, selection, and revision", () => {
  const { editor } = fakeEditor();
  const base = {
    tabId: "tab-a",
    documentId: "doc-a",
    editorId: "primary",
    editor,
    revision: 5,
  };
  const context = captureEmojiInsertionContext(base);
  assert.equal(validateEmojiInsertionContext(context, base).valid, true);
  assert.equal(validateEmojiInsertionContext(context, { ...base, tabId: "tab-b" }).reason, "tab-changed");
  assert.equal(validateEmojiInsertionContext(context, { ...base, documentId: "doc-b" }).reason, "document-changed");
  assert.equal(validateEmojiInsertionContext(context, { ...base, editorId: "secondary" }).reason, "editor-changed");
  assert.equal(validateEmojiInsertionContext(context, { ...base, revision: 6 }).reason, "revision-changed");
  editor.state.selection = { from: 5, to: 7 };
  assert.equal(validateEmojiInsertionContext(context, base).reason, "selection-changed");
});

test("emoji insertion restores the captured selection and inserts one Unicode grapheme", () => {
  const { editor, inserted } = fakeEditor();
  const current = {
    tabId: "tab-a",
    documentId: "doc-a",
    editorId: "secondary",
    editor,
    revision: "rev-8",
  };
  const context = captureEmojiInsertionContext(current);
  assert.deepEqual(insertEmojiFromContext(context, current, "👩‍💻"), {
    valid: true,
    reason: "",
    unicode: "👩‍💻",
  });
  assert.deepEqual(inserted, [{ selection: { from: 4, to: 7 } }, { unicode: "👩‍💻" }]);
  assert.equal(insertEmojiFromContext(context, current, "not emoji words").reason, "invalid-grapheme");
});

test("emoji picker exposes a modal grid, complete keyboard navigation, and focus restoration", () => {
  const source = readFileSync(new URL("./emoji/EmojiPicker.jsx", import.meta.url), "utf8");
  [
    'role="dialog"',
    'aria-modal="true"',
    'role="grid"',
    'role="gridcell"',
    'className="professional-dialog-layer emoji-picker-backdrop"',
    'className="professional-dialog emoji-picker"',
    'className="professional-dialog-header emoji-picker-header"',
    'event.key === "ArrowRight"',
    'event.key === "ArrowLeft"',
    'event.key === "ArrowDown"',
    'event.key === "ArrowUp"',
    'event.key === "Home"',
    'event.key === "End"',
    'event.key === "Escape"',
    "returnFocusRef?.current",
  ].forEach((marker) => assert.ok(source.includes(marker), `missing emoji picker marker: ${marker}`));
  assert.doesNotMatch(source, /EMOJI_SKIN_TONES|emoji-picker-tones|选择肤色/);
  assert.match(source, /emojiUnicodeForDisplay\(emoji,\s*0\)/);
  const css = readFileSync(new URL("./emoji/emoji-picker.css", import.meta.url), "utf8");
  assert.match(css, /\.emoji-picker-backdrop\s*\{[\s\S]*?backdrop-filter:\s*none/);
  assert.match(css, /\.emoji-picker-grid::-webkit-scrollbar-thumb/);
});

test("emoji focus restoration prefers the element trigger and falls back to the editor DOM", () => {
  const calls = [];
  const body = { focus() { calls.push("body"); }, isConnected: true };
  const disconnectedMenuItem = {
    focus() { calls.push("disconnected"); },
    isConnected: false,
  };
  const trigger = {
    focus(options) { calls.push(["trigger", options]); },
    isConnected: true,
  };
  const editorDom = {
    focus(options) { calls.push(["editor", options]); },
    isConnected: true,
  };

  assert.equal(resolveEmojiFocusTarget({
    returnFocus: trigger,
    previousFocus: disconnectedMenuItem,
    editorFocus: editorDom,
    body,
  }), trigger);
  restoreEmojiPickerFocus({
    returnFocus: trigger,
    previousFocus: body,
    editorFocus: editorDom,
    body,
    requestFrame: (callback) => callback(),
  });
  assert.deepEqual(calls, [["trigger", { preventScroll: true }]]);

  trigger.isConnected = false;
  restoreEmojiPickerFocus({
    returnFocus: trigger,
    previousFocus: body,
    editorFocus: editorDom,
    body,
    requestFrame: (callback) => callback(),
  });
  assert.deepEqual(calls.at(-1), ["editor", { preventScroll: true }]);
});

test("browser editable exports preserve Unicode graphemes and declare the emoji font fallback", () => {
  const graphemes = "普通 😀 👩🏽‍💻 👨‍👩‍👧‍👦 🇨🇳";
  for (const format of ["html", "markdown", "txt"]) {
    const exported = createBrowserEditableExport({
      title: "表情导出",
      html: `<p>${graphemes}</p>`,
    }, format);
    assert.ok(exported.content.includes(graphemes), `${format} rewrote a Unicode grapheme`);
    assert.equal(exported.content.includes("\uFFFD"), false);
    if (format === "html") {
      assert.match(
        exported.content,
        /font-family:"Segoe UI","Segoe UI Emoji",system-ui,sans-serif/,
      );
      assert.match(
        exported.content,
        /font-family:Consolas,"Segoe UI Emoji",monospace/,
      );
    }
  }
});

test("desktop editor and print export styles keep Segoe UI Emoji in their font stacks", () => {
  const editorStyles = readFileSync(
    new URL("./styles-editor-paper.css", import.meta.url),
    "utf8",
  );
  const outputStyles = readFileSync(
    new URL("./styles-output-responsive.css", import.meta.url),
    "utf8",
  );
  assert.match(
    editorStyles,
    /\.paper-editor\s*\{[^}]*font-family:\s*var\(--paper-font\),\s*"Segoe UI Emoji"/s,
  );
  assert.match(
    editorStyles,
    /\.paper-editor h1,[\s\S]*?font-family:\s*var\(--heading-font\),\s*"Segoe UI Emoji"/,
  );
  assert.match(
    outputStyles,
    /\.desktop-shell\.print-mode \.paper-editor,[\s\S]*?font-family:\s*var\(--paper-font\),\s*"Segoe UI Emoji"/,
  );
  assert.match(
    outputStyles,
    /@media print[\s\S]*?font-family:\s*"Segoe UI",\s*"Segoe UI Emoji",\s*system-ui,\s*sans-serif/,
  );
  assert.match(fontStack("Test Serif"), /"Segoe UI Emoji", serif$/);
});
