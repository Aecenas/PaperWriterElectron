import { pathIsSameOrInside } from "../app-shell/path-display.js";
import { sameDocumentPath } from "../editor-lifecycle.js";

export function replacePathPrefix(targetPath, fromPath, toPath) {
  if (!pathIsSameOrInside(targetPath, fromPath)) {
    return targetPath;
  }
  if (sameDocumentPath(targetPath, fromPath)) {
    return toPath;
  }
  const separator = targetPath[fromPath.length] || "\\";
  const suffix = targetPath.slice(fromPath.length + (separator === "\\" || separator === "/" ? 1 : 0));
  return suffix ? `${toPath}\\${suffix}` : toPath;
}
