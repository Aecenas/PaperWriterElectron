const fs = require("node:fs/promises");
const path = require("node:path");

const CODEX_IMAGE_MODES = new Set(["original", "caption-only"]);
const MAX_CODEX_IMAGE_ATTACHMENTS = 32;
const MAX_CODEX_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_CODEX_IMAGE_TOTAL_BYTES = 256 * 1024 * 1024;
const IMAGE_MIME_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/bmp", ".bmp"],
  ["image/svg+xml", ".svg"],
  ["image/avif", ".avif"],
]);

function normalizeCodexImageMode(value) {
  return CODEX_IMAGE_MODES.has(value) ? value : "original";
}

function normalizeCodexImageAttachments(images = []) {
  if (!Array.isArray(images)) return [];
  return images.map((image, index) => ({
    number: Math.max(1, Math.floor(Number(image?.number) || index + 1)),
    caption: String(image?.caption || image?.alt || "图片").trim().slice(0, 240) || "图片",
    src: typeof image?.src === "string" ? image.src : "",
    mime: typeof image?.mime === "string" ? image.mime.toLowerCase() : "",
  }));
}

function decodeImageDataUrl(value, maximumBytes = Infinity) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(value || ""));
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const encoded = match[2].replace(/\s/g, "");
  if (Math.floor(encoded.length * 3 / 4) > maximumBytes) throw new Error("图片数据超过 AI 附件安全上限");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length > maximumBytes) throw new Error("图片数据超过 AI 附件安全上限");
  return buffer.length ? { mime, buffer } : null;
}

function imageExtension(mime) {
  return IMAGE_MIME_EXTENSIONS.get(String(mime || "").toLowerCase()) || "";
}

function attachmentError(image, detail = "") {
  const suffix = detail ? `：${detail}` : "";
  return new Error(`图${image.number}“${image.caption}”无法作为原图读取${suffix}。请修复图片，或切换为“仅标题”后重试。`);
}

async function materializeCodexImageAttachments({
  images = [],
  tempRoot,
  readProtocolAsset,
  fsApi = fs,
  pathApi = path,
} = {}) {
  if (Array.isArray(images) && images.length > MAX_CODEX_IMAGE_ATTACHMENTS) {
    throw new Error(`一次最多向 Codex 附加 ${MAX_CODEX_IMAGE_ATTACHMENTS} 张原图`);
  }
  const normalized = normalizeCodexImageAttachments(images);
  if (!normalized.length) {
    return { attachments: [], imagePaths: [], cleanup: async () => {} };
  }
  if (!tempRoot) throw new Error("缺少 Codex 图片临时目录");
  await fsApi.mkdir(tempRoot, { recursive: true });
  const tempDirectory = await fsApi.mkdtemp(pathApi.join(tempRoot, "paperwriter-images-"));
  const cleanup = async () => {
    await fsApi.rm(tempDirectory, { recursive: true, force: true });
  };
  try {
    const attachments = [];
    let totalBytes = 0;
    for (let index = 0; index < normalized.length; index += 1) {
      const image = normalized[index];
      let asset = decodeImageDataUrl(image.src, MAX_CODEX_IMAGE_BYTES);
      if (!asset && image.src.startsWith("paperwriter-asset://") && typeof readProtocolAsset === "function") {
        try {
          asset = await readProtocolAsset(image.src, { maxBytes: MAX_CODEX_IMAGE_BYTES });
        } catch (error) {
          throw attachmentError(image, error?.message || "内嵌资源不存在");
        }
      }
      if (!asset?.buffer?.length) throw attachmentError(image, "图片数据为空或来源无效");
      if (asset.buffer.length > MAX_CODEX_IMAGE_BYTES) throw attachmentError(image, "图片超过 64 MB 安全上限");
      totalBytes += asset.buffer.length;
      if (totalBytes > MAX_CODEX_IMAGE_TOTAL_BYTES) throw new Error("Codex 原图附件总量超过 256 MB 安全上限");
      const mime = String(asset.mime || image.mime || "").toLowerCase();
      const extension = imageExtension(mime);
      if (!extension) throw attachmentError(image, `不支持的图片格式 ${mime || "未知"}`);
      const filePath = pathApi.join(tempDirectory, `image-${String(index + 1).padStart(4, "0")}${extension}`);
      await fsApi.writeFile(filePath, asset.buffer);
      attachments.push({ ...image, mime, path: filePath, attachmentIndex: index + 1 });
    }
    return { attachments, imagePaths: attachments.map((image) => image.path), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

module.exports = {
  decodeImageDataUrl,
  imageExtension,
  materializeCodexImageAttachments,
  MAX_CODEX_IMAGE_ATTACHMENTS,
  MAX_CODEX_IMAGE_BYTES,
  MAX_CODEX_IMAGE_TOTAL_BYTES,
  normalizeCodexImageAttachments,
  normalizeCodexImageMode,
};
