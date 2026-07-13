const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const test = require("node:test");
const {
  isPathInside,
  normalizeCodexScope,
  normalizeRelativePath,
  resolveCodexScopeDirectory,
} = require("./codex-scope.cjs");

test("normalizes every legacy directory scope to the safe text-only mode", () => {
  assert.deepEqual(normalizeCodexScope(), { mode: "document-only", relativePath: "" });
  assert.deepEqual(normalizeCodexScope({ mode: "document-only", relativePath: "ignored" }), { mode: "document-only", relativePath: "" });
  assert.deepEqual(normalizeCodexScope({ mode: "document-directory" }), { mode: "document-only", relativePath: "" });
  assert.deepEqual(normalizeCodexScope({ mode: "workspace" }), { mode: "document-only", relativePath: "" });
  assert.deepEqual(normalizeCodexScope({ mode: "subdirectory", relativePath: "资料\\参考/" }), { mode: "document-only", relativePath: "" });
});

test("rejects absolute and parent-relative paths", () => {
  assert.equal(normalizeRelativePath("C:\\secret"), "");
  assert.equal(normalizeRelativePath("/secret"), "");
  assert.equal(normalizeRelativePath("notes/../secret"), "");
  assert.equal(normalizeRelativePath("中文 目录/参考"), "中文 目录/参考");
});

test("checks Windows containment without prefix confusion", () => {
  assert.equal(isPathInside("C:\\Work", "C:\\Work\\资料", path.win32), true);
  assert.equal(isPathInside("C:\\Work", "C:\\Workspace2", path.win32), false);
  assert.equal(isPathInside("C:\\Work", "D:\\Work", path.win32), false);
});

test("resolves every legacy scope to a fresh empty directory", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-scope-test-"));
  try {
    for (const scope of [
      { mode: "document-only" },
      { mode: "document-directory" },
      { mode: "workspace" },
      { mode: "subdirectory", relativePath: "中文 资料" },
    ]) {
      const resolved = await resolveCodexScopeDirectory({
        scope,
        workspacePath: "Z:\\does-not-exist",
        documentPath: "Z:\\secret\\note.letterpaper",
        tempRoot,
      });
      assert.deepEqual(resolved.scope, { mode: "document-only", relativePath: "" });
      assert.equal(isPathInside(tempRoot, resolved.cwd), true);
      assert.deepEqual(await fs.readdir(resolved.cwd), []);
      await resolved.cleanup();
      await assert.rejects(() => fs.stat(resolved.cwd));
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("creates and cleans an isolated directory for document-only scope", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-doc-only-test-"));
  try {
    const resolved = await resolveCodexScopeDirectory({ scope: { mode: "document-only" }, tempRoot });
    assert.equal((await fs.stat(resolved.cwd)).isDirectory(), true);
    await resolved.cleanup();
    await assert.rejects(() => fs.stat(resolved.cwd));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("fails closed when no isolation root is available", async () => {
  await assert.rejects(() => resolveCodexScopeDirectory({ scope: { mode: "workspace" } }), /目录范围已失效/);
});
