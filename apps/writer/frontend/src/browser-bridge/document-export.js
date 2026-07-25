import { sanitizeBrowserHref, sanitizeBrowserImportedHtml } from "./document-import.js";
import { escapeBrowserHtml, plainTextFromBrowserHtml } from "./shared.js";

const BROWSER_EXPORT_FORMATS = new Set(["markdown", "html", "txt"]);

function canonicalizeBrowserExportPageBreaks(html) {
  const marker = '<div data-type="paper-page-break"></div>';
  return String(html || "")
    .replace(/<div\b(?=[^>]*\bdata-type=["']paper-page-break["'])[^>]*>[\s\S]*?<\/div\s*>/gi, marker)
    .replace(/<div\b(?=[^>]*\bdata-type=["']paper-page-break["'])[^>]*\/\s*>/gi, marker)
    .replace(/<hr\b(?=[^>]*\bdata-type=["']paper-page-break["'])[^>]*\/?>/gi, marker);
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

export {
  canonicalizeBrowserExportPageBreaks,
  createBrowserEditableExport,
  downloadBrowserBlob,
};
