import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BookOpen,
  Check,
  ChevronDown,
  ExternalLink,
  FileSearch,
  FileUp,
  Globe2,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Settings,
  Settings2,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { bridge } from "../bridge.js";
import { isTopModalDialog, useModalFocusTrap } from "../ui-interactions.js";
import {
  citationSearchText,
  citationStyleChoiceFromPickerResult,
  createCitationImportPreview,
  FALLBACK_CITATION_STYLES,
  mergeCitationImportPreview,
  normalizeCitationStyleChoice,
} from "./model.js";
import "./citation-library-panel.css";

const DIFFERENCE_LABELS = Object.freeze({
  title: "题名",
  authors: "作者",
  year: "年份",
  containerTitle: "期刊 / 文集",
  publisher: "出版者",
  url: "网址",
  doi: "DOI",
  isbn: "ISBN",
  pages: "页码",
});

function displayValue(value) {
  if (Array.isArray(value)) return value.join("、") || "—";
  return String(value || "—");
}

function sourceSummary(source = {}) {
  return [
    Array.isArray(source.authors) ? source.authors.join("、") : "",
    source.year,
    source.containerTitle || source.publisher,
  ].filter(Boolean).join(" · ") || source.doi || source.isbn || source.url || "书目信息待完善";
}

function ScopeMark({ scope }) {
  return scope === "public" ? <Globe2 size={15} aria-hidden="true" /> : <BookOpen size={15} aria-hidden="true" />;
}

function CitationSelect({ label, value, options, onChange, disabled = false }) {
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

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div
      ref={rootRef}
      className={`citation-custom-select${open ? " is-open" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          rootRef.current?.querySelector("button")?.focus();
        }
      }}
    >
      <button type="button" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{activeLabel}</span><ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="citation-custom-select-menu" role="listbox" aria-label={label}>
          {options.map(([optionValue, optionLabel]) => (
            <button key={optionValue} type="button" role="option" aria-selected={optionValue === value} onClick={() => { onChange(optionValue); setOpen(false); }}>
              <span>{optionLabel}</span>{optionValue === value ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CitationConflictPreview({
  previewState,
  decisions,
  onDecision,
  onCancel,
  onConfirm,
  busy,
}) {
  const preview = previewState?.preview;
  if (!preview) return null;
  return (
    <section className="citation-conflict-preview" aria-labelledby="citation-conflict-title">
      <header>
        <div>
          <small>{previewState.label}</small>
          <h3 id="citation-conflict-title">确认文献变更</h3>
        </div>
        <button type="button" className="professional-icon-button" onClick={onCancel} aria-label="关闭冲突预览"><X size={16} /></button>
      </header>
      <div className="citation-conflict-summary" role="status">
        <span><b>{preview.counts.new}</b> 条新增</span>
        <span><b>{preview.counts.conflict}</b> 条冲突</span>
        <span><b>{preview.counts.duplicate}</b> 条重复</span>
      </div>
      <div className="citation-conflict-list">
        {preview.entries.map((entry) => (
          <article key={entry.id} className={`citation-conflict-item is-${entry.status}`}>
            <div className="citation-conflict-item-heading">
              <strong>{entry.source?.title || "未命名来源"}</strong>
              <small>{entry.status === "new" ? "新增" : (entry.status === "duplicate" ? "完全重复" : "需要选择")}</small>
            </div>
            {entry.status === "conflict" ? (
              <>
                <div className="citation-conflict-differences">
                  {entry.differences.map((difference) => (
                    <div key={difference.field}>
                      <b>{DIFFERENCE_LABELS[difference.field] || difference.field}</b>
                      <span title={displayValue(difference.existing)}>当前：{displayValue(difference.existing)}</span>
                      <span title={displayValue(difference.incoming)}>导入：{displayValue(difference.incoming)}</span>
                    </div>
                  ))}
                </div>
                <fieldset>
                  <legend>处理方式</legend>
                  <label><input type="radio" name={`citation-conflict-${entry.id}`} checked={decisions[entry.id] === "merge"} onChange={() => onDecision(entry.id, "merge")} />合并（只补齐空字段）</label>
                  <label><input type="radio" name={`citation-conflict-${entry.id}`} checked={decisions[entry.id] === "keep-both"} onChange={() => onDecision(entry.id, "keep-both")} />保留两份</label>
                  <label><input type="radio" name={`citation-conflict-${entry.id}`} checked={(decisions[entry.id] || "skip") === "skip"} onChange={() => onDecision(entry.id, "skip")} />跳过</label>
                </fieldset>
              </>
            ) : <p>{entry.status === "new" ? sourceSummary(entry.source) : "已有文献与导入记录一致，将跳过。"}</p>}
          </article>
        ))}
      </div>
      <footer>
        <button type="button" className="professional-secondary-button" onClick={onCancel}>取消</button>
        <button type="button" className="professional-primary-button" disabled={busy} onClick={onConfirm}>
          {busy ? <LoaderCircle className="research-spin" size={15} /> : <Check size={15} />}应用变更
        </button>
      </footer>
    </section>
  );
}

export function CitationLibraryPanel({
  open = true,
  embedded = true,
  sources = [],
  privateSources = sources,
  publicSources = [],
  citationOrder = [],
  citationStyle,
  loading = false,
  readOnly = false,
  privateReadOnly = readOnly,
  citationApi = bridge,
  onStyleChange,
  onAddSource,
  onEditSource,
  onDeleteSource,
  onCopyToPublic,
  onAttachPublic,
  onImportSources,
  onJumpCitationSource,
  onOpenExternal = (url) => bridge.openExternal?.(url),
  onClose,
}) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const [managerOpen, setManagerOpen] = useState(!embedded);
  const [scope, setScope] = useState("private");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [advancedFormat, setAdvancedFormat] = useState("ris");
  const [moreOpen, setMoreOpen] = useState(false);
  const [lookupKind, setLookupKind] = useState("doi");
  const [lookupValue, setLookupValue] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState({ type: "", text: "" });
  const [previewState, setPreviewState] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [styleChoice, setStyleChoice] = useState(() => normalizeCitationStyleChoice(citationStyle));
  const [styles, setStyles] = useState(FALLBACK_CITATION_STYLES);
  const [privacyConsent, setPrivacyConsent] = useState(() => {
    try {
      return globalThis.localStorage?.getItem("jianjian.citation-lookup-privacy.v1") === "accepted";
    } catch {
      return false;
    }
  });
  const [privacyPromptOpen, setPrivacyPromptOpen] = useState(false);

  useModalFocusTrap(managerOpen, dialogRef, searchRef);

  useEffect(() => {
    setStyleChoice(normalizeCitationStyleChoice(citationStyle));
  }, [citationStyle?.customStyle?.hash, citationStyle?.customStyle?.styleId, citationStyle?.customStyle?.xml, citationStyle?.locale, citationStyle?.styleId]);

  useEffect(() => {
    if (!managerOpen || typeof citationApi?.listCitationStyles !== "function") return undefined;
    let active = true;
    citationApi.listCitationStyles().then((items) => {
      if (active && Array.isArray(items) && items.length) setStyles(items);
    }).catch(() => {
      if (active) setStyles(FALLBACK_CITATION_STYLES);
    });
    return () => { active = false; };
  }, [citationApi, managerOpen]);

  useEffect(() => {
    if (!managerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && isTopModalDialog(dialogRef)) {
        event.preventDefault();
        setManagerOpen(false);
      }
    };
    window.document.addEventListener("keydown", onKeyDown, true);
    return () => window.document.removeEventListener("keydown", onKeyDown, true);
  }, [managerOpen]);

  useEffect(() => {
    if (!managerOpen || !selectedSourceId) return;
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector(`[data-citation-source-id="${selectedSourceId}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }, [managerOpen, scope, selectedSourceId]);

  const normalizedPrivateSources = Array.isArray(privateSources) ? privateSources : [];
  const normalizedPublicSources = Array.isArray(publicSources) ? publicSources : [];
  const sourceById = useMemo(() => new Map(normalizedPrivateSources.map((source) => [source.id, source])), [normalizedPrivateSources]);
  const usedSources = useMemo(() => citationOrder.map((id) => sourceById.get(id)).filter(Boolean), [citationOrder, sourceById]);
  const citedIds = useMemo(() => new Set(citationOrder), [citationOrder]);
  const activeSources = scope === "public" ? normalizedPublicSources : normalizedPrivateSources;
  const visibleSources = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return needle ? activeSources.filter((source) => citationSearchText(source).includes(needle)) : activeSources;
  }, [activeSources, query]);
  const activeReadOnly = scope === "private" && privateReadOnly;
  const selectableStyles = useMemo(() => {
    const customStyle = styleChoice.customStyle;
    if (!customStyle || styles.some((style) => style.styleId === customStyle.styleId)) return styles;
    return [...styles, { styleId: customStyle.styleId, locale: styleChoice.locale, label: `${customStyle.title}（自定义）` }];
  }, [styleChoice.customStyle, styleChoice.locale, styles]);

  if (!open) return null;

  const openManager = (nextScope = "private", sourceId = "") => {
    setScope(nextScope === "public" ? "public" : "private");
    setSelectedSourceId(sourceId);
    setQuery("");
    setNotice({ type: "", text: "" });
    setPreviewState(null);
    setManagerOpen(true);
  };

  const closeManager = () => {
    setManagerOpen(false);
    setPreviewState(null);
    setDecisions({});
    if (!embedded) onClose?.();
  };

  const changeScope = (nextScope) => {
    setScope(nextScope);
    setSelectedSourceId("");
    setQuery("");
    setNotice({ type: "", text: "" });
    setPreviewState(null);
  };

  const openPreview = (incoming, label, { defaultConflictDecision = "skip" } = {}) => {
    const preview = createCitationImportPreview(activeSources, incoming);
    setDecisions(Object.fromEntries(preview.entries.filter((entry) => entry.status === "conflict").map((entry) => [entry.id, defaultConflictDecision])));
    setPreviewState({ label, preview, scope });
  };

  const importSources = async (format = "bibtex") => {
    if (activeReadOnly || typeof citationApi?.pickCitationImport !== "function") {
      setNotice({ type: "error", text: "当前环境不支持向这个文献域导入文件。" });
      return;
    }
    setBusy(`import-${format}`);
    setNotice({ type: "", text: "" });
    try {
      const result = await citationApi.pickCitationImport({ format });
      if (result?.canceled) return;
      if (format !== result?.format) throw new Error(`请选择 ${format === "bibtex" ? "BibTeX" : (format === "ris" ? "RIS" : "CSL-JSON")} 文件`);
      openPreview(result?.sources || [], `导入到${scope === "public" ? "公域" : "私域"} · ${result.format}`);
    } catch (error) {
      setNotice({ type: "error", text: error?.message || "导入文献失败" });
    } finally {
      setBusy("");
    }
  };

  const exportSources = async (format = "bibtex", source = null) => {
    if (typeof citationApi?.saveCitationExport !== "function") {
      setNotice({ type: "error", text: "当前环境不支持保存文献文件。" });
      return;
    }
    const exportBusyKey = `export-${format}${source?.id ? `-${source.id}` : ""}`;
    setBusy(exportBusyKey);
    setNotice({ type: "", text: "" });
    try {
      const result = await citationApi.saveCitationExport({ sources: source ? [source] : activeSources, format });
      if (!result?.canceled) setNotice({ type: "success", text: `已导出${source?.title ? `《${source.title}》` : `${scope === "public" ? "公域" : "私域"}文献`}到 ${result?.filePath || "所选位置"}` });
    } catch (error) {
      setNotice({ type: "error", text: error?.message || "导出文献失败" });
    } finally {
      setBusy("");
    }
  };

  const applyPreview = async () => {
    const previewScope = previewState?.scope || scope;
    const base = previewScope === "public" ? normalizedPublicSources : normalizedPrivateSources;
    const next = mergeCitationImportPreview(base, previewState?.preview, decisions);
    setBusy("apply-import");
    try {
      await onImportSources?.(previewScope, next);
      setPreviewState(null);
      setDecisions({});
      setNotice({ type: "success", text: `已更新${previewScope === "public" ? "公域" : "私域"}文献。` });
    } catch (error) {
      setNotice({ type: "error", text: error?.message || "应用文献变更失败" });
    } finally {
      setBusy("");
    }
  };

  const updateStyle = (patch) => {
    const next = normalizeCitationStyleChoice({ ...styleChoice, ...patch });
    setStyleChoice(next);
    onStyleChange?.(next);
  };

  const importCitationStyle = async () => {
    if (privateReadOnly || typeof citationApi?.pickCitationStyle !== "function") {
      setNotice({ type: "error", text: "当前环境不支持导入 CSL 样式。" });
      return;
    }
    setBusy("style");
    try {
      const result = await citationApi.pickCitationStyle();
      if (result?.canceled) return;
      const next = citationStyleChoiceFromPickerResult(result, styleChoice.locale);
      if (!next) throw new Error("CSL 样式身份或校验和无效");
      setStyleChoice(next);
      onStyleChange?.(next);
      setNotice({ type: "success", text: `已启用自定义样式：${next.customStyle.title}` });
    } catch (error) {
      setNotice({ type: "error", text: error?.message || "导入 CSL 样式失败" });
    } finally {
      setBusy("");
    }
  };

  const lookup = async ({ consentGranted = privacyConsent } = {}) => {
    if (activeReadOnly || typeof citationApi?.lookupCitation !== "function") {
      setNotice({ type: "error", text: "当前环境不支持联网补全。" });
      return;
    }
    if (!consentGranted) {
      setPrivacyPromptOpen(true);
      return;
    }
    setBusy("lookup");
    try {
      const source = await citationApi.lookupCitation({ kind: lookupKind, value: lookupValue, privacyConsent: true });
      if (source) openPreview([source], `${lookupKind.toUpperCase()} 补全`, { defaultConflictDecision: "merge" });
    } catch (error) {
      setNotice({ type: "error", text: error?.message || "文献补全失败" });
    } finally {
      setBusy("");
    }
  };

  const acceptPrivacyAndLookup = async () => {
    try {
      globalThis.localStorage?.setItem("jianjian.citation-lookup-privacy.v1", "accepted");
    } catch {
      // This invocation is still explicitly consented; persistence remains fail closed.
    }
    setPrivacyConsent(true);
    setPrivacyPromptOpen(false);
    await lookup({ consentGranted: true });
  };

  const toggleSearch = () => {
    if (searchOpen) {
      setSearchOpen(false);
      setQuery("");
      return;
    }
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchRef.current?.focus());
  };

  const modal = managerOpen ? createPortal(
    <div className="settings-feature-overlay citation-library-overlay dialog-scrim dialog-scrim--large" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeManager(); }}>
      <section ref={dialogRef} className="settings-feature-dialog citation-library-dialog" role="dialog" aria-modal="true" aria-labelledby="citation-library-dialog-title">
        <header className="settings-feature-dialog-header">
          <div className="writing-settings-titlecopy">
            <span className="writing-settings-title-icon" aria-hidden="true"><BookOpen size={23} /></span>
            <div>
              <small className="citation-library-eyebrow">文献库 · {scope === "public" ? "公域" : "私域"}</small>
              <h2 id="citation-library-dialog-title">文献库管理</h2>
            </div>
          </div>
          <button type="button" onClick={closeManager} aria-label="关闭文献库管理"><X size={18} /></button>
        </header>

        <div className="citation-library-dialog-body">
          <section className="citation-library-command-panel" aria-label="文献范围">
            <div className="citation-library-scope-field">
              <span className="citation-library-field-label">文献范围</span>
              <div className="citation-scope-switch" role="tablist" aria-label="文献域">
                <button type="button" role="tab" aria-selected={scope === "private"} className={scope === "private" ? "is-active" : ""} onClick={() => changeScope("private")}>
                  <BookOpen size={17} /><span><strong>私域</strong><small>当前信笺</small></span><b>{normalizedPrivateSources.length}</b>
                </button>
                <button type="button" role="tab" aria-selected={scope === "public"} className={scope === "public" ? "is-active" : ""} onClick={() => changeScope("public")}>
                  <Globe2 size={17} /><span><strong>公域</strong><small>所有信笺</small></span><b>{normalizedPublicSources.length}</b>
                </button>
              </div>
            </div>
          </section>

          {notice.text ? (
            <p className={`citation-library-dialog-notice is-${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
              {notice.type === "error" ? <ShieldAlert size={14} /> : <Check size={14} />}<span>{notice.text}</span>
            </p>
          ) : null}

          {previewState ? (
            <CitationConflictPreview
              previewState={previewState}
              decisions={decisions}
              busy={busy === "apply-import"}
              onDecision={(id, decision) => setDecisions((current) => ({ ...current, [id]: decision }))}
              onCancel={() => { setPreviewState(null); setDecisions({}); }}
              onConfirm={applyPreview}
            />
          ) : (
            <section className="citation-library-list-shell" aria-labelledby="citation-library-list-title">
              <header>
                <div>
                  <small>{scope === "public" ? "公域" : "私域"}</small>
                  <strong id="citation-library-list-title">{scope === "public" ? "所有信笺可用的参考文献" : "当前信笺的参考文献"}</strong>
                </div>
                <div className="citation-library-list-tools" aria-label="文献列表操作">
                  <button type="button" disabled={activeReadOnly} onClick={() => onAddSource?.(scope)}><Plus size={14} />新增文献</button>
                  {searchOpen ? (
                    <div className="citation-library-header-search">
                      <Search size={14} aria-hidden="true" />
                      <input ref={searchRef} aria-label="搜索文献" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="题名、作者或 DOI" />
                      <button type="button" onClick={toggleSearch} aria-label="关闭搜索"><X size={13} /></button>
                    </div>
                  ) : <button type="button" onClick={toggleSearch}><Search size={14} />搜索文献</button>}
                  <button type="button" disabled={activeReadOnly || Boolean(busy)} onClick={() => importSources("bibtex")}>
                    {busy === "import-bibtex" ? <LoaderCircle className="research-spin" size={14} /> : <ArrowDownToLine size={14} />}导入 BibTeX
                  </button>
                </div>
                <span>{activeSources.length} 项</span>
              </header>
              <div className="citation-library-dialog-list" aria-label={`${scope === "public" ? "公域" : "私域"}文献列表`}>
                {loading ? <p className="citation-library-dialog-empty"><LoaderCircle className="research-spin" size={22} />正在读取文献库…</p> : null}
                {!loading && !visibleSources.length ? (
                  <div className="citation-library-dialog-empty">
                    <span className="citation-library-empty-mark"><ScopeMark scope={scope} /></span>
                    <strong>{activeSources.length ? "没有匹配的文献" : `${scope === "public" ? "公域" : "私域"}还没有文献`}</strong>
                    <span>{activeSources.length ? "换一个题名、作者或标识符试试。" : "新增一条文献，或从 BibTeX 文件导入。"}</span>
                  </div>
                ) : null}
                {!loading && visibleSources.map((source, index) => {
                  const cited = scope === "private" && citedIds.has(source.id);
                  return (
                    <article key={source.id} data-citation-source-id={source.id} className={`citation-library-dialog-source${selectedSourceId === source.id ? " is-selected" : ""}`}>
                      <span className="citation-library-dialog-index">{index + 1}</span>
                      <div className="citation-library-dialog-copy">
                        <div><strong>{source.title || "未命名来源"}</strong>{cited ? <em>已引用</em> : null}</div>
                        <small>{sourceSummary(source)}</small>
                      </div>
                      <nav aria-label={`${source.title || "未命名来源"}操作`}>
                        {source.url ? <button type="button" onClick={() => onOpenExternal?.(source.url)} title="打开来源网址" aria-label="打开来源网址"><ExternalLink size={15} /></button> : null}
                        <button type="button" disabled={activeReadOnly} onClick={() => onEditSource?.(source, scope)} title="编辑文献" aria-label="编辑文献"><Pencil size={15} /></button>
                        <button type="button" disabled={Boolean(busy)} onClick={() => exportSources("bibtex", source)} title="导出此文献为 BibTeX" aria-label="导出此文献为 BibTeX">
                          {busy === `export-bibtex-${source.id}` ? <LoaderCircle className="research-spin" size={15} /> : <ArrowUpFromLine size={15} />}
                        </button>
                        {scope === "private" ? (
                          <button type="button" onClick={() => onCopyToPublic?.(source)} title="复制到公域" aria-label="复制到公域"><Globe2 size={15} /><span>复制到公域</span></button>
                        ) : (
                          <button type="button" disabled={privateReadOnly || normalizedPrivateSources.some((item) => item.id === source.id)} onClick={() => onAttachPublic?.(source)} title="加入本文" aria-label="加入本文"><BookOpen size={15} /><span>{normalizedPrivateSources.some((item) => item.id === source.id) ? "已加入本文" : "加入本文"}</span></button>
                        )}
                        <button type="button" className="is-danger" disabled={activeReadOnly || cited} onClick={() => onDeleteSource?.(source, scope)} title={cited ? "正文仍在引用，不能删除" : "删除文献"} aria-label="删除文献"><Trash2 size={15} /></button>
                      </nav>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          <section className={`citation-library-more${moreOpen ? " is-open" : ""}`}>
            <button type="button" className="citation-library-more-trigger" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}>
              <span><Settings2 size={15} /><span><strong>更多工具与引用设置</strong><small>RIS、CSL-JSON、引用样式与 DOI / ISBN 补全</small></span></span>
              <ChevronDown size={16} />
            </button>
            {moreOpen ? (
              <div className="citation-library-more-body">
                <section className="citation-tool-card citation-tool-card--format">
                  <header><span><ArrowUpFromLine size={16} /></span><div><h3>其他格式</h3><p>在当前文献域导入或导出 RIS、CSL-JSON</p></div></header>
                  <div className="citation-tool-controls-row citation-tool-controls-row--format">
                    <span className="citation-tool-control-label">格式</span>
                    <div className="citation-library-secondary-toolbar">
                      <CitationSelect label="其他文献格式" value={advancedFormat} options={[["ris", "RIS"], ["csl-json", "CSL-JSON"]]} onChange={setAdvancedFormat} />
                      <button type="button" disabled={activeReadOnly || Boolean(busy)} onClick={() => importSources(advancedFormat)}><ArrowDownToLine size={14} />导入</button>
                      <button type="button" disabled={Boolean(busy) || !activeSources.length} onClick={() => exportSources(advancedFormat)}><ArrowUpFromLine size={14} />导出</button>
                    </div>
                  </div>
                </section>
                <section className="citation-tool-card citation-style-controls">
                  <header><span><Settings2 size={16} /></span><div><h3>当前信笺引用样式</h3><p>控制正文引用与文末参考文献的排版</p></div></header>
                  <div className="citation-tool-controls-row citation-tool-controls-row--style">
                    <div className="citation-style-fields">
                      <label><span>样式</span><CitationSelect label="引用样式" value={styleChoice.styleId} disabled={privateReadOnly} options={selectableStyles.map((style) => [style.styleId, style.label || style.styleId])} onChange={(styleId) => { const selected = styles.find((style) => style.styleId === styleId); updateStyle({ styleId, locale: selected?.locale || styleChoice.locale }); }} /></label>
                      <label><span>语言</span><CitationSelect label="引用语言" value={styleChoice.locale} disabled={privateReadOnly} options={[["zh-CN", "简体中文"], ["en-US", "English"]]} onChange={(locale) => updateStyle({ locale })} /></label>
                    </div>
                    <button type="button" disabled={privateReadOnly || Boolean(busy)} onClick={importCitationStyle}><FileUp size={14} />导入 .csl</button>
                  </div>
                </section>
                <section className="citation-tool-card citation-lookup">
                  <header><span><FileSearch size={16} /></span><div><h3>联网补全书目信息</h3><p>通过 DOI 或 ISBN 补齐当前文献域的数据</p></div></header>
                  <div className="citation-tool-controls-row citation-tool-controls-row--lookup">
                    <span className="citation-tool-control-label">标识符</span>
                    <div><CitationSelect label="补全标识符类型" value={lookupKind} options={[["doi", "DOI"], ["isbn", "ISBN"]]} onChange={setLookupKind} /><input aria-label="DOI 或 ISBN" value={lookupValue} placeholder={lookupKind === "doi" ? "10.xxxx/..." : "978..."} onChange={(event) => setLookupValue(event.target.value.slice(0, 300))} /><button type="button" disabled={activeReadOnly || Boolean(busy) || !lookupValue.trim()} onClick={lookup}>{busy === "lookup" ? <LoaderCircle className="research-spin" size={14} /> : <FileSearch size={14} />}补全</button></div>
                  </div>
                </section>
                {privacyPromptOpen ? (
                  <section className="citation-privacy-consent">
                    <strong>联网补全隐私说明</strong>
                    <p>只会向 DOI.org、Crossref、DataCite 或 Open Library 发送输入的 DOI / ISBN，不会发送正文、笔记或文献库。</p>
                    <div><button type="button" onClick={() => setPrivacyPromptOpen(false)}>暂不使用</button><button type="button" onClick={acceptPrivacyAndLookup}>同意并补全</button></div>
                  </section>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>

        <footer className="settings-feature-dialog-footer citation-library-dialog-footer">
          <span><ScopeMark scope={scope} />{scope === "public" ? "公域修改不会改写已有信笺" : "私域随当前信笺保存和导出"}</span>
          <button type="button" className="settings-primary" onClick={closeManager}><Check size={16} />完成</button>
        </footer>
      </section>
    </div>,
    window.document.body,
  ) : null;

  return (
    <section className={`citation-library-panel${embedded ? " is-embedded" : ""}`} aria-label="文献">
      <section className="citation-sidebar-section" aria-labelledby="citation-used-heading">
        <header className="citation-sidebar-heading">
          <div><BookOpen size={15} /><strong id="citation-used-heading">引用文献</strong><small>{usedSources.length}</small></div>
        </header>
        <p className="citation-sidebar-description">按正文首次出现顺序排列，点击即可定位</p>
        <div className="citation-sidebar-list">
          {usedSources.length ? usedSources.map((source, index) => (
            <button key={source.id} type="button" className="citation-sidebar-row is-cited" onClick={() => onJumpCitationSource?.(source)} title="定位到正文中的首次引用">
              <strong className="citation-sidebar-number">{index + 1}</strong>
              <span><strong>{source.title || "未命名来源"}</strong><small>{sourceSummary(source)}</small></span>
            </button>
          )) : <p className="citation-sidebar-empty">正文还没有插入文献引用。</p>}
        </div>
      </section>

      <section className="citation-sidebar-section citation-sidebar-library" aria-labelledby="citation-private-heading">
        <header className="citation-sidebar-heading">
          <div><BookOpen size={15} /><strong id="citation-private-heading">文献库</strong><small>{normalizedPrivateSources.length}</small></div>
          <button type="button" onClick={() => openManager("private")} aria-label="管理文献库" title="管理私域与公域文献"><Settings size={15} /></button>
        </header>
        <p className="citation-sidebar-description">当前信笺的私域文献目录</p>
        <div className="citation-sidebar-list">
          {loading ? <p className="citation-sidebar-empty"><LoaderCircle className="research-spin" size={14} />正在读取文献库…</p> : null}
          {!loading && normalizedPrivateSources.length ? normalizedPrivateSources.map((source, index) => (
            <button key={source.id} type="button" className="citation-sidebar-row" onClick={() => openManager("private", source.id)} title="在文献库管理中打开">
              <strong className="citation-sidebar-number">{index + 1}</strong>
              <span><strong>{source.title || "未命名来源"}</strong><small>{sourceSummary(source)}</small></span>
              <ArrowRight size={13} />
            </button>
          )) : null}
          {!loading && !normalizedPrivateSources.length ? <p className="citation-sidebar-empty">本文还没有私域文献。点击齿轮进入文献库管理。</p> : null}
        </div>
      </section>
      {modal}
    </section>
  );
}

export { CitationConflictPreview };
