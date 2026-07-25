import { useRef, useState } from "react";

export function createEmptyWorkspaceRelationships() {
  return { documents: [], links: [], backlinks: [], duplicates: [] };
}

export function useKnowledgeReferenceState() {
  const [workspaceCitationSources, setWorkspaceCitationSources] = useState([]);
  const [citationLibraryLoading, setCitationLibraryLoading] = useState(false);
  const [pendingCitationPage, setPendingCitationPage] = useState("");
  const [workspaceRelationships, setWorkspaceRelationships] = useState(createEmptyWorkspaceRelationships);
  const workspaceRelationshipRequestRef = useRef(0);
  const [internalLinkPicker, setInternalLinkPicker] = useState(null);
  const [citationPicker, setCitationPicker] = useState(null);
  const [footnoteDialog, setFootnoteDialog] = useState({ open: false, footnote: null, insertTarget: null });
  const [citationSourceDialog, setCitationSourceDialog] = useState({
    open: false,
    source: null,
    insertTarget: null,
    citationPage: "",
    returnToPicker: false,
  });
  const [knowledgeReferencePopover, setKnowledgeReferencePopover] = useState(null);

  return {
    citationLibraryLoading,
    citationPicker,
    citationSourceDialog,
    footnoteDialog,
    internalLinkPicker,
    knowledgeReferencePopover,
    pendingCitationPage,
    setCitationLibraryLoading,
    setCitationPicker,
    setCitationSourceDialog,
    setFootnoteDialog,
    setInternalLinkPicker,
    setKnowledgeReferencePopover,
    setPendingCitationPage,
    setWorkspaceCitationSources,
    setWorkspaceRelationships,
    workspaceCitationSources,
    workspaceRelationshipRequestRef,
    workspaceRelationships,
  };
}
