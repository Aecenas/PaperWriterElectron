import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAiConfigActions,
  createAiDocumentStateActions,
  applyCodexStatusAiConfig,
  applyLoadedAiConfig,
  resolveAiApplyResolverLabel,
  resolveEffectiveAiProvider,
} from "./controllers/index.js";
import { createAiDocumentPort } from "./document-workspace/ai-document-port.js";
import { documentRuntimeKey } from "./document-workspace/model.js";

function ref(current) {
  return { current };
}

function createDocumentHarness({
  activeReadOnly = false,
  activeFuture = false,
  backgroundReadOnly = false,
  backgroundFuture = false,
} = {}) {
  const activeTabIdRef = ref("active-tab");
  const currentPathRef = ref("C:\\Letters\\Active.letterpaper");
  const documentStateRef = ref({
    title: "Active",
    html: "<p>active</p>",
    _readOnlyFutureSchema: activeFuture,
  });
  const openTabsRef = ref([
    {
      id: "active-tab",
      path: "C:\\Letters\\Active.letterpaper",
      dirty: false,
      readOnly: activeReadOnly,
      document: { title: "stale active cache", html: "<p>cached</p>" },
    },
    {
      id: "background-tab",
      path: "C:\\Letters\\Background.letterpaper",
      dirty: false,
      readOnly: backgroundReadOnly,
      document: {
        title: "Background",
        html: "<p>background</p>",
        _readOnlyFutureSchema: backgroundFuture,
      },
    },
  ]);
  const dirtyIds = new Set();
  const revisions = new Map();
  const documentStates = [];
  const tabStates = [];
  let timestampSequence = 0;
  const setDocumentState = (document) => {
    documentStates.push(document);
  };
  const setOpenTabs = (tabs) => {
    tabStates.push(tabs);
  };
  const recordTabMutation = (tabId) => {
    revisions.set(tabId, (revisions.get(tabId) || 0) + 1);
    dirtyIds.add(tabId);
    const nextTabs = openTabsRef.current.map((tab) => (
      tab.id === tabId ? { ...tab, dirty: true, recoveryRevision: null } : tab
    ));
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
  };
  const rekeys = [];
  const port = createAiDocumentPort({
    activeTabIdRef,
    currentPathRef,
    documentStateRef,
    getUpdatedAt: () => `2026-07-26T00:00:0${++timestampSequence}.000Z`,
    onRuntimeKeyRekey: (fromKey, toKey) => rekeys.push([fromKey, toKey]),
    openTabsRef,
    recordTabMutation,
    setDocumentState,
    setOpenTabs,
  });

  return {
    actions: createAiDocumentStateActions(port),
    activeTabIdRef,
    currentPathRef,
    dirtyIds,
    documentStateRef,
    documentStates,
    openTabsRef,
    port,
    rekeys,
    revisions,
    tabStates,
  };
}

test("AI document updates synchronize background cache and advance every streamed revision", () => {
  const harness = createDocumentHarness();
  const backgroundKey = documentRuntimeKey(
    "C:\\Letters\\Background.letterpaper",
    "background-tab",
  );

  harness.actions.updateOptimizeStateForKey(backgroundKey, (optimize) => ({
    ...optimize,
    output: `${optimize.output}第一段`,
    status: "streaming",
  }));
  harness.actions.updateOptimizeStateForKey(backgroundKey, (optimize) => ({
    ...optimize,
    output: `${optimize.output}第二段`,
    status: "done",
  }));

  const background = harness.openTabsRef.current.find((tab) => tab.id === "background-tab");
  assert.equal(background.document.aiState.optimize.output, "第一段第二段");
  assert.equal(background.document.aiState.optimize.status, "done");
  assert.equal(background.document.aiState.optimize.updatedAt, "2026-07-26T00:00:02.000Z");
  assert.equal(background.document.updatedAt, "2026-07-26T00:00:02.000Z");
  assert.equal(background.dirty, true);
  assert.equal(harness.dirtyIds.has("background-tab"), true);
  assert.equal(harness.revisions.get("background-tab"), 2);
  assert.equal(harness.documentStates.length, 0);
  assert.equal(harness.documentStateRef.current.title, "Active");
  assert.ok(harness.tabStates.length >= 2);
});

test("AI active updates keep the canonical ref and state synchronized while marking the tab dirty", () => {
  const harness = createDocumentHarness();
  assert.equal(
    harness.port.getActiveKey(),
    "path:c:\\letters\\active.letterpaper",
  );
  assert.deepEqual(harness.port.getActiveSnapshot(), {
    document: harness.documentStateRef.current,
    documentKey: "path:c:\\letters\\active.letterpaper",
    readOnly: false,
    tabId: "active-tab",
  });

  harness.actions.updateActiveDocumentAiState((previous) => ({
    ...previous,
    lastMode: "chat",
  }));

  assert.equal(harness.documentStateRef.current.aiState.lastMode, "chat");
  assert.equal(harness.documentStates.at(-1), harness.documentStateRef.current);
  assert.equal(
    harness.openTabsRef.current.find((tab) => tab.id === "active-tab").dirty,
    true,
  );
  assert.equal(harness.dirtyIds.has("active-tab"), true);
  assert.equal(harness.revisions.get("active-tab"), 1);
  assert.equal(harness.openTabsRef.current[0].document.title, "stale active cache");
});

test("AI document port rejects missing, read-only, and future-schema targets without mutation", () => {
  const missing = createDocumentHarness();
  assert.equal(missing.port.updateByRuntimeKey("", { title: "ignored" }), false);
  assert.equal(missing.port.updateByRuntimeKey("tab:missing", { title: "ignored" }), false);

  const activeReadOnly = createDocumentHarness({ activeReadOnly: true });
  assert.equal(activeReadOnly.port.updateActive({ title: "ignored" }), false);
  assert.equal(activeReadOnly.revisions.size, 0);

  const activeFuture = createDocumentHarness({ activeFuture: true });
  assert.equal(activeFuture.port.updateActive({ title: "ignored" }), false);
  assert.equal(activeFuture.revisions.size, 0);

  const backgroundKey = documentRuntimeKey(
    "C:\\Letters\\Background.letterpaper",
    "background-tab",
  );
  const backgroundReadOnly = createDocumentHarness({ backgroundReadOnly: true });
  assert.equal(backgroundReadOnly.port.updateByRuntimeKey(backgroundKey, { title: "ignored" }), false);
  assert.equal(backgroundReadOnly.revisions.size, 0);

  const backgroundFuture = createDocumentHarness({ backgroundFuture: true });
  assert.equal(backgroundFuture.port.updateByRuntimeKey(backgroundKey, { title: "ignored" }), false);
  assert.equal(backgroundFuture.revisions.size, 0);
});

test("persisted runtime-key migration is validated and rekeys request identity through one callback", () => {
  const harness = createDocumentHarness();
  const requestContexts = new Map([
    ["request-1", { documentKey: "tab:active-tab" }],
    ["request-2", { documentKey: "path:c:\\letters\\other.letterpaper" }],
  ]);
  const port = createAiDocumentPort({
    activeTabIdRef: harness.activeTabIdRef,
    currentPathRef: harness.currentPathRef,
    documentStateRef: harness.documentStateRef,
    onRuntimeKeyRekey: (fromKey, toKey) => {
      requestContexts.forEach((context) => {
        if (context.documentKey === fromKey) context.documentKey = toKey;
      });
    },
    openTabsRef: harness.openTabsRef,
    recordTabMutation: () => {},
    setDocumentState: () => {},
    setOpenTabs: () => {},
  });
  const actions = createAiDocumentStateActions(port);

  assert.equal(port.rekeyPersistedDocument("", "path:new"), false);
  assert.equal(port.rekeyPersistedDocument("tab:active-tab", "tab:active-tab"), false);
  actions.migrateAiRequestDocumentKey(
    "tab:active-tab",
    "path:c:\\letters\\saved.letterpaper",
  );
  assert.equal(
    requestContexts.get("request-1").documentKey,
    "path:c:\\letters\\saved.letterpaper",
  );
  assert.equal(
    requestContexts.get("request-2").documentKey,
    "path:c:\\letters\\other.letterpaper",
  );

  harness.currentPathRef.current = "C:\\Letters\\Saved.letterpaper";
  assert.equal(
    harness.port.getActiveKey(),
    "path:c:\\letters\\saved.letterpaper",
  );
});

test("AI config normalization keeps load selection and Codex subscription responsibilities distinct", () => {
  const configs = [];
  const selections = [];
  const loaded = applyLoadedAiConfig(
    { activeProvider: "gemini", activeModelId: "gemini-default" },
    {
      setAiConfig: (config) => configs.push(config),
      setAiSelectedProvider: (provider) => selections.push(provider),
    },
  );
  assert.equal(configs.at(-1), loaded);
  assert.equal(selections.at(-1), loaded.activeModelKey);

  const codex = applyCodexStatusAiConfig(
    { activeProvider: "codex", activeModelId: "codex-default" },
    (config) => configs.push(config),
  );
  assert.equal(configs.at(-1), codex);
  assert.equal(selections.length, 1);
});

test("AI provider derivation retains selected, active, first-available, and resolver fallbacks", () => {
  const providers = [
    {
      id: "provider-a::model-a",
      providerLabel: "Provider A",
      modelName: "Model A",
    },
    {
      id: "provider-b::model-b",
      providerLabel: "Provider B",
      modelName: "Model B",
    },
  ];
  const config = {
    activeModelKey: "provider-b::model-b",
    taskModels: {
      applyResolver: {
        providerId: "provider-a",
        modelId: "model-a",
      },
    },
  };
  assert.equal(
    resolveEffectiveAiProvider(config, "provider-a::model-a", providers),
    "provider-a::model-a",
  );
  assert.equal(
    resolveEffectiveAiProvider(config, "missing::model", providers),
    "provider-b::model-b",
  );
  assert.equal(
    resolveEffectiveAiProvider(
      { ...config, activeModelKey: "missing::model" },
      "missing::model",
      providers,
    ),
    "provider-a::model-a",
  );
  assert.equal(
    resolveAiApplyResolverLabel(config, providers),
    "Provider A · Model A",
  );
  assert.equal(
    resolveAiApplyResolverLabel(
      { activeModelKey: "missing::model", taskModels: {} },
      providers,
    ),
    "直接应用定位模型",
  );
});

test("AI config actions retain bridge payloads, normalized state, and status outcomes", async () => {
  const calls = [];
  const configs = [];
  const statuses = [];
  const aiBridge = {
    saveAiConfig: async (draft) => {
      calls.push(["save", draft]);
      return { activeProvider: "gemini", activeModelId: "gemini-default" };
    },
    createAiProvider: async (draft) => {
      calls.push(["create", draft]);
      return {
        activeProvider: "gemini",
        activeModelId: "gemini-default",
        createdProvider: { id: "custom" },
      };
    },
    deleteAiProvider: async (providerId) => {
      calls.push(["delete", providerId]);
      return { activeProvider: "gemini", activeModelId: "gemini-default" };
    },
    testAiConfig: async (draft) => {
      calls.push(["test", draft]);
      return draft.fail
        ? null
        : {
            activeProvider: "gemini",
            activeModelId: "gemini-default",
            ok: true,
            message: "连接正常",
          };
    },
    refreshCodexCliStatus: async () => ({
      activeProvider: "codex",
      activeModelId: "codex-default",
      ok: false,
      message: "需要登录",
    }),
    startCodexCliLogin: async () => ({
      activeProvider: "codex",
      activeModelId: "codex-default",
      ok: true,
      message: "已打开登录",
    }),
  };
  const actions = createAiConfigActions({
    aiBridge,
    setAiConfig: (config) => configs.push(config),
    showStatus: (...status) => statuses.push(status),
  });

  const saved = await actions.handleSaveAiConfig({ requestParams: { temperature: 0.3 } });
  assert.equal(saved.ok, true);
  assert.deepEqual(calls[0], ["save", { requestParams: { temperature: 0.3 } }]);

  const cleared = await actions.handleClearAiConfig({ provider: "gemini" });
  assert.equal(cleared.ok, true);
  assert.deepEqual(calls[1], ["save", { provider: "gemini", clearApiKey: true }]);

  const created = await actions.handleCreateAiProvider({ id: "custom" });
  assert.deepEqual(created.createdProvider, { id: "custom" });
  await actions.handleDeleteAiProvider("custom");
  assert.deepEqual(calls.at(-1), ["delete", "custom"]);

  assert.deepEqual(
    await actions.handleTestAiConfig({ fail: true }),
    { ok: false, message: "AI 连接测试失败" },
  );
  assert.equal((await actions.handleTestAiConfig({ fail: false })).message, "连接正常");
  assert.equal((await actions.handleRefreshCodexCli()).ok, false);
  assert.equal((await actions.handleLoginCodexCli()).ok, true);
  assert.ok(configs.length >= 6);
  assert.deepEqual(statuses.find(([message]) => message === "需要登录"), ["需要登录", "warning"]);
  assert.deepEqual(statuses.at(-1), ["已打开登录", "success"]);
});

test("App keeps AI config hooks at their anchors and controllers cannot reach raw document refs", async () => {
  const [
    appSource,
    lifecycleSource,
    documentStateSource,
    configActionsSource,
  ] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./controllers/ai-config-lifecycle.js", import.meta.url), "utf8"),
    readFile(new URL("./controllers/ai-document-state.js", import.meta.url), "utf8"),
    readFile(new URL("./controllers/ai-config-actions.js", import.meta.url), "utf8"),
  ]);
  const appBody = appSource.slice(appSource.indexOf("export default function App()"));
  const orderedMarkers = [
    "useAiConfigState();",
    "useAiModeState();",
    "useAiConfigDerived({",
    "const activeDocumentKey = useMemo",
    "useAiDocumentStateActions(aiDocumentPort);",
    "useAiConfigLifecycle({",
    "editor.setEditable(!activeTabReadOnly",
    "useAiConfigActions({",
    "useAiLayoutPort({",
    "useAiModeTransitionActions({",
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const index = appBody.indexOf(marker);
    assert.ok(index > previous, `${marker} must remain after its preceding AI anchor`);
    previous = index;
  }

  const loadIndex = lifecycleSource.indexOf("aiBridge.getAiConfig");
  const codexIndex = lifecycleSource.indexOf("aiBridge.onCodexCliStatus");
  const resetIndex = lifecycleSource.indexOf("if (!aiMode)");
  assert.ok(loadIndex > 0 && codexIndex > loadIndex && resetIndex > codexIndex);
  assert.equal((lifecycleSource.match(/\buseEffect\(/g) || []).length, 3);

  assert.doesNotMatch(
    documentStateSource,
    /openTabsRef|documentStateRef|activeTabIdRef|setOpenTabs|setDocumentState|recordTabMutation/,
  );
  assert.doesNotMatch(
    `${lifecycleSource}\n${configActionsSource}`,
    /aiRequestContextsRef|openTabsRef|documentStateRef|liveRevisionByTabRef/,
  );
  assert.doesNotMatch(appBody, /bridge\.getAiConfig|bridge\.saveAiConfig/);
  assert.doesNotMatch(appBody, /const updateDocumentAiStateForKey = useCallback/);
  assert.match(
    appBody,
    /migrateAiRequestDocumentKey\(previousDocumentKey, documentRuntimeKey\(result\.path, targetTab\.id\)\)/,
  );
});
