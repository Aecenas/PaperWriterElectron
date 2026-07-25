import { useCallback, useEffect, useRef } from "react";
import { BookOpen, LoaderCircle, ShieldAlert } from "lucide-react";
import { researchItemKind } from "./research-ui-model.js";
import EmbeddedWebResearch from "./research/EmbeddedWebResearch.jsx";
import { PdfReader, normalizePdfViewState, samePdfViewState } from "./research/PdfReader.jsx";
import StaticResearchPreview from "./research/StaticResearchPreview.jsx";
import UnsupportedResearchCard from "./research/UnsupportedResearchCard.jsx";
import { itemIdentity } from "./research/reader-utils.js";
import "./research-workspace.css";
import "./secondary-research-pane.css";

export { PdfReader, normalizePdfViewState, samePdfViewState };

export default function SecondaryResearchPane({
  item = null,
  loading = false,
  error = "",
  pdfLoader,
  previewLoader,
  viewState = null,
  defaultViewState = null,
  onViewStateChange,
  onOpenExternal,
  onShowInFolder,
  onCreateCitation,
  onEditSource,
  onPdfStateChange,
  viewId = "",
  onActivate,
  webViewSuspended = false,
}) {
  const kind = researchItemKind(item);
  const activeItemKey = itemIdentity(item);
  const onPdfStateChangeRef = useRef(onPdfStateChange);
  useEffect(() => {
    onPdfStateChangeRef.current = onPdfStateChange;
  }, [onPdfStateChange]);
  useEffect(() => {
    const restoredPage = kind === "pdf"
      ? normalizePdfViewState(viewState ?? defaultViewState).page
      : 1;
    onPdfStateChangeRef.current?.({ page: restoredPage, pageCount: 0, itemKey: activeItemKey });
  }, [activeItemKey, kind]);
  const handlePdfPageChange = useCallback((page, pageCount) => {
    onPdfStateChangeRef.current?.({ page, pageCount, itemKey: activeItemKey });
  }, [activeItemKey]);

  return (
    <aside className="secondary-research-pane" aria-label="资料阅读区" aria-busy={loading || undefined}>
      <div className={["secondary-research-body", kind === "pdf" ? "is-pdf" : "", kind === "web" ? "is-web" : "", ["docx", "markdown", "text", "table", "image"].includes(kind) ? "is-static" : ""].filter(Boolean).join(" ")}>
        {loading ? <div className="secondary-research-state" role="status"><LoaderCircle className="research-spin" size={19} /><span>正在读取资料…</span></div> : null}
        {!loading && error ? <div className="secondary-research-state is-error" role="alert"><ShieldAlert size={20} /><span>{error}</span></div> : null}
        {!loading && !error && kind === "empty" ? <div className="secondary-research-state"><BookOpen size={25} /><span>从左侧资料区选择一份资料。</span></div> : null}
        {!loading && !error && kind === "pdf" ? (
          <PdfReader
            source={item}
            loadPdf={pdfLoader}
            onOpenExternal={onOpenExternal}
            onShowInFolder={onShowInFolder}
            onPageChange={handlePdfPageChange}
            viewState={viewState}
            defaultViewState={defaultViewState}
            onViewStateChange={onViewStateChange}
          />
        ) : null}
        {!loading && !error && kind === "web" ? <EmbeddedWebResearch item={item} viewId={viewId} suspended={webViewSuspended} onActivate={onActivate} onOpenExternal={onOpenExternal} /> : null}
        {!loading && !error && ["docx", "markdown", "text", "table", "image"].includes(kind) ? <StaticResearchPreview item={item} loadPreview={previewLoader} onOpenExternal={onOpenExternal} onShowInFolder={onShowInFolder} /> : null}
        {!loading && !error && kind === "unsupported" ? <UnsupportedResearchCard item={item} onShowInFolder={onShowInFolder} /> : null}
      </div>
    </aside>
  );
}

export { clampResearchPaneWidth, researchItemKind } from "./research-ui-model.js";
