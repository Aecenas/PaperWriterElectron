import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { safeStorageGetItem } from "../safe-storage.js";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  createWorkspaceGroupsState,
  getActiveWorkspaceView,
  moveWorkspaceDocument,
  normalizeWorkspaceSplitRatio,
  openWorkspaceDocument,
} from "../workspace-groups.js";
import {
  activeSecondaryDocumentTabId,
  createBlankDocument,
  createDocumentTab,
  workspaceDocumentView,
} from "./model.js";
import { loadSessionState, saveSessionState } from "./session-state.js";

const WORKSPACE_SPLIT_RATIO_STORAGE_KEY = "paperwriter.workspaceSplitRatio";
const DEFAULT_WORKSPACE_SPLIT_RATIO = 0.5;

function resolveUpdate(value, previous) {
  return typeof value === "function" ? value(previous) : value;
}

function readInitialWorkspaceSplitRatio() {
  return Number(safeStorageGetItem(WORKSPACE_SPLIT_RATIO_STORAGE_KEY))
    || DEFAULT_WORKSPACE_SPLIT_RATIO;
}

function updateRightSplitTabId(previous, value) {
  const activeSecondary = getActiveWorkspaceView(
    previous,
    WORKSPACE_GROUP_ID.SECONDARY,
  );
  const currentTabId = activeSecondary?.kind === WORKSPACE_VIEW_KIND.DOCUMENT
    ? activeSecondary.tabId
    : "";
  const nextTabId = resolveUpdate(value, currentTabId);
  if (nextTabId) {
    return openWorkspaceDocument(
      previous,
      WORKSPACE_GROUP_ID.SECONDARY,
      { tabId: nextTabId },
    );
  }
  if (activeSecondary?.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
    return moveWorkspaceDocument(
      previous,
      activeSecondary.viewId,
      WORKSPACE_GROUP_ID.PRIMARY,
      previous.primary.views.length,
    );
  }
  return previous;
}

function updateDocumentPaneRatio(previous, value) {
  return {
    ...previous,
    splitRatio: normalizeWorkspaceSplitRatio(
      resolveUpdate(value, previous.splitRatio),
    ),
  };
}

export function createDocumentWorkspaceInitialState({
  letterTemplates,
  loadSession = loadSessionState,
  newDocumentTemplateId,
  readWorkspaceSplitRatio = readInitialWorkspaceSplitRatio,
} = {}) {
  const initialSession = loadSession();
  const documentState = createBlankDocument(letterTemplates, newDocumentTemplateId);
  const tabDocument = createBlankDocument(letterTemplates, newDocumentTemplateId);
  const tab = createDocumentTab(tabDocument);
  const openTabs = [tab];
  const activeTabId = tab.id;
  const workspaceGroups = createWorkspaceGroupsState(
    workspaceDocumentView(tab),
    { splitRatio: Number(readWorkspaceSplitRatio()) || DEFAULT_WORKSPACE_SPLIT_RATIO },
  );
  return {
    activePane: "main",
    activeTabId,
    currentPath: "",
    dirty: false,
    documentState,
    initialSession,
    openTabs,
    rightSplitTabId: activeSecondaryDocumentTabId(workspaceGroups),
    workspaceGroups,
  };
}

export function createDocumentStorePort({
  activeTabIdRef,
  currentPathRef,
  dirtyRef,
  documentStateRef,
  openTabsRef,
  setActiveTabId,
  setCurrentPath,
  setDirty,
  setDocumentState,
  setOpenTabs,
}) {
  const commitDocumentState = (value) => {
    const next = resolveUpdate(value, documentStateRef.current);
    documentStateRef.current = next;
    setDocumentState(next);
    return next;
  };

  const commitCurrentPath = (value) => {
    const next = resolveUpdate(value, currentPathRef.current);
    currentPathRef.current = next;
    setCurrentPath(next);
    return next;
  };

  const commitDirty = (value) => {
    const next = resolveUpdate(value, dirtyRef.current);
    dirtyRef.current = next;
    setDirty(next);
    return next;
  };

  const commitOpenTabs = (value) => {
    const next = resolveUpdate(value, openTabsRef.current);
    openTabsRef.current = next;
    setOpenTabs(next);
    return next;
  };

  const commitActiveTabId = (value) => {
    const next = resolveUpdate(value, activeTabIdRef.current);
    activeTabIdRef.current = next;
    setActiveTabId(next);
    return next;
  };

  return Object.freeze({
    commitActiveTabId,
    commitCurrentPath,
    commitDirty,
    commitDocumentState,
    commitOpenTabs,
    read: () => ({
      activeTabId: activeTabIdRef.current,
      currentPath: currentPathRef.current,
      dirty: dirtyRef.current,
      document: documentStateRef.current,
      tabs: openTabsRef.current,
    }),
  });
}

export function createGroupStorePort({
  activePaneRef,
  rightSplitTabIdRef,
  setActivePane,
  setWorkspaceGroups,
  workspaceGroupsRef,
}) {
  const commitWorkspaceGroups = (value) => {
    const next = resolveUpdate(value, workspaceGroupsRef.current)
      || workspaceGroupsRef.current;
    workspaceGroupsRef.current = next;
    rightSplitTabIdRef.current = activeSecondaryDocumentTabId(next);
    setWorkspaceGroups(next);
    return next;
  };

  const commitRightSplitTabId = (value) => commitWorkspaceGroups(
    (previous) => updateRightSplitTabId(previous, value),
  );

  const commitDocumentPaneRatio = (value) => commitWorkspaceGroups(
    (previous) => updateDocumentPaneRatio(previous, value),
  );

  const commitActivePane = (value) => {
    const next = resolveUpdate(value, activePaneRef.current);
    activePaneRef.current = next;
    setActivePane(next);
    return next;
  };

  return Object.freeze({
    commitActivePane,
    commitDocumentPaneRatio,
    commitRightSplitTabId,
    commitWorkspaceGroups,
    read: () => ({
      activePane: activePaneRef.current,
      groups: workspaceGroupsRef.current,
      rightSplitTabId: rightSplitTabIdRef.current,
    }),
  });
}

export function createSessionStatePort({
  saveSession = saveSessionState,
  sessionClosePendingRef = { current: false },
  sessionRef,
  sessionRestoredRef,
}) {
  const commitSessionPatch = (patch) => {
    const resolvedPatch = resolveUpdate(patch, sessionRef.current);
    const next = {
      ...sessionRef.current,
      ...(resolvedPatch || {}),
    };
    sessionRef.current = next;
    saveSession(next);
    return next;
  };

  const isRestored = () => sessionRestoredRef.current;
  const markRestored = (value = true) => {
    sessionRestoredRef.current = Boolean(value);
    return sessionRestoredRef.current;
  };
  const commitSessionPatchWhenRestored = (patch) => (
    isRestored() ? commitSessionPatch(patch) : null
  );
  const isClosePending = () => sessionClosePendingRef.current;
  const beginClose = () => {
    if (sessionClosePendingRef.current) return false;
    sessionClosePendingRef.current = true;
    return true;
  };
  const endClose = () => {
    sessionClosePendingRef.current = false;
    return false;
  };

  return Object.freeze({
    beginClose,
    commitSessionPatch,
    commitSessionPatchWhenRestored,
    endClose,
    isClosePending,
    isRestored,
    markRestored,
    read: () => sessionRef.current,
  });
}

export function useDocumentWorkspaceState({
  letterTemplates,
  loadSession = loadSessionState,
  newDocumentTemplateId,
  readWorkspaceSplitRatio = readInitialWorkspaceSplitRatio,
  saveSession = saveSessionState,
} = {}) {
  const [initialState] = useState(() => createDocumentWorkspaceInitialState({
    letterTemplates,
    loadSession,
    newDocumentTemplateId,
    readWorkspaceSplitRatio,
  }));
  const { initialSession } = initialState;
  const sessionRef = useRef(initialSession);
  const sessionRestoredRef = useRef(false);
  const sessionClosePendingRef = useRef(false);

  const [documentState, setDocumentStateValue] = useState(initialState.documentState);
  const [currentPath, setCurrentPathValue] = useState(initialState.currentPath);
  const [dirty, setDirtyValue] = useState(initialState.dirty);
  const [openTabs, setOpenTabsValue] = useState(initialState.openTabs);
  const [activeTabId, setActiveTabIdValue] = useState(initialState.activeTabId);
  const [workspaceGroups, setWorkspaceGroupsValue] = useState(initialState.workspaceGroups);
  const [activePane, setActivePaneValue] = useState(initialState.activePane);

  const documentStateRef = useRef(documentState);
  const currentPathRef = useRef(currentPath);
  const dirtyRef = useRef(dirty);
  const openTabsRef = useRef(openTabs);
  const activeTabIdRef = useRef(activeTabId);
  const workspaceGroupsRef = useRef(workspaceGroups);
  const rightSplitTabIdRef = useRef(initialState.rightSplitTabId);
  const activePaneRef = useRef(activePane);

  const documentStorePort = useMemo(() => createDocumentStorePort({
    activeTabIdRef,
    currentPathRef,
    dirtyRef,
    documentStateRef,
    openTabsRef,
    setActiveTabId: setActiveTabIdValue,
    setCurrentPath: setCurrentPathValue,
    setDirty: setDirtyValue,
    setDocumentState: setDocumentStateValue,
    setOpenTabs: setOpenTabsValue,
  }), []);

  const groupStorePort = useMemo(() => createGroupStorePort({
    activePaneRef,
    rightSplitTabIdRef,
    setActivePane: setActivePaneValue,
    setWorkspaceGroups: setWorkspaceGroupsValue,
    workspaceGroupsRef,
  }), []);

  const sessionStatePort = useMemo(() => createSessionStatePort({
    saveSession,
    sessionClosePendingRef,
    sessionRef,
    sessionRestoredRef,
  }), [saveSession]);

  const setRightSplitTabId = useCallback((value) => {
    setWorkspaceGroupsValue(
      (previous) => updateRightSplitTabId(previous, value),
    );
  }, []);

  const setDocumentPaneRatio = useCallback((value) => {
    setWorkspaceGroupsValue(
      (previous) => updateDocumentPaneRatio(previous, value),
    );
  }, []);

  const rightSplitTabId = activeSecondaryDocumentTabId(workspaceGroups);
  const view = useMemo(() => ({
    activePane,
    activeTabId,
    dirty,
    document: documentState,
    groups: workspaceGroups,
    path: currentPath,
    rightSplitTabId,
    tabs: openTabs,
  }), [
    activePane,
    activeTabId,
    currentPath,
    dirty,
    documentState,
    openTabs,
    rightSplitTabId,
    workspaceGroups,
  ]);

  return {
    activePane,
    activePaneRef,
    activeTabId,
    activeTabIdRef,
    currentPath,
    currentPathRef,
    dirty,
    dirtyRef,
    documentState,
    documentStateRef,
    documentStorePort,
    groupStorePort,
    initialSession,
    openTabs,
    openTabsRef,
    persistSession: sessionStatePort.commitSessionPatch,
    rightSplitTabId,
    rightSplitTabIdRef,
    sessionClosePendingRef,
    sessionRef,
    sessionRestoredRef,
    sessionStatePort,
    setActivePane: setActivePaneValue,
    setActiveTabId: setActiveTabIdValue,
    setCurrentPath: setCurrentPathValue,
    setDirty: setDirtyValue,
    setDocumentPaneRatio,
    setDocumentState: setDocumentStateValue,
    setOpenTabs: setOpenTabsValue,
    setRightSplitTabId,
    setWorkspaceGroups: setWorkspaceGroupsValue,
    view,
    workspaceGroups,
    workspaceGroupsRef,
  };
}
