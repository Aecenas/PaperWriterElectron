const assert = require("node:assert/strict");
const test = require("node:test");

const {
  findLiteralMatch,
  searchRecords,
} = require("./search-record-core.cjs");

test("record search finds Unicode literals with original offsets and weighted fields", async () => {
  assert.deepEqual(findLiteralMatch("甲İ乙", "i̇"), {
    start: 1,
    end: 2,
    length: 1,
  });
  const result = await searchRecords([
    {
      searchFields: {
        fileName: "普通文件.pdf",
        title: "研究方法",
        body: "正文也包含研究方法",
      },
      result: {
        kind: "file",
        relativePath: "论文/普通文件.pdf",
        title: "研究方法",
      },
    },
    {
      searchFields: {
        fileName: "研究方法汇总.pdf",
        title: "普通标题",
        body: "",
      },
      result: {
        kind: "file",
        relativePath: "论文/研究方法汇总.pdf",
        title: "普通标题",
      },
    },
  ], "研究方法", { requestId: "search-1" });

  assert.equal(result.canceled, false);
  assert.equal(result.totalMatches, 2);
  assert.equal(result.results[0].relativePath, "论文/研究方法汇总.pdf");
  assert.equal(result.results[0].matchField, "fileName");
  assert.equal(
    result.results[1].snippet.slice(
      result.results[1].snippetMatchStart,
      result.results[1].snippetMatchStart
        + result.results[1].snippetMatchLength,
    ),
    "研究方法",
  );
});

test("record search enforces result limits, filters records, yields progress, and cancels", async () => {
  const records = Array.from({ length: 250 }, (_value, index) => ({
    scope: index % 2 ? "private" : "global",
    searchFields: { body: `共同文字 ${index}` },
    result: { title: `结果 ${index}` },
  }));
  const progress = [];
  const limited = await searchRecords(records, "共同文字", {
    requestId: "search-2",
    limit: 20,
    includeRecord: (record) => record.scope === "global",
    onProgress: (value) => progress.push(value.completed),
  });
  assert.equal(limited.totalMatches, 125);
  assert.equal(limited.results.length, 20);
  assert.equal(limited.limited, true);
  assert.ok(progress.includes(100));
  assert.ok(progress.includes(250));

  const canceled = await searchRecords(records, "共同文字", {
    requestId: "search-3",
    isCanceled: () => true,
  });
  assert.deepEqual(canceled, {
    requestId: "search-3",
    query: "共同文字",
    canceled: true,
    results: [],
    totalMatches: 0,
    limited: false,
  });
});
