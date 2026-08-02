import {
  normalizeCodeBlockOptions,
  validateMathDraft,
  validateMermaidDraft,
} from "./model.js";
import { TextSelection } from "@tiptap/pm/state";

function runnableChain(editor) {
  if (typeof editor?.chain !== "function") return null;
  const chain = editor.chain();
  return editor.isInitialized ? chain.focus() : chain;
}

export function insertMathDraft(editor, draft, { update = false } = {}) {
  const validation = validateMathDraft(draft);
  if (!validation.valid) return false;
  const value = validation.value;
  const chain = runnableChain(editor);
  if (!chain) return false;
  if (update) {
    const nodeName = value.mode === "inline" ? "inlineMath" : "blockMath";
    return chain.updateAttributes(nodeName, {
      latex: value.latex,
      ...(value.mode === "block" ? {
        equationId: value.equationId,
        label: value.label,
        numbering: value.numbering,
      } : {}),
    }).run();
  }
  if (value.mode === "inline") {
    return chain.insertContent({ type: "inlineMath", attrs: { latex: value.latex } }).run();
  }
  return chain.insertPaperBlockMath({
    latex: value.latex,
    equationId: value.equationId,
    label: value.label,
    numbering: value.numbering,
  }).run();
}

export function updateMathDraftAt(editor, position, draft) {
  const validation = validateMathDraft(draft);
  const targetPosition = Number(position);
  if (!validation.valid || !Number.isFinite(targetPosition) || targetPosition < 0) return false;
  const node = editor?.state?.doc?.nodeAt?.(targetPosition);
  const value = validation.value;
  const expectedType = value.mode === "inline" ? "inlineMath" : "blockMath";
  if (!node || node.type.name !== expectedType || typeof editor?.commands?.command !== "function") return false;
  const attrs = value.mode === "inline"
    ? { ...node.attrs, latex: value.latex }
    : {
      ...node.attrs,
      latex: value.latex,
      equationId: value.equationId || node.attrs.equationId,
      label: value.label,
      numbering: value.numbering,
    };
  return editor.commands.command(({ tr, dispatch }) => {
    if (dispatch) dispatch(tr.setNodeMarkup(targetPosition, undefined, attrs, node.marks));
    return true;
  });
}

export function insertEquationReference(editor, equationId) {
  const chain = runnableChain(editor);
  return chain ? chain.insertEquationReference(equationId).run() : false;
}

export function applyMermaidDraft(editor, draft, { update = false } = {}) {
  const validation = validateMermaidDraft(draft);
  if (!validation.valid) return false;
  const chain = runnableChain(editor);
  if (!chain) return false;
  const value = validation.value;
  return update
    ? chain.updatePaperMermaid(value).run()
    : chain.insertPaperMermaid(value).run();
}

export function updateMermaidDraftAt(editor, position, draft) {
  const validation = validateMermaidDraft(draft);
  const targetPosition = Number(position);
  if (!validation.valid || !Number.isFinite(targetPosition) || targetPosition < 0) return false;
  const node = editor?.state?.doc?.nodeAt?.(targetPosition);
  if (!node || node.type.name !== "paperMermaid" || typeof editor?.commands?.command !== "function") return false;
  const value = validation.value;
  return editor.commands.command(({ tr, dispatch }) => {
    if (dispatch) {
      dispatch(tr.setNodeMarkup(targetPosition, undefined, {
        ...node.attrs,
        diagramId: value.diagramId || node.attrs.diagramId,
        source: value.source,
        caption: value.caption,
        width: value.width,
      }, node.marks));
    }
    return true;
  });
}

export function readActiveCodeBlockOptions(editor) {
  const active = Boolean(editor?.isActive?.("codeBlock"));
  const attrs = active && typeof editor?.getAttributes === "function"
    ? editor.getAttributes("codeBlock")
    : {};
  return {
    active,
    ...normalizeCodeBlockOptions(attrs),
  };
}

export function applyCodeBlockOptions(editor, options = {}) {
  const value = normalizeCodeBlockOptions(options);
  const chain = runnableChain(editor);
  if (!chain) return false;
  if (editor?.isActive?.("codeBlock")) {
    return chain.updateAttributes("codeBlock", value).run();
  }
  return chain.setCodeBlock(value).run();
}

export function insertCodeBlock(editor, options = {}) {
  const value = normalizeCodeBlockOptions(options);
  const chain = runnableChain(editor);
  if (!chain) return false;
  return chain.command(({ state, tr, dispatch }) => {
    const codeBlockType = state.schema.nodes.codeBlock;
    if (!codeBlockType) return false;
    const codeBlock = codeBlockType.createAndFill(value);
    if (!codeBlock) return false;
    const { $from } = state.selection;
    const insertionPosition = $from.depth > 0 ? $from.after(1) : state.selection.to;
    const transaction = tr.insert(insertionPosition, codeBlock);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertionPosition + 1), 1));
    if (dispatch) dispatch(transaction.scrollIntoView());
    return true;
  }).run();
}

export function insertBookmark(editor, options = {}) {
  const value = typeof options === "string" ? { label: options } : options;
  const chain = runnableChain(editor);
  return chain ? chain.insertPaperBookmark(value || {}).run() : false;
}

export function updateBookmark(editor, bookmarkId, options = {}) {
  const chain = runnableChain(editor);
  return chain ? chain.updatePaperBookmark(bookmarkId, options).run() : false;
}

export function removeBookmark(editor, bookmarkId) {
  const chain = runnableChain(editor);
  return chain ? chain.removePaperBookmark(bookmarkId).run() : false;
}
