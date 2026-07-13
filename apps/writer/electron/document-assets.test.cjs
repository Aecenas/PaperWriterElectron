const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const JSZip = require("jszip");
const { createAssetPackager } = require("./asset-packager.cjs");
const { materializeCodexImageAttachments } = require("./codex-image-attachments.cjs");
const {
  assetUrlForDocument,
  cleanupStaleSessions,
  createDocumentAssetRegistry,
  createStagedAssetStore,
  parseAssetUrl,
} = require("./document-assets.cjs");

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";

function nextAssetPath(zip, preferredPath, extension) {
  if (preferredPath && !zip.file(preferredPath)) return preferredPath;
  return `assets/image-0001${extension}`;
}

test("stages the original bytes and keeps them readable after the source is deleted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-assets-test-"));
  const source = path.join(root, "透明原图.gif");
  const original = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 255, 1, 2, 3]);
  await fs.writeFile(source, original);
  const store = createStagedAssetStore({ rootDir: path.join(root, "sessions"), sessionId: SESSION_A });
  try {
    await store.initialize();
    const staged = await store.stage(source, { mime: "image/gif", name: "透明原图.gif" });
    assert.match(staged.src, /^paperwriter-asset:\/\/staged\/[0-9a-f-]+$/i);
    assert.equal(staged.size, original.length);
    assert.deepEqual(await fs.readFile(staged.filePath), original);
    await fs.rm(source);
    assert.deepEqual((await store.read(staged.token)).buffer, original);
    assert.deepEqual(store.parse(staged.src), { kind: "staged", token: staged.token });

    const readProtocolAsset = async (sourceUrl) => {
      const parsed = store.parse(sourceUrl);
      if (!parsed) throw new Error("token 未注册");
      return store.read(parsed.token);
    };
    const zip = new JSZip();
    const packager = createAssetPackager({ zip, readProtocolAsset, nextAssetPath });
    const packagedHtml = await packager.packageHtml(`<img src="${staged.src}">`);
    const packagedPath = /src="([^"]+)"/.exec(packagedHtml)[1];
    assert.deepEqual(await zip.file(packagedPath).async("nodebuffer"), original);

    const attachments = await materializeCodexImageAttachments({
      tempRoot: path.join(root, "codex"),
      images: [{ number: 1, caption: "暂存原图", src: staged.src }],
      readProtocolAsset,
    });
    assert.deepEqual(await fs.readFile(attachments.imagePaths[0]), original);
    await attachments.cleanup();
  } finally {
    await store.cleanupCurrent();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("removes partial temporary and final files when staging copy fails", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-assets-copy-failure-test-"));
  const source = path.join(root, "source.gif");
  const sessions = path.join(root, "sessions");
  await fs.writeFile(source, Buffer.from("complete-original-image"));
  const failingFs = Object.create(fs);
  failingFs.copyFile = async (_sourcePath, destinationPath) => {
    await fs.writeFile(destinationPath, Buffer.from("partial"));
    throw new Error("simulated disk-full copy failure");
  };
  const store = createStagedAssetStore({
    rootDir: sessions,
    sessionId: SESSION_A,
    createToken: () => SESSION_B,
    fsApi: failingFs,
  });
  try {
    await store.initialize();
    await assert.rejects(
      () => store.stage(source, { mime: "image/gif", name: "source.gif" }),
      /simulated disk-full copy failure/,
    );
    assert.deepEqual(await fs.readdir(store.sessionDir), []);
    await assert.rejects(() => fs.stat(path.join(store.sessionDir, `${SESSION_B}.tmp`)));
    await assert.rejects(() => fs.stat(path.join(store.sessionDir, `${SESSION_B}.gif`)));
  } finally {
    await store.cleanupCurrent();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects a same-size modification of a staged resource when it is read", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-assets-integrity-test-"));
  const source = path.join(root, "source.png");
  await fs.writeFile(source, Buffer.from("AAAA"));
  const store = createStagedAssetStore({ rootDir: path.join(root, "sessions"), sessionId: SESSION_A });
  try {
    await store.initialize();
    const staged = await store.stage(source, { mime: "image/png", name: "source.png" });
    await fs.writeFile(staged.filePath, Buffer.from("BBBB"));
    assert.equal((await store.resolve(staged.token)).size, 4);
    await assert.rejects(() => store.read(staged.token), /完整性校验失败/);
  } finally {
    await store.cleanupCurrent();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects forged staged tokens, traversal and malformed document asset paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-assets-security-test-"));
  const store = createStagedAssetStore({ rootDir: path.join(root, "sessions"), sessionId: SESSION_A });
  try {
    await store.initialize();
    assert.equal(store.parse("paperwriter-asset://staged/33333333-3333-4333-8333-333333333333"), null);
    assert.equal(store.parse("paperwriter-asset://staged/..%2Fsecret"), null);
    assert.equal(parseAssetUrl("paperwriter-asset://unknown/value"), null);
    assert.equal(parseAssetUrl("paperwriter-asset://document/C%3A%5Cdoc.letterpaper?asset=..%2Fsecret"), null);
    const registry = createDocumentAssetRegistry({ pathApi: path.win32, platform: "win32", createToken: () => SESSION_B });
    const registered = registry.register("C:\\docs\\paper.letterpaper");
    const documentUrl = assetUrlForDocument(registered.token, "assets/image.png");
    assert.equal(parseAssetUrl(documentUrl), null);
    assert.deepEqual(parseAssetUrl(documentUrl, { resolveDocumentReference: registry.resolve }), {
      kind: "document",
      filePath: "C:\\docs\\paper.letterpaper",
      assetPath: "assets/image.png",
      reference: SESSION_B,
      token: SESSION_B,
    });
    assert.equal(parseAssetUrl("paperwriter-asset://document/%5C%5Cattacker%5Cshare%5Cprobe.letterpaper?asset=assets%2Fpixel.png", { resolveDocumentReference: registry.resolve }), null);
  } finally {
    await store.cleanupCurrent();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rebases registered document tokens without authorizing arbitrary paths", () => {
  const registry = createDocumentAssetRegistry({ pathApi: path.win32, platform: "win32", createToken: () => SESSION_A });
  const url = registry.urlFor("C:\\docs\\old\\paper.letterpaper", "assets/image.png");
  registry.rebasePath("C:\\docs\\old", "D:\\archive\\new");
  const parsed = parseAssetUrl(url, { resolveDocumentReference: registry.resolve });
  assert.equal(parsed.filePath, "D:\\archive\\new\\paper.letterpaper");
  assert.equal(registry.resolve("C:\\docs\\old\\paper.letterpaper").filePath, "D:\\archive\\new\\paper.letterpaper");
  assert.equal(registry.resolve("C:\\secrets\\other.letterpaper"), null);
});

test("revokes registered tokens for a deleted document subtree", () => {
  const tokens = [SESSION_A, SESSION_B];
  const registry = createDocumentAssetRegistry({
    pathApi: path.win32,
    platform: "win32",
    createToken: () => tokens.shift(),
  });
  registry.register("C:\\docs\\folder\\one.letterpaper");
  registry.register("C:\\docs\\other\\two.letterpaper");
  registry.revokePath("C:\\docs\\folder", true);
  assert.equal(registry.resolve(SESSION_A), null);
  assert.equal(registry.resolve(SESSION_B).filePath, "C:\\docs\\other\\two.letterpaper");
});

test("Save As rebasing keeps the live token on the copy and gives the original a fresh token", () => {
  const tokens = [
    SESSION_A,
    SESSION_B,
    "33333333-3333-4333-8333-333333333333",
  ];
  const registry = createDocumentAssetRegistry({
    pathApi: path.win32,
    platform: "win32",
    createToken: () => tokens.shift(),
  });
  const liveUrl = registry.urlFor("C:\\docs\\A.letterpaper", "assets/image.png");
  const preexistingCopyUrl = registry.urlFor("C:\\docs\\B.letterpaper", "assets/image.png");
  registry.rebasePath("C:\\docs\\A.letterpaper", "C:\\docs\\B.letterpaper");

  assert.equal(parseAssetUrl(liveUrl, { resolveDocumentReference: registry.resolve }).filePath, "C:\\docs\\B.letterpaper");
  assert.equal(parseAssetUrl(preexistingCopyUrl, { resolveDocumentReference: registry.resolve }).filePath, "C:\\docs\\B.letterpaper");

  const reopenedOriginalUrl = registry.urlFor("C:\\docs\\A.letterpaper", "assets/image.png");
  assert.notEqual(reopenedOriginalUrl, liveUrl);
  assert.equal(parseAssetUrl(reopenedOriginalUrl, { resolveDocumentReference: registry.resolve }).filePath, "C:\\docs\\A.letterpaper");
});

test("cleans only stale session directories and preserves current and recent sessions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperwriter-assets-cleanup-test-"));
  const oldDir = path.join(root, SESSION_A);
  const recentDir = path.join(root, SESSION_B);
  const current = "33333333-3333-4333-8333-333333333333";
  const currentDir = path.join(root, current);
  const unrelatedDir = path.join(root, "not-a-session");
  await Promise.all([oldDir, recentDir, currentDir, unrelatedDir].map((directory) => fs.mkdir(directory)));
  const now = Date.now();
  const oldDate = new Date(now - 8 * 24 * 60 * 60 * 1000);
  await fs.utimes(oldDir, oldDate, oldDate);
  try {
    const removed = await cleanupStaleSessions(root, { currentSessionId: current, now });
    assert.deepEqual(removed, [SESSION_A]);
    await assert.rejects(() => fs.stat(oldDir));
    await fs.stat(recentDir);
    await fs.stat(currentDir);
    await fs.stat(unrelatedDir);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("refuses stale-session cleanup without an explicit root", async () => {
  await assert.rejects(() => cleanupStaleSessions(""), /缺少图片暂存根目录/);
});
