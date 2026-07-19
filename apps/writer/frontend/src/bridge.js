import {
  BROWSER_AI_PROTOCOLS,
  MAX_BROWSER_AI_MODELS,
  MAX_BROWSER_AI_PROVIDERS,
  browserModelId,
  exactBrowserAiProviderConfig,
  hasOwn,
  normalizeBrowserAiConfig as normalizeBrowserAiConfigValue,
  normalizeBrowserExternalUrl,
  normalizeBrowserAiRequestParams,
  normalizeBrowserModelConfig,
  publicBrowserAiConfig as publicBrowserAiConfigValue,
  safeBrowserProviderId,
} from "./browser-ai-config.js";
import { normalizeCitationResearchIdentity } from "./document-schema-v2.js";

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function validateBrowserAiRequestParamsPatch(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请求参数必须是 Key-Value 对象");
  const normalized = normalizeBrowserAiRequestParams(value);
  let sourceJson = "";
  try {
    sourceJson = JSON.stringify(value);
  } catch {
    throw new Error("请求参数包含无法保存的值");
  }
  if (sourceJson !== JSON.stringify(normalized)) {
    throw new Error("请求参数包含空键、保留字段、危险键或无效值");
  }
  return normalized;
}

function assertBrowserResourcesArePersistable(document = {}) {
  const html = typeof document?.html === "string" ? document.html : "";
  const customBackground = typeof document?.customBackground === "string" ? document.customBackground : "";
  const aiImages = document?.aiState?.optimize?.assets?.images;
  const imageSources = aiImages && typeof aiImages === "object"
    ? Object.values(aiImages).map((image) => image?.src)
    : [];
  if (/\bsrc=(["'])blob:[^"']+\1/i.test(html) || /^blob:/i.test(customBackground) || imageSources.some((source) => /^blob:/i.test(String(source || "")))) {
    throw new Error("文档包含仅在当前页面有效的临时图片；请重新选择图片后再保存");
  }
}

function pickFileInBrowser({ kind, accept, maxBytes = 0, allowedExtensions = [] }) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ canceled: true });
        return;
      }
      const extension = file.name.toLowerCase().split(".").pop();
      if (allowedExtensions.length && !allowedExtensions.includes(extension)) {
        resolve({ canceled: false, error: "unsupported-type", kind, extension });
        return;
      }
      if (maxBytes && file.size > maxBytes) {
        resolve({ canceled: false, error: "too-large", kind, size: file.size, maxBytes });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          canceled: false,
          kind,
          name: file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          path: file.name,
          mime: file.type,
          size: file.size,
          dataUrl: reader.result,
        });
      };
      reader.onerror = () => resolve({ canceled: false, error: "read-failed", kind });
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

function pickImageInBrowser() {
  return pickFileInBrowser({
    kind: "image",
    accept: "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml,image/avif",
  });
}

function pickAudioInBrowser() {
  return pickFileInBrowser({
    kind: "audio",
    accept: ".mp3,.wav,.ogg,.m4a,.aac,.flac,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/flac",
    maxBytes: 20 * 1024 * 1024,
    allowedExtensions: ["mp3", "wav", "ogg", "m4a", "aac", "flac"],
  });
}

function pickVideoInBrowser() {
  return pickFileInBrowser({
    kind: "video",
    accept: ".mp4,.webm,.ogv,video/mp4,video/webm,video/ogg",
    maxBytes: 100 * 1024 * 1024,
    allowedExtensions: ["mp4", "webm", "ogv"],
  });
}

const browserAiListeners = {
  chunk: new Set(),
  done: new Set(),
  error: new Set(),
};
const browserExportProgressListeners = new Set();
const browserWorkspaceChangedListeners = new Set();
const browserWorkspaceWatchErrorListeners = new Set();
const browserWindowFocusListeners = new Set();
const browserWindowBlurListeners = new Set();
const browserFullscreenListeners = new Set();
const browserResearchLibraryChangedListeners = new Set();
const browserResearchLibraryWatchErrorListeners = new Set();
const canceledBrowserSearches = new Set();
let logicalBrowserFullscreen = false;
let browserLifecycleListenersInstalled = false;

const BROWSER_IMPORT_MAX_BYTES = 32 * 1024 * 1024;
const BROWSER_RESEARCH_TYPES = new Set(["web"]);
const BROWSER_CITATION_TYPES = new Set(["book", "article", "web", "pdf", "report", "thesis", "other"]);
const BROWSER_SOURCE_LIMIT = 5000;
const BROWSER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BROWSER_RESEARCH_LIBRARY_SOURCE_TYPES = new Set(["web"]);
const BROWSER_EXPORT_FORMATS = new Set(["markdown", "html", "txt"]);
const BROWSER_SAFE_HTML_TAGS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "FIGCAPTION", "FIGURE",
  "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "LI", "OL", "P", "PRE", "S",
  "SECTION", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TFOOT", "TH",
  "THEAD", "TR", "U", "UL",
]);
const BROWSER_DROP_HTML_TAGS = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "FORM", "SVG", "MATH",
]);

function emitBrowserEvent(listeners, payload) {
  listeners.forEach((callback) => callback(payload));
}

function browserRandomId() {
  return globalThis.crypto?.randomUUID?.()
    || `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function escapeBrowserHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function browserDownloadName(value, extension = "") {
  const raw = String(value || "未命名信笺").split(/[\\/]/).pop() || "未命名信笺";
  const safe = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 120) || "未命名信笺";
  return extension && !safe.toLowerCase().endsWith(extension) ? `${safe}${extension}` : safe;
}

function plainTextFromBrowserHtml(html) {
  if (typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
    return String(parsed.body?.textContent || "").replace(/\u00a0/g, " ");
  }
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function canonicalizeBrowserExportPageBreaks(html) {
  const marker = '<div data-type="paper-page-break"></div>';
  return String(html || "")
    .replace(/<div\b(?=[^>]*\bdata-type=["']paper-page-break["'])[^>]*>[\s\S]*?<\/div\s*>/gi, marker)
    .replace(/<div\b(?=[^>]*\bdata-type=["']paper-page-break["'])[^>]*\/\s*>/gi, marker)
    .replace(/<hr\b(?=[^>]*\bdata-type=["']paper-page-break["'])[^>]*\/?>/gi, marker);
}

function sanitizeBrowserHref(value) {
  const source = String(value || "").trim();
  if (!source || /[\u0000-\u001f\u007f]/.test(source)) return "";
  if (/^(?:https?:|mailto:|#)/i.test(source)) return source;
  if (/^(?:javascript|vbscript|data|file|blob):/i.test(source) || /^(?:[\\/]{2}|[a-z]:[\\/])/i.test(source)) return "";
  return source.split("/").some((part) => part === "..") ? "" : source;
}

function sanitizeBrowserImportedHtml(html, warnings = []) {
  if (typeof DOMParser === "undefined") {
    warnings.push({ code: "browser-html-fallback", message: "浏览器缺少 HTML 解析能力，已按纯文本导入。" });
    return `<p>${escapeBrowserHtml(plainTextFromBrowserHtml(html)).replace(/\r?\n/g, "<br>")}</p>`;
  }
  const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
  let removedImages = false;
  for (const element of [...parsed.body.querySelectorAll("*")].reverse()) {
    const tagName = element.tagName;
    if (tagName === "IMG") {
      removedImages = true;
      const replacement = parsed.createTextNode(element.getAttribute("alt") || "");
      element.replaceWith(replacement);
      continue;
    }
    if (BROWSER_DROP_HTML_TAGS.has(tagName)) {
      element.remove();
      continue;
    }
    if (!BROWSER_SAFE_HTML_TAGS.has(tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const keepData = [
        "data-citation-source-id", "data-citation-pages", "data-document-id", "data-footnote-id",
        "data-footnote-ref", "data-reference-list", "data-type",
      ].includes(name);
      if (name === "href" && tagName === "A") {
        const href = sanitizeBrowserHref(attribute.value);
        if (href) element.setAttribute("href", href);
        else element.removeAttribute(attribute.name);
      } else if (!keepData && !(["title"].includes(name) && tagName === "A") && !(["colspan", "rowspan"].includes(name) && ["TD", "TH"].includes(tagName))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  if (removedImages) warnings.push({
    code: "browser-assets-omitted",
    message: "浏览器预览无法读取或打包旁路图片资源，图片已移除；桌面端可完整导入导出。",
  });
  return parsed.body.innerHTML.trim() || "<p></p>";
}

function browserMarkdownInline(value) {
  const placeholders = [];
  const hold = (html) => `\u0000${placeholders.push(html) - 1}\u0000`;
  let text = String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, alt) => hold(escapeBrowserHtml(alt)))
    .replace(/`([^`]+)`/g, (_match, code) => hold(`<code>${escapeBrowserHtml(code)}</code>`))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, href) => {
      const safeHref = sanitizeBrowserHref(href);
      return hold(safeHref ? `<a href="${escapeBrowserHtml(safeHref)}">${escapeBrowserHtml(label)}</a>` : escapeBrowserHtml(label));
    });
  text = escapeBrowserHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return text.replace(/\u0000(\d+)\u0000/g, (_match, index) => placeholders[Number(index)] || "");
}

function browserMarkdownToHtml(markdown, warnings = []) {
  const lines = String(markdown || "").replace(/^\ufeff/, "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let list = "";
  let removedImages = false;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${browserMarkdownInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (list) output.push(`</${list}>`);
    list = "";
  };
  for (const rawLine of lines) {
    const line = rawLine.replace(/!\[[^\]]*\]\([^)]*\)/g, (match) => {
      removedImages = true;
      return match;
    });
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); closeList(); output.push(`<h${heading[1].length}>${browserMarkdownInline(heading[2])}</h${heading[1].length}>`); continue; }
    const item = /^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (item) {
      flushParagraph();
      const nextList = item[2] ? "ol" : "ul";
      if (nextList !== list) { closeList(); list = nextList; output.push(`<${list}>`); }
      output.push(`<li>${browserMarkdownInline(item[3])}</li>`);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) { flushParagraph(); closeList(); output.push(`<blockquote>${browserMarkdownInline(quote[1])}</blockquote>`); continue; }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { flushParagraph(); closeList(); output.push("<hr>"); continue; }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  if (removedImages) warnings.push({
    code: "browser-assets-omitted",
    message: "浏览器预览无法读取 Markdown 旁的相对图片，图片已移除；桌面端可完整导入。",
  });
  return output.join("\n") || "<p></p>";
}

function browserTextToHtml(text) {
  return String(text || "").replace(/^\ufeff/, "").replace(/\r\n?/g, "\n").split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeBrowserHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("\n") || "<p></p>";
}

function createBrowserImportedDocument({ title, author = "", html, footnotes = [], citationSources = [] }) {
  const now = new Date().toISOString();
  return {
    version: 2,
    documentId: browserRandomId(),
    derivedFrom: "",
    footnotes,
    citationSources,
    title: String(title || "导入的信笺").trim().slice(0, 200) || "导入的信笺",
    author: String(author || "").trim().slice(0, 100),
    html: String(html || "<p></p>"),
    comments: [],
    createdAt: now,
    updatedAt: now,
  };
}

function pickImportDocumentInBrowser() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.html,.htm,.txt,text/markdown,text/html,text/plain";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", handleWindowFocus, true);
      resolve(value);
    };
    const handleWindowFocus = () => window.setTimeout(() => {
      if (!input.files?.length) finish({ canceled: true });
    }, 250);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { finish({ canceled: true }); return; }
      const extension = file.name.toLowerCase().split(".").pop();
      const format = ["md", "markdown"].includes(extension) ? "markdown"
        : (["html", "htm"].includes(extension) ? "html" : (extension === "txt" ? "txt" : ""));
      if (!format) { finish({ canceled: false, error: "unsupported-type" }); return; }
      if (file.size > BROWSER_IMPORT_MAX_BYTES) {
        finish({ canceled: false, error: "too-large", maxBytes: BROWSER_IMPORT_MAX_BYTES });
        return;
      }
      try {
        const text = await file.text();
        const warnings = [];
        let html = "<p></p>";
        let title = file.name.replace(/\.[^.]+$/, "") || "导入的信笺";
        let author = "";
        if (format === "markdown") html = browserMarkdownToHtml(text, warnings);
        else if (format === "txt") html = browserTextToHtml(text);
        else {
          if (typeof DOMParser !== "undefined") {
            const parsed = new DOMParser().parseFromString(text, "text/html");
            title = parsed.title?.trim() || title;
            author = parsed.querySelector('meta[name="author" i]')?.getAttribute("content") || "";
          }
          html = sanitizeBrowserImportedHtml(text, warnings);
        }
        finish({
          canceled: false,
          format,
          document: createBrowserImportedDocument({ title, author, html }),
          warnings,
        });
      } catch (error) {
        finish({ canceled: false, error: "read-failed", message: error?.message || "读取导入文件失败" });
      }
    };
    window.addEventListener("focus", handleWindowFocus, true);
    input.click();
  });
}

function stripBrowserExportImages(html, warnings) {
  if (!/<img\b/i.test(String(html || ""))) return String(html || "");
  warnings.push({
    code: "browser-assets-omitted",
    message: "浏览器预览无法同时下载 .assets 目录，图片已降级为替代文字；桌面端可完整导出。",
  });
  return String(html || "").replace(/<img\b([^>]*)>/gi, (_match, attributes) => {
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
    return escapeBrowserHtml(alt?.[1] || alt?.[2] || "");
  });
}

function browserReferenceText(item) {
  const author = Array.isArray(item?.authors) ? item.authors.join("，") : (item?.author || "");
  return [author, item?.title || item?.text, item?.containerTitle, item?.publisher, item?.year].filter(Boolean).join(". ") || "未命名来源";
}

function browserKnowledgeSnapshot(body, documentValue = {}) {
  let cleanBody = String(body || "")
    .replace(/<section\b(?=[^>]*\bdata-(?:footnote-list|footnotes)\b)[^>]*>[\s\S]*?<\/section>/gi, "")
    .replace(/<section\b(?=[^>]*\bdata-(?:reference-list|references)\b)[^>]*>[\s\S]*?<\/section>/gi, "");
  const bibliographyEnabled = /\bdata-reference-list\b/i.test(String(body || ""));
  const footnoteById = new Map((Array.isArray(documentValue.footnotes) ? documentValue.footnotes : []).map((item) => [String(item?.id || ""), item]));
  const sourceById = new Map((Array.isArray(documentValue.citationSources) ? documentValue.citationSources : []).map((item) => [String(item?.id || ""), item]));
  const footnoteNumbers = new Map();
  const citationNumbers = new Map();
  cleanBody = cleanBody.replace(/<sup\b([^>]*\bdata-footnote-(?:id|ref)\s*=\s*(?:"[^"]*"|'[^']*')[^>]*)>[\s\S]*?<\/sup>/gi, (_match, attrs) => {
    const id = /\bdata-footnote-id\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)?.slice(1).find(Boolean)
      || /\bdata-footnote-ref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)?.slice(1).find(Boolean) || "";
    if (!footnoteNumbers.has(id)) footnoteNumbers.set(id, footnoteNumbers.size + 1);
    return `<sup ${attrs}>${footnoteNumbers.get(id)}</sup>`;
  });
  cleanBody = cleanBody.replace(/<span\b([^>]*\bdata-citation-source-id\s*=\s*(?:"[^"]*"|'[^']*')[^>]*)>[\s\S]*?<\/span>/gi, (_match, attrs) => {
    const id = /\bdata-citation-source-id\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)?.slice(1).find(Boolean) || "";
    const pages = /\bdata-citation-pages\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs)?.slice(1).find(Boolean) || "";
    if (!citationNumbers.has(id)) citationNumbers.set(id, citationNumbers.size + 1);
    const number = citationNumbers.get(id);
    return `<span ${attrs}>[${number}${pages ? `，第 ${escapeBrowserHtml(pages)} 页` : ""}]</span>`;
  });
  return {
    body: cleanBody,
    bibliographyEnabled,
    footnotes: [...footnoteNumbers.keys()].map((id) => footnoteById.get(id)).filter(Boolean).slice(0, 5000),
    sources: [...citationNumbers.keys()].map((id) => sourceById.get(id)).filter(Boolean).slice(0, 5000),
  };
}

function appendBrowserSemanticSections(body, footnotes = [], sources = [], bibliographyEnabled = false) {
  const footnoteSection = footnotes.length ? `<section data-footnotes="true"><h2>脚注</h2><ol>${footnotes.map((item) => (
    `<li data-footnote-id="${escapeBrowserHtml(item?.id)}">${escapeBrowserHtml(item?.text)}</li>`
  )).join("")}</ol></section>` : "";
  const snapshot = escapeBrowserHtml(JSON.stringify(sources));
  const sourceSection = bibliographyEnabled ? `<section data-references="true" data-reference-list="${snapshot}"><h2>参考文献</h2>${sources.length ? `<ol>${sources.map((item) => (
    `<li data-citation-source-id="${escapeBrowserHtml(item?.id)}">${escapeBrowserHtml(browserReferenceText(item))}</li>`
  )).join("")}</ol>` : "<p>暂无正文引用</p>"}</section>` : "";
  return `${body}${footnoteSection}${sourceSection}`;
}

function browserHtmlToMarkdown(html) {
  if (typeof DOMParser === "undefined") return plainTextFromBrowserHtml(html);
  const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
  const render = (node, context = {}) => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node;
    const tag = element.tagName.toLowerCase();
    const children = [...element.childNodes].map((child) => render(child, { ...context, tag })).join("");
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${children}**`;
    if (tag === "em" || tag === "i") return `*${children}*`;
    if (tag === "s" || tag === "del") return `~~${children}~~`;
    if (tag === "code" && context.tag !== "pre") return `\`${children}\``;
    if (tag === "pre") return `\n\`\`\`\n${element.textContent || ""}\n\`\`\`\n`;
    if (tag === "sup" && (element.hasAttribute("data-footnote-id") || element.hasAttribute("data-footnote-ref"))) {
      const id = element.getAttribute("data-footnote-id") || element.getAttribute("data-footnote-ref") || "";
      return `[^${id}]`;
    }
    if (tag === "span" && element.hasAttribute("data-citation-source-id")) {
      const id = element.getAttribute("data-citation-source-id") || "";
      const pages = element.getAttribute("data-citation-pages") || "";
      return `[${children.replace(/^\[|\]$/g, "")}](#jianjian-citation=${encodeURIComponent(id)}${pages ? `&pages=${encodeURIComponent(pages)}` : ""})`;
    }
    if (/^h[1-6]$/.test(tag)) return `\n${"#".repeat(Number(tag[1]))} ${children.trim()}\n\n`;
    if (tag === "a") {
      const href = sanitizeBrowserHref(element.getAttribute("href"));
      return href ? `[${children}](${href})` : children;
    }
    if (tag === "li") {
      const ordered = element.parentElement?.tagName === "OL";
      const index = ordered ? [...element.parentElement.children].indexOf(element) + 1 : 0;
      return `${ordered ? `${index}.` : "-"} ${children.trim()}\n`;
    }
    if (tag === "blockquote") return `\n${children.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    if (tag === "hr") return "\n---\n\n";
    if (["p", "div", "section", "figure", "figcaption", "tr"].includes(tag)) return `\n${children.trim()}\n`;
    if (["table", "thead", "tbody", "tfoot", "ul", "ol"].includes(tag)) return `\n${children}\n`;
    if (["td", "th"].includes(tag)) return `${children.trim()}\t`;
    return children;
  };
  return render(parsed.body).replace(/\n{3,}/g, "\n\n").trim();
}

function createBrowserEditableExport(documentValue = {}, format = "html") {
  if (!BROWSER_EXPORT_FORMATS.has(format)) {
    throw new Error(format === "docx"
      ? "浏览器预览暂不支持 DOCX 导出，请使用桌面版完成导出"
      : "浏览器预览不支持这种导出格式");
  }
  const warnings = [];
  const safeBody = canonicalizeBrowserExportPageBreaks(sanitizeBrowserImportedHtml(documentValue.html || "<p></p>", warnings));
  const semantics = browserKnowledgeSnapshot(safeBody, documentValue);
  const contentBody = stripBrowserExportImages(semantics.body, warnings);
  const body = appendBrowserSemanticSections(contentBody, semantics.footnotes, semantics.sources, semantics.bibliographyEnabled);
  if (format === "txt") {
    const sections = [plainTextFromBrowserHtml(contentBody).trim()];
    if (semantics.footnotes.length) sections.push(`脚注\n${semantics.footnotes.map((item, index) => `${index + 1}. ${item.text || "脚注内容缺失"}`).join("\n")}`);
    if (semantics.bibliographyEnabled) sections.push(`参考文献\n${semantics.sources.length ? semantics.sources.map((item, index) => `[${index + 1}] ${browserReferenceText(item)}`).join("\n") : "暂无正文引用"}`);
    return { content: `${sections.filter(Boolean).join("\n\n")}\n`, type: "text/plain;charset=utf-8", extension: ".txt", warnings };
  }
  if (format === "markdown") {
    const sections = [browserHtmlToMarkdown(contentBody)];
    if (semantics.footnotes.length) sections.push(semantics.footnotes.map((item) => `[^${item.id}]: ${String(item.text || "脚注内容缺失").replace(/\n/g, " ")}`).join("\n"));
    if (semantics.bibliographyEnabled) sections.push(`<!-- jianjian:auto-bibliography -->\n\n## 参考文献\n\n${semantics.sources.length ? semantics.sources.map((item, index) => `${index + 1}. ${browserReferenceText(item)}`).join("\n") : "暂无正文引用"}`);
    return { content: `${sections.filter(Boolean).join("\n\n")}\n`, type: "text/markdown;charset=utf-8", extension: ".md", warnings };
  }
  const title = escapeBrowserHtml(documentValue.title || "未命名信笺");
  const author = escapeBrowserHtml(documentValue.author || "");
  const content = `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${author ? `<meta name="author" content="${author}">` : ""}</head><body><article>${body}</article></body></html>\n`;
  return { content, type: "text/html;charset=utf-8", extension: ".html", warnings };
}

function downloadBrowserBlob(content, type, fileName) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function browserDiskRevision(documentValue) {
  const serialized = JSON.stringify(documentValue ?? null);
  const bytes = new TextEncoder().encode(serialized);
  let sha256 = "";
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } else {
    let hash = 0x811c9dc5;
    bytes.forEach((byte) => { hash ^= byte; hash = Math.imul(hash, 0x01000193); });
    sha256 = (hash >>> 0).toString(16).padStart(8, "0").repeat(8);
  }
  return { size: bytes.byteLength, mtimeMs: Date.now(), sha256 };
}

function sameBrowserRevision(left, right) {
  return Boolean(left && right)
    && Number(left.size) === Number(right.size)
    && Number(left.mtimeMs) === Number(right.mtimeMs)
    && String(left.sha256 || "") === String(right.sha256 || "");
}

function browserRevisionMap() {
  const value = readJson("paperwriter.preview.revisions", {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function storeBrowserRevision(filePath, revision) {
  const revisions = browserRevisionMap();
  revisions[String(filePath || "browser-preview.letterpaper").slice(0, 2048)] = revision;
  writeJson("paperwriter.preview.revisions", revisions);
}

function legacyBrowserResearchKey(workspacePath) {
  return `paperwriter.preview.research.${String(workspacePath || "default").slice(0, 2048)}`;
}

function browserSourcesKey(workspacePath) {
  return `paperwriter.preview.sources.${String(workspacePath || "default").slice(0, 2048)}`;
}

function browserCitationId() {
  const generated = globalThis.crypto?.randomUUID?.();
  if (BROWSER_UUID_PATTERN.test(String(generated || ""))) return generated.toLowerCase();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function browserTimestamp(value, fallback = "") {
  const timestamp = String(value || "").trim().slice(0, 64);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : fallback;
}

function normalizeBrowserResearchSource(source = {}) {
  if (!BROWSER_RESEARCH_TYPES.has(source.type)) return null;
  const type = source.type;
  const safeUrl = type === "web" ? normalizeBrowserExternalUrl(source.url) : "";
  return {
    kind: "research",
    id: String(source.id || browserRandomId()).slice(0, 128),
    type,
    title: String(source.title || "网页来源").trim().slice(0, 200) || "未命名资料",
    url: safeUrl && /^https?:/i.test(safeUrl) ? safeUrl : "",
    notes: String(source.notes || "").slice(0, 200_000),
    storage: "browser",
    createdAt: String(source.createdAt || new Date().toISOString()).slice(0, 64),
    updatedAt: String(source.updatedAt || new Date().toISOString()).slice(0, 64),
    missing: false,
  };
}

function normalizeBrowserCitationSource(source = {}, { generateId = true } = {}) {
  const rawId = String(source?.id || "").trim().toLowerCase();
  const id = BROWSER_UUID_PATTERN.test(rawId) ? rawId : (generateId ? browserCitationId() : "");
  if (!id) return null;
  const rawUrl = String(source?.url || "").trim().slice(0, 2048);
  const normalizedUrl = rawUrl ? normalizeBrowserExternalUrl(rawUrl) : "";
  const url = normalizedUrl && /^https?:/i.test(normalizedUrl) ? normalizedUrl : "";
  const authors = (Array.isArray(source?.authors)
    ? source.authors
    : (typeof source?.authors === "string" ? source.authors.split(/[;,；，]/) : []))
    .slice(0, 100).map((author) => String(author || "").trim().slice(0, 200)).filter(Boolean);
  const now = new Date().toISOString();
  const createdAt = browserTimestamp(source?.createdAt, now);
  return {
    version: 1,
    kind: "citation",
    id,
    type: BROWSER_CITATION_TYPES.has(source?.type) ? source.type : "other",
    title: String(source?.title || "").trim().slice(0, 1000),
    authors,
    year: String(source?.year ?? "").trim().slice(0, 32),
    containerTitle: String(source?.containerTitle || "").trim().slice(0, 1000),
    publisher: String(source?.publisher || "").trim().slice(0, 500),
    url,
    doi: String(source?.doi || "").trim().slice(0, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
    isbn: String(source?.isbn || "").trim().slice(0, 64),
    accessedAt: browserTimestamp(source?.accessedAt, ""),
    pages: String(source?.pages || "").trim().slice(0, 128),
    notes: String(source?.notes || "").trim().slice(0, 10_000),
    ...normalizeCitationResearchIdentity(source),
    createdAt,
    updatedAt: browserTimestamp(source?.updatedAt, createdAt),
  };
}

function listBrowserSources(workspacePath) {
  const current = readJson(browserSourcesKey(workspacePath), null);
  const source = Array.isArray(current) ? current : readJson(legacyBrowserResearchKey(workspacePath), []);
  return (Array.isArray(source) ? source : []).slice(0, BROWSER_SOURCE_LIMIT).flatMap((item) => {
    if (item?.kind === "citation") {
      const citation = normalizeBrowserCitationSource(item, { generateId: false });
      return citation ? [citation] : [];
    }
    if (item?.kind && item.kind !== "research") return [];
    const normalized = normalizeBrowserResearchSource(item);
    return normalized ? [normalized] : [];
  });
}

function listBrowserResearch(workspacePath) {
  return listBrowserSources(workspacePath).filter((source) => source.kind === "research");
}

function listBrowserCitations(workspacePath) {
  return listBrowserSources(workspacePath).filter((source) => source.kind === "citation");
}

function saveBrowserSources(workspacePath, sources) {
  if (sources.length > BROWSER_SOURCE_LIMIT) throw new Error("工作区资料与参考文献来源数量已达上限");
  writeJson(browserSourcesKey(workspacePath), sources);
  localStorage.removeItem(legacyBrowserResearchKey(workspacePath));
  emitBrowserEvent(browserWorkspaceChangedListeners, { rootPath: workspacePath || "", kind: "sources" });
}

function normalizeBrowserResearchLibraryId(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!BROWSER_UUID_PATTERN.test(id)) throw new Error("资料库标识必须是 UUID");
  return id;
}

function normalizeBrowserResearchRelativePath(value, { allowEmpty = true } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (allowEmpty) return "";
    throw new Error("缺少资料相对路径");
  }
  if (raw.length > 32768 || /^[a-zA-Z]:/.test(raw) || /^[/\\]{1,2}/.test(raw) || raw.includes("\0")) {
    throw new Error("资料操作只接受相对路径");
  }
  const segments = raw.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("资料相对路径无效或越过根目录");
  }
  if (segments.some((segment) => segment.toLocaleLowerCase("en-US") === ".jianjian")) {
    throw new Error(".jianjian 是笺间保留目录");
  }
  return segments.join("/");
}

function normalizeBrowserResearchEntryName(value) {
  const name = String(value ?? "").trim();
  if (!name || name === "." || name === ".." || name.length > 240) throw new Error("资料项目名称无效");
  if (/[\u0000-\u001f\u007f\\/:*?"<>|]/.test(name) || /[. ]$/.test(name)) {
    throw new Error("资料项目名称包含不受支持的字符");
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error("资料项目名称属于系统保留名称");
  }
  if (name.toLocaleLowerCase("en-US") === ".jianjian") throw new Error(".jianjian 是笺间保留目录");
  return name;
}

function browserResearchLibrarySourcesKey(libraryId) {
  return `paperwriter.preview.research-library.${normalizeBrowserResearchLibraryId(libraryId)}.sources`;
}

function browserResearchWebTreeKey(libraryId) {
  return `paperwriter.preview.research-library.${normalizeBrowserResearchLibraryId(libraryId)}.web-tree`;
}

function normalizeBrowserWebTree(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const folders = (Array.isArray(input.folders) ? input.folders : []).slice(0, 2000).map((folder) => {
    const id = String(folder?.id || "").trim().toLowerCase();
    const parentId = String(folder?.parentId || "").trim().toLowerCase();
    if (!BROWSER_UUID_PATTERN.test(id) || (parentId && !BROWSER_UUID_PATTERN.test(parentId))) throw new Error("网页文件夹标识无效");
    const name = browserLibraryText(folder?.name, 120);
    if (!name) throw new Error("网页文件夹名称不能为空");
    return {
      id,
      name,
      parentId,
      scopeKey: "global",
      createdAt: browserTimestamp(folder?.createdAt, new Date().toISOString()),
      updatedAt: browserTimestamp(folder?.updatedAt, folder?.createdAt || new Date().toISOString()),
    };
  });
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  const depthFor = (folder, visiting = new Set()) => {
    if (visiting.has(folder.id)) throw new Error("网页文件夹层级存在循环");
    if (!folder.parentId) return 1;
    const parent = folderMap.get(folder.parentId);
    if (!parent) throw new Error("网页文件夹父级不存在");
    visiting.add(folder.id);
    const depth = depthFor(parent, visiting) + 1;
    visiting.delete(folder.id);
    if (depth > 16) throw new Error("网页文件夹最多支持 16 层");
    return depth;
  };
  folders.forEach((folder) => depthFor(folder));
  const placements = {};
  for (const [sourceId, placement] of Object.entries(input.placements && typeof input.placements === "object" ? input.placements : {})) {
    if (!BROWSER_UUID_PATTERN.test(sourceId)) continue;
    const folderId = String(placement?.folderId || "").trim().toLowerCase();
    if (folderId && !folderMap.has(folderId)) throw new Error("网页位置指向不存在的文件夹");
    placements[sourceId] = { scopeKey: "global", folderId };
  }
  return { version: 1, folders, placements };
}

function listBrowserResearchWebTree(libraryId) {
  const id = normalizeBrowserResearchLibraryId(libraryId);
  const stored = readJson(browserResearchWebTreeKey(id), null);
  if (!stored) return { libraryId: id, tree: { version: 1, folders: [], placements: {} }, folders: [], placements: {}, diskRevision: null, warnings: [], readOnly: false, browserOnly: true };
  try {
    const tree = normalizeBrowserWebTree(stored.tree || stored);
    const diskRevision = normalizeBrowserLibraryRevision(stored.diskRevision);
    return { libraryId: id, tree, folders: tree.folders, placements: tree.placements, diskRevision, warnings: [], readOnly: false, browserOnly: true };
  } catch (error) {
    const tree = { version: 1, folders: [], placements: {} };
    return { libraryId: id, tree, folders: [], placements: {}, diskRevision: normalizeBrowserLibraryRevision(stored.diskRevision), warnings: [{ file: "web-tree.json", message: error?.message || "网页树索引无法读取" }], readOnly: true, browserOnly: true };
  }
}

async function mutateBrowserResearchWebTree(libraryId, expectedRevision, mutate) {
  const current = listBrowserResearchWebTree(libraryId);
  if (!sameBrowserLibraryRevision(current.diskRevision, expectedRevision)) {
    return browserResearchRevisionConflict(libraryId, expectedRevision, current.diskRevision, "网页树已在另一个页面中被修改，请重新载入");
  }
  if (current.readOnly) throw new Error("网页树索引已损坏，修复前不能修改分组");
  const tree = normalizeBrowserWebTree(await mutate(structuredClone(current.tree)) || current.tree);
  const diskRevision = await browserDiskRevision(tree);
  writeJson(browserResearchWebTreeKey(current.libraryId), { tree, diskRevision });
  emitBrowserEvent(browserResearchLibraryChangedListeners, { libraryId: current.libraryId, relativePath: "", browserOnly: true });
  return { ok: true, libraryId: current.libraryId, tree, folders: tree.folders, placements: tree.placements, diskRevision, warnings: [], readOnly: false, browserOnly: true };
}

function browserLibraryText(value, maximum = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeBrowserLibraryRevision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const revision = {
    size: Number(value.size),
    mtimeMs: Number(value.mtimeMs),
    sha256: String(value.sha256 || "").toLowerCase(),
  };
  return Number.isSafeInteger(revision.size) && revision.size >= 0
    && Number.isFinite(revision.mtimeMs) && revision.mtimeMs >= 0
    && /^[a-f0-9]{64}$/.test(revision.sha256)
    ? revision
    : null;
}

function sameBrowserLibraryRevision(left, right) {
  const normalizedLeft = normalizeBrowserLibraryRevision(left);
  const normalizedRight = normalizeBrowserLibraryRevision(right);
  if (!normalizedLeft || !normalizedRight) return normalizedLeft === normalizedRight;
  return normalizedLeft.size === normalizedRight.size
    && normalizedLeft.mtimeMs === normalizedRight.mtimeMs
    && normalizedLeft.sha256 === normalizedRight.sha256;
}

function normalizeBrowserLibraryBibliographic(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    authors: (Array.isArray(input.authors) ? input.authors : [])
      .slice(0, 100)
      .map((author) => browserLibraryText(author, 200))
      .filter(Boolean),
    year: browserLibraryText(String(input.year ?? ""), 32),
    containerTitle: browserLibraryText(input.containerTitle || input.publication, 1000),
    publisher: browserLibraryText(input.publisher, 500),
    doi: browserLibraryText(input.doi, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
    isbn: browserLibraryText(input.isbn, 64),
    pages: browserLibraryText(input.pages, 128),
  };
}

function normalizeBrowserLibrarySource(input = {}, {
  previous = null,
  generateId = true,
  touch = true,
} = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (raw.type === "file") throw new Error("浏览器预览不能访问或登记本地资料文件；请使用桌面版");
  const type = BROWSER_RESEARCH_LIBRARY_SOURCE_TYPES.has(raw.type)
    ? raw.type
    : (BROWSER_RESEARCH_LIBRARY_SOURCE_TYPES.has(previous?.type) ? previous.type : "");
  if (!type) throw new Error("资料来源仅支持网页");
  const requestedId = String(previous?.id || raw.id || "").trim().toLowerCase();
  const id = BROWSER_UUID_PATTERN.test(requestedId) ? requestedId : (generateId ? browserCitationId() : "");
  if (!id) throw new Error("资料来源标识必须是 UUID");
  const rawUrl = type === "web" ? String(raw.url ?? previous?.url ?? "").trim().slice(0, 4096) : "";
  const url = rawUrl ? normalizeBrowserExternalUrl(rawUrl) : "";
  if (type === "web") {
    let parsed = null;
    try { parsed = url ? new URL(url) : null; } catch { parsed = null; }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("资料网址仅支持不含账号信息的 HTTP 或 HTTPS 地址");
    }
  }
  const now = new Date().toISOString();
  const createdAt = browserTimestamp(previous?.createdAt || raw.createdAt, now);
  const source = {
    version: 1,
    kind: "research",
    id,
    type,
    title: browserLibraryText(raw.title ?? previous?.title, 500) || "未命名网页",
    url: type === "web" ? url : "",
    excerpt: browserLibraryText(raw.excerpt ?? previous?.excerpt, 200_000),
    notes: browserLibraryText(raw.notes ?? previous?.notes, 200_000),
    relativePath: "",
    mime: "",
    size: 0,
    bibliographic: normalizeBrowserLibraryBibliographic(raw.bibliographic ?? previous?.bibliographic),
    createdAt,
    updatedAt: touch ? now : browserTimestamp(raw.updatedAt || previous?.updatedAt, createdAt),
  };
  const diskRevision = normalizeBrowserLibraryRevision(raw.diskRevision || previous?.diskRevision);
  return diskRevision ? { ...source, diskRevision } : source;
}

function listBrowserResearchLibrarySources(libraryId) {
  const id = normalizeBrowserResearchLibraryId(libraryId);
  const stored = readJson(browserResearchLibrarySourcesKey(id), []);
  const storedSources = Array.isArray(stored) ? stored.slice(0, BROWSER_SOURCE_LIMIT) : [];
  const removedNoteSourceIds = storedSources
    .filter((source) => source?.type === "note")
    .map((source) => String(source?.id || ""))
    .filter(Boolean);
  if (removedNoteSourceIds.length) {
    writeJson(browserResearchLibrarySourcesKey(id), storedSources.filter((source) => source?.type !== "note"));
  }
  const warnings = [];
  const sources = storedSources.flatMap((source, index) => {
    if (source?.type === "note") return [];
    try {
      const normalized = normalizeBrowserLibrarySource(source, { generateId: false, touch: false });
      if (!normalized.diskRevision) throw new Error("资料来源缺少有效 revision");
      return [normalized];
    } catch (error) {
      warnings.push({ index, message: error?.message || "资料来源无法读取" });
      return [];
    }
  });
  return { libraryId: id, sources, warnings, removedNoteSourceIds };
}

function browserResearchRevisionConflict(libraryId, expectedRevision, actualRevision, message) {
  return {
    ok: false,
    conflict: true,
    code: "DOCUMENT_REVISION_CONFLICT",
    message: message || "资料来源已被其他页面修改，请重新载入",
    libraryId: normalizeBrowserResearchLibraryId(libraryId),
    expectedRevision: normalizeBrowserLibraryRevision(expectedRevision),
    actualRevision: normalizeBrowserLibraryRevision(actualRevision),
    browserOnly: true,
  };
}

function saveBrowserResearchLibrarySources(libraryId, sources, sourceId = "") {
  const id = normalizeBrowserResearchLibraryId(libraryId);
  if (!Array.isArray(sources) || sources.length > BROWSER_SOURCE_LIMIT) throw new Error("资料来源数量已达上限");
  writeJson(browserResearchLibrarySourcesKey(id), sources);
  emitBrowserEvent(browserResearchLibraryChangedListeners, {
    libraryId: id,
    eventType: "change",
    relativePath: sourceId ? `.jianjian/research-library/sources/${sourceId}.json` : "",
    changedAt: Date.now(),
    browserOnly: true,
  });
}

function browserResearchFileUnsupported(libraryId, relativePath = "", message = "浏览器预览不能访问本地资料目录") {
  return {
    canceled: true,
    unsupported: true,
    browserOnly: true,
    libraryId: normalizeBrowserResearchLibraryId(libraryId),
    relativePath: normalizeBrowserResearchRelativePath(relativePath),
    message,
  };
}

const BROWSER_RESEARCH_PREVIEW_LIBRARY_ID = "9f4d2b8b-9ab1-4c0d-8f60-0b50c8137f96";
const BROWSER_RESEARCH_PREVIEW_PDF_PATH = "阅读示例.pdf";
const BROWSER_RESEARCH_PREVIEW_TEXT_PATH = "阅读示例.txt";
const BROWSER_RESEARCH_PREVIEW_MARKDOWN_PATH = "scene.md";
const BROWSER_RESEARCH_PREVIEW_TABLE_PATH = "新建 Microsoft Excel 工作表.csv";

function browserResearchPreviewEnabled() {
  try {
    return new URLSearchParams(globalThis.window?.location?.search || "").get("researchPreview") === "1";
  } catch {
    return false;
  }
}

function browserResearchPreviewKind() {
  try {
    const requested = new URLSearchParams(globalThis.window?.location?.search || "").get("researchKind") || "pdf";
    return ["pdf", "markdown", "text", "table"].includes(requested) ? requested : "pdf";
  } catch {
    return "pdf";
  }
}

function createBrowserResearchPreviewTable() {
  const headers = ["项目", "负责人", "状态", "优先级", "开始日期", "截止日期", "进度", "字数", "来源", "标签", "备注", "下一步"];
  const rows = Array.from({ length: 28 }, (_, index) => [
    `研究任务 ${String(index + 1).padStart(2, "0")}`,
    index % 3 === 0 ? "林青" : index % 3 === 1 ? "周遥" : "陈墨",
    index % 4 === 0 ? "已完成" : index % 4 === 1 ? "进行中" : "待处理",
    ["高", "中", "低"][index % 3],
    `2026-07-${String((index % 20) + 1).padStart(2, "0")}`,
    `2026-08-${String((index % 20) + 1).padStart(2, "0")}`,
    `${Math.min(100, 20 + index * 3)}%`,
    String(1200 + index * 175),
    index % 2 ? "访谈记录" : "资料库",
    index % 2 ? "场景；人物" : "结构；引用",
    `第 ${index + 1} 行用于检查搜索与双向滚动`,
    index % 2 ? "补充摘录" : "整理章节",
  ]);
  return [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function browserResearchPreviewFixture() {
  const kind = browserResearchPreviewKind();
  if (kind === "table") {
    const text = createBrowserResearchPreviewTable();
    return { kind, path: BROWSER_RESEARCH_PREVIEW_TABLE_PATH, mime: "text/csv; charset=utf-8", text, size: new TextEncoder().encode(text).byteLength };
  }
  if (kind === "markdown") {
    const html = "<h1>场景资料</h1><p>这份 Markdown 示例用于检查资料搜索、缩放和排版。</p><h2>人物关系</h2><ul><li>林青负责整理场景。</li><li>周遥负责补充资料引用。</li></ul><blockquote>搜索“资料”可以在当前页面定位匹配内容。</blockquote>";
    return { kind, path: BROWSER_RESEARCH_PREVIEW_MARKDOWN_PATH, mime: "text/markdown; charset=utf-8", html, size: new TextEncoder().encode(html).byteLength };
  }
  if (kind === "text") {
    const text = Array.from({ length: 48 }, (_, index) => `第 ${index + 1} 行：这是一段用于检查文本搜索、缩放和滚动的资料内容。`).join("\n");
    return { kind, path: BROWSER_RESEARCH_PREVIEW_TEXT_PATH, mime: "text/plain; charset=utf-8", text, size: new TextEncoder().encode(text).byteLength };
  }
  return { kind: "pdf", path: BROWSER_RESEARCH_PREVIEW_PDF_PATH, mime: "application/pdf", size: createBrowserResearchPreviewPdf().byteLength };
}

function createBrowserResearchPreviewPdf() {
  const createPageContent = (pageNumber, lines) => [
    "BT",
    "/F1 24 Tf",
    "72 710 Td",
    `(Jianjian Research Preview - Page ${pageNumber}) Tj`,
    "0 -42 Td",
    "/F1 13 Tf",
    ...lines.flatMap((line) => [`(${line}) Tj`, "0 -24 Td"]),
    "ET",
  ].join("\n");
  const firstPageContent = createPageContent(1, [
    "Use the compact toolbar above to search, zoom, and cite.",
    "Arrow keys, PageUp, PageDown, Space, Home, and End turn pages.",
  ]);
  const secondPageContent = createPageContent(2, [
    "Keyboard navigation reached the second page.",
    "The research pane remains aligned with the document workspace.",
  ]);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${firstPageContent.length} >>\nstream\n${firstPageContent}\nendstream`,
    `<< /Length ${secondPageContent.length} >>\nstream\n${secondPageContent}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function ensureBrowserLifecycleListeners() {
  if (browserLifecycleListenersInstalled || typeof window === "undefined" || typeof document === "undefined") return;
  browserLifecycleListenersInstalled = true;
  window.addEventListener("focus", () => emitBrowserEvent(browserWindowFocusListeners, { focused: true }));
  window.addEventListener("blur", () => emitBrowserEvent(browserWindowBlurListeners, { focused: false }));
  window.addEventListener("storage", (event) => {
    if (String(event.key || "").startsWith("paperwriter.preview.")) {
      emitBrowserEvent(browserWorkspaceChangedListeners, { rootPath: "", kind: "storage" });
    }
    const libraryMatch = String(event.key || "").match(/^paperwriter\.preview\.research-library\.([0-9a-f-]{36})\.sources$/i);
    if (libraryMatch && BROWSER_UUID_PATTERN.test(libraryMatch[1])) {
      emitBrowserEvent(browserResearchLibraryChangedListeners, {
        libraryId: libraryMatch[1].toLowerCase(),
        eventType: "change",
        relativePath: ".jianjian/research-library/sources",
        changedAt: Date.now(),
        browserOnly: true,
      });
    }
  });
  document.addEventListener("fullscreenchange", () => {
    logicalBrowserFullscreen = Boolean(document.fullscreenElement);
    emitBrowserEvent(browserFullscreenListeners, { fullscreen: logicalBrowserFullscreen });
  });
}

function emitBrowserAi(type, payload) {
  browserAiListeners[type]?.forEach((callback) => callback(payload));
}

function emitBrowserExportProgress(payload) {
  browserExportProgressListeners.forEach((callback) => callback(payload));
}

function waitForBrowserPreview(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeBrowserAiConfig(config = readJson("paperwriter.aiConfig", {})) {
  return normalizeBrowserAiConfigValue(config);
}

function publicBrowserAiConfig(config = readJson("paperwriter.aiConfig", {})) {
  return publicBrowserAiConfigValue(config);
}

const browserBridge = {
  isElectron: false,
  getPaths: async () => ({
    desktop: "Browser preview",
    documents: "Browser preview",
    autosave: "localStorage:paperwriter.autosave",
    userData: "localStorage",
    aiDebugLog: "Browser preview",
  }),
  debugLog: async (event, data) => {
    console.debug("[paperwriter-debug]", event, data);
    return { ok: true };
  },
  setWindowModalOverlay: async () => ({ ok: true }),
  getAiConfig: async () => publicBrowserAiConfig(),
  refreshCodexCliStatus: async () => ({ ...publicBrowserAiConfig(), ok: false, message: "Codex CLI 仅在桌面端可用" }),
  startCodexCliLogin: async () => ({ ...publicBrowserAiConfig(), ok: false, message: "Codex CLI 仅在桌面端可用" }),
  onCodexCliStatus: () => () => {},
  createAiProvider: async (input = {}) => {
    const previous = normalizeBrowserAiConfig();
    if (Object.keys(previous.providers).length >= MAX_BROWSER_AI_PROVIDERS) throw new Error("供应商数量已达上限");
    const providerLabel = String(input.providerLabel || input.label || "").slice(0, 120).trim();
    if (!providerLabel) throw new Error("请填写供应商名称");
    if (Object.values(previous.providers).some((provider) => provider.providerLabel.toLocaleLowerCase() === providerLabel.toLocaleLowerCase())) {
      throw new Error("供应商名称已存在");
    }
    const protocol = hasOwn(BROWSER_AI_PROTOCOLS, input.protocol) ? input.protocol : "openai";
    const baseUrl = String(input.baseUrl || BROWSER_AI_PROTOCOLS[protocol].baseUrl).slice(0, 2048).trim().replace(/\/+$/, "");
    let parsed;
    try { parsed = new URL(baseUrl); } catch { throw new Error("请输入有效的 Base URL"); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Base URL 仅支持 HTTP 或 HTTPS");
    if (/\/(chat\/completions|messages)$/i.test(parsed.pathname.replace(/\/+$/, ""))) throw new Error("Base URL 不需要包含具体请求端点");
    const provider = `custom-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
    const next = normalizeBrowserAiConfig({
      ...previous,
      providers: { ...previous.providers, [provider]: { provider, providerLabel, protocol, builtin: false, baseUrl, apiKey: "", activeModelId: "", models: [] } },
    });
    writeJson("paperwriter.aiConfig", next);
    return { ...publicBrowserAiConfig(next), createdProvider: provider, ok: true };
  },
  deleteAiProvider: async (provider) => {
    const previous = normalizeBrowserAiConfig();
    const safeProvider = safeBrowserProviderId(provider);
    const target = safeProvider && hasOwn(previous.providers, safeProvider) ? previous.providers[safeProvider] : null;
    if (!target) throw new Error("供应商不存在");
    if (target.builtin) throw new Error("内置供应商不可删除");
    if (previous.activeProvider === safeProvider) throw new Error("请先切换默认供应商后再删除");
    const providers = Object.assign(Object.create(null), previous.providers);
    delete providers[safeProvider];
    const next = normalizeBrowserAiConfig({ ...previous, providers });
    writeJson("paperwriter.aiConfig", next);
    return { ...publicBrowserAiConfig(next), ok: true };
  },
  saveAiConfig: async (config = {}) => {
    const previous = normalizeBrowserAiConfig();
    let nextTaskModels = previous.taskModels;
    if (config.taskModels && typeof config.taskModels === "object" && !Array.isArray(config.taskModels)) {
      const taskModelsPatch = { ...config.taskModels };
      if (hasOwn(taskModelsPatch, "applyResolver")) {
        const source = taskModelsPatch.applyResolver;
        if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("任务模型配置无效");
        taskModelsPatch.applyResolver = {
          ...source,
          requestParams: validateBrowserAiRequestParamsPatch(source.requestParams || {}),
        };
      }
      nextTaskModels = normalizeBrowserAiConfigValue({
        ...previous,
        taskModels: { ...previous.taskModels, ...taskModelsPatch },
      }).taskModels;
      if (hasOwn(config.taskModels, "applyResolver")) {
        const assignment = nextTaskModels.applyResolver;
        if (assignment.providerId || assignment.modelId) {
          const exact = exactBrowserAiProviderConfig(previous, assignment);
          if (!exact || exact.provider.transport === "codex-cli" || !exact.provider.apiKey || !exact.model.testedOk) {
            throw new Error("任务模型只能选择已连接供应商中的已连接模型");
          }
        }
      }
    }
    const requestedProvider = safeBrowserProviderId(config.provider);
    const provider = requestedProvider && hasOwn(previous.providers, requestedProvider) ? requestedProvider : previous.activeProvider;
    const providerPrevious = previous.providers[provider];
    if (Array.isArray(config.models)) {
      config.models.forEach((model) => validateBrowserAiRequestParamsPatch(model?.requestParams || {}));
    }
    const nextProviderLabel = providerPrevious.builtin ? providerPrevious.providerLabel : String(config.providerLabel ?? providerPrevious.providerLabel).slice(0, 120).trim();
    if (!nextProviderLabel) throw new Error("请填写供应商名称");
    if (!providerPrevious.builtin && Object.values(previous.providers).some((item) => item.provider !== provider && item.providerLabel.toLocaleLowerCase() === nextProviderLabel.toLocaleLowerCase())) throw new Error("供应商名称已存在");
    const hasModelPatch = Boolean(config.modelId || config.model || (Array.isArray(config.models) && config.models.length));
    const modelId = hasModelPatch ? (config.modelId || providerPrevious.activeModelId || browserModelId(provider, config.model || providerPrevious.model)) : "";
    const previousModels = Array.isArray(config.models)
      ? config.models.slice(0, MAX_BROWSER_AI_MODELS).map((model, index) => normalizeBrowserModelConfig(provider, model, index))
      : providerPrevious.models;
    const existingModel = previousModels.find((model) => model.id === modelId);
    const nextModel = hasModelPatch ? normalizeBrowserModelConfig(provider, {
      ...(existingModel || {}),
      id: modelId,
      name: config.modelName || existingModel?.name,
      model: config.model || existingModel?.model,
      testedOk: (config.resetTest || config.clearApiKey) ? false : existingModel?.testedOk,
      testedAt: (config.resetTest || config.clearApiKey) ? "" : existingModel?.testedAt,
      testMessage: (config.resetTest || config.clearApiKey) ? "" : existingModel?.testMessage,
    }) : null;
    const updatedModels = !nextModel ? previousModels : (existingModel
      ? previousModels.map((model) => (model.id === modelId ? nextModel : model))
      : [...previousModels, nextModel]);
    const previousModelsById = new Map((providerPrevious.models || []).map((model) => [model.id, model]));
    const nextModels = updatedModels.map((model) => {
      const previousModel = previousModelsById.get(model.id);
      const requestParamsChanged = Boolean(previousModel)
        && JSON.stringify(previousModel.requestParams || {}) !== JSON.stringify(model.requestParams || {});
      return config.clearApiKey || config.resetTest || requestParamsChanged
        ? { ...model, testedOk: false, testedAt: "", testMessage: "" }
        : model;
    });
    const next = normalizeBrowserAiConfig({
      ...previous,
      taskModels: nextTaskModels,
      activeProvider: config.activate === true ? provider : previous.activeProvider,
      activeModelId: config.activate === true ? modelId : previous.activeModelId,
      providers: {
        ...previous.providers,
        [provider]: {
          ...providerPrevious,
          providerLabel: nextProviderLabel,
          baseUrl: typeof config.baseUrl === "string" ? config.baseUrl.slice(0, 2048) : providerPrevious.baseUrl,
          apiKey: config.clearApiKey ? "" : ((typeof config.apiKey === "string" ? config.apiKey.slice(0, 16384).trim() : "") || providerPrevious.apiKey || ""),
          activeModelId: config.activate === true ? modelId : providerPrevious.activeModelId,
          models: nextModels,
        },
      },
    });
    writeJson("paperwriter.aiConfig", next);
    return publicBrowserAiConfig(next);
  },
  testAiConfig: async (config = {}) => {
    const saved = normalizeBrowserAiConfig();
    const requestedProvider = safeBrowserProviderId(config.provider);
    const provider = requestedProvider && hasOwn(saved.providers, requestedProvider) ? requestedProvider : saved.activeProvider || "gemini";
    const providerSaved = saved.providers[provider] || {};
    const modelId = config.modelId || providerSaved.activeModelId || browserModelId(provider, config.model || providerSaved.model);
    const existingModel = providerSaved.models?.find((model) => model.id === modelId);
    const suppliedApiKey = typeof config.apiKey === "string" ? config.apiKey.slice(0, 16384).trim() : "";
    if (!suppliedApiKey && !providerSaved.apiKey) {
      return { ok: false, message: "浏览器预览需要先填写 API Key" };
    }
    const nextModel = normalizeBrowserModelConfig(provider, {
      ...(existingModel || {}),
      id: modelId,
      name: config.modelName || existingModel?.name,
      model: config.model || existingModel?.model || providerSaved.model,
      testedOk: true,
      testedAt: new Date().toISOString(),
      testMessage: "浏览器预览已测试",
    });
    const next = normalizeBrowserAiConfig({
      ...saved,
      taskModels: saved.taskModels,
      activeProvider: saved.activeProvider,
      activeModelId: saved.activeModelId,
      providers: {
        ...saved.providers,
        [provider]: {
          ...providerSaved,
          baseUrl: typeof config.baseUrl === "string" ? config.baseUrl.slice(0, 2048) : providerSaved.baseUrl,
          apiKey: suppliedApiKey || providerSaved.apiKey || "",
          models: existingModel
            ? providerSaved.models.map((model) => (model.id === modelId ? nextModel : model))
            : [...(providerSaved.models || []), nextModel],
        },
      },
    });
    writeJson("paperwriter.aiConfig", next);
    return { ...publicBrowserAiConfig(next), ok: true, message: "浏览器预览已保存配置，真实请求请在桌面端测试" };
  },
  generateAi: async (payload = {}) => {
    const requestId = payload.requestId || `browser-${Date.now()}`;
    const chunks = ["这是一段浏览器预览 AI 回复。", "\n\n", "桌面端会使用当前已测试的默认供应商和模型流式生成真实内容。"];
    chunks.forEach((delta, index) => {
      window.setTimeout(() => emitBrowserAi("chunk", { requestId, delta }), 120 * (index + 1));
    });
    window.setTimeout(() => emitBrowserAi("done", {
      requestId,
      usage: { prompt_tokens: 1200, completion_tokens: 320, total_tokens: 1520 },
    }), 120 * (chunks.length + 1));
    return { ok: true, requestId };
  },
  resolveAiApply: async (payload = {}) => ({
    ok: true,
    raw: {
      version: 1,
      action: "unresolved",
      targetBlockIds: [],
      confidence: 0,
      reason: "浏览器预览不会调用应用裁决模型；请在桌面端使用直接应用，或复制后手动粘贴。",
      ...(payload?.manifest?.documentFingerprint ? { documentFingerprint: String(payload.manifest.documentFingerprint).slice(0, 128) } : {}),
    },
  }),
  cancelAi: async (requestId) => {
    emitBrowserAi("error", { requestId, message: "已停止生成", aborted: true });
    return { ok: true };
  },
  exportAiChat: async (payload = {}) => {
    const blob = new Blob([payload.markdown || ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${payload.title || "AI问答"}.md`;
    link.click();
    URL.revokeObjectURL(url);
    return { canceled: false, path: link.download };
  },
  onAiChunk: (callback) => {
    browserAiListeners.chunk.add(callback);
    return () => browserAiListeners.chunk.delete(callback);
  },
  onAiDone: (callback) => {
    browserAiListeners.done.add(callback);
    return () => browserAiListeners.done.delete(callback);
  },
  onAiError: (callback) => {
    browserAiListeners.error.add(callback);
    return () => browserAiListeners.error.delete(callback);
  },
  openDocument: async () => ({ canceled: true }),
  openDocumentPath: async (filePath = "") => {
    const documentValue = readJson("paperwriter.preview.document", null);
    if (!documentValue || !String(filePath).startsWith("browser-preview")) return { canceled: true };
    const diskRevision = browserRevisionMap()[filePath] || await browserDiskRevision(documentValue);
    storeBrowserRevision(filePath, diskRevision);
    return { canceled: false, path: filePath, document: documentValue, diskRevision, readOnly: false };
  },
  importDocument: pickImportDocumentInBrowser,
  openFolder: async () => ({ canceled: true, files: [] }),
  listFolder: async () => ({ canceled: true, files: [], folders: [], entries: [] }),
  searchFolder: async (payload = {}) => {
    const requestId = String(payload.requestId || "").slice(0, 128);
    const query = String(payload.query || "").trim().slice(0, 1000);
    if (requestId && canceledBrowserSearches.delete(requestId)) {
      return { requestId, query, canceled: true, results: [], totalMatches: 0 };
    }
    if (!query) return { requestId, query, canceled: false, results: [], totalMatches: 0, browserOnly: true };
    const needle = query.toLocaleLowerCase();
    const overrides = Array.isArray(payload.overrides) ? payload.overrides.slice(0, 100) : [];
    const results = [];
    for (const item of overrides) {
      if (requestId && canceledBrowserSearches.has(requestId)) break;
      const documentValue = item?.document && typeof item.document === "object" ? item.document : {};
      const pathValue = String(item?.path || "").slice(0, 2048);
      const title = String(documentValue.title || pathValue.split(/[\\/]/).pop() || "未命名信笺").slice(0, 200);
      const author = String(documentValue.author || "").slice(0, 100);
      const body = plainTextFromBrowserHtml(documentValue.html || "").slice(0, 2_000_000);
      const fields = [pathValue.split(/[\\/]/).pop() || "", title, author, body];
      let matchedText = "";
      let matchIndex = -1;
      for (const field of fields) {
        const index = field.toLocaleLowerCase().indexOf(needle);
        if (index >= 0) { matchedText = field; matchIndex = index; break; }
      }
      if (matchIndex < 0) continue;
      const snippetStart = Math.max(0, matchIndex - 45);
      const snippetEnd = Math.min(matchedText.length, matchIndex + query.length + 75);
      results.push({
        path: pathValue,
        relativePath: pathValue,
        documentId: String(documentValue.documentId || ""),
        title,
        author,
        updatedAt: documentValue.updatedAt || "",
        snippet: matchedText.slice(snippetStart, snippetEnd),
        snippetMatchStart: matchIndex - snippetStart,
        snippetMatchLength: query.length,
        source: "override",
      });
      if (results.length >= Math.max(1, Math.min(500, Number(payload.limit) || 100))) break;
    }
    const canceled = requestId ? canceledBrowserSearches.delete(requestId) : false;
    return { requestId, query, canceled, results: canceled ? [] : results, totalMatches: canceled ? 0 : results.length, browserOnly: true };
  },
  cancelFolderSearch: async (_folderPath, requestId) => {
    const id = String(requestId || "").slice(0, 128);
    if (id) canceledBrowserSearches.add(id);
    return { ok: Boolean(id) };
  },
  getWorkspaceRelationships: async (payload = {}) => {
    const overrides = (Array.isArray(payload.overrides) ? payload.overrides : []).slice(0, 100);
    const records = overrides.map((item) => {
      const documentValue = item?.document && typeof item.document === "object" ? item.document : {};
      const documentId = String(documentValue.documentId || "").slice(0, 128);
      const links = [...String(documentValue.html || "").matchAll(/data-document-id=["']([0-9a-f-]{36})["']/gi)].map((match) => match[1]);
      const pathValue = String(item?.path || "").slice(0, 2048);
      return {
        documentId,
        needsIdentity: !documentId,
        title: String(documentValue.title || pathValue.split(/[\\/]/).pop() || "未命名信笺").slice(0, 200),
        path: pathValue,
        relativePath: pathValue,
        links: [...new Set(links)],
      };
    }).filter((record) => record.path);
    const byId = new Map();
    records.forEach((record) => {
      if (!record.documentId) return;
      const group = byId.get(record.documentId) || [];
      group.push(record);
      byId.set(record.documentId, group);
    });
    const currentId = String(payload.documentId || "");
    const currentPathKey = String(payload.currentPath || "").replace(/\\/g, "/").toLocaleLowerCase("en-US");
    const currentLinks = (Array.isArray(payload.currentLinks) ? payload.currentLinks : []).slice(0, 5000).map((link) => {
      const targetDocumentId = String(link?.targetDocumentId || link?.documentId || "").slice(0, 128);
      const target = byId.get(targetDocumentId)?.[0];
      return {
        ...link,
        documentId: targetDocumentId,
        targetDocumentId,
        title: target?.title || link?.title || "未知笺记",
        path: target?.path || "",
        relativePath: target?.relativePath || "",
        missing: !target,
      };
    }).filter((link) => link.targetDocumentId);
    return {
      rootPath: String(payload.folderPath || ""),
      documents: records.filter((record) => {
        const recordPathKey = String(record.path || "").replace(/\\/g, "/").toLocaleLowerCase("en-US");
        return (!currentId || record.documentId !== currentId) && (!currentPathKey || recordPathKey !== currentPathKey);
      }).map(({ links: _links, ...record }) => record),
      links: currentLinks,
      backlinks: currentId ? records.filter((record) => record.documentId !== currentId && record.links.includes(currentId)).map(({ links: _links, ...record }) => record) : [],
      duplicates: [...byId.values()].filter((group) => group.length > 1).flatMap((group) => group.slice(1).map(({ links: _links, ...record }) => record)),
      browserOnly: true,
    };
  },
  watchWorkspace: async (folderPath = "") => ({ ok: true, rootPath: String(folderPath || ""), browserOnly: true }),
  getDocumentRevision: async (filePath = "") => {
    const pathValue = String(filePath || "");
    let diskRevision = browserRevisionMap()[pathValue] || null;
    if (!diskRevision && pathValue.startsWith("browser-preview")) {
      const documentValue = readJson("paperwriter.preview.document", null);
      if (documentValue) {
        diskRevision = await browserDiskRevision(documentValue);
        storeBrowserRevision(pathValue, diskRevision);
      }
    }
    return { path: pathValue, diskRevision, browserOnly: true };
  },
  regenerateDocumentIdentity: async (filePath = "", force = false) => {
    const documentValue = readJson("paperwriter.preview.document", null);
    if (!documentValue || !String(filePath).startsWith("browser-preview")) {
      throw new Error("浏览器预览只能为本地预览文档重新生成身份");
    }
    const previousId = String(documentValue.documentId || "");
    const documentId = previousId && !force ? previousId : browserRandomId();
    const nextDocument = { ...documentValue, version: 2, documentId, derivedFrom: force ? previousId : (documentValue.derivedFrom || ""), footnotes: documentValue.footnotes || [], citationSources: documentValue.citationSources || [] };
    writeJson("paperwriter.preview.document", nextDocument);
    const diskRevision = await browserDiskRevision(nextDocument);
    storeBrowserRevision(filePath, diskRevision);
    return { ok: true, path: filePath, documentId, document: nextDocument, diskRevision, browserOnly: true };
  },
  copyFolderPath: async (folderPath) => {
    await navigator.clipboard?.writeText?.(folderPath || "");
    return { ok: Boolean(folderPath) };
  },
  showFolder: async () => ({ ok: false }),
  createFolder: async () => ({ ok: false, canceled: true }),
  createDocumentInFolder: async () => ({ ok: false, canceled: true }),
  renameEntry: async () => ({ ok: false, canceled: true }),
  deleteEntry: async () => ({ ok: false, canceled: true }),
  moveEntry: async () => ({ ok: false, canceled: true }),
  backupDocument: async () => ({ ok: false, canceled: true }),
  saveDocument: async (documentValue, currentPath = "", saveAs = false, _reservedPaths = [], expectedRevision = null, options = {}) => {
    assertBrowserResourcesArePersistable(documentValue);
    const pathValue = saveAs || !currentPath ? "browser-preview.letterpaper" : String(currentPath).slice(0, 2048);
    const existingRevision = browserRevisionMap()[pathValue] || null;
    if (!saveAs && expectedRevision && existingRevision && !sameBrowserRevision(expectedRevision, existingRevision) && options?.overwrite !== true) {
      const conflictCopyPath = `browser-preview-conflict-${new Date().toISOString().replace(/[:.]/g, "-")}.letterpaper`;
      writeJson(`paperwriter.preview.conflict.${Date.now()}`, documentValue);
      return { canceled: false, conflict: true, path: pathValue, diskRevision: existingRevision, conflictCopyPath, browserOnly: true };
    }
    writeJson("paperwriter.preview.document", documentValue);
    const diskRevision = await browserDiskRevision(documentValue);
    storeBrowserRevision(pathValue, diskRevision);
    emitBrowserEvent(browserWorkspaceChangedListeners, { rootPath: "", kind: "save", path: pathValue });
    return { canceled: false, path: pathValue, diskRevision, browserOnly: true };
  },
  saveTempDocument: async (document, tabId = "temp") => {
    assertBrowserResourcesArePersistable(document);
    const key = `paperwriter.preview.temp.${tabId || "temp"}`;
    writeJson(key, document);
    return { canceled: false, path: `browser-preview-${tabId || "temp"}.letterpaper` };
  },
  deleteTempDocument: async (tabId = "temp") => {
    localStorage.removeItem(`paperwriter.preview.temp.${tabId || "temp"}`);
    return { ok: true };
  },
  pickExportPath: async (format, suggestedName = "未命名信笺") => {
    if (format === "docx") throw new Error("浏览器预览暂不支持 DOCX 导出，请使用桌面版完成导出");
    const extension = ({ pdf: ".pdf", markdown: ".md", html: ".html", txt: ".txt" })[format] || "";
    return {
      canceled: false,
      format: ["images", "pdf", "markdown", "html", "txt"].includes(format) ? format : "pdf",
      path: format === "images" ? `${browserDownloadName(suggestedName)}-分页图片` : browserDownloadName(suggestedName, extension || ".pdf"),
      browserOnly: true,
    };
  },
  exportEditable: async (documentValue, format, targetPath = "") => {
    const result = createBrowserEditableExport(documentValue, String(format || "").toLowerCase());
    const fileName = browserDownloadName(targetPath || documentValue?.title || "未命名信笺", result.extension);
    downloadBrowserBlob(result.content, result.type, fileName);
    emitBrowserExportProgress({ format, percent: 100, message: `${String(format || "").toUpperCase()} 导出完成` });
    return { canceled: false, path: fileName, warnings: result.warnings, browserOnly: true };
  },
  exportPdf: async (_suggestedName, targetPath = "browser-preview.pdf") => {
    emitBrowserExportProgress({ format: "pdf", percent: 12, message: "正在整理信笺版面…" });
    await waitForBrowserPreview(180);
    emitBrowserExportProgress({ format: "pdf", percent: 78, message: "正在写入 PDF 文件…" });
    await waitForBrowserPreview(180);
    emitBrowserExportProgress({ format: "pdf", percent: 100, message: "PDF 导出完成" });
    return { canceled: false, path: targetPath };
  },
  exportPageImages: async (_suggestedName, pageRects, targetPath = "browser-preview-images") => {
    const total = Math.max(1, pageRects?.length || 1);
    emitBrowserExportProgress({ format: "images", percent: 8, message: `正在准备 ${total} 张分页图片…` });
    for (let index = 0; index < total; index += 1) {
      await waitForBrowserPreview(100);
      const completed = index + 1;
      emitBrowserExportProgress({
        format: "images",
        percent: Math.round(14 + (completed / total) * 86),
        message: `正在导出第 ${completed} / ${total} 张图片`,
        completed,
        total,
      });
    }
    return { canceled: false, path: targetPath, count: total };
  },
  onExportProgress: (callback) => {
    browserExportProgressListeners.add(callback);
    return () => browserExportProgressListeners.delete(callback);
  },
  pickImage: pickImageInBrowser,
  pickAudio: pickAudioInBrowser,
  pickVideo: pickVideoInBrowser,
  copyImageReference: async (payload = {}) => {
    const documentId = String(payload.documentId || "").trim().toLowerCase();
    const imageId = String(payload.imageId || "").trim().toLowerCase();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const number = Math.max(1, Math.min(5_000, Number.parseInt(payload.number, 10) || 1));
    if (!uuidPattern.test(documentId) || !uuidPattern.test(imageId)) return { ok: false, message: "图片引用身份无效" };
    const text = `图${number}`;
    const html = `<span data-paper-image-reference="true" data-image-id="${imageId}" data-image-number="${number}" data-missing="false" data-source-document-id="${documentId}">${text}</span>`;
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      })]);
      return { ok: true };
    }
    await navigator.clipboard?.writeText?.(text);
    return { ok: true, plainTextOnly: true };
  },
  openExternal: async (url) => {
    const safeUrl = normalizeBrowserExternalUrl(url);
    if (!safeUrl) return { ok: false, error: typeof url === "string" && url.length > 8192 ? "url-too-long" : "unsupported-or-invalid-url" };
    const opened = window.open(safeUrl, "_blank", "noopener,noreferrer");
    return opened === null ? { ok: false, error: "popup-blocked" } : { ok: true };
  },
  showResearchWebView: async () => ({ ok: false, unsupported: true, browserOnly: true }),
  updateResearchWebViewBounds: async () => ({ ok: false, unsupported: true, browserOnly: true }),
  hideResearchWebView: async () => ({ ok: true, browserOnly: true }),
  controlResearchWebView: async () => ({ ok: false, unsupported: true, browserOnly: true }),
  destroyResearchWebView: async () => ({ ok: true, browserOnly: true }),
  onResearchWebViewState: () => () => {},
  getResearchRoot: async () => browserResearchPreviewEnabled() ? ({
    configured: true,
    available: true,
    browserOnly: true,
    preview: true,
    libraryId: BROWSER_RESEARCH_PREVIEW_LIBRARY_ID,
    rootPath: "浏览器资料预览",
    rootName: "浏览器资料预览",
  }) : ({
    configured: false,
    available: false,
    unsupported: true,
    browserOnly: true,
  }),
  pickResearchRoot: async () => ({
    canceled: true,
    configured: false,
    available: false,
    unsupported: true,
    browserOnly: true,
    message: "浏览器预览不能选择本地资料目录；请使用桌面版",
  }),
  clearResearchRoot: async () => ({
    ok: true,
    configured: false,
    available: false,
    browserOnly: true,
  }),
  listResearchFolder: async (libraryId, relativePath = "") => {
    if (browserResearchPreviewEnabled() && libraryId === BROWSER_RESEARCH_PREVIEW_LIBRARY_ID) {
      const normalizedPath = normalizeBrowserResearchRelativePath(relativePath);
      const fixture = browserResearchPreviewFixture();
      const entries = normalizedPath ? [] : [
        {
          type: "file",
          kind: "file",
          name: fixture.path,
          relativePath: fixture.path,
          size: fixture.size,
          previewKind: fixture.kind,
          canOpenInApp: true,
          canOpenExternally: true,
          modifiedAt: "2026-07-15T08:00:00.000Z",
          mtimeMs: Date.parse("2026-07-15T08:00:00.000Z"),
        },
      ];
      return { ok: true, available: true, browserOnly: true, preview: true, libraryId, relativePath: normalizedPath, rootName: "浏览器资料预览", entries };
    }
    const unavailable = browserResearchFileUnsupported(libraryId, relativePath);
    return {
      ...unavailable,
      rootName: "浏览器预览",
      entries: [],
      folders: [],
      files: [],
    };
  },
  createResearchFolder: async (libraryId, parentRelativePath = "", name = "") => ({
    ...browserResearchFileUnsupported(libraryId, parentRelativePath),
    name: normalizeBrowserResearchEntryName(name),
  }),
  importResearchFiles: async (libraryId, targetRelativePath = "") => ({
    ...browserResearchFileUnsupported(libraryId, targetRelativePath, "浏览器预览不能把本地文件导入资料目录；请使用桌面版"),
    imported: [],
  }),
  importLegacyResearch: async (_workspacePath, libraryId) => ({
    ok: false,
    canceled: true,
    unsupported: true,
    browserOnly: true,
    libraryId: normalizeBrowserResearchLibraryId(libraryId),
    imported: [],
    skipped: [],
    warnings: [],
    message: "浏览器预览不能读取或迁移写作工作区中的旧资料库；请使用桌面版",
  }),
  renameResearchEntry: async (libraryId, relativePath, nextName) => ({
    ...browserResearchFileUnsupported(libraryId, normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false })),
    nextName: normalizeBrowserResearchEntryName(nextName),
  }),
  moveResearchEntry: async (libraryId, relativePath, targetFolderRelativePath = "") => ({
    ...browserResearchFileUnsupported(libraryId, normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false })),
    targetFolderRelativePath: normalizeBrowserResearchRelativePath(targetFolderRelativePath),
  }),
  trashResearchEntry: async (libraryId, relativePath) => (
    browserResearchFileUnsupported(libraryId, normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false }))
  ),
  showResearchEntry: async (libraryId, relativePath = "") => (
    browserResearchFileUnsupported(libraryId, relativePath, "浏览器预览不能在资源管理器中显示本地资料")
  ),
  copyResearchEntryPath: async (libraryId, relativePath = "") => (
    browserResearchFileUnsupported(libraryId, relativePath, "浏览器预览不会读取或复制本地资料的绝对路径")
  ),
  listResearchLibrarySources: async (libraryId) => ({
    ...listBrowserResearchLibrarySources(libraryId),
    browserOnly: true,
  }),
  listResearchWebTree: async (libraryId) => listBrowserResearchWebTree(libraryId),
  createResearchWebFolder: async (libraryId, folder = {}, expectedRevision = null) => mutateBrowserResearchWebTree(libraryId, expectedRevision, (tree) => {
    const timestamp = new Date().toISOString();
    tree.folders.push({
      id: browserCitationId(),
      name: browserLibraryText(folder.name, 120),
      parentId: String(folder.parentId || "").trim().toLowerCase(),
      scopeKey: "global",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return tree;
  }),
  updateResearchWebFolder: async (libraryId, folder = {}, expectedRevision = null) => mutateBrowserResearchWebTree(libraryId, expectedRevision, (tree) => {
    const id = String(folder.id || "").trim().toLowerCase();
    const index = tree.folders.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error("网页文件夹不存在");
    const previous = tree.folders[index];
    tree.folders[index] = {
      ...previous,
      ...(Object.prototype.hasOwnProperty.call(folder, "name") ? { name: browserLibraryText(folder.name, 120) } : {}),
      ...(Object.prototype.hasOwnProperty.call(folder, "parentId") ? { parentId: String(folder.parentId || "").trim().toLowerCase() } : {}),
      updatedAt: new Date().toISOString(),
    };
    return tree;
  }),
  deleteResearchWebFolder: async (libraryId, folderId, expectedRevision = null) => mutateBrowserResearchWebTree(libraryId, expectedRevision, (tree) => {
    const id = String(folderId || "").trim().toLowerCase();
    const removed = tree.folders.find((folder) => folder.id === id);
    if (!removed) throw new Error("网页文件夹不存在");
    tree.folders = tree.folders.filter((folder) => folder.id !== id).map((folder) => folder.parentId === id ? { ...folder, parentId: removed.parentId } : folder);
    Object.entries(tree.placements).forEach(([sourceId, placement]) => {
      if (placement.folderId === id) tree.placements[sourceId] = { scopeKey: "global", folderId: removed.parentId };
    });
    return tree;
  }),
  moveResearchWebSource: async (libraryId, sourceId, placement = {}, expectedRevision = null) => mutateBrowserResearchWebTree(libraryId, expectedRevision, (tree) => {
    const id = String(sourceId || "").trim().toLowerCase();
    if (!listBrowserResearchLibrarySources(libraryId).sources.some((source) => source.id === id && source.type === "web")) throw new Error("网页来源不存在");
    tree.placements[id] = { scopeKey: "global", folderId: String(placement.folderId || "").trim().toLowerCase() };
    return tree;
  }),
  copyResearchWebSelection: async () => ({
    ok: false,
    unsupported: true,
    browserOnly: true,
    message: "浏览器预览不支持工作区私区复制；请使用桌面版",
  }),
  upsertResearchLibrarySource: async (libraryId, source = {}, expectedRevision = null) => {
    const id = normalizeBrowserResearchLibraryId(libraryId);
    const current = listBrowserResearchLibrarySources(id);
    const requestedSourceId = String(source?.id || "").trim().toLowerCase();
    const normalizedRequestedId = BROWSER_UUID_PATTERN.test(requestedSourceId) ? requestedSourceId : "";
    const previous = normalizedRequestedId
      ? current.sources.find((item) => item.id === normalizedRequestedId) || null
      : null;
    const actualRevision = previous?.diskRevision || null;
    if (!sameBrowserLibraryRevision(actualRevision, expectedRevision)) {
      return browserResearchRevisionConflict(
        id,
        expectedRevision,
        actualRevision,
        "资料来源已在另一个页面中被修改，请重新载入后再保存",
      );
    }
    if (!previous && current.sources.length >= BROWSER_SOURCE_LIMIT) throw new Error("资料来源数量已达上限");
    const normalized = normalizeBrowserLibrarySource({
      ...(source && typeof source === "object" ? source : {}),
      id: previous?.id || normalizedRequestedId || browserCitationId(),
    }, { previous });
    const serializable = { ...normalized };
    delete serializable.diskRevision;
    const diskRevision = await browserDiskRevision(serializable);
    const committed = { ...serializable, diskRevision };
    const sources = previous
      ? current.sources.map((item) => item.id === previous.id ? committed : item)
      : [...current.sources, committed];
    saveBrowserResearchLibrarySources(id, sources, committed.id);
    return { ok: true, libraryId: id, source: committed, browserOnly: true };
  },
  upsertResearchWebSource: async (libraryId, source = {}, placement = {}, revisions = {}) => {
    const saved = await browserBridge.upsertResearchLibrarySource(libraryId, source, revisions?.source || null);
    if (!saved.ok) return saved;
    const moved = await browserBridge.moveResearchWebSource(libraryId, saved.source.id, placement, revisions?.tree || null);
    if (!moved.ok) return { ...saved, tree: listBrowserResearchWebTree(libraryId), placementFallback: true, warning: "网页已保存，但分组索引发生冲突；已回退到全局未分组。" };
    return { ...saved, tree: moved, placementFallback: false };
  },
  deleteResearchLibrarySource: async (libraryId, sourceId, expectedRevision = null) => {
    const id = normalizeBrowserResearchLibraryId(libraryId);
    const normalizedSourceId = String(sourceId || "").trim().toLowerCase();
    if (!BROWSER_UUID_PATTERN.test(normalizedSourceId)) throw new Error("资料来源标识必须是 UUID");
    const current = listBrowserResearchLibrarySources(id);
    const previous = current.sources.find((item) => item.id === normalizedSourceId);
    if (!previous) throw new Error("资料来源不存在");
    if (!sameBrowserLibraryRevision(previous.diskRevision, expectedRevision)) {
      return browserResearchRevisionConflict(
        id,
        expectedRevision,
        previous.diskRevision,
        "资料来源已在另一个页面中被修改，请重新载入后再删除",
      );
    }
    saveBrowserResearchLibrarySources(id, current.sources.filter((item) => item.id !== normalizedSourceId), normalizedSourceId);
    return { ok: true, libraryId: id, sourceId: normalizedSourceId, browserOnly: true };
  },
  listLibrarySources: async (libraryId) => browserBridge.listResearchLibrarySources(libraryId),
  upsertLibrarySource: async (libraryId, source = {}, expectedRevision = null) => (
    browserBridge.upsertResearchLibrarySource(libraryId, source, expectedRevision)
  ),
  deleteLibrarySource: async (libraryId, sourceId, expectedRevision = null) => (
    browserBridge.deleteResearchLibrarySource(libraryId, sourceId, expectedRevision)
  ),
  readResearchPdf: async (libraryId, relativePath) => {
    const normalizedPath = normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false });
    if (!/\.pdf$/i.test(normalizedPath)) throw new Error("资料区首版只有 PDF 可以内嵌阅读");
    if (browserResearchPreviewEnabled() && libraryId === BROWSER_RESEARCH_PREVIEW_LIBRARY_ID && normalizedPath === BROWSER_RESEARCH_PREVIEW_PDF_PATH) {
      const bytes = createBrowserResearchPreviewPdf();
      return { ok: true, bytes, size: bytes.byteLength, browserOnly: true, preview: true };
    }
    return browserResearchFileUnsupported(libraryId, normalizedPath, "浏览器预览不能读取本地 PDF；请使用桌面版");
  },
  readResearchPreview: async (libraryId, relativePath) => {
    const normalizedPath = normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false });
    const fixture = browserResearchPreviewFixture();
    if (browserResearchPreviewEnabled()
      && libraryId === BROWSER_RESEARCH_PREVIEW_LIBRARY_ID
      && fixture.kind !== "pdf"
      && normalizedPath === fixture.path) {
      return {
        ok: true,
        browserOnly: true,
        preview: true,
        libraryId,
        relativePath: fixture.path,
        name: fixture.path,
        previewKind: fixture.kind,
        mime: fixture.mime,
        size: fixture.size,
        ...(fixture.html ? { html: fixture.html } : { text: fixture.text }),
      };
    }
    return browserResearchFileUnsupported(libraryId, normalizedPath, "浏览器预览不能读取本地资料文件；请使用桌面版");
  },
  openResearchDocument: async (libraryId, relativePath) => ({
    ...browserResearchFileUnsupported(
      libraryId,
      normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false }),
      "浏览器预览不能打开本地笺间文档；请使用桌面版",
    ),
    canceled: true,
  }),
  openResearchEntryExternal: async (libraryId, relativePath) => (
    browserResearchFileUnsupported(
      libraryId,
      normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false }),
      "浏览器预览不会启动本地资料文件；请使用桌面版",
    )
  ),
  watchResearchLibrary: async (libraryId) => ({
    ok: true,
    libraryId: normalizeBrowserResearchLibraryId(libraryId),
    browserOnly: true,
  }),
  onResearchLibraryChanged: (callback) => {
    ensureBrowserLifecycleListeners();
    if (typeof callback !== "function") return () => {};
    browserResearchLibraryChangedListeners.add(callback);
    return () => browserResearchLibraryChangedListeners.delete(callback);
  },
  onResearchLibraryWatchError: (callback) => {
    if (typeof callback !== "function") return () => {};
    browserResearchLibraryWatchErrorListeners.add(callback);
    return () => browserResearchLibraryWatchErrorListeners.delete(callback);
  },
  listResearch: async (workspacePath = "") => ({ sources: listBrowserResearch(workspacePath), browserOnly: true }),
  createResearch: async (workspacePath = "", source = {}) => {
    if (source?.type === "file") throw new Error("浏览器预览不能访问工作区文件；请在桌面端添加本地研究资料");
    const normalized = normalizeBrowserResearchSource(source);
    if (!normalized) throw new Error("资料来源仅支持网页");
    if (normalized.type === "web" && !normalized.url) throw new Error("网页来源仅支持有效的 HTTP 或 HTTPS 地址");
    const stored = listBrowserSources(workspacePath);
    if (stored.length >= BROWSER_SOURCE_LIMIT) throw new Error("工作区资料与参考文献来源数量已达上限");
    saveBrowserSources(workspacePath, [...stored, normalized]);
    return { canceled: false, source: normalized, sources: listBrowserResearch(workspacePath), browserOnly: true };
  },
  updateResearch: async (workspacePath = "", sourceId = "", patch = {}) => {
    const id = String(sourceId || "").slice(0, 128);
    let updated = null;
    const stored = listBrowserSources(workspacePath).map((source) => {
      if (source.kind !== "research" || source.id !== id) return source;
      updated = normalizeBrowserResearchSource({
        ...source,
        title: patch.title ?? source.title,
        url: patch.url ?? source.url,
        notes: patch.notes ?? source.notes,
        updatedAt: new Date().toISOString(),
      });
      return updated;
    });
    if (!updated) throw new Error("研究资料不存在");
    if (updated.type === "web" && !updated.url) throw new Error("网页来源仅支持有效的 HTTP 或 HTTPS 地址");
    saveBrowserSources(workspacePath, stored);
    return { source: updated, sources: listBrowserResearch(workspacePath), browserOnly: true };
  },
  deleteResearch: async (workspacePath = "", sourceId = "") => {
    const id = String(sourceId || "").slice(0, 128);
    const stored = listBrowserSources(workspacePath).filter((source) => source.kind !== "research" || source.id !== id);
    saveBrowserSources(workspacePath, stored);
    return { ok: true, sources: listBrowserResearch(workspacePath), browserOnly: true };
  },
  relinkResearch: async () => ({ canceled: true, unsupported: true, message: "浏览器预览不能重新定位本地文件" }),
  readResearchFile: async () => ({ canceled: true, unsupported: true, message: "浏览器预览不能读取本地研究文件" }),
  openResearchExternal: async (workspacePath = "", sourceId = "") => {
    const source = listBrowserResearch(workspacePath).find((item) => item.id === String(sourceId || ""));
    if (!source?.url) return { ok: false, error: "source-has-no-url" };
    return browserBridge.openExternal(source.url);
  },
  listCitations: async (workspacePath = "") => ({ sources: listBrowserCitations(workspacePath), browserOnly: true }),
  getWorkspaceIdentity: async () => ({ ok: false, unsupported: true, browserOnly: true, message: "浏览器预览没有真实工作区身份；请使用桌面版连接网页区。" }),
  upsertCitation: async (workspacePath = "", source = {}) => {
    const stored = listBrowserSources(workspacePath);
    const rawResearchSourceId = String(source?.researchSourceId || "").trim();
    const usesIndependentLibrary = Object.prototype.hasOwnProperty.call(
      source && typeof source === "object" ? source : {},
      "researchLibraryId",
    );
    if (!usesIndependentLibrary && rawResearchSourceId && !/^[a-zA-Z0-9_-]{8,128}$/.test(rawResearchSourceId)) {
      throw new Error("关联的研究资料标识无效");
    }
    const requestedId = String(source?.id || "").trim().toLowerCase();
    const id = BROWSER_UUID_PATTERN.test(requestedId) ? requestedId : browserCitationId();
    const collision = stored.find((item) => item.id === id);
    if (collision?.kind === "research") throw new Error("该标识已被研究资料占用");
    const previous = collision?.kind === "citation" ? collision : null;
    if (!previous && stored.length >= BROWSER_SOURCE_LIMIT) throw new Error("工作区资料与参考文献来源数量已达上限");
    const now = new Date().toISOString();
    const normalized = normalizeBrowserCitationSource({
      ...(previous || {}),
      ...(source && typeof source === "object" ? source : {}),
      id,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    });
    if (source?.url && !normalized.url) throw new Error("参考文献来源网址仅支持有效的 HTTP 或 HTTPS 地址");
    if (!normalized.title && !normalized.url && !normalized.doi) throw new Error("参考文献来源至少需要标题、网址或 DOI");
    if (normalized.researchSourceId && !normalized.researchLibraryId
      && !stored.some((item) => item.kind === "research" && item.id === normalized.researchSourceId)) {
      throw new Error("关联的研究资料不存在");
    }
    const next = previous
      ? stored.map((item) => item.kind === "citation" && item.id === id ? normalized : item)
      : [...stored, normalized];
    saveBrowserSources(workspacePath, next);
    return { source: normalized, sources: listBrowserCitations(workspacePath), browserOnly: true };
  },
  deleteCitation: async (workspacePath = "", sourceId = "") => {
    const id = String(sourceId || "").trim().toLowerCase();
    if (!BROWSER_UUID_PATTERN.test(id)) throw new Error("参考文献来源标识必须是 UUID");
    const stored = listBrowserSources(workspacePath);
    if (!stored.some((source) => source.kind === "citation" && source.id === id)) throw new Error("参考文献来源不存在");
    saveBrowserSources(workspacePath, stored.filter((source) => source.kind !== "citation" || source.id !== id));
    return { ok: true, id, sources: listBrowserCitations(workspacePath), browserOnly: true };
  },
  setFullscreen: async (fullscreen) => {
    ensureBrowserLifecycleListeners();
    const next = Boolean(fullscreen);
    logicalBrowserFullscreen = next;
    try {
      if (next && !document.fullscreenElement && document.documentElement?.requestFullscreen) await document.documentElement.requestFullscreen();
      if (!next && document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
    } catch {
      // CSS immersion remains available when the browser blocks the native fullscreen request.
    }
    emitBrowserEvent(browserFullscreenListeners, { fullscreen: logicalBrowserFullscreen, browserOnly: true });
    return { ok: true, fullscreen: logicalBrowserFullscreen, browserOnly: true };
  },
  getFullscreen: async () => ({ fullscreen: Boolean(globalThis.document?.fullscreenElement) || logicalBrowserFullscreen, browserOnly: true }),
  loadAutosave: async () => {
    const document = readJson("paperwriter.autosave", null);
    return document ? { exists: true, document, path: "localStorage:paperwriter.autosave" } : { exists: false };
  },
  saveAutosave: async (document) => {
    writeJson("paperwriter.autosave", document);
    return { path: "localStorage:paperwriter.autosave" };
  },
  clearAutosave: async () => {
    localStorage.removeItem("paperwriter.autosave");
    return { ok: true };
  },
  getUpdateState: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  checkForUpdates: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  downloadUpdate: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  installUpdate: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  onUpdateState: () => () => {},
  confirmClose: async () => ({ action: "save" }),
  closeReady: async () => ({ ok: true }),
  closeCanceled: async () => ({ ok: true }),
  onCloseRequest: () => () => {},
  onWorkspaceChanged: (callback) => {
    ensureBrowserLifecycleListeners();
    if (typeof callback !== "function") return () => {};
    browserWorkspaceChangedListeners.add(callback);
    return () => browserWorkspaceChangedListeners.delete(callback);
  },
  onWorkspaceWatchError: (callback) => {
    if (typeof callback !== "function") return () => {};
    browserWorkspaceWatchErrorListeners.add(callback);
    return () => browserWorkspaceWatchErrorListeners.delete(callback);
  },
  onWindowFocus: (callback) => {
    ensureBrowserLifecycleListeners();
    if (typeof callback !== "function") return () => {};
    browserWindowFocusListeners.add(callback);
    return () => browserWindowFocusListeners.delete(callback);
  },
  onWindowBlur: (callback) => {
    ensureBrowserLifecycleListeners();
    if (typeof callback !== "function") return () => {};
    browserWindowBlurListeners.add(callback);
    return () => browserWindowBlurListeners.delete(callback);
  },
  onFullscreenChanged: (callback) => {
    ensureBrowserLifecycleListeners();
    if (typeof callback !== "function") return () => {};
    browserFullscreenListeners.add(callback);
    return () => browserFullscreenListeners.delete(callback);
  },
};

export { browserBridge };
export const bridge = globalThis.window?.paperWriter ?? browserBridge;
