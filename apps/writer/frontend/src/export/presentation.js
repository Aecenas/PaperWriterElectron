import { waitForImageExportAssets } from "../image-export-readiness.js";

export const IMAGE_EXPORT_STAGE_ID = "paperwriter-image-export-stage";
export const IMAGE_EXPORT_SEGMENT_PADDING = 24;

export function cleanupImageExportStage() {
  window.document.getElementById(IMAGE_EXPORT_STAGE_ID)?.remove();
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
