export const DOCUMENT_TITLE_MAX_CHARS = 200;
export const AI_CHAT_MAX_MESSAGES = 200;
export const AI_CHAT_MAX_TOTAL_CHARS = 8 * 1024 * 1024;
export const AI_CHAT_MAX_MESSAGE_CHARS = 200000;
export const AI_OPTIMIZE_MAX_IMAGES = 2048;
export const AI_OPTIMIZE_MAX_QUOTES = 1000;
export const AI_OPTIMIZE_MAX_QUOTE_CHARS = 10000;
export const IMAGE_CAPTION_MAX_CHARS = 500;
export const IMAGE_TEXT_MAX_CHARS = 240;
export const MEDIA_FILE_NAME_MAX_CHARS = 240;
export const MEDIA_MIME_MAX_CHARS = 128;

export function normalizeDocumentTitle(value, fallback = "未命名信笺") {
  if (typeof value !== "string") return fallback;
  return value.slice(0, DOCUMENT_TITLE_MAX_CHARS).trim() || fallback;
}

export function normalizeImageCaption(value) {
  return typeof value === "string" ? value.slice(0, IMAGE_CAPTION_MAX_CHARS) : "";
}

export function normalizeImageText(value) {
  return typeof value === "string" ? value.slice(0, IMAGE_TEXT_MAX_CHARS) : "";
}

export function normalizeMediaFileName(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.slice(0, MEDIA_FILE_NAME_MAX_CHARS).trim() || fallback;
}

export function normalizeMediaMime(value, kind = "audio") {
  if (typeof value !== "string") return "";
  const mime = value.slice(0, MEDIA_MIME_MAX_CHARS).trim().toLowerCase();
  const expectedPrefix = kind === "video" ? "video/" : "audio/";
  return mime.startsWith(expectedPrefix) && /^(?:audio|video)\/[a-z0-9.+-]+$/.test(mime) ? mime : "";
}

export function boundedAiImageEntries(images) {
  if (!images || typeof images !== "object" || Array.isArray(images)) return [];
  return Object.entries(images).slice(0, AI_OPTIMIZE_MAX_IMAGES);
}

export function normalizeBoundedAiQuotes(quotes) {
  if (!Array.isArray(quotes)) return [];
  return quotes
    .slice(0, AI_OPTIMIZE_MAX_QUOTES)
    .map((quote) => ({ text: String(quote?.text || "").slice(0, AI_OPTIMIZE_MAX_QUOTE_CHARS) }));
}

export function normalizeBoundedAiChatMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const recent = messages.slice(-AI_CHAT_MAX_MESSAGES);
  const normalizedReverse = [];
  let remainingChars = AI_CHAT_MAX_TOTAL_CHARS;
  for (let index = recent.length - 1; index >= 0 && remainingChars > 0; index -= 1) {
    const message = recent[index] && typeof recent[index] === "object" ? recent[index] : {};
    const contentSource = typeof message.content === "string" ? message.content : "";
    const content = contentSource.slice(0, Math.min(AI_CHAT_MAX_MESSAGE_CHARS, remainingChars));
    remainingChars -= content.length;
    normalizedReverse.push({
      id: typeof message.id === "string" && message.id ? message.id.slice(0, 128) : `message-${index}`,
      role: message.role === "assistant" ? "assistant" : "user",
      content,
      status: ["done", "streaming", "stopped", "error"].includes(message.status) ? message.status : "done",
      elapsedSeconds: Number.isFinite(Number(message.elapsedSeconds)) ? Math.max(0, Number(message.elapsedSeconds)) : 0,
      createdAt: Number.isFinite(Number(message.createdAt)) ? Number(message.createdAt) : Date.now(),
      usage: Number.isFinite(Number(message.usage)) ? Number(message.usage) : undefined,
      usageEstimated: Boolean(message.usageEstimated),
      cachedTokens: Number.isFinite(Number(message.cachedTokens)) ? Number(message.cachedTokens) : undefined,
    });
  }
  return normalizedReverse.reverse();
}
