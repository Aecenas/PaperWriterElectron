import { TEMPLATE_GROUP_NAME_MAX_LENGTH } from "./model.js";

export function TemplateDeleteDialog({
  pendingDeleteTemplate,
  backdropClassName,
  onCancel,
  onConfirm,
}) {
  if (!pendingDeleteTemplate) {
    return null;
  }
  return (
    <div className={backdropClassName} role="presentation">
      <section
        className="template-group-dialog delete-mode"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="template-delete-dialog-title"
        aria-describedby="template-delete-dialog-description"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="template-group-dialog-heading">
          <div>
            <h3 id="template-delete-dialog-title">删除模板</h3>
          </div>
        </div>
        <p id="template-delete-dialog-description" className="template-group-dialog-description">
          删除“{pendingDeleteTemplate.label}”？此操作无法撤销。
        </p>
        <div className="template-group-dialog-actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="danger" onClick={onConfirm}>确认删除</button>
        </div>
      </section>
    </div>
  );
}

export function TemplateGroupDialog({
  editingGroupId,
  pendingDeleteGroup,
  backdropClassName,
  pendingDeleteGroupTemplateCount,
  groupNameInputRef,
  groupNameDraft,
  groupNameError,
  onGroupNameChange,
  onGroupEditorKeyDown,
  onCancel,
  onConfirm,
}) {
  if (!editingGroupId && !pendingDeleteGroup) {
    return null;
  }
  return (
    <div className={backdropClassName} role="presentation">
      <section
        className={`template-group-dialog${pendingDeleteGroup ? " delete-mode" : ""}`}
        role={pendingDeleteGroup ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby="template-group-dialog-title"
        aria-describedby={pendingDeleteGroup ? "template-group-delete-description" : undefined}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="template-group-dialog-heading">
          <div>
            <h3 id="template-group-dialog-title">
              {pendingDeleteGroup ? "删除分组" : editingGroupId === "new" ? "新建分组" : "重命名分组"}
            </h3>
          </div>
        </div>
        {pendingDeleteGroup ? (
          <p id="template-group-delete-description" className="template-group-dialog-description">
            删除“{pendingDeleteGroup.label}”？其中的
            {pendingDeleteGroupTemplateCount}
            个模板仍会保留在“我的模板”。
          </p>
        ) : (
          <>
            <label htmlFor="template-group-name">分组名称</label>
            <div className="template-group-dialog-input">
              <input
                ref={groupNameInputRef}
                id="template-group-name"
                value={groupNameDraft}
                maxLength={TEMPLATE_GROUP_NAME_MAX_LENGTH}
                onChange={(event) => onGroupNameChange(event.target.value)}
                onKeyDown={onGroupEditorKeyDown}
                aria-invalid={Boolean(groupNameError)}
                aria-describedby={groupNameError ? "template-group-name-error" : "template-group-name-limit"}
              />
              <small id="template-group-name-limit">
                {Array.from(groupNameDraft).length}/{TEMPLATE_GROUP_NAME_MAX_LENGTH}
              </small>
            </div>
            {groupNameError ? <small id="template-group-name-error" role="alert">{groupNameError}</small> : null}
          </>
        )}
        <div className="template-group-dialog-actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button
            type="button"
            className={pendingDeleteGroup ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {pendingDeleteGroup ? "确认删除" : editingGroupId === "new" ? "新建分组" : "保存名称"}
          </button>
        </div>
      </section>
    </div>
  );
}
