export const AI_PROMPT_PREFIX = "这是我正在写的文章，请你帮我优化内容与表达：";
export const AI_FIXED_LETTER_TEMPLATE_ID = "fiber-letter";
export const AI_CHAT_SYSTEM_PREFIX = "你是笺间的 AI 问答助手。你可以阅读用户当前正在写的信笺内容，并围绕内容、结构、表达、事实一致性和写作策略回答问题。回答要具体、克制、可执行。";
export const CODEX_DOCUMENT_ONLY_SCOPE = Object.freeze({ mode: "document-only", relativePath: "" });
export const AI_FINALIZED_START = "【已定稿开始】";
export const AI_FINALIZED_END = "【已定稿结束】";
export const AI_FINALIZED_INSTRUCTION = `注意：正文中位于${AI_FINALIZED_START}和${AI_FINALIZED_END}之间的内容已经定稿，只作为背景上下文，不要改写这部分；请主要优化该符号之后的内容。`;

export const AI_CHAT_PROMPT_PRESETS = [
  { id: "review", label: "审阅全文", prompt: "请帮我审阅这篇信笺，指出主要优点、不足和可以优化的地方。" },
  { id: "rewrite-selection", label: "改写标记", prompt: "请改写我标记的这段文字，保持原意，但让表达更自然、更有力度。" },
  { id: "logic", label: "找逻辑漏洞", prompt: "请检查这篇信笺的逻辑链条，指出哪里论证薄弱、跳跃或证据不足。" },
  { id: "titles", label: "生成标题", prompt: "请根据这篇信笺生成 5 个标题，分别偏正式、文艺、犀利、简洁和社媒传播。" },
];
