const { createHash, randomUUID } = require("node:crypto");

require("@citation-js/plugin-bibtex");
require("@citation-js/plugin-ris");
require("@citation-js/plugin-csl");
const { Cite, plugins } = require("@citation-js/core");
const {
  BUILT_IN_STYLE_TEMPLATES,
  registerBuiltInCitationStyles,
} = require("./citation-styles.cjs");

const MAX_IMPORT_CHARS = 4 * 1024 * 1024;
const MAX_ITEMS = 5_000;
const LOOKUP_TIMEOUT_MS = 10_000;
const LOOKUP_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_LOOKUP_CACHE_ENTRIES = 500;
const MAX_LOOKUP_RETRIES = 2;
const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i;
const ISBN_PATTERN = /^(?:97[89])?\d{9}[\dX]$/i;
const BUILT_IN_CITATION_STYLES = Object.freeze([
  { styleId: "gb-t-7714-2015-numeric", locale: "zh-CN", label: "GB/T 7714—2015（数字制）" },
  { styleId: "gb-t-7714-2015-author-date", locale: "zh-CN", label: "GB/T 7714—2015（作者-年份）" },
  { styleId: "apa-7", locale: "en-US", label: "APA 7" },
  { styleId: "mla-9", locale: "en-US", label: "MLA 9" },
  { styleId: "chicago-author-date", locale: "en-US", label: "Chicago Author-Date" },
]);
const cslStyleRegister = plugins.config.get("@csl")?.styles;
if (!cslStyleRegister) throw new Error("Citation.js CSL 样式注册器不可用");
registerBuiltInCitationStyles(cslStyleRegister);

function cleanText(value, maximum = 1_000) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum)
    : "";
}

function normalizeDoi(value) {
  const doi = cleanText(value, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  return DOI_PATTERN.test(doi) ? doi : "";
}

function normalizeIsbn(value) {
  const isbn = cleanText(value, 64).replace(/[-\s]/g, "").toUpperCase();
  return ISBN_PATTERN.test(isbn) ? isbn : "";
}

function safeCslValue(value, depth = 0) {
  if (depth > 8) return undefined;
  if (typeof value === "string") return cleanText(value, 20_000);
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => safeCslValue(item, depth + 1)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return undefined;
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 500)) {
    const key = cleanText(rawKey, 100);
    if (!key || key.startsWith("_") || ["__proto__", "prototype", "constructor"].includes(key)) continue;
    const normalized = safeCslValue(rawValue, depth + 1);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function cslAuthorsToStrings(value) {
  return (Array.isArray(value) ? value : []).slice(0, 100).map((author) => {
    if (author?.literal) return cleanText(author.literal, 200);
    return cleanText([author?.family, author?.given].filter(Boolean).join(", "), 200);
  }).filter(Boolean);
}

function cslYear(value) {
  const year = value?.["date-parts"]?.[0]?.[0];
  return Number.isFinite(Number(year)) ? String(year) : "";
}

function cslToCitationSource(raw, idFactory = randomUUID) {
  const csl = safeCslValue(raw);
  if (!csl || typeof csl !== "object" || Array.isArray(csl)) return null;
  const doi = normalizeDoi(csl.DOI);
  const isbn = normalizeIsbn(Array.isArray(csl.ISBN) ? csl.ISBN[0] : csl.ISBN);
  const title = cleanText(csl.title, 1_000);
  const url = /^https?:\/\//i.test(String(csl.URL || "")) ? cleanText(csl.URL, 2_048) : "";
  if (!title && !doi && !isbn && !url) return null;
  const citationKey = cleanText(csl["citation-key"] || csl.id, 200).replace(/[^a-zA-Z0-9_.:+/-]/g, "-");
  const id = String(idFactory()).toLowerCase();
  return {
    id,
    citationKey,
    csl: { ...csl, id: citationKey || csl.id || id },
    type: ({
      book: "book",
      "article-journal": "article",
      article: "article",
      webpage: "web",
      report: "report",
      thesis: "thesis",
    })[csl.type] || "other",
    title,
    authors: cslAuthorsToStrings(csl.author),
    year: cslYear(csl.issued),
    containerTitle: cleanText(csl["container-title"], 1_000),
    publisher: cleanText(csl.publisher, 500),
    url,
    doi,
    isbn,
    pages: cleanText(csl.page, 128),
    notes: cleanText(csl.note, 10_000),
  };
}

function citationSourceToCsl(source) {
  if (source?.csl && typeof source.csl === "object" && !Array.isArray(source.csl)) {
    return {
      ...safeCslValue(source.csl),
      id: cleanText(source.citationKey || source.csl.id || source.id, 200),
    };
  }
  const author = (Array.isArray(source?.authors) ? source.authors : []).map((name) => ({ literal: cleanText(name, 200) }));
  const year = Number.parseInt(source?.year, 10);
  return {
    id: cleanText(source?.citationKey || source?.id, 200),
    type: ({ book: "book", article: "article-journal", web: "webpage", report: "report", thesis: "thesis" })[source?.type] || "document",
    title: cleanText(source?.title, 1_000),
    ...(author.length ? { author } : {}),
    ...(Number.isFinite(year) ? { issued: { "date-parts": [[year]] } } : {}),
    ...(source?.containerTitle ? { "container-title": cleanText(source.containerTitle, 1_000) } : {}),
    ...(source?.publisher ? { publisher: cleanText(source.publisher, 500) } : {}),
    ...(normalizeDoi(source?.doi) ? { DOI: normalizeDoi(source.doi) } : {}),
    ...(normalizeIsbn(source?.isbn) ? { ISBN: normalizeIsbn(source.isbn) } : {}),
    ...(source?.url ? { URL: cleanText(source.url, 2_048) } : {}),
    ...(source?.pages ? { page: cleanText(source.pages, 128) } : {}),
  };
}

function detectInputFormat(text, requested) {
  const format = cleanText(requested, 32).toLowerCase();
  if (["bibtex", "ris", "csl-json"].includes(format)) return format;
  const source = text.trim();
  if (/^@\w+\s*[{(]/m.test(source)) return "bibtex";
  if (/^TY\s{0,2}-\s/m.test(source) && /^ER\s{0,2}-/m.test(source)) return "ris";
  if (source.startsWith("{") || source.startsWith("[")) return "csl-json";
  throw new Error("无法识别文献格式");
}

function createCitationRuntime({
  fetchImpl = globalThis.fetch,
  idFactory = randomUUID,
  loadLookupCache,
  now = () => Date.now(),
  random = Math.random,
  saveLookupCache,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
} = {}) {
  let queue = Promise.resolve();
  let lastLookupAt = 0;
  let lookupCacheLoaded = false;
  const lookupCache = new Map();
  const customStyleKeys = [];

  function parse({ text, format = "auto" } = {}) {
    const input = typeof text === "string" ? text : "";
    if (!input.trim() || input.length > MAX_IMPORT_CHARS) throw new Error("文献内容为空或超过 4 MiB 上限");
    const resolvedFormat = detectInputFormat(input, format);
    let cite;
    try {
      const data = resolvedFormat === "csl-json" ? JSON.parse(input) : input;
      cite = new Cite(data);
    } catch (error) {
      throw new Error(`文献解析失败：${cleanText(error?.message || error, 500)}`);
    }
    const sources = cite.data.slice(0, MAX_ITEMS).map((item) => cslToCitationSource(item, idFactory)).filter(Boolean);
    return { format: resolvedFormat, sources, truncated: cite.data.length > MAX_ITEMS };
  }

  function exportSources({ sources, format = "csl-json" } = {}) {
    const items = (Array.isArray(sources) ? sources : []).slice(0, MAX_ITEMS).map(citationSourceToCsl);
    const cite = new Cite(items);
    const resolvedFormat = detectInputFormat("[]", format);
    if (resolvedFormat === "csl-json") return { format: resolvedFormat, text: JSON.stringify(items, null, 2), extension: ".json" };
    return {
      format: resolvedFormat,
      text: String(cite.format(resolvedFormat === "bibtex" ? "bibtex" : "ris")),
      extension: resolvedFormat === "bibtex" ? ".bib" : ".ris",
    };
  }

  function validateCslStyle({ xml } = {}) {
    const source = typeof xml === "string" ? xml.trim() : "";
    if (!source || source.length > 512 * 1024) throw new Error("CSL 样式为空或超过 512 KiB 上限");
    if (/<!DOCTYPE|<!ENTITY|\bSYSTEM\b|\bPUBLIC\b/i.test(source)) throw new Error("CSL 样式不能包含 DTD 或外部实体");
    if (/<link\b[^>]*\bhref\s*=\s*["'](?:https?:|file:|\/\/)/i.test(source)) throw new Error("CSL 样式不能引用外部网络资源");
    const root = /^<\?xml[^>]*>\s*<style\b([^>]*)>|^<style\b([^>]*)>/i.exec(source);
    const attributes = root?.[1] || root?.[2] || "";
    if (!root || !/xmlns\s*=\s*["']http:\/\/purl\.org\/net\/xbiblio\/csl["']/i.test(attributes)) {
      throw new Error("不是有效的 CSL 1.0 样式");
    }
    const title = cleanText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1], 200);
    const hash = createHash("sha256").update(source, "utf8").digest("hex");
    return {
      valid: true,
      styleId: `custom-${hash.slice(0, 24)}`,
      title: title || "自定义 CSL 样式",
      hash,
      xml: source,
    };
  }

  function resolveStyle({ styleId, customStyle } = {}) {
    const requested = cleanText(styleId, 200)
      || "gb-t-7714-2015-numeric";
    const builtIn = BUILT_IN_STYLE_TEMPLATES[requested];
    if (builtIn) {
      return {
        styleId: requested,
        template: builtIn.template,
        citationKind: builtIn.citationKind,
      };
    }
    const validated = validateCslStyle({
      xml: customStyle?.xml,
    });
    if (
      requested !== validated.styleId
      || (
        customStyle?.hash
        && cleanText(customStyle.hash, 64).toLowerCase()
          !== validated.hash
      )
    ) {
      throw new Error("自定义 CSL 样式身份或校验和不匹配");
    }
    const template = `jianjian-${validated.styleId}`;
    if (!cslStyleRegister.has(template)) {
      cslStyleRegister.add(template, validated.xml);
      customStyleKeys.push(template);
      while (customStyleKeys.length > 32) {
        cslStyleRegister.remove(customStyleKeys.shift());
      }
    }
    const numeric = /citation-format\s*=\s*["']numeric["']|collapse\s*=\s*["']citation-number["']/i.test(
      validated.xml,
    );
    return {
      styleId: validated.styleId,
      template,
      citationKind: numeric ? "numeric" : "author-date",
      customStyle: validated,
    };
  }

  function formattingItems(sources) {
    return (Array.isArray(sources) ? sources : [])
      .slice(0, MAX_ITEMS)
      .map((source, index) => {
        const sourceId = cleanText(source?.id, 200)
          || `citation-source-${index + 1}`;
        return {
          sourceId,
          csl: {
            ...citationSourceToCsl(source),
            id: sourceId,
          },
        };
      });
  }

  function cleanFormattedText(value) {
    return String(value || "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .replace(/\s*\r?\n\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20_000);
  }

  function formatSources({
    sources,
    styleId = "gb-t-7714-2015-numeric",
    locale = "zh-CN",
    customStyle,
  } = {}) {
    const resolvedLocale = /^(?:zh-CN|en-US)$/i.test(String(locale || ""))
      ? (String(locale).toLowerCase() === "zh-cn" ? "zh-CN" : "en-US")
      : "zh-CN";
    const style = resolveStyle({ styleId, customStyle });
    const normalized = formattingItems(sources);
    const cite = new Cite(normalized.map((item) => item.csl));
    let entryPairs;
    try {
      entryPairs = cite.format("bibliography", {
        asEntryArray: true,
        format: "text",
        lang: resolvedLocale,
        template: style.template,
      });
    } catch (error) {
      throw new Error(`CSL 排版失败：${cleanText(error?.message || error, 500)}`);
    }
    const entries = [];
    const entryIds = [];
    const entriesById = {};
    for (const [sourceId, text] of Array.isArray(entryPairs) ? entryPairs : []) {
      const formatted = cleanFormattedText(text);
      if (!formatted) continue;
      entries.push(formatted);
      entryIds.push(sourceId);
      entriesById[sourceId] = formatted;
    }
    const citationsById = {};
    normalized.forEach(({ sourceId }, index) => {
      if (style.citationKind === "numeric") {
        citationsById[sourceId] = String(index + 1);
        return;
      }
      try {
        citationsById[sourceId] = cleanFormattedText(cite.format("citation", {
          entry: sourceId,
          format: "text",
          lang: resolvedLocale,
          template: style.template,
        }));
      } catch {
        citationsById[sourceId] = "";
      }
    });
    return {
      styleId: style.styleId,
      locale: resolvedLocale,
      citationKind: style.citationKind,
      entries,
      entryIds,
      entriesById,
      citationsById,
      ...(style.customStyle
        ? {
          customStyle: {
            styleId: style.customStyle.styleId,
            title: style.customStyle.title,
            hash: style.customStyle.hash,
            xml: style.customStyle.xml,
          },
        }
        : {}),
    };
  }

  function cloneCacheValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  async function ensureLookupCacheLoaded() {
    if (lookupCacheLoaded) return;
    lookupCacheLoaded = true;
    if (typeof loadLookupCache !== "function") return;
    let persisted;
    try {
      persisted = await loadLookupCache();
    } catch {
      return;
    }
    const entries = Array.isArray(persisted?.entries)
      ? persisted.entries.slice(-MAX_LOOKUP_CACHE_ENTRIES)
      : [];
    for (const entry of entries) {
      const key = cleanText(entry?.key, 400).toLowerCase();
      const cachedAt = Number(entry?.cachedAt);
      if (
        !key
        || !Number.isFinite(cachedAt)
        || now() - cachedAt < 0
        || now() - cachedAt > LOOKUP_CACHE_TTL_MS
      ) {
        continue;
      }
      const value = safeCslValue(entry?.value);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        lookupCache.set(key, { cachedAt, value });
      }
    }
  }

  async function persistLookupCache() {
    if (typeof saveLookupCache !== "function") return;
    const entries = [...lookupCache.entries()]
      .sort((left, right) => left[1].cachedAt - right[1].cachedAt)
      .slice(-MAX_LOOKUP_CACHE_ENTRIES)
      .map(([key, entry]) => ({
        key,
        cachedAt: entry.cachedAt,
        value: entry.value,
      }));
    await saveLookupCache({ version: 1, entries });
  }

  async function cachedLookup(key, task) {
    await ensureLookupCacheLoaded();
    const normalizedKey = cleanText(key, 400).toLowerCase();
    const cached = lookupCache.get(normalizedKey);
    if (
      cached
      && now() - cached.cachedAt >= 0
      && now() - cached.cachedAt <= LOOKUP_CACHE_TTL_MS
    ) {
      return cloneCacheValue(cached.value);
    }
    lookupCache.delete(normalizedKey);
    const value = await task();
    lookupCache.set(normalizedKey, {
      cachedAt: now(),
      value: cloneCacheValue(value),
    });
    while (lookupCache.size > MAX_LOOKUP_CACHE_ENTRIES) {
      lookupCache.delete(lookupCache.keys().next().value);
    }
    try {
      await persistLookupCache();
    } catch {
      // A cache write must never turn a successful metadata lookup into a
      // failed user action. The bounded in-memory cache remains available.
    }
    return value;
  }

  function retryDelay(response, attempt) {
    const rawRetryAfter = response?.headers?.get?.("retry-after");
    const seconds = rawRetryAfter == null || rawRetryAfter === ""
      ? Number.NaN
      : Number(rawRetryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(5_000, seconds * 1_000);
    }
    const retryDate = Date.parse(String(rawRetryAfter || ""));
    if (Number.isFinite(retryDate)) {
      return Math.max(0, Math.min(5_000, retryDate - now()));
    }
    const jitter = Math.max(0, Math.min(1, Number(random()) || 0));
    return Math.round((250 * (2 ** attempt)) + (jitter * 125));
  }

  async function fetchJson(url, headers = {}) {
    if (typeof fetchImpl !== "function") throw new Error("当前环境不支持联网补全");
    for (let attempt = 0; attempt <= MAX_LOOKUP_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          headers: { Accept: "application/json", ...headers },
          redirect: "error",
          signal: controller.signal,
        });
        const retryable = response.status === 429
          || response.status === 502
          || response.status === 503
          || response.status === 504;
        if (retryable && attempt < MAX_LOOKUP_RETRIES) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        if (!response.ok) {
          const error = new Error(
            response.status === 404
              ? "未找到文献元数据"
              : (
                response.status === 429
                  ? "文献服务请求过于频繁，请稍后重试"
                  : `文献服务返回 ${response.status}`
              ),
          );
          error.status = response.status;
          throw error;
        }
        return await response.json();
      } catch (error) {
        if (
          attempt < MAX_LOOKUP_RETRIES
          && error?.name !== "AbortError"
          && !Number.isFinite(Number(error?.status))
        ) {
          await sleep(retryDelay(null, attempt));
          continue;
        }
        if (error?.name === "AbortError") {
          throw new Error("文献服务请求超时");
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("文献服务请求失败");
  }

  async function throttled(task) {
    const run = queue.then(async () => {
      const remaining = Math.max(0, 250 - (now() - lastLookupAt));
      if (remaining) await sleep(remaining);
      lastLookupAt = now();
      return task();
    });
    queue = run.catch(() => {});
    return run;
  }

  async function lookupDoi(rawDoi) {
    const doi = normalizeDoi(rawDoi);
    if (!doi) throw new Error("DOI 格式无效");
    return cachedLookup(`doi:${doi}`, () => throttled(async () => {
      let data;
      try {
        const result = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
          "User-Agent": "Jianjian/1.0 (mailto:privacy@invalid.local)",
        });
        data = result?.message;
      } catch (error) {
        if (error?.status !== 404) throw error;
        const result = await fetchJson(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`);
        const attributes = result?.data?.attributes || {};
        data = {
          DOI: attributes.doi,
          title: attributes.titles?.[0]?.title,
          author: attributes.creators?.map((creator) => ({ literal: creator.name })),
          published: attributes.published ? { "date-parts": [[Number.parseInt(attributes.published, 10)]] } : undefined,
          URL: attributes.url,
          type: attributes.types?.citeproc || "article",
          publisher: attributes.publisher,
        };
      }
      const csl = {
        id: doi,
        type: data?.type === "journal-article" ? "article-journal" : (data?.type || "article"),
        title: Array.isArray(data?.title) ? data.title[0] : data?.title,
        author: data?.author,
        issued: data?.published || data?.issued || data?.created,
        "container-title": Array.isArray(data?.["container-title"]) ? data["container-title"][0] : data?.["container-title"],
        publisher: data?.publisher,
        DOI: doi,
        URL: data?.URL,
        page: data?.page,
      };
      return cslToCitationSource(csl, idFactory);
    }));
  }

  async function lookupIsbn(rawIsbn) {
    const isbn = normalizeIsbn(rawIsbn);
    if (!isbn) throw new Error("ISBN 格式无效");
    return cachedLookup(`isbn:${isbn}`, () => throttled(async () => {
      const result = await fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`);
      const data = result?.[`ISBN:${isbn}`];
      if (!data) throw new Error("未找到文献元数据");
      return cslToCitationSource({
        id: isbn,
        type: "book",
        title: data.title,
        author: data.authors?.map((author) => ({ literal: author.name })),
        issued: data.publish_date ? { raw: data.publish_date } : undefined,
        publisher: data.publishers?.[0]?.name,
        ISBN: isbn,
        URL: data.url,
      }, idFactory);
    }));
  }

  async function lookup(payload = {}) {
    if (payload.privacyConsent !== true) {
      throw new Error("请先确认联网补全隐私说明");
    }
    if (payload.kind === "doi") return lookupDoi(payload.value);
    if (payload.kind === "isbn") return lookupIsbn(payload.value);
    throw new Error("只支持 DOI 或 ISBN 补全");
  }

  return {
    builtInStyles: () => BUILT_IN_CITATION_STYLES.map((style) => ({ ...style })),
    exportSources,
    formatSources,
    lookup,
    parse,
    validateCslStyle,
  };
}

module.exports = {
  MAX_IMPORT_CHARS,
  BUILT_IN_CITATION_STYLES,
  citationSourceToCsl,
  createCitationRuntime,
  cslToCitationSource,
  normalizeDoi,
  normalizeIsbn,
};
