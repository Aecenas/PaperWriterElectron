export const SELECTION_AI_MAX_TEXT_CHARS = 20_000;
export const SELECTION_AI_MAX_QUESTION_CHARS = 4_000;
export const SELECTION_AI_MAX_ROUNDS = 20;
export const SELECTION_AI_MAX_HISTORY_MESSAGES = (SELECTION_AI_MAX_ROUNDS - 1) * 2;
export const SELECTION_AI_MAX_HISTORY_MESSAGE_CHARS = 100_000;
export const SELECTION_AI_MAX_HISTORY_CHARS = 100_000;
export const SELECTION_AI_REQUEST_ID_PATTERN = /^ai-selection-[a-z0-9-]{6,80}$/i;

const ALLOWED_PAYLOAD_KEYS = new Set([
  "requestId",
  "selectedText",
  "history",
  "question",
]);
const ALLOWED_HISTORY_KEYS = new Set(["role", "content"]);

function onlyAllowedKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function failure(code, message) {
  return {
    ok: false,
    code,
    message,
  };
}

export function createSelectionAiRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `ai-selection-${uuid.toLowerCase()}`;
  return `ai-selection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function validateSelectionAiPayload(payload) {
  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || !onlyAllowedKeys(payload, ALLOWED_PAYLOAD_KEYS)
  ) {
    return failure(
      "AI_SELECTION_PAYLOAD_INVALID",
      "选区问答请求包含不允许的字段",
    );
  }
  if (
    typeof payload.requestId !== "string"
    || !SELECTION_AI_REQUEST_ID_PATTERN.test(payload.requestId)
  ) {
    return failure(
      "AI_SELECTION_PAYLOAD_INVALID",
      "选区问答请求标识无效",
    );
  }
  if (
    typeof payload.selectedText !== "string"
    || !payload.selectedText.trim()
    || payload.selectedText.length > SELECTION_AI_MAX_TEXT_CHARS
  ) {
    return failure(
      "AI_SELECTION_TEXT_INVALID",
      `选中文字必须为 1-${SELECTION_AI_MAX_TEXT_CHARS} 个字符`,
    );
  }
  if (
    typeof payload.question !== "string"
    || !payload.question.trim()
    || payload.question.length > SELECTION_AI_MAX_QUESTION_CHARS
  ) {
    return failure(
      "AI_SELECTION_QUESTION_INVALID",
      `问题必须为 1-${SELECTION_AI_MAX_QUESTION_CHARS} 个字符`,
    );
  }
  if (
    !Array.isArray(payload.history)
    || payload.history.length > SELECTION_AI_MAX_HISTORY_MESSAGES
  ) {
    return failure(
      "AI_SELECTION_HISTORY_INVALID",
      `临时对话历史最多 ${SELECTION_AI_MAX_HISTORY_MESSAGES} 条消息`,
    );
  }
  const history = [];
  let historyCharacters = 0;
  for (let index = 0; index < payload.history.length; index += 1) {
    const message = payload.history[index];
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    if (
      !message
      || typeof message !== "object"
      || Array.isArray(message)
      || !onlyAllowedKeys(message, ALLOWED_HISTORY_KEYS)
      || message.role !== expectedRole
      || typeof message.content !== "string"
      || !message.content.trim()
      || message.content.length > SELECTION_AI_MAX_HISTORY_MESSAGE_CHARS
    ) {
      return failure(
        "AI_SELECTION_HISTORY_INVALID",
        "临时对话历史格式无效",
      );
    }
    historyCharacters += message.content.length;
    history.push({
      role: message.role,
      content: message.content,
    });
  }
  if (
    history.length % 2 !== 0
    || historyCharacters > SELECTION_AI_MAX_HISTORY_CHARS
  ) {
    return failure(
      "AI_SELECTION_HISTORY_INVALID",
      "临时对话历史不完整或过长",
    );
  }
  return {
    ok: true,
    value: {
      requestId: payload.requestId,
      selectedText: payload.selectedText,
      history,
      question: payload.question.trim(),
    },
  };
}

export function selectionAiHistoryFromMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const history = [];
  for (const message of messages) {
    const expectedRole = history.length % 2 === 0 ? "user" : "assistant";
    if (
      message?.role !== expectedRole
      || typeof message.content !== "string"
      || !message.content.trim()
      || message.status === "error"
      || message.content.length > SELECTION_AI_MAX_HISTORY_MESSAGE_CHARS
    ) {
      break;
    }
    history.push({
      role: message.role,
      content: message.content,
    });
  }
  while (history.length % 2 !== 0) history.pop();
  return history;
}
