import { useCallback, useEffect } from "react";
import { bridge } from "../bridge.js";
import {
  collectKnowledgeReferences,
  nextInternalLinkUsage,
} from "../knowledge-extensions.js";
import { sameDocumentPath } from "../editor-lifecycle.js";
import { createEmptyWorkspaceRelationships } from "./knowledge-state.js";

export async function refreshWorkspaceRelationshipsCore({
  bridgeApi = bridge,
  contextKeyRef,
  documentId,
  documentPort,
  editor,
  path,
  requestRef,
  setWorkspaceRelationships,
  showStatus,
}) {
  const requestId = requestRef.current + 1;
  requestRef.current = requestId;
  const requestContextKey = contextKeyRef.current;
  const workspaceRoot = documentPort.getWorkspaceRoot();
  if (!workspaceRoot) {
    const empty = createEmptyWorkspaceRelationships();
    if (requestId === requestRef.current && requestContextKey === contextKeyRef.current) {
      setWorkspaceRelationships(empty);
    }
    return empty;
  }
  try {
    const currentLinks = collectKnowledgeReferences(editor).links;
    const result = await bridgeApi.getWorkspaceRelationships?.({
      folderPath: workspaceRoot,
      currentPath: path,
      documentId: documentId || "",
      currentLinks,
      overrides: documentPort.snapshotDirtyTabs(),
    });
    const normalized = result || createEmptyWorkspaceRelationships();
    if (requestId !== requestRef.current || requestContextKey !== contextKeyRef.current) {
      return { ...createEmptyWorkspaceRelationships(), stale: true };
    }
    setWorkspaceRelationships(normalized);
    return normalized;
  } catch (error) {
    showStatus(error?.message || "关联索引刷新失败", "warning");
    return createEmptyWorkspaceRelationships();
  }
}

export function invalidateWorkspaceRelationships({
  requestRef,
  setWorkspaceRelationships,
}) {
  requestRef.current += 1;
  const empty = createEmptyWorkspaceRelationships();
  setWorkspaceRelationships(empty);
  return empty;
}

export function useWorkspaceRelationshipActions({
  activeWorkReadOnly,
  documentPort,
  internalLinkPicker,
  knowledgeReferences,
  leftSidebarMode,
  setInternalLinkPicker,
  setLeftSidebarMode,
  setStructureMode,
  setWorkspaceRelationships,
  showStatus,
  structureMode,
  structureWorkDocument,
  structureWorkEditor,
  structureWorkPath,
  workspaceRelationshipContextKey,
  workspaceRelationshipContextRef,
  workspaceRelationshipRequestRef,
  workspaceRelationships,
}) {
  const refreshWorkspaceRelationships = useCallback(
    () => refreshWorkspaceRelationshipsCore({
      contextKeyRef: workspaceRelationshipContextRef,
      documentId: structureWorkDocument?.documentId,
      documentPort,
      editor: structureWorkEditor,
      path: structureWorkPath,
      requestRef: workspaceRelationshipRequestRef,
      setWorkspaceRelationships,
      showStatus,
    }),
    [
      documentPort,
      setWorkspaceRelationships,
      showStatus,
      structureWorkDocument?.documentId,
      structureWorkEditor,
      structureWorkPath,
      workspaceRelationshipContextRef,
      workspaceRelationshipRequestRef,
    ],
  );

  useEffect(() => {
    invalidateWorkspaceRelationships({
      requestRef: workspaceRelationshipRequestRef,
      setWorkspaceRelationships,
    });
  }, [
    setWorkspaceRelationships,
    workspaceRelationshipContextKey,
    workspaceRelationshipRequestRef,
  ]);

  useEffect(() => {
    const relatedPanelActive = leftSidebarMode === "structure" && structureMode === "related";
    if (!relatedPanelActive && !internalLinkPicker) return undefined;
    let timer = window.setTimeout(refreshWorkspaceRelationships, 48);
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refreshWorkspaceRelationships, 120);
    };
    structureWorkEditor?.on("update", refresh);
    const unsubscribe = bridge.onWorkspaceChanged?.(refresh);
    return () => {
      window.clearTimeout(timer);
      structureWorkEditor?.off("update", refresh);
      unsubscribe?.();
    };
  }, [
    internalLinkPicker,
    leftSidebarMode,
    refreshWorkspaceRelationships,
    structureMode,
    structureWorkEditor,
  ]);

  const resolveLinkTargetIdentity = useCallback(async (target, force = false) => {
    if (target?.documentId && !force) return target;
    const openTarget = documentPort.findOpenDocumentByPath(target?.path);
    if (openTarget?.dirty) {
      throw new Error("目标信笺有未保存修改，请先保存后再建立关联");
    }
    const result = await bridge.regenerateDocumentIdentity?.(target?.path, force);
    if (!result?.documentId) throw new Error("无法为目标信笺建立稳定身份");
    documentPort.reconcileIdentityResult(result);
    return { ...target, documentId: result.documentId, needsIdentity: false };
  }, [documentPort]);

  const handleChooseInternalLink = useCallback(async (candidate) => {
    if (!internalLinkPicker) return;
    try {
      if ((internalLinkPicker.workspaceRoot || "") !== documentPort.getWorkspaceRoot()) {
        throw new Error("当前文件区已经切换，请重新选择关联信笺");
      }
      const initial = documentPort.resolveTarget(internalLinkPicker);
      if (!initial) throw new Error("关联选择期间目标信笺已经变化");
      if (Number.isFinite(internalLinkPicker.replacingPosition)) {
        const replacingNode = initial.editor.state.doc.nodeAt(
          internalLinkPicker.replacingPosition,
        );
        if (!replacingNode || replacingNode.type.name !== "paperInternalLink") {
          throw new Error("原关联位置已发生变化");
        }
      }
      const currentCandidate = (workspaceRelationships.documents || []).find((item) => (
        candidate?.documentId && item.documentId
          ? item.documentId === candidate.documentId
          : sameDocumentPath(item.path, candidate?.path)
      ));
      if (!currentCandidate) throw new Error("关联候选已经过期，请重新选择");
      if (
        (currentCandidate.documentId
          && currentCandidate.documentId === initial.document?.documentId)
        || (currentCandidate.path && sameDocumentPath(currentCandidate.path, initial.tab.path))
      ) {
        throw new Error("不能将当前信笺关联到自身");
      }
      const target = await resolveLinkTargetIdentity(currentCandidate);
      const resolved = documentPort.updateTarget(
        internalLinkPicker,
        (document) => document,
      );
      if (!resolved) throw new Error("关联选择期间目标信笺已经变化");
      const nodeContent = {
        type: "paperInternalLink",
        attrs: {
          documentId: target.documentId,
          title: target.title || "未命名信笺",
          label: target.title || "未命名信笺",
          pathHint: target.relativePath || "",
          missing: false,
        },
      };
      if (Number.isFinite(internalLinkPicker.replacingPosition)) {
        const position = internalLinkPicker.replacingPosition;
        const node = resolved.editor.state.doc.nodeAt(position);
        resolved.editor.chain().focus().insertContentAt(
          { from: position, to: position + node.nodeSize },
          nodeContent,
        ).run();
      } else {
        documentPort.insertAt(resolved, nodeContent);
      }
      setInternalLinkPicker(null);
      showStatus("关联信笺已插入", "success");
      window.setTimeout(refreshWorkspaceRelationships, 0);
    } catch (error) {
      showStatus(error?.message || "关联插入失败", "warning");
    }
  }, [
    documentPort,
    internalLinkPicker,
    refreshWorkspaceRelationships,
    resolveLinkTargetIdentity,
    setInternalLinkPicker,
    showStatus,
    workspaceRelationships.documents,
  ]);

  const handleOpenInternalLinkPicker = useCallback(async () => {
    const target = documentPort.captureInsertTarget();
    if (!target) {
      showStatus("请先激活一个可编辑的信笺，再插入关联", "warning");
      return;
    }
    setWorkspaceRelationships(createEmptyWorkspaceRelationships());
    const relationships = await refreshWorkspaceRelationships();
    if (
      relationships?.stale
      || (target.workspaceRoot || "") !== documentPort.getWorkspaceRoot()
    ) {
      showStatus("当前文件区已经切换，请重新插入关联信笺", "warning");
      return;
    }
    if (!documentPort.resolveTarget(target)) {
      showStatus("关联选择期间目标信笺已经变化，请重试", "warning");
      return;
    }
    setInternalLinkPicker({ ...target, direct: true });
  }, [
    documentPort,
    refreshWorkspaceRelationships,
    setInternalLinkPicker,
    setWorkspaceRelationships,
    showStatus,
  ]);

  const handleOpenRelatedDocument = useCallback(async (link) => {
    if (link?.path) {
      await documentPort.openDocument(link.path);
      setLeftSidebarMode("structure");
      setStructureMode("related");
      return;
    }
    showStatus("目标信笺已丢失，可在关联面板中重新关联或移除", "warning");
    setLeftSidebarMode("structure");
    setStructureMode("related");
  }, [documentPort, setLeftSidebarMode, setStructureMode, showStatus]);

  const handleRelinkInternalLink = useCallback(async (link) => {
    const target = documentPort.captureManagementTarget();
    if (!target) {
      showStatus("当前信笺不可编辑，无法重新关联", "warning");
      return;
    }
    await refreshWorkspaceRelationships();
    setInternalLinkPicker({
      ...target,
      replacingPosition: Number(link.position),
    });
  }, [
    documentPort,
    refreshWorkspaceRelationships,
    setInternalLinkPicker,
    showStatus,
  ]);

  const handleRemoveInternalLink = useCallback((link) => {
    if (activeWorkReadOnly) {
      showStatus("当前信笺为只读，不能移除关联", "warning");
      return;
    }
    const position = Number(link?.position);
    const node = Number.isFinite(position)
      ? structureWorkEditor?.state.doc.nodeAt(position)
      : null;
    if (!node || node.type.name !== "paperInternalLink") {
      showStatus("关联位置已经失效", "warning");
      return;
    }
    structureWorkEditor.chain().focus()
      .deleteRange({ from: position, to: position + node.nodeSize })
      .run();
  }, [activeWorkReadOnly, showStatus, structureWorkEditor]);

  const handleJumpInternalLinkUsage = useCallback((link) => {
    const targetDocumentId = link?.targetDocumentId || link?.documentId;
    const usage = nextInternalLinkUsage(
      knowledgeReferences.links,
      targetDocumentId,
      structureWorkEditor?.state?.selection?.from,
    );
    if (
      !Number.isFinite(usage?.position)
      || !documentPort.focusAt(usage.position, structureWorkEditor)
    ) {
      showStatus("正文中的关联位置已经失效", "warning");
      return null;
    }
    return usage;
  }, [
    documentPort,
    knowledgeReferences.links,
    showStatus,
    structureWorkEditor,
  ]);

  const handleRegenerateDuplicateIdentity = useCallback(async (item) => {
    try {
      const result = await resolveLinkTargetIdentity(item, true);
      showStatus(`已为“${item.title || item.relativePath}”生成新身份`, "success");
      documentPort.reconcileIdentityResult(result);
      await refreshWorkspaceRelationships();
    } catch (error) {
      showStatus(error?.message || "生成新身份失败", "warning");
    }
  }, [
    documentPort,
    refreshWorkspaceRelationships,
    resolveLinkTargetIdentity,
    showStatus,
  ]);

  useEffect(() => {
    const handleOpen = async (event) => {
      const relationships = await refreshWorkspaceRelationships();
      const target = (relationships.documents || [])
        .find((item) => item.documentId === event.detail?.documentId);
      if (target?.path) {
        await documentPort.openDocument(target.path);
        setLeftSidebarMode("structure");
        setStructureMode("related");
      } else {
        setLeftSidebarMode("structure");
        setStructureMode("related");
        showStatus("目标信笺已丢失，可重新关联或移除", "warning");
      }
    };
    window.addEventListener("paper-internal-link-open", handleOpen);
    return () => {
      window.removeEventListener("paper-internal-link-open", handleOpen);
    };
  }, [
    documentPort,
    refreshWorkspaceRelationships,
    setLeftSidebarMode,
    setStructureMode,
    showStatus,
  ]);

  return {
    handleChooseInternalLink,
    handleJumpInternalLinkUsage,
    handleOpenInternalLinkPicker,
    handleOpenRelatedDocument,
    handleRelinkInternalLink,
    handleRegenerateDuplicateIdentity,
    handleRemoveInternalLink,
    refreshWorkspaceRelationships,
  };
}
