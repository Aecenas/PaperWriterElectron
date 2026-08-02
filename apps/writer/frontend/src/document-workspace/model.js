import { createEmptyAiState, normalizeAiState } from "../ai/state.js";
import { normalizeDocumentTitle } from "../content-limits.js";
import {
  createDocumentId,
  getDocumentSchemaCompatibility,
  normalizeCitationSources,
  normalizeCitationStyle,
  normalizeDocumentId,
  normalizeDocumentSchemaV2,
} from "../document-schema-v2.js";
import { normalizeDocumentComments } from "../editor-comments.js";
import { formatPaperDate } from "../editor/paper-date.js";
import { normalizeCustomBackgroundSource } from "../resource-safety.js";
import {
  DEFAULT_LETTER_TEMPLATES,
  normalizeLetterTemplateId,
  normalizeNewDocumentTemplateId,
} from "../templates/model.js";
import {
  WORKSPACE_GROUP_ID,
  WORKSPACE_VIEW_KIND,
  createWorkspaceGroupsSnapshot,
  getActiveWorkspaceView,
} from "../workspace-groups.js";
import { normalizeSessionDiskRevision } from "./revisions.js";

export function createBlankDocument(
  letterTemplates = DEFAULT_LETTER_TEMPLATES,
  preferredTemplateId = DEFAULT_LETTER_TEMPLATES[0].id,
) {
  const normalizedTemplateId = normalizeNewDocumentTemplateId(preferredTemplateId, letterTemplates);
  const letterTemplate = letterTemplates.find((template) => template.id === normalizedTemplateId)
    || DEFAULT_LETTER_TEMPLATES[0];
  const now = new Date().toISOString();
  return {
    version: 3,
    documentId: createDocumentId(),
    derivedFrom: "",
    footnotes: [],
    citationSources: [],
    citationStyle: normalizeCitationStyle(),
    title: "未命名信笺",
    author: "",
    html: "<p></p>",
    letterTemplateId: letterTemplate.id,
    templateId: letterTemplate.paperId,
    fontFamily: letterTemplate.typography.bodyFont,
    fontSize: letterTemplate.typography.bodySize,
    customBackground: "",
    comments: [],
    aiState: createEmptyAiState(),
    createdAt: now,
    displayDate: formatPaperDate(now),
    updatedAt: now,
  };
}

export function normalizeDocument(document, letterTemplates = DEFAULT_LETTER_TEMPLATES) {
  const customBackground = normalizeCustomBackgroundSource(document?.customBackground);
  const letterTemplateId = normalizeLetterTemplateId(document?.letterTemplateId, document?.templateId, letterTemplates);
  const letterTemplate = letterTemplates.find((template) => template.id === letterTemplateId) || DEFAULT_LETTER_TEMPLATES[0];
  const templateId = customBackground && document?.templateId === "custom" ? "custom" : letterTemplate.paperId;
  const createdAt = typeof document?.createdAt === "string" && document.createdAt
    ? document.createdAt
    : (typeof document?.updatedAt === "string" && document.updatedAt ? document.updatedAt : new Date().toISOString());
  const displayDate = typeof document?.displayDate === "string" && document.displayDate.trim()
    ? document.displayDate.trim().slice(0, 40)
    : formatPaperDate(createdAt);
  const compatibility = getDocumentSchemaCompatibility(document || {});
  const schemaDocument = compatibility.readOnly
    ? document
    : normalizeDocumentSchemaV2(document || {});
  const normalized = {
    ...createBlankDocument(),
    ...schemaDocument,
    title: normalizeDocumentTitle(schemaDocument?.title),
    author: typeof schemaDocument?.author === "string" ? schemaDocument.author.trim().slice(0, 40) : "",
    html: schemaDocument?.html || "<p></p>",
    createdAt,
    displayDate,
    letterTemplateId,
    templateId,
    fontFamily: letterTemplate.typography.bodyFont,
    fontSize: letterTemplate.typography.bodySize,
    customBackground,
    comments: normalizeDocumentComments(schemaDocument?.comments),
    aiState: normalizeAiState(schemaDocument?.aiState),
    _readOnlyFutureSchema: compatibility.readOnly || Boolean(schemaDocument?._readOnlyFutureSchema),
  };
  delete normalized.layoutMode;
  return normalized;
}

export function inferTitle(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, 24) : "未命名信笺";
}

export function documentRuntimeKey(pathValue, tabId = "") {
  return pathValue ? `path:${String(pathValue).replace(/\//g, "\\").toLowerCase()}` : `tab:${tabId || "untitled"}`;
}

export function normalizeWorkspaceCitationSources(sources) {
  return normalizeCitationSources(Array.isArray(sources) ? sources : []);
}

export function createTabId() {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function estimateSerializedBytes(value) {
  if (!value) {
    return 0;
  }
  try {
    const text = JSON.stringify(value);
    if (!text) {
      return 0;
    }
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(text).byteLength;
    }
    return text.length * 2;
  } catch {
    return 0;
  }
}

export function summarizeDocumentCache(tabs) {
  return tabs.reduce((summary, tab) => {
    const bytes = Math.max(0, Number(tab.editorJsonBytes) || 0);
    if (!bytes) {
      return summary;
    }
    return {
      bytes: summary.bytes + bytes,
      count: summary.count + 1,
    };
  }, { bytes: 0, count: 0 });
}

export function summarizeSessionTabs(tabs = []) {
  const seen = new Set();
  return tabs
    .map((tab) => {
      const logicalPath = typeof tab?.path === "string" ? tab.path : "";
      const recoveryPath = typeof tab?.recoveryPath === "string" ? tab.recoveryPath : "";
      return {
        path: logicalPath,
        recoveryPath,
        recoveryId: typeof tab?.recoveryId === "string" ? tab.recoveryId : "",
        recoverySourcePath: typeof tab?.recoverySourcePath === "string" ? tab.recoverySourcePath : logicalPath,
        recoveryBaseRevision: normalizeSessionDiskRevision(tab?.recoveryBaseRevision || tab?.diskRevision),
        temporary: Boolean(tab?.temporary || (!logicalPath && recoveryPath)),
      };
    })
    .filter((tab) => {
      const pathKey = String(tab.path || tab.recoveryPath || "").replace(/\//g, "\\").toLocaleLowerCase("en-US");
      if (!pathKey || seen.has(pathKey)) {
        return false;
      }
      seen.add(pathKey);
      return true;
    });
}

export function createDocumentTab(document, path = "", dirty = false, options = {}) {
  return {
    id: createTabId(),
    path,
    title: normalizeDocumentTitle(document?.title),
    document,
    editorJson: null,
    editorJsonBytes: 0,
    scrollState: { top: 0, left: 0 },
    recoveryPath: options.recoveryPath || "",
    recoveryId: options.recoveryId || "",
    recoverySourcePath: options.recoverySourcePath || "",
    recoveryBaseRevision: normalizeSessionDiskRevision(options.recoveryBaseRevision),
    recoveryRevision: Number.isFinite(options.recoveryRevision) ? options.recoveryRevision : null,
    recoveredTemporary: Boolean(options.recoveredTemporary),
    diskRevision: options.diskRevision || null,
    readOnly: Boolean(options.readOnly || document?._readOnlyFutureSchema),
    externalChanged: Boolean(options.externalChanged),
    dirty,
  };
}

export function documentTabResourceKey(tab) {
  const path = String(tab?.path || "").trim();
  if (path) return `path:${path.replace(/\//g, "\\").toLocaleLowerCase("en-US")}`;
  const recoveryId = String(tab?.recoveryId || "").trim();
  if (recoveryId) return `recovery:${recoveryId}`;
  return tab?.id ? `temporary:${tab.id}` : "";
}

export function workspaceDocumentView(tab) {
  return tab?.id ? { tabId: tab.id, resourceKey: documentTabResourceKey(tab) } : null;
}

export function summarizeWorkspaceGroups(groups, tabs = []) {
  const tabById = new Map(tabs.map((tab) => [tab.id, tab]));
  return createWorkspaceGroupsSnapshot(groups, {
    getDocumentResourceKey: (tabId) => documentTabResourceKey(tabById.get(tabId)),
  });
}

export function activeSecondaryDocumentTabId(groups) {
  const view = getActiveWorkspaceView(groups, WORKSPACE_GROUP_ID.SECONDARY);
  return view?.kind === WORKSPACE_VIEW_KIND.DOCUMENT ? view.tabId : "";
}

export function recoveryTabId(tab) {
  return String(tab?.recoveryId || tab?.id || "");
}

export function paperCanvasViewModel(document = {}) {
  return {
    documentId: normalizeDocumentId(document.documentId),
    title: normalizeDocumentTitle(document.title),
    author: document.author || "",
    displayDate: document.displayDate || "",
    createdAt: document.createdAt || "",
    customBackground: normalizeCustomBackgroundSource(document.customBackground),
    templateId: document.templateId || "warm",
    letterTemplateId: document.letterTemplateId || "",
  };
}
