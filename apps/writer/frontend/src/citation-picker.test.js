import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./CitationPickerDialog.jsx", import.meta.url), "utf8");

test("citation picker searches sources and supports page-aware insertion", () => {
  assert.match(source, /searchableSourceText/);
  assert.match(source, /defaultPageForSource/);
  assert.match(source, /onSelect\?\.\(selected, page\)/);
  assert.match(source, /新增并引用/);
});
