import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

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
