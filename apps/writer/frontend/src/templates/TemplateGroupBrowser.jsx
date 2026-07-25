import {
  Check,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  BASE_USER_TEMPLATE_GROUP_ID,
  SYSTEM_TEMPLATE_GROUPS,
  TEMPLATES,
} from "./model.js";

function TemplateGroupItem({
  group,
  isUserGroup,
  selectionOnly,
  userTemplates,
  userTemplateGroups,
  selectedGroupId,
  groupDragState,
  groupItemRefs,
  suppressGroupClickRef,
  onGroupPointerDown,
  onSelectGroup,
  onRenameGroup,
  onRequestDeleteGroup,
  onReorderUserTemplateGroups,
}) {
  const count = isUserGroup
    ? userTemplates.filter((template) => template.groupIds?.includes(group.id)).length
    : group.templateIds.length;
  const isSelected = selectedGroupId === group.id;
  const isReorderable = !selectionOnly && isUserGroup && group.id !== BASE_USER_TEMPLATE_GROUP_ID;
  const isDragging = groupDragState?.id === group.id;
  return (
    <div
      ref={(element) => {
        if (element) {
          groupItemRefs.current.set(group.id, element);
        } else {
          groupItemRefs.current.delete(group.id);
        }
      }}
      className={[
        "template-group-item",
        isSelected ? "selected" : "",
        isUserGroup ? "user" : "system",
        isReorderable ? "reorderable" : "",
        isDragging ? "dragging" : "",
      ].filter(Boolean).join(" ")}
      data-user-group-id={isUserGroup ? group.id : undefined}
      data-user-group-reorderable={isReorderable ? "true" : undefined}
      aria-grabbed={isDragging || undefined}
      onPointerDown={isReorderable ? (event) => onGroupPointerDown(event, group) : undefined}
    >
      <button
        type="button"
        className="template-group-main"
        onClick={() => {
          if (suppressGroupClickRef.current) {
            return;
          }
          onSelectGroup(group.id);
        }}
        onKeyDown={(event) => {
          if (!isReorderable || !event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) {
            return;
          }
          const currentIndex = userTemplateGroups.findIndex((item) => item.id === group.id);
          const targetIndex = event.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
          if (targetIndex < 1 || targetIndex >= userTemplateGroups.length) {
            return;
          }
          event.preventDefault();
          onReorderUserTemplateGroups(group.id, targetIndex);
        }}
        aria-current={isSelected ? "true" : undefined}
        aria-label={`${group.label}，${count} 个模板`}
        aria-keyshortcuts={isReorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
        title={isReorderable ? "按住左键拖动排序" : undefined}
      >
        <span>{group.label}<b>({count})</b></span>
      </button>
      {!selectionOnly && isUserGroup && group.id !== BASE_USER_TEMPLATE_GROUP_ID ? (
        <div className="template-group-actions">
          <button
            type="button"
            onClick={() => onRenameGroup(group)}
            aria-label={`重命名分组 ${group.label}`}
            title="重命名分组"
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => onRequestDeleteGroup(group.id)}
            aria-label={`删除分组 ${group.label}`}
            title="删除分组"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TemplateCard({
  letterTemplate,
  manageOnly,
  selectionOnly,
  selectedLetterTemplate,
  newDocumentTemplate,
  onOpenDetail,
  onDeleteTemplate,
}) {
  const paper = TEMPLATES.find((template) => template.id === letterTemplate.paperId) || TEMPLATES[0];
  const isActive = !manageOnly && selectedLetterTemplate.id === letterTemplate.id;
  const isNewDocumentDefault = newDocumentTemplate.id === letterTemplate.id;
  return (
    <article
      className={`letter-template-card${isActive ? " active" : ""}${letterTemplate.userTemplate ? " user" : ""}${isNewDocumentDefault ? " new-default" : ""}`}
    >
      <button
        type="button"
        title={letterTemplate.description}
        className="letter-template-card-main"
        onClick={() => onOpenDetail(letterTemplate.id)}
        aria-label={`${letterTemplate.label}${isActive ? "，当前使用" : ""}${isNewDocumentDefault ? "，新建默认模板" : ""}`}
      >
        <span
          className="template-thumb"
          style={{ "--swatch": paper.swatch, "--template-bg": `url("${paper.background}")` }}
        >
          {isActive ? <Check size={12} strokeWidth={3} /> : null}
        </span>
        <span className="letter-template-copy">
          <strong>{letterTemplate.label}</strong>
          <small>{letterTemplate.description}</small>
        </span>
      </button>
      {isNewDocumentDefault ? (
        <span className="letter-template-default-badge" title="新建信笺默认模板">默认</span>
      ) : null}
      {!selectionOnly && letterTemplate.userTemplate ? (
        <button
          type="button"
          className="letter-template-delete"
          onClick={() => onDeleteTemplate(letterTemplate.id)}
          aria-label={`删除用户模板 ${letterTemplate.label}`}
          title="删除模板"
        >
          <Trash2 size={14} />
        </button>
      ) : null}
    </article>
  );
}

export function TemplateGroupBrowser({
  selectionOnly,
  userTemplates,
  userTemplateGroups,
  selectedGroupId,
  selectedGroup,
  selectedUserGroup,
  selectedGroupTemplates,
  selectedLetterTemplate,
  newDocumentTemplate,
  manageOnly,
  groupDragState,
  groupItemRefs,
  suppressGroupClickRef,
  onGroupPointerDown,
  onSelectGroup,
  onRenameGroup,
  onRequestDeleteGroup,
  onReorderUserTemplateGroups,
  onCreateGroup,
  onCreateTemplate,
  onOpenDetail,
  onDeleteTemplate,
}) {
  const groupItemProps = {
    selectionOnly,
    userTemplates,
    userTemplateGroups,
    selectedGroupId,
    groupDragState,
    groupItemRefs,
    suppressGroupClickRef,
    onGroupPointerDown,
    onSelectGroup,
    onRenameGroup,
    onRequestDeleteGroup,
    onReorderUserTemplateGroups,
  };
  return (
    <div className="template-group-browser">
      <nav className="template-group-sidebar" aria-label="模板分组">
        <section className="template-group-section" aria-labelledby="system-template-groups-title">
          <div className="template-group-section-heading">
            <span id="system-template-groups-title">系统模板</span>
            <small className="template-group-readonly-badge">不可修改</small>
          </div>
          <div className="template-group-list">
            {SYSTEM_TEMPLATE_GROUPS.map((group) => (
              <TemplateGroupItem key={group.id} group={group} isUserGroup={false} {...groupItemProps} />
            ))}
          </div>
        </section>

        <section className="template-group-section" aria-labelledby="user-template-groups-title">
          <div className="template-group-section-heading">
            <span id="user-template-groups-title">用户模板</span>
            {!selectionOnly ? (
              <button
                type="button"
                onClick={onCreateGroup}
                aria-label="新建用户分组"
                title="新建分组"
              >
                <Plus size={16} />
              </button>
            ) : null}
          </div>
          <div className="template-group-list">
            {userTemplateGroups.map((group) => (
              <TemplateGroupItem key={group.id} group={group} isUserGroup {...groupItemProps} />
            ))}
          </div>
        </section>
      </nav>

      <section className="template-group-content" aria-labelledby="selected-template-group-title">
        <div className="template-group-content-heading">
          <div>
            <h3 id="selected-template-group-title">{selectedGroup.label}</h3>
            <p>{selectedGroupTemplates.length} 个模板</p>
          </div>
          {!selectionOnly && selectedUserGroup && selectedGroupTemplates.length ? (
            <button
              type="button"
              className="template-create-button"
              onClick={() => onCreateTemplate(selectedLetterTemplate, selectedUserGroup.id)}
            >
              <Plus size={15} />
              <span>在此新建模板</span>
            </button>
          ) : null}
        </div>

        {selectedGroupTemplates.length ? (
          <div className="letter-template-list">
            {selectedGroupTemplates.map((letterTemplate) => (
              <TemplateCard
                key={letterTemplate.id}
                letterTemplate={letterTemplate}
                manageOnly={manageOnly}
                selectionOnly={selectionOnly}
                selectedLetterTemplate={selectedLetterTemplate}
                newDocumentTemplate={newDocumentTemplate}
                onOpenDetail={onOpenDetail}
                onDeleteTemplate={onDeleteTemplate}
              />
            ))}
          </div>
        ) : (
          <div className="empty-template-list template-group-empty-state">
            <FolderOpen size={28} aria-hidden="true" />
            <strong>这个分组还没有模板</strong>
            <span>{selectionOnly ? "请选择其他分组。" : "可以从当前信笺模板创建一个可编辑副本。"}</span>
            {!selectionOnly ? (
              <button
                type="button"
                className="template-create-button"
                onClick={() => onCreateTemplate(selectedLetterTemplate, selectedGroup.id)}
              >
                <Plus size={15} />
                <span>在此新建模板</span>
              </button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
