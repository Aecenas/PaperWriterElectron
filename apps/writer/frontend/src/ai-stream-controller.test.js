import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AI_ELAPSED_INTERVAL_MS,
  AI_STREAM_FLUSH_INTERVAL_MS,
  createAiStreamEventHandlers,
  createAiStreamRegistry,
  subscribeAiStreamEvents,
  updateAiElapsedStates,
} from "./controllers/index.js";

function createTimerHost() {
  let nextId = 0;
  const pending = new Map();
  const cleared = [];
  return {
    cleared,
    clearTimeout(id) {
      cleared.push(id);
      pending.delete(id);
    },
    pending,
    run(id) {
      const timer = pending.get(id);
      pending.delete(id);
      timer?.callback();
    },
    setTimeout(callback, delay) {
      const id = ++nextId;
      pending.set(id, { callback, delay });
      return id;
    },
  };
}

function createStateHarness(timerHost = createTimerHost()) {
  const optimizeByKey = new Map();
  const chatByKey = new Map();
  const statuses = [];
  const registry = createAiStreamRegistry({ timerHost });
  const updateOptimizeStateForKey = (documentKey, updater) => {
    const previous = optimizeByKey.get(documentKey) || {
      output: "",
      status: "streaming",
      error: "",
    };
    optimizeByKey.set(
      documentKey,
      typeof updater === "function" ? updater(previous) : { ...previous, ...updater },
    );
  };
  const updateChatStateForKey = (documentKey, updater) => {
    const previous = chatByKey.get(documentKey) || {
      status: "streaming",
      error: "",
      messages: [],
    };
    chatByKey.set(
      documentKey,
      typeof updater === "function" ? updater(previous) : { ...previous, ...updater },
    );
  };
  const handlers = createAiStreamEventHandlers({
    now: () => 2_000,
    registry,
    showStatus: (...status) => statuses.push(status),
    updateChatStateForKey,
    updateOptimizeStateForKey,
  });
  return {
    chatByKey,
    handlers,
    optimizeByKey,
    registry,
    statuses,
    timerHost,
    updateChatStateForKey,
    updateOptimizeStateForKey,
  };
}

test("one 50ms timer per context is cleared before terminal tail chunks are flushed", () => {
  const harness = createStateHarness();
  harness.registry.startRequest({
    documentKey: "tab:letter-a",
    kind: "optimize",
    promptTokenEstimate: 4,
    requestId: "request-a",
    startedAt: 1_000,
  });

  assert.equal(harness.handlers.handleChunk({ requestId: "request-a", delta: "尾" }), true);
  assert.equal(harness.handlers.handleChunk({ requestId: "request-a", delta: "块" }), true);
  assert.equal(harness.timerHost.pending.size, 1);
  assert.equal([...harness.timerHost.pending.values()][0].delay, AI_STREAM_FLUSH_INTERVAL_MS);

  assert.equal(harness.handlers.handleDone({ requestId: "request-a", usage: {} }), true);
  assert.equal(harness.timerHost.pending.size, 0);
  assert.deepEqual(harness.timerHost.cleared, [1]);
  assert.equal(harness.optimizeByKey.get("tab:letter-a").output, "尾块");
  assert.equal(harness.optimizeByKey.get("tab:letter-a").status, "done");
  assert.equal(harness.registry.hasContext("request-a"), false);
  assert.equal(harness.registry.getActiveId(), "");
  assert.deepEqual(harness.statuses, [["AI 优化结果已生成", "success"]]);
});

test("a late old terminal updates only its document and cannot clear the newer active request", () => {
  const harness = createStateHarness();
  harness.registry.startRequest({
    documentKey: "tab:old",
    kind: "optimize",
    requestId: "old-request",
    startedAt: 1_000,
  });
  harness.registry.clearActive();
  harness.registry.startRequest({
    assistantId: "assistant-new",
    documentKey: "tab:new",
    kind: "chat",
    requestId: "new-request",
    startedAt: 1_500,
  });

  assert.equal(harness.handlers.handleChunk({ requestId: "old-request", delta: "旧结果" }), true);
  assert.equal(harness.handlers.handleDone({ requestId: "old-request", usage: {} }), true);
  assert.equal(harness.optimizeByKey.get("tab:old").output, "旧结果");
  assert.equal(harness.registry.getActiveId(), "new-request");
  assert.equal(harness.registry.hasContext("new-request"), true);
  assert.equal(harness.registry.hasContext("old-request"), false);

  const statusCount = harness.statuses.length;
  assert.equal(harness.handlers.handleDone({ requestId: "old-request", usage: {} }), false);
  assert.equal(harness.handlers.handleChunk({ requestId: "missing", delta: "ignored" }), false);
  assert.equal(harness.statuses.length, statusCount);
});

test("Stop only cancels; the aborted terminal preserves partial output and retires identity", () => {
  const harness = createStateHarness();
  harness.registry.startRequest({
    documentKey: "path:c:\\letter.letterpaper",
    kind: "optimize",
    requestId: "request-stop",
    startedAt: 1_000,
  });
  harness.handlers.handleChunk({ requestId: "request-stop", delta: "已生成部分" });
  const canceled = [];

  assert.equal(
    harness.registry.cancelActive((requestId) => canceled.push(requestId)),
    "request-stop",
  );
  assert.deepEqual(canceled, ["request-stop"]);
  assert.equal(harness.registry.hasContext("request-stop"), true);
  assert.equal(harness.registry.getActiveId(), "request-stop");

  assert.equal(
    harness.handlers.handleError({
      requestId: "request-stop",
      aborted: true,
      message: "已停止生成",
    }),
    "optimize",
  );
  assert.deepEqual(harness.optimizeByKey.get("path:c:\\letter.letterpaper"), {
    output: "已生成部分",
    status: "ready",
    error: "",
    elapsedSeconds: 1,
  });
  assert.equal(harness.registry.hasContext("request-stop"), false);
  assert.equal(harness.registry.getActiveId(), "");
  assert.deepEqual(harness.statuses.at(-1), ["已停止生成", "success"]);
});

test("chat terminals target the captured document and assistant without touching peer messages", () => {
  const harness = createStateHarness();
  harness.chatByKey.set("tab:chat", {
    status: "streaming",
    error: "",
    messages: [
      { id: "assistant-peer", content: "保留", status: "done" },
      { id: "assistant-target", content: "", status: "streaming" },
    ],
  });
  harness.registry.startRequest({
    assistantId: "assistant-target",
    documentKey: "tab:chat",
    kind: "chat",
    promptTokenEstimate: 3,
    requestId: "request-chat",
    startedAt: 1_000,
  });
  harness.handlers.handleChunk({ requestId: "request-chat", delta: "回答" });
  harness.handlers.handleDone({
    requestId: "request-chat",
    usage: { totalTokens: 8, cachedTokens: 2 },
  });

  const chat = harness.chatByKey.get("tab:chat");
  assert.equal(chat.status, "idle");
  assert.deepEqual(chat.messages[0], {
    id: "assistant-peer",
    content: "保留",
    status: "done",
  });
  assert.deepEqual(chat.messages[1], {
    id: "assistant-target",
    content: "回答",
    status: "done",
    elapsedSeconds: 1,
    usage: 8,
    usageEstimated: false,
    cachedTokens: 2,
  });
});

test("start-failure retirement preserves the existing optimize/chat difference and is identity-safe", () => {
  const optimize = createAiStreamRegistry();
  optimize.startRequest({
    documentKey: "tab:optimize",
    kind: "optimize",
    requestId: "optimize-failure",
    startedAt: 100,
  });
  assert.equal(optimize.retireStartFailure("optimize-failure"), true);
  assert.equal(optimize.hasContext("optimize-failure"), false);
  assert.equal(optimize.getActiveId(), "optimize-failure");
  assert.equal(optimize.hasActiveStartedAt(), true);

  const chat = createAiStreamRegistry();
  chat.startRequest({
    assistantId: "assistant-old",
    documentKey: "tab:chat",
    kind: "chat",
    requestId: "chat-failure",
    startedAt: 100,
  });
  assert.equal(chat.retireStartFailure("chat-failure"), true);
  assert.equal(chat.getActiveId(), "");
  assert.equal(chat.hasActiveStartedAt(), true);

  chat.startRequest({
    assistantId: "assistant-late",
    documentKey: "tab:old",
    kind: "chat",
    requestId: "late-failure",
    startedAt: 200,
  });
  chat.startRequest({
    documentKey: "tab:new",
    kind: "optimize",
    requestId: "new-active",
    startedAt: 300,
  });
  assert.equal(chat.retireStartFailure("late-failure"), true);
  assert.equal(chat.getActiveId(), "new-active");
  assert.equal(chat.hasContext("new-active"), true);
});

test("rekey reaches live contexts and cleanup unsubscribes listeners while retaining contexts", () => {
  const timerHost = createTimerHost();
  const harness = createStateHarness(timerHost);
  harness.registry.startRequest({
    documentKey: "tab:unsaved",
    kind: "optimize",
    requestId: "request-save-as",
    startedAt: 1_000,
  });
  assert.equal(
    harness.registry.rekeyDocument(
      "tab:unsaved",
      "path:c:\\saved.letterpaper",
    ),
    true,
  );
  harness.handlers.handleChunk({ requestId: "request-save-as", delta: "保存后结果" });

  const unsubscribed = [];
  const listeners = {};
  const aiBridge = {
    onAiChunk(handler) {
      listeners.chunk = handler;
      return () => unsubscribed.push("chunk");
    },
    onAiDone(handler) {
      listeners.done = handler;
      return () => unsubscribed.push("done");
    },
    onAiError(handler) {
      listeners.error = handler;
      return () => unsubscribed.push("error");
    },
  };
  const cleanup = subscribeAiStreamEvents({
    aiBridge,
    handlers: harness.handlers,
    registry: harness.registry,
  });
  assert.equal(typeof listeners.chunk, "function");
  cleanup();
  assert.deepEqual(unsubscribed, ["chunk", "done", "error"]);
  assert.equal(timerHost.pending.size, 0);
  assert.equal(harness.registry.hasContext("request-save-as"), true);

  harness.handlers.handleDone({ requestId: "request-save-as", usage: {} });
  assert.equal(
    harness.optimizeByKey.get("path:c:\\saved.letterpaper").output,
    "保存后结果",
  );
});

test("elapsed updates retain the 100ms cadence and captured document identities", () => {
  const harness = createStateHarness();
  harness.chatByKey.set("tab:chat", {
    status: "streaming",
    error: "",
    messages: [{ id: "assistant", elapsedSeconds: 0 }],
  });
  harness.registry.startRequest({
    assistantId: "assistant",
    documentKey: "tab:chat",
    kind: "chat",
    requestId: "chat-elapsed",
    startedAt: 1_000,
  });
  harness.registry.clearActive();
  harness.registry.startRequest({
    documentKey: "tab:optimize",
    kind: "optimize",
    requestId: "optimize-elapsed",
    startedAt: 1_500,
  });

  updateAiElapsedStates({
    now: 2_000,
    registry: harness.registry,
    updateChatStateForKey: harness.updateChatStateForKey,
    updateOptimizeStateForKey: harness.updateOptimizeStateForKey,
  });
  assert.equal(AI_ELAPSED_INTERVAL_MS, 100);
  assert.equal(harness.chatByKey.get("tab:chat").messages[0].elapsedSeconds, 1);
  assert.equal(harness.optimizeByKey.get("tab:optimize").elapsedSeconds, 0.5);
});

test("App composes opaque stream hooks at the original anchors without raw registry state", async () => {
  const [
    appSource,
    registrySource,
    lifecycleSource,
    requestActionsSource,
  ] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(new URL("./controllers/ai-stream-registry.js", import.meta.url), "utf8"),
    readFile(new URL("./controllers/ai-stream-lifecycle.js", import.meta.url), "utf8"),
    readFile(new URL("./controllers/ai-request-actions.js", import.meta.url), "utf8"),
  ]);
  const appBody = appSource.slice(appSource.indexOf("export default function App()"));
  const orderedMarkers = [
    "useAiStreamRegistry();",
    "const aiPreviousSidebarsRef = useRef",
    "usePromiseDialogResolverRefs();",
    "useAiStreamChatMessagesSlot(aiStreamRegistry);",
    "rightSplitEditor.setEditable(!rightSplitReadOnly)",
    "useAiElapsedLifecycle({",
    "useAiStreamEventsLifecycle({",
    "useAiRequestActions({",
    "const handleAiChatPresetSelect = useCallback",
    "useAiApplyPreviewActions({",
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const index = appBody.indexOf(marker);
    assert.ok(index > previous, `${marker} must remain after its preceding stream anchor`);
    previous = index;
  }

  assert.doesNotMatch(
    appBody,
    /aiRequestIdRef|aiStartedAtRef|aiPromptTokenEstimateRef|aiRequestMetaRef|aiRequestContextsRef|aiChatAssistantIdRef|aiChatContextRef|aiChatMessagesRef/,
  );
  assert.doesNotMatch(
    appBody,
    /bridge\.generateAi|bridge\.onAiChunk|bridge\.onAiDone|bridge\.onAiError/,
  );
  assert.doesNotMatch(
    requestActionsSource,
    /researchRoot|researchEntries|librarySources|activeLibraryItem|pendingCitationPage/,
  );
  assert.equal((requestActionsSource.match(/registry\.retireStartFailure\(requestId\)/g) || []).length, 2);
  assert.match(requestActionsSource, /codexScope: \{ \.\.\.CODEX_DOCUMENT_ONLY_SCOPE \}/);
  assert.match(lifecycleSource, /registry\.finishContext\(payload\?\.requestId/);

  const registry = createAiStreamRegistry();
  for (const rawName of ["contexts", "contextMap", "activeRef", "requestIdRef"]) {
    assert.equal(rawName in registry, false);
  }
  assert.match(registrySource, /const contexts = new Map\(\)/);
});
