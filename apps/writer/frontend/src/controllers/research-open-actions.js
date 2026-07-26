import { useCallback } from "react";
import { bridge } from "../bridge.js";
import {
  canOpenResearchItem,
  researchEntryType,
  researchPreviewKind,
} from "../research-ui-model.js";
import { WORKSPACE_GROUP_ID } from "../workspace-groups.js";

export function useResearchOpenActions({
  addOrActivateDocumentTab,
  aiMode,
  closeActiveResearchView,
  handleNavigateResearchPath,
  openResearchPreviewView,
  requestExitAiMode,
  researchBridge = bridge,
  researchState,
  showStatus,
}) {
  const { researchRoot, researchRootRef } = researchState;

  const openIndependentResearchItem = useCallback(async (item, options = {}) => {
    if (!researchRoot?.libraryId || !item) return;
    const libraryId = researchRoot.libraryId;
    if (researchEntryType(item) === "folder") {
      await handleNavigateResearchPath(item.relativePath);
      return;
    }
    const previewKind = item.type === "web" ? "web" : researchPreviewKind(item);
    if (previewKind === "unsupported" || !canOpenResearchItem(item)) {
      showStatus("此文件类型不支持在笺间打开", "warning");
      return;
    }
    if (aiMode) {
      if (!(await requestExitAiMode())) return;
      if (researchRootRef.current?.libraryId !== libraryId) return;
    }
    if (previewKind === "document") {
      try {
        const result = await researchBridge.openResearchDocument?.(libraryId, item.relativePath);
        if (researchRootRef.current?.libraryId !== libraryId) return;
        if (result?.canceled || !result?.document) {
          showStatus(result?.message || "无法打开资料中的笺间文档", "warning");
          return;
        }
        const tabId = addOrActivateDocumentTab(result.document, result.path, false, {
          groupId: WORKSPACE_GROUP_ID.SECONDARY,
          diskRevision: result.diskRevision,
          readOnly: result.readOnly,
        });
        if (!tabId) showStatus("标签栏已满，请先关闭一个标签", "warning");
        else showStatus("资料信笺已在右侧打开", "success");
        return tabId || "";
      } catch (error) {
        if (researchRootRef.current?.libraryId === libraryId) {
          showStatus(error?.message || "无法打开资料中的笺间文档", "warning");
        }
      }
      return "";
    }
    if (researchRootRef.current?.libraryId !== libraryId) return;
    const runtimeItem = options.searchTarget
      ? { ...item, searchTarget: options.searchTarget }
      : item;
    const target = item.type === "web"
      ? { libraryId, sourceId: item.id }
      : { libraryId, relativePath: item.relativePath };
    const titleSnapshot = item.title || item.name || item.fileName || item.relativePath || "未命名资料";
    return openResearchPreviewView({
      item: runtimeItem,
      researchType: previewKind,
      target,
      titleSnapshot,
    });
  }, [addOrActivateDocumentTab, aiMode, handleNavigateResearchPath, openResearchPreviewView, requestExitAiMode, researchRoot?.libraryId, showStatus]);

  const closeResearchSecondaryPane = useCallback(() => {
    closeActiveResearchView();
  }, [closeActiveResearchView]);

  const handleLoadIndependentResearchPdf = useCallback(async (item, options = {}) => {
    if (!researchRoot?.libraryId || !item?.relativePath) throw new Error("资料 PDF 已失效");
    const libraryId = researchRoot.libraryId;
    if (options.signal?.aborted) throw new DOMException("读取已取消", "AbortError");
    const result = await researchBridge.readResearchPdf?.(libraryId, item.relativePath);
    if (options.signal?.aborted) throw new DOMException("读取已取消", "AbortError");
    if (researchRootRef.current?.libraryId !== libraryId) throw new DOMException("读取已取消", "AbortError");
    return result;
  }, [researchRoot?.libraryId]);

  const handleLoadIndependentResearchPreview = useCallback(async (item, options = {}) => {
    if (!researchRoot?.libraryId || !item?.relativePath) throw new Error("资料文件已失效");
    const libraryId = researchRoot.libraryId;
    if (options.signal?.aborted) throw new DOMException("读取已取消", "AbortError");
    const result = await researchBridge.readResearchPreview?.(libraryId, item.relativePath);
    if (options.signal?.aborted) throw new DOMException("读取已取消", "AbortError");
    if (researchRootRef.current?.libraryId !== libraryId) throw new DOMException("读取已取消", "AbortError");
    if (result?.unsupported) throw new Error(result.message || "当前环境不能读取本地资料文件");
    return result;
  }, [researchRoot?.libraryId]);

  const handleOpenIndependentResearchExternal = useCallback(async (item) => {
    const libraryId = researchRoot?.libraryId;
    try {
      if (item?.type === "web") await researchBridge.openExternal?.(item.url);
      else await researchBridge.openResearchEntryExternal?.(libraryId, item?.relativePath || "");
    } catch (error) {
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "无法打开资料", "warning");
    }
  }, [researchRoot?.libraryId, showStatus]);

  return {
    closeResearchSecondaryPane,
    handleLoadIndependentResearchPdf,
    handleLoadIndependentResearchPreview,
    handleOpenIndependentResearchExternal,
    openIndependentResearchItem,
  };
}
