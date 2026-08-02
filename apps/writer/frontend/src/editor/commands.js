import { TextSelection } from "@tiptap/pm/state";
import { bridge } from "../bridge.js";
import { normalizeExternalLinkUrl } from "../structured-inline-extensions.js";
import {
  HEADING_NUMBERING_PLUGIN_KEY,
  getPaperDerivedState,
} from "./decorations.js";

export function insertStructuredQuote(editor, savedSelectionRef) {
  if (!editor) {
    return;
  }
  const range = getSafeSelectionRange(editor, savedSelectionRef);
  if (range) {
    editor.commands.focus();
    editor.commands.setTextSelection(range);
  }
  if (editor.isActive("blockquote")) {
    editor.chain().focus().lift("blockquote").run();
    return;
  }

  const { from, to } = editor.state.selection;
  const selectedText = editor.state.doc.textBetween(from, to, "\n").trim();
  editor
    .chain()
    .focus()
    .insertContent({
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: selectedText || "在这里写引用内容。" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "—— 来源" }],
        },
      ],
    })
    .run();
}

export function getSafeSelectionRange(editor, savedSelectionRef) {
  const range = savedSelectionRef?.current;
  if (!editor || !range) {
    return null;
  }
  const maxPosition = editor.state.doc.content.size;
  return {
    from: Math.max(1, Math.min(range.from, maxPosition)),
    to: Math.max(1, Math.min(range.to, maxPosition)),
  };
}

export function getSelectedPlainText(editor, savedSelectionRef) {
  const range = getSafeSelectionRange(editor, savedSelectionRef);
  if (!editor || !range || range.from === range.to) {
    return null;
  }
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  const text = editor.state.doc.textBetween(from, to, "\n\n", "\n").replace(/\s+\n/g, "\n").trim();
  if (!text) {
    return null;
  }
  return {
    text,
    from,
    to,
    capturedAt: Date.now(),
  };
}

export function runEditorCommand(editor, savedSelectionRef, buildCommand) {
  if (!editor) {
    return;
  }
  const range = getSafeSelectionRange(editor, savedSelectionRef);
  const chain = editor.chain().focus();
  if (range) {
    chain.setTextSelection(range);
  }
  buildCommand(chain).run();
}

export function setHeadingLevel(editor, savedSelectionRef, level) {
  const normalizedLevel = Math.max(1, Math.min(4, Math.floor(Number(level) || 1)));
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.toggleHeading({ level: normalizedLevel, numberingMode: "inherit" }));
}

export function getSelectedHeadingNode(editor, savedSelectionRef) {
  if (!editor) {
    return null;
  }
  const currentSelection = editor.state.selection;
  const range = !currentSelection.empty ? currentSelection : (getSafeSelectionRange(editor, savedSelectionRef) || currentSelection);
  const position = Math.max(1, Math.min(range.from, editor.state.doc.content.size));
  const resolved = editor.state.doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === "heading") {
      return {
        node,
        pos: resolved.before(depth),
      };
    }
  }
  return null;
}

export function toggleSelectedHeadingNumbering(editor, savedSelectionRef) {
  const heading = getSelectedHeadingNode(editor, savedSelectionRef);
  if (!heading) {
    return;
  }
  const level = Math.max(1, Math.min(4, Number(heading.node.attrs.level) || 1));
  const pluginState = HEADING_NUMBERING_PLUGIN_KEY.getState(editor.state);
  const inheritedNumbering = pluginState?.defaults?.[level] !== false;
  const mode = ["inherit", "on", "off"].includes(heading.node.attrs.numberingMode)
    ? heading.node.attrs.numberingMode
    : "inherit";
  const effectiveNumbering = mode === "on" || (mode === "inherit" && inheritedNumbering);
  const nextMode = mode === "inherit" ? (effectiveNumbering ? "off" : "on") : "inherit";
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.updateAttributes("heading", { numberingMode: nextMode }));
}

export function insertPageBreak(editor, savedSelectionRef) {
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.insertContent({ type: "paperPageBreak" }));
}

export function insertHorizontalRule(editor, savedSelectionRef) {
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.insertContent({ type: "paperHorizontalRule" }));
}

export function insertBasicTable(editor, savedSelectionRef) {
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }));
}

export function normalizeLinkUrl(value) {
  const source = String(value || "").trim();
  if (!source) {
    return { ok: false, error: "请输入链接地址" };
  }
  const url = normalizeExternalLinkUrl(source);
  return url ? { ok: true, url } : { ok: false, error: "链接地址格式不正确，仅支持 http、https 和邮箱链接" };
}

export function getEditorLinkContext(editor, savedSelectionRef) {
  if (!editor) {
    return null;
  }
  const current = editor.state.selection;
  const saved = getSafeSelectionRange(editor, savedSelectionRef);
  let from = current.from;
  let to = current.to;
  if (current.empty && saved && saved.from !== saved.to) {
    from = saved.from;
    to = saved.to;
  }
  const directNode = editor.state.doc.nodeAt(from);
  if (directNode?.type?.name === "paperExternalLink" && (from === to || to === from + directNode.nodeSize)) {
    return {
      from,
      to: from + directNode.nodeSize,
      text: directNode.attrs.label || directNode.attrs.href || "链接",
      url: directNode.attrs.href || "",
      editing: true,
    };
  }
  const selectedText = editor.state.doc.textBetween(from, to, " ").trim();
  if (from !== to) {
    return { from, to, text: selectedText, url: "", editing: false };
  }

  const resolved = editor.state.doc.resolve(Math.max(1, Math.min(from, editor.state.doc.content.size)));
  const parent = resolved.parent;
  const parentStart = resolved.start();
  let linked = null;
  parent.forEach((child, offset) => {
    if (linked || child.type.name !== "paperExternalLink") return;
    const childFrom = parentStart + offset;
    const childTo = childFrom + child.nodeSize;
    if (from >= childFrom && from <= childTo) {
      linked = {
        from: childFrom,
        to: childTo,
        text: child.attrs.label || child.attrs.href || "链接",
        url: child.attrs.href || "",
        editing: true,
      };
    }
  });
  return linked || { from, to, text: "", url: "", editing: false };
}

export function getClickedLinkContext(editor, anchor) {
  if (!editor || !anchor) {
    return null;
  }
  try {
    const from = editor.view.posAtDOM(anchor, 0);
    const node = editor.state.doc.nodeAt(from);
    const to = from + (node?.type?.name === "paperExternalLink" ? node.nodeSize : 1);
    return {
      from,
      to,
      text: node?.attrs?.label || anchor.textContent || "",
      url: anchor.getAttribute("href") || "",
      editing: true,
    };
  } catch {
    const context = getEditorLinkContext(editor, null);
    return context?.editing ? context : null;
  }
}

export function handleEditorLinkClick(event, { editor, disabled = false, onEditLink } = {}) {
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!anchor) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.ctrlKey || event.metaKey) {
    bridge.openExternal?.(anchor.getAttribute("href"));
    return;
  }
  if (disabled || !onEditLink) {
    return;
  }
  const context = getClickedLinkContext(editor, anchor);
  if (context) {
    onEditLink(context, editor);
  }
}

export function runTableCommand(editor, command) {
  if (!editor || !command) {
    return;
  }
  editor.chain().focus()[command]().run();
}

export function getActiveTableElement(editor) {
  if (!editor?.view) {
    return null;
  }
  const selection = editor.state.selection;
  const resolved = selection.$anchor;
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === "table") {
      const dom = editor.view.nodeDOM(resolved.before(depth));
      if (dom?.nodeType === window.Node.ELEMENT_NODE) {
        return dom.matches(".tableWrapper") ? dom : (dom.closest(".tableWrapper") || dom);
      }
    }
  }
  const browserSelection = window.getSelection();
  const anchorNode = browserSelection?.anchorNode;
  const anchorElement = anchorNode?.nodeType === window.Node.ELEMENT_NODE ? anchorNode : anchorNode?.parentElement;
  return anchorElement?.closest?.(".tableWrapper, table") || null;
}

export function insertFinalizedBreak(editor, savedSelectionRef) {
  if (getPaperDerivedState(editor).hasFinalizedBreak) {
    return;
  }
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.insertContent({ type: "paperFinalizedBreak" }));
}

export function removeFinalizedBreak(editor) {
  if (!editor) {
    return;
  }
  let finalizedBreakRange = null;
  editor.state.doc.content.forEach((node, pos) => {
    if (!finalizedBreakRange && node.type?.name === "paperFinalizedBreak") {
      finalizedBreakRange = { from: pos, to: pos + node.nodeSize };
    }
  });
  if (!finalizedBreakRange) {
    return;
  }
  editor.view.dispatch(editor.state.tr.delete(finalizedBreakRange.from, finalizedBreakRange.to).scrollIntoView());
  editor.view.focus();
}

export function insertTableOfContents(editor, savedSelectionRef) {
  if (!editor) {
    return;
  }
  const positions = getPaperDerivedState(editor).tableOfContentsPositions;
  if (positions.length) {
    const tr = editor.state.tr;
    positions
      .slice()
      .reverse()
      .forEach(({ pos, nodeSize }) => {
        tr.delete(pos, pos + nodeSize);
      });
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
    return;
  }
  const tocNode = editor.schema.nodes.paperTableOfContents.create();
  const tr = editor.state.tr.insert(0, tocNode);
  const selectionPos = Math.min(tocNode.nodeSize, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos), 1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  savedSelectionRef.current = null;
}

export function toggleAutomaticBibliography(editor) {
  if (!editor?.state?.doc || !editor.schema.nodes.paperBibliography) return;
  const bibliographyPosition = findKnowledgeNodePosition(editor, "paperBibliography");
  let transaction = editor.state.tr;
  if (Number.isFinite(bibliographyPosition)) {
    const bibliographyNode = transaction.doc.nodeAt(bibliographyPosition);
    transaction = transaction.delete(bibliographyPosition, bibliographyPosition + bibliographyNode.nodeSize);
  } else {
    transaction = transaction.insert(transaction.doc.content.size, editor.schema.nodes.paperBibliography.create({ entries: [] }));
  }
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
}

export function findKnowledgeNodePosition(editor, typeName, attributeName = "", attributeValue = "") {
  let found = null;
  editor?.state?.doc?.descendants?.((node, position) => {
    if (found !== null || node.type.name !== typeName) return;
    if (attributeName && node.attrs?.[attributeName] !== attributeValue) return;
    found = position;
  });
  return found;
}

