export const AI_REQUEST_PARAM_TYPE_OPTIONS = Object.freeze([
  { value: "string", label: "字符串" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "布尔值" },
  { value: "json", label: "JSON" },
]);

export const AI_REQUEST_PARAM_BOOLEAN_OPTIONS = Object.freeze([
  { value: "true", label: "true" },
  { value: "false", label: "false" },
]);

export const AI_REQUEST_PARAM_PRESETS = Object.freeze({
  gemini: Object.freeze([
    { key: "reasoning_effort", label: "reasoning_effort", type: "string", valueText: "high", hint: "Gemini 3.1 Pro 默认使用 high；也支持 low、medium" },
    { key: "service_tier", label: "service_tier", type: "string", valueText: "standard", hint: "默认使用 standard；还可设置 flex 或 priority" },
    { key: "temperature", label: "temperature", type: "number", valueText: "1", hint: "Gemini 3 系列默认并建议保持为 1" },
  ]),
  deepseek: Object.freeze([
    { key: "thinking", label: "thinking", type: "json", valueText: '{"type":"enabled"}', hint: "默认启用；type 可设置为 enabled 或 disabled" },
    { key: "reasoning_effort", label: "reasoning_effort", type: "string", valueText: "max", hint: "使用最高推理投入；官方可选 high 或 max" },
    { key: "max_tokens", label: "max_tokens", type: "number", valueText: "384000", hint: "最大输出限制；DeepSeek V4 当前上限为 384K" },
    { key: "response_format", label: "response_format", type: "json", valueText: '{"type":"text"}', hint: "默认使用 text；也可设置为 json_object" },
    { key: "temperature", label: "temperature", type: "number", valueText: "1", hint: "默认值为 1；思考模式下不会生效" },
    { key: "top_p", label: "top_p", type: "number", valueText: "1", hint: "默认值为 1；思考模式下不会生效" },
  ]),
});

export const AI_REQUEST_PARAM_PROVIDER_DEFAULTS = Object.freeze({
  gemini: Object.freeze({
    reasoning_effort: "high",
    service_tier: "standard",
    temperature: 1,
  }),
  deepseek: Object.freeze({
    thinking: Object.freeze({ type: "enabled" }),
    reasoning_effort: "max",
    max_tokens: 384_000,
    response_format: Object.freeze({ type: "text" }),
    temperature: 1,
    top_p: 1,
  }),
});

function providerRequestParamDefaults(providerId, model = "") {
  const modelId = String(model || "").trim().toLowerCase();
  if (providerId === "gemini") {
    return /^gemini-3(?:\.|-)/.test(modelId)
      ? AI_REQUEST_PARAM_PROVIDER_DEFAULTS.gemini
      : { service_tier: "standard" };
  }
  if (providerId === "deepseek") {
    const nonThinkingAlias = modelId === "deepseek-chat";
    return {
      thinking: { type: nonThinkingAlias ? "disabled" : "enabled" },
      ...(nonThinkingAlias ? {} : { reasoning_effort: "max" }),
      max_tokens: 384_000,
      response_format: { type: "text" },
      temperature: 1,
      top_p: 1,
    };
  }
  return {};
}

export function aiModelCapabilities(providerId, model = "") {
  const modelId = String(model || "").trim().toLowerCase();
  if (providerId === "gemini" && modelId === "gemini-3.1-pro-preview") {
    return { contextWindow: 1_000_000, maxOutputTokens: 65_536 };
  }
  if (providerId === "deepseek"
    && ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"].includes(modelId)) {
    return { contextWindow: 1_000_000, maxOutputTokens: 384_000 };
  }
  return null;
}

export const AI_REQUEST_PARAM_CUSTOM_OPTION = "__custom__";

const MAX_PARAMS = 64;
const MAX_KEY_CHARS = 128;
const MAX_STRING_CHARS = 16 * 1024;
const MAX_JSON_CHARS = 32 * 1024;
const MAX_DEPTH = 8;
const RESERVED_KEYS = new Set(["model", "messages", "system", "stream", "stream_options"]);
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
let requestParamRowSequence = 0;

function nextRowId() {
  requestParamRowSequence += 1;
  return `ai-param-${Date.now().toString(36)}-${requestParamRowSequence.toString(36)}`;
}

function inferType(value) {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value !== null && typeof value === "object") return "json";
  return "string";
}

function formatValue(value, type) {
  if (type === "json") return JSON.stringify(value);
  return String(value ?? "");
}

function validateJsonValue(value, depth = 0) {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= MAX_STRING_CHARS;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => validateJsonValue(item, depth + 1));
  if (!value || typeof value !== "object") return false;
  return Object.keys(value).every((key) => key.length > 0
    && key.length <= MAX_KEY_CHARS
    && !DANGEROUS_KEYS.has(key.toLowerCase())
    && validateJsonValue(value[key], depth + 1));
}

export function normalizeUiAiRequestParams(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const rawKey of Object.keys(value).slice(0, MAX_PARAMS)) {
    const key = String(rawKey).trim();
    const lower = key.toLowerCase();
    if (!key || key.length > MAX_KEY_CHARS || RESERVED_KEYS.has(lower) || DANGEROUS_KEYS.has(lower) || Object.hasOwn(result, key)) continue;
    const paramValue = value[rawKey];
    if (!validateJsonValue(paramValue)) continue;
    result[key] = paramValue;
  }
  try {
    return JSON.stringify(result).length <= MAX_JSON_CHARS ? result : {};
  } catch {
    return {};
  }
}

export function createAiRequestParamRow(input = {}) {
  const type = AI_REQUEST_PARAM_TYPE_OPTIONS.some((option) => option.value === input.type)
    ? input.type
    : inferType(input.value);
  return {
    id: input.id || nextRowId(),
    key: String(input.key || ""),
    type,
    valueText: input.valueText !== undefined ? String(input.valueText) : formatValue(input.value, type),
    hint: String(input.hint || ""),
  };
}

export function requestParamsToRows(value) {
  return Object.entries(normalizeUiAiRequestParams(value)).map(([key, paramValue]) => createAiRequestParamRow({ key, value: paramValue }));
}

function parseRowValue(row) {
  if (row.type === "number") {
    const trimmed = String(row.valueText || "").trim();
    const value = Number(trimmed);
    return trimmed && Number.isFinite(value) ? { ok: true, value } : { ok: false, message: "请输入有效数字" };
  }
  if (row.type === "boolean") {
    return row.valueText === "true" || row.valueText === "false"
      ? { ok: true, value: row.valueText === "true" }
      : { ok: false, message: "请选择 true 或 false" };
  }
  if (row.type === "json") {
    let value;
    try {
      value = JSON.parse(String(row.valueText || ""));
    } catch {
      return { ok: false, message: "JSON 格式不正确" };
    }
    if ((!Array.isArray(value) && (!value || typeof value !== "object")) || !validateJsonValue(value)) {
      return { ok: false, message: "JSON 值必须是安全的对象或数组" };
    }
    return { ok: true, value };
  }
  const value = String(row.valueText ?? "");
  return value.length <= MAX_STRING_CHARS
    ? { ok: true, value }
    : { ok: false, message: "字符串过长" };
}

export function parseAiRequestParamRows(rows = [], { providerId = "" } = {}) {
  const errors = {};
  const result = {};
  const seen = new Set();
  if (!Array.isArray(rows) || rows.length > MAX_PARAMS) {
    return { valid: false, requestParams: {}, errors, error: `请求参数最多 ${MAX_PARAMS} 项`, warning: "" };
  }
  rows.forEach((row) => {
    const key = String(row?.key || "").trim();
    const lower = key.toLowerCase();
    if (!key) errors[row.id] = "请填写参数名";
    else if (key.length > MAX_KEY_CHARS) errors[row.id] = "参数名过长";
    else if (RESERVED_KEYS.has(lower)) errors[row.id] = "该字段由软件管理，不能覆盖";
    else if (DANGEROUS_KEYS.has(lower)) errors[row.id] = "该参数名不安全";
    else if (seen.has(key)) errors[row.id] = "参数名不能重复";
    else {
      seen.add(key);
      const parsed = parseRowValue(row);
      if (!parsed.ok) errors[row.id] = parsed.message;
      else result[key] = parsed.value;
    }
  });

  let error = "";
  if (!Object.keys(errors).length && providerId === "gemini" && Object.hasOwn(result, "reasoning_effort")) {
    const thinkingConfig = result.extra_body?.google?.thinking_config;
    if (thinkingConfig && typeof thinkingConfig === "object") {
      error = "reasoning_effort 与 extra_body.google.thinking_config 不能同时使用";
    }
  }
  let warning = "";
  if (!Object.keys(errors).length && providerId === "deepseek" && result.thinking?.type === "enabled") {
    const ignored = ["temperature", "top_p"].filter((key) => Object.hasOwn(result, key));
    if (ignored.length) warning = `DeepSeek 思考模式下 ${ignored.join("、")} 不会生效。`;
  }
  if (!Object.keys(errors).length && !error) {
    try {
      if (JSON.stringify(result).length > MAX_JSON_CHARS) error = "请求参数总大小超过限制";
    } catch {
      error = "请求参数包含无法保存的值";
    }
  }
  return {
    valid: Object.keys(errors).length === 0 && !error,
    requestParams: Object.keys(errors).length || error ? {} : result,
    errors,
    error,
    warning,
  };
}

export function aiRequestParamsEqual(left, right) {
  return JSON.stringify(normalizeUiAiRequestParams(left)) === JSON.stringify(normalizeUiAiRequestParams(right));
}

export function aiRequestParamsWithProviderDefaults(providerId, value, model = "") {
  const defaults = normalizeUiAiRequestParams(providerRequestParamDefaults(providerId, model));
  const explicit = normalizeUiAiRequestParams(value);
  const effective = normalizeUiAiRequestParams({ ...defaults, ...explicit });
  if (providerId === "gemini"
    && !Object.hasOwn(explicit, "reasoning_effort")
    && explicit.extra_body?.google?.thinking_config) {
    delete effective.reasoning_effort;
  }
  if (providerId === "deepseek" && !Object.hasOwn(explicit, "reasoning_effort")) {
    if (effective.thinking?.type === "enabled") effective.reasoning_effort = "max";
    else delete effective.reasoning_effort;
  }
  return effective;
}

export function aiTaskRequestParamsForEditor(providerId, modelParams, taskParams, model = "") {
  const configuredModelParams = aiRequestParamsWithProviderDefaults(providerId, modelParams, model);
  const configuredTaskParams = normalizeUiAiRequestParams(taskParams);
  return normalizeUiAiRequestParams({ ...configuredModelParams, ...configuredTaskParams });
}

export function aiApplyResolverEditableRequestParams(providerId, requestParams) {
  const editable = normalizeUiAiRequestParams(requestParams);
  if (providerId === "gemini" || providerId === "deepseek") {
    delete editable.max_tokens;
    delete editable.response_format;
  }
  return editable;
}

export function aiRequestParamPresetOptions(providerId, rows = []) {
  const usedKeys = new Set(rows.map((row) => String(row.key || "").trim()).filter(Boolean));
  const presets = (AI_REQUEST_PARAM_PRESETS[providerId] || []).filter((preset) => !usedKeys.has(preset.key));
  return [
    { value: "", label: "添加参数" },
    ...presets.map((preset) => ({ value: preset.key, label: preset.key })),
    { value: AI_REQUEST_PARAM_CUSTOM_OPTION, label: "自定义参数" },
  ];
}

export function aiRequestParamPreset(providerId, key) {
  return (AI_REQUEST_PARAM_PRESETS[providerId] || []).find((preset) => preset.key === key) || null;
}
