import { bridge } from "../bridge.js";
import { aiBlockHtml, aiBlockPlainText } from "./markdown.js";


export function estimateTokenCount(text) {
  const value = String(text || "");
  const chineseChars = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const latinWords = (value.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  const symbols = Math.max(0, value.length - chineseChars);
  return Math.max(1, Math.round(chineseChars * 1.15 + latinWords * 1.25 + symbols / 4));
}

export function formatTokenCount(value) {
  const tokens = Number(value) || 0;
  const unit = tokens >= 1_000_000 ? "M" : "K";
  const divisor = unit === "M" ? 1_000_000 : 1_000;
  const amount = tokens / divisor;
  return `${amount.toFixed(3).replace(/\.?0+$/, "")}${unit}`;
}

export function getAiUsageTotalTokens(usage) {
  if (!usage || typeof usage !== "object") {
    return 0;
  }
  return Number(usage.total_tokens || usage.totalTokens || 0);
}

export function getAiUsageCachedTokens(usage) {
  if (!usage || typeof usage !== "object") {
    return 0;
  }
  const promptDetails = usage.prompt_tokens_details || usage.promptTokensDetails || usage.input_tokens_details || usage.inputTokensDetails || {};
  const promptTokenDetails = usage.prompt_token_details || usage.promptTokenDetails || usage.input_token_details || usage.inputTokenDetails || {};
  const usageMetadata = usage.usage_metadata || usage.usageMetadata || {};
  const candidates = [
    usage.cached_tokens,
    usage.cachedTokens,
    usage.cached_content_token_count,
    usage.cachedContentTokenCount,
    usage.cache_read_input_tokens,
    usage.cacheReadInputTokens,
    promptDetails.cached_tokens,
    promptDetails.cachedTokens,
    promptDetails.cached_content_token_count,
    promptDetails.cachedContentTokenCount,
    promptDetails.cache_read_input_tokens,
    promptDetails.cacheReadInputTokens,
    promptTokenDetails.cached_tokens,
    promptTokenDetails.cachedTokens,
    promptTokenDetails.cached_content_token_count,
    promptTokenDetails.cachedContentTokenCount,
    promptTokenDetails.cache_read_input_tokens,
    promptTokenDetails.cacheReadInputTokens,
    usageMetadata.cached_tokens,
    usageMetadata.cachedTokens,
    usageMetadata.cached_content_token_count,
    usageMetadata.cachedContentTokenCount,
  ];
  return candidates.reduce((max, value) => Math.max(max, Number(value) || 0), 0);
}

export function formatTokenUsage(totalTokens, estimated = false, cachedTokens = 0) {
  const totalLabel = totalTokens ? `${estimated ? "约 " : ""}${formatTokenCount(totalTokens)}` : "等待统计";
  const cachedLabel = cachedTokens > 0 ? `（缓存：${formatTokenCount(cachedTokens)}）` : "";
  return `${totalLabel}${cachedLabel}`;
}

export function formatElapsedSeconds(value) {
  const seconds = Math.max(0, Number(value) || 0);
  return `${seconds.toFixed(1)} s`;
}

export async function copyAiBlockToClipboard(block) {
  const html = aiBlockHtml(block);
  const text = aiBlockPlainText(block);
  const result = await bridge.writeClipboardContent?.({ html, text });
  if (!result?.ok) throw new Error(result?.message || "复制失败");
}

export function chatMessagesToMarkdown(document, messages) {
  const title = document?.title || "未命名信笺";
  const lines = [
    `# ${title} - AI协作`,
    "",
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    "",
  ];
  messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .forEach((message) => {
      lines.push(`## ${message.role === "user" ? "我" : "AI"}`);
      lines.push("");
      lines.push((message.content || "").trim() || "（空）");
      lines.push("");
    });
  return `${lines.join("\n").trimEnd()}\n`;
}
