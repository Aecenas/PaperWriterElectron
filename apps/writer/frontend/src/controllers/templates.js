import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { applyLetterTemplateToDocument } from "../letter-template-application.js";
import {
  BASE_USER_TEMPLATE_GROUP_ID,
  DEFAULT_LETTER_TEMPLATES,
  createTemplateGroupId,
  getLetterTemplate,
  normalizeNewDocumentTemplateHistory,
  normalizeTemplateGroupName,
  normalizeUserTemplate,
  normalizeUserTemplateGroups,
  templateNameKey,
} from "../templates/model.js";
import {
  loadNewDocumentTemplateHistory,
  loadNewDocumentTemplateId,
  loadUserLetterTemplates,
  loadUserTemplateGroups,
  saveNewDocumentTemplateHistory,
  saveNewDocumentTemplateId,
  saveUserLetterTemplates,
  saveUserTemplateGroups,
} from "../templates/storage.js";

export function useTemplateCatalogState() {
  const [userTemplateGroups, setUserTemplateGroups] = useState(() => loadUserTemplateGroups());
  const [userLetterTemplates, setUserLetterTemplates] = useState(() => loadUserLetterTemplates(userTemplateGroups));
  const letterTemplates = useMemo(() => [...DEFAULT_LETTER_TEMPLATES, ...userLetterTemplates], [userLetterTemplates]);
  const [newDocumentTemplateId, setNewDocumentTemplateId] = useState(() => loadNewDocumentTemplateId(letterTemplates));
  const [newDocumentTemplateHistory, setNewDocumentTemplateHistory] = useState(() => loadNewDocumentTemplateHistory(letterTemplates));
  return {
    userTemplateGroups,
    setUserTemplateGroups,
    userLetterTemplates,
    setUserLetterTemplates,
    letterTemplates,
    newDocumentTemplateId,
    setNewDocumentTemplateId,
    newDocumentTemplateHistory,
    setNewDocumentTemplateHistory,
  };
}

export function useTemplateTabDialogState() {
  return useState({ open: false, targetTabId: "" });
}

export function useTemplateTabDialogReturnFocusRef() {
  return useRef(null);
}

export function useTemplateTabDialogActions(
  setTabTemplateDialog,
  tabTemplateReturnFocusRef,
) {
  const handleOpenGroupTabTemplate = useCallback((view, returnFocusElement) => {
    if (view?.kind !== "document" || !view.tabId) return;
    tabTemplateReturnFocusRef.current = returnFocusElement?.focus ? returnFocusElement : null;
    setTabTemplateDialog({ open: true, targetTabId: view.tabId });
  }, []);

  const closeTabTemplateDialog = useCallback(() => {
    setTabTemplateDialog({ open: false, targetTabId: "" });
  }, []);

  return { handleOpenGroupTabTemplate, closeTabTemplateDialog };
}

export function usePersistUserTemplateGroups(userTemplateGroups) {
  useEffect(() => {
    saveUserTemplateGroups(userTemplateGroups);
  }, [userTemplateGroups]);
}

export function usePersistUserLetterTemplates(
  userLetterTemplates,
  userTemplateGroups,
) {
  useEffect(() => {
    saveUserLetterTemplates(userLetterTemplates, userTemplateGroups);
  }, [userLetterTemplates, userTemplateGroups]);
}

export function usePersistNewDocumentTemplateId(newDocumentTemplateId) {
  useEffect(() => {
    saveNewDocumentTemplateId(newDocumentTemplateId);
  }, [newDocumentTemplateId]);
}

export function usePersistNewDocumentTemplateHistory(newDocumentTemplateHistory) {
  useEffect(() => {
    saveNewDocumentTemplateHistory(newDocumentTemplateHistory);
  }, [newDocumentTemplateHistory]);
}

export function useNormalizeNewDocumentTemplateHistory(
  letterTemplates,
  setNewDocumentTemplateHistory,
) {
  useEffect(() => {
    setNewDocumentTemplateHistory((history) => normalizeNewDocumentTemplateHistory(history, letterTemplates));
  }, [letterTemplates]);
}

export function applyTemplateToTabTransaction({
  activeTabIdRef,
  documentStateRef,
  letterTemplateId,
  letterTemplates,
  openTabsRef,
  recordTabMutation,
  setDocumentState,
  setOpenTabs,
  showStatus,
  snapshotLiveTabs,
  tabId,
}) {
  const letterTemplate = letterTemplates.find((template) => template.id === letterTemplateId);
  if (!tabId || !letterTemplate) {
    showStatus("没有找到要使用的模板", "warning");
    return false;
  }

  const snapshot = snapshotLiveTabs({ includeEditorJson: true });
  const targetTab = snapshot.find((tab) => tab.id === tabId);
  const sourceDocument = tabId === activeTabIdRef.current
    ? documentStateRef.current
    : targetTab?.document;
  if (!targetTab || !sourceDocument) {
    showStatus("没有找到要修改的信笺", "warning");
    return false;
  }
  if (targetTab.readOnly || sourceDocument._readOnlyFutureSchema) {
    showStatus("未来格式信笺为只读，不能切换模板", "warning");
    return false;
  }
  if (getLetterTemplate(sourceDocument, letterTemplates).id === letterTemplate.id) {
    showStatus(`“${targetTab.title || "当前信笺"}”已在使用“${letterTemplate.label}”`, "success");
    return true;
  }

  const updatedAt = new Date().toISOString();
  const nextDocument = applyLetterTemplateToDocument(sourceDocument, letterTemplate, updatedAt);
  const nextTabs = snapshot.map((tab) => (
    tab.id === tabId
      ? { ...tab, document: nextDocument, dirty: true }
      : tab
  ));
  openTabsRef.current = nextTabs;
  setOpenTabs(nextTabs);
  if (tabId === activeTabIdRef.current) {
    documentStateRef.current = nextDocument;
    setDocumentState(nextDocument);
  }
  recordTabMutation(tabId, updatedAt);
  showStatus(`已为“${targetTab.title || "当前信笺"}”使用“${letterTemplate.label}”`, "success");
  return true;
}

export function deleteUserTemplateTransaction({
  activeTabIdRef,
  documentStateRef,
  letterTemplates,
  newDocumentTemplateHistory,
  newDocumentTemplateId,
  openTabsRef,
  recordTabMutation,
  setDocumentState,
  setNewDocumentTemplateHistory,
  setNewDocumentTemplateId,
  setOpenTabs,
  setUserLetterTemplates,
  showStatus,
  snapshotLiveTabs,
  templateId,
  userLetterTemplates,
}) {
  const template = userLetterTemplates.find((item) => item.id === templateId);
  if (!template) {
    return;
  }
  const documentFallback = DEFAULT_LETTER_TEMPLATES.find((item) => item.paperId === template.paperId)
    || DEFAULT_LETTER_TEMPLATES[0];
  const wasNewDocumentDefault = newDocumentTemplateId === templateId;
  let newDocumentFallback = documentFallback;
  const remainingTemplates = letterTemplates.filter((item) => item.id !== templateId);
  const nextHistory = normalizeNewDocumentTemplateHistory(
    newDocumentTemplateHistory,
    remainingTemplates,
  );
  if (wasNewDocumentDefault) {
    for (let index = nextHistory.length - 1; index >= 0; index -= 1) {
      const historicalTemplate = remainingTemplates.find((item) => item.id === nextHistory[index]);
      if (historicalTemplate) {
        newDocumentFallback = historicalTemplate;
        nextHistory.splice(index, 1);
        break;
      }
    }
    if (!remainingTemplates.some((item) => item.id === newDocumentFallback.id)) {
      newDocumentFallback = remainingTemplates.find((item) => !item.userTemplate)
        || remainingTemplates[0]
        || DEFAULT_LETTER_TEMPLATES[0];
    }
  }
  setUserLetterTemplates((templates) => templates.filter((item) => item.id !== templateId));
  setNewDocumentTemplateHistory(nextHistory);
  if (wasNewDocumentDefault) {
    setNewDocumentTemplateId(newDocumentFallback.id);
  }
  const snapshot = snapshotLiveTabs({ includeEditorJson: true });
  const affectedTabIds = snapshot
    .filter((tab) => {
      const sourceDocument = tab.id === activeTabIdRef.current ? documentStateRef.current : tab.document;
      return sourceDocument?.letterTemplateId === templateId;
    })
    .map((tab) => tab.id);
  if (affectedTabIds.length) {
    const affectedIds = new Set(affectedTabIds);
    const updatedAt = new Date().toISOString();
    const nextTabs = snapshot.map((tab) => {
      if (!affectedIds.has(tab.id)) return tab;
      const sourceDocument = tab.id === activeTabIdRef.current ? documentStateRef.current : tab.document;
      return {
        ...tab,
        document: applyLetterTemplateToDocument(sourceDocument, documentFallback, updatedAt),
        dirty: true,
      };
    });
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    if (affectedIds.has(activeTabIdRef.current)) {
      const activeDocument = nextTabs.find((tab) => tab.id === activeTabIdRef.current)?.document;
      if (activeDocument) {
        documentStateRef.current = activeDocument;
        setDocumentState(activeDocument);
      }
    }
    affectedTabIds.forEach((tabId) => recordTabMutation(tabId, updatedAt));
    const defaultFallbackMessage = wasNewDocumentDefault
      ? `；新建默认已恢复为“${newDocumentFallback.label}”`
      : "";
    const affectedMessage = affectedTabIds.length === 1 ? "1 个打开的信笺" : `${affectedTabIds.length} 个打开的信笺`;
    showStatus(`已删除“${template.label}”，${affectedMessage}已切换为“${documentFallback.label}”${defaultFallbackMessage}`, "success");
    return;
  }
  if (wasNewDocumentDefault) {
    showStatus(`已删除“${template.label}”，新建默认模板已恢复为“${newDocumentFallback.label}”`, "success");
    return;
  }
  showStatus(`已删除用户模板“${template.label}”`, "success");
}

export function useTemplateCatalogActions({
  activeTabIdRef,
  documentStateRef,
  letterTemplates,
  newDocumentTemplateHistory,
  newDocumentTemplateId,
  openTabsRef,
  recordTabMutation,
  setDocumentState,
  setNewDocumentTemplateHistory,
  setNewDocumentTemplateId,
  setOpenTabs,
  setUserLetterTemplates,
  setUserTemplateGroups,
  showStatus,
  snapshotLiveTabs,
  tabTemplateTargetTabId,
  userLetterTemplates,
  userTemplateGroups,
}) {
  const handleApplyTabTemplate = useCallback((tabId, letterTemplateId) => (
    applyTemplateToTabTransaction({
      activeTabIdRef,
      documentStateRef,
      letterTemplateId,
      letterTemplates,
      openTabsRef,
      recordTabMutation,
      setDocumentState,
      setOpenTabs,
      showStatus,
      snapshotLiveTabs,
      tabId,
    })
  ), [letterTemplates, recordTabMutation, showStatus, snapshotLiveTabs]);

  const handleCreateUserTemplate = useCallback((template) => {
    const nextTemplate = normalizeUserTemplate(template, userTemplateGroups);
    const duplicateTemplate = letterTemplates.some((item) => (
      item.id !== nextTemplate.id
      && templateNameKey(item.label) === templateNameKey(nextTemplate.label)
    ));
    if (duplicateTemplate) {
      showStatus("模板名称已存在，无法创建", "warning");
      return "";
    }
    setUserLetterTemplates((templates) => [...templates, nextTemplate]);
    showStatus(`已新建用户模板“${nextTemplate.label}”`, "success");
    return nextTemplate.id;
  }, [letterTemplates, showStatus, userTemplateGroups]);

  const handleUpdateUserTemplate = useCallback((templateId, patch) => {
    if (Object.prototype.hasOwnProperty.call(patch, "label")) {
      const duplicateTemplate = letterTemplates.some((template) => (
        template.id !== templateId
        && templateNameKey(template.label) === templateNameKey(patch.label)
      ));
      if (duplicateTemplate) {
        showStatus("模板名称已存在，无法保存", "warning");
        return false;
      }
    }
    setUserLetterTemplates((templates) => templates.map((template) => (
      template.id === templateId
        ? normalizeUserTemplate({ ...template, ...patch }, userTemplateGroups)
        : template
    )));
    return true;
  }, [letterTemplates, showStatus, userTemplateGroups]);

  const handleCreateUserTemplateGroup = useCallback((label) => {
    const nextGroup = {
      id: createTemplateGroupId(),
      label: normalizeTemplateGroupName(label),
      createdAt: Date.now(),
    };
    if (!nextGroup.label) {
      return "";
    }
    if (userTemplateGroups.some((group) => group.label.toLocaleLowerCase() === nextGroup.label.toLocaleLowerCase())) {
      showStatus("用户模板分组名称已存在", "warning");
      return "";
    }
    setUserTemplateGroups((groups) => normalizeUserTemplateGroups([...groups, nextGroup]));
    showStatus(`已新建模板分组“${nextGroup.label}”`, "success");
    return nextGroup.id;
  }, [showStatus, userTemplateGroups]);

  const handleRenameUserTemplateGroup = useCallback((groupId, label) => {
    if (groupId === BASE_USER_TEMPLATE_GROUP_ID) {
      return;
    }
    const normalizedLabel = normalizeTemplateGroupName(label);
    if (!normalizedLabel) {
      return;
    }
    if (userTemplateGroups.some((group) => (
      group.id !== groupId
      && group.label.toLocaleLowerCase() === normalizedLabel.toLocaleLowerCase()
    ))) {
      showStatus("用户模板分组名称已存在", "warning");
      return;
    }
    setUserTemplateGroups((groups) => normalizeUserTemplateGroups(groups.map((group) => (
      group.id === groupId ? { ...group, label: normalizedLabel } : group
    ))));
    showStatus(`模板分组已重命名为“${normalizedLabel}”`, "success");
  }, [showStatus, userTemplateGroups]);

  const handleReorderUserTemplateGroups = useCallback((sourceGroupId, targetIndex) => {
    if (
      sourceGroupId === BASE_USER_TEMPLATE_GROUP_ID
      || !Number.isInteger(targetIndex)
    ) {
      return;
    }
    setUserTemplateGroups((groups) => {
      const sourceIndex = groups.findIndex((group) => group.id === sourceGroupId);
      if (sourceIndex < 1 || targetIndex < 1 || targetIndex >= groups.length || sourceIndex === targetIndex) {
        return groups;
      }
      const nextGroups = [...groups];
      const [movedGroup] = nextGroups.splice(sourceIndex, 1);
      nextGroups.splice(targetIndex, 0, movedGroup);
      return normalizeUserTemplateGroups(nextGroups);
    });
  }, []);

  const handleDeleteUserTemplateGroup = useCallback((groupId) => {
    if (groupId === BASE_USER_TEMPLATE_GROUP_ID) {
      return;
    }
    const group = userTemplateGroups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }
    setUserLetterTemplates((templates) => templates.map((template) => (
      template.groupIds?.includes(groupId)
        ? { ...template, groupIds: template.groupIds.filter((id) => id !== groupId) }
        : template
    )));
    setUserTemplateGroups((groups) => groups.filter((item) => item.id !== groupId));
    const baseGroupLabel = userTemplateGroups.find((item) => item.id === BASE_USER_TEMPLATE_GROUP_ID)?.label || "我的模板";
    showStatus(`已删除分组“${group.label}”，其中模板仍保留在“${baseGroupLabel}”`, "success");
  }, [showStatus, userTemplateGroups]);

  const handleMoveUserTemplate = useCallback((templateId, groupId, checked) => {
    const template = userLetterTemplates.find((item) => item.id === templateId);
    const group = userTemplateGroups.find((item) => item.id === groupId);
    if (!template || !group || group.id === BASE_USER_TEMPLATE_GROUP_ID) {
      return;
    }
    const currentGroupIds = Array.isArray(template.groupIds)
      ? template.groupIds
      : [BASE_USER_TEMPLATE_GROUP_ID];
    const alreadyIncluded = currentGroupIds.includes(group.id);
    if (alreadyIncluded === checked) {
      return;
    }
    const nextGroupIds = checked
      ? [...currentGroupIds, group.id]
      : currentGroupIds.filter((id) => id !== group.id);
    setUserLetterTemplates((templates) => templates.map((item) => (
      item.id === templateId ? { ...item, groupIds: nextGroupIds } : item
    )));
    showStatus(
      checked
        ? `已将“${template.label}”加入“${group.label}”`
        : `已将“${template.label}”从“${group.label}”移除`,
      "success",
    );
  }, [showStatus, userLetterTemplates, userTemplateGroups]);

  const handleDeleteUserTemplate = useCallback((templateId) => {
    deleteUserTemplateTransaction({
      activeTabIdRef,
      documentStateRef,
      letterTemplates,
      newDocumentTemplateHistory,
      newDocumentTemplateId,
      openTabsRef,
      recordTabMutation,
      setDocumentState,
      setNewDocumentTemplateHistory,
      setNewDocumentTemplateId,
      setOpenTabs,
      setUserLetterTemplates,
      showStatus,
      snapshotLiveTabs,
      templateId,
      userLetterTemplates,
    });
  }, [letterTemplates, newDocumentTemplateHistory, newDocumentTemplateId, recordTabMutation, showStatus, snapshotLiveTabs, userLetterTemplates]);

  const handleNewDocumentTemplateChange = useCallback((templateId) => {
    const template = letterTemplates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    if (template.id === newDocumentTemplateId) {
      const nextHistory = normalizeNewDocumentTemplateHistory(newDocumentTemplateHistory, letterTemplates);
      let fallbackTemplate = null;
      while (nextHistory.length && !fallbackTemplate) {
        const previousTemplateId = nextHistory.pop();
        if (previousTemplateId !== template.id) {
          fallbackTemplate = letterTemplates.find((item) => item.id === previousTemplateId) || null;
        }
      }

      if (!fallbackTemplate) {
        const systemInitialTemplate = DEFAULT_LETTER_TEMPLATES[0];
        if (systemInitialTemplate?.id !== template.id) {
          fallbackTemplate = systemInitialTemplate;
        } else {
          const randomCandidates = DEFAULT_LETTER_TEMPLATES.filter((item) => item.id !== template.id);
          fallbackTemplate = randomCandidates[Math.floor(Math.random() * randomCandidates.length)] || systemInitialTemplate;
        }
      }

      if (!fallbackTemplate) {
        return;
      }
      setNewDocumentTemplateHistory(nextHistory);
      setNewDocumentTemplateId(fallbackTemplate.id);
      showStatus(`已取消“${template.label}”的新建默认，已恢复为“${fallbackTemplate.label}”`, "success");
      return;
    }

    setNewDocumentTemplateHistory((history) => normalizeNewDocumentTemplateHistory(
      [...history, newDocumentTemplateId],
      letterTemplates,
    ));
    setNewDocumentTemplateId(template.id);
    showStatus(`已将“${template.label}”设为新建信笺的默认模板`, "success");
  }, [letterTemplates, newDocumentTemplateHistory, newDocumentTemplateId, showStatus]);

  const handleTabTemplateChange = useCallback(
    (letterTemplateId) => {
      handleApplyTabTemplate(tabTemplateTargetTabId, letterTemplateId);
    },
    [handleApplyTabTemplate, tabTemplateTargetTabId],
  );

  return {
    handleApplyTabTemplate,
    handleCreateUserTemplate,
    handleUpdateUserTemplate,
    handleCreateUserTemplateGroup,
    handleRenameUserTemplateGroup,
    handleReorderUserTemplateGroups,
    handleDeleteUserTemplateGroup,
    handleMoveUserTemplate,
    handleDeleteUserTemplate,
    handleNewDocumentTemplateChange,
    handleTabTemplateChange,
  };
}
