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
  formatUpdateProgressDetails,
  getUpdateProgressAnnouncement,
  getUpdateStatusDescription,
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

test("update status presentation exposes real progress without treating unknown progress as zero", () => {
  const downloading = {
    status: "downloading",
    message: "正在下载更新 42%",
    progressKnown: true,
    percent: 42.3,
    transferred: 13_000_000,
    total: 31_000_000,
    bytesPerSecond: 2_200_000,
  };
  assert.deepEqual(getUpdateStatusMeta(downloading), {
    label: "更新中 42%",
    className: "downloading",
    busy: true,
    progressKnown: true,
    percent: 42.3,
  });
  assert.equal(
    formatUpdateProgressDetails(downloading),
    "12.4 MB / 29.6 MB · 2.1 MB/s",
  );
  assert.equal(
    getUpdateStatusDescription(downloading),
    "正在下载更新 42%（12.4 MB / 29.6 MB · 2.1 MB/s）",
  );
  assert.equal(getUpdateProgressAnnouncement(downloading), "更新下载进度 40%");

  assert.deepEqual(getUpdateStatusMeta({
    status: "downloading",
    progressKnown: false,
    percent: 0,
  }), {
    label: "准备更新",
    className: "downloading",
    busy: true,
    progressKnown: false,
    percent: null,
  });
  assert.equal(
    getUpdateProgressAnnouncement({ status: "downloading", progressKnown: false }),
    "正在下载更新，等待进度",
  );
  assert.deepEqual(getUpdateStatusMeta({
    status: "downloaded",
    installPending: true,
  }), {
    label: "准备安装",
    className: "downloaded install-pending",
    busy: true,
  });
});

test("status bar keeps progress semantics and reduced-motion protection local to update UI", async () => {
  const [source, styles] = await Promise.all([
    readFile(new URL("./app-shell/StatusBar.jsx", import.meta.url), "utf8"),
    readFile(new URL("./styles-status-export-help.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /role="progressbar"/);
  assert.match(source, /aria-valuenow=\{updateMeta\.progressKnown \? Math\.round\(updateMeta\.percent\) : undefined\}/);
  assert.match(source, /aria-valuetext=\{updateMeta\.progressKnown \? undefined : "准备更新"\}/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /aria-busy=\{updateMeta\.busy \|\| undefined\}/);
  assert.match(styles, /\.statusbar-update-progress-value/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
