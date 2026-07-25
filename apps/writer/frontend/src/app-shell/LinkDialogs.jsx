import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Link2,
  NotebookPen,
  Search,
  Unlink,
  X,
} from "lucide-react";
import { normalizeLinkUrl } from "../editor/index.js";

export function LinkDialog({ dialog, onClose, onSubmit, onRemove }) {
  const textRef = useRef(null);
  const urlRef = useRef(null);
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!dialog) {
      return undefined;
    }
    setText(dialog.text || "");
    setUrl(dialog.url || "");
    setError("");
    const frame = window.requestAnimationFrame(() => {
      const target = dialog.text ? urlRef.current : textRef.current;
      target?.focus();
      target?.select();
    });
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [dialog, onClose]);

  if (!dialog) {
    return null;
  }

  const submit = (event) => {
    event.preventDefault();
    const normalized = normalizeLinkUrl(url);
    if (!normalized.ok) {
      setError(normalized.error);
      urlRef.current?.focus();
      return;
    }
    onSubmit({ text: text.trim() || normalized.url, url: normalized.url });
  };

  return createPortal(
    <div className="app-confirm-overlay dialog-scrim" role="presentation" onMouseDown={onClose}>
      <form className="app-confirm-dialog app-link-dialog" role="dialog" aria-modal="true" aria-labelledby="app-link-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}>
        <button type="button" className="app-confirm-close" onClick={onClose} aria-label="关闭链接窗口" title="关闭">
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true">
          <Link2 size={24} />
        </div>
        <div className="app-confirm-copy">
          <span>媒体 · 链接</span>
          <h2 id="app-link-title">{dialog.editing ? "编辑链接" : "插入链接"}</h2>
          <label className="app-prompt-field">
            <span>显示文字</span>
            <input ref={textRef} type="text" value={text} placeholder="链接文字" maxLength={500} onChange={(event) => setText(event.target.value)} />
          </label>
          <label className="app-prompt-field">
            <span>链接地址</span>
            <input ref={urlRef} type="text" value={url} placeholder="https://example.com" aria-invalid={Boolean(error)} aria-describedby={error ? "app-link-error" : undefined} onChange={(event) => { setUrl(event.target.value); setError(""); }} />
          </label>
          {error ? <p className="app-link-error" id="app-link-error" role="alert">{error}</p> : null}
        </div>
        <footer className="app-confirm-actions">
          {dialog.editing ? (
            <button type="button" className="danger" onClick={onRemove}>
              <Unlink size={15} />
              <span>移除链接</span>
            </button>
          ) : null}
          <span className="app-link-action-spacer" />
          <button type="button" className="ghost" onClick={onClose}>取消</button>
          <button type="submit" className="primary">
            <Check size={15} />
            <span>{dialog.editing ? "保存" : "插入"}</span>
          </button>
        </footer>
      </form>
    </div>,
    window.document.body,
  );
}

export function InternalLinkPicker({ picker, documents = [], onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const resultRefs = useRef([]);
  const matchingDocuments = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-US");
    const ordered = [...documents].sort((left, right) => String(left.relativePath || left.path || left.title || "")
      .localeCompare(String(right.relativePath || right.path || right.title || ""), "zh-CN"));
    if (!needle) return ordered;
    return ordered.filter((item) => `${item.title || ""}\n${item.relativePath || item.path || ""}`
      .toLocaleLowerCase("en-US").includes(needle));
  }, [documents, query]);
  const filtered = matchingDocuments.slice(0, 500);

  useEffect(() => {
    if (!picker) return undefined;
    setQuery("");
    setActiveIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
    return undefined;
  }, [onClose, picker]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, filtered.length]);

  useEffect(() => {
    resultRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose?.();
      return;
    }
    if (event.key === "ArrowDown" && filtered.length) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % filtered.length);
      return;
    }
    if (event.key === "ArrowUp" && filtered.length) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + filtered.length) % filtered.length);
      return;
    }
    if (event.key === "Enter" && filtered[activeIndex]) {
      event.preventDefault();
      onSelect?.(filtered[activeIndex]);
    }
  };

  if (!picker) return null;
  return createPortal(
    <div className="internal-link-picker-overlay dialog-scrim" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="internal-link-picker" role="dialog" aria-modal="true" aria-label="插入关联信笺" onKeyDown={handleKeyDown}>
        <header className="internal-link-picker-heading">
          <span><Link2 size={16} aria-hidden="true" /><strong>插入关联信笺</strong><small>当前工作区及全部子文件夹</small></span>
          <button type="button" onClick={onClose} aria-label="关闭关联信笺选择器" title="关闭（Esc）"><X size={16} aria-hidden="true" /></button>
        </header>
        <label className="internal-link-picker-input">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={Boolean(filtered.length)}
            aria-controls="internal-link-picker-results"
            aria-activedescendant={filtered[activeIndex] ? `internal-link-picker-result-${activeIndex}` : undefined}
            value={query}
            placeholder="搜索当前工作区信笺"
            onChange={(event) => setQuery(event.target.value)}
          />
          <small>{matchingDocuments.length > filtered.length ? `显示 ${filtered.length} / ${matchingDocuments.length}` : `${filtered.length} 个结果`}</small>
        </label>
        <div id="internal-link-picker-results" className="internal-link-picker-results" role="listbox" aria-live="polite">
          {filtered.length ? filtered.map((item, index) => (
            <button
              ref={(element) => { resultRefs.current[index] = element; }}
              id={`internal-link-picker-result-${index}`}
              key={`${item.documentId}-${item.path}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => onSelect?.(item)}
              title={item.relativePath || item.path || item.title}
            >
              <span className="internal-link-picker-result-icon"><NotebookPen size={16} aria-hidden="true" /></span>
              <span className="internal-link-picker-result-copy"><strong>{item.title || "未命名信笺"}</strong><small>{item.relativePath || item.path}</small></span>
            </button>
          )) : <p>{documents.length ? "没有匹配的信笺" : "当前工作区还没有可关联的其他信笺"}</p>}
        </div>
        <footer className="internal-link-picker-footer"><span>↑↓ 选择 · Enter 插入 · Esc 关闭</span><span>范围：当前工作区及全部子文件夹</span></footer>
      </section>
    </div>,
    window.document.body,
  );
}
