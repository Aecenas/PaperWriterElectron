import assert from "node:assert/strict";
import test from "node:test";
import { readAppStylesSync } from "./style-test-utils.js";

const css = readAppStylesSync();

function ruleZIndex(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{[^}]*z-index:\\s*(\\d+)`, "s"));
  assert.ok(match, `missing numeric z-index for ${selector}`);
  return Number(match[1]);
}

test("navigation popovers remain above every split-mode tab strip", () => {
  const navigationLayer = ruleZIndex(".top-nav");
  assert.ok(navigationLayer > ruleZIndex(".editor-groups-top-strip"));
  assert.ok(navigationLayer > ruleZIndex(".ai-mode-top-strip"));
  assert.ok(navigationLayer > ruleZIndex(".secondary-pane-top-strip"));
  assert.match(css, /\.nav-menu-popover\s*\{[^}]*z-index:\s*40/s);
});
