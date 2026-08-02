import assert from "node:assert/strict";
import test from "node:test";
import { prepareDocumentHistoryOperation } from "./history/operation.js";

function diskRevision(character) {
  return {
    size: 100,
    mtimeMs: 200,
    sha256: character.repeat(64),
  };
}

function createHarness({
  flushResult = { status: "flushed", writtenTabIds: ["tab-a"] },
  initialDirty = true,
  initialRevision = diskRevision("a"),
  mutateOnFlush,
} = {}) {
  const events = [];
  let runtimeDirty = initialDirty;
  let tab = {
    id: "tab-a",
    path: "C:\\letters\\tab-a.letterpaper",
    dirty: initialDirty,
    externalChanged: false,
    diskRevision: initialRevision,
    document: { documentId: "doc-a", title: "Live draft" },
  };
  const nextRevision = diskRevision("b");
  let committedRevision = initialRevision;

  return {
    events,
    nextRevision,
    readTab: () => tab,
    operation: () => prepareDocumentHistoryOperation({
      tabId: "tab-a",
      persistenceController: {
        diskMutationBarrierPort: {
          async acquire(tabIds) {
            events.push(["acquire", tabIds]);
            return {
              release() {
                events.push(["release"]);
              },
            };
          },
        },
        async flushDirtyWorkspaceTabs(options) {
          events.push(["flush", options]);
          if (mutateOnFlush) {
            const mutation = mutateOnFlush({ tab, nextRevision });
            tab = mutation.tab;
            runtimeDirty = mutation.runtimeDirty;
            committedRevision = mutation.committedRevision;
          } else if (flushResult.writtenTabIds.includes("tab-a")) {
            tab = {
              ...tab,
              dirty: false,
              diskRevision: nextRevision,
              document: {
                ...tab.document,
                title: "Persisted live draft",
              },
            };
            runtimeDirty = false;
            committedRevision = nextRevision;
          }
          return {
            ...flushResult,
            writtenRevisions: flushResult.writtenRevisions || (
              flushResult.writtenTabIds.includes("tab-a")
                ? { "tab-a": nextRevision }
                : {}
            ),
          };
        },
      },
      documentStorePort: {
        read: () => ({ tabs: [tab] }),
      },
      dirtyPort: {
        isDirty: () => runtimeDirty,
      },
      revisionPort: {
        commitDiskRevision(_tabId, revision) {
          committedRevision = revision;
          events.push(["commit-revision", revision]);
        },
        readDiskRevision: () => committedRevision,
      },
      getDocumentRevision: async () => {
        events.push(["read-revision"]);
        return { diskRevision: nextRevision };
      },
    }),
  };
}

test("dirty history operation saves only its target and returns the committed boundary", async () => {
  const harness = createHarness();
  const prepared = await harness.operation();

  assert.deepEqual(harness.events, [
    ["acquire", ["tab-a"]],
    ["flush", { idleOnly: false, tabIds: ["tab-a"] }],
    ["release"],
  ]);
  assert.equal(prepared.wasDirty, true);
  assert.equal(prepared.document.title, "Persisted live draft");
  assert.deepEqual(prepared.diskRevision, harness.nextRevision);
  assert.equal(harness.readTab().dirty, false);
});

test("history operation aborts after a stale or failed dirty save and still releases its barrier", async () => {
  const harness = createHarness({
    flushResult: { status: "flushed", writtenTabIds: [] },
  });

  await assert.rejects(
    harness.operation(),
    /当前内容未能完整保存，版本历史操作已取消/,
  );
  assert.deepEqual(harness.events, [
    ["acquire", ["tab-a"]],
    ["flush", { idleOnly: false, tabIds: ["tab-a"] }],
    ["release"],
  ]);
});

test("history operation rejects an external conflict instead of snapshotting old disk content", async () => {
  const harness = createHarness({
    mutateOnFlush: ({ tab, nextRevision }) => ({
      tab: {
        ...tab,
        externalChanged: true,
        diskRevision: nextRevision,
      },
      runtimeDirty: true,
      committedRevision: nextRevision,
    }),
    flushResult: { status: "flushed", writtenTabIds: [] },
  });

  await assert.rejects(
    harness.operation(),
    /检测到外部版本，版本历史操作已取消/,
  );
  assert.equal(harness.events.at(-1)[0], "release");
});

test("clean history operation resolves and commits a missing disk revision before restore", async () => {
  const harness = createHarness({
    initialDirty: false,
    initialRevision: null,
  });
  const prepared = await harness.operation();

  assert.equal(prepared.wasDirty, false);
  assert.deepEqual(prepared.diskRevision, harness.nextRevision);
  assert.deepEqual(harness.events, [
    ["acquire", ["tab-a"]],
    ["read-revision"],
    ["commit-revision", harness.nextRevision],
    ["release"],
  ]);
});
