import { useMemo, useRef } from "react";
import { useEditorState } from "@tiptap/react";
import { collectKnowledgeReferences } from "../knowledge-extensions.js";

const EMPTY_KNOWLEDGE_REFERENCES = {
  links: [],
  citations: [],
  footnotes: [],
};

export function mergeCitationSourcesWithFallbacks(
  privateSources = [],
  publicSources = [],
  workspaceSources = [],
) {
  const merged = new Map((Array.isArray(privateSources) ? privateSources : []).map((source) => [source.id, source]));
  for (const source of Array.isArray(publicSources) ? publicSources : []) {
    if (!merged.has(source.id)) merged.set(source.id, source);
  }
  for (const source of Array.isArray(workspaceSources) ? workspaceSources : []) {
    if (!merged.has(source.id)) merged.set(source.id, source);
  }
  return [...merged.values()];
}

export function buildCitationPickerSources(
  privateSources = [],
  publicSources = [],
  workspaceSources = [],
) {
  const merged = new Map((Array.isArray(privateSources) ? privateSources : []).map((source) => [
    source.id,
    { ...source, libraryScope: "private" },
  ]));
  for (const source of Array.isArray(publicSources) ? publicSources : []) {
    if (!merged.has(source.id)) merged.set(source.id, { ...source, libraryScope: "public" });
  }
  for (const source of Array.isArray(workspaceSources) ? workspaceSources : []) {
    if (!merged.has(source.id)) {
      merged.set(source.id, { ...source, libraryScope: "public", legacyWorkspaceSource: true });
    }
  }
  return [...merged.values()];
}

export function useKnowledgeReferenceDerived({
  activeTabId,
  activeWorkDocument,
  activeWorkEditor,
  activeWorkPath,
  citationPicker,
  currentPath,
  documentState,
  editor,
  openTabs,
  publicCitationSources = [],
  rightSplitTabId,
  splitPaneActive,
  workspaceCitationSources = [],
  writingWorkspaceRoot,
}) {
  const structureWorkEditor = activeWorkEditor || editor;
  const structureWorkDocument = activeWorkDocument || documentState;
  const structureWorkPath = activeWorkPath || currentPath;
  const structureWorkTabId = splitPaneActive ? rightSplitTabId : activeTabId;
  const workspaceRelationshipContextKey = `${writingWorkspaceRoot || ""}\n${structureWorkTabId || ""}\n${structureWorkPath || ""}\n${structureWorkDocument?.documentId || ""}`;
  const workspaceRelationshipContextRef = useRef(workspaceRelationshipContextKey);
  workspaceRelationshipContextRef.current = workspaceRelationshipContextKey;

  const knowledgeReferences = useEditorState({
    editor: structureWorkEditor,
    selector: ({ editor: activeEditor }) => collectKnowledgeReferences(activeEditor),
  }) || EMPTY_KNOWLEDGE_REFERENCES;

  const citationOrder = useMemo(
    () => [...new Set(knowledgeReferences.citations.map((citation) => citation.sourceId).filter(Boolean))],
    [knowledgeReferences.citations],
  );

  const citationSourcesForDock = useMemo(() => {
    return mergeCitationSourcesWithFallbacks(
      structureWorkDocument?.citationSources,
      publicCitationSources,
      workspaceCitationSources,
    );
  }, [publicCitationSources, structureWorkDocument?.citationSources, workspaceCitationSources]);

  const citationPickerSources = useMemo(() => {
    const targetTab = citationPicker?.documentTabId
      ? openTabs.find((tab) => tab.id === citationPicker.documentTabId)
      : null;
    const targetDocument = targetTab?.id === activeTabId ? documentState : targetTab?.document;
    return buildCitationPickerSources(
      targetDocument?.citationSources,
      publicCitationSources,
      workspaceCitationSources,
    );
  }, [activeTabId, citationPicker?.documentTabId, documentState, openTabs, publicCitationSources, workspaceCitationSources]);

  const visibleFootnotes = useMemo(() => {
    const byId = new Map((structureWorkDocument?.footnotes || []).map((footnote) => [footnote.id, footnote]));
    const seen = new Set();
    return knowledgeReferences.footnotes.map((reference) => {
      if (!reference.footnoteId || seen.has(reference.footnoteId)) return null;
      seen.add(reference.footnoteId);
      return byId.get(reference.footnoteId) || null;
    }).filter(Boolean);
  }, [structureWorkDocument?.footnotes, knowledgeReferences.footnotes]);

  return {
    citationOrder,
    citationPickerSources,
    citationSourcesForDock,
    knowledgeReferences,
    structureWorkDocument,
    structureWorkEditor,
    structureWorkPath,
    structureWorkTabId,
    visibleFootnotes,
    workspaceRelationshipContextKey,
    workspaceRelationshipContextRef,
  };
}
