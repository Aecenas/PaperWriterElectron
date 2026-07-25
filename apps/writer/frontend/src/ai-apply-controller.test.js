import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAiApplyPreviewActions,
  createAiApplyResolutionActions,
} from "./controllers/ai-apply-actions.js";
import {
  resetAiApplyTransientState,
  subscribeAiApplyPreview,
  subscribeManualAiApplyTargeting,
} from "./controllers/ai-apply-lifecycle.js";

function createEditor(doc = { type: "doc" }, runResult = true) {
  const transactionCalls = [];
  const chain = {
    focus() {
      transactionCalls.push(["focus"]);
      return chain;
    },
    insertContentAt(range, content, options) {
      transactionCalls.push([
        "insertContentAt",
        range,
        content,
        options,
      ]);
      return chain;
    },
    run() {
      transactionCalls.push(["run"]);
      return runResult;
    },
  };
  return {
    editor: {
      state: { doc },
      chain() {
        transactionCalls.push(["chain"]);
        return chain;
      },
    },
    transactionCalls,
  };
}

function createEventHost() {
  const listeners = new Map();
  const removals = [];
  return {
    listeners,
    removals,
    addEventListener(type, listener, capture) {
      listeners.set(type, { listener, capture });
    },
    removeEventListener(type, listener, capture) {
      removals.push({ type, listener, capture });
      const current = listeners.get(type);
      if (
        current?.listener === listener
        && current.capture === capture
      ) {
        listeners.delete(type);
      }
    },
  };
}

function createClassList() {
  const values = new Set();
  return {
    add(value) {
      values.add(value);
    },
    contains(value) {
      return values.has(value);
    },
    remove(value) {
      values.delete(value);
    },
    values,
  };
}

test("automatic apply fingerprints resolution, preview, and one confirm transaction", async () => {
  const doc = { type: "doc", revision: 1 };
  const { editor, transactionCalls } = createEditor(doc);
  const manifests = [];
  const buildManifest = (currentDoc) => {
    assert.equal(currentDoc, doc);
    const manifest = {
      documentFingerprint: "stable-fingerprint",
      blocks: [{ id: "p:1", from: 1, to: 5 }],
      pass: manifests.length + 1,
    };
    manifests.push(manifest);
    return manifest;
  };
  const statuses = [];
  const stateChanges = [];
  let preview = null;
  let resolverInput = null;
  const block = { type: "paragraph", text: "优化文本" };
  const blocks = [block];
  const optimizationContext = { previous: "", next: "" };
  const previewActions = createAiApplyPreviewActions({
    aiApplyPreview: null,
    buildManifest,
    editor,
    findOverlappingComments: () => [{ id: "c1" }, { id: "c2" }],
    getActiveDocumentSnapshot: () => ({
      document: { comments: [{ id: "saved-comment" }] },
    }),
    getComments: (currentEditor, fallback) => {
      assert.equal(currentEditor, editor);
      assert.deepEqual(fallback, [{ id: "saved-comment" }]);
      return [{ id: "live-comment" }];
    },
    now: () => 42,
    setAiApplyPreview(value) {
      stateChanges.push(["preview", value]);
      preview = value;
    },
    setManualAiApply(value) {
      stateChanges.push(["manual", value]);
    },
    setManualFallbackAiBlockIndexes() {},
    showStatus(...args) {
      statuses.push(args);
    },
    summarizeTarget: () => "第 1 段",
  });
  const inFlightRef = { current: false };
  const applyingIndexes = [];
  const resolutionActions = createAiApplyResolutionActions({
    activeTabReadOnly: false,
    aiApplyInFlightRef: inFlightRef,
    aiApplyPreview: null,
    aiBridge: { resolveAiApply: "resolver-bridge" },
    aiStatus: "done",
    applyingAiBlockIndex: -1,
    beginManualAiApply() {
      assert.fail("successful automatic apply must not fall back");
    },
    buildManifest,
    buildOptimizationContext(currentBlocks, blockIndex) {
      assert.equal(currentBlocks, blocks);
      assert.equal(blockIndex, 0);
      return optimizationContext;
    },
    editor,
    getActiveDocumentSnapshot: () => ({
      document: { comments: [{ id: "saved-comment" }] },
    }),
    manualAiApply: null,
    manualFallbackAiBlockIndexes: [],
    async resolveDirectApply(input) {
      resolverInput = input;
      assert.equal(input.getCurrentDocument(), doc);
      return {
        ok: true,
        manifest: input.manifest,
        operation: {
          action: "replace",
          content: [{ type: "paragraph", content: [] }],
          from: 1,
          targetBlockIds: ["p:1"],
          to: 5,
        },
      };
    },
    setApplyingAiBlockIndex(value) {
      applyingIndexes.push(value);
    },
    setManualAiApply() {},
    showConfirmDialog() {
      assert.fail("automatic apply must not open the manual dialog");
    },
    showStatus(...args) {
      statuses.push(args);
    },
    stageAiApplyPreview: previewActions.stageAiApplyPreview,
  });

  await resolutionActions.handleApplyAiBlock(block, 0, blocks);

  assert.equal(manifests.length, 2);
  assert.equal(resolverInput.resolver, "resolver-bridge");
  assert.equal(resolverInput.manifest, manifests[0]);
  assert.equal(resolverInput.selectedAiBlock, block);
  assert.equal(resolverInput.optimizationContext, optimizationContext);
  assert.equal(transactionCalls.length, 0);
  assert.deepEqual(applyingIndexes, [0, -1]);
  assert.equal(inFlightRef.current, false);
  assert.equal(preview.id, "42-0");
  assert.equal(preview.commentCount, 2);
  assert.equal(preview.targetSummary, "第 1 段");
  assert.deepEqual(
    stateChanges.map(([type]) => type),
    ["manual", "preview"],
  );

  const confirmActions = createAiApplyPreviewActions({
    aiApplyPreview: preview,
    buildManifest,
    editor,
    findOverlappingComments: () => [],
    getActiveDocumentSnapshot: () => ({ document: { comments: [] } }),
    getComments: () => [],
    setAiApplyPreview(value) {
      preview = value;
    },
    setManualAiApply() {},
    setManualFallbackAiBlockIndexes() {},
    showStatus(...args) {
      statuses.push(args);
    },
  });
  confirmActions.confirmAiApplyPreview();

  assert.equal(manifests.length, 3);
  assert.equal(preview, null);
  assert.deepEqual(transactionCalls, [
    ["chain"],
    ["focus"],
    [
      "insertContentAt",
      { from: 1, to: 5 },
      [{ type: "paragraph", content: [] }],
      { updateSelection: true },
    ],
    ["run"],
  ]);
  assert.deepEqual(statuses.at(-1), [
    "已应用修改；按 Ctrl+Z 可完整撤销",
    "success",
  ]);
});

test("the in-flight ref blocks same-tick double apply and always clears", async () => {
  const { editor } = createEditor();
  let releaseResolver;
  const resolverResult = new Promise((resolve) => {
    releaseResolver = resolve;
  });
  let resolverCalls = 0;
  let stageCalls = 0;
  const applyingIndexes = [];
  const inFlightRef = { current: false };
  const manifest = {
    blocks: [{ id: "p:1", from: 1, to: 2 }],
    documentFingerprint: "fingerprint",
  };
  const actions = createAiApplyResolutionActions({
    activeTabReadOnly: false,
    aiApplyInFlightRef: inFlightRef,
    aiApplyPreview: null,
    aiStatus: "done",
    applyingAiBlockIndex: -1,
    beginManualAiApply() {
      assert.fail("resolved request must not fall back");
    },
    buildManifest: () => manifest,
    buildOptimizationContext: () => ({}),
    editor,
    manualAiApply: null,
    manualFallbackAiBlockIndexes: [],
    resolveDirectApply() {
      resolverCalls += 1;
      return resolverResult;
    },
    setApplyingAiBlockIndex(value) {
      applyingIndexes.push(value);
    },
    setManualAiApply() {},
    showConfirmDialog() {},
    showStatus() {},
    stageAiApplyPreview() {
      stageCalls += 1;
      return { ok: true };
    },
  });

  const first = actions.handleApplyAiBlock({ text: "A" }, 3, []);
  const second = actions.handleApplyAiBlock({ text: "A" }, 3, []);
  assert.equal(inFlightRef.current, true);
  assert.equal(resolverCalls, 1);
  assert.deepEqual(applyingIndexes, [3]);

  releaseResolver({
    ok: true,
    manifest,
    operation: { action: "replace", from: 1, to: 2 },
  });
  await Promise.all([first, second]);

  assert.equal(stageCalls, 1);
  assert.equal(inFlightRef.current, false);
  assert.deepEqual(applyingIndexes, [3, -1]);
});

test("resolver failures fall back to manual and sticky indexes bypass it", async (t) => {
  const cases = [
    {
      name: "unresolved",
      resolveDirectApply: async () => ({ unresolved: true }),
      reason: "未能可靠定位，请选择原文位置",
    },
    {
      name: "non-ok",
      resolveDirectApply: async () => ({ ok: false }),
      reason: "未能可靠定位，请选择原文位置",
    },
    {
      name: "throw",
      resolveDirectApply: async () => {
        throw new Error("offline");
      },
      reason: "定位模型暂时不可用，已切换为手动选择位置",
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const { editor } = createEditor();
      const manualCalls = [];
      const applyingIndexes = [];
      const inFlightRef = { current: false };
      const block = { text: scenario.name };
      const blocks = [block];
      const actions = createAiApplyResolutionActions({
        activeTabReadOnly: false,
        aiApplyInFlightRef: inFlightRef,
        aiApplyPreview: null,
        aiStatus: "done",
        applyingAiBlockIndex: -1,
        beginManualAiApply(...args) {
          manualCalls.push(args);
        },
        buildManifest: () => ({
          documentFingerprint: "fingerprint",
        }),
        buildOptimizationContext: () => ({}),
        editor,
        manualAiApply: null,
        manualFallbackAiBlockIndexes: [],
        resolveDirectApply: scenario.resolveDirectApply,
        setApplyingAiBlockIndex(value) {
          applyingIndexes.push(value);
        },
        setManualAiApply() {},
        showConfirmDialog() {},
        showStatus() {},
        stageAiApplyPreview() {
          assert.fail("failed resolver must not stage");
        },
      });

      await actions.handleApplyAiBlock(block, 7, blocks);

      assert.deepEqual(manualCalls, [
        [block, 7, blocks, scenario.reason],
      ]);
      assert.deepEqual(applyingIndexes, [7, -1]);
      assert.equal(inFlightRef.current, false);
    });
  }

  await t.test("sticky manual fallback", async () => {
    const { editor } = createEditor();
    const block = { text: "fallback" };
    const blocks = [block];
    const manualCalls = [];
    let resolverCalls = 0;
    let manifestCalls = 0;
    const actions = createAiApplyResolutionActions({
      activeTabReadOnly: false,
      aiApplyInFlightRef: { current: false },
      aiApplyPreview: null,
      aiStatus: "done",
      applyingAiBlockIndex: -1,
      beginManualAiApply(...args) {
        manualCalls.push(args);
      },
      buildManifest() {
        manifestCalls += 1;
        return {};
      },
      editor,
      manualAiApply: null,
      manualFallbackAiBlockIndexes: [7],
      async resolveDirectApply() {
        resolverCalls += 1;
        return {};
      },
      setApplyingAiBlockIndex() {
        assert.fail("manual fallback must not show the resolver spinner");
      },
      setManualAiApply() {},
      showConfirmDialog() {},
      showStatus() {},
      stageAiApplyPreview() {},
    });

    await actions.handleApplyAiBlock(block, 7, blocks);

    assert.deepEqual(manualCalls, [[block, 7, blocks]]);
    assert.equal(manifestCalls, 0);
    assert.equal(resolverCalls, 0);
  });
});

test("preview staging reads live comments without mutating and rejects stale targets", () => {
  const { editor, transactionCalls } = createEditor();
  const setCalls = [];
  let commentsFallback = null;
  const resolved = {
    ok: true,
    manifest: { documentFingerprint: "stable" },
    operation: {
      action: "replace",
      from: 4,
      targetBlockIds: ["a", "b"],
      to: 9,
    },
  };
  const actions = createAiApplyPreviewActions({
    aiApplyPreview: null,
    buildManifest: () => ({ documentFingerprint: "stable" }),
    editor,
    findOverlappingComments: (operation, comments) => {
      assert.equal(operation, resolved.operation);
      assert.deepEqual(comments, [{ id: "live" }]);
      return [{ id: "live" }];
    },
    getActiveDocumentSnapshot: () => ({
      document: { comments: [{ id: "snapshot" }] },
    }),
    getComments: (currentEditor, fallback) => {
      assert.equal(currentEditor, editor);
      commentsFallback = fallback;
      return [{ id: "live" }];
    },
    now: () => 9,
    setAiApplyPreview(value) {
      setCalls.push(["preview", value]);
    },
    setManualAiApply(value) {
      setCalls.push(["manual", value]);
    },
    setManualFallbackAiBlockIndexes() {},
    showStatus() {},
    summarizeTarget: () => "目标",
  });

  assert.deepEqual(actions.stageAiApplyPreview(resolved), { ok: true });
  assert.equal(transactionCalls.length, 0);
  assert.deepEqual(commentsFallback, [{ id: "snapshot" }]);
  assert.deepEqual(setCalls.map(([type]) => type), ["manual", "preview"]);
  assert.equal(setCalls[1][1].actionLabel, "替换 2 个连续原文块");
  assert.equal(setCalls[1][1].commentCount, 1);

  let staleSetCalls = 0;
  const staleActions = createAiApplyPreviewActions({
    aiApplyPreview: null,
    buildManifest: () => ({ documentFingerprint: "changed" }),
    editor,
    getActiveDocumentSnapshot: () => {
      assert.fail("stale targets must fail before reading comments");
    },
    setAiApplyPreview() {
      staleSetCalls += 1;
    },
    setManualAiApply() {
      staleSetCalls += 1;
    },
    setManualFallbackAiBlockIndexes() {},
    showStatus() {},
  });
  assert.deepEqual(
    staleActions.stageAiApplyPreview(resolved),
    { ok: false, stale: true },
  );
  assert.equal(staleSetCalls, 0);
  assert.equal(transactionCalls.length, 0);
});

test("cancel never commits and stale confirmation returns to manual targeting", () => {
  const { editor, transactionCalls } = createEditor();
  const preview = {
    block: { text: "proposal" },
    blockIndex: 2,
    blocks: [{ text: "proposal" }],
    resolved: {
      ok: true,
      manifest: { documentFingerprint: "old" },
      operation: { action: "replace", from: 1, to: 2 },
    },
  };
  const previewValues = [];
  const manualCalls = [];
  const statuses = [];
  const actions = createAiApplyPreviewActions({
    aiApplyPreview: preview,
    buildManifest: () => ({ documentFingerprint: "new" }),
    editor,
    getActiveDocumentSnapshot: () => ({ document: { comments: [] } }),
    setAiApplyPreview(value) {
      previewValues.push(value);
    },
    setManualAiApply() {},
    setManualFallbackAiBlockIndexes(updater) {
      updater([]);
    },
    showStatus(...args) {
      statuses.push(args);
    },
  });
  const originalBegin = actions.beginManualAiApply;
  actions.cancelAiApplyPreview();
  assert.deepEqual(previewValues, [null]);
  assert.equal(transactionCalls.length, 0);
  assert.deepEqual(statuses.at(-1), [
    "已取消这次修改，正文保持不变",
    "success",
  ]);

  const staleActions = createAiApplyPreviewActions({
    aiApplyPreview: preview,
    buildManifest: () => ({ documentFingerprint: "new" }),
    editor,
    getActiveDocumentSnapshot: () => ({ document: { comments: [] } }),
    setAiApplyPreview(value) {
      previewValues.push(value);
    },
    setManualAiApply(value) {
      manualCalls.push(value);
    },
    setManualFallbackAiBlockIndexes(updater) {
      assert.deepEqual(updater([]), [2]);
    },
    showStatus(...args) {
      statuses.push(args);
    },
  });
  staleActions.confirmAiApplyPreview();

  assert.equal(typeof originalBegin, "function");
  assert.equal(transactionCalls.length, 0);
  assert.equal(previewValues.at(-1), null);
  assert.deepEqual(manualCalls, [{
    block: preview.block,
    blockIndex: 2,
    blocks: preview.blocks,
  }]);
  assert.deepEqual(statuses.at(-1), [
    "确认前目标位置发生变化，请重新选择原文位置",
    "warning",
  ]);
});

test("manual targeting rebuilds the manifest, rejects protected blocks, and only stages the chosen action", async (t) => {
  for (
    const choice of ["replace", "insert_before", "insert_after"]
  ) {
    await t.test(choice, async () => {
      const { editor, transactionCalls } = createEditor();
      const manualAiApply = {
        block: { text: "proposal" },
        blockIndex: 4,
        blocks: [{ text: "proposal" }],
      };
      let protectedTarget = true;
      let manifestCalls = 0;
      let operationCalls = 0;
      let dialogCalls = 0;
      const staged = [];
      const statuses = [];
      const manualValues = [];
      const manifest = () => ({
        blocks: [{
          from: 1,
          id: "target",
          protected: protectedTarget,
          to: 5,
        }],
        documentFingerprint: `fresh-${manifestCalls}`,
      });
      const actions = createAiApplyResolutionActions({
        activeTabReadOnly: false,
        aiApplyInFlightRef: { current: false },
        aiApplyPreview: null,
        aiStatus: "done",
        applyingAiBlockIndex: -1,
        beginManualAiApply() {},
        buildManifest(currentDoc) {
          assert.equal(currentDoc, editor.state.doc);
          manifestCalls += 1;
          return manifest();
        },
        createManualOperation(currentManifest, targetId, action, block) {
          operationCalls += 1;
          assert.equal(targetId, "target");
          assert.equal(block, manualAiApply.block);
          return {
            ok: true,
            manifest: currentManifest,
            operation: {
              action,
              content: [{ type: "paragraph" }],
              from: 1,
              targetBlockIds: ["target"],
              to: 5,
            },
          };
        },
        editor,
        findOverlappingComments(operation, comments) {
          assert.deepEqual(comments, [{ id: "live" }]);
          return operation.action === "replace"
            ? [{ id: "c1" }, { id: "c2" }]
            : (operation.action === "insert_before"
                ? [{ id: "c1" }]
                : []);
        },
        getActiveDocumentSnapshot: () => ({
          document: { comments: [{ id: "snapshot" }] },
        }),
        getComments(currentEditor, fallback) {
          assert.equal(currentEditor, editor);
          assert.deepEqual(fallback, [{ id: "snapshot" }]);
          return [{ id: "live" }];
        },
        manualAiApply,
        manualFallbackAiBlockIndexes: [4],
        setApplyingAiBlockIndex() {},
        setManualAiApply(value) {
          manualValues.push(value);
        },
        async showConfirmDialog(options) {
          dialogCalls += 1;
          assert.equal(options.cancelValue, "cancel");
          assert.deepEqual(
            options.actions.map((action) => action.value),
            ["replace", "insert_before", "insert_after", "cancel"],
          );
          assert.match(options.actions[0].label, /2 条评注/);
          assert.match(options.actions[1].label, /1 条评注/);
          assert.doesNotMatch(options.actions[2].label, /评注/);
          return choice;
        },
        showStatus(...args) {
          statuses.push(args);
        },
        stageAiApplyPreview(operation, context) {
          staged.push({ operation, context });
          return { ok: true };
        },
        summarizeTarget: () => "第 1 段",
      });

      await actions.handleManualAiApplyTarget("target");
      assert.equal(manifestCalls, 1);
      assert.equal(operationCalls, 0);
      assert.equal(dialogCalls, 0);
      assert.equal(staged.length, 0);
      assert.deepEqual(statuses.at(-1), [
        "定稿区或受保护结构不能作为应用位置",
        "warning",
      ]);

      protectedTarget = false;
      await actions.handleManualAiApplyTarget("target");
      assert.equal(manifestCalls, 2);
      assert.equal(operationCalls, 3);
      assert.equal(dialogCalls, 1);
      assert.deepEqual(manualValues, [null]);
      assert.equal(staged.length, 1);
      assert.equal(staged[0].operation.operation.action, choice);
      assert.equal(staged[0].context, manualAiApply);
      assert.equal(transactionCalls.length, 0);
      assert.deepEqual(statuses.at(-1), [
        "已在正文中显示修改对比，请确认应用或取消",
        "success",
      ]);
    });
  }
});

test("preview Escape respects modal blocking and cleanup removes decorations", () => {
  const eventHost = createEventHost();
  const editor = {};
  const preview = { id: "preview" };
  const decorationCalls = [];
  let cancelCalls = 0;
  const confirm = () => {};
  const cleanup = subscribeAiApplyPreview({
    aiApplyPreview: preview,
    cancelAiApplyPreview() {
      cancelCalls += 1;
    },
    confirmAiApplyPreview: confirm,
    editor,
    eventHost,
    shortcutBlocked: (event) => event.modal,
    syncPreviewDecorations(currentEditor, value) {
      decorationCalls.push([currentEditor, value]);
    },
  });

  assert.equal(decorationCalls[0][0], editor);
  assert.equal(decorationCalls[0][1].id, "preview");
  assert.equal(decorationCalls[0][1].onConfirm, confirm);
  assert.equal(eventHost.listeners.get("keydown").capture, true);
  const keydown = eventHost.listeners.get("keydown").listener;
  let prevented = 0;
  keydown({
    key: "Escape",
    modal: true,
    preventDefault() {
      prevented += 1;
    },
  });
  keydown({
    key: "Enter",
    modal: false,
    preventDefault() {
      prevented += 1;
    },
  });
  keydown({
    key: "Escape",
    modal: false,
    preventDefault() {
      prevented += 1;
    },
  });
  assert.equal(cancelCalls, 1);
  assert.equal(prevented, 1);

  cleanup();
  assert.equal(eventHost.listeners.has("keydown"), false);
  assert.deepEqual(eventHost.removals.map(({ type, capture }) => (
    [type, capture]
  )), [["keydown", true]]);
  assert.deepEqual(decorationCalls.at(-1), [editor, null]);

  const clearCalls = [];
  const noPreviewCleanup = subscribeAiApplyPreview({
    aiApplyPreview: null,
    cancelAiApplyPreview() {},
    confirmAiApplyPreview() {},
    editor,
    eventHost,
    syncPreviewDecorations(...args) {
      clearCalls.push(args);
    },
  });
  assert.equal(noPreviewCleanup, undefined);
  assert.deepEqual(clearCalls, [[editor, null]]);
});

test("manual hover refreshes from editor updates and cleans every listener", () => {
  class FakeElement {
    constructor(parentElement = null) {
      this.parentElement = parentElement;
      this.classList = createClassList();
    }
  }
  const rootHost = createEventHost();
  const root = {
    ...rootHost,
    children: [],
    classList: createClassList(),
  };
  const firstChild = new FakeElement(root);
  const secondChild = new FakeElement(root);
  root.children = [firstChild, secondChild];
  const windowHost = createEventHost();
  const editorListeners = new Map();
  const editorOffCalls = [];
  let locatedPosition = 6;
  const editor = {
    state: { doc: { type: "doc" } },
    view: {
      dom: root,
      posAtCoords: () => ({ pos: locatedPosition }),
    },
    on(type, listener) {
      editorListeners.set(type, listener);
    },
    off(type, listener) {
      editorOffCalls.push({ type, listener });
      if (editorListeners.get(type) === listener) {
        editorListeners.delete(type);
      }
    },
  };
  let manifestCalls = 0;
  const buildManifest = () => {
    manifestCalls += 1;
    const secondProtected = manifestCalls >= 2;
    return {
      blocks: [
        { from: 0, id: "first", protected: false, to: 5 },
        {
          from: 5,
          id: "second",
          protected: secondProtected,
          to: 10,
        },
      ],
    };
  };
  const targetCalls = [];
  const manualValues = [];
  const statuses = [];
  const cleanup = subscribeManualAiApplyTargeting({
    buildManifest,
    editor,
    elementType: FakeElement,
    eventHost: windowHost,
    handleManualAiApplyTarget(targetId) {
      targetCalls.push(targetId);
    },
    manualAiApply: { block: { text: "proposal" } },
    setManualAiApply(value) {
      manualValues.push(value);
    },
    shortcutBlocked: (event) => event.modal,
    showStatus(...args) {
      statuses.push(args);
    },
  });

  assert.equal(
    root.classList.contains("ai-manual-apply-targeting"),
    true,
  );
  assert.equal(root.listeners.get("click").capture, true);
  assert.equal(windowHost.listeners.get("keydown").capture, true);
  root.listeners.get("pointermove").listener({ target: firstChild });
  assert.equal(
    firstChild.classList.contains("ai-manual-apply-hover"),
    true,
  );

  editorListeners.get("update")();
  root.listeners.get("pointermove").listener({ target: secondChild });
  assert.equal(
    firstChild.classList.contains("ai-manual-apply-hover"),
    false,
  );
  assert.equal(
    secondChild.classList.contains("ai-manual-apply-protected"),
    true,
  );
  assert.equal(manifestCalls, 2);

  let prevented = 0;
  let stopped = 0;
  const click = root.listeners.get("click").listener;
  click({
    clientX: 1,
    clientY: 1,
    preventDefault() {
      prevented += 1;
    },
    stopPropagation() {
      stopped += 1;
    },
  });
  assert.equal(targetCalls.length, 0);
  assert.deepEqual(statuses.at(-1), [
    "定稿区或受保护结构不能作为应用位置",
    "warning",
  ]);

  locatedPosition = 1;
  click({
    clientX: 1,
    clientY: 1,
    preventDefault() {
      prevented += 1;
    },
    stopPropagation() {
      stopped += 1;
    },
  });
  assert.deepEqual(targetCalls, ["first"]);
  assert.equal(prevented, 2);
  assert.equal(stopped, 2);

  const keydown = windowHost.listeners.get("keydown").listener;
  keydown({
    key: "Escape",
    modal: true,
    preventDefault() {
      prevented += 1;
    },
  });
  assert.deepEqual(manualValues, []);
  keydown({
    key: "Escape",
    modal: false,
    preventDefault() {
      prevented += 1;
    },
  });
  assert.deepEqual(manualValues, [null]);
  assert.deepEqual(statuses.at(-1), [
    "已取消选择应用位置",
    "success",
  ]);

  cleanup();
  assert.equal(
    root.classList.contains("ai-manual-apply-targeting"),
    false,
  );
  assert.equal(
    secondChild.classList.contains("ai-manual-apply-protected"),
    false,
  );
  assert.equal(root.listeners.size, 0);
  assert.equal(windowHost.listeners.size, 0);
  assert.equal(editorListeners.size, 0);
  assert.equal(editorOffCalls.length, 1);
  assert.equal(root.removals.length, 3);
  assert.equal(windowHost.removals.length, 1);
});

test("active document reset clears only fallback, manual target, and preview", () => {
  const calls = [];
  resetAiApplyTransientState({
    setAiApplyPreview(value) {
      calls.push(["preview", value]);
    },
    setManualAiApply(value) {
      calls.push(["manual", value]);
    },
    setManualFallbackAiBlockIndexes(value) {
      calls.push(["fallback", value]);
    },
  });
  assert.deepEqual(calls, [
    ["fallback", []],
    ["manual", null],
    ["preview", null],
  ]);
});

test("App keeps AI apply hooks at their anchors and controllers stay isolated", async () => {
  const [
    appSource,
    actionSource,
    lifecycleSource,
    stateSource,
  ] = await Promise.all([
    readFile(new URL("./App.jsx", import.meta.url), "utf8"),
    readFile(
      new URL("./controllers/ai-apply-actions.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("./controllers/ai-apply-lifecycle.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("./controllers/ai-apply-state.js", import.meta.url),
      "utf8",
    ),
  ]);
  const appBody = appSource.slice(
    appSource.indexOf("export default function App()"),
  );
  const orderedMarkers = [
    "const [immersiveMode, setImmersiveMode] = useState(false);",
    "useAiApplyState();",
    "const [settingsDialog, setSettingsDialog]",
    "const applyingRef = useRef(false);",
    "const aiApplyInFlightRef = useRef(false);",
    "const readyRef = useRef(false);",
    "const activeDocumentKey = useMemo",
    "useAiApplyResetLifecycle({",
    "usePromiseDialogActions({",
    "const handleAiChatPresetSelect = useCallback",
    "useAiApplyPreviewActions({",
    "useAiApplyPreviewLifecycle({",
    "useAiApplyResolutionActions({",
    "useAiManualApplyLifecycle({",
    "const measuredWorkSurfaceWidth",
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const index = appBody.indexOf(marker);
    assert.ok(index > previous, `${marker} must retain its apply anchor`);
    previous = index;
  }

  const stateMarkers = [
    "useState(-1)",
    "useState([])",
    "useState(null)",
    "useState(null)",
  ];
  let stateOffset = -1;
  for (const marker of stateMarkers) {
    stateOffset = stateSource.indexOf(marker, stateOffset + 1);
    assert.notEqual(stateOffset, -1, `${marker} must retain state order`);
  }
  assert.match(
    appBody,
    /editor\.setEditable\([^;]+&& !aiApplyPreview\)/,
  );
  assert.ok(
    (appBody.match(/Boolean\(aiApplyPreview\)/g) || []).length >= 2,
  );
  assert.doesNotMatch(
    appSource,
    /from "\.\/ai-direct-apply\.js"|syncAiApplyPreviewDecorations|const commitAiApplyOperation|const handleApplyAiBlock/,
  );
  const forbiddenDomainState = /documentStateRef|openTabsRef|workspaceGroupsRef|saveQueue|mutationQueue|research|knowledge/i;
  assert.doesNotMatch(actionSource, forbiddenDomainState);
  assert.doesNotMatch(lifecycleSource, forbiddenDomainState);
  assert.match(
    actionSource,
    /getCurrentDocument: \(\) => editor\.state\.doc/,
  );
  assert.match(
    lifecycleSource,
    /editor\.on\("update", refreshHoverManifest\)/,
  );
});
