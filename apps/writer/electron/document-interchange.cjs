const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const JSZip = require("jszip");
const { preflightZipBuffer } = require("./document-storage.cjs");

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
});

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
]);
const SAFE_IMAGE_MIMES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif",
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
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp" && /^(?:avif|avis)$/.test(bytes.subarray(8, 12).toString("ascii"))) return "image/avif";
  return "";
}

function extensionForMime(mime) {
  return ({
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
    "image/bmp": ".bmp", "image/avif": ".avif",
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
      if (!decoded) throw new Error("仅支持安全的 PNG、JPEG、GIF、WebP、BMP 或 AVIF 图片");
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
        const maximum = name === "data-reference-list" ? 2 * 1024 * 1024 : 256;
        const value = String(attribute.value || "").slice(0, maximum);
        if (name !== "data-type" || value === "paper-page-break") safe.push(`${name}="${escapeHtml(value)}"`);
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
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g, (_match, alt, src, title) => hold(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ""}>`))
    .replace(/\[(\d+)\]\((#jianjian-citation=[^)\s]+)\)/gi, (_match, number, href) => {
      const citation = citationFromHref(href);
      if (!citation) return _match;
      return hold(`<span data-citation-source-id="${escapeHtml(citation.id)}"${citation.pages ? ` data-citation-pages="${escapeHtml(citation.pages)}"` : ""}>[${escapeHtml(number)}]</span>`);
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, href) => hold(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`))
    .replace(/\[\^([a-z0-9_-]+)\]/gi, (_match, id) => hold(`<sup data-footnote-ref="${escapeHtml(id)}">${escapeHtml(id)}</sup>`))
    .replace(/\[@([a-z0-9_.:-]+)\]/gi, (_match, id) => hold(`<span data-citation-source-id="${escapeHtml(id)}">[${escapeHtml(id)}]</span>`));
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
  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${markdownInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = "";
  };
  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index];
    if (/^```/.test(line)) {
      flushParagraph(); closeList();
      if (inCode) { output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`); code = []; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { code.push(line); continue; }
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
  if (inCode) output.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
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
  return { title: title.slice(0, 200), author: decodeHtmlEntities(attributeValue(authorMeta, "content")).trim().slice(0, 100) };
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

function normalizeSemanticFields(entry, kind, id) {
  const source = entry && typeof entry === "object" ? entry : { text: entry };
  if (kind === "footnote") return { id, text: boundedSemanticText(source.text) };
  const text = boundedSemanticText(source.text);
  const authors = (Array.isArray(source.authors) ? source.authors : (source.author ? String(source.author).split(/[;,；，]/) : []))
    .slice(0, 100).map((author) => boundedSemanticText(author, 200)).filter(Boolean);
  return {
    id,
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
  const author = Array.isArray(source.authors) ? source.authors.map((value) => String(value || "").trim()).filter(Boolean).join("，") : source.author;
  const parts = [author, source.title || source.text, source.containerTitle, source.publisher, source.year].map((value) => String(value || "").trim()).filter(Boolean);
  if (source.url) parts.push(String(source.url).trim());
  else if (source.doi) parts.push(`DOI:${String(source.doi).trim()}`);
  return parts.join(". ") || source.text || source.id;
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

function appendSemanticHtml(html, document, { includeFootnotes = true, includeReferences = true } = {}) {
  let result = String(html || "");
  const footnotes = orderedReferencedItems(document?.footnotes, "footnote", result, "data-footnote-id");
  const sources = orderedReferencedItems(document?.citationSources, "source", result, "data-citation-source-id");
  if (includeFootnotes && footnotes.length && !/data-footnotes\b/i.test(result)) {
    result += `<section data-footnotes="true"><h2>脚注</h2><ol>${footnotes.map((item) => `<li data-footnote-id="${escapeHtml(item.id)}">${escapeHtml(item.text)}</li>`).join("")}</ol></section>`;
  }
  if (includeReferences && !/data-references\b|data-reference-list\b/i.test(result)) {
    const snapshot = escapeHtml(serializeReferenceSnapshot(sources));
    result += `<section data-references="true" data-reference-list="${snapshot}"><h2>参考文献</h2>${sources.length ? `<ol>${sources.map((item) => `<li data-citation-source-id="${escapeHtml(item.id)}">${escapeHtml(referenceText(item))}</li>`).join("")}</ol>` : "<p>暂无正文引用</p>"}</section>`;
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
  return decodeHtmlEntities(canonicalizeExportPageBreaks(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|h[1-6]|li|blockquote|pre|tr|figure|figcaption|section)>/gi, "\n")
    .replace(/<hr\b[^>]*>/gi, "\n---\n")
    .replace(/<img\b[^>]*\balt\s*=\s*["']([^"']*)["'][^>]*>/gi, "$1")
    .replace(/<[^>]+>/g, ""))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function semanticPlainText(html, document, bibliographyEnabled) {
  const sections = [htmlToPlainText(html)].filter(Boolean);
  const footnotes = orderedReferencedItems(document?.footnotes, "footnote", html, "data-footnote-id");
  if (footnotes.length) sections.push(`脚注\n${footnotes.map((item, index) => `${index + 1}. ${item.text}`).join("\n")}`);
  if (bibliographyEnabled) {
    const sources = orderedReferencedItems(document?.citationSources, "source", html, "data-citation-source-id");
    sections.push(`参考文献\n${sources.length ? sources.map((item, index) => `[${index + 1}] ${referenceText(item)}`).join("\n") : "暂无正文引用"}`);
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
  source = source.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => hold(convertTableToMarkdown(table)));
  source = source.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, code) => hold(`\n\n\`\`\`\n${htmlToPlainText(code)}\n\`\`\`\n\n`));
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
    return hold(`[${citationNumbers.get(id)}](${semanticCitationHref(id, pages)})`);
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
  const references = orderedReferencedItems(document.citationSources, "source", html, "data-citation-source-id");
  const includeReferenceSection = options.includeReferences === undefined ? references.length > 0 : Boolean(options.includeReferences);
  if (includeReferenceSection) source += `\n\n<!-- jianjian:auto-bibliography -->\n\n## 参考文献\n\n${references.length ? references.map((item, index) => `${index + 1}. ${referenceText(item)}`).join("\n") : "暂无正文引用"}`;
  return source;
}

function htmlDocument(title, author, body) {
  return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>${author ? `\n<meta name="author" content="${escapeHtml(author)}">` : ""}\n</head>\n<body>\n<article>\n${body}\n</article>\n</body>\n</html>\n`;
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
    runs()?.push({ text: decodeHtmlEntities(text), style: activeStyles() });
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
      runs()?.push({ image: assetMap.get(source), alt: attributeValue(attrs, "alt"), style: activeStyles() });
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

function docxSemanticPayload(html, document) {
  const footnotes = orderedReferencedItems(document?.footnotes, "footnote", html, "data-footnote-id");
  const citationSources = orderedReferencedItems(document?.citationSources, "source", html, "data-citation-source-id");
  const footnoteNumberById = new Map(footnotes.map((item, index) => [item.id, index + 1]));
  const footnoteReferences = [];
  for (const match of String(html || "").matchAll(/<sup\b([^>]*)>[\s\S]*?<\/sup>/gi)) {
    const id = attributeValue(match[1], "data-footnote-id") || attributeValue(match[1], "data-footnote-ref");
    if (!footnoteNumberById.has(id)) continue;
    footnoteReferences.push({ id, number: footnoteNumberById.get(id) });
  }
  return Buffer.from(JSON.stringify({ version: 1, footnotes, citationSources, footnoteReferences }), "utf8").toString("base64");
}

function buildDocxBuffer(html, document, docx, assetMap) {
  if (!docx?.Document || !docx?.Packer || !docx?.Paragraph || !docx?.TextRun) throw new Error("DOCX 导出需要注入 docx");
  const makeRuns = (runs) => (runs || []).map((run) => {
    if (run.image?.buffer && docx.ImageRun) {
      return new docx.ImageRun({ data: run.image.buffer, type: run.image.mime.split("/")[1], transformation: { width: 480, height: 320 }, altText: { title: run.alt || "图片", description: run.alt || "图片", name: run.alt || "图片" } });
    }
    const { link, footnoteId, citationId, citationPages, ...textStyle } = run.style || {};
    const textRun = new docx.TextRun({ text: run.text || run.alt || "", ...textStyle });
    if (citationId && docx.ExternalHyperlink) return new docx.ExternalHyperlink({ link: semanticCitationHref(citationId, citationPages), children: [textRun] });
    return link && docx.ExternalHyperlink ? new docx.ExternalHyperlink({ link, children: [textRun] }) : textRun;
  });
  const paragraphFor = (block) => {
    const options = { children: makeRuns(block.runs) };
    if (block.type === "heading") options.heading = docx.HeadingLevel?.[`HEADING_${block.level}`] || `Heading${block.level}`;
    if (block.type === "quote") options.indent = { left: 720 };
    if (block.type === "listItem") {
      if (block.list === "ol") options.numbering = { reference: "jianjian-numbered", level: 0 };
      else options.bullet = { level: 0 };
    }
    if (block.type === "pageBreak") options.children = docx.PageBreak ? [new docx.PageBreak()] : [new docx.TextRun({ text: "", break: 1 })];
    return new docx.Paragraph(options);
  };
  const children = [];
  if (document.title) children.push(new docx.Paragraph({ heading: docx.HeadingLevel?.TITLE || "Title", children: [new docx.TextRun({ text: document.title })] }));
  if (document.author) children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: document.author, italics: true })] }));
  for (const block of structuredBlocks(html, assetMap)) {
    if (block.type !== "table" || !docx.Table || !docx.TableRow || !docx.TableCell) { children.push(paragraphFor(block.type === "table" ? { type: "paragraph", runs: [{ text: block.rows.map((row) => row.cells.map((item) => item.runs.map((run) => run.text).join("")).join("\t")).join("\n"), style: {} }] } : block)); continue; }
    children.push(new docx.Table({ rows: block.rows.map((tableRow) => new docx.TableRow({ children: tableRow.cells.map((tableCell) => new docx.TableCell({ children: [new docx.Paragraph({ children: makeRuns(tableCell.runs) })] })) })) }));
  }
  const options = {
    creator: document.author || "笺间",
    title: document.title || "未命名信笺",
    keywords: /\bdata-(?:references|reference-list)\b/i.test(html) ? "jianjian:auto-bibliography" : "",
    customProperties: [{ name: "JianjianSemantics", value: docxSemanticPayload(html, document) }],
    numbering: { config: [{ reference: "jianjian-numbered", levels: [{ level: 0, format: docx.LevelFormat?.DECIMAL || "decimal", text: "%1.", alignment: docx.AlignmentType?.START || "start" }] }] },
    sections: [{ properties: {}, children }],
  };
  return Promise.resolve(docx.Packer.toBuffer(new docx.Document(options)));
}

async function readDocxSemanticMetadata(buffer) {
  const empty = { bibliographyEnabled: false, footnotes: [], citationSources: [], footnoteReferences: [] };
  try {
    const archive = await JSZip.loadAsync(buffer);
    const core = archive.file("docProps/core.xml");
    const coreXml = core ? await core.async("string") : "";
    const bibliographyEnabled = /<cp:keywords\b[^>]*>[\s\S]*?jianjian:auto-bibliography[\s\S]*?<\/cp:keywords>/i.test(coreXml);
    const custom = archive.file("docProps/custom.xml");
    if (!custom) return { ...empty, bibliographyEnabled };
    const customXml = await custom.async("string");
    const encoded = /<property\b(?=[^>]*\bname=["']JianjianSemantics["'])[^>]*>[\s\S]*?<vt:lpwstr\b[^>]*>([\s\S]*?)<\/vt:lpwstr>[\s\S]*?<\/property>/i.exec(customXml)?.[1] || "";
    if (!encoded) return { ...empty, bibliographyEnabled };
    const parsed = JSON.parse(Buffer.from(decodeHtmlEntities(encoded), "base64").toString("utf8"));
    if (!parsed || parsed.version !== 1) return { ...empty, bibliographyEnabled };
    return {
      bibliographyEnabled,
      footnotes: Array.isArray(parsed.footnotes) ? parsed.footnotes.slice(0, 10000) : [],
      citationSources: Array.isArray(parsed.citationSources) ? parsed.citationSources.slice(0, 10000) : [],
      footnoteReferences: Array.isArray(parsed.footnoteReferences) ? parsed.footnoteReferences.slice(0, 100000) : [],
    };
  } catch {
    return empty;
  }
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
      bibliographyEnabled = embeddedSemantics.bibliographyEnabled;
      const options = {
        includeDefaultStyleMap: true,
        styleMap: [
          "p.Title => h1:fresh",
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

  async function exportDocument({ format, document = {}, targetPath = "", baseName = "", resolveAsset = defaultResolveAsset } = {}) {
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
    const semanticDocument = { ...document, footnotes: canonical.footnotes, citationSources: canonical.citationSources };
    const safeBase = String(baseName || (targetPath ? pathApi.basename(targetPath, pathApi.extname(targetPath)) : document.title) || "未命名信笺")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 100) || "未命名信笺";
    const semanticBody = appendSemanticHtml(body, semanticDocument, { includeReferences: bibliographyEnabled });
    if (resolvedFormat === "txt") {
      if (/<img\b/i.test(body)) warnings.push(warning("format-loss", "TXT 不支持图片，已仅保留替代文字。"));
      return { format: resolvedFormat, mime: "text/plain; charset=utf-8", extension: ".txt", buffer: Buffer.from(semanticPlainText(body, semanticDocument, bibliographyEnabled), "utf8"), assets: [], warnings };
    }
    if (resolvedFormat === "docx") {
      const docxBody = appendSemanticHtml(body, semanticDocument, { includeFootnotes: true, includeReferences: bibliographyEnabled });
      const collected = await collectExportAssets(docxBody, { resolveAsset, limits: resolvedLimits, baseName: safeBase, externalize: false, warnings });
      const buffer = await buildDocxBuffer(collected.html, semanticDocument, docx, collected.assetMap);
      const output = Buffer.from(buffer);
      if (output.length > resolvedLimits.maxInputBytes) throw new Error("DOCX 导出结果超过安全大小上限");
      return { format: resolvedFormat, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: ".docx", buffer: output, assets: [], warnings };
    }
    const collected = await collectExportAssets(resolvedFormat === "html" ? semanticBody : body, { resolveAsset, limits: resolvedLimits, baseName: safeBase, externalize: true, warnings });
    if (resolvedFormat === "markdown") {
      return { format: resolvedFormat, mime: "text/markdown; charset=utf-8", extension: ".md", buffer: Buffer.from(`${htmlToMarkdown(collected.html, semanticDocument, { includeReferences: bibliographyEnabled })}\n`, "utf8"), assets: collected.assets, warnings };
    }
    const output = htmlDocument(document.title || safeBase, document.author || "", collected.html);
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
