import { browserEvents } from "./events.js";

function createBrowserWindowApi() {
  return {
    getPaths: async () => ({
      desktop: "Browser preview",
      documents: "Browser preview",
      autosave: "localStorage:paperwriter.autosave",
      userData: "localStorage",
      aiDebugLog: "Browser preview",
    }),
    debugLog: async (event, data) => {
      console.debug("[paperwriter-debug]", event, data);
      return { ok: true };
    },
    setWindowModalOverlay: async () => ({ ok: true }),
    setFullscreen: async (fullscreen) => {
      browserEvents.ensureLifecycle();
      const next = Boolean(fullscreen);
      browserEvents.setLogicalFullscreen(next);
      try {
        if (next && !document.fullscreenElement && document.documentElement?.requestFullscreen) await document.documentElement.requestFullscreen();
        if (!next && document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      } catch {
        // CSS immersion remains available when the browser blocks the native fullscreen request.
      }
      browserEvents.emitFullscreenChanged({
        fullscreen: browserEvents.getLogicalFullscreen(),
        browserOnly: true,
      });
      return {
        ok: true,
        fullscreen: browserEvents.getLogicalFullscreen(),
        browserOnly: true,
      };
    },
    getFullscreen: async () => ({
      fullscreen: Boolean(globalThis.document?.fullscreenElement) || browserEvents.getLogicalFullscreen(),
      browserOnly: true,
    }),
    getUpdateState: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
    checkForUpdates: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
    downloadUpdate: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
    installUpdate: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
    onUpdateState: () => () => {},
    confirmClose: async () => ({ action: "save" }),
    closeReady: async () => ({ ok: true }),
    closeCanceled: async () => ({ ok: true }),
    onCloseRequest: () => () => {},
    onWindowFocus: (callback) => browserEvents.onWindowFocus(callback),
    onWindowBlur: (callback) => browserEvents.onWindowBlur(callback),
    onFullscreenChanged: (callback) => browserEvents.onFullscreenChanged(callback),
  };
}

export { createBrowserWindowApi };
