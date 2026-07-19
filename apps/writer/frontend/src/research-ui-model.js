export const HIDDEN_RESEARCH_NAMES = new Set([".jianjian"]);
export const RESEARCH_PREVIEW_KINDS = new Set(["document", "pdf", "markdown", "text", "table", "image", "unsupported"]);

export const RESEARCH_CONTEXT_ACTIONS = Object.freeze({
  folder: ["createFolder", "importFiles", "rename", "move", "copyPath", "showInFolder", "trash"],
  file: ["rename", "move", "copyPath", "showInFolder", "trash"],
});

export function normalizeResearchRelativePath(value) {
  const segments = [];
  for (const segment of String(value || "").replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.join("/");
}

export function parentResearchRelativePath(value) {
  const normalized = normalizeResearchRelativePath(value);
  const separator = normalized.lastIndexOf("/");
  return separator >= 0 ? normalized.slice(0, separator) : "";
}

export function researchPathLabel(rootName, relativePath) {
  const normalized = normalizeResearchRelativePath(relativePath);
  return [String(rootName || "资料目录"), ...normalized.split("/").filter(Boolean)].join(" / ");
}

export function getResearchEntryKey(entry) {
  return String(entry?.relativePath || entry?.path || entry?.id || entry?.name || "");
}

export function researchEntryType(entry) {
  const value = String(entry?.type || entry?.kind || "").toLocaleLowerCase("en-US");
  return value === "folder" || value === "file" ? value : "";
}

export function isVisibleResearchEntry(entry) {
  if (!entry || HIDDEN_RESEARCH_NAMES.has(String(entry.name || "").toLocaleLowerCase("en-US"))) return false;
  if (entry.hidden || entry.isSymbolicLink || entry.isSymlink || entry.isJunction || entry.junction) return false;
  return Boolean(researchEntryType(entry));
}

export function normalizeExpandedFolders(value) {
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return new Set(value.map(String));
  if (!value || typeof value !== "object") return new Set();
  return new Set(Object.entries(value)
    .filter(([, state]) => state === true || state?.expanded === true)
    .map(([key]) => key));
}

export function isResearchFolderExpanded(expandedFolders, entry) {
  const key = getResearchEntryKey(entry);
  if (!key) return false;
  if (expandedFolders instanceof Set) return expandedFolders.has(key);
  if (Array.isArray(expandedFolders)) return expandedFolders.includes(key);
  const state = expandedFolders?.[key];
  return state === true || state?.expanded === true;
}

export function getResearchEntryChildren(entry, expandedFolders) {
  if (Array.isArray(entry?.children)) return entry.children.filter(isVisibleResearchEntry);
  const state = expandedFolders?.[getResearchEntryKey(entry)];
  return Array.isArray(state?.entries) ? state.entries.filter(isVisibleResearchEntry) : [];
}

export function flattenVisibleResearchEntries(entries = [], expandedFolders, depth = 0) {
  const rows = [];
  for (const entry of entries.filter(isVisibleResearchEntry)) {
    rows.push({ entry, depth });
    if (researchEntryType(entry) === "folder" && isResearchFolderExpanded(expandedFolders, entry)) {
      rows.push(...flattenVisibleResearchEntries(getResearchEntryChildren(entry, expandedFolders), expandedFolders, depth + 1));
    }
  }
  return rows;
}

export function researchPreviewKind(item) {
  const explicit = String(item?.previewKind || "").toLocaleLowerCase("en-US");
  if (RESEARCH_PREVIEW_KINDS.has(explicit)) return explicit;
  if (item?.isPdf === true) return "pdf";
  const name = String(item?.fileName || item?.name || item?.relativePath || item?.path || "").toLocaleLowerCase("en-US");
  if (/\.(?:letterpaper|paperdoc)$/.test(name)) return "document";
  if (/\.pdf$/.test(name)) return "pdf";
  if (/\.(?:md|markdown)$/.test(name)) return "markdown";
  if (/\.(?:txt|log)$/.test(name)) return "text";
  if (/\.(?:csv|tsv)$/.test(name)) return "table";
  if (/\.(?:png|jpe?g|gif|webp|bmp)$/.test(name)) return "image";
  return "unsupported";
}

export function canOpenResearchItem(item) {
  if (String(item?.type || item?.kind || "").toLocaleLowerCase("en-US") === "web") return true;
  if (item?.canOpenInApp === false) return false;
  return researchPreviewKind(item) !== "unsupported";
}

export function researchItemKind(item) {
  const type = String(item?.type || item?.kind || "").toLocaleLowerCase("en-US");
  if (type === "web" || type === "url") return "web";
  if (type === "file") return researchPreviewKind(item);
  return "empty";
}

export function isDangerousResearchFile(item) {
  const name = String(item?.fileName || item?.name || item?.relativePath || item?.path || "");
  return /\.(?:ade|adp|app|bat|cmd|com|cpl|exe|hta|ins|isp|jar|jse|lnk|msc|msi|msp|mst|pif|ps1|reg|scr|sct|shb|sys|vb|vbe|vbs|ws|wsc|wsf|wsh)$/i.test(name);
}

export function clampResearchPaneWidth(width, { minWidth = 360, maxWidth = Number.POSITIVE_INFINITY } = {}) {
  const minimum = Math.max(240, Number(minWidth) || 360);
  const maximum = Math.max(minimum, Number(maxWidth) || Number.POSITIVE_INFINITY);
  const numeric = Number(width);
  return Math.round(Math.min(maximum, Math.max(minimum, Number.isFinite(numeric) ? numeric : minimum)));
}

export function sourceDisplayName(source) {
  return String(source?.title || source?.fileName || source?.name || source?.url || "未命名资料");
}

export function formatResearchFileSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 1024 ** 2 * 10 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function formatResearchModifiedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
