export const RESEARCH_TRANSLATION_CACHE_MAX_ENTRIES = 32;
export const RESEARCH_TRANSLATION_CACHE_MAX_CHARACTERS = 4_000_000;

const researchTranslationCache = new Map();
let cachedCharacterCount = 0;

function normalizedCacheInput({ kind, page = 0, targetLanguage = "zh-CN", blocks = [] } = {}) {
  return {
    kind: String(kind || ""),
    page: String(kind || "") === "pdf" ? Math.max(0, Number(page) || 0) : 0,
    targetLanguage: String(targetLanguage || ""),
    blocks: (Array.isArray(blocks) ? blocks : []).map((block) => ({
      id: String(block?.id || ""),
      text: String(block?.text || ""),
    })),
  };
}

function cacheKey(input) {
  const normalized = normalizedCacheInput(input);
  return JSON.stringify([
    normalized.kind,
    normalized.page,
    normalized.targetLanguage,
    normalized.blocks.map((block) => [block.id, block.text]),
  ]);
}

function normalizedTranslations(blocks, translations) {
  const map = translations instanceof Map
    ? translations
    : new Map((Array.isArray(translations) ? translations : []).map((entry) => [entry?.id, entry?.text]));
  if (map.size !== blocks.length) return null;
  const ordered = [];
  for (const block of blocks) {
    const text = map.get(block.id);
    if (typeof text !== "string" || !text.trim()) return null;
    ordered.push({ id: block.id, text });
  }
  return ordered;
}

function evictResearchTranslationCache() {
  while (
    researchTranslationCache.size > RESEARCH_TRANSLATION_CACHE_MAX_ENTRIES
    || cachedCharacterCount > RESEARCH_TRANSLATION_CACHE_MAX_CHARACTERS
  ) {
    const oldestKey = researchTranslationCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = researchTranslationCache.get(oldestKey);
    cachedCharacterCount = Math.max(0, cachedCharacterCount - (oldest?.weight || 0));
    researchTranslationCache.delete(oldestKey);
  }
}

export function readResearchTranslationCache(input) {
  const key = cacheKey(input);
  const cached = researchTranslationCache.get(key);
  if (!cached) return null;
  researchTranslationCache.delete(key);
  researchTranslationCache.set(key, cached);
  return new Map(cached.translations.map((entry) => [entry.id, entry.text]));
}

export function writeResearchTranslationCache(input, translations) {
  const normalized = normalizedCacheInput(input);
  if (!normalized.kind || !normalized.targetLanguage || !normalized.blocks.length) return false;
  const ordered = normalizedTranslations(normalized.blocks, translations);
  if (!ordered) return false;
  const key = cacheKey(normalized);
  const weight = key.length + ordered.reduce((total, entry) => total + entry.id.length + entry.text.length, 0);
  if (weight > RESEARCH_TRANSLATION_CACHE_MAX_CHARACTERS) return false;
  const previous = researchTranslationCache.get(key);
  if (previous) cachedCharacterCount = Math.max(0, cachedCharacterCount - previous.weight);
  researchTranslationCache.delete(key);
  researchTranslationCache.set(key, { translations: ordered, weight });
  cachedCharacterCount += weight;
  evictResearchTranslationCache();
  return researchTranslationCache.has(key);
}

export function clearResearchTranslationCache() {
  researchTranslationCache.clear();
  cachedCharacterCount = 0;
}

export function researchTranslationCacheStats() {
  return {
    entries: researchTranslationCache.size,
    characters: cachedCharacterCount,
  };
}
