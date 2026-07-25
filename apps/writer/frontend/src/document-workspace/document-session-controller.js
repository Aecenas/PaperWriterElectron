import { displayNameFromPath } from "../app-shell/path-display.js";
import {
  sameDocumentPath,
  sessionTabSignature,
} from "../editor-lifecycle.js";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  createWorkspaceGroupsState,
  getActiveWorkspaceView,
  openWorkspaceDocument,
  restoreWorkspaceGroupsSnapshot,
  selectWorkspaceView,
} from "../workspace-groups.js";
import {
  createDocumentTab,
  documentTabResourceKey,
  normalizeDocument,
  summarizeSessionTabs,
  summarizeWorkspaceGroups,
  workspaceDocumentView,
} from "./model.js";
import {
  normalizeSessionDiskRevision,
  sameDiskRevision,
} from "./revisions.js";

export const DOCUMENT_SESSION_PERSIST_DELAY_MS = 220;
const STALE_RESTORE = Symbol("stale-document-session-restore");

function requirePortMethod(port, method, portName) {
  if (typeof port?.[method] !== "function") {
    throw new TypeError(`${portName}.${method} must be a function`);
  }
}

function createDefaultTimerPort() {
  return {
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  };
}

/**
 * Returns the two scalar dependencies used by App's persistence effect plus
 * the already-normalized v3 group snapshot. Runtime tab ids never enter the
 * persisted group signature.
 */
export function describeDocumentSessionPersistence({
  activeTabId = "",
  currentPath = "",
  groups,
  tabs = [],
} = {}) {
  const activeSessionPath = currentPath
    || tabs.find((tab) => tab.id === activeTabId)?.recoveryPath
    || "";
  const workspaceGroupsSnapshot = summarizeWorkspaceGroups(groups, tabs);
  return {
    activeSessionPath,
    sessionPathSignature: sessionTabSignature(activeSessionPath, tabs),
    workspaceGroupsSessionSignature: JSON.stringify(workspaceGroupsSnapshot),
    workspaceGroupsSnapshot,
  };
}

/**
 * Builds the delayed session patch from live ports. The active tab's path is
 * replaced with the live editor path immediately before summarization, exactly
 * as the former App effect did.
 */
export function createDocumentSessionPersistencePatch({
  activeTabId = "",
  currentPath = "",
  groups,
  tabs = [],
} = {}) {
  const liveTabs = tabs.map((tab) => (
    tab.id === activeTabId ? { ...tab, path: currentPath } : tab
  ));
  return {
    activePath: currentPath
      || liveTabs.find((tab) => tab.id === activeTabId)?.recoveryPath
      || "",
    tabs: summarizeSessionTabs(liveTabs),
    workspaceGroups: summarizeWorkspaceGroups(groups, liveTabs),
  };
}

/**
 * Normalizes legacy tab entries and preserves the historical activePath
 * fallback. Matching intentionally checks only entry.path (not recoveryPath).
 */
export function createDocumentSessionRestoreEntries(session = {}) {
  const activePath = session?.activePath || "";
  const restoreEntries = [...summarizeSessionTabs(session?.tabs || [])];
  if (
    activePath
    && !restoreEntries.some((entry) => sameDocumentPath(entry.path, activePath))
  ) {
    restoreEntries.push({ path: activePath, temporary: false });
  }
  return restoreEntries;
}

/**
 * Owns renderer session persistence and document/layout restoration while all
 * mutations and platform I/O remain behind injectable ports.
 *
 * Folder restoration is deliberately a port: the file-workspace lifecycle
 * continues to own request generations, folder refs, timeout fallback and tree
 * state. Its restoreSessionFolder implementation should preserve those rules.
 */
export function createDocumentSessionController({
  applyDocument,
  debugPort = {},
  documentIoPort,
  documentRuntimePort = {},
  documentStorePort,
  folderLifecyclePort = {},
  groupStorePort,
  letterTemplates,
  now = () => Date.now(),
  researchStatePort = {},
  sessionStatePort,
  timerPort = createDefaultTimerPort(),
} = {}) {
  requirePortMethod(documentIoPort, "openDocumentPath", "documentIoPort");
  requirePortMethod(documentStorePort, "read", "documentStorePort");
  requirePortMethod(documentStorePort, "commitActiveTabId", "documentStorePort");
  requirePortMethod(documentStorePort, "commitOpenTabs", "documentStorePort");
  requirePortMethod(groupStorePort, "read", "groupStorePort");
  requirePortMethod(groupStorePort, "commitActivePane", "groupStorePort");
  requirePortMethod(groupStorePort, "commitWorkspaceGroups", "groupStorePort");
  requirePortMethod(sessionStatePort, "read", "sessionStatePort");
  requirePortMethod(sessionStatePort, "commitSessionPatch", "sessionStatePort");
  requirePortMethod(sessionStatePort, "isRestored", "sessionStatePort");
  requirePortMethod(sessionStatePort, "markRestored", "sessionStatePort");
  if (typeof applyDocument !== "function") {
    throw new TypeError("applyDocument must be a function");
  }
  requirePortMethod(timerPort, "clearTimeout", "timerPort");
  requirePortMethod(timerPort, "setTimeout", "timerPort");

  let persistTimer = null;
  let restoreRunId = 0;

  const log = (event, payload) => {
    debugPort.log?.(event, payload);
  };

  const readPersistenceDescriptor = () => {
    const documentState = documentStorePort.read();
    const groupState = groupStorePort.read();
    return describeDocumentSessionPersistence({
      activeTabId: documentState.activeTabId,
      currentPath: documentState.currentPath,
      groups: groupState.groups,
      tabs: documentState.tabs,
    });
  };

  const persistLiveSnapshot = () => {
    const documentState = documentStorePort.read();
    const groupState = groupStorePort.read();
    return sessionStatePort.commitSessionPatch(
      createDocumentSessionPersistencePatch({
        activeTabId: documentState.activeTabId,
        currentPath: documentState.currentPath,
        groups: groupState.groups,
        tabs: documentState.tabs,
      }),
    );
  };

  const cancelScheduledPersistence = () => {
    if (persistTimer === null) return false;
    timerPort.clearTimeout(persistTimer);
    persistTimer = null;
    return true;
  };

  const schedulePersistence = () => {
    if (!sessionStatePort.isRestored()) return undefined;
    cancelScheduledPersistence();
    const timer = timerPort.setTimeout(() => {
      if (persistTimer !== timer) return;
      persistTimer = null;
      persistLiveSnapshot();
    }, DOCUMENT_SESSION_PERSIST_DELAY_MS);
    persistTimer = timer;
    return () => {
      if (persistTimer !== timer) return;
      timerPort.clearTimeout(timer);
      persistTimer = null;
    };
  };

  const openRestoredTab = async (restoreEntry, isActiveRestore) => {
    const restorePath = restoreEntry.recoveryPath || restoreEntry.path;
    const result = await documentIoPort.openDocumentPath(restorePath);
    if (!isActiveRestore()) return STALE_RESTORE;
    if (result?.canceled || !result?.document) return null;

    const normalized = normalizeDocument(result.document, letterTemplates);
    const restoredFromRecovery = Boolean(
      restoreEntry.recoveryPath || restoreEntry.temporary,
    );
    if (!restoredFromRecovery) {
      return createDocumentTab(
        normalized,
        result.path,
        false,
        {
          diskRevision: result.diskRevision,
          readOnly: result.readOnly,
        },
      );
    }

    const logicalPath = restoreEntry.temporary ? "" : restoreEntry.path;
    const recoverySourcePath = restoreEntry.recoverySourcePath || logicalPath;
    const recoveryBaseRevision = normalizeSessionDiskRevision(
      restoreEntry.recoveryBaseRevision,
    );
    let logicalRevision = null;
    if (
      logicalPath
      && typeof documentIoPort.getDocumentRevision === "function"
    ) {
      try {
        logicalRevision = await documentIoPort.getDocumentRevision(logicalPath);
      } catch {
        logicalRevision = null;
      }
    }
    const currentDiskRevision = normalizeSessionDiskRevision(
      logicalRevision?.diskRevision,
    );
    const sourceMatches = !logicalPath
      || !recoverySourcePath
      || sameDocumentPath(logicalPath, recoverySourcePath);
    const externalChanged = Boolean(logicalPath && (
      !sourceMatches
      || !recoveryBaseRevision
      || !sameDiskRevision(currentDiskRevision, recoveryBaseRevision)
    ));
    return createDocumentTab(normalized, logicalPath, true, {
      recoveryPath: result.path,
      recoveryId: restoreEntry.recoveryId || result.recoveryId,
      recoverySourcePath,
      recoveryBaseRevision,
      recoveryRevision: 0,
      recoveredTemporary: true,
      diskRevision: recoveryBaseRevision,
      readOnly: result.readOnly,
      externalChanged,
    });
  };

  const restoreDocumentsAndGroups = async ({
    activePath,
    isActiveRestore,
    restoreEntries,
  }) => {
    if (!restoreEntries.length) {
      return { status: "empty", tabs: [] };
    }

    const restoredTabs = [];
    for (const restoreEntry of restoreEntries) {
      try {
        const tab = await openRestoredTab(restoreEntry, isActiveRestore);
        if (tab === STALE_RESTORE) {
          return { status: "stale", tabs: [] };
        }
        if (!isActiveRestore()) {
          return { status: "stale", tabs: [] };
        }
        if (tab) restoredTabs.push(tab);
      } catch {
        // Missing or unreadable session files are skipped.
      }
    }

    if (!isActiveRestore()) {
      return { status: "stale", tabs: [] };
    }
    if (!restoredTabs.length) {
      sessionStatePort.commitSessionPatch({ activePath: "", tabs: [] });
      return { status: "unavailable", tabs: [] };
    }

    const restoredAt = now();
    restoredTabs.forEach((tab) => {
      documentRuntimePort.ensure?.(tab.id, {
        dirty: tab.dirty,
        diskRevision: tab.diskRevision,
        lastEditAt: tab.dirty ? restoredAt : null,
        liveUpdatedAt: tab.document?.updatedAt,
        recoveryRevision: tab.recoveryRevision,
      });
    });

    const legacyActiveTab = restoredTabs.find((tab) => (
      sameDocumentPath(tab.path || tab.recoveryPath, activePath)
    )) || restoredTabs[0];
    let fallbackGroups = createWorkspaceGroupsState(
      workspaceDocumentView(restoredTabs[0]),
      { splitRatio: groupStorePort.read().groups.splitRatio },
    );
    for (const tab of restoredTabs.slice(1)) {
      fallbackGroups = openWorkspaceDocument(
        fallbackGroups,
        WORKSPACE_GROUP_ID.PRIMARY,
        workspaceDocumentView(tab),
      );
    }
    fallbackGroups = selectWorkspaceView(
      fallbackGroups,
      WORKSPACE_GROUP_ID.PRIMARY,
      legacyActiveTab.id,
    );

    const restoredGroups = restoreWorkspaceGroupsSnapshot(
      sessionStatePort.read().workspaceGroups,
      {
        documents: restoredTabs.map(workspaceDocumentView),
        fallbackState: fallbackGroups,
        fallbackPrimaryDocument: workspaceDocumentView(legacyActiveTab),
        resolveDocumentTabId: (resourceKey) => {
          const tab = restoredTabs.find(
            (candidate) => documentTabResourceKey(candidate) === resourceKey,
          );
          return tab ? workspaceDocumentView(tab) : null;
        },
      },
    ) || fallbackGroups;
    const restoredPrimaryView = getActiveWorkspaceView(
      restoredGroups,
      WORKSPACE_GROUP_ID.PRIMARY,
    );
    const activeTab = restoredTabs.find(
      (tab) => tab.id === restoredPrimaryView?.tabId,
    ) || legacyActiveTab;

    documentStorePort.commitOpenTabs(restoredTabs);
    groupStorePort.commitWorkspaceGroups(restoredGroups);
    documentStorePort.commitActiveTabId(activeTab.id);
    applyDocument(activeTab.document, activeTab.path, activeTab.dirty);

    const restoredSecondaryView = getActiveWorkspaceView(
      restoredGroups,
      WORKSPACE_GROUP_ID.SECONDARY,
    );
    if (
      restoredGroups.focusedGroup === WORKSPACE_GROUP_ID.SECONDARY
      && restoredSecondaryView
    ) {
      groupStorePort.commitActivePane("right");
      if (
        restoredSecondaryView.kind === WORKSPACE_VIEW_KIND.RESEARCH
        && restoredSecondaryView.relativePath
      ) {
        const restoredResearchItem = {
          type: "file",
          relativePath: restoredSecondaryView.relativePath,
          name: restoredSecondaryView.titleSnapshot
            || displayNameFromPath(restoredSecondaryView.relativePath),
        };
        researchStatePort.commitItem?.(
          restoredSecondaryView.viewId,
          restoredResearchItem,
        );
        researchStatePort.commitActiveItem?.(restoredResearchItem);
      }
    } else {
      groupStorePort.commitActivePane("main");
    }

    sessionStatePort.commitSessionPatch({
      activePath: activeTab.path || activeTab.recoveryPath,
      tabs: summarizeSessionTabs(restoredTabs),
      workspaceGroups: summarizeWorkspaceGroups(restoredGroups, restoredTabs),
    });
    return {
      activeTab,
      groups: restoredGroups,
      status: "restored",
      tabs: restoredTabs,
    };
  };

  const beginRestore = () => {
    if (sessionStatePort.isRestored()) return null;
    let canceled = false;
    const runId = restoreRunId + 1;
    restoreRunId = runId;
    const isActiveRestore = () => (
      !canceled && restoreRunId === runId
    );

    const promise = (async () => {
      const initialSession = sessionStatePort.read();
      const savedFolderPath = initialSession.folderPath;
      const activePath = initialSession.activePath;
      const restoreEntries = createDocumentSessionRestoreEntries(initialSession);
      log("renderer:restore:start", {
        savedFolderPath,
        activePath,
        tabs: restoreEntries.length,
      });

      await folderLifecyclePort.restoreSessionFolder?.({
        activePath,
        commitSessionPatch: sessionStatePort.commitSessionPatch,
        isActiveRestore,
        runId,
        savedFolderPath,
      });

      const result = await restoreDocumentsAndGroups({
        activePath,
        isActiveRestore,
        restoreEntries,
      });
      if (isActiveRestore()) {
        sessionStatePort.markRestored(true);
        log("renderer:restore:complete", { runId });
      }
      return result;
    })();

    return {
      cancel() {
        canceled = true;
        log("renderer:restore:canceled", { runId });
      },
      isActive: isActiveRestore,
      promise,
      runId,
    };
  };

  return Object.freeze({
    beginRestore,
    cancelScheduledPersistence,
    persistLiveSnapshot,
    readPersistenceDescriptor,
    schedulePersistence,
  });
}
