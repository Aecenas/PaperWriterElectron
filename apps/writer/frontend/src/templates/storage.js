import { safeStorageGetItem, safeStorageSetItem } from "../safe-storage.js";

import {
  DEFAULT_LETTER_TEMPLATES,
  createUniqueTemplateName,
  normalizeNewDocumentTemplateHistory,
  normalizeNewDocumentTemplateId,
  normalizeUserTemplate,
  normalizeUserTemplateGroups,
} from "./model.js";

export const USER_TEMPLATE_STORAGE_KEY = "paperwriter.userLetterTemplates";
export const USER_TEMPLATE_GROUP_STORAGE_KEY = "paperwriter.userLetterTemplateGroups";
export const NEW_DOCUMENT_TEMPLATE_STORAGE_KEY = "paperwriter.newDocumentTemplateId";
export const NEW_DOCUMENT_TEMPLATE_HISTORY_STORAGE_KEY = "paperwriter.newDocumentTemplateHistory";

export function loadUserTemplateGroups() {
  if (typeof window === "undefined") {
    return normalizeUserTemplateGroups([]);
  }
  try {
    const raw = safeStorageGetItem(USER_TEMPLATE_GROUP_STORAGE_KEY);
    return normalizeUserTemplateGroups(raw ? JSON.parse(raw) : []);
  } catch {
    return normalizeUserTemplateGroups([]);
  }
}

export function saveUserTemplateGroups(groups) {
  if (typeof window === "undefined") {
    return;
  }
  safeStorageSetItem(
    USER_TEMPLATE_GROUP_STORAGE_KEY,
    JSON.stringify(normalizeUserTemplateGroups(groups)),
  );
}


export function loadUserLetterTemplates(userTemplateGroups) {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = safeStorageGetItem(USER_TEMPLATE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    const acceptedTemplates = [...DEFAULT_LETTER_TEMPLATES];
    return parsed.map((template) => {
      const normalized = normalizeUserTemplate(template, userTemplateGroups);
      const uniqueTemplate = {
        ...normalized,
        label: createUniqueTemplateName(normalized.label, acceptedTemplates),
      };
      acceptedTemplates.push(uniqueTemplate);
      return uniqueTemplate;
    });
  } catch {
    return [];
  }
}

export function saveUserLetterTemplates(templates, userTemplateGroups) {
  if (typeof window === "undefined") {
    return;
  }
  safeStorageSetItem(
    USER_TEMPLATE_STORAGE_KEY,
    JSON.stringify(templates.map((template) => normalizeUserTemplate(template, userTemplateGroups))),
  );
}


export function loadNewDocumentTemplateId(letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  if (typeof window === "undefined") {
    return DEFAULT_LETTER_TEMPLATES[0].id;
  }
  return normalizeNewDocumentTemplateId(
    safeStorageGetItem(NEW_DOCUMENT_TEMPLATE_STORAGE_KEY),
    letterTemplates,
  );
}

export function saveNewDocumentTemplateId(templateId) {
  if (typeof window === "undefined") {
    return;
  }
  safeStorageSetItem(NEW_DOCUMENT_TEMPLATE_STORAGE_KEY, templateId);
}


export function loadNewDocumentTemplateHistory(letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = safeStorageGetItem(NEW_DOCUMENT_TEMPLATE_HISTORY_STORAGE_KEY);
    return normalizeNewDocumentTemplateHistory(raw ? JSON.parse(raw) : [], letterTemplates);
  } catch {
    return [];
  }
}

export function saveNewDocumentTemplateHistory(history) {
  if (typeof window === "undefined") {
    return;
  }
  safeStorageSetItem(NEW_DOCUMENT_TEMPLATE_HISTORY_STORAGE_KEY, JSON.stringify(history));
}
