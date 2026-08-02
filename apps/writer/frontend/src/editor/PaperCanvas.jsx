import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent } from "@tiptap/react";
import {
  DEFAULT_PAGE_VIEW_STATE,
  PAGE_VIEW_MODES,
  PageViewToolbar,
  PaginatedSurface,
  normalizePageViewState,
  reducePageViewState,
} from "../pagination/index.js";
import { handleEditorLinkClick } from "./commands.js";
import {
  canUseElectronDocumentContextMenu,
  installElectronDocumentContextMenuBridge,
} from "./document-context-menu-bridge.js";
import { CommentAnchors, CommentHighlights } from "./CommentOverlays.jsx";
import { syncHeadingNumberingDefaults } from "./decorations.js";
import { PageArticle } from "./PageArticle.jsx";
import { getPaperPresentation } from "./paper-presentation.js";
import { SelectionBubbleToolbar } from "./SelectionBubbleToolbar.jsx";
import { TableContextToolbar } from "./TableContextToolbar.jsx";

export function PaperCanvas({
  editor,
  document,
  letterTemplates,
  printMode,
  imageExportMode,
  onTitleChange,
  onAuthorChange,
  onDateChange,
  savedSelectionRef,
  className = "",
  readOnly = false,
  aiCaptureEnabled = false,
  onCaptureAiSelection,
  selectionAiEnabled = false,
  onOpenSelectionAi,
  comments = [],
  activeCommentId = "",
  commentsHidden = false,
  onCreateComment,
  onOpenComment,
  onEditLink,
  onActivate,
  canvasRef,
  pageViewEnabled = true,
  pageViewState = DEFAULT_PAGE_VIEW_STATE,
  onPageViewStateChange,
  onDocumentContextMenu,
  contextMenuEnabled = true,
}) {
  const fallbackCanvasRef = useRef(null);
  const resolvedCanvasRef = canvasRef || fallbackCanvasRef;
  const pageWheelDeltaRef = useRef(0);
  const pageWheelLockUntilRef = useRef(0);
  const pageWheelResetTimerRef = useRef(null);
  const [pageMap, setPageMap] = useState(() => ({
    generation: 0,
    pageCount: 1,
    pages: [],
    positionToPage: () => 1,
  }));
  const [pageToolbarCollapsed, setPageToolbarCollapsed] = useState(false);
  const { selectedTemplate, presentation, paperStyle } = useMemo(() => getPaperPresentation(document, letterTemplates), [document, letterTemplates]);
  const normalizedPageViewState = normalizePageViewState(pageViewState, pageMap.pageCount);
  const paginated = pageViewEnabled
    && !printMode
    && !imageExportMode
    && normalizedPageViewState.mode !== PAGE_VIEW_MODES.CONTINUOUS;
  const layoutPageViewState = pageViewEnabled
    ? normalizedPageViewState
    : { ...normalizedPageViewState, mode: PAGE_VIEW_MODES.CONTINUOUS };
  const headingNumberingOne = presentation.headingNumbering[1];
  const headingNumberingTwo = presentation.headingNumbering[2];
  const headingNumberingThree = presentation.headingNumbering[3];
  const headingNumberingFour = presentation.headingNumbering[4];
  useEffect(() => {
    syncHeadingNumberingDefaults(editor, {
      1: headingNumberingOne,
      2: headingNumberingTwo,
      3: headingNumberingThree,
      4: headingNumberingFour,
    });
  }, [editor, headingNumberingFour, headingNumberingOne, headingNumberingThree, headingNumberingTwo]);
  useEffect(() => {
    const syncEmbeddedControls = () => {
      const canvas = resolvedCanvasRef.current;
      if (!canvas) return;
      canvas.querySelectorAll(".image-size-tools button:not(.image-copy-reference), .media-size-tools button").forEach((button) => {
        button.disabled = readOnly;
      });
      canvas.querySelectorAll(".paper-image-caption").forEach((field) => {
        field.readOnly = readOnly;
      });
    };
    syncEmbeddedControls();
    const frame = window.requestAnimationFrame(syncEmbeddedControls);
    return () => window.cancelAnimationFrame(frame);
  }, [document.documentId, editor, readOnly, resolvedCanvasRef]);
  useEffect(() => {
    setPageMap({
      generation: 0,
      pageCount: 1,
      pages: [],
      positionToPage: () => 1,
    });
  }, [document.documentId, editor]);
  useEffect(() => installElectronDocumentContextMenuBridge({
    bridge: typeof window !== "undefined" ? window.paperWriter : null,
    getCanvas: () => resolvedCanvasRef.current,
    onContextMenu: contextMenuEnabled ? onDocumentContextMenu : undefined,
  }), [contextMenuEnabled, onDocumentContextMenu, resolvedCanvasRef]);
  const handlePageMapChange = useCallback((nextPageMap) => {
    if (!nextPageMap) return;
    setPageMap(nextPageMap);
  }, []);
  const handlePageViewStateChange = useCallback((nextState) => {
    const next = normalizePageViewState(nextState, pageMap.pageCount);
    const restoreContinuousScroll = normalizedPageViewState.mode !== PAGE_VIEW_MODES.CONTINUOUS
      && next.mode === PAGE_VIEW_MODES.CONTINUOUS;
    onPageViewStateChange?.(next);
    if (restoreContinuousScroll && editor && typeof window !== "undefined") {
      const selectionHead = editor.state.selection.head;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          try {
            const target = editor.view.domAtPos(selectionHead).node;
            const element = target.nodeType === (window.Node?.ELEMENT_NODE ?? 1)
              ? target
              : target.parentElement;
            element?.scrollIntoView?.({ block: "center", inline: "nearest" });
          } catch {
            // A concurrent document switch invalidates the old selection position.
          }
        });
      });
    }
  }, [
    editor,
    normalizedPageViewState.mode,
    onPageViewStateChange,
    pageMap.pageCount,
  ]);
  useEffect(() => {
    const canvas = resolvedCanvasRef.current;
    if (!canvas || !paginated) return undefined;
    const resetWheelDelta = () => {
      pageWheelDeltaRef.current = 0;
      if (pageWheelResetTimerRef.current) {
        window.clearTimeout(pageWheelResetTimerRef.current);
        pageWheelResetTimerRef.current = null;
      }
    };
    const handleWheel = (event) => {
      if (
        event.defaultPrevented
        || event.ctrlKey
        || event.metaKey
        || event.altKey
        || Math.abs(event.deltaY) <= Math.abs(event.deltaX)
        || event.target?.closest?.(
          ".page-view-toolbar, input, textarea, select, button, [role='dialog'], [role='menu']",
        )
      ) {
        return;
      }
      event.preventDefault();
      const now = Date.now();
      if (now < pageWheelLockUntilRef.current) return;
      const deltaScale = event.deltaMode === 1
        ? 16
        : (event.deltaMode === 2 ? Math.max(320, canvas.clientHeight) : 1);
      pageWheelDeltaRef.current += event.deltaY * deltaScale;
      if (pageWheelResetTimerRef.current) {
        window.clearTimeout(pageWheelResetTimerRef.current);
      }
      pageWheelResetTimerRef.current = window.setTimeout(resetWheelDelta, 140);
      if (Math.abs(pageWheelDeltaRef.current) < 48) return;
      const action = pageWheelDeltaRef.current > 0 ? "next" : "previous";
      const nextState = reducePageViewState(
        normalizedPageViewState,
        { type: action },
        pageMap.pageCount,
      );
      resetWheelDelta();
      if (nextState.currentPage === normalizedPageViewState.currentPage) return;
      pageWheelLockUntilRef.current = now + 280;
      canvas.scrollTop = 0;
      handlePageViewStateChange(nextState);
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      resetWheelDelta();
    };
  }, [
    handlePageViewStateChange,
    normalizedPageViewState.currentPage,
    normalizedPageViewState.mode,
    normalizedPageViewState.zoom,
    normalizedPageViewState.zoomMode,
    pageMap.pageCount,
    paginated,
    resolvedCanvasRef,
  ]);

  const editorSurface = (
    <PageArticle
      document={document}
      selectedTemplate={selectedTemplate}
      presentation={presentation}
      paperStyle={paperStyle}
      showHeader
      readOnly={readOnly}
      onTitleChange={onTitleChange}
      onAuthorChange={onAuthorChange}
      onDateChange={onDateChange}
    >
      <EditorContent editor={editor} />
      <CommentHighlights
        editor={editor}
        comments={comments}
        activeCommentId={activeCommentId}
        hidden={commentsHidden}
      />
      <CommentAnchors
        editor={editor}
        comments={comments}
        activeCommentId={activeCommentId}
        hidden={commentsHidden}
        onOpenComment={onOpenComment}
      />
    </PageArticle>
  );

  return (
    <main
      ref={resolvedCanvasRef}
      className={[
        printMode ? "canvas print-mode" : "canvas",
        readOnly ? "read-only" : "",
        paginated ? `has-paginated-editor page-view-${normalizedPageViewState.mode}` : "",
        className,
      ].filter(Boolean).join(" ")}
      onPointerDown={onActivate}
      onFocusCapture={onActivate}
      onContextMenu={(event) => {
        if (printMode || imageExportMode) return;
        if (!contextMenuEnabled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (canUseElectronDocumentContextMenu(window.paperWriter)) return;
        onDocumentContextMenu?.(event);
      }}
      onClick={(event) => handleEditorLinkClick(event, {
        editor,
        disabled: printMode || imageExportMode || readOnly,
        onEditLink,
      })}
    >
      <SelectionBubbleToolbar
        editor={editor}
        disabled={printMode || imageExportMode}
        readOnly={readOnly}
        savedSelectionRef={savedSelectionRef}
        aiCaptureEnabled={aiCaptureEnabled}
        onCaptureAiSelection={onCaptureAiSelection}
        selectionAiEnabled={selectionAiEnabled}
        onOpenSelectionAi={onOpenSelectionAi}
        onCreateComment={onCreateComment}
      />
      <TableContextToolbar editor={editor} disabled={printMode || imageExportMode || readOnly} />
      {paginated ? (
        <PageViewToolbar
          state={normalizedPageViewState}
          pageCount={pageMap.pageCount}
          showModes={false}
          collapsed={pageToolbarCollapsed}
          onCollapsedChange={setPageToolbarCollapsed}
          onChange={handlePageViewStateChange}
        />
      ) : null}
      <div className={paginated ? "paper-viewport paginated-paper-viewport" : "paper-viewport"}>
        {!printMode && !imageExportMode ? (
          <PaginatedSurface
            editor={editor}
            state={layoutPageViewState}
            pageMap={pageMap}
            paperStyle={paperStyle}
            rootRef={resolvedCanvasRef}
            onPageMapChange={handlePageMapChange}
            onStateChange={handlePageViewStateChange}
          >
            {editorSurface}
          </PaginatedSurface>
        ) : (
          editorSurface
        )}
      </div>
    </main>
  );
}
