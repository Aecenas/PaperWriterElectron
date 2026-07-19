const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isLegacyTocDecorationSource,
  replaceLegacyTocDecorationSources,
} = require("../../../scripts/Migrate-TocDecorationAssets.cjs");

test("recognizes legacy development and packaged table-of-contents decoration URLs", () => {
  assert.equal(
    isLegacyTocDecorationSource("http://127.0.0.1:5174/src/assets/decor/toc-title-signature.png"),
    true,
  );
  assert.equal(
    isLegacyTocDecorationSource("file:///I:/PaperWriter/resources/frontend/dist/assets/toc-title-signature-C1u6UDQM.png"),
    true,
  );
  assert.equal(isLegacyTocDecorationSource("https://example.com/unrelated.png"), false);
  assert.equal(isLegacyTocDecorationSource("assets/toc-title-signature.png"), false);
});

test("rewrites only legacy decoration sources inside table-of-contents nodes", () => {
  const legacySource = "file:///I:/PaperWriter/resources/frontend/dist/assets/toc-title-signature-C1u6UDQM.png";
  const html = [
    `<p><img src="${legacySource}"></p>`,
    `<section class="paper-toc" data-type="paper-toc"><h2><img src="${legacySource}"><span>目录</span></h2></section>`,
  ].join("");
  const result = replaceLegacyTocDecorationSources(html, "assets/toc-title-signature-abc123.png");

  assert.equal(result.replacements, 1);
  assert.match(result.html, /^<p><img src="file:/);
  assert.match(result.html, /<section[^>]+><h2><img src="assets\/toc-title-signature-abc123\.png">/);
});
