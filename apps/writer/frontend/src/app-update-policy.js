import { safeStorageGetItem, safeStorageSetItem } from "./safe-storage.js";

export const UPDATE_RESULT_RESET_MS = 2800;
export const UPDATE_AUTO_CHECK_STORAGE_KEY = "paperwriter.updateLastAutoCheckAt";
export const UPDATE_AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function getLastAutoUpdateCheckAt() {
  if (typeof window === "undefined") {
    return 0;
  }
  try {
    return Number(safeStorageGetItem(UPDATE_AUTO_CHECK_STORAGE_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}

export function saveLastAutoUpdateCheckAt(value = Date.now()) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    safeStorageSetItem(UPDATE_AUTO_CHECK_STORAGE_KEY, String(value));
  } catch {
    // localStorage may be unavailable; update checks can still be run manually.
  }
}
