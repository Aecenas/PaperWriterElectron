import { mergePersistedDocumentIdentity } from "../document-schema-v2.js";
import {
  deleteRecoveryBestEffort,
  sameDocumentPath,
  selectAutosaveSnapshotTabs,
  snapshotRevisionIsCurrent,
} from "../editor-lifecycle.js";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  closeWorkspaceView,
  createDocumentWorkspaceView,
  createWorkspaceGroupsState,
  findWorkspaceView,
  getActiveWorkspaceView,
  removeWorkspaceViews,
} from "../workspace-groups.js";
import {
  createBlankDocument,
  createDocumentTab,
  documentRuntimeKey,
  normalizeDocument,
  recoveryTabId,
  summarizeSessionTabs,
  workspaceDocumentView,
} from "./model.js";
import { normalizeSessionDiskRevision } from "./revisions.js";

export const RECOVERY_AUTOSAVE_INTERVAL_MS = 30_000;
export const WORKSPACE_FLUSH_INTERVAL_MS = 30_000;
export const WORKSPACE_IDLE_FLUSH_AGE_MS = 5 * 60 * 1_000;
export const PERSISTENCE_ERROR_NOTICE_INTERVAL_MS = 5 * 60 * 1_000;

function requireMethod(port, method, portName) {
  if (typeof port?.[method] !== "function") {
    throw new TypeError(`${portName}.${method} must be a function`);
  }
}

function defaultTimerPort() {
  return {
    clearInterval: (timer) => globalThis.clearInterval(timer),
    setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
  };
}

function normalizeTabIds(tabIds) {
  return [...new Set(
    (Array.isArray(tabIds) ? tabIds : [tabIds])
      .map((tabId) => String(tabId || "").trim())
      .filter(Boolean),
  )];
}

export function createDocumentPersistenceRuntimeState() {
  return {
    pendingTabCloses: new Set(),
    persistenceErrorAt: 0,
    recoveryAutosaveRunning: false,
  };
}

/**
 * Owns every renderer-side durable write boundary for open documents.
 * Platform I/O, React state, editor capture, dialogs and presentation stay
 * behind ports so this module remains independently executable in node:test.
 */
export function createDocumentPersistenceController({
  applicationPort,
  dialogPort,
  dirtyPort,
  documentIoPort,
  documentStorePort,
  groupStorePort,
  letterTemplates,
  lifecyclePort = {},
  newDocumentTemplateId,
  notificationPort,
  now = () => Date.now(),
  revisionPort,
  runtimeState = createDocumentPersistenceRuntimeState(),
  saveQueuePort,
  sessionStatePort,
  snapshotPort,
  tabRuntimePort,
  timerPort = defaultTimerPort(),
} = {}) {
  requireMethod(applicationPort, "applyDocument", "applicationPort");
  requireMethod(
    applicationPort,
    "captureSaveDocument",
    "applicationPort",
  );
  requireMethod(applicationPort, "readSaveContext", "applicationPort");
  requireMethod(dialogPort, "confirmTabClose", "dialogPort");
  requireMethod(dialogPort, "confirmWindowClose", "dialogPort");
  requireMethod(dialogPort, "resolveSaveConflict", "dialogPort");
  requireMethod(dirtyPort, "commitRecoveryRevision", "dirtyPort");
  requireMethod(dirtyPort, "markClean", "dirtyPort");
  requireMethod(documentIoPort, "openDocumentPath", "documentIoPort");
  requireMethod(documentIoPort, "saveDocument", "documentIoPort");
  requireMethod(documentStorePort, "commitActiveTabId", "documentStorePort");
  requireMethod(documentStorePort, "commitCurrentPath", "documentStorePort");
  requireMethod(documentStorePort, "commitDirty", "documentStorePort");
  requireMethod(documentStorePort, "commitDocumentState", "documentStorePort");
  requireMethod(documentStorePort, "commitOpenTabs", "documentStorePort");
  requireMethod(documentStorePort, "read", "documentStorePort");
  requireMethod(groupStorePort, "commitActivePane", "groupStorePort");
  requireMethod(groupStorePort, "commitWorkspaceGroups", "groupStorePort");
  requireMethod(groupStorePort, "read", "groupStorePort");
  requireMethod(notificationPort, "show", "notificationPort");
  requireMethod(revisionPort, "commitDiskRevision", "revisionPort");
  requireMethod(revisionPort, "readDiskRevision", "revisionPort");
  requireMethod(revisionPort, "readLastEditAt", "revisionPort");
  requireMethod(revisionPort, "readLiveRevision", "revisionPort");
  requireMethod(saveQueuePort, "enqueue", "saveQueuePort");
  requireMethod(saveQueuePort, "hasPending", "saveQueuePort");
  requireMethod(saveQueuePort, "wait", "saveQueuePort");
  requireMethod(saveQueuePort, "waitAll", "saveQueuePort");
  requireMethod(sessionStatePort, "beginClose", "sessionStatePort");
  requireMethod(sessionStatePort, "commitSessionPatch", "sessionStatePort");
  requireMethod(sessionStatePort, "endClose", "sessionStatePort");
  requireMethod(sessionStatePort, "isClosePending", "sessionStatePort");
  requireMethod(snapshotPort, "snapshot", "snapshotPort");
  requireMethod(tabRuntimePort, "release", "tabRuntimePort");
  requireMethod(timerPort, "clearInterval", "timerPort");
  requireMethod(timerPort, "setInterval", "timerPort");
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (!(runtimeState?.pendingTabCloses instanceof Set)) {
    throw new TypeError("runtimeState.pendingTabCloses must be a Set");
  }

  const pendingTabCloses = runtimeState.pendingTabCloses;
  let lifecycleCleanup = null;

  const show = (message, tone) => notificationPort.show(message, tone);
  const queueTabSave = (tabId, operation) => (
    saveQueuePort.enqueue(tabId, operation)
  );
  const readDocuments = () => documentStorePort.read();
  const readGroups = () => groupStorePort.read();
  const commitTabs = (tabs) => documentStorePort.commitOpenTabs(tabs);
  const snapshotTabs = (options) => snapshotPort.snapshot(options);

  const markTabExternal = (tabId) => {
    const nextTabs = readDocuments().tabs.map((tab) => (
      tab.id === tabId ? { ...tab, externalChanged: true } : tab
    ));
    commitTabs(nextTabs);
    return nextTabs;
  };

  const notifyPersistenceError = (error, fallbackMessage) => {
    const timestamp = now();
    if (
      timestamp - runtimeState.persistenceErrorAt
        > PERSISTENCE_ERROR_NOTICE_INTERVAL_MS
    ) {
      runtimeState.persistenceErrorAt = timestamp;
      show(error?.message || fallbackMessage, "warning");
      return true;
    }
    return false;
  };

  const diskMutationBarrierPort = Object.freeze({
    async acquire(tabIds) {
      const ids = normalizeTabIds(tabIds);
      ids.forEach((tabId) => pendingTabCloses.add(tabId));
      await Promise.all(ids.map((tabId) => saveQueuePort.wait(tabId)));
      let released = false;
      return Object.freeze({
        release() {
          if (released) return false;
          released = true;
          ids.forEach((tabId) => pendingTabCloses.delete(tabId));
          return true;
        },
        tabIds: Object.freeze(ids),
      });
    },
    hasPending(tabId) {
      return pendingTabCloses.has(String(tabId || ""));
    },
  });

  const save = async (saveAs) => {
    try {
      const saveContext = applicationPort.readSaveContext();
      if (saveContext?.blockedByResearch) {
        show("当前活动标签是资料；请先切回信笺再保存", "warning");
        return { status: "research-active" };
      }
      const targetTab = saveContext?.targetTab;
      if (!targetTab) return { status: "missing-target" };
      if (
        sessionStatePort.isClosePending()
        || pendingTabCloses.has(targetTab.id)
      ) {
        return { status: "pending-close" };
      }
      const recoveryIdToDelete = targetTab.recoveryPath
        ? recoveryTabId(targetTab)
        : "";
      const nextDocument = applicationPort.captureSaveDocument(
        saveContext,
      );
      if (!nextDocument) return { status: "missing-document" };
      if (targetTab.readOnly || nextDocument?._readOnlyFutureSchema) {
        show("此信笺使用未来格式，当前版本只能只读打开", "warning");
        return { status: "read-only" };
      }

      const revision = revisionPort.readLiveRevision(targetTab.id);
      const previousDocumentKey = documentRuntimeKey(
        targetTab.path,
        targetTab.id,
      );
      const reservedPaths = readDocuments().tabs
        .filter((tab) => tab.id !== targetTab.id && tab.path)
        .map((tab) => tab.path);
      const expectedRevision = revisionPort.readDiskRevision(targetTab.id)
        || targetTab.diskRevision
        || null;
      let result = await queueTabSave(targetTab.id, () => (
        documentIoPort.saveDocument(
          nextDocument,
          targetTab.path,
          saveAs,
          reservedPaths,
          expectedRevision,
        )
      ));

      if (result?.conflict) {
        markTabExternal(targetTab.id);
        const decision = await dialogPort.resolveSaveConflict({
          result,
          tab: targetTab,
        });
        if (decision === "overwrite") {
          result = await queueTabSave(
            targetTab.id,
            () => documentIoPort.saveDocument(
              nextDocument,
              targetTab.path,
              false,
              reservedPaths,
              result.actualRevision,
              { conflictAction: "overwrite" },
            ),
          );
          if (result?.conflict) {
            markTabExternal(targetTab.id);
            show(
              "确认覆盖期间又检测到新的外部版本；未覆盖磁盘，并再次保留了本机冲突副本",
              "warning",
            );
            return { status: "conflict-again" };
          }
        } else if (decision === "reload") {
          const reloaded = await documentIoPort.openDocumentPath(
            targetTab.path,
          );
          if (!reloaded?.canceled && reloaded?.document) {
            revisionPort.commitDiskRevision(
              targetTab.id,
              reloaded.diskRevision,
            );
            dirtyPort.markClean(targetTab.id);
            dirtyPort.commitRecoveryRevision(targetTab.id, null);
            const normalizedReload = normalizeDocument(
              reloaded.document,
              letterTemplates,
            );
            const nextTabs = readDocuments().tabs.map((tab) => (
              tab.id === targetTab.id
                ? {
                    ...tab,
                    document: normalizedReload,
                    dirty: false,
                    diskRevision: reloaded.diskRevision,
                    recoveryPath: "",
                    recoveryId: "",
                    recoverySourcePath: "",
                    recoveryBaseRevision: null,
                    recoveryRevision: null,
                    recoveredTemporary: false,
                    externalChanged: false,
                  }
                : tab
            ));
            commitTabs(nextTabs);
            if (targetTab.id === readDocuments().activeTabId) {
              applicationPort.applyDocument(
                normalizedReload,
                targetTab.path,
                false,
              );
            }
            await deleteRecoveryBestEffort(
              documentIoPort.deleteTempDocument,
              recoveryIdToDelete,
            );
          }
          show(
            "已重新载入磁盘版本；内存稿保留在冲突副本中",
            "success",
          );
          return { status: "reloaded" };
        } else if (decision === "compare") {
          const diskResult = await documentIoPort.openDocumentPath(
            targetTab.path,
          );
          if (!diskResult?.canceled && diskResult?.document) {
            applicationPort.openConflictComparison?.({
              document: {
                ...diskResult.document,
                title: `${
                  diskResult.document.title
                  || targetTab.title
                  || "未命名信笺"
                }（磁盘版本对照）`,
              },
              targetTab,
            });
          }
          show(
            "已在只读视图中打开磁盘版本；右侧保留当前内存稿，冲突副本也已写入磁盘",
            "success",
          );
          return { status: "comparison-opened" };
        } else {
          show("两个版本都已保留，正文未被覆盖", "warning");
          return { status: "conflict-preserved" };
        }
      }

      if (result?.canceled) return { status: "canceled" };
      if (!result?.path) {
        throw new Error("保存完成后没有返回文件路径");
      }

      const unchanged = (
        revisionPort.readLiveRevision(targetTab.id) === revision
      );
      const savedDocument = normalizeDocument(
        result.document || nextDocument,
        letterTemplates,
      );
      if (result.diskRevision) {
        revisionPort.commitDiskRevision(
          targetTab.id,
          result.diskRevision,
        );
      }
      applicationPort.migrateDocumentRuntimeKey?.(
        previousDocumentKey,
        documentRuntimeKey(result.path, targetTab.id),
      );

      const latestSnapshot = unchanged
        ? readDocuments().tabs
        : snapshotTabs({ includeEditorJson: true });
      const latestTargetTab = latestSnapshot.find(
        (tab) => tab.id === targetTab.id,
      ) || targetTab;
      const livePersistedDocument = unchanged
        ? savedDocument
        : mergePersistedDocumentIdentity(
            latestTargetTab.document || nextDocument,
            savedDocument,
          );
      let recoveryWrite = null;
      let recoveryWriteError = null;
      if (unchanged) {
        dirtyPort.markClean(targetTab.id);
        dirtyPort.commitRecoveryRevision(targetTab.id, null);
      } else {
        try {
          recoveryWrite = await queueTabSave(
            targetTab.id,
            () => documentIoPort.saveTempDocument?.(
              livePersistedDocument,
              recoveryTabId(latestTargetTab),
            ),
          );
          if (recoveryWrite?.canceled || !recoveryWrite?.path) {
            throw new Error("恢复缓存未生成文件");
          }
        } catch (error) {
          recoveryWriteError = error;
        }
      }

      const commitSnapshot = unchanged
        ? latestSnapshot
        : snapshotTabs({ includeEditorJson: true });
      const commitTargetTab = commitSnapshot.find(
        (tab) => tab.id === targetTab.id,
      ) || latestTargetTab;
      const committedLiveDocument = unchanged
        ? livePersistedDocument
        : mergePersistedDocumentIdentity(
            commitTargetTab.document || livePersistedDocument,
            savedDocument,
          );
      const nextTabs = commitSnapshot.map((tab) => (
        tab.id === targetTab.id
          ? {
              ...tab,
              path: result.path,
              recoveryPath: unchanged
                ? ""
                : (recoveryWrite?.path || tab.recoveryPath || ""),
              recoveryId: unchanged
                ? ""
                : (
                  recoveryWrite?.recoveryId
                  || tab.recoveryId
                  || recoveryTabId(tab)
                ),
              recoverySourcePath: unchanged
                ? ""
                : (
                  recoveryWrite?.path
                    ? result.path
                    : tab.recoverySourcePath || ""
                ),
              recoveryBaseRevision: unchanged
                ? null
                : (
                  recoveryWrite?.path
                    ? normalizeSessionDiskRevision(result.diskRevision)
                    : tab.recoveryBaseRevision || null
                ),
              recoveryRevision: unchanged
                ? null
                : (
                  recoveryWrite?.path
                    ? latestTargetTab.snapshotRevision
                    : tab.recoveryRevision
                ),
              recoveredTemporary: unchanged
                ? false
                : Boolean(recoveryWrite?.path || tab.recoveryPath),
              title: committedLiveDocument.title,
              document: committedLiveDocument,
              diskRevision: result.diskRevision || tab.diskRevision,
              externalChanged: false,
              dirty: !unchanged,
            }
          : tab
      ));
      commitTabs(nextTabs);
      const committedTargetRuntime = nextTabs.find(
        (tab) => tab.id === targetTab.id,
      );
      dirtyPort.commitRecoveryRevision(
        targetTab.id,
        committedTargetRuntime?.recoveryRevision,
      );
      if (targetTab.id === readDocuments().activeTabId) {
        documentStorePort.commitCurrentPath(result.path);
        documentStorePort.commitDirty(!unchanged);
        documentStorePort.commitDocumentState(committedLiveDocument);
      }
      const activeId = readDocuments().activeTabId;
      const activeSessionTab = nextTabs.find(
        (tab) => tab.id === activeId,
      ) || nextTabs[0];
      sessionStatePort.commitSessionPatch({
        activePath: activeSessionTab?.path
          || activeSessionTab?.recoveryPath
          || "",
        tabs: summarizeSessionTabs(nextTabs),
      });
      applicationPort.refreshFolder?.();

      const recoveryCleaned = unchanged
        ? await deleteRecoveryBestEffort(
            documentIoPort.deleteTempDocument,
            recoveryIdToDelete,
          )
        : true;
      if (unchanged && !recoveryCleaned) {
        show("文档已保存，但旧恢复文件清理失败", "warning");
      } else if (!unchanged && recoveryWriteError) {
        show(
          `已写入点击保存时的版本，但后续编辑写入恢复缓存失败：${
            recoveryWriteError?.message || "稍后将重试"
          }`,
          "warning",
        );
      } else if (!unchanged) {
        show(
          "已写入点击保存时的版本；保存期间的新编辑已写入恢复缓存",
          "success",
        );
      } else {
        show(
          saveContext.isRightSplit
            ? "右分屏信笺已保存"
            : "文档已保存",
          "success",
        );
      }
      return {
        status: unchanged ? "saved" : "saved-with-newer-edits",
        tab: committedTargetRuntime,
      };
    } catch (error) {
      show(error?.message || "文档保存失败", "warning");
      return { error, status: "failed" };
    }
  };

  const closeTab = async (tabId) => {
    const normalizedTabId = String(tabId || "");
    if (
      !normalizedTabId
      || pendingTabCloses.has(normalizedTabId)
    ) {
      return { status: "pending" };
    }
    pendingTabCloses.add(normalizedTabId);
    try {
      await saveQueuePort.wait(normalizedTabId);
      let snapshot = snapshotTabs({ includeEditorJson: true });
      let closingTab = snapshot.find(
        (tab) => tab.id === normalizedTabId,
      );
      if (!closingTab) return { status: "missing" };

      const groupsBeforeClose = readGroups().groups;
      const location = findWorkspaceView(
        groupsBeforeClose,
        normalizedTabId,
      );
      const currentActiveTabId = readDocuments().activeTabId;
      const isActive = location?.groupId === WORKSPACE_GROUP_ID.SECONDARY
        ? (
          groupsBeforeClose.secondary.activeViewId
            === location.view.viewId
        )
        : normalizedTabId === currentActiveTabId;
      if (closingTab.dirty) {
        const promptedRevision = revisionPort.readLiveRevision(
          normalizedTabId,
        );
        const decision = await dialogPort.confirmTabClose({
          tab: closingTab,
        });
        if (decision !== "close") return { status: "canceled" };
        if (
          revisionPort.readLiveRevision(normalizedTabId)
            !== promptedRevision
        ) {
          show(
            "关闭确认期间信笺又有修改，请再次确认",
            "warning",
          );
          return { status: "changed" };
        }
        snapshot = snapshotTabs({ includeEditorJson: true });
        closingTab = snapshot.find(
          (tab) => tab.id === normalizedTabId,
        );
        if (!closingTab) return { status: "missing" };
      }

      if (closingTab.recoveryPath) {
        try {
          await documentIoPort.deleteTempDocument?.(
            recoveryTabId(closingTab),
          );
        } catch {
          // Closing remains best effort when recovery cleanup fails.
        }
      }

      const remaining = snapshot.filter(
        (tab) => tab.id !== normalizedTabId,
      );
      if (!remaining.length) {
        const blank = createBlankDocument(
          letterTemplates,
          newDocumentTemplateId,
        );
        const nextTab = createDocumentTab(blank);
        const nextGroups = createWorkspaceGroupsState(
          workspaceDocumentView(nextTab),
          { splitRatio: groupsBeforeClose.splitRatio },
        );
        groupStorePort.commitWorkspaceGroups(nextGroups);
        groupStorePort.commitActivePane("main");
        documentStorePort.commitOpenTabs([nextTab]);
        documentStorePort.commitActiveTabId(nextTab.id);
        applicationPort.applyDocument(
          blank,
          "",
          false,
          { scrollState: nextTab.scrollState },
        );
        tabRuntimePort.release(normalizedTabId);
        return { status: "closed", replacementTab: nextTab };
      }

      let nextTabs = remaining;
      let nextGroups = groupsBeforeClose;
      if (
        location?.groupId === WORKSPACE_GROUP_ID.PRIMARY
        && groupsBeforeClose.primary.views.length <= 1
      ) {
        const blank = createBlankDocument(
          letterTemplates,
          newDocumentTemplateId,
        );
        const blankTab = createDocumentTab(blank);
        nextTabs = [...remaining, blankTab];
        const blankView = createDocumentWorkspaceView(
          workspaceDocumentView(blankTab),
        );
        nextGroups = {
          ...groupsBeforeClose,
          primary: {
            views: [blankView],
            activeViewId: blankView.viewId,
          },
          focusedGroup: WORKSPACE_GROUP_ID.PRIMARY,
        };
      } else if (location) {
        nextGroups = closeWorkspaceView(
          groupsBeforeClose,
          location.groupId,
          location.view.viewId,
        );
      } else {
        nextGroups = removeWorkspaceViews(
          groupsBeforeClose,
          { tabId: normalizedTabId },
        );
      }

      documentStorePort.commitOpenTabs(nextTabs);
      tabRuntimePort.release(normalizedTabId);
      groupStorePort.commitWorkspaceGroups(nextGroups);
      const nextPrimaryView = getActiveWorkspaceView(
        nextGroups,
        WORKSPACE_GROUP_ID.PRIMARY,
      );
      const nextPrimaryTab = nextTabs.find(
        (tab) => tab.id === nextPrimaryView?.tabId,
      );
      if (
        location?.groupId === WORKSPACE_GROUP_ID.PRIMARY
        && nextPrimaryTab
      ) {
        documentStorePort.commitActiveTabId(nextPrimaryTab.id);
        applicationPort.applyDocument(
          nextPrimaryTab.document,
          nextPrimaryTab.path,
          nextPrimaryTab.dirty,
          {
            editorJson: nextPrimaryTab.editorJson,
            scrollState: nextPrimaryTab.scrollState,
          },
        );
        if (isActive) groupStorePort.commitActivePane("main");
      } else if (
        location?.groupId === WORKSPACE_GROUP_ID.SECONDARY
        && isActive
      ) {
        const nextSecondary = getActiveWorkspaceView(
          nextGroups,
          WORKSPACE_GROUP_ID.SECONDARY,
        );
        if (!nextSecondary) {
          applicationPort.commitActiveResearchItem?.(null);
          groupStorePort.commitActivePane("main");
        } else {
          if (nextSecondary.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
            applicationPort.commitActiveResearchItem?.(
              applicationPort.resolveResearchItem?.(nextSecondary) || null,
            );
          }
          groupStorePort.commitActivePane("right");
        }
      }
      return { status: "closed" };
    } finally {
      pendingTabCloses.delete(normalizedTabId);
    }
  };

  const closeWindow = async (payload = {}) => {
    if (!sessionStatePort.beginClose()) {
      return { status: "pending" };
    }
    let closeCommitted = false;
    let handshakeSent = false;
    const closeCanceled = async () => {
      if (handshakeSent) return;
      handshakeSent = true;
      await documentIoPort.closeCanceled?.(payload);
    };
    const closeReady = async () => {
      if (handshakeSent) return;
      handshakeSent = true;
      await documentIoPort.closeReady?.(payload);
    };

    try {
      await saveQueuePort.waitAll();
      const snapshot = snapshotTabs();
      const dirtyTabs = snapshot.filter((tab) => tab.dirty);
      const promptedRevisions = new Map(
        dirtyTabs.map((tab) => [tab.id, tab.snapshotRevision]),
      );
      let finalTabs = snapshot;

      if (dirtyTabs.length) {
        const decision = await dialogPort.confirmWindowClose({
          dirtyTabs,
        });
        if (decision === "cancel" || !decision) {
          await closeCanceled();
          return { status: "canceled" };
        }

        if (decision === "discard") {
          const latestSnapshot = snapshotTabs();
          const changedWhileConfirming = latestSnapshot.some((tab) => (
            tab.dirty
            && (
              !promptedRevisions.has(tab.id)
              || tab.snapshotRevision !== promptedRevisions.get(tab.id)
            )
          ));
          if (changedWhileConfirming) {
            show(
              "关闭确认期间文档又有修改，请再次确认",
              "warning",
            );
            await closeCanceled();
            return { status: "changed" };
          }
          const latestDirtyTabs = latestSnapshot.filter(
            (tab) => tab.dirty,
          );
          await Promise.allSettled(
            latestDirtyTabs
              .filter((tab) => !tab.path && tab.recoveryPath)
              .map((tab) => documentIoPort.deleteTempDocument?.(
                recoveryTabId(tab),
              )),
          );
          const discardedIds = new Set(
            latestDirtyTabs
              .filter((tab) => !tab.path)
              .map((tab) => tab.id),
          );
          finalTabs = latestSnapshot.filter(
            (tab) => !discardedIds.has(tab.id),
          );
        }

        if (decision === "save") {
          finalTabs = snapshotTabs();
          const savedTabs = [];
          try {
            for (const tab of finalTabs) {
              if (!snapshotRevisionIsCurrent(tab, revisionPort)) {
                show(
                  "保存期间文档又有修改，请确认内容后再次关闭",
                  "warning",
                );
                await closeCanceled();
                return { status: "changed" };
              }
              if (!tab.dirty) {
                savedTabs.push(tab);
                continue;
              }
              const result = await queueTabSave(
                tab.id,
                () => (
                  tab.path
                    ? documentIoPort.saveDocument(
                        tab.document,
                        tab.path,
                        false,
                        [],
                        revisionPort.readDiskRevision(tab.id)
                          || tab.diskRevision
                          || null,
                      )
                    : documentIoPort.saveTempDocument?.(
                        tab.document,
                        recoveryTabId(tab),
                      )
                ),
              );
              if (result?.conflict) {
                throw new Error(
                  `检测到外部版本；内存稿已保存为冲突副本：${
                    result.conflictCopyPath
                  }`,
                );
              }
              if (result?.canceled || !result?.path) {
                await closeCanceled();
                return { status: "canceled" };
              }
              if (tab.path && result.diskRevision) {
                revisionPort.commitDiskRevision(
                  tab.id,
                  result.diskRevision,
                );
              }
              if (!snapshotRevisionIsCurrent(tab, revisionPort)) {
                show(
                  "保存期间文档又有修改，请确认内容后再次关闭",
                  "warning",
                );
                await closeCanceled();
                return { status: "changed" };
              }
              savedTabs.push({
                ...tab,
                path: tab.path ? result.path : "",
                recoveryPath: tab.path ? "" : result.path,
                recoveryId: tab.path
                  ? ""
                  : (result.recoveryId || recoveryTabId(tab)),
                recoveredTemporary: !tab.path,
                document: result.document || tab.document,
                diskRevision: result.diskRevision || tab.diskRevision,
                recoverySourcePath: tab.path
                  ? ""
                  : tab.recoverySourcePath,
                recoveryBaseRevision: tab.path
                  ? null
                  : tab.recoveryBaseRevision,
                recoveryRevision: tab.path
                  ? null
                  : tab.snapshotRevision,
                dirty: !tab.path,
              });
            }

            const savedSnapshotById = new Map(
              savedTabs.map((tab) => [tab.id, tab]),
            );
            const changedAfterSaving = readDocuments().tabs.some((tab) => {
              const savedSnapshot = savedSnapshotById.get(tab.id);
              return !savedSnapshot
                || !snapshotRevisionIsCurrent(
                  savedSnapshot,
                  revisionPort,
                );
            });
            if (changedAfterSaving) {
              show(
                "保存期间文档又有修改，请确认内容后再次关闭",
                "warning",
              );
              await closeCanceled();
              return { status: "changed" };
            }
            finalTabs = savedTabs;
          } catch (error) {
            show(error?.message || "关闭前保存失败", "warning");
            await closeCanceled();
            return { error, status: "failed" };
          }
        }
      }

      const activeId = readDocuments().activeTabId;
      const activeTab = finalTabs.find(
        (tab) => tab.id === activeId,
      ) || finalTabs[0];
      sessionStatePort.commitSessionPatch({
        activePath: activeTab?.path || activeTab?.recoveryPath || "",
        tabs: summarizeSessionTabs(finalTabs),
      });
      await closeReady();
      closeCommitted = true;
      return { status: "ready", tabs: finalTabs };
    } finally {
      if (!closeCommitted) sessionStatePort.endClose();
    }
  };

  const runRecoveryAutosave = async () => {
    if (
      runtimeState.recoveryAutosaveRunning
      || sessionStatePort.isClosePending()
    ) {
      return { status: "gated" };
    }
    runtimeState.recoveryAutosaveRunning = true;
    try {
      const snapshot = snapshotTabs();
      const dirtyTabs = selectAutosaveSnapshotTabs(
        snapshot,
        saveQueuePort,
        pendingTabCloses,
      );
      if (!dirtyTabs.length) return { status: "empty" };

      const updates = new Map();
      for (const tab of dirtyTabs) {
        if (
          saveQueuePort.hasPending(tab.id)
          || !snapshotRevisionIsCurrent(tab, revisionPort)
        ) {
          continue;
        }
        try {
          const result = await queueTabSave(
            tab.id,
            () => documentIoPort.saveTempDocument?.(
              tab.document,
              recoveryTabId(tab),
            ),
          );
          if (result?.canceled || !result?.path) {
            throw new Error("自动保存没有生成可恢复文件");
          }
          updates.set(tab.id, {
            path: result.path,
            sourcePath: tab.path || "",
            baseRevision: normalizeSessionDiskRevision(
              revisionPort.readDiskRevision(tab.id)
                || tab.diskRevision,
            ),
            recoveryId: result.recoveryId || recoveryTabId(tab),
            snapshotRevision: tab.snapshotRevision,
          });
        } catch (error) {
          notifyPersistenceError(
            error,
            "自动保存失败，将在稍后重试",
          );
        }
      }
      if (!updates.size) return { status: "empty" };

      const appliedUpdates = new Map();
      const nextTabs = readDocuments().tabs.map((tab) => {
        const update = updates.get(tab.id);
        if (!update) return tab;
        const targetUnchanged = sameDocumentPath(
          tab.path || "",
          update.sourcePath,
        );
        if (!targetUnchanged) return tab;
        appliedUpdates.set(tab.id, update);
        return {
          ...tab,
          recoveryPath: update.path,
          recoveryId: update.recoveryId,
          recoverySourcePath: update.sourcePath,
          recoveryBaseRevision: update.baseRevision,
          recoveryRevision: update.snapshotRevision,
          recoveredTemporary: true,
          dirty: true,
        };
      });
      commitTabs(nextTabs);
      appliedUpdates.forEach((update, tabId) => {
        dirtyPort.commitRecoveryRevision(
          tabId,
          update.snapshotRevision,
        );
      });
      const activeId = readDocuments().activeTabId;
      const activeTab = nextTabs.find((tab) => tab.id === activeId);
      sessionStatePort.commitSessionPatch({
        activePath: activeTab?.path || activeTab?.recoveryPath || "",
        tabs: summarizeSessionTabs(nextTabs),
      });
      return {
        status: "saved",
        updatedTabIds: [...appliedUpdates.keys()],
      };
    } finally {
      runtimeState.recoveryAutosaveRunning = false;
    }
  };

  const flushDirtyWorkspaceTabs = async ({
    idleOnly = false,
    tabIds = [],
  } = {}) => {
    if (sessionStatePort.isClosePending()) {
      return { status: "gated" };
    }
    const timestamp = now();
    const requestedTabIds = normalizeTabIds(tabIds);
    const requestedTabIdSet = requestedTabIds.length
      ? new Set(requestedTabIds)
      : null;
    const snapshot = snapshotTabs();
    const candidates = snapshot.filter((tab) => (
      (!requestedTabIdSet || requestedTabIdSet.has(tab.id))
      && tab.path
      && tab.dirty
      && !tab.readOnly
      && !tab.externalChanged
      && (
        !idleOnly
        || timestamp
          - (revisionPort.readLastEditAt(tab.id) || timestamp)
          >= WORKSPACE_IDLE_FLUSH_AGE_MS
      )
    ));
    const writtenTabIds = [];
    const writtenRevisions = Object.create(null);

    for (const tab of candidates) {
      if (
        saveQueuePort.hasPending(tab.id)
        || !snapshotRevisionIsCurrent(tab, revisionPort)
      ) {
        continue;
      }
      try {
        const expectedRevision = revisionPort.readDiskRevision(tab.id)
          || tab.diskRevision
          || null;
        const result = await queueTabSave(
          tab.id,
          () => documentIoPort.saveDocument(
            tab.document,
            tab.path,
            false,
            [],
            expectedRevision,
          ),
        );
        if (result?.conflict) {
          markTabExternal(tab.id);
          show(
            "检测到外部版本；本机稿已保留为冲突副本",
            "warning",
          );
          continue;
        }
        if (!result?.path) continue;
        if (result.diskRevision) {
          revisionPort.commitDiskRevision(tab.id, result.diskRevision);
        }
        if (!snapshotRevisionIsCurrent(tab, revisionPort)) continue;

        dirtyPort.markClean(tab.id);
        dirtyPort.commitRecoveryRevision(tab.id, null);
        const nextTabs = readDocuments().tabs.map((item) => (
          item.id === tab.id
            ? {
                ...item,
                document: result.document || tab.document,
                diskRevision: result.diskRevision,
                recoveryPath: "",
                recoveryId: "",
                recoverySourcePath: "",
                recoveryBaseRevision: null,
                recoveryRevision: null,
                recoveredTemporary: false,
                dirty: false,
                externalChanged: false,
              }
            : item
        ));
        commitTabs(nextTabs);
        if (tab.id === readDocuments().activeTabId) {
          documentStorePort.commitDirty(false);
        }
        if (tab.recoveryPath) {
          try {
            await documentIoPort.deleteTempDocument?.(
              recoveryTabId(tab),
            );
          } catch {
            // Durable workspace write already succeeded.
          }
        }
        writtenTabIds.push(tab.id);
        if (result.diskRevision) {
          writtenRevisions[tab.id] = result.diskRevision;
        }
      } catch (error) {
        notifyPersistenceError(
          error,
          "工作区自动写入失败，将继续保留恢复缓存",
        );
      }
    }
    sessionStatePort.commitSessionPatch({
      tabs: summarizeSessionTabs(readDocuments().tabs),
    });
    return { status: "flushed", writtenTabIds, writtenRevisions };
  };

  const startLifecycle = ({ resolveController } = {}) => {
    if (lifecycleCleanup) return lifecycleCleanup;
    if (
      resolveController !== undefined
      && typeof resolveController !== "function"
    ) {
      throw new TypeError("resolveController must be a function");
    }
    const invokeController = (method, fallback, ...args) => {
      const currentController = resolveController?.();
      const operation = currentController?.[method];
      return typeof operation === "function"
        ? operation(...args)
        : fallback(...args);
    };
    const unsubscribeClose = lifecyclePort.onCloseRequest?.(
      (payload) => invokeController("closeWindow", closeWindow, payload),
    );
    const recoveryTimer = timerPort.setInterval(
      () => invokeController(
        "runRecoveryAutosave",
        runRecoveryAutosave,
      ),
      RECOVERY_AUTOSAVE_INTERVAL_MS,
    );
    const flushTimer = timerPort.setInterval(
      () => invokeController(
        "flushDirtyWorkspaceTabs",
        flushDirtyWorkspaceTabs,
        { idleOnly: true },
      ),
      WORKSPACE_FLUSH_INTERVAL_MS,
    );
    const unsubscribeBlur = lifecyclePort.onWindowBlur?.(
      () => invokeController(
        "flushDirtyWorkspaceTabs",
        flushDirtyWorkspaceTabs,
        { idleOnly: false },
      ),
    );
    lifecycleCleanup = () => {
      unsubscribeClose?.();
      timerPort.clearInterval(recoveryTimer);
      timerPort.clearInterval(flushTimer);
      unsubscribeBlur?.();
      lifecycleCleanup = null;
    };
    return lifecycleCleanup;
  };

  return Object.freeze({
    closeTab,
    closeWindow,
    diskMutationBarrierPort,
    flushDirtyWorkspaceTabs,
    readLifecycleState: () => Object.freeze({
      pendingTabCloseIds: Object.freeze([...pendingTabCloses]),
      recoveryAutosaveRunning: runtimeState.recoveryAutosaveRunning,
      sessionClosePending: sessionStatePort.isClosePending(),
    }),
    runRecoveryAutosave,
    save,
    startLifecycle,
  });
}
