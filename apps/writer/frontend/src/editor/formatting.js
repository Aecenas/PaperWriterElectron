export const BACKGROUND_COLOR_OPTIONS = [
  { label: "无背景", value: "" },
  { label: "杏黄水彩", value: "#f6e2a9" },
  { label: "山茶粉", value: "#f2c8c3" },
  { label: "薄荷青", value: "#c8e3d3" },
  { label: "天青蓝", value: "#c9dff0" },
  { label: "淡藤紫", value: "#d9cee9" },
  { label: "米杏", value: "#ead8bd" },
  { label: "烟灰", value: "#d8d7d2" },
];
export const BACKGROUND_COLOR_OPTION_VALUES = new Set(BACKGROUND_COLOR_OPTIONS.map((color) => color.value.toLowerCase()));
export const DEFAULT_UNDERLINE_STYLE = "solid";
export const UNDERLINE_STYLE_OPTIONS = [
  { label: "单横线", value: "solid" },
  { label: "波浪线", value: "wavy" },
  { label: "虚线", value: "dashed" },
  { label: "点线", value: "dotted" },
  { label: "双横线", value: "double" },
];
export const UNDERLINE_STYLE_VALUES = new Set(UNDERLINE_STYLE_OPTIONS.map((option) => option.value));

export function normalizeBackgroundColorValue(value) {
  return normalizePaletteValue(value, BACKGROUND_COLOR_OPTION_VALUES);
}

export function normalizePaletteValue(value, allowedValues) {
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

export function normalizeUnderlineStyle(value) {
  return UNDERLINE_STYLE_VALUES.has(value) ? value : DEFAULT_UNDERLINE_STYLE;
}
