const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIME_TYPES = Object.freeze({
  image: new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/svg+xml",
    "image/avif",
  ]),
  audio: new Set([
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/wave",
    "audio/ogg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/flac",
    "audio/x-flac",
  ]),
  video: new Set([
    "video/mp4",
    "video/webm",
    "video/ogg",
  ]),
});

const ASSET_EXTENSIONS = Object.freeze({
  image: new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]),
  audio: new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac"]),
  video: new Set(["mp4", "webm", "ogv"]),
});

export const SAFE_EMBED_WIDTHS = Object.freeze(["45%", "62%", "78%", "100%"]);
const SAFE_EMBED_WIDTH_SET = new Set(SAFE_EMBED_WIDTHS);

function normalizedKind(value) {
  if (value === "video") return "video";
  if (value === "audio") return "audio";
  return "image";
}

function normalizeAssetPath(value, kind) {
  const source = String(value || "").trim().replace(/^\.\//, "");
  if (
    !source
    || source.length > 512
    || !source.startsWith("assets/")
    || !/^[A-Za-z0-9._/-]+$/.test(source)
  ) {
    return "";
  }
  const segments = source.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return "";
  const extension = segments.at(-1)?.split(".").pop()?.toLowerCase() || "";
  return ASSET_EXTENSIONS[normalizedKind(kind)].has(extension) ? source : "";
}

function normalizeBase64Payload(value) {
  const payload = String(value || "").replace(/[ \t\r\n\f]/g, "");
  if (!payload) return "";
  const firstPadding = payload.indexOf("=");
  const core = firstPadding < 0 ? payload : payload.slice(0, firstPadding);
  const suppliedPadding = firstPadding < 0 ? 0 : payload.length - firstPadding;
  if (suppliedPadding > 2 || (firstPadding >= 0 && !/^={1,2}$/.test(payload.slice(firstPadding)))) return "";
  for (let index = 0; index < core.length; index += 1) {
    const code = core.charCodeAt(index);
    const valid = (code >= 0x30 && code <= 0x39)
      || (code >= 0x41 && code <= 0x5a)
      || (code >= 0x61 && code <= 0x7a)
      || code === 0x2b
      || code === 0x2f;
    if (!valid) return "";
  }
  const remainder = core.length % 4;
  if (remainder === 1) return "";
  const requiredPadding = (4 - remainder) % 4;
  if (suppliedPadding && suppliedPadding !== requiredPadding) return "";
  return `${core}${"=".repeat(requiredPadding)}`;
}

function normalizeDataSource(value, kind) {
  const source = String(value || "").trim();
  const commaIndex = source.indexOf(",");
  if (commaIndex <= 5) return "";
  const metadata = source.slice(5, commaIndex).split(";");
  if (metadata.length !== 2 || metadata[1].toLowerCase() !== "base64") return "";
  const mime = metadata[0].toLowerCase();
  if (!MIME_TYPES[normalizedKind(kind)].has(mime)) return "";
  const payload = normalizeBase64Payload(source.slice(commaIndex + 1));
  return payload ? `data:${mime};base64,${payload}` : "";
}

function decodeUrlPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function normalizeProtocolSource(value, kind) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return "";
  }
  if (
    url.protocol !== "paperwriter-asset:"
    || url.username
    || url.password
    || url.port
    || url.hash
  ) {
    return "";
  }
  const reference = decodeUrlPart(url.pathname.replace(/^\/+/, ""));
  if (!UUID_PATTERN.test(reference) || url.pathname.replace(/^\/+/, "").includes("/")) return "";
  if (url.hostname === "staged") {
    if (url.search) return "";
    return `paperwriter-asset://staged/${reference}`;
  }
  if (url.hostname !== "document") return "";
  const queryKeys = [...url.searchParams.keys()];
  const assetValues = url.searchParams.getAll("asset");
  if (queryKeys.length !== 1 || queryKeys[0] !== "asset" || assetValues.length !== 1) return "";
  const assetPath = normalizeAssetPath(assetValues[0], kind);
  if (!assetPath) return "";
  return `paperwriter-asset://document/${encodeURIComponent(reference)}?asset=${encodeURIComponent(assetPath)}`;
}

function normalizeBlobSource(value) {
  const source = String(value || "").trim();
  if (source.length > 2048 || /[\s"'\\]/.test(source)) return "";
  let url;
  try {
    url = new URL(source);
  } catch {
    return "";
  }
  if (url.protocol !== "blob:" || url.search || url.hash) return "";
  const token = source.slice(source.lastIndexOf("/") + 1);
  return UUID_PATTERN.test(token) ? url.href : "";
}

function normalizeResourceSource(value, kind) {
  if (typeof value !== "string") return "";
  const source = value.trim();
  if (!source || /[\u0000-\u001f\u007f]/.test(source)) return "";
  if (/^data:/i.test(source)) return normalizeDataSource(source, kind);
  if (/^paperwriter-asset:/i.test(source)) return normalizeProtocolSource(source, kind);
  if (/^blob:/i.test(source)) return normalizeBlobSource(source);
  return normalizeAssetPath(source, kind);
}

export function normalizeEmbedWidth(value, fallback = "78%") {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (SAFE_EMBED_WIDTH_SET.has(normalized)) return normalized;
  return SAFE_EMBED_WIDTH_SET.has(fallback) ? fallback : "78%";
}

export function normalizeImageSource(value) {
  return normalizeResourceSource(value, "image");
}

export function normalizeMediaSource(value, kind = "audio") {
  return normalizeResourceSource(value, kind === "video" ? "video" : "audio");
}

export function normalizeCustomBackgroundSource(value) {
  return normalizeImageSource(value);
}

export function toSafeCssImageUrl(value) {
  const source = normalizeImageSource(value);
  return source ? `url("${source}")` : "";
}
