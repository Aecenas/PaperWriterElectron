import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";
import { createKnowledgeExtensions } from "./knowledge-extensions.js";
import {
  createStructuredInlineExtensions,
  imageReferencePasteAllowed,
  normalizeExternalLinkUrl,
  PROTECTED_INLINE_NODE_TYPES,
  StructuredInlineBehavior,
  synchronizeStructuredInlineReferences,
} from "./structured-inline-extensions.js";

const IMAGE_ONE = "11111111-1111-4111-8111-111111111111";
const IMAGE_TWO = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_ONE = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_TWO = "44444444-4444-4444-8444-444444444444";

const TestImage = Image.extend({
  addAttributes() {
    return { ...(this.parent?.() || {}), imageId: { default: "" } };
  },
});

function createEditor(content) {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      TestImage,
      ...createStructuredInlineExtensions(),
      ...createKnowledgeExtensions(),
    ],
    content,
  });
}

test("image references follow image order and retain a missing tombstone", () => {
  const editor = createEditor({
    type: "doc",
    content: [
      { type: "image", attrs: { src: "data:image/png;base64,AA==", imageId: IMAGE_ONE } },
      { type: "paragraph", content: [{ type: "paperImageReference", attrs: { imageId: IMAGE_TWO, number: 9 } }] },
      { type: "image", attrs: { src: "data:image/png;base64,AA==", imageId: IMAGE_TWO } },
      { type: "paragraph", content: [{ type: "paperImageReference", attrs: { imageId: IMAGE_ONE, number: 9 } }] },
    ],
  });

  synchronizeStructuredInlineReferences(editor);
  let references = [];
  let firstImage = null;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "paperImageReference") references.push(node.attrs);
    if (!firstImage && node.type.name === "image") firstImage = { position, size: node.nodeSize };
  });
  assert.deepEqual(references.map(({ number, missing }) => ({ number, missing })), [
    { number: 2, missing: false },
    { number: 1, missing: false },
  ]);

  editor.view.dispatch(editor.state.tr.delete(firstImage.position, firstImage.position + firstImage.size));
  synchronizeStructuredInlineReferences(editor);
  references = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paperImageReference") references.push(node.attrs);
  });
  assert.deepEqual(references.map(({ number, missing }) => ({ number, missing })), [
    { number: 1, missing: false },
    { number: 1, missing: true },
  ]);
  editor.destroy();
});

test("duplicate pasted image identities are regenerated while the original keeps its references", () => {
  const editor = createEditor({
    type: "doc",
    content: [
      { type: "image", attrs: { src: "data:image/png;base64,AA==", imageId: IMAGE_ONE } },
      { type: "image", attrs: { src: "data:image/png;base64,AA==", imageId: IMAGE_ONE } },
      { type: "paragraph", content: [{ type: "paperImageReference", attrs: { imageId: IMAGE_ONE } }] },
    ],
  });
  synchronizeStructuredInlineReferences(editor);
  const imageIds = [];
  let reference = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") imageIds.push(node.attrs.imageId);
    if (node.type.name === "paperImageReference") reference = node.attrs;
  });
  assert.equal(imageIds[0], IMAGE_ONE);
  assert.notEqual(imageIds[1], IMAGE_ONE);
  assert.equal(new Set(imageIds).size, 2);
  assert.equal(reference.imageId, IMAGE_ONE);
  assert.equal(reference.number, 1);
  editor.destroy();
});

test("all structured inline nodes reject formatting marks", () => {
  const editor = createEditor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] });
  const bold = editor.schema.marks.bold;
  PROTECTED_INLINE_NODE_TYPES.forEach((name) => {
    assert.equal(editor.schema.nodes[name].allowsMarkType(bold), false, `${name} must reject bold marks`);
  });
  editor.destroy();
});

test("external links render as atomic nodes and normalize only supported protocols", () => {
  const editor = createEditor({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "paperExternalLink", attrs: { href: "https://example.com/a", label: "示例" } }] }],
  });
  const node = editor.state.doc.firstChild.firstChild;
  const output = node.type.spec.toDOM(node);
  assert.equal(node.isAtom, true);
  assert.equal(output[0], "a");
  assert.equal(output[1]["data-paper-external-link"], "true");
  assert.equal(output[2][2], "示例");
  assert.equal(normalizeExternalLinkUrl("example.com"), "https://example.com/");
  assert.equal(normalizeExternalLinkUrl("javascript:alert(1)"), "");
  editor.destroy();
});

test("typing a complete URL and pasting a URL over text create atomic links", () => {
  const plugin = StructuredInlineBehavior.config.addProseMirrorPlugins()[0];
  const typed = createEditor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "https://example.com" }] }] });
  const typedPosition = 1 + "https://example.com".length;
  let typedState = typed.state;
  const typedView = { get state() { return typedState; }, dispatch(transaction) { typedState = typedState.apply(transaction); } };
  const typedHandled = plugin.props.handleTextInput(typedView, typedPosition, typedPosition, " ");
  assert.equal(typedHandled, true);
  assert.equal(typedState.doc.firstChild.firstChild.type.name, "paperExternalLink");
  assert.equal(typedState.doc.firstChild.firstChild.attrs.href, "https://example.com/");
  typed.destroy();

  const pasted = createEditor({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "点击此处" }] }] });
  let pastedState = pasted.state.apply(pasted.state.tr.setSelection(pasted.state.selection.constructor.create(pasted.state.doc, 1, 5)));
  const pastedView = { get state() { return pastedState; }, dispatch(transaction) { pastedState = pastedState.apply(transaction); } };
  let prevented = false;
  const pasteEvent = {
    preventDefault() { prevented = true; },
    clipboardData: { getData: (type) => type === "text/plain" ? "https://example.com/path" : "" },
  };
  const pasteHandled = plugin.props.handlePaste(pastedView, pasteEvent, null);
  assert.equal(pasteHandled, true);
  assert.equal(prevented, true);
  assert.equal(pastedState.doc.firstChild.firstChild.type.name, "paperExternalLink");
  assert.equal(pastedState.doc.firstChild.firstChild.attrs.label, "点击此处");
  pasted.destroy();
});

test("image-reference clipboard scope accepts only complete same-document metadata", () => {
  const element = (sourceDocumentId, imageId = IMAGE_ONE) => ({
    getAttribute(name) {
      return ({ "data-source-document-id": sourceDocumentId, "data-image-id": imageId })[name] || "";
    },
  });
  assert.equal(imageReferencePasteAllowed([element(DOCUMENT_ONE)], DOCUMENT_ONE), true);
  assert.equal(imageReferencePasteAllowed([element(DOCUMENT_ONE)], DOCUMENT_TWO), false);
  assert.equal(imageReferencePasteAllowed([element("")], DOCUMENT_ONE), false);
  assert.equal(imageReferencePasteAllowed([element(DOCUMENT_ONE, "bad")], DOCUMENT_ONE), false);
});

test("the copy-reference control is gated by both image-caption template flags", () => {
  const app = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(app, /className="image-copy-reference"/);
  assert.match(app, /function paperCanvasViewModel[\s\S]*documentId: normalizeDocumentId\(document\.documentId\)/);
  assert.match(app, /data-paper-document-id=\{normalizeDocumentId\(document\.documentId\)\}/);
  assert.match(css, /\.image-size-tools \.image-copy-reference \{[\s\S]*display: none;/);
  assert.match(css, /\.paper-sheet\.shows-image-captions\.numbers-image-captions \.image-size-tools \.image-copy-reference \{[\s\S]*display: flex;/);
});
