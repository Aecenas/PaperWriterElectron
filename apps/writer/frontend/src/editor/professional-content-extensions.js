import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import DOMPurify from "dompurify";
import katex from "katex";
import {
  Check,
  ChevronDown,
  ClipboardCopy,
  GitBranch,
  Pencil,
  Sigma,
  Trash2,
  WrapText,
} from "lucide-react";
import { common, createLowlight } from "lowlight";
import { normalizeEmbedWidth } from "../resource-safety.js";
import { preflightMermaidSource } from "./mermaid-preflight-client.js";
import { MermaidSvg } from "./MermaidSvg.js";
import {
  assertMermaidSourceWithinLimits,
  MERMAID_SAFETY_LIMITS,
} from "./mermaid-safety.js";

const lowlight = createLowlight(common);
const MAX_MERMAID_SOURCE_CHARS = MERMAID_SAFETY_LIMITS.maxChars;
const MAX_MERMAID_LINES = MERMAID_SAFETY_LIMITS.maxLines;
const MAX_MERMAID_EDGES = MERMAID_SAFETY_LIMITS.maxEdges;
const MAX_MERMAID_RENDER_QUEUE = MERMAID_SAFETY_LIMITS.maxQueue;
const MERMAID_RENDER_TIMEOUT_MS = MERMAID_SAFETY_LIMITS.renderTimeoutMs;
const MAX_LATEX_CHARS = 20_000;
const MAX_CODE_HIGHLIGHT_CHARS = 100_000;
const MAX_CODE_LINE_NUMBERS = 5_000;
const MAX_BOOKMARK_LABEL_CHARS = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let mermaidRenderTail = Promise.resolve();
let mermaidQueuedRenders = 0;
let mermaidRenderSequence = 0;
let mermaidRequestGeneration = 0;

const CODE_NODE_LANGUAGES = Object.freeze([
  ["plaintext", "纯文本"],
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["python", "Python"],
  ["java", "Java"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["go", "Go"],
  ["rust", "Rust"],
  ["json", "JSON"],
  ["html", "HTML"],
  ["css", "CSS"],
  ["xml", "XML"],
  ["sql", "SQL"],
  ["bash", "Shell / Bash"],
  ["markdown", "Markdown"],
  ["yaml", "YAML"],
]);

export const PAPER_MATH_EDIT_REQUEST_EVENT = "paper-math-edit-request";
export const PAPER_MERMAID_EDIT_REQUEST_EVENT = "paper-mermaid-edit-request";
export const PAPER_BOOKMARK_ACTIVATE_EVENT = "paper-bookmark-activate";

function plainHighlightTree(value) {
  return {
    type: "root",
    children: [{ type: "text", value: String(value || "") }],
    data: { language: "plaintext", relevance: 0 },
  };
}

lowlight.register("plaintext", () => ({ name: "Plain text", contains: [] }));
const highlightCode = lowlight.highlight.bind(lowlight);
const highlightCodeAuto = lowlight.highlightAuto.bind(lowlight);
lowlight.highlight = (language, value, options) => (
  String(value || "").length > MAX_CODE_HIGHLIGHT_CHARS
    ? plainHighlightTree(value)
    : highlightCode(language, value, options)
);
lowlight.highlightAuto = (value, options) => (
  String(value || "").length > MAX_CODE_HIGHLIGHT_CHARS
    ? plainHighlightTree(value)
    : highlightCodeAuto(value, options)
);

function cleanText(value, maximum, { trim = true } = {}) {
  const clean = typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maximum)
    : "";
  return trim ? clean.trim() : clean;
}

function safeId(value) {
  const source = cleanText(value, 64).toLowerCase();
  return UUID_PATTERN.test(source) ? source : "";
}

function createStableId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeCodeLanguage(value) {
  const language = cleanText(value, 48).toLowerCase();
  return /^[a-z0-9_+.-]+$/.test(language) ? language : "plaintext";
}

function codeLanguageLabel(language) {
  return CODE_NODE_LANGUAGES.find(([id]) => id === language)?.[1] || language;
}

async function writePlainClipboard(text) {
  const bridge = globalThis.window?.paperWriter;
  if (typeof bridge?.writeClipboardContent === "function") {
    const result = await bridge.writeClipboardContent({ text: String(text || "") });
    if (result?.ok === false) throw new Error(result.error || "复制失败");
    return;
  }
  if (typeof globalThis.navigator?.clipboard?.writeText !== "function") {
    throw new Error("当前环境不支持剪贴板");
  }
  await globalThis.navigator.clipboard.writeText(String(text || ""));
}

export function PaperCodeBlockNodeView({
  node,
  selected,
  updateAttributes,
  deleteNode,
  editor,
}) {
  const language = normalizeCodeLanguage(node.attrs.language);
  const wrap = node.attrs.wrap === true || node.attrs.wrap === "true";
  const source = node.textContent || "";
  const lineCount = Math.max(1, source.split("\n").length);
  const visibleLineCount = Math.min(lineCount, MAX_CODE_LINE_NUMBERS);
  const [copyState, setCopyState] = useState("");
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const languageMenuRef = useRef(null);
  const readOnly = !editor?.isEditable;

  useEffect(() => {
    if (!copyState) return undefined;
    const timer = globalThis.setTimeout(() => setCopyState(""), 1_500);
    return () => globalThis.clearTimeout(timer);
  }, [copyState]);

  useEffect(() => {
    if (!languageMenuOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!languageMenuRef.current?.contains(event.target)) setLanguageMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setLanguageMenuOpen(false);
    };
    globalThis.document?.addEventListener("pointerdown", closeOnOutsidePointer, true);
    globalThis.document?.addEventListener("keydown", closeOnEscape, true);
    return () => {
      globalThis.document?.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      globalThis.document?.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [languageMenuOpen]);

  const copySource = async () => {
    try {
      await writePlainClipboard(source);
      setCopyState("已复制");
    } catch {
      setCopyState("复制失败");
    }
  };

  return createElement(
    NodeViewWrapper,
    {
      as: "div",
      className: `paper-code-shell${selected ? " selected" : ""}${wrap ? " is-wrapped" : ""}`,
      "data-type": "paper-code-shell",
      "data-code-language": language,
      "data-code-wrap": String(wrap),
      "data-highlight-limited": String(source.length > MAX_CODE_HIGHLIGHT_CHARS),
    },
    createElement(
      "div",
      { className: "paper-code-toolbar", contentEditable: false },
      createElement(
        "div",
        { className: "paper-code-language", ref: languageMenuRef },
        createElement(
          "button",
          {
            type: "button",
            className: "paper-code-language-trigger",
            "aria-label": "代码语言",
            "aria-haspopup": "listbox",
            "aria-expanded": languageMenuOpen,
            disabled: readOnly,
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => setLanguageMenuOpen((current) => !current),
          },
          createElement("span", null, codeLanguageLabel(language)),
          createElement(ChevronDown, { size: 13, "aria-hidden": true }),
        ),
        languageMenuOpen
          ? createElement(
            "div",
            {
              className: "paper-code-language-menu",
              role: "listbox",
              "aria-label": "选择代码语言",
            },
            !CODE_NODE_LANGUAGES.some(([id]) => id === language)
              ? createElement(
                "button",
                {
                  key: language,
                  type: "button",
                  role: "option",
                  "aria-selected": true,
                  onMouseDown: (event) => event.preventDefault(),
                  onClick: () => setLanguageMenuOpen(false),
                },
                createElement("span", null, language),
                createElement(Check, { size: 13, "aria-hidden": true }),
              )
              : null,
            ...CODE_NODE_LANGUAGES.map(([id, label]) => createElement(
              "button",
              {
                key: id,
                type: "button",
                role: "option",
                "aria-selected": language === id,
                onMouseDown: (event) => event.preventDefault(),
                onClick: () => {
                  updateAttributes({ language: id });
                  setLanguageMenuOpen(false);
                },
              },
              createElement("span", null, label),
              language === id ? createElement(Check, { size: 13, "aria-hidden": true }) : null,
            )),
          )
          : null,
      ),
      source.length > MAX_CODE_HIGHLIGHT_CHARS
        ? createElement("small", { title: "代码过长，已安全降级为纯文本显示" }, "纯文本模式")
        : createElement("small", null, `${lineCount.toLocaleString()} 行`),
      createElement(
        "button",
        {
          type: "button",
          className: "paper-code-tool",
          "aria-pressed": wrap,
          "aria-label": wrap ? "取消自动换行" : "开启自动换行",
          title: wrap ? "取消自动换行" : "自动换行",
          disabled: readOnly,
          onMouseDown: (event) => event.preventDefault(),
          onClick: () => updateAttributes({ wrap: !wrap }),
        },
        createElement(WrapText, { size: 14, "aria-hidden": true }),
      ),
      createElement(
        "button",
        {
          type: "button",
          className: "paper-code-tool",
          "aria-label": copyState || "复制代码",
          title: copyState || "复制代码",
          onMouseDown: (event) => event.preventDefault(),
          onClick: () => void copySource(),
        },
        copyState === "已复制"
          ? createElement(Check, { size: 14, "aria-hidden": true })
          : createElement(ClipboardCopy, { size: 14, "aria-hidden": true }),
      ),
      createElement(
        "button",
        {
          type: "button",
          className: "paper-code-tool is-danger",
          "aria-label": "删除代码块",
          title: "删除代码块",
          disabled: readOnly,
          onMouseDown: (event) => event.preventDefault(),
          onClick: () => deleteNode?.(),
        },
        createElement(Trash2, { size: 14, "aria-hidden": true }),
      ),
    ),
    createElement(
      "div",
      { className: "paper-code-body" },
      createElement(
        "div",
        { className: "paper-code-line-numbers", contentEditable: false, "aria-hidden": "true" },
        ...Array.from(
          { length: visibleLineCount },
          (_, index) => createElement("span", { key: index + 1 }, String(index + 1)),
        ),
        lineCount > visibleLineCount
          ? createElement("span", { key: "remaining", title: `共 ${lineCount} 行` }, "…")
          : null,
      ),
      createElement(
        "pre",
        {
          className: `paper-code-block${wrap ? " is-wrapped" : ""}`,
          "data-type": "paper-code",
          "data-code-language": language,
          "data-code-wrap": String(wrap),
        },
        createElement(NodeViewContent, {
          as: "code",
          className: `language-${language}`,
        }),
      ),
    ),
  );
}

export const PaperCodeBlock = CodeBlockLowlight.extend({
  name: "codeBlock",

  addAttributes() {
    return {
      language: {
        default: "plaintext",
        parseHTML: (element) => normalizeCodeLanguage(
          element.getAttribute("data-code-language")
          || element.querySelector("code")?.className?.match(/(?:^|\s)language-([a-z0-9_+.-]+)/i)?.[1],
        ),
      },
      wrap: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-code-wrap") === "true",
      },
    };
  },

  parseHTML() {
    return [{ tag: "pre[data-type='paper-code']" }, { tag: "pre" }];
  },

  renderHTML({ HTMLAttributes }) {
    const language = normalizeCodeLanguage(HTMLAttributes.language);
    const wrap = HTMLAttributes.wrap === true || HTMLAttributes.wrap === "true";
    return [
      "pre",
      {
        "data-type": "paper-code",
        "data-code-language": language,
        "data-code-wrap": String(wrap),
        class: `paper-code-block${wrap ? " is-wrapped" : ""}`,
      },
      ["code", { class: `language-${language}` }, 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperCodeBlockNodeView);
  },
}).configure({
  lowlight,
  defaultLanguage: "plaintext",
  enableTabIndentation: true,
  tabSize: 2,
});

function renderMathPreview(latex, displayMode) {
  const source = cleanText(latex, MAX_LATEX_CHARS, { trim: false });
  try {
    return {
      html: katex.renderToString(source, {
        displayMode,
        trust: false,
        throwOnError: false,
        strict: "warn",
        maxExpand: 1_000,
        output: "htmlAndMathml",
      }),
      error: "",
    };
  } catch (error) {
    return {
      html: "",
      error: error?.message || "TeX 语法有误",
    };
  }
}

function equationNumberForEditor(editor, equationId) {
  const targetId = safeId(equationId);
  if (!targetId) return null;
  let number = 0;
  let result = null;
  editor?.state?.doc?.descendants?.((current) => {
    if (current.type.name !== "blockMath" || current.attrs.numbering === false) return true;
    number += 1;
    if (!result && safeId(current.attrs.equationId) === targetId) result = number;
    return true;
  });
  return result;
}

function mathNodePosition(getPos) {
  try {
    const position = typeof getPos === "function" ? getPos() : null;
    return Number.isFinite(position) && position >= 0 ? position : null;
  } catch {
    return null;
  }
}

function requestMathEdit({ editor, getPos, node, mode, anchorElement }) {
  const position = mathNodePosition(getPos);
  if (position === null || !editor?.isEditable) return;
  editor.commands?.setNodeSelection?.(position);
  globalThis.window?.dispatchEvent?.(new CustomEvent(PAPER_MATH_EDIT_REQUEST_EVENT, {
    detail: {
      editor,
      editorDom: editor?.view?.dom || null,
      anchorElement: anchorElement || null,
      position,
      initialValue: {
        mode,
        latex: cleanText(node.attrs.latex, MAX_LATEX_CHARS, { trim: false }),
        ...(mode === "block" ? {
          equationId: safeId(node.attrs.equationId),
          label: cleanText(node.attrs.label, 200),
          numbering: node.attrs.numbering !== false,
        } : {}),
      },
    },
  }));
}

async function writeEquationReferenceClipboard({ equationId, number }) {
  const safeEquationId = safeId(equationId);
  if (!safeEquationId || !Number.isFinite(number)) throw new Error("当前公式不能引用");
  const text = `公式（${number}）`;
  const html = `<span data-type="paper-equation-reference" data-equation-id="${safeEquationId}">${text}</span>`;
  const bridge = globalThis.window?.paperWriter;
  if (typeof bridge?.writeClipboardContent === "function") {
    const result = await bridge.writeClipboardContent({ html, text });
    if (result?.ok === false) throw new Error(result.error || "复制失败");
    return;
  }
  if (
    typeof globalThis.navigator?.clipboard?.write === "function"
    && typeof globalThis.ClipboardItem === "function"
    && typeof globalThis.Blob === "function"
  ) {
    await globalThis.navigator.clipboard.write([new globalThis.ClipboardItem({
      "text/html": new globalThis.Blob([html], { type: "text/html" }),
      "text/plain": new globalThis.Blob([text], { type: "text/plain" }),
    })]);
    return;
  }
  await writePlainClipboard(text);
}

function MathToolButton({
  label,
  className = "",
  disabled = false,
  onClick,
  children,
}) {
  return createElement(
    "button",
    {
      type: "button",
      className: `paper-math-tool${className ? ` ${className}` : ""}`,
      "aria-label": label,
      title: label,
      disabled,
      onMouseDown: (event) => event.preventDefault(),
      onClick,
    },
    children,
  );
}

export function PaperInlineMathNodeView({
  node,
  selected,
  editor,
  getPos,
  deleteNode,
}) {
  const latex = cleanText(node.attrs.latex, MAX_LATEX_CHARS, { trim: false });
  const preview = useMemo(() => renderMathPreview(latex, false), [latex]);
  const readOnly = !editor?.isEditable;
  const handleEdit = (event) => requestMathEdit({
    editor,
    getPos,
    node,
    mode: "inline",
    anchorElement: event?.currentTarget,
  });
  return createElement(
    NodeViewWrapper,
    {
      as: "span",
      className: `paper-inline-math-shell${selected ? " selected" : ""}${preview.error ? " has-error" : ""}`,
      "data-type": "inline-math",
      "data-latex": latex,
      contentEditable: false,
      title: readOnly ? latex : "双击编辑公式",
      onDoubleClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleEdit(event);
      },
    },
    createElement(
      "span",
      {
        className: "paper-inline-math-render",
        dangerouslySetInnerHTML: preview.html ? { __html: preview.html } : undefined,
      },
      preview.html ? null : latex || "空公式",
    ),
    readOnly ? null : createElement(
      "span",
      { className: "paper-inline-math-tools", contentEditable: false },
      createElement(
        MathToolButton,
        { label: "编辑公式", onClick: handleEdit },
        createElement(Pencil, { size: 13, "aria-hidden": true }),
      ),
      createElement(
        MathToolButton,
        { label: "删除公式", className: "is-danger", onClick: () => deleteNode?.() },
        createElement(Trash2, { size: 13, "aria-hidden": true }),
      ),
    ),
  );
}

export function PaperBlockMathNodeView({
  node,
  selected,
  editor,
  getPos,
  deleteNode,
}) {
  const latex = cleanText(node.attrs.latex, MAX_LATEX_CHARS, { trim: false });
  const equationId = safeId(node.attrs.equationId);
  const equationLabel = cleanText(node.attrs.label, 200);
  const numberingEnabled = node.attrs.numbering !== false;
  const referenceNumber = equationNumberForEditor(editor, equationId);
  const preview = useMemo(() => renderMathPreview(latex, true), [latex]);
  const [copyState, setCopyState] = useState("");
  const readOnly = !editor?.isEditable;

  useEffect(() => {
    if (!copyState) return undefined;
    const timer = globalThis.setTimeout(() => setCopyState(""), 1_500);
    return () => globalThis.clearTimeout(timer);
  }, [copyState]);

  const handleEdit = (event) => requestMathEdit({
    editor,
    getPos,
    node,
    mode: "block",
    anchorElement: event?.currentTarget,
  });
  const copyReference = async () => {
    try {
      await writeEquationReferenceClipboard({ equationId, number: referenceNumber });
      setCopyState("已复制引用");
    } catch {
      setCopyState("复制失败");
    }
  };

  return createElement(
    NodeViewWrapper,
    {
      as: "div",
      className: `paper-block-math-shell${selected ? " selected" : ""}${preview.error ? " has-error" : ""}`,
      "data-type": "block-math",
      "data-latex": latex,
      "data-equation-id": equationId,
      "data-equation-label": equationLabel,
      "data-equation-numbering": String(numberingEnabled),
      contentEditable: false,
      title: equationLabel || (readOnly ? latex : "双击编辑公式"),
      onDoubleClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleEdit(event);
      },
    },
    equationLabel ? createElement(
      "span",
      { className: "paper-equation-hover-label", contentEditable: false },
      equationLabel,
    ) : null,
    createElement(
      "div",
      {
        className: "paper-block-math-render",
        dangerouslySetInnerHTML: preview.html ? { __html: preview.html } : undefined,
      },
      preview.html ? null : latex || "空公式",
    ),
    numberingEnabled && referenceNumber ? createElement(
      "span",
      {
        className: "paper-equation-number",
        contentEditable: false,
        "aria-label": `公式编号 ${referenceNumber}`,
      },
      `(${referenceNumber})`,
    ) : null,
    preview.error
      ? createElement("small", { className: "paper-math-error" }, preview.error)
      : null,
    readOnly ? null : createElement(
      "div",
      { className: "paper-block-math-tools", contentEditable: false },
      equationId && referenceNumber
        ? createElement(
          MathToolButton,
          { label: copyState || "复制公式引用", onClick: () => void copyReference() },
          copyState === "已复制引用"
            ? createElement(Check, { size: 13, "aria-hidden": true })
            : createElement(ClipboardCopy, { size: 13, "aria-hidden": true }),
        )
        : null,
      createElement(
        MathToolButton,
        { label: "编辑公式", onClick: handleEdit },
        createElement(Pencil, { size: 13, "aria-hidden": true }),
      ),
      createElement(
        MathToolButton,
        { label: "删除公式", className: "is-danger", onClick: () => deleteNode?.() },
        createElement(Trash2, { size: 13, "aria-hidden": true }),
      ),
    ),
  );
}

export const PaperInlineMath = InlineMath.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      latex: {
        default: "",
        parseHTML: (element) => cleanText(element.getAttribute("data-latex"), MAX_LATEX_CHARS, { trim: false }),
        renderHTML: (attributes) => ({ "data-latex": cleanText(attributes.latex, MAX_LATEX_CHARS, { trim: false }) }),
      },
    };
  },

  addInputRules() {
    return [];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, {
      "data-type": "inline-math",
      class: "paper-inline-math",
    })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperInlineMathNodeView);
  },
}).configure({
  katexOptions: {
    trust: false,
    throwOnError: false,
    strict: "warn",
    maxExpand: 1000,
  },
});

export const PaperBlockMath = BlockMath.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      latex: {
        default: "",
        parseHTML: (element) => cleanText(element.getAttribute("data-latex"), MAX_LATEX_CHARS, { trim: false }),
        renderHTML: (attributes) => ({ "data-latex": cleanText(attributes.latex, MAX_LATEX_CHARS, { trim: false }) }),
      },
      equationId: {
        default: "",
        parseHTML: (element) => safeId(element.getAttribute("data-equation-id")),
        renderHTML: (attributes) => ({ "data-equation-id": safeId(attributes.equationId) }),
      },
      label: {
        default: "",
        parseHTML: (element) => cleanText(element.getAttribute("data-equation-label"), 200),
        renderHTML: (attributes) => ({ "data-equation-label": cleanText(attributes.label, 200) }),
      },
      numbering: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-equation-numbering") !== "false",
        renderHTML: (attributes) => ({ "data-equation-numbering": String(attributes.numbering !== false) }),
      },
    };
  },

  addCommands() {
    const inherited = this.parent?.() || {};
    return {
      ...inherited,
      insertPaperBlockMath: (attributes = {}) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: {
          latex: cleanText(attributes.latex, MAX_LATEX_CHARS, { trim: false }),
          equationId: safeId(attributes.equationId) || createStableId(),
          label: cleanText(attributes.label, 200),
          numbering: attributes.numbering !== false,
        },
      }),
    };
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, {
      "data-type": "block-math",
      class: "paper-block-math",
    })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperBlockMathNodeView);
  },
}).configure({
  katexOptions: {
    trust: false,
    throwOnError: false,
    strict: "warn",
    maxExpand: 1000,
    displayMode: true,
  },
});

export function PaperEquationReferenceNodeView({ node, editor }) {
  const equationId = safeId(node.attrs.equationId);
  const referenceNumber = equationNumberForEditor(editor, equationId);
  const missing = !equationId || !referenceNumber;
  const label = missing ? "公式已缺失" : `公式（${referenceNumber}）`;
  return createElement(
    NodeViewWrapper,
    {
      as: "span",
      className: "paper-equation-reference",
      "data-type": "paper-equation-reference",
      "data-equation-id": equationId,
      "data-equation-missing": String(missing),
      contentEditable: false,
      draggable: false,
      title: label,
      "aria-label": label,
    },
    createElement(Sigma, { className: "paper-equation-reference-icon", size: 13, "aria-hidden": true }),
    createElement("span", { className: "paper-equation-reference-label" }, label),
  );
}

export const PaperEquationReference = Node.create({
  name: "paperEquationReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  marks: "",

  addAttributes() {
    return {
      equationId: {
        default: "",
        parseHTML: (element) => safeId(element.getAttribute("data-equation-id")),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-type='paper-equation-reference']" }];
  },

  renderHTML({ HTMLAttributes }) {
    const equationId = safeId(HTMLAttributes.equationId);
    return ["span", {
      "data-type": "paper-equation-reference",
      "data-equation-id": equationId,
      class: "paper-equation-reference",
      contenteditable: "false",
    }, equationId ? "公式" : "公式已缺失"];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperEquationReferenceNodeView);
  },

  addCommands() {
    return {
      insertEquationReference: (equationId) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: { equationId: safeId(equationId) },
      }),
    };
  },
});

function bookmarkPositionFromElement(view, element) {
  try {
    const position = view.posAtDOM(element, 0);
    return Number.isFinite(position) ? position : null;
  } catch {
    return null;
  }
}

function dispatchBookmarkActivation(view, element) {
  const bookmarkId = safeId(element?.getAttribute?.("data-bookmark-id"));
  if (!bookmarkId) return;
  globalThis.window?.dispatchEvent?.(new CustomEvent(PAPER_BOOKMARK_ACTIVATE_EVENT, {
    detail: {
      bookmarkId,
      label: cleanText(element.getAttribute("data-bookmark-label"), MAX_BOOKMARK_LABEL_CHARS),
      position: bookmarkPositionFromElement(view, element),
      editorDom: view.dom,
      anchorElement: element,
    },
  }));
}

export const PaperBookmark = Node.create({
  name: "paperBookmark",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  marks: "",

  addAttributes() {
    return {
      bookmarkId: {
        default: "",
        parseHTML: (element) => safeId(element.getAttribute("data-bookmark-id")),
      },
      label: {
        default: "",
        parseHTML: (element) => cleanText(element.getAttribute("data-bookmark-label"), MAX_BOOKMARK_LABEL_CHARS),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-type='paper-bookmark']" }];
  },

  renderHTML({ HTMLAttributes }) {
    const bookmarkId = safeId(HTMLAttributes.bookmarkId);
    const label = cleanText(HTMLAttributes.label, MAX_BOOKMARK_LABEL_CHARS);
    return ["span", {
      "data-type": "paper-bookmark",
      "data-bookmark-id": bookmarkId,
      "data-bookmark-label": label,
      class: "paper-bookmark",
      contenteditable: "false",
      role: "button",
      tabindex: "0",
      title: label ? `书签：${label}` : "书签",
      "aria-label": label ? `书签：${label}` : "书签",
    }];
  },

  addCommands() {
    return {
      insertPaperBookmark: (attributes = {}) => ({ state, dispatch }) => {
        const { $from } = state.selection;
        let depth = $from.depth;
        while (depth > 0 && !$from.node(depth).isTextblock) depth -= 1;
        const textblock = $from.node(depth);
        if (!textblock?.isTextblock) return false;
        const start = $from.start(depth);
        const label = cleanText(attributes.label, MAX_BOOKMARK_LABEL_CHARS);
        let existing = null;
        textblock.forEach((child, offset) => {
          if (!existing && child.type.name === this.name) existing = { child, offset };
        });
        if (existing) {
          if (
            dispatch
            && (
              existing.offset !== 0
              || !safeId(existing.child.attrs.bookmarkId)
              || (label && label !== existing.child.attrs.label)
            )
          ) {
            const attrs = {
              ...existing.child.attrs,
              bookmarkId: safeId(existing.child.attrs.bookmarkId) || createStableId(),
              ...(label ? { label } : {}),
            };
            let transaction = state.tr;
            if (existing.offset === 0) {
              transaction = transaction.setNodeMarkup(start, undefined, attrs);
            } else {
              const position = start + existing.offset;
              transaction = transaction
                .delete(position, position + existing.child.nodeSize)
                .insert(start, this.type.create(attrs));
            }
            dispatch(transaction);
          }
          return true;
        }
        if (!textblock.canReplaceWith(0, 0, this.type)) return false;
        if (dispatch) {
          dispatch(state.tr.insert(start, this.type.create({
            bookmarkId: safeId(attributes.bookmarkId) || createStableId(),
            label,
          })));
        }
        return true;
      },
      updatePaperBookmark: (bookmarkId, attributes = {}) => ({ state, dispatch }) => {
        const targetId = safeId(bookmarkId);
        if (!targetId) return false;
        let target = null;
        state.doc.descendants((current, position) => {
          if (!target && current.type.name === this.name && safeId(current.attrs.bookmarkId) === targetId) {
            target = { current, position };
          }
          return !target;
        });
        if (!target) return false;
        if (dispatch) {
          dispatch(state.tr.setNodeMarkup(target.position, undefined, {
            ...target.current.attrs,
            label: cleanText(attributes.label, MAX_BOOKMARK_LABEL_CHARS),
          }));
        }
        return true;
      },
      removePaperBookmark: (bookmarkId) => ({ state, dispatch }) => {
        const targetId = safeId(bookmarkId);
        if (!targetId) return false;
        let target = null;
        state.doc.descendants((current, position) => {
          if (!target && current.type.name === this.name && safeId(current.attrs.bookmarkId) === targetId) {
            target = { nodeSize: current.nodeSize, position };
          }
          return !target;
        });
        if (!target) return false;
        if (dispatch) dispatch(state.tr.delete(target.position, target.position + target.nodeSize));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, _oldState, newState) {
        if (
          !transactions.some((transaction) => transaction.docChanged)
          || transactions.some((transaction) => transaction.getMeta("paperBookmarkNormalized"))
        ) {
          return null;
        }
        const repairs = [];
        newState.doc.descendants((current, position) => {
          if (!current.isTextblock) return true;
          const bookmarks = [];
          current.forEach((child, offset) => {
            if (child.type.name === "paperBookmark") bookmarks.push({
              node: child,
              position: position + 1 + offset,
            });
          });
          if (bookmarks.length && (bookmarks.length > 1 || bookmarks[0].position !== position + 1)) {
            repairs.push({
              insertAt: position + 1,
              bookmarks,
            });
          }
          return true;
        });
        if (!repairs.length) return null;
        let transaction = newState.tr;
        repairs.sort((left, right) => right.insertAt - left.insertAt).forEach((repair) => {
          repair.bookmarks
            .slice()
            .sort((left, right) => right.position - left.position)
            .forEach((bookmark) => {
              transaction = transaction.delete(bookmark.position, bookmark.position + bookmark.node.nodeSize);
            });
          transaction = transaction.insert(repair.insertAt, repair.bookmarks[0].node);
        });
        transaction.setMeta("paperBookmarkNormalized", true);
        transaction.setMeta("addToHistory", false);
        return transaction;
      },
      props: {
        handleClick(view, _position, event) {
          const element = event.target?.closest?.("[data-type='paper-bookmark']");
          if (!element) return false;
          dispatchBookmarkActivation(view, element);
          return true;
        },
        handleKeyDown(view, event) {
          if (event.key !== "Enter" && event.key !== " ") return false;
          const element = event.target?.closest?.("[data-type='paper-bookmark']");
          if (!element) return false;
          event.preventDefault();
          dispatchBookmarkActivation(view, element);
          return true;
        },
      },
    })];
  },
});

const equationNumberingPluginKey = new PluginKey("paperEquationNumbering");

function equationDecorations(documentNode) {
  const numberById = new Map();
  let number = 0;
  documentNode.descendants((node) => {
    if (node.type.name !== "blockMath" || node.attrs.numbering === false) return;
    const equationId = safeId(node.attrs.equationId);
    if (equationId && !numberById.has(equationId)) numberById.set(equationId, ++number);
  });
  const decorations = [];
  documentNode.descendants((node, position) => {
    if (node.type.name === "blockMath") {
      const equationNumber = numberById.get(safeId(node.attrs.equationId));
      if (equationNumber) {
        decorations.push(Decoration.node(position, position + node.nodeSize, {
          "data-equation-number": String(equationNumber),
        }));
      }
    }
    if (node.type.name === "paperEquationReference") {
      const equationNumber = numberById.get(safeId(node.attrs.equationId));
      decorations.push(Decoration.node(position, position + node.nodeSize, {
        "data-equation-reference-label": equationNumber ? `公式（${equationNumber}）` : "公式已缺失",
        "data-equation-missing": equationNumber ? "false" : "true",
      }));
    }
  });
  return DecorationSet.create(documentNode, decorations);
}

export const PaperEquationNumbering = Extension.create({
  name: "paperEquationNumbering",

  addProseMirrorPlugins() {
    return [new Plugin({
      key: equationNumberingPluginKey,
      state: {
        init: (_, state) => equationDecorations(state.doc),
        apply: (transaction, previous) => (
          transaction.docChanged ? equationDecorations(transaction.doc) : previous.map(transaction.mapping, transaction.doc)
        ),
      },
      props: {
        decorations: (state) => equationNumberingPluginKey.getState(state),
      },
    })];
  },
});

function enqueueMermaidRender(task) {
  if (mermaidQueuedRenders >= MAX_MERMAID_RENDER_QUEUE) {
    return Promise.reject(new Error("流程图渲染队列已满，请稍后重试"));
  }
  mermaidQueuedRenders += 1;
  const run = mermaidRenderTail.catch(() => {}).then(task);
  mermaidRenderTail = run
    .finally(() => {
      mermaidQueuedRenders = Math.max(0, mermaidQueuedRenders - 1);
    })
    .catch(() => {});
  return run;
}

export async function renderMermaidSafely(source, diagramId = "preview") {
  const safeSource = assertMermaidSourceWithinLimits(source);
  const generation = ++mermaidRequestGeneration;
  // Worker 只负责可终止的 parse/preflight；Mermaid 的 DOM/SVG 布局必须在
  // Chromium 主线程完成，随后再经过严格 DOMPurify 白名单净化。
  await preflightMermaidSource(safeSource, { generation });
  const stableSeed = cleanText(String(diagramId || "preview"), 96).replace(/[^a-zA-Z0-9_-]/g, "-") || "preview";
  return enqueueMermaidRender(async () => {
    const module = await import("mermaid");
    const mermaid = module.default || module;
    mermaidRenderSequence += 1;
    const renderIdentity = `${stableSeed}-${mermaidRenderSequence}`;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      deterministicIds: true,
      deterministicIDSeed: renderIdentity,
      flowchart: { htmlLabels: false, useMaxWidth: true },
    });
    const task = mermaid.render(
      `paper-mermaid-${renderIdentity.replace(/-/g, "")}`,
      safeSource,
    );
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = globalThis.setTimeout(
        () => reject(new Error("流程图渲染超时")),
        MERMAID_RENDER_TIMEOUT_MS,
      );
    });
    try {
      const result = await Promise.race([task, timeout]);
      return DOMPurify.sanitize(result.svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ["foreignObject", "script", "iframe", "object", "embed", "a"],
        FORBID_ATTR: ["onclick", "onload", "onerror", "href", "xlink:href"],
      });
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  });
}

function mermaidFigureNumberForEditor(editor, diagramId) {
  const targetId = safeId(diagramId);
  if (!targetId) return null;
  let number = 0;
  let result = null;
  editor?.state?.doc?.descendants?.((current) => {
    if (current.type.name !== "image" && current.type.name !== "paperMermaid") return true;
    number += 1;
    if (
      !result
      && current.type.name === "paperMermaid"
      && safeId(current.attrs.diagramId) === targetId
    ) result = number;
    return true;
  });
  return result;
}

function requestMermaidEdit({ editor, getPos, node, anchorElement }) {
  const position = mathNodePosition(getPos);
  if (position === null || !editor?.isEditable) return;
  editor.commands?.setNodeSelection?.(position);
  globalThis.window?.dispatchEvent?.(new CustomEvent(PAPER_MERMAID_EDIT_REQUEST_EVENT, {
    detail: {
      editor,
      editorDom: editor?.view?.dom || null,
      anchorElement: anchorElement || null,
      position,
      initialValue: {
        diagramId: safeId(node.attrs.diagramId),
        source: cleanText(node.attrs.source, MAX_MERMAID_SOURCE_CHARS, { trim: false }),
        caption: cleanText(node.attrs.caption, 500),
        width: normalizeEmbedWidth(node.attrs.width),
      },
    },
  }));
}

async function writeMermaidReferenceClipboard({ diagramId, number }) {
  const safeDiagramId = safeId(diagramId);
  if (!safeDiagramId || !Number.isFinite(number)) throw new Error("当前 Mermaid 图不能引用");
  const text = `图${number}`;
  const html = `<span data-type="paper-mermaid-reference" data-diagram-id="${safeDiagramId}">${text}</span>`;
  const bridge = globalThis.window?.paperWriter;
  if (typeof bridge?.writeClipboardContent === "function") {
    const result = await bridge.writeClipboardContent({ html, text });
    if (result?.ok === false) throw new Error(result.error || "复制失败");
    return;
  }
  if (
    typeof globalThis.navigator?.clipboard?.write === "function"
    && typeof globalThis.ClipboardItem === "function"
    && typeof globalThis.Blob === "function"
  ) {
    await globalThis.navigator.clipboard.write([new globalThis.ClipboardItem({
      "text/html": new globalThis.Blob([html], { type: "text/html" }),
      "text/plain": new globalThis.Blob([text], { type: "text/plain" }),
    })]);
    return;
  }
  await writePlainClipboard(text);
}

function MermaidToolButton({ label, active = false, className = "", onClick, children }) {
  return createElement(
    "button",
    {
      type: "button",
      className: `paper-mermaid-tool${active ? " active" : ""}${className ? ` ${className}` : ""}`,
      title: label,
      "aria-label": label,
      onMouseDown: (event) => event.preventDefault(),
      onClick,
    },
    children,
  );
}

export function PaperMermaidNodeView({
  node,
  selected,
  editor,
  getPos,
  updateAttributes,
  deleteNode,
}) {
  const source = cleanText(node.attrs.source, MAX_MERMAID_SOURCE_CHARS, { trim: false });
  const diagramId = safeId(node.attrs.diagramId) || "invalid";
  const caption = cleanText(node.attrs.caption, 500);
  const width = normalizeEmbedWidth(node.attrs.width);
  const referenceNumber = mermaidFigureNumberForEditor(editor, diagramId);
  const [state, setState] = useState({ svg: "", error: "", loading: true });
  const [copyState, setCopyState] = useState("");
  const sourceSummary = useMemo(() => source.split(/\r?\n/).slice(0, 3).join("\n"), [source]);
  const readOnly = !editor?.isEditable;

  useEffect(() => {
    let active = true;
    setState({ svg: "", error: "", loading: true });
    renderMermaidSafely(source, diagramId)
      .then((svg) => { if (active) setState({ svg, error: "", loading: false }); })
      .catch((error) => { if (active) setState({ svg: "", error: error?.message || "Mermaid 图渲染失败", loading: false }); });
    return () => { active = false; };
  }, [diagramId, source]);

  useEffect(() => {
    if (!copyState) return undefined;
    const timer = globalThis.setTimeout(() => setCopyState(""), 1_500);
    return () => globalThis.clearTimeout(timer);
  }, [copyState]);

  const handleEdit = (event) => requestMermaidEdit({
    editor,
    getPos,
    node,
    anchorElement: event?.currentTarget,
  });
  const copyReference = async () => {
    try {
      await writeMermaidReferenceClipboard({ diagramId, number: referenceNumber });
      setCopyState("已复制引用");
    } catch {
      setCopyState("复制失败");
    }
  };

  return createElement(
    NodeViewWrapper,
    {
      as: "figure",
      className: `paper-mermaid${selected ? " selected" : ""}`,
      "data-type": "paper-mermaid",
      "data-diagram-id": diagramId,
      "data-width": width,
      style: { "--mermaid-width": width },
      "data-mermaid-render-state": state.loading
        ? "loading"
        : (state.error ? "error" : "ready"),
      contentEditable: false,
      onDoubleClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleEdit(event);
      },
    },
    createElement(
      "div",
      { className: "paper-mermaid-frame", contentEditable: false },
      createElement(
        "div",
        { className: "paper-mermaid-preview" },
        state.loading ? createElement("span", { className: "paper-mermaid-status" }, "正在渲染 Mermaid 图…") : null,
        state.svg ? createElement(MermaidSvg, { className: "paper-mermaid-svg", svg: state.svg }) : null,
        state.error ? createElement(
          "div",
          { className: "paper-mermaid-error" },
          createElement("strong", null, state.error),
          createElement("pre", null, sourceSummary),
        ) : null,
      ),
      readOnly ? null : createElement(
        "div",
        { className: "paper-mermaid-tools", contentEditable: false, "aria-label": "Mermaid 图工具" },
        [
          ["45%", "小"],
          ["62%", "中"],
          ["78%", "大"],
          ["100%", "满"],
        ].map(([optionWidth, label]) => createElement(
          MermaidToolButton,
          {
            key: optionWidth,
            label: `Mermaid 图宽度 ${optionWidth}`,
            active: width === optionWidth,
            onClick: () => updateAttributes?.({ width: optionWidth }),
          },
          label,
        )),
        createElement("span", { className: "paper-mermaid-tool-separator", "aria-hidden": true }),
        diagramId !== "invalid" && referenceNumber
          ? createElement(
            MermaidToolButton,
            { label: copyState || "复制 Mermaid 图引用", onClick: () => void copyReference() },
            copyState === "已复制引用"
              ? createElement(Check, { size: 14, "aria-hidden": true })
              : createElement(ClipboardCopy, { size: 14, "aria-hidden": true }),
          )
          : null,
        createElement(
          MermaidToolButton,
          { label: "编辑 Mermaid 图", onClick: handleEdit },
          createElement(Pencil, { size: 14, "aria-hidden": true }),
        ),
        createElement(
          MermaidToolButton,
          { label: "删除 Mermaid 图", className: "is-danger", onClick: () => deleteNode?.() },
          createElement(Trash2, { size: 14, "aria-hidden": true }),
        ),
      ),
    ),
    createElement(
      "figcaption",
      { className: "paper-mermaid-caption", contentEditable: false },
      caption || createElement("span", { className: "paper-mermaid-caption-placeholder" }, "添加图注"),
    ),
  );
}

function activateMermaidReference(editor, diagramId) {
  const targetId = safeId(diagramId);
  if (!targetId || !editor?.state?.doc) return;
  let targetPosition = null;
  editor.state.doc.descendants((current, position) => {
    if (
      targetPosition === null
      && current.type.name === "paperMermaid"
      && safeId(current.attrs.diagramId) === targetId
    ) targetPosition = position;
    return targetPosition === null;
  });
  if (!Number.isFinite(targetPosition)) return;
  const transaction = editor.state.tr
    .setSelection(NodeSelection.create(editor.state.doc, targetPosition))
    .scrollIntoView();
  editor.view.dispatch(transaction);
  editor.view.focus();
  globalThis.window?.requestAnimationFrame?.(() => {
    const element = editor.view.dom.querySelector(
      `[data-type="paper-mermaid"][data-diagram-id="${targetId}"]`,
    );
    element?.classList?.add("mermaid-reference-target");
    globalThis.window?.setTimeout?.(() => element?.classList?.remove("mermaid-reference-target"), 1_200);
  });
}

export function PaperMermaidReferenceNodeView({ node, editor }) {
  const diagramId = safeId(node.attrs.diagramId);
  const number = mermaidFigureNumberForEditor(editor, diagramId);
  const missing = !diagramId || !number;
  const label = missing ? "流程图已缺失" : `图${number}`;
  return createElement(
    NodeViewWrapper,
    {
      as: "span",
      className: "paper-mermaid-reference",
      "data-type": "paper-mermaid-reference",
      "data-diagram-id": diagramId,
      "data-mermaid-missing": String(missing),
      contentEditable: false,
      draggable: false,
      role: "link",
      tabIndex: missing ? -1 : 0,
      title: label,
      "aria-label": label,
      onClick: () => activateMermaidReference(editor, diagramId),
      onKeyDown: (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activateMermaidReference(editor, diagramId);
      },
    },
    createElement(GitBranch, { className: "paper-mermaid-reference-icon", size: 13, "aria-hidden": true }),
    createElement("span", { className: "paper-mermaid-reference-label" }, label),
  );
}

export const PaperMermaidReference = Node.create({
  name: "paperMermaidReference",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  marks: "",

  addAttributes() {
    return {
      diagramId: {
        default: "",
        parseHTML: (element) => safeId(element.getAttribute("data-diagram-id")),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-type='paper-mermaid-reference']" }];
  },

  renderHTML({ HTMLAttributes }) {
    const diagramId = safeId(HTMLAttributes.diagramId);
    return ["span", {
      "data-type": "paper-mermaid-reference",
      "data-diagram-id": diagramId,
      class: "paper-mermaid-reference",
      contenteditable: "false",
    }, diagramId ? "图" : "流程图已缺失"];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperMermaidReferenceNodeView);
  },
});

export const PaperMermaid = Node.create({
  name: "paperMermaid",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      diagramId: { default: "" },
      source: { default: "" },
      caption: { default: "" },
      width: { default: "78%" },
    };
  },

  parseHTML() {
    return [{
      tag: "figure[data-type='paper-mermaid']",
      getAttrs: (element) => ({
        diagramId: safeId(element.getAttribute("data-diagram-id")),
        source: cleanText(element.getAttribute("data-mermaid-source"), MAX_MERMAID_SOURCE_CHARS, { trim: false }),
        caption: cleanText(element.getAttribute("data-caption") || element.querySelector("figcaption")?.textContent, 500),
        width: normalizeEmbedWidth(element.getAttribute("data-width")),
      }),
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const diagramId = safeId(HTMLAttributes.diagramId);
    const source = cleanText(HTMLAttributes.source, MAX_MERMAID_SOURCE_CHARS, { trim: false });
    const caption = cleanText(HTMLAttributes.caption, 500);
    const width = normalizeEmbedWidth(HTMLAttributes.width);
    return [
      "figure",
      {
        "data-type": "paper-mermaid",
        "data-diagram-id": diagramId,
        "data-mermaid-source": source,
        "data-caption": caption,
        "data-width": width,
        style: `--mermaid-width: ${width}`,
        class: "paper-mermaid",
      },
      ["pre", { class: "paper-mermaid-source" }, source],
      ...(caption ? [["figcaption", {}, caption]] : []),
    ];
  },

  addCommands() {
    return {
      insertPaperMermaid: (attributes = {}) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: {
          diagramId: safeId(attributes.diagramId) || createStableId(),
          source: cleanText(attributes.source, MAX_MERMAID_SOURCE_CHARS, { trim: false }),
          caption: cleanText(attributes.caption, 500),
          width: normalizeEmbedWidth(attributes.width),
        },
      }),
      updatePaperMermaid: (attributes = {}) => ({ commands }) => commands.updateAttributes(this.name, {
        source: cleanText(attributes.source, MAX_MERMAID_SOURCE_CHARS, { trim: false }),
        caption: cleanText(attributes.caption, 500),
        width: normalizeEmbedWidth(attributes.width),
      }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperMermaidNodeView);
  },
});

export function createProfessionalContentExtensions() {
  return [
    PaperCodeBlock,
    PaperInlineMath,
    PaperBlockMath,
    PaperEquationReference,
    PaperBookmark,
    PaperEquationNumbering,
    PaperMermaid,
    PaperMermaidReference,
  ];
}

export const PROFESSIONAL_CONTENT_LIMITS = Object.freeze({
  maxCodeHighlightChars: MAX_CODE_HIGHLIGHT_CHARS,
  maxCodeLineNumbers: MAX_CODE_LINE_NUMBERS,
  maxBookmarkLabelChars: MAX_BOOKMARK_LABEL_CHARS,
  maxLatexChars: MAX_LATEX_CHARS,
  maxMermaidChars: MAX_MERMAID_SOURCE_CHARS,
  maxMermaidEdges: MAX_MERMAID_EDGES,
  maxMermaidLines: MAX_MERMAID_LINES,
  maxMermaidQueue: MAX_MERMAID_RENDER_QUEUE,
});
