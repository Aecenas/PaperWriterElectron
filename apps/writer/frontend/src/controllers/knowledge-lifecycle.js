import { useCallback, useEffect } from "react";
import { NodeSelection } from "@tiptap/pm/state";
import { bridge } from "../bridge.js";
import { createDocumentId, normalizeDocumentId } from "../document-schema-v2.js";
import {
  createKnowledgeUpdateGuard,
  synchronizeKnowledgeReferences,
} from "../knowledge-extensions.js";
import {
  imageReferenceNumberAt,
  synchronizeStructuredInlineReferences,
} from "../structured-inline-extensions.js";
import { WORKSPACE_VIEW_KIND } from "../workspace-groups.js";

export function derivePendingCitationPage({
  activeLibraryItem,
  activeSecondaryView,
  librarySources,
  researchItemsByViewId,
}) {
  if (activeSecondaryView?.kind !== WORKSPACE_VIEW_KIND.RESEARCH) return "";
  const item = researchItemsByViewId[activeSecondaryView.viewId]
    || (activeSecondaryView.sourceId
      ? librarySources.find((source) => source.id === activeSecondaryView.sourceId)
      : null)
    || activeLibraryItem;
  const isPdf = item?.type === "file"
    && /\.pdf$/i.test(activeSecondaryView.relativePath || item.relativePath || item.name || "");
  return isPdf ? String(activeSecondaryView.viewState?.page || 1) : "";
}

export function usePendingCitationPageLifecycle({
  page,
  setPendingCitationPage,
}) {
  useEffect(() => {
    setPendingCitationPage(page);
  }, [page, setPendingCitationPage]);
}

export function useKnowledgeEditorSyncLifecycle({
  activeWorkDocument,
  activeWorkEditor,
}) {
  useEffect(() => {
    if (!activeWorkEditor) return undefined;
    const synchronize = createKnowledgeUpdateGuard(() => {
      synchronizeStructuredInlineReferences(activeWorkEditor);
      synchronizeKnowledgeReferences(activeWorkEditor, {
        citationSources: activeWorkDocument?.citationSources || [],
        footnotes: activeWorkDocument?.footnotes || [],
      });
    });
    synchronize();
    activeWorkEditor.on("update", synchronize);
    return () => activeWorkEditor.off("update", synchronize);
  }, [activeWorkDocument?.citationSources, activeWorkDocument?.footnotes, activeWorkEditor]);
}

export function useImageReferenceLifecycle({
  documentPort,
  showStatus,
}) {
  useEffect(() => {
    const handleCopyReference = async (event) => {
      const targetEditor = documentPort.editorForDom(event.detail?.editorDom);
      if (!targetEditor) return;
      try {
        const targetDocument = documentPort.ensureImageReferenceDocument(targetEditor);
        let imageId = normalizeDocumentId(event.detail?.imageId);
        const requestedPosition = typeof event.detail?.position === "number"
          ? event.detail.position
          : Number.NaN;
        let image = imageReferenceNumberAt(
          targetEditor,
          Number.isFinite(requestedPosition) ? requestedPosition : -1,
          imageId,
        );
        if (!image?.node || image.node.type.name !== "image") {
          throw new Error("图片位置已经变化，请重新复制引用");
        }
        if (!imageId) {
          imageId = createDocumentId();
          const transaction = targetEditor.state.tr.setNodeMarkup(
            image.position,
            undefined,
            { ...image.node.attrs, imageId },
            image.node.marks,
          );
          targetEditor.view.dispatch(transaction);
          image = imageReferenceNumberAt(targetEditor, image.position, imageId);
        }
        const result = await bridge.copyImageReference?.({
          documentId: targetDocument.documentId,
          imageId,
          number: image?.number || 1,
        });
        if (result?.ok === false) throw new Error(result.message || "剪贴板写入失败");
        showStatus(`图${image?.number || 1}的引用已复制`, "success");
      } catch (error) {
        showStatus(error?.message || "图片引用复制失败", "warning");
      }
    };

    const handlePasteBlocked = () => showStatus("图片引用仅限本文档使用", "warning");

    const handleOpenReference = (event) => {
      const targetEditor = documentPort.editorForDom(event.detail?.editorDom);
      const imageId = normalizeDocumentId(event.detail?.imageId);
      if (!targetEditor || event.detail?.missing || !imageId) {
        showStatus("目标图片已删除", "warning");
        return;
      }
      const target = imageReferenceNumberAt(targetEditor, -1, imageId);
      if (!target?.node) {
        showStatus("目标图片已删除", "warning");
        return;
      }
      documentPort.activateEditor(targetEditor);
      const transaction = targetEditor.state.tr
        .setSelection(NodeSelection.create(targetEditor.state.doc, target.position))
        .scrollIntoView();
      targetEditor.view.dispatch(transaction);
      targetEditor.view.focus();
      window.requestAnimationFrame(() => {
        const element = targetEditor.view.dom.querySelector(
          `[data-type="paper-image"][data-image-id="${imageId}"]`,
        );
        if (!element) return;
        element.classList.add("image-reference-target");
        window.setTimeout(() => element.classList.remove("image-reference-target"), 1_200);
      });
    };

    window.addEventListener("paper-image-reference-copy", handleCopyReference);
    window.addEventListener("paper-image-reference-paste-blocked", handlePasteBlocked);
    window.addEventListener("paper-image-reference-open", handleOpenReference);
    return () => {
      window.removeEventListener("paper-image-reference-copy", handleCopyReference);
      window.removeEventListener("paper-image-reference-paste-blocked", handlePasteBlocked);
      window.removeEventListener("paper-image-reference-open", handleOpenReference);
    };
  }, [documentPort, showStatus]);
}

export function useKnowledgeReferencePopoverActions({
  activeTabId,
  citationPicker,
  citationSourceDialog,
  documentPort,
  footnoteDialog,
  rightSplitTabId,
  setKnowledgeReferencePopover,
  workspaceCitationSources,
}) {
  const closeKnowledgeReferencePopover = useCallback((options = {}) => {
    setKnowledgeReferencePopover((current) => {
      if (options?.restoreFocus && current?.anchorElement?.isConnected) {
        window.requestAnimationFrame(() => current.anchorElement.focus?.());
      }
      return null;
    });
  }, [setKnowledgeReferencePopover]);

  useEffect(() => {
    const handleOpenReference = (event) => {
      const detail = event.detail || {};
      const context = documentPort.contextForDom(
        detail.editorDom,
        { fallbackToPrimary: true },
      );
      if (!context?.document || !detail.anchorElement) return;
      documentPort.activateEditor(context.editor);
      const sourceMap = new Map(workspaceCitationSources.map((source) => [source.id, source]));
      (context.document.citationSources || []).forEach((source) => sourceMap.set(source.id, source));
      const footnote = (context.document.footnotes || [])
        .find((item) => item.id === detail.footnoteId) || null;
      setKnowledgeReferencePopover({
        kind: detail.kind === "footnote" ? "footnote" : "citation",
        number: Math.max(1, Number(detail.number) || 1),
        pages: String(detail.pages || ""),
        footnote,
        source: sourceMap.get(detail.sourceId) || null,
        anchorElement: detail.anchorElement,
        anchorRect: detail.anchorRect || null,
        position: Number(detail.position),
      });
    };
    window.addEventListener("paper-knowledge-reference-open", handleOpenReference);
    return () => window.removeEventListener("paper-knowledge-reference-open", handleOpenReference);
  }, [documentPort, setKnowledgeReferencePopover, workspaceCitationSources]);

  useEffect(() => {
    setKnowledgeReferencePopover(null);
  }, [activeTabId, rightSplitTabId, setKnowledgeReferencePopover]);

  useEffect(() => {
    if (footnoteDialog.open || citationSourceDialog.open || citationPicker) {
      setKnowledgeReferencePopover(null);
    }
  }, [
    citationPicker,
    citationSourceDialog.open,
    footnoteDialog.open,
    setKnowledgeReferencePopover,
  ]);

  return { closeKnowledgeReferencePopover };
}
