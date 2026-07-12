import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Extension, mergeAttributes, Node } from "@tiptap/core";
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
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bot,
  Bold,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  FileImage,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  Globe2,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  HelpCircle,
  Highlighter,
  KeyRound,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  ListTree,
  Link2,
  MessageSquare,
  Minus,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Palette,
  Pencil,
  Plus,
  Quote,
  Redo2,
  RefreshCw,
  Save,
  SaveAll,
  SeparatorHorizontal,
  Send,
  Settings,
  Sparkles,
  Square,
  Table2,
  Trash2,
  Underline,
  Unlink,
  UserRound,
  Undo2,
  Video,
  Wifi,
  SquareTerminal,
  X,
} from "lucide-react";
import { bridge } from "./bridge.js";
import { groupTestedAiProviders } from "./ai-provider-selector.js";
import { codexScopeLabel, normalizeCodexImageMode, normalizeCodexScope, relativeCodexScopePath } from "./codex-scope.js";

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
const TEMPLATE_HEADING_COLOR_OPTIONS = [
  { label: "信笺棕", value: "#9a5635" },
  ...COLOR_OPTIONS.filter((option) => option.value),
];
const TEMPLATE_HEADING_COLOR_VALUES = new Set(TEMPLATE_HEADING_COLOR_OPTIONS.map((color) => color.value));
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
const DEFAULT_UNDERLINE_STYLE = "solid";
const UNDERLINE_STYLE_OPTIONS = [
  { label: "单横线", value: "solid" },
  { label: "波浪线", value: "wavy" },
  { label: "虚线", value: "dashed" },
  { label: "点线", value: "dotted" },
  { label: "双横线", value: "double" },
];
const UNDERLINE_STYLE_VALUES = new Set(UNDERLINE_STYLE_OPTIONS.map((option) => option.value));
const IMAGE_WIDTH_OPTIONS = [
  { label: "小", value: "45%" },
  { label: "中", value: "62%" },
  { label: "大", value: "78%" },
  { label: "满", value: "100%" },
];
const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const USER_TEMPLATE_STORAGE_KEY = "paperwriter.userLetterTemplates";
const USER_TEMPLATE_GROUP_STORAGE_KEY = "paperwriter.userLetterTemplateGroups";
const BASE_USER_TEMPLATE_GROUP_ID = "user-group-default";
const NEW_DOCUMENT_TEMPLATE_STORAGE_KEY = "paperwriter.newDocumentTemplateId";
const NEW_DOCUMENT_TEMPLATE_HISTORY_STORAGE_KEY = "paperwriter.newDocumentTemplateHistory";
const SESSION_STORAGE_KEY = "paperwriter.sessionState";
const IMAGE_EXPORT_STAGE_ID = "paperwriter-image-export-stage";
const IMAGE_EXPORT_SEGMENT_PADDING = 24;
const FOLDER_LIST_TIMEOUT_MS = 8000;
const FOLDER_DOUBLE_CLICK_MAX_MS = 300;
const UPDATE_RESULT_RESET_MS = 2800;
const UPDATE_AUTO_CHECK_STORAGE_KEY = "paperwriter.updateLastAutoCheckAt";
const UPDATE_AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AI_PROMPT_PREFIX = "这是我正在写的文章，请你帮我优化内容与表达：";
const AI_FIXED_LETTER_TEMPLATE_ID = "fiber-letter";
const AI_CHAT_SYSTEM_PREFIX = "你是笺间的 AI 问答助手。你可以阅读用户当前正在写的信笺内容，并围绕内容、结构、表达、事实一致性和写作策略回答问题。回答要具体、克制、可执行。";
const AI_CHAT_SELECTION_PLUGIN_KEY = new PluginKey("paperwriterAiChatSelections");
const DOCUMENT_COMMENT_PLUGIN_KEY = new PluginKey("paperwriterDocumentComments");
const HEADING_NUMBERING_PLUGIN_KEY = new PluginKey("paperwriterHeadingNumbers");
const COMMENT_COLOR_PALETTE = [
  { border: "rgba(154, 86, 53, 0.72)", bg: "rgba(246, 226, 169, 0.24)", ink: "#9a5635", anchorBg: "rgba(255, 248, 236, 0.96)" },
  { border: "rgba(80, 126, 116, 0.72)", bg: "rgba(200, 227, 211, 0.24)", ink: "#4e8580", anchorBg: "rgba(239, 250, 245, 0.96)" },
  { border: "rgba(79, 111, 143, 0.72)", bg: "rgba(201, 223, 240, 0.26)", ink: "#4f6f8f", anchorBg: "rgba(239, 248, 255, 0.96)" },
  { border: "rgba(122, 92, 143, 0.72)", bg: "rgba(217, 206, 233, 0.25)", ink: "#7a5c8f", anchorBg: "rgba(249, 244, 255, 0.96)" },
  { border: "rgba(157, 111, 47, 0.72)", bg: "rgba(246, 226, 169, 0.28)", ink: "#9d6f2f", anchorBg: "rgba(255, 249, 235, 0.96)" },
];
const COMMENT_TRACKS = [
  { side: "right", offset: 0 },
  { side: "right", offset: 34 },
  { side: "right", offset: 68 },
  { side: "left", offset: 0 },
  { side: "left", offset: 34 },
];
const COMMENT_ANCHOR_COLLISION_DISTANCE = 34;
const AI_FINALIZED_START = "【已定稿开始】";
const AI_FINALIZED_END = "【已定稿结束】";
const AI_FINALIZED_INSTRUCTION = `注意：正文中位于${AI_FINALIZED_START}和${AI_FINALIZED_END}之间的内容已经定稿，只作为背景上下文，不要改写这部分；请主要优化该符号之后的内容。`;
const AI_PROVIDER_OPTIONS = [
  {
    id: "gemini",
    label: "Gemini",
    protocol: "openai",
    builtin: true,
    model: "gemini-3.1-pro-preview",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai",
    builtin: true,
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
  },
  {
    id: "codex-cli",
    label: "Codex CLI",
    transport: "codex-cli",
    protocol: "",
    builtin: true,
    model: "",
    baseUrl: "本地 Codex CLI",
  },
];
const AI_PROTOCOL_OPTIONS = [
  { id: "openai", label: "OpenAI 兼容", baseUrl: "https://api.openai.com/v1", description: "Chat Completions 接口" },
  { id: "anthropic", label: "Anthropic 原生", baseUrl: "https://api.anthropic.com/v1", description: "Messages API 接口" },
];
const DEFAULT_AI_CONFIG = {
  activeProvider: "gemini",
  activeModelId: "gemini-default",
  activeModelKey: "gemini::gemini-default",
  providers: {},
  provider: "gemini",
  providerLabel: "Gemini",
  modelId: "gemini-default",
  modelName: "默认模型",
  model: "gemini-3.1-pro-preview",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  hasApiKey: false,
  apiKeyLast4: "",
};
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
const TEMPLATE_FONT_SELECT_OPTIONS = TEMPLATE_FONT_OPTIONS.map((font) => ({
  label: font,
  value: font,
  fontFamily: fontStack(font, "sans-serif"),
}));
const TYPOGRAPHY_FIELDS = [
  { key: "title", label: "标题", fontKey: "titleFont", sizeKey: "titleSize" },
  { key: "subtitle", label: "副标题/日期", fontKey: "subtitleFont", sizeKey: "subtitleSize" },
  { key: "body", label: "正文", fontKey: "bodyFont", sizeKey: "bodySize" },
  { key: "heading", label: "章节标题", fontKey: "headingFont", sizeKey: "headingSize" },
  { key: "quote", label: "引用", fontKey: "quoteFont", sizeKey: "quoteSize" },
  { key: "toc", label: "目录", fontKey: "tocFont", sizeKey: "tocSize" },
  { key: "imageCaption", label: "图片标题", fontKey: "imageCaptionFont", sizeKey: "imageCaptionSize" },
];
const TEMPLATE_FONT_SIZE_MIN = 10;
const TEMPLATE_FONT_SIZE_MAX = 48;
const TEMPLATE_NAME_MAX_LENGTH = 20;
const TEMPLATE_GROUP_NAME_MAX_LENGTH = 20;
const TEMPLATE_DESCRIPTION_MAX_LENGTH = 30;

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
  "windfield": new URL("./assets/papers/windfield-animation-paper.png", import.meta.url).href,
  "rain-platform": new URL("./assets/papers/rain-platform-cinematic-paper.png", import.meta.url).href,
  "starlit-sky": new URL("./assets/papers/starlit-sky-cinematic-paper.png", import.meta.url).href,
  "moon-grid": new URL("./assets/papers/moon-grid-paper.png", import.meta.url).href,
  "mist-dot-grid": new URL("./assets/papers/mist-dot-grid-paper.png", import.meta.url).href,
  "plum-snow": new URL("./assets/papers/plum-snow-paper.png", import.meta.url).href,
  "lotus-breeze": new URL("./assets/papers/lotus-breeze-paper.png", import.meta.url).href,
  "sunny-island": new URL("./assets/papers/sunny-island-cinematic-paper.png", import.meta.url).href,
  "forest-mist": new URL("./assets/papers/forest-mist-cinematic-paper.png", import.meta.url).href,
  "snow-lit-cabin": new URL("./assets/papers/snow-lit-cabin-cinematic-paper.png", import.meta.url).href,
  "bauhaus-geometry": new URL("./assets/papers/bauhaus-geometry-paper.png", import.meta.url).href,
  "swiss-editorial": new URL("./assets/papers/swiss-editorial-paper.png", import.meta.url).href,
  "retro-newspaper": new URL("./assets/papers/retro-newspaper-paper.png", import.meta.url).href,
  "film-journal": new URL("./assets/papers/film-journal-paper.png", import.meta.url).href,
  "vinyl-sleeve": new URL("./assets/papers/vinyl-sleeve-paper.png", import.meta.url).href,
  "cyber-glow": new URL("./assets/papers/cyber-glow-paper.png", import.meta.url).href,
};

const ICON_ASSETS = {
  brandMark: new URL("./assets/icons/jianjian-brand-mark.png", import.meta.url).href,
  aiEmptyMark: new URL("./assets/icons/jianjian-ai-empty.png", import.meta.url).href,
  aiComposerMark: new URL("./assets/icons/jianjian-ai-composer.png", import.meta.url).href,
  goldFolderFull: new URL("./assets/icons/gold-folder-full.png", import.meta.url).href,
  goldFolderEmpty: new URL("./assets/icons/gold-folder-empty.png", import.meta.url).href,
  gemini: new URL("./assets/icons/gemini-official.svg", import.meta.url).href,
  deepseek: new URL("./assets/icons/deepseek-favicon.ico", import.meta.url).href,
  updateArrow: new URL("./assets/icons/update-arrow.svg", import.meta.url).href,
  rightSplit: new URL("./assets/icons/right-split.png", import.meta.url).href,
  sidebarFolderTreeMode: new URL("./assets/icons/sidebar-folder-tree-generated.png", import.meta.url).href,
  sidebarOutlineMode: new URL("./assets/icons/sidebar-outline-generated.png", import.meta.url).href,
};

const DECOR_ASSETS = {
  tocTitleSignature: new URL("./assets/decor/toc-title-signature.png", import.meta.url).href,
};

const HELP_SCREENSHOTS = {
  "workspace-sidebar": new URL("./assets/help/screenshots/workspace-sidebar.webp", import.meta.url).href,
  "tabs-queue": new URL("./assets/help/screenshots/tabs-queue.webp", import.meta.url).href,
  "save-export": new URL("./assets/help/screenshots/save-export.webp", import.meta.url).href,
  "editor-outline": new URL("./assets/help/screenshots/editor-outline.webp", import.meta.url).href,
  "selection-links": new URL("./assets/help/screenshots/selection-links.webp", import.meta.url).href,
  comments: new URL("./assets/help/screenshots/comments.webp", import.meta.url).href,
  "media-pagination": new URL("./assets/help/screenshots/media-pagination.webp", import.meta.url).href,
  table: new URL("./assets/help/screenshots/table.webp", import.meta.url).href,
  "ai-providers": new URL("./assets/help/screenshots/ai-providers.webp", import.meta.url).href,
  "codex-cli": new URL("./assets/help/screenshots/codex-cli.webp", import.meta.url).href,
  "ai-optimize": new URL("./assets/help/screenshots/ai-optimize.webp", import.meta.url).href,
  "ai-chat": new URL("./assets/help/screenshots/ai-chat.webp", import.meta.url).href,
  "codex-scope-images": new URL("./assets/help/screenshots/codex-scope-images.webp", import.meta.url).href,
  "split-view": new URL("./assets/help/screenshots/split-view.webp", import.meta.url).href,
  "templates-gallery": new URL("./assets/help/screenshots/templates-gallery.webp", import.meta.url).href,
  "template-editor": new URL("./assets/help/screenshots/template-editor.webp", import.meta.url).href,
  "statusbar-update": new URL("./assets/help/screenshots/statusbar-update.webp", import.meta.url).href,
  workspace: new URL("./assets/help/screenshots/workspace-sidebar.webp", import.meta.url).href,
};

const HELP_CATEGORIES = [
  { id: "files", label: "文件与组织", icon: FolderOpen },
  { id: "writing", label: "写作编辑", icon: Pencil },
  { id: "ai", label: "AI 功能", icon: Sparkles },
  { id: "view", label: "视图与效率", icon: PanelRightClose },
];

const AI_CHAT_PROMPT_PRESETS = [
  { id: "review", label: "审阅全文", prompt: "请帮我审阅这篇信笺，指出主要优点、不足和可以优化的地方。" },
  { id: "rewrite-selection", label: "改写标记", prompt: "请改写我标记的这段文字，保持原意，但让表达更自然、更有力度。" },
  { id: "logic", label: "找逻辑漏洞", prompt: "请检查这篇信笺的逻辑链条，指出哪里论证薄弱、跳跃或证据不足。" },
  { id: "titles", label: "生成标题", prompt: "请根据这篇信笺生成 5 个标题，分别偏正式、文艺、犀利、简洁和社媒传播。" },
];
const HELP_TOPICS = [
  {
    id: "workspace-sidebar",
    categoryId: "files",
    title: "工作区、文件树与大纲",
    summary: "**左侧栏**用于管理工作区文件，并在[[文件树]]和[[正文大纲]]之间切换。",
    illustration: "workspace-sidebar",
    illustrationAlt: "笺间左侧栏，顶部可切换文件树和大纲，下方显示工作区文件夹与信笺。",
    illustrationCaption: "左侧栏同时承担工作区浏览与长文导航。",
    steps: ["点击工作区名称选择或切换本地目录。", "单击箭头展开文件夹，双击文件夹进入；单击信笺即可打开。", "切换到__大纲__后，点击一至三级标题快速定位正文。"],
    tips: ["右键文件或文件夹可新建、重命名、备份或删除，输入和确认均在应用内完成。", "可把信笺拖到当前可见的文件夹；移动后已打开标签会同步更新路径。"],
  },
  {
    id: "tabs-queue",
    categoryId: "files",
    title: "标签页、打开队列与阅读位置",
    summary: "多个信笺共享[[顶部标签栏]]，切换时会恢复各自的阅读位置。",
    illustration: "tabs-queue",
    illustrationAlt: "顶部标签栏中打开了多个信笺，并显示新增标签按钮和关闭按钮。",
    illustrationCaption: "标签页保存每篇信笺各自的编辑与阅读现场。",
    steps: ["点击标签切换信笺；再次回来时会恢复上次滚动位置。", "点击关闭只移除标签，**不会删除文件**。", "标签栏达到容量后继续打开信笺，会按打开队列腾出位置。"],
    tips: ["未保存信笺关闭前会进入保存确认；应用退出时也会统一处理。", "AI 模式中仍可在原文侧切换已打开信笺，AI 记录随信笺切换。"],
  },
  {
    id: "save-export",
    categoryId: "files",
    title: "保存、恢复与导出",
    summary: "信笺以 `.letterpaper` 保存；新版导出弹窗可输出 **PDF** 或[[分页图片]]。",
    illustration: "save-export",
    illustrationAlt: "导出弹窗中可选择 PDF 文档或分页图片，并选择保存位置。",
    illustrationCaption: "选择格式和路径后，弹窗会显示导出进度与结果。",
    steps: ["保存会写回当前文件；另存为会生成新的 `.letterpaper` 信笺。", "打开导出弹窗，选择 PDF 或分页图片，再指定保存位置。", "分页图片按正文中的__分页符__输出连续编号的 PNG。"],
    tips: ["未命名信笺会先进入临时会话，重启后可恢复，正式保存时再选择路径。", "`.letterpaper` 会携带正文、内嵌素材、排版、评注和 AI 记录。"],
  },
  {
    id: "editor-outline",
    categoryId: "writing",
    title: "正文、标题编号与目录",
    summary: "标题、署名、日期和正文均可直接编辑，章节结构由[[标题层级]]驱动。",
    illustration: "editor-outline",
    illustrationAlt: "信笺正文展示分节内容，顶部工具栏提供标题层级和目录入口。",
    illustrationCaption: "使用标题层级组织正文后，可在大纲和目录中导航。",
    steps: ["在页面中直接编辑标题、署名、日期和正文。", "通过顶部工具栏设置一至三级标题，并按需要启用或取消当前标题编号。", "点击目录按钮生成或关闭正文目录；大纲会随标题实时更新。"],
    tips: ["模板可以分别设置各级标题是否默认编号，当前标题仍可单独覆盖。", "撤销和重做位于顶部工具栏，正文样式跟随当前信笺模板。"],
  },
  {
    id: "selection-links",
    categoryId: "writing",
    title: "选区格式与链接",
    summary: "框选正文后可处理[[局部样式]]、插入链接或把文字标记给 AI。",
    illustration: "selection-links",
    illustrationAlt: "文字选区上方显示悬浮工具条，包含加粗、斜体、下划线、颜色、标注和链接操作。",
    illustrationCaption: "悬浮条只影响当前选区，不改变整篇模板。",
    steps: ["框选文字，使用悬浮条设置**加粗**、斜体、__下划线__、颜色和水彩标注。", "在媒体菜单中插入链接；已有链接可单击编辑，按 Ctrl/Command 单击打开。", "AI 问答模式下可把选区加入“已标记文字”。"],
    tips: ["下划线菜单包含实线、波浪线、虚线和双横线。", "链接仅支持 `http`、`https` 和邮箱地址，移除链接不会删除显示文字。"],
  },
  {
    id: "comments",
    categoryId: "writing",
    title: "文档评注",
    summary: "评注用于给[[具体文字范围]]留下可回看的编辑意见。",
    illustration: "comments",
    illustrationAlt: "信笺正文选中了需要评注的文字，选区工具条提供评注入口。",
    illustrationCaption: "先选中具体文字，再从选区工具条创建评注。",
    steps: ["框选文字后点击悬浮条中的评注按钮。", "输入评注并保存，正文出现高亮，页面侧边出现对应锚点。", "点击锚点查看、编辑或删除评注。"],
    tips: ["评注会随 `.letterpaper` 保存，复制信笺时一并携带。", "正文增删后评注范围会跟随内容映射；过度密集的位置会限制继续添加。"],
  },
  {
    id: "media-pagination",
    categoryId: "writing",
    title: "图片、音视频、引用与分页",
    summary: "媒体菜单插入本地素材，元素菜单负责[[引用、分割线和分页符]]。",
    illustration: "media-pagination",
    illustrationAlt: "顶部媒体与元素菜单展开，显示图片、音频、视频、链接、引用、分割线和分页符。",
    illustrationCaption: "媒体与结构元素分为两个菜单，减少顶部工具栏拥挤。",
    steps: ["从媒体菜单插入图片、音频或视频；图片可调整宽度并编辑标题。", "从元素菜单插入引用块、分割线、分页符或表格。", "导出分页图片时，每个分页符之间的内容成为一张图片。"],
    tips: ["音频上限为 20 MB，视频上限为 100 MB，素材会随信笺打包保存。", "模板可隐藏图片标题或编号；文字仍保留，重新开启后会恢复。"],
  },
  {
    id: "table-edit",
    categoryId: "writing",
    title: "表格",
    summary: "顶部表格按钮只插入默认表格，增删行列在[[表格自身工具条]]完成。",
    illustration: "table",
    illustrationAlt: "正文表格上方显示增删行列和删除整表的快捷工具条。",
    illustrationCaption: "把光标放入表格后，相关操作才会出现。",
    steps: ["点击顶部表格图标插入默认表格。", "光标放进表格后，上方出现小工具条。", "用工具条增删上/下行、左/右列，或删除整张表。"],
    tips: ["表格工具条会悬在表格上方，避免遮挡单元格内容。"],
  },
  {
    id: "ai-providers",
    categoryId: "ai",
    title: "供应商、模型与连接测试",
    summary: "AI 设置管理内置供应商与自定义的 **OpenAI 兼容**、**Anthropic 原生**接口。",
    illustration: "ai-providers",
    illustrationAlt: "AI 设置页面左侧列出多个供应商，右侧显示接口信息、模型列表和连接测试操作。",
    illustrationCaption: "只有连接测试成功的模型才能用于 AI 功能。",
    steps: ["打开 AI 设置，选择 Gemini、DeepSeek、Codex CLI 或已有自定义供应商。", "点击添加供应商，填写唯一名称、协议和 Base URL；随后配置 API Key 与模型标识。", "逐个测试模型，选择一个可用模型设为默认。"],
    tips: ["API Key 只保存在本机配置中，界面和公开配置不会显示完整密钥。", "内置供应商不可删除；自定义供应商可删除，但默认项必须先切换。"],
  },
  {
    id: "codex-cli",
    categoryId: "ai",
    title: "Codex CLI",
    summary: "Codex CLI 复用本机登录态，不需要在笺间填写 Base URL 或 API Key。",
    illustration: "codex-cli",
    illustrationAlt: "Codex CLI 配置页显示安装、登录和版本状态，以及可用模型和推理强度。",
    illustrationCaption: "重新检查会同步本机状态、模型目录与支持的推理强度。",
    steps: ["先安装 `npm install -g @openai/codex`，再在配置页点击重新检查。", "未登录时点击登录 Codex，在打开的终端中完成授权。", "同步完成后，为模型选择推理强度并设置默认模型。"],
    tips: ["Codex CLI 仅在桌面端可用，调用会消耗当前登录账号的配额。", "笺间不会保存 Codex 登录凭据；模型和推理强度以本机 CLI 返回结果为准。"],
  },
  {
    id: "ai-optimize",
    categoryId: "ai",
    title: "AI 优化",
    summary: "AI 优化读取当前信笺，为正文生成[[优化稿]]。",
    illustration: "ai-optimize",
    illustrationAlt: "AI 优化左右分栏，左侧为原文，右侧为优化结果和模型操作。",
    illustrationCaption: "定稿线以上作为背景，线以下是本次优化重点。",
    steps: ["点击 AI 优化进入左右分栏。", "右侧显示模型和优化结果。", "可重新优化、清空优化，或把结果插入__定稿线__。"],
    tips: ["优化记录跟随当前信笺保存。", "重新优化会覆盖当前信笺已有的优化结果。"],
  },
  {
    id: "ai-chat",
    categoryId: "ai",
    title: "AI 问答",
    summary: "AI 问答围绕当前信笺进行[[审阅、改写、找漏洞和标题生成]]。",
    illustration: "ai-chat",
    illustrationAlt: "AI 问答左右分栏，右侧显示模型、问答记录、快捷问题和输入框。",
    illustrationCaption: "可直接围绕全文提问，也可重点引用左侧标记文字。",
    steps: ["进入 AI 问答后选择已测试模型，可使用审阅全文、改写标记等快捷问题。", "直接输入问题，或先在左侧选中文字并标记给 AI。", "可导出当前问答记录；输入草稿和消息会按**信笺**保存。"],
    tips: ["清空只影响当前信笺的问答，不会清除 AI 优化结果或 Codex 范围设置。", "切换信笺或模型不会混用不同信笺的对话上下文。"],
  },
  {
    id: "codex-scope-images",
    categoryId: "ai",
    title: "Codex 目录范围与原图",
    summary: "Codex 问答可控制[[只读目录边界]]，并选择附加原图或仅发送 `[图N.标题]`。",
    illustration: "codex-scope-images",
    illustrationAlt: "Codex 目录范围菜单显示四种读取范围，底部提供信笺原图开关和图片数量。",
    illustrationCaption: "目录范围与图片模式都按信笺保存，只影响下一次提问。",
    steps: ["在切换模型右侧打开目录范围，选择仅当前信笺、信笺目录、整个工作区或指定子目录。", "选择子目录时从当前工作区目录树中定位，Codex 不会获得工作区外的项目路径。", "在菜单底部切换信笺图片：默认附加全部原图，也可改为仅标题。"],
    tips: ["目录失效或符号链接逃出工作区时会要求重新选择，不会自动扩大范围。", "原图模式会增加图片 token；图片失效时会明确提示图号，不会静默漏图。"],
  },
  {
    id: "split-view",
    categoryId: "view",
    title: "左右分屏",
    summary: "非 AI 模式下，可把一个已打开信笺固定到[[右侧分屏]]。",
    illustration: "split-view",
    illustrationAlt: "两个信笺在窗口中左右并排显示，右侧面板带有关闭分屏按钮。",
    illustrationCaption: "左右分屏适合对照资料、整理和改写。",
    steps: ["右键某个标签页，选择向右分屏。", "左侧继续编辑当前信笺，右侧显示被分屏信笺。", "再次右键该标签，或点击右侧关闭按钮取消。"],
    tips: ["右分屏只允许一个。", "右键标签仍可进入信笺模板设置，左侧文件栏可继续使用。"],
  },
  {
    id: "templates-gallery",
    categoryId: "view",
    title: "系统模板与切换",
    summary: "信笺模板统一管理纸张、字体和结构呈现，不改变正文内容。",
    illustration: "templates-gallery",
    illustrationAlt: "信笺模板弹窗左侧为模板分组，右侧为多种系统信纸卡片。",
    illustrationCaption: "系统模板只读，可直接预览并应用到当前信笺。",
    steps: ["右键标签页并选择修改信笺模板。", "在左侧系统分组间切换，点击模板卡片查看详情和完整页面预览。", "点击使用模板，把选中的纸张和排版应用到当前信笺。"],
    tips: ["切换模板不会改变正文文字、图片或评注。", "系统模板不可修改；需要自定义时可基于它创建用户模板。"],
  },
  {
    id: "template-editor",
    categoryId: "view",
    title: "用户模板、分组与新建默认",
    summary: "用户模板可编辑字体、字号、颜色、段落、编号和图片标题规则。",
    illustration: "template-editor",
    illustrationAlt: "用户模板详情页显示页面预览、字体排版设置、高级选项以及新建默认模板开关。",
    illustrationCaption: "用户模板可编辑，并可加入多个自定义分组。",
    steps: ["从模板详情点击新建模板，填写唯一名称并选择所属用户分组。", "调整标题、正文、引用等字体字号，并在高级选项中设置段落、标题编号和图片标题。", "保存后可设为新建信笺默认模板，或继续重命名、归类和删除。"],
    tips: ["所有用户模板始终保留在“我的模板”；删除其他分组只移除归类。", "删除当前新建默认模板时，会恢复到上一个有效默认模板。"],
  },
  {
    id: "status-cache-update",
    categoryId: "view",
    title: "状态栏、缓存与更新",
    summary: "底部状态栏显示统计、[[自动保存]]、缓存和版本更新。",
    illustration: "statusbar-update",
    illustrationAlt: "底部状态栏显示字数、段落、页数、图片、引用、自动保存、缓存大小和更新检查。",
    illustrationCaption: "状态栏集中展示文档状态与应用维护入口。",
    steps: ["左侧查看字数、段落、页数、图片和引用统计。", "中间查看自动保存时间和当前缓存大小。", "右侧检查更新；可更新时图标显示[[红点]]。"],
    tips: ["扫把按钮用于清理编辑器结构缓存。", "缓存用于加速已打开信笺之间的切换。"],
  },
];

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
  "windfield": {
    top: new URL("./assets/papers/slices/windfield-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/windfield-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/windfield-bottom.png", import.meta.url).href,
  },
  "rain-platform": {
    top: new URL("./assets/papers/slices/rain-platform-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/rain-platform-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/rain-platform-bottom.png", import.meta.url).href,
  },
  "starlit-sky": {
    top: new URL("./assets/papers/slices/starlit-sky-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/starlit-sky-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/starlit-sky-bottom.png", import.meta.url).href,
  },
  "moon-grid": {
    top: new URL("./assets/papers/slices/moon-grid-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/moon-grid-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/moon-grid-bottom.png", import.meta.url).href,
  },
  "mist-dot-grid": {
    top: new URL("./assets/papers/slices/mist-dot-grid-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/mist-dot-grid-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/mist-dot-grid-bottom.png", import.meta.url).href,
  },
  "plum-snow": {
    top: new URL("./assets/papers/slices/plum-snow-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/plum-snow-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/plum-snow-bottom.png", import.meta.url).href,
  },
  "lotus-breeze": {
    top: new URL("./assets/papers/slices/lotus-breeze-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/lotus-breeze-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/lotus-breeze-bottom.png", import.meta.url).href,
  },
  "sunny-island": {
    top: new URL("./assets/papers/slices/sunny-island-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/sunny-island-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/sunny-island-bottom.png", import.meta.url).href,
  },
  "forest-mist": {
    top: new URL("./assets/papers/slices/forest-mist-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/forest-mist-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/forest-mist-bottom.png", import.meta.url).href,
  },
  "snow-lit-cabin": {
    top: new URL("./assets/papers/slices/snow-lit-cabin-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/snow-lit-cabin-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/snow-lit-cabin-bottom.png", import.meta.url).href,
  },
  "bauhaus-geometry": {
    top: new URL("./assets/papers/slices/bauhaus-geometry-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/bauhaus-geometry-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/bauhaus-geometry-bottom.png", import.meta.url).href,
  },
  "swiss-editorial": {
    top: new URL("./assets/papers/slices/swiss-editorial-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/swiss-editorial-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/swiss-editorial-bottom.png", import.meta.url).href,
  },
  "retro-newspaper": {
    top: new URL("./assets/papers/slices/retro-newspaper-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/retro-newspaper-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/retro-newspaper-bottom.png", import.meta.url).href,
  },
  "film-journal": {
    top: new URL("./assets/papers/slices/film-journal-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/film-journal-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/film-journal-bottom.png", import.meta.url).href,
  },
  "vinyl-sleeve": {
    top: new URL("./assets/papers/slices/vinyl-sleeve-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/vinyl-sleeve-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/vinyl-sleeve-bottom.png", import.meta.url).href,
  },
  "cyber-glow": {
    top: new URL("./assets/papers/slices/cyber-glow-top.png", import.meta.url).href,
    repeat: new URL("./assets/papers/slices/cyber-glow-repeat.png", import.meta.url).href,
    bottom: new URL("./assets/papers/slices/cyber-glow-bottom.png", import.meta.url).href,
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
  { id: "windfield", label: "风野手绘", swatch: "#f8f1d7", background: PAPER_ASSETS["windfield"], slices: PAPER_SLICES["windfield"] },
  { id: "rain-platform", label: "雨站微光", swatch: "#eef2f4", background: PAPER_ASSETS["rain-platform"], slices: PAPER_SLICES["rain-platform"] },
  { id: "starlit-sky", label: "星海黄昏", swatch: "#f4edf5", background: PAPER_ASSETS["starlit-sky"], slices: PAPER_SLICES["starlit-sky"] },
  { id: "moon-grid", label: "月白方格", swatch: "#f3f5f4", background: PAPER_ASSETS["moon-grid"], slices: PAPER_SLICES["moon-grid"] },
  { id: "mist-dot-grid", label: "雾灰点阵", swatch: "#f3f0e9", background: PAPER_ASSETS["mist-dot-grid"], slices: PAPER_SLICES["mist-dot-grid"] },
  { id: "plum-snow", label: "梅雪小笺", swatch: "#f7f3ef", background: PAPER_ASSETS["plum-snow"], slices: PAPER_SLICES["plum-snow"] },
  { id: "lotus-breeze", label: "荷风清简", swatch: "#edf4ef", background: PAPER_ASSETS["lotus-breeze"], slices: PAPER_SLICES["lotus-breeze"] },
  { id: "sunny-island", label: "海风晴屿", swatch: "#eef5f2", background: PAPER_ASSETS["sunny-island"], slices: PAPER_SLICES["sunny-island"] },
  { id: "forest-mist", label: "林间晨雾", swatch: "#edf2ec", background: PAPER_ASSETS["forest-mist"], slices: PAPER_SLICES["forest-mist"] },
  { id: "snow-lit-cabin", label: "初雪灯屋", swatch: "#f1f1f6", background: PAPER_ASSETS["snow-lit-cabin"], slices: PAPER_SLICES["snow-lit-cabin"] },
  { id: "bauhaus-geometry", label: "包豪斯几何", swatch: "#f4eee2", background: PAPER_ASSETS["bauhaus-geometry"], slices: PAPER_SLICES["bauhaus-geometry"] },
  { id: "swiss-editorial", label: "瑞士编辑", swatch: "#f2f2ef", background: PAPER_ASSETS["swiss-editorial"], slices: PAPER_SLICES["swiss-editorial"] },
  { id: "retro-newspaper", label: "复古报刊", swatch: "#eee8dc", background: PAPER_ASSETS["retro-newspaper"], slices: PAPER_SLICES["retro-newspaper"] },
  { id: "film-journal", label: "胶片手记", swatch: "#eee8df", background: PAPER_ASSETS["film-journal"], slices: PAPER_SLICES["film-journal"] },
  { id: "vinyl-sleeve", label: "黑胶封套", swatch: "#f3eddf", background: PAPER_ASSETS["vinyl-sleeve"], slices: PAPER_SLICES["vinyl-sleeve"] },
  { id: "cyber-glow", label: "赛博微光", swatch: "#eef2f5", background: PAPER_ASSETS["cyber-glow"], slices: PAPER_SLICES["cyber-glow"] },
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

const DEFAULT_TEMPLATE_PRESENTATION = Object.freeze({
  showDocumentTitle: true,
  showSignatureDate: true,
  indentParagraphs: true,
  paragraphAlign: "left",
  headingColors: Object.freeze({ 1: "#9a5635", 2: "#9a5635", 3: "#9a5635" }),
  headingNumbering: Object.freeze({ 1: true, 2: true, 3: true }),
  showImageCaptions: true,
  numberImageCaptions: true,
});

function normalizeTemplatePresentation(presentation) {
  const source = presentation && typeof presentation === "object" ? presentation : {};
  const headingColors = source.headingColors && typeof source.headingColors === "object" ? source.headingColors : {};
  const headingNumbering = source.headingNumbering && typeof source.headingNumbering === "object" ? source.headingNumbering : {};
  const normalizeHeadingColor = (level) => (
    TEMPLATE_HEADING_COLOR_VALUES.has(String(headingColors[level] || "").toLowerCase())
      ? String(headingColors[level]).toLowerCase()
      : DEFAULT_TEMPLATE_PRESENTATION.headingColors[level]
  );
  return {
    showDocumentTitle: source.showDocumentTitle !== false,
    showSignatureDate: source.showSignatureDate !== false,
    indentParagraphs: source.indentParagraphs !== false,
    paragraphAlign: ["left", "center", "right"].includes(source.paragraphAlign) ? source.paragraphAlign : "left",
    headingColors: {
      1: normalizeHeadingColor(1),
      2: normalizeHeadingColor(2),
      3: normalizeHeadingColor(3),
    },
    headingNumbering: {
      1: headingNumbering[1] !== false,
      2: headingNumbering[2] !== false,
      3: headingNumbering[3] !== false,
    },
    showImageCaptions: source.showImageCaptions !== false,
    numberImageCaptions: source.numberImageCaptions !== false,
  };
}

const DEFAULT_LETTER_TEMPLATES = [
  { id: "fiber-letter", label: "素纤维纸", paperId: "fiber", description: "朴素纸感 / 标准正文比例", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "windfield-letter", label: "风野手札", paperId: "windfield", description: "手绘田园 / 温暖清新动画感", typography: TYPOGRAPHY_PRESETS.airy },
  { id: "rain-platform-letter", label: "雨站来信", paperId: "rain-platform", description: "通透雨景 / 蓝青电影氛围", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "starlit-sky-letter", label: "星海晚笺", paperId: "starlit-sky", description: "云海星光 / 澄澈黄昏色彩", typography: TYPOGRAPHY_PRESETS.airy },
  { id: "warm-letter", label: "暖白长信", paperId: "minimal-red-margin", description: "红线信纸 / 宋体标题 / 文楷正文", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "bamboo-note", label: "竹影札记", paperId: "bamboo-vertical", description: "竖线竹影 / 文楷舒展排版", typography: TYPOGRAPHY_PRESETS.airy },
  { id: "mountain-border", label: "山影边笺", paperId: "parchment-mountain", description: "浅山边框 / 稍紧长文排版", typography: TYPOGRAPHY_PRESETS.compact },
  { id: "feather-essay", label: "羽毛随笔", paperId: "feather-lined", description: "羽毛横线 / 标题更醒目", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "blue-water", label: "浅蓝水彩", paperId: "soft-blue", description: "淡蓝纸纹 / 阅读字号偏大", typography: TYPOGRAPHY_PRESETS.airy },
  { id: "window-shadow", label: "竹窗光影", paperId: "bamboo-shadow", description: "窗影纹理 / 紧凑札记风格", typography: TYPOGRAPHY_PRESETS.compact },
  { id: "corner-classic", label: "中式角纹", paperId: "chinese-corner", description: "中式边角 / 清雅阅读版式", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "moon-grid-letter", label: "月白方格", paperId: "moon-grid", description: "月白细格 / 清爽结构笔记感", typography: TYPOGRAPHY_PRESETS.compact },
  { id: "mist-dot-letter", label: "雾灰点阵", paperId: "mist-dot-grid", description: "雾灰点阵 / 轻盈自由排版", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "plum-snow-letter", label: "梅雪小笺", paperId: "plum-snow", description: "疏梅映雪 / 清冷留白意境", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "lotus-breeze-letter", label: "荷风清简", paperId: "lotus-breeze", description: "淡荷清波 / 湖青舒展留白", typography: TYPOGRAPHY_PRESETS.airy },
  { id: "sunny-island-letter", label: "海风晴屿", paperId: "sunny-island", description: "晴海小岛 / 清透海风动画感", typography: TYPOGRAPHY_PRESETS.airy },
  { id: "forest-mist-letter", label: "林间晨雾", paperId: "forest-mist", description: "薄雾森林 / 静谧青绿动画感", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "snow-lit-cabin-letter", label: "初雪灯屋", paperId: "snow-lit-cabin", description: "初雪暖灯 / 冬夜治愈动画感", typography: TYPOGRAPHY_PRESETS.airy },
  { id: "bauhaus-geometry-letter", label: "包豪斯几何", paperId: "bauhaus-geometry", description: "几何构成 / 低饱和现代秩序", typography: TYPOGRAPHY_PRESETS.compact },
  { id: "swiss-editorial-letter", label: "瑞士编辑", paperId: "swiss-editorial", description: "编辑网格 / 克制清晰版式", typography: TYPOGRAPHY_PRESETS.compact },
  { id: "retro-newspaper-letter", label: "复古报刊", paperId: "retro-newspaper", description: "旧报纸感 / 沉静经典排版", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "film-journal-letter", label: "胶片手记", paperId: "film-journal", description: "胶片漏光 / 温柔影像随笔", typography: TYPOGRAPHY_PRESETS.airy },
  { id: "vinyl-sleeve-letter", label: "黑胶封套", paperId: "vinyl-sleeve", description: "唱片弧线 / 复古音乐质感", typography: TYPOGRAPHY_PRESETS.classic },
  { id: "cyber-glow-letter", label: "赛博微光", paperId: "cyber-glow", description: "冰灰微光 / 轻量未来科技感", typography: TYPOGRAPHY_PRESETS.airy },
].map((template) => ({ ...template, presentation: normalizeTemplatePresentation() }));

const SYSTEM_TEMPLATE_GROUPS = [
  {
    id: "system-clean-paper",
    label: "素净纸笺",
    templateIds: ["fiber-letter", "warm-letter", "feather-essay", "blue-water", "moon-grid-letter", "mist-dot-letter"],
  },
  {
    id: "system-eastern-mood",
    label: "东方意境",
    templateIds: ["bamboo-note", "mountain-border", "window-shadow", "corner-classic", "plum-snow-letter", "lotus-breeze-letter"],
  },
  {
    id: "system-scenic-animation",
    label: "风景动画",
    templateIds: ["windfield-letter", "rain-platform-letter", "starlit-sky-letter", "sunny-island-letter", "forest-mist-letter", "snow-lit-cabin-letter"],
  },
  {
    id: "system-modern-design",
    label: "现代设计",
    templateIds: ["bauhaus-geometry-letter", "swiss-editorial-letter", "retro-newspaper-letter", "film-journal-letter", "vinyl-sleeve-letter", "cyber-glow-letter"],
  },
];

const SYSTEM_TEMPLATE_PAPER_IDS = new Set(
  SYSTEM_TEMPLATE_GROUPS.flatMap((group) => group.templateIds)
    .map((templateId) => DEFAULT_LETTER_TEMPLATES.find((template) => template.id === templateId)?.paperId)
    .filter(Boolean),
);

function getLetterTemplateGroupId(template) {
  if (template?.userTemplate) {
    return BASE_USER_TEMPLATE_GROUP_ID;
  }
  return SYSTEM_TEMPLATE_GROUPS.find((group) => group.templateIds.includes(template?.id))?.id
    || SYSTEM_TEMPLATE_GROUPS[0].id;
}

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
  return TEMPLATES.some((template) => template.id === migrated) ? migrated : "fiber";
}

function normalizeLetterTemplateId(letterTemplateId, templateId, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  if (letterTemplates.some((template) => template.id === letterTemplateId)) {
    return letterTemplateId;
  }
  const normalizedPaperId = normalizeTemplateId(templateId, "");
  return letterTemplates.find((template) => template.paperId === normalizedPaperId)?.id || "fiber-letter";
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

function createTemplateGroupId() {
  return `user-group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeTemplateFontSize(value, fallback = 16) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const parsed = Number.parseInt(digits, 10);
  const normalizedFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 16;
  const candidate = Number.isFinite(parsed) ? parsed : normalizedFallback;
  return Math.min(TEMPLATE_FONT_SIZE_MAX, Math.max(TEMPLATE_FONT_SIZE_MIN, Math.round(candidate)));
}

function normalizeTemplateName(value, fallback = "我的信笺模板") {
  const compact = String(value ?? "").trim().replace(/\s+/g, " ");
  const normalized = Array.from(compact).slice(0, TEMPLATE_NAME_MAX_LENGTH).join("");
  return normalized || fallback;
}

function templateNameKey(value) {
  return normalizeTemplateName(value).toLocaleLowerCase();
}

function createUniqueTemplateName(value, templates = []) {
  const desiredName = normalizeTemplateName(value);
  const existingNames = new Set(templates.map((template) => templateNameKey(template?.label)));
  if (!existingNames.has(templateNameKey(desiredName))) {
    return desiredName;
  }
  for (let index = 2; index < 10000; index += 1) {
    const suffix = ` ${index}`;
    const stemLength = Math.max(1, TEMPLATE_NAME_MAX_LENGTH - Array.from(suffix).length);
    const stem = Array.from(desiredName).slice(0, stemLength).join("").trimEnd();
    const candidate = `${stem}${suffix}`;
    if (!existingNames.has(templateNameKey(candidate))) {
      return candidate;
    }
  }
  return `${Array.from(desiredName).slice(0, TEMPLATE_NAME_MAX_LENGTH - 5).join("")} ${Date.now().toString().slice(-4)}`;
}

function normalizeTemplateDescription(value, fallback = "用户模板/可编辑") {
  const compact = String(value ?? "").trim().replace(/\s+/g, " ");
  const normalized = Array.from(compact).slice(0, TEMPLATE_DESCRIPTION_MAX_LENGTH).join("");
  return normalized || fallback;
}

function normalizeTemplateGroupName(value) {
  const compact = String(value ?? "").trim().replace(/\s+/g, " ");
  return Array.from(compact).slice(0, TEMPLATE_GROUP_NAME_MAX_LENGTH).join("");
}

function normalizeUserTemplateGroups(groups) {
  const source = Array.isArray(groups) ? groups : [];
  const normalized = [{
    id: BASE_USER_TEMPLATE_GROUP_ID,
    label: "我的模板",
    createdAt: 0,
  }];
  const seenIds = new Set([BASE_USER_TEMPLATE_GROUP_ID]);
  const seenNames = new Set(["我的模板".toLocaleLowerCase()]);

  source.forEach((group, index) => {
    const id = typeof group?.id === "string" && group.id.startsWith("user-group-")
      ? group.id
      : "";
    const label = normalizeTemplateGroupName(group?.label);
    const normalizedName = label.toLocaleLowerCase();
    if (!id || seenIds.has(id) || !label || seenNames.has(normalizedName)) {
      return;
    }
    const createdAt = Number.isFinite(Number(group?.createdAt))
      ? Number(group.createdAt)
      : Date.now() + index;
    seenIds.add(id);
    seenNames.add(normalizedName);
    normalized.push({ id, label, createdAt });
  });

  return normalized;
}

function loadUserTemplateGroups() {
  if (typeof window === "undefined") {
    return normalizeUserTemplateGroups([]);
  }
  try {
    const raw = window.localStorage.getItem(USER_TEMPLATE_GROUP_STORAGE_KEY);
    return normalizeUserTemplateGroups(raw ? JSON.parse(raw) : []);
  } catch {
    return normalizeUserTemplateGroups([]);
  }
}

function saveUserTemplateGroups(groups) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    USER_TEMPLATE_GROUP_STORAGE_KEY,
    JSON.stringify(normalizeUserTemplateGroups(groups)),
  );
}

function cloneTypography(typography) {
  const nextTypography = { ...TYPOGRAPHY_PRESETS.classic, ...typography };
  TYPOGRAPHY_FIELDS.forEach((field) => {
    if (!TEMPLATE_FONT_OPTIONS.includes(nextTypography[field.fontKey])) {
      nextTypography[field.fontKey] = TYPOGRAPHY_PRESETS.classic[field.fontKey];
    }
    nextTypography[field.sizeKey] = normalizeTemplateFontSize(
      nextTypography[field.sizeKey],
      TYPOGRAPHY_PRESETS.classic[field.sizeKey],
    );
  });
  return nextTypography;
}

function normalizeUserTemplate(template, userTemplateGroups = null) {
  const paperId = SYSTEM_TEMPLATE_PAPER_IDS.has(template?.paperId)
    ? template.paperId
    : DEFAULT_LETTER_TEMPLATES[0].paperId;
  const availableGroupIds = Array.isArray(userTemplateGroups)
    ? new Set(userTemplateGroups.map((group) => group.id))
    : null;
  const candidateGroupIds = [
    ...(Array.isArray(template?.groupIds) ? template.groupIds : []),
    ...(typeof template?.groupId === "string" ? [template.groupId] : []),
  ];
  const groupIds = [BASE_USER_TEMPLATE_GROUP_ID];
  candidateGroupIds.forEach((groupId) => {
    const isAvailable = availableGroupIds
      ? availableGroupIds.has(groupId)
      : (typeof groupId === "string" && groupId.startsWith("user-group-"));
    if (isAvailable && groupId !== BASE_USER_TEMPLATE_GROUP_ID && !groupIds.includes(groupId)) {
      groupIds.push(groupId);
    }
  });
  return {
    id: typeof template?.id === "string" && template.id.startsWith("user-") ? template.id : createTemplateId(),
    label: normalizeTemplateName(template?.label),
    paperId,
    description: normalizeTemplateDescription(template?.description),
    typography: cloneTypography(template?.typography),
    presentation: normalizeTemplatePresentation(template?.presentation),
    groupIds,
    userTemplate: true,
  };
}

function createUserTemplate(baseTemplate = DEFAULT_LETTER_TEMPLATES[0], groupIds = [BASE_USER_TEMPLATE_GROUP_ID]) {
  return normalizeUserTemplate({
    id: createTemplateId(),
    label: `${baseTemplate.label || "信笺模板"} 副本`,
    paperId: baseTemplate.paperId,
    description: "用户模板/可编辑",
    typography: cloneTypography(baseTemplate.typography),
    presentation: normalizeTemplatePresentation(baseTemplate.presentation),
    groupIds,
  });
}

function loadUserLetterTemplates(userTemplateGroups) {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(USER_TEMPLATE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    const acceptedTemplates = [...DEFAULT_LETTER_TEMPLATES];
    return parsed.map((template) => {
      const normalized = normalizeUserTemplate(template, userTemplateGroups);
      const uniqueTemplate = {
        ...normalized,
        label: createUniqueTemplateName(normalized.label, acceptedTemplates),
      };
      acceptedTemplates.push(uniqueTemplate);
      return uniqueTemplate;
    });
  } catch {
    return [];
  }
}

function saveUserLetterTemplates(templates, userTemplateGroups) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    USER_TEMPLATE_STORAGE_KEY,
    JSON.stringify(templates.map((template) => normalizeUserTemplate(template, userTemplateGroups))),
  );
}

function normalizeNewDocumentTemplateId(templateId, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  return letterTemplates.some((template) => template.id === templateId)
    ? templateId
    : DEFAULT_LETTER_TEMPLATES[0].id;
}

function loadNewDocumentTemplateId(letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  if (typeof window === "undefined") {
    return DEFAULT_LETTER_TEMPLATES[0].id;
  }
  return normalizeNewDocumentTemplateId(
    window.localStorage.getItem(NEW_DOCUMENT_TEMPLATE_STORAGE_KEY),
    letterTemplates,
  );
}

function saveNewDocumentTemplateId(templateId) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(NEW_DOCUMENT_TEMPLATE_STORAGE_KEY, templateId);
}

function normalizeNewDocumentTemplateHistory(history, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  if (!Array.isArray(history)) {
    return [];
  }
  const availableTemplateIds = new Set(letterTemplates.map((template) => template.id));
  return history
    .filter((templateId) => typeof templateId === "string" && availableTemplateIds.has(templateId))
    .slice(-24);
}

function loadNewDocumentTemplateHistory(letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(NEW_DOCUMENT_TEMPLATE_HISTORY_STORAGE_KEY);
    return normalizeNewDocumentTemplateHistory(raw ? JSON.parse(raw) : [], letterTemplates);
  } catch {
    return [];
  }
}

function saveNewDocumentTemplateHistory(history) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(NEW_DOCUMENT_TEMPLATE_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function loadSessionState() {
  if (typeof window === "undefined") {
    return { folderPath: "", activePath: "", tabs: [] };
  }
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs
        .map((tab) => ({ path: typeof tab?.path === "string" ? tab.path : "" }))
        .filter((tab) => tab.path)
      : [];
    return {
      folderPath: typeof parsed.folderPath === "string" ? parsed.folderPath : "",
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : "",
      tabs,
    };
  } catch {
    return { folderPath: "", activePath: "", tabs: [] };
  }
}

function saveSessionState(state) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    folderPath: typeof state.folderPath === "string" ? state.folderPath : "",
    activePath: typeof state.activePath === "string" ? state.activePath : "",
    tabs: Array.isArray(state.tabs)
      ? state.tabs
        .map((tab) => ({ path: typeof tab?.path === "string" ? tab.path : "" }))
        .filter((tab) => tab.path)
      : [],
    updatedAt: new Date().toISOString(),
  }));
}

function getLastAutoUpdateCheckAt() {
  if (typeof window === "undefined") {
    return 0;
  }
  try {
    return Number(window.localStorage.getItem(UPDATE_AUTO_CHECK_STORAGE_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}

function saveLastAutoUpdateCheckAt(value = Date.now()) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(UPDATE_AUTO_CHECK_STORAGE_KEY, String(value));
  } catch {
    // localStorage may be unavailable; update checks can still be run manually.
  }
}

function getAiProviderDefaults(provider, config = {}) {
  const builtin = AI_PROVIDER_OPTIONS.find((option) => option.id === provider);
  if (builtin) return builtin;
  const protocol = AI_PROTOCOL_OPTIONS.some((option) => option.id === config.protocol) ? config.protocol : "openai";
  const protocolDefaults = AI_PROTOCOL_OPTIONS.find((option) => option.id === protocol) || AI_PROTOCOL_OPTIONS[0];
  return {
    id: provider,
    label: String(config.providerLabel || config.label || "自定义供应商").trim() || "自定义供应商",
    transport: "http",
    protocol,
    builtin: false,
    model: "",
    baseUrl: config.baseUrl || protocolDefaults.baseUrl,
  };
}

function createAiModelId(provider, model = "") {
  const source = String(model || "default").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${provider}-${source || "model"}`;
}

function createAiModelKey(provider, modelId) {
  return provider && modelId ? `${provider}::${modelId}` : "";
}

function parseAiModelKey(value = "") {
  const [provider, modelId] = String(value || "").split("::");
  return {
    provider,
    modelId: modelId || "",
  };
}

function normalizePublicAiModelConfig(provider, config = {}, index = 0) {
  const defaults = getAiProviderDefaults(provider, config);
  const model = String(config.model || defaults.model || "").trim();
  return {
    id: config.id || createAiModelId(provider, model || String(index + 1)),
    name: String(config.name || config.modelName || (index === 0 ? "默认模型" : `模型 ${index + 1}`)).trim() || `模型 ${index + 1}`,
    model,
    reasoningEffort: config.reasoningEffort || config.defaultReasoningEffort || "",
    defaultReasoningEffort: config.defaultReasoningEffort || "",
    supportedReasoningEfforts: Array.isArray(config.supportedReasoningEfforts) ? config.supportedReasoningEfforts : [],
    description: config.description || "",
    catalogManaged: Boolean(config.catalogManaged),
    testedOk: Boolean(config.testedOk),
    testedAt: config.testedAt || "",
    testMessage: config.testMessage || "",
  };
}

function normalizePublicAiProviderConfig(provider, config = {}) {
  const defaults = getAiProviderDefaults(provider, config);
  const legacyModel = {
    id: config.activeModelId || createAiModelId(defaults.id, config.model || defaults.model),
    name: config.modelName || "默认模型",
    model: config.model || defaults.model,
    testedOk: config.testedOk,
    testedAt: config.testedAt,
    testMessage: config.testMessage,
  };
  const isCodex = defaults.transport === "codex-cli";
  let modelsSource = Array.isArray(config.models) ? config.models : ((defaults.builtin && !isCodex) || config.model ? [legacyModel] : []);
  if (defaults.builtin && !isCodex && modelsSource.length === 0) modelsSource = [legacyModel];
  const models = modelsSource.map((modelConfig, index) => normalizePublicAiModelConfig(defaults.id, modelConfig, index)).filter((model) => model.model);
  const activeModelId = config.activeModelId && models.some((model) => model.id === config.activeModelId)
    ? config.activeModelId
    : (models[0]?.id || "");
  const activeModel = models.find((model) => model.id === activeModelId) || models[0] || {};
  return {
    provider: defaults.id,
    providerLabel: defaults.label,
    transport: defaults.transport || config.transport || "http",
    protocol: defaults.protocol,
    builtin: defaults.builtin,
    baseUrl: config.baseUrl || defaults.baseUrl,
    hasApiKey: Boolean(config.hasApiKey),
    apiKeyLast4: config.apiKeyLast4 || "",
    activeModelId,
    models,
    modelId: activeModel.id || "",
    modelName: activeModel.name || "",
    model: activeModel.model || "",
    testedOk: Boolean(activeModel.testedOk),
    testedAt: activeModel.testedAt || "",
    testMessage: activeModel.testMessage || "",
    runtime: config.runtime || null,
  };
}

function normalizePublicAiConfig(config) {
  const providers = {};
  AI_PROVIDER_OPTIONS.forEach((option) => {
    providers[option.id] = normalizePublicAiProviderConfig(option.id, config?.providers?.[option.id] || (config?.provider === option.id ? config : {}));
  });
  Object.entries(config?.providers || {}).forEach(([provider, providerConfig]) => {
    if (!providers[provider]) providers[provider] = normalizePublicAiProviderConfig(provider, providerConfig);
  });
  const requestedActiveProvider = config?.activeProvider || config?.provider || "gemini";
  const activeProvider = providers[requestedActiveProvider] ? requestedActiveProvider : "gemini";
  const activeProviderConfig = providers[activeProvider] || providers.gemini;
  const requestedModelId = config?.activeModelId || config?.modelId || activeProviderConfig.activeModelId;
  const activeModel = activeProviderConfig.models.find((model) => model.id === requestedModelId) || activeProviderConfig.models[0] || {};
  const activeModelId = activeModel.id || "";
  return {
    ...DEFAULT_AI_CONFIG,
    activeProvider,
    activeModelId,
    activeModelKey: createAiModelKey(activeProvider, activeModelId),
    providers,
    provider: activeProviderConfig.provider,
    providerLabel: activeProviderConfig.providerLabel,
    protocol: activeProviderConfig.protocol,
    transport: activeProviderConfig.transport || "http",
    modelId: activeModel.id || "",
    modelName: activeModel.name || "",
    model: activeModel.model || "",
    baseUrl: activeProviderConfig.baseUrl,
    hasApiKey: activeProviderConfig.hasApiKey,
    apiKeyLast4: activeProviderConfig.apiKeyLast4,
    testedOk: Boolean(activeModel.testedOk),
    testedAt: activeModel.testedAt || "",
    testMessage: activeModel.testMessage || "",
  };
}

function getTestedAiProviders(config) {
  const normalized = normalizePublicAiConfig(config);
  return Object.values(normalized.providers).flatMap((providerConfig) => {
    if (providerConfig.transport === "codex-cli") {
      if (!providerConfig.runtime?.ready) return [];
    } else if (!providerConfig.hasApiKey) {
      return [];
    }
    return providerConfig.models
      .filter((model) => model.testedOk)
      .map((model) => ({
        id: createAiModelKey(providerConfig.provider, model.id),
        provider: providerConfig.provider,
        providerLabel: providerConfig.providerLabel,
        protocol: providerConfig.protocol,
        transport: providerConfig.transport || "http",
        builtin: providerConfig.builtin,
        modelId: model.id,
        modelName: model.name,
        model: model.model,
        label: providerConfig.providerLabel,
        baseUrl: providerConfig.baseUrl,
      }));
  });
}

function getAiProviderRuntimeConfig(config, modelKey) {
  const normalized = normalizePublicAiConfig(config);
  const parsed = parseAiModelKey(modelKey || normalized.activeModelKey);
  const providerId = normalized.providers[parsed.provider] ? parsed.provider : normalized.activeProvider;
  const providerConfig = normalized.providers[providerId] || normalizePublicAiProviderConfig(providerId);
  const model = providerConfig.models.find((item) => item.id === parsed.modelId)
    || providerConfig.models.find((item) => item.id === normalized.activeModelId)
    || providerConfig.models[0]
    || {};
  return {
    ...normalized,
    provider: providerId,
    providerLabel: providerConfig.providerLabel,
    baseUrl: providerConfig.baseUrl,
    hasApiKey: providerConfig.hasApiKey,
    apiKeyLast4: providerConfig.apiKeyLast4,
    protocol: providerConfig.protocol,
    transport: providerConfig.transport || "http",
    modelId: model.id || "",
    modelName: model.name || "",
    model: model.model || "",
    testedOk: Boolean(model.testedOk),
    testedAt: model.testedAt || "",
    testMessage: model.testMessage || "",
    activeProvider: normalized.activeProvider,
  };
}

function createAiRequestId() {
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function textFromJsonNode(node) {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.text || "";
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  return (node.content || []).map(textFromJsonNode).join("");
}

function quoteTextFromNode(node) {
  const parts = (node.content || [])
    .map((child) => textFromJsonNode(child).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (parts.length > 1) {
    const source = parts[parts.length - 1].replace(/^[-—–]+\s*/, "").trim();
    return [...parts.slice(0, -1), source].filter(Boolean).join(" —— ");
  }
  return parts.join(" —— ");
}

function listTextFromNode(node, level = 0) {
  const lines = [];
  (node.content || []).forEach((child, index) => {
    if (child.type === "listItem") {
      const itemText = (child.content || [])
        .filter((itemChild) => itemChild.type !== "bulletList" && itemChild.type !== "orderedList")
        .map(textFromJsonNode)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (itemText) {
        const prefix = node.type === "orderedList" ? `${index + 1}. ` : "- ";
        lines.push(`${"  ".repeat(level)}${prefix}${itemText}`);
      }
      (child.content || [])
        .filter((itemChild) => itemChild.type === "bulletList" || itemChild.type === "orderedList")
        .forEach((nestedList) => {
          const nested = listTextFromNode(nestedList, level + 1);
          if (nested) {
            lines.push(nested);
          }
        });
    }
  });
  return lines.filter(Boolean).join("\n");
}

function tableTextFromNode(node) {
  const rows = (node.content || [])
    .filter((child) => child.type === "tableRow")
    .map((row) => (row.content || [])
      .filter((cell) => cell.type === "tableCell" || cell.type === "tableHeader")
      .map((cell) => textFromJsonNode(cell).replace(/\s+/g, " ").trim()));
  if (!rows.length || !rows.some((row) => row.some(Boolean))) {
    return "";
  }
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizeRow = (row) => {
    const normalized = row.slice(0, columnCount);
    while (normalized.length < columnCount) {
      normalized.push("");
    }
    return normalized.map((cell) => cell.replace(/\|/g, "\\|"));
  };
  const [firstRow, ...bodyRows] = rows.map(normalizeRow);
  const divider = Array.from({ length: columnCount }, () => "---");
  return [firstRow, divider, ...bodyRows]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function editorHasNodeType(editor, typeName) {
  let found = false;
  editor?.state?.doc?.descendants((node) => {
    if (node.type.name === typeName) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

function extractAiBodyContent(editor, { includeFinalizedBoundary = true, includeImageCaptions = true } = {}) {
  const json = editor?.getJSON?.();
  const rootBlocks = json?.content || [];
  const lines = [];
  const assets = { images: {}, quotes: [] };
  let imageIndex = 0;
  let skipNextTocList = false;
  let finalizedBoundaryIndex = -1;

  const pushLine = (line) => {
    if (line) {
      lines.push(line);
    }
  };

  rootBlocks.forEach((node) => {
    if (skipNextTocList && (node.type === "bulletList" || node.type === "orderedList")) {
      skipNextTocList = false;
      return;
    }
    skipNextTocList = false;

    if (node.type === "paperFinalizedBreak") {
      if (includeFinalizedBoundary) {
        finalizedBoundaryIndex = lines.length;
      }
      return;
    }

    if (node.type === "paperPageBreak") {
      return;
    }

    if (node.type === "paperHorizontalRule") {
      pushLine("---");
      return;
    }

    if (node.type === "paperTableOfContents") {
      return;
    }

    if (node.type === "heading") {
      const text = textFromJsonNode(node).replace(/\s+/g, " ").trim();
      if (!text) {
        return;
      }
      if (text === "目录") {
        skipNextTocList = true;
        return;
      }
      const level = Math.max(1, Math.min(3, Number(node.attrs?.level) || 1));
      pushLine(`${"#".repeat(level)} ${text}`);
      return;
    }

    if (node.type === "paragraph") {
      const text = textFromJsonNode(node).replace(/\s+/g, " ").trim();
      pushLine(text);
      return;
    }

    if (node.type === "blockquote") {
      const quote = quoteTextFromNode(node);
      if (quote) {
        assets.quotes.push({ text: quote });
        pushLine(`[引用：${quote}]`);
      }
      return;
    }

    if (node.type === "image") {
      imageIndex += 1;
      const caption = includeImageCaptions
        ? (node.attrs?.caption || node.attrs?.alt || "图片").trim()
        : "图片";
      assets.images[imageIndex] = {
        number: imageIndex,
        caption,
        src: node.attrs?.src || "",
        alt: node.attrs?.alt || caption,
        width: node.attrs?.width || "78%",
      };
      pushLine(includeImageCaptions ? `[图${imageIndex}.${caption}]` : "[图片]");
      return;
    }

    if (node.type === "paperMedia") {
      const kind = node.attrs?.kind === "video" ? "视频" : "音频";
      const fileName = String(node.attrs?.fileName || `未命名${kind}`).trim();
      pushLine(`[${kind}：${fileName}]`);
      return;
    }

    if (node.type === "table") {
      pushLine(tableTextFromNode(node));
      return;
    }

    if (node.type === "bulletList" || node.type === "orderedList") {
      const listText = listTextFromNode(node);
      pushLine(listText);
    }
  });

  const hasFinalizedBoundary = finalizedBoundaryIndex >= 0;
  if (hasFinalizedBoundary) {
    lines.splice(finalizedBoundaryIndex, 0, AI_FINALIZED_END);
    lines.unshift(AI_FINALIZED_START);
  }
  const body = lines.join("\n\n").trim();
  return { body, assets, json, hasFinalizedBoundary };
}

function imageMimeFromSource(source = "") {
  const dataMime = /^data:(image\/[a-z0-9.+-]+);/i.exec(source)?.[1];
  if (dataMime) return dataMime.toLowerCase();
  const extension = /(?:\.|%2e)(png|jpe?g|gif|webp|bmp|svg)(?:$|[?&#%])/i.exec(source)?.[1]?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "svg") return "image/svg+xml";
  return extension ? `image/${extension}` : "";
}

function aiChatImagesFromAssets(assets = {}) {
  return Object.values(assets.images || {}).map((image, index) => ({
    number: Math.max(1, Number(image?.number) || index + 1),
    caption: String(image?.caption || image?.alt || "图片").trim() || "图片",
    src: typeof image?.src === "string" ? image.src : "",
    mime: imageMimeFromSource(image?.src || ""),
  }));
}

function countEditorImages(editor) {
  let count = 0;
  editor?.state?.doc?.descendants((node) => {
    if (node.type?.name === "image") count += 1;
  });
  return count;
}

function buildAiPromptInput(editor, presentation = DEFAULT_TEMPLATE_PRESENTATION) {
  const normalizedPresentation = normalizeTemplatePresentation(presentation);
  const { body, assets, hasFinalizedBoundary } = extractAiBodyContent(editor, {
    includeFinalizedBoundary: true,
    includeImageCaptions: normalizedPresentation.showImageCaptions,
  });
  const promptParts = hasFinalizedBoundary
    ? [AI_PROMPT_PREFIX, AI_FINALIZED_INSTRUCTION, body]
    : [AI_PROMPT_PREFIX, body];
  return {
    body,
    prompt: promptParts.filter(Boolean).join("\n\n"),
    assets,
  };
}

function buildAiChatContextSignature(editor, document, presentation = DEFAULT_TEMPLATE_PRESENTATION) {
  const json = editor?.getJSON?.();
  const title = (document?.title || "未命名信笺").trim();
  const author = (document?.author || "").trim();
  const displayDate = (document?.displayDate || "").trim();
  return JSON.stringify({
    title,
    author,
    displayDate,
    showImageCaptions: normalizeTemplatePresentation(presentation).showImageCaptions,
    content: json?.content || [],
  });
}

function buildAiChatContextInput(editor, document, presentation = DEFAULT_TEMPLATE_PRESENTATION, signature = "") {
  const normalizedPresentation = normalizeTemplatePresentation(presentation);
  const { body, assets } = extractAiBodyContent(editor, {
    includeFinalizedBoundary: false,
    includeImageCaptions: true,
  });
  const title = (document?.title || "未命名信笺").trim();
  const author = (document?.author || "").trim();
  const displayDate = (document?.displayDate || "").trim();
  const metaLines = [
    `标题：${title}`,
    author ? `署名：${author}` : "",
    displayDate ? `日期：${displayDate}` : "",
  ].filter(Boolean);
  const context = `${metaLines.join("\n")}\n\n正文：\n${body || "（正文为空）"}`.trim();
  return {
    context,
    images: aiChatImagesFromAssets(assets),
    signature: signature || buildAiChatContextSignature(editor, document, normalizedPresentation),
  };
}

function summarizeSelectedText(text, maxLength = 34) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function summarizeChatMessage(text, maxLength = 74) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) {
    return "正在思考...";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function formatChatMessageTime(message) {
  const match = String(message?.id || "").match(/^[^-]+-([a-z0-9]+)/i);
  const timestamp = Number(message?.createdAt) || (match ? parseInt(match[1], 36) : 0);
  const date = Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : new Date();
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function createAiChatSelectionId() {
  return `selection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function splitQuoteForDisplay(text) {
  const value = String(text || "").trim();
  const parts = value.split(/\s+——\s+/);
  if (parts.length <= 1) {
    return { bodyParts: value ? [value] : [], source: "" };
  }
  const source = parts.pop();
  const bodyParts = parts.map((part) => part.trim()).filter(Boolean);
  return { bodyParts, source };
}

function splitMarkdownTableRow(line) {
  const value = String(line || "").trim();
  if (!value.includes("|")) {
    return [];
  }
  const trimmed = value.replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cell = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function isMarkdownTableDivider(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function isMarkdownTableStart(lines, index) {
  const current = lines[index]?.trim() || "";
  const next = lines[index + 1]?.trim() || "";
  return current.includes("|") && splitMarkdownTableRow(current).length > 1 && isMarkdownTableDivider(next);
}

function normalizeMarkdownTableRow(cells, width) {
  const normalized = cells.slice(0, width);
  while (normalized.length < width) {
    normalized.push("");
  }
  return normalized;
}

function parseAiResponseBlocks(text, assets = { images: {} }) {
  const blocks = [];
  let paragraphLines = [];
  let listBlock = null;
  const flushParagraph = () => {
    const textValue = paragraphLines.join("\n").trim();
    if (textValue) {
      blocks.push({ type: "paragraph", text: textValue });
    }
    paragraphLines = [];
  };
  const flushList = () => {
    if (listBlock?.items?.length) {
      blocks.push(listBlock);
    }
    listBlock = null;
  };
  const pushListItem = (type, item) => {
    flushParagraph();
    if (!listBlock || listBlock.type !== type) {
      flushList();
      listBlock = { type, items: [] };
    }
    listBlock.items.push(item);
  };

  const lines = String(text || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (isMarkdownTableStart(lines, index)) {
      flushParagraph();
      flushList();
      const headers = splitMarkdownTableRow(line);
      const width = headers.length;
      const rows = [];
      index += 2;
      while (index < lines.length) {
        const rowLine = lines[index].trim();
        if (!rowLine || !rowLine.includes("|") || isMarkdownTableDivider(rowLine)) {
          index -= 1;
          break;
        }
        const cells = splitMarkdownTableRow(rowLine);
        if (cells.length < 2) {
          index -= 1;
          break;
        }
        rows.push(normalizeMarkdownTableRow(cells, width));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "divider" });
      continue;
    }
    const imageMatch = line.match(/^\[图\s*(\d+)\.\s*([^\]]*)\]$/);
    if (imageMatch) {
      flushParagraph();
      flushList();
      const number = Number(imageMatch[1]);
      const asset = assets.images?.[number];
      blocks.push({
        type: "image",
        number,
        caption: imageMatch[2]?.trim() || asset?.caption || "图片",
        asset,
      });
      continue;
    }
    const quoteMatch = line.match(/^\[引用[:：]\s*([\s\S]*?)\]$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: quoteMatch[1].trim() });
      continue;
    }
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: Math.min(3, headingMatch[1].length), text: headingMatch[2].trim() });
      continue;
    }
    const orderedListMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (orderedListMatch) {
      pushListItem("orderedList", {
        number: Number(orderedListMatch[1]),
        text: orderedListMatch[2].trim(),
      });
      continue;
    }
    const bulletListMatch = line.match(/^[-+*]\s+(.+)$/);
    if (bulletListMatch) {
      pushListItem("bulletList", { text: bulletListMatch[1].trim() });
      continue;
    }
    flushList();
    paragraphLines.push(rawLine);
  }
  flushParagraph();
  flushList();
  return blocks;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function splitInlineMarkdown(text) {
  const parts = [];
  const value = String(text || "");
  let lastIndex = 0;
  let index = 0;
  const pushPlain = (endIndex) => {
    if (endIndex > lastIndex) {
      parts.push({ text: value.slice(lastIndex, endIndex) });
    }
  };

  while (index < value.length) {
    if (value.startsWith("**", index)) {
      const endIndex = value.indexOf("**", index + 2);
      if (endIndex > index + 2) {
        pushPlain(index);
        parts.push({ text: value.slice(index + 2, endIndex), strong: true });
        index = endIndex + 2;
        lastIndex = index;
        continue;
      }
    }

    if (value[index] === "*" && value[index - 1] !== "*" && value[index + 1] !== "*") {
      let endIndex = -1;
      for (let candidate = index + 1; candidate < value.length; candidate += 1) {
        if (value[candidate] === "*" && value[candidate - 1] !== "*" && value[candidate + 1] !== "*") {
          endIndex = candidate;
          break;
        }
      }
      const emphasisText = endIndex > index + 1 ? value.slice(index + 1, endIndex).trim() : "";
      if (emphasisText) {
        pushPlain(index);
        parts.push({ text: emphasisText, emphasis: true });
        index = endIndex + 1;
        lastIndex = index;
        continue;
      }
    }

    index += 1;
  }

  if (lastIndex < value.length) {
    parts.push({ text: value.slice(lastIndex) });
  }
  return parts.length ? parts : [{ text: value }];
}

function splitStrongMarkdown(text) {
  return splitInlineMarkdown(text);
}

function stripStrongMarkdown(text) {
  return splitInlineMarkdown(text).map((part) => part.text).join("");
}

function inlineStrongHtml(text) {
  return splitInlineMarkdown(text)
    .map((part) => {
      if (part.strong) {
        return `<strong>${escapeHtml(part.text)}</strong>`;
      }
      if (part.emphasis) {
        return `<em>${escapeHtml(part.text)}</em>`;
      }
      return escapeHtml(part.text);
    })
    .join("");
}

function aiBlockPlainText(block) {
  if (block.type === "divider") {
    return "---";
  }
  if (block.type === "orderedList") {
    return block.items.map((item, index) => `${item.number || index + 1}. ${stripStrongMarkdown(item.text)}`).join("\n");
  }
  if (block.type === "bulletList") {
    return block.items.map((item) => `- ${stripStrongMarkdown(item.text)}`).join("\n");
  }
  if (block.type === "table") {
    const header = block.headers.map(stripStrongMarkdown).join("\t");
    const rows = block.rows.map((row) => row.map(stripStrongMarkdown).join("\t"));
    return [header, ...rows].filter(Boolean).join("\n");
  }
  if (block.type === "image") {
    return `图${block.number}. ${block.caption}`;
  }
  if (block.type === "quote") {
    return `引用：${stripStrongMarkdown(block.text)}`;
  }
  return stripStrongMarkdown(block.text || "");
}

function aiBlockHtml(block) {
  if (block.type === "divider") {
    return "<hr>";
  }
  if (block.type === "orderedList") {
    return `<ol>${block.items.map((item, index) => `<li value="${Number(item.number) || index + 1}">${inlineStrongHtml(item.text)}</li>`).join("")}</ol>`;
  }
  if (block.type === "bulletList") {
    return `<ul>${block.items.map((item) => `<li>${inlineStrongHtml(item.text)}</li>`).join("")}</ul>`;
  }
  if (block.type === "table") {
    const headers = block.headers || [];
    const rows = block.rows || [];
    return `<table><thead><tr>${headers.map((cell) => `<th>${inlineStrongHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineStrongHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  if (block.type === "image") {
    const src = block.asset?.src || "";
    const caption = `图${block.number}. ${block.caption}`;
    return src
      ? `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(block.asset?.alt || block.caption)}"><figcaption>${escapeHtml(caption)}</figcaption></figure>`
      : `<p>${escapeHtml(caption)}</p>`;
  }
  if (block.type === "quote") {
    const { bodyParts, source } = splitQuoteForDisplay(block.text);
    const bodyHtml = bodyParts.map((part) => `<p>${inlineStrongHtml(part)}</p>`).join("");
    return `<blockquote>${bodyHtml}${source ? `<p>—— ${inlineStrongHtml(source)}</p>` : ""}</blockquote>`;
  }
  if (block.type === "heading") {
    const tag = `h${Math.max(1, Math.min(3, block.level || 2))}`;
    return `<${tag}>${inlineStrongHtml(block.text)}</${tag}>`;
  }
  return `<p>${inlineStrongHtml(block.text).replace(/\n/g, "<br>")}</p>`;
}

function estimateTokenCount(text) {
  const value = String(text || "");
  const chineseChars = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const latinWords = (value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  const symbols = Math.max(0, value.length - chineseChars);
  return Math.max(1, Math.round(chineseChars * 1.15 + latinWords * 1.25 + symbols / 4));
}

function formatTokenCount(value) {
  const tokens = Number(value) || 0;
  const unit = tokens >= 1_000_000 ? "M" : "K";
  const divisor = unit === "M" ? 1_000_000 : 1_000;
  const amount = tokens / divisor;
  return `${amount.toFixed(3).replace(/\.?0+$/, "")}${unit}`;
}

function getAiUsageTotalTokens(usage) {
  if (!usage || typeof usage !== "object") {
    return 0;
  }
  return Number(usage.total_tokens || usage.totalTokens || 0);
}

function getAiUsageCachedTokens(usage) {
  if (!usage || typeof usage !== "object") {
    return 0;
  }
  const promptDetails = usage.prompt_tokens_details || usage.promptTokensDetails || usage.input_tokens_details || usage.inputTokensDetails || {};
  const promptTokenDetails = usage.prompt_token_details || usage.promptTokenDetails || usage.input_token_details || usage.inputTokenDetails || {};
  const usageMetadata = usage.usage_metadata || usage.usageMetadata || {};
  const candidates = [
    usage.cached_tokens,
    usage.cachedTokens,
    usage.cached_content_token_count,
    usage.cachedContentTokenCount,
    usage.cache_read_input_tokens,
    usage.cacheReadInputTokens,
    promptDetails.cached_tokens,
    promptDetails.cachedTokens,
    promptDetails.cached_content_token_count,
    promptDetails.cachedContentTokenCount,
    promptDetails.cache_read_input_tokens,
    promptDetails.cacheReadInputTokens,
    promptTokenDetails.cached_tokens,
    promptTokenDetails.cachedTokens,
    promptTokenDetails.cached_content_token_count,
    promptTokenDetails.cachedContentTokenCount,
    promptTokenDetails.cache_read_input_tokens,
    promptTokenDetails.cacheReadInputTokens,
    usageMetadata.cached_tokens,
    usageMetadata.cachedTokens,
    usageMetadata.cached_content_token_count,
    usageMetadata.cachedContentTokenCount,
  ];
  return candidates.reduce((max, value) => Math.max(max, Number(value) || 0), 0);
}

function formatTokenUsage(totalTokens, estimated = false, cachedTokens = 0) {
  const totalLabel = totalTokens ? `${estimated ? "约 " : ""}${formatTokenCount(totalTokens)}` : "等待统计";
  const cachedLabel = cachedTokens > 0 ? `（缓存：${formatTokenCount(cachedTokens)}）` : "";
  return `${totalLabel}${cachedLabel}`;
}

function formatElapsedSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  return `${seconds.toFixed(1)} s`;
}

async function copyAiBlockToClipboard(block) {
  const html = aiBlockHtml(block);
  const text = aiBlockPlainText(block);
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  await navigator.clipboard?.writeText?.(text);
}

function chatMessagesToMarkdown(document, messages) {
  const title = document?.title || "未命名信笺";
  const lines = [
    `# ${title} - AI问答`,
    "",
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
  ];
  messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .forEach((message) => {
      lines.push(`## ${message.role === "user" ? "我" : "AI"}`);
      lines.push("");
      lines.push((message.content || "").trim() || "（空）");
      lines.push("");
    });
  return `${lines.join("\n").trimEnd()}\n`;
}

function createEmptyAiOptimizeState() {
  return {
    output: "",
    status: "ready",
    error: "",
    assets: { images: {}, quotes: [] },
    elapsedSeconds: 0,
    tokenStats: null,
    provider: "",
    modelId: "",
    modelName: "",
    updatedAt: "",
  };
}

function createEmptyAiChatState() {
  return {
    messages: [],
    input: "",
    selectedTexts: [],
    codexScope: normalizeCodexScope(),
    codexImageMode: normalizeCodexImageMode(),
    status: "idle",
    error: "",
    updatedAt: "",
  };
}

function normalizeAiOptimizeState(state = {}) {
  const status = ["ready", "streaming", "done", "error", "idle"].includes(state.status)
    ? state.status
    : "ready";
  const assets = state.assets && typeof state.assets === "object" ? state.assets : {};
  return {
    ...createEmptyAiOptimizeState(),
    ...state,
    output: typeof state.output === "string" ? state.output : "",
    status,
    error: typeof state.error === "string" ? state.error : "",
    assets: {
      images: assets.images && typeof assets.images === "object" ? assets.images : {},
      quotes: Array.isArray(assets.quotes) ? assets.quotes : [],
    },
    elapsedSeconds: Number.isFinite(Number(state.elapsedSeconds)) ? Math.max(0, Number(state.elapsedSeconds)) : 0,
    tokenStats: state.tokenStats && typeof state.tokenStats === "object" ? state.tokenStats : null,
    provider: typeof state.provider === "string" ? state.provider : "",
    modelId: typeof state.modelId === "string" ? state.modelId : "",
    modelName: typeof state.modelName === "string" ? state.modelName : "",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

function normalizeAiChatMessage(message = {}) {
  return {
    id: typeof message.id === "string" && message.id ? message.id : `message-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    role: message.role === "assistant" ? "assistant" : "user",
    content: typeof message.content === "string" ? message.content : "",
    status: typeof message.status === "string" ? message.status : "done",
    elapsedSeconds: Number.isFinite(Number(message.elapsedSeconds)) ? Math.max(0, Number(message.elapsedSeconds)) : 0,
    createdAt: Number.isFinite(Number(message.createdAt)) ? Number(message.createdAt) : Date.now(),
    usage: Number.isFinite(Number(message.usage)) ? Number(message.usage) : undefined,
    usageEstimated: Boolean(message.usageEstimated),
    cachedTokens: Number.isFinite(Number(message.cachedTokens)) ? Number(message.cachedTokens) : undefined,
  };
}

function normalizeAiChatSelection(selection = {}) {
  return {
    ...selection,
    id: typeof selection.id === "string" && selection.id ? selection.id : createAiChatSelectionId(),
    text: typeof selection.text === "string" ? selection.text : "",
    from: Number.isFinite(Number(selection.from)) ? Number(selection.from) : 1,
    to: Number.isFinite(Number(selection.to)) ? Number(selection.to) : 1,
  };
}

function normalizeAiChatState(state = {}) {
  return {
    ...createEmptyAiChatState(),
    ...state,
    messages: Array.isArray(state.messages) ? state.messages.map(normalizeAiChatMessage) : [],
    input: typeof state.input === "string" ? state.input : "",
    selectedTexts: Array.isArray(state.selectedTexts) ? state.selectedTexts.map(normalizeAiChatSelection).filter((selection) => selection.text) : [],
    codexScope: normalizeCodexScope(state.codexScope),
    codexImageMode: normalizeCodexImageMode(state.codexImageMode),
    status: ["idle", "streaming", "error"].includes(state.status) ? state.status : "idle",
    error: typeof state.error === "string" ? state.error : "",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

function createEmptyAiState() {
  return {
    version: 3,
    lastMode: "",
    optimize: createEmptyAiOptimizeState(),
    chat: createEmptyAiChatState(),
  };
}

function normalizeAiState(state = {}) {
  return {
    version: 3,
    lastMode: ["optimize", "chat"].includes(state.lastMode) ? state.lastMode : "",
    optimize: normalizeAiOptimizeState(state.optimize),
    chat: normalizeAiChatState(state.chat),
  };
}

function mergeAiStatePatch(aiState, patchOrUpdater) {
  const previous = normalizeAiState(aiState);
  const patched = typeof patchOrUpdater === "function" ? patchOrUpdater(previous) : { ...previous, ...patchOrUpdater };
  return normalizeAiState(patched);
}

function listFolderWithTimeout(folderPath) {
  let timer = 0;
  const startedAt = Date.now();
  bridge.debugLog?.("renderer:list-folder:start", { folderPath });
  const timeout = new Promise((resolve) => {
    timer = window.setTimeout(() => {
      bridge.debugLog?.("renderer:list-folder:timeout", {
        folderPath,
        ms: Date.now() - startedAt,
      });
      resolve({
        canceled: true,
        timedOut: true,
        folderPath,
        files: [],
        folders: [],
        entries: [],
      });
    }, FOLDER_LIST_TIMEOUT_MS);
  });
  return Promise.race([bridge.listFolder(folderPath), timeout])
    .then((result) => {
      bridge.debugLog?.("renderer:list-folder:done", {
        folderPath,
        ms: Date.now() - startedAt,
        canceled: Boolean(result?.canceled),
        timedOut: Boolean(result?.timedOut),
        folders: result?.folders?.length || 0,
        files: result?.files?.length || 0,
      });
      return result;
    })
    .finally(() => {
      window.clearTimeout(timer);
    });
}

function createBlankDocument(
  letterTemplates = DEFAULT_LETTER_TEMPLATES,
  preferredTemplateId = DEFAULT_LETTER_TEMPLATES[0].id,
) {
  const normalizedTemplateId = normalizeNewDocumentTemplateId(preferredTemplateId, letterTemplates);
  const letterTemplate = letterTemplates.find((template) => template.id === normalizedTemplateId)
    || DEFAULT_LETTER_TEMPLATES[0];
  const now = new Date().toISOString();
  return {
    version: 1,
    title: "未命名信笺",
    author: "",
    html: "<p></p>",
    letterTemplateId: letterTemplate.id,
    templateId: letterTemplate.paperId,
    fontFamily: letterTemplate.typography.bodyFont,
    fontSize: letterTemplate.typography.bodySize,
    layoutMode: LAYOUT_MODES.FLOW,
    customBackground: "",
    comments: [],
    aiState: createEmptyAiState(),
    createdAt: now,
    displayDate: formatPaperDate(now),
    updatedAt: now,
  };
}

function createDocumentCommentId() {
  return `comment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDocumentComments(comments = []) {
  if (!Array.isArray(comments)) {
    return [];
  }
  const seen = new Set();
  return comments
    .map((comment) => {
      const from = Math.max(1, Math.floor(Number(comment?.from) || 0));
      const to = Math.max(1, Math.floor(Number(comment?.to) || 0));
      const text = typeof comment?.text === "string" ? comment.text.trim().slice(0, 2000) : "";
      if (!text || from === to) {
        return null;
      }
      const idSource = typeof comment?.id === "string" && comment.id.trim()
        ? comment.id.trim()
        : createDocumentCommentId();
      const id = seen.has(idSource) ? createDocumentCommentId() : idSource;
      seen.add(id);
      const createdAt = typeof comment?.createdAt === "string" && comment.createdAt ? comment.createdAt : new Date().toISOString();
      const updatedAt = typeof comment?.updatedAt === "string" && comment.updatedAt ? comment.updatedAt : createdAt;
      return {
        id,
        from: Math.min(from, to),
        to: Math.max(from, to),
        text,
        quote: typeof comment?.quote === "string" ? comment.quote.trim().slice(0, 280) : "",
        createdAt,
        updatedAt,
      };
    })
    .filter(Boolean);
}

function mapDocumentCommentsThroughTransaction(comments = [], transaction, maxPosition = 1) {
  const normalized = normalizeDocumentComments(comments);
  if (!transaction?.docChanged) {
    return normalized;
  }
  return normalized
    .map((comment) => {
      const fromResult = transaction.mapping.mapResult(comment.from, 1);
      const toResult = transaction.mapping.mapResult(comment.to, -1);
      const from = Math.max(1, Math.min(fromResult.pos, maxPosition));
      const to = Math.max(1, Math.min(toResult.pos, maxPosition));
      if (fromResult.deleted && toResult.deleted) {
        return null;
      }
      if (from >= to) {
        return null;
      }
      return { ...comment, from, to };
    })
    .filter(Boolean);
}

function getCommentAnchorTop(editor, from) {
  if (!editor?.view) {
    return null;
  }
  try {
    const maxPosition = editor.state.doc.content.size;
    const resolvedFrom = Math.max(1, Math.min(Number(from) || 1, maxPosition));
    const coords = editor.view.coordsAtPos(resolvedFrom);
    return coords.top + Math.max(0, coords.bottom - coords.top) / 2;
  } catch {
    return null;
  }
}

function buildCommentAnchorTopMap(editor, comments = []) {
  const topById = new Map();
  normalizeDocumentComments(comments).forEach((comment) => {
    const top = getCommentAnchorTop(editor, comment.from);
    if (Number.isFinite(top)) {
      topById.set(comment.id, top);
    }
  });
  return topById;
}

function assignDocumentCommentPresentations(comments = [], anchorTopById = new Map()) {
  const sortedComments = normalizeDocumentComments(comments)
    .slice()
    .sort((a, b) => {
      const topA = anchorTopById.get(a.id);
      const topB = anchorTopById.get(b.id);
      if (Number.isFinite(topA) && Number.isFinite(topB) && topA !== topB) {
        return topA - topB;
      }
      return (a.from - b.from) || (a.to - b.to) || a.createdAt.localeCompare(b.createdAt);
    });
  const presentations = new Map();
  const placedAnchors = [];
  sortedComments.forEach((comment) => {
    const top = anchorTopById.get(comment.id);
    const usedTracks = new Set();
    if (Number.isFinite(top)) {
      placedAnchors.forEach((anchor) => {
        if (Math.abs(anchor.top - top) < COMMENT_ANCHOR_COLLISION_DISTANCE) {
          usedTracks.add(anchor.trackIndex);
        }
      });
    }
    let trackIndex = COMMENT_TRACKS.findIndex((_, index) => !usedTracks.has(index));
    if (trackIndex < 0) {
      trackIndex = COMMENT_TRACKS.length - 1;
    }
    const color = COMMENT_COLOR_PALETTE[trackIndex % COMMENT_COLOR_PALETTE.length];
    const presentation = {
      color,
      track: COMMENT_TRACKS[trackIndex],
      trackIndex,
    };
    presentations.set(comment.id, presentation);
    if (Number.isFinite(top)) {
      placedAnchors.push({
        id: comment.id,
        top,
        trackIndex,
      });
    }
  });
  return presentations;
}

function commentAnchorTrackAvailable(editor, comments = [], range) {
  const top = getCommentAnchorTop(editor, range?.from);
  if (!Number.isFinite(top)) {
    return true;
  }
  const topById = buildCommentAnchorTopMap(editor, comments);
  const presentations = assignDocumentCommentPresentations(comments, topById);
  const usedTracks = new Set();
  normalizeDocumentComments(comments).forEach((comment) => {
    const commentTop = topById.get(comment.id);
    const presentation = presentations.get(comment.id);
    if (Number.isFinite(commentTop) && presentation && Math.abs(commentTop - top) < COMMENT_ANCHOR_COLLISION_DISTANCE) {
      usedTracks.add(presentation.trackIndex);
    }
  });
  return COMMENT_TRACKS.some((_, index) => !usedTracks.has(index));
}

function normalizeDocument(document, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  const customBackground = document?.customBackground || "";
  const letterTemplateId = normalizeLetterTemplateId(document?.letterTemplateId, document?.templateId, letterTemplates);
  const letterTemplate = letterTemplates.find((template) => template.id === letterTemplateId) || DEFAULT_LETTER_TEMPLATES[0];
  const templateId = customBackground && document?.templateId === "custom" ? "custom" : letterTemplate.paperId;
  const createdAt = typeof document?.createdAt === "string" && document.createdAt
    ? document.createdAt
    : (typeof document?.updatedAt === "string" && document.updatedAt ? document.updatedAt : new Date().toISOString());
  const displayDate = typeof document?.displayDate === "string" && document.displayDate.trim()
    ? document.displayDate.trim().slice(0, 40)
    : formatPaperDate(createdAt);
  return {
    ...createBlankDocument(),
    ...document,
    title: document?.title?.trim() || "未命名信笺",
    author: typeof document?.author === "string" ? document.author.trim().slice(0, 40) : "",
    html: document?.html || "<p></p>",
    createdAt,
    displayDate,
    letterTemplateId,
    templateId,
    fontFamily: letterTemplate.typography.bodyFont,
    fontSize: letterTemplate.typography.bodySize,
    layoutMode: LAYOUT_MODES.FLOW,
    comments: normalizeDocumentComments(document?.comments),
    aiState: normalizeAiState(document?.aiState),
  };
}

function inferTitle(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 24) : "未命名信笺";
}

function displayNameFromPath(filePath) {
  return String(filePath || "").replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || String(filePath || "");
}

function pathIsSameOrInside(targetPath, parentPath) {
  const normalize = (value) => String(value || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const target = normalize(targetPath);
  const parent = normalize(parentPath);
  return Boolean(target && parent && (target === parent || target.startsWith(`${parent}\\`)));
}

function replacePathPrefix(targetPath, fromPath, toPath) {
  if (!pathIsSameOrInside(targetPath, fromPath)) {
    return targetPath;
  }
  if (targetPath === fromPath) {
    return toPath;
  }
  const separator = targetPath[fromPath.length] || "\\";
  const suffix = targetPath.slice(fromPath.length + (separator === "\\" || separator === "/" ? 1 : 0));
  return suffix ? `${toPath}\\${suffix}` : toPath;
}

function parentPathFromPath(filePath) {
  const normalized = String(filePath || "").replace(/\//g, "\\").replace(/\\+$/, "");
  const index = normalized.lastIndexOf("\\");
  return index > 0 ? normalized.slice(0, index) : "";
}

function documentRuntimeKey(pathValue, tabId = "") {
  return pathValue ? `path:${String(pathValue).replace(/\//g, "\\").toLowerCase()}` : `tab:${tabId || "untitled"}`;
}

function wordStats(text, html = "") {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWords = (text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  const paragraphs = text.split(/\n+/).filter((part) => part.trim()).length;
  const template = document.createElement("template");
  template.innerHTML = html || "";
  const images = template.content.querySelectorAll("img").length;
  const quotes = template.content.querySelectorAll("blockquote").length;
  const pageBreaks = template.content.querySelectorAll(".paper-page-break, [data-type='paper-page-break']").length;
  return {
    words: chineseChars + latinWords,
    paragraphs,
    images,
    quotes,
    pageBreaks,
    pages: pageBreaks + 1,
  };
}

function statsTextFromHtml(html = "") {
  const template = document.createElement("template");
  template.innerHTML = html || "<p></p>";
  const blocks = Array.from(template.content.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th"));
  const text = blocks
    .map((element) => element.textContent || "")
    .filter((value) => value.trim())
    .join("\n");
  return text || template.content.textContent || "";
}

function blockWeight(element) {
  const textLength = element.textContent?.trim().length || 0;
  const imageWeight = element.querySelectorAll("img").length * 320;
  const mediaWeight = element.matches("[data-type='paper-media']") || element.querySelector("audio, video") ? 260 : 0;
  const quoteWeight = element.matches("blockquote") ? 100 : 0;
  const headingWeight = /^H[1-6]$/.test(element.tagName) ? 80 : 0;
  return Math.max(80, textLength + imageWeight + mediaWeight + quoteWeight + headingWeight);
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
      <strong>
        <img src={ICON_ASSETS.brandMark} alt="" aria-hidden="true" />
        <span>笺间</span>
      </strong>
    </header>
  );
}

function IconButton({ icon: Icon, label, active, disabled = false, onClick }) {
  const isToggle = typeof active === "boolean";
  return (
    <button
      type="button"
      className={active ? "icon-button active" : "icon-button"}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={isToggle ? Boolean(active) : undefined}
    >
      <Icon size={17} strokeWidth={2.1} aria-hidden="true" />
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

function getSelectedPlainText(editor, savedSelectionRef) {
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
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.toggleHeading({ level, numberingMode: "inherit" }));
}

function getSelectedHeadingNode(editor, savedSelectionRef) {
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

function toggleSelectedHeadingNumbering(editor, savedSelectionRef) {
  const heading = getSelectedHeadingNode(editor, savedSelectionRef);
  if (!heading) {
    return;
  }
  const level = Math.max(1, Math.min(3, Number(heading.node.attrs.level) || 1));
  const pluginState = HEADING_NUMBERING_PLUGIN_KEY.getState(editor.state);
  const inheritedNumbering = pluginState?.defaults?.[level] !== false;
  const mode = ["inherit", "on", "off"].includes(heading.node.attrs.numberingMode)
    ? heading.node.attrs.numberingMode
    : "inherit";
  const effectiveNumbering = mode === "on" || (mode === "inherit" && inheritedNumbering);
  const nextMode = mode === "inherit" ? (effectiveNumbering ? "off" : "on") : "inherit";
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.updateAttributes("heading", { numberingMode: nextMode }));
}

function insertPageBreak(editor, savedSelectionRef) {
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.insertContent({ type: "paperPageBreak" }));
}

function insertHorizontalRule(editor, savedSelectionRef) {
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.insertContent({ type: "paperHorizontalRule" }));
}

function insertBasicTable(editor, savedSelectionRef) {
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }));
}

function normalizeLinkUrl(value) {
  const source = String(value || "").trim();
  if (!source) {
    return { ok: false, error: "请输入链接地址" };
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(source) ? source : `https://${source}`;
  try {
    const parsed = new URL(withProtocol);
    if (!ALLOWED_LINK_PROTOCOLS.has(parsed.protocol)) {
      return { ok: false, error: "仅支持 http、https 和邮箱链接" };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, error: "链接地址格式不正确" };
  }
}

function getEditorLinkContext(editor, savedSelectionRef) {
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
  const selectedText = editor.state.doc.textBetween(from, to, " ").trim();
  const selectedHref = editor.getAttributes("link")?.href || "";
  if (from !== to) {
    return { from, to, text: selectedText, url: selectedHref, editing: Boolean(selectedHref) };
  }

  const resolved = editor.state.doc.resolve(Math.max(1, Math.min(from, editor.state.doc.content.size)));
  const parent = resolved.parent;
  const parentStart = resolved.start();
  let linked = null;
  parent.forEach((child, offset) => {
    if (linked || !child.isText) {
      return;
    }
    const mark = child.marks.find((item) => item.type.name === "link");
    if (!mark) {
      return;
    }
    const childFrom = parentStart + offset;
    const childTo = childFrom + child.nodeSize;
    if (from >= childFrom && from <= childTo) {
      linked = {
        from: childFrom,
        to: childTo,
        text: child.text || "",
        url: mark.attrs.href || "",
        editing: true,
      };
    }
  });
  return linked || { from, to, text: "", url: "", editing: false };
}

function getClickedLinkContext(editor, anchor) {
  if (!editor || !anchor) {
    return null;
  }
  try {
    const from = editor.view.posAtDOM(anchor, 0);
    const to = editor.view.posAtDOM(anchor, anchor.childNodes.length);
    return {
      from,
      to,
      text: anchor.textContent || "",
      url: anchor.getAttribute("href") || "",
      editing: true,
    };
  } catch {
    const context = getEditorLinkContext(editor, null);
    return context?.editing ? context : null;
  }
}

function handleEditorLinkClick(event, { editor, disabled = false, onEditLink } = {}) {
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

function normalizeUnderlineStyle(value) {
  return UNDERLINE_STYLE_VALUES.has(value) ? value : DEFAULT_UNDERLINE_STYLE;
}

const StyledUnderlineExtension = UnderlineExtension.extend({
  addAttributes() {
    const parentAttributes = this.parent?.() || {};
    return {
      ...parentAttributes,
      style: {
        default: DEFAULT_UNDERLINE_STYLE,
        parseHTML: (element) => {
          const style = element?.dataset?.underlineStyle || element?.style?.textDecorationStyle;
          return normalizeUnderlineStyle(style);
        },
        renderHTML: (attributes) => {
          const style = normalizeUnderlineStyle(attributes.style);
          return {
            "data-underline-style": style,
            style: [
              "text-decoration-line: underline",
              `text-decoration-style: ${style}`,
              "text-decoration-thickness: 0.08em",
              "text-underline-offset: 0.16em",
            ].join("; "),
          };
        },
      },
    };
  },
});

function createPaperEditorExtensions() {
  return [
    StarterKit.configure({
      underline: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
          title: "单击编辑链接；Ctrl/Command + 单击打开链接",
        },
      },
    }),
    TextStyle,
    Color.configure({ types: ["textStyle"] }),
    StyledUnderlineExtension,
    Highlight.configure({ multicolor: true }),
    FontFamily,
    HeadingMetadata,
    Table.configure({
      resizable: true,
      HTMLAttributes: { class: "paper-table" },
    }),
    TableRow,
    TableHeader,
    TableCell,
    PaperImage.configure({ allowBase64: true, inline: false }),
    PaperMedia,
    PaperPageBreak,
    PaperHorizontalRule,
    PaperFinalizedBreak,
    PaperTableOfContents,
    AiChatSelectionDecorations,
    DocumentCommentDecorations,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Placeholder.configure({ placeholder: "在这里开始写。" }),
  ];
}

function runTableCommand(editor, command) {
  if (!editor || !command) {
    return;
  }
  editor.chain().focus()[command]().run();
}

function getActiveTableElement(editor) {
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

function insertFinalizedBreak(editor, savedSelectionRef) {
  if (editorHasNodeType(editor, "paperFinalizedBreak")) {
    return;
  }
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.insertContent({ type: "paperFinalizedBreak" }));
}

function insertTableOfContents(editor, savedSelectionRef) {
  if (!editor) {
    return;
  }
  const positions = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "paperTableOfContents") {
      positions.push({ pos, nodeSize: node.nodeSize });
      return false;
    }
    return true;
  });
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

function UnderlineStyleMenu({ active, value, onToggle, onSelect }) {
  const [open, setOpen] = useState(false);
  const normalizedValue = normalizeUnderlineStyle(value);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".underline-style-menu")) {
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
    <div className={open ? "underline-style-menu open" : "underline-style-menu"}>
      <button
        type="button"
        className={active ? "icon-button active underline-style-toggle" : "icon-button underline-style-toggle"}
        title="下划线"
        aria-label="下划线"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggle}
      >
        <Underline size={17} strokeWidth={2.1} />
      </button>
      <button
        type="button"
        className="underline-style-trigger"
        title="下划线线型"
        aria-label="下划线线型"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="underline-style-popover" role="menu">
          {UNDERLINE_STYLE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === normalizedValue ? "underline-style-option active" : "underline-style-option"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
              role="menuitem"
            >
              <span className="underline-style-sample" style={{ "--underline-style": option.value }} aria-hidden="true">
                字
              </span>
              <span>{option.label}</span>
              {option.value === normalizedValue ? <Check size={14} /> : null}
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

function PaperMediaNodeView({ node, updateAttributes, selected }) {
  const kind = node.attrs.kind === "video" ? "video" : "audio";
  const width = node.attrs.width || "78%";
  const fileName = node.attrs.fileName || (kind === "video" ? "未命名视频" : "未命名音频");
  const MediaIcon = kind === "video" ? Video : Music2;
  const mediaLabel = kind === "video" ? "视频" : "音频";

  return (
    <NodeViewWrapper
      as="figure"
      className={["paper-media-figure", kind, selected ? "selected" : ""].filter(Boolean).join(" ")}
      data-type="paper-media"
      data-kind={kind}
      data-width={width}
      style={{ "--media-width": kind === "video" ? width : "100%" }}
    >
      <div className="paper-media-frame" contentEditable={false}>
        {kind === "video" ? (
          <video className="paper-media-player" src={node.attrs.src} controls preload="metadata" aria-label={`播放视频：${fileName}`} onMouseDown={(event) => event.stopPropagation()} />
        ) : (
          <audio className="paper-media-player" src={node.attrs.src} controls preload="metadata" aria-label={`播放音频：${fileName}`} onMouseDown={(event) => event.stopPropagation()} />
        )}
        {kind === "video" ? (
          <div className="media-size-tools" aria-label="调整视频大小">
            {IMAGE_WIDTH_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={width === option.value ? "active" : ""}
                title={`视频宽度 ${option.value}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => updateAttributes({ width: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <figcaption className="paper-media-caption" contentEditable={false}>
        <MediaIcon size={15} aria-hidden="true" />
        <strong>{fileName}</strong>
        <span>{mediaLabel}</span>
      </figcaption>
      <div className="paper-media-export-card" contentEditable={false}>
        <MediaIcon size={22} aria-hidden="true" />
        <span>
          <strong>{mediaLabel}：{fileName}</strong>
          <em>仅在电子文档中可播放</em>
        </span>
      </div>
    </NodeViewWrapper>
  );
}

const PaperMedia = Node.create({
  name: "paperMedia",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      kind: { default: "audio" },
      src: { default: "" },
      fileName: { default: "" },
      mime: { default: "" },
      width: { default: "78%" },
    };
  },

  parseHTML() {
    return [{
      tag: "figure[data-type='paper-media']",
      getAttrs: (element) => {
        const player = element.querySelector("audio[src], video[src]");
        if (!player) {
          return false;
        }
        const kind = player.tagName.toLowerCase() === "video" ? "video" : "audio";
        return {
          kind,
          src: player.getAttribute("src") || "",
          fileName: element.getAttribute("data-file-name") || "",
          mime: element.getAttribute("data-mime") || "",
          width: element.getAttribute("data-width") || "78%",
        };
      },
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const kind = HTMLAttributes.kind === "video" ? "video" : "audio";
    const fileName = HTMLAttributes.fileName || (kind === "video" ? "未命名视频" : "未命名音频");
    const mediaLabel = kind === "video" ? "视频" : "音频";
    const width = HTMLAttributes.width || "78%";
    return [
      "figure",
      {
        "data-type": "paper-media",
        "data-kind": kind,
        "data-file-name": fileName,
        "data-mime": HTMLAttributes.mime || "",
        "data-width": width,
        class: `paper-media-figure ${kind}`,
        style: `--media-width: ${kind === "video" ? width : "100%"};`,
      },
      [kind, { src: HTMLAttributes.src || "", controls: "controls", preload: "metadata", class: "paper-media-player", "aria-label": `播放${mediaLabel}：${fileName}` }],
      ["figcaption", { class: "paper-media-caption" }, `${mediaLabel} · ${fileName}`],
      ["div", { class: "paper-media-export-card" }, ["strong", `${mediaLabel}：${fileName}`], ["span", "仅在电子文档中可播放"]],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperMediaNodeView);
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

const PaperHorizontalRule = Node.create({
  name: "paperHorizontalRule",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: "div[data-type='paper-horizontal-rule']" }];
  },

  renderHTML() {
    return [
      "div",
      mergeAttributes({
        "data-type": "paper-horizontal-rule",
        class: "paper-horizontal-rule",
        contenteditable: "false",
      }),
    ];
  },
});

const PaperFinalizedBreak = Node.create({
  name: "paperFinalizedBreak",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  parseHTML() {
    return [{ tag: "div[data-type='paper-finalized-break']" }];
  },

  renderHTML() {
    return [
      "div",
      mergeAttributes({
        "data-type": "paper-finalized-break",
        class: "paper-finalized-break",
        contenteditable: "false",
      }),
      ["span", {}, "定稿线"],
    ];
  },
});

function PaperTocNodeView({ editor, selected, getPos }) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!editor) {
      return undefined;
    }
    const bump = () => setVersion((value) => value + 1);
    editor.on("update", bump);
    editor.on("transaction", bump);
    return () => {
      editor.off("update", bump);
      editor.off("transaction", bump);
    };
  }, [editor]);

  const headings = useMemo(() => {
    const numberingDefaults = editor ? HEADING_NUMBERING_PLUGIN_KEY.getState(editor.state)?.defaults : null;
    return collectHeadingItems(editor?.state.doc, numberingDefaults).filter((item) => item.level <= 3);
  }, [editor, version]);

  const jumpToHeading = useCallback(
    (pos) => {
      if (!editor) {
        return;
      }
      const selectionPos = Math.min(pos + 1, editor.state.doc.content.size);
      editor.chain().focus().setTextSelection(selectionPos).scrollIntoView().run();
    },
    [editor],
  );

  const preventTocSelection = useCallback(
    (event) => {
      if (event.target instanceof Element && event.target.closest("button")) {
        return;
      }
      event.preventDefault();
      const tocPos = typeof getPos === "function" ? getPos() : 0;
      const tocNode = editor?.state.doc.nodeAt(tocPos);
      const selectionPos = Math.min(tocPos + (tocNode?.nodeSize || 1), editor?.state.doc.content.size || 0);
      if (editor && selectionPos >= 0) {
        editor.chain().focus().setTextSelection(selectionPos).run();
      }
    },
    [editor, getPos],
  );

  return (
    <NodeViewWrapper
      as="section"
      className={selected ? "paper-toc selected" : "paper-toc"}
      data-type="paper-toc"
      contentEditable={false}
      onMouseDown={preventTocSelection}
    >
      <h2 className="paper-toc-title" aria-label="目录">
        <img src={DECOR_ASSETS.tocTitleSignature} alt="" aria-hidden="true" />
        <span>目录</span>
      </h2>
      {headings.length ? (
        <ol className="paper-toc-list">
          {headings.map((heading) => (
            <li key={heading.id} className={`level-${heading.level}`}>
              <button type="button" onClick={() => jumpToHeading(heading.pos)}>
                <span className="paper-toc-number">{heading.number}</span>
                <span className="paper-toc-text">{heading.text}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>还没有可生成目录的标题。</p>
      )}
    </NodeViewWrapper>
  );
}

const PaperTableOfContents = Node.create({
  name: "paperTableOfContents",
  group: "block",
  atom: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "section[data-type='paper-toc'], div[data-type='paper-toc']" }];
  },

  renderHTML() {
    return [
      "section",
      mergeAttributes({
        "data-type": "paper-toc",
        class: "paper-toc",
        contenteditable: "false",
      }),
      ["h2", { class: "paper-toc-title", "aria-label": "目录" }, [
        "img",
        { src: DECOR_ASSETS.tocTitleSignature, alt: "", "aria-hidden": "true" },
      ], ["span", {}, "目录"]],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperTocNodeView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (_transactions, _oldState, newState) => {
          const nodeType = newState.schema.nodes.paperTableOfContents;
          if (!nodeType) {
            return null;
          }
          const positions = [];
          newState.doc.descendants((node, pos) => {
            if (node.type === nodeType) {
              positions.push({ pos, node });
              return false;
            }
            return true;
          });
          if (!positions.length || (positions.length === 1 && positions[0].pos === 0)) {
            return null;
          }
          const tr = newState.tr;
          positions
            .slice()
            .reverse()
            .forEach(({ pos, node }) => {
              tr.delete(pos, pos + node.nodeSize);
            });
          tr.insert(0, nodeType.create());
          return tr;
        },
      }),
    ];
  },
});

function buildAiChatSelectionDecorationSet(doc, selections = []) {
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

function buildDocumentCommentDecorationSet(doc, comments = []) {
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

function normalizeHeadingNumberingDefaults(value) {
  const source = value && typeof value === "object" ? value : {};
  return { 1: source[1] !== false, 2: source[2] !== false, 3: source[3] !== false };
}

function collectHeadingItems(doc, numberingDefaults = DEFAULT_TEMPLATE_PRESENTATION.headingNumbering) {
  if (!doc) {
    return [];
  }
  const normalizedDefaults = normalizeHeadingNumberingDefaults(numberingDefaults);
  const counters = [0, 0, 0];
  const items = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") {
      return;
    }
    const level = Math.max(1, Math.min(3, Number(node.attrs.level) || 1));
    if (level < 1 || level > 3) {
      return;
    }
    const text = node.textContent?.trim();
    if (!text || text === "目录") {
      return;
    }
    const numberingMode = ["inherit", "on", "off"].includes(node.attrs.numberingMode)
      ? node.attrs.numberingMode
      : "inherit";
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
      id: `heading-${pos}-${level}`,
      level,
      text,
      pos,
      numbered,
      numberingMode,
      number,
    });
  });
  return items;
}

function buildHeadingNumberDecorationSet(doc, numberingDefaults = DEFAULT_TEMPLATE_PRESENTATION.headingNumbering) {
  const decorations = collectHeadingItems(doc, numberingDefaults).flatMap((item) => {
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

function selectionTouchesNodeType(editor, typeName) {
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

const AiChatSelectionDecorations = Extension.create({
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

const DocumentCommentDecorations = Extension.create({
  name: "documentCommentDecorations",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: DOCUMENT_COMMENT_PLUGIN_KEY,
        state: {
          init: () => DecorationSet.empty,
          apply(transaction, previousDecorationSet) {
            const nextComments = transaction.getMeta(DOCUMENT_COMMENT_PLUGIN_KEY);
            if (Array.isArray(nextComments)) {
              return buildDocumentCommentDecorationSet(transaction.doc, nextComments);
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

const HeadingMetadata = Extension.create({
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
            return { defaults, decorations: buildHeadingNumberDecorationSet(state.doc, defaults) };
          },
          apply(transaction, previousState) {
            const metaDefaults = transaction.getMeta(HEADING_NUMBERING_PLUGIN_KEY);
            const defaults = metaDefaults
              ? normalizeHeadingNumberingDefaults(metaDefaults)
              : previousState.defaults;
            if (transaction.docChanged || metaDefaults) {
              return { defaults, decorations: buildHeadingNumberDecorationSet(transaction.doc, defaults) };
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

function syncAiChatSelectionDecorations(editor, selections = []) {
  if (!editor?.view) {
    return;
  }
  editor.view.dispatch(editor.state.tr.setMeta(AI_CHAT_SELECTION_PLUGIN_KEY, selections));
}

function syncDocumentCommentDecorations(editor, comments = []) {
  if (!editor?.view) {
    return;
  }
  editor.view.dispatch(editor.state.tr.setMeta(DOCUMENT_COMMENT_PLUGIN_KEY, comments));
}

function syncHeadingNumberingDefaults(editor, headingNumbering) {
  if (!editor?.view) {
    return;
  }
  editor.view.dispatch(editor.state.tr.setMeta(HEADING_NUMBERING_PLUGIN_KEY, headingNumbering));
}

function MenuButton({ icon: Icon, label, menuId, openMenu, onOpenMenu, children, disabled = false, triggerClassName = "", showDisclosure = true }) {
  const isOpen = openMenu === menuId;
  const popoverId = `nav-menu-${menuId}`;

  return (
    <div className={isOpen ? "nav-menu open" : "nav-menu"}>
      <button
        type="button"
        className={["nav-menu-trigger", triggerClassName].filter(Boolean).join(" ")}
        disabled={disabled}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-controls={popoverId}
        aria-expanded={isOpen}
        onClick={() => {
          if (!disabled) {
            onOpenMenu(isOpen ? "" : menuId);
          }
        }}
      >
        <Icon size={19} strokeWidth={1.9} />
        <span>{label}</span>
        {showDisclosure ? <ChevronDown size={14} /> : null}
      </button>
      {isOpen ? (
        <div className="nav-menu-popover" id={popoverId} role="menu">{children}</div>
      ) : null}
    </div>
  );
}

function MenuItem({ icon: Icon, label, disabled = false, active = false, selection = false, checked, onClick }) {
  const isCheckbox = typeof checked === "boolean";
  const isActive = active || checked === true;
  return (
    <button
      type="button"
      className={isActive ? "nav-menu-item active" : "nav-menu-item"}
      role={selection ? "menuitemradio" : isCheckbox ? "menuitemcheckbox" : "menuitem"}
      aria-checked={selection ? active : isCheckbox ? checked : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.9} />
      <span>{label}</span>
      {(selection && active) || checked === true ? <Check size={14} className="nav-menu-item-check" aria-hidden="true" /> : null}
    </button>
  );
}

function MenuDivider() {
  return <i className="nav-menu-divider" aria-hidden="true" />;
}

function TreeContextMenu({ menu, onClose, onCreateFolder, onCreateDocument, onRename, onBackup, onDelete }) {
  useEffect(() => {
    if (!menu) {
      return undefined;
    }
    const close = () => onClose();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.document.addEventListener("pointerdown", close);
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.document.removeEventListener("pointerdown", close);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [menu, onClose]);

  if (!menu) {
    return null;
  }

  const run = (action) => {
    onClose();
    action?.(menu.entry);
  };

  return (
    <div
      className="tree-context-menu"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
    >
      {menu.entry.type === "folder" ? (
        <>
          <button type="button" onClick={() => run(onCreateFolder)} role="menuitem">
            <FolderPlus size={15} />
            <span>新建子文件夹</span>
          </button>
          <button type="button" onClick={() => run(onCreateDocument)} role="menuitem">
            <FilePlus size={15} />
            <span>新建信笺</span>
          </button>
          {!menu.entry.protected ? (
            <>
              <i />
              <button type="button" onClick={() => run(onRename)} role="menuitem">
                <Pencil size={15} />
                <span>重命名</span>
              </button>
              <button type="button" className="danger" onClick={() => run(onDelete)} role="menuitem">
                <Trash2 size={15} />
                <span>删除</span>
              </button>
            </>
          ) : null}
        </>
      ) : (
        <>
          <button type="button" onClick={() => run(onRename)} role="menuitem">
            <Pencil size={15} />
            <span>重命名</span>
          </button>
          <button type="button" onClick={() => run(onBackup)} role="menuitem">
            <Copy size={15} />
            <span>复制备份</span>
          </button>
          <i />
          <button type="button" className="danger" onClick={() => run(onDelete)} role="menuitem">
            <Trash2 size={15} />
            <span>删除</span>
          </button>
        </>
      )}
    </div>
  );
}

function TopNav({
  editor,
  document,
  savedSelectionRef,
  onNew,
  onOpen,
  onSave,
  onOpenExport,
  onInsertImage,
  onInsertAudio,
  onInsertVideo,
  onOpenLinkDialog,
  onOpenHelp,
  aiMode,
  aiModeKind,
  aiBusy,
  aiConfigured,
  editorLocked,
  tableOfContentsInserted,
  onOpenAiSettings,
  onEnterAiOptimize,
  onEnterAiChat,
  onExitAi,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
}) {
  const canEdit = Boolean(editor) && !editorLocked && !aiMode;
  const documentActionsDisabled = Boolean(aiMode);
  const [openMenu, setOpenMenu] = useState("");
  const exitAiLabel = aiModeKind === "chat" ? "退出 AI问答" : "退出 AI优化";
  const leftSidebarToggleLabel = leftSidebarCollapsed ? "展开左侧栏" : "收起左侧栏";
  const LeftSidebarToggleIcon = leftSidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const canUndo = canEdit && Boolean(editor?.can().undo());
  const canRedo = canEdit && Boolean(editor?.can().redo());
  const activeHeadingLevel = [1, 2, 3].find((level) => editor?.isActive("heading", { level })) || 0;
  const bulletListActive = Boolean(editor?.isActive("bulletList"));
  const orderedListActive = Boolean(editor?.isActive("orderedList"));
  const ListStyleIcon = orderedListActive ? ListOrdered : List;
  const activeAlignment = [
    { value: "left", label: "左对齐", icon: AlignLeft },
    { value: "center", label: "居中", icon: AlignCenter },
    { value: "right", label: "右对齐", icon: AlignRight },
  ].find((option) => editor?.isActive({ textAlign: option.value }));
  const AlignmentIcon = activeAlignment?.icon || AlignLeft;

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
        <button
          type="button"
          className="nav-sidebar-toggle"
          disabled={documentActionsDisabled}
          title={leftSidebarToggleLabel}
          aria-label={leftSidebarToggleLabel}
          aria-controls="left-sidebar"
          aria-expanded={!leftSidebarCollapsed}
          onClick={onToggleLeftSidebar}
        >
          <LeftSidebarToggleIcon size={20} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <span className="nav-divider nav-primary-divider" />
        <MenuButton
          icon={FileText}
          label="文件"
          menuId="file"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={documentActionsDisabled}
          showDisclosure={false}
        >
          <MenuItem icon={FilePlus} label="新建文件" onClick={() => runMenuAction(onNew)} />
          <MenuItem icon={FileText} label="打开文件" onClick={() => runMenuAction(onOpen)} />
          <MenuDivider />
          <MenuItem icon={SaveAll} label="另存为" onClick={() => runMenuAction(() => onSave(true))} />
        </MenuButton>
        <button
          type="button"
          className="nav-command"
          disabled={documentActionsDisabled}
          title="保存"
          aria-label="保存"
          onClick={() => runMenuAction(() => onSave(false))}
        >
          <Save size={19} strokeWidth={1.9} aria-hidden="true" />
          <span>保存</span>
        </button>
        <button
          type="button"
          className="nav-command"
          disabled={documentActionsDisabled}
          title="导出"
          aria-label="打开导出设置"
          onClick={() => runMenuAction(onOpenExport)}
        >
          <Download size={19} strokeWidth={1.9} aria-hidden="true" />
          <span>导出</span>
        </button>
        <button
          type="button"
          className="nav-menu-trigger"
          title="帮助"
          aria-label="帮助"
          onClick={() => runMenuAction(onOpenHelp)}
        >
          <HelpCircle size={19} strokeWidth={1.9} />
          <span>帮助</span>
        </button>
      </div>

      <div className="nav-center">
        {aiMode ? (
          <button
            type="button"
            className={["nav-menu-trigger", "ai-feature-trigger", "active", aiBusy ? "busy" : ""].filter(Boolean).join(" ")}
            onClick={onExitAi}
            title={exitAiLabel}
            aria-label={exitAiLabel}
          >
            {aiBusy ? <Bot size={19} strokeWidth={1.9} /> : <Sparkles size={19} strokeWidth={1.9} />}
            <span>退出 AI</span>
          </button>
        ) : (
          <MenuButton
            icon={Sparkles}
            label="AI功能"
            menuId="ai"
            openMenu={openMenu}
            onOpenMenu={setOpenMenu}
            triggerClassName={[
              "ai-feature-trigger",
              aiConfigured ? "configured" : "unconfigured",
            ].filter(Boolean).join(" ")}
            showDisclosure={false}
          >
            <MenuItem icon={Settings} label="AI配置" onClick={() => runMenuAction(onOpenAiSettings)} />
            <MenuDivider />
            <MenuItem icon={Sparkles} label="AI优化" onClick={() => runMenuAction(onEnterAiOptimize)} />
            <MenuDivider />
            <MenuItem icon={Bot} label="AI问答" onClick={() => runMenuAction(onEnterAiChat)} />
          </MenuButton>
        )}
      </div>

      <div className="nav-tools">
        <div className="nav-tool-history" role="group" aria-label="编辑历史">
          <IconButton icon={Undo2} label="撤销（Ctrl+Z）" disabled={!canUndo} onClick={() => editor?.chain().focus().undo().run()} />
          <IconButton icon={Redo2} label="重做（Ctrl+Shift+Z）" disabled={!canRedo} onClick={() => editor?.chain().focus().redo().run()} />
        </div>
        <span className="nav-divider" />
        <MenuButton
          icon={FileText}
          label="标题"
          menuId="heading"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={!canEdit}
          triggerClassName={["tool-menu-trigger", activeHeadingLevel ? "active" : ""].filter(Boolean).join(" ")}
          showDisclosure={false}
        >
          <MenuItem icon={Heading1} label="一级标题" selection active={activeHeadingLevel === 1} onClick={() => runMenuAction(() => setHeadingLevel(editor, savedSelectionRef, 1))} />
          <MenuItem icon={Heading2} label="二级标题" selection active={activeHeadingLevel === 2} onClick={() => runMenuAction(() => setHeadingLevel(editor, savedSelectionRef, 2))} />
          <MenuItem icon={Heading3} label="三级标题" selection active={activeHeadingLevel === 3} onClick={() => runMenuAction(() => setHeadingLevel(editor, savedSelectionRef, 3))} />
        </MenuButton>
        <button
          type="button"
          className={tableOfContentsInserted ? "nav-command tool-command active" : "nav-command tool-command"}
          disabled={!canEdit}
          title={tableOfContentsInserted ? "关闭目录" : "生成目录"}
          aria-label={tableOfContentsInserted ? "关闭目录" : "生成目录"}
          aria-pressed={tableOfContentsInserted}
          onClick={() => insertTableOfContents(editor, savedSelectionRef)}
        >
          <ListTree size={18} strokeWidth={1.9} aria-hidden="true" />
          <span>目录</span>
        </button>
        <MenuButton
          icon={AlignmentIcon}
          label="对齐"
          menuId="alignment"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={!canEdit}
          triggerClassName={["tool-menu-trigger", activeAlignment ? "active" : ""].filter(Boolean).join(" ")}
          showDisclosure={false}
        >
          {[{ value: "left", label: "左对齐", icon: AlignLeft }, { value: "center", label: "居中", icon: AlignCenter }, { value: "right", label: "右对齐", icon: AlignRight }].map((option) => (
            <MenuItem
              key={option.value}
              icon={option.icon}
              label={option.label}
              selection
              active={activeAlignment?.value === option.value}
              onClick={() => runMenuAction(() => runEditorCommand(editor, savedSelectionRef, (chain) => chain.setTextAlign(option.value)))}
            />
          ))}
        </MenuButton>
        <MenuButton
          icon={ListStyleIcon}
          label="列表"
          menuId="list-style"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={!canEdit}
          triggerClassName={["tool-menu-trigger", bulletListActive || orderedListActive ? "active" : ""].filter(Boolean).join(" ")}
          showDisclosure={false}
        >
          <MenuItem icon={List} label={bulletListActive ? "取消无序列表" : "无序列表"} selection active={bulletListActive} onClick={() => runMenuAction(() => runEditorCommand(editor, savedSelectionRef, (chain) => chain.toggleBulletList()))} />
          <MenuItem icon={ListOrdered} label={orderedListActive ? "取消有序列表" : "有序列表"} selection active={orderedListActive} onClick={() => runMenuAction(() => runEditorCommand(editor, savedSelectionRef, (chain) => chain.toggleOrderedList()))} />
        </MenuButton>
        <span className="nav-divider" />
        <MenuButton
          icon={ImagePlus}
          label="媒体"
          menuId="media"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={!canEdit}
          triggerClassName="tool-menu-trigger"
          showDisclosure={false}
        >
          <MenuItem icon={ImagePlus} label="图片" onClick={() => runMenuAction(onInsertImage)} />
          <MenuItem icon={Music2} label="音频" onClick={() => runMenuAction(onInsertAudio)} />
          <MenuItem icon={Video} label="视频" onClick={() => runMenuAction(onInsertVideo)} />
          <MenuDivider />
          <MenuItem icon={Link2} label="链接" onClick={() => runMenuAction(onOpenLinkDialog)} />
        </MenuButton>
        <MenuButton
          icon={Plus}
          label="元素"
          menuId="elements"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={!canEdit}
          triggerClassName={["tool-menu-trigger", editor?.isActive("blockquote") ? "active" : ""].filter(Boolean).join(" ")}
          showDisclosure={false}
        >
          <MenuItem icon={Quote} label={editor?.isActive("blockquote") ? "取消引用块" : "引用块"} checked={Boolean(editor?.isActive("blockquote"))} onClick={() => runMenuAction(() => insertStructuredQuote(editor, savedSelectionRef))} />
          <MenuDivider />
          <MenuItem icon={Minus} label="分割线" onClick={() => runMenuAction(() => insertHorizontalRule(editor, savedSelectionRef))} />
          <MenuItem icon={SeparatorHorizontal} label="分页符" onClick={() => runMenuAction(() => insertPageBreak(editor, savedSelectionRef))} />
          <MenuItem icon={Table2} label="表格" onClick={() => runMenuAction(() => insertBasicTable(editor, savedSelectionRef))} />
        </MenuButton>
      </div>
    </section>
  );
}

function getTopicsForCategory(categoryId) {
  return HELP_TOPICS.filter((topic) => topic.categoryId === categoryId);
}

function renderHelpText(text) {
  if (!text) {
    return null;
  }
  const parts = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\[\[[^\]]+\]\]|__[^_]+__)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("[[") && part.endsWith("]]")) {
      return <em key={`${part}-${index}`}>{part.slice(2, -2)}</em>;
    }
    if (part.startsWith("__") && part.endsWith("__")) {
      return <u key={`${part}-${index}`}>{part.slice(2, -2)}</u>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function HelpCenterDialog({ open, onClose }) {
  const [activeTopicId, setActiveTopicId] = useState(HELP_TOPICS[0]?.id || "");
  const [imagePreview, setImagePreview] = useState(null);
  const activeTopic = HELP_TOPICS.find((topic) => topic.id === activeTopicId) || HELP_TOPICS[0];
  const activeCategoryId = activeTopic?.categoryId || HELP_CATEGORIES[0]?.id;

  useEffect(() => {
    if (!open) {
      setImagePreview(null);
      return undefined;
    }
    if (!activeTopic) {
      setActiveTopicId(HELP_TOPICS[0]?.id || "");
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (imagePreview) {
          setImagePreview(null);
        } else {
          onClose();
        }
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [activeTopic, imagePreview, onClose, open]);

  const handleCategoryClick = useCallback((categoryId) => {
    const firstTopic = getTopicsForCategory(categoryId)[0];
    if (firstTopic) {
      setActiveTopicId(firstTopic.id);
    }
  }, []);

  if (!open || !activeTopic) {
    return null;
  }

  return (
    <>
      <div className="help-center-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="help-center-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-center-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="help-center-sidebar">
          <header>
            <span><HelpCircle size={18} /></span>
            <div>
              <p>使用说明</p>
              <h2 id="help-center-title">帮助中心</h2>
            </div>
          </header>
          <nav className="help-center-nav" aria-label="帮助主题">
            {HELP_CATEGORIES.map((category) => {
              const CategoryIcon = category.icon;
              const topics = getTopicsForCategory(category.id);
              const categoryActive = category.id === activeCategoryId;
              return (
                <section key={category.id} className={categoryActive ? "active" : ""}>
                  <button type="button" className="help-category-button" onClick={() => handleCategoryClick(category.id)}>
                    <CategoryIcon size={15} />
                    <span>{category.label}</span>
                  </button>
                  <div className="help-topic-list">
                    {topics.map((topic) => (
                      <button
                        key={topic.id}
                        type="button"
                        className={topic.id === activeTopic.id ? "active" : ""}
                        aria-current={topic.id === activeTopic.id ? "page" : undefined}
                        onClick={() => setActiveTopicId(topic.id)}
                      >
                        {topic.title}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </nav>
        </aside>
        <main className="help-center-content">
          <button type="button" className="help-center-close" onClick={onClose} aria-label="关闭帮助" title="关闭帮助">
            <X size={17} />
          </button>
          <article className="help-topic-detail">
            <header>
              <p>{HELP_CATEGORIES.find((category) => category.id === activeTopic.categoryId)?.label}</p>
              <h3>{activeTopic.title}</h3>
              <p className="help-summary">{renderHelpText(activeTopic.summary)}</p>
            </header>
            <HelpIllustration
              type={activeTopic.illustration}
              alt={activeTopic.illustrationAlt}
              caption={activeTopic.illustrationCaption}
              onPreview={(src) => setImagePreview({
                src,
                alt: activeTopic.illustrationAlt,
                caption: activeTopic.illustrationCaption,
                title: activeTopic.title,
              })}
            />
            <section className="help-topic-section">
              <h4>怎么用</h4>
              <ol>
                {activeTopic.steps.map((step) => (
                  <li key={step}>{renderHelpText(step)}</li>
                ))}
              </ol>
            </section>
            <section className="help-topic-section">
              <h4>注意</h4>
              <ul>
                {activeTopic.tips.map((tip) => (
                  <li key={tip}>{renderHelpText(tip)}</li>
                ))}
              </ul>
            </section>
          </article>
        </main>
      </section>
      </div>
      {imagePreview ? createPortal(
        <div className="help-image-preview-overlay" role="presentation" onMouseDown={() => setImagePreview(null)}>
          <section
            className="help-image-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-image-preview-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p>帮助配图</p>
                <h2 id="help-image-preview-title">{imagePreview.title}</h2>
              </div>
              <button type="button" onClick={() => setImagePreview(null)} aria-label="关闭图片预览" title="关闭图片预览" autoFocus>
                <X size={19} />
              </button>
            </header>
            <div className="help-image-preview-stage">
              <img
                src={imagePreview.src}
                alt={imagePreview.alt || "帮助主题界面截图"}
                role="button"
                tabIndex={0}
                aria-label="缩小图片并返回帮助中心"
                title="单击缩小"
                onClick={() => setImagePreview(null)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setImagePreview(null);
                  }
                }}
              />
            </div>
            {imagePreview.caption ? <p className="help-image-preview-caption">{imagePreview.caption}</p> : null}
          </section>
        </div>,
        window.document.body,
      ) : null}
    </>
  );
}

function ExportDialog({ open, documentTitle, onClose, onExportPdf, onExportImages }) {
  const [format, setFormat] = useState("pdf");
  const [targetPath, setTargetPath] = useState("");
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("选择格式与保存位置后开始导出");
  const [error, setError] = useState("");
  const busy = status === "choosing" || status === "exporting";
  const completed = status === "success";

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setFormat("pdf");
    setTargetPath("");
    setStatus("idle");
    setProgress(0);
    setProgressMessage("选择格式与保存位置后开始导出");
    setError("");
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && status !== "exporting") {
        event.preventDefault();
        onClose();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open, status]);

  useEffect(() => {
    if (!open || typeof bridge.onExportProgress !== "function") {
      return undefined;
    }
    return bridge.onExportProgress((payload) => {
      if (!payload || payload.format !== format) {
        return;
      }
      setProgress(Math.max(0, Math.min(100, Number(payload.percent) || 0)));
      if (payload.message) {
        setProgressMessage(payload.message);
      }
    });
  }, [format, open]);

  if (!open) {
    return null;
  }

  const updateFormat = (nextFormat) => {
    if (busy || nextFormat === format) {
      return;
    }
    setFormat(nextFormat);
    setTargetPath("");
    setStatus("idle");
    setProgress(0);
    setProgressMessage("选择格式与保存位置后开始导出");
    setError("");
  };

  const handleChoosePath = async () => {
    setStatus("choosing");
    setError("");
    try {
      const result = await bridge.pickExportPath?.(format, documentTitle);
      if (!result?.canceled && result?.path) {
        setTargetPath(result.path);
        setProgressMessage(format === "pdf" ? "PDF 将保存到所选位置" : "分页图片将保存到所选文件夹");
      }
      setStatus("idle");
    } catch (chooseError) {
      setStatus("error");
      setError(chooseError?.message || "无法选择导出位置，请重试");
    }
  };

  const handleStartExport = async () => {
    if (!targetPath || busy) {
      return;
    }
    setStatus("exporting");
    setProgress(2);
    setProgressMessage("正在准备导出内容…");
    setError("");
    try {
      const result = format === "pdf"
        ? await onExportPdf(targetPath)
        : await onExportImages(targetPath);
      if (result?.canceled) {
        setStatus("idle");
        setProgress(0);
        setProgressMessage("导出已取消");
        return;
      }
      setProgress(100);
      setProgressMessage(format === "pdf" ? "PDF 导出完成" : `已导出 ${result?.count || 0} 张分页图片`);
      setStatus("success");
    } catch (exportError) {
      setStatus("error");
      setError(exportError?.message || "导出失败，请检查保存位置后重试");
      setProgressMessage("导出未完成");
    }
  };

  const content = (
    <div className="export-dialog-overlay" role="presentation" onMouseDown={() => { if (!busy) onClose(); }}>
      <section
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="export-dialog-header">
          <div className="export-dialog-heading-icon" aria-hidden="true">
            <Download size={21} strokeWidth={1.9} />
          </div>
          <div>
            <p>输出当前信笺</p>
            <h2 id="export-dialog-title">导出</h2>
          </div>
          <button type="button" className="export-dialog-close" onClick={onClose} disabled={busy} aria-label="关闭导出窗口" title="关闭">
            <X size={17} />
          </button>
        </header>

        <div className="export-dialog-body">
          <fieldset className="export-format-fieldset" disabled={busy}>
            <legend>导出格式</legend>
            <div className="export-format-options">
              <label className={format === "pdf" ? "selected" : ""}>
                <input type="radio" name="export-format" value="pdf" checked={format === "pdf"} onChange={() => updateFormat("pdf")} autoFocus />
                <span className="export-format-icon"><FileText size={20} strokeWidth={1.8} /></span>
                <span><strong>PDF 文档</strong><small>适合打印、归档与分享</small></span>
                <i aria-hidden="true" />
              </label>
              <label className={format === "images" ? "selected" : ""}>
                <input type="radio" name="export-format" value="images" checked={format === "images"} onChange={() => updateFormat("images")} />
                <span className="export-format-icon"><FileImage size={20} strokeWidth={1.8} /></span>
                <span><strong>分页图片</strong><small>按分页符输出多张 PNG</small></span>
                <i aria-hidden="true" />
              </label>
            </div>
          </fieldset>

          <div className="export-path-field">
            <label htmlFor="export-target-path">导出路径</label>
            <div className="export-path-control">
              <input
                id="export-target-path"
                type="text"
                readOnly
                value={targetPath}
                placeholder={format === "pdf" ? "请选择 PDF 文件的保存位置" : "请选择分页图片的保存文件夹"}
                title={targetPath}
              />
              <button type="button" onClick={handleChoosePath} disabled={busy}>
                <FolderOpen size={16} strokeWidth={1.9} />
                <span>选择位置</span>
              </button>
            </div>
            <small>{format === "pdf" ? "文件扩展名会自动补全为 .pdf" : "图片将以“信笺名-01.png”的方式连续命名"}</small>
          </div>

          <div className={`export-progress ${status}`} aria-live="polite">
            <div className="export-progress-copy">
              <span>{completed ? <CheckCircle2 size={15} /> : <Download size={15} />}{progressMessage}</span>
              <strong>{Math.round(progress)}%</strong>
            </div>
            <div
              className="export-progress-track"
              role="progressbar"
              aria-label="导出进度"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(progress)}
            >
              <i style={{ width: `${progress}%` }} />
            </div>
          </div>
          {error ? <p className="export-dialog-error" role="alert">{error}</p> : null}
        </div>

        <footer className="export-dialog-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>{completed ? "关闭" : "取消"}</button>
          {!completed ? (
            <button type="button" className="primary" onClick={handleStartExport} disabled={!targetPath || busy}>
              <Download size={16} strokeWidth={1.9} />
              <span>{status === "exporting" ? "正在导出…" : "开始导出"}</span>
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );

  return createPortal(content, window.document.body);
}

function HelpIllustration({ type, alt, caption, onPreview }) {
  const src = HELP_SCREENSHOTS[type] || HELP_SCREENSHOTS.workspace;
  const openPreview = () => onPreview?.(src);
  return (
    <figure className={`help-illustration ${type || "workspace"}`}>
      <img
        src={src}
        alt={alt || "帮助主题界面截图"}
        loading="lazy"
        decoding="async"
        role="button"
        tabIndex={0}
        aria-label={`放大查看：${alt || "帮助主题界面截图"}`}
        title="单击放大"
        onClick={openPreview}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPreview();
          }
        }}
      />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

function FolderEntryRows({
  entries,
  currentPath,
  expandedFolders,
  depth = 0,
  onOpenFile,
  onOpenFolderPath,
  onToggleFolder,
  onContextMenu,
  onDragPointerDown = () => {},
  onConsumeDragClick = () => false,
  dragTargetPath = "",
}) {
  const lastFolderClickRef = useRef({ path: "", at: 0 });

  const handleFolderClick = useCallback((event, path) => {
    if (onConsumeDragClick()) {
      return;
    }
    const now = window.performance?.now?.() || Date.now();
    const previous = lastFolderClickRef.current;
    onToggleFolder(path);
    if (previous.path === path && now - previous.at <= FOLDER_DOUBLE_CLICK_MAX_MS) {
      lastFolderClickRef.current = { path: "", at: 0 };
      onOpenFolderPath(path);
      return;
    }
    lastFolderClickRef.current = { path, at: now };
  }, [onConsumeDragClick, onOpenFolderPath, onToggleFolder]);

  return entries.map((entry) => {
    if (entry.type === "folder") {
      const expanded = Boolean(expandedFolders[entry.path]?.expanded);
      const loading = Boolean(expandedFolders[entry.path]?.loading);
      const childEntries = expandedFolders[entry.path]?.entries || [];
      return (
        <div key={entry.path} className="folder-tree-group">
          <div
            className={dragTargetPath === entry.path ? "folder-tree-row folder-entry drag-target" : "folder-tree-row folder-entry"}
            style={{ "--tree-depth": depth }}
            data-drop-folder-path={entry.path}
          >
            <button
              type="button"
              className={expanded ? "folder-disclosure expanded" : "folder-disclosure"}
              onClick={() => onToggleFolder(entry.path)}
              aria-label={expanded ? "折叠文件夹" : "展开文件夹"}
              title={expanded ? "折叠文件夹" : "展开文件夹"}
            >
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              className={dragTargetPath === entry.path ? "folder-entry-main drag-target" : "folder-entry-main"}
              data-drop-folder-path={entry.path}
              onClick={(event) => handleFolderClick(event, entry.path)}
              onContextMenu={(event) => onContextMenu(event, entry)}
              onPointerDown={(event) => onDragPointerDown(event, entry)}
              title={`${entry.name}（单击展开/收起，双击进入）`}
            >
              <img
                className="asset-icon folder-asset-icon"
                src={entry.hasLetterpapers === false ? ICON_ASSETS.goldFolderEmpty : ICON_ASSETS.goldFolderFull}
                alt=""
                aria-hidden="true"
              />
              <span>{entry.name}</span>
            </button>
          </div>
          {expanded ? (
            <div className="folder-tree-children">
              {loading ? (
                <p className="folder-tree-hint" style={{ "--tree-depth": depth + 1 }}>读取中...</p>
              ) : childEntries.length ? (
                <FolderEntryRows
                  entries={childEntries}
                  currentPath={currentPath}
                  expandedFolders={expandedFolders}
                  depth={depth + 1}
                  onOpenFile={onOpenFile}
                  onOpenFolderPath={onOpenFolderPath}
                  onToggleFolder={onToggleFolder}
                  onContextMenu={onContextMenu}
                  onDragPointerDown={onDragPointerDown}
                  onConsumeDragClick={onConsumeDragClick}
                  dragTargetPath={dragTargetPath}
                />
              ) : (
                <p className="folder-tree-hint" style={{ "--tree-depth": depth + 1 }}>空文件夹</p>
              )}
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <button
        key={entry.path}
        type="button"
        className={entry.path === currentPath ? "folder-tree-row file-entry active" : "folder-tree-row file-entry"}
        style={{ "--tree-depth": depth }}
        onClick={() => {
          if (onConsumeDragClick()) {
            return;
          }
          onOpenFile(entry.path);
        }}
        onContextMenu={(event) => onContextMenu(event, entry)}
        onPointerDown={(event) => onDragPointerDown(event, entry)}
        title={entry.name}
      >
        {entry.path === currentPath ? <span className="document-dot" /> : <span className="folder-disclosure-spacer" />}
        <img className="asset-icon pen-asset-icon" src={ICON_ASSETS.brandMark} alt="" aria-hidden="true" />
        <span>{entry.displayName || entry.name}</span>
      </button>
    );
  });
}

function LeftSidebar({
  currentPath,
  folderState,
  mode,
  outlineItems,
  expandedFolders,
  onOpenFolder,
  onOpenFolderPath,
  onOpenFolderFile,
  onToggleFolder,
  onCreateFolder,
  onCreateDocument,
  onRenameEntry,
  onBackupDocument,
  onDeleteEntry,
  onMoveEntry,
  onModeChange,
  onOutlineItemClick,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [dragState, setDragState] = useState(null);
  const dragSuppressClickRef = useRef(false);
  const folderEntries = folderState.entries || [
    ...(folderState.folders || []),
    ...(folderState.files || []),
  ];

  const consumeDragClick = useCallback(() => {
    if (!dragSuppressClickRef.current) {
      return false;
    }
    dragSuppressClickRef.current = false;
    return true;
  }, []);

  const getDropFolderPath = useCallback((clientX, clientY, draggedEntry) => {
    const element = window.document.elementFromPoint(clientX, clientY)?.closest?.("[data-drop-folder-path]");
    const targetPath = element?.dataset?.dropFolderPath || "";
    if (!targetPath || !draggedEntry?.path || targetPath === draggedEntry.path) {
      return "";
    }
    if (parentPathFromPath(draggedEntry.path) === targetPath) {
      return "";
    }
    if (draggedEntry.type === "folder" && pathIsSameOrInside(targetPath, draggedEntry.path)) {
      return "";
    }
    return targetPath;
  }, []);

  const startTreeDrag = useCallback((event, entry) => {
    if (!entry?.path || event.button !== 0) {
      return;
    }

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let latestX = startX;
    let latestY = startY;

    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", handleUp, true);
      window.removeEventListener("pointercancel", handleCancel, true);
    };

    const beginDrag = () => {
      if (active) {
        return;
      }
      active = true;
      dragSuppressClickRef.current = true;
      setContextMenu(null);
      setDragState({
        entry,
        x: latestX,
        y: latestY,
        targetPath: getDropFolderPath(latestX, latestY, entry),
      });
    };

    const finish = async (clientX, clientY) => {
      cleanup();
      if (!active) {
        return;
      }
      dragSuppressClickRef.current = true;
      const targetPath = getDropFolderPath(clientX, clientY, entry);
      setDragState(null);
      if (targetPath) {
        await onMoveEntry?.(entry, targetPath);
      }
    };

    const handleMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      latestX = moveEvent.clientX;
      latestY = moveEvent.clientY;
      const distance = Math.hypot(latestX - startX, latestY - startY);
      if (!active && distance > 2) {
        beginDrag();
      }
      if (active) {
        moveEvent.preventDefault();
        const targetPath = getDropFolderPath(latestX, latestY, entry);
        setDragState((state) => state ? {
          ...state,
          x: latestX,
          y: latestY,
          targetPath,
        } : state);
      }
    };

    const handleUp = (upEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      finish(upEvent.clientX, upEvent.clientY);
    };

    const handleCancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
      setDragState(null);
    };

    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", handleUp, true);
    window.addEventListener("pointercancel", handleCancel, true);
  }, [getDropFolderPath, onMoveEntry]);

  const openTreeContextMenu = useCallback((event, entry) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      entry,
      x: Math.min(event.clientX, window.innerWidth - 210),
      y: Math.min(event.clientY, window.innerHeight - 220),
    });
  }, []);

  const currentFolderContextEntry = useMemo(() => (
    folderState.path ? {
      type: "folder",
      name: displayNameFromPath(folderState.path),
      path: folderState.path,
      hasLetterpapers: true,
      protected: true,
    } : null
  ), [folderState.path]);

  const openBlankAreaContextMenu = useCallback((event) => {
    if (!currentFolderContextEntry) {
      return;
    }
    if (event.target.closest?.(".folder-pathbar, .folder-tree-row, .folder-tree-group, .tree-context-menu")) {
      return;
    }
    openTreeContextMenu(event, currentFolderContextEntry);
  }, [currentFolderContextEntry, openTreeContextMenu]);

  return (
    <aside className="sidebar left-sidebar" id="left-sidebar">
      <section className="sidebar-panel documents-panel">
        <div className="sidebar-heading">
          <div className="sidebar-mode-switch" role="tablist" aria-label="左侧栏模式">
            <button
              type="button"
              className={mode === "folder" ? "active" : ""}
              onClick={() => onModeChange("folder")}
            >
              <img
                className="sidebar-mode-icon"
                src={ICON_ASSETS.sidebarFolderTreeMode}
                alt=""
                aria-hidden="true"
              />
              <span>文件树</span>
            </button>
            <button
              type="button"
              className={mode === "outline" ? "active" : ""}
              onClick={() => onModeChange("outline")}
            >
              <img
                className="sidebar-mode-icon"
                src={ICON_ASSETS.sidebarOutlineMode}
                alt=""
                aria-hidden="true"
              />
              <span>大纲</span>
            </button>
          </div>
        </div>

        {mode === "folder" ? (
          <>
            {folderState.path ? (
              <div
                className={dragState?.targetPath === folderState.path ? "document-list drag-target" : "document-list"}
                data-drop-folder-path={folderState.path}
                onContextMenu={openBlankAreaContextMenu}
              >
                <div className="folder-pathbar">
                  <div
                    className="folder-path-main"
                    title={folderState.path}
                    aria-label={`当前路径：${folderState.path}`}
                    onContextMenu={(event) => openTreeContextMenu(event, {
                      type: "folder",
                      name: displayNameFromPath(folderState.path),
                      path: folderState.path,
                      hasLetterpapers: true,
                      protected: true,
                    })}
                  >
                    <span className="folder-path-meta">
                      <img
                        className="asset-icon folder-path-asset"
                        src={ICON_ASSETS.goldFolderEmpty}
                        alt=""
                        aria-hidden="true"
                      />
                      <span>当前文件夹</span>
                      <i>{folderEntries.length} 项</i>
                    </span>
                    <strong>{displayNameFromPath(folderState.path)}</strong>
                    <small>{folderState.parentPath || folderState.path}</small>
                  </div>
                  <button
                    type="button"
                    className="folder-path-open"
                    onClick={onOpenFolder}
                    aria-label="更换文件夹"
                    title="更换文件夹"
                  >
                    <FolderOpen size={16} />
                    <span>更换</span>
                  </button>
                </div>
                {folderState.parentPath ? (
                  <button
                    type="button"
                    className="folder-tree-row parent-entry"
                    style={{ "--tree-depth": 0 }}
                    onClick={() => onOpenFolderPath(folderState.parentPath)}
                    title="返回上级文件夹"
                  >
                    <span className="folder-disclosure-spacer" />
                    <img className="asset-icon folder-asset-icon" src={ICON_ASSETS.goldFolderEmpty} alt="" aria-hidden="true" />
                    <span>...</span>
                  </button>
                ) : null}
                <div className="folder-entry-scroll">
                  {folderState.loading ? (
                    <p className="empty-folder">正在读取文件树...</p>
                  ) : folderState.error ? (
                    <p className="empty-folder">{folderState.error}</p>
                  ) : folderEntries.length ? (
                    <FolderEntryRows
                      entries={folderEntries}
                      currentPath={currentPath}
                      expandedFolders={expandedFolders}
                      onOpenFile={onOpenFolderFile}
                      onOpenFolderPath={onOpenFolderPath}
                      onToggleFolder={onToggleFolder}
                      onContextMenu={openTreeContextMenu}
                      onDragPointerDown={startTreeDrag}
                      onConsumeDragClick={consumeDragClick}
                      dragTargetPath={dragState?.targetPath || ""}
                    />
                  ) : (
                    <p className="empty-folder">这个文件夹里还没有信笺文档或子文件夹。</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="folder-empty">
                <FileText size={28} />
                <span>打开一个文件夹后，这里会显示其中的信笺文档。</span>
                <button type="button" onClick={onOpenFolder}>打开文件夹</button>
              </div>
            )}
            <TreeContextMenu
              menu={contextMenu}
              onClose={() => setContextMenu(null)}
              onCreateFolder={onCreateFolder}
              onCreateDocument={onCreateDocument}
              onRename={onRenameEntry}
              onBackup={onBackupDocument}
              onDelete={onDeleteEntry}
            />
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
        {dragState ? (
          <div
            className={dragState.targetPath ? "tree-drag-ghost valid" : "tree-drag-ghost"}
            style={{ left: dragState.x + 14, top: dragState.y + 14 }}
            aria-hidden="true"
          >
            <img
              className="asset-icon"
              src={dragState.entry.type === "folder"
                ? (dragState.entry.hasLetterpapers ? ICON_ASSETS.goldFolderFull : ICON_ASSETS.goldFolderEmpty)
                : ICON_ASSETS.brandMark}
              alt=""
            />
            <span>{dragState.entry.displayName || dragState.entry.name}</span>
          </div>
        ) : null}
      </section>
    </aside>
  );
}

function TemplateSelect({ ariaLabel, value, options, onChange, disabled = false, className = "" }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const optionRefs = useRef([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex] || options[0];

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const predictedHeight = Math.min(280, options.length * 36 + 12);
    const availableBelow = window.innerHeight - rect.bottom - 12;
    const openAbove = availableBelow < predictedHeight && rect.top > predictedHeight + 12;
    const width = Math.max(180, rect.width);
    setMenuStyle({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: openAbove ? Math.max(12, rect.top - predictedHeight - 6) : rect.bottom + 6,
      width,
      maxHeight: predictedHeight,
    });
  }, [options.length]);

  const focusOption = useCallback((index) => {
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  }, []);

  const openWithKeyboard = (index) => {
    setOpen(true);
    focusOption(index);
  };

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return undefined;
    }
    updateMenuPosition();
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.document.addEventListener("pointerdown", handlePointerDown, true);
    window.document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown, true);
      window.document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const handleOptionKeyDown = (event, index) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      focusOption((index + direction + options.length) % options.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : options.length - 1);
    }
  };

  const menu = open && menuStyle ? createPortal(
    <div
      ref={menuRef}
      className="template-select-popover"
      role="listbox"
      aria-label={ariaLabel}
      style={menuStyle}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => { optionRefs.current[index] = element; }}
          type="button"
          className={option.value === value ? "template-select-option active" : "template-select-option"}
          role="option"
          aria-selected={option.value === value}
          onKeyDown={(event) => handleOptionKeyDown(event, index)}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
            triggerRef.current?.focus();
          }}
        >
          <span style={option.fontFamily ? { fontFamily: option.fontFamily } : undefined}>{option.label}</span>
          {option.value === value ? <Check size={14} /> : null}
        </button>
      ))}
    </div>,
    window.document.body,
  ) : null;

  return (
    <div ref={rootRef} className={["template-select", open ? "open" : "", className].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        className="template-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openWithKeyboard(selectedIndex);
          }
        }}
      >
        <span style={selectedOption?.fontFamily ? { fontFamily: selectedOption.fontFamily } : undefined}>
          {selectedOption?.label || "请选择"}
        </span>
        <ChevronDown size={15} />
      </button>
      {menu}
    </div>
  );
}

function TemplatePaperPicker({ value, groups, onChange }) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selectedGroup = groups.find((group) => group.options.some((option) => option.value === value)) || groups[0];
  const selectedOption = groups.flatMap((group) => group.options).find((option) => option.value === value)
    || selectedGroup?.options?.[0];
  const [activeGroupId, setActiveGroupId] = useState(() => selectedGroup?.id || "");
  const activeGroup = groups.find((group) => group.id === activeGroupId) || selectedGroup || groups[0];

  useEffect(() => {
    if (selectedGroup?.id) {
      setActiveGroupId(selectedGroup.id);
    }
  }, [selectedGroup?.id, value]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
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
    <div ref={rootRef} className={`template-paper-picker${open ? " open" : ""}`}>
      <button
        type="button"
        className="template-paper-picker-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-label="信纸背景"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span
          className="template-paper-miniature"
          style={{ "--template-bg": `url("${selectedOption?.background}")`, "--swatch": selectedOption?.swatch }}
          aria-hidden="true"
        />
        <span className="template-paper-picker-copy">
          <small>{selectedGroup?.label}</small>
          <strong>{selectedOption?.label || "选择信纸"}</strong>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="template-paper-picker-panel" role="dialog" aria-label="选择信纸背景">
          <div className="template-paper-group-tabs" role="tablist" aria-label="系统信纸分组">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={activeGroup?.id === group.id}
                className={activeGroup?.id === group.id ? "active" : ""}
                onClick={() => setActiveGroupId(group.id)}
              >
                {group.label}
              </button>
            ))}
          </div>
          <div className="template-paper-options" role="listbox" aria-label={activeGroup?.label || "信纸"}>
            {(activeGroup?.options || []).map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={option.value === value ? "active" : ""}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span
                  className="template-paper-option-thumb"
                  style={{ "--template-bg": `url("${option.background}")`, "--swatch": option.swatch }}
                  aria-hidden="true"
                />
                <span>{option.label}</span>
                {option.value === value ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TemplateNameInput({ value, onChange, error = "" }) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);

  useEffect(() => {
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  const commit = () => {
    const normalized = normalizeTemplateName(draftRef.current);
    if (normalized !== value) {
      const accepted = onChange(normalized);
      if (accepted === false) {
        draftRef.current = value;
        setDraft(value);
        return;
      }
    }
    draftRef.current = normalized;
    setDraft(normalized);
  };

  return (
    <div className="template-name-field">
      <label className="template-name-control">
        <Pencil size={15} aria-hidden="true" />
        <input
          value={draft}
          maxLength={TEMPLATE_NAME_MAX_LENGTH}
          onChange={(event) => {
            const nextValue = Array.from(event.target.value).slice(0, TEMPLATE_NAME_MAX_LENGTH).join("");
            draftRef.current = nextValue;
            setDraft(nextValue);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              draftRef.current = value;
              setDraft(value);
              event.currentTarget.blur();
            }
          }}
          aria-label="模板名称"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "template-name-error" : undefined}
        />
        <span className="template-name-count" aria-hidden="true">
          {Array.from(draft).length}/{TEMPLATE_NAME_MAX_LENGTH}
        </span>
      </label>
      {error ? <small id="template-name-error" className="template-name-error" role="alert">{error}</small> : null}
    </div>
  );
}

function TemplateSizeInput({ ariaLabel, value, onChange }) {
  const [draft, setDraft] = useState(String(value));
  const normalizedValue = normalizeTemplateFontSize(value, 16);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (nextDraft = draft) => {
    const nextValue = normalizeTemplateFontSize(nextDraft, normalizedValue);
    setDraft(String(nextValue));
    if (nextValue !== value) {
      onChange(nextValue);
    }
  };

  const step = (delta) => {
    const nextValue = normalizeTemplateFontSize(normalizedValue + delta, normalizedValue);
    setDraft(String(nextValue));
    onChange(nextValue);
  };

  return (
    <div className="template-size-control" title={`字号范围 ${TEMPLATE_FONT_SIZE_MIN}–${TEMPLATE_FONT_SIZE_MAX}`}>
      <button
        type="button"
        disabled={normalizedValue <= TEMPLATE_FONT_SIZE_MIN}
        onClick={() => step(-1)}
        aria-label={`${ariaLabel}减小字号`}
        title="减小字号"
      >
        <Minus size={13} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            step(event.key === "ArrowUp" ? 1 : -1);
          } else if (event.key === "Escape") {
            setDraft(String(normalizedValue));
            event.currentTarget.blur();
          }
        }}
        aria-label={`${ariaLabel}字号`}
        aria-valuemin={TEMPLATE_FONT_SIZE_MIN}
        aria-valuemax={TEMPLATE_FONT_SIZE_MAX}
        aria-valuenow={normalizedValue}
      />
      <button
        type="button"
        disabled={normalizedValue >= TEMPLATE_FONT_SIZE_MAX}
        onClick={() => step(1)}
        aria-label={`${ariaLabel}增大字号`}
        title="增大字号"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

function TemplateSettingSwitch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      className={checked ? "template-setting-switch checked" : "template-setting-switch"}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden="true" />
    </button>
  );
}

function TemplateHeadingColorPicker({ value, onChange, label, disabled = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedOption = TEMPLATE_HEADING_COLOR_OPTIONS.find((option) => option.value === value)
    || TEMPLATE_HEADING_COLOR_OPTIONS[0];

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
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
    <div ref={rootRef} className={`template-heading-color-picker${open ? " open" : ""}`}>
      <button
        type="button"
        className="template-heading-color-trigger"
        aria-label={label}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <i style={{ "--color": selectedOption.value }} aria-hidden="true" />
        <span>{selectedOption.label}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="template-heading-color-options" role="listbox" aria-label={label}>
          {TEMPLATE_HEADING_COLOR_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "active" : ""}
              title={option.label}
              aria-label={option.label}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <i style={{ "--color": option.value }} aria-hidden="true" />
              {option.value === value ? <Check size={12} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LetterTemplateDialog({
  document,
  letterTemplates,
  defaultTemplates,
  userTemplates,
  userTemplateGroups,
  newDocumentTemplateId,
  onClose,
  onLetterTemplateChange,
  onNewDocumentTemplateChange,
  onCreateUserTemplate,
  onUpdateUserTemplate,
  onDeleteUserTemplate,
  onCreateUserTemplateGroup,
  onRenameUserTemplateGroup,
  onDeleteUserTemplateGroup,
  onReorderUserTemplateGroups,
  onMoveUserTemplate,
}) {
  const selectedLetterTemplate = getLetterTemplate(document, letterTemplates);
  const [detailTemplateId, setDetailTemplateId] = useState(() => selectedLetterTemplate.id);
  const [pendingDeleteTemplateId, setPendingDeleteTemplateId] = useState("");
  const [pendingDeleteGroupId, setPendingDeleteGroupId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(() => getLetterTemplateGroupId(selectedLetterTemplate));
  const [editingGroupId, setEditingGroupId] = useState("");
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupNameError, setGroupNameError] = useState("");
  const [templateNameError, setTemplateNameError] = useState("");
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState(null);
  const [groupDragState, setGroupDragState] = useState(null);
  const groupNameInputRef = useRef(null);
  const groupPointerSessionRef = useRef(null);
  const userTemplateGroupsRef = useRef(userTemplateGroups);
  const reorderUserTemplateGroupsRef = useRef(onReorderUserTemplateGroups);
  const groupItemRefs = useRef(new Map());
  const pendingGroupRectsRef = useRef(null);
  const suppressGroupClickRef = useRef(false);
  const groupPickerRef = useRef(null);
  const detailTemplate = draftTemplate || letterTemplates.find((template) => template.id === detailTemplateId);
  const detailIsDraft = Boolean(draftTemplate);
  const detailIsActive = !detailIsDraft && detailTemplate?.id === selectedLetterTemplate.id;
  const newDocumentTemplate = letterTemplates.find((template) => template.id === newDocumentTemplateId)
    || defaultTemplates[0];
  const detailIsNewDocumentDefault = !detailIsDraft && detailTemplate?.id === newDocumentTemplate.id;
  const paperPickerGroups = useMemo(() => {
    return SYSTEM_TEMPLATE_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      options: group.templateIds.map((templateId) => {
        const letterTemplate = defaultTemplates.find((template) => template.id === templateId);
        const paper = TEMPLATES.find((candidate) => candidate.id === letterTemplate?.paperId);
        return paper ? {
          value: paper.id,
          label: paper.label,
          background: paper.background,
          swatch: paper.swatch,
        } : null;
      }).filter(Boolean),
    }));
  }, [defaultTemplates]);
  const pendingDeleteTemplate = userTemplates.find((template) => template.id === pendingDeleteTemplateId);
  const pendingDeleteGroup = userTemplateGroups.find((group) => group.id === pendingDeleteGroupId);
  const selectedSystemGroup = SYSTEM_TEMPLATE_GROUPS.find((group) => group.id === selectedGroupId);
  const selectedUserGroup = userTemplateGroups.find((group) => group.id === selectedGroupId);
  const selectedGroup = selectedSystemGroup || selectedUserGroup || SYSTEM_TEMPLATE_GROUPS[0];
  const selectedGroupTemplates = selectedSystemGroup
    ? defaultTemplates.filter((template) => selectedSystemGroup.templateIds.includes(template.id))
    : userTemplates.filter((template) => template.groupIds?.includes(selectedGroup.id));
  const detailTemplateGroupIds = detailTemplate?.userTemplate
    ? (detailTemplate.groupIds || [BASE_USER_TEMPLATE_GROUP_ID])
    : [];
  const detailPresentation = normalizeTemplatePresentation(detailTemplate?.presentation);

  userTemplateGroupsRef.current = userTemplateGroups;
  reorderUserTemplateGroupsRef.current = onReorderUserTemplateGroups;

  useEffect(() => {
    const availableGroupIds = new Set([
      ...SYSTEM_TEMPLATE_GROUPS.map((group) => group.id),
      ...userTemplateGroups.map((group) => group.id),
    ]);
    if (!availableGroupIds.has(selectedGroupId)) {
      setSelectedGroupId(BASE_USER_TEMPLATE_GROUP_ID);
    }
  }, [selectedGroupId, userTemplateGroups]);

  useEffect(() => {
    if (editingGroupId) {
      groupNameInputRef.current?.focus();
      groupNameInputRef.current?.select();
    }
  }, [editingGroupId]);

  useEffect(() => {
    setGroupPickerOpen(false);
    setAdvancedOpen(false);
    setTemplateNameError("");
  }, [detailTemplateId, draftTemplate?.id]);

  useEffect(() => {
    if (!groupPickerOpen) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (!groupPickerRef.current?.contains(event.target)) {
        setGroupPickerOpen(false);
      }
    };
    window.document.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [groupPickerOpen]);

  useLayoutEffect(() => {
    const previousRects = pendingGroupRectsRef.current;
    if (!previousRects) {
      return;
    }
    pendingGroupRectsRef.current = null;
    groupItemRefs.current.forEach((element, groupId) => {
      if (!element || groupId === groupPointerSessionRef.current?.groupId) {
        return;
      }
      const previousRect = previousRects.get(groupId);
      if (!previousRect) {
        return;
      }
      const nextRect = element.getBoundingClientRect();
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaY) < 1) {
        return;
      }
      element.animate?.(
        [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
        { duration: 190, easing: "cubic-bezier(0.2, 0.78, 0.24, 1)" },
      );
    });
  }, [userTemplateGroups]);

  const beginCreateTemplate = (baseTemplate, requestedGroupId) => {
    const availableGroupIds = new Set(userTemplateGroups.map((group) => group.id));
    const inheritedGroupIds = baseTemplate?.userTemplate && Array.isArray(baseTemplate.groupIds)
      ? baseTemplate.groupIds
      : [BASE_USER_TEMPLATE_GROUP_ID];
    const groupIds = [BASE_USER_TEMPLATE_GROUP_ID];
    [...inheritedGroupIds, requestedGroupId].forEach((groupId) => {
      if (availableGroupIds.has(groupId) && groupId !== BASE_USER_TEMPLATE_GROUP_ID && !groupIds.includes(groupId)) {
        groupIds.push(groupId);
      }
    });
    const nextTemplate = {
      ...createUserTemplate(baseTemplate, groupIds),
      label: createUniqueTemplateName(`${baseTemplate?.label || "信笺模板"} 副本`, letterTemplates),
    };
    setDraftTemplate(nextTemplate);
    setTemplateNameError("");
    setDetailTemplateId("");
    setSelectedGroupId(
      availableGroupIds.has(requestedGroupId)
        ? requestedGroupId
        : groupIds.find((groupId) => groupId !== BASE_USER_TEMPLATE_GROUP_ID) || BASE_USER_TEMPLATE_GROUP_ID,
    );
    setPendingDeleteTemplateId("");
    setPendingDeleteGroupId("");
    setGroupPickerOpen(false);
  };

  const cancelTemplateCreation = () => {
    setDraftTemplate(null);
    setDetailTemplateId("");
    setGroupPickerOpen(false);
  };

  const confirmTemplateCreation = () => {
    if (!draftTemplate) {
      return;
    }
    const duplicateTemplate = letterTemplates.some((template) => (
      template.id !== draftTemplate.id
      && templateNameKey(template.label) === templateNameKey(draftTemplate.label)
    ));
    if (duplicateTemplate) {
      setTemplateNameError("模板名称已存在，请使用其他名称");
      return;
    }
    const createdTemplateId = onCreateUserTemplate(draftTemplate);
    if (createdTemplateId) {
      setDraftTemplate(null);
      setDetailTemplateId(createdTemplateId);
    }
  };

  const confirmDeleteTemplate = () => {
    if (!pendingDeleteTemplate) {
      return;
    }
    onDeleteUserTemplate(pendingDeleteTemplate.id);
    if (detailTemplateId === pendingDeleteTemplate.id) {
      setDetailTemplateId("");
    }
    setPendingDeleteTemplateId("");
  };

  const beginDeleteTemplate = (templateId) => {
    setPendingDeleteTemplateId(templateId);
    setPendingDeleteGroupId("");
    setEditingGroupId("");
  };

  const renderTemplateDeleteDialog = () => pendingDeleteTemplate ? (
    <div className="template-group-dialog-backdrop" role="presentation">
      <section
        className="template-group-dialog delete-mode"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="template-delete-dialog-title"
        aria-describedby="template-delete-dialog-description"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="template-group-dialog-heading">
          <div>
            <h3 id="template-delete-dialog-title">删除模板</h3>
          </div>
        </div>
        <p id="template-delete-dialog-description" className="template-group-dialog-description">
          删除“{pendingDeleteTemplate.label}”？此操作无法撤销。
        </p>
        <div className="template-group-dialog-actions">
          <button type="button" onClick={() => setPendingDeleteTemplateId("")}>取消</button>
          <button type="button" className="danger" onClick={confirmDeleteTemplate}>确认删除</button>
        </div>
      </section>
    </div>
  ) : null;

  const cancelGroupEditing = () => {
    setEditingGroupId("");
    setGroupNameDraft("");
    setGroupNameError("");
  };

  const closeGroupDialog = () => {
    cancelGroupEditing();
    setPendingDeleteGroupId("");
  };

  const beginCreateGroup = () => {
    setPendingDeleteGroupId("");
    setEditingGroupId("new");
    setGroupNameDraft("");
    setGroupNameError("");
  };

  const beginRenameGroup = (group) => {
    setPendingDeleteGroupId("");
    setEditingGroupId(group.id);
    setGroupNameDraft(group.label);
    setGroupNameError("");
  };

  const submitGroupEditing = () => {
    const normalizedName = normalizeTemplateGroupName(groupNameDraft);
    if (!normalizedName) {
      setGroupNameError("请输入分组名称");
      return;
    }
    const duplicateGroup = userTemplateGroups.find((group) => (
      group.id !== editingGroupId
      && group.label.toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
    ));
    if (duplicateGroup) {
      setGroupNameError("已有同名分组");
      return;
    }
    if (editingGroupId === "new") {
      const createdGroupId = onCreateUserTemplateGroup(normalizedName);
      if (createdGroupId) {
        setSelectedGroupId(createdGroupId);
      }
    } else {
      onRenameUserTemplateGroup(editingGroupId, normalizedName);
    }
    cancelGroupEditing();
  };

  const handleGroupEditorKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitGroupEditing();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelGroupEditing();
    }
  };

  const confirmDeleteGroup = () => {
    if (!pendingDeleteGroup || pendingDeleteGroup.id === BASE_USER_TEMPLATE_GROUP_ID) {
      return;
    }
    onDeleteUserTemplateGroup(pendingDeleteGroup.id);
    if (selectedGroupId === pendingDeleteGroup.id) {
      setSelectedGroupId(BASE_USER_TEMPLATE_GROUP_ID);
    }
    setPendingDeleteGroupId("");
  };

  const renderGroupDialog = () => (editingGroupId || pendingDeleteGroup) ? (
    <div className="template-group-dialog-backdrop" role="presentation">
      <section
        className={`template-group-dialog${pendingDeleteGroup ? " delete-mode" : ""}`}
        role={pendingDeleteGroup ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="template-group-dialog-title"
        aria-describedby={pendingDeleteGroup ? "template-group-delete-description" : undefined}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="template-group-dialog-heading">
          <div>
            <h3 id="template-group-dialog-title">
              {pendingDeleteGroup ? "删除分组" : editingGroupId === "new" ? "新建分组" : "重命名分组"}
            </h3>
          </div>
        </div>
        {pendingDeleteGroup ? (
          <p id="template-group-delete-description" className="template-group-dialog-description">
            删除“{pendingDeleteGroup.label}”？其中的
            {userTemplates.filter((template) => template.groupIds?.includes(pendingDeleteGroup.id)).length}
            个模板仍会保留在“我的模板”。
          </p>
        ) : (
          <>
            <label htmlFor="template-group-name">分组名称</label>
            <div className="template-group-dialog-input">
              <input
                ref={groupNameInputRef}
                id="template-group-name"
                value={groupNameDraft}
                maxLength={TEMPLATE_GROUP_NAME_MAX_LENGTH}
                onChange={(event) => {
                  setGroupNameDraft(event.target.value);
                  setGroupNameError("");
                }}
                onKeyDown={handleGroupEditorKeyDown}
                aria-invalid={Boolean(groupNameError)}
                aria-describedby={groupNameError ? "template-group-name-error" : "template-group-name-limit"}
              />
              <small id="template-group-name-limit">
                {Array.from(groupNameDraft).length}/{TEMPLATE_GROUP_NAME_MAX_LENGTH}
              </small>
            </div>
            {groupNameError ? <small id="template-group-name-error" role="alert">{groupNameError}</small> : null}
          </>
        )}
        <div className="template-group-dialog-actions">
          <button type="button" onClick={closeGroupDialog}>取消</button>
          <button
            type="button"
            className={pendingDeleteGroup ? "danger" : "primary"}
            onClick={pendingDeleteGroup ? confirmDeleteGroup : submitGroupEditing}
          >
            {pendingDeleteGroup ? "确认删除" : editingGroupId === "new" ? "新建分组" : "保存名称"}
          </button>
        </div>
      </section>
    </div>
  ) : null;

  const removeGroupPointerListeners = (session) => {
    if (!session) {
      return;
    }
    window.removeEventListener("pointermove", session.handleMove, true);
    window.removeEventListener("pointerup", session.handleUp, true);
    window.removeEventListener("pointercancel", session.handleCancel, true);
    window.removeEventListener("blur", session.handleBlur, true);
  };

  const teardownGroupPointerSession = (session, { suppressClick = false, updateState = true } = {}) => {
    if (!session) {
      return;
    }
    removeGroupPointerListeners(session);
    if (session.element.hasPointerCapture?.(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId);
    }
    if (suppressClick) {
      suppressGroupClickRef.current = true;
      window.setTimeout(() => {
        suppressGroupClickRef.current = false;
      }, 0);
    }
    if (groupPointerSessionRef.current === session) {
      groupPointerSessionRef.current = null;
    }
    if (updateState) {
      setGroupDragState(null);
    }
  };

  const handleGroupPointerDown = (event, group) => {
    if (
      group.id === BASE_USER_TEMPLATE_GROUP_ID
      || event.button !== 0
      || event.target.closest?.(".template-group-actions")
    ) {
      return;
    }
    suppressGroupClickRef.current = false;
    teardownGroupPointerSession(groupPointerSessionRef.current);
    const rect = event.currentTarget.getBoundingClientRect();
    const session = {
      active: false,
      element: event.currentTarget,
      groupId: group.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabOffsetY: event.clientY - rect.top,
      rect,
    };
    session.handleMove = (moveEvent) => handleGroupPointerMove(moveEvent);
    session.handleUp = (upEvent) => finishGroupPointerInteraction(upEvent);
    session.handleCancel = (cancelEvent) => finishGroupPointerInteraction(cancelEvent, true);
    session.handleBlur = () => teardownGroupPointerSession(session, { suppressClick: session.active });
    groupPointerSessionRef.current = session;
    window.addEventListener("pointermove", session.handleMove, true);
    window.addEventListener("pointerup", session.handleUp, true);
    window.addEventListener("pointercancel", session.handleCancel, true);
    window.addEventListener("blur", session.handleBlur, true);
    session.element.setPointerCapture?.(session.pointerId);
  };

  const handleGroupPointerMove = (event) => {
    const session = groupPointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finishGroupPointerInteraction(event, true);
      return;
    }
    const offsetX = event.clientX - session.startX;
    const offsetY = event.clientY - session.startY;
    if (!session.active) {
      if (Math.hypot(offsetX, offsetY) < 3) {
        return;
      }
      session.active = true;
      suppressGroupClickRef.current = true;
    }
    event.preventDefault();
    const reorderableElements = Array.from(
      window.document.querySelectorAll("[data-user-group-reorderable='true']"),
    ).filter((element) => element.dataset.userGroupId !== session.groupId);
    const nextIndex = 1 + reorderableElements.reduce((count, element) => {
      const rect = element.getBoundingClientRect();
      return count + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
    }, 0);
    const currentGroups = userTemplateGroupsRef.current;
    const currentIndex = currentGroups.findIndex((item) => item.id === session.groupId);
    if (nextIndex !== currentIndex && nextIndex >= 1 && nextIndex < currentGroups.length) {
      pendingGroupRectsRef.current = new Map(
        Array.from(groupItemRefs.current.entries()).map(([groupId, element]) => [groupId, element.getBoundingClientRect()]),
      );
      reorderUserTemplateGroupsRef.current(session.groupId, nextIndex);
    }
    setGroupDragState({
      id: session.groupId,
      label: currentGroups.find((item) => item.id === session.groupId)?.label || "用户模板分组",
      left: session.rect.left,
      top: event.clientY - session.grabOffsetY,
      width: session.rect.width,
      height: session.rect.height,
    });
  };

  const finishGroupPointerInteraction = (event, canceled = false) => {
    const session = groupPointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    if (session.active) {
      event.preventDefault?.();
      event.stopPropagation?.();
    }
    teardownGroupPointerSession(session, { suppressClick: session.active });
  };

  useEffect(() => () => {
    teardownGroupPointerSession(groupPointerSessionRef.current, { updateState: false });
  }, []);

  const renderGroupItem = (group, isUserGroup = false) => {
    const count = isUserGroup
      ? userTemplates.filter((template) => template.groupIds?.includes(group.id)).length
      : group.templateIds.length;
    const isSelected = selectedGroupId === group.id;
    const isReorderable = isUserGroup && group.id !== BASE_USER_TEMPLATE_GROUP_ID;
    const isDragging = groupDragState?.id === group.id;
    return (
      <div
        key={group.id}
        ref={(element) => {
          if (element) {
            groupItemRefs.current.set(group.id, element);
          } else {
            groupItemRefs.current.delete(group.id);
          }
        }}
        className={[
          "template-group-item",
          isSelected ? "selected" : "",
          isUserGroup ? "user" : "system",
          isReorderable ? "reorderable" : "",
          isDragging ? "dragging" : "",
        ].filter(Boolean).join(" ")}
        data-user-group-id={isUserGroup ? group.id : undefined}
        data-user-group-reorderable={isReorderable ? "true" : undefined}
        aria-grabbed={isDragging || undefined}
        onPointerDown={isReorderable ? (event) => handleGroupPointerDown(event, group) : undefined}
      >
        <button
          type="button"
          className="template-group-main"
          onClick={() => {
            if (suppressGroupClickRef.current) {
              return;
            }
            setSelectedGroupId(group.id);
            setPendingDeleteGroupId("");
            setPendingDeleteTemplateId("");
          }}
          onKeyDown={(event) => {
            if (!isReorderable || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) {
              return;
            }
            const currentIndex = userTemplateGroups.findIndex((item) => item.id === group.id);
            const targetIndex = event.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
            if (targetIndex < 1 || targetIndex >= userTemplateGroups.length) {
              return;
            }
            event.preventDefault();
            onReorderUserTemplateGroups(group.id, targetIndex);
          }}
          aria-current={isSelected ? "true" : undefined}
          aria-label={`${group.label}，${count} 个模板`}
          aria-keyshortcuts={isReorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          title={isReorderable ? "按住左键拖动排序" : undefined}
        >
          <span>{group.label}<b>({count})</b></span>
        </button>
        {isUserGroup && group.id !== BASE_USER_TEMPLATE_GROUP_ID ? (
          <div className="template-group-actions">
            <button
              type="button"
              onClick={() => beginRenameGroup(group)}
              aria-label={`重命名分组 ${group.label}`}
              title="重命名分组"
            >
              <Pencil size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setPendingDeleteGroupId(group.id);
                setEditingGroupId("");
                setGroupNameError("");
              }}
              aria-label={`删除分组 ${group.label}`}
              title="删除分组"
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const renderTemplateCard = (letterTemplate) => {
    const paper = TEMPLATES.find((template) => template.id === letterTemplate.paperId) || TEMPLATES[0];
    const isActive = selectedLetterTemplate.id === letterTemplate.id;
    const isNewDocumentDefault = newDocumentTemplate.id === letterTemplate.id;
    return (
      <article
        key={letterTemplate.id}
        className={`letter-template-card${isActive ? " active" : ""}${letterTemplate.userTemplate ? " user" : ""}${isNewDocumentDefault ? " new-default" : ""}`}
      >
        <button
          type="button"
          title={letterTemplate.description}
          className="letter-template-card-main"
          onClick={() => setDetailTemplateId(letterTemplate.id)}
          aria-label={`${letterTemplate.label}${isActive ? "，当前使用" : ""}${isNewDocumentDefault ? "，新建默认模板" : ""}`}
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
          </span>
        </button>
        {isNewDocumentDefault ? (
          <span className="letter-template-default-badge" title="新建信笺默认模板">默认</span>
        ) : null}
        {letterTemplate.userTemplate ? (
          <button
            type="button"
            className="letter-template-delete"
            onClick={() => beginDeleteTemplate(letterTemplate.id)}
            aria-label={`删除用户模板 ${letterTemplate.label}`}
            title="删除模板"
          >
            <Trash2 size={14} />
          </button>
        ) : null}
      </article>
    );
  };

  const updateDetailTemplate = (patch) => {
    if (!detailTemplate?.userTemplate) {
      return false;
    }
    let normalizedPatch = patch;
    if (Object.prototype.hasOwnProperty.call(patch, "label")) {
      const normalizedLabel = normalizeTemplateName(patch.label);
      const duplicateTemplate = letterTemplates.some((template) => (
        template.id !== detailTemplate.id
        && templateNameKey(template.label) === templateNameKey(normalizedLabel)
      ));
      if (duplicateTemplate) {
        setTemplateNameError("模板名称已存在，请使用其他名称");
        return false;
      }
      setTemplateNameError("");
      normalizedPatch = { ...patch, label: normalizedLabel };
    }
    if (detailIsDraft) {
      setDraftTemplate((template) => normalizeUserTemplate({ ...template, ...normalizedPatch }, userTemplateGroups));
      return true;
    }
    onUpdateUserTemplate(detailTemplate.id, normalizedPatch);
    return true;
  };

  const updateTypography = (patch) => {
    if (!detailTemplate?.userTemplate) {
      return;
    }
    updateDetailTemplate({ typography: { ...detailTemplate.typography, ...patch } });
  };

  const updatePresentation = (patch) => {
    if (!detailTemplate?.userTemplate) {
      return;
    }
    updateDetailTemplate({
      presentation: normalizeTemplatePresentation({ ...detailTemplate.presentation, ...patch }),
    });
  };

  const changeDetailTemplateGroup = (groupId, shouldInclude) => {
    if (!detailTemplate?.userTemplate || groupId === BASE_USER_TEMPLATE_GROUP_ID) {
      return;
    }
    if (detailIsDraft) {
      const nextGroupIds = shouldInclude
        ? [...new Set([...detailTemplateGroupIds, groupId])]
        : detailTemplateGroupIds.filter((candidateId) => candidateId !== groupId);
      updateDetailTemplate({ groupIds: nextGroupIds });
    } else {
      onMoveUserTemplate(detailTemplate.id, groupId, shouldInclude);
    }
    if (shouldInclude) {
      setSelectedGroupId(groupId);
    }
  };

  const detailPaper = detailTemplate ? TEMPLATES.find((template) => template.id === detailTemplate.paperId) || TEMPLATES[0] : null;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !window.document.querySelector(".template-select.open")) {
        if (editingGroupId) {
          event.preventDefault();
          cancelGroupEditing();
        } else if (groupPickerOpen) {
          event.preventDefault();
          setGroupPickerOpen(false);
        } else if (pendingDeleteGroupId) {
          setPendingDeleteGroupId("");
        } else if (pendingDeleteTemplateId) {
          setPendingDeleteTemplateId("");
        } else if (detailTemplateId) {
          setDetailTemplateId("");
        }
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [detailTemplateId, editingGroupId, groupPickerOpen, onClose, pendingDeleteGroupId, pendingDeleteTemplateId]);

  const content = (
    <div className="template-dialog-overlay" role="presentation">
      <section
        className="template-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="信笺模板"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className={`template-dialog-heading${detailTemplate ? " detail-heading" : ""}`}>
          {detailTemplate && !detailIsDraft ? (
            <button
              type="button"
              className="template-heading-back"
              onClick={() => setDetailTemplateId("")}
              aria-label={`返回${detailTemplate.userTemplate ? "用户模板" : "系统模板"}`}
              title={`返回${detailTemplate.userTemplate ? "用户模板" : "系统模板"}`}
            >
              <ArrowLeft size={16} />
              <span>{detailTemplate.userTemplate ? "用户模板" : "系统模板"}</span>
            </button>
          ) : detailIsDraft ? (
            <h2>新建模板</h2>
          ) : (
            <>
              <h2>信笺模板</h2>
              <button
                type="button"
                className="template-heading-close"
                onClick={onClose}
                aria-label="关闭信笺模板"
                title="关闭信笺模板"
              >
                <X size={18} />
              </button>
            </>
          )}
        </div>
        <section className={`sidebar-panel templates-panel${detailTemplate ? " detail-mode" : " group-mode"}`}>
        {detailTemplate ? (
          <div className="template-detail">
            <div className="template-detail-layout">
              <div className="template-detail-preview-column">
                <div
                  className="template-detail-preview"
                  role="img"
                  aria-label={`${detailTemplate.label}信纸预览`}
                  style={{ "--template-bg": `url("${detailPaper.background}")`, "--swatch": detailPaper.swatch }}
                />
                {!detailIsDraft ? (
                  <>
                    <div className="template-default-setting">
                      <span>设为新建默认模板</span>
                      <button
                        type="button"
                        className={detailIsNewDocumentDefault ? "template-default-switch checked" : "template-default-switch"}
                        role="switch"
                        aria-checked={detailIsNewDocumentDefault}
                        aria-label={detailIsNewDocumentDefault
                          ? `取消将“${detailTemplate.label}”作为新建信笺的默认模板`
                          : `将“${detailTemplate.label}”设为新建信笺的默认模板`}
                        title={detailIsNewDocumentDefault ? "取消并恢复上一个默认模板" : "设为新建默认模板"}
                        onClick={() => onNewDocumentTemplateChange(detailTemplate.id)}
                      >
                        <i aria-hidden="true" />
                      </button>
                    </div>
                    <small className="template-default-current" aria-live="polite">
                      当前新建默认：<strong>{newDocumentTemplate.label}</strong>
                    </small>
                  </>
                ) : null}
              </div>

              <div className="template-detail-settings">
                <div className="template-detail-header">
                  {detailTemplate.userTemplate ? (
                    <TemplateNameInput
                      value={detailTemplate.label}
                      onChange={(label) => updateDetailTemplate({ label })}
                      error={templateNameError}
                    />
                  ) : (
                    <strong>{detailTemplate.label}</strong>
                  )}
                  <div className="template-detail-badges" aria-label={detailTemplate.userTemplate ? "用户模板，可编辑" : "系统模板，不可修改"}>
                    <span className={detailTemplate.userTemplate ? "user" : "system"}>
                      {detailTemplate.userTemplate ? "用户模板" : "系统模板"}
                    </span>
                    <span className={detailTemplate.userTemplate ? "editable" : "readonly"}>
                      {detailTemplate.userTemplate ? "可编辑" : "不可修改"}
                    </span>
                    {detailIsActive ? <span className="current">当前使用</span> : null}
                  </div>
                </div>

                <div className="template-edit-row template-paper-row">
                  <span>信纸背景</span>
                  {detailTemplate.userTemplate ? (
                    <TemplatePaperPicker
                      value={detailTemplate.paperId}
                      groups={paperPickerGroups}
                      onChange={(paperId) => updateDetailTemplate({ paperId })}
                    />
                  ) : (
                    <em>{detailPaper.label}</em>
                  )}
                </div>

                {detailTemplate.userTemplate ? (
                  <div className="template-edit-row template-group-select-row">
                    <span>所属分组</span>
                    <div ref={groupPickerRef} className={`template-group-chip-editor${groupPickerOpen ? " open" : ""}`}>
                      <div className="template-group-chips">
                        {userTemplateGroups
                          .filter((group) => detailTemplateGroupIds.includes(group.id))
                          .map((group) => {
                            const isBaseGroup = group.id === BASE_USER_TEMPLATE_GROUP_ID;
                            return (
                              <span key={group.id} className={`template-group-chip${isBaseGroup ? " required" : ""}`}>
                                <span>{group.label}</span>
                                {isBaseGroup ? <small>固定</small> : (
                                  <button
                                    type="button"
                                    aria-label={`移除分组 ${group.label}`}
                                    title={`移除“${group.label}”`}
                                    onClick={() => changeDetailTemplateGroup(group.id, false)}
                                  >
                                    <X size={12} aria-hidden="true" />
                                  </button>
                                )}
                              </span>
                            );
                          })}
                      <button
                        type="button"
                        className="template-group-add"
                        onClick={() => setGroupPickerOpen((open) => !open)}
                        aria-expanded={groupPickerOpen}
                        aria-controls="template-group-chip-options"
                        aria-label="添加所属分组"
                        disabled={userTemplateGroups.every((group) => detailTemplateGroupIds.includes(group.id))}
                      >
                        <Plus size={13} aria-hidden="true" />
                        <span>添加</span>
                      </button>
                      </div>
                      {groupPickerOpen ? (
                        <div id="template-group-chip-options" className="template-group-chip-options" role="listbox" aria-label="可添加分组">
                          {userTemplateGroups
                            .filter((group) => !detailTemplateGroupIds.includes(group.id))
                            .map((group) => (
                              <button
                                key={group.id}
                                type="button"
                                role="option"
                                aria-selected="false"
                                onClick={() => {
                                  changeDetailTemplateGroup(group.id, true);
                                  setGroupPickerOpen(false);
                                }}
                              >
                                <Plus size={13} aria-hidden="true" />
                                <span>{group.label}</span>
                              </button>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {detailTemplate.userTemplate ? (
                  <div className="template-edit-row template-description-row">
                    <span>封面简介</span>
                    <label className="template-description-control">
                      <input
                        value={detailTemplate.description}
                        maxLength={TEMPLATE_DESCRIPTION_MAX_LENGTH}
                        onChange={(event) => updateDetailTemplate({
                          description: Array.from(event.target.value).slice(0, TEMPLATE_DESCRIPTION_MAX_LENGTH).join(""),
                        })}
                        onBlur={(event) => updateDetailTemplate({ description: normalizeTemplateDescription(event.target.value) })}
                        aria-label="封面简介"
                      />
                      <small aria-hidden="true">
                        {Array.from(detailTemplate.description).length}/{TEMPLATE_DESCRIPTION_MAX_LENGTH}
                      </small>
                    </label>
                  </div>
                ) : null}

                <div className="template-typography-head" aria-hidden="true">
                  <span>排版项目</span>
                  <span>字体</span>
                  <span className="template-size-heading">字号<small>（10–48）</small></span>
                  <span>预览</span>
                </div>
                <div className="template-typography-list">
                  {TYPOGRAPHY_FIELDS.map((field) => (
                    <div key={field.key} className="template-typography-row">
                      <span>{field.label}</span>
                      {detailTemplate.userTemplate ? (
                        <>
                          <TemplateSelect
                            ariaLabel={`${field.label}字体`}
                            value={detailTemplate.typography[field.fontKey]}
                            options={TEMPLATE_FONT_SELECT_OPTIONS}
                            onChange={(font) => updateTypography({ [field.fontKey]: font })}
                          />
                          <TemplateSizeInput
                            ariaLabel={field.label}
                            value={detailTemplate.typography[field.sizeKey]}
                            onChange={(size) => updateTypography({ [field.sizeKey]: size })}
                          />
                        </>
                      ) : (
                        <>
                          <em>{detailTemplate.typography[field.fontKey]}</em>
                          <b>{detailTemplate.typography[field.sizeKey]}</b>
                        </>
                      )}
                      <span
                        className="template-font-preview"
                        title={`${detailTemplate.typography[field.fontKey]} · ${detailTemplate.typography[field.sizeKey]}px`}
                        style={{
                          fontFamily: fontStack(detailTemplate.typography[field.fontKey]),
                          fontSize: `${detailTemplate.typography[field.sizeKey]}px`,
                        }}
                      >
                        春风入信
                      </span>
                    </div>
                  ))}
                </div>

                <section className={`template-advanced-settings${advancedOpen ? " open" : ""}`}>
                  <button
                    type="button"
                    className="template-advanced-trigger"
                    aria-expanded={advancedOpen}
                    aria-controls="template-advanced-options"
                    onClick={() => setAdvancedOpen((current) => !current)}
                  >
                    <span>
                      <Settings size={14} aria-hidden="true" />
                      <strong>高级选项</strong>
                      <small>页面结构、段落与编号</small>
                    </span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                  {advancedOpen ? (
                    <div id="template-advanced-options" className="template-advanced-content">
                      <fieldset>
                        <legend>页面结构</legend>
                        <div className="template-advanced-control-row">
                          <span><strong>文章标题</strong><small>显示信笺顶部标题</small></span>
                          <TemplateSettingSwitch
                            checked={detailPresentation.showDocumentTitle}
                            label="显示文章标题"
                            disabled={!detailTemplate.userTemplate}
                            onChange={(showDocumentTitle) => updatePresentation({ showDocumentTitle })}
                          />
                        </div>
                        <div className="template-advanced-control-row">
                          <span><strong>署名与日期</strong><small>显示作者署名和写作日期</small></span>
                          <TemplateSettingSwitch
                            checked={detailPresentation.showSignatureDate}
                            label="显示署名与日期"
                            disabled={!detailTemplate.userTemplate}
                            onChange={(showSignatureDate) => updatePresentation({ showSignatureDate })}
                          />
                        </div>
                      </fieldset>

                      <fieldset>
                        <legend>正文段落</legend>
                        <div className="template-advanced-control-row">
                          <span><strong>首行缩进</strong><small>普通段落缩进两个汉字</small></span>
                          <TemplateSettingSwitch
                            checked={detailPresentation.indentParagraphs}
                            label="正文段落首行缩进两个字"
                            disabled={!detailTemplate.userTemplate}
                            onChange={(indentParagraphs) => updatePresentation({ indentParagraphs })}
                          />
                        </div>
                        <div className="template-advanced-control-row">
                          <span><strong>默认对齐</strong><small>手动对齐仍可单独覆盖</small></span>
                          <div className="template-paragraph-align" aria-label="正文段落默认对齐">
                            {[
                              { value: "left", label: "偏左", icon: AlignLeft },
                              { value: "center", label: "居中", icon: AlignCenter },
                              { value: "right", label: "偏右", icon: AlignRight },
                            ].map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={detailPresentation.paragraphAlign === option.value ? "active" : ""}
                                aria-pressed={detailPresentation.paragraphAlign === option.value}
                                disabled={!detailTemplate.userTemplate}
                                onClick={() => updatePresentation({ paragraphAlign: option.value })}
                              >
                                <option.icon size={13} aria-hidden="true" />
                                <span>{option.label}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </fieldset>

                      <fieldset className="template-heading-advanced-group">
                        <legend>章节标题</legend>
                        {[1, 2, 3].map((level) => (
                          <div key={level} className="template-heading-advanced-row">
                            <span><strong>{["一", "二", "三"][level - 1]}级标题</strong></span>
                            <TemplateHeadingColorPicker
                              value={detailPresentation.headingColors[level]}
                              label={`${level}级标题颜色`}
                              disabled={!detailTemplate.userTemplate}
                              onChange={(color) => updatePresentation({
                                headingColors: { ...detailPresentation.headingColors, [level]: color },
                              })}
                            />
                            <span className="template-heading-numbering-label">默认编号</span>
                            <TemplateSettingSwitch
                              checked={detailPresentation.headingNumbering[level]}
                              label={`${level}级标题默认编号`}
                              disabled={!detailTemplate.userTemplate}
                              onChange={(checked) => updatePresentation({
                                headingNumbering: { ...detailPresentation.headingNumbering, [level]: checked },
                              })}
                            />
                          </div>
                        ))}
                      </fieldset>

                      <fieldset>
                        <legend>图片标题</legend>
                        <div className="template-advanced-control-row">
                          <span><strong>显示图片标题</strong><small>关闭后保留文字，但页面、导出与 AI 均忽略</small></span>
                          <TemplateSettingSwitch
                            checked={detailPresentation.showImageCaptions}
                            label="显示图片标题"
                            disabled={!detailTemplate.userTemplate}
                            onChange={(showImageCaptions) => updatePresentation({ showImageCaptions })}
                          />
                        </div>
                        <div className={`template-advanced-control-row${!detailPresentation.showImageCaptions ? " disabled" : ""}`}>
                          <span><strong>显示图片编号</strong><small>在标题前显示“图N.”</small></span>
                          <TemplateSettingSwitch
                            checked={detailPresentation.numberImageCaptions}
                            label="显示图片标题编号"
                            disabled={!detailTemplate.userTemplate || !detailPresentation.showImageCaptions}
                            onChange={(numberImageCaptions) => updatePresentation({ numberImageCaptions })}
                          />
                        </div>
                      </fieldset>
                    </div>
                  ) : null}
                </section>

                <div className="template-detail-actions">
                  {detailIsDraft ? (
                    <>
                      <button type="button" className="template-create-confirm-button" onClick={confirmTemplateCreation}>
                        新建模板
                      </button>
                      <button type="button" onClick={cancelTemplateCreation}>取消</button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="template-use-button"
                        onClick={() => {
                          onLetterTemplateChange(detailTemplate.id);
                          onClose?.();
                        }}
                      >
                        使用模板
                      </button>
                      <button
                        type="button"
                        className="template-create-from-button"
                        onClick={() => beginCreateTemplate(detailTemplate)}
                      >
                        <Copy size={15} />
                        <span>基于此新建</span>
                      </button>
                      {detailTemplate.userTemplate ? (
                        <button
                          type="button"
                          className="template-delete-button"
                          onClick={() => beginDeleteTemplate(detailTemplate.id)}
                        >
                          <Trash2 size={14} />
                          <span>删除模板</span>
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="template-group-browser">
            <nav className="template-group-sidebar" aria-label="模板分组">
              <section className="template-group-section" aria-labelledby="system-template-groups-title">
                <div className="template-group-section-heading">
                  <span id="system-template-groups-title">系统模板</span>
                  <small className="template-group-readonly-badge">不可修改</small>
                </div>
                <div className="template-group-list">
                  {SYSTEM_TEMPLATE_GROUPS.map((group) => renderGroupItem(group))}
                </div>
              </section>

              <section className="template-group-section" aria-labelledby="user-template-groups-title">
                <div className="template-group-section-heading">
                  <span id="user-template-groups-title">用户模板</span>
                  <button
                    type="button"
                    onClick={beginCreateGroup}
                    aria-label="新建用户分组"
                    title="新建分组"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <div className="template-group-list">
                  {userTemplateGroups.map((group) => renderGroupItem(group, true))}
                </div>
              </section>
            </nav>

            <section className="template-group-content" aria-labelledby="selected-template-group-title">
              <div className="template-group-content-heading">
                <div>
                  <h3 id="selected-template-group-title">{selectedGroup.label}</h3>
                  <p>{selectedGroupTemplates.length} 个模板</p>
                </div>
                {selectedUserGroup && selectedGroupTemplates.length ? (
                  <button
                    type="button"
                    className="template-create-button"
                    onClick={() => beginCreateTemplate(selectedLetterTemplate, selectedUserGroup.id)}
                  >
                    <Plus size={15} />
                    <span>在此新建模板</span>
                  </button>
                ) : null}
              </div>

              {selectedGroupTemplates.length ? (
                <div className="letter-template-list">
                  {selectedGroupTemplates.map(renderTemplateCard)}
                </div>
              ) : (
                <div className="empty-template-list template-group-empty-state">
                  <FolderOpen size={28} aria-hidden="true" />
                  <strong>这个分组还没有模板</strong>
                  <span>可以从当前信笺模板创建一个可编辑副本。</span>
                  <button
                    type="button"
                    className="template-create-button"
                    onClick={() => beginCreateTemplate(selectedLetterTemplate, selectedGroup.id)}
                  >
                    <Plus size={15} />
                    <span>在此新建模板</span>
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
        </section>
        {renderTemplateDeleteDialog()}
        {renderGroupDialog()}
      </section>
      {groupDragState ? (
        <div
          className="template-group-drag-ghost"
          style={{
            left: `${groupDragState.left}px`,
            top: `${groupDragState.top}px`,
            width: `${groupDragState.width}px`,
            height: `${groupDragState.height}px`,
          }}
          aria-hidden="true"
        >
          <span>{groupDragState.label}</span>
          <small>拖动排序</small>
        </div>
      ) : null}
    </div>
  );

  return createPortal(content, window.document.body);
}

function estimateAuthorWidth(author) {
  const value = author || "署名";
  const width = Array.from(value).reduce((total, character) => (
    total + (/[\u3400-\u9fff]/.test(character) ? 1.05 : 0.56)
  ), 0);
  return `${Math.max(0.76, Math.min(12, width + 0.2))}em`;
}

function PageArticle({ document, selectedTemplate, presentation = DEFAULT_TEMPLATE_PRESENTATION, paperStyle, children, className = "", showHeader = false, onTitleChange, onAuthorChange, onDateChange }) {
  const authorText = document.author?.trim() || "";
  const authorWidth = estimateAuthorWidth(authorText);
  const displayDate = document.displayDate || formatPaperDate(document.createdAt);
  const normalizedPresentation = normalizeTemplatePresentation(presentation);
  const showDocumentTitle = showHeader && normalizedPresentation.showDocumentTitle;
  const showSignatureDate = showHeader && normalizedPresentation.showSignatureDate;
  const hasVisibleHeader = showDocumentTitle || showSignatureDate;
  const presentationClasses = [
    hasVisibleHeader ? "has-paper-header" : "without-paper-header",
    showDocumentTitle ? "shows-document-title" : "hides-document-title",
    showSignatureDate ? "shows-signature-date" : "hides-signature-date",
    normalizedPresentation.indentParagraphs ? "indents-paragraphs" : "flush-paragraphs",
    normalizedPresentation.showImageCaptions ? "shows-image-captions" : "hides-image-captions",
    normalizedPresentation.numberImageCaptions ? "numbers-image-captions" : "plain-image-captions",
  ];

  return (
    <article className={`paper-sheet template-${document.customBackground ? "custom" : document.templateId} ${presentationClasses.join(" ")} ${className}`} style={paperStyle}>
      {hasVisibleHeader ? (
        <header className="paper-header">
          {showDocumentTitle ? (
            <input
              className="paper-title-input"
              value={document.title}
              onChange={(event) => onTitleChange?.(event.target.value)}
              aria-label="文章标题"
              placeholder="未命名信笺"
              spellCheck={false}
            />
          ) : null}
          {showSignatureDate ? (
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
              <span className="paper-meta-prefix">写于</span>
              <input
                className="paper-date-input"
                value={displayDate}
                onChange={(event) => onDateChange?.(event.target.value)}
                aria-label="写作日期"
                spellCheck={false}
              />
            </p>
          ) : null}
        </header>
      ) : null}
      {children}
    </article>
  );
}

function SelectionBubbleToolbar({ editor, disabled, savedSelectionRef, aiCaptureEnabled = false, onCaptureAiSelection, onCreateComment }) {
  const [toolbarPosition, setToolbarPosition] = useState(null);
  const activeColor = editor?.getAttributes("textStyle")?.color || "";
  const activePaletteColor = normalizeColorValue(activeColor);
  const activeBackgroundColor = editor?.getAttributes("highlight")?.color || "";
  const activePaletteBackgroundColor = normalizeBackgroundColorValue(activeBackgroundColor);
  const activeUnderlineStyle = normalizeUnderlineStyle(editor?.getAttributes("underline")?.style);
  const selectedHeading = editor ? getSelectedHeadingNode(editor, savedSelectionRef) : null;
  const selectedHeadingNumberingMode = selectedHeading?.node?.attrs?.numberingMode || "inherit";
  const selectedHeadingLevel = Math.max(1, Math.min(3, Number(selectedHeading?.node?.attrs?.level) || 1));
  const selectedHeadingInheritedNumbering = editor
    ? HEADING_NUMBERING_PLUGIN_KEY.getState(editor.state)?.defaults?.[selectedHeadingLevel] !== false
    : true;
  const selectedHeadingEffectiveNumbering = selectedHeadingNumberingMode === "on"
    || (selectedHeadingNumberingMode === "inherit" && selectedHeadingInheritedNumbering);

  const updateToolbarPosition = useCallback(() => {
    if (!editor || disabled) {
      setToolbarPosition(null);
      return;
    }
    if (selectionTouchesNodeType(editor, "paperTableOfContents")) {
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
    const anchorElement = anchorNode.nodeType === window.Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement;
    const focusElement = focusNode.nodeType === window.Node.ELEMENT_NODE ? focusNode : focusNode.parentElement;
    if (anchorElement?.closest("[data-type='paper-toc'], .node-paperTableOfContents") || focusElement?.closest("[data-type='paper-toc'], .node-paperTableOfContents")) {
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
  }, [disabled, editor, savedSelectionRef]);

  useEffect(() => {
    if (!editor || disabled) {
      setToolbarPosition(null);
      return undefined;
    }
    const updateSoon = () => window.requestAnimationFrame(updateToolbarPosition);
    const hideWhenPointingAtToc = (event) => {
      if (event.target instanceof Element && event.target.closest("[data-type='paper-toc'], .node-paperTableOfContents")) {
        savedSelectionRef.current = null;
        setToolbarPosition(null);
      }
    };
    document.addEventListener("pointerdown", hideWhenPointingAtToc, true);
    document.addEventListener("selectionchange", updateSoon);
    document.addEventListener("scroll", updateSoon, true);
    document.addEventListener("keyup", updateSoon, true);
    editor.view.dom.addEventListener("mouseup", updateSoon);
    editor.view.dom.addEventListener("keyup", updateSoon);
    editor.on("selectionUpdate", updateSoon);
    editor.on("transaction", updateSoon);
    updateSoon();
    return () => {
      document.removeEventListener("selectionchange", updateSoon);
      document.removeEventListener("pointerdown", hideWhenPointingAtToc, true);
      document.removeEventListener("scroll", updateSoon, true);
      document.removeEventListener("keyup", updateSoon, true);
      editor.view.dom.removeEventListener("mouseup", updateSoon);
      editor.view.dom.removeEventListener("keyup", updateSoon);
      editor.off("selectionUpdate", updateSoon);
      editor.off("transaction", updateSoon);
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

  const handleUnderlineStyleChange = useCallback(
    (style) => {
      runSelectionCommand((chain) => chain.setMark("underline", { style: normalizeUnderlineStyle(style) }));
    },
    [runSelectionCommand],
  );

  const handleCaptureAiSelection = useCallback(() => {
    if (!editor || disabled || !aiCaptureEnabled) {
      return;
    }
    onCaptureAiSelection?.(getSelectedPlainText(editor, savedSelectionRef));
    window.requestAnimationFrame(updateToolbarPosition);
  }, [aiCaptureEnabled, disabled, editor, onCaptureAiSelection, savedSelectionRef, updateToolbarPosition]);

  const handleCreateComment = useCallback(() => {
    if (!editor || disabled || !onCreateComment) {
      return;
    }
    onCreateComment?.(getSelectedPlainText(editor, savedSelectionRef), toolbarPosition);
    window.requestAnimationFrame(updateToolbarPosition);
  }, [disabled, editor, onCreateComment, savedSelectionRef, toolbarPosition, updateToolbarPosition]);

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
      <UnderlineStyleMenu
        active={editor.isActive("underline")}
        value={activeUnderlineStyle}
        onToggle={() => runSelectionCommand((chain) => chain.toggleUnderline())}
        onSelect={handleUnderlineStyleChange}
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
      {onCreateComment ? (
        <>
          <span className="bubble-divider" />
          <IconButton
            icon={MessageSquare}
            label="评注"
            onClick={handleCreateComment}
          />
        </>
      ) : null}
      {selectedHeading ? (
        <>
          <span className="bubble-divider" />
          <IconButton
            icon={ListOrdered}
            label={selectedHeadingNumberingMode === "inherit"
              ? (selectedHeadingEffectiveNumbering ? "取消标题计数" : "恢复标题计数")
              : "恢复跟随模板"}
            active={selectedHeadingNumberingMode !== "inherit"}
            onClick={() => {
              toggleSelectedHeadingNumbering(editor, savedSelectionRef);
              window.requestAnimationFrame(updateToolbarPosition);
            }}
          />
        </>
      ) : null}
      {aiCaptureEnabled ? (
        <>
          <span className="bubble-divider" />
          <button type="button" className="selection-ai-capture" onClick={handleCaptureAiSelection} title="标记文字" aria-label="标记文字">
            <Sparkles size={14} />
            <span>标记文字</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

function CommentAnchors({ editor, comments = [], activeCommentId = "", hidden = false, onOpenComment }) {
  const normalizedComments = useMemo(() => normalizeDocumentComments(comments), [comments]);
  const [positions, setPositions] = useState([]);

  const updatePositions = useCallback(() => {
    if (!editor?.view || hidden || !normalizedComments.length) {
      setPositions([]);
      return;
    }
    const sheet = editor.view.dom.closest(".paper-sheet");
    if (!sheet) {
      setPositions([]);
      return;
    }
    const sheetRect = sheet.getBoundingClientRect();
    const maxPosition = editor.state.doc.content.size;
    const topById = buildCommentAnchorTopMap(editor, normalizedComments);
    const commentPresentations = assignDocumentCommentPresentations(normalizedComments, topById);
    const nextPositions = normalizedComments.flatMap((comment) => {
      const from = Math.max(1, Math.min(comment.from, maxPosition));
      const presentation = commentPresentations.get(comment.id);
      const color = presentation?.color || COMMENT_COLOR_PALETTE[0];
      const track = presentation?.track || COMMENT_TRACKS[0];
      try {
        const lineCenter = topById.get(comment.id) || getCommentAnchorTop(editor, from);
        return [{
          id: comment.id,
          top: Math.max(28, (lineCenter || sheetRect.top) - sheetRect.top),
          side: track.side,
          offset: track.offset,
          color,
          comment,
        }];
      } catch {
        return [];
      }
    });
    setPositions(nextPositions);
  }, [editor, hidden, normalizedComments]);

  useEffect(() => {
    if (!editor?.view || hidden) {
      setPositions([]);
      return undefined;
    }
    const updateSoon = () => window.requestAnimationFrame(updatePositions);
    document.addEventListener("scroll", updateSoon, true);
    window.addEventListener("resize", updateSoon);
    editor.on("transaction", updateSoon);
    updateSoon();
    return () => {
      document.removeEventListener("scroll", updateSoon, true);
      window.removeEventListener("resize", updateSoon);
      editor.off("transaction", updateSoon);
    };
  }, [editor, hidden, updatePositions]);

  if (hidden || !positions.length) {
    return null;
  }

  return (
    <div className="comment-anchor-layer" aria-label="评注标记">
      {positions.map(({ id, top, side, offset, color, comment }) => (
        <button
          key={id}
          type="button"
          className={id === activeCommentId ? "comment-anchor active" : "comment-anchor"}
          style={{
            top: `${top}px`,
            ...(side === "left" ? { left: `${18 + offset}px` } : { right: `${18 - offset}px` }),
            "--comment-border": color.border,
            "--comment-bg": color.anchorBg,
            "--comment-ink": color.ink,
          }}
          onClick={(event) => onOpenComment?.(comment, { left: event.clientX, top: event.clientY })}
          title="查看评注"
          aria-label="查看评注"
        >
          <MessageSquare size={15} strokeWidth={2.2} />
        </button>
      ))}
    </div>
  );
}

function getEditorRangeRects(editor, from, to, containerRect) {
  if (!editor?.view || from === to) {
    return [];
  }
  try {
    const start = editor.view.domAtPos(Math.min(from, to));
    const end = editor.view.domAtPos(Math.max(from, to));
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      }));
    range.detach?.();
    const rows = [];
    rects.forEach((rect) => {
      const center = (rect.top + rect.bottom) / 2;
      const row = rows.find((item) => Math.abs(item.center - center) < 4);
      if (row) {
        row.left = Math.min(row.left, rect.left);
        row.right = Math.max(row.right, rect.right);
        row.top = Math.min(row.top, rect.top);
        row.bottom = Math.max(row.bottom, rect.bottom);
        row.center = (row.top + row.bottom) / 2;
      } else {
        rows.push({ ...rect, center });
      }
    });
    return rows.map((row) => ({
      left: row.left - containerRect.left,
      top: row.top - containerRect.top,
      width: row.right - row.left,
      height: row.bottom - row.top,
    }));
  } catch {
    return [];
  }
}

function CommentHighlights({ editor, comments = [], activeCommentId = "", hidden = false }) {
  const normalizedComments = useMemo(() => normalizeDocumentComments(comments), [comments]);
  const [highlights, setHighlights] = useState([]);

  const updateHighlights = useCallback(() => {
    if (!editor?.view || hidden || !activeCommentId || !normalizedComments.length) {
      setHighlights([]);
      return;
    }
    const sheet = editor.view.dom.closest(".paper-sheet");
    if (!sheet) {
      setHighlights([]);
      return;
    }
    const sheetRect = sheet.getBoundingClientRect();
    const maxPosition = editor.state.doc.content.size;
    const topById = buildCommentAnchorTopMap(editor, normalizedComments);
    const commentPresentations = assignDocumentCommentPresentations(normalizedComments, topById);
    const nextHighlights = normalizedComments.filter((comment) => comment.id === activeCommentId).flatMap((comment) => {
      const from = Math.max(1, Math.min(comment.from, maxPosition));
      const to = Math.max(1, Math.min(comment.to, maxPosition));
      const presentation = commentPresentations.get(comment.id);
      const color = presentation?.color || COMMENT_COLOR_PALETTE[0];
      return getEditorRangeRects(editor, from, to, sheetRect).map((rect, index) => ({
        id: `${comment.id}-${index}`,
        rect,
        color,
      }));
    });
    setHighlights(nextHighlights);
  }, [activeCommentId, editor, hidden, normalizedComments]);

  useEffect(() => {
    if (!editor?.view || hidden) {
      setHighlights([]);
      return undefined;
    }
    const updateSoon = () => window.requestAnimationFrame(updateHighlights);
    document.addEventListener("scroll", updateSoon, true);
    window.addEventListener("resize", updateSoon);
    editor.on("transaction", updateSoon);
    updateSoon();
    return () => {
      document.removeEventListener("scroll", updateSoon, true);
      window.removeEventListener("resize", updateSoon);
      editor.off("transaction", updateSoon);
    };
  }, [editor, hidden, updateHighlights]);

  if (hidden || !highlights.length) {
    return null;
  }

  return (
    <div className="comment-highlight-layer" aria-hidden="true">
      {highlights.map(({ id, rect, color }) => (
        <span
          key={id}
          className="comment-highlight-rect"
          style={{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
            "--comment-border": color.border,
            "--comment-bg": color.bg,
          }}
        />
      ))}
    </div>
  );
}

function CommentPanel({ panel, comment, onTextChange, onPositionChange, onSave, onEdit, onDelete, onClose }) {
  const textValue = panel?.mode === "view" ? (comment?.text || "") : (panel?.text || "");
  const isEditing = panel?.mode === "create" || panel?.mode === "edit";
  const title = panel?.mode === "create" ? "新建评注" : (panel?.mode === "edit" ? "编辑评注" : "评注");
  const left = Math.max(12, Math.min(panel?.x || 0, window.innerWidth - 352));
  const top = Math.max(52, Math.min(panel?.y || 0, window.innerHeight - 300));
  const textareaRef = useRef(null);

  const handleDragStart = useCallback((event) => {
    if (event.button !== 0 || event.target.closest?.("button")) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = left;
    const startTop = top;
    const handleMove = (moveEvent) => {
      const nextLeft = Math.max(12, Math.min(startLeft + moveEvent.clientX - startX, window.innerWidth - 352));
      const nextTop = Math.max(52, Math.min(startTop + moveEvent.clientY - startY, window.innerHeight - 180));
      onPositionChange?.({ x: nextLeft, y: nextTop });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", cleanup, true);
      window.removeEventListener("pointercancel", cleanup, true);
    };
    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", cleanup, true);
    window.addEventListener("pointercancel", cleanup, true);
  }, [left, onPositionChange, top]);

  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
    }
  }, [isEditing, panel?.mode]);

  if (!panel) {
    return null;
  }

  return createPortal(
    <section
      className="comment-panel"
      style={{ left, top }}
      onMouseDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-label={title}
    >
      <header onPointerDown={handleDragStart}>
        <span>
          <MessageSquare size={16} />
          {title}
        </span>
        <button type="button" onClick={onClose} aria-label="关闭评注" title="关闭评注">
          <X size={15} />
        </button>
      </header>
      {isEditing ? (
        <textarea
          ref={textareaRef}
          value={panel.text}
          onChange={(event) => onTextChange?.(event.target.value)}
          placeholder="写下这段文字的评注"
          maxLength={2000}
        />
      ) : (
        <p>{textValue}</p>
      )}
      <footer>
        {isEditing ? (
          <>
            <button type="button" className="ghost" onClick={onClose}>取消</button>
            <button type="button" className="primary" disabled={!panel.text?.trim()} onClick={onSave}>
              <Check size={14} />
              <span>保存</span>
            </button>
          </>
        ) : (
          <>
            <button type="button" className="danger" onClick={onDelete}>
              <Trash2 size={14} />
              <span>删除</span>
            </button>
            <button type="button" className="ghost" onClick={onEdit}>
              <Pencil size={14} />
              <span>编辑</span>
            </button>
          </>
        )}
      </footer>
    </section>,
    document.body,
  );
}

function TableContextToolbar({ editor, disabled }) {
  const [toolbarPosition, setToolbarPosition] = useState(null);

  const updateToolbarPosition = useCallback(() => {
    if (!editor || disabled || !editor.isActive("table")) {
      setToolbarPosition(null);
      return;
    }
    const tableElement = getActiveTableElement(editor);
    if (!tableElement) {
      setToolbarPosition(null);
      return;
    }
    const rect = tableElement.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      setToolbarPosition(null);
      return;
    }
    setToolbarPosition({
      left: Math.min(window.innerWidth - 16, rect.right - 8),
      top: Math.max(86, rect.top - 8),
    });
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor || disabled) {
      setToolbarPosition(null);
      return undefined;
    }
    const updateSoon = () => window.requestAnimationFrame(updateToolbarPosition);
    document.addEventListener("scroll", updateSoon, true);
    document.addEventListener("keyup", updateSoon, true);
    editor.view.dom.addEventListener("mouseup", updateSoon);
    editor.view.dom.addEventListener("keyup", updateSoon);
    editor.on("selectionUpdate", updateSoon);
    editor.on("transaction", updateSoon);
    updateSoon();
    return () => {
      document.removeEventListener("scroll", updateSoon, true);
      document.removeEventListener("keyup", updateSoon, true);
      editor.view.dom.removeEventListener("mouseup", updateSoon);
      editor.view.dom.removeEventListener("keyup", updateSoon);
      editor.off("selectionUpdate", updateSoon);
      editor.off("transaction", updateSoon);
    };
  }, [disabled, editor, updateToolbarPosition]);

  const runCommand = useCallback((command) => {
    if (!editor || disabled) {
      return;
    }
    runTableCommand(editor, command);
    window.requestAnimationFrame(updateToolbarPosition);
  }, [disabled, editor, updateToolbarPosition]);

  if (!editor || disabled) {
    return null;
  }

  return (
    <div
      className="table-context-toolbar"
      hidden={!toolbarPosition}
      style={toolbarPosition ? { left: `${toolbarPosition.left}px`, top: `${toolbarPosition.top}px` } : undefined}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" onClick={() => runCommand("addRowBefore")} title="上方插入行" aria-label="上方插入行">
        <Plus size={13} />
        <span>上行</span>
      </button>
      <button type="button" onClick={() => runCommand("addRowAfter")} title="下方插入行" aria-label="下方插入行">
        <Plus size={13} />
        <span>下行</span>
      </button>
      <button type="button" onClick={() => runCommand("deleteRow")} title="删除当前行" aria-label="删除当前行">
        <Trash2 size={13} />
        <span>行</span>
      </button>
      <i aria-hidden="true" />
      <button type="button" onClick={() => runCommand("addColumnBefore")} title="左侧插入列" aria-label="左侧插入列">
        <Plus size={13} />
        <span>左列</span>
      </button>
      <button type="button" onClick={() => runCommand("addColumnAfter")} title="右侧插入列" aria-label="右侧插入列">
        <Plus size={13} />
        <span>右列</span>
      </button>
      <button type="button" onClick={() => runCommand("deleteColumn")} title="删除当前列" aria-label="删除当前列">
        <Trash2 size={13} />
        <span>列</span>
      </button>
      <i aria-hidden="true" />
      <button type="button" className="danger" onClick={() => runCommand("deleteTable")} title="删除表格" aria-label="删除表格">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function getPaperPresentation(document, letterTemplates) {
  const selectedLetterTemplate = getLetterTemplate(document, letterTemplates);
  const selectedPaperId = document.customBackground ? document.templateId : selectedLetterTemplate.paperId;
  const selectedTemplate = TEMPLATES.find((template) => template.id === selectedPaperId) || TEMPLATES[0];
  const typography = selectedLetterTemplate.typography;
  const presentation = normalizeTemplatePresentation(selectedLetterTemplate.presentation);
  return {
    selectedTemplate,
    typography,
    presentation,
    paperStyle: {
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
      "--paragraph-align": presentation.paragraphAlign,
      "--heading-color-1": presentation.headingColors[1],
      "--heading-color-2": presentation.headingColors[2],
      "--heading-color-3": presentation.headingColors[3],
      "--paper-repeat-bg": document.customBackground ? `url("${document.customBackground}")` : `url("${selectedTemplate.slices.repeat}")`,
      "--paper-top-bg": document.customBackground ? "none" : `url("${selectedTemplate.slices.top}")`,
      "--paper-bottom-bg": document.customBackground ? "none" : `url("${selectedTemplate.slices.bottom}")`,
      "--paper-base": selectedTemplate.swatch,
    },
  };
}

function getAiPaperPresentation() {
  const fixedTemplate = DEFAULT_LETTER_TEMPLATES.find((template) => template.id === AI_FIXED_LETTER_TEMPLATE_ID) || DEFAULT_LETTER_TEMPLATES[0];
  return getPaperPresentation({
    letterTemplateId: fixedTemplate.id,
    templateId: fixedTemplate.paperId,
    customBackground: "",
  }, DEFAULT_LETTER_TEMPLATES);
}

function getAiProviderConnectionMeta(providerConfig) {
  if (providerConfig?.transport === "codex-cli") {
    const runtime = providerConfig.runtime || {};
    if (runtime.ready) return { tone: "connected", label: "已连接", shortLabel: "可用", statusLabel: "可用" };
    if (runtime.error) return { tone: "failed", label: "检查失败", shortLabel: "失败", statusLabel: "不可用" };
    if (!runtime.installed && runtime.checkedAt) return { tone: "failed", label: "未安装", shortLabel: "未安装", statusLabel: "不可用" };
    if (runtime.installed && !runtime.authenticated) return { tone: "idle", label: "未登录", shortLabel: "未登录", statusLabel: "未登录" };
    return { tone: "idle", label: "待检查", shortLabel: "待检查", statusLabel: "未配置" };
  }
  const hasAvailableModel = Boolean(providerConfig?.hasApiKey) && providerConfig.models?.some((model) => model.testedOk);
  const hasFailedTest = providerConfig.models?.some((model) => model.testedAt) && !providerConfig.models?.some((model) => model.testedOk);
  if (hasAvailableModel) {
    return { tone: "connected", label: "已连接", shortLabel: "已连接", statusLabel: "可用" };
  }
  if (hasFailedTest) {
    return { tone: "failed", label: "连接失败", shortLabel: "失败", statusLabel: "不可用" };
  }
  return { tone: "idle", label: "未连接", shortLabel: "未连接", statusLabel: providerConfig?.hasApiKey ? "未测试" : "未配置" };
}

function formatAiProviderUpdatedAt(providerConfig) {
  if (providerConfig?.transport === "codex-cli") {
    const checkedAt = Date.parse(providerConfig.runtime?.checkedAt || "");
    return Number.isFinite(checkedAt) ? new Date(checkedAt).toLocaleString("zh-CN", { hour12: false }) : "尚未检查";
  }
  const timestamps = (providerConfig?.models || [])
    .map((model) => Date.parse(model.testedAt || ""))
    .filter((timestamp) => Number.isFinite(timestamp));
  if (!timestamps.length) {
    return "尚未测试";
  }
  const date = new Date(Math.max(...timestamps));
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function AiSettingsDialog({ open, config, onClose, onSave, onCreateProvider, onDeleteProvider, onTest, onClear, onRefreshCodex, onLoginCodex }) {
  const [selectedProvider, setSelectedProvider] = useState("gemini");
  const [selectedModelId, setSelectedModelId] = useState("gemini-default");
  const [drafts, setDrafts] = useState(() => normalizePublicAiConfig(config).providers);
  const [apiKeys, setApiKeys] = useState({});
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [providerEditor, setProviderEditor] = useState(null);
  const [providerCreator, setProviderCreator] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [modelEditor, setModelEditor] = useState(null);
  const initializedOpenRef = useRef(false);
  const codexAutoCheckRef = useRef(false);
  const normalizedConfig = useMemo(() => normalizePublicAiConfig(config), [config]);
  const providerOptions = useMemo(() => Object.values(drafts).map((provider) => ({
    id: provider.provider,
    label: provider.providerLabel,
    transport: provider.transport || "http",
    protocol: provider.protocol,
    builtin: provider.builtin,
    baseUrl: provider.baseUrl,
  })), [drafts]);
  const selectedDraft = drafts[selectedProvider] || normalizePublicAiProviderConfig(selectedProvider);
  const selectedModel = selectedDraft.models.find((model) => model.id === selectedModelId) || selectedDraft.models[0];
  const selectedIsDefault = normalizedConfig.activeProvider === selectedProvider && selectedDraft.activeModelId === selectedModel?.id;
  const selectedProviderOption = getAiProviderDefaults(selectedProvider, selectedDraft);
  const selectedProviderIcon = ICON_ASSETS[selectedProvider];
  const selectedConnection = getAiProviderConnectionMeta(selectedDraft);
  const selectedLastUpdated = formatAiProviderUpdatedAt(selectedDraft);
  const selectedIsCodex = selectedDraft.transport === "codex-cli";

  useEffect(() => {
    if (!open) {
      initializedOpenRef.current = false;
      return;
    }
    if (initializedOpenRef.current) {
      return;
    }
    initializedOpenRef.current = true;
    const normalized = normalizePublicAiConfig(config);
    setSelectedProvider(normalized.activeProvider);
    setSelectedModelId(normalized.activeModelId);
    setDrafts(normalized.providers);
    setApiKeys({});
    setStatus(null);
    setBusy(false);
    setProviderEditor(null);
    setProviderCreator(null);
    setDeleteConfirm(false);
    setModelEditor(null);
    codexAutoCheckRef.current = false;
  }, [config, open]);

  useEffect(() => {
    if (!open) return;
    const codex = normalizedConfig.providers["codex-cli"];
    if (!codex) return;
    setDrafts((previous) => ({ ...previous, "codex-cli": codex }));
  }, [normalizedConfig.providers, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    bridge.setWindowModalOverlay?.(false);
    return () => {
      bridge.setWindowModalOverlay?.(false);
    };
  }, [open]);

  const runAction = useCallback(async (action, patch = {}) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await action({
        provider: selectedProvider,
        modelId: selectedModel?.id,
        modelName: selectedModel?.name,
        model: selectedModel?.model,
        models: selectedDraft.models,
        baseUrl: selectedDraft.baseUrl,
        apiKey: apiKeys[selectedProvider] || "",
        resetTest: !selectedModel?.testedOk && !selectedModel?.testedAt,
        activate: false,
        ...patch,
      });
      setStatus({
        tone: result?.ok === false ? "warning" : "success",
        message: result?.message || "操作完成",
      });
      if (result && (result.provider || result.providers)) {
        const normalized = normalizePublicAiConfig(result);
        setDrafts(normalized.providers);
        setSelectedProvider((current) => (normalized.providers[current] ? current : normalized.activeProvider));
        setSelectedModelId((current) => {
          const providerConfig = normalized.providers[selectedProvider] || normalized.providers[normalized.activeProvider];
          return providerConfig?.models.some((model) => model.id === current) ? current : providerConfig?.activeModelId;
        });
        setApiKeys({});
      }
      return result;
    } catch (error) {
      setStatus({ tone: "warning", message: error?.message || "操作失败" });
      return null;
    } finally {
      setBusy(false);
    }
  }, [apiKeys, selectedDraft.baseUrl, selectedDraft.models, selectedModel?.id, selectedModel?.model, selectedModel?.name, selectedModel?.testedAt, selectedModel?.testedOk, selectedProvider]);

  const refreshCodex = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await onRefreshCodex();
      const normalized = normalizePublicAiConfig(result);
      setDrafts(normalized.providers);
      const codex = normalized.providers["codex-cli"];
      setSelectedModelId((current) => codex?.models.some((model) => model.id === current) ? current : codex?.activeModelId || "");
      setStatus({ tone: result?.ok ? "success" : "warning", message: result?.message || "Codex CLI 检查完成" });
      return result;
    } catch (error) {
      setStatus({ tone: "warning", message: error?.message || "Codex CLI 检查失败" });
      return null;
    } finally {
      setBusy(false);
    }
  }, [onRefreshCodex]);

  useEffect(() => {
    if (!open || !selectedIsCodex || selectedDraft.runtime?.checkedAt || selectedDraft.runtime?.browserOnly || codexAutoCheckRef.current) return;
    codexAutoCheckRef.current = true;
    refreshCodex();
  }, [open, refreshCodex, selectedDraft.runtime?.browserOnly, selectedDraft.runtime?.checkedAt, selectedIsCodex]);

  const loginCodex = useCallback(async () => {
    setBusy(true);
    try {
      const result = await onLoginCodex();
      setStatus({ tone: result?.ok ? "success" : "warning", message: result?.message || "已启动 Codex 登录" });
    } catch (error) {
      setStatus({ tone: "warning", message: error?.message || "无法启动 Codex 登录" });
    } finally {
      setBusy(false);
    }
  }, [onLoginCodex]);

  const saveCodexEffort = useCallback(async (model, reasoningEffort) => {
    const models = selectedDraft.models.map((item) => item.id === model.id ? { ...item, reasoningEffort } : item);
    await runAction(onSave, { modelId: model.id, modelName: model.name, model: model.model, models, resetTest: false });
  }, [onSave, runAction, selectedDraft.models]);

  const openProviderEditor = useCallback(() => {
    setProviderEditor({
      providerLabel: selectedDraft.providerLabel,
      baseUrl: selectedDraft.baseUrl || selectedProviderOption.baseUrl,
      apiKey: "",
    });
  }, [selectedDraft.baseUrl, selectedProviderOption.baseUrl]);

  const saveProviderEditor = useCallback(async () => {
    if (!providerEditor) {
      return;
    }
    const baseUrl = providerEditor.baseUrl.trim() || selectedProviderOption.baseUrl;
    const baseUrlChanged = baseUrl !== selectedDraft.baseUrl;
    const models = baseUrlChanged
      ? selectedDraft.models.map((model) => ({ ...model, testedOk: false, testedAt: "", testMessage: "" }))
      : selectedDraft.models;
    const result = await runAction(onSave, {
      providerLabel: providerEditor.providerLabel,
      baseUrl,
      apiKey: providerEditor.apiKey,
      models,
      resetTest: baseUrlChanged,
    });
    if (result) {
      setProviderEditor(null);
    }
  }, [onSave, providerEditor, runAction, selectedDraft.baseUrl, selectedDraft.models, selectedProviderOption.baseUrl]);

  const openProviderCreator = useCallback(() => {
    setProviderCreator({ providerLabel: "", protocol: "openai", baseUrl: AI_PROTOCOL_OPTIONS[0].baseUrl, error: "" });
  }, []);

  const saveProviderCreator = useCallback(async () => {
    if (!providerCreator) return;
    const providerLabel = providerCreator.providerLabel.trim();
    const baseUrl = providerCreator.baseUrl.trim();
    if (!providerLabel || !baseUrl) {
      setProviderCreator((current) => ({ ...current, error: "请填写供应商名称和 Base URL" }));
      return;
    }
    setBusy(true);
    try {
      const result = await onCreateProvider({ providerLabel, protocol: providerCreator.protocol, baseUrl });
      const normalized = normalizePublicAiConfig(result);
      setDrafts(normalized.providers);
      const createdProvider = result?.createdProvider;
      if (createdProvider && normalized.providers[createdProvider]) {
        setSelectedProvider(createdProvider);
        setSelectedModelId("");
      }
      setStatus({ tone: "success", message: result?.message || "供应商已添加" });
      setProviderCreator(null);
    } catch (error) {
      setProviderCreator((current) => ({ ...current, error: error?.message || "添加供应商失败" }));
    } finally {
      setBusy(false);
    }
  }, [onCreateProvider, providerCreator]);

  const deleteSelectedProvider = useCallback(async () => {
    if (selectedDraft.builtin || normalizedConfig.activeProvider === selectedProvider) return;
    setBusy(true);
    try {
      const result = await onDeleteProvider(selectedProvider);
      const normalized = normalizePublicAiConfig(result);
      setDrafts(normalized.providers);
      setSelectedProvider(normalized.activeProvider);
      setSelectedModelId(normalized.activeModelId);
      setStatus({ tone: "success", message: result?.message || "供应商已删除" });
      setDeleteConfirm(false);
    } catch (error) {
      setStatus({ tone: "warning", message: error?.message || "删除供应商失败" });
    } finally {
      setBusy(false);
    }
  }, [normalizedConfig.activeProvider, onDeleteProvider, selectedDraft.builtin, selectedProvider]);

  const openAddModelEditor = useCallback(() => {
    const providerDraft = drafts[selectedProvider] || normalizePublicAiProviderConfig(selectedProvider);
    const nextIndex = providerDraft.models.length + 1;
    const defaults = getAiProviderDefaults(selectedProvider);
    setModelEditor({
      mode: "add",
      modelId: "",
      name: `模型 ${nextIndex}`,
      model: defaults.model,
    });
  }, [drafts, selectedProvider]);

  const openEditModelEditor = useCallback((model) => {
    setSelectedModelId(model.id);
    setModelEditor({
      mode: "edit",
      modelId: model.id,
      name: model.name,
      model: model.model,
    });
  }, []);

  const saveModelEditor = useCallback(async () => {
    if (!modelEditor) {
      return;
    }
    const providerDraft = drafts[selectedProvider] || normalizePublicAiProviderConfig(selectedProvider);
    const name = modelEditor.name.trim();
    const modelValue = modelEditor.model.trim();
    if (!name || !modelValue) {
      setStatus({ tone: "warning", message: "请填写模型名称和模型" });
      return;
    }
    const existingModel = modelEditor.mode === "edit"
      ? providerDraft.models.find((model) => model.id === modelEditor.modelId)
      : null;
    const modelChanged = !existingModel || existingModel.model !== modelValue;
    const nextModel = normalizePublicAiModelConfig(selectedProvider, {
      ...(existingModel || {}),
      id: existingModel?.id || `${selectedProvider}-custom-${Date.now().toString(36)}`,
      name,
      model: modelValue,
      testedOk: modelChanged ? false : existingModel?.testedOk,
      testedAt: modelChanged ? "" : existingModel?.testedAt,
      testMessage: modelChanged ? "" : existingModel?.testMessage,
    }, providerDraft.models.length);
    const models = existingModel
      ? providerDraft.models.map((model) => (model.id === existingModel.id ? nextModel : model))
      : [...providerDraft.models, nextModel];
    const result = await runAction(onSave, {
      modelId: nextModel.id,
      modelName: nextModel.name,
      model: nextModel.model,
      models,
      resetTest: modelChanged,
    });
    if (result) {
      setSelectedModelId(nextModel.id);
      setModelEditor(null);
    }
  }, [drafts, modelEditor, onSave, runAction, selectedProvider]);

  const removeModelDraft = useCallback(async (modelId) => {
    const providerDraft = drafts[selectedProvider] || normalizePublicAiProviderConfig(selectedProvider);
    if (providerDraft.models.length <= 1 && (providerDraft.builtin || normalizedConfig.activeProvider === selectedProvider)) {
      setStatus({ tone: "warning", message: "至少保留一个模型" });
      return;
    }
    const nextModels = providerDraft.models.filter((model) => model.id !== modelId);
    const nextActiveModelId = providerDraft.activeModelId === modelId
      ? (nextModels[0]?.id || "")
      : providerDraft.activeModelId;
    const nextSelectedModel = nextModels.find((model) => model.id === nextActiveModelId) || nextModels[0];
    setDrafts((previous) => ({
      ...previous,
      [selectedProvider]: {
        ...(previous[selectedProvider] || providerDraft),
        activeModelId: nextActiveModelId,
        models: nextModels,
      },
    }));
    setSelectedModelId(nextSelectedModel?.id || "");
    await runAction(onSave, {
      modelId: nextSelectedModel?.id || "",
      modelName: nextSelectedModel?.name || "",
      model: nextSelectedModel?.model || "",
      models: nextModels,
      resetTest: false,
      activate: normalizedConfig.activeProvider === selectedProvider && providerDraft.activeModelId === modelId,
    });
  }, [drafts, normalizedConfig.activeProvider, onSave, runAction, selectedProvider]);

  const setDefaultModel = useCallback(async (model) => {
    setSelectedModelId(model.id);
    await runAction(onSave, {
      modelId: model.id,
      modelName: model.name,
      model: model.model,
      resetTest: false,
      activate: true,
    });
  }, [onSave, runAction]);

  const testModel = useCallback(async (model) => {
    setSelectedModelId(model.id);
    await runAction(onTest, {
      modelId: model.id,
      modelName: model.name,
      model: model.model,
    });
  }, [onTest, runAction]);

  if (!open) {
    return null;
  }

  return (
    <div className="ai-settings-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="ai-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="ai-settings-close" onClick={onClose} aria-label="关闭 AI 设置" title="关闭">
          <X size={24} strokeWidth={2.6} />
        </button>
        <aside className="ai-settings-sidebar">
          <div className="ai-provider-list-head">
            <strong>供应商</strong>
            <button type="button" onClick={openProviderCreator} disabled={busy} title="添加供应商">
              <Plus size={15} />
              <span>添加供应商</span>
            </button>
          </div>
          <div className="ai-provider-list" aria-label="AI 服务商">
            {providerOptions.map((option) => {
              const providerConfig = drafts[option.id] || normalizePublicAiProviderConfig(option.id);
              const meta = getAiProviderConnectionMeta(providerConfig);
              const isSelected = selectedProvider === option.id;
              const providerIconSrc = ICON_ASSETS[option.id];
              return (
                <button
                  key={option.id}
                  type="button"
                  className={[
                    "ai-provider-card",
                    isSelected ? "selected" : "",
                    meta.tone,
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    setSelectedProvider(option.id);
                    setSelectedModelId((drafts[option.id] || normalizePublicAiProviderConfig(option.id)).activeModelId);
                  }}
                >
                  <span className="ai-provider-icon">
                    {providerIconSrc ? <img src={providerIconSrc} alt="" aria-hidden="true" /> : (option.transport === "codex-cli" ? <SquareTerminal size={22} aria-hidden="true" /> : <Sparkles size={22} aria-hidden="true" />)}
                    {normalizedConfig.activeProvider === option.id ? <span className="ai-provider-default-pill">默</span> : null}
                  </span>
                  <span className="ai-provider-main">
                    <strong>{option.label}</strong>
                    <em>{providerConfig.transport === "codex-cli" ? "本地 Codex CLI" : providerConfig.baseUrl}</em>
                  </span>
                  <span className={`ai-status-pill ${meta.tone}`}>{meta.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </aside>
        <main className="ai-settings-main">
          <header className="ai-settings-main-head">
            <div className="ai-provider-hero">
              <span className="ai-provider-hero-icon">
                {selectedProviderIcon ? <img src={selectedProviderIcon} alt="" aria-hidden="true" /> : (selectedIsCodex ? <SquareTerminal size={30} aria-hidden="true" /> : <Sparkles size={30} aria-hidden="true" />)}
              </span>
              <div>
                <h2 id="ai-settings-title">{selectedDraft.providerLabel}</h2>
                <p>{selectedIsCodex ? "通过本地已登录的 Codex CLI 调用" : selectedDraft.baseUrl}</p>
              </div>
              <span className={`ai-status-pill ${selectedConnection.tone} large`}>
                <CheckCircle2 size={13} />
                {selectedConnection.label}
              </span>
            </div>
            <div className="ai-default-provider-control">
              <span>设为默认供应商</span>
              <button
                type="button"
                className={selectedIsDefault ? "ai-provider-switch-toggle checked" : "ai-provider-switch-toggle"}
                role="switch"
                aria-checked={selectedIsDefault}
                disabled={busy || selectedIsDefault || !selectedModel?.testedOk}
                title={!selectedModel?.testedOk ? (selectedIsCodex ? "请先检查 Codex CLI 并选择可用模型" : "请先测试当前模型") : (selectedIsDefault ? "已是默认供应商" : "设为默认供应商")}
                onClick={() => runAction(onSave, { resetTest: false, activate: true })}
              >
                <span />
              </button>
            </div>
          </header>
          {selectedIsCodex ? (
            <>
              <section className="ai-settings-section ai-codex-status-section">
                <div className="ai-settings-section-head">
                  <h3>本地 Codex CLI</h3>
                  <div className="ai-settings-section-actions">
                    {selectedDraft.runtime?.installed && !selectedDraft.runtime?.authenticated ? (
                      <button type="button" className="primary" disabled={busy} onClick={loginCodex}>
                        <SquareTerminal size={15} /><span>登录 Codex</span>
                      </button>
                    ) : null}
                    <button type="button" disabled={busy} onClick={refreshCodex}>
                      <RefreshCw size={15} className={busy ? "spinning" : ""} /><span>{busy ? "检查中…" : "重新检查"}</span>
                    </button>
                  </div>
                </div>
                <div className="ai-provider-info-grid">
                  <article><SquareTerminal size={17} /><span>安装状态</span><strong>{selectedDraft.runtime?.installed ? "已安装" : "未检测到"}</strong></article>
                  <article><CheckCircle2 size={17} /><span>登录状态</span><strong>{selectedDraft.runtime?.authenticated ? "已登录" : "未登录"}</strong></article>
                  <article><Hash size={17} /><span>CLI 版本</span><strong>{selectedDraft.runtime?.version || "—"}</strong></article>
                  <article><UserRound size={17} /><span>账号</span><strong>{selectedDraft.runtime?.accountLabel || selectedDraft.runtime?.accountType || "—"}{selectedDraft.runtime?.planType ? ` · ${selectedDraft.runtime.planType}` : ""}</strong></article>
                  <article className="ai-provider-info-wide"><Globe2 size={17} /><span>检测路径</span><strong title={selectedDraft.runtime?.executablePath || "自动扫描 PATH 与标准 npm 目录"}>{selectedDraft.runtime?.executablePath || "自动扫描 PATH 与标准 npm 目录"}</strong></article>
                </div>
                {!selectedDraft.runtime?.ready || selectedDraft.runtime?.stale ? (
                  <p className="ai-codex-runtime-note">
                    {selectedDraft.runtime?.message || "点击“重新检查”检测本地 Codex CLI。"}
                  </p>
                ) : null}
                {!selectedDraft.runtime?.installed && selectedDraft.runtime?.checkedAt ? (
                  <p className="ai-codex-install-help">请先安装 Codex CLI：<code>npm install -g @openai/codex</code>，安装完成后重新检查。</p>
                ) : null}
              </section>
              <section className="ai-settings-section">
                <div className="ai-settings-section-head"><h3>Codex 可用模型</h3><span className="ai-settings-muted">推理强度按模型保存</span></div>
                <div className="ai-model-table ai-codex-model-table" aria-label="Codex CLI 模型">
                  <div className="ai-model-table-head"><span>模型名称</span><span>推理强度</span><span>是否默认</span><span>状态</span></div>
                  {selectedDraft.models.length === 0 ? (
                    <div className="ai-model-empty">
                      <SquareTerminal size={24} aria-hidden="true" />
                      <strong>尚未同步模型目录</strong>
                      <span>{selectedDraft.runtime?.authenticated ? "重新检查 Codex CLI 以同步当前账号可用模型。" : "安装并登录 Codex CLI 后即可同步模型。"}</span>
                      <button type="button" disabled={busy} onClick={refreshCodex}><RefreshCw size={15} />重新检查</button>
                    </div>
                  ) : selectedDraft.models.map((model) => {
                    const isModelDefault = normalizedConfig.activeProvider === selectedProvider && selectedDraft.activeModelId === model.id;
                    return (
                      <div key={model.id} className={["ai-model-table-row", model.id === selectedModel?.id ? "selected" : "", model.testedOk ? "available" : ""].filter(Boolean).join(" ")} onClick={() => setSelectedModelId(model.id)}>
                        <div className="ai-model-name-cell"><span className="ai-model-icon"><Bot size={16} /></span><div><strong>{model.name}</strong><em>{model.description || model.model}</em></div></div>
                        <div className="ai-codex-effort-select" onClick={(event) => event.stopPropagation()}>
                          <TemplateSelect
                            ariaLabel={`${model.name} 推理强度`}
                            value={model.reasoningEffort || model.defaultReasoningEffort || ""}
                            options={(model.supportedReasoningEfforts || []).map((option) => ({ value: option.reasoningEffort, label: option.reasoningEffort }))}
                            disabled={busy || !model.supportedReasoningEfforts?.length}
                            onChange={(value) => saveCodexEffort(model, value)}
                          />
                        </div>
                        <button type="button" className={isModelDefault ? "ai-model-default-control selected" : "ai-model-default-control"} disabled={busy || isModelDefault || !model.testedOk} onClick={(event) => { event.stopPropagation(); setDefaultModel(model); }}><span className="ai-model-default-indicator" aria-hidden="true" /><span>{isModelDefault ? "默认" : "设为默认"}</span></button>
                        <span className={`ai-status-pill ${model.testedOk ? "connected" : "idle"}`}>{model.testedOk ? "可用" : "不可用"}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="ai-model-table-foot"><RefreshCw size={14} /><span>上次检查：{selectedLastUpdated}</span></div>
              </section>
            </>
          ) : (
            <>
          <section className="ai-settings-section">
            <div className="ai-settings-section-head">
              <h3>供应商信息</h3>
              <div className="ai-settings-section-actions">
                {!selectedDraft.builtin ? (
                  <button
                    type="button"
                    className="danger"
                    disabled={normalizedConfig.activeProvider === selectedProvider}
                    title={normalizedConfig.activeProvider === selectedProvider ? "请先切换默认供应商" : "删除供应商"}
                    onClick={() => setDeleteConfirm(true)}
                  >
                    <Trash2 size={15} />
                    <span>删除</span>
                  </button>
                ) : null}
                <button type="button" onClick={openProviderEditor}>
                  <Pencil size={15} />
                  <span>编辑</span>
                </button>
              </div>
            </div>
            <div className="ai-provider-info-grid">
              <article>
                <Globe2 size={17} />
                <span>Base URL</span>
                <strong>{selectedDraft.baseUrl}</strong>
              </article>
              <article>
                <KeyRound size={17} />
                <span>API Key</span>
                <strong>{selectedDraft.hasApiKey ? `••••••••••••${selectedDraft.apiKeyLast4 || "****"}` : "未填写"}</strong>
              </article>
              <article>
                <Hash size={17} />
                <span>供应商名称</span>
                <strong>{selectedDraft.providerLabel}</strong>
              </article>
              <article>
                <CheckCircle2 size={17} />
                <span>连接状态</span>
                <strong><i className={`ai-status-pill ${selectedConnection.tone}`}>{selectedConnection.statusLabel}</i></strong>
              </article>
              <article>
                <Sparkles size={17} />
                <span>接口协议</span>
                <strong>{AI_PROTOCOL_OPTIONS.find((option) => option.id === selectedDraft.protocol)?.label || "OpenAI 兼容"}</strong>
              </article>
            </div>
          </section>
          <section className="ai-settings-section">
            <div className="ai-settings-section-head">
              <h3>可用模型</h3>
              <button type="button" onClick={openAddModelEditor}>
                <Plus size={15} />
                <span>添加模型</span>
              </button>
            </div>
            <div className="ai-model-table" aria-label={`${selectedDraft.providerLabel} 模型`}>
              <div className="ai-model-table-head">
                <span>模型名称</span>
                <span>状态</span>
                <span>是否默认</span>
                <span>操作</span>
              </div>
              {selectedDraft.models.length === 0 ? (
                <div className="ai-model-empty">
                  <Bot size={24} aria-hidden="true" />
                  <strong>还没有可用模型</strong>
                  <span>添加模型后，可填写密钥并测试连接。</span>
                  <button type="button" onClick={openAddModelEditor}><Plus size={15} />添加模型</button>
                </div>
              ) : selectedDraft.models.map((model) => {
                const isModelDefault = normalizedConfig.activeProvider === selectedProvider && selectedDraft.activeModelId === model.id;
                const modelTone = model.testedOk ? "connected" : (model.testedAt ? "failed" : "idle");
                return (
                  <div
                    key={model.id}
                    className={[
                      "ai-model-table-row",
                      model.id === selectedModel?.id ? "selected" : "",
                      model.testedOk ? "available" : "",
                    ].filter(Boolean).join(" ")}
                    onClick={() => setSelectedModelId(model.id)}
                  >
                    <div className="ai-model-name-cell">
                      <span className="ai-model-icon"><Bot size={16} /></span>
                      <div>
                        <strong>{model.name}</strong>
                        <em>{model.model}</em>
                      </div>
                    </div>
                    <span className={`ai-status-pill ${modelTone}`}>{model.testedOk ? "可用" : (model.testedAt ? "不可用" : "未测试")}</span>
                    <button
                      type="button"
                      className={isModelDefault ? "ai-model-default-control selected" : "ai-model-default-control"}
                      disabled={busy || isModelDefault || !model.testedOk}
                      title={!model.testedOk ? "请先测试模型" : (isModelDefault ? "默认模型" : "设为默认")}
                      onClick={(event) => {
                        event.stopPropagation();
                        setDefaultModel(model);
                      }}
                    >
                      <span className="ai-model-default-indicator" aria-hidden="true" />
                      <span>{isModelDefault ? "默认" : "设为默认"}</span>
                    </button>
                    <div className="ai-model-actions" aria-label={`${model.name} 操作`}>
                      <button
                        type="button"
                        aria-label={`编辑模型：${model.name}`}
                        title="编辑模型"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedModelId(model.id);
                          openEditModelEditor(model);
                        }}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label={`测试连接：${model.name}`}
                        title="测试连接"
                        onClick={(event) => {
                          event.stopPropagation();
                          testModel(model);
                        }}
                      >
                        <Wifi size={15} />
                      </button>
                      <button
                        type="button"
                        className="danger"
                        aria-label={`删除模型：${model.name}`}
                        disabled={selectedDraft.models.length <= 1 && (selectedDraft.builtin || normalizedConfig.activeProvider === selectedProvider)}
                        title={selectedDraft.models.length <= 1 && (selectedDraft.builtin || normalizedConfig.activeProvider === selectedProvider) ? "至少保留一个模型" : "删除模型"}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeModelDraft(model.id);
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="ai-model-table-foot">
              <RefreshCw size={14} />
              <span>上次更新：{selectedLastUpdated}</span>
            </div>
          </section>
            </>
          )}
        </main>
        {providerCreator ? (
          <div className="ai-settings-subdialog-backdrop" role="presentation" onMouseDown={() => setProviderCreator(null)}>
            <section className="ai-settings-subdialog" role="dialog" aria-modal="true" aria-label="添加供应商" onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <h3>添加供应商</h3>
                <button type="button" onClick={() => setProviderCreator(null)} aria-label="关闭"><X size={16} /></button>
              </header>
              <label>
                <span>供应商名称</span>
                <input autoFocus value={providerCreator.providerLabel} onChange={(event) => setProviderCreator((current) => ({ ...current, providerLabel: event.target.value, error: "" }))} placeholder="例如：公司网关" />
              </label>
              <fieldset className="ai-provider-protocol-fieldset">
                <legend>接口协议</legend>
                <div>
                  {AI_PROTOCOL_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={providerCreator.protocol === option.id ? "selected" : ""}
                      aria-pressed={providerCreator.protocol === option.id}
                      onClick={() => setProviderCreator((current) => ({ ...current, protocol: option.id, baseUrl: option.baseUrl, error: "" }))}
                    >
                      <strong>{option.label}</strong><span>{option.description}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <label>
                <span>Base URL</span>
                <input value={providerCreator.baseUrl} onChange={(event) => setProviderCreator((current) => ({ ...current, baseUrl: event.target.value, error: "" }))} spellCheck={false} />
                <small>填写接口根地址，不含 /chat/completions 或 /messages</small>
              </label>
              {providerCreator.error ? <p className="ai-provider-form-error" role="alert">{providerCreator.error}</p> : null}
              <footer>
                <span />
                <div>
                  <button type="button" onClick={() => setProviderCreator(null)}>取消</button>
                  <button type="button" className="primary" disabled={busy} onClick={saveProviderCreator}>{busy ? "添加中…" : "添加"}</button>
                </div>
              </footer>
            </section>
          </div>
        ) : null}
        {providerEditor ? (
          <div className="ai-settings-subdialog-backdrop" role="presentation" onMouseDown={() => setProviderEditor(null)}>
            <section className="ai-settings-subdialog" role="dialog" aria-modal="true" aria-label="编辑供应商" onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <h3>编辑供应商</h3>
                <button type="button" onClick={() => setProviderEditor(null)} aria-label="关闭">
                  <X size={16} />
                </button>
              </header>
              <label>
                <span>供应商名称</span>
                <input value={providerEditor.providerLabel} disabled={selectedDraft.builtin} onChange={(event) => setProviderEditor((current) => ({ ...current, providerLabel: event.target.value }))} />
              </label>
              <label>
                <span>接口协议</span>
                <input value={AI_PROTOCOL_OPTIONS.find((option) => option.id === selectedDraft.protocol)?.label || "OpenAI 兼容"} disabled />
              </label>
              <label>
                <span>Base URL</span>
                <input value={providerEditor.baseUrl} onChange={(event) => setProviderEditor((current) => ({ ...current, baseUrl: event.target.value }))} spellCheck={false} />
              </label>
              <label>
                <span>API Key</span>
                <input
                  type="password"
                  value={providerEditor.apiKey}
                  onChange={(event) => setProviderEditor((current) => ({ ...current, apiKey: event.target.value }))}
                  placeholder={selectedDraft.hasApiKey ? `已保存，尾号 ${selectedDraft.apiKeyLast4 || "****"}；留空则不修改` : "粘贴 API Key"}
                  spellCheck={false}
                />
              </label>
              <footer>
                <button type="button" className="ghost" disabled={busy || !selectedDraft.hasApiKey} onClick={() => runAction(() => onClear({
                  provider: selectedProvider,
                  modelId: selectedModel?.id,
                  modelName: selectedModel?.name,
                  model: selectedModel?.model,
                  baseUrl: selectedDraft.baseUrl,
                  clearApiKey: true,
                })).then((result) => {
                  if (result) {
                    setProviderEditor(null);
                  }
                })}>
                  清空密钥
                </button>
                <div>
                  <button type="button" onClick={() => setProviderEditor(null)}>取消</button>
                  <button type="button" className="primary" disabled={busy} onClick={saveProviderEditor}>保存</button>
                </div>
              </footer>
            </section>
          </div>
        ) : null}
        {deleteConfirm ? (
          <div className="ai-settings-subdialog-backdrop" role="presentation" onMouseDown={() => setDeleteConfirm(false)}>
            <section className="ai-settings-subdialog ai-provider-delete-dialog" role="alertdialog" aria-modal="true" aria-label="删除供应商" onMouseDown={(event) => event.stopPropagation()}>
              <header><h3>删除供应商</h3><button type="button" onClick={() => setDeleteConfirm(false)} aria-label="关闭"><X size={16} /></button></header>
              <p>确定删除“{selectedDraft.providerLabel}”吗？保存的 API Key 和模型配置也会一并删除，此操作无法撤销。</p>
              <footer><span /><div><button type="button" onClick={() => setDeleteConfirm(false)}>取消</button><button type="button" className="danger-solid" disabled={busy} onClick={deleteSelectedProvider}>{busy ? "删除中…" : "删除"}</button></div></footer>
            </section>
          </div>
        ) : null}
        {modelEditor ? (
          <div className="ai-settings-subdialog-backdrop" role="presentation" onMouseDown={() => setModelEditor(null)}>
            <section className="ai-settings-subdialog" role="dialog" aria-modal="true" aria-label={modelEditor.mode === "add" ? "添加模型" : "编辑模型"} onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <h3>{modelEditor.mode === "add" ? "添加模型" : "编辑模型"}</h3>
                <button type="button" onClick={() => setModelEditor(null)} aria-label="关闭">
                  <X size={16} />
                </button>
              </header>
              <label>
                <span>模型名称</span>
                <input value={modelEditor.name} onChange={(event) => setModelEditor((current) => ({ ...current, name: event.target.value }))} spellCheck={false} />
              </label>
              <label>
                <span>模型</span>
                <input value={modelEditor.model} onChange={(event) => setModelEditor((current) => ({ ...current, model: event.target.value }))} spellCheck={false} />
              </label>
              <footer>
                <button type="button" onClick={() => setModelEditor(null)}>取消</button>
                <button type="button" className="primary" disabled={busy} onClick={saveModelEditor}>保存</button>
              </footer>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function InlineAiText({ text }) {
  return splitInlineMarkdown(text).map((part, index) => {
    if (part.strong) {
      return <strong key={`${index}-${part.text}`}>{part.text}</strong>;
    }
    if (part.emphasis) {
      return <em key={`${index}-${part.text}`}>{part.text}</em>;
    }
    return <span key={`${index}-${part.text}`}>{part.text}</span>;
  });
}

function AiResultBlock({ block, onCopy }) {
  const handleCopy = useCallback(() => onCopy(block), [block, onCopy]);
  if (block.type === "divider") {
    return <hr className="ai-result-divider" />;
  }
  if (block.type === "orderedList" || block.type === "bulletList") {
    const ListTag = block.type === "orderedList" ? "ol" : "ul";
    return (
      <div className="ai-result-block ai-result-list-block">
        <button type="button" className="ai-copy-block" onClick={handleCopy} title="复制这一块" aria-label="复制这一块">
          <Copy size={14} />
        </button>
        <ListTag className="ai-result-list">
          {block.items.map((item, index) => (
            <li key={`${block.type}-${index}-${item.text}`} value={block.type === "orderedList" ? item.number || index + 1 : undefined}>
              <InlineAiText text={item.text} />
            </li>
          ))}
        </ListTag>
      </div>
    );
  }
  if (block.type === "table") {
    return (
      <div className="ai-result-block ai-result-table-wrap">
        <button type="button" className="ai-copy-block" onClick={handleCopy} title="复制这一块" aria-label="复制这一块">
          <Copy size={14} />
        </button>
        <table className="ai-md-table">
          <thead>
            <tr>
              {block.headers.map((cell, cellIndex) => (
                <th key={`table-head-${cellIndex}-${cell}`}>
                  <InlineAiText text={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`table-row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`table-cell-${rowIndex}-${cellIndex}-${cell}`}>
                    <InlineAiText text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.type === "image") {
    return (
      <figure className="ai-result-block ai-result-image" style={{ "--image-width": block.asset?.width || "78%" }}>
        <button type="button" className="ai-copy-block" onClick={handleCopy} title="复制这一块" aria-label="复制这一块">
          <Copy size={14} />
        </button>
        {block.asset?.src ? (
          <img src={block.asset.src} alt={block.asset.alt || block.caption} />
        ) : (
          <div className="ai-missing-image">原图不在当前信笺快照中</div>
        )}
        <figcaption>图{block.number}. {block.caption}</figcaption>
      </figure>
    );
  }
  if (block.type === "quote") {
    const { bodyParts, source } = splitQuoteForDisplay(block.text);
    return (
      <blockquote className="ai-result-block">
        <button type="button" className="ai-copy-block" onClick={handleCopy} title="复制这一块" aria-label="复制这一块">
          <Copy size={14} />
        </button>
        {bodyParts.map((part, index) => (
          <p key={`quote-body-${index}-${part}`}>
            <InlineAiText text={part} />
          </p>
        ))}
        {source ? <p>—— <InlineAiText text={source} /></p> : null}
      </blockquote>
    );
  }
  if (block.type === "heading") {
    const HeadingTag = `h${Math.max(1, Math.min(3, block.level || 2))}`;
    return (
      <HeadingTag className="ai-result-block">
        <button type="button" className="ai-copy-block" onClick={handleCopy} title="复制这一块" aria-label="复制这一块">
          <Copy size={14} />
        </button>
        <InlineAiText text={block.text} />
      </HeadingTag>
    );
  }
  return (
    <p className="ai-result-block">
      <button type="button" className="ai-copy-block" onClick={handleCopy} title="复制这一块" aria-label="复制这一块">
        <Copy size={14} />
      </button>
      <InlineAiText text={block.text} />
    </p>
  );
}

function AiChatAssistantContent({ text }) {
  const blocks = useMemo(() => parseAiResponseBlocks(text), [text]);
  if (!blocks.length) {
    return null;
  }
  return blocks.map((block, index) => {
    if (block.type === "divider") {
      return <hr className="ai-chat-md-divider" key={`divider-${index}`} />;
    }
    if (block.type === "orderedList" || block.type === "bulletList") {
      const ListTag = block.type === "orderedList" ? "ol" : "ul";
      return (
        <ListTag className="ai-chat-md-list" key={`${block.type}-${index}`}>
          {block.items.map((item, itemIndex) => (
            <li key={`${block.type}-${index}-${itemIndex}-${item.text}`} value={block.type === "orderedList" ? item.number || itemIndex + 1 : undefined}>
              <InlineAiText text={item.text} />
            </li>
          ))}
        </ListTag>
      );
    }
    if (block.type === "table") {
      return (
        <div className="ai-chat-md-table-wrap" key={`table-${index}`}>
          <table className="ai-md-table">
            <thead>
              <tr>
                {block.headers.map((cell, cellIndex) => (
                  <th key={`chat-table-head-${index}-${cellIndex}-${cell}`}>
                    <InlineAiText text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`chat-table-row-${index}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td key={`chat-table-cell-${index}-${rowIndex}-${cellIndex}-${cell}`}>
                      <InlineAiText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (block.type === "heading") {
      const HeadingTag = `h${Math.max(1, Math.min(3, block.level || 2))}`;
      return (
        <HeadingTag className="ai-chat-md-heading" data-heading-numbered="false" key={`heading-${index}-${block.text}`}>
          <InlineAiText text={block.text} />
        </HeadingTag>
      );
    }
    if (block.type === "quote") {
      const { bodyParts, source } = splitQuoteForDisplay(block.text);
      return (
        <blockquote className="ai-chat-md-quote" key={`quote-${index}-${block.text}`}>
          {bodyParts.map((part, partIndex) => (
            <p key={`quote-chat-body-${partIndex}-${part}`}>
              <InlineAiText text={part} />
            </p>
          ))}
          {source ? <p>—— <InlineAiText text={source} /></p> : null}
        </blockquote>
      );
    }
    if (block.type === "image") {
      return (
        <p key={`image-${index}-${block.caption}`}>
          图{block.number}. {block.caption}
        </p>
      );
    }
    return (
      <p key={`paragraph-${index}-${block.text}`}>
        <InlineAiText text={block.text} />
      </p>
    );
  });
}

function AiProviderRunSelector({ providers, value, disabled = false, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState("");
  const current = providers.find((provider) => provider.id === value) || providers[0];
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (
        !(event.target instanceof Element) ||
        (!event.target.closest(".ai-provider-switch") && !event.target.closest(".ai-provider-switch-modal"))
      ) {
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
  useEffect(() => {
    if (open && current?.provider) {
      setActiveProviderId(current.provider);
    }
  }, [current?.provider, open]);

  if (!providers.length) {
    return <span className="ai-provider-run-empty">没有已测试可用的模型</span>;
  }
  const groupedProviders = groupTestedAiProviders(providers, AI_PROVIDER_OPTIONS);
  const selectedProviderGroup = groupedProviders.find((provider) => provider.id === (activeProviderId || current?.provider)) || groupedProviders[0];
  const modelSwitchModal = open
    ? createPortal(
        <div className="ai-provider-switch-modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="ai-provider-switch-modal" role="dialog" aria-modal="true" aria-label="选择模型" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <strong>选择模型</strong>
              <span>仅显示已测试可用的模型</span>
            </header>
            <div className="ai-provider-switch-modal-body">
              <aside className="ai-provider-switch-providers" aria-label="供应商">
                {groupedProviders.map((provider) => {
                  const isSelectedProvider = provider.id === selectedProviderGroup?.id;
                  const hasCurrentModel = provider.models.some((model) => model.id === current?.id);
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      className={[
                        "ai-provider-switch-provider-item",
                        isSelectedProvider ? "selected" : "",
                        hasCurrentModel ? "current" : "",
                      ].filter(Boolean).join(" ")}
                      aria-pressed={isSelectedProvider}
                      onClick={() => setActiveProviderId(provider.id)}
                    >
                      <span className="ai-provider-switch-provider-main">
                        <span className="ai-provider-switch-icon">
                          {ICON_ASSETS[provider.id]
                            ? <img src={ICON_ASSETS[provider.id]} alt="" aria-hidden="true" />
                            : (provider.transport === "codex-cli" ? <SquareTerminal size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />)}
                        </span>
                        <span>
                          <strong>{provider.label}</strong>
                          <em>{provider.transport === "codex-cli" ? "本地 Codex CLI" : (provider.protocol === "anthropic" ? "Anthropic 原生" : "OpenAI 兼容")} · {provider.models.length} 个可用模型</em>
                        </span>
                      </span>
                      {hasCurrentModel ? <Check size={14} /> : null}
                    </button>
                  );
                })}
              </aside>
              <section className="ai-provider-switch-models">
                <p>
                  {selectedProviderGroup ? (
                    <>
                      <span className="ai-provider-switch-icon">
                        {ICON_ASSETS[selectedProviderGroup.id]
                          ? <img src={ICON_ASSETS[selectedProviderGroup.id]} alt="" aria-hidden="true" />
                          : (selectedProviderGroup.transport === "codex-cli" ? <SquareTerminal size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />)}
                      </span>
                      <span>{selectedProviderGroup.label}</span>
                    </>
                  ) : null}
                </p>
                <div className="ai-provider-switch-model-list">
                  {selectedProviderGroup?.models.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={model.id === current?.id ? "ai-provider-switch-model-item selected" : "ai-provider-switch-model-item"}
                      aria-pressed={model.id === current?.id}
                      onClick={() => {
                        onChange?.(model.id);
                        setOpen(false);
                      }}
                    >
                      <span>
                        <strong>{model.modelName}</strong>
                        <em>{model.model}</em>
                      </span>
                      {model.id === current?.id ? <Check size={14} /> : null}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>,
        window.document.body,
      )
    : null;

  return (
    <div className={open ? "ai-provider-switch open" : "ai-provider-switch"}>
      <button
        type="button"
        className="ai-provider-switch-button"
        disabled={disabled}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span>切换模型</span>
      </button>
      {modelSwitchModal}
    </div>
  );
}

function joinWorkspacePath(workspacePath, relativePath) {
  const root = String(workspacePath || "").replace(/[\\/]+$/, "");
  if (!root || !relativePath) return root;
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root}${separator}${String(relativePath).split("/").filter(Boolean).join(separator)}`;
}

function CodexScopeTree({ rootPath, nodes, expandedPaths, selectedPath, onToggle, onSelect }) {
  const renderChildren = (parentPath, depth) => {
    const node = nodes[parentPath];
    if (!expandedPaths.has(parentPath)) return null;
    if (node?.loading) return <p className="codex-scope-tree-status" style={{ "--scope-depth": depth + 1 }}>正在读取目录...</p>;
    if (node?.error) return <p className="codex-scope-tree-status error" style={{ "--scope-depth": depth + 1 }}>{node.error}</p>;
    if (!node?.folders?.length) return <p className="codex-scope-tree-status" style={{ "--scope-depth": depth + 1 }}>没有子目录</p>;
    return node.folders.map((folder) => {
      const isExpanded = expandedPaths.has(folder.path);
      const isSelected = selectedPath === folder.path;
      return (
        <div key={folder.path} className="codex-scope-tree-branch">
          <div className={isSelected ? "codex-scope-tree-row selected" : "codex-scope-tree-row"} style={{ "--scope-depth": depth + 1 }}>
            <button type="button" className="codex-scope-tree-toggle" aria-label={isExpanded ? `收起 ${folder.name}` : `展开 ${folder.name}`} aria-expanded={isExpanded} onClick={() => onToggle(folder.path)}>
              <ChevronRight size={14} />
            </button>
            <button type="button" className="codex-scope-tree-folder" onClick={() => onSelect(folder.path)} title={folder.path}>
              <FolderOpen size={15} />
              <span>{folder.name}</span>
              {isSelected ? <Check size={14} /> : null}
            </button>
          </div>
          {renderChildren(folder.path, depth + 1)}
        </div>
      );
    });
  };

  const rootSelected = selectedPath === rootPath;
  const rootExpanded = expandedPaths.has(rootPath);
  return (
    <div className="codex-scope-tree" role="tree" aria-label="工作区目录">
      <div className={rootSelected ? "codex-scope-tree-row root selected" : "codex-scope-tree-row root"} style={{ "--scope-depth": 0 }}>
        <button type="button" className="codex-scope-tree-toggle" aria-label={rootExpanded ? "收起工作区" : "展开工作区"} aria-expanded={rootExpanded} onClick={() => onToggle(rootPath)}>
          <ChevronRight size={14} />
        </button>
        <button type="button" className="codex-scope-tree-folder" onClick={() => onSelect(rootPath)} title={rootPath}>
          <FolderOpen size={15} />
          <span>{displayNameFromPath(rootPath) || "当前工作区"}</span>
          {rootSelected ? <Check size={14} /> : null}
        </button>
      </div>
      {renderChildren(rootPath, 0)}
    </div>
  );
}

function CodexScopeSelector({ scope, imageMode, imageCount = 0, workspacePath, documentPath, disabled = false, onChange, onImageModeChange }) {
  const normalizedScope = normalizeCodexScope(scope);
  const normalizedImageMode = normalizeCodexImageMode(imageMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeNodes, setTreeNodes] = useState({});
  const [expandedPaths, setExpandedPaths] = useState(() => new Set());
  const [pendingPath, setPendingPath] = useState("");
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const documentDirectory = parentPathFromPath(documentPath);
  const documentDirectoryAvailable = Boolean(documentDirectory && relativeCodexScopePath(workspacePath, documentDirectory) !== null);
  const workspaceAvailable = Boolean(workspacePath);

  const loadFolder = useCallback(async (folderPath) => {
    if (!folderPath) return null;
    setTreeNodes((previous) => ({ ...previous, [folderPath]: { ...(previous[folderPath] || {}), loading: true, error: "" } }));
    const result = await listFolderWithTimeout(folderPath);
    if (result?.canceled) {
      setTreeNodes((previous) => ({ ...previous, [folderPath]: { folders: [], loading: false, error: "目录读取失败" } }));
      return null;
    }
    const folders = result.folders || [];
    setTreeNodes((previous) => ({ ...previous, [folderPath]: { folders, loading: false, error: "" } }));
    return folders;
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.document.addEventListener("pointerdown", handlePointerDown, true);
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown, true);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!treeOpen || !workspacePath) return undefined;
    let canceled = false;
    const prepareTree = async () => {
      const expanded = new Set([workspacePath]);
      let currentPath = workspacePath;
      await loadFolder(currentPath);
      if (canceled) return;
      if (normalizedScope.mode === "subdirectory") {
        for (const segment of normalizedScope.relativePath.split("/").filter(Boolean)) {
          expanded.add(currentPath);
          currentPath = joinWorkspacePath(currentPath, segment);
          await loadFolder(currentPath);
          if (canceled) return;
        }
      }
      setExpandedPaths(expanded);
      setPendingPath(normalizedScope.mode === "subdirectory" ? currentPath : workspacePath);
    };
    prepareTree();
    return () => { canceled = true; };
  }, [loadFolder, normalizedScope.mode, normalizedScope.relativePath, treeOpen, workspacePath]);

  useEffect(() => {
    if (!treeOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setTreeOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [treeOpen]);

  const chooseScope = (nextScope) => {
    onChange?.(normalizeCodexScope(nextScope));
    setMenuOpen(false);
    triggerRef.current?.focus();
  };

  const toggleFolder = async (folderPath) => {
    if (expandedPaths.has(folderPath)) {
      setExpandedPaths((previous) => {
        const next = new Set(previous);
        next.delete(folderPath);
        return next;
      });
      return;
    }
    if (!treeNodes[folderPath]) await loadFolder(folderPath);
    setExpandedPaths((previous) => new Set(previous).add(folderPath));
  };

  const options = [
    { mode: "document-only", label: "仅当前信笺", description: "不读取本地目录", disabled: false },
    { mode: "document-directory", label: "信笺所在目录", description: documentDirectoryAvailable ? displayNameFromPath(documentDirectory) : "请先保存到当前工作区", disabled: !documentDirectoryAvailable },
    { mode: "workspace", label: "整个工作区", description: workspaceAvailable ? displayNameFromPath(workspacePath) : "当前没有工作区", disabled: !workspaceAvailable },
    { mode: "subdirectory", label: "选择工作区子目录", description: normalizedScope.mode === "subdirectory" ? (normalizedScope.relativePath || "原目录已失效，请重新选择") : "缩小 Codex 读取范围", disabled: !workspaceAvailable },
  ];

  const treeModal = treeOpen ? createPortal(
    <div className="codex-scope-modal-backdrop" role="presentation" onMouseDown={() => { setTreeOpen(false); triggerRef.current?.focus(); }}>
      <section className="codex-scope-modal" role="dialog" aria-modal="true" aria-labelledby="codex-scope-modal-title" aria-describedby="codex-scope-modal-description" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span className="codex-scope-modal-heading-icon" aria-hidden="true"><FolderOpen size={20} /></span>
          <div className="codex-scope-modal-heading-copy">
            <h2 id="codex-scope-modal-title">选择工作区子目录</h2>
            <p id="codex-scope-modal-description">Codex 只能读取当前工作区以内的目录</p>
          </div>
          <button type="button" className="codex-scope-modal-close" onClick={() => { setTreeOpen(false); triggerRef.current?.focus(); }} aria-label="关闭目录选择" title="关闭"><X size={18} /></button>
        </header>
        <div className="codex-scope-modal-tree">
          <CodexScopeTree rootPath={workspacePath} nodes={treeNodes} expandedPaths={expandedPaths} selectedPath={pendingPath} onToggle={toggleFolder} onSelect={setPendingPath} />
        </div>
        <footer>
          <p><span>当前选择</span><strong title={pendingPath}>{relativeCodexScopePath(workspacePath, pendingPath) || "整个工作区"}</strong></p>
          <div>
            <button type="button" onClick={() => { setTreeOpen(false); triggerRef.current?.focus(); }}>取消</button>
            <button type="button" className="primary" disabled={!pendingPath} onClick={() => {
              const relativePath = relativeCodexScopePath(workspacePath, pendingPath);
              if (relativePath === null) return;
              chooseScope(relativePath ? { mode: "subdirectory", relativePath } : { mode: "workspace" });
              setTreeOpen(false);
            }}>使用此目录</button>
          </div>
        </footer>
      </section>
    </div>,
    window.document.body,
  ) : null;

  return (
    <div ref={rootRef} className={menuOpen ? "codex-scope-switch open" : "codex-scope-switch"}>
      <button ref={triggerRef} type="button" className="codex-scope-switch-button" disabled={disabled} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} title={`Codex 目录范围：${codexScopeLabel(normalizedScope)}`}>
        <FolderOpen size={14} />
        <span>目录范围：{codexScopeLabel(normalizedScope)}</span>
        <ChevronDown size={13} />
      </button>
      {menuOpen ? (
        <div className="codex-scope-menu" role="menu" aria-label="Codex 目录范围">
          {options.map((option) => (
            <button key={option.mode} type="button" role="menuitemradio" aria-checked={normalizedScope.mode === option.mode} disabled={option.disabled} onClick={() => {
              if (option.mode === "subdirectory") {
                setMenuOpen(false);
                setTreeOpen(true);
              } else {
                chooseScope({ mode: option.mode });
              }
            }}>
              <span><strong>{option.label}</strong><em>{option.description}</em></span>
              {normalizedScope.mode === option.mode ? <Check size={14} /> : null}
            </button>
          ))}
          <div className="codex-scope-menu-divider" role="separator" />
          <button
            type="button"
            className="codex-image-mode-option"
            role="menuitemcheckbox"
            aria-checked={normalizedImageMode === "original"}
            disabled={!imageCount}
            onClick={() => onImageModeChange?.(normalizedImageMode === "original" ? "caption-only" : "original")}
          >
            <span>
              <strong>信笺图片</strong>
              <em>{imageCount
                ? (normalizedImageMode === "original" ? `附加全部原图（${imageCount} 张）` : `仅发送图号和标题（${imageCount} 张）`)
                : "当前信笺无图片可附加"}</em>
            </span>
            <span className="codex-image-mode-switch" aria-hidden="true"><i /></span>
          </button>
        </div>
      ) : null}
      {treeModal}
    </div>
  );
}

function AiOptimizeToolbar({
  status,
  hasResult,
  editor,
  savedSelectionRef,
  finalizedBreakInserted,
  availableProviders = [],
  selectedProvider,
  onProviderChange,
  onStart,
  onStop,
  onClear,
}) {
  const isStreaming = status === "streaming";
  const hasUsableProvider = availableProviders.length > 0;
  const selectedRunModel = availableProviders.find((provider) => provider.id === selectedProvider) || availableProviders[0];
  const runModelLabel = selectedRunModel
    ? `${selectedRunModel.providerLabel || "AI"} · ${selectedRunModel.modelName || selectedRunModel.model || "未选择模型"}`
    : "未选择模型";

  return (
    <div className="ai-result-toolbar">
      <div className="ai-result-model-line">
        <p>{runModelLabel}</p>
        <AiProviderRunSelector providers={availableProviders} value={selectedProvider} disabled={isStreaming} onChange={onProviderChange} />
      </div>
      <div className="ai-result-actions">
        <button type="button" disabled={!hasResult || isStreaming} onClick={onClear}>
          <Trash2 size={13} />
          <span>清空</span>
        </button>
        {!isStreaming ? (
          <>
            <button
              type="button"
              disabled={finalizedBreakInserted}
              title={finalizedBreakInserted ? "已经插入一根定稿线，删除后可重新插入" : "插入定稿线"}
              onClick={() => insertFinalizedBreak(editor, savedSelectionRef)}
            >
              <SeparatorHorizontal size={13} />
              <span>{finalizedBreakInserted ? "已插入定稿线" : "插入定稿线"}</span>
            </button>
            <button
              type="button"
              className="primary"
              disabled={!hasUsableProvider}
              title={hasUsableProvider ? (hasResult ? "重新优化" : "开始优化") : "请先配置模型"}
              onClick={onStart}
            >
              <Sparkles size={13} />
              <span>{hasResult ? "重新优化" : "开始优化"}</span>
            </button>
          </>
        ) : null}
        {isStreaming ? (
          <button type="button" onClick={onStop}>
            <Square size={13} />
            <span>停止</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AiChatToolbar({
  availableProviders = [],
  selectedProvider,
  status,
  messages = [],
  hasState = false,
  codexScope,
  codexImageMode,
  imageCount = 0,
  workspacePath,
  documentPath,
  onProviderChange,
  onCodexScopeChange,
  onCodexImageModeChange,
  onStop,
  onClear,
  onExport,
}) {
  const isStreaming = status === "streaming";
  const selectedRunModel = availableProviders.find((provider) => provider.id === selectedProvider) || availableProviders[0];
  const runModelLabel = selectedRunModel
    ? `${selectedRunModel.providerLabel || "AI"} · ${selectedRunModel.modelName || selectedRunModel.model || "未选择模型"}`
    : "未选择模型";

  return (
    <div className="ai-result-toolbar ai-chat-toolbar">
      <div className="ai-result-model-line">
        <p>{runModelLabel}</p>
        <AiProviderRunSelector providers={availableProviders} value={selectedProvider} disabled={isStreaming} onChange={onProviderChange} />
        {selectedRunModel?.transport === "codex-cli" ? (
          <CodexScopeSelector
            scope={codexScope}
            imageMode={codexImageMode}
            imageCount={imageCount}
            workspacePath={workspacePath}
            documentPath={documentPath}
            disabled={isStreaming}
            onChange={onCodexScopeChange}
            onImageModeChange={onCodexImageModeChange}
          />
        ) : null}
      </div>
      <div className="ai-result-actions">
        <button type="button" disabled={!messages.length || isStreaming} onClick={onExport}>
          <Download size={13} />
          <span>另存记录</span>
        </button>
        <button type="button" disabled={!hasState || isStreaming} onClick={onClear}>
          <Trash2 size={13} />
          <span>清空</span>
        </button>
        {isStreaming ? (
          <button type="button" className="danger" onClick={onStop}>
            <Square size={13} />
            <span>停止</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AiResultPane({
  document,
  letterTemplates,
  output,
  status,
  error,
  assets,
  elapsedSeconds,
  tokenStats,
  onCopyBlock,
}) {
  const { selectedTemplate, paperStyle } = useMemo(() => getAiPaperPresentation(), []);
  const blocks = useMemo(() => parseAiResponseBlocks(output, assets), [assets, output]);
  const isStreaming = status === "streaming";
  const isPreparing = status === "ready";
  const tokenValue = tokenStats?.totalTokens
    ? formatTokenUsage(tokenStats.totalTokens, tokenStats?.estimated, tokenStats?.cachedTokens)
    : (isPreparing ? "待开始" : "等待统计");

  return (
    <main className="canvas ai-result-canvas" style={paperStyle}>
      <div className="paper-viewport ai-result-viewport">
        <PageArticle
          document={document}
          selectedTemplate={selectedTemplate}
          paperStyle={paperStyle}
          className="ai-result-sheet"
        >
          <header className="paper-header ai-result-header">
            <h1>AI优化结果</h1>
            <p className="ai-result-subtitle">耗时：{formatElapsedSeconds(elapsedSeconds)} ；Token消耗：{tokenValue}</p>
          </header>
          <div className="paper-editor ai-result-body">
            {error ? <p className="ai-result-error">{error}</p> : null}
            {isPreparing && !error ? (
              <p className="ai-result-placeholder">在左侧原文插入一根“定稿线”，线以上全部作为已定稿背景，不会要求 AI 改写；线以下是本次优化重点。准备好后点击“开始优化”。</p>
            ) : null}
            {!error && !blocks.length && !isPreparing ? (
              <p className="ai-result-placeholder">{isStreaming ? "AI 正在阅读这篇信笺..." : "AI 优化结果会显示在这里。"}</p>
            ) : null}
            {blocks.map((block, index) => (
              <AiResultBlock key={`${block.type}-${index}-${block.text || block.caption || block.number}`} block={block} onCopy={onCopyBlock} />
            ))}
          </div>
        </PageArticle>
      </div>
    </main>
  );
}

function AiChatPane({
  availableProviders = [],
  document,
  letterTemplates,
  messages,
  input,
  selectedTexts = [],
  status,
  error,
  onInputChange,
  onSend,
  onRemoveSelectedText,
  onJumpSelectedText,
  onPresetSelect,
}) {
  const messagesRef = useRef(null);
  const [collapsedMessageIds, setCollapsedMessageIds] = useState(() => new Set());
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const { paperStyle } = useMemo(() => getAiPaperPresentation(), []);
  const isStreaming = status === "streaming";
  const hasUsableProvider = availableProviders.length > 0;
  const canSend = Boolean(input.trim()) && !isStreaming && hasUsableProvider;

  const toggleMessageCollapsed = useCallback((messageId) => {
    setCollapsedMessageIds((previous) => {
      const next = new Set(previous);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const scroller = messagesRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [messages, status]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  }, [canSend, onSend]);

  return (
    <main className="canvas ai-chat-canvas" style={paperStyle}>
      <section className="ai-chat-panel">
        <div ref={messagesRef} className="ai-chat-messages">
          {!messages.length ? (
            <div className="ai-chat-empty">
              <div className="ai-chat-empty-icon" aria-hidden="true">
                <img src={ICON_ASSETS.aiEmptyMark} alt="" />
              </div>
              <strong>围绕当前信笺提问</strong>
              <p>AI 会读取左侧最新内容。图片只会作为“图N.标题”进入上下文。</p>
            </div>
          ) : null}
          {messages.map((message) => {
            const isAssistant = message.role === "assistant";
            const collapsed = isAssistant && collapsedMessageIds.has(message.id);
            const isThinking = isAssistant && message.status === "streaming" && !message.content;
            return (
              <article key={message.id} className={`ai-chat-message ${message.role} ${message.status || ""} ${collapsed ? "collapsed" : ""}`}>
                <header className="ai-chat-message-head">
                  <span className="ai-chat-message-role">
                    {isAssistant ? (
                      <button type="button" className="ai-chat-answer-toggle" onClick={() => toggleMessageCollapsed(message.id)} aria-label={collapsed ? "展开回答" : "折叠回答"} title={collapsed ? "展开回答" : "折叠回答"}>
                        <ChevronDown size={15} />
                      </button>
                    ) : null}
                    {isAssistant ? <Sparkles size={16} /> : <UserRound size={15} />}
                    <strong>{message.role === "user" ? "你" : "AI回答"}</strong>
                    {isAssistant ? (
                      <span className="ai-chat-message-meta inline">
                        <em>耗时：{formatElapsedSeconds(message.elapsedSeconds || 0)}</em>
                        <em>Token：{formatTokenUsage(message.usage, message.usageEstimated, message.cachedTokens)}</em>
                      </span>
                    ) : null}
                  </span>
                  <span className="ai-chat-message-meta">
                    {isAssistant ? (
                      null
                    ) : (
                      <em>{formatChatMessageTime(message)}</em>
                    )}
                  </span>
                </header>
                {collapsed ? (
                  <div className={isThinking ? "ai-chat-message-summary thinking" : "ai-chat-message-summary"}>{summarizeChatMessage(message.content || (message.status === "streaming" ? "正在思考..." : ""))}</div>
                ) : (
                  <div className={isThinking ? "ai-chat-message-body thinking" : "ai-chat-message-body"}>
                    {isAssistant ? (
                      isThinking ? <InlineAiText text="正在思考..." /> : <AiChatAssistantContent text={message.content} />
                    ) : message.content}
                  </div>
                )}
              </article>
            );
          })}
          {error ? <p className="ai-chat-error">{error}</p> : null}
        </div>
        <footer className={[
          "ai-chat-composer",
          selectedTexts.length ? "has-selection" : "",
          composerCollapsed ? "collapsed" : "",
        ].filter(Boolean).join(" ")}>
          <div className="ai-chat-composer-title">
            <span aria-hidden="true">
              <img src={ICON_ASSETS.aiComposerMark} alt="" />
            </span>
            <strong>对这篇信笺提问，或让 AI 帮你审阅、改写、找漏洞...</strong>
            <button type="button" className="ai-chat-composer-collapse" onClick={() => setComposerCollapsed((value) => !value)} aria-label={composerCollapsed ? "展开输入框" : "折叠输入框"} title={composerCollapsed ? "展开输入框" : "折叠输入框"}>
              <ChevronDown size={18} />
            </button>
          </div>
          {composerCollapsed ? null : selectedTexts.length ? (
            <div className="ai-chat-selected-chips" aria-label="已标记文字">
              {selectedTexts.map((selection, index) => (
                <div className="ai-chat-selected-chip" title={selection.text} key={selection.id}>
                  <button type="button" className="ai-chat-selected-chip-main" onClick={() => onJumpSelectedText?.(selection)}>
                    <span className="selected-chip-label">已标记{index + 1}：</span>
                    <span>{summarizeSelectedText(selection.text, 5)}</span>
                  </button>
                  <button type="button" className="ai-chat-selected-chip-remove" onClick={() => onRemoveSelectedText?.(selection.id)} disabled={isStreaming} aria-label={`清除已标记${index + 1}`}>
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {composerCollapsed ? null : (
            <>
              <textarea
                value={input}
                rows={3}
                placeholder="问问这篇信笺，比如：这段逻辑哪里薄弱？标题是否准确？"
                disabled={isStreaming}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                type="button"
                className="ai-chat-send-button"
                disabled={!canSend}
                onClick={onSend}
                title={hasUsableProvider ? "发送" : "请先配置模型"}
                aria-label={hasUsableProvider ? "发送" : "请先配置模型"}
              >
                <Send size={21} />
              </button>
              <div className="ai-chat-presets" aria-label="快捷提问">
                {AI_CHAT_PROMPT_PRESETS.map((preset) => (
                  <button type="button" key={preset.id} disabled={isStreaming} onClick={() => onPresetSelect?.(preset)}>
                    <Sparkles size={12} />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </footer>
      </section>
    </main>
  );
}

function PaperCanvas({
  editor,
  document,
  letterTemplates,
  printMode,
  imageExportMode,
  onTitleChange,
  onAuthorChange,
  onDateChange,
  savedSelectionRef,
  className = "",
  readOnly = false,
  aiCaptureEnabled = false,
  onCaptureAiSelection,
  comments = [],
  activeCommentId = "",
  commentsHidden = false,
  onCreateComment,
  onOpenComment,
  onEditLink,
  onActivate,
  canvasRef,
}) {
  const { selectedTemplate, presentation, paperStyle } = useMemo(() => getPaperPresentation(document, letterTemplates), [document, letterTemplates]);
  const headingNumberingOne = presentation.headingNumbering[1];
  const headingNumberingTwo = presentation.headingNumbering[2];
  const headingNumberingThree = presentation.headingNumbering[3];
  useEffect(() => {
    syncHeadingNumberingDefaults(editor, {
      1: headingNumberingOne,
      2: headingNumberingTwo,
      3: headingNumberingThree,
    });
  }, [editor, headingNumberingOne, headingNumberingThree, headingNumberingTwo]);
  return (
    <main
      ref={canvasRef}
      className={[printMode ? "canvas print-mode" : "canvas", className].filter(Boolean).join(" ")}
      onPointerDown={onActivate}
      onClick={(event) => handleEditorLinkClick(event, {
        editor,
        disabled: printMode || imageExportMode || readOnly,
        onEditLink,
      })}
    >
      <SelectionBubbleToolbar
        editor={editor}
        disabled={printMode || imageExportMode || readOnly}
        savedSelectionRef={savedSelectionRef}
        aiCaptureEnabled={aiCaptureEnabled}
        onCaptureAiSelection={onCaptureAiSelection}
        onCreateComment={onCreateComment}
      />
      <TableContextToolbar editor={editor} disabled={printMode || imageExportMode || readOnly} />
      <div className="paper-viewport">
        <PageArticle
          document={document}
          selectedTemplate={selectedTemplate}
          presentation={presentation}
          paperStyle={paperStyle}
          showHeader
          onTitleChange={onTitleChange}
          onAuthorChange={onAuthorChange}
          onDateChange={onDateChange}
        >
          <EditorContent editor={editor} />
          <CommentHighlights
            editor={editor}
            comments={comments}
            activeCommentId={activeCommentId}
            hidden={commentsHidden}
          />
          <CommentAnchors
            editor={editor}
            comments={comments}
            activeCommentId={activeCommentId}
            hidden={commentsHidden}
            onOpenComment={onOpenComment}
          />
        </PageArticle>
      </div>
    </main>
  );
}

function DocumentTabs({
  tabs,
  activeTabId,
  rightSplitTabId = "",
  onSelectTab,
  onCloseTab,
  onNew,
  onToggleRightSplit,
  onOpenTemplates,
  disabled = false,
  closeDisabled = disabled,
  newDisabled = disabled,
  showNew = true,
  onCapacityChange,
}) {
  const stripRef = useRef(null);
  const listRef = useRef(null);
  const addRef = useRef(null);
  const [atCapacity, setAtCapacity] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);

  useEffect(() => {
    if (!showNew) {
      setAtCapacity(false);
      onCapacityChange?.(false);
      return undefined;
    }
    const strip = stripRef.current;
    const list = listRef.current;
    const add = addRef.current;
    if (!strip || !list || !add) {
      setAtCapacity(false);
      onCapacityChange?.(false);
      return undefined;
    }
    const measureCapacity = () => {
      const isAiStrip = Boolean(strip.closest(".ai-mode-top-strip"));
      const stripStyle = window.getComputedStyle(strip);
      const listStyle = window.getComputedStyle(list);
      const stripGap = Number.parseFloat(stripStyle.columnGap || stripStyle.gap || "0") || 0;
      const listGap = Number.parseFloat(listStyle.columnGap || listStyle.gap || "0") || 0;
      const addWidth = add.getBoundingClientRect().width || (isAiStrip ? 38 : 48);
      const minTabWidth = isAiStrip ? 112 : 120;
      const nextTabCount = tabs.length + 1;
      const nextMinWidth = (nextTabCount * minTabWidth) + (Math.max(0, nextTabCount - 1) * listGap);
      const availableWidth = strip.clientWidth - addWidth - stripGap;
      const nextAtCapacity = nextMinWidth > availableWidth + 0.5;
      setAtCapacity(nextAtCapacity);
      onCapacityChange?.(nextAtCapacity);
    };
    measureCapacity();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureCapacity) : null;
    resizeObserver?.observe(strip);
    window.addEventListener("resize", measureCapacity);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureCapacity);
    };
  }, [onCapacityChange, showNew, tabs.length]);

  const resolvedNewDisabled = newDisabled || atCapacity;
  const addTitle = atCapacity ? "标签栏已满，关闭一个信笺后再新建" : "新建文件";
  const tabsClassName = [
    "document-tabs",
    disabled ? "disabled" : "",
    showNew ? "" : "no-new",
  ].filter(Boolean).join(" ");

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const closeMenu = () => setContextMenu(null);
    window.document.addEventListener("pointerdown", closeMenu);
    window.document.addEventListener("keydown", closeMenu);
    return () => {
      window.document.removeEventListener("pointerdown", closeMenu);
      window.document.removeEventListener("keydown", closeMenu);
    };
  }, [contextMenu]);

  const contextTab = contextMenu ? tabs.find((tab) => tab.id === contextMenu.tabId) : null;
  const splitActionLabel = contextTab?.id === rightSplitTabId
    ? "取消向右分屏"
    : (rightSplitTabId ? "替换右分屏" : "向右分屏");

  return (
    <div className={tabsClassName} aria-label="打开的文件">
      <div className="document-tab-strip" ref={stripRef}>
        <div className="document-tab-list" ref={listRef}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={tab.id === activeTabId ? "document-tab active" : "document-tab"}
              disabled={disabled}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(event) => {
                if ((!onToggleRightSplit && !onOpenTemplates) || disabled) {
                  return;
                }
                event.preventDefault();
                setContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
              }}
              title={tab.path || tab.title}
            >
              {tab.dirty ? <span className="document-tab-dot" /> : null}
              <span>{tab.title || "未命名信笺"}</span>
              {tab.id === rightSplitTabId ? <img className="document-tab-split-mark" src={ICON_ASSETS.rightSplit} alt="右分屏" title="右分屏中" /> : null}
              <i
                role="button"
                tabIndex={closeDisabled ? -1 : 0}
                aria-label={`关闭 ${tab.title || "未命名信笺"}`}
                aria-disabled={closeDisabled}
                onClick={(event) => {
                  event.stopPropagation();
                  if (closeDisabled) {
                    return;
                  }
                  onCloseTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (closeDisabled) {
                    return;
                  }
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
        </div>
        {showNew ? (
          <button type="button" ref={addRef} className="document-tab add" onClick={onNew} disabled={resolvedNewDisabled} aria-label="新建文件" title={addTitle}>
            <Plus size={20} />
          </button>
        ) : null}
      </div>
      {contextMenu && contextTab ? (
        <div
          className="document-tab-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {onOpenTemplates ? (
            <button
              type="button"
              onClick={() => {
                onOpenTemplates?.(contextTab.id);
                setContextMenu(null);
              }}
            >
              <Palette size={15} />
              <span>修改信笺模板</span>
            </button>
          ) : null}
          {onToggleRightSplit ? (
          <button
            type="button"
            onClick={() => {
              onToggleRightSplit?.(contextTab.id);
              setContextMenu(null);
            }}
          >
            <PanelRightClose size={15} />
            <span>{splitActionLabel}</span>
          </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AppConfirmDialog({ dialog, onResolve }) {
  useEffect(() => {
    if (!dialog) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onResolve(dialog.cancelValue);
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [dialog, onResolve]);

  if (!dialog) {
    return null;
  }

  const Icon = dialog.icon || HelpCircle;
  const content = (
    <div className="app-confirm-overlay" role="presentation" onMouseDown={() => onResolve(dialog.cancelValue)}>
      <section
        className={`app-confirm-dialog ${dialog.tone || "default"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="app-confirm-close" onClick={() => onResolve(dialog.cancelValue)} aria-label="关闭提示" title="关闭提示">
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true">
          <Icon size={24} />
        </div>
        <div className="app-confirm-copy">
          {dialog.eyebrow ? <span>{dialog.eyebrow}</span> : null}
          <h2 id="app-confirm-title">{dialog.title}</h2>
          {dialog.message ? <p className="app-confirm-message">{dialog.message}</p> : null}
          {dialog.detail ? <p className="app-confirm-detail">{dialog.detail}</p> : null}
        </div>
        <footer className="app-confirm-actions">
          {dialog.actions.map((action) => {
            const ActionIcon = action.icon;
            return (
              <button
                key={action.value}
                type="button"
                className={action.variant || "secondary"}
                onClick={() => onResolve(action.value)}
                autoFocus={Boolean(action.autoFocus)}
              >
                {ActionIcon ? <ActionIcon size={15} /> : null}
                <span>{action.label}</span>
              </button>
            );
          })}
        </footer>
      </section>
    </div>
  );

  return createPortal(content, window.document.body);
}

function AppPromptDialog({ dialog, onResolve }) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (!dialog) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onResolve(null);
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [dialog, onResolve]);

  if (!dialog) {
    return null;
  }

  const Icon = dialog.icon || Pencil;
  const content = (
    <div className="app-confirm-overlay" role="presentation" onMouseDown={() => onResolve(null)}>
      <form
        className="app-confirm-dialog app-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-prompt-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onResolve(inputRef.current?.value || "");
        }}
      >
        <button type="button" className="app-confirm-close" onClick={() => onResolve(null)} aria-label="关闭提示" title="关闭提示">
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true">
          <Icon size={24} />
        </div>
        <div className="app-confirm-copy">
          {dialog.eyebrow ? <span>{dialog.eyebrow}</span> : null}
          <h2 id="app-prompt-title">{dialog.title}</h2>
          {dialog.message ? <p className="app-confirm-message">{dialog.message}</p> : null}
          <label className="app-prompt-field">
            <span>{dialog.label || "名称"}</span>
            <input
              ref={inputRef}
              type="text"
              defaultValue={dialog.defaultValue || ""}
              placeholder={dialog.placeholder || ""}
              maxLength={dialog.maxLength || 120}
            />
          </label>
        </div>
        <footer className="app-confirm-actions">
          <button type="button" className="ghost" onClick={() => onResolve(null)}>
            <span>取消</span>
          </button>
          <button type="submit" className="primary">
            <Check size={15} />
            <span>{dialog.confirmLabel || "确定"}</span>
          </button>
        </footer>
      </form>
    </div>
  );

  return createPortal(content, window.document.body);
}

function LinkDialog({ dialog, onClose, onSubmit, onRemove }) {
  const textRef = useRef(null);
  const urlRef = useRef(null);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!dialog) {
      return undefined;
    }
    setText(dialog.text || "");
    setUrl(dialog.url || "");
    setError("");
    const frame = window.requestAnimationFrame(() => {
      const target = dialog.text ? urlRef.current : textRef.current;
      target?.focus();
      target?.select();
    });
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [dialog, onClose]);

  if (!dialog) {
    return null;
  }

  const submit = (event) => {
    event.preventDefault();
    const normalized = normalizeLinkUrl(url);
    if (!normalized.ok) {
      setError(normalized.error);
      urlRef.current?.focus();
      return;
    }
    onSubmit({ text: text.trim() || normalized.url, url: normalized.url });
  };

  return createPortal(
    <div className="app-confirm-overlay" role="presentation" onMouseDown={onClose}>
      <form className="app-confirm-dialog app-link-dialog" role="dialog" aria-modal="true" aria-labelledby="app-link-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <button type="button" className="app-confirm-close" onClick={onClose} aria-label="关闭链接窗口" title="关闭">
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true">
          <Link2 size={24} />
        </div>
        <div className="app-confirm-copy">
          <span>媒体 · 链接</span>
          <h2 id="app-link-title">{dialog.editing ? "编辑链接" : "插入链接"}</h2>
          <label className="app-prompt-field">
            <span>显示文字</span>
            <input ref={textRef} type="text" value={text} placeholder="链接文字" maxLength={500} onChange={(event) => setText(event.target.value)} />
          </label>
          <label className="app-prompt-field">
            <span>链接地址</span>
            <input ref={urlRef} type="text" value={url} placeholder="https://example.com" aria-invalid={Boolean(error)} aria-describedby={error ? "app-link-error" : undefined} onChange={(event) => { setUrl(event.target.value); setError(""); }} />
          </label>
          {error ? <p className="app-link-error" id="app-link-error" role="alert">{error}</p> : null}
        </div>
        <footer className="app-confirm-actions">
          {dialog.editing ? (
            <button type="button" className="danger" onClick={onRemove}>
              <Unlink size={15} />
              <span>移除链接</span>
            </button>
          ) : null}
          <span className="app-link-action-spacer" />
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          <button type="submit" className="primary">
            <Check size={15} />
            <span>{dialog.editing ? "保存" : "插入"}</span>
          </button>
        </footer>
      </form>
    </div>,
    window.document.body,
  );
}

function StatusBar({ document, stats, dirty, version, cacheSummary, updateState, onRunUpdate, onClearCache }) {
  const cacheBytes = cacheSummary?.bytes || 0;
  const cacheCount = cacheSummary?.count || 0;
  const updateMeta = getUpdateStatusMeta(updateState);
  return (
    <footer className="statusbar">
      <div className="statusbar-counts">
        <span className="status-metric words"><strong>{stats.words.toLocaleString()}</strong><em>字</em></span>
        <i />
        <span className="status-metric paragraphs"><strong>{stats.paragraphs.toLocaleString()}</strong><em>段</em></span>
        <i />
        <span className="status-metric pages"><strong>{stats.pages.toLocaleString()}</strong><em>页</em></span>
        <i />
        <span className="status-metric images"><strong>{stats.images.toLocaleString()}</strong><em>图</em></span>
        <i />
        <span className="status-metric quotes"><strong>{stats.quotes.toLocaleString()}</strong><em>引用</em></span>
      </div>
      <div className={dirty ? "statusbar-save dirty" : "statusbar-save saved"}>
        <span>自动保存于 {formatClock(document.updatedAt)}{dirty ? " · 未保存" : ""}</span>
        <i />
        <div className="statusbar-cache" title={`已缓存 ${cacheCount} 篇信笺的编辑器结构，用于加速已打开信笺切换`}>
          <span>缓存 {formatCacheBytes(cacheBytes)}</span>
          <button type="button" onClick={onClearCache} disabled={!cacheBytes} aria-label="清理信笺切换缓存" title="清理缓存">
            <Eraser size={17} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="statusbar-version">
        <button
          type="button"
          className={`statusbar-update ${updateMeta.className}`}
          onClick={onRunUpdate}
          disabled={updateMeta.busy}
          title={updateState?.message || updateMeta.label}
          aria-label={updateState?.message || updateMeta.label}
        >
          <img src={ICON_ASSETS.updateArrow} alt="" />
          <span>{updateMeta.label}</span>
        </button>
        <i />
        {version ? (
          <span className="status-version-label">
            <span className="status-version-v">V</span>
            <span className="status-version-number">{version}</span>
          </span>
        ) : ""}
      </div>
    </footer>
  );
}

function createTabId() {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function estimateSerializedBytes(value) {
  if (!value) {
    return 0;
  }
  try {
    const text = JSON.stringify(value);
    if (!text) {
      return 0;
    }
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(text).byteLength;
    }
    return text.length * 2;
  } catch {
    return 0;
  }
}

function summarizeDocumentCache(tabs) {
  return tabs.reduce((summary, tab) => {
    const bytes = estimateSerializedBytes(tab.editorJson);
    if (!bytes) {
      return summary;
    }
    return {
      bytes: summary.bytes + bytes,
      count: summary.count + 1,
    };
  }, { bytes: 0, count: 0 });
}

function formatCacheBytes(bytes) {
  if (!bytes) {
    return "0 KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function getUpdateStatusMeta(updateState = {}) {
  const status = updateState.status || "idle";
  if (status === "checking") {
    return { label: "检查中", className: "checking", busy: true };
  }
  if (status === "downloading") {
    return { label: "下载中", className: "downloading", busy: true };
  }
  if (status === "available") {
    return { label: "可更新", className: "available", busy: false };
  }
  if (status === "downloaded") {
    return { label: "安装更新", className: "downloaded", busy: false };
  }
  if (status === "error") {
    return { label: "更新失败", className: "error", busy: false };
  }
  if (status === "none") {
    return { label: "已是最新", className: "current", busy: false };
  }
  return { label: "检查更新", className: "idle", busy: false };
}

function summarizeSessionTabs(tabs = []) {
  const seen = new Set();
  return tabs
    .map((tab) => ({ path: typeof tab?.path === "string" ? tab.path : "" }))
    .filter((tab) => {
      if (!tab.path || seen.has(tab.path)) {
        return false;
      }
      seen.add(tab.path);
      return true;
    });
}

function createDocumentTab(document, path = "", dirty = false) {
  return {
    id: createTabId(),
    path,
    title: document?.title || "未命名信笺",
    document,
    editorJson: null,
    scrollState: { top: 0, left: 0 },
    dirty,
  };
}

function readCanvasScrollState(canvas) {
  if (!canvas) {
    return { top: 0, left: 0 };
  }
  return {
    top: Math.max(0, Math.round(canvas.scrollTop || 0)),
    left: Math.max(0, Math.round(canvas.scrollLeft || 0)),
  };
}

function restoreCanvasScrollState(canvas, scrollState) {
  if (!canvas) {
    return;
  }
  canvas.scrollTop = Math.max(0, Number(scrollState?.top) || 0);
  canvas.scrollLeft = Math.max(0, Number(scrollState?.left) || 0);
}

function buildOutlineItems(editor) {
  if (!editor) {
    return [];
  }
  const items = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "paperTableOfContents") {
      items.push({
        id: `toc-${pos}`,
        type: "toc",
        level: 1,
        text: "目录",
        pos,
      });
      return false;
    }
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
      type: "heading",
      level,
      text,
      pos,
    });
  });
  return items;
}

function cleanupImageExportStage() {
  window.document.getElementById(IMAGE_EXPORT_STAGE_ID)?.remove();
}

function syncClonedFormValues(source, clone) {
  const sourceControls = Array.from(source.querySelectorAll("input, textarea"));
  const cloneControls = Array.from(clone.querySelectorAll("input, textarea"));
  sourceControls.forEach((control, index) => {
    const clonedControl = cloneControls[index];
    if (!clonedControl) {
      return;
    }
    clonedControl.value = control.value;
    clonedControl.setAttribute("value", control.value);
    if (clonedControl.tagName === "TEXTAREA") {
      clonedControl.textContent = control.value;
    }
  });
}

function getFlowExportSegments(sheet) {
  const sheetRect = sheet.getBoundingClientRect();
  const editorElement = sheet.querySelector(".paper-editor");
  const editorChildren = editorElement ? Array.from(editorElement.children) : [];
  const groups = [];
  let currentGroup = { startBreak: null, endBreak: null, nodes: [] };

  editorChildren.forEach((child) => {
    if (child.matches?.(".paper-page-break")) {
      currentGroup.endBreak = child;
      groups.push(currentGroup);
      currentGroup = { startBreak: child, endBreak: null, nodes: [] };
      return;
    }
    currentGroup.nodes.push(child);
  });
  groups.push(currentGroup);

  const header = sheet.querySelector(".paper-header");
  return groups
    .map((group, index) => {
      const contentRects = group.nodes
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      if (index === 0 && header) {
        contentRects.unshift(header.getBoundingClientRect());
      }

      const startLimit = group.startBreak
        ? group.startBreak.getBoundingClientRect().bottom
        : sheetRect.top;
      const endLimit = group.endBreak
        ? group.endBreak.getBoundingClientRect().top
        : sheetRect.bottom;
      const firstContentTop = contentRects[0]?.top ?? startLimit;
      const lastContentBottom = contentRects[contentRects.length - 1]?.bottom ?? endLimit;
      const top = index === 0
        ? sheetRect.top
        : Math.max(sheetRect.top, startLimit, firstContentTop - IMAGE_EXPORT_SEGMENT_PADDING);
      const bottomPadding = group.endBreak ? IMAGE_EXPORT_SEGMENT_PADDING : IMAGE_EXPORT_SEGMENT_PADDING * 2;
      const bottom = Math.min(
        sheetRect.bottom,
        endLimit,
        Math.max(top + 80, lastContentBottom + bottomPadding),
      );

      return {
        top: Math.max(0, top - sheetRect.top),
        bottom: Math.max(0, bottom - sheetRect.top),
      };
    })
    .filter((segment) => segment.bottom - segment.top >= 80);
}

function prepareImageExportRects() {
  cleanupImageExportStage();
  const sheet = window.document.querySelector(".paper-sheet");
  if (!sheet) {
    return [];
  }

  const sheetRect = sheet.getBoundingClientRect();
  const segments = getFlowExportSegments(sheet);
  if (!segments.length) {
    return [];
  }

  const stage = window.document.createElement("div");
  stage.id = IMAGE_EXPORT_STAGE_ID;
  stage.className = "image-export-stage";
  stage.style.width = `${Math.ceil(sheetRect.width)}px`;
  window.document.body.append(stage);

  segments.forEach((segment) => {
    const clone = sheet.cloneNode(true);
    syncClonedFormValues(sheet, clone);
    clone.style.width = `${sheetRect.width}px`;
    clone.style.minWidth = `${sheetRect.width}px`;
    clone.style.margin = "0";

    const offset = window.document.createElement("div");
    offset.className = "image-export-segment-offset";
    offset.style.width = `${sheetRect.width}px`;
    offset.style.transform = `translateY(-${segment.top}px)`;
    offset.append(clone);

    const wrapper = window.document.createElement("div");
    wrapper.className = "image-export-segment";
    wrapper.style.width = `${Math.ceil(sheetRect.width)}px`;
    wrapper.style.height = `${Math.ceil(segment.bottom - segment.top)}px`;
    wrapper.append(offset);
    stage.append(wrapper);
  });

  return Array.from(stage.querySelectorAll(".image-export-segment")).map((segment) => {
    const rect = segment.getBoundingClientRect();
    return {
      x: Math.floor(rect.left + window.scrollX),
      y: Math.floor(rect.top + window.scrollY),
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
    };
  });
}

export default function App() {
  const [initialSession] = useState(() => loadSessionState());
  const sessionRef = useRef(initialSession);
  const sessionRestoredRef = useRef(false);
  const [userTemplateGroups, setUserTemplateGroups] = useState(() => loadUserTemplateGroups());
  const [userLetterTemplates, setUserLetterTemplates] = useState(() => loadUserLetterTemplates(userTemplateGroups));
  const letterTemplates = useMemo(() => [...DEFAULT_LETTER_TEMPLATES, ...userLetterTemplates], [userLetterTemplates]);
  const [newDocumentTemplateId, setNewDocumentTemplateId] = useState(() => loadNewDocumentTemplateId(letterTemplates));
  const [newDocumentTemplateHistory, setNewDocumentTemplateHistory] = useState(() => loadNewDocumentTemplateHistory(letterTemplates));
  const [documentState, setDocumentState] = useState(() => createBlankDocument(letterTemplates, newDocumentTemplateId));
  const [currentPath, setCurrentPath] = useState("");
  const [dirty, setDirty] = useState(false);
  const [openTabs, setOpenTabs] = useState(() => {
    const document = createBlankDocument(letterTemplates, newDocumentTemplateId);
    const tab = createDocumentTab(document);
    return [tab];
  });
  const [activeTabId, setActiveTabId] = useState(() => openTabs[0]?.id || "");
  const [rightSplitTabId, setRightSplitTabId] = useState("");
  const [activePane, setActivePane] = useState("main");
  const [folderState, setFolderState] = useState(() => ({
    path: initialSession.folderPath || "",
    parentPath: "",
    folders: [],
    files: [],
    entries: [],
    loading: Boolean(initialSession.folderPath),
  }));
  const [expandedFolders, setExpandedFolders] = useState({});
  const [leftSidebarMode, setLeftSidebarMode] = useState("folder");
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [printMode, setPrintMode] = useState(false);
  const [imageExportMode, setImageExportMode] = useState(false);
  const [tabCapacityFull, setTabCapacityFull] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [promptDialog, setPromptDialog] = useState(null);
  const [linkDialog, setLinkDialog] = useState(null);
  const [commentPanel, setCommentPanel] = useState(null);
  const [updateState, setUpdateState] = useState({ status: "idle", message: "尚未检查更新" });
  const [aiConfig, setAiConfig] = useState(DEFAULT_AI_CONFIG);
  const [aiSelectedProvider, setAiSelectedProvider] = useState(DEFAULT_AI_CONFIG.activeProvider);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiModeKind, setAiModeKind] = useState("none");
  const aiMode = aiModeKind !== "none";
  const aiOptimizeMode = aiModeKind === "optimize";
  const aiChatMode = aiModeKind === "chat";
  const activeAiState = useMemo(() => normalizeAiState(documentState.aiState), [documentState.aiState]);
  const activeOptimizeState = activeAiState.optimize;
  const activeChatState = activeAiState.chat;
  const aiStatus = aiChatMode ? activeChatState.status : activeOptimizeState.status;
  const aiOutput = activeOptimizeState.output;
  const aiError = aiChatMode ? activeChatState.error : activeOptimizeState.error;
  const aiAssets = activeOptimizeState.assets;
  const aiElapsedSeconds = activeOptimizeState.elapsedSeconds;
  const aiTokenStats = activeOptimizeState.tokenStats;
  const aiChatMessages = activeChatState.messages;
  const aiChatInput = activeChatState.input;
  const aiChatSelections = activeChatState.selectedTexts;
  const aiChatCodexScope = activeChatState.codexScope;
  const aiChatCodexImageMode = activeChatState.codexImageMode;
  const applyingRef = useRef(false);
  const readyRef = useRef(false);
  const editorSelectionRef = useRef(null);
  const updateFlowRef = useRef({ active: false, handled: "" });
  const updateResultResetTimerRef = useRef(0);
  const restoreRunRef = useRef(0);
  const openTabsRef = useRef(openTabs);
  const activeTabIdRef = useRef(activeTabId);
  const activeDocumentKeyRef = useRef(documentRuntimeKey(currentPath, activeTabId));
  const mainCanvasRef = useRef(null);
  const currentPathRef = useRef(currentPath);
  const dirtyRef = useRef(dirty);
  const documentStateRef = useRef(documentState);
  const updateAutoCheckedRef = useRef(false);
  const getSaveDocumentRef = useRef(null);
  const refreshFolderRef = useRef(null);
  const applyDocumentRunRef = useRef(0);
  const rightSplitApplyingRef = useRef(false);
  const rightSplitApplyRunRef = useRef(0);
  const rightSplitSelectionRef = useRef(null);
  const rightSplitTabIdRef = useRef("");
  const aiRequestIdRef = useRef("");
  const aiPreviousSidebarsRef = useRef(null);
  const aiStartedAtRef = useRef(0);
  const aiPromptTokenEstimateRef = useRef(0);
  const aiRequestMetaRef = useRef({ kind: "" });
  const aiRequestContextsRef = useRef(new Map());
  const aiChatAssistantIdRef = useRef("");
  const aiChatContextRef = useRef({ signature: "", context: "", images: [] });
  const confirmDialogResolverRef = useRef(null);
  const promptDialogResolverRef = useRef(null);
  const aiChatMessagesRef = useRef([]);
  const rightSplitTab = useMemo(() => openTabs.find((tab) => tab.id === rightSplitTabId) || null, [openTabs, rightSplitTabId]);
  const rightSplitDocument = useMemo(() => {
    if (!rightSplitTab) {
      return null;
    }
    return rightSplitTab.id === activeTabId ? documentState : rightSplitTab.document;
  }, [activeTabId, documentState, rightSplitTab]);

  const editor = useEditor({
    extensions: createPaperEditorExtensions(),
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
    onUpdate: ({ editor: activeEditor, transaction }) => {
      if (applyingRef.current) {
        return;
      }
      const html = activeEditor.getHTML();
      const maxPosition = activeEditor.state.doc.content.size;
      setDocumentState((previous) => ({
        ...previous,
        html,
        comments: mapDocumentCommentsThroughTransaction(previous.comments, transaction, maxPosition),
        updatedAt: new Date().toISOString(),
      }));
      setDirty(true);
    },
  });

  const rightSplitEditor = useEditor({
    extensions: createPaperEditorExtensions(),
    content: rightSplitDocument?.html || "<p></p>",
    editorProps: {
      attributes: {
        class: "paper-editor",
        spellcheck: "false",
      },
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      const { from, to } = activeEditor.state.selection;
      rightSplitSelectionRef.current = { from, to };
    },
    onFocus: () => {
      setActivePane("right");
    },
    onUpdate: ({ editor: activeEditor, transaction }) => {
      if (rightSplitApplyingRef.current) {
        return;
      }
      const splitId = rightSplitTabIdRef.current;
      if (!splitId) {
        return;
      }
      const html = activeEditor.getHTML();
      const updatedAt = new Date().toISOString();
      const maxPosition = activeEditor.state.doc.content.size;
      setOpenTabs((tabs) => tabs.map((tab) => (
        tab.id === splitId
          ? {
              ...tab,
              document: {
                ...tab.document,
                html,
                comments: mapDocumentCommentsThroughTransaction(tab.document?.comments, transaction, maxPosition),
                updatedAt,
              },
              dirty: true,
            }
          : tab
      )));
      if (splitId === activeTabIdRef.current) {
        setDocumentState((previous) => ({
          ...previous,
          html,
          comments: mapDocumentCommentsThroughTransaction(previous.comments, transaction, maxPosition),
          updatedAt,
        }));
        setDirty(true);
      }
    },
  });

  const stats = useMemo(() => wordStats(statsTextFromHtml(documentState.html), documentState.html), [documentState.html]);
  const splitPaneActive = !aiMode && activePane === "right" && Boolean(rightSplitTabId && rightSplitDocument && rightSplitEditor);
  const activeWorkEditor = splitPaneActive ? rightSplitEditor : editor;
  const activeWorkDocument = splitPaneActive ? rightSplitDocument : documentState;
  const activeWorkSelectionRef = splitPaneActive ? rightSplitSelectionRef : editorSelectionRef;
  const activeWorkStats = useMemo(() => wordStats(statsTextFromHtml(activeWorkDocument?.html || ""), activeWorkDocument?.html || ""), [activeWorkDocument?.html]);
  const outlineItems = useMemo(() => buildOutlineItems(activeWorkEditor), [activeWorkDocument?.html, activeWorkEditor]);
  const finalizedBreakInserted = useMemo(() => editorHasNodeType(activeWorkEditor, "paperFinalizedBreak"), [activeWorkDocument?.html, activeWorkEditor]);
  const tableOfContentsInserted = useMemo(() => editorHasNodeType(activeWorkEditor, "paperTableOfContents"), [activeWorkDocument?.html, activeWorkEditor]);
  const documentCacheSummary = useMemo(() => summarizeDocumentCache(openTabs), [openTabs]);
  const aiChatImageCount = useMemo(() => countEditorImages(editor), [documentState.html, editor]);
  const availableAiProviders = useMemo(() => getTestedAiProviders(aiConfig), [aiConfig]);
  const aiHasUsableProvider = availableAiProviders.length > 0;
  const effectiveAiProvider = useMemo(() => {
    if (availableAiProviders.some((provider) => provider.id === aiSelectedProvider)) {
      return aiSelectedProvider;
    }
    if (availableAiProviders.some((provider) => provider.id === aiConfig.activeModelKey)) {
      return aiConfig.activeModelKey;
    }
    return availableAiProviders[0]?.id || aiConfig.activeModelKey;
  }, [aiConfig.activeModelKey, aiSelectedProvider, availableAiProviders]);
  const effectiveAiConfig = useMemo(() => getAiProviderRuntimeConfig(aiConfig, effectiveAiProvider), [aiConfig, effectiveAiProvider]);
  const activeDocumentKey = useMemo(() => documentRuntimeKey(currentPath, activeTabId), [activeTabId, currentPath]);

  const resolveConfirmDialog = useCallback((value) => {
    const resolver = confirmDialogResolverRef.current;
    confirmDialogResolverRef.current = null;
    setConfirmDialog(null);
    resolver?.(value);
  }, []);

  const showConfirmDialog = useCallback((options) => new Promise((resolve) => {
    confirmDialogResolverRef.current?.(options.cancelValue || "cancel");
    confirmDialogResolverRef.current = resolve;
    setConfirmDialog({
      tone: "default",
      cancelValue: "cancel",
      actions: [],
      ...options,
    });
  }), []);

  const resolvePromptDialog = useCallback((value) => {
    const resolver = promptDialogResolverRef.current;
    promptDialogResolverRef.current = null;
    setPromptDialog(null);
    resolver?.(value);
  }, []);

  const showPromptDialog = useCallback((options) => new Promise((resolve) => {
    promptDialogResolverRef.current?.(null);
    promptDialogResolverRef.current = resolve;
    setPromptDialog({
      defaultValue: "",
      confirmLabel: "确定",
      ...options,
    });
  }), []);

  useEffect(() => {
    if (!confirmDialog && !promptDialog) {
      return undefined;
    }
    bridge.setWindowModalOverlay?.(false);
    return () => {
      bridge.setWindowModalOverlay?.(false);
    };
  }, [confirmDialog, promptDialog]);

  useEffect(() => () => {
    confirmDialogResolverRef.current?.("cancel");
    confirmDialogResolverRef.current = null;
    promptDialogResolverRef.current?.(null);
    promptDialogResolverRef.current = null;
  }, []);

  const updateDocumentAiStateForKey = useCallback((documentKey, updater) => {
    if (!documentKey) {
      return;
    }
    const updatedAt = new Date().toISOString();
    const applyPatch = (document) => ({
      ...document,
      aiState: mergeAiStatePatch(document?.aiState, (previous) => {
        const next = typeof updater === "function" ? updater(previous, updatedAt) : { ...previous, ...updater };
        return {
          ...next,
          optimize: normalizeAiOptimizeState(next.optimize),
          chat: normalizeAiChatState(next.chat),
        };
      }),
      updatedAt,
    });
    if (documentKey === activeDocumentKeyRef.current) {
      setDocumentState((previous) => applyPatch(previous));
      setDirty(true);
      return;
    }
    setOpenTabs((tabs) => tabs.map((tab) => (
      documentRuntimeKey(tab.path, tab.id) === documentKey
        ? { ...tab, document: applyPatch(tab.document), dirty: true }
        : tab
    )));
  }, []);

  const updateActiveDocumentAiState = useCallback((updater) => {
    updateDocumentAiStateForKey(activeDocumentKeyRef.current, updater);
  }, [updateDocumentAiStateForKey]);

  const updateOptimizeStateForKey = useCallback((documentKey, updater) => {
    updateDocumentAiStateForKey(documentKey, (previous, updatedAt) => {
      const previousOptimize = normalizeAiOptimizeState(previous.optimize);
      const nextOptimize = normalizeAiOptimizeState(typeof updater === "function" ? updater(previousOptimize, updatedAt) : { ...previousOptimize, ...updater });
      return {
        ...previous,
        optimize: { ...nextOptimize, updatedAt },
      };
    });
  }, [updateDocumentAiStateForKey]);

  const updateChatStateForKey = useCallback((documentKey, updater) => {
    updateDocumentAiStateForKey(documentKey, (previous, updatedAt) => {
      const previousChat = normalizeAiChatState(previous.chat);
      const nextChat = normalizeAiChatState(typeof updater === "function" ? updater(previousChat, updatedAt) : { ...previousChat, ...updater });
      return {
        ...previous,
        chat: { ...nextChat, updatedAt },
      };
    });
  }, [updateDocumentAiStateForKey]);

  const updateOptimizeState = useCallback((updater) => {
    updateOptimizeStateForKey(activeDocumentKeyRef.current, updater);
  }, [updateOptimizeStateForKey]);

  const updateChatState = useCallback((updater) => {
    updateChatStateForKey(activeDocumentKeyRef.current, updater);
  }, [updateChatStateForKey]);

  const migrateAiRequestDocumentKey = useCallback((fromKey, toKey) => {
    if (!fromKey || !toKey || fromKey === toKey) {
      return;
    }
    aiRequestContextsRef.current.forEach((context) => {
      if (context.documentKey === fromKey) {
        context.documentKey = toKey;
      }
    });
  }, []);

  useEffect(() => {
    syncAiChatSelectionDecorations(editor, aiChatMode ? aiChatSelections : []);
  }, [aiChatMode, aiChatSelections, editor]);

  useEffect(() => {
    syncDocumentCommentDecorations(editor, (aiMode || printMode || imageExportMode) ? [] : documentState.comments);
  }, [aiMode, documentState.comments, editor, imageExportMode, printMode]);

  useEffect(() => {
    syncDocumentCommentDecorations(rightSplitEditor, (aiMode || printMode || imageExportMode) ? [] : rightSplitDocument?.comments);
  }, [aiMode, imageExportMode, printMode, rightSplitDocument?.comments, rightSplitEditor]);

  useEffect(() => {
    if (aiMode || printMode || imageExportMode) {
      setCommentPanel(null);
    }
  }, [aiMode, imageExportMode, printMode]);

  const persistSession = useCallback((patch) => {
    const nextSession = {
      ...sessionRef.current,
      ...patch,
    };
    sessionRef.current = nextSession;
    saveSessionState(nextSession);
  }, []);

  useEffect(() => {
    saveUserTemplateGroups(userTemplateGroups);
  }, [userTemplateGroups]);

  useEffect(() => {
    saveUserLetterTemplates(userLetterTemplates, userTemplateGroups);
  }, [userLetterTemplates, userTemplateGroups]);

  useEffect(() => {
    saveNewDocumentTemplateId(newDocumentTemplateId);
  }, [newDocumentTemplateId]);

  useEffect(() => {
    saveNewDocumentTemplateHistory(newDocumentTemplateHistory);
  }, [newDocumentTemplateHistory]);

  useEffect(() => {
    setNewDocumentTemplateHistory((history) => normalizeNewDocumentTemplateHistory(history, letterTemplates));
  }, [letterTemplates]);

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    rightSplitTabIdRef.current = rightSplitTabId;
  }, [rightSplitTabId]);

  useEffect(() => {
    if (!rightSplitTabId) {
      if (activePane === "right") {
        setActivePane("main");
      }
      return;
    }
    if (!openTabs.some((tab) => tab.id === rightSplitTabId)) {
      setRightSplitTabId("");
      setActivePane("main");
    }
  }, [activePane, openTabs, rightSplitTabId]);

  useEffect(() => {
    if (!rightSplitEditor || !rightSplitTabId) {
      return;
    }
    const splitTab = openTabsRef.current.find((tab) => tab.id === rightSplitTabId);
    const splitDocument = splitTab?.id === activeTabIdRef.current ? documentStateRef.current : splitTab?.document;
    if (!splitDocument) {
      return;
    }
    const runId = rightSplitApplyRunRef.current + 1;
    rightSplitApplyRunRef.current = runId;
    rightSplitApplyingRef.current = true;
    window.requestAnimationFrame(() => {
      if (rightSplitApplyRunRef.current !== runId) {
        return;
      }
      try {
        rightSplitEditor.commands.setContent(splitTab?.editorJson || splitDocument.html || "<p></p>");
      } catch {
        rightSplitEditor.commands.setContent(splitDocument.html || "<p></p>");
      }
      syncDocumentCommentDecorations(rightSplitEditor, normalizeDocumentComments(splitDocument.comments));
      window.setTimeout(() => {
        if (rightSplitApplyRunRef.current === runId) {
          rightSplitApplyingRef.current = false;
        }
      }, 0);
    });
  }, [rightSplitEditor, rightSplitTabId]);

  useEffect(() => {
    activeDocumentKeyRef.current = activeDocumentKey;
  }, [activeDocumentKey]);

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
    aiChatMessagesRef.current = aiChatMessages;
  }, [aiChatMessages]);

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

  const updateCommentsForPane = useCallback((pane, updater) => {
    const updatedAt = new Date().toISOString();
    const applyCommentUpdate = (document) => {
      const previousComments = normalizeDocumentComments(document?.comments);
      const nextComments = normalizeDocumentComments(
        typeof updater === "function" ? updater(previousComments) : updater,
      );
      return {
        ...document,
        comments: nextComments,
        updatedAt,
      };
    };

    if (pane === "right") {
      const splitId = rightSplitTabIdRef.current;
      if (!splitId) {
        return;
      }
      setOpenTabs((tabs) => tabs.map((tab) => (
        tab.id === splitId
          ? {
              ...tab,
              document: applyCommentUpdate(tab.document),
              dirty: true,
            }
          : tab
      )));
      if (splitId === activeTabIdRef.current) {
        setDocumentState((previous) => applyCommentUpdate(previous));
        setDirty(true);
      }
      return;
    }

    setDocumentState((previous) => applyCommentUpdate(previous));
    setDirty(true);
  }, []);

  const commentPanelComment = useMemo(() => {
    if (!commentPanel?.commentId) {
      return null;
    }
    const sourceDocument = commentPanel.pane === "right" ? rightSplitDocument : documentState;
    return normalizeDocumentComments(sourceDocument?.comments).find((comment) => comment.id === commentPanel.commentId) || null;
  }, [commentPanel, documentState, rightSplitDocument]);

  useEffect(() => {
    if (commentPanel?.commentId && !commentPanelComment) {
      setCommentPanel(null);
    }
  }, [commentPanel?.commentId, commentPanelComment]);

  const handleStartComment = useCallback((pane, selection, position) => {
    if (!selection?.text || selection.from === selection.to) {
      showStatus("请先选中要评注的文字", "warning");
      return;
    }
    const sourceDocument = pane === "right" ? rightSplitDocument : documentState;
    const sourceEditor = pane === "right" ? rightSplitEditor : editor;
    if (!commentAnchorTrackAvailable(sourceEditor, sourceDocument?.comments, selection)) {
      showStatus("这里的评注已经太密，暂时不能继续添加", "warning");
      return;
    }
    setCommentPanel({
      mode: "create",
      pane,
      selection,
      text: "",
      x: Math.max(12, Math.min(position?.left || window.innerWidth / 2, window.innerWidth - 352)),
      y: Math.max(52, Math.min((position?.top || 120) + 22, window.innerHeight - 300)),
    });
  }, [documentState, editor, rightSplitDocument, rightSplitEditor, showStatus]);

  const handleOpenComment = useCallback((pane, comment, position) => {
    if (!comment?.id) {
      return;
    }
    setCommentPanel({
      mode: "view",
      pane,
      commentId: comment.id,
      text: comment.text || "",
      x: Math.max(12, Math.min((position?.left || window.innerWidth / 2) + 12, window.innerWidth - 352)),
      y: Math.max(52, Math.min((position?.top || 120) - 8, window.innerHeight - 300)),
    });
  }, []);

  const handleSaveCommentPanel = useCallback(() => {
    if (!commentPanel) {
      return;
    }
    const text = commentPanel.text?.trim();
    if (!text) {
      showStatus("评注内容不能为空", "warning");
      return;
    }
    const now = new Date().toISOString();
    if (commentPanel.mode === "create") {
      const nextComment = {
        id: createDocumentCommentId(),
        from: commentPanel.selection.from,
        to: commentPanel.selection.to,
        text,
        quote: commentPanel.selection.text.slice(0, 280),
        createdAt: now,
        updatedAt: now,
      };
      updateCommentsForPane(commentPanel.pane, (comments) => [...comments, nextComment]);
      setCommentPanel(null);
      showStatus("评注已添加", "success");
      return;
    }
    if (commentPanel.mode === "edit" && commentPanel.commentId) {
      updateCommentsForPane(commentPanel.pane, (comments) => comments.map((comment) => (
        comment.id === commentPanel.commentId
          ? { ...comment, text, updatedAt: now }
          : comment
      )));
      setCommentPanel((panel) => panel ? { ...panel, mode: "view", text } : panel);
      showStatus("评注已更新", "success");
    }
  }, [commentPanel, showStatus, updateCommentsForPane]);

  const handleEditCommentPanel = useCallback(() => {
    if (!commentPanel?.commentId || !commentPanelComment) {
      return;
    }
    setCommentPanel((panel) => panel ? { ...panel, mode: "edit", text: commentPanelComment.text || "" } : panel);
  }, [commentPanel?.commentId, commentPanelComment]);

  const handleDeleteCommentPanel = useCallback(async () => {
    if (!commentPanel?.commentId) {
      return;
    }
    const decision = await showConfirmDialog({
      tone: "warning",
      icon: MessageSquare,
      eyebrow: "删除评注",
      title: "要删除这条评注吗？",
      message: "删除后，这条评注和正文侧边的标记都会移除。",
      cancelValue: "cancel",
      actions: [
        { value: "delete", label: "删除评注", variant: "danger", icon: Trash2 },
        { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
      ],
    });
    if (decision !== "delete") {
      return;
    }
    updateCommentsForPane(commentPanel.pane, (comments) => comments.filter((comment) => comment.id !== commentPanel.commentId));
    setCommentPanel(null);
    showStatus("评注已删除", "success");
  }, [commentPanel, showConfirmDialog, showStatus, updateCommentsForPane]);

  const handleClearDocumentCache = useCallback(() => {
    setOpenTabs((tabs) => tabs.map((tab) => (
      tab.editorJson ? { ...tab, editorJson: null } : tab
    )));
    showStatus("已清理信笺切换缓存", "success");
  }, [showStatus]);

  const buildOpenTabsSnapshot = useCallback(() => {
    const activeId = activeTabIdRef.current;
    const activePath = currentPathRef.current;
    const activeDirty = dirtyRef.current;
    const activeDocument = getSaveDocumentRef.current?.() || documentStateRef.current;
    const activeScrollState = readCanvasScrollState(mainCanvasRef.current);
    return openTabsRef.current.map((tab) => (
      tab.id === activeId
        ? {
            ...tab,
            path: activePath,
            title: activeDocument?.title || "未命名信笺",
            document: activeDocument,
            dirty: activeDirty,
            editorJson: editor?.getJSON?.() || tab.editorJson,
            scrollState: activeScrollState,
          }
        : tab
    ));
  }, [editor]);

  useEffect(() => {
    if (!sessionRestoredRef.current) {
      return;
    }
    const snapshot = buildOpenTabsSnapshot();
    persistSession({
      activePath: currentPathRef.current || "",
      tabs: summarizeSessionTabs(snapshot),
    });
  }, [activeTabId, buildOpenTabsSnapshot, currentPath, documentState, dirty, openTabs, persistSession]);

  useEffect(() => {
    let mounted = true;
    bridge.getAiConfig?.().then((config) => {
      if (mounted && config) {
        const normalized = normalizePublicAiConfig(config);
        setAiConfig(normalized);
        setAiSelectedProvider(normalized.activeModelKey);
      }
    }).catch((error) => {
      bridge.debugLog?.("renderer:ai-config:error", { message: error?.message });
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => bridge.onCodexCliStatus?.((config) => {
    const normalized = normalizePublicAiConfig(config);
    setAiConfig(normalized);
  }), []);

  useEffect(() => {
    if (!aiMode) {
      setAiSelectedProvider(aiConfig.activeModelKey);
    }
  }, [aiConfig.activeModelKey, aiMode]);

  useEffect(() => {
    if (!editor) {
      return undefined;
    }
    editor.setEditable(!(aiMode && aiStatus === "streaming"));
    return () => {
      editor.setEditable(true);
    };
  }, [aiMode, aiStatus, editor]);

  useEffect(() => {
    if (!aiMode || aiStatus !== "streaming" || !aiStartedAtRef.current) {
      return undefined;
    }
    const updateElapsed = () => {
      aiRequestContextsRef.current.forEach((context) => {
        if (!context?.requestId || !context.startedAt) {
          return;
        }
        const elapsedSeconds = Math.max(0, (Date.now() - context.startedAt) / 1000);
        if (context.kind === "chat" && context.assistantId) {
          updateChatStateForKey(context.documentKey, (chat) => ({
            ...chat,
            messages: chat.messages.map((message) => (
              message.id === context.assistantId ? { ...message, elapsedSeconds } : message
            )),
          }));
          return;
        }
        if (context.kind === "optimize") {
          updateOptimizeStateForKey(context.documentKey, (optimize) => ({
            ...optimize,
            elapsedSeconds,
          }));
        }
      });
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 100);
    return () => window.clearInterval(timer);
  }, [aiMode, aiStatus, updateChatStateForKey, updateOptimizeStateForKey]);

  useEffect(() => {
    const unsubscribeChunk = bridge.onAiChunk?.((payload) => {
      const context = aiRequestContextsRef.current.get(payload?.requestId);
      if (!context) {
        return;
      }
      if (context.kind === "chat") {
        updateChatStateForKey(context.documentKey, (chat) => ({
          ...chat,
          messages: chat.messages.map((message) => (
            message.id === context.assistantId
              ? { ...message, content: `${message.content || ""}${payload.delta || ""}`, status: "streaming" }
              : message
          )),
        }));
        return;
      }
      context.outputBuffer = `${context.outputBuffer || ""}${payload.delta || ""}`;
      if (!context.flushId) {
        context.flushId = window.requestAnimationFrame(() => {
          context.flushId = 0;
          updateOptimizeStateForKey(context.documentKey, (optimize) => ({
            ...optimize,
            output: context.outputBuffer || "",
          }));
        });
      }
    });
    const unsubscribeDone = bridge.onAiDone?.((payload) => {
      const context = aiRequestContextsRef.current.get(payload?.requestId);
      if (!context) {
        return;
      }
      if (context.flushId) {
        window.cancelAnimationFrame(context.flushId);
        context.flushId = 0;
      }
      if (context.kind === "chat") {
        const usage = payload.usage || {};
        const totalTokens = getAiUsageTotalTokens(usage);
        const cachedTokens = getAiUsageCachedTokens(usage);
        const elapsedSeconds = context.startedAt
          ? Math.max(0, (Date.now() - context.startedAt) / 1000)
          : 0;
        updateChatStateForKey(context.documentKey, (chat) => ({
          ...chat,
          status: "idle",
          error: "",
          messages: chat.messages.map((message) => (
            message.id === context.assistantId
              ? {
                  ...message,
                  status: "done",
                  elapsedSeconds,
                  usage: totalTokens > 0
                    ? totalTokens
                    : (context.promptTokenEstimate || 0) + estimateTokenCount(message.content || ""),
                  usageEstimated: totalTokens <= 0,
                  cachedTokens,
                }
              : message
          )),
        }));
        aiRequestContextsRef.current.delete(payload.requestId);
        if (payload.requestId === aiRequestIdRef.current) {
          aiRequestIdRef.current = "";
          aiChatAssistantIdRef.current = "";
          aiRequestMetaRef.current = { kind: "" };
          aiStartedAtRef.current = 0;
        }
        showStatus("AI 已回复", "success");
        return;
      }
      const usage = payload.usage || {};
      const totalTokens = getAiUsageTotalTokens(usage);
      const cachedTokens = getAiUsageCachedTokens(usage);
      const output = context.outputBuffer || "";
      const elapsedSeconds = context.startedAt
        ? Math.max(0, (Date.now() - context.startedAt) / 1000)
        : 0;
      updateOptimizeStateForKey(context.documentKey, (optimize) => ({
        ...optimize,
        output,
        status: "done",
        error: "",
        elapsedSeconds,
        tokenStats: totalTokens > 0
          ? { totalTokens, estimated: false, cachedTokens }
          : {
              totalTokens: (context.promptTokenEstimate || 0) + estimateTokenCount(output),
              estimated: true,
              cachedTokens,
            },
      }));
      aiRequestContextsRef.current.delete(payload.requestId);
      if (payload.requestId === aiRequestIdRef.current) {
        aiRequestIdRef.current = "";
        aiRequestMetaRef.current = { kind: "" };
        aiStartedAtRef.current = 0;
      }
      showStatus("AI 优化结果已生成", "success");
    });
    const unsubscribeError = bridge.onAiError?.((payload) => {
      const context = aiRequestContextsRef.current.get(payload?.requestId);
      if (!context) {
        return;
      }
      if (context.flushId) {
        window.cancelAnimationFrame(context.flushId);
        context.flushId = 0;
      }
      const message = payload.message || "AI 生成失败";
      const elapsedSeconds = context.startedAt
        ? Math.max(0, (Date.now() - context.startedAt) / 1000)
        : 0;
      if (context.kind === "chat") {
        updateChatStateForKey(context.documentKey, (chat) => ({
          ...chat,
          status: payload.aborted ? "idle" : "error",
          error: payload.aborted ? "" : message,
          messages: chat.messages.map((item) => (
            item.id === context.assistantId
              ? { ...item, content: item.content || message, elapsedSeconds, status: payload.aborted ? "stopped" : "error" }
              : item
          )),
        }));
        aiRequestContextsRef.current.delete(payload.requestId);
        if (payload.requestId === aiRequestIdRef.current) {
          aiRequestIdRef.current = "";
          aiChatAssistantIdRef.current = "";
          aiRequestMetaRef.current = { kind: "" };
          aiStartedAtRef.current = 0;
        }
        showStatus(message, payload.aborted ? "success" : "warning");
        return;
      }
      updateOptimizeStateForKey(context.documentKey, (optimize) => ({
        ...optimize,
        output: context.outputBuffer || optimize.output,
        status: payload.aborted ? "ready" : "error",
        error: payload.aborted ? "" : message,
        elapsedSeconds,
      }));
      aiRequestContextsRef.current.delete(payload.requestId);
      if (payload.requestId === aiRequestIdRef.current) {
        aiRequestIdRef.current = "";
        aiRequestMetaRef.current = { kind: "" };
        aiStartedAtRef.current = 0;
      }
      showStatus(message, payload.aborted ? "success" : "warning");
    });
    return () => {
      unsubscribeChunk?.();
      unsubscribeDone?.();
      unsubscribeError?.();
      aiRequestContextsRef.current.forEach((context) => {
        if (context.flushId) {
          window.cancelAnimationFrame(context.flushId);
          context.flushId = 0;
        }
      });
    };
  }, [showStatus, updateChatStateForKey, updateOptimizeStateForKey]);

  const openHelpCenter = useCallback(() => {
    setHelpOpen(true);
  }, []);

  const closeHelpCenter = useCallback(() => {
    setHelpOpen(false);
  }, []);

  const clearUpdateResultReset = useCallback(() => {
    if (!updateResultResetTimerRef.current) {
      return;
    }
    window.clearTimeout(updateResultResetTimerRef.current);
    updateResultResetTimerRef.current = 0;
  }, []);

  const scheduleUpdateResultReset = useCallback((state) => {
    clearUpdateResultReset();
    if (!["none", "dev", "error", "browser"].includes(state?.status)) {
      return;
    }
    updateResultResetTimerRef.current = window.setTimeout(() => {
      updateResultResetTimerRef.current = 0;
      setUpdateState((current) => (
        current?.status === state.status
          ? { status: "idle", message: "尚未检查更新", version: current?.version }
          : current
      ));
    }, UPDATE_RESULT_RESET_MS);
  }, [clearUpdateResultReset]);

  useEffect(() => {
    let mounted = true;
    bridge.getUpdateState?.().then((state) => {
      if (mounted && state) {
        setUpdateState(state);
        scheduleUpdateResultReset(state);
      }
    });
    const unsubscribe = bridge.onUpdateState?.((state) => {
      clearUpdateResultReset();
      setUpdateState(state);
      if (state?.message) {
        showStatus(state.message, state.status === "error" ? "warning" : "success");
      }
      scheduleUpdateResultReset(state);
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
      clearUpdateResultReset();
      unsubscribe?.();
    };
  }, [clearUpdateResultReset, scheduleUpdateResultReset, showStatus]);

  const handleRunUpdate = useCallback(async () => {
    clearUpdateResultReset();
    if (updateState?.status === "checking" || updateState?.status === "downloading") {
      return;
    }
    if (updateState?.status === "downloaded") {
      updateFlowRef.current = { active: true, handled: "" };
      updateFlowRef.current.handled = "downloaded";
      await bridge.installUpdate?.();
      return;
    }
    if (updateState?.status === "available") {
      updateFlowRef.current = { active: true, handled: "" };
      updateFlowRef.current.handled = "available";
      const state = await bridge.downloadUpdate?.();
      if (state) {
        setUpdateState(state);
      }
      return;
    }
    updateFlowRef.current = { active: false, handled: "" };
    const state = await bridge.checkForUpdates?.();
    if (state) {
      setUpdateState(state);
      showStatus(state.message || "更新检查完成", state.status === "error" ? "warning" : "success");
      if (["none", "error", "dev", "available", "downloaded", "browser"].includes(state.status)) {
        updateFlowRef.current = { active: false, handled: state.status };
      }
      scheduleUpdateResultReset(state);
    }
  }, [clearUpdateResultReset, scheduleUpdateResultReset, showStatus, updateState?.status]);

  useEffect(() => {
    if (updateAutoCheckedRef.current) {
      return;
    }
    updateAutoCheckedRef.current = true;
    const lastCheckedAt = getLastAutoUpdateCheckAt();
    if (lastCheckedAt && Date.now() - lastCheckedAt < UPDATE_AUTO_CHECK_INTERVAL_MS) {
      return;
    }
    saveLastAutoUpdateCheckAt();
    bridge.checkForUpdates?.().then((state) => {
      if (state) {
        setUpdateState(state);
        scheduleUpdateResultReset(state);
      }
    }).catch((error) => {
      bridge.debugLog?.("renderer:update:auto-check:error", { message: error?.message });
    });
  }, [scheduleUpdateResultReset]);

  const applyDocument = useCallback(
    (nextDocument, nextPath = "", nextDirty = false, options = {}) => {
      const startedAt = window.performance?.now?.() || Date.now();
      const normalized = normalizeDocument(nextDocument, letterTemplates);
      const runId = applyDocumentRunRef.current + 1;
      applyDocumentRunRef.current = runId;
      applyingRef.current = true;
      setDocumentState(normalized);
      setCurrentPath(nextPath);
      setDirty(nextDirty);
      window.requestAnimationFrame(() => {
        if (applyDocumentRunRef.current !== runId) {
          return;
        }
        const setContentStartedAt = window.performance?.now?.() || Date.now();
        let contentSource = options.editorJson ? "json-cache" : "html";
        try {
          editor?.commands.setContent(options.editorJson || normalized.html || "<p></p>");
        } catch (error) {
          contentSource = "html-fallback";
          editor?.commands.setContent(normalized.html || "<p></p>");
          bridge.debugLog?.("renderer:document:set-content-fallback", {
            path: nextPath,
            message: error?.message || String(error),
          });
        }
        syncDocumentCommentDecorations(editor, (aiMode || printMode || imageExportMode) ? [] : normalized.comments);
        const setContentMs = (window.performance?.now?.() || Date.now()) - setContentStartedAt;
        bridge.debugLog?.("renderer:document:applied", {
          path: nextPath,
          contentSource,
          htmlChars: (normalized.html || "").length,
          setContentMs: Math.round(setContentMs),
          totalMs: Math.round((window.performance?.now?.() || Date.now()) - startedAt),
        });
        window.requestAnimationFrame(() => {
          if (applyDocumentRunRef.current === runId) {
            restoreCanvasScrollState(mainCanvasRef.current, options.scrollState);
          }
        });
        window.setTimeout(() => {
          if (applyDocumentRunRef.current === runId) {
            applyingRef.current = false;
          }
        }, 0);
      });
    },
    [aiMode, editor, imageExportMode, letterTemplates, printMode],
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

  const getRightSplitSaveDocument = useCallback(() => {
    if (!rightSplitDocument) {
      return null;
    }
    const html = rightSplitEditor?.getHTML() || rightSplitDocument.html || "<p></p>";
    const title = rightSplitDocument.title?.trim() || inferTitle(rightSplitEditor?.getText() || "");
    return normalizeDocument({
      ...rightSplitDocument,
      title,
      html,
      updatedAt: new Date().toISOString(),
    }, letterTemplates);
  }, [letterTemplates, rightSplitDocument, rightSplitEditor]);

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

  const handleDateChange = useCallback((displayDate) => {
    setDocumentState((previous) => ({
      ...previous,
      displayDate: displayDate.slice(0, 40),
      updatedAt: new Date().toISOString(),
    }));
    setDirty(true);
  }, []);

  const updateRightSplitDocument = useCallback((patch) => {
    const splitId = rightSplitTabIdRef.current;
    if (!splitId) {
      return;
    }
    const updatedAt = new Date().toISOString();
    setOpenTabs((tabs) => tabs.map((tab) => (
      tab.id === splitId
        ? {
            ...tab,
            title: patch.title ?? tab.title,
            document: {
              ...tab.document,
              ...patch,
              updatedAt,
            },
            dirty: true,
          }
        : tab
    )));
    if (splitId === activeTabIdRef.current) {
      setDocumentState((previous) => ({
        ...previous,
        ...patch,
        updatedAt,
      }));
      setDirty(true);
    }
  }, []);

  const handleRightSplitTitleChange = useCallback((title) => {
    updateRightSplitDocument({ title });
  }, [updateRightSplitDocument]);

  const handleRightSplitAuthorChange = useCallback((author) => {
    updateRightSplitDocument({ author: author.slice(0, 40) });
  }, [updateRightSplitDocument]);

  const handleRightSplitDateChange = useCallback((displayDate) => {
    updateRightSplitDocument({ displayDate: displayDate.slice(0, 40) });
  }, [updateRightSplitDocument]);

  const handleToggleRightSplit = useCallback((tabId) => {
    setRightSplitTabId((previous) => {
      if (previous === tabId) {
        setActivePane("main");
        showStatus("已取消右分屏", "success");
        return "";
      }
      setActivePane("right");
      showStatus(previous ? "已替换右分屏" : "已向右分屏", "success");
      return tabId;
    });
  }, [showStatus]);

  const addOrActivateDocumentTab = useCallback(
    (nextDocument, nextPath = "", nextDirty = false) => {
      const normalized = normalizeDocument(nextDocument, letterTemplates);
      const existingTab = nextPath ? openTabs.find((tab) => tab.path === nextPath) : null;
      const currentDocument = getSaveDocument();
      const currentEditorJson = editor?.getJSON?.() || null;
      const currentScrollState = readCanvasScrollState(mainCanvasRef.current);
      if (existingTab) {
        if (existingTab.id !== activeTabId) {
          setOpenTabs((tabs) => tabs.map((tab) => (
            tab.id === activeTabId
              ? { ...tab, document: currentDocument, editorJson: currentEditorJson, title: currentDocument.title, path: currentPath, dirty, scrollState: currentScrollState }
              : tab
          )));
          setActiveTabId(existingTab.id);
          setActivePane("main");
          applyDocument(existingTab.document, existingTab.path, existingTab.dirty, { editorJson: existingTab.editorJson, scrollState: existingTab.scrollState });
        }
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
        if (canReplaceBlank) {
          return [tab];
        }
        const retainedTabs = tabCapacityFull && tabs.length ? tabs.slice(1) : tabs;
        return [
          ...retainedTabs.map((existing) => (
            existing.id === activeTabId
              ? { ...existing, document: currentDocument, editorJson: currentEditorJson, title: currentDocument.title, path: currentPath, dirty, scrollState: currentScrollState }
              : existing
          )),
          tab,
        ];
      });
      setActiveTabId(tab.id);
      setActivePane("main");
      applyDocument(normalized, nextPath, nextDirty, { scrollState: tab.scrollState });
      return tab.id;
    },
    [activeTabId, applyDocument, currentPath, dirty, editor, getSaveDocument, letterTemplates, openTabs, tabCapacityFull],
  );

  useEffect(() => {
    if (!editor || sessionRestoredRef.current) {
      return undefined;
    }
    let canceled = false;
    const runId = restoreRunRef.current + 1;
    restoreRunRef.current = runId;
    const isActiveRestore = () => !canceled && restoreRunRef.current === runId;
    const restoreSession = async () => {
      const { folderPath: savedFolderPath, activePath } = sessionRef.current;
      const sessionTabPaths = summarizeSessionTabs(sessionRef.current.tabs || []).map((tab) => tab.path);
      const restorePaths = [...sessionTabPaths];
      if (activePath && !restorePaths.includes(activePath)) {
        restorePaths.push(activePath);
      }
      let folderPath = savedFolderPath;
      let desktopPath = "";
      bridge.debugLog?.("renderer:restore:start", {
        savedFolderPath,
        activePath,
        tabs: restorePaths.length,
      });
      if (!folderPath) {
        try {
          const paths = await bridge.getPaths?.();
          desktopPath = paths?.desktop || "";
          folderPath = desktopPath;
        } catch {
          folderPath = "";
        }
      }
      if (folderPath) {
        bridge.debugLog?.("renderer:restore:folder-selected", {
          folderPath,
          source: savedFolderPath ? "session" : "desktop-default",
        });
        if (isActiveRestore()) {
          setFolderState((previous) => ({
            ...previous,
            path: folderPath,
            loading: true,
          }));
        }
        try {
          const result = await listFolderWithTimeout(folderPath);
          if (isActiveRestore() && !result?.canceled) {
            bridge.debugLog?.("renderer:restore:folder-applied", {
              folderPath,
              folders: result.folders?.length || 0,
              files: result.files?.length || 0,
            });
            setFolderState({
              path: result.folderPath || folderPath,
              parentPath: result.parentPath || "",
              folders: result.folders || [],
              files: result.files || [],
              entries: result.entries || [...(result.folders || []), ...(result.files || [])],
              loading: false,
              error: "",
            });
          } else if (isActiveRestore()) {
            throw new Error("folder list canceled");
          }
        } catch (error) {
          bridge.debugLog?.("renderer:restore:folder-fallback", {
            folderPath,
            message: error?.message,
          });
          if (isActiveRestore()) {
            try {
              const paths = desktopPath ? { desktop: desktopPath } : await bridge.getPaths?.();
              const fallbackPath = paths?.desktop || "";
              const fallback = fallbackPath ? await listFolderWithTimeout(fallbackPath) : null;
              if (fallbackPath && !fallback?.canceled) {
                setFolderState({
                  path: fallback.folderPath || fallbackPath,
                  parentPath: fallback.parentPath || "",
                  folders: fallback.folders || [],
                  files: fallback.files || [],
                  entries: fallback.entries || [...(fallback.folders || []), ...(fallback.files || [])],
                  loading: false,
                  error: "",
                });
                persistSession({ folderPath: fallback.folderPath || fallbackPath, activePath: "" });
              } else {
                setFolderState({
                  path: folderPath,
                  parentPath: "",
                  files: [],
                  folders: [],
                  entries: [],
                  loading: false,
                  error: "文件树读取超时或失败",
                });
              }
            } catch {
              setFolderState({
                path: folderPath,
                parentPath: "",
                files: [],
                folders: [],
                entries: [],
                loading: false,
                error: "文件树读取超时或失败",
              });
            }
          }
        }
      }
      if (restorePaths.length) {
        const restoredTabs = [];
        for (const restorePath of restorePaths) {
          try {
            const result = await bridge.openDocumentPath(restorePath);
            if (!isActiveRestore()) {
              return;
            }
            if (!result?.canceled && result?.document) {
              const normalized = normalizeDocument(result.document, letterTemplates);
              restoredTabs.push(createDocumentTab(normalized, result.path, false));
            }
          } catch {
            // Missing or unreadable session files are skipped.
          }
        }
        if (isActiveRestore() && restoredTabs.length) {
          const activeTab = restoredTabs.find((tab) => tab.path === activePath) || restoredTabs[0];
          setOpenTabs(restoredTabs);
          setActiveTabId(activeTab.id);
          applyDocument(activeTab.document, activeTab.path, false);
          persistSession({
            activePath: activeTab.path,
            tabs: summarizeSessionTabs(restoredTabs),
          });
        } else if (isActiveRestore()) {
          persistSession({ activePath: "", tabs: [] });
        }
      }
      if (isActiveRestore()) {
        sessionRestoredRef.current = true;
        bridge.debugLog?.("renderer:restore:complete", { runId });
      }
    };
    restoreSession();
    return () => {
      canceled = true;
      bridge.debugLog?.("renderer:restore:canceled", { runId });
    };
  }, [applyDocument, editor, letterTemplates, persistSession]);

  const handleSelectTab = useCallback(
    (tabId) => {
      if (tabId === activeTabId) {
        setActivePane("main");
        return;
      }
      const target = openTabs.find((tab) => tab.id === tabId);
      if (!target) {
        return;
      }
      const currentDocument = getSaveDocument();
      const currentEditorJson = editor?.getJSON?.() || null;
      const currentScrollState = readCanvasScrollState(mainCanvasRef.current);
      setOpenTabs((tabs) => tabs.map((tab) => (
        tab.id === activeTabId
          ? { ...tab, document: currentDocument, editorJson: currentEditorJson, title: currentDocument.title, path: currentPath, dirty, scrollState: currentScrollState }
          : tab
      )));
      setActiveTabId(target.id);
      setActivePane("main");
      applyDocument(target.document, target.path, target.dirty, { editorJson: target.editorJson, scrollState: target.scrollState });
    },
    [activeTabId, applyDocument, currentPath, dirty, editor, getSaveDocument, openTabs],
  );

  const handleOpenTabTemplates = useCallback((tabId) => {
    if (tabId && tabId !== activeTabId) {
      handleSelectTab(tabId);
    } else {
      setActivePane("main");
    }
    setTemplateDialogOpen(true);
  }, [activeTabId, handleSelectTab]);

  const handleCloseTab = useCallback(
    async (tabId) => {
      const closingIndex = openTabs.findIndex((tab) => tab.id === tabId);
      const closingTab = openTabs[closingIndex];
      if (!closingTab) {
        return;
      }
      const isActive = tabId === activeTabId;
      const isDirty = isActive ? dirty : closingTab.dirty;
      if (isDirty) {
        const decision = await showConfirmDialog({
          tone: "warning",
          icon: FileText,
          eyebrow: "未保存的信笺",
          title: "这个文件尚未保存",
          message: "要关闭这个信笺吗？",
          detail: "关闭后，这个信笺中尚未保存的修改不会写入文件。",
          cancelValue: "cancel",
          actions: [
            { value: "close", label: "关闭信笺", variant: "danger", icon: X },
            { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
          ],
        });
        if (decision !== "close") {
          return;
        }
      }
      const remaining = openTabs.filter((tab) => tab.id !== tabId);
      if (!remaining.length) {
        const blank = createBlankDocument(letterTemplates, newDocumentTemplateId);
        const nextTab = createDocumentTab(blank);
        setOpenTabs([nextTab]);
        setActiveTabId(nextTab.id);
        applyDocument(blank, "", false, { scrollState: nextTab.scrollState });
        return;
      }
      setOpenTabs(remaining);
      if (isActive) {
        const nextTab = remaining[Math.max(0, closingIndex - 1)] || remaining[0];
        setActiveTabId(nextTab.id);
        applyDocument(nextTab.document, nextTab.path, nextTab.dirty, { editorJson: nextTab.editorJson, scrollState: nextTab.scrollState });
      }
    },
    [activeTabId, applyDocument, dirty, letterTemplates, newDocumentTemplateId, openTabs, showConfirmDialog],
  );

  const handleNew = useCallback(() => {
    addOrActivateDocumentTab(createBlankDocument(letterTemplates, newDocumentTemplateId), "", false);
    showStatus("已新建空白信笺", "success");
  }, [addOrActivateDocumentTab, letterTemplates, newDocumentTemplateId, showStatus]);

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
    setFolderState({
      path: result.folderPath || "",
      parentPath: result.parentPath || "",
      folders: result.folders || [],
      files: result.files || [],
      entries: result.entries || [...(result.folders || []), ...(result.files || [])],
      loading: false,
      error: "",
    });
    setExpandedFolders({});
    showStatus("文件夹已打开", "success");
  }, [showStatus]);

  const handleOpenFolderPath = useCallback(async (path) => {
    if (!path) {
      return;
    }
    setFolderState((previous) => ({
      ...previous,
      path,
      loading: true,
    }));
    const result = await listFolderWithTimeout(path);
    if (result?.canceled) {
      setFolderState((previous) => ({
        ...previous,
      loading: false,
      error: "",
    }));
      showStatus("无法打开这个文件夹", "warning");
      return;
    }
    setFolderState({
      path: result.folderPath || path,
      parentPath: result.parentPath || "",
      folders: result.folders || [],
      files: result.files || [],
      entries: result.entries || [...(result.folders || []), ...(result.files || [])],
      loading: false,
      error: "",
    });
    setExpandedFolders({});
  }, [showStatus]);

  const refreshFolder = useCallback(async () => {
    if (!folderState.path) {
      return;
    }
    const result = await listFolderWithTimeout(folderState.path);
    if (!result?.canceled) {
      setFolderState({
        path: result.folderPath || folderState.path,
        parentPath: result.parentPath || "",
        folders: result.folders || [],
        files: result.files || [],
        entries: result.entries || [...(result.folders || []), ...(result.files || [])],
        loading: false,
        error: "",
      });
    }
  }, [folderState.path]);

  useEffect(() => {
    refreshFolderRef.current = refreshFolder;
  }, [refreshFolder]);

  const refreshTreeAfterEntryChange = useCallback(async (folderPath = "") => {
    await refreshFolder();
    if (folderPath && expandedFolders[folderPath]?.expanded) {
      const result = await listFolderWithTimeout(folderPath);
      if (!result?.canceled) {
        setExpandedFolders((state) => ({
          ...state,
          [folderPath]: {
            ...(state[folderPath] || {}),
            expanded: true,
            loading: false,
            entries: result.entries || [...(result.folders || []), ...(result.files || [])],
          },
        }));
      }
    }
  }, [expandedFolders, refreshFolder]);

  const handleOpenFolderFile = useCallback(
    async (path) => {
      const existingTab = openTabs.find((tab) => tab.path === path);
      if (existingTab) {
        if (existingTab.id !== activeTabId) {
          handleSelectTab(existingTab.id);
        }
        return;
      }
      const startedAt = window.performance?.now?.() || Date.now();
      showStatus("正在打开文档...", "success");
      const result = await bridge.openDocumentPath(path);
      bridge.debugLog?.("renderer:document:open-path:return", {
        path,
        canceled: Boolean(result?.canceled),
        hasDocument: Boolean(result?.document),
        ipcMs: Math.round((window.performance?.now?.() || Date.now()) - startedAt),
      });
      if (result?.canceled || !result?.document) {
        showStatus("这个文件不是笺间文档", "warning");
        return;
      }
      addOrActivateDocumentTab(result.document, result.path, false);
      showStatus("文档已打开", "success");
    },
    [activeTabId, addOrActivateDocumentTab, handleSelectTab, openTabs, showStatus],
  );

  const handleCreateFolderInTree = useCallback(async (entry) => {
    const parentPath = entry?.path || folderState.path;
    if (!parentPath) {
      return;
    }
    const name = await showPromptDialog({
      title: "新建子文件夹",
      label: "文件夹名称",
      defaultValue: "新建文件夹",
      confirmLabel: "新建",
      icon: FolderPlus,
    });
    if (!name?.trim()) {
      return;
    }
    const result = await bridge.createFolder?.(parentPath, name);
    if (!result?.ok) {
      showStatus(result?.message || "新建文件夹失败", "warning");
      return;
    }
    await refreshTreeAfterEntryChange(parentPath);
    showStatus("文件夹已新建", "success");
  }, [folderState.path, refreshTreeAfterEntryChange, showPromptDialog, showStatus]);

  const handleCreateDocumentInTree = useCallback(async (entry) => {
    const folderPath = entry?.path || folderState.path;
    if (!folderPath) {
      return;
    }
    const title = await showPromptDialog({
      title: "新建信笺",
      label: "信笺名称",
      defaultValue: "未命名信笺",
      confirmLabel: "新建",
      icon: FilePlus,
    });
    if (!title?.trim()) {
      return;
    }
    const blank = createBlankDocument(letterTemplates, newDocumentTemplateId);
    const result = await bridge.createDocumentInFolder?.(folderPath, title, blank);
    if (!result?.ok) {
      showStatus(result?.message || "新建信笺失败", "warning");
      return;
    }
    await refreshTreeAfterEntryChange(folderPath);
    addOrActivateDocumentTab(result.document || { ...blank, title: title.trim() }, result.path, false);
    showStatus("信笺已新建", "success");
  }, [addOrActivateDocumentTab, folderState.path, letterTemplates, newDocumentTemplateId, refreshTreeAfterEntryChange, showPromptDialog, showStatus]);

  const handleRenameTreeEntry = useCallback(async (entry) => {
    if (!entry?.path) {
      return;
    }
    const currentName = entry.type === "file" ? (entry.displayName || entry.name.replace(/\.[^.]+$/, "")) : entry.name;
    const nextName = await showPromptDialog({
      title: "重命名",
      label: entry.type === "file" ? "信笺名称" : "文件夹名称",
      defaultValue: currentName,
      confirmLabel: "保存",
      icon: Pencil,
    });
    if (!nextName?.trim() || nextName.trim() === currentName) {
      return;
    }
    const result = await bridge.renameEntry?.(entry.path, nextName);
    if (!result?.ok) {
      showStatus(result?.message || "重命名失败", "warning");
      return;
    }

    if (entry.type === "file") {
      setOpenTabs((tabs) => tabs.map((tab) => (
        tab.path === entry.path
          ? { ...tab, path: result.path, title: nextName.trim() }
          : tab
      )));
      if (currentPath === entry.path) {
        setCurrentPath(result.path);
        setDocumentState((previous) => ({
          ...previous,
          title: nextName.trim(),
          updatedAt: new Date().toISOString(),
        }));
        persistSession({ activePath: result.path });
      }
    }

    await refreshTreeAfterEntryChange(result.folderPath || folderState.path);
    showStatus("已重命名", "success");
  }, [currentPath, folderState.path, persistSession, refreshTreeAfterEntryChange, showPromptDialog, showStatus]);

  const handleBackupTreeDocument = useCallback(async (entry) => {
    if (!entry?.path || entry.type !== "file") {
      return;
    }
    const result = await bridge.backupDocument?.(entry.path);
    if (!result?.ok) {
      showStatus(result?.message || "备份失败", "warning");
      return;
    }
    await refreshTreeAfterEntryChange(result.folderPath || folderState.path);
    showStatus("备份已复制到当前目录", "success");
  }, [folderState.path, refreshTreeAfterEntryChange, showStatus]);

  const handleDeleteTreeEntry = useCallback(async (entry) => {
    if (!entry?.path) {
      return;
    }
    const label = entry.type === "file" ? (entry.displayName || entry.name) : entry.name;
    const scope = entry.type === "folder" ? "这个文件夹及其内部内容" : "这个信笺";
    const decision = await showConfirmDialog({
      tone: "warning",
      icon: Trash2,
      eyebrow: entry.type === "folder" ? "删除文件夹" : "删除信笺",
      title: entry.type === "folder" ? "删除这个文件夹？" : "删除这个信笺？",
      message: `确定删除${scope}“${label}”吗？`,
      detail: "删除后会进入回收站。",
      cancelValue: "cancel",
      actions: [
        { value: "delete", label: "删除", variant: "danger", icon: Trash2 },
        { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
      ],
    });
    if (decision !== "delete") {
      return;
    }
    const result = await bridge.deleteEntry?.(entry.path);
    if (!result?.ok) {
      showStatus(result?.message || "删除失败", "warning");
      return;
    }

    if (entry.type === "file") {
      const remainingTabs = openTabs.filter((tab) => tab.path !== entry.path);
      if (currentPath === entry.path) {
        if (remainingTabs.length) {
          const nextTab = remainingTabs[0];
          setOpenTabs(remainingTabs);
          setActiveTabId(nextTab.id);
          applyDocument(nextTab.document, nextTab.path, nextTab.dirty, { editorJson: nextTab.editorJson, scrollState: nextTab.scrollState });
          persistSession({ activePath: nextTab.path || "" });
        } else {
          const blank = createBlankDocument(letterTemplates, newDocumentTemplateId);
          const tab = createDocumentTab(blank);
          setOpenTabs([tab]);
          setActiveTabId(tab.id);
          applyDocument(blank, "", false, { scrollState: tab.scrollState });
          persistSession({ activePath: "" });
        }
      } else {
        setOpenTabs(remainingTabs);
        if (openTabs.some((tab) => tab.path === entry.path && tab.id === activeTabId)) {
          const nextTab = remainingTabs[0];
          if (nextTab) {
            setActiveTabId(nextTab.id);
            applyDocument(nextTab.document, nextTab.path, nextTab.dirty, { editorJson: nextTab.editorJson, scrollState: nextTab.scrollState });
          }
        }
      }
    }

    await refreshTreeAfterEntryChange(result.folderPath || folderState.path);
    showStatus("已删除", "success");
  }, [activeTabId, applyDocument, currentPath, folderState.path, letterTemplates, newDocumentTemplateId, openTabs, persistSession, refreshTreeAfterEntryChange, showConfirmDialog, showStatus]);

  const handleMoveTreeEntry = useCallback(async (entry, targetFolderPath) => {
    if (!entry?.path || !targetFolderPath) {
      return;
    }
    const result = await bridge.moveEntry?.(entry.path, targetFolderPath);
    if (!result?.ok) {
      showStatus(result?.message || "移动失败", "warning");
      return;
    }

    if (entry.type === "file") {
      setOpenTabs((tabs) => tabs.map((tab) => (
        tab.path === result.oldPath
          ? { ...tab, path: result.path }
          : tab
      )));
      if (currentPath === result.oldPath) {
        setCurrentPath(result.path);
        persistSession({ activePath: result.path });
      }
    } else {
      setOpenTabs((tabs) => tabs.map((tab) => (
        pathIsSameOrInside(tab.path, result.oldPath)
          ? { ...tab, path: replacePathPrefix(tab.path, result.oldPath, result.path) }
          : tab
      )));
      if (pathIsSameOrInside(currentPath, result.oldPath)) {
        const nextPath = replacePathPrefix(currentPath, result.oldPath, result.path);
        setCurrentPath(nextPath);
        persistSession({ activePath: nextPath });
      }
    }

    await refreshTreeAfterEntryChange(result.sourceParent || folderState.path);
    await refreshTreeAfterEntryChange(result.targetFolderPath || targetFolderPath);
    showStatus("已移动", "success");
  }, [currentPath, folderState.path, persistSession, refreshTreeAfterEntryChange, showStatus]);

  const handleToggleFolder = useCallback(async (path) => {
    if (!path) {
      return;
    }
    const existing = expandedFolders[path];
    if (existing?.expanded) {
      setExpandedFolders((state) => ({
        ...state,
        [path]: { ...existing, expanded: false },
      }));
      return;
    }

    setExpandedFolders((state) => ({
      ...state,
      [path]: { ...(state[path] || {}), expanded: true, loading: true },
    }));
    const result = await listFolderWithTimeout(path);
    setExpandedFolders((state) => ({
      ...state,
      [path]: {
        expanded: true,
        loading: false,
        entries: result?.canceled ? [] : (result.entries || [...(result.folders || []), ...(result.files || [])]),
      },
    }));
  }, [expandedFolders]);

  const handleOutlineItemClick = useCallback(
    (item) => {
      if (!editor || typeof item?.pos !== "number") {
        return;
      }
      if (item.type === "toc") {
        const tocNode = editor.state.doc.nodeAt(item.pos);
        const selectionPos = Math.min(item.pos + (tocNode?.nodeSize || 1), editor.state.doc.content.size);
        editor.chain().focus().setTextSelection(selectionPos).run();
      } else {
        const selectionPos = Math.min(item.pos + 1, editor.state.doc.content.size);
        editor.chain().focus().setTextSelection(selectionPos).run();
      }
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
      if (splitPaneActive && rightSplitTab) {
        const nextDocument = getRightSplitSaveDocument();
        if (!nextDocument) {
          return;
        }
        const previousDocumentKey = documentRuntimeKey(rightSplitTab.path, rightSplitTab.id);
        const result = await bridge.saveDocument(nextDocument, rightSplitTab.path, saveAs);
        if (result?.canceled) {
          return;
        }
        migrateAiRequestDocumentKey(previousDocumentKey, documentRuntimeKey(result.path, rightSplitTab.id));
        setOpenTabs((tabs) => tabs.map((tab) => (
          tab.id === rightSplitTab.id
            ? {
                ...tab,
                path: result.path,
                title: nextDocument.title,
                document: nextDocument,
                editorJson: rightSplitEditor?.getJSON?.() || tab.editorJson,
                dirty: false,
              }
            : tab
        )));
        if (rightSplitTab.id === activeTabIdRef.current) {
          setDocumentState(nextDocument);
          setCurrentPath(result.path);
          setDirty(false);
          persistSession({ activePath: result.path });
        }
        refreshFolder();
        showStatus("右分屏信笺已保存", "success");
        return;
      }
      const nextDocument = getSaveDocument();
      const previousDocumentKey = activeDocumentKeyRef.current;
      const result = await bridge.saveDocument(nextDocument, currentPath, saveAs);
      if (result?.canceled) {
        return;
      }
      migrateAiRequestDocumentKey(previousDocumentKey, documentRuntimeKey(result.path, activeTabIdRef.current));
      setDocumentState(nextDocument);
      setCurrentPath(result.path);
      setDirty(false);
      persistSession({ activePath: result.path });
      refreshFolder();
      showStatus("文档已保存", "success");
    },
    [currentPath, getRightSplitSaveDocument, getSaveDocument, migrateAiRequestDocumentKey, persistSession, refreshFolder, rightSplitEditor, rightSplitTab, showStatus, splitPaneActive],
  );

  useEffect(() => {
    const unsubscribe = bridge.onCloseRequest?.(async (payload = {}) => {
      const snapshot = buildOpenTabsSnapshot();
      const dirtyTabs = snapshot.filter((tab) => tab.dirty);
      let finalTabs = snapshot;

      if (dirtyTabs.length) {
        const decision = await showConfirmDialog({
          tone: "save",
          icon: Save,
          eyebrow: "关闭前确认",
          title: dirtyTabs.length > 1 ? `${dirtyTabs.length} 篇信笺尚未保存` : "当前信笺尚未保存",
          message: "选择保存并关闭，会先保存已有文件。",
          detail: "未命名信笺会保存为临时会话文件，下次启动会恢复打开。",
          cancelValue: "cancel",
          actions: [
            { value: "save", label: "保存并关闭", variant: "primary", icon: Save, autoFocus: true },
            { value: "discard", label: "不保存", variant: "secondary" },
            { value: "cancel", label: "取消", variant: "ghost" },
          ],
        });
        if (decision === "cancel" || !decision) {
          await bridge.closeCanceled?.(payload);
          return;
        }

        if (decision === "save") {
          const savedTabs = [];
          try {
            for (const tab of finalTabs) {
              if (!tab.dirty) {
                savedTabs.push(tab);
                continue;
              }
              const result = tab.path
                ? await bridge.saveDocument(tab.document, tab.path, false)
                : await bridge.saveTempDocument?.(tab.document, tab.id);
              if (result?.canceled || !result?.path) {
                await bridge.closeCanceled?.(payload);
                return;
              }
              savedTabs.push({
                ...tab,
                path: result.path,
                dirty: false,
              });
            }
            finalTabs = savedTabs;
          } catch (error) {
            showStatus(error?.message || "关闭前保存失败", "warning");
            await bridge.closeCanceled?.(payload);
            return;
          }
        }
      }

      const activeTab = finalTabs.find((tab) => tab.id === activeTabIdRef.current) || finalTabs[0];
      persistSession({
        activePath: activeTab?.path || "",
        tabs: summarizeSessionTabs(finalTabs),
      });
      await bridge.closeReady?.(payload);
    });
    return () => unsubscribe?.();
  }, [buildOpenTabsSnapshot, persistSession, showConfirmDialog, showStatus]);

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
          && latestDocument.createdAt === activeDocument.createdAt
          && latestDocument.displayDate === activeDocument.displayDate
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

  const handleExportPdf = useCallback(async (targetPath) => {
    const nextDocument = getSaveDocument();
    setDocumentState(nextDocument);
    setPrintMode(true);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const result = await bridge.exportPdf(nextDocument.title, targetPath);
      if (!result?.canceled) {
        showStatus("PDF 已导出", "success");
      }
      return result;
    } finally {
      setPrintMode(false);
    }
  }, [getSaveDocument, showStatus]);

  const handleExportImages = useCallback(async (targetPath) => {
    const nextDocument = getSaveDocument();
    setDocumentState(nextDocument);
    const previousCanvasScroll = window.document.querySelector(".canvas")?.scrollTop || 0;
    window.document.body.classList.add("image-export-body");
    setImageExportMode(true);
    try {
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
      const canvas = window.document.querySelector(".canvas");
      if (canvas) {
        canvas.scrollTop = 0;
        canvas.scrollLeft = 0;
      }
      window.scrollTo(0, 0);
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
      const pageRects = prepareImageExportRects();
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      if (!pageRects.length) {
        showStatus("没有可导出的内容", "warning");
        return { canceled: true, reason: "empty" };
      }
      const result = await bridge.exportPageImages(nextDocument.title, pageRects, targetPath);
      if (!result?.canceled) {
        showStatus(`已导出 ${result.count || pageRects.length} 张图片`, "success");
      }
      return result;
    } finally {
      const canvas = window.document.querySelector(".canvas");
      if (canvas) {
        window.requestAnimationFrame(() => {
          canvas.scrollTop = previousCanvasScroll;
        });
      }
      cleanupImageExportStage();
      setImageExportMode(false);
      window.document.body.classList.remove("image-export-body");
    }
  }, [getSaveDocument, showStatus]);

  const handleInsertImage = useCallback(async () => {
    const result = await bridge.pickImage();
    if (result?.canceled || !result?.dataUrl) {
      return;
    }
    activeWorkEditor?.chain().focus().setImage({ src: result.dataUrl, alt: result.name || "图片", caption: "", width: "78%" }).run();
  }, [activeWorkEditor]);

  const handleInsertMedia = useCallback(async (kind) => {
    const picker = kind === "video" ? bridge.pickVideo : bridge.pickAudio;
    let result;
    try {
      result = await picker?.();
    } catch {
      showStatus(`${kind === "video" ? "视频" : "音频"}文件读取失败`, "warning");
      return;
    }
    if (!result || result.canceled) {
      return;
    }
    const label = kind === "video" ? "视频" : "音频";
    const maxBytes = kind === "video" ? VIDEO_MAX_BYTES : AUDIO_MAX_BYTES;
    if (result.error === "too-large") {
      showStatus(`${label}文件不能超过 ${Math.round(maxBytes / 1024 / 1024)} MB`, "warning");
      return;
    }
    if (result.error === "unsupported-type") {
      showStatus(`不支持这个${label}格式`, "warning");
      return;
    }
    if (result.error || !result.dataUrl) {
      showStatus(`${label}文件读取失败`, "warning");
      return;
    }
    activeWorkEditor?.chain().focus().insertContent({
      type: "paperMedia",
      attrs: {
        kind,
        src: result.dataUrl,
        fileName: result.fileName || result.name || `未命名${label}`,
        mime: result.mime || "",
        width: "78%",
      },
    }).run();
    showStatus(`${label}已插入`, "success");
  }, [activeWorkEditor, showStatus]);

  const handleOpenLinkDialog = useCallback(() => {
    const context = getEditorLinkContext(activeWorkEditor, activeWorkSelectionRef);
    if (!context || !activeWorkEditor) {
      return;
    }
    setLinkDialog({ ...context, editor: activeWorkEditor });
  }, [activeWorkEditor, activeWorkSelectionRef]);

  const handleCloseLinkDialog = useCallback(() => {
    setLinkDialog(null);
  }, []);

  const handleEditLinkFromCanvas = useCallback((context, targetEditor) => {
    if (!context?.editing || !targetEditor) {
      return;
    }
    setLinkDialog({ ...context, editor: targetEditor });
  }, []);

  const handleSubmitLink = useCallback(({ text, url }) => {
    if (!linkDialog?.editor) {
      return;
    }
    const content = {
      type: "text",
      text,
      marks: [{
        type: "link",
        attrs: {
          href: url,
          target: "_blank",
          rel: "noopener noreferrer nofollow",
          class: null,
        },
      }],
    };
    linkDialog.editor
      .chain()
      .focus()
      .insertContentAt({ from: linkDialog.from, to: linkDialog.to }, content)
      .setTextSelection(linkDialog.from + text.length)
      .run();
    setLinkDialog(null);
    showStatus(linkDialog.editing ? "链接已更新" : "链接已插入", "success");
  }, [linkDialog, showStatus]);

  const handleRemoveLink = useCallback(() => {
    if (!linkDialog?.editor) {
      return;
    }
    linkDialog.editor.chain().focus().setTextSelection({ from: linkDialog.from, to: linkDialog.to }).unsetLink().run();
    setLinkDialog(null);
    showStatus("链接已移除", "success");
  }, [linkDialog, showStatus]);

  const updateDocumentSetting = useCallback((patch) => {
    setDocumentState((previous) => ({
      ...previous,
      ...patch,
      updatedAt: new Date().toISOString(),
    }));
    setDirty(true);
  }, []);

  const handleCreateUserTemplate = useCallback((template) => {
    const nextTemplate = normalizeUserTemplate(template, userTemplateGroups);
    const duplicateTemplate = letterTemplates.some((item) => (
      item.id !== nextTemplate.id
      && templateNameKey(item.label) === templateNameKey(nextTemplate.label)
    ));
    if (duplicateTemplate) {
      showStatus("模板名称已存在，无法创建", "warning");
      return "";
    }
    setUserLetterTemplates((templates) => [...templates, nextTemplate]);
    showStatus(`已新建用户模板“${nextTemplate.label}”`, "success");
    return nextTemplate.id;
  }, [letterTemplates, showStatus, userTemplateGroups]);

  const handleUpdateUserTemplate = useCallback((templateId, patch) => {
    if (Object.prototype.hasOwnProperty.call(patch, "label")) {
      const duplicateTemplate = letterTemplates.some((template) => (
        template.id !== templateId
        && templateNameKey(template.label) === templateNameKey(patch.label)
      ));
      if (duplicateTemplate) {
        showStatus("模板名称已存在，无法保存", "warning");
        return false;
      }
    }
    setUserLetterTemplates((templates) => templates.map((template) => (
      template.id === templateId
        ? normalizeUserTemplate({ ...template, ...patch }, userTemplateGroups)
        : template
    )));
    return true;
  }, [letterTemplates, showStatus, userTemplateGroups]);

  const handleCreateUserTemplateGroup = useCallback((label) => {
    const nextGroup = {
      id: createTemplateGroupId(),
      label: normalizeTemplateGroupName(label),
      createdAt: Date.now(),
    };
    if (!nextGroup.label) {
      return "";
    }
    if (userTemplateGroups.some((group) => group.label.toLocaleLowerCase() === nextGroup.label.toLocaleLowerCase())) {
      showStatus("用户模板分组名称已存在", "warning");
      return "";
    }
    setUserTemplateGroups((groups) => normalizeUserTemplateGroups([...groups, nextGroup]));
    showStatus(`已新建模板分组“${nextGroup.label}”`, "success");
    return nextGroup.id;
  }, [showStatus, userTemplateGroups]);

  const handleRenameUserTemplateGroup = useCallback((groupId, label) => {
    if (groupId === BASE_USER_TEMPLATE_GROUP_ID) {
      return;
    }
    const normalizedLabel = normalizeTemplateGroupName(label);
    if (!normalizedLabel) {
      return;
    }
    if (userTemplateGroups.some((group) => (
      group.id !== groupId
      && group.label.toLocaleLowerCase() === normalizedLabel.toLocaleLowerCase()
    ))) {
      showStatus("用户模板分组名称已存在", "warning");
      return;
    }
    setUserTemplateGroups((groups) => normalizeUserTemplateGroups(groups.map((group) => (
      group.id === groupId ? { ...group, label: normalizedLabel } : group
    ))));
    showStatus(`模板分组已重命名为“${normalizedLabel}”`, "success");
  }, [showStatus, userTemplateGroups]);

  const handleReorderUserTemplateGroups = useCallback((sourceGroupId, targetIndex) => {
    if (
      sourceGroupId === BASE_USER_TEMPLATE_GROUP_ID
      || !Number.isInteger(targetIndex)
    ) {
      return;
    }
    setUserTemplateGroups((groups) => {
      const sourceIndex = groups.findIndex((group) => group.id === sourceGroupId);
      if (sourceIndex < 1 || targetIndex < 1 || targetIndex >= groups.length || sourceIndex === targetIndex) {
        return groups;
      }
      const nextGroups = [...groups];
      const [movedGroup] = nextGroups.splice(sourceIndex, 1);
      nextGroups.splice(targetIndex, 0, movedGroup);
      return normalizeUserTemplateGroups(nextGroups);
    });
  }, []);

  const handleDeleteUserTemplateGroup = useCallback((groupId) => {
    if (groupId === BASE_USER_TEMPLATE_GROUP_ID) {
      return;
    }
    const group = userTemplateGroups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }
    setUserLetterTemplates((templates) => templates.map((template) => (
      template.groupIds?.includes(groupId)
        ? { ...template, groupIds: template.groupIds.filter((id) => id !== groupId) }
        : template
    )));
    setUserTemplateGroups((groups) => groups.filter((item) => item.id !== groupId));
    const baseGroupLabel = userTemplateGroups.find((item) => item.id === BASE_USER_TEMPLATE_GROUP_ID)?.label || "我的模板";
    showStatus(`已删除分组“${group.label}”，其中模板仍保留在“${baseGroupLabel}”`, "success");
  }, [showStatus, userTemplateGroups]);

  const handleMoveUserTemplate = useCallback((templateId, groupId, checked) => {
    const template = userLetterTemplates.find((item) => item.id === templateId);
    const group = userTemplateGroups.find((item) => item.id === groupId);
    if (!template || !group || group.id === BASE_USER_TEMPLATE_GROUP_ID) {
      return;
    }
    const currentGroupIds = Array.isArray(template.groupIds)
      ? template.groupIds
      : [BASE_USER_TEMPLATE_GROUP_ID];
    const alreadyIncluded = currentGroupIds.includes(group.id);
    if (alreadyIncluded === checked) {
      return;
    }
    const nextGroupIds = checked
      ? [...currentGroupIds, group.id]
      : currentGroupIds.filter((id) => id !== group.id);
    setUserLetterTemplates((templates) => templates.map((item) => (
      item.id === templateId ? { ...item, groupIds: nextGroupIds } : item
    )));
    showStatus(
      checked
        ? `已将“${template.label}”加入“${group.label}”`
        : `已将“${template.label}”从“${group.label}”移除`,
      "success",
    );
  }, [showStatus, userLetterTemplates, userTemplateGroups]);

  const handleDeleteUserTemplate = useCallback((templateId) => {
    const template = userLetterTemplates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }
    const documentFallback = DEFAULT_LETTER_TEMPLATES.find((item) => item.paperId === template.paperId)
      || DEFAULT_LETTER_TEMPLATES[0];
    const wasNewDocumentDefault = newDocumentTemplateId === templateId;
    let newDocumentFallback = documentFallback;
    const remainingTemplates = letterTemplates.filter((item) => item.id !== templateId);
    const nextHistory = normalizeNewDocumentTemplateHistory(
      newDocumentTemplateHistory,
      remainingTemplates,
    );
    if (wasNewDocumentDefault) {
      for (let index = nextHistory.length - 1; index >= 0; index -= 1) {
        const historicalTemplate = remainingTemplates.find((item) => item.id === nextHistory[index]);
        if (historicalTemplate) {
          newDocumentFallback = historicalTemplate;
          nextHistory.splice(index, 1);
          break;
        }
      }
      if (!remainingTemplates.some((item) => item.id === newDocumentFallback.id)) {
        newDocumentFallback = remainingTemplates.find((item) => !item.userTemplate)
          || remainingTemplates[0]
          || DEFAULT_LETTER_TEMPLATES[0];
      }
    }
    setUserLetterTemplates((templates) => templates.filter((item) => item.id !== templateId));
    setNewDocumentTemplateHistory(nextHistory);
    if (wasNewDocumentDefault) {
      setNewDocumentTemplateId(newDocumentFallback.id);
    }
    if (documentStateRef.current.letterTemplateId === templateId) {
      updateDocumentSetting({
        letterTemplateId: documentFallback.id,
        templateId: documentFallback.paperId,
        fontFamily: documentFallback.typography.bodyFont,
        fontSize: documentFallback.typography.bodySize,
        customBackground: "",
      });
      const defaultFallbackMessage = wasNewDocumentDefault
        ? `；新建默认已恢复为“${newDocumentFallback.label}”`
        : "";
      showStatus(`已删除“${template.label}”，当前信笺已切换为“${documentFallback.label}”${defaultFallbackMessage}`, "success");
      return;
    }
    if (wasNewDocumentDefault) {
      showStatus(`已删除“${template.label}”，新建默认模板已恢复为“${newDocumentFallback.label}”`, "success");
      return;
    }
    showStatus(`已删除用户模板“${template.label}”`, "success");
  }, [letterTemplates, newDocumentTemplateHistory, newDocumentTemplateId, showStatus, updateDocumentSetting, userLetterTemplates]);

  const handleNewDocumentTemplateChange = useCallback((templateId) => {
    const template = letterTemplates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    if (template.id === newDocumentTemplateId) {
      const nextHistory = normalizeNewDocumentTemplateHistory(newDocumentTemplateHistory, letterTemplates);
      let fallbackTemplate = null;
      while (nextHistory.length && !fallbackTemplate) {
        const previousTemplateId = nextHistory.pop();
        if (previousTemplateId !== template.id) {
          fallbackTemplate = letterTemplates.find((item) => item.id === previousTemplateId) || null;
        }
      }

      if (!fallbackTemplate) {
        const systemInitialTemplate = DEFAULT_LETTER_TEMPLATES[0];
        if (systemInitialTemplate?.id !== template.id) {
          fallbackTemplate = systemInitialTemplate;
        } else {
          const randomCandidates = DEFAULT_LETTER_TEMPLATES.filter((item) => item.id !== template.id);
          fallbackTemplate = randomCandidates[Math.floor(Math.random() * randomCandidates.length)] || systemInitialTemplate;
        }
      }

      if (!fallbackTemplate) {
        return;
      }
      setNewDocumentTemplateHistory(nextHistory);
      setNewDocumentTemplateId(fallbackTemplate.id);
      showStatus(`已取消“${template.label}”的新建默认，已恢复为“${fallbackTemplate.label}”`, "success");
      return;
    }

    setNewDocumentTemplateHistory((history) => normalizeNewDocumentTemplateHistory(
      [...history, newDocumentTemplateId],
      letterTemplates,
    ));
    setNewDocumentTemplateId(template.id);
    showStatus(`已将“${template.label}”设为新建信笺的默认模板`, "success");
  }, [letterTemplates, newDocumentTemplateHistory, newDocumentTemplateId, showStatus]);

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

  const handleSaveAiConfig = useCallback(async (draft) => {
    const result = await bridge.saveAiConfig?.(draft);
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    showStatus("AI 设置已保存", "success");
    return { ...normalized, ok: true, message: "AI 设置已保存" };
  }, [showStatus]);

  const handleCreateAiProvider = useCallback(async (draft) => {
    const result = await bridge.createAiProvider?.(draft);
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    showStatus("供应商已添加", "success");
    return { ...normalized, createdProvider: result?.createdProvider, ok: true, message: "供应商已添加" };
  }, [showStatus]);

  const handleDeleteAiProvider = useCallback(async (providerId) => {
    const result = await bridge.deleteAiProvider?.(providerId);
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    showStatus("供应商已删除", "success");
    return { ...normalized, ok: true, message: "供应商已删除" };
  }, [showStatus]);

  const handleTestAiConfig = useCallback(async (draft) => {
    const result = await bridge.testAiConfig?.(draft);
    showStatus(result?.message || "AI 连接测试完成", result?.ok ? "success" : "warning");
    return result || { ok: false, message: "AI 连接测试失败" };
  }, [showStatus]);

  const handleClearAiConfig = useCallback(async (draft) => {
    const result = await bridge.saveAiConfig?.({ ...draft, clearApiKey: true });
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    showStatus("AI 密钥已清空", "success");
    return { ...normalized, ok: true, message: "AI 密钥已清空" };
  }, [showStatus]);

  const handleRefreshCodexCli = useCallback(async () => {
    const result = await bridge.refreshCodexCliStatus?.();
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    showStatus(result?.message || "Codex CLI 检查完成", result?.ok ? "success" : "warning");
    return { ...normalized, ok: Boolean(result?.ok), message: result?.message || "Codex CLI 检查完成" };
  }, [showStatus]);

  const handleLoginCodexCli = useCallback(async () => {
    const result = await bridge.startCodexCliLogin?.();
    if (result) setAiConfig(normalizePublicAiConfig(result));
    showStatus(result?.message || "已启动 Codex 登录", result?.ok ? "success" : "warning");
    return result;
  }, [showStatus]);

  const exitAiMode = useCallback(() => {
    const requestId = aiRequestIdRef.current;
    if (requestId && aiStatus === "streaming") {
      bridge.cancelAi?.(requestId);
    }
    aiRequestIdRef.current = "";
    setAiModeKind("none");
    aiStartedAtRef.current = 0;
    aiPromptTokenEstimateRef.current = 0;
    aiRequestMetaRef.current = { kind: "" };
    aiChatAssistantIdRef.current = "";
    if (aiPreviousSidebarsRef.current) {
      setLeftSidebarCollapsed(aiPreviousSidebarsRef.current.left);
      aiPreviousSidebarsRef.current = null;
    }
  }, [aiStatus]);

  const enterAiMode = useCallback((kind) => {
    if (aiMode) {
      return false;
    }
    setAiSelectedProvider(effectiveAiProvider);
    aiPreviousSidebarsRef.current = {
      left: leftSidebarCollapsed,
    };
    setLeftSidebarCollapsed(true);
    setAiModeKind(kind);
    if (normalizeAiState(documentStateRef.current?.aiState).lastMode !== kind) {
      updateActiveDocumentAiState((previous) => ({ ...previous, lastMode: kind }));
    }
    aiRequestIdRef.current = "";
    aiStartedAtRef.current = 0;
    aiPromptTokenEstimateRef.current = 0;
    aiRequestMetaRef.current = { kind: "" };
    aiChatAssistantIdRef.current = "";
    return true;
  }, [aiMode, effectiveAiProvider, leftSidebarCollapsed, updateActiveDocumentAiState]);

  const handleStopAi = useCallback(() => {
    const requestId = aiRequestIdRef.current;
    if (requestId) {
      bridge.cancelAi?.(requestId);
    }
  }, []);

  const handleCaptureAiChatSelection = useCallback((selection) => {
    if (!selection?.text) {
      showStatus("请先在左侧标记一段文字", "warning");
      return;
    }
    const displayIndex = aiChatSelections.length + 1;
    updateChatState((chat) => ({
      ...chat,
      selectedTexts: [...chat.selectedTexts, { ...selection, id: createAiChatSelectionId() }],
    }));
    showStatus(`已记录标记文字${displayIndex}`, "success");
  }, [aiChatSelections.length, showStatus, updateChatState]);

  const handleRemoveAiChatSelection = useCallback((selectionId) => {
    updateChatState((chat) => ({
      ...chat,
      selectedTexts: chat.selectedTexts.filter((selection) => selection.id !== selectionId),
    }));
  }, [updateChatState]);

  const handleJumpAiChatSelection = useCallback((selection) => {
    if (!editor || !selection) {
      return;
    }
    const maxPosition = editor.state.doc.content.size;
    const from = Math.max(1, Math.min(Number(selection.from) || 1, maxPosition));
    const to = Math.max(1, Math.min(Number(selection.to) || 1, maxPosition));
    if (from === to) {
      showStatus("这条标记文字的位置已失效", "warning");
      return;
    }
    editor.chain().focus().setTextSelection({ from: Math.min(from, to), to: Math.max(from, to) }).scrollIntoView().run();
  }, [editor, showStatus]);

  const handleEnterAiOptimize = useCallback(() => {
    enterAiMode("optimize");
  }, [enterAiMode]);

  const handleEnterAiChat = useCallback(() => {
    if (enterAiMode("chat")) {
      aiChatContextRef.current = { signature: "", context: "", images: [] };
    }
  }, [enterAiMode]);

  const handleStartAiOptimize = useCallback(async () => {
    if (aiStatus === "streaming") {
      return;
    }
    if (!aiHasUsableProvider) {
      setAiSettingsOpen(true);
      showStatus("请先配置模型", "warning");
      return;
    }
    const activePresentation = getLetterTemplate(documentStateRef.current, letterTemplates).presentation;
    const aiInput = buildAiPromptInput(editor, activePresentation);
    if (!aiInput.body) {
      showStatus("正文为空，暂时没有可交给 AI 优化的内容", "warning");
      return;
    }
    const requestId = createAiRequestId();
    const documentKey = activeDocumentKeyRef.current;
    const startedAt = Date.now();
    updateOptimizeStateForKey(documentKey, {
      output: "",
      status: "streaming",
      error: "",
      assets: aiInput.assets,
      elapsedSeconds: 0,
      tokenStats: null,
      provider: effectiveAiConfig.provider,
      modelId: effectiveAiConfig.modelId,
      modelName: effectiveAiConfig.modelName || effectiveAiConfig.model,
    });
    aiRequestIdRef.current = requestId;
    aiRequestMetaRef.current = { kind: "optimize" };
    aiStartedAtRef.current = startedAt;
    aiPromptTokenEstimateRef.current = estimateTokenCount(aiInput.prompt);
    aiRequestContextsRef.current.set(requestId, {
      requestId,
      kind: "optimize",
      documentKey,
      startedAt,
      promptTokenEstimate: aiPromptTokenEstimateRef.current,
      outputBuffer: "",
      flushId: 0,
    });
    const result = await bridge.generateAi?.({
      requestId,
      provider: effectiveAiConfig.provider,
      modelId: effectiveAiConfig.modelId,
      prompt: aiInput.prompt,
      workspacePath: folderState.path,
      documentPath: currentPath,
    });
    if (!result?.ok) {
      aiRequestContextsRef.current.delete(requestId);
      updateOptimizeStateForKey(documentKey, {
        status: "error",
        error: result?.message || "AI 生成启动失败",
        elapsedSeconds: 0,
      });
      showStatus(result?.message || "AI 生成启动失败", "warning");
    }
  }, [aiHasUsableProvider, aiStatus, currentPath, effectiveAiConfig.model, effectiveAiConfig.modelId, effectiveAiConfig.modelName, effectiveAiConfig.provider, editor, folderState.path, letterTemplates, showStatus, updateOptimizeStateForKey]);

  const handleAiChatPresetSelect = useCallback((preset) => {
    if (preset?.id === "rewrite-selection" && !aiChatSelections.length) {
      showStatus("请先在左侧框选文字，再点浮条里的标记文字", "warning");
      return;
    }
    const prompt = preset?.id === "rewrite-selection" && aiChatSelections.length > 1
      ? "请分别改写我标记的这些文字，保持原意，但让表达更自然、更有力度。"
      : preset?.prompt || "";
    updateChatState({ input: prompt });
  }, [aiChatSelections.length, showStatus, updateChatState]);

  const handleSendAiChat = useCallback(async () => {
    const question = aiChatInput.trim();
    if (!question || aiStatus === "streaming") {
      return;
    }
    if (!aiHasUsableProvider) {
      setAiSettingsOpen(true);
      showStatus("请先配置模型", "warning");
      return;
    }

    const activePresentation = getLetterTemplate(documentStateRef.current, letterTemplates).presentation;
    const nextSignature = buildAiChatContextSignature(editor, documentStateRef.current, activePresentation);
    if (nextSignature !== aiChatContextRef.current.signature) {
      aiChatContextRef.current = buildAiChatContextInput(editor, documentStateRef.current, activePresentation, nextSignature);
    }
    const selectedTextBlocks = aiChatSelections
      .map((selection, index) => {
        const text = selection.text?.trim();
        return text ? `<<<SELECTED_TEXT_${index + 1}\n${text}\nSELECTED_TEXT_${index + 1}>>>` : "";
      })
      .filter(Boolean);
    const selectedTextContext = selectedTextBlocks.length
      ? `\n\n用户额外标记的文字：\n${selectedTextBlocks.join("\n\n")}`
      : "";

    const createdAt = Date.now();
    const userMessage = {
      id: `user-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      role: "user",
      content: question,
      status: "done",
      createdAt,
    };
    const assistantMessage = {
      id: `assistant-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      role: "assistant",
      content: "",
      status: "streaming",
      elapsedSeconds: 0,
      createdAt,
    };
    const history = aiChatMessagesRef.current
      .filter((message) => (message.role === "user" || message.role === "assistant") && message.content?.trim())
      .map((message) => ({ role: message.role, content: message.content }));
    const isCodexChat = effectiveAiConfig.transport === "codex-cli";
    const attachOriginalImages = isCodexChat && aiChatCodexImageMode === "original" && aiChatContextRef.current.images.length > 0;
    const imageContextInstruction = attachOriginalImages
      ? "当前信笺的全部原图已作为图片附件提供；正文中的 [图N.标题] 与附件顺序一一对应。"
      : "当前信笺图片未提供原图，只能依据正文中的 [图N.标题] 占位理解图片。";
    const messages = [
      {
        role: "system",
        content: `${AI_CHAT_SYSTEM_PREFIX}\n${imageContextInstruction}\n\n当前信笺内容：\n${aiChatContextRef.current.context}${selectedTextContext}`,
      },
      ...history,
      { role: "user", content: question },
    ];
    const requestId = createAiRequestId();
    const documentKey = activeDocumentKeyRef.current;
    const startedAt = Date.now();
    const promptTokenEstimate = estimateTokenCount(messages.map((message) => message.content).join("\n"));

    updateChatStateForKey(documentKey, (chat) => ({
      ...chat,
      input: "",
      messages: [...chat.messages, userMessage, assistantMessage],
      status: "streaming",
      error: "",
    }));
    aiRequestIdRef.current = requestId;
    aiRequestMetaRef.current = { kind: "chat" };
    aiChatAssistantIdRef.current = assistantMessage.id;
    aiPromptTokenEstimateRef.current = promptTokenEstimate;
    aiStartedAtRef.current = startedAt;
    aiRequestContextsRef.current.set(requestId, {
      requestId,
      kind: "chat",
      documentKey,
      assistantId: assistantMessage.id,
      startedAt,
      promptTokenEstimate,
    });

    const result = await bridge.generateAi?.({
      requestId,
      provider: effectiveAiConfig.provider,
      modelId: effectiveAiConfig.modelId,
      messages,
      workspacePath: folderState.path,
      documentPath: currentPath,
      codexScope: aiChatCodexScope,
      ...(isCodexChat ? {
        codexImageMode: aiChatCodexImageMode,
        codexImages: attachOriginalImages ? aiChatContextRef.current.images : [],
      } : {}),
    });
    if (!result?.ok) {
      const message = result?.message || "AI 生成启动失败";
      aiRequestContextsRef.current.delete(requestId);
      updateChatStateForKey(documentKey, (chat) => ({
        ...chat,
        status: "error",
        error: message,
        messages: chat.messages.map((item) => (
          item.id === assistantMessage.id ? { ...item, content: message, status: "error" } : item
        )),
      }));
      aiRequestIdRef.current = "";
      aiChatAssistantIdRef.current = "";
      aiRequestMetaRef.current = { kind: "" };
      showStatus(message, "warning");
    }
  }, [aiChatCodexImageMode, aiChatCodexScope, aiChatInput, aiChatSelections, aiHasUsableProvider, aiStatus, currentPath, effectiveAiConfig.modelId, effectiveAiConfig.provider, effectiveAiConfig.transport, editor, folderState.path, letterTemplates, showStatus, updateChatStateForKey]);

  const handleClearAiChat = useCallback(() => {
    if (aiStatus === "streaming") {
      return;
    }
    updateChatState({ ...createEmptyAiChatState(), codexScope: aiChatCodexScope, codexImageMode: aiChatCodexImageMode });
  }, [aiChatCodexImageMode, aiChatCodexScope, aiStatus, updateChatState]);

  const handleCodexScopeChange = useCallback((codexScope) => {
    updateChatState({ codexScope: normalizeCodexScope(codexScope) });
  }, [updateChatState]);

  const handleCodexImageModeChange = useCallback((codexImageMode) => {
    updateChatState({ codexImageMode: normalizeCodexImageMode(codexImageMode) });
  }, [updateChatState]);

  const handleClearAiOptimize = useCallback(() => {
    if (aiStatus === "streaming") {
      return;
    }
    updateOptimizeState(createEmptyAiOptimizeState());
  }, [aiStatus, updateOptimizeState]);

  const handleExportAiChat = useCallback(async () => {
    if (!aiChatMessages.length) {
      showStatus("当前没有可导出的问答记录", "warning");
      return;
    }
    const markdown = chatMessagesToMarkdown(documentStateRef.current, aiChatMessages);
    const result = await bridge.exportAiChat?.({ title: documentStateRef.current?.title || "AI问答", markdown });
    if (!result?.canceled) {
      showStatus("AI 问答记录已导出", "success");
    }
  }, [aiChatMessages, showStatus]);

  const handleCopyAiBlock = useCallback(async (block) => {
    try {
      await copyAiBlockToClipboard(block);
      showStatus("已复制这一块", "success");
    } catch (error) {
      showStatus(error?.message || "复制失败", "warning");
    }
  }, [showStatus]);

  const shellClassName = [
    "desktop-shell",
    printMode ? "print-mode" : "",
    imageExportMode ? "image-export-mode" : "",
    aiMode ? "ai-mode" : "",
    leftSidebarCollapsed ? "left-sidebar-collapsed" : "",
  ].filter(Boolean).join(" ");
  const appShellClassName = [
    "app-shell",
    leftSidebarCollapsed ? "left-collapsed" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={shellClassName}>
      <TitleBar />
      <TopNav
        editor={aiMode ? editor : activeWorkEditor}
        document={aiMode ? documentState : activeWorkDocument}
        savedSelectionRef={aiMode ? editorSelectionRef : activeWorkSelectionRef}
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
        onOpenExport={() => setExportDialogOpen(true)}
        onInsertImage={handleInsertImage}
        onInsertAudio={() => handleInsertMedia("audio")}
        onInsertVideo={() => handleInsertMedia("video")}
        onOpenLinkDialog={handleOpenLinkDialog}
        onOpenHelp={openHelpCenter}
        aiMode={aiMode}
        aiModeKind={aiModeKind}
        aiBusy={aiStatus === "streaming"}
        aiConfigured={aiHasUsableProvider}
        editorLocked={aiMode && aiStatus === "streaming"}
        tableOfContentsInserted={tableOfContentsInserted}
        onOpenAiSettings={() => setAiSettingsOpen(true)}
        onEnterAiOptimize={handleEnterAiOptimize}
        onEnterAiChat={handleEnterAiChat}
        onExitAi={exitAiMode}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={() => setLeftSidebarCollapsed((collapsed) => !collapsed)}
      />
      <div className={appShellClassName}>
        {!leftSidebarCollapsed ? (
          <LeftSidebar
            currentPath={currentPath}
            folderState={folderState}
            mode={leftSidebarMode}
            outlineItems={outlineItems}
            expandedFolders={expandedFolders}
            onOpenFolder={handleOpenFolder}
            onOpenFolderPath={handleOpenFolderPath}
            onOpenFolderFile={handleOpenFolderFile}
            onToggleFolder={handleToggleFolder}
            onCreateFolder={handleCreateFolderInTree}
            onCreateDocument={handleCreateDocumentInTree}
            onRenameEntry={handleRenameTreeEntry}
            onBackupDocument={handleBackupTreeDocument}
            onDeleteEntry={handleDeleteTreeEntry}
            onMoveEntry={handleMoveTreeEntry}
            onModeChange={setLeftSidebarMode}
            onOutlineItemClick={handleOutlineItemClick}
          />
        ) : null}
        <section className="workspace">
          <div className="work-surface">
            {aiOptimizeMode || aiChatMode ? (
              <div className="ai-mode-top-strip">
                <DocumentTabs
                  tabs={openTabs}
                  activeTabId={activeTabId}
                  rightSplitTabId={rightSplitTabId}
                  onSelectTab={handleSelectTab}
                  onCloseTab={handleCloseTab}
                  onNew={handleNew}
                  closeDisabled
                  newDisabled
                  showNew={false}
                />
                {aiOptimizeMode ? (
                  <AiOptimizeToolbar
                    status={aiStatus}
                    hasResult={Boolean(aiOutput || aiError || aiTokenStats)}
                    editor={editor}
                    savedSelectionRef={editorSelectionRef}
                    finalizedBreakInserted={finalizedBreakInserted}
                    availableProviders={availableAiProviders}
                    selectedProvider={effectiveAiProvider}
                    onProviderChange={setAiSelectedProvider}
                    onStart={handleStartAiOptimize}
                    onStop={handleStopAi}
                    onClear={handleClearAiOptimize}
                  />
                ) : null}
                {aiChatMode ? (
                  <AiChatToolbar
                    availableProviders={availableAiProviders}
                    selectedProvider={effectiveAiProvider}
                    status={aiStatus}
                    messages={aiChatMessages}
                    hasState={Boolean(aiChatMessages.length || aiChatInput || aiChatSelections.length || aiError)}
                    codexScope={aiChatCodexScope}
                    codexImageMode={aiChatCodexImageMode}
                    imageCount={aiChatImageCount}
                    workspacePath={folderState.path}
                    documentPath={currentPath}
                    onProviderChange={setAiSelectedProvider}
                    onCodexScopeChange={handleCodexScopeChange}
                    onCodexImageModeChange={handleCodexImageModeChange}
                    onStop={handleStopAi}
                    onClear={handleClearAiChat}
                    onExport={handleExportAiChat}
                  />
                ) : null}
              </div>
            ) : (
              <DocumentTabs
                tabs={openTabs}
                activeTabId={activeTabId}
                rightSplitTabId={rightSplitTabId}
                onSelectTab={handleSelectTab}
                onCloseTab={handleCloseTab}
                onNew={handleNew}
                onToggleRightSplit={handleToggleRightSplit}
                onOpenTemplates={handleOpenTabTemplates}
                disabled={aiMode}
                onCapacityChange={setTabCapacityFull}
              />
            )}
            <div className={[
              "paper-workspace",
              aiMode ? "ai-split-workspace" : "",
              !aiMode && rightSplitDocument ? "document-split-workspace" : "",
              aiChatMode ? "chat-mode" : "",
            ].filter(Boolean).join(" ")}>
              <PaperCanvas
                editor={editor}
                document={documentState}
                letterTemplates={letterTemplates}
                printMode={printMode}
                imageExportMode={imageExportMode}
                onTitleChange={handleTitleChange}
                onAuthorChange={handleAuthorChange}
                onDateChange={handleDateChange}
                savedSelectionRef={editorSelectionRef}
                className={[
                  aiMode ? "ai-source-canvas" : "",
                  !aiMode && activePane === "main" ? "active-pane" : "",
                ].filter(Boolean).join(" ")}
                onActivate={() => setActivePane("main")}
                readOnly={aiMode && aiStatus === "streaming"}
                aiCaptureEnabled={aiMode && aiChatMode}
                onCaptureAiSelection={handleCaptureAiChatSelection}
                comments={aiMode ? [] : documentState.comments}
                activeCommentId={commentPanel?.pane === "main" ? commentPanel.commentId : ""}
                commentsHidden={aiMode || printMode || imageExportMode}
                onCreateComment={aiMode ? undefined : ((selection, position) => handleStartComment("main", selection, position))}
                onOpenComment={aiMode ? undefined : ((comment, position) => handleOpenComment("main", comment, position))}
                onEditLink={aiMode ? undefined : handleEditLinkFromCanvas}
                canvasRef={mainCanvasRef}
              />
              {!aiMode && rightSplitDocument ? (
                <div className="right-split-pane">
                  <button type="button" className="right-split-close" onClick={() => { setRightSplitTabId(""); setActivePane("main"); }} aria-label="取消右分屏" title="取消右分屏">
                    <X size={15} />
                  </button>
                  <PaperCanvas
                    editor={rightSplitEditor}
                    document={rightSplitDocument}
                    letterTemplates={letterTemplates}
                    printMode={printMode}
                    imageExportMode={imageExportMode}
                    onTitleChange={handleRightSplitTitleChange}
                    onAuthorChange={handleRightSplitAuthorChange}
                    onDateChange={handleRightSplitDateChange}
                    savedSelectionRef={rightSplitSelectionRef}
                    className={activePane === "right" ? "right-split-canvas active-pane" : "right-split-canvas"}
                    onActivate={() => setActivePane("right")}
                    comments={rightSplitDocument.comments}
                    activeCommentId={commentPanel?.pane === "right" ? commentPanel.commentId : ""}
                    commentsHidden={aiMode || printMode || imageExportMode}
                    onCreateComment={(selection, position) => handleStartComment("right", selection, position)}
                    onOpenComment={(comment, position) => handleOpenComment("right", comment, position)}
                    onEditLink={handleEditLinkFromCanvas}
                  />
                </div>
              ) : null}
              {aiOptimizeMode ? (
                <AiResultPane
                  document={documentState}
                  letterTemplates={letterTemplates}
                  output={aiOutput}
                  status={aiStatus}
                  error={aiError}
                  assets={aiAssets}
                  elapsedSeconds={aiElapsedSeconds}
                  tokenStats={aiTokenStats}
                  onCopyBlock={handleCopyAiBlock}
                />
              ) : null}
              {aiChatMode ? (
                <AiChatPane
                  availableProviders={availableAiProviders}
                  document={documentState}
                  letterTemplates={letterTemplates}
                  messages={aiChatMessages}
                  input={aiChatInput}
                  selectedTexts={aiChatSelections}
                  status={aiStatus}
                  error={aiError}
                  onInputChange={(input) => updateChatState({ input })}
                  onSend={handleSendAiChat}
                  onRemoveSelectedText={handleRemoveAiChatSelection}
                  onJumpSelectedText={handleJumpAiChatSelection}
                  onPresetSelect={handleAiChatPresetSelect}
                />
              ) : null}
            </div>
          </div>
        </section>
      </div>
      {templateDialogOpen ? (
        <LetterTemplateDialog
          document={documentState}
          letterTemplates={letterTemplates}
          defaultTemplates={DEFAULT_LETTER_TEMPLATES}
          userTemplates={userLetterTemplates}
          userTemplateGroups={userTemplateGroups}
          newDocumentTemplateId={newDocumentTemplateId}
          onClose={() => setTemplateDialogOpen(false)}
          onLetterTemplateChange={handleLetterTemplateChange}
          onNewDocumentTemplateChange={handleNewDocumentTemplateChange}
          onCreateUserTemplate={handleCreateUserTemplate}
          onUpdateUserTemplate={handleUpdateUserTemplate}
          onDeleteUserTemplate={handleDeleteUserTemplate}
          onCreateUserTemplateGroup={handleCreateUserTemplateGroup}
          onRenameUserTemplateGroup={handleRenameUserTemplateGroup}
          onDeleteUserTemplateGroup={handleDeleteUserTemplateGroup}
          onReorderUserTemplateGroups={handleReorderUserTemplateGroups}
          onMoveUserTemplate={handleMoveUserTemplate}
        />
      ) : null}
      <StatusBar
        document={activeWorkDocument || documentState}
        stats={activeWorkStats}
        dirty={splitPaneActive ? Boolean(rightSplitTab?.dirty) : dirty}
        version={updateState?.version}
        cacheSummary={documentCacheSummary}
        updateState={updateState}
        onRunUpdate={handleRunUpdate}
        onClearCache={handleClearDocumentCache}
      />
      {commentPanel ? (
        <CommentPanel
          panel={commentPanel}
          comment={commentPanelComment}
          onTextChange={(text) => setCommentPanel((panel) => panel ? { ...panel, text } : panel)}
          onPositionChange={(position) => setCommentPanel((panel) => panel ? { ...panel, x: position.x, y: position.y } : panel)}
          onSave={handleSaveCommentPanel}
          onEdit={handleEditCommentPanel}
          onDelete={handleDeleteCommentPanel}
          onClose={() => setCommentPanel(null)}
        />
      ) : null}
      <StatusToast status={status} />
      <AppConfirmDialog dialog={confirmDialog} onResolve={resolveConfirmDialog} />
      <AppPromptDialog dialog={promptDialog} onResolve={resolvePromptDialog} />
      <LinkDialog
        dialog={linkDialog}
        onClose={handleCloseLinkDialog}
        onSubmit={handleSubmitLink}
        onRemove={handleRemoveLink}
      />
      <AiSettingsDialog
        open={aiSettingsOpen}
        config={aiConfig}
        onClose={() => setAiSettingsOpen(false)}
        onSave={handleSaveAiConfig}
        onCreateProvider={handleCreateAiProvider}
        onDeleteProvider={handleDeleteAiProvider}
        onTest={handleTestAiConfig}
        onClear={handleClearAiConfig}
        onRefreshCodex={handleRefreshCodexCli}
        onLoginCodex={handleLoginCodexCli}
      />
      <HelpCenterDialog
        open={helpOpen}
        onClose={closeHelpCenter}
      />
      <ExportDialog
        open={exportDialogOpen}
        documentTitle={activeWorkDocument?.title || documentState.title || "未命名信笺"}
        onClose={() => setExportDialogOpen(false)}
        onExportPdf={handleExportPdf}
        onExportImages={handleExportImages}
      />
    </div>
  );
}
