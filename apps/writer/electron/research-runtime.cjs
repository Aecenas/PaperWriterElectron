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

  async function initialize() {
    researchLibrary = createResearchLibraryManager({
      userDataPath: getUserDataPath(),
    });
    await researchLibrary.initialize();
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
    decodePreviewText,
    getActiveWorkspaceRoot,
    listPayload,
    requireLibrary,
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
