import { useMemo, useRef } from "react";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  getActiveWorkspaceView,
} from "../workspace-groups.js";

export function createKnowledgeResearchPort({
  activeLibraryItemRef,
  librarySourcesRef,
  researchItemsByViewIdRef,
  researchRootRef,
  saveResearchLibrarySource,
  workspaceGroupsRef,
}) {
  const getLibraryId = () => researchRootRef.current?.libraryId || "";

  const findStableFileSource = (item) => (
    librarySourcesRef.current.find((candidate) => (
      candidate.type === "file" && candidate.relativePath === item?.relativePath
    )) || null
  );

  const defaultPdfPageForCitationSource = (source) => {
    const view = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
    if (view?.kind !== WORKSPACE_VIEW_KIND.RESEARCH || !view.libraryId || !source?.researchSourceId) {
      return "";
    }
    const item = researchItemsByViewIdRef.current[view.viewId]
      || (view.sourceId
        ? librarySourcesRef.current.find((candidate) => candidate.id === view.sourceId)
        : null)
      || activeLibraryItemRef.current;
    const isPdf = item?.type === "file"
      && /\.pdf$/i.test(item.relativePath || item.fileName || item.name || "");
    if (!isPdf || source.researchLibraryId !== view.libraryId) return "";
    const stableFileSource = item?.id
      ? item
      : librarySourcesRef.current.find((candidate) => (
        candidate.type === "file" && candidate.relativePath === view.relativePath
      ));
    if (!stableFileSource?.id || stableFileSource.id !== source.researchSourceId) return "";
    return String(view.viewState?.page || 1);
  };

  return {
    defaultPdfPageForCitationSource,
    findStableFileSource,
    getLibraryId,
    saveLibrarySource: saveResearchLibrarySource,
  };
}

export function useKnowledgeResearchPort(options) {
  const activeLibraryItemRef = useRef(options.activeLibraryItem || null);
  activeLibraryItemRef.current = options.activeLibraryItem || null;
  return useMemo(() => createKnowledgeResearchPort({
    ...options,
    activeLibraryItemRef,
  }), [
    options.librarySourcesRef,
    options.researchItemsByViewIdRef,
    options.researchRootRef,
    options.saveResearchLibrarySource,
    options.workspaceGroupsRef,
  ]);
}
