import { normalizeBrowserExternalUrl } from "../browser-ai-config.js";
import { normalizeCitationResearchIdentity } from "../document-schema-v2.js";
import { safeStorageRemoveItem } from "../safe-storage.js";
import { browserDiskRevision } from "./revisions.js";
import { browserRandomId } from "./shared.js";
import { readJson, writeJson } from "./storage.js";
import { browserEvents } from "./events.js";

const BROWSER_RESEARCH_TYPES = new Set(["web"]);
const BROWSER_CITATION_TYPES = new Set(["book", "article", "web", "pdf", "report", "thesis", "other"]);
const BROWSER_SOURCE_LIMIT = 5000;
const BROWSER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BROWSER_RESEARCH_LIBRARY_SOURCE_TYPES = new Set(["web"]);
const BROWSER_PUBLIC_CITATIONS_KEY = "paperwriter.preview.public-citations.v1";

function legacyBrowserResearchKey(workspacePath) {
  return `paperwriter.preview.research.${String(workspacePath || "default").slice(0, 2048)}`;
}

function browserSourcesKey(workspacePath) {
  return `paperwriter.preview.sources.${String(workspacePath || "default").slice(0, 2048)}`;
}

function browserCitationId() {
  const generated = globalThis.crypto?.randomUUID?.();
  if (BROWSER_UUID_PATTERN.test(String(generated || ""))) return generated.toLowerCase();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function browserTimestamp(value, fallback = "") {
  const timestamp = String(value || "").trim().slice(0, 64);
  return timestamp && Number.isFinite(Date.parse(timestamp)) ? timestamp : fallback;
}

function normalizeBrowserResearchSource(source = {}) {
  if (!BROWSER_RESEARCH_TYPES.has(source.type)) return null;
  const type = source.type;
  const safeUrl = type === "web" ? normalizeBrowserExternalUrl(source.url) : "";
  return {
    kind: "research",
    id: String(source.id || browserRandomId()).slice(0, 128),
    type,
    title: String(source.title || "网页来源").trim().slice(0, 200) || "未命名资料",
    url: safeUrl && /^https?:/i.test(safeUrl) ? safeUrl : "",
    notes: String(source.notes || "").slice(0, 200_000),
    storage: "browser",
    createdAt: String(source.createdAt || new Date().toISOString()).slice(0, 64),
    updatedAt: String(source.updatedAt || new Date().toISOString()).slice(0, 64),
    missing: false,
  };
}

function normalizeBrowserCitationSource(source = {}, { generateId = true } = {}) {
  const rawId = String(source?.id || "").trim().toLowerCase();
  const id = BROWSER_UUID_PATTERN.test(rawId) ? rawId : (generateId ? browserCitationId() : "");
  if (!id) return null;
  const rawUrl = String(source?.url || "").trim().slice(0, 2048);
  const normalizedUrl = rawUrl ? normalizeBrowserExternalUrl(rawUrl) : "";
  const url = normalizedUrl && /^https?:/i.test(normalizedUrl) ? normalizedUrl : "";
  const authors = (Array.isArray(source?.authors)
    ? source.authors
    : (typeof source?.authors === "string" ? source.authors.split(/[;,；，]/) : []))
    .slice(0, 100).map((author) => String(author || "").trim().slice(0, 200)).filter(Boolean);
  const now = new Date().toISOString();
  const createdAt = browserTimestamp(source?.createdAt, now);
  return {
    version: 1,
    kind: "citation",
    id,
    type: BROWSER_CITATION_TYPES.has(source?.type) ? source.type : "other",
    title: String(source?.title || "").trim().slice(0, 1000),
    authors,
    year: String(source?.year ?? "").trim().slice(0, 32),
    containerTitle: String(source?.containerTitle || "").trim().slice(0, 1000),
    publisher: String(source?.publisher || "").trim().slice(0, 500),
    url,
    doi: String(source?.doi || "").trim().slice(0, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
    isbn: String(source?.isbn || "").trim().slice(0, 64),
    accessedAt: browserTimestamp(source?.accessedAt, ""),
    pages: String(source?.pages || "").trim().slice(0, 128),
    notes: String(source?.notes || "").trim().slice(0, 10_000),
    ...normalizeCitationResearchIdentity(source),
    createdAt,
    updatedAt: browserTimestamp(source?.updatedAt, createdAt),
  };
}

function listBrowserSources(workspacePath) {
  const current = readJson(browserSourcesKey(workspacePath), null);
  const source = Array.isArray(current) ? current : readJson(legacyBrowserResearchKey(workspacePath), []);
  return (Array.isArray(source) ? source : []).slice(0, BROWSER_SOURCE_LIMIT).flatMap((item) => {
    if (item?.kind === "citation") {
      const citation = normalizeBrowserCitationSource(item, { generateId: false });
      return citation ? [citation] : [];
    }
    if (item?.kind && item.kind !== "research") return [];
    const normalized = normalizeBrowserResearchSource(item);
    return normalized ? [normalized] : [];
  });
}

function listBrowserResearch(workspacePath) {
  return listBrowserSources(workspacePath).filter((source) => source.kind === "research");
}

function listBrowserCitations(workspacePath) {
  return listBrowserSources(workspacePath).filter((source) => source.kind === "citation");
}

function listBrowserPublicCitationState() {
  const stored = readJson(BROWSER_PUBLIC_CITATIONS_KEY, {});
  const seen = new Set();
  const sources = (Array.isArray(stored?.sources) ? stored.sources : [])
    .slice(0, BROWSER_SOURCE_LIMIT)
    .flatMap((source) => {
      const normalized = normalizeBrowserCitationSource(source, { generateId: false });
      if (!normalized || seen.has(normalized.id)) return [];
      seen.add(normalized.id);
      return [normalized];
    });
  const migratedWorkspaces = [...new Set(
    (Array.isArray(stored?.migratedWorkspaces) ? stored.migratedWorkspaces : [])
      .map((value) => String(value || "").slice(0, 2048))
      .filter(Boolean),
  )].slice(0, BROWSER_SOURCE_LIMIT);
  return { version: 1, sources, migratedWorkspaces };
}

function saveBrowserPublicCitationState(state = {}) {
  if (!Array.isArray(state.sources) || state.sources.length > BROWSER_SOURCE_LIMIT) {
    throw new Error("公域文献数量已达上限");
  }
  const committed = {
    version: 1,
    sources: state.sources,
    migratedWorkspaces: Array.isArray(state.migratedWorkspaces)
      ? state.migratedWorkspaces.slice(0, BROWSER_SOURCE_LIMIT)
      : [],
  };
  writeJson(BROWSER_PUBLIC_CITATIONS_KEY, committed);
  return committed;
}

function saveBrowserSources(workspacePath, sources) {
  if (sources.length > BROWSER_SOURCE_LIMIT) throw new Error("工作区资料与参考文献来源数量已达上限");
  writeJson(browserSourcesKey(workspacePath), sources);
  safeStorageRemoveItem(legacyBrowserResearchKey(workspacePath));
  browserEvents.emitWorkspaceChanged({ rootPath: workspacePath || "", kind: "sources" });
}

function normalizeBrowserResearchLibraryId(value) {
  const id = String(value || "").trim().toLowerCase();
  if (!BROWSER_UUID_PATTERN.test(id)) throw new Error("资料库标识必须是 UUID");
  return id;
}

function normalizeBrowserResearchRelativePath(value, { allowEmpty = true } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    if (allowEmpty) return "";
    throw new Error("缺少资料相对路径");
  }
  if (raw.length > 32768 || /^[a-zA-Z]:/.test(raw) || /^[/\\]{1,2}/.test(raw) || raw.includes("\0")) {
    throw new Error("资料操作只接受相对路径");
  }
  const segments = raw.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("资料相对路径无效或越过根目录");
  }
  if (segments.some((segment) => segment.toLocaleLowerCase("en-US") === ".jianjian")) {
    throw new Error(".jianjian 是笺间保留目录");
  }
  return segments.join("/");
}

function normalizeBrowserResearchEntryName(value) {
  const name = String(value ?? "").trim();
  if (!name || name === "." || name === ".." || name.length > 240) throw new Error("资料项目名称无效");
  if (/[\u0000-\u001f\u007f\\/:*?"<>|]/.test(name) || /[. ]$/.test(name)) {
    throw new Error("资料项目名称包含不受支持的字符");
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error("资料项目名称属于系统保留名称");
  }
  if (name.toLocaleLowerCase("en-US") === ".jianjian") throw new Error(".jianjian 是笺间保留目录");
  return name;
}

function browserResearchLibrarySourcesKey(libraryId) {
  return `paperwriter.preview.research-library.${normalizeBrowserResearchLibraryId(libraryId)}.sources`;
}

function browserResearchWebTreeKey(libraryId) {
  return `paperwriter.preview.research-library.${normalizeBrowserResearchLibraryId(libraryId)}.web-tree`;
}

function normalizeBrowserWebTree(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const folders = (Array.isArray(input.folders) ? input.folders : []).slice(0, 2000).map((folder) => {
    const id = String(folder?.id || "").trim().toLowerCase();
    const parentId = String(folder?.parentId || "").trim().toLowerCase();
    if (!BROWSER_UUID_PATTERN.test(id) || (parentId && !BROWSER_UUID_PATTERN.test(parentId))) throw new Error("网页文件夹标识无效");
    const name = browserLibraryText(folder?.name, 120);
    if (!name) throw new Error("网页文件夹名称不能为空");
    return {
      id,
      name,
      parentId,
      scopeKey: "global",
      createdAt: browserTimestamp(folder?.createdAt, new Date().toISOString()),
      updatedAt: browserTimestamp(folder?.updatedAt, folder?.createdAt || new Date().toISOString()),
    };
  });
  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  const depthFor = (folder, visiting = new Set()) => {
    if (visiting.has(folder.id)) throw new Error("网页文件夹层级存在循环");
    if (!folder.parentId) return 1;
    const parent = folderMap.get(folder.parentId);
    if (!parent) throw new Error("网页文件夹父级不存在");
    visiting.add(folder.id);
    const depth = depthFor(parent, visiting) + 1;
    visiting.delete(folder.id);
    if (depth > 16) throw new Error("网页文件夹最多支持 16 层");
    return depth;
  };
  folders.forEach((folder) => depthFor(folder));
  const placements = {};
  for (const [sourceId, placement] of Object.entries(input.placements && typeof input.placements === "object" ? input.placements : {})) {
    if (!BROWSER_UUID_PATTERN.test(sourceId)) continue;
    const folderId = String(placement?.folderId || "").trim().toLowerCase();
    if (folderId && !folderMap.has(folderId)) throw new Error("网页位置指向不存在的文件夹");
    placements[sourceId] = { scopeKey: "global", folderId };
  }
  return { version: 1, folders, placements };
}

function listBrowserResearchWebTree(libraryId) {
  const id = normalizeBrowserResearchLibraryId(libraryId);
  const stored = readJson(browserResearchWebTreeKey(id), null);
  if (!stored) return { libraryId: id, tree: { version: 1, folders: [], placements: {} }, folders: [], placements: {}, diskRevision: null, warnings: [], readOnly: false, browserOnly: true };
  try {
    const tree = normalizeBrowserWebTree(stored.tree || stored);
    const diskRevision = normalizeBrowserLibraryRevision(stored.diskRevision);
    return { libraryId: id, tree, folders: tree.folders, placements: tree.placements, diskRevision, warnings: [], readOnly: false, browserOnly: true };
  } catch (error) {
    const tree = { version: 1, folders: [], placements: {} };
    return { libraryId: id, tree, folders: [], placements: {}, diskRevision: normalizeBrowserLibraryRevision(stored.diskRevision), warnings: [{ file: "web-tree.json", message: error?.message || "网页树索引无法读取" }], readOnly: true, browserOnly: true };
  }
}

async function mutateBrowserResearchWebTree(libraryId, expectedRevision, mutate) {
  const current = listBrowserResearchWebTree(libraryId);
  if (!sameBrowserLibraryRevision(current.diskRevision, expectedRevision)) {
    return browserResearchRevisionConflict(libraryId, expectedRevision, current.diskRevision, "网页树已在另一个页面中被修改，请重新载入");
  }
  if (current.readOnly) throw new Error("网页树索引已损坏，修复前不能修改分组");
  const tree = normalizeBrowserWebTree(await mutate(structuredClone(current.tree)) || current.tree);
  const diskRevision = await browserDiskRevision(tree);
  writeJson(browserResearchWebTreeKey(current.libraryId), { tree, diskRevision });
  browserEvents.emitResearchLibraryChanged({ libraryId: current.libraryId, relativePath: "", browserOnly: true });
  return { ok: true, libraryId: current.libraryId, tree, folders: tree.folders, placements: tree.placements, diskRevision, warnings: [], readOnly: false, browserOnly: true };
}

function browserLibraryText(value, maximum = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function normalizeBrowserLibraryRevision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const revision = {
    size: Number(value.size),
    mtimeMs: Number(value.mtimeMs),
    sha256: String(value.sha256 || "").toLowerCase(),
  };
  return Number.isSafeInteger(revision.size) && revision.size >= 0
    && Number.isFinite(revision.mtimeMs) && revision.mtimeMs >= 0
    && /^[a-f0-9]{64}$/.test(revision.sha256)
    ? revision
    : null;
}

function sameBrowserLibraryRevision(left, right) {
  const normalizedLeft = normalizeBrowserLibraryRevision(left);
  const normalizedRight = normalizeBrowserLibraryRevision(right);
  if (!normalizedLeft || !normalizedRight) return normalizedLeft === normalizedRight;
  return normalizedLeft.size === normalizedRight.size
    && normalizedLeft.mtimeMs === normalizedRight.mtimeMs
    && normalizedLeft.sha256 === normalizedRight.sha256;
}

function normalizeBrowserLibraryBibliographic(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    authors: (Array.isArray(input.authors) ? input.authors : [])
      .slice(0, 100)
      .map((author) => browserLibraryText(author, 200))
      .filter(Boolean),
    year: browserLibraryText(String(input.year ?? ""), 32),
    containerTitle: browserLibraryText(input.containerTitle || input.publication, 1000),
    publisher: browserLibraryText(input.publisher, 500),
    doi: browserLibraryText(input.doi, 300).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
    isbn: browserLibraryText(input.isbn, 64),
    pages: browserLibraryText(input.pages, 128),
  };
}

function normalizeBrowserLibrarySource(input = {}, {
  previous = null,
  generateId = true,
  touch = true,
} = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  if (raw.type === "file") throw new Error("浏览器预览不能访问或登记本地资料文件；请使用桌面版");
  const type = BROWSER_RESEARCH_LIBRARY_SOURCE_TYPES.has(raw.type)
    ? raw.type
    : (BROWSER_RESEARCH_LIBRARY_SOURCE_TYPES.has(previous?.type) ? previous.type : "");
  if (!type) throw new Error("资料来源仅支持网页");
  const requestedId = String(previous?.id || raw.id || "").trim().toLowerCase();
  const id = BROWSER_UUID_PATTERN.test(requestedId) ? requestedId : (generateId ? browserCitationId() : "");
  if (!id) throw new Error("资料来源标识必须是 UUID");
  const rawUrl = type === "web" ? String(raw.url ?? previous?.url ?? "").trim().slice(0, 4096) : "";
  const url = rawUrl ? normalizeBrowserExternalUrl(rawUrl) : "";
  if (type === "web") {
    let parsed = null;
    try { parsed = url ? new URL(url) : null; } catch { parsed = null; }
    if (!parsed || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("资料网址仅支持不含账号信息的 HTTP 或 HTTPS 地址");
    }
  }
  const now = new Date().toISOString();
  const createdAt = browserTimestamp(previous?.createdAt || raw.createdAt, now);
  const source = {
    version: 1,
    kind: "research",
    id,
    type,
    title: browserLibraryText(raw.title ?? previous?.title, 500) || "未命名网页",
    url: type === "web" ? url : "",
    excerpt: browserLibraryText(raw.excerpt ?? previous?.excerpt, 200_000),
    notes: browserLibraryText(raw.notes ?? previous?.notes, 200_000),
    relativePath: "",
    mime: "",
    size: 0,
    bibliographic: normalizeBrowserLibraryBibliographic(raw.bibliographic ?? previous?.bibliographic),
    createdAt,
    updatedAt: touch ? now : browserTimestamp(raw.updatedAt || previous?.updatedAt, createdAt),
  };
  const diskRevision = normalizeBrowserLibraryRevision(raw.diskRevision || previous?.diskRevision);
  return diskRevision ? { ...source, diskRevision } : source;
}

function listBrowserResearchLibrarySources(libraryId) {
  const id = normalizeBrowserResearchLibraryId(libraryId);
  const stored = readJson(browserResearchLibrarySourcesKey(id), []);
  const storedSources = Array.isArray(stored) ? stored.slice(0, BROWSER_SOURCE_LIMIT) : [];
  const removedNoteSourceIds = storedSources
    .filter((source) => source?.type === "note")
    .map((source) => String(source?.id || ""))
    .filter(Boolean);
  if (removedNoteSourceIds.length) {
    writeJson(browserResearchLibrarySourcesKey(id), storedSources.filter((source) => source?.type !== "note"));
  }
  const warnings = [];
  const sources = storedSources.flatMap((source, index) => {
    if (source?.type === "note") return [];
    try {
      const normalized = normalizeBrowserLibrarySource(source, { generateId: false, touch: false });
      if (!normalized.diskRevision) throw new Error("资料来源缺少有效 revision");
      return [normalized];
    } catch (error) {
      warnings.push({ index, message: error?.message || "资料来源无法读取" });
      return [];
    }
  });
  return { libraryId: id, sources, warnings, removedNoteSourceIds };
}

function browserResearchRevisionConflict(libraryId, expectedRevision, actualRevision, message) {
  return {
    ok: false,
    conflict: true,
    code: "DOCUMENT_REVISION_CONFLICT",
    message: message || "资料来源已被其他页面修改，请重新载入",
    libraryId: normalizeBrowserResearchLibraryId(libraryId),
    expectedRevision: normalizeBrowserLibraryRevision(expectedRevision),
    actualRevision: normalizeBrowserLibraryRevision(actualRevision),
    browserOnly: true,
  };
}

function saveBrowserResearchLibrarySources(libraryId, sources, sourceId = "") {
  const id = normalizeBrowserResearchLibraryId(libraryId);
  if (!Array.isArray(sources) || sources.length > BROWSER_SOURCE_LIMIT) throw new Error("资料来源数量已达上限");
  writeJson(browserResearchLibrarySourcesKey(id), sources);
  browserEvents.emitResearchLibraryChanged({
    libraryId: id,
    eventType: "change",
    relativePath: sourceId ? `.jianjian/research-library/sources/${sourceId}.json` : "",
    changedAt: Date.now(),
    browserOnly: true,
  });
}

function browserResearchFileUnsupported(libraryId, relativePath = "", message = "浏览器预览不能访问本地资料目录") {
  return {
    canceled: true,
    unsupported: true,
    browserOnly: true,
    libraryId: normalizeBrowserResearchLibraryId(libraryId),
    relativePath: normalizeBrowserResearchRelativePath(relativePath),
    message,
  };
}

export {
  BROWSER_RESEARCH_TYPES,
  BROWSER_SOURCE_LIMIT,
  BROWSER_UUID_PATTERN,
  browserCitationId,
  browserLibraryText,
  browserResearchFileUnsupported,
  browserResearchRevisionConflict,
  listBrowserCitations,
  listBrowserPublicCitationState,
  listBrowserResearch,
  listBrowserResearchLibrarySources,
  listBrowserResearchWebTree,
  listBrowserSources,
  mutateBrowserResearchWebTree,
  normalizeBrowserCitationSource,
  normalizeBrowserLibraryRevision,
  normalizeBrowserLibrarySource,
  normalizeBrowserResearchEntryName,
  normalizeBrowserResearchLibraryId,
  normalizeBrowserResearchRelativePath,
  normalizeBrowserResearchSource,
  sameBrowserLibraryRevision,
  saveBrowserResearchLibrarySources,
  saveBrowserPublicCitationState,
  saveBrowserSources,
};
