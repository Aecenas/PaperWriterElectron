const memoryValues = new Map();
const issueListeners = new Set();
let issueSequence = 0;
let lastIssue = null;

export const UI_PREFERENCE_STORAGE_KEYS = Object.freeze([
  "paperwriter.workspaceSplitRatio",
  "paperwriter.research.web-scope-mode",
  "paperwriter.newDocumentTemplateId",
  "paperwriter.newDocumentTemplateHistory",
  "paperwriter.exportLastDirectory",
  "paperwriter.updateLastAutoCheckAt",
]);

function browserStorage() {
  try {
    if (typeof window !== "undefined") return window.localStorage;
    return globalThis.localStorage || null;
  } catch (error) {
    reportStorageIssue("access", "", error);
    return null;
  }
}

function reportStorageIssue(operation, key, error) {
  lastIssue = Object.freeze({
    id: ++issueSequence,
    operation,
    key: String(key || ""),
    message: error?.message || "浏览器存储不可用",
    occurredAt: Date.now(),
  });
  for (const listener of issueListeners) {
    try {
      listener(lastIssue);
    } catch {
      // Storage failures must not be able to break the application UI.
    }
  }
}

export function safeStorageGetItem(key) {
  const normalizedKey = String(key || "");
  const memoryValue = memoryValues.has(normalizedKey) ? memoryValues.get(normalizedKey) : null;
  const storage = browserStorage();
  if (!storage) return memoryValue;
  try {
    const value = storage.getItem(normalizedKey);
    if (value === null) memoryValues.delete(normalizedKey);
    else memoryValues.set(normalizedKey, value);
    return value;
  } catch (error) {
    reportStorageIssue("read", normalizedKey, error);
    return memoryValue;
  }
}

export function safeStorageSetItem(key, value) {
  const normalizedKey = String(key || "");
  const normalizedValue = String(value ?? "");
  memoryValues.set(normalizedKey, normalizedValue);
  const storage = browserStorage();
  if (!storage) return false;
  try {
    storage.setItem(normalizedKey, normalizedValue);
    return true;
  } catch (error) {
    reportStorageIssue("write", normalizedKey, error);
    return false;
  }
}

export function safeStorageRemoveItem(key) {
  const normalizedKey = String(key || "");
  memoryValues.delete(normalizedKey);
  const storage = browserStorage();
  if (!storage) return false;
  try {
    storage.removeItem(normalizedKey);
    return true;
  } catch (error) {
    reportStorageIssue("remove", normalizedKey, error);
    return false;
  }
}

export function getLastStorageIssue() {
  return lastIssue;
}

export function subscribeStorageIssues(listener) {
  if (typeof listener !== "function") return () => {};
  issueListeners.add(listener);
  return () => issueListeners.delete(listener);
}

export function resetUiPreferences() {
  let fullyPersisted = true;
  for (const key of UI_PREFERENCE_STORAGE_KEYS) {
    if (!safeStorageRemoveItem(key)) fullyPersisted = false;
  }
  return fullyPersisted;
}

export function clearSafeStorageMemoryForTests() {
  memoryValues.clear();
  lastIssue = null;
  issueSequence = 0;
}
