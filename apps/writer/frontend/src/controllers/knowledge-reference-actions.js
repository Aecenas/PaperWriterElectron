import { useCallback, useEffect } from "react";
import { bridge } from "../bridge.js";
import {
  createDocumentId,
  normalizeCitationSources,
} from "../document-schema-v2.js";
import { removeKnowledgeNodesByAttribute } from "../knowledge-extensions.js";
import { normalizeWorkspaceCitationSources } from "../document-workspace/model.js";

export function useWorkspaceCitationLibrary({
  documentPort,
  setCitationLibraryLoading,
  setWorkspaceCitationSources,
  showStatus,
}) {
  return useCallback(async () => {
    const workspaceRoot = documentPort.getWorkspaceRoot();
    if (!workspaceRoot) {
      setWorkspaceCitationSources([]);
      return [];
    }
    setCitationLibraryLoading(true);
    try {
      const result = await bridge.listCitations?.(workspaceRoot);
      const sources = normalizeWorkspaceCitationSources(result?.sources);
      setWorkspaceCitationSources(sources);
      return sources;
    } catch (error) {
      showStatus(error?.message || "参考文献来源库读取失败", "warning");
      return [];
    } finally {
      setCitationLibraryLoading(false);
    }
  }, [
    documentPort,
    setCitationLibraryLoading,
    setWorkspaceCitationSources,
    showStatus,
  ]);
}

export function useWorkspaceCitationLibraryLifecycle({
  leftSidebarMode,
  refreshWorkspaceCitationSources,
  structureMode,
}) {
  useEffect(() => {
    if (leftSidebarMode === "structure" && structureMode === "references") {
      refreshWorkspaceCitationSources();
    }
  }, [leftSidebarMode, refreshWorkspaceCitationSources, structureMode]);
}

export function useFootnoteActions({
  activeWorkReadOnly,
  documentPort,
  footnoteDialog,
  knowledgeReferences,
  setFootnoteDialog,
  showConfirmDialog,
  showStatus,
  structureWorkEditor,
}) {
  const handleAddFootnote = useCallback(() => {
    const target = documentPort.captureInsertTarget();
    if (!target) {
      showStatus("请先激活一个可编辑的信笺，再插入脚注", "warning");
      return;
    }
    setFootnoteDialog({ open: true, footnote: null, insertTarget: target });
  }, [documentPort, setFootnoteDialog, showStatus]);

  const handleEditFootnote = useCallback((footnote) => {
    if (!footnote?.id) return;
    if (activeWorkReadOnly) {
      showStatus("当前信笺为只读，不能编辑脚注", "warning");
      return;
    }
    setFootnoteDialog({ open: true, footnote, insertTarget: null });
  }, [activeWorkReadOnly, setFootnoteDialog, showStatus]);

  const handleSaveFootnoteDialog = useCallback(async (text) => {
    if (footnoteDialog.footnote?.id) {
      const updated = documentPort.updateActive((document) => ({
        ...document,
        footnotes: (document.footnotes || []).map((item) => (
          item.id === footnoteDialog.footnote.id
            ? { ...item, text: text.trim(), updatedAt: new Date().toISOString() }
            : item
        )),
      }));
      if (!updated) {
        return { ok: false, error: "当前信笺为只读或已经变化，脚注未保存" };
      }
      showStatus("脚注已更新", "success");
      return true;
    }
    const target = footnoteDialog.insertTarget;
    if (!target) throw new Error("脚注插入位置已经失效");
    const id = createDocumentId();
    const now = new Date().toISOString();
    const resolved = documentPort.updateTarget(target, (document) => ({
      ...document,
      footnotes: [
        ...(document.footnotes || []),
        { id, text: text.trim(), createdAt: now, updatedAt: now },
      ],
    }));
    if (!resolved) throw new Error("脚注输入期间目标信笺已经变化，未修改任何信笺");
    documentPort.insertAt(resolved, {
      type: "paperFootnoteReference",
      attrs: { footnoteId: id, number: 1 },
    });
    showStatus("脚注已插入", "success");
    return true;
  }, [documentPort, footnoteDialog.footnote, footnoteDialog.insertTarget, showStatus]);

  const handleDeleteFootnote = useCallback(async (footnote) => {
    if (activeWorkReadOnly) {
      showStatus("当前信笺为只读，不能删除脚注", "warning");
      return;
    }
    const choice = await showConfirmDialog({
      title: "删除脚注",
      message: "正文中的所有对应脚注标记也会删除。",
      actions: [
        { value: "delete", label: "删除", tone: "danger" },
        { value: "cancel", label: "取消" },
      ],
      cancelValue: "cancel",
    });
    if (choice !== "delete") return;
    removeKnowledgeNodesByAttribute(
      structureWorkEditor,
      "paperFootnoteReference",
      "footnoteId",
      footnote.id,
    );
    // Keep detached metadata so one Ctrl+Z restores a valid inline reference.
  }, [activeWorkReadOnly, showConfirmDialog, showStatus, structureWorkEditor]);

  const handleJumpFootnote = useCallback((footnote) => {
    const reference = knowledgeReferences.footnotes
      .find((item) => item.footnoteId === footnote?.id);
    if (!documentPort.focusAt(reference?.position, structureWorkEditor)) {
      showStatus("正文中的脚注位置已经失效", "warning");
    }
  }, [documentPort, knowledgeReferences.footnotes, showStatus, structureWorkEditor]);

  return {
    handleAddFootnote,
    handleDeleteFootnote,
    handleEditFootnote,
    handleJumpFootnote,
    handleSaveFootnoteDialog,
  };
}

export function useCitationActions({
  activeWorkReadOnly,
  citationOrder,
  citationPicker,
  citationSourceDialog,
  documentPort,
  knowledgeReferences,
  refreshWorkspaceCitationSources,
  researchPort,
  setCitationPicker,
  setCitationSourceDialog,
  setLeftSidebarMode,
  setPendingCitationPage,
  setStructureMode,
  setWorkspaceCitationSources,
  showConfirmDialog,
  showStatus,
  structureWorkEditor,
  workspaceCitationSources,
}) {
  const handleAddCitationSource = useCallback(() => {
    if (activeWorkReadOnly) {
      showStatus("当前信笺为只读，不能新增参考文献来源", "warning");
      return;
    }
    setCitationSourceDialog({
      open: true,
      source: null,
      insertTarget: null,
      citationPage: "",
      returnToPicker: false,
    });
  }, [activeWorkReadOnly, setCitationSourceDialog, showStatus]);

  const handleEditCitationSource = useCallback((source) => {
    if (!source?.id) return;
    if (activeWorkReadOnly) {
      showStatus("当前信笺为只读，不能编辑参考文献来源", "warning");
      return;
    }
    setCitationSourceDialog({
      open: true,
      source,
      insertTarget: null,
      citationPage: "",
      returnToPicker: false,
    });
  }, [activeWorkReadOnly, setCitationSourceDialog, showStatus]);

  const persistCitationSource = useCallback(async (input, { insertTarget = null } = {}) => {
    const previous = input?.id ? input : null;
    const now = new Date().toISOString();
    const normalized = normalizeCitationSources([{
      ...input,
      id: input?.id || createDocumentId(),
      createdAt: input?.createdAt || now,
      updatedAt: now,
    }])[0];
    if (!normalized) throw new Error("题名、网址或 DOI 至少填写一项");

    const workspaceRoot = documentPort.getWorkspaceRoot();
    const inWorkspace = Boolean(
      previous?.id && workspaceCitationSources.some((item) => item.id === previous.id),
    );
    const saveToWorkspace = Boolean(workspaceRoot && (!previous || inWorkspace || insertTarget));
    let savedSource = normalized;
    if (saveToWorkspace) {
      const result = await bridge.upsertCitation?.(workspaceRoot, normalized);
      savedSource = normalizeCitationSources([result?.source || normalized])[0];
      if (!savedSource) throw new Error("参考文献来源返回格式无效");
      setWorkspaceCitationSources(Array.isArray(result?.sources)
        ? normalizeWorkspaceCitationSources(result.sources)
        : (current) => [
          ...current.filter((item) => item.id !== savedSource.id),
          savedSource,
        ]);
    }
    if (!saveToWorkspace && !insertTarget) {
      const updated = documentPort.updateActive((document) => {
        const sources = new Map(
          (document.citationSources || []).map((item) => [item.id, item]),
        );
        sources.set(savedSource.id, savedSource);
        return { ...document, citationSources: [...sources.values()] };
      });
      if (!updated) {
        throw new Error("当前信笺为只读或已经变化，参考文献来源未保存");
      }
    } else if (previous?.id) {
      const updated = documentPort.updateActive((document) => ({
        ...document,
        citationSources: (document.citationSources || [])
          .map((item) => item.id === savedSource.id ? savedSource : item),
      }));
      if (!updated) {
        throw new Error("当前信笺为只读或已经变化，参考文献来源快照未更新");
      }
    }
    return { source: savedSource, savedToWorkspace: saveToWorkspace };
  }, [documentPort, setWorkspaceCitationSources, workspaceCitationSources]);

  const handleInsertCitationAtTarget = useCallback((target, source, page = "") => {
    if (!target || !source?.id) return false;
    const snapshot = normalizeCitationSources([source])[0];
    if (!snapshot) {
      showStatus("参考文献来源信息不完整，无法插入", "warning");
      return false;
    }
    const resolved = documentPort.updateTarget(target, (document) => {
      const sources = new Map(
        (document.citationSources || []).map((item) => [item.id, item]),
      );
      sources.set(snapshot.id, snapshot);
      return { ...document, citationSources: [...sources.values()] };
    });
    if (!resolved) {
      showStatus("选择来源期间目标信笺已经变化，未插入引用", "warning");
      return false;
    }
    documentPort.insertAt(resolved, {
      type: "paperCitationReference",
      attrs: {
        sourceId: snapshot.id,
        pages: String(page || snapshot.pages || ""),
        number: 1,
      },
    });
    setPendingCitationPage("");
    return true;
  }, [documentPort, setPendingCitationPage, showStatus]);

  const handleSaveCitationSourceDialog = useCallback(async (input, citationPage = "") => {
    const target = citationSourceDialog.insertTarget;
    if (!target && activeWorkReadOnly) {
      return { ok: false, error: "当前信笺为只读，不能保存参考文献来源" };
    }
    const result = await persistCitationSource(input, { insertTarget: target });
    if (target) {
      if (handleInsertCitationAtTarget(target, result.source, citationPage)) {
        showStatus("新参考文献来源已保存并插入", "success");
      } else {
        if (!result.savedToWorkspace) {
          const retained = documentPort.updateTarget(target, (document) => {
            const sources = new Map(
              (document.citationSources || []).map((item) => [item.id, item]),
            );
            sources.set(result.source.id, result.source);
            return { ...document, citationSources: [...sources.values()] };
          }, { allowRevisionChange: true });
          if (!retained) throw new Error("原插入信笺已经关闭，参考文献来源未能保留");
        }
        showStatus("参考文献来源已保存，但原插入位置已经失效", "warning");
      }
    } else {
      showStatus(
        result.savedToWorkspace
          ? "参考文献来源已保存到当前工作区"
          : "参考文献来源已保存到当前信笺",
        "success",
      );
    }
    return true;
  }, [
    activeWorkReadOnly,
    citationSourceDialog.insertTarget,
    documentPort,
    handleInsertCitationAtTarget,
    persistCitationSource,
    showStatus,
  ]);

  const handleOpenCitationPicker = useCallback(() => {
    const target = documentPort.captureInsertTarget();
    if (!target) {
      showStatus("请先激活一个可编辑的信笺，再插入文献引用", "warning");
      return;
    }
    setCitationPicker({
      ...target,
      requestId: `citation-${Date.now()}`,
      initialPage: "",
    });
    void refreshWorkspaceCitationSources();
  }, [documentPort, refreshWorkspaceCitationSources, setCitationPicker, showStatus]);

  const handleChooseCitationSource = useCallback((source, page = "") => {
    if (!citationPicker) return;
    if (handleInsertCitationAtTarget(citationPicker, source, page)) {
      setCitationPicker(null);
      showStatus("文献引用已插入", "success");
    }
  }, [
    citationPicker,
    handleInsertCitationAtTarget,
    setCitationPicker,
    showStatus,
  ]);

  const handleAddAndInsertCitationSource = useCallback((page = "") => {
    const target = citationPicker;
    if (!target) return;
    setCitationPicker(null);
    setCitationSourceDialog({
      open: true,
      source: null,
      insertTarget: target,
      citationPage: String(page || ""),
      returnToPicker: true,
    });
  }, [citationPicker, setCitationPicker, setCitationSourceDialog]);

  const handleCloseCitationSourceDialog = useCallback((result = {}) => {
    const previous = citationSourceDialog;
    setCitationSourceDialog({
      open: false,
      source: null,
      insertTarget: null,
      citationPage: "",
      returnToPicker: false,
    });
    if (!result?.saved && previous.returnToPicker && previous.insertTarget) {
      setCitationPicker({
        ...previous.insertTarget,
        requestId: `citation-${Date.now()}`,
        initialPage: previous.citationPage || "",
      });
    }
  }, [citationSourceDialog, setCitationPicker, setCitationSourceDialog]);

  const handleDeleteCitationSource = useCallback(async (source) => {
    if (!source?.id) return;
    if (activeWorkReadOnly) {
      showStatus("当前信笺为只读，不能移除参考文献来源", "warning");
      return;
    }
    const inWorkspace = workspaceCitationSources.some((item) => item.id === source.id);
    const isCited = citationOrder.includes(source.id);
    const choice = await showConfirmDialog({
      title: "移除参考文献来源",
      message: inWorkspace
        ? (isCited
          ? "来源会从工作区资料库移除；当前信笺仍保留引用快照。"
          : "来源会从工作区资料库移除。")
        : (isCited
          ? "该来源仍被正文引用，不能删除信笺内快照。"
          : "来源会从当前信笺中移除。"),
      actions: isCited && !inWorkspace
        ? [{ value: "cancel", label: "知道了" }]
        : [
          { value: "delete", label: "移除", tone: "danger" },
          { value: "cancel", label: "取消" },
        ],
      cancelValue: "cancel",
    });
    if (choice !== "delete") return;
    if (!inWorkspace) {
      documentPort.updateActive((document) => ({
        ...document,
        citationSources: (document.citationSources || [])
          .filter((item) => item.id !== source.id),
      }));
      return;
    }
    try {
      const result = await bridge.deleteCitation?.(
        documentPort.getWorkspaceRoot(),
        source.id,
      );
      setWorkspaceCitationSources(Array.isArray(result?.sources)
        ? normalizeWorkspaceCitationSources(result.sources)
        : (current) => current.filter((item) => item.id !== source.id));
      showStatus(
        isCited
          ? "工作区来源已移除；信笺引用快照已保留"
          : "参考文献来源已移除",
        "success",
      );
    } catch (error) {
      showStatus(error?.message || "参考文献来源移除失败", "warning");
    }
  }, [
    activeWorkReadOnly,
    citationOrder,
    documentPort,
    setWorkspaceCitationSources,
    showConfirmDialog,
    showStatus,
    workspaceCitationSources,
  ]);

  const handleCreateCitationFromResearch = useCallback(async (researchSource) => {
    if (!researchSource) {
      showStatus("请先选择研究资料", "warning");
      return;
    }
    const researchLibraryId = researchSource.researchLibraryId
      || researchPort.getLibraryId();
    const researchSourceId = researchSource.id || researchSource.researchSourceId || "";
    const bibliographic = researchSource.bibliographic || {};
    const identifier = String(bibliographic.identifier || "").trim();
    const existing = workspaceCitationSources.find((source) => (
      researchSourceId
      && source.researchSourceId === researchSourceId
      && (!source.researchLibraryId || source.researchLibraryId === researchLibraryId)
    ));
    const isPdf = researchSource.type === "file"
      && /\.pdf$/i.test(
        researchSource.fileName
        || researchSource.relativePath
        || researchSource.managedFileName
        || "",
      );
    const input = {
      ...(existing || {}),
      id: existing?.id || createDocumentId(),
      type: researchSource.type === "web" ? "web" : (isPdf ? "pdf" : "other"),
      title: researchSource.title || researchSource.fileName || "未命名来源",
      authors: bibliographic.authors || [],
      year: bibliographic.year || "",
      containerTitle: bibliographic.containerTitle || bibliographic.publication || "",
      publisher: bibliographic.publisher || "",
      url: researchSource.url || "",
      doi: /^10\./.test(identifier) ? identifier : "",
      isbn: identifier && !/^10\./.test(identifier) ? identifier : "",
      pages: bibliographic.pages || "",
      researchLibraryId,
      researchSourceId,
    };
    try {
      const workspaceRoot = documentPort.getWorkspaceRoot();
      const result = workspaceRoot
        ? await bridge.upsertCitation?.(workspaceRoot, input)
        : null;
      const rawSource = result?.source || input;
      const normalized = normalizeCitationSources([rawSource])[0];
      if (!normalized) throw new Error("资料缺少可引用的题名或地址");
      const savedSource = { ...normalized, researchLibraryId, researchSourceId };
      if (workspaceRoot) {
        setWorkspaceCitationSources(Array.isArray(result?.sources)
          ? normalizeWorkspaceCitationSources(result.sources)
            .map((source) => source.id === savedSource.id ? savedSource : source)
          : (current) => [
            ...current.filter((source) => source.id !== savedSource.id),
            savedSource,
          ]);
      } else {
        documentPort.updateActive((document) => ({
          ...document,
          citationSources: [
            ...(document.citationSources || [])
              .filter((source) => source.id !== savedSource.id),
            savedSource,
          ],
        }));
      }
      setLeftSidebarMode("structure");
      setStructureMode("references");
      showStatus(
        workspaceRoot
          ? "已加入参考文献来源库；可从“元素 → 文献引用”插入"
          : "未打开工作区；来源快照已保存在当前信笺",
        workspaceRoot ? "success" : "warning",
      );
    } catch (error) {
      showStatus(error?.message || "无法从研究资料创建参考文献来源", "warning");
    }
  }, [
    documentPort,
    researchPort,
    setLeftSidebarMode,
    setStructureMode,
    setWorkspaceCitationSources,
    showStatus,
    workspaceCitationSources,
  ]);

  const handleCreateCitationFromIndependentResearch = useCallback(async (item, options = {}) => {
    const researchLibraryId = researchPort.getLibraryId();
    if (!item || !researchLibraryId) return;
    let source = item;
    if (item.type === "file" && !item.id) {
      source = researchPort.findStableFileSource(item);
      if (!source) {
        try {
          source = await researchPort.saveLibrarySource({
            type: "file",
            title: item.name || item.fileName || "未命名资料",
            relativePath: item.relativePath,
            size: item.size || 0,
            mime: item.mime || "",
          });
        } catch (error) {
          showStatus(error?.message || "无法为资料建立稳定身份", "warning");
          return;
        }
      }
    }
    if (!source) return;
    const page = String(options?.page || "");
    if (page) setPendingCitationPage(page);
    await handleCreateCitationFromResearch({
      ...source,
      researchLibraryId,
      bibliographic: {
        ...(source.bibliographic || {}),
        ...(page ? { pages: page } : {}),
      },
    });
  }, [
    handleCreateCitationFromResearch,
    researchPort,
    setPendingCitationPage,
    showStatus,
  ]);

  const handleJumpCitationSource = useCallback((source) => {
    const reference = knowledgeReferences.citations
      .find((item) => item.sourceId === source?.id);
    if (!documentPort.focusAt(reference?.position, structureWorkEditor)) {
      showStatus("正文尚未使用这个来源", "warning");
    }
  }, [
    documentPort,
    knowledgeReferences.citations,
    showStatus,
    structureWorkEditor,
  ]);

  return {
    defaultPdfPageForCitationSource: researchPort.defaultPdfPageForCitationSource,
    handleAddAndInsertCitationSource,
    handleAddCitationSource,
    handleChooseCitationSource,
    handleCloseCitationSourceDialog,
    handleCreateCitationFromIndependentResearch,
    handleCreateCitationFromResearch,
    handleDeleteCitationSource,
    handleEditCitationSource,
    handleJumpCitationSource,
    handleOpenCitationPicker,
    handleSaveCitationSourceDialog,
  };
}
