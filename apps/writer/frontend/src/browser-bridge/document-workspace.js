import {
  assertBrowserResourcesArePersistable,
  pickAudioInBrowser,
  pickImageInBrowser,
  pickVideoInBrowser,
} from "./files.js";
import {
  browserDownloadName,
  browserRandomId,
  plainTextFromBrowserHtml,
} from "./shared.js";
import { readJson, removeJson, writeJson } from "./storage.js";
import {
  browserDiskRevision,
  browserRevisionMap,
  sameBrowserRevision,
  storeBrowserRevision,
} from "./revisions.js";
import { pickImportDocumentInBrowser } from "./document-import.js";
import { createBrowserEditableExport, downloadBrowserBlob } from "./document-export.js";
import { browserEvents } from "./events.js";
import { openBrowserExternal } from "./external.js";

const browserExportProgressListeners = new Set();
const canceledBrowserSearches = new Set();

function emitBrowserExportProgress(payload) {
  browserExportProgressListeners.forEach((callback) => callback(payload));
}

function waitForBrowserPreview(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createBrowserDocumentWorkspaceApi() {
  return {
    openDocument: async () => ({ canceled: true }),
    openDocumentPath: async (filePath = "") => {
      const documentValue = readJson("paperwriter.preview.document", null);
      if (!documentValue || !String(filePath).startsWith("browser-preview")) return { canceled: true };
      const diskRevision = browserRevisionMap()[filePath] || await browserDiskRevision(documentValue);
      storeBrowserRevision(filePath, diskRevision);
      return { canceled: false, path: filePath, document: documentValue, diskRevision, readOnly: false };
    },
    importDocument: pickImportDocumentInBrowser,
    openFolder: async () => ({ canceled: true, files: [] }),
    listFolder: async () => ({ canceled: true, files: [], folders: [], entries: [] }),
    searchFolder: async (payload = {}) => {
      const requestId = String(payload.requestId || "").slice(0, 128);
      const query = String(payload.query || "").trim().slice(0, 1000);
      if (requestId && canceledBrowserSearches.delete(requestId)) {
        return { requestId, query, canceled: true, results: [], totalMatches: 0 };
      }
      if (!query) return { requestId, query, canceled: false, results: [], totalMatches: 0, browserOnly: true };
      const needle = query.toLocaleLowerCase();
      const overrides = Array.isArray(payload.overrides) ? payload.overrides.slice(0, 100) : [];
      const results = [];
      for (const item of overrides) {
        if (requestId && canceledBrowserSearches.has(requestId)) break;
        const documentValue = item?.document && typeof item.document === "object" ? item.document : {};
        const pathValue = String(item?.path || "").slice(0, 2048);
        const title = String(documentValue.title || pathValue.split(/[\\/]/).pop() || "未命名信笺").slice(0, 200);
        const author = String(documentValue.author || "").slice(0, 100);
        const body = plainTextFromBrowserHtml(documentValue.html || "").slice(0, 2_000_000);
        const fields = [pathValue.split(/[\\/]/).pop() || "", title, author, body];
        let matchedText = "";
        let matchIndex = -1;
        for (const field of fields) {
          const index = field.toLocaleLowerCase().indexOf(needle);
          if (index >= 0) { matchedText = field; matchIndex = index; break; }
        }
        if (matchIndex < 0) continue;
        const snippetStart = Math.max(0, matchIndex - 45);
        const snippetEnd = Math.min(matchedText.length, matchIndex + query.length + 75);
        results.push({
          path: pathValue,
          relativePath: pathValue,
          documentId: String(documentValue.documentId || ""),
          title,
          author,
          updatedAt: documentValue.updatedAt || "",
          snippet: matchedText.slice(snippetStart, snippetEnd),
          snippetMatchStart: matchIndex - snippetStart,
          snippetMatchLength: query.length,
          source: "override",
        });
        if (results.length >= Math.max(1, Math.min(500, Number(payload.limit) || 100))) break;
      }
      const canceled = requestId ? canceledBrowserSearches.delete(requestId) : false;
      return { requestId, query, canceled, results: canceled ? [] : results, totalMatches: canceled ? 0 : results.length, browserOnly: true };
    },
    cancelFolderSearch: async (_folderPath, requestId) => {
      const id = String(requestId || "").slice(0, 128);
      if (id) canceledBrowserSearches.add(id);
      return { ok: Boolean(id) };
    },
    getWorkspaceRelationships: async (payload = {}) => {
      const overrides = (Array.isArray(payload.overrides) ? payload.overrides : []).slice(0, 100);
      const records = overrides.map((item) => {
        const documentValue = item?.document && typeof item.document === "object" ? item.document : {};
        const documentId = String(documentValue.documentId || "").slice(0, 128);
        const links = [...String(documentValue.html || "").matchAll(/data-document-id=["']([0-9a-f-]{36})["']/gi)].map((match) => match[1]);
        const pathValue = String(item?.path || "").slice(0, 2048);
        return {
          documentId,
          needsIdentity: !documentId,
          title: String(documentValue.title || pathValue.split(/[\\/]/).pop() || "未命名信笺").slice(0, 200),
          path: pathValue,
          relativePath: pathValue,
          links: [...new Set(links)],
        };
      }).filter((record) => record.path);
      const byId = new Map();
      records.forEach((record) => {
        if (!record.documentId) return;
        const group = byId.get(record.documentId) || [];
        group.push(record);
        byId.set(record.documentId, group);
      });
      const currentId = String(payload.documentId || "");
      const currentPathKey = String(payload.currentPath || "").replace(/\\/g, "/").toLocaleLowerCase("en-US");
      const currentLinks = (Array.isArray(payload.currentLinks) ? payload.currentLinks : []).slice(0, 5000).map((link) => {
        const targetDocumentId = String(link?.targetDocumentId || link?.documentId || "").slice(0, 128);
        const target = byId.get(targetDocumentId)?.[0];
        return {
          ...link,
          documentId: targetDocumentId,
          targetDocumentId,
          title: target?.title || link?.title || "未知笺记",
          path: target?.path || "",
          relativePath: target?.relativePath || "",
          missing: !target,
        };
      }).filter((link) => link.targetDocumentId);
      return {
        rootPath: String(payload.folderPath || ""),
        documents: records.filter((record) => {
          const recordPathKey = String(record.path || "").replace(/\\/g, "/").toLocaleLowerCase("en-US");
          return (!currentId || record.documentId !== currentId) && (!currentPathKey || recordPathKey !== currentPathKey);
        }).map(({ links: _links, ...record }) => record),
        links: currentLinks,
        backlinks: currentId ? records.filter((record) => record.documentId !== currentId && record.links.includes(currentId)).map(({ links: _links, ...record }) => record) : [],
        duplicates: [...byId.values()].filter((group) => group.length > 1).flatMap((group) => group.slice(1).map(({ links: _links, ...record }) => record)),
        browserOnly: true,
      };
    },
    watchWorkspace: async (folderPath = "") => ({ ok: true, rootPath: String(folderPath || ""), browserOnly: true }),
    getDocumentRevision: async (filePath = "") => {
      const pathValue = String(filePath || "");
      let diskRevision = browserRevisionMap()[pathValue] || null;
      if (!diskRevision && pathValue.startsWith("browser-preview")) {
        const documentValue = readJson("paperwriter.preview.document", null);
        if (documentValue) {
          diskRevision = await browserDiskRevision(documentValue);
          storeBrowserRevision(pathValue, diskRevision);
        }
      }
      return { path: pathValue, diskRevision, browserOnly: true };
    },
    regenerateDocumentIdentity: async (filePath = "", force = false) => {
      const documentValue = readJson("paperwriter.preview.document", null);
      if (!documentValue || !String(filePath).startsWith("browser-preview")) {
        throw new Error("浏览器预览只能为本地预览文档重新生成身份");
      }
      const previousId = String(documentValue.documentId || "");
      const documentId = previousId && !force ? previousId : browserRandomId();
      const nextDocument = { ...documentValue, version: 2, documentId, derivedFrom: force ? previousId : (documentValue.derivedFrom || ""), footnotes: documentValue.footnotes || [], citationSources: documentValue.citationSources || [] };
      writeJson("paperwriter.preview.document", nextDocument);
      const diskRevision = await browserDiskRevision(nextDocument);
      storeBrowserRevision(filePath, diskRevision);
      return { ok: true, path: filePath, documentId, document: nextDocument, diskRevision, browserOnly: true };
    },
    copyFolderPath: async (folderPath) => {
      await navigator.clipboard?.writeText?.(folderPath || "");
      return { ok: Boolean(folderPath) };
    },
    writeClipboardContent: async (payload = {}) => {
      const text = typeof payload.text === "string" ? payload.text : "";
      const html = typeof payload.html === "string" ? payload.html : "";
      if (!text && !html) return { ok: false, message: "没有可复制的内容" };
      if (html && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        })]);
        return { ok: true };
      }
      if (!navigator.clipboard?.writeText) throw new Error("当前环境不支持写入剪贴板");
      await navigator.clipboard.writeText(text);
      return { ok: true, plainTextOnly: Boolean(html) };
    },
    showFolder: async () => ({ ok: false }),
    createFolder: async () => ({ ok: false, canceled: true }),
    createDocumentInFolder: async () => ({ ok: false, canceled: true }),
    renameEntry: async () => ({ ok: false, canceled: true }),
    deleteEntry: async () => ({ ok: false, canceled: true }),
    moveEntry: async () => ({ ok: false, canceled: true }),
    backupDocument: async () => ({ ok: false, canceled: true }),
    saveDocument: async (documentValue, currentPath = "", saveAs = false, _reservedPaths = [], expectedRevision = null, options = {}) => {
      assertBrowserResourcesArePersistable(documentValue);
      const pathValue = saveAs || !currentPath ? "browser-preview.letterpaper" : String(currentPath).slice(0, 2048);
      const existingRevision = browserRevisionMap()[pathValue] || null;
      if (!saveAs && expectedRevision && existingRevision && !sameBrowserRevision(expectedRevision, existingRevision) && options?.overwrite !== true) {
        const conflictCopyPath = `browser-preview-conflict-${new Date().toISOString().replace(/[:.]/g, "-")}.letterpaper`;
        writeJson(`paperwriter.preview.conflict.${Date.now()}`, documentValue);
        return { canceled: false, conflict: true, path: pathValue, diskRevision: existingRevision, conflictCopyPath, browserOnly: true };
      }
      writeJson("paperwriter.preview.document", documentValue);
      const diskRevision = await browserDiskRevision(documentValue);
      storeBrowserRevision(pathValue, diskRevision);
      browserEvents.emitWorkspaceChanged({ rootPath: "", kind: "save", path: pathValue });
      return { canceled: false, path: pathValue, diskRevision, browserOnly: true };
    },
    saveTempDocument: async (document, tabId = "temp") => {
      assertBrowserResourcesArePersistable(document);
      const key = `paperwriter.preview.temp.${tabId || "temp"}`;
      writeJson(key, document);
      return { canceled: false, path: `browser-preview-${tabId || "temp"}.letterpaper` };
    },
    deleteTempDocument: async (tabId = "temp") => {
      removeJson(`paperwriter.preview.temp.${tabId || "temp"}`);
      return { ok: true };
    },
    pickExportPath: async (format, suggestedName = "未命名信笺") => {
      if (format === "docx") throw new Error("浏览器预览暂不支持 DOCX 导出，请使用桌面版完成导出");
      const extension = ({ pdf: ".pdf", markdown: ".md", html: ".html", txt: ".txt" })[format] || "";
      return {
        canceled: false,
        format: ["images", "pdf", "markdown", "html", "txt"].includes(format) ? format : "pdf",
        path: format === "images" ? `${browserDownloadName(suggestedName)}-分页图片` : browserDownloadName(suggestedName, extension || ".pdf"),
        browserOnly: true,
      };
    },
    exportEditable: async (documentValue, format, targetPath = "") => {
      const result = createBrowserEditableExport(documentValue, String(format || "").toLowerCase());
      const fileName = browserDownloadName(targetPath || documentValue?.title || "未命名信笺", result.extension);
      downloadBrowserBlob(result.content, result.type, fileName);
      emitBrowserExportProgress({ format, percent: 100, message: `${String(format || "").toUpperCase()} 导出完成` });
      return { canceled: false, path: fileName, warnings: result.warnings, browserOnly: true };
    },
    exportPdf: async (_suggestedName, targetPath = "browser-preview.pdf") => {
      emitBrowserExportProgress({ format: "pdf", percent: 12, message: "正在整理信笺版面…" });
      await waitForBrowserPreview(180);
      emitBrowserExportProgress({ format: "pdf", percent: 78, message: "正在写入 PDF 文件…" });
      await waitForBrowserPreview(180);
      emitBrowserExportProgress({ format: "pdf", percent: 100, message: "PDF 导出完成" });
      return { canceled: false, path: targetPath };
    },
    exportPageImages: async (_suggestedName, pageRects, targetPath = "browser-preview-images") => {
      const total = Math.max(1, pageRects?.length || 1);
      emitBrowserExportProgress({ format: "images", percent: 8, message: `正在准备 ${total} 张分页图片…` });
      for (let index = 0; index < total; index += 1) {
        await waitForBrowserPreview(100);
        const completed = index + 1;
        emitBrowserExportProgress({
          format: "images",
          percent: Math.round(14 + (completed / total) * 86),
          message: `正在导出第 ${completed} / ${total} 张图片`,
          completed,
          total,
        });
      }
      return { canceled: false, path: targetPath, count: total };
    },
    onExportProgress: (callback) => {
      browserExportProgressListeners.add(callback);
      return () => browserExportProgressListeners.delete(callback);
    },
    pickImage: pickImageInBrowser,
    pickAudio: pickAudioInBrowser,
    pickVideo: pickVideoInBrowser,
    copyImageReference: async (payload = {}) => {
      const documentId = String(payload.documentId || "").trim().toLowerCase();
      const imageId = String(payload.imageId || "").trim().toLowerCase();
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      const number = Math.max(1, Math.min(5_000, Number.parseInt(payload.number, 10) || 1));
      if (!uuidPattern.test(documentId) || !uuidPattern.test(imageId)) return { ok: false, message: "图片引用身份无效" };
      const text = `图${number}`;
      const html = `<span data-paper-image-reference="true" data-image-id="${imageId}" data-image-number="${number}" data-missing="false" data-source-document-id="${documentId}">${text}</span>`;
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        })]);
        return { ok: true };
      }
      await navigator.clipboard?.writeText?.(text);
      return { ok: true, plainTextOnly: true };
    },
    openExternal: openBrowserExternal,
    loadAutosave: async () => {
      const document = readJson("paperwriter.autosave", null);
      return document ? { exists: true, document, path: "localStorage:paperwriter.autosave" } : { exists: false };
    },
    saveAutosave: async (document) => {
      writeJson("paperwriter.autosave", document);
      return { path: "localStorage:paperwriter.autosave" };
    },
    clearAutosave: async () => {
      removeJson("paperwriter.autosave");
      return { ok: true };
    },
    onWorkspaceChanged: (callback) => browserEvents.onWorkspaceChanged(callback),
    onWorkspaceWatchError: (callback) => browserEvents.onWorkspaceWatchError(callback),
  };
}

export { createBrowserDocumentWorkspaceApi };
