import {
  getLastStorageIssue,
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from "../safe-storage.js";

function readJson(key, fallback) {
  try {
    const value = safeStorageGetItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  const serialized = JSON.stringify(value);
  if (!safeStorageSetItem(key, serialized)) {
    const issue = getLastStorageIssue();
    throw new Error(issue?.message
      ? `浏览器存储写入失败：${issue.message}`
      : "浏览器存储不可用，无法可靠保存");
  }
}

function removeJson(key) {
  if (!safeStorageRemoveItem(key)) {
    const issue = getLastStorageIssue();
    throw new Error(issue?.message
      ? `浏览器存储清理失败：${issue.message}`
      : "浏览器存储不可用，无法可靠清理");
  }
}

export { readJson, removeJson, writeJson };
