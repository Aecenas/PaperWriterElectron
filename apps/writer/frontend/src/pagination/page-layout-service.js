export const A4_PAGE_METRICS = Object.freeze({
  width: 794,
  height: 1123,
  marginTop: 78,
  marginRight: 76,
  marginBottom: 92,
  marginLeft: 76,
  gap: 28,
});

export function getA4ContentMetrics(metrics = A4_PAGE_METRICS) {
  return {
    width: metrics.width - metrics.marginLeft - metrics.marginRight,
    height: metrics.height - metrics.marginTop - metrics.marginBottom,
  };
}

export function pageIndexFromClientRect(rect, editorRect, metrics = A4_PAGE_METRICS) {
  if (!rect || !editorRect) return 0;
  const content = getA4ContentMetrics(metrics);
  const stride = content.width + metrics.gap + metrics.marginLeft + metrics.marginRight;
  const renderedWidth = Number(editorRect.width) || content.width;
  const scale = Math.max(0.01, renderedWidth / content.width);
  const offset = Math.max(0, (rect.left - editorRect.left) / scale);
  return Math.max(0, Math.floor(offset / stride));
}

function safeCoordsAtPos(editor, position) {
  try {
    return editor?.view?.coordsAtPos(position) || null;
  } catch {
    return null;
  }
}

function nodeBoundaryPositions(doc) {
  const boundaries = new Set([0, doc?.content?.size || 0]);
  doc?.descendants?.((node, position) => {
    if (!node.isText) {
      boundaries.add(position);
      boundaries.add(Math.min(doc.content.size, position + node.nodeSize));
    }
  });
  return [...boundaries].sort((left, right) => left - right);
}

function domRangeForPositions(editor, from, to) {
  const view = editor?.view;
  if (!view || typeof document === "undefined") return null;
  try {
    const start = view.domAtPos(from);
    const end = view.domAtPos(to);
    const range = document.createRange();
    const boundedOffset = ({ node, offset }) => {
      const limit = node.nodeType === 3
        ? (node.nodeValue?.length || 0)
        : (node.childNodes?.length || 0);
      return Math.max(0, Math.min(Number(offset) || 0, limit));
    };
    range.setStart(start.node, boundedOffset(start));
    range.setEnd(end.node, boundedOffset(end));
    return range;
  } catch {
    return null;
  }
}

export function buildPageMap({
  editor,
  editorElement,
  metrics = A4_PAGE_METRICS,
  generation = 0,
} = {}) {
  const doc = editor?.state?.doc;
  const editorRect = editorElement?.getBoundingClientRect?.();
  if (!doc || !editorRect) {
    return {
      generation,
      pageCount: 1,
      pages: [{ page: 1, from: 0, to: 0, range: null, rect: null }],
      positionToPage: () => 1,
    };
  }

  const boundaries = nodeBoundaryPositions(doc);
  const positions = boundaries.map((position) => {
    const coords = safeCoordsAtPos(editor, position);
    return {
      position,
      pageIndex: coords ? pageIndexFromClientRect(coords, editorRect, metrics) : 0,
    };
  });
  const scrollWidth = Math.max(
    Number(editorElement.scrollWidth) || 0,
    Number(editorElement.parentElement?.scrollWidth) || 0,
  );
  const stride = metrics.width + metrics.gap;
  const geometryCount = Math.max(1, Math.ceil((scrollWidth + metrics.gap) / stride));
  const mappedCount = Math.max(1, ...positions.map((entry) => entry.pageIndex + 1));
  const pageCount = Math.max(geometryCount, mappedCount);
  const pageIndexAtPosition = (position) => {
    const coords = safeCoordsAtPos(editor, position);
    if (coords) return pageIndexFromClientRect(coords, editorRect, metrics);
    const exact = positions.findLast((entry) => entry.position <= position);
    return exact?.pageIndex || 0;
  };
  const firstPositionAtPage = (targetPageIndex) => {
    let low = 0;
    let high = doc.content.size;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (pageIndexAtPosition(middle) >= targetPageIndex) high = middle;
      else low = middle + 1;
    }
    return low;
  };
  const pageStarts = Array.from(
    { length: pageCount },
    (_item, pageIndex) => pageIndex === 0 ? 0 : firstPositionAtPage(pageIndex),
  );
  const pages = Array.from({ length: pageCount }, (_item, pageIndex) => {
    const from = pageStarts[pageIndex] ?? 0;
    const to = pageStarts[pageIndex + 1] ?? doc.content.size;
    return {
      page: pageIndex + 1,
      from: Math.max(0, Math.min(from, doc.content.size)),
      to: Math.max(0, Math.min(Math.max(from, to), doc.content.size)),
      range: domRangeForPositions(editor, from, Math.max(from, to)),
      rect: {
        x: pageIndex * stride,
        y: 0,
        width: metrics.width,
        height: metrics.height,
      },
    };
  });

  const positionToPage = (position) => {
    const value = Math.max(0, Math.min(Number(position) || 0, doc.content.size));
    return Math.min(pageCount, Math.max(1, pageIndexAtPosition(value) + 1));
  };

  return {
    generation,
    pageCount,
    pages,
    positionToPage,
  };
}

export function markOversizeBlocks(root, metrics = A4_PAGE_METRICS) {
  const editorElement = root?.querySelector?.(".paper-editor");
  if (!editorElement) return [];
  const { height } = getA4ContentMetrics(metrics);
  const oversize = [];
  [...editorElement.children].forEach((element) => {
    const elementHeight = Number(element.getBoundingClientRect?.().height) || 0;
    const isAtomic = element.matches?.(
      "h1, h2, h3, h4, figure, pre, .paper-block-math, .paper-mermaid, "
        + "[data-type='block-math'], [data-type='paper-mermaid']",
    ) === true;
    const isOversize = isAtomic && elementHeight > height;
    element.classList?.toggle?.("paper-oversize-block", isOversize);
    if (isOversize) {
      if (element.getAttribute?.("data-page-oversize-kind") !== "block") {
        element.setAttribute?.("data-page-oversize-kind", "block");
      }
      oversize.push(element);
    } else if (element.hasAttribute?.("data-page-oversize-kind")) {
      element.removeAttribute?.("data-page-oversize-kind");
    }
  });
  [...(editorElement.querySelectorAll?.("table tr") || [])].forEach((row) => {
    const rowHeight = Number(row.getBoundingClientRect?.().height) || 0;
    const isOversize = rowHeight > height;
    row.classList?.toggle?.("paper-oversize-row", isOversize);
    if (isOversize) {
      if (row.getAttribute?.("data-page-oversize-kind") !== "table-row") {
        row.setAttribute?.("data-page-oversize-kind", "table-row");
      }
      oversize.push(row);
    } else if (row.hasAttribute?.("data-page-oversize-kind")) {
      row.removeAttribute?.("data-page-oversize-kind");
    }
  });
  return oversize;
}

function waitForMermaidRenders(root, signal, timeoutMs = 20_000) {
  const selector = ".paper-mermaid[data-mermaid-render-state='loading']";
  if (!root?.querySelector?.(selector) || signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      globalThis.clearTimeout?.(timeoutId);
      signal?.removeEventListener?.("abort", finish);
      resolve();
    };
    const check = () => {
      if (!root.querySelector?.(selector)) finish();
    };
    const observer = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(check);
    observer?.observe(root, {
      attributes: true,
      attributeFilter: ["data-mermaid-render-state"],
      childList: true,
      subtree: true,
    });
    timeoutId = globalThis.setTimeout?.(finish, timeoutMs);
    signal?.addEventListener?.("abort", finish, { once: true });
    check();
  });
}

export async function waitForPageLayoutResources(root, signal) {
  const fonts = globalThis.document?.fonts;
  if (fonts?.ready) {
    await Promise.race([
      fonts.ready.catch(() => undefined),
      new Promise((resolve) => signal?.addEventListener("abort", resolve, { once: true })),
    ]);
  }
  if (signal?.aborted) return;
  const media = [...(root?.querySelectorAll?.("img") || [])];
  await Promise.all(media.map(async (image) => {
    if (image.complete) {
      try {
        await image.decode?.();
      } catch {
        // Broken media still participates in layout through its fallback box.
      }
      return;
    }
    await new Promise((resolve) => {
      const done = () => resolve();
      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
      signal?.addEventListener("abort", done, { once: true });
    });
  }));
  if (signal?.aborted) return;
  await waitForMermaidRenders(root, signal);
}

export class PageLayoutService {
  constructor({
    editor,
    root,
    metrics = A4_PAGE_METRICS,
    debounceMs = 120,
    onMap,
  } = {}) {
    this.editor = editor;
    this.root = root;
    this.metrics = metrics;
    this.debounceMs = debounceMs;
    this.onMap = onMap;
    this.generation = 0;
    this.timer = null;
    this.abortController = null;
    this.lastMap = null;
  }

  schedule(reason = "transaction") {
    this.generation += 1;
    const generation = this.generation;
    clearTimeout(this.timer);
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.timer = setTimeout(() => {
      void this.measure(generation, reason, this.abortController.signal);
    }, this.debounceMs);
    return generation;
  }

  async flush(reason = "manual") {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      this.generation += 1;
      const generation = this.generation;
      clearTimeout(this.timer);
      this.abortController?.abort();
      this.abortController = new AbortController();
      const pageMap = await this.measure(
        generation,
        reason,
        this.abortController.signal,
      );
      if (pageMap?.generation === generation) return pageMap;
    }
    return this.lastMap;
  }

  async measure(generation = this.generation, reason = "manual", signal = this.abortController?.signal) {
    await waitForPageLayoutResources(this.root, signal);
    if (signal?.aborted || generation !== this.generation) return this.lastMap;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (signal?.aborted || generation !== this.generation) return this.lastMap;
    const editorElement = this.root?.querySelector?.(".paper-editor") || this.editor?.view?.dom;
    const oversize = markOversizeBlocks(this.root, this.metrics);
    const nextMap = buildPageMap({
      editor: this.editor,
      editorElement,
      metrics: this.metrics,
      generation,
    });
    nextMap.oversizeCount = oversize.length;
    nextMap.oversizeKinds = [...new Set(
      oversize.map((element) => element.getAttribute?.("data-page-oversize-kind") || "block"),
    )];
    if (generation !== this.generation) return this.lastMap;
    this.lastMap = { ...nextMap, reason };
    this.onMap?.(this.lastMap);
    return this.lastMap;
  }

  destroy() {
    clearTimeout(this.timer);
    this.abortController?.abort();
    this.generation += 1;
  }
}
