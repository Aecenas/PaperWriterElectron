const {
  normalizeIntentRoute,
  normalizeProposal,
  normalizeToolCalls,
  parseJsonResponse,
  planningMessages,
  routeMessages,
  validateProposal,
} = require("./ai-collaboration-core.cjs");

const REQUEST_ID_PATTERN = /^ai-collaboration-[a-z0-9-]{4,100}$/i;
const MAX_TOOL_ROUNDS = 4;
const MAX_READ_DOCUMENTS = 20;

function createAiCollaborationRuntime({
  completeTask,
  fs,
  path,
  createHash,
  randomUUID,
  getUserDataPath,
  atomicWriteFile,
  assertAuthorizedDirectory,
  isPathInside,
  isSupportedDocument,
  walkWorkspaceDocuments,
  readSearchDocument,
  searchWorkspace,
  loadPaperDocument,
  savePaperDocument,
  authorizeDocumentPath,
  normalizeDocument,
  createEmptyAiState,
  htmlToSearchText,
  emitEvent,
  writeDebugLog,
  AbortControllerApi = AbortController,
}) {
  const activeRequests = new Map();
  const preparedCommits = new Map();
  const proposalSourceDocuments = new Map();
  const journalPath = () => path.join(getUserDataPath(), "ai-collaboration-commit.json");

  function requestId(value) {
    const id = String(value || "");
    if (!REQUEST_ID_PATTERN.test(id)) throw new Error("AI 协作请求标识无效");
    return id;
  }

  function reserve(id) {
    if (activeRequests.has(id)) throw new Error("AI 协作请求标识重复");
    const controller = new AbortControllerApi();
    activeRequests.set(id, controller);
    return controller;
  }

  function release(id, controller) {
    if (activeRequests.get(id) === controller) activeRequests.delete(id);
  }

  function event(sender, payload) {
    emitEvent?.(sender, { ...payload, channel: "ai-collaboration" });
  }

  function rememberProposalSources(proposal, context) {
    const documents = new Map(context.sourceDocuments || []);
    proposalSourceDocuments.set(proposal.id, { createdAt: Date.now(), documents });
    for (const [proposalId, entry] of proposalSourceDocuments) {
      if (proposalSourceDocuments.size <= 30 && Date.now() - entry.createdAt < 60 * 60 * 1000) break;
      proposalSourceDocuments.delete(proposalId);
    }
  }

  async function completeJson(payload, messages, controller, kind, progress = null) {
    const startedAt = Date.now();
    let receivedFirstDelta = false;
    if (progress?.sender && progress?.requestId && progress?.waitingMessage) {
      event(progress.sender, {
        requestId: progress.requestId,
        type: "waiting-model",
        message: progress.waitingMessage,
      });
    }
    const result = await completeTask({
      providerId: String(payload.provider || ""),
      modelId: String(payload.modelId || ""),
      messages,
      signal: controller.signal,
      requestKind: `collaboration-${kind}`,
      onDelta: () => {
        if (receivedFirstDelta || !progress?.sender || !progress?.requestId) return;
        receivedFirstDelta = true;
        event(progress.sender, {
          requestId: progress.requestId,
          type: "receiving-model",
          message: progress.receivingMessage || "AI 已开始返回，正在接收方案",
        });
      },
    });
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    if (progress?.sender && progress?.requestId) {
      event(progress.sender, {
        requestId: progress.requestId,
        type: "validating",
        message: progress.completedMessage || "AI 返回完成，正在本地检查方案",
      });
    }
    try {
      await writeDebugLog?.("ai-collaboration:model-request", {
        requestId: progress?.requestId || "",
        kind,
        elapsedMs,
        receivedContent: receivedFirstDelta || Boolean(result?.text),
        outputCharacters: String(result?.text || "").length,
      });
    } catch {
      // Timing diagnostics must never make a collaboration request fail.
    }
    return { ...result, elapsedMs };
  }

  async function route(sender, payload = {}) {
    const id = requestId(payload.requestId);
    const question = String(payload.question || "").trim();
    if (!question) throw new Error("AI 协作问题为空");
    const controller = reserve(id);
    try {
      event(sender, { requestId: id, type: "routing", message: "正在判断回答方式" });
      let result = await completeJson(payload, routeMessages(question), controller, "route");
      let routeResult;
      try {
        routeResult = normalizeIntentRoute(result.text);
      } catch (error) {
        result = await completeJson(payload, routeMessages(question, { raw: result.text, message: error.message }), controller, "route-repair");
        routeResult = normalizeIntentRoute(result.text);
      }
      if (routeResult.confidence < 0.6) routeResult.mode = "uncertain";
      return { ok: true, requestId: id, ...routeResult, model: result.model };
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, canceled: true, message: "已停止 AI 协作" };
      throw error;
    } finally {
      release(id, controller);
    }
  }

  function overlayMap(overlays, rootPath) {
    return new Map((Array.isArray(overlays) ? overlays : []).slice(0, 100).flatMap((overlay) => {
      const filePath = String(overlay?.path || "");
      if (!filePath || !isPathInside(rootPath, filePath) || !overlay?.document) return [];
      const key = process.platform === "win32"
        ? path.resolve(filePath).toLocaleLowerCase("en-US")
        : path.resolve(filePath);
      return [[key, overlay.document]];
    }));
  }

  function visibleWorkspaceRelativePath(relativePath) {
    const normalized = String(relativePath || "").replace(/\\/g, "/");
    return Boolean(normalized) && !normalized.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."));
  }

  async function resolveWorkspacePath(rootPath, relativePath) {
    const relative = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (!relative || path.isAbsolute(relative) || relative.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
      throw new Error("信笺相对路径无效");
    }
    const target = path.resolve(rootPath, ...relative.split("/"));
    if (!isPathInside(rootPath, target) || !isSupportedDocument(target)) throw new Error("信笺不在当前工作区");
    const [realRoot, realTarget] = await Promise.all([fs.realpath(rootPath), fs.realpath(target)]);
    if (!isPathInside(realRoot, realTarget)) throw new Error("信笺路径逃出当前工作区");
    return realTarget;
  }

  function documentSnapshot(document, relativePath, revision = "") {
    const content = htmlToSearchText(document?.html || "").slice(0, 2 * 1024 * 1024);
    const fingerprint = `source-${createHash("sha256").update(JSON.stringify({
      documentId: document?.documentId || "",
      title: document?.title || "",
      html: document?.html || "",
      updatedAt: document?.updatedAt || "",
    })).digest("hex").slice(0, 32)}`;
    return {
      id: String(document?.documentId || fingerprint).slice(0, 128),
      documentId: String(document?.documentId || "").slice(0, 128),
      title: String(document?.title || "未命名信笺").slice(0, 200),
      relativePath: String(relativePath || "").replace(/\\/g, "/"),
      fingerprint,
      revision: String(revision || document?.updatedAt || "").slice(0, 256),
      content,
    };
  }

  async function listWorkspace(rootPath, limit, overlays) {
    const walked = await walkWorkspaceDocuments(rootPath);
    const overlayByPath = overlayMap(overlays, rootPath);
    const records = [];
    for (const filePath of walked.documents.slice(0, 2000)) {
      try {
        const relativePath = path.relative(rootPath, filePath).replace(/\\/g, "/");
        if (!visibleWorkspaceRelativePath(relativePath)) continue;
        const key = process.platform === "win32" ? path.resolve(filePath).toLocaleLowerCase("en-US") : path.resolve(filePath);
        const document = overlayByPath.get(key) || await readSearchDocument(filePath);
        const stat = await fs.stat(filePath);
        records.push({
          relativePath,
          title: String(document?.title || path.basename(filePath, path.extname(filePath))).slice(0, 200),
          characters: htmlToSearchText(document?.html || "").length,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        });
      } catch {
        // A broken document is omitted from AI tools and remains untouched.
      }
    }
    return records.sort((left, right) => left.characters - right.characters || left.title.localeCompare(right.title, "zh-CN")).slice(0, limit);
  }

  async function executeToolCalls(calls, context) {
    const results = [];
    for (const call of calls) {
      if (call.tool === "search_workspace_letters") {
        event(context.sender, { requestId: context.requestId, type: "searching", message: call.query ? `正在搜索“${call.query}”` : "正在列出工作区信笺" });
        if (!context.rootPath) {
          results.push({ tool: call.tool, error: "尚未选择工作区", results: [] });
        } else if (!call.query) {
          results.push({ tool: call.tool, query: "", results: await listWorkspace(context.rootPath, call.limit, context.overlays) });
        } else {
          const searched = await searchWorkspace({
            folderPath: context.rootPath,
            query: call.query,
            requestId: `${context.requestId}-search`,
            limit: call.limit,
            overrides: context.overlays,
          });
          results.push({
            tool: call.tool,
            query: call.query,
            results: (searched?.results || [])
              .filter((item) => visibleWorkspaceRelativePath(item.relativePath))
              .slice(0, call.limit).map((item) => ({
              relativePath: String(item.relativePath || "").replace(/\\/g, "/"),
              title: String(item.title || item.displayName || "未命名信笺").slice(0, 200),
              snippet: String(item.snippet || "").slice(0, 1200),
              size: Number(item.size) || 0,
              updatedAt: item.updatedAt || item.mtimeMs || "",
            })),
          });
        }
      } else if (call.tool === "read_workspace_letters") {
        const remaining = Math.max(0, MAX_READ_DOCUMENTS - context.sources.length);
        if (call.paths.length > remaining) throw new Error(`一次 AI 协作最多读取 ${MAX_READ_DOCUMENTS} 封信笺，请缩小范围`);
        const snapshots = [];
        const overlayByPath = overlayMap(context.overlays, context.rootPath);
        for (const relativePath of call.paths) {
          if (context.sources.some((source) => source.relativePath === relativePath)) continue;
          const filePath = await resolveWorkspacePath(context.rootPath, relativePath);
          const key = process.platform === "win32" ? path.resolve(filePath).toLocaleLowerCase("en-US") : path.resolve(filePath);
          const document = overlayByPath.get(key) || await loadPaperDocument(filePath);
          const stat = await fs.stat(filePath);
          const snapshot = documentSnapshot(document, path.relative(context.rootPath, filePath), `${stat.size}:${stat.mtimeMs}`);
          context.sources.push(snapshot);
          context.sourceDocuments.set(snapshot.documentId || snapshot.id, document);
          snapshots.push({ ...snapshot, content: snapshot.content.slice(0, 400000) });
        }
        event(context.sender, { requestId: context.requestId, type: "reading", message: `已读取 ${context.sources.length} 封工作区信笺` });
        results.push({ tool: call.tool, results: snapshots });
      }
    }
    return results;
  }

  async function plan(sender, payload = {}) {
    const id = requestId(payload.requestId);
    const controller = reserve(id);
    const planningStartedAt = Date.now();
    let modelRequests = 0;
    let modelElapsedMs = 0;
    let toolRounds = 0;
    try {
      const rootPath = payload.workspaceRoot
        ? await assertAuthorizedDirectory(String(payload.workspaceRoot))
        : "";
      const current = payload.current && typeof payload.current === "object" ? payload.current : {};
      if (!current.documentId || !current.manifest?.documentFingerprint) throw new Error("当前信笺快照无效");
      const context = {
        sender,
        requestId: id,
        rootPath,
        overlays: Array.isArray(payload.overlays) ? payload.overlays.slice(0, 100) : [],
        sources: [],
        sourceDocuments: new Map(),
      };
      const transcript = [];
      const requestCompletion = async (messages, kind, progress) => {
        modelRequests += 1;
        const completion = await completeJson(payload, messages, controller, kind, {
          sender,
          requestId: id,
          ...progress,
        });
        modelElapsedMs += completion.elapsedMs || 0;
        return completion;
      };
      const successfulResult = (proposal, model) => ({
        ok: true,
        requestId: id,
        proposal,
        model,
        timing: {
          totalMs: Math.max(0, Date.now() - planningStartedAt),
          modelMs: modelElapsedMs,
          modelRequests,
          toolRounds,
        },
      });
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        event(sender, { requestId: id, type: "planning", message: round ? "正在整理已读取内容" : "正在整理协作请求" });
        const messages = planningMessages({ current, history: payload.history, question: payload.question, toolTranscript: transcript });
        let completion = await requestCompletion(messages, `plan-${round}`, {
          waitingMessage: round ? "正在等待 AI 结合读取内容返回方案" : "正在等待 AI 返回修改方案",
          receivingMessage: "AI 已开始返回，正在接收修改方案",
        });
        let parsed;
        try {
          parsed = parseJsonResponse(completion.text);
        } catch (error) {
          event(sender, { requestId: id, type: "repairing", message: "AI 返回格式不完整，正在请求一次格式修复" });
          completion = await requestCompletion(planningMessages({
            current,
            history: payload.history,
            question: payload.question,
            toolTranscript: transcript,
            repair: { raw: completion.text, message: error.message },
          }), `plan-${round}-repair`, {
            waitingMessage: "正在等待 AI 返回修复后的方案",
            receivingMessage: "AI 已开始返回修复内容",
          });
          parsed = parseJsonResponse(completion.text);
        }
        if (parsed.type === "proposal" || Array.isArray(parsed.operations)) {
          const currentSource = {
            id: String(current.documentId),
            documentId: String(current.documentId),
            title: String(current.title || "当前信笺"),
            relativePath: String(current.relativePath || ""),
            fingerprint: String(current.manifest.documentFingerprint),
            revision: String(current.revision || ""),
          };
          const proposal = normalizeProposal(parsed, {
            documentId: current.documentId,
            documentFingerprint: current.manifest.documentFingerprint,
            revision: current.revision,
            sources: [currentSource, ...context.sources],
          });
          const rawProposal = parsed.type === "proposal" && parsed.proposal && typeof parsed.proposal === "object"
            ? parsed.proposal
            : parsed;
          const rawOperationCount = Array.isArray(rawProposal.operations) ? rawProposal.operations.length : 0;
          const ignoredOperationCount = Math.max(0, rawOperationCount - proposal.operations.length);
          if (ignoredOperationCount) {
            event(sender, {
              requestId: id,
              type: "normalizing",
              message: `已安全忽略 ${ignoredOperationCount} 项空白或越权修改，正在检查其余方案`,
            });
          }
          const validated = validateProposal(proposal, current.manifest);
          if (!validated.ok) {
            event(sender, { requestId: id, type: "repairing", message: "方案未通过安全校验，正在请求一次格式修复" });
            const repaired = await requestCompletion(planningMessages({
              current,
              history: payload.history,
              question: payload.question,
              toolTranscript: transcript,
              repair: { raw: completion.text, message: validated.errors.join("；") },
            }), `proposal-repair`, {
              waitingMessage: "正在等待 AI 返回修复后的方案",
              receivingMessage: "AI 已开始返回修复内容",
            });
            const repairedProposal = normalizeProposal(parseJsonResponse(repaired.text), {
              documentId: current.documentId,
              documentFingerprint: current.manifest.documentFingerprint,
              revision: current.revision,
              sources: [currentSource, ...context.sources],
            });
            const finalValidation = validateProposal(repairedProposal, current.manifest);
            if (!finalValidation.ok) throw new Error(finalValidation.errors.join("；"));
            rememberProposalSources(repairedProposal, context);
            return successfulResult(repairedProposal, repaired.model);
          }
          rememberProposalSources(proposal, context);
          return successfulResult(proposal, completion.model);
        }
        const calls = normalizeToolCalls(parsed);
        if (!calls.length) throw new Error("AI 协作没有返回可执行的只读工具或修改方案");
        if (round >= MAX_TOOL_ROUNDS) throw new Error("AI 协作检索轮次已达上限，请缩小任务范围");
        const results = await executeToolCalls(calls, context);
        toolRounds += 1;
        transcript.push({ call: parsed, results });
      }
      throw new Error("AI 协作未能形成修改方案");
    } catch (error) {
      await writeDebugLog?.("ai-collaboration:plan:error", {
        requestId: id,
        aborted: controller.signal.aborted,
        message: error?.message,
        totalElapsedMs: Math.max(0, Date.now() - planningStartedAt),
        modelElapsedMs,
        modelRequests,
        toolRounds,
      });
      if (controller.signal.aborted) return { ok: false, canceled: true, message: "已停止 AI 协作" };
      throw error;
    } finally {
      release(id, controller);
    }
  }

  async function writeJournal(value) {
    await atomicWriteFile(journalPath(), `${JSON.stringify(value, null, 2)}\n`);
  }

  async function clearJournal() {
    await fs.unlink(journalPath()).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }

  async function cleanupPrepared(record, { removeTargets = false } = {}) {
    await Promise.all((record.outputs || []).flatMap((output) => {
      const paths = [output.tempPath, ...(removeTargets ? [output.targetPath] : [])];
      return paths.map((filePath) => fs.unlink(filePath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      }));
    }));
  }

  function referencedIds(html, attribute) {
    const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`${escaped}\\s*=\\s*(?:\"([^\"]+)\"|'([^']+)')`, "gi");
    return new Set([...String(html || "").matchAll(pattern)].map((match) => match[1] || match[2]).filter(Boolean));
  }

  function mergeReferencedMetadata(documents, html) {
    const footnoteIds = referencedIds(html, "data-footnote-id");
    const citationIds = referencedIds(html, "data-citation-source-id");
    const footnotes = [];
    const citationSources = [];
    const seenFootnotes = new Set();
    const seenCitations = new Set();
    for (const document of documents) {
      for (const footnote of Array.isArray(document?.footnotes) ? document.footnotes : []) {
        if (footnoteIds.has(footnote?.id) && !seenFootnotes.has(footnote.id)) {
          seenFootnotes.add(footnote.id);
          footnotes.push(footnote);
        }
      }
      for (const citation of Array.isArray(document?.citationSources) ? document.citationSources : []) {
        if (citationIds.has(citation?.id) && !seenCitations.has(citation.id)) {
          seenCitations.add(citation.id);
          citationSources.push(citation);
        }
      }
    }
    return { footnotes, citationSources };
  }

  async function initialize() {
    try {
      const raw = await fs.readFile(journalPath(), "utf8");
      const journal = JSON.parse(raw);
      if (journal?.status !== "complete") await cleanupPrepared(journal, { removeTargets: true });
      await clearJournal();
    } catch (error) {
      if (error?.code !== "ENOENT") await writeDebugLog?.("ai-collaboration:journal-recovery:error", { message: error?.message });
    }
  }

  async function verifyProposalSources({ rootPath, sources, currentDocumentId, overlays, sourceDocumentsById = new Map() }) {
    const commitOverlays = rootPath ? overlayMap(overlays, rootPath) : new Map();
    for (const source of sources) {
      if (!source?.relativePath || String(source.documentId || "") === currentDocumentId) continue;
      const sourcePath = await resolveWorkspacePath(rootPath, source.relativePath);
      const stat = await fs.stat(sourcePath);
      const currentRevision = `${stat.size}:${stat.mtimeMs}`;
      if (source.revision && String(source.revision) !== currentRevision) {
        throw new Error(`来源信笺已被外部修改：${source.title || source.relativePath}`);
      }
      const key = process.platform === "win32" ? path.resolve(sourcePath).toLocaleLowerCase("en-US") : path.resolve(sourcePath);
      const sourceDocument = commitOverlays.get(key) || await loadPaperDocument(sourcePath);
      const snapshot = documentSnapshot(sourceDocument, source.relativePath, currentRevision);
      if (source.fingerprint && snapshot.fingerprint !== source.fingerprint) {
        throw new Error(`来源信笺版本已变化：${source.title || source.relativePath}`);
      }
      sourceDocumentsById.set(String(source.documentId || snapshot.documentId || snapshot.id), sourceDocument);
    }
    return sourceDocumentsById;
  }

  async function validateProposalSources(payload = {}) {
    const sources = (Array.isArray(payload.sources) ? payload.sources : []).slice(0, MAX_READ_DOCUMENTS);
    const currentDocumentId = String(payload.currentDocumentId || "");
    const externalSources = sources.filter((source) => source?.relativePath && String(source.documentId || "") !== currentDocumentId);
    if (!externalSources.length) return { ok: true, stale: false };
    try {
      const rootPath = await assertAuthorizedDirectory(String(payload.workspaceRoot || ""));
      await verifyProposalSources({
        rootPath,
        sources: externalSources,
        currentDocumentId,
        overlays: payload.overlays,
      });
      return { ok: true, stale: false };
    } catch (error) {
      return { ok: true, stale: true, message: error?.message || "涉及信笺版本已变化" };
    }
  }

  async function prepareCommit(payload = {}) {
    const outputs = (Array.isArray(payload.outputs) ? payload.outputs : []).slice(0, 50);
    const sources = (Array.isArray(payload.sources) ? payload.sources : []).slice(0, MAX_READ_DOCUMENTS);
    const currentDocumentId = String(payload.currentDocumentId || "");
    const requiresWorkspace = outputs.length > 0 || sources.some((source) => (
      String(source?.documentId || "") !== currentDocumentId && source?.relativePath
    ));
    const requestedRoot = String(payload.workspaceRoot || "");
    const rootPath = requiresWorkspace || requestedRoot
      ? await assertAuthorizedDirectory(requestedRoot)
      : "";
    const commitId = `collaboration-commit-${randomUUID()}`;
    const seenTargets = new Set();
    const prepared = [];
    try {
      const remembered = proposalSourceDocuments.get(String(payload.proposalId || ""));
      const sourceDocumentsById = new Map(remembered?.documents || []);
      await verifyProposalSources({ rootPath, sources, currentDocumentId, overlays: payload.overlays, sourceDocumentsById });
      for (const output of outputs) {
        const rawFolderRelative = String(output?.folderRelativePath || "").replace(/\\/g, "/").trim();
        if (rawFolderRelative.startsWith("/") || /^[a-z]:\//i.test(rawFolderRelative) || rawFolderRelative.endsWith("/")) throw new Error("派生信笺目录无效");
        const folderRelative = rawFolderRelative;
        if (folderRelative.split("/").some((segment) => segment === "." || segment === ".." || segment.startsWith("."))) throw new Error("派生信笺目录无效");
        const folderPath = path.resolve(rootPath, ...(folderRelative ? folderRelative.split("/") : []));
        if (!isPathInside(rootPath, folderPath)) throw new Error("派生信笺目录不在当前工作区");
        const folderStat = await fs.stat(folderPath);
        if (!folderStat.isDirectory()) throw new Error("派生信笺目录不存在");
        const fileName = String(output?.fileName || "").trim();
        if (!/^[^<>:"/\\|?*\u0000-\u001f]{1,240}\.letterpaper$/i.test(fileName)) throw new Error("派生信笺文件名无效");
        if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(fileName)) throw new Error("派生信笺文件名是系统保留名称");
        const targetPath = path.join(folderPath, fileName);
        const targetKey = process.platform === "win32" ? targetPath.toLocaleLowerCase("en-US") : targetPath;
        if (seenTargets.has(targetKey)) throw new Error("多个派生信笺使用了同一文件名");
        seenTargets.add(targetKey);
        if (await fs.stat(targetPath).then(() => true).catch((error) => error?.code === "ENOENT" ? false : Promise.reject(error))) {
          throw new Error(`文件已存在：${fileName}`);
        }
        const timestamp = new Date().toISOString();
        const source = payload.sourceDocument && typeof payload.sourceDocument === "object" ? payload.sourceDocument : {};
        const requestedSourceIds = new Set((Array.isArray(output?.sourceDocumentIds) ? output.sourceDocumentIds : []).map(String));
        const copiedCurrentBlocks = String(output?.copiedHtml || "").slice(0, 8 * 1024 * 1024);
        const copiedDocuments = [...sourceDocumentsById.entries()]
          .filter(([documentId]) => requestedSourceIds.has(String(documentId)))
          .map(([, document]) => document);
        const copyWholeCurrent = requestedSourceIds.has(String(source.documentId || "")) && !copiedCurrentBlocks;
        const inheritedDocuments = [source, ...copiedDocuments];
        const html = [
          String(output.html || "").slice(0, 8 * 1024 * 1024),
          copiedCurrentBlocks,
          ...(copyWholeCurrent ? [String(source.html || "")] : []),
          ...copiedDocuments.map((document) => String(document?.html || "")),
        ].filter(Boolean).join("\n").slice(0, 8 * 1024 * 1024);
        const metadata = mergeReferencedMetadata(inheritedDocuments, html);
        const document = normalizeDocument({
          ...source,
          version: 3,
          documentId: randomUUID(),
          derivedFrom: String(source.documentId || ""),
          title: String(output.title || "未命名信笺").slice(0, 200),
          html,
          footnotes: metadata.footnotes,
          citationSources: metadata.citationSources,
          comments: [],
          aiState: createEmptyAiState(),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        const tempPath = path.join(folderPath, `.${randomUUID()}.ai-collaboration.letterpaper`);
        const saved = await savePaperDocument(tempPath, document);
        prepared.push({ tempPath, targetPath, document: saved.document, diskRevision: saved.diskRevision });
      }
      const record = { commitId, proposalId: String(payload.proposalId || ""), status: "prepared", workspaceRoot: rootPath, outputs: prepared, createdAt: new Date().toISOString() };
      preparedCommits.set(commitId, record);
      await writeJournal(record);
      return {
        ok: true,
        commitId,
        outputs: prepared.map((output) => ({ path: output.targetPath, document: output.document, diskRevision: output.diskRevision })),
      };
    } catch (error) {
      await cleanupPrepared({ outputs: prepared });
      throw error;
    }
  }

  async function commitPrepared(commitIdValue) {
    const commitId = String(commitIdValue || "");
    const record = preparedCommits.get(commitId);
    if (!record) throw new Error("AI 协作提交凭据已失效");
    const committed = [];
    try {
      record.status = "committing";
      await writeJournal(record);
      for (const output of record.outputs) {
        await fs.rename(output.tempPath, output.targetPath);
        committed.push(output.targetPath);
        await authorizeDocumentPath(output.targetPath);
      }
      record.status = "complete";
      await writeJournal(record);
      preparedCommits.delete(commitId);
      proposalSourceDocuments.delete(record.proposalId);
      await clearJournal();
      return {
        ok: true,
        outputs: record.outputs.map((output) => ({ path: output.targetPath, document: output.document, diskRevision: output.diskRevision })),
      };
    } catch (error) {
      await cleanupPrepared(record, { removeTargets: true });
      preparedCommits.delete(commitId);
      await clearJournal().catch(() => {});
      throw error;
    }
  }

  async function abortPrepared(commitIdValue) {
    const commitId = String(commitIdValue || "");
    const record = preparedCommits.get(commitId);
    if (!record) return { ok: true, aborted: false };
    await cleanupPrepared(record);
    preparedCommits.delete(commitId);
    await clearJournal();
    return { ok: true, aborted: true };
  }

  async function cancel(idValue) {
    const id = String(idValue || "");
    const controller = activeRequests.get(id);
    controller?.abort(new Error("已停止 AI 协作"));
    return { ok: true, canceled: Boolean(controller) };
  }

  function abortAll() {
    activeRequests.forEach((controller) => controller.abort());
    activeRequests.clear();
    proposalSourceDocuments.clear();
  }

  return {
    abortAll,
    facade: Object.freeze({
      abortPrepared,
      cancel,
      commitPrepared,
      plan,
      prepareCommit,
      route,
      validateProposalSources,
    }),
    initialize,
  };
}

module.exports = {
  createAiCollaborationRuntime,
};
