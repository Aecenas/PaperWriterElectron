import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpenText,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  CopyPlus,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  FileInput,
  FolderOpen,
  FolderPlus,
  Globe2,
  Image,
  Import,
  LibraryBig,
  Link2,
  LoaderCircle,
  Move,
  Pencil,
  Trash2,
  Unlink,
} from "lucide-react";
import HierarchicalTree, { TreeItemButton } from "./HierarchicalTree.jsx";
import {
  RESEARCH_CONTEXT_ACTIONS,
  getResearchEntryChildren,
  getResearchEntryKey,
  isResearchFolderExpanded,
  isVisibleResearchEntry,
  normalizeResearchRelativePath,
  parentResearchRelativePath,
  researchPreviewKind,
  researchEntryType,
  sourceDisplayName,
} from "./research-ui-model.js";
import "./research-workspace.css";

const FOLDER_EMPTY_ICON = new URL("./assets/icons/gold-folder-empty.png", import.meta.url).href;
const FOLDER_FULL_ICON = new URL("./assets/icons/gold-folder-full.png", import.meta.url).href;
function ResearchFileIcon({ entry }) {
  const kind = researchPreviewKind(entry);
  const Icon = kind === "document" ? BookOpenText
    : kind === "table" ? FileSpreadsheet
      : kind === "image" ? Image
        : kind === "unsupported" ? FileQuestion
          : FileText;
  return <span className="research-file-type-icon" data-preview-kind={kind} aria-hidden="true"><Icon size={18} /></span>;
}

const ACTION_LABELS = {
  createFolder: [FolderPlus, "新建文件夹"],
  importFiles: [FileInput, "导入文件"],
  rename: [Pencil, "重命名"],
  move: [Move, "移动…"],
  copyPath: [ClipboardCopy, "复制路径"],
  showInFolder: [FolderOpen, "在资源管理器中显示"],
  trash: [Trash2, "移到回收站"],
};

function isBusy(busyKeys, key) {
  if (!key) return false;
  if (busyKeys instanceof Set) return busyKeys.has(key);
  if (Array.isArray(busyKeys)) return busyKeys.includes(key);
  return Boolean(busyKeys?.[key]);
}

function TreeRow({
  entry,
  depth,
  expanded,
  state,
  children,
  selectedKey,
  busyKeys,
  draggedEntry,
  onSetDraggedEntry,
  onToggleFolder,
  onOpenEntry,
  onMoveEntry,
  onContextMenu,
}) {
  const key = getResearchEntryKey(entry);
  const folder = researchEntryType(entry) === "folder";
  const previewKind = folder ? "" : researchPreviewKind(entry);
  const loading = Boolean(entry.loading || state?.loading);
  const busy = isBusy(busyKeys, key);
  const selected = selectedKey === key;
  const canDrop = folder && draggedEntry && getResearchEntryKey(draggedEntry) !== key;

  const activate = () => {
    if (folder) onToggleFolder?.(entry, !expanded);
    else onOpenEntry?.(entry);
  };

  const openContextMenu = (event) => {
    if (event.clientX || event.clientY) {
      onContextMenu?.(event, entry);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    onContextMenu?.({ clientX: rect.left + 18, clientY: rect.bottom, preventDefault() {}, stopPropagation() {} }, entry);
  };

  return (
      <div
        className={`research-tree-row${selected ? " is-selected" : ""}${busy ? " is-busy" : ""}${previewKind === "unsupported" ? " is-unsupported" : ""}`}
        style={{ "--research-tree-depth": depth }}
        role="none"
        onDragOver={(event) => {
          if (!canDrop) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          event.currentTarget.classList.add("is-drop-target");
        }}
        onDragLeave={(event) => event.currentTarget.classList.remove("is-drop-target")}
        onDrop={(event) => {
          event.preventDefault();
          event.currentTarget.classList.remove("is-drop-target");
          if (canDrop) onMoveEntry?.(draggedEntry, entry);
          onSetDraggedEntry?.(null);
        }}
      >
        <TreeItemButton
          className="research-tree-main"
          branch={folder}
          expanded={expanded}
          depth={depth}
          selected={selected}
          data-entry-key={key}
          disabled={busy}
          draggable={!busy}
          title={folder ? `${entry.name}（单击展开，双击或按 Enter 进入）` : (previewKind === "unsupported" ? `${entry.name}（此格式不能在笺间打开）` : entry.name)}
          onActivate={activate}
          onNavigate={folder ? () => onOpenEntry?.(entry) : undefined}
          onToggle={(nextExpanded) => onToggleFolder?.(entry, nextExpanded)}
          onContextMenu={openContextMenu}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", key);
            onSetDraggedEntry?.(entry);
          }}
          onDragEnd={() => onSetDraggedEntry?.(null)}
        >
          {folder ? (
            <img
              src={entry.hasChildren === false || (expanded && !children.length) ? FOLDER_EMPTY_ICON : FOLDER_FULL_ICON}
              alt=""
              aria-hidden="true"
            />
          ) : <ResearchFileIcon entry={entry} />}
          <span>{entry.displayName || entry.name}</span>
          {entry.meta ? <small>{entry.meta}</small> : null}
          {loading || busy ? <LoaderCircle className="research-spin research-tree-busy" size={13} aria-label={loading ? "正在读取" : "处理中"} /> : null}
        </TreeItemButton>
      </div>
  );
}

export function ResearchTree(props) {
  const {
    entries = [], expandedFolders, selectedKey = "", busyKeys, onToggleFolder, onOpenEntry,
    onMoveEntry, onContextMenu,
  } = props;
  const [draggedEntry, setDraggedEntry] = useState(null);
  const visibleEntries = useMemo(() => entries.filter(isVisibleResearchEntry), [entries]);
  return (
    <HierarchicalTree
      className="research-tree"
      ariaLabel="资料文件树"
      loading={props.loading}
      entries={visibleEntries}
      getKey={getResearchEntryKey}
      isBranch={(entry) => researchEntryType(entry) === "folder"}
      isExpanded={(entry) => isResearchFolderExpanded(expandedFolders, entry)}
      getBranchState={(entry) => ({
        ...(expandedFolders?.[getResearchEntryKey(entry)] || {}),
        loading: Boolean(entry.loading || expandedFolders?.[getResearchEntryKey(entry)]?.loading),
        error: entry.error || expandedFolders?.[getResearchEntryKey(entry)]?.error || "",
      })}
      getChildren={(entry) => getResearchEntryChildren(entry, expandedFolders)}
      getGroupLabel={({ entry }) => `${entry.name} 的内容`}
      wrapperClassName="research-tree-group"
      childrenClassName="research-tree-children"
      renderRow={({ entry, depth, expanded, state, children }) => (
        <TreeRow
          entry={entry}
          depth={depth}
          expanded={expanded}
          state={state}
          children={children}
          selectedKey={selectedKey}
          busyKeys={busyKeys}
          draggedEntry={draggedEntry}
          onSetDraggedEntry={setDraggedEntry}
          onToggleFolder={onToggleFolder}
          onOpenEntry={onOpenEntry}
          onMoveEntry={onMoveEntry}
          onContextMenu={onContextMenu}
        />
      )}
      renderBranchState={(status, { depth, state }) => (
        <p
          className={`research-tree-hint${status === "error" ? " is-error" : ""}`}
          style={{ "--research-tree-depth": depth + 1 }}
          role={status === "loading" ? "status" : status === "error" ? "alert" : undefined}
        >
          {status === "loading" ? "正在读取…" : status === "error" ? (state.error || "资料文件夹读取失败") : "空文件夹"}
        </p>
      )}
    />
  );
}

function WebSourceGroup({
  sources,
  folders = [],
  placements = {},
  scopeKey = "global",
  workspaceName = "",
  workspaceConnected = false,
  workspaceAvailable = false,
  available = true,
  globalContentCount = 0,
  readOnly = false,
  selectedKey,
  onToggleWorkspace,
  onCopyFromGlobal,
  onAdd,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onMoveSource,
  onOpen,
  onEdit,
  onDelete,
}) {
  const [expanded, setExpanded] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());
  const [dragged, setDragged] = useState(null);
  const panelId = "research-source-group-web";
  const scopedFolders = useMemo(() => folders.filter((folder) => folder.scopeKey === scopeKey), [folders, scopeKey]);
  const scopedFolderIds = useMemo(() => new Set(scopedFolders.map((folder) => folder.id)), [scopedFolders]);
  const sourcePlacement = useCallback((source) => {
    const placement = placements[source.id];
    if (!placement) return { scopeKey: "global", folderId: "" };
    return { scopeKey: placement.scopeKey || "global", folderId: scopedFolderIds.has(placement.folderId) ? placement.folderId : "" };
  }, [placements, scopedFolderIds]);
  const scopedSources = useMemo(() => sources.filter((source) => sourcePlacement(source).scopeKey === scopeKey), [scopeKey, sourcePlacement, sources]);
  const toggleFolder = (folderId) => setExpandedFolders((current) => {
    const next = new Set(current);
    if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
    return next;
  });
  const childrenFor = useCallback((parentId = "") => [
    ...scopedFolders
      .filter((folder) => (folder.parentId || "") === parentId)
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" }))
      .map((folder) => ({ kind: "folder", value: folder })),
    ...scopedSources
      .filter((source) => sourcePlacement(source).folderId === parentId)
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
      .map((source) => ({ kind: "source", value: source })),
  ], [scopedFolders, scopedSources, sourcePlacement]);
  const rootNodes = useMemo(() => childrenFor(""), [childrenFor]);
  const nodeKey = (node) => `${node.kind}:${node.value.id || node.value.url || sourceDisplayName(node.value)}`;
  const renderWebRow = ({ entry: node, depth, expanded: folderExpanded, children }) => {
    const folder = node.kind === "folder";
    const value = node.value;
    const key = String(value.id || value.url || sourceDisplayName(value));
    return (
      <div
        className={folder ? "research-web-folder-row" : `research-source-item research-web-source-item${selectedKey === key ? " is-selected" : ""}`}
        style={{ "--research-web-depth": depth }}
        draggable={available && !readOnly}
        onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; setDragged({ type: node.kind, value }); }}
        onDragEnd={() => setDragged(null)}
        onDragOver={(event) => {
          if (folder && dragged && !(dragged.type === "folder" && dragged.value.id === value.id)) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!folder || !dragged) return;
          event.preventDefault();
          if (dragged.type === "folder" && dragged.value.id !== value.id) onMoveFolder?.(dragged.value, value.id);
          if (dragged.type === "source") onMoveSource?.(dragged.value, value.id);
          setDragged(null);
        }}
      >
        {folder ? (
          <TreeItemButton
            className="research-web-folder-main"
            branch
            expanded={folderExpanded}
            depth={depth}
            onActivate={() => toggleFolder(value.id)}
            onToggle={() => toggleFolder(value.id)}
          >
            <span className="research-web-entry-icon is-folder" aria-hidden="true">
              <img
                className="research-web-folder-icon"
                src={children.length ? FOLDER_FULL_ICON : FOLDER_EMPTY_ICON}
                alt=""
              />
            </span>
            <span>{value.name}</span>
          </TreeItemButton>
        ) : (
          <TreeItemButton className="research-source-item-main" depth={depth} selected={selectedKey === key} onActivate={() => onOpen?.(value)}>
            <span className="research-web-entry-icon research-web-source-icon" aria-hidden="true"><Globe2 size={15} /></span>
            <span className="research-web-source-copy"><strong>{sourceDisplayName(value)}</strong><small>{value.url}</small></span>
          </TreeItemButton>
        )}
        <div className="research-source-item-actions">
          {folder ? (
            <>
              <button type="button" disabled={!available || readOnly} onClick={() => onAdd?.(value.id)} aria-label={`在 ${value.name} 中新增网页`} title="新增网页"><Globe2 size={13} /></button>
              <button type="button" disabled={!available || readOnly} onClick={() => onCreateFolder?.(value.id)} aria-label={`在 ${value.name} 中新建子文件夹`} title="新建子文件夹"><FolderPlus size={13} /></button>
              <button type="button" disabled={!available || readOnly} onClick={() => onRenameFolder?.(value)} aria-label={`重命名 ${value.name}`} title="重命名"><Pencil size={13} /></button>
              <button type="button" disabled={!available || readOnly} onClick={() => onDeleteFolder?.(value)} aria-label={`删除 ${value.name}`} title="删除并提升内容"><Trash2 size={13} /></button>
            </>
          ) : (
            <>
              <button type="button" disabled={!available || readOnly} onClick={() => onEdit?.(value)} aria-label={`编辑 ${sourceDisplayName(value)}`} title="编辑"><Pencil size={13} /></button>
              <button type="button" disabled={!available || readOnly} onClick={() => onDelete?.(value)} aria-label={`删除 ${sourceDisplayName(value)}`} title="删除"><Trash2 size={13} /></button>
            </>
          )}
        </div>
      </div>
    );
  };
  const dropAtRoot = (event) => {
    if (!dragged) return;
    event.preventDefault();
    event.stopPropagation();
    if (dragged.type === "folder") onMoveFolder?.(dragged.value, "");
    if (dragged.type === "source") onMoveSource?.(dragged.value, "");
    setDragged(null);
  };
  return (
    <section className="research-source-group research-web-source-group" aria-labelledby={`${panelId}-title`}>
      <div className="research-source-group-heading">
        <button
          type="button"
          id={`${panelId}-title`}
          className="research-source-group-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Globe2 size={15} aria-hidden="true" />
          <strong>网页</strong>
          <small>{scopedSources.length}</small>
        </button>
        <div className="research-web-heading-actions" role="group" aria-label="网页分组操作">
          <button type="button" className={`research-icon-button${workspaceConnected ? " is-active" : ""}`} disabled={!available || !workspaceAvailable} onClick={onToggleWorkspace} aria-label={workspaceConnected ? `断开工作区网页区 ${workspaceName}` : "连接当前工作区"} title={!available ? "请先选择资料文件夹" : workspaceAvailable ? (workspaceConnected ? `已连接 ${workspaceName}，点击断开` : "连接当前工作区") : "浏览器预览或未打开文件工作区时不能连接"}>{workspaceConnected ? <Unlink size={14} /> : <Link2 size={14} />}</button>
          {workspaceConnected ? <button type="button" className="research-icon-button" disabled={!available || readOnly || !globalContentCount} onClick={onCopyFromGlobal} aria-label="从公区复制网页资料" title={globalContentCount ? "从公区复制" : "公区暂无可复制内容"}><CopyPlus size={14} /></button> : null}
          <button type="button" className="research-icon-button" disabled={!available || readOnly} onClick={() => onCreateFolder?.("")} aria-label="新建网页文件夹" title={available ? "新建文件夹" : "请先选择资料文件夹"}><FolderPlus size={14} /></button>
          <button type="button" className="research-icon-button" disabled={!available || readOnly} onClick={() => onAdd?.("")} aria-label="新增网页" title={available ? "新增网页" : "请先选择资料文件夹"}><FileInput size={14} /></button>
        </div>
      </div>
      {expanded ? (
        <div
          id={panelId}
          className="research-source-items research-section-tree-body research-web-tree-root"
          onDragOver={(event) => { if (dragged) event.preventDefault(); }}
          onDrop={(event) => {
            if (event.target !== event.currentTarget || !dragged) return;
            dropAtRoot(event);
          }}
        >
          {available && workspaceConnected ? <p className="research-web-scope-label"><Link2 size={12} />{workspaceName || "当前工作区"}</p> : null}
          {available && rootNodes.length ? (
            <HierarchicalTree
              className="research-web-tree"
              ariaLabel={workspaceConnected ? "工作区私区网页树" : "公区网页树"}
              entries={rootNodes}
              getKey={nodeKey}
              isBranch={(node) => node.kind === "folder"}
              isExpanded={(node) => node.kind === "folder" && expandedFolders.has(node.value.id)}
              getChildren={(node) => node.kind === "folder" ? childrenFor(node.value.id) : []}
              getGroupLabel={({ entry }) => `${entry.value.name} 的网页内容`}
              wrapperClassName="research-web-tree-branch"
              childrenClassName="research-web-tree-children"
              renderRow={renderWebRow}
              renderBranchState={(status, { entry }) => status === "empty" ? <p className="research-web-tree-empty">{entry.value.name} 中暂无内容</p> : null}
            />
          ) : null}
          {!available ? <p className="research-compact-empty">选择资料文件夹后即可管理网页。</p> : null}
          {available && !rootNodes.length ? <p className="research-compact-empty">这个网页区还是空的。</p> : null}
          {available && rootNodes.length ? (
            <div
              className={`research-web-root-dropzone${dragged ? " is-active" : ""}`}
              aria-hidden={dragged ? undefined : "true"}
              onDragOver={(event) => {
                if (!dragged) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={dropAtRoot}
            >
              {dragged ? <span>放到这里，移至网页根级</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ResearchContextMenu({ menu, callbacks, onClose }) {
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    window.requestAnimationFrame(() => menuRef.current?.querySelector("button")?.focus());
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [menu, onClose]);
  if (!menu || typeof document === "undefined") return null;
  const actions = (menu.actions || RESEARCH_CONTEXT_ACTIONS[researchEntryType(menu.entry)] || []).filter((action) => {
    if (["rename", "move", "trash"].includes(action) && menu.entry.protected) return false;
    return typeof callbacks[action] === "function";
  });
  const content = (
    <div
      ref={menuRef}
      className="research-context-menu"
      role="menu"
      aria-label={menu.label || `${menu.entry.name} 操作`}
      style={{ left: menu.x, top: menu.y }}
    >
      {actions.map((action) => {
        const [Icon, label] = ACTION_LABELS[action];
        return (
          <button
            key={action}
            type="button"
            role="menuitem"
            className={action === "trash" ? "is-danger" : ""}
            onClick={() => {
              callbacks[action]?.(menu.entry);
              onClose();
            }}
          ><Icon size={14} /><span>{label}</span></button>
        );
      })}
    </div>
  );
  return createPortal(content, document.body);
}

export default function ResearchSidebar({
  rootPath = "",
  libraryId = "",
  currentRelativePath = "",
  entries = [],
  expandedFolders = {},
  selectedKey = "",
  webSources = [],
  webFolders = [],
  webPlacements = {},
  webScopeKey = "global",
  webWorkspaceName = "",
  webWorkspaceConnected = false,
  webWorkspaceAvailable = false,
  webTreeReadOnly = false,
  loading = false,
  error = "",
  busyKeys,
  onPickRoot,
  onNavigatePath,
  onToggleFolder,
  onOpenEntry,
  onCreateFolder,
  onImportFiles,
  onRenameEntry,
  onMoveEntry,
  onTrashEntry,
  onCopyPath,
  onShowInFolder,
  onAddWeb,
  onToggleWebWorkspace,
  onCopyWebFromGlobal,
  onCreateWebFolder,
  onRenameWebFolder,
  onDeleteWebFolder,
  onMoveWebFolder,
  onMoveWebSource,
  onOpenSource,
  onEditSource,
  onDeleteSource,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [filesExpanded, setFilesExpanded] = useState(true);
  const libraryAvailable = Boolean(rootPath && libraryId);
  const globalContentCount = useMemo(() => (
    webFolders.filter((folder) => folder.scopeKey === "global").length
    + webSources.filter((source) => (webPlacements[source.id]?.scopeKey || "global") === "global").length
  ), [webFolders, webPlacements, webSources]);
  const rootName = rootPath ? rootPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : "";
  const currentPath = normalizeResearchRelativePath(currentRelativePath);
  const currentName = currentPath.split("/").filter(Boolean).pop() || rootName || "尚未选择";
  const parentPath = parentResearchRelativePath(currentPath);
  const visibleEntries = useMemo(() => entries.filter(isVisibleResearchEntry), [entries]);
  const pathSeparator = rootPath.includes("\\") ? "\\" : "/";
  const currentAbsolutePath = currentPath
    ? `${rootPath.replace(/[\\/]+$/, "")}${pathSeparator}${currentPath.replace(/\//g, pathSeparator)}`
    : rootPath;
  const currentDirectoryEntry = useMemo(() => ({
    type: "folder",
    kind: "folder",
    name: currentName,
    relativePath: currentPath,
    protected: true,
  }), [currentName, currentPath]);
  const openContextMenu = useCallback((event, entry, options = {}) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      entry,
      actions: options.actions,
      label: options.label,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 242)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 286)),
    });
  }, []);
  const callbacks = useMemo(() => ({
    createFolder: onCreateFolder,
    importFiles: onImportFiles,
    rename: onRenameEntry,
    move: (entry) => onMoveEntry?.(entry, null),
    copyPath: onCopyPath,
    showInFolder: onShowInFolder,
    trash: onTrashEntry,
  }), [onCopyPath, onCreateFolder, onImportFiles, onMoveEntry, onRenameEntry, onShowInFolder, onTrashEntry]);

  return (
    <section className="research-sidebar" aria-label="资料区" data-library-id={libraryId || undefined} data-current-relative-path={currentPath}>
      <header className="folder-pathbar research-folder-pathbar">
        <div className="folder-path-main" title={currentAbsolutePath || "尚未选择资料文件夹"} aria-label={`资料区位置：${currentAbsolutePath || "尚未选择"}`}>
          <span className="folder-path-meta">
            <img className="asset-icon folder-path-asset" src={FOLDER_EMPTY_ICON} alt="" aria-hidden="true" />
            <span>资料区位置</span>
            <i>{visibleEntries.length} 项</i>
          </span>
          <strong>{currentName}</strong>
          <small>{currentAbsolutePath || "选择一个与文件区独立的资料文件夹"}</small>
        </div>
        <button type="button" className="folder-path-open" onClick={onPickRoot} aria-label={rootPath ? "更换资料文件夹" : "选择资料文件夹"} title={rootPath ? "更换资料文件夹" : "选择资料文件夹"}>
          <FolderOpen size={16} />
          <span>{rootPath ? "更换" : "选择"}</span>
        </button>
      </header>

      <div className="research-sidebar-scroll">
            <section className="research-files-section" aria-labelledby="research-files-heading">
              <div className="research-files-heading">
                <button
                  type="button"
                  id="research-files-heading"
                  className="research-files-toggle"
                  aria-expanded={filesExpanded}
                  aria-controls="research-files-content"
                  onClick={() => setFilesExpanded((value) => !value)}
                >
                  {filesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <LibraryBig size={15} aria-hidden="true" />
                  <strong>资料</strong>
                  <small>{visibleEntries.length}</small>
                </button>
                <div role="group" aria-label="资料文件操作">
                  <button type="button" disabled={!libraryAvailable} onClick={() => onCreateFolder?.(currentDirectoryEntry)} aria-label="在当前位置新建资料文件夹" title={libraryAvailable ? "新建文件夹" : "请先选择资料文件夹"}><FolderPlus size={14} /></button>
                  <button type="button" disabled={!libraryAvailable} onClick={() => onImportFiles?.(currentDirectoryEntry)} aria-label="导入资料文件到当前位置" title={libraryAvailable ? "导入文件" : "请先选择资料文件夹"}><Import size={14} /></button>
                </div>
              </div>
              {filesExpanded ? (
                <div id="research-files-content" className="research-section-tree-body research-files-tree-root">
                  {libraryAvailable && currentPath ? (
                    <button type="button" className="research-parent-entry" onClick={() => onNavigatePath?.(parentPath)} title="返回上级资料文件夹">
                      <img src={FOLDER_EMPTY_ICON} alt="" aria-hidden="true" />
                      <span>...</span>
                    </button>
                  ) : null}
                  {libraryAvailable && loading ? <p className="research-sidebar-state" role="status"><LoaderCircle className="research-spin" size={17} />正在读取资料目录…</p> : null}
                  {libraryAvailable && !loading && error ? <p className="research-sidebar-state is-error" role="alert">{error}</p> : null}
                  {libraryAvailable && !loading && !error && visibleEntries.length ? (
                    <ResearchTree
                      entries={visibleEntries}
                      expandedFolders={expandedFolders}
                      selectedKey={selectedKey}
                      busyKeys={busyKeys}
                      onToggleFolder={onToggleFolder}
                      onOpenEntry={onOpenEntry}
                      onMoveEntry={onMoveEntry}
                      onContextMenu={openContextMenu}
                    />
                  ) : null}
                  {!libraryAvailable ? <p className="research-compact-empty is-files">选择资料文件夹后即可管理资料。</p> : null}
                  {libraryAvailable && !loading && !error && !visibleEntries.length ? <p className="research-compact-empty is-files">资料目录还是空的，可导入文件或新建文件夹。</p> : null}
                </div>
              ) : null}
            </section>

            <div
              className="research-create-folder-gap"
              role={libraryAvailable ? "button" : undefined}
              tabIndex={libraryAvailable ? 0 : -1}
              aria-disabled={!libraryAvailable || undefined}
              aria-label="资料空白区，右键可新建文件夹"
              onContextMenu={libraryAvailable ? (event) => openContextMenu(event, currentDirectoryEntry, { actions: ["createFolder"], label: "资料空白区操作" }) : undefined}
              onKeyDown={(event) => {
                if (!libraryAvailable) return;
                if (!((event.shiftKey && event.key === "F10") || event.key === "ContextMenu")) return;
                const rect = event.currentTarget.getBoundingClientRect();
                openContextMenu({
                  clientX: rect.left + 16,
                  clientY: rect.top + 16,
                  preventDefault: () => event.preventDefault(),
                  stopPropagation: () => event.stopPropagation(),
                }, currentDirectoryEntry, { actions: ["createFolder"], label: "资料空白区操作" });
              }}
            />

            <WebSourceGroup
              sources={webSources}
              folders={webFolders}
              placements={webPlacements}
              scopeKey={webScopeKey}
              workspaceName={webWorkspaceName}
              workspaceConnected={webWorkspaceConnected}
              workspaceAvailable={webWorkspaceAvailable}
              available={libraryAvailable}
              globalContentCount={globalContentCount}
              readOnly={webTreeReadOnly}
              selectedKey={selectedKey}
              onToggleWorkspace={onToggleWebWorkspace}
              onCopyFromGlobal={onCopyWebFromGlobal}
              onAdd={onAddWeb}
              onCreateFolder={onCreateWebFolder}
              onRenameFolder={onRenameWebFolder}
              onDeleteFolder={onDeleteWebFolder}
              onMoveFolder={onMoveWebFolder}
              onMoveSource={onMoveWebSource}
              onOpen={onOpenSource}
              onEdit={onEditSource}
              onDelete={onDeleteSource}
            />
      </div>
      <p className="research-local-boundary">{libraryAvailable ? "资料独立保存在所选目录，不会发送给 AI" : "选择资料文件夹以启用资料与网页管理"}</p>

      <ResearchContextMenu menu={contextMenu} callbacks={callbacks} onClose={() => setContextMenu(null)} />
    </section>
  );
}

export { RESEARCH_CONTEXT_ACTIONS, normalizeExpandedFolders } from "./research-ui-model.js";
