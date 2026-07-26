const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const { atomicWriteFile } = require("./document-storage.cjs");
const {
  htmlToSearchText,
  readSearchDocument,
} = require("./workspace-search.cjs");
const {
  createResearchFileExtractor,
} = require("./research-search-extractors.cjs");
const {
  createResearchSearchManager,
} = require("./research-search-index.cjs");

function createResearchRuntime({
  createResearchLibraryManager,
  createResearchWebViewManager,
  getUserDataPath,
  WebContentsView,
  session,
  shell,
  getWindow,
  getActiveWorkspaceRoot,
  emitRendererEvent,
  decodeTextBuffer,
  iconvLite,
  listResearchSources,
  resolveSourceFile,
  mapWithConcurrency,
  TextDecoderApi = TextDecoder,
}) {
  let researchLibrary = null;
  let researchWebViews = null;
  let researchSearch = null;

  async function initialize() {
    researchLibrary = createResearchLibraryManager({
      userDataPath: getUserDataPath(),
    });
    await researchLibrary.initialize();
    researchSearch = createResearchSearchManager({
      library: researchLibrary,
      userDataPath: getUserDataPath(),
      extractFile: createResearchFileExtractor({
        library: researchLibrary,
        readSearchDocument,
        htmlToSearchText,
        decodePreviewText,
      }),
      fsApi: fs,
      pathApi: path,
      platform: process.platform,
      createHashApi: createHash,
      atomicWriteFile,
      randomId: randomUUID,
    });
    researchWebViews = createResearchWebViewManager({
      WebContentsView,
      session,
      shell,
      getWindow,
      sendState: (payload) => {
        emitRendererEvent("research:web-view-state", payload);
      },
    });
  }

  function getLibrary() {
    return researchLibrary;
  }

  function getWebViews() {
    return researchWebViews;
  }

  function requireLibrary() {
    if (!researchLibrary) {
      throw new Error("独立资料库尚未初始化");
    }
    return researchLibrary;
  }

  function requireSearch() {
    if (!researchSearch) {
      throw new Error("资料全文搜索尚未初始化");
    }
    return researchSearch;
  }

  function decodePreviewText(bytes) {
    const buffer = Buffer.isBuffer(bytes)
      ? bytes
      : Buffer.from(bytes || []);
    if (
      (
        buffer[0] === 0xef
        && buffer[1] === 0xbb
        && buffer[2] === 0xbf
      )
      || (buffer[0] === 0xff && buffer[1] === 0xfe)
      || (buffer[0] === 0xfe && buffer[1] === 0xff)
    ) {
      return decodeTextBuffer(buffer, "utf8", iconvLite);
    }
    try {
      return new TextDecoderApi("utf-8", { fatal: true }).decode(buffer);
    } catch {
      return iconvLite.decode(buffer, "gb18030");
    }
  }

  async function listPayload(rootPath) {
    const listed = await listResearchSources(rootPath);
    const sources = await mapWithConcurrency(
      listed.sources || [],
      12,
      async (source) => {
        if (source.type !== "file") return source;
        try {
          await resolveSourceFile(rootPath, source);
          return { ...source, missing: false };
        } catch (error) {
          return {
            ...source,
            missing: true,
            missingReason: error?.message || "资料文件不存在",
          };
        }
      },
    );
    return { ...listed, sources };
  }

  function sendEvent(channel, payload) {
    emitRendererEvent(channel, payload);
  }

  function destroyWebViews() {
    researchWebViews?.destroyAll();
  }

  function shutdown() {
    researchSearch?.shutdown();
    researchLibrary?.closeWatcher();
    destroyWebViews();
  }

  const webViewFacade = Object.freeze({
    show(payload = {}) {
      return researchWebViews?.show(payload)
        || { ok: false, unsupported: true };
    },
    updateBounds(payload = {}) {
      return researchWebViews?.updateBounds(payload)
        || { ok: false, unsupported: true };
    },
    hide(viewId = "") {
      return researchWebViews?.hide(viewId) || { ok: true };
    },
    control(payload = {}) {
      return researchWebViews?.control(payload)
        || { ok: false, unsupported: true };
    },
    destroy(viewId = "") {
      return researchWebViews?.destroy(viewId) || { ok: true };
    },
  });

  const libraryFacade = Object.freeze({
    cancelResearchSearch(libraryId, requestId) {
      return requireSearch().cancel(libraryId, requestId);
    },
    clearResearchSearch(options = {}) {
      return requireSearch().clear(options);
    },
    decodePreviewText,
    getActiveWorkspaceRoot,
    invalidateResearchSearch(change = {}) {
      return requireSearch().invalidate(change);
    },
    listPayload,
    requireLibrary,
    searchResearch(payload = {}, options = {}) {
      return requireSearch().search(payload, options);
    },
    sendEvent,
  });

  return {
    destroyWebViews,
    getLibrary,
    getWebViews,
    initialize,
    libraryFacade,
    shutdown,
    webViewFacade,
  };
}

module.exports = {
  createResearchRuntime,
};
