const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const { createFilesystemRuntime } = require("./filesystem-runtime.cjs");

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness({
  accessFile = null,
  atomicWriteFile,
  isInternalAutosaveSessionDocument = async () => false,
} = {}) {
  const pathApi = path.win32;
  const entries = new Map();
  const calls = {
    atomicWrites: [],
    logs: [],
    mkdir: [],
    reads: [],
    realpaths: [],
    stats: [],
  };
  const keyFor = (value) => (
    pathApi.resolve(String(value)).toLocaleLowerCase("en-US")
  );
  const addEntry = (value, kind, canonicalPath = pathApi.resolve(value)) => {
    entries.set(keyFor(value), {
      canonicalPath,
      kind,
    });
    entries.set(keyFor(canonicalPath), {
      canonicalPath,
      kind,
    });
    return canonicalPath;
  };
  const missingError = (targetPath) => Object.assign(
    new Error(`missing: ${targetPath}`),
    { code: "ENOENT" },
  );
  const app = {
    getPath(name) {
      if (name === "documents") return "C:\\Users\\Writer\\Documents";
      if (name === "userData") return "C:\\Users\\Writer\\AppData";
      throw new Error(`unexpected app path: ${name}`);
    },
  };
  const fs = {
    async readFile(filePath, encoding) {
      calls.reads.push([filePath, encoding]);
      if (accessFile instanceof Error) throw accessFile;
      if (accessFile === null) throw missingError(filePath);
      return accessFile;
    },
    async mkdir(folderPath, options) {
      calls.mkdir.push([folderPath, options]);
      addEntry(folderPath, "directory");
    },
    async realpath(targetPath) {
      calls.realpaths.push(targetPath);
      const entry = entries.get(keyFor(targetPath));
      if (!entry) throw missingError(targetPath);
      return entry.canonicalPath;
    },
    async stat(targetPath) {
      calls.stats.push(targetPath);
      const entry = entries.get(keyFor(targetPath));
      if (!entry) throw missingError(targetPath);
      return {
        isDirectory: () => entry.kind === "directory",
        isFile: () => entry.kind === "file",
      };
    },
  };
  const write = atomicWriteFile || (async (filePath, contents) => {
    calls.atomicWrites.push([filePath, contents]);
  });
  const runtime = createFilesystemRuntime({
    app,
    fs,
    path: pathApi,
    platform: "win32",
    atomicWriteFile: write,
    isSupportedDocument: (filePath) => (
      [".letterpaper", ".paperwriter"].includes(
        pathApi.extname(filePath).toLocaleLowerCase("en-US"),
      )
    ),
    isInternalAutosaveSessionDocument,
    writeDebugLog: async (...args) => {
      calls.logs.push(args);
    },
  });
  return {
    addDirectory(value, canonicalPath) {
      return addEntry(value, "directory", canonicalPath);
    },
    addFile(value, canonicalPath) {
      return addEntry(value, "file", canonicalPath);
    },
    calls,
    pathApi,
    runtime,
  };
}

test("initialization restores access, authorizes the exact default documents root, and does not persist it", async () => {
  const harness = createHarness({
    accessFile: JSON.stringify({
      version: 1,
      roots: ["C:\\Saved"],
      documents: ["C:\\Loose\\Draft.letterpaper"],
    }),
  });
  harness.addDirectory("C:\\Saved");
  harness.addDirectory("C:\\Saved\\Notes");
  harness.addFile("C:\\Loose\\Draft.letterpaper");

  assert.equal(
    harness.runtime.defaultDocumentsDir(),
    "C:\\Users\\Writer\\Documents\\PaperWriter",
  );
  await harness.runtime.initializeFilesystemAccess();

  assert.deepEqual(harness.calls.reads, [[
    "C:\\Users\\Writer\\AppData\\filesystem-access.json",
    "utf8",
  ]]);
  assert.deepEqual(harness.calls.mkdir, [[
    "C:\\Users\\Writer\\Documents\\PaperWriter",
    { recursive: true },
  ]]);
  assert.equal(
    await harness.runtime.assertAuthorizedDirectory("c:\\saved\\notes"),
    "C:\\Saved\\Notes",
  );
  assert.equal(
    await harness.runtime.assertAuthorizedDirectory(
      "c:\\users\\writer\\documents\\paperwriter",
    ),
    "C:\\Users\\Writer\\Documents\\PaperWriter",
  );
  assert.equal(
    await harness.runtime.assertAuthorizedDocument(
      "c:\\loose\\draft.letterpaper",
    ),
    "C:\\Loose\\Draft.letterpaper",
  );
  assert.deepEqual(harness.calls.atomicWrites, []);
});

test("initialization logs malformed persisted state, ignores ENOENT, and still authorizes the default root", async () => {
  const malformed = createHarness({ accessFile: "{not-json" });
  await malformed.runtime.initializeFilesystemAccess();
  assert.equal(malformed.calls.logs.length, 1);
  assert.equal(
    malformed.calls.logs[0][0],
    "filesystem:access-load-error",
  );
  assert.equal(
    typeof malformed.calls.logs[0][1].message,
    "string",
  );
  assert.notEqual(malformed.calls.logs[0][1].message, "");
  assert.equal(
    malformed.runtime.canAccessDirectory(
      "C:\\Users\\Writer\\Documents\\PaperWriter\\Drafts",
    ),
    true,
  );

  const missing = createHarness();
  await missing.runtime.initializeFilesystemAccess();
  assert.deepEqual(missing.calls.logs, []);
  assert.equal(
    missing.runtime.canAccessDirectory(
      "C:\\Users\\Writer\\Documents\\PaperWriter",
    ),
    true,
  );
});

test("root and document authorization canonicalize paths and atomically persist the unchanged schema", async () => {
  const harness = createHarness();
  harness.addDirectory("C:\\workspace", "C:\\Workspace");
  harness.addDirectory("C:\\workspace\\notes", "C:\\Workspace\\Notes");
  harness.addFile(
    "C:\\outside\\draft.letterpaper",
    "C:\\Outside\\Draft.letterpaper",
  );

  assert.equal(
    await harness.runtime.authorizeFilesystemRoot("c:\\WORKSPACE"),
    "C:\\Workspace",
  );
  assert.equal(
    await harness.runtime.assertAuthorizedDirectory("c:\\workspace\\NOTES"),
    "C:\\Workspace\\Notes",
  );
  assert.equal(
    await harness.runtime.authorizeDocumentPath(
      "c:\\OUTSIDE\\draft.letterpaper",
    ),
    "C:\\Outside\\Draft.letterpaper",
  );
  assert.equal(
    await harness.runtime.assertAuthorizedDocument(
      "C:\\outside\\DRAFT.letterpaper",
    ),
    "C:\\Outside\\Draft.letterpaper",
  );

  assert.equal(harness.calls.atomicWrites.length, 2);
  const [filePath, contents] = harness.calls.atomicWrites.at(-1);
  assert.equal(
    filePath,
    "C:\\Users\\Writer\\AppData\\filesystem-access.json",
  );
  assert.equal(contents.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(contents), {
    version: 1,
    roots: ["C:\\Workspace"],
    documents: ["C:\\Outside\\Draft.letterpaper"],
  });
});

test("nonexistent document targets canonicalize only their parent and remain Windows case-insensitive", async () => {
  const harness = createHarness();
  harness.addDirectory("C:\\workspace", "C:\\Workspace");

  assert.equal(
    await harness.runtime.resolveDocumentTargetPath(
      "c:\\workspace\\New.letterpaper",
    ),
    "C:\\Workspace\\New.letterpaper",
  );
  assert.equal(
    await harness.runtime.authorizeDocumentPath(
      "c:\\workspace\\New.letterpaper",
      { mustExist: false },
    ),
    "C:\\Workspace\\New.letterpaper",
  );
  assert.equal(
    await harness.runtime.assertAuthorizedDocumentTarget(
      "C:\\WORKSPACE\\new.letterpaper",
    ),
    "C:\\Workspace\\new.letterpaper",
  );
  await assert.rejects(
    harness.runtime.authorizeDocumentPath(
      "C:\\Workspace\\notes.txt",
      { mustExist: false },
    ),
    /只能授权信笺文档/,
  );
});

test("open authorization preserves the internal autosave bypass without weakening normal document checks", async () => {
  const harness = createHarness({
    isInternalAutosaveSessionDocument: async (filePath) => (
      filePath === "C:\\Autosave\\Session\\tab.letterpaper"
    ),
  });
  harness.addFile("C:\\Autosave\\Session\\tab.letterpaper");
  harness.addFile("C:\\Outside\\Draft.letterpaper");

  assert.equal(
    await harness.runtime.resolveAuthorizedOpenDocument(
      "C:\\Autosave\\Session\\tab.letterpaper",
    ),
    "C:\\Autosave\\Session\\tab.letterpaper",
  );
  await assert.rejects(
    harness.runtime.resolveAuthorizedOpenDocument(
      "C:\\Outside\\Draft.letterpaper",
    ),
    /这个信笺路径尚未由用户授权/,
  );
});

test("entry access accepts authorized folders and documents but protects roots and unsupported files", async () => {
  const harness = createHarness();
  harness.addDirectory("C:\\Workspace");
  harness.addDirectory("C:\\Workspace\\Notes");
  harness.addFile("C:\\Workspace\\Draft.letterpaper");
  harness.addFile("C:\\Workspace\\notes.txt");
  await harness.runtime.authorizeFilesystemRoot("C:\\Workspace");

  const folder = await harness.runtime.assertAuthorizedEntry(
    "c:\\workspace\\notes",
  );
  assert.equal(folder.path, "C:\\Workspace\\Notes");
  assert.equal(folder.stat.isDirectory(), true);

  const document = await harness.runtime.assertAuthorizedEntry(
    "c:\\workspace\\draft.letterpaper",
    { destructive: true },
  );
  assert.equal(document.path, "C:\\Workspace\\Draft.letterpaper");
  assert.equal(document.stat.isFile(), true);

  await assert.rejects(
    harness.runtime.assertAuthorizedEntry(
      "C:\\Workspace",
      { destructive: true },
    ),
    /不能直接修改或删除已授权工作区的根目录/,
  );
  await assert.rejects(
    harness.runtime.assertAuthorizedEntry("C:\\Workspace\\notes.txt"),
    /目标超出已授权的信笺工作区/,
  );
});

test("rebase and revoke mutate the private registry before persisting each new state", async () => {
  const harness = createHarness();
  harness.addDirectory("C:\\Workspace");
  harness.addFile("C:\\Workspace\\Draft.letterpaper");
  await harness.runtime.authorizeFilesystemRoot("C:\\Workspace");
  await harness.runtime.authorizeDocumentPath(
    "C:\\Workspace\\Draft.letterpaper",
  );
  harness.calls.atomicWrites.length = 0;

  await harness.runtime.rebaseFilesystemAccess(
    "c:\\workspace",
    "D:\\Archive",
  );
  assert.deepEqual(
    JSON.parse(harness.calls.atomicWrites[0][1]),
    {
      version: 1,
      roots: ["D:\\Archive"],
      documents: ["D:\\Archive\\Draft.letterpaper"],
    },
  );

  await harness.runtime.revokeFilesystemAccess("d:\\ARCHIVE", true);
  assert.deepEqual(
    JSON.parse(harness.calls.atomicWrites[1][1]),
    {
      version: 1,
      roots: [],
      documents: [],
    },
  );
  assert.equal(
    harness.runtime.canAccessDirectory("D:\\Archive\\Notes"),
    false,
  );
});

test("filesystem access persistence is serialized through one path queue", async () => {
  const firstWriteStarted = deferred();
  const releaseFirstWrite = deferred();
  let activeWrites = 0;
  let maximumActiveWrites = 0;
  let writeCount = 0;
  const harness = createHarness({
    atomicWriteFile: async () => {
      writeCount += 1;
      activeWrites += 1;
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
      if (writeCount === 1) {
        firstWriteStarted.resolve();
        await releaseFirstWrite.promise;
      }
      activeWrites -= 1;
    },
  });

  const first = harness.runtime.persistFilesystemAccess();
  await firstWriteStarted.promise;
  const second = harness.runtime.persistFilesystemAccess();
  await Promise.resolve();
  assert.equal(writeCount, 1);
  releaseFirstWrite.resolve();
  await Promise.all([first, second]);

  assert.equal(writeCount, 2);
  assert.equal(maximumActiveWrites, 1);
});

test("runtime uniquely owns access storage and main creates one singleton for narrow method assembly", async () => {
  const runtimeSource = await fsPromises.readFile(
    path.join(__dirname, "filesystem-runtime.cjs"),
    "utf8",
  );
  const mainSource = await fsPromises.readFile(
    path.join(__dirname, "main.cjs"),
    "utf8",
  );
  const workspaceSource = await fsPromises.readFile(
    path.join(__dirname, "workspace-folder-ipc.cjs"),
    "utf8",
  );

  assert.match(
    runtimeSource,
    /const FILESYSTEM_ACCESS_FILE = "filesystem-access\.json"/,
  );
  assert.match(
    runtimeSource,
    /const filesystemAccessWriteQueue = createWriteQueue\(\{/,
  );
  assert.match(
    runtimeSource,
    /const filesystemAccess = createAccessRegistry\(\{/,
  );
  assert.match(
    runtimeSource,
    /filesystemAccessWriteQueue\.run\(filePath,[\s\S]*atomicWriteFile\(/,
  );
  assert.equal(
    (mainSource.match(/createFilesystemRuntime\(\{/g) || []).length,
    1,
  );
  assert.match(
    mainSource,
    /const filesystemRuntime = createFilesystemRuntime\(\{/,
  );
  assert.doesNotMatch(
    mainSource,
    /FILESYSTEM_ACCESS_FILE|filesystemAccessWriteQueue|createFilesystemAccessRegistry/,
  );
  assert.doesNotMatch(
    mainSource,
    /function (?:filesystemAccessPath|persistFilesystemAccess|initializeFilesystemAccess|canonicalExistingPath|authorizeFilesystemRoot|resolveDocumentTargetPath|authorizeDocumentPath|assertAuthorizedDirectory|assertAuthorizedDocument|resolveAuthorizedOpenDocument|assertAuthorizedDocumentTarget|assertAuthorizedEntry)/,
  );
  assert.match(mainSource, /registerWorkspaceFolderIpcHandlers\(\{[\s\S]*filesystemRuntime,/);
  assert.doesNotMatch(workspaceSource, /\bfilesystemAccess\b|persistFilesystemAccess/);
  assert.match(
    workspaceSource,
    /transaction\.rebaseDocumentPath\(\s*currentPath,\s*nextPath,[\s\S]*await rebaseFilesystemAccess\(currentPath, nextPath\)/,
  );
  assert.match(
    workspaceSource,
    /transaction\.invalidateDocumentPath\(\s*currentPath,[\s\S]*await revokeFilesystemAccess\(/,
  );
});
