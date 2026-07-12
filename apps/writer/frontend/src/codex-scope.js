export const CODEX_SCOPE_MODES = new Set([
  "document-only",
  "document-directory",
  "workspace",
  "subdirectory",
]);

export const CODEX_IMAGE_MODES = new Set(["original", "caption-only"]);

export function normalizeCodexImageMode(value) {
  return CODEX_IMAGE_MODES.has(value) ? value : "original";
}

export function normalizeCodexScope(scope = {}) {
  const mode = CODEX_SCOPE_MODES.has(scope?.mode) ? scope.mode : "workspace";
  if (mode !== "subdirectory") return { mode, relativePath: "" };
  const raw = String(scope?.relativePath || "").trim().replace(/\\/g, "/");
  if (!raw || raw.startsWith("/") || /^[a-zA-Z]:\//.test(raw) || raw.split("/").includes("..")) {
    return { mode: "subdirectory", relativePath: "" };
  }
  const relativePath = raw.split("/").filter((part) => part && part !== ".").join("/");
  return { mode, relativePath };
}

export function relativeCodexScopePath(workspacePath, targetPath) {
  const normalize = (value) => String(value || "").trim().replace(/[\\/]+/g, "\\").replace(/\\+$/, "");
  const workspace = normalize(workspacePath);
  const target = normalize(targetPath);
  if (!workspace || !target) return null;
  const workspaceLower = workspace.toLowerCase();
  const targetLower = target.toLowerCase();
  if (targetLower === workspaceLower) return "";
  if (!targetLower.startsWith(`${workspaceLower}\\`)) return null;
  return target.slice(workspace.length + 1).split("\\").filter(Boolean).join("/");
}

export function codexScopeLabel(scope = {}) {
  const normalized = normalizeCodexScope(scope);
  if (normalized.mode === "document-only") return "仅当前信笺";
  if (normalized.mode === "document-directory") return "信笺所在目录";
  if (normalized.mode === "subdirectory") return normalized.relativePath || "子目录已失效";
  return "整个工作区";
}
