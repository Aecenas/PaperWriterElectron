import { pathIsSameOrInside } from "../app-shell/path-display.js";
import { replacePathPrefix } from "../document-workspace/path-model.js";
import { sameDiskRevision } from "../document-workspace/revisions.js";
import { sameDocumentPath } from "../editor-lifecycle.js";
import { createLatestRequestController } from "../latest-request-controller.js";

function folderEntries(result = {}) {
  return result.entries || [...(result.folders || []), ...(result.files || [])];
}

function folderListing(result = {}, fallbackPath = "") {
  return {
    path: result.folderPath || fallbackPath,
    parentPath: result.parentPath || "",
    folders: result.folders || [],
    files: result.files || [],
    entries: folderEntries(result),
    loading: false,
    error: "",
  };
}

function defaultMonotonicNow() {
  return globalThis.performance?.now?.() || Date.now();
}

function defaultNowIso() {
  return new Date().toISOString();
}

export function createWorkspaceFileController({
  clock = {},
  documentPort,
  factories,
  folderPort,
  groupPort = {},
  ioPort,
  requestPorts = {},
  revisionPort,
  sessionPort = {},
  tabLifecyclePort = {},
  uiPort = {},
} = {}) {
  const viewRequests = requestPorts.view || createLatestRequestController();
  const branchRequests = requestPorts.branch || createLatestRequestController();
  const diskRequests = requestPorts.disk || createLatestRequestController();
  const monotonicNow = clock.monotonicNow || defaultMonotonicNow;
  const nowIso = clock.nowIso || defaultNowIso;
  const showStatus = uiPort.status || (() => {});
  const showPrompt = uiPort.prompt || (async () => null);

  const replaceExpanded = (next) => {
    folderPort.writeExpanded(next);
    folderPort.updateExpanded(() => next);
    return next;
  };

  const updateExpanded = (updater) => {
    const previous = folderPort.readExpanded() || {};
    return replaceExpanded(updater(previous));
  };

  const refreshFolder = async () => {
    const targetPath = folderPort.readPath();
    if (!targetPath) return undefined;
    const request = viewRequests.begin("view");
    try {
      const result = await ioPort.listFolder(targetPath);
      if (
        !viewRequests.isCurrent(request)
        || !sameDocumentPath(folderPort.readPath(), targetPath)
      ) {
        return undefined;
      }
      if (result?.canceled) throw new Error("文件树刷新超时");
      folderPort.updateState((previous) => ({
        rootPath: previous.rootPath || result.folderPath || targetPath,
        ...folderListing(result, targetPath),
      }));
      return result;
    } catch (error) {
      if (
        viewRequests.isCurrent(request)
        && sameDocumentPath(folderPort.readPath(), targetPath)
      ) {
        folderPort.updateState((previous) => ({
          ...previous,
          loading: false,
          error: error?.message || "文件树刷新失败",
        }));
      }
      return undefined;
    } finally {
      viewRequests.finish(request);
    }
  };

  const refreshTreeAfterEntryChange = async (path = "") => {
    await refreshFolder();
    if (!path || !folderPort.readExpanded()?.[path]?.expanded) return undefined;
    const request = branchRequests.begin(path);
    try {
      const result = await ioPort.listFolder(path);
      if (!branchRequests.isCurrent(request)) return undefined;
      if (result?.canceled) throw new Error("文件夹读取超时");
      updateExpanded((state) => {
        if (!state[path]?.expanded) return state;
        return {
          ...state,
          [path]: {
            ...state[path],
            loading: false,
            error: "",
            entries: folderEntries(result),
          },
        };
      });
      return result;
    } catch (error) {
      if (!branchRequests.isCurrent(request)) return undefined;
      updateExpanded((state) => {
        if (!state[path]?.expanded) return state;
        return {
          ...state,
          [path]: {
            ...state[path],
            loading: false,
            error: error?.message || "文件夹读取失败",
          },
        };
      });
      return undefined;
    } finally {
      branchRequests.finish(request);
    }
  };

  const chooseFolder = async () => {
    const request = viewRequests.begin("view");
    try {
      const result = await ioPort.openFolder();
      if (!viewRequests.isCurrent(request) || result?.canceled) return undefined;
      const nextPath = result.folderPath || "";
      folderPort.writePath(nextPath);
      branchRequests.invalidateAll();
      folderPort.writeExpanded({});
      folderPort.updateState(() => ({
        rootPath: nextPath,
        ...folderListing(result, nextPath),
      }));
      folderPort.updateExpanded(() => ({}));
      showStatus("文件夹已打开", "success");
      return result;
    } catch (error) {
      if (viewRequests.isCurrent(request)) {
        showStatus(error?.message || "文件夹打开失败", "warning");
      }
      return undefined;
    } finally {
      viewRequests.finish(request);
    }
  };

  const navigateFolder = async (path) => {
    if (!path) return undefined;
    const request = viewRequests.begin("view");
    folderPort.writePath(path);
    folderPort.updateState((previous) => ({
      ...previous,
      path,
      loading: true,
      error: "",
    }));
    try {
      const result = await ioPort.listFolder(path);
      if (!viewRequests.isCurrent(request)) return undefined;
      if (result?.canceled) throw new Error("无法打开这个文件夹");
      const nextPath = result.folderPath || path;
      folderPort.writePath(nextPath);
      branchRequests.invalidateAll();
      folderPort.writeExpanded({});
      folderPort.updateState((previous) => ({
        rootPath: previous.rootPath || nextPath,
        ...folderListing(result, path),
      }));
      folderPort.updateExpanded(() => ({}));
      return result;
    } catch (error) {
      if (!viewRequests.isCurrent(request)) return undefined;
      folderPort.updateState((previous) => ({
        ...previous,
        loading: false,
        error: error?.message || "文件夹读取失败",
      }));
      showStatus(error?.message || "无法打开这个文件夹", "warning");
      return undefined;
    } finally {
      viewRequests.finish(request);
    }
  };

  const toggleFolder = async (path) => {
    if (!path) return undefined;
    const existing = folderPort.readExpanded()?.[path];
    if (existing?.expanded) {
      branchRequests.invalidate(path);
      updateExpanded((state) => ({
        ...state,
        [path]: {
          ...(state[path] || existing),
          expanded: false,
          loading: false,
        },
      }));
      return undefined;
    }

    const request = branchRequests.begin(path);
    updateExpanded((state) => ({
      ...state,
      [path]: {
        ...(state[path] || {}),
        expanded: true,
        loading: true,
        error: "",
      },
    }));
    try {
      const result = await ioPort.listFolder(path);
      if (!branchRequests.isCurrent(request)) return undefined;
      if (result?.canceled) throw new Error("文件夹读取超时");
      updateExpanded((state) => {
        if (!state[path]?.expanded) return state;
        return {
          ...state,
          [path]: {
            ...state[path],
            loading: false,
            error: "",
            entries: folderEntries(result),
          },
        };
      });
      return result;
    } catch (error) {
      if (!branchRequests.isCurrent(request)) return undefined;
      updateExpanded((state) => {
        if (!state[path]?.expanded) return state;
        return {
          ...state,
          [path]: {
            ...state[path],
            loading: false,
            error: error?.message || "文件夹读取失败",
          },
        };
      });
      return undefined;
    } finally {
      branchRequests.finish(request);
    }
  };

  const newDocument = (groupId) => {
    const tabId = documentPort.addOrActivate(
      factories.createBlank(),
      "",
      false,
      groupId ? { groupId } : {},
    );
    if (!tabId) return undefined;
    showStatus("已新建空白信笺", "success");
    return tabId;
  };

  const openDocument = async () => {
    const result = await ioPort.openDocument();
    if (result?.canceled) return undefined;
    const tabId = documentPort.addOrActivate(
      result.document,
      result.path,
      false,
      {
        diskRevision: result.diskRevision,
        readOnly: result.readOnly,
      },
    );
    if (!tabId) return undefined;
    showStatus("文档已打开", "success");
    return tabId;
  };

  const importDocument = async () => {
    const result = await ioPort.importDocument();
    if (result?.canceled || !result?.document) return undefined;
    const tabId = documentPort.addOrActivate(
      result.document,
      "",
      true,
      { replaceBlank: true },
    );
    if (!tabId) return undefined;
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    showStatus(
      warnings.length
        ? `文档已导入；${warnings.length} 项内容已降级，保存后才会生成 .letterpaper`
        : "文档已导入；保存后才会生成 .letterpaper",
      warnings.length ? "warning" : "success",
    );
    return tabId;
  };

  const openDocumentPath = async (path) => {
    const current = documentPort.read();
    const existingTab = current.tabs.find((tab) => sameDocumentPath(tab.path, path));
    if (existingTab) {
      if (existingTab.id !== current.activeTabId) {
        documentPort.selectTab(existingTab.id);
      }
      return existingTab.id;
    }
    const startedAt = monotonicNow();
    showStatus("正在打开文档...", "success");
    const result = await ioPort.openDocumentPath(path);
    ioPort.debugLog?.("renderer:document:open-path:return", {
      path,
      canceled: Boolean(result?.canceled),
      hasDocument: Boolean(result?.document),
      ipcMs: Math.round(monotonicNow() - startedAt),
    });
    if (result?.canceled || !result?.document) {
      showStatus(
        result?.error ? `打开失败：${result.error}` : "这个文件不是笺间文档",
        "warning",
      );
      return undefined;
    }
    const tabId = documentPort.addOrActivate(
      result.document,
      result.path,
      false,
      {
        diskRevision: result.diskRevision,
        readOnly: result.readOnly,
      },
    );
    if (!tabId) {
      showStatus("标签栏已满，请先关闭一个信笺再打开文档", "warning");
      return undefined;
    }
    showStatus("文档已打开", "success");
    return tabId;
  };

  const createFolder = async (entry, interaction = {}) => {
    const parentPath = entry?.path || folderPort.readState().path;
    if (!parentPath) return undefined;
    const name = await showPrompt({
      title: "新建子文件夹",
      label: "文件夹名称",
      defaultValue: "新建文件夹",
      confirmLabel: "新建",
      icon: uiPort.icons?.folderPlus,
      returnFocusElement: interaction.returnFocusElement,
    });
    if (!name?.trim()) return undefined;
    const result = await ioPort.createFolder(parentPath, name);
    if (!result?.ok) {
      showStatus(result?.message || "新建文件夹失败", "warning");
      return undefined;
    }
    await refreshTreeAfterEntryChange(parentPath);
    showStatus("文件夹已新建", "success");
    return result;
  };

  const createDocument = async (entry, interaction = {}) => {
    const path = entry?.path || folderPort.readState().path;
    if (!path) return undefined;
    const title = await showPrompt({
      title: "新建信笺",
      label: "信笺名称",
      defaultValue: "未命名信笺",
      confirmLabel: "新建",
      icon: uiPort.icons?.filePlus,
      returnFocusElement: interaction.returnFocusElement,
    });
    if (!title?.trim()) return undefined;
    const blank = factories.createBlank();
    const result = await ioPort.createDocumentInFolder(path, title, blank);
    if (!result?.ok) {
      showStatus(result?.message || "新建信笺失败", "warning");
      return undefined;
    }
    await refreshTreeAfterEntryChange(path);
    const tabId = documentPort.addOrActivate(
      result.document || { ...blank, title: title.trim() },
      result.path,
      false,
      { diskRevision: result.diskRevision },
    );
    if (!tabId) {
      showStatus("信笺已创建；标签栏已满，请关闭一个标签后从文件夹打开", "warning");
      return result;
    }
    showStatus("信笺已新建", "success");
    return result;
  };

  const rebaseFolderView = (oldPath, nextPath) => {
    if (pathIsSameOrInside(folderPort.readPath(), oldPath)) {
      viewRequests.invalidate("view");
      folderPort.writePath(replacePathPrefix(folderPort.readPath(), oldPath, nextPath));
    }
    folderPort.updateState((previous) => (
      pathIsSameOrInside(previous.path, oldPath)
        ? {
          ...previous,
          path: replacePathPrefix(previous.path, oldPath, nextPath),
        }
        : previous
    ));
    branchRequests.invalidateAll();
    updateExpanded((previous) => Object.fromEntries(
      Object.entries(previous).map(([path, value]) => [
        pathIsSameOrInside(path, oldPath)
          ? replacePathPrefix(path, oldPath, nextPath)
          : path,
        value,
      ]),
    ));
  };

  const renameEntry = async (entry, interaction = {}) => {
    if (!entry?.path) return undefined;
    const fallbackFolderPath = folderPort.readState().path;
    const currentName = entry.type === "file"
      ? (entry.displayName || entry.name.replace(/\.[^.]+$/, ""))
      : entry.name;
    const nextName = await showPrompt({
      title: "重命名",
      label: entry.type === "file" ? "信笺名称" : "文件夹名称",
      defaultValue: currentName,
      confirmLabel: "保存",
      icon: uiPort.icons?.pencil,
      returnFocusElement: interaction.returnFocusElement,
    });
    if (!nextName?.trim() || nextName.trim() === currentName) return undefined;
    const result = await ioPort.renameEntry(entry.path, nextName);
    if (!result?.ok) {
      showStatus(result?.message || "重命名失败", "warning");
      return undefined;
    }

    const updatedAt = nowIso();
    if (entry.type === "file") {
      documentPort.read().tabs
        .filter((tab) => sameDocumentPath(tab.path, entry.path))
        .forEach((tab) => documentPort.recordMutation(tab.id, updatedAt));
    }
    const nextTabs = documentPort.read().tabs.map((tab) => {
      if (!pathIsSameOrInside(tab.path, entry.path)) return tab;
      return {
        ...tab,
        path: replacePathPrefix(tab.path, entry.path, result.path),
        ...(entry.type === "file" ? {
          title: nextName.trim(),
          document: {
            ...tab.document,
            title: nextName.trim(),
            updatedAt,
          },
          dirty: true,
        } : {}),
      };
    });
    documentPort.commitTabs(nextTabs);
    if (pathIsSameOrInside(documentPort.read().currentPath, entry.path)) {
      const nextCurrentPath = replacePathPrefix(
        documentPort.read().currentPath,
        entry.path,
        result.path,
      );
      documentPort.commitCurrentPath(nextCurrentPath);
      if (entry.type === "file") {
        documentPort.commitDocument({
          ...documentPort.read().document,
          title: nextName.trim(),
          updatedAt,
        });
      }
      sessionPort.commitPatch?.({ activePath: nextCurrentPath });
    }
    if (entry.type === "folder") {
      rebaseFolderView(entry.path, result.path);
    }
    await refreshTreeAfterEntryChange(result.folderPath || fallbackFolderPath);
    showStatus("已重命名", "success");
    return result;
  };

  const backupDocument = async (entry) => {
    if (!entry?.path || entry.type !== "file") return undefined;
    const sourceTab = documentPort.snapshotTabs({ includeEditorJson: true })
      .find((tab) => sameDocumentPath(tab.path, entry.path));
    if (sourceTab?.dirty) {
      showStatus(
        "请先保存这篇信笺，再复制备份，以便为原件和副本建立稳定身份",
        "warning",
      );
      return undefined;
    }
    const fallbackFolderPath = folderPort.readState().path;
    const result = await ioPort.backupDocument(entry.path);
    if (!result?.ok) {
      showStatus(result?.message || "备份失败", "warning");
      return undefined;
    }
    if (sourceTab && result.sourceDocument && result.sourceDiskRevision) {
      const nextTabs = documentPort.read().tabs.map((tab) => {
        if (tab.id !== sourceTab.id) return tab;
        const document = factories.mergePersistedIdentity(
          tab.document,
          result.sourceDocument,
        );
        revisionPort.commitDiskRevision(tab.id, result.sourceDiskRevision);
        return {
          ...tab,
          document,
          diskRevision: result.sourceDiskRevision,
        };
      });
      documentPort.commitTabs(nextTabs);
      if (sourceTab.id === documentPort.read().activeTabId) {
        documentPort.commitDocument(factories.mergePersistedIdentity(
          documentPort.read().document,
          result.sourceDocument,
        ));
      }
      sessionPort.commitPatch?.({ tabs: factories.summarizeTabs(nextTabs) });
    }
    await refreshTreeAfterEntryChange(result.folderPath || fallbackFolderPath);
    showStatus("备份已复制到当前目录", "success");
    return result;
  };

  const deleteOnDisk = async (entry) => {
    if (!entry?.path) return undefined;
    const result = await ioPort.deleteEntry(entry.path);
    if (!result?.ok) {
      showStatus(result?.message || "删除失败", "warning");
      return undefined;
    }
    return result;
  };

  const commitDeleteResult = async ({
    entry,
    fallbackFolderPath = "",
    result,
    snapshot = [],
  } = {}) => {
    if (!entry?.path || !result?.ok) return undefined;
    const removedTabs = snapshot.filter((tab) => pathIsSameOrInside(tab.path, entry.path));
    if (removedTabs.length) {
      let remainingTabs = snapshot.filter(
        (tab) => !pathIsSameOrInside(tab.path, entry.path),
      );
      const rightSplitTabId = groupPort.read?.().rightSplitTabId;
      if (
        rightSplitTabId
        && removedTabs.some((tab) => tab.id === rightSplitTabId)
      ) {
        groupPort.clearRightSplit();
        groupPort.commitActivePane("main");
      }
      if (!remainingTabs.length) {
        remainingTabs = [factories.createTab(factories.createBlank())];
      }
      documentPort.commitTabs(remainingTabs);
      removedTabs.forEach((tab) => tabLifecyclePort.releaseRuntime?.(tab.id));
      if (removedTabs.some((tab) => tab.id === documentPort.read().activeTabId)) {
        const nextTab = remainingTabs[0];
        documentPort.commitActiveTab(nextTab.id);
        documentPort.applyDocument(
          nextTab.document,
          nextTab.path,
          nextTab.dirty,
          {
            editorJson: nextTab.editorJson,
            scrollState: nextTab.scrollState,
          },
        );
        sessionPort.commitPatch?.({
          activePath: nextTab.path || nextTab.recoveryPath || "",
        });
      }
    }
    await refreshTreeAfterEntryChange(
      result.folderPath || fallbackFolderPath || folderPort.readState().path,
    );
    showStatus("已删除", "success");
    return result;
  };

  const deleteEntry = async (entry, {
    fallbackFolderPath = folderPort.readState().path,
    snapshot = [],
  } = {}) => {
    const result = await deleteOnDisk(entry);
    if (!result) return undefined;
    return commitDeleteResult({
      entry,
      fallbackFolderPath,
      result,
      snapshot,
    });
  };

  const moveEntry = async (entry, targetFolderPath) => {
    if (!entry?.path || !targetFolderPath) return undefined;
    const fallbackFolderPath = folderPort.readState().path;
    const result = await ioPort.moveEntry(entry.path, targetFolderPath);
    if (!result?.ok) {
      showStatus(result?.message || "移动失败", "warning");
      return undefined;
    }
    const nextTabs = documentPort.read().tabs.map((tab) => (
      pathIsSameOrInside(tab.path, result.oldPath)
        ? {
          ...tab,
          path: replacePathPrefix(tab.path, result.oldPath, result.path),
        }
        : tab
    ));
    documentPort.commitTabs(nextTabs);
    if (pathIsSameOrInside(documentPort.read().currentPath, result.oldPath)) {
      const nextPath = replacePathPrefix(
        documentPort.read().currentPath,
        result.oldPath,
        result.path,
      );
      documentPort.commitCurrentPath(nextPath);
      sessionPort.commitPatch?.({ activePath: nextPath });
    }
    if (entry.type === "folder") {
      rebaseFolderView(result.oldPath, result.path);
    }
    await refreshTreeAfterEntryChange(result.sourceParent || fallbackFolderPath);
    await refreshTreeAfterEntryChange(result.targetFolderPath || targetFolderPath);
    showStatus("已移动", "success");
    return result;
  };

  const verifyOpenDocuments = async () => {
    const request = diskRequests.begin("open-documents");
    const checks = documentPort.snapshotTabs()
      .filter((tab) => tab.path)
      .map((tab) => ({
        id: tab.id,
        path: tab.path,
        expected: revisionPort.readDiskRevision(tab.id) || tab.diskRevision || null,
      }));
    const outcomes = await Promise.all(checks.map(async (check) => {
      try {
        const result = await ioPort.getDocumentRevision(check.path);
        return {
          ...check,
          actual: result?.diskRevision || null,
          failed: false,
        };
      } catch {
        return {
          ...check,
          actual: null,
          failed: true,
        };
      }
    }));
    if (!diskRequests.isCurrent(request)) return new Set();

    const outcomeById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
    const changedIds = new Set();
    const newlyChangedIds = new Set();
    const nextTabs = documentPort.read().tabs.map((tab) => {
      const outcome = outcomeById.get(tab.id);
      if (!outcome || !sameDocumentPath(tab.path, outcome.path)) return tab;
      const currentExpected = revisionPort.readDiskRevision(tab.id)
        || tab.diskRevision
        || null;
      const expectedStillCurrent = outcome.expected
        ? Boolean(
          currentExpected
          && sameDiskRevision(currentExpected, outcome.expected),
        )
        : !currentExpected;
      if (!expectedStillCurrent) return tab;
      if (!outcome.expected && outcome.actual && !outcome.failed) {
        revisionPort.commitDiskRevision(tab.id, outcome.actual);
      }
      const externalChanged = Boolean(
        outcome.expected
        && (
          outcome.failed
          || !sameDiskRevision(outcome.actual, outcome.expected)
        ),
      );
      if (externalChanged) {
        changedIds.add(tab.id);
        if (!tab.externalChanged) newlyChangedIds.add(tab.id);
      }
      return tab.externalChanged === externalChanged
        ? tab
        : { ...tab, externalChanged };
    });
    documentPort.commitTabs(nextTabs);
    diskRequests.finish(request);
    const activeId = groupPort.read?.().focusedDocumentTabId
      || documentPort.read().activeTabId;
    if (newlyChangedIds.has(activeId)) {
      showStatus(
        "检测到磁盘上的外部版本；保存时会保护两个版本",
        "warning",
      );
    }
    return changedIds;
  };

  const restoreSessionFolder = async ({
    commitSessionPatch = sessionPort.commitPatch,
    isActiveRestore = () => true,
    savedFolderPath = "",
  } = {}) => {
    let path = savedFolderPath;
    let defaultFolderPath = "";
    if (!path) {
      try {
        const paths = await ioPort.getPaths();
        defaultFolderPath = paths?.documents || "";
        path = defaultFolderPath;
      } catch {
        path = "";
      }
    }
    if (!path) return undefined;

    const request = viewRequests.begin("view");
    folderPort.writePath(path);
    ioPort.debugLog?.("renderer:restore:folder-selected", {
      folderPath: path,
      source: savedFolderPath ? "session" : "documents-default",
    });
    if (isActiveRestore() && viewRequests.isCurrent(request)) {
      folderPort.updateState((previous) => ({
        ...previous,
        rootPath: previous.rootPath || path,
        path,
        loading: true,
      }));
    }
    try {
      const result = await ioPort.listFolder(path);
      if (
        isActiveRestore()
        && viewRequests.isCurrent(request)
        && !result?.canceled
      ) {
        ioPort.debugLog?.("renderer:restore:folder-applied", {
          folderPath: path,
          folders: result.folders?.length || 0,
          files: result.files?.length || 0,
        });
        const restoredFolderPath = result.folderPath || path;
        folderPort.writePath(restoredFolderPath);
        folderPort.updateState(() => ({
          rootPath: path,
          ...folderListing(result, path),
        }));
      } else if (isActiveRestore() && viewRequests.isCurrent(request)) {
        throw new Error("folder list canceled");
      }
    } catch (error) {
      ioPort.debugLog?.("renderer:restore:folder-fallback", {
        folderPath: path,
        message: error?.message,
      });
      if (isActiveRestore() && viewRequests.isCurrent(request)) {
        try {
          const paths = defaultFolderPath
            ? { documents: defaultFolderPath }
            : await ioPort.getPaths();
          const fallbackPath = paths?.documents || "";
          const fallback = fallbackPath
            ? await ioPort.listFolder(fallbackPath)
            : null;
          if (!viewRequests.isCurrent(request)) {
            // A newer folder navigation owns the tree now.
          } else if (fallbackPath && !fallback?.canceled) {
            const nextPath = fallback.folderPath || fallbackPath;
            folderPort.writePath(nextPath);
            folderPort.updateState(() => ({
              rootPath: nextPath,
              ...folderListing(fallback, fallbackPath),
            }));
            commitSessionPatch?.({
              folderPath: nextPath,
              activePath: "",
            });
          } else {
            folderPort.writePath(path);
            folderPort.updateState(() => ({
              rootPath: path,
              path,
              parentPath: "",
              files: [],
              folders: [],
              entries: [],
              loading: false,
              error: "文件树读取超时或失败",
            }));
          }
        } catch {
          if (viewRequests.isCurrent(request)) {
            folderPort.writePath(path);
            folderPort.updateState(() => ({
              rootPath: path,
              path,
              parentPath: "",
              files: [],
              folders: [],
              entries: [],
              loading: false,
              error: "文件树读取超时或失败",
            }));
          }
        }
      }
    } finally {
      viewRequests.finish(request);
    }
    return undefined;
  };

  const searchWorkspace = async ({
    limit = 100,
    query,
    requestId,
    rootPath,
  }) => {
    const overrides = documentPort.snapshotTabs()
      .filter((tab) => tab.path && tab.dirty)
      .map((tab) => ({
        path: tab.path,
        document: tab.document,
      }));
    const result = await ioPort.searchFolder({
      folderPath: rootPath,
      query,
      requestId,
      overrides,
      limit,
    });
    if (result?.canceled) return result;
    return {
      ...result,
      results: (result?.results || []).map((item) => ({
        ...item,
        query: result?.query || query,
        snippetRanges: item.snippetMatchStart >= 0
          ? [{
            from: item.snippetMatchStart,
            to: item.snippetMatchStart + item.snippetMatchLength,
          }]
          : [],
      })),
    };
  };

  const cancelWorkspaceSearch = (rootPath, requestId) => (
    ioPort.cancelFolderSearch?.(rootPath, requestId)
  );

  const watchWorkspace = (rootPath) => ioPort.watchWorkspace?.(rootPath || "");

  const handleWorkspaceChanged = (payload = {}, rootPath = "") => {
    if (
      payload.rootPath
      && !sameDocumentPath(payload.rootPath, rootPath)
    ) {
      return false;
    }
    refreshFolder();
    verifyOpenDocuments();
    return true;
  };

  return Object.freeze({
    lifecyclePort: Object.freeze({
      cancelWorkspaceSearch,
      handleWorkspaceChanged,
      restoreSessionFolder,
      searchWorkspace,
      verifyOpenDocuments,
      watchWorkspace,
    }),
    mutationPort: Object.freeze({
      backupDocument,
      commitDeleteResult,
      createDocument,
      createFolder,
      deleteEntry,
      deleteOnDisk,
      moveEntry,
      renameEntry,
    }),
    navigationPort: Object.freeze({
      chooseFolder,
      navigateFolder,
      refreshFolder,
      refreshTreeAfterEntryChange,
      toggleFolder,
    }),
    openPort: Object.freeze({
      importDocument,
      newDocument,
      openDocument,
      openDocumentPath,
    }),
  });
}
