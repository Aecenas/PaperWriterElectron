import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const stylesSource = await readFile(new URL("./styles.css", import.meta.url), "utf8");

test("split workspaces let the document title use the full paper width", () => {
  assert.match(stylesSource, /\.ai-split-workspace \.paper-title-input,\s*\.document-split-workspace \.paper-title-input\s*\{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/);
});
