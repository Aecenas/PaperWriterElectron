import { useCallback } from "react";
import { bridge } from "../bridge.js";

export function useResearchSourceWebActions({
  refreshResearchLibrarySources,
  refreshResearchWebTree,
  removeOpenResearchViews,
  researchBridge = bridge,
  researchState,
  setWebCopyDialog,
  setWebSourceDialog,
  showConfirmDialog,
  showPromptDialog,
  showStatus,
  webSourceDialog,
}) {
  const {
    librarySources,
    researchRoot,
    researchRootRef,
    setActiveLibraryItem,
    setResearchItemsByViewId,
    setWebWorkspaceMode,
    webScopeKey,
    webTreeState,
    webWorkspaceConnected,
    writingWorkspaceIdentity,
  } = researchState;

  const saveResearchLibrarySource = useCallback(async (draft, previous = null) => {
    if (!researchRoot?.libraryId) return null;
    const libraryId = researchRoot.libraryId;
    const result = await researchBridge.upsertResearchLibrarySource?.(
      libraryId,
      draft,
      previous?.diskRevision || null,
    );
    if (researchRootRef.current?.libraryId !== libraryId) return null;
    if (result?.conflict) {
      const choice = await showConfirmDialog({
        title: "资料来源已在同步盘中修改",
        message: "磁盘版本不会被覆盖。你可以重新载入，或把当前表单内容另存为一条新资料。",
        actions: [{ value: "copy", label: "另存为新资料" }, { value: "reload", label: "重新载入" }],
        cancelValue: "reload",
      });
      if (researchRootRef.current?.libraryId !== libraryId) return null;
      if (choice === "copy") {
        const copy = { ...draft };
        delete copy.id;
        delete copy.diskRevision;
        return saveResearchLibrarySource(copy, null);
      }
      await refreshResearchLibrarySources(libraryId);
      return null;
    }
    if (result?.source) {
      await refreshResearchLibrarySources(libraryId);
      if (researchRootRef.current?.libraryId !== libraryId) return null;
      setActiveLibraryItem(result.source);
      setResearchItemsByViewId((previousItems) => {
        let changed = false;
        const next = { ...previousItems };
        for (const [viewId, item] of Object.entries(previousItems)) {
          if (item?.id !== result.source.id) continue;
          next[viewId] = result.source;
          changed = true;
        }
        return changed ? next : previousItems;
      });
      return result.source;
    }
    return null;
  }, [refreshResearchLibrarySources, researchRoot?.libraryId, showConfirmDialog]);

  const handleAddLibraryWeb = useCallback(async (target = null) => {
    const source = target?.type === "web" ? target : null;
    const placement = source ? webTreeState.placements[source.id] : null;
    setWebSourceDialog({
      open: true,
      source,
      folderId: typeof target === "string" ? target : (placement?.folderId || ""),
      scopeKey: source ? (placement?.scopeKey || "global") : webScopeKey,
    });
  }, [webScopeKey, webTreeState.placements]);

  const handleSaveLibraryWeb = useCallback(async (draft) => {
    const source = webSourceDialog.source;
    if (!researchRoot?.libraryId) throw new Error("资料库尚未连接");
    const libraryId = researchRoot.libraryId;
    const result = await researchBridge.upsertResearchWebSource?.(
      libraryId,
      { ...source, ...draft, type: "web", notes: "" },
      { scopeKey: webSourceDialog.scopeKey || webScopeKey, folderId: webSourceDialog.folderId || "" },
      { source: source?.diskRevision || null, tree: webTreeState.diskRevision || null },
    );
    if (researchRootRef.current?.libraryId !== libraryId) return null;
    if (result?.conflict || result?.ok === false) {
      await Promise.all([refreshResearchLibrarySources(libraryId), refreshResearchWebTree(libraryId)]);
      if (researchRootRef.current?.libraryId !== libraryId) return null;
      throw new Error(result?.message || "网页资料已被外部修改，已重新载入且未覆盖磁盘版本");
    }
    if (!result?.source) throw new Error("网页资料保存失败");
    await Promise.all([refreshResearchLibrarySources(libraryId), refreshResearchWebTree(libraryId)]);
    if (researchRootRef.current?.libraryId !== libraryId) return null;
    setActiveLibraryItem((previous) => previous?.id === result.source.id ? result.source : previous);
    setResearchItemsByViewId((previous) => Object.fromEntries(
      Object.entries(previous).map(([viewId, item]) => [viewId, item?.id === result.source.id ? result.source : item]),
    ));
    showStatus(
      result.placementFallback
        ? (result.warning || "网页已保存，但暂时回退到全局未分组")
        : (source ? "网页资料已更新" : "网页资料已加入"),
      result.placementFallback ? "warning" : "success",
    );
    return result.source;
  }, [refreshResearchLibrarySources, refreshResearchWebTree, researchRoot?.libraryId, showStatus, webScopeKey, webSourceDialog, webTreeState.diskRevision]);

  const handleToggleWebWorkspace = useCallback(() => {
    if (!writingWorkspaceIdentity?.workspaceId) {
      showStatus("请先在文件区打开一个写作工作区；浏览器预览不能连接工作区网页区", "warning");
      return;
    }
    const leavingScope = webScopeKey;
    const leavingIds = new Set(librarySources
      .filter((source) => source.type === "web" && (webTreeState.placements[source.id]?.scopeKey || "global") === leavingScope)
      .map((source) => source.id));
    removeOpenResearchViews((view) => view.sourceId && leavingIds.has(view.sourceId));
    setWebWorkspaceMode((mode) => mode === "workspace" ? "global" : "workspace");
  }, [librarySources, removeOpenResearchViews, showStatus, webScopeKey, webTreeState.placements, writingWorkspaceIdentity?.workspaceId]);

  const handleOpenWebCopyDialog = useCallback(() => {
    if (!researchRoot?.libraryId) {
      showStatus("请先选择资料文件夹", "warning");
      return;
    }
    if (!webWorkspaceConnected || !webScopeKey.startsWith("workspace:")) {
      showStatus("请先连接当前工作区的私区网页", "warning");
      return;
    }
    if (webTreeState.readOnly) {
      showStatus("网页树索引只读，暂时不能复制", "warning");
      return;
    }
    setWebCopyDialog({ open: true });
  }, [researchRoot?.libraryId, showStatus, webScopeKey, webTreeState.readOnly, webWorkspaceConnected]);

  const handleCloseWebCopyDialog = useCallback(() => setWebCopyDialog({ open: false }), []);

  const handleCopyWebSelection = useCallback(async ({ folderIds = [], sourceIds = [] } = {}) => {
    if (!researchRoot?.libraryId || !webWorkspaceConnected || !webScopeKey.startsWith("workspace:")) {
      throw new Error("当前没有可用的工作区私区");
    }
    const libraryId = researchRoot.libraryId;
    const result = await researchBridge.copyResearchWebSelection?.(libraryId, {
      folderIds,
      sourceIds,
      targetScopeKey: webScopeKey,
      expectedTreeRevision: webTreeState.diskRevision || null,
    });
    if (researchRootRef.current?.libraryId !== libraryId) return null;
    if (!result || result.conflict || result.ok === false) {
      await Promise.all([refreshResearchLibrarySources(libraryId), refreshResearchWebTree(libraryId)]);
      if (researchRootRef.current?.libraryId !== libraryId) return null;
      throw new Error(result?.message || "网页树已被外部修改，已重新载入且未复制");
    }
    await Promise.all([refreshResearchLibrarySources(libraryId), refreshResearchWebTree(libraryId)]);
    if (researchRootRef.current?.libraryId !== libraryId) return null;
    const summary = `已复制 ${result.copiedSourceCount || 0} 个网址，创建 ${result.createdFolderCount || 0} 个文件夹`;
    showStatus(
      result.skippedDuplicateCount ? `${summary}，跳过 ${result.skippedDuplicateCount} 个重复网址` : summary,
      result.warnings?.length ? "warning" : "success",
    );
    return result;
  }, [refreshResearchLibrarySources, refreshResearchWebTree, researchRoot?.libraryId, showStatus, webScopeKey, webTreeState.diskRevision, webWorkspaceConnected]);

  const handleCreateWebFolder = useCallback(async (parentId = "") => {
    if (!researchRoot?.libraryId || webTreeState.readOnly) return;
    const libraryId = researchRoot.libraryId;
    const name = await showPromptDialog({ title: "新建网页文件夹", label: "文件夹名称", defaultValue: "新建文件夹", confirmLabel: "创建" });
    if (!name?.trim() || researchRootRef.current?.libraryId !== libraryId) return;
    try {
      const result = await researchBridge.createResearchWebFolder?.(
        libraryId,
        { name: name.trim(), parentId, scopeKey: webScopeKey },
        webTreeState.diskRevision || null,
      );
      if (researchRootRef.current?.libraryId !== libraryId) return;
      if (result?.conflict) throw new Error(result.message || "网页分组已被外部修改");
      await refreshResearchWebTree(libraryId);
    } catch (error) {
      if (researchRootRef.current?.libraryId !== libraryId) return;
      await refreshResearchWebTree(libraryId);
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "网页文件夹创建失败", "warning");
    }
  }, [refreshResearchWebTree, researchRoot?.libraryId, showPromptDialog, showStatus, webScopeKey, webTreeState.diskRevision, webTreeState.readOnly]);

  const handleRenameWebFolder = useCallback(async (folder) => {
    if (!researchRoot?.libraryId || !folder?.id || webTreeState.readOnly) return;
    const libraryId = researchRoot.libraryId;
    const name = await showPromptDialog({ title: "重命名网页文件夹", label: "文件夹名称", defaultValue: folder.name || "", confirmLabel: "保存" });
    if (!name?.trim() || name.trim() === folder.name || researchRootRef.current?.libraryId !== libraryId) return;
    try {
      const result = await researchBridge.updateResearchWebFolder?.(
        libraryId,
        { id: folder.id, name: name.trim() },
        webTreeState.diskRevision || null,
      );
      if (researchRootRef.current?.libraryId !== libraryId) return;
      if (result?.conflict) throw new Error(result.message || "网页分组已被外部修改");
      await refreshResearchWebTree(libraryId);
    } catch (error) {
      if (researchRootRef.current?.libraryId !== libraryId) return;
      await refreshResearchWebTree(libraryId);
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "网页文件夹重命名失败", "warning");
    }
  }, [refreshResearchWebTree, researchRoot?.libraryId, showPromptDialog, showStatus, webTreeState.diskRevision, webTreeState.readOnly]);

  const handleDeleteWebFolder = useCallback(async (folder) => {
    if (!researchRoot?.libraryId || !folder?.id || webTreeState.readOnly) return;
    const libraryId = researchRoot.libraryId;
    const choice = await showConfirmDialog({
      title: "删除网页文件夹",
      message: "文件夹本身会删除，其中的网页和直接子文件夹会提升到上一级，不会删除任何网页。",
      actions: [{ value: "delete", label: "删除文件夹", tone: "danger" }, { value: "cancel", label: "取消" }],
      cancelValue: "cancel",
    });
    if (choice !== "delete" || researchRootRef.current?.libraryId !== libraryId) return;
    try {
      const result = await researchBridge.deleteResearchWebFolder?.(libraryId, folder.id, webTreeState.diskRevision || null);
      if (researchRootRef.current?.libraryId !== libraryId) return;
      if (result?.conflict) throw new Error(result.message || "网页分组已被外部修改");
      await refreshResearchWebTree(libraryId);
    } catch (error) {
      if (researchRootRef.current?.libraryId !== libraryId) return;
      await refreshResearchWebTree(libraryId);
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "网页文件夹删除失败", "warning");
    }
  }, [refreshResearchWebTree, researchRoot?.libraryId, showConfirmDialog, showStatus, webTreeState.diskRevision, webTreeState.readOnly]);

  const handleMoveWebFolder = useCallback(async (folder, parentId = "") => {
    if (!researchRoot?.libraryId || !folder?.id || folder.parentId === parentId || webTreeState.readOnly) return;
    const libraryId = researchRoot.libraryId;
    try {
      const result = await researchBridge.updateResearchWebFolder?.(
        libraryId,
        { id: folder.id, parentId },
        webTreeState.diskRevision || null,
      );
      if (researchRootRef.current?.libraryId !== libraryId) return;
      await refreshResearchWebTree(libraryId);
      if (researchRootRef.current?.libraryId !== libraryId) return;
      if (result?.conflict || result?.ok === false) showStatus(result?.message || "网页文件夹移动失败", "warning");
    } catch (error) {
      if (researchRootRef.current?.libraryId !== libraryId) return;
      await refreshResearchWebTree(libraryId);
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "网页文件夹移动失败", "warning");
    }
  }, [refreshResearchWebTree, researchRoot?.libraryId, showStatus, webTreeState.diskRevision, webTreeState.readOnly]);

  const handleMoveWebSource = useCallback(async (source, folderId = "") => {
    if (!researchRoot?.libraryId || !source?.id || webTreeState.readOnly) return;
    const libraryId = researchRoot.libraryId;
    try {
      const result = await researchBridge.moveResearchWebSource?.(
        libraryId,
        source.id,
        { scopeKey: webScopeKey, folderId },
        webTreeState.diskRevision || null,
      );
      if (researchRootRef.current?.libraryId !== libraryId) return;
      await refreshResearchWebTree(libraryId);
      if (researchRootRef.current?.libraryId !== libraryId) return;
      if (result?.conflict || result?.ok === false) showStatus(result?.message || "网页移动失败", "warning");
    } catch (error) {
      if (researchRootRef.current?.libraryId !== libraryId) return;
      await refreshResearchWebTree(libraryId);
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "网页移动失败", "warning");
    }
  }, [refreshResearchWebTree, researchRoot?.libraryId, showStatus, webScopeKey, webTreeState.diskRevision, webTreeState.readOnly]);

  const handleEditLibrarySource = useCallback((source) => (
    source?.type === "web" ? handleAddLibraryWeb(source) : undefined
  ), [handleAddLibraryWeb]);

  const handleDeleteLibrarySource = useCallback(async (source) => {
    if (!researchRoot?.libraryId || !source?.id) return;
    const libraryId = researchRoot.libraryId;
    const choice = await showConfirmDialog({
      title: "删除网页",
      message: "资料来源记录会从当前资料目录删除；信笺里已有的引用快照仍会保留。",
      actions: [{ value: "delete", label: "删除", tone: "danger" }, { value: "cancel", label: "取消" }],
      cancelValue: "cancel",
    });
    if (choice !== "delete" || researchRootRef.current?.libraryId !== libraryId) return;
    try {
      const result = await researchBridge.deleteResearchLibrarySource?.(libraryId, source.id, source.diskRevision || null);
      if (researchRootRef.current?.libraryId !== libraryId) return;
      if (result?.conflict) {
        await Promise.all([refreshResearchLibrarySources(libraryId), refreshResearchWebTree(libraryId)]);
        if (researchRootRef.current?.libraryId === libraryId) {
          showStatus("来源已被外部修改，已重新载入且未删除", "warning");
        }
        return;
      }
      await Promise.all([refreshResearchLibrarySources(libraryId), refreshResearchWebTree(libraryId)]);
      if (researchRootRef.current?.libraryId !== libraryId) return;
      removeOpenResearchViews((view) => view.libraryId === libraryId && view.sourceId === source.id);
      showStatus("网页资料已删除", "success");
    } catch (error) {
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "资料来源删除失败", "warning");
    }
  }, [refreshResearchLibrarySources, refreshResearchWebTree, removeOpenResearchViews, researchRoot?.libraryId, showConfirmDialog, showStatus]);

  return {
    handleAddLibraryWeb,
    handleCloseWebCopyDialog,
    handleCopyWebSelection,
    handleCreateWebFolder,
    handleDeleteLibrarySource,
    handleDeleteWebFolder,
    handleEditLibrarySource,
    handleMoveWebFolder,
    handleMoveWebSource,
    handleOpenWebCopyDialog,
    handleRenameWebFolder,
    handleSaveLibraryWeb,
    handleToggleWebWorkspace,
    saveResearchLibrarySource,
  };
}
