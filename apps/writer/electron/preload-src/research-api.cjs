const { subscribeToIpc } = require("./subscriptions.cjs");

function sanitizeLegacyResearchSource(source) {
  const sanitized = source && typeof source === "object" && !Array.isArray(source) ? { ...source } : {};
  delete sanitized.filePath;
  return sanitized;
}

function createResearchApi(ipcRenderer) {
  return {
    showResearchWebView: (payload) => ipcRenderer.invoke("research:web-view-show", payload || {}),
    updateResearchWebViewBounds: (payload) => ipcRenderer.invoke("research:web-view-bounds", payload || {}),
    hideResearchWebView: (viewId = "") => ipcRenderer.invoke("research:web-view-hide", viewId || ""),
    controlResearchWebView: (viewId, action) => ipcRenderer.invoke("research:web-view-control", {
      viewId: viewId || "",
      action: action || "",
    }),
    destroyResearchWebView: (viewId) => ipcRenderer.invoke("research:web-view-destroy", viewId || ""),
    onResearchWebViewState: (callback) => subscribeToIpc(ipcRenderer, "research:web-view-state", callback),
    getResearchRoot: () => ipcRenderer.invoke("research:root-get"),
    pickResearchRoot: () => ipcRenderer.invoke("research:root-pick"),
    clearResearchRoot: () => ipcRenderer.invoke("research:root-clear"),
    listResearchFolder: (libraryId, relativePath = "") => ipcRenderer.invoke("research:folder-list", {
      libraryId: libraryId || "",
      relativePath: relativePath || "",
    }),
    createResearchFolder: (libraryId, parentRelativePath = "", name = "") => (
      ipcRenderer.invoke("research:folder-create", {
        libraryId: libraryId || "",
        parentRelativePath: parentRelativePath || "",
        name: name || "",
      })
    ),
    importResearchFiles: (libraryId, targetRelativePath = "") => ipcRenderer.invoke("research:file-import", {
      libraryId: libraryId || "",
      targetRelativePath: targetRelativePath || "",
    }),
    renameResearchEntry: (libraryId, relativePath, nextName) => ipcRenderer.invoke("research:entry-rename", {
      libraryId: libraryId || "",
      relativePath: relativePath || "",
      nextName: nextName || "",
    }),
    moveResearchEntry: (libraryId, relativePath, targetFolderRelativePath = "") => (
      ipcRenderer.invoke("research:entry-move", {
        libraryId: libraryId || "",
        relativePath: relativePath || "",
        targetFolderRelativePath: targetFolderRelativePath || "",
      })
    ),
    trashResearchEntry: (libraryId, relativePath) => ipcRenderer.invoke("research:entry-trash", {
      libraryId: libraryId || "",
      relativePath: relativePath || "",
    }),
    showResearchEntry: (libraryId, relativePath = "") => ipcRenderer.invoke("research:entry-show", {
      libraryId: libraryId || "",
      relativePath: relativePath || "",
    }),
    copyResearchEntryPath: (libraryId, relativePath = "") => ipcRenderer.invoke("research:entry-copy-path", {
      libraryId: libraryId || "",
      relativePath: relativePath || "",
    }),
    listResearchLibrarySources: (libraryId) => (
      ipcRenderer.invoke("research:source-list", { libraryId: libraryId || "" })
    ),
    listResearchWebTree: (libraryId) => ipcRenderer.invoke("research:web-tree-list", { libraryId: libraryId || "" }),
    upsertResearchWebSource: (libraryId, source, placement, revisions = {}) => (
      ipcRenderer.invoke("research:web-source-upsert", {
        libraryId: libraryId || "",
        source: source && typeof source === "object" ? source : {},
        placement: placement && typeof placement === "object" ? placement : { scopeKey: "global", folderId: "" },
        revisions: revisions && typeof revisions === "object" ? revisions : {},
      })
    ),
    createResearchWebFolder: (libraryId, folder, expectedRevision = null) => (
      ipcRenderer.invoke("research:web-folder-create", {
        libraryId: libraryId || "",
        folder: folder && typeof folder === "object" ? folder : {},
        expectedRevision: expectedRevision || null,
      })
    ),
    updateResearchWebFolder: (libraryId, folder, expectedRevision = null) => (
      ipcRenderer.invoke("research:web-folder-update", {
        libraryId: libraryId || "",
        folder: folder && typeof folder === "object" ? folder : {},
        expectedRevision: expectedRevision || null,
      })
    ),
    deleteResearchWebFolder: (libraryId, folderId, expectedRevision = null) => (
      ipcRenderer.invoke("research:web-folder-delete", {
        libraryId: libraryId || "",
        folderId: folderId || "",
        expectedRevision: expectedRevision || null,
      })
    ),
    moveResearchWebSource: (libraryId, sourceId, placement, expectedRevision = null) => (
      ipcRenderer.invoke("research:web-source-move", {
        libraryId: libraryId || "",
        sourceId: sourceId || "",
        placement: placement && typeof placement === "object" ? placement : { scopeKey: "global", folderId: "" },
        expectedRevision: expectedRevision || null,
      })
    ),
    copyResearchWebSelection: (libraryId, selection = {}) => (
      ipcRenderer.invoke("research:web-selection-copy", {
        libraryId: libraryId || "",
        selection: selection && typeof selection === "object" ? selection : {},
      })
    ),
    upsertResearchLibrarySource: (libraryId, source, expectedRevision = null) => (
      ipcRenderer.invoke("research:source-upsert", {
        libraryId: libraryId || "",
        source: source && typeof source === "object" ? source : {},
        expectedRevision: expectedRevision || null,
      })
    ),
    deleteResearchLibrarySource: (libraryId, sourceId, expectedRevision = null) => (
      ipcRenderer.invoke("research:source-delete", {
        libraryId: libraryId || "",
        sourceId: sourceId || "",
        expectedRevision: expectedRevision || null,
      })
    ),
    importLegacyResearch: (workspacePath, libraryId) => ipcRenderer.invoke("research:legacy-import", {
      workspacePath: workspacePath || "",
      libraryId: libraryId || "",
    }),
    readResearchPdf: (libraryId, relativePath) => ipcRenderer.invoke("research:pdf-read", {
      libraryId: libraryId || "",
      relativePath: relativePath || "",
    }),
    readResearchPreview: (libraryId, relativePath) => ipcRenderer.invoke("research:preview-read", {
      libraryId: libraryId || "",
      relativePath: relativePath || "",
    }),
    searchResearch: (payload = {}) => ipcRenderer.invoke("research:search", {
      libraryId: payload?.libraryId || "",
      requestId: payload?.requestId || "",
      query: payload?.query || "",
      scopeKey: payload?.scopeKey || "global",
      workspaceScopeKey: payload?.workspaceScopeKey || "",
      limit: payload?.limit,
      includeFiles: payload?.includeFiles !== false,
      includeWeb: payload?.includeWeb !== false,
      kinds: Array.isArray(payload?.kinds) ? payload.kinds : [],
    }),
    cancelResearchSearch: (libraryId, requestId) => (
      ipcRenderer.invoke("research:search-cancel", {
        libraryId: libraryId || "",
        requestId: requestId || "",
      })
    ),
    openResearchDocument: (libraryId, relativePath) => ipcRenderer.invoke("research:document-open", {
      libraryId: libraryId || "",
      relativePath: relativePath || "",
    }),
    openResearchEntryExternal: (libraryId, relativePath) => ipcRenderer.invoke("research:open-external", {
      libraryId: libraryId || "",
      relativePath: relativePath || "",
    }),
    watchResearchLibrary: (libraryId) => ipcRenderer.invoke("research:watch", { libraryId: libraryId || "" }),
    listResearch: (workspacePath) => ipcRenderer.invoke("research:list", workspacePath || ""),
    createResearch: (workspacePath, source) => ipcRenderer.invoke(
      "research:create",
      workspacePath || "",
      sanitizeLegacyResearchSource(source),
    ),
    updateResearch: (workspacePath, sourceId, patch) => (
      ipcRenderer.invoke("research:update", workspacePath || "", sourceId || "", patch || {})
    ),
    deleteResearch: (workspacePath, sourceId) => (
      ipcRenderer.invoke("research:delete", workspacePath || "", sourceId || "")
    ),
    relinkResearch: (workspacePath, sourceId) => (
      ipcRenderer.invoke("research:relink", workspacePath || "", sourceId || "")
    ),
    readResearchFile: (workspacePath, sourceId) => (
      ipcRenderer.invoke("research:read-file", workspacePath || "", sourceId || "")
    ),
    openResearchExternal: (workspacePath, sourceId) => (
      ipcRenderer.invoke("research:open-external", workspacePath || "", sourceId || "")
    ),
    listCitations: (workspacePath) => ipcRenderer.invoke("citation:list", workspacePath || ""),
    upsertCitation: (workspacePath, source) => (
      ipcRenderer.invoke("citation:upsert", workspacePath || "", source || {})
    ),
    deleteCitation: (workspacePath, sourceId) => (
      ipcRenderer.invoke("citation:delete", workspacePath || "", sourceId || "")
    ),
    onResearchLibraryChanged: (callback) => subscribeToIpc(ipcRenderer, "research:changed", callback, true),
    onResearchLibraryWatchError: (callback) => subscribeToIpc(ipcRenderer, "research:watch-error", callback, true),
    onResearchSearchProgress: (callback) => (
      subscribeToIpc(ipcRenderer, "research:search-progress", callback, true)
    ),
  };
}

module.exports = {
  createResearchApi,
  sanitizeLegacyResearchSource,
};
