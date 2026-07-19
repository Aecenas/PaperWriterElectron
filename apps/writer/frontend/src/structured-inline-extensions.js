import { Extension, Node, mergeAttributes } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { createDocumentId, normalizeDocumentId } from "./document-schema-v2.js";

export const PROTECTED_INLINE_NODE_TYPES = Object.freeze([
  "paperImageReference",
  "paperExternalLink",
  "paperInternalLink",
  "paperFootnoteReference",
  "paperCitationReference",
]);

const PROTECTED_INLINE_NODE_TYPE_SET = new Set(PROTECTED_INLINE_NODE_TYPES);
const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const MAX_LINK_TEXT = 2_000;
const MAX_LINK_URL = 8_192;

function boundedText(value, maximum = MAX_LINK_TEXT) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, maximum);
}

function safeImageNumber(value) {
  return Math.max(1, Math.min(5_000, Number.parseInt(value, 10) || 1));
}

export function normalizeExternalLinkUrl(value) {
  const source = boundedText(value, MAX_LINK_URL).trim();
  if (!source) return "";
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(source) ? source : `https://${source}`;
  try {
    const parsed = new URL(withProtocol);
    return LINK_PROTOCOLS.has(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function externalLinkLabel(value, fallback = "链接") {
  return boundedText(value || fallback).trim() || fallback;
}

function copyFragment(fragment, transform) {
  const children = [];
  fragment.forEach((node) => {
    const content = node.content?.size ? copyFragment(node.content, transform) : node.content;
    children.push(transform(node, content));
  });
  return Fragment.fromArray(children);
}

function transformSlice(slice, transform) {
  return new Slice(copyFragment(slice.content, transform), slice.openStart, slice.openEnd);
}

function recreateNode(node, content, attrs = node.attrs, marks = node.marks) {
  return node.type.create(attrs, content, marks);
}

function currentDocumentId(view) {
  return normalizeDocumentId(view?.dom?.closest?.(".paper-sheet[data-paper-document-id]")?.getAttribute("data-paper-document-id"));
}

function clipboardImageReferenceElements(event) {
  const html = event?.clipboardData?.getData?.("text/html") || "";
  if (!html || typeof DOMParser === "undefined") return [];
  try {
    return [...new DOMParser().parseFromString(html, "text/html").querySelectorAll("[data-paper-image-reference]")];
  } catch {
    return [];
  }
}

export function imageReferencePasteAllowed(references, documentId) {
  const currentId = normalizeDocumentId(documentId);
  return Boolean(currentId) && Array.from(references || []).every((element) => {
    const sourceDocumentId = normalizeDocumentId(element?.getAttribute?.("data-source-document-id"));
    const imageId = normalizeDocumentId(element?.getAttribute?.("data-image-id"));
    return Boolean(imageId && sourceDocumentId && sourceDocumentId === currentId);
  });
}

function clipboardPlainText(slice) {
  return slice.content.textBetween(0, slice.content.size, "\n", (node) => {
    if (node.type.name === "paperImageReference") return node.attrs.missing ? "图片已删除" : `图${safeImageNumber(node.attrs.number)}`;
    if (node.type.name === "paperExternalLink") return externalLinkLabel(node.attrs.label, node.attrs.href || "链接");
    if (node.type.name === "paperInternalLink") return externalLinkLabel(node.attrs.label || node.attrs.title, "关联信笺");
    if (node.type.name === "paperFootnoteReference") return String(safeImageNumber(node.attrs.number));
    if (node.type.name === "paperCitationReference") return `[${safeImageNumber(node.attrs.number)}]`;
    return "";
  });
}

function singlePastedUrl(event) {
  const text = String(event?.clipboardData?.getData?.("text/plain") || "").trim();
  if (!text || /\s/.test(text)) return null;
  const href = normalizeExternalLinkUrl(text);
  return href ? { href, label: text.slice(0, MAX_LINK_TEXT) } : null;
}

function trailingTypedUrl(state, position) {
  const resolved = state.doc.resolve(position);
  if (!resolved.parent.isTextblock) return null;
  const before = resolved.parent.textBetween(0, resolved.parentOffset, " ", " ");
  const match = before.match(/(?:^|\s)((?:(?:https?:\/\/)|(?:www\.)|(?:mailto:))[^\s<>()]+)$/i);
  if (!match?.[1]) return null;
  const label = match[1];
  const href = normalizeExternalLinkUrl(label);
  if (!href) return null;
  return { from: position - label.length, to: position, href, label };
}

export const PaperImageReference = Node.create({
  name: "paperImageReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "",

  addAttributes() {
    return {
      imageId: { default: "", parseHTML: (element) => normalizeDocumentId(element.getAttribute("data-image-id")) },
      number: { default: 1, parseHTML: (element) => safeImageNumber(element.getAttribute("data-image-number")) },
      missing: { default: false, parseHTML: (element) => element.getAttribute("data-missing") === "true" },
      sourceDocumentId: { default: "", parseHTML: (element) => normalizeDocumentId(element.getAttribute("data-source-document-id")) },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-paper-image-reference]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const { imageId: rawImageId, number: rawNumber, missing: rawMissing, sourceDocumentId: rawSourceDocumentId, ...rest } = HTMLAttributes;
    const imageId = normalizeDocumentId(rawImageId);
    const sourceDocumentId = normalizeDocumentId(rawSourceDocumentId);
    const missing = Boolean(rawMissing) || !imageId;
    const number = safeImageNumber(rawNumber);
    const label = missing ? "图片已删除" : `图${number}`;
    const attributes = {
      class: "paper-image-reference",
      "data-paper-image-reference": "true",
      "data-image-id": imageId,
      "data-image-number": String(number),
      "data-missing": missing ? "true" : "false",
      contenteditable: "false",
      role: "button",
      tabindex: "0",
      title: missing ? "目标图片已删除" : `跳转到${label}`,
      "aria-label": missing ? "图片引用已失效" : `跳转到${label}`,
    };
    if (sourceDocumentId) attributes["data-source-document-id"] = sourceDocumentId;
    return ["span", mergeAttributes(rest, attributes), ["span", { class: "paper-image-reference-icon", "aria-hidden": "true" }], ["span", { class: "paper-image-reference-label" }, label]];
  },
});

export const PaperExternalLink = Node.create({
  name: "paperExternalLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "",
  priority: 1_000,

  addAttributes() {
    return {
      href: { default: "", parseHTML: (element) => normalizeExternalLinkUrl(element.getAttribute("href")) },
      label: { default: "链接", parseHTML: (element) => externalLinkLabel(element.textContent, element.getAttribute("href") || "链接") },
    };
  },

  parseHTML() {
    return [{ tag: "a[href]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const { href: rawHref, label: rawLabel, ...rest } = HTMLAttributes;
    const href = normalizeExternalLinkUrl(rawHref);
    const label = externalLinkLabel(rawLabel, href || "链接");
    return ["a", mergeAttributes(rest, {
      class: "paper-external-link",
      "data-paper-external-link": "true",
      href: href || "#",
      contenteditable: "false",
      rel: "noopener noreferrer nofollow",
      target: "_blank",
      title: "单击编辑链接；Ctrl/Command + 单击打开链接",
    }), ["span", { class: "paper-external-link-label" }, label]];
  },
});

export const StructuredInlineBehavior = Extension.create({
  name: "paperStructuredInlineBehavior",

  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleClick(view, _position, event) {
          const element = event.target?.closest?.("[data-paper-image-reference]");
          if (!element) return false;
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("paper-image-reference-open", { detail: {
            imageId: element.getAttribute("data-image-id") || "",
            number: safeImageNumber(element.getAttribute("data-image-number")),
            missing: element.getAttribute("data-missing") === "true",
            editorDom: view.dom,
            anchorElement: element,
          } }));
          return true;
        },
        handleKeyDown(view, event) {
          if (event.key !== "Enter" && event.key !== " ") return false;
          const element = event.target?.closest?.("[data-paper-image-reference]");
          if (!element) return false;
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("paper-image-reference-open", { detail: {
            imageId: element.getAttribute("data-image-id") || "",
            number: safeImageNumber(element.getAttribute("data-image-number")),
            missing: element.getAttribute("data-missing") === "true",
            editorDom: view.dom,
            anchorElement: element,
          } }));
          return true;
        },
        handlePaste(view, event) {
          const references = clipboardImageReferenceElements(event);
          if (references.length) {
            const documentId = currentDocumentId(view);
            const valid = imageReferencePasteAllowed(references, documentId);
            if (!valid) {
              event.preventDefault();
              window.dispatchEvent(new CustomEvent("paper-image-reference-paste-blocked", { detail: { editorDom: view.dom } }));
              return true;
            }
            return false;
          }

          const pastedUrl = singlePastedUrl(event);
          if (!pastedUrl) return false;
          event.preventDefault();
          const { from, to } = view.state.selection;
          const selectedText = view.state.doc.textBetween(from, to, " ").trim();
          const node = view.state.schema.nodes.paperExternalLink.create({
            href: pastedUrl.href,
            label: selectedText || pastedUrl.label,
          });
          view.dispatch(view.state.tr.replaceWith(from, to, node).scrollIntoView());
          return true;
        },
        handleTextInput(view, from, to, text) {
          if (!/[\s，。！？；：,.!?;:]$/.test(text)) return false;
          const match = trailingTypedUrl(view.state, from);
          if (!match) return false;
          const node = view.state.schema.nodes.paperExternalLink.create({ href: match.href, label: match.label });
          const transaction = view.state.tr.replaceWith(match.from, match.to, node).insertText(text, match.from + node.nodeSize);
          view.dispatch(transaction.scrollIntoView());
          return true;
        },
        transformCopied(slice, view) {
          const sourceDocumentId = currentDocumentId(view);
          if (!sourceDocumentId) return slice;
          return transformSlice(slice, (node, content) => {
            if (node.type.name !== "paperImageReference") return node.copy(content);
            return recreateNode(node, content, { ...node.attrs, sourceDocumentId }, []);
          });
        },
        transformPasted(slice) {
          const pastedImageIds = new Map();
          let transformed = transformSlice(slice, (node, content) => {
            if (node.type.name !== "image") return node.copy(content);
            const previousId = normalizeDocumentId(node.attrs.imageId);
            const imageId = createDocumentId();
            if (previousId) pastedImageIds.set(previousId, imageId);
            return recreateNode(node, content, { ...node.attrs, imageId }, node.marks);
          });
          transformed = transformSlice(transformed, (node, content) => {
            const type = node.type.name;
            if (type === "paperImageReference") {
              const imageId = pastedImageIds.get(normalizeDocumentId(node.attrs.imageId)) || normalizeDocumentId(node.attrs.imageId);
              return recreateNode(node, content, { ...node.attrs, imageId, sourceDocumentId: "" }, []);
            }
            if (PROTECTED_INLINE_NODE_TYPE_SET.has(type)) return recreateNode(node, content, node.attrs, []);
            return node.copy(content);
          });
          return transformed;
        },
        clipboardTextSerializer: clipboardPlainText,
      },
    })];
  },
});

export function createStructuredInlineExtensions() {
  return [PaperImageReference, PaperExternalLink, StructuredInlineBehavior];
}

export function synchronizeStructuredInlineReferences(editor) {
  if (!editor?.state?.doc) return [];
  const images = [];
  const imageIdOwners = new Set();
  const duplicateImages = [];
  const protectedNodes = [];
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "image") {
      const imageId = normalizeDocumentId(node.attrs.imageId);
      if (imageId && imageIdOwners.has(imageId)) duplicateImages.push({ node, position, imageId: createDocumentId() });
      else if (imageId) imageIdOwners.add(imageId);
      images.push({ node, position, imageId });
    }
    if (PROTECTED_INLINE_NODE_TYPE_SET.has(node.type.name)) protectedNodes.push({ node, position });
  });

  const duplicateByPosition = new Map(duplicateImages.map((item) => [item.position, item.imageId]));
  const imageNumberById = new Map();
  images.forEach((item, index) => {
    const imageId = duplicateByPosition.get(item.position) || item.imageId;
    if (imageId && !imageNumberById.has(imageId)) imageNumberById.set(imageId, index + 1);
  });

  let transaction = editor.state.tr;
  let changed = false;
  duplicateImages.forEach(({ node, position, imageId }) => {
    transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, imageId }, node.marks);
    changed = true;
  });
  protectedNodes.forEach(({ node, position }) => {
    let attrs = node.attrs;
    if (node.type.name === "paperImageReference") {
      const imageId = normalizeDocumentId(node.attrs.imageId);
      const number = imageNumberById.get(imageId) || safeImageNumber(node.attrs.number);
      const missing = !imageNumberById.has(imageId);
      if (number !== Number(node.attrs.number) || missing !== Boolean(node.attrs.missing) || node.attrs.sourceDocumentId) {
        attrs = { ...node.attrs, imageId, number, missing, sourceDocumentId: "" };
      }
    }
    if (attrs !== node.attrs || node.marks.length) {
      transaction = transaction.setNodeMarkup(position, undefined, attrs, []);
      changed = true;
    }
  });
  if (changed) {
    transaction.setMeta("addToHistory", false);
    transaction.setMeta("paperStructuredDerived", true);
    editor.view.dispatch(transaction);
  }
  return images.map((item, index) => ({
    imageId: duplicateByPosition.get(item.position) || item.imageId,
    number: index + 1,
    position: item.position,
  }));
}

export function imageReferenceNumberAt(editor, targetPosition, imageId = "") {
  let number = 0;
  let result = null;
  editor?.state?.doc?.descendants?.((node, position) => {
    if (node.type.name !== "image") return true;
    number += 1;
    const hasTargetPosition = Number.isFinite(targetPosition) && targetPosition >= 0;
    if ((hasTargetPosition && position === targetPosition)
      || (!hasTargetPosition && !result && imageId && normalizeDocumentId(node.attrs.imageId) === normalizeDocumentId(imageId))) {
      result = { number, position, node };
    }
    return true;
  });
  return result;
}
