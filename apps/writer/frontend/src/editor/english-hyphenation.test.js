import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import StarterKit from "@tiptap/starter-kit";
import {
  buildEnglishHyphenationDecorationSet,
  englishHyphenationBreakOffsets,
} from "./english-hyphenation.js";

test("American English words expose legal break offsets without touching short or pre-hyphenated words", () => {
  assert.deepEqual(englishHyphenationBreakOffsets("abandon"), [4]);
  assert.deepEqual(englishHyphenationBreakOffsets("abandonment"), [4, 7]);
  assert.deepEqual(englishHyphenationBreakOffsets("word"), []);
  assert.deepEqual(englishHyphenationBreakOffsets("aban\u00addon"), []);
});

test("hyphenation decorations stay view-only and exclude headings, code, and links", () => {
  const editor = new Editor({
    extensions: [StarterKit],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "abandon" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "confirmation" }] },
        { type: "paragraph", content: [{ type: "text", marks: [{ type: "code" }], text: "hyphenation" }] },
        {
          type: "paragraph",
          content: [{
            type: "text",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            text: "triggered",
          }],
        },
      ],
    },
  });

  const decorations = buildEnglishHyphenationDecorationSet(editor.state.doc).find();
  assert.equal(decorations.length, 1);
  const serializedDocument = JSON.stringify(editor.getJSON());
  assert.equal(serializedDocument.includes("paper-english-hyphenation-point"), false);
  assert.equal(serializedDocument.includes("\u00ad"), false);
  assert.equal(editor.state.doc.textContent.includes("\u00ad"), false);

  editor.commands.setContent({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "abandonment" }] }],
  });
  assert.equal(buildEnglishHyphenationDecorationSet(editor.state.doc).find().length, 2);
  assert.equal(editor.state.doc.textContent, "abandonment");
  editor.destroy();
});

test("paragraphs inside lists, quotes, and table cells receive the same decorations", () => {
  const editor = new Editor({
    extensions: [StarterKit, Table, TableRow, TableHeader, TableCell],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "abandon" }] },
        {
          type: "bulletList",
          content: [{
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "abandon" }] }],
          }],
        },
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "abandon" }] }],
        },
        {
          type: "table",
          content: [{
            type: "tableRow",
            content: [{
              type: "tableCell",
              content: [{ type: "paragraph", content: [{ type: "text", text: "abandon" }] }],
            }],
          }],
        },
      ],
    },
  });

  assert.equal(buildEnglishHyphenationDecorationSet(editor.state.doc).find().length, 4);
  editor.destroy();
});
