import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  Globe2,
  Minus,
  X,
} from "lucide-react";
import { HierarchicalTreeRows, TreeItemButton } from "../HierarchicalTree.jsx";

export function WebSourceDialog({ dialog, onClose, onSubmit }) {
  const urlRef = useRef(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dialog?.open) return undefined;
    setUrl(dialog.source?.url || "https://");
    setTitle(dialog.source?.title || "");
    setExcerpt(dialog.source?.excerpt || dialog.source?.notes || "");
    setTitleTouched(Boolean(dialog.source?.title));
    setError("");
    setBusy(false);
    const frame = window.requestAnimationFrame(() => {
      urlRef.current?.focus();
      urlRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog?.open, dialog?.source]);

  useEffect(() => {
    if (!dialog?.open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose?.();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [busy, dialog?.open, onClose]);

  if (!dialog?.open) return null;

  const parseUrl = () => {
    let parsed;
    try {
      parsed = new URL(url.trim());
    } catch {
      throw new Error("请输入有效的网页地址");
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("网页仅支持不含账号信息的 HTTP 或 HTTPS 地址");
    }
    return parsed;
  };

  const content = (
    <div className="app-confirm-overlay dialog-scrim" role="presentation" onMouseDown={() => { if (!busy) onClose?.(); }}>
      <form
        className="app-confirm-dialog web-source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="web-source-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          let parsed;
          try {
            parsed = parseUrl();
            if (!title.trim()) throw new Error("请输入网页标题");
          } catch (validationError) {
            setError(validationError?.message || "网页信息无效");
            return;
          }
          setBusy(true);
          try {
            await onSubmit?.({ url: parsed.toString(), title: title.trim(), excerpt });
            onClose?.();
          } catch (submitError) {
            setError(submitError?.message || "网页资料保存失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <button type="button" className="app-confirm-close" disabled={busy} onClick={onClose} aria-label="关闭网页资料窗口" title="关闭">
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true"><Globe2 size={24} /></div>
        <div className="app-confirm-copy web-source-dialog-copy">
          <span>资料区 · 网页</span>
          <h2 id="web-source-dialog-title">{dialog.source ? "编辑网页" : "新增网页"}</h2>
          <label className="app-prompt-field">
            <span>网址</span>
            <input
              ref={urlRef}
              type="url"
              value={url}
              maxLength={4096}
              spellCheck={false}
              onChange={(event) => setUrl(event.target.value)}
              onBlur={() => {
                if (titleTouched || title.trim()) return;
                try { setTitle(parseUrl().hostname); } catch { /* Validation is shown on submit. */ }
              }}
            />
          </label>
          <label className="app-prompt-field">
            <span>标题</span>
            <input type="text" value={title} maxLength={500} onChange={(event) => { setTitle(event.target.value); setTitleTouched(true); }} />
          </label>
          <label className="app-prompt-field web-source-excerpt-field">
            <span>摘录（可留空）</span>
            <textarea value={excerpt} maxLength={200000} rows={6} onChange={(event) => setExcerpt(event.target.value)} />
          </label>
          {error ? <p className="web-source-dialog-error" role="alert">{error}</p> : null}
        </div>
        <footer className="app-confirm-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onClose}><span>取消</span></button>
          <button type="submit" className="primary" disabled={busy}><Check size={15} /><span>{busy ? "保存中…" : "保存网页"}</span></button>
        </footer>
      </form>
    </div>
  );
  return createPortal(content, window.document.body);
}

export function WebCopyDialog({ dialog, sources = [], folders = [], placements = {}, onClose, onSubmit }) {
  const dialogRef = useRef(null);
  const openerRef = useRef(null);
  const busyRef = useRef(false);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());
  const [selectedSourceIds, setSelectedSourceIds] = useState(() => new Set());
  const [selectedEmptyFolderIds, setSelectedEmptyFolderIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  busyRef.current = busy;

  const globalFolders = useMemo(() => folders.filter((folder) => folder.scopeKey === "global"), [folders]);
  const globalFolderMap = useMemo(() => new Map(globalFolders.map((folder) => [folder.id, folder])), [globalFolders]);
  const globalSources = useMemo(() => sources.filter((source) => (
    source.type === "web" && (placements[source.id]?.scopeKey || "global") === "global"
  )), [placements, sources]);
  const childFoldersByParent = useMemo(() => {
    const result = new Map();
    globalFolders.forEach((folder) => {
      const parentId = folder.parentId || "";
      if (!result.has(parentId)) result.set(parentId, []);
      result.get(parentId).push(folder);
    });
    result.forEach((items) => items.sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" })));
    return result;
  }, [globalFolders]);
  const sourcesByFolder = useMemo(() => {
    const result = new Map();
    globalSources.forEach((source) => {
      const folderId = placements[source.id]?.folderId || "";
      if (!result.has(folderId)) result.set(folderId, []);
      result.get(folderId).push(source);
    });
    result.forEach((items) => items.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))));
    return result;
  }, [globalSources, placements]);
  const childrenFor = useCallback((parentId = "") => [
    ...(childFoldersByParent.get(parentId) || []).map((folder) => ({ kind: "folder", value: folder })),
    ...(sourcesByFolder.get(parentId) || []).map((source) => ({ kind: "source", value: source })),
  ], [childFoldersByParent, sourcesByFolder]);
  const rootNodes = useMemo(() => childrenFor(""), [childrenFor]);
  const selectionUnitsByFolder = useMemo(() => {
    const memo = new Map();
    const collect = (folderId, visiting = new Set()) => {
      if (memo.has(folderId)) return memo.get(folderId);
      if (visiting.has(folderId)) return { sourceIds: new Set(), emptyFolderIds: new Set() };
      const nextVisiting = new Set(visiting).add(folderId);
      const directSources = sourcesByFolder.get(folderId) || [];
      const childFolders = childFoldersByParent.get(folderId) || [];
      const sourceIds = new Set(directSources.map((source) => source.id));
      const emptyFolderIds = new Set();
      childFolders.forEach((folder) => {
        const childUnits = collect(folder.id, nextVisiting);
        childUnits.sourceIds.forEach((id) => sourceIds.add(id));
        childUnits.emptyFolderIds.forEach((id) => emptyFolderIds.add(id));
      });
      if (!directSources.length && !childFolders.length) emptyFolderIds.add(folderId);
      const units = { sourceIds, emptyFolderIds };
      memo.set(folderId, units);
      return units;
    };
    globalFolders.forEach((folder) => collect(folder.id));
    return memo;
  }, [childFoldersByParent, globalFolders, sourcesByFolder]);

  useEffect(() => {
    if (!dialog?.open) return undefined;
    setExpandedFolders(new Set(globalFolders.map((folder) => folder.id)));
    setSelectedSourceIds(new Set());
    setSelectedEmptyFolderIds(new Set());
    setBusy(false);
    setError("");
    openerRef.current = window.document.activeElement;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector('[role="treeitem"]')?.focus());
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && window.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && window.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.document.removeEventListener("keydown", handleKeyDown, true);
      openerRef.current?.focus?.();
    };
  }, [dialog?.open, onClose]);

  useEffect(() => {
    if (!dialog?.open) return;
    const validSourceIds = new Set(globalSources.map((source) => source.id));
    const validFolderIds = new Set(globalFolders.map((folder) => folder.id));
    setSelectedSourceIds((current) => {
      const next = new Set([...current].filter((id) => validSourceIds.has(id)));
      return next.size === current.size ? current : next;
    });
    setSelectedEmptyFolderIds((current) => {
      const next = new Set([...current].filter((id) => validFolderIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [dialog?.open, globalFolders, globalSources]);

  if (!dialog?.open) return null;

  const folderSelectionState = (folderId) => {
    const units = selectionUnitsByFolder.get(folderId) || { sourceIds: new Set(), emptyFolderIds: new Set([folderId]) };
    const total = units.sourceIds.size + units.emptyFolderIds.size;
    const selected = [...units.sourceIds].filter((id) => selectedSourceIds.has(id)).length
      + [...units.emptyFolderIds].filter((id) => selectedEmptyFolderIds.has(id)).length;
    return { checked: total > 0 && selected === total, mixed: selected > 0 && selected < total, units };
  };
  const toggleFolderSelection = (folderId) => {
    const state = folderSelectionState(folderId);
    const nextChecked = !state.checked;
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      state.units.sourceIds.forEach((id) => nextChecked ? next.add(id) : next.delete(id));
      return next;
    });
    setSelectedEmptyFolderIds((current) => {
      const next = new Set(current);
      state.units.emptyFolderIds.forEach((id) => nextChecked ? next.add(id) : next.delete(id));
      return next;
    });
  };
  const toggleSourceSelection = (sourceId) => setSelectedSourceIds((current) => {
    const next = new Set(current);
    if (next.has(sourceId)) next.delete(sourceId); else next.add(sourceId);
    return next;
  });
  const selectedFolderPathIds = new Set(selectedEmptyFolderIds);
  const includeAncestors = (folderId) => {
    let currentId = folderId;
    const visiting = new Set();
    while (currentId && !visiting.has(currentId)) {
      visiting.add(currentId);
      selectedFolderPathIds.add(currentId);
      currentId = globalFolderMap.get(currentId)?.parentId || "";
    }
  };
  selectedEmptyFolderIds.forEach(includeAncestors);
  selectedSourceIds.forEach((sourceId) => includeAncestors(placements[sourceId]?.folderId || ""));
  const selectedCount = selectedSourceIds.size + selectedEmptyFolderIds.size;
  const nodeKey = (node) => `${node.kind}:${node.value.id}`;
  const renderCopyRow = ({ entry: node, depth, expanded }) => {
    const folder = node.kind === "folder";
    const folderState = folder ? folderSelectionState(node.value.id) : null;
    const checked = folder ? folderState.checked : selectedSourceIds.has(node.value.id);
    const mixed = folder ? folderState.mixed : false;
    const toggle = () => folder ? toggleFolderSelection(node.value.id) : toggleSourceSelection(node.value.id);
    return (
      <div className={`web-copy-tree-row${folder ? " is-folder" : " is-source"}`}>
        {folder ? (
          <button
            type="button"
            className="web-copy-tree-disclosure"
            tabIndex={-1}
            onClick={() => setExpandedFolders((current) => {
              const next = new Set(current);
              if (next.has(node.value.id)) next.delete(node.value.id); else next.add(node.value.id);
              return next;
            })}
            aria-label={expanded ? `折叠 ${node.value.name}` : `展开 ${node.value.name}`}
          >{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
        ) : <span className="web-copy-tree-disclosure-spacer" aria-hidden="true" />}
        <TreeItemButton
          className="web-copy-tree-item"
          branch={folder}
          expanded={expanded}
          depth={depth}
          aria-checked={mixed ? "mixed" : checked}
          onActivate={toggle}
          onToggle={() => setExpandedFolders((current) => {
            const next = new Set(current);
            if (next.has(node.value.id)) next.delete(node.value.id); else next.add(node.value.id);
            return next;
          })}
          onKeyDown={(event) => {
            if (event.key === " ") {
              event.preventDefault();
              toggle();
            }
          }}
        >
          <span className={`web-copy-checkbox${checked || mixed ? " is-checked" : ""}${mixed ? " is-mixed" : ""}`} aria-hidden="true">
            {mixed ? <Minus size={12} /> : checked ? <Check size={12} /> : null}
          </span>
          {folder ? <FolderOpen size={16} aria-hidden="true" /> : <Globe2 size={15} aria-hidden="true" />}
          <span className="web-copy-tree-label"><strong>{folder ? node.value.name : (node.value.title || node.value.url)}</strong>{folder ? null : <small>{node.value.url}</small>}</span>
        </TreeItemButton>
      </div>
    );
  };

  return createPortal(
    <div className="web-copy-overlay dialog-scrim" role="presentation" onMouseDown={() => { if (!busy) onClose?.(); }}>
      <form
        ref={dialogRef}
        className="web-copy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="web-copy-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!selectedCount || busy) return;
          setBusy(true);
          setError("");
          try {
            await onSubmit?.({ folderIds: [...selectedEmptyFolderIds], sourceIds: [...selectedSourceIds] });
            onClose?.();
          } catch (submitError) {
            setError(submitError?.message || "公区内容复制失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <header>
          <span className="web-copy-dialog-icon" aria-hidden="true"><Copy size={20} /></span>
          <div><small>工作区私区</small><h2 id="web-copy-dialog-title">从公区复制</h2></div>
          <button type="button" disabled={busy} onClick={onClose} aria-label="关闭公区复制窗口"><X size={17} /></button>
        </header>
        <p className="web-copy-dialog-intro">选择要复制的文件夹或网址；目录层级会保留，私区已有的相同网址会跳过。</p>
        <div className="web-copy-tree-scroll">
          {rootNodes.length ? (
            <div className="web-copy-tree" role="tree" aria-label="公区网页选择树">
              <HierarchicalTreeRows
                entries={rootNodes}
                getKey={nodeKey}
                isBranch={(node) => node.kind === "folder"}
                isExpanded={(node) => node.kind === "folder" && expandedFolders.has(node.value.id)}
                getChildren={(node) => node.kind === "folder" ? childrenFor(node.value.id) : []}
                getGroupLabel={({ entry }) => `${entry.value.name} 的内容`}
                wrapperClassName="web-copy-tree-branch"
                childrenClassName="web-copy-tree-children"
                renderRow={renderCopyRow}
                renderBranchState={(status) => status === "empty" ? <p className="web-copy-tree-empty">空文件夹</p> : null}
              />
            </div>
          ) : <p className="web-copy-dialog-empty">公区暂无可复制内容。</p>}
        </div>
        {error ? <p className="web-copy-dialog-error" role="alert">{error}</p> : null}
        <footer>
          <span>已选 {selectedSourceIds.size} 个网址 · 涉及 {selectedFolderPathIds.size} 个文件夹</span>
          <div>
            <button type="button" className="ghost" disabled={busy} onClick={onClose}>取消</button>
            <button type="submit" className="primary" disabled={!selectedCount || busy}><Copy size={14} />{busy ? "复制中…" : "复制到私区"}</button>
          </div>
        </footer>
      </form>
    </div>,
    window.document.body,
  );
}
