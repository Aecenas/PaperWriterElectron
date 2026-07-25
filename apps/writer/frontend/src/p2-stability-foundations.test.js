import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLatestRequestController } from "./latest-request-controller.js";
import {
  TAB_PERSISTENCE_STATE,
  deriveTabPersistenceState,
} from "./tab-persistence-state.js";
import {
  UI_PREFERENCE_STORAGE_KEYS,
  clearSafeStorageMemoryForTests,
  getLastStorageIssue,
  resetUiPreferences,
  safeStorageGetItem,
  safeStorageSetItem,
  subscribeStorageIssues,
} from "./safe-storage.js";
import {
  isGlobalShortcutBlocked,
  isTopModalDialog,
  resolveDialogReturnFocus,
} from "./ui-interactions.js";
import { browserBridge } from "./bridge.js";

const sourceText = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("latest request controller rejects stale work independently per scope", () => {
  const controller = createLatestRequestController();
  const firstFolder = controller.begin("folder");
  const research = controller.begin("research");
  const secondFolder = controller.begin("folder");

  assert.equal(firstFolder.signal?.aborted, true);
  assert.equal(controller.isCurrent(firstFolder), false);
  assert.equal(controller.isCurrent(secondFolder), true);
  assert.equal(controller.isCurrent(research), true);

  controller.invalidate("research");
  assert.equal(research.signal?.aborted, true);
  assert.equal(controller.isCurrent(research), false);
  assert.equal(controller.isCurrent(secondFolder), true);

  assert.equal(controller.finish(secondFolder), true);
  const thirdFolder = controller.begin("folder");
  assert.notEqual(thirdFolder.id, secondFolder.id);
  assert.equal(controller.isCurrent(secondFolder), false);
  assert.equal(controller.isCurrent(thirdFolder), true);

  controller.invalidateAll();
  assert.equal(controller.isCurrent(thirdFolder), false);
});

test("tab persistence state is derived from the target tab with safe precedence", () => {
  assert.equal(deriveTabPersistenceState(null), TAB_PERSISTENCE_STATE.WORKSPACE);
  assert.equal(deriveTabPersistenceState({ dirty: true }), TAB_PERSISTENCE_STATE.DIRTY);
  assert.equal(
    deriveTabPersistenceState({ dirty: true, recoveryPath: "recovery.letterpaper", recoveryRevision: 2 }, 1),
    TAB_PERSISTENCE_STATE.DIRTY,
  );
  assert.equal(
    deriveTabPersistenceState({ dirty: true, recoveryPath: "recovery.letterpaper", recoveryRevision: 2 }, 2),
    TAB_PERSISTENCE_STATE.RECOVERY,
  );
  assert.equal(deriveTabPersistenceState({
    dirty: true,
    recoveryPath: "recovery.letterpaper",
    recoveryRevision: 2,
    externalChanged: true,
  }, 2), TAB_PERSISTENCE_STATE.EXTERNAL);
});

test("safe storage retains writes in memory and reports blocked persistence", () => {
  const previousWindow = globalThis.window;
  const issues = [];
  globalThis.window = {
    localStorage: {
      getItem() {
        throw new Error("read blocked");
      },
      setItem() {
        throw new Error("quota");
      },
      removeItem() {
        throw new Error("remove blocked");
      },
    },
  };
  clearSafeStorageMemoryForTests();
  const unsubscribe = subscribeStorageIssues((issue) => issues.push(issue));
  try {
    assert.equal(safeStorageSetItem("paperwriter.test", "memory value"), false);
    assert.equal(safeStorageGetItem("paperwriter.test"), "memory value");
    assert.equal(getLastStorageIssue()?.operation, "read");
    assert.ok(issues.some((issue) => issue.operation === "write"));
    assert.ok(issues.some((issue) => issue.operation === "read"));
  } finally {
    unsubscribe();
    clearSafeStorageMemoryForTests();
    globalThis.window = previousWindow;
  }
});

test("browser document and recovery writes fail closed when durable storage is blocked", async () => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem() {
        throw new Error("quota exhausted");
      },
      removeItem() {
        throw new Error("remove blocked");
      },
    },
  });
  clearSafeStorageMemoryForTests();
  try {
    await assert.rejects(
      browserBridge.saveAutosave({ title: "must not report success" }),
      /浏览器存储写入失败.*quota exhausted/,
    );
    await assert.rejects(
      browserBridge.deleteTempDocument("blocked"),
      /浏览器存储清理失败.*remove blocked/,
    );
  } finally {
    clearSafeStorageMemoryForTests();
    if (previousDescriptor) Object.defineProperty(globalThis, "localStorage", previousDescriptor);
    else delete globalThis.localStorage;
  }
});

test("UI preference reset never includes sessions, templates or recoverable documents", () => {
  assert.ok(UI_PREFERENCE_STORAGE_KEYS.includes("paperwriter.workspaceSplitRatio"));
  assert.ok(UI_PREFERENCE_STORAGE_KEYS.includes("paperwriter.research.web-scope-mode"));
  assert.equal(UI_PREFERENCE_STORAGE_KEYS.includes("paperwriter.sessionState"), false);
  assert.equal(UI_PREFERENCE_STORAGE_KEYS.includes("paperwriter.userLetterTemplates"), false);
  assert.equal(UI_PREFERENCE_STORAGE_KEYS.some((key) => key.includes("autosave") || key.includes(".temp.")), false);

  const previousWindow = globalThis.window;
  const removed = [];
  globalThis.window = {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: (key) => removed.push(key),
    },
  };
  try {
    assert.equal(resetUiPreferences(), true);
    assert.deepEqual(removed, [...UI_PREFERENCE_STORAGE_KEYS]);
  } finally {
    clearSafeStorageMemoryForTests();
    globalThis.window = previousWindow;
  }
});

test("the renderer root has a recoverable error boundary without a normal-layout wrapper", () => {
  const mainSource = sourceText("./main.jsx");
  const boundarySource = sourceText("./AppErrorBoundary.jsx");
  assert.match(mainSource, /<AppErrorBoundary>\s*<App \/>/);
  assert.match(boundarySource, /if \(!error\) return this\.props\.children;/);
  assert.match(boundarySource, /resetUiPreferences\(\);/);
  assert.match(boundarySource, /重置不会删除信笺文件、恢复缓存、会话标签或用户模板/);
});

test("shortcut scope and dialog focus fallback fail closed without DOM globals", () => {
  const modalDocument = {
    querySelector: (selector) => selector.includes("aria-modal") ? {} : null,
  };
  assert.equal(isGlobalShortcutBlocked({ defaultPrevented: false }, modalDocument), true);
  assert.equal(isGlobalShortcutBlocked({ defaultPrevented: true }, { querySelector: () => null }), true);
  assert.equal(isGlobalShortcutBlocked({ defaultPrevented: false }, { querySelector: () => null }), false);

  const lowerDialog = {};
  const topDialog = {};
  assert.equal(isTopModalDialog(lowerDialog, { querySelectorAll: () => [lowerDialog, topDialog] }), false);
  assert.equal(isTopModalDialog({ current: topDialog }, { querySelectorAll: () => [lowerDialog, topDialog] }), true);

  const preferred = { isConnected: false, focus() {} };
  const fallback = { isConnected: true, focus() {} };
  const documentObject = {
    querySelector: (selector) => selector.includes("data-dialog-focus-fallback") ? fallback : null,
  };
  assert.equal(resolveDialogReturnFocus({ documentObject, preferred }), fallback);
});
