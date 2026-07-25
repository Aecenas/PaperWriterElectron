const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const IGNORED_DIRECTORIES = new Set([".git", "node_modules"]);

function collectCommonJsFiles(rootDirectory) {
  const files = [];
  const pendingDirectories = [path.resolve(rootDirectory)];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) pendingDirectories.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".cjs")) {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

function checkCommonJsFiles(rootDirectory = __dirname) {
  const files = collectCommonJsFiles(rootDirectory);
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
  }
  return files;
}

if (require.main === module) {
  const checkedFiles = checkCommonJsFiles();
  if (!process.exitCode) {
    console.log(`Checked ${checkedFiles.length} CommonJS files.`);
  }
}

module.exports = {
  checkCommonJsFiles,
  collectCommonJsFiles,
};
