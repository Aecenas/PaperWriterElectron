const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createFilesystemAccessRegistry, sanitizeFilesystemName } = require("./filesystem-access.cjs");

test("sanitizes traversal, reserved devices and trailing Windows path syntax", () => {
  assert.equal(sanitizeFilesystemName("..", "safe"), "safe");
  assert.equal(sanitizeFilesystemName("CON.txt", "safe"), "safe");
  assert.equal(sanitizeFilesystemName("chapter.  ", "safe"), "chapter");
  assert.equal(sanitizeFilesystemName("a/b\\c", "safe"), "abc");
});

test("authorizes only selected roots and explicit documents on Windows", () => {
  const access = createFilesystemAccessRegistry({ pathApi: path.win32, platform: "win32" });
  access.authorizeRoot("C:\\Writing\\Project");
  access.authorizeDocument("D:\\Letters\\one.letterpaper");
  assert.equal(access.canAccessDirectory("c:/writing/project/chapters"), true);
  assert.equal(access.canAccessDirectory("C:\\Writing\\Project-Evil"), false);
  assert.equal(access.canAccessDocument("D:\\letters\\ONE.letterpaper"), true);
  assert.equal(access.canAccessDocument("D:\\letters\\two.letterpaper"), false);
  assert.equal(access.isRoot("c:\\WRITING\\project"), true);
  assert.equal(access.parentIsAccessible("C:\\Writing\\Project\\chapter"), true);
});

test("rebases and revokes path capabilities for moved trees", () => {
  const access = createFilesystemAccessRegistry({ pathApi: path.win32, platform: "win32" });
  access.authorizeRoot("C:\\Writing\\Project");
  access.authorizeDocument("C:\\Writing\\Project\\one.letterpaper");
  access.rebase("C:\\Writing\\Project", "D:\\Archive\\Project");
  assert.equal(access.canAccessDirectory("C:\\Writing\\Project"), false);
  assert.equal(access.canAccessDocument("D:\\Archive\\Project\\one.letterpaper"), true);
  access.revoke("D:\\Archive\\Project", true);
  assert.deepEqual(access.serialize(), { version: 1, roots: [], documents: [] });
});

test("bounds persisted capabilities", () => {
  const access = createFilesystemAccessRegistry({ pathApi: path.win32, platform: "win32", maximumRoots: 2, maximumDocuments: 2 });
  access.load({
    roots: ["C:\\one", "C:\\two", "C:\\three"],
    documents: ["D:\\one.letterpaper", "D:\\two.letterpaper", "D:\\three.letterpaper"],
  });
  assert.deepEqual(access.serialize(), {
    version: 1,
    roots: ["C:\\two", "C:\\three"],
    documents: ["D:\\two.letterpaper", "D:\\three.letterpaper"],
  });
});
