import { useRef, useState } from "react";
import { createLatestRequestController } from "../latest-request-controller.js";
import { safeStorageGetItem } from "../safe-storage.js";

export function createEmptyResearchWebTree() {
  return {
    folders: [],
    placements: {},
    diskRevision: null,
    warnings: [],
    readOnly: false,
  };
}

export function useResearchState(writingWorkspaceRoot) {
  const [researchRoot, setResearchRoot] = useState(null);
  const [researchCurrentRelativePath, setResearchCurrentRelativePath] = useState("");
  const [researchEntries, setResearchEntries] = useState([]);
  const [researchExpandedFolders, setResearchExpandedFolders] = useState({});
  const [researchTreeLoading, setResearchTreeLoading] = useState(false);
  const [researchTreeError, setResearchTreeError] = useState("");
  const [researchBusyKeys, setResearchBusyKeys] = useState([]);
  const researchRootRef = useRef(null);
  const researchCurrentRelativePathRef = useRef("");
  const researchExpandedFoldersRef = useRef(researchExpandedFolders);
  const [librarySources, setLibrarySources] = useState([]);
  const [librarySourcesReady, setLibrarySourcesReady] = useState(false);
  const [webTreeState, setWebTreeState] = useState(createEmptyResearchWebTree);
  const [webTreeReady, setWebTreeReady] = useState(false);
  const [webWorkspaceMode, setWebWorkspaceMode] = useState(() => (
    safeStorageGetItem("paperwriter.research.web-scope-mode") === "workspace" ? "workspace" : "global"
  ));
  const [writingWorkspaceIdentity, setWritingWorkspaceIdentity] = useState(null);
  const webWorkspaceConnected = webWorkspaceMode === "workspace" && Boolean(writingWorkspaceIdentity?.workspaceId);
  const webWorkspaceIdentityPending = webWorkspaceMode === "workspace"
    && Boolean(writingWorkspaceRoot)
    && !writingWorkspaceIdentity?.workspaceId;
  const webScopeKey = webWorkspaceConnected ? `workspace:${writingWorkspaceIdentity.workspaceId}` : "global";
  const [activeLibraryItem, setActiveLibraryItem] = useState(null);
  const [researchItemsByViewId, setResearchItemsByViewId] = useState({});
  const librarySourcesRef = useRef(librarySources);
  const researchItemsByViewIdRef = useRef(researchItemsByViewId);
  librarySourcesRef.current = librarySources;
  researchItemsByViewIdRef.current = researchItemsByViewId;
  researchExpandedFoldersRef.current = researchExpandedFolders;
  const [activeResearchLoading, setActiveResearchLoading] = useState(false);
  const [activeResearchError, setActiveResearchError] = useState("");

  return {
    activeLibraryItem,
    activeResearchError,
    activeResearchLoading,
    librarySources,
    librarySourcesReady,
    librarySourcesRef,
    researchBusyKeys,
    researchCurrentRelativePath,
    researchCurrentRelativePathRef,
    researchEntries,
    researchExpandedFolders,
    researchExpandedFoldersRef,
    researchItemsByViewId,
    researchItemsByViewIdRef,
    researchRoot,
    researchRootRef,
    researchTreeError,
    researchTreeLoading,
    setActiveLibraryItem,
    setActiveResearchError,
    setActiveResearchLoading,
    setLibrarySources,
    setLibrarySourcesReady,
    setResearchBusyKeys,
    setResearchCurrentRelativePath,
    setResearchEntries,
    setResearchExpandedFolders,
    setResearchItemsByViewId,
    setResearchRoot,
    setResearchTreeError,
    setResearchTreeLoading,
    setWebTreeReady,
    setWebTreeState,
    setWebWorkspaceMode,
    setWritingWorkspaceIdentity,
    webScopeKey,
    webTreeReady,
    webTreeState,
    webWorkspaceConnected,
    webWorkspaceIdentityPending,
    webWorkspaceMode,
    writingWorkspaceIdentity,
  };
}

export function useResearchRequestControllerRefs() {
  const researchCurrentRequestControllerRef = useRef(createLatestRequestController());
  const researchBranchRequestControllerRef = useRef(createLatestRequestController());
  const researchSourcesRequestControllerRef = useRef(createLatestRequestController());
  const researchWebRequestControllerRef = useRef(createLatestRequestController());
  return {
    researchBranchRequestControllerRef,
    researchCurrentRequestControllerRef,
    researchSourcesRequestControllerRef,
    researchWebRequestControllerRef,
  };
}
