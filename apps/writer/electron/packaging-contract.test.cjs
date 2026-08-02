const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("every distributable Electron command rebuilds the frontend before packaging", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  assert.equal(manifest.scripts["frontend:build"], "npm --prefix ../frontend run build");
  for (const scriptName of ["pack", "dist", "publish"]) {
    const script = manifest.scripts[scriptName];
    assert.match(script, /^npm run frontend:build && node build-preload\.cjs && electron-builder /);
  }
});

test("packaging includes the complete app tree and the built frontend output", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));
  assert.equal(manifest.build.asar, true);
  assert.equal(manifest.build.electronFuses.onlyLoadAppFromAsar, true);
  assert.equal(manifest.build.files[0], "**/*");
  assert.deepEqual(manifest.build.files[1], {
    from: "../frontend/dist",
    to: "frontend/dist",
    filter: ["**/*"],
  });
});
