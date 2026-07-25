import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  X,
} from "lucide-react";
import {
  BASE_USER_TEMPLATE_GROUP_ID,
  SYSTEM_TEMPLATE_GROUPS,
  TEMPLATES,
  createUniqueTemplateName,
  createUserTemplate,
  getLetterTemplate,
  getLetterTemplateGroupId,
  normalizeTemplateGroupName,
  normalizeTemplateName,
  normalizeTemplatePresentation,
  normalizeUserTemplate,
  templateNameKey,
} from "./model.js";
import {
  TemplateDeleteDialog,
  TemplateGroupDialog,
} from "./TemplateConfirmationDialogs.jsx";
import { TemplateDetailView } from "./TemplateDetailView.jsx";
import { TemplateGroupBrowser } from "./TemplateGroupBrowser.jsx";

const TEMPLATE_GROUP_DIALOG_BACKDROP_CLASS = "template-group-dialog-backdrop dialog-scrim";

export function LetterTemplateDialog({
  document,
  letterTemplates,
  defaultTemplates,
  userTemplates,
  userTemplateGroups,
  newDocumentTemplateId,
  embedded = false,
  mode = "apply",
  returnFocusRef,
  onClose,
  onLetterTemplateChange,
  onNewDocumentTemplateChange,
  onCreateUserTemplate,
  onUpdateUserTemplate,
  onDeleteUserTemplate,
  onCreateUserTemplateGroup,
  onRenameUserTemplateGroup,
  onDeleteUserTemplateGroup,
  onReorderUserTemplateGroups,
  onMoveUserTemplate,
}) {
  const manageOnly = mode === "manage";
  const selectionOnly = mode === "select";
  const selectedLetterTemplate = getLetterTemplate(document, letterTemplates);
  const [detailTemplateId, setDetailTemplateId] = useState(() => (selectionOnly || manageOnly ? "" : selectedLetterTemplate.id));
  const [pendingDeleteTemplateId, setPendingDeleteTemplateId] = useState("");
  const [pendingDeleteGroupId, setPendingDeleteGroupId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState(() => (
    manageOnly ? SYSTEM_TEMPLATE_GROUPS[0].id : getLetterTemplateGroupId(selectedLetterTemplate)
  ));
  const [editingGroupId, setEditingGroupId] = useState("");
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [groupNameError, setGroupNameError] = useState("");
  const [templateNameError, setTemplateNameError] = useState("");
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState(null);
  const [groupDragState, setGroupDragState] = useState(null);
  const groupNameInputRef = useRef(null);
  const groupPointerSessionRef = useRef(null);
  const userTemplateGroupsRef = useRef(userTemplateGroups);
  const reorderUserTemplateGroupsRef = useRef(onReorderUserTemplateGroups);
  const groupItemRefs = useRef(new Map());
  const pendingGroupRectsRef = useRef(null);
  const suppressGroupClickRef = useRef(false);
  const groupPickerRef = useRef(null);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const detailTemplate = draftTemplate || letterTemplates.find((template) => template.id === detailTemplateId);
  const detailIsDraft = Boolean(draftTemplate);
  const detailEditable = Boolean(detailTemplate?.userTemplate && !selectionOnly);
  const detailIsActive = !manageOnly && !detailIsDraft && detailTemplate?.id === selectedLetterTemplate.id;
  const newDocumentTemplate = letterTemplates.find((template) => template.id === newDocumentTemplateId)
    || defaultTemplates[0];
  const detailIsNewDocumentDefault = !detailIsDraft && detailTemplate?.id === newDocumentTemplate.id;
  const paperPickerGroups = useMemo(() => {
    return SYSTEM_TEMPLATE_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      options: group.templateIds.map((templateId) => {
        const letterTemplate = defaultTemplates.find((template) => template.id === templateId);
        const paper = TEMPLATES.find((candidate) => candidate.id === letterTemplate?.paperId);
        return paper ? {
          value: paper.id,
          label: paper.label,
          background: paper.background,
          swatch: paper.swatch,
        } : null;
      }).filter(Boolean),
    }));
  }, [defaultTemplates]);
  const pendingDeleteTemplate = userTemplates.find((template) => template.id === pendingDeleteTemplateId);
  const pendingDeleteGroup = userTemplateGroups.find((group) => group.id === pendingDeleteGroupId);
  const selectedSystemGroup = SYSTEM_TEMPLATE_GROUPS.find((group) => group.id === selectedGroupId);
  const selectedUserGroup = userTemplateGroups.find((group) => group.id === selectedGroupId);
  const selectedGroup = selectedSystemGroup || selectedUserGroup || SYSTEM_TEMPLATE_GROUPS[0];
  const selectedGroupTemplates = selectedSystemGroup
    ? defaultTemplates.filter((template) => selectedSystemGroup.templateIds.includes(template.id))
    : userTemplates.filter((template) => template.groupIds?.includes(selectedGroup.id));
  const detailTemplateGroupIds = detailTemplate?.userTemplate
    ? (detailTemplate.groupIds || [BASE_USER_TEMPLATE_GROUP_ID])
    : [];
  const detailPresentation = normalizeTemplatePresentation(detailTemplate?.presentation);

  userTemplateGroupsRef.current = userTemplateGroups;
  reorderUserTemplateGroupsRef.current = onReorderUserTemplateGroups;

  useEffect(() => {
    if (embedded) return undefined;
    const previouslyFocused = window.document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const focusTarget = returnFocusRef?.current || previouslyFocused;
      if (focusTarget instanceof HTMLElement && focusTarget.isConnected) {
        focusTarget.focus({ preventScroll: true });
      }
    };
  }, [embedded, returnFocusRef]);

  useEffect(() => {
    const availableGroupIds = new Set([
      ...SYSTEM_TEMPLATE_GROUPS.map((group) => group.id),
      ...userTemplateGroups.map((group) => group.id),
    ]);
    if (!availableGroupIds.has(selectedGroupId)) {
      setSelectedGroupId(BASE_USER_TEMPLATE_GROUP_ID);
    }
  }, [selectedGroupId, userTemplateGroups]);

  useEffect(() => {
    if (editingGroupId) {
      groupNameInputRef.current?.focus();
      groupNameInputRef.current?.select();
    }
  }, [editingGroupId]);

  useEffect(() => {
    setGroupPickerOpen(false);
    setAdvancedOpen(false);
    setTemplateNameError("");
  }, [detailTemplateId, draftTemplate?.id]);

  useEffect(() => {
    if (!groupPickerOpen) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (!groupPickerRef.current?.contains(event.target)) {
        setGroupPickerOpen(false);
      }
    };
    window.document.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [groupPickerOpen]);

  useLayoutEffect(() => {
    const previousRects = pendingGroupRectsRef.current;
    if (!previousRects) {
      return;
    }
    pendingGroupRectsRef.current = null;
    groupItemRefs.current.forEach((element, groupId) => {
      if (!element || groupId === groupPointerSessionRef.current?.groupId) {
        return;
      }
      const previousRect = previousRects.get(groupId);
      if (!previousRect) {
        return;
      }
      const nextRect = element.getBoundingClientRect();
      const deltaY = previousRect.top - nextRect.top;
      if (Math.abs(deltaY) < 1) {
        return;
      }
      element.animate?.(
        [{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }],
        { duration: 190, easing: "cubic-bezier(0.2, 0.78, 0.24, 1)" },
      );
    });
  }, [userTemplateGroups]);

  const beginCreateTemplate = (baseTemplate, requestedGroupId) => {
    const availableGroupIds = new Set(userTemplateGroups.map((group) => group.id));
    const inheritedGroupIds = baseTemplate?.userTemplate && Array.isArray(baseTemplate.groupIds)
      ? baseTemplate.groupIds
      : [BASE_USER_TEMPLATE_GROUP_ID];
    const groupIds = [BASE_USER_TEMPLATE_GROUP_ID];
    [...inheritedGroupIds, requestedGroupId].forEach((groupId) => {
      if (availableGroupIds.has(groupId) && groupId !== BASE_USER_TEMPLATE_GROUP_ID && !groupIds.includes(groupId)) {
        groupIds.push(groupId);
      }
    });
    const nextTemplate = {
      ...createUserTemplate(baseTemplate, groupIds),
      label: createUniqueTemplateName(`${baseTemplate?.label || "信笺模板"} 副本`, letterTemplates),
    };
    setDraftTemplate(nextTemplate);
    setTemplateNameError("");
    setDetailTemplateId("");
    setSelectedGroupId(
      availableGroupIds.has(requestedGroupId)
        ? requestedGroupId
        : groupIds.find((groupId) => groupId !== BASE_USER_TEMPLATE_GROUP_ID) || BASE_USER_TEMPLATE_GROUP_ID,
    );
    setPendingDeleteTemplateId("");
    setPendingDeleteGroupId("");
    setGroupPickerOpen(false);
  };

  const cancelTemplateCreation = () => {
    setDraftTemplate(null);
    setDetailTemplateId("");
    setGroupPickerOpen(false);
  };

  const confirmTemplateCreation = () => {
    if (!draftTemplate) {
      return;
    }
    const duplicateTemplate = letterTemplates.some((template) => (
      template.id !== draftTemplate.id
      && templateNameKey(template.label) === templateNameKey(draftTemplate.label)
    ));
    if (duplicateTemplate) {
      setTemplateNameError("模板名称已存在，请使用其他名称");
      return;
    }
    const createdTemplateId = onCreateUserTemplate(draftTemplate);
    if (createdTemplateId) {
      setDraftTemplate(null);
      setDetailTemplateId(createdTemplateId);
    }
  };

  const confirmDeleteTemplate = () => {
    if (!pendingDeleteTemplate) {
      return;
    }
    onDeleteUserTemplate(pendingDeleteTemplate.id);
    if (detailTemplateId === pendingDeleteTemplate.id) {
      setDetailTemplateId("");
    }
    setPendingDeleteTemplateId("");
  };

  const beginDeleteTemplate = (templateId) => {
    setPendingDeleteTemplateId(templateId);
    setPendingDeleteGroupId("");
    setEditingGroupId("");
  };

  const cancelGroupEditing = () => {
    setEditingGroupId("");
    setGroupNameDraft("");
    setGroupNameError("");
  };

  const closeGroupDialog = () => {
    cancelGroupEditing();
    setPendingDeleteGroupId("");
  };

  const beginCreateGroup = () => {
    setPendingDeleteGroupId("");
    setEditingGroupId("new");
    setGroupNameDraft("");
    setGroupNameError("");
  };

  const beginRenameGroup = (group) => {
    setPendingDeleteGroupId("");
    setEditingGroupId(group.id);
    setGroupNameDraft(group.label);
    setGroupNameError("");
  };

  const submitGroupEditing = () => {
    const normalizedName = normalizeTemplateGroupName(groupNameDraft);
    if (!normalizedName) {
      setGroupNameError("请输入分组名称");
      return;
    }
    const duplicateGroup = userTemplateGroups.find((group) => (
      group.id !== editingGroupId
      && group.label.toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
    ));
    if (duplicateGroup) {
      setGroupNameError("已有同名分组");
      return;
    }
    if (editingGroupId === "new") {
      const createdGroupId = onCreateUserTemplateGroup(normalizedName);
      if (createdGroupId) {
        setSelectedGroupId(createdGroupId);
      }
    } else {
      onRenameUserTemplateGroup(editingGroupId, normalizedName);
    }
    cancelGroupEditing();
  };

  const handleGroupEditorKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitGroupEditing();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelGroupEditing();
    }
  };

  const confirmDeleteGroup = () => {
    if (!pendingDeleteGroup || pendingDeleteGroup.id === BASE_USER_TEMPLATE_GROUP_ID) {
      return;
    }
    onDeleteUserTemplateGroup(pendingDeleteGroup.id);
    if (selectedGroupId === pendingDeleteGroup.id) {
      setSelectedGroupId(BASE_USER_TEMPLATE_GROUP_ID);
    }
    setPendingDeleteGroupId("");
  };

  const removeGroupPointerListeners = (session) => {
    if (!session) {
      return;
    }
    window.removeEventListener("pointermove", session.handleMove, true);
    window.removeEventListener("pointerup", session.handleUp, true);
    window.removeEventListener("pointercancel", session.handleCancel, true);
    window.removeEventListener("blur", session.handleBlur, true);
  };

  const teardownGroupPointerSession = (session, { suppressClick = false, updateState = true } = {}) => {
    if (!session) {
      return;
    }
    removeGroupPointerListeners(session);
    if (session.element.hasPointerCapture?.(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId);
    }
    if (suppressClick) {
      suppressGroupClickRef.current = true;
      window.setTimeout(() => {
        suppressGroupClickRef.current = false;
      }, 0);
    }
    if (groupPointerSessionRef.current === session) {
      groupPointerSessionRef.current = null;
    }
    if (updateState) {
      setGroupDragState(null);
    }
  };

  const handleGroupPointerDown = (event, group) => {
    if (
      group.id === BASE_USER_TEMPLATE_GROUP_ID
      || event.button !== 0
      || event.target.closest?.(".template-group-actions")
    ) {
      return;
    }
    suppressGroupClickRef.current = false;
    teardownGroupPointerSession(groupPointerSessionRef.current);
    const rect = event.currentTarget.getBoundingClientRect();
    const session = {
      active: false,
      element: event.currentTarget,
      groupId: group.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabOffsetY: event.clientY - rect.top,
      rect,
    };
    session.handleMove = (moveEvent) => handleGroupPointerMove(moveEvent);
    session.handleUp = (upEvent) => finishGroupPointerInteraction(upEvent);
    session.handleCancel = (cancelEvent) => finishGroupPointerInteraction(cancelEvent, true);
    session.handleBlur = () => teardownGroupPointerSession(session, { suppressClick: session.active });
    groupPointerSessionRef.current = session;
    window.addEventListener("pointermove", session.handleMove, true);
    window.addEventListener("pointerup", session.handleUp, true);
    window.addEventListener("pointercancel", session.handleCancel, true);
    window.addEventListener("blur", session.handleBlur, true);
    session.element.setPointerCapture?.(session.pointerId);
  };

  const handleGroupPointerMove = (event) => {
    const session = groupPointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    if (event.pointerType === "mouse" && event.buttons === 0) {
      finishGroupPointerInteraction(event, true);
      return;
    }
    const offsetX = event.clientX - session.startX;
    const offsetY = event.clientY - session.startY;
    if (!session.active) {
      if (Math.hypot(offsetX, offsetY) < 3) {
        return;
      }
      session.active = true;
      suppressGroupClickRef.current = true;
    }
    event.preventDefault();
    const reorderableElements = Array.from(
      window.document.querySelectorAll("[data-user-group-reorderable='true']"),
    ).filter((element) => element.dataset.userGroupId !== session.groupId);
    const nextIndex = 1 + reorderableElements.reduce((count, element) => {
      const rect = element.getBoundingClientRect();
      return count + (event.clientY > rect.top + rect.height / 2 ? 1 : 0);
    }, 0);
    const currentGroups = userTemplateGroupsRef.current;
    const currentIndex = currentGroups.findIndex((item) => item.id === session.groupId);
    if (nextIndex !== currentIndex && nextIndex >= 1 && nextIndex < currentGroups.length) {
      pendingGroupRectsRef.current = new Map(
        Array.from(groupItemRefs.current.entries()).map(([groupId, element]) => [groupId, element.getBoundingClientRect()]),
      );
      reorderUserTemplateGroupsRef.current(session.groupId, nextIndex);
    }
    setGroupDragState({
      id: session.groupId,
      label: currentGroups.find((item) => item.id === session.groupId)?.label || "用户模板分组",
      left: session.rect.left,
      top: event.clientY - session.grabOffsetY,
      width: session.rect.width,
      height: session.rect.height,
    });
  };

  const finishGroupPointerInteraction = (event, canceled = false) => {
    const session = groupPointerSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) {
      return;
    }
    if (session.active) {
      event.preventDefault?.();
      event.stopPropagation?.();
    }
    teardownGroupPointerSession(session, { suppressClick: session.active });
  };

  useEffect(() => () => {
    teardownGroupPointerSession(groupPointerSessionRef.current, { updateState: false });
  }, []);

  const updateDetailTemplate = (patch) => {
    if (!detailTemplate?.userTemplate || selectionOnly) {
      return false;
    }
    let normalizedPatch = patch;
    if (Object.prototype.hasOwnProperty.call(patch, "label")) {
      const normalizedLabel = normalizeTemplateName(patch.label);
      const duplicateTemplate = letterTemplates.some((template) => (
        template.id !== detailTemplate.id
        && templateNameKey(template.label) === templateNameKey(normalizedLabel)
      ));
      if (duplicateTemplate) {
        setTemplateNameError("模板名称已存在，请使用其他名称");
        return false;
      }
      setTemplateNameError("");
      normalizedPatch = { ...patch, label: normalizedLabel };
    }
    if (detailIsDraft) {
      setDraftTemplate((template) => normalizeUserTemplate({ ...template, ...normalizedPatch }, userTemplateGroups));
      return true;
    }
    onUpdateUserTemplate(detailTemplate.id, normalizedPatch);
    return true;
  };

  const updateTypography = (patch) => {
    if (!detailTemplate?.userTemplate || selectionOnly) {
      return;
    }
    updateDetailTemplate({ typography: { ...detailTemplate.typography, ...patch } });
  };

  const updatePresentation = (patch) => {
    if (!detailTemplate?.userTemplate || selectionOnly) {
      return;
    }
    updateDetailTemplate({
      presentation: normalizeTemplatePresentation({ ...detailTemplate.presentation, ...patch }),
    });
  };

  const changeDetailTemplateGroup = (groupId, shouldInclude) => {
    if (!detailTemplate?.userTemplate || selectionOnly || groupId === BASE_USER_TEMPLATE_GROUP_ID) {
      return;
    }
    if (detailIsDraft) {
      const nextGroupIds = shouldInclude
        ? [...new Set([...detailTemplateGroupIds, groupId])]
        : detailTemplateGroupIds.filter((candidateId) => candidateId !== groupId);
      updateDetailTemplate({ groupIds: nextGroupIds });
    } else {
      onMoveUserTemplate(detailTemplate.id, groupId, shouldInclude);
    }
    if (shouldInclude) {
      setSelectedGroupId(groupId);
    }
  };

  const detailPaper = detailTemplate ? TEMPLATES.find((template) => template.id === detailTemplate.paperId) || TEMPLATES[0] : null;

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!embedded && event.key === "Tab") {
        const elements = dialogFocusableElements(dialogRef.current);
        if (!elements.length) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && window.document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && window.document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (!dialogRef.current?.contains(window.document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "Escape" && !window.document.querySelector(".template-select.open")) {
        let handled = true;
        if (editingGroupId) {
          cancelGroupEditing();
        } else if (groupPickerOpen) {
          setGroupPickerOpen(false);
        } else if (pendingDeleteGroupId) {
          setPendingDeleteGroupId("");
        } else if (pendingDeleteTemplateId) {
          setPendingDeleteTemplateId("");
        } else if (detailTemplateId) {
          setDetailTemplateId("");
        } else if (!embedded) {
          onClose?.();
        } else {
          handled = false;
        }
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [detailTemplateId, editingGroupId, embedded, groupPickerOpen, onClose, pendingDeleteGroupId, pendingDeleteTemplateId]);

  const content = (
    <div
      className={embedded ? "template-dialog-embed" : "template-dialog-overlay dialog-scrim dialog-scrim--large"}
      role="presentation"
      onPointerDown={embedded ? undefined : (event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        ref={dialogRef}
        className={embedded ? "template-dialog settings-embedded" : "template-dialog"}
        role={embedded ? "region" : "dialog"}
        aria-modal={embedded ? undefined : "true"}
        aria-label={selectionOnly ? "选择模板" : manageOnly ? "模板设置" : "信笺模板"}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {!embedded ? (
          <button
            ref={closeButtonRef}
            type="button"
            className="template-dialog-global-close"
            onClick={onClose}
            aria-label={selectionOnly ? "关闭模板选择" : manageOnly ? "关闭模板配置" : "关闭信笺模板"}
            title="关闭"
          >
            <X size={20} strokeWidth={2.2} />
          </button>
        ) : null}
        <div className={`template-dialog-heading${detailTemplate ? " detail-heading" : ""}`}>
          {detailTemplate && !detailIsDraft ? (
            <button
              type="button"
              className="template-heading-back"
              onClick={() => setDetailTemplateId("")}
              aria-label={`返回${detailTemplate.userTemplate ? "用户模板" : "系统模板"}`}
              title={`返回${detailTemplate.userTemplate ? "用户模板" : "系统模板"}`}
            >
              <ArrowLeft size={16} />
              <span>{detailTemplate.userTemplate ? "用户模板" : "系统模板"}</span>
            </button>
          ) : detailIsDraft ? (
            <h2>新建模板</h2>
          ) : (
            <>
              <h2>{selectionOnly ? "选择模板" : manageOnly ? "模板设置" : "信笺模板"}</h2>
            </>
          )}
        </div>
        <section className={`sidebar-panel templates-panel${detailTemplate ? " detail-mode" : " group-mode"}`}>
        {detailTemplate ? (
          <TemplateDetailView
            detailTemplate={detailTemplate}
            detailPaper={detailPaper}
            detailEditable={detailEditable}
            detailIsActive={detailIsActive}
            detailIsDraft={detailIsDraft}
            detailIsNewDocumentDefault={detailIsNewDocumentDefault}
            detailTemplateGroupIds={detailTemplateGroupIds}
            detailPresentation={detailPresentation}
            selectionOnly={selectionOnly}
            manageOnly={manageOnly}
            newDocumentTemplate={newDocumentTemplate}
            userTemplateGroups={userTemplateGroups}
            paperPickerGroups={paperPickerGroups}
            templateNameError={templateNameError}
            groupPickerRef={groupPickerRef}
            groupPickerOpen={groupPickerOpen}
            advancedOpen={advancedOpen}
            onSetGroupPickerOpen={setGroupPickerOpen}
            onSetAdvancedOpen={setAdvancedOpen}
            onUpdateDetailTemplate={updateDetailTemplate}
            onUpdateTypography={updateTypography}
            onUpdatePresentation={updatePresentation}
            onChangeDetailTemplateGroup={changeDetailTemplateGroup}
            onNewDocumentTemplateChange={onNewDocumentTemplateChange}
            onConfirmTemplateCreation={confirmTemplateCreation}
            onCancelTemplateCreation={cancelTemplateCreation}
            onLetterTemplateChange={onLetterTemplateChange}
            onClose={onClose}
            onCreateTemplate={beginCreateTemplate}
            onDeleteTemplate={beginDeleteTemplate}
          />
        ) : (
          <TemplateGroupBrowser
            selectionOnly={selectionOnly}
            userTemplates={userTemplates}
            userTemplateGroups={userTemplateGroups}
            selectedGroupId={selectedGroupId}
            selectedGroup={selectedGroup}
            selectedUserGroup={selectedUserGroup}
            selectedGroupTemplates={selectedGroupTemplates}
            selectedLetterTemplate={selectedLetterTemplate}
            newDocumentTemplate={newDocumentTemplate}
            manageOnly={manageOnly}
            groupDragState={groupDragState}
            groupItemRefs={groupItemRefs}
            suppressGroupClickRef={suppressGroupClickRef}
            onGroupPointerDown={handleGroupPointerDown}
            onSelectGroup={(groupId) => {
              setSelectedGroupId(groupId);
              setPendingDeleteGroupId("");
              setPendingDeleteTemplateId("");
            }}
            onRenameGroup={beginRenameGroup}
            onRequestDeleteGroup={(groupId) => {
              setPendingDeleteGroupId(groupId);
              setEditingGroupId("");
              setGroupNameError("");
            }}
            onReorderUserTemplateGroups={onReorderUserTemplateGroups}
            onCreateGroup={beginCreateGroup}
            onCreateTemplate={beginCreateTemplate}
            onOpenDetail={setDetailTemplateId}
            onDeleteTemplate={beginDeleteTemplate}
          />
        )}
        </section>
        {!selectionOnly ? (
          <TemplateDeleteDialog
            pendingDeleteTemplate={pendingDeleteTemplate}
            backdropClassName={TEMPLATE_GROUP_DIALOG_BACKDROP_CLASS}
            onCancel={() => setPendingDeleteTemplateId("")}
            onConfirm={confirmDeleteTemplate}
          />
        ) : null}
        {!selectionOnly ? (
          <TemplateGroupDialog
            editingGroupId={editingGroupId}
            pendingDeleteGroup={pendingDeleteGroup}
            backdropClassName={TEMPLATE_GROUP_DIALOG_BACKDROP_CLASS}
            pendingDeleteGroupTemplateCount={pendingDeleteGroup
              ? userTemplates.filter((template) => template.groupIds?.includes(pendingDeleteGroup.id)).length
              : 0}
            groupNameInputRef={groupNameInputRef}
            groupNameDraft={groupNameDraft}
            groupNameError={groupNameError}
            onGroupNameChange={(value) => {
              setGroupNameDraft(value);
              setGroupNameError("");
            }}
            onGroupEditorKeyDown={handleGroupEditorKeyDown}
            onCancel={closeGroupDialog}
            onConfirm={pendingDeleteGroup ? confirmDeleteGroup : submitGroupEditing}
          />
        ) : null}
      </section>
      {!selectionOnly && groupDragState ? (
        <div
          className="template-group-drag-ghost"
          style={{
            left: `${groupDragState.left}px`,
            top: `${groupDragState.top}px`,
            width: `${groupDragState.width}px`,
            height: `${groupDragState.height}px`,
          }}
          aria-hidden="true"
        >
          <span>{groupDragState.label}</span>
          <small>拖动排序</small>
        </div>
      ) : null}
    </div>
  );

  return embedded ? content : createPortal(content, window.document.body);
}
