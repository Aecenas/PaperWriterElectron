import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Minus,
  PanelLeftClose,
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
  UserRound,
  Undo2,
  Wifi,
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
const USER_TEMPLATE_STORAGE_KEY = "paperwriter.userLetterTemplates";
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
const AI_CHAT_SYSTEM_PREFIX = "你是信笺写作的 AI 问答助手。你可以阅读用户当前正在写的信笺内容，并围绕内容、结构、表达、事实一致性和写作策略回答问题。图片不会提供原图，只会提供图片标题占位。回答要具体、克制、可执行。";
const AI_CHAT_SELECTION_PLUGIN_KEY = new PluginKey("paperwriterAiChatSelections");
const AI_FINALIZED_START = "【已定稿开始】";
const AI_FINALIZED_END = "【已定稿结束】";
const AI_FINALIZED_INSTRUCTION = `注意：正文中位于${AI_FINALIZED_START}和${AI_FINALIZED_END}之间的内容已经定稿，只作为背景上下文，不要改写这部分；请主要优化该符号之后的内容。`;
const AI_PROVIDER_OPTIONS = [
  {
    id: "gemini",
    label: "Gemini",
    model: "gemini-3.1-pro-preview",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
  },
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

const ICON_ASSETS = {
  goldPen: new URL("./assets/icons/gold-pen.png", import.meta.url).href,
  goldFolderFull: new URL("./assets/icons/gold-folder-full.png", import.meta.url).href,
  goldFolderEmpty: new URL("./assets/icons/gold-folder-empty.png", import.meta.url).href,
  gemini: new URL("./assets/icons/gemini-official.svg", import.meta.url).href,
  deepseek: new URL("./assets/icons/deepseek-favicon.ico", import.meta.url).href,
  cacheBroom: new URL("./assets/icons/cache-broom.png", import.meta.url).href,
  updateArrow: new URL("./assets/icons/update-arrow.svg", import.meta.url).href,
  rightSplit: new URL("./assets/icons/right-split.png", import.meta.url).href,
};

const DECOR_ASSETS = {
  tocTitleSignature: new URL("./assets/decor/toc-title-signature.png", import.meta.url).href,
};

const HELP_SCREENSHOTS = {
  "file-tree": new URL("./assets/help/screenshots/left-panel.png", import.meta.url).href,
  tabs: new URL("./assets/help/screenshots/tabs.png", import.meta.url).href,
  "save-export": new URL("./assets/help/screenshots/top-tools.png", import.meta.url).href,
  editor: new URL("./assets/help/screenshots/editor.png", import.meta.url).href,
  "selection-toolbar": new URL("./assets/help/screenshots/selection-toolbar.png", import.meta.url).href,
  "top-tools": new URL("./assets/help/screenshots/top-tools.png", import.meta.url).href,
  table: new URL("./assets/help/screenshots/table.png", import.meta.url).href,
  "ai-settings": new URL("./assets/help/screenshots/ai-settings.png", import.meta.url).href,
  "ai-optimize": new URL("./assets/help/screenshots/ai-optimize.png", import.meta.url).href,
  "ai-chat": new URL("./assets/help/screenshots/ai-chat.png", import.meta.url).href,
  "split-view": new URL("./assets/help/screenshots/split-view.png", import.meta.url).href,
  templates: new URL("./assets/help/screenshots/workspace.png", import.meta.url).href,
  statusbar: new URL("./assets/help/screenshots/statusbar.png", import.meta.url).href,
  workspace: new URL("./assets/help/screenshots/workspace.png", import.meta.url).href,
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
    id: "file-tree-outline",
    categoryId: "files",
    title: "文件树与大纲",
    summary: "**左侧栏**负责在[[文件夹]]、[[信笺]]和[[正文结构]]之间切换。",
    illustration: "file-tree",
    steps: ["点击文件树顶部入口选择工作目录。", "**单击**展开文件夹，**双击**进入文件夹。", "切到__大纲__后，按标题快速定位正文。"],
    tips: ["右键文件或文件夹可新建、重命名、备份或删除。", "拖动信笺到可见文件夹可直接移动。"],
  },
  {
    id: "tabs-queue",
    categoryId: "files",
    title: "标签页与打开队列",
    summary: "打开的信笺共用[[顶部标签栏]]，空间不足时按队列管理。",
    illustration: "tabs",
    steps: ["点击标签切换信笺。", "关闭按钮只关闭当前标签，**不会删除文件**。", "标签栏满时，外部打开新信笺会自动关闭最前面的标签。"],
    tips: ["AI 模式下也可以从左半区标签切换已打开信笺。", "未保存信笺关闭前会走保存确认。"],
  },
  {
    id: "save-export",
    categoryId: "files",
    title: "保存、另存与导出",
    summary: "**保存**写回当前信笺，**导出**输出 PDF 或图片。",
    illustration: "save-export",
    steps: ["保存写回当前信笺；另存为生成新信笺文件。", "导出 PDF 适合归档和打印。", "导出图片会按__分页符__切成多张图。"],
    tips: ["未命名信笺会先保存为临时会话文件，重启后可恢复。", "分页符之间的内容会成为单张导出图片。"],
  },
  {
    id: "body-editor",
    categoryId: "writing",
    title: "正文编辑",
    summary: "标题、署名、日期和正文都可直接编辑，排版跟随[[信纸模板]]。",
    illustration: "editor",
    steps: ["点击标题、署名或日期即可修改。", "正文样式跟随当前信笺模板。", "**撤销/重做**在顶部右侧工具栏。"],
    tips: ["生成目录依赖标题层级。", "正文里的图片标题会参与图片统计。"],
  },
  {
    id: "selection-toolbar",
    categoryId: "writing",
    title: "选中文字悬浮条",
    summary: "框选正文后出现，用来处理[[局部文字样式]]。",
    illustration: "selection-toolbar",
    steps: ["框选文字后，悬浮条出现在选区附近。", "可设置**加粗**、斜体、__下划线线型__、字体颜色和水彩背景。", "AI 问答中可把选中文字标记给 AI。"],
    tips: ["下划线右侧小箭头可选[[波浪线、虚线、双横线]]。", "悬浮条只影响当前选区。"],
  },
  {
    id: "insert-media",
    categoryId: "writing",
    title: "图片、引用与分页符",
    summary: "顶部右侧工具栏负责不依赖选区的[[插入和段落操作]]。",
    illustration: "top-tools",
    steps: ["引用会插入带来源行的引用块。", "插入图片后可编辑标题。", "__分页符__用于控制导出图片分段。"],
    tips: ["分割线适合做段落之间的轻量分隔。", "目录可以反复点击生成或关闭。"],
  },
  {
    id: "table-edit",
    categoryId: "writing",
    title: "表格",
    summary: "顶部表格按钮只插入默认表格，增删行列在[[表格自身工具条]]完成。",
    illustration: "table",
    steps: ["点击顶部表格图标插入默认表格。", "光标放进表格后，上方出现小工具条。", "用工具条增删上/下行、左/右列，或删除整张表。"],
    tips: ["表格工具条会悬在表格上方，避免遮挡单元格内容。"],
  },
  {
    id: "ai-settings",
    categoryId: "ai",
    title: "AI 设置",
    summary: "AI 设置用于管理[[供应商、模型和密钥测试]]。",
    illustration: "ai-settings",
    steps: ["从顶部 AI 功能进入 AI 配置。", "选择供应商后填写 API Key 和模型。", "测试通过后，AI 优化和 AI 问答才会使用该模型。"],
    tips: ["默认模型会显示“默”标记。", "配置只保存在本机，不写入信笺文件。"],
  },
  {
    id: "ai-optimize",
    categoryId: "ai",
    title: "AI 优化",
    summary: "AI 优化读取当前信笺，为正文生成[[优化稿]]。",
    illustration: "ai-optimize",
    steps: ["点击 AI 优化进入左右分栏。", "右侧显示模型和优化结果。", "可重新优化、清空优化，或把结果插入__定稿线__。"],
    tips: ["优化记录跟随当前信笺保存。", "重新优化会覆盖当前信笺已有的优化结果。"],
  },
  {
    id: "ai-chat",
    categoryId: "ai",
    title: "AI 问答",
    summary: "AI 问答围绕当前信笺进行[[审阅、改写、找漏洞和标题生成]]。",
    illustration: "ai-chat",
    steps: ["点击 AI 问答进入问答面板。", "可直接提问，也可先在正文里标记文字。", "问答记录会按**信笺**独立保存。"],
    tips: ["清空只清空当前信笺的问答记录。", "切换已打开信笺后，会显示对应信笺自己的问答上下文。"],
  },
  {
    id: "split-view",
    categoryId: "view",
    title: "左右分屏",
    summary: "非 AI 模式下，可把一个已打开信笺固定到[[右侧分屏]]。",
    illustration: "split-view",
    steps: ["右键某个标签页，选择向右分屏。", "左侧继续编辑当前信笺，右侧显示被分屏信笺。", "再次右键该标签，或点击右侧关闭按钮取消。"],
    tips: ["右分屏只允许一个。", "右分屏时不能打开右侧信笺模板栏，但左侧文件栏仍可使用。"],
  },
  {
    id: "templates",
    categoryId: "view",
    title: "信笺模板",
    summary: "右侧栏用于选择[[信纸样式]]和管理用户模板。",
    illustration: "templates",
    steps: ["点击右侧浮动按钮展开信笺模板。", "选择默认模板可立即套用到当前信笺。", "用户模板可以基于当前模板新建并调整字体字号。"],
    tips: ["进入 AI 或右分屏时，右侧模板栏会被限制，以免挤占编辑区域。"],
  },
  {
    id: "status-cache-update",
    categoryId: "view",
    title: "状态栏、缓存与更新",
    summary: "底部状态栏显示统计、[[自动保存]]、缓存和版本更新。",
    illustration: "statusbar",
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
    label: template?.label?.trim() || "我的信笺模板",
    paperId,
    description: template?.description?.trim() || "用户模板 / 可编辑",
    typography: cloneTypography(template?.typography),
    userTemplate: true,
  };
}

function createUserTemplate(baseTemplate = DEFAULT_LETTER_TEMPLATES[0]) {
  return normalizeUserTemplate({
    id: createTemplateId(),
    label: `${baseTemplate.label || "信笺模板"} 副本`,
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

function getAiProviderDefaults(provider) {
  return AI_PROVIDER_OPTIONS.find((option) => option.id === provider) || AI_PROVIDER_OPTIONS[0];
}

function createAiModelId(provider, model = "") {
  const source = String(model || "default").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${provider}-${source || "model"}`;
}

function createAiModelKey(provider, modelId) {
  return `${provider}::${modelId || createAiModelId(provider)}`;
}

function parseAiModelKey(value = "") {
  const [provider, modelId] = String(value || "").split("::");
  return {
    provider: getAiProviderDefaults(provider).id,
    modelId: modelId || "",
  };
}

function normalizePublicAiModelConfig(provider, config = {}, index = 0) {
  const defaults = getAiProviderDefaults(provider);
  const model = String(config.model || defaults.model).trim() || defaults.model;
  return {
    id: config.id || createAiModelId(provider, model || String(index + 1)),
    name: String(config.name || config.modelName || (index === 0 ? "默认模型" : `模型 ${index + 1}`)).trim() || `模型 ${index + 1}`,
    model,
    testedOk: Boolean(config.testedOk),
    testedAt: config.testedAt || "",
    testMessage: config.testMessage || "",
  };
}

function normalizePublicAiProviderConfig(provider, config = {}) {
  const defaults = getAiProviderDefaults(provider);
  const legacyModel = {
    id: config.activeModelId || createAiModelId(defaults.id, config.model || defaults.model),
    name: config.modelName || "默认模型",
    model: config.model || defaults.model,
    testedOk: config.testedOk,
    testedAt: config.testedAt,
    testMessage: config.testMessage,
  };
  const modelsSource = Array.isArray(config.models) && config.models.length ? config.models : [legacyModel];
  const models = modelsSource.map((modelConfig, index) => normalizePublicAiModelConfig(defaults.id, modelConfig, index));
  const activeModelId = config.activeModelId && models.some((model) => model.id === config.activeModelId)
    ? config.activeModelId
    : models[0].id;
  const activeModel = models.find((model) => model.id === activeModelId) || models[0];
  return {
    provider: defaults.id,
    providerLabel: defaults.label,
    baseUrl: config.baseUrl || defaults.baseUrl,
    hasApiKey: Boolean(config.hasApiKey),
    apiKeyLast4: config.apiKeyLast4 || "",
    activeModelId,
    models,
    modelId: activeModel.id,
    modelName: activeModel.name,
    model: activeModel.model,
    testedOk: Boolean(activeModel.testedOk),
    testedAt: activeModel.testedAt || "",
    testMessage: activeModel.testMessage || "",
  };
}

function normalizePublicAiConfig(config) {
  const activeProvider = getAiProviderDefaults(config?.activeProvider || config?.provider).id;
  const providers = {};
  AI_PROVIDER_OPTIONS.forEach((option) => {
    providers[option.id] = normalizePublicAiProviderConfig(option.id, config?.providers?.[option.id] || (config?.provider === option.id ? config : {}));
  });
  const activeProviderConfig = providers[activeProvider] || providers.gemini;
  const requestedModelId = config?.activeModelId || config?.modelId || activeProviderConfig.activeModelId;
  const activeModel = activeProviderConfig.models.find((model) => model.id === requestedModelId) || activeProviderConfig.models[0];
  const activeModelId = activeModel.id;
  return {
    ...DEFAULT_AI_CONFIG,
    activeProvider,
    activeModelId,
    activeModelKey: createAiModelKey(activeProvider, activeModelId),
    providers,
    provider: activeProviderConfig.provider,
    providerLabel: activeProviderConfig.providerLabel,
    modelId: activeModel.id,
    modelName: activeModel.name,
    model: activeModel.model,
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
  return AI_PROVIDER_OPTIONS.flatMap((option) => {
    const providerConfig = normalized.providers[option.id] || normalizePublicAiProviderConfig(option.id);
    if (!providerConfig.hasApiKey) {
      return [];
    }
    return providerConfig.models
      .filter((model) => model.testedOk)
      .map((model) => ({
        id: createAiModelKey(option.id, model.id),
        provider: option.id,
        providerLabel: option.label,
        modelId: model.id,
        modelName: model.name,
        model: model.model,
        label: option.label,
        baseUrl: providerConfig.baseUrl,
      }));
  });
}

function getAiProviderRuntimeConfig(config, modelKey) {
  const normalized = normalizePublicAiConfig(config);
  const parsed = parseAiModelKey(modelKey || normalized.activeModelKey);
  const providerId = getAiProviderDefaults(parsed.provider || normalized.activeProvider).id;
  const providerConfig = normalized.providers[providerId] || normalizePublicAiProviderConfig(providerId);
  const model = providerConfig.models.find((item) => item.id === parsed.modelId)
    || providerConfig.models.find((item) => item.id === normalized.activeModelId)
    || providerConfig.models[0];
  return {
    ...normalized,
    provider: providerId,
    providerLabel: providerConfig.providerLabel,
    baseUrl: providerConfig.baseUrl,
    hasApiKey: providerConfig.hasApiKey,
    apiKeyLast4: providerConfig.apiKeyLast4,
    modelId: model.id,
    modelName: model.name,
    model: model.model,
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

function extractAiBodyContent(editor, { includeFinalizedBoundary = true } = {}) {
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
      const caption = (node.attrs?.caption || node.attrs?.alt || "图片").trim();
      assets.images[imageIndex] = {
        number: imageIndex,
        caption,
        src: node.attrs?.src || "",
        alt: node.attrs?.alt || caption,
        width: node.attrs?.width || "78%",
      };
      pushLine(`[图${imageIndex}.${caption}]`);
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

function buildAiPromptInput(editor) {
  const { body, assets, hasFinalizedBoundary } = extractAiBodyContent(editor, { includeFinalizedBoundary: true });
  const promptParts = hasFinalizedBoundary
    ? [AI_PROMPT_PREFIX, AI_FINALIZED_INSTRUCTION, body]
    : [AI_PROMPT_PREFIX, body];
  return {
    body,
    prompt: promptParts.filter(Boolean).join("\n\n"),
    assets,
  };
}

function buildAiChatContextSignature(editor, document) {
  const json = editor?.getJSON?.();
  const title = (document?.title || "未命名信笺").trim();
  const author = (document?.author || "").trim();
  const displayDate = (document?.displayDate || "").trim();
  return JSON.stringify({
    title,
    author,
    displayDate,
    content: json?.content || [],
  });
}

function buildAiChatContextInput(editor, document, signature = "") {
  const { body } = extractAiBodyContent(editor, { includeFinalizedBoundary: false });
  const title = (document?.title || "未命名信笺").trim();
  const author = (document?.author || "").trim();
  const displayDate = (document?.displayDate || "").trim();
  const metaLines = [
    `标题：${title}`,
    author ? `署名：${author}` : "",
    displayDate ? `日期：${displayDate}` : "",
  ].filter(Boolean);
  const context = `${metaLines.join("\n")}\n\n正文：\n${body || "（正文为空）"}`.trim();
  return { context, signature: signature || buildAiChatContextSignature(editor, document) };
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
    status: ["idle", "streaming", "error"].includes(state.status) ? state.status : "idle",
    error: typeof state.error === "string" ? state.error : "",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

function createEmptyAiState() {
  return {
    version: 1,
    lastMode: "",
    optimize: createEmptyAiOptimizeState(),
    chat: createEmptyAiChatState(),
  };
}

function normalizeAiState(state = {}) {
  return {
    version: 1,
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

function createBlankDocument() {
  const letterTemplate = DEFAULT_LETTER_TEMPLATES[0];
  const now = new Date().toISOString();
  return {
    version: 1,
    title: "未命名信笺",
    author: "",
    html: "<p></p>",
    letterTemplateId: letterTemplate.id,
    templateId: letterTemplate.paperId,
    layoutMode: LAYOUT_MODES.FLOW,
    customBackground: "",
    aiState: createEmptyAiState(),
    createdAt: now,
    displayDate: formatPaperDate(now),
    updatedAt: now,
  };
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
      <strong>
        <img src={ICON_ASSETS.goldPen} alt="" aria-hidden="true" />
        <span>信笺写作</span>
      </strong>
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
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.toggleHeading({ level, numbered: true }));
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
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.updateAttributes("heading", { numbered: heading.node.attrs.numbered === false }));
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
    StarterKit.configure({ underline: false }),
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
    PaperPageBreak,
    PaperHorizontalRule,
    PaperFinalizedBreak,
    PaperTableOfContents,
    AiChatSelectionDecorations,
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

  const headings = useMemo(() => collectHeadingItems(editor?.state.doc).filter((item) => item.level <= 3), [editor, version]);

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

function collectHeadingItems(doc) {
  if (!doc) {
    return [];
  }
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
    const numbered = node.attrs.numbered !== false;
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
      number,
    });
  });
  return items;
}

function buildHeadingNumberDecorationSet(doc) {
  const decorations = collectHeadingItems(doc).flatMap((item) => {
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

const HeadingMetadata = Extension.create({
  name: "headingMetadata",

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          numbered: {
            default: true,
            parseHTML: (element) => element.getAttribute("data-heading-numbered") !== "false",
            renderHTML: (attributes) => (attributes.numbered === false ? { "data-heading-numbered": "false" } : {}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("paperwriterHeadingNumbers"),
        state: {
          init: (_, state) => buildHeadingNumberDecorationSet(state.doc),
          apply(transaction, previousDecorationSet) {
            if (transaction.docChanged) {
              return buildHeadingNumberDecorationSet(transaction.doc);
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

function syncAiChatSelectionDecorations(editor, selections = []) {
  if (!editor?.view) {
    return;
  }
  editor.view.dispatch(editor.state.tr.setMeta(AI_CHAT_SELECTION_PLUGIN_KEY, selections));
}

function MenuButton({ icon: Icon, label, menuId, openMenu, onOpenMenu, children, disabled = false, triggerClassName = "", showDisclosure = true }) {
  const isOpen = openMenu === menuId;

  return (
    <div className={isOpen ? "nav-menu open" : "nav-menu"}>
      <button
        type="button"
        className={["nav-menu-trigger", triggerClassName].filter(Boolean).join(" ")}
        disabled={disabled}
        title={label}
        aria-label={label}
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
  onExportPdf,
  onInsertImage,
  onExportImages,
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
}) {
  const canEdit = Boolean(editor) && !editorLocked;
  const primaryDisabled = Boolean(aiMode);
  const [openMenu, setOpenMenu] = useState("");
  const exitAiLabel = aiModeKind === "chat" ? "退出 AI问答" : "退出 AI优化";

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
        <MenuButton icon={FileText} label="文件" menuId="file" openMenu={openMenu} onOpenMenu={setOpenMenu} disabled={primaryDisabled}>
          <MenuItem icon={FilePlus} label="新建文件" onClick={() => runMenuAction(onNew)} />
          <MenuItem icon={FileText} label="打开文件" onClick={() => runMenuAction(onOpen)} />
        </MenuButton>
        <MenuButton icon={Save} label="保存" menuId="save" openMenu={openMenu} onOpenMenu={setOpenMenu} disabled={primaryDisabled}>
          <MenuItem icon={Save} label="保存" onClick={() => runMenuAction(() => onSave(false))} />
          <MenuItem icon={SaveAll} label="另存为" onClick={() => runMenuAction(() => onSave(true))} />
        </MenuButton>
        <MenuButton icon={Download} label="导出" menuId="export" openMenu={openMenu} onOpenMenu={setOpenMenu} disabled={primaryDisabled}>
          <MenuItem icon={Download} label="导出 PDF" onClick={() => runMenuAction(onExportPdf)} />
          <MenuItem icon={FileImage} label="导出图片" onClick={() => runMenuAction(onExportImages)} />
        </MenuButton>
        <button
          type="button"
          className="nav-menu-trigger"
          disabled={primaryDisabled}
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
        <IconButton icon={Minus} label="插入分割线" disabled={!canEdit} onClick={() => insertHorizontalRule(editor, savedSelectionRef)} />
        <IconButton icon={SeparatorHorizontal} label="插入分页符" disabled={!canEdit} onClick={() => insertPageBreak(editor, savedSelectionRef)} />
        <IconButton
          icon={ListTree}
          label={tableOfContentsInserted ? "关闭目录" : "生成目录"}
          active={tableOfContentsInserted}
          disabled={!canEdit}
          onClick={() => insertTableOfContents(editor, savedSelectionRef)}
        />
        <IconButton icon={Table2} label="插入表格" disabled={!canEdit} onClick={() => insertBasicTable(editor, savedSelectionRef)} />
        <IconButton icon={Heading1} label="一级标题" active={editor?.isActive("heading", { level: 1 })} disabled={!canEdit} onClick={() => setHeadingLevel(editor, savedSelectionRef, 1)} />
        <IconButton icon={Heading2} label="二级标题" active={editor?.isActive("heading", { level: 2 })} disabled={!canEdit} onClick={() => setHeadingLevel(editor, savedSelectionRef, 2)} />
        <IconButton icon={Heading3} label="三级标题" active={editor?.isActive("heading", { level: 3 })} disabled={!canEdit} onClick={() => setHeadingLevel(editor, savedSelectionRef, 3)} />
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
  const parts = String(text).split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\]|__[^_]+__)/g).filter(Boolean);
  return parts.map((part, index) => {
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
  const activeTopic = HELP_TOPICS.find((topic) => topic.id === activeTopicId) || HELP_TOPICS[0];
  const activeCategoryId = activeTopic?.categoryId || HELP_CATEGORIES[0]?.id;

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    if (!activeTopic) {
      setActiveTopicId(HELP_TOPICS[0]?.id || "");
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [activeTopic, onClose, open]);

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
            <HelpIllustration type={activeTopic.illustration} />
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
  );
}

function HelpIllustration({ type }) {
  const src = HELP_SCREENSHOTS[type] || HELP_SCREENSHOTS.workspace;
  return (
    <figure className={`help-illustration ${type || "workspace"}`}>
      <img src={src} alt="" aria-hidden="true" />
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
        <img className="asset-icon pen-asset-icon" src={ICON_ASSETS.goldPen} alt="" aria-hidden="true" />
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
  onCollapse,
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

  return (
    <aside className="sidebar left-sidebar">
      <section className="sidebar-panel documents-panel">
        <div className="sidebar-heading">
          <div className="sidebar-mode-switch" role="tablist" aria-label="左侧栏模式">
            <button
              type="button"
              className={mode === "folder" ? "active" : ""}
              onClick={() => onModeChange("folder")}
            >
              文件树
            </button>
            <button
              type="button"
              className={mode === "outline" ? "active" : ""}
              onClick={() => onModeChange("outline")}
            >
              大纲
            </button>
          </div>
          <div className="sidebar-actions">
            <button type="button" className="sidebar-plus" onClick={onCollapse} aria-label="收起左侧栏" title="收起左侧栏">
              <PanelLeftClose size={18} />
            </button>
          </div>
        </div>

        {mode === "folder" ? (
          <>
            {folderState.path ? (
              <div
                className={dragState?.targetPath === folderState.path ? "document-list drag-target" : "document-list"}
                data-drop-folder-path={folderState.path}
              >
                <div className="folder-pathbar">
                  <button
                    type="button"
                    className="folder-path-open"
                    onClick={onOpenFolder}
                    aria-label="打开文件夹"
                    title="打开文件夹"
                  >
                    <FolderOpen size={18} />
                  </button>
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
                    <span>{folderState.path}</span>
                  </div>
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
                : ICON_ASSETS.goldPen}
              alt=""
            />
            <span>{dragState.entry.displayName || dragState.entry.name}</span>
          </div>
        ) : null}
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
          <h2 className="sidebar-title">信笺模板</h2>
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
  return `${Math.max(0.76, Math.min(12, width + 0.2))}em`;
}

function PageArticle({ document, selectedTemplate, paperStyle, children, className = "", showHeader = false, onTitleChange, onAuthorChange, onDateChange }) {
  const authorText = document.author?.trim() || "";
  const authorWidth = estimateAuthorWidth(authorText);
  const displayDate = document.displayDate || formatPaperDate(document.createdAt);

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
            <span className="paper-meta-prefix">写于</span>
            <input
              className="paper-date-input"
              value={displayDate}
              onChange={(event) => onDateChange?.(event.target.value)}
              aria-label="写作日期"
              spellCheck={false}
            />
          </p>
        </header>
      ) : null}
      {children}
    </article>
  );
}

function SelectionBubbleToolbar({ editor, disabled, savedSelectionRef, aiCaptureEnabled = false, onCaptureAiSelection }) {
  const [toolbarPosition, setToolbarPosition] = useState(null);
  const activeColor = editor?.getAttributes("textStyle")?.color || "";
  const activePaletteColor = normalizeColorValue(activeColor);
  const activeBackgroundColor = editor?.getAttributes("highlight")?.color || "";
  const activePaletteBackgroundColor = normalizeBackgroundColorValue(activeBackgroundColor);
  const activeUnderlineStyle = normalizeUnderlineStyle(editor?.getAttributes("underline")?.style);
  const selectedHeading = editor ? getSelectedHeadingNode(editor, savedSelectionRef) : null;

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
      {selectedHeading ? (
        <>
          <span className="bubble-divider" />
          <IconButton
            icon={ListOrdered}
            label={selectedHeading.node.attrs.numbered === false ? "恢复标题计数" : "取消标题计数"}
            active={selectedHeading.node.attrs.numbered === false}
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
  return {
    selectedTemplate,
    typography,
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

function AiSettingsDialog({ open, config, onClose, onSave, onTest, onClear }) {
  const [selectedProvider, setSelectedProvider] = useState("gemini");
  const [selectedModelId, setSelectedModelId] = useState("gemini-default");
  const [drafts, setDrafts] = useState(() => normalizePublicAiConfig(config).providers);
  const [apiKeys, setApiKeys] = useState({});
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [providerEditor, setProviderEditor] = useState(null);
  const [modelEditor, setModelEditor] = useState(null);
  const initializedOpenRef = useRef(false);
  const normalizedConfig = useMemo(() => normalizePublicAiConfig(config), [config]);
  const selectedDraft = drafts[selectedProvider] || normalizePublicAiProviderConfig(selectedProvider);
  const selectedModel = selectedDraft.models.find((model) => model.id === selectedModelId) || selectedDraft.models[0];
  const selectedIsDefault = normalizedConfig.activeProvider === selectedProvider && selectedDraft.activeModelId === selectedModel?.id;
  const selectedProviderOption = getAiProviderDefaults(selectedProvider);
  const selectedProviderIcon = ICON_ASSETS[selectedProvider];
  const selectedConnection = getAiProviderConnectionMeta(selectedDraft);
  const selectedLastUpdated = formatAiProviderUpdatedAt(selectedDraft);

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
    setModelEditor(null);
  }, [config, open]);

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

  const openProviderEditor = useCallback(() => {
    setProviderEditor({
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
      baseUrl,
      apiKey: providerEditor.apiKey,
      models,
      resetTest: baseUrlChanged,
    });
    if (result) {
      setProviderEditor(null);
    }
  }, [onSave, providerEditor, runAction, selectedDraft.baseUrl, selectedDraft.models, selectedProviderOption.baseUrl]);

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
    if (providerDraft.models.length <= 1) {
      setStatus({ tone: "warning", message: "至少保留一个模型" });
      return;
    }
    const nextModels = providerDraft.models.filter((model) => model.id !== modelId);
    const nextActiveModelId = providerDraft.activeModelId === modelId
      ? (nextModels[0]?.id || providerDraft.activeModelId)
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
    setSelectedModelId(nextSelectedModel.id);
    await runAction(onSave, {
      modelId: nextSelectedModel.id,
      modelName: nextSelectedModel.name,
      model: nextSelectedModel.model,
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
            <button type="button" disabled title="暂不支持添加供应商">
              <Plus size={15} />
              <span>添加供应商</span>
            </button>
          </div>
          <div className="ai-provider-list" aria-label="AI 服务商">
            {AI_PROVIDER_OPTIONS.map((option) => {
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
                    <img src={providerIconSrc} alt="" aria-hidden="true" />
                    {normalizedConfig.activeProvider === option.id ? <span className="ai-provider-default-pill">默</span> : null}
                  </span>
                  <span className="ai-provider-main">
                    <strong>{option.label}</strong>
                    <em>{providerConfig.baseUrl}</em>
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
                <img src={selectedProviderIcon} alt="" aria-hidden="true" />
              </span>
              <div>
                <h2 id="ai-settings-title">{selectedDraft.providerLabel}</h2>
                <p>{selectedDraft.baseUrl}</p>
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
                title={!selectedModel?.testedOk ? "请先测试当前模型" : (selectedIsDefault ? "已是默认供应商" : "设为默认供应商")}
                onClick={() => runAction(onSave, { resetTest: false, activate: true })}
              >
                <span />
              </button>
            </div>
          </header>
          <section className="ai-settings-section">
            <div className="ai-settings-section-head">
              <h3>供应商信息</h3>
              <button type="button" onClick={openProviderEditor}>
                <Pencil size={15} />
                <span>编辑</span>
              </button>
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
              {selectedDraft.models.map((model) => {
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
                        disabled={selectedDraft.models.length <= 1}
                        title={selectedDraft.models.length <= 1 ? "至少保留一个模型" : "删除模型"}
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
        </main>
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
                <input value={selectedDraft.providerLabel} disabled />
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
  const groupedProviders = AI_PROVIDER_OPTIONS.map((option) => ({
    ...option,
    models: providers.filter((provider) => provider.provider === option.id),
  })).filter((option) => option.models.length);
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
                      onClick={() => setActiveProviderId(provider.id)}
                    >
                      <span className="ai-provider-switch-provider-main">
                        <span className="ai-provider-switch-icon">
                          <img src={ICON_ASSETS[provider.id]} alt="" aria-hidden="true" />
                        </span>
                        <span>
                          <strong>{provider.label}</strong>
                          <em>{provider.models.length} 个可用模型</em>
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
                        <img src={ICON_ASSETS[selectedProviderGroup.id]} alt="" aria-hidden="true" />
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
  onProviderChange,
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
                <Sparkles size={17} className="sparkle large" />
                <img src={ICON_ASSETS.goldPen} alt="" />
                <Sparkles size={12} className="sparkle small" />
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
              <Sparkles size={14} />
              <img src={ICON_ASSETS.goldPen} alt="" />
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
  onActivate,
}) {
  const { selectedTemplate, paperStyle } = useMemo(() => getPaperPresentation(document, letterTemplates), [document, letterTemplates]);
  return (
    <main className={[printMode ? "canvas print-mode" : "canvas", className].filter(Boolean).join(" ")} onPointerDown={onActivate}>
      <SelectionBubbleToolbar
        editor={editor}
        disabled={printMode || imageExportMode || readOnly}
        savedSelectionRef={savedSelectionRef}
        aiCaptureEnabled={aiCaptureEnabled}
        onCaptureAiSelection={onCaptureAiSelection}
      />
      <TableContextToolbar editor={editor} disabled={printMode || imageExportMode || readOnly} />
      <div className="paper-viewport">
        <PageArticle
          document={document}
          selectedTemplate={selectedTemplate}
          paperStyle={paperStyle}
          showHeader
          onTitleChange={onTitleChange}
          onAuthorChange={onAuthorChange}
          onDateChange={onDateChange}
        >
          <EditorContent editor={editor} />
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
                if (!onToggleRightSplit || disabled) {
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
            <img src={ICON_ASSETS.cacheBroom} alt="" />
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
    dirty,
  };
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
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [printMode, setPrintMode] = useState(false);
  const [imageExportMode, setImageExportMode] = useState(false);
  const [tabCapacityFull, setTabCapacityFull] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [promptDialog, setPromptDialog] = useState(null);
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
  const applyingRef = useRef(false);
  const readyRef = useRef(false);
  const editorSelectionRef = useRef(null);
  const updateFlowRef = useRef({ active: false, handled: "" });
  const updateResultResetTimerRef = useRef(0);
  const restoreRunRef = useRef(0);
  const openTabsRef = useRef(openTabs);
  const activeTabIdRef = useRef(activeTabId);
  const activeDocumentKeyRef = useRef(documentRuntimeKey(currentPath, activeTabId));
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
  const aiChatContextRef = useRef({ signature: "", context: "" });
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
    onUpdate: ({ editor: activeEditor }) => {
      if (rightSplitApplyingRef.current) {
        return;
      }
      const splitId = rightSplitTabIdRef.current;
      if (!splitId) {
        return;
      }
      const html = activeEditor.getHTML();
      const updatedAt = new Date().toISOString();
      setOpenTabs((tabs) => tabs.map((tab) => (
        tab.id === splitId
          ? {
              ...tab,
              document: {
                ...tab.document,
                html,
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
    if (rightSplitTabId) {
      setRightSidebarCollapsed(true);
    }
  }, [rightSplitTabId]);

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
    return openTabsRef.current.map((tab) => (
      tab.id === activeId
        ? {
            ...tab,
            path: activePath,
            title: activeDocument?.title || "未命名信笺",
            document: activeDocument,
            dirty: activeDirty,
            editorJson: editor?.getJSON?.() || tab.editorJson,
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
        const setContentMs = (window.performance?.now?.() || Date.now()) - setContentStartedAt;
        bridge.debugLog?.("renderer:document:applied", {
          path: nextPath,
          contentSource,
          htmlChars: (normalized.html || "").length,
          setContentMs: Math.round(setContentMs),
          totalMs: Math.round((window.performance?.now?.() || Date.now()) - startedAt),
        });
        window.setTimeout(() => {
          if (applyDocumentRunRef.current === runId) {
            applyingRef.current = false;
          }
        }, 0);
      });
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
      if (existingTab) {
        if (existingTab.id !== activeTabId) {
          setOpenTabs((tabs) => tabs.map((tab) => (
            tab.id === activeTabId
              ? { ...tab, document: currentDocument, editorJson: currentEditorJson, title: currentDocument.title, path: currentPath, dirty }
              : tab
          )));
          setActiveTabId(existingTab.id);
          setActivePane("main");
          applyDocument(existingTab.document, existingTab.path, existingTab.dirty, { editorJson: existingTab.editorJson });
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
              ? { ...existing, document: currentDocument, editorJson: currentEditorJson, title: currentDocument.title, path: currentPath, dirty }
              : existing
          )),
          tab,
        ];
      });
      setActiveTabId(tab.id);
      setActivePane("main");
      applyDocument(normalized, nextPath, nextDirty);
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
      setOpenTabs((tabs) => tabs.map((tab) => (
        tab.id === activeTabId
          ? { ...tab, document: currentDocument, editorJson: currentEditorJson, title: currentDocument.title, path: currentPath, dirty }
          : tab
      )));
      setActiveTabId(target.id);
      setActivePane("main");
      applyDocument(target.document, target.path, target.dirty, { editorJson: target.editorJson });
    },
    [activeTabId, applyDocument, currentPath, dirty, editor, getSaveDocument, openTabs],
  );

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
        applyDocument(nextTab.document, nextTab.path, nextTab.dirty, { editorJson: nextTab.editorJson });
      }
    },
    [activeTabId, applyDocument, dirty, openTabs, showConfirmDialog],
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
        showStatus("这个文件不是信笺写作文档", "warning");
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
    const result = await bridge.createDocumentInFolder?.(folderPath, title);
    if (!result?.ok) {
      showStatus(result?.message || "新建信笺失败", "warning");
      return;
    }
    await refreshTreeAfterEntryChange(folderPath);
    addOrActivateDocumentTab(result.document || createBlankDocument(), result.path, false);
    showStatus("信笺已新建", "success");
  }, [addOrActivateDocumentTab, folderState.path, refreshTreeAfterEntryChange, showPromptDialog, showStatus]);

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
          applyDocument(nextTab.document, nextTab.path, nextTab.dirty, { editorJson: nextTab.editorJson });
          persistSession({ activePath: nextTab.path || "" });
        } else {
          const blank = createBlankDocument();
          const tab = createDocumentTab(blank);
          setOpenTabs([tab]);
          setActiveTabId(tab.id);
          applyDocument(blank, "", false);
          persistSession({ activePath: "" });
        }
      } else {
        setOpenTabs(remainingTabs);
        if (openTabs.some((tab) => tab.path === entry.path && tab.id === activeTabId)) {
          const nextTab = remainingTabs[0];
          if (nextTab) {
            setActiveTabId(nextTab.id);
            applyDocument(nextTab.document, nextTab.path, nextTab.dirty, { editorJson: nextTab.editorJson });
          }
        }
      }
    }

    await refreshTreeAfterEntryChange(result.folderPath || folderState.path);
    showStatus("已删除", "success");
  }, [activeTabId, applyDocument, currentPath, folderState.path, openTabs, persistSession, refreshTreeAfterEntryChange, showConfirmDialog, showStatus]);

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
    const previousCanvasScroll = window.document.querySelector(".canvas")?.scrollTop || 0;
    window.document.body.classList.add("image-export-body");
    setRightSidebarCollapsed(true);
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
        return;
      }
      const result = await bridge.exportPageImages(nextDocument.title, pageRects);
      if (!result?.canceled) {
        showStatus(`已导出 ${result.count || pageRects.length} 张图片`, "success");
      }
    } finally {
      const canvas = window.document.querySelector(".canvas");
      if (canvas) {
        window.requestAnimationFrame(() => {
          canvas.scrollTop = previousCanvasScroll;
        });
      }
      cleanupImageExportStage();
      setImageExportMode(false);
      setRightSidebarCollapsed(previousRightSidebarCollapsed);
      window.document.body.classList.remove("image-export-body");
    }
  }, [getSaveDocument, rightSidebarCollapsed, showStatus]);

  const handleInsertImage = useCallback(async () => {
    const result = await bridge.pickImage();
    if (result?.canceled || !result?.dataUrl) {
      return;
    }
    activeWorkEditor?.chain().focus().setImage({ src: result.dataUrl, alt: result.name || "图片", caption: "", width: "78%" }).run();
  }, [activeWorkEditor]);

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

  const handleSaveAiConfig = useCallback(async (draft) => {
    const result = await bridge.saveAiConfig?.(draft);
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    showStatus("AI 设置已保存", "success");
    return { ...normalized, ok: true, message: "AI 设置已保存" };
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
      setRightSidebarCollapsed(aiPreviousSidebarsRef.current.right);
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
      right: rightSidebarCollapsed,
    };
    setLeftSidebarCollapsed(true);
    setRightSidebarCollapsed(true);
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
  }, [aiMode, effectiveAiProvider, leftSidebarCollapsed, rightSidebarCollapsed, updateActiveDocumentAiState]);

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
      aiChatContextRef.current = { signature: "", context: "" };
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
    const aiInput = buildAiPromptInput(editor);
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
  }, [aiHasUsableProvider, aiStatus, effectiveAiConfig.model, effectiveAiConfig.modelId, effectiveAiConfig.modelName, effectiveAiConfig.provider, editor, showStatus, updateOptimizeStateForKey]);

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

    const nextSignature = buildAiChatContextSignature(editor, documentStateRef.current);
    if (nextSignature !== aiChatContextRef.current.signature) {
      aiChatContextRef.current = buildAiChatContextInput(editor, documentStateRef.current, nextSignature);
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
    const messages = [
      {
        role: "system",
        content: `${AI_CHAT_SYSTEM_PREFIX}\n\n当前信笺内容：\n${aiChatContextRef.current.context}${selectedTextContext}`,
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
  }, [aiChatInput, aiChatSelections, aiHasUsableProvider, aiStatus, effectiveAiConfig.modelId, effectiveAiConfig.provider, editor, showStatus, updateChatStateForKey]);

  const handleClearAiChat = useCallback(() => {
    if (aiStatus === "streaming") {
      return;
    }
    updateChatState(createEmptyAiChatState());
  }, [aiStatus, updateChatState]);

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
        editor={aiMode ? editor : activeWorkEditor}
        document={aiMode ? documentState : activeWorkDocument}
        savedSelectionRef={aiMode ? editorSelectionRef : activeWorkSelectionRef}
        onNew={handleNew}
        onOpen={handleOpen}
        onSave={handleSave}
        onExportPdf={handleExportPdf}
        onExportImages={handleExportImages}
        onInsertImage={handleInsertImage}
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
      />
      <div className={appShellClassName}>
        {leftSidebarCollapsed && !aiMode ? (
          <button type="button" className="sidebar-float-toggle left" onClick={() => setLeftSidebarCollapsed(false)} aria-label="展开左侧栏" title="展开左侧栏">
            <FolderOpen size={21} />
          </button>
        ) : null}
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
            onCollapse={() => setLeftSidebarCollapsed(true)}
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
                    onProviderChange={setAiSelectedProvider}
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
        {rightSidebarCollapsed && !aiMode && !rightSplitDocument ? (
          <button type="button" className="sidebar-float-toggle right" onClick={() => setRightSidebarCollapsed(false)} aria-label="展开信笺模板" title="展开信笺模板">
            <FileText size={21} />
          </button>
        ) : null}
        {!rightSidebarCollapsed && !rightSplitDocument ? (
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
        ) : null}
      </div>
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
      <StatusToast status={status} />
      <AppConfirmDialog dialog={confirmDialog} onResolve={resolveConfirmDialog} />
      <AppPromptDialog dialog={promptDialog} onResolve={resolvePromptDialog} />
      <AiSettingsDialog
        open={aiSettingsOpen}
        config={aiConfig}
        onClose={() => setAiSettingsOpen(false)}
        onSave={handleSaveAiConfig}
        onTest={handleTestAiConfig}
        onClear={handleClearAiConfig}
      />
      <HelpCenterDialog
        open={helpOpen}
        onClose={closeHelpCenter}
      />
    </div>
  );
}
