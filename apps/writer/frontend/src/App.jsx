import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState } from "@tiptap/react";
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
import tocTitleSignatureAsset from "./assets/decor/toc-title-signature.png?inline";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bot,
  BookOpen,
  Bold,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  FileImage,
  FileSearch,
  FilePlus,
  FileText,
  FolderSearch,
  FolderOpen,
  FolderPlus,
  FileInput,
  Focus,
  Globe2,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  HelpCircle,
  Highlighter,
  KeyRound,
  ImagePlus,
  Info,
  Italic,
  List,
  ListOrdered,
  ListTree,
  Link2,
  MessageSquare,
  Maximize2,
  Minus,
  Minimize2,
  Music2,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Palette,
  Pencil,
  Plus,
  Quote,
  Redo2,
  RefreshCw,
  Search,
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
import AiModeChooser from "./AiModeChooser.jsx";
import SettingsCenter from "./SettingsCenter.jsx";
import { shouldConfirmAiModeChange, shouldConfirmAiModeExit } from "./ai-mode-chooser-model.js";
import { applyLetterTemplateToDocument } from "./letter-template-application.js";
import { DocumentFindWidget, WorkspaceSearchPalette } from "./WorkspaceSearchPanel.jsx";
import "./workspace-features.css";
import ReleaseNotesDialog from "./ReleaseNotesDialog.jsx";
import { CURRENT_RELEASE_VERSION } from "./release-notes.js";
import { groupTestedAiProviders } from "./ai-provider-selector.js";
import {
  AI_REQUEST_PARAM_BOOLEAN_OPTIONS,
  AI_REQUEST_PARAM_TYPE_OPTIONS,
  aiRequestParamPreset,
  aiRequestParamsEqual,
  aiRequestParamsWithProviderDefaults,
  aiApplyResolverEditableRequestParams,
  aiTaskRequestParamsForEditor,
  aiModelCapabilities,
  createAiRequestParamRow,
  normalizeUiAiRequestParams,
  parseAiRequestParamRows,
  requestParamsToRows,
} from "./ai-request-params.js";
import { normalizeCodexImageMode, normalizeCodexScope } from "./codex-scope.js";
import { computePaperDerivedState, EMPTY_PAPER_DERIVED_STATE } from "./editor-derived-state.js";
import { applyDocumentTextReplacements, moveActiveDocumentSearchMatch, searchDocumentText } from "./document-search.js";
import { DocumentSearchExtension, renderDocumentSearchState } from "./document-search-extension.js";
import {
  buildAiApplyBlockManifest,
  createManualAiDirectApplyOperation,
  findCommentsOverlappingAiApplyOperation,
  resolveAiDirectApplyWithRepair,
} from "./ai-direct-apply.js";
import {
  createDerivedDocumentIdentity,
  createDocumentId,
  getDocumentSchemaCompatibility,
  mergePersistedDocumentIdentity,
  normalizeCitationSources,
  normalizeDocumentId,
  normalizeDocumentSchemaV2,
} from "./document-schema-v2.js";
import {
  collectKnowledgeReferences,
  createKnowledgeExtensions,
  createKnowledgeUpdateGuard,
  KNOWLEDGE_TAIL_NODE_TYPES,
  nextInternalLinkUsage,
  removeKnowledgeNodesByAttribute,
  stripDerivedKnowledgeDataFromHtml,
  synchronizeKnowledgeReferences,
} from "./knowledge-extensions.js";
import {
  createStructuredInlineExtensions,
  imageReferenceNumberAt,
  normalizeExternalLinkUrl,
  synchronizeStructuredInlineReferences,
} from "./structured-inline-extensions.js";
import { createDocumentCommentId, mapDocumentCommentsThroughTransaction, normalizeDocumentComments } from "./editor-comments.js";
import ResearchSidebar from "./ResearchSidebar.jsx";
import SecondaryResearchPane from "./SecondaryResearchPane.jsx";
import StructureInspector from "./StructureInspector.jsx";
import GroupTabStrip from "./GroupTabStrip.jsx";
import CitationPickerDialog from "./CitationPickerDialog.jsx";
import { CitationSourceDialog, FootnoteDialog, KnowledgeReferencePopover } from "./KnowledgeDialogs.jsx";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  closeWorkspaceView,
  createDocumentWorkspaceView,
  createWorkspaceGroupsSnapshot,
  createWorkspaceGroupsState,
  findWorkspaceView,
  getActiveWorkspaceView,
  moveWorkspaceDocument,
  normalizeWorkspaceGroupsState,
  normalizeWorkspaceSplitRatio,
  openWorkspaceDocument,
  openWorkspaceResearch,
  removeWorkspaceViews,
  reorderWorkspaceView,
  restoreWorkspaceGroupsSnapshot,
  selectWorkspaceView,
  updateWorkspaceResearchTarget,
  updateWorkspaceResearchViewState,
} from "./workspace-groups.js";
import { HierarchicalTreeRows, TreeItemButton } from "./HierarchicalTree.jsx";
import {
  canOpenResearchItem,
  normalizeResearchRelativePath,
  researchEntryType,
  researchPreviewKind,
} from "./research-ui-model.js";
import {
  deleteRecoveryBestEffort,
  readEditorSelectionState,
  replaceEditorContentWithoutHistory,
  restoreEditorSelectionWithoutHistory,
  sameDocumentPath,
  selectAutosaveSnapshotTabs,
  sessionTabSignature,
  snapshotRevisionIsCurrent,
  snapshotTabsWithRevisions,
} from "./editor-lifecycle.js";
import {
  boundedAiImageEntries,
  DOCUMENT_TITLE_MAX_CHARS,
  IMAGE_CAPTION_MAX_CHARS,
  normalizeBoundedAiChatMessages,
  normalizeBoundedAiQuotes,
  normalizeDocumentTitle,
  normalizeImageCaption,
  normalizeImageText,
  normalizeMediaFileName,
  normalizeMediaMime,
} from "./content-limits.js";
import {
  normalizeCustomBackgroundSource,
  normalizeEmbedWidth,
  normalizeImageSource,
  normalizeMediaSource,
  SAFE_EMBED_WIDTHS,
  toSafeCssImageUrl,
} from "./resource-safety.js";

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
  { label: "小", value: SAFE_EMBED_WIDTHS[0] },
  { label: "中", value: SAFE_EMBED_WIDTHS[1] },
  { label: "大", value: SAFE_EMBED_WIDTHS[2] },
  { label: "满", value: SAFE_EMBED_WIDTHS[3] },
];
const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const USER_TEMPLATE_STORAGE_KEY = "paperwriter.userLetterTemplates";
const USER_TEMPLATE_GROUP_STORAGE_KEY = "paperwriter.userLetterTemplateGroups";
const BASE_USER_TEMPLATE_GROUP_ID = "user-group-default";
const NEW_DOCUMENT_TEMPLATE_STORAGE_KEY = "paperwriter.newDocumentTemplateId";
const NEW_DOCUMENT_TEMPLATE_HISTORY_STORAGE_KEY = "paperwriter.newDocumentTemplateHistory";
const SESSION_STORAGE_KEY = "paperwriter.sessionState";
const EXPORT_LAST_DIRECTORY_STORAGE_KEY = "paperwriter.exportLastDirectory";
const IMAGE_EXPORT_STAGE_ID = "paperwriter-image-export-stage";
const IMAGE_EXPORT_SEGMENT_PADDING = 24;
const FOLDER_LIST_TIMEOUT_MS = 8000;
const UPDATE_RESULT_RESET_MS = 2800;
const UPDATE_AUTO_CHECK_STORAGE_KEY = "paperwriter.updateLastAutoCheckAt";
const UPDATE_AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AI_PROMPT_PREFIX = "这是我正在写的文章，请你帮我优化内容与表达：";
const AI_FIXED_LETTER_TEMPLATE_ID = "fiber-letter";
const AI_CHAT_SYSTEM_PREFIX = "你是笺间的 AI 问答助手。你可以阅读用户当前正在写的信笺内容，并围绕内容、结构、表达、事实一致性和写作策略回答问题。回答要具体、克制、可执行。";
const CODEX_DOCUMENT_ONLY_SCOPE = Object.freeze({ mode: "document-only", relativePath: "" });
const AI_CHAT_SELECTION_PLUGIN_KEY = new PluginKey("paperwriterAiChatSelections");
const AI_APPLY_PREVIEW_PLUGIN_KEY = new PluginKey("paperwriterAiApplyPreview");
const DOCUMENT_COMMENT_PLUGIN_KEY = new PluginKey("paperwriterDocumentComments");
const HEADING_NUMBERING_PLUGIN_KEY = new PluginKey("paperwriterHeadingNumbers");
const PAPER_DERIVED_STATE_PLUGIN_KEY = new PluginKey("paperwriterDerivedState");
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
const AI_REASONING_EFFORT_OPTIONS = [
  { value: "", label: "服务商默认" },
  { value: "minimal", label: "最简（minimal）" },
  { value: "low", label: "低（low）" },
  { value: "medium", label: "中（medium）" },
  { value: "high", label: "高（high）" },
  { value: "xhigh", label: "超高（xhigh）" },
  { value: "max", label: "最高（max）" },
];
const AI_TASK_MODEL_DEFINITIONS = [
  {
    id: "applyResolver",
    label: "直接应用定位",
    description: "只判断优化块在正文中的替换或插入位置，不参与内容优化与改写。内置 Gemini、DeepSeek 固定使用 JSON 输出，并使用各自模型允许的最大输出上限。",
    selectLabel: "直接应用定位模型",
  },
];
const AI_MODEL_REQUIRED_MESSAGE = "必须配置好至少一个可用模型，才能进入 AI 模式。配置完成后，再次点击“AI模式”即可。";
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
  taskModels: { applyResolver: { providerId: "", modelId: "", requestParams: {} } },
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
  // Keep document-owned decoration self-contained. The asset packager converts
  // this data URL into an assets/... entry whenever a table of contents is saved.
  tocTitleSignature: tocTitleSignatureAsset,
};

const HELP_SCREENSHOTS = {
  "files-sidebar": new URL("./assets/help/screenshots/files-sidebar.webp", import.meta.url).href,
  "tabs-groups": new URL("./assets/help/screenshots/tabs-groups.webp", import.meta.url).href,
  "save-recovery": new URL("./assets/help/screenshots/save-recovery.webp", import.meta.url).href,
  interchange: new URL("./assets/help/screenshots/interchange.webp", import.meta.url).href,
  search: new URL("./assets/help/screenshots/search.webp", import.meta.url).href,
  "editor-outline": new URL("./assets/help/screenshots/editor-outline.webp", import.meta.url).href,
  "selection-links": new URL("./assets/help/screenshots/selection-links.webp", import.meta.url).href,
  comments: new URL("./assets/help/screenshots/comments.webp", import.meta.url).href,
  "comments-compose": new URL("./assets/help/screenshots/comments-compose.webp", import.meta.url).href,
  "comments-thread": new URL("./assets/help/screenshots/comments-thread.webp", import.meta.url).href,
  "media-pagination": new URL("./assets/help/screenshots/media-pagination.webp", import.meta.url).href,
  table: new URL("./assets/help/screenshots/table.webp", import.meta.url).href,
  "footnotes-citations": new URL("./assets/help/screenshots/footnotes-citations.webp", import.meta.url).href,
  "related-notes": new URL("./assets/help/screenshots/related-notes.webp", import.meta.url).href,
  "research-library": new URL("./assets/help/screenshots/research-library.webp", import.meta.url).href,
  "research-readers": new URL("./assets/help/screenshots/research-readers.webp", import.meta.url).href,
  "ai-modes": new URL("./assets/help/screenshots/ai-modes.webp", import.meta.url).href,
  "ai-model-chooser": new URL("./assets/help/screenshots/ai-model-chooser.webp", import.meta.url).href,
  "ai-providers": new URL("./assets/help/screenshots/ai-providers.webp", import.meta.url).href,
  "codex-cli": new URL("./assets/help/screenshots/codex-cli.webp", import.meta.url).href,
  "codex-cli-models": new URL("./assets/help/screenshots/codex-cli-models.webp", import.meta.url).href,
  "ai-optimize": new URL("./assets/help/screenshots/ai-optimize.webp", import.meta.url).href,
  "ai-optimize-apply": new URL("./assets/help/screenshots/ai-optimize-apply.webp", import.meta.url).href,
  "ai-chat": new URL("./assets/help/screenshots/ai-chat.webp", import.meta.url).href,
  "ai-isolation": new URL("./assets/help/screenshots/ai-isolation.webp", import.meta.url).href,
  "focus-mode": new URL("./assets/help/screenshots/focus-mode.webp", import.meta.url).href,
  "template-quick-menu": new URL("./assets/help/screenshots/template-quick-menu.webp", import.meta.url).href,
  "template-quick-picker": new URL("./assets/help/screenshots/template-quick-picker.webp", import.meta.url).href,
  "templates-gallery": new URL("./assets/help/screenshots/templates-gallery.webp", import.meta.url).href,
  "template-editor": new URL("./assets/help/screenshots/template-editor.webp", import.meta.url).href,
  "template-editor-advanced": new URL("./assets/help/screenshots/template-editor-advanced.webp", import.meta.url).href,
  "statusbar-update": new URL("./assets/help/screenshots/statusbar-update.webp", import.meta.url).href,
  "release-notes": new URL("./assets/help/screenshots/release-notes.webp", import.meta.url).href,
};

const HELP_CATEGORIES = [
  { id: "files", label: "文件与组织", icon: FolderOpen },
  { id: "writing", label: "写作与结构", icon: Pencil },
  { id: "research", label: "资料与研究", icon: BookOpen },
  { id: "ai", label: "AI 功能", icon: Sparkles },
  { id: "view", label: "视图与设置", icon: PanelRightClose },
];

const AI_CHAT_PROMPT_PRESETS = [
  { id: "review", label: "审阅全文", prompt: "请帮我审阅这篇信笺，指出主要优点、不足和可以优化的地方。" },
  { id: "rewrite-selection", label: "改写标记", prompt: "请改写我标记的这段文字，保持原意，但让表达更自然、更有力度。" },
  { id: "logic", label: "找逻辑漏洞", prompt: "请检查这篇信笺的逻辑链条，指出哪里论证薄弱、跳跃或证据不足。" },
  { id: "titles", label: "生成标题", prompt: "请根据这篇信笺生成 5 个标题，分别偏正式、文艺、犀利、简洁和社媒传播。" },
];
const HELP_TOPICS = [
  {
    id: "files-sidebar",
    categoryId: "files",
    title: "文件区、资料区和结构区",
    summary: "左侧栏以[[文件、资料、结构]]三个入口组织写作文件、研究资料和当前信笺关系。",
    illustration: "files-sidebar",
    illustrationAlt: "笺间当前界面左侧显示文件、资料和结构三个入口，右侧为信笺编辑组。",
    illustrationCaption: "三个入口各管一类内容，切换不会关闭正在编辑的信笺。",
    steps: ["在__文件__中选择写作文件夹，展开目录并打开 `.letterpaper` 信笺。", "在__资料__中选择独立资料文件夹，管理资料文件和网页来源。", "在__结构__中查看当前信笺的大纲、脚注与引用、关联笺记。"],
    tips: ["文件区支持新建、重命名、备份、移动和删除；这些操作均使用应用内确认。", "资料目录与写作文件夹相互独立，结构页始终跟随当前激活的信笺。"],
  },
  {
    id: "tabs-groups",
    categoryId: "files",
    title: "标签页与双编辑组",
    summary: "写作区包含左右两个[[独立编辑组]]，右组还能混排信笺和资料标签。",
    illustration: "tabs-groups",
    illustrationAlt: "左右两个编辑组分别显示多枚信笺和资料标签，中间有可拖动分隔线。",
    illustrationCaption: "每组独立切换标签，适合边阅读资料边整理正文。",
    steps: ["点击标签切换内容；拖动标签可在组内排序，也可移到另一组。", "通过标签右键菜单把信笺移到左组或右组；资料只在右组打开。", "拖动中间分隔线调整宽度；关闭右组最后一个标签后恢复单栏。"],
    tips: ["左组至少保留一个信笺，同一信笺不会同时出现在两个组中。", "标签顺序、活动项、分栏比例和资料阅读位置都会随会话恢复。"],
  },
  {
    id: "save-recovery",
    categoryId: "files",
    title: "保存、恢复、同步冲突与格式兼容",
    summary: "`.letterpaper` 保存完整信笺；恢复缓存和[[磁盘版本检查]]共同保护尚未写回的内容。",
    illustration: "save-recovery",
    illustrationAlt: "笺间状态栏显示恢复缓存已写入、缓存大小和当前版本，正文标签显示尚未保存状态。",
    illustrationCaption: "恢复缓存用于意外恢复，正式保存仍写入 `.letterpaper` 文件。",
    steps: ["使用 `Ctrl+S` 写回当前文件，或用另存为生成一份新信笺。", "意外退出后，重新打开应用并从恢复会话继续未保存内容。", "磁盘文件被其他程序改动时，选择保留磁盘版本；笺间会把本机编辑保存为冲突副本。"],
    tips: ["旧版信笺在需要新结构功能时升级到 v2，并在首次保存时保留迁移前备份。", "来自未来版本的信笺以只读方式打开，避免当前版本破坏未知内容。"],
  },
  {
    id: "interchange",
    categoryId: "files",
    title: "导入、导出与格式边界",
    summary: "顶部__导出__入口同时提供文档导入，以及版式输出和[[可编辑交换]]。",
    illustration: "interchange",
    illustrationAlt: "导出弹窗展示 PDF、分页图片、DOCX、Markdown、HTML 和 TXT 六种格式。",
    illustrationCaption: "PDF 保留视觉呈现，可编辑格式便于在其他软件中继续处理。",
    steps: ["选择导入文档，可打开 Markdown、HTML、TXT 或 DOCX；导入结果始终成为未保存的新信笺。", "选择导出信笺，可输出 PDF、分页 PNG、DOCX、Markdown、HTML 或 TXT。", "为导出文件选择位置；笺间会记住上次使用的导出目录。"],
    tips: ["通用导出不包含评注和 AI 记录；脚注与引用会输出，参考文献由顶部__参考__开关决定。", "Markdown 图片写入同名 `.assets` 目录；需要最高视觉保真时请使用 PDF。"],
  },
  {
    id: "search",
    categoryId: "files",
    title: "文档查找替换与文件夹搜索",
    summary: "搜索入口区分[[当前文档]]和[[当前文件夹及子文件夹]]两种范围。",
    illustration: "search",
    illustrationAlt: "正文右上角打开查找和替换面板，顶部搜索菜单同时显示文档搜索与文件夹搜索。",
    illustrationCaption: "在文内快速定位，或跨当前文件夹检索文件名、标题、作者和正文。",
    steps: ["按 `Ctrl+F` 查找当前信笺，使用上下按钮或 Enter 在匹配项间移动。", "展开替换或按 `Ctrl+H`，可替换当前匹配或一次替换全部。", "按 `Ctrl+P` 搜索当前文件夹及全部子文件夹，选择结果即可打开并定位。"],
    tips: ["已打开但尚未保存的信笺会使用内存中的最新正文参与文件夹搜索。", "只读信笺可以查找，但不能执行替换。"],
  },
  {
    id: "editor-outline",
    categoryId: "writing",
    title: "标题、大纲与正文目录",
    summary: "标题、署名、日期和正文均可直接编辑，一至三级标题同时驱动[[结构大纲]]和正文目录。",
    illustration: "editor-outline",
    illustrationAlt: "结构页显示分层大纲，正文顶部工具栏显示标题和目录按钮。",
    illustrationCaption: "标题层级既用于正文排版，也用于长文导航。",
    steps: ["在页面中直接编辑标题、署名、日期和正文。", "使用顶部__标题__菜单设置一至三级标题，并按需覆盖当前标题编号。", "打开__结构 → 大纲__跳转章节，或点击顶部__目录__生成和关闭正文目录。"],
    tips: ["模板可以分别设置各级标题的默认编号，当前标题仍可单独覆盖。", "调整标题文字或层级后，大纲和正文目录会同步刷新。"],
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
    illustrations: [
      { type: "comments-compose", alt: "选中文字后打开新建评注输入框，可输入意见并保存。", caption: "新建评注会明确绑定当前选中的文字范围。" },
      { type: "comments-thread", alt: "正文中的评注范围被高亮，右侧评注卡片显示查看、编辑和删除操作。", caption: "点击页面侧边的评注锚点，可回看并管理这条意见。" },
    ],
    steps: ["框选文字后点击悬浮条中的评注按钮。", "输入评注并保存，正文出现高亮，页面侧边出现对应锚点。", "点击锚点查看、编辑或删除评注。"],
    tips: ["评注会随 `.letterpaper` 保存，复制信笺时一并携带。", "正文增删后评注范围会跟随内容映射；过度密集的位置会限制继续添加。"],
  },
  {
    id: "media-pagination",
    categoryId: "writing",
    title: "图片、音视频、图片引用与分页",
    summary: "__媒体__菜单插入本地素材，图片还能生成仅限当前信笺使用的[[图号引用]]。",
    illustration: "media-pagination",
    illustrationAlt: "写作界面展开媒体菜单，列出图片、音频、视频和链接；正文保留图片引用标记。",
    illustrationCaption: "媒体菜单集中插入图片、音频、视频和链接；分页符位于相邻的元素菜单。",
    steps: ["从__媒体__插入图片、音频或视频；图片可调整宽度并编辑标题。", "点击图片工具条中的复制引用，再在同一信笺粘贴 `[图N.标题]` 引用。", "从__元素__插入引文、分割线或分页符；分页图片按分页符输出连续 PNG。"],
    tips: ["音频上限为 20 MB，视频上限为 100 MB，素材会随信笺打包保存。", "图片引用只在本文档有效；图片增删后图号会自动更新。"],
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
    id: "footnotes-citations",
    categoryId: "writing",
    title: "脚注、文献引用与自动参考文献",
    summary: "脚注和文献引用从__元素__菜单插入，在[[结构 → 注引]]中统一管理。",
    illustration: "footnotes-citations",
    illustrationAlt: "元素菜单显示脚注和文献引用，结构页注引标签列出脚注与参考文献来源。",
    illustrationCaption: "插入在正文完成，查看、编辑和删除集中在结构页。",
    steps: ["把光标放在目标位置，从__元素__选择脚注，输入内容后插入。", "选择文献引用，从已有来源中搜索，或新增来源并填写本次引用页码。", "点击顶部__参考__开关，在文尾生成或关闭自动参考文献。"],
    tips: ["脚注和引用编号会随正文顺序动态更新，并参与可编辑格式导出。", "结构页可跳到正文中的首次使用位置；删除脚注会同时移除对应标记。"],
  },
  {
    id: "related-notes",
    categoryId: "writing",
    title: "关联笺记、反向链接与失效重联",
    summary: "关联笺记使用稳定文档身份连接工作区信笺，并在[[结构 → 关联]]显示正向和反向关系。",
    illustration: "related-notes",
    illustrationAlt: "元素菜单打开关联笺记选择器，结构页关联标签显示关联目标、反向关联和重联操作。",
    illustrationCaption: "文件重命名或移动后仍可保持关联，失效路径可重新绑定。",
    steps: ["从__元素__选择关联笺记，或输入 `[[` 搜索工作区信笺。", "打开__结构 → 关联__查看本文指向的信笺和指向本文的反向关联。", "目标失效时使用重联选择正确文件，再逐个定位正文中的使用位置。"],
    tips: ["关联基于 `documentId`，不是只靠文件名或绝对路径。", "检测到重复文档身份时会提示处理，避免链接悄悄指向错误副本。"],
  },
  {
    id: "research-library",
    categoryId: "research",
    title: "独立资料目录、资料文件和网页来源",
    summary: "资料区使用独立于写作工作区的本地目录，并分别管理[[资料文件]]和[[网页来源]]。",
    illustration: "research-library",
    illustrationAlt: "资料区显示独立资料目录、资料文件树、网页分组及新增和导入操作。",
    illustrationCaption: "资料目录可单独选择，网页来源可按全局或当前工作区组织。",
    steps: ["打开__资料__并选择资料文件夹；可在其中新建目录或导入本地文件。", "在__网页__中新建文件夹和网址来源，填写名称、地址和说明。", "需要项目专属网页时连接当前工作区，并可从全局区域复制已有来源。"],
    tips: ["资料目录身份和来源索引可同步，但不会把本机绝对路径写入同步数据。", "资料与网页不会自动进入任何 AI 请求。"],
  },
  {
    id: "research-readers",
    categoryId: "research",
    title: "右侧资料标签、PDF、网页与多格式阅读",
    summary: "资料在右编辑组以独立标签打开，可阅读 PDF、网页以及多种常见本地文件。",
    illustration: "research-readers",
    illustrationAlt: "右编辑组同时打开 PDF 与网页资料标签，PDF 工具栏显示翻页、搜索、缩放和系统打开。",
    illustrationCaption: "资料标签与信笺共享右组，但各自保留阅读位置和工具栏状态。",
    steps: ["在资料树中打开文件或网页，内容会进入右编辑组的新标签。", "PDF 支持页码跳转、方向键和 PageUp/PageDown 翻页、文字搜索、缩放与系统打开。", "网页可后退、前进、刷新或在系统浏览器打开；其他支持格式提供搜索、缩放或表格滚动。"],
    tips: ["PDF 当前页可作为新建文献引用的默认页码。", "不支持内嵌预览的文件会显示安全信息页，可选择用系统应用打开。"],
  },
  {
    id: "ai-modes",
    categoryId: "ai",
    title: "AI 模式选择与模型切换",
    summary: "点击顶部__AI模式__，在[[AI 优化]]和[[AI 问答]]之间选择当前任务。",
    illustration: "ai-modes",
    illustrationAlt: "AI 模式选择窗口显示 AI 优化和 AI 问答两张功能卡片。",
    illustrationCaption: "先选择任务，再在模式内切换已测试可用的模型。",
    illustrations: [
      { type: "ai-model-chooser", alt: "AI 问答的模型选择器完整列出可用供应商和模型。", caption: "进入任务后仍可切换已测试成功的模型。" },
    ],
    steps: ["先在设置中配置并测试至少一个可用模型。", "点击__AI模式__，选择 AI 优化或 AI 问答。", "进入模式后可切换模型；退出 AI 模式会返回普通双编辑组布局。"],
    tips: ["模型不可用时会引导打开 AI 配置，不会静默发送请求。", "优化结果、问答记录和输入草稿都按信笺保存。"],
  },
  {
    id: "ai-providers",
    categoryId: "ai",
    title: "供应商、请求参数与任务模型",
    summary: "AI 配置管理供应商、基础模型、逐模型[[请求参数]]和只负责特定工作的任务模型。",
    illustration: "ai-providers",
    illustrationAlt: "AI 配置页面显示供应商模型、请求参数以及直接应用定位任务模型。",
    illustrationCaption: "只有测试成功的模型可用于写作任务或设为任务专用模型。",
    steps: ["从设置进入__AI 配置__，选择 Gemini、DeepSeek、Codex CLI 或自定义供应商。", "为 HTTP 模型填写模型标识和请求参数，测试成功后设为默认。", "打开__任务模型__，为直接应用定位指定专用模型；未指定时跟随默认模型。"],
    tips: ["直接应用定位模型只判断替换或插入位置，不参与优化内容的生成。", "API Key 仅保存在本机；切换任务供应商时会清空不兼容的任务请求参数。"],
  },
  {
    id: "codex-cli",
    categoryId: "ai",
    title: "Codex CLI",
    summary: "Codex CLI 复用本机登录态，不需要在笺间填写 Base URL 或 API Key。",
    illustration: "codex-cli",
    illustrationAlt: "Codex CLI 配置页显示安装、登录和版本状态，以及可用模型和推理强度。",
    illustrationCaption: "重新检查会同步本机状态、模型目录与支持的推理强度。",
    illustrations: [
      { type: "codex-cli-models", alt: "Codex CLI 配置页下半部分完整显示模型列表、默认模型和推理强度。", caption: "每个模型都可单独选择推理强度，并设置默认模型。" },
    ],
    steps: ["先安装 `npm install -g @openai/codex`，再在配置页点击重新检查。", "未登录时点击登录 Codex，在打开的终端中完成授权。", "同步完成后，为模型选择推理强度并设置默认模型。"],
    tips: ["Codex CLI 仅在桌面端可用，调用会消耗当前登录账号的配额。", "笺间不会保存 Codex 登录凭据；模型和推理强度以本机 CLI 返回结果为准。"],
  },
  {
    id: "ai-optimize",
    categoryId: "ai",
    title: "AI 优化、修改对比、直接应用与手动定位",
    summary: "AI 优化把结果拆成可复制或应用的内容块，应用前必须在原文中显示[[红蓝修改对比]]。",
    illustration: "ai-optimize",
    illustrationAlt: "AI 优化的直接应用修改对比完整显示待替换原文、蓝色拟应用内容以及取消和确认应用按钮。",
    illustrationCaption: "红蓝对比和操作按钮会完整显示在左侧正文中，确认前不会写入。",
    illustrations: [
      { type: "ai-optimize-apply", alt: "直接应用无法可靠定位时，左侧顶部显示手动定位提示，要求点选可编辑原文块。", caption: "定位失败会进入手动选择：先在左侧点选原文块，再选择替换或前后插入。" },
    ],
    steps: ["进入 AI 优化；定稿线以上作为背景，线以下作为本次优化重点。", "在结果块点击__应用__，定位模型判断替换或插入位置。", "在左侧检查红蓝对比，选择确认应用或取消；无法可靠定位时手动选择原文位置和应用方式。"],
    tips: ["确认后的修改可用一次 `Ctrl+Z` 完整撤销。", "定稿区、受保护结构或过期目标不会被强行修改；可能影响评注时会明确提示数量。"],
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
    tips: ["清空只影响当前信笺的问答，不会清除 AI 优化结果。", "切换信笺或模型不会混用不同信笺的对话上下文。"],
  },
  {
    id: "ai-isolation",
    categoryId: "ai",
    title: "AI 数据范围、研究资料隔离与信笺原图",
    summary: "AI 请求只围绕当前信笺；[[资料区、其他信笺和工作区文件]]不会自动进入上下文。",
    illustration: "ai-isolation",
    illustrationAlt: "Codex 问答工具栏固定显示仅当前信笺隔离，并展开信笺原图与仅标题选项。",
    illustrationCaption: "Codex 的读取范围固定为当前信笺，不能扩大到本地目录。",
    steps: ["进入 AI 模式后确认工具栏显示当前信笺；切换信笺会同时切换对应记录。", "Codex 始终固定为仅当前信笺，不读取信笺目录、工作区或资料区。", "在问答设置中选择附加当前信笺全部原图，或仅发送 `[图N.标题]`。"],
    tips: ["研究资料即使在右侧打开，也不会进入 AI 请求。", "原图会增加 token；图片失效时会明确报告图号，不会静默跳过。"],
  },
  {
    id: "focus-mode",
    categoryId: "view",
    title: "专注模式与精简布局",
    summary: "按 `F11` 进入[[专注模式]]，隐藏系统标题栏和底部状态栏，并收起右侧编辑组。",
    illustration: "focus-mode",
    illustrationAlt: "专注模式下系统标题栏和底部状态栏隐藏，顶部写作工具与左侧栏继续可用。",
    illustrationCaption: "专注模式精简窗口边框和辅助状态，常用写作工具仍保持可见。",
    steps: ["点击__专注模式__或按 `F11` 进入全屏写作。", "继续使用顶部写作工具和左侧栏；进入前的右侧编辑组会暂时收起。", "再次按 `F11` 或按层级使用 `Esc`，退出并恢复进入前的布局。"],
    tips: ["打开的弹窗、菜单和 AI 模式会先按各自层级响应 Esc。", "退出专注模式后，侧栏、双组比例、右组内容和当前标签保持原状。"],
  },
  {
    id: "templates-gallery",
    categoryId: "view",
    title: "系统模板与快速应用",
    summary: "信笺模板统一管理纸张、字体和结构呈现，不改变正文内容。",
    illustration: "templates-gallery",
    illustrationAlt: "信笺模板弹窗左侧为模板分组，右侧为多种系统信纸卡片。",
    illustrationCaption: "系统模板只读；标签页负责快速应用，设置中心负责管理。",
    illustrations: [
      { type: "template-quick-menu", alt: "右键信笺标签后出现修改模板、移到右侧和关闭标签菜单。", caption: "先右键信笺标签，再点击“修改模板”。" },
      { type: "template-quick-picker", alt: "修改模板选择窗口完整显示系统模板分组和可直接应用的模板卡片。", caption: "选择窗口会完整列出系统模板和用户模板，点击卡片即可快速应用。" },
    ],
    steps: ["右键信笺标签，点击修改模板，再在弹出的选择窗口中选择要使用的样式。", "打开设置并选择模板配置，在系统分组间切换，点击模板卡片查看详情和完整页面预览。", "创建、编辑、分组和默认模板等管理操作都在模板配置中完成。"],
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
    illustrations: [
      { type: "template-editor-advanced", alt: "模板详情展开高级选项，显示页面结构、正文段落和对齐等设置。", caption: "高级选项较长，可向下滚动继续设置标题编号和图片标题规则。" },
    ],
    steps: ["从设置选择模板配置，在模板详情点击新建模板，填写唯一名称并选择所属用户分组。", "调整标题、正文、引用等字体字号，并在高级选项中设置段落、标题编号和图片标题。", "保存后可设为新建信笺默认模板，或继续重命名、归类和删除。"],
    tips: ["所有用户模板始终保留在“我的模板”；删除其他分组只移除归类。", "删除当前新建默认模板时，会恢复到上一个有效默认模板。"],
  },
  {
    id: "status-cache-update",
    categoryId: "view",
    title: "状态栏、恢复缓存、版本历史与更新",
    summary: "底部状态栏集中显示文档统计、[[恢复缓存状态]]、编辑器缓存、版本历史和更新入口。",
    illustration: "statusbar-update",
    illustrationAlt: "底部状态栏显示字数、段落、页数、图片、恢复缓存、缓存大小、检查更新和版本号。",
    illustrationCaption: "状态栏同时反馈当前内容状态和应用维护状态。",
    illustrations: [
      { type: "release-notes", alt: "点击版本号后打开完整更新历史，左侧为阶段列表，右侧为版本详情。", caption: "版本历史内置在应用中，无需联网也可查看。" },
    ],
    steps: ["左侧查看字数、段落、页数和图片统计。", "中间确认恢复缓存写入状态，并查看或清理信笺切换缓存。", "右侧检查更新；点击版本号可离线查看完整版本历史。"],
    tips: ["恢复缓存用于意外恢复，编辑器结构缓存只用于加速标签切换。", "浏览器预览不支持真实更新；桌面版发现更新时会显示状态提示。"],
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
        .map((tab) => ({
          path: typeof tab?.path === "string" ? tab.path : "",
          recoveryPath: typeof tab?.recoveryPath === "string" ? tab.recoveryPath : "",
          recoveryId: typeof tab?.recoveryId === "string" ? tab.recoveryId : "",
          recoverySourcePath: typeof tab?.recoverySourcePath === "string" ? tab.recoverySourcePath : "",
          recoveryBaseRevision: normalizeSessionDiskRevision(tab?.recoveryBaseRevision),
          temporary: Boolean(tab?.temporary),
        }))
        .filter((tab) => tab.path || tab.recoveryPath)
      : [];
    return {
      folderPath: typeof parsed.folderPath === "string" ? parsed.folderPath : "",
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : "",
      tabs,
      workspaceGroups: parsed.workspaceGroups && typeof parsed.workspaceGroups === "object" ? parsed.workspaceGroups : null,
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
        .map((tab) => ({
          path: typeof tab?.path === "string" ? tab.path : "",
          recoveryPath: typeof tab?.recoveryPath === "string" ? tab.recoveryPath : "",
          recoveryId: typeof tab?.recoveryId === "string" ? tab.recoveryId : "",
          recoverySourcePath: typeof tab?.recoverySourcePath === "string" ? tab.recoverySourcePath : "",
          recoveryBaseRevision: normalizeSessionDiskRevision(tab?.recoveryBaseRevision),
          temporary: Boolean(tab?.temporary),
        }))
        .filter((tab) => tab.path || tab.recoveryPath)
      : [],
    workspaceGroups: state.workspaceGroups && typeof state.workspaceGroups === "object" ? state.workspaceGroups : null,
    updatedAt: new Date().toISOString(),
  }));
}

function normalizeRememberedExportDirectory(value) {
  const directory = typeof value === "string" ? value.trim() : "";
  return directory && directory.length <= 32768 && !/[\u0000-\u001f\u007f]/.test(directory) ? directory : "";
}

function loadRememberedExportDirectory() {
  if (typeof window === "undefined") return "";
  try {
    return normalizeRememberedExportDirectory(window.localStorage.getItem(EXPORT_LAST_DIRECTORY_STORAGE_KEY));
  } catch {
    return "";
  }
}

function rememberExportDirectory(value) {
  if (typeof window === "undefined") return;
  const directory = normalizeRememberedExportDirectory(value);
  if (!directory) return;
  try {
    window.localStorage.setItem(EXPORT_LAST_DIRECTORY_STORAGE_KEY, directory);
  } catch {
    // Export still works when local preferences are unavailable.
  }
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

function normalizePublicAiTaskModelAssignment(value = {}) {
  const rawProviderId = typeof value?.providerId === "string" ? value.providerId.slice(0, 128).trim() : "";
  const providerId = /^[a-z0-9][a-z0-9._-]{0,127}$/i.test(rawProviderId)
    && !["__proto__", "prototype", "constructor", "tostring", "valueof"].includes(rawProviderId.toLowerCase())
    ? rawProviderId
    : "";
  const modelId = typeof value?.modelId === "string" ? value.modelId.slice(0, 256).trim() : "";
  return providerId && modelId
    ? { providerId, modelId, requestParams: normalizeUiAiRequestParams(value?.requestParams) }
    : { providerId: "", modelId: "", requestParams: {} };
}

function formatAiReasoningEffort(value = "") {
  return AI_REASONING_EFFORT_OPTIONS.find((option) => option.value === value)?.label || value || "服务商默认";
}

function getAiReasoningEffortOptions(model = {}, { inherit = false } = {}) {
  const supported = Array.isArray(model.supportedReasoningEfforts) && model.supportedReasoningEfforts.length
    ? model.supportedReasoningEfforts.map((option) => ({
      value: String(option?.reasoningEffort || option || ""),
      label: formatAiReasoningEffort(String(option?.reasoningEffort || option || "")),
    })).filter((option) => option.value)
    : AI_REASONING_EFFORT_OPTIONS.filter((option) => option.value);
  const current = String(model.reasoningEffort || model.defaultReasoningEffort || "");
  const choices = current && !supported.some((option) => option.value === current)
    ? [{ value: current, label: formatAiReasoningEffort(current) }, ...supported]
    : supported;
  if (!inherit) {
    return [{ value: "", label: "服务商默认" }, ...choices];
  }
  const modelDefault = formatAiReasoningEffort(current);
  return [{ value: "", label: `跟随模型设置 · ${modelDefault}` }, ...choices];
}

function normalizePublicAiModelConfig(provider, config = {}, index = 0) {
  const defaults = getAiProviderDefaults(provider, config);
  const model = String(config.model || defaults.model || "").trim();
  const isCodex = defaults.transport === "codex-cli";
  return {
    id: config.id || createAiModelId(provider, model || String(index + 1)),
    name: String(config.name || config.modelName || (index === 0 ? "默认模型" : `模型 ${index + 1}`)).trim() || `模型 ${index + 1}`,
    model,
    requestParams: isCodex ? {} : normalizeUiAiRequestParams(config.requestParams),
    reasoningEffort: isCodex ? (config.reasoningEffort || config.defaultReasoningEffort || "") : "",
    defaultReasoningEffort: isCodex ? (config.defaultReasoningEffort || "") : "",
    supportedReasoningEfforts: isCodex && Array.isArray(config.supportedReasoningEfforts) ? config.supportedReasoningEfforts : [],
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
    requestParams: config.requestParams,
    reasoningEffort: config.reasoningEffort,
    defaultReasoningEffort: config.defaultReasoningEffort,
    supportedReasoningEfforts: config.supportedReasoningEfforts,
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
  const applyResolver = normalizePublicAiTaskModelAssignment(config?.taskModels?.applyResolver);
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
    taskModels: {
      applyResolver,
    },
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
        requestParams: model.requestParams || {},
        reasoningEffort: model.reasoningEffort || model.defaultReasoningEffort || "",
        defaultReasoningEffort: model.defaultReasoningEffort || "",
        supportedReasoningEfforts: model.supportedReasoningEfforts || [],
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
    requestParams: model.requestParams || {},
    reasoningEffort: model.reasoningEffort || model.defaultReasoningEffort || "",
    defaultReasoningEffort: model.defaultReasoningEffort || "",
    supportedReasoningEfforts: model.supportedReasoningEfforts || [],
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

    if (node.type === "paperFootnoteList" || node.type === "paperBibliography") {
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
        ? normalizeImageCaption(node.attrs?.caption || normalizeImageText(node.attrs?.alt) || "图片").trim()
        : "图片";
      assets.images[imageIndex] = {
        number: imageIndex,
        caption,
        src: normalizeImageSource(node.attrs?.src),
        alt: normalizeImageText(node.attrs?.alt || caption),
        width: normalizeEmbedWidth(node.attrs?.width),
      };
      pushLine(includeImageCaptions ? `[图${imageIndex}.${caption}]` : "[图片]");
      return;
    }

    if (node.type === "paperMedia") {
      const kind = node.attrs?.kind === "video" ? "视频" : "音频";
      const fileName = normalizeMediaFileName(node.attrs?.fileName, `未命名${kind}`);
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
  return Object.values(assets.images || {}).map((image, index) => {
    const source = normalizeImageSource(image?.src);
    return {
      number: Math.max(1, Number(image?.number) || index + 1),
      caption: String(image?.caption || image?.alt || "图片").trim() || "图片",
      src: source,
      mime: imageMimeFromSource(source),
    };
  });
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

function buildAiOptimizationContext(blocks, selectedIndex) {
  const source = Array.isArray(blocks) ? blocks : [];
  const index = Math.max(0, Math.min(source.length - 1, Math.floor(Number(selectedIndex) || 0)));
  return {
    selectedIndex: index,
    totalBlocks: source.length,
    previousBlocks: source.slice(Math.max(0, index - 2), index),
    nextBlocks: source.slice(index + 1, index + 3),
  };
}

function summarizeAiApplyTarget(operation, manifest, maximum = 88) {
  const blocks = Array.isArray(manifest?.blocks) ? manifest.blocks : [];
  const selected = operation?.action === "replace"
    ? blocks.filter((block) => operation.targetBlockIds?.includes(block.id))
    : blocks.filter((block) => block.id === operation?.anchorBlockId);
  const text = selected.map((block) => block.text || `[${block.type}]`).filter(Boolean).join(" / ").replace(/\s+/g, " ").trim();
  if (!text) return "目标位置附近没有可显示的文字";
  return text.length > maximum ? `${text.slice(0, maximum)}…` : text;
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
    const src = normalizeImageSource(block.asset?.src);
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
    codexScope: { ...CODEX_DOCUMENT_ONLY_SCOPE },
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
  const images = Object.fromEntries(
    boundedAiImageEntries(assets.images)
      .map(([key, image], index) => [String(key).slice(0, 128), {
        number: Math.max(1, Math.floor(Number(image?.number) || index + 1)),
        caption: String(image?.caption || image?.alt || "图片").slice(0, 240),
        src: normalizeImageSource(image?.src),
        alt: typeof image?.alt === "string" ? image.alt.slice(0, 240) : "",
        width: normalizeEmbedWidth(image?.width),
      }]),
  );
  return {
    ...createEmptyAiOptimizeState(),
    ...state,
    output: typeof state.output === "string" ? state.output.slice(0, 8 * 1024 * 1024) : "",
    status,
    error: typeof state.error === "string" ? state.error.slice(0, 2000) : "",
    assets: {
      images,
      quotes: normalizeBoundedAiQuotes(assets.quotes),
    },
    elapsedSeconds: Number.isFinite(Number(state.elapsedSeconds)) ? Math.max(0, Number(state.elapsedSeconds)) : 0,
    tokenStats: state.tokenStats && typeof state.tokenStats === "object" ? state.tokenStats : null,
    provider: typeof state.provider === "string" ? state.provider : "",
    modelId: typeof state.modelId === "string" ? state.modelId : "",
    modelName: typeof state.modelName === "string" ? state.modelName : "",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

function normalizeAiChatSelection(selection = {}) {
  return {
    id: typeof selection.id === "string" && selection.id ? selection.id.slice(0, 128) : createAiChatSelectionId(),
    text: typeof selection.text === "string" ? selection.text.slice(0, 20000) : "",
    from: Number.isFinite(Number(selection.from)) ? Number(selection.from) : 1,
    to: Number.isFinite(Number(selection.to)) ? Number(selection.to) : 1,
  };
}

function normalizeAiChatState(state = {}) {
  // Parse legacy values so older documents remain loadable, then migrate them
  // to the only scope the isolated backend accepts.
  normalizeCodexScope(state.codexScope);
  return {
    ...createEmptyAiChatState(),
    ...state,
    messages: normalizeBoundedAiChatMessages(state.messages),
    input: typeof state.input === "string" ? state.input.slice(0, 200000) : "",
    selectedTexts: Array.isArray(state.selectedTexts) ? state.selectedTexts.slice(0, 100).map(normalizeAiChatSelection).filter((selection) => selection.text) : [],
    codexScope: { ...CODEX_DOCUMENT_ONLY_SCOPE },
    codexImageMode: normalizeCodexImageMode(state.codexImageMode),
    status: ["idle", "streaming", "error"].includes(state.status) ? state.status : "idle",
    error: typeof state.error === "string" ? state.error.slice(0, 2000) : "",
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
    version: 2,
    documentId: createDocumentId(),
    derivedFrom: "",
    footnotes: [],
    citationSources: [],
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
      const orderA = Number.isFinite(topA) ? topA : Number.POSITIVE_INFINITY;
      const orderB = Number.isFinite(topB) ? topB : Number.POSITIVE_INFINITY;
      if (orderA !== orderB) return orderA - orderB;
      return (a.from - b.from) || (a.to - b.to) || a.createdAt.localeCompare(b.createdAt);
    });
  const presentations = new Map();
  const activeAnchors = [];
  const trackUseCounts = COMMENT_TRACKS.map(() => 0);
  let activeStart = 0;
  sortedComments.forEach((comment) => {
    const top = anchorTopById.get(comment.id);
    if (Number.isFinite(top)) {
      while (
        activeStart < activeAnchors.length
        && top - activeAnchors[activeStart].top >= COMMENT_ANCHOR_COLLISION_DISTANCE
      ) {
        trackUseCounts[activeAnchors[activeStart].trackIndex] -= 1;
        activeStart += 1;
      }
    }
    let trackIndex = COMMENT_TRACKS.findIndex((_, index) => trackUseCounts[index] === 0);
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
      activeAnchors.push({
        id: comment.id,
        top,
        trackIndex,
      });
      trackUseCounts[trackIndex] += 1;
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
  const customBackground = normalizeCustomBackgroundSource(document?.customBackground);
  const letterTemplateId = normalizeLetterTemplateId(document?.letterTemplateId, document?.templateId, letterTemplates);
  const letterTemplate = letterTemplates.find((template) => template.id === letterTemplateId) || DEFAULT_LETTER_TEMPLATES[0];
  const templateId = customBackground && document?.templateId === "custom" ? "custom" : letterTemplate.paperId;
  const createdAt = typeof document?.createdAt === "string" && document.createdAt
    ? document.createdAt
    : (typeof document?.updatedAt === "string" && document.updatedAt ? document.updatedAt : new Date().toISOString());
  const displayDate = typeof document?.displayDate === "string" && document.displayDate.trim()
    ? document.displayDate.trim().slice(0, 40)
    : formatPaperDate(createdAt);
  const compatibility = getDocumentSchemaCompatibility(document || {});
  const usesV2 = compatibility.version >= 2
    || Boolean(document?.documentId)
    || Array.isArray(document?.footnotes)
    || Array.isArray(document?.citationSources);
  const schemaDocument = compatibility.readOnly
    ? document
    : (usesV2 ? normalizeDocumentSchemaV2(document || {}) : { ...(document || {}), version: 1 });
  const normalized = {
    ...createBlankDocument(),
    ...schemaDocument,
    title: normalizeDocumentTitle(schemaDocument?.title),
    author: typeof schemaDocument?.author === "string" ? schemaDocument.author.trim().slice(0, 40) : "",
    html: schemaDocument?.html || "<p></p>",
    createdAt,
    displayDate,
    letterTemplateId,
    templateId,
    fontFamily: letterTemplate.typography.bodyFont,
    fontSize: letterTemplate.typography.bodySize,
    layoutMode: LAYOUT_MODES.FLOW,
    customBackground,
    comments: normalizeDocumentComments(schemaDocument?.comments),
    aiState: normalizeAiState(schemaDocument?.aiState),
    _readOnlyFutureSchema: compatibility.readOnly || Boolean(schemaDocument?._readOnlyFutureSchema),
  };
  // Legacy files remain v1 until a v2-only feature is actually used. This
  // avoids silently discarding compatibility with 0.9.2 merely by opening and
  // saving an otherwise unchanged document.
  if (!usesV2 && !compatibility.readOnly) {
    normalized.version = 1;
    delete normalized.documentId;
    delete normalized.derivedFrom;
    delete normalized.footnotes;
    delete normalized.citationSources;
  }
  return normalized;
}

function inferTitle(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 24) : "未命名信笺";
}

function displayNameFromPath(filePath) {
  return String(filePath || "").replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || String(filePath || "");
}

function normalizeResearchTreeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    ...entry,
    type: entry?.type || entry?.kind || "file",
    kind: entry?.kind || entry?.type || "file",
    relativePath: String(entry?.relativePath || "").replace(/\\/g, "/"),
    children: Array.isArray(entry?.children) ? normalizeResearchTreeEntries(entry.children) : entry?.children,
  }));
}

function replaceResearchTreeFolder(entries, folderRelativePath, children, patch = {}) {
  const target = String(folderRelativePath || "").replace(/\\/g, "/");
  if (!target) return normalizeResearchTreeEntries(children);
  return normalizeResearchTreeEntries(entries).map((entry) => {
    if (entry.relativePath === target) {
      return { ...entry, ...patch, children: normalizeResearchTreeEntries(children) };
    }
    if (Array.isArray(entry.children) && target.startsWith(`${entry.relativePath}/`)) {
      return { ...entry, children: replaceResearchTreeFolder(entry.children, target, children, patch) };
    }
    return entry;
  });
}

function sameDiskRevision(left, right) {
  if (!left || !right) return left === right;
  return Number(left.size) === Number(right.size)
    && Number(left.mtimeMs) === Number(right.mtimeMs)
    && String(left.sha256 || "") === String(right.sha256 || "");
}

function normalizeSessionDiskRevision(revision) {
  if (!revision || typeof revision !== "object") return null;
  const normalized = {
    size: Number(revision.size),
    mtimeMs: Number(revision.mtimeMs),
    sha256: String(revision.sha256 || "").toLowerCase(),
  };
  return Number.isSafeInteger(normalized.size)
    && normalized.size >= 0
    && Number.isFinite(normalized.mtimeMs)
    && normalized.mtimeMs >= 0
    && /^[a-f0-9]{64}$/.test(normalized.sha256)
    ? normalized
    : null;
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
  if (sameDocumentPath(targetPath, fromPath)) {
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

function StatusToast({ status, onClose }) {
  if (!status) {
    return null;
  }
  return (
    <div
      className={`status-toast ${status.tone}`}
      role={status.tone === "warning" ? "alert" : "status"}
      aria-live={status.tone === "warning" ? "assertive" : "polite"}
    >
      {status.tone === "warning" ? <Info size={16} /> : <CheckCircle2 size={16} />}
      <span>{status.message}</span>
      {status.dismissible ? (
        <button type="button" className="status-toast-dismiss" aria-label="关闭提示" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
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
  const url = normalizeExternalLinkUrl(source);
  return url ? { ok: true, url } : { ok: false, error: "链接地址格式不正确，仅支持 http、https 和邮箱链接" };
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

function getClickedLinkContext(editor, anchor) {
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
      trailingNode: { notAfter: ["paragraph", ...KNOWLEDGE_TAIL_NODE_TYPES] },
      link: false,
    }),
    TextStyle,
    Color.configure({ types: ["textStyle"] }),
    StyledUnderlineExtension,
    Highlight.configure({ multicolor: true }),
    FontFamily,
    PaperDerivedState,
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
    ...createStructuredInlineExtensions(),
    ...createKnowledgeExtensions(),
    DocumentSearchExtension,
    AiChatSelectionDecorations,
    AiApplyPreviewDecorations,
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
  if (getPaperDerivedState(editor).hasFinalizedBreak) {
    return;
  }
  runEditorCommand(editor, savedSelectionRef, (chain) => chain.insertContent({ type: "paperFinalizedBreak" }));
}

function removeFinalizedBreak(editor) {
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

function insertTableOfContents(editor, savedSelectionRef) {
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

function toggleAutomaticBibliography(editor) {
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

function parsedImageElement(element) {
  if (element?.matches?.("img")) {
    return element;
  }
  return element?.querySelector?.("img") || null;
}

function PaperImageNodeView({ node, updateAttributes, selected, editor, getPos }) {
  const width = normalizeEmbedWidth(node.attrs.width);
  const source = normalizeImageSource(node.attrs.src);
  const caption = normalizeImageCaption(node.attrs.caption);
  const alt = normalizeImageText(node.attrs.alt);
  const title = normalizeImageText(node.attrs.title);
  const imageId = normalizeDocumentId(node.attrs.imageId);
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
      data-image-id={imageId}
      data-width={width}
      style={{ "--image-width": width }}
    >
      <div className="paper-image-frame" contentEditable={false}>
        <img src={source || undefined} alt={alt} title={title} draggable={false} decoding="async" />
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
          <button
            type="button"
            className="image-copy-reference"
            title="复制图片引用"
            aria-label="复制图片引用"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              let position = null;
              try { position = typeof getPos === "function" ? getPos() : null; } catch {}
              window.dispatchEvent(new CustomEvent("paper-image-reference-copy", { detail: {
                editorDom: editor?.view?.dom,
                imageId,
                position,
              } }));
            }}
          >
            <Copy size={13} aria-hidden="true" />
            <span>引用</span>
          </button>
        </div>
      </div>
      <label className="paper-image-caption-row" contentEditable={false}>
        <span className="paper-image-caption-prefix" aria-hidden="true" />
        <textarea
          ref={captionRef}
          className="paper-image-caption"
          value={caption}
          maxLength={IMAGE_CAPTION_MAX_CHARS}
          rows={1}
          onChange={(event) => {
            updateAttributes({ caption: normalizeImageCaption(event.target.value) });
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
    const parentAttributes = this.parent?.() || {};
    return {
      ...parentAttributes,
      src: {
        ...parentAttributes.src,
        parseHTML: (element) => normalizeImageSource(parsedImageElement(element)?.getAttribute("src")) || null,
      },
      alt: {
        ...parentAttributes.alt,
        parseHTML: (element) => normalizeImageText(parsedImageElement(element)?.getAttribute("alt")),
      },
      title: {
        ...parentAttributes.title,
        parseHTML: (element) => normalizeImageText(parsedImageElement(element)?.getAttribute("title")),
      },
      width: {
        default: "78%",
        parseHTML: (element) => normalizeEmbedWidth(element.getAttribute("data-width") || element.style.width),
      },
      caption: {
        default: "",
        parseHTML: (element) => normalizeImageCaption(element.getAttribute("data-caption") || element.querySelector("figcaption")?.textContent?.trim()),
      },
      imageId: {
        default: "",
        parseHTML: (element) => normalizeDocumentId(element.getAttribute("data-image-id")),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-type='paper-image']",
        getAttrs: (element) => {
          const image = element.querySelector("img");
          const source = normalizeImageSource(image?.getAttribute("src"));
          if (!source) {
            return false;
          }
          return {
            src: source,
            alt: normalizeImageText(image.getAttribute("alt")),
            title: normalizeImageText(image.getAttribute("title")),
            width: normalizeEmbedWidth(element.getAttribute("data-width") || element.style.getPropertyValue("--image-width")),
            caption: normalizeImageCaption(element.getAttribute("data-caption") || element.querySelector("figcaption")?.textContent?.trim()),
            imageId: normalizeDocumentId(element.getAttribute("data-image-id")),
          };
        },
      },
      {
        tag: "img[src]",
        getAttrs: (element) => {
          const source = normalizeImageSource(element.getAttribute("src"));
          return source ? {
            src: source,
            alt: normalizeImageText(element.getAttribute("alt")),
            title: normalizeImageText(element.getAttribute("title")),
            width: normalizeEmbedWidth(element.getAttribute("data-width") || element.style.width),
            caption: "",
            imageId: normalizeDocumentId(element.getAttribute("data-image-id")),
          } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { width = "78%", caption = "", imageId = "", ...imageAttrs } = HTMLAttributes;
    const safeWidth = normalizeEmbedWidth(width);
    const safeCaption = normalizeImageCaption(caption);
    const safeImageId = normalizeDocumentId(imageId);
    const source = normalizeImageSource(imageAttrs.src);
    imageAttrs.alt = normalizeImageText(imageAttrs.alt);
    imageAttrs.title = normalizeImageText(imageAttrs.title);
    delete imageAttrs.style;
    if (source) imageAttrs.src = source;
    else delete imageAttrs.src;
    return [
      "figure",
      {
        "data-type": "paper-image",
        "data-image-id": safeImageId,
        "data-width": safeWidth,
        "data-caption": safeCaption,
        class: "paper-image-figure",
        style: `--image-width: ${safeWidth};`,
      },
      ["img", mergeAttributes({ decoding: "async" }, imageAttrs)],
      ["figcaption", { "data-placeholder": "添加图片标题" }, safeCaption],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PaperImageNodeView);
  },
});

function PaperMediaNodeView({ node, updateAttributes, selected }) {
  const kind = node.attrs.kind === "video" ? "video" : "audio";
  const width = normalizeEmbedWidth(node.attrs.width);
  const source = normalizeMediaSource(node.attrs.src, kind);
  const fileName = normalizeMediaFileName(node.attrs.fileName, kind === "video" ? "未命名视频" : "未命名音频");
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
          <video className="paper-media-player" src={source || undefined} controls preload="metadata" aria-label={`播放视频：${fileName}`} onMouseDown={(event) => event.stopPropagation()} />
        ) : (
          <audio className="paper-media-player" src={source || undefined} controls preload="metadata" aria-label={`播放音频：${fileName}`} onMouseDown={(event) => event.stopPropagation()} />
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
        const source = normalizeMediaSource(player.getAttribute("src"), kind);
        if (!source) return false;
        return {
          kind,
          src: source,
          fileName: normalizeMediaFileName(element.getAttribute("data-file-name")),
          mime: normalizeMediaMime(element.getAttribute("data-mime"), kind),
          width: normalizeEmbedWidth(element.getAttribute("data-width")),
        };
      },
    }];
  },

  renderHTML({ HTMLAttributes }) {
    const kind = HTMLAttributes.kind === "video" ? "video" : "audio";
    const fileName = normalizeMediaFileName(HTMLAttributes.fileName, kind === "video" ? "未命名视频" : "未命名音频");
    const mediaLabel = kind === "video" ? "视频" : "音频";
    const width = normalizeEmbedWidth(HTMLAttributes.width);
    const source = normalizeMediaSource(HTMLAttributes.src, kind);
    const mime = normalizeMediaMime(HTMLAttributes.mime, kind);
    return [
      "figure",
      {
        "data-type": "paper-media",
        "data-kind": kind,
        "data-file-name": fileName,
        "data-mime": mime,
        "data-width": width,
        class: `paper-media-figure ${kind}`,
        style: `--media-width: ${kind === "video" ? width : "100%"};`,
      },
      [kind, { ...(source ? { src: source } : {}), controls: "controls", preload: "metadata", class: "paper-media-player", "aria-label": `播放${mediaLabel}：${fileName}` }],
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
  const headings = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => {
      if (!activeEditor) return [];
      const numberingDefaults = HEADING_NUMBERING_PLUGIN_KEY.getState(activeEditor.state)?.defaults;
      return numberHeadingItems(getPaperDerivedState(activeEditor).headingItems, numberingDefaults);
    },
  }) || [];

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
          const positions = PAPER_DERIVED_STATE_PLUGIN_KEY.getState(newState)?.tableOfContentsPositions || [];
          if (!positions.length || (positions.length === 1 && positions[0].pos === 0)) {
            return null;
          }
          const tr = newState.tr;
          positions
            .slice()
            .reverse()
            .forEach(({ pos, nodeSize }) => {
              tr.delete(pos, pos + nodeSize);
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

function numberHeadingItems(headingItems = [], numberingDefaults = DEFAULT_TEMPLATE_PRESENTATION.headingNumbering) {
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

function buildHeadingNumberDecorationSet(doc, headingItems, numberingDefaults = DEFAULT_TEMPLATE_PRESENTATION.headingNumbering) {
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

function buildAiApplyPreviewDecorationSet(doc, preview) {
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

const AiApplyPreviewDecorations = Extension.create({
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

const PaperDerivedState = Extension.create({
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

const DocumentCommentDecorations = Extension.create({
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

function syncAiChatSelectionDecorations(editor, selections = []) {
  if (!editor?.view) {
    return;
  }
  editor.view.dispatch(editor.state.tr.setMeta(AI_CHAT_SELECTION_PLUGIN_KEY, selections));
}

function syncAiApplyPreviewDecorations(editor, preview = null) {
  if (!editor?.view || editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(AI_APPLY_PREVIEW_PLUGIN_KEY, preview
    ? { type: "show", preview }
    : { type: "clear" }));
}

function syncDocumentCommentDecorations(editor, comments = []) {
  if (!editor?.view) {
    return;
  }
  editor.view.dispatch(editor.state.tr.setMeta(DOCUMENT_COMMENT_PLUGIN_KEY, {
    type: "set-comments",
    comments,
  }));
}

function setDocumentCommentVisibility(editor, hidden) {
  if (!editor?.view) return;
  editor.view.dispatch(editor.state.tr.setMeta(DOCUMENT_COMMENT_PLUGIN_KEY, {
    type: "set-visibility",
    hidden: Boolean(hidden),
  }));
}

function getDocumentComments(editor, fallback = []) {
  if (!editor?.state) return normalizeDocumentComments(fallback);
  return DOCUMENT_COMMENT_PLUGIN_KEY.getState(editor.state)?.comments || normalizeDocumentComments(fallback);
}

function getPaperDerivedState(editor) {
  if (!editor?.state) return EMPTY_PAPER_DERIVED_STATE;
  return PAPER_DERIVED_STATE_PLUGIN_KEY.getState(editor.state) || EMPTY_PAPER_DERIVED_STATE;
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

function MenuItem({ icon: Icon, label, description = "", shortcut = "", disabled = false, active = false, selection = false, checked, onClick }) {
  const isCheckbox = typeof checked === "boolean";
  const isActive = active || checked === true;
  return (
    <button
      type="button"
      className={["nav-menu-item", isActive ? "active" : "", description ? "with-description" : ""].filter(Boolean).join(" ")}
      role={selection ? "menuitemradio" : isCheckbox ? "menuitemcheckbox" : "menuitem"}
      aria-checked={selection ? active : isCheckbox ? checked : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.9} />
      {description ? (
        <span className="nav-menu-item-copy">
          <strong>{label}</strong>
          <small>{description}</small>
        </span>
      ) : <span>{label}</span>}
      {shortcut ? <kbd className="nav-menu-item-shortcut">{shortcut}</kbd> : null}
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
  savedSelectionRef,
  onNew,
  onOpen,
  onImport,
  onSave,
  onOpenExport,
  onInsertImage,
  onInsertAudio,
  onInsertVideo,
  onOpenLinkDialog,
  onInsertInternalLink,
  onInsertFootnote,
  onOpenCitationPicker,
  onOpenHelp,
  onOpenSettings,
  settingsTriggerRef,
  onOpenSearch,
  workspaceSearchAvailable,
  aiMode,
  aiModeKind,
  aiBusy,
  aiConfigured,
  aiModeChooserOpen,
  aiModeTriggerRef,
  editorLocked,
  onToggleAiModeChooser,
  immersiveMode,
  onToggleImmersive,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
}) {
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => {
      if (!activeEditor) {
        return { canUndo: false, canRedo: false, activeHeadingLevel: 0, bulletListActive: false, orderedListActive: false, activeAlignment: "", tableOfContentsInserted: false, bibliographyInserted: false };
      }
      return {
        canUndo: activeEditor.can().undo(),
        canRedo: activeEditor.can().redo(),
        activeHeadingLevel: [1, 2, 3].find((level) => activeEditor.isActive("heading", { level })) || 0,
        bulletListActive: activeEditor.isActive("bulletList"),
        orderedListActive: activeEditor.isActive("orderedList"),
        activeAlignment: ["left", "center", "right"].find((value) => activeEditor.isActive({ textAlign: value })) || "",
        tableOfContentsInserted: getPaperDerivedState(activeEditor).hasTableOfContents,
        bibliographyInserted: Number.isFinite(findKnowledgeNodePosition(activeEditor, "paperBibliography")),
      };
    },
  }) || {};
  const canEdit = Boolean(editor) && !editorLocked && !aiMode;
  const documentActionsDisabled = Boolean(aiMode);
  const [openMenu, setOpenMenu] = useState("");
  const activeAiModeLabel = aiModeKind === "chat" ? "AI问答" : "AI优化";
  const aiModeTriggerLabel = aiMode
    ? `AI模式，当前：${activeAiModeLabel}${aiBusy ? "，正在生成" : ""}`
    : "选择 AI 模式";
  const leftSidebarToggleLabel = leftSidebarCollapsed ? "展开左侧栏" : "收起左侧栏";
  const LeftSidebarToggleIcon = leftSidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const canUndo = canEdit && toolbarState.canUndo;
  const canRedo = canEdit && toolbarState.canRedo;
  const activeHeadingLevel = toolbarState.activeHeadingLevel || 0;
  const bulletListActive = Boolean(toolbarState.bulletListActive);
  const orderedListActive = Boolean(toolbarState.orderedListActive);
  const tableOfContentsInserted = Boolean(toolbarState.tableOfContentsInserted);
  const bibliographyInserted = Boolean(toolbarState.bibliographyInserted);
  const ListStyleIcon = orderedListActive ? ListOrdered : List;
  const activeAlignment = [
    { value: "left", label: "左对齐", icon: AlignLeft },
    { value: "center", label: "居中", icon: AlignCenter },
    { value: "right", label: "右对齐", icon: AlignRight },
  ].find((option) => toolbarState.activeAlignment === option.value);
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
        <div className={openMenu === "search" ? "nav-menu nav-search-menu open" : "nav-menu nav-search-menu"}>
          <button
            type="button"
            className="nav-sidebar-toggle nav-search-toggle"
            disabled={documentActionsDisabled}
            title="搜索"
            aria-label="选择搜索范围"
            aria-haspopup="menu"
            aria-controls="nav-menu-search"
            aria-expanded={openMenu === "search"}
            onClick={() => setOpenMenu((current) => current === "search" ? "" : "search")}
          >
            <Search size={19} strokeWidth={1.9} aria-hidden="true" />
          </button>
          {openMenu === "search" ? (
            <div className="nav-menu-popover nav-search-popover" id="nav-menu-search" role="menu" aria-label="搜索范围">
              <button type="button" className="nav-search-option" role="menuitem" onClick={() => runMenuAction(() => onOpenSearch?.("document"))}>
                <FileSearch size={17} aria-hidden="true" />
                <span><strong>文档搜索</strong><small>查找文档中的文字</small></span>
                <kbd>Ctrl+F</kbd>
              </button>
              <button
                type="button"
                className="nav-search-option"
                role="menuitem"
                disabled={!workspaceSearchAvailable}
                title={workspaceSearchAvailable ? "搜索当前文件夹及全部子文件夹" : "请先打开一个文件夹"}
                onClick={() => runMenuAction(() => onOpenSearch?.("workspace"))}
              >
                <FolderSearch size={17} aria-hidden="true" />
                <span><strong>文件夹搜索</strong><small>{workspaceSearchAvailable ? "搜索当前文件夹与子文件夹" : "请先打开一个文件夹"}</small></span>
                <kbd>Ctrl+P</kbd>
              </button>
            </div>
          ) : null}
        </div>
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
          <MenuItem icon={FilePlus} label="新建文件" description="创建空白信笺" shortcut="Ctrl+N" onClick={() => runMenuAction(onNew)} />
          <MenuItem icon={FileText} label="打开文件" description="打开本地信笺" shortcut="Ctrl+O" onClick={() => runMenuAction(onOpen)} />
          <MenuDivider />
          <MenuItem icon={Save} label="保存" description="写入当前文件" shortcut="Ctrl+S" onClick={() => runMenuAction(() => onSave(false))} />
          <MenuItem icon={SaveAll} label="另存为" description="保存为新信笺" shortcut="Ctrl+Shift+S" onClick={() => runMenuAction(() => onSave(true))} />
        </MenuButton>
        <MenuButton
          icon={Download}
          label="导出"
          menuId="interchange"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={documentActionsDisabled}
          showDisclosure={false}
        >
          <MenuItem icon={Download} label="导出信笺" description="PDF、图片与可编辑文档" shortcut="Ctrl+Alt+E" onClick={() => runMenuAction(onOpenExport)} />
          <MenuDivider />
          <MenuItem icon={FileInput} label="导入文档" description="MD、HTML、TXT、DOCX" shortcut="Ctrl+Alt+I" onClick={() => runMenuAction(onImport)} />
        </MenuButton>
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
        <button
          ref={settingsTriggerRef}
          type="button"
          className="nav-menu-trigger settings-feature-trigger"
          title="设置"
          aria-label="打开设置"
          onClick={() => runMenuAction(() => onOpenSettings?.())}
        >
          <Settings size={19} strokeWidth={1.9} aria-hidden="true" />
          <span>设置</span>
        </button>
      </div>

      <div className="nav-center">
        <button
          ref={aiModeTriggerRef}
          type="button"
          className={[
            "nav-menu-trigger",
            "ai-feature-trigger",
            aiMode ? "active" : "",
            aiBusy ? "busy" : "",
            aiConfigured ? "configured" : "unconfigured",
            aiModeChooserOpen ? "chooser-open" : "",
          ].filter(Boolean).join(" ")}
          onClick={() => {
            closeMenus();
            onToggleAiModeChooser?.();
          }}
          title={aiModeTriggerLabel}
          aria-label={aiModeTriggerLabel}
          aria-pressed={aiMode}
          aria-haspopup="dialog"
          aria-controls="ai-mode-chooser-dialog"
          aria-expanded={aiModeChooserOpen}
          aria-busy={aiBusy}
        >
          <Sparkles size={19} strokeWidth={1.9} aria-hidden="true" />
          <span>AI模式</span>
        </button>
        <button
          type="button"
          className={["nav-menu-trigger", "focus-mode-trigger", immersiveMode ? "active" : ""].filter(Boolean).join(" ")}
          title={immersiveMode ? "退出专注模式（F11）" : "进入专注模式（F11）"}
          aria-label={immersiveMode ? "退出专注模式" : "进入专注模式"}
          aria-pressed={immersiveMode}
          onClick={() => runMenuAction(onToggleImmersive)}
        >
          <Focus size={19} strokeWidth={1.9} aria-hidden="true" />
          <span>专注模式</span>
        </button>
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
        <button
          type="button"
          className={bibliographyInserted ? "nav-command tool-command active" : "nav-command tool-command"}
          disabled={!canEdit}
          title={bibliographyInserted ? "关闭自动参考文献" : "在文尾生成参考文献"}
          aria-label={bibliographyInserted ? "关闭自动参考文献" : "在文尾生成参考文献"}
          aria-pressed={bibliographyInserted}
          onClick={() => toggleAutomaticBibliography(editor)}
        >
          <BookOpen size={18} strokeWidth={1.9} aria-hidden="true" />
          <span>参考</span>
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
          <MenuItem icon={Quote} label={editor?.isActive("blockquote") ? "取消引文" : "引文"} checked={Boolean(editor?.isActive("blockquote"))} onClick={() => runMenuAction(() => insertStructuredQuote(editor, savedSelectionRef))} />
          <MenuItem icon={Table2} label="表格" onClick={() => runMenuAction(() => insertBasicTable(editor, savedSelectionRef))} />
          <MenuDivider />
          <MenuItem icon={Minus} label="分割线" onClick={() => runMenuAction(() => insertHorizontalRule(editor, savedSelectionRef))} />
          <MenuItem icon={SeparatorHorizontal} label="分页符" onClick={() => runMenuAction(() => insertPageBreak(editor, savedSelectionRef))} />
          <MenuDivider />
          <MenuItem icon={Link2} label="关联信笺" onClick={() => runMenuAction(onInsertInternalLink)} />
          <MenuItem icon={Hash} label="脚注" onClick={() => runMenuAction(onInsertFootnote)} />
          <MenuItem icon={BookOpen} label="文献引用" onClick={() => runMenuAction(onOpenCitationPicker)} />
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
  const activeIllustrations = helpIllustrationsFor(activeTopic);
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
      <div className="help-center-overlay dialog-scrim dialog-scrim--large" role="presentation" onMouseDown={onClose}>
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
            <div className="help-illustration-list">
              {activeIllustrations.map((illustration, index) => (
                <HelpIllustration
                  key={illustration.type}
                  type={illustration.type}
                  alt={illustration.alt}
                  caption={illustration.caption}
                  onPreview={(src) => setImagePreview({
                    src,
                    alt: illustration.alt,
                    caption: illustration.caption,
                    title: activeIllustrations.length > 1
                      ? `${activeTopic.title} · ${index + 1}/${activeIllustrations.length}`
                      : activeTopic.title,
                  })}
                />
              ))}
            </div>
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
        <div className="help-image-preview-overlay dialog-scrim dialog-scrim--large" role="presentation" onMouseDown={() => setImagePreview(null)}>
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

function ExportDialog({ open, documentTitle, onClose, onExportPdf, onExportImages, onExportEditable }) {
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
      const result = await bridge.pickExportPath?.(format, documentTitle, loadRememberedExportDirectory());
      if (!result?.canceled && result?.path) {
        setTargetPath(result.path);
        rememberExportDirectory(result.directory);
        setProgressMessage(format === "pdf" ? "PDF 将保存到所选位置" : (format === "images" ? "分页图片将保存到所选文件夹" : "可编辑文档将保存到所选位置"));
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
        : (format === "images" ? await onExportImages(targetPath) : await onExportEditable(format, targetPath));
      if (result?.canceled) {
        setStatus("idle");
        setProgress(0);
        setProgressMessage("导出已取消");
        return;
      }
      setProgress(100);
      setProgressMessage(format === "pdf" ? "PDF 导出完成" : (format === "images" ? `已导出 ${result?.count || 0} 张分页图片` : `${format.toUpperCase()} 导出完成`));
      setStatus("success");
    } catch (exportError) {
      setStatus("error");
      setError(exportError?.message || "导出失败，请检查保存位置后重试");
      setProgressMessage("导出未完成");
    }
  };

  const content = (
    <div className="export-dialog-overlay dialog-scrim" role="presentation" onMouseDown={() => { if (!busy) onClose(); }}>
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
            <legend>版式输出</legend>
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
          <fieldset className="export-format-fieldset export-editable-fieldset" disabled={busy}>
            <legend>可编辑交换</legend>
            <div className="export-format-options export-editable-options">
              {[
                { id: "docx", title: "DOCX", detail: "内嵌图片，适合 Word 继续编辑" },
                { id: "markdown", title: "Markdown", detail: "图片写入同名 .assets 目录" },
                { id: "html", title: "HTML", detail: "语义化 UTF-8 文档" },
                { id: "txt", title: "TXT", detail: "仅保留纯文本与脚注引用" },
              ].map((option) => (
                <label key={option.id} className={format === option.id ? "selected" : ""}>
                  <input type="radio" name="export-format" value={option.id} checked={format === option.id} onChange={() => updateFormat(option.id)} />
                  <span className="export-format-icon"><FileText size={20} strokeWidth={1.8} /></span>
                  <span><strong>{option.title}</strong><small>{option.detail}</small></span>
                  <i aria-hidden="true" />
                </label>
              ))}
            </div>
            <small className="export-format-note">通用导出不包含批注和 AI 记录；脚注与引用会正确输出，参考文献由顶部“参考”开关决定。视觉保真请使用 PDF。</small>
          </fieldset>

          <div className="export-path-field">
            <label htmlFor="export-target-path">导出路径</label>
            <div className="export-path-control">
              <input
                id="export-target-path"
                type="text"
                readOnly
                value={targetPath}
                placeholder={format === "pdf" ? "请选择 PDF 文件的保存位置" : (format === "images" ? "请选择分页图片的保存文件夹" : "请选择可编辑文档的保存位置")}
                title={targetPath}
              />
              <button type="button" onClick={handleChoosePath} disabled={busy}>
                <FolderOpen size={16} strokeWidth={1.9} />
                <span>选择位置</span>
              </button>
            </div>
            <small>{format === "pdf" ? "文件扩展名会自动补全为 .pdf" : (format === "images" ? "图片将以“信笺名-01.png”的方式连续命名" : "文件扩展名会按所选格式自动补全")}；选择位置时会打开上次使用的导出目录</small>
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

function helpIllustrationsFor(topic) {
  if (!topic) return [];
  return [
    {
      type: topic.illustration,
      alt: topic.illustrationAlt,
      caption: topic.illustrationCaption,
    },
    ...(Array.isArray(topic.illustrations) ? topic.illustrations : []),
  ];
}

function HelpIllustration({ type, alt, caption, onPreview }) {
  const src = HELP_SCREENSHOTS[type] || HELP_SCREENSHOTS["files-sidebar"];
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
  const handleFolderClick = useCallback((path) => {
    if (onConsumeDragClick()) {
      return;
    }
    onToggleFolder(path);
  }, [onConsumeDragClick, onToggleFolder]);

  const navigateFolder = useCallback((path) => {
    if (onConsumeDragClick()) return;
    onOpenFolderPath(path);
  }, [onConsumeDragClick, onOpenFolderPath]);

  return (
    <HierarchicalTreeRows
      entries={entries}
      depth={depth}
      getKey={(entry) => entry.path}
      isBranch={(entry) => entry.type === "folder"}
      isExpanded={(entry) => Boolean(expandedFolders[entry.path]?.expanded)}
      getBranchState={(entry) => expandedFolders[entry.path] || { expanded: false, loading: false, entries: [] }}
      getChildren={(_entry, state) => state.entries || []}
      getGroupLabel={({ entry }) => `${entry.name} 的内容`}
      wrapperClassName={({ branch }) => branch ? "folder-tree-group" : "folder-tree-leaf"}
      childrenClassName="folder-tree-children"
      renderRow={({ entry, depth: rowDepth, branch, expanded }) => branch ? (
          <div
            className={dragTargetPath === entry.path ? "folder-tree-row folder-entry drag-target" : "folder-tree-row folder-entry"}
            style={{ "--tree-depth": rowDepth }}
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
            <TreeItemButton
              className={dragTargetPath === entry.path ? "folder-entry-main drag-target" : "folder-entry-main"}
              branch
              expanded={expanded}
              depth={rowDepth}
              data-drop-folder-path={entry.path}
              onActivate={() => handleFolderClick(entry.path)}
              onToggle={(nextExpanded) => {
                if (nextExpanded !== expanded) onToggleFolder(entry.path);
              }}
              onNavigate={() => navigateFolder(entry.path)}
              onContextMenu={(event) => onContextMenu(event, entry)}
              onPointerDown={(event) => onDragPointerDown(event, entry)}
              title={`${entry.name}（单击展开/收起，双击或按 Enter 进入）`}
            >
              <img
                className="asset-icon folder-asset-icon"
                src={entry.hasLetterpapers === false ? ICON_ASSETS.goldFolderEmpty : ICON_ASSETS.goldFolderFull}
                alt=""
                aria-hidden="true"
              />
              <span>{entry.name}</span>
            </TreeItemButton>
          </div>
      ) : (
      <TreeItemButton
        type="button"
        className={entry.path === currentPath ? "folder-tree-row file-entry active" : "folder-tree-row file-entry"}
        style={{ "--tree-depth": rowDepth }}
        depth={rowDepth}
        selected={entry.path === currentPath}
        onActivate={() => {
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
      </TreeItemButton>
      )}
      renderBranchState={(status, { depth: branchDepth, state }) => (
        <p
          className="folder-tree-hint"
          style={{ "--tree-depth": branchDepth + 1 }}
          role={status === "loading" ? "status" : status === "error" ? "alert" : undefined}
        >
          {status === "loading" ? "读取中..." : status === "error" ? (state.error || "文件夹读取失败") : "空文件夹"}
        </p>
      )}
    />
  );
}

function LiveOutlineSidebar({ editor, renderStructurePanel, ...props }) {
  const outlineItems = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getPaperDerivedState(activeEditor).outlineItems,
  }) || [];
  const structurePanel = typeof renderStructurePanel === "function"
    ? renderStructurePanel(outlineItems)
    : props.structurePanel;
  return <LeftSidebar {...props} structurePanel={structurePanel} outlineItems={outlineItems} />;
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
  researchPanel,
  structurePanel,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [dragState, setDragState] = useState(null);
  const dragSuppressClickRef = useRef(false);
  const folderEntries = folderState.entries || [
    ...(folderState.folders || []),
    ...(folderState.files || []),
  ];
  const visibleParentPath = folderState.parentPath
    && (!folderState.rootPath || pathIsSameOrInside(folderState.parentPath, folderState.rootPath))
    ? folderState.parentPath
    : "";

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
              role="tab"
              aria-selected={mode === "folder"}
            >
              <img
                className="sidebar-mode-icon"
                src={ICON_ASSETS.sidebarFolderTreeMode}
                alt=""
                aria-hidden="true"
              />
              <span>文件</span>
            </button>
            <button
              type="button"
              className={mode === "research" ? "active" : ""}
              onClick={() => onModeChange("research")}
              role="tab"
              aria-selected={mode === "research"}
            >
              <BookOpen className="sidebar-mode-lucide" size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>资料</span>
            </button>
            <button
              type="button"
              className={mode === "structure" ? "active" : ""}
              onClick={() => onModeChange("structure")}
              role="tab"
              aria-selected={mode === "structure"}
            >
              <img
                className="sidebar-mode-icon"
                src={ICON_ASSETS.sidebarOutlineMode}
                alt=""
                aria-hidden="true"
              />
              <span>结构</span>
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
                    <small>{folderState.path}</small>
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
                {visibleParentPath ? (
                  <button
                    type="button"
                    className="folder-tree-row parent-entry"
                    style={{ "--tree-depth": 0 }}
                    onClick={() => onOpenFolderPath(visibleParentPath)}
                    title="返回上级文件夹"
                  >
                    <span className="folder-disclosure-spacer" />
                    <img className="asset-icon folder-asset-icon" src={ICON_ASSETS.goldFolderEmpty} alt="" aria-hidden="true" />
                    <span>...</span>
                  </button>
                ) : null}
                <div className="folder-entry-scroll" role="tree" aria-label="当前文件夹的信笺树">
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
        ) : mode === "research" ? (
          researchPanel
        ) : structurePanel || (
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

function TemplateSelect({ ariaLabel, value, options, onChange, disabled = false, invalid = false, className = "" }) {
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
    <div ref={rootRef} className={["template-select", open ? "open" : "", invalid ? "invalid" : "", className].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        className="template-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
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

function AppInfoTooltip({ id, label, text, className = "" }) {
  return (
    <button
      type="button"
      className={["app-info-tooltip-trigger", className].filter(Boolean).join(" ")}
      aria-label={label}
      aria-describedby={id}
    >
      <Info size={15} aria-hidden="true" />
      <span id={id} className="app-info-tooltip-bubble" role="tooltip">{text}</span>
    </button>
  );
}

function AiRequestParamsEditor({
  rows = [],
  onChange,
  providerId = "",
  disabled = false,
  compact = false,
  flat = false,
  title = "请求参数",
  description = "以 Key-Value 形式附加到模型请求体。",
}) {
  const parsed = useMemo(() => parseAiRequestParamRows(rows, { providerId }), [providerId, rows]);
  const [expandedJsonRows, setExpandedJsonRows] = useState(() => new Set());

  const updateRow = useCallback((rowId, patch) => {
    onChange(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }, [onChange, rows]);

  const addRow = useCallback(() => {
    onChange([...rows, createAiRequestParamRow()]);
  }, [onChange, rows]);

  const toggleJsonRow = useCallback((row) => {
    const expanded = expandedJsonRows.has(row.id);
    let valueText = row.valueText;
    try {
      valueText = JSON.stringify(JSON.parse(row.valueText), null, expanded ? 0 : 2);
    } catch {
      // Keep malformed drafts untouched so users can repair them in the expanded editor.
    }
    updateRow(row.id, { valueText });
    setExpandedJsonRows((current) => {
      const next = new Set(current);
      if (expanded) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, [expandedJsonRows, updateRow]);

  return (
    <section className={["ai-request-params-editor", compact ? "compact" : "", flat ? "flat" : "", disabled ? "disabled" : ""].filter(Boolean).join(" ")}>
      <header className="ai-request-params-head">
        <div>
          <strong>{title}</strong>
          {description ? <span>{description}</span> : null}
        </div>
        <button
          type="button"
          className="ai-request-param-add-button"
          disabled={disabled || rows.length >= 64}
          aria-label={`为${title}添加参数`}
          onClick={addRow}
        >
          <Plus size={14} aria-hidden="true" />
          <span>添加参数</span>
        </button>
      </header>
      {rows.length ? (
        <div className="ai-request-param-list">
          <div className="ai-request-param-columns" aria-hidden="true">
            <span>参数名</span><span>类型</span><span>参数值</span><span />
          </div>
          {rows.map((row, index) => {
            const rowError = parsed.errors[row.id];
            const rowHint = row.hint || aiRequestParamPreset(providerId, row.key)?.hint || "";
            return (
              <div key={row.id} className={rowError ? "ai-request-param-row invalid" : "ai-request-param-row"}>
                <div className="ai-request-param-key-field">
                  {rowHint ? (
                    <AppInfoTooltip
                      id={`ai-request-param-tip-${row.id}`}
                      className="ai-request-param-info"
                      label={`查看 ${row.key || `参数 ${index + 1}`} 的说明`}
                      text={rowHint}
                    />
                  ) : <span className="ai-request-param-info-spacer" aria-hidden="true" />}
                  <input
                    value={row.key}
                    disabled={disabled}
                    aria-label={`${title}参数 ${index + 1} 名称`}
                    aria-invalid={Boolean(rowError) || undefined}
                    placeholder="例如：temperature"
                    spellCheck={false}
                    onChange={(event) => updateRow(row.id, { key: event.target.value, hint: "" })}
                  />
                  {rowError ? <small className="ai-request-param-error" role="alert">{rowError}</small> : null}
                </div>
                <TemplateSelect
                  ariaLabel={`${row.key || `参数 ${index + 1}`}类型`}
                  value={row.type}
                  options={AI_REQUEST_PARAM_TYPE_OPTIONS}
                  disabled={disabled}
                  className="ai-request-param-type-select"
                  onChange={(type) => updateRow(row.id, {
                    type,
                    valueText: type === "boolean" && !["true", "false"].includes(row.valueText) ? "true" : row.valueText,
                  })}
                />
                {row.type === "boolean" ? (
                  <TemplateSelect
                    ariaLabel={`${row.key || `参数 ${index + 1}`}值`}
                    value={["true", "false"].includes(row.valueText) ? row.valueText : "true"}
                    options={AI_REQUEST_PARAM_BOOLEAN_OPTIONS}
                    disabled={disabled}
                    className="ai-request-param-value-select"
                    onChange={(valueText) => updateRow(row.id, { valueText })}
                  />
                ) : row.type === "json" ? (
                  <div className={`ai-request-param-json-field${expandedJsonRows.has(row.id) ? " expanded" : ""}`}>
                    {expandedJsonRows.has(row.id) ? (
                      <textarea
                        value={row.valueText}
                        disabled={disabled}
                        aria-label={`${row.key || `参数 ${index + 1}`}JSON 值`}
                        aria-invalid={Boolean(rowError) || undefined}
                        placeholder='例如：{"type":"enabled"}'
                        spellCheck={false}
                        rows={compact ? 4 : 5}
                        onChange={(event) => updateRow(row.id, { valueText: event.target.value })}
                      />
                    ) : (
                      <input
                        value={row.valueText}
                        disabled={disabled}
                        aria-label={`${row.key || `参数 ${index + 1}`}JSON 值`}
                        aria-invalid={Boolean(rowError) || undefined}
                        placeholder='例如：{"type":"enabled"}'
                        spellCheck={false}
                        onChange={(event) => updateRow(row.id, { valueText: event.target.value })}
                      />
                    )}
                    <button
                      type="button"
                      className="ai-request-param-json-toggle"
                      disabled={disabled}
                      aria-label={`${expandedJsonRows.has(row.id) ? "收起" : "展开"} ${row.key || `参数 ${index + 1}`} JSON 编辑器`}
                      onClick={() => toggleJsonRow(row)}
                    >
                      {expandedJsonRows.has(row.id) ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                  </div>
                ) : (
                  <input
                    className="ai-request-param-value-input"
                    value={row.valueText}
                    disabled={disabled}
                    aria-label={`${row.key || `参数 ${index + 1}`}值`}
                    aria-invalid={Boolean(rowError) || undefined}
                    inputMode={row.type === "number" ? "decimal" : undefined}
                    placeholder={row.type === "number" ? "例如：1" : "参数值"}
                    spellCheck={false}
                    onChange={(event) => updateRow(row.id, { valueText: event.target.value })}
                  />
                )}
                <button
                  type="button"
                  className="ai-request-param-remove"
                  disabled={disabled}
                  aria-label={`删除参数 ${row.key || index + 1}`}
                  title="删除参数"
                  onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ai-request-params-empty">尚未添加请求参数，将使用服务商默认行为。</div>
      )}
      {parsed.error ? <p className="ai-request-params-message error" role="alert">{parsed.error}</p> : null}
    </section>
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

function dialogFocusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll(
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

function LetterTemplateDialog({
  document,
  letterTemplates,
  defaultTemplates,
  userTemplates,
  userTemplateGroups,
  newDocumentTemplateId,
  embedded = false,
  mode = "apply",
  returnFocusRef,
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
  const manageOnly = mode === "manage";
  const selectionOnly = mode === "select";
  const selectedLetterTemplate = getLetterTemplate(document, letterTemplates);
  const [detailTemplateId, setDetailTemplateId] = useState(() => (selectionOnly || manageOnly ? "" : selectedLetterTemplate.id));
  const [pendingDeleteTemplateId, setPendingDeleteTemplateId] = useState("");
  const [pendingDeleteGroupId, setPendingDeleteGroupId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(() => (
    manageOnly ? SYSTEM_TEMPLATE_GROUPS[0].id : getLetterTemplateGroupId(selectedLetterTemplate)
  ));
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
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const detailTemplate = draftTemplate || letterTemplates.find((template) => template.id === detailTemplateId);
  const detailIsDraft = Boolean(draftTemplate);
  const detailEditable = Boolean(detailTemplate?.userTemplate && !selectionOnly);
  const detailIsActive = !manageOnly && !detailIsDraft && detailTemplate?.id === selectedLetterTemplate.id;
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
    if (embedded) return undefined;
    const previouslyFocused = window.document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const focusTarget = returnFocusRef?.current || previouslyFocused;
      if (focusTarget instanceof HTMLElement && focusTarget.isConnected) {
        focusTarget.focus({ preventScroll: true });
      }
    };
  }, [embedded, returnFocusRef]);

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
    <div className="template-group-dialog-backdrop dialog-scrim" role="presentation">
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
    <div className="template-group-dialog-backdrop dialog-scrim" role="presentation">
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
    const isReorderable = !selectionOnly && isUserGroup && group.id !== BASE_USER_TEMPLATE_GROUP_ID;
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
        {!selectionOnly && isUserGroup && group.id !== BASE_USER_TEMPLATE_GROUP_ID ? (
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
    const isActive = !manageOnly && selectedLetterTemplate.id === letterTemplate.id;
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
        {!selectionOnly && letterTemplate.userTemplate ? (
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
    if (!detailTemplate?.userTemplate || selectionOnly) {
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
    if (!detailTemplate?.userTemplate || selectionOnly) {
      return;
    }
    updateDetailTemplate({ typography: { ...detailTemplate.typography, ...patch } });
  };

  const updatePresentation = (patch) => {
    if (!detailTemplate?.userTemplate || selectionOnly) {
      return;
    }
    updateDetailTemplate({
      presentation: normalizeTemplatePresentation({ ...detailTemplate.presentation, ...patch }),
    });
  };

  const changeDetailTemplateGroup = (groupId, shouldInclude) => {
    if (!detailTemplate?.userTemplate || selectionOnly || groupId === BASE_USER_TEMPLATE_GROUP_ID) {
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
      if (!embedded && event.key === "Tab") {
        const elements = dialogFocusableElements(dialogRef.current);
        if (!elements.length) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && window.document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && window.document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (!dialogRef.current?.contains(window.document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "Escape" && !window.document.querySelector(".template-select.open")) {
        let handled = true;
        if (editingGroupId) {
          cancelGroupEditing();
        } else if (groupPickerOpen) {
          setGroupPickerOpen(false);
        } else if (pendingDeleteGroupId) {
          setPendingDeleteGroupId("");
        } else if (pendingDeleteTemplateId) {
          setPendingDeleteTemplateId("");
        } else if (detailTemplateId) {
          setDetailTemplateId("");
        } else if (!embedded) {
          onClose?.();
        } else {
          handled = false;
        }
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [detailTemplateId, editingGroupId, embedded, groupPickerOpen, onClose, pendingDeleteGroupId, pendingDeleteTemplateId]);

  const content = (
    <div
      className={embedded ? "template-dialog-embed" : "template-dialog-overlay dialog-scrim dialog-scrim--large"}
      role="presentation"
      onPointerDown={embedded ? undefined : (event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        ref={dialogRef}
        className={embedded ? "template-dialog settings-embedded" : "template-dialog"}
        role={embedded ? "region" : "dialog"}
        aria-modal={embedded ? undefined : "true"}
        aria-label={selectionOnly ? "选择模板" : manageOnly ? "模板设置" : "信笺模板"}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {!embedded ? (
          <button
            ref={closeButtonRef}
            type="button"
            className="template-dialog-global-close"
            onClick={onClose}
            aria-label={selectionOnly ? "关闭模板选择" : manageOnly ? "关闭模板配置" : "关闭信笺模板"}
            title="关闭"
          >
            <X size={20} strokeWidth={2.2} />
          </button>
        ) : null}
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
              <h2>{selectionOnly ? "选择模板" : manageOnly ? "模板设置" : "信笺模板"}</h2>
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
                {!selectionOnly && !detailIsDraft ? (
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
                  {detailEditable ? (
                    <TemplateNameInput
                      value={detailTemplate.label}
                      onChange={(label) => updateDetailTemplate({ label })}
                      error={templateNameError}
                    />
                  ) : (
                    <strong>{detailTemplate.label}</strong>
                  )}
                  <div
                    className="template-detail-badges"
                    aria-label={`${detailTemplate.userTemplate ? "用户模板" : "系统模板"}，${detailEditable ? "可编辑" : "不可修改"}`}
                  >
                    <span className={detailTemplate.userTemplate ? "user" : "system"}>
                      {detailTemplate.userTemplate ? "用户模板" : "系统模板"}
                    </span>
                    <span className={detailEditable ? "editable" : "readonly"}>
                      {detailEditable ? "可编辑" : "不可修改"}
                    </span>
                    {detailIsActive ? <span className="current">当前使用</span> : null}
                  </div>
                </div>

                <div className="template-edit-row template-paper-row">
                  <span>信纸背景</span>
                  {detailEditable ? (
                    <TemplatePaperPicker
                      value={detailTemplate.paperId}
                      groups={paperPickerGroups}
                      onChange={(paperId) => updateDetailTemplate({ paperId })}
                    />
                  ) : (
                    <em>{detailPaper.label}</em>
                  )}
                </div>

                {detailEditable ? (
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

                {detailEditable ? (
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
                      {detailEditable ? (
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
                            disabled={!detailEditable}
                            onChange={(showDocumentTitle) => updatePresentation({ showDocumentTitle })}
                          />
                        </div>
                        <div className="template-advanced-control-row">
                          <span><strong>署名与日期</strong><small>显示作者署名和写作日期</small></span>
                          <TemplateSettingSwitch
                            checked={detailPresentation.showSignatureDate}
                            label="显示署名与日期"
                            disabled={!detailEditable}
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
                            disabled={!detailEditable}
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
                                disabled={!detailEditable}
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
                              disabled={!detailEditable}
                              onChange={(color) => updatePresentation({
                                headingColors: { ...detailPresentation.headingColors, [level]: color },
                              })}
                            />
                            <span className="template-heading-numbering-label">默认编号</span>
                            <TemplateSettingSwitch
                              checked={detailPresentation.headingNumbering[level]}
                              label={`${level}级标题默认编号`}
                              disabled={!detailEditable}
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
                            disabled={!detailEditable}
                            onChange={(showImageCaptions) => updatePresentation({ showImageCaptions })}
                          />
                        </div>
                        <div className={`template-advanced-control-row${!detailPresentation.showImageCaptions ? " disabled" : ""}`}>
                          <span><strong>显示图片编号</strong><small>在标题前显示“图N.”</small></span>
                          <TemplateSettingSwitch
                            checked={detailPresentation.numberImageCaptions}
                            label="显示图片标题编号"
                            disabled={!detailEditable || !detailPresentation.showImageCaptions}
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
                      {!manageOnly ? (
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
                      ) : null}
                      {!selectionOnly ? (
                        <>
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
                  {!selectionOnly ? (
                    <button
                      type="button"
                      onClick={beginCreateGroup}
                      aria-label="新建用户分组"
                      title="新建分组"
                    >
                      <Plus size={16} />
                    </button>
                  ) : null}
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
                {!selectionOnly && selectedUserGroup && selectedGroupTemplates.length ? (
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
                  <span>{selectionOnly ? "请选择其他分组。" : "可以从当前信笺模板创建一个可编辑副本。"}</span>
                  {!selectionOnly ? (
                    <button
                      type="button"
                      className="template-create-button"
                      onClick={() => beginCreateTemplate(selectedLetterTemplate, selectedGroup.id)}
                    >
                      <Plus size={15} />
                      <span>在此新建模板</span>
                    </button>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        )}
        </section>
        {!selectionOnly ? renderTemplateDeleteDialog() : null}
        {!selectionOnly ? renderGroupDialog() : null}
      </section>
      {!selectionOnly && groupDragState ? (
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

  return embedded ? content : createPortal(content, window.document.body);
}

function estimateAuthorWidth(author) {
  const value = author || "署名";
  const width = Array.from(value).reduce((total, character) => (
    total + (/[\u3400-\u9fff]/.test(character) ? 1.05 : 0.56)
  ), 0);
  return `${Math.max(0.76, Math.min(12, width + 0.2))}em`;
}

function PageArticle({ document, selectedTemplate, presentation = DEFAULT_TEMPLATE_PRESENTATION, paperStyle, children, className = "", showHeader = false, customHeaderLayout = false, onTitleChange, onAuthorChange, onDateChange }) {
  const authorText = document.author?.trim() || "";
  const authorWidth = estimateAuthorWidth(authorText);
  const displayDate = document.displayDate || formatPaperDate(document.createdAt);
  const normalizedPresentation = normalizeTemplatePresentation(presentation);
  const showDocumentTitle = showHeader && normalizedPresentation.showDocumentTitle;
  const showSignatureDate = showHeader && normalizedPresentation.showSignatureDate;
  const hasVisibleHeader = showDocumentTitle || showSignatureDate;
  const usesHeaderLayout = hasVisibleHeader || customHeaderLayout;
  const presentationClasses = [
    usesHeaderLayout ? "has-paper-header" : "without-paper-header",
    showDocumentTitle ? "shows-document-title" : "hides-document-title",
    showSignatureDate ? "shows-signature-date" : "hides-signature-date",
    normalizedPresentation.indentParagraphs ? "indents-paragraphs" : "flush-paragraphs",
    normalizedPresentation.showImageCaptions ? "shows-image-captions" : "hides-image-captions",
    normalizedPresentation.numberImageCaptions ? "numbers-image-captions" : "plain-image-captions",
  ];

  return (
    <article
      className={`paper-sheet template-${document.customBackground ? "custom" : document.templateId} ${presentationClasses.join(" ")} ${className}`}
      data-paper-document-id={normalizeDocumentId(document.documentId)}
      style={paperStyle}
    >
      {hasVisibleHeader ? (
        <header className="paper-header">
          {showDocumentTitle ? (
            <input
              className="paper-title-input"
              value={document.title}
              onChange={(event) => onTitleChange?.(event.target.value)}
              maxLength={DOCUMENT_TITLE_MAX_CHARS}
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
  const toolbarFrameRef = useRef(0);
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
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setToolbarPosition(null);
      return;
    }
    if (selectionTouchesNodeType(editor, "paperTableOfContents")) {
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

  const scheduleToolbarPosition = useCallback(() => {
    if (toolbarFrameRef.current) return;
    toolbarFrameRef.current = window.requestAnimationFrame(() => {
      toolbarFrameRef.current = 0;
      updateToolbarPosition();
    });
  }, [updateToolbarPosition]);

  useEffect(() => {
    if (!editor || disabled) {
      setToolbarPosition(null);
      return undefined;
    }
    const hideWhenPointingAtToc = (event) => {
      if (event.target instanceof Element && event.target.closest("[data-type='paper-toc'], .node-paperTableOfContents")) {
        savedSelectionRef.current = null;
        setToolbarPosition(null);
      }
    };
    document.addEventListener("pointerdown", hideWhenPointingAtToc, true);
    document.addEventListener("selectionchange", scheduleToolbarPosition);
    document.addEventListener("scroll", scheduleToolbarPosition, true);
    document.addEventListener("keyup", scheduleToolbarPosition, true);
    editor.view.dom.addEventListener("mouseup", scheduleToolbarPosition);
    editor.view.dom.addEventListener("keyup", scheduleToolbarPosition);
    editor.on("selectionUpdate", scheduleToolbarPosition);
    editor.on("transaction", scheduleToolbarPosition);
    scheduleToolbarPosition();
    return () => {
      if (toolbarFrameRef.current) {
        window.cancelAnimationFrame(toolbarFrameRef.current);
        toolbarFrameRef.current = 0;
      }
      document.removeEventListener("selectionchange", scheduleToolbarPosition);
      document.removeEventListener("pointerdown", hideWhenPointingAtToc, true);
      document.removeEventListener("scroll", scheduleToolbarPosition, true);
      document.removeEventListener("keyup", scheduleToolbarPosition, true);
      editor.view.dom.removeEventListener("mouseup", scheduleToolbarPosition);
      editor.view.dom.removeEventListener("keyup", scheduleToolbarPosition);
      editor.off("selectionUpdate", scheduleToolbarPosition);
      editor.off("transaction", scheduleToolbarPosition);
    };
  }, [disabled, editor, savedSelectionRef, scheduleToolbarPosition]);

  const runSelectionCommand = useCallback(
    (command) => {
      if (!editor || disabled) {
        return;
      }
      runEditorCommand(editor, savedSelectionRef, command);
      scheduleToolbarPosition();
    },
    [disabled, editor, savedSelectionRef, scheduleToolbarPosition],
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
    scheduleToolbarPosition();
  }, [aiCaptureEnabled, disabled, editor, onCaptureAiSelection, savedSelectionRef, scheduleToolbarPosition]);

  const handleCreateComment = useCallback(() => {
    if (!editor || disabled || !onCreateComment) {
      return;
    }
    onCreateComment?.(getSelectedPlainText(editor, savedSelectionRef), toolbarPosition);
    scheduleToolbarPosition();
  }, [disabled, editor, onCreateComment, savedSelectionRef, scheduleToolbarPosition, toolbarPosition]);

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
  const normalizedComments = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getDocumentComments(activeEditor, comments),
  }) || normalizeDocumentComments(comments);
  const [positions, setPositions] = useState([]);
  const positionFrameRef = useRef(0);
  const clearPositions = useCallback(() => {
    setPositions((current) => (current.length ? [] : current));
  }, []);

  const updatePositions = useCallback(() => {
    if (!editor?.view || hidden || !normalizedComments.length) {
      clearPositions();
      return;
    }
    const sheet = editor.view.dom.closest(".paper-sheet");
    if (!sheet) {
      clearPositions();
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
  }, [clearPositions, editor, hidden, normalizedComments]);

  useEffect(() => {
    if (!editor?.view || hidden || !normalizedComments.length) {
      clearPositions();
      return undefined;
    }
    const updateSoon = () => {
      if (positionFrameRef.current) return;
      positionFrameRef.current = window.requestAnimationFrame(() => {
        positionFrameRef.current = 0;
        updatePositions();
      });
    };
    document.addEventListener("scroll", updateSoon, true);
    window.addEventListener("resize", updateSoon);
    editor.on("transaction", updateSoon);
    updateSoon();
    return () => {
      if (positionFrameRef.current) {
        window.cancelAnimationFrame(positionFrameRef.current);
        positionFrameRef.current = 0;
      }
      document.removeEventListener("scroll", updateSoon, true);
      window.removeEventListener("resize", updateSoon);
      editor.off("transaction", updateSoon);
    };
  }, [clearPositions, editor, hidden, normalizedComments.length, updatePositions]);

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
      const row = rows.at(-1);
      if (row && Math.abs(row.center - center) < 4) {
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
  const normalizedComments = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getDocumentComments(activeEditor, comments),
  }) || normalizeDocumentComments(comments);
  const [highlights, setHighlights] = useState([]);
  const highlightFrameRef = useRef(0);
  const clearHighlights = useCallback(() => {
    setHighlights((current) => (current.length ? [] : current));
  }, []);

  const updateHighlights = useCallback(() => {
    if (!editor?.view || hidden || !activeCommentId || !normalizedComments.length) {
      clearHighlights();
      return;
    }
    const sheet = editor.view.dom.closest(".paper-sheet");
    if (!sheet) {
      clearHighlights();
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
  }, [activeCommentId, clearHighlights, editor, hidden, normalizedComments]);

  useEffect(() => {
    if (!editor?.view || hidden || !activeCommentId || !normalizedComments.length) {
      clearHighlights();
      return undefined;
    }
    const updateSoon = () => {
      if (highlightFrameRef.current) return;
      highlightFrameRef.current = window.requestAnimationFrame(() => {
        highlightFrameRef.current = 0;
        updateHighlights();
      });
    };
    document.addEventListener("scroll", updateSoon, true);
    window.addEventListener("resize", updateSoon);
    editor.on("transaction", updateSoon);
    updateSoon();
    return () => {
      if (highlightFrameRef.current) {
        window.cancelAnimationFrame(highlightFrameRef.current);
        highlightFrameRef.current = 0;
      }
      document.removeEventListener("scroll", updateSoon, true);
      window.removeEventListener("resize", updateSoon);
      editor.off("transaction", updateSoon);
    };
  }, [activeCommentId, clearHighlights, editor, hidden, normalizedComments.length, updateHighlights]);

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
  const toolbarFrameRef = useRef(0);

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
    const nextPosition = {
      left: Math.min(window.innerWidth - 16, rect.right - 8),
      top: Math.max(86, rect.top - 8),
    };
    setToolbarPosition((current) => (
      current?.left === nextPosition.left && current?.top === nextPosition.top ? current : nextPosition
    ));
  }, [disabled, editor]);

  const scheduleToolbarPosition = useCallback(() => {
    if (toolbarFrameRef.current) return;
    toolbarFrameRef.current = window.requestAnimationFrame(() => {
      toolbarFrameRef.current = 0;
      updateToolbarPosition();
    });
  }, [updateToolbarPosition]);

  useEffect(() => {
    if (!editor || disabled) {
      setToolbarPosition(null);
      return undefined;
    }
    document.addEventListener("scroll", scheduleToolbarPosition, true);
    document.addEventListener("keyup", scheduleToolbarPosition, true);
    editor.view.dom.addEventListener("mouseup", scheduleToolbarPosition);
    editor.view.dom.addEventListener("keyup", scheduleToolbarPosition);
    editor.on("selectionUpdate", scheduleToolbarPosition);
    editor.on("transaction", scheduleToolbarPosition);
    scheduleToolbarPosition();
    return () => {
      if (toolbarFrameRef.current) {
        window.cancelAnimationFrame(toolbarFrameRef.current);
        toolbarFrameRef.current = 0;
      }
      document.removeEventListener("scroll", scheduleToolbarPosition, true);
      document.removeEventListener("keyup", scheduleToolbarPosition, true);
      editor.view.dom.removeEventListener("mouseup", scheduleToolbarPosition);
      editor.view.dom.removeEventListener("keyup", scheduleToolbarPosition);
      editor.off("selectionUpdate", scheduleToolbarPosition);
      editor.off("transaction", scheduleToolbarPosition);
    };
  }, [disabled, editor, scheduleToolbarPosition]);

  const runCommand = useCallback((command) => {
    if (!editor || disabled) {
      return;
    }
    runTableCommand(editor, command);
    scheduleToolbarPosition();
  }, [disabled, editor, scheduleToolbarPosition]);

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
  const customBackground = normalizeCustomBackgroundSource(document.customBackground);
  const customBackgroundCss = toSafeCssImageUrl(customBackground);
  const selectedPaperId = customBackground ? document.templateId : selectedLetterTemplate.paperId;
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
      "--paper-repeat-bg": customBackgroundCss || `url("${selectedTemplate.slices.repeat}")`,
      "--paper-top-bg": customBackground ? "none" : `url("${selectedTemplate.slices.top}")`,
      "--paper-bottom-bg": customBackground ? "none" : `url("${selectedTemplate.slices.bottom}")`,
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

function AiSettingsDialog({ open, embedded = false, returnFocusRef, config, onClose, onSave, onCreateProvider, onDeleteProvider, onTest, onClear, onRefreshCodex, onLoginCodex }) {
  const [activePanel, setActivePanel] = useState("provider");
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
  const [taskParamDrafts, setTaskParamDrafts] = useState({});
  const [taskProviderConfirm, setTaskProviderConfirm] = useState(null);
  const initializedOpenRef = useRef(false);
  const codexAutoCheckRef = useRef(false);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
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
  const modelEditorCapabilities = modelEditor ? aiModelCapabilities(selectedProvider, modelEditor.model) : null;
  const resolverModels = useMemo(() => getTestedAiProviders({
    ...normalizedConfig,
    providers: drafts,
  }), [drafts, normalizedConfig]);
  const resolverProviderGroups = useMemo(() => groupTestedAiProviders(resolverModels, AI_PROVIDER_OPTIONS), [resolverModels]);
  const resolverAssignment = normalizedConfig.taskModels?.applyResolver || { providerId: "", modelId: "", requestParams: {} };
  const resolverModelKey = createAiModelKey(resolverAssignment.providerId, resolverAssignment.modelId);
  const resolverModelConfigured = Boolean(resolverAssignment.providerId && resolverAssignment.modelId);
  const defaultResolverModelKey = createAiModelKey(normalizedConfig.activeProvider, normalizedConfig.activeModelId);
  const resolverModelAvailable = resolverModelConfigured
    ? resolverModels.some((model) => model.id === resolverModelKey)
    : resolverModels.some((model) => model.id === defaultResolverModelKey);
  const resolverModelInvalid = resolverModelConfigured && !resolverModelAvailable;
  const taskModelNavTone = resolverModelAvailable ? "connected" : (resolverModelInvalid ? "failed" : "idle");
  const taskModelNavLabel = resolverModelInvalid
    ? "需重选"
    : (resolverModelConfigured ? "已配置" : (resolverModelAvailable ? "跟随默认" : "待配置"));
  const selectedProviderTaskLabels = useMemo(() => AI_TASK_MODEL_DEFINITIONS
    .filter((task) => normalizedConfig.taskModels?.[task.id]?.providerId === selectedProvider)
    .map((task) => task.label), [normalizedConfig.taskModels, selectedProvider]);

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
    setActivePanel("provider");
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
    const availableModels = getTestedAiProviders(normalized);
    setTaskParamDrafts(Object.fromEntries(AI_TASK_MODEL_DEFINITIONS.map((task) => {
      const assignment = normalized.taskModels?.[task.id] || {};
      const modelConfigured = Boolean(assignment.providerId && assignment.modelId);
      const assignedModel = availableModels.find((model) => model.id === (
        modelConfigured
          ? createAiModelKey(assignment.providerId, assignment.modelId)
          : createAiModelKey(normalized.activeProvider, normalized.activeModelId)
      ));
      const requestParams = assignedModel
        ? aiTaskRequestParamsForEditor(
          assignedModel.provider,
          assignedModel.requestParams,
          assignment.requestParams,
          assignedModel.model,
        )
        : assignment.requestParams;
      const editableRequestParams = task.id === "applyResolver"
        ? aiApplyResolverEditableRequestParams(assignedModel?.provider, requestParams)
        : requestParams;
      return [task.id, requestParamsToRows(editableRequestParams || {})];
    })));
    setTaskProviderConfirm(null);
    codexAutoCheckRef.current = false;
  }, [config, open]);

  useEffect(() => {
    if (!open || embedded) return undefined;
    const previouslyFocused = window.document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const focusTarget = returnFocusRef?.current || previouslyFocused;
      if (focusTarget instanceof HTMLElement && focusTarget.isConnected) {
        focusTarget.focus({ preventScroll: true });
      }
    };
  }, [embedded, open, returnFocusRef]);

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
      if (!embedded && event.key === "Tab") {
        const elements = dialogFocusableElements(dialogRef.current);
        if (!elements.length) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && window.document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && window.document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (!dialogRef.current?.contains(window.document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (taskProviderConfirm) {
          setTaskProviderConfirm(null);
        } else if (modelEditor) {
          setModelEditor(null);
        } else if (deleteConfirm) {
          setDeleteConfirm(false);
        } else if (providerEditor) {
          setProviderEditor(null);
        } else if (providerCreator) {
          setProviderCreator(null);
        } else {
          onClose?.();
        }
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [deleteConfirm, embedded, modelEditor, onClose, open, providerCreator, providerEditor, taskProviderConfirm]);

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

  const saveTaskModelAssignment = useCallback(async (taskId, modelKey, requestParamsOverride) => {
    const model = resolverModels.find((item) => item.id === modelKey);
    if (!model) return;
    const task = AI_TASK_MODEL_DEFINITIONS.find((item) => item.id === taskId);
    const currentAssignment = normalizedConfig.taskModels?.[taskId] || {};
    const requestParams = model.transport === "codex-cli"
      ? {}
      : normalizeUiAiRequestParams(requestParamsOverride ?? currentAssignment.requestParams);
    setBusy(true);
    setStatus(null);
    try {
      const result = await onSave({
        taskModels: {
          [taskId]: { providerId: model.provider, modelId: model.modelId, requestParams },
        },
      });
      const normalized = normalizePublicAiConfig(result);
      setDrafts(normalized.providers);
      const effectiveTaskParams = aiTaskRequestParamsForEditor(
        model.provider,
        model.requestParams,
        normalized.taskModels?.[taskId]?.requestParams || {},
        model.model,
      );
      const editableTaskParams = taskId === "applyResolver"
        ? aiApplyResolverEditableRequestParams(model.provider, effectiveTaskParams)
        : effectiveTaskParams;
      setTaskParamDrafts((current) => ({
        ...current,
        [taskId]: requestParamsToRows(editableTaskParams),
      }));
      setStatus({ tone: "success", message: `${task?.label || "任务"}模型已更新` });
    } catch (error) {
      setStatus({ tone: "warning", message: error?.message || "任务模型保存失败" });
    } finally {
      setBusy(false);
    }
  }, [normalizedConfig.taskModels, onSave, resolverModels]);

  const requestTaskProviderChange = useCallback((taskId, providerId) => {
    const provider = resolverProviderGroups.find((item) => item.id === providerId);
    const model = provider?.models[0];
    if (!model) return;
    const assignment = normalizedConfig.taskModels?.[taskId] || {};
    const hasTaskOverrides = Object.keys(normalizeUiAiRequestParams(assignment.requestParams)).length > 0;
    if (assignment.providerId && assignment.providerId !== providerId && hasTaskOverrides) {
      setTaskProviderConfirm({ taskId, modelKey: model.id, providerLabel: provider.label });
      return;
    }
    saveTaskModelAssignment(taskId, model.id, assignment.providerId === providerId ? assignment.requestParams : {});
  }, [normalizedConfig.taskModels, resolverProviderGroups, saveTaskModelAssignment]);

  const confirmTaskProviderChange = useCallback(async () => {
    if (!taskProviderConfirm) return;
    const { taskId, modelKey } = taskProviderConfirm;
    setTaskProviderConfirm(null);
    setTaskParamDrafts((current) => ({ ...current, [taskId]: [] }));
    await saveTaskModelAssignment(taskId, modelKey, {});
  }, [saveTaskModelAssignment, taskProviderConfirm]);

  const saveTaskRequestParams = useCallback(async (taskId, assignedModel) => {
    if (!assignedModel || assignedModel.transport === "codex-cli") return;
    const rows = taskParamDrafts[taskId] || [];
    const parsed = parseAiRequestParamRows(rows, { providerId: assignedModel.provider });
    if (!parsed.valid) {
      setStatus({ tone: "warning", message: parsed.error || "请先修正请求参数" });
      return;
    }
    await saveTaskModelAssignment(taskId, assignedModel.id, parsed.requestParams);
  }, [saveTaskModelAssignment, taskParamDrafts]);

  const openBaseModelSettings = useCallback(() => {
    const provider = drafts[normalizedConfig.activeProvider]
      ? normalizedConfig.activeProvider
      : (Object.keys(drafts)[0] || "gemini");
    const providerDraft = drafts[provider] || normalizePublicAiProviderConfig(provider);
    setSelectedProvider(provider);
    setSelectedModelId(providerDraft.activeModelId || providerDraft.models[0]?.id || "");
    setActivePanel("provider");
    setStatus(null);
  }, [drafts, normalizedConfig.activeProvider]);

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

  const saveModelReasoningEffort = useCallback(async (model, reasoningEffort) => {
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
        setActivePanel("provider");
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
    const affectedTasks = selectedProviderTaskLabels.join("、");
    setBusy(true);
    try {
      const result = await onDeleteProvider(selectedProvider);
      const normalized = normalizePublicAiConfig(result);
      setDrafts(normalized.providers);
      setSelectedProvider(normalized.activeProvider);
      setSelectedModelId(normalized.activeModelId);
      setStatus(affectedTasks
        ? { tone: "warning", message: `${affectedTasks}的任务模型已失效，请重新选择` }
        : { tone: "success", message: result?.message || "供应商已删除" });
      setDeleteConfirm(false);
    } catch (error) {
      setStatus({ tone: "warning", message: error?.message || "删除供应商失败" });
    } finally {
      setBusy(false);
    }
  }, [normalizedConfig.activeProvider, onDeleteProvider, selectedDraft.builtin, selectedProvider, selectedProviderTaskLabels]);

  const openAddModelEditor = useCallback(() => {
    const providerDraft = drafts[selectedProvider] || normalizePublicAiProviderConfig(selectedProvider);
    const nextIndex = providerDraft.models.length + 1;
    const defaults = getAiProviderDefaults(selectedProvider);
    setModelEditor({
      mode: "add",
      modelId: "",
      name: `模型 ${nextIndex}`,
      model: defaults.model,
      requestParamRows: requestParamsToRows(aiRequestParamsWithProviderDefaults(selectedProvider, {}, defaults.model)),
    });
  }, [drafts, selectedProvider]);

  const openEditModelEditor = useCallback((model) => {
    setSelectedModelId(model.id);
    setModelEditor({
      mode: "edit",
      modelId: model.id,
      name: model.name,
      model: model.model,
      requestParamRows: requestParamsToRows(aiRequestParamsWithProviderDefaults(selectedProvider, model.requestParams || {}, model.model)),
    });
  }, [selectedProvider]);

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
    const parsedParams = parseAiRequestParamRows(modelEditor.requestParamRows || [], { providerId: selectedProvider });
    if (!parsedParams.valid) {
      setStatus({ tone: "warning", message: parsedParams.error || "请先修正请求参数" });
      return;
    }
    const existingModel = modelEditor.mode === "edit"
      ? providerDraft.models.find((model) => model.id === modelEditor.modelId)
      : null;
    const requestParamsChanged = !existingModel || !aiRequestParamsEqual(existingModel.requestParams, parsedParams.requestParams);
    const modelChanged = !existingModel || existingModel.model !== modelValue || requestParamsChanged;
    const affectedTasks = modelChanged && existingModel
      ? AI_TASK_MODEL_DEFINITIONS.filter((task) => {
        const assignment = normalizedConfig.taskModels?.[task.id];
        return assignment?.providerId === selectedProvider && assignment?.modelId === existingModel.id;
      }).map((task) => task.label)
      : [];
    const nextModel = normalizePublicAiModelConfig(selectedProvider, {
      ...(existingModel || {}),
      id: existingModel?.id || `${selectedProvider}-custom-${Date.now().toString(36)}`,
      name,
      model: modelValue,
      requestParams: parsedParams.requestParams,
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
      if (affectedTasks.length) {
        setStatus({ tone: "warning", message: `${affectedTasks.join("、")}的任务模型已失效，请重新测试或选择其他模型` });
      }
    }
  }, [drafts, modelEditor, normalizedConfig.taskModels, onSave, runAction, selectedProvider]);

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
    const affectedTasks = AI_TASK_MODEL_DEFINITIONS.filter((task) => {
      const assignment = normalizedConfig.taskModels?.[task.id];
      return assignment?.providerId === selectedProvider && assignment?.modelId === modelId;
    }).map((task) => task.label);
    setDrafts((previous) => ({
      ...previous,
      [selectedProvider]: {
        ...(previous[selectedProvider] || providerDraft),
        activeModelId: nextActiveModelId,
        models: nextModels,
      },
    }));
    setSelectedModelId(nextSelectedModel?.id || "");
    const result = await runAction(onSave, {
      modelId: nextSelectedModel?.id || "",
      modelName: nextSelectedModel?.name || "",
      model: nextSelectedModel?.model || "",
      models: nextModels,
      resetTest: false,
      activate: normalizedConfig.activeProvider === selectedProvider && providerDraft.activeModelId === modelId,
    });
    if (result && affectedTasks.length) {
      setStatus({ tone: "warning", message: `${affectedTasks.join("、")}的任务模型已失效，请在“任务模型”中重新选择` });
    }
  }, [drafts, normalizedConfig.activeProvider, normalizedConfig.taskModels, onSave, runAction, selectedProvider]);

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
    <div className={embedded ? "ai-settings-embed" : "ai-settings-overlay dialog-scrim dialog-scrim--large"} role="presentation" onMouseDown={embedded ? undefined : onClose}>
      <section
        ref={dialogRef}
        className={embedded ? "ai-settings-dialog settings-embedded" : "ai-settings-dialog"}
        role={embedded ? "region" : "dialog"}
        aria-modal={embedded ? undefined : "true"}
        aria-labelledby="ai-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {!embedded ? (
          <button ref={closeButtonRef} type="button" className="ai-settings-close" onClick={onClose} aria-label="关闭 AI 设置" title="关闭">
            <X size={24} strokeWidth={2.6} />
          </button>
        ) : null}
        <aside className="ai-settings-sidebar">
          <div className="ai-provider-list-head">
            <strong>基础模型</strong>
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
                    activePanel === "provider" && isSelected ? "selected" : "",
                    meta.tone,
                  ].filter(Boolean).join(" ")}
                  onClick={() => {
                    setActivePanel("provider");
                    setStatus(null);
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
          <div className="ai-task-model-nav-wrap">
            <button
              type="button"
              className={activePanel === "tasks" ? "ai-task-model-nav selected" : "ai-task-model-nav"}
              aria-current={activePanel === "tasks" ? "page" : undefined}
              onClick={() => {
                setActivePanel("tasks");
                setStatus(null);
              }}
            >
              <span className="ai-task-model-nav-icon"><Bot size={21} aria-hidden="true" /></span>
              <span className="ai-task-model-nav-copy">
                <strong>任务模型</strong>
                <em>为内置任务指定模型</em>
              </span>
              <span className={`ai-status-pill ${taskModelNavTone}`}>{taskModelNavLabel}</span>
            </button>
          </div>
        </aside>
        {activePanel === "tasks" ? (
          <main className="ai-settings-main ai-task-model-main">
            <header className="ai-settings-main-head ai-task-model-main-head">
              <div className="ai-provider-hero ai-task-model-hero">
                <span className="ai-provider-hero-icon"><Bot size={30} aria-hidden="true" /></span>
                <div>
                  <h2 id="ai-settings-title">任务模型</h2>
                  <p>未单独指定时跟随默认模型，也可为内置任务设置专用模型。</p>
                </div>
              </div>
            </header>
            <section className="ai-settings-section ai-task-model-section" aria-label="任务模型列表">
              <div className="ai-settings-section-head">
                <div>
                  <h3>内置任务</h3>
                  <p className="ai-settings-muted">选择范围仅包含已连接供应商中已测试可用的模型。</p>
                </div>
              </div>
              <div className="ai-task-model-list">
                {AI_TASK_MODEL_DEFINITIONS.map((task) => {
                  const assignment = normalizedConfig.taskModels?.[task.id] || { providerId: "", modelId: "", requestParams: {} };
                  const modelKey = createAiModelKey(assignment.providerId, assignment.modelId);
                  const modelConfigured = Boolean(assignment.providerId && assignment.modelId);
                  const effectiveModelKey = modelConfigured ? modelKey : defaultResolverModelKey;
                  const assignedModel = resolverModels.find((model) => model.id === effectiveModelKey);
                  const assignedProvider = resolverProviderGroups.find((provider) => provider.id === assignedModel?.provider);
                  const modelAvailable = Boolean(assignedModel);
                  const modelInvalid = modelConfigured && !modelAvailable;
                  const providerValue = assignedProvider ? assignedProvider.id : "";
                  const modelOptions = assignedProvider?.models || [];
                  const effectiveTaskParams = assignedModel
                    ? aiTaskRequestParamsForEditor(
                      assignedModel.provider,
                      assignedModel.requestParams,
                      assignment.requestParams,
                      assignedModel.model,
                    )
                    : normalizeUiAiRequestParams(assignment.requestParams);
                  const editableEffectiveTaskParams = task.id === "applyResolver"
                    ? aiApplyResolverEditableRequestParams(assignedModel?.provider, effectiveTaskParams)
                    : effectiveTaskParams;
                  const taskRows = taskParamDrafts[task.id] || requestParamsToRows(editableEffectiveTaskParams);
                  const taskParamsResult = parseAiRequestParamRows(taskRows, { providerId: assignedModel?.provider || "" });
                  const taskParamsDirty = taskParamsResult.valid
                    && !aiRequestParamsEqual(taskParamsResult.requestParams, editableEffectiveTaskParams);
                  return (
                    <article key={task.id} className={modelInvalid ? "ai-task-model-card invalid" : "ai-task-model-card"}>
                      <div className="ai-task-model-copy">
                        <span className="ai-task-model-card-icon"><Sparkles size={19} aria-hidden="true" /></span>
                        <div>
                          <strong>{task.label}</strong>
                          <p>{task.description}</p>
                        </div>
                      </div>
                      <div className="ai-task-model-control">
                        <div className="ai-task-model-selectors" aria-label={task.selectLabel}>
                          <label>
                            <span>供应商</span>
                            <TemplateSelect
                              ariaLabel={`${task.label}供应商`}
                              value={providerValue}
                              options={[
                                { value: "", label: resolverModels.length ? "请选择供应商" : "暂无已连接供应商" },
                                ...resolverProviderGroups.map((provider) => ({ value: provider.id, label: provider.label })),
                              ]}
                              disabled={busy || !resolverModels.length}
                              invalid={modelInvalid && !assignedProvider}
                              className="ai-task-model-select"
                              onChange={(providerId) => requestTaskProviderChange(task.id, providerId)}
                            />
                          </label>
                          <label>
                            <span>模型</span>
                            <TemplateSelect
                              ariaLabel={`${task.label}模型`}
                              value={modelAvailable ? effectiveModelKey : ""}
                              options={[
                                { value: "", label: modelInvalid ? "原模型已失效，请重新选择" : (assignedProvider ? "请选择模型" : "请先选择供应商") },
                                ...modelOptions.map((model) => ({ value: model.id, label: model.modelName || model.model })),
                              ]}
                              disabled={busy || !assignedProvider}
                              invalid={modelInvalid}
                              className="ai-task-model-select"
                              onChange={(value) => {
                                const model = resolverModels.find((item) => item.id === value);
                                if (model) saveTaskModelAssignment(task.id, model.id, assignment.requestParams || {});
                              }}
                            />
                          </label>
                        </div>
                        {!modelConfigured && assignedModel ? (
                          <span className="ai-task-model-follow-default">
                            未单独指定，当前跟随默认模型「{assignedModel.modelName || assignedModel.model}」。
                          </span>
                        ) : null}
                        {modelInvalid ? <span className="ai-task-model-warning" role="alert">原任务模型已失效，请重新选择。</span> : null}
                        {assignedModel?.transport === "codex-cli" ? (
                          <div className="ai-task-codex-inherit-note">
                            <SquareTerminal size={17} aria-hidden="true" />
                            <span>任务将继承基础模型中的 Codex 推理强度；Codex CLI 不使用 HTTP 请求参数。</span>
                          </div>
                        ) : assignedModel ? (
                          <div className="ai-task-request-params">
                            <AiRequestParamsEditor
                              rows={taskRows}
                              providerId={assignedModel.provider}
                              disabled={busy}
                              compact
                              flat
                              title="任务请求参数"
                              description="已显示所选模型参数；修改或新增字段仅用于当前任务。"
                              onChange={(rows) => setTaskParamDrafts((current) => ({ ...current, [task.id]: rows }))}
                            />
                            <div className="ai-task-request-params-actions">
                              <span>{taskParamsDirty ? "有尚未保存的修改" : "参数已同步"}</span>
                              <button
                                type="button"
                                disabled={busy || !taskParamsResult.valid || !taskParamsDirty}
                                onClick={() => saveTaskRequestParams(task.id, assignedModel)}
                              >
                                保存参数
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
              {!resolverModels.length ? (
                <div className="ai-task-model-empty">
                  <Wifi size={22} aria-hidden="true" />
                  <div>
                    <strong>暂无已连接模型</strong>
                    <span>请先完成供应商连接并测试至少一个模型。</span>
                  </div>
                  <button type="button" onClick={openBaseModelSettings}>配置基础模型</button>
                </div>
              ) : null}
              {status ? <p className={`ai-task-model-feedback ${status.tone}`} aria-live="polite">{status.message}</p> : null}
            </section>
          </main>
        ) : (
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
                            options={getAiReasoningEffortOptions(model).filter((option) => option.value)}
                            disabled={busy || !model.supportedReasoningEfforts?.length}
                            onChange={(value) => saveModelReasoningEffort(model, value)}
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
            <div className="ai-model-table ai-http-model-table" aria-label={`${selectedDraft.providerLabel} 模型`}>
              <div className="ai-model-table-head">
                <span>模型名称</span>
                <span>请求参数</span>
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
                const visibleRequestParams = aiRequestParamsWithProviderDefaults(selectedProvider, model.requestParams || {}, model.model);
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
                    <button
                      type="button"
                      className="ai-model-params-control"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedModelId(model.id);
                        openEditModelEditor(model);
                      }}
                    >
                      {Object.keys(visibleRequestParams).length ? `${Object.keys(visibleRequestParams).length} 项` : "未设置"}
                    </button>
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
                        title={selectedDraft.models.length <= 1 && (selectedDraft.builtin || normalizedConfig.activeProvider === selectedProvider)
                          ? "至少保留一个模型"
                          : (AI_TASK_MODEL_DEFINITIONS.some((task) => normalizedConfig.taskModels?.[task.id]?.providerId === selectedProvider && normalizedConfig.taskModels?.[task.id]?.modelId === model.id)
                            ? "删除模型；关联任务将需要重新选择"
                            : "删除模型")}
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
        )}
        {providerCreator ? (
          <div className="ai-settings-subdialog-backdrop dialog-scrim" role="presentation" onMouseDown={() => setProviderCreator(null)}>
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
          <div className="ai-settings-subdialog-backdrop dialog-scrim" role="presentation" onMouseDown={() => setProviderEditor(null)}>
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
          <div className="ai-settings-subdialog-backdrop dialog-scrim" role="presentation" onMouseDown={() => setDeleteConfirm(false)}>
            <section className="ai-settings-subdialog ai-provider-delete-dialog" role="alertdialog" aria-modal="true" aria-label="删除供应商" onMouseDown={(event) => event.stopPropagation()}>
              <header><h3>删除供应商</h3><button type="button" onClick={() => setDeleteConfirm(false)} aria-label="关闭"><X size={16} /></button></header>
              <p>
                确定删除“{selectedDraft.providerLabel}”吗？保存的 API Key 和模型配置也会一并删除，此操作无法撤销。
                {selectedProviderTaskLabels.length ? ` 删除后，“${selectedProviderTaskLabels.join("、")}”需要重新选择任务模型。` : ""}
              </p>
              <footer><span /><div><button type="button" onClick={() => setDeleteConfirm(false)}>取消</button><button type="button" className="danger-solid" disabled={busy} onClick={deleteSelectedProvider}>{busy ? "删除中…" : "删除"}</button></div></footer>
            </section>
          </div>
        ) : null}
        {taskProviderConfirm ? (
          <div className="ai-settings-subdialog-backdrop dialog-scrim" role="presentation" onMouseDown={() => setTaskProviderConfirm(null)}>
            <section className="ai-settings-subdialog ai-provider-delete-dialog" role="alertdialog" aria-modal="true" aria-label="切换任务供应商" onMouseDown={(event) => event.stopPropagation()}>
              <header><h3>切换任务供应商</h3><button type="button" onClick={() => setTaskProviderConfirm(null)} aria-label="关闭"><X size={16} /></button></header>
              <p>任务请求参数通常与供应商协议绑定。切换到“{taskProviderConfirm.providerLabel}”后，当前任务参数将被清空。</p>
              <footer><span /><div><button type="button" onClick={() => setTaskProviderConfirm(null)}>取消</button><button type="button" className="primary" disabled={busy} onClick={confirmTaskProviderChange}>清空并切换</button></div></footer>
            </section>
          </div>
        ) : null}
        {modelEditor ? (
          <div className="ai-settings-subdialog-backdrop dialog-scrim" role="presentation" onMouseDown={() => setModelEditor(null)}>
            <section className="ai-settings-subdialog ai-model-editor-dialog" role="dialog" aria-modal="true" aria-label={modelEditor.mode === "add" ? "添加模型" : "编辑模型"} onMouseDown={(event) => event.stopPropagation()}>
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
              {modelEditorCapabilities ? (
                <div className="ai-model-capabilities">
                  <div className="ai-model-capabilities-title">
                    <strong>模型能力</strong>
                    <AppInfoTooltip
                      id="ai-model-capabilities-tip"
                      label="查看模型能力说明"
                      text="这些是只读模型能力，只用于帮助判断模型容量，不会作为请求参数发送。"
                    />
                  </div>
                  <div className="ai-model-capabilities-fields">
                    <label>
                      <span>context_window</span>
                      <input value={modelEditorCapabilities.contextWindow.toLocaleString("en-US")} readOnly />
                    </label>
                    <label>
                      <span>max_output_tokens</span>
                      <input value={modelEditorCapabilities.maxOutputTokens.toLocaleString("en-US")} readOnly />
                    </label>
                  </div>
                </div>
              ) : null}
              <AiRequestParamsEditor
                rows={modelEditor.requestParamRows || []}
                providerId={selectedProvider}
                disabled={busy}
                flat
                title="请求参数"
                description=""
                onChange={(requestParamRows) => setModelEditor((current) => ({ ...current, requestParamRows }))}
              />
              <footer>
                <span />
                <div>
                  <button type="button" onClick={() => setModelEditor(null)}>取消</button>
                  <button type="button" className="primary" disabled={busy} onClick={saveModelEditor}>保存</button>
                </div>
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

function AiResultBlockActions({ block, onCopy, onApply, applying, previewing = false, manualFallback = false, resolverLabel = "直接应用定位模型" }) {
  const applyLabel = previewing ? "正文中确认" : (manualFallback ? "选择位置应用" : "应用");
  return (
    <span className="ai-block-actions" contentEditable={false}>
      <button type="button" onClick={() => onCopy(block)} title="复制这一块" aria-label="复制这一块"><Copy size={14} /></button>
      <button type="button" className="apply" disabled={applying || previewing} onClick={() => onApply(block)} title={previewing ? "请在左侧正文中确认或取消" : (manualFallback ? "在左侧选择原文位置后应用" : `由${resolverLabel}定位并显示正文对比`)} aria-label={applyLabel}>
        {applying ? <RefreshCw className="spin" size={14} /> : null}
        <span>{applying ? "定位中" : applyLabel}</span>
      </button>
    </span>
  );
}

function AiResultBlock({ block, onCopy, onApply, applying, previewing, manualFallback, resolverLabel }) {
  if (block.type === "divider") {
    return <div className="ai-result-block ai-result-divider-block"><AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} /><hr className="ai-result-divider" /></div>;
  }
  if (block.type === "orderedList" || block.type === "bulletList") {
    const ListTag = block.type === "orderedList" ? "ol" : "ul";
    return (
      <div className="ai-result-block ai-result-list-block">
        <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
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
        <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
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
    const source = normalizeImageSource(block.asset?.src);
    const width = normalizeEmbedWidth(block.asset?.width);
    return (
      <figure className="ai-result-block ai-result-image" style={{ "--image-width": width }}>
        <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
        {source ? (
          <img src={source} alt={block.asset?.alt || block.caption} />
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
        <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
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
        <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
        <InlineAiText text={block.text} />
      </HeadingTag>
    );
  }
  return (
    <p className="ai-result-block">
      <AiResultBlockActions block={block} onCopy={onCopy} onApply={onApply} applying={applying} previewing={previewing} manualFallback={manualFallback} resolverLabel={resolverLabel} />
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
        <div className="ai-provider-switch-modal-backdrop dialog-scrim" role="presentation" onMouseDown={() => setOpen(false)}>
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

function CodexScopeSelector({ imageMode, imageCount = 0, disabled = false, onImageModeChange }) {
  const normalizedImageMode = normalizeCodexImageMode(imageMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

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

  return (
    <div ref={rootRef} className={menuOpen ? "codex-scope-switch open" : "codex-scope-switch"}>
      <button ref={triggerRef} type="button" className="codex-scope-switch-button" disabled={disabled} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} title="Codex 已隔离为仅可读取当前信笺">
        <FileText size={14} />
        <span>仅当前信笺（隔离）</span>
        <ChevronDown size={13} />
      </button>
      {menuOpen ? (
        <div className="codex-scope-menu" role="menu" aria-label="Codex 信笺设置">
          <button type="button" className="codex-scope-fixed" role="menuitem" aria-disabled="true" disabled>
            <span><strong>仅当前信笺（隔离）</strong><em>无法读取信笺目录、工作区或其他本地文件</em></span>
            <Check size={14} />
          </button>
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
    </div>
  );
}

function AiOptimizeToolbar({
  status,
  hasResult,
  editor,
  savedSelectionRef,
  availableProviders = [],
  selectedProvider,
  onProviderChange,
  onStart,
  onStop,
  onClear,
}) {
  const finalizedBreakInserted = Boolean(useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getPaperDerivedState(activeEditor).hasFinalizedBreak,
  }));
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
              title={finalizedBreakInserted ? "清空定稿线" : "插入定稿线"}
              onClick={() => finalizedBreakInserted
                ? removeFinalizedBreak(editor)
                : insertFinalizedBreak(editor, savedSelectionRef)}
            >
              <SeparatorHorizontal size={13} />
              <span>{finalizedBreakInserted ? "清空定稿线" : "插入定稿线"}</span>
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
  editor,
  availableProviders = [],
  selectedProvider,
  status,
  messages = [],
  hasState = false,
  codexImageMode,
  onProviderChange,
  onCodexImageModeChange,
  onStop,
  onClear,
  onExport,
}) {
  const imageCount = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getPaperDerivedState(activeEditor).imageCount,
  }) || 0;
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
            imageMode={codexImageMode}
            imageCount={imageCount}
            disabled={isStreaming}
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
  onApplyBlock,
  applyingBlockIndex,
  previewingBlockIndex = -1,
  manualFallbackBlockIndexes = [],
  resolverLabel,
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
          customHeaderLayout
        >
          <header className="paper-header ai-result-header">
            <h1>AI优化结果</h1>
            <p className="ai-result-subtitle">耗时：{formatElapsedSeconds(elapsedSeconds)} ；Token消耗：{tokenValue}</p>
          </header>
          <div className="paper-editor ai-result-body">
            {isStreaming && !blocks.length && !error ? <p className="ai-result-loading">AI优化中…</p> : null}
            {error ? <p className="ai-result-error">{error}</p> : null}
            {isPreparing && !error ? (
              <p className="ai-result-placeholder">在左侧原文插入一根“定稿线”，线以上全部作为已定稿背景，不会要求 AI 改写；线以下是本次优化重点。准备好后点击“开始优化”。</p>
            ) : null}
            {!error && !blocks.length && !isPreparing ? (
              isStreaming ? null : <p className="ai-result-placeholder">AI 优化结果会显示在这里。</p>
            ) : null}
            {blocks.map((block, index) => (
              <AiResultBlock
                key={`${block.type}-${index}-${block.text || block.caption || block.number}`}
                block={block}
                onCopy={onCopyBlock}
                onApply={(selectedBlock) => onApplyBlock(selectedBlock, index, blocks)}
                applying={applyingBlockIndex === index}
                previewing={previewingBlockIndex === index}
                manualFallback={manualFallbackBlockIndexes.includes(index)}
                resolverLabel={resolverLabel}
              />
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
  capacityTabCount = tabs.length,
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
  compact = false,
  secondaryOccupied = false,
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
      const isCompactStrip = compact || Boolean(strip.closest(".ai-mode-top-strip, .secondary-pane-top-strip"));
      const stripStyle = window.getComputedStyle(strip);
      const listStyle = window.getComputedStyle(list);
      const stripGap = Number.parseFloat(stripStyle.columnGap || stripStyle.gap || "0") || 0;
      const listGap = Number.parseFloat(listStyle.columnGap || listStyle.gap || "0") || 0;
      const addWidth = add.getBoundingClientRect().width || (isCompactStrip ? 38 : 48);
      const minTabWidth = isCompactStrip ? 112 : 120;
      const nextTabCount = Math.max(tabs.length, Number(capacityTabCount) || 0) + 1;
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
  }, [capacityTabCount, compact, onCapacityChange, showNew, tabs.length]);

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
    : (rightSplitTabId || secondaryOccupied ? "替换右侧内容" : "向右分屏");

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

function SecondaryDocumentTab({ tab, active = false, onActivate, onClose }) {
  if (!tab) return null;
  return (
    <div className={active ? "secondary-document-tab is-active" : "secondary-document-tab"} role="tablist" aria-label="文档右分屏标签">
      <button type="button" className="secondary-document-tab-main" role="tab" aria-selected={active} onClick={onActivate} title={tab.path || tab.title}>
        <FileText size={15} aria-hidden="true" />
        {tab.dirty ? <span className="document-tab-dot" aria-label="尚未保存" /> : null}
        <strong>{tab.title || "未命名信笺"}</strong>
        <img className="document-tab-split-mark" src={ICON_ASSETS.rightSplit} alt="" aria-hidden="true" />
      </button>
      <button type="button" className="secondary-document-tab-close" onClick={onClose} aria-label="取消右分屏" title="取消右分屏">
        <PanelRightClose size={16} aria-hidden="true" />
      </button>
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
    <div className="app-confirm-overlay dialog-scrim" role="presentation" onMouseDown={() => onResolve(dialog.cancelValue)}>
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
    <div className="app-confirm-overlay dialog-scrim" role="presentation" onMouseDown={() => onResolve(null)}>
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

function WebSourceDialog({ dialog, onClose, onSubmit }) {
  const urlRef = useRef(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dialog?.open) return undefined;
    setUrl(dialog.source?.url || "https://");
    setTitle(dialog.source?.title || "");
    setExcerpt(dialog.source?.excerpt || dialog.source?.notes || "");
    setTitleTouched(Boolean(dialog.source?.title));
    setError("");
    setBusy(false);
    const frame = window.requestAnimationFrame(() => {
      urlRef.current?.focus();
      urlRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog?.open, dialog?.source]);

  useEffect(() => {
    if (!dialog?.open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose?.();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [busy, dialog?.open, onClose]);

  if (!dialog?.open) return null;

  const parseUrl = () => {
    let parsed;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw new Error("请输入有效的网页地址");
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("网页仅支持不含账号信息的 HTTP 或 HTTPS 地址");
    }
    return parsed;
  };

  const content = (
    <div className="app-confirm-overlay dialog-scrim" role="presentation" onMouseDown={() => { if (!busy) onClose?.(); }}>
      <form
        className="app-confirm-dialog web-source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="web-source-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          let parsed;
          try {
            parsed = parseUrl();
            if (!title.trim()) throw new Error("请输入网页标题");
          } catch (validationError) {
            setError(validationError?.message || "网页信息无效");
            return;
          }
          setBusy(true);
          try {
            await onSubmit?.({ url: parsed.toString(), title: title.trim(), excerpt });
            onClose?.();
          } catch (submitError) {
            setError(submitError?.message || "网页资料保存失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <button type="button" className="app-confirm-close" disabled={busy} onClick={onClose} aria-label="关闭网页资料窗口" title="关闭">
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true"><Globe2 size={24} /></div>
        <div className="app-confirm-copy web-source-dialog-copy">
          <span>资料区 · 网页</span>
          <h2 id="web-source-dialog-title">{dialog.source ? "编辑网页" : "新增网页"}</h2>
          <label className="app-prompt-field">
            <span>网址</span>
            <input
              ref={urlRef}
              type="url"
              value={url}
              maxLength={4096}
              spellCheck={false}
              onChange={(event) => setUrl(event.target.value)}
              onBlur={() => {
                if (titleTouched || title.trim()) return;
                try { setTitle(parseUrl().hostname); } catch { /* Validation is shown on submit. */ }
              }}
            />
          </label>
          <label className="app-prompt-field">
            <span>标题</span>
            <input type="text" value={title} maxLength={500} onChange={(event) => { setTitle(event.target.value); setTitleTouched(true); }} />
          </label>
          <label className="app-prompt-field web-source-excerpt-field">
            <span>摘录（可留空）</span>
            <textarea value={excerpt} maxLength={200000} rows={6} onChange={(event) => setExcerpt(event.target.value)} />
          </label>
          {error ? <p className="web-source-dialog-error" role="alert">{error}</p> : null}
        </div>
        <footer className="app-confirm-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}><span>取消</span></button>
          <button type="submit" className="primary" disabled={busy}><Check size={15} /><span>{busy ? "保存中…" : "保存网页"}</span></button>
        </footer>
      </form>
    </div>
  );
  return createPortal(content, window.document.body);
}

function WebCopyDialog({ dialog, sources = [], folders = [], placements = {}, onClose, onSubmit }) {
  const dialogRef = useRef(null);
  const openerRef = useRef(null);
  const busyRef = useRef(false);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());
  const [selectedSourceIds, setSelectedSourceIds] = useState(() => new Set());
  const [selectedEmptyFolderIds, setSelectedEmptyFolderIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  busyRef.current = busy;

  const globalFolders = useMemo(() => folders.filter((folder) => folder.scopeKey === "global"), [folders]);
  const globalFolderMap = useMemo(() => new Map(globalFolders.map((folder) => [folder.id, folder])), [globalFolders]);
  const globalSources = useMemo(() => sources.filter((source) => (
    source.type === "web" && (placements[source.id]?.scopeKey || "global") === "global"
  )), [placements, sources]);
  const childFoldersByParent = useMemo(() => {
    const result = new Map();
    globalFolders.forEach((folder) => {
      const parentId = folder.parentId || "";
      if (!result.has(parentId)) result.set(parentId, []);
      result.get(parentId).push(folder);
    });
    result.forEach((items) => items.sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" })));
    return result;
  }, [globalFolders]);
  const sourcesByFolder = useMemo(() => {
    const result = new Map();
    globalSources.forEach((source) => {
      const folderId = placements[source.id]?.folderId || "";
      if (!result.has(folderId)) result.set(folderId, []);
      result.get(folderId).push(source);
    });
    result.forEach((items) => items.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))));
    return result;
  }, [globalSources, placements]);
  const childrenFor = useCallback((parentId = "") => [
    ...(childFoldersByParent.get(parentId) || []).map((folder) => ({ kind: "folder", value: folder })),
    ...(sourcesByFolder.get(parentId) || []).map((source) => ({ kind: "source", value: source })),
  ], [childFoldersByParent, sourcesByFolder]);
  const rootNodes = useMemo(() => childrenFor(""), [childrenFor]);
  const selectionUnitsByFolder = useMemo(() => {
    const memo = new Map();
    const collect = (folderId, visiting = new Set()) => {
      if (memo.has(folderId)) return memo.get(folderId);
      if (visiting.has(folderId)) return { sourceIds: new Set(), emptyFolderIds: new Set() };
      const nextVisiting = new Set(visiting).add(folderId);
      const directSources = sourcesByFolder.get(folderId) || [];
      const childFolders = childFoldersByParent.get(folderId) || [];
      const sourceIds = new Set(directSources.map((source) => source.id));
      const emptyFolderIds = new Set();
      childFolders.forEach((folder) => {
        const childUnits = collect(folder.id, nextVisiting);
        childUnits.sourceIds.forEach((id) => sourceIds.add(id));
        childUnits.emptyFolderIds.forEach((id) => emptyFolderIds.add(id));
      });
      if (!directSources.length && !childFolders.length) emptyFolderIds.add(folderId);
      const units = { sourceIds, emptyFolderIds };
      memo.set(folderId, units);
      return units;
    };
    globalFolders.forEach((folder) => collect(folder.id));
    return memo;
  }, [childFoldersByParent, globalFolders, sourcesByFolder]);

  useEffect(() => {
    if (!dialog?.open) return undefined;
    setExpandedFolders(new Set(globalFolders.map((folder) => folder.id)));
    setSelectedSourceIds(new Set());
    setSelectedEmptyFolderIds(new Set());
    setBusy(false);
    setError("");
    openerRef.current = window.document.activeElement;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector('[role="treeitem"]')?.focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && window.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && window.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.document.removeEventListener("keydown", handleKeyDown, true);
      openerRef.current?.focus?.();
    };
  }, [dialog?.open, onClose]);

  useEffect(() => {
    if (!dialog?.open) return;
    const validSourceIds = new Set(globalSources.map((source) => source.id));
    const validFolderIds = new Set(globalFolders.map((folder) => folder.id));
    setSelectedSourceIds((current) => {
      const next = new Set([...current].filter((id) => validSourceIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setSelectedEmptyFolderIds((current) => {
      const next = new Set([...current].filter((id) => validFolderIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [dialog?.open, globalFolders, globalSources]);

  if (!dialog?.open) return null;

  const folderSelectionState = (folderId) => {
    const units = selectionUnitsByFolder.get(folderId) || { sourceIds: new Set(), emptyFolderIds: new Set([folderId]) };
    const total = units.sourceIds.size + units.emptyFolderIds.size;
    const selected = [...units.sourceIds].filter((id) => selectedSourceIds.has(id)).length
      + [...units.emptyFolderIds].filter((id) => selectedEmptyFolderIds.has(id)).length;
    return { checked: total > 0 && selected === total, mixed: selected > 0 && selected < total, units };
  };
  const toggleFolderSelection = (folderId) => {
    const state = folderSelectionState(folderId);
    const nextChecked = !state.checked;
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      state.units.sourceIds.forEach((id) => nextChecked ? next.add(id) : next.delete(id));
      return next;
    });
    setSelectedEmptyFolderIds((current) => {
      const next = new Set(current);
      state.units.emptyFolderIds.forEach((id) => nextChecked ? next.add(id) : next.delete(id));
      return next;
    });
  };
  const toggleSourceSelection = (sourceId) => setSelectedSourceIds((current) => {
    const next = new Set(current);
    if (next.has(sourceId)) next.delete(sourceId); else next.add(sourceId);
    return next;
  });
  const selectedFolderPathIds = new Set(selectedEmptyFolderIds);
  const includeAncestors = (folderId) => {
    let currentId = folderId;
    const visiting = new Set();
    while (currentId && !visiting.has(currentId)) {
      visiting.add(currentId);
      selectedFolderPathIds.add(currentId);
      currentId = globalFolderMap.get(currentId)?.parentId || "";
    }
  };
  selectedEmptyFolderIds.forEach(includeAncestors);
  selectedSourceIds.forEach((sourceId) => includeAncestors(placements[sourceId]?.folderId || ""));
  const selectedCount = selectedSourceIds.size + selectedEmptyFolderIds.size;
  const nodeKey = (node) => `${node.kind}:${node.value.id}`;
  const renderCopyRow = ({ entry: node, depth, expanded }) => {
    const folder = node.kind === "folder";
    const folderState = folder ? folderSelectionState(node.value.id) : null;
    const checked = folder ? folderState.checked : selectedSourceIds.has(node.value.id);
    const mixed = folder ? folderState.mixed : false;
    const toggle = () => folder ? toggleFolderSelection(node.value.id) : toggleSourceSelection(node.value.id);
    return (
      <div className={`web-copy-tree-row${folder ? " is-folder" : " is-source"}`}>
        {folder ? (
          <button
            type="button"
            className="web-copy-tree-disclosure"
            tabIndex={-1}
            onClick={() => setExpandedFolders((current) => {
              const next = new Set(current);
              if (next.has(node.value.id)) next.delete(node.value.id); else next.add(node.value.id);
              return next;
            })}
            aria-label={expanded ? `折叠 ${node.value.name}` : `展开 ${node.value.name}`}
          >{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        ) : <span className="web-copy-tree-disclosure-spacer" aria-hidden="true" />}
        <TreeItemButton
          className="web-copy-tree-item"
          branch={folder}
          expanded={expanded}
          depth={depth}
          aria-checked={mixed ? "mixed" : checked}
          onActivate={toggle}
          onToggle={() => setExpandedFolders((current) => {
            const next = new Set(current);
            if (next.has(node.value.id)) next.delete(node.value.id); else next.add(node.value.id);
            return next;
          })}
          onKeyDown={(event) => {
            if (event.key === " ") {
              event.preventDefault();
              toggle();
            }
          }}
        >
          <span className={`web-copy-checkbox${checked || mixed ? " is-checked" : ""}${mixed ? " is-mixed" : ""}`} aria-hidden="true">
            {mixed ? <Minus size={12} /> : checked ? <Check size={12} /> : null}
          </span>
          {folder ? <FolderOpen size={16} aria-hidden="true" /> : <Globe2 size={15} aria-hidden="true" />}
          <span className="web-copy-tree-label"><strong>{folder ? node.value.name : (node.value.title || node.value.url)}</strong>{folder ? null : <small>{node.value.url}</small>}</span>
        </TreeItemButton>
      </div>
    );
  };

  return createPortal(
    <div className="web-copy-overlay dialog-scrim" role="presentation" onMouseDown={() => { if (!busy) onClose?.(); }}>
      <form
        ref={dialogRef}
        className="web-copy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="web-copy-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!selectedCount || busy) return;
          setBusy(true);
          setError("");
          try {
            await onSubmit?.({ folderIds: [...selectedEmptyFolderIds], sourceIds: [...selectedSourceIds] });
            onClose?.();
          } catch (submitError) {
            setError(submitError?.message || "公区内容复制失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <span className="web-copy-dialog-icon" aria-hidden="true"><Copy size={20} /></span>
          <div><small>工作区私区</small><h2 id="web-copy-dialog-title">从公区复制</h2></div>
          <button type="button" disabled={busy} onClick={onClose} aria-label="关闭公区复制窗口"><X size={17} /></button>
        </header>
        <p className="web-copy-dialog-intro">选择要复制的文件夹或网址；目录层级会保留，私区已有的相同网址会跳过。</p>
        <div className="web-copy-tree-scroll">
          {rootNodes.length ? (
            <div className="web-copy-tree" role="tree" aria-label="公区网页选择树">
              <HierarchicalTreeRows
                entries={rootNodes}
                getKey={nodeKey}
                isBranch={(node) => node.kind === "folder"}
                isExpanded={(node) => node.kind === "folder" && expandedFolders.has(node.value.id)}
                getChildren={(node) => node.kind === "folder" ? childrenFor(node.value.id) : []}
                getGroupLabel={({ entry }) => `${entry.value.name} 的内容`}
                wrapperClassName="web-copy-tree-branch"
                childrenClassName="web-copy-tree-children"
                renderRow={renderCopyRow}
                renderBranchState={(status) => status === "empty" ? <p className="web-copy-tree-empty">空文件夹</p> : null}
              />
            </div>
          ) : <p className="web-copy-dialog-empty">公区暂无可复制内容。</p>}
        </div>
        {error ? <p className="web-copy-dialog-error" role="alert">{error}</p> : null}
        <footer>
          <span>已选 {selectedSourceIds.size} 个网址 · 涉及 {selectedFolderPathIds.size} 个文件夹</span>
          <div>
            <button type="button" className="ghost" disabled={busy} onClick={onClose}>取消</button>
            <button type="submit" className="primary" disabled={!selectedCount || busy}><Copy size={14} />{busy ? "复制中…" : "复制到私区"}</button>
          </div>
        </footer>
      </form>
    </div>,
    window.document.body,
  );
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
    <div className="app-confirm-overlay dialog-scrim" role="presentation" onMouseDown={onClose}>
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

function InternalLinkPicker({ picker, documents = [], onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const resultRefs = useRef([]);
  const matchingDocuments = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-US");
    const ordered = [...documents].sort((left, right) => String(left.relativePath || left.path || left.title || "")
      .localeCompare(String(right.relativePath || right.path || right.title || ""), "zh-CN"));
    if (!needle) return ordered;
    return ordered.filter((item) => `${item.title || ""}\n${item.relativePath || item.path || ""}`
      .toLocaleLowerCase("en-US").includes(needle));
  }, [documents, query]);
  const filtered = matchingDocuments.slice(0, 500);

  useEffect(() => {
    if (!picker) return undefined;
    setQuery("");
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return undefined;
  }, [onClose, picker]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, filtered.length]);

  useEffect(() => {
    resultRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key === "ArrowDown" && filtered.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % filtered.length);
      return;
    }
    if (event.key === "ArrowUp" && filtered.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length);
      return;
    }
    if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      onSelect?.(filtered[activeIndex]);
    }
  };

  if (!picker) return null;
  return createPortal(
    <div className="internal-link-picker-overlay dialog-scrim" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="internal-link-picker" role="dialog" aria-modal="true" aria-label="插入关联信笺" onKeyDown={handleKeyDown}>
        <header className="internal-link-picker-heading">
          <span><Link2 size={16} aria-hidden="true" /><strong>插入关联信笺</strong><small>当前工作区及全部子文件夹</small></span>
          <button type="button" onClick={onClose} aria-label="关闭关联信笺选择器" title="关闭（Esc）"><X size={16} aria-hidden="true" /></button>
        </header>
        <label className="internal-link-picker-input">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={Boolean(filtered.length)}
            aria-controls="internal-link-picker-results"
            aria-activedescendant={filtered[activeIndex] ? `internal-link-picker-result-${activeIndex}` : undefined}
            value={query}
            placeholder="搜索当前工作区信笺"
            onChange={(event) => setQuery(event.target.value)}
          />
          <small>{matchingDocuments.length > filtered.length ? `显示 ${filtered.length} / ${matchingDocuments.length}` : `${filtered.length} 个结果`}</small>
        </label>
        <div id="internal-link-picker-results" className="internal-link-picker-results" role="listbox" aria-live="polite">
          {filtered.length ? filtered.map((item, index) => (
            <button
              ref={(element) => { resultRefs.current[index] = element; }}
              id={`internal-link-picker-result-${index}`}
              key={`${item.documentId}-${item.path}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => onSelect?.(item)}
              title={item.relativePath || item.path || item.title}
            >
              <span className="internal-link-picker-result-icon"><NotebookPen size={16} aria-hidden="true" /></span>
              <span className="internal-link-picker-result-copy"><strong>{item.title || "未命名信笺"}</strong><small>{item.relativePath || item.path}</small></span>
            </button>
          )) : <p>{documents.length ? "没有匹配的信笺" : "当前工作区还没有可关联的其他信笺"}</p>}
        </div>
        <footer className="internal-link-picker-footer"><span>↑↓ 选择 · Enter 插入 · Esc 关闭</span><span>范围：当前工作区及全部子文件夹</span></footer>
      </section>
    </div>,
    window.document.body,
  );
}

function LiveStatusMetric({ editor, field, label }) {
  const value = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getPaperDerivedState(activeEditor).stats[field],
  });
  const fallback = EMPTY_PAPER_DERIVED_STATE.stats[field] || 0;
  return (
    <span className={`status-metric ${field}`}>
      <strong>{(Number.isFinite(value) ? value : fallback).toLocaleString()}</strong>
      <em>{label}</em>
    </span>
  );
}

function StatusBar({ editor, updatedAt, dirty, version, cacheSummary, updateState, onRunUpdate, onClearCache, onOpenReleaseNotes, persistenceState = "workspace", externalVersion = false, readOnly = false }) {
  const cacheBytes = cacheSummary?.bytes || 0;
  const cacheCount = cacheSummary?.count || 0;
  const updateMeta = getUpdateStatusMeta(updateState);
  const persistenceLabel = readOnly
    ? "未来格式 · 只读"
    : (externalVersion || persistenceState === "external")
      ? "检测到外部版本"
      : persistenceState === "recovery"
        ? "已写入恢复缓存"
        : persistenceState === "workspace"
          ? "已写入工作区"
          : "等待写入恢复缓存";
  return (
    <footer className="statusbar">
      <div className="statusbar-counts">
        <LiveStatusMetric editor={editor} field="words" label="字" />
        <i />
        <LiveStatusMetric editor={editor} field="paragraphs" label="段" />
        <i />
        <LiveStatusMetric editor={editor} field="pages" label="页" />
        <i />
        <LiveStatusMetric editor={editor} field="images" label="图" />
      </div>
      <div className={externalVersion ? "statusbar-save external" : (dirty ? "statusbar-save dirty" : "statusbar-save saved")}>
        <span>{persistenceLabel} · {formatClock(updatedAt)}</span>
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
          <button
            type="button"
            className="status-version-button"
            onClick={onOpenReleaseNotes}
            aria-label={'查看版本 ' + version + ' 的更新历史'}
            title="查看更新历史"
          >
            <span className="status-version-v">V</span>
            <span className="status-version-number">{version}</span>
          </button>
        ) : ""}
      </div>
    </footer>
  );
}

function normalizeWorkspaceCitationSources(sources) {
  return normalizeCitationSources(Array.isArray(sources) ? sources : []);
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
    const bytes = Math.max(0, Number(tab.editorJsonBytes) || 0);
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
    .map((tab) => {
      const logicalPath = typeof tab?.path === "string" ? tab.path : "";
      const recoveryPath = typeof tab?.recoveryPath === "string" ? tab.recoveryPath : "";
      return {
        path: logicalPath,
        recoveryPath,
        recoveryId: typeof tab?.recoveryId === "string" ? tab.recoveryId : "",
        recoverySourcePath: typeof tab?.recoverySourcePath === "string" ? tab.recoverySourcePath : logicalPath,
        recoveryBaseRevision: normalizeSessionDiskRevision(tab?.recoveryBaseRevision || tab?.diskRevision),
        temporary: Boolean(tab?.temporary || (!logicalPath && recoveryPath)),
      };
    })
    .filter((tab) => {
      const pathKey = String(tab.path || tab.recoveryPath || "").replace(/\//g, "\\").toLocaleLowerCase("en-US");
      if (!pathKey || seen.has(pathKey)) {
        return false;
      }
      seen.add(pathKey);
      return true;
    });
}

function createDocumentTab(document, path = "", dirty = false, options = {}) {
  return {
    id: createTabId(),
    path,
    title: normalizeDocumentTitle(document?.title),
    document,
    editorJson: null,
    editorJsonBytes: 0,
    scrollState: { top: 0, left: 0 },
    recoveryPath: options.recoveryPath || "",
    recoveryId: options.recoveryId || "",
    recoverySourcePath: options.recoverySourcePath || "",
    recoveryBaseRevision: normalizeSessionDiskRevision(options.recoveryBaseRevision),
    recoveredTemporary: Boolean(options.recoveredTemporary),
    diskRevision: options.diskRevision || null,
    readOnly: Boolean(options.readOnly || document?._readOnlyFutureSchema),
    externalChanged: Boolean(options.externalChanged),
    dirty,
  };
}

function documentTabResourceKey(tab) {
  const path = String(tab?.path || "").trim();
  if (path) return `path:${path.replace(/\//g, "\\").toLocaleLowerCase("en-US")}`;
  const recoveryId = String(tab?.recoveryId || "").trim();
  if (recoveryId) return `recovery:${recoveryId}`;
  return tab?.id ? `temporary:${tab.id}` : "";
}

function workspaceDocumentView(tab) {
  return tab?.id ? { tabId: tab.id, resourceKey: documentTabResourceKey(tab) } : null;
}

function summarizeWorkspaceGroups(groups, tabs = []) {
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  return createWorkspaceGroupsSnapshot(groups, {
    getDocumentResourceKey: (tabId) => documentTabResourceKey(tabById.get(tabId)),
  });
}

function activeSecondaryDocumentTabId(groups) {
  const view = getActiveWorkspaceView(groups, WORKSPACE_GROUP_ID.SECONDARY);
  return view?.kind === WORKSPACE_VIEW_KIND.DOCUMENT ? view.tabId : "";
}

function findKnowledgeNodePosition(editor, typeName, attributeName = "", attributeValue = "") {
  let found = null;
  editor?.state?.doc?.descendants?.((node, position) => {
    if (found !== null || node.type.name !== typeName) return;
    if (attributeName && node.attrs?.[attributeName] !== attributeValue) return;
    found = position;
  });
  return found;
}

function recoveryTabId(tab) {
  return String(tab?.recoveryId || tab?.id || "");
}

function paperCanvasViewModel(document = {}) {
  return {
    documentId: normalizeDocumentId(document.documentId),
    title: normalizeDocumentTitle(document.title),
    author: document.author || "",
    displayDate: document.displayDate || "",
    createdAt: document.createdAt || "",
    customBackground: normalizeCustomBackgroundSource(document.customBackground),
    templateId: document.templateId || "warm",
    letterTemplateId: document.letterTemplateId || "",
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

function cleanupImageExportStage() {
  window.document.getElementById(IMAGE_EXPORT_STAGE_ID)?.remove();
}

function applyPrintPaperBackground(sheet) {
  if (!sheet) {
    return () => {};
  }
  const rootStyle = window.document.documentElement.style;
  const computedStyle = window.getComputedStyle(sheet);
  const sheetStyle = sheet.style;
  const previousMinimumHeight = {
    value: sheetStyle.getPropertyValue("--print-sheet-min-height"),
    priority: sheetStyle.getPropertyPriority("--print-sheet-min-height"),
  };
  const variables = [
    ["--print-paper-repeat-bg", "--paper-repeat-bg"],
    ["--print-paper-base", "--paper-base"],
  ];
  const previous = variables.map(([target]) => ({
    target,
    value: rootStyle.getPropertyValue(target),
    priority: rootStyle.getPropertyPriority(target),
  }));
  variables.forEach(([target, source]) => {
    const value = sheet.style.getPropertyValue(source) || computedStyle.getPropertyValue(source);
    if (value) {
      rootStyle.setProperty(target, value.trim());
    }
  });
  const sheetWidth = sheet.getBoundingClientRect().width || 794;
  const pageHeight = sheetWidth * (297 / 210);
  const segments = getFlowExportSegments(sheet);
  const pageCount = Math.max(1, segments.reduce(
    (total, segment) => total + Math.max(1, Math.ceil((segment.bottom - segment.top) / pageHeight)),
    0,
  ));
  sheetStyle.setProperty("--print-sheet-min-height", `${Math.ceil(pageCount * pageHeight)}px`);
  return () => {
    previous.forEach(({ target, value, priority }) => {
      if (value) rootStyle.setProperty(target, value, priority);
      else rootStyle.removeProperty(target);
    });
    if (previousMinimumHeight.value) {
      sheetStyle.setProperty("--print-sheet-min-height", previousMinimumHeight.value, previousMinimumHeight.priority);
    } else {
      sheetStyle.removeProperty("--print-sheet-min-height");
    }
  };
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
  const stage = window.document.createElement("div");
  stage.id = IMAGE_EXPORT_STAGE_ID;
  stage.className = "image-export-stage";
  stage.style.width = `${Math.ceil(sheetRect.width)}px`;
  window.document.body.append(stage);

  const clone = sheet.cloneNode(true);
  syncClonedFormValues(sheet, clone);
  clone.style.width = `${sheetRect.width}px`;
  clone.style.minWidth = `${sheetRect.width}px`;
  clone.style.margin = "0";
  clone.querySelectorAll("img").forEach((image) => image.setAttribute("decoding", "async"));
  stage.append(clone);

  const cloneRect = clone.getBoundingClientRect();
  const segments = getFlowExportSegments(clone);
  if (!segments.length) {
    cleanupImageExportStage();
    return [];
  }
  const maximumCaptureHeight = 8000;
  return segments.flatMap((segment) => {
    const pieces = [];
    for (let top = segment.top; top < segment.bottom; top += maximumCaptureHeight) {
      pieces.push({ top, bottom: Math.min(segment.bottom, top + maximumCaptureHeight) });
    }
    return pieces;
  }).map((segment) => ({
    x: Math.floor(cloneRect.left + window.scrollX),
    y: Math.floor(cloneRect.top + window.scrollY + segment.top),
    width: Math.ceil(cloneRect.width),
    height: Math.ceil(segment.bottom - segment.top),
  }));
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
  const [workspaceGroups, setWorkspaceGroups] = useState(() => createWorkspaceGroupsState(
    workspaceDocumentView(openTabs[0]),
    { splitRatio: Number(window.localStorage.getItem("paperwriter.workspaceSplitRatio")) || 0.5 },
  ));
  const rightSplitTabId = activeSecondaryDocumentTabId(workspaceGroups);
  const setRightSplitTabId = useCallback((value) => {
    setWorkspaceGroups((previous) => {
      const activeSecondary = getActiveWorkspaceView(previous, WORKSPACE_GROUP_ID.SECONDARY);
      const currentTabId = activeSecondary?.kind === WORKSPACE_VIEW_KIND.DOCUMENT ? activeSecondary.tabId : "";
      const nextTabId = typeof value === "function" ? value(currentTabId) : value;
      if (nextTabId) {
        return openWorkspaceDocument(previous, WORKSPACE_GROUP_ID.SECONDARY, { tabId: nextTabId });
      }
      if (activeSecondary?.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
        return moveWorkspaceDocument(previous, activeSecondary.viewId, WORKSPACE_GROUP_ID.PRIMARY, previous.primary.views.length);
      }
      return previous;
    });
  }, []);
  const [activePane, setActivePane] = useState("main");
  const [folderState, setFolderState] = useState(() => ({
    rootPath: initialSession.folderPath || "",
    path: initialSession.folderPath || "",
    parentPath: "",
    folders: [],
    files: [],
    entries: [],
    loading: Boolean(initialSession.folderPath),
  }));
  const writingWorkspaceRoot = folderState.rootPath || folderState.path;
  const [expandedFolders, setExpandedFolders] = useState({});
  const [leftSidebarMode, setLeftSidebarMode] = useState("folder");
  const [structureMode, setStructureMode] = useState("outline");
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [searchMode, setSearchMode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState("");
  const [documentReplaceVisible, setDocumentReplaceVisible] = useState(false);
  const [documentReplaceValue, setDocumentReplaceValue] = useState("");
  const [documentSearchState, setDocumentSearchState] = useState(() => searchDocumentText({ type: "doc", content: [] }, ""));
  const [workspaceSearchState, setWorkspaceSearchState] = useState({ loading: false, results: [], error: "", requestId: "" });
  const setDocumentPaneRatio = useCallback((value) => {
    setWorkspaceGroups((previous) => ({ ...previous, splitRatio: normalizeWorkspaceSplitRatio(typeof value === "function" ? value(previous.splitRatio) : value) }));
  }, []);
  const [workSurfaceWidth, setWorkSurfaceWidth] = useState(0);
  const [researchRoot, setResearchRoot] = useState(null);
  const [researchCurrentRelativePath, setResearchCurrentRelativePath] = useState("");
  const [researchEntries, setResearchEntries] = useState([]);
  const [researchExpandedFolders, setResearchExpandedFolders] = useState({});
  const [researchTreeLoading, setResearchTreeLoading] = useState(false);
  const [researchTreeError, setResearchTreeError] = useState("");
  const [researchBusyKeys, setResearchBusyKeys] = useState([]);
  const researchRootRef = useRef(null);
  const researchCurrentRelativePathRef = useRef("");
  const [librarySources, setLibrarySources] = useState([]);
  const [librarySourcesReady, setLibrarySourcesReady] = useState(false);
  const [webTreeState, setWebTreeState] = useState(() => ({ folders: [], placements: {}, diskRevision: null, warnings: [], readOnly: false }));
  const [webWorkspaceMode, setWebWorkspaceMode] = useState(() => {
    try { return window.localStorage.getItem("paperwriter.research.web-scope-mode") === "workspace" ? "workspace" : "global"; } catch { return "global"; }
  });
  const [writingWorkspaceIdentity, setWritingWorkspaceIdentity] = useState(null);
  const webWorkspaceConnected = webWorkspaceMode === "workspace" && Boolean(writingWorkspaceIdentity?.workspaceId);
  const webWorkspaceIdentityPending = webWorkspaceMode === "workspace" && Boolean(writingWorkspaceRoot) && !writingWorkspaceIdentity?.workspaceId;
  const webScopeKey = webWorkspaceConnected ? `workspace:${writingWorkspaceIdentity.workspaceId}` : "global";
  const [activeLibraryItem, setActiveLibraryItem] = useState(null);
  const [researchItemsByViewId, setResearchItemsByViewId] = useState({});
  const librarySourcesRef = useRef(librarySources);
  const researchItemsByViewIdRef = useRef(researchItemsByViewId);
  librarySourcesRef.current = librarySources;
  researchItemsByViewIdRef.current = researchItemsByViewId;
  const [activeResearchLoading, setActiveResearchLoading] = useState(false);
  const [activeResearchError, setActiveResearchError] = useState("");
  const [workspaceCitationSources, setWorkspaceCitationSources] = useState([]);
  const [citationLibraryLoading, setCitationLibraryLoading] = useState(false);
  const [pendingCitationPage, setPendingCitationPage] = useState("");
  const [workspaceRelationships, setWorkspaceRelationships] = useState({ documents: [], links: [], backlinks: [], duplicates: [] });
  const workspaceRelationshipRequestRef = useRef(0);
  const [internalLinkPicker, setInternalLinkPicker] = useState(null);
  const [citationPicker, setCitationPicker] = useState(null);
  const [footnoteDialog, setFootnoteDialog] = useState({ open: false, footnote: null, insertTarget: null });
  const [citationSourceDialog, setCitationSourceDialog] = useState({ open: false, source: null, insertTarget: null, citationPage: "", returnToPicker: false });
  const [knowledgeReferencePopover, setKnowledgeReferencePopover] = useState(null);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [persistenceState, setPersistenceState] = useState("workspace");
  const [externalVersionDetected, setExternalVersionDetected] = useState(false);
  const [applyingAiBlockIndex, setApplyingAiBlockIndex] = useState(-1);
  const [manualFallbackAiBlockIndexes, setManualFallbackAiBlockIndexes] = useState([]);
  const [manualAiApply, setManualAiApply] = useState(null);
  const [aiApplyPreview, setAiApplyPreview] = useState(null);
  const [settingsDialog, setSettingsDialog] = useState({ open: false, section: "", targetTabId: "" });
  const [tabTemplateDialog, setTabTemplateDialog] = useState({ open: false, targetTabId: "" });
  const [helpOpen, setHelpOpen] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [printMode, setPrintMode] = useState(false);
  const [imageExportMode, setImageExportMode] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [promptDialog, setPromptDialog] = useState(null);
  const [webSourceDialog, setWebSourceDialog] = useState({ open: false, source: null, folderId: "", scopeKey: "global" });
  const [webCopyDialog, setWebCopyDialog] = useState({ open: false });
  const [linkDialog, setLinkDialog] = useState(null);
  const [commentPanel, setCommentPanel] = useState(null);
  const [updateState, setUpdateState] = useState({ status: "idle", message: "尚未检查更新" });
  const appVersion = updateState?.version || CURRENT_RELEASE_VERSION;
  const [aiConfig, setAiConfig] = useState(DEFAULT_AI_CONFIG);
  const [aiSelectedProvider, setAiSelectedProvider] = useState(DEFAULT_AI_CONFIG.activeProvider);
  const [aiModeChooserOpen, setAiModeChooserOpen] = useState(false);
  const [aiModeKind, setAiModeKind] = useState("none");
  const [aiPageTransition, setAiPageTransition] = useState("");
  const aiMode = aiModeKind !== "none";
  const aiOptimizeMode = aiModeKind === "optimize";
  const aiChatMode = aiModeKind === "chat";
  useEffect(() => {
    if (!aiPageTransition) return undefined;
    const timer = window.setTimeout(() => setAiPageTransition(""), 560);
    return () => window.clearTimeout(timer);
  }, [aiPageTransition]);
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
  const aiChatCodexImageMode = activeChatState.codexImageMode;
  useEffect(() => {
    let canceled = false;
    if (!writingWorkspaceRoot) {
      setWritingWorkspaceIdentity(null);
      return undefined;
    }
    setWritingWorkspaceIdentity(null);
    void bridge.getWorkspaceIdentity?.(writingWorkspaceRoot).then((identity) => {
      if (canceled || !identity?.workspaceId) return;
      setWritingWorkspaceIdentity({
        workspaceId: String(identity.workspaceId),
        workspaceName: String(identity.workspaceName || displayNameFromPath(writingWorkspaceRoot) || "当前工作区"),
      });
    }).catch(() => {});
    return () => { canceled = true; };
  }, [writingWorkspaceRoot]);

  useEffect(() => {
    try { window.localStorage.setItem("paperwriter.research.web-scope-mode", webWorkspaceMode); } catch {}
  }, [webWorkspaceMode]);
  const applyingRef = useRef(false);
  const aiApplyInFlightRef = useRef(false);
  const readyRef = useRef(false);
  const editorSelectionRef = useRef(null);
  const updateFlowRef = useRef({ active: false, handled: "" });
  const updateResultResetTimerRef = useRef(0);
  const restoreRunRef = useRef(0);
  const openTabsRef = useRef(openTabs);
  const activeTabIdRef = useRef(activeTabId);
  const activeDocumentKeyRef = useRef(documentRuntimeKey(currentPath, activeTabId));
  const mainCanvasRef = useRef(null);
  const rightCanvasRef = useRef(null);
  const workSurfaceRef = useRef(null);
  const currentPathRef = useRef(currentPath);
  const dirtyRef = useRef(dirty);
  const dirtyTabIdsRef = useRef(new Set(openTabs.filter((tab) => tab.dirty).map((tab) => tab.id)));
  const liveUpdatedAtByTabRef = useRef(new Map());
  const liveRevisionByTabRef = useRef(new Map());
  const diskRevisionByTabRef = useRef(new Map());
  const lastEditAtByTabRef = useRef(new Map());
  const liveEditorSourceByTabRef = useRef(new Map());
  const documentStateRef = useRef(documentState);
  const updateAutoCheckedRef = useRef(false);
  const getSaveDocumentRef = useRef(null);
  const getRightSplitSaveDocumentRef = useRef(null);
  const refreshFolderRef = useRef(null);
  const applyDocumentRunRef = useRef(0);
  const rightSplitApplyingRef = useRef(false);
  const rightSplitApplyRunRef = useRef(0);
  const rightSplitSelectionRef = useRef(null);
  const rightSplitTabIdRef = useRef("");
  const workspaceGroupsRef = useRef(workspaceGroups);
  const aiSecondaryPaneLayoutRef = useRef(null);
  const immersiveSecondaryPaneLayoutRef = useRef(null);
  const previousImmersiveModeRef = useRef(false);
  const aiModeTriggerRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const tabTemplateReturnFocusRef = useRef(null);
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
  const saveQueueByTabRef = useRef(new Map());
  const autosaveRunningRef = useRef(false);
  const autosaveErrorAtRef = useRef(0);
  const tabClosePendingIdsRef = useRef(new Set());
  const sessionClosePendingRef = useRef(false);
  const workspaceSearchRequestRef = useRef("");
  const closeInternalLinkPicker = useCallback(() => setInternalLinkPicker(null), []);

  useLayoutEffect(() => {
    const surface = workSurfaceRef.current;
    if (!surface) return undefined;
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const width = Math.max(0, Math.round(surface.getBoundingClientRect().width));
        setWorkSurfaceWidth((current) => current === width ? current : width);
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(surface);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const recordTabMutation = useCallback((tabId, updatedAt = new Date().toISOString()) => {
    if (!tabId) return false;
    liveUpdatedAtByTabRef.current.set(tabId, updatedAt);
    lastEditAtByTabRef.current.set(tabId, Date.now());
    setPersistenceState("dirty");
    liveRevisionByTabRef.current.set(tabId, (liveRevisionByTabRef.current.get(tabId) || 0) + 1);
    const becameDirty = !dirtyTabIdsRef.current.has(tabId);
    dirtyTabIdsRef.current.add(tabId);
    if (tabId === activeTabIdRef.current) {
      dirtyRef.current = true;
      if (becameDirty) setDirty(true);
    }
    if (becameDirty) {
      const nextTabs = openTabsRef.current.map((tab) => (
        tab.id === tabId ? { ...tab, dirty: true } : tab
      ));
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
    }
    return becameDirty;
  }, []);

  const queueTabSave = useCallback(async (tabId, operation) => {
    const previous = saveQueueByTabRef.current.get(tabId) || Promise.resolve();
    const queued = previous.catch(() => {}).then(operation);
    // Keep the tracked promise alive through the caller's state-update
    // continuation. A close/discard action waiting on this queue must observe
    // the committed dirty/recovery state, not merely the completed IPC write.
    const tracked = queued.then(() => undefined, () => undefined)
      .then(() => new Promise((resolve) => window.setTimeout(resolve, 0)));
    saveQueueByTabRef.current.set(tabId, tracked);
    tracked.finally(() => {
      if (saveQueueByTabRef.current.get(tabId) === tracked) {
        saveQueueByTabRef.current.delete(tabId);
      }
    });
    return queued;
  }, []);

  const waitForTabSave = useCallback(async (tabId) => {
    await (saveQueueByTabRef.current.get(tabId) || Promise.resolve());
  }, []);

  const mainEditorExtensions = useMemo(() => createPaperEditorExtensions(), []);
  const rightEditorExtensions = useMemo(() => createPaperEditorExtensions(), []);
  const mainEditorOptions = useMemo(() => ({
    shouldRerenderOnTransaction: false,
    extensions: mainEditorExtensions,
    content: documentStateRef.current.html,
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
    onUpdate: ({ transaction }) => {
      if (transaction?.getMeta?.("paperKnowledgeDerived") || transaction?.getMeta?.("paperStructuredDerived")) return;
      if (applyingRef.current) return;
      const tabId = activeTabIdRef.current;
      liveEditorSourceByTabRef.current.set(tabId, "main");
      recordTabMutation(tabId);
    },
  }), [mainEditorExtensions, recordTabMutation]);
  const rightEditorOptions = useMemo(() => ({
    shouldRerenderOnTransaction: false,
    extensions: rightEditorExtensions,
    content: "<p></p>",
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
    onFocus: () => setActivePane("right"),
    onUpdate: ({ transaction }) => {
      if (transaction?.getMeta?.("paperKnowledgeDerived") || transaction?.getMeta?.("paperStructuredDerived")) return;
      if (rightSplitApplyingRef.current) return;
      const splitId = rightSplitTabIdRef.current;
      if (!splitId) return;
      liveEditorSourceByTabRef.current.set(splitId, "right");
      recordTabMutation(splitId);
    },
  }), [recordTabMutation, rightEditorExtensions]);
  const activeSecondaryView = useMemo(
    () => getActiveWorkspaceView(workspaceGroups, WORKSPACE_GROUP_ID.SECONDARY),
    [workspaceGroups],
  );
  const rightSplitTab = useMemo(() => openTabs.find((tab) => tab.id === rightSplitTabId) || null, [openTabs, rightSplitTabId]);
  const rightSplitDocument = useMemo(() => {
    if (!rightSplitTab || rightSplitTab.id === activeTabId) {
      return null;
    }
    return rightSplitTab.document;
  }, [activeTabId, rightSplitTab]);

  const editor = useEditor(mainEditorOptions);

  const rightSplitEditor = useEditor(rightEditorOptions);

  const researchPaneFocused = !aiMode
    && activePane === "right"
    && activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH;
  const splitPaneActive = !aiMode && activePane === "right" && Boolean(rightSplitTabId && rightSplitDocument && rightSplitEditor);
  const activeWorkEditor = researchPaneFocused ? null : (splitPaneActive ? rightSplitEditor : editor);
  const activeWorkDocument = researchPaneFocused ? null : (splitPaneActive ? rightSplitDocument : documentState);
  const activeWorkPath = researchPaneFocused ? "" : (splitPaneActive ? (rightSplitTab?.path || "") : currentPath);
  const activeWorkSelectionRef = splitPaneActive ? rightSplitSelectionRef : editorSelectionRef;
  const structureWorkEditor = activeWorkEditor || editor;
  const structureWorkDocument = activeWorkDocument || documentState;
  const structureWorkPath = activeWorkPath || currentPath;
  const structureWorkTabId = splitPaneActive ? rightSplitTabId : activeTabId;
  const workspaceRelationshipContextKey = `${writingWorkspaceRoot || ""}\n${structureWorkTabId || ""}\n${structureWorkPath || ""}\n${structureWorkDocument?.documentId || ""}`;
  const workspaceRelationshipContextRef = useRef(workspaceRelationshipContextKey);
  workspaceRelationshipContextRef.current = workspaceRelationshipContextKey;
  const knowledgeReferences = useEditorState({
    editor: structureWorkEditor,
    selector: ({ editor: activeEditor }) => collectKnowledgeReferences(activeEditor),
  }) || { links: [], citations: [], footnotes: [] };
  const citationOrder = useMemo(() => [...new Set(knowledgeReferences.citations.map((citation) => citation.sourceId).filter(Boolean))], [knowledgeReferences.citations]);
  const citationSourcesForDock = useMemo(() => {
    const merged = new Map(((structureWorkDocument?.citationSources || [])).map((source) => [source.id, source]));
    for (const source of workspaceCitationSources) merged.set(source.id, source);
    return [...merged.values()];
  }, [structureWorkDocument?.citationSources, workspaceCitationSources]);
  const citationPickerSources = useMemo(() => {
    const targetTab = citationPicker?.documentTabId
      ? openTabs.find((tab) => tab.id === citationPicker.documentTabId)
      : null;
    const targetDocument = targetTab?.id === activeTabId ? documentState : targetTab?.document;
    const merged = new Map((targetDocument?.citationSources || []).map((source) => [source.id, source]));
    for (const source of workspaceCitationSources) merged.set(source.id, source);
    return [...merged.values()];
  }, [activeTabId, citationPicker?.documentTabId, documentState, openTabs, workspaceCitationSources]);
  const visibleFootnotes = useMemo(() => {
    const byId = new Map(((structureWorkDocument?.footnotes || [])).map((footnote) => [footnote.id, footnote]));
    const seen = new Set();
    return knowledgeReferences.footnotes.map((reference) => {
      if (!reference.footnoteId || seen.has(reference.footnoteId)) return null;
      seen.add(reference.footnoteId);
      return byId.get(reference.footnoteId) || null;
    }).filter(Boolean);
  }, [structureWorkDocument?.footnotes, knowledgeReferences.footnotes]);
  const primaryGroupTabs = useMemo(() => workspaceGroups.primary.views.map((view) => {
    const tab = openTabs.find((candidate) => candidate.id === view.tabId);
    const tabDocument = tab?.id === activeTabId ? documentState : tab?.document;
    return tab ? {
      viewId: view.viewId,
      tabId: tab.id,
      kind: WORKSPACE_VIEW_KIND.DOCUMENT,
      title: tab.title,
      path: tab.path,
      dirty: tab.dirty,
      letterTemplateId: getLetterTemplate(tabDocument, letterTemplates).id,
    } : null;
  }).filter(Boolean), [activeTabId, documentState.letterTemplateId, documentState.templateId, letterTemplates, openTabs, workspaceGroups.primary.views]);
  const secondaryGroupTabs = useMemo(() => workspaceGroups.secondary.views.map((view) => {
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      const tab = openTabs.find((candidate) => candidate.id === view.tabId);
      return tab ? {
        viewId: view.viewId,
        tabId: tab.id,
        kind: WORKSPACE_VIEW_KIND.DOCUMENT,
        title: tab.title,
        path: tab.path,
        dirty: tab.dirty,
        letterTemplateId: getLetterTemplate(tab.document, letterTemplates).id,
      } : null;
    }
    const item = researchItemsByViewId[view.viewId]
      || (view.sourceId ? librarySources.find((source) => source.id === view.sourceId) : null)
      || (activeSecondaryView?.viewId === view.viewId ? activeLibraryItem : null);
    const title = item?.title || item?.name || item?.fileName || view.titleSnapshot || view.relativePath || "未命名资料";
    const researchType = item?.type === "web"
      ? "web"
      : (/\.pdf$/i.test(view.relativePath || item?.name || "") ? "pdf" : "file");
    const page = Number(view.viewState?.page) || 1;
    return {
      viewId: view.viewId,
      kind: WORKSPACE_VIEW_KIND.RESEARCH,
      researchType,
      title,
      path: view.relativePath || "",
      metaLabel: researchType === "pdf" ? `PDF · ${page}` : ({
        web: "网页",
        markdown: "Markdown",
        text: "文本",
        table: "表格",
        image: "图片",
      }[researchType] || "资料"),
    };
  }).filter(Boolean), [activeLibraryItem, activeSecondaryView?.viewId, letterTemplates, librarySources, openTabs, researchItemsByViewId, workspaceGroups.secondary.views]);
  useEffect(() => {
    if (activeSecondaryView?.kind !== WORKSPACE_VIEW_KIND.RESEARCH) {
      setPendingCitationPage("");
      return;
    }
    const item = researchItemsByViewId[activeSecondaryView.viewId]
      || (activeSecondaryView.sourceId ? librarySources.find((source) => source.id === activeSecondaryView.sourceId) : null)
      || activeLibraryItem;
    const isPdf = item?.type === "file" && /\.pdf$/i.test(activeSecondaryView.relativePath || item.relativePath || item.name || "");
    setPendingCitationPage(isPdf ? String(activeSecondaryView.viewState?.page || 1) : "");
  }, [activeLibraryItem, activeSecondaryView, librarySources, researchItemsByViewId]);
  const activeTabReadOnly = Boolean(openTabs.find((tab) => tab.id === activeTabId)?.readOnly || documentState?._readOnlyFutureSchema);
  const activeWorkReadOnly = splitPaneActive
    ? Boolean(rightSplitTab?.readOnly || rightSplitDocument?._readOnlyFutureSchema)
    : activeTabReadOnly;
  const mainCanvasDocument = useMemo(() => paperCanvasViewModel(documentState), [
    documentState.author,
    documentState.createdAt,
    documentState.customBackground,
    documentState.displayDate,
    documentState.documentId,
    documentState.letterTemplateId,
    documentState.templateId,
    documentState.title,
  ]);
  const rightCanvasDocument = useMemo(() => paperCanvasViewModel(rightSplitDocument || {}), [
    rightSplitDocument?.author,
    rightSplitDocument?.createdAt,
    rightSplitDocument?.customBackground,
    rightSplitDocument?.displayDate,
    rightSplitDocument?.documentId,
    rightSplitDocument?.letterTemplateId,
    rightSplitDocument?.templateId,
    rightSplitDocument?.title,
  ]);
  const documentCacheSummary = useMemo(() => summarizeDocumentCache(openTabs), [openTabs]);
  const availableAiProviders = useMemo(() => getTestedAiProviders(aiConfig), [aiConfig]);
  const aiHasUsableProvider = availableAiProviders.length > 0;
  const aiApplyResolverLabel = useMemo(() => {
    const assignment = aiConfig.taskModels?.applyResolver || {};
    const assignedKey = assignment.providerId && assignment.modelId
      ? createAiModelKey(assignment.providerId, assignment.modelId)
      : aiConfig.activeModelKey;
    const model = availableAiProviders.find((candidate) => candidate.id === assignedKey);
    return model
      ? `${model.providerLabel || model.label || "AI"} · ${model.modelName || model.model || "定位模型"}`
      : "直接应用定位模型";
  }, [aiConfig.activeModelKey, aiConfig.taskModels, availableAiProviders]);
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
  const effectiveAiChoice = useMemo(
    () => availableAiProviders.find((provider) => provider.id === effectiveAiProvider) || availableAiProviders[0] || null,
    [availableAiProviders, effectiveAiProvider],
  );
  const activeDocumentKey = useMemo(() => documentRuntimeKey(currentPath, activeTabId), [activeTabId, currentPath]);
  useEffect(() => {
    setManualFallbackAiBlockIndexes([]);
    setManualAiApply(null);
    setAiApplyPreview(null);
  }, [activeDocumentKey, aiOutput]);

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

  const openSettings = useCallback(() => {
    setAiModeChooserOpen(false);
    setSettingsDialog({
      open: true,
      section: "",
      targetTabId: splitPaneActive && rightSplitTabId ? rightSplitTabId : activeTabIdRef.current,
    });
  }, [rightSplitTabId, splitPaneActive]);

  const openSettingsSection = useCallback((section) => {
    setSettingsDialog((current) => ({
      ...current,
      open: false,
      section: section === "template" ? "template" : "ai",
      targetTabId: current.targetTabId
        || (splitPaneActive && rightSplitTabId ? rightSplitTabId : activeTabIdRef.current),
    }));
  }, [rightSplitTabId, splitPaneActive]);
  const openAiSettings = useCallback(() => {
    setAiModeChooserOpen(false);
    setSettingsDialog({
      open: false,
      section: "ai",
      targetTabId: splitPaneActive && rightSplitTabId ? rightSplitTabId : activeTabIdRef.current,
    });
  }, [rightSplitTabId, splitPaneActive]);
  const closeSettings = useCallback(() => {
    setSettingsDialog((current) => ({ ...current, open: false, section: "" }));
  }, []);

  const handleOpenGroupTabTemplate = useCallback((view, returnFocusElement) => {
    if (view?.kind !== "document" || !view.tabId) return;
    tabTemplateReturnFocusRef.current = returnFocusElement?.focus ? returnFocusElement : null;
    setTabTemplateDialog({ open: true, targetTabId: view.tabId });
  }, []);

  const closeTabTemplateDialog = useCallback(() => {
    setTabTemplateDialog({ open: false, targetTabId: "" });
  }, []);

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
      const tabId = activeTabIdRef.current;
      recordTabMutation(tabId, updatedAt);
      const nextDocument = applyPatch(documentStateRef.current);
      documentStateRef.current = nextDocument;
      setDocumentState(nextDocument);
      return;
    }
    const targetTab = openTabsRef.current.find((tab) => documentRuntimeKey(tab.path, tab.id) === documentKey);
    if (!targetTab) return;
    recordTabMutation(targetTab.id, updatedAt);
    const nextTabs = openTabsRef.current.map((tab) => (
      tab.id === targetTab.id
        ? { ...tab, document: applyPatch(tab.document), dirty: true }
        : tab
    ));
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
  }, [recordTabMutation]);

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
    syncDocumentCommentDecorations(editor, documentState.comments);
  }, [documentState.comments, editor]);

  useEffect(() => {
    syncDocumentCommentDecorations(rightSplitEditor, rightSplitDocument?.comments);
  }, [rightSplitDocument?.comments, rightSplitEditor]);

  useEffect(() => {
    const hidden = aiMode || printMode || imageExportMode;
    setDocumentCommentVisibility(editor, hidden);
    setDocumentCommentVisibility(rightSplitEditor, hidden);
  }, [aiMode, editor, imageExportMode, printMode, rightSplitEditor]);

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
    dirtyTabIdsRef.current = new Set(openTabs.filter((tab) => tab.dirty).map((tab) => tab.id));
    if (dirty && activeTabId) dirtyTabIdsRef.current.add(activeTabId);
  }, [activeTabId, dirty, openTabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    workspaceGroupsRef.current = workspaceGroups;
    window.localStorage.setItem("paperwriter.workspaceSplitRatio", String(workspaceGroups.splitRatio));
  }, [workspaceGroups]);

  useEffect(() => {
    const focusedGroup = activePane === "right" && workspaceGroups.secondary.views.length
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY;
    if (workspaceGroups.focusedGroup !== focusedGroup) {
      setWorkspaceGroups((previous) => previous.focusedGroup === focusedGroup
        ? previous
        : { ...previous, focusedGroup });
    }
  }, [activePane, workspaceGroups.focusedGroup, workspaceGroups.secondary.views.length]);

  useEffect(() => {
    rightSplitTabIdRef.current = rightSplitTabId;
  }, [rightSplitTabId]);

  useEffect(() => {
    const activeSecondary = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
    if (!activeSecondary) {
      if (activePane === "right") {
        setActivePane("main");
      }
      return;
    }
    if (activeSecondary.kind === WORKSPACE_VIEW_KIND.RESEARCH) return;
    if (rightSplitTabId === activeTabId || !openTabs.some((tab) => tab.id === rightSplitTabId)) {
      rightSplitTabIdRef.current = "";
      setRightSplitTabId("");
      setActivePane("main");
    }
  }, [activePane, activeTabId, openTabs, rightSplitTabId, setRightSplitTabId, workspaceGroups]);

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
        replaceEditorContentWithoutHistory(rightSplitEditor, splitTab?.editorJson || splitDocument.html || "<p></p>");
      } catch {
        replaceEditorContentWithoutHistory(rightSplitEditor, splitDocument.html || "<p></p>");
      }
      restoreEditorSelectionWithoutHistory(rightSplitEditor, splitTab?.selectionState);
      rightSplitSelectionRef.current = readEditorSelectionState(rightSplitEditor);
      syncDocumentCommentDecorations(rightSplitEditor, normalizeDocumentComments(splitDocument.comments));
      window.requestAnimationFrame(() => {
        if (rightSplitApplyRunRef.current === runId) {
          restoreCanvasScrollState(rightCanvasRef.current, splitTab?.scrollState);
        }
      });
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
    if (writingWorkspaceRoot) {
      persistSession({ folderPath: writingWorkspaceRoot });
    }
  }, [persistSession, writingWorkspaceRoot]);

  useEffect(() => {
    if (!activeTabId) {
      return;
    }
    setOpenTabs((tabs) => {
      let changed = false;
      const nextTabs = tabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const title = documentState.title || "未命名信笺";
        if (tab.path === currentPath && tab.title === title && tab.dirty === dirty) return tab;
        changed = true;
        return { ...tab, path: currentPath, title, dirty };
      });
      if (!changed) return tabs;
      openTabsRef.current = nextTabs;
      return nextTabs;
    });
  }, [activeTabId, currentPath, dirty, documentState.title]);

  const showStatus = useCallback((message, tone = "success", options = {}) => {
    const duration = Number.isFinite(options.duration) ? Math.max(1000, options.duration) : 2800;
    setStatus({ message, tone, dismissible: Boolean(options.dismissible) });
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => setStatus(null), duration);
  }, []);

  const dismissStatus = useCallback(() => {
    window.clearTimeout(showStatus.timer);
    setStatus(null);
  }, [showStatus]);

  const toggleAiModeChooser = useCallback(() => {
    if (aiModeChooserOpen) {
      setAiModeChooserOpen(false);
      return;
    }
    if (!aiHasUsableProvider) {
      openAiSettings();
      showStatus(AI_MODEL_REQUIRED_MESSAGE, "warning", { duration: 5000, dismissible: true });
      return;
    }
    setAiModeChooserOpen(true);
  }, [aiHasUsableProvider, aiModeChooserOpen, openAiSettings, showStatus]);

  const updateCommentsForPane = useCallback((pane, updater) => {
    const updatedAt = new Date().toISOString();
    const sourceEditor = pane === "right" ? rightSplitEditor : editor;
    const applyCommentUpdate = (document) => {
      const previousComments = getDocumentComments(sourceEditor, document?.comments);
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
      recordTabMutation(splitId, updatedAt);
      const nextTabs = openTabsRef.current.map((tab) => (
        tab.id === splitId ? { ...tab, document: applyCommentUpdate(tab.document), dirty: true } : tab
      ));
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
      if (splitId === activeTabIdRef.current) {
        setDocumentState((previous) => {
          const nextDocument = applyCommentUpdate(previous);
          documentStateRef.current = nextDocument;
          return nextDocument;
        });
      }
      return;
    }

    const tabId = activeTabIdRef.current;
    recordTabMutation(tabId, updatedAt);
    const nextDocument = applyCommentUpdate(documentStateRef.current);
    documentStateRef.current = nextDocument;
    setDocumentState(nextDocument);
  }, [editor, recordTabMutation, rightSplitEditor]);

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
    const sourceEditor = pane === "right" ? rightSplitEditor : editor;
    const sourceDocument = pane === "right" ? rightSplitDocument : documentState;
    if (!commentAnchorTrackAvailable(sourceEditor, getDocumentComments(sourceEditor, sourceDocument?.comments), selection)) {
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
    setOpenTabs((tabs) => {
      const nextTabs = tabs.map((tab) => (
        tab.editorJson ? { ...tab, editorJson: null, editorJsonBytes: 0 } : tab
      ));
      openTabsRef.current = nextTabs;
      return nextTabs;
    });
    showStatus("已清理信笺切换缓存", "success");
  }, [showStatus]);

  const snapshotLiveTabs = useCallback(({ includeEditorJson = false } = {}) => {
    const activeId = activeTabIdRef.current;
    const splitId = rightSplitTabIdRef.current;
    const activeUsesRightEditor = splitId === activeId && liveEditorSourceByTabRef.current.get(activeId) === "right";
    const activeDocument = activeUsesRightEditor
      ? (getRightSplitSaveDocumentRef.current?.() || documentStateRef.current)
      : (getSaveDocumentRef.current?.() || documentStateRef.current);
    const liveTabs = new Map();
    liveTabs.set(activeId, {
      document: activeDocument,
      path: currentPathRef.current,
      dirty: dirtyRef.current,
      editorJson: includeEditorJson
        ? ((activeUsesRightEditor ? rightSplitEditor : editor)?.getJSON?.() || null)
        : undefined,
      scrollState: readCanvasScrollState(activeUsesRightEditor ? rightCanvasRef.current : mainCanvasRef.current),
    });
    if (splitId && splitId !== activeId) {
      const splitDocument = getRightSplitSaveDocumentRef.current?.();
      if (splitDocument) {
        liveTabs.set(splitId, {
          document: splitDocument,
          dirty: dirtyTabIdsRef.current.has(splitId),
          editorJson: includeEditorJson ? (rightSplitEditor?.getJSON?.() || null) : undefined,
          scrollState: readCanvasScrollState(rightCanvasRef.current),
          selectionState: readEditorSelectionState(rightSplitEditor),
        });
      }
    }
    const documentSnapshots = openTabsRef.current.map((tab) => {
      const live = liveTabs.get(tab.id);
      if (!live) return tab;
      const nextEditorJson = includeEditorJson ? (live.editorJson || tab.editorJson) : tab.editorJson;
      return {
        ...tab,
        ...live,
        path: live.path ?? tab.path,
        title: live.document?.title || "未命名信笺",
        editorJson: nextEditorJson,
        editorJsonBytes: includeEditorJson ? estimateSerializedBytes(nextEditorJson) : tab.editorJsonBytes,
      };
    });
    return snapshotTabsWithRevisions(documentSnapshots, liveRevisionByTabRef.current);
  }, [editor, rightSplitEditor]);

  const openSearch = useCallback((scope = "document", options = {}) => {
    if (scope === "workspace" && !writingWorkspaceRoot) {
      showStatus("请先打开一个文件夹", "warning");
      return;
    }
    setSearchMode(scope === "workspace" ? "workspace" : "document");
    if (scope !== "workspace") setDocumentReplaceVisible(Boolean(options.replace));
  }, [showStatus, writingWorkspaceRoot]);

  const closeSearch = useCallback(() => {
    setSearchMode("");
    renderDocumentSearchState(activeWorkEditor, null);
  }, [activeWorkEditor]);

  const moveDocumentSearch = useCallback((delta) => {
    setDocumentSearchState((previous) => {
      const next = moveActiveDocumentSearchMatch(previous, delta);
      if (next.activeMatch) {
        window.setTimeout(() => activeWorkEditor?.chain().focus().setTextSelection(next.activeMatch.from).scrollIntoView().run(), 0);
      }
      return next;
    });
  }, [activeWorkEditor]);

  useEffect(() => {
    if (!activeWorkEditor) return undefined;
    const update = () => {
      const next = searchDocumentText(activeWorkEditor.state.doc, searchMode === "document" ? searchQuery : "");
      setDocumentSearchState(next);
    };
    update();
    activeWorkEditor.on("update", update);
    return () => activeWorkEditor.off("update", update);
  }, [activeWorkEditor, searchMode, searchQuery]);

  useEffect(() => {
    renderDocumentSearchState(activeWorkEditor, searchMode === "document" ? documentSearchState : null);
  }, [activeWorkEditor, documentSearchState, searchMode]);

  const replaceDocumentSearchMatches = useCallback((replaceAll = false) => {
    if (!activeWorkEditor || activeWorkReadOnly) {
      if (activeWorkReadOnly) showStatus("当前文档为只读，不能替换", "warning");
      return;
    }
    const matches = replaceAll
      ? documentSearchState.matches
      : (documentSearchState.activeMatch ? [documentSearchState.activeMatch] : []);
    if (!matches.length) return;
    const transaction = activeWorkEditor.state.tr;
    applyDocumentTextReplacements(transaction, matches, documentReplaceValue);
    if (!transaction.docChanged) return;
    activeWorkEditor.view.dispatch(transaction.scrollIntoView());
    activeWorkEditor.commands.focus();
    showStatus(replaceAll ? `已替换 ${matches.length} 处匹配` : "已替换当前匹配", "success");
  }, [activeWorkEditor, activeWorkReadOnly, documentReplaceValue, documentSearchState, showStatus]);

  useEffect(() => {
    if (searchMode !== "workspace" || !writingWorkspaceRoot) return undefined;
    const query = workspaceSearchQuery.trim();
    const previousRequest = workspaceSearchRequestRef.current;
    if (previousRequest) bridge.cancelFolderSearch?.(writingWorkspaceRoot, previousRequest).catch?.(() => {});
    if (!query) {
      setWorkspaceSearchState({ loading: false, results: [], error: "", requestId: "" });
      return undefined;
    }
    const requestId = `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    workspaceSearchRequestRef.current = requestId;
    setWorkspaceSearchState({ loading: true, results: [], error: "", requestId });
    const timer = window.setTimeout(async () => {
      try {
        const overrides = snapshotLiveTabs().filter((tab) => tab.path && tab.dirty).map((tab) => ({ path: tab.path, document: tab.document }));
        const result = await bridge.searchFolder?.({ folderPath: writingWorkspaceRoot, query, requestId, overrides, limit: 100 });
        if (workspaceSearchRequestRef.current !== requestId || result?.canceled) return;
        const results = (result?.results || []).map((item) => ({
          ...item,
          query: result?.query || query,
          snippetRanges: item.snippetMatchStart >= 0 ? [{ from: item.snippetMatchStart, to: item.snippetMatchStart + item.snippetMatchLength }] : [],
        }));
        setWorkspaceSearchState({ loading: false, results, error: "", requestId });
      } catch (error) {
        if (workspaceSearchRequestRef.current === requestId) setWorkspaceSearchState({ loading: false, results: [], error: error?.message || "工作区搜索失败", requestId });
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      bridge.cancelFolderSearch?.(writingWorkspaceRoot, requestId).catch?.(() => {});
    };
  }, [searchMode, snapshotLiveTabs, workspaceSearchQuery, writingWorkspaceRoot]);

  const verifyOpenDiskRevisions = useCallback(async () => {
    const tabs = snapshotLiveTabs().filter((tab) => tab.path);
    const changedIds = new Set();
    await Promise.all(tabs.map(async (tab) => {
      try {
        const result = await bridge.getDocumentRevision?.(tab.path);
        const actual = result?.diskRevision || null;
        const expected = diskRevisionByTabRef.current.get(tab.id) || tab.diskRevision || null;
        if (expected && !sameDiskRevision(actual, expected)) changedIds.add(tab.id);
        else if (!expected && actual) diskRevisionByTabRef.current.set(tab.id, actual);
      } catch {
        if (diskRevisionByTabRef.current.has(tab.id)) changedIds.add(tab.id);
      }
    }));
    const nextTabs = openTabsRef.current.map((tab) => ({ ...tab, externalChanged: changedIds.has(tab.id) }));
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    const activeChanged = changedIds.has(activeTabIdRef.current);
    setExternalVersionDetected(activeChanged);
    if (activeChanged) {
      setPersistenceState("external");
      showStatus("检测到磁盘上的外部版本；保存时会保护两个版本", "warning");
    }
    return changedIds;
  }, [showStatus, snapshotLiveTabs]);

  useEffect(() => {
    bridge.watchWorkspace?.(writingWorkspaceRoot || "").catch?.(() => {});
    if (!writingWorkspaceRoot) return undefined;
    const onChanged = () => {
      refreshFolderRef.current?.();
      verifyOpenDiskRevisions();
    };
    const unsubscribeChanged = bridge.onWorkspaceChanged?.(onChanged);
    const unsubscribeError = bridge.onWorkspaceWatchError?.((payload) => showStatus(payload?.message || "工作区文件监听不可用；仍会在保存前校验", "warning"));
    return () => {
      unsubscribeChanged?.();
      unsubscribeError?.();
    };
  }, [showStatus, verifyOpenDiskRevisions, writingWorkspaceRoot]);

  useEffect(() => bridge.onWindowFocus?.(() => verifyOpenDiskRevisions()), [verifyOpenDiskRevisions]);

  const activeSessionPath = currentPath
    || openTabs.find((tab) => tab.id === activeTabId)?.recoveryPath
    || "";
  const sessionPathSignature = useMemo(
    () => sessionTabSignature(activeSessionPath, openTabs),
    [activeSessionPath, openTabs],
  );
  const workspaceGroupsSessionSnapshot = useMemo(
    () => summarizeWorkspaceGroups(workspaceGroups, openTabs),
    [openTabs, workspaceGroups],
  );
  const workspaceGroupsSessionSignature = useMemo(
    () => JSON.stringify(workspaceGroupsSessionSnapshot),
    [workspaceGroupsSessionSnapshot],
  );

  useEffect(() => {
    if (!sessionRestoredRef.current) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const liveTabs = openTabsRef.current.map((tab) => (
        tab.id === activeTabIdRef.current ? { ...tab, path: currentPathRef.current } : tab
      ));
      persistSession({
        activePath: currentPathRef.current
          || liveTabs.find((tab) => tab.id === activeTabIdRef.current)?.recoveryPath
          || "",
        tabs: summarizeSessionTabs(liveTabs),
        workspaceGroups: summarizeWorkspaceGroups(workspaceGroupsRef.current, liveTabs),
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [persistSession, sessionPathSignature, workspaceGroupsSessionSignature]);

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
    editor.setEditable(!activeTabReadOnly && !(aiMode && aiStatus === "streaming") && !aiApplyPreview);
    return () => {
      editor.setEditable(true);
    };
  }, [activeTabReadOnly, aiApplyPreview, aiMode, aiStatus, editor]);

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
    const materializeOutput = (context) => {
      if (!context?.pendingChunks?.length) return context?.outputBuffer || "";
      context.outputBuffer = `${context.outputBuffer || ""}${context.pendingChunks.join("")}`;
      context.pendingChunks.length = 0;
      return context.outputBuffer;
    };
    const clearPendingFlush = (context) => {
      if (!context?.flushId) return;
      window.clearTimeout(context.flushId);
      context.flushId = 0;
    };
    const flushContext = (context) => {
      context.flushId = 0;
      materializeOutput(context);
      if (context.kind === "chat") {
        updateChatStateForKey(context.documentKey, (chat) => ({
          ...chat,
          messages: chat.messages.map((message) => (
            message.id === context.assistantId
              ? { ...message, content: context.outputBuffer || "", status: "streaming" }
              : message
          )),
        }));
        return;
      }
      updateOptimizeStateForKey(context.documentKey, (optimize) => ({
        ...optimize,
        output: context.outputBuffer || "",
      }));
    };
    const scheduleContextFlush = (context) => {
      if (context.flushId) return;
      context.flushId = window.setTimeout(() => flushContext(context), 50);
    };
    const unsubscribeChunk = bridge.onAiChunk?.((payload) => {
      const context = aiRequestContextsRef.current.get(payload?.requestId);
      if (!context) {
        return;
      }
      if (payload.delta) context.pendingChunks.push(payload.delta);
      scheduleContextFlush(context);
    });
    const unsubscribeDone = bridge.onAiDone?.((payload) => {
      const context = aiRequestContextsRef.current.get(payload?.requestId);
      if (!context) {
        return;
      }
      clearPendingFlush(context);
      materializeOutput(context);
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
                  content: context.outputBuffer || message.content || "",
                  status: "done",
                  elapsedSeconds,
                  usage: totalTokens > 0
                    ? totalTokens
                    : (context.promptTokenEstimate || 0) + estimateTokenCount(context.outputBuffer || message.content || ""),
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
      clearPendingFlush(context);
      materializeOutput(context);
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
              ? { ...item, content: context.outputBuffer || item.content || message, elapsedSeconds, status: payload.aborted ? "stopped" : "error" }
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
        clearPendingFlush(context);
      });
    };
  }, [showStatus, updateChatStateForKey, updateOptimizeStateForKey]);

  const openHelpCenter = useCallback(() => {
    setHelpOpen(true);
  }, []);

  const closeHelpCenter = useCallback(() => {
    setHelpOpen(false);
  }, []);

  const openReleaseNotes = useCallback(() => {
    setReleaseNotesOpen(true);
  }, []);

  const closeReleaseNotes = useCallback(() => {
    setReleaseNotesOpen(false);
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
      documentStateRef.current = normalized;
      currentPathRef.current = nextPath;
      dirtyRef.current = nextDirty;
      const activeId = activeTabIdRef.current;
      liveEditorSourceByTabRef.current.set(activeId, "main");
      liveUpdatedAtByTabRef.current.set(activeId, normalized.updatedAt);
      if (nextDirty) dirtyTabIdsRef.current.add(activeId);
      else dirtyTabIdsRef.current.delete(activeId);
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
          replaceEditorContentWithoutHistory(editor, options.editorJson || normalized.html || "<p></p>");
        } catch (error) {
          contentSource = "html-fallback";
          replaceEditorContentWithoutHistory(editor, normalized.html || "<p></p>");
          bridge.debugLog?.("renderer:document:set-content-fallback", {
            path: nextPath,
            message: error?.message || String(error),
          });
        }
        syncDocumentCommentDecorations(editor, normalized.comments);
        setDocumentCommentVisibility(editor, aiMode || printMode || imageExportMode);
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
    const sourceDocument = documentStateRef.current;
    const html = stripDerivedKnowledgeDataFromHtml(editor?.getHTML() || sourceDocument.html || "<p></p>");
    const title = sourceDocument.title?.trim() || inferTitle(editor?.getText() || "");
    return normalizeDocument({
      ...sourceDocument,
      title,
      html,
      comments: getDocumentComments(editor, sourceDocument.comments),
      updatedAt: liveUpdatedAtByTabRef.current.get(activeTabIdRef.current) || sourceDocument.updatedAt,
    }, letterTemplates);
  }, [editor, letterTemplates]);

  const getRightSplitSaveDocument = useCallback(() => {
    const splitId = rightSplitTabIdRef.current;
    const splitTab = openTabsRef.current.find((tab) => tab.id === splitId);
    const sourceDocument = splitId === activeTabIdRef.current
      ? documentStateRef.current
      : (splitTab?.document || rightSplitDocument);
    if (!sourceDocument) {
      return null;
    }
    const html = stripDerivedKnowledgeDataFromHtml(rightSplitEditor?.getHTML() || sourceDocument.html || "<p></p>");
    const title = sourceDocument.title?.trim() || inferTitle(rightSplitEditor?.getText() || "");
    return normalizeDocument({
      ...sourceDocument,
      title,
      html,
      comments: getDocumentComments(rightSplitEditor, sourceDocument.comments),
      updatedAt: liveUpdatedAtByTabRef.current.get(splitId) || sourceDocument.updatedAt,
    }, letterTemplates);
  }, [letterTemplates, rightSplitDocument, rightSplitEditor]);

  useEffect(() => {
    getSaveDocumentRef.current = getSaveDocument;
  }, [getSaveDocument]);

  useEffect(() => {
    getRightSplitSaveDocumentRef.current = getRightSplitSaveDocument;
  }, [getRightSplitSaveDocument]);

  const handleTitleChange = useCallback((title) => {
    const tabId = activeTabIdRef.current;
    const updatedAt = new Date().toISOString();
    recordTabMutation(tabId, updatedAt);
    const nextDocument = { ...documentStateRef.current, title: String(title || "").slice(0, DOCUMENT_TITLE_MAX_CHARS), updatedAt };
    documentStateRef.current = nextDocument;
    setDocumentState(nextDocument);
  }, [recordTabMutation]);

  const handleAuthorChange = useCallback((author) => {
    const tabId = activeTabIdRef.current;
    const updatedAt = new Date().toISOString();
    recordTabMutation(tabId, updatedAt);
    const nextDocument = { ...documentStateRef.current, author: author.slice(0, 40), updatedAt };
    documentStateRef.current = nextDocument;
    setDocumentState(nextDocument);
  }, [recordTabMutation]);

  const handleDateChange = useCallback((displayDate) => {
    const tabId = activeTabIdRef.current;
    const updatedAt = new Date().toISOString();
    recordTabMutation(tabId, updatedAt);
    const nextDocument = { ...documentStateRef.current, displayDate: displayDate.slice(0, 40), updatedAt };
    documentStateRef.current = nextDocument;
    setDocumentState(nextDocument);
  }, [recordTabMutation]);

  const updateRightSplitDocument = useCallback((patch) => {
    const splitId = rightSplitTabIdRef.current;
    if (!splitId) {
      return;
    }
    const updatedAt = new Date().toISOString();
    recordTabMutation(splitId, updatedAt);
    const nextTabs = openTabsRef.current.map((tab) => (
      tab.id === splitId
        ? { ...tab, title: patch.title ?? tab.title, document: { ...tab.document, ...patch, updatedAt }, dirty: true }
        : tab
    ));
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    if (splitId === activeTabIdRef.current) {
      setDocumentState((previous) => {
        const nextDocument = { ...previous, ...patch, updatedAt };
        documentStateRef.current = nextDocument;
        return nextDocument;
      });
    }
  }, [recordTabMutation]);

  const handleRightSplitTitleChange = useCallback((title) => {
    updateRightSplitDocument({ title: String(title || "").slice(0, DOCUMENT_TITLE_MAX_CHARS) });
  }, [updateRightSplitDocument]);

  const handleRightSplitAuthorChange = useCallback((author) => {
    updateRightSplitDocument({ author: author.slice(0, 40) });
  }, [updateRightSplitDocument]);

  const handleRightSplitDateChange = useCallback((displayDate) => {
    updateRightSplitDocument({ displayDate: displayDate.slice(0, 40) });
  }, [updateRightSplitDocument]);

  const updateDocumentSplitRatio = useCallback((value) => {
    const next = normalizeWorkspaceSplitRatio(value);
    setDocumentPaneRatio(next);
    window.localStorage.setItem("paperwriter.workspaceSplitRatio", String(next));
  }, []);

  const startDocumentSplitResize = useCallback((event) => {
    if (event.button !== 0) return;
    const workspace = event.currentTarget.closest(".paper-workspace");
    if (!workspace) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const bounds = workspace.getBoundingClientRect();
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId || !bounds.width) return;
      updateDocumentSplitRatio((moveEvent.clientX - bounds.left) / bounds.width);
    };
    const stop = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
  }, [updateDocumentSplitRatio]);

  const commitWorkspaceGroups = useCallback((nextGroups) => {
    const next = nextGroups || workspaceGroupsRef.current;
    workspaceGroupsRef.current = next;
    rightSplitTabIdRef.current = activeSecondaryDocumentTabId(next);
    setWorkspaceGroups(next);
    return next;
  }, []);

  useEffect(() => {
    if (!openTabs.length) return;
    const tabById = new Map(openTabs.map((tab) => [tab.id, tab]));
    setWorkspaceGroups((previous) => {
      const refreshViews = (views, allowResearch) => (views || []).flatMap((view) => {
        if (view.kind === WORKSPACE_VIEW_KIND.RESEARCH) return allowResearch ? [view] : [];
        const tab = tabById.get(view.tabId);
        return tab ? [createDocumentWorkspaceView(workspaceDocumentView(tab))] : [];
      });
      let primaryViews = refreshViews(previous.primary.views, false);
      let secondaryViews = refreshViews(previous.secondary.views, true);
      const assignedTabIds = new Set([...primaryViews, ...secondaryViews]
        .filter((view) => view.kind === WORKSPACE_VIEW_KIND.DOCUMENT)
        .map((view) => view.tabId));
      for (const tab of openTabs) {
        if (!assignedTabIds.has(tab.id)) {
          primaryViews.push(createDocumentWorkspaceView(workspaceDocumentView(tab)));
          assignedTabIds.add(tab.id);
        }
      }
      if (!primaryViews.length) {
        const firstSecondaryDocumentIndex = secondaryViews.findIndex((view) => view.kind === WORKSPACE_VIEW_KIND.DOCUMENT);
        if (firstSecondaryDocumentIndex >= 0) {
          primaryViews = [secondaryViews[firstSecondaryDocumentIndex]];
          secondaryViews = secondaryViews.filter((_, index) => index !== firstSecondaryDocumentIndex);
        } else {
          primaryViews = [createDocumentWorkspaceView(workspaceDocumentView(openTabs[0]))];
        }
      }
      const candidate = normalizeWorkspaceGroupsState({
        ...previous,
        primary: { views: primaryViews, activeViewId: previous.primary.activeViewId },
        secondary: { views: secondaryViews, activeViewId: previous.secondary.activeViewId },
      }, { fallbackPrimaryDocument: workspaceDocumentView(openTabs[0]) });
      return JSON.stringify(candidate) === JSON.stringify(previous) ? previous : candidate;
    });
  }, [openTabs]);

  const updateOpenResearchTargets = useCallback((libraryId, previousPath, nextPath, itemPatch = {}) => {
    let nextGroups = workspaceGroupsRef.current;
    const changedViewIds = [];
    for (const view of nextGroups.secondary.views) {
      if (view.kind !== WORKSPACE_VIEW_KIND.RESEARCH || view.libraryId !== libraryId || !view.relativePath) continue;
      if (view.relativePath !== previousPath && !view.relativePath.startsWith(`${previousPath}/`)) continue;
      const suffix = view.relativePath.slice(previousPath.length);
      nextGroups = updateWorkspaceResearchTarget(nextGroups, view.viewId, { libraryId, relativePath: `${nextPath}${suffix}` });
      changedViewIds.push(view.viewId);
    }
    if (nextGroups !== workspaceGroupsRef.current) commitWorkspaceGroups(nextGroups);
    if (changedViewIds.length) {
      setResearchItemsByViewId((previous) => {
        const copy = { ...previous };
        for (const viewId of changedViewIds) {
          if (copy[viewId]) copy[viewId] = { ...copy[viewId], ...itemPatch, relativePath: `${nextPath}${String(copy[viewId].relativePath || "").slice(previousPath.length)}` };
        }
        return copy;
      });
    }
  }, [commitWorkspaceGroups]);

  const removeOpenResearchViews = useCallback((selector) => {
    const state = workspaceGroupsRef.current;
    const removedIds = state.secondary.views.filter((view) => (
      view.kind === WORKSPACE_VIEW_KIND.RESEARCH && selector(view)
    )).map((view) => view.viewId);
    if (!removedIds.length) return;
    removedIds.forEach((viewId) => { void bridge.destroyResearchWebView?.(viewId); });
    const next = removeWorkspaceViews(state, new Set(removedIds));
    commitWorkspaceGroups(next);
    setResearchItemsByViewId((previous) => {
      const copy = { ...previous };
      removedIds.forEach((viewId) => delete copy[viewId]);
      return copy;
    });
    const active = getActiveWorkspaceView(next, WORKSPACE_GROUP_ID.SECONDARY);
    if (!active) {
      setActiveLibraryItem(null);
      setActivePane("main");
    } else if (active.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
      setActiveLibraryItem(researchItemsByViewIdRef.current[active.viewId]
        || (active.sourceId ? librarySourcesRef.current.find((source) => source.id === active.sourceId) : null)
        || null);
    }
  }, [commitWorkspaceGroups]);

  const handleToggleRightSplit = useCallback((tabId) => {
    const state = workspaceGroupsRef.current;
    const location = findWorkspaceView(state, tabId);
    if (!location || location.view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT) return;
    const targetGroup = location.groupId === WORKSPACE_GROUP_ID.PRIMARY
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY;
    if (location.groupId === WORKSPACE_GROUP_ID.PRIMARY && state.primary.views.length <= 1) {
      showStatus("左侧编辑组至少需要保留一个信笺", "warning");
      return;
    }
    const snapshot = snapshotLiveTabs({ includeEditorJson: true });
    openTabsRef.current = snapshot;
    setOpenTabs(snapshot);
    const next = moveWorkspaceDocument(state, location.view.viewId, targetGroup, state[targetGroup].views.length);
    if (next === state) return;
    commitWorkspaceGroups(next);
    if (targetGroup === WORKSPACE_GROUP_ID.PRIMARY) {
      const target = snapshot.find((tab) => tab.id === tabId);
      if (target) {
        activeTabIdRef.current = target.id;
        setActiveTabId(target.id);
        applyDocument(target.document, target.path, target.dirty, { editorJson: target.editorJson, scrollState: target.scrollState });
      }
      setActivePane("main");
    } else {
      const nextPrimary = getActiveWorkspaceView(next, WORKSPACE_GROUP_ID.PRIMARY);
      const primaryTab = snapshot.find((tab) => tab.id === nextPrimary?.tabId);
      if (primaryTab && tabId === activeTabIdRef.current) {
        activeTabIdRef.current = primaryTab.id;
        setActiveTabId(primaryTab.id);
        applyDocument(primaryTab.document, primaryTab.path, primaryTab.dirty, { editorJson: primaryTab.editorJson, scrollState: primaryTab.scrollState });
      }
      setActivePane("right");
    }
    showStatus(targetGroup === WORKSPACE_GROUP_ID.SECONDARY ? "已移到右侧编辑组" : "已移到左侧编辑组", "success");
  }, [applyDocument, commitWorkspaceGroups, showStatus, snapshotLiveTabs]);

  const addOrActivateDocumentTab = useCallback(
    (nextDocument, nextPath = "", nextDirty = false, options = {}) => {
      const normalized = normalizeDocument(nextDocument, letterTemplates);
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      const existingTab = nextPath ? snapshot.find((tab) => sameDocumentPath(tab.path, nextPath)) : null;
      if (existingTab) {
        openTabsRef.current = snapshot;
        setOpenTabs(snapshot);
        const location = findWorkspaceView(workspaceGroupsRef.current, existingTab.id);
        if (location?.groupId === WORKSPACE_GROUP_ID.SECONDARY) {
          commitWorkspaceGroups(selectWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY, location.view.viewId));
          setActivePane("right");
        } else {
          const nextGroups = location
            ? selectWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.PRIMARY, location.view.viewId)
            : openWorkspaceDocument(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.PRIMARY, workspaceDocumentView(existingTab));
          commitWorkspaceGroups(nextGroups);
          activeTabIdRef.current = existingTab.id;
          setActiveTabId(existingTab.id);
          setActivePane("main");
          if (existingTab.id !== activeTabId) {
            applyDocument(existingTab.document, existingTab.path, existingTab.dirty, { editorJson: existingTab.editorJson, scrollState: existingTab.scrollState });
          }
        }
        return existingTab.id;
      }
      const requestedGroup = options.groupId === WORKSPACE_GROUP_ID.SECONDARY
        || (!options.groupId && activePane === "right" && workspaceGroupsRef.current.secondary.views.length)
        ? WORKSPACE_GROUP_ID.SECONDARY
        : WORKSPACE_GROUP_ID.PRIMARY;
      const onlyTab = snapshot.length === 1 ? snapshot[0] : null;
      const canReplaceBlank = requestedGroup === WORKSPACE_GROUP_ID.PRIMARY
        && (nextPath || options.replaceBlank)
        && onlyTab
        && !onlyTab.path
        && !onlyTab.dirty
        && !currentPath
        && !dirty;
      const tab = createDocumentTab(normalized, nextPath, nextDirty, options);
      if (options.diskRevision) diskRevisionByTabRef.current.set(tab.id, options.diskRevision);
      if (nextDirty) lastEditAtByTabRef.current.set(tab.id, Date.now());
      const nextTabs = canReplaceBlank ? [tab] : [...snapshot, tab];
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
      let nextGroups;
      if (canReplaceBlank) {
        const view = createDocumentWorkspaceView(workspaceDocumentView(tab));
        nextGroups = {
          ...workspaceGroupsRef.current,
          primary: { views: [view], activeViewId: view.viewId },
          focusedGroup: WORKSPACE_GROUP_ID.PRIMARY,
        };
      } else {
        nextGroups = openWorkspaceDocument(workspaceGroupsRef.current, requestedGroup, workspaceDocumentView(tab));
      }
      commitWorkspaceGroups(nextGroups);
      if (requestedGroup === WORKSPACE_GROUP_ID.PRIMARY) {
        activeTabIdRef.current = tab.id;
        setActiveTabId(tab.id);
        setActivePane("main");
        applyDocument(normalized, nextPath, nextDirty, { scrollState: tab.scrollState });
      } else {
        setActivePane("right");
      }
      return tab.id;
    },
    [activePane, activeTabId, applyDocument, commitWorkspaceGroups, currentPath, dirty, letterTemplates, snapshotLiveTabs],
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
      const restoreEntries = [...summarizeSessionTabs(sessionRef.current.tabs || [])];
      if (activePath && !restoreEntries.some((entry) => sameDocumentPath(entry.path, activePath))) {
        restoreEntries.push({ path: activePath, temporary: false });
      }
      let folderPath = savedFolderPath;
      let defaultFolderPath = "";
      bridge.debugLog?.("renderer:restore:start", {
        savedFolderPath,
        activePath,
        tabs: restoreEntries.length,
      });
      if (!folderPath) {
        try {
          const paths = await bridge.getPaths?.();
          defaultFolderPath = paths?.documents || "";
          folderPath = defaultFolderPath;
        } catch {
          folderPath = "";
        }
      }
      if (folderPath) {
        bridge.debugLog?.("renderer:restore:folder-selected", {
          folderPath,
          source: savedFolderPath ? "session" : "documents-default",
        });
        if (isActiveRestore()) {
          setFolderState((previous) => ({
            ...previous,
            rootPath: previous.rootPath || folderPath,
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
              rootPath: folderPath,
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
              const paths = defaultFolderPath ? { documents: defaultFolderPath } : await bridge.getPaths?.();
              const fallbackPath = paths?.documents || "";
              const fallback = fallbackPath ? await listFolderWithTimeout(fallbackPath) : null;
              if (fallbackPath && !fallback?.canceled) {
                setFolderState({
                  rootPath: fallback.folderPath || fallbackPath,
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
                  rootPath: folderPath,
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
                rootPath: folderPath,
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
      if (restoreEntries.length) {
        const restoredTabs = [];
        for (const restoreEntry of restoreEntries) {
          const restorePath = restoreEntry.recoveryPath || restoreEntry.path;
          try {
            const result = await bridge.openDocumentPath(restorePath);
            if (!isActiveRestore()) {
              return;
            }
            if (!result?.canceled && result?.document) {
              const normalized = normalizeDocument(result.document, letterTemplates);
              const restoredFromRecovery = Boolean(restoreEntry.recoveryPath || restoreEntry.temporary);
              if (restoredFromRecovery) {
                const logicalPath = restoreEntry.temporary ? "" : restoreEntry.path;
                const recoverySourcePath = restoreEntry.recoverySourcePath || logicalPath;
                const recoveryBaseRevision = normalizeSessionDiskRevision(restoreEntry.recoveryBaseRevision);
                const logicalRevision = logicalPath ? await bridge.getDocumentRevision?.(logicalPath).catch?.(() => null) : null;
                const currentDiskRevision = normalizeSessionDiskRevision(logicalRevision?.diskRevision);
                const sourceMatches = !logicalPath || !recoverySourcePath || sameDocumentPath(logicalPath, recoverySourcePath);
                const externalChanged = Boolean(logicalPath && (
                  !sourceMatches
                  || !recoveryBaseRevision
                  || !sameDiskRevision(currentDiskRevision, recoveryBaseRevision)
                ));
                restoredTabs.push(createDocumentTab(normalized, logicalPath, true, {
                    recoveryPath: result.path,
                    recoveryId: restoreEntry.recoveryId || result.recoveryId,
                    recoverySourcePath,
                    recoveryBaseRevision,
                    recoveredTemporary: true,
                    diskRevision: recoveryBaseRevision,
                    readOnly: result.readOnly,
                    externalChanged,
                  }));
              } else {
                restoredTabs.push(createDocumentTab(normalized, result.path, false, { diskRevision: result.diskRevision, readOnly: result.readOnly }));
              }
            }
          } catch {
            // Missing or unreadable session files are skipped.
          }
        }
        if (isActiveRestore() && restoredTabs.length) {
          restoredTabs.forEach((tab) => { if (tab.diskRevision) diskRevisionByTabRef.current.set(tab.id, tab.diskRevision); });
          dirtyTabIdsRef.current = new Set(restoredTabs.filter((tab) => tab.dirty).map((tab) => tab.id));
          restoredTabs.filter((tab) => tab.dirty).forEach((tab) => lastEditAtByTabRef.current.set(tab.id, Date.now()));
          const legacyActiveTab = restoredTabs.find((tab) => sameDocumentPath(tab.path || tab.recoveryPath, activePath)) || restoredTabs[0];
          let fallbackGroups = createWorkspaceGroupsState(workspaceDocumentView(restoredTabs[0]), {
            splitRatio: workspaceGroupsRef.current.splitRatio,
          });
          for (const tab of restoredTabs.slice(1)) {
            fallbackGroups = openWorkspaceDocument(fallbackGroups, WORKSPACE_GROUP_ID.PRIMARY, workspaceDocumentView(tab));
          }
          fallbackGroups = selectWorkspaceView(fallbackGroups, WORKSPACE_GROUP_ID.PRIMARY, legacyActiveTab.id);
          const restoredGroups = restoreWorkspaceGroupsSnapshot(sessionRef.current.workspaceGroups, {
            documents: restoredTabs.map(workspaceDocumentView),
            fallbackState: fallbackGroups,
            fallbackPrimaryDocument: workspaceDocumentView(legacyActiveTab),
            resolveDocumentTabId: (resourceKey) => {
              const tab = restoredTabs.find((candidate) => documentTabResourceKey(candidate) === resourceKey);
              return tab ? workspaceDocumentView(tab) : null;
            },
          }) || fallbackGroups;
          const restoredPrimaryView = getActiveWorkspaceView(restoredGroups, WORKSPACE_GROUP_ID.PRIMARY);
          const activeTab = restoredTabs.find((tab) => tab.id === restoredPrimaryView?.tabId) || legacyActiveTab;
          setOpenTabs(restoredTabs);
          commitWorkspaceGroups(restoredGroups);
          activeTabIdRef.current = activeTab.id;
          setActiveTabId(activeTab.id);
          applyDocument(activeTab.document, activeTab.path, activeTab.dirty);
          const restoredSecondaryView = getActiveWorkspaceView(restoredGroups, WORKSPACE_GROUP_ID.SECONDARY);
          if (restoredGroups.focusedGroup === WORKSPACE_GROUP_ID.SECONDARY && restoredSecondaryView) {
            setActivePane("right");
            if (restoredSecondaryView.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
              const restoredResearchItem = restoredSecondaryView.relativePath
                ? {
                    type: "file",
                    relativePath: restoredSecondaryView.relativePath,
                    name: restoredSecondaryView.titleSnapshot || displayNameFromPath(restoredSecondaryView.relativePath),
                  }
                : null;
              if (restoredResearchItem) {
                setResearchItemsByViewId((previous) => ({ ...previous, [restoredSecondaryView.viewId]: restoredResearchItem }));
                setActiveLibraryItem(restoredResearchItem);
              }
            }
          } else {
            setActivePane("main");
          }
          setExternalVersionDetected(Boolean(activeTab.externalChanged));
          setPersistenceState(activeTab.externalChanged ? "external" : (activeTab.dirty ? "recovery" : "workspace"));
          persistSession({
            activePath: activeTab.path || activeTab.recoveryPath,
            tabs: summarizeSessionTabs(restoredTabs),
            workspaceGroups: summarizeWorkspaceGroups(restoredGroups, restoredTabs),
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
  }, [applyDocument, commitWorkspaceGroups, editor, letterTemplates, persistSession]);

  const handleSelectTab = useCallback(
    (tabId) => {
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      const target = snapshot.find((tab) => tab.id === tabId);
      if (!target) {
        return;
      }
      openTabsRef.current = snapshot;
      setOpenTabs(snapshot);
      const location = findWorkspaceView(workspaceGroupsRef.current, target.id);
      if (location?.groupId === WORKSPACE_GROUP_ID.SECONDARY) {
        commitWorkspaceGroups(selectWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY, location.view.viewId));
        setActivePane("right");
        return;
      }
      const nextGroups = location
        ? selectWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.PRIMARY, location.view.viewId)
        : openWorkspaceDocument(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.PRIMARY, workspaceDocumentView(target));
      commitWorkspaceGroups(nextGroups);
      activeTabIdRef.current = target.id;
      setActiveTabId(target.id);
      setActivePane("main");
      if (target.id !== activeTabId) {
        applyDocument(target.document, target.path, target.dirty, { editorJson: target.editorJson, scrollState: target.scrollState });
      }
    },
    [activeTabId, applyDocument, commitWorkspaceGroups, snapshotLiveTabs],
  );

  const handleSelectGroupView = useCallback((groupId, viewId) => {
    const state = workspaceGroupsRef.current;
    const group = state[groupId];
    const view = group?.views?.find((candidate) => candidate.viewId === viewId);
    if (!view) return;
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      handleSelectTab(view.tabId);
      return;
    }
    const snapshot = snapshotLiveTabs({ includeEditorJson: true });
    openTabsRef.current = snapshot;
    setOpenTabs(snapshot);
    const next = selectWorkspaceView(state, WORKSPACE_GROUP_ID.SECONDARY, viewId);
    commitWorkspaceGroups(next);
    setActivePane("right");
    const item = researchItemsByViewId[viewId]
      || (view.sourceId ? librarySources.find((source) => source.id === view.sourceId) : null)
      || null;
    setActiveLibraryItem(item);
    setActiveResearchError("");
  }, [commitWorkspaceGroups, handleSelectTab, librarySources, researchItemsByViewId, snapshotLiveTabs]);

  const handleReorderGroupView = useCallback((groupId, viewId, beforeViewId) => {
    const state = workspaceGroupsRef.current;
    const views = state[groupId]?.views || [];
    const fromIndex = views.findIndex((view) => view.viewId === viewId);
    if (fromIndex < 0) return;
    let toIndex = beforeViewId ? views.findIndex((view) => view.viewId === beforeViewId) : views.length - 1;
    if (toIndex < 0) toIndex = views.length - 1;
    if (beforeViewId && fromIndex < toIndex) toIndex -= 1;
    commitWorkspaceGroups(reorderWorkspaceView(state, groupId, viewId, toIndex));
  }, [commitWorkspaceGroups]);

  const handleMoveGroupDocument = useCallback((viewId, targetGroupId, beforeViewId = null) => {
    const state = workspaceGroupsRef.current;
    const location = findWorkspaceView(state, viewId);
    if (!location || location.view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT) return;
    if (location.groupId === targetGroupId) {
      handleReorderGroupView(targetGroupId, viewId, beforeViewId);
      return;
    }
    if (location.groupId === WORKSPACE_GROUP_ID.PRIMARY && state.primary.views.length <= 1) {
      showStatus("左侧编辑组至少需要保留一个信笺", "warning");
      return;
    }
    const targetViews = state[targetGroupId]?.views || [];
    let insertionIndex = beforeViewId ? targetViews.findIndex((view) => view.viewId === beforeViewId) : targetViews.length;
    if (insertionIndex < 0) insertionIndex = targetViews.length;
    const snapshot = snapshotLiveTabs({ includeEditorJson: true });
    openTabsRef.current = snapshot;
    setOpenTabs(snapshot);
    const next = moveWorkspaceDocument(state, location.view.viewId, targetGroupId, insertionIndex);
    if (next === state) return;
    commitWorkspaceGroups(next);
    if (targetGroupId === WORKSPACE_GROUP_ID.PRIMARY) {
      const tab = snapshot.find((candidate) => candidate.id === location.view.tabId);
      if (tab) {
        activeTabIdRef.current = tab.id;
        setActiveTabId(tab.id);
        applyDocument(tab.document, tab.path, tab.dirty, { editorJson: tab.editorJson, scrollState: tab.scrollState });
      }
      setActivePane("main");
    } else {
      if (location.view.tabId === activeTabIdRef.current) {
        const nextPrimary = getActiveWorkspaceView(next, WORKSPACE_GROUP_ID.PRIMARY);
        const primaryTab = snapshot.find((candidate) => candidate.id === nextPrimary?.tabId);
        if (primaryTab) {
          activeTabIdRef.current = primaryTab.id;
          setActiveTabId(primaryTab.id);
          applyDocument(primaryTab.document, primaryTab.path, primaryTab.dirty, { editorJson: primaryTab.editorJson, scrollState: primaryTab.scrollState });
        }
      }
      setActivePane("right");
    }
  }, [applyDocument, commitWorkspaceGroups, handleReorderGroupView, showStatus, snapshotLiveTabs]);

  const handleCloseTab = useCallback(
    async (tabId) => {
      if (tabClosePendingIdsRef.current.has(tabId)) return;
      tabClosePendingIdsRef.current.add(tabId);
      try {
      await waitForTabSave(tabId);
      let snapshot = snapshotLiveTabs({ includeEditorJson: true });
      let closingTab = snapshot.find((tab) => tab.id === tabId);
      if (!closingTab) {
        return;
      }
      const groupsBeforeClose = workspaceGroupsRef.current;
      const location = findWorkspaceView(groupsBeforeClose, tabId);
      const isActive = location?.groupId === WORKSPACE_GROUP_ID.SECONDARY
        ? groupsBeforeClose.secondary.activeViewId === location.view.viewId
        : tabId === activeTabId;
      const isDirty = closingTab.dirty;
      if (isDirty) {
        const promptedRevision = liveRevisionByTabRef.current.get(tabId) || 0;
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
        if ((liveRevisionByTabRef.current.get(tabId) || 0) !== promptedRevision) {
          showStatus("关闭确认期间信笺又有修改，请再次确认", "warning");
          return;
        }
        snapshot = snapshotLiveTabs({ includeEditorJson: true });
        closingTab = snapshot.find((tab) => tab.id === tabId);
        if (!closingTab) return;
      }
      if (closingTab.recoveryPath) {
        await bridge.deleteTempDocument?.(recoveryTabId(closingTab)).catch?.(() => {});
      }
      const remaining = snapshot.filter((tab) => tab.id !== tabId);
      if (!remaining.length) {
        const blank = createBlankDocument(letterTemplates, newDocumentTemplateId);
        const nextTab = createDocumentTab(blank);
        const nextGroups = createWorkspaceGroupsState(workspaceDocumentView(nextTab), { splitRatio: groupsBeforeClose.splitRatio });
        commitWorkspaceGroups(nextGroups);
        setActivePane("main");
        openTabsRef.current = [nextTab];
        setOpenTabs([nextTab]);
        activeTabIdRef.current = nextTab.id;
        setActiveTabId(nextTab.id);
        applyDocument(blank, "", false, { scrollState: nextTab.scrollState });
        return;
      }
      let nextTabs = remaining;
      let nextGroups = groupsBeforeClose;
      if (location?.groupId === WORKSPACE_GROUP_ID.PRIMARY && groupsBeforeClose.primary.views.length <= 1) {
        const blank = createBlankDocument(letterTemplates, newDocumentTemplateId);
        const blankTab = createDocumentTab(blank);
        nextTabs = [...remaining, blankTab];
        const blankView = createDocumentWorkspaceView(workspaceDocumentView(blankTab));
        nextGroups = {
          ...groupsBeforeClose,
          primary: { views: [blankView], activeViewId: blankView.viewId },
          focusedGroup: WORKSPACE_GROUP_ID.PRIMARY,
        };
      } else if (location) {
        nextGroups = closeWorkspaceView(groupsBeforeClose, location.groupId, location.view.viewId);
      } else {
        nextGroups = removeWorkspaceViews(groupsBeforeClose, { tabId });
      }
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
      commitWorkspaceGroups(nextGroups);
      const nextPrimaryView = getActiveWorkspaceView(nextGroups, WORKSPACE_GROUP_ID.PRIMARY);
      const nextPrimaryTab = nextTabs.find((tab) => tab.id === nextPrimaryView?.tabId);
      if (location?.groupId === WORKSPACE_GROUP_ID.PRIMARY && nextPrimaryTab) {
        activeTabIdRef.current = nextPrimaryTab.id;
        setActiveTabId(nextPrimaryTab.id);
        applyDocument(nextPrimaryTab.document, nextPrimaryTab.path, nextPrimaryTab.dirty, { editorJson: nextPrimaryTab.editorJson, scrollState: nextPrimaryTab.scrollState });
        if (isActive) setActivePane("main");
      } else if (location?.groupId === WORKSPACE_GROUP_ID.SECONDARY && isActive) {
        const nextSecondary = getActiveWorkspaceView(nextGroups, WORKSPACE_GROUP_ID.SECONDARY);
        if (!nextSecondary) {
          setActiveLibraryItem(null);
          setActivePane("main");
        } else {
          if (nextSecondary.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
            setActiveLibraryItem(researchItemsByViewId[nextSecondary.viewId]
              || (nextSecondary.sourceId ? librarySources.find((source) => source.id === nextSecondary.sourceId) : null)
              || null);
          }
          setActivePane("right");
        }
      }
      } finally {
        tabClosePendingIdsRef.current.delete(tabId);
      }
    },
    [activeTabId, applyDocument, commitWorkspaceGroups, letterTemplates, librarySources, newDocumentTemplateId, researchItemsByViewId, showConfirmDialog, showStatus, snapshotLiveTabs, waitForTabSave],
  );

  const handleCloseGroupView = useCallback(async (groupId, viewId) => {
    const state = workspaceGroupsRef.current;
    const view = state[groupId]?.views?.find((candidate) => candidate.viewId === viewId);
    if (!view) return;
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      await handleCloseTab(view.tabId);
      return;
    }
    void bridge.destroyResearchWebView?.(viewId);
    const next = closeWorkspaceView(state, groupId, viewId);
    commitWorkspaceGroups(next);
    setResearchItemsByViewId((previous) => {
      if (!(viewId in previous)) return previous;
      const copy = { ...previous };
      delete copy[viewId];
      return copy;
    });
    const nextSecondary = getActiveWorkspaceView(next, WORKSPACE_GROUP_ID.SECONDARY);
    if (!nextSecondary) {
      setActiveLibraryItem(null);
      setActiveResearchError("");
      setActivePane("main");
      return;
    }
    if (nextSecondary.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
      setActiveLibraryItem(researchItemsByViewId[nextSecondary.viewId]
        || (nextSecondary.sourceId ? librarySources.find((source) => source.id === nextSecondary.sourceId) : null)
        || null);
    }
    setActivePane("right");
  }, [commitWorkspaceGroups, handleCloseTab, librarySources, researchItemsByViewId]);

  const handleNew = useCallback((groupId) => {
    const tabId = addOrActivateDocumentTab(
      createBlankDocument(letterTemplates, newDocumentTemplateId),
      "",
      false,
      groupId ? { groupId } : {},
    );
    if (!tabId) return;
    showStatus("已新建空白信笺", "success");
  }, [addOrActivateDocumentTab, letterTemplates, newDocumentTemplateId, showStatus]);

  const handleOpen = useCallback(async () => {
    const result = await bridge.openDocument();
    if (result?.canceled) {
      return;
    }
    const tabId = addOrActivateDocumentTab(result.document, result.path, false, { diskRevision: result.diskRevision, readOnly: result.readOnly });
    if (!tabId) return;
    showStatus("文档已打开", "success");
  }, [addOrActivateDocumentTab, showStatus]);

  const handleImportDocument = useCallback(async () => {
    const result = await bridge.importDocument?.();
    if (result?.canceled || !result?.document) return;
    const tabId = addOrActivateDocumentTab(result.document, "", true, { replaceBlank: true });
    if (!tabId) return;
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    showStatus(warnings.length ? `文档已导入；${warnings.length} 项内容已降级，保存后才会生成 .letterpaper` : "文档已导入；保存后才会生成 .letterpaper", warnings.length ? "warning" : "success");
  }, [addOrActivateDocumentTab, showStatus]);

  const handleOpenFolder = useCallback(async () => {
    const result = await bridge.openFolder();
    if (result?.canceled) {
      return;
    }
    setFolderState({
      rootPath: result.folderPath || "",
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
    setFolderState((previous) => ({
      rootPath: previous.rootPath || result.folderPath || path,
      path: result.folderPath || path,
      parentPath: result.parentPath || "",
      folders: result.folders || [],
      files: result.files || [],
      entries: result.entries || [...(result.folders || []), ...(result.files || [])],
      loading: false,
      error: "",
    }));
    setExpandedFolders({});
  }, [showStatus]);

  const refreshFolder = useCallback(async () => {
    if (!folderState.path) {
      return;
    }
    const result = await listFolderWithTimeout(folderState.path);
    if (!result?.canceled) {
      setFolderState((previous) => ({
        rootPath: previous.rootPath || result.folderPath || folderState.path,
        path: result.folderPath || folderState.path,
        parentPath: result.parentPath || "",
        folders: result.folders || [],
        files: result.files || [],
        entries: result.entries || [...(result.folders || []), ...(result.files || [])],
        loading: false,
        error: "",
      }));
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
      const existingTab = openTabs.find((tab) => sameDocumentPath(tab.path, path));
      if (existingTab) {
        if (existingTab.id !== activeTabId) {
          handleSelectTab(existingTab.id);
        }
        return existingTab.id;
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
        showStatus(result?.error ? `打开失败：${result.error}` : "这个文件不是笺间文档", "warning");
        return;
      }
      const tabId = addOrActivateDocumentTab(result.document, result.path, false, { diskRevision: result.diskRevision, readOnly: result.readOnly });
      if (!tabId) {
        showStatus("标签栏已满，请先关闭一个信笺再打开文档", "warning");
        return;
      }
      showStatus("文档已打开", "success");
      return tabId;
    },
    [activeTabId, addOrActivateDocumentTab, handleSelectTab, openTabs, showStatus],
  );

  const handleOpenWorkspaceSearchResult = useCallback(async (result) => {
    if (!result?.path) return;
    const tabId = await handleOpenFolderFile(result.path);
    if (!tabId) return;
    const query = String(result.query || workspaceSearchQuery).trim();
    setSearchMode("");
    setSearchQuery(query);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (activeTabIdRef.current === tabId && sameDocumentPath(currentPathRef.current, result.path)) break;
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
    if (activeTabIdRef.current !== tabId || !sameDocumentPath(currentPathRef.current, result.path)) return;
    if (result.matchField === "title" || result.matchField === "fileName") {
      const input = mainCanvasRef.current?.querySelector?.(".paper-title-input");
      input?.focus?.();
      input?.select?.();
      return;
    }
    if (result.matchField === "author") {
      const input = mainCanvasRef.current?.querySelector?.(".paper-author-input");
      input?.focus?.();
      input?.select?.();
      return;
    }
    const targetEditor = editor;
    if (!targetEditor || !query) return;
    let next = searchDocumentText(targetEditor.state.doc, query);
    if (next.matches.length && Number.isFinite(Number(result.matchStart))) {
      const targetOffset = Number(result.matchStart);
      const closestIndex = next.matches.reduce((best, match, index) => (
        Math.abs(match.plainStart - targetOffset) < Math.abs(next.matches[best].plainStart - targetOffset) ? index : best
      ), 0);
      next = { ...next, activeIndex: closestIndex, activeMatch: next.matches[closestIndex] };
    }
    setDocumentSearchState(next);
    if (next.activeMatch) targetEditor.chain().focus().setTextSelection(next.activeMatch.from).scrollIntoView().run();
  }, [editor, handleOpenFolderFile, workspaceSearchQuery]);

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
    const tabId = addOrActivateDocumentTab(result.document || { ...blank, title: title.trim() }, result.path, false, { diskRevision: result.diskRevision });
    if (!tabId) {
      showStatus("信笺已创建；标签栏已满，请关闭一个标签后从文件夹打开", "warning");
      return;
    }
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

    const renameUpdatedAt = new Date().toISOString();
    if (entry.type === "file") {
      openTabsRef.current
        .filter((tab) => sameDocumentPath(tab.path, entry.path))
        .forEach((tab) => recordTabMutation(tab.id, renameUpdatedAt));
    }
    const nextTabs = openTabsRef.current.map((tab) => {
      if (!pathIsSameOrInside(tab.path, entry.path)) return tab;
      return {
        ...tab,
        path: replacePathPrefix(tab.path, entry.path, result.path),
        ...(entry.type === "file" ? {
          title: nextName.trim(),
          document: { ...tab.document, title: nextName.trim(), updatedAt: renameUpdatedAt },
          dirty: true,
        } : {}),
      };
    });
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    if (pathIsSameOrInside(currentPathRef.current, entry.path)) {
      const nextCurrentPath = replacePathPrefix(currentPathRef.current, entry.path, result.path);
      currentPathRef.current = nextCurrentPath;
      setCurrentPath(nextCurrentPath);
      if (entry.type === "file") {
        const nextDocument = {
          ...documentStateRef.current,
          title: nextName.trim(),
          updatedAt: renameUpdatedAt,
        };
        documentStateRef.current = nextDocument;
        setDocumentState(nextDocument);
      }
      persistSession({ activePath: nextCurrentPath });
    }
    if (entry.type === "folder") {
      setFolderState((previous) => pathIsSameOrInside(previous.path, entry.path)
        ? { ...previous, path: replacePathPrefix(previous.path, entry.path, result.path) }
        : previous);
      setExpandedFolders((previous) => Object.fromEntries(Object.entries(previous).map(([folderPath, value]) => [
        pathIsSameOrInside(folderPath, entry.path)
          ? replacePathPrefix(folderPath, entry.path, result.path)
          : folderPath,
        value,
      ])));
    }

    await refreshTreeAfterEntryChange(result.folderPath || folderState.path);
    showStatus("已重命名", "success");
  }, [folderState.path, persistSession, recordTabMutation, refreshTreeAfterEntryChange, showPromptDialog, showStatus]);

  const handleBackupTreeDocument = useCallback(async (entry) => {
    if (!entry?.path || entry.type !== "file") {
      return;
    }
    const sourceTab = snapshotLiveTabs({ includeEditorJson: true }).find((tab) => sameDocumentPath(tab.path, entry.path));
    if (sourceTab?.dirty) {
      showStatus("请先保存这篇信笺，再复制备份，以便为原件和副本建立稳定身份", "warning");
      return;
    }
    const result = await bridge.backupDocument?.(entry.path);
    if (!result?.ok) {
      showStatus(result?.message || "备份失败", "warning");
      return;
    }
    if (sourceTab && result.sourceDocument && result.sourceDiskRevision) {
      const nextTabs = openTabsRef.current.map((tab) => {
        if (tab.id !== sourceTab.id) return tab;
        const document = mergePersistedDocumentIdentity(tab.document, result.sourceDocument);
        diskRevisionByTabRef.current.set(tab.id, result.sourceDiskRevision);
        return { ...tab, document, diskRevision: result.sourceDiskRevision };
      });
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
      if (sourceTab.id === activeTabIdRef.current) {
        const document = mergePersistedDocumentIdentity(documentStateRef.current, result.sourceDocument);
        documentStateRef.current = document;
        setDocumentState(document);
      }
      persistSession({ tabs: summarizeSessionTabs(nextTabs) });
    }
    await refreshTreeAfterEntryChange(result.folderPath || folderState.path);
    showStatus("备份已复制到当前目录", "success");
  }, [folderState.path, persistSession, refreshTreeAfterEntryChange, showStatus, snapshotLiveTabs]);

  const handleDeleteTreeEntry = useCallback(async (entry) => {
    if (!entry?.path) {
      return;
    }
    const initiallyAffected = openTabsRef.current.filter((tab) => pathIsSameOrInside(tab.path, entry.path));
    const affectedIds = initiallyAffected.map((tab) => tab.id);
    affectedIds.forEach((tabId) => tabClosePendingIdsRef.current.add(tabId));
    try {
      await Promise.all(affectedIds.map((tabId) => waitForTabSave(tabId)));
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      const affectedTabs = snapshot.filter((tab) => pathIsSameOrInside(tab.path, entry.path));
      const dirtyAffectedTabs = affectedTabs.filter((tab) => tab.dirty);
      const promptedRevisions = new Map(
        dirtyAffectedTabs.map((tab) => [tab.id, liveRevisionByTabRef.current.get(tab.id) || 0]),
      );
      const label = entry.type === "file" ? (entry.displayName || entry.name) : entry.name;
      const scope = entry.type === "folder" ? "这个文件夹及其内部内容" : "这个信笺";
      const decision = await showConfirmDialog({
        tone: "warning",
        icon: Trash2,
        eyebrow: entry.type === "folder" ? "删除文件夹" : "删除信笺",
        title: dirtyAffectedTabs.length
          ? `删除并丢弃 ${dirtyAffectedTabs.length} 篇未保存修改？`
          : (entry.type === "folder" ? "删除这个文件夹？" : "删除这个信笺？"),
        message: `确定删除${scope}“${label}”吗？`,
        detail: dirtyAffectedTabs.length
          ? "继续会丢失这些标签中的内存修改；回收站只能恢复最后一次已保存的版本。"
          : "删除后会进入回收站。",
        cancelValue: "cancel",
        actions: [
          {
            value: "delete",
            label: dirtyAffectedTabs.length ? "丢弃修改并删除" : "删除",
            variant: "danger",
            icon: Trash2,
          },
          { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
        ],
      });
      if (decision !== "delete") return;
      if ([...promptedRevisions].some(([tabId, revision]) => (liveRevisionByTabRef.current.get(tabId) || 0) !== revision)) {
        showStatus("删除确认期间信笺又有修改，请再次确认", "warning");
        return;
      }
      const result = await bridge.deleteEntry?.(entry.path);
      if (!result?.ok) {
        showStatus(result?.message || "删除失败", "warning");
        return;
      }

      const removedTabs = snapshot.filter((tab) => pathIsSameOrInside(tab.path, entry.path));
      if (removedTabs.length) {
        let remainingTabs = snapshot.filter((tab) => !pathIsSameOrInside(tab.path, entry.path));
        if (rightSplitTabIdRef.current && removedTabs.some((tab) => tab.id === rightSplitTabIdRef.current)) {
          rightSplitTabIdRef.current = "";
          setRightSplitTabId("");
          setActivePane("main");
        }
        if (!remainingTabs.length) {
          const blank = createBlankDocument(letterTemplates, newDocumentTemplateId);
          remainingTabs = [createDocumentTab(blank)];
        }
        openTabsRef.current = remainingTabs;
        setOpenTabs(remainingTabs);
        if (removedTabs.some((tab) => tab.id === activeTabIdRef.current)) {
          const nextTab = remainingTabs[0];
          activeTabIdRef.current = nextTab.id;
          setActiveTabId(nextTab.id);
          applyDocument(nextTab.document, nextTab.path, nextTab.dirty, { editorJson: nextTab.editorJson, scrollState: nextTab.scrollState });
          persistSession({ activePath: nextTab.path || nextTab.recoveryPath || "" });
        }
      }

      await refreshTreeAfterEntryChange(result.folderPath || folderState.path);
      showStatus("已删除", "success");
    } finally {
      affectedIds.forEach((tabId) => tabClosePendingIdsRef.current.delete(tabId));
    }
  }, [applyDocument, folderState.path, letterTemplates, newDocumentTemplateId, persistSession, refreshTreeAfterEntryChange, showConfirmDialog, showStatus, snapshotLiveTabs, waitForTabSave]);

  const handleMoveTreeEntry = useCallback(async (entry, targetFolderPath) => {
    if (!entry?.path || !targetFolderPath) {
      return;
    }
    const result = await bridge.moveEntry?.(entry.path, targetFolderPath);
    if (!result?.ok) {
      showStatus(result?.message || "移动失败", "warning");
      return;
    }

    const nextTabs = openTabsRef.current.map((tab) => (
      pathIsSameOrInside(tab.path, result.oldPath)
        ? { ...tab, path: replacePathPrefix(tab.path, result.oldPath, result.path) }
        : tab
    ));
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    if (pathIsSameOrInside(currentPathRef.current, result.oldPath)) {
      const nextPath = replacePathPrefix(currentPathRef.current, result.oldPath, result.path);
      currentPathRef.current = nextPath;
      setCurrentPath(nextPath);
      persistSession({ activePath: nextPath });
    }
    if (entry.type === "folder") {
      setFolderState((previous) => pathIsSameOrInside(previous.path, result.oldPath)
        ? { ...previous, path: replacePathPrefix(previous.path, result.oldPath, result.path) }
        : previous);
      setExpandedFolders((previous) => Object.fromEntries(Object.entries(previous).map(([folderPath, value]) => [
        pathIsSameOrInside(folderPath, result.oldPath)
          ? replacePathPrefix(folderPath, result.oldPath, result.path)
          : folderPath,
        value,
      ])));
    }

    await refreshTreeAfterEntryChange(result.sourceParent || folderState.path);
    await refreshTreeAfterEntryChange(result.targetFolderPath || targetFolderPath);
    showStatus("已移动", "success");
  }, [folderState.path, persistSession, refreshTreeAfterEntryChange, showStatus]);

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
      if (!structureWorkEditor || typeof item?.pos !== "number") {
        return;
      }
      setActivePane(structureWorkEditor === rightSplitEditor ? "right" : "main");
      if (item.type === "toc") {
        const tocNode = structureWorkEditor.state.doc.nodeAt(item.pos);
        const selectionPos = Math.min(item.pos + (tocNode?.nodeSize || 1), structureWorkEditor.state.doc.content.size);
        structureWorkEditor.chain().focus().setTextSelection(selectionPos).run();
      } else {
        const selectionPos = Math.min(item.pos + 1, structureWorkEditor.state.doc.content.size);
        structureWorkEditor.chain().focus().setTextSelection(selectionPos).run();
      }
      window.requestAnimationFrame(() => {
        const node = structureWorkEditor.view.nodeDOM(item.pos);
        const element = node?.nodeType === window.Node.ELEMENT_NODE ? node : node?.parentElement;
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [rightSplitEditor, structureWorkEditor],
  );

  const handleSave = useCallback(
    async (saveAs) => {
      try {
        const focusedSecondaryView = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
        if (activePane === "right" && focusedSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
          showStatus("当前活动标签是资料；请先切回信笺再保存", "warning");
          return;
        }
        const targetTab = splitPaneActive && rightSplitTab
          ? rightSplitTab
          : openTabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
        if (!targetTab) return;
        if (sessionClosePendingRef.current || tabClosePendingIdsRef.current.has(targetTab.id)) return;
        const recoveryIdToDelete = targetTab.recoveryPath ? recoveryTabId(targetTab) : "";
        const nextDocument = targetTab.id === rightSplitTab?.id && splitPaneActive
          ? getRightSplitSaveDocument()
          : getSaveDocument();
        if (!nextDocument) return;
        if (targetTab.readOnly || nextDocument?._readOnlyFutureSchema) {
          showStatus("此信笺使用未来格式，当前版本只能只读打开", "warning");
          return;
        }
        const revision = liveRevisionByTabRef.current.get(targetTab.id) || 0;
        const previousDocumentKey = documentRuntimeKey(targetTab.path, targetTab.id);
        const reservedPaths = openTabsRef.current
          .filter((tab) => tab.id !== targetTab.id && tab.path)
          .map((tab) => tab.path);
        const expectedRevision = diskRevisionByTabRef.current.get(targetTab.id) || targetTab.diskRevision || null;
        let result = await queueTabSave(targetTab.id, () => (
          bridge.saveDocument(nextDocument, targetTab.path, saveAs, reservedPaths, expectedRevision)
        ));
        if (result?.conflict) {
          setExternalVersionDetected(true);
          setPersistenceState("external");
          const decision = await showConfirmDialog({
            tone: "warning",
            icon: RefreshCw,
            eyebrow: "检测到外部版本",
            title: "磁盘上的信笺已被其他程序修改",
            message: "磁盘版本已保留；当前内存稿也已保存为带时间戳的本机冲突副本。",
            detail: result.conflictCopyPath,
            cancelValue: "cancel",
            actions: [
              { value: "compare", label: "对照查看", variant: "primary" },
              { value: "reload", label: "重新载入磁盘版", variant: "secondary" },
              { value: "overwrite", label: "明确覆盖磁盘版", variant: "danger" },
              { value: "cancel", label: "稍后处理", variant: "ghost" },
            ],
          });
          if (decision === "overwrite") {
            result = await queueTabSave(targetTab.id, () => bridge.saveDocument(
              nextDocument,
              targetTab.path,
              false,
              reservedPaths,
              result.actualRevision,
              { conflictAction: "overwrite" },
            ));
            if (result?.conflict) {
              setExternalVersionDetected(true);
              setPersistenceState("external");
              showStatus("确认覆盖期间又检测到新的外部版本；未覆盖磁盘，并再次保留了本机冲突副本", "warning");
              return;
            }
          } else if (decision === "reload") {
            const reloaded = await bridge.openDocumentPath(targetTab.path);
            if (!reloaded?.canceled && reloaded?.document) {
              diskRevisionByTabRef.current.set(targetTab.id, reloaded.diskRevision);
              dirtyTabIdsRef.current.delete(targetTab.id);
              const normalizedReload = normalizeDocument(reloaded.document, letterTemplates);
              const nextTabs = openTabsRef.current.map((tab) => tab.id === targetTab.id ? { ...tab, document: normalizedReload, dirty: false, diskRevision: reloaded.diskRevision, externalChanged: false } : tab);
              openTabsRef.current = nextTabs;
              setOpenTabs(nextTabs);
              if (targetTab.id === activeTabIdRef.current) applyDocument(normalizedReload, targetTab.path, false);
              setPersistenceState("workspace");
              setExternalVersionDetected(false);
            }
            showStatus("已重新载入磁盘版本；内存稿保留在冲突副本中", "success");
            return;
          } else if (decision === "compare") {
            const diskResult = await bridge.openDocumentPath(targetTab.path);
            if (!diskResult?.canceled && diskResult?.document) {
              const comparisonId = addOrActivateDocumentTab({
                ...diskResult.document,
                title: `${diskResult.document.title || targetTab.title || "未命名信笺"}（磁盘版本对照）`,
              }, "", false, { readOnly: true });
              if (comparisonId) {
                rightSplitTabIdRef.current = targetTab.id;
                setRightSplitTabId(targetTab.id);
                setActivePane("main");
              }
            }
            showStatus("已在只读视图中打开磁盘版本；右侧保留当前内存稿，冲突副本也已写入磁盘", "success");
            return;
          } else {
            showStatus("两个版本都已保留，正文未被覆盖", "warning");
            return;
          }
        }
        if (result?.canceled) return;
        if (!result?.path) throw new Error("保存完成后没有返回文件路径");
        const unchanged = (liveRevisionByTabRef.current.get(targetTab.id) || 0) === revision;
        const savedDocument = normalizeDocument(result.document || nextDocument, letterTemplates);
        if (result.diskRevision) diskRevisionByTabRef.current.set(targetTab.id, result.diskRevision);
        migrateAiRequestDocumentKey(previousDocumentKey, documentRuntimeKey(result.path, targetTab.id));
        const latestSnapshot = unchanged ? openTabsRef.current : snapshotLiveTabs({ includeEditorJson: true });
        const latestTargetTab = latestSnapshot.find((tab) => tab.id === targetTab.id) || targetTab;
        const livePersistedDocument = unchanged
          ? savedDocument
          : mergePersistedDocumentIdentity(latestTargetTab.document || nextDocument, savedDocument);
        let recoveryWrite = null;
        let recoveryWriteError = null;
        if (unchanged) {
          dirtyTabIdsRef.current.delete(targetTab.id);
        } else {
          try {
            recoveryWrite = await queueTabSave(targetTab.id, () => bridge.saveTempDocument?.(
              livePersistedDocument,
              recoveryTabId(latestTargetTab),
            ));
            if (recoveryWrite?.canceled || !recoveryWrite?.path) throw new Error("恢复缓存未生成文件");
          } catch (error) {
            recoveryWriteError = error;
          }
        }
        const nextTabs = latestSnapshot.map((tab) => (
          tab.id === targetTab.id
            ? {
                ...tab,
                path: result.path,
                recoveryPath: unchanged ? "" : (recoveryWrite?.path || tab.recoveryPath || ""),
                recoveryId: unchanged ? "" : (recoveryWrite?.recoveryId || tab.recoveryId || recoveryTabId(tab)),
                recoverySourcePath: unchanged ? "" : (recoveryWrite?.path ? result.path : tab.recoverySourcePath || ""),
                recoveryBaseRevision: unchanged ? null : (recoveryWrite?.path ? normalizeSessionDiskRevision(result.diskRevision) : tab.recoveryBaseRevision || null),
                recoveredTemporary: unchanged ? false : Boolean(recoveryWrite?.path || tab.recoveryPath),
                title: livePersistedDocument.title,
                document: livePersistedDocument,
                diskRevision: result.diskRevision || tab.diskRevision,
                externalChanged: false,
                dirty: !unchanged,
              }
            : tab
        ));
        openTabsRef.current = nextTabs;
        setOpenTabs(nextTabs);
        if (targetTab.id === activeTabIdRef.current) {
          currentPathRef.current = result.path;
          setCurrentPath(result.path);
          dirtyRef.current = !unchanged;
          setDirty(!unchanged);
          documentStateRef.current = livePersistedDocument;
          setDocumentState(livePersistedDocument);
          setExternalVersionDetected(false);
          setPersistenceState(unchanged ? "workspace" : (recoveryWrite?.path ? "recovery" : "dirty"));
        }
        const activeSessionTab = nextTabs.find((tab) => tab.id === activeTabIdRef.current) || nextTabs[0];
        persistSession({ activePath: activeSessionTab?.path || activeSessionTab?.recoveryPath || "", tabs: summarizeSessionTabs(nextTabs) });
        refreshFolder();
        const recoveryCleaned = unchanged
          ? await deleteRecoveryBestEffort(bridge.deleteTempDocument, recoveryIdToDelete)
          : true;
        if (unchanged && !recoveryCleaned) {
          showStatus("文档已保存，但旧恢复文件清理失败", "warning");
        } else if (!unchanged && recoveryWriteError) {
          showStatus(`已写入点击保存时的版本，但后续编辑写入恢复缓存失败：${recoveryWriteError?.message || "稍后将重试"}`, "warning");
        } else if (!unchanged) {
          showStatus("已写入点击保存时的版本；保存期间的新编辑已写入恢复缓存", "success");
        } else {
          showStatus(targetTab.id === rightSplitTab?.id && splitPaneActive ? "右分屏信笺已保存" : "文档已保存", "success");
        }
      } catch (error) {
        showStatus(error?.message || "文档保存失败", "warning");
      }
    },
    [activePane, addOrActivateDocumentTab, applyDocument, getRightSplitSaveDocument, getSaveDocument, letterTemplates, migrateAiRequestDocumentKey, persistSession, queueTabSave, refreshFolder, rightSplitTab, showConfirmDialog, showStatus, snapshotLiveTabs, splitPaneActive],
  );

  useEffect(() => {
    const unsubscribe = bridge.onCloseRequest?.(async (payload = {}) => {
      if (sessionClosePendingRef.current) return;
      sessionClosePendingRef.current = true;
      let closeCommitted = false;
      try {
      await Promise.all([...saveQueueByTabRef.current.values()]);
      const snapshot = snapshotLiveTabs();
      const dirtyTabs = snapshot.filter((tab) => tab.dirty);
      const promptedRevisions = new Map(
        dirtyTabs.map((tab) => [tab.id, tab.snapshotRevision]),
      );
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

        if (decision === "discard") {
          const latestSnapshot = snapshotLiveTabs();
          const changedWhileConfirming = latestSnapshot.some((tab) => (
            tab.dirty
            && (
              !promptedRevisions.has(tab.id)
              || tab.snapshotRevision !== promptedRevisions.get(tab.id)
            )
          ));
          if (changedWhileConfirming) {
            showStatus("关闭确认期间文档又有修改，请再次确认", "warning");
            await bridge.closeCanceled?.(payload);
            return;
          }
          const latestDirtyTabs = latestSnapshot.filter((tab) => tab.dirty);
          await Promise.allSettled(
            latestDirtyTabs.filter((tab) => !tab.path && tab.recoveryPath)
              .map((tab) => bridge.deleteTempDocument?.(recoveryTabId(tab))),
          );
          const discardedIds = new Set(latestDirtyTabs.filter((tab) => !tab.path).map((tab) => tab.id));
          finalTabs = latestSnapshot.filter((tab) => !discardedIds.has(tab.id));
        }

        if (decision === "save") {
          finalTabs = snapshotLiveTabs();
          const savedTabs = [];
          try {
            for (const tab of finalTabs) {
              if (!snapshotRevisionIsCurrent(tab, liveRevisionByTabRef.current)) {
                showStatus("保存期间文档又有修改，请确认内容后再次关闭", "warning");
                await bridge.closeCanceled?.(payload);
                return;
              }
              if (!tab.dirty) {
                savedTabs.push(tab);
                continue;
              }
              const result = await queueTabSave(tab.id, () => (tab.path
                ? bridge.saveDocument(tab.document, tab.path, false, [], diskRevisionByTabRef.current.get(tab.id) || tab.diskRevision || null)
                : bridge.saveTempDocument?.(tab.document, recoveryTabId(tab))));
              if (result?.conflict) {
                throw new Error(`检测到外部版本；内存稿已保存为冲突副本：${result.conflictCopyPath}`);
              }
              if (result?.canceled || !result?.path) {
                await bridge.closeCanceled?.(payload);
                return;
              }
              if (tab.path && result.diskRevision) diskRevisionByTabRef.current.set(tab.id, result.diskRevision);
              if (!snapshotRevisionIsCurrent(tab, liveRevisionByTabRef.current)) {
                showStatus("保存期间文档又有修改，请确认内容后再次关闭", "warning");
                await bridge.closeCanceled?.(payload);
                return;
              }
              savedTabs.push({
                ...tab,
                path: tab.path ? result.path : "",
                recoveryPath: tab.path ? "" : result.path,
                recoveryId: tab.path ? "" : (result.recoveryId || recoveryTabId(tab)),
                recoveredTemporary: !tab.path,
                document: result.document || tab.document,
                diskRevision: result.diskRevision || tab.diskRevision,
                recoverySourcePath: tab.path ? "" : tab.recoverySourcePath,
                recoveryBaseRevision: tab.path ? null : tab.recoveryBaseRevision,
                dirty: !tab.path,
              });
            }
            const savedSnapshotById = new Map(savedTabs.map((tab) => [tab.id, tab]));
            const changedAfterSaving = openTabsRef.current.some((tab) => {
              const savedSnapshot = savedSnapshotById.get(tab.id);
              return !savedSnapshot || !snapshotRevisionIsCurrent(savedSnapshot, liveRevisionByTabRef.current);
            });
            if (changedAfterSaving) {
              showStatus("保存期间文档又有修改，请确认内容后再次关闭", "warning");
              await bridge.closeCanceled?.(payload);
              return;
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
        activePath: activeTab?.path || activeTab?.recoveryPath || "",
        tabs: summarizeSessionTabs(finalTabs),
      });
      await bridge.closeReady?.(payload);
      closeCommitted = true;
      } finally {
        if (!closeCommitted) sessionClosePendingRef.current = false;
      }
    });
    return () => unsubscribe?.();
  }, [persistSession, queueTabSave, showConfirmDialog, showStatus, snapshotLiveTabs]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (autosaveRunningRef.current || sessionClosePendingRef.current) return;
      autosaveRunningRef.current = true;
      try {
        const snapshot = snapshotLiveTabs();
        const dirtyTabs = selectAutosaveSnapshotTabs(
          snapshot,
          saveQueueByTabRef.current,
          tabClosePendingIdsRef.current,
        );
        if (!dirtyTabs.length) return;
        const updates = new Map();
        for (const tab of dirtyTabs) {
          if (saveQueueByTabRef.current.has(tab.id) || !snapshotRevisionIsCurrent(tab, liveRevisionByTabRef.current)) {
            continue;
          }
          try {
            const result = await queueTabSave(tab.id, () => bridge.saveTempDocument?.(tab.document, recoveryTabId(tab)));
            if (result?.canceled || !result?.path) throw new Error("自动保存没有生成可恢复文件");
            updates.set(tab.id, {
              path: result.path,
              sourcePath: tab.path || "",
              baseRevision: normalizeSessionDiskRevision(diskRevisionByTabRef.current.get(tab.id) || tab.diskRevision),
              recoveryId: result.recoveryId || recoveryTabId(tab),
              snapshotRevision: tab.snapshotRevision,
            });
          } catch (error) {
            const now = Date.now();
            if (now - autosaveErrorAtRef.current > 5 * 60 * 1000) {
              autosaveErrorAtRef.current = now;
              showStatus(error?.message || "自动保存失败，将在稍后重试", "warning");
            }
          }
        }
        if (!updates.size) return;
        const nextTabs = openTabsRef.current.map((tab) => {
          const update = updates.get(tab.id);
          if (!update) return tab;
          const targetUnchanged = sameDocumentPath(tab.path || "", update.sourcePath);
          if (!targetUnchanged) return tab;
          return {
            ...tab,
            recoveryPath: update.path,
            recoveryId: update.recoveryId,
            recoverySourcePath: update.sourcePath,
            recoveryBaseRevision: update.baseRevision,
            recoveredTemporary: true,
            dirty: true,
          };
        });
        openTabsRef.current = nextTabs;
        setOpenTabs(nextTabs);
        const activeId = activeTabIdRef.current;
        if (updates.has(activeId)) {
          const activeRecoveryTab = nextTabs.find((tab) => tab.id === activeId);
          setPersistenceState(activeRecoveryTab?.externalChanged ? "external" : "recovery");
        }
        persistSession({
          activePath: nextTabs.find((tab) => tab.id === activeId)?.path
            || nextTabs.find((tab) => tab.id === activeId)?.recoveryPath
            || "",
          tabs: summarizeSessionTabs(nextTabs),
        });
      } finally {
        autosaveRunningRef.current = false;
      }
    }, 30000);

    return () => window.clearInterval(timer);
  }, [persistSession, queueTabSave, showStatus, snapshotLiveTabs]);

  const flushDirtyWorkspaceTabs = useCallback(async ({ idleOnly = false } = {}) => {
    if (sessionClosePendingRef.current) return;
    const now = Date.now();
    const snapshot = snapshotLiveTabs();
    const candidates = snapshot.filter((tab) => tab.path && tab.dirty && !tab.readOnly && !tab.externalChanged
      && (!idleOnly || now - (lastEditAtByTabRef.current.get(tab.id) || now) >= 5 * 60 * 1000));
    for (const tab of candidates) {
      if (saveQueueByTabRef.current.has(tab.id) || !snapshotRevisionIsCurrent(tab, liveRevisionByTabRef.current)) continue;
      try {
        const expectedRevision = diskRevisionByTabRef.current.get(tab.id) || tab.diskRevision || null;
        const result = await queueTabSave(tab.id, () => bridge.saveDocument(tab.document, tab.path, false, [], expectedRevision));
        if (result?.conflict) {
          setOpenTabs((previous) => {
            const next = previous.map((item) => item.id === tab.id ? { ...item, externalChanged: true } : item);
            openTabsRef.current = next;
            return next;
          });
          if (tab.id === activeTabIdRef.current) {
            setExternalVersionDetected(true);
            setPersistenceState("external");
          }
          showStatus(`检测到外部版本；本机稿已保留为冲突副本`, "warning");
          continue;
        }
        if (!result?.path) continue;
        if (result.diskRevision) diskRevisionByTabRef.current.set(tab.id, result.diskRevision);
        if (!snapshotRevisionIsCurrent(tab, liveRevisionByTabRef.current)) continue;
        dirtyTabIdsRef.current.delete(tab.id);
        const nextTabs = openTabsRef.current.map((item) => item.id === tab.id ? {
          ...item,
          document: result.document || tab.document,
          diskRevision: result.diskRevision,
          recoveryPath: "",
          recoveryId: "",
          recoverySourcePath: "",
          recoveryBaseRevision: null,
          recoveredTemporary: false,
          dirty: false,
          externalChanged: false,
        } : item);
        openTabsRef.current = nextTabs;
        setOpenTabs(nextTabs);
        if (tab.id === activeTabIdRef.current) {
          dirtyRef.current = false;
          setDirty(false);
          setPersistenceState("workspace");
          setExternalVersionDetected(false);
        }
        if (tab.recoveryPath) await bridge.deleteTempDocument?.(recoveryTabId(tab)).catch?.(() => {});
      } catch (error) {
        const timestamp = Date.now();
        if (timestamp - autosaveErrorAtRef.current > 5 * 60 * 1000) {
          autosaveErrorAtRef.current = timestamp;
          showStatus(error?.message || "工作区自动写入失败，将继续保留恢复缓存", "warning");
        }
      }
    }
    persistSession({ tabs: summarizeSessionTabs(openTabsRef.current) });
  }, [persistSession, queueTabSave, showStatus, snapshotLiveTabs]);

  useEffect(() => {
    const timer = window.setInterval(() => flushDirtyWorkspaceTabs({ idleOnly: true }), 30000);
    return () => window.clearInterval(timer);
  }, [flushDirtyWorkspaceTabs]);

  useEffect(() => bridge.onWindowBlur?.(() => flushDirtyWorkspaceTabs({ idleOnly: false })), [flushDirtyWorkspaceTabs]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && searchMode) {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const state = workspaceGroupsRef.current;
      const focusedGroupId = activePane === "right" && state.secondary.views.length
        ? WORKSPACE_GROUP_ID.SECONDARY
        : WORKSPACE_GROUP_ID.PRIMARY;
      const focusedView = getActiveWorkspaceView(state, focusedGroupId);
      const focusedResearch = focusedGroupId === WORKSPACE_GROUP_ID.SECONDARY
        && focusedView?.kind === WORKSPACE_VIEW_KIND.RESEARCH;
      if (!event.altKey && key === "w") {
        if (window.document.querySelector("[role='dialog'],[role='alertdialog']")) return;
        event.preventDefault();
        if (focusedView) void handleCloseGroupView(focusedGroupId, focusedView.viewId);
        return;
      }
      if (event.altKey && key === "i") {
        event.preventDefault();
        handleImportDocument();
      } else if (event.altKey && key === "e") {
        event.preventDefault();
        setExportDialogOpen(true);
      } else if (!event.altKey && key === "n") {
        event.preventDefault();
        handleNew();
      } else if (!event.altKey && key === "o") {
        event.preventDefault();
        handleOpen();
      } else if (key === "s") {
        event.preventDefault();
        handleSave(event.shiftKey);
      } else if (key === "f") {
        event.preventDefault();
        if (focusedResearch) {
          closeSearch();
          window.dispatchEvent(new CustomEvent("paper-pdf-find"));
        } else openSearch("document");
      } else if (key === "h") {
        event.preventDefault();
        if (!focusedResearch) openSearch("document", { replace: true });
      } else if (key === "p") {
        event.preventDefault();
        openSearch("workspace");
      }
    };

    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [activePane, closeSearch, handleCloseGroupView, handleImportDocument, handleNew, handleOpen, handleSave, openSearch, searchMode]);

  const handleExportPdf = useCallback(async (targetPath) => {
    const nextDocument = getSaveDocument();
    setDocumentState(nextDocument);
    setPrintMode(true);
    let restorePrintPaperBackground = () => {};
    try {
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
      const printSheet = window.document.querySelector(".canvas.print-mode .paper-sheet");
      restorePrintPaperBackground = applyPrintPaperBackground(printSheet);
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      const result = await bridge.exportPdf(nextDocument.title, targetPath);
      if (!result?.canceled) {
        showStatus("PDF 已导出", "success");
      }
      return result;
    } finally {
      restorePrintPaperBackground();
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

  const handleExportEditable = useCallback(async (format, targetPath) => {
    const nextDocument = getSaveDocument();
    setDocumentState(nextDocument);
    const exchangeDocument = {
      ...nextDocument,
      comments: [],
      aiState: createEmptyAiState(),
    };
    const result = await bridge.exportEditable?.(exchangeDocument, format, targetPath);
    if (!result?.canceled) {
      const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      showStatus(warnings.length ? `${format.toUpperCase()} 已导出；有 ${warnings.length} 项降级` : `${format.toUpperCase()} 已导出`, warnings.length ? "warning" : "success");
    }
    return result;
  }, [getSaveDocument, showStatus]);

  const handleInsertImage = useCallback(async () => {
    let result;
    try {
      result = await bridge.pickImage();
    } catch (error) {
      showStatus(error?.message || "图片暂存失败，未插入文档", "warning");
      return;
    }
    if (result?.canceled) {
      return;
    }
    if (result?.error === "unsupported-type") {
      showStatus("不支持这种图片格式，请选择 PNG、JPEG、GIF、WebP、BMP、SVG 或 AVIF", "warning");
      return;
    }
    const src = normalizeImageSource(result?.src || result?.dataUrl);
    if (!src) {
      showStatus("图片资源地址无效，未插入文档", "warning");
      return;
    }
    activeWorkEditor?.chain().focus().setImage({
      src,
      alt: normalizeImageText(result.name || "图片"),
      caption: "",
      width: "78%",
      imageId: createDocumentId(),
    }).run();
  }, [activeWorkEditor, showStatus]);

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
    const mediaSource = normalizeMediaSource(result.src || result.dataUrl, kind);
    if (result.error || !mediaSource) {
      showStatus(`${label}文件读取失败`, "warning");
      return;
    }
    activeWorkEditor?.chain().focus().insertContent({
      type: "paperMedia",
      attrs: {
        kind,
        src: mediaSource,
        fileName: normalizeMediaFileName(result.fileName || result.name, `未命名${label}`),
        mime: normalizeMediaMime(result.mime, kind),
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
      type: "paperExternalLink",
      attrs: { href: url, label: text },
    };
    linkDialog.editor
      .chain()
      .focus()
      .insertContentAt({ from: linkDialog.from, to: linkDialog.to }, content)
      .setTextSelection(linkDialog.from + 1)
      .run();
    setLinkDialog(null);
    showStatus(linkDialog.editing ? "链接已更新" : "链接已插入", "success");
  }, [linkDialog, showStatus]);

  const handleRemoveLink = useCallback(() => {
    if (!linkDialog?.editor) {
      return;
    }
    const label = String(linkDialog.text || "");
    linkDialog.editor.chain().focus().insertContentAt(
      { from: linkDialog.from, to: linkDialog.to },
      label ? { type: "text", text: label } : "",
    ).setTextSelection(linkDialog.from + label.length).run();
    setLinkDialog(null);
    showStatus("链接已移除", "success");
  }, [linkDialog, showStatus]);

  const updateDocumentSetting = useCallback((patch) => {
    const updatedAt = new Date().toISOString();
    recordTabMutation(activeTabIdRef.current, updatedAt);
    const nextDocument = {
      ...documentStateRef.current,
      ...patch,
      updatedAt,
    };
    documentStateRef.current = nextDocument;
    setDocumentState(nextDocument);
  }, [recordTabMutation]);

  const handleApplyTabTemplate = useCallback((tabId, letterTemplateId) => {
    const letterTemplate = letterTemplates.find((template) => template.id === letterTemplateId);
    if (!tabId || !letterTemplate) {
      showStatus("没有找到要使用的模板", "warning");
      return false;
    }

    const snapshot = snapshotLiveTabs({ includeEditorJson: true });
    const targetTab = snapshot.find((tab) => tab.id === tabId);
    const sourceDocument = tabId === activeTabIdRef.current
      ? documentStateRef.current
      : targetTab?.document;
    if (!targetTab || !sourceDocument) {
      showStatus("没有找到要修改的信笺", "warning");
      return false;
    }
    if (targetTab.readOnly || sourceDocument._readOnlyFutureSchema) {
      showStatus("未来格式信笺为只读，不能切换模板", "warning");
      return false;
    }
    if (getLetterTemplate(sourceDocument, letterTemplates).id === letterTemplate.id) {
      showStatus(`“${targetTab.title || "当前信笺"}”已在使用“${letterTemplate.label}”`, "success");
      return true;
    }

    const updatedAt = new Date().toISOString();
    const nextDocument = applyLetterTemplateToDocument(sourceDocument, letterTemplate, updatedAt);
    const nextTabs = snapshot.map((tab) => (
      tab.id === tabId
        ? { ...tab, document: nextDocument, dirty: true }
        : tab
    ));
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    if (tabId === activeTabIdRef.current) {
      documentStateRef.current = nextDocument;
      setDocumentState(nextDocument);
    }
    recordTabMutation(tabId, updatedAt);
    showStatus(`已为“${targetTab.title || "当前信笺"}”使用“${letterTemplate.label}”`, "success");
    return true;
  }, [letterTemplates, recordTabMutation, showStatus, snapshotLiveTabs]);

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
    const snapshot = snapshotLiveTabs({ includeEditorJson: true });
    const affectedTabIds = snapshot
      .filter((tab) => {
        const sourceDocument = tab.id === activeTabIdRef.current ? documentStateRef.current : tab.document;
        return sourceDocument?.letterTemplateId === templateId;
      })
      .map((tab) => tab.id);
    if (affectedTabIds.length) {
      const affectedIds = new Set(affectedTabIds);
      const updatedAt = new Date().toISOString();
      const nextTabs = snapshot.map((tab) => {
        if (!affectedIds.has(tab.id)) return tab;
        const sourceDocument = tab.id === activeTabIdRef.current ? documentStateRef.current : tab.document;
        return {
          ...tab,
          document: applyLetterTemplateToDocument(sourceDocument, documentFallback, updatedAt),
          dirty: true,
        };
      });
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
      if (affectedIds.has(activeTabIdRef.current)) {
        const activeDocument = nextTabs.find((tab) => tab.id === activeTabIdRef.current)?.document;
        if (activeDocument) {
          documentStateRef.current = activeDocument;
          setDocumentState(activeDocument);
        }
      }
      affectedTabIds.forEach((tabId) => recordTabMutation(tabId, updatedAt));
      const defaultFallbackMessage = wasNewDocumentDefault
        ? `；新建默认已恢复为“${newDocumentFallback.label}”`
        : "";
      const affectedMessage = affectedTabIds.length === 1 ? "1 个打开的信笺" : `${affectedTabIds.length} 个打开的信笺`;
      showStatus(`已删除“${template.label}”，${affectedMessage}已切换为“${documentFallback.label}”${defaultFallbackMessage}`, "success");
      return;
    }
    if (wasNewDocumentDefault) {
      showStatus(`已删除“${template.label}”，新建默认模板已恢复为“${newDocumentFallback.label}”`, "success");
      return;
    }
    showStatus(`已删除用户模板“${template.label}”`, "success");
  }, [letterTemplates, newDocumentTemplateHistory, newDocumentTemplateId, recordTabMutation, showStatus, snapshotLiveTabs, userLetterTemplates]);

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

  const handleTabTemplateChange = useCallback(
    (letterTemplateId) => {
      handleApplyTabTemplate(tabTemplateDialog.targetTabId, letterTemplateId);
    },
    [handleApplyTabTemplate, tabTemplateDialog.targetTabId],
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
    if (!result) {
      showStatus("AI 连接测试失败", "warning");
      return { ok: false, message: "AI 连接测试失败" };
    }
    const normalized = normalizePublicAiConfig(result);
    setAiConfig(normalized);
    const message = result.message || "AI 连接测试完成";
    showStatus(message, result.ok ? "success" : "warning");
    return { ...normalized, ok: Boolean(result.ok), message };
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

  const clearActiveAiRequestRefs = useCallback(() => {
    aiRequestIdRef.current = "";
    aiStartedAtRef.current = 0;
    aiPromptTokenEstimateRef.current = 0;
    aiRequestMetaRef.current = { kind: "" };
    aiChatAssistantIdRef.current = "";
  }, []);

  const exitAiMode = useCallback(() => {
    const requestId = aiRequestIdRef.current;
    if (requestId && aiStatus === "streaming") {
      bridge.cancelAi?.(requestId);
    }
    clearActiveAiRequestRefs();
    setAiModeKind("none");
    setAiModeChooserOpen(false);
    if (aiPreviousSidebarsRef.current) {
      setLeftSidebarCollapsed(aiPreviousSidebarsRef.current.left);
      aiPreviousSidebarsRef.current = null;
    }
    const savedLayout = aiSecondaryPaneLayoutRef.current;
    aiSecondaryPaneLayoutRef.current = null;
    if (savedLayout && immersiveMode) {
      immersiveSecondaryPaneLayoutRef.current = savedLayout;
    } else if (savedLayout) {
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      openTabsRef.current = snapshot;
      setOpenTabs(snapshot);
      commitWorkspaceGroups(savedLayout.workspaceGroups);
      const primaryView = getActiveWorkspaceView(savedLayout.workspaceGroups, WORKSPACE_GROUP_ID.PRIMARY);
      const primaryTab = snapshot.find((tab) => tab.id === primaryView?.tabId);
      if (primaryTab && primaryTab.id !== activeTabIdRef.current) {
        activeTabIdRef.current = primaryTab.id;
        setActiveTabId(primaryTab.id);
        applyDocument(primaryTab.document, primaryTab.path, primaryTab.dirty, { editorJson: primaryTab.editorJson, scrollState: primaryTab.scrollState });
      }
      setActivePane(savedLayout.activePane === "right" && savedLayout.workspaceGroups.secondary.views.length ? "right" : "main");
    }
  }, [aiStatus, applyDocument, clearActiveAiRequestRefs, commitWorkspaceGroups, immersiveMode, snapshotLiveTabs]);

  const activateAiMode = useCallback((kind) => {
    if (kind !== "optimize" && kind !== "chat") {
      return false;
    }
    if (!aiHasUsableProvider) {
      showStatus("请先在“设置 > AI 配置”中配置并测试可用模型", "warning");
      return false;
    }
    if (aiModeKind === kind) return true;

    const enteringAiMode = aiModeKind === "none";
    setAiSelectedProvider(effectiveAiProvider);
    if (enteringAiMode) {
      aiPreviousSidebarsRef.current = {
        left: leftSidebarCollapsed,
      };
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      openTabsRef.current = snapshot;
      setOpenTabs(snapshot);
      aiSecondaryPaneLayoutRef.current = immersiveMode && immersiveSecondaryPaneLayoutRef.current
        ? immersiveSecondaryPaneLayoutRef.current
        : { workspaceGroups: workspaceGroupsRef.current, activePane };
      setActivePane("main");
      setLeftSidebarCollapsed(true);
    }
    setAiModeKind(kind);
    if (normalizeAiState(documentStateRef.current?.aiState).lastMode !== kind) {
      updateActiveDocumentAiState((previous) => ({ ...previous, lastMode: kind }));
    }
    if (kind === "chat") {
      aiChatContextRef.current = { signature: "", context: "", images: [] };
    }
    clearActiveAiRequestRefs();
    return true;
  }, [activePane, aiHasUsableProvider, aiModeKind, clearActiveAiRequestRefs, effectiveAiProvider, immersiveMode, leftSidebarCollapsed, showStatus, snapshotLiveTabs, updateActiveDocumentAiState]);

  const requestAiModeChange = useCallback(async (kind) => {
    if (!aiHasUsableProvider) {
      openAiSettings();
      showStatus(AI_MODEL_REQUIRED_MESSAGE, "warning", { duration: 5000, dismissible: true });
      return false;
    }
    if (aiModeKind === kind) {
      setAiModeChooserOpen(false);
      return true;
    }
    if (shouldConfirmAiModeChange({ currentMode: aiModeKind, nextMode: kind, busy: aiStatus === "streaming" })) {
      const currentLabel = aiModeKind === "chat" ? "AI问答" : "AI优化";
      const nextLabel = kind === "chat" ? "AI问答" : "AI优化";
      const decision = await showConfirmDialog({
        tone: "warning",
        icon: Square,
        eyebrow: "切换 AI 模式",
        title: `停止${currentLabel}并切换到${nextLabel}？`,
        message: "当前生成会停止，已经产生的内容会保留。",
        cancelValue: "cancel",
        actions: [
          { value: "switch", label: "停止并切换", variant: "primary", autoFocus: true },
          { value: "cancel", label: "继续当前生成", variant: "ghost" },
        ],
      });
      if (decision !== "switch") return false;
      const requestId = aiRequestIdRef.current;
      if (requestId) bridge.cancelAi?.(requestId);
    }
    const activated = activateAiMode(kind);
    if (activated) {
      setAiPageTransition(kind);
      setAiModeChooserOpen(false);
    }
    return activated;
  }, [activateAiMode, aiHasUsableProvider, aiModeKind, aiStatus, openAiSettings, showConfirmDialog, showStatus]);

  const requestExitAiMode = useCallback(async () => {
    if (aiModeKind === "none") {
      setAiModeChooserOpen(false);
      return true;
    }
    if (shouldConfirmAiModeExit({ currentMode: aiModeKind, busy: aiStatus === "streaming" })) {
      const currentLabel = aiModeKind === "chat" ? "AI问答" : "AI优化";
      const decision = await showConfirmDialog({
        tone: "warning",
        icon: Square,
        eyebrow: "退出 AI 模式",
        title: `停止并退出${currentLabel}？`,
        message: "当前生成会停止，已经产生的内容会保留。",
        cancelValue: "cancel",
        actions: [
          { value: "exit", label: "停止并退出", variant: "primary", autoFocus: true },
          { value: "cancel", label: "继续当前生成", variant: "ghost" },
        ],
      });
      if (decision !== "exit") return false;
    }
    exitAiMode();
    return true;
  }, [aiModeKind, aiStatus, exitAiMode, showConfirmDialog]);

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

  const updateKnowledgeDocument = useCallback((updater) => {
    if (activeWorkReadOnly) {
      showStatus("未来格式信笺为只读，不能修改脚注、引用或关联", "warning");
      return null;
    }
    const editingRightPane = splitPaneActive && rightSplitTabIdRef.current;
    const previous = editingRightPane
      ? (openTabsRef.current.find((tab) => tab.id === rightSplitTabIdRef.current)?.document || rightSplitDocument)
      : documentStateRef.current;
    if (!previous) return null;
    const wasLegacy = Number(previous?.version || 1) < 2;
    const upgraded = normalizeDocumentSchemaV2(previous || {});
    const updatedAt = new Date().toISOString();
    const candidate = typeof updater === "function" ? updater(upgraded) : { ...upgraded, ...(updater || {}) };
    const nextDocument = normalizeDocumentSchemaV2({ ...candidate, updatedAt });
    if (editingRightPane) {
      const tabId = rightSplitTabIdRef.current;
      const nextTabs = openTabsRef.current.map((tab) => (
        tab.id === tabId ? { ...tab, document: nextDocument, title: nextDocument.title || tab.title, dirty: true } : tab
      ));
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
      recordTabMutation(tabId, updatedAt);
    } else {
      documentStateRef.current = nextDocument;
      setDocumentState(nextDocument);
      recordTabMutation(activeTabIdRef.current, updatedAt);
    }
    if (wasLegacy) showStatus("已启用文档格式 v2；首次保存时会保留迁移前备份", "success");
    return nextDocument;
  }, [activeWorkReadOnly, recordTabMutation, rightSplitDocument, showStatus, splitPaneActive]);

  const captureElementInsertTarget = useCallback(() => {
    const state = workspaceGroupsRef.current;
    const groupId = activePane === "right" ? WORKSPACE_GROUP_ID.SECONDARY : WORKSPACE_GROUP_ID.PRIMARY;
    const view = getActiveWorkspaceView(state, groupId);
    if (!view || view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT) return null;
    const targetEditor = groupId === WORKSPACE_GROUP_ID.SECONDARY ? rightSplitEditor : editor;
    const tab = openTabsRef.current.find((candidate) => candidate.id === view.tabId);
    if (!targetEditor || !tab || tab.readOnly || tab.document?._readOnlyFutureSchema) return null;
    const selection = targetEditor.state.selection;
    return {
      requestId: createDocumentId(),
      groupId,
      documentTabId: tab.id,
      selection: { from: selection.from, to: selection.to },
      revision: liveRevisionByTabRef.current.get(tab.id) || 0,
      workspaceRoot: writingWorkspaceRoot || "",
    };
  }, [activePane, editor, rightSplitEditor, writingWorkspaceRoot]);

  const captureStructureManagementTarget = useCallback(() => {
    const state = workspaceGroupsRef.current;
    const secondaryView = getActiveWorkspaceView(state, WORKSPACE_GROUP_ID.SECONDARY);
    const groupId = activePane === "right" && secondaryView?.kind === WORKSPACE_VIEW_KIND.DOCUMENT
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY;
    const view = getActiveWorkspaceView(state, groupId);
    const targetEditor = groupId === WORKSPACE_GROUP_ID.SECONDARY ? rightSplitEditor : editor;
    const tab = openTabsRef.current.find((candidate) => candidate.id === view?.tabId);
    if (!view || view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT || !targetEditor || !tab || tab.readOnly || tab.document?._readOnlyFutureSchema) return null;
    const selection = targetEditor.state.selection;
    return {
      requestId: createDocumentId(),
      groupId,
      documentTabId: tab.id,
      selection: { from: selection.from, to: selection.to },
      revision: liveRevisionByTabRef.current.get(tab.id) || 0,
      workspaceRoot: writingWorkspaceRoot || "",
    };
  }, [activePane, editor, rightSplitEditor, writingWorkspaceRoot]);

  const resolveElementInsertTarget = useCallback((target, options = {}) => {
    if (!target?.documentTabId) return null;
    const state = workspaceGroupsRef.current;
    const location = findWorkspaceView(state, target.documentTabId);
    if (!location || location.groupId !== target.groupId || location.view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT) return null;
    if (state[location.groupId]?.activeViewId !== location.view.viewId) return null;
    const tab = openTabsRef.current.find((candidate) => candidate.id === target.documentTabId);
    if (!tab || tab.readOnly || tab.document?._readOnlyFutureSchema) return null;
    if (!options.allowRevisionChange && (liveRevisionByTabRef.current.get(tab.id) || 0) !== target.revision) return null;
    const targetEditor = location.groupId === WORKSPACE_GROUP_ID.SECONDARY ? rightSplitEditor : editor;
    if (!targetEditor) return null;
    if (location.groupId === WORKSPACE_GROUP_ID.PRIMARY && activeTabIdRef.current !== tab.id) return null;
    if (location.groupId === WORKSPACE_GROUP_ID.SECONDARY && rightSplitTabIdRef.current !== tab.id) return null;
    const maxPosition = targetEditor.state.doc.content.size;
    const from = Math.max(0, Math.min(maxPosition, Number(target.selection?.from) || targetEditor.state.selection.from));
    const to = Math.max(from, Math.min(maxPosition, Number(target.selection?.to) || from));
    return { groupId: location.groupId, tab, editor: targetEditor, selection: { from, to } };
  }, [editor, rightSplitEditor]);

  const updateKnowledgeDocumentForTarget = useCallback((target, updater, options = {}) => {
    const resolved = resolveElementInsertTarget(target, options);
    if (!resolved) return null;
    const { groupId, tab } = resolved;
    const previous = groupId === WORKSPACE_GROUP_ID.PRIMARY ? documentStateRef.current : tab.document;
    if (!previous) return null;
    const wasLegacy = Number(previous?.version || 1) < 2;
    const upgraded = normalizeDocumentSchemaV2(previous);
    const updatedAt = new Date().toISOString();
    const candidate = typeof updater === "function" ? updater(upgraded) : { ...upgraded, ...(updater || {}) };
    const nextDocument = normalizeDocumentSchemaV2({ ...candidate, updatedAt });
    if (groupId === WORKSPACE_GROUP_ID.PRIMARY) {
      documentStateRef.current = nextDocument;
      setDocumentState(nextDocument);
    }
    const nextTabs = openTabsRef.current.map((item) => item.id === tab.id
      ? { ...item, document: nextDocument, title: nextDocument.title || item.title, dirty: true }
      : item);
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    recordTabMutation(tab.id, updatedAt);
    if (wasLegacy) showStatus("已启用文档格式 v2；首次保存时会保留迁移前备份", "success");
    return { ...resolved, document: nextDocument };
  }, [recordTabMutation, resolveElementInsertTarget, showStatus]);

  const insertAtCapturedSelection = useCallback((resolved, content) => {
    if (!resolved?.editor) return false;
    const { from, to } = resolved.selection;
    return resolved.editor.chain().focus().insertContentAt(from === to ? from : { from, to }, content).run();
  }, []);

  const refreshResearchLibrarySources = useCallback(async (libraryId = researchRootRef.current?.libraryId) => {
    if (!libraryId) {
      setLibrarySources([]);
      setLibrarySourcesReady(false);
      return [];
    }
    try {
      const result = await bridge.listResearchLibrarySources?.(libraryId);
      const sources = Array.isArray(result?.sources) ? result.sources : [];
      if (researchRootRef.current?.libraryId !== libraryId) return sources;
      const warningCount = Array.isArray(result?.warnings) ? result.warnings.length : 0;
      const removedNoteCount = Array.isArray(result?.removedNoteSourceIds) ? result.removedNoteSourceIds.length : 0;
      if (warningCount) showStatus(`资料来源读取完成；${warningCount} 项元数据需要检查`, "warning");
      else if (removedNoteCount) showStatus(`已删除 ${removedNoteCount} 条旧笔记资料`, "success");
      setLibrarySources(sources);
      setLibrarySourcesReady(true);
      setActiveLibraryItem((previous) => {
        if (!previous?.id || previous.type === "file") return previous;
        return sources.find((source) => source.id === previous.id) || null;
      });
      return sources;
    } catch (error) {
      if (researchRootRef.current?.libraryId === libraryId) {
        setLibrarySourcesReady(false);
        setResearchTreeError(error?.message || "资料来源读取失败");
      }
      return [];
    }
  }, [showStatus]);

  const refreshResearchWebTree = useCallback(async (libraryId = researchRootRef.current?.libraryId) => {
    if (!libraryId) {
      setWebTreeState({ folders: [], placements: {}, diskRevision: null, warnings: [], readOnly: false });
      return null;
    }
    try {
      const result = await bridge.listResearchWebTree?.(libraryId);
      if (researchRootRef.current?.libraryId !== libraryId) return result;
      const next = {
        folders: Array.isArray(result?.folders) ? result.folders : (Array.isArray(result?.tree?.folders) ? result.tree.folders : []),
        placements: result?.placements && typeof result.placements === "object" ? result.placements : (result?.tree?.placements || {}),
        diskRevision: result?.diskRevision || null,
        warnings: Array.isArray(result?.warnings) ? result.warnings : [],
        readOnly: Boolean(result?.readOnly),
      };
      setWebTreeState(next);
      if (next.warnings.length) showStatus("网页分组索引需要检查；当前以只读扁平列表显示", "warning");
      return result;
    } catch (error) {
      showStatus(error?.message || "网页分组读取失败", "warning");
      return null;
    }
  }, [showStatus]);

  const refreshIndependentResearchFolder = useCallback(async (
    relativePath = "",
    libraryId = researchRootRef.current?.libraryId,
    options = {},
  ) => {
    if (!libraryId) {
      setResearchEntries([]);
      return [];
    }
    const normalizedPath = normalizeResearchRelativePath(relativePath);
    const updateCurrent = options.current === true
      || (options.current !== false && normalizedPath === researchCurrentRelativePathRef.current);
    if (updateCurrent) {
      setResearchTreeLoading(true);
      setResearchTreeError("");
    } else if (normalizedPath) {
      setResearchExpandedFolders((previous) => ({
        ...previous,
        [normalizedPath]: { ...(previous[normalizedPath] || {}), expanded: true, loading: true, error: "" },
      }));
    }
    try {
      const result = await bridge.listResearchFolder?.(libraryId, normalizedPath);
      const entries = normalizeResearchTreeEntries(result?.entries);
      if (researchRootRef.current?.libraryId !== libraryId) return entries;
      if (updateCurrent) {
        if (researchCurrentRelativePathRef.current !== normalizedPath) return entries;
        setResearchEntries(entries);
      } else if (normalizedPath) {
        setResearchEntries((previous) => replaceResearchTreeFolder(previous, normalizedPath, entries));
        setResearchExpandedFolders((previous) => ({
          ...previous,
          [normalizedPath]: { expanded: true, loading: false, error: "", entries },
        }));
      }
      return entries;
    } catch (error) {
      if (researchRootRef.current?.libraryId !== libraryId) return [];
      const message = error?.message || "资料目录读取失败";
      if (updateCurrent && researchCurrentRelativePathRef.current === normalizedPath) setResearchTreeError(message);
      else if (normalizedPath) {
        setResearchExpandedFolders((previous) => ({
          ...previous,
          [normalizedPath]: { ...(previous[normalizedPath] || {}), expanded: true, loading: false, error: message },
        }));
      }
      return [];
    } finally {
      if (updateCurrent && researchRootRef.current?.libraryId === libraryId && researchCurrentRelativePathRef.current === normalizedPath) {
        setResearchTreeLoading(false);
      }
    }
  }, []);

  const applyResearchRoot = useCallback(async (root) => {
    const normalized = root && typeof root === "object" ? root : { configured: false, available: false };
    const previousLibraryId = String(researchRootRef.current?.libraryId || "");
    const nextLibraryId = normalized.available ? String(normalized.libraryId || "") : "";
    const libraryChanged = previousLibraryId !== nextLibraryId;
    const staleResearchPane = Boolean(previousLibraryId && previousLibraryId !== nextLibraryId
      && workspaceGroupsRef.current.secondary.views.some((view) => view.kind === WORKSPACE_VIEW_KIND.RESEARCH && view.libraryId === previousLibraryId));
    if (staleResearchPane) removeOpenResearchViews((view) => view.libraryId === previousLibraryId);
    researchRootRef.current = normalized;
    researchCurrentRelativePathRef.current = "";
    setResearchRoot(normalized);
    setResearchCurrentRelativePath("");
    setResearchEntries([]);
    setResearchExpandedFolders({});
    setResearchTreeLoading(false);
    setResearchBusyKeys([]);
    setLibrarySources([]);
    setLibrarySourcesReady(false);
    setWebTreeState({ folders: [], placements: {}, diskRevision: null, warnings: [], readOnly: false });
    if (libraryChanged || !nextLibraryId || staleResearchPane) {
      setActiveLibraryItem(null);
      setActiveResearchError("");
    }
    setResearchTreeError(normalized?.error || "");
    if (!normalized.available || !normalized.libraryId) return normalized;
    await Promise.all([
      refreshIndependentResearchFolder("", normalized.libraryId, { current: true }),
      refreshResearchLibrarySources(normalized.libraryId),
      refreshResearchWebTree(normalized.libraryId),
      bridge.watchResearchLibrary?.(normalized.libraryId).catch?.(() => null),
    ]);
    return normalized;
  }, [refreshIndependentResearchFolder, refreshResearchLibrarySources, refreshResearchWebTree, removeOpenResearchViews]);

  const refreshResearchRoot = useCallback(async () => {
    try {
      return await applyResearchRoot(await bridge.getResearchRoot?.());
    } catch (error) {
      setResearchTreeError(error?.message || "资料目录配置读取失败");
      return null;
    }
  }, [applyResearchRoot]);

  useEffect(() => {
    void refreshResearchRoot();
  }, [refreshResearchRoot]);

  useEffect(() => {
    if (!researchRoot || typeof researchRoot !== "object") return;
    const libraryId = researchRoot.available ? String(researchRoot.libraryId || "") : "";
    const incompatible = workspaceGroups.secondary.views.filter((view) => (
      view.kind === WORKSPACE_VIEW_KIND.RESEARCH && (!libraryId || view.libraryId !== libraryId)
    ));
    if (incompatible.length) {
      removeOpenResearchViews((view) => !libraryId || view.libraryId !== libraryId);
      return;
    }
    if (librarySourcesReady) {
      const availableSourceIds = new Set(librarySources.filter((source) => {
        if (source.type !== "web") return true;
        if (webWorkspaceIdentityPending) return true;
        return (webTreeState.placements[source.id]?.scopeKey || "global") === webScopeKey;
      }).map((source) => source.id));
      const missingSources = workspaceGroups.secondary.views.filter((view) => (
        view.kind === WORKSPACE_VIEW_KIND.RESEARCH && view.libraryId === libraryId && view.sourceId && !availableSourceIds.has(view.sourceId)
      ));
      if (missingSources.length) {
        const missingIds = new Set(missingSources.map((view) => view.viewId));
        removeOpenResearchViews((view) => missingIds.has(view.viewId));
        return;
      }
    }
    const active = getActiveWorkspaceView(workspaceGroups, WORKSPACE_GROUP_ID.SECONDARY);
    if (active?.kind !== WORKSPACE_VIEW_KIND.RESEARCH || active.libraryId !== libraryId) return;
    const existing = researchItemsByViewId[active.viewId];
    const item = existing
      || (active.sourceId ? librarySources.find((source) => source.id === active.sourceId) : null)
      || (active.relativePath ? librarySources.find((source) => source.type === "file" && source.relativePath === active.relativePath) : null)
      || (active.relativePath ? {
          type: "file",
          relativePath: active.relativePath,
          name: displayNameFromPath(active.relativePath),
        } : null);
    if (!item) return;
    if (!existing) setResearchItemsByViewId((previous) => ({ ...previous, [active.viewId]: item }));
    setActiveLibraryItem((previous) => previous === item ? previous : item);
  }, [librarySources, librarySourcesReady, removeOpenResearchViews, researchItemsByViewId, researchRoot, webScopeKey, webTreeState.placements, webWorkspaceIdentityPending, workspaceGroups]);

  const openResearchTargetSignature = useMemo(() => JSON.stringify(workspaceGroups.secondary.views
    .filter((view) => view.kind === WORKSPACE_VIEW_KIND.RESEARCH)
    .map((view) => [view.viewId, view.libraryId, view.relativePath || "", view.sourceId || ""])), [workspaceGroups.secondary.views]);

  useEffect(() => {
    const libraryId = researchRoot?.available ? String(researchRoot.libraryId || "") : "";
    if (!libraryId) return undefined;
    const fileViews = workspaceGroupsRef.current.secondary.views.filter((view) => (
      view.kind === WORKSPACE_VIEW_KIND.RESEARCH && view.libraryId === libraryId && view.relativePath
    ));
    if (!fileViews.length) return undefined;
    let canceled = false;
    const validate = async () => {
      const byParent = new Map();
      for (const view of fileViews) {
        const separator = view.relativePath.lastIndexOf("/");
        const parent = separator >= 0 ? view.relativePath.slice(0, separator) : "";
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent).push(view);
      }
      const missingViewIds = new Set();
      for (const [parent, views] of byParent) {
        try {
          const result = await bridge.listResearchFolder?.(libraryId, parent);
          if (canceled || !result) return;
          const present = new Set((result.entries || []).map((entry) => String(entry.relativePath || "").replace(/\\/g, "/")));
          for (const view of views) if (!present.has(view.relativePath)) missingViewIds.add(view.viewId);
        } catch {
          return;
        }
      }
      if (!canceled && missingViewIds.size) removeOpenResearchViews((view) => missingViewIds.has(view.viewId));
    };
    void validate();
    return () => { canceled = true; };
  }, [librarySources, openResearchTargetSignature, removeOpenResearchViews, researchRoot?.available, researchRoot?.libraryId]);

  useEffect(() => {
    if (!researchRoot?.libraryId) return undefined;
    let timer = 0;
    const refresh = (payload = {}) => {
      if (payload.libraryId && payload.libraryId !== researchRoot.libraryId) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const currentBrowsePath = researchCurrentRelativePathRef.current;
        void refreshIndependentResearchFolder(currentBrowsePath, researchRoot.libraryId, { current: true });
        const changedPath = String(payload.relativePath || "").replace(/\\/g, "/");
        const separatorIndex = changedPath.lastIndexOf("/");
        const parentPath = separatorIndex >= 0 ? changedPath.slice(0, separatorIndex) : "";
        if (parentPath && parentPath !== currentBrowsePath) {
          void refreshIndependentResearchFolder(parentPath, researchRoot.libraryId, { current: false });
        }
        void refreshResearchLibrarySources(researchRoot.libraryId);
        void refreshResearchWebTree(researchRoot.libraryId);
      }, 120);
    };
    const showWatchError = (payload = {}) => {
      if (!payload.libraryId || payload.libraryId === researchRoot.libraryId) {
        setResearchTreeError(payload.message || "资料目录监听失败，请手动刷新");
      }
    };
    const unsubscribeChanged = bridge.onResearchLibraryChanged?.(refresh);
    const unsubscribeError = bridge.onResearchLibraryWatchError?.(showWatchError);
    return () => {
      window.clearTimeout(timer);
      unsubscribeChanged?.();
      unsubscribeError?.();
    };
  }, [refreshIndependentResearchFolder, refreshResearchLibrarySources, refreshResearchWebTree, researchRoot?.libraryId]);

  const handlePickResearchRoot = useCallback(async () => {
    try {
      const result = await bridge.pickResearchRoot?.();
      if (result?.canceled) return;
      await applyResearchRoot(result);
      setLeftSidebarMode("research");
      showStatus("资料目录已连接", "success");
    } catch (error) {
      showStatus(error?.message || "无法选择资料目录", "warning");
    }
  }, [applyResearchRoot, showStatus]);

  const runResearchEntryMutation = useCallback(async (key, task) => {
    setResearchBusyKeys((previous) => [...new Set([...previous, key].filter(Boolean))]);
    try {
      return await task();
    } finally {
      setResearchBusyKeys((previous) => previous.filter((item) => item !== key));
    }
  }, []);

  const handleToggleResearchFolder = useCallback(async (entry, expanded) => {
    const relativePath = String(entry?.relativePath || "");
    if (!relativePath) return;
    if (!expanded) {
      setResearchExpandedFolders((previous) => ({
        ...previous,
        [relativePath]: { ...(previous[relativePath] || {}), expanded: false, loading: false },
      }));
      return;
    }
    await refreshIndependentResearchFolder(relativePath, undefined, { current: false });
  }, [refreshIndependentResearchFolder]);

  const handleNavigateResearchPath = useCallback(async (relativePath = "") => {
    if (!researchRootRef.current?.libraryId) return;
    const normalizedPath = normalizeResearchRelativePath(relativePath);
    researchCurrentRelativePathRef.current = normalizedPath;
    setResearchCurrentRelativePath(normalizedPath);
    setResearchEntries([]);
    setResearchExpandedFolders({});
    setResearchTreeError("");
    await refreshIndependentResearchFolder(normalizedPath, researchRootRef.current.libraryId, { current: true });
  }, [refreshIndependentResearchFolder]);

  const handleCreateResearchFolder = useCallback(async (entry) => {
    if (!researchRoot?.libraryId) return;
    const libraryId = researchRoot.libraryId;
    const parentRelativePath = researchEntryType(entry) === "folder" ? entry.relativePath : researchCurrentRelativePathRef.current;
    const name = await showPromptDialog({ title: "新建资料文件夹", label: "文件夹名称", defaultValue: "新建文件夹", confirmLabel: "创建" });
    if (!name?.trim()) return;
    const key = entry?.relativePath || "research-root";
    try {
      await runResearchEntryMutation(key, () => bridge.createResearchFolder?.(libraryId, parentRelativePath, name.trim()));
      if (researchRootRef.current?.libraryId !== libraryId) return;
      await refreshIndependentResearchFolder(parentRelativePath, libraryId);
      showStatus("资料文件夹已创建", "success");
    } catch (error) {
      showStatus(error?.message || "资料文件夹创建失败", "warning");
    }
  }, [refreshIndependentResearchFolder, researchRoot?.libraryId, runResearchEntryMutation, showPromptDialog, showStatus]);

  const handleImportResearchFiles = useCallback(async (entry) => {
    if (!researchRoot?.libraryId) return;
    const libraryId = researchRoot.libraryId;
    const targetRelativePath = researchEntryType(entry) === "folder" ? entry.relativePath : researchCurrentRelativePathRef.current;
    const key = entry?.relativePath || "research-root";
    try {
      const result = await runResearchEntryMutation(key, () => bridge.importResearchFiles?.(libraryId, targetRelativePath));
      if (result?.canceled) return;
      if (researchRootRef.current?.libraryId !== libraryId) return;
      await refreshIndependentResearchFolder(targetRelativePath, libraryId);
      showStatus(`已导入 ${result?.imported?.length || 0} 个资料文件`, "success");
    } catch (error) {
      showStatus(error?.message || "资料文件导入失败", "warning");
    }
  }, [refreshIndependentResearchFolder, researchRoot?.libraryId, runResearchEntryMutation, showStatus]);

  const handleRenameResearchEntry = useCallback(async (entry) => {
    if (!researchRoot?.libraryId || !entry?.relativePath) return;
    const libraryId = researchRoot.libraryId;
    const nextName = await showPromptDialog({ title: "重命名资料项目", label: "新名称", defaultValue: entry.name || "", confirmLabel: "重命名" });
    if (!nextName?.trim() || nextName.trim() === entry.name) return;
    try {
      const result = await runResearchEntryMutation(entry.relativePath, () => bridge.renameResearchEntry?.(libraryId, entry.relativePath, nextName.trim()));
      if (researchRootRef.current?.libraryId !== libraryId) return;
      setResearchExpandedFolders({});
      await refreshIndependentResearchFolder(researchCurrentRelativePathRef.current, libraryId, { current: true });
      updateOpenResearchTargets(libraryId, entry.relativePath, result.relativePath, { name: nextName.trim() });
      if (activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH && activeSecondaryView.libraryId === libraryId
        && activeSecondaryView.relativePath === entry.relativePath) {
        setActiveLibraryItem((previous) => previous ? { ...previous, name: nextName.trim(), relativePath: result.relativePath } : previous);
      }
      showStatus(result?.warnings?.length ? "已重命名；部分资料身份路径需手动检查" : "资料项目已重命名", result?.warnings?.length ? "warning" : "success");
    } catch (error) {
      showStatus(error?.message || "重命名失败", "warning");
    }
  }, [activeSecondaryView, refreshIndependentResearchFolder, researchRoot?.libraryId, runResearchEntryMutation, showPromptDialog, showStatus, updateOpenResearchTargets]);

  const handleMoveResearchEntry = useCallback(async (entry, targetEntry) => {
    if (!researchRoot?.libraryId || !entry?.relativePath) return;
    const libraryId = researchRoot.libraryId;
    let targetRelativePath = researchEntryType(targetEntry) === "folder" ? targetEntry.relativePath : researchCurrentRelativePathRef.current;
    if (!targetEntry) {
      const chosen = await showPromptDialog({ title: "移动资料项目", label: "目标文件夹（相对资料目录，根目录留空）", defaultValue: "", confirmLabel: "移动" });
      if (chosen === null) return;
      targetRelativePath = chosen.trim().replace(/\\/g, "/");
    }
    try {
      const result = await runResearchEntryMutation(entry.relativePath, () => bridge.moveResearchEntry?.(libraryId, entry.relativePath, targetRelativePath));
      if (researchRootRef.current?.libraryId !== libraryId) return;
      setResearchExpandedFolders({});
      await refreshIndependentResearchFolder(researchCurrentRelativePathRef.current, libraryId, { current: true });
      updateOpenResearchTargets(libraryId, entry.relativePath, result.relativePath);
      if (activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH && activeSecondaryView.libraryId === libraryId
        && activeSecondaryView.relativePath === entry.relativePath) {
        setActiveLibraryItem((previous) => previous ? { ...previous, relativePath: result.relativePath } : previous);
      }
      showStatus(result?.warnings?.length ? "已移动；部分资料身份路径需手动检查" : "资料项目已移动", result?.warnings?.length ? "warning" : "success");
    } catch (error) {
      showStatus(error?.message || "移动失败", "warning");
    }
  }, [activeSecondaryView, refreshIndependentResearchFolder, researchRoot?.libraryId, runResearchEntryMutation, showPromptDialog, showStatus, updateOpenResearchTargets]);

  const handleTrashResearchEntry = useCallback(async (entry) => {
    if (!researchRoot?.libraryId || !entry?.relativePath) return;
    const libraryId = researchRoot.libraryId;
    const choice = await showConfirmDialog({
      title: "移到系统回收站",
      message: `“${entry.name}”会移到系统回收站；资料身份记录不会被静默覆盖。`,
      actions: [{ value: "trash", label: "移到回收站", tone: "danger" }, { value: "cancel", label: "取消" }],
      cancelValue: "cancel",
    });
    if (choice !== "trash") return;
    try {
      await runResearchEntryMutation(entry.relativePath, () => bridge.trashResearchEntry?.(libraryId, entry.relativePath));
      if (researchRootRef.current?.libraryId !== libraryId) return;
      removeOpenResearchViews((view) => view.libraryId === libraryId
        && Boolean(view.relativePath)
        && (view.relativePath === entry.relativePath || view.relativePath.startsWith(`${entry.relativePath}/`)));
      setResearchExpandedFolders({});
      await refreshIndependentResearchFolder(researchCurrentRelativePathRef.current, libraryId, { current: true });
      showStatus("资料项目已移到回收站", "success");
    } catch (error) {
      showStatus(error?.message || "无法移到回收站", "warning");
    }
  }, [refreshIndependentResearchFolder, removeOpenResearchViews, researchRoot?.libraryId, runResearchEntryMutation, showConfirmDialog, showStatus]);

  const handleCopyResearchPath = useCallback(async (entry) => {
    try {
      await bridge.copyResearchEntryPath?.(researchRoot?.libraryId, entry?.relativePath || "");
      showStatus("资料路径已复制", "success");
    } catch (error) {
      showStatus(error?.message || "路径复制失败", "warning");
    }
  }, [researchRoot?.libraryId, showStatus]);

  const handleShowResearchEntry = useCallback(async (entry) => {
    try {
      await bridge.showResearchEntry?.(researchRoot?.libraryId, entry?.relativePath || "");
    } catch (error) {
      showStatus(error?.message || "无法在资源管理器中显示", "warning");
    }
  }, [researchRoot?.libraryId, showStatus]);

  const openIndependentResearchItem = useCallback(async (item) => {
    if (!researchRoot?.libraryId || !item) return;
    if (researchEntryType(item) === "folder") {
      await handleNavigateResearchPath(item.relativePath);
      return;
    }
    const previewKind = item.type === "web" ? "web" : researchPreviewKind(item);
    if (previewKind === "unsupported" || !canOpenResearchItem(item)) {
      showStatus("此文件类型不支持在笺间打开", "warning");
      return;
    }
    if (aiMode && !(await requestExitAiMode())) return;
    if (previewKind === "document") {
      try {
        const result = await bridge.openResearchDocument?.(researchRoot.libraryId, item.relativePath);
        if (result?.canceled || !result?.document) {
          showStatus(result?.message || "无法打开资料中的笺间文档", "warning");
          return;
        }
        const tabId = addOrActivateDocumentTab(result.document, result.path, false, {
          groupId: WORKSPACE_GROUP_ID.SECONDARY,
          diskRevision: result.diskRevision,
          readOnly: result.readOnly,
        });
        if (!tabId) showStatus("标签栏已满，请先关闭一个标签", "warning");
        else showStatus("资料信笺已在右侧打开", "success");
      } catch (error) {
        showStatus(error?.message || "无法打开资料中的笺间文档", "warning");
      }
      return;
    }
    if (rightSplitTabIdRef.current) {
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      openTabsRef.current = snapshot;
      setOpenTabs(snapshot);
    }
    const target = item.type === "web"
      ? { libraryId: researchRoot.libraryId, sourceId: item.id }
      : { libraryId: researchRoot.libraryId, relativePath: item.relativePath };
    const titleSnapshot = item.title || item.name || item.fileName || item.relativePath || "未命名资料";
    const researchType = previewKind;
    const nextGroups = openWorkspaceResearch(workspaceGroupsRef.current, { ...target, titleSnapshot, researchType });
    const activeView = getActiveWorkspaceView(nextGroups, WORKSPACE_GROUP_ID.SECONDARY);
    commitWorkspaceGroups(nextGroups);
    if (activeView) setResearchItemsByViewId((previous) => ({ ...previous, [activeView.viewId]: item }));
    setActivePane("right");
    setActiveLibraryItem(item);
    setActiveResearchError("");
  }, [addOrActivateDocumentTab, aiMode, commitWorkspaceGroups, handleNavigateResearchPath, requestExitAiMode, researchRoot?.libraryId, showStatus, snapshotLiveTabs]);

  const closeResearchSecondaryPane = useCallback(() => {
    const active = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
    if (active?.kind === WORKSPACE_VIEW_KIND.RESEARCH) void handleCloseGroupView(WORKSPACE_GROUP_ID.SECONDARY, active.viewId);
  }, [handleCloseGroupView]);

  const handleLoadIndependentResearchPdf = useCallback(async (item, options = {}) => {
    if (!researchRoot?.libraryId || !item?.relativePath) throw new Error("资料 PDF 已失效");
    if (options.signal?.aborted) throw new DOMException("读取已取消", "AbortError");
    const result = await bridge.readResearchPdf?.(researchRoot.libraryId, item.relativePath);
    if (options.signal?.aborted) throw new DOMException("读取已取消", "AbortError");
    return result;
  }, [researchRoot?.libraryId]);

  const handleLoadIndependentResearchPreview = useCallback(async (item, options = {}) => {
    if (!researchRoot?.libraryId || !item?.relativePath) throw new Error("资料文件已失效");
    if (options.signal?.aborted) throw new DOMException("读取已取消", "AbortError");
    const result = await bridge.readResearchPreview?.(researchRoot.libraryId, item.relativePath);
    if (options.signal?.aborted) throw new DOMException("读取已取消", "AbortError");
    if (result?.unsupported) throw new Error(result.message || "当前环境不能读取本地资料文件");
    return result;
  }, [researchRoot?.libraryId]);

  const handleOpenIndependentResearchExternal = useCallback(async (item) => {
    try {
      if (item?.type === "web") await bridge.openExternal?.(item.url);
      else await bridge.openResearchEntryExternal?.(researchRoot?.libraryId, item?.relativePath || "");
    } catch (error) {
      showStatus(error?.message || "无法打开资料", "warning");
    }
  }, [researchRoot?.libraryId, showStatus]);

  const saveResearchLibrarySource = useCallback(async (draft, previous = null) => {
    if (!researchRoot?.libraryId) return null;
    const result = await bridge.upsertResearchLibrarySource?.(
      researchRoot.libraryId,
      draft,
      previous?.diskRevision || null,
    );
    if (result?.conflict) {
      const choice = await showConfirmDialog({
        title: "资料来源已在同步盘中修改",
        message: "磁盘版本不会被覆盖。你可以重新载入，或把当前表单内容另存为一条新资料。",
        actions: [{ value: "copy", label: "另存为新资料" }, { value: "reload", label: "重新载入" }],
        cancelValue: "reload",
      });
      if (choice === "copy") {
        const copy = { ...draft };
        delete copy.id;
        delete copy.diskRevision;
        return saveResearchLibrarySource(copy, null);
      }
      await refreshResearchLibrarySources(researchRoot.libraryId);
      return null;
    }
    if (result?.source) {
      await refreshResearchLibrarySources(researchRoot.libraryId);
      setActiveLibraryItem(result.source);
      setResearchItemsByViewId((previous) => {
        let changed = false;
        const next = { ...previous };
        for (const [viewId, item] of Object.entries(previous)) {
          if (item?.id !== result.source.id) continue;
          next[viewId] = result.source;
          changed = true;
        }
        return changed ? next : previous;
      });
      return result.source;
    }
    return null;
  }, [refreshResearchLibrarySources, researchRoot?.libraryId, showConfirmDialog]);

  const handleAddLibraryWeb = useCallback(async (target = null) => {
    const source = target?.type === "web" ? target : null;
    const placement = source ? webTreeState.placements[source.id] : null;
    setWebSourceDialog({
      open: true,
      source,
      folderId: typeof target === "string" ? target : (placement?.folderId || ""),
      scopeKey: source ? (placement?.scopeKey || "global") : webScopeKey,
    });
  }, [webScopeKey, webTreeState.placements]);

  const handleSaveLibraryWeb = useCallback(async (draft) => {
    const source = webSourceDialog.source;
    if (!researchRoot?.libraryId) throw new Error("资料库尚未连接");
    const result = await bridge.upsertResearchWebSource?.(
      researchRoot.libraryId,
      { ...source, ...draft, type: "web", notes: "" },
      { scopeKey: webSourceDialog.scopeKey || webScopeKey, folderId: webSourceDialog.folderId || "" },
      { source: source?.diskRevision || null, tree: webTreeState.diskRevision || null },
    );
    if (result?.conflict || result?.ok === false) {
      await Promise.all([refreshResearchLibrarySources(researchRoot.libraryId), refreshResearchWebTree(researchRoot.libraryId)]);
      throw new Error(result?.message || "网页资料已被外部修改，已重新载入且未覆盖磁盘版本");
    }
    if (!result?.source) throw new Error("网页资料保存失败");
    await Promise.all([refreshResearchLibrarySources(researchRoot.libraryId), refreshResearchWebTree(researchRoot.libraryId)]);
    setActiveLibraryItem((previous) => previous?.id === result.source.id ? result.source : previous);
    setResearchItemsByViewId((previous) => Object.fromEntries(Object.entries(previous).map(([viewId, item]) => [viewId, item?.id === result.source.id ? result.source : item])));
    showStatus(result.placementFallback ? (result.warning || "网页已保存，但暂时回退到全局未分组") : (source ? "网页资料已更新" : "网页资料已加入"), result.placementFallback ? "warning" : "success");
    return result.source;
  }, [refreshResearchLibrarySources, refreshResearchWebTree, researchRoot?.libraryId, showStatus, webScopeKey, webSourceDialog, webTreeState.diskRevision]);

  const handleToggleWebWorkspace = useCallback(() => {
    if (!writingWorkspaceIdentity?.workspaceId) {
      showStatus("请先在文件区打开一个写作工作区；浏览器预览不能连接工作区网页区", "warning");
      return;
    }
    const leavingScope = webScopeKey;
    const leavingIds = new Set(librarySources.filter((source) => source.type === "web" && (webTreeState.placements[source.id]?.scopeKey || "global") === leavingScope).map((source) => source.id));
    removeOpenResearchViews((view) => view.sourceId && leavingIds.has(view.sourceId));
    setWebWorkspaceMode((mode) => mode === "workspace" ? "global" : "workspace");
  }, [librarySources, removeOpenResearchViews, showStatus, webScopeKey, webTreeState.placements, writingWorkspaceIdentity?.workspaceId]);

  const handleOpenWebCopyDialog = useCallback(() => {
    if (!researchRoot?.libraryId) {
      showStatus("请先选择资料文件夹", "warning");
      return;
    }
    if (!webWorkspaceConnected || !webScopeKey.startsWith("workspace:")) {
      showStatus("请先连接当前工作区的私区网页", "warning");
      return;
    }
    if (webTreeState.readOnly) {
      showStatus("网页树索引只读，暂时不能复制", "warning");
      return;
    }
    setWebCopyDialog({ open: true });
  }, [researchRoot?.libraryId, showStatus, webScopeKey, webTreeState.readOnly, webWorkspaceConnected]);
  const handleCloseWebCopyDialog = useCallback(() => setWebCopyDialog({ open: false }), []);

  const handleCopyWebSelection = useCallback(async ({ folderIds = [], sourceIds = [] } = {}) => {
    if (!researchRoot?.libraryId || !webWorkspaceConnected || !webScopeKey.startsWith("workspace:")) throw new Error("当前没有可用的工作区私区");
    const result = await bridge.copyResearchWebSelection?.(researchRoot.libraryId, {
      folderIds,
      sourceIds,
      targetScopeKey: webScopeKey,
      expectedTreeRevision: webTreeState.diskRevision || null,
    });
    if (!result || result.conflict || result.ok === false) {
      await Promise.all([refreshResearchLibrarySources(researchRoot.libraryId), refreshResearchWebTree(researchRoot.libraryId)]);
      throw new Error(result?.message || "网页树已被外部修改，已重新载入且未复制");
    }
    await Promise.all([refreshResearchLibrarySources(researchRoot.libraryId), refreshResearchWebTree(researchRoot.libraryId)]);
    const summary = `已复制 ${result.copiedSourceCount || 0} 个网址，创建 ${result.createdFolderCount || 0} 个文件夹`;
    showStatus(result.skippedDuplicateCount ? `${summary}，跳过 ${result.skippedDuplicateCount} 个重复网址` : summary, result.warnings?.length ? "warning" : "success");
    return result;
  }, [refreshResearchLibrarySources, refreshResearchWebTree, researchRoot?.libraryId, showStatus, webScopeKey, webTreeState.diskRevision, webWorkspaceConnected]);

  const handleCreateWebFolder = useCallback(async (parentId = "") => {
    if (!researchRoot?.libraryId || webTreeState.readOnly) return;
    const name = await showPromptDialog({ title: "新建网页文件夹", label: "文件夹名称", defaultValue: "新建文件夹", confirmLabel: "创建" });
    if (!name?.trim()) return;
    try {
      const result = await bridge.createResearchWebFolder?.(researchRoot.libraryId, { name: name.trim(), parentId, scopeKey: webScopeKey }, webTreeState.diskRevision || null);
      if (result?.conflict) throw new Error(result.message || "网页分组已被外部修改");
      await refreshResearchWebTree(researchRoot.libraryId);
    } catch (error) {
      await refreshResearchWebTree(researchRoot.libraryId);
      showStatus(error?.message || "网页文件夹创建失败", "warning");
    }
  }, [refreshResearchWebTree, researchRoot?.libraryId, showPromptDialog, showStatus, webScopeKey, webTreeState.diskRevision, webTreeState.readOnly]);

  const handleRenameWebFolder = useCallback(async (folder) => {
    if (!researchRoot?.libraryId || !folder?.id || webTreeState.readOnly) return;
    const name = await showPromptDialog({ title: "重命名网页文件夹", label: "文件夹名称", defaultValue: folder.name || "", confirmLabel: "保存" });
    if (!name?.trim() || name.trim() === folder.name) return;
    try {
      const result = await bridge.updateResearchWebFolder?.(researchRoot.libraryId, { id: folder.id, name: name.trim() }, webTreeState.diskRevision || null);
      if (result?.conflict) throw new Error(result.message || "网页分组已被外部修改");
      await refreshResearchWebTree(researchRoot.libraryId);
    } catch (error) {
      await refreshResearchWebTree(researchRoot.libraryId);
      showStatus(error?.message || "网页文件夹重命名失败", "warning");
    }
  }, [refreshResearchWebTree, researchRoot?.libraryId, showPromptDialog, showStatus, webTreeState.diskRevision, webTreeState.readOnly]);

  const handleDeleteWebFolder = useCallback(async (folder) => {
    if (!researchRoot?.libraryId || !folder?.id || webTreeState.readOnly) return;
    const choice = await showConfirmDialog({
      title: "删除网页文件夹",
      message: "文件夹本身会删除，其中的网页和直接子文件夹会提升到上一级，不会删除任何网页。",
      actions: [{ value: "delete", label: "删除文件夹", tone: "danger" }, { value: "cancel", label: "取消" }],
      cancelValue: "cancel",
    });
    if (choice !== "delete") return;
    try {
      const result = await bridge.deleteResearchWebFolder?.(researchRoot.libraryId, folder.id, webTreeState.diskRevision || null);
      if (result?.conflict) throw new Error(result.message || "网页分组已被外部修改");
      await refreshResearchWebTree(researchRoot.libraryId);
    } catch (error) {
      await refreshResearchWebTree(researchRoot.libraryId);
      showStatus(error?.message || "网页文件夹删除失败", "warning");
    }
  }, [refreshResearchWebTree, researchRoot?.libraryId, showConfirmDialog, showStatus, webTreeState.diskRevision, webTreeState.readOnly]);

  const handleMoveWebFolder = useCallback(async (folder, parentId = "") => {
    if (!researchRoot?.libraryId || !folder?.id || folder.parentId === parentId || webTreeState.readOnly) return;
    try {
      const result = await bridge.updateResearchWebFolder?.(researchRoot.libraryId, { id: folder.id, parentId }, webTreeState.diskRevision || null);
      await refreshResearchWebTree(researchRoot.libraryId);
      if (result?.conflict || result?.ok === false) showStatus(result?.message || "网页文件夹移动失败", "warning");
    } catch (error) {
      await refreshResearchWebTree(researchRoot.libraryId);
      showStatus(error?.message || "网页文件夹移动失败", "warning");
    }
  }, [refreshResearchWebTree, researchRoot?.libraryId, showStatus, webTreeState.diskRevision, webTreeState.readOnly]);

  const handleMoveWebSource = useCallback(async (source, folderId = "") => {
    if (!researchRoot?.libraryId || !source?.id || webTreeState.readOnly) return;
    try {
      const result = await bridge.moveResearchWebSource?.(researchRoot.libraryId, source.id, { scopeKey: webScopeKey, folderId }, webTreeState.diskRevision || null);
      await refreshResearchWebTree(researchRoot.libraryId);
      if (result?.conflict || result?.ok === false) showStatus(result?.message || "网页移动失败", "warning");
    } catch (error) {
      await refreshResearchWebTree(researchRoot.libraryId);
      showStatus(error?.message || "网页移动失败", "warning");
    }
  }, [refreshResearchWebTree, researchRoot?.libraryId, showStatus, webScopeKey, webTreeState.diskRevision, webTreeState.readOnly]);

  const handleEditLibrarySource = useCallback((source) => (
    source?.type === "web" ? handleAddLibraryWeb(source) : undefined
  ), [handleAddLibraryWeb]);

  const handleDeleteLibrarySource = useCallback(async (source) => {
    if (!researchRoot?.libraryId || !source?.id) return;
    const choice = await showConfirmDialog({
      title: "删除网页",
      message: "资料来源记录会从当前资料目录删除；信笺里已有的引用快照仍会保留。",
      actions: [{ value: "delete", label: "删除", tone: "danger" }, { value: "cancel", label: "取消" }],
      cancelValue: "cancel",
    });
    if (choice !== "delete") return;
    try {
      const result = await bridge.deleteResearchLibrarySource?.(researchRoot.libraryId, source.id, source.diskRevision || null);
      if (result?.conflict) {
        await Promise.all([refreshResearchLibrarySources(researchRoot.libraryId), refreshResearchWebTree(researchRoot.libraryId)]);
        showStatus("来源已被外部修改，已重新载入且未删除", "warning");
        return;
      }
      await Promise.all([refreshResearchLibrarySources(researchRoot.libraryId), refreshResearchWebTree(researchRoot.libraryId)]);
      removeOpenResearchViews((view) => view.libraryId === researchRoot.libraryId && view.sourceId === source.id);
      showStatus("网页资料已删除", "success");
    } catch (error) {
      showStatus(error?.message || "资料来源删除失败", "warning");
    }
  }, [refreshResearchLibrarySources, refreshResearchWebTree, removeOpenResearchViews, researchRoot?.libraryId, showConfirmDialog, showStatus]);

  const refreshWorkspaceCitationSources = useCallback(async () => {
    if (!writingWorkspaceRoot) {
      setWorkspaceCitationSources([]);
      return [];
    }
    setCitationLibraryLoading(true);
    try {
      const result = await bridge.listCitations?.(writingWorkspaceRoot);
      const sources = normalizeWorkspaceCitationSources(result?.sources);
      setWorkspaceCitationSources(sources);
      return sources;
    } catch (error) {
      showStatus(error?.message || "参考文献来源库读取失败", "warning");
      return [];
    } finally {
      setCitationLibraryLoading(false);
    }
  }, [showStatus, writingWorkspaceRoot]);

  useEffect(() => {
    if (leftSidebarMode === "structure" && structureMode === "references") refreshWorkspaceCitationSources();
  }, [leftSidebarMode, refreshWorkspaceCitationSources, structureMode]);

  const handleResearchViewStateChange = useCallback((viewId, viewState) => {
    const active = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
    if (active?.kind !== WORKSPACE_VIEW_KIND.RESEARCH || active.viewId !== viewId) return;
    const current = workspaceGroupsRef.current;
    const next = updateWorkspaceResearchViewState(current, active.viewId, viewState);
    if (next === current) return;
    commitWorkspaceGroups(next);
  }, [commitWorkspaceGroups]);

  useEffect(() => {
    if (!activeWorkEditor) return undefined;
    const synchronize = createKnowledgeUpdateGuard(() => {
      synchronizeStructuredInlineReferences(activeWorkEditor);
      synchronizeKnowledgeReferences(activeWorkEditor, {
        citationSources: activeWorkDocument?.citationSources || [],
        footnotes: activeWorkDocument?.footnotes || [],
      });
    });
    synchronize();
    activeWorkEditor.on("update", synchronize);
    return () => activeWorkEditor.off("update", synchronize);
  }, [activeWorkDocument?.citationSources, activeWorkDocument?.footnotes, activeWorkEditor]);

  const ensureImageReferenceDocument = useCallback((targetEditor) => {
    const editingRightPane = targetEditor === rightSplitEditor;
    const tabId = editingRightPane ? rightSplitTabIdRef.current : activeTabIdRef.current;
    const tab = openTabsRef.current.find((item) => item.id === tabId);
    const previous = editingRightPane ? tab?.document : documentStateRef.current;
    if (!previous || tab?.readOnly || previous._readOnlyFutureSchema) {
      throw new Error("当前信笺为只读，不能复制图片引用");
    }
    if (Number(previous.version || 1) >= 2 && normalizeDocumentId(previous.documentId)) return previous;
    const updatedAt = new Date().toISOString();
    const nextDocument = normalizeDocumentSchemaV2({ ...previous, updatedAt });
    if (editingRightPane) {
      const nextTabs = openTabsRef.current.map((item) => item.id === tabId
        ? { ...item, document: nextDocument, title: nextDocument.title || item.title, dirty: true }
        : item);
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
    } else {
      documentStateRef.current = nextDocument;
      setDocumentState(nextDocument);
    }
    recordTabMutation(tabId, updatedAt);
    showStatus("已启用文档格式 v2；首次保存时会保留迁移前备份", "success");
    return nextDocument;
  }, [recordTabMutation, rightSplitEditor, showStatus]);

  useEffect(() => {
    const editorForDom = (editorDom) => {
      if (editorDom && editorDom === rightSplitEditor?.view?.dom) return rightSplitEditor;
      if (editorDom && editorDom === editor?.view?.dom) return editor;
      return null;
    };
    const handleCopyReference = async (event) => {
      const targetEditor = editorForDom(event.detail?.editorDom);
      if (!targetEditor) return;
      try {
        const targetDocument = ensureImageReferenceDocument(targetEditor);
        let imageId = normalizeDocumentId(event.detail?.imageId);
        const requestedPosition = typeof event.detail?.position === "number" ? event.detail.position : Number.NaN;
        let image = imageReferenceNumberAt(targetEditor, Number.isFinite(requestedPosition) ? requestedPosition : -1, imageId);
        if (!image?.node || image.node.type.name !== "image") throw new Error("图片位置已经变化，请重新复制引用");
        if (!imageId) {
          imageId = createDocumentId();
          const transaction = targetEditor.state.tr.setNodeMarkup(
            image.position,
            undefined,
            { ...image.node.attrs, imageId },
            image.node.marks,
          );
          targetEditor.view.dispatch(transaction);
          image = imageReferenceNumberAt(targetEditor, image.position, imageId);
        }
        const result = await bridge.copyImageReference?.({
          documentId: targetDocument.documentId,
          imageId,
          number: image?.number || 1,
        });
        if (result?.ok === false) throw new Error(result.message || "剪贴板写入失败");
        showStatus(`图${image?.number || 1}的引用已复制`, "success");
      } catch (error) {
        showStatus(error?.message || "图片引用复制失败", "warning");
      }
    };
    const handlePasteBlocked = () => showStatus("图片引用仅限本文档使用", "warning");
    const handleOpenReference = (event) => {
      const targetEditor = editorForDom(event.detail?.editorDom);
      const imageId = normalizeDocumentId(event.detail?.imageId);
      if (!targetEditor || event.detail?.missing || !imageId) {
        showStatus("目标图片已删除", "warning");
        return;
      }
      const target = imageReferenceNumberAt(targetEditor, -1, imageId);
      if (!target?.node) {
        showStatus("目标图片已删除", "warning");
        return;
      }
      setActivePane(targetEditor === rightSplitEditor ? "right" : "main");
      const transaction = targetEditor.state.tr
        .setSelection(NodeSelection.create(targetEditor.state.doc, target.position))
        .scrollIntoView();
      targetEditor.view.dispatch(transaction);
      targetEditor.view.focus();
      window.requestAnimationFrame(() => {
        const element = targetEditor.view.dom.querySelector(`[data-type="paper-image"][data-image-id="${imageId}"]`);
        if (!element) return;
        element.classList.add("image-reference-target");
        window.setTimeout(() => element.classList.remove("image-reference-target"), 1_200);
      });
    };
    window.addEventListener("paper-image-reference-copy", handleCopyReference);
    window.addEventListener("paper-image-reference-paste-blocked", handlePasteBlocked);
    window.addEventListener("paper-image-reference-open", handleOpenReference);
    return () => {
      window.removeEventListener("paper-image-reference-copy", handleCopyReference);
      window.removeEventListener("paper-image-reference-paste-blocked", handlePasteBlocked);
      window.removeEventListener("paper-image-reference-open", handleOpenReference);
    };
  }, [editor, ensureImageReferenceDocument, rightSplitEditor, showStatus]);

  const closeKnowledgeReferencePopover = useCallback((options = {}) => {
    setKnowledgeReferencePopover((current) => {
      if (options?.restoreFocus && current?.anchorElement?.isConnected) {
        window.requestAnimationFrame(() => current.anchorElement.focus?.());
      }
      return null;
    });
  }, []);

  useEffect(() => {
    const handleOpenReference = (event) => {
      const detail = event.detail || {};
      const belongsToRightEditor = detail.editorDom && detail.editorDom === rightSplitEditor?.view?.dom;
      const targetDocument = belongsToRightEditor ? rightSplitDocument : documentState;
      if (!targetDocument || !detail.anchorElement) return;
      setActivePane(belongsToRightEditor ? "right" : "main");
      const sourceMap = new Map(workspaceCitationSources.map((source) => [source.id, source]));
      (targetDocument.citationSources || []).forEach((source) => sourceMap.set(source.id, source));
      const footnote = (targetDocument.footnotes || []).find((item) => item.id === detail.footnoteId) || null;
      setKnowledgeReferencePopover({
        kind: detail.kind === "footnote" ? "footnote" : "citation",
        number: Math.max(1, Number(detail.number) || 1),
        pages: String(detail.pages || ""),
        footnote,
        source: sourceMap.get(detail.sourceId) || null,
        anchorElement: detail.anchorElement,
        anchorRect: detail.anchorRect || null,
        position: Number(detail.position),
      });
    };
    window.addEventListener("paper-knowledge-reference-open", handleOpenReference);
    return () => window.removeEventListener("paper-knowledge-reference-open", handleOpenReference);
  }, [documentState, rightSplitDocument, rightSplitEditor, workspaceCitationSources]);

  useEffect(() => {
    setKnowledgeReferencePopover(null);
  }, [activeTabId, rightSplitTabId]);

  useEffect(() => {
    if (footnoteDialog.open || citationSourceDialog.open || citationPicker) setKnowledgeReferencePopover(null);
  }, [citationPicker, citationSourceDialog.open, footnoteDialog.open]);

  const handleAddFootnote = useCallback(() => {
    const target = captureElementInsertTarget();
    if (!target) {
      showStatus("请先激活一个可编辑的信笺，再插入脚注", "warning");
      return;
    }
    setFootnoteDialog({ open: true, footnote: null, insertTarget: target });
  }, [captureElementInsertTarget, showStatus]);

  const handleEditFootnote = useCallback((footnote) => {
    if (!footnote?.id) return;
    setFootnoteDialog({ open: true, footnote, insertTarget: null });
  }, []);

  const handleSaveFootnoteDialog = useCallback(async (text) => {
    if (footnoteDialog.footnote?.id) {
      updateKnowledgeDocument((document) => ({
        ...document,
        footnotes: (document.footnotes || []).map((item) => item.id === footnoteDialog.footnote.id
          ? { ...item, text: text.trim(), updatedAt: new Date().toISOString() }
          : item),
      }));
      showStatus("脚注已更新", "success");
      return true;
    }
    const target = footnoteDialog.insertTarget;
    if (!target) throw new Error("脚注插入位置已经失效");
    const id = createDocumentId();
    const now = new Date().toISOString();
    const resolved = updateKnowledgeDocumentForTarget(target, (document) => ({
      ...document,
      footnotes: [...(document.footnotes || []), { id, text: text.trim(), createdAt: now, updatedAt: now }],
    }));
    if (!resolved) throw new Error("脚注输入期间目标信笺已经变化，未修改任何信笺");
    insertAtCapturedSelection(resolved, { type: "paperFootnoteReference", attrs: { footnoteId: id, number: 1 } });
    showStatus("脚注已插入", "success");
    return true;
  }, [footnoteDialog.footnote, footnoteDialog.insertTarget, insertAtCapturedSelection, showStatus, updateKnowledgeDocument, updateKnowledgeDocumentForTarget]);

  const handleDeleteFootnote = useCallback(async (footnote) => {
    const choice = await showConfirmDialog({ title: "删除脚注", message: "正文中的所有对应脚注标记也会删除。", actions: [{ value: "delete", label: "删除", tone: "danger" }, { value: "cancel", label: "取消" }], cancelValue: "cancel" });
    if (choice !== "delete") return;
    removeKnowledgeNodesByAttribute(structureWorkEditor, "paperFootnoteReference", "footnoteId", footnote.id);
    // Keep the detached metadata so a single Ctrl+Z can restore a valid inline
    // reference. Unreferenced footnotes are hidden and omitted by exporters.
  }, [showConfirmDialog, structureWorkEditor]);

  const handleAddCitationSource = useCallback(() => {
    setCitationSourceDialog({ open: true, source: null, insertTarget: null, citationPage: "", returnToPicker: false });
  }, []);

  const handleEditCitationSource = useCallback((source) => {
    if (!source?.id) return;
    setCitationSourceDialog({ open: true, source, insertTarget: null, citationPage: "", returnToPicker: false });
  }, []);

  const persistCitationSource = useCallback(async (input, { insertTarget = null } = {}) => {
    const previous = input?.id ? input : null;
    const now = new Date().toISOString();
    const normalized = normalizeCitationSources([{
      ...input,
      id: input?.id || createDocumentId(),
      createdAt: input?.createdAt || now,
      updatedAt: now,
    }])[0];
    if (!normalized) throw new Error("题名、网址或 DOI 至少填写一项");
    const inWorkspace = Boolean(previous?.id && workspaceCitationSources.some((item) => item.id === previous.id));
    const saveToWorkspace = Boolean(writingWorkspaceRoot && (!previous || inWorkspace || insertTarget));
    let savedSource = normalized;
    if (saveToWorkspace) {
      const result = await bridge.upsertCitation?.(writingWorkspaceRoot, normalized);
      savedSource = normalizeCitationSources([result?.source || normalized])[0];
      if (!savedSource) throw new Error("参考文献来源返回格式无效");
      setWorkspaceCitationSources(Array.isArray(result?.sources)
        ? normalizeWorkspaceCitationSources(result.sources)
        : (current) => [...current.filter((item) => item.id !== savedSource.id), savedSource]);
    }
    if (!saveToWorkspace && !insertTarget) {
      updateKnowledgeDocument((document) => {
        const sources = new Map((document.citationSources || []).map((item) => [item.id, item]));
        sources.set(savedSource.id, savedSource);
        return { ...document, citationSources: [...sources.values()] };
      });
    } else if (previous?.id) {
      updateKnowledgeDocument((document) => ({
        ...document,
        citationSources: (document.citationSources || []).map((item) => item.id === savedSource.id ? savedSource : item),
      }));
    }
    return { source: savedSource, savedToWorkspace: saveToWorkspace };
  }, [updateKnowledgeDocument, workspaceCitationSources, writingWorkspaceRoot]);

  const handleInsertCitationAtTarget = useCallback((target, source, page = "") => {
    if (!target || !source?.id) return false;
    const snapshot = normalizeCitationSources([source])[0];
    if (!snapshot) {
      showStatus("参考文献来源信息不完整，无法插入", "warning");
      return false;
    }
    const resolved = updateKnowledgeDocumentForTarget(target, (document) => {
      const sources = new Map((document.citationSources || []).map((item) => [item.id, item]));
      sources.set(snapshot.id, snapshot);
      return { ...document, citationSources: [...sources.values()] };
    });
    if (!resolved) {
      showStatus("选择来源期间目标信笺已经变化，未插入引用", "warning");
      return false;
    }
    insertAtCapturedSelection(resolved, { type: "paperCitationReference", attrs: { sourceId: snapshot.id, pages: String(page || snapshot.pages || ""), number: 1 } });
    setPendingCitationPage("");
    return true;
  }, [insertAtCapturedSelection, showStatus, updateKnowledgeDocumentForTarget]);

  const handleSaveCitationSourceDialog = useCallback(async (input, citationPage = "") => {
    const target = citationSourceDialog.insertTarget;
    const result = await persistCitationSource(input, { insertTarget: target });
    if (target) {
      if (handleInsertCitationAtTarget(target, result.source, citationPage)) {
        showStatus("新参考文献来源已保存并插入", "success");
      } else {
        if (!result.savedToWorkspace) {
          const retained = updateKnowledgeDocumentForTarget(target, (document) => {
            const sources = new Map((document.citationSources || []).map((item) => [item.id, item]));
            sources.set(result.source.id, result.source);
            return { ...document, citationSources: [...sources.values()] };
          }, { allowRevisionChange: true });
          if (!retained) throw new Error("原插入信笺已经关闭，参考文献来源未能保留");
        }
        showStatus("参考文献来源已保存，但原插入位置已经失效", "warning");
      }
    } else {
      showStatus(result.savedToWorkspace ? "参考文献来源已保存到当前工作区" : "参考文献来源已保存到当前信笺", "success");
    }
    return true;
  }, [citationSourceDialog.insertTarget, handleInsertCitationAtTarget, persistCitationSource, showStatus, updateKnowledgeDocumentForTarget]);

  const handleOpenCitationPicker = useCallback(() => {
    const target = captureElementInsertTarget();
    if (!target) {
      showStatus("请先激活一个可编辑的信笺，再插入文献引用", "warning");
      return;
    }
    setCitationPicker({ ...target, requestId: `citation-${Date.now()}`, initialPage: "" });
    void refreshWorkspaceCitationSources();
  }, [captureElementInsertTarget, refreshWorkspaceCitationSources, showStatus]);

  const defaultPdfPageForCitationSource = useCallback((source) => {
    const view = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
    if (view?.kind !== WORKSPACE_VIEW_KIND.RESEARCH || !view.libraryId || !source?.researchSourceId) return "";
    const item = researchItemsByViewId[view.viewId]
      || (view.sourceId ? librarySources.find((candidate) => candidate.id === view.sourceId) : null)
      || activeLibraryItem;
    const isPdf = item?.type === "file" && /\.pdf$/i.test(item.relativePath || item.fileName || item.name || "");
    if (!isPdf || source.researchLibraryId !== view.libraryId) return "";
    const stableFileSource = item?.id
      ? item
      : librarySources.find((candidate) => candidate.type === "file" && candidate.relativePath === view.relativePath);
    if (!stableFileSource?.id || stableFileSource.id !== source.researchSourceId) return "";
    return String(view.viewState?.page || 1);
  }, [activeLibraryItem, librarySources, researchItemsByViewId]);

  const handleChooseCitationSource = useCallback((source, page = "") => {
    if (!citationPicker) return;
    if (handleInsertCitationAtTarget(citationPicker, source, page)) {
      setCitationPicker(null);
      showStatus("文献引用已插入", "success");
    }
  }, [citationPicker, handleInsertCitationAtTarget, showStatus]);

  const handleAddAndInsertCitationSource = useCallback((page = "") => {
    const target = citationPicker;
    if (!target) return;
    setCitationPicker(null);
    setCitationSourceDialog({ open: true, source: null, insertTarget: target, citationPage: String(page || ""), returnToPicker: true });
  }, [citationPicker]);

  const handleCloseCitationSourceDialog = useCallback((result = {}) => {
    const previous = citationSourceDialog;
    setCitationSourceDialog({ open: false, source: null, insertTarget: null, citationPage: "", returnToPicker: false });
    if (!result?.saved && previous.returnToPicker && previous.insertTarget) {
      setCitationPicker({
        ...previous.insertTarget,
        requestId: `citation-${Date.now()}`,
        initialPage: previous.citationPage || "",
      });
    }
  }, [citationSourceDialog]);

  const handleDeleteCitationSource = useCallback(async (source) => {
    if (!source?.id) return;
    const inWorkspace = workspaceCitationSources.some((item) => item.id === source.id);
    const isCited = citationOrder.includes(source.id);
    const choice = await showConfirmDialog({
      title: "移除参考文献来源",
      message: inWorkspace
        ? (isCited ? "来源会从工作区资料库移除；当前信笺仍保留引用快照。" : "来源会从工作区资料库移除。")
        : (isCited ? "该来源仍被正文引用，不能删除信笺内快照。" : "来源会从当前信笺中移除。"),
      actions: isCited && !inWorkspace
        ? [{ value: "cancel", label: "知道了" }]
        : [{ value: "delete", label: "移除", tone: "danger" }, { value: "cancel", label: "取消" }],
      cancelValue: "cancel",
    });
    if (choice !== "delete") return;
    if (!inWorkspace) {
      updateKnowledgeDocument((document) => ({ ...document, citationSources: (document.citationSources || []).filter((item) => item.id !== source.id) }));
      return;
    }
    try {
      const result = await bridge.deleteCitation?.(writingWorkspaceRoot, source.id);
      setWorkspaceCitationSources(Array.isArray(result?.sources) ? normalizeWorkspaceCitationSources(result.sources) : (current) => current.filter((item) => item.id !== source.id));
      showStatus(isCited ? "工作区来源已移除；信笺引用快照已保留" : "参考文献来源已移除", "success");
    } catch (error) {
      showStatus(error?.message || "参考文献来源移除失败", "warning");
    }
  }, [citationOrder, showConfirmDialog, showStatus, updateKnowledgeDocument, workspaceCitationSources, writingWorkspaceRoot]);

  const handleCreateCitationFromResearch = useCallback(async (researchSource) => {
    if (!researchSource) {
      showStatus("请先选择研究资料", "warning");
      return;
    }
    const researchLibraryId = researchSource.researchLibraryId || researchRoot?.libraryId || "";
    const researchSourceId = researchSource.id || researchSource.researchSourceId || "";
    const bibliographic = researchSource.bibliographic || {};
    const identifier = String(bibliographic.identifier || "").trim();
    const existing = workspaceCitationSources.find((source) => (
      researchSourceId && source.researchSourceId === researchSourceId
      && (!source.researchLibraryId || source.researchLibraryId === researchLibraryId)
    ));
    const isPdf = researchSource.type === "file" && /\.pdf$/i.test(researchSource.fileName || researchSource.relativePath || researchSource.managedFileName || "");
    const input = {
      ...(existing || {}),
      id: existing?.id || createDocumentId(),
      type: researchSource.type === "web" ? "web" : (isPdf ? "pdf" : "other"),
      title: researchSource.title || researchSource.fileName || "未命名来源",
      authors: bibliographic.authors || [],
      year: bibliographic.year || "",
      containerTitle: bibliographic.containerTitle || bibliographic.publication || "",
      publisher: bibliographic.publisher || "",
      url: researchSource.url || "",
      doi: /^10\./.test(identifier) ? identifier : "",
      isbn: identifier && !/^10\./.test(identifier) ? identifier : "",
      pages: bibliographic.pages || "",
      researchLibraryId,
      researchSourceId,
    };
    try {
      const result = writingWorkspaceRoot ? await bridge.upsertCitation?.(writingWorkspaceRoot, input) : null;
      const rawSource = result?.source || input;
      const normalized = normalizeCitationSources([rawSource])[0];
      if (!normalized) throw new Error("资料缺少可引用的题名或地址");
      const savedSource = { ...normalized, researchLibraryId, researchSourceId };
      if (writingWorkspaceRoot) {
        setWorkspaceCitationSources(Array.isArray(result?.sources)
          ? normalizeWorkspaceCitationSources(result.sources).map((source) => source.id === savedSource.id ? savedSource : source)
          : (current) => [...current.filter((source) => source.id !== savedSource.id), savedSource]);
      } else {
        updateKnowledgeDocument((document) => ({
          ...document,
          citationSources: [...(document.citationSources || []).filter((source) => source.id !== savedSource.id), savedSource],
        }));
      }
      setLeftSidebarMode("structure");
      setStructureMode("references");
      showStatus(writingWorkspaceRoot ? "已加入参考文献来源库；可从“元素 → 文献引用”插入" : "未打开工作区；来源快照已保存在当前信笺", writingWorkspaceRoot ? "success" : "warning");
    } catch (error) {
      showStatus(error?.message || "无法从研究资料创建参考文献来源", "warning");
    }
  }, [researchRoot?.libraryId, showStatus, updateKnowledgeDocument, workspaceCitationSources, writingWorkspaceRoot]);

  const handleCreateCitationFromIndependentResearch = useCallback(async (item, options = {}) => {
    if (!item || !researchRoot?.libraryId) return;
    let source = item;
    if (item.type === "file" && !item.id) {
      source = librarySources.find((candidate) => candidate.type === "file" && candidate.relativePath === item.relativePath) || null;
      if (!source) {
        try {
          source = await saveResearchLibrarySource({
            type: "file",
            title: item.name || item.fileName || "未命名资料",
            relativePath: item.relativePath,
            size: item.size || 0,
            mime: item.mime || "",
          });
        } catch (error) {
          showStatus(error?.message || "无法为资料建立稳定身份", "warning");
          return;
        }
      }
    }
    if (!source) return;
    const page = String(options?.page || "");
    if (page) setPendingCitationPage(page);
    await handleCreateCitationFromResearch({
      ...source,
      researchLibraryId: researchRoot.libraryId,
      bibliographic: { ...(source.bibliographic || {}), ...(page ? { pages: page } : {}) },
    });
  }, [handleCreateCitationFromResearch, librarySources, researchRoot?.libraryId, saveResearchLibrarySource, showStatus]);

  const jumpStructureEditorTo = useCallback((position) => {
    if (!structureWorkEditor || !Number.isFinite(position)) return false;
    const selectionPosition = Math.max(0, Math.min(structureWorkEditor.state.doc.content.size, Number(position) + 1));
    setActivePane(structureWorkEditor === rightSplitEditor ? "right" : "main");
    structureWorkEditor.chain().focus().setTextSelection(selectionPosition).scrollIntoView().run();
    return true;
  }, [rightSplitEditor, structureWorkEditor]);

  const handleJumpFootnote = useCallback((footnote) => {
    const reference = knowledgeReferences.footnotes.find((item) => item.footnoteId === footnote?.id);
    if (!jumpStructureEditorTo(reference?.position)) showStatus("正文中的脚注位置已经失效", "warning");
  }, [jumpStructureEditorTo, knowledgeReferences.footnotes, showStatus]);

  const handleJumpCitationSource = useCallback((source) => {
    const reference = knowledgeReferences.citations.find((item) => item.sourceId === source?.id);
    if (!jumpStructureEditorTo(reference?.position)) showStatus("正文尚未使用这个来源", "warning");
  }, [jumpStructureEditorTo, knowledgeReferences.citations, showStatus]);

  const refreshWorkspaceRelationships = useCallback(async () => {
    const requestId = workspaceRelationshipRequestRef.current + 1;
    workspaceRelationshipRequestRef.current = requestId;
    const requestContextKey = workspaceRelationshipContextRef.current;
    if (!writingWorkspaceRoot) {
      const empty = { documents: [], links: [], backlinks: [], duplicates: [] };
      if (requestId === workspaceRelationshipRequestRef.current && requestContextKey === workspaceRelationshipContextRef.current) {
        setWorkspaceRelationships(empty);
      }
      return empty;
    }
    try {
      const currentLinks = collectKnowledgeReferences(structureWorkEditor).links;
      const overrides = snapshotLiveTabs().filter((tab) => tab.path && tab.dirty).map((tab) => ({ path: tab.path, document: tab.document }));
      const result = await bridge.getWorkspaceRelationships?.({
        folderPath: writingWorkspaceRoot,
        currentPath: structureWorkPath,
        documentId: structureWorkDocument?.documentId || "",
        currentLinks,
        overrides,
      });
      const normalized = result || { documents: [], links: [], backlinks: [], duplicates: [] };
      if (requestId !== workspaceRelationshipRequestRef.current || requestContextKey !== workspaceRelationshipContextRef.current) {
        return { documents: [], links: [], backlinks: [], duplicates: [], stale: true };
      }
      setWorkspaceRelationships(normalized);
      return normalized;
    } catch (error) {
      showStatus(error?.message || "关联索引刷新失败", "warning");
      return { documents: [], links: [], backlinks: [], duplicates: [] };
    }
  }, [showStatus, snapshotLiveTabs, structureWorkDocument?.documentId, structureWorkEditor, structureWorkPath, writingWorkspaceRoot]);

  useEffect(() => {
    workspaceRelationshipRequestRef.current += 1;
    setWorkspaceRelationships({ documents: [], links: [], backlinks: [], duplicates: [] });
  }, [workspaceRelationshipContextKey]);

  useEffect(() => {
    const relatedPanelActive = leftSidebarMode === "structure" && structureMode === "related";
    if (!relatedPanelActive && !internalLinkPicker) return undefined;
    let timer = window.setTimeout(refreshWorkspaceRelationships, 48);
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refreshWorkspaceRelationships, 120);
    };
    structureWorkEditor?.on("update", refresh);
    const unsubscribe = bridge.onWorkspaceChanged?.(refresh);
    return () => {
      window.clearTimeout(timer);
      structureWorkEditor?.off("update", refresh);
      unsubscribe?.();
    };
  }, [internalLinkPicker, leftSidebarMode, refreshWorkspaceRelationships, structureMode, structureWorkEditor]);

  const reconcileIdentityResult = useCallback((result) => {
    if (!result?.path || !result?.documentId) return;
    const nextTabs = openTabsRef.current.map((tab) => {
      if (!sameDocumentPath(tab.path, result.path) || tab.dirty) return tab;
      diskRevisionByTabRef.current.set(tab.id, result.diskRevision || tab.diskRevision || null);
      return { ...tab, document: result.document || { ...tab.document, version: 2, documentId: result.documentId, derivedFrom: result.document?.derivedFrom || tab.document?.derivedFrom || "", footnotes: tab.document?.footnotes || [], citationSources: tab.document?.citationSources || [] }, diskRevision: result.diskRevision || tab.diskRevision };
    });
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    if (sameDocumentPath(currentPathRef.current, result.path) && !dirtyRef.current) {
      const nextDocument = normalizeDocument(result.document || { ...documentStateRef.current, version: 2, documentId: result.documentId }, letterTemplates);
      documentStateRef.current = nextDocument;
      setDocumentState(nextDocument);
      if (result.diskRevision) diskRevisionByTabRef.current.set(activeTabIdRef.current, result.diskRevision);
    }
  }, [letterTemplates]);

  const resolveLinkTargetIdentity = useCallback(async (target, force = false) => {
    if (target?.documentId && !force) return target;
    const openTarget = openTabsRef.current.find((tab) => sameDocumentPath(tab.path, target?.path));
    if (openTarget?.dirty) throw new Error("目标信笺有未保存修改，请先保存后再建立关联");
    const result = await bridge.regenerateDocumentIdentity?.(target?.path, force);
    if (!result?.documentId) throw new Error("无法为目标信笺建立稳定身份");
    reconcileIdentityResult(result);
    return { ...target, documentId: result.documentId, needsIdentity: false };
  }, [reconcileIdentityResult]);

  const handleChooseInternalLink = useCallback(async (candidate) => {
    if (!internalLinkPicker) return;
    try {
      if ((internalLinkPicker.workspaceRoot || "") !== (writingWorkspaceRoot || "")) {
        throw new Error("当前文件区已经切换，请重新选择关联信笺");
      }
      const initial = resolveElementInsertTarget(internalLinkPicker);
      if (!initial) throw new Error("关联选择期间目标信笺已经变化");
      if (Number.isFinite(internalLinkPicker.replacingPosition)) {
        const replacingNode = initial.editor.state.doc.nodeAt(internalLinkPicker.replacingPosition);
        if (!replacingNode || replacingNode.type.name !== "paperInternalLink") throw new Error("原关联位置已发生变化");
      }
      const targetDocument = initial.groupId === WORKSPACE_GROUP_ID.PRIMARY ? documentStateRef.current : initial.tab.document;
      const currentCandidate = (workspaceRelationships.documents || []).find((item) => (
        candidate?.documentId && item.documentId
          ? item.documentId === candidate.documentId
          : sameDocumentPath(item.path, candidate?.path)
      ));
      if (!currentCandidate) throw new Error("关联候选已经过期，请重新选择");
      if ((currentCandidate.documentId && currentCandidate.documentId === targetDocument?.documentId)
        || (currentCandidate.path && sameDocumentPath(currentCandidate.path, initial.tab.path))) {
        throw new Error("不能将当前信笺关联到自身");
      }
      const target = await resolveLinkTargetIdentity(currentCandidate);
      const resolved = updateKnowledgeDocumentForTarget(internalLinkPicker, (document) => document);
      if (!resolved) throw new Error("关联选择期间目标信笺已经变化");
      const nodeContent = { type: "paperInternalLink", attrs: { documentId: target.documentId, title: target.title || "未命名信笺", label: target.title || "未命名信笺", pathHint: target.relativePath || "", missing: false } };
      if (Number.isFinite(internalLinkPicker.replacingPosition)) {
        const position = internalLinkPicker.replacingPosition;
        const node = resolved.editor.state.doc.nodeAt(position);
        resolved.editor.chain().focus().insertContentAt({ from: position, to: position + node.nodeSize }, nodeContent).run();
      } else {
        insertAtCapturedSelection(resolved, nodeContent);
      }
      setInternalLinkPicker(null);
      showStatus("关联信笺已插入", "success");
      window.setTimeout(refreshWorkspaceRelationships, 0);
    } catch (error) {
      showStatus(error?.message || "关联插入失败", "warning");
    }
  }, [insertAtCapturedSelection, internalLinkPicker, refreshWorkspaceRelationships, resolveElementInsertTarget, resolveLinkTargetIdentity, showStatus, updateKnowledgeDocumentForTarget, workspaceRelationships.documents, writingWorkspaceRoot]);

  const handleOpenInternalLinkPicker = useCallback(async () => {
    const target = captureElementInsertTarget();
    if (!target) {
      showStatus("请先激活一个可编辑的信笺，再插入关联", "warning");
      return;
    }
    setWorkspaceRelationships({ documents: [], links: [], backlinks: [], duplicates: [] });
    const relationships = await refreshWorkspaceRelationships();
    if (relationships?.stale || (target.workspaceRoot || "") !== (writingWorkspaceRoot || "")) {
      showStatus("当前文件区已经切换，请重新插入关联信笺", "warning");
      return;
    }
    if (!resolveElementInsertTarget(target)) {
      showStatus("关联选择期间目标信笺已经变化，请重试", "warning");
      return;
    }
    setInternalLinkPicker({ ...target, direct: true });
  }, [captureElementInsertTarget, refreshWorkspaceRelationships, resolveElementInsertTarget, showStatus, writingWorkspaceRoot]);

  const handleOpenRelatedDocument = useCallback(async (link) => {
    if (link?.path) {
      await handleOpenFolderFile(link.path);
      setLeftSidebarMode("structure");
      setStructureMode("related");
      return;
    }
    showStatus("目标信笺已丢失，可在关联面板中重新关联或移除", "warning");
    setLeftSidebarMode("structure");
    setStructureMode("related");
  }, [handleOpenFolderFile, showStatus]);

  const handleRemoveInternalLink = useCallback((link) => {
    const position = Number(link?.position);
    const node = Number.isFinite(position) ? structureWorkEditor?.state.doc.nodeAt(position) : null;
    if (!node || node.type.name !== "paperInternalLink") {
      showStatus("关联位置已经失效", "warning");
      return;
    }
    structureWorkEditor.chain().focus().deleteRange({ from: position, to: position + node.nodeSize }).run();
  }, [showStatus, structureWorkEditor]);

  const handleJumpInternalLinkUsage = useCallback((link) => {
    const targetDocumentId = link?.targetDocumentId || link?.documentId;
    const usage = nextInternalLinkUsage(
      knowledgeReferences.links,
      targetDocumentId,
      structureWorkEditor?.state?.selection?.from,
    );
    if (!Number.isFinite(usage?.position) || !jumpStructureEditorTo(usage.position)) {
      showStatus("正文中的关联位置已经失效", "warning");
      return null;
    }
    return usage;
  }, [jumpStructureEditorTo, knowledgeReferences.links, showStatus, structureWorkEditor]);

  const handleRegenerateDuplicateIdentity = useCallback(async (item) => {
    try {
      const result = await resolveLinkTargetIdentity(item, true);
      showStatus(`已为“${item.title || item.relativePath}”生成新身份`, "success");
      reconcileIdentityResult(result);
      await refreshWorkspaceRelationships();
    } catch (error) {
      showStatus(error?.message || "生成新身份失败", "warning");
    }
  }, [reconcileIdentityResult, refreshWorkspaceRelationships, resolveLinkTargetIdentity, showStatus]);

  useEffect(() => {
    const handleOpen = async (event) => {
      const relationships = await refreshWorkspaceRelationships();
      const target = (relationships.documents || []).find((item) => item.documentId === event.detail?.documentId);
      if (target?.path) {
        await handleOpenFolderFile(target.path);
        setLeftSidebarMode("structure");
        setStructureMode("related");
      }
      else {
        setLeftSidebarMode("structure");
        setStructureMode("related");
        showStatus("目标信笺已丢失，可重新关联或移除", "warning");
      }
    };
    window.addEventListener("paper-internal-link-open", handleOpen);
    return () => {
      window.removeEventListener("paper-internal-link-open", handleOpen);
    };
  }, [handleOpenFolderFile, refreshWorkspaceRelationships, showStatus]);

  useEffect(() => {
    const wasImmersive = previousImmersiveModeRef.current;
    previousImmersiveModeRef.current = immersiveMode;
    if (immersiveMode && !wasImmersive) {
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      openTabsRef.current = snapshot;
      setOpenTabs(snapshot);
      immersiveSecondaryPaneLayoutRef.current = aiMode && aiSecondaryPaneLayoutRef.current
        ? aiSecondaryPaneLayoutRef.current
        : { workspaceGroups: workspaceGroupsRef.current, activePane };
      setActivePane("main");
      return;
    }
    if (!immersiveMode && wasImmersive) {
      const savedLayout = immersiveSecondaryPaneLayoutRef.current;
      immersiveSecondaryPaneLayoutRef.current = null;
      if (!savedLayout) return;
      if (aiMode) {
        aiSecondaryPaneLayoutRef.current = savedLayout;
        return;
      }
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      openTabsRef.current = snapshot;
      setOpenTabs(snapshot);
      commitWorkspaceGroups(savedLayout.workspaceGroups);
      const primaryView = getActiveWorkspaceView(savedLayout.workspaceGroups, WORKSPACE_GROUP_ID.PRIMARY);
      const primaryTab = snapshot.find((tab) => tab.id === primaryView?.tabId);
      if (primaryTab && primaryTab.id !== activeTabIdRef.current) {
        activeTabIdRef.current = primaryTab.id;
        setActiveTabId(primaryTab.id);
        applyDocument(primaryTab.document, primaryTab.path, primaryTab.dirty, { editorJson: primaryTab.editorJson, scrollState: primaryTab.scrollState });
      }
      setActivePane(savedLayout.activePane === "right" && savedLayout.workspaceGroups.secondary.views.length ? "right" : "main");
    }
  }, [activePane, aiMode, applyDocument, commitWorkspaceGroups, immersiveMode, snapshotLiveTabs]);

  const setImmersive = useCallback(async (nextValue) => {
    const next = Boolean(nextValue);
    await bridge.setFullscreen?.(next);
    setImmersiveMode(next);
  }, []);

  useEffect(() => bridge.onFullscreenChanged?.((payload) => {
    setImmersiveMode(Boolean(payload?.fullscreen));
  }), []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "F11") {
        event.preventDefault();
        setImmersive(!immersiveMode);
        return;
      }
      if (event.defaultPrevented) return;
      if (event.key !== "Escape") return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (window.document.querySelector("[role='dialog'],[role='alertdialog'],.nav-menu-popover,.tree-context-menu,.template-select-popover")) return;
      if (internalLinkPicker) {
        event.preventDefault();
        setInternalLinkPicker(null);
        return;
      }
      const activeSecondary = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
      if (activePane === "right" && activeSecondary?.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
        event.preventDefault();
        void handleCloseGroupView(WORKSPACE_GROUP_ID.SECONDARY, activeSecondary.viewId);
        return;
      }
      if (!immersiveMode) return;
      if (aiMode) {
        event.preventDefault();
        void requestExitAiMode();
        return;
      }
      event.preventDefault();
      setImmersive(false);
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [activePane, aiMode, handleCloseGroupView, immersiveMode, internalLinkPicker, requestExitAiMode, setImmersive]);

  const handleStartAiOptimize = useCallback(async () => {
    if (aiStatus === "streaming") {
      return;
    }
    if (!aiHasUsableProvider) {
      openAiSettings();
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
      pendingChunks: [],
      flushId: 0,
    });
    const result = await bridge.generateAi?.({
      requestId,
      provider: effectiveAiConfig.provider,
      modelId: effectiveAiConfig.modelId,
      prompt: aiInput.prompt,
      workspacePath: writingWorkspaceRoot,
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
  }, [aiHasUsableProvider, aiStatus, currentPath, effectiveAiConfig.model, effectiveAiConfig.modelId, effectiveAiConfig.modelName, effectiveAiConfig.provider, editor, letterTemplates, openAiSettings, showStatus, updateOptimizeStateForKey, writingWorkspaceRoot]);

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
      openAiSettings();
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
      outputBuffer: "",
      pendingChunks: [],
      flushId: 0,
    });

    const result = await bridge.generateAi?.({
      requestId,
      provider: effectiveAiConfig.provider,
      modelId: effectiveAiConfig.modelId,
      messages,
      workspacePath: writingWorkspaceRoot,
      documentPath: currentPath,
      codexScope: { ...CODEX_DOCUMENT_ONLY_SCOPE },
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
  }, [aiChatCodexImageMode, aiChatInput, aiChatSelections, aiHasUsableProvider, aiStatus, currentPath, effectiveAiConfig.modelId, effectiveAiConfig.provider, effectiveAiConfig.transport, editor, letterTemplates, openAiSettings, showStatus, updateChatStateForKey, writingWorkspaceRoot]);

  const handleClearAiChat = useCallback(() => {
    if (aiStatus === "streaming") {
      return;
    }
    updateChatState({ ...createEmptyAiChatState(), codexImageMode: aiChatCodexImageMode });
  }, [aiChatCodexImageMode, aiStatus, updateChatState]);

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

  const beginManualAiApply = useCallback((block, blockIndex, blocks, reason = "") => {
    setManualFallbackAiBlockIndexes((current) => current.includes(blockIndex) ? current : [...current, blockIndex]);
    setManualAiApply({ block, blockIndex, blocks: Array.isArray(blocks) ? blocks : [] });
    showStatus(reason || "未能可靠定位，请在左侧选择原文位置；按 Esc 可取消", "warning");
  }, [showStatus]);

  const commitAiApplyOperation = useCallback((resolved) => {
    if (!resolved?.ok || !resolved.operation || !resolved.manifest) return { ok: false, stale: true };
    const currentFingerprint = buildAiApplyBlockManifest(editor.state.doc).documentFingerprint;
    if (currentFingerprint !== resolved.manifest.documentFingerprint) return { ok: false, stale: true };
    const applied = editor.chain().focus().insertContentAt(
      { from: resolved.operation.from, to: resolved.operation.to },
      resolved.operation.content,
      { updateSelection: true },
    ).run();
    return applied ? { ok: true } : { ok: false, rejected: true };
  }, [editor]);

  const stageAiApplyPreview = useCallback((resolved, context = {}) => {
    if (!resolved?.ok || !resolved.operation || !resolved.manifest) return { ok: false, stale: true };
    const currentFingerprint = buildAiApplyBlockManifest(editor.state.doc).documentFingerprint;
    if (currentFingerprint !== resolved.manifest.documentFingerprint) return { ok: false, stale: true };
    const currentComments = getDocumentComments(editor, documentStateRef.current.comments);
    const overlappingComments = findCommentsOverlappingAiApplyOperation(resolved.operation, currentComments);
    const actionLabel = resolved.operation.action === "replace"
      ? `替换 ${resolved.operation.targetBlockIds?.length || 1} 个连续原文块`
      : (resolved.operation.action === "insert_before" ? "插入到目标之前" : "插入到目标之后");
    setManualAiApply(null);
    setAiApplyPreview({
      id: `${Date.now()}-${context.blockIndex ?? "manual"}`,
      resolved,
      actionLabel,
      targetSummary: summarizeAiApplyTarget(resolved.operation, resolved.manifest),
      commentCount: overlappingComments.length,
      block: context.block || null,
      blockIndex: Number.isInteger(context.blockIndex) ? context.blockIndex : -1,
      blocks: Array.isArray(context.blocks) ? context.blocks : [],
    });
    return { ok: true };
  }, [editor]);

  const cancelAiApplyPreview = useCallback(() => {
    setAiApplyPreview(null);
    showStatus("已取消这次修改，正文保持不变", "success");
  }, [showStatus]);

  const confirmAiApplyPreview = useCallback(() => {
    if (!aiApplyPreview) return;
    const committed = commitAiApplyOperation(aiApplyPreview.resolved);
    setAiApplyPreview(null);
    if (committed.ok) {
      showStatus("已应用修改；按 Ctrl+Z 可完整撤销", "success");
      return;
    }
    if (aiApplyPreview.block && aiApplyPreview.blockIndex >= 0) {
      beginManualAiApply(
        aiApplyPreview.block,
        aiApplyPreview.blockIndex,
        aiApplyPreview.blocks,
        "确认前目标位置发生变化，请重新选择原文位置",
      );
      return;
    }
    showStatus("确认前目标位置发生变化，请重新选择", "warning");
  }, [aiApplyPreview, beginManualAiApply, commitAiApplyOperation, showStatus]);

  useEffect(() => {
    if (!editor) return undefined;
    syncAiApplyPreviewDecorations(editor, aiApplyPreview ? {
      ...aiApplyPreview,
      onConfirm: confirmAiApplyPreview,
      onCancel: cancelAiApplyPreview,
    } : null);
    if (!aiApplyPreview) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelAiApplyPreview();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      syncAiApplyPreviewDecorations(editor, null);
    };
  }, [aiApplyPreview, cancelAiApplyPreview, confirmAiApplyPreview, editor]);

  const handleApplyAiBlock = useCallback(async (block, blockIndex, blocks) => {
    if (!editor || applyingAiBlockIndex >= 0 || aiApplyInFlightRef.current || aiStatus === "streaming") return;
    if (aiApplyPreview) {
      showStatus("请先在左侧正文中确认或取消当前修改", "warning");
      return;
    }
    if (activeTabReadOnly) {
      showStatus("未来格式信笺为只读，不能直接应用", "warning");
      return;
    }
    if (manualFallbackAiBlockIndexes.includes(blockIndex)) {
      beginManualAiApply(block, blockIndex, blocks);
      return;
    }
    aiApplyInFlightRef.current = true;
    setApplyingAiBlockIndex(blockIndex);
    try {
      const manifest = buildAiApplyBlockManifest(editor.state.doc);
      const optimizationContext = buildAiOptimizationContext(blocks, blockIndex);
      const resolved = await resolveAiDirectApplyWithRepair({
        resolver: bridge.resolveAiApply,
        manifest,
        selectedAiBlock: block,
        optimizationContext,
        getCurrentDocument: () => editor.state.doc,
      });
      if (resolved.unresolved) {
        beginManualAiApply(block, blockIndex, blocks, "未能可靠定位，请选择原文位置");
        return;
      }
      if (!resolved.ok) {
        beginManualAiApply(block, blockIndex, blocks, "未能可靠定位，请选择原文位置");
        return;
      }
      const staged = stageAiApplyPreview(resolved, { block, blockIndex, blocks });
      if (!staged.ok) beginManualAiApply(block, blockIndex, blocks, "目标位置发生变化，请重新选择原文位置");
      else showStatus("已在正文中显示修改对比，请确认应用或取消", "success");
    } catch {
      beginManualAiApply(block, blockIndex, blocks, "定位模型暂时不可用，已切换为手动选择位置");
    } finally {
      aiApplyInFlightRef.current = false;
      setApplyingAiBlockIndex(-1);
    }
  }, [activeTabReadOnly, aiApplyPreview, aiStatus, applyingAiBlockIndex, beginManualAiApply, editor, manualFallbackAiBlockIndexes, showStatus, stageAiApplyPreview]);

  const handleManualAiApplyTarget = useCallback(async (targetBlockId) => {
    if (!editor || !manualAiApply || activeTabReadOnly) return;
    const manifest = buildAiApplyBlockManifest(editor.state.doc);
    const target = manifest.blocks.find((block) => block.id === targetBlockId);
    if (!target || target.protected) {
      showStatus("定稿区或受保护结构不能作为应用位置", "warning");
      return;
    }
    const actions = ["replace", "insert_before", "insert_after"];
    const operations = Object.fromEntries(actions.map((action) => [
      action,
      createManualAiDirectApplyOperation(manifest, target.id, action, manualAiApply.block),
    ]));
    if (actions.some((action) => !operations[action]?.ok || !operations[action]?.operation)) {
      showStatus("这个优化块暂时不能应用，请复制后手动粘贴", "warning");
      setManualAiApply(null);
      return;
    }
    const comments = getDocumentComments(editor, documentStateRef.current.comments);
    const commentCount = (action) => findCommentsOverlappingAiApplyOperation(operations[action]?.operation, comments).length;
    const choice = await showConfirmDialog({
      tone: "default",
      icon: Check,
      eyebrow: "选择应用方式",
      title: "应用到这个原文位置",
      message: `目标：${summarizeAiApplyTarget(operations.replace.operation, manifest)}`,
      detail: "选择后会先在正文中显示红蓝对比；括号内会提示可能受影响的评注数量。",
      actions: [
        { value: "replace", label: `替换此处${commentCount("replace") ? `（${commentCount("replace")} 条评注）` : ""}`, variant: "primary", autoFocus: true },
        { value: "insert_before", label: `插入到前面${commentCount("insert_before") ? `（${commentCount("insert_before")} 条评注）` : ""}` },
        { value: "insert_after", label: `插入到后面${commentCount("insert_after") ? `（${commentCount("insert_after")} 条评注）` : ""}` },
        { value: "cancel", label: "取消" },
      ],
      cancelValue: "cancel",
    });
    setManualAiApply(null);
    if (!actions.includes(choice)) return;
    const staged = stageAiApplyPreview(operations[choice], manualAiApply);
    if (staged.ok) {
      showStatus("已在正文中显示修改对比，请确认应用或取消", "success");
    } else {
      showStatus("所选位置已经变化，请重新选择", "warning");
    }
  }, [activeTabReadOnly, editor, manualAiApply, showConfirmDialog, showStatus, stageAiApplyPreview]);

  useEffect(() => {
    if (!editor || !manualAiApply) return undefined;
    const root = editor.view.dom;
    let hoverManifest = buildAiApplyBlockManifest(editor.state.doc);
    let hovered = null;
    const clearHovered = () => {
      hovered?.classList?.remove("ai-manual-apply-hover");
      hovered?.classList?.remove("ai-manual-apply-protected");
      hovered = null;
    };
    const rootChildFromEvent = (event) => {
      let element = event.target instanceof Element ? event.target : event.target?.parentElement;
      while (element && element.parentElement !== root) element = element.parentElement;
      return element?.parentElement === root ? element : null;
    };
    const handlePointerMove = (event) => {
      const next = rootChildFromEvent(event);
      if (next === hovered) return;
      clearHovered();
      hovered = next;
      if (!hovered) return;
      const domIndex = Array.prototype.indexOf.call(root.children, hovered);
      const target = domIndex >= 0 ? hoverManifest.blocks[domIndex] : null;
      hovered.classList.add(target?.protected ? "ai-manual-apply-protected" : "ai-manual-apply-hover");
    };
    const handleClick = (event) => {
      const located = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!located) return;
      const manifest = buildAiApplyBlockManifest(editor.state.doc);
      const target = manifest.blocks.find((block) => located.pos >= block.from && located.pos < block.to)
        || manifest.blocks.at(-1);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (target.protected) {
        showStatus("定稿区或受保护结构不能作为应用位置", "warning");
        return;
      }
      void handleManualAiApplyTarget(target.id);
    };
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setManualAiApply(null);
      showStatus("已取消选择应用位置", "success");
    };
    const refreshHoverManifest = () => {
      hoverManifest = buildAiApplyBlockManifest(editor.state.doc);
    };
    root.classList.add("ai-manual-apply-targeting");
    root.addEventListener("pointermove", handlePointerMove);
    root.addEventListener("pointerleave", clearHovered);
    root.addEventListener("click", handleClick, true);
    window.addEventListener("keydown", handleKeyDown, true);
    editor.on("update", refreshHoverManifest);
    return () => {
      clearHovered();
      root.classList.remove("ai-manual-apply-targeting");
      root.removeEventListener("pointermove", handlePointerMove);
      root.removeEventListener("pointerleave", clearHovered);
      root.removeEventListener("click", handleClick, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      editor.off("update", refreshHoverManifest);
    };
  }, [editor, handleManualAiApplyTarget, manualAiApply, showStatus]);

  const measuredWorkSurfaceWidth = workSurfaceWidth || Math.max(1, window.innerWidth - (leftSidebarCollapsed ? 0 : 330));
  const secondaryGroupOpen = workspaceGroups.secondary.views.length > 0;
  const secondaryGroupVisible = secondaryGroupOpen && !immersiveMode;
  const minimumGroupRatio = Math.min(0.5, 320 / Math.max(640, measuredWorkSurfaceWidth));
  const secondaryPrimaryRatio = Math.min(1 - minimumGroupRatio, Math.max(minimumGroupRatio, workspaceGroups.splitRatio));
  const secondarySideRatio = 1 - secondaryPrimaryRatio;
  const secondaryGridStyle = !secondaryGroupVisible
    ? undefined
    : { gridTemplateColumns: `minmax(0, ${secondaryPrimaryRatio}fr) minmax(0, ${secondarySideRatio}fr)` };
  const secondaryPaneWidthPx = secondaryGroupVisible ? measuredWorkSurfaceWidth * secondarySideRatio : 0;
  const findTargetsPrimaryPane = activePane !== "right";
  const documentFindStyle = {
    "--document-find-right": `${findTargetsPrimaryPane ? secondaryPaneWidthPx + 18 : 18}px`,
    "--document-find-column-width": `${!secondaryGroupVisible
      ? measuredWorkSurfaceWidth
      : (findTargetsPrimaryPane ? measuredWorkSurfaceWidth - secondaryPaneWidthPx : secondaryPaneWidthPx)}px`,
  };

  const shellClassName = [
    "desktop-shell",
    printMode ? "print-mode" : "",
    imageExportMode ? "image-export-mode" : "",
    aiMode ? "ai-mode" : "",
    leftSidebarCollapsed ? "left-sidebar-collapsed" : "",
    immersiveMode ? "immersive-mode" : "",
  ].filter(Boolean).join(" ");
  const appShellClassName = [
    "app-shell",
    leftSidebarCollapsed ? "left-collapsed" : "",
    aiPageTransition ? "ai-mode-page-enter" : "",
    aiPageTransition ? `ai-mode-page-${aiPageTransition}` : "",
  ].filter(Boolean).join(" ");
  const activeEditorViewKey = aiMode
    ? `ai-${activeTabId}`
    : (splitPaneActive ? `right-${rightSplitTabId}` : `main-${activeTabId}`);
  const tabTemplateDocument = tabTemplateDialog.targetTabId === activeTabId
    ? documentState
    : (openTabs.find((tab) => tab.id === tabTemplateDialog.targetTabId)?.document || null);
  const researchWebViewSuspended = Boolean(
    webSourceDialog.open
    || webCopyDialog.open
    || confirmDialog
    || promptDialog
    || linkDialog
    || settingsDialog.open
    || tabTemplateDialog.open
    || helpOpen
    || releaseNotesOpen
    || exportDialogOpen
    || internalLinkPicker
    || citationPicker
    || footnoteDialog.open
    || citationSourceDialog.open,
  );

  return (
    <div className={shellClassName}>
      <TitleBar />
      <TopNav
        key={`toolbar-${activeEditorViewKey}`}
        editor={aiMode ? editor : activeWorkEditor}
        savedSelectionRef={aiMode ? editorSelectionRef : activeWorkSelectionRef}
        onNew={handleNew}
        onOpen={handleOpen}
        onImport={handleImportDocument}
        onSave={handleSave}
        onOpenExport={() => setExportDialogOpen(true)}
        onInsertImage={handleInsertImage}
        onInsertAudio={() => handleInsertMedia("audio")}
        onInsertVideo={() => handleInsertMedia("video")}
        onOpenLinkDialog={handleOpenLinkDialog}
        onInsertInternalLink={handleOpenInternalLinkPicker}
        onInsertFootnote={handleAddFootnote}
        onOpenCitationPicker={handleOpenCitationPicker}
        onOpenHelp={openHelpCenter}
        onOpenSettings={openSettings}
        settingsTriggerRef={settingsTriggerRef}
        onOpenSearch={openSearch}
        workspaceSearchAvailable={Boolean(writingWorkspaceRoot)}
        aiMode={aiMode}
        aiModeKind={aiModeKind}
        aiBusy={aiStatus === "streaming"}
        aiConfigured={aiHasUsableProvider}
        aiModeChooserOpen={aiModeChooserOpen}
        aiModeTriggerRef={aiModeTriggerRef}
        editorLocked={(aiMode && aiStatus === "streaming") || Boolean(aiApplyPreview)}
        onToggleAiModeChooser={toggleAiModeChooser}
        immersiveMode={immersiveMode}
        onToggleImmersive={() => setImmersive(!immersiveMode)}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={() => setLeftSidebarCollapsed((collapsed) => !collapsed)}
      />
      <div className={appShellClassName}>
        {!leftSidebarCollapsed ? (
          <LiveOutlineSidebar
            key={`sidebar-${activeEditorViewKey}`}
            editor={structureWorkEditor}
            currentPath={structureWorkPath}
            folderState={folderState}
            mode={leftSidebarMode}
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
            researchPanel={(
              <ResearchSidebar
                rootPath={researchRoot?.rootPath || ""}
                libraryId={researchRoot?.libraryId || ""}
                currentRelativePath={researchCurrentRelativePath}
                entries={researchEntries}
                expandedFolders={researchExpandedFolders}
                selectedKey={activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH
                  ? (activeSecondaryView.relativePath || activeSecondaryView.sourceId || "")
                  : ""}
                webSources={librarySources.filter((source) => source.type === "web")}
                webFolders={webTreeState.folders}
                webPlacements={webTreeState.placements}
                webScopeKey={webScopeKey}
                webWorkspaceName={writingWorkspaceIdentity?.workspaceName || ""}
                webWorkspaceConnected={webWorkspaceConnected}
                webWorkspaceAvailable={Boolean(writingWorkspaceIdentity?.workspaceId)}
                webTreeReadOnly={webTreeState.readOnly}
                loading={researchTreeLoading}
                error={researchTreeError}
                busyKeys={researchBusyKeys}
                onPickRoot={handlePickResearchRoot}
                onNavigatePath={handleNavigateResearchPath}
                onToggleFolder={handleToggleResearchFolder}
                onOpenEntry={openIndependentResearchItem}
                onCreateFolder={handleCreateResearchFolder}
                onImportFiles={handleImportResearchFiles}
                onRenameEntry={handleRenameResearchEntry}
                onMoveEntry={handleMoveResearchEntry}
                onTrashEntry={handleTrashResearchEntry}
                onCopyPath={handleCopyResearchPath}
                onShowInFolder={handleShowResearchEntry}
                onAddWeb={handleAddLibraryWeb}
                onToggleWebWorkspace={handleToggleWebWorkspace}
                onCopyWebFromGlobal={handleOpenWebCopyDialog}
                onCreateWebFolder={handleCreateWebFolder}
                onRenameWebFolder={handleRenameWebFolder}
                onDeleteWebFolder={handleDeleteWebFolder}
                onMoveWebFolder={handleMoveWebFolder}
                onMoveWebSource={handleMoveWebSource}
                onOpenSource={openIndependentResearchItem}
                onEditSource={handleEditLibrarySource}
                onDeleteSource={handleDeleteLibrarySource}
              />
            )}
            renderStructurePanel={(outlineItems) => (
              <StructureInspector
                mode={structureMode}
                onModeChange={setStructureMode}
                outlineItems={outlineItems}
                onOutlineItemClick={handleOutlineItemClick}
                referenceProps={{
                  footnotes: visibleFootnotes,
                  sources: citationSourcesForDock,
                  citationOrder,
                  pendingPage: pendingCitationPage,
                  loading: citationLibraryLoading,
                  onJumpFootnote: handleJumpFootnote,
                  onEditFootnote: handleEditFootnote,
                  onDeleteFootnote: handleDeleteFootnote,
                  onAddCitationSource: handleAddCitationSource,
                  onEditCitationSource: handleEditCitationSource,
                  onDeleteCitationSource: handleDeleteCitationSource,
                  onJumpCitationSource: handleJumpCitationSource,
                }}
                relatedProps={{
                  links: workspaceRelationships.links || [],
                  backlinks: workspaceRelationships.backlinks || [],
                  duplicates: workspaceRelationships.duplicates || [],
                  contextKey: workspaceRelationshipContextKey,
                  onOpenDocument: handleOpenRelatedDocument,
                  onRelink: async (link) => {
                    const target = captureStructureManagementTarget();
                    if (!target) {
                      showStatus("当前信笺不可编辑，无法重新关联", "warning");
                      return;
                    }
                    await refreshWorkspaceRelationships();
                    setInternalLinkPicker({
                      ...target,
                      replacingPosition: Number(link.position),
                    });
                  },
                  onRemove: handleRemoveInternalLink,
                  onJumpUsage: handleJumpInternalLinkUsage,
                  onGiveNewIdentity: handleRegenerateDuplicateIdentity,
                }}
              />
            )}
          />
        ) : null}
        <section className="workspace">
          <div className="work-surface" ref={workSurfaceRef}>
            {aiOptimizeMode || aiChatMode ? (
              <div className="ai-mode-top-strip">
                <DocumentTabs
                  tabs={primaryGroupTabs.map((view) => ({ id: view.tabId, path: view.path, title: view.title, dirty: view.dirty }))}
                  activeTabId={activeTabId}
                  onSelectTab={handleSelectTab}
                  onCloseTab={handleCloseTab}
                  onNew={handleNew}
                  closeDisabled
                  newDisabled
                  showNew={false}
                  compact
                />
                {aiOptimizeMode ? (
                  <AiOptimizeToolbar
                    status={aiStatus}
                    hasResult={Boolean(aiOutput || aiError || aiTokenStats)}
                    editor={editor}
                    savedSelectionRef={editorSelectionRef}
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
                    editor={editor}
                    availableProviders={availableAiProviders}
                    selectedProvider={effectiveAiProvider}
                    status={aiStatus}
                    messages={aiChatMessages}
                    hasState={Boolean(aiChatMessages.length || aiChatInput || aiChatSelections.length || aiError)}
                    codexImageMode={aiChatCodexImageMode}
                    onProviderChange={setAiSelectedProvider}
                    onCodexImageModeChange={handleCodexImageModeChange}
                    onStop={handleStopAi}
                    onClear={handleClearAiChat}
                    onExport={handleExportAiChat}
                  />
                ) : null}
              </div>
            ) : secondaryGroupVisible ? (
              <div className="editor-groups-top-strip" style={secondaryGridStyle}>
                <GroupTabStrip
                  groupId={WORKSPACE_GROUP_ID.PRIMARY}
                  items={primaryGroupTabs}
                  activeViewId={workspaceGroups.primary.activeViewId}
                  focused={activePane === "main"}
                  onActivate={(viewId) => handleSelectGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId)}
                  onClose={(viewId) => handleCloseGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId)}
                  onNewDocument={() => handleNew(WORKSPACE_GROUP_ID.PRIMARY)}
                  onReorder={(viewId, beforeViewId) => handleReorderGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId, beforeViewId)}
                  onMoveDocument={handleMoveGroupDocument}
                  onOpenTemplatePicker={handleOpenGroupTabTemplate}
                  canMoveDocument={() => workspaceGroups.primary.views.length > 1}
                />
                <GroupTabStrip
                  groupId={WORKSPACE_GROUP_ID.SECONDARY}
                  items={secondaryGroupTabs}
                  activeViewId={workspaceGroups.secondary.activeViewId}
                  focused={activePane === "right"}
                  onActivate={(viewId) => handleSelectGroupView(WORKSPACE_GROUP_ID.SECONDARY, viewId)}
                  onClose={(viewId) => handleCloseGroupView(WORKSPACE_GROUP_ID.SECONDARY, viewId)}
                  onNewDocument={() => handleNew(WORKSPACE_GROUP_ID.SECONDARY)}
                  onReorder={(viewId, beforeViewId) => handleReorderGroupView(WORKSPACE_GROUP_ID.SECONDARY, viewId, beforeViewId)}
                  onMoveDocument={handleMoveGroupDocument}
                  onOpenTemplatePicker={handleOpenGroupTabTemplate}
                />
              </div>
            ) : (
              <GroupTabStrip
                groupId={WORKSPACE_GROUP_ID.PRIMARY}
                items={primaryGroupTabs}
                activeViewId={workspaceGroups.primary.activeViewId}
                focused
                onActivate={(viewId) => handleSelectGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId)}
                onClose={(viewId) => handleCloseGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId)}
                onNewDocument={() => handleNew(WORKSPACE_GROUP_ID.PRIMARY)}
                onReorder={(viewId, beforeViewId) => handleReorderGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId, beforeViewId)}
                onMoveDocument={handleMoveGroupDocument}
                onOpenTemplatePicker={handleOpenGroupTabTemplate}
                canMoveDocument={() => workspaceGroups.primary.views.length > 1}
              />
            )}
            {searchMode === "document" ? (
              <DocumentFindWidget
                query={searchQuery}
                replaceValue={documentReplaceValue}
                replaceVisible={documentReplaceVisible}
                currentIndex={documentSearchState.activeIndex}
                currentCount={documentSearchState.matches?.length || 0}
                readOnly={activeWorkReadOnly}
                style={documentFindStyle}
                onQueryChange={setSearchQuery}
                onReplaceValueChange={setDocumentReplaceValue}
                onReplaceVisibleChange={setDocumentReplaceVisible}
                onPrevious={() => moveDocumentSearch(-1)}
                onNext={() => moveDocumentSearch(1)}
                onReplace={() => replaceDocumentSearchMatches(false)}
                onReplaceAll={() => replaceDocumentSearchMatches(true)}
                onClose={closeSearch}
              />
            ) : null}
            <div className={[
              "paper-workspace",
              aiMode ? "ai-split-workspace" : "",
              !aiMode && secondaryGroupVisible ? "document-split-workspace" : "",
              !aiMode && activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH ? "research-secondary-workspace" : "",
              aiChatMode ? "chat-mode" : "",
            ].filter(Boolean).join(" ")} style={
              !aiMode && secondaryGroupVisible
                ? secondaryGridStyle
                : undefined
            }>
              {manualAiApply ? (
                <div className="ai-manual-apply-banner" role="status">
                  <Focus size={15} />
                  <span>在左侧点选一个可编辑的原文块；按 Esc 取消</span>
                  <button type="button" onClick={() => setManualAiApply(null)}>取消</button>
                </div>
              ) : null}
              {aiApplyPreview ? (
                <div className="ai-apply-preview-banner" role="status">
                  <span><b>红色</b>是待替换原文，<b>蓝色</b>是拟应用内容；请在正文中确认或取消</span>
                  <button type="button" onClick={cancelAiApplyPreview}>取消对比</button>
                </div>
              ) : null}
              <PaperCanvas
                editor={editor}
                document={mainCanvasDocument}
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
                readOnly={activeTabReadOnly || (aiMode && aiStatus === "streaming") || Boolean(aiApplyPreview)}
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
              {!aiMode && secondaryGroupVisible ? (
                <div className={activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH ? "right-split-pane research-view-active" : "right-split-pane"}>
                  <div
                    className="secondary-pane-resizer workspace-group-resizer"
                    role="separator"
                    aria-label="调整左右编辑组宽度"
                    aria-orientation="vertical"
                    aria-valuemin={25}
                    aria-valuemax={75}
                    aria-valuenow={Math.round(secondaryPrimaryRatio * 100)}
                    tabIndex={0}
                    onPointerDown={startDocumentSplitResize}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                        event.preventDefault();
                        updateDocumentSplitRatio(workspaceGroups.splitRatio + (event.key === "ArrowRight" ? 0.02 : -0.02));
                      }
                    }}
                  />
                  {activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.DOCUMENT && rightSplitDocument ? (
                    <PaperCanvas
                      editor={rightSplitEditor}
                      document={rightCanvasDocument}
                      letterTemplates={letterTemplates}
                      printMode={printMode}
                      imageExportMode={imageExportMode}
                      onTitleChange={handleRightSplitTitleChange}
                      onAuthorChange={handleRightSplitAuthorChange}
                      onDateChange={handleRightSplitDateChange}
                      savedSelectionRef={rightSplitSelectionRef}
                      className={activePane === "right" ? "right-split-canvas active-pane" : "right-split-canvas"}
                      onActivate={() => setActivePane("right")}
                      readOnly={Boolean(rightSplitTab?.readOnly || rightSplitDocument?._readOnlyFutureSchema)}
                      comments={rightSplitDocument.comments}
                      activeCommentId={commentPanel?.pane === "right" ? commentPanel.commentId : ""}
                      commentsHidden={aiMode || printMode || imageExportMode}
                      onCreateComment={(selection, position) => handleStartComment("right", selection, position)}
                      onOpenComment={(comment, position) => handleOpenComment("right", comment, position)}
                      onEditLink={handleEditLinkFromCanvas}
                      canvasRef={rightCanvasRef}
                    />
                  ) : activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH ? (
                    <div className="secondary-research-slot" onPointerDown={() => setActivePane("right")}>
                  <SecondaryResearchPane
                    item={activeLibraryItem}
                    loading={activeResearchLoading}
                    error={activeResearchError}
                    pdfLoader={handleLoadIndependentResearchPdf}
                    previewLoader={handleLoadIndependentResearchPreview}
                    onOpenExternal={handleOpenIndependentResearchExternal}
                    onShowInFolder={handleShowResearchEntry}
                    onEditSource={handleEditLibrarySource}
                    viewId={activeSecondaryView.viewId}
                    onActivate={() => setActivePane("right")}
                    webViewSuspended={researchWebViewSuspended}
                    viewState={activeSecondaryView.viewState}
                    onViewStateChange={(viewState) => handleResearchViewStateChange(activeSecondaryView.viewId, viewState)}
                  />
                    </div>
                  ) : null}
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
                  onApplyBlock={handleApplyAiBlock}
                  applyingBlockIndex={applyingAiBlockIndex}
                  previewingBlockIndex={aiApplyPreview?.blockIndex ?? -1}
                  manualFallbackBlockIndexes={manualFallbackAiBlockIndexes}
                  resolverLabel={aiApplyResolverLabel}
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
      {searchMode === "workspace" ? (
        <WorkspaceSearchPalette
          query={workspaceSearchQuery}
          loading={workspaceSearchState.loading}
          results={workspaceSearchState.results}
          error={workspaceSearchState.error}
          folderName={displayNameFromPath(writingWorkspaceRoot) || "当前文件夹"}
          onQueryChange={setWorkspaceSearchQuery}
          onOpenResult={handleOpenWorkspaceSearchResult}
          onClose={closeSearch}
        />
      ) : null}
      <StatusBar
        key={`status-${activeEditorViewKey}`}
        editor={activeWorkEditor}
        updatedAt={(activeWorkDocument || documentState).updatedAt}
        dirty={splitPaneActive ? Boolean(rightSplitTab?.dirty) : dirty}
        version={appVersion}
        cacheSummary={documentCacheSummary}
        updateState={updateState}
        onRunUpdate={handleRunUpdate}
        onClearCache={handleClearDocumentCache}
        onOpenReleaseNotes={openReleaseNotes}
        persistenceState={persistenceState}
        externalVersion={externalVersionDetected}
        readOnly={activeWorkReadOnly}
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
      <StatusToast status={status} onClose={dismissStatus} />
      <WebSourceDialog
        dialog={webSourceDialog}
        onClose={() => setWebSourceDialog({ open: false, source: null, folderId: "", scopeKey: "global" })}
        onSubmit={handleSaveLibraryWeb}
      />
      <WebCopyDialog
        dialog={webCopyDialog}
        sources={librarySources.filter((source) => source.type === "web")}
        folders={webTreeState.folders}
        placements={webTreeState.placements}
        onClose={handleCloseWebCopyDialog}
        onSubmit={handleCopyWebSelection}
      />
      <AppConfirmDialog dialog={confirmDialog} onResolve={resolveConfirmDialog} />
      <AppPromptDialog dialog={promptDialog} onResolve={resolvePromptDialog} />
      <FootnoteDialog
        dialog={footnoteDialog}
        onClose={() => setFootnoteDialog({ open: false, footnote: null, insertTarget: null })}
        onSubmit={handleSaveFootnoteDialog}
      />
      <CitationSourceDialog
        dialog={citationSourceDialog}
        onClose={handleCloseCitationSourceDialog}
        onSubmit={handleSaveCitationSourceDialog}
      />
      <LinkDialog
        dialog={linkDialog}
        onClose={handleCloseLinkDialog}
        onSubmit={handleSubmitLink}
        onRemove={handleRemoveLink}
      />
      <InternalLinkPicker
        picker={internalLinkPicker}
        documents={workspaceRelationships.documents || []}
        onSelect={handleChooseInternalLink}
        onClose={closeInternalLinkPicker}
      />
      <CitationPickerDialog
        picker={citationPicker}
        sources={citationPickerSources}
        loading={citationLibraryLoading}
        defaultPageForSource={defaultPdfPageForCitationSource}
        initialPage={citationPicker?.initialPage || ""}
        onSelect={handleChooseCitationSource}
        onAddAndSelect={handleAddAndInsertCitationSource}
        onClose={() => setCitationPicker(null)}
      />
      <KnowledgeReferencePopover popover={knowledgeReferencePopover} onClose={closeKnowledgeReferencePopover} />
      <AiModeChooser
        open={aiModeChooserOpen}
        anchorRef={aiModeTriggerRef}
        activeMode={aiModeKind}
        configured={aiHasUsableProvider}
        onSelectMode={requestAiModeChange}
        onExitMode={requestExitAiMode}
        onOpenSettings={openAiSettings}
        onClose={() => setAiModeChooserOpen(false)}
      />
      <SettingsCenter
        open={settingsDialog.open}
        anchorRef={settingsTriggerRef}
        onSelectSection={openSettingsSection}
        onClose={closeSettings}
      />
      <AiSettingsDialog
        open={settingsDialog.section === "ai"}
        returnFocusRef={settingsTriggerRef}
        config={aiConfig}
        onClose={closeSettings}
        onSave={handleSaveAiConfig}
        onCreateProvider={handleCreateAiProvider}
        onDeleteProvider={handleDeleteAiProvider}
        onTest={handleTestAiConfig}
        onClear={handleClearAiConfig}
        onRefreshCodex={handleRefreshCodexCli}
        onLoginCodex={handleLoginCodexCli}
      />
      {tabTemplateDialog.open && tabTemplateDocument ? (
        <LetterTemplateDialog
          key={`tab-template-${tabTemplateDialog.targetTabId}`}
          mode="select"
          returnFocusRef={tabTemplateReturnFocusRef}
          document={tabTemplateDocument}
          letterTemplates={letterTemplates}
          defaultTemplates={DEFAULT_LETTER_TEMPLATES}
          userTemplates={userLetterTemplates}
          userTemplateGroups={userTemplateGroups}
          newDocumentTemplateId={newDocumentTemplateId}
          onClose={closeTabTemplateDialog}
          onLetterTemplateChange={handleTabTemplateChange}
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
      {settingsDialog.section === "template" ? (
          <LetterTemplateDialog
            mode="manage"
            returnFocusRef={settingsTriggerRef}
            document={{ letterTemplateId: newDocumentTemplateId }}
            letterTemplates={letterTemplates}
            defaultTemplates={DEFAULT_LETTER_TEMPLATES}
            userTemplates={userLetterTemplates}
            userTemplateGroups={userTemplateGroups}
            newDocumentTemplateId={newDocumentTemplateId}
            onClose={closeSettings}
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
      <HelpCenterDialog
        open={helpOpen}
        onClose={closeHelpCenter}
      />
      <ReleaseNotesDialog
        open={releaseNotesOpen}
        currentVersion={appVersion}
        onClose={closeReleaseNotes}
      />
      <ExportDialog
        open={exportDialogOpen}
        documentTitle={activeWorkDocument?.title || documentState.title || "未命名信笺"}
        onClose={() => setExportDialogOpen(false)}
        onExportPdf={handleExportPdf}
        onExportImages={handleExportImages}
        onExportEditable={handleExportEditable}
      />
    </div>
  );
}
