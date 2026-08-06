import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  APP_STYLE_FRAGMENT_NAMES,
  readAppStyles,
} from "./style-test-utils.js";

test("the single application style entry preserves the explicit cascade order", async () => {
  const entrySource = await readFile(new URL("./styles.css", import.meta.url), "utf8");
  assert.equal(
    entrySource.replace(/\r\n?/g, "\n"),
    `${APP_STYLE_FRAGMENT_NAMES.map((name) => `@import "./${name}";`).join("\n")}\n`,
  );
});

test("the modular style fragments retain legacy anchors and scoped feature styles", async () => {
  const cascade = (await readAppStyles()).replace(/\r\n?/g, "\n");
  const workspaceFeatures = await readFile(
    new URL("./workspace-features.css", import.meta.url),
    "utf8",
  );
  const selectionAi = await readFile(
    new URL("./selection-ai/SelectionAiPopover.css", import.meta.url),
    "utf8",
  );
  assert.match(cascade, /\.app-shell\s*\{/);
  assert.match(cascade, /\.paper-workspace\s*\{/);
  assert.match(cascade, /\.selection-bubble-menu\s*\{/);
  assert.match(cascade, /\.statusbar-update-progress-icon\s*\{/);
  assert.match(workspaceFeatures, /\.research-search-progress\s*\{/);
  assert.match(selectionAi, /\.selection-ai-popover\s*\{/);
  assert.doesNotMatch(cascade, /@import\s+/);
});

test("bundled Chinese fonts use full-coverage WOFF2 assets instead of raw TTF files", async () => {
  const foundation = await readFile(
    new URL("./styles-foundation.css", import.meta.url),
    "utf8",
  );
  assert.match(foundation, /NotoSerifSC-VF\.woff2[^;]*format\("woff2"\)/);
  assert.match(foundation, /LXGWWenKaiScreen\.woff2[^;]*format\("woff2"\)/);
  assert.doesNotMatch(foundation, /assets\/fonts\/[^)]+\.ttf/);
});
