import { safeStorageGetItem, safeStorageSetItem } from "../safe-storage.js";
import { normalizeSessionDiskRevision } from "./revisions.js";

export const SESSION_STORAGE_KEY = "paperwriter.sessionState";

export function loadSessionState() {
  if (typeof window === "undefined") {
    return { folderPath: "", activePath: "", tabs: [] };
  }
  try {
    const raw = safeStorageGetItem(SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs
        .map((tab) => ({
          path: typeof tab?.path === "string" ? tab.path : "",
          recoveryPath: typeof tab?.recoveryPath === "string" ? tab.recoveryPath : "",
          recoveryId: typeof tab?.recoveryId === "string" ? tab.recoveryId : "",
          recoverySourcePath: typeof tab?.recoverySourcePath === "string" ? tab.recoverySourcePath : "",
          recoveryBaseRevision: normalizeSessionDiskRevision(tab?.recoveryBaseRevision),
          temporary: Boolean(tab?.temporary),
        }))
        .filter((tab) => tab.path || tab.recoveryPath)
      : [];
    return {
      folderPath: typeof parsed.folderPath === "string" ? parsed.folderPath : "",
      activePath: typeof parsed.activePath === "string" ? parsed.activePath : "",
      tabs,
      workspaceGroups: parsed.workspaceGroups && typeof parsed.workspaceGroups === "object" ? parsed.workspaceGroups : null,
    };
  } catch {
    return { folderPath: "", activePath: "", tabs: [] };
  }
}

export function saveSessionState(state) {
  if (typeof window === "undefined") {
    return;
  }
  safeStorageSetItem(SESSION_STORAGE_KEY, JSON.stringify({
    folderPath: typeof state.folderPath === "string" ? state.folderPath : "",
    activePath: typeof state.activePath === "string" ? state.activePath : "",
    tabs: Array.isArray(state.tabs)
      ? state.tabs
        .map((tab) => ({
          path: typeof tab?.path === "string" ? tab.path : "",
          recoveryPath: typeof tab?.recoveryPath === "string" ? tab.recoveryPath : "",
          recoveryId: typeof tab?.recoveryId === "string" ? tab.recoveryId : "",
          recoverySourcePath: typeof tab?.recoverySourcePath === "string" ? tab.recoverySourcePath : "",
          recoveryBaseRevision: normalizeSessionDiskRevision(tab?.recoveryBaseRevision),
          temporary: Boolean(tab?.temporary),
        }))
        .filter((tab) => tab.path || tab.recoveryPath)
      : [],
    workspaceGroups: state.workspaceGroups && typeof state.workspaceGroups === "object" ? state.workspaceGroups : null,
    updatedAt: new Date().toISOString(),
  }));
}
