export function sameDiskRevision(left, right) {
  if (!left || !right) return left === right;
  return Number(left.size) === Number(right.size)
    && Number(left.mtimeMs) === Number(right.mtimeMs)
    && String(left.sha256 || "") === String(right.sha256 || "");
}

export function normalizeSessionDiskRevision(revision) {
  if (!revision || typeof revision !== "object") return null;
  const normalized = {
    size: Number(revision.size),
    mtimeMs: Number(revision.mtimeMs),
    sha256: String(revision.sha256 || "").toLowerCase(),
  };
  return Number.isSafeInteger(normalized.size)
    && normalized.size >= 0
    && Number.isFinite(normalized.mtimeMs)
    && normalized.mtimeMs >= 0
    && /^[a-f0-9]{64}$/.test(normalized.sha256)
    ? normalized
    : null;
}
