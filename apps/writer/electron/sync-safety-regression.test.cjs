const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { readFileSnapshot } = require("./document-revision.cjs");

async function sourceOf(fileName) {
  return fs.readFile(path.join(__dirname, fileName), "utf8");
}

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return source.slice(start, end);
}

function indexInOrder(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker, previous + 1);
    assert.ok(current > previous, `expected marker after previous boundary: ${marker}`);
    previous = current;
  }
}

test("file snapshots retry an unstable handle and bind the revision to the returned bytes", async () => {
  const attempts = [];
  const buffers = [Buffer.from("旧稿"), Buffer.from("稳定的新稿")];
  const stats = [
    [
      { size: buffers[0].length, mtimeMs: 10, dev: 1, ino: 2 },
      { size: buffers[0].length + 1, mtimeMs: 11, dev: 1, ino: 2 },
    ],
    [
      { size: buffers[1].length, mtimeMs: 20, dev: 1, ino: 2 },
      { size: buffers[1].length, mtimeMs: 20, dev: 1, ino: 2 },
    ],
  ];
  const fsApi = {
    async open() {
      const attempt = attempts.length;
      let statRead = 0;
      const events = [];
      attempts.push(events);
      return {
        async stat() {
          events.push(`stat-${statRead}`);
          return { ...stats[attempt][statRead++], isFile: () => true };
        },
        async readFile() {
          events.push("read");
          return buffers[attempt];
        },
        async close() {
          events.push("close");
        },
      };
    },
  };

  const snapshot = await readFileSnapshot("C:\\同步\\快照.letterpaper", { fsApi, maxAttempts: 2 });
  assert.equal(attempts.length, 2, "an unstable first read must be discarded and retried");
  assert.deepEqual(attempts, [
    ["stat-0", "read", "stat-1", "close"],
    ["stat-0", "read", "stat-1", "close"],
  ]);
  assert.equal(snapshot.buffer.toString("utf8"), "稳定的新稿");
  assert.equal(snapshot.revision.size, snapshot.buffer.length);
  assert.equal(snapshot.revision.mtimeMs, 20);
  assert.equal(snapshot.revision.sha256, createHash("sha256").update(snapshot.buffer).digest("hex"));
});

test("save checks the expected revision twice, including explicit overwrite, and verifies committed bytes", async () => {
  const main = await sourceOf("main.cjs");
  const writer = between(main, "async function savePaperDocumentWithinMutation", "async function savePaperDocument(filePath");
  assert.equal((writer.match(/await validateTarget\(targetPath\)/g) || []).length, 2);
  indexInOrder(writer, [
    "await validateTarget(targetPath)",
    "const normalized = normalizeDocument(document)",
    "preflightZipBuffer(output)",
    "if (typeof validateTarget === \"function\") await validateTarget(targetPath)",
    "await atomicWriteFile(targetPath, output)",
    "const committedRevision = await readDiskRevision(targetPath)",
    "const outputSha256 = createHash(\"sha256\").update(output).digest(\"hex\")",
  ]);
  assert.match(writer, /committedRevision\.size !== output\.length/);
  assert.match(writer, /committedRevision\.sha256 !== outputSha256/);
  assert.match(writer, /throw new DocumentRevisionConflictError\("工作区文件在写入完成后立即被外部版本替换"/);

  const handler = between(main, 'ipcMain.handle("document:save"', "function exportSafeName");
  assert.match(handler, /expectedRevision\s*=\s*null,\s*saveOptions\s*=\s*\{\}/);
  assert.match(handler, /await assertDiskRevision\(filePath, expectedRevision\)/);
  assert.match(handler, /validateTarget:\s*async \(targetPath\) => \{[\s\S]*await assertDiskRevision\(authorizedTarget, expectedRevision\)/);
  assert.doesNotMatch(handler, /conflictAction\s*!==\s*["']overwrite["']/);
  assert.doesNotMatch(handler, /conflictAction\s*===\s*["']overwrite["'][\s\S]{0,160}(?:return|skip|bypass)/i);
  assert.doesNotMatch(handler, /saveOptions[^\n]*(?:overwrite|conflictAction)/);
});

test(".jianjian is hidden from listings and rejected by every mutable file-tree route", async () => {
  const main = await sourceOf("main.cjs");
  const helperSource = between(main, "function isReservedWorkspaceMetadataPath", "function assertMutableWorkspaceEntry");
  const isReserved = vm.runInNewContext(`const path = require("node:path"); ${helperSource}; isReservedWorkspaceMetadataPath`, {
    require,
  });
  assert.equal(isReserved(path.join(process.cwd(), "工作区", ".jianjian")), true);
  assert.equal(isReserved(path.join(process.cwd(), "工作区", ".JianJian", "research", "资料.pdf")), true);
  assert.equal(isReserved(path.join(process.cwd(), "工作区", "普通文件夹", "稿件.letterpaper")), false);
  assert.equal(isReserved(path.join(process.cwd(), "工作区", ".jianjian-备份")), false);

  const createFolder = between(main, 'ipcMain.handle("folder:create"', 'ipcMain.handle("document:create-in-folder"');
  assert.match(createFolder, /folderName\.toLocaleLowerCase\("en-US"\) === "\.jianjian"/);
  assert.match(createFolder, /assertMutableWorkspaceEntry\(authorizedParent\)/);
  assert.match(createFolder, /assertMutableWorkspaceEntry\(targetPath\)/);

  const createDocument = between(main, 'ipcMain.handle("document:create-in-folder"', 'ipcMain.handle("entry:rename"');
  assert.match(createDocument, /assertMutableWorkspaceEntry\(authorizedFolder\)/);

  const rename = between(main, 'ipcMain.handle("entry:rename"', 'ipcMain.handle("entry:delete"');
  assert.match(rename, /assertMutableWorkspaceEntry\(currentPath\)/);
  assert.match(rename, /assertMutableWorkspaceEntry\(nextPath\)/);

  const remove = between(main, 'ipcMain.handle("entry:delete"', 'ipcMain.handle("entry:move"');
  assert.match(remove, /assertMutableWorkspaceEntry\(currentPath\)/);

  const move = between(main, 'ipcMain.handle("entry:move"', 'ipcMain.handle("document:backup"');
  assert.match(move, /assertMutableWorkspaceEntry\(fromPath\)/);
  assert.match(move, /assertMutableWorkspaceEntry\(toFolder\)/);

  const list = between(main, "async function listFolderEntries", "async function preservePreV2MigrationBackup");
  indexInOrder(list, [
    "if (isReservedWorkspaceMetadataPath(folderPath))",
    "await fs.readdir(folderPath",
    'if (entry.name.toLocaleLowerCase("en-US") === ".jianjian") continue',
  ]);

  const listHandler = between(main, 'ipcMain.handle("folder:list"', 'ipcMain.handle("folder:copy-path"');
  assert.match(listHandler, /const listed = await listFolderEntries\(authorizedPath\)/);
});
