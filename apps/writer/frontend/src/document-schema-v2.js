export const DOCUMENT_SCHEMA_VERSION = 2;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CITATION_TYPES = new Set(["book", "article", "web", "pdf", "report", "thesis", "other"]);
const MAX_FOOTNOTES = 5_000;
const MAX_CITATION_SOURCES = 5_000;

function boundedText(value, maximum, { trim = true } = {}) {
  if (typeof value !== "string") return "";
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maximum);
  return trim ? clean.trim() : clean;
}

export function isDocumentId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function normalizeDocumentId(value) {
  return isDocumentId(value) ? value.trim().toLowerCase() : "";
}

function fallbackUuidV4(cryptoObject) {
  if (!cryptoObject?.getRandomValues) throw new Error("安全随机数不可用，无法创建设备无关的文档 ID");
  const bytes = new Uint8Array(16);
  cryptoObject.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export function createDocumentId(randomUuid) {
  const cryptoObject = globalThis.crypto;
  const factory = typeof randomUuid === "function"
    ? randomUuid
    : (typeof cryptoObject?.randomUUID === "function" ? cryptoObject.randomUUID.bind(cryptoObject) : null);
  const generated = factory ? factory() : fallbackUuidV4(cryptoObject);
  const normalized = normalizeDocumentId(generated);
  if (!normalized) throw new Error("UUID 生成器返回了非法文档 ID");
  return normalized;
}

function resolveIdFactory(options = {}) {
  return typeof options.idFactory === "function" ? options.idFactory : createDocumentId;
}

function safeGeneratedId(idFactory) {
  return createDocumentId(idFactory);
}

function resolveNow(options = {}) {
  const raw = typeof options.now === "function" ? options.now() : options.now;
  if (typeof raw === "string" && Number.isFinite(Date.parse(raw))) return raw;
  return new Date().toISOString();
}

function normalizeTimestamp(value, fallback) {
  const source = typeof value === "string" ? value.trim().slice(0, 64) : "";
  return source && Number.isFinite(Date.parse(source)) ? source : fallback;
}

export function readDocumentSchemaVersion(document) {
  const raw = Number(document?.version);
  return Number.isInteger(raw) && raw > 0 ? raw : 1;
}

export function getDocumentSchemaCompatibility(document) {
  const version = readDocumentSchemaVersion(document);
  return {
    version,
    supported: version <= DOCUMENT_SCHEMA_VERSION,
    readOnly: version > DOCUMENT_SCHEMA_VERSION,
    needsUpgrade: version < DOCUMENT_SCHEMA_VERSION,
  };
}

export class UnsupportedDocumentSchemaVersionError extends Error {
  constructor(version) {
    super(`文档格式 v${version} 高于当前支持的 v${DOCUMENT_SCHEMA_VERSION}`);
    this.name = "UnsupportedDocumentSchemaVersionError";
    this.version = version;
    this.supportedVersion = DOCUMENT_SCHEMA_VERSION;
  }
}

export function normalizeDocumentFootnotes(footnotes, options = {}) {
  if (!Array.isArray(footnotes)) return [];
  const idFactory = resolveIdFactory(options);
  const now = resolveNow(options);
  const seen = new Set();
  const normalized = [];
  for (const footnote of footnotes.slice(0, MAX_FOOTNOTES)) {
    if (!footnote || typeof footnote !== "object") continue;
    const text = boundedText(footnote.text, 20_000);
    if (!text) continue;
    const id = normalizeDocumentId(footnote.id) || safeGeneratedId(idFactory);
    if (seen.has(id)) continue;
    seen.add(id);
    const createdAt = normalizeTimestamp(footnote.createdAt, now);
    normalized.push({
      id,
      text,
      createdAt,
      updatedAt: normalizeTimestamp(footnote.updatedAt, createdAt),
    });
  }
  return normalized;
}

function normalizeAuthors(value) {
  const source = Array.isArray(value)
    ? value
    : (typeof value === "string" ? value.split(/[;,；，]/) : []);
  return source.slice(0, 100).map((author) => boundedText(author, 200)).filter(Boolean);
}

function normalizeHttpUrl(value) {
  const source = boundedText(value, 2_048);
  if (!source) return "";
  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

const LEGACY_RESEARCH_SOURCE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

/**
 * Portable citation snapshots may point at either the independent v0.9.6
 * research library (a UUID pair) or a legacy v0.9.5 workspace source (the
 * historical source id alone).  A library field always opts into the paired
 * format, so incomplete or malformed pairs cannot be reinterpreted as legacy
 * links by accident.
 */
export function normalizeCitationResearchIdentity(source) {
  const input = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  if (Object.prototype.hasOwnProperty.call(input, "researchLibraryId")) {
    const researchLibraryId = normalizeDocumentId(input.researchLibraryId);
    const researchSourceId = normalizeDocumentId(input.researchSourceId);
    return researchLibraryId && researchSourceId ? { researchLibraryId, researchSourceId } : {};
  }
  const researchSourceId = boundedText(input.researchSourceId, 128);
  return LEGACY_RESEARCH_SOURCE_ID_PATTERN.test(researchSourceId) ? { researchSourceId } : {};
}

export function normalizeCitationSources(sources, options = {}) {
  if (!Array.isArray(sources)) return [];
  const idFactory = resolveIdFactory(options);
  const now = resolveNow(options);
  const seen = new Set();
  const normalized = [];
  for (const source of sources.slice(0, MAX_CITATION_SOURCES)) {
    if (!source || typeof source !== "object") continue;
    const title = boundedText(source.title, 1_000);
    const url = normalizeHttpUrl(source.url);
    const doi = boundedText(source.doi, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    if (!title && !url && !doi) continue;
    const id = normalizeDocumentId(source.id) || safeGeneratedId(idFactory);
    if (seen.has(id)) continue;
    seen.add(id);
    const createdAt = normalizeTimestamp(source.createdAt, now);
    const type = CITATION_TYPES.has(source.type) ? source.type : "other";
    normalized.push({
      id,
      type,
      title,
      authors: normalizeAuthors(source.authors),
      year: boundedText(String(source.year ?? ""), 32),
      containerTitle: boundedText(source.containerTitle, 1_000),
      publisher: boundedText(source.publisher, 500),
      url,
      doi,
      isbn: boundedText(source.isbn, 64),
      accessedAt: normalizeTimestamp(source.accessedAt, ""),
      pages: boundedText(source.pages, 128),
      notes: boundedText(source.notes, 10_000),
      ...normalizeCitationResearchIdentity(source),
      createdAt,
      updatedAt: normalizeTimestamp(source.updatedAt, createdAt),
    });
  }
  return normalized;
}

/** Canonical attrs for an inline `paperInternalLink` node. */
export function normalizeInternalLinkMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const documentId = normalizeDocumentId(metadata.documentId || metadata.targetDocumentId);
  if (!documentId) return null;
  return {
    documentId,
    title: boundedText(metadata.title || metadata.targetTitle, 500),
    label: boundedText(metadata.label, 500),
    pathHint: boundedText(metadata.pathHint, 2_048),
  };
}

export function createInternalLinkMetadata(targetDocument, options = {}) {
  return normalizeInternalLinkMetadata({
    documentId: targetDocument?.documentId,
    title: targetDocument?.title,
    label: options.label ?? targetDocument?.title,
    pathHint: options.pathHint ?? targetDocument?.pathHint ?? "",
  });
}

export function normalizeFootnoteReferenceMetadata(metadata) {
  const footnoteId = normalizeDocumentId(metadata?.footnoteId);
  return footnoteId ? { footnoteId } : null;
}

export function normalizeCitationReferenceMetadata(metadata) {
  const sourceId = normalizeDocumentId(metadata?.sourceId);
  if (!sourceId) return null;
  return {
    sourceId,
    pages: boundedText(metadata?.pages, 128),
    prefix: boundedText(metadata?.prefix, 500),
    suffix: boundedText(metadata?.suffix, 500),
  };
}

/**
 * Upgrades a supported document to canonical v2 metadata without mutating it.
 * Unknown top-level fields remain intact for forward-compatible feature data.
 */
export function normalizeDocumentSchemaV2(document, options = {}) {
  const source = document && typeof document === "object" && !Array.isArray(document) ? document : {};
  const inputVersion = readDocumentSchemaVersion(source);
  if (inputVersion > DOCUMENT_SCHEMA_VERSION) throw new UnsupportedDocumentSchemaVersionError(inputVersion);
  const idFactory = resolveIdFactory(options);
  const documentId = normalizeDocumentId(source.documentId) || safeGeneratedId(idFactory);
  const derivedFromCandidate = normalizeDocumentId(source.derivedFrom);
  return {
    ...source,
    version: DOCUMENT_SCHEMA_VERSION,
    documentId,
    derivedFrom: derivedFromCandidate && derivedFromCandidate !== documentId ? derivedFromCandidate : "",
    footnotes: normalizeDocumentFootnotes(source.footnotes, options),
    citationSources: normalizeCitationSources(source.citationSources, options),
  };
}

/** Creates only the identity fields needed by Save As / Copy Backup. */
export function createDerivedDocumentIdentity(sourceDocumentId, options = {}) {
  const parentId = normalizeDocumentId(sourceDocumentId);
  if (!parentId) throw new Error("派生文档必须引用有效的源 documentId");
  const nextId = safeGeneratedId(resolveIdFactory(options));
  if (nextId === parentId) throw new Error("派生文档 ID 不能与源文档相同");
  return { documentId: nextId, derivedFrom: parentId };
}

/** Adopt the identity committed by the main process without losing newer live edits. */
export function mergePersistedDocumentIdentity(liveDocument, persistedDocument) {
  const live = liveDocument && typeof liveDocument === "object" ? liveDocument : {};
  const persistedVersion = readDocumentSchemaVersion(persistedDocument);
  if (persistedVersion < DOCUMENT_SCHEMA_VERSION) return { ...live };
  if (persistedVersion > DOCUMENT_SCHEMA_VERSION) throw new UnsupportedDocumentSchemaVersionError(persistedVersion);
  const documentId = normalizeDocumentId(persistedDocument?.documentId);
  if (!documentId) throw new Error("保存结果缺少有效的 documentId");
  const derivedFromCandidate = normalizeDocumentId(persistedDocument?.derivedFrom);
  return {
    ...live,
    version: DOCUMENT_SCHEMA_VERSION,
    documentId,
    derivedFrom: derivedFromCandidate && derivedFromCandidate !== documentId ? derivedFromCandidate : "",
  };
}
