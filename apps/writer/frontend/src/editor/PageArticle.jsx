import { DOCUMENT_TITLE_MAX_CHARS } from "../content-limits.js";
import { normalizeDocumentId } from "../document-schema-v2.js";
import { DEFAULT_TEMPLATE_PRESENTATION, normalizeTemplatePresentation } from "../templates/index.js";
import { formatPaperDate } from "./paper-date.js";

export { formatPaperDate } from "./paper-date.js";

export function estimateAuthorWidth(author) {
  const value = author || "署名";
  const width = Array.from(value).reduce((total, character) => (
    total + (/[\u3400-\u9fff]/.test(character) ? 1.05 : 0.56)
  ), 0);
  return `${Math.max(0.76, Math.min(12, width + 0.2))}em`;
}

export function PageArticle({ document, selectedTemplate, presentation = DEFAULT_TEMPLATE_PRESENTATION, paperStyle, children, className = "", showHeader = false, customHeaderLayout = false, readOnly = false, onTitleChange, onAuthorChange, onDateChange }) {
  const authorText = document.author?.trim() || "";
  const authorWidth = estimateAuthorWidth(authorText);
  const displayDate = document.displayDate || formatPaperDate(document.createdAt);
  const normalizedPresentation = normalizeTemplatePresentation(presentation);
  const showDocumentTitle = showHeader && normalizedPresentation.showDocumentTitle;
  const showSignatureDate = showHeader && normalizedPresentation.showSignatureDate;
  const hasVisibleHeader = showDocumentTitle || showSignatureDate;
  const usesHeaderLayout = hasVisibleHeader || customHeaderLayout;
  const presentationClasses = [
    usesHeaderLayout ? "has-paper-header" : "without-paper-header",
    showDocumentTitle ? "shows-document-title" : "hides-document-title",
    showSignatureDate ? "shows-signature-date" : "hides-signature-date",
    normalizedPresentation.indentParagraphs ? "indents-paragraphs" : "flush-paragraphs",
    normalizedPresentation.showImageCaptions ? "shows-image-captions" : "hides-image-captions",
    normalizedPresentation.numberImageCaptions ? "numbers-image-captions" : "plain-image-captions",
  ];

  return (
    <article
      className={`paper-sheet template-${document.customBackground ? "custom" : document.templateId} ${presentationClasses.join(" ")} ${className}`}
      data-paper-document-id={normalizeDocumentId(document.documentId)}
      style={paperStyle}
    >
      {hasVisibleHeader ? (
        <header className="paper-header">
          {showDocumentTitle ? (
            <input
              className="paper-title-input"
              value={document.title}
              readOnly={readOnly}
              onChange={(event) => onTitleChange?.(event.target.value)}
              maxLength={DOCUMENT_TITLE_MAX_CHARS}
              aria-label="文章标题"
              placeholder="未命名信笺"
              spellCheck={false}
            />
          ) : null}
          {showSignatureDate ? (
            <p className="paper-meta-line">
              <input
                className="paper-author-input"
                value={document.author || ""}
                readOnly={readOnly}
                onChange={(event) => onAuthorChange?.(event.target.value)}
                aria-label="作者署名"
                placeholder="署名"
                spellCheck={false}
                style={{ width: authorWidth }}
              />
              <span className="paper-meta-prefix">写于</span>
              <input
                className="paper-date-input"
                value={displayDate}
                readOnly={readOnly}
                onChange={(event) => onDateChange?.(event.target.value)}
                aria-label="写作日期"
                spellCheck={false}
              />
            </p>
          ) : null}
        </header>
      ) : null}
      {children}
    </article>
  );
}
