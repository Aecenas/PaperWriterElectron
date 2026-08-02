import assert from "node:assert/strict";
import test from "node:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  createProfessionalContentExtensions,
} from "./editor/professional-content-extensions.js";
import {
  insertBookmark,
  insertCodeBlock,
  removeBookmark,
  updateMathDraftAt,
  updateMermaidDraftAt,
} from "./professional-content/editor-commands.js";
import { collectBookmarks } from "./professional-content/model.js";

const EQUATION_ID = "11111111-1111-4111-8111-111111111111";
const DIAGRAM_ID = "22222222-2222-4222-8222-222222222222";
const BOOKMARK_ID = "33333333-3333-4333-8333-333333333333";

function createEditor(content = "<p></p>") {
  return new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      ...createProfessionalContentExtensions(),
    ],
    content,
  });
}

test("professional nodes keep source-only code, math, references, and Mermaid attrs", () => {
  const editor = createEditor({
    type: "doc",
    content: [
      { type: "codeBlock", attrs: { language: "javascript", wrap: true }, content: [{ type: "text", text: "const answer = 42;" }] },
      { type: "paragraph", content: [{ type: "inlineMath", attrs: { latex: "a^2+b^2=c^2" } }] },
      { type: "blockMath", attrs: { latex: "E=mc^2", equationId: EQUATION_ID, label: "energy", numbering: true } },
      { type: "paragraph", content: [{ type: "paperEquationReference", attrs: { equationId: EQUATION_ID } }] },
      { type: "paragraph", content: [
        { type: "paperBookmark", attrs: { bookmarkId: BOOKMARK_ID, label: "结论" } },
        { type: "text", text: "结论段落" },
      ] },
      { type: "paperMermaid", attrs: { diagramId: DIAGRAM_ID, source: "flowchart LR\nA-->B", caption: "流程", width: "62%" } },
      { type: "paragraph", content: [{ type: "paperMermaidReference", attrs: { diagramId: DIAGRAM_ID } }] },
    ],
  });
  const json = editor.getJSON();
  assert.equal(json.content[0].attrs.language, "javascript");
  assert.equal(json.content[0].attrs.wrap, true);
  assert.equal(json.content[1].content[0].attrs.latex, "a^2+b^2=c^2");
  assert.equal(json.content[2].attrs.equationId, EQUATION_ID);
  assert.equal(json.content[3].content[0].attrs.equationId, EQUATION_ID);
  assert.equal(json.content[4].content[0].attrs.bookmarkId, BOOKMARK_ID);
  assert.equal(json.content[5].attrs.source, "flowchart LR\nA-->B");
  assert.equal(json.content[5].attrs.width, "62%");
  assert.equal(json.content[6].content[0].attrs.diagramId, DIAGRAM_ID);
  editor.destroy();
});

test("direct code insertion always creates a standalone block without converting the paragraph", () => {
  const editor = createEditor({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "const answer = 42;" }] }],
  });
  editor.commands.setTextSelection({ from: 1, to: 19 });
  assert.equal(insertCodeBlock(editor, { language: "javascript", wrap: true }), true);
  assert.equal(editor.state.doc.childCount, 2);
  assert.equal(editor.state.doc.firstChild.type.name, "paragraph");
  assert.equal(editor.state.doc.firstChild.textContent, "const answer = 42;");
  assert.equal(editor.state.doc.child(1).type.name, "codeBlock");
  assert.equal(editor.state.doc.child(1).attrs.language, "javascript");
  assert.equal(editor.state.doc.child(1).attrs.wrap, true);
  assert.equal(editor.state.selection.$from.parent.type.name, "codeBlock");
  editor.destroy();
});

test("bookmarks persist once per textblock and can be listed, renamed, and removed", () => {
  const editor = createEditor({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "值得回看的结论" }] }],
  });
  editor.commands.setTextSelection(4);
  assert.equal(insertBookmark(editor, { label: "关键结论" }), true);
  assert.equal(insertBookmark(editor, { label: "更新后的结论" }), true);
  editor.commands.setTextSelection(1);
  editor.commands.insertContent({ type: "text", text: "开头" });
  assert.equal(insertBookmark(editor, { label: "更新后的结论" }), true);
  const bookmarks = collectBookmarks(editor.state.doc);
  assert.equal(bookmarks.length, 1);
  assert.equal(bookmarks[0].label, "更新后的结论");
  assert.equal(bookmarks[0].context, "开头值得回看的结论");
  assert.equal(editor.state.doc.firstChild.firstChild.type.name, "paperBookmark");
  assert.equal(removeBookmark(editor, bookmarks[0].bookmarkId), true);
  assert.equal(collectBookmarks(editor.state.doc).length, 0);
  editor.destroy();
});

test("math editing can target the exact node position captured by a double click", () => {
  const editor = createEditor({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "inlineMath", attrs: { latex: "x=1" } }] },
      { type: "blockMath", attrs: { latex: "y=2", equationId: EQUATION_ID, label: "", numbering: true } },
    ],
  });
  let blockPosition = null;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "blockMath") blockPosition = position;
  });
  assert.equal(updateMathDraftAt(editor, blockPosition, {
    mode: "block",
    latex: "y=3",
    equationId: EQUATION_ID,
    label: "结果",
    numbering: true,
  }), true);
  assert.equal(editor.state.doc.nodeAt(blockPosition).attrs.latex, "y=3");
  assert.equal(editor.state.doc.nodeAt(blockPosition).attrs.label, "结果");
  editor.destroy();
});

test("Mermaid editing keeps its stable identity while updating source, caption, and width", () => {
  const editor = createEditor({
    type: "doc",
    content: [
      { type: "paperMermaid", attrs: { diagramId: DIAGRAM_ID, source: "flowchart LR\nA-->B", caption: "旧图注", width: "78%" } },
    ],
  });
  assert.equal(updateMermaidDraftAt(editor, 0, {
    diagramId: DIAGRAM_ID,
    source: "flowchart TD\nA-->C",
    caption: "研究流程",
    width: "100%",
  }), true);
  const attrs = editor.state.doc.nodeAt(0).attrs;
  assert.equal(attrs.diagramId, DIAGRAM_ID);
  assert.equal(attrs.source, "flowchart TD\nA-->C");
  assert.equal(attrs.caption, "研究流程");
  assert.equal(attrs.width, "100%");
  editor.destroy();
});

test("inline dollar text stays prose and commands create stable professional nodes", () => {
  const editor = createEditor({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "价格是 $5，不是公式。" }] }],
  });
  assert.equal(editor.state.doc.firstChild.firstChild.type.name, "text");
  assert.equal(editor.chain().insertPaperBlockMath({ latex: "x=1" }).run(), true);
  assert.equal(editor.chain().insertPaperMermaid({ source: "flowchart LR\nA-->B" }).run(), true);
  const nodes = [];
  editor.state.doc.descendants((node) => nodes.push(node));
  assert.equal(nodes.some((node) => node.type.name === "blockMath" && node.attrs.equationId), true);
  assert.equal(nodes.some((node) => node.type.name === "paperMermaid" && node.attrs.diagramId), true);
  editor.destroy();
});
