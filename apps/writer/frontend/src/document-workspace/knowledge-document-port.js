import { useMemo, useRef } from "react";
import {
  createDocumentId,
  normalizeDocumentId,
  normalizeDocumentSchemaV2,
} from "../document-schema-v2.js";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  findWorkspaceView,
  getActiveWorkspaceView,
} from "../workspace-groups.js";
import { sameDocumentPath } from "../editor-lifecycle.js";
import { normalizeDocument } from "./model.js";

export function createKnowledgeDocumentPort({
  activePane,
  activeTabIdRef,
  activeWorkReadOnly,
  currentPathRef,
  dirtyRef,
  documentRevisionPort,
  documentStateRef,
  editor,
  handleOpenFolderFile,
  letterTemplates,
  openTabsRef,
  recordTabMutation,
  rightSplitDocument,
  rightSplitEditor,
  rightSplitTabIdRef,
  setActivePane,
  setDocumentState,
  setOpenTabs,
  showStatus,
  snapshotLiveTabs,
  splitPaneActive,
  workspaceGroupsRef,
  writingWorkspaceRootRef,
}) {
  const getActiveContext = ({ management = false, targetEditor = null } = {}) => {
    const state = workspaceGroupsRef.current;
    const secondaryView = getActiveWorkspaceView(state, WORKSPACE_GROUP_ID.SECONDARY);
    let groupId;
    if (targetEditor) {
      groupId = targetEditor === rightSplitEditor ? WORKSPACE_GROUP_ID.SECONDARY : WORKSPACE_GROUP_ID.PRIMARY;
    } else if (management) {
      groupId = activePane === "right" && secondaryView?.kind === WORKSPACE_VIEW_KIND.DOCUMENT
        ? WORKSPACE_GROUP_ID.SECONDARY
        : WORKSPACE_GROUP_ID.PRIMARY;
    } else {
      groupId = activePane === "right" ? WORKSPACE_GROUP_ID.SECONDARY : WORKSPACE_GROUP_ID.PRIMARY;
    }
    const view = getActiveWorkspaceView(state, groupId);
    if (!view || view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT) return null;
    const target = groupId === WORKSPACE_GROUP_ID.SECONDARY ? rightSplitEditor : editor;
    const tab = openTabsRef.current.find((candidate) => candidate.id === view.tabId);
    if (!target || !tab) return null;
    if (groupId === WORKSPACE_GROUP_ID.PRIMARY && activeTabIdRef.current !== tab.id) return null;
    if (groupId === WORKSPACE_GROUP_ID.SECONDARY && rightSplitTabIdRef.current !== tab.id) return null;
    const document = groupId === WORKSPACE_GROUP_ID.PRIMARY ? documentStateRef.current : tab.document;
    return {
      document,
      editor: target,
      groupId,
      readOnly: Boolean(tab.readOnly || document?._readOnlyFutureSchema),
      tab,
      view,
    };
  };

  const updateActive = (updater) => {
    if (activeWorkReadOnly) {
      showStatus("未来格式信笺为只读，不能修改脚注、引用或关联", "warning");
      return null;
    }
    const editingRightPane = splitPaneActive && rightSplitTabIdRef.current;
    const previous = editingRightPane
      ? (openTabsRef.current.find((tab) => tab.id === rightSplitTabIdRef.current)?.document || rightSplitDocument)
      : documentStateRef.current;
    if (!previous) return null;
    const wasLegacy = Number(previous?.version || 1) < 2;
    const upgraded = normalizeDocumentSchemaV2(previous || {});
    const updatedAt = new Date().toISOString();
    const candidate = typeof updater === "function" ? updater(upgraded) : { ...upgraded, ...(updater || {}) };
    const nextDocument = normalizeDocumentSchemaV2({ ...candidate, updatedAt });
    if (editingRightPane) {
      const tabId = rightSplitTabIdRef.current;
      const nextTabs = openTabsRef.current.map((tab) => (
        tab.id === tabId ? { ...tab, document: nextDocument, title: nextDocument.title || tab.title, dirty: true } : tab
      ));
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
      recordTabMutation(tabId, updatedAt);
    } else {
      documentStateRef.current = nextDocument;
      setDocumentState(nextDocument);
      recordTabMutation(activeTabIdRef.current, updatedAt);
    }
    if (wasLegacy) showStatus("已启用文档格式 v2；首次保存时会保留迁移前备份", "success");
    return nextDocument;
  };

  const captureTarget = (management) => {
    const context = getActiveContext({ management });
    if (!context || context.readOnly) return null;
    const selection = context.editor.state.selection;
    return {
      requestId: createDocumentId(),
      groupId: context.groupId,
      documentTabId: context.tab.id,
      selection: { from: selection.from, to: selection.to },
      revision: documentRevisionPort.readLiveRevision(context.tab.id),
      workspaceRoot: writingWorkspaceRootRef.current || "",
    };
  };

  const captureInsertTarget = () => captureTarget(false);
  const captureManagementTarget = () => captureTarget(true);

  const resolveTarget = (target, options = {}) => {
    if (!target?.documentTabId) return null;
    if ((target.workspaceRoot || "") !== (writingWorkspaceRootRef.current || "")) return null;
    const state = workspaceGroupsRef.current;
    const location = findWorkspaceView(state, target.documentTabId);
    if (!location || location.groupId !== target.groupId || location.view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT) return null;
    if (state[location.groupId]?.activeViewId !== location.view.viewId) return null;
    const tab = openTabsRef.current.find((candidate) => candidate.id === target.documentTabId);
    if (!tab || tab.readOnly || tab.document?._readOnlyFutureSchema) return null;
    if (
      !options.allowRevisionChange
      && documentRevisionPort.readLiveRevision(tab.id) !== target.revision
    ) return null;
    const targetEditor = location.groupId === WORKSPACE_GROUP_ID.SECONDARY ? rightSplitEditor : editor;
    if (!targetEditor) return null;
    if (location.groupId === WORKSPACE_GROUP_ID.PRIMARY && activeTabIdRef.current !== tab.id) return null;
    if (location.groupId === WORKSPACE_GROUP_ID.SECONDARY && rightSplitTabIdRef.current !== tab.id) return null;
    const maxPosition = targetEditor.state.doc.content.size;
    const from = Math.max(0, Math.min(maxPosition, Number(target.selection?.from) || targetEditor.state.selection.from));
    const to = Math.max(from, Math.min(maxPosition, Number(target.selection?.to) || from));
    const document = location.groupId === WORKSPACE_GROUP_ID.PRIMARY ? documentStateRef.current : tab.document;
    return {
      document,
      editor: targetEditor,
      groupId: location.groupId,
      selection: { from, to },
      tab,
      view: location.view,
    };
  };

  const updateTarget = (target, updater, options = {}) => {
    const resolved = resolveTarget(target, options);
    if (!resolved) return null;
    const { groupId, tab } = resolved;
    const previous = groupId === WORKSPACE_GROUP_ID.PRIMARY ? documentStateRef.current : tab.document;
    if (!previous) return null;
    const wasLegacy = Number(previous?.version || 1) < 2;
    const upgraded = normalizeDocumentSchemaV2(previous);
    const updatedAt = new Date().toISOString();
    const candidate = typeof updater === "function" ? updater(upgraded) : { ...upgraded, ...(updater || {}) };
    const nextDocument = normalizeDocumentSchemaV2({ ...candidate, updatedAt });
    if (groupId === WORKSPACE_GROUP_ID.PRIMARY) {
      documentStateRef.current = nextDocument;
      setDocumentState(nextDocument);
    }
    const nextTabs = openTabsRef.current.map((item) => item.id === tab.id
      ? { ...item, document: nextDocument, title: nextDocument.title || item.title, dirty: true }
      : item);
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    recordTabMutation(tab.id, updatedAt);
    if (wasLegacy) showStatus("已启用文档格式 v2；首次保存时会保留迁移前备份", "success");
    return { ...resolved, document: nextDocument };
  };

  const insertAt = (resolved, content) => {
    if (!resolved?.editor) return false;
    const { from, to } = resolved.selection;
    return resolved.editor.chain().focus().insertContentAt(from === to ? from : { from, to }, content).run();
  };

  const ensureImageReferenceDocument = (targetEditor) => {
    const editingRightPane = targetEditor === rightSplitEditor;
    const tabId = editingRightPane ? rightSplitTabIdRef.current : activeTabIdRef.current;
    const tab = openTabsRef.current.find((item) => item.id === tabId);
    const previous = editingRightPane ? tab?.document : documentStateRef.current;
    if (!previous || tab?.readOnly || previous._readOnlyFutureSchema) {
      throw new Error("当前信笺为只读，不能复制图片引用");
    }
    if (Number(previous.version || 1) >= 2 && normalizeDocumentId(previous.documentId)) return previous;
    const updatedAt = new Date().toISOString();
    const nextDocument = normalizeDocumentSchemaV2({ ...previous, updatedAt });
    if (editingRightPane) {
      const nextTabs = openTabsRef.current.map((item) => item.id === tabId
        ? { ...item, document: nextDocument, title: nextDocument.title || item.title, dirty: true }
        : item);
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
    } else {
      documentStateRef.current = nextDocument;
      setDocumentState(nextDocument);
    }
    recordTabMutation(tabId, updatedAt);
    showStatus("已启用文档格式 v2；首次保存时会保留迁移前备份", "success");
    return nextDocument;
  };

  const editorForDom = (editorDom) => {
    if (editorDom && editorDom === rightSplitEditor?.view?.dom) return rightSplitEditor;
    if (editorDom && editorDom === editor?.view?.dom) return editor;
    return null;
  };

  const contextForDom = (editorDom, { fallbackToPrimary = false } = {}) => {
    const targetEditor = editorForDom(editorDom) || (fallbackToPrimary ? editor : null);
    return targetEditor ? getActiveContext({ targetEditor }) : null;
  };

  const activateEditor = (targetEditor) => {
    setActivePane(targetEditor === rightSplitEditor ? "right" : "main");
  };

  const focusAt = (position, targetEditor = null) => {
    const selectedEditor = targetEditor || getActiveContext({ management: true })?.editor;
    if (!selectedEditor || !Number.isFinite(position)) return false;
    const selectionPosition = Math.max(0, Math.min(selectedEditor.state.doc.content.size, Number(position) + 1));
    activateEditor(selectedEditor);
    selectedEditor.chain().focus().setTextSelection(selectionPosition).scrollIntoView().run();
    return true;
  };

  const findOpenDocumentByPath = (path) => (
    openTabsRef.current.find((tab) => sameDocumentPath(tab.path, path)) || null
  );

  const reconcileIdentityResult = (result) => {
    if (!result?.path || !result?.documentId) return;
    const nextTabs = openTabsRef.current.map((tab) => {
      if (!sameDocumentPath(tab.path, result.path) || tab.dirty) return tab;
      documentRevisionPort.commitDiskRevision(
        tab.id,
        result.diskRevision || tab.diskRevision || null,
      );
      return {
        ...tab,
        document: result.document || {
          ...tab.document,
          version: 2,
          documentId: result.documentId,
          derivedFrom: result.document?.derivedFrom || tab.document?.derivedFrom || "",
          footnotes: tab.document?.footnotes || [],
          citationSources: tab.document?.citationSources || [],
        },
        diskRevision: result.diskRevision || tab.diskRevision,
      };
    });
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    if (sameDocumentPath(currentPathRef.current, result.path) && !dirtyRef.current) {
      const nextDocument = normalizeDocument(
        result.document || { ...documentStateRef.current, version: 2, documentId: result.documentId },
        letterTemplates,
      );
      documentStateRef.current = nextDocument;
      setDocumentState(nextDocument);
      if (result.diskRevision) {
        documentRevisionPort.commitDiskRevision(
          activeTabIdRef.current,
          result.diskRevision,
        );
      }
    }
  };

  const snapshotDirtyTabs = () => snapshotLiveTabs()
    .filter((tab) => tab.path && tab.dirty)
    .map((tab) => ({ path: tab.path, document: tab.document }));

  return {
    activateEditor,
    captureInsertTarget,
    captureManagementTarget,
    contextForDom,
    editorForDom,
    ensureImageReferenceDocument,
    findOpenDocumentByPath,
    focusAt,
    getActiveContext,
    getWorkspaceRoot: () => writingWorkspaceRootRef.current || "",
    insertAt,
    openDocument: handleOpenFolderFile,
    reconcileIdentityResult,
    resolveTarget,
    snapshotDirtyTabs,
    updateActive,
    updateTarget,
  };
}

export function useKnowledgeDocumentPort(options) {
  const writingWorkspaceRootRef = useRef(options.writingWorkspaceRoot || "");
  writingWorkspaceRootRef.current = options.writingWorkspaceRoot || "";
  return useMemo(() => createKnowledgeDocumentPort({
    ...options,
    writingWorkspaceRootRef,
  }), [
    options.activePane,
    options.activeWorkReadOnly,
    options.editor,
    options.handleOpenFolderFile,
    options.letterTemplates,
    options.recordTabMutation,
    options.rightSplitDocument,
    options.rightSplitEditor,
    options.showStatus,
    options.snapshotLiveTabs,
    options.splitPaneActive,
    options.writingWorkspaceRoot,
  ]);
}
