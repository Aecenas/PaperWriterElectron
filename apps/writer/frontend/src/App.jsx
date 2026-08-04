import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@tiptap/react";
import {
  FilePlus,
  FileText,
  FolderPlus,
  Focus,
  MessageSquare,
  PackageOpen,
  Pencil,
  RefreshCw,
  Save,
  SpellCheck2,
  Trash2,
  X,
} from "lucide-react";
import { bridge } from "./bridge.js";
import AiModeChooser from "./AiModeChooser.jsx";
import { DocumentFindWidget, ResearchSearchPalette, WorkspaceSearchPalette } from "./WorkspaceSearchPanel.jsx";
import "./workspace-features.css";
import ReleaseNotesDialog from "./ReleaseNotesDialog.jsx";
import { ExportDialog } from "./export/index.js";
import { AiSettingsDialog } from "./ai-settings/index.js";
import { AiCompositionWorkspace } from "./ai-composition/index.js";
import {
  DocumentHistoryDialog,
  prepareDocumentHistoryOperation,
} from "./history/index.js";
import { ProfileMigrationPanel } from "./settings/ProfileMigrationPanel.jsx";
import DocumentContextMenu, { positionDocumentContextMenu } from "./DocumentContextMenu.jsx";
import {
  PAPER_BOOKMARK_ACTIVATE_EVENT,
  PAPER_MATH_EDIT_REQUEST_EVENT,
  PAPER_MERMAID_EDIT_REQUEST_EVENT,
  MathInsertDialog,
  MermaidInsertDialog,
  applyMermaidDraft,
  insertBookmark,
  insertCodeBlock,
  insertMathDraft,
  removeBookmark,
  updateBookmark,
  updateMathDraftAt,
  updateMermaidDraftAt,
} from "./professional-content/index.js";
import {
  EmojiPicker,
  captureEmojiInsertionContext,
  insertEmojiFromContext,
} from "./emoji/index.js";
import {
  DEFAULT_WRITING_ASSISTANCE_CONFIG,
  WritingAssistanceSettings,
  createWritingAssistanceSession,
  normalizeWritingAssistanceConfig,
  serializeWritingAssistanceConfig,
} from "./writing-assistance/index.js";
import {
  AiChatPane,
  AiChatToolbar,
  AiOptimizeToolbar,
  AiResultPane,
  buildAiApplyBlockManifest,
  collaborationBlocksToReviewText,
  collaborationBlocksToSafeHtml,
  createCollaborationEditorOperation,
  createEmptyAiState,
  normalizeAiState,
  parseCollaborationReviewText,
} from "./ai/index.js";
import { HelpAssistantDialog } from "./help-assistant/index.js";
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
  createWorkspaceFileController,
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
  useAiCollaborationActions,
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
  usePublicCitationLibrary,
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
  useResearchSearch,
  useSelectionAiController,
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
  syncAiCollaborationReviewDecorations,
  syncDocumentCommentDecorations,
} from "./editor/index.js";
import {
  DEFAULT_LETTER_TEMPLATES,
  LetterTemplateDialog,
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
import {
  SelectionAiPopover,
  SelectionAiSprite,
} from "./selection-ai/index.js";
import StructureInspector from "./StructureInspector.jsx";
import GroupTabStrip from "./GroupTabStrip.jsx";
import CitationPickerDialog from "./CitationPickerDialog.jsx";
import { CitationSourceDialog, FootnoteDialog, KnowledgeReferencePopover } from "./KnowledgeDialogs.jsx";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  getActiveWorkspaceView,
  normalizeWorkspaceSplitRatio,
} from "./workspace-groups.js";
import {
  readEditorSelectionState,
  replaceEditorContentWithoutHistory,
  restoreEditorSelectionWithoutHistory,
  sameDocumentPath,
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
  useModalFocusTrap,
} from "./ui-interactions.js";
import { readCanvasScrollState, restoreCanvasScrollState } from "./document-workspace/canvas-state.js";
import {
  captureDocumentWorkspaceSnapshot,
  createPaneEditorHydrator,
  serializePaneDocument,
} from "./document-workspace/editor-runtime.js";
import {
  PAGE_VIEW_MODES,
  PAGE_ZOOM_MODES,
  createPageViewSessionStore,
} from "./pagination/index.js";
import {
  createPortableProfilePreferences,
  normalizeProfilePreferencesPatch,
} from "./settings/profile-preferences.js";
import { useDocumentRuntimeKernel } from "./document-workspace/document-runtime-kernel.js";
import {
  createDocumentPersistenceController,
  createDocumentPersistenceRuntimeState,
} from "./document-workspace/document-persistence-controller.js";
import { useDocumentWorkspaceState } from "./document-workspace/workspace-state.js";
import {
  createWorkspaceGroupsController,
  deriveWorkspaceGroupItems,
} from "./document-workspace/workspace-groups-controller.js";
import {
  createDocumentSessionController,
  describeDocumentSessionPersistence,
} from "./document-workspace/document-session-controller.js";
import { listFolderWithTimeout } from "./document-workspace/folder-listing.js";
import {
  createBlankDocument,
  createDocumentTab,
  documentRuntimeKey,
  estimateSerializedBytes,
  inferTitle,
  normalizeDocument,
  paperCanvasViewModel,
  summarizeDocumentCache,
  summarizeSessionTabs,
  workspaceDocumentView,
} from "./document-workspace/model.js";


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
  const [pendingResearchDocumentSearch, setPendingResearchDocumentSearch] = useState(null);
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
  const researchSearchWorkspaceScopeKey = writingWorkspaceIdentity?.workspaceId
    ? `workspace:${writingWorkspaceIdentity.workspaceId}`
    : "";
  const researchSearch = useResearchSearch({
    active: searchMode === "research",
    libraryId: researchRoot?.available ? researchRoot.libraryId : "",
    workspaceScopeKey: researchSearchWorkspaceScopeKey,
  });
  const knowledgeState = useKnowledgeReferenceState();
  const {
    citationLibraryLoading,
    citationPicker,
    citationSourceDialog,
    footnoteDialog,
    internalLinkPicker,
    knowledgeReferencePopover,
    pendingCitationPage,
    publicCitationLibraryLoading,
    publicCitationSources,
    setCitationLibraryLoading,
    setCitationPicker,
    setCitationSourceDialog,
    setFootnoteDialog,
    setInternalLinkPicker,
    setKnowledgeReferencePopover,
    setPendingCitationPage,
    setPublicCitationLibraryLoading,
    setPublicCitationSources,
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
  const [settingsDialog, setSettingsDialog] = useState({
    section: "",
    targetTabId: "",
    aiInitialPanel: "provider",
    aiInitialTaskId: "",
  });
  const [compositionWorkspaceOpen, setCompositionWorkspaceOpen] = useState(false);
  const [historyDialog, setHistoryDialog] = useState({ open: false, tabId: "" });
  const [documentContextMenu, setDocumentContextMenu] = useState(null);
  const [emojiPicker, setEmojiPicker] = useState({ open: false, context: null });
  const [professionalUi, setProfessionalUi] = useState({
    kind: "",
    editor: null,
    tabId: "",
    documentId: "",
    revision: "",
    selection: null,
    initialValue: null,
    updatePosition: null,
  });
  const [writingAssistanceConfig, setWritingAssistanceConfig] = useState(
    DEFAULT_WRITING_ASSISTANCE_CONFIG,
  );
  const [writingAssistanceDraft, setWritingAssistanceDraft] = useState(
    DEFAULT_WRITING_ASSISTANCE_CONFIG,
  );
  const [writingIssuesByEditor, setWritingIssuesByEditor] = useState({
    main: [],
    right: [],
  });
  const [tabTemplateDialog, setTabTemplateDialog] = useTemplateTabDialogState();
  const {
    helpOpen,
    setHelpOpen,
    releaseNotesOpen,
    setReleaseNotesOpen,
  } = useHelpReleaseState();
  const [helpAssistantOpen, setHelpAssistantOpen] = useState(false);
  const [helpTargetTopicId, setHelpTargetTopicId] = useState("");
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
  const documentSessionControllerRef = useRef(null);
  const documentPersistenceControllerRef = useRef(null);
  const documentPersistenceRuntimeStateRef = useRef(null);
  if (!documentPersistenceRuntimeStateRef.current) {
    documentPersistenceRuntimeStateRef.current = (
      createDocumentPersistenceRuntimeState()
    );
  }
  const persistenceViewStateRef = useRef({ aiMode: false });
  const mainCanvasRef = useRef(null);
  const rightCanvasRef = useRef(null);
  const workSurfaceRef = useRef(null);
  const [pageViewSessionStore] = useState(() => createPageViewSessionStore());
  const [pageViewStatesByTab, setPageViewStatesByTab] = useState({});
  const [writingAssistanceSessions] = useState(() => ({
    main: createWritingAssistanceSession({
      editorId: "main",
      onIssuesChange: (issues) => setWritingIssuesByEditor((current) => ({
        ...current,
        main: issues,
      })),
    }),
    right: createWritingAssistanceSession({
      editorId: "right",
      onIssuesChange: (issues) => setWritingIssuesByEditor((current) => ({
        ...current,
        right: issues,
      })),
    }),
  }));
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
  const folderStateRef = useRef(folderState);
  const folderPathRef = useRef(folderState.path);
  const expandedFoldersRef = useRef(expandedFolders);
  const folderRequestControllerRef = useRef(createLatestRequestController());
  const folderBranchRequestControllerRef = useRef(createLatestRequestController());
  const diskRevisionRequestControllerRef = useRef(createLatestRequestController());
  const workspaceFileControllerRef = useRef(null);
  const workspaceFileLifecyclePort = useMemo(() => Object.freeze({
    cancelWorkspaceSearch: (...args) => (
      workspaceFileControllerRef.current.lifecyclePort
        .cancelWorkspaceSearch(...args)
    ),
    handleWorkspaceChanged: (...args) => (
      workspaceFileControllerRef.current.lifecyclePort
        .handleWorkspaceChanged(...args)
    ),
    restoreSessionFolder: (...args) => (
      workspaceFileControllerRef.current.lifecyclePort
        .restoreSessionFolder(...args)
    ),
    searchWorkspace: (...args) => (
      workspaceFileControllerRef.current.lifecyclePort.searchWorkspace(...args)
    ),
    verifyOpenDocuments: (...args) => (
      workspaceFileControllerRef.current.lifecyclePort
        .verifyOpenDocuments(...args)
    ),
    watchWorkspace: (...args) => (
      workspaceFileControllerRef.current.lifecyclePort.watchWorkspace(...args)
    ),
  }), []);
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
  const helpTriggerRef = useRef(null);
  const writingSettingsTriggerRef = useRef(null);
  const elementsTriggerRef = useRef(null);
  const exportTriggerRef = useRef(null);
  const profileDialogRef = useRef(null);
  const profileDialogCloseRef = useRef(null);
  const writingSettingsDialogRef = useRef(null);
  const writingSettingsInitialFocusRef = useRef(null);
  const writingSettingsCloseRef = useRef(null);
  const tabTemplateReturnFocusRef = useTemplateTabDialogReturnFocusRef();
  const historyReturnFocusRef = useRef(null);
  useModalFocusTrap(
    settingsDialog.section === "profile",
    profileDialogRef,
    profileDialogCloseRef,
    exportTriggerRef,
  );
  useModalFocusTrap(
    settingsDialog.section === "writing",
    writingSettingsDialogRef,
    writingSettingsInitialFocusRef,
    writingSettingsTriggerRef,
  );
  const aiStreamRegistry = useAiStreamRegistry();
  const aiPreviousSidebarsRef = useRef(null);
  const {
    confirmDialogResolverRef,
    promptDialogResolverRef,
  } = usePromiseDialogResolverRefs();
  const syncAiStreamChatMessages = useAiStreamChatMessagesSlot(aiStreamRegistry);
  const workspaceSearchRequestRef = useRef("");
  persistenceViewStateRef.current = { aiMode };
  folderStateRef.current = folderState;
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
    pageViewSessionStore.delete(tabId);
    setPageViewStatesByTab((states) => {
      if (!Object.hasOwn(states, tabId)) return states;
      const { [tabId]: _removed, ...remaining } = states;
      return remaining;
    });
  }, [pageViewSessionStore]);

  const mainEditorExtensions = useMemo(() => createPaperEditorExtensions(), []);
  const rightEditorExtensions = useMemo(() => createPaperEditorExtensions(), []);
  const mainEditorOptions = useMemo(() => ({
    shouldRerenderOnTransaction: false,
    extensions: mainEditorExtensions,
    content: documentStateRef.current.html,
    editorProps: {
      attributes: {
        class: "paper-editor",
        spellcheck: "true",
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
        spellcheck: "true",
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

  useEffect(() => {
    writingAssistanceSessions.main.attach(editor);
    writingAssistanceSessions.right.attach(rightSplitEditor);
    return () => {
      writingAssistanceSessions.main.detach();
      writingAssistanceSessions.right.detach();
    };
  }, [editor, rightSplitEditor, writingAssistanceSessions]);

  useEffect(() => {
    writingAssistanceSessions.main.setConfig(writingAssistanceConfig);
    writingAssistanceSessions.right.setConfig(writingAssistanceConfig);
  }, [writingAssistanceConfig, writingAssistanceSessions]);

  useEffect(() => {
    writingAssistanceSessions.main.resetDocument();
  }, [activeTabId, writingAssistanceSessions]);

  useEffect(() => {
    writingAssistanceSessions.right.resetDocument();
  }, [rightSplitTabId, writingAssistanceSessions]);

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
    publicCitationSources,
    rightSplitTabId,
    splitPaneActive,
    workspaceCitationSources,
    writingWorkspaceRoot,
  });
  const compositionSourceCandidates = useMemo(() => {
    if (!compositionWorkspaceOpen) return [];
    const candidates = [];
    const seen = new Set();
    const append = (candidate) => {
      const sourceId = String(candidate?.sourceId || candidate?.id || "").slice(0, 128);
      if (!sourceId || seen.has(sourceId)) return;
      seen.add(sourceId);
      candidates.push({ ...candidate, sourceId });
    };
    if (activeWorkDocument?.documentId && activeWorkEditor) {
      append({
        sourceId: `document-${activeWorkDocument.documentId}`,
        title: `当前信笺：${activeWorkDocument.title || "未命名信笺"}`,
        content: activeWorkEditor.getText?.({ blockSeparator: "\n" }) || "",
        revision: documentRevisionPort.readLiveRevision(activeWorkTabId),
      });
    }
    for (const source of librarySources) {
      const sourceId = String(source?.id || "");
      if (!sourceId) continue;
      append({
        sourceId: `research-${sourceId}`,
        title: source.title || source.name || source.fileName || "未命名资料",
        content: source.content
          || source.text
          || source.description
          || source.notes
          || source.url
          || "",
        revision: source.revision || source.updatedAt || "",
      });
    }
    for (const source of citationSourcesForDock) {
      const sourceId = String(source?.id || "");
      if (!sourceId) continue;
      append({
        sourceId: `citation-${sourceId}`,
        title: source.title || source.citationKey || "未命名文献",
        content: [
          source.title,
          Array.isArray(source.authors) ? source.authors.join("、") : source.authors,
          source.year,
          source.doi ? `DOI: ${source.doi}` : "",
          source.isbn ? `ISBN: ${source.isbn}` : "",
          source.notes,
        ].filter(Boolean).join("\n"),
        citationSource: source,
        revision: source.updatedAt || "",
      });
    }
    return candidates;
  }, [
    activeWorkDocument,
    activeWorkEditor,
    activeWorkTabId,
    citationSourcesForDock,
    compositionWorkspaceOpen,
    documentRevisionPort,
    librarySources,
  ]);
  const compositionSourceDocument = useMemo(() => ({
    ...activeWorkDocument,
    path: activeWorkPath,
    diskRevision: documentRevisionPort.readDiskRevision(activeWorkTabId),
  }), [
    activeWorkDocument,
    activeWorkPath,
    activeWorkTabId,
    documentRevisionPort,
  ]);
  const primaryGroupTabs = useMemo(() => deriveWorkspaceGroupItems({
    activeDocument: documentState,
    activeTabId,
    groupId: WORKSPACE_GROUP_ID.PRIMARY,
    letterTemplates,
    openTabs,
    views: workspaceGroups.primary.views,
  }), [activeTabId, documentState.letterTemplateId, documentState.templateId, letterTemplates, openTabs, workspaceGroups.primary.views]);
  const secondaryGroupTabs = useMemo(() => deriveWorkspaceGroupItems({
    activeResearchItem: activeLibraryItem,
    activeSecondaryView,
    groupId: WORKSPACE_GROUP_ID.SECONDARY,
    letterTemplates,
    librarySources,
    openTabs,
    researchItemsByViewId,
    views: workspaceGroups.secondary.views,
  }), [activeLibraryItem, activeSecondaryView?.viewId, letterTemplates, librarySources, openTabs, researchItemsByViewId, workspaceGroups.secondary.views]);
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
  const pendingCollaborationOwner = useMemo(() => {
    if (activeChatState.pendingReview) {
      return { tabId: activeTabId, pendingReview: activeChatState.pendingReview };
    }
    for (const tab of openTabs) {
      if (tab.id === activeTabId) continue;
      const pendingReview = normalizeAiState(tab.document?.aiState).chat.pendingReview;
      if (pendingReview) return { tabId: tab.id, pendingReview };
    }
    return null;
  }, [activeChatState.pendingReview, activeTabId, openTabs]);
  const collaborationLockedPaths = useMemo(() => {
    const owner = pendingCollaborationOwner;
    if (!owner) return [];
    const root = String(owner.pendingReview.workspaceRoot || "").replace(/[\\/]+$/, "");
    if (!root) return [];
    return (owner.pendingReview.proposal.sources || [])
      .map((source) => String(source.relativePath || "").replace(/^[/\\]+/, ""))
      .filter(Boolean)
      .map((relativePath) => `${root}\\${relativePath.replace(/\//g, "\\")}`);
  }, [pendingCollaborationOwner]);
  const collaborationLockedTabIds = useMemo(() => {
    const owner = pendingCollaborationOwner;
    if (!owner) return new Set();
    const result = new Set([owner.pendingReview.originTabId || owner.tabId]);
    openTabs.forEach((tab) => {
      if (tab.path && collaborationLockedPaths.some((sourcePath) => sameDocumentPath(tab.path, sourcePath))) result.add(tab.id);
    });
    return result;
  }, [collaborationLockedPaths, openTabs, pendingCollaborationOwner]);
  const isCollaborationPathLocked = useCallback((filePath) => (
    Boolean(filePath) && collaborationLockedPaths.some((sourcePath) => sameDocumentPath(filePath, sourcePath))
  ), [collaborationLockedPaths]);
  const activeTabCollaborationLocked = collaborationLockedTabIds.has(activeTabId);
  const rightSplitCollaborationLocked = collaborationLockedTabIds.has(rightSplitTabId);
  const activeCollaborationReview = pendingCollaborationOwner?.tabId === activeTabId
    ? pendingCollaborationOwner.pendingReview
    : null;
  const activeWorkReadOnly = splitPaneActive
    ? (rightSplitReadOnly || rightSplitCollaborationLocked)
    : (activeTabReadOnly || activeTabCollaborationLocked);
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
  const mainPageViewState = pageViewStatesByTab[activeTabId]
    || pageViewSessionStore.get(activeTabId);
  const rightPageViewState = pageViewStatesByTab[rightSplitTabId]
    || pageViewSessionStore.get(rightSplitTabId);
  const updatePageViewStateForTab = useCallback((tabId, nextState) => {
    if (!tabId) return;
    const normalized = pageViewSessionStore.set(tabId, nextState);
    setPageViewStatesByTab((states) => {
      const current = states[tabId];
      if (
        current
        && current.mode === normalized.mode
        && current.currentPage === normalized.currentPage
        && current.zoomMode === normalized.zoomMode
        && current.zoom === normalized.zoom
      ) {
        return states;
      }
      return { ...states, [tabId]: normalized };
    });
  }, [pageViewSessionStore]);
  const getPageViewStateForTab = useCallback((tabId) => (
    pageViewStatesByTab[tabId] || pageViewSessionStore.get(tabId)
  ), [pageViewSessionStore, pageViewStatesByTab]);
  const handleMainPageViewStateChange = useCallback((nextState) => {
    updatePageViewStateForTab(activeTabIdRef.current, nextState);
  }, [updatePageViewStateForTab]);
  const handleRightPageViewStateChange = useCallback((nextState) => {
    updatePageViewStateForTab(rightSplitTabIdRef.current, nextState);
  }, [updatePageViewStateForTab]);
  const prepareSecondaryPanePageView = useCallback(() => {
    const tabId = activeTabIdRef.current;
    const current = getPageViewStateForTab(tabId);
    if (!tabId || current.mode !== PAGE_VIEW_MODES.SPREAD) return;
    updatePageViewStateForTab(tabId, {
      ...current,
      mode: PAGE_VIEW_MODES.SINGLE,
      zoomMode: PAGE_ZOOM_MODES.FIT,
    });
  }, [getPageViewStateForTab, updatePageViewStateForTab]);
  useEffect(() => {
    if (!aiMode || !activeTabId) return;
    const current = getPageViewStateForTab(activeTabId);
    if (current.mode !== PAGE_VIEW_MODES.CONTINUOUS) {
      updatePageViewStateForTab(activeTabId, {
        ...current,
        mode: PAGE_VIEW_MODES.CONTINUOUS,
        zoomMode: PAGE_ZOOM_MODES.FIT,
      });
    }
    setDocumentContextMenu(null);
  }, [
    activeTabId,
    aiMode,
    getPageViewStateForTab,
    updatePageViewStateForTab,
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

  const openSettingsSection = useCallback((section) => {
    setAiModeChooserOpen(false);
    if (section === "writing") {
      setWritingAssistanceDraft(writingAssistanceConfig);
    }
    setSettingsDialog((current) => ({
      ...current,
      section: ["ai", "template", "writing", "profile"].includes(section)
        ? section
        : "ai",
      targetTabId: current.targetTabId
        || (splitPaneActive && rightSplitTabId ? rightSplitTabId : activeTabIdRef.current),
      aiInitialPanel: "provider",
      aiInitialTaskId: "",
    }));
  }, [rightSplitTabId, splitPaneActive, writingAssistanceConfig]);
  const openAiSettings = useCallback((request = {}) => {
    setAiModeChooserOpen(false);
    setSettingsDialog({
      section: "ai",
      targetTabId: splitPaneActive && rightSplitTabId ? rightSplitTabId : activeTabIdRef.current,
      aiInitialPanel: request?.panel === "tasks" ? "tasks" : "provider",
      aiInitialTaskId: request?.panel === "tasks" && typeof request?.taskId === "string"
        ? request.taskId
        : "",
    });
  }, [rightSplitTabId, splitPaneActive]);
  const closeSettings = useCallback(() => {
    setSettingsDialog((current) => ({ ...current, section: "" }));
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
    const pending = pendingCollaborationOwner?.pendingReview;
    const proposal = pending?.proposal;
    if (!pending || !proposal || proposal.status === "stale") return;
    const sourceExternallyChanged = openTabs.some((tab) => (
      collaborationLockedTabIds.has(tab.id) && tab.externalChanged
    ));
    const currentFingerprintChanged = Boolean(
      activeCollaborationReview
      && documentState.documentId === proposal.base.documentId
      && editor?.state?.doc
      && proposal.base.documentFingerprint
      && buildAiApplyBlockManifest(editor.state.doc).documentFingerprint !== proposal.base.documentFingerprint
    );
    if (!sourceExternallyChanged && !currentFingerprintChanged) return;
    updateChatStateForKey(pending.originDocumentKey, (chat) => {
      if (chat.pendingReview?.proposal?.id !== proposal.id) return chat;
      return {
        ...chat,
        pendingReview: {
          ...chat.pendingReview,
          proposal: { ...chat.pendingReview.proposal, status: "stale" },
        },
        error: "涉及信笺版本已变化，这份协作方案已过期",
      };
    });
  }, [
    activeCollaborationReview,
    collaborationLockedTabIds,
    documentState.documentId,
    editor,
    openTabs,
    pendingCollaborationOwner,
    updateChatStateForKey,
  ]);

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
    let active = true;
    const request = bridge.getWritingAssistance
      ? bridge.getWritingAssistance()
      : Promise.resolve(null);
    request
      .then((config) => {
        if (active && config) {
          const normalized = normalizeWritingAssistanceConfig(config);
          setWritingAssistanceConfig(normalized);
          setWritingAssistanceDraft(normalized);
        }
      })
      .catch((error) => {
        if (active) {
          showStatus(`写作检查配置读取失败：${error?.message || error}`, "warning");
        }
      });
    return () => {
      active = false;
    };
  }, [showStatus]);

  const selectionAi = useSelectionAiController({
    aiConfig,
    onOpenSettings: openAiSettings,
    onStatus: showStatus,
  });

  const openSelectionAiForPane = useCallback((pane, selection, anchor) => {
    const targetTabId = pane === "right"
      ? rightSplitTabIdRef.current
      : activeTabIdRef.current;
    const targetEditor = pane === "right" ? rightSplitEditor : editor;
    if (!targetTabId || !targetEditor || !selection?.text) {
      showStatus("请先选中要询问的文字", "warning");
      return false;
    }
    const from = Math.min(Number(selection.from) || 0, Number(selection.to) || 0);
    const to = Math.max(Number(selection.from) || 0, Number(selection.to) || 0);
    const selectedText = selection.text;
    return selectionAi.open({
      selection,
      anchor,
      target: {
        pane,
        tabId: targetTabId,
        from,
        to,
      },
      restoreFocus: () => {
        let currentEditor = null;
        let targetSelectionRef = null;
        let targetDocumentVisible = false;
        if (activeTabIdRef.current === targetTabId) {
          currentEditor = editor;
          targetSelectionRef = editorSelectionRef;
          targetDocumentVisible = true;
        } else if (rightSplitTabIdRef.current === targetTabId) {
          currentEditor = rightSplitEditorRuntimeRef.current;
          targetSelectionRef = rightSplitSelectionRef;
          targetDocumentVisible = true;
        } else if (
          activePaneRef.current === "right"
          && rightSplitEditorRuntimeRef.current
        ) {
          currentEditor = rightSplitEditorRuntimeRef.current;
        } else {
          currentEditor = editor;
        }
        if (!currentEditor) {
          targetDocumentVisible = false;
          targetSelectionRef = null;
          currentEditor = activePaneRef.current === "right"
            ? (rightSplitEditorRuntimeRef.current || editor)
            : editor;
        }
        if (!currentEditor) return;
        const maxPosition = currentEditor.state.doc.content.size;
        const canRestoreSelection = Boolean(
          targetDocumentVisible
          && targetSelectionRef
          && from >= 1
          && to > from
          && to <= maxPosition
          && currentEditor.state.doc
            .textBetween(from, to, "\n\n", "\n")
            .replace(/\s+\n/g, "\n")
            .trim() === selectedText
        );
        if (canRestoreSelection) {
          targetSelectionRef.current = { from, to };
          currentEditor
            .chain()
            .focus()
            .setTextSelection({ from, to })
            .scrollIntoView()
            .run();
          return;
        }
        currentEditor.chain().focus().run();
      },
    });
  }, [
    activePaneRef,
    editor,
    rightSplitEditor,
    selectionAi.open,
    showStatus,
  ]);

  useEffect(() => {
    selectionAi.syncOpenTabs(openTabs);
  }, [openTabs, selectionAi.syncOpenTabs]);

  useEffect(() => {
    const expandedTabId = selectionAi.state.expandedTabId;
    if (!expandedTabId) return;
    const visibleInMain = activeTabId === expandedTabId;
    const visibleInSecondary = (
      !aiMode
      && rightSplitTabId === expandedTabId
      && activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.DOCUMENT
    );
    if (aiMode || (!visibleInMain && !visibleInSecondary)) {
      selectionAi.minimize({ tabId: expandedTabId, restore: false });
    }
  }, [
    activeSecondaryView?.kind,
    activeTabId,
    aiMode,
    rightSplitTabId,
    selectionAi.minimize,
    selectionAi.state.expandedTabId,
  ]);

  const requestCloseSelectionAiSession = useCallback(async ({
    session,
    sessionId,
    tabId,
  }) => {
    if (!session || !tabId || !sessionId) return false;
    const needsConfirmation = Boolean(
      session.messages?.length
      || session.input?.trim()
      || session.status === "streaming",
    );
    if (needsConfirmation) {
      const decision = await showConfirmDialog({
        tone: "warning",
        icon: MessageSquare,
        eyebrow: "临时选区问答",
        title: "关闭当前会话？",
        message: session.status === "streaming"
          ? "AI 仍在回答，关闭后会立即停止本次生成。"
          : "这个临时会话已有内容，关闭后无法恢复。",
        detail: "只会关闭当前会话，其他选区问答会话会继续保留。",
        cancelValue: "cancel",
        actions: [
          { value: "close", label: "关闭会话", variant: "danger", icon: X },
          { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
        ],
      });
      if (decision !== "close") return false;
    }
    return selectionAi.closeSession({ tabId, sessionId, restore: true });
  }, [selectionAi.closeSession, showConfirmDialog]);

  const requestCloseAllSelectionAiSessions = useCallback(async ({
    sessions,
    tabId,
  }) => {
    if (!tabId || !sessions?.length) return false;
    const streamingCount = sessions.filter((session) => session.status === "streaming").length;
    const decision = await showConfirmDialog({
      tone: "warning",
      icon: MessageSquare,
      eyebrow: "临时选区问答",
      title: `关闭全部 ${sessions.length} 个会话？`,
      message: "这些临时问答不会写入信笺，关闭后无法恢复。",
      detail: streamingCount
        ? `其中 ${streamingCount} 个会话仍在生成，关闭后会一并停止。`
        : "只会清理当前信笺的选区问答会话。",
      cancelValue: "cancel",
      actions: [
        { value: "close", label: "关闭全部", variant: "danger", icon: X },
        { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
      ],
    });
    if (decision !== "close") return false;
    return selectionAi.closeAll({ tabId, restore: true });
  }, [selectionAi.closeAll, showConfirmDialog]);

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
    aiCollaborationPending: Boolean(pendingCollaborationOwner),
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
    if (scope === "research" && !researchRoot?.available) {
      showStatus("请先选择资料文件夹", "warning");
      return;
    }
    setSearchMode(["workspace", "research"].includes(scope) ? scope : "document");
    if (scope === "document") setDocumentReplaceVisible(Boolean(options.replace));
  }, [researchRoot?.available, showStatus, writingWorkspaceRoot]);

  const closeSearch = useCallback(() => {
    if (searchMode === "research") {
      researchSearch.cancel();
      researchSearch.reset();
    }
    setSearchMode("");
    renderDocumentSearchState(activeWorkEditor, null);
  }, [activeWorkEditor, researchSearch.cancel, researchSearch.reset, searchMode]);

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

  useEffect(() => {
    const target = pendingResearchDocumentSearch;
    if (!target || !rightSplitEditor || rightSplitTabId !== target.tabId) return;
    setPendingResearchDocumentSearch(null);
    if (target.matchField === "title" || target.matchField === "fileName" || target.matchField === "name") {
      const input = rightCanvasRef.current?.querySelector?.(".paper-title-input");
      input?.focus?.();
      input?.select?.();
      return;
    }
    if (target.matchField === "author") {
      const input = rightCanvasRef.current?.querySelector?.(".paper-author-input");
      input?.focus?.();
      input?.select?.();
      return;
    }
    const query = String(target.query || "").trim();
    if (!query) return;
    let next = searchDocumentText(rightSplitEditor.state.doc, query);
    if (next.matches.length && Number.isFinite(Number(target.matchStart))) {
      const targetOffset = Number(target.matchStart);
      const closestIndex = next.matches.reduce((best, match, index) => (
        Math.abs(match.plainStart - targetOffset) < Math.abs(next.matches[best].plainStart - targetOffset) ? index : best
      ), 0);
      next = { ...next, activeIndex: closestIndex, activeMatch: next.matches[closestIndex] };
    }
    if (next.activeMatch) {
      rightSplitEditor.chain().focus().setTextSelection(next.activeMatch.from).scrollIntoView().run();
    }
  }, [pendingResearchDocumentSearch, rightSplitEditor, rightSplitTabId]);

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
    if (previousRequest) {
      workspaceFileLifecyclePort
        .cancelWorkspaceSearch(writingWorkspaceRoot, previousRequest)
        ?.catch?.(() => {});
    }
    if (!query) {
      setWorkspaceSearchState({
        loading: false,
        results: [],
        error: "",
        requestId: "",
      });
      return undefined;
    }
    const requestId = `search-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    workspaceSearchRequestRef.current = requestId;
    setWorkspaceSearchState({
      loading: true,
      results: [],
      error: "",
      requestId,
    });
    const timer = window.setTimeout(async () => {
      try {
        const result = await workspaceFileLifecyclePort.searchWorkspace({
          rootPath: writingWorkspaceRoot,
          query,
          requestId,
          limit: 100,
        });
        if (
          workspaceSearchRequestRef.current !== requestId
          || result?.canceled
        ) return;
        setWorkspaceSearchState({
          loading: false,
          results: result?.results || [],
          error: "",
          requestId,
        });
      } catch (error) {
        if (workspaceSearchRequestRef.current === requestId) {
          setWorkspaceSearchState({
            loading: false,
            results: [],
            error: error?.message || "工作区搜索失败",
            requestId,
          });
        }
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      workspaceFileLifecyclePort
        .cancelWorkspaceSearch(writingWorkspaceRoot, requestId)
        ?.catch?.(() => {});
    };
  }, [
    searchMode,
    snapshotLiveTabs,
    workspaceFileLifecyclePort,
    workspaceSearchQuery,
    writingWorkspaceRoot,
  ]);

  useEffect(() => {
    workspaceFileLifecyclePort
      .watchWorkspace(writingWorkspaceRoot || "")
      ?.catch?.(() => {});
    if (!writingWorkspaceRoot) return undefined;
    const onChanged = (payload = {}) => {
      workspaceFileLifecyclePort.handleWorkspaceChanged(
        payload,
        writingWorkspaceRoot,
      );
    };
    const unsubscribeChanged = bridge.onWorkspaceChanged?.(onChanged);
    const unsubscribeError = bridge.onWorkspaceWatchError?.((payload) => (
      showStatus(
        payload?.message || "工作区文件监听不可用；仍会在保存前校验",
        "warning",
      )
    ));
    return () => {
      unsubscribeChanged?.();
      unsubscribeError?.();
    };
  }, [
    showStatus,
    snapshotLiveTabs,
    workspaceFileLifecyclePort,
    writingWorkspaceRoot,
  ]);

  useEffect(
    () => bridge.onWindowFocus?.(
      () => workspaceFileLifecyclePort.verifyOpenDocuments(),
    ),
    [showStatus, snapshotLiveTabs, workspaceFileLifecyclePort],
  );

  const sessionPersistenceDescriptor = useMemo(
    () => describeDocumentSessionPersistence({
      activeTabId,
      currentPath,
      groups: workspaceGroups,
      tabs: openTabs,
    }),
    [activeTabId, currentPath, openTabs, workspaceGroups],
  );
  const {
    sessionPathSignature,
    workspaceGroupsSessionSignature,
  } = sessionPersistenceDescriptor;

  useEffect(() => {
    return documentSessionControllerRef.current?.schedulePersistence();
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
    editor.setEditable(!activeTabReadOnly && !activeTabCollaborationLocked && !(aiMode && aiStatus === "streaming") && !aiApplyPreview);
    return () => {
      editor.setEditable(true);
    };
  }, [activeTabCollaborationLocked, activeTabReadOnly, aiApplyPreview, aiMode, aiStatus, editor]);

  useEffect(() => {
    if (!rightSplitEditor) {
      return undefined;
    }
    rightSplitEditor.setEditable(!rightSplitReadOnly);
    if (rightSplitCollaborationLocked) rightSplitEditor.setEditable(false);
    return () => {
      rightSplitEditor.setEditable(true);
    };
  }, [rightSplitCollaborationLocked, rightSplitEditor, rightSplitReadOnly]);

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

  const handleOpenHelpCenter = useCallback(() => {
    setHelpTargetTopicId("");
    setHelpAssistantOpen(false);
    openHelpCenter();
  }, [openHelpCenter]);

  const handleOpenHelpAssistant = useCallback(() => {
    setHelpOpen(false);
    setHelpAssistantOpen(true);
  }, [setHelpOpen]);

  const handleOpenHelpAssistantSettings = useCallback(() => {
    setHelpAssistantOpen(false);
    openAiSettings({ panel: "tasks", taskId: "helpAssistant" });
  }, [openAiSettings]);

  const handleOpenHelpAssistantSource = useCallback((topicId) => {
    setHelpAssistantOpen(false);
    setHelpTargetTopicId(topicId || "");
    openHelpCenter();
  }, [openHelpCenter]);

  const handleDeleteHelpAssistantSession = useCallback(async (session) => {
    setHelpAssistantOpen(false);
    const decision = await showConfirmDialog({
      tone: "warning",
      icon: Trash2,
      eyebrow: "AI精灵",
      title: `删除“${session?.title || "这段对话"}”？`,
      message: "这段问答会从本机历史中永久删除。",
      detail: "信笺、资料区和其他 AI 记录不会受到影响。",
      cancelValue: "cancel",
      actions: [
        { value: "delete", label: "删除", variant: "danger", icon: Trash2 },
        { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
      ],
    });
    setHelpAssistantOpen(true);
    return decision === "delete";
  }, [showConfirmDialog]);

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
  const workspaceGroupsController = useMemo(
    () => createWorkspaceGroupsController({
      documentStorePort,
      groupStorePort,
      letterTemplates,
      researchResolver: {
        clearError: () => setActiveResearchError(""),
        commitItem: (viewId, item) => {
          setResearchItemsByViewId((previous) => ({
            ...previous,
            [viewId]: item,
          }));
        },
        destroyView: (viewId) => bridge.destroyResearchWebView?.(viewId),
        removeItems: (viewIds) => {
          setResearchItemsByViewId((previous) => {
            const copy = { ...previous };
            viewIds.forEach((viewId) => delete copy[viewId]);
            return copy;
          });
        },
        renameItems: (viewIds, {
          itemPatch,
          nextPath,
          previousPath,
        }) => {
          setResearchItemsByViewId((previous) => {
            const copy = { ...previous };
            for (const viewId of viewIds) {
              if (copy[viewId]) {
                copy[viewId] = {
                  ...copy[viewId],
                  ...itemPatch,
                  relativePath: `${nextPath}${String(
                    copy[viewId].relativePath || "",
                  ).slice(previousPath.length)}`,
                };
              }
            }
            return copy;
          });
        },
        resolveItem: (view) => (
          researchItemsByViewIdRef.current[view.viewId]
          || (view.sourceId
            ? librarySourcesRef.current.find(
              (source) => source.id === view.sourceId,
            )
            : null)
          || null
        ),
        setActiveItem: setActiveLibraryItem,
      },
      statusPort: {
        show: showStatus,
      },
    }),
    [documentStorePort, groupStorePort, letterTemplates, showStatus],
  );
  const {
    addOrActivateDocumentTab: addOrActivateWorkspaceDocumentTab,
    closeGroupView: closeWorkspaceGroupView,
    moveGroupDocument: moveWorkspaceGroupDocument,
    reconcileTabs: reconcileWorkspaceTabs,
    reorderGroupView: reorderWorkspaceGroupView,
    researchViewsPort: workspaceResearchViewsPort,
    selectGroupView: selectWorkspaceGroupView,
    selectTab: selectWorkspaceTab,
    toggleRightSplit: toggleWorkspaceRightSplit,
    updateResearchViewState: commitResearchViewState,
  } = workspaceGroupsController;
  const {
    removeOpenResearchViews,
    updateOpenResearchTargets,
  } = workspaceResearchViewsPort;

  useEffect(() => {
    reconcileWorkspaceTabs(openTabs);
  }, [openTabs]);

  const handleToggleRightSplit = useCallback((tabId) => {
    prepareSecondaryPanePageView();
    return toggleWorkspaceRightSplit(tabId, {
      applyDocument,
      snapshotTabs: snapshotLiveTabs,
    });
  }, [
    applyDocument,
    prepareSecondaryPanePageView,
    snapshotLiveTabs,
    toggleWorkspaceRightSplit,
  ]);

  const addOrActivateDocumentTab = useCallback(
    (
      nextDocument,
      nextPath = "",
      nextDirty = false,
      options = {},
    ) => {
      if (options.groupId === WORKSPACE_GROUP_ID.SECONDARY) {
        prepareSecondaryPanePageView();
      }
      return addOrActivateWorkspaceDocumentTab(
        nextDocument,
        nextPath,
        nextDirty,
        options,
        {
          applyDocument,
          initializeTabRuntime: (tabId, initialState) => (
            documentTabRuntimePort.ensure(tabId, initialState)
          ),
          snapshotTabs: snapshotLiveTabs,
        },
      );
    },
    [
      addOrActivateWorkspaceDocumentTab,
      applyDocument,
      documentTabRuntimePort,
      prepareSecondaryPanePageView,
      snapshotLiveTabs,
    ],
  );

  const handleSelectTab = useCallback(
    (tabId) => selectWorkspaceTab(tabId, {
      applyDocument,
      snapshotTabs: snapshotLiveTabs,
    }),
    [applyDocument, selectWorkspaceTab, snapshotLiveTabs],
  );

  const workspaceFileController = useMemo(
    () => createWorkspaceFileController({
      documentPort: {
        addOrActivate: addOrActivateDocumentTab,
        applyDocument,
        commitActiveTab: documentStorePort.commitActiveTabId,
        commitCurrentPath: documentStorePort.commitCurrentPath,
        commitDocument: documentStorePort.commitDocumentState,
        commitTabs: documentStorePort.commitOpenTabs,
        read: documentStorePort.read,
        recordMutation: recordTabMutation,
        selectTab: handleSelectTab,
        snapshotTabs: snapshotLiveTabs,
      },
      factories: {
        createBlank: () => createBlankDocument(
          letterTemplates,
          newDocumentTemplateId,
        ),
        createTab: createDocumentTab,
        mergePersistedIdentity: mergePersistedDocumentIdentity,
        summarizeTabs: summarizeSessionTabs,
      },
      folderPort: {
        readExpanded: () => expandedFoldersRef.current,
        readPath: () => folderPathRef.current,
        readState: () => folderStateRef.current,
        updateExpanded: (updater) => {
          const previous = expandedFoldersRef.current;
          const next = typeof updater === "function"
            ? updater(previous)
            : updater;
          expandedFoldersRef.current = next;
          setExpandedFolders(next);
          return next;
        },
        updateState: (updater) => {
          const previous = folderStateRef.current;
          const next = typeof updater === "function"
            ? updater(previous)
            : updater;
          folderStateRef.current = next;
          setFolderState(next);
          return next;
        },
        writeExpanded: (next) => {
          expandedFoldersRef.current = next;
        },
        writePath: (next) => {
          folderPathRef.current = next;
        },
      },
      groupPort: {
        clearRightSplit: () => {
          rightSplitTabIdRef.current = "";
          setRightSplitTabId("");
        },
        commitActivePane: setActivePane,
        read: () => {
          const state = groupStorePort.read();
          const focusedSecondary = state.groups.focusedGroup
            === WORKSPACE_GROUP_ID.SECONDARY
            ? getActiveWorkspaceView(
              state.groups,
              WORKSPACE_GROUP_ID.SECONDARY,
            )
            : null;
          return {
            focusedDocumentTabId: focusedSecondary?.kind
              === WORKSPACE_VIEW_KIND.DOCUMENT
              ? focusedSecondary.tabId
              : "",
            rightSplitTabId: rightSplitTabIdRef.current,
          };
        },
      },
      ioPort: {
        backupDocument: (path) => bridge.backupDocument?.(path),
        cancelFolderSearch: (rootPath, requestId) => (
          bridge.cancelFolderSearch?.(rootPath, requestId)
        ),
        createDocumentInFolder: (path, title, document) => (
          bridge.createDocumentInFolder?.(path, title, document)
        ),
        createFolder: (path, name) => bridge.createFolder?.(path, name),
        debugLog: (event, payload) => bridge.debugLog?.(event, payload),
        deleteEntry: (path) => bridge.deleteEntry?.(path),
        getDocumentRevision: (path) => bridge.getDocumentRevision?.(path),
        getPaths: () => bridge.getPaths?.(),
        importDocument: () => bridge.importDocument?.(),
        listFolder: listFolderWithTimeout,
        moveEntry: (path, targetFolderPath) => (
          bridge.moveEntry?.(path, targetFolderPath)
        ),
        openDocument: () => bridge.openDocument(),
        openDocumentPath: (path) => bridge.openDocumentPath(path),
        openFolder: () => bridge.openFolder(),
        renameEntry: (path, nextName) => bridge.renameEntry?.(path, nextName),
        searchFolder: (options) => bridge.searchFolder?.(options),
        watchWorkspace: (rootPath) => bridge.watchWorkspace?.(rootPath),
      },
      requestPorts: {
        branch: folderBranchRequestControllerRef.current,
        disk: diskRevisionRequestControllerRef.current,
        view: folderRequestControllerRef.current,
      },
      revisionPort: documentRevisionPort,
      sessionPort: {
        commitPatch: persistSession,
      },
      tabLifecyclePort: {
        releaseRuntime: releaseTabRuntimeState,
      },
      uiPort: {
        icons: {
          filePlus: FilePlus,
          folderPlus: FolderPlus,
          pencil: Pencil,
        },
        prompt: showPromptDialog,
        status: showStatus,
      },
    }),
    [
      addOrActivateDocumentTab,
      applyDocument,
      documentStorePort,
      groupStorePort,
      handleSelectTab,
      letterTemplates,
      newDocumentTemplateId,
      persistSession,
      recordTabMutation,
      releaseTabRuntimeState,
      showPromptDialog,
      showStatus,
      snapshotLiveTabs,
    ],
  );
  workspaceFileControllerRef.current = workspaceFileController;
  const {
    mutationPort: workspaceFileMutationPort,
    navigationPort: workspaceFileNavigationPort,
    openPort: workspaceFileOpenPort,
  } = workspaceFileController;

  const documentSessionController = useMemo(
    () => createDocumentSessionController({
      applyDocument,
      debugPort: {
        log: (event, payload) => bridge.debugLog?.(event, payload),
      },
      documentIoPort: {
        getDocumentRevision: (path) => bridge.getDocumentRevision?.(path),
        openDocumentPath: (path) => bridge.openDocumentPath(path),
      },
      documentRuntimePort: documentTabRuntimePort,
      documentStorePort,
      folderLifecyclePort: workspaceFileLifecyclePort,
      groupStorePort,
      letterTemplates,
      researchStatePort: {
        commitActiveItem: setActiveLibraryItem,
        commitItem: (viewId, item) => {
          setResearchItemsByViewId((previous) => ({
            ...previous,
            [viewId]: item,
          }));
        },
      },
      sessionStatePort,
    }),
    [
      applyDocument,
      documentStorePort,
      documentTabRuntimePort,
      groupStorePort,
      letterTemplates,
      sessionStatePort,
      workspaceFileLifecyclePort,
    ],
  );
  documentSessionControllerRef.current = documentSessionController;

  const documentPersistenceController = useMemo(
    () => createDocumentPersistenceController({
      applicationPort: {
        applyDocument,
        captureSaveDocument: ({ isRightSplit }) => (
          isRightSplit ? getRightSplitSaveDocument() : getSaveDocument()
        ),
        commitActiveResearchItem: setActiveLibraryItem,
        migrateDocumentRuntimeKey: migrateAiRequestDocumentKey,
        openConflictComparison: ({ document: comparisonDocument, targetTab }) => {
          const comparisonId = addOrActivateDocumentTab(
            comparisonDocument,
            "",
            false,
            { readOnly: true },
          );
          if (comparisonId) {
            rightSplitTabIdRef.current = targetTab.id;
            setRightSplitTabId(targetTab.id);
            setActivePane("main");
          }
          return comparisonId;
        },
        readSaveContext: () => {
          const documentSnapshot = documentStorePort.read();
          const groupSnapshot = groupStorePort.read();
          const activeSecondary = getActiveWorkspaceView(
            groupSnapshot.groups,
            WORKSPACE_GROUP_ID.SECONDARY,
          );
          if (
            groupSnapshot.activePane === "right"
            && activeSecondary?.kind === WORKSPACE_VIEW_KIND.RESEARCH
          ) {
            return { blockedByResearch: true };
          }
          const rightTab = documentSnapshot.tabs.find(
            (tab) => tab.id === groupSnapshot.rightSplitTabId,
          );
          const isRightSplit = !persistenceViewStateRef.current.aiMode
            && groupSnapshot.activePane === "right"
            && Boolean(
              groupSnapshot.rightSplitTabId
              && groupSnapshot.rightSplitTabId
                !== documentSnapshot.activeTabId
              && rightTab?.document
              && rightSplitEditorRuntimeRef.current,
            );
          return {
            blockedByResearch: false,
            isRightSplit,
            targetTab: isRightSplit
              ? rightTab
              : documentSnapshot.tabs.find(
                  (tab) => tab.id === documentSnapshot.activeTabId,
                ),
          };
        },
        refreshFolder: workspaceFileNavigationPort.refreshFolder,
        resolveResearchItem: (view) => (
          researchItemsByViewIdRef.current[view.viewId]
          || (view.sourceId
            ? librarySourcesRef.current.find(
                (source) => source.id === view.sourceId,
              )
            : null)
          || null
        ),
      },
      dialogPort: {
        confirmTabClose: ({ tab } = {}) => {
          const sessionSummary = selectionAi.getTabSessionSummary(tab?.id);
          const sessionDetail = sessionSummary.count
            ? `；同时会结束 ${sessionSummary.count} 个仅保存在本次运行中的选区问答会话`
            : "";
          return showConfirmDialog({
            tone: "warning",
            icon: FileText,
            eyebrow: "未保存的信笺",
            title: "这个文件尚未保存",
            message: "要关闭这个信笺吗？",
            detail: `关闭后，这个信笺中尚未保存的修改不会写入文件${sessionDetail}。`,
            cancelValue: "cancel",
            actions: [
              { value: "close", label: "关闭信笺", variant: "danger", icon: X },
              { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
            ],
          });
        },
        confirmWindowClose: ({ dirtyTabs }) => showConfirmDialog({
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
        }),
        resolveSaveConflict: ({ result }) => showConfirmDialog({
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
        }),
      },
      dirtyPort: documentDirtyPort,
      documentIoPort: {
        closeCanceled: (payload) => bridge.closeCanceled?.(payload),
        closeReady: (payload) => bridge.closeReady?.(payload),
        deleteTempDocument: (recoveryId) => bridge.deleteTempDocument?.(recoveryId),
        openDocumentPath: (path) => bridge.openDocumentPath(path),
        saveDocument: (...args) => bridge.saveDocument(...args),
        saveTempDocument: (...args) => bridge.saveTempDocument?.(...args),
      },
      documentStorePort,
      groupStorePort,
      letterTemplates,
      lifecyclePort: {
        onCloseRequest: (handler) => bridge.onCloseRequest?.(handler),
        onWindowBlur: (handler) => bridge.onWindowBlur?.(handler),
      },
      newDocumentTemplateId,
      notificationPort: {
        show: showStatus,
      },
      revisionPort: documentRevisionPort,
      runtimeState: documentPersistenceRuntimeStateRef.current,
      saveQueuePort: documentSaveQueuePort,
      sessionStatePort,
      snapshotPort: {
        snapshot: snapshotLiveTabs,
      },
      tabRuntimePort: documentTabRuntimePort,
      timerPort: {
        clearInterval: (timer) => window.clearInterval(timer),
        setInterval: (callback, delay) => window.setInterval(callback, delay),
      },
    }),
    [
      addOrActivateDocumentTab,
      applyDocument,
      documentDirtyPort,
      documentRevisionPort,
      documentSaveQueuePort,
      documentStorePort,
      documentTabRuntimePort,
      getRightSplitSaveDocument,
      getSaveDocument,
      groupStorePort,
      letterTemplates,
      migrateAiRequestDocumentKey,
      newDocumentTemplateId,
      selectionAi.getTabSessionSummary,
      sessionStatePort,
      showConfirmDialog,
      showStatus,
      snapshotLiveTabs,
      workspaceFileNavigationPort,
    ],
  );
  documentPersistenceControllerRef.current = documentPersistenceController;

  useEffect(() => {
    if (!editor || sessionRestoredRef.current) {
      return undefined;
    }
    const restoreOperation = documentSessionController.beginRestore();
    return () => restoreOperation?.cancel();
  }, [applyDocument, commitWorkspaceGroups, editor, letterTemplates, persistSession]);

  const handleSelectGroupView = useCallback(
    (groupId, viewId) => {
      if (groupId === WORKSPACE_GROUP_ID.SECONDARY) {
        prepareSecondaryPanePageView();
      }
      return selectWorkspaceGroupView(groupId, viewId, {
        applyDocument,
        snapshotTabs: snapshotLiveTabs,
      });
    },
    [
      applyDocument,
      prepareSecondaryPanePageView,
      selectWorkspaceGroupView,
      snapshotLiveTabs,
    ],
  );

  const handleReorderGroupView = useCallback(
    (groupId, viewId, beforeViewId) => reorderWorkspaceGroupView(
      groupId,
      viewId,
      beforeViewId,
    ),
    [reorderWorkspaceGroupView],
  );

  const handleMoveGroupDocument = useCallback(
    (viewId, targetGroupId, beforeViewId = null) => {
      if (targetGroupId === WORKSPACE_GROUP_ID.SECONDARY) {
        prepareSecondaryPanePageView();
      }
      return moveWorkspaceGroupDocument(
        viewId,
        targetGroupId,
        beforeViewId,
        {
          applyDocument,
          snapshotTabs: snapshotLiveTabs,
        },
      );
    },
    [
      applyDocument,
      moveWorkspaceGroupDocument,
      prepareSecondaryPanePageView,
      snapshotLiveTabs,
    ],
  );

  const handleCloseTab = useCallback(async (tabId) => {
    if (collaborationLockedTabIds.has(tabId)) {
      showStatus("这封信笺正被 AI 协作审阅锁定，请先完成或取消审阅", "warning");
      return { status: "canceled" };
    }
    const tab = openTabsRef.current.find((candidate) => candidate.id === tabId);
    const sessionSummary = selectionAi.getTabSessionSummary(tabId);
    if (
      tab
      && !tab.dirty
      && (
        sessionSummary.hasContent
        || sessionSummary.hasDraft
        || sessionSummary.isStreaming
      )
    ) {
      const decision = await showConfirmDialog({
        tone: "warning",
        icon: MessageSquare,
        eyebrow: "临时选区问答",
        title: "关闭信笺并结束问答？",
        message: `这封信笺还有 ${sessionSummary.count} 个仅保存在本次运行中的选区问答会话。`,
        detail: sessionSummary.isStreaming
          ? "其中仍有回答正在生成；关闭信笺后会停止生成并清除全部会话。"
          : "关闭信笺后，这些会话将无法恢复。",
        cancelValue: "cancel",
        actions: [
          { value: "close", label: "关闭信笺", variant: "danger", icon: X },
          { value: "cancel", label: "取消", variant: "secondary", autoFocus: true },
        ],
      });
      if (decision !== "close") return { status: "canceled" };
    }
    return documentPersistenceController.closeTab(tabId);
  }, [
    collaborationLockedTabIds,
    documentPersistenceController,
    selectionAi.getTabSessionSummary,
    showConfirmDialog,
  ]);

  const handleCloseGroupView = useCallback(
    (groupId, viewId) => closeWorkspaceGroupView(
      groupId,
      viewId,
      { closeDocumentTab: handleCloseTab },
    ),
    [closeWorkspaceGroupView, handleCloseTab],
  );

  const handleNew = workspaceFileOpenPort.newDocument;
  const handleOpen = workspaceFileOpenPort.openDocument;
  const handleImportDocument = workspaceFileOpenPort.importDocument;
  const handleOpenFolder = workspaceFileNavigationPort.chooseFolder;
  const handleOpenFolderPath = workspaceFileNavigationPort.navigateFolder;
  const refreshFolder = workspaceFileNavigationPort.refreshFolder;
  const handleOpenFolderFile = workspaceFileOpenPort.openDocumentPath;

  const handleCompositionComplete = useCallback(async (output) => {
    const outputPath = String(output?.path || "");
    setCompositionWorkspaceOpen(false);
    if (outputPath) {
      await handleOpenFolderFile(outputPath);
      showStatus("AI 起稿已生成新的派生信笺，原稿保持不变", "success");
    }
  }, [handleOpenFolderFile, showStatus]);

  const handleSetDocumentPageViewMode = useCallback((view, mode, groupId) => {
    const tabId = String(view?.tabId || "");
    if (!tabId || !Object.values(PAGE_VIEW_MODES).includes(mode)) return;
    if (mode === PAGE_VIEW_MODES.SPREAD) {
      if (groupId === WORKSPACE_GROUP_ID.SECONDARY && view?.viewId) {
        handleMoveGroupDocument(view.viewId, WORKSPACE_GROUP_ID.PRIMARY, null);
      } else if (view?.viewId) {
        handleSelectGroupView(WORKSPACE_GROUP_ID.PRIMARY, view.viewId);
      }
      setActivePane("main");
    } else if (view?.viewId && groupId) {
      handleSelectGroupView(groupId, view.viewId);
    }
    const current = getPageViewStateForTab(tabId);
    updatePageViewStateForTab(tabId, {
      ...current,
      mode,
      zoomMode: PAGE_ZOOM_MODES.FIT,
    });
  }, [
    getPageViewStateForTab,
    handleMoveGroupDocument,
    handleSelectGroupView,
    setActivePane,
    updatePageViewStateForTab,
  ]);

  const handleOpenDocumentHistory = useCallback((
    tabId = activeWorkTabId,
    returnFocusElement = null,
  ) => {
    if (!tabId) return;
    historyReturnFocusRef.current = returnFocusElement
      || window.document.activeElement
      || null;
    setHistoryDialog({
      open: true,
      tabId,
    });
  }, [activeWorkTabId]);

  const handlePrepareDocumentHistoryOperation = useCallback(
    () => prepareDocumentHistoryOperation({
      tabId: historyDialog.tabId,
      persistenceController: documentPersistenceController,
      documentStorePort,
      dirtyPort: documentDirtyPort,
      revisionPort: documentRevisionPort,
      getDocumentRevision: (path) => bridge.getDocumentRevision?.(path),
    }),
    [
      documentDirtyPort,
      documentPersistenceController,
      documentRevisionPort,
      documentStorePort,
      historyDialog.tabId,
    ],
  );

  const handleOpenCanvasDocumentContext = useCallback((event, pane) => {
    if (!event) return;
    if (aiMode) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }
    const groupId = pane === "right"
      ? WORKSPACE_GROUP_ID.SECONDARY
      : WORKSPACE_GROUP_ID.PRIMARY;
    const view = getActiveWorkspaceView(workspaceGroupsRef.current, groupId);
    if (!view || view.kind !== WORKSPACE_VIEW_KIND.DOCUMENT) return;
    event.preventDefault();
    event.stopPropagation();
    setActivePane(pane === "right" ? "right" : "main");
    const tab = openTabsRef.current.find((candidate) => candidate.id === view.tabId);
    setDocumentContextMenu(positionDocumentContextMenu(event, {
      groupId,
      viewId: view.viewId,
      tabId: view.tabId,
      title: tab?.title || "当前信笺",
    }));
  }, [aiMode, setActivePane]);

  const handleOpenEmojiPicker = useCallback(() => {
    const editorId = splitPaneActive ? "right" : "main";
    const context = captureEmojiInsertionContext({
      tabId: activeWorkTabId,
      documentId: activeWorkDocument?.documentId,
      editorId,
      editor: activeWorkEditor,
      revision: documentRevisionPort.readLiveRevision(activeWorkTabId),
    });
    if (!context) {
      showStatus("当前选区无法插入表情", "warning");
      return;
    }
    setEmojiPicker({ open: true, context });
  }, [
    activeWorkDocument?.documentId,
    activeWorkEditor,
    activeWorkTabId,
    documentRevisionPort,
    showStatus,
    splitPaneActive,
  ]);

  const handleSelectEmoji = useCallback((unicode) => {
    const editorId = splitPaneActive ? "right" : "main";
    return insertEmojiFromContext(emojiPicker.context, {
      tabId: activeWorkTabId,
      documentId: activeWorkDocument?.documentId,
      editorId,
      editor: activeWorkEditor,
      revision: documentRevisionPort.readLiveRevision(activeWorkTabId),
    }, unicode);
  }, [
    activeWorkDocument?.documentId,
    activeWorkEditor,
    activeWorkTabId,
    documentRevisionPort,
    emojiPicker.context,
    splitPaneActive,
  ]);

  const closeProfessionalUi = useCallback(() => {
    setProfessionalUi({
      kind: "",
      editor: null,
      tabId: "",
      documentId: "",
      revision: "",
      selection: null,
      initialValue: null,
      updatePosition: null,
    });
  }, []);

  const handleInsertCodeBlock = useCallback(() => {
    if (!activeWorkEditor || activeWorkReadOnly) {
      showStatus("当前信笺不可编辑", "warning");
      return false;
    }
    return insertCodeBlock(activeWorkEditor, {
      language: "plaintext",
      wrap: false,
    });
  }, [activeWorkEditor, activeWorkReadOnly, showStatus]);

  const handleInsertBookmark = useCallback(() => {
    if (!activeWorkEditor || activeWorkReadOnly) {
      showStatus("当前信笺不可编辑", "warning");
      return false;
    }
    const inserted = insertBookmark(activeWorkEditor);
    if (inserted) {
      setLeftSidebarCollapsed(false);
      setLeftSidebarMode("structure");
      setStructureMode("bookmarks");
    }
    return inserted;
  }, [activeWorkEditor, activeWorkReadOnly, showStatus]);

  const openProfessionalUi = useCallback((kind, initialValue = null) => {
    if (!activeWorkEditor || activeWorkReadOnly) {
      showStatus("当前信笺不可编辑", "warning");
      return;
    }
    const { from, to } = activeWorkEditor.state.selection;
    setProfessionalUi({
      kind,
      editor: activeWorkEditor,
      tabId: activeWorkTabId,
      documentId: String(activeWorkDocument?.documentId || ""),
      revision: documentRevisionPort.readLiveRevision(activeWorkTabId),
      selection: { from, to },
      initialValue,
      updatePosition: null,
    });
  }, [
    activeWorkDocument?.documentId,
    activeWorkEditor,
    activeWorkReadOnly,
    activeWorkTabId,
    documentRevisionPort,
    showStatus,
  ]);

  const resolveProfessionalTarget = useCallback(() => {
    const stale = (
      !professionalUi.kind
      || !professionalUi.editor
      || professionalUi.editor !== activeWorkEditor
      || professionalUi.tabId !== activeWorkTabId
      || professionalUi.documentId !== String(activeWorkDocument?.documentId || "")
      || professionalUi.revision !== documentRevisionPort.readLiveRevision(activeWorkTabId)
      || activeWorkReadOnly
    );
    if (stale) {
      closeProfessionalUi();
      showStatus("信笺或选区已变化，请重新打开元素面板", "warning");
      return null;
    }
    const maximum = professionalUi.editor.state.doc.content.size;
    const from = Math.max(0, Math.min(maximum, Number(professionalUi.selection?.from) || 0));
    const to = Math.max(from, Math.min(maximum, Number(professionalUi.selection?.to) || from));
    const restored = professionalUi.editor
      .chain()
      .focus()
      .setTextSelection({ from, to })
      .run();
    return restored ? professionalUi.editor : null;
  }, [
    activeWorkDocument?.documentId,
    activeWorkEditor,
    activeWorkReadOnly,
    activeWorkTabId,
    closeProfessionalUi,
    documentRevisionPort,
    professionalUi,
    showStatus,
  ]);

  const handleInsertMathDraft = useCallback((draft, operation = {}) => {
    if (
      operation.update
      && Number.isFinite(Number(operation.position))
      && professionalUi.editor
      && professionalUi.editor === activeWorkEditor
      && professionalUi.tabId === activeWorkTabId
      && professionalUi.revision === documentRevisionPort.readLiveRevision(activeWorkTabId)
    ) {
      return updateMathDraftAt(
        professionalUi.editor,
        Number(operation.position),
        draft,
      );
    }
    const targetEditor = resolveProfessionalTarget();
    return targetEditor ? insertMathDraft(targetEditor, draft) : false;
  }, [
    activeWorkEditor,
    activeWorkTabId,
    documentRevisionPort,
    professionalUi.editor,
    professionalUi.revision,
    professionalUi.tabId,
    resolveProfessionalTarget,
  ]);

  const handleInsertMermaidDraft = useCallback((draft, operation = {}) => {
    if (
      operation.update
      && Number.isFinite(Number(operation.position))
      && professionalUi.editor
      && professionalUi.editor === activeWorkEditor
      && professionalUi.tabId === activeWorkTabId
      && professionalUi.revision === documentRevisionPort.readLiveRevision(activeWorkTabId)
    ) {
      return updateMermaidDraftAt(
        professionalUi.editor,
        Number(operation.position),
        draft,
      );
    }
    const targetEditor = resolveProfessionalTarget();
    return targetEditor ? applyMermaidDraft(targetEditor, draft) : false;
  }, [
    activeWorkEditor,
    activeWorkTabId,
    documentRevisionPort,
    professionalUi.editor,
    professionalUi.revision,
    professionalUi.tabId,
    resolveProfessionalTarget,
  ]);

  useEffect(() => {
    if (!professionalUi.kind) return;
    if (
      professionalUi.editor !== activeWorkEditor
      || professionalUi.tabId !== activeWorkTabId
      || professionalUi.documentId !== String(activeWorkDocument?.documentId || "")
      || activeWorkReadOnly
    ) {
      closeProfessionalUi();
    }
  }, [
    activeWorkDocument?.documentId,
    activeWorkEditor,
    activeWorkReadOnly,
    activeWorkTabId,
    closeProfessionalUi,
    professionalUi.documentId,
    professionalUi.editor,
    professionalUi.kind,
    professionalUi.tabId,
  ]);

  useEffect(() => {
    const handleMathEditRequest = (event) => {
      const detail = event?.detail || {};
      const targetEditor = detail.editor;
      const position = Number(detail.position);
      if (!targetEditor || !Number.isFinite(position)) return;

      const inMain = targetEditor === editor;
      const inRight = targetEditor === rightSplitEditor;
      if (!inMain && !inRight) return;
      const tabId = inRight ? rightSplitTabIdRef.current : activeTabIdRef.current;
      const targetDocument = inRight ? rightSplitDocument : documentStateRef.current;
      const readOnly = inRight ? rightSplitReadOnly : activeTabReadOnly;
      if (!tabId || readOnly) {
        showStatus("当前信笺不可编辑", "warning");
        return;
      }
      const node = targetEditor.state.doc.nodeAt(position);
      setActivePane(inRight ? "right" : "main");
      setProfessionalUi({
        kind: "math",
        editor: targetEditor,
        tabId,
        documentId: String(targetDocument?.documentId || ""),
        revision: documentRevisionPort.readLiveRevision(tabId),
        selection: {
          from: position,
          to: Math.min(targetEditor.state.doc.content.size, position + (node?.nodeSize || 1)),
        },
        initialValue: detail.initialValue || null,
        updatePosition: position,
      });
    };
    window.addEventListener(PAPER_MATH_EDIT_REQUEST_EVENT, handleMathEditRequest);
    return () => window.removeEventListener(PAPER_MATH_EDIT_REQUEST_EVENT, handleMathEditRequest);
  }, [
    activeTabReadOnly,
    documentRevisionPort,
    editor,
    rightSplitDocument,
    rightSplitEditor,
    rightSplitReadOnly,
    setActivePane,
    showStatus,
  ]);

  useEffect(() => {
    const handleMermaidEditRequest = (event) => {
      const detail = event?.detail || {};
      const targetEditor = detail.editor;
      const position = Number(detail.position);
      if (!targetEditor || !Number.isFinite(position)) return;

      const inMain = targetEditor === editor;
      const inRight = targetEditor === rightSplitEditor;
      if (!inMain && !inRight) return;
      const tabId = inRight ? rightSplitTabIdRef.current : activeTabIdRef.current;
      const targetDocument = inRight ? rightSplitDocument : documentStateRef.current;
      const readOnly = inRight ? rightSplitReadOnly : activeTabReadOnly;
      if (!tabId || readOnly) {
        showStatus("当前信笺不可编辑", "warning");
        return;
      }
      const node = targetEditor.state.doc.nodeAt(position);
      if (!node || node.type.name !== "paperMermaid") return;
      setActivePane(inRight ? "right" : "main");
      setProfessionalUi({
        kind: "mermaid",
        editor: targetEditor,
        tabId,
        documentId: String(targetDocument?.documentId || ""),
        revision: documentRevisionPort.readLiveRevision(tabId),
        selection: {
          from: position,
          to: Math.min(targetEditor.state.doc.content.size, position + node.nodeSize),
        },
        initialValue: detail.initialValue || null,
        updatePosition: position,
      });
    };
    window.addEventListener(PAPER_MERMAID_EDIT_REQUEST_EVENT, handleMermaidEditRequest);
    return () => window.removeEventListener(PAPER_MERMAID_EDIT_REQUEST_EVENT, handleMermaidEditRequest);
  }, [
    activeTabReadOnly,
    documentRevisionPort,
    editor,
    rightSplitDocument,
    rightSplitEditor,
    rightSplitReadOnly,
    setActivePane,
    showStatus,
  ]);

  useEffect(() => {
    const handleBookmarkActivate = (event) => {
      const editorDom = event?.detail?.editorDom;
      if (!editorDom) return;
      if (editorDom === rightSplitEditor?.view?.dom) setActivePane("right");
      else if (editorDom === editor?.view?.dom) setActivePane("main");
      else return;
      setLeftSidebarCollapsed(false);
      setLeftSidebarMode("structure");
      setStructureMode("bookmarks");
    };
    window.addEventListener(PAPER_BOOKMARK_ACTIVATE_EVENT, handleBookmarkActivate);
    return () => window.removeEventListener(PAPER_BOOKMARK_ACTIVATE_EVENT, handleBookmarkActivate);
  }, [editor, rightSplitEditor, setActivePane]);

  const handleJumpBookmark = useCallback((bookmark) => {
    const targetEditor = activeWorkEditor;
    const maximum = targetEditor?.state?.doc?.content?.size || 0;
    const position = Math.max(0, Math.min(maximum, Number(bookmark?.position) + 1 || 0));
    if (!targetEditor || !targetEditor.chain().focus().setTextSelection(position).run()) return;
    window.requestAnimationFrame(() => {
      try {
        const target = targetEditor.view.domAtPos(position).node;
        const element = target.nodeType === (window.Node?.ELEMENT_NODE ?? 1)
          ? target
          : target.parentElement;
        element?.scrollIntoView?.({ block: "center", inline: "nearest" });
      } catch {
        // The document may have switched while the frame was pending.
      }
    });
  }, [activeWorkEditor]);

  const handleRemoveBookmark = useCallback((bookmark) => {
    if (!activeWorkEditor || activeWorkReadOnly) return false;
    return removeBookmark(activeWorkEditor, bookmark?.bookmarkId);
  }, [activeWorkEditor, activeWorkReadOnly]);

  const handleRenameBookmark = useCallback(async (bookmark) => {
    if (!activeWorkEditor || activeWorkReadOnly || !bookmark?.bookmarkId) return false;
    const nextLabel = await showPromptDialog({
      eyebrow: "正文书签",
      title: "编辑书签名称",
      message: "留空会恢复为正文摘要名称。",
      label: "书签名称",
      defaultValue: bookmark.label || "",
      placeholder: bookmark.context || "例如：关键结论",
      confirmLabel: "保存",
      maxLength: 200,
    });
    if (nextLabel === null) return false;
    const normalizedLabel = String(nextLabel).trim();
    const updated = updateBookmark(activeWorkEditor, bookmark.bookmarkId, {
      label: normalizedLabel,
    });
    if (updated) {
      showStatus(normalizedLabel ? "书签名称已更新" : "书签名称已清除", "success");
    }
    return updated;
  }, [activeWorkEditor, activeWorkReadOnly, showPromptDialog, showStatus]);

  const handleHistoryRestored = useCallback(async () => {
    const targetTabId = historyDialog.tabId;
    const targetTab = openTabsRef.current.find((tab) => tab.id === targetTabId);
    if (!targetTab?.path) return;
    const loaded = await bridge.openDocumentPath(targetTab.path);
    if (!loaded?.document) throw new Error("恢复已写入磁盘，但重新载入失败");
    const normalized = normalizeDocument(loaded.document, letterTemplates);
    const nextTabs = openTabsRef.current.map((tab) => (
      tab.id === targetTabId
        ? {
          ...tab,
          document: normalized,
          dirty: false,
          externalChanged: false,
          diskRevision: loaded.diskRevision || tab.diskRevision,
          recoveryRevision: null,
        }
        : tab
    ));
    documentStorePort.commitOpenTabs(nextTabs);
    documentRevisionPort.commitDiskRevision(
      targetTabId,
      loaded.diskRevision || targetTab.diskRevision || null,
    );
    documentDirtyPort.markClean(targetTabId);
    if (targetTabId === activeTabIdRef.current) {
      applyDocument(normalized, targetTab.path, false);
    } else if (targetTabId === rightSplitTabIdRef.current) {
      await rightPaneEditorHydrator.hydrate({
        comments: normalized.comments,
        html: normalized.html || "<p></p>",
      });
    }
    setHistoryDialog({ open: false, tabId: "" });
    showStatus("已恢复所选版本；恢复前安全版本已固定保留", "success");
  }, [
    applyDocument,
    documentDirtyPort,
    documentRevisionPort,
    documentStorePort,
    historyDialog.tabId,
    letterTemplates,
    rightPaneEditorHydrator,
    showStatus,
  ]);

  const handleSaveWritingAssistance = useCallback(async (nextConfig) => {
    const serialized = serializeWritingAssistanceConfig(nextConfig);
    const saved = bridge.saveWritingAssistance
      ? await bridge.saveWritingAssistance(serialized)
      : serialized;
    const normalized = normalizeWritingAssistanceConfig(saved || serialized);
    setWritingAssistanceConfig(normalized);
    setWritingAssistanceDraft(normalized);
    showStatus("写作检查设置已保存", "success");
  }, [showStatus]);

  const handleApplyImportedPreferences = useCallback((preferences) => {
    const next = normalizeProfilePreferencesPatch(preferences);
    if (Object.hasOwn(next, "newDocumentTemplateId")) {
      setNewDocumentTemplateId(next.newDocumentTemplateId);
    }
    if (next.leftSidebarMode) setLeftSidebarMode(next.leftSidebarMode);
    if (next.structureMode) setStructureMode(next.structureMode);
    if (Object.hasOwn(next, "leftSidebarCollapsed")) {
      setLeftSidebarCollapsed(next.leftSidebarCollapsed);
    }
    if (Object.hasOwn(next, "documentSplitRatio")) {
      setDocumentPaneRatio(next.documentSplitRatio);
    }
  }, [
    setDocumentPaneRatio,
    setNewDocumentTemplateId,
  ]);

  const handleApplyImportedTemplates = useCallback((templates) => {
    const value = templates && typeof templates === "object" ? templates : {};
    const importedTemplates = Array.isArray(templates)
      ? templates
      : (Array.isArray(value.templates) ? value.templates : value.userLetterTemplates);
    if (Array.isArray(importedTemplates)) setUserLetterTemplates(importedTemplates);
    const importedGroups = value.groups || value.userTemplateGroups;
    if (Array.isArray(importedGroups)) setUserTemplateGroups(importedGroups);
    if (typeof value.newDocumentTemplateId === "string") {
      setNewDocumentTemplateId(value.newDocumentTemplateId);
    }
  }, [
    setNewDocumentTemplateId,
    setUserLetterTemplates,
    setUserTemplateGroups,
  ]);

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

  const handleCreateFolderInTree = workspaceFileMutationPort.createFolder;
  const handleCreateDocumentInTree = workspaceFileMutationPort.createDocument;
  const handleRenameTreeEntry = workspaceFileMutationPort.renameEntry;
  const handleGuardedRenameTreeEntry = useCallback((entry, ...args) => {
    const entryPath = typeof entry === "string" ? entry : entry?.path;
    if (entryPath && (isCollaborationPathLocked(entryPath) || collaborationLockedPaths.some((lockedPath) => pathIsSameOrInside(lockedPath, entryPath)))) {
      showStatus("涉及 AI 协作审阅的信笺或目录不能重命名", "warning");
      return false;
    }
    return handleRenameTreeEntry(entry, ...args);
  }, [collaborationLockedPaths, isCollaborationPathLocked, showStatus, workspaceFileMutationPort]);
  const handleBackupTreeDocument = workspaceFileMutationPort.backupDocument;

  const handleDeleteTreeEntry = useCallback(async (entry, interaction = {}) => {
    if (!entry?.path) {
      return;
    }
    if (isCollaborationPathLocked(entry.path) || collaborationLockedPaths.some((lockedPath) => pathIsSameOrInside(lockedPath, entry.path))) {
      showStatus("涉及 AI 协作审阅的信笺或目录不能删除", "warning");
      return;
    }
    const fallbackFolderPath = folderStateRef.current.path;
    const initiallyAffected = openTabsRef.current.filter((tab) => pathIsSameOrInside(tab.path, entry.path));
    const affectedIds = initiallyAffected.map((tab) => tab.id);
    const barrier = await documentPersistenceController.diskMutationBarrierPort.acquire(affectedIds);
    try {
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
      const result = await workspaceFileMutationPort.deleteOnDisk(entry);
      if (!result) return;
      await workspaceFileMutationPort.commitDeleteResult({
        entry,
        fallbackFolderPath,
        result,
        snapshot,
      });
    } finally {
      barrier.release();
    }
  }, [collaborationLockedPaths, documentPersistenceController, isCollaborationPathLocked, showConfirmDialog, showStatus, snapshotLiveTabs, workspaceFileMutationPort]);

  const handleMoveTreeEntry = workspaceFileMutationPort.moveEntry;
  const handleGuardedMoveTreeEntry = useCallback((entry, ...args) => {
    const entryPath = typeof entry === "string" ? entry : entry?.path;
    if (entryPath && (isCollaborationPathLocked(entryPath) || collaborationLockedPaths.some((lockedPath) => pathIsSameOrInside(lockedPath, entryPath)))) {
      showStatus("涉及 AI 协作审阅的信笺或目录不能移动", "warning");
      return false;
    }
    return handleMoveTreeEntry(entry, ...args);
  }, [collaborationLockedPaths, isCollaborationPathLocked, showStatus, workspaceFileMutationPort]);
  const handleToggleFolder = workspaceFileNavigationPort.toggleFolder;

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

  const handleSave = documentPersistenceController.save;

  useEffect(() => (
    documentPersistenceControllerRef.current?.startLifecycle({
      resolveController: () => documentPersistenceControllerRef.current,
    })
  ), []);

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
    aiCollaborationPending: Boolean(pendingCollaborationOwner),
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

  const handleSelectAiMode = useCallback(async (kind) => {
    if (kind !== "compose") {
      return requestAiModeChange(kind);
    }
    if (aiMode) {
      const exited = await requestExitAiMode();
      if (exited === false) return false;
    }
    setAiModeChooserOpen(false);
    setCompositionWorkspaceOpen(true);
    return true;
  }, [aiMode, requestAiModeChange, requestExitAiMode, setAiModeChooserOpen]);

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
  const openResearchPreviewView = useCallback(
    (options) => {
      prepareSecondaryPanePageView();
      return workspaceResearchViewsPort.openResearchPreviewView(
        options,
        { snapshotTabs: snapshotLiveTabs },
      );
    },
    [
      prepareSecondaryPanePageView,
      snapshotLiveTabs,
      workspaceResearchViewsPort,
    ],
  );
  const researchViewsPort = {
    closeActiveResearchView: workspaceResearchViewsPort.closeActiveResearchView,
    getOpenResearchViews: workspaceResearchViewsPort.getOpenResearchViews,
    hasOpenResearchViewsForLibrary: workspaceResearchViewsPort.hasOpenResearchViewsForLibrary,
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

  const handleOpenResearchSearchResult = useCallback(async (result) => {
    const libraryId = researchRootRef.current?.libraryId || "";
    if (!libraryId || !result) return;
    const query = String(result.query || researchSearch.query || "").trim();
    const searchTarget = {
      requestId: researchSearch.requestId || `research-open-${Date.now().toString(36)}`,
      query,
      page: Math.max(1, Math.trunc(Number(result.page) || 1)),
      matchIndex: Math.max(0, Math.trunc(Number(result.matchIndex) || 0)),
      matchStart: Number.isFinite(Number(result.matchStart)) ? Number(result.matchStart) : null,
      matchField: String(result.matchField || ""),
    };
    const web = result.kind === "web" || result.type === "web";
    let item;
    if (web) {
      const sourceId = String(result.sourceId || result.id || "");
      const existing = librarySourcesRef.current.find((source) => source.id === sourceId);
      item = {
        ...(existing || {}),
        id: sourceId,
        type: "web",
        title: result.title || existing?.title || result.url || "未命名网页",
        url: result.url || existing?.url || "",
        scopeKey: result.scopeKey || existing?.scopeKey || "global",
      };
    } else {
      const relativePath = String(result.relativePath || "");
      if (!relativePath) return;
      const name = relativePath.replace(/\\/g, "/").split("/").pop() || relativePath;
      item = {
        type: "file",
        kind: "file",
        name,
        fileName: name,
        relativePath,
        previewKind: result.previewKind || "",
        size: result.size,
        mtimeMs: result.mtimeMs || result.modifiedAt,
        title: result.title || name,
      };
    }
    const openedTarget = await openIndependentResearchItem(item, { searchTarget });
    if (!web && (result.previewKind === "document" || /\.(?:letterpaper|paperdoc)$/i.test(item.relativePath)) && openedTarget) {
      setPendingResearchDocumentSearch({ ...searchTarget, tabId: openedTarget });
    }
    closeSearch();
  }, [closeSearch, librarySourcesRef, openIndependentResearchItem, researchRootRef, researchSearch.query, researchSearch.requestId]);


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

  const refreshPublicCitationSources = usePublicCitationLibrary({
    documentPort: knowledgeDocumentPort,
    setPublicCitationLibraryLoading,
    setPublicCitationSources,
    showStatus,
  });

  useWorkspaceCitationLibraryLifecycle({
    leftSidebarMode,
    refreshPublicCitationSources,
    refreshWorkspaceCitationSources,
    structureMode,
  });

  const handleResearchViewStateChange = useCallback(
    (viewId, viewState) => commitResearchViewState(viewId, viewState),
    [commitResearchViewState],
  );

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
  } = useCitationActions({
    activeWorkReadOnly,
    citationOrder,
    citationPicker,
    citationSourceDialog,
    documentPort: knowledgeDocumentPort,
    knowledgeReferences,
    publicCitationSources,
    refreshPublicCitationSources,
    refreshWorkspaceCitationSources,
    researchPort: knowledgeResearchPort,
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

  const createAiApplySafetySnapshot = useCallback(async (name = "AI 应用前") => {
    if (typeof bridge.createDocumentHistory !== "function") {
      throw new Error("当前版本不支持本地安全版本");
    }
    const document = getSaveDocument();
    const documentId = String(document?.documentId || "").trim();
    if (!documentId) {
      throw new Error("当前信笺缺少文档身份");
    }
    const result = await bridge.createDocumentHistory({
      documentId,
      document,
      name,
      pinned: false,
    });
    if (!result?.ok || !result?.entry) {
      throw new Error("本地安全版本创建失败");
    }
    return result;
  }, [getSaveDocument]);

  const {
    beginManualAiApply,
    cancelAiApplyPreview,
    cancelManualAiApply,
    confirmAiApplyPreview,
    stageAiApplyPreview,
  } = useAiApplyPreviewActions({
    aiApplyPreview,
    createSafetySnapshot: createAiApplySafetySnapshot,
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

  const getAiCollaborationOverlays = useCallback(() => (
    snapshotLiveTabs().filter((tab) => tab.path && tab.document).map((tab) => ({
      path: tab.path,
      document: tab.document,
      revision: String(documentRevisionPort.readLiveRevision(tab.id) || ""),
    }))
  ), [documentRevisionPort, snapshotLiveTabs]);
  const {
    acceptAllPendingCollaboration,
    collaborationBusy,
    collaborationPendingQuestion,
    collaborationStartedAt,
    collaborationStatusText,
    commitCollaborationReview,
    discardCollaborationReview,
    sendAiCollaboration,
    stopAiCollaboration,
    updateCollaborationOperation,
  } = useAiCollaborationActions({
    activeTabId,
    activeTabReadOnly,
    aiChatInput,
    aiChatMessages,
    aiStatus,
    applyTitle: handleTitleChange,
    createSafetySnapshot: createAiApplySafetySnapshot,
    currentPath,
    editor,
    effectiveAiConfig,
    getActiveDocumentKey,
    getActiveDocumentSnapshot,
    getSaveDocument,
    getWorkspaceOverlays: getAiCollaborationOverlays,
    handleSendAiChat,
    openDocumentPath: handleOpenFolderFile,
    showConfirmDialog,
    showStatus,
    updateChatState,
    updateChatStateForKey,
    writingWorkspaceRoot,
  });
  const pendingCollaborationProposalId = pendingCollaborationOwner?.pendingReview?.proposal?.id || "";
  const pendingCollaborationProposalStatus = pendingCollaborationOwner?.pendingReview?.proposal?.status || "";
  useEffect(() => {
    const pending = pendingCollaborationOwner?.pendingReview;
    const proposal = pending?.proposal;
    if (!pending || !proposal || proposal.status === "stale" || typeof bridge.validateAiCollaborationProposal !== "function") return undefined;
    const hasExternalSources = proposal.sources.some((source) => (
      source.relativePath && source.documentId !== proposal.base.documentId
    ));
    if (!hasExternalSources) return undefined;
    let active = true;
    bridge.validateAiCollaborationProposal({
      workspaceRoot: pending.workspaceRoot,
      currentDocumentId: proposal.base.documentId,
      sources: proposal.sources,
      overlays: getAiCollaborationOverlays(),
    }).then((result) => {
      if (!active || !result?.stale) return;
      updateChatStateForKey(pending.originDocumentKey, (chat) => {
        if (chat.pendingReview?.proposal?.id !== proposal.id) return chat;
        return {
          ...chat,
          pendingReview: {
            ...chat.pendingReview,
            proposal: { ...chat.pendingReview.proposal, status: "stale" },
          },
          error: result.message || "涉及信笺版本已变化，这份协作方案已过期",
        };
      });
    }).catch(() => {
      // A transient validation failure does not mutate the proposal; commit still fails closed.
    });
    return () => { active = false; };
  }, [
    getAiCollaborationOverlays,
    pendingCollaborationOwner,
    pendingCollaborationProposalId,
    pendingCollaborationProposalStatus,
    updateChatStateForKey,
  ]);
  const handleStopAiWork = useCallback(() => {
    if (collaborationBusy) return stopAiCollaboration();
    return handleStopAi();
  }, [collaborationBusy, handleStopAi, stopAiCollaboration]);
  const handleRegenerateCollaboration = useCallback(() => {
    const lastRequest = [...aiChatMessages].reverse().find((message) => message.role === "user")?.content || "";
    updateChatState((chat) => {
      if (!chat.pendingReview) return chat;
      const proposal = chat.pendingReview.proposal;
      return {
        ...chat,
        pendingReview: null,
        input: lastRequest,
        proposalSummaries: [...(chat.proposalSummaries || []), {
          id: proposal.id,
          status: "stale",
          summary: proposal.summary || proposal.reply,
          acceptedCount: 0,
          rejectedCount: proposal.operations.length,
          resolvedAt: Date.now(),
        }].slice(-20),
      };
    });
    showStatus("已基于原请求准备重新生成，请确认输入后发送", "success");
  }, [aiChatMessages, showStatus, updateChatState]);

  useEffect(() => {
    if (!activeCollaborationReview || activeCollaborationReview.proposal.status === "stale" || !editor?.state?.doc) {
      syncAiCollaborationReviewDecorations(editor, null);
      return;
    }
    const manifest = buildAiApplyBlockManifest(editor.state.doc);
    const originalTitle = activeCollaborationReview.proposal.sources
      .find((source) => source.documentId === activeCollaborationReview.proposal.base.documentId)?.title || documentState.title;
    const items = activeCollaborationReview.proposal.operations.map((operation) => {
      let decorationOperation;
      if (["replace_blocks", "insert_before", "insert_after"].includes(operation.type)) {
        decorationOperation = createCollaborationEditorOperation(operation, manifest);
      } else if (operation.type === "set_title") {
        decorationOperation = { action: "set_title", from: 0, to: 0, title: operation.title };
      } else if (operation.type === "create_document") {
        decorationOperation = {
          action: "create_document",
          from: editor.state.doc.content.size,
          to: editor.state.doc.content.size,
          html: collaborationBlocksToSafeHtml(operation.blocks),
          title: operation.title,
          fileName: operation.fileName,
          folderRelativePath: operation.folderRelativePath,
        };
      }
      const reviewText = operation.blocks ? collaborationBlocksToReviewText(operation.blocks) : undefined;
      const editFields = operation.type === "set_title"
        ? [{ key: "title", label: "拟应用标题", value: operation.title }]
        : operation.type === "create_document"
          ? [
              { key: "title", label: "派生信笺标题", value: operation.title },
              { key: "fileName", label: "文件名", value: operation.fileName },
              { key: "folderRelativePath", label: "工作区内目标文件夹", value: operation.folderRelativePath },
            ]
          : [];
      return {
        id: operation.id,
        label: operation.label,
        decision: operation.decision,
        editable: true,
        editFields,
        manifest,
        operation: decorationOperation,
        originalTitle,
        reviewRevision: operation.reviewRevision,
        reviewText,
        onDecision: (decision) => updateCollaborationOperation(operation.id, {
          decision,
          selected: decision === "accepted",
        }),
        onSave: ({ fields, reviewText: nextReviewText }) => {
          try {
            const patch = { ...fields, edited: true };
            if (typeof nextReviewText === "string") {
              const blocks = parseCollaborationReviewText(nextReviewText);
              if (!blocks.length && !operation.sourceBlockIds?.length && !operation.sourceDocumentIds?.length) {
                throw new Error("拟应用内容不能为空");
              }
              patch.blocks = blocks;
            }
            updateCollaborationOperation(operation.id, patch);
            return { ok: true };
          } catch (error) {
            showStatus(error?.message || "拟应用内容格式无效", "warning");
            return { ok: false, message: error?.message || "拟应用内容格式无效" };
          }
        },
      };
    })
      .filter((item) => item.operation);
    syncAiCollaborationReviewDecorations(editor, items.length ? {
      id: activeCollaborationReview.proposal.id,
      items,
    } : null);
    return () => syncAiCollaborationReviewDecorations(editor, null);
  }, [activeCollaborationReview, documentState.title, editor]);

  const measuredWorkSurfaceWidth = workSurfaceWidth || Math.max(1, window.innerWidth - (leftSidebarCollapsed ? 0 : 330));
  const secondaryGroupOpen = workspaceGroups.secondary.views.length > 0;
  const mainSpreadViewActive = mainPageViewState.mode === PAGE_VIEW_MODES.SPREAD;
  const secondaryGroupVisible = secondaryGroupOpen && !immersiveMode && !mainSpreadViewActive;
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
  const historyTargetTab = historyDialog.open
    ? openTabs.find((tab) => tab.id === historyDialog.tabId) || null
    : null;
  const historyTargetDocument = historyTargetTab?.id === activeTabId
    ? getSaveDocument()
    : (historyTargetTab?.id === rightSplitTabId
      ? getRightSplitSaveDocument()
      : historyTargetTab?.document);
  const historyTargetRevision = historyTargetTab
    ? (documentRevisionPort.readDiskRevision(historyTargetTab.id)
      || historyTargetTab.diskRevision
      || null)
    : null;
  const documentContextTargetTab = documentContextMenu
    ? openTabs.find((tab) => tab.id === documentContextMenu.tabId) || null
    : null;
  const documentContextTargetView = documentContextMenu
    ? workspaceGroups[documentContextMenu.groupId]?.views?.find(
      (view) => view.viewId === documentContextMenu.viewId,
    ) || null
    : null;
  const documentContextMoveTarget = documentContextMenu?.groupId === WORKSPACE_GROUP_ID.SECONDARY
    ? WORKSPACE_GROUP_ID.PRIMARY
    : WORKSPACE_GROUP_ID.SECONDARY;
  const documentContextMoveAllowed = documentContextMoveTarget === WORKSPACE_GROUP_ID.PRIMARY
    || (
      workspaceGroups.primary.views.length > 1
      && (
        !documentContextMenu?.tabId
        || getPageViewStateForTab(documentContextMenu.tabId).mode !== PAGE_VIEW_MODES.SPREAD
      )
    );
  const researchWebViewSuspended = Boolean(
    webSourceDialog.open
    || webCopyDialog.open
    || confirmDialog
    || promptDialog
    || linkDialog
    || Boolean(settingsDialog.section)
    || tabTemplateDialog.open
    || helpOpen
    || helpAssistantOpen
    || releaseNotesOpen
    || exportDialogOpen
    || internalLinkPicker
    || citationPicker
    || footnoteDialog.open
    || citationSourceDialog.open
    || historyDialog.open
    || compositionWorkspaceOpen
    || emojiPicker.open
    || Boolean(professionalUi.kind),
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
        onOpenProfileMigration={() => openSettingsSection("profile")}
        onInsertImage={handleInsertImage}
        onInsertAudio={() => handleInsertMedia("audio")}
        onInsertVideo={() => handleInsertMedia("video")}
        onOpenLinkDialog={handleOpenLinkDialog}
        onInsertInternalLink={handleOpenInternalLinkPicker}
        onInsertFootnote={handleAddFootnote}
        onInsertEmoji={handleOpenEmojiPicker}
        onInsertCodeBlock={handleInsertCodeBlock}
        onInsertMath={() => openProfessionalUi("math", { mode: "inline" })}
        onInsertMermaid={() => openProfessionalUi("mermaid")}
        onInsertBookmark={handleInsertBookmark}
        onOpenCitationPicker={handleOpenCitationPicker}
        onOpenHelp={handleOpenHelpCenter}
        onOpenHelpAssistant={handleOpenHelpAssistant}
        onOpenSettings={openSettingsSection}
        helpTriggerRef={helpTriggerRef}
        settingsTriggerRef={settingsTriggerRef}
        elementsTriggerRef={elementsTriggerRef}
        exportTriggerRef={exportTriggerRef}
        onOpenSearch={openSearch}
        researchSearchAvailable={Boolean(researchRoot?.available && researchRoot?.libraryId)}
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
            onRenameEntry={handleGuardedRenameTreeEntry}
            onBackupDocument={handleBackupTreeDocument}
            onDeleteEntry={handleDeleteTreeEntry}
            onMoveEntry={handleGuardedMoveTreeEntry}
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
                  readOnly: activeWorkReadOnly,
                   onJumpFootnote: handleJumpFootnote,
                   onEditFootnote: handleEditFootnote,
                   onDeleteFootnote: handleDeleteFootnote,
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
                writingProps={{
                  issues: splitPaneActive
                    ? writingIssuesByEditor.right
                    : writingIssuesByEditor.main,
                  enabled: writingAssistanceConfig.enabled,
                  editorLabel: splitPaneActive ? "右侧正文" : "当前正文",
                  settingsButtonRef: writingSettingsTriggerRef,
                  onOpenSettings: () => openSettingsSection("writing"),
                  onIgnoreOnce: (issue) => (
                    writingAssistanceSessions[splitPaneActive ? "right" : "main"]
                      .ignoreOnce(issue.id)
                  ),
                  onReplaceOnce: (issue) => (
                    writingAssistanceSessions[splitPaneActive ? "right" : "main"]
                      .replaceOnce(issue.id)
                  ),
                  onReplaceAll: (issue) => (
                    writingAssistanceSessions[splitPaneActive ? "right" : "main"]
                      .replaceAll(issue.id)
                  ),
                  onJump: (issue) => (
                    writingAssistanceSessions[splitPaneActive ? "right" : "main"]
                      .jumpTo(issue.id)
                  ),
                }}
                citationLibraryProps={{
                  privateSources: structureWorkDocument?.citationSources || [],
                  publicSources: publicCitationSources,
                  citationOrder,
                  citationStyle: structureWorkDocument?.citationStyle,
                  loading: citationLibraryLoading || publicCitationLibraryLoading,
                  privateReadOnly: activeWorkReadOnly,
                  onStyleChange: (citationStyle) => {
                    knowledgeDocumentPort.updateActive((document) => ({
                      ...document,
                      citationStyle,
                    }));
                   },
                   onEditSource: handleEditCitationSource,
                   onAddSource: handleAddCitationSource,
                   onDeleteSource: handleDeleteCitationSource,
                   onCopyToPublic: handleCopyCitationToPublic,
                   onAttachPublic: handleAttachPublicCitation,
                   onImportSources: handleImportCitationSources,
                   onJumpCitationSource: handleJumpCitationSource,
                   onOpenExternal: (url) => bridge.openExternal?.(url),
                 }}
                bookmarkProps={{
                   editor: structureWorkEditor,
                   readOnly: activeWorkReadOnly,
                   onJump: handleJumpBookmark,
                   onRename: handleRenameBookmark,
                   onDelete: handleRemoveBookmark,
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
                    status={collaborationBusy ? "streaming" : aiStatus}
                    messages={aiChatMessages}
                    hasState={Boolean(aiChatMessages.length || aiChatInput || aiChatSelections.length || aiError || pendingCollaborationOwner)}
                    codexImageMode={aiChatCodexImageMode}
                    frozen={Boolean(pendingCollaborationOwner)}
                    onProviderChange={setAiSelectedProvider}
                    onCodexImageModeChange={handleCodexImageModeChange}
                    onStop={handleStopAiWork}
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
                  onOpenHistory={handleOpenDocumentHistory}
                  onSetPageViewMode={handleSetDocumentPageViewMode}
                  getPageViewState={getPageViewStateForTab}
                  canMoveDocument={(view, targetGroupId) => (
                    workspaceGroups.primary.views.length > 1
                    && (
                      targetGroupId !== WORKSPACE_GROUP_ID.SECONDARY
                      || getPageViewStateForTab(view.tabId).mode !== PAGE_VIEW_MODES.SPREAD
                    )
                  )}
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
                  onOpenHistory={handleOpenDocumentHistory}
                  onSetPageViewMode={handleSetDocumentPageViewMode}
                  getPageViewState={getPageViewStateForTab}
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
                onOpenHistory={handleOpenDocumentHistory}
                onSetPageViewMode={handleSetDocumentPageViewMode}
                getPageViewState={getPageViewStateForTab}
                canMoveDocument={(view, targetGroupId) => (
                  workspaceGroups.primary.views.length > 1
                  && (
                    targetGroupId !== WORKSPACE_GROUP_ID.SECONDARY
                    || getPageViewStateForTab(view.tabId).mode !== PAGE_VIEW_MODES.SPREAD
                  )
                )}
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
              {pendingCollaborationOwner ? (
                <div className="ai-collaboration-lock-banner" role="status">
                  <span>{activeCollaborationReview ? "AI 协作审阅中：涉及信笺已冻结，逐项确认后再提交" : "另一封信笺有待完成的 AI 协作审阅"}</span>
                  {!activeCollaborationReview ? <button type="button" onClick={() => handleSelectTab(pendingCollaborationOwner.tabId)}>返回审阅</button> : null}
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
                readOnly={activeTabReadOnly || activeTabCollaborationLocked || (aiMode && aiStatus === "streaming") || collaborationBusy || Boolean(aiApplyPreview)}
                aiCaptureEnabled={aiMode && aiChatMode && !pendingCollaborationOwner}
                onCaptureAiSelection={handleCaptureAiChatSelection}
                selectionAiEnabled={!aiMode && !aiApplyPreview}
                onOpenSelectionAi={(selection, anchor) => openSelectionAiForPane("main", selection, anchor)}
                comments={aiMode ? [] : documentState.comments}
                activeCommentId={commentPanel?.pane === "main" ? commentPanel.commentId : ""}
                commentsHidden={aiMode || printMode || imageExportMode}
                onCreateComment={aiMode ? undefined : ((selection, position) => handleStartComment("main", selection, position))}
                onOpenComment={aiMode ? undefined : ((comment, position) => handleOpenComment("main", comment, position))}
                onEditLink={aiMode ? undefined : handleEditLinkFromCanvas}
                canvasRef={mainCanvasRef}
                pageViewEnabled={!aiMode}
                pageViewState={mainPageViewState}
                onPageViewStateChange={handleMainPageViewStateChange}
                contextMenuEnabled={!aiMode}
                onDocumentContextMenu={(event) => handleOpenCanvasDocumentContext(event, "main")}
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
                      readOnly={rightSplitReadOnly || rightSplitCollaborationLocked}
                      selectionAiEnabled={!aiMode}
                      onOpenSelectionAi={(selection, anchor) => openSelectionAiForPane("right", selection, anchor)}
                      comments={rightSplitDocument.comments}
                      activeCommentId={commentPanel?.pane === "right" ? commentPanel.commentId : ""}
                      commentsHidden={aiMode || printMode || imageExportMode}
                      onCreateComment={(selection, position) => handleStartComment("right", selection, position)}
                      onOpenComment={(comment, position) => handleOpenComment("right", comment, position)}
                      onEditLink={handleEditLinkFromCanvas}
                      canvasRef={rightCanvasRef}
                      pageViewState={rightPageViewState}
                      onPageViewStateChange={handleRightPageViewStateChange}
                      onDocumentContextMenu={(event) => handleOpenCanvasDocumentContext(event, "right")}
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
                    onOpenTranslationSettings={() => openAiSettings({ panel: "tasks", taskId: "researchTranslation" })}
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
                  collaborationBusy={collaborationBusy}
                  collaborationFrozen={Boolean(pendingCollaborationOwner)}
                  collaborationPendingQuestion={collaborationPendingQuestion}
                  collaborationStartedAt={collaborationStartedAt}
                  collaborationStatusText={collaborationStatusText}
                  pendingReview={activeCollaborationReview}
                  onAcceptAllPendingCollaboration={acceptAllPendingCollaboration}
                  onInputChange={(input) => updateChatState({ input })}
                  onSend={sendAiCollaboration}
                  onCommitCollaboration={commitCollaborationReview}
                  onDiscardCollaboration={discardCollaborationReview}
                  onRegenerateCollaboration={handleRegenerateCollaboration}
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
      {searchMode === "research" ? (
        <ResearchSearchPalette
          query={researchSearch.query}
          loading={researchSearch.loading}
          results={researchSearch.results}
          error={researchSearch.error}
          libraryName={researchRoot?.rootName || researchRoot?.name || "当前资料区"}
          progress={researchSearch.progress}
          showProgress={researchSearch.showProgress}
          warnings={researchSearch.warnings}
          onQueryChange={researchSearch.setQuery}
          onOpenResult={handleOpenResearchSearchResult}
          onCancel={researchSearch.cancel}
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
      <DocumentHistoryDialog
        open={Boolean(historyDialog.open && historyTargetDocument)}
        bridge={bridge}
        document={historyTargetDocument}
        filePath={historyTargetTab?.path || ""}
        diskRevision={historyTargetRevision}
        returnFocusRef={historyReturnFocusRef}
        onClose={() => setHistoryDialog({ open: false, tabId: "" })}
        onPrepareOperation={handlePrepareDocumentHistoryOperation}
        onRestored={handleHistoryRestored}
        showConfirmDialog={showConfirmDialog}
        onError={(error) => showStatus(
          `版本历史操作失败：${error?.message || error}`,
          "warning",
        )}
      />
      <DocumentContextMenu
        menu={!aiMode && documentContextTargetTab && documentContextTargetView ? documentContextMenu : null}
        title={documentContextTargetTab?.title || "当前信笺"}
        pageViewMode={documentContextTargetTab
          ? getPageViewStateForTab(documentContextTargetTab.id).mode
          : PAGE_VIEW_MODES.CONTINUOUS}
        moveTarget={documentContextMoveTarget}
        moveAllowed={documentContextMoveAllowed}
        onSetPageViewMode={(mode) => handleSetDocumentPageViewMode(
          {
            ...documentContextTargetView,
            tabId: documentContextTargetTab?.id,
          },
          mode,
          documentContextMenu?.groupId,
        )}
        onOpenHistory={() => handleOpenDocumentHistory(
          documentContextTargetTab?.id,
          documentContextMenu?.groupId === WORKSPACE_GROUP_ID.SECONDARY
            ? rightSplitEditor?.view?.dom
            : editor?.view?.dom,
        )}
        onOpenTemplate={() => handleOpenGroupTabTemplate(
          {
            ...documentContextTargetView,
            tabId: documentContextTargetTab?.id,
          },
          documentContextMenu?.groupId === WORKSPACE_GROUP_ID.SECONDARY
            ? rightCanvasRef.current
            : mainCanvasRef.current,
        )}
        onMove={() => handleMoveGroupDocument(
          documentContextTargetView?.viewId,
          documentContextMoveTarget,
          null,
        )}
        onCloseDocument={() => handleCloseGroupView(
          documentContextMenu?.groupId,
          documentContextTargetView?.viewId,
        )}
        onDismiss={() => setDocumentContextMenu(null)}
      />
      <EmojiPicker
        open={emojiPicker.open}
        onSelect={handleSelectEmoji}
        onRequestClose={() => setEmojiPicker({ open: false, context: null })}
        returnFocusRef={elementsTriggerRef}
        editorFocusRef={{
          current: emojiPicker.context?.editor?.view?.dom || null,
        }}
      />
      <MathInsertDialog
        open={professionalUi.kind === "math"}
        editor={professionalUi.editor}
        initialValue={professionalUi.initialValue}
        update={
          professionalUi.updatePosition !== null
          && Number.isFinite(Number(professionalUi.updatePosition))
        }
        updatePosition={professionalUi.updatePosition}
        onSubmit={handleInsertMathDraft}
        onClose={closeProfessionalUi}
      />
      <MermaidInsertDialog
        open={professionalUi.kind === "mermaid"}
        editor={professionalUi.editor}
        initialValue={professionalUi.initialValue}
        update={
          professionalUi.updatePosition !== null
          && Number.isFinite(Number(professionalUi.updatePosition))
        }
        updatePosition={professionalUi.updatePosition}
        onSubmit={handleInsertMermaidDraft}
        onClose={closeProfessionalUi}
      />
      <KnowledgeReferencePopover popover={knowledgeReferencePopover} onClose={closeKnowledgeReferencePopover} />
      <AiModeChooser
        open={aiModeChooserOpen}
        anchorRef={aiModeTriggerRef}
        activeMode={aiModeKind}
        configured={aiHasUsableProvider}
        compositionAvailable={Boolean(bridge.isElectron)}
        onSelectMode={handleSelectAiMode}
        onExitMode={requestExitAiMode}
        onOpenSettings={openAiSettings}
        onClose={() => setAiModeChooserOpen(false)}
      />
      <AiSettingsDialog
        open={settingsDialog.section === "ai"}
        initialPanel={settingsDialog.aiInitialPanel || "provider"}
        initialTaskId={settingsDialog.aiInitialTaskId || ""}
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
      {settingsDialog.section === "writing" ? (
        <div
          className="settings-feature-overlay dialog-scrim"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSettings();
          }}
        >
          <section
            ref={writingSettingsDialogRef}
            className="settings-feature-dialog writing-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="writing-settings-dialog-title"
            aria-describedby="writing-settings-dialog-description"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              closeSettings();
            }}
          >
            <header className="settings-feature-dialog-header">
              <div className="writing-settings-titlecopy">
                <span className="writing-settings-title-icon" aria-hidden="true"><SpellCheck2 size={19} /></span>
                <div>
                  <h2 id="writing-settings-dialog-title">检查设置</h2>
                  <p id="writing-settings-dialog-description">管理当前设备上的拼写、白名单与用词规范</p>
                </div>
              </div>
              <button ref={writingSettingsCloseRef} type="button" onClick={closeSettings} aria-label="关闭检查设置">
                <X size={18} />
              </button>
            </header>
            <div className="writing-settings-dialog-body">
              <WritingAssistanceSettings
                initialFocusRef={writingSettingsInitialFocusRef}
                value={writingAssistanceDraft}
                onChange={setWritingAssistanceDraft}
              />
            </div>
            <footer className="settings-feature-dialog-footer">
              <button type="button" onClick={closeSettings}>取消</button>
              <button
                type="button"
                className="settings-primary"
                onClick={() => void handleSaveWritingAssistance(writingAssistanceDraft).then(closeSettings)}
              >
                <Save size={15} />保存设置
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {settingsDialog.section === "profile" ? (
        <div
          className="settings-feature-overlay dialog-scrim dialog-scrim--large"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSettings();
          }}
        >
          <section
            ref={profileDialogRef}
            className="settings-feature-dialog profile-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-settings-dialog-title"
            aria-describedby="profile-settings-dialog-description"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              closeSettings();
            }}
          >
            <header className="settings-feature-dialog-header">
              <div className="writing-settings-titlecopy">
                <span className="writing-settings-title-icon" aria-hidden="true"><PackageOpen size={19} /></span>
                <div>
                  <h2 id="profile-settings-dialog-title">备份与迁移</h2>
                  <p id="profile-settings-dialog-description">安全导入或导出当前设备的可移植配置</p>
                </div>
              </div>
              <button ref={profileDialogCloseRef} type="button" onClick={closeSettings} aria-label="关闭备份与迁移">
                <X size={18} />
              </button>
            </header>
            <div className="profile-settings-dialog-body">
              <ProfileMigrationPanel
                bridge={bridge}
                preferences={createPortableProfilePreferences({
                  newDocumentTemplateId,
                  leftSidebarMode,
                  structureMode,
                  leftSidebarCollapsed,
                  documentSplitRatio: workspaceGroups.splitRatio,
                })}
                templates={{
                  templates: userLetterTemplates,
                  groups: userTemplateGroups,
                  newDocumentTemplateId,
                }}
                onApplyPreferences={handleApplyImportedPreferences}
                onApplyTemplates={handleApplyImportedTemplates}
                onClose={closeSettings}
                onError={(error) => showStatus(
                  `配置迁移失败：${error?.message || error}`,
                  "warning",
                )}
              />
            </div>
          </section>
        </div>
      ) : null}
      <SelectionAiPopover
        controller={selectionAi}
        onRequestCloseSession={requestCloseSelectionAiSession}
        onRequestCloseAll={requestCloseAllSelectionAiSessions}
      />
      {!aiMode ? (
        <>
          <SelectionAiSprite
            controller={selectionAi}
            tabId={activeTabId}
            anchorRef={mainCanvasRef}
          />
          {activeSecondaryView?.kind === WORKSPACE_VIEW_KIND.DOCUMENT && rightSplitTabId ? (
            <SelectionAiSprite
              controller={selectionAi}
              tabId={rightSplitTabId}
              anchorRef={rightCanvasRef}
            />
          ) : null}
        </>
      ) : null}
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
        initialTopicId={helpTargetTopicId}
        returnFocusRef={helpTriggerRef}
      />
      <HelpAssistantDialog
        open={helpAssistantOpen}
        aiConfig={aiConfig}
        returnFocusRef={helpTriggerRef}
        onClose={() => setHelpAssistantOpen(false)}
        onOpenSettings={handleOpenHelpAssistantSettings}
        onOpenHelpTopic={handleOpenHelpAssistantSource}
        onRequestDelete={handleDeleteHelpAssistantSession}
        onStatus={showStatus}
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
      {compositionWorkspaceOpen ? (
        <div
          className="ai-composition-overlay"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) event.stopPropagation();
          }}
        >
          <AiCompositionWorkspace
            bridge={bridge}
            sourceCandidates={compositionSourceCandidates}
            sourceDocument={compositionSourceDocument}
            onBack={() => setCompositionWorkspaceOpen(false)}
            onComplete={handleCompositionComplete}
            onError={(error) => showStatus(
              `AI 起稿失败：${error?.message || error}`,
              "warning",
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
