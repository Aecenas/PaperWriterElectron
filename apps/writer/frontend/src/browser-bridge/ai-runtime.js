import {
  BROWSER_AI_PROTOCOLS,
  MAX_BROWSER_AI_MODELS,
  MAX_BROWSER_AI_PROVIDERS,
  browserTaskAiProviderConfig,
  browserModelId,
  exactBrowserAiProviderConfig,
  hasOwn,
  normalizeBrowserAiConfig as normalizeBrowserAiConfigValue,
  normalizeBrowserAiRequestParams,
  normalizeBrowserModelConfig,
  publicBrowserAiConfig as publicBrowserAiConfigValue,
  safeBrowserProviderId,
} from "../browser-ai-config.js";
import { validateSelectionAiPayload } from "../selection-ai/protocol.js";
import { readJson, writeJson } from "./storage.js";

const browserAiListeners = {
  chunk: new Set(),
  done: new Set(),
  error: new Set(),
  helpChunk: new Set(),
  helpDone: new Set(),
  helpError: new Set(),
  researchTranslationProgress: new Set(),
  collaborationEvent: new Set(),
};
const browserSelectionAiRequests = new Map();
const browserHelpAiRequests = new Map();
const browserCollaborationRequests = new Map();
const browserCollaborationCommits = new Map();
const browserResearchTranslationRequests = new Map();
const BROWSER_HELP_AI_STORAGE_KEY = "paperwriter.helpAssistant.v1";
const BROWSER_AI_TASK_MODEL_KEYS = Object.freeze([
  "selectionChat",
  "applyResolver",
  "helpAssistant",
  "researchTranslation",
  "composeDraft",
]);
const BROWSER_AI_TASK_MODEL_KEY_SET = new Set(
  BROWSER_AI_TASK_MODEL_KEYS,
);
const BROWSER_AI_TASK_MODEL_ASSIGNMENT_KEYS = new Set([
  "providerId",
  "modelId",
  "requestParams",
]);
const BROWSER_SELECTION_AI_CONCURRENT_REQUEST_LIMIT = 4;

function validateBrowserAiRequestParamsPatch(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请求参数必须是 Key-Value 对象");
  const normalized = normalizeBrowserAiRequestParams(value);
  let sourceJson = "";
  try {
    sourceJson = JSON.stringify(value);
  } catch {
    throw new Error("请求参数包含无法保存的值");
  }
  if (sourceJson !== JSON.stringify(normalized)) {
    throw new Error("请求参数包含空键、保留字段、危险键或无效值");
  }
  return normalized;
}

function emitBrowserAi(type, payload) {
  browserAiListeners[type]?.forEach((callback) => callback(payload));
}

function browserCollaborationId(prefix = "ai-collaboration") {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function browserCollaborationDelay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function browserResearchTranslationBatches(blocks) {
  const batches = [];
  let current = [];
  let characters = 0;
  for (const block of blocks) {
    if (current.length && (current.length >= 100 || characters + block.text.length > 12_000)) {
      batches.push(current);
      current = [];
      characters = 0;
    }
    current.push(block);
    characters += block.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

function browserCollaborationRoute(question) {
  const asksForChange = /(?:添加|加入|插入|修改|改成|改写|替换|删除|移除|拆分|分割|合并|生成|制作|画|转换|转成|整理成|应用|加上).*(?:标题|表情|emoji|图|表格|正文|段落|信笺)|(?:把|将).*(?:改|转|拆|分|合|加|删)/i.test(question);
  return {
    mode: asksForChange ? "collaborate" : "answer",
    confidence: asksForChange ? 0.92 : 0.86,
    reason: asksForChange ? "请求包含对信笺内容的修改动作" : "请求主要是在询问信息",
  };
}

function browserCollaborationProposal(payload = {}) {
  const question = String(payload.question || "").trim();
  const current = payload.current || {};
  const manifest = current.manifest || {};
  const editableBlocks = (Array.isArray(manifest.blocks) ? manifest.blocks : []).filter((block) => !block?.protected);
  const anchor = editableBlocks.at(-1) || editableBlocks[0];
  const operations = [];
  if (/标题/.test(question)) {
    operations.push({
      id: "browser-set-title",
      type: "set_title",
      label: "修改信笺标题",
      title: String(question.match(/[《“\"]([^》”\"]+)[》”\"]/)?.[1] || `${current.title || "未命名信笺"}（AI 协作）`).slice(0, 200),
    });
  }
  if (anchor && /mermaid|流程图|关系图|时序图/i.test(question)) {
    operations.push({
      id: "browser-insert-mermaid",
      type: "insert_after",
      label: "添加 Mermaid 图",
      anchorBlockId: anchor.id,
      blocks: [{ type: "mermaid", source: "flowchart TD\n  A[现有内容] --> B[AI 协作审阅]\n  B --> C[用户提交]", caption: "AI 协作流程" }],
    });
  } else if (anchor && /表格/.test(question)) {
    operations.push({
      id: "browser-insert-table",
      type: "insert_after",
      label: "添加表格",
      anchorBlockId: anchor.id,
      blocks: [{ type: "table", headers: ["项目", "说明"], rows: [["浏览器预览", "可审阅当前信笺修改"], ["桌面端", "可按需读取工作区并创建派生信笺"]] }],
    });
  } else if (anchor && /表情|emoji/i.test(question)) {
    operations.push({
      id: "browser-insert-emoji",
      type: "insert_after",
      label: "添加表情提示",
      anchorBlockId: anchor.id,
      blocks: [{ type: "paragraph", text: "✨ 这里是 AI 协作生成的浏览器预览内容。" }],
    });
  }
  if (!operations.length && anchor) {
    operations.push({
      id: "browser-insert-preview",
      type: "insert_after",
      label: "添加协作预览段落",
      anchorBlockId: anchor.id,
      blocks: [{ type: "paragraph", text: "这是 AI 协作的浏览器预览修改；提交前可以继续编辑或取消。" }],
    });
  }
  return {
    version: 1,
    id: browserCollaborationId("collaboration"),
    reply: "我已生成一份浏览器预览修改。请逐项审阅；在你明确提交前，不会改动正文。",
    summary: "浏览器预览协作方案",
    createdAt: Date.now(),
    base: {
      documentId: String(current.documentId || ""),
      documentFingerprint: String(manifest.documentFingerprint || ""),
      revision: String(current.revision || ""),
    },
    sources: [{
      id: String(current.documentId || "current-document"),
      documentId: String(current.documentId || ""),
      title: String(current.title || "当前信笺"),
      relativePath: String(current.relativePath || ""),
      fingerprint: String(manifest.documentFingerprint || ""),
      revision: String(current.revision || ""),
    }],
    operations,
    status: "pending",
  };
}

function browserHelpSessionId() {
  return `help-session-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function browserHelpState() {
  const stored = readJson(BROWSER_HELP_AI_STORAGE_KEY, {});
  const sessions = (Array.isArray(stored.sessions) ? stored.sessions : [])
    .slice(0, 50)
    .filter((session) => session?.id && Array.isArray(session.messages))
    .map((session) => ({
      id: String(session.id),
      title: String(session.title || "新对话").slice(0, 80),
      createdAt: Number(session.createdAt) || Date.now(),
      updatedAt: Number(session.updatedAt) || Date.now(),
      messages: session.messages.slice(-200),
    }));
  const createdDefaultSession = sessions.length === 0;
  if (createdDefaultSession) {
    const createdAt = Date.now();
    sessions.push({ id: browserHelpSessionId(), title: "新对话", createdAt, updatedAt: createdAt, messages: [] });
  }
  const activeSessionId = sessions.some((session) => session.id === stored.activeSessionId)
    ? stored.activeSessionId
    : sessions[0].id;
  const activeRequest = [...browserHelpAiRequests.entries()].map(([requestId, request]) => ({
    requestId,
    sessionId: request.sessionId,
    messageId: request.messageId,
  }))[0] || null;
  if (createdDefaultSession) {
    writeJson(BROWSER_HELP_AI_STORAGE_KEY, { version: 1, activeSessionId, sessions });
  }
  return { version: 1, activeSessionId, sessions, knowledgeVersion: "浏览器预览", activeRequest };
}

function saveBrowserHelpState(value) {
  const state = {
    version: 1,
    activeSessionId: value.activeSessionId,
    sessions: value.sessions,
  };
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > 32 * 1024 * 1024) {
    throw new Error("AI精灵本机历史已达到 32 MB，请删除旧会话后重试");
  }
  writeJson(BROWSER_HELP_AI_STORAGE_KEY, state);
  return { ...state, knowledgeVersion: "浏览器预览", activeRequest: value.activeRequest || null };
}

function browserHelpSource(question) {
  if (/笺间.*(?:是什么|做什么|干嘛|用途)|(?:软件|应用).*(?:是什么|做什么|干嘛|用途)|产品介绍/.test(question)) {
    return { id: "detail:product-overview", kind: "detail", title: "笺间是什么与主要用途", helpTopicId: "files-sidebar" };
  }
  if (/保存|恢复|历史|冲突/.test(question)) return { id: "help:save-recovery", kind: "help", title: "保存、自动保存与恢复", helpTopicId: "save-recovery" };
  if (/AI|模型|供应商|Codex/i.test(question)) return { id: "help:ai-providers", kind: "help", title: "供应商、请求参数与任务模型", helpTopicId: "ai-providers" };
  return { id: "help:files-sidebar", kind: "help", title: "文件区、资料区和结构区", helpTopicId: "files-sidebar" };
}

function normalizeBrowserAiConfig(config = readJson("paperwriter.aiConfig", {})) {
  return normalizeBrowserAiConfigValue(config);
}

function publicBrowserAiConfig(config = readJson("paperwriter.aiConfig", {})) {
  return publicBrowserAiConfigValue(config);
}

function createBrowserAiApi() {
  return {
    getAiConfig: async () => publicBrowserAiConfig(),
    getHelpAssistantState: async () => browserHelpState(),
    createHelpAssistantSession: async () => {
      const state = browserHelpState();
      if (state.sessions.length >= 50) throw new Error("AI精灵最多保留 50 个会话，请先删除旧会话");
      const createdAt = Date.now();
      const session = { id: browserHelpSessionId(), title: "新对话", createdAt, updatedAt: createdAt, messages: [] };
      state.sessions.unshift(session);
      state.activeSessionId = session.id;
      return { ok: true, session, state: saveBrowserHelpState(state) };
    },
    setActiveHelpAssistantSession: async (sessionId) => {
      const state = browserHelpState();
      if (!state.sessions.some((session) => session.id === sessionId)) throw new Error("AI精灵会话不存在");
      state.activeSessionId = sessionId;
      return { ok: true, state: saveBrowserHelpState(state) };
    },
    renameHelpAssistantSession: async (payload = {}) => {
      const state = browserHelpState();
      const title = String(payload.title || "").trim().slice(0, 80);
      if (!title) throw new Error("会话名称不能为空");
      const session = state.sessions.find((item) => item.id === payload.sessionId);
      if (!session) throw new Error("AI精灵会话不存在");
      session.title = title;
      session.updatedAt = Date.now();
      return { ok: true, state: saveBrowserHelpState(state) };
    },
    deleteHelpAssistantSession: async (sessionId) => {
      if ([...browserHelpAiRequests.values()].some((request) => request.sessionId === sessionId)) {
        throw new Error("这个会话仍在生成，请先停止回答");
      }
      const state = browserHelpState();
      state.sessions = state.sessions.filter((session) => session.id !== sessionId);
      if (!state.sessions.length) {
        const createdAt = Date.now();
        state.sessions.push({ id: browserHelpSessionId(), title: "新对话", createdAt, updatedAt: createdAt, messages: [] });
      }
      if (!state.sessions.some((session) => session.id === state.activeSessionId)) state.activeSessionId = state.sessions[0].id;
      return { ok: true, state: saveBrowserHelpState(state) };
    },
    refreshCodexCliStatus: async () => ({ ...publicBrowserAiConfig(), ok: false, message: "Codex CLI 仅在桌面端可用" }),
    startCodexCliLogin: async () => ({ ...publicBrowserAiConfig(), ok: false, message: "Codex CLI 仅在桌面端可用" }),
    onCodexCliStatus: () => () => {},
    createAiProvider: async (input = {}) => {
      const previous = normalizeBrowserAiConfig();
      if (Object.keys(previous.providers).length >= MAX_BROWSER_AI_PROVIDERS) throw new Error("供应商数量已达上限");
      const providerLabel = String(input.providerLabel || input.label || "").slice(0, 120).trim();
      if (!providerLabel) throw new Error("请填写供应商名称");
      if (Object.values(previous.providers).some((provider) => provider.providerLabel.toLocaleLowerCase() === providerLabel.toLocaleLowerCase())) {
        throw new Error("供应商名称已存在");
      }
      const protocol = hasOwn(BROWSER_AI_PROTOCOLS, input.protocol) ? input.protocol : "openai";
      const baseUrl = String(input.baseUrl || BROWSER_AI_PROTOCOLS[protocol].baseUrl).slice(0, 2048).trim().replace(/\/+$/, "");
      let parsed;
      try { parsed = new URL(baseUrl); } catch { throw new Error("请输入有效的 Base URL"); }
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Base URL 仅支持 HTTP 或 HTTPS");
      if (/\/(chat\/completions|messages)$/i.test(parsed.pathname.replace(/\/+$/, ""))) throw new Error("Base URL 不需要包含具体请求端点");
      const provider = `custom-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
      const next = normalizeBrowserAiConfig({
        ...previous,
        providers: { ...previous.providers, [provider]: { provider, providerLabel, protocol, builtin: false, baseUrl, apiKey: "", activeModelId: "", models: [] } },
      });
      writeJson("paperwriter.aiConfig", next);
      return { ...publicBrowserAiConfig(next), createdProvider: provider, ok: true };
    },
    deleteAiProvider: async (provider) => {
      const previous = normalizeBrowserAiConfig();
      const safeProvider = safeBrowserProviderId(provider);
      const target = safeProvider && hasOwn(previous.providers, safeProvider) ? previous.providers[safeProvider] : null;
      if (!target) throw new Error("供应商不存在");
      if (target.builtin) throw new Error("内置供应商不可删除");
      if (previous.activeProvider === safeProvider) throw new Error("请先切换默认供应商后再删除");
      const providers = Object.assign(Object.create(null), previous.providers);
      delete providers[safeProvider];
      const next = normalizeBrowserAiConfig({ ...previous, providers });
      writeJson("paperwriter.aiConfig", next);
      return { ...publicBrowserAiConfig(next), ok: true };
    },
    saveAiConfig: async (config = {}) => {
      const previous = normalizeBrowserAiConfig();
      let nextTaskModels = previous.taskModels;
      if (hasOwn(config, "taskModels")) {
        if (
          !config.taskModels
          || typeof config.taskModels !== "object"
          || Array.isArray(config.taskModels)
          || Object.keys(config.taskModels).some(
            (taskKey) => !BROWSER_AI_TASK_MODEL_KEY_SET.has(taskKey),
          )
        ) {
          throw new Error("任务模型配置无效");
        }
        const taskModelsPatch = { ...config.taskModels };
        const touchedTaskKeys = [];
        for (const taskKey of BROWSER_AI_TASK_MODEL_KEYS) {
          if (!hasOwn(taskModelsPatch, taskKey)) continue;
          touchedTaskKeys.push(taskKey);
          const source = taskModelsPatch[taskKey];
          if (
            !source
            || typeof source !== "object"
            || Array.isArray(source)
            || Object.keys(source).some(
              (key) => !BROWSER_AI_TASK_MODEL_ASSIGNMENT_KEYS.has(key),
            )
            || (
              source.providerId !== undefined
              && typeof source.providerId !== "string"
            )
            || (
              source.modelId !== undefined
              && typeof source.modelId !== "string"
            )
          ) {
            throw new Error("任务模型配置无效");
          }
          if (
            Boolean(source.providerId?.trim())
            !== Boolean(source.modelId?.trim())
          ) {
            throw new Error("任务模型必须同时指定供应商和模型");
          }
          taskModelsPatch[taskKey] = {
            ...source,
            requestParams: validateBrowserAiRequestParamsPatch(
              source.requestParams,
            ),
          };
        }
        nextTaskModels = normalizeBrowserAiConfigValue({
          ...previous,
          taskModels: { ...previous.taskModels, ...taskModelsPatch },
        }).taskModels;
        for (const taskKey of touchedTaskKeys) {
          const assignment = nextTaskModels[taskKey];
          if (assignment.providerId || assignment.modelId) {
            const exact = exactBrowserAiProviderConfig(previous, assignment);
            if (!exact || exact.provider.transport === "codex-cli" || !exact.provider.apiKey || !exact.model.testedOk) {
              throw new Error("任务模型只能选择已连接供应商中的已连接模型");
            }
          }
        }
      }
      const requestedProvider = safeBrowserProviderId(config.provider);
      const provider = requestedProvider && hasOwn(previous.providers, requestedProvider) ? requestedProvider : previous.activeProvider;
      const providerPrevious = previous.providers[provider];
      if (Array.isArray(config.models)) {
        config.models.forEach((model) => validateBrowserAiRequestParamsPatch(model?.requestParams || {}));
      }
      const nextProviderLabel = providerPrevious.builtin ? providerPrevious.providerLabel : String(config.providerLabel ?? providerPrevious.providerLabel).slice(0, 120).trim();
      if (!nextProviderLabel) throw new Error("请填写供应商名称");
      if (!providerPrevious.builtin && Object.values(previous.providers).some((item) => item.provider !== provider && item.providerLabel.toLocaleLowerCase() === nextProviderLabel.toLocaleLowerCase())) throw new Error("供应商名称已存在");
      const hasModelPatch = Boolean(config.modelId || config.model || (Array.isArray(config.models) && config.models.length));
      const modelId = hasModelPatch ? (config.modelId || providerPrevious.activeModelId || browserModelId(provider, config.model || providerPrevious.model)) : "";
      const previousModels = Array.isArray(config.models)
        ? config.models.slice(0, MAX_BROWSER_AI_MODELS).map((model, index) => normalizeBrowserModelConfig(provider, model, index))
        : providerPrevious.models;
      const existingModel = previousModels.find((model) => model.id === modelId);
      const nextModel = hasModelPatch ? normalizeBrowserModelConfig(provider, {
        ...(existingModel || {}),
        id: modelId,
        name: config.modelName || existingModel?.name,
        model: config.model || existingModel?.model,
        testedOk: (config.resetTest || config.clearApiKey) ? false : existingModel?.testedOk,
        testedAt: (config.resetTest || config.clearApiKey) ? "" : existingModel?.testedAt,
        testMessage: (config.resetTest || config.clearApiKey) ? "" : existingModel?.testMessage,
      }) : null;
      const updatedModels = !nextModel ? previousModels : (existingModel
        ? previousModels.map((model) => (model.id === modelId ? nextModel : model))
        : [...previousModels, nextModel]);
      const previousModelsById = new Map((providerPrevious.models || []).map((model) => [model.id, model]));
      const nextModels = updatedModels.map((model) => {
        const previousModel = previousModelsById.get(model.id);
        const requestParamsChanged = Boolean(previousModel)
          && JSON.stringify(previousModel.requestParams || {}) !== JSON.stringify(model.requestParams || {});
        return config.clearApiKey || config.resetTest || requestParamsChanged
          ? { ...model, testedOk: false, testedAt: "", testMessage: "" }
          : model;
      });
      const next = normalizeBrowserAiConfig({
        ...previous,
        taskModels: nextTaskModels,
        activeProvider: config.activate === true ? provider : previous.activeProvider,
        activeModelId: config.activate === true ? modelId : previous.activeModelId,
        providers: {
          ...previous.providers,
          [provider]: {
            ...providerPrevious,
            providerLabel: nextProviderLabel,
            baseUrl: typeof config.baseUrl === "string" ? config.baseUrl.slice(0, 2048) : providerPrevious.baseUrl,
            apiKey: config.clearApiKey ? "" : ((typeof config.apiKey === "string" ? config.apiKey.slice(0, 16384).trim() : "") || providerPrevious.apiKey || ""),
            activeModelId: config.activate === true ? modelId : providerPrevious.activeModelId,
            models: nextModels,
          },
        },
      });
      writeJson("paperwriter.aiConfig", next);
      return publicBrowserAiConfig(next);
    },
    testAiConfig: async (config = {}) => {
      const saved = normalizeBrowserAiConfig();
      const requestedProvider = safeBrowserProviderId(config.provider);
      const provider = requestedProvider && hasOwn(saved.providers, requestedProvider) ? requestedProvider : saved.activeProvider || "gemini";
      const providerSaved = saved.providers[provider] || {};
      const modelId = config.modelId || providerSaved.activeModelId || browserModelId(provider, config.model || providerSaved.model);
      const existingModel = providerSaved.models?.find((model) => model.id === modelId);
      const suppliedApiKey = typeof config.apiKey === "string" ? config.apiKey.slice(0, 16384).trim() : "";
      if (!suppliedApiKey && !providerSaved.apiKey) {
        return { ok: false, message: "浏览器预览需要先填写 API Key" };
      }
      const nextModel = normalizeBrowserModelConfig(provider, {
        ...(existingModel || {}),
        id: modelId,
        name: config.modelName || existingModel?.name,
        model: config.model || existingModel?.model || providerSaved.model,
        testedOk: true,
        testedAt: new Date().toISOString(),
        testMessage: "浏览器预览已测试",
      });
      const next = normalizeBrowserAiConfig({
        ...saved,
        taskModels: saved.taskModels,
        activeProvider: saved.activeProvider,
        activeModelId: saved.activeModelId,
        providers: {
          ...saved.providers,
          [provider]: {
            ...providerSaved,
            baseUrl: typeof config.baseUrl === "string" ? config.baseUrl.slice(0, 2048) : providerSaved.baseUrl,
            apiKey: suppliedApiKey || providerSaved.apiKey || "",
            models: existingModel
              ? providerSaved.models.map((model) => (model.id === modelId ? nextModel : model))
              : [...(providerSaved.models || []), nextModel],
          },
        },
      });
      writeJson("paperwriter.aiConfig", next);
      return { ...publicBrowserAiConfig(next), ok: true, message: "浏览器预览已保存配置，真实请求请在桌面端测试" };
    },
    generateAi: async (payload = {}) => {
      const requestId = payload.requestId || `browser-${Date.now()}`;
      const chunks = ["这是一段浏览器预览 AI 回复。", "\n\n", "桌面端会使用当前已测试的默认供应商和模型流式生成真实内容。"];
      chunks.forEach((delta, index) => {
        window.setTimeout(() => emitBrowserAi("chunk", { requestId, delta }), 120 * (index + 1));
      });
      window.setTimeout(() => emitBrowserAi("done", {
        requestId,
        usage: { prompt_tokens: 1200, completion_tokens: 320, total_tokens: 1520 },
      }), 120 * (chunks.length + 1));
      return { ok: true, requestId };
    },
    translateResearchContent: async (payload = {}) => {
      const payloadKeys = new Set(["requestId", "kind", "page", "targetLanguage", "blocks"]);
      const requestId = String(payload?.requestId || "");
      const validRequestId = /^ai-research-translation-[a-z0-9-]{6,100}$/i.test(requestId);
      const kind = String(payload?.kind || "");
      const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
      const blockIds = new Set();
      const invalidBlocks = !blocks.length
        || blocks.length > 20_000
        || blocks.some((block) => {
          const invalid = !block
            || typeof block !== "object"
            || Array.isArray(block)
            || Object.keys(block).some((key) => !["id", "text"].includes(key))
            || typeof block.id !== "string"
            || !/^[a-z0-9._:-]{1,100}$/i.test(block.id)
            || blockIds.has(block.id)
            || typeof block.text !== "string"
            || !block.text.trim()
            || block.text.length > 12_000;
          if (!invalid) blockIds.add(block.id);
          return invalid;
        });
      if (!payload || typeof payload !== "object" || Array.isArray(payload)
        || Object.keys(payload).some((key) => !payloadKeys.has(key))
        || !validRequestId
        || !["pdf", "docx", "markdown", "text", "table"].includes(kind)
        || (kind === "pdf" && (!Number.isSafeInteger(payload.page) || payload.page <= 0))
        || payload.targetLanguage !== "zh-CN"
        || invalidBlocks) {
        return { ok: false, requestId: validRequestId ? requestId : "", code: "AI_RESEARCH_TRANSLATION_PAYLOAD_INVALID", message: "资料翻译请求无效" };
      }
      if (blocks.reduce((total, block) => total + block.text.length, 0) > 200_000) {
        return { ok: false, requestId, code: "AI_RESEARCH_TRANSLATION_TOO_LARGE", message: "当前资料超过 20 万字符，未发送给 AI" };
      }
      if (browserResearchTranslationRequests.has(requestId)) {
        return { ok: false, requestId, code: "AI_RESEARCH_TRANSLATION_REQUEST_DUPLICATE", message: "资料翻译请求标识重复" };
      }
      const saved = normalizeBrowserAiConfig();
      const assignment = saved.taskModels?.researchTranslation || {};
      const explicit = Boolean(assignment.providerId || assignment.modelId);
      const selected = browserTaskAiProviderConfig(saved, assignment);
      if (!selected || selected.provider.transport === "codex-cli" || !selected.provider.apiKey || !selected.model.testedOk) {
        return {
          ok: false,
          requestId,
          code: explicit ? "AI_RESEARCH_TRANSLATION_MODEL_INVALID" : "AI_DEFAULT_MODEL_UNAVAILABLE",
          message: explicit
            ? "资料翻译模型已失效，请在“AI 配置 → 任务模型”中重新选择"
            : "请先配置并测试默认模型",
        };
      }
      const batches = browserResearchTranslationBatches(blocks);
      browserResearchTranslationRequests.set(requestId, true);
      emitBrowserAi("researchTranslationProgress", { requestId, completedBatches: 0, totalBatches: batches.length, message: `正在翻译 0/${batches.length} 批…` });
      const translations = [];
      for (let index = 0; index < batches.length; index += 1) {
        await browserCollaborationDelay(90);
        if (!browserResearchTranslationRequests.has(requestId)) {
          return { ok: false, requestId, canceled: true, code: "AI_RESEARCH_TRANSLATION_CANCELED", message: "已停止资料翻译" };
        }
        translations.push(...batches[index].map((block) => ({
          id: block.id,
          text: /[A-Za-z]/.test(block.text) ? `【简体中文预览】${block.text}` : block.text,
        })));
        emitBrowserAi("researchTranslationProgress", { requestId, completedBatches: index + 1, totalBatches: batches.length, message: `正在翻译 ${index + 1}/${batches.length} 批…` });
      }
      browserResearchTranslationRequests.delete(requestId);
      return {
        ok: true,
        requestId,
        translations,
        model: { providerId: selected.provider.provider, providerLabel: selected.provider.providerLabel, modelId: selected.model.id, modelName: selected.model.name },
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
      };
    },
    cancelResearchTranslation: async (requestId) => ({
      ok: true,
      canceled: browserResearchTranslationRequests.delete(String(requestId || "")),
    }),
    routeAiCollaboration: async (payload = {}) => {
      const requestId = String(payload.requestId || browserCollaborationId());
      const question = String(payload.question || "").trim();
      if (!question) return { ok: false, message: "AI 协作问题为空" };
      browserCollaborationRequests.set(requestId, { kind: "route" });
      emitBrowserAi("collaborationEvent", { requestId, type: "routing", message: "正在判断回答方式" });
      const route = browserCollaborationRoute(question);
      browserCollaborationRequests.delete(requestId);
      return { ok: true, requestId, ...route, model: { modelName: "浏览器预览" } };
    },
    planAiCollaboration: async (payload = {}) => {
      const requestId = String(payload.requestId || browserCollaborationId());
      if (!payload.current?.documentId || !payload.current?.manifest?.documentFingerprint) {
        return { ok: false, message: "当前信笺快照无效" };
      }
      browserCollaborationRequests.set(requestId, { kind: "plan" });
      const startedAt = Date.now();
      emitBrowserAi("collaborationEvent", { requestId, type: "planning", message: "正在整理协作请求" });
      emitBrowserAi("collaborationEvent", { requestId, type: "waiting-model", message: "正在等待 AI 返回修改方案" });
      await browserCollaborationDelay(180);
      if (!browserCollaborationRequests.has(requestId)) return { ok: false, canceled: true, message: "已停止 AI 协作" };
      emitBrowserAi("collaborationEvent", { requestId, type: "receiving-model", message: "AI 已开始返回，正在接收修改方案" });
      await browserCollaborationDelay(240);
      if (!browserCollaborationRequests.has(requestId)) return { ok: false, canceled: true, message: "已停止 AI 协作" };
      emitBrowserAi("collaborationEvent", { requestId, type: "validating", message: "AI 返回完成，正在本地检查方案" });
      await browserCollaborationDelay(80);
      const proposal = browserCollaborationProposal(payload);
      browserCollaborationRequests.delete(requestId);
      return {
        ok: true,
        requestId,
        proposal,
        model: { modelName: "浏览器预览" },
        timing: { totalMs: Date.now() - startedAt, modelMs: 420, modelRequests: 1, toolRounds: 0 },
      };
    },
    cancelAiCollaboration: async (requestId) => ({
      ok: true,
      canceled: browserCollaborationRequests.delete(String(requestId || "")),
    }),
    validateAiCollaborationProposal: async () => ({ ok: true, stale: false, browserOnly: true }),
    prepareAiCollaborationCommit: async (payload = {}) => {
      if ((payload.outputs || []).length) {
        return { ok: false, message: "浏览器预览不能创建工作区派生信笺，请在桌面端提交" };
      }
      const commitId = browserCollaborationId("browser-commit");
      browserCollaborationCommits.set(commitId, { createdAt: Date.now() });
      return { ok: true, commitId, outputs: [] };
    },
    commitAiCollaboration: async (commitId) => {
      const committed = browserCollaborationCommits.delete(String(commitId || ""));
      return committed ? { ok: true, files: [] } : { ok: false, message: "协作提交已失效" };
    },
    abortAiCollaborationCommit: async (commitId) => ({
      ok: true,
      aborted: browserCollaborationCommits.delete(String(commitId || "")),
    }),
    generateSelectionAi: async (payload = {}) => {
      const validated = validateSelectionAiPayload(payload);
      if (!validated.ok) return validated;
      const saved = normalizeBrowserAiConfig();
      const assignment = saved.taskModels?.selectionChat || {};
      const explicitAssignment = Boolean(
        assignment.providerId || assignment.modelId,
      );
      const selected = browserTaskAiProviderConfig(saved, assignment);
      if (
        !selected
        || selected.provider.transport === "codex-cli"
        || !selected.provider.apiKey
        || !selected.model.testedOk
      ) {
        return {
          ok: false,
          code: explicitAssignment
            ? "AI_SELECTION_CHAT_MODEL_INVALID"
            : "AI_DEFAULT_MODEL_UNAVAILABLE",
          message: explicitAssignment
            ? "选区问答模型已失效，请在“AI 配置 → 任务模型”中重新选择"
            : "请先配置并测试默认模型",
        };
      }
      const { requestId } = validated.value;
      if (browserSelectionAiRequests.has(requestId)) {
        return {
          ok: false,
          code: "AI_SELECTION_REQUEST_DUPLICATE",
          message: "选区问答请求标识重复",
        };
      }
      if (
        browserSelectionAiRequests.size
        >= BROWSER_SELECTION_AI_CONCURRENT_REQUEST_LIMIT
      ) {
        return {
          ok: false,
          code: "AI_SELECTION_REQUEST_LIMIT",
          message: "同时运行的选区问答过多，请稍后重试",
        };
      }
      const timers = [];
      const chunks = [
        "这是选区问答的浏览器预览回复。",
        "\n\n",
        "桌面端会只使用冻结的选中文字、当前问题和这个临时小窗的历史。",
      ];
      chunks.forEach((delta, index) => {
        timers.push(window.setTimeout(() => {
          if (!browserSelectionAiRequests.has(requestId)) return;
          emitBrowserAi("chunk", { requestId, delta });
        }, 120 * (index + 1)));
      });
      timers.push(window.setTimeout(() => {
        if (!browserSelectionAiRequests.has(requestId)) return;
        browserSelectionAiRequests.delete(requestId);
        emitBrowserAi("done", {
          requestId,
          usage: {
            prompt_tokens: 120,
            completion_tokens: 32,
            total_tokens: 152,
          },
        });
      }, 120 * (chunks.length + 1)));
      browserSelectionAiRequests.set(requestId, timers);
      return {
        ok: true,
        requestId,
        model: {
          providerId: selected.provider.provider,
          providerLabel: selected.provider.providerLabel,
          modelId: selected.model.id,
          modelName: selected.model.name,
        },
      };
    },
    generateHelpAssistant: async (payload = {}) => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)
        || Object.keys(payload).some((key) => !["requestId", "sessionId", "question"].includes(key))) {
        return { ok: false, code: "AI_HELP_PAYLOAD_INVALID", message: "AI精灵请求包含不允许的字段" };
      }
      const requestId = String(payload.requestId || "");
      const sessionId = String(payload.sessionId || "");
      const question = String(payload.question || "").trim();
      if (!/^ai-help-[a-z0-9-]{6,100}$/i.test(requestId) || !question || question.length > 8000) {
        return { ok: false, code: "AI_HELP_PAYLOAD_INVALID", message: "AI精灵请求无效" };
      }
      if (browserHelpAiRequests.size) return { ok: false, code: "AI_HELP_REQUEST_LIMIT", message: "AI精灵已有回答正在生成" };
      const saved = normalizeBrowserAiConfig();
      const assignment = saved.taskModels?.helpAssistant || {};
      const explicit = Boolean(assignment.providerId || assignment.modelId);
      const selected = browserTaskAiProviderConfig(saved, assignment);
      if (!selected || selected.provider.transport === "codex-cli" || !selected.provider.apiKey || !selected.model.testedOk) {
        return {
          ok: false,
          code: explicit ? "AI_HELP_MODEL_INVALID" : "AI_DEFAULT_MODEL_UNAVAILABLE",
          message: explicit
            ? "AI精灵模型已失效，请在“AI 配置 → 任务模型”中重新选择"
            : "请先配置并测试默认模型",
        };
      }
      const state = browserHelpState();
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) return { ok: false, code: "AI_HELP_SESSION_MISSING", message: "AI精灵会话不存在" };
      if (session.messages.length + 2 > 200) return { ok: false, code: "AI_HELP_MESSAGE_LIMIT", message: "当前会话已达到 200 条消息，请新建会话" };
      const createdAt = Date.now();
      const messageId = `assistant-${createdAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const source = browserHelpSource(question);
      const model = { providerId: selected.provider.provider, providerLabel: selected.provider.providerLabel, modelId: selected.model.id, modelName: selected.model.name };
      session.messages.push(
        { id: `user-${createdAt.toString(36)}`, role: "user", content: question, status: "done", createdAt, sources: [], model: null },
        { id: messageId, role: "assistant", content: "", status: "streaming", createdAt: createdAt + 1, sources: [source], model },
      );
      if (session.messages.length === 2) session.title = question.length > 24 ? `${question.slice(0, 24)}…` : question;
      session.updatedAt = createdAt;
      state.activeSessionId = sessionId;
      saveBrowserHelpState(state);
      const productOverviewQuestion = /笺间.*(?:是什么|做什么|干嘛|用途)|(?:软件|应用).*(?:是什么|做什么|干嘛|用途)|产品介绍/.test(question);
      const chunks = productOverviewQuestion
        ? [
          "笺间是一款面向 Windows 的本地优先写作软件，",
          "适合长文、日记、复盘、论文和资料整理。\n\n",
          "它把信笺写作、资料阅读检索、版本恢复、导入导出和多种 AI 写作能力放在同一个桌面工作区中。",
        ]
        : ["这是 AI精灵的浏览器预览回答。", "\n\n", "桌面版会把每个问题交给已配置的模型，并用内置帮助文档和代码核对知识进行 RAG 增强。"];
      const request = { sessionId, messageId, timers: [], output: "" };
      chunks.forEach((delta, index) => {
        request.timers.push(window.setTimeout(() => {
          if (!browserHelpAiRequests.has(requestId)) return;
          request.output += delta;
          emitBrowserAi("helpChunk", { requestId, sessionId, messageId, delta });
        }, 120 * (index + 1)));
      });
      request.timers.push(window.setTimeout(() => {
        if (!browserHelpAiRequests.has(requestId)) return;
        browserHelpAiRequests.delete(requestId);
        const nextState = browserHelpState();
        const nextSession = nextState.sessions.find((item) => item.id === sessionId);
        const assistant = nextSession?.messages.find((message) => message.id === messageId);
        if (assistant) {
          assistant.content = request.output;
          assistant.status = "done";
          nextSession.updatedAt = Date.now();
          saveBrowserHelpState(nextState);
        }
        emitBrowserAi("helpDone", { requestId, sessionId, messageId, content: request.output, sources: [source], model });
      }, 120 * (chunks.length + 1)));
      browserHelpAiRequests.set(requestId, request);
      return { ok: true, requestId, sessionId, messageId, sources: [source], model, state: browserHelpState() };
    },
    cancelHelpAssistant: async (requestId) => {
      const request = browserHelpAiRequests.get(requestId);
      if (!request) return { ok: true, canceled: false };
      request.timers.forEach((timer) => window.clearTimeout(timer));
      browserHelpAiRequests.delete(requestId);
      const state = browserHelpState();
      const session = state.sessions.find((item) => item.id === request.sessionId);
      const assistant = session?.messages.find((message) => message.status === "streaming");
      if (assistant) {
        assistant.content = request.output || "已停止生成";
        assistant.status = "stopped";
        session.updatedAt = Date.now();
        saveBrowserHelpState(state);
        emitBrowserAi("helpError", { requestId, sessionId: request.sessionId, messageId: assistant.id, content: request.output, message: "已停止生成", aborted: true, sources: assistant.sources, model: assistant.model });
      }
      return { ok: true, canceled: true };
    },
    resolveAiApply: async (payload = {}) => ({
      ok: true,
      raw: {
        version: 1,
        action: "unresolved",
        targetBlockIds: [],
        confidence: 0,
        reason: "浏览器预览不会调用应用裁决模型；请在桌面端使用直接应用，或复制后手动粘贴。",
        ...(payload?.manifest?.documentFingerprint ? { documentFingerprint: String(payload.manifest.documentFingerprint).slice(0, 128) } : {}),
      },
    }),
    cancelAi: async (requestId) => {
      const selectionTimers = browserSelectionAiRequests.get(requestId);
      if (selectionTimers) {
        selectionTimers.forEach((timer) => window.clearTimeout(timer));
        browserSelectionAiRequests.delete(requestId);
      }
      emitBrowserAi("error", { requestId, message: "已停止生成", aborted: true });
      return { ok: true, canceled: Boolean(selectionTimers) };
    },
    exportAiChat: async (payload = {}) => {
      const blob = new Blob([payload.markdown || ""], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${payload.title || "AI协作"}.md`;
      link.click();
      URL.revokeObjectURL(url);
      return { canceled: false, path: link.download };
    },
    onAiChunk: (callback) => {
      browserAiListeners.chunk.add(callback);
      return () => browserAiListeners.chunk.delete(callback);
    },
    onAiDone: (callback) => {
      browserAiListeners.done.add(callback);
      return () => browserAiListeners.done.delete(callback);
    },
    onAiError: (callback) => {
      browserAiListeners.error.add(callback);
      return () => browserAiListeners.error.delete(callback);
    },
    onAiCollaborationEvent: (callback) => {
      browserAiListeners.collaborationEvent.add(callback);
      return () => browserAiListeners.collaborationEvent.delete(callback);
    },
    onHelpAssistantChunk: (callback) => {
      browserAiListeners.helpChunk.add(callback);
      return () => browserAiListeners.helpChunk.delete(callback);
    },
    onHelpAssistantDone: (callback) => {
      browserAiListeners.helpDone.add(callback);
      return () => browserAiListeners.helpDone.delete(callback);
    },
    onHelpAssistantError: (callback) => {
      browserAiListeners.helpError.add(callback);
      return () => browserAiListeners.helpError.delete(callback);
    },
    onResearchTranslationProgress: (callback) => {
      browserAiListeners.researchTranslationProgress.add(callback);
      return () => browserAiListeners.researchTranslationProgress.delete(callback);
    },
  };
}

export { createBrowserAiApi };
