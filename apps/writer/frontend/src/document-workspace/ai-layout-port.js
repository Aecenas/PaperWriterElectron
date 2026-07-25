import { useMemo } from "react";
import {
  WORKSPACE_GROUP_ID,
  getActiveWorkspaceView,
} from "../workspace-groups.js";

export function createAiLayoutPort({
  activeTabIdRef,
  aiPreviousSidebarsRef,
  aiSecondaryPaneLayoutRef,
  applyDocument,
  commitWorkspaceGroups,
  immersiveSecondaryPaneLayoutRef,
  openTabsRef,
  previousImmersiveModeRef,
  setActivePane,
  setActiveTabId,
  setLeftSidebarCollapsed,
  setOpenTabs,
  snapshotLiveTabs,
  workspaceGroupsRef,
}) {
  const snapshotCurrentTabs = () => {
    const snapshot = snapshotLiveTabs({ includeEditorJson: true });
    openTabsRef.current = snapshot;
    setOpenTabs(snapshot);
    return snapshot;
  };

  const currentLayoutSnapshot = (activePane) => ({
    workspaceGroups: workspaceGroupsRef.current,
    activePane,
  });

  const restoreLayout = (savedLayout) => {
    const snapshot = snapshotCurrentTabs();
    commitWorkspaceGroups(savedLayout.workspaceGroups);
    const primaryView = getActiveWorkspaceView(
      savedLayout.workspaceGroups,
      WORKSPACE_GROUP_ID.PRIMARY,
    );
    const primaryTab = snapshot.find(
      (tab) => tab.id === primaryView?.tabId,
    );
    if (primaryTab && primaryTab.id !== activeTabIdRef.current) {
      activeTabIdRef.current = primaryTab.id;
      setActiveTabId(primaryTab.id);
      applyDocument(
        primaryTab.document,
        primaryTab.path,
        primaryTab.dirty,
        {
          editorJson: primaryTab.editorJson,
          scrollState: primaryTab.scrollState,
        },
      );
    }
    setActivePane(
      savedLayout.activePane === "right"
        && savedLayout.workspaceGroups.secondary.views.length
        ? "right"
        : "main",
    );
  };

  const enterAiLayout = ({
    activePane,
    immersiveMode,
    leftSidebarCollapsed,
  }) => {
    aiPreviousSidebarsRef.current = {
      left: leftSidebarCollapsed,
    };
    snapshotCurrentTabs();
    aiSecondaryPaneLayoutRef.current = immersiveMode
      && immersiveSecondaryPaneLayoutRef.current
      ? immersiveSecondaryPaneLayoutRef.current
      : currentLayoutSnapshot(activePane);
    setActivePane("main");
    setLeftSidebarCollapsed(true);
  };

  const exitAiLayout = ({ immersiveMode }) => {
    if (aiPreviousSidebarsRef.current) {
      setLeftSidebarCollapsed(aiPreviousSidebarsRef.current.left);
      aiPreviousSidebarsRef.current = null;
    }
    const savedLayout = aiSecondaryPaneLayoutRef.current;
    aiSecondaryPaneLayoutRef.current = null;
    if (savedLayout && immersiveMode) {
      immersiveSecondaryPaneLayoutRef.current = savedLayout;
    } else if (savedLayout) {
      restoreLayout(savedLayout);
    }
  };

  const transitionImmersiveLayout = ({
    activePane,
    aiMode,
    immersiveMode,
  }) => {
    const wasImmersive = previousImmersiveModeRef.current;
    previousImmersiveModeRef.current = immersiveMode;
    if (immersiveMode && !wasImmersive) {
      snapshotCurrentTabs();
      immersiveSecondaryPaneLayoutRef.current = aiMode
        && aiSecondaryPaneLayoutRef.current
        ? aiSecondaryPaneLayoutRef.current
        : currentLayoutSnapshot(activePane);
      setActivePane("main");
      return;
    }
    if (!immersiveMode && wasImmersive) {
      const savedLayout = immersiveSecondaryPaneLayoutRef.current;
      immersiveSecondaryPaneLayoutRef.current = null;
      if (!savedLayout) return;
      if (aiMode) {
        aiSecondaryPaneLayoutRef.current = savedLayout;
        return;
      }
      restoreLayout(savedLayout);
    }
  };

  return {
    enterAiLayout,
    exitAiLayout,
    transitionImmersiveLayout,
  };
}

export function useAiLayoutPort(options) {
  return useMemo(
    () => createAiLayoutPort(options),
    [
      options.activeTabIdRef,
      options.aiPreviousSidebarsRef,
      options.aiSecondaryPaneLayoutRef,
      options.applyDocument,
      options.commitWorkspaceGroups,
      options.immersiveSecondaryPaneLayoutRef,
      options.openTabsRef,
      options.previousImmersiveModeRef,
      options.setActivePane,
      options.setActiveTabId,
      options.setLeftSidebarCollapsed,
      options.setOpenTabs,
      options.snapshotLiveTabs,
      options.workspaceGroupsRef,
    ],
  );
}
