export function displayNameFromPath(filePath) {
  return String(filePath || "").replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() || String(filePath || "");
}

export function pathIsSameOrInside(targetPath, parentPath) {
  const normalize = (value) => String(value || "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const target = normalize(targetPath);
  const parent = normalize(parentPath);
  return Boolean(target && parent && (target === parent || target.startsWith(`${parent}\\`)));
}

export function parentPathFromPath(filePath) {
  const normalized = String(filePath || "").replace(/\//g, "\\").replace(/\\+$/, "");
  const index = normalized.lastIndexOf("\\");
  return index > 0 ? normalized.slice(0, index) : "";
}
