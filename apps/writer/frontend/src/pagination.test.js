import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildPageMap,
  markOversizeBlocks,
  pageIndexFromClientRect,
  waitForPageLayoutResources,
} from "./pagination/page-layout-service.js";
import {
  getRegisteredPageLayout,
  refreshRegisteredPageLayout,
  registerPageLayout,
  updateRegisteredPageLayout,
} from "./pagination/page-layout-registry.js";
import {
  DEFAULT_PAGE_VIEW_STATE,
  PAGE_VIEW_MODES,
  clampZoom,
  createPageViewSessionStore,
  normalizePageViewState,
  pageGroupStartIndex,
  reducePageViewState,
  spreadStartPage,
  visiblePagesForState,
} from "./pagination/page-view-state.js";

test("page view state normalizes mode, page, and zoom without entering document data", () => {
  assert.deepEqual(normalizePageViewState({
    mode: "unknown",
    currentPage: 99,
    zoomMode: "custom",
    zoom: 9,
  }, 4), {
    ...DEFAULT_PAGE_VIEW_STATE,
    currentPage: 4,
    zoomMode: "custom",
    zoom: 2,
  });
  assert.equal(clampZoom(0.01), 0.45);
});

test("spread mode lays pages out in left-to-right pairs starting with 1-2", () => {
  assert.equal(spreadStartPage(1, 8), 1);
  assert.equal(spreadStartPage(2, 8), 1);
  assert.equal(spreadStartPage(3, 8), 3);
  assert.equal(spreadStartPage(8, 8), 7);
  assert.deepEqual(visiblePagesForState({ mode: PAGE_VIEW_MODES.SPREAD, currentPage: 1 }, 8), [1, 2]);
  assert.deepEqual(visiblePagesForState({ mode: PAGE_VIEW_MODES.SPREAD, currentPage: 3 }, 8), [3, 4]);
  assert.deepEqual(visiblePagesForState({ mode: PAGE_VIEW_MODES.SPREAD, currentPage: 8 }, 8), [7, 8]);
  assert.deepEqual(visiblePagesForState({ mode: PAGE_VIEW_MODES.SPREAD, currentPage: 9 }, 9), [9, null]);
  assert.equal(pageGroupStartIndex({ mode: PAGE_VIEW_MODES.SPREAD, currentPage: 5 }, 8), 4);
});

test("page reducer navigates spread groups while clamping boundaries", () => {
  const state = { mode: PAGE_VIEW_MODES.SPREAD, currentPage: 2, zoomMode: "fit", zoom: 1 };
  assert.equal(reducePageViewState(state, { type: "next" }, 9).currentPage, 3);
  assert.equal(reducePageViewState(state, { type: "previous" }, 9).currentPage, 2);
  assert.equal(reducePageViewState({ ...state, currentPage: 7 }, { type: "next" }, 8).currentPage, 7);
  assert.equal(reducePageViewState({ ...state, currentPage: 9 }, { type: "next" }, 9).currentPage, 9);
});

test("per-tab page state persists only in the supplied session store", () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) || null,
    setItem: (key, value) => memory.set(key, value),
  };
  const first = createPageViewSessionStore({ storage });
  first.set("tab-a", {
    mode: PAGE_VIEW_MODES.SINGLE,
    currentPage: 3,
    zoomMode: "custom",
    zoom: 1.2,
  }, 5);
  const second = createPageViewSessionStore({ storage });
  assert.equal(second.get("tab-a", 5).currentPage, 3);
  assert.equal(second.get("tab-a", 5).mode, PAGE_VIEW_MODES.SINGLE);
  assert.equal(second.get("tab-b", 5).mode, PAGE_VIEW_MODES.CONTINUOUS);
});

test("page geometry keeps every coordinate inside its A4 content column", () => {
  const editorRect = { left: 100 };
  assert.equal(pageIndexFromClientRect({ left: 100 }, editorRect), 0);
  assert.equal(pageIndexFromClientRect({ left: 741 }, editorRect), 0);
  assert.equal(pageIndexFromClientRect({ left: 922 }, editorRect), 1);
  assert.equal(
    pageIndexFromClientRect(
      { left: 100 + (822 * 0.75) },
      { left: 100, width: 642 * 0.75 },
    ),
    1,
  );
});

test("page map resolves a text selection from live coordinates instead of block boundaries", () => {
  const doc = {
    content: { size: 100 },
    descendants(callback) {
      callback({ isText: false, nodeSize: 100 }, 0);
    },
  };
  const editor = {
    state: { doc },
    view: {
      coordsAtPos(position) {
        return { left: position < 50 ? 0 : 822 };
      },
    },
  };
  const editorElement = {
    scrollWidth: 1464,
    parentElement: { scrollWidth: 1464 },
    getBoundingClientRect: () => ({ left: 0 }),
  };
  const pageMap = buildPageMap({ editor, editorElement });
  assert.equal(pageMap.pageCount, 2);
  assert.deepEqual(
    pageMap.pages.map(({ from, to }) => ({ from, to })),
    [{ from: 0, to: 50 }, { from: 50, to: 100 }],
  );
  assert.equal(pageMap.positionToPage(20), 1);
  assert.equal(pageMap.positionToPage(75), 2);
});

test("page map keeps a block atom that starts a new page inside that page range", () => {
  const imageNode = {
    isAtom: true,
    isBlock: true,
    isText: false,
    nodeSize: 1,
  };
  const doc = {
    content: { size: 20 },
    descendants(callback) {
      callback(imageNode, 10);
    },
    forEach(callback) {
      callback(imageNode, 10);
    },
  };
  const editor = {
    state: { doc },
    view: {
      coordsAtPos(position) {
        return { left: position < 14 ? 0 : 822 };
      },
      nodeDOM(position) {
        return position === 10
          ? { getBoundingClientRect: () => ({ left: 821.9999 }) }
          : null;
      },
    },
  };
  const editorElement = {
    scrollWidth: 1464,
    parentElement: { scrollWidth: 1464 },
    getBoundingClientRect: () => ({ left: 0, width: 642 }),
  };
  const pageMap = buildPageMap({ editor, editorElement });
  assert.deepEqual(
    pageMap.pages.map(({ from, to }) => ({ from, to })),
    [{ from: 0, to: 10 }, { from: 10, to: 20 }],
  );
});

test("oversize block diagnostics are layout-only decorations", () => {
  const states = [];
  const makeElement = (height, kind = "block") => ({
    classList: {
      toggle(name, value) {
        states.push([height, kind, name, value]);
      },
    },
    getAttribute: () => kind,
    getBoundingClientRect: () => ({ height }),
    matches: () => kind === "block",
    removeAttribute() {},
    setAttribute() {},
  });
  const row = makeElement(1300, "table-row");
  const root = {
    querySelector: () => ({
      children: [makeElement(300), makeElement(1200)],
      querySelectorAll: () => [row],
    }),
  };
  assert.equal(markOversizeBlocks(root).length, 2);
  assert.deepEqual(states, [
    [300, "block", "paper-oversize-block", false],
    [1200, "block", "paper-oversize-block", true],
    [1300, "table-row", "paper-oversize-row", true],
  ]);
});

test("layout resource readiness waits for a Mermaid NodeView to settle", async (t) => {
  const previousMutationObserver = globalThis.MutationObserver;
  let loading = true;
  let notifyMutation;
  globalThis.MutationObserver = class {
    constructor(callback) {
      notifyMutation = callback;
    }
    observe() {}
    disconnect() {}
  };
  t.after(() => {
    globalThis.MutationObserver = previousMutationObserver;
  });
  const root = {
    querySelector: () => loading ? { dataset: { mermaidRenderState: "loading" } } : null,
    querySelectorAll: () => [],
  };
  const pending = waitForPageLayoutResources(root);
  await Promise.resolve();
  loading = false;
  notifyMutation();
  await pending;
});

test("application integration keeps one EditorContent and stores page view outside documents", async () => {
  const [appSource, canvasSource, paginatedSurfaceSource, stylesEntry] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./editor/PaperCanvas.jsx", import.meta.url), "utf8"),
    readFile(new URL("./pagination/PaginatedSurface.jsx", import.meta.url), "utf8"),
    readFile(new URL("./styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /createPageViewSessionStore\(\)/);
  assert.match(appSource, /pageViewSessionStore\.set\(tabId, nextState\)/);
  assert.match(appSource, /pageViewState=\{mainPageViewState\}/);
  assert.match(appSource, /pageViewState=\{rightPageViewState\}/);
  assert.equal((canvasSource.match(/<EditorContent editor=\{editor\} \/>/g) || []).length, 1);
  assert.match(canvasSource, /normalizedPageViewState\.mode !== PAGE_VIEW_MODES\.CONTINUOUS/);
  assert.match(canvasSource, /<PaginatedSurface[\s\S]*?\{editorSurface\}/);
  assert.match(canvasSource, /<PageViewToolbar[\s\S]*?showModes=\{false\}/);
  assert.match(canvasSource, /collapsed=\{pageToolbarCollapsed\}/);
  assert.match(canvasSource, /contextMenuEnabled = true/);
  assert.match(canvasSource, /canvas\.addEventListener\("wheel", handleWheel, \{ passive: false \}\)/);
  assert.match(canvasSource, /pageWheelDeltaRef\.current > 0 \? "next" : "previous"/);
  assert.match(canvasSource, /event\.ctrlKey[\s\S]*?event\.metaKey[\s\S]*?event\.altKey/);
  assert.match(appSource, /contextMenuEnabled=\{!aiMode\}/);
  assert.match(appSource, /if \(!aiMode \|\| !activeTabId\) return;[\s\S]*?mode: PAGE_VIEW_MODES\.CONTINUOUS/);
  assert.match(paginatedSurfaceSource, /container\.clientWidth \|\| frameWidth\) - horizontalPadding/);
  assert.match(paginatedSurfaceSource, /typeof ResizeObserver === "undefined"\s*\?\s*null/);
  assert.match(paginatedSurfaceSource, /\[frameWidth, isSpread, normalized\.mode\]/);
  assert.match(stylesEntry, /@import "\.\/styles-pagination\.css";/);
  assert.doesNotMatch(
    appSource.match(/const updatePageViewStateForTab[\s\S]*?const handleMainPageViewStateChange/)?.[0] || "",
    /setDirty|recordTabMutation|setDocumentState/,
  );
});

test("opening the secondary workspace changes a primary spread to single-page mode", async () => {
  const appSource = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const modeHandler = appSource.match(
    /const handleSetDocumentPageViewMode[\s\S]*?\n  \]\);/,
  )?.[0] || "";
  const secondaryPreparation = appSource.match(
    /const prepareSecondaryPanePageView[\s\S]*?\n  \}, \[getPageViewStateForTab, updatePageViewStateForTab\]\);/,
  )?.[0] || "";

  assert.match(
    appSource,
    /const secondaryGroupVisible = secondaryGroupOpen && !immersiveMode && !mainSpreadViewActive;/,
  );
  assert.match(secondaryPreparation, /current\.mode !== PAGE_VIEW_MODES\.SPREAD/);
  assert.match(secondaryPreparation, /mode: PAGE_VIEW_MODES\.SINGLE/);
  assert.match(appSource, /targetGroupId === WORKSPACE_GROUP_ID\.SECONDARY[\s\S]*?prepareSecondaryPanePageView\(\)/);
  assert.match(appSource, /const openResearchPreviewView[\s\S]*?prepareSecondaryPanePageView\(\)/);
  assert.match(modeHandler, /handleSelectGroupView\(WORKSPACE_GROUP_ID\.PRIMARY, view\.viewId\)/);
  assert.match(modeHandler, /handleMoveGroupDocument\(view\.viewId, WORKSPACE_GROUP_ID\.PRIMARY, null\)/);
  assert.doesNotMatch(appSource, /workspaceGroups\.primary\.views\.length > 1\s*&& !mainSpreadViewActive/);
  assert.doesNotMatch(modeHandler, /destroyResearchWebView|closeWorkspaceGroupView|removeTab/);
});

test("export registry flushes the live layout and unregisters without document state", async () => {
  const root = {};
  const initialMap = {
    generation: 1,
    pageCount: 1,
    pages: [{ from: 0, to: 10 }],
  };
  const flushedMap = {
    generation: 2,
    pageCount: 2,
    pages: [{ from: 0, to: 5 }, { from: 5, to: 10 }],
  };
  const service = {
    flush: async (reason) => {
      assert.equal(reason, "export");
      return flushedMap;
    },
  };
  const unregister = registerPageLayout(root, {
    editor: { id: "editor" },
    pageMap: initialMap,
    service,
    state: { mode: PAGE_VIEW_MODES.SINGLE, currentPage: 1 },
  });
  updateRegisteredPageLayout(root, {
    state: { mode: PAGE_VIEW_MODES.SPREAD, currentPage: 2 },
  });
  assert.equal(getRegisteredPageLayout(root).state.mode, PAGE_VIEW_MODES.SPREAD);
  assert.equal((await refreshRegisteredPageLayout(root)).pageMap, flushedMap);
  unregister();
  assert.equal(getRegisteredPageLayout(root), null);
});

test("continuous mode uses a transient A4 measurement class and restores scroll", async () => {
  const classes = new Set();
  const root = {
    scrollLeft: 37,
    scrollTop: 91,
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
    },
    setAttribute() {},
    removeAttribute() {},
  };
  const flushedMap = {
    generation: 4,
    pageCount: 3,
    pages: [
      { from: 0, to: 3 },
      { from: 3, to: 6 },
      { from: 6, to: 9 },
    ],
  };
  const unregister = registerPageLayout(root, {
    pageMap: { generation: 0, pageCount: 1, pages: [] },
    service: {
      flush: async () => {
        assert.equal(classes.has("page-map-measurement-mode"), true);
        root.scrollLeft = 999;
        root.scrollTop = 999;
        return flushedMap;
      },
    },
    state: { mode: PAGE_VIEW_MODES.CONTINUOUS },
  });
  const refreshed = await refreshRegisteredPageLayout(root);
  assert.equal(refreshed.pageMap, flushedMap);
  assert.equal(classes.size, 0);
  assert.deepEqual([root.scrollLeft, root.scrollTop], [37, 91]);
  unregister();
});
