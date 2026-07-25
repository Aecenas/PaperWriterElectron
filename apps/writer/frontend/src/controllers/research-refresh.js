import { useCallback } from "react";
import { bridge } from "../bridge.js";
import { normalizeResearchRelativePath } from "../research-ui-model.js";
import { normalizeResearchTreeEntries, replaceResearchTreeFolder } from "../research/tree-model.js";
import { createEmptyResearchWebTree } from "./research-state.js";

export async function refreshResearchLibrarySourcesCore(context, libraryId = context.researchRootRef.current?.libraryId) {
  const {
    researchBridge,
    researchRootRef,
    researchSourcesRequestControllerRef,
    setActiveLibraryItem,
    setLibrarySources,
    setLibrarySourcesReady,
    setResearchTreeError,
    showStatus,
  } = context;
  const controller = researchSourcesRequestControllerRef.current;
  if (!libraryId) {
    controller.invalidate("sources");
    setLibrarySources([]);
    setLibrarySourcesReady(false);
    return [];
  }
  const request = controller.begin("sources");
  setLibrarySourcesReady(false);
  try {
    const result = await researchBridge.listResearchLibrarySources?.(libraryId);
    const sources = Array.isArray(result?.sources) ? result.sources : [];
    if (
      !controller.isCurrent(request)
      || researchRootRef.current?.libraryId !== libraryId
    ) return sources;
    const warningCount = Array.isArray(result?.warnings) ? result.warnings.length : 0;
    const removedNoteCount = Array.isArray(result?.removedNoteSourceIds) ? result.removedNoteSourceIds.length : 0;
    if (warningCount) showStatus(`资料来源读取完成；${warningCount} 项元数据需要检查`, "warning");
    else if (removedNoteCount) showStatus(`已删除 ${removedNoteCount} 条旧笔记资料`, "success");
    setLibrarySources(sources);
    setLibrarySourcesReady(true);
    setActiveLibraryItem((previous) => {
      if (!previous?.id || previous.type === "file") return previous;
      return sources.find((source) => source.id === previous.id) || null;
    });
    return sources;
  } catch (error) {
    if (
      controller.isCurrent(request)
      && researchRootRef.current?.libraryId === libraryId
    ) {
      setLibrarySourcesReady(false);
      setResearchTreeError(error?.message || "资料来源读取失败");
    }
    return [];
  } finally {
    controller.finish(request);
  }
}

export async function refreshResearchWebTreeCore(context, libraryId = context.researchRootRef.current?.libraryId) {
  const {
    researchBridge,
    researchRootRef,
    researchWebRequestControllerRef,
    setWebTreeReady,
    setWebTreeState,
    showStatus,
  } = context;
  const controller = researchWebRequestControllerRef.current;
  if (!libraryId) {
    controller.invalidate("web-tree");
    setWebTreeState(createEmptyResearchWebTree());
    setWebTreeReady(false);
    return null;
  }
  const request = controller.begin("web-tree");
  setWebTreeReady(false);
  try {
    const result = await researchBridge.listResearchWebTree?.(libraryId);
    if (
      !controller.isCurrent(request)
      || researchRootRef.current?.libraryId !== libraryId
    ) return result;
    const next = {
      folders: Array.isArray(result?.folders) ? result.folders : (Array.isArray(result?.tree?.folders) ? result.tree.folders : []),
      placements: result?.placements && typeof result.placements === "object" ? result.placements : (result?.tree?.placements || {}),
      diskRevision: result?.diskRevision || null,
      warnings: Array.isArray(result?.warnings) ? result.warnings : [],
      readOnly: Boolean(result?.readOnly),
    };
    setWebTreeState(next);
    setWebTreeReady(true);
    if (next.warnings.length) showStatus("网页分组索引需要检查；当前以只读扁平列表显示", "warning");
    return result;
  } catch (error) {
    if (
      controller.isCurrent(request)
      && researchRootRef.current?.libraryId === libraryId
    ) {
      setWebTreeReady(false);
      showStatus(error?.message || "网页分组读取失败", "warning");
    }
    return null;
  } finally {
    controller.finish(request);
  }
}

export async function refreshIndependentResearchFolderCore(
  context,
  relativePath = "",
  libraryId = context.researchRootRef.current?.libraryId,
  options = {},
) {
  const {
    researchBridge,
    researchBranchRequestControllerRef,
    researchCurrentRelativePathRef,
    researchCurrentRequestControllerRef,
    researchExpandedFoldersRef,
    researchRootRef,
    setResearchEntries,
    setResearchExpandedFolders,
    setResearchTreeError,
    setResearchTreeLoading,
  } = context;
  if (!libraryId) {
    setResearchEntries([]);
    return [];
  }
  const normalizedPath = normalizeResearchRelativePath(relativePath);
  const updateCurrent = options.current === true
    || (options.current !== false && normalizedPath === researchCurrentRelativePathRef.current);
  const controller = updateCurrent
    ? researchCurrentRequestControllerRef.current
    : researchBranchRequestControllerRef.current;
  const scope = updateCurrent ? "current" : normalizedPath;
  if (!updateCurrent && !options.expand && !researchExpandedFoldersRef.current[normalizedPath]?.expanded) {
    return [];
  }
  const request = controller.begin(scope);
  if (updateCurrent) {
    setResearchTreeLoading(true);
    setResearchTreeError("");
  } else if (normalizedPath) {
    setResearchExpandedFolders((previous) => {
      const next = {
        ...previous,
        [normalizedPath]: {
          ...(previous[normalizedPath] || {}),
          expanded: options.expand === true ? true : Boolean(previous[normalizedPath]?.expanded),
          loading: true,
          error: "",
        },
      };
      researchExpandedFoldersRef.current = next;
      return next;
    });
  }
  try {
    const result = await researchBridge.listResearchFolder?.(libraryId, normalizedPath);
    const entries = normalizeResearchTreeEntries(result?.entries);
    if (
      !controller.isCurrent(request)
      || researchRootRef.current?.libraryId !== libraryId
    ) return entries;
    if (updateCurrent) {
      if (researchCurrentRelativePathRef.current !== normalizedPath) return entries;
      setResearchEntries(entries);
    } else if (normalizedPath) {
      setResearchExpandedFolders((previous) => {
        if (!previous[normalizedPath]?.expanded) return previous;
        const next = {
          ...previous,
          [normalizedPath]: { ...previous[normalizedPath], loading: false, error: "", entries },
        };
        researchExpandedFoldersRef.current = next;
        return next;
      });
      if (researchExpandedFoldersRef.current[normalizedPath]?.expanded) {
        setResearchEntries((previous) => replaceResearchTreeFolder(previous, normalizedPath, entries));
      }
    }
    return entries;
  } catch (error) {
    if (
      !controller.isCurrent(request)
      || researchRootRef.current?.libraryId !== libraryId
    ) return [];
    const message = error?.message || "资料目录读取失败";
    if (updateCurrent && researchCurrentRelativePathRef.current === normalizedPath) setResearchTreeError(message);
    else if (normalizedPath) {
      setResearchExpandedFolders((previous) => {
        if (!previous[normalizedPath]?.expanded) return previous;
        const next = {
          ...previous,
          [normalizedPath]: { ...previous[normalizedPath], loading: false, error: message },
        };
        researchExpandedFoldersRef.current = next;
        return next;
      });
    }
    return [];
  } finally {
    if (
      controller.isCurrent(request)
      && updateCurrent
      && researchRootRef.current?.libraryId === libraryId
      && researchCurrentRelativePathRef.current === normalizedPath
    ) {
      setResearchTreeLoading(false);
    }
    controller.finish(request);
  }
}

export async function applyResearchRootCore(context, root) {
  const {
    hasOpenResearchViewsForLibrary,
    refreshIndependentResearchFolder,
    refreshResearchLibrarySources,
    refreshResearchWebTree,
    removeOpenResearchViews,
    researchBranchRequestControllerRef,
    researchBridge,
    researchCurrentRelativePathRef,
    researchCurrentRequestControllerRef,
    researchExpandedFoldersRef,
    researchRootRef,
    researchSourcesRequestControllerRef,
    researchWebRequestControllerRef,
    setActiveLibraryItem,
    setActiveResearchError,
    setLibrarySources,
    setLibrarySourcesReady,
    setResearchBusyKeys,
    setResearchCurrentRelativePath,
    setResearchEntries,
    setResearchExpandedFolders,
    setResearchRoot,
    setResearchTreeError,
    setResearchTreeLoading,
    setWebTreeReady,
    setWebTreeState,
  } = context;
  researchCurrentRequestControllerRef.current.invalidateAll();
  researchBranchRequestControllerRef.current.invalidateAll();
  researchSourcesRequestControllerRef.current.invalidateAll();
  researchWebRequestControllerRef.current.invalidateAll();
  const normalized = root && typeof root === "object" ? root : { configured: false, available: false };
  const previousLibraryId = String(researchRootRef.current?.libraryId || "");
  const nextLibraryId = normalized.available ? String(normalized.libraryId || "") : "";
  const libraryChanged = previousLibraryId !== nextLibraryId;
  const staleResearchPane = Boolean(
    previousLibraryId
    && previousLibraryId !== nextLibraryId
    && hasOpenResearchViewsForLibrary(previousLibraryId),
  );
  if (staleResearchPane) removeOpenResearchViews((view) => view.libraryId === previousLibraryId);
  researchRootRef.current = normalized;
  researchCurrentRelativePathRef.current = "";
  setResearchRoot(normalized);
  setResearchCurrentRelativePath("");
  setResearchEntries([]);
  researchExpandedFoldersRef.current = {};
  setResearchExpandedFolders({});
  setResearchTreeLoading(false);
  setResearchBusyKeys([]);
  setLibrarySources([]);
  setLibrarySourcesReady(false);
  setWebTreeState(createEmptyResearchWebTree());
  setWebTreeReady(false);
  if (libraryChanged || !nextLibraryId || staleResearchPane) {
    setActiveLibraryItem(null);
    setActiveResearchError("");
  }
  setResearchTreeError(normalized?.error || "");
  if (!normalized.available || !normalized.libraryId) return normalized;
  await Promise.all([
    refreshIndependentResearchFolder("", normalized.libraryId, { current: true }),
    refreshResearchLibrarySources(normalized.libraryId),
    refreshResearchWebTree(normalized.libraryId),
    researchBridge.watchResearchLibrary?.(normalized.libraryId).catch?.(() => null),
  ]);
  return normalized;
}

export function useResearchRefreshActions({
  hasOpenResearchViewsForLibrary,
  removeOpenResearchViews,
  researchBridge = bridge,
  researchState,
  requestControllerRefs,
  showStatus,
}) {
  const context = {
    ...researchState,
    ...requestControllerRefs,
    researchBridge,
    showStatus,
  };

  const refreshResearchLibrarySources = useCallback(async (
    libraryId = researchState.researchRootRef.current?.libraryId,
  ) => refreshResearchLibrarySourcesCore(context, libraryId), [showStatus]);

  const refreshResearchWebTree = useCallback(async (
    libraryId = researchState.researchRootRef.current?.libraryId,
  ) => refreshResearchWebTreeCore(context, libraryId), [showStatus]);

  const refreshIndependentResearchFolder = useCallback(async (
    relativePath = "",
    libraryId = researchState.researchRootRef.current?.libraryId,
    options = {},
  ) => refreshIndependentResearchFolderCore(context, relativePath, libraryId, options), []);

  const applyResearchRoot = useCallback(async (root) => applyResearchRootCore({
    ...context,
    hasOpenResearchViewsForLibrary,
    refreshIndependentResearchFolder,
    refreshResearchLibrarySources,
    refreshResearchWebTree,
    removeOpenResearchViews,
  }, root), [
    hasOpenResearchViewsForLibrary,
    refreshIndependentResearchFolder,
    refreshResearchLibrarySources,
    refreshResearchWebTree,
    removeOpenResearchViews,
  ]);

  const refreshResearchRoot = useCallback(async () => {
    try {
      return await applyResearchRoot(await researchBridge.getResearchRoot?.());
    } catch (error) {
      researchState.setResearchTreeError(error?.message || "资料目录配置读取失败");
      return null;
    }
  }, [applyResearchRoot]);

  return {
    applyResearchRoot,
    refreshIndependentResearchFolder,
    refreshResearchLibrarySources,
    refreshResearchRoot,
    refreshResearchWebTree,
  };
}
