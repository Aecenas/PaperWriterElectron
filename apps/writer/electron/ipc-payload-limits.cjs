const DEFAULT_LIMITS = Object.freeze({
  maxBytes: 1024 * 1024,
  maxNodes: 10_000,
  maxDepth: 16,
  maxArrayLength: 5_000,
  maxObjectKeys: 5_000,
});

function byteLength(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function assertBoundedIpcPayload(value, {
  label = "IPC 参数",
  ...overrides
} = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const root = value === undefined || value === null ? {} : value;
  const stack = [{ value: root, depth: 0 }];
  const seen = new WeakSet();
  let bytes = 0;
  let nodes = 0;

  const addBytes = (count) => {
    bytes += count;
    if (bytes > limits.maxBytes) {
      throw new Error(`${label}总大小超过限制`);
    }
  };

  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new Error(`${label}节点数量超过限制`);
    }
    if (current.depth > limits.maxDepth) {
      throw new Error(`${label}嵌套层级超过限制`);
    }

    const item = current.value;
    if (item === null || item === undefined) {
      addBytes(4);
      continue;
    }
    if (typeof item === "string") {
      addBytes(byteLength(item));
      continue;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error(`${label}包含无效数字`);
      addBytes(8);
      continue;
    }
    if (typeof item === "boolean") {
      addBytes(1);
      continue;
    }
    if (typeof item !== "object") {
      throw new Error(`${label}包含不支持的数据类型`);
    }
    if (seen.has(item)) throw new Error(`${label}不能包含循环引用`);
    seen.add(item);

    if (Array.isArray(item)) {
      if (item.length > limits.maxArrayLength) {
        throw new Error(`${label}数组项目数量超过限制`);
      }
      addBytes(2 + item.length);
      for (let index = item.length - 1; index >= 0; index -= 1) {
        stack.push({ value: item[index], depth: current.depth + 1 });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(item);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label}只能包含普通对象`);
    }
    const entries = Object.entries(item);
    if (entries.length > limits.maxObjectKeys) {
      throw new Error(`${label}对象字段数量超过限制`);
    }
    addBytes(2 + entries.length);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        throw new Error(`${label}包含危险字段`);
      }
      addBytes(byteLength(key));
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }

  return root;
}

function assertBoundedIpcObject(value, options) {
  const source = assertBoundedIpcPayload(value, options);
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error(`${options?.label || "IPC 参数"}必须是对象`);
  }
  return source;
}

module.exports = {
  assertBoundedIpcObject,
  assertBoundedIpcPayload,
};
