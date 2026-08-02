export const BASE_USER_TEMPLATE_GROUP_ID = "user-group-default";

export const COLOR_OPTIONS = [
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
export const TEMPLATE_HEADING_COLOR_OPTIONS = [
  { label: "信笺棕", value: "#9a5635" },
  ...COLOR_OPTIONS.filter((option) => option.value),
];
const TEMPLATE_HEADING_COLOR_VALUES = new Set(TEMPLATE_HEADING_COLOR_OPTIONS.map((color) => color.value));
const COLOR_OPTION_VALUES = new Set(COLOR_OPTIONS.map((color) => color.value.toLowerCase()));

export function normalizeColorValue(value) {
  return normalizePaletteValue(value, COLOR_OPTION_VALUES);
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
export const TEMPLATE_FONT_SELECT_OPTIONS = TEMPLATE_FONT_OPTIONS.map((font) => ({
  label: font,
  value: font,
  fontFamily: fontStack(font, "sans-serif"),
}));
export const TYPOGRAPHY_FIELDS = [
  { key: "title", label: "标题", fontKey: "titleFont", sizeKey: "titleSize" },
  { key: "subtitle", label: "副标题/日期", fontKey: "subtitleFont", sizeKey: "subtitleSize" },
  { key: "body", label: "正文", fontKey: "bodyFont", sizeKey: "bodySize" },
  { key: "heading", label: "章节标题", fontKey: "headingFont", sizeKey: "headingSize" },
  { key: "quote", label: "引用", fontKey: "quoteFont", sizeKey: "quoteSize" },
  { key: "toc", label: "目录", fontKey: "tocFont", sizeKey: "tocSize" },
  { key: "imageCaption", label: "图片标题", fontKey: "imageCaptionFont", sizeKey: "imageCaptionSize" },
];
export const TEMPLATE_FONT_SIZE_MIN = 10;
export const TEMPLATE_FONT_SIZE_MAX = 48;
export const TEMPLATE_NAME_MAX_LENGTH = 20;
export const TEMPLATE_GROUP_NAME_MAX_LENGTH = 20;
export const TEMPLATE_DESCRIPTION_MAX_LENGTH = 30;


export const LAYOUT_MODES = {
  FLOW: "flow",
  PAGED: "paged",
};

const PAPER_ASSETS = {
  "minimal-red-margin": new URL("../assets/papers/minimal-red-margin-paper.png", import.meta.url).href,
  "bamboo-vertical": new URL("../assets/papers/bamboo-vertical-ruled-paper.png", import.meta.url).href,
  "parchment-mountain": new URL("../assets/papers/parchment-mountain-border-paper.png", import.meta.url).href,
  "feather-lined": new URL("../assets/papers/feather-lined-note-paper.png", import.meta.url).href,
  "misty-frame": new URL("../assets/papers/misty-ornamental-frame-paper.png", import.meta.url).href,
  "soft-blue": new URL("../assets/papers/soft-blue-watercolor-paper.png", import.meta.url).href,
  "fiber": new URL("../assets/papers/handmade-fiber-paper.png", import.meta.url).href,
  "bamboo-shadow": new URL("../assets/papers/bamboo-window-shadow-paper.png", import.meta.url).href,
  "chinese-corner": new URL("../assets/papers/chinese-corner-border-paper.png", import.meta.url).href,
  "windfield": new URL("../assets/papers/windfield-animation-paper.png", import.meta.url).href,
  "rain-platform": new URL("../assets/papers/rain-platform-cinematic-paper.png", import.meta.url).href,
  "starlit-sky": new URL("../assets/papers/starlit-sky-cinematic-paper.png", import.meta.url).href,
  "moon-grid": new URL("../assets/papers/moon-grid-paper.png", import.meta.url).href,
  "mist-dot-grid": new URL("../assets/papers/mist-dot-grid-paper.png", import.meta.url).href,
  "plum-snow": new URL("../assets/papers/plum-snow-paper.png", import.meta.url).href,
  "lotus-breeze": new URL("../assets/papers/lotus-breeze-paper.png", import.meta.url).href,
  "sunny-island": new URL("../assets/papers/sunny-island-cinematic-paper.png", import.meta.url).href,
  "forest-mist": new URL("../assets/papers/forest-mist-cinematic-paper.png", import.meta.url).href,
  "snow-lit-cabin": new URL("../assets/papers/snow-lit-cabin-cinematic-paper.png", import.meta.url).href,
  "bauhaus-geometry": new URL("../assets/papers/bauhaus-geometry-paper.png", import.meta.url).href,
  "swiss-editorial": new URL("../assets/papers/swiss-editorial-paper.png", import.meta.url).href,
  "retro-newspaper": new URL("../assets/papers/retro-newspaper-paper.png", import.meta.url).href,
  "film-journal": new URL("../assets/papers/film-journal-paper.png", import.meta.url).href,
  "vinyl-sleeve": new URL("../assets/papers/vinyl-sleeve-paper.png", import.meta.url).href,
  "cyber-glow": new URL("../assets/papers/cyber-glow-paper.png", import.meta.url).href,
};


const PAPER_SLICES = {
  "minimal-red-margin": {
    top: new URL("../assets/papers/slices/minimal-red-margin-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/minimal-red-margin-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/minimal-red-margin-bottom.png", import.meta.url).href,
  },
  "bamboo-vertical": {
    top: new URL("../assets/papers/slices/bamboo-vertical-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/bamboo-vertical-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/bamboo-vertical-bottom.png", import.meta.url).href,
  },
  "parchment-mountain": {
    top: new URL("../assets/papers/slices/parchment-mountain-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/parchment-mountain-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/parchment-mountain-bottom.png", import.meta.url).href,
  },
  "feather-lined": {
    top: new URL("../assets/papers/slices/feather-lined-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/feather-lined-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/feather-lined-bottom.png", import.meta.url).href,
  },
  "misty-frame": {
    top: new URL("../assets/papers/slices/misty-frame-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/misty-frame-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/misty-frame-bottom.png", import.meta.url).href,
  },
  "soft-blue": {
    top: new URL("../assets/papers/slices/soft-blue-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/soft-blue-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/soft-blue-bottom.png", import.meta.url).href,
  },
  "fiber": {
    top: new URL("../assets/papers/slices/fiber-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/fiber-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/fiber-bottom.png", import.meta.url).href,
  },
  "bamboo-shadow": {
    top: new URL("../assets/papers/slices/bamboo-shadow-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/bamboo-shadow-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/bamboo-shadow-bottom.png", import.meta.url).href,
  },
  "chinese-corner": {
    top: new URL("../assets/papers/slices/chinese-corner-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/chinese-corner-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/chinese-corner-bottom.png", import.meta.url).href,
  },
  "windfield": {
    top: new URL("../assets/papers/slices/windfield-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/windfield-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/windfield-bottom.png", import.meta.url).href,
  },
  "rain-platform": {
    top: new URL("../assets/papers/slices/rain-platform-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/rain-platform-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/rain-platform-bottom.png", import.meta.url).href,
  },
  "starlit-sky": {
    top: new URL("../assets/papers/slices/starlit-sky-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/starlit-sky-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/starlit-sky-bottom.png", import.meta.url).href,
  },
  "moon-grid": {
    top: new URL("../assets/papers/slices/moon-grid-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/moon-grid-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/moon-grid-bottom.png", import.meta.url).href,
  },
  "mist-dot-grid": {
    top: new URL("../assets/papers/slices/mist-dot-grid-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/mist-dot-grid-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/mist-dot-grid-bottom.png", import.meta.url).href,
  },
  "plum-snow": {
    top: new URL("../assets/papers/slices/plum-snow-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/plum-snow-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/plum-snow-bottom.png", import.meta.url).href,
  },
  "lotus-breeze": {
    top: new URL("../assets/papers/slices/lotus-breeze-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/lotus-breeze-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/lotus-breeze-bottom.png", import.meta.url).href,
  },
  "sunny-island": {
    top: new URL("../assets/papers/slices/sunny-island-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/sunny-island-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/sunny-island-bottom.png", import.meta.url).href,
  },
  "forest-mist": {
    top: new URL("../assets/papers/slices/forest-mist-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/forest-mist-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/forest-mist-bottom.png", import.meta.url).href,
  },
  "snow-lit-cabin": {
    top: new URL("../assets/papers/slices/snow-lit-cabin-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/snow-lit-cabin-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/snow-lit-cabin-bottom.png", import.meta.url).href,
  },
  "bauhaus-geometry": {
    top: new URL("../assets/papers/slices/bauhaus-geometry-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/bauhaus-geometry-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/bauhaus-geometry-bottom.png", import.meta.url).href,
  },
  "swiss-editorial": {
    top: new URL("../assets/papers/slices/swiss-editorial-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/swiss-editorial-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/swiss-editorial-bottom.png", import.meta.url).href,
  },
  "retro-newspaper": {
    top: new URL("../assets/papers/slices/retro-newspaper-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/retro-newspaper-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/retro-newspaper-bottom.png", import.meta.url).href,
  },
  "film-journal": {
    top: new URL("../assets/papers/slices/film-journal-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/film-journal-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/film-journal-bottom.png", import.meta.url).href,
  },
  "vinyl-sleeve": {
    top: new URL("../assets/papers/slices/vinyl-sleeve-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/vinyl-sleeve-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/vinyl-sleeve-bottom.png", import.meta.url).href,
  },
  "cyber-glow": {
    top: new URL("../assets/papers/slices/cyber-glow-top.png", import.meta.url).href,
    repeat: new URL("../assets/papers/slices/cyber-glow-repeat.png", import.meta.url).href,
    bottom: new URL("../assets/papers/slices/cyber-glow-bottom.png", import.meta.url).href,
  },
};

export const TEMPLATES = [
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

export const DEFAULT_TEMPLATE_PRESENTATION = Object.freeze({
  showDocumentTitle: true,
  showSignatureDate: true,
  indentParagraphs: true,
  paragraphAlign: "left",
  headingColors: Object.freeze({ 1: "#9a5635", 2: "#9a5635", 3: "#9a5635", 4: "#9a5635" }),
  headingNumbering: Object.freeze({ 1: true, 2: true, 3: true, 4: true }),
  showImageCaptions: true,
  numberImageCaptions: true,
});

export function normalizeTemplatePresentation(presentation) {
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
      4: normalizeHeadingColor(4),
    },
    headingNumbering: {
      1: headingNumbering[1] !== false,
      2: headingNumbering[2] !== false,
      3: headingNumbering[3] !== false,
      4: headingNumbering[4] !== false,
    },
    showImageCaptions: source.showImageCaptions !== false,
    numberImageCaptions: source.numberImageCaptions !== false,
  };
}

export const DEFAULT_LETTER_TEMPLATES = [
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

export const SYSTEM_TEMPLATE_GROUPS = [
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

export function getLetterTemplateGroupId(template) {
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

export function normalizeTemplateId(templateId, customBackground) {
  if (customBackground && templateId === "custom") {
    return "custom";
  }
  const migrated = LEGACY_TEMPLATE_MAP[templateId] || templateId;
  return TEMPLATES.some((template) => template.id === migrated) ? migrated : "fiber";
}

export function normalizeLetterTemplateId(letterTemplateId, templateId, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  if (letterTemplates.some((template) => template.id === letterTemplateId)) {
    return letterTemplateId;
  }
  const normalizedPaperId = normalizeTemplateId(templateId, "");
  return letterTemplates.find((template) => template.paperId === normalizedPaperId)?.id || "fiber-letter";
}

export function getLetterTemplate(document, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  const letterTemplateId = normalizeLetterTemplateId(document?.letterTemplateId, document?.templateId, letterTemplates);
  return letterTemplates.find((template) => template.id === letterTemplateId) || letterTemplates[0] || DEFAULT_LETTER_TEMPLATES[0];
}

export function fontStack(font, fallback = "serif") {
  return `"${font}", "LXGW WenKai Screen", "LXGW WenKai", "KaiTi", "Noto Serif SC", "STSong", "SimSun", "Segoe UI Emoji", ${fallback}`;
}

function createTemplateId() {
  return `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createTemplateGroupId() {
  return `user-group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeTemplateFontSize(value, fallback = 16) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const parsed = Number.parseInt(digits, 10);
  const normalizedFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 16;
  const candidate = Number.isFinite(parsed) ? parsed : normalizedFallback;
  return Math.min(TEMPLATE_FONT_SIZE_MAX, Math.max(TEMPLATE_FONT_SIZE_MIN, Math.round(candidate)));
}

export function normalizeTemplateName(value, fallback = "我的信笺模板") {
  const compact = String(value ?? "").trim().replace(/\s+/g, " ");
  const normalized = Array.from(compact).slice(0, TEMPLATE_NAME_MAX_LENGTH).join("");
  return normalized || fallback;
}

export function templateNameKey(value) {
  return normalizeTemplateName(value).toLocaleLowerCase();
}

export function createUniqueTemplateName(value, templates = []) {
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

export function normalizeTemplateDescription(value, fallback = "用户模板/可编辑") {
  const compact = String(value ?? "").trim().replace(/\s+/g, " ");
  const normalized = Array.from(compact).slice(0, TEMPLATE_DESCRIPTION_MAX_LENGTH).join("");
  return normalized || fallback;
}

export function normalizeTemplateGroupName(value) {
  const compact = String(value ?? "").trim().replace(/\s+/g, " ");
  return Array.from(compact).slice(0, TEMPLATE_GROUP_NAME_MAX_LENGTH).join("");
}

export function normalizeUserTemplateGroups(groups) {
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

export function normalizeUserTemplate(template, userTemplateGroups = null) {
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

export function createUserTemplate(baseTemplate = DEFAULT_LETTER_TEMPLATES[0], groupIds = [BASE_USER_TEMPLATE_GROUP_ID]) {
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


export function normalizeNewDocumentTemplateId(templateId, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  return letterTemplates.some((template) => template.id === templateId)
    ? templateId
    : DEFAULT_LETTER_TEMPLATES[0].id;
}


export function normalizeNewDocumentTemplateHistory(history, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  if (!Array.isArray(history)) {
    return [];
  }
  const availableTemplateIds = new Set(letterTemplates.map((template) => template.id));
  return history
    .filter((templateId) => typeof templateId === "string" && availableTemplateIds.has(templateId))
    .slice(-24);
}

