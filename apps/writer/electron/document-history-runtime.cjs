const DEFAULT_HISTORY_LIMITS = Object.freeze({
  autoEntriesPerDocument: 50,
  autoBytesGlobal: 2 * 1024 * 1024 * 1024,
  coalesceMs: 10 * 60 * 1000,
  maxSnapshotBytes: 512 * 1024 * 1024,
});

const INDEX_VERSION = 1;
const HISTORY_KINDS = new Set(["auto", "manual", "pre-restore"]);
const MAX_HISTORY_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_HISTORY_INDEX_ENTRIES = 50_000;

function createDocumentHistoryRuntime({
  fs,
  path,
  createHash,
  randomUUID,
  atomicWriteFile,
  getUserDataPath,
  readDiskRevision,
  assertDiskRevision,
  loadPaperDocumentSnapshot,
  now = () => new Date(),
  limits = {},
}) {
  const resolvedLimits = { ...DEFAULT_HISTORY_LIMITS, ...(limits || {}) };
  let mutationTail = Promise.resolve();

  function historyRoot() {
    return path.join(getUserDataPath(), "History");
  }

  function safeIdentifier(value, label) {
    const normalized = String(value || "").trim();
    if (
      !normalized
      || normalized.length > 128
      || !/^[A-Za-z0-9_-]+$/.test(normalized)
    ) {
      throw new Error(`${label}无效`);
    }
    return normalized;
  }

  function documentDirectory(documentId) {
    return path.join(
      historyRoot(),
      safeIdentifier(documentId, "文档身份"),
    );
  }

  function indexPath(documentId) {
    return path.join(documentDirectory(documentId), "index.json");
  }

  function blobPath(documentId, sha256) {
    return path.join(
      documentDirectory(documentId),
      "blobs",
      `${safeIdentifier(sha256, "历史摘要")}.letterpaper`,
    );
  }

  function normalizeEntryName(value) {
    return String(value || "")
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  }

  function normalizeEntry(entry, documentId) {
    const source = entry && typeof entry === "object" ? entry : {};
    const id = String(source.id || "").trim();
    const sha256 = String(source.sha256 || "").toLowerCase();
    const kind = HISTORY_KINDS.has(source.kind) ? source.kind : "auto";
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(id)
      || !/^[a-f0-9]{64}$/.test(sha256)
    ) {
      return null;
    }
    return {
      id,
      documentId,
      createdAt: Number.isFinite(Number(source.createdAt))
        ? Number(source.createdAt)
        : 0,
      savedAt: Number.isFinite(Number(source.savedAt))
        ? Number(source.savedAt)
        : (
          Number.isFinite(Number(source.createdAt))
            ? Number(source.createdAt)
            : 0
        ),
      kind,
      name: normalizeEntryName(source.name),
      pinned: Boolean(source.pinned || kind === "pre-restore"),
      sha256,
      size: Number.isSafeInteger(Number(source.size))
        && Number(source.size) >= 0
        ? Number(source.size)
        : 0,
    };
  }

  function emptyIndex(documentId) {
    return {
      version: INDEX_VERSION,
      documentId,
      entries: [],
    };
  }

  function corruptIndexError() {
    const error = new Error(
      "本地版本历史索引已损坏，已停止修改以保护现有版本",
    );
    error.code = "HISTORY_INDEX_CORRUPT";
    return error;
  }

  async function readIndexText(filePath) {
    let handle;
    try {
      handle = await fs.open(filePath, "r");
      const before = await handle.stat();
      if (
        !before.isFile()
        || before.size <= 0
        || before.size > MAX_HISTORY_INDEX_BYTES
      ) {
        throw corruptIndexError();
      }
      const buffer = await handle.readFile();
      const after = await handle.stat();
      if (
        buffer.length !== after.size
        || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs
      ) {
        throw corruptIndexError();
      }
      return buffer.toString("utf8");
    } finally {
      await handle?.close();
    }
  }

  async function readIndex(documentId) {
    const safeDocumentId = safeIdentifier(documentId, "文档身份");
    let raw;
    try {
      raw = await readIndexText(indexPath(safeDocumentId));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return emptyIndex(safeDocumentId);
      }
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw corruptIndexError();
    }
    if (
      !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || parsed.version !== INDEX_VERSION
      || parsed.documentId !== safeDocumentId
      || !Array.isArray(parsed.entries)
      || parsed.entries.length > MAX_HISTORY_INDEX_ENTRIES
    ) {
      throw corruptIndexError();
    }
    const entries = parsed.entries.map(
      (entry) => normalizeEntry(entry, safeDocumentId),
    );
    if (entries.some((entry) => !entry)) throw corruptIndexError();
    const entryIds = new Set(entries.map((entry) => entry.id));
    if (entryIds.size !== entries.length) throw corruptIndexError();
    return {
      version: INDEX_VERSION,
      documentId: safeDocumentId,
      entries,
    };
  }

  async function writeIndex(index) {
    await atomicWriteFile(
      indexPath(index.documentId),
      `${JSON.stringify(index, null, 2)}\n`,
    );
  }

  async function queueMutation(task) {
    const pending = mutationTail.catch(() => {}).then(task);
    mutationTail = pending;
    return pending;
  }

  async function readSnapshotFile(filePath) {
    let handle;
    try {
      handle = await fs.open(filePath, "r");
      const before = await handle.stat();
      if (!before.isFile()) throw new Error("历史来源不是文件");
      if (
        before.size <= 0
        || before.size > resolvedLimits.maxSnapshotBytes
      ) {
        throw new Error("历史快照大小超出限制");
      }
      const buffer = await handle.readFile();
      const after = await handle.stat();
      if (
        buffer.length !== after.size
        || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs
        || (
          before.dev != null
          && after.dev != null
          && before.dev !== after.dev
        )
        || (
          before.ino != null
          && after.ino != null
          && before.ino !== after.ino
        )
      ) {
        const error = new Error("历史来源在读取期间发生变化");
        error.code = "HISTORY_SNAPSHOT_UNSTABLE";
        throw error;
      }
      if (
        buffer.length <= 0
        || buffer.length > resolvedLimits.maxSnapshotBytes
      ) {
        throw new Error("历史快照大小超出限制");
      }
      return {
        buffer,
        size: buffer.length,
        mtimeMs: after.mtimeMs,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      };
    } finally {
      await handle?.close();
    }
  }

  async function readHistoryBlob(documentId, entry) {
    const snapshot = await readSnapshotFile(
      blobPath(documentId, entry.sha256),
    );
    if (snapshot.sha256 !== entry.sha256) {
      throw new Error("历史快照校验失败");
    }
    return snapshot;
  }

  async function assertSnapshotDocumentIdentity(
    filePath,
    expectedDocumentId,
    expectedSha256,
  ) {
    if (typeof loadPaperDocumentSnapshot !== "function") return null;
    const loaded = await loadPaperDocumentSnapshot(filePath);
    const actualDocumentId = String(
      loaded?.document?.documentId || "",
    ).trim();
    if (actualDocumentId !== expectedDocumentId) {
      throw new Error("历史快照与文档身份不匹配");
    }
    const loadedSha256 = String(
      loaded?.diskRevision?.sha256 || "",
    ).toLowerCase();
    if (
      expectedSha256
      && loadedSha256
      && loadedSha256 !== expectedSha256
    ) {
      const error = new Error("历史快照在身份校验期间发生变化");
      error.code = "HISTORY_SNAPSHOT_UNSTABLE";
      throw error;
    }
    return loaded;
  }

  async function removeUnreferencedBlobs(documentId, index) {
    const referenced = new Set(index.entries.map((entry) => entry.sha256));
    const blobsDirectory = path.join(documentDirectory(documentId), "blobs");
    let entries = [];
    try {
      entries = await fs.readdir(blobsDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    await Promise.all(entries.map(async (entry) => {
      if (
        !entry.isFile()
        || !entry.name.endsWith(".letterpaper")
        || referenced.has(entry.name.slice(0, -".letterpaper".length))
      ) {
        return;
      }
      await fs.rm(path.join(blobsDirectory, entry.name), { force: true });
    }));
  }

  function pruneDocumentAutos(index) {
    const autos = index.entries
      .filter((entry) => entry.kind === "auto" && !entry.pinned)
      .sort((left, right) => right.createdAt - left.createdAt);
    const keepAutoIds = new Set(
      autos
        .slice(0, resolvedLimits.autoEntriesPerDocument)
        .map((entry) => entry.id),
    );
    index.entries = index.entries.filter(
      (entry) => entry.kind !== "auto"
        || entry.pinned
        || keepAutoIds.has(entry.id),
    );
  }

  async function readAllIndexes() {
    let directories = [];
    try {
      directories = await fs.readdir(historyRoot(), { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const indexes = [];
    for (const entry of directories) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{1,128}$/.test(entry.name)) {
        continue;
      }
      try {
        indexes.push(await readIndex(entry.name));
      } catch (error) {
        if (error?.code !== "HISTORY_INDEX_CORRUPT") throw error;
        // Preserve a damaged repository untouched. It should not block
        // snapshots for every other document or trigger blob cleanup.
      }
    }
    return indexes;
  }

  async function enforceGlobalAutoLimit() {
    if (!Number.isFinite(resolvedLimits.autoBytesGlobal)) return;
    const indexes = await readAllIndexes();
    const blobInfo = new Map();
    const removable = [];
    let total = 0;
    for (const index of indexes) {
      const counted = new Set();
      for (const entry of index.entries) {
        if (entry.kind !== "auto" || entry.pinned) continue;
        removable.push({ index, entry });
        if (!counted.has(entry.sha256)) {
          counted.add(entry.sha256);
          const key = `${index.documentId}:${entry.sha256}`;
          let size = 0;
          try {
            const stat = await fs.stat(
              blobPath(index.documentId, entry.sha256),
            );
            if (stat.isFile() && Number.isSafeInteger(stat.size)) {
              size = Math.max(0, stat.size);
            }
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          blobInfo.set(key, size);
          total += size;
        }
      }
    }
    if (total <= resolvedLimits.autoBytesGlobal) return;
    removable.sort((left, right) => left.entry.createdAt - right.entry.createdAt);
    const changedIndexes = new Set();
    for (const candidate of removable) {
      if (total <= resolvedLimits.autoBytesGlobal) break;
      const { index, entry } = candidate;
      index.entries = index.entries.filter((item) => item.id !== entry.id);
      changedIndexes.add(index);
      const stillReferenced = index.entries.some(
        (item) => item.kind === "auto"
          && !item.pinned
          && item.sha256 === entry.sha256,
      );
      if (!stillReferenced) {
        total -= blobInfo.get(`${index.documentId}:${entry.sha256}`) || 0;
      }
    }
    for (const index of changedIndexes) {
      await writeIndex(index);
      await removeUnreferencedBlobs(index.documentId, index);
    }
  }

  async function createSnapshotUnlocked({
    documentId,
    filePath,
    kind = "auto",
    name = "",
    pinned = false,
    trustedDocumentId = false,
    savedAt = null,
    preparedSnapshot = null,
  }) {
    const safeDocumentId = safeIdentifier(documentId, "文档身份");
    if (!HISTORY_KINDS.has(kind)) throw new Error("历史类型无效");
    const snapshot = preparedSnapshot || await readSnapshotFile(filePath);
    if (!preparedSnapshot && !trustedDocumentId) {
      await assertSnapshotDocumentIdentity(
        filePath,
        safeDocumentId,
        snapshot.sha256,
      );
    }
    const index = await readIndex(safeDocumentId);
    const createdAt = now().getTime();
    const latest = [...index.entries]
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    if (
      kind === "auto"
      && latest?.kind === "auto"
      && !latest.pinned
      && latest.sha256 === snapshot.sha256
    ) {
      return { entry: latest, deduplicated: true, coalesced: false };
    }

    await fs.mkdir(
      path.dirname(blobPath(safeDocumentId, snapshot.sha256)),
      { recursive: true },
    );
    try {
      await fs.access(blobPath(safeDocumentId, snapshot.sha256));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await atomicWriteFile(
        blobPath(safeDocumentId, snapshot.sha256),
        snapshot.buffer,
      );
    }

    const shouldCoalesce = kind === "auto"
      && latest?.kind === "auto"
      && !latest.pinned
      && createdAt - latest.createdAt >= 0
      && createdAt - latest.createdAt < resolvedLimits.coalesceMs;
    const entry = {
      id: shouldCoalesce ? latest.id : randomUUID(),
      documentId: safeDocumentId,
      createdAt,
      savedAt: Number.isFinite(Number(savedAt))
        ? Number(savedAt)
        : (
          Number.isFinite(Number(snapshot.mtimeMs))
            ? Number(snapshot.mtimeMs)
            : createdAt
        ),
      kind,
      name: normalizeEntryName(name),
      pinned: Boolean(pinned || kind === "pre-restore"),
      sha256: snapshot.sha256,
      size: snapshot.size,
    };
    if (shouldCoalesce) {
      index.entries = index.entries.map((item) => (
        item.id === latest.id ? entry : item
      ));
    } else {
      index.entries.push(entry);
    }
    pruneDocumentAutos(index);
    await writeIndex(index);
    await removeUnreferencedBlobs(safeDocumentId, index);
    await enforceGlobalAutoLimit();
    return {
      entry,
      deduplicated: false,
      coalesced: shouldCoalesce,
    };
  }

  function createSnapshot(input) {
    return queueMutation(() => createSnapshotUnlocked(input || {}));
  }

  async function prepareSnapshot(input = {}) {
    const {
      documentId,
      filePath,
      trustedDocumentId = false,
    } = input;
    const safeDocumentId = safeIdentifier(documentId, "文档身份");
    const snapshot = await readSnapshotFile(filePath);
    const loaded = trustedDocumentId
      ? null
      : await assertSnapshotDocumentIdentity(
        filePath,
        safeDocumentId,
        snapshot.sha256,
      );
    let committed = false;
    return Object.freeze({
      document: loaded?.document || null,
      sha256: snapshot.sha256,
      savedAt: Number.isFinite(Number(input.savedAt))
        ? Number(input.savedAt)
        : snapshot.mtimeMs,
      commit() {
        if (committed) throw new Error("历史快照已提交");
        committed = true;
        return queueMutation(() => createSnapshotUnlocked({
          ...input,
          documentId: safeDocumentId,
          savedAt: Number.isFinite(Number(input.savedAt))
            ? Number(input.savedAt)
            : snapshot.mtimeMs,
          preparedSnapshot: snapshot,
        }));
      },
    });
  }

  async function list(documentId, { excludeAutoSha256 = "" } = {}) {
    const index = await readIndex(documentId);
    const excludedSha256 = /^[a-f0-9]{64}$/i.test(String(excludeAutoSha256 || ""))
      ? String(excludeAutoSha256).toLowerCase()
      : "";
    return index.entries
      .filter((entry) => !(
        excludedSha256
        && entry.kind === "auto"
        && entry.sha256 === excludedSha256
      ))
      .slice()
      .sort((left, right) => (
        right.savedAt - left.savedAt
        || right.createdAt - left.createdAt
      ));
  }

  async function findEntry(documentId, entryId) {
    const index = await readIndex(documentId);
    const safeEntryId = safeIdentifier(entryId, "历史版本");
    const entry = index.entries.find((item) => item.id === safeEntryId);
    if (!entry) throw new Error("历史版本不存在");
    return { index, entry };
  }

  async function read(documentId, entryId) {
    const { entry } = await findEntry(documentId, entryId);
    const verified = await readHistoryBlob(documentId, entry);
    if (typeof loadPaperDocumentSnapshot === "function") {
      const snapshot = await assertSnapshotDocumentIdentity(
        blobPath(documentId, entry.sha256),
        entry.documentId,
        verified.sha256,
      );
      return {
        entry,
        document: snapshot.document,
      };
    }
    return {
      entry,
      archive: verified.buffer,
    };
  }

  function updateEntry(documentId, entryId, patch = {}) {
    return queueMutation(async () => {
      const { index, entry } = await findEntry(documentId, entryId);
      const next = {
        ...entry,
        name: patch.name === undefined
          ? entry.name
          : normalizeEntryName(patch.name),
        pinned: entry.kind === "pre-restore"
          ? true
          : (patch.pinned === undefined ? entry.pinned : Boolean(patch.pinned)),
      };
      index.entries = index.entries.map((item) => (
        item.id === next.id ? next : item
      ));
      await writeIndex(index);
      return next;
    });
  }

  function remove(documentId, entryId) {
    return queueMutation(async () => {
      const { index, entry } = await findEntry(documentId, entryId);
      index.entries = index.entries.filter((item) => item.id !== entry.id);
      await writeIndex(index);
      await removeUnreferencedBlobs(index.documentId, index);
      return { ok: true };
    });
  }

  function clearAuto(documentId) {
    return queueMutation(async () => {
      const index = await readIndex(documentId);
      const previousCount = index.entries.length;
      index.entries = index.entries.filter(
        (entry) => entry.kind !== "auto" || entry.pinned,
      );
      await writeIndex(index);
      await removeUnreferencedBlobs(index.documentId, index);
      return {
        ok: true,
        removed: previousCount - index.entries.length,
      };
    });
  }

  function clear(documentId) {
    return queueMutation(async () => {
      const index = await readIndex(documentId);
      const removed = index.entries.length;
      index.entries = [];
      await writeIndex(index);
      await removeUnreferencedBlobs(index.documentId, index);
      return { ok: true, removed };
    });
  }

  function restore({
    documentId,
    entryId,
    targetPath,
    expectedRevision = null,
  }) {
    return queueMutation(async () => {
      const { entry } = await findEntry(documentId, entryId);
      await assertDiskRevision(targetPath, expectedRevision);
      const preRestore = await createSnapshotUnlocked({
        documentId,
        filePath: targetPath,
        kind: "pre-restore",
        name: "恢复前安全版本",
        pinned: true,
      });
      // Re-check after the safety snapshot so an external replacement cannot
      // be overwritten during the extra I/O.
      await assertDiskRevision(targetPath, expectedRevision);
      const archive = (
        await readHistoryBlob(documentId, entry)
      ).buffer;
      await assertSnapshotDocumentIdentity(
        blobPath(documentId, entry.sha256),
        entry.documentId,
        entry.sha256,
      );
      // Blob validation can be expensive for large documents. Re-check at the
      // final commit boundary so a replacement during that read is rejected.
      await assertDiskRevision(targetPath, expectedRevision);
      await atomicWriteFile(targetPath, archive);
      return {
        ok: true,
        restoredEntry: entry,
        safetyEntry: preRestore.entry,
        diskRevision: await readDiskRevision(targetPath),
      };
    });
  }

  return {
    facade: Object.freeze({
      clear,
      clearAuto,
      createSnapshot,
      list,
      prepareSnapshot,
      read,
      remove,
      restore,
      updateEntry,
    }),
    historyRoot,
    initialize: () => fs.mkdir(historyRoot(), { recursive: true }),
  };
}

module.exports = {
  DEFAULT_HISTORY_LIMITS,
  MAX_HISTORY_INDEX_BYTES,
  MAX_HISTORY_INDEX_ENTRIES,
  createDocumentHistoryRuntime,
};
