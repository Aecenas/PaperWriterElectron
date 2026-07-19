const { contextBridge, ipcRenderer } = require("electron");

function sanitizeLegacyResearchSource(source) {
  const sanitized = source && typeof source === "object" && !Array.isArray(source) ? { ...source } : {};
  delete sanitized.filePath;
  return sanitized;
}

contextBridge.exposeInMainWorld("paperWriter", {
  isElectron: true,
  getPaths: () => ipcRenderer.invoke("app:get-paths"),
  debugLog: (event, data) => ipcRenderer.invoke("debug:log", event || "renderer", data || {}),
  setWindowModalOverlay: (active) => ipcRenderer.invoke("window:set-modal-overlay", Boolean(active)),
  getAiConfig: () => ipcRenderer.invoke("ai:get-config"),
  refreshCodexCliStatus: () => ipcRenderer.invoke("ai:refresh-codex"),
  startCodexCliLogin: () => ipcRenderer.invoke("ai:start-codex-login"),
  createAiProvider: (provider) => ipcRenderer.invoke("ai:create-provider", provider || {}),
  deleteAiProvider: (providerId) => ipcRenderer.invoke("ai:delete-provider", providerId || ""),
  saveAiConfig: (config) => ipcRenderer.invoke("ai:save-config", config || {}),
  testAiConfig: (config) => ipcRenderer.invoke("ai:test-config", config || {}),
  generateAi: (payload) => ipcRenderer.invoke("ai:generate", payload || {}),
  resolveAiApply: (payload) => ipcRenderer.invoke("ai:resolve-apply", payload || {}),
  cancelAi: (requestId) => ipcRenderer.invoke("ai:cancel", requestId || ""),
  exportAiChat: (payload) => ipcRenderer.invoke("ai:export-chat", payload || {}),
  onAiChunk: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:chunk", listener);
    return () => ipcRenderer.removeListener("ai:chunk", listener);
  },
  onAiDone: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:done", listener);
    return () => ipcRenderer.removeListener("ai:done", listener);
  },
  onAiError: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:error", listener);
    return () => ipcRenderer.removeListener("ai:error", listener);
  },
  onCodexCliStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("ai:codex-status", listener);
    return () => ipcRenderer.removeListener("ai:codex-status", listener);
  },
  openDocument: () => ipcRenderer.invoke("document:open"),
  openDocumentPath: (filePath) => ipcRenderer.invoke("document:open-path", filePath || ""),
  importDocument: () => ipcRenderer.invoke("document:import"),
  exportEditable: (document, format, targetPath = "") => ipcRenderer.invoke("document:export-editable", {
    document: document || {},
    format: format || "",
    targetPath: targetPath || "",
  }),
  openFolder: () => ipcRenderer.invoke("folder:open"),
  listFolder: (folderPath) => ipcRenderer.invoke("folder:list", folderPath || ""),
  searchFolder: (payload) => ipcRenderer.invoke("folder:search", payload || {}),
  cancelFolderSearch: (folderPath, requestId) => ipcRenderer.invoke("folder:search-cancel", folderPath || "", requestId || ""),
  getWorkspaceRelationships: (payload) => ipcRenderer.invoke("workspace:relationships", payload || {}),
  watchWorkspace: (folderPath) => ipcRenderer.invoke("workspace:watch", folderPath || ""),
  getDocumentRevision: (filePath) => ipcRenderer.invoke("document:revision", filePath || ""),
  regenerateDocumentIdentity: (filePath, force = false) => ipcRenderer.invoke("document:regenerate-identity", filePath || "", Boolean(force)),
  copyFolderPath: (folderPath) => ipcRenderer.invoke("folder:copy-path", folderPath || ""),
  showFolder: (folderPath) => ipcRenderer.invoke("folder:show", folderPath || ""),
  createFolder: (parentPath, name) => ipcRenderer.invoke("folder:create", parentPath || "", name || ""),
  createDocumentInFolder: (folderPath, title, templateDocument) => (
    ipcRenderer.invoke("document:create-in-folder", folderPath || "", title || "", templateDocument || {})
  ),
  renameEntry: (targetPath, nextName) => ipcRenderer.invoke("entry:rename", targetPath || "", nextName || ""),
  deleteEntry: (targetPath) => ipcRenderer.invoke("entry:delete", targetPath || ""),
  moveEntry: (sourcePath, targetFolderPath) => ipcRenderer.invoke("entry:move", sourcePath || "", targetFolderPath || ""),
  backupDocument: (filePath) => ipcRenderer.invoke("document:backup", filePath || ""),
  saveDocument: (document, currentPath, saveAs = false, reservedPaths = [], expectedRevision = null, options = {}) =>
    ipcRenderer.invoke(
      "document:save",
      document,
      currentPath || "",
      Boolean(saveAs),
      Array.isArray(reservedPaths)
        ? reservedPaths.filter((value) => typeof value === "string").slice(0, 100).map((value) => value.slice(0, 32768))
        : [],
      expectedRevision || null,
      options && typeof options === "object" ? options : {},
    ),
  saveTempDocument: (document, tabId) => ipcRenderer.invoke("autosave:save-tab", document, tabId || ""),
  deleteTempDocument: (tabId) => ipcRenderer.invoke("autosave:delete-tab", tabId || ""),
  pickExportPath: (format, suggestedName, initialDirectory) => (
    ipcRenderer.invoke(
      "document:pick-export-path",
      ["images", "pdf", "markdown", "html", "txt", "docx"].includes(format) ? format : "pdf",
      suggestedName || "未命名信笺",
      typeof initialDirectory === "string" ? initialDirectory.slice(0, 32768) : "",
    )
  ),
  exportPdf: (suggestedName, targetPath) => (
    ipcRenderer.invoke("document:export-pdf", suggestedName || "未命名信笺", targetPath || "")
  ),
  exportPageImages: (suggestedName, pageRects, targetPath) => (
    ipcRenderer.invoke(
      "document:export-page-images",
      suggestedName || "未命名信笺",
      Array.isArray(pageRects) ? pageRects : [],
      targetPath || "",
    )
  ),
  onExportProgress: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("document:export-progress", listener);
    return () => ipcRenderer.removeListener("document:export-progress", listener);
  },
  pickImage: () => ipcRenderer.invoke("asset:pick-image"),
  pickAudio: () => ipcRenderer.invoke("asset:pick-audio"),
  pickVideo: () => ipcRenderer.invoke("asset:pick-video"),
  writeClipboardContent: (payload) => ipcRenderer.invoke("clipboard:write-content", payload && typeof payload === "object" ? payload : {}),
  copyImageReference: (payload) => ipcRenderer.invoke("clipboard:write-image-reference", payload && typeof payload === "object" ? payload : {}),
  openExternal: (url) => ipcRenderer.invoke("external:open", url),
  showResearchWebView: (payload) => ipcRenderer.invoke("research:web-view-show", payload || {}),
  updateResearchWebViewBounds: (payload) => ipcRenderer.invoke("research:web-view-bounds", payload || {}),
  hideResearchWebView: (viewId = "") => ipcRenderer.invoke("research:web-view-hide", viewId || ""),
  controlResearchWebView: (viewId, action) => ipcRenderer.invoke("research:web-view-control", {
    viewId: viewId || "",
    action: action || "",
  }),
  destroyResearchWebView: (viewId) => ipcRenderer.invoke("research:web-view-destroy", viewId || ""),
  onResearchWebViewState: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("research:web-view-state", listener);
    return () => ipcRenderer.removeListener("research:web-view-state", listener);
  },
  getResearchRoot: () => ipcRenderer.invoke("research:root-get"),
  pickResearchRoot: () => ipcRenderer.invoke("research:root-pick"),
  clearResearchRoot: () => ipcRenderer.invoke("research:root-clear"),
  listResearchFolder: (libraryId, relativePath = "") => ipcRenderer.invoke("research:folder-list", {
    libraryId: libraryId || "",
    relativePath: relativePath || "",
  }),
  createResearchFolder: (libraryId, parentRelativePath = "", name = "") => ipcRenderer.invoke("research:folder-create", {
    libraryId: libraryId || "",
    parentRelativePath: parentRelativePath || "",
    name: name || "",
  }),
  importResearchFiles: (libraryId, targetRelativePath = "") => ipcRenderer.invoke("research:file-import", {
    libraryId: libraryId || "",
    targetRelativePath: targetRelativePath || "",
  }),
  renameResearchEntry: (libraryId, relativePath, nextName) => ipcRenderer.invoke("research:entry-rename", {
    libraryId: libraryId || "",
    relativePath: relativePath || "",
    nextName: nextName || "",
  }),
  moveResearchEntry: (libraryId, relativePath, targetFolderRelativePath = "") => ipcRenderer.invoke("research:entry-move", {
    libraryId: libraryId || "",
    relativePath: relativePath || "",
    targetFolderRelativePath: targetFolderRelativePath || "",
  }),
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
  listResearchLibrarySources: (libraryId) => ipcRenderer.invoke("research:source-list", { libraryId: libraryId || "" }),
  listResearchWebTree: (libraryId) => ipcRenderer.invoke("research:web-tree-list", { libraryId: libraryId || "" }),
  upsertResearchWebSource: (libraryId, source, placement, revisions = {}) => ipcRenderer.invoke("research:web-source-upsert", {
    libraryId: libraryId || "",
    source: source && typeof source === "object" ? source : {},
    placement: placement && typeof placement === "object" ? placement : { scopeKey: "global", folderId: "" },
    revisions: revisions && typeof revisions === "object" ? revisions : {},
  }),
  createResearchWebFolder: (libraryId, folder, expectedRevision = null) => ipcRenderer.invoke("research:web-folder-create", {
    libraryId: libraryId || "",
    folder: folder && typeof folder === "object" ? folder : {},
    expectedRevision: expectedRevision || null,
  }),
  updateResearchWebFolder: (libraryId, folder, expectedRevision = null) => ipcRenderer.invoke("research:web-folder-update", {
    libraryId: libraryId || "",
    folder: folder && typeof folder === "object" ? folder : {},
    expectedRevision: expectedRevision || null,
  }),
  deleteResearchWebFolder: (libraryId, folderId, expectedRevision = null) => ipcRenderer.invoke("research:web-folder-delete", {
    libraryId: libraryId || "",
    folderId: folderId || "",
    expectedRevision: expectedRevision || null,
  }),
  moveResearchWebSource: (libraryId, sourceId, placement, expectedRevision = null) => ipcRenderer.invoke("research:web-source-move", {
    libraryId: libraryId || "",
    sourceId: sourceId || "",
    placement: placement && typeof placement === "object" ? placement : { scopeKey: "global", folderId: "" },
    expectedRevision: expectedRevision || null,
  }),
  copyResearchWebSelection: (libraryId, selection = {}) => ipcRenderer.invoke("research:web-selection-copy", {
    libraryId: libraryId || "",
    selection: selection && typeof selection === "object" ? selection : {},
  }),
  upsertResearchLibrarySource: (libraryId, source, expectedRevision = null) => ipcRenderer.invoke("research:source-upsert", {
    libraryId: libraryId || "",
    source: source && typeof source === "object" ? source : {},
    expectedRevision: expectedRevision || null,
  }),
  deleteResearchLibrarySource: (libraryId, sourceId, expectedRevision = null) => ipcRenderer.invoke("research:source-delete", {
    libraryId: libraryId || "",
    sourceId: sourceId || "",
    expectedRevision: expectedRevision || null,
  }),
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
  updateResearch: (workspacePath, sourceId, patch) => ipcRenderer.invoke("research:update", workspacePath || "", sourceId || "", patch || {}),
  deleteResearch: (workspacePath, sourceId) => ipcRenderer.invoke("research:delete", workspacePath || "", sourceId || ""),
  relinkResearch: (workspacePath, sourceId) => ipcRenderer.invoke("research:relink", workspacePath || "", sourceId || ""),
  readResearchFile: (workspacePath, sourceId) => ipcRenderer.invoke("research:read-file", workspacePath || "", sourceId || ""),
  openResearchExternal: (workspacePath, sourceId) => ipcRenderer.invoke("research:open-external", workspacePath || "", sourceId || ""),
  listCitations: (workspacePath) => ipcRenderer.invoke("citation:list", workspacePath || ""),
  getWorkspaceIdentity: (workspacePath) => ipcRenderer.invoke("workspace:identity", workspacePath || ""),
  upsertCitation: (workspacePath, source) => ipcRenderer.invoke("citation:upsert", workspacePath || "", source || {}),
  deleteCitation: (workspacePath, sourceId) => ipcRenderer.invoke("citation:delete", workspacePath || "", sourceId || ""),
  setFullscreen: (fullscreen) => ipcRenderer.invoke("window:set-fullscreen", Boolean(fullscreen)),
  getFullscreen: () => ipcRenderer.invoke("window:get-fullscreen"),
  loadAutosave: () => ipcRenderer.invoke("autosave:load"),
  saveAutosave: (document) => ipcRenderer.invoke("autosave:save", document),
  clearAutosave: () => ipcRenderer.invoke("autosave:clear"),
  getUpdateState: () => ipcRenderer.invoke("update:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateState: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("update:state", listener);
    return () => ipcRenderer.removeListener("update:state", listener);
  },
  confirmClose: (payload) => ipcRenderer.invoke("app:confirm-close", payload || {}),
  closeReady: (payload) => ipcRenderer.invoke("app:close-ready", payload || {}),
  closeCanceled: (payload) => ipcRenderer.invoke("app:close-canceled", payload || {}),
  onCloseRequest: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("app:close-request", listener);
    return () => ipcRenderer.removeListener("app:close-request", listener);
  },
  onWorkspaceChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("workspace:changed", listener);
    return () => ipcRenderer.removeListener("workspace:changed", listener);
  },
  onWorkspaceWatchError: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("workspace:watch-error", listener);
    return () => ipcRenderer.removeListener("workspace:watch-error", listener);
  },
  onResearchLibraryChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("research:changed", listener);
    return () => ipcRenderer.removeListener("research:changed", listener);
  },
  onResearchLibraryWatchError: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("research:watch-error", listener);
    return () => ipcRenderer.removeListener("research:watch-error", listener);
  },
  onWindowFocus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("window:focus", listener);
    return () => ipcRenderer.removeListener("window:focus", listener);
  },
  onWindowBlur: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("window:blur", listener);
    return () => ipcRenderer.removeListener("window:blur", listener);
  },
  onFullscreenChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("window:fullscreen-changed", listener);
    return () => ipcRenderer.removeListener("window:fullscreen-changed", listener);
  },
});
