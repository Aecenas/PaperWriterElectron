import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  Maximize2,
  Search,
  ShieldAlert,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { bridge } from "../bridge.js";
import { researchItemKind, sourceDisplayName } from "../research-ui-model.js";
import {
  countPreviewSearchMatches,
  normalizePreviewSearchQuery,
  parseDelimitedPreview,
  segmentPreviewSearch,
  spreadsheetColumnLabel,
} from "../research-preview-model.js";
import PreviewToolbar from "./PreviewToolbar.jsx";
import { itemIdentity, normalizePdfBytes } from "./reader-utils.js";

const MIN_STATIC_SCALE = 0.6;
const MAX_STATIC_SCALE = 2;
const STATIC_SCALE_STEP = 0.1;
const MAX_PREVIEW_SEARCH_MATCHES = 5000;

function clampStaticScale(value) {
  return Math.max(MIN_STATIC_SCALE, Math.min(MAX_STATIC_SCALE, Number(value) || 1));
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

export default function StaticResearchPreview({ item, initialSearch = null, loadPreview, onOpenExternal, onShowInFolder }) {
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
  const richTextRef = useRef(null);
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
  const richText = ["markdown", "docx"].includes(kind);
  const searchable = ["markdown", "docx", "text", "table"].includes(kind);
  const zoomable = ["markdown", "docx", "text", "table"].includes(kind);
  const richTextRender = useMemo(() => {
    const html = payload?.html || (kind === "docx" ? "<p>DOCX 内容为空。</p>" : "<p>Markdown 内容为空。</p>");
    if (!richText || !normalizedSearchQuery || typeof document === "undefined") {
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
  }, [kind, normalizedSearchQuery, payload?.html, richText]);
  const searchSummary = useMemo(() => {
    if (!normalizedSearchQuery) return { count: 0, truncated: false };
    if (richText) return { count: richTextRender.count, truncated: richTextRender.truncated };
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
  }, [kind, normalizedSearchQuery, payload?.text, richText, richTextRender.count, richTextRender.truncated, table?.rows]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (status !== "ready") return;
    const nextQuery = normalizePreviewSearchQuery(initialSearch?.query);
    if (!nextQuery) return;
    setSearchOpen(true);
    setSearchQuery(nextQuery);
    setActiveSearchIndex(Math.max(0, Number(initialSearch?.matchIndex) || 0));
  }, [initialSearch?.query, initialSearch?.requestId, status]);

  useEffect(() => {
    setActiveSearchIndex((current) => searchSummary.count ? Math.min(current, searchSummary.count - 1) : 0);
  }, [searchSummary.count]);

  useEffect(() => {
    if (!normalizedSearchQuery || !searchSummary.count) return undefined;
    const root = richText ? richTextRef.current : contentRef.current;
    if (!root) return undefined;
    root.querySelectorAll("mark.is-active").forEach((node) => node.classList.remove("is-active"));
    const match = root.querySelector(`[data-preview-search-index="${activeSearchIndex}"]`);
    match?.classList.add("is-active");
    const frame = window.requestAnimationFrame(() => match?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" }));
    return () => window.cancelAnimationFrame(frame);
  }, [activeSearchIndex, normalizedSearchQuery, richText, searchSummary.count]);

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
    const root = richText ? richTextRef.current : contentRef.current;
    root?.querySelectorAll?.("mark.is-active").forEach((node) => node.classList.remove("is-active"));
  }, [richText]);

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
      {richText ? (
        <article
          ref={richTextRef}
          className="secondary-markdown-preview"
          style={{ "--research-preview-scale": contentScale }}
          aria-label={kind === "docx" ? "DOCX 资料内容" : "Markdown 资料内容"}
          onClick={(event) => {
            const anchor = event.target?.closest?.("a[href]");
            if (!anchor) return;
            event.preventDefault();
            try {
              const url = new URL(anchor.getAttribute("href"));
              if (["http:", "https:"].includes(url.protocol)) void bridge.openExternal?.(url.href);
            } catch {}
          }}
          dangerouslySetInnerHTML={{ __html: richTextRender.html }}
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
