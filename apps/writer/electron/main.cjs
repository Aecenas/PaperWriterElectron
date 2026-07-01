const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, screen, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs/promises");
const path = require("node:path");
const JSZip = require("jszip");

const APP_ROOT = path.resolve(__dirname, "..");
const FRONTEND_URL = process.env.PAPERWRITER_FRONTEND_URL || "";
const APP_ICON = path.resolve(__dirname, "assets", process.platform === "win32" ? "app-icon.ico" : "app-icon.png");
const DATA_URL_PATTERN = /src=(["'])(data:image\/[^"']+)\1/gi;
const ASSET_URL_PATTERN = /src=(["'])(assets\/[^"']+)\1/gi;
const DOCUMENT_EXTENSION = ".letterpaper";
const LEGACY_DOCUMENT_EXTENSION = ".paperdoc";
const DOCUMENT_FILTERS = [
  { name: "信笺写作文档", extensions: ["letterpaper"] },
  { name: "旧版 PaperWriter 文档", extensions: ["paperdoc"] },
  { name: "All Files", extensions: ["*"] },
];
const AI_DEBUG_LOG_MAX_BYTES = 2 * 1024 * 1024;

let mainWindow = null;
let updateState = {
  status: "idle",
  message: "尚未检查更新",
  version: app.getVersion(),
};

Menu.setApplicationMenu(null);
autoUpdater.autoDownload = false;

function aiDebugLogPath() {
  return path.join(path.dirname(app.getPath("exe")), "ai-debug.log");
}

function fallbackAiDebugLogPath() {
  return path.join(app.getPath("userData"), "ai-debug.log");
}

async function writeAiDebugLog(event, data = {}) {
  const writeLog = async (logPath, fallbackReason = "") => {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    try {
      const stat = await fs.stat(logPath);
      if (stat.size > AI_DEBUG_LOG_MAX_BYTES) {
        await fs.rm(`${logPath}.old`, { force: true });
        await fs.rename(logPath, `${logPath}.old`);
      }
    } catch {
      // No existing log yet.
    }
    const payload = {
      time: new Date().toISOString(),
      pid: process.pid,
      event,
      data: fallbackReason ? { ...data, fallbackReason } : data,
    };
    await fs.appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8");
    return logPath;
  };

  try {
    return await writeLog(aiDebugLogPath());
  } catch (error) {
    try {
      return await writeLog(fallbackAiDebugLogPath(), error?.message || "install-dir-write-failed");
    } catch {
      // Debug logging must never break user workflows.
      return "";
    }
  }
}

function frontendDistPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "frontend", "dist", "index.html");
  }
  return path.resolve(__dirname, "..", "frontend", "dist", "index.html");
}

function emitUpdateState(patch) {
  updateState = {
    ...updateState,
    ...patch,
    version: app.getVersion(),
  };
  mainWindow?.webContents.send("update:state", updateState);
  return updateState;
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = Math.min(1440, Math.max(1080, Math.floor(workArea.width * 0.92)));
  const windowHeight = Math.min(940, Math.max(720, Math.floor(workArea.height * 0.9)));

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 1040,
    minHeight: 720,
    center: true,
    title: "信笺写作",
    icon: APP_ICON,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#c8d8d4",
      symbolColor: "#334155",
      height: 40,
    },
    autoHideMenuBar: true,
    backgroundColor: "#edf6f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (FRONTEND_URL) {
    mainWindow.loadURL(FRONTEND_URL);
    return;
  }

  mainWindow.loadFile(frontendDistPath()).catch((error) => {
    dialog.showErrorBox(
      "信笺写作",
      `Frontend build not found. Run npm run build in apps/writer/frontend first.\n\n${error.message}`,
    );
  });
}

autoUpdater.on("checking-for-update", () => {
  emitUpdateState({ status: "checking", message: "正在检查更新..." });
});

autoUpdater.on("update-available", (info) => {
  emitUpdateState({
    status: "available",
    message: `发现新版本 ${info.version}`,
    availableVersion: info.version,
  });
});

autoUpdater.on("update-not-available", () => {
  emitUpdateState({ status: "none", message: "当前已经是最新版本" });
});

autoUpdater.on("download-progress", (progress) => {
  emitUpdateState({
    status: "downloading",
    message: `正在下载更新 ${Math.round(progress.percent || 0)}%`,
    percent: Math.round(progress.percent || 0),
  });
});

autoUpdater.on("update-downloaded", (info) => {
  emitUpdateState({
    status: "downloaded",
    message: `版本 ${info.version} 已下载，重启后安装`,
    availableVersion: info.version,
  });
});

autoUpdater.on("error", (error) => {
  emitUpdateState({
    status: "error",
    message: `更新失败：${error.message}`,
  });
});

function ensureExtension(filePath, extension) {
  return path.extname(filePath).toLowerCase() === extension ? filePath : `${filePath}${extension}`;
}

function defaultDocumentsDir() {
  return path.join(app.getPath("documents"), "PaperWriter");
}

function sanitizeName(name, fallback = "未命名") {
  return String(name || "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || fallback;
}

function timestampForFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatPaperDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "今天";
  }
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

async function uniquePath(targetPath) {
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  let index = 2;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(parsed.dir, `${parsed.name} ${index}${parsed.ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

function autosavePath() {
  return path.join(app.getPath("userData"), "Autosave", `autosave${DOCUMENT_EXTENSION}`);
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function isSupportedDocument(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === DOCUMENT_EXTENSION || extension === LEGACY_DOCUMENT_EXTENSION;
}

function normalizeDocument(document = {}) {
  const now = new Date().toISOString();
  const createdAt = typeof document.createdAt === "string" && document.createdAt
    ? document.createdAt
    : (typeof document.updatedAt === "string" && document.updatedAt ? document.updatedAt : now);
  return {
    version: 1,
    title: typeof document.title === "string" && document.title.trim() ? document.title.trim() : "未命名信笺",
    author: typeof document.author === "string" ? document.author.trim().slice(0, 40) : "",
    html: typeof document.html === "string" && document.html.trim() ? document.html : "<p></p>",
    templateId: typeof document.templateId === "string" && document.templateId ? document.templateId : "warm",
    fontFamily: typeof document.fontFamily === "string" && document.fontFamily ? document.fontFamily : "LXGW WenKai Screen",
    fontSize: Number.isFinite(Number(document.fontSize)) ? Math.min(32, Math.max(12, Number(document.fontSize))) : 18,
    layoutMode: "flow",
    customBackground: typeof document.customBackground === "string" && document.customBackground ? document.customBackground : "",
    createdAt,
    displayDate: typeof document.displayDate === "string" && document.displayDate.trim()
      ? document.displayDate.trim().slice(0, 40)
      : formatPaperDate(createdAt),
    updatedAt: typeof document.updatedAt === "string" && document.updatedAt ? document.updatedAt : now,
  };
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    return null;
  }

  return {
    mime: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function extensionFromMime(mime) {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/bmp":
      return ".bmp";
    case "image/svg+xml":
      return ".svg";
    default:
      return ".png";
  }
}

function mimeFromPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}

async function fileToDataUrl(filePath) {
  const buffer = await fs.readFile(filePath);
  return `data:${mimeFromPath(filePath)};base64,${buffer.toString("base64")}`;
}

function extractDataImages(zip, html) {
  let index = 0;
  return html.replace(DATA_URL_PATTERN, (full, quote, dataUrl) => {
    const decoded = dataUrlToBuffer(dataUrl);
    if (!decoded) {
      return full;
    }

    index += 1;
    const assetPath = `assets/image-${String(index).padStart(4, "0")}${extensionFromMime(decoded.mime)}`;
    zip.file(assetPath, decoded.buffer);
    return `src=${quote}${assetPath}${quote}`;
  });
}

async function hydrateAssetImages(zip, html) {
  const matches = [...html.matchAll(ASSET_URL_PATTERN)];
  let hydrated = html;
  for (const match of matches) {
    const [full, quote, assetPath] = match;
    const file = zip.file(assetPath);
    if (!file) {
      continue;
    }

    const buffer = await file.async("nodebuffer");
    const dataUrl = `data:${mimeFromPath(assetPath)};base64,${buffer.toString("base64")}`;
    hydrated = hydrated.replace(full, `src=${quote}${dataUrl}${quote}`);
  }
  return hydrated;
}

async function savePaperDocument(filePath, document) {
  const normalized = normalizeDocument(document);
  const zip = new JSZip();
  const packagedDocument = { ...normalized };

  packagedDocument.html = extractDataImages(zip, packagedDocument.html);
  if (packagedDocument.customBackground?.startsWith("data:")) {
    const decoded = dataUrlToBuffer(packagedDocument.customBackground);
    if (decoded) {
      const backgroundPath = `assets/background${extensionFromMime(decoded.mime)}`;
      zip.file(backgroundPath, decoded.buffer);
      packagedDocument.customBackground = backgroundPath;
    }
  }

  zip.file("document.json", JSON.stringify(packagedDocument, null, 2));
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, output);
}

async function loadPaperDocument(filePath) {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file("document.json");
  if (!documentFile) {
    throw new Error("这个信笺文档缺少 document.json。");
  }

  const raw = await documentFile.async("string");
  const parsedDocument = JSON.parse(raw);
  if (!parsedDocument.createdAt) {
    try {
      const stat = await fs.stat(filePath);
      parsedDocument.createdAt = stat.birthtime?.toISOString?.() || stat.ctime?.toISOString?.() || parsedDocument.updatedAt;
    } catch {
      // Fall back to updatedAt in normalizeDocument.
    }
  }
  const document = normalizeDocument(parsedDocument);
  document.html = await hydrateAssetImages(zip, document.html);

  if (document.customBackground && !document.customBackground.startsWith("data:")) {
    const backgroundFile = zip.file(document.customBackground);
    if (backgroundFile) {
      const background = await backgroundFile.async("nodebuffer");
      document.customBackground = `data:${mimeFromPath(document.customBackground)};base64,${background.toString("base64")}`;
    }
  }

  return document;
}

ipcMain.handle("app:get-paths", async () => {
  await fs.mkdir(defaultDocumentsDir(), { recursive: true });
  await fs.mkdir(path.dirname(autosavePath()), { recursive: true });
  return {
    desktop: app.getPath("desktop"),
    documents: defaultDocumentsDir(),
    autosave: autosavePath(),
    userData: app.getPath("userData"),
    aiDebugLog: aiDebugLogPath(),
  };
});

ipcMain.handle("debug:log", async (_event, event, data) => {
  const logPath = await writeAiDebugLog(String(event || "renderer"), data || {});
  return { ok: true, path: logPath || aiDebugLogPath() };
});

ipcMain.handle("update:get-state", async () => updateState);

ipcMain.handle("update:check", async () => {
  if (!app.isPackaged) {
    return emitUpdateState({
      status: "dev",
      message: "开发版不能检查更新，打包安装后可用",
    });
  }
  try {
    await autoUpdater.checkForUpdates();
    return updateState;
  } catch (error) {
    return emitUpdateState({
      status: "error",
      message: `更新失败：${error.message}`,
    });
  }
});

ipcMain.handle("update:download", async () => {
  if (!app.isPackaged) {
    return emitUpdateState({
      status: "dev",
      message: "开发版不能下载更新，打包安装后可用",
    });
  }
  try {
    await autoUpdater.downloadUpdate();
    return updateState;
  } catch (error) {
    return emitUpdateState({
      status: "error",
      message: `下载失败：${error.message}`,
    });
  }
});

ipcMain.handle("update:install", async () => {
  if (updateState.status !== "downloaded") {
    return updateState;
  }
  autoUpdater.quitAndInstall(false, true);
  return updateState;
});

ipcMain.handle("document:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "打开信笺",
    defaultPath: defaultDocumentsDir(),
    properties: ["openFile"],
    filters: DOCUMENT_FILTERS,
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  const document = await loadPaperDocument(filePath);
  return { canceled: false, path: filePath, document };
});

ipcMain.handle("document:open-path", async (_event, filePath) => {
  if (!filePath) {
    return { canceled: true };
  }
  if (!isSupportedDocument(filePath)) {
    return { canceled: true };
  }
  try {
    const document = await loadPaperDocument(filePath);
    return { canceled: false, path: filePath, document };
  } catch {
    return { canceled: true };
  }
});

ipcMain.handle("folder:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "打开信笺文件夹",
    defaultPath: app.getPath("desktop"),
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  return { canceled: false, ...(await listFolderEntries(result.filePaths[0])) };
});

ipcMain.handle("folder:list", async (_event, folderPath) => {
  const startedAt = Date.now();
  if (!folderPath) {
    await writeAiDebugLog("folder:list:empty-path");
    return { canceled: true, files: [], folders: [], entries: [] };
  }
  try {
    await writeAiDebugLog("folder:list:start", { folderPath });
    const listed = await listFolderEntries(folderPath);
    await writeAiDebugLog("folder:list:success", {
      folderPath,
      ms: Date.now() - startedAt,
      folders: listed.folders.length,
      files: listed.files.length,
    });
    return { canceled: false, ...listed };
  } catch (error) {
    await writeAiDebugLog("folder:list:error", {
      folderPath,
      ms: Date.now() - startedAt,
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });
    return { canceled: true, folderPath: "", files: [], folders: [], entries: [] };
  }
});

ipcMain.handle("folder:copy-path", async (_event, folderPath) => {
  if (!folderPath) {
    return { ok: false };
  }
  clipboard.writeText(String(folderPath));
  return { ok: true };
});

ipcMain.handle("folder:show", async (_event, folderPath) => {
  if (!folderPath) {
    return { ok: false };
  }
  const error = await shell.openPath(String(folderPath));
  return { ok: !error, error };
});

ipcMain.handle("folder:create", async (_event, parentPath, name) => {
  if (!parentPath) {
    return { ok: false, message: "缺少目标文件夹" };
  }
  const folderName = sanitizeName(name, "新建文件夹");
  const targetPath = await uniquePath(path.join(String(parentPath), folderName));
  await fs.mkdir(targetPath, { recursive: false });
  return { ok: true, path: targetPath, ...(await listFolderEntries(String(parentPath))) };
});

ipcMain.handle("document:create-in-folder", async (_event, folderPath, title) => {
  if (!folderPath) {
    return { ok: false, message: "缺少目标文件夹" };
  }
  const safeTitle = sanitizeName(title, "未命名信笺");
  const filePath = await uniquePath(path.join(String(folderPath), `${safeTitle}${DOCUMENT_EXTENSION}`));
  const document = normalizeDocument({
    title: safeTitle,
    html: "<p></p>",
  });
  await savePaperDocument(filePath, document);
  return { ok: true, path: filePath, document, ...(await listFolderEntries(String(folderPath))) };
});

ipcMain.handle("entry:rename", async (_event, targetPath, nextName) => {
  if (!targetPath) {
    return { ok: false, message: "缺少目标路径" };
  }
  const currentPath = String(targetPath);
  const stat = await fs.stat(currentPath);
  const parsed = path.parse(currentPath);
  let safeName = sanitizeName(nextName, parsed.name);
  if (stat.isFile() && isSupportedDocument(currentPath)) {
    const typedExtension = path.extname(safeName).toLowerCase();
    if (typedExtension === DOCUMENT_EXTENSION || typedExtension === LEGACY_DOCUMENT_EXTENSION) {
      safeName = path.basename(safeName, typedExtension);
    }
  }
  const nextPath = path.join(parsed.dir, stat.isFile() && isSupportedDocument(currentPath) ? `${safeName}${DOCUMENT_EXTENSION}` : safeName);
  if (nextPath === currentPath) {
    return { ok: true, path: currentPath, ...(await listFolderEntries(parsed.dir)) };
  }
  try {
    await fs.access(nextPath);
    return { ok: false, message: "同名项目已经存在" };
  } catch {
    await fs.rename(currentPath, nextPath);
    return { ok: true, oldPath: currentPath, path: nextPath, ...(await listFolderEntries(parsed.dir)) };
  }
});

ipcMain.handle("entry:delete", async (_event, targetPath) => {
  if (!targetPath) {
    return { ok: false, message: "缺少目标路径" };
  }
  const currentPath = String(targetPath);
  const parentPath = path.dirname(currentPath);
  if (typeof shell.trashItem === "function") {
    await shell.trashItem(currentPath);
  } else {
    const stat = await fs.stat(currentPath);
    await fs.rm(currentPath, { recursive: stat.isDirectory(), force: true });
  }
  return { ok: true, deletedPath: currentPath, ...(await listFolderEntries(parentPath)) };
});

ipcMain.handle("entry:move", async (_event, sourcePath, targetFolderPath) => {
  if (!sourcePath || !targetFolderPath) {
    return { ok: false, message: "缺少移动路径" };
  }
  const fromPath = String(sourcePath);
  const toFolder = String(targetFolderPath);
  const sourceStat = await fs.stat(fromPath);
  const targetStat = await fs.stat(toFolder);
  if (!targetStat.isDirectory()) {
    return { ok: false, message: "目标不是文件夹" };
  }
  if (sourceStat.isDirectory()) {
    const relative = path.relative(fromPath, toFolder);
    if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return { ok: false, message: "不能把文件夹移动到自身内部" };
    }
  }

  const sourceParent = path.dirname(fromPath);
  if (sourceParent === toFolder) {
    return { ok: false, message: "已经在这个文件夹里" };
  }

  const targetPath = await uniquePath(path.join(toFolder, path.basename(fromPath)));
  await fs.rename(fromPath, targetPath);
  return {
    ok: true,
    oldPath: fromPath,
    path: targetPath,
    sourceParent,
    targetFolderPath: toFolder,
  };
});

ipcMain.handle("document:backup", async (_event, filePath) => {
  if (!filePath || !isSupportedDocument(filePath)) {
    return { ok: false, message: "只能备份信笺文件" };
  }
  const sourcePath = String(filePath);
  const parsed = path.parse(sourcePath);
  const backupPath = await uniquePath(path.join(parsed.dir, `${parsed.name}_备份_${timestampForFileName()}${DOCUMENT_EXTENSION}`));
  await fs.copyFile(sourcePath, backupPath);
  return { ok: true, path: backupPath, ...(await listFolderEntries(parsed.dir)) };
});

async function listFolderEntries(folderPath) {
  const startedAt = Date.now();
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  await writeAiDebugLog("folder:entries:readdir", {
    folderPath,
    ms: Date.now() - startedAt,
    count: entries.length,
  });
  const parent = path.dirname(folderPath);
  const parentPath = parent && parent !== folderPath ? parent : "";
  const folders = [];
  const files = [];
  for (const entry of entries) {
    const filePath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      const childStartedAt = Date.now();
      let hasLetterpapers = false;
      try {
        hasLetterpapers = await folderHasDocument(filePath);
        await writeAiDebugLog("folder:child-scan", {
          folderPath: filePath,
          ms: Date.now() - childStartedAt,
          hasLetterpapers,
        });
      } catch (error) {
        await writeAiDebugLog("folder:child-scan:error", {
          folderPath: filePath,
          ms: Date.now() - childStartedAt,
          code: error?.code,
          message: error?.message,
        });
        // Ignore directories that cannot be read.
      }
      folders.push({
        type: "folder",
        name: entry.name,
        path: filePath,
        hasLetterpapers,
        updatedAt: "",
      });
      continue;
    }

    if (!entry.isFile() || !isSupportedDocument(filePath)) {
      continue;
    }

    const stat = await fs.stat(filePath);
    const displayName = path.basename(entry.name, path.extname(entry.name));
    files.push({
      type: "file",
      name: entry.name,
      displayName,
      path: filePath,
      extension: path.extname(entry.name).toLowerCase(),
      updatedAt: stat.mtime.toISOString(),
      size: stat.size,
    });
  }

  folders.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  files.sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
  return {
    folderPath,
    parentPath,
    folders,
    files,
    entries: [...folders, ...files],
  };
}

async function folderHasDocument(folderPath) {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && isSupportedDocument(path.join(folderPath, entry.name))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

ipcMain.handle("document:save", async (_event, document, currentPath, saveAs) => {
  let filePath = currentPath;
  if (saveAs || !filePath) {
    const safeTitle = normalizeDocument(document).title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "未命名信笺";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "保存信笺",
      defaultPath: path.join(defaultDocumentsDir(), `${safeTitle}${DOCUMENT_EXTENSION}`),
      filters: DOCUMENT_FILTERS,
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    filePath = isSupportedDocument(result.filePath) ? result.filePath : ensureExtension(result.filePath, DOCUMENT_EXTENSION);
  }

  await savePaperDocument(filePath, document);
  return { canceled: false, path: filePath };
});

ipcMain.handle("document:export-pdf", async (_event, suggestedName) => {
  const safeName = String(suggestedName || "未命名信笺").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "未命名信笺";
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出 PDF",
    defaultPath: path.join(defaultDocumentsDir(), `${safeName}.pdf`),
    filters: [
      { name: "PDF 文档", extensions: ["pdf"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  const filePath = ensureExtension(result.filePath, ".pdf");
  const pdf = await mainWindow.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    landscape: false,
    margins: {
      marginType: "none",
    },
  });
  await ensureParentDir(filePath);
  await fs.writeFile(filePath, pdf);
  return { canceled: false, path: filePath };
});

ipcMain.handle("document:export-page-images", async (_event, suggestedName, pageRects) => {
  const safeName = String(suggestedName || "未命名信笺").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "未命名信笺";
  const rects = Array.isArray(pageRects)
    ? pageRects
        .map((rect) => ({
          x: Number(rect.x),
          y: Number(rect.y),
          width: Number(rect.width),
          height: Number(rect.height),
        }))
        .filter((rect) => rect.width > 0 && rect.height > 0)
    : [];

  if (!rects.length) {
    return { canceled: true };
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导出分页图片",
    defaultPath: path.join(defaultDocumentsDir(), safeName),
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  const outputDir = result.filePaths[0];
  await fs.mkdir(outputDir, { recursive: true });
  const debuggerApi = mainWindow.webContents.debugger;
  let attachedHere = false;
  try {
    if (!debuggerApi.isAttached()) {
      debuggerApi.attach("1.3");
      attachedHere = true;
    }
    await debuggerApi.sendCommand("Page.enable");
    const files = [];
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index];
      const capture = await debuggerApi.sendCommand("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: Math.max(0, rect.x),
          y: Math.max(0, rect.y),
          width: rect.width,
          height: rect.height,
          scale: 1,
        },
      });
      const filePath = path.join(outputDir, `${safeName}-${String(index + 1).padStart(2, "0")}.png`);
      await fs.writeFile(filePath, Buffer.from(capture.data, "base64"));
      files.push(filePath);
    }
    return { canceled: false, path: outputDir, files, count: files.length };
  } finally {
    if (attachedHere && debuggerApi.isAttached()) {
      debuggerApi.detach();
    }
  }
});

ipcMain.handle("asset:pick-image", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择图片",
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths?.[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];
  return {
    canceled: false,
    path: filePath,
    name: path.basename(filePath, path.extname(filePath)),
    dataUrl: await fileToDataUrl(filePath),
  };
});

ipcMain.handle("autosave:load", async () => {
  const filePath = autosavePath();
  try {
    await fs.access(filePath);
    return { exists: true, path: filePath, document: await loadPaperDocument(filePath) };
  } catch {
    return { exists: false };
  }
});

ipcMain.handle("autosave:save", async (_event, document) => {
  const filePath = autosavePath();
  await savePaperDocument(filePath, document);
  return { path: filePath };
});

ipcMain.handle("autosave:clear", async () => {
  try {
    await fs.rm(autosavePath(), { force: true });
  } catch {
    // No-op.
  }
  return { ok: true };
});

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("PaperWriter.Electron");
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
