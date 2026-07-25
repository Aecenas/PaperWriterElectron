import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  displayNameFromPath,
  parentPathFromPath,
  pathIsSameOrInside,
} from "./app-shell/path-display.js";
import {
  formatCacheBytes,
  formatClock,
  getUpdateStatusMeta,
} from "./app-shell/status-display.js";

test("App consumes application-shell presentation through one public entry", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const imports = [...source.matchAll(/from "(\.\/app-shell\/[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(imports, ["./app-shell/index.js"]);
  assert.doesNotMatch(
    source,
    /function (?:TopNav|HelpCenterDialog|LeftSidebar|DocumentTabs|AppConfirmDialog|WebSourceDialog|InternalLinkPicker|StatusBar)\b/,
  );
});

test("shell path display helpers retain Windows path semantics", () => {
  assert.equal(displayNameFromPath("C:\\Letters\\Drafts"), "Drafts");
  assert.equal(parentPathFromPath("C:\\Letters\\Drafts\\note.letterpaper"), "C:\\Letters\\Drafts");
  assert.equal(pathIsSameOrInside("C:\\Letters\\Drafts\\note.letterpaper", "c:\\letters"), true);
  assert.equal(pathIsSameOrInside("C:\\Letterbox\\note.letterpaper", "C:\\Letters"), false);
});

test("status presentation helpers preserve labels, sizes and invalid clock fallback", () => {
  assert.equal(formatCacheBytes(0), "0 KB");
  assert.equal(formatCacheBytes(1536), "2 KB");
  assert.equal(formatCacheBytes(1.5 * 1024 * 1024), "1.5 MB");
  assert.equal(formatClock("not-a-date"), "--:--");
  assert.deepEqual(getUpdateStatusMeta({ status: "checking" }), {
    label: "检查中",
    className: "checking",
    busy: true,
  });
  assert.deepEqual(getUpdateStatusMeta({ status: "downloaded" }), {
    label: "安装更新",
    className: "downloaded",
    busy: false,
  });
  assert.deepEqual(getUpdateStatusMeta(), {
    label: "检查更新",
    className: "idle",
    busy: false,
  });
});
