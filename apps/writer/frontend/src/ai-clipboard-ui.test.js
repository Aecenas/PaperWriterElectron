import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("AI block copy delegates rich clipboard writes to the application bridge", () => {
  const start = source.indexOf("async function copyAiBlockToClipboard");
  const end = source.indexOf("function chatMessagesToMarkdown", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const implementation = source.slice(start, end);
  assert.match(implementation, /bridge\.writeClipboardContent\?\.\(\{ html, text \}\)/);
  assert.doesNotMatch(implementation, /navigator\.clipboard/);
});
