import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mergeAttributes, Node } from "@tiptap/core";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import Color from "@tiptap/extension-color";
import UnderlineExtension from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileImage,
  FileText,
  FolderOpen,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  ListTree,
  PanelLeftClose,
  PanelRightClose,
  Palette,
  Plus,
  Quote,
  Redo2,
  RefreshCw,
  Save,
  SaveAll,
  SeparatorHorizontal,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { bridge } from "./bridge.js";

const COLOR_OPTIONS = [
  { label: "默认墨色", value: "" },
  { label: "松烟黑", value: "#2f3435" },
  { label: "砚灰", value: "#5f6465" },
  { label: "朱砂红", value: "#b94a3a" },
  { label: "落日金", value: "#c47a32" },
  { label: "琥珀棕", value: "#9a6a3a" },
  { label: "藤紫", value: "#7a5c8f" },
  { label: "海棠粉", value: "#b66a7a" },
  { label: "远山蓝", value: "#4f6f8f" },
  { label: "湖青", value: "#4e8580" },
  { label: "竹青", value: "#5f7f53" },
  { label: "苔绿", value: "#6f7a45" },
  { label: "雾蓝灰", value: "#71828c" },
  { label: "淡茶", value: "#8c7a5f" },
];
const COLOR_OPTION_VALUES = new Set(COLOR_OPTIONS.map((color) => color.value.toLowerCase()));
const BACKGROUND_COLOR_OPTIONS = [
  { label: "无背景", value: "" },
  { label: "杏黄水彩", value: "#f6e2a9" },
  { label: "山茶粉", value: "#f2c8c3" },
  { label: "薄荷青", value: "#c8e3d3" },
  { label: "天青蓝", value: "#c9dff0" },
  { label: "淡藤紫", value: "#d9cee9" },
  { label: "米杏", value: "#ead8bd" },
  { label: "烟灰", value: "#d8d7d2" },
];
const BACKGROUND_COLOR_OPTION_VALUES = new Set(BACKGROUND_COLOR_OPTIONS.map((color) => color.value.toLowerCase()));
const IMAGE_WIDTH_OPTIONS = [
  { label: "小", value: "45%" },
  { label: "中", value: "62%" },
  { label: "大", value: "78%" },
  { label: "满", value: "100%" },
];
const USER_TEMPLATE_STORAGE_KEY = "paperwriter.userLetterTemplates";
const SESSION_STORAGE_KEY = "paperwriter.sessionState";
const TEMPLATE_FONT_OPTIONS = [
  "LXGW WenKai Screen",
  "LXGW WenKai",
  "KaiTi",
  "FangSong",
  "Noto Serif SC",
  "STSong",
  "SimSun",
  "Noto Sans SC",
  "Microsoft YaHei UI",
  "DengXian",
];
const TYPOGRAPHY_FIELDS = [
  { key: "title", label: "标题", fontKey: "titleFont", sizeKey: "titleSize" },
  { key: "subtitle", label: "副标题/日期", fontKey: "subtitleFont", sizeKey: "subtitleSize" },
  { key: "body", label: "正文", fontKey: "bodyFont", sizeKey: "bodySize" },
  { key: "heading", label: "章节标题", fontKey: "headingFont", sizeKey: "headingSize" },
  { key: "quote", label: "引用", fontKey: "quoteFont", sizeKey: "quoteSize" },
  { key: "toc", label: "目录", fontKey: "tocFont", sizeKey: "tocSize" },
  { key: "imageCaption", label: "图片标题", fontKey: "imageCaptionFont", sizeKey: "imageCaptionSize" },
];

function normalizeColorValue(value) {
  return normalizePaletteValue(value, COLOR_OPTION_VALUES);
}

function normalizeBackgroundColorValue(value) {
  return normalizePaletteValue(value, BACKGROUND_COLOR_OPTION_VALUES);
}

function normalizePaletteValue(value, allowedValues) {
  if (!value) {
    return "";
  }
  const compact = value.replace(/\s+/g, "").toLowerCase();
  if (allowedValues.has(compact)) {
    return compact;
  }
  const rgbMatch = compact.match(/^rgb\((\d+),(\d+),(\d+)\)$/);
  if (!rgbMatch) {
    return "";
  }
  const hex = rgbMatch
    .slice(1)
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("");
  const normalized = `#${hex}`;
  return allowedValues.has(normalized) ? normalized : "";
}
const LAYOUT_MODES = {
  FLOW: "flow",
  PAGED: "paged",
};
const PAGED_CONTENT_UNITS = 720;

const PAPER_ASSETS = {
  "minimal-red-margin": new URL("./assets/papers/minimal-red-margin-paper.png", import.meta.url).href,
  "bamboo-vertical": new URL("./assets/papers/bamboo-vertical-ruled-paper.png", import.meta.url).href,
  "parchment-mountain": new URL("./assets/papers/parchment-mountain-border-paper.png", import.meta.url).href,
  "feather-lined": new URL("./assets/papers/feather-lined-note-paper.png", import.meta.url).href,
  "misty-frame": new URL("./assets/papers/misty-ornamental-frame-paper.png", import.meta.url).href,
  "soft-blue": new URL("./assets/papers/soft-blue-watercolor-paper.png", import.meta.url).href,
  "fiber": new URL("./assets/papers/handmade-fiber-paper.png", import.meta.url).href,
  "bamboo-shadow": new URL("./assets/papers/bamboo-window-shadow-paper.png", import.meta.url).href,
  "chinese-corner": new URL("./assets/papers/chinese-corner-border-paper.png", import.meta.url).href,
};

const PAPER_SLICES = {
  "minimal-red-margin": {
    top: new URL("./assets/papers/slices/minimal-red-margin-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/minimal-red-margin-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/minimal-red-margin-bottom.png", import.meta.url).href,
  },
  "bamboo-vertical": {
    top: new URL("./assets/papers/slices/bamboo-vertical-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/bamboo-vertical-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/bamboo-vertical-bottom.png", import.meta.url).href,
  },
  "parchment-mountain": {
    top: new URL("./assets/papers/slices/parchment-mountain-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/parchment-mountain-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/parchment-mountain-bottom.png", import.meta.url).href,
  },
  "feather-lined": {
    top: new URL("./assets/papers/slices/feather-lined-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/feather-lined-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/feather-lined-bottom.png", import.meta.url).href,
  },
  "misty-frame": {
    top: new URL("./assets/papers/slices/misty-frame-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/misty-frame-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/misty-frame-bottom.png", import.meta.url).href,
  },
  "soft-blue": {
    top: new URL("./assets/papers/slices/soft-blue-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/soft-blue-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/soft-blue-bottom.png", import.meta.url).href,
  },
  "fiber": {
    top: new URL("./assets/papers/slices/fiber-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/fiber-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/fiber-bottom.png", import.meta.url).href,
  },
  "bamboo-shadow": {
    top: new URL("./assets/papers/slices/bamboo-shadow-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/bamboo-shadow-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/bamboo-shadow-bottom.png", import.meta.url).href,
  },
  "chinese-corner": {
    top: new URL("./assets/papers/slices/chinese-corner-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/chinese-corner-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/chinese-corner-bottom.png", import.meta.url).href,
  },
};

const TEMPLATES = [
  { id: "minimal-red-margin", label: "极简红线", swatch: "#faf7ef", background: PAPER_ASSETS["minimal-red-margin"], slices: PAPER_SLICES["minimal-red-margin"] },
  { id: "bamboo-vertical", label: "竹影竖线", swatch: "#fbf7ef", background: PAPER_ASSETS["bamboo-vertical"], slices: PAPER_SLICES["bamboo-vertical"] },
  { id: "parchment-mountain", label: "山影边框", swatch: "#f2dfbf", background: PAPER_ASSETS["parchment-mountain"], slices: PAPER_SLICES["parchment-mountain"] },
  { id: "feather-lined", label: "羽毛横线", swatch: "#f5f2ec", background: PAPER_ASSETS["feather-lined"], slices: PAPER_SLICES["feather-lined"] },
  { id: "misty-frame", label: "雾青雅框", swatch: "#f6f1e8", background: PAPER_ASSETS["misty-frame"], slices: PAPER_SLICES["misty-frame"] },
  { id: "soft-blue", label: "浅蓝水彩", swatch: "#e8f4fb", background: PAPER_ASSETS["soft-blue"], slices: PAPER_SLICES["soft-blue"] },
  { id: "fiber", label: "纤维素纸", swatch: "#f3ead7", background: PAPER_ASSETS["fiber"], slices: PAPER_SLICES["fiber"] },
  { id: "bamboo-shadow", label: "竹窗光影", swatch: "#eadcc4", background: PAPER_ASSETS["bamboo-shadow"], slices: PAPER_SLICES["bamboo-shadow"] },
  { id: "chinese-corner", label: "中式角纹", swatch: "#eeeeea", background: PAPER_ASSETS["chinese-corner"], slices: PAPER_SLICES["chinese-corner"] },
];

const TYPOGRAPHY_PRESETS = {
  classic: {
    titleFont: "Noto Serif SC",
    titleSize: 34,
    titleWeight: 700,
    subtitleFont: "LXGW WenKai Screen",
    subtitleSize: 16,
    bodyFont: "LXGW WenKai Screen",
    bodySize: 18,
    headingFont: "Noto Serif SC",
    headingSize: 28,
    headingWeight: 700,
    quoteFont: "LXGW WenKai Screen",
    quoteSize: 17,
    tocFont: "LXGW WenKai Screen",
    tocSize: 16,
    imageCaptionFont: "LXGW WenKai Screen",
    imageCaptionSize: 13,
  },
  airy: {
    titleFont: "Noto Serif SC",
    titleSize: 36,
    titleWeight: 700,
    subtitleFont: "LXGW WenKai Screen",
    subtitleSize: 16,
    bodyFont: "LXGW WenKai Screen",
    bodySize: 19,
    headingFont: "Noto Serif SC",
    headingSize: 29,
    headingWeight: 700,
    quoteFont: "LXGW WenKai Screen",
    quoteSize: 18,
    tocFont: "LXGW WenKai Screen",
    tocSize: 16,
    imageCaptionFont: "LXGW WenKai Screen",
    imageCaptionSize: 13,
  },
  compact: {
    titleFont: "Noto Serif SC",
    titleSize: 32,
    titleWeight: 700,
    subtitleFont: "LXGW WenKai Screen",
    subtitleSize: 15,
    bodyFont: "LXGW WenKai Screen",
    bodySize: 17,
    headingFont: "Noto Serif SC",
    headingSize: 26,
    headingWeight: 700,
    quoteFont: "LXGW WenKai Screen",
    quoteSize: 16,
    tocFont: "LXGW WenKai Screen",
    tocSize: 15,
    imageCaptionFont: "LXGW WenKai Screen",
    imageCaptionSize: 12,
  },
};

const DEFAULT_LETTER_TEMPLATES = [
  { id: "warm-letter", label: "暖白长信", paperId: "minimal-red-margin", description: "红线信纸 / 宋体标题 / 文楷正文", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "bamboo-note", label: "竹影札记", paperId: "bamboo-vertical", description: "竖线竹影 / 文楷舒展排版", typography: TYPOGRAPHY_PRESETS.airy },
  { id: "mountain-border", label: "山影边笺", paperId: "parchment-mountain", description: "浅山边框 / 稍紧长文排版", typography: TYPOGRAPHY_PRESETS.compact },
  { id: "feather-essay", label: "羽毛随笔", paperId: "feather-lined", description: "羽毛横线 / 标题更醒目", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "blue-water", label: "浅蓝水彩", paperId: "soft-blue", description: "淡蓝纸纹 / 阅读字号偏大", typography: TYPOGRAPHY_PRESETS.airy },
  { id: "window-shadow", label: "竹窗光影", paperId: "bamboo-shadow", description: "窗影纹理 / 紧凑札记风格", typography: TYPOGRAPHY_PRESETS.compact },
  { id: "fiber-letter", label: "素纤维纸", paperId: "fiber", description: "朴素纸感 / 标准正文比例", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "corner-classic", label: "中式角纹", paperId: "chinese-corner", description: "中式边角 / 清雅阅读版式", typography: TYPOGRAPHY_PRESETS.classic },
];

const LEGACY_TEMPLATE_MAP = {
  warm: "minimal-red-margin",
  plain: "fiber",
  linen: "parchment-mountain",
  grid: "bamboo-vertical",
  night: "chinese-corner",
  quote: "feather-lined",
};

function normalizeTemplateId(templateId, customBackground) {
  if (customBackground && templateId === "custom") {
    return "custom";
  }
  const migrated = LEGACY_TEMPLATE_MAP[templateId] || templateId;
  return TEMPLATES.some((template) => template.id === migrated) ? migrated : "minimal-red-margin";
}

function normalizeLetterTemplateId(letterTemplateId, templateId, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  if (letterTemplates.some((template) => template.id === letterTemplateId)) {
    return letterTemplateId;
  }
  const normalizedPaperId = normalizeTemplateId(templateId, "");
  return letterTemplates.find((template) => template.paperId === normalizedPaperId)?.id || "warm-letter";
}

function getLetterTemplate(document, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  const letterTemplateId = normalizeLetterTemplateId(document?.letterTemplateId, document?.templateId, letterTemplates);
  return letterTemplates.find((template) => template.id === letterTemplateId) || letterTemplates[0] || DEFAULT_LETTER_TEMPLATES[0];
}

function fontStack(font, fallback = "serif") {
  return `"${font}", "LXGW WenKai Screen", "LXGW WenKai", "KaiTi", "Noto Serif SC", "STSong", "SimSun", ${fallback}`;
}

function createTemplateId() {
  return `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cloneTypography(typography) {
  return { ...TYPOGRAPHY_PRESETS.classic, ...typography };
}

function normalizeUserTemplate(template) {
  const paperId = TEMPLATES.some((paper) => paper.id === template?.paperId) ? template.paperId : "minimal-red-margin";
  return {
    id: typeof template?.id === "string" && template.id.startsWith("user-") ? template.id : createTemplateId(),
    label: template?.label?.trim() || "我的信件模板",
    paperId,
    description: template?.description?.trim() || "用户模板 / 可编辑",
    typography: cloneTypography(template?.typography),
    userTemplate: true,
  };
}

function createUserTemplate(baseTemplate = DEFAULT_LETTER_TEMPLATES[0]) {
  return normalizeUserTemplate({
    id: createTemplateId(),
    label: `${baseTemplate.label || "信件模板"} 副本`,
    paperId: baseTemplate.paperId,
    description: "用户模板 / 可编辑",
    typography: cloneTypography(baseTemplate.typography),
  });
}

function loadUserLetterTemplates() {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(USER_TEMPLATE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeUserTemplate) : [];
  } catch {
    return [];
  }
}

function saveUserLetterTemplates(templates) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(USER_TEMPLATE_STORAGE_KEY, JSON.stringify(templates.map(normalizeUserTemplate)));
}

function loadSessionState() {
  if (typeof window === "undefined") {
    return { folderPath: "", activePath: "" };
  }
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      folderPath: typeof parsed.folderPath === "string" ? parsed.folderPath : "",
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : "",
    };
  } catch {
    return { folderPath: "", activePath: "" };
  }
}

function saveSessionState(state) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    folderPath: typeof state.folderPath === "string" ? state.folderPath : "",
    activePath: typeof state.activePath === "string" ? state.activePath : "",
    updatedAt: new Date().toISOString(),
  }));
}

function createBlankDocument() {
  const letterTemplate = DEFAULT_LETTER_TEMPLATES[0];
  return {
    version: 1,
    title: "未命名信笺",
    author: "",
    html: "<p></p>",
    letterTemplateId: letterTemplate.id,
    templateId: letterTemplate.paperId,
    layoutMode: LAYOUT_MODES.FLOW,
    customBackground: "",
    updatedAt: new Date().toISOString(),
  };
}

function normalizeDocument(document, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  const customBackground = document?.customBackground || "";
  const letterTemplateId = normalizeLetterTemplateId(document?.letterTemplateId, document?.templateId, letterTemplates);
  const letterTemplate = letterTemplates.find((template) => template.id === letterTemplateId) || DEFAULT_LETTER_TEMPLATES[0];
  const templateId = customBackground && document?.templateId === "custom" ? "custom" : letterTemplate.paperId;
  return {
    ...createBlankDocument(),
    ...document,
    title: document?.title?.trim() || "未命名信笺",
    author: typeof document?.author === "string" ? document.author.trim().slice(0, 40) : "",
    html: document?.html || "<p></p>",
    letterTemplateId,
    templateId,
    fontFamily: letterTemplate.typography.bodyFont,
    fontSize: letterTemplate.typography.bodySize,
    layoutMode: LAYOUT_MODES.FLOW,
  };
}

function inferTitle(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 24) : "未命名信笺";
}

function wordStats(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWords = (text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  const paragraphs = text.split(/\n+/).filter((part) => part.trim()).length;
  return {
    words: chineseChars + latinWords,
    paragraphs,
  };
}

function blockWeight(element) {
  const textLength = element.textContent?.trim().length || 0;
  const imageWeight = element.querySelectorAll("img").length * 320;
  const quoteWeight = element.matches("blockquote") ? 100 : 0;
  const headingWeight = /^H[1-6]$/.test(element.tagName) ? 80 : 0;
  return Math.max(80, textLength + imageWeight + quoteWeight + headingWeight);
}

function paginateHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "<p></p>";
  const blocks = Array.from(template.content.children);
  const pages = [];
  let current = [];
  let currentWeight = 0;

  for (const block of blocks.length ? blocks : [document.createElement("p")]) {
    const weight = blockWeight(block);
    if (current.length && currentWeight + weight > PAGED_CONTENT_UNITS) {
      pages.push(current.map((item) => item.outerHTML).join(""));
      current = [];
      currentWeight = 0;
    }
    current.push(block);
    currentWeight += weight;
  }

  if (current.length) {
    pages.push(current.map((item) => item.outerHTML).join(""));
  }

  return pages.length ? pages : ["<p></p>"];
}

function formatPaperDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "今天";
  }
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function formatClock(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function StatusToast({ status }) {
  if (!status) {
    return null;
  }
  return (
    <div className={`status-toast ${status.tone}`}>
      <CheckCircle2 size={16} />
      <span>{status.message}</span>
    </div>
  );
}

function TitleBar() {
  return (
    <header className="desktop-titlebar">
      <strong>信笺写作</strong>
    </header>
  );
}

function IconButton({ icon: Icon, label, active = false, disabled = false, onClick }) {
  return (
    <button
      type="button"
      className={active ? "icon-button active" : "icon-button"}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      <Icon size={17} strokeWidth={2.1} />
    </button>
  );
}

function insertStructuredQuote(editor, savedSelectionRef) {
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

function getSafeSelectionRange(editor, savedSelectionRef) {
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

function runEditorCommand(editor, savedSelectionRef, buildCommand) {
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

function setHeadingLevel(editor, savedSelectionRef, level) {
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.toggleHeading({ level }));
}

function insertPageBreak(editor, savedSelectionRef) {
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.insertContent({ type: "paperPageBreak" }));
}

function createTocListItems(headings) {
  const root = [];
  const stack = [{ level: 0, children: root }];

  headings.forEach((heading) => {
    const level = Math.max(1, Math.min(3, heading.level));
    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    const item = { ...heading, level, children: [] };
    parent.children.push(item);
    stack.push(item);
  });

  const toListItem = (item) => {
    const content = [
      {
        type: "paragraph",
        content: [{ type: "text", text: item.text }],
      },
    ];
    if (item.children.length) {
      content.push({
        type: "bulletList",
        content: item.children.map(toListItem),
      });
    }
    return {
      type: "listItem",
      content,
    };
  };

  return root.map(toListItem);
}

function insertTableOfContents(editor, savedSelectionRef) {
  if (!editor) {
    return;
  }

  const headings = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "heading" && node.attrs.level <= 3) {
      const text = node.textContent.trim();
      if (text && text !== "目录") {
        headings.push({ level: node.attrs.level, text });
      }
    }
  });

  const content = [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "目录" }],
    },
  ];

  if (!headings.length) {
    content.push({
      type: "paragraph",
      content: [{ type: "text", text: "还没有可生成目录的标题。" }],
    });
  } else {
    content.push({
      type: "bulletList",
      content: createTocListItems(headings),
    });
  }

  runEditorCommand(editor, savedSelectionRef, (chain) => chain.insertContent(content));
}

function ColorMenu({ icon: Icon, label, options, value, onSelect }) {
  const [open, setOpen] = useState(false);
  const activeOption = options.find((option) => option.value === value) || options[0];
  const selectedColor = activeOption?.value || "#ffffff";

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".color-menu")) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.document.addEventListener("pointerdown", handlePointerDown, true);
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown, true);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <div className={open ? "color-menu open" : "color-menu"}>
      <button
        type="button"
        className="color-menu-trigger"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon size={17} />
        <span className="color-dot" style={{ "--selected-color": selectedColor }} />
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="color-menu-popover" role="menu">
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              className={option.value === value ? "color-menu-option active" : "color-menu-option"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
              role="menuitem"
            >
              <span className="color-option-dot" style={{ "--option-color": option.value || "#ffffff" }} />
              <span>{option.label}</span>
              {option.value === value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function resizeCaptionField(field) {
  if (!field) {
    return;
  }
  const row = field.closest(".paper-image-caption-row");
  const availableWidth = Math.max(240, (row?.clientWidth || field.clientWidth || 520) - 44);
  const computedStyle = window.getComputedStyle(field);
  const text = field.value || field.placeholder || "";
  const canvas = resizeCaptionField.canvas || document.createElement("canvas");
  resizeCaptionField.canvas = canvas;
  const context = canvas.getContext("2d");
  context.font = computedStyle.font;
  const measuredWidth = Math.ceil(context.measureText(text).width + 42);
  const nextWidth = Math.max(180, Math.min(availableWidth, measuredWidth));
  field.style.width = `${nextWidth}px`;
  field.style.height = "0px";
  field.style.height = `${Math.max(24, field.scrollHeight)}px`;
}

function PaperImageNodeView({ node, updateAttributes, selected }) {
  const width = node.attrs.width || "78%";
  const caption = node.attrs.caption || "";
  const captionRef = useRef(null);

  useEffect(() => {
    resizeCaptionField(captionRef.current);
    const animationFrame = window.requestAnimationFrame(() => resizeCaptionField(captionRef.current));
    const timer = window.setTimeout(() => resizeCaptionField(captionRef.current), 80);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timer);
    };
  }, [caption]);

  return (
    <NodeViewWrapper
      as="figure"
      className={selected ? "paper-image-figure selected" : "paper-image-figure"}
      data-type="paper-image"
      data-width={width}
      style={{ "--image-width": width }}
    >
      <div className="paper-image-frame" contentEditable={false}>
        <img src={node.attrs.src} alt={node.attrs.alt || ""} title={node.attrs.title || ""} draggable={false} />
        <div className="image-size-tools" aria-label="调整图片大小">
          {IMAGE_WIDTH_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={width === option.value ? "active" : ""}
              title={`图片宽度 ${option.value}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => updateAttributes({ width: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <label className="paper-image-caption-row" contentEditable={false}>
        <span className="paper-image-caption-prefix" aria-hidden="true" />
        <textarea
          ref={captionRef}
          className="paper-image-caption"
          value={caption}
          rows={1}
          onChange={(event) => {
            updateAttributes({ caption: event.target.value });
            resizeCaptionField(event.currentTarget);
          }}
          aria-label="图片标题"
          placeholder="添加图片标题"
          spellCheck={false}
        />
      </label>
    </NodeViewWrapper>
  );
}

const PaperImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: "78%",
        parseHTML: (element) => element.getAttribute("data-width") || element.style.width || "78%",
      },
      caption: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-caption") || element.querySelector("figcaption")?.textContent?.trim() || "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-type='paper-image']",
        getAttrs: (element) => {
          const image = element.querySelector("img");
          if (!image?.getAttribute("src")) {
            return false;
          }
          return {
            src: image.getAttribute("src"),
            alt: image.getAttribute("alt") || "",
            title: image.getAttribute("title") || "",
            width: element.getAttribute("data-width") || element.style.getPropertyValue("--image-width") || "78%",
            caption: element.querySelector("figcaption")?.textContent?.trim() || "",
          };
        },
      },
      {
        tag: "img[src]",
        getAttrs: (element) => ({
          src: element.getAttribute("src"),
          alt: element.getAttribute("alt") || "",
          title: element.getAttribute("title") || "",
          width: element.getAttribute("data-width") || element.style.width || "78%",
          caption: "",
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { width = "78%", caption = "", ...imageAttrs } = HTMLAttributes;
    delete imageAttrs.style;
    return [
      "figure",
      {
        "data-type": "paper-image",
        "data-width": width,
        "data-caption": caption,
        class: "paper-image-figure",
        style: `--image-width: ${width};`,
      },
      ["img", mergeAttributes(imageAttrs)],
      ["figcaption", { "data-placeholder": "添加图片标题" }, caption],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperImageNodeView);
  },
});

const PaperPageBreak = Node.create({
  name: "paperPageBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: "div[data-type='paper-page-break']" }];
  },

  renderHTML() {
    return [
      "div",
      mergeAttributes({
        "data-type": "paper-page-break",
        class: "paper-page-break",
        contenteditable: "false",
      }),
      ["span", {}, "分页符"],
    ];
  },
});

function MenuButton({ icon: Icon, label, menuId, openMenu, onOpenMenu, children }) {
  const isOpen = openMenu === menuId;

  return (
    <div className={isOpen ? "nav-menu open" : "nav-menu"}>
      <button
        type="button"
        className="nav-menu-trigger"
        title={label}
        aria-label={label}
        aria-expanded={isOpen}
        onClick={() => onOpenMenu(isOpen ? "" : menuId)}
      >
        <Icon size={19} strokeWidth={1.9} />
        <span>{label}</span>
        <ChevronDown size={14} />
      </button>
      <div className="nav-menu-popover">{children}</div>
    </div>
  );
}

function MenuItem({ icon: Icon, label, disabled = false, onClick }) {
  return (
    <button type="button" className="nav-menu-item" disabled={disabled} onClick={onClick}>
      <Icon size={16} strokeWidth={1.9} />
      <span>{label}</span>
    </button>
  );
}

function TopNav({
  editor,
  document,
  savedSelectionRef,
  updateState,
  onSave,
  onExportPdf,
  onInsertImage,
  onExportImages,
  onRunUpdate,
}) {
  const canEdit = Boolean(editor);
  const updateBusy = updateState?.status === "checking" || updateState?.status === "downloading";
  const [openMenu, setOpenMenu] = useState("");

  const closeMenus = useCallback(() => {
    setOpenMenu("");
  }, []);

  useEffect(() => {
    if (!openMenu) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".nav-menu")) {
        closeMenus();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeMenus();
      }
    };

    window.document.addEventListener("pointerdown", handlePointerDown, true);
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown, true);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [closeMenus, openMenu]);

  const runMenuAction = useCallback(
    (action) => {
      closeMenus();
      action?.();
    },
    [closeMenus],
  );

  return (
    <section className="top-nav">
      <div className="nav-primary">
        <MenuButton icon={Save} label="保存" menuId="save" openMenu={openMenu} onOpenMenu={setOpenMenu}>
          <MenuItem icon={Save} label="保存" onClick={() => runMenuAction(() => onSave(false))} />
          <MenuItem icon={SaveAll} label="另存为" onClick={() => runMenuAction(() => onSave(true))} />
        </MenuButton>
        <MenuButton icon={Download} label="导出" menuId="export" openMenu={openMenu} onOpenMenu={setOpenMenu}>
          <MenuItem icon={Download} label="导出 PDF" onClick={() => runMenuAction(onExportPdf)} />
          <MenuItem icon={FileImage} label="导出图片" onClick={() => runMenuAction(onExportImages)} />
        </MenuButton>
        <button
          type="button"
          className={updateBusy ? "nav-command active" : "nav-command"}
          disabled={updateBusy}
          onClick={onRunUpdate}
          title={updateState?.message || "检查并安装更新"}
          aria-label="检查并安装更新"
        >
          <RefreshCw size={19} strokeWidth={1.9} />
          <span>{updateBusy ? "更新中" : "更新"}</span>
        </button>
      </div>

      <div className="nav-center" />

      <div className="nav-tools">
        <IconButton icon={Undo2} label="撤销" disabled={!canEdit} onClick={() => editor?.chain().focus().undo().run()} />
        <IconButton icon={Redo2} label="重做（恢复撤销）" disabled={!canEdit} onClick={() => editor?.chain().focus().redo().run()} />
        <span className="nav-divider" />
        <IconButton
          icon={Quote}
          label="引用"
          active={editor?.isActive("blockquote")}
          disabled={!canEdit}
          onClick={() => insertStructuredQuote(editor, savedSelectionRef)}
        />
        <IconButton
          icon={List}
          label="无序列表"
          active={editor?.isActive("bulletList")}
          disabled={!canEdit}
          onClick={() => runEditorCommand(editor, savedSelectionRef, (chain) => chain.toggleBulletList())}
        />
        <IconButton
          icon={ListOrdered}
          label="有序列表"
          active={editor?.isActive("orderedList")}
          disabled={!canEdit}
          onClick={() => runEditorCommand(editor, savedSelectionRef, (chain) => chain.toggleOrderedList())}
        />
        <span className="nav-divider" />
        <IconButton icon={AlignLeft} label="左对齐" disabled={!canEdit} onClick={() => runEditorCommand(editor, savedSelectionRef, (chain) => chain.setTextAlign("left"))} />
        <IconButton icon={AlignCenter} label="居中" disabled={!canEdit} onClick={() => runEditorCommand(editor, savedSelectionRef, (chain) => chain.setTextAlign("center"))} />
        <IconButton icon={AlignRight} label="右对齐" disabled={!canEdit} onClick={() => runEditorCommand(editor, savedSelectionRef, (chain) => chain.setTextAlign("right"))} />
        <span className="nav-divider" />
        <IconButton icon={ImagePlus} label="插入图片" disabled={!canEdit} onClick={onInsertImage} />
        <IconButton icon={SeparatorHorizontal} label="插入分页符" disabled={!canEdit} onClick={() => insertPageBreak(editor, savedSelectionRef)} />
        <IconButton icon={ListTree} label="插入目录" disabled={!canEdit} onClick={() => insertTableOfContents(editor, savedSelectionRef)} />
        <IconButton icon={Heading1} label="一级标题" active={editor?.isActive("heading", { level: 1 })} disabled={!canEdit} onClick={() => setHeadingLevel(editor, savedSelectionRef, 1)} />
        <IconButton icon={Heading2} label="二级标题" active={editor?.isActive("heading", { level: 2 })} disabled={!canEdit} onClick={() => setHeadingLevel(editor, savedSelectionRef, 2)} />
        <IconButton icon={Heading3} label="三级标题" active={editor?.isActive("heading", { level: 3 })} disabled={!canEdit} onClick={() => setHeadingLevel(editor, savedSelectionRef, 3)} />
      </div>
    </section>
  );
}

function LeftSidebar({
  currentPath,
  folderState,
  mode,
  outlineItems,
  onNew,
  onOpen,
  onOpenFolder,
  onOpenFolderFile,
  onModeChange,
  onOutlineItemClick,
  onCollapse,
}) {
  return (
    <aside className="sidebar left-sidebar">
      <section className="sidebar-panel documents-panel">
        <div className="sidebar-heading">
          <h2 className="sidebar-title">{mode === "folder" ? "文件夹" : "目录"}</h2>
          <div className="sidebar-actions">
            <button type="button" className="sidebar-plus" onClick={onCollapse} aria-label="收起左侧栏" title="收起左侧栏">
              <PanelLeftClose size={18} />
            </button>
          </div>
        </div>

        <div className="sidebar-mode-switch" role="tablist" aria-label="左侧栏模式">
          <button
            type="button"
            className={mode === "folder" ? "active" : ""}
            onClick={() => onModeChange("folder")}
          >
            文件夹
          </button>
          <button
            type="button"
            className={mode === "outline" ? "active" : ""}
            onClick={() => onModeChange("outline")}
          >
            目录
          </button>
        </div>

        {mode === "folder" ? (
          <>
            <div className="sidebar-file-actions" aria-label="文件操作">
              <button type="button" onClick={onNew} title="新建文件">
                <Plus size={16} />
                <span>新建文件</span>
              </button>
              <button type="button" onClick={onOpen} title="打开文件">
                <FileText size={16} />
                <span>打开文件</span>
              </button>
              <button type="button" onClick={onOpenFolder} title="打开文件夹">
                <FolderOpen size={16} />
                <span>打开文件夹</span>
              </button>
            </div>

            {folderState.path ? (
              <div className="document-list">
                <div className="folder-path" title={folderState.path}>{folderState.path}</div>
                {folderState.files.length ? folderState.files.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className={item.path === currentPath ? "document-row active" : "document-row"}
                    onClick={() => onOpenFolderFile(item.path)}
                  >
                    {item.path === currentPath ? <span className="document-dot" /> : null}
                    <strong>{item.name}</strong>
                    <small>{new Date(item.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</small>
                  </button>
                )) : (
                  <p className="empty-folder">这个文件夹里还没有 .letterpaper 文档。</p>
                )}
              </div>
            ) : (
              <div className="folder-empty">
                <FileText size={28} />
                <span>打开一个文件夹后，这里会显示其中的信笺文档。</span>
                <button type="button" onClick={onOpenFolder}>打开文件夹</button>
              </div>
            )}
          </>
        ) : (
          <div className="outline-list" aria-label="当前文档目录">
            {outlineItems.length ? (
              outlineItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`outline-row level-${item.level}`}
                  onClick={() => onOutlineItemClick(item)}
                  title={item.text}
                >
                  <span className="outline-marker" />
                  <span>{item.text}</span>
                </button>
              ))
            ) : (
              <div className="folder-empty outline-empty">
                <ListTree size={28} />
                <span>当前信笺还没有一、二、三级标题。</span>
              </div>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}

function RightTemplateSidebar({
  document,
  letterTemplates,
  defaultTemplates,
  userTemplates,
  onCollapse,
  onLetterTemplateChange,
  onCreateUserTemplate,
  onUpdateUserTemplate,
  onPickBackground,
}) {
  const selectedLetterTemplate = getLetterTemplate(document, letterTemplates);
  const [detailTemplateId, setDetailTemplateId] = useState("");
  const detailTemplate = letterTemplates.find((template) => template.id === detailTemplateId);
  const renderTemplateCard = (letterTemplate) => {
    const paper = TEMPLATES.find((template) => template.id === letterTemplate.paperId) || TEMPLATES[0];
    const isActive = selectedLetterTemplate.id === letterTemplate.id;
    return (
      <button
        key={letterTemplate.id}
        type="button"
        title={letterTemplate.description}
        className={isActive ? "letter-template-card active" : "letter-template-card"}
        onClick={() => setDetailTemplateId(letterTemplate.id)}
      >
        <span
          className="template-thumb"
          style={{ "--swatch": paper.swatch, "--template-bg": `url("${paper.background}")` }}
        >
          {isActive ? <Check size={12} strokeWidth={3} /> : null}
        </span>
        <span className="letter-template-copy">
          <strong>{letterTemplate.label}</strong>
          <small>{letterTemplate.description}</small>
          <span className="letter-template-meta">
            <em>标题 {letterTemplate.typography.titleSize}</em>
            <em>正文 {letterTemplate.typography.bodySize}</em>
          </span>
        </span>
      </button>
    );
  };

  const updateDetailTemplate = (patch) => {
    if (!detailTemplate?.userTemplate) {
      return;
    }
    onUpdateUserTemplate(detailTemplate.id, patch);
  };

  const updateTypography = (patch) => {
    if (!detailTemplate?.userTemplate) {
      return;
    }
    updateDetailTemplate({ typography: { ...detailTemplate.typography, ...patch } });
  };

  const detailPaper = detailTemplate ? TEMPLATES.find((template) => template.id === detailTemplate.paperId) || TEMPLATES[0] : null;

  return (
    <aside className="sidebar right-sidebar">
      <section className="sidebar-panel templates-panel">
        <div className="sidebar-heading">
          <h2 className="sidebar-title">信件模板</h2>
          <button type="button" className="sidebar-plus" onClick={onCollapse} aria-label="收起右侧栏" title="收起右侧栏">
            <PanelRightClose size={18} />
          </button>
        </div>

        {detailTemplate ? (
          <div className="template-detail">
            <button type="button" className="template-back-button" onClick={() => setDetailTemplateId("")}>
              <ArrowLeft size={16} />
              <span>返回模板</span>
            </button>

            <div className="template-detail-preview" style={{ "--template-bg": `url("${detailPaper.background}")`, "--swatch": detailPaper.swatch }} />

            <div className="template-detail-header">
              {detailTemplate.userTemplate ? (
                <input
                  value={detailTemplate.label}
                  onChange={(event) => updateDetailTemplate({ label: event.target.value })}
                  aria-label="模板名称"
                />
              ) : (
                <strong>{detailTemplate.label}</strong>
              )}
              <small>{detailTemplate.userTemplate ? "用户模板，可编辑" : "默认模板，只读"}</small>
            </div>

            <label className="template-edit-row">
              <span>背景图片</span>
              {detailTemplate.userTemplate ? (
                <select value={detailTemplate.paperId} onChange={(event) => updateDetailTemplate({ paperId: event.target.value })}>
                  {TEMPLATES.map((paper) => (
                    <option key={paper.id} value={paper.id}>{paper.label}</option>
                  ))}
                </select>
              ) : (
                <em>{detailPaper.label}</em>
              )}
            </label>

            <div className="template-typography-list">
              {TYPOGRAPHY_FIELDS.map((field) => (
                <div key={field.key} className="template-typography-row">
                  <span>{field.label}</span>
                  {detailTemplate.userTemplate ? (
                    <>
                      <select
                        value={detailTemplate.typography[field.fontKey]}
                        onChange={(event) => updateTypography({ [field.fontKey]: event.target.value })}
                        aria-label={`${field.label}字体`}
                      >
                        {TEMPLATE_FONT_OPTIONS.map((font) => (
                          <option key={font} value={font}>{font}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="10"
                        max="48"
                        value={detailTemplate.typography[field.sizeKey]}
                        onChange={(event) => updateTypography({ [field.sizeKey]: Number(event.target.value) || 16 })}
                        aria-label={`${field.label}字号`}
                      />
                    </>
                  ) : (
                    <>
                      <em>{detailTemplate.typography[field.fontKey]}</em>
                      <b>{detailTemplate.typography[field.sizeKey]}</b>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="template-detail-actions">
              <button type="button" onClick={() => onLetterTemplateChange(detailTemplate.id)}>使用模板</button>
              <button type="button" onClick={() => setDetailTemplateId(onCreateUserTemplate(detailTemplate))}>基于此新建</button>
            </div>
          </div>
        ) : (
          <>
            <div className="template-section-title">
              <span>默认模板</span>
              <small>只读</small>
            </div>
            <div className="letter-template-list">
              {defaultTemplates.map(renderTemplateCard)}
            </div>
            <div className="template-section-title">
              <span>用户模板</span>
              <button type="button" onClick={() => setDetailTemplateId(onCreateUserTemplate(selectedLetterTemplate))}>新建</button>
            </div>
            {userTemplates.length ? (
              <div className="letter-template-list">
                {userTemplates.map(renderTemplateCard)}
              </div>
            ) : (
              <p className="empty-template-list">还没有用户模板。可以从默认模板新建一个可编辑副本。</p>
            )}
          </>
        )}

        <button type="button" className="custom-background-button" onClick={onPickBackground}>
          <FileImage size={15} />
          <span>导入自定义背景</span>
        </button>
      </section>
    </aside>
  );
}

function estimateAuthorWidth(author) {
  const value = author || "署名";
  const width = Array.from(value).reduce((total, character) => (
    total + (/[\u3400-\u9fff]/.test(character) ? 1.05 : 0.56)
  ), 0);
  return `${Math.max(2.2, Math.min(12, width + 0.35))}em`;
}

function PageArticle({ document, selectedTemplate, paperStyle, children, className = "", showHeader = false, onTitleChange, onAuthorChange }) {
  const authorText = document.author?.trim() || "";
  const authorWidth = estimateAuthorWidth(authorText);

  return (
    <article className={`paper-sheet template-${document.customBackground ? "custom" : document.templateId} ${className}`} style={paperStyle}>
      {showHeader ? (
        <header className="paper-header">
          <input
            className="paper-title-input"
            value={document.title}
            onChange={(event) => onTitleChange?.(event.target.value)}
            aria-label="文章标题"
            placeholder="未命名信笺"
            spellCheck={false}
          />
          <p className="paper-meta-line">
            <input
              className="paper-author-input"
              value={document.author || ""}
              onChange={(event) => onAuthorChange?.(event.target.value)}
              aria-label="作者署名"
              placeholder="署名"
              spellCheck={false}
              style={{ width: authorWidth }}
            />
            <span className={authorText ? "paper-meta-prefix with-author" : "paper-meta-prefix"}>写于</span>
            <time>{formatPaperDate(document.updatedAt)}</time>
          </p>
        </header>
      ) : null}
      {children}
    </article>
  );
}

function SelectionBubbleToolbar({ editor, disabled, savedSelectionRef }) {
  const [toolbarPosition, setToolbarPosition] = useState(null);
  const activeColor = editor?.getAttributes("textStyle")?.color || "";
  const activePaletteColor = normalizeColorValue(activeColor);
  const activeBackgroundColor = editor?.getAttributes("highlight")?.color || "";
  const activePaletteBackgroundColor = normalizeBackgroundColorValue(activeBackgroundColor);

  const updateToolbarPosition = useCallback(() => {
    if (!editor || disabled) {
      setToolbarPosition(null);
      return;
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setToolbarPosition(null);
      return;
    }
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode || !editor.view.dom.contains(anchorNode) || !editor.view.dom.contains(focusNode)) {
      setToolbarPosition(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const fallbackRect = Array.from(range.getClientRects()).find((clientRect) => clientRect.width || clientRect.height);
    const targetRect = rect.width || rect.height ? rect : fallbackRect;
    if (!targetRect) {
      setToolbarPosition(null);
      return;
    }
    const editorSelection = editor.state.selection;
    if (!editorSelection.empty) {
      savedSelectionRef.current = { from: editorSelection.from, to: editorSelection.to };
    }
    setToolbarPosition({
      left: targetRect.left + targetRect.width / 2,
      top: Math.max(72, targetRect.top - 12),
    });
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor || disabled) {
      setToolbarPosition(null);
      return undefined;
    }
    const updateSoon = () => window.requestAnimationFrame(updateToolbarPosition);
    document.addEventListener("selectionchange", updateSoon);
    document.addEventListener("scroll", updateSoon, true);
    document.addEventListener("keyup", updateSoon, true);
    editor.view.dom.addEventListener("mouseup", updateSoon);
    editor.view.dom.addEventListener("keyup", updateSoon);
    return () => {
      document.removeEventListener("selectionchange", updateSoon);
      document.removeEventListener("scroll", updateSoon, true);
      document.removeEventListener("keyup", updateSoon, true);
      editor.view.dom.removeEventListener("mouseup", updateSoon);
      editor.view.dom.removeEventListener("keyup", updateSoon);
    };
  }, [disabled, editor, updateToolbarPosition]);

  const runSelectionCommand = useCallback(
    (command) => {
      if (!editor || disabled) {
        return;
      }
      runEditorCommand(editor, savedSelectionRef, command);
      window.requestAnimationFrame(updateToolbarPosition);
    },
    [disabled, editor, savedSelectionRef, updateToolbarPosition],
  );

  const handleTextColorChange = useCallback(
    (color) => {
      runSelectionCommand((chain) => {
      if (color) {
          return chain.setColor(color);
        }
        return chain.unsetColor();
      });
    },
    [runSelectionCommand],
  );

  const handleBackgroundColorChange = useCallback(
    (color) => {
      runSelectionCommand((chain) => {
        if (color) {
          return chain.setHighlight({ color });
      } else {
          return chain.unsetHighlight();
      }
      });
    },
    [runSelectionCommand],
  );

  if (!editor || disabled) {
    return null;
  }

  return (
    <div
      className="selection-bubble-menu"
      hidden={!toolbarPosition}
      style={toolbarPosition ? { left: `${toolbarPosition.left}px`, top: `${toolbarPosition.top}px` } : undefined}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      <IconButton
        icon={Bold}
        label="加粗"
        active={editor.isActive("bold")}
        onClick={() => runSelectionCommand((chain) => chain.toggleBold())}
      />
      <IconButton
        icon={Italic}
        label="斜体"
        active={editor.isActive("italic")}
        onClick={() => runSelectionCommand((chain) => chain.toggleItalic())}
      />
      <IconButton
        icon={Underline}
        label="下划线"
        active={editor.isActive("underline")}
        onClick={() => runSelectionCommand((chain) => chain.toggleUnderline())}
      />
      <span className="bubble-divider" />
      <ColorMenu icon={Palette} label="字体颜色" options={COLOR_OPTIONS} value={activePaletteColor} onSelect={handleTextColorChange} />
      <ColorMenu
        icon={Highlighter}
        label="背景颜色"
        options={BACKGROUND_COLOR_OPTIONS}
        value={activePaletteBackgroundColor}
        onSelect={handleBackgroundColorChange}
      />
    </div>
  );
}

function PaperCanvas({ editor, document, letterTemplates, printMode, onTitleChange, onAuthorChange, savedSelectionRef }) {
  const selectedLetterTemplate = getLetterTemplate(document, letterTemplates);
  const selectedPaperId = document.customBackground ? document.templateId : selectedLetterTemplate.paperId;
  const selectedTemplate = TEMPLATES.find((template) => template.id === selectedPaperId) || TEMPLATES[0];
  const typography = selectedLetterTemplate.typography;
  const paperStyle = useMemo(
    () => ({
      "--paper-font": fontStack(typography.bodyFont),
      "--paper-font-size": `${typography.bodySize}px`,
      "--title-font": fontStack(typography.titleFont),
      "--title-size": `${typography.titleSize}px`,
      "--title-weight": typography.titleWeight,
      "--subtitle-font": fontStack(typography.subtitleFont),
      "--subtitle-size": `${typography.subtitleSize}px`,
      "--heading-font": fontStack(typography.headingFont),
      "--heading-size": `${typography.headingSize}px`,
      "--heading-weight": typography.headingWeight,
      "--quote-font": fontStack(typography.quoteFont),
      "--quote-size": `${typography.quoteSize}px`,
      "--toc-font": fontStack(typography.tocFont),
      "--toc-size": `${typography.tocSize}px`,
      "--image-caption-font": fontStack(typography.imageCaptionFont),
      "--image-caption-size": `${typography.imageCaptionSize}px`,
      "--paper-repeat-bg": document.customBackground ? `url("${document.customBackground}")` : `url("${selectedTemplate.slices.repeat}")`,
      "--paper-top-bg": document.customBackground ? "none" : `url("${selectedTemplate.slices.top}")`,
      "--paper-bottom-bg": document.customBackground ? "none" : `url("${selectedTemplate.slices.bottom}")`,
      "--paper-base": selectedTemplate.swatch,
    }),
    [
      document.customBackground,
      selectedTemplate.slices.bottom,
      selectedTemplate.slices.repeat,
      selectedTemplate.slices.top,
      selectedTemplate.swatch,
      typography,
    ],
  );
  return (
    <main className={printMode ? "canvas print-mode" : "canvas"}>
      <SelectionBubbleToolbar editor={editor} disabled={printMode} savedSelectionRef={savedSelectionRef} />
      <div className="paper-viewport">
        <PageArticle
          document={document}
          selectedTemplate={selectedTemplate}
          paperStyle={paperStyle}
          showHeader
          onTitleChange={onTitleChange}
          onAuthorChange={onAuthorChange}
        >
          <EditorContent editor={editor} />
        </PageArticle>
      </div>
    </main>
  );
}

function DocumentTabs({ tabs, activeTabId, onSelectTab, onCloseTab, onNew }) {
  return (
    <div className="document-tabs" aria-label="打开的文件">
      <div className="document-tab-list">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={tab.id === activeTabId ? "document-tab active" : "document-tab"}
            onClick={() => onSelectTab(tab.id)}
            title={tab.path || tab.title}
          >
            {tab.dirty ? <span className="document-tab-dot" /> : null}
            <span>{tab.title || "未命名信笺"}</span>
            <i
              role="button"
              tabIndex={0}
              aria-label={`关闭 ${tab.title || "未命名信笺"}`}
              onClick={(event) => {
                event.stopPropagation();
                onCloseTab(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }
              }}
            >
              <X size={15} />
            </i>
          </button>
        ))}
        <button type="button" className="document-tab add" onClick={onNew} aria-label="新建文件" title="新建文件">
          <Plus size={20} />
        </button>
      </div>
    </div>
  );
}

function StatusBar({ document, stats, dirty }) {
  return (
    <footer className="statusbar">
      <div className="statusbar-counts">
        <span>{stats.words.toLocaleString()} 字</span>
        <i />
        <span>{stats.paragraphs.toLocaleString()} 段</span>
      </div>
      <div className="statusbar-save">自动保存于 {formatClock(document.updatedAt)}{dirty ? " · 未保存" : ""}</div>
    </footer>
  );
}

function createTabId() {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function createDocumentTab(document, path = "", dirty = false) {
  return {
    id: createTabId(),
    path,
    title: document?.title || "未命名信笺",
    document,
    dirty,
  };
}

function buildOutlineItems(editor) {
  if (!editor) {
    return [];
  }
  const items = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") {
      return;
    }
    const level = Number(node.attrs.level) || 1;
    if (level < 1 || level > 3) {
      return;
    }
    const text = node.textContent?.trim();
    if (!text) {
      return;
    }
    items.push({
      id: `${pos}-${level}-${text}`,
      level,
      text,
      pos,
    });
  });
  return items;
}

function getFlowExportRects() {
  const sheet = window.document.querySelector(".paper-sheet");
  if (!sheet) {
    return [];
  }

  const sheetRect = sheet.getBoundingClientRect();
  const breaks = Array.from(sheet.querySelectorAll(".paper-page-break"))
    .map((breakElement) => breakElement.getBoundingClientRect())
    .filter((rect) => rect.top > sheetRect.top && rect.bottom < sheetRect.bottom)
    .sort((left, right) => left.top - right.top);
  const segments = [];
  let segmentTop = sheetRect.top;

  breaks.forEach((breakRect) => {
    if (breakRect.top - segmentTop >= 80) {
      segments.push({ top: segmentTop, bottom: breakRect.top });
    }
    segmentTop = breakRect.bottom;
  });

  if (sheetRect.bottom - segmentTop >= 80) {
    segments.push({ top: segmentTop, bottom: sheetRect.bottom });
  }

  return (segments.length ? segments : [{ top: sheetRect.top, bottom: sheetRect.bottom }]).map((segment) => ({
    x: sheetRect.left + window.scrollX,
    y: segment.top + window.scrollY,
    width: sheetRect.width,
    height: segment.bottom - segment.top,
  }));
}

export default function App() {
  const [initialSession] = useState(() => loadSessionState());
  const sessionRef = useRef(initialSession);
  const sessionRestoredRef = useRef(false);
  const [userLetterTemplates, setUserLetterTemplates] = useState(() => loadUserLetterTemplates());
  const letterTemplates = useMemo(() => [...DEFAULT_LETTER_TEMPLATES, ...userLetterTemplates], [userLetterTemplates]);
  const [documentState, setDocumentState] = useState(() => createBlankDocument());
  const [currentPath, setCurrentPath] = useState("");
  const [dirty, setDirty] = useState(false);
  const [openTabs, setOpenTabs] = useState(() => {
    const document = createBlankDocument();
    const tab = createDocumentTab(document);
    return [tab];
  });
  const [activeTabId, setActiveTabId] = useState(() => openTabs[0]?.id || "");
  const [folderState, setFolderState] = useState(() => ({ path: initialSession.folderPath || "", files: [] }));
  const [leftSidebarMode, setLeftSidebarMode] = useState("folder");
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(true);
  const [status, setStatus] = useState(null);
  const [printMode, setPrintMode] = useState(false);
  const [updateState, setUpdateState] = useState({ status: "idle", message: "尚未检查更新" });
  const applyingRef = useRef(false);
  const readyRef = useRef(false);
  const editorSelectionRef = useRef(null);
  const updateFlowRef = useRef({ active: false, handled: "" });
  const openTabsRef = useRef(openTabs);
  const activeTabIdRef = useRef(activeTabId);
  const currentPathRef = useRef(currentPath);
  const dirtyRef = useRef(dirty);
  const documentStateRef = useRef(documentState);
  const getSaveDocumentRef = useRef(null);
  const refreshFolderRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false }),
      TextStyle,
      Color.configure({ types: ["textStyle"] }),
      UnderlineExtension,
      Highlight.configure({ multicolor: true }),
      FontFamily,
      PaperImage.configure({ allowBase64: true, inline: false }),
      PaperPageBreak,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: "在这里开始写。" }),
    ],
    content: documentState.html,
    editorProps: {
      attributes: {
        class: "paper-editor",
        spellcheck: "false",
      },
    },
    onCreate: () => {
      readyRef.current = true;
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      const { from, to } = activeEditor.state.selection;
      editorSelectionRef.current = { from, to };
    },
    onUpdate: ({ editor: activeEditor }) => {
      if (applyingRef.current) {
        return;
      }
      const html = activeEditor.getHTML();
      setDocumentState((previous) => ({
        ...previous,
        html,
        updatedAt: new Date().toISOString(),
      }));
      setDirty(true);
    },
  });

  const stats = useMemo(() => wordStats(editor?.getText() || ""), [documentState.html, editor]);
  const outlineItems = useMemo(() => buildOutlineItems(editor), [documentState.html, editor]);

  const persistSession = useCallback((patch) => {
    const nextSession = {
      ...sessionRef.current,
      ...patch,
    };
    sessionRef.current = nextSession;
    saveSessionState(nextSession);
  }, []);

  useEffect(() => {
    saveUserLetterTemplates(userLetterTemplates);
  }, [userLetterTemplates]);

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    currentPathRef.current = currentPath;
    if (currentPath) {
      persistSession({ activePath: currentPath });
    }
  }, [currentPath, persistSession]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    documentStateRef.current = documentState;
  }, [documentState]);

  useEffect(() => {
    if (folderState.path) {
      persistSession({ folderPath: folderState.path });
    }
  }, [folderState.path, persistSession]);

  useEffect(() => {
    if (!activeTabId) {
      return;
    }
    setOpenTabs((tabs) => tabs.map((tab) => (
      tab.id === activeTabId
        ? {
            ...tab,
            path: currentPath,
            title: documentState.title || "未命名信笺",
            document: documentState,
            dirty,
          }
        : tab
    )));
  }, [activeTabId, currentPath, dirty, documentState]);

  const showStatus = useCallback((message, tone = "success") => {
    setStatus({ message, tone });
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => setStatus(null), 2800);
  }, []);

  useEffect(() => {
    let mounted = true;
    bridge.getUpdateState?.().then((state) => {
      if (mounted && state) {
        setUpdateState(state);
      }
    });
    const unsubscribe = bridge.onUpdateState?.((state) => {
      setUpdateState(state);
      if (state?.message) {
        showStatus(state.message, state.status === "error" ? "warning" : "success");
      }
      if (!updateFlowRef.current.active) {
        return;
      }
      if (state?.status === "available" && updateFlowRef.current.handled !== "available") {
        updateFlowRef.current.handled = "available";
        bridge.downloadUpdate?.();
        return;
      }
      if (state?.status === "downloaded" && updateFlowRef.current.handled !== "downloaded") {
        updateFlowRef.current.handled = "downloaded";
        bridge.installUpdate?.();
        return;
      }
      if (["none", "error", "dev"].includes(state?.status)) {
        updateFlowRef.current = { active: false, handled: state.status };
      }
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [showStatus]);

  const handleRunUpdate = useCallback(async () => {
    if (updateState?.status === "checking" || updateState?.status === "downloading") {
      return;
    }
    updateFlowRef.current = { active: true, handled: "" };
    if (updateState?.status === "downloaded") {
      updateFlowRef.current.handled = "downloaded";
      await bridge.installUpdate?.();
      return;
    }
    if (updateState?.status === "available") {
      updateFlowRef.current.handled = "available";
      const state = await bridge.downloadUpdate?.();
      if (state) {
        setUpdateState(state);
      }
      return;
    }
    const state = await bridge.checkForUpdates?.();
    if (state) {
      setUpdateState(state);
      showStatus(state.message || "更新检查完成", state.status === "error" ? "warning" : "success");
      if (state.status === "available" && updateFlowRef.current.handled !== "available") {
        updateFlowRef.current.handled = "available";
        bridge.downloadUpdate?.();
      } else if (state.status === "downloaded" && updateFlowRef.current.handled !== "downloaded") {
        updateFlowRef.current.handled = "downloaded";
        bridge.installUpdate?.();
      } else if (["none", "error", "dev"].includes(state.status)) {
        updateFlowRef.current = { active: false, handled: state.status };
      }
    }
  }, [showStatus, updateState?.status]);

  const applyDocument = useCallback(
    (nextDocument, nextPath = "", nextDirty = false) => {
      const normalized = normalizeDocument(nextDocument, letterTemplates);
      applyingRef.current = true;
      setDocumentState(normalized);
      setCurrentPath(nextPath);
      setDirty(nextDirty);
      editor?.commands.setContent(normalized.html || "<p></p>");
      window.setTimeout(() => {
        applyingRef.current = false;
      }, 0);
    },
    [editor, letterTemplates],
  );

  const getSaveDocument = useCallback(() => {
    const html = editor?.getHTML() || documentState.html || "<p></p>";
    const title = documentState.title?.trim() || inferTitle(editor?.getText() || "");
    return normalizeDocument({
      ...documentState,
      title,
      html,
      updatedAt: new Date().toISOString(),
    }, letterTemplates);
  }, [documentState, editor, letterTemplates]);

  useEffect(() => {
    getSaveDocumentRef.current = getSaveDocument;
  }, [getSaveDocument]);

  const handleTitleChange = useCallback((title) => {
    setDocumentState((previous) => ({
      ...previous,
      title,
      updatedAt: new Date().toISOString(),
    }));
    setDirty(true);
  }, []);

  const handleAuthorChange = useCallback((author) => {
    setDocumentState((previous) => ({
      ...previous,
      author: author.slice(0, 40),
      updatedAt: new Date().toISOString(),
    }));
    setDirty(true);
  }, []);

  const addOrActivateDocumentTab = useCallback(
    (nextDocument, nextPath = "", nextDirty = false) => {
      const normalized = normalizeDocument(nextDocument, letterTemplates);
      const existingTab = nextPath ? openTabs.find((tab) => tab.path === nextPath) : null;
      if (existingTab) {
        setActiveTabId(existingTab.id);
        applyDocument(existingTab.document, existingTab.path, existingTab.dirty);
        return existingTab.id;
      }
      const tab = createDocumentTab(normalized, nextPath, nextDirty);
      setOpenTabs((tabs) => {
        const onlyTab = tabs.length === 1 ? tabs[0] : null;
        const canReplaceBlank = nextPath
          && onlyTab
          && !onlyTab.path
          && !onlyTab.dirty
          && !currentPath
          && !dirty;
        return canReplaceBlank ? [tab] : [...tabs, tab];
      });
      setActiveTabId(tab.id);
      applyDocument(normalized, nextPath, nextDirty);
      return tab.id;
    },
    [applyDocument, currentPath, dirty, letterTemplates, openTabs],
  );

  useEffect(() => {
    if (!editor || sessionRestoredRef.current) {
      return undefined;
    }
    sessionRestoredRef.current = true;
    let mounted = true;
    const restoreSession = async () => {
      const { folderPath, activePath } = sessionRef.current;
      if (folderPath) {
        try {
          const result = await bridge.listFolder(folderPath);
          if (mounted && !result?.canceled) {
            setFolderState({ path: result.folderPath || folderPath, files: result.files || [] });
          }
        } catch {
          if (mounted) {
            setFolderState({ path: "", files: [] });
          }
        }
      }
      if (activePath) {
        try {
          const result = await bridge.openDocumentPath(activePath);
          if (!mounted || result?.canceled || !result?.document) {
            return;
          }
          const normalized = normalizeDocument(result.document, letterTemplates);
          const tab = createDocumentTab(normalized, result.path, false);
          setOpenTabs([tab]);
          setActiveTabId(tab.id);
          applyDocument(normalized, result.path, false);
        } catch {
          if (mounted) {
            persistSession({ activePath: "" });
          }
        }
      }
    };
    restoreSession();
    return () => {
      mounted = false;
    };
  }, [applyDocument, editor, letterTemplates, persistSession]);

  const handleSelectTab = useCallback(
    (tabId) => {
      if (tabId === activeTabId) {
        return;
      }
      const target = openTabs.find((tab) => tab.id === tabId);
      if (!target) {
        return;
      }
      const currentDocument = getSaveDocument();
      setOpenTabs((tabs) => tabs.map((tab) => (
        tab.id === activeTabId
          ? { ...tab, document: currentDocument, title: currentDocument.title, path: currentPath, dirty }
          : tab
      )));
      setActiveTabId(target.id);
      applyDocument(target.document, target.path, target.dirty);
    },
    [activeTabId, applyDocument, currentPath, dirty, getSaveDocument, openTabs],
  );

  const handleCloseTab = useCallback(
    (tabId) => {
      const closingIndex = openTabs.findIndex((tab) => tab.id === tabId);
      const closingTab = openTabs[closingIndex];
      if (!closingTab) {
        return;
      }
      const isActive = tabId === activeTabId;
      const isDirty = isActive ? dirty : closingTab.dirty;
      if (isDirty && !window.confirm("这个文件尚未保存，要关闭吗？")) {
        return;
      }
      const remaining = openTabs.filter((tab) => tab.id !== tabId);
      if (!remaining.length) {
        const blank = createBlankDocument();
        const nextTab = createDocumentTab(blank);
        setOpenTabs([nextTab]);
        setActiveTabId(nextTab.id);
        applyDocument(blank, "", false);
        return;
      }
      setOpenTabs(remaining);
      if (isActive) {
        const nextTab = remaining[Math.max(0, closingIndex - 1)] || remaining[0];
        setActiveTabId(nextTab.id);
        applyDocument(nextTab.document, nextTab.path, nextTab.dirty);
      }
    },
    [activeTabId, applyDocument, dirty, openTabs],
  );

  const handleNew = useCallback(() => {
    addOrActivateDocumentTab(createBlankDocument(), "", false);
    showStatus("已新建空白信笺", "success");
  }, [addOrActivateDocumentTab, showStatus]);

  const handleOpen = useCallback(async () => {
    const result = await bridge.openDocument();
    if (result?.canceled) {
      return;
    }
    addOrActivateDocumentTab(result.document, result.path, false);
    showStatus("文档已打开", "success");
  }, [addOrActivateDocumentTab, showStatus]);

  const handleOpenFolder = useCallback(async () => {
    const result = await bridge.openFolder();
    if (result?.canceled) {
      return;
    }
    setFolderState({ path: result.folderPath || "", files: result.files || [] });
    showStatus("文件夹已打开", "success");
  }, [showStatus]);

  const refreshFolder = useCallback(async () => {
    if (!folderState.path) {
      return;
    }
    const result = await bridge.listFolder(folderState.path);
    if (!result?.canceled) {
      setFolderState({ path: result.folderPath || folderState.path, files: result.files || [] });
    }
  }, [folderState.path]);

  useEffect(() => {
    refreshFolderRef.current = refreshFolder;
  }, [refreshFolder]);

  const handleOpenFolderFile = useCallback(
    async (path) => {
      const result = await bridge.openDocumentPath(path);
      if (result?.canceled || !result?.document) {
        showStatus("这个文件不是信笺写作文档", "warning");
        return;
      }
      addOrActivateDocumentTab(result.document, result.path, false);
      showStatus("文档已打开", "success");
    },
    [addOrActivateDocumentTab, showStatus],
  );

  const handleOutlineItemClick = useCallback(
    (item) => {
      if (!editor || typeof item?.pos !== "number") {
        return;
      }
      const selectionPos = Math.min(item.pos + 1, editor.state.doc.content.size);
      editor.chain().focus().setTextSelection(selectionPos).run();
      window.requestAnimationFrame(() => {
        const node = editor.view.nodeDOM(item.pos);
        const element = node?.nodeType === window.Node.ELEMENT_NODE ? node : node?.parentElement;
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [editor],
  );

  const handleSave = useCallback(
    async (saveAs) => {
      const nextDocument = getSaveDocument();
      const result = await bridge.saveDocument(nextDocument, currentPath, saveAs);
      if (result?.canceled) {
        return;
      }
      setDocumentState(nextDocument);
      setCurrentPath(result.path);
      setDirty(false);
      persistSession({ activePath: result.path });
      refreshFolder();
      showStatus("文档已保存", "success");
    },
    [currentPath, getSaveDocument, persistSession, refreshFolder, showStatus],
  );

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const getCurrentSaveDocument = getSaveDocumentRef.current;
      if (!getCurrentSaveDocument) {
        return;
      }
      const activeId = activeTabIdRef.current;
      const activePath = currentPathRef.current;
      const activeDirty = dirtyRef.current;
      const activeDocument = getCurrentSaveDocument();
      const snapshot = openTabsRef.current.map((tab) => (
        tab.id === activeId
          ? {
              ...tab,
              path: activePath,
              document: activeDocument,
              dirty: activeDirty,
            }
          : tab
      ));
      const realDirtyTabs = snapshot.filter((tab) => tab.path && tab.dirty);
      if (!realDirtyTabs.length) {
        return;
      }

      const savedPaths = new Set();
      for (const tab of realDirtyTabs) {
        try {
          const result = await bridge.saveDocument(tab.document, tab.path, false);
          if (!result?.canceled) {
            savedPaths.add(tab.path);
          }
        } catch {
          // A manual save will surface the exact error; the interval keeps trying.
        }
      }
      if (!savedPaths.size) {
        return;
      }

      setOpenTabs((tabs) => tabs.map((tab) => (
        savedPaths.has(tab.path)
          ? {
              ...tab,
              dirty: false,
              document: tab.id === activeId ? activeDocument : tab.document,
            }
          : tab
      )));

      if (activePath && savedPaths.has(activePath)) {
        const latestDocument = documentStateRef.current;
        const activeDocumentUnchanged = latestDocument.html === activeDocument.html
          && latestDocument.title === activeDocument.title
          && latestDocument.author === activeDocument.author
          && latestDocument.letterTemplateId === activeDocument.letterTemplateId
          && latestDocument.templateId === activeDocument.templateId
          && latestDocument.customBackground === activeDocument.customBackground;
        if (activeDocumentUnchanged) {
          setDocumentState(activeDocument);
          setDirty(false);
        }
      }
      refreshFolderRef.current?.();
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      event.preventDefault();
      handleSave(event.shiftKey);
    };

    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleSave]);

  const handleExportPdf = useCallback(async () => {
    const nextDocument = getSaveDocument();
    setDocumentState(nextDocument);
    setPrintMode(true);
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    const result = await bridge.exportPdf(nextDocument.title);
    setPrintMode(false);
    if (!result?.canceled) {
      showStatus("PDF 已导出", "success");
    }
  }, [getSaveDocument, showStatus]);

  const handleExportImages = useCallback(async () => {
    const nextDocument = getSaveDocument();
    setDocumentState(nextDocument);
    const previousRightSidebarCollapsed = rightSidebarCollapsed;
    setRightSidebarCollapsed(true);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      const pageRects = getFlowExportRects();
      if (!pageRects.length) {
        showStatus("没有可导出的内容", "warning");
        return;
      }
      const result = await bridge.exportPageImages(nextDocument.title, pageRects);
      if (!result?.canceled) {
        showStatus(`已导出 ${result.count || pageRects.length} 张图片`, "success");
      }
    } finally {
      setRightSidebarCollapsed(previousRightSidebarCollapsed);
    }
  }, [getSaveDocument, rightSidebarCollapsed, showStatus]);

  const handleInsertImage = useCallback(async () => {
    const result = await bridge.pickImage();
    if (result?.canceled || !result?.dataUrl) {
      return;
    }
    editor?.chain().focus().setImage({ src: result.dataUrl, alt: result.name || "图片", caption: "", width: "78%" }).run();
  }, [editor]);

  const handlePickBackground = useCallback(async () => {
    const result = await bridge.pickImage();
    if (result?.canceled || !result?.dataUrl) {
      return;
    }
    setDocumentState((previous) => ({
      ...previous,
      templateId: "custom",
      customBackground: result.dataUrl,
      updatedAt: new Date().toISOString(),
    }));
    setDirty(true);
    showStatus("已应用自定义信纸背景", "success");
  }, [showStatus]);

  const updateDocumentSetting = useCallback((patch) => {
    setDocumentState((previous) => ({
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
    setDirty(true);
  }, []);

  const handleCreateUserTemplate = useCallback((baseTemplate) => {
    const nextTemplate = createUserTemplate(baseTemplate);
    setUserLetterTemplates((templates) => [...templates, nextTemplate]);
    return nextTemplate.id;
  }, []);

  const handleUpdateUserTemplate = useCallback((templateId, patch) => {
    setUserLetterTemplates((templates) => templates.map((template) => (
      template.id === templateId ? normalizeUserTemplate({ ...template, ...patch }) : template
    )));
  }, []);

  const handleLetterTemplateChange = useCallback(
    (letterTemplateId) => {
      const letterTemplate = letterTemplates.find((template) => template.id === letterTemplateId) || DEFAULT_LETTER_TEMPLATES[0];
      updateDocumentSetting({
        letterTemplateId: letterTemplate.id,
        templateId: letterTemplate.paperId,
        fontFamily: letterTemplate.typography.bodyFont,
        fontSize: letterTemplate.typography.bodySize,
        customBackground: "",
      });
    },
    [letterTemplates, updateDocumentSetting],
  );

  const shellClassName = [
    "desktop-shell",
    printMode ? "print-mode" : "",
    leftSidebarCollapsed ? "left-sidebar-collapsed" : "",
    rightSidebarCollapsed ? "right-sidebar-collapsed" : "",
  ].filter(Boolean).join(" ");
  const appShellClassName = [
    "app-shell",
    leftSidebarCollapsed ? "left-collapsed" : "",
    rightSidebarCollapsed ? "right-collapsed" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={shellClassName}>
      <TitleBar />
      <TopNav
        editor={editor}
        document={documentState}
        savedSelectionRef={editorSelectionRef}
        updateState={updateState}
        onSave={handleSave}
        onExportPdf={handleExportPdf}
        onExportImages={handleExportImages}
        onInsertImage={handleInsertImage}
        onRunUpdate={handleRunUpdate}
      />
      <div className={appShellClassName}>
        {leftSidebarCollapsed ? (
          <button type="button" className="sidebar-float-toggle left" onClick={() => setLeftSidebarCollapsed(false)} aria-label="展开左侧栏" title="展开左侧栏">
            <FolderOpen size={21} />
          </button>
        ) : (
          <LeftSidebar
            currentPath={currentPath}
            folderState={folderState}
            mode={leftSidebarMode}
            outlineItems={outlineItems}
            onNew={handleNew}
            onOpen={handleOpen}
            onOpenFolder={handleOpenFolder}
            onOpenFolderFile={handleOpenFolderFile}
            onModeChange={setLeftSidebarMode}
            onOutlineItemClick={handleOutlineItemClick}
            onCollapse={() => setLeftSidebarCollapsed(true)}
          />
        )}
        <section className="workspace">
          <div className="work-surface">
            <DocumentTabs
              tabs={openTabs}
              activeTabId={activeTabId}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onNew={handleNew}
            />
            <PaperCanvas
              editor={editor}
              document={documentState}
              letterTemplates={letterTemplates}
              printMode={printMode}
              onTitleChange={handleTitleChange}
              onAuthorChange={handleAuthorChange}
              savedSelectionRef={editorSelectionRef}
            />
          </div>
        </section>
        {rightSidebarCollapsed ? (
          <button type="button" className="sidebar-float-toggle right" onClick={() => setRightSidebarCollapsed(false)} aria-label="展开信件模板" title="展开信件模板">
            <FileText size={21} />
          </button>
        ) : (
          <RightTemplateSidebar
            document={documentState}
            letterTemplates={letterTemplates}
            defaultTemplates={DEFAULT_LETTER_TEMPLATES}
            userTemplates={userLetterTemplates}
            onCollapse={() => setRightSidebarCollapsed(true)}
            onLetterTemplateChange={handleLetterTemplateChange}
            onCreateUserTemplate={handleCreateUserTemplate}
            onUpdateUserTemplate={handleUpdateUserTemplate}
            onPickBackground={handlePickBackground}
          />
        )}
      </div>
      <StatusBar document={documentState} stats={stats} dirty={dirty} />
      <StatusToast status={status} />
    </div>
  );
}
