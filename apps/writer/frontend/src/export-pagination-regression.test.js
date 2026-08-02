import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalizeBrowserExportPageBreaks } from "./browser-bridge/document-export.js";
import { createExportExecutionActions } from "./controllers/export.js";
import {
  capturePageMapExportSnapshot,
  createPageMapExportPlan,
  PAGE_MAP_EXPORT_UNSAFE_OVERSIZE,
} from "./export/presentation.js";
import { registerPageLayout } from "./pagination/page-layout-registry.js";
import { PAGE_VIEW_MODES } from "./pagination/page-view-state.js";
import { readAppStyles } from "./style-test-utils.js";

const executionSource = await readFile(new URL("./controllers/export.js", import.meta.url), "utf8");
const presentationSource = await readFile(new URL("./export/presentation.js", import.meta.url), "utf8");
const stylesSource = await readAppStyles();

test("image export measures the same hidden clone that Electron captures", () => {
  const start = presentationSource.indexOf("function prepareImageExportRects");
  const source = presentationSource.slice(start);
  assert.ok(start >= 0);
  assert.ok(source.indexOf("stage.append(clone)") < source.indexOf("getFlowExportSegments(clone)"));
  assert.ok(source.indexOf("await waitForImageExportAssets(clone)") < source.indexOf("getFlowExportSegments(clone)"));
  assert.doesNotMatch(source, /getFlowExportSegments\(sheet\)/);
  assert.match(source, /const cloneRect = clone\.getBoundingClientRect\(\)/);
  assert.match(executionSource, /capturePageMap\(targetCanvas\)[\s\S]*?setImageExportMode\(true\)/);
  assert.match(executionSource, /const pageRects = pageMapSnapshot[\s\S]*?preparePageMapRects\(pageMapSnapshot\)[\s\S]*?prepareImageRects\(targetCanvas\.querySelector\("\.paper-sheet"\)\)/);
});

test("PDF print mode hides current workspace chrome and paints the complete page background", () => {
  assert.match(stylesSource, /\.desktop-shell\.print-mode \.group-tabs,/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode \.editor-groups-top-strip,/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode\.export-main-pane \.right-split-pane,/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode\.export-right-pane \.paper-workspace > \.canvas/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode\.export-right-pane \.right-split-pane/);
  assert.match(stylesSource, /\.desktop-shell\.print-mode \{[^}]*--print-paper-repeat-bg/s);
  assert.match(stylesSource, /@media print[\s\S]*?html,[\s\S]*?#root \{[^}]*--print-paper-repeat-bg/s);
  assert.match(presentationSource, /function applyPrintPaperBackground[\s\S]*?--paper-repeat-bg/);
  assert.match(presentationSource, /function applyPrintPaperBackground[\s\S]*?getFlowExportSegments\(sheet\)[\s\S]*?--print-sheet-min-height/);
  assert.match(stylesSource, /min-height: var\(--print-sheet-min-height, 1123px\)/);
  assert.match(executionSource, /const handleExportPdf[\s\S]*?applyPrintBackground\(printSheet\)[\s\S]*?restorePrintPaperBackground\(\)/);
  assert.match(executionSource, /capturePageMap\(target\.canvas\)[\s\S]*?mountPageMapSnapshot\(pageMapSnapshot, "print"\)/);
  assert.match(stylesSource, /body\.page-map-export-print-body #root \{\s*display: none !important;/);
});

test("screen, PDF, and PNG share one bounded PageMap plan including hard page boundaries", () => {
  assert.match(stylesSource, /\.page-mode-stage \.paper-page-break \{[^}]*break-after: column;/s);
  assert.match(
    stylesSource,
    /\.page-mode-stage \.paper-editor > h1,[\s\S]*?\.page-map-measurement-mode \.paper-editor > h1,[\s\S]*?\.page-map-export-page \.page-map-export-editor > h1[\s\S]*?\{[^}]*break-after: avoid;[^}]*break-after: avoid-column;/s,
  );
  assert.match(presentationSource, /capturePageMapExportSnapshot[\s\S]*?createPageMapExportPlan/);
  const plan = createPageMapExportPlan({
    generation: 7,
    pageCount: 3,
    pages: [
      { page: 1, from: 0, to: 12 },
      { page: 2, from: 12, to: 27 },
      { page: 3, from: 27, to: 40 },
    ],
  });
  assert.deepEqual(plan, {
    generation: 7,
    pageCount: 3,
    pages: [
      { page: 1, from: 0, to: 12 },
      { page: 2, from: 12, to: 27 },
      { page: 3, from: 27, to: 40 },
    ],
  });
  assert.equal(createPageMapExportPlan({
    pageCount: 2,
    pages: [{ from: 0, to: 12 }, { from: 13, to: 20 }],
  }), null);
  assert.equal(createPageMapExportPlan({
    pageCount: 501,
    pages: Array.from({ length: 501 }, (_item, index) => ({
      from: index,
      to: index + 1,
    })),
  }), null);
});

test("page export fails closed when a block or table row would be cropped", async () => {
  const classes = new Set();
  const canvas = {
    scrollLeft: 0,
    scrollTop: 0,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
    setAttribute() {},
    removeAttribute() {},
  };
  const pageMap = {
    generation: 2,
    pageCount: 1,
    pages: [{ from: 0, to: 1 }],
    oversizeCount: 1,
    oversizeKinds: ["table-row"],
  };
  const unregister = registerPageLayout(canvas, {
    editor: {},
    pageMap,
    service: { flush: async () => pageMap },
    state: { mode: PAGE_VIEW_MODES.CONTINUOUS },
  });
  await assert.rejects(
    capturePageMapExportSnapshot(canvas),
    (error) => error.code === PAGE_MAP_EXPORT_UNSAFE_OVERSIZE
      && /超过 A4 可用高度/.test(error.message),
  );
  assert.equal(classes.size, 0);
  unregister();
});

test("PDF and page-image execution consume the same captured PageMap snapshot", async () => {
  const snapshot = { generation: 9, pageCount: 2, pages: [{}, {}] };
  const canvas = { scrollTop: 0, scrollLeft: 0 };
  const calls = [];
  const bodyClasses = new Set();
  const pageElement = {};
  const actions = createExportExecutionActions({
    applyPrintBackground: (sheet) => {
      calls.push(["background", sheet]);
      return () => calls.push(["background-cleanup"]);
    },
    capturePageMapSnapshot: async (target) => {
      calls.push(["capture", target]);
      return snapshot;
    },
    cleanupImageStage: () => calls.push(["image-cleanup"]),
    cleanupPageMapStage: () => calls.push(["page-map-cleanup"]),
    exportBridge: {
      exportPdf: async () => ({ canceled: false }),
      exportPageImages: async (_title, rects) => {
        calls.push(["image-rects", rects]);
        return { canceled: false, count: rects.length };
      },
    },
    mountPageMapSnapshot: (value, mode) => {
      calls.push(["mount", value, mode]);
      return { querySelector: () => pageElement };
    },
    prepareImageRects: async () => {
      throw new Error("flow fallback must not run");
    },
    preparePageMapRects: async (value) => {
      calls.push(["prepare-page-map", value]);
      return [{ x: 0 }, { x: 1 }];
    },
    readCanvasScroll: () => ({ top: 0, left: 0 }),
    resolveExportTarget: () => ({
      pane: "main",
      canvas,
      document: { title: "分页一致性" },
    }),
    restoreCanvasScroll: () => {},
    setExportRenderPane: () => {},
    setImageExportMode: () => {},
    setPrintMode: () => {},
    showStatus: () => {},
    windowObject: {
      document: {
        body: {
          classList: {
            add: (name) => bodyClasses.add(name),
            remove: (name) => bodyClasses.delete(name),
          },
        },
      },
      requestAnimationFrame(callback) {
        callback();
      },
      scrollTo() {},
    },
  });

  await actions.handleExportPdf("paper.pdf");
  await actions.handleExportImages("pages");
  assert.deepEqual(
    calls.filter(([name]) => name === "capture").map(([, target]) => target),
    [canvas, canvas],
  );
  assert.deepEqual(
    calls.find(([name]) => name === "mount")?.slice(1),
    [snapshot, "print"],
  );
  assert.equal(calls.find(([name]) => name === "background")?.[1], pageElement);
  assert.equal(calls.find(([name]) => name === "prepare-page-map")?.[1], snapshot);
  assert.equal(calls.find(([name]) => name === "image-rects")?.[1].length, 2);
  assert.equal(bodyClasses.size, 0);
});

test("browser editable exports strip the visible page-break label", () => {
  const marker = '<div data-type="paper-page-break"></div>';
  assert.equal(
    canonicalizeBrowserExportPageBreaks('<div class="page-break" data-type="paper-page-break"><span>分页符</span></div>'),
    marker,
  );
  assert.equal(
    canonicalizeBrowserExportPageBreaks('<hr aria-label="分页符" data-type="paper-page-break">'),
    marker,
  );
});
