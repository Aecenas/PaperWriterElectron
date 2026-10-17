import assert from "node:assert/strict";
import test from "node:test";
import { connectExternalDocumentRequests } from "./document-workspace/external-document-open.js";

function harness({ batches = [], openDocumentPath = async () => {} } = {}) {
  const opened = [];
  const errors = [];
  let listener;
  let pulls = 0;
  let unsubscribed = false;
  const connection = connectExternalDocumentRequests({
    requestPort: {
      onExternalDocumentRequest: (callback) => {
        listener = callback;
        return () => { unsubscribed = true; };
      },
      takeExternalDocumentRequests: async () => { pulls += 1; return batches.shift() || []; },
    },
    openDocumentPath: async (value) => { opened.push(value); await openDocumentPath(value); },
    onError: (error) => errors.push(error.message),
  });
  return { connection, errors, opened, request: () => listener(), pulls: () => pulls, unsubscribed: () => unsubscribed };
}

test("pulls pending startup requests without waiting for another event and reports failures individually", async () => {
  const h = harness({ batches: [[{ path: "missing", error: "文件不存在" }, { path: "bad" }, { path: "C:/claude/大A本轮牛市复盘.letterpaper" }]], openDocumentPath: async (value) => {
    if (value === "bad") throw new Error("文件损坏");
  } });
  await h.connection.ready;
  assert.deepEqual(h.opened, ["bad", "C:/claude/大A本轮牛市复盘.letterpaper"]);
  assert.deepEqual(h.errors, ["文件不存在", "文件损坏"]);
  h.connection.dispose();
  assert.equal(h.unsubscribed(), true);
});

test("serializes repeated open events, including arrivals during an ongoing open", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const h = harness({ batches: [[{ path: "first" }], [{ path: "second" }, { path: "third" }]], openDocumentPath: () => blocked });
  await Promise.resolve();
  const next = h.request();
  assert.equal(h.pulls(), 1);
  release();
  await next;
  assert.deepEqual(h.opened, ["first", "second", "third"]);
  assert.equal(h.pulls(), 2);
  h.connection.dispose();
});

test("unsubscribes and stops processing after disposal", async () => {
  const h = harness({ batches: [[{ path: "pending" }]] });
  h.connection.dispose();
  await h.connection.ready;
  assert.deepEqual(h.opened, []);
  await h.request();
  assert.equal(h.pulls(), 1);
});
