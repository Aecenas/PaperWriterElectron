import { useCallback, useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  ScanLine,
  Search,
  ShieldAlert,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import PreviewToolbar from "./PreviewToolbar.jsx";
import { itemIdentity, normalizePdfBytes } from "./reader-utils.js";
import {
  createPdfPageSearchIndex,
  findPdfPageSearchMatches,
  MAX_PDF_SEARCH_MATCHES,
  normalizePdfSearchQuery,
  preferredPdfSearchMatchIndex,
} from "./pdf-search-model.js";

const MIN_PDF_SCALE = 0.35;
const MAX_PDF_SCALE = 2.5;
const PDF_ZOOM_STEP = 0.12;
const PDF_SCROLL_COMMIT_DELAY = 120;
const PDF_HORIZONTAL_CHROME = 42;

function emptyPdfSearchState() {
  return {
    query: "",
    matches: [],
    activeIndex: -1,
    status: "idle",
    scannedPages: 0,
    totalPages: 0,
    searchablePages: 0,
    truncated: false,
  };
}

const DEFAULT_PDF_VIEW_STATE = Object.freeze({
  page: 1,
  zoomMode: "fit",
  scale: 1,
  scrollLeft: 0,
  scrollTop: 0,
});

function clampPdfScale(value) {
  return Math.max(MIN_PDF_SCALE, Math.min(MAX_PDF_SCALE, Number(value) || 1));
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

function applyPdfSearchHighlights(layer, matches, activeIndex) {
  if (!layer?.textDivs?.length) return null;
  const rangesByItem = new Map();
  for (const match of matches) {
    for (const segment of match.segments || []) {
      const ranges = rangesByItem.get(segment.itemIndex) || [];
      ranges.push({ ...segment, matchIndex: match.index });
      rangesByItem.set(segment.itemIndex, ranges);
    }
  }

  layer.textDivs.forEach((textDiv, itemIndex) => {
    const value = layer.strings[itemIndex] || "";
    const ranges = rangesByItem.get(itemIndex) || [];
    if (!ranges.length) {
      if (textDiv.textContent !== value || textDiv.childNodes.length !== 1) textDiv.textContent = value;
      return;
    }
    const fragment = textDiv.ownerDocument.createDocumentFragment();
    let cursor = 0;
    ranges.sort((left, right) => left.start - right.start).forEach((range) => {
      if (range.start > cursor) fragment.append(textDiv.ownerDocument.createTextNode(value.slice(cursor, range.start)));
      const mark = textDiv.ownerDocument.createElement("mark");
      mark.className = range.matchIndex === activeIndex ? "is-active" : "";
      mark.dataset.pdfSearchIndex = String(range.matchIndex);
      mark.textContent = value.slice(range.start, range.end);
      fragment.append(mark);
      cursor = Math.max(cursor, range.end);
    });
    if (cursor < value.length) fragment.append(textDiv.ownerDocument.createTextNode(value.slice(cursor)));
    textDiv.replaceChildren(fragment);
  });

  return layer.textDivs
    .flatMap((textDiv) => [...textDiv.querySelectorAll("mark.is-active")])
    .find(Boolean) || null;
}

export function PdfReader({
  source,
  loadPdf,
  initialSearch = null,
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
  const pageSurfaceRef = useRef(null);
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const searchInputRef = useRef(null);
  const appliedInitialSearchRef = useRef("");
  const pageDraftRef = useRef(String(initialViewState.page));
  const renderTaskRef = useRef(null);
  const textLayerTaskRef = useRef(null);
  const currentTextLayerRef = useRef(null);
  const pdfjsRef = useRef(null);
  const pageTextCacheRef = useRef(new Map());
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
  const [searchState, setSearchState] = useState(emptyPdfSearchState);
  const [textLayerVersion, setTextLayerVersion] = useState(0);
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
    renderTaskRef.current?.cancel?.();
    textLayerTaskRef.current?.cancel?.();
    currentTextLayerRef.current = null;
    pageTextCacheRef.current.clear();
    pdfjsRef.current = null;
    appliedInitialSearchRef.current = "";
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
    setSearchState(emptyPdfSearchState());
    setTextLayerVersion(0);
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
        pdfjsRef.current = pdfjs;
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
      textLayerTaskRef.current?.cancel?.();
      currentTextLayerRef.current = null;
      pageTextCacheRef.current.clear();
      pdfjsRef.current = null;
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

  const getPageSearchIndex = useCallback(async (pageNumber) => {
    if (!pdf) throw new Error("PDF 尚未就绪");
    const resolvedPage = Math.max(1, Math.min(pdf.numPages, Math.trunc(Number(pageNumber) || 1)));
    const cache = pageTextCacheRef.current;
    if (!cache.has(resolvedPage)) {
      const pending = (async () => {
        const pdfPage = await pdf.getPage(resolvedPage);
        const textContent = await pdfPage.getTextContent();
        return {
          page: resolvedPage,
          textContent,
          index: createPdfPageSearchIndex(textContent),
        };
      })();
      cache.set(resolvedPage, pending);
      pending.catch(() => {
        if (cache.get(resolvedPage) === pending) cache.delete(resolvedPage);
      });
    }
    return cache.get(resolvedPage);
  }, [pdf]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !textLayerRef.current || !pageSurfaceRef.current || !pdfjsRef.current) return undefined;
    let disposed = false;
    setError("");
    textLayerTaskRef.current?.cancel?.();
    textLayerTaskRef.current = null;
    currentTextLayerRef.current = null;
    textLayerRef.current.replaceChildren();
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
        const pageSurface = pageSurfaceRef.current;
        const canvas = canvasRef.current;
        const textLayerContainer = textLayerRef.current;
        if (!pageSurface || !canvas || !textLayerContainer) return;
        pageSurface.style.width = `${renderViewport.width}px`;
        pageSurface.style.height = `${renderViewport.height}px`;
        pageSurface.style.setProperty("--total-scale-factor", String(scale));
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
        const [{ index }, textLayerResult] = await Promise.all([
          getPageSearchIndex(page),
          task.promise.then(async () => {
            if (disposed) return null;
            textLayerContainer.replaceChildren();
            const textLayerTask = new pdfjsRef.current.TextLayer({
              textContentSource: (await getPageSearchIndex(page)).textContent,
              container: textLayerContainer,
              viewport: renderViewport,
            });
            textLayerTaskRef.current = textLayerTask;
            await textLayerTask.render();
            return textLayerTask;
          }),
        ]);
        if (!disposed && textLayerResult) {
          currentTextLayerRef.current = {
            page,
            index,
            textDivs: textLayerResult.textDivs,
            strings: textLayerResult.textContentItemsStr,
          };
          setTextLayerVersion((value) => value + 1);
          schedulePendingScroll();
        }
      } catch (renderError) {
        if (!disposed && !["RenderingCancelledException", "AbortException"].includes(renderError?.name)) {
          setError(renderError?.message || "页面渲染失败");
        }
      }
    })();
    return () => {
      disposed = true;
      renderTaskRef.current?.cancel?.();
      textLayerTaskRef.current?.cancel?.();
    };
  }, [containerWidth, getPageSearchIndex, manualScale, page, pdf, schedulePendingScroll, zoomMode]);

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
    setSearchState(emptyPdfSearchState());
  }, []);

  const changePdfSearchQuery = useCallback((value) => {
    searchRunRef.current += 1;
    setQuery(String(value || "").slice(0, 256));
    setSearchMessage("");
    setSearchState(emptyPdfSearchState());
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

  const searchPdf = useCallback(async (requestedQuery = query, preferredPage = page) => {
    const needle = normalizePdfSearchQuery(requestedQuery);
    if (!pdf || !needle) {
      setSearchMessage(needle ? "PDF 尚未就绪" : "请输入要查找的文字");
      return;
    }
    const run = searchRunRef.current + 1;
    searchRunRef.current = run;
    setSearchState({
      ...emptyPdfSearchState(),
      query: needle,
      status: "searching",
      totalPages: pdf.numPages,
    });
    setSearchMessage(`正在搜索 0/${pdf.numPages} 页…`);
    try {
      const matches = [];
      let searchablePages = 0;
      let failedPages = 0;
      let truncated = false;
      const progressStep = Math.max(1, Math.ceil(pdf.numPages / 20));
      for (let candidate = 1; candidate <= pdf.numPages; candidate += 1) {
        if (searchRunRef.current !== run) return;
        try {
          const pageIndex = await getPageSearchIndex(candidate);
          if (pageIndex.index.text.trim()) searchablePages += 1;
          const remaining = MAX_PDF_SEARCH_MATCHES - matches.length;
          const result = findPdfPageSearchMatches(pageIndex.index, needle, {
            page: candidate,
            startIndex: matches.length,
            maxMatches: remaining,
          });
          matches.push(...result.matches);
          truncated ||= result.truncated;
        } catch {
          failedPages += 1;
        }
        if (matches.length >= MAX_PDF_SEARCH_MATCHES) {
          truncated ||= candidate < pdf.numPages;
          break;
        }
        if (candidate === pdf.numPages || candidate === 1 || candidate % progressStep === 0) {
          setSearchState({
            query: needle,
            matches: [],
            activeIndex: -1,
            status: "searching",
            scannedPages: candidate,
            totalPages: pdf.numPages,
            searchablePages,
            truncated: false,
          });
          setSearchMessage(`正在搜索 ${candidate}/${pdf.numPages} 页…`);
        }
      }
      if (searchRunRef.current !== run) return;
      const activeIndex = preferredPdfSearchMatchIndex(matches, preferredPage);
      setSearchState({
        query: needle,
        matches,
        activeIndex,
        status: "ready",
        scannedPages: pdf.numPages,
        totalPages: pdf.numPages,
        searchablePages,
        truncated,
      });
      if (activeIndex >= 0) {
        goToPage(matches[activeIndex].page);
        setSearchMessage(truncated ? `结果较多，仅显示前 ${MAX_PDF_SEARCH_MATCHES} 处` : failedPages ? `${failedPages} 页无法读取，其余页面已搜索` : "");
      } else if (!searchablePages) {
        setSearchMessage("此 PDF 没有可搜索的文字；扫描件需要先经过 OCR");
      } else if (failedPages) {
        setSearchMessage(`未找到匹配文字；另有 ${failedPages} 页无法读取`);
      } else {
        setSearchMessage("未找到匹配文字");
      }
    } catch (searchError) {
      if (searchRunRef.current === run) {
        setSearchState((current) => ({ ...current, status: "error" }));
        setSearchMessage(searchError?.message || "搜索失败");
      }
    }
  }, [getPageSearchIndex, goToPage, page, pdf, query]);

  const movePdfSearch = useCallback((direction) => {
    if (!searchState.matches.length) return;
    const nextIndex = (searchState.activeIndex + direction + searchState.matches.length) % searchState.matches.length;
    setSearchState((current) => ({ ...current, activeIndex: nextIndex }));
    goToPage(searchState.matches[nextIndex].page);
    setSearchMessage("");
  }, [goToPage, searchState.activeIndex, searchState.matches]);

  const submitPdfSearch = useCallback(() => {
    const needle = normalizePdfSearchQuery(query);
    if (needle && searchState.status === "ready" && searchState.query === needle && searchState.matches.length) {
      movePdfSearch(1);
      return;
    }
    void searchPdf(needle, page);
  }, [movePdfSearch, page, query, searchPdf, searchState.matches.length, searchState.query, searchState.status]);

  useEffect(() => {
    if (status !== "ready" || !pdf) return;
    const nextQuery = String(initialSearch?.query || "").trim().slice(0, 256);
    if (!nextQuery) return;
    const requestedPage = Math.max(1, Math.min(pdf.numPages, Math.trunc(Number(initialSearch?.page) || 1)));
    const searchToken = `${String(initialSearch?.requestId || "")}:${requestedPage}:${nextQuery}`;
    if (appliedInitialSearchRef.current === searchToken) return;
    appliedInitialSearchRef.current = searchToken;
    setSearchOpen(true);
    setQuery(nextQuery);
    goToPage(requestedPage);
    void searchPdf(nextQuery, requestedPage);
  }, [goToPage, initialSearch?.page, initialSearch?.query, initialSearch?.requestId, pdf, searchPdf, status]);

  useEffect(() => {
    const layer = currentTextLayerRef.current;
    if (!layer || layer.page !== page) return undefined;
    const pageMatches = searchOpen
      ? searchState.matches.filter((match) => match.page === page)
      : [];
    const activeMark = applyPdfSearchHighlights(layer, pageMatches, searchState.activeIndex);
    if (!activeMark || searchState.matches[searchState.activeIndex]?.page !== page) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport || !activeMark.isConnected) return;
      const viewportRect = viewport.getBoundingClientRect();
      const markRect = activeMark.getBoundingClientRect();
      const top = Math.max(0, viewport.scrollTop + markRect.top - viewportRect.top - viewport.clientHeight / 2);
      const left = Math.max(0, viewport.scrollLeft + markRect.left - viewportRect.left - viewport.clientWidth / 2);
      viewport.scrollTo({ top, left, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [page, searchOpen, searchState.activeIndex, searchState.matches, textLayerVersion]);

  const normalizedQuery = normalizePdfSearchQuery(query);
  const searchResultsCurrent = searchState.status === "ready" && searchState.query === normalizedQuery;
  const hasSearchMatches = searchResultsCurrent && searchState.matches.length > 0;
  const searchCountLabel = searchState.status === "searching"
    ? `${searchState.scannedPages}/${searchState.totalPages}`
    : normalizedQuery
      ? `${hasSearchMatches ? searchState.activeIndex + 1 : 0}/${searchResultsCurrent ? searchState.matches.length : 0}${searchState.truncated ? "+" : ""}`
      : "";

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
          <form className="secondary-preview-search" role="search" aria-busy={searchState.status === "searching"} onSubmit={(event) => { event.preventDefault(); submitPdfSearch(); }}>
            <Search size={13} aria-hidden="true" />
            <input
              ref={searchInputRef}
              value={query}
              maxLength={256}
              placeholder="搜索 PDF"
              aria-label="搜索 PDF 文字"
              onChange={(event) => changePdfSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  closePdfSearch();
                } else if (event.key === "Enter" && event.shiftKey && hasSearchMatches) {
                  event.preventDefault();
                  event.stopPropagation();
                  movePdfSearch(-1);
                }
              }}
            />
            <span aria-live="polite" aria-label={searchState.status === "searching" ? `已扫描 ${searchState.scannedPages} 页，共 ${searchState.totalPages} 页` : undefined}>{searchCountLabel}</span>
            <button type="button" disabled={!hasSearchMatches || searchState.status === "searching"} onClick={() => movePdfSearch(-1)} aria-label="上一个 PDF 匹配" title="上一个匹配（Shift+Enter）"><ChevronUp size={13} aria-hidden="true" /></button>
            <button type="submit" disabled={!normalizedQuery || searchState.status === "searching"} aria-label={hasSearchMatches ? "下一个 PDF 匹配" : "开始搜索 PDF"} title={hasSearchMatches ? "下一个匹配（Enter）" : "开始搜索"}><ChevronDown size={13} aria-hidden="true" /></button>
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
          <div ref={pageSurfaceRef} className="secondary-pdf-page-surface">
            <canvas ref={canvasRef} role="img" aria-label={`PDF 第 ${page} 页`} />
            <div ref={textLayerRef} className="secondary-pdf-text-layer" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
