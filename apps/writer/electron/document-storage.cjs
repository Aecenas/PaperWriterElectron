const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Transform } = require("node:stream");

const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntries: 2048,
  maxDocumentJsonBytes: 32 * 1024 * 1024,
  maxAssetBytes: 512 * 1024 * 1024,
  maxExpandedBytes: 512 * 1024 * 1024,
  maxDocumentJsonRatio: 100,
  maxAssetRatio: 500,
  maxArchiveRatio: 500,
});

function normalizedPathKey(filePath, pathApi = path, platform = process.platform) {
  const rawPath = String(filePath || "");
  if (!rawPath) throw new Error("缺少文件路径");
  const resolved = pathApi.resolve(rawPath);
  return platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
}

function createPathWriteQueue({ pathApi = path, platform = process.platform } = {}) {
  const pending = new Map();
  const run = async (filePath, task) => {
    if (typeof task !== "function") throw new Error("缺少文件写入任务");
    const key = normalizedPathKey(filePath, pathApi, platform);
    const previous = pending.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);
    pending.set(key, current);
    try {
      return await current;
    } finally {
      if (pending.get(key) === current) pending.delete(key);
    }
  };
  return { run, size: () => pending.size };
}

async function atomicWriteFile(filePath, data, {
  fsApi = fs,
  pathApi = path,
  createId = randomUUID,
} = {}) {
  const rawPath = String(filePath || "");
  if (!rawPath) throw new Error("缺少写入路径");
  const targetPath = pathApi.resolve(rawPath);
  const directory = pathApi.dirname(targetPath);
  const temporaryPath = pathApi.join(directory, `.${pathApi.basename(targetPath)}.${createId()}.tmp`);
  await fsApi.mkdir(directory, { recursive: true });
  let handle;
  try {
    handle = await fsApi.open(temporaryPath, "wx");
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fsApi.rename(temporaryPath, targetPath);
    return targetPath;
  } catch (error) {
    try { await handle?.close(); } catch { /* Best effort. */ }
    try { await fsApi.rm(temporaryPath, { force: true }); } catch { /* Best effort. */ }
    throw error;
  }
}

function zipEntrySizes(entry) {
  const compressedSize = Number(entry?._data?.compressedSize);
  const uncompressedSize = Number(entry?._data?.uncompressedSize);
  return {
    compressedSize: Number.isFinite(compressedSize) && compressedSize >= 0 ? compressedSize : null,
    uncompressedSize: Number.isFinite(uncompressedSize) && uncompressedSize >= 0 ? uncompressedSize : null,
  };
}

function assertCompressionRatio(name, sizes, maximumRatio) {
  if (sizes.uncompressedSize == null || sizes.compressedSize == null || sizes.uncompressedSize < 1024 * 1024) return;
  const ratio = sizes.uncompressedSize / Math.max(1, sizes.compressedSize);
  if (ratio > maximumRatio) {
    throw new Error(`信笺资源压缩比异常：${name}`);
  }
}

function assertAggregateCompressionRatio(compressedBytes, expandedBytes, maximumRatio) {
  if (expandedBytes < 1024 * 1024) return;
  const ratio = expandedBytes / Math.max(1, compressedBytes);
  if (ratio > maximumRatio) throw new Error("信笺压缩包总压缩比异常，已拒绝加载");
}

function preflightZipBuffer(buffer, { limits = DEFAULT_ARCHIVE_LIMITS } = {}) {
  const resolved = { ...DEFAULT_ARCHIVE_LIMITS, ...(limits || {}) };
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (source.length > resolved.maxArchiveBytes) throw new Error("信笺文件过大，已拒绝加载");
  if (source.length < 22) throw new Error("无效的信笺压缩包");

  // Parse the ordinary (non-ZIP64) central directory before JSZip allocates an
  // object for every entry. PaperWriter never writes ZIP64 archives, and
  // rejecting them here prevents a tiny archive with a forged entry count from
  // exhausting the main process before validatePaperArchive() can run.
  const minimumOffset = Math.max(0, source.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = source.length - 22; offset >= minimumOffset; offset -= 1) {
    if (source.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = source.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === source.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("无效的信笺压缩包目录");

  const diskNumber = source.readUInt16LE(eocdOffset + 4);
  const centralDisk = source.readUInt16LE(eocdOffset + 6);
  const diskEntries = source.readUInt16LE(eocdOffset + 8);
  const totalEntries = source.readUInt16LE(eocdOffset + 10);
  const centralSize = source.readUInt32LE(eocdOffset + 12);
  const centralOffset = source.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0
    || centralDisk !== 0
    || diskEntries !== totalEntries
    || totalEntries === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
  ) {
    throw new Error("不支持多卷或 ZIP64 信笺压缩包");
  }
  if (totalEntries > resolved.maxEntries) throw new Error("信笺包含过多资源，已拒绝加载");

  const centralEnd = centralOffset + centralSize;
  if (!Number.isSafeInteger(centralEnd) || centralOffset < 0 || centralEnd !== eocdOffset) {
    throw new Error("信笺压缩包目录范围无效");
  }
  let cursor = centralOffset;
  let countedEntries = 0;
  let compressedBytes = 0;
  let expandedBytes = 0;
  while (cursor < centralEnd) {
    if (cursor + 46 > centralEnd || source.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("信笺压缩包目录条目无效");
    }
    const fileNameLength = source.readUInt16LE(cursor + 28);
    const extraLength = source.readUInt16LE(cursor + 30);
    const commentLength = source.readUInt16LE(cursor + 32);
    const next = cursor + 46 + fileNameLength + extraLength + commentLength;
    if (next <= cursor || next > centralEnd) throw new Error("信笺压缩包目录条目越界");
    const compressedSize = source.readUInt32LE(cursor + 20);
    const uncompressedSize = source.readUInt32LE(cursor + 24);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("不支持 ZIP64 信笺压缩包条目");
    }
    compressedBytes += compressedSize;
    expandedBytes += uncompressedSize;
    if (!Number.isSafeInteger(compressedBytes) || !Number.isSafeInteger(expandedBytes)) {
      throw new Error("信笺压缩包资源大小无效");
    }
    if (expandedBytes > resolved.maxExpandedBytes) throw new Error("信笺展开后的资源总量过大，已拒绝加载");
    countedEntries += 1;
    if (countedEntries > resolved.maxEntries) throw new Error("信笺包含过多资源，已拒绝加载");
    cursor = next;
  }
  if (cursor !== centralEnd || countedEntries !== totalEntries) {
    throw new Error("信笺压缩包目录计数不一致");
  }
  assertAggregateCompressionRatio(compressedBytes, expandedBytes, resolved.maxArchiveRatio);
  return { entries: countedEntries, centralSize, centralOffset, compressedBytes, expandedBytes };
}

function validatePaperArchive(zip, {
  archiveBytes = 0,
  limits = DEFAULT_ARCHIVE_LIMITS,
} = {}) {
  if (!zip?.files || typeof zip.file !== "function") throw new Error("无效的信笺压缩包");
  const resolved = { ...DEFAULT_ARCHIVE_LIMITS, ...(limits || {}) };
  if (Number(archiveBytes) > resolved.maxArchiveBytes) throw new Error("信笺文件过大，已拒绝加载");
  const entries = Object.values(zip.files).filter((entry) => entry && !entry.dir);
  if (entries.length > resolved.maxEntries) throw new Error("信笺包含过多资源，已拒绝加载");
  const documentEntry = zip.file("document.json");
  if (!documentEntry) throw new Error("这个信笺文档缺少 document.json。");

  let expandedBytes = 0;
  let compressedBytes = 0;
  for (const entry of entries) {
    const normalizedName = String(entry.name || "").replace(/\\/g, "/").replace(/^\/+/, "");
    const isAsset = normalizedName.startsWith("assets/")
      && !normalizedName.includes("..")
      && normalizedName.length <= 512;
    if (normalizedName !== "document.json" && !isAsset) {
      throw new Error(`信笺包含不受支持的压缩包条目：${normalizedName || "(空名称)"}`);
    }
    const sizes = zipEntrySizes(entry);
    if (sizes.uncompressedSize == null || sizes.compressedSize == null) throw new Error(`无法验证信笺资源大小：${entry.name}`);
    compressedBytes += sizes.compressedSize;
    expandedBytes += sizes.uncompressedSize;
    if (expandedBytes > resolved.maxExpandedBytes) throw new Error("信笺展开后的资源总量过大，已拒绝加载");
    if (entry.name === "document.json") {
      if (sizes.uncompressedSize > resolved.maxDocumentJsonBytes) throw new Error("信笺正文数据过大，已拒绝加载");
      assertCompressionRatio(entry.name, sizes, resolved.maxDocumentJsonRatio);
    } else {
      if (sizes.uncompressedSize > resolved.maxAssetBytes) throw new Error(`信笺资源过大：${entry.name}`);
      assertCompressionRatio(entry.name, sizes, resolved.maxAssetRatio);
    }
  }
  assertAggregateCompressionRatio(compressedBytes, expandedBytes, resolved.maxArchiveRatio);
  return { entries: entries.length, expandedBytes, documentJsonBytes: zipEntrySizes(documentEntry).uncompressedSize };
}

function createByteBudgetSemaphore({
  maxConcurrent = 4,
  maxReservedBytes = DEFAULT_ARCHIVE_LIMITS.maxExpandedBytes,
} = {}) {
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent <= 0) throw new Error("并发上限无效");
  if (!Number.isSafeInteger(maxReservedBytes) || maxReservedBytes <= 0) throw new Error("字节预算无效");
  let active = 0;
  let reservedBytes = 0;
  const waiters = [];

  const drain = () => {
    while (active < maxConcurrent && waiters.length) {
      const waiter = waiters[0];
      if (reservedBytes + waiter.bytes > maxReservedBytes) break;
      waiters.shift();
      active += 1;
      reservedBytes += waiter.bytes;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        active -= 1;
        reservedBytes -= waiter.bytes;
        drain();
      });
    }
  };

  const acquire = (bytes) => {
    const reservation = Number(bytes);
    if (!Number.isSafeInteger(reservation) || reservation < 0 || reservation > maxReservedBytes) {
      return Promise.reject(new Error("资源超出解压在途字节预算"));
    }
    return new Promise((resolve) => {
      waiters.push({ bytes: reservation, resolve });
      drain();
    });
  };

  return {
    acquire,
    stats: () => ({ active, queued: waiters.length, reservedBytes }),
  };
}

function assertZipEntryReadable(entry, {
  maxBytes = DEFAULT_ARCHIVE_LIMITS.maxAssetBytes,
  maxRatio = DEFAULT_ARCHIVE_LIMITS.maxAssetRatio,
} = {}) {
  if (!entry) throw new Error("资源不存在");
  const sizes = zipEntrySizes(entry);
  if (sizes.uncompressedSize == null || sizes.uncompressedSize > maxBytes) throw new Error("资源过大或无法验证");
  assertCompressionRatio(entry.name || "asset", sizes, maxRatio);
  return sizes;
}

function zipEntryRuntimeLimit(entry, {
  maxBytes = DEFAULT_ARCHIVE_LIMITS.maxAssetBytes,
  maxRatio = DEFAULT_ARCHIVE_LIMITS.maxAssetRatio,
} = {}) {
  const sizes = assertZipEntryReadable(entry, { maxBytes, maxRatio });
  const ratioBound = sizes.compressedSize == null
    ? maxBytes
    : Math.max(1024 * 1024, Math.ceil(sizes.compressedSize * maxRatio));
  return { sizes, maximumOutputBytes: Math.min(maxBytes, ratioBound) };
}

function assertActualZipEntrySize(entry, sizes, actualBytes, maxRatio) {
  if (sizes.uncompressedSize != null && actualBytes !== sizes.uncompressedSize) {
    throw new Error(`信笺资源实际大小与目录不一致：${entry?.name || "asset"}`);
  }
  assertCompressionRatio(entry?.name || "asset", {
    compressedSize: sizes.compressedSize,
    uncompressedSize: actualBytes,
  }, maxRatio);
}

async function readZipEntryBufferLimited(entry, {
  maxBytes = DEFAULT_ARCHIVE_LIMITS.maxAssetBytes,
  maxRatio = DEFAULT_ARCHIVE_LIMITS.maxAssetRatio,
} = {}) {
  const { sizes, maximumOutputBytes } = zipEntryRuntimeLimit(entry, { maxBytes, maxRatio });
  const stream = entry.nodeStream("nodebuffer");
  const chunks = [];
  let actualBytes = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      actualBytes += bytes.length;
      if (actualBytes > maximumOutputBytes) {
        stream.destroy();
        throw new Error(`信笺资源解压后超过安全上限：${entry?.name || "asset"}`);
      }
      chunks.push(bytes);
    }
  } catch (error) {
    stream.destroy();
    throw error;
  }
  assertActualZipEntrySize(entry, sizes, actualBytes, maxRatio);
  return Buffer.concat(chunks, actualBytes);
}

function createZipEntryLimitTransform(entry, {
  maxBytes = DEFAULT_ARCHIVE_LIMITS.maxAssetBytes,
  maxRatio = DEFAULT_ARCHIVE_LIMITS.maxAssetRatio,
} = {}) {
  const { sizes, maximumOutputBytes } = zipEntryRuntimeLimit(entry, { maxBytes, maxRatio });
  let actualBytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      actualBytes += chunk.length;
      if (actualBytes > maximumOutputBytes) {
        callback(new Error(`信笺资源解压后超过安全上限：${entry?.name || "asset"}`));
        return;
      }
      callback(null, chunk);
    },
    flush(callback) {
      try {
        assertActualZipEntrySize(entry, sizes, actualBytes, maxRatio);
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
}

function parseSingleByteRange(value, size) {
  if (value == null || value === "") return null;
  const total = Number(size);
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value).trim());
  if (!Number.isSafeInteger(total) || total <= 0 || !match || (!match[1] && !match[2])) return { invalid: true };
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    return { start: Math.max(0, total - suffixLength), end: total - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= total || requestedEnd < start) {
    return { invalid: true };
  }
  return { start, end: Math.min(requestedEnd, total - 1) };
}

module.exports = {
  DEFAULT_ARCHIVE_LIMITS,
  assertZipEntryReadable,
  atomicWriteFile,
  createByteBudgetSemaphore,
  createZipEntryLimitTransform,
  createPathWriteQueue,
  normalizedPathKey,
  parseSingleByteRange,
  preflightZipBuffer,
  readZipEntryBufferLimited,
  validatePaperArchive,
  zipEntrySizes,
};
