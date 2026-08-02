function readTargetTab(documentStorePort, tabId) {
  return documentStorePort.read().tabs.find((tab) => tab.id === tabId) || null;
}

function historyPreparationError(message) {
  const error = new Error(message);
  error.code = "HISTORY_PREPARATION_FAILED";
  return error;
}

/**
 * Establishes a durable history boundary for one open tab.
 *
 * Dirty live editor content is captured by the persistence controller's
 * snapshot port and written before the caller may create or restore history.
 * The returned document and revision therefore describe the same successful
 * save boundary. Any conflict, stale save or write failure aborts the history
 * operation instead of falling back to the older file on disk.
 */
export async function prepareDocumentHistoryOperation({
  tabId,
  persistenceController,
  documentStorePort,
  dirtyPort,
  revisionPort,
  getDocumentRevision,
} = {}) {
  const targetTabId = String(tabId || "").trim();
  if (!targetTabId) {
    throw historyPreparationError("版本历史目标已失效");
  }

  const barrier = await persistenceController.diskMutationBarrierPort.acquire([
    targetTabId,
  ]);
  try {
    let targetTab = readTargetTab(documentStorePort, targetTabId);
    if (!targetTab?.path) {
      throw historyPreparationError("请先保存当前信笺，再使用版本历史");
    }
    if (targetTab.externalChanged) {
      throw historyPreparationError("检测到外部版本，请先处理文件冲突");
    }

    const wasDirty = Boolean(
      targetTab.dirty || dirtyPort.isDirty(targetTabId),
    );
    let savedDiskRevision = null;
    if (wasDirty) {
      const result = await persistenceController.flushDirtyWorkspaceTabs({
        idleOnly: false,
        tabIds: [targetTabId],
      });
      savedDiskRevision = result?.writtenRevisions?.[targetTabId] || null;
      targetTab = readTargetTab(documentStorePort, targetTabId);
      const saveCommitted = Boolean(
        result?.writtenTabIds?.includes(targetTabId)
        && savedDiskRevision
        && targetTab
        && !targetTab.dirty
        && !dirtyPort.isDirty(targetTabId),
      );
      if (!saveCommitted) {
        throw historyPreparationError(
          targetTab?.externalChanged
            ? "检测到外部版本，版本历史操作已取消"
            : "当前内容未能完整保存，版本历史操作已取消",
        );
      }
    }

    targetTab = readTargetTab(documentStorePort, targetTabId);
    if (!targetTab?.path || !targetTab.document) {
      throw historyPreparationError("版本历史目标已失效");
    }
    if (targetTab.externalChanged) {
      throw historyPreparationError("检测到外部版本，版本历史操作已取消");
    }

    let diskRevision = savedDiskRevision
      || revisionPort.readDiskRevision(targetTabId)
      || targetTab.diskRevision
      || null;
    if (!diskRevision && typeof getDocumentRevision === "function") {
      const result = await getDocumentRevision(targetTab.path);
      diskRevision = result?.diskRevision || null;
      if (diskRevision) {
        revisionPort.commitDiskRevision(targetTabId, diskRevision);
      }
    }
    if (!diskRevision) {
      throw historyPreparationError(
        "无法确认当前文件版本，版本历史操作已取消",
      );
    }

    return Object.freeze({
      document: targetTab.document,
      filePath: targetTab.path,
      diskRevision,
      wasDirty,
    });
  } finally {
    barrier.release();
  }
}
