const fs = require("node:fs/promises");
const path = require("node:path");

// PaperWriter runs Codex in a text-only permission profile. Legacy directory
// selections are accepted for compatibility but never become readable roots.
const CODEX_SCOPE_MODES = new Set(["document-only"]);

function normalizeRelativePath(value, pathApi = path) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw || pathApi.isAbsolute(raw) || raw.split("/").includes("..")) return "";
  const normalized = pathApi.posix.normalize(raw).replace(/^\.\//, "").replace(/\/$/, "");
  return !normalized || normalized === "." || normalized.startsWith("../") ? "" : normalized;
}

function normalizeCodexScope(scope = {}) {
  void scope;
  return { mode: "document-only", relativePath: "" };
}

function isPathInside(rootPath, targetPath, pathApi = path) {
  const relative = pathApi.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith(`..${pathApi.sep}`) && relative !== ".." && !pathApi.isAbsolute(relative));
}

function invalidScopeError() {
  const error = new Error("目录范围已失效，请重新选择");
  error.code = "CODEX_SCOPE_INVALID";
  return error;
}

async function resolveCodexScopeDirectory({
  scope,
  tempRoot,
  fsApi = fs,
  pathApi = path,
} = {}) {
  const normalized = normalizeCodexScope(scope);
  try {
    if (!tempRoot) throw new Error("缺少隔离目录");
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

module.exports = {
  CODEX_SCOPE_MODES,
  isPathInside,
  normalizeCodexScope,
  normalizeRelativePath,
  resolveCodexScopeDirectory,
};
