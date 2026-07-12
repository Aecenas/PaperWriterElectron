const fs = require("node:fs/promises");
const path = require("node:path");

const CODEX_IMAGE_MODES = new Set(["original", "caption-only"]);
const IMAGE_MIME_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/bmp", ".bmp"],
  ["image/svg+xml", ".svg"],
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

function decodeImageDataUrl(value) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(String(value || ""));
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
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
    for (let index = 0; index < normalized.length; index += 1) {
      const image = normalized[index];
      let asset = decodeImageDataUrl(image.src);
      if (!asset && image.src.startsWith("paperwriter-asset://") && typeof readProtocolAsset === "function") {
        try {
          asset = await readProtocolAsset(image.src);
        } catch (error) {
          throw attachmentError(image, error?.message || "内嵌资源不存在");
        }
      }
      if (!asset?.buffer?.length) throw attachmentError(image, "图片数据为空或来源无效");
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
  normalizeCodexImageAttachments,
  normalizeCodexImageMode,
};
