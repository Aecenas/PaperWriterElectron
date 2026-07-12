const fs = require("node:fs/promises");
const path = require("node:path");

const CODEX_SCOPE_MODES = new Set([
  "document-only",
  "document-directory",
  "workspace",
  "subdirectory",
]);

function normalizeRelativePath(value, pathApi = path) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw || pathApi.isAbsolute(raw) || raw.split("/").includes("..")) return "";
  const normalized = pathApi.posix.normalize(raw).replace(/^\.\//, "").replace(/\/$/, "");
  return !normalized || normalized === "." || normalized.startsWith("../") ? "" : normalized;
}

function normalizeCodexScope(scope = {}) {
  const mode = CODEX_SCOPE_MODES.has(scope?.mode) ? scope.mode : "workspace";
  if (mode !== "subdirectory") return { mode, relativePath: "" };
  const relativePath = normalizeRelativePath(scope?.relativePath);
  return { mode, relativePath };
}

function isPathInside(rootPath, targetPath, pathApi = path) {
  const relative = pathApi.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative));
}

async function realDirectory(directoryPath, fsApi = fs) {
  const resolved = await fsApi.realpath(directoryPath);
  const stat = await fsApi.stat(resolved);
  if (!stat.isDirectory()) throw new Error("目标不是目录");
  return resolved;
}

function invalidScopeError() {
  const error = new Error("目录范围已失效，请重新选择");
  error.code = "CODEX_SCOPE_INVALID";
  return error;
}

async function resolveCodexScopeDirectory({
  scope,
  workspacePath,
  documentPath,
  tempRoot,
  fsApi = fs,
  pathApi = path,
} = {}) {
  const normalized = normalizeCodexScope(scope);
  if (scope?.mode === "subdirectory" && !normalized.relativePath) {
    throw invalidScopeError();
  }
  if (normalized.mode === "document-only") {
    try {
      await fsApi.mkdir(tempRoot, { recursive: true });
      const cwd = await fsApi.mkdtemp(pathApi.join(tempRoot, "paperwriter-codex-"));
      return {
        cwd,
        scope: normalized,
        cleanup: async () => {
          try { await fsApi.rm(cwd, { recursive: true, force: true }); } catch { /* Best-effort cleanup. */ }
        },
      };
    } catch {
      throw invalidScopeError();
    }
  }

  try {
    const workspaceRoot = await realDirectory(String(workspacePath || ""), fsApi);
    if (normalized.mode === "workspace") {
      return { cwd: workspaceRoot, scope: normalized, cleanup: async () => {} };
    }

    let targetPath = "";
    if (normalized.mode === "document-directory") {
      if (!documentPath) throw new Error("信笺尚未保存");
      targetPath = pathApi.dirname(String(documentPath));
    } else {
      const relativePath = normalizeRelativePath(normalized.relativePath, pathApi);
      if (!relativePath) throw new Error("子目录无效");
      targetPath = pathApi.resolve(workspaceRoot, ...relativePath.split("/"));
    }
    const targetRoot = await realDirectory(targetPath, fsApi);
    if (!isPathInside(workspaceRoot, targetRoot, pathApi)) throw new Error("目录超出工作区");
    return { cwd: targetRoot, scope: normalized, cleanup: async () => {} };
  } catch {
    throw invalidScopeError();
  }
}

module.exports = {
  CODEX_SCOPE_MODES,
  isPathInside,
  normalizeCodexScope,
  normalizeRelativePath,
  resolveCodexScopeDirectory,
};
