import { useEffect, useMemo } from "react";
import { EditorContent } from "@tiptap/react";
import { handleEditorLinkClick } from "./commands.js";
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
  comments = [],
  activeCommentId = "",
  commentsHidden = false,
  onCreateComment,
  onOpenComment,
  onEditLink,
  onActivate,
  canvasRef,
}) {
  const { selectedTemplate, presentation, paperStyle } = useMemo(() => getPaperPresentation(document, letterTemplates), [document, letterTemplates]);
  const headingNumberingOne = presentation.headingNumbering[1];
  const headingNumberingTwo = presentation.headingNumbering[2];
  const headingNumberingThree = presentation.headingNumbering[3];
  useEffect(() => {
    syncHeadingNumberingDefaults(editor, {
      1: headingNumberingOne,
      2: headingNumberingTwo,
      3: headingNumberingThree,
    });
  }, [editor, headingNumberingOne, headingNumberingThree, headingNumberingTwo]);
  useEffect(() => {
    const syncEmbeddedControls = () => {
      const canvas = canvasRef?.current;
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
  }, [canvasRef, document.documentId, editor, readOnly]);
  return (
    <main
      ref={canvasRef}
      className={[printMode ? "canvas print-mode" : "canvas", readOnly ? "read-only" : "", className].filter(Boolean).join(" ")}
      onPointerDown={onActivate}
      onFocusCapture={onActivate}
      onClick={(event) => handleEditorLinkClick(event, {
        editor,
        disabled: printMode || imageExportMode || readOnly,
        onEditLink,
      })}
    >
      <SelectionBubbleToolbar
        editor={editor}
        disabled={printMode || imageExportMode || readOnly}
        savedSelectionRef={savedSelectionRef}
        aiCaptureEnabled={aiCaptureEnabled}
        onCaptureAiSelection={onCaptureAiSelection}
        onCreateComment={onCreateComment}
      />
      <TableContextToolbar editor={editor} disabled={printMode || imageExportMode || readOnly} />
      <div className="paper-viewport">
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
      </div>
    </main>
  );
}

