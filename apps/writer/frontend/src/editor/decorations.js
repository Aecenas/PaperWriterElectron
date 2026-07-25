import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { computePaperDerivedState, EMPTY_PAPER_DERIVED_STATE } from "../editor-derived-state.js";
import { mapDocumentCommentsThroughTransaction, normalizeDocumentComments } from "../editor-comments.js";
import { DEFAULT_TEMPLATE_PRESENTATION } from "../templates/model.js";
import { COMMENT_COLOR_PALETTE, assignDocumentCommentPresentations } from "./comment-model.js";

export const AI_CHAT_SELECTION_PLUGIN_KEY = new PluginKey("paperwriterAiChatSelections");
export const AI_APPLY_PREVIEW_PLUGIN_KEY = new PluginKey("paperwriterAiApplyPreview");
export const DOCUMENT_COMMENT_PLUGIN_KEY = new PluginKey("paperwriterDocumentComments");
export const HEADING_NUMBERING_PLUGIN_KEY = new PluginKey("paperwriterHeadingNumbers");
export const PAPER_DERIVED_STATE_PLUGIN_KEY = new PluginKey("paperwriterDerivedState");

export function buildAiChatSelectionDecorationSet(doc, selections = []) {
  const maxPosition = doc.content.size;
  const decorations = selections.flatMap((selection, index) => {
    const from = Math.max(1, Math.min(Number(selection.from) || 1, maxPosition));
    const to = Math.max(1, Math.min(Number(selection.to) || 1, maxPosition));
    if (from === to) {
      return [];
    }
    const displayIndex = index + 1;
    return Decoration.inline(
      Math.min(from, to),
      Math.max(from, to),
      {
        class: "ai-chat-selection-decoration",
        "data-ai-selection-index": String(displayIndex),
        title: `已标记${displayIndex}`,
      },
      { inclusiveStart: false, inclusiveEnd: false },
    );
  });
  return DecorationSet.create(doc, decorations);
}

export function buildDocumentCommentDecorationSet(doc, comments = []) {
  const maxPosition = doc.content.size;
  const normalizedComments = normalizeDocumentComments(comments);
  const presentations = assignDocumentCommentPresentations(normalizedComments);
  const decorations = normalizedComments.flatMap((comment) => {
    const from = Math.max(1, Math.min(Number(comment.from) || 1, maxPosition));
    const to = Math.max(1, Math.min(Number(comment.to) || 1, maxPosition));
    if (from === to) {
      return [];
    }
    const presentation = presentations.get(comment.id);
    const color = presentation?.color || COMMENT_COLOR_PALETTE[0];
    return Decoration.inline(
      Math.min(from, to),
      Math.max(from, to),
      {
        class: "document-comment-decoration",
        "data-comment-id": comment.id,
        style: `--comment-border: ${color.border}; --comment-bg: ${color.bg};`,
        title: "这段文字有评注",
      },
      { inclusiveStart: false, inclusiveEnd: false },
    );
  });
  return DecorationSet.create(doc, decorations);
}

export function normalizeHeadingNumberingDefaults(value) {
  const source = value && typeof value === "object" ? value : {};
  return { 1: source[1] !== false, 2: source[2] !== false, 3: source[3] !== false };
}

export function numberHeadingItems(headingItems = [], numberingDefaults = DEFAULT_TEMPLATE_PRESENTATION.headingNumbering) {
  const normalizedDefaults = normalizeHeadingNumberingDefaults(numberingDefaults);
  const counters = [0, 0, 0];
  const items = [];
  headingItems.forEach((heading) => {
    const level = Math.max(1, Math.min(3, Number(heading.level) || 1));
    const text = heading.text?.trim();
    if (!text || text === "目录") return;
    const numberingMode = ["inherit", "on", "off"].includes(heading.numberingMode) ? heading.numberingMode : "inherit";
    const numbered = numberingMode === "on" || (numberingMode === "inherit" && normalizedDefaults[level]);
    let number = "";
    if (numbered) {
      counters[level - 1] += 1;
      for (let index = level; index < counters.length; index += 1) {
        counters[index] = 0;
      }
      const parts = counters.slice(0, level).filter((value) => value > 0);
      number = parts.join(".");
    }
    items.push({
      id: heading.id,
      level,
      text,
      pos: heading.pos,
      numbered,
      numberingMode,
      number,
    });
  });
  return items;
}

export function buildHeadingNumberDecorationSet(doc, headingItems, numberingDefaults = DEFAULT_TEMPLATE_PRESENTATION.headingNumbering) {
  const decorations = numberHeadingItems(headingItems, numberingDefaults).flatMap((item) => {
    const node = doc.nodeAt(item.pos);
    if (!node) {
      return [];
    }
    return Decoration.node(
      item.pos,
      item.pos + node.nodeSize,
      item.number
        ? {
            "data-heading-number": item.number,
            "data-heading-numbered": "true",
          }
        : {
            "data-heading-numbered": "false",
          },
    );
  });
  return DecorationSet.create(doc, decorations);
}

export function selectionTouchesNodeType(editor, typeName) {
  const selection = editor?.state?.selection;
  if (!selection) {
    return false;
  }
  if (selection.node?.type?.name === typeName) {
    return true;
  }
  let touches = false;
  editor.state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.type.name === typeName) {
      touches = true;
      return false;
    }
    return true;
  });
  return touches;
}

export const AiChatSelectionDecorations = Extension.create({
  name: "aiChatSelectionDecorations",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: AI_CHAT_SELECTION_PLUGIN_KEY,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, previousDecorationSet) {
            const nextSelections = transaction.getMeta(AI_CHAT_SELECTION_PLUGIN_KEY);
            if (Array.isArray(nextSelections)) {
              return buildAiChatSelectionDecorationSet(transaction.doc, nextSelections);
            }
            return previousDecorationSet.map(transaction.mapping, transaction.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

export function buildAiApplyPreviewDecorationSet(doc, preview) {
  const operation = preview?.resolved?.operation;
  const manifest = preview?.resolved?.manifest;
  if (!operation || !manifest) return DecorationSet.empty;

  const decorations = [];
  if (operation.action === "replace") {
    (operation.targetBlockIds || []).forEach((targetBlockId) => {
      const target = manifest.blocks?.find((block) => block.id === targetBlockId);
      if (!target || target.from < 0 || target.to > doc.content.size || target.from >= target.to) return;
      decorations.push(Decoration.node(target.from, target.to, {
        class: "ai-apply-preview-original",
        "data-ai-apply-preview": preview.id,
      }));
    });
  }

  const position = Math.max(0, Math.min(Number(operation.to) || 0, doc.content.size));
  decorations.push(Decoration.widget(position, () => {
    const card = window.document.createElement("section");
    card.className = `ai-apply-preview-card${preview.commentCount ? " has-comment-warning" : ""}`;
    card.contentEditable = "false";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", "直接应用修改对比");
    card.dataset.aiApplyPreview = preview.id;

    const heading = window.document.createElement("div");
    heading.className = "ai-apply-preview-heading";
    const label = window.document.createElement("strong");
    label.textContent = operation.action === "replace" ? "蓝色：拟替换内容" : "蓝色：拟插入内容";
    const action = window.document.createElement("span");
    action.textContent = preview.actionLabel;
    heading.append(label, action);

    const body = window.document.createElement("div");
    body.className = "ai-apply-preview-proposed";
    // operation.html is assembled locally from an allowlist; no model-provided HTML reaches this sink.
    body.innerHTML = operation.html || "";

    const details = window.document.createElement("p");
    details.className = "ai-apply-preview-details";
    details.textContent = [
      operation.action === "replace" ? "红色：确认后删除的原文" : "原文保持不变",
      `目标：${preview.targetSummary}`,
      preview.commentCount ? `可能影响 ${preview.commentCount} 条评注` : "不会覆盖现有评注",
    ].join(" · ");

    const actions = window.document.createElement("div");
    actions.className = "ai-apply-preview-actions";
    const cancel = window.document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.addEventListener("mousedown", (event) => event.stopPropagation());
    cancel.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      preview.onCancel?.();
    });
    const confirm = window.document.createElement("button");
    confirm.type = "button";
    confirm.className = "primary";
    confirm.textContent = "确认应用";
    confirm.addEventListener("mousedown", (event) => event.stopPropagation());
    confirm.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      preview.onConfirm?.();
    });
    actions.append(cancel, confirm);
    card.append(heading, body, details, actions);
    return card;
  }, {
    side: operation.action === "insert_before" ? -1 : 1,
    key: `ai-apply-preview-${preview.id}`,
    stopEvent: (event) => Boolean(event.target?.closest?.(".ai-apply-preview-card")),
  }));
  return DecorationSet.create(doc, decorations);
}

export const AiApplyPreviewDecorations = Extension.create({
  name: "aiApplyPreviewDecorations",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: AI_APPLY_PREVIEW_PLUGIN_KEY,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, previousDecorationSet) {
            const meta = transaction.getMeta(AI_APPLY_PREVIEW_PLUGIN_KEY);
            if (meta?.type === "show") return buildAiApplyPreviewDecorationSet(transaction.doc, meta.preview);
            if (meta?.type === "clear" || transaction.docChanged) return DecorationSet.empty;
            return previousDecorationSet.map(transaction.mapping, transaction.doc);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

export const PaperDerivedState = Extension.create({
  name: "paperDerivedState",
  priority: 110,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: PAPER_DERIVED_STATE_PLUGIN_KEY,
        state: {
          init: (_, state) => computePaperDerivedState(state.doc),
          apply(transaction, previousState) {
            return transaction.docChanged ? computePaperDerivedState(transaction.doc) : previousState;
          },
        },
      }),
    ];
  },
});

export const DocumentCommentDecorations = Extension.create({
  name: "documentCommentDecorations",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: DOCUMENT_COMMENT_PLUGIN_KEY,
        state: {
          init: () => ({ comments: [], hidden: false, decorations: DecorationSet.empty }),
          apply(transaction, previousState) {
            const meta = transaction.getMeta(DOCUMENT_COMMENT_PLUGIN_KEY);
            if (!transaction.docChanged && !meta) return previousState;
            let comments = previousState.comments;
            let hidden = previousState.hidden;
            if (meta?.type === "set-comments") {
              comments = normalizeDocumentComments(meta.comments);
            } else if (transaction.docChanged) {
              comments = mapDocumentCommentsThroughTransaction(
                previousState.comments,
                transaction,
                transaction.doc.content.size,
              );
            }
            if (meta?.type === "set-visibility") hidden = Boolean(meta.hidden);
            const decorations = hidden
              ? DecorationSet.empty
              : (!meta && transaction.docChanged
                ? previousState.decorations.map(transaction.mapping, transaction.doc)
                : buildDocumentCommentDecorationSet(transaction.doc, comments));
            return {
              comments,
              hidden,
              decorations,
            };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations || DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

export const HeadingMetadata = Extension.create({
  name: "headingMetadata",

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          numberingMode: {
            default: "inherit",
            parseHTML: (element) => {
              const mode = element.getAttribute("data-heading-numbering-mode");
              if (mode === "on" || mode === "off") {
                return mode;
              }
              return element.getAttribute("data-heading-numbered") === "false" ? "off" : "inherit";
            },
            renderHTML: (attributes) => {
              if (attributes.numberingMode === "off") {
                return { "data-heading-numbering-mode": "off", "data-heading-numbered": "false" };
              }
              if (attributes.numberingMode === "on") {
                return { "data-heading-numbering-mode": "on", "data-heading-numbered": "true" };
              }
              return {};
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: HEADING_NUMBERING_PLUGIN_KEY,
        state: {
          init: (_, state) => {
            const defaults = normalizeHeadingNumberingDefaults();
            const headings = PAPER_DERIVED_STATE_PLUGIN_KEY.getState(state)?.headingItems
              || computePaperDerivedState(state.doc).headingItems;
            return { defaults, decorations: buildHeadingNumberDecorationSet(state.doc, headings, defaults) };
          },
          apply(transaction, previousState, _oldState, newState) {
            const metaDefaults = transaction.getMeta(HEADING_NUMBERING_PLUGIN_KEY);
            const defaults = metaDefaults
              ? normalizeHeadingNumberingDefaults(metaDefaults)
              : previousState.defaults;
            if (transaction.docChanged || metaDefaults) {
              const headings = PAPER_DERIVED_STATE_PLUGIN_KEY.getState(newState)?.headingItems
                || computePaperDerivedState(transaction.doc).headingItems;
              return { defaults, decorations: buildHeadingNumberDecorationSet(transaction.doc, headings, defaults) };
            }
            return {
              defaults,
              decorations: previousState.decorations.map(transaction.mapping, transaction.doc),
            };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations || DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

export function syncAiChatSelectionDecorations(editor, selections = []) {
  if (!editor?.view) {
    return;
  }
  editor.view.dispatch(editor.state.tr.setMeta(AI_CHAT_SELECTION_PLUGIN_KEY, selections));
}

export function syncAiApplyPreviewDecorations(editor, preview = null) {
  if (!editor?.view || editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(AI_APPLY_PREVIEW_PLUGIN_KEY, preview
    ? { type: "show", preview }
    : { type: "clear" }));
}

export function syncDocumentCommentDecorations(editor, comments = []) {
  if (!editor?.view) {
    return;
  }
  editor.view.dispatch(editor.state.tr.setMeta(DOCUMENT_COMMENT_PLUGIN_KEY, {
    type: "set-comments",
    comments,
  }));
}

export function setDocumentCommentVisibility(editor, hidden) {
  if (!editor?.view) return;
  editor.view.dispatch(editor.state.tr.setMeta(DOCUMENT_COMMENT_PLUGIN_KEY, {
    type: "set-visibility",
    hidden: Boolean(hidden),
  }));
}

export function getDocumentComments(editor, fallback = []) {
  if (!editor?.state) return normalizeDocumentComments(fallback);
  return DOCUMENT_COMMENT_PLUGIN_KEY.getState(editor.state)?.comments || normalizeDocumentComments(fallback);
}

export function getPaperDerivedState(editor) {
  if (!editor?.state) return EMPTY_PAPER_DERIVED_STATE;
  return PAPER_DERIVED_STATE_PLUGIN_KEY.getState(editor.state) || EMPTY_PAPER_DERIVED_STATE;
}

export function syncHeadingNumberingDefaults(editor, headingNumbering) {
  if (!editor?.view) {
    return;
  }
  editor.view.dispatch(editor.state.tr.setMeta(HEADING_NUMBERING_PLUGIN_KEY, headingNumbering));
}
