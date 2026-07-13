const path = require("node:path");
const { createHash } = require("node:crypto");

const DATA_SOURCE_PATTERN = /src=(["'])(data:(?:image|audio|video)\/[^"']+)\1/gi;
const PROTOCOL_SOURCE_PATTERN = /src=(["'])(paperwriter-asset:\/\/[^"']+)\1/gi;
const HTML_SOURCE_PATTERN = /\bsrc=(["'])([^"']+)\1/gi;
const DEFAULT_MAX_ASSET_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_ASSET_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_ASSET_ENTRIES = 2047;
const SAFE_ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif",
  ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac", ".mp4", ".webm", ".ogv",
]);

function dataUrlToBuffer(dataUrl, maximumBytes = DEFAULT_MAX_ASSET_BYTES) {
  const match = /^data:([^;]+);base64,([\s\S]+)$/i.exec(String(dataUrl || ""));
  if (!match) return null;
  const encoded = match[2].replace(/\s/g, "");
  if (!/^[a-z0-9+/]*={0,2}$/i.test(encoded) || encoded.length % 4 === 1) return null;
  if (Math.floor(encoded.length * 3 / 4) > maximumBytes) throw new Error("内嵌资源超过安全大小上限");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length > maximumBytes) throw new Error("内嵌资源超过安全大小上限");
  return buffer.length ? { mime: match[1].toLowerCase(), buffer } : null;
}

function extensionFromMime(mime) {
  const extensions = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/flac": ".flac",
    "video/webm": ".webm",
    "video/ogg": ".ogv",
    "video/mp4": ".mp4",
  };
  return extensions[String(mime || "").toLowerCase()] || ".png";
}

function isAlreadyCompressedMedia(mime) {
  // Store all media verbatim. Besides avoiding wasted CPU for already-compressed
  // formats, this guarantees that writer-created SVG/text-like images cannot
  // exceed the loader's zip-bomb compression-ratio policy on the next open.
  return /^(?:audio|video|image)\//i.test(String(mime || ""));
}

function isPackagedAssetPath(value) {
  const source = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = source.split("/");
  return source.length <= 512
    && source.startsWith("assets/")
    && !/[\u0000-\u001f\u007f]/.test(source)
    && segments.every((segment) => segment && segment !== "." && segment !== "..");
}

function createAssetPackager({
  zip,
  readProtocolAsset,
  nextAssetPath,
  maxAssetBytes = DEFAULT_MAX_ASSET_BYTES,
  maxTotalAssetBytes = DEFAULT_MAX_TOTAL_ASSET_BYTES,
  maxAssetEntries = DEFAULT_MAX_ASSET_ENTRIES,
} = {}) {
  if (!zip?.file || typeof readProtocolAsset !== "function" || typeof nextAssetPath !== "function") {
    throw new Error("图片资源打包器配置不完整");
  }
  const bySource = new Map();
  const byContent = new Map();
  let totalAssetBytes = 0;

  const existingPackagedAssetPath = (value) => {
    if (!isPackagedAssetPath(value)) return "";
    const normalized = String(value).replace(/\\/g, "/").replace(/^\/+/, "");
    const entry = zip.file(normalized);
    return entry && !entry.dir ? normalized : "";
  };

  const addBuffer = (asset, preferredPath = "") => {
    if (!asset?.buffer?.length) throw new Error("图片资源数据为空");
    if (asset.buffer.length > maxAssetBytes) throw new Error("资源超过安全大小上限");
    const contentKey = createHash("sha256").update(asset.buffer).digest("hex");
    const existingPath = byContent.get(contentKey);
    if (existingPath) return existingPath;
    if (byContent.size >= maxAssetEntries) throw new Error("信笺包含过多独立资源，文档未保存");
    if (totalAssetBytes + asset.buffer.length > maxTotalAssetBytes) throw new Error("信笺资源总量超过安全上限");
    const preferredExtension = path.extname(String(preferredPath || "")).toLowerCase();
    const hintedExtension = path.extname(String(asset.extension || "")).toLowerCase();
    const extension = (SAFE_ASSET_EXTENSIONS.has(preferredExtension) ? preferredExtension : "")
      || (SAFE_ASSET_EXTENSIONS.has(hintedExtension) ? hintedExtension : "")
      || extensionFromMime(asset.mime);
    const targetPath = nextAssetPath(zip, preferredPath, extension);
    zip.file(targetPath, asset.buffer, { compression: "STORE", createFolders: false });
    byContent.set(contentKey, targetPath);
    totalAssetBytes += asset.buffer.length;
    return targetPath;
  };

  const copyProtocol = async (sourceUrl, preferredPath = "") => {
    const cachedPath = bySource.get(sourceUrl);
    if (cachedPath) return cachedPath;
    const remainingBytes = maxTotalAssetBytes - totalAssetBytes;
    if (remainingBytes <= 0) throw new Error("信笺资源总量超过安全上限");
    let asset;
    try {
      asset = await readProtocolAsset(sourceUrl, { maxBytes: Math.min(maxAssetBytes, remainingBytes) });
    } catch (error) {
      throw new Error(`图片资源地址无效、未注册或已经失效，文档未保存：${error?.message || "无法读取资源"}`, { cause: error });
    }
    const sourcePreferredPath = asset.kind === "document" ? asset.assetPath : "";
    const targetPath = addBuffer(asset, preferredPath || sourcePreferredPath);
    bySource.set(sourceUrl, targetPath);
    return targetPath;
  };

  const copyDataUrl = (sourceUrl, preferredPath = "") => {
    const cachedPath = bySource.get(sourceUrl);
    if (cachedPath) return cachedPath;
    const remainingBytes = maxTotalAssetBytes - totalAssetBytes;
    if (remainingBytes <= 0) throw new Error("信笺资源总量超过安全上限");
    const decoded = dataUrlToBuffer(sourceUrl, Math.min(maxAssetBytes, remainingBytes));
    if (!decoded) throw new Error("旧版内嵌图片数据无法读取，文档未保存");
    const targetPath = addBuffer(decoded, preferredPath);
    bySource.set(sourceUrl, targetPath);
    return targetPath;
  };

  const packageSource = async (sourceUrl, preferredPath = "") => {
    if (String(sourceUrl || "").startsWith("paperwriter-asset://")) return copyProtocol(sourceUrl, preferredPath);
    if (String(sourceUrl || "").startsWith("data:")) return copyDataUrl(sourceUrl, preferredPath);
    const existingPath = existingPackagedAssetPath(sourceUrl);
    if (existingPath) return existingPath;
    throw new Error("资源尚未暂存或已经失效，文档未保存");
  };

  const packageHtml = async (html) => {
    let packagedHtml = String(html || "");
    const protocolUrls = [...new Set([...packagedHtml.matchAll(PROTOCOL_SOURCE_PATTERN)].map((match) => match[2]))];
    for (const sourceUrl of protocolUrls) await copyProtocol(sourceUrl);
    packagedHtml = packagedHtml.replace(PROTOCOL_SOURCE_PATTERN, (full, quote, sourceUrl) => `src=${quote}${bySource.get(sourceUrl)}${quote}`);
    packagedHtml = packagedHtml.replace(DATA_SOURCE_PATTERN, (full, quote, sourceUrl) => `src=${quote}${copyDataUrl(sourceUrl)}${quote}`);
    const unresolvedSource = [...packagedHtml.matchAll(HTML_SOURCE_PATTERN)]
      .map((match) => match[2])
      .find((sourceUrl) => !existingPackagedAssetPath(sourceUrl));
    if (unresolvedSource) throw new Error("文档包含未暂存或已经失效的资源，文档未保存");
    return packagedHtml;
  };

  return {
    addBuffer,
    byContent,
    bySource,
    copyDataUrl,
    copyProtocol,
    packageHtml,
    packageSource,
    totalAssetBytes: () => totalAssetBytes,
  };
}

module.exports = {
  DEFAULT_MAX_ASSET_BYTES,
  DEFAULT_MAX_ASSET_ENTRIES,
  DEFAULT_MAX_TOTAL_ASSET_BYTES,
  createAssetPackager,
  dataUrlToBuffer,
  extensionFromMime,
  isAlreadyCompressedMedia,
  isPackagedAssetPath,
};
