export const MERMAID_SAFETY_LIMITS = Object.freeze({
  maxChars: 40_000,
  maxLines: 1_500,
  maxEdges: 1_000,
  maxQueue: 4,
  preflightTimeoutMs: 2_000,
  renderTimeoutMs: 4_000,
});

export function estimateMermaidEdgeCount(source) {
  return (
    String(source || "").match(
      /(?:-{1,2}>|--+>|==+>|-\.+>|->>|-->>|<<--|<--+|<==+|<-\.+)/g,
    ) || []
  ).length;
}

export function assertMermaidSourceWithinLimits(source) {
  const value = typeof source === "string" ? source : "";
  if (
    !value
    || value.length > MERMAID_SAFETY_LIMITS.maxChars
    || value.split(/\r?\n/).length > MERMAID_SAFETY_LIMITS.maxLines
  ) {
    const error = new Error("流程图源码为空或超过安全上限");
    error.code = "MERMAID_SOURCE_LIMIT";
    throw error;
  }
  if (estimateMermaidEdgeCount(value) > MERMAID_SAFETY_LIMITS.maxEdges) {
    const error = new Error(
      `流程图连线不能超过 ${MERMAID_SAFETY_LIMITS.maxEdges.toLocaleString()} 条`,
    );
    error.code = "MERMAID_EDGE_LIMIT";
    throw error;
  }
  return value;
}
