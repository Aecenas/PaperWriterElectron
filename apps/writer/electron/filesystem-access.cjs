const path = require("node:path");

function sanitizeFilesystemName(value, fallback = "未命名", maximumLength = 80) {
  const cleaned = String(value || "")
    .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, maximumLength);
  if (!cleaned || cleaned === "." || cleaned === ".." || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned)) {
    return fallback;
  }
  return cleaned;
}

function createFilesystemAccessRegistry({
  pathApi = path,
  platform = process.platform,
  maximumRoots = 64,
  maximumDocuments = 2048,
} = {}) {
  const roots = new Map();
  const documents = new Map();
  const normalize = (value) => {
    const raw = String(value || "");
    if (!raw) return null;
    const resolved = pathApi.resolve(raw);
    const key = platform === "win32" ? resolved.toLocaleLowerCase("en-US") : resolved;
    return { key, path: resolved };
  };
  const remember = (map, value, maximum) => {
    const normalized = normalize(value);
    if (!normalized) throw new Error("缺少授权路径");
    map.delete(normalized.key);
    map.set(normalized.key, normalized.path);
    while (map.size > maximum) map.delete(map.keys().next().value);
    return normalized.path;
  };
  const contains = (candidateValue, rootValue) => {
    const candidate = normalize(candidateValue);
    const root = normalize(rootValue);
    if (!candidate || !root) return false;
    const relative = pathApi.relative(root.path, candidate.path);
    return relative === "" || (!relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative));
  };
  const authorizeRoot = (value) => remember(roots, value, maximumRoots);
  const authorizeDocument = (value) => remember(documents, value, maximumDocuments);
  const canAccessDirectory = (value) => [...roots.values()].some((root) => contains(value, root));
  const canAccessDocument = (value) => {
    const candidate = normalize(value);
    return Boolean(candidate && (documents.has(candidate.key) || canAccessDirectory(candidate.path)));
  };
  const isRoot = (value) => {
    const candidate = normalize(value);
    return Boolean(candidate && roots.has(candidate.key));
  };
  const revoke = (value, includeChildren = false) => {
    const candidate = normalize(value);
    if (!candidate) return;
    for (const map of [roots, documents]) {
      for (const [key, storedPath] of [...map]) {
        if (key === candidate.key || (includeChildren && contains(storedPath, candidate.path))) map.delete(key);
      }
    }
  };
  const rebase = (fromValue, toValue) => {
    const from = normalize(fromValue);
    const to = normalize(toValue);
    if (!from || !to) return;
    for (const map of [roots, documents]) {
      for (const [key, storedPath] of [...map]) {
        if (!contains(storedPath, from.path)) continue;
        const relative = pathApi.relative(from.path, storedPath);
        const nextPath = relative ? pathApi.resolve(to.path, relative) : to.path;
        map.delete(key);
        const normalizedNext = normalize(nextPath);
        map.set(normalizedNext.key, normalizedNext.path);
      }
    }
  };
  const load = (state = {}) => {
    for (const value of Array.isArray(state.roots) ? state.roots.slice(-maximumRoots) : []) authorizeRoot(value);
    for (const value of Array.isArray(state.documents) ? state.documents.slice(-maximumDocuments) : []) authorizeDocument(value);
  };
  const serialize = () => ({ version: 1, roots: [...roots.values()], documents: [...documents.values()] });
  const parentIsAccessible = (value) => {
    const normalized = normalize(value);
    return Boolean(normalized && canAccessDirectory(pathApi.dirname(normalized.path)));
  };
  return {
    authorizeDocument,
    authorizeRoot,
    canAccessDirectory,
    canAccessDocument,
    isRoot,
    load,
    parentIsAccessible,
    rebase,
    revoke,
    serialize,
  };
}

module.exports = { createFilesystemAccessRegistry, sanitizeFilesystemName };
