import { useEffect, useMemo } from "react";
import { bridge } from "../bridge.js";
import { displayNameFromPath } from "../app-shell/path-display.js";
import { safeStorageSetItem } from "../safe-storage.js";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  getActiveWorkspaceView,
} from "../workspace-groups.js";

export function useWritingWorkspaceIdentityLifecycle({
  researchBridge = bridge,
  setWritingWorkspaceIdentity,
  writingWorkspaceRoot,
}) {
  useEffect(() => {
    let canceled = false;
    if (!writingWorkspaceRoot) {
      setWritingWorkspaceIdentity(null);
      return undefined;
    }
    setWritingWorkspaceIdentity(null);
    void researchBridge.getWorkspaceIdentity?.(writingWorkspaceRoot).then((identity) => {
      if (canceled || !identity?.workspaceId) return;
      setWritingWorkspaceIdentity({
        workspaceId: String(identity.workspaceId),
        workspaceName: String(identity.workspaceName || displayNameFromPath(writingWorkspaceRoot) || "当前工作区"),
      });
    }).catch(() => {});
    return () => { canceled = true; };
  }, [writingWorkspaceRoot]);
}

export function useResearchWebScopePreferenceLifecycle(webWorkspaceMode) {
  useEffect(() => {
    safeStorageSetItem("paperwriter.research.web-scope-mode", webWorkspaceMode);
  }, [webWorkspaceMode]);
}

export function useResearchMountLifecycle(refreshResearchRoot) {
  useEffect(() => {
    void refreshResearchRoot();
  }, [refreshResearchRoot]);
}

export function useResearchViewReconciliationLifecycle({
  librarySources,
  librarySourcesReady,
  removeOpenResearchViews,
  researchItemsByViewId,
  researchRoot,
  setActiveLibraryItem,
  setResearchItemsByViewId,
  webScopeKey,
  webTreeReady,
  webTreeState,
  webWorkspaceIdentityPending,
  workspaceGroups,
}) {
  useEffect(() => {
    if (!researchRoot || typeof researchRoot !== "object") return;
    const libraryId = researchRoot.available ? String(researchRoot.libraryId || "") : "";
    const incompatible = workspaceGroups.secondary.views.filter((view) => (
      view.kind === WORKSPACE_VIEW_KIND.RESEARCH && (!libraryId || view.libraryId !== libraryId)
    ));
    if (incompatible.length) {
      removeOpenResearchViews((view) => !libraryId || view.libraryId !== libraryId);
      return;
    }
    if (librarySourcesReady && webTreeReady) {
      const availableSourceIds = new Set(librarySources.filter((source) => {
        if (source.type !== "web") return true;
        if (webWorkspaceIdentityPending) return true;
        return (webTreeState.placements[source.id]?.scopeKey || "global") === webScopeKey;
      }).map((source) => source.id));
      const missingSources = workspaceGroups.secondary.views.filter((view) => (
        view.kind === WORKSPACE_VIEW_KIND.RESEARCH
        && view.libraryId === libraryId
        && view.sourceId
        && !availableSourceIds.has(view.sourceId)
      ));
      if (missingSources.length) {
        const missingIds = new Set(missingSources.map((view) => view.viewId));
        removeOpenResearchViews((view) => missingIds.has(view.viewId));
        return;
      }
    }
    const active = getActiveWorkspaceView(workspaceGroups, WORKSPACE_GROUP_ID.SECONDARY);
    if (active?.kind !== WORKSPACE_VIEW_KIND.RESEARCH || active.libraryId !== libraryId) return;
    const existing = researchItemsByViewId[active.viewId];
    const item = existing
      || (active.sourceId ? librarySources.find((source) => source.id === active.sourceId) : null)
      || (active.relativePath ? librarySources.find((source) => source.type === "file" && source.relativePath === active.relativePath) : null)
      || (active.relativePath ? {
          type: "file",
          relativePath: active.relativePath,
          name: displayNameFromPath(active.relativePath),
        } : null);
    if (!item) return;
    if (!existing) setResearchItemsByViewId((previous) => ({ ...previous, [active.viewId]: item }));
    setActiveLibraryItem((previous) => previous === item ? previous : item);
  }, [
    librarySources,
    librarySourcesReady,
    removeOpenResearchViews,
    researchItemsByViewId,
    researchRoot,
    webScopeKey,
    webTreeReady,
    webTreeState.placements,
    webWorkspaceIdentityPending,
    workspaceGroups,
  ]);
}

export function useOpenResearchTargetSignature(workspaceGroups) {
  return useMemo(() => JSON.stringify(workspaceGroups.secondary.views
    .filter((view) => view.kind === WORKSPACE_VIEW_KIND.RESEARCH)
    .map((view) => [view.viewId, view.libraryId, view.relativePath || "", view.sourceId || ""])), [workspaceGroups.secondary.views]);
}

export function useResearchOpenTargetValidationLifecycle({
  getOpenResearchViews,
  librarySources,
  openResearchTargetSignature,
  removeOpenResearchViews,
  researchBridge = bridge,
  researchRoot,
  researchRootRef,
}) {
  useEffect(() => {
    const libraryId = researchRoot?.available ? String(researchRoot.libraryId || "") : "";
    if (!libraryId) return undefined;
    const fileViews = getOpenResearchViews().filter((view) => (
      view.kind === WORKSPACE_VIEW_KIND.RESEARCH && view.libraryId === libraryId && view.relativePath
    ));
    if (!fileViews.length) return undefined;
    let canceled = false;
    const validate = async () => {
      const byParent = new Map();
      for (const view of fileViews) {
        const separator = view.relativePath.lastIndexOf("/");
        const parent = separator >= 0 ? view.relativePath.slice(0, separator) : "";
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent).push(view);
      }
      const missingViewIds = new Set();
      for (const [parent, views] of byParent) {
        try {
          const result = await researchBridge.listResearchFolder?.(libraryId, parent);
          if (
            canceled
            || !result
            || researchRootRef.current?.libraryId !== libraryId
          ) return;
          const present = new Set((result.entries || []).map((entry) => String(entry.relativePath || "").replace(/\\/g, "/")));
          for (const view of views) if (!present.has(view.relativePath)) missingViewIds.add(view.viewId);
        } catch {
          return;
        }
      }
      if (
        !canceled
        && researchRootRef.current?.libraryId === libraryId
        && missingViewIds.size
      ) {
        removeOpenResearchViews((view) => missingViewIds.has(view.viewId));
      }
    };
    void validate();
    return () => { canceled = true; };
  }, [
    librarySources,
    openResearchTargetSignature,
    removeOpenResearchViews,
    researchRoot?.available,
    researchRoot?.libraryId,
  ]);
}

export function useResearchWatcherLifecycle({
  refreshIndependentResearchFolder,
  refreshResearchLibrarySources,
  refreshResearchWebTree,
  researchBridge = bridge,
  researchCurrentRelativePathRef,
  researchRoot,
  researchRootRef,
  setResearchTreeError,
}) {
  useEffect(() => {
    if (!researchRoot?.libraryId) return undefined;
    let timer = 0;
    const refresh = (payload = {}) => {
      if (researchRootRef.current?.libraryId !== researchRoot.libraryId) return;
      if (payload.libraryId && payload.libraryId !== researchRoot.libraryId) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (researchRootRef.current?.libraryId !== researchRoot.libraryId) return;
        const currentBrowsePath = researchCurrentRelativePathRef.current;
        void refreshIndependentResearchFolder(currentBrowsePath, researchRoot.libraryId, { current: true });
        const changedPath = String(payload.relativePath || "").replace(/\\/g, "/");
        const separatorIndex = changedPath.lastIndexOf("/");
        const parentPath = separatorIndex >= 0 ? changedPath.slice(0, separatorIndex) : "";
        if (parentPath && parentPath !== currentBrowsePath) {
          void refreshIndependentResearchFolder(parentPath, researchRoot.libraryId, { current: false });
        }
        void refreshResearchLibrarySources(researchRoot.libraryId);
        void refreshResearchWebTree(researchRoot.libraryId);
      }, 120);
    };
    const showWatchError = (payload = {}) => {
      if (
        researchRootRef.current?.libraryId === researchRoot.libraryId
        && (!payload.libraryId || payload.libraryId === researchRoot.libraryId)
      ) {
        setResearchTreeError(payload.message || "资料目录监听失败，请手动刷新");
      }
    };
    const unsubscribeChanged = researchBridge.onResearchLibraryChanged?.(refresh);
    const unsubscribeError = researchBridge.onResearchLibraryWatchError?.(showWatchError);
    return () => {
      window.clearTimeout(timer);
      unsubscribeChanged?.();
      unsubscribeError?.();
    };
  }, [
    refreshIndependentResearchFolder,
    refreshResearchLibrarySources,
    refreshResearchWebTree,
    researchRoot?.libraryId,
  ]);
}
