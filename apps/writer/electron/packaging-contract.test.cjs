const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("every distributable Electron command rebuilds the frontend before packaging", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  assert.equal(manifest.scripts["frontend:build"], "npm --prefix ../frontend run build");
  assert.match(manifest.scripts["release:check"], /npm run check && npm test/);
  assert.match(manifest.scripts["release:prepare"], /npm run release:check/);
  assert.match(manifest.scripts["release:prepare"], /npm run frontend:build/);
  assert.match(manifest.scripts["release:prepare"], /check:bundle/);
  assert.match(manifest.scripts["release:prepare"], /test:e2e:only/);
  assert.match(manifest.scripts["release:prepare"], /test:electron-smoke/);
  assert.match(manifest.scripts["test:packaged-smoke"], /packaged-electron-smoke\.mjs/);
  assert.match(manifest.scripts["test:packaged-smoke"], /win-unpacked/);
  for (const scriptName of ["pack", "dist", "publish"]) {
    const script = manifest.scripts[scriptName];
    assert.match(script, /^npm run release:prepare && electron-builder /);
  }
});

test("packaged smoke uses one disposable profile even when another app instance is open", () => {
  const smokeSource = fs.readFileSync(path.join(
    __dirname,
    "../frontend/scripts/packaged-electron-smoke.mjs",
  ), "utf8");
  assert.match(smokeSource, /`--user-data-dir=\$\{temporaryAppData\}`/);
  assert.match(smokeSource, /APPDATA:\s*temporaryAppData/);
  assert.match(smokeSource, /LOCALAPPDATA:\s*temporaryAppData/);
});

test("packaging uses an explicit runtime allowlist and excludes tests, build scripts, and source maps", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  assert.equal(manifest.build.asar, true);
  assert.equal(manifest.build.electronFuses.onlyLoadAppFromAsar, true);
  assert.deepEqual(manifest.build.files.slice(0, 10), [
    "package.json",
    "*.cjs",
    "!*.test.cjs",
    "!build-preload.cjs",
    "!check-cjs.cjs",
    "!dev-vite.cjs",
    "!run-tests.cjs",
    "!preload-src/**/*",
    "!**/*.map",
    "assets/**/*",
  ]);
  assert.deepEqual(manifest.build.files[10], {
    from: "../frontend/dist",
    to: "frontend/dist",
    filter: ["**/*", "!**/*.map"],
  });
  assert.ok(manifest.build.files.includes("!*.test.cjs"));
  assert.ok(manifest.build.files.includes("!**/*.map"));
});
