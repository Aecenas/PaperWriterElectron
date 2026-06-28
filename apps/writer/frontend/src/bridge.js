function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function pickImageInBrowser() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/bmp";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ canceled: true });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          canceled: false,
          name: file.name.replace(/\.[^.]+$/, ""),
          path: file.name,
          dataUrl: reader.result,
        });
      };
      reader.onerror = () => resolve({ canceled: true });
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

const browserBridge = {
  isElectron: false,
  getPaths: async () => ({
    documents: "Browser preview",
    autosave: "localStorage:paperwriter.autosave",
    userData: "localStorage",
  }),
  openDocument: async () => ({ canceled: true }),
  openDocumentPath: async () => ({ canceled: true }),
  openFolder: async () => ({ canceled: true, files: [] }),
  listFolder: async () => ({ canceled: true, files: [] }),
  saveDocument: async (document) => {
    writeJson("paperwriter.preview.document", document);
    return { canceled: false, path: "browser-preview.letterpaper" };
  },
  exportPdf: async () => {
    window.print();
    return { canceled: false, path: "browser-print-dialog" };
  },
  exportPageImages: async () => ({ canceled: true }),
  pickImage: pickImageInBrowser,
  loadAutosave: async () => {
    const document = readJson("paperwriter.autosave", null);
    return document ? { exists: true, document, path: "localStorage:paperwriter.autosave" } : { exists: false };
  },
  saveAutosave: async (document) => {
    writeJson("paperwriter.autosave", document);
    return { path: "localStorage:paperwriter.autosave" };
  },
  clearAutosave: async () => {
    localStorage.removeItem("paperwriter.autosave");
    return { ok: true };
  },
  getUpdateState: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  checkForUpdates: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  downloadUpdate: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  installUpdate: async () => ({ status: "browser", message: "浏览器预览不支持更新" }),
  onUpdateState: () => () => {},
};

export const bridge = window.paperWriter ?? browserBridge;
