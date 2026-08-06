const { createHash } = require("node:crypto");

const MAX_DEBUG_DEPTH = 4;
const MAX_DEBUG_KEYS = 64;
const MAX_DEBUG_ARRAY_ITEMS = 32;
const MAX_DEBUG_STRING_CHARS = 2048;
const SECRET_KEY_PATTERN = /(?:authorization|cookie|password|secret|token|api[_-]?key)/i;
const CONTENT_KEY_PATTERN = /^(?:body|content|data|document|html|input|markdown|output|payload|prompt|query|raw|requestBody|responseBody|selection|text)$/i;
const PATH_KEY_PATTERN = /(?:path|folder|directory|root|cwd)$/i;
const URL_KEY_PATTERN = /(?:url|uri|endpoint)$/i;
const RENDERER_DEBUG_FIELDS = new Set([
  "canceled", "contentSource", "files", "folderPath", "folders",
  "hasDocument", "htmlChars", "ipcMs", "jsonPresent", "message",
  "ms", "path", "setContentMs", "source", "timedOut", "totalMs",
]);

function debugFingerprint(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex").slice(0, 12);
}

function pathToken(value) {
  return `[PATH:${debugFingerprint(value)}]`;
}

function safeUrlOrigin(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["http:", "https:"].includes(parsed.protocol)) return `[URL:${debugFingerprint(value)}]`;
    return parsed.origin;
  } catch {
    return `[URL:${debugFingerprint(value)}]`;
  }
}

function sanitizeDebugString(value, key = "") {
  if (SECRET_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (CONTENT_KEY_PATTERN.test(key)) return "[CONTENT_REDACTED]";
  if (PATH_KEY_PATTERN.test(key)) return pathToken(value);
  if (URL_KEY_PATTERN.test(key) || /^baseUrl$/i.test(key)) return safeUrlOrigin(value);
  return String(value || "")
    .slice(0, MAX_DEBUG_STRING_CHARS)
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|api)[-_][a-z0-9_-]{8,}\b/gi, "[REDACTED]")
    .replace(/(?:[a-z]:[\\/]|\\\\)[^\s"'<>|]+/gi, (pathValue) => pathToken(pathValue))
    .replace(/https?:\/\/[^\s"'<>]+/gi, (urlValue) => safeUrlOrigin(urlValue));
}

function sanitizeDebugLogData(value, key = "", depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return sanitizeDebugString(value, key);
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return String(value).slice(0, MAX_DEBUG_STRING_CHARS);
  if (depth >= MAX_DEBUG_DEPTH || seen.has(value)) return "[TRUNCATED]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DEBUG_ARRAY_ITEMS)
      .map((item) => sanitizeDebugLogData(item, key, depth + 1, seen));
  }
  const sanitized = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_DEBUG_KEYS)) {
    if (["__proto__", "constructor", "prototype"].includes(entryKey)) continue;
    sanitized[entryKey] = sanitizeDebugLogData(entryValue, entryKey, depth + 1, seen);
  }
  return sanitized;
}

function sanitizeRendererDebugData(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const allowed = {};
  for (const key of RENDERER_DEBUG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) allowed[key] = source[key];
  }
  return sanitizeDebugLogData(allowed);
}

function registerDiagnosticsIpcHandlers({
  ipcMain,
  writeDebugLog,
}) {
  ipcMain.handle("debug:log", async (_event, event, data) => {
    const safeEvent = String(event || "").trim();
    if (!/^renderer:[a-z0-9:-]{1,96}$/i.test(safeEvent)) {
      return { ok: false, error: "unsupported-event" };
    }
    await writeDebugLog(
      safeEvent,
      sanitizeRendererDebugData(data),
    );
    return { ok: true };
  });
}

module.exports = {
  registerDiagnosticsIpcHandlers,
  sanitizeDebugLogData,
  sanitizeRendererDebugData,
};
