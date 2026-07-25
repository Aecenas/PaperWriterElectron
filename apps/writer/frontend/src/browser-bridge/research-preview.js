const BROWSER_RESEARCH_PREVIEW_LIBRARY_ID = "9f4d2b8b-9ab1-4c0d-8f60-0b50c8137f96";
const BROWSER_RESEARCH_PREVIEW_PDF_PATH = "阅读示例.pdf";
const BROWSER_RESEARCH_PREVIEW_TEXT_PATH = "阅读示例.txt";
const BROWSER_RESEARCH_PREVIEW_MARKDOWN_PATH = "scene.md";
const BROWSER_RESEARCH_PREVIEW_DOCX_PATH = "阅读示例.docx";
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
    return ["pdf", "docx", "markdown", "text", "table"].includes(requested) ? requested : "pdf";
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
  if (kind === "docx") {
    const html = "<h1>DOCX 资料示例</h1><p>这份 Word 文档用于检查资料区的 DOCX 阅读、搜索和缩放。</p><h2>章节内容</h2><ul><li>保留标题与段落层级。</li><li>转换后的内容经过安全清洗。</li></ul><table><tbody><tr><th>格式</th><th>状态</th></tr><tr><td>DOCX</td><td>可阅读</td></tr></tbody></table>";
    return { kind, path: BROWSER_RESEARCH_PREVIEW_DOCX_PATH, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", html, size: new TextEncoder().encode(html).byteLength };
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

export {
  BROWSER_RESEARCH_PREVIEW_LIBRARY_ID,
  BROWSER_RESEARCH_PREVIEW_PDF_PATH,
  browserResearchPreviewEnabled,
  browserResearchPreviewFixture,
  createBrowserResearchPreviewPdf,
};
