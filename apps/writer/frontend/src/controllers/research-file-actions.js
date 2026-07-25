import { useCallback } from "react";
import { bridge } from "../bridge.js";
import { normalizeResearchRelativePath, researchEntryType } from "../research-ui-model.js";
import { WORKSPACE_VIEW_KIND } from "../workspace-groups.js";

export function useResearchFileActions({
  activeSecondaryView,
  applyResearchRoot,
  refreshIndependentResearchFolder,
  removeOpenResearchViews,
  researchBridge = bridge,
  researchState,
  requestControllerRefs,
  setLeftSidebarMode,
  showConfirmDialog,
  showPromptDialog,
  showStatus,
  updateOpenResearchTargets,
}) {
  const {
    researchCurrentRelativePathRef,
    researchExpandedFoldersRef,
    researchRoot,
    researchRootRef,
    setActiveLibraryItem,
    setResearchBusyKeys,
    setResearchCurrentRelativePath,
    setResearchEntries,
    setResearchExpandedFolders,
    setResearchTreeError,
  } = researchState;
  const { researchBranchRequestControllerRef } = requestControllerRefs;

  const handlePickResearchRoot = useCallback(async () => {
    try {
      const result = await researchBridge.pickResearchRoot?.();
      if (result?.canceled) return;
      const libraryId = result?.available ? String(result.libraryId || "") : "";
      await applyResearchRoot(result);
      if (String(researchRootRef.current?.libraryId || "") !== libraryId) return;
      setLeftSidebarMode("research");
      showStatus("资料目录已连接", "success");
    } catch (error) {
      showStatus(error?.message || "无法选择资料目录", "warning");
    }
  }, [applyResearchRoot, showStatus]);

  const runResearchEntryMutation = useCallback(async (key, task) => {
    setResearchBusyKeys((previous) => [...new Set([...previous, key].filter(Boolean))]);
    try {
      return await task();
    } finally {
      setResearchBusyKeys((previous) => previous.filter((item) => item !== key));
    }
  }, []);

  const handleToggleResearchFolder = useCallback(async (entry, expanded) => {
    const relativePath = String(entry?.relativePath || "");
    if (!relativePath) return;
    if (!expanded) {
      researchBranchRequestControllerRef.current.invalidate(relativePath);
      setResearchExpandedFolders((previous) => {
        const next = {
          ...previous,
          [relativePath]: { ...(previous[relativePath] || {}), expanded: false, loading: false },
        };
        researchExpandedFoldersRef.current = next;
        return next;
      });
      return;
    }
    await refreshIndependentResearchFolder(relativePath, undefined, { current: false, expand: true });
  }, [refreshIndependentResearchFolder]);

  const handleNavigateResearchPath = useCallback(async (relativePath = "") => {
    const libraryId = researchRootRef.current?.libraryId;
    if (!libraryId) return;
    const normalizedPath = normalizeResearchRelativePath(relativePath);
    researchCurrentRelativePathRef.current = normalizedPath;
    researchBranchRequestControllerRef.current.invalidateAll();
    researchExpandedFoldersRef.current = {};
    setResearchCurrentRelativePath(normalizedPath);
    setResearchEntries([]);
    setResearchExpandedFolders({});
    setResearchTreeError("");
    await refreshIndependentResearchFolder(normalizedPath, libraryId, { current: true });
  }, [refreshIndependentResearchFolder]);

  const handleCreateResearchFolder = useCallback(async (entry) => {
    if (!researchRoot?.libraryId) return;
    const libraryId = researchRoot.libraryId;
    const parentRelativePath = researchEntryType(entry) === "folder" ? entry.relativePath : researchCurrentRelativePathRef.current;
    const name = await showPromptDialog({ title: "新建资料文件夹", label: "文件夹名称", defaultValue: "新建文件夹", confirmLabel: "创建" });
    if (!name?.trim() || researchRootRef.current?.libraryId !== libraryId) return;
    const key = entry?.relativePath || "research-root";
    try {
      await runResearchEntryMutation(key, () => researchBridge.createResearchFolder?.(libraryId, parentRelativePath, name.trim()));
      if (researchRootRef.current?.libraryId !== libraryId) return;
      await refreshIndependentResearchFolder(parentRelativePath, libraryId);
      if (researchRootRef.current?.libraryId !== libraryId) return;
      showStatus("资料文件夹已创建", "success");
    } catch (error) {
      if (researchRootRef.current?.libraryId === libraryId) {
        showStatus(error?.message || "资料文件夹创建失败", "warning");
      }
    }
  }, [refreshIndependentResearchFolder, researchRoot?.libraryId, runResearchEntryMutation, showPromptDialog, showStatus]);

  const handleImportResearchFiles = useCallback(async (entry) => {
    if (!researchRoot?.libraryId) return;
    const libraryId = researchRoot.libraryId;
    const targetRelativePath = researchEntryType(entry) === "folder" ? entry.relativePath : researchCurrentRelativePathRef.current;
    const key = entry?.relativePath || "research-root";
    try {
      const result = await runResearchEntryMutation(key, () => researchBridge.importResearchFiles?.(libraryId, targetRelativePath));
      if (result?.canceled || researchRootRef.current?.libraryId !== libraryId) return;
      await refreshIndependentResearchFolder(targetRelativePath, libraryId);
      if (researchRootRef.current?.libraryId !== libraryId) return;
      showStatus(`已导入 ${result?.imported?.length || 0} 个资料文件`, "success");
    } catch (error) {
      if (researchRootRef.current?.libraryId === libraryId) {
        showStatus(error?.message || "资料文件导入失败", "warning");
      }
    }
  }, [refreshIndependentResearchFolder, researchRoot?.libraryId, runResearchEntryMutation, showStatus]);

  const handleRenameResearchEntry = useCallback(async (entry) => {
    if (!researchRoot?.libraryId || !entry?.relativePath) return;
    const libraryId = researchRoot.libraryId;
    const nextName = await showPromptDialog({ title: "重命名资料项目", label: "新名称", defaultValue: entry.name || "", confirmLabel: "重命名" });
    if (!nextName?.trim() || nextName.trim() === entry.name || researchRootRef.current?.libraryId !== libraryId) return;
    try {
      const result = await runResearchEntryMutation(entry.relativePath, () => researchBridge.renameResearchEntry?.(libraryId, entry.relativePath, nextName.trim()));
      if (researchRootRef.current?.libraryId !== libraryId) return;
      setResearchExpandedFolders({});
      await refreshIndependentResearchFolder(researchCurrentRelativePathRef.current, libraryId, { current: true });
      if (researchRootRef.current?.libraryId !== libraryId) return;
      updateOpenResearchTargets(libraryId, entry.relativePath, result.relativePath, { name: nextName.trim() });
      if (
        activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH
        && activeSecondaryView.libraryId === libraryId
        && activeSecondaryView.relativePath === entry.relativePath
      ) {
        setActiveLibraryItem((previous) => previous ? { ...previous, name: nextName.trim(), relativePath: result.relativePath } : previous);
      }
      showStatus(result?.warnings?.length ? "已重命名；部分资料身份路径需手动检查" : "资料项目已重命名", result?.warnings?.length ? "warning" : "success");
    } catch (error) {
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "重命名失败", "warning");
    }
  }, [activeSecondaryView, refreshIndependentResearchFolder, researchRoot?.libraryId, runResearchEntryMutation, showPromptDialog, showStatus, updateOpenResearchTargets]);

  const handleMoveResearchEntry = useCallback(async (entry, targetEntry) => {
    if (!researchRoot?.libraryId || !entry?.relativePath) return;
    const libraryId = researchRoot.libraryId;
    let targetRelativePath = researchEntryType(targetEntry) === "folder" ? targetEntry.relativePath : researchCurrentRelativePathRef.current;
    if (!targetEntry) {
      const chosen = await showPromptDialog({ title: "移动资料项目", label: "目标文件夹（相对资料目录，根目录留空）", defaultValue: "", confirmLabel: "移动" });
      if (chosen === null || researchRootRef.current?.libraryId !== libraryId) return;
      targetRelativePath = chosen.trim().replace(/\\/g, "/");
    }
    try {
      const result = await runResearchEntryMutation(entry.relativePath, () => researchBridge.moveResearchEntry?.(libraryId, entry.relativePath, targetRelativePath));
      if (researchRootRef.current?.libraryId !== libraryId) return;
      setResearchExpandedFolders({});
      await refreshIndependentResearchFolder(researchCurrentRelativePathRef.current, libraryId, { current: true });
      if (researchRootRef.current?.libraryId !== libraryId) return;
      updateOpenResearchTargets(libraryId, entry.relativePath, result.relativePath);
      if (
        activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH
        && activeSecondaryView.libraryId === libraryId
        && activeSecondaryView.relativePath === entry.relativePath
      ) {
        setActiveLibraryItem((previous) => previous ? { ...previous, relativePath: result.relativePath } : previous);
      }
      showStatus(result?.warnings?.length ? "已移动；部分资料身份路径需手动检查" : "资料项目已移动", result?.warnings?.length ? "warning" : "success");
    } catch (error) {
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "移动失败", "warning");
    }
  }, [activeSecondaryView, refreshIndependentResearchFolder, researchRoot?.libraryId, runResearchEntryMutation, showPromptDialog, showStatus, updateOpenResearchTargets]);

  const handleTrashResearchEntry = useCallback(async (entry) => {
    if (!researchRoot?.libraryId || !entry?.relativePath) return;
    const libraryId = researchRoot.libraryId;
    const choice = await showConfirmDialog({
      title: "移到系统回收站",
      message: `“${entry.name}”会移到系统回收站；资料身份记录不会被静默覆盖。`,
      actions: [{ value: "trash", label: "移到回收站", tone: "danger" }, { value: "cancel", label: "取消" }],
      cancelValue: "cancel",
    });
    if (choice !== "trash" || researchRootRef.current?.libraryId !== libraryId) return;
    try {
      await runResearchEntryMutation(entry.relativePath, () => researchBridge.trashResearchEntry?.(libraryId, entry.relativePath));
      if (researchRootRef.current?.libraryId !== libraryId) return;
      removeOpenResearchViews((view) => view.libraryId === libraryId
        && Boolean(view.relativePath)
        && (view.relativePath === entry.relativePath || view.relativePath.startsWith(`${entry.relativePath}/`)));
      setResearchExpandedFolders({});
      await refreshIndependentResearchFolder(researchCurrentRelativePathRef.current, libraryId, { current: true });
      if (researchRootRef.current?.libraryId !== libraryId) return;
      showStatus("资料项目已移到回收站", "success");
    } catch (error) {
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "无法移到回收站", "warning");
    }
  }, [refreshIndependentResearchFolder, removeOpenResearchViews, researchRoot?.libraryId, runResearchEntryMutation, showConfirmDialog, showStatus]);

  const handleCopyResearchPath = useCallback(async (entry) => {
    const libraryId = researchRoot?.libraryId;
    try {
      await researchBridge.copyResearchEntryPath?.(libraryId, entry?.relativePath || "");
      if (researchRootRef.current?.libraryId !== libraryId) return;
      showStatus("资料路径已复制", "success");
    } catch (error) {
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "路径复制失败", "warning");
    }
  }, [researchRoot?.libraryId, showStatus]);

  const handleShowResearchEntry = useCallback(async (entry) => {
    const libraryId = researchRoot?.libraryId;
    try {
      await researchBridge.showResearchEntry?.(libraryId, entry?.relativePath || "");
    } catch (error) {
      if (researchRootRef.current?.libraryId === libraryId) showStatus(error?.message || "无法在资源管理器中显示", "warning");
    }
  }, [researchRoot?.libraryId, showStatus]);

  return {
    handleCopyResearchPath,
    handleCreateResearchFolder,
    handleImportResearchFiles,
    handleMoveResearchEntry,
    handleNavigateResearchPath,
    handlePickResearchRoot,
    handleRenameResearchEntry,
    handleShowResearchEntry,
    handleToggleResearchFolder,
    handleTrashResearchEntry,
    runResearchEntryMutation,
  };
}
