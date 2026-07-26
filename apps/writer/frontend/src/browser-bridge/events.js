import { emitBrowserEvent } from "./shared.js";

const BROWSER_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const workspaceChangedListeners = new Set();
const workspaceWatchErrorListeners = new Set();
const windowFocusListeners = new Set();
const windowBlurListeners = new Set();
const fullscreenListeners = new Set();
const researchLibraryChangedListeners = new Set();
const researchLibraryWatchErrorListeners = new Set();
const researchSearchProgressListeners = new Set();
let logicalFullscreen = false;
let lifecycleListenersInstalled = false;

function ensureBrowserLifecycleListeners() {
  if (lifecycleListenersInstalled || typeof window === "undefined" || typeof document === "undefined") return;
  lifecycleListenersInstalled = true;
  window.addEventListener("focus", () => emitBrowserEvent(windowFocusListeners, { focused: true }));
  window.addEventListener("blur", () => emitBrowserEvent(windowBlurListeners, { focused: false }));
  window.addEventListener("storage", (event) => {
    if (String(event.key || "").startsWith("paperwriter.preview.")) {
      emitBrowserEvent(workspaceChangedListeners, { rootPath: "", kind: "storage" });
    }
    const libraryMatch = String(event.key || "").match(/^paperwriter\.preview\.research-library\.([0-9a-f-]{36})\.sources$/i);
    if (libraryMatch && BROWSER_UUID_PATTERN.test(libraryMatch[1])) {
      emitBrowserEvent(researchLibraryChangedListeners, {
        libraryId: libraryMatch[1].toLowerCase(),
        eventType: "change",
        relativePath: ".jianjian/research-library/sources",
        changedAt: Date.now(),
        browserOnly: true,
      });
    }
  });
  document.addEventListener("fullscreenchange", () => {
    logicalFullscreen = Boolean(document.fullscreenElement);
    emitBrowserEvent(fullscreenListeners, { fullscreen: logicalFullscreen });
  });
}

function subscribe(listeners, callback, ensureLifecycle = false) {
  if (ensureLifecycle) ensureBrowserLifecycleListeners();
  if (typeof callback !== "function") return () => {};
  listeners.add(callback);
  return () => listeners.delete(callback);
}

const browserEvents = {
  emitWorkspaceChanged(payload) {
    emitBrowserEvent(workspaceChangedListeners, payload);
  },
  emitResearchLibraryChanged(payload) {
    emitBrowserEvent(researchLibraryChangedListeners, payload);
  },
  emitResearchSearchProgress(payload) {
    emitBrowserEvent(researchSearchProgressListeners, payload);
  },
  emitFullscreenChanged(payload) {
    emitBrowserEvent(fullscreenListeners, payload);
  },
  ensureLifecycle: ensureBrowserLifecycleListeners,
  getLogicalFullscreen() {
    return logicalFullscreen;
  },
  setLogicalFullscreen(value) {
    logicalFullscreen = Boolean(value);
  },
  onWorkspaceChanged(callback) {
    return subscribe(workspaceChangedListeners, callback, true);
  },
  onWorkspaceWatchError(callback) {
    return subscribe(workspaceWatchErrorListeners, callback);
  },
  onResearchLibraryChanged(callback) {
    return subscribe(researchLibraryChangedListeners, callback, true);
  },
  onResearchLibraryWatchError(callback) {
    return subscribe(researchLibraryWatchErrorListeners, callback);
  },
  onResearchSearchProgress(callback) {
    return subscribe(researchSearchProgressListeners, callback);
  },
  onWindowFocus(callback) {
    return subscribe(windowFocusListeners, callback, true);
  },
  onWindowBlur(callback) {
    return subscribe(windowBlurListeners, callback, true);
  },
  onFullscreenChanged(callback) {
    return subscribe(fullscreenListeners, callback, true);
  },
};

export { browserEvents };
