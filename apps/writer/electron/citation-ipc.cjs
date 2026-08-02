const {
  assertBoundedIpcObject,
  assertBoundedIpcPayload,
} = require("./ipc-payload-limits.cjs");

function registerCitationIpcHandlers({
  ipcMain,
  citationFacade,
  dialog,
  fs,
  path,
  getMainWindow,
  defaultDocumentsDir,
  publicCitationLibrary,
  assertAuthorizedDirectory,
  ensureWorkspace,
  listCitationSources,
} = {}) {
  if (!ipcMain?.handle || !citationFacade) throw new Error("citation IPC 缺少依赖");

  const boundedCitationPayload = (payload, label, overrides = {}) => assertBoundedIpcObject(payload, {
    label,
    maxBytes: 32 * 1024 * 1024,
    maxNodes: 100_000,
    maxDepth: 16,
    maxArrayLength: 5_000,
    maxObjectKeys: 5_000,
    ...overrides,
  });

  ipcMain.handle("citation:parse", (_event, payload = {}) => citationFacade.parse(
    boundedCitationPayload(payload, "文献解析参数", {
      maxBytes: 4 * 1024 * 1024 + 4096,
      maxNodes: 64,
      maxDepth: 4,
      maxArrayLength: 16,
      maxObjectKeys: 16,
    }),
  ));
  ipcMain.handle("citation:export", (_event, payload = {}) => citationFacade.exportSources(
    boundedCitationPayload(payload, "文献导出参数"),
  ));
  ipcMain.handle("citation:format", (_event, payload = {}) => citationFacade.formatSources(
    boundedCitationPayload(payload, "文献格式化参数"),
  ));
  ipcMain.handle("citation:styles", () => citationFacade.builtInStyles());
  ipcMain.handle("citation:validate-style", (_event, payload = {}) => citationFacade.validateCslStyle(
    boundedCitationPayload(payload, "CSL 样式参数", {
      maxBytes: 520 * 1024,
      maxNodes: 32,
      maxDepth: 4,
      maxArrayLength: 16,
      maxObjectKeys: 16,
    }),
  ));
  ipcMain.handle("citation:lookup", (_event, payload = {}) => citationFacade.lookup(
    boundedCitationPayload(payload, "文献补全参数", {
      maxBytes: 4096,
      maxNodes: 32,
      maxDepth: 4,
      maxArrayLength: 16,
      maxObjectKeys: 16,
    }),
  ));

  if (publicCitationLibrary) {
    ipcMain.handle("citation:public-list", () => publicCitationLibrary.listSources());
    ipcMain.handle("citation:public-upsert", (_event, source = {}) => (
      publicCitationLibrary.upsertSource(
        boundedCitationPayload(source, "公域文献来源", {
          maxBytes: 512 * 1024,
          maxNodes: 10_000,
          maxDepth: 12,
          maxArrayLength: 500,
          maxObjectKeys: 1_000,
        }),
      )
    ));
    ipcMain.handle("citation:public-delete", (_event, sourceId = "") => {
      assertBoundedIpcPayload(sourceId, {
        label: "公域文献标识",
        maxBytes: 256,
        maxNodes: 2,
        maxDepth: 1,
        maxArrayLength: 1,
        maxObjectKeys: 1,
      });
      return publicCitationLibrary.deleteSource(String(sourceId || "").slice(0, 128));
    });
    if (assertAuthorizedDirectory && ensureWorkspace && listCitationSources) {
      ipcMain.handle("citation:public-migrate", async (_event, workspacePath = "") => {
        assertBoundedIpcPayload(workspacePath, {
          label: "工作区路径",
          maxBytes: 128 * 1024,
          maxNodes: 2,
          maxDepth: 1,
          maxArrayLength: 1,
          maxObjectKeys: 1,
        });
        const rootPath = await assertAuthorizedDirectory(String(workspacePath || "").slice(0, 32768));
        const workspace = await ensureWorkspace(rootPath);
        const legacy = await listCitationSources(rootPath);
        return publicCitationLibrary.migrateWorkspace(
          workspace?.manifest?.workspaceId,
          legacy?.sources || [],
        );
      });
    }
  }

  if (dialog && fs && path) {
    ipcMain.handle("citation:pick-style", async () => {
      const result = await dialog.showOpenDialog(getMainWindow?.(), {
        title: "导入 CSL 引用样式",
        defaultPath: defaultDocumentsDir?.(),
        properties: ["openFile"],
        filters: [
          { name: "CSL 引用样式", extensions: ["csl"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (result.canceled || !result.filePaths?.[0]) {
        return { canceled: true };
      }
      const filePath = path.resolve(result.filePaths[0]);
      if (path.extname(filePath).toLowerCase() !== ".csl") {
        throw new Error("请选择 .csl 引用样式文件");
      }
      let handle;
      try {
        handle = await fs.open(filePath, "r");
        const before = await handle.stat();
        if (!before.isFile() || before.size <= 0 || before.size > 512 * 1024) {
          throw new Error("CSL 样式为空或超过 512 KiB 上限");
        }
        const buffer = await handle.readFile();
        const after = await handle.stat();
        if (
          before.size !== after.size
          || before.mtimeMs !== after.mtimeMs
          || buffer.length !== after.size
        ) {
          throw new Error("CSL 样式在读取期间发生变化，请重试");
        }
        const customStyle = citationFacade.validateCslStyle({
          xml: buffer.toString("utf8"),
        });
        return {
          canceled: false,
          style: {
            styleId: customStyle.styleId,
            locale: "zh-CN",
            customStyle: {
              styleId: customStyle.styleId,
              title: customStyle.title,
              hash: customStyle.hash,
              xml: customStyle.xml,
            },
          },
        };
      } finally {
        await handle?.close();
      }
    });

    ipcMain.handle("citation:pick-import", async (_event, payload = {}) => {
      const requested = boundedCitationPayload(payload, "文献导入参数", {
        maxBytes: 1024,
        maxNodes: 16,
        maxDepth: 3,
        maxArrayLength: 8,
        maxObjectKeys: 8,
      });
      const requestedFormat = ["bibtex", "ris", "csl-json"].includes(requested.format)
        ? requested.format
        : "";
      const formatFilters = {
        bibtex: { name: "BibTeX 文献", extensions: ["bib"] },
        ris: { name: "RIS 文献", extensions: ["ris"] },
        "csl-json": { name: "CSL-JSON 文献", extensions: ["json"] },
      };
      const result = await dialog.showOpenDialog(getMainWindow?.(), {
        title: "导入参考文献",
        defaultPath: defaultDocumentsDir?.(),
        properties: ["openFile"],
        filters: [
          requestedFormat
            ? formatFilters[requestedFormat]
            : { name: "参考文献", extensions: ["bib", "ris", "json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
      const filePath = path.resolve(result.filePaths[0]);
      const extension = path.extname(filePath).toLowerCase();
      if (![".bib", ".ris", ".json"].includes(extension)) throw new Error("不支持的文献文件格式");
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error("文献文件超过 4 MiB 上限");
      const text = await fs.readFile(filePath, "utf8");
      const format = extension === ".bib" ? "bibtex" : (extension === ".ris" ? "ris" : "csl-json");
      if (requestedFormat && requestedFormat !== format) {
        throw new Error(`请选择 ${requestedFormat === "bibtex" ? "BibTeX" : (requestedFormat === "ris" ? "RIS" : "CSL-JSON")} 文件`);
      }
      return { canceled: false, filePath, ...citationFacade.parse({ text, format }) };
    });

    ipcMain.handle("citation:save-export", async (_event, payload = {}) => {
      const exported = citationFacade.exportSources(
        boundedCitationPayload(payload, "文献保存参数"),
      );
      const result = await dialog.showSaveDialog(getMainWindow?.(), {
        title: "导出参考文献",
        defaultPath: path.join(defaultDocumentsDir?.() || "", `references${exported.extension}`),
        filters: [{ name: "参考文献", extensions: [exported.extension.slice(1)] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const target = path.extname(result.filePath).toLowerCase() === exported.extension
        ? result.filePath
        : `${result.filePath}${exported.extension}`;
      await fs.writeFile(target, exported.text, "utf8");
      return { canceled: false, filePath: target, format: exported.format };
    });
  }
}

module.exports = { registerCitationIpcHandlers };
