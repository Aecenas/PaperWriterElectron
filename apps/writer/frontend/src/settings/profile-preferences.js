import { normalizeWorkspaceSplitRatio } from "../workspace-groups.js";

const LEFT_SIDEBAR_MODES = new Set(["folder", "research", "structure"]);
const STRUCTURE_MODES = new Set([
  "outline",
  "references",
  "related",
  "writing",
  "bibliography",
]);

function boundedText(value, maximum = 256) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function normalizeProfilePreferencesPatch(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const result = {};
  if (Object.hasOwn(source, "newDocumentTemplateId")) {
    result.newDocumentTemplateId = boundedText(source.newDocumentTemplateId);
  }
  if (LEFT_SIDEBAR_MODES.has(source.leftSidebarMode)) {
    result.leftSidebarMode = source.leftSidebarMode;
  }
  if (STRUCTURE_MODES.has(source.structureMode)) {
    result.structureMode = source.structureMode;
  }
  if (typeof source.leftSidebarCollapsed === "boolean") {
    result.leftSidebarCollapsed = source.leftSidebarCollapsed;
  }
  if (Number.isFinite(Number(source.documentSplitRatio))) {
    result.documentSplitRatio = normalizeWorkspaceSplitRatio(
      Number(source.documentSplitRatio),
    );
  }
  return result;
}

export function createPortableProfilePreferences(value = {}) {
  return normalizeProfilePreferencesPatch({
    newDocumentTemplateId: value.newDocumentTemplateId,
    leftSidebarMode: value.leftSidebarMode,
    structureMode: value.structureMode,
    leftSidebarCollapsed: value.leftSidebarCollapsed,
    documentSplitRatio: value.documentSplitRatio,
  });
}
