import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@tiptap/react";
import {
  FilePlus,
  FileText,
  FolderPlus,
  Focus,
  MessageSquare,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { bridge } from "./bridge.js";
import AiModeChooser from "./AiModeChooser.jsx";
import SettingsCenter from "./SettingsCenter.jsx";
import { DocumentFindWidget, WorkspaceSearchPalette } from "./WorkspaceSearchPanel.jsx";
import "./workspace-features.css";
import ReleaseNotesDialog from "./ReleaseNotesDialog.jsx";
import { ExportDialog } from "./export/index.js";
import { AiSettingsDialog } from "./ai-settings/index.js";
import {
  AiChatPane,
  AiChatToolbar,
  AiOptimizeToolbar,
  AiResultPane,
  createEmptyAiState,
  normalizeAiState,
} from "./ai/index.js";
import {
  AppConfirmDialog,
  AppPromptDialog,
  DocumentTabs,
  HelpCenterDialog,
  InternalLinkPicker,
  LinkDialog,
  LiveOutlineSidebar,
  StatusBar,
  StatusToast,
  TitleBar,
  TopNav,
  WebCopyDialog,
  WebSourceDialog,
  displayNameFromPath,
  pathIsSameOrInside,
} from "./app-shell/index.js";
import {
  useClearUpdateResultReset,
  useCitationActions,
  useAiConfigActions,
  useAiConfigDerived,
  useAiConfigLifecycle,
  useAiConfigState,
  useAiChatSelectionActions,
  useAiApplyPreviewActions,
  useAiApplyPreviewLifecycle,
  useAiApplyResetLifecycle,
  useAiApplyResolutionActions,
  useAiApplyState,
  useAiManualApplyLifecycle,
  useAiDocumentStateActions,
  useAiElapsedLifecycle,
  useAiModeChooserActions,
  useAiModeState,
  useAiModeTransitionActions,
  useAiRequestActions,
  useAiStreamChatMessagesSlot,
  useAiStreamEventsLifecycle,
  useAiStreamRegistry,
  useExportDialogActions,
  useExportDialogState,
  useExportExecutionActions,
  useExportPresentationState,
  useHelpReleaseActions,
  useHelpReleaseState,
  derivePendingCitationPage,
  useImageReferenceLifecycle,
  useKnowledgeEditorSyncLifecycle,
  useKnowledgeReferenceDerived,
  useKnowledgeReferencePopoverActions,
  useKnowledgeReferenceState,
  useKnowledgeResearchPort,
  usePendingCitationPageLifecycle,
  useFootnoteActions,
  useNormalizeNewDocumentTemplateHistory,
  usePersistNewDocumentTemplateHistory,
  usePersistNewDocumentTemplateId,
  usePersistUserLetterTemplates,
  usePersistUserTemplateGroups,
  usePromiseDialogActions,
  usePromiseDialogOverlayLifecycle,
  usePromiseDialogResolverRefs,
  usePromiseDialogState,
  usePromiseDialogUnmountLifecycle,
  useOpenResearchTargetSignature,
  useResearchFileActions,
  useResearchMountLifecycle,
  useResearchOpenActions,
  useResearchOpenTargetValidationLifecycle,
  useResearchRefreshActions,
  useResearchRequestControllerRefs,
  useResearchSourceWebActions,
  useResearchState,
  useResearchViewReconciliationLifecycle,
  useResearchWatcherLifecycle,
  useResearchWebScopePreferenceLifecycle,
  useRunUpdateAction,
  useScheduleUpdateResultReset,
  useStatusActions,
  useStatusState,
  useTemplateCatalogActions,
  useTemplateCatalogState,
  useTemplateTabDialogActions,
  useTemplateTabDialogReturnFocusRef,
  useTemplateTabDialogState,
  useUpdateAutoCheckLifecycle,
  useUpdateAutoCheckRef,
  useUpdateEventsLifecycle,
  useUpdateFlowRefs,
  useUpdateState,
  useWritingWorkspaceIdentityLifecycle,
  useWorkspaceCitationLibrary,
  useWorkspaceCitationLibraryLifecycle,
  useWorkspaceRelationshipActions,
} from "./controllers/index.js";
import { useAiDocumentPort } from "./document-workspace/ai-document-port.js";
import { useAiLayoutPort } from "./document-workspace/ai-layout-port.js";
import { useKnowledgeDocumentPort } from "./document-workspace/knowledge-document-port.js";
import {
  CommentPanel,
  PaperCanvas,
  commentAnchorTrackAvailable,
  createPaperEditorExtensions,
  getDocumentComments,
  getEditorLinkContext,
  setDocumentCommentVisibility,
  syncAiChatSelectionDecorations,
  syncDocumentCommentDecorations,
} from "./editor/index.js";
import {
  DEFAULT_LETTER_TEMPLATES,
  LetterTemplateDialog,
  getLetterTemplate,
} from "./templates/index.js";
import { CURRENT_RELEASE_VERSION } from "./release-notes.js";
import { applyDocumentTextReplacements, moveActiveDocumentSearchMatch, searchDocumentText } from "./document-search.js";
import { renderDocumentSearchState } from "./document-search-extension.js";
import {
  createDerivedDocumentIdentity,
  createDocumentId,
  mergePersistedDocumentIdentity,
} from "./document-schema-v2.js";
import {
  stripDerivedKnowledgeDataFromHtml,
} from "./knowledge-extensions.js";
import { createDocumentCommentId, normalizeDocumentComments } from "./editor-comments.js";
import ResearchSidebar from "./ResearchSidebar.jsx";
import SecondaryResearchPane from "./SecondaryResearchPane.jsx";
import StructureInspector from "./StructureInspector.jsx";
import GroupTabStrip from "./GroupTabStrip.jsx";
import CitationPickerDialog from "./CitationPickerDialog.jsx";
import { CitationSourceDialog, FootnoteDialog, KnowledgeReferencePopover } from "./KnowledgeDialogs.jsx";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  closeWorkspaceView,
  createDocumentWorkspaceView,
  createWorkspaceGroupsState,
  findWorkspaceView,
  getActiveWorkspaceView,
  moveWorkspaceDocument,
  normalizeWorkspaceGroupsState,
  normalizeWorkspaceSplitRatio,
  openWorkspaceDocument,
  openWorkspaceResearch,
  removeWorkspaceViews,
  reorderWorkspaceView,
  restoreWorkspaceGroupsSnapshot,
  selectWorkspaceView,
  updateWorkspaceResearchTarget,
  updateWorkspaceResearchViewState,
} from "./workspace-groups.js";
import {
  researchPreviewKind,
} from "./research-ui-model.js";
import {
  deleteRecoveryBestEffort,
  readEditorSelectionState,
  replaceEditorContentWithoutHistory,
  restoreEditorSelectionWithoutHistory,
  sameDocumentPath,
  selectAutosaveSnapshotTabs,
  sessionTabSignature,
  snapshotRevisionIsCurrent,
} from "./editor-lifecycle.js";
import {
  AUDIO_MAX_BYTES,
  DOCUMENT_TITLE_MAX_CHARS,
  VIDEO_MAX_BYTES,
  normalizeImageText,
  normalizeMediaFileName,
  normalizeMediaMime,
} from "./content-limits.js";
import {
  normalizeImageSource,
  normalizeMediaSource,
} from "./resource-safety.js";
import { createLatestRequestController } from "./latest-request-controller.js";
import { deriveTabPersistenceState } from "./tab-persistence-state.js";
import {
  getLastStorageIssue,
  safeStorageGetItem,
  safeStorageSetItem,
  subscribeStorageIssues,
} from "./safe-storage.js";
import {
  isGlobalShortcutBlocked,
} from "./ui-interactions.js";
import { readCanvasScrollState, restoreCanvasScrollState } from "./document-workspace/canvas-state.js";
import {
  captureDocumentWorkspaceSnapshot,
  createPaneEditorHydrator,
  serializePaneDocument,
} from "./document-workspace/editor-runtime.js";
import { useDocumentRuntimeKernel } from "./document-workspace/document-runtime-kernel.js";
import { useDocumentWorkspaceState } from "./document-workspace/workspace-state.js";
import { listFolderWithTimeout } from "./document-workspace/folder-listing.js";
import {
  createBlankDocument,
  createDocumentTab,
  documentRuntimeKey,
  documentTabResourceKey,
  estimateSerializedBytes,
  inferTitle,
  normalizeDocument,
  paperCanvasViewModel,
  recoveryTabId,
  summarizeDocumentCache,
  summarizeSessionTabs,
  summarizeWorkspaceGroups,
  workspaceDocumentView,
} from "./document-workspace/model.js";
import { replacePathPrefix } from "./document-workspace/path-model.js";
import { normalizeSessionDiskRevision, sameDiskRevision } from "./document-workspace/revisions.js";


export default function App() {
  const {
    userTemplateGroups,
    setUserTemplateGroups,
    userLetterTemplates,
    setUserLetterTemplates,
    letterTemplates,
    newDocumentTemplateId,
    setNewDocumentTemplateId,
    newDocumentTemplateHistory,
    setNewDocumentTemplateHistory,
  } = useTemplateCatalogState();
  const {
    activePane,
    activePaneRef,
    activeTabId,
    activeTabIdRef,
    currentPath,
    currentPathRef,
    dirty,
    dirtyRef,
    documentState,
    documentStateRef,
    documentStorePort,
    groupStorePort,
    initialSession,
    openTabs,
    openTabsRef,
    rightSplitTabId,
    rightSplitTabIdRef,
    sessionClosePendingRef,
    sessionRef,
    sessionRestoredRef,
    sessionStatePort,
    setActivePane,
    setActiveTabId,
    setCurrentPath,
    setDirty,
    setDocumentPaneRatio,
    setDocumentState,
    setOpenTabs,
    setRightSplitTabId,
    setWorkspaceGroups,
    workspaceGroups,
    workspaceGroupsRef,
  } = useDocumentWorkspaceState({
    letterTemplates,
    newDocumentTemplateId,
  });
  const [folderState, setFolderState] = useState(() => ({
    rootPath: initialSession.folderPath || "",
    path: initialSession.folderPath || "",
    parentPath: "",
    folders: [],
    files: [],
    entries: [],
    loading: Boolean(initialSession.folderPath),
  }));
  const writingWorkspaceRoot = folderState.rootPath || folderState.path;
  const [expandedFolders, setExpandedFolders] = useState({});
  const [leftSidebarMode, setLeftSidebarMode] = useState("folder");
  const [structureMode, setStructureMode] = useState("outline");
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [searchMode, setSearchMode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState("");
  const [documentReplaceVisible, setDocumentReplaceVisible] = useState(false);
  const [documentReplaceValue, setDocumentReplaceValue] = useState("");
  const [documentSearchState, setDocumentSearchState] = useState(() => searchDocumentText({ type: "doc", content: [] }, ""));
  const [workspaceSearchState, setWorkspaceSearchState] = useState({ loading: false, results: [], error: "", requestId: "" });
  const [workSurfaceWidth, setWorkSurfaceWidth] = useState(0);
  const researchState = useResearchState(writingWorkspaceRoot);
  const {
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
    setResearchItemsByViewId,
    setResearchTreeError,
    webScopeKey,
    webTreeReady,
    webTreeState,
    webWorkspaceConnected,
    webWorkspaceIdentityPending,
    webWorkspaceMode,
    writingWorkspaceIdentity,
  } = researchState;
  const knowledgeState = useKnowledgeReferenceState();
  const {
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
  } = knowledgeState;
  const [immersiveMode, setImmersiveMode] = useState(false);
  const {
    aiApplyPreview,
    applyingAiBlockIndex,
    manualAiApply,
    manualFallbackAiBlockIndexes,
    setAiApplyPreview,
    setApplyingAiBlockIndex,
    setManualAiApply,
    setManualFallbackAiBlockIndexes,
  } = useAiApplyState();
  const [settingsDialog, setSettingsDialog] = useState({ open: false, section: "", targetTabId: "" });
  const [tabTemplateDialog, setTabTemplateDialog] = useTemplateTabDialogState();
  const {
    helpOpen,
    setHelpOpen,
    releaseNotesOpen,
    setReleaseNotesOpen,
  } = useHelpReleaseState();
  const {
    exportDialogOpen,
    setExportDialogOpen,
    exportTarget,
    setExportTarget,
    exportRenderPane,
    setExportRenderPane,
  } = useExportDialogState();
  const [status, setStatus] = useStatusState();
  const {
    printMode,
    setPrintMode,
    imageExportMode,
    setImageExportMode,
  } = useExportPresentationState();
  const {
    confirmDialog,
    setConfirmDialog,
    promptDialog,
    setPromptDialog,
  } = usePromiseDialogState();
  const [webSourceDialog, setWebSourceDialog] = useState({ open: false, source: null, folderId: "", scopeKey: "global" });
  const [webCopyDialog, setWebCopyDialog] = useState({ open: false });
  const [linkDialog, setLinkDialog] = useState(null);
  const [commentPanel, setCommentPanel] = useState(null);
  const [updateState, setUpdateState] = useUpdateState();
  const appVersion = updateState?.version || CURRENT_RELEASE_VERSION;
  const {
    aiConfig,
    aiSelectedProvider,
    setAiConfig,
    setAiSelectedProvider,
  } = useAiConfigState();
  const {
    aiModeChooserOpen,
    setAiModeChooserOpen,
    aiModeKind,
    setAiModeKind,
    aiPageTransition,
    setAiPageTransition,
    aiMode,
    aiOptimizeMode,
    aiChatMode,
  } = useAiModeState();
  const activeAiState = useMemo(() => normalizeAiState(documentState.aiState), [documentState.aiState]);
  const activeOptimizeState = activeAiState.optimize;
  const activeChatState = activeAiState.chat;
  const aiStatus = aiChatMode ? activeChatState.status : activeOptimizeState.status;
  const aiOutput = activeOptimizeState.output;
  const aiError = aiChatMode ? activeChatState.error : activeOptimizeState.error;
  const aiAssets = activeOptimizeState.assets;
  const aiElapsedSeconds = activeOptimizeState.elapsedSeconds;
  const aiTokenStats = activeOptimizeState.tokenStats;
  const aiChatMessages = activeChatState.messages;
  const aiChatInput = activeChatState.input;
  const aiChatSelections = activeChatState.selectedTexts;
  const aiChatCodexImageMode = activeChatState.codexImageMode;
  useWritingWorkspaceIdentityLifecycle({
    setWritingWorkspaceIdentity: researchState.setWritingWorkspaceIdentity,
    writingWorkspaceRoot,
  });
  useResearchWebScopePreferenceLifecycle(webWorkspaceMode);
  const applyingRef = useRef(false);
  const aiApplyInFlightRef = useRef(false);
  const readyRef = useRef(false);
  const editorSelectionRef = useRef(null);
  const { updateFlowRef, updateResultResetTimerRef } = useUpdateFlowRefs();
  const restoreRunRef = useRef(0);
  const mainCanvasRef = useRef(null);
  const rightCanvasRef = useRef(null);
  const workSurfaceRef = useRef(null);
  const documentRuntimeKernel = useDocumentRuntimeKernel({
    deferCommit: () => new Promise((resolve) => window.setTimeout(resolve, 0)),
  });
  const {
    dirtyPort: documentDirtyPort,
    revisionPort: documentRevisionPort,
    saveQueuePort: documentSaveQueuePort,
    tabRuntimePort: documentTabRuntimePort,
  } = documentRuntimeKernel;
  const updateAutoCheckedRef = useUpdateAutoCheckRef();
  const getSaveDocumentRef = useRef(null);
  const getRightSplitSaveDocumentRef = useRef(null);
  const refreshFolderRef = useRef(null);
  const folderPathRef = useRef(folderState.path);
  const expandedFoldersRef = useRef(expandedFolders);
  const folderRequestControllerRef = useRef(createLatestRequestController());
  const folderBranchRequestControllerRef = useRef(createLatestRequestController());
  const diskRevisionRequestControllerRef = useRef(createLatestRequestController());
  const researchRequestControllerRefs = useResearchRequestControllerRefs();
  const applyDocumentRunRef = useRef(0);
  const rightSplitSelectionRef = useRef(null);
  const rightSplitEditorRuntimeRef = useRef(null);
  const rightPaneEditorHydrator = useMemo(() => createPaneEditorHydrator({
    normalizeComments: normalizeDocumentComments,
    pane: {
      replaceContentWithoutHistory(content) {
        const runtimeEditor = rightSplitEditorRuntimeRef.current;
        if (runtimeEditor) {
          replaceEditorContentWithoutHistory(runtimeEditor, content);
        }
      },
      restoreSelectionWithoutHistory(selectionState) {
        const runtimeEditor = rightSplitEditorRuntimeRef.current;
        if (runtimeEditor) {
          restoreEditorSelectionWithoutHistory(runtimeEditor, selectionState);
        }
      },
      captureSelectionState() {
        const runtimeEditor = rightSplitEditorRuntimeRef.current;
        if (runtimeEditor) {
          rightSplitSelectionRef.current = readEditorSelectionState(runtimeEditor);
        }
      },
      syncComments(comments) {
        const runtimeEditor = rightSplitEditorRuntimeRef.current;
        if (runtimeEditor) {
          syncDocumentCommentDecorations(runtimeEditor, comments);
        }
      },
      restoreScrollState(scrollState) {
        restoreCanvasScrollState(rightCanvasRef.current, scrollState);
      },
    },
    scheduler: {
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      defer: (callback) => window.setTimeout(callback, 0),
    },
  }), []);
  const aiSecondaryPaneLayoutRef = useRef(null);
  const immersiveSecondaryPaneLayoutRef = useRef(null);
  const previousImmersiveModeRef = useRef(false);
  const aiModeTriggerRef = useRef(null);
  const settingsTriggerRef = useRef(null);
  const exportTriggerRef = useRef(null);
  const tabTemplateReturnFocusRef = useTemplateTabDialogReturnFocusRef();
  const aiStreamRegistry = useAiStreamRegistry();
  const aiPreviousSidebarsRef = useRef(null);
  const {
    confirmDialogResolverRef,
    promptDialogResolverRef,
  } = usePromiseDialogResolverRefs();
  const syncAiStreamChatMessages = useAiStreamChatMessagesSlot(aiStreamRegistry);
  const autosaveRunningRef = useRef(false);
  const autosaveErrorAtRef = useRef(0);
  const tabClosePendingIdsRef = useRef(new Set());
  const workspaceSearchRequestRef = useRef("");
  folderPathRef.current = folderState.path;
  expandedFoldersRef.current = expandedFolders;
  const closeInternalLinkPicker = useCallback(() => setInternalLinkPicker(null), []);

  useLayoutEffect(() => {
    const surface = workSurfaceRef.current;
    if (!surface) return undefined;
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const width = Math.max(0, Math.round(surface.getBoundingClientRect().width));
        setWorkSurfaceWidth((current) => current === width ? current : width);
      });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(surface);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const recordTabMutation = useCallback((tabId, updatedAt = new Date().toISOString()) => {
    if (!tabId) return false;
    const mutation = documentRevisionPort.recordMutation(tabId, { updatedAt });
    const { becameDirty } = mutation;
    if (tabId === activeTabIdRef.current) {
      dirtyRef.current = true;
      if (becameDirty) setDirty(true);
    }
    const recoveryBecameStale = mutation.recoveryBecameStale
      || openTabsRef.current.some((tab) => tab.id === tabId && tab.recoveryRevision != null);
    if (becameDirty || recoveryBecameStale) {
      const nextTabs = openTabsRef.current.map((tab) => (
        tab.id === tabId ? { ...tab, dirty: true, recoveryRevision: null } : tab
      ));
      documentStorePort.commitOpenTabs(nextTabs);
    }
    return becameDirty;
  }, []);

  const releaseTabRuntimeState = useCallback((tabId) => {
    documentTabRuntimePort.release(tabId);
  }, []);

  const queueTabSave = useCallback(async (tabId, operation) => {
    return documentSaveQueuePort.enqueue(tabId, operation);
  }, []);

  const waitForTabSave = useCallback(async (tabId) => {
    await documentSaveQueuePort.wait(tabId);
  }, []);

  const mainEditorExtensions = useMemo(() => createPaperEditorExtensions(), []);
  const rightEditorExtensions = useMemo(() => createPaperEditorExtensions(), []);
  const mainEditorOptions = useMemo(() => ({
    shouldRerenderOnTransaction: false,
    extensions: mainEditorExtensions,
    content: documentStateRef.current.html,
    editorProps: {
      attributes: {
        class: "paper-editor",
        spellcheck: "false",
      },
    },
    onCreate: () => {
      readyRef.current = true;
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      const { from, to } = activeEditor.state.selection;
      editorSelectionRef.current = { from, to };
    },
    onFocus: () => setActivePane("main"),
    onUpdate: ({ transaction }) => {
      if (transaction?.getMeta?.("paperKnowledgeDerived") || transaction?.getMeta?.("paperStructuredDerived")) return;
      if (applyingRef.current) return;
      const tabId = activeTabIdRef.current;
      documentTabRuntimePort.setEditorSource(tabId, "main");
      recordTabMutation(tabId);
    },
  }), [mainEditorExtensions, recordTabMutation]);
  const rightEditorOptions = useMemo(() => ({
    shouldRerenderOnTransaction: false,
    extensions: rightEditorExtensions,
    content: "<p></p>",
    editorProps: {
      attributes: {
        class: "paper-editor",
        spellcheck: "false",
      },
    },
    onSelectionUpdate: ({ editor: activeEditor }) => {
      const { from, to } = activeEditor.state.selection;
      rightSplitSelectionRef.current = { from, to };
    },
    onFocus: () => setActivePane("right"),
    onUpdate: ({ transaction }) => {
      if (transaction?.getMeta?.("paperKnowledgeDerived") || transaction?.getMeta?.("paperStructuredDerived")) return;
      if (rightPaneEditorHydrator.isApplying()) return;
      const splitId = rightSplitTabIdRef.current;
      if (!splitId) return;
      documentTabRuntimePort.setEditorSource(splitId, "right");
      recordTabMutation(splitId);
    },
  }), [recordTabMutation, rightEditorExtensions]);
  const activeSecondaryView = useMemo(
    () => getActiveWorkspaceView(workspaceGroups, WORKSPACE_GROUP_ID.SECONDARY),
    [workspaceGroups],
  );
  const rightSplitTab = useMemo(() => openTabs.find((tab) => tab.id === rightSplitTabId) || null, [openTabs, rightSplitTabId]);
  const rightSplitDocument = useMemo(() => {
    if (!rightSplitTab || rightSplitTab.id === activeTabId) {
      return null;
    }
    return rightSplitTab.document;
  }, [activeTabId, rightSplitTab]);

  const editor = useEditor(mainEditorOptions);

  const rightSplitEditor = useEditor(rightEditorOptions);
  rightSplitEditorRuntimeRef.current = rightSplitEditor;

  const researchPaneFocused = !aiMode
    && activePane === "right"
    && activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH;
  const splitPaneActive = !aiMode && activePane === "right" && Boolean(rightSplitTabId && rightSplitDocument && rightSplitEditor);
  const activeWorkEditor = researchPaneFocused ? null : (splitPaneActive ? rightSplitEditor : editor);
  const activeWorkDocument = researchPaneFocused ? null : (splitPaneActive ? rightSplitDocument : documentState);
  const activeWorkPath = researchPaneFocused ? "" : (splitPaneActive ? (rightSplitTab?.path || "") : currentPath);
  const activeWorkTabId = splitPaneActive ? rightSplitTabId : activeTabId;
  const activeWorkTab = openTabs.find((tab) => tab.id === activeWorkTabId) || null;
  const activeWorkPersistenceState = deriveTabPersistenceState(
    activeWorkTab,
    documentRevisionPort.readLiveRevision(activeWorkTabId),
  );
  const activeWorkSelectionRef = splitPaneActive ? rightSplitSelectionRef : editorSelectionRef;
  const {
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
  } = useKnowledgeReferenceDerived({
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
  });
  const primaryGroupTabs = useMemo(() => workspaceGroups.primary.views.map((view) => {
    const tab = openTabs.find((candidate) => candidate.id === view.tabId);
    const tabDocument = tab?.id === activeTabId ? documentState : tab?.document;
    return tab ? {
      viewId: view.viewId,
      tabId: tab.id,
      kind: WORKSPACE_VIEW_KIND.DOCUMENT,
      title: tab.title,
      path: tab.path,
      dirty: tab.dirty,
      letterTemplateId: getLetterTemplate(tabDocument, letterTemplates).id,
    } : null;
  }).filter(Boolean), [activeTabId, documentState.letterTemplateId, documentState.templateId, letterTemplates, openTabs, workspaceGroups.primary.views]);
  const secondaryGroupTabs = useMemo(() => workspaceGroups.secondary.views.map((view) => {
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      const tab = openTabs.find((candidate) => candidate.id === view.tabId);
      return tab ? {
        viewId: view.viewId,
        tabId: tab.id,
        kind: WORKSPACE_VIEW_KIND.DOCUMENT,
        title: tab.title,
        path: tab.path,
        dirty: tab.dirty,
        letterTemplateId: getLetterTemplate(tab.document, letterTemplates).id,
      } : null;
    }
    const item = researchItemsByViewId[view.viewId]
      || (view.sourceId ? librarySources.find((source) => source.id === view.sourceId) : null)
      || (activeSecondaryView?.viewId === view.viewId ? activeLibraryItem : null);
    const title = item?.title || item?.name || item?.fileName || view.titleSnapshot || view.relativePath || "未命名资料";
    const inferredResearchType = item?.type === "web"
      ? "web"
      : researchPreviewKind(item || { type: "file", relativePath: view.relativePath });
    const researchType = inferredResearchType === "unsupported"
      ? (view.researchType || "file")
      : inferredResearchType;
    const page = Number(view.viewState?.page) || 1;
    return {
      viewId: view.viewId,
      kind: WORKSPACE_VIEW_KIND.RESEARCH,
      researchType,
      title,
      path: view.relativePath || "",
      metaLabel: researchType === "pdf" ? `PDF · ${page}` : ({
        web: "网页",
        docx: "DOCX",
        markdown: "Markdown",
        text: "文本",
        table: "表格",
        image: "图片",
      }[researchType] || "资料"),
    };
  }).filter(Boolean), [activeLibraryItem, activeSecondaryView?.viewId, letterTemplates, librarySources, openTabs, researchItemsByViewId, workspaceGroups.secondary.views]);
  usePendingCitationPageLifecycle({
    page: derivePendingCitationPage({
      activeLibraryItem,
      activeSecondaryView,
      librarySources,
      researchItemsByViewId,
    }),
    setPendingCitationPage,
  });
  const activeTabReadOnly = Boolean(openTabs.find((tab) => tab.id === activeTabId)?.readOnly || documentState?._readOnlyFutureSchema);
  const rightSplitReadOnly = Boolean(rightSplitTab?.readOnly || rightSplitDocument?._readOnlyFutureSchema);
  const activeWorkReadOnly = splitPaneActive
    ? rightSplitReadOnly
    : activeTabReadOnly;
  const mainCanvasDocument = useMemo(() => paperCanvasViewModel(documentState), [
    documentState.author,
    documentState.createdAt,
    documentState.customBackground,
    documentState.displayDate,
    documentState.documentId,
    documentState.letterTemplateId,
    documentState.templateId,
    documentState.title,
  ]);
  const rightCanvasDocument = useMemo(() => paperCanvasViewModel(rightSplitDocument || {}), [
    rightSplitDocument?.author,
    rightSplitDocument?.createdAt,
    rightSplitDocument?.customBackground,
    rightSplitDocument?.displayDate,
    rightSplitDocument?.documentId,
    rightSplitDocument?.letterTemplateId,
    rightSplitDocument?.templateId,
    rightSplitDocument?.title,
  ]);
  const documentCacheSummary = useMemo(() => summarizeDocumentCache(openTabs), [openTabs]);
  const {
    aiApplyResolverLabel,
    aiHasUsableProvider,
    availableAiProviders,
    effectiveAiChoice,
    effectiveAiConfig,
    effectiveAiProvider,
  } = useAiConfigDerived({
    aiConfig,
    aiSelectedProvider,
  });
  const activeDocumentKey = useMemo(() => documentRuntimeKey(currentPath, activeTabId), [activeTabId, currentPath]);
  useAiApplyResetLifecycle({
    activeDocumentKey,
    aiOutput,
    setAiApplyPreview,
    setManualAiApply,
    setManualFallbackAiBlockIndexes,
  });

  const {
    resolveConfirmDialog,
    showConfirmDialog,
    resolvePromptDialog,
    showPromptDialog,
  } = usePromiseDialogActions({
    confirmDialogResolverRef,
    promptDialogResolverRef,
    setConfirmDialog,
    setPromptDialog,
  });

  const openSettings = useCallback(() => {
    setAiModeChooserOpen(false);
    setSettingsDialog({
      open: true,
      section: "",
      targetTabId: splitPaneActive && rightSplitTabId ? rightSplitTabId : activeTabIdRef.current,
    });
  }, [rightSplitTabId, splitPaneActive]);

  const openSettingsSection = useCallback((section) => {
    setSettingsDialog((current) => ({
      ...current,
      open: false,
      section: section === "template" ? "template" : "ai",
      targetTabId: current.targetTabId
        || (splitPaneActive && rightSplitTabId ? rightSplitTabId : activeTabIdRef.current),
    }));
  }, [rightSplitTabId, splitPaneActive]);
  const openAiSettings = useCallback(() => {
    setAiModeChooserOpen(false);
    setSettingsDialog({
      open: false,
      section: "ai",
      targetTabId: splitPaneActive && rightSplitTabId ? rightSplitTabId : activeTabIdRef.current,
    });
  }, [rightSplitTabId, splitPaneActive]);
  const closeSettings = useCallback(() => {
    setSettingsDialog((current) => ({ ...current, open: false, section: "" }));
  }, []);

  const {
    handleOpenGroupTabTemplate,
    closeTabTemplateDialog,
  } = useTemplateTabDialogActions(
    setTabTemplateDialog,
    tabTemplateReturnFocusRef,
  );

  usePromiseDialogOverlayLifecycle(confirmDialog, promptDialog);

  usePromiseDialogUnmountLifecycle(
    confirmDialogResolverRef,
    promptDialogResolverRef,
  );

  const aiDocumentPort = useAiDocumentPort({
    activeTabId,
    activeTabIdRef,
    currentPath,
    currentPathRef,
    documentStateRef,
    onRuntimeKeyRekey: aiStreamRegistry.rekeyDocument,
    openTabsRef,
    recordTabMutation,
    setDocumentState,
    setOpenTabs,
  });
  const {
    getActiveDocumentKey,
    getActiveDocumentSnapshot,
    migrateAiRequestDocumentKey,
    updateActiveDocumentAiState,
    updateChatState,
    updateChatStateForKey,
    updateOptimizeState,
    updateOptimizeStateForKey,
  } = useAiDocumentStateActions(aiDocumentPort);

  useEffect(() => {
    syncAiChatSelectionDecorations(editor, aiChatMode ? aiChatSelections : []);
  }, [aiChatMode, aiChatSelections, editor]);

  useEffect(() => {
    syncDocumentCommentDecorations(editor, documentState.comments);
  }, [documentState.comments, editor]);

  useEffect(() => {
    syncDocumentCommentDecorations(rightSplitEditor, rightSplitDocument?.comments);
  }, [rightSplitDocument?.comments, rightSplitEditor]);

  useEffect(() => {
    const hidden = aiMode || printMode || imageExportMode;
    setDocumentCommentVisibility(editor, hidden);
    setDocumentCommentVisibility(rightSplitEditor, hidden);
  }, [aiMode, editor, imageExportMode, printMode, rightSplitEditor]);

  useEffect(() => {
    if (aiMode || printMode || imageExportMode) {
      setCommentPanel(null);
    }
  }, [aiMode, imageExportMode, printMode]);

  const persistSession = sessionStatePort.commitSessionPatch;

  usePersistUserTemplateGroups(userTemplateGroups);

  usePersistUserLetterTemplates(userLetterTemplates, userTemplateGroups);

  usePersistNewDocumentTemplateId(newDocumentTemplateId);

  usePersistNewDocumentTemplateHistory(newDocumentTemplateHistory);

  useNormalizeNewDocumentTemplateHistory(
    letterTemplates,
    setNewDocumentTemplateHistory,
  );

  useEffect(() => {
    openTabsRef.current = openTabs;
    openTabs.forEach((tab) => {
      documentTabRuntimePort.syncReactMirror(tab.id, {
        dirty: tab.dirty,
        diskRevision: tab.diskRevision,
        liveUpdatedAt: tab.document?.updatedAt,
        recoveryRevision: tab.recoveryRevision,
      });
    });
    if (dirty && activeTabId) documentDirtyPort.markDirty(activeTabId);
  }, [activeTabId, dirty, openTabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    workspaceGroupsRef.current = workspaceGroups;
    safeStorageSetItem("paperwriter.workspaceSplitRatio", String(workspaceGroups.splitRatio));
  }, [workspaceGroups]);

  useEffect(() => {
    activePaneRef.current = activePane;
    const focusedGroup = activePane === "right" && workspaceGroups.secondary.views.length
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY;
    if (workspaceGroups.focusedGroup !== focusedGroup) {
      setWorkspaceGroups((previous) => previous.focusedGroup === focusedGroup
        ? previous
        : { ...previous, focusedGroup });
    }
  }, [activePane, workspaceGroups.focusedGroup, workspaceGroups.secondary.views.length]);

  useEffect(() => {
    rightSplitTabIdRef.current = rightSplitTabId;
  }, [rightSplitTabId]);

  useEffect(() => {
    const activeSecondary = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
    if (!activeSecondary) {
      if (activePane === "right") {
        setActivePane("main");
      }
      return;
    }
    if (activeSecondary.kind === WORKSPACE_VIEW_KIND.RESEARCH) return;
    if (rightSplitTabId === activeTabId || !openTabs.some((tab) => tab.id === rightSplitTabId)) {
      rightSplitTabIdRef.current = "";
      setRightSplitTabId("");
      setActivePane("main");
    }
  }, [activePane, activeTabId, openTabs, rightSplitTabId, setRightSplitTabId, workspaceGroups]);

  useEffect(() => {
    if (!rightSplitEditor || !rightSplitTabId) {
      return;
    }
    const splitTab = openTabsRef.current.find((tab) => tab.id === rightSplitTabId);
    const splitDocument = splitTab?.id === activeTabIdRef.current ? documentStateRef.current : splitTab?.document;
    if (!splitDocument) {
      return;
    }
    rightPaneEditorHydrator.hydrate({
      comments: splitDocument.comments,
      editorJson: splitTab?.editorJson,
      html: splitDocument.html || "<p></p>",
      scrollState: splitTab?.scrollState,
      selectionState: splitTab?.selectionState,
    });
  }, [rightSplitEditor, rightSplitTabId]);

  useEffect(() => {
    currentPathRef.current = currentPath;
    if (currentPath) {
      persistSession({ activePath: currentPath });
    }
  }, [currentPath, persistSession]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    documentStateRef.current = documentState;
  }, [documentState]);

  useEffect(() => {
    syncAiStreamChatMessages(aiChatMessages);
  }, [aiChatMessages]);

  useEffect(() => {
    if (writingWorkspaceRoot) {
      persistSession({ folderPath: writingWorkspaceRoot });
    }
  }, [persistSession, writingWorkspaceRoot]);

  useEffect(() => {
    if (!activeTabId) {
      return;
    }
    setOpenTabs((tabs) => {
      let changed = false;
      const nextTabs = tabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const title = documentState.title || "未命名信笺";
        if (tab.path === currentPath && tab.title === title && tab.dirty === dirty) return tab;
        changed = true;
        return { ...tab, path: currentPath, title, dirty };
      });
      if (!changed) return tabs;
      openTabsRef.current = nextTabs;
      return nextTabs;
    });
  }, [activeTabId, currentPath, dirty, documentState.title]);

  const { showStatus, dismissStatus } = useStatusActions(setStatus);

  useEffect(() => {
    let warned = false;
    const warn = (issue) => {
      if (!issue || warned) return;
      warned = true;
      showStatus(
        "浏览器存储暂时不可用；界面设置仅保留到当前会话，需要持久保存的浏览器操作会明确提示失败",
        "warning",
        { duration: 6000, dismissible: true },
      );
    };
    warn(getLastStorageIssue());
    return subscribeStorageIssues(warn);
  }, [showStatus]);

  const { toggleAiModeChooser } = useAiModeChooserActions({
    activeTabReadOnly,
    aiHasUsableProvider,
    aiModeChooserOpen,
    openAiSettings,
    setAiModeChooserOpen,
    showStatus,
  });

  const isDocumentPaneReadOnly = useCallback((pane) => {
    const targetTabId = pane === "right" ? rightSplitTabIdRef.current : activeTabIdRef.current;
    const targetTab = openTabsRef.current.find((tab) => tab.id === targetTabId);
    const targetDocument = pane === "right" ? targetTab?.document : documentStateRef.current;
    return !targetTab || Boolean(targetTab.readOnly || targetDocument?._readOnlyFutureSchema);
  }, []);

  const updateCommentsForPane = useCallback((pane, updater) => {
    if (isDocumentPaneReadOnly(pane)) {
      showStatus("当前信笺为只读，不能修改评注", "warning");
      return false;
    }
    const updatedAt = new Date().toISOString();
    const sourceEditor = pane === "right" ? rightSplitEditor : editor;
    const applyCommentUpdate = (document) => {
      const previousComments = getDocumentComments(sourceEditor, document?.comments);
      const nextComments = normalizeDocumentComments(
        typeof updater === "function" ? updater(previousComments) : updater,
      );
      return {
        ...document,
        comments: nextComments,
        updatedAt,
      };
    };

    if (pane === "right") {
      const splitId = rightSplitTabIdRef.current;
      if (!splitId) {
        return;
      }
      recordTabMutation(splitId, updatedAt);
      const nextTabs = openTabsRef.current.map((tab) => (
        tab.id === splitId ? { ...tab, document: applyCommentUpdate(tab.document), dirty: true } : tab
      ));
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
      if (splitId === activeTabIdRef.current) {
        setDocumentState((previous) => {
          const nextDocument = applyCommentUpdate(previous);
          documentStateRef.current = nextDocument;
          return nextDocument;
        });
      }
      return true;
    }

    const tabId = activeTabIdRef.current;
    recordTabMutation(tabId, updatedAt);
    const nextDocument = applyCommentUpdate(documentStateRef.current);
    documentStateRef.current = nextDocument;
    setDocumentState(nextDocument);
    return true;
  }, [editor, isDocumentPaneReadOnly, recordTabMutation, rightSplitEditor, showStatus]);

  const commentPanelComment = useMemo(() => {
    if (!commentPanel?.commentId) {
      return null;
    }
    const sourceDocument = commentPanel.pane === "right" ? rightSplitDocument : documentState;
    return normalizeDocumentComments(sourceDocument?.comments).find((comment) => comment.id === commentPanel.commentId) || null;
  }, [commentPanel, documentState, rightSplitDocument]);

  useEffect(() => {
    if (commentPanel?.commentId && !commentPanelComment) {
      setCommentPanel(null);
    }
  }, [commentPanel?.commentId, commentPanelComment]);

  const handleStartComment = useCallback((pane, selection, position) => {
    if (isDocumentPaneReadOnly(pane)) {
      showStatus("当前信笺为只读，不能添加评注", "warning");
      return;
    }
    if (!selection?.text || selection.from === selection.to) {
      showStatus("请先选中要评注的文字", "warning");
      return;
    }
    const sourceEditor = pane === "right" ? rightSplitEditor : editor;
    const sourceDocument = pane === "right" ? rightSplitDocument : documentState;
    if (!commentAnchorTrackAvailable(sourceEditor, getDocumentComments(sourceEditor, sourceDocument?.comments), selection)) {
      showStatus("这里的评注已经太密，暂时不能继续添加", "warning");
      return;
    }
    setCommentPanel({
      mode: "create",
      pane,
      selection,
      text: "",
      x: Math.max(12, Math.min(position?.left || window.innerWidth / 2, window.innerWidth - 352)),
      y: Math.max(52, Math.min((position?.top || 120) + 22, window.innerHeight - 300)),
    });
  }, [documentState, editor, isDocumentPaneReadOnly, rightSplitDocument, rightSplitEditor, showStatus]);

  const handleOpenComment = useCallback((pane, comment, position) => {
    if (!comment?.id) {
      return;
    }
    setCommentPanel({
      mode: "view",
      pane,
      commentId: comment.id,
      text: comment.text || "",
      x: Math.max(12, Math.min((position?.left || window.innerWidth / 2) + 12, window.innerWidth - 352)),
      y: Math.max(52, Math.min((position?.top || 120) - 8, window.innerHeight - 300)),
    });
  }, []);

  const handleSaveCommentPanel = useCallback(() => {
    if (!commentPanel) {
      return;
    }
    const text = commentPanel.text?.trim();
    if (!text) {
      showStatus("评注内容不能为空", "warning");
      return;
    }
    const now = new Date().toISOString();
    if (commentPanel.mode === "create") {
      const nextComment = {
        id: createDocumentCommentId(),
        from: commentPanel.selection.from,
        to: commentPanel.selection.to,
        text,
        quote: commentPanel.selection.text.slice(0, 280),
        createdAt: now,
        updatedAt: now,
      };
      if (!updateCommentsForPane(commentPanel.pane, (comments) => [...comments, nextComment])) return;
      setCommentPanel(null);
      showStatus("评注已添加", "success");
      return;
    }
    if (commentPanel.mode === "edit" && commentPanel.commentId) {
      if (!updateCommentsForPane(commentPanel.pane, (comments) => comments.map((comment) => (
        comment.id === commentPanel.commentId
          ? { ...comment, text, updatedAt: now }
          : comment
      )))) return;
      setCommentPanel((panel) => panel ? { ...panel, mode: "view", text } : panel);
      showStatus("评注已更新", "success");
    }
  }, [commentPanel, showStatus, updateCommentsForPane]);

  const handleEditCommentPanel = useCallback(() => {
    if (!commentPanel?.commentId || !commentPanelComment) {
      return;
    }
    if (isDocumentPaneReadOnly(commentPanel.pane)) {
      showStatus("当前信笺为只读，不能编辑评注", "warning");
      return;
    }
    setCommentPanel((panel) => panel ? { ...panel, mode: "edit", text: commentPanelComment.text || "" } : panel);
  }, [commentPanel, commentPanelComment, isDocumentPaneReadOnly, showStatus]);

  const handleDeleteCommentPanel = useCallback(async () => {
    if (!commentPanel?.commentId) {
      return;
    }
    if (isDocumentPaneReadOnly(commentPanel.pane)) {
      showStatus("当前信笺为只读，不能删除评注", "warning");
      return;
    }
    const decision = await showConfirmDialog({
      tone: "warning",
      icon: MessageSquare,
      eyebrow: "删除评注",
      title: "要删除这条评注吗？",
      message: "删除后，这条评注和正文侧边的标记都会移除。",
      cancelValue: "cancel",
      actions: [
        { value: "delete", label: "删除评注", variant: "danger", icon: Trash2 },
        { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
      ],
    });
    if (decision !== "delete") {
      return;
    }
    if (!updateCommentsForPane(commentPanel.pane, (comments) => comments.filter((comment) => comment.id !== commentPanel.commentId))) return;
    setCommentPanel(null);
    showStatus("评注已删除", "success");
  }, [commentPanel, isDocumentPaneReadOnly, showConfirmDialog, showStatus, updateCommentsForPane]);

  const handleClearDocumentCache = useCallback(() => {
    setOpenTabs((tabs) => {
      const nextTabs = tabs.map((tab) => (
        tab.editorJson ? { ...tab, editorJson: null, editorJsonBytes: 0 } : tab
      ));
      openTabsRef.current = nextTabs;
      return nextTabs;
    });
    showStatus("已清理信笺切换缓存", "success");
  }, [showStatus]);

  const snapshotLiveTabs = useCallback(({ includeEditorJson = false } = {}) => {
    const activeId = activeTabIdRef.current;
    const splitId = rightSplitTabIdRef.current;
    return captureDocumentWorkspaceSnapshot({
      activeDocument: documentStateRef.current,
      activeTabId: activeId,
      currentDirty: dirtyRef.current,
      currentPath: currentPathRef.current,
      estimateSerializedBytes,
      includeEditorJson,
      mainPane: {
        serializeDocument: () => getSaveDocumentRef.current?.(),
        readEditorJson: () => editor?.getJSON?.() || null,
        readScrollState: () => readCanvasScrollState(mainCanvasRef.current),
      },
      revisionPort: documentRevisionPort,
      rightPane: {
        serializeDocument: () => getRightSplitSaveDocumentRef.current?.(),
        readEditorJson: () => rightSplitEditor?.getJSON?.() || null,
        readScrollState: () => readCanvasScrollState(rightCanvasRef.current),
        readSelectionState: () => readEditorSelectionState(rightSplitEditor),
      },
      rightTabId: splitId,
      runtimePort: {
        isDirty: (tabId) => documentDirtyPort.isDirty(tabId),
        readEditorSource: (tabId) => documentTabRuntimePort.readEditorSource(tabId),
      },
      tabs: openTabsRef.current,
    });
  }, [editor, rightSplitEditor]);

  const openSearch = useCallback((scope = "document", options = {}) => {
    if (scope === "workspace" && !writingWorkspaceRoot) {
      showStatus("请先打开一个文件夹", "warning");
      return;
    }
    setSearchMode(scope === "workspace" ? "workspace" : "document");
    if (scope !== "workspace") setDocumentReplaceVisible(Boolean(options.replace));
  }, [showStatus, writingWorkspaceRoot]);

  const closeSearch = useCallback(() => {
    setSearchMode("");
    renderDocumentSearchState(activeWorkEditor, null);
  }, [activeWorkEditor]);

  const moveDocumentSearch = useCallback((delta) => {
    setDocumentSearchState((previous) => {
      const next = moveActiveDocumentSearchMatch(previous, delta);
      if (next.activeMatch) {
        window.setTimeout(() => activeWorkEditor?.chain().focus().setTextSelection(next.activeMatch.from).scrollIntoView().run(), 0);
      }
      return next;
    });
  }, [activeWorkEditor]);

  useEffect(() => {
    if (!activeWorkEditor) return undefined;
    const update = () => {
      const next = searchDocumentText(activeWorkEditor.state.doc, searchMode === "document" ? searchQuery : "");
      setDocumentSearchState(next);
    };
    update();
    activeWorkEditor.on("update", update);
    return () => activeWorkEditor.off("update", update);
  }, [activeWorkEditor, searchMode, searchQuery]);

  useEffect(() => {
    renderDocumentSearchState(activeWorkEditor, searchMode === "document" ? documentSearchState : null);
  }, [activeWorkEditor, documentSearchState, searchMode]);

  const replaceDocumentSearchMatches = useCallback((replaceAll = false) => {
    if (!activeWorkEditor || activeWorkReadOnly) {
      if (activeWorkReadOnly) showStatus("当前文档为只读，不能替换", "warning");
      return;
    }
    const matches = replaceAll
      ? documentSearchState.matches
      : (documentSearchState.activeMatch ? [documentSearchState.activeMatch] : []);
    if (!matches.length) return;
    const transaction = activeWorkEditor.state.tr;
    applyDocumentTextReplacements(transaction, matches, documentReplaceValue);
    if (!transaction.docChanged) return;
    activeWorkEditor.view.dispatch(transaction.scrollIntoView());
    activeWorkEditor.commands.focus();
    showStatus(replaceAll ? `已替换 ${matches.length} 处匹配` : "已替换当前匹配", "success");
  }, [activeWorkEditor, activeWorkReadOnly, documentReplaceValue, documentSearchState, showStatus]);

  useEffect(() => {
    if (searchMode !== "workspace" || !writingWorkspaceRoot) return undefined;
    const query = workspaceSearchQuery.trim();
    const previousRequest = workspaceSearchRequestRef.current;
    if (previousRequest) bridge.cancelFolderSearch?.(writingWorkspaceRoot, previousRequest).catch?.(() => {});
    if (!query) {
      setWorkspaceSearchState({ loading: false, results: [], error: "", requestId: "" });
      return undefined;
    }
    const requestId = `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    workspaceSearchRequestRef.current = requestId;
    setWorkspaceSearchState({ loading: true, results: [], error: "", requestId });
    const timer = window.setTimeout(async () => {
      try {
        const overrides = snapshotLiveTabs().filter((tab) => tab.path && tab.dirty).map((tab) => ({ path: tab.path, document: tab.document }));
        const result = await bridge.searchFolder?.({ folderPath: writingWorkspaceRoot, query, requestId, overrides, limit: 100 });
        if (workspaceSearchRequestRef.current !== requestId || result?.canceled) return;
        const results = (result?.results || []).map((item) => ({
          ...item,
          query: result?.query || query,
          snippetRanges: item.snippetMatchStart >= 0 ? [{ from: item.snippetMatchStart, to: item.snippetMatchStart + item.snippetMatchLength }] : [],
        }));
        setWorkspaceSearchState({ loading: false, results, error: "", requestId });
      } catch (error) {
        if (workspaceSearchRequestRef.current === requestId) setWorkspaceSearchState({ loading: false, results: [], error: error?.message || "工作区搜索失败", requestId });
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      bridge.cancelFolderSearch?.(writingWorkspaceRoot, requestId).catch?.(() => {});
    };
  }, [searchMode, snapshotLiveTabs, workspaceSearchQuery, writingWorkspaceRoot]);

  const verifyOpenDiskRevisions = useCallback(async () => {
    const request = diskRevisionRequestControllerRef.current.begin("open-documents");
    const checks = snapshotLiveTabs().filter((tab) => tab.path).map((tab) => ({
      id: tab.id,
      path: tab.path,
      expected: documentRevisionPort.readDiskRevision(tab.id) || tab.diskRevision || null,
    }));
    const outcomes = await Promise.all(checks.map(async (check) => {
      try {
        const result = await bridge.getDocumentRevision?.(check.path);
        return { ...check, actual: result?.diskRevision || null, failed: false };
      } catch {
        return { ...check, actual: null, failed: true };
      }
    }));
    if (!diskRevisionRequestControllerRef.current.isCurrent(request)) return new Set();
    const outcomeById = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
    const changedIds = new Set();
    const newlyChangedIds = new Set();
    const nextTabs = openTabsRef.current.map((tab) => {
      const outcome = outcomeById.get(tab.id);
      if (!outcome || !sameDocumentPath(tab.path, outcome.path)) return tab;
      const currentExpected = documentRevisionPort.readDiskRevision(tab.id) || tab.diskRevision || null;
      const expectedStillCurrent = outcome.expected
        ? Boolean(currentExpected && sameDiskRevision(currentExpected, outcome.expected))
        : !currentExpected;
      if (!expectedStillCurrent) return tab;
      if (!outcome.expected && outcome.actual && !outcome.failed) {
        documentRevisionPort.commitDiskRevision(tab.id, outcome.actual);
      }
      const externalChanged = Boolean(
        outcome.expected
        && (outcome.failed || !sameDiskRevision(outcome.actual, outcome.expected)),
      );
      if (externalChanged) {
        changedIds.add(tab.id);
        if (!tab.externalChanged) newlyChangedIds.add(tab.id);
      }
      return tab.externalChanged === externalChanged ? tab : { ...tab, externalChanged };
    });
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    diskRevisionRequestControllerRef.current.finish(request);
    const focusedSecondary = workspaceGroupsRef.current.focusedGroup === WORKSPACE_GROUP_ID.SECONDARY
      ? getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY)
      : null;
    const activeId = focusedSecondary?.kind === WORKSPACE_VIEW_KIND.DOCUMENT
      ? focusedSecondary.tabId
      : activeTabIdRef.current;
    if (newlyChangedIds.has(activeId)) {
      showStatus("检测到磁盘上的外部版本；保存时会保护两个版本", "warning");
    }
    return changedIds;
  }, [showStatus, snapshotLiveTabs]);

  useEffect(() => {
    bridge.watchWorkspace?.(writingWorkspaceRoot || "").catch?.(() => {});
    if (!writingWorkspaceRoot) return undefined;
    const onChanged = (payload = {}) => {
      if (payload.rootPath && !sameDocumentPath(payload.rootPath, writingWorkspaceRoot)) return;
      refreshFolderRef.current?.();
      verifyOpenDiskRevisions();
    };
    const unsubscribeChanged = bridge.onWorkspaceChanged?.(onChanged);
    const unsubscribeError = bridge.onWorkspaceWatchError?.((payload) => showStatus(payload?.message || "工作区文件监听不可用；仍会在保存前校验", "warning"));
    return () => {
      unsubscribeChanged?.();
      unsubscribeError?.();
    };
  }, [showStatus, verifyOpenDiskRevisions, writingWorkspaceRoot]);

  useEffect(() => bridge.onWindowFocus?.(() => verifyOpenDiskRevisions()), [verifyOpenDiskRevisions]);

  const activeSessionPath = currentPath
    || openTabs.find((tab) => tab.id === activeTabId)?.recoveryPath
    || "";
  const sessionPathSignature = useMemo(
    () => sessionTabSignature(activeSessionPath, openTabs),
    [activeSessionPath, openTabs],
  );
  const workspaceGroupsSessionSnapshot = useMemo(
    () => summarizeWorkspaceGroups(workspaceGroups, openTabs),
    [openTabs, workspaceGroups],
  );
  const workspaceGroupsSessionSignature = useMemo(
    () => JSON.stringify(workspaceGroupsSessionSnapshot),
    [workspaceGroupsSessionSnapshot],
  );

  useEffect(() => {
    if (!sessionRestoredRef.current) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const liveTabs = openTabsRef.current.map((tab) => (
        tab.id === activeTabIdRef.current ? { ...tab, path: currentPathRef.current } : tab
      ));
      persistSession({
        activePath: currentPathRef.current
          || liveTabs.find((tab) => tab.id === activeTabIdRef.current)?.recoveryPath
          || "",
        tabs: summarizeSessionTabs(liveTabs),
        workspaceGroups: summarizeWorkspaceGroups(workspaceGroupsRef.current, liveTabs),
      });
    }, 220);
    return () => window.clearTimeout(timer);
  }, [persistSession, sessionPathSignature, workspaceGroupsSessionSignature]);

  useAiConfigLifecycle({
    aiConfigActiveModelKey: aiConfig.activeModelKey,
    aiMode,
    setAiConfig,
    setAiSelectedProvider,
  });

  useEffect(() => {
    if (!editor) {
      return undefined;
    }
    editor.setEditable(!activeTabReadOnly && !(aiMode && aiStatus === "streaming") && !aiApplyPreview);
    return () => {
      editor.setEditable(true);
    };
  }, [activeTabReadOnly, aiApplyPreview, aiMode, aiStatus, editor]);

  useEffect(() => {
    if (!rightSplitEditor) {
      return undefined;
    }
    rightSplitEditor.setEditable(!rightSplitReadOnly);
    return () => {
      rightSplitEditor.setEditable(true);
    };
  }, [rightSplitEditor, rightSplitReadOnly]);

  useAiElapsedLifecycle({
    aiMode,
    aiStatus,
    registry: aiStreamRegistry,
    updateChatStateForKey,
    updateOptimizeStateForKey,
  });

  useAiStreamEventsLifecycle({
    registry: aiStreamRegistry,
    showStatus,
    updateChatStateForKey,
    updateOptimizeStateForKey,
  });

  const {
    openHelpCenter,
    closeHelpCenter,
    openReleaseNotes,
    closeReleaseNotes,
  } = useHelpReleaseActions(setHelpOpen, setReleaseNotesOpen);

  const clearUpdateResultReset = useClearUpdateResultReset(updateResultResetTimerRef);

  const scheduleUpdateResultReset = useScheduleUpdateResultReset(
    clearUpdateResultReset,
    updateResultResetTimerRef,
    setUpdateState,
  );

  useUpdateEventsLifecycle({
    clearUpdateResultReset,
    scheduleUpdateResultReset,
    setUpdateState,
    showStatus,
    updateFlowRef,
  });

  const handleRunUpdate = useRunUpdateAction({
    clearUpdateResultReset,
    scheduleUpdateResultReset,
    setUpdateState,
    showStatus,
    updateFlowRef,
    updateStatus: updateState?.status,
  });

  useUpdateAutoCheckLifecycle({
    scheduleUpdateResultReset,
    setUpdateState,
    updateAutoCheckedRef,
  });

  const applyDocument = useCallback(
    (nextDocument, nextPath = "", nextDirty = false, options = {}) => {
      const startedAt = window.performance?.now?.() || Date.now();
      const normalized = normalizeDocument(nextDocument, letterTemplates);
      const runId = applyDocumentRunRef.current + 1;
      applyDocumentRunRef.current = runId;
      applyingRef.current = true;
      documentStateRef.current = normalized;
      currentPathRef.current = nextPath;
      dirtyRef.current = nextDirty;
      const activeId = activeTabIdRef.current;
      documentTabRuntimePort.setEditorSource(activeId, "main");
      documentRevisionPort.commitLiveUpdatedAt(activeId, normalized.updatedAt);
      if (nextDirty) documentDirtyPort.markDirty(activeId);
      else documentDirtyPort.markClean(activeId);
      setDocumentState(normalized);
      setCurrentPath(nextPath);
      setDirty(nextDirty);
      window.requestAnimationFrame(() => {
        if (applyDocumentRunRef.current !== runId) {
          return;
        }
        const setContentStartedAt = window.performance?.now?.() || Date.now();
        let contentSource = options.editorJson ? "json-cache" : "html";
        try {
          replaceEditorContentWithoutHistory(editor, options.editorJson || normalized.html || "<p></p>");
        } catch (error) {
          contentSource = "html-fallback";
          replaceEditorContentWithoutHistory(editor, normalized.html || "<p></p>");
          bridge.debugLog?.("renderer:document:set-content-fallback", {
            path: nextPath,
            message: error?.message || String(error),
          });
        }
        syncDocumentCommentDecorations(editor, normalized.comments);
        setDocumentCommentVisibility(editor, aiMode || printMode || imageExportMode);
        const setContentMs = (window.performance?.now?.() || Date.now()) - setContentStartedAt;
        bridge.debugLog?.("renderer:document:applied", {
          path: nextPath,
          contentSource,
          htmlChars: (normalized.html || "").length,
          setContentMs: Math.round(setContentMs),
          totalMs: Math.round((window.performance?.now?.() || Date.now()) - startedAt),
        });
        window.requestAnimationFrame(() => {
          if (applyDocumentRunRef.current === runId) {
            restoreCanvasScrollState(mainCanvasRef.current, options.scrollState);
          }
        });
        window.setTimeout(() => {
          if (applyDocumentRunRef.current === runId) {
            applyingRef.current = false;
          }
        }, 0);
      });
    },
    [aiMode, editor, imageExportMode, letterTemplates, printMode],
  );

  const getSaveDocument = useCallback(() => {
    const sourceDocument = documentStateRef.current;
    return serializePaneDocument({
      inferTitle,
      letterTemplates,
      liveUpdatedAt: documentRevisionPort.readLiveUpdatedAt(activeTabIdRef.current),
      normalizeDocument,
      pane: {
        readComments: (fallback) => getDocumentComments(editor, fallback),
        readHtml: () => editor?.getHTML(),
        readText: () => editor?.getText(),
      },
      sourceDocument,
      stripDerivedHtml: stripDerivedKnowledgeDataFromHtml,
    });
  }, [editor, letterTemplates]);

  const getRightSplitSaveDocument = useCallback(() => {
    const splitId = rightSplitTabIdRef.current;
    const splitTab = openTabsRef.current.find((tab) => tab.id === splitId);
    const sourceDocument = splitId === activeTabIdRef.current
      ? documentStateRef.current
      : (splitTab?.document || rightSplitDocument);
    if (!sourceDocument) {
      return null;
    }
    return serializePaneDocument({
      inferTitle,
      letterTemplates,
      liveUpdatedAt: documentRevisionPort.readLiveUpdatedAt(splitId),
      normalizeDocument,
      pane: {
        readComments: (fallback) => getDocumentComments(rightSplitEditor, fallback),
        readHtml: () => rightSplitEditor?.getHTML(),
        readText: () => rightSplitEditor?.getText(),
      },
      sourceDocument,
      stripDerivedHtml: stripDerivedKnowledgeDataFromHtml,
    });
  }, [letterTemplates, rightSplitDocument, rightSplitEditor]);

  useEffect(() => {
    getSaveDocumentRef.current = getSaveDocument;
  }, [getSaveDocument]);

  useEffect(() => {
    getRightSplitSaveDocumentRef.current = getRightSplitSaveDocument;
  }, [getRightSplitSaveDocument]);

  const handleTitleChange = useCallback((title) => {
    if (activeTabReadOnly) return;
    const tabId = activeTabIdRef.current;
    const updatedAt = new Date().toISOString();
    recordTabMutation(tabId, updatedAt);
    const nextDocument = { ...documentStateRef.current, title: String(title || "").slice(0, DOCUMENT_TITLE_MAX_CHARS), updatedAt };
    documentStateRef.current = nextDocument;
    setDocumentState(nextDocument);
  }, [activeTabReadOnly, recordTabMutation]);

  const handleAuthorChange = useCallback((author) => {
    if (activeTabReadOnly) return;
    const tabId = activeTabIdRef.current;
    const updatedAt = new Date().toISOString();
    recordTabMutation(tabId, updatedAt);
    const nextDocument = { ...documentStateRef.current, author: author.slice(0, 40), updatedAt };
    documentStateRef.current = nextDocument;
    setDocumentState(nextDocument);
  }, [activeTabReadOnly, recordTabMutation]);

  const handleDateChange = useCallback((displayDate) => {
    if (activeTabReadOnly) return;
    const tabId = activeTabIdRef.current;
    const updatedAt = new Date().toISOString();
    recordTabMutation(tabId, updatedAt);
    const nextDocument = { ...documentStateRef.current, displayDate: displayDate.slice(0, 40), updatedAt };
    documentStateRef.current = nextDocument;
    setDocumentState(nextDocument);
  }, [activeTabReadOnly, recordTabMutation]);

  const updateRightSplitDocument = useCallback((patch) => {
    if (rightSplitReadOnly) return;
    const splitId = rightSplitTabIdRef.current;
    if (!splitId) {
      return;
    }
    const updatedAt = new Date().toISOString();
    recordTabMutation(splitId, updatedAt);
    const nextTabs = openTabsRef.current.map((tab) => (
      tab.id === splitId
        ? { ...tab, title: patch.title ?? tab.title, document: { ...tab.document, ...patch, updatedAt }, dirty: true }
        : tab
    ));
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    if (splitId === activeTabIdRef.current) {
      setDocumentState((previous) => {
        const nextDocument = { ...previous, ...patch, updatedAt };
        documentStateRef.current = nextDocument;
        return nextDocument;
      });
    }
  }, [recordTabMutation, rightSplitReadOnly]);

  const handleRightSplitTitleChange = useCallback((title) => {
    updateRightSplitDocument({ title: String(title || "").slice(0, DOCUMENT_TITLE_MAX_CHARS) });
  }, [updateRightSplitDocument]);

  const handleRightSplitAuthorChange = useCallback((author) => {
    updateRightSplitDocument({ author: author.slice(0, 40) });
  }, [updateRightSplitDocument]);

  const handleRightSplitDateChange = useCallback((displayDate) => {
    updateRightSplitDocument({ displayDate: displayDate.slice(0, 40) });
  }, [updateRightSplitDocument]);

  const updateDocumentSplitRatio = useCallback((value) => {
    const next = normalizeWorkspaceSplitRatio(value);
    setDocumentPaneRatio(next);
  }, []);

  const startDocumentSplitResize = useCallback((event) => {
    if (event.button !== 0) return;
    const workspace = event.currentTarget.closest(".paper-workspace");
    if (!workspace) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    const bounds = workspace.getBoundingClientRect();
    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId || !bounds.width) return;
      updateDocumentSplitRatio((moveEvent.clientX - bounds.left) / bounds.width);
    };
    const stop = (upEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", stop, true);
      window.removeEventListener("pointercancel", stop, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
  }, [updateDocumentSplitRatio]);

  const commitWorkspaceGroups = groupStorePort.commitWorkspaceGroups;

  useEffect(() => {
    if (!openTabs.length) return;
    const tabById = new Map(openTabs.map((tab) => [tab.id, tab]));
    setWorkspaceGroups((previous) => {
      const refreshViews = (views, allowResearch) => (views || []).flatMap((view) => {
        if (view.kind === WORKSPACE_VIEW_KIND.RESEARCH) return allowResearch ? [view] : [];
        const tab = tabById.get(view.tabId);
        return tab ? [createDocumentWorkspaceView(workspaceDocumentView(tab))] : [];
      });
      let primaryViews = refreshViews(previous.primary.views, false);
      let secondaryViews = refreshViews(previous.secondary.views, true);
      const assignedTabIds = new Set([...primaryViews, ...secondaryViews]
        .filter((view) => view.kind === WORKSPACE_VIEW_KIND.DOCUMENT)
        .map((view) => view.tabId));
      for (const tab of openTabs) {
        if (!assignedTabIds.has(tab.id)) {
          primaryViews.push(createDocumentWorkspaceView(workspaceDocumentView(tab)));
          assignedTabIds.add(tab.id);
        }
      }
      if (!primaryViews.length) {
        const firstSecondaryDocumentIndex = secondaryViews.findIndex((view) => view.kind === WORKSPACE_VIEW_KIND.DOCUMENT);
        if (firstSecondaryDocumentIndex >= 0) {
          primaryViews = [secondaryViews[firstSecondaryDocumentIndex]];
          secondaryViews = secondaryViews.filter((_, index) => index !== firstSecondaryDocumentIndex);
        } else {
          primaryViews = [createDocumentWorkspaceView(workspaceDocumentView(openTabs[0]))];
        }
      }
      const candidate = normalizeWorkspaceGroupsState({
        ...previous,
        primary: { views: primaryViews, activeViewId: previous.primary.activeViewId },
        secondary: { views: secondaryViews, activeViewId: previous.secondary.activeViewId },
      }, { fallbackPrimaryDocument: workspaceDocumentView(openTabs[0]) });
      return JSON.stringify(candidate) === JSON.stringify(previous) ? previous : candidate;
    });
  }, [openTabs]);

  const updateOpenResearchTargets = useCallback((libraryId, previousPath, nextPath, itemPatch = {}) => {
    let nextGroups = workspaceGroupsRef.current;
    const changedViewIds = [];
    for (const view of nextGroups.secondary.views) {
      if (view.kind !== WORKSPACE_VIEW_KIND.RESEARCH || view.libraryId !== libraryId || !view.relativePath) continue;
      if (view.relativePath !== previousPath && !view.relativePath.startsWith(`${previousPath}/`)) continue;
      const suffix = view.relativePath.slice(previousPath.length);
      nextGroups = updateWorkspaceResearchTarget(nextGroups, view.viewId, { libraryId, relativePath: `${nextPath}${suffix}` });
      changedViewIds.push(view.viewId);
    }
    if (nextGroups !== workspaceGroupsRef.current) commitWorkspaceGroups(nextGroups);
    if (changedViewIds.length) {
      setResearchItemsByViewId((previous) => {
        const copy = { ...previous };
        for (const viewId of changedViewIds) {
          if (copy[viewId]) copy[viewId] = { ...copy[viewId], ...itemPatch, relativePath: `${nextPath}${String(copy[viewId].relativePath || "").slice(previousPath.length)}` };
        }
        return copy;
      });
    }
  }, [commitWorkspaceGroups]);

  const removeOpenResearchViews = useCallback((selector) => {
    const state = workspaceGroupsRef.current;
    const removedIds = state.secondary.views.filter((view) => (
      view.kind === WORKSPACE_VIEW_KIND.RESEARCH && selector(view)
    )).map((view) => view.viewId);
    if (!removedIds.length) return;
    removedIds.forEach((viewId) => { void bridge.destroyResearchWebView?.(viewId); });
    const next = removeWorkspaceViews(state, new Set(removedIds));
    commitWorkspaceGroups(next);
    setResearchItemsByViewId((previous) => {
      const copy = { ...previous };
      removedIds.forEach((viewId) => delete copy[viewId]);
      return copy;
    });
    const active = getActiveWorkspaceView(next, WORKSPACE_GROUP_ID.SECONDARY);
    if (!active) {
      setActiveLibraryItem(null);
      setActivePane("main");
    } else if (active.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
      setActiveLibraryItem(researchItemsByViewIdRef.current[active.viewId]
        || (active.sourceId ? librarySourcesRef.current.find((source) => source.id === active.sourceId) : null)
        || null);
    }
  }, [commitWorkspaceGroups]);

  const handleToggleRightSplit = useCallback((tabId) => {
    const state = workspaceGroupsRef.current;
    const location = findWorkspaceView(state, tabId);
    if (!location || location.view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT) return;
    const targetGroup = location.groupId === WORKSPACE_GROUP_ID.PRIMARY
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY;
    if (location.groupId === WORKSPACE_GROUP_ID.PRIMARY && state.primary.views.length <= 1) {
      showStatus("左侧编辑组至少需要保留一个信笺", "warning");
      return;
    }
    const snapshot = snapshotLiveTabs({ includeEditorJson: true });
    openTabsRef.current = snapshot;
    setOpenTabs(snapshot);
    const next = moveWorkspaceDocument(state, location.view.viewId, targetGroup, state[targetGroup].views.length);
    if (next === state) return;
    commitWorkspaceGroups(next);
    if (targetGroup === WORKSPACE_GROUP_ID.PRIMARY) {
      const target = snapshot.find((tab) => tab.id === tabId);
      if (target) {
        activeTabIdRef.current = target.id;
        setActiveTabId(target.id);
        applyDocument(target.document, target.path, target.dirty, { editorJson: target.editorJson, scrollState: target.scrollState });
      }
      setActivePane("main");
    } else {
      const nextPrimary = getActiveWorkspaceView(next, WORKSPACE_GROUP_ID.PRIMARY);
      const primaryTab = snapshot.find((tab) => tab.id === nextPrimary?.tabId);
      if (primaryTab && tabId === activeTabIdRef.current) {
        activeTabIdRef.current = primaryTab.id;
        setActiveTabId(primaryTab.id);
        applyDocument(primaryTab.document, primaryTab.path, primaryTab.dirty, { editorJson: primaryTab.editorJson, scrollState: primaryTab.scrollState });
      }
      setActivePane("right");
    }
    showStatus(targetGroup === WORKSPACE_GROUP_ID.SECONDARY ? "已移到右侧编辑组" : "已移到左侧编辑组", "success");
  }, [applyDocument, commitWorkspaceGroups, showStatus, snapshotLiveTabs]);

  const addOrActivateDocumentTab = useCallback(
    (nextDocument, nextPath = "", nextDirty = false, options = {}) => {
      const normalized = normalizeDocument(nextDocument, letterTemplates);
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      const existingTab = nextPath ? snapshot.find((tab) => sameDocumentPath(tab.path, nextPath)) : null;
      if (existingTab) {
        openTabsRef.current = snapshot;
        setOpenTabs(snapshot);
        const location = findWorkspaceView(workspaceGroupsRef.current, existingTab.id);
        if (location?.groupId === WORKSPACE_GROUP_ID.SECONDARY) {
          commitWorkspaceGroups(selectWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY, location.view.viewId));
          setActivePane("right");
        } else {
          const nextGroups = location
            ? selectWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.PRIMARY, location.view.viewId)
            : openWorkspaceDocument(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.PRIMARY, workspaceDocumentView(existingTab));
          commitWorkspaceGroups(nextGroups);
          activeTabIdRef.current = existingTab.id;
          setActiveTabId(existingTab.id);
          setActivePane("main");
          if (existingTab.id !== activeTabId) {
            applyDocument(existingTab.document, existingTab.path, existingTab.dirty, { editorJson: existingTab.editorJson, scrollState: existingTab.scrollState });
          }
        }
        return existingTab.id;
      }
      const requestedGroup = options.groupId === WORKSPACE_GROUP_ID.SECONDARY
        || (!options.groupId && activePane === "right" && workspaceGroupsRef.current.secondary.views.length)
        ? WORKSPACE_GROUP_ID.SECONDARY
        : WORKSPACE_GROUP_ID.PRIMARY;
      const onlyTab = snapshot.length === 1 ? snapshot[0] : null;
      const canReplaceBlank = requestedGroup === WORKSPACE_GROUP_ID.PRIMARY
        && (nextPath || options.replaceBlank)
        && onlyTab
        && !onlyTab.path
        && !onlyTab.dirty
        && !currentPath
        && !dirty;
      const tab = createDocumentTab(normalized, nextPath, nextDirty, options);
      documentTabRuntimePort.ensure(tab.id, {
        dirty: nextDirty,
        diskRevision: options.diskRevision,
        lastEditAt: nextDirty ? Date.now() : null,
        liveUpdatedAt: normalized.updatedAt,
        recoveryRevision: tab.recoveryRevision,
      });
      const nextTabs = canReplaceBlank ? [tab] : [...snapshot, tab];
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
      let nextGroups;
      if (canReplaceBlank) {
        const view = createDocumentWorkspaceView(workspaceDocumentView(tab));
        nextGroups = {
          ...workspaceGroupsRef.current,
          primary: { views: [view], activeViewId: view.viewId },
          focusedGroup: WORKSPACE_GROUP_ID.PRIMARY,
        };
      } else {
        nextGroups = openWorkspaceDocument(workspaceGroupsRef.current, requestedGroup, workspaceDocumentView(tab));
      }
      commitWorkspaceGroups(nextGroups);
      if (requestedGroup === WORKSPACE_GROUP_ID.PRIMARY) {
        activeTabIdRef.current = tab.id;
        setActiveTabId(tab.id);
        setActivePane("main");
        applyDocument(normalized, nextPath, nextDirty, { scrollState: tab.scrollState });
      } else {
        setActivePane("right");
      }
      return tab.id;
    },
    [activePane, activeTabId, applyDocument, commitWorkspaceGroups, currentPath, dirty, letterTemplates, snapshotLiveTabs],
  );

  useEffect(() => {
    if (!editor || sessionRestoredRef.current) {
      return undefined;
    }
    let canceled = false;
    const runId = restoreRunRef.current + 1;
    restoreRunRef.current = runId;
    const isActiveRestore = () => !canceled && restoreRunRef.current === runId;
    const restoreSession = async () => {
      const { folderPath: savedFolderPath, activePath } = sessionRef.current;
      const restoreEntries = [...summarizeSessionTabs(sessionRef.current.tabs || [])];
      if (activePath && !restoreEntries.some((entry) => sameDocumentPath(entry.path, activePath))) {
        restoreEntries.push({ path: activePath, temporary: false });
      }
      let folderPath = savedFolderPath;
      let defaultFolderPath = "";
      bridge.debugLog?.("renderer:restore:start", {
        savedFolderPath,
        activePath,
        tabs: restoreEntries.length,
      });
      if (!folderPath) {
        try {
          const paths = await bridge.getPaths?.();
          defaultFolderPath = paths?.documents || "";
          folderPath = defaultFolderPath;
        } catch {
          folderPath = "";
        }
      }
      if (folderPath) {
        const folderRestoreRequest = folderRequestControllerRef.current.begin("view");
        folderPathRef.current = folderPath;
        bridge.debugLog?.("renderer:restore:folder-selected", {
          folderPath,
          source: savedFolderPath ? "session" : "documents-default",
        });
        if (isActiveRestore() && folderRequestControllerRef.current.isCurrent(folderRestoreRequest)) {
          setFolderState((previous) => ({
            ...previous,
            rootPath: previous.rootPath || folderPath,
            path: folderPath,
            loading: true,
          }));
        }
        try {
          const result = await listFolderWithTimeout(folderPath);
          if (
            isActiveRestore()
            && folderRequestControllerRef.current.isCurrent(folderRestoreRequest)
            && !result?.canceled
          ) {
            bridge.debugLog?.("renderer:restore:folder-applied", {
              folderPath,
              folders: result.folders?.length || 0,
              files: result.files?.length || 0,
            });
            const restoredFolderPath = result.folderPath || folderPath;
            folderPathRef.current = restoredFolderPath;
            setFolderState({
              rootPath: folderPath,
              path: restoredFolderPath,
              parentPath: result.parentPath || "",
              folders: result.folders || [],
              files: result.files || [],
              entries: result.entries || [...(result.folders || []), ...(result.files || [])],
              loading: false,
              error: "",
            });
          } else if (isActiveRestore() && folderRequestControllerRef.current.isCurrent(folderRestoreRequest)) {
            throw new Error("folder list canceled");
          }
        } catch (error) {
          bridge.debugLog?.("renderer:restore:folder-fallback", {
            folderPath,
            message: error?.message,
          });
          if (isActiveRestore() && folderRequestControllerRef.current.isCurrent(folderRestoreRequest)) {
            try {
              const paths = defaultFolderPath ? { documents: defaultFolderPath } : await bridge.getPaths?.();
              const fallbackPath = paths?.documents || "";
              const fallback = fallbackPath ? await listFolderWithTimeout(fallbackPath) : null;
              if (!folderRequestControllerRef.current.isCurrent(folderRestoreRequest)) {
                // A newer folder navigation owns the tree now.
              } else if (fallbackPath && !fallback?.canceled) {
                folderPathRef.current = fallback.folderPath || fallbackPath;
                setFolderState({
                  rootPath: fallback.folderPath || fallbackPath,
                  path: fallback.folderPath || fallbackPath,
                  parentPath: fallback.parentPath || "",
                  folders: fallback.folders || [],
                  files: fallback.files || [],
                  entries: fallback.entries || [...(fallback.folders || []), ...(fallback.files || [])],
                  loading: false,
                  error: "",
                });
                persistSession({ folderPath: fallback.folderPath || fallbackPath, activePath: "" });
              } else {
                folderPathRef.current = folderPath;
                setFolderState({
                  rootPath: folderPath,
                  path: folderPath,
                  parentPath: "",
                  files: [],
                  folders: [],
                  entries: [],
                  loading: false,
                  error: "文件树读取超时或失败",
                });
              }
            } catch {
              if (folderRequestControllerRef.current.isCurrent(folderRestoreRequest)) {
                folderPathRef.current = folderPath;
                setFolderState({
                  rootPath: folderPath,
                  path: folderPath,
                  parentPath: "",
                  files: [],
                  folders: [],
                  entries: [],
                  loading: false,
                  error: "文件树读取超时或失败",
                });
              }
            }
          }
        } finally {
          folderRequestControllerRef.current.finish(folderRestoreRequest);
        }
      }
      if (restoreEntries.length) {
        const restoredTabs = [];
        for (const restoreEntry of restoreEntries) {
          const restorePath = restoreEntry.recoveryPath || restoreEntry.path;
          try {
            const result = await bridge.openDocumentPath(restorePath);
            if (!isActiveRestore()) {
              return;
            }
            if (!result?.canceled && result?.document) {
              const normalized = normalizeDocument(result.document, letterTemplates);
              const restoredFromRecovery = Boolean(restoreEntry.recoveryPath || restoreEntry.temporary);
              if (restoredFromRecovery) {
                const logicalPath = restoreEntry.temporary ? "" : restoreEntry.path;
                const recoverySourcePath = restoreEntry.recoverySourcePath || logicalPath;
                const recoveryBaseRevision = normalizeSessionDiskRevision(restoreEntry.recoveryBaseRevision);
                const logicalRevision = logicalPath ? await bridge.getDocumentRevision?.(logicalPath).catch?.(() => null) : null;
                const currentDiskRevision = normalizeSessionDiskRevision(logicalRevision?.diskRevision);
                const sourceMatches = !logicalPath || !recoverySourcePath || sameDocumentPath(logicalPath, recoverySourcePath);
                const externalChanged = Boolean(logicalPath && (
                  !sourceMatches
                  || !recoveryBaseRevision
                  || !sameDiskRevision(currentDiskRevision, recoveryBaseRevision)
                ));
                restoredTabs.push(createDocumentTab(normalized, logicalPath, true, {
                    recoveryPath: result.path,
                    recoveryId: restoreEntry.recoveryId || result.recoveryId,
                    recoverySourcePath,
                    recoveryBaseRevision,
                    recoveryRevision: 0,
                    recoveredTemporary: true,
                    diskRevision: recoveryBaseRevision,
                    readOnly: result.readOnly,
                    externalChanged,
                  }));
              } else {
                restoredTabs.push(createDocumentTab(normalized, result.path, false, { diskRevision: result.diskRevision, readOnly: result.readOnly }));
              }
            }
          } catch {
            // Missing or unreadable session files are skipped.
          }
        }
        if (isActiveRestore() && restoredTabs.length) {
          const restoredAt = Date.now();
          restoredTabs.forEach((tab) => {
            documentTabRuntimePort.ensure(tab.id, {
              dirty: tab.dirty,
              diskRevision: tab.diskRevision,
              lastEditAt: tab.dirty ? restoredAt : null,
              liveUpdatedAt: tab.document?.updatedAt,
              recoveryRevision: tab.recoveryRevision,
            });
          });
          const legacyActiveTab = restoredTabs.find((tab) => sameDocumentPath(tab.path || tab.recoveryPath, activePath)) || restoredTabs[0];
          let fallbackGroups = createWorkspaceGroupsState(workspaceDocumentView(restoredTabs[0]), {
            splitRatio: workspaceGroupsRef.current.splitRatio,
          });
          for (const tab of restoredTabs.slice(1)) {
            fallbackGroups = openWorkspaceDocument(fallbackGroups, WORKSPACE_GROUP_ID.PRIMARY, workspaceDocumentView(tab));
          }
          fallbackGroups = selectWorkspaceView(fallbackGroups, WORKSPACE_GROUP_ID.PRIMARY, legacyActiveTab.id);
          const restoredGroups = restoreWorkspaceGroupsSnapshot(sessionRef.current.workspaceGroups, {
            documents: restoredTabs.map(workspaceDocumentView),
            fallbackState: fallbackGroups,
            fallbackPrimaryDocument: workspaceDocumentView(legacyActiveTab),
            resolveDocumentTabId: (resourceKey) => {
              const tab = restoredTabs.find((candidate) => documentTabResourceKey(candidate) === resourceKey);
              return tab ? workspaceDocumentView(tab) : null;
            },
          }) || fallbackGroups;
          const restoredPrimaryView = getActiveWorkspaceView(restoredGroups, WORKSPACE_GROUP_ID.PRIMARY);
          const activeTab = restoredTabs.find((tab) => tab.id === restoredPrimaryView?.tabId) || legacyActiveTab;
          setOpenTabs(restoredTabs);
          commitWorkspaceGroups(restoredGroups);
          activeTabIdRef.current = activeTab.id;
          setActiveTabId(activeTab.id);
          applyDocument(activeTab.document, activeTab.path, activeTab.dirty);
          const restoredSecondaryView = getActiveWorkspaceView(restoredGroups, WORKSPACE_GROUP_ID.SECONDARY);
          if (restoredGroups.focusedGroup === WORKSPACE_GROUP_ID.SECONDARY && restoredSecondaryView) {
            setActivePane("right");
            if (restoredSecondaryView.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
              const restoredResearchItem = restoredSecondaryView.relativePath
                ? {
                    type: "file",
                    relativePath: restoredSecondaryView.relativePath,
                    name: restoredSecondaryView.titleSnapshot || displayNameFromPath(restoredSecondaryView.relativePath),
                  }
                : null;
              if (restoredResearchItem) {
                setResearchItemsByViewId((previous) => ({ ...previous, [restoredSecondaryView.viewId]: restoredResearchItem }));
                setActiveLibraryItem(restoredResearchItem);
              }
            }
          } else {
            setActivePane("main");
          }
          persistSession({
            activePath: activeTab.path || activeTab.recoveryPath,
            tabs: summarizeSessionTabs(restoredTabs),
            workspaceGroups: summarizeWorkspaceGroups(restoredGroups, restoredTabs),
          });
        } else if (isActiveRestore()) {
          persistSession({ activePath: "", tabs: [] });
        }
      }
      if (isActiveRestore()) {
        sessionRestoredRef.current = true;
        bridge.debugLog?.("renderer:restore:complete", { runId });
      }
    };
    restoreSession();
    return () => {
      canceled = true;
      bridge.debugLog?.("renderer:restore:canceled", { runId });
    };
  }, [applyDocument, commitWorkspaceGroups, editor, letterTemplates, persistSession]);

  const handleSelectTab = useCallback(
    (tabId) => {
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      const target = snapshot.find((tab) => tab.id === tabId);
      if (!target) {
        return;
      }
      openTabsRef.current = snapshot;
      setOpenTabs(snapshot);
      const location = findWorkspaceView(workspaceGroupsRef.current, target.id);
      if (location?.groupId === WORKSPACE_GROUP_ID.SECONDARY) {
        commitWorkspaceGroups(selectWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY, location.view.viewId));
        setActivePane("right");
        return;
      }
      const nextGroups = location
        ? selectWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.PRIMARY, location.view.viewId)
        : openWorkspaceDocument(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.PRIMARY, workspaceDocumentView(target));
      commitWorkspaceGroups(nextGroups);
      activeTabIdRef.current = target.id;
      setActiveTabId(target.id);
      setActivePane("main");
      if (target.id !== activeTabId) {
        applyDocument(target.document, target.path, target.dirty, { editorJson: target.editorJson, scrollState: target.scrollState });
      }
    },
    [activeTabId, applyDocument, commitWorkspaceGroups, snapshotLiveTabs],
  );

  const handleSelectGroupView = useCallback((groupId, viewId) => {
    const state = workspaceGroupsRef.current;
    const group = state[groupId];
    const view = group?.views?.find((candidate) => candidate.viewId === viewId);
    if (!view) return;
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      handleSelectTab(view.tabId);
      return;
    }
    const snapshot = snapshotLiveTabs({ includeEditorJson: true });
    openTabsRef.current = snapshot;
    setOpenTabs(snapshot);
    const next = selectWorkspaceView(state, WORKSPACE_GROUP_ID.SECONDARY, viewId);
    commitWorkspaceGroups(next);
    setActivePane("right");
    const item = researchItemsByViewId[viewId]
      || (view.sourceId ? librarySources.find((source) => source.id === view.sourceId) : null)
      || null;
    setActiveLibraryItem(item);
    setActiveResearchError("");
  }, [commitWorkspaceGroups, handleSelectTab, librarySources, researchItemsByViewId, snapshotLiveTabs]);

  const handleReorderGroupView = useCallback((groupId, viewId, beforeViewId) => {
    const state = workspaceGroupsRef.current;
    const views = state[groupId]?.views || [];
    const fromIndex = views.findIndex((view) => view.viewId === viewId);
    if (fromIndex < 0) return;
    let toIndex = beforeViewId ? views.findIndex((view) => view.viewId === beforeViewId) : views.length - 1;
    if (toIndex < 0) toIndex = views.length - 1;
    if (beforeViewId && fromIndex < toIndex) toIndex -= 1;
    commitWorkspaceGroups(reorderWorkspaceView(state, groupId, viewId, toIndex));
  }, [commitWorkspaceGroups]);

  const handleMoveGroupDocument = useCallback((viewId, targetGroupId, beforeViewId = null) => {
    const state = workspaceGroupsRef.current;
    const location = findWorkspaceView(state, viewId);
    if (!location || location.view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT) return;
    if (location.groupId === targetGroupId) {
      handleReorderGroupView(targetGroupId, viewId, beforeViewId);
      return;
    }
    if (location.groupId === WORKSPACE_GROUP_ID.PRIMARY && state.primary.views.length <= 1) {
      showStatus("左侧编辑组至少需要保留一个信笺", "warning");
      return;
    }
    const targetViews = state[targetGroupId]?.views || [];
    let insertionIndex = beforeViewId ? targetViews.findIndex((view) => view.viewId === beforeViewId) : targetViews.length;
    if (insertionIndex < 0) insertionIndex = targetViews.length;
    const snapshot = snapshotLiveTabs({ includeEditorJson: true });
    openTabsRef.current = snapshot;
    setOpenTabs(snapshot);
    const next = moveWorkspaceDocument(state, location.view.viewId, targetGroupId, insertionIndex);
    if (next === state) return;
    commitWorkspaceGroups(next);
    if (targetGroupId === WORKSPACE_GROUP_ID.PRIMARY) {
      const tab = snapshot.find((candidate) => candidate.id === location.view.tabId);
      if (tab) {
        activeTabIdRef.current = tab.id;
        setActiveTabId(tab.id);
        applyDocument(tab.document, tab.path, tab.dirty, { editorJson: tab.editorJson, scrollState: tab.scrollState });
      }
      setActivePane("main");
    } else {
      if (location.view.tabId === activeTabIdRef.current) {
        const nextPrimary = getActiveWorkspaceView(next, WORKSPACE_GROUP_ID.PRIMARY);
        const primaryTab = snapshot.find((candidate) => candidate.id === nextPrimary?.tabId);
        if (primaryTab) {
          activeTabIdRef.current = primaryTab.id;
          setActiveTabId(primaryTab.id);
          applyDocument(primaryTab.document, primaryTab.path, primaryTab.dirty, { editorJson: primaryTab.editorJson, scrollState: primaryTab.scrollState });
        }
      }
      setActivePane("right");
    }
  }, [applyDocument, commitWorkspaceGroups, handleReorderGroupView, showStatus, snapshotLiveTabs]);

  const handleCloseTab = useCallback(
    async (tabId) => {
      if (tabClosePendingIdsRef.current.has(tabId)) return;
      tabClosePendingIdsRef.current.add(tabId);
      try {
      await waitForTabSave(tabId);
      let snapshot = snapshotLiveTabs({ includeEditorJson: true });
      let closingTab = snapshot.find((tab) => tab.id === tabId);
      if (!closingTab) {
        return;
      }
      const groupsBeforeClose = workspaceGroupsRef.current;
      const location = findWorkspaceView(groupsBeforeClose, tabId);
      const isActive = location?.groupId === WORKSPACE_GROUP_ID.SECONDARY
        ? groupsBeforeClose.secondary.activeViewId === location.view.viewId
        : tabId === activeTabId;
      const isDirty = closingTab.dirty;
      if (isDirty) {
        const promptedRevision = documentRevisionPort.readLiveRevision(tabId);
        const decision = await showConfirmDialog({
          tone: "warning",
          icon: FileText,
          eyebrow: "未保存的信笺",
          title: "这个文件尚未保存",
          message: "要关闭这个信笺吗？",
          detail: "关闭后，这个信笺中尚未保存的修改不会写入文件。",
          cancelValue: "cancel",
          actions: [
            { value: "close", label: "关闭信笺", variant: "danger", icon: X },
            { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
          ],
        });
        if (decision !== "close") {
          return;
        }
        if (documentRevisionPort.readLiveRevision(tabId) !== promptedRevision) {
          showStatus("关闭确认期间信笺又有修改，请再次确认", "warning");
          return;
        }
        snapshot = snapshotLiveTabs({ includeEditorJson: true });
        closingTab = snapshot.find((tab) => tab.id === tabId);
        if (!closingTab) return;
      }
      if (closingTab.recoveryPath) {
        await bridge.deleteTempDocument?.(recoveryTabId(closingTab)).catch?.(() => {});
      }
      const remaining = snapshot.filter((tab) => tab.id !== tabId);
      if (!remaining.length) {
        const blank = createBlankDocument(letterTemplates, newDocumentTemplateId);
        const nextTab = createDocumentTab(blank);
        const nextGroups = createWorkspaceGroupsState(workspaceDocumentView(nextTab), { splitRatio: groupsBeforeClose.splitRatio });
        commitWorkspaceGroups(nextGroups);
        setActivePane("main");
        openTabsRef.current = [nextTab];
        setOpenTabs([nextTab]);
        activeTabIdRef.current = nextTab.id;
        setActiveTabId(nextTab.id);
        applyDocument(blank, "", false, { scrollState: nextTab.scrollState });
        releaseTabRuntimeState(tabId);
        return;
      }
      let nextTabs = remaining;
      let nextGroups = groupsBeforeClose;
      if (location?.groupId === WORKSPACE_GROUP_ID.PRIMARY && groupsBeforeClose.primary.views.length <= 1) {
        const blank = createBlankDocument(letterTemplates, newDocumentTemplateId);
        const blankTab = createDocumentTab(blank);
        nextTabs = [...remaining, blankTab];
        const blankView = createDocumentWorkspaceView(workspaceDocumentView(blankTab));
        nextGroups = {
          ...groupsBeforeClose,
          primary: { views: [blankView], activeViewId: blankView.viewId },
          focusedGroup: WORKSPACE_GROUP_ID.PRIMARY,
        };
      } else if (location) {
        nextGroups = closeWorkspaceView(groupsBeforeClose, location.groupId, location.view.viewId);
      } else {
        nextGroups = removeWorkspaceViews(groupsBeforeClose, { tabId });
      }
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
      releaseTabRuntimeState(tabId);
      commitWorkspaceGroups(nextGroups);
      const nextPrimaryView = getActiveWorkspaceView(nextGroups, WORKSPACE_GROUP_ID.PRIMARY);
      const nextPrimaryTab = nextTabs.find((tab) => tab.id === nextPrimaryView?.tabId);
      if (location?.groupId === WORKSPACE_GROUP_ID.PRIMARY && nextPrimaryTab) {
        activeTabIdRef.current = nextPrimaryTab.id;
        setActiveTabId(nextPrimaryTab.id);
        applyDocument(nextPrimaryTab.document, nextPrimaryTab.path, nextPrimaryTab.dirty, { editorJson: nextPrimaryTab.editorJson, scrollState: nextPrimaryTab.scrollState });
        if (isActive) setActivePane("main");
      } else if (location?.groupId === WORKSPACE_GROUP_ID.SECONDARY && isActive) {
        const nextSecondary = getActiveWorkspaceView(nextGroups, WORKSPACE_GROUP_ID.SECONDARY);
        if (!nextSecondary) {
          setActiveLibraryItem(null);
          setActivePane("main");
        } else {
          if (nextSecondary.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
            setActiveLibraryItem(researchItemsByViewId[nextSecondary.viewId]
              || (nextSecondary.sourceId ? librarySources.find((source) => source.id === nextSecondary.sourceId) : null)
              || null);
          }
          setActivePane("right");
        }
      }
      } finally {
        tabClosePendingIdsRef.current.delete(tabId);
      }
    },
    [activeTabId, applyDocument, commitWorkspaceGroups, letterTemplates, librarySources, newDocumentTemplateId, releaseTabRuntimeState, researchItemsByViewId, showConfirmDialog, showStatus, snapshotLiveTabs, waitForTabSave],
  );

  const handleCloseGroupView = useCallback(async (groupId, viewId) => {
    const state = workspaceGroupsRef.current;
    const view = state[groupId]?.views?.find((candidate) => candidate.viewId === viewId);
    if (!view) return;
    if (view.kind === WORKSPACE_VIEW_KIND.DOCUMENT) {
      await handleCloseTab(view.tabId);
      return;
    }
    void bridge.destroyResearchWebView?.(viewId);
    const next = closeWorkspaceView(state, groupId, viewId);
    commitWorkspaceGroups(next);
    setResearchItemsByViewId((previous) => {
      if (!(viewId in previous)) return previous;
      const copy = { ...previous };
      delete copy[viewId];
      return copy;
    });
    const nextSecondary = getActiveWorkspaceView(next, WORKSPACE_GROUP_ID.SECONDARY);
    if (!nextSecondary) {
      setActiveLibraryItem(null);
      setActiveResearchError("");
      setActivePane("main");
      return;
    }
    if (nextSecondary.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
      setActiveLibraryItem(researchItemsByViewId[nextSecondary.viewId]
        || (nextSecondary.sourceId ? librarySources.find((source) => source.id === nextSecondary.sourceId) : null)
        || null);
    }
    setActivePane("right");
  }, [commitWorkspaceGroups, handleCloseTab, librarySources, researchItemsByViewId]);

  const handleNew = useCallback((groupId) => {
    const tabId = addOrActivateDocumentTab(
      createBlankDocument(letterTemplates, newDocumentTemplateId),
      "",
      false,
      groupId ? { groupId } : {},
    );
    if (!tabId) return;
    showStatus("已新建空白信笺", "success");
  }, [addOrActivateDocumentTab, letterTemplates, newDocumentTemplateId, showStatus]);

  const handleOpen = useCallback(async () => {
    const result = await bridge.openDocument();
    if (result?.canceled) {
      return;
    }
    const tabId = addOrActivateDocumentTab(result.document, result.path, false, { diskRevision: result.diskRevision, readOnly: result.readOnly });
    if (!tabId) return;
    showStatus("文档已打开", "success");
  }, [addOrActivateDocumentTab, showStatus]);

  const handleImportDocument = useCallback(async () => {
    const result = await bridge.importDocument?.();
    if (result?.canceled || !result?.document) return;
    const tabId = addOrActivateDocumentTab(result.document, "", true, { replaceBlank: true });
    if (!tabId) return;
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    showStatus(warnings.length ? `文档已导入；${warnings.length} 项内容已降级，保存后才会生成 .letterpaper` : "文档已导入；保存后才会生成 .letterpaper", warnings.length ? "warning" : "success");
  }, [addOrActivateDocumentTab, showStatus]);

  const handleOpenFolder = useCallback(async () => {
    const request = folderRequestControllerRef.current.begin("view");
    try {
      const result = await bridge.openFolder();
      if (!folderRequestControllerRef.current.isCurrent(request) || result?.canceled) return;
      const nextPath = result.folderPath || "";
      folderPathRef.current = nextPath;
      folderBranchRequestControllerRef.current.invalidateAll();
      expandedFoldersRef.current = {};
      setFolderState({
        rootPath: nextPath,
        path: nextPath,
        parentPath: result.parentPath || "",
        folders: result.folders || [],
        files: result.files || [],
        entries: result.entries || [...(result.folders || []), ...(result.files || [])],
        loading: false,
        error: "",
      });
      setExpandedFolders({});
      showStatus("文件夹已打开", "success");
    } catch (error) {
      if (folderRequestControllerRef.current.isCurrent(request)) {
        showStatus(error?.message || "文件夹打开失败", "warning");
      }
    } finally {
      folderRequestControllerRef.current.finish(request);
    }
  }, [showStatus]);

  const handleOpenFolderPath = useCallback(async (path) => {
    if (!path) return;
    const request = folderRequestControllerRef.current.begin("view");
    folderPathRef.current = path;
    setFolderState((previous) => ({
      ...previous,
      path,
      loading: true,
      error: "",
    }));
    try {
      const result = await listFolderWithTimeout(path);
      if (!folderRequestControllerRef.current.isCurrent(request)) return;
      if (result?.canceled) throw new Error("无法打开这个文件夹");
      const nextPath = result.folderPath || path;
      folderPathRef.current = nextPath;
      folderBranchRequestControllerRef.current.invalidateAll();
      expandedFoldersRef.current = {};
      setFolderState((previous) => ({
        rootPath: previous.rootPath || nextPath,
        path: nextPath,
        parentPath: result.parentPath || "",
        folders: result.folders || [],
        files: result.files || [],
        entries: result.entries || [...(result.folders || []), ...(result.files || [])],
        loading: false,
        error: "",
      }));
      setExpandedFolders({});
    } catch (error) {
      if (!folderRequestControllerRef.current.isCurrent(request)) return;
      setFolderState((previous) => ({
        ...previous,
        loading: false,
        error: error?.message || "文件夹读取失败",
      }));
      showStatus(error?.message || "无法打开这个文件夹", "warning");
    } finally {
      folderRequestControllerRef.current.finish(request);
    }
  }, [showStatus]);

  const refreshFolder = useCallback(async () => {
    const targetPath = folderPathRef.current;
    if (!targetPath) return;
    const request = folderRequestControllerRef.current.begin("view");
    try {
      const result = await listFolderWithTimeout(targetPath);
      if (
        !folderRequestControllerRef.current.isCurrent(request)
        || !sameDocumentPath(folderPathRef.current, targetPath)
      ) return;
      if (result?.canceled) throw new Error("文件树刷新超时");
      setFolderState((previous) => ({
        rootPath: previous.rootPath || result.folderPath || targetPath,
        path: result.folderPath || targetPath,
        parentPath: result.parentPath || "",
        folders: result.folders || [],
        files: result.files || [],
        entries: result.entries || [...(result.folders || []), ...(result.files || [])],
        loading: false,
        error: "",
      }));
    } catch (error) {
      if (
        folderRequestControllerRef.current.isCurrent(request)
        && sameDocumentPath(folderPathRef.current, targetPath)
      ) {
        setFolderState((previous) => ({
          ...previous,
          loading: false,
          error: error?.message || "文件树刷新失败",
        }));
      }
    } finally {
      folderRequestControllerRef.current.finish(request);
    }
  }, []);

  useEffect(() => {
    refreshFolderRef.current = refreshFolder;
  }, [refreshFolder]);

  const refreshTreeAfterEntryChange = useCallback(async (folderPath = "") => {
    await refreshFolder();
    if (!folderPath || !expandedFoldersRef.current[folderPath]?.expanded) return;
    const request = folderBranchRequestControllerRef.current.begin(folderPath);
    try {
      const result = await listFolderWithTimeout(folderPath);
      if (!folderBranchRequestControllerRef.current.isCurrent(request)) return;
      if (result?.canceled) throw new Error("文件夹读取超时");
      setExpandedFolders((state) => {
        if (!state[folderPath]?.expanded) return state;
        const next = {
          ...state,
          [folderPath]: {
            ...state[folderPath],
            loading: false,
            error: "",
            entries: result.entries || [...(result.folders || []), ...(result.files || [])],
          },
        };
        expandedFoldersRef.current = next;
        return next;
      });
    } catch (error) {
      if (!folderBranchRequestControllerRef.current.isCurrent(request)) return;
      setExpandedFolders((state) => {
        if (!state[folderPath]?.expanded) return state;
        const next = {
          ...state,
          [folderPath]: { ...state[folderPath], loading: false, error: error?.message || "文件夹读取失败" },
        };
        expandedFoldersRef.current = next;
        return next;
      });
    } finally {
      folderBranchRequestControllerRef.current.finish(request);
    }
  }, [refreshFolder]);

  const handleOpenFolderFile = useCallback(
    async (path) => {
      const existingTab = openTabs.find((tab) => sameDocumentPath(tab.path, path));
      if (existingTab) {
        if (existingTab.id !== activeTabId) {
          handleSelectTab(existingTab.id);
        }
        return existingTab.id;
      }
      const startedAt = window.performance?.now?.() || Date.now();
      showStatus("正在打开文档...", "success");
      const result = await bridge.openDocumentPath(path);
      bridge.debugLog?.("renderer:document:open-path:return", {
        path,
        canceled: Boolean(result?.canceled),
        hasDocument: Boolean(result?.document),
        ipcMs: Math.round((window.performance?.now?.() || Date.now()) - startedAt),
      });
      if (result?.canceled || !result?.document) {
        showStatus(result?.error ? `打开失败：${result.error}` : "这个文件不是笺间文档", "warning");
        return;
      }
      const tabId = addOrActivateDocumentTab(result.document, result.path, false, { diskRevision: result.diskRevision, readOnly: result.readOnly });
      if (!tabId) {
        showStatus("标签栏已满，请先关闭一个信笺再打开文档", "warning");
        return;
      }
      showStatus("文档已打开", "success");
      return tabId;
    },
    [activeTabId, addOrActivateDocumentTab, handleSelectTab, openTabs, showStatus],
  );

  const handleOpenWorkspaceSearchResult = useCallback(async (result) => {
    if (!result?.path) return;
    const tabId = await handleOpenFolderFile(result.path);
    if (!tabId) return;
    const query = String(result.query || workspaceSearchQuery).trim();
    setSearchMode("");
    setSearchQuery(query);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (activeTabIdRef.current === tabId && sameDocumentPath(currentPathRef.current, result.path)) break;
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
    if (activeTabIdRef.current !== tabId || !sameDocumentPath(currentPathRef.current, result.path)) return;
    if (result.matchField === "title" || result.matchField === "fileName") {
      const input = mainCanvasRef.current?.querySelector?.(".paper-title-input");
      input?.focus?.();
      input?.select?.();
      return;
    }
    if (result.matchField === "author") {
      const input = mainCanvasRef.current?.querySelector?.(".paper-author-input");
      input?.focus?.();
      input?.select?.();
      return;
    }
    const targetEditor = editor;
    if (!targetEditor || !query) return;
    let next = searchDocumentText(targetEditor.state.doc, query);
    if (next.matches.length && Number.isFinite(Number(result.matchStart))) {
      const targetOffset = Number(result.matchStart);
      const closestIndex = next.matches.reduce((best, match, index) => (
        Math.abs(match.plainStart - targetOffset) < Math.abs(next.matches[best].plainStart - targetOffset) ? index : best
      ), 0);
      next = { ...next, activeIndex: closestIndex, activeMatch: next.matches[closestIndex] };
    }
    setDocumentSearchState(next);
    if (next.activeMatch) targetEditor.chain().focus().setTextSelection(next.activeMatch.from).scrollIntoView().run();
  }, [editor, handleOpenFolderFile, workspaceSearchQuery]);

  const handleCreateFolderInTree = useCallback(async (entry, interaction = {}) => {
    const parentPath = entry?.path || folderState.path;
    if (!parentPath) {
      return;
    }
    const name = await showPromptDialog({
      title: "新建子文件夹",
      label: "文件夹名称",
      defaultValue: "新建文件夹",
      confirmLabel: "新建",
      icon: FolderPlus,
      returnFocusElement: interaction.returnFocusElement,
    });
    if (!name?.trim()) {
      return;
    }
    const result = await bridge.createFolder?.(parentPath, name);
    if (!result?.ok) {
      showStatus(result?.message || "新建文件夹失败", "warning");
      return;
    }
    await refreshTreeAfterEntryChange(parentPath);
    showStatus("文件夹已新建", "success");
  }, [folderState.path, refreshTreeAfterEntryChange, showPromptDialog, showStatus]);

  const handleCreateDocumentInTree = useCallback(async (entry, interaction = {}) => {
    const folderPath = entry?.path || folderState.path;
    if (!folderPath) {
      return;
    }
    const title = await showPromptDialog({
      title: "新建信笺",
      label: "信笺名称",
      defaultValue: "未命名信笺",
      confirmLabel: "新建",
      icon: FilePlus,
      returnFocusElement: interaction.returnFocusElement,
    });
    if (!title?.trim()) {
      return;
    }
    const blank = createBlankDocument(letterTemplates, newDocumentTemplateId);
    const result = await bridge.createDocumentInFolder?.(folderPath, title, blank);
    if (!result?.ok) {
      showStatus(result?.message || "新建信笺失败", "warning");
      return;
    }
    await refreshTreeAfterEntryChange(folderPath);
    const tabId = addOrActivateDocumentTab(result.document || { ...blank, title: title.trim() }, result.path, false, { diskRevision: result.diskRevision });
    if (!tabId) {
      showStatus("信笺已创建；标签栏已满，请关闭一个标签后从文件夹打开", "warning");
      return;
    }
    showStatus("信笺已新建", "success");
  }, [addOrActivateDocumentTab, folderState.path, letterTemplates, newDocumentTemplateId, refreshTreeAfterEntryChange, showPromptDialog, showStatus]);

  const handleRenameTreeEntry = useCallback(async (entry, interaction = {}) => {
    if (!entry?.path) {
      return;
    }
    const currentName = entry.type === "file" ? (entry.displayName || entry.name.replace(/\.[^.]+$/, "")) : entry.name;
    const nextName = await showPromptDialog({
      title: "重命名",
      label: entry.type === "file" ? "信笺名称" : "文件夹名称",
      defaultValue: currentName,
      confirmLabel: "保存",
      icon: Pencil,
      returnFocusElement: interaction.returnFocusElement,
    });
    if (!nextName?.trim() || nextName.trim() === currentName) {
      return;
    }
    const result = await bridge.renameEntry?.(entry.path, nextName);
    if (!result?.ok) {
      showStatus(result?.message || "重命名失败", "warning");
      return;
    }

    const renameUpdatedAt = new Date().toISOString();
    if (entry.type === "file") {
      openTabsRef.current
        .filter((tab) => sameDocumentPath(tab.path, entry.path))
        .forEach((tab) => recordTabMutation(tab.id, renameUpdatedAt));
    }
    const nextTabs = openTabsRef.current.map((tab) => {
      if (!pathIsSameOrInside(tab.path, entry.path)) return tab;
      return {
        ...tab,
        path: replacePathPrefix(tab.path, entry.path, result.path),
        ...(entry.type === "file" ? {
          title: nextName.trim(),
          document: { ...tab.document, title: nextName.trim(), updatedAt: renameUpdatedAt },
          dirty: true,
        } : {}),
      };
    });
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    if (pathIsSameOrInside(currentPathRef.current, entry.path)) {
      const nextCurrentPath = replacePathPrefix(currentPathRef.current, entry.path, result.path);
      currentPathRef.current = nextCurrentPath;
      setCurrentPath(nextCurrentPath);
      if (entry.type === "file") {
        const nextDocument = {
          ...documentStateRef.current,
          title: nextName.trim(),
          updatedAt: renameUpdatedAt,
        };
        documentStateRef.current = nextDocument;
        setDocumentState(nextDocument);
      }
      persistSession({ activePath: nextCurrentPath });
    }
    if (entry.type === "folder") {
      if (pathIsSameOrInside(folderPathRef.current, entry.path)) {
        folderRequestControllerRef.current.invalidate("view");
        folderPathRef.current = replacePathPrefix(folderPathRef.current, entry.path, result.path);
      }
      setFolderState((previous) => pathIsSameOrInside(previous.path, entry.path)
        ? { ...previous, path: replacePathPrefix(previous.path, entry.path, result.path) }
        : previous);
      folderBranchRequestControllerRef.current.invalidateAll();
      setExpandedFolders((previous) => {
        const next = Object.fromEntries(Object.entries(previous).map(([folderPath, value]) => [
          pathIsSameOrInside(folderPath, entry.path)
            ? replacePathPrefix(folderPath, entry.path, result.path)
            : folderPath,
          value,
        ]));
        expandedFoldersRef.current = next;
        return next;
      });
    }

    await refreshTreeAfterEntryChange(result.folderPath || folderState.path);
    showStatus("已重命名", "success");
  }, [folderState.path, persistSession, recordTabMutation, refreshTreeAfterEntryChange, showPromptDialog, showStatus]);

  const handleBackupTreeDocument = useCallback(async (entry) => {
    if (!entry?.path || entry.type !== "file") {
      return;
    }
    const sourceTab = snapshotLiveTabs({ includeEditorJson: true }).find((tab) => sameDocumentPath(tab.path, entry.path));
    if (sourceTab?.dirty) {
      showStatus("请先保存这篇信笺，再复制备份，以便为原件和副本建立稳定身份", "warning");
      return;
    }
    const result = await bridge.backupDocument?.(entry.path);
    if (!result?.ok) {
      showStatus(result?.message || "备份失败", "warning");
      return;
    }
    if (sourceTab && result.sourceDocument && result.sourceDiskRevision) {
      const nextTabs = openTabsRef.current.map((tab) => {
        if (tab.id !== sourceTab.id) return tab;
        const document = mergePersistedDocumentIdentity(tab.document, result.sourceDocument);
        documentRevisionPort.commitDiskRevision(tab.id, result.sourceDiskRevision);
        return { ...tab, document, diskRevision: result.sourceDiskRevision };
      });
      openTabsRef.current = nextTabs;
      setOpenTabs(nextTabs);
      if (sourceTab.id === activeTabIdRef.current) {
        const document = mergePersistedDocumentIdentity(documentStateRef.current, result.sourceDocument);
        documentStateRef.current = document;
        setDocumentState(document);
      }
      persistSession({ tabs: summarizeSessionTabs(nextTabs) });
    }
    await refreshTreeAfterEntryChange(result.folderPath || folderState.path);
    showStatus("备份已复制到当前目录", "success");
  }, [folderState.path, persistSession, refreshTreeAfterEntryChange, showStatus, snapshotLiveTabs]);

  const handleDeleteTreeEntry = useCallback(async (entry, interaction = {}) => {
    if (!entry?.path) {
      return;
    }
    const initiallyAffected = openTabsRef.current.filter((tab) => pathIsSameOrInside(tab.path, entry.path));
    const affectedIds = initiallyAffected.map((tab) => tab.id);
    affectedIds.forEach((tabId) => tabClosePendingIdsRef.current.add(tabId));
    try {
      await Promise.all(affectedIds.map((tabId) => waitForTabSave(tabId)));
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      const affectedTabs = snapshot.filter((tab) => pathIsSameOrInside(tab.path, entry.path));
      const dirtyAffectedTabs = affectedTabs.filter((tab) => tab.dirty);
      const promptedRevisions = new Map(
        dirtyAffectedTabs.map((tab) => [
          tab.id,
          documentRevisionPort.readLiveRevision(tab.id),
        ]),
      );
      const label = entry.type === "file" ? (entry.displayName || entry.name) : entry.name;
      const scope = entry.type === "folder" ? "这个文件夹及其内部内容" : "这个信笺";
      const decision = await showConfirmDialog({
        tone: "warning",
        icon: Trash2,
        eyebrow: entry.type === "folder" ? "删除文件夹" : "删除信笺",
        title: dirtyAffectedTabs.length
          ? `删除并丢弃 ${dirtyAffectedTabs.length} 篇未保存修改？`
          : (entry.type === "folder" ? "删除这个文件夹？" : "删除这个信笺？"),
        message: `确定删除${scope}“${label}”吗？`,
        detail: dirtyAffectedTabs.length
          ? "继续会丢失这些标签中的内存修改；回收站只能恢复最后一次已保存的版本。"
          : "删除后会进入回收站。",
        cancelValue: "cancel",
        returnFocusElement: interaction.returnFocusElement,
        actions: [
          {
            value: "delete",
            label: dirtyAffectedTabs.length ? "丢弃修改并删除" : "删除",
            variant: "danger",
            icon: Trash2,
          },
          { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
        ],
      });
      if (decision !== "delete") return;
      if ([...promptedRevisions].some(([tabId, revision]) => (
        documentRevisionPort.readLiveRevision(tabId) !== revision
      ))) {
        showStatus("删除确认期间信笺又有修改，请再次确认", "warning");
        return;
      }
      const result = await bridge.deleteEntry?.(entry.path);
      if (!result?.ok) {
        showStatus(result?.message || "删除失败", "warning");
        return;
      }

      const removedTabs = snapshot.filter((tab) => pathIsSameOrInside(tab.path, entry.path));
      if (removedTabs.length) {
        let remainingTabs = snapshot.filter((tab) => !pathIsSameOrInside(tab.path, entry.path));
        if (rightSplitTabIdRef.current && removedTabs.some((tab) => tab.id === rightSplitTabIdRef.current)) {
          rightSplitTabIdRef.current = "";
          setRightSplitTabId("");
          setActivePane("main");
        }
        if (!remainingTabs.length) {
          const blank = createBlankDocument(letterTemplates, newDocumentTemplateId);
          remainingTabs = [createDocumentTab(blank)];
        }
        openTabsRef.current = remainingTabs;
        setOpenTabs(remainingTabs);
        removedTabs.forEach((tab) => releaseTabRuntimeState(tab.id));
        if (removedTabs.some((tab) => tab.id === activeTabIdRef.current)) {
          const nextTab = remainingTabs[0];
          activeTabIdRef.current = nextTab.id;
          setActiveTabId(nextTab.id);
          applyDocument(nextTab.document, nextTab.path, nextTab.dirty, { editorJson: nextTab.editorJson, scrollState: nextTab.scrollState });
          persistSession({ activePath: nextTab.path || nextTab.recoveryPath || "" });
        }
      }

      await refreshTreeAfterEntryChange(result.folderPath || folderState.path);
      showStatus("已删除", "success");
    } finally {
      affectedIds.forEach((tabId) => tabClosePendingIdsRef.current.delete(tabId));
    }
  }, [applyDocument, folderState.path, letterTemplates, newDocumentTemplateId, persistSession, refreshTreeAfterEntryChange, releaseTabRuntimeState, showConfirmDialog, showStatus, snapshotLiveTabs, waitForTabSave]);

  const handleMoveTreeEntry = useCallback(async (entry, targetFolderPath) => {
    if (!entry?.path || !targetFolderPath) {
      return;
    }
    const result = await bridge.moveEntry?.(entry.path, targetFolderPath);
    if (!result?.ok) {
      showStatus(result?.message || "移动失败", "warning");
      return;
    }

    const nextTabs = openTabsRef.current.map((tab) => (
      pathIsSameOrInside(tab.path, result.oldPath)
        ? { ...tab, path: replacePathPrefix(tab.path, result.oldPath, result.path) }
        : tab
    ));
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    if (pathIsSameOrInside(currentPathRef.current, result.oldPath)) {
      const nextPath = replacePathPrefix(currentPathRef.current, result.oldPath, result.path);
      currentPathRef.current = nextPath;
      setCurrentPath(nextPath);
      persistSession({ activePath: nextPath });
    }
    if (entry.type === "folder") {
      if (pathIsSameOrInside(folderPathRef.current, result.oldPath)) {
        folderRequestControllerRef.current.invalidate("view");
        folderPathRef.current = replacePathPrefix(folderPathRef.current, result.oldPath, result.path);
      }
      setFolderState((previous) => pathIsSameOrInside(previous.path, result.oldPath)
        ? { ...previous, path: replacePathPrefix(previous.path, result.oldPath, result.path) }
        : previous);
      folderBranchRequestControllerRef.current.invalidateAll();
      setExpandedFolders((previous) => {
        const next = Object.fromEntries(Object.entries(previous).map(([folderPath, value]) => [
          pathIsSameOrInside(folderPath, result.oldPath)
            ? replacePathPrefix(folderPath, result.oldPath, result.path)
            : folderPath,
          value,
        ]));
        expandedFoldersRef.current = next;
        return next;
      });
    }

    await refreshTreeAfterEntryChange(result.sourceParent || folderState.path);
    await refreshTreeAfterEntryChange(result.targetFolderPath || targetFolderPath);
    showStatus("已移动", "success");
  }, [folderState.path, persistSession, refreshTreeAfterEntryChange, showStatus]);

  const handleToggleFolder = useCallback(async (path) => {
    if (!path) return;
    const existing = expandedFoldersRef.current[path];
    if (existing?.expanded) {
      folderBranchRequestControllerRef.current.invalidate(path);
      setExpandedFolders((state) => ({
        ...state,
        [path]: { ...(state[path] || existing), expanded: false, loading: false },
      }));
      expandedFoldersRef.current = {
        ...expandedFoldersRef.current,
        [path]: { ...existing, expanded: false, loading: false },
      };
      return;
    }

    const request = folderBranchRequestControllerRef.current.begin(path);
    setExpandedFolders((state) => ({
      ...state,
      [path]: { ...(state[path] || {}), expanded: true, loading: true, error: "" },
    }));
    expandedFoldersRef.current = {
      ...expandedFoldersRef.current,
      [path]: { ...(expandedFoldersRef.current[path] || {}), expanded: true, loading: true, error: "" },
    };
    try {
      const result = await listFolderWithTimeout(path);
      if (!folderBranchRequestControllerRef.current.isCurrent(request)) return;
      if (result?.canceled) throw new Error("文件夹读取超时");
      setExpandedFolders((state) => {
        if (!state[path]?.expanded) return state;
        const next = {
          ...state,
          [path]: {
            ...state[path],
            loading: false,
            error: "",
            entries: result.entries || [...(result.folders || []), ...(result.files || [])],
          },
        };
        expandedFoldersRef.current = next;
        return next;
      });
    } catch (error) {
      if (!folderBranchRequestControllerRef.current.isCurrent(request)) return;
      setExpandedFolders((state) => {
        if (!state[path]?.expanded) return state;
        const next = {
          ...state,
          [path]: { ...state[path], loading: false, error: error?.message || "文件夹读取失败" },
        };
        expandedFoldersRef.current = next;
        return next;
      });
    } finally {
      folderBranchRequestControllerRef.current.finish(request);
    }
  }, []);

  const handleOutlineItemClick = useCallback(
    (item) => {
      if (!structureWorkEditor || typeof item?.pos !== "number") {
        return;
      }
      setActivePane(structureWorkEditor === rightSplitEditor ? "right" : "main");
      if (item.type === "toc") {
        const tocNode = structureWorkEditor.state.doc.nodeAt(item.pos);
        const selectionPos = Math.min(item.pos + (tocNode?.nodeSize || 1), structureWorkEditor.state.doc.content.size);
        structureWorkEditor.chain().focus().setTextSelection(selectionPos).run();
      } else {
        const selectionPos = Math.min(item.pos + 1, structureWorkEditor.state.doc.content.size);
        structureWorkEditor.chain().focus().setTextSelection(selectionPos).run();
      }
      window.requestAnimationFrame(() => {
        const node = structureWorkEditor.view.nodeDOM(item.pos);
        const element = node?.nodeType === window.Node.ELEMENT_NODE ? node : node?.parentElement;
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [rightSplitEditor, structureWorkEditor],
  );

  const handleSave = useCallback(
    async (saveAs) => {
      try {
        const focusedSecondaryView = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
        if (activePane === "right" && focusedSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
          showStatus("当前活动标签是资料；请先切回信笺再保存", "warning");
          return;
        }
        const targetTab = splitPaneActive && rightSplitTab
          ? rightSplitTab
          : openTabsRef.current.find((tab) => tab.id === activeTabIdRef.current);
        if (!targetTab) return;
        if (sessionClosePendingRef.current || tabClosePendingIdsRef.current.has(targetTab.id)) return;
        const recoveryIdToDelete = targetTab.recoveryPath ? recoveryTabId(targetTab) : "";
        const nextDocument = targetTab.id === rightSplitTab?.id && splitPaneActive
          ? getRightSplitSaveDocument()
          : getSaveDocument();
        if (!nextDocument) return;
        if (targetTab.readOnly || nextDocument?._readOnlyFutureSchema) {
          showStatus("此信笺使用未来格式，当前版本只能只读打开", "warning");
          return;
        }
        const revision = documentRevisionPort.readLiveRevision(targetTab.id);
        const previousDocumentKey = documentRuntimeKey(targetTab.path, targetTab.id);
        const reservedPaths = openTabsRef.current
          .filter((tab) => tab.id !== targetTab.id && tab.path)
          .map((tab) => tab.path);
        const expectedRevision = documentRevisionPort.readDiskRevision(targetTab.id)
          || targetTab.diskRevision
          || null;
        let result = await queueTabSave(targetTab.id, () => (
          bridge.saveDocument(nextDocument, targetTab.path, saveAs, reservedPaths, expectedRevision)
        ));
        if (result?.conflict) {
          const conflictedTabs = openTabsRef.current.map((tab) => (
            tab.id === targetTab.id ? { ...tab, externalChanged: true } : tab
          ));
          openTabsRef.current = conflictedTabs;
          setOpenTabs(conflictedTabs);
          const decision = await showConfirmDialog({
            tone: "warning",
            icon: RefreshCw,
            eyebrow: "检测到外部版本",
            title: "磁盘上的信笺已被其他程序修改",
            message: "磁盘版本已保留；当前内存稿也已保存为带时间戳的本机冲突副本。",
            detail: result.conflictCopyPath,
            cancelValue: "cancel",
            actions: [
              { value: "compare", label: "对照查看", variant: "primary" },
              { value: "reload", label: "重新载入磁盘版", variant: "secondary" },
              { value: "overwrite", label: "明确覆盖磁盘版", variant: "danger" },
              { value: "cancel", label: "稍后处理", variant: "ghost" },
            ],
          });
          if (decision === "overwrite") {
            result = await queueTabSave(targetTab.id, () => bridge.saveDocument(
              nextDocument,
              targetTab.path,
              false,
              reservedPaths,
              result.actualRevision,
              { conflictAction: "overwrite" },
            ));
            if (result?.conflict) {
              const conflictedAgainTabs = openTabsRef.current.map((tab) => (
                tab.id === targetTab.id ? { ...tab, externalChanged: true } : tab
              ));
              openTabsRef.current = conflictedAgainTabs;
              setOpenTabs(conflictedAgainTabs);
              showStatus("确认覆盖期间又检测到新的外部版本；未覆盖磁盘，并再次保留了本机冲突副本", "warning");
              return;
            }
          } else if (decision === "reload") {
            const reloaded = await bridge.openDocumentPath(targetTab.path);
            if (!reloaded?.canceled && reloaded?.document) {
              documentRevisionPort.commitDiskRevision(targetTab.id, reloaded.diskRevision);
              documentDirtyPort.markClean(targetTab.id);
              documentDirtyPort.commitRecoveryRevision(targetTab.id, null);
              const normalizedReload = normalizeDocument(reloaded.document, letterTemplates);
              const nextTabs = openTabsRef.current.map((tab) => tab.id === targetTab.id ? {
                ...tab,
                document: normalizedReload,
                dirty: false,
                diskRevision: reloaded.diskRevision,
                recoveryPath: "",
                recoveryId: "",
                recoverySourcePath: "",
                recoveryBaseRevision: null,
                recoveryRevision: null,
                recoveredTemporary: false,
                externalChanged: false,
              } : tab);
              openTabsRef.current = nextTabs;
              setOpenTabs(nextTabs);
              if (targetTab.id === activeTabIdRef.current) applyDocument(normalizedReload, targetTab.path, false);
              await deleteRecoveryBestEffort(bridge.deleteTempDocument, recoveryIdToDelete);
            }
            showStatus("已重新载入磁盘版本；内存稿保留在冲突副本中", "success");
            return;
          } else if (decision === "compare") {
            const diskResult = await bridge.openDocumentPath(targetTab.path);
            if (!diskResult?.canceled && diskResult?.document) {
              const comparisonId = addOrActivateDocumentTab({
                ...diskResult.document,
                title: `${diskResult.document.title || targetTab.title || "未命名信笺"}（磁盘版本对照）`,
              }, "", false, { readOnly: true });
              if (comparisonId) {
                rightSplitTabIdRef.current = targetTab.id;
                setRightSplitTabId(targetTab.id);
                setActivePane("main");
              }
            }
            showStatus("已在只读视图中打开磁盘版本；右侧保留当前内存稿，冲突副本也已写入磁盘", "success");
            return;
          } else {
            showStatus("两个版本都已保留，正文未被覆盖", "warning");
            return;
          }
        }
        if (result?.canceled) return;
        if (!result?.path) throw new Error("保存完成后没有返回文件路径");
        const unchanged = documentRevisionPort.readLiveRevision(targetTab.id) === revision;
        const savedDocument = normalizeDocument(result.document || nextDocument, letterTemplates);
        if (result.diskRevision) {
          documentRevisionPort.commitDiskRevision(targetTab.id, result.diskRevision);
        }
        migrateAiRequestDocumentKey(previousDocumentKey, documentRuntimeKey(result.path, targetTab.id));
        const latestSnapshot = unchanged ? openTabsRef.current : snapshotLiveTabs({ includeEditorJson: true });
        const latestTargetTab = latestSnapshot.find((tab) => tab.id === targetTab.id) || targetTab;
        const livePersistedDocument = unchanged
          ? savedDocument
          : mergePersistedDocumentIdentity(latestTargetTab.document || nextDocument, savedDocument);
        let recoveryWrite = null;
        let recoveryWriteError = null;
        if (unchanged) {
          documentDirtyPort.markClean(targetTab.id);
          documentDirtyPort.commitRecoveryRevision(targetTab.id, null);
        } else {
          try {
            recoveryWrite = await queueTabSave(targetTab.id, () => bridge.saveTempDocument?.(
              livePersistedDocument,
              recoveryTabId(latestTargetTab),
            ));
            if (recoveryWrite?.canceled || !recoveryWrite?.path) throw new Error("恢复缓存未生成文件");
          } catch (error) {
            recoveryWriteError = error;
          }
        }
        const commitSnapshot = unchanged
          ? latestSnapshot
          : snapshotLiveTabs({ includeEditorJson: true });
        const commitTargetTab = commitSnapshot.find((tab) => tab.id === targetTab.id) || latestTargetTab;
        const committedLiveDocument = unchanged
          ? livePersistedDocument
          : mergePersistedDocumentIdentity(commitTargetTab.document || livePersistedDocument, savedDocument);
        const nextTabs = commitSnapshot.map((tab) => (
          tab.id === targetTab.id
            ? {
                ...tab,
                path: result.path,
                recoveryPath: unchanged ? "" : (recoveryWrite?.path || tab.recoveryPath || ""),
                recoveryId: unchanged ? "" : (recoveryWrite?.recoveryId || tab.recoveryId || recoveryTabId(tab)),
                recoverySourcePath: unchanged ? "" : (recoveryWrite?.path ? result.path : tab.recoverySourcePath || ""),
                recoveryBaseRevision: unchanged ? null : (recoveryWrite?.path ? normalizeSessionDiskRevision(result.diskRevision) : tab.recoveryBaseRevision || null),
                recoveryRevision: unchanged
                  ? null
                  : (recoveryWrite?.path ? latestTargetTab.snapshotRevision : tab.recoveryRevision),
                recoveredTemporary: unchanged ? false : Boolean(recoveryWrite?.path || tab.recoveryPath),
                title: committedLiveDocument.title,
                document: committedLiveDocument,
                diskRevision: result.diskRevision || tab.diskRevision,
                externalChanged: false,
                dirty: !unchanged,
              }
            : tab
        ));
        openTabsRef.current = nextTabs;
        setOpenTabs(nextTabs);
        const committedTargetRuntime = nextTabs.find((tab) => tab.id === targetTab.id);
        documentDirtyPort.commitRecoveryRevision(
          targetTab.id,
          committedTargetRuntime?.recoveryRevision,
        );
        if (targetTab.id === activeTabIdRef.current) {
          currentPathRef.current = result.path;
          setCurrentPath(result.path);
          dirtyRef.current = !unchanged;
          setDirty(!unchanged);
          documentStateRef.current = committedLiveDocument;
          setDocumentState(committedLiveDocument);
        }
        const activeSessionTab = nextTabs.find((tab) => tab.id === activeTabIdRef.current) || nextTabs[0];
        persistSession({ activePath: activeSessionTab?.path || activeSessionTab?.recoveryPath || "", tabs: summarizeSessionTabs(nextTabs) });
        refreshFolder();
        const recoveryCleaned = unchanged
          ? await deleteRecoveryBestEffort(bridge.deleteTempDocument, recoveryIdToDelete)
          : true;
        if (unchanged && !recoveryCleaned) {
          showStatus("文档已保存，但旧恢复文件清理失败", "warning");
        } else if (!unchanged && recoveryWriteError) {
          showStatus(`已写入点击保存时的版本，但后续编辑写入恢复缓存失败：${recoveryWriteError?.message || "稍后将重试"}`, "warning");
        } else if (!unchanged) {
          showStatus("已写入点击保存时的版本；保存期间的新编辑已写入恢复缓存", "success");
        } else {
          showStatus(targetTab.id === rightSplitTab?.id && splitPaneActive ? "右分屏信笺已保存" : "文档已保存", "success");
        }
      } catch (error) {
        showStatus(error?.message || "文档保存失败", "warning");
      }
    },
    [activePane, addOrActivateDocumentTab, applyDocument, getRightSplitSaveDocument, getSaveDocument, letterTemplates, migrateAiRequestDocumentKey, persistSession, queueTabSave, refreshFolder, rightSplitTab, showConfirmDialog, showStatus, snapshotLiveTabs, splitPaneActive],
  );

  useEffect(() => {
    const unsubscribe = bridge.onCloseRequest?.(async (payload = {}) => {
      if (sessionClosePendingRef.current) return;
      sessionClosePendingRef.current = true;
      let closeCommitted = false;
      try {
      await documentSaveQueuePort.waitAll();
      const snapshot = snapshotLiveTabs();
      const dirtyTabs = snapshot.filter((tab) => tab.dirty);
      const promptedRevisions = new Map(
        dirtyTabs.map((tab) => [tab.id, tab.snapshotRevision]),
      );
      let finalTabs = snapshot;

      if (dirtyTabs.length) {
        const decision = await showConfirmDialog({
          tone: "save",
          icon: Save,
          eyebrow: "关闭前确认",
          title: dirtyTabs.length > 1 ? `${dirtyTabs.length} 篇信笺尚未保存` : "当前信笺尚未保存",
          message: "选择保存并关闭，会先保存已有文件。",
          detail: "未命名信笺会保存为临时会话文件，下次启动会恢复打开。",
          cancelValue: "cancel",
          actions: [
            { value: "save", label: "保存并关闭", variant: "primary", icon: Save, autoFocus: true },
            { value: "discard", label: "不保存", variant: "secondary" },
            { value: "cancel", label: "取消", variant: "ghost" },
          ],
        });
        if (decision === "cancel" || !decision) {
          await bridge.closeCanceled?.(payload);
          return;
        }

        if (decision === "discard") {
          const latestSnapshot = snapshotLiveTabs();
          const changedWhileConfirming = latestSnapshot.some((tab) => (
            tab.dirty
            && (
              !promptedRevisions.has(tab.id)
              || tab.snapshotRevision !== promptedRevisions.get(tab.id)
            )
          ));
          if (changedWhileConfirming) {
            showStatus("关闭确认期间文档又有修改，请再次确认", "warning");
            await bridge.closeCanceled?.(payload);
            return;
          }
          const latestDirtyTabs = latestSnapshot.filter((tab) => tab.dirty);
          await Promise.allSettled(
            latestDirtyTabs.filter((tab) => !tab.path && tab.recoveryPath)
              .map((tab) => bridge.deleteTempDocument?.(recoveryTabId(tab))),
          );
          const discardedIds = new Set(latestDirtyTabs.filter((tab) => !tab.path).map((tab) => tab.id));
          finalTabs = latestSnapshot.filter((tab) => !discardedIds.has(tab.id));
        }

        if (decision === "save") {
          finalTabs = snapshotLiveTabs();
          const savedTabs = [];
          try {
            for (const tab of finalTabs) {
              if (!snapshotRevisionIsCurrent(tab, documentRevisionPort)) {
                showStatus("保存期间文档又有修改，请确认内容后再次关闭", "warning");
                await bridge.closeCanceled?.(payload);
                return;
              }
              if (!tab.dirty) {
                savedTabs.push(tab);
                continue;
              }
              const result = await queueTabSave(tab.id, () => (tab.path
                ? bridge.saveDocument(
                    tab.document,
                    tab.path,
                    false,
                    [],
                    documentRevisionPort.readDiskRevision(tab.id)
                      || tab.diskRevision
                      || null,
                  )
                : bridge.saveTempDocument?.(tab.document, recoveryTabId(tab))));
              if (result?.conflict) {
                throw new Error(`检测到外部版本；内存稿已保存为冲突副本：${result.conflictCopyPath}`);
              }
              if (result?.canceled || !result?.path) {
                await bridge.closeCanceled?.(payload);
                return;
              }
              if (tab.path && result.diskRevision) {
                documentRevisionPort.commitDiskRevision(tab.id, result.diskRevision);
              }
              if (!snapshotRevisionIsCurrent(tab, documentRevisionPort)) {
                showStatus("保存期间文档又有修改，请确认内容后再次关闭", "warning");
                await bridge.closeCanceled?.(payload);
                return;
              }
              savedTabs.push({
                ...tab,
                path: tab.path ? result.path : "",
                recoveryPath: tab.path ? "" : result.path,
                recoveryId: tab.path ? "" : (result.recoveryId || recoveryTabId(tab)),
                recoveredTemporary: !tab.path,
                document: result.document || tab.document,
                diskRevision: result.diskRevision || tab.diskRevision,
                recoverySourcePath: tab.path ? "" : tab.recoverySourcePath,
                recoveryBaseRevision: tab.path ? null : tab.recoveryBaseRevision,
                recoveryRevision: tab.path ? null : tab.snapshotRevision,
                dirty: !tab.path,
              });
            }
            const savedSnapshotById = new Map(savedTabs.map((tab) => [tab.id, tab]));
            const changedAfterSaving = openTabsRef.current.some((tab) => {
              const savedSnapshot = savedSnapshotById.get(tab.id);
              return !savedSnapshot
                || !snapshotRevisionIsCurrent(savedSnapshot, documentRevisionPort);
            });
            if (changedAfterSaving) {
              showStatus("保存期间文档又有修改，请确认内容后再次关闭", "warning");
              await bridge.closeCanceled?.(payload);
              return;
            }
            finalTabs = savedTabs;
          } catch (error) {
            showStatus(error?.message || "关闭前保存失败", "warning");
            await bridge.closeCanceled?.(payload);
            return;
          }
        }
      }

      const activeTab = finalTabs.find((tab) => tab.id === activeTabIdRef.current) || finalTabs[0];
      persistSession({
        activePath: activeTab?.path || activeTab?.recoveryPath || "",
        tabs: summarizeSessionTabs(finalTabs),
      });
      await bridge.closeReady?.(payload);
      closeCommitted = true;
      } finally {
        if (!closeCommitted) sessionClosePendingRef.current = false;
      }
    });
    return () => unsubscribe?.();
  }, [persistSession, queueTabSave, showConfirmDialog, showStatus, snapshotLiveTabs]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (autosaveRunningRef.current || sessionClosePendingRef.current) return;
      autosaveRunningRef.current = true;
      try {
        const snapshot = snapshotLiveTabs();
        const dirtyTabs = selectAutosaveSnapshotTabs(
          snapshot,
          documentSaveQueuePort,
          tabClosePendingIdsRef.current,
        );
        if (!dirtyTabs.length) return;
        const updates = new Map();
        for (const tab of dirtyTabs) {
          if (
            documentSaveQueuePort.hasPending(tab.id)
            || !snapshotRevisionIsCurrent(tab, documentRevisionPort)
          ) {
            continue;
          }
          try {
            const result = await queueTabSave(tab.id, () => bridge.saveTempDocument?.(tab.document, recoveryTabId(tab)));
            if (result?.canceled || !result?.path) throw new Error("自动保存没有生成可恢复文件");
            updates.set(tab.id, {
              path: result.path,
              sourcePath: tab.path || "",
              baseRevision: normalizeSessionDiskRevision(
                documentRevisionPort.readDiskRevision(tab.id)
                  || tab.diskRevision,
              ),
              recoveryId: result.recoveryId || recoveryTabId(tab),
              snapshotRevision: tab.snapshotRevision,
            });
          } catch (error) {
            const now = Date.now();
            if (now - autosaveErrorAtRef.current > 5 * 60 * 1000) {
              autosaveErrorAtRef.current = now;
              showStatus(error?.message || "自动保存失败，将在稍后重试", "warning");
            }
          }
        }
        if (!updates.size) return;
        const appliedUpdates = new Map();
        const nextTabs = openTabsRef.current.map((tab) => {
          const update = updates.get(tab.id);
          if (!update) return tab;
          const targetUnchanged = sameDocumentPath(tab.path || "", update.sourcePath);
          if (!targetUnchanged) return tab;
          appliedUpdates.set(tab.id, update);
          return {
            ...tab,
            recoveryPath: update.path,
            recoveryId: update.recoveryId,
            recoverySourcePath: update.sourcePath,
            recoveryBaseRevision: update.baseRevision,
            recoveryRevision: update.snapshotRevision,
            recoveredTemporary: true,
            dirty: true,
          };
        });
        openTabsRef.current = nextTabs;
        setOpenTabs(nextTabs);
        appliedUpdates.forEach((update, tabId) => {
          documentDirtyPort.commitRecoveryRevision(
            tabId,
            update.snapshotRevision,
          );
        });
        const activeId = activeTabIdRef.current;
        persistSession({
          activePath: nextTabs.find((tab) => tab.id === activeId)?.path
            || nextTabs.find((tab) => tab.id === activeId)?.recoveryPath
            || "",
          tabs: summarizeSessionTabs(nextTabs),
        });
      } finally {
        autosaveRunningRef.current = false;
      }
    }, 30000);

    return () => window.clearInterval(timer);
  }, [persistSession, queueTabSave, showStatus, snapshotLiveTabs]);

  const flushDirtyWorkspaceTabs = useCallback(async ({ idleOnly = false } = {}) => {
    if (sessionClosePendingRef.current) return;
    const now = Date.now();
    const snapshot = snapshotLiveTabs();
    const candidates = snapshot.filter((tab) => tab.path && tab.dirty && !tab.readOnly && !tab.externalChanged
      && (!idleOnly || now - (documentRevisionPort.readLastEditAt(tab.id) || now) >= 5 * 60 * 1000));
    for (const tab of candidates) {
      if (
        documentSaveQueuePort.hasPending(tab.id)
        || !snapshotRevisionIsCurrent(tab, documentRevisionPort)
      ) continue;
      try {
        const expectedRevision = documentRevisionPort.readDiskRevision(tab.id)
          || tab.diskRevision
          || null;
        const result = await queueTabSave(tab.id, () => bridge.saveDocument(tab.document, tab.path, false, [], expectedRevision));
        if (result?.conflict) {
          setOpenTabs((previous) => {
            const next = previous.map((item) => item.id === tab.id ? { ...item, externalChanged: true } : item);
            openTabsRef.current = next;
            return next;
          });
          showStatus(`检测到外部版本；本机稿已保留为冲突副本`, "warning");
          continue;
        }
        if (!result?.path) continue;
        if (result.diskRevision) {
          documentRevisionPort.commitDiskRevision(tab.id, result.diskRevision);
        }
        if (!snapshotRevisionIsCurrent(tab, documentRevisionPort)) continue;
        documentDirtyPort.markClean(tab.id);
        documentDirtyPort.commitRecoveryRevision(tab.id, null);
        const nextTabs = openTabsRef.current.map((item) => item.id === tab.id ? {
          ...item,
          document: result.document || tab.document,
          diskRevision: result.diskRevision,
          recoveryPath: "",
          recoveryId: "",
          recoverySourcePath: "",
          recoveryBaseRevision: null,
          recoveryRevision: null,
          recoveredTemporary: false,
          dirty: false,
          externalChanged: false,
        } : item);
        openTabsRef.current = nextTabs;
        setOpenTabs(nextTabs);
        if (tab.id === activeTabIdRef.current) {
          dirtyRef.current = false;
          setDirty(false);
        }
        if (tab.recoveryPath) await bridge.deleteTempDocument?.(recoveryTabId(tab)).catch?.(() => {});
      } catch (error) {
        const timestamp = Date.now();
        if (timestamp - autosaveErrorAtRef.current > 5 * 60 * 1000) {
          autosaveErrorAtRef.current = timestamp;
          showStatus(error?.message || "工作区自动写入失败，将继续保留恢复缓存", "warning");
        }
      }
    }
    persistSession({ tabs: summarizeSessionTabs(openTabsRef.current) });
  }, [persistSession, queueTabSave, showStatus, snapshotLiveTabs]);

  useEffect(() => {
    const timer = window.setInterval(() => flushDirtyWorkspaceTabs({ idleOnly: true }), 30000);
    return () => window.clearInterval(timer);
  }, [flushDirtyWorkspaceTabs]);

  useEffect(() => bridge.onWindowBlur?.(() => flushDirtyWorkspaceTabs({ idleOnly: false })), [flushDirtyWorkspaceTabs]);

  const {
    handleOpenExportDialog,
    handleCloseExportDialog,
  } = useExportDialogActions({
    activeTabIdRef,
    activeWorkDocument,
    activeWorkEditor,
    rightSplitTabIdRef,
    setExportDialogOpen,
    setExportTarget,
    showStatus,
    splitPaneActive,
  });

  const resolveExportTarget = useCallback(() => {
    if (!exportTarget?.tabId) {
      throw new Error("导出目标已经失效，请关闭窗口后重试");
    }
    if (exportTarget.pane === "right") {
      if (rightSplitTabIdRef.current !== exportTarget.tabId || !rightSplitEditor) {
        throw new Error("右侧导出目标已经变化，请关闭窗口后重试");
      }
      const nextDocument = getRightSplitSaveDocument();
      if (!nextDocument) throw new Error("无法读取右侧信笺内容");
      return { pane: "right", document: nextDocument, canvas: rightCanvasRef.current };
    }
    if (activeTabIdRef.current !== exportTarget.tabId || !editor) {
      throw new Error("导出目标已经变化，请关闭窗口后重试");
    }
    const nextDocument = getSaveDocument();
    if (!nextDocument) throw new Error("无法读取当前信笺内容");
    return { pane: "main", document: nextDocument, canvas: mainCanvasRef.current };
  }, [editor, exportTarget, getRightSplitSaveDocument, getSaveDocument, rightSplitEditor]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isGlobalShortcutBlocked(event)) return;
      if (event.key === "Escape" && searchMode) {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const state = workspaceGroupsRef.current;
      const focusedGroupId = activePane === "right" && state.secondary.views.length
        ? WORKSPACE_GROUP_ID.SECONDARY
        : WORKSPACE_GROUP_ID.PRIMARY;
      const focusedView = getActiveWorkspaceView(state, focusedGroupId);
      const focusedResearch = focusedGroupId === WORKSPACE_GROUP_ID.SECONDARY
        && focusedView?.kind === WORKSPACE_VIEW_KIND.RESEARCH;
      if (!event.altKey && key === "w") {
        if (window.document.querySelector("[role='dialog'],[role='alertdialog']")) return;
        event.preventDefault();
        if (focusedView) void handleCloseGroupView(focusedGroupId, focusedView.viewId);
        return;
      }
      if (event.altKey && key === "i") {
        event.preventDefault();
        handleImportDocument();
      } else if (event.altKey && key === "e") {
        event.preventDefault();
        handleOpenExportDialog();
      } else if (!event.altKey && key === "n") {
        event.preventDefault();
        handleNew();
      } else if (!event.altKey && key === "o") {
        event.preventDefault();
        handleOpen();
      } else if (key === "s") {
        event.preventDefault();
        handleSave(event.shiftKey);
      } else if (key === "f") {
        event.preventDefault();
        if (focusedResearch) {
          closeSearch();
          window.dispatchEvent(new CustomEvent("paper-pdf-find"));
        } else openSearch("document");
      } else if (key === "h") {
        event.preventDefault();
        if (!focusedResearch) openSearch("document", { replace: true });
      } else if (key === "p") {
        event.preventDefault();
        openSearch("workspace");
      }
    };

    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [activePane, closeSearch, handleCloseGroupView, handleImportDocument, handleNew, handleOpen, handleOpenExportDialog, handleSave, openSearch, searchMode]);

  const {
    handleExportPdf,
    handleExportImages,
    handleExportEditable,
  } = useExportExecutionActions({
    resolveExportTarget,
    setExportRenderPane,
    setImageExportMode,
    setPrintMode,
    showStatus,
  });

  const handleInsertImage = useCallback(async () => {
    if (activeWorkReadOnly || !activeWorkEditor) {
      showStatus("当前信笺为只读，不能插入图片", "warning");
      return;
    }
    let result;
    try {
      result = await bridge.pickImage();
    } catch (error) {
      showStatus(error?.message || "图片暂存失败，未插入文档", "warning");
      return;
    }
    if (result?.canceled) {
      return;
    }
    if (result?.error === "unsupported-type") {
      showStatus("不支持这种图片格式，请选择 PNG、JPEG、GIF、WebP、BMP、SVG 或 AVIF", "warning");
      return;
    }
    const src = normalizeImageSource(result?.src || result?.dataUrl);
    if (!src) {
      showStatus("图片资源地址无效，未插入文档", "warning");
      return;
    }
    activeWorkEditor?.chain().focus().setImage({
      src,
      alt: normalizeImageText(result.name || "图片"),
      caption: "",
      width: "78%",
      imageId: createDocumentId(),
    }).run();
  }, [activeWorkEditor, activeWorkReadOnly, showStatus]);

  const handleInsertMedia = useCallback(async (kind) => {
    if (activeWorkReadOnly || !activeWorkEditor) {
      showStatus("当前信笺为只读，不能插入媒体", "warning");
      return;
    }
    const picker = kind === "video" ? bridge.pickVideo : bridge.pickAudio;
    let result;
    try {
      result = await picker?.();
    } catch {
      showStatus(`${kind === "video" ? "视频" : "音频"}文件读取失败`, "warning");
      return;
    }
    if (!result || result.canceled) {
      return;
    }
    const label = kind === "video" ? "视频" : "音频";
    const maxBytes = kind === "video" ? VIDEO_MAX_BYTES : AUDIO_MAX_BYTES;
    if (result.error === "too-large") {
      showStatus(`${label}文件不能超过 ${Math.round(maxBytes / 1024 / 1024)} MB`, "warning");
      return;
    }
    if (result.error === "unsupported-type") {
      showStatus(`不支持这个${label}格式`, "warning");
      return;
    }
    const mediaSource = normalizeMediaSource(result.src || result.dataUrl, kind);
    if (result.error || !mediaSource) {
      showStatus(`${label}文件读取失败`, "warning");
      return;
    }
    activeWorkEditor?.chain().focus().insertContent({
      type: "paperMedia",
      attrs: {
        kind,
        src: mediaSource,
        fileName: normalizeMediaFileName(result.fileName || result.name, `未命名${label}`),
        mime: normalizeMediaMime(result.mime, kind),
        width: "78%",
      },
    }).run();
    showStatus(`${label}已插入`, "success");
  }, [activeWorkEditor, activeWorkReadOnly, showStatus]);

  const handleOpenLinkDialog = useCallback(() => {
    if (activeWorkReadOnly) {
      showStatus("当前信笺为只读，不能修改链接", "warning");
      return;
    }
    const context = getEditorLinkContext(activeWorkEditor, activeWorkSelectionRef);
    if (!context || !activeWorkEditor) {
      return;
    }
    setLinkDialog({ ...context, editor: activeWorkEditor });
  }, [activeWorkEditor, activeWorkReadOnly, activeWorkSelectionRef, showStatus]);

  const handleCloseLinkDialog = useCallback(() => {
    setLinkDialog(null);
  }, []);

  const handleEditLinkFromCanvas = useCallback((context, targetEditor) => {
    if (!context?.editing || !targetEditor) {
      return;
    }
    setLinkDialog({ ...context, editor: targetEditor });
  }, []);

  const handleSubmitLink = useCallback(({ text, url }) => {
    if (!linkDialog?.editor || activeWorkReadOnly) {
      if (activeWorkReadOnly) showStatus("当前信笺为只读，不能修改链接", "warning");
      return;
    }
    const content = {
      type: "paperExternalLink",
      attrs: { href: url, label: text },
    };
    linkDialog.editor
      .chain()
      .focus()
      .insertContentAt({ from: linkDialog.from, to: linkDialog.to }, content)
      .setTextSelection(linkDialog.from + 1)
      .run();
    setLinkDialog(null);
    showStatus(linkDialog.editing ? "链接已更新" : "链接已插入", "success");
  }, [activeWorkReadOnly, linkDialog, showStatus]);

  const handleRemoveLink = useCallback(() => {
    if (!linkDialog?.editor || activeWorkReadOnly) {
      if (activeWorkReadOnly) showStatus("当前信笺为只读，不能修改链接", "warning");
      return;
    }
    const label = String(linkDialog.text || "");
    linkDialog.editor.chain().focus().insertContentAt(
      { from: linkDialog.from, to: linkDialog.to },
      label ? { type: "text", text: label } : "",
    ).setTextSelection(linkDialog.from + label.length).run();
    setLinkDialog(null);
    showStatus("链接已移除", "success");
  }, [activeWorkReadOnly, linkDialog, showStatus]);

  const updateDocumentSetting = useCallback((patch) => {
    const updatedAt = new Date().toISOString();
    recordTabMutation(activeTabIdRef.current, updatedAt);
    const nextDocument = {
      ...documentStateRef.current,
      ...patch,
      updatedAt,
    };
    documentStateRef.current = nextDocument;
    setDocumentState(nextDocument);
  }, [recordTabMutation]);

  const {
    handleApplyTabTemplate,
    handleCreateUserTemplate,
    handleUpdateUserTemplate,
    handleCreateUserTemplateGroup,
    handleRenameUserTemplateGroup,
    handleReorderUserTemplateGroups,
    handleDeleteUserTemplateGroup,
    handleMoveUserTemplate,
    handleDeleteUserTemplate,
    handleNewDocumentTemplateChange,
    handleTabTemplateChange,
  } = useTemplateCatalogActions({
    activeTabIdRef,
    documentStateRef,
    letterTemplates,
    newDocumentTemplateHistory,
    newDocumentTemplateId,
    openTabsRef,
    recordTabMutation,
    setDocumentState,
    setNewDocumentTemplateHistory,
    setNewDocumentTemplateId,
    setOpenTabs,
    setUserLetterTemplates,
    setUserTemplateGroups,
    showStatus,
    snapshotLiveTabs,
    tabTemplateTargetTabId: tabTemplateDialog.targetTabId,
    userLetterTemplates,
    userTemplateGroups,
  });

  const {
    handleClearAiConfig,
    handleCreateAiProvider,
    handleDeleteAiProvider,
    handleLoginCodexCli,
    handleRefreshCodexCli,
    handleSaveAiConfig,
    handleTestAiConfig,
  } = useAiConfigActions({
    setAiConfig,
    showStatus,
  });

  const aiLayoutPort = useAiLayoutPort({
    activeTabIdRef,
    aiPreviousSidebarsRef,
    aiSecondaryPaneLayoutRef,
    applyDocument,
    commitWorkspaceGroups,
    immersiveSecondaryPaneLayoutRef,
    openTabsRef,
    previousImmersiveModeRef,
    setActivePane,
    setActiveTabId,
    setLeftSidebarCollapsed,
    setOpenTabs,
    snapshotLiveTabs,
    workspaceGroupsRef,
  });

  const {
    requestAiModeChange,
    requestExitAiMode,
  } = useAiModeTransitionActions({
    activePane,
    activeTabReadOnly,
    aiHasUsableProvider,
    aiModeKind,
    aiStatus,
    effectiveAiProvider,
    getActiveDocumentSnapshot,
    immersiveMode,
    layoutPort: aiLayoutPort,
    leftSidebarCollapsed,
    openAiSettings,
    setAiModeChooserOpen,
    setAiModeKind,
    setAiPageTransition,
    setAiSelectedProvider,
    showConfirmDialog,
    showStatus,
    streamRegistry: aiStreamRegistry,
    updateActiveDocumentAiState,
  });

  const {
    handleCaptureAiChatSelection,
    handleJumpAiChatSelection,
    handleRemoveAiChatSelection,
  } = useAiChatSelectionActions({
    aiChatSelections,
    editor,
    showStatus,
    updateChatState,
  });

  const knowledgeDocumentPort = useKnowledgeDocumentPort({
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
    writingWorkspaceRoot,
  });
  const hasOpenResearchViewsForLibrary = useCallback((libraryId) => (
    workspaceGroupsRef.current.secondary.views.some((view) => (
      view.kind === WORKSPACE_VIEW_KIND.RESEARCH && view.libraryId === libraryId
    ))
  ), []);

  const getOpenResearchViews = useCallback(
    () => workspaceGroupsRef.current.secondary.views,
    [],
  );

  const openResearchPreviewView = useCallback(({ item, researchType, target, titleSnapshot }) => {
    if (rightSplitTabIdRef.current) {
      const snapshot = snapshotLiveTabs({ includeEditorJson: true });
      openTabsRef.current = snapshot;
      setOpenTabs(snapshot);
    }
    const nextGroups = openWorkspaceResearch(workspaceGroupsRef.current, {
      ...target,
      titleSnapshot,
      researchType,
    });
    const activeView = getActiveWorkspaceView(nextGroups, WORKSPACE_GROUP_ID.SECONDARY);
    commitWorkspaceGroups(nextGroups);
    if (activeView) setResearchItemsByViewId((previous) => ({ ...previous, [activeView.viewId]: item }));
    setActivePane("right");
    setActiveLibraryItem(item);
    setActiveResearchError("");
  }, [commitWorkspaceGroups, snapshotLiveTabs]);

  const closeActiveResearchView = useCallback(() => {
    const active = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
    if (active?.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
      void handleCloseGroupView(WORKSPACE_GROUP_ID.SECONDARY, active.viewId);
    }
  }, [handleCloseGroupView]);

  const researchViewsPort = {
    closeActiveResearchView,
    getOpenResearchViews,
    hasOpenResearchViewsForLibrary,
    openResearchPreviewView,
    removeOpenResearchViews,
    updateOpenResearchTargets,
  };

  const {
    applyResearchRoot,
    refreshIndependentResearchFolder,
    refreshResearchLibrarySources,
    refreshResearchRoot,
    refreshResearchWebTree,
  } = useResearchRefreshActions({
    hasOpenResearchViewsForLibrary: researchViewsPort.hasOpenResearchViewsForLibrary,
    removeOpenResearchViews: researchViewsPort.removeOpenResearchViews,
    researchState,
    requestControllerRefs: researchRequestControllerRefs,
    showStatus,
  });


  useResearchMountLifecycle(refreshResearchRoot);

  useResearchViewReconciliationLifecycle({
    librarySources,
    librarySourcesReady,
    removeOpenResearchViews: researchViewsPort.removeOpenResearchViews,
    researchItemsByViewId,
    researchRoot,
    setActiveLibraryItem,
    setResearchItemsByViewId,
    webScopeKey,
    webTreeReady,
    webTreeState,
    webWorkspaceIdentityPending,
    workspaceGroups,
  });

  const openResearchTargetSignature = useOpenResearchTargetSignature(workspaceGroups);

  useResearchOpenTargetValidationLifecycle({
    getOpenResearchViews: researchViewsPort.getOpenResearchViews,
    librarySources,
    openResearchTargetSignature,
    removeOpenResearchViews: researchViewsPort.removeOpenResearchViews,
    researchRoot,
    researchRootRef,
  });

  useResearchWatcherLifecycle({
    refreshIndependentResearchFolder,
    refreshResearchLibrarySources,
    refreshResearchWebTree,
    researchCurrentRelativePathRef,
    researchRoot,
    researchRootRef,
    setResearchTreeError,
  });


  const {
    handleCopyResearchPath,
    handleCreateResearchFolder,
    handleImportResearchFiles,
    handleMoveResearchEntry,
    handleNavigateResearchPath,
    handlePickResearchRoot,
    handleRenameResearchEntry,
    handleShowResearchEntry,
    handleToggleResearchFolder,
    handleTrashResearchEntry,
  } = useResearchFileActions({
    activeSecondaryView,
    applyResearchRoot,
    refreshIndependentResearchFolder,
    removeOpenResearchViews: researchViewsPort.removeOpenResearchViews,
    researchState,
    requestControllerRefs: researchRequestControllerRefs,
    setLeftSidebarMode,
    showConfirmDialog,
    showPromptDialog,
    showStatus,
    updateOpenResearchTargets: researchViewsPort.updateOpenResearchTargets,
  });


  const {
    closeResearchSecondaryPane,
    handleLoadIndependentResearchPdf,
    handleLoadIndependentResearchPreview,
    handleOpenIndependentResearchExternal,
    openIndependentResearchItem,
  } = useResearchOpenActions({
    addOrActivateDocumentTab,
    aiMode,
    closeActiveResearchView: researchViewsPort.closeActiveResearchView,
    handleNavigateResearchPath,
    openResearchPreviewView: researchViewsPort.openResearchPreviewView,
    requestExitAiMode,
    researchState,
    showStatus,
  });


  const {
    handleAddLibraryWeb,
    handleCloseWebCopyDialog,
    handleCopyWebSelection,
    handleCreateWebFolder,
    handleDeleteLibrarySource,
    handleDeleteWebFolder,
    handleEditLibrarySource,
    handleMoveWebFolder,
    handleMoveWebSource,
    handleOpenWebCopyDialog,
    handleRenameWebFolder,
    handleSaveLibraryWeb,
    handleToggleWebWorkspace,
    saveResearchLibrarySource,
  } = useResearchSourceWebActions({
    refreshResearchLibrarySources,
    refreshResearchWebTree,
    removeOpenResearchViews: researchViewsPort.removeOpenResearchViews,
    researchState,
    setWebCopyDialog,
    setWebSourceDialog,
    showConfirmDialog,
    showPromptDialog,
    showStatus,
    webSourceDialog,
  });



  const knowledgeResearchPort = useKnowledgeResearchPort({
    activeLibraryItem,
    librarySourcesRef,
    researchItemsByViewIdRef,
    researchRootRef,
    saveResearchLibrarySource,
    workspaceGroupsRef,
  });

  const refreshWorkspaceCitationSources = useWorkspaceCitationLibrary({
    documentPort: knowledgeDocumentPort,
    setCitationLibraryLoading,
    setWorkspaceCitationSources,
    showStatus,
  });

  useWorkspaceCitationLibraryLifecycle({
    leftSidebarMode,
    refreshWorkspaceCitationSources,
    structureMode,
  });

  const handleResearchViewStateChange = useCallback((viewId, viewState) => {
    const active = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
    if (active?.kind !== WORKSPACE_VIEW_KIND.RESEARCH || active.viewId !== viewId) return;
    const current = workspaceGroupsRef.current;
    const next = updateWorkspaceResearchViewState(current, active.viewId, viewState);
    if (next === current) return;
    commitWorkspaceGroups(next);
  }, [commitWorkspaceGroups]);

  useKnowledgeEditorSyncLifecycle({
    activeWorkDocument,
    activeWorkEditor,
  });

  useImageReferenceLifecycle({
    documentPort: knowledgeDocumentPort,
    showStatus,
  });

  const { closeKnowledgeReferencePopover } = useKnowledgeReferencePopoverActions({
    activeTabId,
    citationPicker,
    citationSourceDialog,
    documentPort: knowledgeDocumentPort,
    footnoteDialog,
    rightSplitTabId,
    setKnowledgeReferencePopover,
    workspaceCitationSources,
  });

  const {
    handleAddFootnote,
    handleDeleteFootnote,
    handleEditFootnote,
    handleJumpFootnote,
    handleSaveFootnoteDialog,
  } = useFootnoteActions({
    activeWorkReadOnly,
    documentPort: knowledgeDocumentPort,
    footnoteDialog,
    knowledgeReferences,
    setFootnoteDialog,
    showConfirmDialog,
    showStatus,
    structureWorkEditor,
  });

  const {
    defaultPdfPageForCitationSource,
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
  } = useCitationActions({
    activeWorkReadOnly,
    citationOrder,
    citationPicker,
    citationSourceDialog,
    documentPort: knowledgeDocumentPort,
    knowledgeReferences,
    refreshWorkspaceCitationSources,
    researchPort: knowledgeResearchPort,
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
  });

  const {
    handleChooseInternalLink,
    handleJumpInternalLinkUsage,
    handleOpenInternalLinkPicker,
    handleOpenRelatedDocument,
    handleRegenerateDuplicateIdentity,
    handleRelinkInternalLink,
    handleRemoveInternalLink,
  } = useWorkspaceRelationshipActions({
    activeWorkReadOnly,
    documentPort: knowledgeDocumentPort,
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
  });

  useEffect(() => {
    aiLayoutPort.transitionImmersiveLayout({
      activePane,
      aiMode,
      immersiveMode,
    });
  }, [activePane, aiLayoutPort, aiMode, immersiveMode]);

  const setImmersive = useCallback(async (nextValue) => {
    const next = Boolean(nextValue);
    await bridge.setFullscreen?.(next);
    setImmersiveMode(next);
  }, []);

  useEffect(() => bridge.onFullscreenChanged?.((payload) => {
    setImmersiveMode(Boolean(payload?.fullscreen));
  }), []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isGlobalShortcutBlocked(event)) return;
      if (event.key === "F11") {
        event.preventDefault();
        setImmersive(!immersiveMode);
        return;
      }
      if (event.key !== "Escape") return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (window.document.querySelector("[role='dialog'],[role='alertdialog'],.nav-menu-popover,.tree-context-menu,.template-select-popover")) return;
      if (internalLinkPicker) {
        event.preventDefault();
        setInternalLinkPicker(null);
        return;
      }
      const activeSecondary = getActiveWorkspaceView(workspaceGroupsRef.current, WORKSPACE_GROUP_ID.SECONDARY);
      if (activePane === "right" && activeSecondary?.kind === WORKSPACE_VIEW_KIND.RESEARCH) {
        event.preventDefault();
        void handleCloseGroupView(WORKSPACE_GROUP_ID.SECONDARY, activeSecondary.viewId);
        return;
      }
      if (!immersiveMode) return;
      if (aiMode) {
        event.preventDefault();
        void requestExitAiMode();
        return;
      }
      event.preventDefault();
      setImmersive(false);
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [activePane, aiMode, handleCloseGroupView, immersiveMode, internalLinkPicker, requestExitAiMode, setImmersive]);

  const {
    handleClearAiChat,
    handleClearAiOptimize,
    handleCodexImageModeChange,
    handleCopyAiBlock,
    handleExportAiChat,
    handleSendAiChat,
    handleStartAiOptimize,
    handleStopAi,
  } = useAiRequestActions({
    activeTabReadOnly,
    aiChatCodexImageMode,
    aiChatInput,
    aiChatMessages,
    aiChatSelections,
    aiHasUsableProvider,
    aiStatus,
    currentPath,
    editor,
    effectiveAiConfig,
    getActiveDocumentKey,
    getActiveDocumentSnapshot,
    letterTemplates,
    openAiSettings,
    registry: aiStreamRegistry,
    showStatus,
    updateChatState,
    updateChatStateForKey,
    updateOptimizeState,
    updateOptimizeStateForKey,
    writingWorkspaceRoot,
  });

  const handleAiChatPresetSelect = useCallback((preset) => {
    if (preset?.id === "rewrite-selection" && !aiChatSelections.length) {
      showStatus("请先在左侧框选文字，再点浮条里的标记文字", "warning");
      return;
    }
    const prompt = preset?.id === "rewrite-selection" && aiChatSelections.length > 1
      ? "请分别改写我标记的这些文字，保持原意，但让表达更自然、更有力度。"
      : preset?.prompt || "";
    updateChatState({ input: prompt });
  }, [aiChatSelections.length, showStatus, updateChatState]);

  const {
    beginManualAiApply,
    cancelAiApplyPreview,
    cancelManualAiApply,
    confirmAiApplyPreview,
    stageAiApplyPreview,
  } = useAiApplyPreviewActions({
    aiApplyPreview,
    editor,
    getActiveDocumentSnapshot,
    setAiApplyPreview,
    setManualAiApply,
    setManualFallbackAiBlockIndexes,
    showStatus,
  });
  useAiApplyPreviewLifecycle({
    aiApplyPreview,
    cancelAiApplyPreview,
    confirmAiApplyPreview,
    editor,
  });
  const {
    handleApplyAiBlock,
    handleManualAiApplyTarget,
  } = useAiApplyResolutionActions({
    activeTabReadOnly,
    aiApplyInFlightRef,
    aiApplyPreview,
    aiStatus,
    applyingAiBlockIndex,
    beginManualAiApply,
    editor,
    getActiveDocumentSnapshot,
    manualAiApply,
    manualFallbackAiBlockIndexes,
    setApplyingAiBlockIndex,
    setManualAiApply,
    showConfirmDialog,
    showStatus,
    stageAiApplyPreview,
  });
  useAiManualApplyLifecycle({
    editor,
    handleManualAiApplyTarget,
    manualAiApply,
    setManualAiApply,
    showStatus,
  });

  const measuredWorkSurfaceWidth = workSurfaceWidth || Math.max(1, window.innerWidth - (leftSidebarCollapsed ? 0 : 330));
  const secondaryGroupOpen = workspaceGroups.secondary.views.length > 0;
  const secondaryGroupVisible = secondaryGroupOpen && !immersiveMode;
  const minimumGroupRatio = Math.min(0.5, 320 / Math.max(640, measuredWorkSurfaceWidth));
  const secondaryPrimaryRatio = Math.min(1 - minimumGroupRatio, Math.max(minimumGroupRatio, workspaceGroups.splitRatio));
  const secondarySideRatio = 1 - secondaryPrimaryRatio;
  const secondaryGridStyle = !secondaryGroupVisible
    ? undefined
    : { gridTemplateColumns: `minmax(0, ${secondaryPrimaryRatio}fr) minmax(0, ${secondarySideRatio}fr)` };
  const secondaryPaneWidthPx = secondaryGroupVisible ? measuredWorkSurfaceWidth * secondarySideRatio : 0;
  const findTargetsPrimaryPane = activePane !== "right";
  const documentFindStyle = {
    "--document-find-right": `${findTargetsPrimaryPane ? secondaryPaneWidthPx + 18 : 18}px`,
    "--document-find-column-width": `${!secondaryGroupVisible
      ? measuredWorkSurfaceWidth
      : (findTargetsPrimaryPane ? measuredWorkSurfaceWidth - secondaryPaneWidthPx : secondaryPaneWidthPx)}px`,
  };

  const shellClassName = [
    "desktop-shell",
    printMode ? "print-mode" : "",
    imageExportMode ? "image-export-mode" : "",
    (printMode || imageExportMode) && exportRenderPane ? `export-${exportRenderPane}-pane` : "",
    aiMode ? "ai-mode" : "",
    leftSidebarCollapsed ? "left-sidebar-collapsed" : "",
    immersiveMode ? "immersive-mode" : "",
  ].filter(Boolean).join(" ");
  const appShellClassName = [
    "app-shell",
    leftSidebarCollapsed ? "left-collapsed" : "",
    aiPageTransition ? "ai-mode-page-enter" : "",
    aiPageTransition ? `ai-mode-page-${aiPageTransition}` : "",
  ].filter(Boolean).join(" ");
  const activeEditorViewKey = aiMode
    ? `ai-${activeTabId}`
    : (splitPaneActive ? `right-${rightSplitTabId}` : `main-${activeTabId}`);
  const tabTemplateDocument = tabTemplateDialog.targetTabId === activeTabId
    ? documentState
    : (openTabs.find((tab) => tab.id === tabTemplateDialog.targetTabId)?.document || null);
  const researchWebViewSuspended = Boolean(
    webSourceDialog.open
    || webCopyDialog.open
    || confirmDialog
    || promptDialog
    || linkDialog
    || settingsDialog.open
    || tabTemplateDialog.open
    || helpOpen
    || releaseNotesOpen
    || exportDialogOpen
    || internalLinkPicker
    || citationPicker
    || footnoteDialog.open
    || citationSourceDialog.open,
  );

  return (
    <div className={shellClassName}>
      <TitleBar />
      <TopNav
        key={`toolbar-${activeEditorViewKey}`}
        editor={aiMode ? editor : activeWorkEditor}
        savedSelectionRef={aiMode ? editorSelectionRef : activeWorkSelectionRef}
        onNew={handleNew}
        onOpen={handleOpen}
        onImport={handleImportDocument}
        onSave={handleSave}
        onOpenExport={handleOpenExportDialog}
        onInsertImage={handleInsertImage}
        onInsertAudio={() => handleInsertMedia("audio")}
        onInsertVideo={() => handleInsertMedia("video")}
        onOpenLinkDialog={handleOpenLinkDialog}
        onInsertInternalLink={handleOpenInternalLinkPicker}
        onInsertFootnote={handleAddFootnote}
        onOpenCitationPicker={handleOpenCitationPicker}
        onOpenHelp={openHelpCenter}
        onOpenSettings={openSettings}
        settingsTriggerRef={settingsTriggerRef}
        exportTriggerRef={exportTriggerRef}
        onOpenSearch={openSearch}
        workspaceSearchAvailable={Boolean(writingWorkspaceRoot)}
        aiMode={aiMode}
        aiModeKind={aiModeKind}
        aiBusy={aiStatus === "streaming"}
        aiConfigured={aiHasUsableProvider}
        aiModeChooserOpen={aiModeChooserOpen}
        aiModeTriggerRef={aiModeTriggerRef}
        aiReadOnly={activeTabReadOnly}
        editorLocked={activeWorkReadOnly || (aiMode && aiStatus === "streaming") || Boolean(aiApplyPreview)}
        documentReadOnly={!activeWorkEditor || activeWorkReadOnly}
        onToggleAiModeChooser={toggleAiModeChooser}
        immersiveMode={immersiveMode}
        onToggleImmersive={() => setImmersive(!immersiveMode)}
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={() => setLeftSidebarCollapsed((collapsed) => !collapsed)}
      />
      <div className={appShellClassName}>
        {!leftSidebarCollapsed ? (
          <LiveOutlineSidebar
            key={`sidebar-${activeEditorViewKey}`}
            editor={structureWorkEditor}
            currentPath={structureWorkPath}
            folderState={folderState}
            mode={leftSidebarMode}
            expandedFolders={expandedFolders}
            onOpenFolder={handleOpenFolder}
            onOpenFolderPath={handleOpenFolderPath}
            onOpenFolderFile={handleOpenFolderFile}
            onToggleFolder={handleToggleFolder}
            onCreateFolder={handleCreateFolderInTree}
            onCreateDocument={handleCreateDocumentInTree}
            onRenameEntry={handleRenameTreeEntry}
            onBackupDocument={handleBackupTreeDocument}
            onDeleteEntry={handleDeleteTreeEntry}
            onMoveEntry={handleMoveTreeEntry}
            onModeChange={setLeftSidebarMode}
            onOutlineItemClick={handleOutlineItemClick}
            researchPanel={(
              <ResearchSidebar
                rootPath={researchRoot?.rootPath || ""}
                libraryId={researchRoot?.libraryId || ""}
                currentRelativePath={researchCurrentRelativePath}
                entries={researchEntries}
                expandedFolders={researchExpandedFolders}
                selectedKey={activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH
                  ? (activeSecondaryView.relativePath || activeSecondaryView.sourceId || "")
                  : ""}
                webSources={librarySources.filter((source) => source.type === "web")}
                webFolders={webTreeState.folders}
                webPlacements={webTreeState.placements}
                webScopeKey={webScopeKey}
                webWorkspaceName={writingWorkspaceIdentity?.workspaceName || ""}
                webWorkspaceConnected={webWorkspaceConnected}
                webWorkspaceAvailable={Boolean(writingWorkspaceIdentity?.workspaceId)}
                webTreeReadOnly={webTreeState.readOnly}
                loading={researchTreeLoading}
                error={researchTreeError}
                busyKeys={researchBusyKeys}
                onPickRoot={handlePickResearchRoot}
                onNavigatePath={handleNavigateResearchPath}
                onToggleFolder={handleToggleResearchFolder}
                onOpenEntry={openIndependentResearchItem}
                onCreateFolder={handleCreateResearchFolder}
                onImportFiles={handleImportResearchFiles}
                onRenameEntry={handleRenameResearchEntry}
                onMoveEntry={handleMoveResearchEntry}
                onTrashEntry={handleTrashResearchEntry}
                onCopyPath={handleCopyResearchPath}
                onShowInFolder={handleShowResearchEntry}
                onAddWeb={handleAddLibraryWeb}
                onToggleWebWorkspace={handleToggleWebWorkspace}
                onCopyWebFromGlobal={handleOpenWebCopyDialog}
                onCreateWebFolder={handleCreateWebFolder}
                onRenameWebFolder={handleRenameWebFolder}
                onDeleteWebFolder={handleDeleteWebFolder}
                onMoveWebFolder={handleMoveWebFolder}
                onMoveWebSource={handleMoveWebSource}
                onOpenSource={openIndependentResearchItem}
                onEditSource={handleEditLibrarySource}
                onDeleteSource={handleDeleteLibrarySource}
              />
            )}
            renderStructurePanel={(outlineItems) => (
              <StructureInspector
                mode={structureMode}
                onModeChange={setStructureMode}
                outlineItems={outlineItems}
                onOutlineItemClick={handleOutlineItemClick}
                referenceProps={{
                  footnotes: visibleFootnotes,
                  sources: citationSourcesForDock,
                  citationOrder,
                  pendingPage: pendingCitationPage,
                  loading: citationLibraryLoading,
                  readOnly: activeWorkReadOnly,
                  onJumpFootnote: handleJumpFootnote,
                  onEditFootnote: handleEditFootnote,
                  onDeleteFootnote: handleDeleteFootnote,
                  onAddCitationSource: handleAddCitationSource,
                  onEditCitationSource: handleEditCitationSource,
                  onDeleteCitationSource: handleDeleteCitationSource,
                  onJumpCitationSource: handleJumpCitationSource,
                }}
                relatedProps={{
                  links: workspaceRelationships.links || [],
                  backlinks: workspaceRelationships.backlinks || [],
                  duplicates: workspaceRelationships.duplicates || [],
                  contextKey: workspaceRelationshipContextKey,
                  onOpenDocument: handleOpenRelatedDocument,
                   onRelink: handleRelinkInternalLink,
                  onRemove: handleRemoveInternalLink,
                  onJumpUsage: handleJumpInternalLinkUsage,
                  onGiveNewIdentity: handleRegenerateDuplicateIdentity,
                }}
              />
            )}
          />
        ) : null}
        <section className="workspace">
          <div className="work-surface" ref={workSurfaceRef}>
            {aiOptimizeMode || aiChatMode ? (
              <div className="ai-mode-top-strip">
                <DocumentTabs
                  tabs={primaryGroupTabs.map((view) => ({ id: view.tabId, path: view.path, title: view.title, dirty: view.dirty }))}
                  activeTabId={activeTabId}
                  onSelectTab={handleSelectTab}
                  onCloseTab={handleCloseTab}
                  onNew={handleNew}
                  closeDisabled
                  newDisabled
                  showNew={false}
                  compact
                />
                {aiOptimizeMode ? (
                  <AiOptimizeToolbar
                    status={aiStatus}
                    hasResult={Boolean(aiOutput || aiError || aiTokenStats)}
                    editor={editor}
                    savedSelectionRef={editorSelectionRef}
                    availableProviders={availableAiProviders}
                    selectedProvider={effectiveAiProvider}
                    onProviderChange={setAiSelectedProvider}
                    onStart={handleStartAiOptimize}
                    onStop={handleStopAi}
                    onClear={handleClearAiOptimize}
                  />
                ) : null}
                {aiChatMode ? (
                  <AiChatToolbar
                    editor={editor}
                    availableProviders={availableAiProviders}
                    selectedProvider={effectiveAiProvider}
                    status={aiStatus}
                    messages={aiChatMessages}
                    hasState={Boolean(aiChatMessages.length || aiChatInput || aiChatSelections.length || aiError)}
                    codexImageMode={aiChatCodexImageMode}
                    onProviderChange={setAiSelectedProvider}
                    onCodexImageModeChange={handleCodexImageModeChange}
                    onStop={handleStopAi}
                    onClear={handleClearAiChat}
                    onExport={handleExportAiChat}
                  />
                ) : null}
              </div>
            ) : secondaryGroupVisible ? (
              <div className="editor-groups-top-strip" style={secondaryGridStyle}>
                <GroupTabStrip
                  groupId={WORKSPACE_GROUP_ID.PRIMARY}
                  items={primaryGroupTabs}
                  activeViewId={workspaceGroups.primary.activeViewId}
                  focused={activePane === "main"}
                  onActivate={(viewId) => handleSelectGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId)}
                  onClose={(viewId) => handleCloseGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId)}
                  onNewDocument={() => handleNew(WORKSPACE_GROUP_ID.PRIMARY)}
                  onReorder={(viewId, beforeViewId) => handleReorderGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId, beforeViewId)}
                  onMoveDocument={handleMoveGroupDocument}
                  onOpenTemplatePicker={handleOpenGroupTabTemplate}
                  canMoveDocument={() => workspaceGroups.primary.views.length > 1}
                />
                <GroupTabStrip
                  groupId={WORKSPACE_GROUP_ID.SECONDARY}
                  items={secondaryGroupTabs}
                  activeViewId={workspaceGroups.secondary.activeViewId}
                  focused={activePane === "right"}
                  onActivate={(viewId) => handleSelectGroupView(WORKSPACE_GROUP_ID.SECONDARY, viewId)}
                  onClose={(viewId) => handleCloseGroupView(WORKSPACE_GROUP_ID.SECONDARY, viewId)}
                  onNewDocument={() => handleNew(WORKSPACE_GROUP_ID.SECONDARY)}
                  onReorder={(viewId, beforeViewId) => handleReorderGroupView(WORKSPACE_GROUP_ID.SECONDARY, viewId, beforeViewId)}
                  onMoveDocument={handleMoveGroupDocument}
                  onOpenTemplatePicker={handleOpenGroupTabTemplate}
                />
              </div>
            ) : (
              <GroupTabStrip
                groupId={WORKSPACE_GROUP_ID.PRIMARY}
                items={primaryGroupTabs}
                activeViewId={workspaceGroups.primary.activeViewId}
                focused
                onActivate={(viewId) => handleSelectGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId)}
                onClose={(viewId) => handleCloseGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId)}
                onNewDocument={() => handleNew(WORKSPACE_GROUP_ID.PRIMARY)}
                onReorder={(viewId, beforeViewId) => handleReorderGroupView(WORKSPACE_GROUP_ID.PRIMARY, viewId, beforeViewId)}
                onMoveDocument={handleMoveGroupDocument}
                onOpenTemplatePicker={handleOpenGroupTabTemplate}
                canMoveDocument={() => workspaceGroups.primary.views.length > 1}
              />
            )}
            {searchMode === "document" ? (
              <DocumentFindWidget
                query={searchQuery}
                replaceValue={documentReplaceValue}
                replaceVisible={documentReplaceVisible}
                currentIndex={documentSearchState.activeIndex}
                currentCount={documentSearchState.matches?.length || 0}
                readOnly={activeWorkReadOnly}
                style={documentFindStyle}
                onQueryChange={setSearchQuery}
                onReplaceValueChange={setDocumentReplaceValue}
                onReplaceVisibleChange={setDocumentReplaceVisible}
                onPrevious={() => moveDocumentSearch(-1)}
                onNext={() => moveDocumentSearch(1)}
                onReplace={() => replaceDocumentSearchMatches(false)}
                onReplaceAll={() => replaceDocumentSearchMatches(true)}
                onClose={closeSearch}
              />
            ) : null}
            <div className={[
              "paper-workspace",
              aiMode ? "ai-split-workspace" : "",
              !aiMode && secondaryGroupVisible ? "document-split-workspace" : "",
              !aiMode && activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH ? "research-secondary-workspace" : "",
              aiChatMode ? "chat-mode" : "",
            ].filter(Boolean).join(" ")} style={
              !aiMode && secondaryGroupVisible
                ? secondaryGridStyle
                : undefined
            }>
              {manualAiApply ? (
                <div className="ai-manual-apply-banner" role="status">
                  <Focus size={15} />
                  <span>在左侧点选一个可编辑的原文块；按 Esc 取消</span>
                  <button type="button" onClick={cancelManualAiApply}>取消</button>
                </div>
              ) : null}
              {aiApplyPreview ? (
                <div className="ai-apply-preview-banner" role="status">
                  <span><b>红色</b>是待替换原文，<b>蓝色</b>是拟应用内容；请在正文中确认或取消</span>
                  <button type="button" onClick={cancelAiApplyPreview}>取消对比</button>
                </div>
              ) : null}
              <PaperCanvas
                editor={editor}
                document={mainCanvasDocument}
                letterTemplates={letterTemplates}
                printMode={printMode}
                imageExportMode={imageExportMode}
                onTitleChange={handleTitleChange}
                onAuthorChange={handleAuthorChange}
                onDateChange={handleDateChange}
                savedSelectionRef={editorSelectionRef}
                className={[
                  aiMode ? "ai-source-canvas" : "",
                  !aiMode && activePane === "main" ? "active-pane" : "",
                ].filter(Boolean).join(" ")}
                onActivate={() => setActivePane("main")}
                readOnly={activeTabReadOnly || (aiMode && aiStatus === "streaming") || Boolean(aiApplyPreview)}
                aiCaptureEnabled={aiMode && aiChatMode}
                onCaptureAiSelection={handleCaptureAiChatSelection}
                comments={aiMode ? [] : documentState.comments}
                activeCommentId={commentPanel?.pane === "main" ? commentPanel.commentId : ""}
                commentsHidden={aiMode || printMode || imageExportMode}
                onCreateComment={aiMode ? undefined : ((selection, position) => handleStartComment("main", selection, position))}
                onOpenComment={aiMode ? undefined : ((comment, position) => handleOpenComment("main", comment, position))}
                onEditLink={aiMode ? undefined : handleEditLinkFromCanvas}
                canvasRef={mainCanvasRef}
              />
              {!aiMode && secondaryGroupVisible ? (
                <div className={activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH ? "right-split-pane research-view-active" : "right-split-pane"}>
                  <div
                    className="secondary-pane-resizer workspace-group-resizer"
                    role="separator"
                    aria-label="调整左右编辑组宽度"
                    aria-orientation="vertical"
                    aria-valuemin={25}
                    aria-valuemax={75}
                    aria-valuenow={Math.round(secondaryPrimaryRatio * 100)}
                    tabIndex={0}
                    onPointerDown={startDocumentSplitResize}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                        event.preventDefault();
                        updateDocumentSplitRatio(workspaceGroups.splitRatio + (event.key === "ArrowRight" ? 0.02 : -0.02));
                      }
                    }}
                  />
                  {activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.DOCUMENT && rightSplitDocument ? (
                    <PaperCanvas
                      editor={rightSplitEditor}
                      document={rightCanvasDocument}
                      letterTemplates={letterTemplates}
                      printMode={printMode}
                      imageExportMode={imageExportMode}
                      onTitleChange={handleRightSplitTitleChange}
                      onAuthorChange={handleRightSplitAuthorChange}
                      onDateChange={handleRightSplitDateChange}
                      savedSelectionRef={rightSplitSelectionRef}
                      className={activePane === "right" ? "right-split-canvas active-pane" : "right-split-canvas"}
                      onActivate={() => setActivePane("right")}
                      readOnly={rightSplitReadOnly}
                      comments={rightSplitDocument.comments}
                      activeCommentId={commentPanel?.pane === "right" ? commentPanel.commentId : ""}
                      commentsHidden={aiMode || printMode || imageExportMode}
                      onCreateComment={(selection, position) => handleStartComment("right", selection, position)}
                      onOpenComment={(comment, position) => handleOpenComment("right", comment, position)}
                      onEditLink={handleEditLinkFromCanvas}
                      canvasRef={rightCanvasRef}
                    />
                  ) : activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.RESEARCH ? (
                    <div className="secondary-research-slot" onPointerDown={() => setActivePane("right")}>
                  <SecondaryResearchPane
                    item={activeLibraryItem}
                    loading={activeResearchLoading}
                    error={activeResearchError}
                    pdfLoader={handleLoadIndependentResearchPdf}
                    previewLoader={handleLoadIndependentResearchPreview}
                    onOpenExternal={handleOpenIndependentResearchExternal}
                    onShowInFolder={handleShowResearchEntry}
                    onEditSource={handleEditLibrarySource}
                    viewId={activeSecondaryView.viewId}
                    onActivate={() => setActivePane("right")}
                    webViewSuspended={researchWebViewSuspended}
                    viewState={activeSecondaryView.viewState}
                    onViewStateChange={(viewState) => handleResearchViewStateChange(activeSecondaryView.viewId, viewState)}
                  />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {aiOptimizeMode ? (
                <AiResultPane
                  document={documentState}
                  letterTemplates={letterTemplates}
                  output={aiOutput}
                  status={aiStatus}
                  error={aiError}
                  assets={aiAssets}
                  elapsedSeconds={aiElapsedSeconds}
                  tokenStats={aiTokenStats}
                  onCopyBlock={handleCopyAiBlock}
                  onApplyBlock={handleApplyAiBlock}
                  applyingBlockIndex={applyingAiBlockIndex}
                  previewingBlockIndex={aiApplyPreview?.blockIndex ?? -1}
                  manualFallbackBlockIndexes={manualFallbackAiBlockIndexes}
                  resolverLabel={aiApplyResolverLabel}
                />
              ) : null}
              {aiChatMode ? (
                <AiChatPane
                  availableProviders={availableAiProviders}
                  document={documentState}
                  letterTemplates={letterTemplates}
                  messages={aiChatMessages}
                  input={aiChatInput}
                  selectedTexts={aiChatSelections}
                  status={aiStatus}
                  error={aiError}
                  onInputChange={(input) => updateChatState({ input })}
                  onSend={handleSendAiChat}
                  onRemoveSelectedText={handleRemoveAiChatSelection}
                  onJumpSelectedText={handleJumpAiChatSelection}
                  onPresetSelect={handleAiChatPresetSelect}
                />
              ) : null}
            </div>
          </div>
        </section>
      </div>
      {searchMode === "workspace" ? (
        <WorkspaceSearchPalette
          query={workspaceSearchQuery}
          loading={workspaceSearchState.loading}
          results={workspaceSearchState.results}
          error={workspaceSearchState.error}
          folderName={displayNameFromPath(writingWorkspaceRoot) || "当前文件夹"}
          onQueryChange={setWorkspaceSearchQuery}
          onOpenResult={handleOpenWorkspaceSearchResult}
          onClose={closeSearch}
        />
      ) : null}
      <StatusBar
        key={`status-${activeEditorViewKey}`}
        editor={activeWorkEditor}
        updatedAt={(activeWorkDocument || documentState).updatedAt}
        dirty={Boolean(activeWorkTab?.dirty)}
        version={appVersion}
        cacheSummary={documentCacheSummary}
        updateState={updateState}
        onRunUpdate={handleRunUpdate}
        onClearCache={handleClearDocumentCache}
        onOpenReleaseNotes={openReleaseNotes}
        persistenceState={activeWorkPersistenceState}
        externalVersion={Boolean(activeWorkTab?.externalChanged)}
        readOnly={activeWorkReadOnly}
      />
      {commentPanel ? (
        <CommentPanel
          panel={commentPanel}
          comment={commentPanelComment}
          onTextChange={(text) => setCommentPanel((panel) => panel ? { ...panel, text } : panel)}
          onPositionChange={(position) => setCommentPanel((panel) => panel ? { ...panel, x: position.x, y: position.y } : panel)}
          onSave={handleSaveCommentPanel}
          onEdit={handleEditCommentPanel}
          onDelete={handleDeleteCommentPanel}
          onClose={() => setCommentPanel(null)}
        />
      ) : null}
      <StatusToast status={status} onClose={dismissStatus} />
      <WebSourceDialog
        dialog={webSourceDialog}
        onClose={() => setWebSourceDialog({ open: false, source: null, folderId: "", scopeKey: "global" })}
        onSubmit={handleSaveLibraryWeb}
      />
      <WebCopyDialog
        dialog={webCopyDialog}
        sources={librarySources.filter((source) => source.type === "web")}
        folders={webTreeState.folders}
        placements={webTreeState.placements}
        onClose={handleCloseWebCopyDialog}
        onSubmit={handleCopyWebSelection}
      />
      <AppConfirmDialog dialog={confirmDialog} onResolve={resolveConfirmDialog} />
      <AppPromptDialog dialog={promptDialog} onResolve={resolvePromptDialog} />
      <FootnoteDialog
        dialog={footnoteDialog}
        onClose={() => setFootnoteDialog({ open: false, footnote: null, insertTarget: null })}
        onSubmit={handleSaveFootnoteDialog}
      />
      <CitationSourceDialog
        dialog={citationSourceDialog}
        onClose={handleCloseCitationSourceDialog}
        onSubmit={handleSaveCitationSourceDialog}
      />
      <LinkDialog
        dialog={linkDialog}
        onClose={handleCloseLinkDialog}
        onSubmit={handleSubmitLink}
        onRemove={handleRemoveLink}
      />
      <InternalLinkPicker
        picker={internalLinkPicker}
        documents={workspaceRelationships.documents || []}
        onSelect={handleChooseInternalLink}
        onClose={closeInternalLinkPicker}
      />
      <CitationPickerDialog
        picker={citationPicker}
        sources={citationPickerSources}
        loading={citationLibraryLoading}
        defaultPageForSource={defaultPdfPageForCitationSource}
        initialPage={citationPicker?.initialPage || ""}
        onSelect={handleChooseCitationSource}
        onAddAndSelect={handleAddAndInsertCitationSource}
        onClose={() => setCitationPicker(null)}
      />
      <KnowledgeReferencePopover popover={knowledgeReferencePopover} onClose={closeKnowledgeReferencePopover} />
      <AiModeChooser
        open={aiModeChooserOpen}
        anchorRef={aiModeTriggerRef}
        activeMode={aiModeKind}
        configured={aiHasUsableProvider}
        onSelectMode={requestAiModeChange}
        onExitMode={requestExitAiMode}
        onOpenSettings={openAiSettings}
        onClose={() => setAiModeChooserOpen(false)}
      />
      <SettingsCenter
        open={settingsDialog.open}
        anchorRef={settingsTriggerRef}
        onSelectSection={openSettingsSection}
        onClose={closeSettings}
      />
      <AiSettingsDialog
        open={settingsDialog.section === "ai"}
        returnFocusRef={settingsTriggerRef}
        config={aiConfig}
        onClose={closeSettings}
        onSave={handleSaveAiConfig}
        onCreateProvider={handleCreateAiProvider}
        onDeleteProvider={handleDeleteAiProvider}
        onTest={handleTestAiConfig}
        onClear={handleClearAiConfig}
        onRefreshCodex={handleRefreshCodexCli}
        onLoginCodex={handleLoginCodexCli}
      />
      {tabTemplateDialog.open && tabTemplateDocument ? (
        <LetterTemplateDialog
          key={`tab-template-${tabTemplateDialog.targetTabId}`}
          mode="select"
          returnFocusRef={tabTemplateReturnFocusRef}
          document={tabTemplateDocument}
          letterTemplates={letterTemplates}
          defaultTemplates={DEFAULT_LETTER_TEMPLATES}
          userTemplates={userLetterTemplates}
          userTemplateGroups={userTemplateGroups}
          newDocumentTemplateId={newDocumentTemplateId}
          onClose={closeTabTemplateDialog}
          onLetterTemplateChange={handleTabTemplateChange}
          onNewDocumentTemplateChange={handleNewDocumentTemplateChange}
          onCreateUserTemplate={handleCreateUserTemplate}
          onUpdateUserTemplate={handleUpdateUserTemplate}
          onDeleteUserTemplate={handleDeleteUserTemplate}
          onCreateUserTemplateGroup={handleCreateUserTemplateGroup}
          onRenameUserTemplateGroup={handleRenameUserTemplateGroup}
          onDeleteUserTemplateGroup={handleDeleteUserTemplateGroup}
          onReorderUserTemplateGroups={handleReorderUserTemplateGroups}
          onMoveUserTemplate={handleMoveUserTemplate}
        />
      ) : null}
      {settingsDialog.section === "template" ? (
          <LetterTemplateDialog
            mode="manage"
            returnFocusRef={settingsTriggerRef}
            document={{ letterTemplateId: newDocumentTemplateId }}
            letterTemplates={letterTemplates}
            defaultTemplates={DEFAULT_LETTER_TEMPLATES}
            userTemplates={userLetterTemplates}
            userTemplateGroups={userTemplateGroups}
            newDocumentTemplateId={newDocumentTemplateId}
            onClose={closeSettings}
            onNewDocumentTemplateChange={handleNewDocumentTemplateChange}
            onCreateUserTemplate={handleCreateUserTemplate}
            onUpdateUserTemplate={handleUpdateUserTemplate}
            onDeleteUserTemplate={handleDeleteUserTemplate}
            onCreateUserTemplateGroup={handleCreateUserTemplateGroup}
            onRenameUserTemplateGroup={handleRenameUserTemplateGroup}
            onDeleteUserTemplateGroup={handleDeleteUserTemplateGroup}
            onReorderUserTemplateGroups={handleReorderUserTemplateGroups}
            onMoveUserTemplate={handleMoveUserTemplate}
          />
      ) : null}
      <HelpCenterDialog
        open={helpOpen}
        onClose={closeHelpCenter}
      />
      <ReleaseNotesDialog
        open={releaseNotesOpen}
        currentVersion={appVersion}
        onClose={closeReleaseNotes}
      />
      <ExportDialog
        open={exportDialogOpen}
        documentTitle={exportTarget?.title || "未命名信笺"}
        returnFocusRef={exportTriggerRef}
        onClose={handleCloseExportDialog}
        onExportPdf={handleExportPdf}
        onExportImages={handleExportImages}
        onExportEditable={handleExportEditable}
      />
    </div>
  );
}
