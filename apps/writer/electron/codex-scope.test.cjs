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

test("normalizes legacy and all supported Codex scopes", () => {
  assert.deepEqual(normalizeCodexScope(), { mode: "workspace", relativePath: "" });
  assert.deepEqual(normalizeCodexScope({ mode: "document-only", relativePath: "ignored" }), { mode: "document-only", relativePath: "" });
  assert.deepEqual(normalizeCodexScope({ mode: "document-directory" }), { mode: "document-directory", relativePath: "" });
  assert.deepEqual(normalizeCodexScope({ mode: "subdirectory", relativePath: "资料\\参考/" }), { mode: "subdirectory", relativePath: "资料/参考" });
  assert.deepEqual(normalizeCodexScope({ mode: "subdirectory", relativePath: "../secret" }), { mode: "subdirectory", relativePath: "" });
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

test("resolves workspace and subdirectory scopes and rejects escapes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-scope-test-"));
  const child = path.join(root, "中文 资料");
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-outside-test-"));
  const linkedOutside = path.join(root, "外部链接");
  await fs.mkdir(child);
  try {
    const workspace = await resolveCodexScopeDirectory({ scope: { mode: "workspace" }, workspacePath: root, tempRoot: os.tmpdir() });
    assert.equal(workspace.cwd, await fs.realpath(root));
    const subdirectory = await resolveCodexScopeDirectory({ scope: { mode: "subdirectory", relativePath: "中文 资料" }, workspacePath: root, tempRoot: os.tmpdir() });
    assert.equal(subdirectory.cwd, await fs.realpath(child));
    await assert.rejects(() => resolveCodexScopeDirectory({ scope: { mode: "subdirectory", relativePath: "../outside" }, workspacePath: root, tempRoot: os.tmpdir() }), /目录范围已失效/);
    await assert.rejects(() => resolveCodexScopeDirectory({ scope: { mode: "document-directory" }, workspacePath: root, documentPath: path.join(outside, "note.letterpaper"), tempRoot: os.tmpdir() }), /目录范围已失效/);
    try {
      await fs.symlink(outside, linkedOutside, process.platform === "win32" ? "junction" : "dir");
      await assert.rejects(() => resolveCodexScopeDirectory({ scope: { mode: "subdirectory", relativePath: "外部链接" }, workspacePath: root, tempRoot: os.tmpdir() }), /目录范围已失效/);
    } catch (error) {
      if (error?.code !== "EPERM") throw error;
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
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
