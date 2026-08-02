import { normalizeCitationStyle } from "../document-schema-v2.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_LANGUAGE_PATTERN = /^[a-z0-9_+.-]+$/;
const MAX_LATEX_CHARS = 20_000;
const MAX_MERMAID_CHARS = 40_000;
const MAX_MERMAID_LINES = 1_500;
const MAX_BOOKMARK_LABEL_CHARS = 200;

export const MERMAID_WIDTH_OPTIONS = Object.freeze([
  { id: "small", label: "小", width: "45%" },
  { id: "medium", label: "中", width: "62%" },
  { id: "large", label: "大", width: "78%" },
  { id: "full", label: "满", width: "100%" },
]);

const MERMAID_WIDTHS = new Set(MERMAID_WIDTH_OPTIONS.map((option) => option.width));

export function normalizeMermaidWidth(value) {
  const candidate = cleanText(value, 12);
  return MERMAID_WIDTHS.has(candidate) ? candidate : "78%";
}

export const MATH_MODES = Object.freeze([
  { id: "inline", label: "行内公式" },
  { id: "block", label: "块公式" },
]);

export const CODE_LANGUAGES = Object.freeze([
  { id: "plaintext", label: "纯文本" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "java", label: "Java" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "json", label: "JSON" },
  { id: "bash", label: "Shell / Bash" },
  { id: "sql", label: "SQL" },
  { id: "markdown", label: "Markdown" },
  { id: "yaml", label: "YAML" },
  { id: "xml", label: "XML" },
  { id: "latex", label: "LaTeX" },
]);

export const CITATION_FORMATS = Object.freeze([
  { id: "bibtex", label: "BibTeX", extension: ".bib" },
  { id: "ris", label: "RIS", extension: ".ris" },
  { id: "csl-json", label: "CSL-JSON", extension: ".json" },
]);

export const FALLBACK_CITATION_STYLES = Object.freeze([
  { styleId: "gb-t-7714-2015-numeric", locale: "zh-CN", label: "GB/T 7714—2015（数字制）" },
  { styleId: "gb-t-7714-2015-author-date", locale: "zh-CN", label: "GB/T 7714—2015（作者-年份）" },
  { styleId: "apa-7", locale: "en-US", label: "APA 7" },
  { styleId: "mla-9", locale: "en-US", label: "MLA 9" },
  { styleId: "chicago-author-date", locale: "en-US", label: "Chicago Author-Date" },
]);

function cleanText(value, maximum, { trim = true } = {}) {
  const clean = typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maximum)
    : "";
  return trim ? clean.trim() : clean;
}

export function normalizeProfessionalId(value) {
  const source = cleanText(value, 64).toLowerCase();
  return UUID_PATTERN.test(source) ? source : "";
}

export function normalizeMathDraft(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const mode = source.mode === "inline" ? "inline" : "block";
  return {
    mode,
    latex: cleanText(source.latex, MAX_LATEX_CHARS, { trim: false }).trim(),
    equationId: mode === "block" ? normalizeProfessionalId(source.equationId) : "",
    label: mode === "block" ? cleanText(source.label, 200) : "",
    numbering: mode === "block" && source.numbering !== false,
  };
}

export function validateMathDraft(value = {}) {
  const normalized = normalizeMathDraft(value);
  if (!normalized.latex) return { valid: false, error: "请输入 TeX 公式源码", value: normalized };
  return { valid: true, error: "", value: normalized };
}

export function normalizeMermaidDraft(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    diagramId: normalizeProfessionalId(source.diagramId),
    source: cleanText(source.source, Number.MAX_SAFE_INTEGER, { trim: false }),
    caption: cleanText(source.caption, 500),
    width: normalizeMermaidWidth(source.width),
  };
}

export function validateMermaidDraft(value = {}) {
  const normalized = normalizeMermaidDraft(value);
  if (!normalized.source.trim()) return { valid: false, error: "请输入 Mermaid 源码", value: normalized };
  if (normalized.source.length > MAX_MERMAID_CHARS) {
    return { valid: false, error: `Mermaid 源码不能超过 ${MAX_MERMAID_CHARS.toLocaleString()} 个字符`, value: normalized };
  }
  const lineCount = normalized.source.split(/\r?\n/).length;
  if (lineCount > MAX_MERMAID_LINES) {
    return { valid: false, error: `Mermaid 源码不能超过 ${MAX_MERMAID_LINES.toLocaleString()} 行`, value: normalized };
  }
  return { valid: true, error: "", value: normalized };
}

export function normalizeCodeBlockOptions(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const candidate = cleanText(source.language, 48).toLowerCase();
  return {
    language: CODE_LANGUAGE_PATTERN.test(candidate) ? candidate : "plaintext",
    wrap: source.wrap === true,
  };
}

export function normalizeBookmark(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    bookmarkId: normalizeProfessionalId(source.bookmarkId),
    label: cleanText(source.label, MAX_BOOKMARK_LABEL_CHARS),
  };
}

function visitDocumentNodes(documentNode, visitor) {
  if (typeof documentNode?.descendants === "function") {
    documentNode.descendants((node, position) => visitor(node, position));
    return;
  }
  let position = 0;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    visitor(node, position);
    position += 1;
    (Array.isArray(node.content) ? node.content : []).forEach(visit);
  };
  visit(documentNode);
}

function nodeTypeName(node) {
  return typeof node?.type === "string" ? node.type : node?.type?.name;
}

export function collectEquationTargets(documentNode) {
  const targets = [];
  const seen = new Set();
  let number = 0;
  visitDocumentNodes(documentNode, (node, position) => {
    if (nodeTypeName(node) !== "blockMath") return;
    const equationId = normalizeProfessionalId(node.attrs?.equationId);
    if (!equationId || seen.has(equationId)) return;
    seen.add(equationId);
    const referenceable = node.attrs?.numbering !== false;
    if (referenceable) number += 1;
    const latex = cleanText(node.attrs?.latex, MAX_LATEX_CHARS, { trim: false }).trim();
    const label = cleanText(node.attrs?.label, 200);
    targets.push({
      equationId,
      label,
      latex,
      number: referenceable ? number : null,
      position,
      referenceable,
      displayLabel: label || (referenceable ? `公式（${number}）` : "未编号公式"),
    });
  });
  return targets;
}

export function collectBookmarks(documentNode) {
  const bookmarks = [];
  const seen = new Set();
  visitDocumentNodes(documentNode, (node, position) => {
    if (nodeTypeName(node) !== "paperBookmark") return;
    const bookmarkId = normalizeProfessionalId(node.attrs?.bookmarkId);
    if (!bookmarkId || seen.has(bookmarkId)) return;
    seen.add(bookmarkId);
    let context = "";
    if (typeof documentNode?.resolve === "function" && Number.isFinite(position)) {
      try {
        const parent = documentNode.resolve(position).parent;
        context = cleanText(parent?.textBetween?.(0, parent.content.size, " ", "") || "", 160);
      } catch {
        context = "";
      }
    }
    const label = cleanText(node.attrs?.label, MAX_BOOKMARK_LABEL_CHARS);
    bookmarks.push({
      bookmarkId,
      label,
      context,
      position,
      displayLabel: label || context || `书签 ${bookmarks.length + 1}`,
    });
  });
  return bookmarks;
}

function normalizeDoi(value) {
  return cleanText(value, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
}

function normalizeIsbn(value) {
  return cleanText(value, 64).replace(/[-\s]/g, "").toUpperCase();
}

function normalizeCitationKey(value) {
  return cleanText(value, 200).toLowerCase();
}

function normalizeCitationTitle(value) {
  return cleanText(value, 1_000)
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function normalizeCitationFirstAuthor(source = {}) {
  const projectedAuthor = Array.isArray(source.authors) ? source.authors[0] : "";
  const cslAuthor = Array.isArray(source.csl?.author) ? source.csl.author[0] : null;
  const cslAuthorText = cslAuthor && typeof cslAuthor === "object"
    ? [cslAuthor.family, cslAuthor.given, cslAuthor.literal].filter(Boolean).join(" ")
    : cslAuthor;
  return cleanText(projectedAuthor || cslAuthorText, 400)
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function citationIdentityKeys(source = {}) {
  const keys = [];
  const id = normalizeProfessionalId(source.id);
  const doi = normalizeDoi(source.doi || source.csl?.DOI);
  const isbn = normalizeIsbn(source.isbn || source.csl?.ISBN);
  const citationKey = normalizeCitationKey(source.citationKey || source.csl?.id);
  const title = normalizeCitationTitle(source.title || source.csl?.title);
  const firstAuthor = normalizeCitationFirstAuthor(source);
  const year = cleanText(String(source.year ?? ""), 32);
  if (id) keys.push(`id:${id}`);
  if (doi) keys.push(`doi:${doi}`);
  if (isbn) keys.push(`isbn:${isbn}`);
  if (citationKey) keys.push(`key:${citationKey}`);
  if (title && firstAuthor && year) keys.push(`title:${title}|author:${firstAuthor}|year:${year}`);
  return keys;
}

const CITATION_COMPARE_FIELDS = Object.freeze([
  "title",
  "authors",
  "year",
  "containerTitle",
  "publisher",
  "url",
  "doi",
  "isbn",
  "pages",
]);

function comparableCitationValue(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(String(item), 200)).join("|");
  return cleanText(String(value ?? ""), 2_048).toLocaleLowerCase("zh-CN");
}

export function citationDifferences(existing = {}, incoming = {}) {
  return CITATION_COMPARE_FIELDS.filter((field) => (
    (field === "doi" ? normalizeDoi(existing[field]) : (
      field === "isbn" ? normalizeIsbn(existing[field]) : comparableCitationValue(existing[field])
    )) !== (field === "doi" ? normalizeDoi(incoming[field]) : (
      field === "isbn" ? normalizeIsbn(incoming[field]) : comparableCitationValue(incoming[field])
    ))
  )).map((field) => ({
    field,
    existing: existing[field],
    incoming: incoming[field],
  }));
}

export function createCitationImportPreview(existingSources = [], incomingSources = []) {
  const existing = Array.isArray(existingSources) ? existingSources.filter(Boolean) : [];
  const incoming = Array.isArray(incomingSources) ? incomingSources.filter(Boolean) : [];
  const identityIndex = new Map();
  existing.forEach((source) => citationIdentityKeys(source).forEach((key) => {
    if (!identityIndex.has(key)) identityIndex.set(key, source);
  }));

  const entries = incoming.map((source, index) => {
    const keys = citationIdentityKeys(source);
    const matched = keys.map((key) => identityIndex.get(key)).find(Boolean) || null;
    const differences = matched ? citationDifferences(matched, source) : [];
    const status = !matched ? "new" : (differences.length ? "conflict" : "duplicate");
    const entry = {
      id: normalizeProfessionalId(source.id) || `incoming-${index + 1}`,
      status,
      source,
      existing: matched,
      differences,
    };
    if (!matched) keys.forEach((key) => identityIndex.set(key, source));
    return entry;
  });

  return {
    entries,
    counts: {
      total: entries.length,
      new: entries.filter((entry) => entry.status === "new").length,
      conflict: entries.filter((entry) => entry.status === "conflict").length,
      duplicate: entries.filter((entry) => entry.status === "duplicate").length,
    },
  };
}

function citationValueIsEmpty(value) {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value).length === 0;
}

function fillCitationObjectEmpties(existing, incoming, depth = 0) {
  if (depth > 8 || !incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return citationValueIsEmpty(existing) ? incoming : existing;
  }
  const base = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...existing }
    : {};
  Object.entries(incoming).forEach(([key, incomingValue]) => {
    if (key === "__proto__" || key === "constructor" || key === "prototype") return;
    const existingValue = base[key];
    if (
      incomingValue
      && typeof incomingValue === "object"
      && !Array.isArray(incomingValue)
      && existingValue
      && typeof existingValue === "object"
      && !Array.isArray(existingValue)
    ) {
      base[key] = fillCitationObjectEmpties(existingValue, incomingValue, depth + 1);
    } else if (citationValueIsEmpty(existingValue) && !citationValueIsEmpty(incomingValue)) {
      base[key] = incomingValue;
    }
  });
  return base;
}

function mergeCitationKeepingLocal(existing = {}, incoming = {}) {
  const merged = { ...existing };
  Object.entries(incoming).forEach(([key, incomingValue]) => {
    if (
      key === "id"
      || key === "createdAt"
      || key === "__proto__"
      || key === "constructor"
      || key === "prototype"
    ) return;
    if (key === "csl") {
      merged.csl = fillCitationObjectEmpties(existing.csl, incomingValue);
      return;
    }
    if (citationValueIsEmpty(merged[key]) && !citationValueIsEmpty(incomingValue)) {
      merged[key] = incomingValue;
    }
  });
  merged.id = existing.id;
  merged.createdAt = existing.createdAt || incoming.createdAt;
  return merged;
}

function defaultCitationIdFactory() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function createUniqueCitationId(usedIds, idFactory) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = normalizeProfessionalId(idFactory());
    if (candidate && !usedIds.has(candidate)) return candidate;
  }
  throw new Error("无法为保留的文献副本生成唯一 ID");
}

export function mergeCitationImportPreview(
  existingSources = [],
  preview = {},
  decisions = {},
  { idFactory = defaultCitationIdFactory } = {},
) {
  const merged = (Array.isArray(existingSources) ? existingSources : []).map((source) => ({ ...source }));
  const entries = Array.isArray(preview?.entries) ? preview.entries : [];
  const usedIds = new Set(merged.map((source) => normalizeProfessionalId(source.id)).filter(Boolean));

  entries.forEach((entry) => {
    if (entry.status === "new") {
      merged.push({ ...entry.source });
      const appendedId = normalizeProfessionalId(entry.source?.id);
      if (appendedId) usedIds.add(appendedId);
      return;
    }
    if (entry.status !== "conflict") return;
    const decision = decisions[entry.id] || "skip";
    if (decision === "keep-both") {
      const duplicate = {
        ...entry.source,
        id: createUniqueCitationId(usedIds, idFactory),
      };
      usedIds.add(duplicate.id);
      merged.push(duplicate);
      return;
    }
    if (decision !== "merge") return;
    const existingId = entry.existing?.id;
    const index = merged.findIndex((source) => source.id === existingId);
    if (index < 0) return;
    merged[index] = mergeCitationKeepingLocal(merged[index], entry.source);
  });

  return merged;
}

export function normalizeCitationStyleChoice(value = {}) {
  const normalized = normalizeCitationStyle(value);
  return {
    ...normalized,
    locale: normalized.locale.toLowerCase() === "zh-cn" ? "zh-CN" : "en-US",
  };
}

export function citationStyleChoiceFromPickerResult(result, fallbackLocale = "zh-CN") {
  if (!result || result.canceled) return null;
  const styleResult = result.style && typeof result.style === "object" ? result.style : result;
  const customStyle = result.customStyle || styleResult.customStyle || styleResult;
  const normalized = normalizeCitationStyleChoice({
    styleId: styleResult.styleId || customStyle?.styleId,
    locale: styleResult.locale || fallbackLocale,
    customStyle,
  });
  return normalized.customStyle ? normalized : null;
}

export function citationSearchText(source = {}) {
  return [
    source.title,
    ...(Array.isArray(source.authors) ? source.authors : []),
    source.year,
    source.containerTitle,
    source.publisher,
    source.url,
    source.doi,
    source.isbn,
    source.citationKey,
  ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
}

export const PROFESSIONAL_UI_LIMITS = Object.freeze({
  maxBookmarkLabelChars: MAX_BOOKMARK_LABEL_CHARS,
  maxLatexChars: MAX_LATEX_CHARS,
  maxMermaidChars: MAX_MERMAID_CHARS,
  maxMermaidLines: MAX_MERMAID_LINES,
});
