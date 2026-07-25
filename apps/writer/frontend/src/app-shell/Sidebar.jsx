import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditorState } from "@tiptap/react";
import {
  BookOpen,
  ChevronRight,
  FileText,
  FolderOpen,
  ListTree,
} from "lucide-react";
import { getPaperDerivedState } from "../editor/index.js";
import { HierarchicalTreeRows, TreeItemButton } from "../HierarchicalTree.jsx";
import { ICON_ASSETS } from "./assets.js";
import { TreeContextMenu } from "./Menus.jsx";
import {
  displayNameFromPath,
  parentPathFromPath,
  pathIsSameOrInside,
} from "./path-display.js";

export function FolderEntryRows({
  entries,
  currentPath,
  expandedFolders,
  depth = 0,
  onOpenFile,
  onOpenFolderPath,
  onToggleFolder,
  onContextMenu,
  onDragPointerDown = () => {},
  onConsumeDragClick = () => false,
  dragTargetPath = "",
}) {
  const handleFolderClick = useCallback((path) => {
    if (onConsumeDragClick()) {
      return;
    }
    onToggleFolder(path);
  }, [onConsumeDragClick, onToggleFolder]);

  const navigateFolder = useCallback((path) => {
    if (onConsumeDragClick()) return;
    onOpenFolderPath(path);
  }, [onConsumeDragClick, onOpenFolderPath]);

  return (
    <HierarchicalTreeRows
      entries={entries}
      depth={depth}
      getKey={(entry) => entry.path}
      isBranch={(entry) => entry.type === "folder"}
      isExpanded={(entry) => Boolean(expandedFolders[entry.path]?.expanded)}
      getBranchState={(entry) => expandedFolders[entry.path] || { expanded: false, loading: false, entries: [] }}
      getChildren={(_entry, state) => state.entries || []}
      getGroupLabel={({ entry }) => `${entry.name} 的内容`}
      wrapperClassName={({ branch }) => branch ? "folder-tree-group" : "folder-tree-leaf"}
      childrenClassName="folder-tree-children"
      renderRow={({ entry, depth: rowDepth, branch, expanded }) => branch ? (
          <div
            className={dragTargetPath === entry.path ? "folder-tree-row folder-entry drag-target" : "folder-tree-row folder-entry"}
            style={{ "--tree-depth": rowDepth }}
            data-drop-folder-path={entry.path}
          >
            <button
              type="button"
              className={expanded ? "folder-disclosure expanded" : "folder-disclosure"}
              onClick={() => onToggleFolder(entry.path)}
              aria-label={expanded ? "折叠文件夹" : "展开文件夹"}
              title={expanded ? "折叠文件夹" : "展开文件夹"}
            >
              <ChevronRight size={14} />
            </button>
            <TreeItemButton
              className={dragTargetPath === entry.path ? "folder-entry-main drag-target" : "folder-entry-main"}
              branch
              expanded={expanded}
              depth={rowDepth}
              data-drop-folder-path={entry.path}
              onActivate={() => handleFolderClick(entry.path)}
              onToggle={(nextExpanded) => {
                if (nextExpanded !== expanded) onToggleFolder(entry.path);
              }}
              onNavigate={() => navigateFolder(entry.path)}
              onContextMenu={(event) => onContextMenu(event, entry)}
              onPointerDown={(event) => onDragPointerDown(event, entry)}
              title={`${entry.name}（单击展开/收起，双击或按 Enter 进入）`}
            >
              <img
                className="asset-icon folder-asset-icon"
                src={entry.hasLetterpapers === false ? ICON_ASSETS.goldFolderEmpty : ICON_ASSETS.goldFolderFull}
                alt=""
                aria-hidden="true"
              />
              <span>{entry.name}</span>
            </TreeItemButton>
          </div>
      ) : (
      <TreeItemButton
        type="button"
        className={entry.path === currentPath ? "folder-tree-row file-entry active" : "folder-tree-row file-entry"}
        style={{ "--tree-depth": rowDepth }}
        depth={rowDepth}
        selected={entry.path === currentPath}
        onActivate={() => {
          if (onConsumeDragClick()) {
            return;
          }
          onOpenFile(entry.path);
        }}
        onContextMenu={(event) => onContextMenu(event, entry)}
        onPointerDown={(event) => onDragPointerDown(event, entry)}
        title={entry.name}
      >
        {entry.path === currentPath ? <span className="document-dot" /> : <span className="folder-disclosure-spacer" />}
        <img className="asset-icon pen-asset-icon" src={ICON_ASSETS.brandMark} alt="" aria-hidden="true" />
        <span>{entry.displayName || entry.name}</span>
      </TreeItemButton>
      )}
      renderBranchState={(status, { depth: branchDepth, state }) => (
        <p
          className="folder-tree-hint"
          style={{ "--tree-depth": branchDepth + 1 }}
          role={status === "loading" ? "status" : status === "error" ? "alert" : undefined}
        >
          {status === "loading" ? "读取中..." : status === "error" ? (state.error || "文件夹读取失败") : "空文件夹"}
        </p>
      )}
    />
  );
}

export function LiveOutlineSidebar({ editor, renderStructurePanel, ...props }) {
  const outlineItems = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getPaperDerivedState(activeEditor).outlineItems,
  }) || [];
  const structurePanel = typeof renderStructurePanel === "function"
    ? renderStructurePanel(outlineItems)
    : props.structurePanel;
  return <LeftSidebar {...props} structurePanel={structurePanel} outlineItems={outlineItems} />;
}

export function LeftSidebar({
  currentPath,
  folderState,
  mode,
  outlineItems,
  expandedFolders,
  onOpenFolder,
  onOpenFolderPath,
  onOpenFolderFile,
  onToggleFolder,
  onCreateFolder,
  onCreateDocument,
  onRenameEntry,
  onBackupDocument,
  onDeleteEntry,
  onMoveEntry,
  onModeChange,
  onOutlineItemClick,
  researchPanel,
  structurePanel,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [dragState, setDragState] = useState(null);
  const dragSuppressClickRef = useRef(false);
  const folderEntries = folderState.entries || [
    ...(folderState.folders || []),
    ...(folderState.files || []),
  ];
  const visibleParentPath = folderState.parentPath
    && (!folderState.rootPath || pathIsSameOrInside(folderState.parentPath, folderState.rootPath))
    ? folderState.parentPath
    : "";

  const consumeDragClick = useCallback(() => {
    if (!dragSuppressClickRef.current) {
      return false;
    }
    dragSuppressClickRef.current = false;
    return true;
  }, []);

  const getDropFolderPath = useCallback((clientX, clientY, draggedEntry) => {
    const element = window.document.elementFromPoint(clientX, clientY)?.closest?.("[data-drop-folder-path]");
    const targetPath = element?.dataset?.dropFolderPath || "";
    if (!targetPath || !draggedEntry?.path || targetPath === draggedEntry.path) {
      return "";
    }
    if (parentPathFromPath(draggedEntry.path) === targetPath) {
      return "";
    }
    if (draggedEntry.type === "folder" && pathIsSameOrInside(targetPath, draggedEntry.path)) {
      return "";
    }
    return targetPath;
  }, []);

  const startTreeDrag = useCallback((event, entry) => {
    if (!entry?.path || event.button !== 0) {
      return;
    }

    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let latestX = startX;
    let latestY = startY;

    const cleanup = () => {
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", handleUp, true);
      window.removeEventListener("pointercancel", handleCancel, true);
    };

    const beginDrag = () => {
      if (active) {
        return;
      }
      active = true;
      dragSuppressClickRef.current = true;
      setContextMenu(null);
      setDragState({
        entry,
        x: latestX,
        y: latestY,
        targetPath: getDropFolderPath(latestX, latestY, entry),
      });
    };

    const finish = async (clientX, clientY) => {
      cleanup();
      if (!active) {
        return;
      }
      dragSuppressClickRef.current = true;
      const targetPath = getDropFolderPath(clientX, clientY, entry);
      setDragState(null);
      if (targetPath) {
        await onMoveEntry?.(entry, targetPath);
      }
    };

    const handleMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      latestX = moveEvent.clientX;
      latestY = moveEvent.clientY;
      const distance = Math.hypot(latestX - startX, latestY - startY);
      if (!active && distance > 2) {
        beginDrag();
      }
      if (active) {
        moveEvent.preventDefault();
        const targetPath = getDropFolderPath(latestX, latestY, entry);
        setDragState((state) => state ? {
          ...state,
          x: latestX,
          y: latestY,
          targetPath,
        } : state);
      }
    };

    const handleUp = (upEvent) => {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      finish(upEvent.clientX, upEvent.clientY);
    };

    const handleCancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== pointerId) {
        return;
      }
      cleanup();
      setDragState(null);
    };

    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", handleUp, true);
    window.addEventListener("pointercancel", handleCancel, true);
  }, [getDropFolderPath, onMoveEntry]);

  const openTreeContextMenu = useCallback((event, entry) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      entry,
      returnFocusElement: event.currentTarget,
      x: Math.min(event.clientX, window.innerWidth - 210),
      y: Math.min(event.clientY, window.innerHeight - 220),
    });
  }, []);

  const currentFolderContextEntry = useMemo(() => (
    folderState.path ? {
      type: "folder",
      name: displayNameFromPath(folderState.path),
      path: folderState.path,
      hasLetterpapers: true,
      protected: true,
    } : null
  ), [folderState.path]);

  const openBlankAreaContextMenu = useCallback((event) => {
    if (!currentFolderContextEntry) {
      return;
    }
    if (event.target.closest?.(".folder-pathbar, .folder-tree-row, .folder-tree-group, .tree-context-menu")) {
      return;
    }
    openTreeContextMenu(event, currentFolderContextEntry);
  }, [currentFolderContextEntry, openTreeContextMenu]);

  return (
    <aside className="sidebar left-sidebar" id="left-sidebar">
      <section className="sidebar-panel documents-panel">
        <div className="sidebar-heading">
          <div className="sidebar-mode-switch" role="tablist" aria-label="左侧栏模式">
            <button
              type="button"
              className={mode === "folder" ? "active" : ""}
              onClick={() => onModeChange("folder")}
              role="tab"
              aria-selected={mode === "folder"}
            >
              <img
                className="sidebar-mode-icon"
                src={ICON_ASSETS.sidebarFolderTreeMode}
                alt=""
                aria-hidden="true"
              />
              <span>文件</span>
            </button>
            <button
              type="button"
              className={mode === "research" ? "active" : ""}
              onClick={() => onModeChange("research")}
              role="tab"
              aria-selected={mode === "research"}
            >
              <BookOpen className="sidebar-mode-lucide" size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>资料</span>
            </button>
            <button
              type="button"
              className={mode === "structure" ? "active" : ""}
              onClick={() => onModeChange("structure")}
              role="tab"
              aria-selected={mode === "structure"}
            >
              <img
                className="sidebar-mode-icon"
                src={ICON_ASSETS.sidebarOutlineMode}
                alt=""
                aria-hidden="true"
              />
              <span>结构</span>
            </button>
          </div>
        </div>

        {mode === "folder" ? (
          <>
            {folderState.path ? (
              <div
                className={dragState?.targetPath === folderState.path ? "document-list drag-target" : "document-list"}
                data-drop-folder-path={folderState.path}
                onContextMenu={openBlankAreaContextMenu}
              >
                <div className="folder-pathbar">
                  <div
                    className="folder-path-main"
                    title={folderState.path}
                    aria-label={`当前路径：${folderState.path}`}
                    onContextMenu={(event) => openTreeContextMenu(event, {
                      type: "folder",
                      name: displayNameFromPath(folderState.path),
                      path: folderState.path,
                      hasLetterpapers: true,
                      protected: true,
                    })}
                  >
                    <span className="folder-path-meta">
                      <img
                        className="asset-icon folder-path-asset"
                        src={ICON_ASSETS.goldFolderEmpty}
                        alt=""
                        aria-hidden="true"
                      />
                      <span>当前文件夹</span>
                      <i>{folderEntries.length} 项</i>
                    </span>
                    <strong>{displayNameFromPath(folderState.path)}</strong>
                    <small>{folderState.path}</small>
                  </div>
                  <button
                    type="button"
                    className="folder-path-open"
                    onClick={onOpenFolder}
                    aria-label="更换文件夹"
                    title="更换文件夹"
                  >
                    <FolderOpen size={16} />
                    <span>更换</span>
                  </button>
                </div>
                {visibleParentPath ? (
                  <button
                    type="button"
                    className="folder-tree-row parent-entry"
                    style={{ "--tree-depth": 0 }}
                    onClick={() => onOpenFolderPath(visibleParentPath)}
                    title="返回上级文件夹"
                  >
                    <span className="folder-disclosure-spacer" />
                    <img className="asset-icon folder-asset-icon" src={ICON_ASSETS.goldFolderEmpty} alt="" aria-hidden="true" />
                    <span>...</span>
                  </button>
                ) : null}
                <div className="folder-entry-scroll" role="tree" aria-label="当前文件夹的信笺树">
                  {folderState.loading ? (
                    <p className="empty-folder">正在读取文件树...</p>
                  ) : folderState.error ? (
                    <p className="empty-folder">{folderState.error}</p>
                  ) : folderEntries.length ? (
                    <FolderEntryRows
                      entries={folderEntries}
                      currentPath={currentPath}
                      expandedFolders={expandedFolders}
                      onOpenFile={onOpenFolderFile}
                      onOpenFolderPath={onOpenFolderPath}
                      onToggleFolder={onToggleFolder}
                      onContextMenu={openTreeContextMenu}
                      onDragPointerDown={startTreeDrag}
                      onConsumeDragClick={consumeDragClick}
                      dragTargetPath={dragState?.targetPath || ""}
                    />
                  ) : (
                    <p className="empty-folder">这个文件夹里还没有信笺文档或子文件夹。</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="folder-empty">
                <FileText size={28} />
                <span>打开一个文件夹后，这里会显示其中的信笺文档。</span>
                <button type="button" onClick={onOpenFolder}>打开文件夹</button>
              </div>
            )}
            <TreeContextMenu
              menu={contextMenu}
              onClose={() => setContextMenu(null)}
              onCreateFolder={onCreateFolder}
              onCreateDocument={onCreateDocument}
              onRename={onRenameEntry}
              onBackup={onBackupDocument}
              onDelete={onDeleteEntry}
            />
          </>
        ) : mode === "research" ? (
          researchPanel
        ) : structurePanel || (
          <div className="outline-list" aria-label="当前文档目录">
            {outlineItems.length ? (
              outlineItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`outline-row level-${item.level}`}
                  onClick={() => onOutlineItemClick(item)}
                  title={item.text}
                >
                  <span className="outline-marker" />
                  <span>{item.text}</span>
                </button>
              ))
            ) : (
              <div className="folder-empty outline-empty">
                <ListTree size={28} />
                <span>当前信笺还没有一、二、三级标题。</span>
              </div>
            )}
          </div>
        )}
        {dragState ? (
          <div
            className={dragState.targetPath ? "tree-drag-ghost valid" : "tree-drag-ghost"}
            style={{ left: dragState.x + 14, top: dragState.y + 14 }}
            aria-hidden="true"
          >
            <img
              className="asset-icon"
              src={dragState.entry.type === "folder"
                ? (dragState.entry.hasLetterpapers ? ICON_ASSETS.goldFolderFull : ICON_ASSETS.goldFolderEmpty)
                : ICON_ASSETS.brandMark}
              alt=""
            />
            <span>{dragState.entry.displayName || dragState.entry.name}</span>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
