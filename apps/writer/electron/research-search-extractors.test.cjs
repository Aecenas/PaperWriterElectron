const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createResearchFileExtractor,
} = require("./research-search-extractors.cjs");

function createExtractorHarness() {
  const library = {
    async copyEntryPath(_libraryId, relativePath) {
      return { path: `C:\\Authorized\\${relativePath}` };
    },
    async readPreview(_libraryId, relativePath) {
      return {
        bytes: Buffer.from(`正文:${relativePath}`, "utf8"),
        diskRevision: { size: 1, mtimeMs: 2, sha256: "a".repeat(64) },
      };
    },
  };
  return createResearchFileExtractor({
    library,
    async readSearchDocument() {
      return {
        title: "信笺标题",
        author: "作者",
        html: "<h1>标题</h1><p>信笺正文</p>",
      };
    },
    htmlToSearchText(html) {
      return String(html).replace(/<[^>]+>/g, " ");
    },
    decodePreviewText(bytes) {
      return Buffer.from(bytes).toString("utf8");
    },
  });
}

test("document, markdown, text and table previews expose bounded searchable text", async () => {
  const extract = createExtractorHarness();
  const document = await extract("library-1", {
    previewKind: "document",
    relativePath: "示例.letterpaper",
  });
  assert.equal(document.title, "信笺标题");
  assert.match(document.body, /信笺正文/);

  for (const [previewKind, relativePath] of [
    ["markdown", "资料.md"],
    ["text", "日志.log"],
    ["table", "数据.tsv"],
  ]) {
    const extracted = await extract("library-1", {
      previewKind,
      relativePath,
    }, {
      maxCharacters: 5,
    });
    assert.equal(extracted.body.length, 5);
    assert.equal(extracted.truncated, true);
  }
});

test("unsupported and image formats stay metadata-only without OCR", async () => {
  const extract = createExtractorHarness();
  const extracted = await extract("library-1", {
    previewKind: "image",
    relativePath: "扫描件.png",
  });
  assert.equal(extracted.body, "");
  assert.equal(extracted.truncated, false);
});
