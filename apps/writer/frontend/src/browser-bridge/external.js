import { normalizeBrowserExternalUrl } from "../browser-ai-config.js";

async function openBrowserExternal(url) {
  const safeUrl = normalizeBrowserExternalUrl(url);
  if (!safeUrl) {
    return {
      ok: false,
      error: typeof url === "string" && url.length > 8192
        ? "url-too-long"
        : "unsupported-or-invalid-url",
    };
  }
  const opened = window.open(safeUrl, "_blank", "noopener,noreferrer");
  return opened === null ? { ok: false, error: "popup-blocked" } : { ok: true };
}

export { openBrowserExternal };
