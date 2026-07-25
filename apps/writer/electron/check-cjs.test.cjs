const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { collectCommonJsFiles } = require("./check-cjs.cjs");

test("discovers nested CommonJS files while ignoring dependencies", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-cjs-check-"));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  await fs.mkdir(path.join(root, "modules", "nested"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules", "dependency"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(root, "main.cjs"), ""),
    fs.writeFile(path.join(root, "modules", "feature.cjs"), ""),
    fs.writeFile(path.join(root, "modules", "nested", "helper.cjs"), ""),
    fs.writeFile(path.join(root, "modules", "ignored.js"), ""),
    fs.writeFile(path.join(root, "node_modules", "dependency", "ignored.cjs"), ""),
  ]);

  const files = collectCommonJsFiles(root).map((file) => (
    path.relative(root, file).split(path.sep).join("/")
  ));
  assert.deepEqual(files, [
    "main.cjs",
    "modules/feature.cjs",
    "modules/nested/helper.cjs",
  ]);
});
