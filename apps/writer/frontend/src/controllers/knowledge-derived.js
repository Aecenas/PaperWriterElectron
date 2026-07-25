import { useMemo, useRef } from "react";
import { useEditorState } from "@tiptap/react";
import { collectKnowledgeReferences } from "../knowledge-extensions.js";

const EMPTY_KNOWLEDGE_REFERENCES = {
  links: [],
  citations: [],
  footnotes: [],
};

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
  rightSplitTabId,
  splitPaneActive,
  workspaceCitationSources,
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
    const merged = new Map((structureWorkDocument?.citationSources || []).map((source) => [source.id, source]));
    for (const source of workspaceCitationSources) merged.set(source.id, source);
    return [...merged.values()];
  }, [structureWorkDocument?.citationSources, workspaceCitationSources]);

  const citationPickerSources = useMemo(() => {
    const targetTab = citationPicker?.documentTabId
      ? openTabs.find((tab) => tab.id === citationPicker.documentTabId)
      : null;
    const targetDocument = targetTab?.id === activeTabId ? documentState : targetTab?.document;
    const merged = new Map((targetDocument?.citationSources || []).map((source) => [source.id, source]));
    for (const source of workspaceCitationSources) merged.set(source.id, source);
    return [...merged.values()];
  }, [activeTabId, citationPicker?.documentTabId, documentState, openTabs, workspaceCitationSources]);

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
