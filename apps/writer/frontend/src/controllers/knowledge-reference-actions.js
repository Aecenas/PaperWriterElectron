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

export function usePublicCitationLibrary({
  documentPort,
  setPublicCitationLibraryLoading,
  setPublicCitationSources,
  showStatus,
}) {
  return useCallback(async () => {
    setPublicCitationLibraryLoading(true);
    try {
      const workspaceRoot = documentPort.getWorkspaceRoot();
      const result = workspaceRoot && typeof bridge.migrateWorkspaceCitationsToPublic === "function"
        ? await bridge.migrateWorkspaceCitationsToPublic(workspaceRoot)
        : await bridge.listPublicCitations?.();
      const sources = normalizeWorkspaceCitationSources(result?.sources);
      setPublicCitationSources(sources);
      return sources;
    } catch (error) {
      showStatus(error?.message || "公域文献库读取失败", "warning");
      return [];
    } finally {
      setPublicCitationLibraryLoading(false);
    }
  }, [
    documentPort,
    setPublicCitationLibraryLoading,
    setPublicCitationSources,
    showStatus,
  ]);
}

export function useWorkspaceCitationLibraryLifecycle({
  leftSidebarMode,
  refreshPublicCitationSources,
  refreshWorkspaceCitationSources,
  structureMode,
}) {
  useEffect(() => {
    if (leftSidebarMode === "structure" && structureMode === "bibliography") {
      void Promise.all([
        refreshWorkspaceCitationSources(),
        refreshPublicCitationSources?.(),
      ]);
    }
  }, [leftSidebarMode, refreshPublicCitationSources, refreshWorkspaceCitationSources, structureMode]);
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
  publicCitationSources,
  refreshPublicCitationSources,
  refreshWorkspaceCitationSources,
  researchPort,
  setCitationPicker,
  setCitationSourceDialog,
  setLeftSidebarMode,
  setPendingCitationPage,
  setPublicCitationSources,
  setStructureMode,
  setWorkspaceCitationSources,
  showConfirmDialog,
  showStatus,
  structureWorkEditor,
  workspaceCitationSources,
}) {
  const handleAddCitationSource = useCallback((scope = "private") => {
    const targetScope = scope === "public" ? "public" : "private";
    if (targetScope === "private" && activeWorkReadOnly) {
      showStatus("当前信笺为只读，不能新增参考文献来源", "warning");
      return;
    }
    setCitationSourceDialog({
      open: true,
      source: null,
      insertTarget: null,
      citationPage: "",
      returnToPicker: false,
      scope: targetScope,
    });
  }, [activeWorkReadOnly, setCitationSourceDialog, showStatus]);

  const handleEditCitationSource = useCallback((source, scope = "private") => {
    if (!source?.id) return;
    const targetScope = scope === "public" ? "public" : "private";
    if (targetScope === "private" && activeWorkReadOnly) {
      showStatus("当前信笺为只读，不能编辑参考文献来源", "warning");
      return;
    }
    setCitationSourceDialog({
      open: true,
      source,
      insertTarget: null,
      citationPage: "",
      returnToPicker: false,
      scope: targetScope,
    });
  }, [activeWorkReadOnly, setCitationSourceDialog, showStatus]);

  const persistCitationSource = useCallback(async (input, {
    insertTarget = null,
    scope = "private",
  } = {}) => {
    const now = new Date().toISOString();
    const normalized = normalizeCitationSources([{
      ...input,
      id: input?.id || createDocumentId(),
      createdAt: input?.createdAt || now,
      updatedAt: now,
    }])[0];
    if (!normalized) throw new Error("题名、网址或 DOI 至少填写一项");

    if (scope === "public") {
      if (typeof bridge.upsertPublicCitation !== "function") throw new Error("当前环境不支持公域文献库");
      const result = await bridge.upsertPublicCitation(normalized);
      const savedSource = normalizeCitationSources([result?.source || normalized])[0];
      if (!savedSource) throw new Error("公域文献返回格式无效");
      setPublicCitationSources(Array.isArray(result?.sources)
        ? normalizeWorkspaceCitationSources(result.sources)
        : (current) => [
          ...current.filter((item) => item.id !== savedSource.id),
          savedSource,
        ]);
      return { source: savedSource, scope: "public" };
    }

    if (!insertTarget) {
      const updated = documentPort.updateActive((document) => {
        const sources = new Map(
          (document.citationSources || []).map((item) => [item.id, item]),
        );
        sources.set(normalized.id, normalized);
        return { ...document, citationSources: [...sources.values()] };
      });
      if (!updated) {
        throw new Error("当前信笺为只读或已经变化，参考文献来源未保存");
      }
    }
    return { source: normalized, scope: "private" };
  }, [documentPort, setPublicCitationSources]);

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
    const scope = target ? "private" : (citationSourceDialog.scope === "public" ? "public" : "private");
    if (scope === "private" && !target && activeWorkReadOnly) {
      return { ok: false, error: "当前信笺为只读，不能保存参考文献来源" };
    }
    const result = await persistCitationSource(input, { insertTarget: target, scope });
    if (target) {
      if (handleInsertCitationAtTarget(target, result.source, citationPage)) {
        showStatus("新参考文献来源已保存并插入", "success");
      } else {
        const retained = documentPort.updateTarget(target, (document) => {
          const sources = new Map(
            (document.citationSources || []).map((item) => [item.id, item]),
          );
          sources.set(result.source.id, result.source);
          return { ...document, citationSources: [...sources.values()] };
        }, { allowRevisionChange: true });
        if (!retained) throw new Error("原插入信笺已经关闭，参考文献来源未能保留");
        showStatus("参考文献来源已保存，但原插入位置已经失效", "warning");
      }
    } else {
      showStatus(scope === "public" ? "文献已保存到公域" : "文献已保存到当前信笺", "success");
    }
    return true;
  }, [
    activeWorkReadOnly,
    citationSourceDialog.scope,
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
    void Promise.all([
      refreshWorkspaceCitationSources(),
      refreshPublicCitationSources?.(),
    ]);
  }, [documentPort, refreshPublicCitationSources, refreshWorkspaceCitationSources, setCitationPicker, showStatus]);

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
      scope: "private",
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
      scope: "private",
    });
    if (!result?.saved && previous.returnToPicker && previous.insertTarget) {
      setCitationPicker({
        ...previous.insertTarget,
        requestId: `citation-${Date.now()}`,
        initialPage: previous.citationPage || "",
      });
    }
  }, [citationSourceDialog, setCitationPicker, setCitationSourceDialog]);

  const handleDeleteCitationSource = useCallback(async (source, scope = "private") => {
    if (!source?.id) return;
    const targetScope = scope === "public" ? "public" : "private";
    if (targetScope === "private" && activeWorkReadOnly) {
      showStatus("当前信笺为只读，不能移除参考文献来源", "warning");
      return;
    }
    const isCited = citationOrder.includes(source.id);
    const choice = await showConfirmDialog({
      title: targetScope === "public" ? "删除公域文献" : "移除私域文献",
      message: targetScope === "public"
        ? "只会从公域删除；已经加入信笺的私域快照不会变化。"
        : (isCited
          ? "该文献仍被正文引用，不能删除信笺内快照。"
          : "文献会从当前信笺的私域文献库移除。"),
      actions: isCited && targetScope === "private"
        ? [{ value: "cancel", label: "知道了" }]
        : [
          { value: "delete", label: "移除", tone: "danger" },
          { value: "cancel", label: "取消" },
        ],
      cancelValue: "cancel",
    });
    if (choice !== "delete") return;
    if (targetScope === "private") {
      documentPort.updateActive((document) => ({
        ...document,
        citationSources: (document.citationSources || [])
          .filter((item) => item.id !== source.id),
      }));
      showStatus("私域文献已移除", "success");
      return;
    }
    try {
      const result = await bridge.deletePublicCitation?.(source.id);
      setPublicCitationSources(Array.isArray(result?.sources)
        ? normalizeWorkspaceCitationSources(result.sources)
        : (current) => current.filter((item) => item.id !== source.id));
      showStatus("公域文献已删除；已有信笺快照保持不变", "success");
    } catch (error) {
      showStatus(error?.message || "公域文献删除失败", "warning");
    }
  }, [
    activeWorkReadOnly,
    citationOrder,
    documentPort,
    setPublicCitationSources,
    showConfirmDialog,
    showStatus,
  ]);

  const handleCopyCitationToPublic = useCallback(async (source) => {
    if (!source?.id) return false;
    try {
      if (typeof bridge.upsertPublicCitation !== "function") throw new Error("当前环境不支持公域文献库");
      const result = await bridge.upsertPublicCitation(source);
      setPublicCitationSources(Array.isArray(result?.sources)
        ? normalizeWorkspaceCitationSources(result.sources)
        : (current) => [
          ...current.filter((item) => item.id !== source.id),
          normalizeCitationSources([result?.source || source])[0],
        ].filter(Boolean));
      showStatus("已复制到公域；当前信笺快照保持独立", "success");
      return true;
    } catch (error) {
      showStatus(error?.message || "复制到公域失败", "warning");
      return false;
    }
  }, [setPublicCitationSources, showStatus]);

  const handleAttachPublicCitation = useCallback((source) => {
    if (!source?.id) return false;
    if (activeWorkReadOnly) {
      showStatus("当前信笺为只读，不能加入文献", "warning");
      return false;
    }
    const snapshot = normalizeCitationSources([source])[0];
    if (!snapshot) return false;
    const updated = documentPort.updateActive((document) => {
      const sources = new Map((document.citationSources || []).map((item) => [item.id, item]));
      sources.set(snapshot.id, snapshot);
      return { ...document, citationSources: [...sources.values()] };
    });
    if (!updated) return false;
    showStatus("已加入本文私域文献库", "success");
    return true;
  }, [activeWorkReadOnly, documentPort, showStatus]);

  const handleImportCitationSources = useCallback(async (scope, sources) => {
    const normalized = normalizeCitationSources(Array.isArray(sources) ? sources : []);
    if (scope !== "public") {
      if (activeWorkReadOnly) throw new Error("当前信笺为只读，不能导入私域文献");
      const updated = documentPort.updateActive((document) => ({
        ...document,
        citationSources: normalized,
      }));
      if (!updated) throw new Error("私域文献导入期间信笺已经变化");
      return normalized;
    }
    if (typeof bridge.upsertPublicCitation !== "function") {
      throw new Error("当前环境不支持公域文献库");
    }
    let latest = publicCitationSources;
    for (const source of normalized) {
      const result = await bridge.upsertPublicCitation(source);
      latest = Array.isArray(result?.sources)
        ? normalizeWorkspaceCitationSources(result.sources)
        : latest;
    }
    setPublicCitationSources(latest);
    return latest;
  }, [activeWorkReadOnly, documentPort, publicCitationSources, setPublicCitationSources]);

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
    const existing = publicCitationSources.find((source) => (
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
      if (typeof bridge.upsertPublicCitation !== "function") throw new Error("当前环境不支持公域文献库");
      const result = await bridge.upsertPublicCitation(input);
      const rawSource = result?.source || input;
      const normalized = normalizeCitationSources([rawSource])[0];
      if (!normalized) throw new Error("资料缺少可引用的题名或地址");
      const savedSource = { ...normalized, researchLibraryId, researchSourceId };
      setPublicCitationSources(Array.isArray(result?.sources)
        ? normalizeWorkspaceCitationSources(result.sources)
          .map((source) => source.id === savedSource.id ? savedSource : source)
        : (current) => [
          ...current.filter((source) => source.id !== savedSource.id),
          savedSource,
        ]);
      setLeftSidebarMode("structure");
      setStructureMode("bibliography");
      showStatus("已加入公域文献库；可从“元素 → 文献引用”插入", "success");
    } catch (error) {
      showStatus(error?.message || "无法从研究资料创建参考文献来源", "warning");
    }
  }, [
    documentPort,
    publicCitationSources,
    researchPort,
    setLeftSidebarMode,
    setStructureMode,
    setPublicCitationSources,
    showStatus,
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
    handleCopyCitationToPublic,
    handleCreateCitationFromIndependentResearch,
    handleCreateCitationFromResearch,
    handleDeleteCitationSource,
    handleEditCitationSource,
    handleAttachPublicCitation,
    handleImportCitationSources,
    handleJumpCitationSource,
    handleOpenCitationPicker,
    handleSaveCitationSourceDialog,
  };
}
