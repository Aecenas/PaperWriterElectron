import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dialogUrl = new URL("./KnowledgeDialogs.jsx", import.meta.url);
const dialogCssUrl = new URL("./knowledge-dialogs.css", import.meta.url);

test("citation source type and accessed date use product-styled custom controls", async () => {
  const jsx = await readFile(dialogUrl, "utf8");

  assert.match(jsx, /function KnowledgeSelect/);
  assert.match(jsx, /role="listbox"/);
  assert.match(jsx, /role="option"/);
  assert.match(jsx, /function KnowledgeDatePicker/);
  assert.match(jsx, /aria-label=\{`\$\{label\}日期选择器`\}/);
  assert.doesNotMatch(jsx, /<select/);
  assert.doesNotMatch(jsx, /type="date"/);
});

test("citation-page input is a regular field and dialog buttons follow the app contract", async () => {
  const [jsx, css] = await Promise.all([
    readFile(dialogUrl, "utf8"),
    readFile(dialogCssUrl, "utf8"),
  ]);

  assert.doesNotMatch(jsx, /is-citation-page/);
  assert.match(jsx, /<span>本次引用页码<\/span>/);
  assert.match(css, /\.knowledge-form-dialog > footer button \{/);
  assert.match(css, /min-height: 38px/);
  assert.match(css, /linear-gradient\(180deg, #d68151, #bd653d\)/);
});
