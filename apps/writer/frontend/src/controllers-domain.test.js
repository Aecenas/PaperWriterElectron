import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { UPDATE_AUTO_CHECK_INTERVAL_MS } from "./app-update-policy.js";
import {
  cancelPendingPromiseDialogs,
  createPromiseDialogActions,
  createStatusActions,
  handleUpdateStateEvent,
  isAutomaticUpdateCheckThrottled,
} from "./controllers/index.js";

function ref(current = null) {
  return { current };
}

test("promise dialog actions resolve replacements, confirmations, prompts, and unmount cancellation", async () => {
  const confirmDialogResolverRef = ref();
  const promptDialogResolverRef = ref();
  const confirmStates = [];
  const promptStates = [];
  const activeElement = { id: "focused-control" };
  const actions = createPromiseDialogActions({
    confirmDialogResolverRef,
    promptDialogResolverRef,
    setConfirmDialog: (state) => confirmStates.push(state),
    setPromptDialog: (state) => promptStates.push(state),
    getActiveElement: () => activeElement,
  });

  const firstConfirm = actions.showConfirmDialog({ title: "第一次" });
  const secondConfirm = actions.showConfirmDialog({ title: "第二次", cancelValue: "replace" });
  assert.equal(await firstConfirm, "replace");
  assert.deepEqual(confirmStates.at(-1), {
    tone: "default",
    cancelValue: "replace",
    actions: [],
    title: "第二次",
    returnFocusElement: activeElement,
  });
  actions.resolveConfirmDialog("accepted");
  assert.equal(await secondConfirm, "accepted");
  assert.equal(confirmStates.at(-1), null);
  assert.equal(confirmDialogResolverRef.current, null);

  const firstPrompt = actions.showPromptDialog({ title: "第一次输入" });
  const secondPrompt = actions.showPromptDialog({ title: "第二次输入", defaultValue: "草稿" });
  assert.equal(await firstPrompt, null);
  assert.deepEqual(promptStates.at(-1), {
    defaultValue: "草稿",
    confirmLabel: "确定",
    title: "第二次输入",
    returnFocusElement: activeElement,
  });
  actions.resolvePromptDialog("完成");
  assert.equal(await secondPrompt, "完成");
  assert.equal(promptStates.at(-1), null);
  assert.equal(promptDialogResolverRef.current, null);

  let confirmCancel;
  let promptCancel = "pending";
  confirmDialogResolverRef.current = (value) => { confirmCancel = value; };
  promptDialogResolverRef.current = (value) => { promptCancel = value; };
  cancelPendingPromiseDialogs(confirmDialogResolverRef, promptDialogResolverRef);
  assert.equal(confirmCancel, "cancel");
  assert.equal(promptCancel, null);
  assert.equal(confirmDialogResolverRef.current, null);
  assert.equal(promptDialogResolverRef.current, null);
});

test("status actions retain timeout replacement and explicit dismiss behavior", () => {
  const states = [];
  const timers = new Map();
  const cleared = [];
  let nextTimer = 0;
  const timerHost = {
    clearTimeout(timer) {
      cleared.push(timer);
      timers.delete(timer);
    },
    setTimeout(callback, duration) {
      const timer = ++nextTimer;
      timers.set(timer, { callback, duration });
      return timer;
    },
  };
  const { showStatus, dismissStatus } = createStatusActions(
    (state) => states.push(state),
    timerHost,
  );

  showStatus("已保存", "success", { duration: 250, dismissible: true });
  assert.deepEqual(states.at(-1), {
    message: "已保存",
    tone: "success",
    dismissible: true,
  });
  assert.equal(timers.get(1).duration, 1000);

  showStatus("稍后重试", "warning");
  assert.ok(cleared.includes(1));
  assert.equal(timers.get(2).duration, 2800);
  timers.get(2).callback();
  assert.equal(states.at(-1), null);

  showStatus("可关闭", "success");
  dismissStatus();
  assert.ok(cleared.includes(3));
  assert.equal(states.at(-1), null);
});

test("update event transitions preserve notifications, automatic download/install, and terminal flow reset", () => {
  const calls = [];
  const updateFlowRef = ref({ active: true, handled: "" });
  const dependencies = {
    clearUpdateResultReset: () => calls.push(["clear"]),
    setUpdateState: (state) => calls.push(["state", state.status]),
    showStatus: (message, tone) => calls.push(["status", message, tone]),
    scheduleUpdateResultReset: (state) => calls.push(["schedule", state.status]),
    updateFlowRef,
    updateBridge: {
      downloadUpdate: () => calls.push(["download"]),
      installUpdate: () => calls.push(["install"]),
    },
  };

  handleUpdateStateEvent(
    { status: "available", message: "发现更新" },
    dependencies,
  );
  assert.deepEqual(calls, [
    ["clear"],
    ["state", "available"],
    ["status", "发现更新", "success"],
    ["schedule", "available"],
    ["download"],
  ]);
  assert.equal(updateFlowRef.current.handled, "available");

  handleUpdateStateEvent({ status: "downloaded", message: "下载完成" }, dependencies);
  assert.equal(calls.filter(([kind]) => kind === "install").length, 1);
  assert.equal(updateFlowRef.current.handled, "downloaded");

  handleUpdateStateEvent({ status: "error", message: "更新失败" }, dependencies);
  assert.deepEqual(calls.findLast(([kind]) => kind === "status"), [
    "status",
    "更新失败",
    "warning",
  ]);
  assert.deepEqual(updateFlowRef.current, { active: false, handled: "error" });
});

test("automatic update throttle keeps the existing 24-hour boundary", () => {
  const now = 10 * UPDATE_AUTO_CHECK_INTERVAL_MS;
  assert.equal(isAutomaticUpdateCheckThrottled(0, now), false);
  assert.equal(
    isAutomaticUpdateCheckThrottled(now - UPDATE_AUTO_CHECK_INTERVAL_MS + 1, now),
    true,
  );
  assert.equal(
    isAutomaticUpdateCheckThrottled(now - UPDATE_AUTO_CHECK_INTERVAL_MS, now),
    false,
  );
  assert.equal(isAutomaticUpdateCheckThrottled(now + 1, now), true);
});

test("App composes controller actions and lifecycle hooks at the original domain anchors", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const appBody = source.slice(source.indexOf("export default function App()"));
  const orderedMarkers = [
    "usePromiseDialogActions({",
    "usePromiseDialogOverlayLifecycle(confirmDialog, promptDialog);",
    "usePromiseDialogUnmountLifecycle(",
    "useAiDocumentStateActions(aiDocumentPort);",
    "useHelpReleaseActions(setHelpOpen, setReleaseNotesOpen);",
    "useClearUpdateResultReset(updateResultResetTimerRef);",
    "useScheduleUpdateResultReset(",
    "useUpdateEventsLifecycle({",
    "useRunUpdateAction({",
    "useUpdateAutoCheckLifecycle({",
    "const applyDocument = useCallback",
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const index = appBody.indexOf(marker);
    assert.ok(index > previous, `${marker} must remain after its preceding lifecycle anchor`);
    previous = index;
  }
  assert.doesNotMatch(appBody, /const showStatus = useCallback/);
  assert.doesNotMatch(appBody, /const handleRunUpdate = useCallback/);
  assert.doesNotMatch(appBody, /confirmDialogResolverRef\.current\?\.\("cancel"\)/);
});

test("template and export controllers retain their split state and lifecycle anchors", async () => {
  const source = await readFile(new URL("./App.jsx", import.meta.url), "utf8");
  const appBody = source.slice(source.indexOf("export default function App()"));
  const orderedMarkers = [
    "useTemplateCatalogState();",
    "} = useDocumentWorkspaceState({",
    "useTemplateTabDialogState();",
    "useHelpReleaseState();",
    "useExportDialogState();",
    "useStatusState();",
    "useExportPresentationState();",
    "useTemplateTabDialogActions(",
    "usePromiseDialogOverlayLifecycle(",
    "usePersistUserTemplateGroups(",
    "usePersistUserLetterTemplates(",
    "usePersistNewDocumentTemplateId(",
    "usePersistNewDocumentTemplateHistory(",
    "useNormalizeNewDocumentTemplateHistory(",
    "openTabsRef.current = openTabs;",
    "useExportDialogActions({",
    "const resolveExportTarget = useCallback",
    "window.document.addEventListener(\"keydown\", handleKeyDown, true);",
    "useExportExecutionActions({",
    "const handleInsertImage = useCallback",
    "const updateDocumentSetting = useCallback",
    "useTemplateCatalogActions({",
    "useAiConfigActions({",
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const index = appBody.indexOf(marker);
    assert.ok(index > previous, `${marker} must remain after its preceding hook anchor`);
    previous = index;
  }
});
