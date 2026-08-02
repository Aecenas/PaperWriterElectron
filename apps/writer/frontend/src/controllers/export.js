import { useCallback, useState } from "react";
import { bridge } from "../bridge.js";
import { createEmptyAiState } from "../ai/state.js";
import {
  applyPrintPaperBackground,
  capturePageMapExportSnapshot,
  cleanupImageExportStage,
  cleanupPageMapExportStage,
  mountPageMapExportSnapshot,
  prepareImageExportRects,
  preparePageMapImageExportRects,
  waitForPageMapExportAssets,
} from "../export/presentation.js";
import {
  readCanvasScrollState,
  restoreCanvasScrollState,
} from "../document-workspace/canvas-state.js";
import { createProfessionalDocxRenderedHtml } from "../export/professional-docx-renders.js";

export function useExportDialogState() {
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportTarget, setExportTarget] = useState(null);
  const [exportRenderPane, setExportRenderPane] = useState("");
  return {
    exportDialogOpen,
    setExportDialogOpen,
    exportTarget,
    setExportTarget,
    exportRenderPane,
    setExportRenderPane,
  };
}

export function useExportPresentationState() {
  const [printMode, setPrintMode] = useState(false);
  const [imageExportMode, setImageExportMode] = useState(false);
  return {
    printMode,
    setPrintMode,
    imageExportMode,
    setImageExportMode,
  };
}

export function openExportDialog({
  activeTabIdRef,
  activeWorkDocument,
  activeWorkEditor,
  rightSplitTabIdRef,
  setExportDialogOpen,
  setExportTarget,
  showStatus,
  splitPaneActive,
}) {
  if (!activeWorkEditor || !activeWorkDocument) {
    showStatus("当前活动标签不是可导出的信笺", "warning");
    return;
  }
  const pane = splitPaneActive ? "right" : "main";
  const tabId = splitPaneActive ? rightSplitTabIdRef.current : activeTabIdRef.current;
  if (!tabId) {
    showStatus("没有找到要导出的信笺", "warning");
    return;
  }
  setExportTarget({
    pane,
    tabId,
    title: activeWorkDocument.title || "未命名信笺",
  });
  setExportDialogOpen(true);
}

export function closeExportDialog(setExportDialogOpen, setExportTarget) {
  setExportDialogOpen(false);
  setExportTarget(null);
}

export function useExportDialogActions({
  activeTabIdRef,
  activeWorkDocument,
  activeWorkEditor,
  rightSplitTabIdRef,
  setExportDialogOpen,
  setExportTarget,
  showStatus,
  splitPaneActive,
}) {
  const handleOpenExportDialog = useCallback(() => {
    openExportDialog({
      activeTabIdRef,
      activeWorkDocument,
      activeWorkEditor,
      rightSplitTabIdRef,
      setExportDialogOpen,
      setExportTarget,
      showStatus,
      splitPaneActive,
    });
  }, [activeWorkDocument, activeWorkEditor, showStatus, splitPaneActive]);

  const handleCloseExportDialog = useCallback(() => {
    closeExportDialog(setExportDialogOpen, setExportTarget);
  }, []);

  return { handleOpenExportDialog, handleCloseExportDialog };
}

export function createExportExecutionActions({
  applyPrintBackground = applyPrintPaperBackground,
  capturePageMapSnapshot = capturePageMapExportSnapshot,
  cleanupImageStage = cleanupImageExportStage,
  cleanupPageMapStage = cleanupPageMapExportStage,
  exportBridge = bridge,
  mountPageMapSnapshot = mountPageMapExportSnapshot,
  prepareImageRects = prepareImageExportRects,
  preparePageMapRects = preparePageMapImageExportRects,
  prepareProfessionalDocxHtml = createProfessionalDocxRenderedHtml,
  readCanvasScroll = readCanvasScrollState,
  resolveExportTarget,
  restoreCanvasScroll = restoreCanvasScrollState,
  setExportRenderPane,
  setImageExportMode,
  setPrintMode,
  showStatus,
  waitPageMapAssets = waitForPageMapExportAssets,
  windowObject,
}) {
  const capturePageMap = async (canvas) => capturePageMapSnapshot(canvas);
  const handleExportPdf = async (targetPath) => {
    const target = resolveExportTarget();
    const nextDocument = target.document;
    const pageMapSnapshot = await capturePageMap(target.canvas);
    setExportRenderPane(target.pane);
    setPrintMode(true);
    let restorePrintPaperBackground = () => {};
    try {
      await new Promise((resolve) => windowObject.requestAnimationFrame(() => windowObject.requestAnimationFrame(resolve)));
      const pageMapStage = pageMapSnapshot
        ? mountPageMapSnapshot(pageMapSnapshot, "print")
        : null;
      if (pageMapStage) await waitPageMapAssets(pageMapStage);
      const printSheet = pageMapStage?.querySelector(".page-map-export-page")
        || target.canvas?.querySelector(".paper-sheet");
      if (!printSheet) throw new Error("无法找到要导出的信笺画布");
      restorePrintPaperBackground = applyPrintBackground(printSheet);
      await new Promise((resolve) => windowObject.requestAnimationFrame(resolve));
      const result = await exportBridge.exportPdf(nextDocument.title, targetPath);
      if (!result?.canceled) {
        showStatus("PDF 已导出", "success");
      }
      return result;
    } finally {
      restorePrintPaperBackground();
      cleanupPageMapStage(windowObject.document);
      setPrintMode(false);
      setExportRenderPane("");
    }
  };

  const handleExportImages = async (targetPath) => {
    const target = resolveExportTarget();
    const nextDocument = target.document;
    const targetCanvas = target.canvas;
    if (!targetCanvas) throw new Error("无法找到要导出的信笺画布");
    const pageMapSnapshot = await capturePageMap(targetCanvas);
    const previousCanvasScroll = readCanvasScroll(targetCanvas);
    setExportRenderPane(target.pane);
    windowObject.document.body.classList.add("image-export-body");
    setImageExportMode(true);
    try {
      await new Promise((resolve) => windowObject.requestAnimationFrame(() => windowObject.requestAnimationFrame(resolve)));
      targetCanvas.scrollTop = 0;
      targetCanvas.scrollLeft = 0;
      windowObject.scrollTo(0, 0);
      await new Promise((resolve) => windowObject.requestAnimationFrame(() => windowObject.requestAnimationFrame(resolve)));
      const pageRects = pageMapSnapshot
        ? await preparePageMapRects(pageMapSnapshot)
        : await prepareImageRects(targetCanvas.querySelector(".paper-sheet"));
      await new Promise((resolve) => windowObject.requestAnimationFrame(resolve));
      if (!pageRects.length) {
        showStatus("没有可导出的内容", "warning");
        return { canceled: true, reason: "empty" };
      }
      const result = await exportBridge.exportPageImages(nextDocument.title, pageRects, targetPath);
      if (!result?.canceled) {
        showStatus(`已导出 ${result.count || pageRects.length} 张图片`, "success");
      }
      return result;
    } finally {
      windowObject.requestAnimationFrame(() => {
        restoreCanvasScroll(targetCanvas, previousCanvasScroll);
      });
      cleanupImageStage();
      cleanupPageMapStage(windowObject.document);
      setImageExportMode(false);
      setExportRenderPane("");
      windowObject.document.body.classList.remove("image-export-body");
    }
  };

  const handleExportEditable = async (format, targetPath) => {
    const target = resolveExportTarget();
    const nextDocument = target.document;
    const exchangeDocument = {
      ...nextDocument,
      comments: [],
      aiState: createEmptyAiState(),
    };
    let renderedHtml = "";
    if (format === "docx" || format === "html") {
      if (!target.canvas) throw new Error(`${format.toUpperCase()} 导出无法找到当前信笺画布`);
      const prepared = await prepareProfessionalDocxHtml({
        canvas: target.canvas,
        html: nextDocument.html || "<p></p>",
      });
      if (typeof prepared?.renderedHtml !== "string") {
        throw new Error(`${format.toUpperCase()} 专业内容栅格化未返回有效结果`);
      }
      renderedHtml = prepared.renderedHtml;
    }
    const result = await exportBridge.exportEditable?.(
      exchangeDocument,
      format,
      targetPath,
      renderedHtml,
    );
    if (!result?.canceled) {
      const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
      showStatus(warnings.length ? `${format.toUpperCase()} 已导出；有 ${warnings.length} 项降级` : `${format.toUpperCase()} 已导出`, warnings.length ? "warning" : "success");
    }
    return result;
  };

  return { handleExportPdf, handleExportImages, handleExportEditable };
}

export function useExportExecutionActions({
  resolveExportTarget,
  setExportRenderPane,
  setImageExportMode,
  setPrintMode,
  showStatus,
}) {
  const actions = createExportExecutionActions({
    resolveExportTarget,
    setExportRenderPane,
    setImageExportMode,
    setPrintMode,
    showStatus,
    windowObject: window,
  });
  const handleExportPdf = useCallback(
    actions.handleExportPdf,
    [resolveExportTarget, showStatus],
  );
  const handleExportImages = useCallback(
    actions.handleExportImages,
    [resolveExportTarget, showStatus],
  );
  const handleExportEditable = useCallback(
    actions.handleExportEditable,
    [resolveExportTarget, showStatus],
  );
  return { handleExportPdf, handleExportImages, handleExportEditable };
}
