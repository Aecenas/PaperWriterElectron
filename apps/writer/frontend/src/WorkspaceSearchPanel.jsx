import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  ChevronRight,
  FileSearch,
  FolderSearch,
  Globe2,
  Replace,
  Search,
  X,
} from "lucide-react";

function MatchSnippet({ snippet = "", ranges = [] }) {
  if (!snippet) return null;
  const safeRanges = (Array.isArray(ranges) ? ranges : [])
    .map((range) => ({ from: Math.max(0, Number(range?.from) || 0), to: Math.max(0, Number(range?.to) || 0) }))
    .filter((range) => range.to > range.from && range.from < snippet.length)
    .sort((left, right) => left.from - right.from);
  if (!safeRanges.length) return <span>{snippet}</span>;
  const pieces = [];
  let cursor = 0;
  safeRanges.forEach((range, index) => {
    const from = Math.max(cursor, Math.min(snippet.length, range.from));
    const to = Math.max(from, Math.min(snippet.length, range.to));
    if (from > cursor) pieces.push(<span key={`text-${index}`}>{snippet.slice(cursor, from)}</span>);
    if (to > from) pieces.push(<mark key={`mark-${index}`}>{snippet.slice(from, to)}</mark>);
    cursor = Math.max(cursor, to);
  });
  if (cursor < snippet.length) pieces.push(<span key="tail">{snippet.slice(cursor)}</span>);
  return pieces;
}

function formatUpdatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function DocumentFindWidget({
  query = "",
  replaceValue = "",
  replaceVisible = false,
  currentIndex = -1,
  currentCount = 0,
  readOnly = false,
  style,
  onQueryChange,
  onReplaceValueChange,
  onReplaceVisibleChange,
  onPrevious,
  onNext,
  onReplace,
  onReplaceAll,
  onClose,
}) {
  const queryInputRef = useRef(null);
  const replaceInputRef = useRef(null);

  useEffect(() => {
    const input = replaceVisible ? replaceInputRef.current : queryInputRef.current;
    input?.focus();
    if (!replaceVisible) input?.select();
  }, [replaceVisible]);

  const handleFindKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (event.shiftKey) onPrevious?.();
    else onNext?.();
  };

  const handleReplaceKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onReplace?.();
    }
  };

  return (
    <section
      className={replaceVisible ? "document-find-widget replace-open" : "document-find-widget"}
      aria-label={replaceVisible ? "查找和替换" : "查找"}
      style={style}
    >
      <div className="document-find-row">
        <button
          type="button"
          className={replaceVisible ? "document-find-disclosure open" : "document-find-disclosure"}
          aria-label={replaceVisible ? "收起替换" : "展开替换"}
          title={replaceVisible ? "收起替换" : "展开替换（Ctrl+H）"}
          onClick={() => onReplaceVisibleChange?.(!replaceVisible)}
        >
          <ChevronRight size={15} aria-hidden="true" />
        </button>
        <label className="document-find-input">
          <Search size={16} aria-hidden="true" />
          <input
            ref={queryInputRef}
            type="search"
            value={query}
            placeholder="在当前文档中查找"
            aria-label="在当前文档中查找"
            onChange={(event) => onQueryChange?.(event.target.value)}
            onKeyDown={handleFindKeyDown}
          />
          <span className="document-find-count" aria-live="polite">
            {query ? (currentCount ? `${currentIndex + 1}/${currentCount}` : "0/0") : ""}
          </span>
        </label>
        <div className="document-find-actions" role="group" aria-label="匹配项导航">
          <button type="button" disabled={!currentCount} aria-label="上一个匹配" title="上一个匹配（Shift+Enter）" onClick={onPrevious}>
            <ArrowUp size={15} aria-hidden="true" />
          </button>
          <button type="button" disabled={!currentCount} aria-label="下一个匹配" title="下一个匹配（Enter）" onClick={onNext}>
            <ArrowDown size={15} aria-hidden="true" />
          </button>
          <button type="button" aria-label="关闭查找" title="关闭查找（Esc）" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {replaceVisible ? (
        <div className="document-replace-row">
          <span className="document-replace-spacer" aria-hidden="true" />
          <label className="document-find-input">
            <Replace size={16} aria-hidden="true" />
            <input
              ref={replaceInputRef}
              value={replaceValue}
              placeholder="替换为"
              aria-label="替换为"
              onChange={(event) => onReplaceValueChange?.(event.target.value)}
              onKeyDown={handleReplaceKeyDown}
            />
          </label>
          <div className="document-replace-actions" role="group" aria-label="替换操作">
            <button type="button" disabled={readOnly || !currentCount} title={readOnly ? "只读文档不能替换" : "替换当前匹配"} onClick={onReplace}>替换</button>
            <button type="button" disabled={readOnly || !currentCount} title={readOnly ? "只读文档不能替换" : "替换全部匹配"} onClick={onReplaceAll}>全部</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function WorkspaceSearchPalette({
  query = "",
  loading = false,
  results = [],
  error = "",
  folderName = "当前文件夹",
  onQueryChange,
  onOpenResult,
  onClose,
}) {
  const inputRef = useRef(null);
  const resultRefs = useRef([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, results.length]);

  useEffect(() => {
    resultRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const openActiveResult = () => {
    const result = results[activeIndex];
    if (result) onOpenResult?.(result);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openActiveResult();
    }
  };

  return (
    <div className="workspace-search-overlay dialog-scrim" onPointerDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="workspace-search-palette" role="dialog" aria-modal="true" aria-label="文件夹搜索" onKeyDown={handleKeyDown}>
        <header className="workspace-search-heading">
          <span>
            <FolderSearch size={16} aria-hidden="true" />
            <strong>文件夹搜索</strong>
            <small>{folderName}</small>
          </span>
          <kbd>Ctrl P</kbd>
          <button type="button" aria-label="关闭文件夹搜索" title="关闭（Esc）" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <label className="workspace-search-palette-input">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={Boolean(results.length)}
            aria-controls="workspace-search-results"
            aria-activedescendant={results[activeIndex] ? `workspace-search-result-${activeIndex}` : undefined}
            value={query}
            placeholder="搜索文件名、标题、作者和正文"
            onChange={(event) => onQueryChange?.(event.target.value)}
          />
          {loading ? <span className="workspace-search-loading">搜索中…</span> : null}
        </label>
        <div id="workspace-search-results" className="workspace-search-results" role="listbox" aria-live="polite" aria-busy={loading}>
          {!loading && error ? <p className="workspace-search-empty error">{error}</p> : null}
          {!loading && !error && !query.trim() ? (
            <div className="workspace-search-prompt">
              <FileSearch size={22} aria-hidden="true" />
              <p>输入文字，动态搜索当前文件夹及全部子文件夹。</p>
              <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
            </div>
          ) : null}
          {!loading && !error && query.trim() && !results.length ? <p className="workspace-search-empty">没有找到匹配内容。</p> : null}
          {!error ? results.map((result, index) => (
            <button
              ref={(element) => { resultRefs.current[index] = element; }}
              id={`workspace-search-result-${index}`}
              key={`${result.path || result.documentId || "result"}-${result.position ?? index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "workspace-search-result active" : "workspace-search-result"}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => onOpenResult?.(result)}
              title={result.relativePath || result.path || result.title}
            >
              <span className="workspace-search-result-icon"><FileSearch size={16} aria-hidden="true" /></span>
              <span className="workspace-search-result-content">
                <span className="workspace-search-result-heading">
                  <strong>{result.title || result.displayName || "未命名信笺"}</strong>
                  <time>{formatUpdatedAt(result.updatedAt)}</time>
                </span>
                <span className="workspace-search-result-path">{result.relativePath || result.path}</span>
                {result.snippet ? (
                  <span className="workspace-search-result-snippet"><MatchSnippet snippet={result.snippet} ranges={result.snippetRanges} /></span>
                ) : null}
              </span>
            </button>
          )) : null}
        </div>
        {query.trim() && !error ? (
          <footer className="workspace-search-footer">
            <span>{loading ? "正在更新索引" : `${results.length} 个结果`}</span>
            <span>范围：当前文件夹与子文件夹</span>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

function researchProgressCopy(progress = {}) {
  const phase = String(progress.phase || "");
  const completed = Math.max(0, Number(progress.completed) || 0);
  const total = Math.max(0, Number(progress.total) || 0);
  if (phase === "discovering") return "正在扫描资料目录…";
  if (phase === "extracting") {
    return total
      ? `正在解析资料 ${Math.min(completed, total)}/${total}`
      : "正在解析资料…";
  }
  if (phase === "searching") return "正在匹配搜索内容…";
  return "正在准备资料索引…";
}

function ResearchSearchProgress({ progress, onCancel }) {
  const percentValue = Number(progress?.percent);
  const determinate = Number.isFinite(percentValue) && percentValue >= 0;
  const percent = determinate ? Math.max(0, Math.min(100, percentValue)) : 0;
  const label = researchProgressCopy(progress);
  const indexed = Math.max(0, Number(progress?.indexed) || 0);
  const reused = Math.max(0, Number(progress?.reused) || 0);
  const skipped = Math.max(0, Number(progress?.skipped) || 0);
  const failed = Math.max(0, Number(progress?.failed) || 0);
  const details = [
    indexed ? `已索引 ${indexed}` : "",
    reused ? `复用 ${reused}` : "",
    skipped ? `跳过 ${skipped}` : "",
    failed ? `失败 ${failed}` : "",
  ].filter(Boolean).join(" · ");
  return (
    <div className="research-search-progress-row">
      <div
        className={determinate ? "research-search-progress" : "research-search-progress indeterminate"}
        role="progressbar"
        aria-label="资料搜索索引进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.round(percent) : undefined}
        aria-valuetext={label}
      >
        <span style={determinate ? { width: `${percent}%` } : undefined} />
      </div>
      <span className="research-search-progress-copy">
        <strong>{label}</strong>
        {details ? <small>{details}</small> : null}
      </span>
      <button type="button" onClick={onCancel}>取消</button>
    </div>
  );
}

function researchResultRanges(result) {
  if (Array.isArray(result?.snippetRanges)) return result.snippetRanges;
  const from = Number(result?.snippetMatchStart);
  const length = Number(result?.snippetMatchLength);
  return Number.isFinite(from) && Number.isFinite(length) && length > 0
    ? [{ from, to: from + length }]
    : [];
}

function researchScopeLabel(result) {
  if (result?.kind !== "web") return result?.previewKind ? String(result.previewKind).toLocaleUpperCase("zh-CN") : "文件";
  return String(result?.scopeKey || "") === "global" ? "公区网页" : "私区网页";
}

export function ResearchSearchPalette({
  query = "",
  loading = false,
  results = [],
  error = "",
  libraryName = "当前资料区",
  progress = null,
  showProgress = false,
  warnings = [],
  onQueryChange,
  onOpenResult,
  onCancel,
  onClose,
}) {
  const inputRef = useRef(null);
  const resultRefs = useRef([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, results.length]);

  useEffect(() => {
    resultRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const openActiveResult = () => {
    const result = results[activeIndex];
    if (result) onOpenResult?.(result);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openActiveResult();
    }
  };

  return (
    <div className="workspace-search-overlay research-search-overlay dialog-scrim" onPointerDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="workspace-search-palette research-search-palette" role="dialog" aria-modal="true" aria-label="资料搜索" onKeyDown={handleKeyDown}>
        <header className="workspace-search-heading">
          <span>
            <BookOpenText size={16} aria-hidden="true" />
            <strong>资料搜索</strong>
            <small>{libraryName}</small>
          </span>
          <button type="button" aria-label="关闭资料搜索" title="关闭（Esc）" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <label className="workspace-search-palette-input">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={Boolean(results.length)}
            aria-controls="research-search-results"
            aria-activedescendant={results[activeIndex] ? `research-search-result-${activeIndex}` : undefined}
            value={query}
            maxLength={256}
            placeholder="搜索资料名称、路径、网页标题、网址和可解析正文"
            onChange={(event) => onQueryChange?.(event.target.value)}
          />
          {loading && !showProgress ? <span className="workspace-search-loading">搜索中…</span> : null}
        </label>
        {loading && showProgress ? <ResearchSearchProgress progress={progress} onCancel={onCancel} /> : null}
        <div id="research-search-results" className="workspace-search-results" role="listbox" aria-live="polite" aria-busy={loading}>
          {!loading && error ? <p className="workspace-search-empty error">{error}</p> : null}
          {!loading && !error && !query.trim() ? (
            <div className="workspace-search-prompt">
              <BookOpenText size={22} aria-hidden="true" />
              <p>搜索本地资料、公区网页和当前工作区私区网页。</p>
              <span>↑↓ 选择 · Enter 打开 · Esc 关闭</span>
            </div>
          ) : null}
          {!loading && !error && query.trim() && !results.length ? <p className="workspace-search-empty">没有找到匹配资料。</p> : null}
          {!error ? results.map((result, index) => {
            const web = result.kind === "web";
            const ResultIcon = web ? Globe2 : FileSearch;
            return (
              <button
                ref={(element) => { resultRefs.current[index] = element; }}
                id={`research-search-result-${index}`}
                key={`${result.kind || "file"}-${result.sourceId || result.relativePath || index}-${result.page || 0}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "workspace-search-result active" : "workspace-search-result"}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => onOpenResult?.(result)}
                title={result.relativePath || result.url || result.title}
              >
                <span className="workspace-search-result-icon"><ResultIcon size={16} aria-hidden="true" /></span>
                <span className="workspace-search-result-content">
                  <span className="workspace-search-result-heading">
                    <strong>{result.title || result.name || result.relativePath || "未命名资料"}</strong>
                    <span className={web ? "research-search-scope is-web" : "research-search-scope"}>{researchScopeLabel(result)}</span>
                  </span>
                  <span className="workspace-search-result-path">{result.relativePath || result.url}</span>
                  {result.snippet ? (
                    <span className="workspace-search-result-snippet">
                      <MatchSnippet snippet={result.snippet} ranges={researchResultRanges(result)} />
                    </span>
                  ) : null}
                  {result.page ? <small className="research-search-page">第 {result.page} 页</small> : null}
                  {result.indexedTextSkipped ? (
                    <small className="research-search-warning">{result.indexWarning || "正文未建立索引，仍可按名称和路径搜索"}</small>
                  ) : result.indexedTextTruncated ? (
                    <small className="research-search-warning">正文过大，仅搜索了已索引部分</small>
                  ) : null}
                </span>
              </button>
            );
          }) : null}
        </div>
        {query.trim() && !error ? (
          <footer className="workspace-search-footer">
            <span>{loading ? "正在更新资料索引" : `${results.length} 个结果`}</span>
            <span>{warnings.length ? `${warnings.length} 项无法完整解析` : "范围：本地资料 · 公区网页 · 当前私区网页"}</span>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
