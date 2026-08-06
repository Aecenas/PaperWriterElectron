const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const JSZip = require("jszip");
const { preflightZipBuffer } = require("./document-storage.cjs");
const { normalizeCitationStyle } = require("./document-model.cjs");
const { segmentDocxTextByEmojiFont } = require("./docx-emoji-font.cjs");

const SUPPORTED_IMPORT_FORMATS = Object.freeze(["markdown", "html", "txt", "docx"]);
const SUPPORTED_EXPORT_FORMATS = Object.freeze(["markdown", "html", "txt", "docx"]);
const DEFAULT_LIMITS = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxTextBytes: 32 * 1024 * 1024,
  maxAssetBytes: 32 * 1024 * 1024,
  maxTotalAssetBytes: 128 * 1024 * 1024,
  maxAssetEntries: 512,
  maxDocxExpandedBytes: 256 * 1024 * 1024,
  maxDocxEntries: 4096,
  maxDocxCompressionRatio: 100,
  maxDocxRenderedHtmlBytes: 48 * 1024 * 1024,
  maxDocxRenderedNodes: 256,
  maxDocxRenderedPngBytes: 2 * 1024 * 1024,
  maxDocxRenderedTotalPngBytes: 16 * 1024 * 1024,
  maxDocxRenderedDimension: 2400,
  maxDocxRenderedPixels: 4_000_000,
});
const MAX_CODE_SOURCE_CHARS = DEFAULT_LIMITS.maxTextBytes;

const ALLOWED_TAGS = new Set([
  "a", "b", "blockquote", "br", "code", "del", "div", "em", "figcaption", "figure",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre",
  "s", "section", "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th",
  "thead", "tr", "u", "ul",
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "template", "noscript", "form", "svg", "math"];
const SAFE_DATA_ATTRIBUTES = new Set([
  "data-citation-pages", "data-citation-source-id", "data-document-id", "data-footnote-id", "data-footnote-ref",
  "data-footnotes", "data-reference-list", "data-references", "data-type",
  "data-code-language", "data-code-wrap", "data-latex", "data-equation-id", "data-equation-label",
  "data-equation-numbering", "data-diagram-id", "data-mermaid-source", "data-caption",
  "data-bookmark-id", "data-bookmark-label",
]);
const SAFE_DATA_TYPES = new Set([
  "paper-page-break", "paper-code", "inline-math", "block-math",
  "paper-equation-reference", "paper-mermaid",
  "paper-bookmark",
]);
const SAFE_IMAGE_MIMES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp",
]);
const FORMAT_ALIASES = Object.freeze({ md: "markdown", markdown: "markdown", html: "html", htm: "html", txt: "txt", text: "txt", docx: "docx" });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeFormat(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/^\./, "");
  return FORMAT_ALIASES[raw] || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);?/g, (_match, code) => {
      const number = Number(code);
      return Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    })
    .replace(/&#x([0-9a-f]+);?/gi, (_match, code) => {
      const number = Number.parseInt(code, 16);
      return Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    })
    .replace(/&nbsp;/gi, "\u00a0")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function decodeHtmlEntitiesOnce(value) {
  return String(value || "")
    .replace(/&#(\d+);?/g, (_match, code) => {
      const number = Number(code);
      return Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    })
    .replace(/&#x([0-9a-f]+);?/gi, (_match, code) => {
      const number = Number.parseInt(code, 16);
      return Number.isSafeInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    })
    .replace(/&nbsp;/gi, "\u00a0")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function decodeUriComponentSafe(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch {
    return "";
  }
}

function normalizeCodeLanguage(value) {
  const language = boundedSemanticText(value, 48).toLowerCase();
  return /^[a-z0-9_+.-]+$/.test(language) ? language : "plaintext";
}

function markdownFenceFor(source) {
  let longest = 0;
  for (const match of String(source || "").matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  return "`".repeat(Math.max(3, longest + 1));
}

function professionalMarkdownMetadata(kind, payload = {}) {
  const safeKind = ["code", "equation", "mermaid"].includes(kind) ? kind : "";
  if (!safeKind) return "";
  const encoded = JSON.stringify(payload).replace(/[<>&-]/g, (character) => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  ));
  return `<!-- jianjian:${safeKind} ${encoded} -->`;
}

function parseProfessionalMarkdownMetadata(line) {
  const match = /^\s*<!--\s*jianjian:(code|equation|mermaid)\s+(\{[\s\S]{0,4096}\})\s*-->\s*$/i.exec(String(line || ""));
  if (!match) return null;
  try {
    const value = JSON.parse(match[2]);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return { kind: match[1].toLowerCase(), value };
  } catch {
    return null;
  }
}

function warning(code, message, detail = "") {
  return { code, message, ...(detail ? { detail: String(detail).slice(0, 500) } : {}) };
}

function parseAttributes(raw) {
  const attributes = [];
  const source = String(raw || "");
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes.push({ name: match[1].toLowerCase(), value: match[2] ?? match[3] ?? match[4] ?? "" });
  }
  return attributes;
}

function attributeValue(raw, name) {
  return parseAttributes(raw).find((entry) => entry.name === name)?.value || "";
}

function safeHref(value) {
  const decoded = decodeHtmlEntities(value).trim();
  if (!decoded || /[\u0000-\u001f\u007f]/.test(decoded)) return "";
  if (/^(?:https?:|mailto:|#)/i.test(decoded)) return decoded;
  if (/^(?:javascript|vbscript|data|file|blob):/i.test(decoded) || /^[\\/]{2}/.test(decoded) || path.win32.isAbsolute(decoded)) return "";
  return decoded;
}

function stripDangerousContainers(html) {
  let output = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of DROP_WITH_CONTENT) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    const loose = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
    output = output.replace(paired, "").replace(loose, "");
  }
  return output.replace(/<!doctype[^>]*>/gi, "");
}

function sniffImageMime(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && /^(?:GIF87a|GIF89a)$/.test(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  return "";
}

function extensionForMime(mime) {
  return ({
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
    "image/bmp": ".bmp",
  })[String(mime || "").toLowerCase()] || ".bin";
}

function decodeImageDataUrl(value, maximumBytes = DEFAULT_LIMITS.maxAssetBytes) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/\s]*={0,2})$/i.exec(String(value || ""));
  if (!match || !SAFE_IMAGE_MIMES.has(match[1].toLowerCase())) return null;
  const encoded = match[2].replace(/\s/g, "");
  if (Math.floor(encoded.length * 3 / 4) > maximumBytes || encoded.length % 4 === 1) throw new Error("图片超过安全大小上限");
  const buffer = Buffer.from(encoded, "base64");
  const mime = sniffImageMime(buffer);
  if (!mime || mime !== match[1].toLowerCase() || buffer.length > maximumBytes) return null;
  return { buffer, mime };
}

function pathIsInside(rootPath, candidatePath, pathApi = path) {
  const relative = pathApi.relative(pathApi.resolve(rootPath), pathApi.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative));
}

async function readFileBounded(filePath, maximumBytes, fsApi = fs) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) throw new Error("文件大小上限无效");
  if (typeof fsApi.open === "function") {
    const handle = await fsApi.open(filePath, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maximumBytes) throw new Error("文件不存在或超过安全大小上限");
      const buffer = Buffer.allocUnsafe(stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      return buffer.subarray(0, offset);
    } finally {
      await handle.close();
    }
  }
  const stat = await fsApi.stat(filePath);
  if (!stat.isFile() || stat.size > maximumBytes) throw new Error("文件不存在或超过安全大小上限");
  const buffer = await fsApi.readFile(filePath);
  if (buffer.length > maximumBytes) throw new Error("文件超过安全大小上限");
  return buffer;
}

function looksAbsoluteOnAnyPlatform(value) {
  const source = String(value || "");
  return path.isAbsolute(source) || path.win32.isAbsolute(source) || path.posix.isAbsolute(source) || /^\\\\/.test(source);
}

async function materializeImportedImage(sourceValue, {
  sourcePath,
  fsApi,
  pathApi,
  limits,
  budget,
  warnings,
}) {
  const source = decodeHtmlEntities(sourceValue).trim();
  if (!source) return "";
  if (/^data:/i.test(source)) {
    try {
      const decoded = decodeImageDataUrl(source, limits.maxAssetBytes);
      if (!decoded) throw new Error("仅支持安全的 PNG、JPEG、GIF、WebP 或 BMP 图片");
      budget.add(decoded.buffer.length);
      return `data:${decoded.mime};base64,${decoded.buffer.toString("base64")}`;
    } catch (error) {
      warnings.push(warning("asset-rejected", "已移除不安全或无效的内嵌图片。", error.message));
      return "";
    }
  }
  if (/^(?:https?:|file:|blob:|paperwriter-asset:)/i.test(source) || /^\/\//.test(source)) {
    warnings.push(warning("asset-rejected", "已移除非本地相对路径图片，导入不会下载远程资源。", source));
    return "";
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(source.split(/[?#]/, 1)[0]).replace(/\\/g, "/");
  } catch {
    warnings.push(warning("asset-rejected", "已移除路径编码无效的图片。", source));
    return "";
  }
  if (!sourcePath || decodedPath.includes(":") || looksAbsoluteOnAnyPlatform(decodedPath) || decodedPath.split("/").some((segment) => segment === "..")) {
    warnings.push(warning("asset-rejected", "已拒绝绝对路径或越界图片。", source));
    return "";
  }
  const sourceDirectory = pathApi.dirname(pathApi.resolve(sourcePath));
  const candidate = pathApi.resolve(sourceDirectory, decodedPath);
  if (!pathIsInside(sourceDirectory, candidate, pathApi)) {
    warnings.push(warning("asset-rejected", "已拒绝导入文件目录之外的图片。", source));
    return "";
  }
  try {
    const realRoot = typeof fsApi.realpath === "function" ? await fsApi.realpath(sourceDirectory) : sourceDirectory;
    const realCandidate = typeof fsApi.realpath === "function" ? await fsApi.realpath(candidate) : candidate;
    if (!pathIsInside(realRoot, realCandidate, pathApi)) throw new Error("图片通过符号链接指向导入目录之外");
    const buffer = await readFileBounded(realCandidate, limits.maxAssetBytes, fsApi);
    const mime = sniffImageMime(buffer);
    if (!mime || buffer.length > limits.maxAssetBytes) throw new Error("图片格式不受支持或内容与扩展名不符");
    budget.add(buffer.length);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch (error) {
    warnings.push(warning("asset-missing", "图片未导入，正文内容仍已保留。", `${source}: ${error.message}`));
    return "";
  }
}

function createAssetBudget(limits) {
  let bytes = 0;
  let entries = 0;
  return {
    add(size) {
      entries += 1;
      bytes += Number(size) || 0;
      if (entries > limits.maxAssetEntries) throw new Error("导入包含过多图片");
      if (bytes > limits.maxTotalAssetBytes) throw new Error("导入图片总量超过安全上限");
    },
    snapshot: () => ({ bytes, entries }),
  };
}

async function sanitizeHtml(html, { resolveImage, warnings = [], reportSanitization = false } = {}) {
  const normalizedInput = String(html || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  const source = stripDangerousContainers(normalizedInput);
  let removedUnsafeMarkup = source !== normalizedInput;
  const tokens = source.match(/<[^>]*>|[^<]+/g) || [];
  const output = [];
  for (const token of tokens) {
    if (!token.startsWith("<")) {
      output.push(token);
      continue;
    }
    const closing = /^<\s*\/\s*([a-z0-9-]+)/i.exec(token);
    if (closing) {
      const tag = closing[1].toLowerCase();
      if (ALLOWED_TAGS.has(tag) && !VOID_TAGS.has(tag)) output.push(`</${tag}>`);
      continue;
    }
    const opening = /^<\s*([a-z0-9-]+)([\s\S]*?)\/?\s*>$/i.exec(token);
    if (!opening) continue;
    const tag = opening[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;
    const safe = [];
    for (const attribute of parseAttributes(opening[2])) {
      const { name } = attribute;
      if (name.startsWith("on") || name === "style" || name === "class" || name === "id") {
        if (name.startsWith("on") || name === "style") removedUnsafeMarkup = true;
        continue;
      }
      if (name === "href" && tag === "a") {
        const href = safeHref(attribute.value);
        if (href) safe.push(`href="${escapeHtml(href)}"`);
        else if (attribute.value) removedUnsafeMarkup = true;
        continue;
      }
      if (name === "src" && tag === "img") continue;
      if ((name === "alt" || name === "title") && (tag === "img" || tag === "a")) safe.push(`${name}="${escapeHtml(attribute.value.slice(0, 1000))}"`);
      if ((name === "colspan" || name === "rowspan") && (tag === "td" || tag === "th")) {
        const amount = Math.min(100, Math.max(1, Number.parseInt(attribute.value, 10) || 1));
        safe.push(`${name}="${amount}"`);
      }
      if (SAFE_DATA_ATTRIBUTES.has(name)) {
        const maximum = name === "data-reference-list"
          ? 2 * 1024 * 1024
          : (name === "data-mermaid-source" ? 40_000 : (name === "data-latex" ? 20_000 : 512));
        const value = decodeHtmlEntitiesOnce(String(attribute.value || "")).slice(0, maximum);
        if (name !== "data-type" || SAFE_DATA_TYPES.has(value)) safe.push(`${name}="${escapeHtml(value)}"`);
      }
    }
    if (tag === "img") {
      const rawSource = attributeValue(opening[2], "src");
      let resolved = "";
      try { resolved = typeof resolveImage === "function" ? await resolveImage(rawSource) : ""; } catch (error) {
        warnings.push(warning("asset-rejected", "图片处理失败，已从导入结果中移除。", error.message));
      }
      if (!resolved) continue;
      safe.push(`src="${escapeHtml(resolved)}"`);
    }
    output.push(`<${tag}${safe.length ? ` ${safe.join(" ")}` : ""}>`);
  }
  if (reportSanitization && removedUnsafeMarkup && !warnings.some((entry) => entry.code === "html-sanitized")) {
    warnings.push(warning("html-sanitized", "已移除外部文档中的样式或潜在可执行内容。"));
  }
  const sanitized = output.join("").trim();
  return sanitized || "<p></p>";
}

async function sanitizeImportedHtml(html, {
  sourcePath = "",
  fsApi = fs,
  pathApi = path,
  limits = DEFAULT_LIMITS,
  warnings = [],
} = {}) {
  const resolvedLimits = { ...DEFAULT_LIMITS, ...(limits || {}) };
  const budget = createAssetBudget(resolvedLimits);
  const sanitized = await sanitizeHtml(html, {
    warnings,
    reportSanitization: true,
    resolveImage: (source) => materializeImportedImage(source, {
      sourcePath, fsApi, pathApi, limits: resolvedLimits, budget, warnings,
    }),
  });
  return { html: sanitized, warnings, assets: budget.snapshot() };
}

async function sanitizeStoredHtml(html, warnings = []) {
  return sanitizeHtml(html, {
    warnings,
    resolveImage: async (sourceValue) => {
      const source = decodeHtmlEntities(sourceValue).trim();
      if (/^(?:paperwriter-asset:\/\/|assets\/)/i.test(source)) return source;
      if (/^data:/i.test(source)) return decodeImageDataUrl(source) ? source : "";
      warnings.push(warning("asset-rejected", "导出已忽略未暂存或远程图片。", source));
      return "";
    },
  });
}

function markdownInline(value) {
  const placeholders = [];
  const hold = (html) => `\u0000${placeholders.push(html) - 1}\u0000`;
  let text = String(value || "")
    .replace(/`([^`]+)`/g, (_match, code) => hold(`<code>${escapeHtml(code)}</code>`))
    .replace(/(?<!\\)\$([^$\n]{1,20000})\$/g, (_match, latex) => hold(`<span data-type="inline-math" data-latex="${escapeHtml(latex)}"></span>`))
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, (_match, alt, src, title) => hold(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ""}>`))
    .replace(/\[(\d+)\]\((#jianjian-citation=[^)\s]+)\)/gi, (_match, number, href) => {
      const citation = citationFromHref(href);
      if (!citation) return _match;
      return hold(`<span data-citation-source-id="${escapeHtml(citation.id)}"${citation.pages ? ` data-citation-pages="${escapeHtml(citation.pages)}"` : ""}>[${escapeHtml(number)}]</span>`);
    })
    .replace(/\[公式\]\(#jianjian-equation=([^)]+)\)/gi, (_match, id) => {
      const equationId = decodeUriComponentSafe(id).trim().toLowerCase();
      return hold(UUID_PATTERN.test(equationId)
        ? `<span data-type="paper-equation-reference" data-equation-id="${equationId}"></span>`
        : '<span data-type="paper-equation-reference" data-equation-id=""></span>');
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, href) => hold(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`))
    .replace(/\[\^([a-z0-9_-]+)\]/gi, (_match, id) => hold(`<sup data-footnote-ref="${escapeHtml(id)}">${escapeHtml(id)}</sup>`))
    .replace(
      /\[@([a-z0-9_.:+/-]+)(?:,\s*(?:p{1,2}\.?\s*)?([^\]]{1,128}))?\]/gi,
      (_match, id, rawPages) => {
        const pages = normalizeCitationPages(rawPages);
        return hold(`<span data-citation-source-id="${escapeHtml(id)}"${pages ? ` data-citation-pages="${escapeHtml(pages)}"` : ""}>[${escapeHtml(id)}]</span>`);
      },
    );
  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  return text.replace(/\u0000(\d+)\u0000/g, (_match, index) => placeholders[Number(index)] || "");
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/^\ufeff/, "").replace(/\r\n?/g, "\n").split("\n");
  const footnotes = [];
  const referenceTexts = [];
  const bodyLines = [];
  let bibliographyEnabled = false;
  let inReferences = false;
  for (const line of lines) {
    const footnote = /^\[\^([a-z0-9_-]+)\]:\s*(.*)$/i.exec(line);
    if (footnote) footnotes.push({ id: footnote[1], text: footnote[2] });
    else if (/^\s*<!--\s*jianjian:auto-bibliography\s*-->\s*$/i.test(line)) bibliographyEnabled = true;
    else if (bibliographyEnabled && /^#{1,6}\s+参考文献\s*$/i.test(line)) inReferences = true;
    else if (inReferences) {
      const reference = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (reference) referenceTexts.push(boundedSemanticText(reference[1]));
      else if (/^\s*暂无正文引用\s*$/.test(line)) continue;
      else if (line.trim() && /^#{1,6}\s+/.test(line)) { inReferences = false; bodyLines.push(line); }
      else if (line.trim() && !referenceTexts.length) { inReferences = false; bodyLines.push(line); }
    } else bodyLines.push(line);
  }
  const output = [];
  let paragraph = [];
  let list = "";
  let inCode = false;
  let code = [];
  let codeLanguage = "plaintext";
  let codeMetadata = null;
  let codeFenceLength = 3;
  let inBlockMath = false;
  let blockMath = [];
  let blockMathMetadata = null;
  let pendingMetadata = null;
  let professionalOrdinal = 0;
  const usedProfessionalIds = new Set();
  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${markdownInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = "";
  };
  const nextProfessionalId = (kind, source, candidate) => {
    const normalized = boundedSemanticText(candidate, 128).toLowerCase();
    professionalOrdinal += 1;
    const seed = `${professionalOrdinal}:${source}`;
    let result = UUID_PATTERN.test(normalized)
      ? normalized
      : stableSemanticUuid(kind, seed);
    let attempt = 0;
    while (usedProfessionalIds.has(`${kind}:${result}`)) {
      result = stableSemanticUuid(kind, seed, ++attempt);
    }
    usedProfessionalIds.add(`${kind}:${result}`);
    return result;
  };
  const closeBlockMath = () => {
    const latex = blockMath.join("\n").slice(0, 20_000);
    const metadata = blockMathMetadata?.kind === "equation" ? blockMathMetadata.value : {};
    const equationId = nextProfessionalId("equation", latex, metadata.id);
    const label = boundedSemanticText(metadata.label, 512);
    const numbering = metadata.numbering !== false;
    output.push(`<div data-type="block-math" data-latex="${escapeHtml(latex)}" data-equation-id="${equationId}" data-equation-label="${escapeHtml(label)}" data-equation-numbering="${numbering}"></div>`);
    blockMath = [];
    blockMathMetadata = null;
  };
  const closeCode = () => {
    const joinedSource = code.join("\n");
    const source = codeLanguage === "mermaid"
      ? joinedSource.slice(0, 40_000)
      : joinedSource;
    if (codeLanguage === "mermaid") {
      const metadata = codeMetadata?.kind === "mermaid" ? codeMetadata.value : {};
      const diagramId = nextProfessionalId("mermaid", source, metadata.id);
      const caption = boundedSemanticText(metadata.caption, 512);
      output.push(`<figure data-type="paper-mermaid" data-diagram-id="${diagramId}" data-mermaid-source="${escapeHtml(source)}" data-caption="${escapeHtml(caption)}"><pre>${escapeHtml(source)}</pre></figure>`);
    } else {
      const metadata = codeMetadata?.kind === "code" ? codeMetadata.value : {};
      output.push(`<pre data-type="paper-code" data-code-language="${escapeHtml(codeLanguage)}" data-code-wrap="${metadata.wrap === true}"><code class="language-${escapeHtml(codeLanguage)}">${escapeHtml(source)}</code></pre>`);
    }
    code = [];
    codeLanguage = "plaintext";
    codeMetadata = null;
    codeFenceLength = 3;
  };
  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index];
    const fence = /^\s*(`{3,})\s*([a-z0-9_+.-]*)\s*$/i.exec(line);
    const mathDelimiter = /^\s*\$\$\s*$/.test(line);
    if (inCode) {
      if (new RegExp(`^\\s*\`{${codeFenceLength},}\\s*$`).test(line)) {
        closeCode();
        inCode = false;
      } else {
        code.push(line);
      }
      continue;
    }
    if (inBlockMath) {
      if (mathDelimiter) {
        closeBlockMath();
        inBlockMath = false;
      } else {
        blockMath.push(line);
      }
      continue;
    }
    const metadata = parseProfessionalMarkdownMetadata(line);
    if (metadata) {
      flushParagraph(); closeList();
      pendingMetadata = metadata;
      continue;
    }
    if (mathDelimiter) {
      flushParagraph(); closeList();
      blockMathMetadata = pendingMetadata?.kind === "equation" ? pendingMetadata : null;
      pendingMetadata = null;
      inBlockMath = true;
      continue;
    }
    if (fence) {
      flushParagraph(); closeList();
      codeFenceLength = fence[1].length;
      codeLanguage = normalizeCodeLanguage(fence[2]);
      codeMetadata = pendingMetadata;
      pendingMetadata = null;
      inCode = true;
      continue;
    }
    if (line.trim()) pendingMetadata = null;
    const tableDivider = bodyLines[index + 1] && /^\s*\|?\s*:?-{3,}/.test(bodyLines[index + 1]) && line.includes("|");
    if (tableDivider) {
      flushParagraph(); closeList();
      const rows = [line];
      index += 2;
      while (index < bodyLines.length && bodyLines[index].includes("|") && bodyLines[index].trim()) rows.push(bodyLines[index++]);
      index -= 1;
      output.push("<table><thead><tr>" + rows[0].replace(/^\||\|$/g, "").split("|").map((cell) => `<th>${markdownInline(cell.trim())}</th>`).join("") + "</tr></thead><tbody>");
      for (const row of rows.slice(1)) output.push("<tr>" + row.replace(/^\||\|$/g, "").split("|").map((cell) => `<td>${markdownInline(cell.trim())}</td>`).join("") + "</tr>");
      output.push("</tbody></table>");
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); closeList(); output.push(`<h${heading[1].length}>${markdownInline(heading[2])}</h${heading[1].length}>`); continue; }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { flushParagraph(); closeList(); output.push("<hr>"); continue; }
    const item = /^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      const nextList = item[2] ? "ol" : "ul";
      if (list !== nextList) { closeList(); list = nextList; output.push(`<${list}>`); }
      output.push(`<li>${markdownInline(item[3])}</li>`);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) { flushParagraph(); closeList(); output.push(`<blockquote>${markdownInline(quote[1])}</blockquote>`); continue; }
    if (/^\s*</.test(line)) { flushParagraph(); closeList(); output.push(line); continue; }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    paragraph.push(line.trim());
  }
  if (inCode) closeCode();
  if (inBlockMath) closeBlockMath();
  flushParagraph(); closeList();
  const html = output.join("\n") || "<p></p>";
  const citationIds = [];
  for (const match of html.matchAll(/\bdata-citation-source-id\s*=\s*["']([^"']+)["']/gi)) {
    const id = decodeHtmlEntities(match[1]).slice(0, 128);
    if (id && !citationIds.includes(id)) citationIds.push(id);
  }
  const citationSources = referenceTexts.map((text, index) => ({ id: citationIds[index] || `reference-${index + 1}`, text, title: text }));
  return { html, footnotes, citationSources, bibliographyEnabled };
}

function decodeTextBuffer(buffer, encoding = "utf8", iconvLite = null) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3).toString("utf8");
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(bytes.length - 2);
    for (let index = 2; index + 1 < bytes.length; index += 2) { swapped[index - 2] = bytes[index + 1]; swapped[index - 1] = bytes[index]; }
    return swapped.toString("utf16le");
  }
  const normalized = String(encoding || "utf8").toLowerCase().replace(/[-_]/g, "");
  if (normalized === "utf8" || normalized === "utf") return bytes.toString("utf8");
  if (normalized === "utf16le" || normalized === "ucs2") return bytes.toString("utf16le");
  if (!iconvLite?.decode) throw new Error(`读取 ${encoding} 编码需要注入 iconv-lite`);
  return iconvLite.decode(bytes, encoding);
}

function textToHtml(text) {
  return String(text || "").replace(/\r\n?/g, "\n").split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("\n") || "<p></p>";
}

function extractHtmlMetadata(html) {
  const source = String(html || "");
  const title = decodeHtmlEntities((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1] || "").replace(/<[^>]+>/g, "")).trim();
  const authorMeta = /<meta\b[^>]*\bname\s*=\s*["']author["'][^>]*>/i.exec(source)?.[0] || "";
  const citationStyleMeta = /<meta\b[^>]*\bname\s*=\s*["']jianjian:citation-style["'][^>]*>/i.exec(source)?.[0] || "";
  const citationLocaleMeta = /<meta\b[^>]*\bname\s*=\s*["']jianjian:citation-locale["'][^>]*>/i.exec(source)?.[0] || "";
  const styleId = decodeHtmlEntities(attributeValue(citationStyleMeta, "content")).trim().slice(0, 200);
  const locale = decodeHtmlEntities(attributeValue(citationLocaleMeta, "content")).trim().slice(0, 32);
  return {
    title: title.slice(0, 200),
    author: decodeHtmlEntities(attributeValue(authorMeta, "content")).trim().slice(0, 100),
    ...(styleId ? { citationStyle: { styleId, locale: /^(?:zh-CN|en-US)$/i.test(locale) ? locale : "zh-CN" } } : {}),
  };
}

function extractHtmlDocumentBody(html) {
  const source = String(html || "");
  return /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(source)?.[1]
    ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(source)?.[1]
    ?? source;
}

function documentTitleFromPath(sourcePath, pathApi = path) {
  return sourcePath ? pathApi.basename(sourcePath, pathApi.extname(sourcePath)).slice(0, 200) : "导入的信笺";
}

function stableSemanticUuid(kind, seed, attempt = 0) {
  const hex = createHash("sha256").update(`jianjian:${kind}:${seed}:${attempt}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

function boundedSemanticText(value, maximum = 10000) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, maximum);
}

function normalizedSemanticRawId(value) {
  let result = String(value ?? "");
  for (let index = 0; index < 3; index += 1) {
    const decoded = decodeHtmlEntities(result);
    if (decoded === result) break;
    result = decoded;
  }
  return boundedSemanticText(result, 128).toLowerCase();
}

function normalizeCitationPages(value) {
  let result = String(value ?? "");
  for (let index = 0; index < 3; index += 1) {
    const decoded = decodeHtmlEntities(result);
    if (decoded === result) break;
    result = decoded;
  }
  result = result.split(/["'<>＝=]/, 1)[0];
  return boundedSemanticText(result.replace(/[^\p{L}\p{N}\s,，.;；:：\-–—_/]/gu, ""), 128);
}

function normalizeSemanticCslValue(value, depth = 0) {
  if (depth > 8) return undefined;
  if (typeof value === "string") {
    return boundedSemanticText(value, 20_000);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 500)
      .map((item) => normalizeSemanticCslValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 500)) {
    const key = boundedSemanticText(rawKey, 100);
    if (
      !key
      || key.startsWith("_")
      || ["__proto__", "prototype", "constructor"].includes(key)
    ) {
      continue;
    }
    const normalized = normalizeSemanticCslValue(rawValue, depth + 1);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function normalizeSemanticCsl(value) {
  const normalized = normalizeSemanticCslValue(value);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return {};
  }
  try {
    return JSON.stringify(normalized).length <= 64 * 1024
      ? normalized
      : {};
  } catch {
    return {};
  }
}

function normalizeSemanticFields(entry, kind, id) {
  const source = entry && typeof entry === "object" ? entry : { text: entry };
  if (kind === "footnote") return { id, text: boundedSemanticText(source.text) };
  const text = boundedSemanticText(source.text);
  const authors = (Array.isArray(source.authors) ? source.authors : (source.author ? String(source.author).split(/[;,；，]/) : []))
    .slice(0, 100).map((author) => boundedSemanticText(author, 200)).filter(Boolean);
  const inferredCitationKey = !UUID_PATTERN.test(
    normalizedSemanticRawId(source.id || source.sourceId),
  )
    ? source.id || source.sourceId
    : "";
  const citationKey = boundedSemanticText(
    source.citationKey || inferredCitationKey,
    200,
  )
    .replace(/[^a-zA-Z0-9_.:+/-]/g, "-");
  const csl = normalizeSemanticCsl(source.csl);
  const researchLibraryId = normalizedSemanticRawId(
    source.researchLibraryId,
  );
  const researchSourceId = boundedSemanticText(
    source.researchSourceId,
    128,
  );
  return {
    id,
    ...(citationKey ? { citationKey } : {}),
    ...(Object.keys(csl).length ? { csl } : {}),
    type: ["book", "article", "web", "pdf", "report", "thesis", "other"].includes(source.type) ? source.type : "other",
    title: boundedSemanticText(source.title || text || "来源信息缺失", 1000),
    authors,
    year: boundedSemanticText(source.year, 32),
    containerTitle: boundedSemanticText(source.containerTitle, 1000),
    publisher: boundedSemanticText(source.publisher, 500),
    url: /^https?:\/\//i.test(String(source.url || "").trim()) ? boundedSemanticText(source.url, 2048) : "",
    doi: boundedSemanticText(source.doi, 300),
    isbn: boundedSemanticText(source.isbn, 64),
    accessedAt: boundedSemanticText(source.accessedAt, 64),
    pages: boundedSemanticText(source.pages, 128),
    notes: boundedSemanticText(source.notes, 10000),
    ...(UUID_PATTERN.test(researchLibraryId)
      && UUID_PATTERN.test(researchSourceId)
      ? { researchLibraryId, researchSourceId: researchSourceId.toLowerCase() }
      : (
        !source.researchLibraryId
        && /^[a-zA-Z0-9_-]{8,128}$/.test(researchSourceId)
          ? { researchSourceId }
          : {}
      )),
    ...(source.formattedText
      ? { formattedText: boundedSemanticText(source.formattedText, 20_000) }
      : {}),
    ...(text ? { text } : {}),
  };
}

function normalizeSemanticItems(values, kind) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values.slice(0, 10000).flatMap((entry, index) => {
    const source = entry && typeof entry === "object" ? entry : { text: entry };
    const rawId = normalizedSemanticRawId(source.id);
    const stableSeed = rawId || `missing:${boundedSemanticText(source.text || source.title)}:${index}`;
    let id = UUID_PATTERN.test(rawId) ? rawId : stableSemanticUuid(kind, stableSeed);
    let attempt = 0;
    while (seen.has(id)) id = stableSemanticUuid(kind, stableSeed, ++attempt);
    seen.add(id);
    return [normalizeSemanticFields(source, kind, id)];
  });
}

function semanticCitationHref(id, pages = "") {
  const normalizedPages = normalizeCitationPages(pages);
  const suffix = normalizedPages ? `&pages=${encodeURIComponent(normalizedPages)}` : "";
  return `#jianjian-citation=${encodeURIComponent(id)}${suffix}`;
}

function citationFromHref(href) {
  const match = /^#jianjian-citation=([^&]+)(?:&pages=([^&]*))?$/i.exec(decodeHtmlEntities(href).trim());
  if (!match) return null;
  try {
    return { id: decodeURIComponent(match[1]).slice(0, 128), pages: normalizeCitationPages(decodeURIComponent(match[2] || "")) };
  } catch {
    return null;
  }
}

function mergeSemanticItems(primary, secondary) {
  const result = [];
  const keys = new Set();
  for (const entry of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    if (!entry || typeof entry !== "object") continue;
    const key = boundedSemanticText(entry.id, 128) || `${boundedSemanticText(entry.title || entry.text)}:${result.length}`;
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(entry);
  }
  return result;
}

function canonicalizeSemantics(html, rawFootnotes = [], rawSources = []) {
  let body = String(html || "");
  body = body.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (full, attrs, label) => {
    const citation = citationFromHref(attributeValue(attrs, "href"));
    if (!citation) return full;
    return `<span data-citation-source-id="${escapeHtml(citation.id)}"${citation.pages ? ` data-citation-pages="${escapeHtml(citation.pages)}"` : ""}>${escapeHtml(htmlToPlainText(label))}</span>`;
  });

  const footnoteMap = new Map();
  const sourceMap = new Map();
  const usedFootnoteIds = new Set();
  const usedSourceIds = new Set();
  const allocate = (kind, rawId, seed, map, used) => {
    const key = normalizedSemanticRawId(rawId);
    if (key && map.has(key)) return map.get(key);
    const stableSeed = key || `missing:${seed}`;
    let id = UUID_PATTERN.test(key) ? key : stableSemanticUuid(kind, stableSeed);
    let attempt = 0;
    while (used.has(id)) id = stableSemanticUuid(kind, stableSeed, ++attempt);
    used.add(id);
    if (key) map.set(key, id);
    return id;
  };

  const footnotes = [];
  for (const [index, entry] of (Array.isArray(rawFootnotes) ? rawFootnotes : []).slice(0, 10000).entries()) {
    const source = entry && typeof entry === "object" ? entry : { text: entry };
    const text = boundedSemanticText(source.text);
    const id = allocate("footnote", source.id, `${text}:${index}`, footnoteMap, usedFootnoteIds);
    if (!footnotes.some((item) => item.id === id)) footnotes.push(normalizeSemanticFields(source, "footnote", id));
  }
  const citationSources = [];
  for (const [index, entry] of (Array.isArray(rawSources) ? rawSources : []).slice(0, 10000).entries()) {
    const source = entry && typeof entry === "object" ? entry : { text: entry };
    const seed = boundedSemanticText(source.title || source.text);
    const id = allocate("source", source.id || source.sourceId, `${seed}:${index}`, sourceMap, usedSourceIds);
    if (!citationSources.some((item) => item.id === id)) citationSources.push(normalizeSemanticFields(source, "source", id));
  }

  const footnoteNumberById = new Map();
  body = body.replace(/<sup\b([^>]*)>([\s\S]*?)<\/sup>/gi, (full, attrs, label) => {
    const explicitId = attributeValue(attrs, "data-footnote-id");
    const legacyRef = attributeValue(attrs, "data-footnote-ref");
    if (!explicitId && !legacyRef) return full;
    const rawId = explicitId || (!/^(?:true|false)$/i.test(legacyRef) ? legacyRef : "");
    const id = allocate("footnote", rawId, `${htmlToPlainText(label)}:${footnoteNumberById.size}`, footnoteMap, usedFootnoteIds);
    if (!footnoteNumberById.has(id)) footnoteNumberById.set(id, footnoteNumberById.size + 1);
    if (!footnotes.some((item) => item.id === id)) footnotes.push(normalizeSemanticFields({ text: "脚注内容缺失" }, "footnote", id));
    const remaining = attrs.replace(/\s*data-footnote-(?:id|ref)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "").trim();
    return `<sup${remaining ? ` ${remaining}` : ""} data-footnote-ref="true" data-footnote-id="${id}">${footnoteNumberById.get(id)}</sup>`;
  });

  const citationNumberById = new Map();
  body = body.replace(/<span\b([^>]*\bdata-citation-source-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*)>([\s\S]*?)<\/span>/gi, (_full, attrs) => {
    const rawId = attributeValue(attrs, "data-citation-source-id");
    const pages = normalizeCitationPages(attributeValue(attrs, "data-citation-pages"));
    const id = allocate("source", rawId, `reference:${citationNumberById.size}`, sourceMap, usedSourceIds);
    if (!citationNumberById.has(id)) citationNumberById.set(id, citationNumberById.size + 1);
    if (!citationSources.some((item) => item.id === id)) citationSources.push(normalizeSemanticFields({ title: "来源信息缺失" }, "source", id));
    const remaining = attrs.replace(/\s*data-citation-(?:source-id|pages)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "").trim();
    const pageLabel = pages ? `，第 ${pages} 页` : "";
    return `<span${remaining ? ` ${remaining}` : ""} data-citation-source-id="${id}"${pages ? ` data-citation-pages="${escapeHtml(pages)}"` : ""}>[${citationNumberById.get(id)}${pageLabel}]</span>`;
  });
  return { html: body, footnotes, citationSources };
}

function orderedReferencedItems(values, kind, html, attributeName) {
  const normalized = normalizeSemanticItems(values, kind);
  const byId = new Map(normalized.map((item) => [item.id, item]));
  const ordered = [];
  const seen = new Set();
  const pattern = new RegExp(`\\b${attributeName}\\s*=\\s*["']([^"']+)["']`, "gi");
  for (const match of String(html || "").matchAll(pattern)) {
    const id = decodeHtmlEntities(match[1]);
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    seen.add(id);
    ordered.push(item);
  }
  return ordered;
}

function referenceText(source) {
  const formatted = boundedSemanticText(source?.formattedText, 20_000);
  if (formatted) return formatted;
  const author = Array.isArray(source.authors) ? source.authors.map((value) => String(value || "").trim()).filter(Boolean).join("，") : source.author;
  const parts = [author, source.title || source.text, source.containerTitle, source.publisher, source.year].map((value) => String(value || "").trim()).filter(Boolean);
  if (source.url) parts.push(String(source.url).trim());
  else if (source.doi) parts.push(`DOI:${String(source.doi).trim()}`);
  return parts.join(". ") || source.text || source.id;
}

function citationTextWithPages(value, pages, citationKind) {
  const text = boundedSemanticText(value, 2_000);
  const locator = normalizeCitationPages(pages);
  if (!text) return "";
  if (!locator) return text;
  if (citationKind === "numeric") {
    return `${text}，第 ${locator} 页`;
  }
  const suffix = `，第 ${locator} 页`;
  return /[)）]$/.test(text)
    ? `${text.slice(0, -1)}${suffix}${text.slice(-1)}`
    : `${text}${suffix}`;
}

function applyFormattedInlineCitations(html, formatting) {
  if (!formatting?.citationsById) return String(html || "");
  return String(html || "").replace(
    /<span\b([^>]*\bdata-citation-source-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*)>[\s\S]*?<\/span>/gi,
    (full, attrs) => {
      const id = attributeValue(attrs, "data-citation-source-id");
      const base = formatting.citationsById[id];
      if (!base) return full;
      const pages = attributeValue(attrs, "data-citation-pages");
      const text = citationTextWithPages(
        base,
        pages,
        formatting.citationKind,
      );
      const rendered = formatting.citationKind === "numeric"
        ? `[${text}]`
        : text;
      return `<span${attrs}>${escapeHtml(rendered)}</span>`;
    },
  );
}

function citationSourcesWithFormatting(sources, formatting) {
  if (!formatting?.entriesById) return sources;
  return (Array.isArray(sources) ? sources : []).map((source) => ({
    ...source,
    formattedText: formatting.entriesById[source.id] || "",
  }));
}

function bibliographySourceOrder(sources, entryIds) {
  const values = Array.isArray(sources) ? sources : [];
  if (!Array.isArray(entryIds) || !entryIds.length) return values;
  const byId = new Map(values.map((source) => [source.id, source]));
  const ordered = entryIds.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map((source) => source.id));
  return [
    ...ordered,
    ...values.filter((source) => !seen.has(source.id)),
  ];
}

function serializeReferenceSnapshot(sources, maximumBytes = 2 * 1024 * 1024) {
  const pieces = [];
  let bytes = 2;
  for (const source of Array.isArray(sources) ? sources : []) {
    const piece = JSON.stringify(source);
    const nextBytes = Buffer.byteLength(piece, "utf8") + (pieces.length ? 1 : 0);
    if (bytes + nextBytes > maximumBytes) break;
    pieces.push(piece);
    bytes += nextBytes;
  }
  return `[${pieces.join(",")}]`;
}

function appendSemanticHtml(
  html,
  document,
  {
    citationFormatting = null,
    includeFootnotes = true,
    includeReferences = true,
  } = {},
) {
  let result = String(html || "");
  const footnotes = orderedReferencedItems(document?.footnotes, "footnote", result, "data-footnote-id");
  const citedSources = orderedReferencedItems(document?.citationSources, "source", result, "data-citation-source-id");
  const sourceById = new Map(citedSources.map((item) => [item.id, item]));
  const formattedOrder = Array.isArray(citationFormatting?.entryIds)
    ? citationFormatting.entryIds.map((id) => sourceById.get(id)).filter(Boolean)
    : [];
  const sources = formattedOrder.length === citedSources.length
    ? formattedOrder
    : citedSources;
  if (includeFootnotes && footnotes.length && !/data-footnotes\b/i.test(result)) {
    result += `<section data-footnotes="true"><h2>脚注</h2><ol>${footnotes.map((item) => `<li data-footnote-id="${escapeHtml(item.id)}">${escapeHtml(item.text)}</li>`).join("")}</ol></section>`;
  }
  if (includeReferences && !/data-references\b|data-reference-list\b/i.test(result)) {
    const snapshot = escapeHtml(serializeReferenceSnapshot(sources));
    const formatted = Boolean(citationFormatting?.entriesById);
    const entries = formatted
      ? sources.map((item) => `<p data-citation-source-id="${escapeHtml(item.id)}">${escapeHtml(referenceText(item))}</p>`).join("")
      : `<ol>${sources.map((item) => `<li data-citation-source-id="${escapeHtml(item.id)}">${escapeHtml(referenceText(item))}</li>`).join("")}</ol>`;
    result += `<section data-references="true" data-reference-list="${snapshot}"><h2>参考文献</h2>${sources.length ? entries : "<p>暂无正文引用</p>"}</section>`;
  }
  return result;
}

function extractMammothFootnotes(html) {
  let body = String(html || "");
  const footnotes = [];
  const seen = new Set();
  const itemPattern = /<li\b([^>]*\bid\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/li>/gi;
  for (const match of body.matchAll(itemPattern)) {
    const id = /(?:^|-)footnote-(.+)$/i.exec(String(match[2] || "").trim())?.[1]?.slice(0, 128) || "";
    if (!id || seen.has(id)) continue;
    const withoutBacklink = match[3].replace(/<a\b[^>]*href\s*=\s*["']#?(?:[^"']*-)?footnote-ref-[^"']+["'][^>]*>[\s\S]*?<\/a>/gi, "");
    const text = htmlToPlainText(withoutBacklink);
    if (!text) continue;
    seen.add(id);
    footnotes.push({ id, text });
  }
  body = body.replace(/<sup\b[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*<\/sup>/gi, (full, attrs, label) => {
    const href = decodeHtmlEntities(attributeValue(attrs, "href"));
    const reference = /(?:^|-)footnote-([^#?]+)$/i.exec(href.replace(/^#/, ""))?.[1];
    if (!reference || !seen.has(reference)) return full;
    return `<sup data-footnote-ref="${escapeHtml(reference)}">${escapeHtml(htmlToPlainText(label).replace(/^\[|\]$/g, "") || reference)}</sup>`;
  });
  body = body.replace(/<ol\b[^>]*>[\s\S]*?<\/ol>/gi, (list) => /\bid\s*=\s*["'](?:[^"']*-)?footnote-[^"']+["']/i.test(list) ? "" : list);
  return { html: body, footnotes };
}

function extractSemanticHtml(html) {
  let body = String(html || "");
  const footnotes = [];
  const citationSources = [];
  let bibliographyEnabled = false;
  body = body.replace(/<section\b(?=[^>]*data-footnotes(?:\s*=\s*["'][^"']*["'])?)[^>]*>([\s\S]*?)<\/section>/gi, (_section, content) => {
    for (const item of content.matchAll(/<li\b([^>]*data-footnote-id\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/li>/gi)) {
      const id = String(item[2] || "").trim().slice(0, 128);
      const text = htmlToPlainText(item[3]);
      if (id && text) footnotes.push({ id, text });
    }
    return "";
  });
  body = body.replace(/<section\b(?=[^>]*data-(?:references|reference-list)(?:\s*=\s*["'][^"']*["'])?)([^>]*)>([\s\S]*?)<\/section>/gi, (_section, attrs, content) => {
    bibliographyEnabled = true;
    const serialized = decodeHtmlEntities(attributeValue(attrs, "data-reference-list"));
    if (serialized) {
      try {
        const parsed = JSON.parse(serialized);
        if (Array.isArray(parsed)) {
          for (const entry of parsed.slice(0, 10000)) {
            if (!entry || typeof entry !== "object") continue;
            citationSources.push({ ...entry, id: entry.id || entry.sourceId || "", title: entry.title || entry.text || "" });
          }
        }
      } catch {
        // A malformed derived bibliography is ignored; visible list items below
        // are still recovered and normalized through the same safe path.
      }
    }
    for (const item of content.matchAll(/<(?:li|p)\b([^>]*data-citation-source-id\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/(?:li|p)>/gi)) {
      const id = String(item[2] || "").trim().slice(0, 128);
      const text = htmlToPlainText(item[3]).replace(/^\s*\[?\d+\]?\s*/, "");
      if (id && text) citationSources.push({ id, text, title: text });
    }
    return "";
  });
  return {
    html: body,
    footnotes,
    citationSources,
    bibliographyEnabled,
  };
}

function extractGeneratedReferenceList(html) {
  let body = String(html || "");
  const references = [];
  let present = false;
  body = body.replace(/<h[1-6]\b[^>]*>\s*参考文献\s*<\/h[1-6]>\s*(?:<ol\b[^>]*>([\s\S]*?)<\/ol>|<p\b[^>]*>\s*暂无正文引用\s*<\/p>)/gi, (_section, content = "") => {
    present = true;
    for (const item of content.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const text = htmlToPlainText(item[1]).replace(/^\s*\[?\d+\]?\s*/, "");
      if (text) references.push({ text, title: text });
    }
    return "";
  });
  return { html: body, references, present };
}

function rawCitationIdsInOrder(html) {
  const ids = [];
  const remember = (value) => {
    const id = boundedSemanticText(value, 128);
    if (id && !ids.includes(id)) ids.push(id);
  };
  for (const token of String(html || "").match(/<(?:span|a)\b[^>]*>/gi) || []) {
    const attrs = token.replace(/^<\w+\b|\/?\s*>$/g, "");
    const direct = attributeValue(attrs, "data-citation-source-id");
    if (direct) remember(direct);
    const citation = citationFromHref(attributeValue(attrs, "href"));
    if (citation) remember(citation.id);
  }
  return ids;
}

function canonicalizeExportPageBreaks(html) {
  const marker = '<div data-type="paper-page-break"></div>';
  return String(html || "")
    .replace(/<div\b(?=[^>]*\bdata-type=["']paper-page-break["'])[^>]*>[\s\S]*?<\/div\s*>/gi, marker)
    .replace(/<div\b(?=[^>]*\bdata-type=["']paper-page-break["'])[^>]*\/\s*>/gi, marker)
    .replace(/<hr\b(?=[^>]*\bdata-type=["']paper-page-break["'])[^>]*\/?>/gi, marker);
}

function htmlToPlainText(html) {
  let source = canonicalizeExportPageBreaks(html);
  const placeholders = [];
  const hold = (value) => `\u0000${placeholders.push(String(value)) - 1}\u0000`;
  const equationNumbers = new Map();
  let nextEquationNumber = 0;
  for (const match of source.matchAll(/<div\b([^>]*\bdata-type=["']block-math["'][^>]*)>/gi)) {
    const id = boundedSemanticText(attributeValue(match[1], "data-equation-id"), 128).toLowerCase();
    if (!id || /^false$/i.test(attributeValue(match[1], "data-equation-numbering")) || equationNumbers.has(id)) continue;
    nextEquationNumber += 1;
    equationNumbers.set(id, nextEquationNumber);
  }
  source = source
    .replace(/<figure\b([^>]*\bdata-type=["']paper-mermaid["'][^>]*)>[\s\S]*?<\/figure>/gi, (_match, attrs) => {
      const caption = boundedSemanticText(decodeHtmlEntitiesOnce(attributeValue(attrs, "data-caption")), 512);
      const mermaid = decodeHtmlEntitiesOnce(attributeValue(attrs, "data-mermaid-source"));
      return hold(`\n[Mermaid${caption ? `：${caption}` : ""}]\n${mermaid}\n`);
    })
    .replace(/<pre\b([^>]*\bdata-type=["']paper-code["'][^>]*)>([\s\S]*?)<\/pre>/gi, (_match, attrs, code) => {
      const language = normalizeCodeLanguage(attributeValue(attrs, "data-code-language"));
      return hold(`\n[代码：${language}]\n${professionalFragmentText(code, MAX_CODE_SOURCE_CHARS)}\n`);
    })
    .replace(/<div\b([^>]*\bdata-type=["']block-math["'][^>]*)>[\s\S]*?<\/div>/gi, (_match, attrs) => {
      const id = boundedSemanticText(attributeValue(attrs, "data-equation-id"), 128).toLowerCase();
      const number = equationNumbers.get(id);
      const label = boundedSemanticText(decodeHtmlEntitiesOnce(attributeValue(attrs, "data-equation-label")), 512);
      const latex = decodeHtmlEntitiesOnce(attributeValue(attrs, "data-latex"));
      return hold(`\n[公式${number ? ` ${number}` : ""}${label ? `：${label}` : ""}]\n${latex}\n`);
    })
    .replace(/<span\b([^>]*\bdata-type=["']inline-math["'][^>]*)>[\s\S]*?<\/span>/gi, (_match, attrs) => (
      hold(`$${decodeHtmlEntitiesOnce(attributeValue(attrs, "data-latex"))}$`)
    ))
    .replace(/<span\b([^>]*\bdata-type=["']paper-equation-reference["'][^>]*)>[\s\S]*?<\/span>/gi, (_match, attrs) => {
      const id = boundedSemanticText(attributeValue(attrs, "data-equation-id"), 128).toLowerCase();
      return hold(`[公式 ${equationNumbers.get(id) || "已缺失"}]`);
    });
  const plainText = decodeHtmlEntities(source
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|h[1-6]|li|blockquote|pre|tr|figure|figcaption|section)>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n---\n")
    .replace(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["'][^>]*>/gi, "$1")
    .replace(/<[^>]+>/g, ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return plainText
    .replace(/\u0000(\d+)\u0000/g, (_match, index) => placeholders[Number(index)] || "")
    .trim();
}

function semanticPlainText(html, document, bibliographyEnabled) {
  const sections = [htmlToPlainText(html)].filter(Boolean);
  const footnotes = orderedReferencedItems(document?.footnotes, "footnote", html, "data-footnote-id");
  if (footnotes.length) sections.push(`脚注\n${footnotes.map((item, index) => `${index + 1}. ${item.text}`).join("\n")}`);
  if (bibliographyEnabled) {
    const citedSources = orderedReferencedItems(document?.citationSources, "source", html, "data-citation-source-id");
    const sources = bibliographySourceOrder(
      citedSources,
      document?.citationEntryIds,
    );
    sections.push(`参考文献\n${sources.length ? sources.map((item, index) => (
      item.formattedText
        ? referenceText(item)
        : `[${index + 1}] ${referenceText(item)}`
    )).join("\n") : "暂无正文引用"}`);
  }
  return sections.join("\n\n");
}

function convertTableToMarkdown(tableHtml) {
  const rows = [...String(tableHtml).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((cell) => htmlToPlainText(cell[1]).replace(/\|/g, "\\|").replace(/\n/g, " "))
  ).filter((row) => row.length);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
  return `| ${normalized[0].join(" | ")} |\n| ${Array(width).fill("---").join(" | ")} |\n${normalized.slice(1).map((row) => `| ${row.join(" | ")} |`).join("\n")}`;
}

function htmlToMarkdown(html, document = {}, options = {}) {
  const placeholders = [];
  const hold = (value) => `\u0000${placeholders.push(value) - 1}\u0000`;
  let source = canonicalizeExportPageBreaks(html);
  const citationNumbers = new Map();
  const citationById = new Map(
    normalizeSemanticItems(document.citationSources, "source")
      .map((source) => [source.id, source]),
  );
  const equationIds = new Map();
  let equationOrdinal = 0;
  let mermaidOrdinal = 0;
  source = source.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => hold(convertTableToMarkdown(table)));
  source = source.replace(/<figure\b([^>]*\bdata-type=["']paper-mermaid["'][^>]*)>[\s\S]*?<\/figure>/gi, (_match, attrs) => {
    const mermaid = decodeHtmlEntitiesOnce(attributeValue(attrs, "data-mermaid-source"));
    const rawId = boundedSemanticText(attributeValue(attrs, "data-diagram-id"), 128).toLowerCase();
    mermaidOrdinal += 1;
    const id = UUID_PATTERN.test(rawId) ? rawId : stableSemanticUuid("mermaid", `${mermaidOrdinal}:${mermaid}`);
    const caption = boundedSemanticText(decodeHtmlEntitiesOnce(attributeValue(attrs, "data-caption")), 512);
    const metadata = professionalMarkdownMetadata("mermaid", { id, ...(caption ? { caption } : {}) });
    const fence = markdownFenceFor(mermaid);
    return hold(`\n\n${metadata}\n${fence}mermaid\n${mermaid}\n${fence}\n\n`);
  });
  source = source.replace(/<div\b([^>]*\bdata-type=["']block-math["'][^>]*)>[\s\S]*?<\/div>/gi, (_match, attrs) => {
    const latex = decodeHtmlEntitiesOnce(attributeValue(attrs, "data-latex"));
    const rawId = boundedSemanticText(attributeValue(attrs, "data-equation-id"), 128).toLowerCase();
    equationOrdinal += 1;
    const id = UUID_PATTERN.test(rawId) ? rawId : stableSemanticUuid("equation", `${equationOrdinal}:${latex}`);
    if (rawId) equationIds.set(rawId, id);
    const label = boundedSemanticText(decodeHtmlEntitiesOnce(attributeValue(attrs, "data-equation-label")), 512);
    const numbering = !/^false$/i.test(attributeValue(attrs, "data-equation-numbering"));
    const metadata = professionalMarkdownMetadata("equation", { id, ...(label ? { label } : {}), numbering });
    return hold(`\n\n${metadata}\n$$\n${latex}\n$$\n\n`);
  });
  source = source.replace(/<span\b([^>]*\bdata-type=["']inline-math["'][^>]*)>[\s\S]*?<\/span>/gi, (_match, attrs) => {
    const latex = decodeHtmlEntitiesOnce(attributeValue(attrs, "data-latex")).replace(/\$/g, "\\$");
    return hold(`$${latex}$`);
  });
  source = source.replace(/<span\b([^>]*\bdata-type=["']paper-equation-reference["'][^>]*)>[\s\S]*?<\/span>/gi, (_match, attrs) => {
    const rawEquationId = boundedSemanticText(attributeValue(attrs, "data-equation-id"), 128).toLowerCase();
    const equationId = UUID_PATTERN.test(rawEquationId) ? rawEquationId : (equationIds.get(rawEquationId) || "");
    return hold(equationId ? `[公式](#jianjian-equation=${encodeURIComponent(equationId)})` : "[公式（已缺失）]");
  });
  source = source.replace(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/gi, (_match, attrs, code) => {
    const language = normalizeCodeLanguage(attributeValue(attrs, "data-code-language"));
    const wrap = /^true$/i.test(attributeValue(attrs, "data-code-wrap"));
    const metadata = professionalMarkdownMetadata("code", { wrap });
    const codeText = professionalFragmentText(code, MAX_CODE_SOURCE_CHARS);
    const fence = markdownFenceFor(codeText);
    return hold(`\n\n${metadata}\n${fence}${language}\n${codeText}\n${fence}\n\n`);
  });
  source = source.replace(/<(?:div|hr)\b[^>]*data-type=["']paper-page-break["'][^>]*>(?:\s*<\/div>)?/gi, () => hold('\n\n<div data-type="paper-page-break"></div>\n\n'));
  source = source.replace(/<(ol|ul)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, kind, inner) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => htmlToPlainText(item[1]));
    return hold(`\n${items.map((item, index) => `${kind.toLowerCase() === "ol" ? `${index + 1}.` : "-"} ${item}`).join("\n")}\n`);
  });
  source = source.replace(/<img\b([^>]*)>/gi, (_match, attrs) => hold(`![${attributeValue(attrs, "alt").replace(/]/g, "\\]")}](${attributeValue(attrs, "src")})`));
  source = source.replace(/<span\b([^>]*\bdata-citation-source-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*)>[\s\S]*?<\/span>/gi, (_match, attrs) => {
    const id = attributeValue(attrs, "data-citation-source-id");
    const pages = attributeValue(attrs, "data-citation-pages");
    if (!citationNumbers.has(id)) citationNumbers.set(id, citationNumbers.size + 1);
    const citationKey = boundedSemanticText(
      citationById.get(id)?.citationKey,
      200,
    ).replace(/[^a-zA-Z0-9_.:+/-]/g, "-") || id;
    return hold(`[@${citationKey}${pages ? `, p. ${normalizeCitationPages(pages)}` : ""}]`);
  });
  source = source.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attrs, label) => hold(`[${htmlToPlainText(label)}](${attributeValue(attrs, "href")})`));
  source = source.replace(/<sup\b([^>]*)>[\s\S]*?<\/sup>/gi, (full, attrs) => {
    const explicitId = attributeValue(attrs, "data-footnote-id");
    const legacyId = attributeValue(attrs, "data-footnote-ref");
    const id = explicitId || (!/^(?:true|false)$/i.test(legacyId) ? legacyId : "");
    return id ? hold(`[^${id}]`) : full;
  });
  source = source.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<(s|del)\b[^>]*>([\s\S]*?)<\/\1>/gi, "~~$2~~")
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, value) => `\n\n${"#".repeat(Number(level))} ${htmlToPlainText(value)}\n\n`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, value) => `\n\n> ${htmlToPlainText(value).replace(/\n/g, "\n> ")}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, value) => `\n- ${htmlToPlainText(value)}`)
    .replace(/<br\s*\/?>/gi, "  \n")
    .replace(/<hr\b[^>]*>/gi, "\n\n---\n\n")
    .replace(/<\/(?:p|div|figure|figcaption|section)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  source = decodeHtmlEntities(source).replace(/\u0000(\d+)\u0000/g, (_match, index) => placeholders[Number(index)] || "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const footnotes = orderedReferencedItems(document.footnotes, "footnote", html, "data-footnote-id");
  if (footnotes.length) source += `\n\n${footnotes.map((item) => `[^${item.id}]: ${item.text.replace(/\n/g, " ")}`).join("\n")}`;
  const references = bibliographySourceOrder(
    orderedReferencedItems(
      document.citationSources,
      "source",
      html,
      "data-citation-source-id",
    ),
    document.citationEntryIds,
  );
  const includeReferenceSection = options.includeReferences === undefined ? references.length > 0 : Boolean(options.includeReferences);
  if (includeReferenceSection) source += `\n\n<!-- jianjian:auto-bibliography -->\n\n## 参考文献\n\n${references.length ? references.map((item, index) => (
    item.formattedText
      ? referenceText(item)
      : `${index + 1}. ${referenceText(item)}`
  )).join("\n") : "暂无正文引用"}`;
  return source;
}

function htmlDocument(title, author, body, citationStyle = {}) {
  const styleId = boundedSemanticText(citationStyle?.styleId, 200);
  const locale = /^(?:zh-CN|en-US)$/i.test(String(citationStyle?.locale || "")) ? citationStyle.locale : "zh-CN";
  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>${author ? `\n<meta name="author" content="${escapeHtml(author)}">` : ""}${styleId ? `\n<meta name="jianjian:citation-style" content="${escapeHtml(styleId)}">\n<meta name="jianjian:citation-locale" content="${escapeHtml(locale)}">` : ""}\n<style>article{max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.75;font-family:system-ui,"Segoe UI Emoji",sans-serif}pre{overflow:auto;padding:.75rem;background:#f5f5f5;border-radius:.35rem}.jianjian-math{font-family:Cambria Math,STIX Two Math,"Segoe UI Emoji",serif}.jianjian-math-preview{display:inline-flex;max-width:100%;vertical-align:middle}.jianjian-math-preview img,.jianjian-mermaid-preview img{display:block;max-width:100%;height:auto}.jianjian-equation{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;align-items:center;margin:1rem 0}.jianjian-mermaid{border:1px solid #ddd;padding:1rem}.jianjian-mermaid-preview{display:flex;justify-content:center;max-width:100%;overflow:auto}.jianjian-caption{color:#666;text-align:center}</style>\n</head>\n<body>\n<article>\n${body}\n</article>\n</body>\n</html>\n`;
}

function htmlAttributesWithClass(attributes, className) {
  const existingClass = boundedSemanticText(attributeValue(attributes, "class"), 500);
  const classes = [...new Set(
    `${existingClass} ${className}`.split(/\s+/).filter(Boolean),
  )].join(" ");
  const withoutClass = String(attributes || "")
    .replace(/\s+\bclass\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
  return `${withoutClass}${classes ? ` class="${escapeHtml(classes)}"` : ""}`;
}

function professionalHtmlPreviewImage(value, className) {
  const image = String(value || "")
    .replace(/\s+\btitle\s*=\s*(?:"JianjianProfessionalRender:[^"]*"|'JianjianProfessionalRender:[^']*')/gi, "")
    .replace(/^<img\b/i, `<img class="${escapeHtml(className)}"`);
  return /^<img\b/i.test(image) ? image : "";
}

function professionalHtmlFallbackHtml(html, renderedReplacements = new Map()) {
  let source = String(html || "");
  const equationNumbers = new Map();
  let nextEquationNumber = 0;
  for (const match of source.matchAll(/<div\b([^>]*\bdata-type=["']block-math["'][^>]*)>/gi)) {
    const id = boundedSemanticText(attributeValue(match[1], "data-equation-id"), 128).toLowerCase();
    if (!id || /^false$/i.test(attributeValue(match[1], "data-equation-numbering")) || equationNumbers.has(id)) continue;
    nextEquationNumber += 1;
    equationNumbers.set(id, nextEquationNumber);
  }
  let professionalIndex = 0;
  source = source.replace(docxProfessionalNodePattern(), (full, tag, attrs) => {
    const type = attributeValue(attrs, "data-type");
    const replacement = renderedReplacements.get(professionalIndex);
    professionalIndex += 1;
    if (type === "paper-code") return full;
    if (type === "paper-mermaid") {
      const mermaid = decodeHtmlEntitiesOnce(attributeValue(attrs, "data-mermaid-source"));
      const caption = boundedSemanticText(decodeHtmlEntitiesOnce(attributeValue(attrs, "data-caption")), 512);
      const preview = professionalHtmlPreviewImage(replacement, "jianjian-mermaid-image")
        || `<pre><code>${escapeHtml(mermaid)}</code></pre>`;
      return `<figure${htmlAttributesWithClass(attrs, "jianjian-mermaid")}><div class="jianjian-mermaid-preview">${preview}</div>${caption ? `<figcaption class="jianjian-caption">${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
    }
    if (type === "block-math") {
      const latex = decodeHtmlEntitiesOnce(attributeValue(attrs, "data-latex"));
      const id = boundedSemanticText(attributeValue(attrs, "data-equation-id"), 128).toLowerCase();
      const number = equationNumbers.get(id);
      const preview = professionalHtmlPreviewImage(replacement, "jianjian-math-image")
        || `<code class="jianjian-math">${escapeHtml(latex)}</code>`;
      return `<div${htmlAttributesWithClass(attrs, "jianjian-equation")}><span class="jianjian-math-preview">${preview}</span>${number ? `<span>(${number})</span>` : ""}</div>`;
    }
    if (type === "inline-math") {
      const latex = decodeHtmlEntitiesOnce(attributeValue(attrs, "data-latex"));
      const preview = professionalHtmlPreviewImage(replacement, "jianjian-math-image")
        || escapeHtml(latex);
      return `<span${htmlAttributesWithClass(attrs, "jianjian-math")}><span class="jianjian-math-preview">${preview}</span></span>`;
    }
    if (type === "paper-equation-reference") {
      const id = boundedSemanticText(attributeValue(attrs, "data-equation-id"), 128).toLowerCase();
      return `<span${attrs}>[公式 ${equationNumbers.get(id) || "已缺失"}]</span>`;
    }
    return full;
  });
  return source;
}

const DOCX_PROFESSIONAL_MAX_NODES = 10_000;
const DOCX_PROFESSIONAL_MAX_SOURCE_CHARS = 8 * 1024 * 1024;
const DOCX_PROFESSIONAL_MAX_SERIALIZED_BYTES = 8 * 1024 * 1024;
const DOCX_SEMANTICS_MAX_ENCODED_CHARS = 16 * 1024 * 1024;
const DOCX_SEMANTICS_MAX_RAW_BYTES = Math.floor(DOCX_SEMANTICS_MAX_ENCODED_CHARS / 4) * 3;

function docxProfessionalNodePattern() {
  return /<(pre|span|div|figure)\b((?=[^>]*\bdata-type\s*=\s*(?:"(?:paper-code|inline-math|block-math|paper-equation-reference|paper-mermaid)"|'(?:paper-code|inline-math|block-math|paper-equation-reference|paper-mermaid)'))[^>]*)>([\s\S]*?)<\/\1\s*>/gi;
}

function decodeProfessionalAttribute(value, maximum) {
  return decodeHtmlEntitiesOnce(String(value ?? ""))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, maximum);
}

function professionalFragmentText(value, maximum) {
  return decodeHtmlEntitiesOnce(String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, maximum);
}

function extractDocxProfessionalContent(html) {
  const entries = [];
  let ordinal = 0;
  for (const match of String(html || "").matchAll(docxProfessionalNodePattern())) {
    if (entries.length >= DOCX_PROFESSIONAL_MAX_NODES) break;
    const attrs = match[2];
    const type = attributeValue(attrs, "data-type");
    ordinal += 1;
    if (type === "paper-code") {
      entries.push({
        kind: "code",
        source: professionalFragmentText(match[3], MAX_CODE_SOURCE_CHARS),
        language: normalizeCodeLanguage(decodeProfessionalAttribute(attributeValue(attrs, "data-code-language"), 48)),
        wrap: /^true$/i.test(attributeValue(attrs, "data-code-wrap")),
      });
    } else if (type === "inline-math") {
      entries.push({
        kind: "inlineMath",
        latex: decodeProfessionalAttribute(attributeValue(attrs, "data-latex"), 20_000),
      });
    } else if (type === "block-math") {
      entries.push({
        kind: "blockMath",
        latex: decodeProfessionalAttribute(attributeValue(attrs, "data-latex"), 20_000),
        rawEquationId: normalizedSemanticRawId(attributeValue(attrs, "data-equation-id")),
        label: boundedSemanticText(decodeProfessionalAttribute(attributeValue(attrs, "data-equation-label"), 512), 512),
        numbering: !/^false$/i.test(attributeValue(attrs, "data-equation-numbering")),
        ordinal,
      });
    } else if (type === "paper-equation-reference") {
      entries.push({
        kind: "equationReference",
        rawEquationId: normalizedSemanticRawId(attributeValue(attrs, "data-equation-id")),
        ordinal,
      });
    } else if (type === "paper-mermaid") {
      entries.push({
        kind: "mermaid",
        source: decodeProfessionalAttribute(attributeValue(attrs, "data-mermaid-source"), 40_000),
        rawDiagramId: normalizedSemanticRawId(attributeValue(attrs, "data-diagram-id")),
        caption: boundedSemanticText(decodeProfessionalAttribute(attributeValue(attrs, "data-caption"), 512), 512),
        ordinal,
      });
    }
  }

  const equationIds = new Map();
  const usedEquationIds = new Set();
  const usedDiagramIds = new Set();
  for (const entry of entries) {
    if (entry.kind !== "blockMath") continue;
    const seed = `${entry.ordinal}:${entry.latex}:${entry.label}`;
    let equationId = UUID_PATTERN.test(entry.rawEquationId)
      ? entry.rawEquationId
      : stableSemanticUuid("equation", seed);
    let attempt = 0;
    while (usedEquationIds.has(equationId)) equationId = stableSemanticUuid("equation", seed, ++attempt);
    usedEquationIds.add(equationId);
    if (entry.rawEquationId && !equationIds.has(entry.rawEquationId)) equationIds.set(entry.rawEquationId, equationId);
    entry.equationId = equationId;
  }
  for (const entry of entries) {
    if (entry.kind === "equationReference") {
      entry.equationId = equationIds.get(entry.rawEquationId)
        || (UUID_PATTERN.test(entry.rawEquationId)
          ? entry.rawEquationId
          : stableSemanticUuid("equation", `missing:${entry.ordinal}:${entry.rawEquationId}`));
    }
    if (entry.kind === "mermaid") {
      const seed = `${entry.ordinal}:${entry.source}:${entry.caption}`;
      let diagramId = UUID_PATTERN.test(entry.rawDiagramId)
        ? entry.rawDiagramId
        : stableSemanticUuid("mermaid", seed);
      let attempt = 0;
      while (usedDiagramIds.has(diagramId)) diagramId = stableSemanticUuid("mermaid", seed, ++attempt);
      usedDiagramIds.add(diagramId);
      entry.diagramId = diagramId;
    }
    delete entry.rawEquationId;
    delete entry.rawDiagramId;
    delete entry.ordinal;
  }
  return entries;
}

function boundedDocxProfessionalContent(entries) {
  const bounded = [];
  let sourceChars = 0;
  let truncated = false;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const contentLength = String(entry?.source || entry?.latex || "").length;
    if (bounded.length >= DOCX_PROFESSIONAL_MAX_NODES || sourceChars + contentLength > DOCX_PROFESSIONAL_MAX_SOURCE_CHARS) {
      truncated = true;
      break;
    }
    bounded.push(entry);
    sourceChars += contentLength;
  }
  return { entries: bounded, truncated };
}

function docxEquationNumberMap(entries) {
  const numbers = new Map();
  let number = 0;
  for (const entry of entries) {
    if (entry.kind !== "blockMath" || entry.numbering === false || numbers.has(entry.equationId)) continue;
    number += 1;
    numbers.set(entry.equationId, number);
  }
  return numbers;
}

function professionalDocxFallbackText(entry, equationNumbers) {
  if (entry.kind === "code") {
    return `⟦代码：${entry.language}；${entry.wrap ? "自动换行" : "不换行"}⟧\n${entry.source}`;
  }
  if (entry.kind === "inlineMath") return `⟦TeX：${entry.latex}⟧`;
  if (entry.kind === "blockMath") {
    const number = equationNumbers.get(entry.equationId);
    return `⟦公式${number ? ` ${number}` : ""}${entry.label ? `：${entry.label}` : ""}⟧\n${entry.latex}`;
  }
  if (entry.kind === "equationReference") {
    const number = equationNumbers.get(entry.equationId);
    return `⟦公式引用${number ? ` ${number}` : "：已缺失"}⟧`;
  }
  if (entry.kind === "mermaid") {
    return `⟦Mermaid${entry.caption ? `：${entry.caption}` : ""}⟧\n${entry.source}`;
  }
  return "";
}

function professionalDocxNodeHtml(entry) {
  if (entry.kind === "code") {
    return `<pre data-type="paper-code" data-code-language="${escapeHtml(entry.language)}" data-code-wrap="${entry.wrap}"><code>${escapeHtml(entry.source)}</code></pre>`;
  }
  if (entry.kind === "inlineMath") {
    return `<span data-type="inline-math" data-latex="${escapeHtml(entry.latex)}"></span>`;
  }
  if (entry.kind === "blockMath") {
    return `<div data-type="block-math" data-latex="${escapeHtml(entry.latex)}" data-equation-id="${entry.equationId}" data-equation-label="${escapeHtml(entry.label)}" data-equation-numbering="${entry.numbering}"></div>`;
  }
  if (entry.kind === "equationReference") {
    return `<span data-type="paper-equation-reference" data-equation-id="${entry.equationId}"></span>`;
  }
  if (entry.kind === "mermaid") {
    return `<figure data-type="paper-mermaid" data-diagram-id="${entry.diagramId}" data-mermaid-source="${escapeHtml(entry.source)}" data-caption="${escapeHtml(entry.caption)}"><pre>${escapeHtml(entry.source)}</pre></figure>`;
  }
  return "";
}

function professionalDocxFallbackHtml(html, _warnings, semanticHtml = html) {
  const entries = extractDocxProfessionalContent(html);
  if (!entries.length) return String(html || "");
  const equationNumbers = docxEquationNumberMap(
    extractDocxProfessionalContent(semanticHtml),
  );
  if (entries.some((entry) => (
    entry.kind === "inlineMath"
    || entry.kind === "blockMath"
    || entry.kind === "mermaid"
  ))) {
    throw new Error("DOCX 公式或 Mermaid 图片替换不完整");
  }
  let entryIndex = 0;
  const source = String(html || "").replace(docxProfessionalNodePattern(), (full) => {
    const entry = entries[entryIndex];
    entryIndex += 1;
    if (!entry) return full;
    const fallback = professionalDocxFallbackText(entry, equationNumbers);
    if (entry.kind === "inlineMath" || entry.kind === "equationReference") {
      return `<span>${escapeHtml(fallback)}</span>`;
    }
    const language = entry.kind === "code" ? entry.language : (entry.kind === "mermaid" ? "mermaid" : "tex");
    return `<pre data-type="paper-code" data-code-language="${escapeHtml(language)}" data-code-wrap="true"><code>${escapeHtml(fallback)}</code></pre>`;
  });
  return source;
}

const DOCX_PROFESSIONAL_RENDER_MARKER = /^JianjianProfessionalRender:(\d{1,6}):(inlineMath|blockMath|mermaid)$/;

function professionalKindFromType(value) {
  return ({
    "paper-code": "code",
    "inline-math": "inlineMath",
    "block-math": "blockMath",
    "paper-equation-reference": "equationReference",
    "paper-mermaid": "mermaid",
  })[String(value || "")] || "";
}

function parseDocxProfessionalRenderMarker(value) {
  const match = DOCX_PROFESSIONAL_RENDER_MARKER.exec(String(value || "").trim());
  if (!match) return null;
  return {
    index: Number.parseInt(match[1], 10),
    kind: match[2],
    value: match[0],
  };
}

function markerFromDocxImageAttributes(attributes) {
  for (const name of ["title", "alt"]) {
    const value = decodeHtmlEntitiesOnce(attributeValue(attributes, name));
    const direct = parseDocxProfessionalRenderMarker(value);
    if (direct) return direct;
    const embedded = /JianjianProfessionalRender:\d{1,6}:(?:inlineMath|blockMath|mermaid)/.exec(value);
    const parsed = parseDocxProfessionalRenderMarker(embedded?.[0]);
    if (parsed) return parsed;
  }
  return null;
}

function boundedDocxImageDimension(attributes, name, limits) {
  const value = decodeHtmlEntitiesOnce(attributeValue(attributes, name)).trim();
  if (!/^[1-9]\d{0,5}$/.test(value)) throw new Error(`图片 ${name} 无效`);
  const amount = Number.parseInt(value, 10);
  if (amount > limits.maxDocxRenderedDimension) throw new Error(`图片 ${name} 超过安全上限`);
  return amount;
}

function collectDocxRenderedImageReplacements(
  renderedHtml,
  semanticHtml,
  limits,
  warnings,
  outputFormat = "docx",
) {
  const replacements = new Map();
  const source = String(renderedHtml || "");
  const outputLabel = outputFormat === "html" ? "HTML" : "DOCX";
  const expected = extractDocxProfessionalContent(semanticHtml);
  const requiredCount = expected.filter((entry) => (
    ["inlineMath", "blockMath", "mermaid"].includes(entry.kind)
  )).length;
  if (!source) {
    if (requiredCount) {
      throw new Error(`${outputLabel} 专业内容图片不完整，缺少 ${requiredCount} 个公式或 Mermaid 预览`);
    }
    return replacements;
  }
  if (Buffer.byteLength(source, "utf8") > limits.maxDocxRenderedHtmlBytes) {
    throw new Error(`${outputLabel} 专业内容临时渲染结果超过安全上限`);
  }
  let markedNodes = 0;
  let totalPngBytes = 0;
  for (const match of source.matchAll(/<img\b([^>]*)>/gi)) {
    const attributes = match[1];
    const marker = markerFromDocxImageAttributes(attributes);
    if (!marker) continue;
    markedNodes += 1;
    if (markedNodes > limits.maxDocxRenderedNodes) {
      throw new Error("DOCX 专业内容图片数量超过安全上限");
    }
    try {
      const expectedEntry = expected[marker.index];
      if (
        !expectedEntry
        || expectedEntry.kind !== marker.kind
        || !["inlineMath", "blockMath", "mermaid"].includes(marker.kind)
      ) {
        throw new Error("图片标记与原始专业节点不一致");
      }
      if (replacements.has(marker.index)) throw new Error("图片标记重复");
      const decoded = decodeImageDataUrl(
        decodeHtmlEntities(attributeValue(attributes, "src")),
        limits.maxDocxRenderedPngBytes,
      );
      if (!decoded || decoded.mime !== "image/png") throw new Error("仅接受真实 PNG");
      const width = boundedDocxImageDimension(attributes, "width", limits);
      const height = boundedDocxImageDimension(attributes, "height", limits);
      if (width * height > limits.maxDocxRenderedPixels) throw new Error("图片像素超过安全上限");
      if (totalPngBytes + decoded.buffer.length > limits.maxDocxRenderedTotalPngBytes) {
        throw new Error("专业内容图片总量超过安全上限");
      }
      const alt = boundedSemanticText(
        decodeHtmlEntitiesOnce(attributeValue(attributes, "alt")),
        920,
      );
      if (
        (marker.kind === "mermaid" && !alt.startsWith("Mermaid："))
        || (marker.kind !== "mermaid" && !alt.startsWith("TeX："))
      ) throw new Error("图片替代文本与专业节点类型不一致");
      totalPngBytes += decoded.buffer.length;
      replacements.set(
        marker.index,
        `<img src="data:image/png;base64,${decoded.buffer.toString("base64")}" alt="${escapeHtml(alt)}" title="${marker.value}" width="${width}" height="${height}">`,
      );
    } catch (error) {
      throw new Error(
        `${outputLabel} 专业内容图片 ${marker.index + 1} 未通过安全校验：${
          boundedSemanticText(error?.message || error, 300)
        }`,
      );
    }
  }
  const missing = expected
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry, index }) => (
      ["inlineMath", "blockMath", "mermaid"].includes(entry.kind)
      && !replacements.has(index)
    ));
  if (missing.length) {
    throw new Error(`${outputLabel} 专业内容图片不完整，缺少 ${missing.length} 个公式或 Mermaid 预览`);
  }
  if (replacements.size) {
    warnings.push(warning(
      outputFormat === "html"
        ? "professional-html-rendered-image"
        : "professional-docx-rendered-image",
      outputFormat === "html"
        ? `HTML 已将 ${replacements.size} 个公式或 Mermaid 预览导出为静态 PNG，同时保留受控语义属性中的源码。`
        : `DOCX 已将 ${replacements.size} 个公式或 Mermaid 预览导出为高清 PNG，并在替代文本与笺间元数据中保留源码。`,
    ));
  }
  return replacements;
}

function applyDocxRenderedImageReplacements(html, replacements) {
  if (!replacements?.size) return String(html || "");
  let index = 0;
  return String(html || "").replace(docxProfessionalNodePattern(), (full, _tag, attributes) => {
    const replacement = replacements.get(index);
    const expectedKind = professionalKindFromType(attributeValue(attributes, "data-type"));
    const marker = replacement
      ? markerFromDocxImageAttributes(replacement.replace(/^<img\b|>$/gi, ""))
      : null;
    index += 1;
    return replacement && marker?.kind === expectedKind ? replacement : full;
  });
}

async function readExportAsset(source, resolveAsset, limits) {
  if (/^data:/i.test(source)) {
    const decoded = decodeImageDataUrl(source, limits.maxAssetBytes);
    if (!decoded) throw new Error("内嵌图片无效或格式不受支持");
    return decoded;
  }
  if (!/^(?:paperwriter-asset:\/\/|assets\/)/i.test(source) || typeof resolveAsset !== "function") throw new Error("图片未暂存或无法读取");
  const asset = await resolveAsset(source, { maxBytes: limits.maxAssetBytes });
  const buffer = Buffer.isBuffer(asset?.buffer) ? asset.buffer : Buffer.from(asset?.buffer || []);
  const mime = sniffImageMime(buffer);
  if (!mime || buffer.length > limits.maxAssetBytes) throw new Error("图片内容无效或超过安全大小上限");
  return { ...asset, buffer, mime };
}

async function collectExportAssets(html, {
  resolveAsset,
  limits,
  baseName,
  externalize,
  warnings,
}) {
  const sources = [...new Set([...String(html).matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((match) => decodeHtmlEntities(match[1])))];
  const bySource = new Map();
  const byHash = new Map();
  const assets = [];
  let totalBytes = 0;
  for (const source of sources) {
    try {
      const asset = await readExportAsset(source, resolveAsset, limits);
      totalBytes += asset.buffer.length;
      if (totalBytes > limits.maxTotalAssetBytes || assets.length >= limits.maxAssetEntries) throw new Error("导出图片总量超过安全上限");
      const hash = createHash("sha256").update(asset.buffer).digest("hex");
      let stored = byHash.get(hash);
      if (!stored) {
        stored = externalize ? `${baseName}.assets/image-${hash.slice(0, 12)}${extensionForMime(asset.mime)}` : source;
        byHash.set(hash, stored);
        assets.push({ relativePath: stored, buffer: asset.buffer, mime: asset.mime, hash });
      }
      bySource.set(source, { ...asset, outputSource: stored });
    } catch (error) {
      warnings.push(warning("asset-export-failed", "图片无法导出，已保留其替代文字。", `${source}: ${error.message}`));
      bySource.set(source, null);
    }
  }
  const rewrittenHtml = String(html).replace(/<img\b([^>]*)>/gi, (full, attrs) => {
    const source = decodeHtmlEntities(attributeValue(attrs, "src"));
    const asset = bySource.get(source);
    if (!asset) return escapeHtml(attributeValue(attrs, "alt"));
    return full.replace(/\bsrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `src="${escapeHtml(asset.outputSource)}"`);
  });
  return { html: rewrittenHtml, assets: externalize ? assets : [], assetMap: bySource };
}

function tokenizeHtml(html) {
  return String(html || "").match(/<[^>]*>|[^<]+/g) || [];
}

function structuredBlocks(html, assetMap = new Map()) {
  const blocks = [];
  const stack = [];
  let current = null;
  let table = null;
  let row = null;
  let cell = null;
  const activeStyles = () => {
    const style = {};
    for (const entry of stack) {
      if (entry.tag === "strong" || entry.tag === "b") style.bold = true;
      if (entry.tag === "em" || entry.tag === "i") style.italics = true;
      if (entry.tag === "u") style.underline = {};
      if (entry.tag === "s" || entry.tag === "del") style.strike = true;
      if (entry.tag === "sub") style.subScript = true;
      if (entry.tag === "sup") style.superScript = true;
      if (entry.footnoteId) style.footnoteId = entry.footnoteId;
      if (entry.citationId) { style.citationId = entry.citationId; style.citationPages = entry.citationPages || ""; }
      if (entry.tag === "code") style.font = "Consolas";
      if (entry.tag === "a" && entry.href) style.link = entry.href;
    }
    return style;
  };
  const runs = () => cell?.runs || current?.runs;
  const pushText = (text) => {
    if (!text) return;
    if (!current && !cell && !String(text).trim()) return;
    if (!current && !cell) current = { type: "paragraph", runs: [] };
    runs()?.push({ text: decodeHtmlEntitiesOnce(text), style: activeStyles() });
  };
  const finishCurrent = () => {
    if (current) { blocks.push(current); current = null; }
  };
  for (const token of tokenizeHtml(html)) {
    if (!token.startsWith("<")) { pushText(token); continue; }
    const close = /^<\s*\/\s*([a-z0-9-]+)/i.exec(token);
    if (close) {
      const tag = close[1].toLowerCase();
      const entryIndex = stack.map((entry) => entry.tag).lastIndexOf(tag);
      const entry = entryIndex >= 0 ? stack[entryIndex] : null;
      if (tag === "td" || tag === "th") { if (cell && row) row.cells.push(cell); cell = null; }
      else if (tag === "tr") { if (row && table) table.rows.push(row); row = null; }
      else if (tag === "table") { if (table) blocks.push(table); table = null; }
      else if (entry?.startedBlock && !cell) finishCurrent();
      if (entryIndex >= 0) stack.splice(entryIndex);
      continue;
    }
    const open = /^<\s*([a-z0-9-]+)([\s\S]*?)\/?\s*>$/i.exec(token);
    if (!open) continue;
    const tag = open[1].toLowerCase();
    const attrs = open[2];
    if (tag === "br") { pushText("\n"); continue; }
    if (tag === "hr") {
      if (attributeValue(attrs, "data-type") === "paper-page-break") { finishCurrent(); blocks.push({ type: "pageBreak" }); }
      else { finishCurrent(); blocks.push({ type: "paragraph", runs: [{ text: "────────", style: {} }] }); }
      continue;
    }
    if (tag === "img") {
      const source = decodeHtmlEntities(attributeValue(attrs, "src"));
      if (!current && !cell) current = { type: "paragraph", runs: [] };
      runs()?.push({
        image: assetMap.get(source),
        alt: attributeValue(attrs, "alt"),
        professionalMarker: parseDocxProfessionalRenderMarker(
          decodeHtmlEntitiesOnce(attributeValue(attrs, "title")),
        )?.value || "",
        width: Number.parseInt(attributeValue(attrs, "width"), 10) || 0,
        height: Number.parseInt(attributeValue(attrs, "height"), 10) || 0,
        style: activeStyles(),
      });
      continue;
    }
    if (tag === "div" && attributeValue(attrs, "data-type") === "paper-page-break") { finishCurrent(); blocks.push({ type: "pageBreak" }); continue; }
    if (tag === "table") { finishCurrent(); table = { type: "table", rows: [] }; }
    if (tag === "tr") row = { cells: [] };
    if (tag === "td" || tag === "th") cell = { header: tag === "th", runs: [] };
    const blockTag = /^(?:p|h[1-6]|li|blockquote|pre|figcaption)$/.test(tag);
    let startedBlock = false;
    if (blockTag && !cell) {
      finishCurrent();
      const list = tag === "li" ? [...stack].reverse().find((entry) => entry.tag === "ol" || entry.tag === "ul")?.tag : "";
      current = { type: tag.startsWith("h") ? "heading" : tag === "li" ? "listItem" : tag === "blockquote" ? "quote" : tag === "pre" ? "code" : "paragraph", level: tag.startsWith("h") ? Number(tag[1]) : 0, list, runs: [] };
      startedBlock = true;
    }
    stack.push({
      tag,
      href: tag === "a" ? safeHref(attributeValue(attrs, "href")) : "",
      footnoteId: tag === "sup" ? (attributeValue(attrs, "data-footnote-id") || attributeValue(attrs, "data-footnote-ref")) : "",
      citationId: tag === "span" ? attributeValue(attrs, "data-citation-source-id") : "",
      citationPages: tag === "span" ? attributeValue(attrs, "data-citation-pages") : "",
      startedBlock,
    });
    if (VOID_TAGS.has(tag)) stack.pop();
  }
  finishCurrent();
  return blocks.filter((block) => block.type === "table" || block.type === "pageBreak" || block.runs?.some((run) => run.image || run.text));
}

function docxSemanticPayload(html, document, warnings = []) {
  const footnotes = orderedReferencedItems(document?.footnotes, "footnote", html, "data-footnote-id");
  const citationSources = orderedReferencedItems(document?.citationSources, "source", html, "data-citation-source-id");
  const footnoteNumberById = new Map(footnotes.map((item, index) => [item.id, index + 1]));
  const footnoteReferences = [];
  for (const match of String(html || "").matchAll(/<sup\b([^>]*)>[\s\S]*?<\/sup>/gi)) {
    const id = attributeValue(match[1], "data-footnote-id") || attributeValue(match[1], "data-footnote-ref");
    if (!footnoteNumberById.has(id)) continue;
    footnoteReferences.push({ id, number: footnoteNumberById.get(id) });
  }
  const professional = boundedDocxProfessionalContent(extractDocxProfessionalContent(html));
  const professionalContent = [];
  let professionalBytes = 0;
  for (const entry of professional.entries) {
    const serializedBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
    const addedBytes = serializedBytes + (professionalContent.length ? 1 : 0);
    if (professionalBytes + addedBytes > DOCX_PROFESSIONAL_MAX_SERIALIZED_BYTES) {
      professional.truncated = true;
      break;
    }
    professionalContent.push(entry);
    professionalBytes += addedBytes;
  }
  if (professional.truncated) {
    warnings.push(warning(
      "professional-docx-metadata-truncated",
      "专业内容过多，DOCX 仍保留可读源码，但超出安全预算的节点无法保证再次导入时恢复为结构化节点。",
    ));
  }

  const payload = {
    version: 3,
    footnotes: [],
    citationSources: [],
    footnoteReferences: [],
    citationStyle: normalizeCitationStyle(document?.citationStyle),
    professionalContent,
    professionalContentTruncated: professional.truncated,
    footnotesTruncated: false,
    citationSourcesTruncated: false,
    footnoteReferencesTruncated: false,
  };
  let payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  const appendWithinBudget = (field, entry) => {
    const serializedBytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
    const addedBytes = serializedBytes + (payload[field].length ? 1 : 0);
    if (payloadBytes + addedBytes > DOCX_SEMANTICS_MAX_RAW_BYTES) return false;
    payload[field].push(entry);
    payloadBytes += addedBytes;
    return true;
  };

  let footnoteIndex = 0;
  let citationIndex = 0;
  let footnotesBlocked = false;
  let citationsBlocked = false;
  while (
    (!footnotesBlocked && footnoteIndex < footnotes.length)
    || (!citationsBlocked && citationIndex < citationSources.length)
  ) {
    if (!citationsBlocked && citationIndex < citationSources.length) {
      if (appendWithinBudget("citationSources", citationSources[citationIndex])) citationIndex += 1;
      else citationsBlocked = true;
    }
    if (!footnotesBlocked && footnoteIndex < footnotes.length) {
      if (appendWithinBudget("footnotes", footnotes[footnoteIndex])) footnoteIndex += 1;
      else footnotesBlocked = true;
    }
  }
  payload.citationSourcesTruncated = citationIndex < citationSources.length;
  payload.footnotesTruncated = footnoteIndex < footnotes.length;

  const retainedFootnoteIds = new Set(payload.footnotes.map((item) => item.id));
  const eligibleFootnoteReferences = footnoteReferences.filter((item) => retainedFootnoteIds.has(item.id));
  for (const entry of eligibleFootnoteReferences) {
    if (!appendWithinBudget("footnoteReferences", entry)) break;
  }
  payload.footnoteReferencesTruncated = payload.footnoteReferences.length < footnoteReferences.length;

  if (
    payload.footnotesTruncated
    || payload.citationSourcesTruncated
    || payload.footnoteReferencesTruncated
  ) {
    warnings.push(warning(
      "docx-semantics-metadata-truncated",
      "脚注或文献元数据超过 DOCX 安全预算；正文仍可阅读，但超出预算的项目无法保证再次导入时恢复为结构化内容。",
    ));
  }
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  if (encoded.length > DOCX_SEMANTICS_MAX_ENCODED_CHARS) {
    throw new Error("DOCX 语义元数据超过安全大小上限");
  }
  return encoded;
}

function buildDocxBuffer(html, document, docx, assetMap, semanticHtml = html, warnings = []) {
  if (!docx?.Document || !docx?.Packer || !docx?.Paragraph || !docx?.TextRun) throw new Error("DOCX 导出需要注入 docx");
  const textRuns = (text, style = {}) => segmentDocxTextByEmojiFont(text).map((chunk) => (
    new docx.TextRun({
      text: chunk.text,
      ...style,
      ...(chunk.font ? { font: chunk.font } : {}),
    })
  ));
  const imageTransformation = (run) => {
    const width = Number(run?.width) || 0;
    const height = Number(run?.height) || 0;
    if (!(width > 0 && height > 0)) return { width: 480, height: 320 };
    const fit = Math.min(1, 480 / width, 640 / height);
    return {
      width: Math.max(1, Math.round(width * fit)),
      height: Math.max(1, Math.round(height * fit)),
    };
  };
  const makeRuns = (runs) => (runs || []).flatMap((run) => {
    if (run.image?.buffer && docx.ImageRun) {
      const alt = boundedSemanticText(run.alt || "图片", 920) || "图片";
      const marker = parseDocxProfessionalRenderMarker(run.professionalMarker)?.value || "";
      return [new docx.ImageRun({
        data: run.image.buffer,
        type: run.image.mime.split("/")[1],
        transformation: imageTransformation(run),
        altText: {
          title: marker || alt,
          description: marker ? `${alt} [${marker}]` : alt,
          name: marker || alt,
        },
      })];
    }
    const { link, footnoteId, citationId, citationPages, ...textStyle } = run.style || {};
    const children = textRuns(run.text || run.alt || "", textStyle);
    if (citationId && docx.ExternalHyperlink) {
      return [new docx.ExternalHyperlink({
        link: semanticCitationHref(citationId, citationPages),
        children,
      })];
    }
    return link && docx.ExternalHyperlink
      ? [new docx.ExternalHyperlink({ link, children })]
      : children;
  });
  const paragraphFor = (block) => {
    const options = { children: makeRuns(block.runs) };
    if (block.type === "heading") options.heading = docx.HeadingLevel?.[`HEADING_${block.level}`] || `Heading${block.level}`;
    if (block.type === "quote") options.indent = { left: 720 };
    if (block.type === "code") options.style = "JianjianCode";
    if (block.type === "listItem") {
      if (block.list === "ol") options.numbering = { reference: "jianjian-numbered", level: 0 };
      else options.bullet = { level: 0 };
    }
    if (block.type === "pageBreak") options.children = docx.PageBreak ? [new docx.PageBreak()] : [new docx.TextRun({ text: "", break: 1 })];
    return new docx.Paragraph(options);
  };
  const children = [];
  if (document.title) children.push(new docx.Paragraph({ heading: docx.HeadingLevel?.TITLE || "Title", children: textRuns(document.title) }));
  if (document.author) children.push(new docx.Paragraph({ children: textRuns(document.author, { italics: true }) }));
  for (const block of structuredBlocks(html, assetMap)) {
    if (block.type !== "table" || !docx.Table || !docx.TableRow || !docx.TableCell) { children.push(paragraphFor(block.type === "table" ? { type: "paragraph", runs: [{ text: block.rows.map((row) => row.cells.map((item) => item.runs.map((run) => run.text).join("")).join("\t")).join("\n"), style: {} }] } : block)); continue; }
    children.push(new docx.Table({ rows: block.rows.map((tableRow) => new docx.TableRow({ children: tableRow.cells.map((tableCell) => new docx.TableCell({ children: [new docx.Paragraph({ children: makeRuns(tableCell.runs) })] })) })) }));
  }
  const options = {
    creator: document.author || "笺间",
    title: document.title || "未命名信笺",
    keywords: /\bdata-(?:references|reference-list)\b/i.test(html) ? "jianjian:auto-bibliography" : "",
    customProperties: [{ name: "JianjianSemantics", value: docxSemanticPayload(semanticHtml, document, warnings) }],
    styles: {
      paragraphStyles: [{
        id: "JianjianCode",
        name: "Jianjian Code",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { font: "Consolas" },
        paragraph: {
          spacing: { before: 80, after: 80 },
          shading: {
            type: docx.ShadingType?.CLEAR || "clear",
            color: "auto",
            fill: "EFF4F2",
          },
        },
      }],
    },
    numbering: { config: [{ reference: "jianjian-numbered", levels: [{ level: 0, format: docx.LevelFormat?.DECIMAL || "decimal", text: "%1.", alignment: docx.AlignmentType?.START || "start" }] }] },
    sections: [{ properties: {}, children }],
  };
  return Promise.resolve(docx.Packer.toBuffer(new docx.Document(options)));
}

function boundedProfessionalPayloadText(value, maximum) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, maximum);
}

function normalizeEmbeddedDocxProfessionalContent(value) {
  const normalized = [];
  for (const rawEntry of Array.isArray(value) ? value.slice(0, DOCX_PROFESSIONAL_MAX_NODES) : []) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const kind = String(rawEntry.kind || "");
    if (kind === "code") {
      normalized.push({
        kind,
        source: boundedProfessionalPayloadText(
          rawEntry.source,
          DOCX_PROFESSIONAL_MAX_SOURCE_CHARS,
        ),
        language: normalizeCodeLanguage(rawEntry.language),
        wrap: rawEntry.wrap === true,
      });
    } else if (kind === "inlineMath") {
      normalized.push({ kind, latex: boundedProfessionalPayloadText(rawEntry.latex, 20_000) });
    } else if (kind === "blockMath") {
      const equationId = normalizedSemanticRawId(rawEntry.equationId);
      if (!UUID_PATTERN.test(equationId)) continue;
      normalized.push({
        kind,
        latex: boundedProfessionalPayloadText(rawEntry.latex, 20_000),
        equationId,
        label: boundedSemanticText(boundedProfessionalPayloadText(rawEntry.label, 512), 512),
        numbering: rawEntry.numbering !== false,
      });
    } else if (kind === "equationReference") {
      const equationId = normalizedSemanticRawId(rawEntry.equationId);
      if (UUID_PATTERN.test(equationId)) normalized.push({ kind, equationId });
    } else if (kind === "mermaid") {
      const diagramId = normalizedSemanticRawId(rawEntry.diagramId);
      if (!UUID_PATTERN.test(diagramId)) continue;
      normalized.push({
        kind,
        source: boundedProfessionalPayloadText(rawEntry.source, 40_000),
        diagramId,
        caption: boundedSemanticText(boundedProfessionalPayloadText(rawEntry.caption, 512), 512),
      });
    }
  }
  return boundedDocxProfessionalContent(normalized);
}

async function readDocxSemanticMetadata(buffer) {
  const empty = {
    bibliographyEnabled: false,
    footnotes: [],
    citationSources: [],
    footnoteReferences: [],
    professionalContent: [],
    professionalContentTruncated: false,
    ommlCount: 0,
  };
  try {
    const archive = await JSZip.loadAsync(buffer);
    let ommlCount = 0;
    for (const entryPath of [
      "word/document.xml",
      "word/footnotes.xml",
      "word/endnotes.xml",
    ]) {
      const entry = archive.file(entryPath);
      if (!entry) continue;
      const xml = await entry.async("string");
      const formulas = xml.match(/<m:oMath\b/gi);
      const paragraphs = formulas?.length ? [] : (xml.match(/<m:oMathPara\b/gi) || []);
      ommlCount = Math.min(10_000, ommlCount + (formulas?.length || paragraphs.length));
    }
    const core = archive.file("docProps/core.xml");
    const coreXml = core ? await core.async("string") : "";
    const bibliographyEnabled = /<cp:keywords\b[^>]*>[\s\S]*?jianjian:auto-bibliography[\s\S]*?<\/cp:keywords>/i.test(coreXml);
    const custom = archive.file("docProps/custom.xml");
    if (!custom) return { ...empty, bibliographyEnabled, ommlCount };
    const customXml = await custom.async("string");
    const encoded = /<property\b(?=[^>]*\bname=["']JianjianSemantics["'])[^>]*>[\s\S]*?<vt:lpwstr\b[^>]*>([\s\S]*?)<\/vt:lpwstr>[\s\S]*?<\/property>/i.exec(customXml)?.[1] || "";
    if (!encoded) return { ...empty, bibliographyEnabled, ommlCount };
    const normalizedEncoded = decodeHtmlEntities(encoded).replace(/\s/g, "");
    if (
      normalizedEncoded.length > DOCX_SEMANTICS_MAX_ENCODED_CHARS
      || normalizedEncoded.length % 4 !== 0
      || !/^[a-z0-9+/]*={0,2}$/i.test(normalizedEncoded)
    ) return { ...empty, bibliographyEnabled, ommlCount };
    const parsed = JSON.parse(Buffer.from(normalizedEncoded, "base64").toString("utf8"));
    if (!parsed || ![1, 2, 3].includes(parsed.version)) {
      return { ...empty, bibliographyEnabled, ommlCount };
    }
    const professional = parsed.version >= 3
      ? normalizeEmbeddedDocxProfessionalContent(parsed.professionalContent)
      : { entries: [], truncated: false };
    return {
      bibliographyEnabled,
      footnotes: Array.isArray(parsed.footnotes) ? parsed.footnotes.slice(0, 10000) : [],
      citationSources: Array.isArray(parsed.citationSources) ? parsed.citationSources.slice(0, 10000) : [],
      footnoteReferences: Array.isArray(parsed.footnoteReferences) ? parsed.footnoteReferences.slice(0, 100000) : [],
      citationStyle: parsed.version >= 2 && parsed.citationStyle && typeof parsed.citationStyle === "object"
        ? normalizeCitationStyle(parsed.citationStyle)
        : undefined,
      professionalContent: professional.entries,
      professionalContentTruncated: Boolean(parsed.professionalContentTruncated || professional.truncated),
      ommlCount,
    };
  } catch {
    return empty;
  }
}

function normalizeDocxFallbackText(value, fromHtml = false) {
  const text = fromHtml
    ? professionalFragmentText(value, 80_000)
    : boundedProfessionalPayloadText(value, 80_000);
  return text
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function restoreDocxProfessionalContent(html, entries, warnings) {
  if (!Array.isArray(entries) || !entries.length) return String(html || "");
  const equationNumbers = docxEquationNumberMap(entries);
  const inlineByFallback = new Map();
  const blockByFallback = new Map();
  const restoredIndexes = new Set();
  let restored = 0;
  let source = String(html || "").replace(/<img\b([^>]*)>/gi, (full, attributes) => {
    const marker = markerFromDocxImageAttributes(attributes);
    if (!marker || restoredIndexes.has(marker.index)) return full;
    const entry = entries[marker.index];
    if (!entry || entry.kind !== marker.kind) return full;
    restoredIndexes.add(marker.index);
    restored += 1;
    return professionalDocxNodeHtml(entry);
  });
  source = source
    .replace(
      /<p\b[^>]*>\s*(<div\b(?=[^>]*\bdata-type=["']block-math["'])[^>]*>[\s\S]*?<\/div>)\s*<\/p>/gi,
      "$1",
    )
    .replace(
      /<p\b[^>]*>\s*(<figure\b(?=[^>]*\bdata-type=["']paper-mermaid["'])[^>]*>[\s\S]*?<\/figure>)\s*<\/p>/gi,
      "$1",
    );
  for (const [entryIndex, entry] of entries.entries()) {
    if (restoredIndexes.has(entryIndex)) continue;
    const expected = normalizeDocxFallbackText(professionalDocxFallbackText(entry, equationNumbers));
    const target = entry.kind === "inlineMath" || entry.kind === "equationReference"
      ? inlineByFallback
      : blockByFallback;
    if (!target.has(expected)) target.set(expected, []);
    target.get(expected).push(entry);
  }
  let preDepth = 0;
  source = (source.match(/<[^>]*>|[^<]+/g) || []).map((token) => {
    if (token.startsWith("<")) {
      if (/^<\s*pre\b/i.test(token)) preDepth += 1;
      if (/^<\s*\/\s*pre\b/i.test(token)) preDepth = Math.max(0, preDepth - 1);
      return token;
    }
    if (preDepth || !inlineByFallback.size) return token;
    const text = decodeHtmlEntitiesOnce(token).replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n");
    let cursor = 0;
    let output = "";
    for (const match of text.matchAll(/⟦(?:TeX：[\s\S]{0,20000}?|公式引用(?: \d{1,10}|：已缺失))⟧/g)) {
      const queue = inlineByFallback.get(match[0]);
      if (!queue?.length) continue;
      output += escapeHtml(text.slice(cursor, match.index));
      output += professionalDocxNodeHtml(queue.shift());
      cursor = match.index + match[0].length;
      restored += 1;
      if (!queue.length) inlineByFallback.delete(match[0]);
    }
    return output ? `${output}${escapeHtml(text.slice(cursor))}` : token;
  }).join("");

  source = source.replace(/<(pre|p)\b[^>]*>([\s\S]*?)<\/\1>/gi, (full, _tag, content) => {
    const visible = normalizeDocxFallbackText(content, true);
    const queue = blockByFallback.get(visible);
    if (!queue?.length) return full;
    const entry = queue.shift();
    if (!queue.length) blockByFallback.delete(visible);
    restored += 1;
    return professionalDocxNodeHtml(entry);
  });

  if (restored) {
    warnings.push(warning(
      "professional-docx-restored",
      `已从笺间 DOCX 元数据恢复 ${restored} 个代码、公式或 Mermaid 节点。`,
    ));
  }
  if (restored < entries.length) {
    warnings.push(warning(
      "professional-docx-restore-partial",
      "部分专业内容的可读源码已在 Word 中发生变化，因此保留为普通文本，未强制恢复为结构化节点。",
      `${restored}/${entries.length}`,
    ));
  }
  return source;
}

function restoreDocxFootnoteReferences(html, references) {
  let index = 0;
  return String(html || "").replace(/<sup\b(?![^>]*\bdata-footnote-(?:id|ref)\b)([^>]*)>([\s\S]*?)<\/sup>/gi, (full, _attrs, content) => {
    const reference = references[index];
    const label = htmlToPlainText(content).replace(/^\[|\]$/g, "").trim();
    if (!reference?.id || !/^\d+$/.test(label)) return full;
    index += 1;
    return `<sup data-footnote-ref="${escapeHtml(reference.id)}">${Math.max(1, Number(reference.number) || 1)}</sup>`;
  });
}

function stripGeneratedDocxFootnoteList(html) {
  return String(html || "").replace(/<h[1-6]\b[^>]*>\s*脚注\s*<\/h[1-6]>\s*<ol\b[^>]*>[\s\S]*?<\/ol>/gi, "");
}

function createDocumentInterchange({
  fsApi = fs,
  pathApi = path,
  mammoth = null,
  docx = null,
  iconvLite = null,
  semanticHooks = {},
  limits = {},
  resolveAsset: defaultResolveAsset = null,
  formatCitations = null,
} = {}) {
  const resolvedLimits = { ...DEFAULT_LIMITS, ...(limits || {}) };

  async function importDocument({ format, sourcePath = "", buffer = null, encoding = "utf8", title = "", author = "" } = {}) {
    const resolvedFormat = normalizeFormat(format || pathApi.extname(sourcePath));
    if (!SUPPORTED_IMPORT_FORMATS.includes(resolvedFormat)) throw new Error("不支持的导入格式");
    const input = Buffer.isBuffer(buffer) ? buffer : await readFileBounded(pathApi.resolve(sourcePath), resolvedLimits.maxInputBytes, fsApi);
    if (input.length > resolvedLimits.maxInputBytes) throw new Error("导入文件超过安全大小上限");
    let rawHtml = "";
    let metadata = {};
    let footnotes = [];
    let citationSources = [];
    let bibliographyEnabled = false;
    const warnings = [];
    if (resolvedFormat === "docx") {
      if (!mammoth?.convertToHtml) throw new Error("DOCX 导入需要注入 mammoth");
      preflightZipBuffer(input, { limits: {
        maxArchiveBytes: resolvedLimits.maxInputBytes,
        maxEntries: resolvedLimits.maxDocxEntries,
        maxExpandedBytes: resolvedLimits.maxDocxExpandedBytes,
        maxArchiveRatio: resolvedLimits.maxDocxCompressionRatio,
      } });
      const embeddedSemantics = await readDocxSemanticMetadata(input);
      if (embeddedSemantics.citationStyle) metadata.citationStyle = embeddedSemantics.citationStyle;
      bibliographyEnabled = embeddedSemantics.bibliographyEnabled;
      if (embeddedSemantics.ommlCount) {
        warnings.push(warning(
          "docx-omml-unrecognized",
          `检测到 ${embeddedSemantics.ommlCount} 个 Word OMML 公式；当前版本不会把无法识别的 OMML 伪装成可编辑公式，已保留其余可读内容。`,
        ));
      }
      const options = {
        includeDefaultStyleMap: true,
        styleMap: [
          "p.Title => h1:fresh",
          "p[style-name='Jianjian Code'] => pre:fresh",
          "br[type='page'] => hr[data-type='paper-page-break']",
        ],
      };
      let convertedImageBytes = 0;
      let convertedImageEntries = 0;
      if (mammoth.images?.inline) options.convertImage = mammoth.images.inline(async (image) => {
        const base64 = await image.read("base64");
        const estimatedBytes = Math.floor(String(base64 || "").replace(/\s/g, "").length * 3 / 4);
        convertedImageEntries += 1;
        convertedImageBytes += estimatedBytes;
        if (estimatedBytes > resolvedLimits.maxAssetBytes) throw new Error("DOCX 内嵌图片超过安全大小上限");
        if (convertedImageEntries > resolvedLimits.maxAssetEntries || convertedImageBytes > resolvedLimits.maxTotalAssetBytes) {
          throw new Error("DOCX 内嵌图片数量或总量超过安全上限");
        }
        return { src: `data:${String(image.contentType || "").toLowerCase()};base64,${base64}` };
      });
      const converted = await mammoth.convertToHtml({ buffer: input }, options);
      rawHtml = String(converted?.value || "")
        .replace(/<hr\b(?=[^>]*data-type=["']paper-page-break["'])[^>]*\/?\s*>/gi, '<div data-type="paper-page-break"></div>')
        .replace(/<p>\s*(<div data-type="paper-page-break"><\/div>)\s*<\/p>/gi, "$1");
      if (embeddedSemantics.professionalContent.length) {
        rawHtml = restoreDocxProfessionalContent(rawHtml, embeddedSemantics.professionalContent, warnings);
      }
      if (embeddedSemantics.professionalContentTruncated) {
        warnings.push(warning(
          "professional-docx-metadata-truncated",
          "该 DOCX 的部分专业内容仅保留可读源码，无法全部恢复为结构化节点。",
        ));
      }
      if (embeddedSemantics.footnoteReferences.length) {
        rawHtml = restoreDocxFootnoteReferences(rawHtml, embeddedSemantics.footnoteReferences);
      }
      const extractedFootnotes = extractMammothFootnotes(rawHtml);
      rawHtml = extractedFootnotes.html;
      footnotes = mergeSemanticItems(embeddedSemantics.footnotes, extractedFootnotes.footnotes);
      if (embeddedSemantics.footnotes.length) rawHtml = stripGeneratedDocxFootnoteList(rawHtml);
      const semantic = extractSemanticHtml(rawHtml);
      rawHtml = semantic.html;
      footnotes = mergeSemanticItems(footnotes, semantic.footnotes);
      citationSources = mergeSemanticItems(embeddedSemantics.citationSources, semantic.citationSources);
      bibliographyEnabled = bibliographyEnabled || semantic.bibliographyEnabled;
      const citationIds = rawCitationIdsInOrder(rawHtml);
      const generatedReferences = extractGeneratedReferenceList(rawHtml);
      if (bibliographyEnabled && generatedReferences.present) {
        rawHtml = generatedReferences.html;
        citationSources = mergeSemanticItems(citationSources, generatedReferences.references.map((entry, index) => ({ ...entry, id: citationIds[index] || "" })));
      }
      for (const message of converted?.messages || []) warnings.push(warning("docx-conversion", String(message?.message || message || "DOCX 中有内容已降级。"), message?.type || ""));
    } else {
      if (input.length > resolvedLimits.maxTextBytes) throw new Error("导入文本超过安全大小上限");
      const text = decodeTextBuffer(input, encoding, iconvLite);
      if (resolvedFormat === "markdown") {
        const converted = markdownToHtml(text);
        rawHtml = converted.html;
        footnotes = converted.footnotes;
        citationSources = converted.citationSources;
        bibliographyEnabled = converted.bibliographyEnabled;
      }
      else if (resolvedFormat === "html") {
        metadata = extractHtmlMetadata(text);
        const semantic = extractSemanticHtml(extractHtmlDocumentBody(text));
        rawHtml = semantic.html;
        footnotes = semantic.footnotes;
        citationSources = semantic.citationSources;
        bibliographyEnabled = semantic.bibliographyEnabled;
      }
      else rawHtml = textToHtml(text);
    }
    let sanitized = await sanitizeImportedHtml(rawHtml, { sourcePath, fsApi, pathApi, limits: resolvedLimits, warnings });
    let canonical = canonicalizeSemantics(sanitized.html, footnotes, citationSources);
    let document = {
      title: String(title || metadata.title || documentTitleFromPath(sourcePath, pathApi)).trim().slice(0, 200) || "导入的信笺",
      author: String(author || metadata.author || "").trim().slice(0, 100),
      html: canonical.html,
      footnotes: canonical.footnotes,
      citationSources: canonical.citationSources,
      ...(metadata.citationStyle ? { citationStyle: metadata.citationStyle } : {}),
    };
    if (typeof semanticHooks.afterImport === "function") {
      const extension = await semanticHooks.afterImport({ format: resolvedFormat, sourcePath, document: { ...document }, warnings: [...warnings] });
      if (extension && typeof extension === "object") {
        if (typeof extension.html === "string") sanitized = await sanitizeImportedHtml(extension.html, { sourcePath, fsApi, pathApi, limits: resolvedLimits, warnings });
        canonical = canonicalizeSemantics(
          sanitized.html,
          extension.footnotes ?? document.footnotes,
          extension.citationSources ?? document.citationSources,
        );
        document = {
          ...document,
          ...extension,
          html: canonical.html,
          footnotes: canonical.footnotes,
          citationSources: canonical.citationSources,
        };
      }
    }
    if (bibliographyEnabled && !/\bdata-reference-list\b/i.test(document.html)) {
      document.html = `${document.html}<section data-reference-list="[]"></section>`;
    }
    return { format: resolvedFormat, document, warnings, assets: sanitized.assets };
  }

  async function exportDocument({
    format,
    document = {},
    targetPath = "",
    baseName = "",
    renderedHtml = "",
    resolveAsset = defaultResolveAsset,
  } = {}) {
    const resolvedFormat = normalizeFormat(format || pathApi.extname(targetPath));
    if (!SUPPORTED_EXPORT_FORMATS.includes(resolvedFormat)) throw new Error("不支持的导出格式");
    const warnings = [];
    if (Buffer.byteLength(String(document.html || ""), "utf8") > resolvedLimits.maxTextBytes) throw new Error("导出正文超过安全大小上限");
    let body = await sanitizeStoredHtml(document.html || "<p></p>", warnings);
    if (typeof semanticHooks.beforeExport === "function") {
      const extension = await semanticHooks.beforeExport({ format: resolvedFormat, document: { ...document }, html: body, warnings: [...warnings] });
      if (typeof extension === "string") body = await sanitizeStoredHtml(extension, warnings);
      else if (typeof extension?.html === "string") body = await sanitizeStoredHtml(extension.html, warnings);
    }
    const extracted = extractSemanticHtml(body);
    const bibliographyEnabled = Boolean(extracted.bibliographyEnabled);
    const canonical = canonicalizeSemantics(
      extracted.html,
      mergeSemanticItems(document.footnotes, extracted.footnotes),
      mergeSemanticItems(document.citationSources, extracted.citationSources),
    );
    body = canonicalizeExportPageBreaks(canonical.html);
    let citationFormatting = null;
    let semanticDocument = {
      ...document,
      footnotes: canonical.footnotes,
      citationSources: canonical.citationSources,
    };
    if (typeof formatCitations === "function") {
      const citedSources = orderedReferencedItems(
        semanticDocument.citationSources,
        "source",
        body,
        "data-citation-source-id",
      );
      if (citedSources.length) {
        try {
          citationFormatting = await formatCitations({
            sources: citedSources,
            styleId: semanticDocument.citationStyle?.styleId,
            locale: semanticDocument.citationStyle?.locale,
            customStyle: semanticDocument.citationStyle?.customStyle,
          });
          body = applyFormattedInlineCitations(body, citationFormatting);
          semanticDocument = {
            ...semanticDocument,
            citationSources: citationSourcesWithFormatting(
              semanticDocument.citationSources,
              citationFormatting,
            ),
            citationEntryIds: citationFormatting.entryIds,
          };
        } catch (error) {
          warnings.push(warning(
            "citation-style-fallback",
            "引用样式排版失败，已使用安全的基础文本格式导出。",
            boundedSemanticText(error?.message || error, 500),
          ));
        }
      }
    }
    const safeBase = String(baseName || (targetPath ? pathApi.basename(targetPath, pathApi.extname(targetPath)) : document.title) || "未命名信笺")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 100) || "未命名信笺";
    const semanticBody = appendSemanticHtml(body, semanticDocument, {
      citationFormatting,
      includeReferences: bibliographyEnabled,
    });
    const renderedReplacements = ["docx", "html"].includes(resolvedFormat)
      ? collectDocxRenderedImageReplacements(
        renderedHtml,
        body,
        resolvedLimits,
        warnings,
        resolvedFormat,
      )
      : new Map();
    if (resolvedFormat === "txt") {
      if (/<img\b/i.test(body)) warnings.push(warning("format-loss", "TXT 不支持图片，已仅保留替代文字。"));
      if (/\bdata-type=["'](?:paper-code|inline-math|block-math|paper-equation-reference|paper-mermaid)["']/i.test(body)) {
        warnings.push(warning(
          "professional-txt-structure-loss",
          "TXT 已保留代码、公式与 Mermaid 源码，但不保留语言设置、编号关系和图注等结构化属性。",
        ));
      }
      return { format: resolvedFormat, mime: "text/plain; charset=utf-8", extension: ".txt", buffer: Buffer.from(semanticPlainText(body, semanticDocument, bibliographyEnabled), "utf8"), assets: [], warnings };
    }
    if (resolvedFormat === "docx") {
      const visualBody = applyDocxRenderedImageReplacements(body, renderedReplacements);
      const docxBody = appendSemanticHtml(
        professionalDocxFallbackHtml(visualBody, warnings, body),
        semanticDocument,
        {
          citationFormatting,
          includeFootnotes: true,
          includeReferences: bibliographyEnabled,
        },
      );
      const collected = await collectExportAssets(docxBody, { resolveAsset, limits: resolvedLimits, baseName: safeBase, externalize: false, warnings });
      const buffer = await buildDocxBuffer(collected.html, semanticDocument, docx, collected.assetMap, semanticBody, warnings);
      const output = Buffer.from(buffer);
      if (output.length > resolvedLimits.maxInputBytes) throw new Error("DOCX 导出结果超过安全大小上限");
      return { format: resolvedFormat, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: ".docx", buffer: output, assets: [], warnings };
    }
    const collected = await collectExportAssets(
      resolvedFormat === "html"
        ? professionalHtmlFallbackHtml(semanticBody, renderedReplacements)
        : body,
      {
        resolveAsset,
        limits: resolvedLimits,
        baseName: safeBase,
        externalize: true,
        warnings,
      },
    );
    if (resolvedFormat === "markdown") {
      return { format: resolvedFormat, mime: "text/markdown; charset=utf-8", extension: ".md", buffer: Buffer.from(`${htmlToMarkdown(collected.html, semanticDocument, { includeReferences: bibliographyEnabled })}\n`, "utf8"), assets: collected.assets, warnings };
    }
    const output = htmlDocument(document.title || safeBase, document.author || "", collected.html, document.citationStyle);
    return { format: resolvedFormat, mime: "text/html; charset=utf-8", extension: ".html", buffer: Buffer.from(output, "utf8"), assets: collected.assets, warnings };
  }

  return { exportDocument, importDocument };
}

module.exports = {
  DEFAULT_LIMITS,
  SUPPORTED_EXPORT_FORMATS,
  SUPPORTED_IMPORT_FORMATS,
  createDocumentInterchange,
  decodeImageDataUrl,
  decodeTextBuffer,
  escapeHtml,
  htmlToMarkdown,
  htmlToPlainText,
  markdownToHtml,
  normalizeFormat,
  pathIsInside,
  sanitizeImportedHtml,
  sniffImageMime,
};
