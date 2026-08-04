import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AI_MODE_PAGE_TRANSITION_MS,
  createAiChatSelectionActions,
  createAiModeChooserActions,
  createAiModeTransitionActions,
  createAiStreamRegistry,
  scheduleAiPageTransitionClear,
} from "./controllers/index.js";
import { createAiLayoutPort } from "./document-workspace/ai-layout-port.js";

function ref(current) {
  return { current };
}

function workspaceLayout() {
  return {
    primary: {
      views: [{
        kind: "document",
        viewId: "document:primary-tab",
        tabId: "primary-tab",
      }],
      activeViewId: "document:primary-tab",
    },
    secondary: {
      views: [{
        kind: "document",
        viewId: "document:secondary-tab",
        tabId: "secondary-tab",
      }],
      activeViewId: "document:secondary-tab",
    },
    focusedGroup: "secondary",
    splitRatio: 0.42,
  };
}

function createLayoutHarness() {
  const savedGroups = workspaceLayout();
  const snapshots = [
    [
      {
        id: "primary-tab",
        path: "C:\\letters\\primary.letterpaper",
        dirty: true,
        document: { title: "进入前" },
        editorJson: { type: "doc", content: [{ type: "paragraph" }] },
        scrollState: { top: 31, left: 2 },
      },
      {
        id: "secondary-tab",
        path: "C:\\letters\\secondary.letterpaper",
        dirty: false,
        document: { title: "副组" },
        editorJson: { type: "doc", content: [] },
        scrollState: { top: 8, left: 0 },
      },
    ],
    [
      {
        id: "primary-tab",
        path: "C:\\letters\\primary.letterpaper",
        dirty: true,
        document: { title: "AI 中继续编辑后的快照" },
        editorJson: {
          type: "doc",
          content: [{
            type: "paragraph",
            content: [{ type: "text", text: "保留编辑器状态" }],
          }],
        },
        scrollState: { top: 87, left: 4 },
      },
      {
        id: "secondary-tab",
        path: "C:\\letters\\secondary.letterpaper",
        dirty: false,
        document: { title: "副组" },
        editorJson: { type: "doc", content: [] },
        scrollState: { top: 8, left: 0 },
      },
    ],
  ];
  const activeTabIdRef = ref("secondary-tab");
  const aiPreviousSidebarsRef = ref(null);
  const aiSecondaryPaneLayoutRef = ref(null);
  const immersiveSecondaryPaneLayoutRef = ref(null);
  const openTabsRef = ref([]);
  const previousImmersiveModeRef = ref(false);
  const workspaceGroupsRef = ref(savedGroups);
  const events = [];
  let snapshotIndex = 0;
  const port = createAiLayoutPort({
    activeTabIdRef,
    aiPreviousSidebarsRef,
    aiSecondaryPaneLayoutRef,
    applyDocument: (...args) => events.push(["apply", ...args]),
    commitWorkspaceGroups: (groups) => events.push(["commit", groups]),
    immersiveSecondaryPaneLayoutRef,
    openTabsRef,
    previousImmersiveModeRef,
    setActivePane: (pane) => events.push(["pane", pane]),
    setActiveTabId: (tabId) => events.push(["active-tab", tabId]),
    setLeftSidebarCollapsed: (collapsed) => (
      events.push(["left-sidebar", collapsed])
    ),
    setOpenTabs: (tabs) => events.push(["tabs", tabs]),
    snapshotLiveTabs: (options) => {
      events.push(["snapshot-options", options]);
      const snapshot = snapshots[Math.min(snapshotIndex, snapshots.length - 1)];
      snapshotIndex += 1;
      return snapshot;
    },
    workspaceGroupsRef,
  });
  return {
    activeTabIdRef,
    aiPreviousSidebarsRef,
    aiSecondaryPaneLayoutRef,
    events,
    immersiveSecondaryPaneLayoutRef,
    openTabsRef,
    port,
    previousImmersiveModeRef,
    savedGroups,
    snapshots,
  };
}

test("normal AI layout round-trips full groups, dirty editor snapshots, active tab and pane", () => {
  const harness = createLayoutHarness();
  harness.port.enterAiLayout({
    activePane: "right",
    immersiveMode: false,
    leftSidebarCollapsed: false,
  });

  assert.deepEqual(harness.aiPreviousSidebarsRef.current, { left: false });
  assert.deepEqual(harness.aiSecondaryPaneLayoutRef.current, {
    workspaceGroups: harness.savedGroups,
    activePane: "right",
  });
  assert.equal(harness.openTabsRef.current, harness.snapshots[0]);
  assert.equal(harness.openTabsRef.current[0].dirty, true);
  assert.deepEqual(
    harness.openTabsRef.current[0].editorJson,
    harness.snapshots[0][0].editorJson,
  );
  assert.deepEqual(harness.events.slice(-2), [
    ["pane", "main"],
    ["left-sidebar", true],
  ]);

  const exitEventStart = harness.events.length;
  harness.port.exitAiLayout({ immersiveMode: false });
  const exitEvents = harness.events.slice(exitEventStart);
  assert.equal(harness.aiPreviousSidebarsRef.current, null);
  assert.equal(harness.aiSecondaryPaneLayoutRef.current, null);
  assert.equal(harness.openTabsRef.current, harness.snapshots[1]);
  assert.equal(harness.activeTabIdRef.current, "primary-tab");
  assert.deepEqual(exitEvents.map(([kind]) => kind), [
    "left-sidebar",
    "snapshot-options",
    "tabs",
    "commit",
    "active-tab",
    "apply",
    "pane",
  ]);
  assert.deepEqual(exitEvents[1], [
    "snapshot-options",
    { includeEditorJson: true },
  ]);
  assert.equal(exitEvents[3][1], harness.savedGroups);
  assert.deepEqual(exitEvents[5], [
    "apply",
    harness.snapshots[1][0].document,
    harness.snapshots[1][0].path,
    true,
    {
      editorJson: harness.snapshots[1][0].editorJson,
      scrollState: harness.snapshots[1][0].scrollState,
    },
  ]);
  assert.deepEqual(exitEvents.at(-1), ["pane", "right"]);
});

test("AI and immersive transitions hand off the oldest full layout and restore it once", () => {
  const aiFirst = createLayoutHarness();
  aiFirst.port.enterAiLayout({
    activePane: "right",
    immersiveMode: false,
    leftSidebarCollapsed: false,
  });
  const original = aiFirst.aiSecondaryPaneLayoutRef.current;
  aiFirst.port.transitionImmersiveLayout({
    activePane: "main",
    aiMode: true,
    immersiveMode: true,
  });
  assert.equal(aiFirst.immersiveSecondaryPaneLayoutRef.current, original);
  aiFirst.port.exitAiLayout({ immersiveMode: true });
  assert.equal(aiFirst.aiSecondaryPaneLayoutRef.current, null);
  assert.equal(aiFirst.immersiveSecondaryPaneLayoutRef.current, original);
  assert.equal(
    aiFirst.events.filter(([kind]) => kind === "commit").length,
    0,
  );
  aiFirst.port.transitionImmersiveLayout({
    activePane: "main",
    aiMode: false,
    immersiveMode: false,
  });
  assert.equal(aiFirst.immersiveSecondaryPaneLayoutRef.current, null);
  assert.equal(
    aiFirst.events.filter(([kind]) => kind === "commit").length,
    1,
  );
  assert.deepEqual(aiFirst.events.at(-1), ["pane", "right"]);

  const immersiveFirst = createLayoutHarness();
  immersiveFirst.port.transitionImmersiveLayout({
    activePane: "right",
    aiMode: false,
    immersiveMode: true,
  });
  const immersiveOriginal = immersiveFirst.immersiveSecondaryPaneLayoutRef.current;
  immersiveFirst.port.enterAiLayout({
    activePane: "main",
    immersiveMode: true,
    leftSidebarCollapsed: true,
  });
  assert.equal(
    immersiveFirst.aiSecondaryPaneLayoutRef.current,
    immersiveOriginal,
  );
  immersiveFirst.port.transitionImmersiveLayout({
    activePane: "main",
    aiMode: true,
    immersiveMode: false,
  });
  assert.equal(immersiveFirst.immersiveSecondaryPaneLayoutRef.current, null);
  assert.equal(
    immersiveFirst.aiSecondaryPaneLayoutRef.current,
    immersiveOriginal,
  );
  immersiveFirst.port.exitAiLayout({ immersiveMode: false });
  assert.equal(immersiveFirst.aiSecondaryPaneLayoutRef.current, null);
  assert.equal(
    immersiveFirst.events.filter(([kind]) => kind === "commit").length,
    1,
  );
});

test("streaming mode switch cancels and clears only active identity while retaining context", async () => {
  const registry = createAiStreamRegistry();
  registry.startRequest({
    documentKey: "tab:letter",
    kind: "optimize",
    requestId: "request-live",
    startedAt: 100,
  });
  const events = [];
  const dialogs = [];
  const originalClearActive = registry.clearActive;
  const originalResetChatContext = registry.resetChatContext;
  registry.clearActive = () => {
    events.push(["clear-active"]);
    originalClearActive();
  };
  registry.resetChatContext = () => {
    events.push(["reset-chat-context"]);
    originalResetChatContext();
  };
  const actions = createAiModeTransitionActions({
    activePane: "right",
    activeTabReadOnly: false,
    aiBridge: {
      cancelAi: (requestId) => events.push(["cancel", requestId]),
    },
    aiHasUsableProvider: true,
    aiModeKind: "optimize",
    aiStatus: "streaming",
    effectiveAiProvider: "gemini::model",
    getActiveDocumentSnapshot: () => ({
      document: { aiState: { lastMode: "optimize" } },
    }),
    immersiveMode: false,
    layoutPort: {
      enterAiLayout: () => events.push(["enter-layout"]),
      exitAiLayout: () => events.push(["exit-layout"]),
    },
    leftSidebarCollapsed: false,
    openAiSettings: () => events.push(["settings"]),
    setAiModeChooserOpen: (open) => events.push(["chooser", open]),
    setAiModeKind: (kind) => events.push(["kind", kind]),
    setAiPageTransition: (kind) => events.push(["transition", kind]),
    setAiSelectedProvider: (provider) => events.push(["provider", provider]),
    showConfirmDialog: async (dialog) => {
      dialogs.push(dialog);
      return "switch";
    },
    showStatus: (...status) => events.push(["status", ...status]),
    streamRegistry: registry,
    updateActiveDocumentAiState: (updater) => {
      events.push(["ai-state", updater({ lastMode: "optimize" })]);
    },
  });

  assert.equal(await actions.requestAiModeChange("chat"), true);
  assert.equal(registry.hasContext("request-live"), true);
  assert.equal(registry.getActiveId(), "");
  assert.deepEqual(events.filter(([kind]) => kind === "cancel"), [
    ["cancel", "request-live"],
  ]);
  assert.equal(events.some(([kind]) => kind === "enter-layout"), false);
  assert.ok(
    events.findIndex(([kind]) => kind === "reset-chat-context")
      < events.findIndex(([kind]) => kind === "clear-active"),
  );
  assert.deepEqual(events.slice(-2), [
    ["transition", "chat"],
    ["chooser", false],
  ]);
  assert.equal(dialogs[0].title, "停止AI优化并切换到AI协作？");
  assert.equal(dialogs[0].message, "当前生成会停止，已经产生的内容会保留。");
  assert.deepEqual(
    dialogs[0].actions.map(({ value, label }) => ({ value, label })),
    [
      { value: "switch", label: "停止并切换" },
      { value: "cancel", label: "继续当前生成" },
    ],
  );
});

test("mode chooser and transition actions preserve read-only and model gates", async () => {
  const events = [];
  createAiModeChooserActions({
    activeTabReadOnly: true,
    aiHasUsableProvider: false,
    aiModeChooserOpen: true,
    openAiSettings: () => events.push(["settings"]),
    setAiModeChooserOpen: (open) => events.push(["chooser", open]),
    showStatus: (...status) => events.push(["status", ...status]),
  }).toggleAiModeChooser();
  assert.deepEqual(events, [["chooser", false]]);

  events.length = 0;
  createAiModeChooserActions({
    activeTabReadOnly: true,
    aiHasUsableProvider: true,
    aiModeChooserOpen: false,
    openAiSettings: () => events.push(["settings"]),
    setAiModeChooserOpen: (open) => events.push(["chooser", open]),
    showStatus: (...status) => events.push(["status", ...status]),
  }).toggleAiModeChooser();
  assert.deepEqual(events, [
    ["status", "当前信笺为只读，不能进入 AI 模式", "warning"],
  ]);

  events.length = 0;
  const baseOptions = {
    activePane: "main",
    aiBridge: {},
    aiModeKind: "none",
    aiStatus: "idle",
    effectiveAiProvider: "",
    getActiveDocumentSnapshot: () => ({ document: {} }),
    immersiveMode: false,
    layoutPort: {
      enterAiLayout: () => events.push(["enter-layout"]),
      exitAiLayout: () => events.push(["exit-layout"]),
    },
    leftSidebarCollapsed: false,
    openAiSettings: () => events.push(["settings"]),
    setAiModeChooserOpen: (open) => events.push(["chooser", open]),
    setAiModeKind: (kind) => events.push(["kind", kind]),
    setAiPageTransition: (kind) => events.push(["transition", kind]),
    setAiSelectedProvider: () => {},
    showConfirmDialog: async () => "switch",
    showStatus: (...status) => events.push(["status", ...status]),
    streamRegistry: {
      cancelActive() {},
      clearActive() {},
      resetChatContext() {},
    },
    updateActiveDocumentAiState() {},
  };
  const readOnlyActions = createAiModeTransitionActions({
    ...baseOptions,
    activeTabReadOnly: true,
    aiHasUsableProvider: true,
  });
  assert.equal(await readOnlyActions.requestAiModeChange("chat"), false);
  assert.deepEqual(events, [
    ["chooser", false],
    ["status", "当前信笺为只读，不能进入 AI 模式", "warning"],
  ]);

  events.length = 0;
  const missingModelActions = createAiModeTransitionActions({
    ...baseOptions,
    activeTabReadOnly: false,
    aiHasUsableProvider: false,
  });
  assert.equal(await missingModelActions.requestAiModeChange("chat"), false);
  assert.equal(events[0][0], "settings");
  assert.deepEqual(events[1], [
    "status",
    "必须配置好至少一个可用模型，才能进入 AI 模式。配置完成后，再次点击“AI模式”即可。",
    "warning",
    { duration: 5000, dismissible: true },
  ]);
  assert.equal(events.some(([kind]) => kind === "enter-layout"), false);
});

test("page transition uses one 560ms timer and cleanup cancels it", () => {
  const calls = [];
  let callback = null;
  const timerHost = {
    setTimeout(nextCallback, delay) {
      callback = nextCallback;
      calls.push(["set", delay]);
      return 17;
    },
    clearTimeout(timer) {
      calls.push(["clear", timer]);
      callback = null;
    },
  };
  let cleared = 0;
  const cleanup = scheduleAiPageTransitionClear(
    () => {
      cleared += 1;
    },
    { timerHost },
  );
  assert.equal(AI_MODE_PAGE_TRANSITION_MS, 560);
  assert.deepEqual(calls, [["set", 560]]);
  cleanup();
  assert.deepEqual(calls, [["set", 560], ["clear", 17]]);
  callback?.();
  assert.equal(cleared, 0);
});

test("chat selection actions append, remove and jump with the original focus chain", () => {
  const statuses = [];
  let chatState = {
    selectedTexts: [{ id: "old", text: "旧标记", from: 2, to: 4 }],
  };
  const chainCalls = [];
  const chain = {
    focus() {
      chainCalls.push(["focus"]);
      return chain;
    },
    run() {
      chainCalls.push(["run"]);
      return true;
    },
    scrollIntoView() {
      chainCalls.push(["scroll"]);
      return chain;
    },
    setTextSelection(selection) {
      chainCalls.push(["selection", selection]);
      return chain;
    },
  };
  const actions = createAiChatSelectionActions({
    aiChatSelections: chatState.selectedTexts,
    editor: {
      state: { doc: { content: { size: 10 } } },
      chain: () => chain,
    },
    selectionIdFactory: () => "new-id",
    showStatus: (...status) => statuses.push(status),
    updateChatState: (updater) => {
      chatState = typeof updater === "function"
        ? updater(chatState)
        : { ...chatState, ...updater };
    },
  });

  actions.handleCaptureAiChatSelection({
    id: "caller-id",
    text: " ",
    from: 20,
    to: -2,
  });
  assert.deepEqual(chatState.selectedTexts.at(-1), {
    id: "new-id",
    text: " ",
    from: 20,
    to: -2,
  });
  assert.deepEqual(statuses.at(-1), ["已记录标记文字2", "success"]);

  actions.handleRemoveAiChatSelection("old");
  assert.deepEqual(chatState.selectedTexts.map(({ id }) => id), ["new-id"]);

  actions.handleJumpAiChatSelection({ from: 20, to: -2 });
  assert.deepEqual(chainCalls, [
    ["focus"],
    ["selection", { from: 1, to: 10 }],
    ["scroll"],
    ["run"],
  ]);

  actions.handleJumpAiChatSelection({ from: 0, to: "" });
  assert.deepEqual(statuses.at(-1), [
    "这条标记文字的位置已失效",
    "warning",
  ]);
  actions.handleCaptureAiChatSelection({ text: "" });
  assert.deepEqual(statuses.at(-1), [
    "请先在左侧标记一段文字",
    "warning",
  ]);
});

test("App keeps 4C hooks at their anchors and mode controllers cannot reach raw workspace refs", async () => {
  const [
    appSource,
    modeStateSource,
    modeActionsSource,
    selectionActionsSource,
    layoutPortSource,
  ] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./controllers/ai-mode-state.js", import.meta.url), "utf8"),
    readFile(new URL("./controllers/ai-mode-actions.js", import.meta.url), "utf8"),
    readFile(new URL("./controllers/ai-chat-selection-actions.js", import.meta.url), "utf8"),
    readFile(new URL("./document-workspace/ai-layout-port.js", import.meta.url), "utf8"),
  ]);
  const appBody = appSource.slice(appSource.indexOf("export default function App()"));
  const orderedMarkers = [
    "useAiConfigState();",
    "useAiModeState();",
    "const aiSecondaryPaneLayoutRef = useRef(null);",
    "const immersiveSecondaryPaneLayoutRef = useRef(null);",
    "const previousImmersiveModeRef = useRef(false);",
    "const aiModeTriggerRef = useRef(null);",
    "useAiStreamRegistry();",
    "const aiPreviousSidebarsRef = useRef(null);",
    "usePromiseDialogResolverRefs();",
    "useAiModeChooserActions({",
    "useAiConfigActions({",
    "useAiLayoutPort({",
    "useAiModeTransitionActions({",
    "useAiChatSelectionActions({",
    "useKnowledgeDocumentPort({",
    "aiLayoutPort.transitionImmersiveLayout({",
    "useAiRequestActions({",
    "const handleAiChatPresetSelect = useCallback",
    "useAiApplyPreviewActions({",
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const index = appBody.indexOf(marker);
    assert.ok(index > previous, `${marker} must remain after its 4C anchor`);
    previous = index;
  }

  const modeHookOrder = [
    'useState(false)',
    'useState("none")',
    'useState("")',
    "useEffect(() => {",
  ].map((marker) => modeStateSource.indexOf(marker));
  assert.ok(modeHookOrder.every((index) => index >= 0));
  assert.deepEqual([...modeHookOrder].sort((a, b) => a - b), modeHookOrder);

  assert.doesNotMatch(
    modeActionsSource,
    /workspaceGroupsRef|openTabsRef|activeTabIdRef|documentStateRef|setOpenTabs|setActivePane|applyDocument|commitWorkspaceGroups/,
  );
  assert.doesNotMatch(
    selectionActionsSource,
    /workspaceGroupsRef|openTabsRef|documentStateRef|aiSecondaryPaneLayoutRef/,
  );
  assert.match(layoutPortSource, /snapshotLiveTabs\(\{ includeEditorJson: true \}\)/);
  assert.match(layoutPortSource, /commitWorkspaceGroups\(savedLayout\.workspaceGroups\)/);
  assert.match(layoutPortSource, /editorJson: primaryTab\.editorJson/);
  assert.match(layoutPortSource, /scrollState: primaryTab\.scrollState/);
  assert.doesNotMatch(
    appBody,
    /shouldConfirmAiModeChange|shouldConfirmAiModeExit|bridge\.cancelAi|const activateAiMode|const exitAiMode|const handleCaptureAiChatSelection|const beginManualAiApply|const handleApplyAiBlock/,
  );
  assert.match(appBody, /useAiApplyPreviewActions\(\{/);
  assert.match(appBody, /useAiApplyResolutionActions\(\{/);

  const publicPort = createAiLayoutPort({
    activeTabIdRef: ref("tab"),
    aiPreviousSidebarsRef: ref(null),
    aiSecondaryPaneLayoutRef: ref(null),
    applyDocument() {},
    commitWorkspaceGroups() {},
    immersiveSecondaryPaneLayoutRef: ref(null),
    openTabsRef: ref([]),
    previousImmersiveModeRef: ref(false),
    setActivePane() {},
    setActiveTabId() {},
    setLeftSidebarCollapsed() {},
    setOpenTabs() {},
    snapshotLiveTabs: () => [],
    workspaceGroupsRef: ref(workspaceLayout()),
  });
  assert.deepEqual(Object.keys(publicPort).sort(), [
    "enterAiLayout",
    "exitAiLayout",
    "transitionImmersiveLayout",
  ]);
});
