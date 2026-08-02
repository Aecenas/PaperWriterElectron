import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { A4_PAGE_METRICS, PageLayoutService } from "./page-layout-service.js";
import {
  registerPageLayout,
  updateRegisteredPageLayout,
} from "./page-layout-registry.js";
import {
  PAGE_VIEW_MODES,
  PAGE_ZOOM_MODES,
  normalizePageViewState,
  pageGroupStartIndex,
} from "./page-view-state.js";

function PageChrome({ page, paperStyle }) {
  return (
    <div
      className="paper-page-chrome"
      style={{
        ...paperStyle,
        left: `${(page - 1) * (A4_PAGE_METRICS.width + A4_PAGE_METRICS.gap)}px`,
      }}
      aria-hidden="true"
    >
      <span className="paper-page-number">{page}</span>
    </div>
  );
}

export function PaginatedSurface({
  editor,
  state,
  pageMap,
  paperStyle,
  rootRef,
  children,
  onPageMapChange,
  onStateChange,
}) {
  const viewportRef = useRef(null);
  const layoutServiceRef = useRef(null);
  const modeRef = useRef(PAGE_VIEW_MODES.CONTINUOUS);
  const alignedGenerationRef = useRef(-1);
  const [fitZoom, setFitZoom] = useState(1);
  const normalized = normalizePageViewState(state, pageMap?.pageCount);
  modeRef.current = normalized.mode;
  const pageCount = Math.max(1, pageMap?.pageCount || 1);
  const isSpread = normalized.mode === PAGE_VIEW_MODES.SPREAD;
  const framePages = isSpread ? 2 : 1;
  const frameWidth = A4_PAGE_METRICS.width * framePages
    + A4_PAGE_METRICS.gap * (framePages - 1);
  const zoom = normalized.zoomMode === PAGE_ZOOM_MODES.FIT ? fitZoom : normalized.zoom;
  const startIndex = pageGroupStartIndex(normalized, pageCount);
  const translateX = -startIndex * (A4_PAGE_METRICS.width + A4_PAGE_METRICS.gap);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const container = viewport.parentElement || viewport;
    const update = () => {
      const styles = globalThis.getComputedStyle?.(container);
      const horizontalPadding = (Number.parseFloat(styles?.paddingLeft) || 0)
        + (Number.parseFloat(styles?.paddingRight) || 0);
      const available = Math.max(
        320,
        (container.clientWidth || frameWidth) - horizontalPadding,
      );
      const maximum = isSpread ? 1 : (1010 / A4_PAGE_METRICS.width);
      setFitZoom(Math.min(maximum, Math.max(0.45, available / frameWidth)));
    };
    update();
    const frame = globalThis.requestAnimationFrame?.(update);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(update);
    observer?.observe(container);
    globalThis.addEventListener?.("resize", update);
    return () => {
      if (frame) globalThis.cancelAnimationFrame?.(frame);
      observer?.disconnect();
      globalThis.removeEventListener?.("resize", update);
    };
  }, [frameWidth, isSpread, normalized.mode]);

  useEffect(() => {
    const root = rootRef?.current;
    if (!root || !editor) return undefined;
    const service = new PageLayoutService({
      editor,
      root,
      onMap: onPageMapChange,
    });
    const unregisterLayout = registerPageLayout(root, {
      editor,
      pageMap,
      service,
      state: normalized,
    });
    layoutServiceRef.current = service;
    const schedule = () => {
      if (modeRef.current !== PAGE_VIEW_MODES.CONTINUOUS) {
        service.schedule("editor");
      }
    };
    editor.on?.("transaction", schedule);
    globalThis.addEventListener?.("resize", schedule);
    globalThis.document?.fonts?.addEventListener?.("loadingdone", schedule);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => service.schedule("resize"));
    observer?.observe(root);
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => service.schedule("content"));
    mutationObserver?.observe(
      root.querySelector?.(".paper-editor") || root,
      { attributes: true, childList: true, subtree: true },
    );
    if (modeRef.current !== PAGE_VIEW_MODES.CONTINUOUS) {
      service.schedule("mount");
    }
    return () => {
      editor.off?.("transaction", schedule);
      globalThis.removeEventListener?.("resize", schedule);
      globalThis.document?.fonts?.removeEventListener?.("loadingdone", schedule);
      observer?.disconnect();
      mutationObserver?.disconnect();
      service.destroy();
      unregisterLayout();
      if (layoutServiceRef.current === service) layoutServiceRef.current = null;
    };
  }, [editor, onPageMapChange, rootRef]);

  useEffect(() => {
    if (normalized.mode !== PAGE_VIEW_MODES.CONTINUOUS) {
      layoutServiceRef.current?.schedule("presentation");
    }
  }, [normalized.mode, paperStyle]);

  useEffect(() => {
    const root = rootRef?.current;
    if (!root) return;
    updateRegisteredPageLayout(root, {
      editor,
      pageMap,
      service: layoutServiceRef.current,
      state: normalized,
    });
  }, [
    editor,
    normalized.currentPage,
    normalized.mode,
    normalized.zoom,
    normalized.zoomMode,
    pageMap,
    rootRef,
  ]);

  useEffect(() => {
    const generation = Number(pageMap?.generation) || 0;
    if (
      !editor
      || !editor.isFocused
      || normalized.mode === PAGE_VIEW_MODES.CONTINUOUS
      || alignedGenerationRef.current === generation
    ) {
      return;
    }
    alignedGenerationRef.current = generation;
    const nextPage = pageMap?.positionToPage?.(editor.state.selection.head) || 1;
    if (nextPage !== normalized.currentPage) {
      onStateChange?.({ ...normalized, currentPage: nextPage });
    }
  }, [
    editor,
    normalized.currentPage,
    normalized.mode,
    normalized.zoom,
    normalized.zoomMode,
    onStateChange,
    pageMap,
  ]);

  useEffect(() => {
    if (!editor || normalized.mode === PAGE_VIEW_MODES.CONTINUOUS) return undefined;
    const syncSelectionPage = () => {
      const nextPage = pageMap?.positionToPage?.(editor.state.selection.head) || 1;
      if (nextPage !== normalized.currentPage) {
        onStateChange?.({ ...normalized, currentPage: nextPage });
      }
    };
    editor.on?.("selectionUpdate", syncSelectionPage);
    return () => editor.off?.("selectionUpdate", syncSelectionPage);
  }, [
    editor,
    normalized.currentPage,
    normalized.mode,
    normalized.zoom,
    normalized.zoomMode,
    onStateChange,
    pageMap,
  ]);

  const chrome = useMemo(() => (
    Array.from({ length: pageCount }, (_item, index) => (
      <PageChrome key={index + 1} page={index + 1} paperStyle={paperStyle} />
    ))
  ), [pageCount, paperStyle]);

  if (normalized.mode === PAGE_VIEW_MODES.CONTINUOUS) {
    return children;
  }

  return (
    <div
      ref={viewportRef}
      className={`page-mode-zoom-frame page-mode-${normalized.mode}`}
      style={{
        width: `${frameWidth * zoom}px`,
        height: `${A4_PAGE_METRICS.height * zoom}px`,
      }}
    >
      <div
        className="page-mode-window"
        style={{
          width: `${frameWidth}px`,
          height: `${A4_PAGE_METRICS.height}px`,
          transform: `scale(${zoom})`,
        }}
      >
        <div
          className="page-mode-stage"
          style={{
            width: `${pageCount * A4_PAGE_METRICS.width + (pageCount - 1) * A4_PAGE_METRICS.gap}px`,
            height: `${A4_PAGE_METRICS.height}px`,
            transform: `translate3d(${translateX}px, 0, 0)`,
          }}
        >
          <div className="paper-page-chrome-layer">{chrome}</div>
          {children}
        </div>
      </div>
    </div>
  );
}
