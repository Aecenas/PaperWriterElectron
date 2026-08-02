const { createHash, randomUUID } = require("node:crypto");
const path = require("node:path");

const {
  normalizeCodexImageMode,
} = require("./codex-image-attachments.cjs");
const {
  normalizeCodexScope,
} = require("./codex-scope.cjs");
const {
  sanitizeFilesystemName,
} = require("./filesystem-access.cjs");

const DOCUMENT_EXTENSION = ".letterpaper";
const LEGACY_DOCUMENT_EXTENSION = ".paperdoc";
const DOCUMENT_FILTERS = [
  { name: "笺间文档", extensions: ["letterpaper"] },
  { name: "旧版 PaperWriter 文档", extensions: ["paperdoc"] },
  { name: "All Files", extensions: ["*"] },
];
const DOCUMENT_SCHEMA_VERSION = 3;
const DEFAULT_CITATION_STYLE = Object.freeze({
  styleId: "gb-t-7714-2015-numeric",
  locale: "zh-CN",
});
const SAVED_AI_IMAGE_LIMIT = 2048;
const SAVED_AI_QUOTE_LIMIT = 1000;
const SAVED_AI_MESSAGE_LIMIT = 200;
const SAVED_AI_MESSAGE_TOTAL_CHARS = 8 * 1024 * 1024;
const SAVED_AI_OUTPUT_MAX_CHARS = 8 * 1024 * 1024;
const DOCUMENT_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function sanitizeName(name, fallback = "未命名") {
  return sanitizeFilesystemName(name, fallback, 80);
}

function timestampForFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatPaperDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "今天";
  }
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function isSupportedDocument(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === DOCUMENT_EXTENSION
    || extension === LEGACY_DOCUMENT_EXTENSION;
}

function createEmptyAiState() {
  return {
    version: 3,
    lastMode: "",
    optimize: {
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
    },
    chat: {
      messages: [],
      input: "",
      selectedTexts: [],
      codexScope: normalizeCodexScope(),
      codexImageMode: normalizeCodexImageMode(),
      status: "idle",
      error: "",
      updatedAt: "",
    },
  };
}

function normalizeSavedAiState(state = {}) {
  const source = state && typeof state === "object" ? state : {};
  const empty = createEmptyAiState();
  const optimize = source.optimize
    && typeof source.optimize === "object"
    ? source.optimize
    : {};
  const chat = source.chat && typeof source.chat === "object"
    ? source.chat
    : {};
  const imageEntries = [];
  const imageSource = optimize.assets?.images
    && typeof optimize.assets.images === "object"
    ? optimize.assets.images
    : {};
  for (const key in imageSource) {
    if (!Object.prototype.hasOwnProperty.call(imageSource, key)) {
      continue;
    }
    imageEntries.push([key, imageSource[key]]);
    if (imageEntries.length >= SAVED_AI_IMAGE_LIMIT) {
      break;
    }
  }
  const normalizedImages = Object.fromEntries(
    imageEntries.map(([key, image], index) => [
      String(key).slice(0, 128),
      {
        number: Math.max(
          1,
          Math.floor(Number(image?.number) || index + 1),
        ),
        caption: String(
          image?.caption || image?.alt || "图片",
        ).slice(0, 240),
        src: typeof image?.src === "string" ? image.src : "",
        alt: typeof image?.alt === "string"
          ? image.alt.slice(0, 240)
          : "",
        width: typeof image?.width === "string"
          ? image.width.slice(0, 32)
          : "78%",
      },
    ]),
  );
  const normalizedQuotes = (
    Array.isArray(optimize.assets?.quotes)
      ? optimize.assets.quotes
      : []
  )
    .slice(0, SAVED_AI_QUOTE_LIMIT)
    .map((quote) => ({
      text: String(quote?.text || "").slice(0, 10000),
    }));
  const messageCandidates = (
    Array.isArray(chat.messages) ? chat.messages : []
  ).slice(-SAVED_AI_MESSAGE_LIMIT);
  const normalizedMessages = [];
  let remainingMessageCharacters = SAVED_AI_MESSAGE_TOTAL_CHARS;
  for (
    let index = messageCandidates.length - 1;
    index >= 0 && remainingMessageCharacters > 0;
    index -= 1
  ) {
    const message = messageCandidates[index];
    const content = typeof message?.content === "string"
      ? message.content.slice(
        0,
        Math.min(200000, remainingMessageCharacters),
      )
      : "";
    remainingMessageCharacters -= content.length;
    normalizedMessages.unshift({
      id: typeof message?.id === "string"
        ? message.id.slice(0, 128)
        : `message-${index}`,
      role: message?.role === "assistant" ? "assistant" : "user",
      content,
      status: [
        "done",
        "streaming",
        "stopped",
        "error",
      ].includes(message?.status)
        ? message.status
        : "done",
      elapsedSeconds: Number.isFinite(
        Number(message?.elapsedSeconds),
      )
        ? Math.max(0, Number(message.elapsedSeconds))
        : 0,
      createdAt: Number.isFinite(Number(message?.createdAt))
        ? Number(message.createdAt)
        : Date.now(),
      usage: Number.isFinite(Number(message?.usage))
        ? Number(message.usage)
        : undefined,
      usageEstimated: Boolean(message?.usageEstimated),
      cachedTokens: Number.isFinite(Number(message?.cachedTokens))
        ? Number(message.cachedTokens)
        : undefined,
    });
  }
  const normalizedSelections = (
    Array.isArray(chat.selectedTexts) ? chat.selectedTexts : []
  )
    .slice(0, 100)
    .map((selection, index) => ({
      id: typeof selection?.id === "string" && selection.id
        ? selection.id.slice(0, 128)
        : `selection-${index}`,
      text: typeof selection?.text === "string"
        ? selection.text.slice(0, 20000)
        : "",
      from: Number.isFinite(Number(selection?.from))
        ? Number(selection.from)
        : 1,
      to: Number.isFinite(Number(selection?.to))
        ? Number(selection.to)
        : 1,
    }))
    .filter((selection) => selection.text);
  const tokenTotal = Number(optimize.tokenStats?.totalTokens);
  const cachedTokenTotal = Number(
    optimize.tokenStats?.cachedTokens,
  );
  const tokenStats = optimize.tokenStats
    && typeof optimize.tokenStats === "object"
    ? {
      totalTokens: Number.isFinite(tokenTotal)
        ? Math.max(0, tokenTotal)
        : 0,
      estimated: Boolean(optimize.tokenStats.estimated),
      cachedTokens: Number.isFinite(cachedTokenTotal)
        ? Math.max(0, cachedTokenTotal)
        : 0,
    }
    : null;
  return {
    version: 3,
    lastMode: ["optimize", "chat"].includes(source.lastMode)
      ? source.lastMode
      : "",
    optimize: {
      ...empty.optimize,
      status: optimize.status === "done"
        || optimize.status === "error"
        ? optimize.status
        : "ready",
      output: typeof optimize.output === "string"
        ? optimize.output.slice(0, SAVED_AI_OUTPUT_MAX_CHARS)
        : "",
      error: typeof optimize.error === "string"
        ? optimize.error.slice(0, 2000)
        : "",
      assets: optimize.assets
        && typeof optimize.assets === "object"
        ? {
          images: normalizedImages,
          quotes: normalizedQuotes,
        }
        : empty.optimize.assets,
      elapsedSeconds: Number.isFinite(
        Number(optimize.elapsedSeconds),
      )
        ? Math.max(0, Number(optimize.elapsedSeconds))
        : 0,
      tokenStats,
      provider: typeof optimize.provider === "string"
        ? optimize.provider.slice(0, 128)
        : "",
      modelId: typeof optimize.modelId === "string"
        ? optimize.modelId.slice(0, 256)
        : "",
      modelName: typeof optimize.modelName === "string"
        ? optimize.modelName.slice(0, 256)
        : "",
      updatedAt: typeof optimize.updatedAt === "string"
        ? optimize.updatedAt.slice(0, 64)
        : "",
    },
    chat: {
      ...empty.chat,
      messages: normalizedMessages,
      input: typeof chat.input === "string"
        ? chat.input.slice(0, 200000)
        : "",
      selectedTexts: normalizedSelections,
      codexScope: normalizeCodexScope(chat.codexScope),
      codexImageMode: normalizeCodexImageMode(
        chat.codexImageMode,
      ),
      status: chat.status === "error" ? "error" : "idle",
      error: typeof chat.error === "string"
        ? chat.error.slice(0, 2000)
        : "",
      updatedAt: typeof chat.updatedAt === "string"
        ? chat.updatedAt.slice(0, 64)
        : "",
    },
  };
}

function normalizeDocumentId(value) {
  const id = typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
  return DOCUMENT_UUID_PATTERN.test(id) ? id : "";
}

function normalizeDocumentFootnotes(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  return value.slice(0, 5000).flatMap((footnote) => {
    const text = typeof footnote?.text === "string"
      ? footnote.text.trim().slice(0, 20000)
      : "";
    if (!text) {
      return [];
    }
    const id = normalizeDocumentId(footnote?.id) || randomUUID();
    if (seen.has(id)) {
      return [];
    }
    seen.add(id);
    const createdAt = typeof footnote?.createdAt === "string"
      && Number.isFinite(Date.parse(footnote.createdAt))
      ? footnote.createdAt
      : new Date().toISOString();
    return [{
      id,
      text,
      createdAt,
      updatedAt: typeof footnote?.updatedAt === "string"
        && Number.isFinite(Date.parse(footnote.updatedAt))
        ? footnote.updatedAt
        : createdAt,
    }];
  });
}

function normalizeCitationResearchIdentity(source = {}) {
  const input = source
    && typeof source === "object"
    && !Array.isArray(source)
    ? source
    : {};
  if (
    Object.prototype.hasOwnProperty.call(
      input,
      "researchLibraryId",
    )
  ) {
    const researchLibraryId = normalizeDocumentId(
      input.researchLibraryId,
    );
    const researchSourceId = normalizeDocumentId(
      input.researchSourceId,
    );
    return researchLibraryId && researchSourceId
      ? { researchLibraryId, researchSourceId }
      : {};
  }
  const researchSourceId = String(
    input.researchSourceId || "",
  ).trim();
  return /^[a-zA-Z0-9_-]{8,128}$/.test(researchSourceId)
    ? { researchSourceId }
    : {};
}

function normalizeCitationSources(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  return value.slice(0, 5000).flatMap((source) => {
    if (!source || typeof source !== "object") {
      return [];
    }
    const title = typeof source.title === "string"
      ? source.title.trim().slice(0, 1000)
      : "";
    const url = typeof source.url === "string"
      && /^https?:\/\//i.test(source.url.trim())
      ? source.url.trim().slice(0, 2048)
      : "";
    const doi = typeof source.doi === "string"
      ? source.doi.trim().slice(0, 300)
      : "";
    if (!title && !url && !doi) {
      return [];
    }
    const id = normalizeDocumentId(source.id) || randomUUID();
    if (seen.has(id)) {
      return [];
    }
    seen.add(id);
    const authors = (
      Array.isArray(source.authors)
        ? source.authors
        : (
          typeof source.author === "string"
            ? source.author.split(/[;,；，]/)
            : []
        )
    )
      .slice(0, 100)
      .map(
        (author) => String(author || "").trim().slice(0, 200),
      )
      .filter(Boolean);
    return [{
      id,
      citationKey: typeof source.citationKey === "string"
        ? source.citationKey.trim().replace(/[^a-zA-Z0-9_.:+/-]/g, "-").slice(0, 200)
        : "",
      csl: normalizeCslObject(source.csl),
      type: [
        "book",
        "article",
        "web",
        "pdf",
        "report",
        "thesis",
        "other",
      ].includes(source.type)
        ? source.type
        : "other",
      title,
      authors,
      year: String(source.year ?? "").trim().slice(0, 32),
      containerTitle: typeof source.containerTitle === "string"
        ? source.containerTitle.trim().slice(0, 1000)
        : "",
      publisher: typeof source.publisher === "string"
        ? source.publisher.trim().slice(0, 500)
        : "",
      url,
      doi,
      isbn: typeof source.isbn === "string"
        ? source.isbn.trim().slice(0, 64)
        : "",
      accessedAt: typeof source.accessedAt === "string"
        ? source.accessedAt.slice(0, 64)
        : "",
      pages: typeof source.pages === "string"
        ? source.pages.trim().slice(0, 128)
        : "",
      notes: typeof source.notes === "string"
        ? source.notes.trim().slice(0, 10000)
        : "",
      ...normalizeCitationResearchIdentity(source),
    }];
  });
}

function normalizeCslObject(value) {
  const visit = (input, depth = 0) => {
    if (depth > 8) return undefined;
    if (typeof input === "string") return input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 20000);
    if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
    if (typeof input === "boolean" || input === null) return input;
    if (Array.isArray(input)) return input.slice(0, 500).map((item) => visit(item, depth + 1)).filter((item) => item !== undefined);
    if (!input || typeof input !== "object") return undefined;
    const result = {};
    for (const [rawKey, rawValue] of Object.entries(input).slice(0, 500)) {
      const key = String(rawKey).trim().slice(0, 100);
      if (!key || ["__proto__", "prototype", "constructor"].includes(key)) continue;
      const normalized = visit(rawValue, depth + 1);
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  };
  const result = visit(value);
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  try {
    return JSON.stringify(result).length <= 64 * 1024 ? result : {};
  } catch {
    return {};
  }
}

function normalizeCitationStyle(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const locale = typeof input.locale === "string" ? input.locale.trim().slice(0, 32) : "";
  const styleId = typeof input.styleId === "string" && input.styleId.trim()
    ? input.styleId.trim().slice(0, 200)
    : DEFAULT_CITATION_STYLE.styleId;
  const normalized = {
    styleId,
    locale: /^(?:zh-CN|en-US)$/i.test(locale) ? locale : DEFAULT_CITATION_STYLE.locale,
  };
  const custom = input.customStyle
    && typeof input.customStyle === "object"
    && !Array.isArray(input.customStyle)
    ? input.customStyle
    : null;
  const xml = typeof custom?.xml === "string"
    ? custom.xml.trim().slice(0, (512 * 1024) + 1)
    : "";
  if (
    !xml
    || xml.length > 512 * 1024
    || /<!DOCTYPE|<!ENTITY|\bSYSTEM\b|\bPUBLIC\b/i.test(xml)
    || /<link\b[^>]*\bhref\s*=\s*["'](?:https?:|file:|\/\/)/i.test(xml)
    || !/^(?:<\?xml[^>]*>\s*)?<style\b[^>]*\bxmlns\s*=\s*["']http:\/\/purl\.org\/net\/xbiblio\/csl["']/i.test(xml)
  ) {
    return normalized;
  }
  const hash = createHash("sha256").update(xml, "utf8").digest("hex");
  const customStyleId = `custom-${hash.slice(0, 24)}`;
  if (
    styleId !== customStyleId
    || (
      typeof custom.hash === "string"
      && custom.hash.trim()
      && custom.hash.trim().toLowerCase() !== hash
    )
    || (
      typeof custom.styleId === "string"
      && custom.styleId.trim()
      && custom.styleId.trim() !== customStyleId
    )
  ) {
    return normalized;
  }
  return {
    ...normalized,
    customStyle: {
      styleId: customStyleId,
      title: (
        typeof custom.title === "string"
          ? custom.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200)
          : ""
      ) || "自定义 CSL 样式",
      hash,
      xml,
    },
  };
}

function normalizeDocument(document = {}) {
  const now = new Date().toISOString();
  const sourceVersion = Number.isInteger(Number(document.version))
    && Number(document.version) > 0
    ? Number(document.version)
    : 1;
  const futureSchema = sourceVersion > DOCUMENT_SCHEMA_VERSION;
  const createdAt = typeof document.createdAt === "string"
    && document.createdAt
    ? document.createdAt
    : (
      typeof document.updatedAt === "string"
      && document.updatedAt
        ? document.updatedAt
        : now
    );
  const normalized = {
    ...(sourceVersion >= 2 ? document : {}),
    version: futureSchema
      ? sourceVersion
      : DOCUMENT_SCHEMA_VERSION,
    documentId: normalizeDocumentId(document.documentId)
      || randomUUID(),
    derivedFrom: normalizeDocumentId(document.derivedFrom),
    footnotes: normalizeDocumentFootnotes(document.footnotes),
    citationSources: normalizeCitationSources(
      document.citationSources,
    ),
    citationStyle: normalizeCitationStyle(document.citationStyle),
    title: typeof document.title === "string"
      && document.title.trim()
      ? document.title.trim().slice(0, 200)
      : "未命名信笺",
    author: typeof document.author === "string"
      ? document.author.trim().slice(0, 40)
      : "",
    html: typeof document.html === "string"
      && document.html.trim()
      ? document.html
      : "<p></p>",
    letterTemplateId: typeof document.letterTemplateId === "string"
      && document.letterTemplateId
      ? document.letterTemplateId.slice(0, 128)
      : "",
    templateId: typeof document.templateId === "string"
      && document.templateId
      ? document.templateId.slice(0, 128)
      : "warm",
    fontFamily: typeof document.fontFamily === "string"
      && document.fontFamily
      ? document.fontFamily.slice(0, 128)
      : "LXGW WenKai Screen",
    fontSize: Number.isFinite(Number(document.fontSize))
      ? Math.min(32, Math.max(12, Number(document.fontSize)))
      : 18,
    customBackground: typeof document.customBackground === "string"
      && document.customBackground
      ? document.customBackground
      : "",
    createdAt,
    displayDate: typeof document.displayDate === "string"
      && document.displayDate.trim()
      ? document.displayDate.trim().slice(0, 40)
      : formatPaperDate(createdAt),
    updatedAt: typeof document.updatedAt === "string"
      && document.updatedAt
      ? document.updatedAt
      : now,
    comments: normalizeDocumentComments(document.comments),
    aiState: normalizeSavedAiState(document.aiState),
    ...(futureSchema ? { _readOnlyFutureSchema: true } : {}),
  };
  // Page presentation is device/session state. Strip the legacy document
  // field so opening and saving an older file cannot keep persisting it.
  delete normalized.layoutMode;
  return normalized;
}

function normalizeDocumentComments(comments = []) {
  if (!Array.isArray(comments)) {
    return [];
  }
  const seen = new Set();
  return comments
    .slice(0, 5000)
    .map((comment, index) => {
      const from = Math.max(
        1,
        Math.floor(Number(comment?.from) || 0),
      );
      const to = Math.max(
        1,
        Math.floor(Number(comment?.to) || 0),
      );
      const text = typeof comment?.text === "string"
        ? comment.text.trim().slice(0, 2000)
        : "";
      if (!text || from === to) {
        return null;
      }
      const fallbackId =
        `comment-${Date.now().toString(36)}-${index}`;
      const idSource = typeof comment?.id === "string"
        && comment.id.trim()
        ? comment.id.trim().slice(0, 128)
        : fallbackId;
      const id = seen.has(idSource)
        ? `${idSource}-${index}`
        : idSource;
      seen.add(id);
      const createdAt = typeof comment?.createdAt === "string"
        && comment.createdAt
        ? comment.createdAt
        : new Date().toISOString();
      const updatedAt = typeof comment?.updatedAt === "string"
        && comment.updatedAt
        ? comment.updatedAt
        : createdAt;
      return {
        id,
        from: Math.min(from, to),
        to: Math.max(from, to),
        text,
        quote: typeof comment?.quote === "string"
          ? comment.quote.trim().slice(0, 280)
          : "",
        createdAt,
        updatedAt,
      };
    })
    .filter(Boolean);
}

module.exports = {
  DOCUMENT_EXTENSION,
  DOCUMENT_FILTERS,
  DOCUMENT_SCHEMA_VERSION,
  DEFAULT_CITATION_STYLE,
  LEGACY_DOCUMENT_EXTENSION,
  createEmptyAiState,
  formatPaperDate,
  isSupportedDocument,
  normalizeCitationResearchIdentity,
  normalizeCitationSources,
  normalizeCitationStyle,
  normalizeDocument,
  normalizeDocumentComments,
  normalizeDocumentFootnotes,
  normalizeDocumentId,
  normalizeSavedAiState,
  sanitizeName,
  timestampForFileName,
};
