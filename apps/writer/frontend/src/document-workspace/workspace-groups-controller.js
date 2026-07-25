import { getLetterTemplate } from "../templates/model.js";
import { researchPreviewKind } from "../research-ui-model.js";
import { sameDocumentPath } from "../editor-lifecycle.js";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  closeWorkspaceView,
  createDocumentWorkspaceView,
  findWorkspaceView,
  getActiveWorkspaceView,
  moveWorkspaceDocument,
  normalizeWorkspaceGroupsState,
  openWorkspaceDocument,
  openWorkspaceResearch,
  removeWorkspaceViews,
  reorderWorkspaceView,
  selectWorkspaceView,
  updateWorkspaceResearchTarget,
  updateWorkspaceResearchViewState,
} from "../workspace-groups.js";
import {
  createDocumentTab,
  normalizeDocument,
  workspaceDocumentView,
} from "./model.js";

function resolveResearchType(item, view) {
  const inferredType = item?.type === "web"
    ? "web"
    : researchPreviewKind(item || {
      type: "file",
      relativePath: view.relativePath,
    });
  return inferredType === "unsupported"
    ? (view.researchType || "file")
    : inferredType;
}

function researchMetaLabel(researchType, viewState) {
  if (researchType === "pdf") {
    return `PDF · ${Number(viewState?.page) || 1}`;
  }
  return {
    web: "网页",
    docx: "DOCX",
    markdown: "Markdown",
    text: "文本",
    table: "表格",
    image: "图片",
  }[researchType] || "资料";
}

export function deriveWorkspaceGroupItems({
  activeDocument,
  activeSecondaryView,
  activeTabId,
  activeResearchItem,
  groupId,
  letterTemplates,
  librarySources = [],
  openTabs = [],
  researchItemsByViewId = {},
  views = [],
} = {}) {
  if (groupId === WORKSPACE_GROUP_ID.PRIMARY) {
    return views.map((view) => {
      const tab = openTabs.find((candidate) => candidate.id === view.tabId);
      const tabDocument = tab?.id === activeTabId
        ? activeDocument
        : tab?.document;
      return tab ? {
        viewId: view.viewId,
        tabId: tab.id,
        kind: WORKSPACE_VIEW_KIND.DOCUMENT,
        title: tab.title,
        path: tab.path,
        dirty: tab.dirty,
        letterTemplateId: getLetterTemplate(tabDocument, letterTemplates).id,
      } : null;
    }).filter(Boolean);
  }

  return views.map((view) => {
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      const tab = openTabs.find((candidate) => candidate.id === view.tabId);
      return tab ? {
        viewId: view.viewId,
        tabId: tab.id,
        kind: WORKSPACE_VIEW_KIND.DOCUMENT,
        title: tab.title,
        path: tab.path,
        dirty: tab.dirty,
        letterTemplateId: getLetterTemplate(tab.document, letterTemplates).id,
      } : null;
    }
    const item = researchItemsByViewId[view.viewId]
      || (view.sourceId
        ? librarySources.find((source) => source.id === view.sourceId)
        : null)
      || (activeSecondaryView?.viewId === view.viewId
        ? activeResearchItem
        : null);
    const title = item?.title
      || item?.name
      || item?.fileName
      || view.titleSnapshot
      || view.relativePath
      || "未命名资料";
    const researchType = resolveResearchType(item, view);
    return {
      viewId: view.viewId,
      kind: WORKSPACE_VIEW_KIND.RESEARCH,
      researchType,
      title,
      path: view.relativePath || "",
      metaLabel: researchMetaLabel(researchType, view.viewState),
    };
  }).filter(Boolean);
}

export function reconcileWorkspaceGroupsWithTabs(
  previous,
  openTabs = [],
) {
  if (!openTabs.length) return previous;
  const tabById = new Map(openTabs.map((tab) => [tab.id, tab]));
  const refreshViews = (views, allowResearch) => (
    (views || []).flatMap((view) => {
      if (view.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
        return allowResearch ? [view] : [];
      }
      const tab = tabById.get(view.tabId);
      return tab
        ? [createDocumentWorkspaceView(workspaceDocumentView(tab))]
        : [];
    })
  );
  let primaryViews = refreshViews(previous.primary.views, false);
  let secondaryViews = refreshViews(previous.secondary.views, true);
  const assignedTabIds = new Set(
    [...primaryViews, ...secondaryViews]
      .filter((view) => view.kind === WORKSPACE_VIEW_KIND.DOCUMENT)
      .map((view) => view.tabId),
  );
  for (const tab of openTabs) {
    if (!assignedTabIds.has(tab.id)) {
      primaryViews.push(
        createDocumentWorkspaceView(workspaceDocumentView(tab)),
      );
      assignedTabIds.add(tab.id);
    }
  }
  if (!primaryViews.length) {
    const firstSecondaryDocumentIndex = secondaryViews.findIndex(
      (view) => view.kind === WORKSPACE_VIEW_KIND.DOCUMENT,
    );
    if (firstSecondaryDocumentIndex >= 0) {
      primaryViews = [secondaryViews[firstSecondaryDocumentIndex]];
      secondaryViews = secondaryViews.filter(
        (_, index) => index !== firstSecondaryDocumentIndex,
      );
    } else {
      primaryViews = [
        createDocumentWorkspaceView(workspaceDocumentView(openTabs[0])),
      ];
    }
  }
  const candidate = normalizeWorkspaceGroupsState({
    ...previous,
    primary: {
      views: primaryViews,
      activeViewId: previous.primary.activeViewId,
    },
    secondary: {
      views: secondaryViews,
      activeViewId: previous.secondary.activeViewId,
    },
  }, {
    fallbackPrimaryDocument: workspaceDocumentView(openTabs[0]),
  });
  return JSON.stringify(candidate) === JSON.stringify(previous)
    ? previous
    : candidate;
}

function requireFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
  return value;
}

export function createWorkspaceGroupsController({
  documentStorePort,
  groupStorePort,
  letterTemplates,
  now = Date.now,
  researchResolver = {},
  statusPort = {},
} = {}) {
  const readDocuments = documentStorePort?.read;
  const commitActiveTabId = documentStorePort?.commitActiveTabId;
  const commitOpenTabs = documentStorePort?.commitOpenTabs;
  const readGroups = requireFunction(
    groupStorePort?.read,
    "groupStorePort.read",
  );
  const commitActivePane = requireFunction(
    groupStorePort?.commitActivePane,
    "groupStorePort.commitActivePane",
  );
  const commitWorkspaceGroups = requireFunction(
    groupStorePort?.commitWorkspaceGroups,
    "groupStorePort.commitWorkspaceGroups",
  );
  const showStatus = typeof statusPort.show === "function"
    ? statusPort.show
    : () => {};

  const snapshotAndCommitTabs = (snapshotTabs) => {
    const snapshot = requireFunction(
      snapshotTabs,
      "snapshotTabs",
    )({ includeEditorJson: true });
    requireFunction(
      commitOpenTabs,
      "documentStorePort.commitOpenTabs",
    )(snapshot);
    return snapshot;
  };

  const commitActiveDocumentTab = (tab) => {
    requireFunction(
      commitActiveTabId,
      "documentStorePort.commitActiveTabId",
    )(tab.id);
  };

  const applyTabDocument = (tab, applyDocument) => {
    requireFunction(
      applyDocument,
      "applyDocument",
    )(
      tab.document,
      tab.path,
      tab.dirty,
      {
        editorJson: tab.editorJson,
        scrollState: tab.scrollState,
      },
    );
  };

  const resolveResearchItem = (view) => (
    researchResolver.resolveItem?.(view) || null
  );

  const focusAfterResearchRemoval = (nextGroups, {
    clearErrorWhenEmpty = false,
    focusRightWhenPresent = false,
  } = {}) => {
    const active = getActiveWorkspaceView(
      nextGroups,
      WORKSPACE_GROUP_ID.SECONDARY,
    );
    if (!active) {
      researchResolver.setActiveItem?.(null);
      if (clearErrorWhenEmpty) {
        researchResolver.clearError?.();
      }
      commitActivePane("main");
      return;
    }
    if (active.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
      researchResolver.setActiveItem?.(resolveResearchItem(active));
    }
    if (focusRightWhenPresent) {
      commitActivePane("right");
    }
  };

  const reconcileTabs = (tabs) => {
    if (!tabs?.length) return;
    commitWorkspaceGroups((previous) => (
      reconcileWorkspaceGroupsWithTabs(previous, tabs)
    ));
  };

  const reorderGroupView = (
    groupId,
    viewId,
    beforeViewId,
  ) => {
    const state = readGroups().groups;
    const views = state[groupId]?.views || [];
    const fromIndex = views.findIndex((view) => view.viewId === viewId);
    if (fromIndex < 0) return;
    let toIndex = beforeViewId
      ? views.findIndex((view) => view.viewId === beforeViewId)
      : views.length - 1;
    if (toIndex < 0) toIndex = views.length - 1;
    if (beforeViewId && fromIndex < toIndex) toIndex -= 1;
    commitWorkspaceGroups(
      reorderWorkspaceView(state, groupId, viewId, toIndex),
    );
  };

  const selectTab = (
    tabId,
    { applyDocument, snapshotTabs } = {},
  ) => {
    const documentState = requireFunction(
      readDocuments,
      "documentStorePort.read",
    )();
    const snapshot = requireFunction(
      snapshotTabs,
      "snapshotTabs",
    )({ includeEditorJson: true });
    const target = snapshot.find((tab) => tab.id === tabId);
    if (!target) return;
    requireFunction(
      commitOpenTabs,
      "documentStorePort.commitOpenTabs",
    )(snapshot);
    const state = readGroups().groups;
    const location = findWorkspaceView(state, target.id);
    if (location?.groupId === WORKSPACE_GROUP_ID.SECONDARY) {
      commitWorkspaceGroups(selectWorkspaceView(
        state,
        WORKSPACE_GROUP_ID.SECONDARY,
        location.view.viewId,
      ));
      commitActivePane("right");
      return;
    }
    const nextGroups = location
      ? selectWorkspaceView(
        state,
        WORKSPACE_GROUP_ID.PRIMARY,
        location.view.viewId,
      )
      : openWorkspaceDocument(
        state,
        WORKSPACE_GROUP_ID.PRIMARY,
        workspaceDocumentView(target),
      );
    commitWorkspaceGroups(nextGroups);
    commitActiveDocumentTab(target);
    commitActivePane("main");
    if (target.id !== documentState.activeTabId) {
      applyTabDocument(target, applyDocument);
    }
  };

  const selectGroupView = (
    groupId,
    viewId,
    paneOperations = {},
  ) => {
    const state = readGroups().groups;
    const group = state[groupId];
    const view = group?.views?.find(
      (candidate) => candidate.viewId === viewId,
    );
    if (!view) return;
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      selectTab(view.tabId, paneOperations);
      return;
    }
    snapshotAndCommitTabs(
      paneOperations.snapshotTabs,
    );
    const next = selectWorkspaceView(
      state,
      WORKSPACE_GROUP_ID.SECONDARY,
      viewId,
    );
    commitWorkspaceGroups(next);
    commitActivePane("right");
    researchResolver.setActiveItem?.(resolveResearchItem(view));
    researchResolver.clearError?.();
  };

  const moveGroupDocument = (
    viewId,
    targetGroupId,
    beforeViewId = null,
    { applyDocument, snapshotTabs } = {},
  ) => {
    const state = readGroups().groups;
    const location = findWorkspaceView(state, viewId);
    if (
      !location
      || location.view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT
    ) {
      return;
    }
    if (location.groupId === targetGroupId) {
      reorderGroupView(targetGroupId, viewId, beforeViewId);
      return;
    }
    if (
      location.groupId === WORKSPACE_GROUP_ID.PRIMARY
      && state.primary.views.length <= 1
    ) {
      showStatus("左侧编辑组至少需要保留一个信笺", "warning");
      return;
    }
    const targetViews = state[targetGroupId]?.views || [];
    let insertionIndex = beforeViewId
      ? targetViews.findIndex((view) => view.viewId === beforeViewId)
      : targetViews.length;
    if (insertionIndex < 0) insertionIndex = targetViews.length;
    const snapshot = snapshotAndCommitTabs(snapshotTabs);
    const next = moveWorkspaceDocument(
      state,
      location.view.viewId,
      targetGroupId,
      insertionIndex,
    );
    if (next === state) return;
    commitWorkspaceGroups(next);
    if (targetGroupId === WORKSPACE_GROUP_ID.PRIMARY) {
      const tab = snapshot.find(
        (candidate) => candidate.id === location.view.tabId,
      );
      if (tab) {
        commitActiveDocumentTab(tab);
        applyTabDocument(tab, applyDocument);
      }
      commitActivePane("main");
      return;
    }
    const activeTabId = requireFunction(
      readDocuments,
      "documentStorePort.read",
    )().activeTabId;
    if (location.view.tabId === activeTabId) {
      const nextPrimary = getActiveWorkspaceView(
        next,
        WORKSPACE_GROUP_ID.PRIMARY,
      );
      const primaryTab = snapshot.find(
        (candidate) => candidate.id === nextPrimary?.tabId,
      );
      if (primaryTab) {
        commitActiveDocumentTab(primaryTab);
        applyTabDocument(primaryTab, applyDocument);
      }
    }
    commitActivePane("right");
  };

  const toggleRightSplit = (
    tabId,
    { applyDocument, snapshotTabs } = {},
  ) => {
    const state = readGroups().groups;
    const location = findWorkspaceView(state, tabId);
    if (
      !location
      || location.view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT
    ) {
      return;
    }
    const targetGroup = location.groupId === WORKSPACE_GROUP_ID.PRIMARY
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY;
    if (
      location.groupId === WORKSPACE_GROUP_ID.PRIMARY
      && state.primary.views.length <= 1
    ) {
      showStatus("左侧编辑组至少需要保留一个信笺", "warning");
      return;
    }
    const activeTabId = requireFunction(
      readDocuments,
      "documentStorePort.read",
    )().activeTabId;
    const snapshot = snapshotAndCommitTabs(snapshotTabs);
    const next = moveWorkspaceDocument(
      state,
      location.view.viewId,
      targetGroup,
      state[targetGroup].views.length,
    );
    if (next === state) return;
    commitWorkspaceGroups(next);
    if (targetGroup === WORKSPACE_GROUP_ID.PRIMARY) {
      const target = snapshot.find((tab) => tab.id === tabId);
      if (target) {
        commitActiveDocumentTab(target);
        applyTabDocument(target, applyDocument);
      }
      commitActivePane("main");
    } else {
      const nextPrimary = getActiveWorkspaceView(
        next,
        WORKSPACE_GROUP_ID.PRIMARY,
      );
      const primaryTab = snapshot.find(
        (tab) => tab.id === nextPrimary?.tabId,
      );
      if (primaryTab && tabId === activeTabId) {
        commitActiveDocumentTab(primaryTab);
        applyTabDocument(primaryTab, applyDocument);
      }
      commitActivePane("right");
    }
    showStatus(
      targetGroup === WORKSPACE_GROUP_ID.SECONDARY
        ? "已移到右侧编辑组"
        : "已移到左侧编辑组",
      "success",
    );
  };

  const addOrActivateDocumentTab = (
    nextDocument,
    nextPath = "",
    nextDirty = false,
    options = {},
    {
      applyDocument,
      initializeTabRuntime,
      snapshotTabs,
    } = {},
  ) => {
    const currentDocuments = requireFunction(
      readDocuments,
      "documentStorePort.read",
    )();
    const normalized = normalizeDocument(
      nextDocument,
      letterTemplates,
    );
    const snapshot = requireFunction(
      snapshotTabs,
      "snapshotTabs",
    )({ includeEditorJson: true });
    const existingTab = nextPath
      ? snapshot.find((tab) => sameDocumentPath(tab.path, nextPath))
      : null;
    if (existingTab) {
      requireFunction(
        commitOpenTabs,
        "documentStorePort.commitOpenTabs",
      )(snapshot);
      const state = readGroups().groups;
      const location = findWorkspaceView(state, existingTab.id);
      if (location?.groupId === WORKSPACE_GROUP_ID.SECONDARY) {
        commitWorkspaceGroups(selectWorkspaceView(
          state,
          WORKSPACE_GROUP_ID.SECONDARY,
          location.view.viewId,
        ));
        commitActivePane("right");
      } else {
        const nextGroups = location
          ? selectWorkspaceView(
            state,
            WORKSPACE_GROUP_ID.PRIMARY,
            location.view.viewId,
          )
          : openWorkspaceDocument(
            state,
            WORKSPACE_GROUP_ID.PRIMARY,
            workspaceDocumentView(existingTab),
          );
        commitWorkspaceGroups(nextGroups);
        commitActiveDocumentTab(existingTab);
        commitActivePane("main");
        if (existingTab.id !== currentDocuments.activeTabId) {
          applyTabDocument(existingTab, applyDocument);
        }
      }
      return existingTab.id;
    }
    const groupState = readGroups();
    const requestedGroup = (
      options.groupId === WORKSPACE_GROUP_ID.SECONDARY
      || (
        !options.groupId
        && groupState.activePane === "right"
        && groupState.groups.secondary.views.length
      )
    )
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY;
    const onlyTab = snapshot.length === 1 ? snapshot[0] : null;
    const canReplaceBlank = (
      requestedGroup === WORKSPACE_GROUP_ID.PRIMARY
      && (nextPath || options.replaceBlank)
      && onlyTab
      && !onlyTab.path
      && !onlyTab.dirty
      && !currentDocuments.currentPath
      && !currentDocuments.dirty
    );
    const tab = createDocumentTab(
      normalized,
      nextPath,
      nextDirty,
      options,
    );
    requireFunction(
      initializeTabRuntime,
      "initializeTabRuntime",
    )(tab.id, {
      dirty: nextDirty,
      diskRevision: options.diskRevision,
      lastEditAt: nextDirty ? now() : null,
      liveUpdatedAt: normalized.updatedAt,
      recoveryRevision: tab.recoveryRevision,
    });
    const nextTabs = canReplaceBlank
      ? [tab]
      : [...snapshot, tab];
    requireFunction(
      commitOpenTabs,
      "documentStorePort.commitOpenTabs",
    )(nextTabs);
    let nextGroups;
    if (canReplaceBlank) {
      const view = createDocumentWorkspaceView(
        workspaceDocumentView(tab),
      );
      nextGroups = {
        ...groupState.groups,
        primary: {
          views: [view],
          activeViewId: view.viewId,
        },
        focusedGroup: WORKSPACE_GROUP_ID.PRIMARY,
      };
    } else {
      nextGroups = openWorkspaceDocument(
        groupState.groups,
        requestedGroup,
        workspaceDocumentView(tab),
      );
    }
    commitWorkspaceGroups(nextGroups);
    if (requestedGroup === WORKSPACE_GROUP_ID.PRIMARY) {
      commitActiveDocumentTab(tab);
      commitActivePane("main");
      requireFunction(
        applyDocument,
        "applyDocument",
      )(
        normalized,
        nextPath,
        nextDirty,
        { scrollState: tab.scrollState },
      );
    } else {
      commitActivePane("right");
    }
    return tab.id;
  };

  const closeGroupView = async (
    groupId,
    viewId,
    { closeDocumentTab } = {},
  ) => {
    const state = readGroups().groups;
    const view = state[groupId]?.views?.find(
      (candidate) => candidate.viewId === viewId,
    );
    if (!view) return;
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      await requireFunction(
        closeDocumentTab,
        "closeDocumentTab",
      )(view.tabId);
      return;
    }
    void researchResolver.destroyView?.(viewId);
    const next = closeWorkspaceView(state, groupId, viewId);
    commitWorkspaceGroups(next);
    researchResolver.removeItems?.([viewId]);
    focusAfterResearchRemoval(next, {
      clearErrorWhenEmpty: true,
      focusRightWhenPresent: true,
    });
  };

  const updateOpenResearchTargets = (
    libraryId,
    previousPath,
    nextPath,
    itemPatch = {},
  ) => {
    const state = readGroups().groups;
    let nextGroups = state;
    const changedViewIds = [];
    for (const view of nextGroups.secondary.views) {
      if (
        view.kind !== WORKSPACE_VIEW_KIND.RESEARCH
        || view.libraryId !== libraryId
        || !view.relativePath
      ) {
        continue;
      }
      if (
        view.relativePath !== previousPath
        && !view.relativePath.startsWith(`${previousPath}/`)
      ) {
        continue;
      }
      const suffix = view.relativePath.slice(previousPath.length);
      nextGroups = updateWorkspaceResearchTarget(
        nextGroups,
        view.viewId,
        {
          libraryId,
          relativePath: `${nextPath}${suffix}`,
        },
      );
      changedViewIds.push(view.viewId);
    }
    if (nextGroups !== state) {
      commitWorkspaceGroups(nextGroups);
    }
    if (changedViewIds.length) {
      researchResolver.renameItems?.(changedViewIds, {
        itemPatch,
        nextPath,
        previousPath,
      });
    }
  };

  const removeOpenResearchViews = (selector) => {
    const state = readGroups().groups;
    const removedIds = state.secondary.views.filter((view) => (
      view.kind === WORKSPACE_VIEW_KIND.RESEARCH && selector(view)
    )).map((view) => view.viewId);
    if (!removedIds.length) return;
    removedIds.forEach((viewId) => {
      void researchResolver.destroyView?.(viewId);
    });
    const next = removeWorkspaceViews(state, new Set(removedIds));
    commitWorkspaceGroups(next);
    researchResolver.removeItems?.(removedIds);
    focusAfterResearchRemoval(next);
  };

  const openResearchPreviewView = (
    {
      item,
      researchType,
      target,
      titleSnapshot,
    },
    { snapshotTabs } = {},
  ) => {
    if (readGroups().rightSplitTabId) {
      const snapshot = requireFunction(
        snapshotTabs,
        "snapshotTabs",
      )({ includeEditorJson: true });
      requireFunction(
        commitOpenTabs,
        "documentStorePort.commitOpenTabs",
      )(snapshot);
    }
    const nextGroups = openWorkspaceResearch(readGroups().groups, {
      ...target,
      titleSnapshot,
      researchType,
    });
    const activeView = getActiveWorkspaceView(
      nextGroups,
      WORKSPACE_GROUP_ID.SECONDARY,
    );
    commitWorkspaceGroups(nextGroups);
    if (activeView) {
      researchResolver.commitItem?.(activeView.viewId, item);
    }
    commitActivePane("right");
    researchResolver.setActiveItem?.(item);
    researchResolver.clearError?.();
    return activeView?.viewId || "";
  };

  const closeActiveResearchView = () => {
    const active = getActiveWorkspaceView(
      readGroups().groups,
      WORKSPACE_GROUP_ID.SECONDARY,
    );
    if (active?.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
      void closeGroupView(
        WORKSPACE_GROUP_ID.SECONDARY,
        active.viewId,
      );
    }
  };

  const updateResearchViewState = (viewId, viewState) => {
    const active = getActiveWorkspaceView(
      readGroups().groups,
      WORKSPACE_GROUP_ID.SECONDARY,
    );
    if (
      active?.kind !== WORKSPACE_VIEW_KIND.RESEARCH
      || active.viewId !== viewId
    ) {
      return;
    }
    const current = readGroups().groups;
    const next = updateWorkspaceResearchViewState(
      current,
      active.viewId,
      viewState,
    );
    if (next !== current) {
      commitWorkspaceGroups(next);
    }
  };

  const researchViewsPort = Object.freeze({
    closeActiveResearchView,
    getOpenResearchViews: () => readGroups().groups.secondary.views,
    hasOpenResearchViewsForLibrary: (libraryId) => (
      readGroups().groups.secondary.views.some((view) => (
        view.kind === WORKSPACE_VIEW_KIND.RESEARCH
        && view.libraryId === libraryId
      ))
    ),
    openResearchPreviewView,
    removeOpenResearchViews,
    updateOpenResearchTargets,
  });

  return Object.freeze({
    addOrActivateDocumentTab,
    closeGroupView,
    moveGroupDocument,
    reconcileTabs,
    reorderGroupView,
    researchViewsPort,
    selectGroupView,
    selectTab,
    toggleRightSplit,
    updateResearchViewState,
  });
}
