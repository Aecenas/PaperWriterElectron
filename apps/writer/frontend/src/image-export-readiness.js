const DEFAULT_IMAGE_EXPORT_TIMEOUT_MS = 15_000;

function waitForImageLoad(image) {
  if (image.complete) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      image.removeEventListener("load", handleLoad);
      image.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("导出图片中的原图加载失败，请确认正文图片可见后重试"));
    };
    image.addEventListener("load", handleLoad, { once: true });
    image.addEventListener("error", handleError, { once: true });
  });
}

async function ensureImageReady(image) {
  image.setAttribute("loading", "eager");
  image.setAttribute("decoding", "sync");
  await waitForImageLoad(image);
  if (!(image.naturalWidth > 0) || !(image.naturalHeight > 0)) {
    throw new Error("导出图片中的原图加载失败，请确认正文图片可见后重试");
  }
  if (typeof image.decode === "function") {
    try {
      await image.decode();
    } catch {
      throw new Error("导出图片中的原图解码失败，请确认正文图片可见后重试");
    }
  }
}

export async function waitForImageExportAssets(root, timeoutMs = DEFAULT_IMAGE_EXPORT_TIMEOUT_MS) {
  const images = Array.from(root?.querySelectorAll?.("img[src]") || []);
  if (!images.length) return { count: 0 };

  let timeoutId;
  try {
    await Promise.race([
      Promise.all(images.map((image) => ensureImageReady(image))),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error("导出图片中的原图加载超时，请稍后重试"));
        }, Math.max(1, Number(timeoutMs) || DEFAULT_IMAGE_EXPORT_TIMEOUT_MS));
      }),
    ]);
    return { count: images.length };
  } finally {
    clearTimeout(timeoutId);
  }
}
