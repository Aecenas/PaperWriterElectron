const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const isolatedTests = new Set([
  "research-search-worker.test.cjs",
]);
const allTests = fs.readdirSync(__dirname)
  .filter((name) => name.endsWith(".test.cjs"))
  .sort();

function runTestFiles(files) {
  if (files.length === 0) return;
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", ...files],
    {
      cwd: __dirname,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runTestFiles(allTests.filter((name) => !isolatedTests.has(name)));
for (const testFile of isolatedTests) {
  if (allTests.includes(testFile)) runTestFiles([testFile]);
}
