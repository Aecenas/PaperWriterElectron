function emitBrowserEvent(listeners, payload) {
  listeners.forEach((callback) => callback(payload));
}

function browserRandomId() {
  return globalThis.crypto?.randomUUID?.()
    || `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function escapeBrowserHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function browserDownloadName(value, extension = "") {
  const raw = String(value || "未命名信笺").split(/[\\/]/).pop() || "未命名信笺";
  const safe = raw.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 120) || "未命名信笺";
  return extension && !safe.toLowerCase().endsWith(extension) ? `${safe}${extension}` : safe;
}

function plainTextFromBrowserHtml(html) {
  if (typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(String(html || ""), "text/html");
    return String(parsed.body?.textContent || "").replace(/\u00a0/g, " ");
  }
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export {
  browserDownloadName,
  browserRandomId,
  emitBrowserEvent,
  escapeBrowserHtml,
  plainTextFromBrowserHtml,
};
