const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");

const REVISION_CONFLICT_CODE = "DOCUMENT_REVISION_CONFLICT";
const REVISION_UNSTABLE_CODE = "DOCUMENT_REVISION_UNSTABLE";

class DocumentRevisionConflictError extends Error {
  constructor(message = "文档已被其他程序修改", {
    filePath = "",
    expectedRevision = null,
    actualRevision = null,
  } = {}) {
    super(message);
    this.name = "DocumentRevisionConflictError";
    this.code = REVISION_CONFLICT_CODE;
    this.filePath = filePath ? path.resolve(String(filePath)) : "";
    this.expectedRevision = cloneRevision(expectedRevision);
    this.actualRevision = cloneRevision(actualRevision);
  }
}

function cloneRevision(revision) {
  if (revision == null) return null;
  return {
    size: Number(revision.size),
    mtimeMs: Number(revision.mtimeMs),
    sha256: String(revision.sha256 || "").toLowerCase(),
  };
}

function normalizeDiskRevision(revision) {
  if (revision == null) return null;
  const normalized = cloneRevision(revision);
  if (!Number.isSafeInteger(normalized.size) || normalized.size < 0) {
    throw new Error("文档 revision 的文件大小无效");
  }
  if (!Number.isFinite(normalized.mtimeMs) || normalized.mtimeMs < 0) {
    throw new Error("文档 revision 的修改时间无效");
  }
  if (!/^[a-f0-9]{64}$/.test(normalized.sha256)) {
    throw new Error("文档 revision 的 SHA-256 无效");
  }
  return normalized;
}

function diskRevisionsEqual(left, right) {
  if (left == null || right == null) return left == null && right == null;
  let normalizedLeft;
  let normalizedRight;
  try {
    normalizedLeft = normalizeDiskRevision(left);
    normalizedRight = normalizeDiskRevision(right);
  } catch {
    return false;
  }
  return normalizedLeft.size === normalizedRight.size
    && normalizedLeft.mtimeMs === normalizedRight.mtimeMs
    && normalizedLeft.sha256 === normalizedRight.sha256;
}

function assertExpectedRevision(actualRevision, expectedRevision, options = {}) {
  if (diskRevisionsEqual(actualRevision, expectedRevision)) {
    return cloneRevision(actualRevision);
  }
  throw new DocumentRevisionConflictError(options.message, {
    filePath: options.filePath,
    expectedRevision,
    actualRevision,
  });
}

async function hashReadable(readable) {
  const hash = createHash("sha256");
  for await (const chunk of readable) hash.update(chunk);
  return hash.digest("hex");
}

function statSignature(stat) {
  return {
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    dev: stat.dev == null ? null : Number(stat.dev),
    ino: stat.ino == null ? null : Number(stat.ino),
  };
}

function sameStatSignature(left, right) {
  return left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.dev === right.dev
    && left.ino === right.ino;
}

async function readFileSnapshot(filePath, {
  fsApi = fsPromises,
  maxAttempts = 2,
  maxBytes = Number.POSITIVE_INFINITY,
} = {}) {
  const targetPath = path.resolve(String(filePath || ""));
  if (!String(filePath || "")) throw new Error("缺少文档路径");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error("revision 读取重试次数无效");
  }
  if (!(maxBytes === Number.POSITIVE_INFINITY || (Number.isSafeInteger(maxBytes) && maxBytes >= 0))) {
    throw new Error("文件快照大小上限无效");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let handle;
    try {
      handle = await fsApi.open(targetPath, "r");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    try {
      const before = await handle.stat();
      if (!before.isFile()) throw new Error("文件快照目标不是普通文件");
      if (before.size > maxBytes) throw new Error("文件超过安全读取上限");
      const buffer = await handle.readFile();
      const after = await handle.stat();
      if (
        buffer.length === after.size
        && sameStatSignature(statSignature(before), statSignature(after))
      ) {
        return {
          buffer,
          stat: after,
          revision: normalizeDiskRevision({
            size: buffer.length,
            mtimeMs: after.mtimeMs,
            sha256: createHash("sha256").update(buffer).digest("hex"),
          }),
        };
      }
    } finally {
      await handle.close();
    }
  }

  const error = new Error("文档在读取文件快照时持续发生变化");
  error.code = REVISION_UNSTABLE_CODE;
  throw error;
}

async function readDiskRevision(filePath, {
  fsApi = fsPromises,
  createReadStream = fs.createReadStream,
  maxAttempts = 2,
} = {}) {
  const targetPath = path.resolve(String(filePath || ""));
  if (!String(filePath || "")) throw new Error("缺少文档路径");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new Error("revision 读取重试次数无效");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let before;
    try {
      before = await fsApi.stat(targetPath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    if (!before.isFile()) throw new Error("revision 目标不是文件");
    const beforeSignature = statSignature(before);
    const sha256 = await hashReadable(createReadStream(targetPath));
    let after;
    try {
      after = await fsApi.stat(targetPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        if (attempt < maxAttempts) continue;
        const unstable = new Error("文档在读取 revision 时被移除");
        unstable.code = REVISION_UNSTABLE_CODE;
        throw unstable;
      }
      throw error;
    }
    const afterSignature = statSignature(after);
    if (sameStatSignature(beforeSignature, afterSignature)) {
      return normalizeDiskRevision({ ...afterSignature, sha256 });
    }
  }

  const error = new Error("文档在读取 revision 时持续发生变化");
  error.code = REVISION_UNSTABLE_CODE;
  throw error;
}

async function assertDiskRevision(filePath, expectedRevision, options = {}) {
  const actualRevision = await readDiskRevision(filePath, options);
  return assertExpectedRevision(actualRevision, expectedRevision, { filePath, message: options.message });
}

function formatConflictTimestamp(date = new Date()) {
  const resolved = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(resolved.getTime())) throw new Error("冲突副本时间无效");
  const pad = (value) => String(value).padStart(2, "0");
  return `${resolved.getFullYear()}${pad(resolved.getMonth() + 1)}${pad(resolved.getDate())}_${pad(resolved.getHours())}${pad(resolved.getMinutes())}${pad(resolved.getSeconds())}`;
}

function truncateUtf16(value, maximumCodeUnits) {
  const source = String(value || "");
  if (source.length <= maximumCodeUnits) return source;
  let result = source.slice(0, Math.max(1, maximumCodeUnits));
  if (/^[\uD800-\uDBFF]$/.test(result.at(-1))) result = result.slice(0, -1);
  return result;
}

function createConflictCopyPath(filePath, {
  date = new Date(),
  sequence = 0,
  label = "本机冲突副本",
  maxFileNameCharacters = 240,
  pathApi = path,
} = {}) {
  const targetPath = pathApi.resolve(String(filePath || ""));
  if (!String(filePath || "")) throw new Error("缺少冲突文档路径");
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 9999) {
    throw new Error("冲突副本序号无效");
  }
  if (!Number.isSafeInteger(maxFileNameCharacters) || maxFileNameCharacters < 80 || maxFileNameCharacters > 255) {
    throw new Error("冲突副本文件名上限无效");
  }
  const safeLabel = truncateUtf16(String(label || "本机冲突副本")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/[. ]+$/g, "")
    .trim() || "本机冲突副本", 60).replace(/[. ]+$/g, "") || "本机冲突副本";
  const parsed = pathApi.parse(targetPath);
  const suffix = `_${safeLabel}_${formatConflictTimestamp(date)}${sequence ? `_${sequence + 1}` : ""}`;
  const availableStemCharacters = Math.max(1, maxFileNameCharacters - `${suffix}${parsed.ext}`.length);
  const stem = truncateUtf16(parsed.name, availableStemCharacters).replace(/[. ]+$/g, "") || "未命名信笺";
  return pathApi.join(parsed.dir, `${stem}${suffix}${parsed.ext}`);
}

module.exports = {
  DocumentRevisionConflictError,
  REVISION_CONFLICT_CODE,
  REVISION_UNSTABLE_CODE,
  assertDiskRevision,
  assertExpectedRevision,
  createConflictCopyPath,
  diskRevisionsEqual,
  formatConflictTimestamp,
  normalizeDiskRevision,
  readFileSnapshot,
  readDiskRevision,
};
