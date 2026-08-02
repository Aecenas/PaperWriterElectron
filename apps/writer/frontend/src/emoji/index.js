export { default as EmojiPicker } from "./EmojiPicker.jsx";
export {
  EMOJI_CATEGORIES,
  EMOJI_CATEGORY_ALL,
  EMOJI_CATEGORY_RECENT,
  EMOJI_SKIN_TONES,
  createEmojiCatalog,
  emojiUnicodeForDisplay,
  filterEmojiCatalog,
  findEmojiByUnicode,
  resolveEmojiVariant,
} from "./catalog.js";
export { loadEmojiCatalog, resetEmojiCatalogForTests } from "./data.js";
export {
  MAX_EMOJI_RECENTS,
  EMOJI_RECENTS_STORAGE_KEY,
  addEmojiRecent,
  loadEmojiRecents,
  normalizeEmojiRecents,
  parseEmojiRecents,
  saveEmojiRecent,
} from "./recent-storage.js";
export {
  captureEmojiInsertionContext,
  insertEmojiFromContext,
  isSingleUnicodeGrapheme,
  validateEmojiInsertionContext,
} from "./insertion-context.js";
export {
  resolveEmojiFocusTarget,
  restoreEmojiPickerFocus,
} from "./focus-restoration.js";
