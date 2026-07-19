import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, FilePlus2, Search, X } from "lucide-react";
import "./citation-picker.css";

function searchableSourceText(source) {
  return [
    source?.title,
    ...(Array.isArray(source?.authors) ? source.authors : []),
    source?.year,
    source?.publisher,
    source?.url,
    source?.doi,
    source?.isbn,
  ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
}

export default function CitationPickerDialog({
  picker,
  sources = [],
  loading = false,
  defaultPageForSource,
  initialPage = "",
  onSelect,
  onAddAndSelect,
  onClose,
}) {
  const searchRef = useRef(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [page, setPage] = useState("");

  useEffect(() => {
    if (!picker) return;
    setQuery("");
    setSelectedId("");
    setPage(String(initialPage || ""));
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [initialPage, picker]);

  useEffect(() => {
    if (!picker) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, picker]);

  const visibleSources = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    if (!needle) return sources;
    return sources.filter((source) => searchableSourceText(source).includes(needle));
  }, [query, sources]);
  const selected = sources.find((source) => source.id === selectedId) || null;

  if (!picker) return null;

  const choose = (source) => {
    setSelectedId(source.id);
    setPage(String(defaultPageForSource?.(source) || source.pages || ""));
  };

  return (
    <div className="citation-picker-overlay dialog-scrim" role="presentation" onMouseDown={() => onClose?.()}>
      <section className="citation-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="citation-picker-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span className="citation-picker-mark"><BookOpen size={20} aria-hidden="true" /></span>
          <div>
            <small>元素 · 文献引用</small>
            <h2 id="citation-picker-title">选择参考文献来源</h2>
          </div>
          <button type="button" className="citation-picker-close" onClick={onClose} aria-label="关闭参考文献来源选择器"><X size={18} /></button>
        </header>
        <label className="citation-picker-search">
          <Search size={17} aria-hidden="true" />
          <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题名、作者、年份或地址" />
        </label>
        <div className="citation-picker-body">
          {loading ? <p className="citation-picker-empty">正在刷新来源…</p> : null}
          {!loading && !visibleSources.length ? <p className="citation-picker-empty">没有匹配的参考文献来源，可以新建后直接插入。</p> : null}
          {visibleSources.map((source) => (
            <button
              key={source.id}
              type="button"
              className={selectedId === source.id ? "citation-picker-source active" : "citation-picker-source"}
              onClick={() => choose(source)}
              onDoubleClick={() => onSelect?.(source, String(defaultPageForSource?.(source) || source.pages || ""))}
            >
              <strong>{source.title || "未命名来源"}</strong>
              <span>{[
                Array.isArray(source.authors) ? source.authors.join("、") : "",
                source.year,
                source.publisher || source.url,
              ].filter(Boolean).join(" · ") || "暂无书目信息"}</span>
            </button>
          ))}
        </div>
        <footer>
          <button type="button" className="citation-picker-new" onClick={() => onAddAndSelect?.(page)}>
            <FilePlus2 size={16} aria-hidden="true" />
            新增并引用
          </button>
          <label className="citation-picker-page">
            <span>页码</span>
            <input value={page} onChange={(event) => setPage(event.target.value.slice(0, 80))} placeholder="可留空" />
          </label>
          <button type="button" className="citation-picker-insert" disabled={!selected} onClick={() => selected && onSelect?.(selected, page)}>插入引用</button>
        </footer>
      </section>
    </div>
  );
}
