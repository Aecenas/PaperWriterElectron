import {
  browserRandomId,
  escapeBrowserHtml,
  plainTextFromBrowserHtml,
} from "./shared.js";

const BROWSER_IMPORT_MAX_BYTES = 32 * 1024 * 1024;
const BROWSER_SAFE_HTML_TAGS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "FIGCAPTION", "FIGURE",
  "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "LI", "OL", "P", "PRE", "S",
  "SECTION", "SPAN", "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TFOOT", "TH",
  "THEAD", "TR", "U", "UL",
]);
const BROWSER_DROP_HTML_TAGS = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "FORM", "SVG", "MATH",
]);

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

export {
  pickImportDocumentInBrowser,
  sanitizeBrowserHref,
  sanitizeBrowserImportedHtml,
};
