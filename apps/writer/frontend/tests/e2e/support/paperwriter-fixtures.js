const SESSION_STORAGE_KEY = "paperwriter.sessionState";
const AI_CONFIG_STORAGE_KEY = "paperwriter.aiConfig";

export function createTestDocument(overrides = {}) {
  const now = "2026-07-25T08:00:00.000Z";
  const body = overrides.body ?? "离线交互回归正文";
  return {
    version: 2,
    documentId: "10000000-0000-4000-8000-000000000001",
    derivedFrom: "",
    footnotes: [],
    citationSources: [],
    title: "交互回归信笺",
    author: "测试作者",
    html: `<p>${body}</p>`,
    letterTemplateId: "fiber-letter",
    templateId: "fiber",
    fontFamily: "LXGW WenKai Screen",
    fontSize: 17,
    layoutMode: "flow",
    customBackground: "",
    comments: [],
    createdAt: now,
    displayDate: "2026年7月25日",
    updatedAt: now,
    ...overrides,
  };
}

export function createTestAiConfig() {
  return {
    activeProvider: "gemini",
    activeModelId: "gemini-e2e",
    providers: {
      gemini: {
        provider: "gemini",
        providerLabel: "Gemini",
        protocol: "openai",
        builtin: true,
        baseUrl: "https://example.invalid/v1",
        apiKey: "offline-e2e-key",
        activeModelId: "gemini-e2e",
        models: [{
          id: "gemini-e2e",
          name: "离线测试模型",
          model: "offline-e2e-model",
          testedOk: true,
          testedAt: "2026-07-25T08:00:00.000Z",
          testMessage: "离线 fixture",
        }],
      },
    },
    taskModels: {
      applyResolver: { providerId: "", modelId: "", requestParams: {} },
    },
  };
}

export async function installBrowserPreviewState(page, { aiConfig = null } = {}) {
  await page.addInitScript(({ aiConfigValue, aiStorageKey, sessionStorageKey }) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.removeItem(sessionStorageKey);
    if (aiConfigValue) {
      window.localStorage.setItem(aiStorageKey, JSON.stringify(aiConfigValue));
    }
  }, {
    aiConfigValue: aiConfig,
    aiStorageKey: AI_CONFIG_STORAGE_KEY,
    sessionStorageKey: SESSION_STORAGE_KEY,
  });
}

export async function installDesktopBridgeFixture(page, {
  documents,
  activePath,
  readOnlyPaths = [],
  aiConfig = null,
  sessionTabs = null,
  revisions = {},
} = {}) {
  const documentEntries = Object.entries(documents || {});
  const restoreTabs = Array.isArray(sessionTabs) ? sessionTabs : documentEntries.map(([path]) => ({
    path,
    recoveryPath: "",
    recoveryId: "",
    recoverySourcePath: "",
    recoveryBaseRevision: null,
    temporary: false,
  }));
  const revisionEntries = Object.entries(revisions || {});

  await page.addInitScript((fixture) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(fixture.sessionStorageKey, JSON.stringify({
      folderPath: "",
      activePath: fixture.activePath,
      tabs: fixture.restoreTabs,
      workspaceGroups: null,
    }));

    const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const documentsByPath = new Map(fixture.documentEntries);
    const revisionsByPath = new Map(fixture.revisionEntries);
    const readOnly = new Set(fixture.readOnlyPaths);
    const calls = {
      cancelAi: [],
      closeCanceled: [],
      closeReady: [],
      exportEditable: [],
      pickExportPath: [],
      saveDocument: [],
    };
    const listeners = new Map();
    const subscribe = (name, callback) => {
      if (typeof callback !== "function") return () => {};
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
      return () => listeners.get(name)?.delete(callback);
    };
    const emit = (name, payload) => {
      listeners.get(name)?.forEach((callback) => callback(clone(payload)));
    };
    const emptyAiConfig = {
      activeProvider: "gemini",
      activeModelId: "gemini-default",
      providers: {},
      taskModels: { applyResolver: { providerId: "", modelId: "", requestParams: {} } },
    };
    const revisionFor = (filePath) => clone(revisionsByPath.get(filePath) || {
      size: JSON.stringify(documentsByPath.get(filePath) || {}).length,
      mtimeMs: 1,
      sha256: "a".repeat(64),
    });

    const methods = {
      isElectron: true,
      getPaths: async () => ({
        desktop: "",
        documents: "",
        autosave: "",
        userData: "",
        aiDebugLog: "",
      }),
      debugLog: async () => ({ ok: true }),
      setWindowModalOverlay: async () => ({ ok: true }),
      getAiConfig: async () => clone(fixture.aiConfig || emptyAiConfig),
      getFullscreen: async () => ({ fullscreen: false }),
      setFullscreen: async (fullscreen) => ({ ok: true, fullscreen: Boolean(fullscreen) }),
      getUpdateState: async () => ({ status: "idle", message: "" }),
      closeReady: async (payload = {}) => {
        calls.closeReady.push(clone(payload));
        return { ok: true };
      },
      closeCanceled: async (payload = {}) => {
        calls.closeCanceled.push(clone(payload));
        return { ok: true };
      },
      onCloseRequest: (callback) => subscribe("app:close-request", callback),
      loadAutosave: async () => ({ exists: false }),
      getResearchRoot: async () => ({
        configured: false,
        available: false,
        libraryId: "",
        rootPath: "",
        rootName: "",
      }),
      listResearch: async () => [],
      listCitations: async () => [],
      getWorkspaceRelationships: async () => ({
        documents: [],
        links: [],
        backlinks: [],
        duplicates: [],
      }),
      listFolder: async (folderPath = "") => ({
        canceled: false,
        folderPath,
        parentPath: "",
        folders: [],
        files: [],
        entries: [],
      }),
      watchWorkspace: async () => ({ ok: true }),
      openDocument: async () => ({ canceled: true }),
      openDocumentPath: async (filePath = "") => {
        const document = documentsByPath.get(filePath);
        if (!document) return { canceled: true };
        return {
          canceled: false,
          path: filePath,
          document: clone(document),
          diskRevision: revisionFor(filePath),
          readOnly: readOnly.has(filePath),
        };
      },
      getDocumentRevision: async (filePath = "") => ({
        path: filePath,
        diskRevision: revisionFor(filePath),
      }),
      saveDocument: async (
        document,
        currentPath = "",
        saveAs = false,
        reservedPaths = [],
        expectedRevision = null,
        saveOptions = {},
      ) => {
        const savedDocument = clone(document);
        const nextRevision = {
          size: JSON.stringify(savedDocument).length,
          mtimeMs: Date.now(),
          sha256: "c".repeat(64),
        };
        documentsByPath.set(currentPath, savedDocument);
        revisionsByPath.set(currentPath, nextRevision);
        calls.saveDocument.push({
          document: savedDocument,
          currentPath,
          saveAs,
          reservedPaths: clone(reservedPaths),
          expectedRevision: clone(expectedRevision),
          saveOptions: clone(saveOptions),
        });
        return {
          canceled: false,
          path: currentPath,
          document: savedDocument,
          diskRevision: clone(nextRevision),
        };
      },
      saveTempDocument: async (_document, tabId = "") => ({
        canceled: false,
        path: `fixture-recovery-${tabId}.letterpaper`,
        recoveryId: tabId,
      }),
      deleteTempDocument: async () => ({ ok: true }),
      pickExportPath: async (format, suggestedName = "未命名信笺", initialDirectory = "") => {
        const path = `${suggestedName}.${format === "markdown" ? "md" : format}`;
        calls.pickExportPath.push({ format, suggestedName, initialDirectory });
        return {
          canceled: false,
          format,
          path,
          directory: "C:\\e2e\\exports",
        };
      },
      exportEditable: async (document, format, targetPath) => {
        calls.exportEditable.push({ document: clone(document), format, targetPath });
        return { canceled: false, path: targetPath, warnings: [] };
      },
      exportPdf: async (_title, targetPath) => ({ canceled: false, path: targetPath }),
      exportPageImages: async (_title, pageRects, targetPath) => ({
        canceled: false,
        path: targetPath,
        count: Math.max(1, pageRects?.length || 0),
      }),
      cancelAi: async (requestId = "") => {
        calls.cancelAi.push(requestId);
        emit("ai:error", { requestId, message: "已停止生成", aborted: true });
        return { ok: true };
      },
    };

    const bridge = new Proxy(methods, {
      get(target, property) {
        if (property in target) return target[property];
        if (typeof property === "string" && property.startsWith("on")) {
          const eventName = property
            .slice(2)
            .replace(/[A-Z]/g, (character) => `:${character.toLowerCase()}`)
            .replace(/^:/, "");
          return (callback) => subscribe(eventName, callback);
        }
        return async () => ({ ok: false, canceled: true, unsupported: true });
      },
    });

    Object.defineProperty(window, "paperWriter", {
      configurable: false,
      enumerable: true,
      writable: false,
      value: bridge,
    });
    Object.defineProperty(window, "__paperWriterE2E", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: { calls, emit },
    });
  }, {
    sessionStorageKey: SESSION_STORAGE_KEY,
    documentEntries,
    restoreTabs,
    revisionEntries,
    activePath: activePath || documentEntries[0]?.[0] || "",
    readOnlyPaths,
    aiConfig,
  });
}

export async function openPaperWriter(page) {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await page.locator(".paper-workspace").waitFor({ state: "visible" });
  await page.locator(".paper-sheet").first().waitFor({ state: "visible" });
  return pageErrors;
}
