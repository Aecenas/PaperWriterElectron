const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const JSZip = require("jszip");

const {
  createDocumentInterchange,
  decodeTextBuffer,
  htmlToMarkdown,
  markdownToHtml,
  normalizeFormat,
  sanitizeImportedHtml,
  sniffImageMime,
} = require("./document-interchange.cjs");

test("does not admit AVIF until primary-image dimensions can be verified safely", () => {
  const avif = Buffer.alloc(24);
  avif.writeUInt32BE(24, 0);
  avif.write("ftyp", 4, "ascii");
  avif.write("avif", 8, "ascii");
  assert.equal(sniffImageMime(avif), "");
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("test-image-bytes"),
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function idsFrom(html, attribute) {
  return [...String(html).matchAll(new RegExp(`${attribute}="([^"]+)"`, "g"))].map((match) => match[1]);
}

function renderedProfessionalImages(items) {
  const dataUrl = `data:image/png;base64,${PNG.toString("base64")}`;
  const escapeAttribute = (value) => String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return items.map(({ index, kind, alt, width = 320, height = 120 }) => (
    `<img src="${dataUrl}" alt="${escapeAttribute(alt)}" title="JianjianProfessionalRender:${index}:${kind}" width="${width}" height="${height}">`
  )).join("");
}

test("normalizes only the supported interchange format aliases", () => {
  assert.equal(normalizeFormat(".MD"), "markdown");
  assert.equal(normalizeFormat("htm"), "html");
  assert.equal(normalizeFormat("doc"), "");
});

test("sanitizes imported HTML and only materializes images inside the source directory", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-interchange-html-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "images"));
  await fs.writeFile(path.join(root, "images", "safe.png"), PNG);
  await fs.writeFile(path.join(root, "outside.png"), PNG);
  const warnings = [];
  const imported = await sanitizeImportedHtml(`
    <script>globalThis.pwned = true</script>
    <p onclick="steal()">安全正文 <a href="java&#x73;cript:steal()">坏链接</a></p>
    <img src="https://example.com/tracker.png" onerror="steal()">
    <img src="../outside.png">
    <img src="C:\\secret.png">
    <img src="images/safe.png" alt="安全图片" style="width:100%">
  `, { sourcePath: path.join(root, "document.html"), warnings });
  assert.doesNotMatch(imported.html, /script|onclick|onerror|javascript|https:\/\/|outside|secret/i);
  assert.match(imported.html, /<img alt="安全图片" src="data:image\/png;base64,/);
  assert.equal(imported.assets.entries, 1);
  assert.equal(warnings.filter((entry) => entry.code === "asset-rejected").length, 3);
  assert.ok(warnings.some((entry) => entry.code === "html-sanitized"));
});

test("rejects a relative image that escapes through a resolved real path", async () => {
  const reads = [];
  const fakeFs = {
    realpath: async (value) => value.endsWith("safe.png") ? path.resolve("C:\\outside\\safe.png") : path.resolve(value),
    stat: async (value) => { reads.push(value); return { isFile: () => true, size: PNG.length }; },
    readFile: async (value) => { reads.push(value); return PNG; },
  };
  const warnings = [];
  const result = await sanitizeImportedHtml('<p>正文</p><img src="safe.png">', {
    sourcePath: path.resolve("C:\\workspace\\note.html"),
    fsApi: fakeFs,
    warnings,
  });
  assert.doesNotMatch(result.html, /<img/);
  assert.equal(reads.length, 0);
  assert.match(warnings[0].detail, /符号链接|目录之外/);
});

test("preserves the bookmark contract and Unicode emoji through safe HTML interchange", async () => {
  const bookmarkId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const document = {
    title: "书签与表情",
    html: [
      `<p><span data-type="paper-bookmark" data-bookmark-id="${bookmarkId}" data-bookmark-label="第一节" onclick="bad()" style="position:fixed"></span>`,
      "正文 👨‍👩‍👧‍👦 👍🏽 🇨🇳</p>",
      '<pre data-type="paper-code" data-code-language="typescript" data-code-wrap="false"><code>const answer: number = 42;</code></pre>',
    ].join(""),
  };
  const interchange = createDocumentInterchange();
  const exported = await interchange.exportDocument({ format: "html", document });
  const output = exported.buffer.toString("utf8");

  assert.match(output, new RegExp(`data-type="paper-bookmark" data-bookmark-id="${bookmarkId}" data-bookmark-label="第一节"`));
  assert.match(output, /👨‍👩‍👧‍👦 👍🏽 🇨🇳/u);
  assert.match(output, /data-type="paper-code" data-code-language="typescript" data-code-wrap="false"/);
  assert.doesNotMatch(output, /onclick=|position:fixed/i);

  const imported = await interchange.importDocument({
    format: "html",
    sourcePath: "C:\\docs\\bookmark.html",
    buffer: exported.buffer,
  });
  assert.match(imported.document.html, new RegExp(`data-type="paper-bookmark" data-bookmark-id="${bookmarkId}" data-bookmark-label="第一节"`));
  assert.match(imported.document.html, /👨‍👩‍👧‍👦 👍🏽 🇨🇳/u);
  assert.match(imported.document.html, /data-type="paper-code" data-code-language="typescript" data-code-wrap="false"/);
  assert.doesNotMatch(imported.document.html, /onclick=|style=/i);
});

test("imports Markdown structure, footnotes, tables and local images into a new document payload", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-interchange-md-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "figure.png"), PNG);
  const sourcePath = path.join(root, "研究记录.md");
  const markdown = `# 标题\n\n正文 **加粗**[^note].\n\n![示意图](figure.png)\n\n| 项目 | 值 |\n| --- | --- |\n| A | 1 |\n\n[^note]: 脚注内容`;
  const interchange = createDocumentInterchange();
  const result = await interchange.importDocument({ format: "md", sourcePath, buffer: Buffer.from(markdown) });
  assert.equal(result.document.title, "研究记录");
  assert.match(result.document.html, /<h1>标题<\/h1>/);
  assert.match(result.document.html, /<strong>加粗<\/strong>/);
  assert.match(result.document.html, /data-footnote-ref="true" data-footnote-id="[0-9a-f-]+">1<\/sup>/);
  assert.match(result.document.html, /<table>/);
  assert.match(result.document.html, /data:image\/png;base64/);
  assert.equal(result.document.footnotes.length, 1);
  assert.match(result.document.footnotes[0].id, UUID_PATTERN);
  assert.equal(result.document.footnotes[0].text, "脚注内容");
  assert.equal(result.document.footnotes[0].id, idsFrom(result.document.html, "data-footnote-id")[0]);
});

test("round-trips code language, math source, equation references, and Mermaid source", async () => {
  const equationId = "11111111-1111-4111-8111-111111111111";
  const diagramId = "22222222-2222-4222-8222-222222222222";
  const document = {
    title: "专业内容",
    html: [
      '<pre data-type="paper-code" data-code-language="javascript" data-code-wrap="true"><code>const answer = 42;</code></pre>',
      '<p>公式 <span data-type="inline-math" data-latex="a^2+b^2=c^2"></span></p>',
      `<div data-type="block-math" data-latex="E=mc^2" data-equation-id="${equationId}" data-equation-label="energy" data-equation-numbering="true"></div>`,
      `<p><span data-type="paper-equation-reference" data-equation-id="${equationId}"></span></p>`,
      `<figure data-type="paper-mermaid" data-diagram-id="${diagramId}" data-mermaid-source="flowchart LR&#10;A--&gt;B" data-caption="流程"><svg onload="bad()"></svg></figure>`,
    ].join(""),
  };
  const interchange = createDocumentInterchange();
  const exported = await interchange.exportDocument({ format: "markdown", document });
  const markdown = exported.buffer.toString("utf8");
  assert.match(markdown, /```javascript[\s\S]*const answer = 42;/);
  assert.match(markdown, /\$a\^2\+b\^2=c\^2\$/);
  assert.match(markdown, /\$\$[\s\S]*E=mc\^2[\s\S]*\$\$/);
  assert.match(markdown, /```mermaid[\s\S]*flowchart LR/);
  assert.match(markdown, /#jianjian-equation=11111111/);
  assert.match(markdown, /<!-- jianjian:code \{"wrap":true\} -->/);
  assert.match(markdown, /<!-- jianjian:equation \{[^}]*"label":"energy"[^}]*"numbering":true\} -->/);
  assert.match(markdown, /<!-- jianjian:mermaid \{[^}]*"caption":"流程"\} -->/);

  const imported = await interchange.importDocument({
    format: "markdown",
    sourcePath: "C:\\docs\\professional.md",
    buffer: exported.buffer,
  });
  assert.match(imported.document.html, /data-type="paper-code" data-code-language="javascript" data-code-wrap="true"/);
  assert.match(imported.document.html, /data-type="inline-math" data-latex="a\^2\+b\^2=c\^2"/);
  assert.match(imported.document.html, new RegExp(`data-type="block-math" data-latex="E=mc\\^2" data-equation-id="${equationId}" data-equation-label="energy" data-equation-numbering="true"`));
  assert.match(imported.document.html, new RegExp(`data-type="paper-equation-reference" data-equation-id="${equationId}"`));
  assert.match(imported.document.html, new RegExp(`data-type="paper-mermaid" data-diagram-id="${diagramId}"[^>]+data-caption="流程"`));
  assert.doesNotMatch(imported.document.html, /<svg|onload=/i);

  const html = await interchange.exportDocument({
    format: "html",
    document,
    renderedHtml: renderedProfessionalImages([
      { index: 1, kind: "inlineMath", alt: "TeX：a^2+b^2=c^2", width: 180, height: 28 },
      { index: 2, kind: "blockMath", alt: "TeX：E=mc^2", width: 320, height: 80 },
      { index: 4, kind: "mermaid", alt: "Mermaid：流程", width: 640, height: 360 },
    ]),
  });
  const htmlOutput = html.buffer.toString("utf8");
  assert.match(htmlOutput, new RegExp(`data-equation-id="${equationId}"`));
  assert.match(htmlOutput, /class="jianjian-math-image"/);
  assert.match(htmlOutput, /class="jianjian-mermaid-image"/);
  assert.match(htmlOutput, /flowchart LR/);
  assert.match(htmlOutput, /"Segoe UI Emoji"/);
  assert.doesNotMatch(htmlOutput, /<svg|onload=/i);
  assert.ok(html.warnings.some((entry) => entry.code === "professional-html-rendered-image"));
  assert.ok(html.assets.length >= 1);
  const htmlImported = await interchange.importDocument({ format: "html", sourcePath: "C:\\docs\\professional.html", buffer: html.buffer });
  assert.match(htmlImported.document.html, new RegExp(`data-equation-id="${equationId}"`));
  assert.match(htmlImported.document.html, new RegExp(`data-diagram-id="${diagramId}"`));

  const text = await interchange.exportDocument({ format: "txt", document });
  const textOutput = text.buffer.toString("utf8");
  assert.match(textOutput, /\[代码：javascript\][\s\S]*const answer = 42/);
  assert.match(textOutput, /\[公式 1：energy\][\s\S]*E=mc\^2[\s\S]*\[公式 1\]/);
  assert.match(textOutput, /\[Mermaid：流程\][\s\S]*flowchart LR/);
  assert.ok(text.warnings.some((entry) => entry.code === "professional-txt-structure-loss"));
});

test("does not truncate code blocks at the former 20k character boundary", async () => {
  const code = `${"const preserved = true;\\n".repeat(1_100)}// END-OF-LONG-CODE`;
  assert.ok(code.length > 20_000);
  const interchange = createDocumentInterchange();
  const document = {
    title: "长代码",
    html: `<pre data-type="paper-code" data-code-language="javascript" data-code-wrap="false"><code>${code}</code></pre>`,
  };
  for (const format of ["markdown", "txt"]) {
    const exported = await interchange.exportDocument({ format, document });
    const output = exported.buffer.toString("utf8");
    assert.match(output, /END-OF-LONG-CODE/, format);
    assert.ok(output.length > 20_000, format);
  }
  const markdown = await interchange.exportDocument({ format: "markdown", document });
  const imported = await interchange.importDocument({
    format: "markdown",
    sourcePath: "C:\\docs\\long-code.md",
    buffer: markdown.buffer,
  });
  assert.match(imported.document.html, /END-OF-LONG-CODE/);
  assert.ok(imported.document.html.length > 20_000);
});

test("bounds untrusted professional Markdown metadata and assigns stable safe IDs", async () => {
  const markdown = [
    '<!-- jianjian:equation {"id":"not-a-uuid","label":"<img src=x onerror=bad()>","numbering":false} -->',
    "$$",
    "x+y",
    "$$",
    '<!-- jianjian:mermaid {"id":"also-invalid","caption":"<script>bad()</script>"} -->',
    "```mermaid",
    "flowchart LR",
    "A-->B",
    "```",
  ].join("\n");
  const interchange = createDocumentInterchange();
  const first = await interchange.importDocument({ format: "markdown", sourcePath: "C:\\docs\\unsafe.md", buffer: Buffer.from(markdown) });
  const second = await interchange.importDocument({ format: "markdown", sourcePath: "C:\\docs\\unsafe.md", buffer: Buffer.from(markdown) });
  const equationIds = idsFrom(first.document.html, "data-equation-id");
  const diagramIds = idsFrom(first.document.html, "data-diagram-id");
  assert.match(equationIds[0], UUID_PATTERN);
  assert.match(diagramIds[0], UUID_PATTERN);
  assert.deepEqual(equationIds, idsFrom(second.document.html, "data-equation-id"));
  assert.deepEqual(diagramIds, idsFrom(second.document.html, "data-diagram-id"));
  assert.match(first.document.html, /data-equation-numbering="false"/);
  assert.doesNotMatch(first.document.html, /<(?:img|script)\b/i);
});

test("keeps literal HTML entity text distinct from mathematical and code operators", async () => {
  const diagramId = "22222222-2222-4222-8222-222222222222";
  const document = {
    title: "实体保真",
    html: [
      '<pre data-type="paper-code" data-code-language="text" data-code-wrap="true"><code>actual &lt; tag; literal &amp;lt;tag&amp;gt;\n```\nend</code></pre>',
      '<p><span data-type="inline-math" data-latex="a&lt;b &amp;&amp; literal=&amp;lt;x&amp;gt;"></span></p>',
      `<figure data-type="paper-mermaid" data-diagram-id="${diagramId}" data-mermaid-source="flowchart LR&#10;A--&gt;B" data-caption="actual &lt;; literal &amp;lt;"></figure>`,
    ].join(""),
  };
  const interchange = createDocumentInterchange();
  const renderedHtml = renderedProfessionalImages([
    { index: 1, kind: "inlineMath", alt: "TeX：a<b && literal=<x>", width: 220, height: 28 },
    { index: 2, kind: "mermaid", alt: "Mermaid：actual <; literal &lt;", width: 640, height: 360 },
  ]);
  for (const format of ["markdown", "html"]) {
    const exported = await interchange.exportDocument({ format, document, renderedHtml });
    if (format === "markdown") assert.match(exported.buffer.toString("utf8"), /````text[\s\S]*\n```\nend\n````/);
    const imported = await interchange.importDocument({ format, buffer: exported.buffer });
    assert.match(imported.document.html, /literal &amp;lt;tag&amp;gt;/, format);
    assert.match(imported.document.html, /literal &amp;lt;tag&amp;gt;\n```\nend/, format);
    assert.match(imported.document.html, /data-latex="a&lt;b &amp;&amp; literal=&amp;lt;x&amp;gt;"/, format);
    assert.match(imported.document.html, /data-caption="actual &lt;; literal &amp;lt;"/, format);
  }
  const text = await interchange.exportDocument({ format: "txt", document });
  assert.match(text.buffer.toString("utf8"), /literal &lt;tag&gt;[\s\S]*literal=&lt;x&gt;[\s\S]*literal &lt;/);
});

test("exports semantic HTML and Markdown as safe bundles with deduplicated relative assets", async () => {
  const source = "paperwriter-asset://staged/11111111-1111-4111-8111-111111111111";
  let reads = 0;
  const interchange = createDocumentInterchange({
    resolveAsset: async (value, options) => {
      reads += 1;
      assert.equal(value, source);
      assert.ok(options.maxBytes >= PNG.length);
      return { buffer: PNG, mime: "image/png" };
    },
  });
  const document = {
    title: "语义输出",
    author: "作者",
    html: `<h1>正文</h1><p>内容<sup data-footnote-ref="n1">1</sup><span data-citation-source-id="s1">[1]</span></p><img src="${source}" alt="图"><img src="${source}" alt="重复图"><section data-reference-list="[]"></section>`,
    customBackground: "secret-background",
    comments: [{ text: "不导出" }],
    aiState: { messages: [{ content: "不导出" }] },
    footnotes: [{ id: "n1", text: "脚注文本" }],
    citationSources: [
      { id: "s1", author: "甲", title: "来源", year: "2026", url: "https://example.com/source" },
      { id: "unused", title: "未引用来源" },
    ],
  };
  const html = await interchange.exportDocument({ format: "html", document, baseName: "文章" });
  const htmlText = html.buffer.toString("utf8");
  assert.match(htmlText, /<!doctype html>/i);
  assert.match(htmlText, /文章\.assets\/image-[a-f0-9]{12}\.png/);
  assert.match(htmlText, /data-footnotes="true"/);
  assert.match(htmlText, /data-references="true"/);
  assert.doesNotMatch(htmlText, /未引用来源/);
  assert.doesNotMatch(htmlText, /secret-background|不导出/);
  assert.equal(html.assets.length, 1);
  assert.deepEqual(html.assets[0].buffer, PNG);
  assert.equal(reads, 1);

  const markdown = await interchange.exportDocument({ format: "md", document, baseName: "文章" });
  const markdownText = markdown.buffer.toString("utf8");
  assert.match(markdownText, /# 正文/);
  assert.match(markdownText, /\[\^[0-9a-f-]{36}\]/);
  assert.match(markdownText, /\[\^[0-9a-f-]{36}\]: 脚注文本/);
  assert.match(markdownText, /\[@s1\]/);
  assert.match(markdownText, /## 参考文献/);
  assert.doesNotMatch(markdownText, /未引用来源/);
  assert.match(markdownText, /文章\.assets\/image-[a-f0-9]{12}\.png/);
});

test("all text exports use the injected citeproc result for inline citations and bibliography", async () => {
  const sourceId = "22222222-2222-4222-8222-222222222222";
  const calls = [];
  const interchange = createDocumentInterchange({
    formatCitations: async (payload) => {
      calls.push(payload);
      return {
        styleId: "apa-7",
        locale: "en-US",
        citationKind: "author-date",
        citationsById: { [sourceId]: "(Zhang, 2024)" },
        entriesById: {
          [sourceId]: "Zhang, S. (2024). A cited paper.",
        },
        entryIds: [sourceId],
      };
    },
  });
  const document = {
    title: "引用排版",
    html: `<p>正文<span data-citation-source-id="${sourceId}" data-citation-pages="12"></span></p><section data-reference-list="[]"></section>`,
    citationSources: [{
      id: sourceId,
      citationKey: "zhang2024",
      title: "A cited paper",
      authors: ["Zhang, S."],
      year: "2024",
    }],
    citationStyle: {
      styleId: "apa-7",
      locale: "en-US",
    },
  };
  const html = (
    await interchange.exportDocument({ format: "html", document })
  ).buffer.toString("utf8");
  const markdown = (
    await interchange.exportDocument({ format: "markdown", document })
  ).buffer.toString("utf8");
  const text = (
    await interchange.exportDocument({ format: "txt", document })
  ).buffer.toString("utf8");
  assert.match(html, /\(Zhang, 2024，第 12 页\)/);
  assert.match(html, /Zhang, S\. \(2024\)\. A cited paper\./);
  assert.match(markdown, /\[@zhang2024, p\. 12\]/);
  assert.match(markdown, /Zhang, S\. \(2024\)\. A cited paper\./);
  assert.match(text, /\(Zhang, 2024，第 12 页\)/);
  assert.match(text, /Zhang, S\. \(2024\)\. A cited paper\./);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].styleId, "apa-7");
});

test("round-trips HTML title, author, footnotes and reference snapshots without duplicating sections in the body", async () => {
  const interchange = createDocumentInterchange();
  const original = {
    title: "往返标题",
    author: "往返作者",
    html: '<p>正文<sup data-footnote-ref="note">1</sup> <span data-citation-source-id="book">[1]</span></p><section data-reference-list="[]"></section>',
    footnotes: [{ id: "note", text: "补充说明" }],
    citationSources: [{ id: "book", text: "作者. 书名. 2026" }],
  };
  const exported = await interchange.exportDocument({ format: "html", document: original });
  const imported = await interchange.importDocument({ format: "html", sourcePath: "C:\\docs\\往返.html", buffer: exported.buffer });
  assert.equal(imported.document.title, original.title);
  assert.equal(imported.document.author, original.author);
  assert.equal(imported.document.footnotes[0].text, "补充说明");
  assert.match(imported.document.footnotes[0].id, UUID_PATTERN);
  assert.equal(imported.document.citationSources[0].title, "作者. 书名. 2026");
  assert.equal(imported.document.citationSources[0].text, "作者. 书名. 2026");
  assert.match(imported.document.citationSources[0].id, UUID_PATTERN);
  assert.match(imported.document.html, /data-footnote-ref="true" data-footnote-id="[0-9a-f-]{36}"/);
  assert.match(imported.document.html, /data-citation-source-id="[0-9a-f-]{36}"/);
  assert.match(imported.document.html, /data-reference-list="\[\]"/);
  assert.doesNotMatch(imported.document.html, /<h2>脚注<\/h2>|<h2>参考文献<\/h2>/);
});

test("round-trips footnotes, citations, pages and an automatic bibliography across HTML, Markdown and DOCX", async () => {
  const footnoteId = "11111111-1111-4111-8111-111111111111";
  const sourceId = "22222222-2222-4222-8222-222222222222";
  const bibliography = JSON.stringify([{ sourceId, title: "研究方法", authors: ["甲", "乙"], year: "2026", text: "甲，乙. 研究方法. 2026" }])
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const original = {
    title: "跨格式语义",
    html: `<p>正文<sup data-footnote-ref="true" data-footnote-id="${footnoteId}">99</sup>，来源<span data-citation-source-id="${sourceId}" data-citation-pages="18-20">99</span>，再次<span data-citation-source-id="${sourceId}">42</span>。</p><section data-reference-list="${bibliography}"><p data-citation-source-id="${sourceId}">[9] 旧编号</p></section>`,
    footnotes: [{ id: footnoteId, text: "脚注正文" }],
    citationSources: [],
  };
  const interchange = createDocumentInterchange({ docx: require("docx"), mammoth: require("mammoth") });

  const plainText = (await interchange.exportDocument({ format: "txt", document: original })).buffer.toString("utf8");
  assert.match(plainText, /正文1/);
  assert.match(plainText, /来源\[1，第 18-20 页\]/);
  assert.match(plainText, /脚注[\s\S]*脚注正文/);
  assert.match(plainText, /脚注[\s\S]*1\. 脚注正文/);
  assert.match(plainText, /参考文献[\s\S]*甲，乙\. 研究方法\. 2026/);
  assert.match(plainText, /参考文献[\s\S]*\[1\] 甲，乙\. 研究方法\. 2026/);

  for (const format of ["html", "markdown", "docx"]) {
    const exported = await interchange.exportDocument({ format, document: original });
    const text = format === "docx" ? "" : exported.buffer.toString("utf8");
    if (format === "html") {
      assert.match(text, /data-footnote-id="11111111-1111-4111-8111-111111111111">1/);
      assert.match(text, /data-citation-pages="18-20">\[1，第 18-20 页\]/);
      assert.match(text, /甲，乙\. 研究方法\. 2026/);
    } else if (format === "markdown") {
      assert.match(text, /\[\^11111111-1111-4111-8111-111111111111\]/);
      assert.match(text, /\[@22222222-2222-4222-8222-222222222222, p\. 18-20\]/);
      assert.match(text, /\[@22222222-2222-4222-8222-222222222222\]/);
      assert.match(text, /## 参考文献[\s\S]*甲，乙\. 研究方法\. 2026/);
    }

    const extension = format === "markdown" ? "md" : format;
    const imported = await interchange.importDocument({ format, sourcePath: `C:\\docs\\roundtrip.${extension}`, buffer: exported.buffer });
    assert.equal(imported.document.footnotes.length, 1, format);
    assert.equal(imported.document.footnotes[0].text, "脚注正文", format);
    assert.match(imported.document.footnotes[0].id, UUID_PATTERN, format);
    assert.equal(imported.document.citationSources.length, 1, format);
    assert.match(imported.document.citationSources[0].id, UUID_PATTERN, format);
    assert.match(imported.document.citationSources[0].title, /研究方法/, format);
    assert.match(imported.document.html, /data-citation-pages="18-20">\[1，第 18-20 页\]<\/span>/, format);
    assert.equal(idsFrom(imported.document.html, "data-citation-source-id")[0], imported.document.citationSources[0].id, format);
    assert.match(imported.document.html, /data-reference-list="\[\]"/, format);
    assert.doesNotMatch(imported.document.html, /<h2>参考文献<\/h2>/, format);
  }
});

test("round-trips professional nodes through rendered DOCX images and v3 source metadata", async () => {
  const equationId = "11111111-1111-4111-8111-111111111111";
  const diagramId = "22222222-2222-4222-8222-222222222222";
  const original = {
    title: "DOCX 专业内容",
    html: [
      '<p>行内 <span data-type="inline-math" data-latex="a&lt;b &amp;&amp; c&gt;d; literal=&amp;lt;x&amp;gt;"></span> 公式。</p>',
      '<pre data-type="paper-code" data-code-language="javascript" data-code-wrap="false"><code>if (a &lt; b) {\n  answer += 1;\n}\nconst entity = "&amp;lt;literal&amp;gt;";</code></pre>',
      `<div data-type="block-math" data-latex="E=mc^2" data-equation-id="${equationId}" data-equation-label="energy" data-equation-numbering="true"></div>`,
      `<p>参见 <span data-type="paper-equation-reference" data-equation-id="${equationId}"></span>。</p>`,
      `<figure data-type="paper-mermaid" data-diagram-id="${diagramId}" data-mermaid-source="flowchart LR&#10;A--&gt;B" data-caption="流程"><svg onload="bad()"></svg></figure>`,
    ].join(""),
  };
  const interchange = createDocumentInterchange({ docx: require("docx"), mammoth: require("mammoth") });
  const exported = await interchange.exportDocument({
    format: "docx",
    document: original,
    renderedHtml: renderedProfessionalImages([
      { index: 0, kind: "inlineMath", alt: "TeX：a<b && c>d; literal=<x>", width: 220, height: 28 },
      { index: 2, kind: "blockMath", alt: "TeX：E=mc^2", width: 320, height: 80 },
      { index: 4, kind: "mermaid", alt: "Mermaid：流程", width: 640, height: 360 },
    ]),
  });
  assert.ok(exported.warnings.some((entry) => entry.code === "professional-docx-rendered-image"));

  const archive = await JSZip.loadAsync(exported.buffer);
  const documentXml = await archive.file("word/document.xml").async("string");
  assert.match(documentXml, /⟦代码：javascript；不换行⟧/);
  assert.match(documentXml, /TeX：E=mc\^2/);
  assert.match(documentXml, /Mermaid：流程/);
  assert.doesNotMatch(documentXml, /⟦(?:公式 \d|Mermaid)/);
  assert.match(documentXml, /⟦公式引用 1⟧/);
  const stylesXml = await archive.file("word/styles.xml").async("string");
  assert.match(
    stylesXml,
    /w:style w:type="paragraph" w:styleId="JianjianCode"[\s\S]*?<w:shd[^>]*w:fill="EFF4F2"/,
  );
  const customXml = await archive.file("docProps/custom.xml").async("string");
  const encoded = /name="JianjianSemantics"[\s\S]*?<vt:lpwstr>([^<]+)<\/vt:lpwstr>/.exec(customXml)?.[1] || "";
  const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.equal(payload.version, 3);
  assert.deepEqual(payload.professionalContent.map((entry) => entry.kind), [
    "inlineMath", "code", "blockMath", "equationReference", "mermaid",
  ]);

  const imported = await interchange.importDocument({ format: "docx", sourcePath: "C:\\docs\\professional.docx", buffer: exported.buffer });
  assert.ok(imported.warnings.some((entry) => entry.code === "professional-docx-restored"));
  assert.equal(imported.warnings.some((entry) => entry.code === "professional-docx-restore-partial"), false);
  assert.match(imported.document.html, /data-type="inline-math" data-latex="a&lt;b &amp;&amp; c&gt;d; literal=&amp;lt;x&amp;gt;"/);
  assert.match(imported.document.html, /data-type="paper-code" data-code-language="javascript" data-code-wrap="false"/);
  assert.match(imported.document.html, /if \(a &lt; b\) \{\n  answer \+= 1;\n\}\nconst entity = &quot;&amp;lt;literal&amp;gt;&quot;;/);
  assert.match(imported.document.html, new RegExp(`data-type="block-math"[^>]+data-equation-id="${equationId}"[^>]+data-equation-label="energy"[^>]+data-equation-numbering="true"`));
  assert.match(imported.document.html, new RegExp(`data-type="paper-equation-reference" data-equation-id="${equationId}"`));
  assert.match(imported.document.html, new RegExp(`data-type="paper-mermaid"[^>]+data-diagram-id="${diagramId}"[^>]+data-mermaid-source="flowchart LR\\nA--&gt;B"[^>]+data-caption="流程"`));
  assert.doesNotMatch(imported.document.html, /<svg|onload=|⟦(?:代码|公式|Mermaid|TeX)/i);

  const modifiedInterchange = createDocumentInterchange({
    mammoth: { convertToHtml: async () => ({ value: "<p>用户已在 Word 中改写这些源码。</p>" }) },
  });
  const modified = await modifiedInterchange.importDocument({ format: "docx", buffer: exported.buffer });
  assert.doesNotMatch(modified.document.html, /data-type="(?:paper-code|inline-math|block-math|paper-equation-reference|paper-mermaid)"/);
  assert.ok(modified.warnings.some((entry) => entry.code === "professional-docx-restore-partial"));
});

test("uses bounded renderer PNGs for DOCX while round-tripping original formula and Mermaid sources", async () => {
  const equationId = "33333333-3333-4333-8333-333333333333";
  const diagramId = "44444444-4444-4444-8444-444444444444";
  const html = [
    '<pre data-type="paper-code" data-code-language="javascript" data-code-wrap="false"><code>const before = true;</code></pre>',
    '<p>行内 <span data-type="inline-math" data-latex="x^2+y^2"></span></p>',
    `<div data-type="block-math" data-latex="E=mc^2" data-equation-id="${equationId}" data-equation-label="energy" data-equation-numbering="true"></div>`,
    `<figure data-type="paper-mermaid" data-diagram-id="${diagramId}" data-mermaid-source="flowchart LR&#10;A--&gt;B" data-caption="流程"></figure>`,
  ].join("");
  const dataUrl = `data:image/png;base64,${PNG.toString("base64")}`;
  const renderedHtml = [
    `<p>行内 <img src="${dataUrl}" alt="TeX：x^2+y^2" title="JianjianProfessionalRender:1:inlineMath" width="88" height="24"></p>`,
    `<img src="${dataUrl}" alt="TeX：E=mc^2" title="JianjianProfessionalRender:2:blockMath" width="300" height="80">`,
    `<img src="${dataUrl}" alt="Mermaid：流程" title="JianjianProfessionalRender:3:mermaid" width="800" height="450">`,
  ].join("");
  const interchange = createDocumentInterchange({
    docx: require("docx"),
    mammoth: require("mammoth"),
  });
  const exported = await interchange.exportDocument({
    format: "docx",
    document: { title: "专业图片", html },
    renderedHtml,
  });
  assert.ok(exported.warnings.some((entry) => entry.code === "professional-docx-rendered-image"));
  assert.equal(
    exported.warnings.some((entry) => entry.code === "professional-docx-render-node-rejected"),
    false,
  );

  const archive = await JSZip.loadAsync(exported.buffer);
  const documentXml = await archive.file("word/document.xml").async("string");
  assert.match(documentXml, /TeX：x\^2\+y\^2/);
  assert.match(documentXml, /JianjianProfessionalRender:2:blockMath/);
  assert.match(documentXml, /Mermaid：流程/);
  assert.doesNotMatch(documentXml, /⟦(?:TeX|公式|Mermaid)/);

  const imported = await interchange.importDocument({
    format: "docx",
    sourcePath: "C:\\docs\\rendered-professional.docx",
    buffer: exported.buffer,
  });
  assert.ok(imported.warnings.some((entry) => entry.code === "professional-docx-restored"));
  assert.equal(
    imported.warnings.some((entry) => entry.code === "professional-docx-restore-partial"),
    false,
  );
  assert.match(imported.document.html, /data-type="inline-math" data-latex="x\^2\+y\^2"/);
  assert.match(imported.document.html, /data-type="paper-code" data-code-language="javascript" data-code-wrap="false"/);
  assert.match(imported.document.html, new RegExp(`data-type="block-math"[^>]+data-equation-id="${equationId}"`));
  assert.match(imported.document.html, new RegExp(`data-type="paper-mermaid"[^>]+data-diagram-id="${diagramId}"[^>]+data-mermaid-source="flowchart LR\\nA--&gt;B"`));
});

test("rejects the DOCX export when one transient professional image is invalid", async () => {
  let captured;
  class Capture { constructor(options = {}) { this.options = options; } }
  class Document extends Capture { constructor(options) { super(options); captured = this; } }
  class Paragraph extends Capture {}
  class TextRun extends Capture {}
  class ImageRun extends Capture {}
  const docx = {
    Document,
    Paragraph,
    TextRun,
    ImageRun,
    Packer: { toBuffer: async () => Buffer.from("generated-docx") },
  };
  const dataUrl = `data:image/png;base64,${PNG.toString("base64")}`;
  const html = [
    '<span data-type="inline-math" data-latex="ok"></span>',
    '<div data-type="block-math" data-latex="fallback" data-equation-id="55555555-5555-4555-8555-555555555555" data-equation-numbering="true"></div>',
  ].join("");
  await assert.rejects(
    createDocumentInterchange({ docx }).exportDocument({
      format: "docx",
      document: { html },
      renderedHtml: [
        `<img src="${dataUrl}" alt="TeX：ok" title="JianjianProfessionalRender:0:inlineMath" width="96" height="24">`,
        `<img src="${dataUrl}" alt="TeX：fallback" title="JianjianProfessionalRender:1:blockMath" width="999999" height="24">`,
      ].join(""),
    }),
    /未通过安全校验/,
  );
  assert.equal(captured, undefined);
});

test("bounds DOCX semantic metadata while retaining both referenced footnotes and citations", async () => {
  const citationSources = [];
  const footnotes = [];
  const body = [];
  for (let index = 0; index < 400; index += 1) {
    const suffix = String(index + 1).padStart(12, "0");
    const sourceId = `10000000-0000-4000-8000-${suffix}`;
    const footnoteId = `20000000-0000-4000-8000-${suffix}`;
    citationSources.push({
      id: sourceId,
      citationKey: `source-${index + 1}`,
      title: `来源 ${index + 1}`,
      notes: "注".repeat(10_000),
      csl: { id: sourceId, title: "文".repeat(20_000) },
    });
    footnotes.push({ id: footnoteId, text: "脚".repeat(10_000) });
    body.push(
      `<p><span data-citation-source-id="${sourceId}">[${index + 1}]</span>`
      + `<sup data-footnote-id="${footnoteId}">${index + 1}</sup></p>`,
    );
  }
  const interchange = createDocumentInterchange({ docx: require("docx"), mammoth: require("mammoth") });
  const exported = await interchange.exportDocument({
    format: "docx",
    document: {
      title: "受限元数据",
      html: body.join(""),
      citationSources,
      footnotes,
    },
  });
  assert.ok(exported.warnings.some((entry) => entry.code === "docx-semantics-metadata-truncated"));

  const archive = await JSZip.loadAsync(exported.buffer);
  const customXml = await archive.file("docProps/custom.xml").async("string");
  const encoded = /name="JianjianSemantics"[\s\S]*?<vt:lpwstr>([^<]+)<\/vt:lpwstr>/.exec(customXml)?.[1] || "";
  assert.ok(encoded.length <= 16 * 1024 * 1024);
  const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  assert.ok(payload.citationSources.length > 0);
  assert.ok(payload.footnotes.length > 0);
  assert.ok(payload.citationSourcesTruncated || payload.footnotesTruncated);
});

test("canonicalizes malicious or legacy semantic IDs to stable UUIDs and keeps definitions aligned", async () => {
  const source = `<!doctype html><html><head><title>不可信输入</title></head><body><article>
    <p><sup data-footnote-ref="../bad-id">7</sup><sup data-footnote-ref="../bad-id">8</sup>
    <span data-citation-source-id="bad&lt;script&gt;" data-citation-pages="12&amp;quot; onmouseover=&amp;quot;x">[99]</span></p>
    <section data-footnotes="true"><ol><li data-footnote-id="../bad-id"><script>alert(1)</script>安全脚注</li></ol></section>
    <section data-references="true" data-reference-list="not-json"><ol><li data-citation-source-id="bad&lt;script&gt;"><img src="https://evil.test/a.png" onerror="x">恶意来源</li></ol></section>
  </article></body></html>`;
  const interchange = createDocumentInterchange();
  const first = await interchange.importDocument({ format: "html", sourcePath: "C:\\docs\\bad.html", buffer: Buffer.from(source) });
  const second = await interchange.importDocument({ format: "html", sourcePath: "C:\\docs\\bad.html", buffer: Buffer.from(source) });
  const footnoteIds = idsFrom(first.document.html, "data-footnote-id");
  const citationIds = idsFrom(first.document.html, "data-citation-source-id");

  assert.equal(new Set(footnoteIds).size, 1);
  assert.ok(footnoteIds.every((id) => UUID_PATTERN.test(id)));
  assert.ok(citationIds.every((id) => UUID_PATTERN.test(id)));
  assert.deepEqual(first.document.footnotes.map((item) => item.id), second.document.footnotes.map((item) => item.id));
  assert.deepEqual(first.document.citationSources.map((item) => item.id), second.document.citationSources.map((item) => item.id));
  assert.equal(first.document.footnotes[0].id, footnoteIds[0]);
  assert.equal(first.document.citationSources[0].id, citationIds[0]);
  assert.equal(first.document.citationSources[0].title, "恶意来源");
  assert.doesNotMatch(first.document.html, /script|onerror|onmouseover|evil\.test/i);

  const exported = await interchange.exportDocument({ format: "html", document: first.document });
  const exportedText = exported.buffer.toString("utf8");
  assert.doesNotMatch(exportedText, /<script|onerror=|onmouseover=/i);
  assert.match(exportedText, /安全脚注/);
  assert.match(exportedText, /恶意来源/);
});

test("TXT export explicitly reports image loss and keeps footnotes and references", async () => {
  const interchange = createDocumentInterchange();
  const result = await interchange.exportDocument({
    format: "txt",
    document: {
      title: "纯文本",
      html: '<p>正文<sup data-footnote-ref="1">1</sup><span data-citation-source-id="book">[1]</span></p><img src="assets/a.png" alt="图示"><section data-reference-list="[]"></section>',
      footnotes: [{ id: "1", text: "补充" }],
      citationSources: [{ id: "book", title: "一本书", author: "作者" }],
    },
  });
  const output = result.buffer.toString("utf8");
  assert.match(output, /正文/);
  assert.match(output, /脚注[\s\S]*补充/);
  assert.match(output, /参考文献[\s\S]*一本书/);
  assert.ok(result.warnings.some((entry) => entry.code === "format-loss"));
});

test("uses injected mammoth for DOCX import, embeds converted images and preserves converter warnings", async () => {
  const archive = new JSZip();
  archive.file("[Content_Types].xml", "<Types></Types>", { compression: "STORE" });
  const fakeDocx = await archive.generateAsync({ type: "nodebuffer", compression: "STORE" });
  let imageConverter;
  const mammoth = {
    images: { inline: (converter) => { imageConverter = converter; return converter; } },
    convertToHtml: async ({ buffer }, options) => {
      assert.deepEqual(buffer, fakeDocx);
      assert.equal(options.includeDefaultStyleMap, true);
      assert.ok(options.styleMap.some((entry) => /page.*paper-page-break/.test(entry)));
      assert.equal(typeof options.convertImage, "function");
      const image = await imageConverter({ contentType: "image/png", read: async (kind) => { assert.equal(kind, "base64"); return PNG.toString("base64"); } });
      return {
        value: `<h2>DOCX 标题</h2><p>正文<sup><a href="#doc-42-footnote-n1" id="doc-42-footnote-ref-n1">[1]</a></sup></p><hr data-type="paper-page-break"><img src="${image.src}"><ol><li id="doc-42-footnote-n1"><p>脚注正文 <a href="#doc-42-footnote-ref-n1">↑</a></p></li></ol>`,
        messages: [{ type: "warning", message: "浮动对象已降级" }],
      };
    },
  };
  const interchange = createDocumentInterchange({ mammoth });
  const result = await interchange.importDocument({ format: "docx", sourcePath: "C:\\docs\\输入.docx", buffer: fakeDocx });
  assert.match(result.document.html, /data:image\/png;base64/);
  assert.match(result.document.html, /<div data-type="paper-page-break"><\/div>/);
  assert.match(result.document.html, /<sup data-footnote-ref="true" data-footnote-id="[0-9a-f-]{36}">1<\/sup>/);
  assert.doesNotMatch(result.document.html, /脚注正文|doc-42-footnote-ref/);
  assert.equal(result.document.footnotes.length, 1);
  assert.match(result.document.footnotes[0].id, UUID_PATTERN);
  assert.equal(result.document.footnotes[0].text, "脚注正文");
  assert.ok(result.warnings.some((entry) => entry.code === "docx-conversion" && /浮动对象/.test(entry.message)));
});

test("warns explicitly for unrecognized OMML without inventing editable formula nodes", async () => {
  const archive = new JSZip();
  archive.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  archive.file("word/document.xml", `<?xml version="1.0"?>
    <w:document
      xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
      xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
      <w:body>
        <w:p><m:oMathPara><m:oMath><m:r><m:t>x+y</m:t></m:r></m:oMath></m:oMathPara></w:p>
      </w:body>
    </w:document>`);
  const buffer = await archive.generateAsync({ type: "nodebuffer" });
  const interchange = createDocumentInterchange({
    mammoth: {
      convertToHtml: async () => ({
        value: "<p>公式所在段落</p>",
        messages: [],
      }),
    },
  });
  const imported = await interchange.importDocument({
    format: "docx",
    sourcePath: "C:\\docs\\omml.docx",
    buffer,
  });
  const ommlWarning = imported.warnings.find((entry) => entry.code === "docx-omml-unrecognized");
  assert.match(ommlWarning?.message || "", /1 个 Word OMML 公式/);
  assert.doesNotMatch(imported.document.html, /data-type="(?:inline-math|block-math)"/);
  assert.match(imported.document.html, /公式所在段落/);
});

test("preflights DOCX archive expansion before mammoth can allocate it", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "A".repeat(2 * 1024 * 1024));
  const compressed = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  let called = false;
  const interchange = createDocumentInterchange({
    mammoth: { convertToHtml: async () => { called = true; return { value: "<p>不应执行</p>" }; } },
    limits: { maxDocxCompressionRatio: 5 },
  });
  await assert.rejects(() => interchange.importDocument({ format: "docx", buffer: compressed }), /压缩比异常|总压缩比异常/);
  assert.equal(called, false);
});

test("bounds each DOCX image during mammoth conversion", async () => {
  const archive = new JSZip();
  archive.file("[Content_Types].xml", "<Types></Types>", { compression: "STORE" });
  const fakeDocx = await archive.generateAsync({ type: "nodebuffer", compression: "STORE" });
  let converter;
  const mammoth = {
    images: { inline: (callback) => { converter = callback; return callback; } },
    convertToHtml: async () => {
      await converter({ contentType: "image/png", read: async () => PNG.toString("base64") });
      return { value: "<p>不应完成</p>" };
    },
  };
  const interchange = createDocumentInterchange({ mammoth, limits: { maxAssetBytes: 4 } });
  await assert.rejects(() => interchange.importDocument({ format: "docx", buffer: fakeDocx }), /内嵌图片超过安全大小上限/);
});

test("bounds a selected source file before reading its contents", async () => {
  let readCalled = false;
  let closeCalled = false;
  const fsApi = {
    open: async () => ({
      stat: async () => ({ isFile: () => true, size: 100 }),
      read: async () => { readCalled = true; return { bytesRead: 0 }; },
      close: async () => { closeCalled = true; },
    }),
  };
  const interchange = createDocumentInterchange({ fsApi, limits: { maxInputBytes: 10 } });
  await assert.rejects(() => interchange.importDocument({ format: "txt", sourcePath: "large.txt" }), /大小上限/);
  assert.equal(readCalled, false);
  assert.equal(closeCalled, true);
});

test("uses injected docx constructors for headings, lists, tables, page breaks and inline images", async () => {
  let captured;
  class Capture { constructor(options = {}) { this.options = options; } }
  class Document extends Capture { constructor(options) { super(options); captured = this; } }
  class Paragraph extends Capture {}
  class TextRun extends Capture {}
  class ExternalHyperlink extends Capture {}
  class ImageRun extends Capture {}
  class Table extends Capture {}
  class TableRow extends Capture {}
  class TableCell extends Capture {}
  class PageBreak extends Capture {}
  class FootnoteReferenceRun extends Capture { constructor(id) { super({ id }); } }
  const docx = {
    Document, Paragraph, TextRun, ExternalHyperlink, ImageRun, Table, TableRow, TableCell, PageBreak, FootnoteReferenceRun,
    HeadingLevel: { TITLE: "Title", HEADING_2: "Heading2" }, LevelFormat: { DECIMAL: "decimal" }, AlignmentType: { START: "start" },
    ShadingType: { CLEAR: "clear" },
    Packer: { toBuffer: async () => Buffer.from("generated-docx") },
  };
  const dataUrl = `data:image/png;base64,${PNG.toString("base64")}`;
  const interchange = createDocumentInterchange({ docx });
  const result = await interchange.exportDocument({
    format: "docx",
    document: {
      title: "DOCX 输出",
      html: `<h2><strong>章节</strong></h2><p>正文<sup data-footnote-ref="n1">1</sup></p><ol><li>第一项</li></ol><table><tr><th>列</th></tr><tr><td>值</td></tr></table><div data-type="paper-page-break"><span>分页符</span></div><p><img src="${dataUrl}" alt="图"></p>`,
      footnotes: [{ id: "n1", text: "脚注文本" }],
    },
  });
  assert.equal(result.buffer.toString(), "generated-docx");
  assert.ok(captured);
  assert.equal(captured.options.title, "DOCX 输出");
  assert.equal(captured.options.numbering.config[0].reference, "jianjian-numbered");
  assert.deepEqual(
    captured.options.styles.paragraphStyles[0].paragraph.shading,
    { type: "clear", color: "auto", fill: "EFF4F2" },
  );
  const children = captured.options.sections[0].children;
  assert.ok(children.some((child) => child instanceof Table));
  assert.ok(children.some((child) => child instanceof Paragraph && child.options.children.some((run) => run instanceof PageBreak)));
  assert.equal(children.some((child) => child instanceof Paragraph && child.options.children.some((run) => run instanceof TextRun && run.options.text === "分页符")), false);
  assert.ok(children.some((child) => child instanceof Paragraph && child.options.children.some((run) => run instanceof ImageRun)));
  assert.ok(children.some((child) => child instanceof Paragraph && child.options.children.some((run) => run instanceof TextRun && run.options.text === "1" && run.options.superScript)));
  assert.ok(children.some((child) => child instanceof Paragraph && child.options.children.some((run) => run instanceof TextRun && run.options.text === "脚注")));
  assert.ok(children.some((child) => child instanceof Paragraph && child.options.numbering?.reference === "jianjian-numbered" && child.options.children.some((run) => run instanceof TextRun && run.options.text === "脚注文本")));
  assert.ok(!captured.options.footnotes);
  assert.ok(children.some((child) => child instanceof Paragraph && child.options.numbering?.reference === "jianjian-numbered"));
});

test("uses iconv-lite only for explicitly requested legacy encodings", () => {
  let requested = "";
  const iconvLite = { decode: (_buffer, encoding) => { requested = encoding; return "旧编码正文"; } };
  assert.equal(decodeTextBuffer(Buffer.from([1, 2, 3]), "gb18030", iconvLite), "旧编码正文");
  assert.equal(requested, "gb18030");
  assert.throws(() => decodeTextBuffer(Buffer.from([1]), "gb18030"), /iconv-lite/);
});

test("re-sanitizes semantic hook output so extensions cannot reintroduce executable HTML", async () => {
  const interchange = createDocumentInterchange({
    semanticHooks: {
      afterImport: async ({ document }) => ({ ...document, html: `${document.html}<img src="https://tracker.test/a.png" onerror="x"><script>x()</script>`, footnotes: [{ id: "hook", text: "扩展脚注" }] }),
      beforeExport: async ({ html }) => ({ html: `${html}<iframe src="https://evil.test"></iframe>` }),
    },
  });
  const imported = await interchange.importDocument({ format: "txt", buffer: Buffer.from("正文") });
  assert.doesNotMatch(imported.document.html, /script|onerror|tracker/i);
  assert.match(imported.document.footnotes[0].id, UUID_PATTERN);
  assert.equal(imported.document.footnotes[0].text, "扩展脚注");
  const exported = await interchange.exportDocument({ format: "html", document: imported.document });
  assert.doesNotMatch(exported.buffer.toString("utf8"), /iframe|evil\.test/i);
});

test("converts standalone helpers without leaking raw markup", () => {
  const converted = markdownToHtml("## 标题\n\n正文 `code`");
  assert.match(converted.html, /<h2>标题<\/h2>/);
  assert.match(converted.html, /<code>code<\/code>/);
  const fencedDollar = markdownToHtml("```text\n$$\n```");
  assert.match(fencedDollar.html, /data-type="paper-code"[^>]*><code[^>]*>\$\$<\/code>/);
  assert.doesNotMatch(fencedDollar.html, /data-type="block-math"/);
  assert.match(htmlToMarkdown("<p>正文 <strong>重点</strong></p>"), /正文 \*\*重点\*\*/);
  const pageBreak = htmlToMarkdown('<p>前页</p><div data-type="paper-page-break"><span>分页符</span></div><p>后页</p>');
  assert.match(pageBreak, /前页[\s\S]*<div data-type="paper-page-break"><\/div>[\s\S]*后页/);
  assert.doesNotMatch(pageBreak, /分页符/);
});

test("editable text exports keep page-break semantics without leaking the editor label", async () => {
  const interchange = createDocumentInterchange();
  const document = {
    title: "分页导出",
    html: '<p>前页</p><div class="paper-page-break" data-type="paper-page-break"><span>分页符</span></div><p>后页</p>',
  };
  const html = await interchange.exportDocument({ format: "html", document });
  const markdown = await interchange.exportDocument({ format: "markdown", document });
  const text = await interchange.exportDocument({ format: "txt", document });
  const htmlOutput = html.buffer.toString("utf8");
  const markdownOutput = markdown.buffer.toString("utf8");
  const textOutput = text.buffer.toString("utf8");

  assert.match(htmlOutput, /<div data-type="paper-page-break"><\/div>/);
  assert.doesNotMatch(htmlOutput, /paper-page-break"><\/div>\s*<\/div>/);
  assert.match(markdownOutput, /<div data-type="paper-page-break"><\/div>/);
  assert.match(textOutput, /前页[\s\S]*后页/);
  assert.doesNotMatch(`${htmlOutput}\n${markdownOutput}\n${textOutput}`, /分页符/);
});
