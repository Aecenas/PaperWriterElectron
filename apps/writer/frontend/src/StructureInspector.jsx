import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  BookOpen,
  BookCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CornerUpLeft,
  Hash,
  Link2,
  ListTree,
  LoaderCircle,
  LocateFixed,
  NotebookPen,
  Pencil,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { buildVisibleOutlineRows } from "./outline-model.js";
import { WritingAssistancePane } from "./writing-assistance/index.js";
import { CitationLibraryPanel, collectBookmarks } from "./professional-content/index.js";
import "./research-workspace.css";
import "./structure-inspector.css";

const STRUCTURE_TABS = [
  { id: "outline", label: "大纲", icon: ListTree },
  { id: "references", label: "脚注", icon: NotebookPen },
  { id: "related", label: "关联", icon: Link2 },
  { id: "writing", label: "检查", icon: BookCheck },
  { id: "bibliography", label: "文献", icon: BookOpen },
  { id: "bookmarks", label: "书签", icon: Bookmark },
];

function tabId(mode) {
  return `structure-inspector-tab-${mode}`;
}

function panelId(mode) {
  return `structure-inspector-panel-${mode}`;
}

export function summarizeFootnoteText(value) {
  const paragraphs = String(value || "")
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!paragraphs.length) return "脚注内容缺失";
  return `${paragraphs[0]}${paragraphs.length > 1 ? "…" : ""}`;
}

function ReferenceSectionHeading({ id, label, count, icon: Icon, expanded, onToggle, children }) {
  return (
    <div className="structure-reference-section-heading">
      <button
        type="button"
        id={id}
        className="structure-reference-section-toggle"
        aria-expanded={expanded}
        aria-controls={`${id}-content`}
        onClick={onToggle}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Icon size={15} aria-hidden="true" />
        <strong>{label}</strong>
        <small>{count}</small>
      </button>
      {children ? <div className="structure-reference-section-actions">{children}</div> : null}
    </div>
  );
}

export function OutlinePane({ items = [], onItemClick }) {
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const rows = buildVisibleOutlineRows(items, collapsedIds);
  const toggleCollapsed = (item) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };
  return (
    <div className="structure-outline" aria-label="当前信笺大纲">
      {items.length ? rows.map((item) => (
        <div
          key={item.id || `${item.level}-${item.text}`}
          className={`structure-outline-item level-${Math.min(4, item.level)}${item.hasChildren ? " has-children" : ""}`}
        >
          <button
            type="button"
            className={`structure-outline-row level-${Math.min(4, item.level)}${item.number ? " is-numbered" : ""}`}
            onClick={() => onItemClick?.(item)}
            title={item.text}
          >
            {item.number ? (
              <span className="structure-outline-number" aria-hidden="true">{item.number}</span>
            ) : (
              <span className="structure-outline-marker" aria-hidden="true" />
            )}
            <span>{item.text || "无标题"}</span>
          </button>
          {item.hasChildren ? (
            <button
              type="button"
              className="structure-outline-collapse"
              aria-expanded={!item.isCollapsed}
              aria-label={`${item.isCollapsed ? "展开" : "收起"}“${item.text || "无标题"}”的子项`}
              title={item.isCollapsed ? "展开子项" : "收起子项"}
              onClick={() => toggleCollapsed(item)}
            >
              {item.isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          ) : null}
        </div>
      )) : (
        <div className="structure-empty">
          <ListTree size={25} aria-hidden="true" />
          <span>当前信笺还没有一、二、三、四级标题。</span>
        </div>
      )}
    </div>
  );
}

export function ReferencesPane({
  footnotes = [],
  readOnly = false,
  onJumpFootnote,
  onEditFootnote,
  onDeleteFootnote,
}) {
  const [footnotesExpanded, setFootnotesExpanded] = useState(true);
  return (
    <div className="structure-references structure-footnotes-only">
      <section aria-labelledby="structure-footnotes-heading">
        <ReferenceSectionHeading id="structure-footnotes-heading" label="脚注" count={footnotes.length} icon={Hash} expanded={footnotesExpanded} onToggle={() => setFootnotesExpanded((value) => !value)} />
        {footnotesExpanded ? (
          <div id="structure-footnotes-heading-content" className="structure-reference-section-body">
            <p className="structure-reference-section-description">编号按正文出现顺序派生</p>
            <div className="structure-item-list">
              {footnotes.length ? footnotes.map((footnote, index) => (
                <article key={footnote.id} className="structure-item">
                  <button
                    type="button"
                    className="structure-item-main is-numbered"
                    disabled={!onJumpFootnote}
                    title={onJumpFootnote ? `跳转到正文脚注：${footnote.text || "脚注内容缺失"}` : (footnote.text || "脚注内容缺失")}
                    onClick={() => onJumpFootnote?.(footnote)}
                  >
                    <strong className="structure-order-number" aria-label={`脚注 ${index + 1}`}>{index + 1}</strong>
                    <span className="structure-footnote-summary">{summarizeFootnoteText(footnote.text)}</span>
                  </button>
                  {!readOnly && onEditFootnote ? <button type="button" className="structure-item-delete structure-item-action" aria-label={`编辑脚注 ${footnote.label || index + 1}`} title="编辑脚注" onClick={() => onEditFootnote(footnote)}><Pencil size={13} /></button> : null}
                  {!readOnly && onDeleteFootnote ? <button type="button" className="structure-item-delete" aria-label={`删除脚注 ${footnote.label || ""}`} title="删除脚注" onClick={() => onDeleteFootnote(footnote)}><Trash2 size={13} /></button> : null}
                </article>
              )) : <p className="structure-compact-empty">正文还没有脚注。请从顶部“元素”菜单添加。</p>}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function useEditorBookmarks(editor) {
  const [items, setItems] = useState(() => collectBookmarks(editor?.state?.doc));
  useEffect(() => {
    const sync = () => setItems(collectBookmarks(editor?.state?.doc));
    sync();
    editor?.on?.("transaction", sync);
    return () => editor?.off?.("transaction", sync);
  }, [editor]);
  return items;
}

export function BookmarksPane({
  editor,
  readOnly = false,
  onJump,
  onRename,
  onDelete,
}) {
  const items = useEditorBookmarks(editor);
  return (
    <div className="structure-bookmarks" aria-label="当前信笺书签">
      <header className="structure-bookmark-heading">
        <div>
          <strong>正文书签</strong>
          <small>{items.length} 处</small>
        </div>
        <p>书签固定在段落左侧，不占用正文位置。</p>
      </header>
      <div className="structure-item-list">
        {items.length ? items.map((item, index) => (
          <article key={item.bookmarkId} className="structure-item structure-bookmark-item">
            <button
              type="button"
              className="structure-item-main is-numbered"
              onClick={() => onJump?.(item)}
              title={`定位到${item.displayLabel}`}
            >
              <strong className="structure-order-number" aria-label={`书签 ${index + 1}`}>
                {index + 1}
              </strong>
              <span className="structure-item-copy">
                <strong>{item.displayLabel}</strong>
                <span>{item.context || "空段落"}</span>
              </span>
            </button>
            {!readOnly && onRename ? (
              <button
                type="button"
                className="structure-item-delete structure-item-action"
                aria-label={`编辑${item.displayLabel}`}
                title="编辑书签名"
                onClick={() => onRename(item)}
              >
                <Pencil size={13} />
              </button>
            ) : null}
            {!readOnly && onDelete ? (
              <button
                type="button"
                className="structure-item-delete"
                aria-label={`删除${item.displayLabel}`}
                title="删除书签"
                onClick={() => onDelete(item)}
              >
                <Trash2 size={13} />
              </button>
            ) : null}
          </article>
        )) : (
          <div className="structure-empty">
            <Bookmark size={24} aria-hidden="true" />
            <span>还没有书签。可从顶部“元素”菜单为当前段落添加。</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function RelatedPane({
  links = [],
  backlinks = [],
  duplicates = [],
  contextKey = "",
  loading = false,
  error = "",
  onOpenDocument,
  onRelink,
  onRemove,
  onJumpUsage,
  onGiveNewIdentity,
}) {
  const [linksExpanded, setLinksExpanded] = useState(true);
  const [backlinksExpanded, setBacklinksExpanded] = useState(true);
  const [usageProgress, setUsageProgress] = useState({});
  const usageProgressTimersRef = useRef(new Map());
  useEffect(() => {
    usageProgressTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    usageProgressTimersRef.current.clear();
    setUsageProgress({});
    return () => {
      usageProgressTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      usageProgressTimersRef.current.clear();
    };
  }, [contextKey]);
  const jumpToNextUsage = (link, rowKey) => {
    const progress = onJumpUsage?.(link);
    if (!progress?.total) return;
    setUsageProgress((current) => ({ ...current, [rowKey]: progress }));
    window.clearTimeout(usageProgressTimersRef.current.get(rowKey));
    usageProgressTimersRef.current.set(rowKey, window.setTimeout(() => {
      usageProgressTimersRef.current.delete(rowKey);
      setUsageProgress((current) => {
        if (!current[rowKey]) return current;
        const next = { ...current };
        delete next[rowKey];
        return next;
      });
    }, 10_000));
  };
  if (loading) return <p className="structure-loading is-centered" role="status"><LoaderCircle className="research-spin" size={16} />正在刷新关联…</p>;
  if (error) return <p className="structure-loading is-error is-centered" role="alert"><ShieldAlert size={15} />{error}</p>;
  return (
    <div className="structure-related">
      {duplicates.length ? (
        <section className="structure-duplicate-warning" aria-label="重复文档身份">
          <strong>发现重复文档身份</strong>
          <p>这些副本来自资源管理器复制。请为副本生成新身份，以免关联跳转不确定。</p>
          {duplicates.map((item) => <button key={item.path || item.relativePath} type="button" onClick={() => onGiveNewIdentity?.(item)}>{item.relativePath || item.path}</button>)}
        </section>
      ) : null}

      <section aria-labelledby="structure-links-heading">
        <ReferenceSectionHeading id="structure-links-heading" label="本文关联" count={links.length} icon={Link2} expanded={linksExpanded} onToggle={() => setLinksExpanded((value) => !value)} />
        {linksExpanded ? (
          <div id="structure-links-heading-content" className="structure-reference-section-body">
            <p className="structure-reference-section-description">从顶部“元素”菜单插入关联信笺</p>
            <div className="structure-item-list">
              {links.length ? links.map((link, linkIndex) => {
                const targetId = link?.targetDocumentId || link?.documentId || link?.path || link?.relativePath;
                const rowKey = `${targetId}:${Number(link?.position) || 0}`;
                const progress = usageProgress[rowKey];
                return (
                <article key={`${link.targetDocumentId}-${link.position || 0}`} className={`structure-related-item${link.missing ? " is-missing" : ""}`}>
                  <button type="button" className="structure-related-main" onClick={() => onOpenDocument?.(link)}>
                    <strong className="structure-order-number" aria-label={`关联 ${linkIndex + 1}`}>{linkIndex + 1}</strong>
                    <span className="structure-related-copy"><strong>{link.title || "未知信笺"}</strong><small>{link.relativePath || (link.missing ? "目标已丢失" : "")}</small></span>
                  </button>
                  {link.missing ? <button type="button" aria-label={`重新关联 ${link.title || ""}`} title="重新关联" onClick={() => onRelink?.(link)}><RefreshCw size={13} /></button> : null}
                  {progress ? <small className="structure-related-progress" aria-label={`正文位置 ${progress.current}，共 ${progress.total} 处`}>{progress.current}/{progress.total}</small> : null}
                  <button type="button" className="structure-related-jump" aria-label={`定位正文关联 ${link.title || ""}`} title="逐个定位正文中的使用位置" onClick={() => jumpToNextUsage(link, rowKey)}><LocateFixed size={13} /></button>
                  <button type="button" aria-label={`移除关联 ${link.title || ""}`} title="移除关联" onClick={() => onRemove?.(link)}><Trash2 size={13} /></button>
                </article>
                );
              }) : <p className="structure-compact-empty">本文还没有关联其他信笺。</p>}
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="structure-backlinks-heading">
        <ReferenceSectionHeading id="structure-backlinks-heading" label="反向关联" count={backlinks.length} icon={CornerUpLeft} expanded={backlinksExpanded} onToggle={() => setBacklinksExpanded((value) => !value)} />
        {backlinksExpanded ? (
          <div id="structure-backlinks-heading-content" className="structure-reference-section-body">
            <p className="structure-reference-section-description">由工作区索引实时派生</p>
            <div className="structure-backlinks">
              {backlinks.length ? backlinks.map((link, linkIndex) => (
                <button key={`${link.documentId}-${link.path || link.relativePath}`} type="button" onClick={() => onOpenDocument?.(link)}>
                  <strong className="structure-order-number" aria-label={`反向关联 ${linkIndex + 1}`}>{linkIndex + 1}</strong>
                  <span className="structure-related-copy"><strong>{link.title || "未命名信笺"}</strong><span>{link.relativePath || link.path}</span></span>
                </button>
              )) : <p className="structure-compact-empty">当前没有其他信笺关联到本文。</p>}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export default function StructureInspector({
  mode = "outline",
  onModeChange,
  outlineItems = [],
  onOutlineItemClick,
  referenceProps = {},
  relatedProps = {},
  writingProps = {},
  citationLibraryProps = {},
  bookmarkProps = {},
  loading = false,
  error = "",
}) {
  const tabsRef = useRef(null);
  const activeMode = STRUCTURE_TABS.some((tab) => tab.id === mode) ? mode : "outline";
  const moveTab = (event, direction) => {
    const index = STRUCTURE_TABS.findIndex((tab) => tab.id === activeMode);
    const next = STRUCTURE_TABS[(index + direction + STRUCTURE_TABS.length) % STRUCTURE_TABS.length];
    event.preventDefault();
    onModeChange?.(next.id);
    window.requestAnimationFrame(() => tabsRef.current?.querySelector(`#${tabId(next.id)}`)?.focus());
  };
  return (
    <section className="structure-inspector" aria-label="文档结构">
      <div ref={tabsRef} className="structure-tabs" role="tablist" aria-label="结构页面">
        {STRUCTURE_TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = activeMode === tab.id;
          return (
            <button
              key={tab.id}
              id={tabId(tab.id)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId(tab.id)}
              tabIndex={selected ? 0 : -1}
              className={selected ? "is-active" : ""}
              onClick={() => onModeChange?.(tab.id)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") moveTab(event, event.key === "ArrowRight" ? 1 : -1);
                if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  const next = STRUCTURE_TABS[event.key === "Home" ? 0 : STRUCTURE_TABS.length - 1];
                  onModeChange?.(next.id);
                  window.requestAnimationFrame(() => tabsRef.current?.querySelector(`#${tabId(next.id)}`)?.focus());
                }
              }}
            ><Icon size={14} aria-hidden="true" /><span>{tab.label}</span></button>
          );
        })}
      </div>
      <div
        id={panelId(activeMode)}
        className="structure-panel"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={tabId(activeMode)}
        aria-busy={loading || undefined}
      >
        {loading ? <p className="structure-loading is-centered" role="status"><LoaderCircle className="research-spin" size={16} />正在读取文档结构…</p> : null}
        {!loading && error ? <p className="structure-loading is-error is-centered" role="alert"><ShieldAlert size={15} />{error}</p> : null}
        {!loading && !error && activeMode === "outline" ? <OutlinePane items={outlineItems} onItemClick={onOutlineItemClick} /> : null}
        {!loading && !error && activeMode === "references" ? <ReferencesPane {...referenceProps} /> : null}
        {!loading && !error && activeMode === "related" ? <RelatedPane {...relatedProps} /> : null}
        {!loading && !error && activeMode === "writing" ? <WritingAssistancePane {...writingProps} /> : null}
        {!loading && !error && activeMode === "bibliography" ? <CitationLibraryPanel embedded {...citationLibraryProps} /> : null}
        {!loading && !error && activeMode === "bookmarks" ? <BookmarksPane {...bookmarkProps} /> : null}
      </div>
    </section>
  );
}

export { STRUCTURE_TABS };
