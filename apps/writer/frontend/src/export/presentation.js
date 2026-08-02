import { waitForImageExportAssets } from "../image-export-readiness.js";
import { refreshRegisteredPageLayout } from "../pagination/page-layout-registry.js";

export const IMAGE_EXPORT_STAGE_ID = "paperwriter-image-export-stage";
export const IMAGE_EXPORT_SEGMENT_PADDING = 24;
export const PAGE_MAP_EXPORT_STAGE_ID = "paperwriter-page-map-export-stage";
export const PAGE_MAP_EXPORT_MAX_PAGES = 500;
export const PAGE_MAP_EXPORT_UNSAFE_OVERSIZE = "PAGE_MAP_EXPORT_UNSAFE_OVERSIZE";
export const PAGE_MAP_EXPORT_UNAVAILABLE = "PAGE_MAP_EXPORT_UNAVAILABLE";

function pageMapExportError(message, code = PAGE_MAP_EXPORT_UNAVAILABLE) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function cleanupImageExportStage() {
  window.document.getElementById(IMAGE_EXPORT_STAGE_ID)?.remove();
  cleanupPageMapExportStage(window.document);
}

export function cleanupPageMapExportStage(documentObject = globalThis.document) {
  documentObject?.getElementById?.(PAGE_MAP_EXPORT_STAGE_ID)?.remove();
  documentObject?.body?.classList?.remove("page-map-export-print-body");
  documentObject?.body?.classList?.remove("page-map-export-image-body");
}

export function createPageMapExportPlan(
  pageMap,
  { maxPages = PAGE_MAP_EXPORT_MAX_PAGES } = {},
) {
  const documentSize = Math.max(
    0,
    Math.trunc(Number(pageMap?.pages?.at?.(-1)?.to) || 0),
  );
  const sourcePages = Array.isArray(pageMap?.pages) ? pageMap.pages : [];
  const pageCount = Math.trunc(Number(pageMap?.pageCount) || 0);
  if (
    pageCount < 1
    || pageCount !== sourcePages.length
    || pageCount > maxPages
  ) {
    return null;
  }
  const pages = [];
  let expectedFrom = 0;
  for (let index = 0; index < sourcePages.length; index += 1) {
    const source = sourcePages[index];
    const from = Math.trunc(Number(source?.from));
    const to = Math.trunc(Number(source?.to));
    if (
      !Number.isFinite(from)
      || !Number.isFinite(to)
      || from !== expectedFrom
      || to < from
      || to > documentSize
    ) {
      return null;
    }
    pages.push({ page: index + 1, from, to });
    expectedFrom = to;
  }
  if (expectedFrom !== documentSize) return null;
  return {
    generation: Math.max(0, Math.trunc(Number(pageMap.generation) || 0)),
    pageCount,
    pages,
  };
}

function boundedDomOffset(point) {
  const limit = point.node.nodeType === 3
    ? (point.node.nodeValue?.length || 0)
    : (point.node.childNodes?.length || 0);
  return Math.max(0, Math.min(Number(point.offset) || 0, limit));
}

function cloneEditorRange(editor, from, to, documentObject) {
  const start = editor?.view?.domAtPos?.(from);
  const end = editor?.view?.domAtPos?.(to);
  if (!start?.node || !end?.node) return null;
  const range = documentObject.createRange();
  range.setStart(start.node, boundedDomOffset(start));
  range.setEnd(end.node, boundedDomOffset(end));
  return range.cloneContents();
}

function cleanStaticPage(page) {
  page.querySelectorAll?.(
    ".image-size-tools, .media-size-tools, .comment-anchor-layer, "
      + ".comment-highlight-layer, .selection-bubble-menu, .paper-page-break, "
      + ".paper-finalized-break",
  ).forEach((element) => element.remove());
  page.querySelectorAll?.("[contenteditable]").forEach((element) => {
    element.removeAttribute("contenteditable");
  });
  page.querySelectorAll?.("button").forEach((element) => element.remove());
}

function createStaticPage({
  documentObject,
  editor,
  index,
  pageRange,
  sourceEditor,
  sourceHeader,
  sourceSheet,
}) {
  const fragment = cloneEditorRange(
    editor,
    pageRange.from,
    pageRange.to,
    documentObject,
  );
  if (!fragment) return null;
  const page = sourceSheet.cloneNode(false);
  page.classList.add("paged-page", "page-map-export-page");
  page.removeAttribute("contenteditable");
  page.setAttribute("data-page-map-page", String(index + 1));
  if (index > 0) page.classList.add("paper-page-map-continuation");

  if (index === 0 && sourceHeader) {
    const header = sourceHeader.cloneNode(true);
    syncClonedFormValues(sourceHeader, header);
    page.append(header);
  }

  const editorClone = sourceEditor.cloneNode(false);
  editorClone.classList.add("page-map-export-editor");
  editorClone.removeAttribute("contenteditable");
  editorClone.removeAttribute("spellcheck");
  editorClone.append(fragment);
  page.append(editorClone);

  const pageNumber = documentObject.createElement("span");
  pageNumber.className = "paper-page-number";
  pageNumber.textContent = String(index + 1);
  pageNumber.setAttribute("aria-hidden", "true");
  page.append(pageNumber);
  cleanStaticPage(page);
  return page;
}

export async function capturePageMapExportSnapshot(canvas) {
  const layout = await refreshRegisteredPageLayout(canvas, "export");
  if ((Number(layout?.pageMap?.oversizeCount) || 0) > 0) {
    throw pageMapExportError(
      `有 ${layout.pageMap.oversizeCount} 个不可拆分内容块或表格行超过 A4 可用高度，请缩小内容后再导出`,
      PAGE_MAP_EXPORT_UNSAFE_OVERSIZE,
    );
  }
  const plan = createPageMapExportPlan(layout?.pageMap);
  const documentObject = canvas?.ownerDocument || globalThis.document;
  const sourceSheet = canvas?.querySelector?.(".paper-sheet");
  const sourceEditor = sourceSheet?.querySelector?.(".paper-editor");
  if (!layout?.editor || !plan || !documentObject || !sourceSheet || !sourceEditor) {
    throw pageMapExportError("当前页面布局尚未就绪，请稍后重试导出");
  }
  const sourceHeader = sourceSheet.querySelector(".paper-header");
  const pages = plan.pages.map((pageRange, index) => createStaticPage({
    documentObject,
    editor: layout.editor,
    index,
    pageRange,
    sourceEditor,
    sourceHeader,
    sourceSheet,
  }));
  if (pages.some((page) => !page)) {
    throw pageMapExportError("无法按当前 PageMap 安全拆分页内容，请稍后重试导出");
  }
  return {
    documentObject,
    generation: plan.generation,
    pageCount: plan.pageCount,
    pages,
  };
}

export function mountPageMapExportSnapshot(snapshot, mode = "print") {
  if (!snapshot?.documentObject || !snapshot.pages?.length) return null;
  const { documentObject } = snapshot;
  cleanupPageMapExportStage(documentObject);
  const stage = documentObject.createElement("div");
  stage.id = PAGE_MAP_EXPORT_STAGE_ID;
  stage.className = mode === "image"
    ? "page-map-export-stage image-export-stage"
    : "page-map-export-stage";
  stage.setAttribute("data-page-map-generation", String(snapshot.generation));
  snapshot.pages.forEach((page) => stage.append(page));
  documentObject.body.append(stage);
  documentObject.body.classList.add(
    mode === "image"
      ? "page-map-export-image-body"
      : "page-map-export-print-body",
  );
  return stage;
}

export function waitForPageMapExportAssets(stage) {
  return waitForImageExportAssets(stage);
}

export async function preparePageMapImageExportRects(snapshot) {
  const stage = mountPageMapExportSnapshot(snapshot, "image");
  if (!stage) return [];
  await waitForImageExportAssets(stage);
  const view = stage.ownerDocument?.defaultView || globalThis;
  return [...stage.querySelectorAll(".page-map-export-page")].map((page) => {
    const rect = page.getBoundingClientRect();
    return {
      x: Math.floor(rect.left + (view.scrollX || 0)),
      y: Math.floor(rect.top + (view.scrollY || 0)),
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
    };
  });
}

export function applyPrintPaperBackground(sheet) {
  if (!sheet) {
    return () => {};
  }
  const rootStyle = window.document.documentElement.style;
  const computedStyle = window.getComputedStyle(sheet);
  const sheetStyle = sheet.style;
  const previousMinimumHeight = {
    value: sheetStyle.getPropertyValue("--print-sheet-min-height"),
    priority: sheetStyle.getPropertyPriority("--print-sheet-min-height"),
  };
  const variables = [
    ["--print-paper-repeat-bg", "--paper-repeat-bg"],
    ["--print-paper-base", "--paper-base"],
  ];
  const previous = variables.map(([target]) => ({
    target,
    value: rootStyle.getPropertyValue(target),
    priority: rootStyle.getPropertyPriority(target),
  }));
  variables.forEach(([target, source]) => {
    const value = sheet.style.getPropertyValue(source) || computedStyle.getPropertyValue(source);
    if (value) {
      rootStyle.setProperty(target, value.trim());
    }
  });
  const sheetWidth = sheet.getBoundingClientRect().width || 794;
  const pageHeight = sheetWidth * (297 / 210);
  const segments = getFlowExportSegments(sheet);
  const pageCount = Math.max(1, segments.reduce(
    (total, segment) => total + Math.max(1, Math.ceil((segment.bottom - segment.top) / pageHeight)),
    0,
  ));
  sheetStyle.setProperty("--print-sheet-min-height", `${Math.ceil(pageCount * pageHeight)}px`);
  return () => {
    previous.forEach(({ target, value, priority }) => {
      if (value) rootStyle.setProperty(target, value, priority);
      else rootStyle.removeProperty(target);
    });
    if (previousMinimumHeight.value) {
      sheetStyle.setProperty("--print-sheet-min-height", previousMinimumHeight.value, previousMinimumHeight.priority);
    } else {
      sheetStyle.removeProperty("--print-sheet-min-height");
    }
  };
}

export function syncClonedFormValues(source, clone) {
  const sourceControls = Array.from(source.querySelectorAll("input, textarea"));
  const cloneControls = Array.from(clone.querySelectorAll("input, textarea"));
  sourceControls.forEach((control, index) => {
    const clonedControl = cloneControls[index];
    if (!clonedControl) {
      return;
    }
    clonedControl.value = control.value;
    clonedControl.setAttribute("value", control.value);
    if (clonedControl.tagName === "TEXTAREA") {
      clonedControl.textContent = control.value;
    }
  });
}

export function getFlowExportSegments(sheet) {
  const sheetRect = sheet.getBoundingClientRect();
  const editorElement = sheet.querySelector(".paper-editor");
  const editorChildren = editorElement ? Array.from(editorElement.children) : [];
  const groups = [];
  let currentGroup = { startBreak: null, endBreak: null, nodes: [] };

  editorChildren.forEach((child) => {
    if (child.matches?.(".paper-page-break")) {
      currentGroup.endBreak = child;
      groups.push(currentGroup);
      currentGroup = { startBreak: child, endBreak: null, nodes: [] };
      return;
    }
    currentGroup.nodes.push(child);
  });
  groups.push(currentGroup);

  const header = sheet.querySelector(".paper-header");
  return groups
    .map((group, index) => {
      const contentRects = group.nodes
        .map((node) => node.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);
      if (index === 0 && header) {
        contentRects.unshift(header.getBoundingClientRect());
      }

      const startLimit = group.startBreak
        ? group.startBreak.getBoundingClientRect().bottom
        : sheetRect.top;
      const endLimit = group.endBreak
        ? group.endBreak.getBoundingClientRect().top
        : sheetRect.bottom;
      const firstContentTop = contentRects[0]?.top ?? startLimit;
      const lastContentBottom = contentRects[contentRects.length - 1]?.bottom ?? endLimit;
      const top = index === 0
        ? sheetRect.top
        : Math.max(sheetRect.top, startLimit, firstContentTop - IMAGE_EXPORT_SEGMENT_PADDING);
      const bottomPadding = group.endBreak ? IMAGE_EXPORT_SEGMENT_PADDING : IMAGE_EXPORT_SEGMENT_PADDING * 2;
      const bottom = Math.min(
        sheetRect.bottom,
        endLimit,
        Math.max(top + 80, lastContentBottom + bottomPadding),
      );

      return {
        top: Math.max(0, top - sheetRect.top),
        bottom: Math.max(0, bottom - sheetRect.top),
      };
    })
    .filter((segment) => segment.bottom - segment.top >= 80);
}

export async function prepareImageExportRects(sourceSheet = null) {
  cleanupImageExportStage();
  const sheet = sourceSheet || window.document.querySelector(".paper-sheet");
  if (!sheet) {
    return [];
  }

  const sheetRect = sheet.getBoundingClientRect();
  const stage = window.document.createElement("div");
  stage.id = IMAGE_EXPORT_STAGE_ID;
  stage.className = "image-export-stage";
  stage.style.width = `${Math.ceil(sheetRect.width)}px`;
  window.document.body.append(stage);

  const clone = sheet.cloneNode(true);
  syncClonedFormValues(sheet, clone);
  clone.style.width = `${sheetRect.width}px`;
  clone.style.minWidth = `${sheetRect.width}px`;
  clone.style.margin = "0";
  stage.append(clone);
  await waitForImageExportAssets(clone);

  const cloneRect = clone.getBoundingClientRect();
  const segments = getFlowExportSegments(clone);
  if (!segments.length) {
    cleanupImageExportStage();
    return [];
  }
  const maximumCaptureHeight = 8000;
  return segments.flatMap((segment) => {
    const pieces = [];
    for (let top = segment.top; top < segment.bottom; top += maximumCaptureHeight) {
      pieces.push({ top, bottom: Math.min(segment.bottom, top + maximumCaptureHeight) });
    }
    return pieces;
  }).map((segment) => ({
    x: Math.floor(cloneRect.left + window.scrollX),
    y: Math.floor(cloneRect.top + window.scrollY + segment.top),
    width: Math.ceil(cloneRect.width),
    height: Math.ceil(segment.bottom - segment.top),
  }));
}
