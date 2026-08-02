import { useCallback, useEffect, useState } from "react";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  BookmarkPlus,
  BookOpen,
  BookOpenText,
  Code2,
  Download,
  FileInput,
  FilePlus,
  FileSearch,
  FileText,
  Focus,
  FolderSearch,
  GitBranch,
  Hash,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  HelpCircle,
  ImagePlus,
  Link2,
  List,
  ListOrdered,
  ListTree,
  Minus,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  PackageOpen,
  Plus,
  Quote,
  Redo2,
  Save,
  SaveAll,
  Search,
  SeparatorHorizontal,
  Settings,
  SmilePlus,
  Sparkles,
  Sigma,
  Table2,
  Undo2,
  Video,
} from "lucide-react";
import {
  IconButton,
  findKnowledgeNodePosition,
  getPaperDerivedState,
  insertBasicTable,
  insertHorizontalRule,
  insertPageBreak,
  insertStructuredQuote,
  insertTableOfContents,
  runEditorCommand,
  setHeadingLevel,
  toggleAutomaticBibliography,
} from "../editor/index.js";
import { MenuButton, MenuDivider, MenuItem } from "./Menus.jsx";

export function TopNav({
  editor,
  savedSelectionRef,
  onNew,
  onOpen,
  onImport,
  onSave,
  onOpenExport,
  onOpenProfileMigration,
  onInsertImage,
  onInsertAudio,
  onInsertVideo,
  onOpenLinkDialog,
  onInsertInternalLink,
  onInsertFootnote,
  onInsertEmoji,
  onInsertCodeBlock,
  onInsertMath,
  onInsertMermaid,
  onInsertBookmark,
  onOpenCitationPicker,
  onOpenHelp,
  onOpenSettings,
  settingsTriggerRef,
  elementsTriggerRef,
  exportTriggerRef,
  onOpenSearch,
  researchSearchAvailable,
  workspaceSearchAvailable,
  aiMode,
  aiModeKind,
  aiBusy,
  aiConfigured,
  aiModeChooserOpen,
  aiModeTriggerRef,
  aiReadOnly,
  editorLocked,
  documentReadOnly,
  onToggleAiModeChooser,
  immersiveMode,
  onToggleImmersive,
  leftSidebarCollapsed,
  onToggleLeftSidebar,
}) {
  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => {
      if (!activeEditor) {
        return { canUndo: false, canRedo: false, activeHeadingLevel: 0, bulletListActive: false, orderedListActive: false, activeAlignment: "", tableOfContentsInserted: false, bibliographyInserted: false };
      }
      return {
        canUndo: activeEditor.can().undo(),
        canRedo: activeEditor.can().redo(),
        activeHeadingLevel: [1, 2, 3, 4].find((level) => activeEditor.isActive("heading", { level })) || 0,
        bulletListActive: activeEditor.isActive("bulletList"),
        orderedListActive: activeEditor.isActive("orderedList"),
        activeAlignment: ["left", "center", "right"].find((value) => activeEditor.isActive({ textAlign: value })) || "",
        tableOfContentsInserted: getPaperDerivedState(activeEditor).hasTableOfContents,
        bibliographyInserted: Number.isFinite(findKnowledgeNodePosition(activeEditor, "paperBibliography")),
      };
    },
  }) || {};
  const canEdit = Boolean(editor) && !editorLocked && !aiMode;
  const documentActionsDisabled = Boolean(aiMode);
  const [openMenu, setOpenMenu] = useState("");
  const activeAiModeLabel = aiModeKind === "chat" ? "AI问答" : "AI优化";
  const aiModeTriggerDisabled = aiReadOnly && !aiMode;
  const aiModeTriggerLabel = aiModeTriggerDisabled
    ? "当前信笺为只读，不能进入 AI 模式"
    : (aiMode
      ? `AI模式，当前：${activeAiModeLabel}${aiBusy ? "，正在生成" : ""}`
      : "选择 AI 模式");
  const leftSidebarToggleLabel = leftSidebarCollapsed ? "展开左侧栏" : "收起左侧栏";
  const LeftSidebarToggleIcon = leftSidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const canUndo = canEdit && toolbarState.canUndo;
  const canRedo = canEdit && toolbarState.canRedo;
  const activeHeadingLevel = toolbarState.activeHeadingLevel || 0;
  const bulletListActive = Boolean(toolbarState.bulletListActive);
  const orderedListActive = Boolean(toolbarState.orderedListActive);
  const tableOfContentsInserted = Boolean(toolbarState.tableOfContentsInserted);
  const bibliographyInserted = Boolean(toolbarState.bibliographyInserted);
  const ListStyleIcon = orderedListActive ? ListOrdered : List;
  const activeAlignment = [
    { value: "left", label: "左对齐", icon: AlignLeft },
    { value: "center", label: "居中", icon: AlignCenter },
    { value: "right", label: "右对齐", icon: AlignRight },
  ].find((option) => toolbarState.activeAlignment === option.value);
  const AlignmentIcon = activeAlignment?.icon || AlignLeft;

  const closeMenus = useCallback(() => {
    setOpenMenu("");
  }, []);

  useEffect(() => {
    if (!openMenu) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".nav-menu")) {
        closeMenus();
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeMenus();
      }
    };

    window.document.addEventListener("pointerdown", handlePointerDown, true);
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown, true);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [closeMenus, openMenu]);

  const runMenuAction = useCallback(
    (action) => {
      closeMenus();
      action?.();
    },
    [closeMenus],
  );

  return (
    <section className="top-nav">
      <div className="nav-primary">
        <button
          type="button"
          className="nav-sidebar-toggle"
          disabled={documentActionsDisabled}
          title={leftSidebarToggleLabel}
          aria-label={leftSidebarToggleLabel}
          aria-controls="left-sidebar"
          aria-expanded={!leftSidebarCollapsed}
          onClick={onToggleLeftSidebar}
        >
          <LeftSidebarToggleIcon size={20} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <div className={openMenu === "search" ? "nav-menu nav-search-menu open" : "nav-menu nav-search-menu"}>
          <button
            type="button"
            className="nav-sidebar-toggle nav-search-toggle"
            disabled={documentActionsDisabled}
            title="搜索"
            aria-label="选择搜索范围"
            aria-haspopup="menu"
            aria-controls="nav-menu-search"
            aria-expanded={openMenu === "search"}
            onClick={() => setOpenMenu((current) => current === "search" ? "" : "search")}
          >
            <Search size={19} strokeWidth={1.9} aria-hidden="true" />
          </button>
          {openMenu === "search" ? (
            <div className="nav-menu-popover nav-search-popover" id="nav-menu-search" role="menu" aria-label="搜索范围">
              <button type="button" className="nav-search-option" role="menuitem" onClick={() => runMenuAction(() => onOpenSearch?.("document"))}>
                <FileSearch size={17} aria-hidden="true" />
                <span><strong>文档搜索</strong><small>查找文档中的文字</small></span>
                <kbd>Ctrl+F</kbd>
              </button>
              <button
                type="button"
                className="nav-search-option"
                role="menuitem"
                disabled={!workspaceSearchAvailable}
                title={workspaceSearchAvailable ? "搜索当前文件夹及全部子文件夹" : "请先打开一个文件夹"}
                onClick={() => runMenuAction(() => onOpenSearch?.("workspace"))}
              >
                <FolderSearch size={17} aria-hidden="true" />
                <span><strong>文件夹搜索</strong><small>{workspaceSearchAvailable ? "搜索当前文件夹与子文件夹" : "请先打开一个文件夹"}</small></span>
                <kbd>Ctrl+P</kbd>
              </button>
              <button
                type="button"
                className="nav-search-option"
                role="menuitem"
                disabled={!researchSearchAvailable}
                title={researchSearchAvailable ? "搜索当前资料区全部可解析资料和网页来源" : "请先选择资料文件夹"}
                onClick={() => runMenuAction(() => onOpenSearch?.("research"))}
              >
                <BookOpenText size={17} aria-hidden="true" />
                <span><strong>资料搜索</strong><small>{researchSearchAvailable ? "搜索本地资料、公区与当前私区网页" : "请先选择资料文件夹"}</small></span>
              </button>
            </div>
          ) : null}
        </div>
        <span className="nav-divider nav-primary-divider" />
        <MenuButton
          icon={FileText}
          label="文件"
          menuId="file"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={documentActionsDisabled}
          showDisclosure={false}
        >
          <MenuItem icon={FilePlus} label="新建文件" description="创建空白信笺" shortcut="Ctrl+N" onClick={() => runMenuAction(onNew)} />
          <MenuItem icon={FileText} label="打开文件" description="打开本地信笺" shortcut="Ctrl+O" onClick={() => runMenuAction(onOpen)} />
          <MenuDivider />
          <MenuItem icon={Save} label="保存" description="写入当前文件" shortcut="Ctrl+S" disabled={documentReadOnly} onClick={() => runMenuAction(() => onSave(false))} />
          <MenuItem icon={SaveAll} label="另存为" description="保存为新信笺" shortcut="Ctrl+Shift+S" disabled={documentReadOnly} onClick={() => runMenuAction(() => onSave(true))} />
        </MenuButton>
        <MenuButton
          icon={Download}
          label="出入"
          menuId="interchange"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={documentActionsDisabled}
          triggerRef={exportTriggerRef}
          showDisclosure={false}
        >
          <MenuItem icon={Download} label="导出信笺" description="PDF、图片与可编辑文档" shortcut="Ctrl+Alt+E" onClick={() => runMenuAction(onOpenExport)} />
          <MenuItem icon={FileInput} label="导入文档" description="MD、HTML、TXT、DOCX" shortcut="Ctrl+Alt+I" onClick={() => runMenuAction(onImport)} />
          <MenuItem icon={PackageOpen} label="备份与迁移" description="导入或导出软件配置" onClick={() => runMenuAction(onOpenProfileMigration)} />
        </MenuButton>
        <button
          type="button"
          className="nav-menu-trigger"
          title="帮助"
          aria-label="帮助"
          onClick={() => runMenuAction(onOpenHelp)}
        >
          <HelpCircle size={19} strokeWidth={1.9} />
          <span>帮助</span>
        </button>
        <button
          ref={settingsTriggerRef}
          type="button"
          className="nav-menu-trigger settings-feature-trigger"
          title="设置"
          aria-label="打开设置"
          onClick={() => runMenuAction(() => onOpenSettings?.())}
        >
          <Settings size={19} strokeWidth={1.9} aria-hidden="true" />
          <span>设置</span>
        </button>
      </div>

      <div className="nav-center">
        <button
          ref={aiModeTriggerRef}
          type="button"
          className={[
            "nav-menu-trigger",
            "ai-feature-trigger",
            aiMode ? "active" : "",
            aiBusy ? "busy" : "",
            aiConfigured ? "configured" : "unconfigured",
            aiModeChooserOpen ? "chooser-open" : "",
          ].filter(Boolean).join(" ")}
          disabled={aiModeTriggerDisabled}
          onClick={() => {
            closeMenus();
            onToggleAiModeChooser?.();
          }}
          title={aiModeTriggerLabel}
          aria-label={aiModeTriggerLabel}
          aria-pressed={aiMode}
          aria-haspopup="dialog"
          aria-controls="ai-mode-chooser-dialog"
          aria-expanded={aiModeChooserOpen}
          aria-busy={aiBusy}
        >
          <Sparkles size={19} strokeWidth={1.9} aria-hidden="true" />
          <span>AI模式</span>
        </button>
        <button
          type="button"
          className={["nav-menu-trigger", "focus-mode-trigger", immersiveMode ? "active" : ""].filter(Boolean).join(" ")}
          title={immersiveMode ? "退出专注模式（F11）" : "进入专注模式（F11）"}
          aria-label={immersiveMode ? "退出专注模式" : "进入专注模式"}
          aria-pressed={immersiveMode}
          onClick={() => runMenuAction(onToggleImmersive)}
        >
          <Focus size={19} strokeWidth={1.9} aria-hidden="true" />
          <span>专注模式</span>
        </button>
      </div>

      <div className="nav-tools">
        <div className="nav-tool-history" role="group" aria-label="编辑历史">
          <IconButton icon={Undo2} label="撤销（Ctrl+Z）" disabled={!canUndo} onClick={() => editor?.chain().focus().undo().run()} />
          <IconButton icon={Redo2} label="重做（Ctrl+Shift+Z）" disabled={!canRedo} onClick={() => editor?.chain().focus().redo().run()} />
        </div>
        <span className="nav-divider" />
        <MenuButton
          icon={FileText}
          label="标题"
          menuId="heading"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={!canEdit}
          triggerClassName={["tool-menu-trigger", activeHeadingLevel ? "active" : ""].filter(Boolean).join(" ")}
          showDisclosure={false}
        >
          <MenuItem icon={Heading1} label="一级标题" selection active={activeHeadingLevel === 1} onClick={() => runMenuAction(() => setHeadingLevel(editor, savedSelectionRef, 1))} />
          <MenuItem icon={Heading2} label="二级标题" selection active={activeHeadingLevel === 2} onClick={() => runMenuAction(() => setHeadingLevel(editor, savedSelectionRef, 2))} />
          <MenuItem icon={Heading3} label="三级标题" selection active={activeHeadingLevel === 3} onClick={() => runMenuAction(() => setHeadingLevel(editor, savedSelectionRef, 3))} />
          <MenuItem icon={Heading4} label="四级标题" selection active={activeHeadingLevel === 4} onClick={() => runMenuAction(() => setHeadingLevel(editor, savedSelectionRef, 4))} />
        </MenuButton>
        <button
          type="button"
          className={tableOfContentsInserted ? "nav-command tool-command active" : "nav-command tool-command"}
          disabled={!canEdit}
          title={tableOfContentsInserted ? "关闭目录" : "生成目录"}
          aria-label={tableOfContentsInserted ? "关闭目录" : "生成目录"}
          aria-pressed={tableOfContentsInserted}
          onClick={() => insertTableOfContents(editor, savedSelectionRef)}
        >
          <ListTree size={18} strokeWidth={1.9} aria-hidden="true" />
          <span>目录</span>
        </button>
        <button
          type="button"
          className={bibliographyInserted ? "nav-command tool-command active" : "nav-command tool-command"}
          disabled={!canEdit}
          title={bibliographyInserted ? "关闭自动参考文献" : "在文尾生成参考文献"}
          aria-label={bibliographyInserted ? "关闭自动参考文献" : "在文尾生成参考文献"}
          aria-pressed={bibliographyInserted}
          onClick={() => toggleAutomaticBibliography(editor)}
        >
          <BookOpen size={18} strokeWidth={1.9} aria-hidden="true" />
          <span>参考</span>
        </button>
        <MenuButton
          icon={AlignmentIcon}
          label="对齐"
          menuId="alignment"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={!canEdit}
          triggerClassName={["tool-menu-trigger", activeAlignment ? "active" : ""].filter(Boolean).join(" ")}
          showDisclosure={false}
        >
          {[{ value: "left", label: "左对齐", icon: AlignLeft }, { value: "center", label: "居中", icon: AlignCenter }, { value: "right", label: "右对齐", icon: AlignRight }].map((option) => (
            <MenuItem
              key={option.value}
              icon={option.icon}
              label={option.label}
              selection
              active={activeAlignment?.value === option.value}
              onClick={() => runMenuAction(() => runEditorCommand(editor, savedSelectionRef, (chain) => chain.setTextAlign(option.value)))}
            />
          ))}
        </MenuButton>
        <MenuButton
          icon={ListStyleIcon}
          label="列表"
          menuId="list-style"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={!canEdit}
          triggerClassName={["tool-menu-trigger", bulletListActive || orderedListActive ? "active" : ""].filter(Boolean).join(" ")}
          showDisclosure={false}
        >
          <MenuItem icon={List} label={bulletListActive ? "取消无序列表" : "无序列表"} selection active={bulletListActive} onClick={() => runMenuAction(() => runEditorCommand(editor, savedSelectionRef, (chain) => chain.toggleBulletList()))} />
          <MenuItem icon={ListOrdered} label={orderedListActive ? "取消有序列表" : "有序列表"} selection active={orderedListActive} onClick={() => runMenuAction(() => runEditorCommand(editor, savedSelectionRef, (chain) => chain.toggleOrderedList()))} />
        </MenuButton>
        <span className="nav-divider" />
        <MenuButton
          icon={ImagePlus}
          label="媒体"
          menuId="media"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={!canEdit}
          triggerClassName="tool-menu-trigger"
          showDisclosure={false}
        >
          <MenuItem icon={ImagePlus} label="图片" onClick={() => runMenuAction(onInsertImage)} />
          <MenuItem icon={Music2} label="音频" onClick={() => runMenuAction(onInsertAudio)} />
          <MenuItem icon={Video} label="视频" onClick={() => runMenuAction(onInsertVideo)} />
          <MenuDivider />
          <MenuItem icon={Link2} label="链接" onClick={() => runMenuAction(onOpenLinkDialog)} />
        </MenuButton>
        <MenuButton
          icon={Plus}
          label="元素"
          menuId="elements"
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          disabled={!canEdit}
          triggerClassName={["tool-menu-trigger", editor?.isActive("blockquote") ? "active" : ""].filter(Boolean).join(" ")}
          showDisclosure={false}
          triggerRef={elementsTriggerRef}
        >
          <MenuItem icon={SmilePlus} label="表情" onClick={() => runMenuAction(onInsertEmoji)} />
          <MenuItem icon={BookmarkPlus} label="书签" onClick={() => runMenuAction(onInsertBookmark)} />
          <MenuDivider />
          <MenuItem icon={Quote} label={editor?.isActive("blockquote") ? "取消引文" : "引文"} checked={Boolean(editor?.isActive("blockquote"))} onClick={() => runMenuAction(() => insertStructuredQuote(editor, savedSelectionRef))} />
          <MenuItem icon={Table2} label="表格" onClick={() => runMenuAction(() => insertBasicTable(editor, savedSelectionRef))} />
          <MenuDivider />
          <MenuItem icon={Minus} label="分割线" onClick={() => runMenuAction(() => insertHorizontalRule(editor, savedSelectionRef))} />
          <MenuItem icon={SeparatorHorizontal} label="分页符" onClick={() => runMenuAction(() => insertPageBreak(editor, savedSelectionRef))} />
          <MenuDivider />
          <MenuItem icon={Code2} label="代码块" onClick={() => runMenuAction(onInsertCodeBlock)} />
          <MenuItem icon={Sigma} label="公式" onClick={() => runMenuAction(onInsertMath)} />
          <MenuItem icon={GitBranch} label="Mermaid 图" onClick={() => runMenuAction(onInsertMermaid)} />
          <MenuDivider />
          <MenuItem icon={Link2} label="关联信笺" onClick={() => runMenuAction(onInsertInternalLink)} />
          <MenuItem icon={Hash} label="脚注" onClick={() => runMenuAction(onInsertFootnote)} />
          <MenuItem icon={BookOpen} label="文献引用" onClick={() => runMenuAction(onOpenCitationPicker)} />
        </MenuButton>
      </div>
    </section>
  );
}
