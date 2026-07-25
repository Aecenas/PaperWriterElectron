import { safeStorageGetItem, safeStorageSetItem } from "../safe-storage.js";

export const EXPORT_LAST_DIRECTORY_STORAGE_KEY = "paperwriter.exportLastDirectory";

export function normalizeRememberedExportDirectory(value) {
  const directory = typeof value === "string" ? value.trim() : "";
  return directory && directory.length <= 32768 && !/[\u0000-\u001f\u007f]/.test(directory) ? directory : "";
}

export function loadRememberedExportDirectory() {
  if (typeof window === "undefined") return "";
  try {
    return normalizeRememberedExportDirectory(safeStorageGetItem(EXPORT_LAST_DIRECTORY_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function rememberExportDirectory(value) {
  if (typeof window === "undefined") return;
  const directory = normalizeRememberedExportDirectory(value);
  if (!directory) return;
  try {
    safeStorageSetItem(EXPORT_LAST_DIRECTORY_STORAGE_KEY, directory);
  } catch {
    // Export still works when local preferences are unavailable.
  }
}
