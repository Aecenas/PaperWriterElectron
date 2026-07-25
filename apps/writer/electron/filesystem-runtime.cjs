const nodeFs = require("node:fs/promises");
const nodePath = require("node:path");

const { createFilesystemAccessRegistry } = require("./filesystem-access.cjs");
const {
  atomicWriteFile: defaultAtomicWriteFile,
  createPathWriteQueue,
} = require("./document-storage.cjs");

const FILESYSTEM_ACCESS_FILE = "filesystem-access.json";

function createFilesystemRuntime({
  app,
  fs = nodeFs,
  path = nodePath,
  platform = process.platform,
  atomicWriteFile = defaultAtomicWriteFile,
  createAccessRegistry = createFilesystemAccessRegistry,
  createWriteQueue = createPathWriteQueue,
  isSupportedDocument,
  isInternalAutosaveSessionDocument = async () => false,
  writeDebugLog = async () => {},
}) {
  const filesystemAccessWriteQueue = createWriteQueue({
    pathApi: path,
    platform,
  });
  const filesystemAccess = createAccessRegistry({
    pathApi: path,
    platform,
  });

  function defaultDocumentsDir() {
    return path.join(app.getPath("documents"), "PaperWriter");
  }

  function filesystemAccessPath() {
    return path.join(app.getPath("userData"), FILESYSTEM_ACCESS_FILE);
  }

  async function persistFilesystemAccess() {
    const filePath = filesystemAccessPath();
    return filesystemAccessWriteQueue.run(filePath, async () => {
      await atomicWriteFile(
        filePath,
        `${JSON.stringify(filesystemAccess.serialize(), null, 2)}\n`,
      );
    });
  }

  async function initializeFilesystemAccess() {
    try {
      const raw = await fs.readFile(filesystemAccessPath(), "utf8");
      filesystemAccess.load(JSON.parse(raw));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        void writeDebugLog("filesystem:access-load-error", {
          message: error?.message,
        });
      }
    }
    await fs.mkdir(defaultDocumentsDir(), { recursive: true });
    filesystemAccess.authorizeRoot(await fs.realpath(defaultDocumentsDir()));
  }

  async function canonicalExistingPath(value, expectedType = "") {
    const resolved = await fs.realpath(path.resolve(String(value || "")));
    const stat = await fs.stat(resolved);
    if (expectedType === "directory" && !stat.isDirectory()) {
      throw new Error("目标不是文件夹");
    }
    if (expectedType === "file" && !stat.isFile()) {
      throw new Error("目标不是文件");
    }
    return resolved;
  }

  async function authorizeFilesystemRoot(value) {
    const resolved = await canonicalExistingPath(value, "directory");
    filesystemAccess.authorizeRoot(resolved);
    await persistFilesystemAccess();
    return resolved;
  }

  async function resolveDocumentTargetPath(value) {
    const requested = path.resolve(String(value || ""));
    try {
      return await canonicalExistingPath(requested, "file");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = await canonicalExistingPath(
        path.dirname(requested),
        "directory",
      );
      return path.join(parent, path.basename(requested));
    }
  }

  async function authorizeDocumentPath(value, { mustExist = true } = {}) {
    const resolved = mustExist
      ? await canonicalExistingPath(value, "file")
      : await resolveDocumentTargetPath(value);
    if (!isSupportedDocument(resolved)) {
      throw new Error("只能授权信笺文档");
    }
    filesystemAccess.authorizeDocument(resolved);
    await persistFilesystemAccess();
    return resolved;
  }

  async function assertAuthorizedDirectory(value) {
    const resolved = await canonicalExistingPath(value, "directory");
    if (!filesystemAccess.canAccessDirectory(resolved)) {
      throw new Error(
        "这个文件夹尚未由用户授权，请通过“打开文件夹”选择它",
      );
    }
    return resolved;
  }

  async function assertAuthorizedDocument(value) {
    const resolved = await canonicalExistingPath(value, "file");
    if (
      !isSupportedDocument(resolved)
      || !filesystemAccess.canAccessDocument(resolved)
    ) {
      throw new Error(
        "这个信笺路径尚未由用户授权，请通过“打开信笺”选择它",
      );
    }
    return resolved;
  }

  async function resolveAuthorizedOpenDocument(value) {
    const resolved = await canonicalExistingPath(value, "file");
    if (await isInternalAutosaveSessionDocument(resolved)) return resolved;
    if (
      !isSupportedDocument(resolved)
      || !filesystemAccess.canAccessDocument(resolved)
    ) {
      throw new Error(
        "这个信笺路径尚未由用户授权，请通过“打开信笺”选择它",
      );
    }
    return resolved;
  }

  async function assertAuthorizedDocumentTarget(value) {
    const resolved = await resolveDocumentTargetPath(value);
    if (
      !isSupportedDocument(resolved)
      || !filesystemAccess.canAccessDocument(resolved)
    ) {
      throw new Error("这个信笺保存位置尚未由用户授权");
    }
    return resolved;
  }

  async function assertAuthorizedEntry(
    value,
    { destructive = false } = {},
  ) {
    const resolved = await canonicalExistingPath(value);
    const stat = await fs.stat(resolved);
    const allowed = stat.isDirectory()
      ? filesystemAccess.canAccessDirectory(resolved)
      : (
        stat.isFile()
        && isSupportedDocument(resolved)
        && filesystemAccess.canAccessDocument(resolved)
      );
    if (!allowed) throw new Error("目标超出已授权的信笺工作区");
    if (
      destructive
      && stat.isDirectory()
      && filesystemAccess.isRoot(resolved)
    ) {
      throw new Error("不能直接修改或删除已授权工作区的根目录");
    }
    return { path: resolved, stat };
  }

  function canAccessDirectory(value) {
    return filesystemAccess.canAccessDirectory(value);
  }

  async function rebaseFilesystemAccess(fromPath, toPath) {
    filesystemAccess.rebase(fromPath, toPath);
    await persistFilesystemAccess();
  }

  async function revokeFilesystemAccess(value, includeChildren = false) {
    filesystemAccess.revoke(value, includeChildren);
    await persistFilesystemAccess();
  }

  return {
    assertAuthorizedDirectory,
    assertAuthorizedDocument,
    assertAuthorizedDocumentTarget,
    assertAuthorizedEntry,
    authorizeDocumentPath,
    authorizeFilesystemRoot,
    canAccessDirectory,
    canonicalExistingPath,
    defaultDocumentsDir,
    initializeFilesystemAccess,
    persistFilesystemAccess,
    rebaseFilesystemAccess,
    resolveAuthorizedOpenDocument,
    resolveDocumentTargetPath,
    revokeFilesystemAccess,
  };
}

module.exports = {
  createFilesystemRuntime,
};
