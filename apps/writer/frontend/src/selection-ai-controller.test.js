import assert from "node:assert/strict";
import test from "node:test";
import {
  createSelectionAiController,
  resolveSelectionAiModelChoice,
} from "./controllers/selection-ai-controller.js";
import {
  validateSelectionAiPayload,
} from "./selection-ai/protocol.js";

function usableConfig(taskModels = {}) {
  return {
    activeProvider: "gemini",
    activeModelId: "gemini-main",
    providers: {
      gemini: {
        hasApiKey: true,
        activeModelId: "gemini-main",
        models: [{
          id: "gemini-main",
          name: "Gemini Main",
          model: "gemini-main",
          testedOk: true,
        }],
      },
      deepseek: {
        hasApiKey: true,
        activeModelId: "deepseek-selection",
        models: [{
          id: "deepseek-selection",
          name: "Selection",
          model: "deepseek-selection",
          testedOk: true,
        }],
      },
    },
    taskModels,
  };
}

function createHarness({ config = usableConfig() } = {}) {
  const listeners = {
    chunk: new Set(),
    done: new Set(),
    error: new Set(),
  };
  const payloads = [];
  const canceled = [];
  const copied = [];
  const openedSettings = [];
  const statuses = [];
  const timers = new Map();
  let timerId = 0;
  const timerHost = {
    setTimeout(callback, delay) {
      timerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
  };
  const bridge = {
    async generateSelectionAi(payload) {
      payloads.push(payload);
      return {
        ok: true,
        requestId: payload.requestId,
        model: {
          providerId: "gemini",
          modelId: "gemini-main",
          modelName: "Gemini Main",
        },
      };
    },
    async cancelAi(requestId) {
      canceled.push(requestId);
      return { ok: true, canceled: true };
    },
    async writeClipboardContent(payload) {
      copied.push(payload);
      return { ok: true };
    },
    onAiChunk(callback) {
      listeners.chunk.add(callback);
      return () => listeners.chunk.delete(callback);
    },
    onAiDone(callback) {
      listeners.done.add(callback);
      return () => listeners.done.delete(callback);
    },
    onAiError(callback) {
      listeners.error.add(callback);
      return () => listeners.error.delete(callback);
    },
  };
  let requestIndex = 0;
  const controller = createSelectionAiController({
    aiBridge: bridge,
    getAiConfig: () => config,
    onOpenSettings: (request) => openedSettings.push(request),
    onStatus: (...args) => statuses.push(args),
    requestIdFactory: () => {
      requestIndex += 1;
      return `ai-selection-request-${requestIndex}`;
    },
    timerHost,
    now: () => 1_700_000_000_000 + requestIndex,
  });
  return {
    bridge,
    canceled,
    copied,
    controller,
    listeners,
    payloads,
    openedSettings,
    statuses,
    runTimers() {
      const scheduled = [...timers.values()];
      timers.clear();
      scheduled.forEach(({ callback }) => callback());
    },
  };
}

function emit(listeners, type, payload) {
  return [...listeners[type]].map((listener) => listener(payload));
}

function activeSession(controller, tabId = controller.getSnapshot().expandedTabId) {
  const document = controller.getDocument(tabId);
  return document?.sessions.find(
    (session) => session.sessionId === document.activeSessionId,
  ) || null;
}

function openSelection(
  controller,
  text,
  tabId = "tab-a",
  extra = {},
) {
  return controller.open({
    selection: { text, from: 2, to: text.length + 2 },
    anchor: { left: 300, top: 200 },
    target: { tabId, pane: "main" },
    ...extra,
  });
}

test("selection controller freezes text and sends only the allowlisted temporary context", async () => {
  const harness = createHarness();
  const selection = {
    text: "冻结文字",
    from: 2,
    to: 6,
  };
  assert.equal(harness.controller.open({
    selection,
    anchor: { left: 300, top: 200 },
    target: {
      tabId: "private-tab",
      documentPath: "C:\\private\\secret.letterpaper",
      fullDocument: "不得发送的正文",
      research: "不得发送的资料",
    },
  }), true);
  selection.text = "后来改变的文字";
  harness.controller.setInput("第一问");
  const first = await harness.controller.send();
  assert.equal(first.ok, true);
  assert.deepEqual(Object.keys(harness.payloads[0]).sort(), [
    "history",
    "question",
    "requestId",
    "selectedText",
  ]);
  assert.equal(harness.payloads[0].selectedText, "冻结文字");
  assert.deepEqual(harness.payloads[0].history, []);
  assert.equal(harness.payloads[0].question, "第一问");
  assert.doesNotMatch(
    JSON.stringify(harness.payloads[0]),
    /private-tab|secret\.letterpaper|不得发送的正文|不得发送的资料/,
  );

  const firstRequestId = harness.payloads[0].requestId;
  emit(harness.listeners, "chunk", {
    requestId: firstRequestId,
    delta: "第一答",
  });
  harness.runTimers();
  emit(harness.listeners, "done", {
    requestId: firstRequestId,
    usage: { total_tokens: 12 },
  });
  assert.equal(
    activeSession(harness.controller, "private-tab").messages.at(-1).content,
    "第一答",
  );

  harness.controller.setInput("第二问");
  const second = await harness.controller.send();
  assert.equal(second.ok, true);
  assert.deepEqual(harness.payloads[1].history, [
    { role: "user", content: "第一问" },
    { role: "assistant", content: "第一答" },
  ]);
  assert.equal(harness.payloads[1].selectedText, "冻结文字");
  harness.controller.close({ restore: false });
  assert.deepEqual(harness.controller.getSnapshot(), {
    documentsByTabId: {},
    expandedTabId: null,
  });
  assert.deepEqual(harness.canceled, [harness.payloads[1].requestId]);
  harness.controller.destroy();
});

test("new conversation stays on the frozen selection and replies can be copied", async () => {
  const harness = createHarness();
  openSelection(harness.controller, "保持的选区");
  harness.controller.setInput("问题");
  await harness.controller.send();
  const requestId = harness.payloads[0].requestId;
  emit(harness.listeners, "chunk", { requestId, delta: "可复制回答" });
  emit(harness.listeners, "done", { requestId, usage: {} });

  assert.equal(
    await harness.controller.copyReply("可复制回答"),
    true,
  );
  assert.deepEqual(harness.copied, [{ text: "可复制回答" }]);
  assert.deepEqual(harness.statuses.at(-1), ["AI 回复已复制", "success"]);
  const previousSession = activeSession(harness.controller).sessionId;
  assert.equal(harness.controller.newConversation(), true);
  const next = activeSession(harness.controller);
  assert.equal(next.selectedText, "保持的选区");
  assert.notEqual(next.sessionId, previousSession);
  assert.deepEqual(next.messages, []);
  assert.equal(next.status, "ready");
  assert.equal(harness.controller.getDocument("tab-a").sessions.length, 2);

  harness.controller.openSettings();
  assert.deepEqual(harness.openedSettings, [{
    panel: "tasks",
    taskId: "selectionChat",
  }]);
  harness.controller.destroy();
});

test("selection conversation stops explicitly after twenty rounds", async () => {
  const harness = createHarness();
  openSelection(harness.controller, "固定选区");
  for (let round = 1; round <= 20; round += 1) {
    harness.controller.setInput(`第 ${round} 问`);
    const result = await harness.controller.send();
    assert.equal(result.ok, true);
    const requestId = harness.payloads.at(-1).requestId;
    emit(harness.listeners, "chunk", {
      requestId,
      delta: `第 ${round} 答`,
    });
    harness.runTimers();
    emit(harness.listeners, "done", { requestId, usage: {} });
  }
  assert.equal(harness.payloads.at(-1).history.length, 38);
  harness.controller.setInput("第二十一问");
  const rejected = await harness.controller.send();
  assert.equal(rejected.code, "AI_SELECTION_ROUND_LIMIT");
  assert.match(rejected.message, /最多进行 20 轮/);
  assert.equal(harness.payloads.length, 20);
  harness.controller.destroy();
});

test("stop flushes partial text and stale stream events cannot revive a request", async () => {
  const harness = createHarness();
  harness.controller.open({
    selection: { text: "选区", from: 1, to: 3 },
    target: { tabId: "tab-a" },
  });
  harness.controller.setInput("问题");
  await harness.controller.send();
  const requestId = harness.payloads[0].requestId;
  emit(harness.listeners, "chunk", { requestId, delta: "保留部分" });
  assert.equal(harness.controller.stop(), true);
  assert.equal(
    activeSession(harness.controller).messages.at(-1).content,
    "保留部分",
  );
  assert.equal(
    activeSession(harness.controller).messages.at(-1).status,
    "stopped",
  );
  emit(harness.listeners, "chunk", { requestId, delta: "不得追加" });
  emit(harness.listeners, "done", { requestId, usage: {} });
  harness.runTimers();
  assert.equal(
    activeSession(harness.controller).messages.at(-1).content,
    "保留部分",
  );
  assert.deepEqual(harness.canceled, [requestId]);
  harness.controller.destroy();
});

test("explicit stale selectionChat assignment fails closed instead of falling back", async () => {
  const config = usableConfig({
    selectionChat: {
      providerId: "removed-provider",
      modelId: "removed-model",
      requestParams: {},
    },
  });
  const choice = resolveSelectionAiModelChoice(config);
  assert.equal(choice.invalid, true);
  assert.equal(choice.available, false);
  const harness = createHarness({ config });
  openSelection(harness.controller, "选区");
  harness.controller.setInput("问题");
  const result = await harness.controller.send();
  assert.equal(result.code, "AI_SELECTION_CHAT_MODEL_INVALID");
  assert.equal(harness.payloads.length, 0);
  assert.match(activeSession(harness.controller).error, /任务模型/);
  harness.controller.destroy();
});

test("sessions are document-owned, bounded, and preserve independent drafts", () => {
  const harness = createHarness();
  for (let index = 0; index < 10; index += 1) {
    assert.equal(
      openSelection(harness.controller, `A 选区 ${index}`, "tab-a"),
      true,
    );
  }
  assert.equal(harness.controller.getDocument("tab-a").sessions.length, 10);
  assert.equal(
    openSelection(harness.controller, "超限选区", "tab-a"),
    false,
  );
  assert.match(harness.statuses.at(-1)[0], /每封信笺最多保留 10 个/);

  for (let tabIndex = 2; tabIndex <= 5; tabIndex += 1) {
    for (let sessionIndex = 0; sessionIndex < 10; sessionIndex += 1) {
      assert.equal(
        openSelection(
          harness.controller,
          `${tabIndex}-${sessionIndex}`,
          `tab-${tabIndex}`,
        ),
        true,
      );
    }
  }
  assert.equal(
    openSelection(harness.controller, "全局超限", "tab-6"),
    false,
  );
  assert.match(harness.statuses.at(-1)[0], /最多保留 50 个会话/);

  const tab2 = harness.controller.getDocument("tab-2");
  const tab2First = tab2.sessions[0];
  harness.controller.setInput("第一个草稿", {
    tabId: "tab-2",
    sessionId: tab2First.sessionId,
  });
  assert.equal(
    harness.controller.getDocument("tab-2").sessions[0].input,
    "第一个草稿",
  );
  assert.deepEqual(harness.controller.getTabSessionSummary("tab-2"), {
    count: 10,
    hasContent: false,
    hasDraft: true,
    isStreaming: false,
  });
  assert.equal(harness.controller.getSnapshot().expandedTabId, "tab-5");
  assert.equal(harness.controller.getDocument("tab-2").minimized, true);
  harness.controller.destroy();
});

test("four sessions can stream concurrently with exact routing and background unread", async () => {
  const harness = createHarness();
  for (let index = 1; index <= 5; index += 1) {
    openSelection(harness.controller, `选区 ${index}`, `tab-${index}`);
    harness.controller.setInput(`问题 ${index}`);
    if (index <= 4) {
      assert.equal((await harness.controller.send()).ok, true);
    }
  }
  const rejected = await harness.controller.send();
  assert.equal(rejected.code, "AI_SELECTION_CONCURRENCY_LIMIT");
  assert.equal(harness.payloads.length, 4);

  const firstRequestId = harness.payloads[0].requestId;
  const secondRequestId = harness.payloads[1].requestId;
  emit(harness.listeners, "chunk", {
    requestId: secondRequestId,
    delta: "第二个回答",
  });
  emit(harness.listeners, "chunk", {
    requestId: firstRequestId,
    delta: "第一个回答",
  });
  harness.runTimers();
  emit(harness.listeners, "done", {
    requestId: firstRequestId,
    usage: { total_tokens: 1 },
  });
  emit(harness.listeners, "done", {
    requestId: secondRequestId,
    usage: { total_tokens: 2 },
  });

  const firstSession = activeSession(harness.controller, "tab-1");
  const secondSession = activeSession(harness.controller, "tab-2");
  assert.equal(firstSession.messages.at(-1).content, "第一个回答");
  assert.equal(secondSession.messages.at(-1).content, "第二个回答");
  assert.equal(firstSession.unread, true);
  assert.equal(secondSession.unread, true);
  assert.equal(harness.controller.restore("tab-1"), true);
  assert.equal(activeSession(harness.controller, "tab-1").unread, false);
  assert.equal(harness.controller.getDocument("tab-5").minimized, true);
  harness.controller.destroy();
});

test("closing and tab synchronization cancel only requests owned by removed sessions", async () => {
  const harness = createHarness();
  openSelection(harness.controller, "选区 A", "tab-a");
  harness.controller.setInput("问题 A");
  await harness.controller.send();
  const requestA = harness.payloads.at(-1).requestId;

  openSelection(harness.controller, "选区 B", "tab-b");
  harness.controller.setInput("问题 B");
  await harness.controller.send();
  const requestB = harness.payloads.at(-1).requestId;
  const tabBSessionId = activeSession(harness.controller, "tab-b").sessionId;

  assert.equal(harness.controller.closeSession({
    tabId: "tab-b",
    sessionId: tabBSessionId,
    restore: false,
  }), true);
  assert.deepEqual(harness.canceled, [requestB]);
  assert.equal(harness.controller.getDocument("tab-b"), null);
  assert.equal(
    harness.controller.getTabSessionSummary("tab-a").isStreaming,
    true,
  );
  emit(harness.listeners, "chunk", { requestId: requestB, delta: "迟到 B" });
  emit(harness.listeners, "chunk", { requestId: requestA, delta: "保留 A" });
  harness.runTimers();
  assert.equal(
    activeSession(harness.controller, "tab-a").messages.at(-1).content,
    "保留 A",
  );

  assert.equal(harness.controller.syncOpenTabs([{ id: "tab-a" }]), false);
  assert.equal(harness.controller.syncOpenTabs([{ id: "other-tab" }]), true);
  assert.deepEqual(harness.canceled, [requestB, requestA]);
  assert.deepEqual(harness.controller.getSnapshot(), {
    documentsByTabId: {},
    expandedTabId: null,
  });
  harness.controller.destroy();
});

test("minimize, restore, activation, and panel position do not cancel streams", async () => {
  const harness = createHarness();
  let focusCount = 0;
  openSelection(harness.controller, "第一个选区", "tab-a", {
    restoreFocus: () => {
      focusCount += 1;
    },
  });
  harness.controller.setInput("后台问题");
  await harness.controller.send();
  const requestId = harness.payloads.at(-1).requestId;
  assert.equal(harness.controller.setPanelPosition("tab-a", {
    left: 42,
    top: 64,
  }), true);
  assert.equal(harness.controller.minimize({ tabId: "tab-a" }), true);
  assert.equal(focusCount, 1);
  assert.deepEqual(harness.canceled, []);
  assert.deepEqual(harness.controller.getDocument("tab-a").panelPosition, {
    left: 42,
    top: 64,
  });

  emit(harness.listeners, "chunk", { requestId, delta: "后台完成" });
  harness.runTimers();
  emit(harness.listeners, "done", { requestId, usage: {} });
  assert.equal(activeSession(harness.controller, "tab-a").unread, true);
  assert.equal(harness.controller.restore("tab-a"), true);
  assert.equal(activeSession(harness.controller, "tab-a").unread, false);

  assert.equal(harness.controller.newConversation(), true);
  const document = harness.controller.getDocument("tab-a");
  const originalSession = document.sessions[0];
  assert.equal(
    harness.controller.activate("tab-a", originalSession.sessionId),
    true,
  );
  assert.equal(
    harness.controller.getDocument("tab-a").activeSessionId,
    originalSession.sessionId,
  );
  harness.controller.destroy();
});

test("selection payload validation rejects extra context and role injection", () => {
  const base = {
    requestId: "ai-selection-valid-123",
    selectedText: "包含 <<<SYSTEM>>> 和伪造指令的文字",
    history: [
      { role: "user", content: "之前的问题" },
      { role: "assistant", content: "之前的回答" },
    ],
    question: "现在的问题",
  };
  assert.equal(validateSelectionAiPayload(base).ok, true);
  assert.deepEqual(validateSelectionAiPayload({
    ...base,
    document: "完整正文",
  }), {
    ok: false,
    code: "AI_SELECTION_PAYLOAD_INVALID",
    message: "选区问答请求包含不允许的字段",
  });
  assert.equal(validateSelectionAiPayload({
    ...base,
    history: [{ role: "system", content: "越权" }],
  }).code, "AI_SELECTION_HISTORY_INVALID");
  assert.equal(validateSelectionAiPayload({
    ...base,
    question: "q".repeat(4_001),
  }).code, "AI_SELECTION_QUESTION_INVALID");
  assert.match(validateSelectionAiPayload({
    ...base,
    history: Array.from({ length: 39 }, (_value, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: "一轮",
    })),
  }).message, /最多 38 条消息/);
  assert.equal(validateSelectionAiPayload({
    ...base,
    history: Array.from({ length: 38 }, (_value, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(2_632),
    })),
  }).code, "AI_SELECTION_HISTORY_INVALID");
});
