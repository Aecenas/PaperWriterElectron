export function normalizeResearchTreeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    ...entry,
    type: entry?.type || entry?.kind || "file",
    kind: entry?.kind || entry?.type || "file",
    relativePath: String(entry?.relativePath || "").replace(/\\/g, "/"),
    children: Array.isArray(entry?.children) ? normalizeResearchTreeEntries(entry.children) : entry?.children,
  }));
}

export function replaceResearchTreeFolder(entries, folderRelativePath, children, patch = {}) {
  const target = String(folderRelativePath || "").replace(/\\/g, "/");
  if (!target) return normalizeResearchTreeEntries(children);
  return normalizeResearchTreeEntries(entries).map((entry) => {
    if (entry.relativePath === target) {
      return { ...entry, ...patch, children: normalizeResearchTreeEntries(children) };
    }
    if (Array.isArray(entry.children) && target.startsWith(`${entry.relativePath}/`)) {
      return { ...entry, children: replaceResearchTreeFolder(entry.children, target, children, patch) };
    }
    return entry;
  });
}
