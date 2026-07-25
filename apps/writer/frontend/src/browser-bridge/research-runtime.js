import { browserDiskRevision } from "./revisions.js";
import {
  BROWSER_RESEARCH_PREVIEW_LIBRARY_ID,
  BROWSER_RESEARCH_PREVIEW_PDF_PATH,
  browserResearchPreviewEnabled,
  browserResearchPreviewFixture,
  createBrowserResearchPreviewPdf,
} from "./research-preview.js";
import { browserEvents } from "./events.js";
import { openBrowserExternal } from "./external.js";
import {
  BROWSER_SOURCE_LIMIT,
  BROWSER_UUID_PATTERN,
  browserCitationId,
  browserLibraryText,
  browserResearchFileUnsupported,
  browserResearchRevisionConflict,
  listBrowserCitations,
  listBrowserResearch,
  listBrowserResearchLibrarySources,
  listBrowserResearchWebTree,
  listBrowserSources,
  mutateBrowserResearchWebTree,
  normalizeBrowserCitationSource,
  normalizeBrowserLibrarySource,
  normalizeBrowserResearchEntryName,
  normalizeBrowserResearchLibraryId,
  normalizeBrowserResearchRelativePath,
  normalizeBrowserResearchSource,
  sameBrowserLibraryRevision,
  saveBrowserResearchLibrarySources,
  saveBrowserSources,
} from "./research-store.js";

function createBrowserResearchApi() {
  const api = {
    showResearchWebView: async () => ({ ok: false, unsupported: true, browserOnly: true }),
    updateResearchWebViewBounds: async () => ({ ok: false, unsupported: true, browserOnly: true }),
    hideResearchWebView: async () => ({ ok: true, browserOnly: true }),
    controlResearchWebView: async () => ({ ok: false, unsupported: true, browserOnly: true }),
    destroyResearchWebView: async () => ({ ok: true, browserOnly: true }),
    onResearchWebViewState: () => () => {},
    getResearchRoot: async () => browserResearchPreviewEnabled() ? ({
      configured: true,
      available: true,
      browserOnly: true,
      preview: true,
      libraryId: BROWSER_RESEARCH_PREVIEW_LIBRARY_ID,
      rootPath: "浏览器资料预览",
      rootName: "浏览器资料预览",
    }) : ({
      configured: false,
      available: false,
      unsupported: true,
      browserOnly: true,
    }),
    pickResearchRoot: async () => ({
      canceled: true,
      configured: false,
      available: false,
      unsupported: true,
      browserOnly: true,
      message: "浏览器预览不能选择本地资料目录；请使用桌面版",
    }),
    clearResearchRoot: async () => ({
      ok: true,
      configured: false,
      available: false,
      browserOnly: true,
    }),
    listResearchFolder: async (libraryId, relativePath = "") => {
      if (browserResearchPreviewEnabled() && libraryId === BROWSER_RESEARCH_PREVIEW_LIBRARY_ID) {
        const normalizedPath = normalizeBrowserResearchRelativePath(relativePath);
        const fixture = browserResearchPreviewFixture();
        const entries = normalizedPath ? [] : [
          {
            type: "file",
            kind: "file",
            name: fixture.path,
            relativePath: fixture.path,
            size: fixture.size,
            previewKind: fixture.kind,
            canOpenInApp: true,
            canOpenExternally: true,
            modifiedAt: "2026-07-15T08:00:00.000Z",
            mtimeMs: Date.parse("2026-07-15T08:00:00.000Z"),
          },
        ];
        return {
          ok: true,
          available: true,
          browserOnly: true,
          preview: true,
          libraryId,
          relativePath: normalizedPath,
          rootName: "浏览器资料预览",
          entries,
        };
      }
      const unavailable = browserResearchFileUnsupported(libraryId, relativePath);
      return {
        ...unavailable,
        rootName: "浏览器预览",
        entries: [],
        folders: [],
        files: [],
      };
    },
    createResearchFolder: async (libraryId, parentRelativePath = "", name = "") => ({
      ...browserResearchFileUnsupported(libraryId, parentRelativePath),
      name: normalizeBrowserResearchEntryName(name),
    }),
    importResearchFiles: async (libraryId, targetRelativePath = "") => ({
      ...browserResearchFileUnsupported(libraryId, targetRelativePath, "浏览器预览不能把本地文件导入资料目录；请使用桌面版"),
      imported: [],
    }),
    importLegacyResearch: async (_workspacePath, libraryId) => ({
      ok: false,
      canceled: true,
      unsupported: true,
      browserOnly: true,
      libraryId: normalizeBrowserResearchLibraryId(libraryId),
      imported: [],
      skipped: [],
      warnings: [],
      message: "浏览器预览不能读取或迁移写作工作区中的旧资料库；请使用桌面版",
    }),
    renameResearchEntry: async (libraryId, relativePath, nextName) => ({
      ...browserResearchFileUnsupported(
        libraryId,
        normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false }),
      ),
      nextName: normalizeBrowserResearchEntryName(nextName),
    }),
    moveResearchEntry: async (libraryId, relativePath, targetFolderRelativePath = "") => ({
      ...browserResearchFileUnsupported(
        libraryId,
        normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false }),
      ),
      targetFolderRelativePath: normalizeBrowserResearchRelativePath(targetFolderRelativePath),
    }),
    trashResearchEntry: async (libraryId, relativePath) => (
      browserResearchFileUnsupported(
        libraryId,
        normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false }),
      )
    ),
    showResearchEntry: async (libraryId, relativePath = "") => (
      browserResearchFileUnsupported(libraryId, relativePath, "浏览器预览不能在资源管理器中显示本地资料")
    ),
    copyResearchEntryPath: async (libraryId, relativePath = "") => (
      browserResearchFileUnsupported(libraryId, relativePath, "浏览器预览不会读取或复制本地资料的绝对路径")
    ),
    listResearchLibrarySources: async (libraryId) => ({
      ...listBrowserResearchLibrarySources(libraryId),
      browserOnly: true,
    }),
    listResearchWebTree: async (libraryId) => listBrowserResearchWebTree(libraryId),
    createResearchWebFolder: async (libraryId, folder = {}, expectedRevision = null) => (
      mutateBrowserResearchWebTree(libraryId, expectedRevision, (tree) => {
        const timestamp = new Date().toISOString();
        tree.folders.push({
          id: browserCitationId(),
          name: browserLibraryText(folder.name, 120),
          parentId: String(folder.parentId || "").trim().toLowerCase(),
          scopeKey: "global",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        return tree;
      })
    ),
    updateResearchWebFolder: async (libraryId, folder = {}, expectedRevision = null) => (
      mutateBrowserResearchWebTree(libraryId, expectedRevision, (tree) => {
        const id = String(folder.id || "").trim().toLowerCase();
        const index = tree.folders.findIndex((entry) => entry.id === id);
        if (index < 0) throw new Error("网页文件夹不存在");
        const previous = tree.folders[index];
        tree.folders[index] = {
          ...previous,
          ...(Object.prototype.hasOwnProperty.call(folder, "name")
            ? { name: browserLibraryText(folder.name, 120) }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(folder, "parentId")
            ? { parentId: String(folder.parentId || "").trim().toLowerCase() }
            : {}),
          updatedAt: new Date().toISOString(),
        };
        return tree;
      })
    ),
    deleteResearchWebFolder: async (libraryId, folderId, expectedRevision = null) => (
      mutateBrowserResearchWebTree(libraryId, expectedRevision, (tree) => {
        const id = String(folderId || "").trim().toLowerCase();
        const removed = tree.folders.find((folder) => folder.id === id);
        if (!removed) throw new Error("网页文件夹不存在");
        tree.folders = tree.folders
          .filter((folder) => folder.id !== id)
          .map((folder) => folder.parentId === id ? { ...folder, parentId: removed.parentId } : folder);
        Object.entries(tree.placements).forEach(([sourceId, placement]) => {
          if (placement.folderId === id) {
            tree.placements[sourceId] = { scopeKey: "global", folderId: removed.parentId };
          }
        });
        return tree;
      })
    ),
    moveResearchWebSource: async (libraryId, sourceId, placement = {}, expectedRevision = null) => (
      mutateBrowserResearchWebTree(libraryId, expectedRevision, (tree) => {
        const id = String(sourceId || "").trim().toLowerCase();
        if (!listBrowserResearchLibrarySources(libraryId).sources.some(
          (source) => source.id === id && source.type === "web",
        )) {
          throw new Error("网页来源不存在");
        }
        tree.placements[id] = {
          scopeKey: "global",
          folderId: String(placement.folderId || "").trim().toLowerCase(),
        };
        return tree;
      })
    ),
    copyResearchWebSelection: async () => ({
      ok: false,
      unsupported: true,
      browserOnly: true,
      message: "浏览器预览不支持工作区私区复制；请使用桌面版",
    }),
    upsertResearchLibrarySource: async (libraryId, source = {}, expectedRevision = null) => {
      const id = normalizeBrowserResearchLibraryId(libraryId);
      const current = listBrowserResearchLibrarySources(id);
      const requestedSourceId = String(source?.id || "").trim().toLowerCase();
      const normalizedRequestedId = BROWSER_UUID_PATTERN.test(requestedSourceId) ? requestedSourceId : "";
      const previous = normalizedRequestedId
        ? current.sources.find((item) => item.id === normalizedRequestedId) || null
        : null;
      const actualRevision = previous?.diskRevision || null;
      if (!sameBrowserLibraryRevision(actualRevision, expectedRevision)) {
        return browserResearchRevisionConflict(
          id,
          expectedRevision,
          actualRevision,
          "资料来源已在另一个页面中被修改，请重新载入后再保存",
        );
      }
      if (!previous && current.sources.length >= BROWSER_SOURCE_LIMIT) throw new Error("资料来源数量已达上限");
      const normalized = normalizeBrowserLibrarySource({
        ...(source && typeof source === "object" ? source : {}),
        id: previous?.id || normalizedRequestedId || browserCitationId(),
      }, { previous });
      const serializable = { ...normalized };
      delete serializable.diskRevision;
      const diskRevision = await browserDiskRevision(serializable);
      const committed = { ...serializable, diskRevision };
      const sources = previous
        ? current.sources.map((item) => item.id === previous.id ? committed : item)
        : [...current.sources, committed];
      saveBrowserResearchLibrarySources(id, sources, committed.id);
      return { ok: true, libraryId: id, source: committed, browserOnly: true };
    },
    upsertResearchWebSource: async (libraryId, source = {}, placement = {}, revisions = {}) => {
      const saved = await api.upsertResearchLibrarySource(libraryId, source, revisions?.source || null);
      if (!saved.ok) return saved;
      const moved = await api.moveResearchWebSource(
        libraryId,
        saved.source.id,
        placement,
        revisions?.tree || null,
      );
      if (!moved.ok) {
        return {
          ...saved,
          tree: listBrowserResearchWebTree(libraryId),
          placementFallback: true,
          warning: "网页已保存，但分组索引发生冲突；已回退到全局未分组。",
        };
      }
      return { ...saved, tree: moved, placementFallback: false };
    },
    deleteResearchLibrarySource: async (libraryId, sourceId, expectedRevision = null) => {
      const id = normalizeBrowserResearchLibraryId(libraryId);
      const normalizedSourceId = String(sourceId || "").trim().toLowerCase();
      if (!BROWSER_UUID_PATTERN.test(normalizedSourceId)) throw new Error("资料来源标识必须是 UUID");
      const current = listBrowserResearchLibrarySources(id);
      const previous = current.sources.find((item) => item.id === normalizedSourceId);
      if (!previous) throw new Error("资料来源不存在");
      if (!sameBrowserLibraryRevision(previous.diskRevision, expectedRevision)) {
        return browserResearchRevisionConflict(
          id,
          expectedRevision,
          previous.diskRevision,
          "资料来源已在另一个页面中被修改，请重新载入后再删除",
        );
      }
      saveBrowserResearchLibrarySources(
        id,
        current.sources.filter((item) => item.id !== normalizedSourceId),
        normalizedSourceId,
      );
      return { ok: true, libraryId: id, sourceId: normalizedSourceId, browserOnly: true };
    },
    listLibrarySources: async (libraryId) => api.listResearchLibrarySources(libraryId),
    upsertLibrarySource: async (libraryId, source = {}, expectedRevision = null) => (
      api.upsertResearchLibrarySource(libraryId, source, expectedRevision)
    ),
    deleteLibrarySource: async (libraryId, sourceId, expectedRevision = null) => (
      api.deleteResearchLibrarySource(libraryId, sourceId, expectedRevision)
    ),
    readResearchPdf: async (libraryId, relativePath) => {
      const normalizedPath = normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false });
      if (!/\.pdf$/i.test(normalizedPath)) throw new Error("资料区首版只有 PDF 可以内嵌阅读");
      if (browserResearchPreviewEnabled()
        && libraryId === BROWSER_RESEARCH_PREVIEW_LIBRARY_ID
        && normalizedPath === BROWSER_RESEARCH_PREVIEW_PDF_PATH) {
        const bytes = createBrowserResearchPreviewPdf();
        return { ok: true, bytes, size: bytes.byteLength, browserOnly: true, preview: true };
      }
      return browserResearchFileUnsupported(
        libraryId,
        normalizedPath,
        "浏览器预览不能读取本地 PDF；请使用桌面版",
      );
    },
    readResearchPreview: async (libraryId, relativePath) => {
      const normalizedPath = normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false });
      const fixture = browserResearchPreviewFixture();
      if (browserResearchPreviewEnabled()
        && libraryId === BROWSER_RESEARCH_PREVIEW_LIBRARY_ID
        && fixture.kind !== "pdf"
        && normalizedPath === fixture.path) {
        return {
          ok: true,
          browserOnly: true,
          preview: true,
          libraryId,
          relativePath: fixture.path,
          name: fixture.path,
          previewKind: fixture.kind,
          mime: fixture.mime,
          size: fixture.size,
          ...(fixture.html ? { html: fixture.html } : { text: fixture.text }),
        };
      }
      return browserResearchFileUnsupported(
        libraryId,
        normalizedPath,
        "浏览器预览不能读取本地资料文件；请使用桌面版",
      );
    },
    openResearchDocument: async (libraryId, relativePath) => ({
      ...browserResearchFileUnsupported(
        libraryId,
        normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false }),
        "浏览器预览不能打开本地笺间文档；请使用桌面版",
      ),
      canceled: true,
    }),
    openResearchEntryExternal: async (libraryId, relativePath) => (
      browserResearchFileUnsupported(
        libraryId,
        normalizeBrowserResearchRelativePath(relativePath, { allowEmpty: false }),
        "浏览器预览不会启动本地资料文件；请使用桌面版",
      )
    ),
    watchResearchLibrary: async (libraryId) => ({
      ok: true,
      libraryId: normalizeBrowserResearchLibraryId(libraryId),
      browserOnly: true,
    }),
    onResearchLibraryChanged: (callback) => browserEvents.onResearchLibraryChanged(callback),
    onResearchLibraryWatchError: (callback) => browserEvents.onResearchLibraryWatchError(callback),
    listResearch: async (workspacePath = "") => ({
      sources: listBrowserResearch(workspacePath),
      browserOnly: true,
    }),
    createResearch: async (workspacePath = "", source = {}) => {
      if (source?.type === "file") {
        throw new Error("浏览器预览不能访问工作区文件；请在桌面端添加本地研究资料");
      }
      const normalized = normalizeBrowserResearchSource(source);
      if (!normalized) throw new Error("资料来源仅支持网页");
      if (normalized.type === "web" && !normalized.url) {
        throw new Error("网页来源仅支持有效的 HTTP 或 HTTPS 地址");
      }
      const stored = listBrowserSources(workspacePath);
      if (stored.length >= BROWSER_SOURCE_LIMIT) throw new Error("工作区资料与参考文献来源数量已达上限");
      saveBrowserSources(workspacePath, [...stored, normalized]);
      return {
        canceled: false,
        source: normalized,
        sources: listBrowserResearch(workspacePath),
        browserOnly: true,
      };
    },
    updateResearch: async (workspacePath = "", sourceId = "", patch = {}) => {
      const id = String(sourceId || "").slice(0, 128);
      let updated = null;
      const stored = listBrowserSources(workspacePath).map((source) => {
        if (source.kind !== "research" || source.id !== id) return source;
        updated = normalizeBrowserResearchSource({
          ...source,
          title: patch.title ?? source.title,
          url: patch.url ?? source.url,
          notes: patch.notes ?? source.notes,
          updatedAt: new Date().toISOString(),
        });
        return updated;
      });
      if (!updated) throw new Error("研究资料不存在");
      if (updated.type === "web" && !updated.url) {
        throw new Error("网页来源仅支持有效的 HTTP 或 HTTPS 地址");
      }
      saveBrowserSources(workspacePath, stored);
      return {
        source: updated,
        sources: listBrowserResearch(workspacePath),
        browserOnly: true,
      };
    },
    deleteResearch: async (workspacePath = "", sourceId = "") => {
      const id = String(sourceId || "").slice(0, 128);
      const stored = listBrowserSources(workspacePath)
        .filter((source) => source.kind !== "research" || source.id !== id);
      saveBrowserSources(workspacePath, stored);
      return { ok: true, sources: listBrowserResearch(workspacePath), browserOnly: true };
    },
    relinkResearch: async () => ({
      canceled: true,
      unsupported: true,
      message: "浏览器预览不能重新定位本地文件",
    }),
    readResearchFile: async () => ({
      canceled: true,
      unsupported: true,
      message: "浏览器预览不能读取本地研究文件",
    }),
    openResearchExternal: async (workspacePath = "", sourceId = "") => {
      const source = listBrowserResearch(workspacePath).find(
        (item) => item.id === String(sourceId || ""),
      );
      if (!source?.url) return { ok: false, error: "source-has-no-url" };
      return openBrowserExternal(source.url);
    },
    listCitations: async (workspacePath = "") => ({
      sources: listBrowserCitations(workspacePath),
      browserOnly: true,
    }),
    getWorkspaceIdentity: async () => ({
      ok: false,
      unsupported: true,
      browserOnly: true,
      message: "浏览器预览没有真实工作区身份；请使用桌面版连接网页区。",
    }),
    upsertCitation: async (workspacePath = "", source = {}) => {
      const stored = listBrowserSources(workspacePath);
      const rawResearchSourceId = String(source?.researchSourceId || "").trim();
      const usesIndependentLibrary = Object.prototype.hasOwnProperty.call(
        source && typeof source === "object" ? source : {},
        "researchLibraryId",
      );
      if (!usesIndependentLibrary
        && rawResearchSourceId
        && !/^[a-zA-Z0-9_-]{8,128}$/.test(rawResearchSourceId)) {
        throw new Error("关联的研究资料标识无效");
      }
      const requestedId = String(source?.id || "").trim().toLowerCase();
      const id = BROWSER_UUID_PATTERN.test(requestedId) ? requestedId : browserCitationId();
      const collision = stored.find((item) => item.id === id);
      if (collision?.kind === "research") throw new Error("该标识已被研究资料占用");
      const previous = collision?.kind === "citation" ? collision : null;
      if (!previous && stored.length >= BROWSER_SOURCE_LIMIT) {
        throw new Error("工作区资料与参考文献来源数量已达上限");
      }
      const now = new Date().toISOString();
      const normalized = normalizeBrowserCitationSource({
        ...(previous || {}),
        ...(source && typeof source === "object" ? source : {}),
        id,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
      });
      if (source?.url && !normalized.url) {
        throw new Error("参考文献来源网址仅支持有效的 HTTP 或 HTTPS 地址");
      }
      if (!normalized.title && !normalized.url && !normalized.doi) {
        throw new Error("参考文献来源至少需要标题、网址或 DOI");
      }
      if (normalized.researchSourceId
        && !normalized.researchLibraryId
        && !stored.some(
          (item) => item.kind === "research" && item.id === normalized.researchSourceId,
        )) {
        throw new Error("关联的研究资料不存在");
      }
      const next = previous
        ? stored.map((item) => item.kind === "citation" && item.id === id ? normalized : item)
        : [...stored, normalized];
      saveBrowserSources(workspacePath, next);
      return {
        source: normalized,
        sources: listBrowserCitations(workspacePath),
        browserOnly: true,
      };
    },
    deleteCitation: async (workspacePath = "", sourceId = "") => {
      const id = String(sourceId || "").trim().toLowerCase();
      if (!BROWSER_UUID_PATTERN.test(id)) throw new Error("参考文献来源标识必须是 UUID");
      const stored = listBrowserSources(workspacePath);
      if (!stored.some((source) => source.kind === "citation" && source.id === id)) {
        throw new Error("参考文献来源不存在");
      }
      saveBrowserSources(
        workspacePath,
        stored.filter((source) => source.kind !== "citation" || source.id !== id),
      );
      return {
        ok: true,
        id,
        sources: listBrowserCitations(workspacePath),
        browserOnly: true,
      };
    },
  };

  return api;
}

export { createBrowserResearchApi };
