import { safeStorageGetItem, safeStorageSetItem } from "../safe-storage.js";

export const EMOJI_RECENTS_STORAGE_KEY = "paperwriter.emoji.recents.v1";
export const MAX_EMOJI_RECENTS = 30;

export function normalizeEmojiRecents(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];
  for (const entry of source) {
    const unicode = String(entry || "").trim();
    if (!unicode || seen.has(unicode)) continue;
    seen.add(unicode);
    normalized.push(unicode);
    if (normalized.length >= MAX_EMOJI_RECENTS) break;
  }
  return normalized;
}

export function parseEmojiRecents(value) {
  try {
    return normalizeEmojiRecents(JSON.parse(String(value || "[]")));
  } catch {
    return [];
  }
}

export function loadEmojiRecents() {
  return parseEmojiRecents(safeStorageGetItem(EMOJI_RECENTS_STORAGE_KEY));
}

export function addEmojiRecent(recents, unicode) {
  return normalizeEmojiRecents([String(unicode || ""), ...(Array.isArray(recents) ? recents : [])]);
}

export function saveEmojiRecent(unicode, recents = loadEmojiRecents()) {
  const next = addEmojiRecent(recents, unicode);
  safeStorageSetItem(EMOJI_RECENTS_STORAGE_KEY, JSON.stringify(next));
  return next;
}

