import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Color from "@tiptap/extension-color";
import { Slice } from "@tiptap/pm/model";
import { inheritPastedTypography, PasteTemplateTypography } from "./paste-typography.js";

test("pasted headings and nested list text inherit fonts while keeping semantic marks and color", () => {
  const editor = new Editor({ extensions: [StarterKit, TextStyle, FontFamily, Color, PasteTemplateTypography], content: { type: "doc", content: [{ type: "paragraph" }] } });
  try {
    const doc = editor.schema.nodeFromJSON({ type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "节日的分类", marks: [{ type: "textStyle", attrs: { fontFamily: "Arial" } }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [
        { type: "text", text: "传统节日", marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontFamily: "SimHei", color: "#ff0000" } }] },
        { type: "text", text: "链接", marks: [{ type: "link", attrs: { href: "https://example.com" } }, { type: "italic" }] },
      ] }] }] },
    ] });
    const before = doc.toJSON();
    const result = inheritPastedTypography(new Slice(doc.content, 1, 3));
    assert.equal(result.openStart, 1);
    assert.equal(result.openEnd, 3);
    assert.equal(result.content.firstChild.type.name, "heading");
    assert.equal(result.content.firstChild.attrs.level, 2);
    assert.deepEqual(result.content.firstChild.firstChild.marks, []);
    const paragraph = result.content.child(1).firstChild.firstChild;
    assert.equal(paragraph.firstChild.marks.find(m => m.type.name === "textStyle").attrs.fontFamily, null);
    assert.equal(paragraph.firstChild.marks.find(m => m.type.name === "textStyle").attrs.color, "#ff0000");
    assert.ok(paragraph.firstChild.marks.some(m => m.type.name === "bold"));
    assert.ok(paragraph.lastChild.marks.some(m => m.type.name === "italic"));
    assert.equal(paragraph.lastChild.marks.find(m => m.type.name === "link").attrs.href, "https://example.com");
    assert.deepEqual(doc.toJSON(), before);
  } finally { editor.destroy(); }
});
