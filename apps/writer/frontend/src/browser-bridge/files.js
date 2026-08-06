function assertBrowserResourcesArePersistable(document = {}) {
  const html = typeof document?.html === "string" ? document.html : "";
  const customBackground = typeof document?.customBackground === "string" ? document.customBackground : "";
  const aiImages = document?.aiState?.optimize?.assets?.images;
  const imageSources = aiImages && typeof aiImages === "object"
    ? Object.values(aiImages).map((image) => image?.src)
    : [];
  if (/\bsrc=(["'])blob:[^"']+\1/i.test(html) || /^blob:/i.test(customBackground) || imageSources.some((source) => /^blob:/i.test(String(source || "")))) {
    throw new Error("文档包含仅在当前页面有效的临时图片；请重新选择图片后再保存");
  }
}

function pickFileInBrowser({ kind, accept, maxBytes = 0, allowedExtensions = [] }) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ canceled: true });
        return;
      }
      const extension = file.name.toLowerCase().split(".").pop();
      if (allowedExtensions.length && !allowedExtensions.includes(extension)) {
        resolve({ canceled: false, error: "unsupported-type", kind, extension });
        return;
      }
      if (maxBytes && file.size > maxBytes) {
        resolve({ canceled: false, error: "too-large", kind, size: file.size, maxBytes });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          canceled: false,
          kind,
          name: file.name.replace(/\.[^.]+$/, ""),
          fileName: file.name,
          path: file.name,
          mime: file.type,
          size: file.size,
          dataUrl: reader.result,
        });
      };
      reader.onerror = () => resolve({ canceled: false, error: "read-failed", kind });
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

function pickImageInBrowser() {
  return pickFileInBrowser({
    kind: "image",
    accept: "image/png,image/jpeg,image/gif,image/webp,image/bmp",
    maxBytes: 32 * 1024 * 1024,
    allowedExtensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
  });
}

function pickAudioInBrowser() {
  return pickFileInBrowser({
    kind: "audio",
    accept: ".mp3,.wav,.ogg,.m4a,.aac,.flac,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/flac",
    maxBytes: 20 * 1024 * 1024,
    allowedExtensions: ["mp3", "wav", "ogg", "m4a", "aac", "flac"],
  });
}

function pickVideoInBrowser() {
  return pickFileInBrowser({
    kind: "video",
    accept: ".mp4,.webm,.ogv,video/mp4,video/webm,video/ogg",
    maxBytes: 100 * 1024 * 1024,
    allowedExtensions: ["mp4", "webm", "ogv"],
  });
}

export {
  assertBrowserResourcesArePersistable,
  pickAudioInBrowser,
  pickImageInBrowser,
  pickVideoInBrowser,
};
