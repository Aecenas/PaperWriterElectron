import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Hash,
  X,
} from "lucide-react";
import { formatCitationSource } from "./knowledge-extensions.js";
import "./knowledge-dialogs.css";

const CITATION_TYPES = [
  ["book", "图书"],
  ["article", "文章"],
  ["web", "网页"],
  ["pdf", "PDF"],
  ["report", "报告"],
  ["thesis", "学位论文"],
  ["other", "其他"],
];
const EMPTY_CITATION_SOURCE = Object.freeze({});

function KnowledgeSelect({ label, value, options, onChange }) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const activeLabel = options.find(([optionValue]) => optionValue === value)?.[1] || options[0]?.[1] || "请选择";

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    window.document.addEventListener("pointerdown", closeOutside, true);
    return () => window.document.removeEventListener("pointerdown", closeOutside, true);
  }, [open]);

  return (
    <div className="knowledge-field">
      <span>{label}</span>
      <div
        ref={rootRef}
        className={`knowledge-custom-control${open ? " is-open" : ""}`}
        data-knowledge-popup-open={open || undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            rootRef.current?.querySelector("button")?.focus();
          }
        }}
      >
        <button type="button" className="knowledge-custom-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <span>{activeLabel}</span><ChevronDown size={15} aria-hidden="true" />
        </button>
        {open ? (
          <div className="knowledge-select-menu" role="listbox" aria-label={label}>
            {options.map(([optionValue, optionLabel]) => (
              <button
                key={optionValue}
                type="button"
                role="option"
                aria-selected={optionValue === value}
                onClick={() => { onChange(optionValue); setOpen(false); }}
              >
                <span>{optionLabel}</span>{optionValue === value ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function parseLocalDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalDate(date) {
  const two = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

function KnowledgeDatePicker({ label, value, onChange }) {
  const rootRef = useRef(null);
  const selectedDate = parseLocalDate(value);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initial = selectedDate || new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });

  useEffect(() => {
    if (!open) return undefined;
    const initial = selectedDate || new Date();
    setVisibleMonth(new Date(initial.getFullYear(), initial.getMonth(), 1));
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    window.document.addEventListener("pointerdown", closeOutside, true);
    return () => window.document.removeEventListener("pointerdown", closeOutside, true);
  }, [open, value]);

  const calendarDays = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const leading = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    return [
      ...Array.from({ length: leading }, (_, index) => ({ key: `blank-${index}`, blank: true })),
      ...Array.from({ length: total }, (_, index) => {
        const date = new Date(year, month, index + 1);
        return { key: formatLocalDate(date), date, day: index + 1 };
      }),
    ];
  }, [visibleMonth]);

  return (
    <div className="knowledge-field">
      <span>{label}</span>
      <div
        ref={rootRef}
        className={`knowledge-custom-control knowledge-date-control${open ? " is-open" : ""}`}
        data-knowledge-popup-open={open || undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            rootRef.current?.querySelector("button")?.focus();
          }
        }}
      >
        <button type="button" className="knowledge-custom-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <span className={value ? "" : "is-placeholder"}>{value || "选择日期"}</span><CalendarDays size={15} aria-hidden="true" />
        </button>
        {open ? (
          <div className="knowledge-date-popover" role="dialog" aria-label={`${label}日期选择器`}>
            <div className="knowledge-date-heading">
              <button type="button" aria-label="上一个月" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
              <strong>{visibleMonth.getFullYear()} 年 {visibleMonth.getMonth() + 1} 月</strong>
              <button type="button" aria-label="下一个月" onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight size={15} /></button>
            </div>
            <div className="knowledge-date-weekdays" aria-hidden="true">{["日", "一", "二", "三", "四", "五", "六"].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="knowledge-date-grid">
              {calendarDays.map((item) => item.blank ? <span key={item.key} /> : (
                <button
                  key={item.key}
                  type="button"
                  className={item.key === value ? "is-selected" : ""}
                  aria-label={item.key}
                  aria-pressed={item.key === value}
                  onClick={() => { onChange(item.key); setOpen(false); }}
                >{item.day}</button>
              ))}
            </div>
            <div className="knowledge-date-actions">
              <button type="button" onClick={() => { onChange(""); setOpen(false); }}>清除</button>
              <button type="button" onClick={() => { onChange(formatLocalDate(new Date())); setOpen(false); }}>今天</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DialogFrame({ title, eyebrow, icon: Icon, busy, onClose, onSubmit, children, actions, className = "" }) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  useEffect(() => {
    previousFocusRef.current = window.document.activeElement;
    return () => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) window.requestAnimationFrame(() => previousFocus.focus?.());
    };
  }, []);
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busy) {
        if (dialogRef.current?.querySelector('[data-knowledge-popup-open="true"]')) return;
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key === "Tab") {
        const focusable = [...(dialogRef.current?.querySelectorAll?.('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [busy, onClose]);

  const Frame = onSubmit ? "form" : "section";
  return createPortal(
    <div className="app-confirm-overlay dialog-scrim" role="presentation" onMouseDown={() => { if (!busy) onClose?.(); }}>
      <Frame ref={dialogRef} className={`knowledge-form-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby="knowledge-form-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={onSubmit}>
        <header>
          <span className="knowledge-form-mark" aria-hidden="true"><Icon size={21} /></span>
          <span><small>{eyebrow}</small><h2 id="knowledge-form-title">{title}</h2></span>
          <button type="button" className="knowledge-form-close" onClick={onClose} disabled={busy} aria-label={`关闭${title}`}><X size={18} /></button>
        </header>
        <div className="knowledge-form-body">{children}</div>
        <footer>{actions}</footer>
      </Frame>
    </div>,
    window.document.body,
  );
}

export function FootnoteDialog({ dialog, onClose, onSubmit }) {
  const inputRef = useRef(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dialog?.open) return undefined;
    setText(dialog.footnote?.text || "");
    setError("");
    setBusy(false);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [dialog?.footnote, dialog?.open]);

  if (!dialog?.open) return null;

  const submit = async (event) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) {
      setError("请输入脚注内容");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await onSubmit?.(value);
      if (result === false || result?.ok === false) throw new Error(result?.error || "脚注保存失败");
      onClose?.({ saved: true });
    } catch (submitError) {
      setError(submitError?.message || "脚注保存失败");
      setBusy(false);
    }
  };

  return (
      <DialogFrame
        title={dialog.footnote ? "编辑脚注" : "新建脚注"}
        eyebrow="注引 · 脚注"
        icon={Hash}
        busy={busy}
        onClose={onClose}
        onSubmit={submit}
        className="footnote-form-dialog"
        actions={<><button type="button" className="ghost" onClick={onClose} disabled={busy}>取消</button><button type="submit" className="primary" disabled={busy}><Check size={15} />{busy ? "保存中…" : (dialog.footnote ? "保存" : "插入脚注")}</button></>}
      >
        <label className="knowledge-field is-wide">
          <span>脚注内容</span>
          <textarea ref={inputRef} rows={8} maxLength={20000} value={text} onChange={(event) => setText(event.target.value)} placeholder="输入脚注内容，可使用多行" />
          <small>{text.length.toLocaleString("zh-CN")} / 20,000</small>
        </label>
        {error ? <p className="knowledge-form-error" role="alert">{error}</p> : null}
      </DialogFrame>
  );
}

function hasAdvancedCitationFields(source) {
  return ["containerTitle", "publisher", "url", "doi", "isbn", "pages", "accessedAt", "notes"].some((field) => Boolean(source?.[field]));
}

export function CitationSourceDialog({ dialog, onClose, onSubmit }) {
  const titleRef = useRef(null);
  const source = dialog?.source || EMPTY_CITATION_SOURCE;
  const [values, setValues] = useState({});
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dialog?.open) return undefined;
    setValues({
      type: source.type || "other",
      title: source.title || "",
      authors: Array.isArray(source.authors) ? source.authors.join("，") : "",
      year: source.year || "",
      containerTitle: source.containerTitle || "",
      publisher: source.publisher || "",
      url: source.url || "",
      doi: source.doi || "",
      isbn: source.isbn || "",
      pages: source.pages || "",
      accessedAt: String(source.accessedAt || "").slice(0, 10),
      notes: source.notes || "",
      citationPage: dialog.citationPage || "",
    });
    setAdvanced(hasAdvancedCitationFields(source));
    setError("");
    setFieldErrors({});
    setBusy(false);
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [dialog?.citationPage, dialog?.open, source]);

  const set = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setFieldErrors((current) => current[field] ? { ...current, [field]: "" } : current);
  };
  const setValue = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => current[field] ? { ...current, [field]: "" } : current);
  };
  if (!dialog?.open) return null;

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    let normalizedUrl = values.url?.trim() || "";
    if (normalizedUrl) {
      try {
        const parsed = new URL(normalizedUrl);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
        normalizedUrl = parsed.href;
      } catch {
        setFieldErrors({ url: "仅支持不含账号信息的 HTTP 或 HTTPS 地址" });
        setAdvanced(true);
        return;
      }
    }
    if (!values.title?.trim() && !normalizedUrl && !values.doi?.trim()) {
      setFieldErrors({ title: "题名、网址或 DOI 至少填写一项" });
      titleRef.current?.focus();
      return;
    }
    const payload = {
      ...source,
      type: values.type,
      title: values.title.trim(),
      authors: values.authors.split(/[，,；;]/).map((item) => item.trim()).filter(Boolean),
      year: values.year.trim(),
      containerTitle: values.containerTitle.trim(),
      publisher: values.publisher.trim(),
      url: normalizedUrl,
      doi: values.doi.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, ""),
      isbn: values.isbn.trim(),
      pages: values.pages.trim(),
      accessedAt: values.accessedAt || "",
      notes: values.notes.trim(),
    };
    setBusy(true);
    try {
      const result = await onSubmit?.(payload, values.citationPage.trim());
      if (result === false || result?.ok === false) throw new Error(result?.error || "参考文献来源保存失败");
      onClose?.({ saved: true });
    } catch (submitError) {
      setError(submitError?.message || "参考文献来源保存失败");
      setBusy(false);
    }
  };

  return (
      <DialogFrame
        title={source.id ? "编辑参考文献来源" : "新增参考文献来源"}
        eyebrow={dialog.insertTarget ? "文献引用 · 新增并引用" : "注引 · 参考文献来源"}
        icon={BookOpen}
        busy={busy}
        onClose={onClose}
        onSubmit={submit}
        className="citation-source-form-dialog"
        actions={<><button type="button" className="ghost" onClick={onClose} disabled={busy}>取消</button><button type="submit" className="primary" disabled={busy}><Check size={15} />{busy ? "保存中…" : (dialog.insertTarget ? "保存并插入" : "保存来源")}</button></>}
      >
        <div className="knowledge-field-grid">
          <KnowledgeSelect label="类型" value={values.type || "other"} options={CITATION_TYPES} onChange={(value) => setValue("type", value)} />
          <label className="knowledge-field"><span>年份</span><input value={values.year || ""} maxLength={32} onChange={set("year")} placeholder="例如 2026" /></label>
          <label className="knowledge-field is-wide"><span>题名</span><input ref={titleRef} value={values.title || ""} maxLength={1000} onChange={set("title")} placeholder="题名、网址或 DOI 至少填写一项" aria-invalid={Boolean(fieldErrors.title)} />{fieldErrors.title ? <small className="knowledge-field-error">{fieldErrors.title}</small> : null}</label>
          <label className="knowledge-field is-wide"><span>作者</span><input value={values.authors || ""} maxLength={20000} onChange={set("authors")} placeholder="多人可用逗号或分号分隔" /></label>
          {dialog.insertTarget ? <label className="knowledge-field is-wide"><span>本次引用页码</span><input value={values.citationPage || ""} maxLength={128} onChange={set("citationPage")} placeholder="可留空，例如 18–20" /></label> : null}
        </div>
        <button type="button" className={advanced ? "knowledge-advanced-toggle is-open" : "knowledge-advanced-toggle"} onClick={() => setAdvanced((open) => !open)} aria-expanded={advanced}><ChevronDown size={16} />高级书目信息</button>
        {advanced ? (
          <div className="knowledge-field-grid knowledge-advanced-fields">
            <label className="knowledge-field"><span>载体／刊物名</span><input value={values.containerTitle || ""} maxLength={1000} onChange={set("containerTitle")} /></label>
            <label className="knowledge-field"><span>出版社</span><input value={values.publisher || ""} maxLength={500} onChange={set("publisher")} /></label>
            <label className="knowledge-field is-wide"><span>网址</span><input value={values.url || ""} maxLength={2048} onChange={set("url")} placeholder="https://" aria-invalid={Boolean(fieldErrors.url)} />{fieldErrors.url ? <small className="knowledge-field-error">{fieldErrors.url}</small> : null}</label>
            <label className="knowledge-field"><span>DOI</span><input value={values.doi || ""} maxLength={300} onChange={set("doi")} /></label>
            <label className="knowledge-field"><span>ISBN</span><input value={values.isbn || ""} maxLength={64} onChange={set("isbn")} /></label>
            <label className="knowledge-field"><span>来源页码</span><input value={values.pages || ""} maxLength={128} onChange={set("pages")} /></label>
            <KnowledgeDatePicker label="访问日期" value={values.accessedAt || ""} onChange={(value) => setValue("accessedAt", value)} />
            <label className="knowledge-field is-wide"><span>备注</span><textarea rows={4} maxLength={10000} value={values.notes || ""} onChange={set("notes")} /></label>
          </div>
        ) : null}
        {error ? <p className="knowledge-form-error" role="alert">{error}</p> : null}
      </DialogFrame>
  );
}

export function KnowledgeReferencePopover({ popover, onClose }) {
  const popoverRef = useRef(null);
  const [position, setPosition] = useState(null);
  const sourceDetails = useMemo(() => {
    if (popover?.kind !== "citation" || !popover.source) return [];
    const source = popover.source;
    return [
      ["类型", CITATION_TYPES.find(([value]) => value === source.type)?.[1]],
      ["作者", Array.isArray(source.authors) ? source.authors.join("、") : ""],
      ["年份", source.year],
      ["载体／刊物", source.containerTitle],
      ["出版社", source.publisher],
      ["来源页码", source.pages],
      ["DOI", source.doi],
      ["ISBN", source.isbn],
      ["网址", source.url],
      ["访问日期", String(source.accessedAt || "").slice(0, 10)],
    ].filter(([, value]) => Boolean(value));
  }, [popover]);

  useLayoutEffect(() => {
    if (!popover) return undefined;
    const place = () => {
      const anchor = popover.anchorElement;
      if (!anchor?.isConnected) { onClose?.(); return; }
      const anchorRect = anchor.getBoundingClientRect();
      const cardRect = popoverRef.current?.getBoundingClientRect();
      const width = cardRect?.width || 360;
      const height = cardRect?.height || 220;
      const margin = 10;
      const left = Math.max(margin, Math.min(window.innerWidth - width - margin, anchorRect.left));
      const below = anchorRect.bottom + 8;
      const top = below + height <= window.innerHeight - margin ? below : Math.max(48, anchorRect.top - height - 8);
      setPosition({ left, top });
    };
    place();
    const frame = window.requestAnimationFrame(() => { place(); popoverRef.current?.focus(); });
    const handlePointerDown = (event) => {
      if (popoverRef.current?.contains(event.target) || popover.anchorElement?.contains?.(event.target)) return;
      onClose?.({ restoreFocus: true });
    };
    const handleKeyDown = (event) => { if (event.key === "Escape") { event.preventDefault(); onClose?.({ restoreFocus: true }); } };
    window.document.addEventListener("pointerdown", handlePointerDown, true);
    window.document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.document.removeEventListener("pointerdown", handlePointerDown, true);
      window.document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [onClose, popover]);

  if (!popover) return null;
  const title = popover.kind === "footnote"
    ? `脚注 ${popover.number}`
    : `[${popover.number}] ${popover.source?.title || "参考文献来源"}`;
  return createPortal(
    <aside ref={popoverRef} className="knowledge-reference-popover" role="dialog" aria-modal="false" aria-label={title} tabIndex={-1} style={position || { visibility: "hidden" }}>
      <header><span>{popover.kind === "footnote" ? <Hash size={16} /> : <BookOpen size={16} />}</span><strong>{title}</strong><button type="button" onClick={() => onClose?.({ restoreFocus: true })} aria-label="关闭注引详情"><X size={15} /></button></header>
      {popover.kind === "footnote" ? (
        <p className="knowledge-reference-footnote">{popover.footnote?.text || "脚注内容缺失"}</p>
      ) : (
        <div className="knowledge-reference-citation">
          <p className="knowledge-reference-summary">{popover.source ? formatCitationSource(popover.source) : "来源信息缺失"}</p>
          {popover.pages ? <p className="knowledge-reference-current-page"><strong>本次引用页码</strong><span>{popover.pages}</span></p> : null}
          {sourceDetails.length ? <dl>{sourceDetails.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
          {popover.source?.notes ? <p className="knowledge-reference-notes"><strong>备注</strong><span>{popover.source.notes}</span></p> : null}
        </div>
      )}
    </aside>,
    window.document.body,
  );
}
