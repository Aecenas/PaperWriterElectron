import test from "node:test";
import assert from "node:assert/strict";
import { readAppStyles } from "./style-test-utils.js";

const stylesSource = await readAppStyles();

test("split workspaces let the document title use the full paper width", () => {
  assert.match(stylesSource, /\.ai-split-workspace \.paper-title-input,\s*\.document-split-workspace \.paper-title-input\s*\{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/);
});
