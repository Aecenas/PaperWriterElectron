const assert = require("node:assert/strict");
const test = require("node:test");

const {
  assertBoundedIpcObject,
  assertBoundedIpcPayload,
} = require("./ipc-payload-limits.cjs");

test("IPC payload limiter counts aggregate UTF-8 bytes, nodes, arrays, and depth", () => {
  assert.deepEqual(assertBoundedIpcObject(null), {});
  assert.deepEqual(assertBoundedIpcObject({ title: "笺间", items: [1, true] }), {
    title: "笺间",
    items: [1, true],
  });
  assert.throws(
    () => assertBoundedIpcPayload({ value: "中文" }, { maxBytes: 8, label: "测试参数" }),
    /总大小超过限制/,
  );
  assert.throws(
    () => assertBoundedIpcPayload({ items: [1, 2, 3] }, { maxArrayLength: 2, label: "测试参数" }),
    /数组项目数量超过限制/,
  );
  assert.throws(
    () => assertBoundedIpcPayload({ a: { b: { c: true } } }, { maxDepth: 2, label: "测试参数" }),
    /嵌套层级超过限制/,
  );
  assert.throws(
    () => assertBoundedIpcPayload({ a: 1, b: 2 }, { maxNodes: 2, label: "测试参数" }),
    /节点数量超过限制/,
  );
});

test("IPC payload limiter rejects non-plain objects and cycles", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => assertBoundedIpcPayload(cyclic), /循环引用/);
  assert.throws(() => assertBoundedIpcObject([]), /必须是对象/);
  assert.throws(() => assertBoundedIpcPayload(new Date()), /普通对象/);
});
