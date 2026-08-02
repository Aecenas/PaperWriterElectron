export const EMOJI_CATEGORY_ALL = "all";
export const EMOJI_CATEGORY_RECENT = "recent";

const CATEGORY_LABELS = Object.freeze({
  0: { key: "smileys-emotion", label: "笑脸与情绪", icon: "😀" },
  1: { key: "people-body", label: "人物与身体", icon: "👋" },
  3: { key: "animals-nature", label: "动物与自然", icon: "🐻" },
  4: { key: "food-drink", label: "食物与饮品", icon: "🍜" },
  5: { key: "travel-places", label: "旅行与地点", icon: "🚲" },
  6: { key: "activities", label: "活动", icon: "🎨" },
  7: { key: "objects", label: "物品", icon: "💡" },
  8: { key: "symbols", label: "符号", icon: "✨" },
  9: { key: "flags", label: "旗帜", icon: "🏳️" },
});

export const EMOJI_CATEGORIES = Object.freeze([
  { key: EMOJI_CATEGORY_RECENT, label: "最近使用", icon: "🕘" },
  ...Object.entries(CATEGORY_LABELS).map(([group, category]) => ({
    ...category,
    group: Number(group),
  })),
]);

export const EMOJI_SKIN_TONES = Object.freeze([
  { id: 0, label: "默认肤色", swatch: "✋" },
  { id: 1, label: "较浅肤色", swatch: "✋🏻" },
  { id: 2, label: "中等偏浅肤色", swatch: "✋🏼" },
  { id: 3, label: "中等肤色", swatch: "✋🏽" },
  { id: 4, label: "中等偏深肤色", swatch: "✋🏾" },
  { id: 5, label: "较深肤色", swatch: "✋🏿" },
]);

const SKIN_MODIFIERS = Object.freeze([
  "1F3FB",
  "1F3FC",
  "1F3FD",
  "1F3FE",
  "1F3FF",
]);

function normalizeSearchPart(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s_\-:：]+/g, " ")
    .trim();
}

function normalizedTags(entry) {
  return Array.isArray(entry?.tags)
    ? entry.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
}

function modifierIds(hexcode) {
  const segments = String(hexcode || "").toUpperCase().split("-");
  return segments.filter((segment) => SKIN_MODIFIERS.includes(segment));
}

function variantForTone(skins, tone) {
  if (!tone || !Array.isArray(skins) || !skins.length) return null;
  const modifier = SKIN_MODIFIERS[tone - 1];
  if (!modifier) return null;
  return skins.find((skin) => {
    const modifiers = modifierIds(skin.hexcode);
    return modifiers.length > 0 && modifiers.every((candidate) => candidate === modifier);
  }) || skins.find((skin) => modifierIds(skin.hexcode).includes(modifier)) || null;
}

function normalizeVariant(entry, fallbackLabel, tone) {
  if (!entry?.unicode) return null;
  return Object.freeze({
    hexcode: String(entry.hexcode || ""),
    unicode: String(entry.unicode),
    label: String(entry.label || fallbackLabel || ""),
    tone,
  });
}

export function createEmojiCatalog(chineseData = [], englishData = []) {
  const englishByHexcode = new Map(
    (Array.isArray(englishData) ? englishData : [])
      .filter((entry) => entry?.hexcode)
      .map((entry) => [String(entry.hexcode), entry]),
  );

  return Object.freeze((Array.isArray(chineseData) ? chineseData : [])
    .filter((entry) => (
      entry?.unicode
      && Number.isInteger(entry.group)
      && Object.hasOwn(CATEGORY_LABELS, entry.group)
    ))
    .map((entry) => {
      const english = englishByHexcode.get(String(entry.hexcode)) || {};
      const skins = Array.from({ length: 5 }, (_, index) => {
        const variant = variantForTone(entry.skins, index + 1);
        return normalizeVariant(variant, entry.label, index + 1);
      });
      const searchText = normalizeSearchPart([
        entry.label,
        english.label,
        ...normalizedTags(entry),
        ...normalizedTags(english),
        entry.hexcode,
      ].join(" "));
      return Object.freeze({
        hexcode: String(entry.hexcode || ""),
        unicode: String(entry.unicode),
        label: String(entry.label || english.label || entry.hexcode || ""),
        englishLabel: String(english.label || ""),
        group: Number(entry.group),
        category: CATEGORY_LABELS[entry.group].key,
        order: Number.isFinite(Number(entry.order)) ? Number(entry.order) : Number.MAX_SAFE_INTEGER,
        tags: Object.freeze([...new Set([...normalizedTags(entry), ...normalizedTags(english)])]),
        skins: Object.freeze(skins),
        searchText,
      });
    })
    .sort((left, right) => left.order - right.order || left.hexcode.localeCompare(right.hexcode)));
}

export function resolveEmojiVariant(emoji, tone = 0) {
  if (!emoji) return null;
  const normalizedTone = Math.min(5, Math.max(0, Number(tone) || 0));
  if (normalizedTone > 0 && emoji.skins?.[normalizedTone - 1]) {
    return emoji.skins[normalizedTone - 1];
  }
  return Object.freeze({
    hexcode: String(emoji.hexcode || ""),
    unicode: String(emoji.unicode || ""),
    label: String(emoji.label || ""),
    tone: 0,
  });
}

export function findEmojiByUnicode(unicode, catalog = []) {
  const needle = String(unicode || "");
  if (!needle) return null;
  for (const emoji of catalog) {
    if (emoji.unicode === needle) return { emoji, variant: resolveEmojiVariant(emoji, 0) };
    const skin = emoji.skins?.find((candidate) => candidate?.unicode === needle);
    if (skin) return { emoji, variant: skin };
  }
  return null;
}

function recentEmojiRecords(recents, catalog) {
  const records = [];
  const seen = new Set();
  for (const unicode of Array.isArray(recents) ? recents : []) {
    if (seen.has(unicode)) continue;
    const match = findEmojiByUnicode(unicode, catalog);
    if (!match) continue;
    seen.add(unicode);
    records.push({ ...match.emoji, recentVariant: match.variant });
  }
  return records;
}

export function filterEmojiCatalog({
  catalog = [],
  category = EMOJI_CATEGORIES[1]?.key || EMOJI_CATEGORY_ALL,
  query = "",
  recents = [],
  limit = 400,
} = {}) {
  const search = normalizeSearchPart(query);
  let source = search
    ? catalog
    : (category === EMOJI_CATEGORY_RECENT
      ? recentEmojiRecords(recents, catalog)
      : catalog.filter((emoji) => category === EMOJI_CATEGORY_ALL || emoji.category === category));

  if (search) {
    const terms = search.split(" ").filter(Boolean);
    source = source.filter((emoji) => terms.every((term) => emoji.searchText.includes(term)));
  }

  const safeLimit = Math.min(1000, Math.max(1, Number(limit) || 400));
  return source.slice(0, safeLimit);
}

export function emojiUnicodeForDisplay(emoji, tone = 0) {
  return emoji?.recentVariant?.unicode || resolveEmojiVariant(emoji, tone)?.unicode || "";
}
