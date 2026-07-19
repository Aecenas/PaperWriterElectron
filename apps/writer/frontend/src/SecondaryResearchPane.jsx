import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  FolderOpen,
  Image,
  Link2,
  LoaderCircle,
  Maximize2,
  Pencil,
  RefreshCw,
  ScanLine,
  Search,
  ShieldAlert,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { bridge } from "./bridge.js";
import {
  formatResearchFileSize,
  formatResearchModifiedAt,
  getResearchEntryKey,
  researchItemKind,
  sourceDisplayName,
} from "./research-ui-model.js";
import {
  countPreviewSearchMatches,
  normalizePreviewSearchQuery,
  parseDelimitedPreview,
  segmentPreviewSearch,
  spreadsheetColumnLabel,
} from "./research-preview-model.js";
import "./research-workspace.css";
import "./secondary-research-pane.css";

const MIN_PDF_SCALE = 0.35;
const MAX_PDF_SCALE = 2.5;
const PDF_ZOOM_STEP = 0.12;
const PDF_SCROLL_COMMIT_DELAY = 120;
const PDF_HORIZONTAL_CHROME = 42;
const MIN_STATIC_SCALE = 0.6;
const MAX_STATIC_SCALE = 2;
const STATIC_SCALE_STEP = 0.1;
const MAX_PREVIEW_SEARCH_MATCHES = 5000;

const DEFAULT_PDF_VIEW_STATE = Object.freeze({
  page: 1,
  zoomMode: "fit",
  scale: 1,
  scrollLeft: 0,
  scrollTop: 0,
});

function itemIdentity(item) {
  return String(item?.id || item?.sourceId || getResearchEntryKey(item) || item?.url || "");
}

function normalizePdfBytes(payload) {
  const bytes = payload?.bytes ?? payload;
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (Array.isArray(bytes)) return new Uint8Array(bytes);
  return null;
}

function clampPdfScale(value) {
  return Math.max(MIN_PDF_SCALE, Math.min(MAX_PDF_SCALE, Number(value) || 1));
}

function clampStaticScale(value) {
  return Math.max(MIN_STATIC_SCALE, Math.min(MAX_STATIC_SCALE, Number(value) || 1));
}

function nonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function normalizePdfViewState(value = null) {
  const source = value && typeof value === "object" ? value : DEFAULT_PDF_VIEW_STATE;
  const providedScale = source.scale ?? source.zoom;
  const page = Math.max(1, Math.trunc(Number(source.page) || DEFAULT_PDF_VIEW_STATE.page));
  const zoomMode = source.zoomMode === "manual" || (source.zoomMode !== "fit" && providedScale != null)
    ? "manual"
    : "fit";
  return {
    page,
    zoomMode,
    scale: clampPdfScale(providedScale ?? DEFAULT_PDF_VIEW_STATE.scale),
    scrollLeft: nonNegativeNumber(source.scrollLeft),
    scrollTop: nonNegativeNumber(source.scrollTop),
  };
}

export function samePdfViewState(left, right) {
  const a = normalizePdfViewState(left);
  const b = normalizePdfViewState(right);
  return a.page === b.page
    && a.zoomMode === b.zoomMode
    && a.scale === b.scale
    && a.scrollLeft === b.scrollLeft
    && a.scrollTop === b.scrollTop;
}

function isTextEntryTarget(target) {
  const tagName = String(target?.tagName || "").toLocaleLowerCase("en-US");
  return tagName === "input"
    || tagName === "textarea"
    || tagName === "select"
    || Boolean(target?.isContentEditable)
    || Boolean(target?.closest?.("[contenteditable='true']"));
}

export function PdfReader({
  source,
  loadPdf,
  onOpenExternal,
  onShowInFolder,
  onPageChange,
  viewState = null,
  defaultViewState = null,
  onViewStateChange,
}) {
  const initialViewState = normalizePdfViewState(viewState ?? defaultViewState);
  const stageRef = useRef(null);
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const searchInputRef = useRef(null);
  const pageDraftRef = useRef(String(initialViewState.page));
  const renderTaskRef = useRef(null);
  const loadTaskRef = useRef(null);
  const searchRunRef = useRef(0);
  const scrollRestoreFrameRef = useRef(0);
  const scrollCommitTimerRef = useRef(0);
  const scrollPositionRef = useRef({ scrollLeft: initialViewState.scrollLeft, scrollTop: initialViewState.scrollTop });
  const scrollingRef = useRef(false);
  const pendingScrollRef = useRef(null);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const viewSnapshotRef = useRef({ ...initialViewState, itemKey: itemIdentity(source) });
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(initialViewState.page);
  const [containerWidth, setContainerWidth] = useState(0);
  const [zoomMode, setZoomMode] = useState(initialViewState.zoomMode);
  const [manualScale, setManualScale] = useState(initialViewState.scale);
  const [renderedScale, setRenderedScale] = useState(initialViewState.scale);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const [pageDraft, setPageDraft] = useState(String(initialViewState.page));
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const sourceKey = itemIdentity(source);
  const pageCount = pdf?.numPages || 1;

  useEffect(() => {
    onViewStateChangeRef.current = onViewStateChange;
  }, [onViewStateChange]);

  const publishViewState = useCallback((patch) => {
    const base = viewSnapshotRef.current?.itemKey === sourceKey
      ? viewSnapshotRef.current
      : { ...normalizePdfViewState(viewState ?? defaultViewState), itemKey: sourceKey };
    const next = { ...normalizePdfViewState({ ...base, ...patch }), itemKey: sourceKey };
    if (samePdfViewState(base, next)) return;
    viewSnapshotRef.current = next;
    onViewStateChangeRef.current?.(normalizePdfViewState(next));
  }, [defaultViewState, sourceKey, viewState]);

  const applyPendingScroll = useCallback(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    const pending = pendingScrollRef.current;
    if (!viewport || !canvas?.width || !pending) return false;
    pendingScrollRef.current = null;
    scrollPositionRef.current = {
      scrollLeft: nonNegativeNumber(pending.scrollLeft),
      scrollTop: nonNegativeNumber(pending.scrollTop),
    };
    viewport.scrollTo({
      left: scrollPositionRef.current.scrollLeft,
      top: scrollPositionRef.current.scrollTop,
      behavior: "auto",
    });
    return true;
  }, []);

  const schedulePendingScroll = useCallback(() => {
    window.cancelAnimationFrame(scrollRestoreFrameRef.current);
    scrollRestoreFrameRef.current = window.requestAnimationFrame(() => {
      scrollRestoreFrameRef.current = 0;
      applyPendingScroll();
    });
  }, [applyPendingScroll]);

  useEffect(() => {
    let disposed = false;
    let loadedDocument = null;
    let loadingTask = null;
    const controller = new AbortController();
    const restoredViewState = normalizePdfViewState(viewState ?? defaultViewState);
    searchRunRef.current += 1;
    window.cancelAnimationFrame(scrollRestoreFrameRef.current);
    window.clearTimeout(scrollCommitTimerRef.current);
    scrollingRef.current = false;
    setPdf(null);
    setPage(restoredViewState.page);
    pageDraftRef.current = String(restoredViewState.page);
    setPageDraft(String(restoredViewState.page));
    setZoomMode(restoredViewState.zoomMode);
    setManualScale(restoredViewState.scale);
    setRenderedScale(restoredViewState.scale);
    pendingScrollRef.current = restoredViewState;
    scrollPositionRef.current = { scrollLeft: restoredViewState.scrollLeft, scrollTop: restoredViewState.scrollTop };
    viewSnapshotRef.current = { ...restoredViewState, itemKey: sourceKey };
    setSearchOpen(false);
    setQuery("");
    setSearchMessage("");
    setError("");
    setStatus("loading");
    (async () => {
      try {
        if (typeof loadPdf !== "function") throw new Error("尚未连接 PDF 读取服务");
        const payload = await loadPdf(source, { signal: controller.signal });
        if (disposed) return;
        const bytes = normalizePdfBytes(payload);
        if (!bytes?.byteLength) throw new Error(payload?.message || "无法读取 PDF 文件");
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        if (disposed) return;
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({ data: bytes });
        loadTaskRef.current = loadingTask;
        loadedDocument = await loadingTask.promise;
        if (disposed) return;
        setPdf(loadedDocument);
        setStatus("ready");
      } catch (loadError) {
        if (!disposed && loadError?.name !== "AbortError") {
          setStatus("error");
          setError(loadError?.message || "PDF 加载失败");
        }
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
      searchRunRef.current += 1;
      if (scrollingRef.current) {
        const current = viewSnapshotRef.current;
        const next = normalizePdfViewState({ ...current, ...scrollPositionRef.current });
        if (!samePdfViewState(current, next)) onViewStateChangeRef.current?.(next);
      }
      scrollingRef.current = false;
      window.cancelAnimationFrame(scrollRestoreFrameRef.current);
      window.clearTimeout(scrollCommitTimerRef.current);
      renderTaskRef.current?.cancel?.();
      if (loadTaskRef.current === loadingTask) loadTaskRef.current = null;
      loadingTask?.destroy?.();
      if (!loadingTask) loadedDocument?.destroy?.();
    };
  }, [loadPdf, sourceKey]); // source object changes should not reload the same PDF

  useEffect(() => {
    if (!viewState || typeof viewState !== "object") return;
    if (scrollingRef.current) return;
    const controlled = normalizePdfViewState(viewState);
    const current = viewSnapshotRef.current?.itemKey === sourceKey
      ? viewSnapshotRef.current
      : { ...normalizePdfViewState(defaultViewState), itemKey: sourceKey };
    // The parent persists every reader-originated change and returns it through
    // `viewState`. Treat that identical value as an acknowledgement instead of
    // restoring the viewport again; scrollTo -> scroll -> publish otherwise
    // forms a controlled-component feedback loop in Chromium.
    if (samePdfViewState(current, controlled)) return;
    setPage((value) => (value === controlled.page ? value : controlled.page));
    pageDraftRef.current = String(controlled.page);
    setPageDraft(String(controlled.page));
    setZoomMode((value) => (value === controlled.zoomMode ? value : controlled.zoomMode));
    setManualScale((value) => (value === controlled.scale ? value : controlled.scale));
    pendingScrollRef.current = controlled;
    viewSnapshotRef.current = { ...controlled, itemKey: sourceKey };
    schedulePendingScroll();
  }, [
    defaultViewState,
    schedulePendingScroll,
    sourceKey,
    viewState?.page,
    viewState?.scale,
    viewState?.zoom,
    viewState?.zoomMode,
    viewState?.scrollLeft,
    viewState?.scrollTop,
  ]);

  useEffect(() => {
    if (status !== "ready" || !stageRef.current) return undefined;
    const stage = stageRef.current;
    let frame = 0;
    const publishWidth = (value) => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setContainerWidth((current) => {
          const next = Math.max(0, Math.round(Number(value) || 0));
          return Math.abs(next - current) < 2 ? current : next;
        });
      });
    };
    const readAvailableWidth = () => Math.max(0, stage.clientWidth - PDF_HORIZONTAL_CHROME);
    publishWidth(readAvailableWidth());
    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => publishWidth(readAvailableWidth());
      window.addEventListener("resize", handleResize);
      return () => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener("resize", handleResize);
      };
    }
    const observer = new ResizeObserver(() => {
      publishWidth(readAvailableWidth());
    });
    observer.observe(stage);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [status]);

  useEffect(() => {
    if (status !== "ready") return undefined;
    const frame = window.requestAnimationFrame(() => {
      const activeElement = window.document.activeElement;
      const shouldFocusReader = !activeElement
        || activeElement === window.document.body
        || Boolean(activeElement.closest?.("[role='treeitem']"));
      if (shouldFocusReader) viewportRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sourceKey, status]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return undefined;
    let disposed = false;
    setError("");
    (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        if (disposed) return;
        const baseViewport = pdfPage.getViewport({ scale: 1 });
        const availableWidth = containerWidth > 0 ? containerWidth : baseViewport.width;
        const fitScale = clampPdfScale(availableWidth / Math.max(1, baseViewport.width));
        const scale = zoomMode === "fit" ? fitScale : clampPdfScale(manualScale);
        setRenderedScale((current) => (Math.abs(current - scale) < 0.001 ? current : scale));
        const renderViewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        const outputScale = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.ceil(renderViewport.width * outputScale);
        canvas.height = Math.ceil(renderViewport.height * outputScale);
        canvas.style.width = `${renderViewport.width}px`;
        canvas.style.height = `${renderViewport.height}px`;
        const context = canvas.getContext("2d", { alpha: false });
        renderTaskRef.current?.cancel?.();
        const task = pdfPage.render({
          canvasContext: context,
          viewport: renderViewport,
          transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
        });
        renderTaskRef.current = task;
        await task.promise;
        if (!disposed) schedulePendingScroll();
      } catch (renderError) {
        if (!disposed && renderError?.name !== "RenderingCancelledException") {
          setError(renderError?.message || "页面渲染失败");
        }
      }
    })();
    return () => {
      disposed = true;
      renderTaskRef.current?.cancel?.();
    };
  }, [containerWidth, manualScale, page, pdf, schedulePendingScroll, zoomMode]);

  useEffect(() => {
    if (!pdf || page <= pdf.numPages) return;
    const lastPage = Math.max(1, pdf.numPages);
    setPage(lastPage);
    pageDraftRef.current = String(lastPage);
    setPageDraft(String(lastPage));
    publishViewState({ page: lastPage, scrollLeft: 0, scrollTop: 0 });
  }, [page, pdf, publishViewState]);

  useEffect(() => {
    if (pdf) onPageChange?.(page, pdf.numPages);
  }, [onPageChange, page, pdf]);

  useEffect(() => {
    const current = viewSnapshotRef.current?.itemKey === sourceKey
      ? viewSnapshotRef.current
      : { ...normalizePdfViewState(viewState ?? defaultViewState), itemKey: sourceKey };
    viewSnapshotRef.current = {
      ...current,
      page,
      zoomMode,
      scale: zoomMode === "manual" ? manualScale : renderedScale,
      itemKey: sourceKey,
    };
  }, [defaultViewState, manualScale, page, renderedScale, sourceKey, viewState, zoomMode]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    const openPdfSearch = () => setSearchOpen(true);
    window.addEventListener("paper-pdf-find", openPdfSearch);
    return () => window.removeEventListener("paper-pdf-find", openPdfSearch);
  }, []);

  const goToPage = useCallback((nextPage) => {
    const requested = typeof nextPage === "function" ? nextPage(page) : Number(nextPage) || 1;
    const resolvedPage = Math.max(1, Math.min(pdf?.numPages || 1, requested));
    setPage(resolvedPage);
    pageDraftRef.current = String(resolvedPage);
    setPageDraft(String(resolvedPage));
    pendingScrollRef.current = { scrollLeft: 0, scrollTop: 0 };
    publishViewState({ page: resolvedPage, scrollLeft: 0, scrollTop: 0 });
    window.requestAnimationFrame(() => viewportRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }, [page, pdf?.numPages, publishViewState]);

  const commitPageDraft = useCallback((draftValue = pageDraftRef.current) => {
    const value = String(draftValue).trim();
    if (!/^\d+$/.test(value)) {
      pageDraftRef.current = String(page);
      setPageDraft(String(page));
      return;
    }
    goToPage(Math.max(1, Math.min(pageCount, Number(value))));
  }, [goToPage, page, pageCount]);

  const closePdfSearch = useCallback(() => {
    searchRunRef.current += 1;
    setSearchOpen(false);
    setQuery("");
    setSearchMessage("");
  }, []);

  const zoomBy = useCallback((delta) => {
    const nextScale = clampPdfScale((zoomMode === "fit" ? renderedScale : manualScale) + delta);
    setManualScale(nextScale);
    setZoomMode("manual");
    publishViewState({ zoomMode: "manual", scale: nextScale });
  }, [manualScale, publishViewState, renderedScale, zoomMode]);

  const fitToWidth = useCallback(() => {
    setZoomMode("fit");
    publishViewState({ zoomMode: "fit", scale: renderedScale });
  }, [publishViewState, renderedScale]);

  const handleViewportScroll = useCallback((event) => {
    const viewport = event.currentTarget;
    const scrollLeft = viewport.scrollLeft;
    const scrollTop = viewport.scrollTop;
    scrollPositionRef.current = { scrollLeft, scrollTop };
    scrollingRef.current = true;
    window.clearTimeout(scrollCommitTimerRef.current);
    scrollCommitTimerRef.current = window.setTimeout(() => {
      scrollingRef.current = false;
      publishViewState(scrollPositionRef.current);
    }, PDF_SCROLL_COMMIT_DELAY);
  }, [publishViewState]);

  const handleReaderKeyDown = useCallback((event) => {
    if (isTextEntryTarget(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLocaleLowerCase("en-US") === "f") {
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(true);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const focusedAction = event.target?.closest?.("button, a, [role='button']");
    if (focusedAction && (event.key === " " || event.key === "Spacebar")) return;
    let nextPage = null;
    if (event.key === "ArrowLeft" || event.key === "PageUp") nextPage = page - 1;
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " " || event.key === "Spacebar") nextPage = page + 1;
    if (event.key === "Home") nextPage = 1;
    if (event.key === "End") nextPage = pageCount;
    if (nextPage === null) return;
    event.preventDefault();
    event.stopPropagation();
    goToPage(nextPage);
  }, [goToPage, page, pageCount]);

  const searchPdf = useCallback(async () => {
    const needle = query.trim().toLocaleLowerCase("en-US");
    if (!pdf || !needle) {
      setSearchMessage(needle ? "PDF 尚未就绪" : "请输入要查找的文字");
      return;
    }
    const run = searchRunRef.current + 1;
    searchRunRef.current = run;
    setSearchMessage("正在搜索…");
    try {
      for (let offset = 1; offset <= pdf.numPages; offset += 1) {
        if (searchRunRef.current !== run) return;
        const candidate = ((page - 1 + offset) % pdf.numPages) + 1;
        const pdfPage = await pdf.getPage(candidate);
        const content = await pdfPage.getTextContent();
        const text = content.items.map((item) => item.str || "").join("");
        if (text.toLocaleLowerCase("en-US").includes(needle)) {
          goToPage(candidate);
          setSearchMessage(`已定位到第 ${candidate} 页`);
          return;
        }
      }
      if (searchRunRef.current === run) setSearchMessage("未找到匹配文字");
    } catch (searchError) {
      if (searchRunRef.current === run) setSearchMessage(searchError?.message || "搜索失败");
    }
  }, [goToPage, page, pdf, query]);

  if (status === "loading") {
    return <div className="secondary-research-state" role="status"><LoaderCircle className="research-spin" size={19} /><span>正在打开 PDF…</span></div>;
  }
  if (status === "error") {
    return (
      <div className="secondary-research-state is-error" role="alert">
        <ShieldAlert size={20} /><span>{error}</span>
        {onOpenExternal ? <button type="button" onClick={() => onOpenExternal(source)}>使用系统应用打开</button> : null}
      </div>
    );
  }

  return (
    <div className="secondary-pdf-reader" onKeyDown={handleReaderKeyDown}>
      <PreviewToolbar item={source} onOpenExternal={onOpenExternal} onShowInFolder={onShowInFolder} className="secondary-pdf-toolbar" ariaLabel="PDF 阅读控制">
        <button type="button" disabled={page <= 1} aria-label="上一页" title="上一页（← / PageUp）" onClick={() => goToPage(page - 1)}><ArrowLeft size={14} aria-hidden="true" /></button>
        <form className="secondary-pdf-page-form" onSubmit={(event) => { event.preventDefault(); commitPageDraft(event.currentTarget.elements[0]?.value); }}>
          <input
            value={pageDraft}
            inputMode="numeric"
            aria-label="当前 PDF 页码"
            onChange={(event) => { pageDraftRef.current = event.target.value; setPageDraft(event.target.value); }}
            onBlur={(event) => commitPageDraft(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                commitPageDraft(event.currentTarget.value);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                pageDraftRef.current = String(page);
                setPageDraft(String(page));
              }
            }}
          />
          <span aria-label={`共 ${pageCount} 页`}>/ {pageCount}</span>
        </form>
        <button type="button" disabled={page >= pageCount} aria-label="下一页" title="下一页（→ / PageDown / 空格）" onClick={() => goToPage(page + 1)}><ArrowRight size={14} aria-hidden="true" /></button>
        {searchOpen ? (
          <form className="secondary-preview-search" role="search" onSubmit={(event) => { event.preventDefault(); searchPdf(); }}>
            <input ref={searchInputRef} value={query} placeholder="搜索 PDF" aria-label="搜索 PDF 文字" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePdfSearch(); } }} />
            <button type="submit" aria-label="查找下一处" title="查找下一处"><Search size={13} aria-hidden="true" /></button>
          </form>
        ) : (
          <>
            <button type="button" aria-label="缩小 PDF" title="缩小" onClick={() => zoomBy(-PDF_ZOOM_STEP)}><ZoomOut size={14} aria-hidden="true" /></button>
            <span className="secondary-preview-toolbar-value">{Math.round(renderedScale * 100)}%</span>
            <button type="button" aria-label="PDF 适合宽度" title="适合宽度" aria-pressed={zoomMode === "fit"} onClick={fitToWidth}><ScanLine size={14} aria-hidden="true" /></button>
            <button type="button" aria-label="放大 PDF" title="放大" onClick={() => zoomBy(PDF_ZOOM_STEP)}><ZoomIn size={14} aria-hidden="true" /></button>
          </>
        )}
        <button type="button" className={searchOpen ? "is-active" : ""} aria-label={searchOpen ? "收起 PDF 搜索" : "展开 PDF 搜索"} title={searchOpen ? "收起搜索" : "搜索 PDF 文字"} aria-expanded={searchOpen} onClick={() => { if (searchOpen) closePdfSearch(); else setSearchOpen(true); }}>{searchOpen ? <X size={14} aria-hidden="true" /> : <Search size={14} aria-hidden="true" />}</button>
      </PreviewToolbar>
      <div ref={stageRef} className="secondary-pdf-stage">
        {error || searchMessage ? (
          <p className={["secondary-pdf-feedback", error ? "is-error" : ""].filter(Boolean).join(" ")} role={error ? "alert" : undefined} aria-live={error ? undefined : "polite"}>
            {error || searchMessage}
          </p>
        ) : null}
        <div
          ref={viewportRef}
          className="secondary-pdf-canvas-scroll"
          tabIndex={0}
          aria-label={`PDF 第 ${page} 页。可用方向键、PageUp、PageDown、空格、Home 和 End 翻页。`}
          onScroll={handleViewportScroll}
          onPointerDown={(event) => {
            if (event.button === 0 && !isTextEntryTarget(event.target)) event.currentTarget.focus({ preventScroll: true });
          }}
        >
          <canvas ref={canvasRef} role="img" aria-label={`PDF 第 ${page} 页`} />
        </div>
      </div>
    </div>
  );
}

function WebResearchCard({ item, onOpenExternal, onEditSource, onCreateCitation }) {
  return (
    <article className="secondary-research-card secondary-web-card">
      <div className="secondary-research-card-icon"><Link2 size={21} aria-hidden="true" /></div>
      <div className="secondary-research-card-copy">
        <strong>{sourceDisplayName(item)}</strong>
        <button type="button" className="secondary-web-url" onClick={() => onOpenExternal?.(item)}>{item.url}</button>
        {item.notes || item.excerpt ? <blockquote>{item.notes || item.excerpt}</blockquote> : <p>浏览器预览只显示来源卡，不嵌入可能受站点策略限制的远程页面。</p>}
      </div>
      <div className="secondary-research-card-actions">
        {onEditSource ? <button type="button" onClick={() => onEditSource(item)}><Pencil size={14} />编辑</button> : null}
        {onOpenExternal ? <button type="button" onClick={() => onOpenExternal(item)}><ExternalLink size={14} />浏览器打开</button> : null}
        {onCreateCitation ? <button type="button" onClick={() => onCreateCitation(item)}><BookOpen size={14} />添加为参考文献来源</button> : null}
      </div>
    </article>
  );
}

function webViewBounds(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) return null;
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

function EmbeddedWebResearch({ item, viewId, suspended = false, onActivate, onOpenExternal }) {
  const hostRef = useRef(null);
  const frameRef = useRef(0);
  const supported = Boolean(bridge.isElectron && bridge.showResearchWebView && bridge.updateResearchWebViewBounds);
  const [viewState, setViewState] = useState({
    url: item?.url || "",
    title: sourceDisplayName(item),
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: "",
  });

  useEffect(() => {
    setViewState((current) => ({ ...current, url: item?.url || "", title: sourceDisplayName(item), error: "" }));
  }, [item?.id, item?.title, item?.url]);

  useEffect(() => {
    if (!supported || !viewId || !item?.url) return undefined;
    if (suspended) {
      void bridge.hideResearchWebView?.(viewId);
      return undefined;
    }
    return bridge.onResearchWebViewState?.((payload = {}) => {
      if (payload.viewId !== viewId) return;
      setViewState((current) => ({ ...current, ...payload }));
      if (payload.focused) onActivate?.();
    });
  }, [item?.url, onActivate, supported, viewId]);

  useEffect(() => {
    if (!supported || !viewId || !item?.url) return undefined;
    if (suspended) return undefined;
    let disposed = false;
    const updateBounds = () => {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = window.requestAnimationFrame(() => {
        if (disposed) return;
        const bounds = webViewBounds(hostRef.current);
        if (bounds) void bridge.updateResearchWebViewBounds?.({ viewId, bounds, visible: true });
      });
    };
    const show = async () => {
      const bounds = webViewBounds(hostRef.current);
      if (!bounds) return;
      const result = await bridge.showResearchWebView?.({ viewId, url: item.url, bounds });
      if (!disposed && result?.unsupported) setViewState((current) => ({ ...current, unsupported: true }));
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateBounds) : null;
    if (hostRef.current) observer?.observe(hostRef.current);
    window.addEventListener("resize", updateBounds);
    window.addEventListener("scroll", updateBounds, true);
    void show();
    return () => {
      disposed = true;
      observer?.disconnect();
      window.cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", updateBounds);
      window.removeEventListener("scroll", updateBounds, true);
      void bridge.hideResearchWebView?.(viewId);
    };
  }, [item?.url, supported, suspended, viewId]);

  if (!supported || viewState.unsupported) {
    return <WebResearchCard item={item} onOpenExternal={onOpenExternal} />;
  }

  const control = (action) => {
    onActivate?.();
    void bridge.controlResearchWebView?.(viewId, action);
  };
  const currentUrl = viewState.url || item.url;
  return (
    <div className="secondary-web-browser">
      <div className="secondary-web-toolbar" role="toolbar" aria-label="网页浏览控制" onPointerDown={onActivate}>
        <button type="button" disabled={!viewState.canGoBack} onClick={() => control("back")} aria-label="后退" title="后退"><ArrowLeft size={15} /></button>
        <button type="button" disabled={!viewState.canGoForward} onClick={() => control("forward")} aria-label="前进" title="前进"><ArrowRight size={15} /></button>
        <button type="button" onClick={() => control(viewState.loading ? "stop" : "reload")} aria-label={viewState.loading ? "停止加载" : "刷新"} title={viewState.loading ? "停止加载" : "刷新"}>
          {viewState.loading ? <X size={15} /> : <RefreshCw size={15} />}
        </button>
        <input className="secondary-web-current-url" type="text" value={currentUrl} readOnly aria-label="当前网页地址" title={currentUrl} />
        <button type="button" onClick={() => onOpenExternal?.({ ...item, url: currentUrl })} aria-label="在系统浏览器中打开" title="在系统浏览器中打开"><ExternalLink size={15} /></button>
      </div>
      {viewState.error ? <p className="secondary-web-error" role="alert">{viewState.error}</p> : null}
      <div ref={hostRef} className="secondary-web-view-host" aria-label={`${sourceDisplayName(item)} 网页内容`} />
    </div>
  );
}

function PreviewToolbar({ item, onOpenExternal, onShowInFolder, children, className = "", ariaLabel = "资料预览控制" }) {
  return (
    <div className={["secondary-static-toolbar", className].filter(Boolean).join(" ")} role="toolbar" aria-label={ariaLabel}>
      <strong title={sourceDisplayName(item)}>{sourceDisplayName(item)}</strong>
      <span className="secondary-static-toolbar-spacer" />
      {children}
      {onOpenExternal ? <button type="button" onClick={() => onOpenExternal(item)} aria-label="使用系统应用打开" title="使用系统应用打开"><ExternalLink size={14} /></button> : null}
      {onShowInFolder ? <button type="button" onClick={() => onShowInFolder(item)} aria-label="在资源管理器中显示" title="在资源管理器中显示"><FolderOpen size={14} /></button> : null}
    </div>
  );
}

function PreviewSearchForm({ inputRef, query, matchCount, truncated, activeIndex, onQueryChange, onPrevious, onNext, onClose }) {
  const hasMatches = matchCount > 0;
  return (
    <form className="secondary-preview-search" role="search" onSubmit={(event) => { event.preventDefault(); onNext(); }}>
      <Search size={13} aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        placeholder="在资料中搜索"
        aria-label="搜索资料内容"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose?.(); } }}
      />
      <span aria-live="polite">{query ? `${hasMatches ? activeIndex + 1 : 0}/${matchCount}${truncated ? "+" : ""}` : ""}</span>
      <button type="button" disabled={!hasMatches} onClick={onPrevious} aria-label="上一个匹配" title="上一个匹配"><ChevronUp size={13} aria-hidden="true" /></button>
      <button type="submit" disabled={!hasMatches} aria-label="下一个匹配" title="下一个匹配"><ChevronDown size={13} aria-hidden="true" /></button>
    </form>
  );
}

function renderPreviewSearchText(value, query, cursor) {
  const result = segmentPreviewSearch(value, query, {
    startIndex: cursor.value,
    maxMatches: Math.max(0, MAX_PREVIEW_SEARCH_MATCHES - cursor.value),
  });
  cursor.value = result.nextIndex;
  cursor.truncated ||= result.truncated;
  return result.segments.map((segment, index) => segment.match ? (
    <mark
      key={`${segment.index}-${index}`}
      data-preview-search-index={segment.index}
      className={cursor.activeIndex === segment.index ? "is-active" : ""}
    >{segment.text}</mark>
  ) : <span key={`text-${index}`}>{segment.text}</span>);
}

function StaticResearchPreview({ item, loadPreview, onOpenExternal, onShowInFolder }) {
  const [status, setStatus] = useState("loading");
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [imageFit, setImageFit] = useState(true);
  const [imageScale, setImageScale] = useState(1);
  const [imageUrl, setImageUrl] = useState("");
  const [contentScale, setContentScale] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const contentRef = useRef(null);
  const markdownRef = useRef(null);
  const searchInputRef = useRef(null);
  const sourceKey = itemIdentity(item);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setStatus("loading");
    setPayload(null);
    setError("");
    setImageFit(true);
    setImageScale(1);
    setContentScale(1);
    setSearchOpen(false);
    setSearchQuery("");
    setActiveSearchIndex(0);
    (async () => {
      try {
        if (typeof loadPreview !== "function") throw new Error("尚未连接资料预览服务");
        const result = await loadPreview(item, { signal: controller.signal });
        if (disposed) return;
        setPayload(result);
        setStatus("ready");
      } catch (loadError) {
        if (!disposed && loadError?.name !== "AbortError") {
          setError(loadError?.message || "资料预览加载失败");
          setStatus("error");
        }
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [loadPreview, sourceKey]);

  useEffect(() => {
    if (payload?.previewKind !== "image") {
      setImageUrl("");
      return undefined;
    }
    const bytes = normalizePdfBytes(payload.bytes);
    if (!bytes?.byteLength) return undefined;
    const url = URL.createObjectURL(new Blob([bytes], { type: payload.mime || "application/octet-stream" }));
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [payload]);

  const kind = payload?.previewKind || researchItemKind(item);
  const table = useMemo(() => kind === "table"
    ? parseDelimitedPreview(payload?.text, /\.tsv$/i.test(payload?.name || item?.name || "") ? "\t" : ",")
    : null, [item?.name, kind, payload?.name, payload?.text]);
  const normalizedSearchQuery = normalizePreviewSearchQuery(searchQuery);
  const searchable = ["markdown", "text", "table"].includes(kind);
  const zoomable = ["markdown", "text", "table"].includes(kind);
  const markdownRender = useMemo(() => {
    const html = payload?.html || "<p>Markdown 内容为空。</p>";
    if (kind !== "markdown" || !normalizedSearchQuery || typeof document === "undefined") {
      return { html, count: 0, truncated: false };
    }
    const root = document.createElement("div");
    root.innerHTML = html;
    const walker = document.createTreeWalker(root, document.defaultView?.NodeFilter?.SHOW_TEXT || 4);
    const textNodes = [];
    let node = walker.nextNode();
    while (node) {
      if (!node.parentElement?.closest("script, style")) textNodes.push(node);
      node = walker.nextNode();
    }
    let cursor = 0;
    let truncated = false;
    for (const textNode of textNodes) {
      const result = segmentPreviewSearch(textNode.nodeValue || "", normalizedSearchQuery, {
        startIndex: cursor,
        maxMatches: Math.max(0, MAX_PREVIEW_SEARCH_MATCHES - cursor),
      });
      if (result.nextIndex === cursor) continue;
      const fragment = document.createDocumentFragment();
      result.segments.forEach((segment) => {
        if (!segment.match) {
          fragment.append(document.createTextNode(segment.text));
          return;
        }
        const mark = document.createElement("mark");
        mark.dataset.previewSearchIndex = String(segment.index);
        mark.textContent = segment.text;
        fragment.append(mark);
      });
      textNode.replaceWith(fragment);
      cursor = result.nextIndex;
      truncated ||= result.truncated;
      if (cursor >= MAX_PREVIEW_SEARCH_MATCHES) {
        truncated = true;
        break;
      }
    }
    return { html: root.innerHTML, count: cursor, truncated };
  }, [kind, normalizedSearchQuery, payload?.html]);
  const searchSummary = useMemo(() => {
    if (!normalizedSearchQuery) return { count: 0, truncated: false };
    if (kind === "markdown") return { count: markdownRender.count, truncated: markdownRender.truncated };
    if (kind === "text") return countPreviewSearchMatches(payload?.text, normalizedSearchQuery, MAX_PREVIEW_SEARCH_MATCHES);
    if (kind === "table") {
      let count = 0;
      let truncated = false;
      for (const row of table?.rows || []) {
        for (const cell of row) {
          const remaining = MAX_PREVIEW_SEARCH_MATCHES - count;
          if (remaining <= 0) {
            truncated = true;
            break;
          }
          const result = countPreviewSearchMatches(cell, normalizedSearchQuery, remaining);
          count += result.count;
          truncated ||= result.truncated;
        }
        if (truncated && count >= MAX_PREVIEW_SEARCH_MATCHES) break;
      }
      return { count, truncated };
    }
    return { count: 0, truncated: false };
  }, [kind, markdownRender.count, markdownRender.truncated, normalizedSearchQuery, payload?.text, table?.rows]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    setActiveSearchIndex((current) => searchSummary.count ? Math.min(current, searchSummary.count - 1) : 0);
  }, [searchSummary.count]);

  useEffect(() => {
    if (!normalizedSearchQuery || !searchSummary.count) return undefined;
    const root = kind === "markdown" ? markdownRef.current : contentRef.current;
    if (!root) return undefined;
    root.querySelectorAll("mark.is-active").forEach((node) => node.classList.remove("is-active"));
    const match = root.querySelector(`[data-preview-search-index="${activeSearchIndex}"]`);
    match?.classList.add("is-active");
    const frame = window.requestAnimationFrame(() => match?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }));
    return () => window.cancelAnimationFrame(frame);
  }, [activeSearchIndex, kind, normalizedSearchQuery, searchSummary.count]);

  const moveSearch = useCallback((direction) => {
    if (!searchSummary.count) return;
    setActiveSearchIndex((current) => (current + direction + searchSummary.count) % searchSummary.count);
  }, [searchSummary.count]);

  const changeSearchQuery = useCallback((value) => {
    setSearchQuery(value);
    setActiveSearchIndex(0);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setActiveSearchIndex(0);
    const root = kind === "markdown" ? markdownRef.current : contentRef.current;
    root?.querySelectorAll?.("mark.is-active").forEach((node) => node.classList.remove("is-active"));
  }, [kind]);

  if (status === "loading") return <div className="secondary-research-state" role="status"><LoaderCircle className="research-spin" size={19} /><span>正在读取资料…</span></div>;
  if (status === "error") return <div className="secondary-research-state is-error" role="alert"><ShieldAlert size={20} /><span>{error}</span></div>;

  const searchCursor = { value: 0, truncated: false, activeIndex: activeSearchIndex };
  const zoomLabel = `${Math.round(contentScale * 100)}%`;
  return (
    <div className={`secondary-static-preview is-${kind}`}>
      <PreviewToolbar item={item} onOpenExternal={onOpenExternal} onShowInFolder={onShowInFolder}>
        {searchable && searchOpen ? (
          <PreviewSearchForm
            inputRef={searchInputRef}
            query={searchQuery}
            matchCount={searchSummary.count}
            truncated={searchSummary.truncated}
            activeIndex={activeSearchIndex}
            onQueryChange={changeSearchQuery}
            onPrevious={() => moveSearch(-1)}
            onNext={() => moveSearch(1)}
            onClose={closeSearch}
          />
        ) : null}
        {zoomable ? (
          <>
            <button type="button" onClick={() => setContentScale((value) => clampStaticScale(value - STATIC_SCALE_STEP))} aria-label="缩小资料内容" title="缩小"><ZoomOut size={14} /></button>
            <button type="button" className="secondary-preview-zoom-value" onClick={() => setContentScale(1)} aria-label={`资料缩放 ${zoomLabel}，点击恢复原始大小`} title="恢复 100%">{zoomLabel}</button>
            <button type="button" onClick={() => setContentScale((value) => clampStaticScale(value + STATIC_SCALE_STEP))} aria-label="放大资料内容" title="放大"><ZoomIn size={14} /></button>
          </>
        ) : null}
        {searchable ? <button type="button" className={searchOpen ? "is-active" : ""} onClick={() => { if (searchOpen) closeSearch(); else setSearchOpen(true); }} aria-label={searchOpen ? "收起资料搜索" : "展开资料搜索"} title={searchOpen ? "收起搜索" : "搜索"}>{searchOpen ? <X size={14} /> : <Search size={14} />}</button> : null}
        {kind === "image" ? (
          <>
            <button type="button" onClick={() => { setImageFit(false); setImageScale((value) => Math.max(0.25, value - 0.15)); }} aria-label="缩小图片" title="缩小"><ZoomOut size={14} /></button>
            <button type="button" className={imageFit ? "is-active" : ""} onClick={() => setImageFit(true)} aria-label="图片适应窗口" title="适应窗口"><Maximize2 size={14} /></button>
            <button type="button" onClick={() => { setImageFit(false); setImageScale(1); }} aria-label="图片原始尺寸" title="原始尺寸">1:1</button>
            <button type="button" onClick={() => { setImageFit(false); setImageScale((value) => Math.min(4, value + 0.15)); }} aria-label="放大图片" title="放大"><ZoomIn size={14} /></button>
          </>
        ) : null}
      </PreviewToolbar>
      {kind === "markdown" ? (
        <article
          ref={markdownRef}
          className="secondary-markdown-preview"
          style={{ "--research-preview-scale": contentScale }}
          onClick={(event) => {
            const anchor = event.target?.closest?.("a[href]");
            if (!anchor) return;
            event.preventDefault();
            try {
              const url = new URL(anchor.getAttribute("href"));
              if (["http:", "https:"].includes(url.protocol)) void bridge.openExternal?.(url.href);
            } catch {}
          }}
          dangerouslySetInnerHTML={{ __html: markdownRender.html }}
        />
      ) : null}
      {kind === "text" ? <pre ref={contentRef} className="secondary-text-preview" style={{ "--research-preview-scale": contentScale }}>{renderPreviewSearchText(payload?.text || "", normalizedSearchQuery, searchCursor)}</pre> : null}
      {kind === "table" ? (
        <div className="secondary-table-preview" style={{ "--research-preview-scale": contentScale }}>
          {table?.truncated ? <p role="status">内容较大，仅显示前 2000 行、每行前 80 列。</p> : null}
          {table?.rows?.length ? (
            <div ref={contentRef} className="secondary-table-scroll" tabIndex={0} aria-label="可上下左右滚动的表格资料">
              <table>
                <thead><tr><th className="secondary-table-corner" aria-label="行列坐标" />{Array.from({ length: table.columnCount }, (_, columnIndex) => <th className="secondary-table-column-label" scope="col" key={`column-${columnIndex}`}>{spreadsheetColumnLabel(columnIndex)}</th>)}</tr></thead>
                <tbody>{table.rows.map((row, rowIndex) => <tr key={`row-${rowIndex}`}><th className="secondary-table-row-label" scope="row">{rowIndex + 1}</th>{row.map((cell, columnIndex) => <td key={`cell-${rowIndex}-${columnIndex}`}>{renderPreviewSearchText(cell, normalizedSearchQuery, searchCursor)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : <p>表格内容为空。</p>}
        </div>
      ) : null}
      {kind === "image" ? (
        <div className="secondary-image-preview">
          {imageUrl ? <img src={imageUrl} alt={sourceDisplayName(item)} className={imageFit ? "is-fit" : ""} style={imageFit ? undefined : { zoom: imageScale }} /> : <p>图片内容为空。</p>}
        </div>
      ) : null}
    </div>
  );
}

function FileResearchCard({ item, onShowInFolder }) {
  const name = sourceDisplayName(item);
  const extension = name.includes(".") ? name.split(".").pop().toLocaleUpperCase("en-US") : "文件";
  const image = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(name);
  const Icon = image ? Image : FileText;
  const metadata = [extension, formatResearchFileSize(item.size), item.mtimeText || formatResearchModifiedAt(item.modifiedAt || item.mtimeMs)].filter(Boolean);
  return (
    <article className="secondary-research-card secondary-file-card">
      <div className="secondary-file-hero"><Icon size={34} aria-hidden="true" /><span>{extension}</span></div>
      <div className="secondary-research-card-copy">
        <strong>{name}</strong>
        <p className="secondary-file-path">{item.relativePath || item.path || ""}</p>
        {metadata.length ? <p className="secondary-file-meta">{metadata.join(" · ")}</p> : null}
        <p className="secondary-file-warning"><ShieldAlert size={15} />此文件类型不支持在笺间打开。</p>
      </div>
      <div className="secondary-research-card-actions">
        {onShowInFolder ? <button type="button" onClick={() => onShowInFolder(item)}><FolderOpen size={14} />在资源管理器中显示</button> : null}
      </div>
    </article>
  );
}

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
      <div className={["secondary-research-body", kind === "pdf" ? "is-pdf" : "", kind === "web" ? "is-web" : "", ["markdown", "text", "table", "image"].includes(kind) ? "is-static" : ""].filter(Boolean).join(" ")}>
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
        {!loading && !error && ["markdown", "text", "table", "image"].includes(kind) ? <StaticResearchPreview item={item} loadPreview={previewLoader} onOpenExternal={onOpenExternal} onShowInFolder={onShowInFolder} /> : null}
        {!loading && !error && kind === "unsupported" ? <FileResearchCard item={item} onShowInFolder={onShowInFolder} /> : null}
      </div>
    </aside>
  );
}

export { clampResearchPaneWidth, researchItemKind } from "./research-ui-model.js";
