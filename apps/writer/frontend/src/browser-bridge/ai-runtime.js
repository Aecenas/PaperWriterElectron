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
};
const browserSelectionAiRequests = new Map();
const BROWSER_AI_TASK_MODEL_KEYS = Object.freeze([
  "selectionChat",
  "applyResolver",
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

function normalizeBrowserAiConfig(config = readJson("paperwriter.aiConfig", {})) {
  return normalizeBrowserAiConfigValue(config);
}

function publicBrowserAiConfig(config = readJson("paperwriter.aiConfig", {})) {
  return publicBrowserAiConfigValue(config);
}

function createBrowserAiApi() {
  return {
    getAiConfig: async () => publicBrowserAiConfig(),
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
      link.download = `${payload.title || "AI问答"}.md`;
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
  };
}

export { createBrowserAiApi };
