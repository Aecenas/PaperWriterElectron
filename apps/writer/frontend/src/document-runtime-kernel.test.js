import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentRuntimeKernel } from "./document-workspace/document-runtime-kernel.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitFor(predicate, message = "condition was not reached") {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

test("save queue runs operations for one tab in FIFO order", async () => {
  const firstGate = deferred();
  const events = [];
  const { saveQueuePort } = createDocumentRuntimeKernel({
    deferCommit: () => Promise.resolve(),
  });

  const first = saveQueuePort.enqueue("tab-a", async () => {
    events.push("first:start");
    await firstGate.promise;
    events.push("first:end");
    return "first-result";
  });
  const second = saveQueuePort.enqueue("tab-a", () => {
    events.push("second");
    return "second-result";
  });

  await waitFor(() => events.length === 1);
  assert.deepEqual(events, ["first:start"]);
  firstGate.resolve();
  assert.equal(await first, "first-result");
  assert.equal(await second, "second-result");
  assert.deepEqual(events, ["first:start", "first:end", "second"]);
  await saveQueuePort.wait("tab-a");
  assert.equal(saveQueuePort.hasPending("tab-a"), false);
});

test("save queues for different tabs can make progress independently", async () => {
  const firstGate = deferred();
  const secondGate = deferred();
  const events = [];
  const { saveQueuePort } = createDocumentRuntimeKernel({
    deferCommit: () => Promise.resolve(),
  });

  const first = saveQueuePort.enqueue("tab-a", async () => {
    events.push("a:start");
    await firstGate.promise;
    events.push("a:end");
  });
  const second = saveQueuePort.enqueue("tab-b", async () => {
    events.push("b:start");
    await secondGate.promise;
    events.push("b:end");
  });

  await waitFor(() => events.includes("a:start") && events.includes("b:start"));
  secondGate.resolve();
  await second;
  assert.deepEqual(events, ["a:start", "b:start", "b:end"]);
  firstGate.resolve();
  await first;
  assert.deepEqual(events, ["a:start", "b:start", "b:end", "a:end"]);
});

test("a rejected save does not poison the next operation for that tab", async () => {
  const events = [];
  const { saveQueuePort } = createDocumentRuntimeKernel({
    deferCommit: () => Promise.resolve(),
  });

  const rejected = saveQueuePort.enqueue("tab-a", () => {
    events.push("rejected");
    throw new Error("write failed");
  });
  const recovered = saveQueuePort.enqueue("tab-a", () => {
    events.push("recovered");
    return 42;
  });

  await assert.rejects(rejected, /write failed/);
  assert.equal(await recovered, 42);
  assert.deepEqual(events, ["rejected", "recovered"]);
});

test("an older queue cleanup cannot remove a newer tracked tail", async () => {
  const commitGates = [];
  const { saveQueuePort } = createDocumentRuntimeKernel({
    deferCommit(tabId) {
      const gate = deferred();
      commitGates.push({ gate, tabId });
      return gate.promise;
    },
  });

  const first = saveQueuePort.enqueue("tab-a", () => "first");
  const second = saveQueuePort.enqueue("tab-a", () => "second");
  assert.equal(await first, "first");
  await waitFor(() => commitGates.length === 1);
  assert.equal(saveQueuePort.hasPending("tab-a"), true);

  commitGates[0].gate.resolve();
  assert.equal(await second, "second");
  await waitFor(() => commitGates.length === 2);
  assert.equal(commitGates[1].tabId, "tab-a");
  assert.equal(saveQueuePort.hasPending("tab-a"), true);

  commitGates[1].gate.resolve();
  await saveQueuePort.wait("tab-a");
  assert.equal(saveQueuePort.hasPending("tab-a"), false);
});

test("wait includes the deferred state-commit continuation after an operation resolves", async () => {
  const commitGate = deferred();
  const { saveQueuePort } = createDocumentRuntimeKernel({
    deferCommit: () => commitGate.promise,
  });
  let waitResolved = false;

  const operation = saveQueuePort.enqueue("tab-a", () => "saved");
  const waiting = saveQueuePort.wait("tab-a").then(() => {
    waitResolved = true;
  });

  assert.equal(await operation, "saved");
  await Promise.resolve();
  assert.equal(waitResolved, false);
  assert.equal(saveQueuePort.hasPending("tab-a"), true);

  commitGate.resolve();
  await waiting;
  assert.equal(waitResolved, true);
});

test("recording a mutation invalidates its token and dirties only the target tab", () => {
  const kernel = createDocumentRuntimeKernel({ now: () => 4242 });
  kernel.tabRuntimePort.register("tab-a", {
    liveRevision: 7,
    recoveryRevision: 7,
  });
  kernel.tabRuntimePort.register("tab-b", {
    liveRevision: 3,
    recoveryRevision: 3,
  });
  const token = kernel.revisionPort.capture("tab-a");

  const result = kernel.revisionPort.recordMutation("tab-a", {
    editorSource: "right",
    updatedAt: "2026-07-26T00:00:00.000Z",
  });

  assert.deepEqual(result, {
    tabId: "tab-a",
    revision: 8,
    updatedAt: "2026-07-26T00:00:00.000Z",
    lastEditAt: 4242,
    becameDirty: true,
    recoveryBecameStale: true,
  });
  assert.equal(kernel.revisionPort.isCurrent(token), false);
  assert.equal(kernel.revisionPort.readLiveRevision("tab-a"), 8);
  assert.equal(kernel.revisionPort.readLastEditAt("tab-a"), 4242);
  assert.equal(kernel.dirtyPort.isDirty("tab-a"), true);
  assert.equal(kernel.dirtyPort.readRecoveryRevision("tab-a"), null);
  assert.equal(kernel.tabRuntimePort.readEditorSource("tab-a"), "right");
  assert.equal(kernel.revisionPort.readLiveRevision("tab-b"), 3);
  assert.equal(kernel.dirtyPort.isDirty("tab-b"), false);
  assert.equal(kernel.dirtyPort.readRecoveryRevision("tab-b"), 3);
});

test("a stale clean React mirror cannot overwrite a newly recorded mutation", () => {
  const kernel = createDocumentRuntimeKernel({ now: () => 4242 });
  kernel.tabRuntimePort.register("tab-a", {
    dirty: false,
    liveRevision: 7,
    recoveryRevision: 7,
  });

  kernel.revisionPort.recordMutation("tab-a", {
    updatedAt: "2026-07-26T00:00:00.000Z",
  });
  kernel.tabRuntimePort.syncReactMirror("tab-a", {
    dirty: false,
    liveRevision: 7,
    recoveryRevision: 7,
  });

  assert.deepEqual(kernel.tabRuntimePort.read("tab-a"), {
    tabId: "tab-a",
    dirty: true,
    liveUpdatedAt: "2026-07-26T00:00:00.000Z",
    liveRevision: 8,
    diskRevision: null,
    lastEditAt: 4242,
    editorSource: null,
    recoveryRevision: null,
    savePending: false,
  });
});

test("a disk revision commit survives even when the captured live token is stale", () => {
  const kernel = createDocumentRuntimeKernel();
  const oldDiskRevision = { size: 1, mtimeMs: 2, sha256: "a".repeat(64) };
  const newDiskRevision = { size: 3, mtimeMs: 4, sha256: "b".repeat(64) };
  kernel.tabRuntimePort.register("tab-a", {
    diskRevision: oldDiskRevision,
    liveRevision: 2,
  });
  const token = kernel.revisionPort.capture("tab-a");

  kernel.revisionPort.recordMutation("tab-a");
  assert.equal(kernel.revisionPort.isCurrent(token), false);
  kernel.revisionPort.commitDiskRevision("tab-a", newDiskRevision);

  assert.equal(kernel.revisionPort.readDiskRevision("tab-a"), newDiskRevision);
  assert.equal(kernel.revisionPort.isCurrent(token), false);
});

test("register validates atomically and ensure never resets an existing runtime", () => {
  const kernel = createDocumentRuntimeKernel();
  const diskRevision = { size: 5, mtimeMs: 6, sha256: "c".repeat(64) };
  kernel.tabRuntimePort.register("tab-a", {
    dirty: true,
    diskRevision,
    editorSource: "right",
    lastEditAt: 10,
    liveRevision: 4,
    liveUpdatedAt: "stable",
    recoveryRevision: 4,
  });
  const before = kernel.tabRuntimePort.read("tab-a");
  const token = kernel.revisionPort.capture("tab-a");

  assert.throws(() => kernel.tabRuntimePort.register("tab-a", {
    dirty: false,
    lastEditAt: Number.NaN,
    liveRevision: 99,
    recoveryRevision: 99,
  }), /lastEditAt must be a finite timestamp/);
  assert.deepEqual(kernel.tabRuntimePort.read("tab-a"), before);
  assert.equal(kernel.revisionPort.isCurrent(token), true);

  assert.equal(kernel.tabRuntimePort.has("tab-a"), true);
  assert.deepEqual(kernel.tabRuntimePort.ensure("tab-a", {
    liveRevision: 100,
  }), before);
  kernel.revisionPort.commitLiveUpdatedAt("tab-a", "updated-without-a-mutation");
  assert.equal(kernel.revisionPort.readLiveRevision("tab-a"), 4);
  assert.equal(kernel.revisionPort.readLiveUpdatedAt("tab-a"), "updated-without-a-mutation");
});

test("releasing a tab clears every runtime slot and invalidates captured tokens", async () => {
  const kernel = createDocumentRuntimeKernel({
    deferCommit: () => Promise.resolve(),
    now: () => 99,
  });
  kernel.tabRuntimePort.register("tab-a", {
    dirty: true,
    diskRevision: { size: 1 },
    editorSource: "main",
    lastEditAt: 12,
    liveRevision: 5,
    liveUpdatedAt: "before",
    recoveryRevision: 5,
  });
  const token = kernel.revisionPort.capture("tab-a");
  await kernel.saveQueuePort.enqueue("tab-a", () => undefined);
  await kernel.saveQueuePort.wait("tab-a");

  assert.equal(kernel.tabRuntimePort.release("tab-a"), true);
  assert.deepEqual(kernel.tabRuntimePort.read("tab-a"), {
    tabId: "tab-a",
    dirty: false,
    liveUpdatedAt: null,
    liveRevision: 0,
    diskRevision: null,
    lastEditAt: null,
    editorSource: null,
    recoveryRevision: null,
    savePending: false,
  });
  assert.equal(kernel.revisionPort.isCurrent(token), false);
  assert.equal(kernel.tabRuntimePort.release("tab-a"), false);
});
