import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceStyles = readFileSync(new URL("./workspace-features.css", import.meta.url), "utf8");
const paperStyles = readFileSync(new URL("./styles-editor-paper.css", import.meta.url), "utf8");
const selectionStyles = readFileSync(new URL("./selection-ai/SelectionAiPopover.css", import.meta.url), "utf8");
const selectionSource = readFileSync(new URL("./selection-ai/SelectionAiPopover.jsx", import.meta.url), "utf8");

test("AI result actions and selection AI chrome do not join native selections", () => {
  assert.match(workspaceStyles, /\.ai-block-actions\{[^}]*-webkit-user-select:none;user-select:none/);
  assert.match(selectionStyles, /\.selection-ai-message-heading\s*\{[^}]*user-select:\s*none/s);
  assert.match(selectionSource, /onCopy=\{copySelectionAiPlainText\}/);
});

test("table of contents uses a fragmentable list while keeping entries intact", () => {
  assert.match(paperStyles, /\.paper-toc-title\s*\{[^}]*break-after:\s*avoid-column/s);
  assert.match(paperStyles, /\.paper-toc-list\s*\{[^}]*display:\s*block/s);
  assert.doesNotMatch(paperStyles, /\.paper-toc-list\s*\{[^}]*display:\s*grid/s);
  assert.match(paperStyles, /\.paper-toc-list li\s*\{[^}]*break-inside:\s*avoid-column/s);
  assert.match(paperStyles, /\.paper-toc-list li\s*\{[^}]*page-break-inside:\s*avoid/s);
});

test("English hyphenation is supplied by a view-only soft-hyphen pseudo-element", () => {
  assert.match(paperStyles, /\.paper-english-hyphenation-point::after\s*\{[^}]*content:\s*"\\00ad"/s);
});
