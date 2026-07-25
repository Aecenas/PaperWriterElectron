import { useEffect } from "react";
import { bridge } from "../bridge.js";
import {
  estimateTokenCount,
  getAiUsageCachedTokens,
  getAiUsageTotalTokens,
} from "../ai/usage.js";

export const AI_ELAPSED_INTERVAL_MS = 100;

export function updateAiElapsedStates({
  now = Date.now(),
  registry,
  updateChatStateForKey,
  updateOptimizeStateForKey,
}) {
  registry.getElapsedContexts().forEach((context) => {
    if (!context.requestId || !context.startedAt) return;
    const elapsedSeconds = Math.max(0, (now - context.startedAt) / 1000);
    if (context.kind === "chat" && context.assistantId) {
      updateChatStateForKey(context.documentKey, (chat) => ({
        ...chat,
        messages: chat.messages.map((message) => (
          message.id === context.assistantId ? { ...message, elapsedSeconds } : message
        )),
      }));
      return;
    }
    if (context.kind === "optimize") {
      updateOptimizeStateForKey(context.documentKey, (optimize) => ({
        ...optimize,
        elapsedSeconds,
      }));
    }
  });
}

export function useAiElapsedLifecycle({
  aiMode,
  aiStatus,
  registry,
  updateChatStateForKey,
  updateOptimizeStateForKey,
}) {
  useEffect(() => {
    if (!aiMode || aiStatus !== "streaming" || !registry.hasActiveStartedAt()) {
      return undefined;
    }
    const updateElapsed = () => updateAiElapsedStates({
      registry,
      updateChatStateForKey,
      updateOptimizeStateForKey,
    });
    updateElapsed();
    const timer = window.setInterval(updateElapsed, AI_ELAPSED_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [aiMode, aiStatus, registry, updateChatStateForKey, updateOptimizeStateForKey]);
}

export function createAiStreamEventHandlers({
  now = Date.now,
  registry,
  showStatus,
  updateChatStateForKey,
  updateOptimizeStateForKey,
}) {
  const flushContext = (context) => {
    if (context.kind === "chat") {
      updateChatStateForKey(context.documentKey, (chat) => ({
        ...chat,
        messages: chat.messages.map((message) => (
          message.id === context.assistantId
            ? { ...message, content: context.outputBuffer || "", status: "streaming" }
            : message
        )),
      }));
      return;
    }
    updateOptimizeStateForKey(context.documentKey, (optimize) => ({
      ...optimize,
      output: context.outputBuffer || "",
    }));
  };

  const handleChunk = (payload) => (
    registry.enqueueChunk(payload?.requestId, payload?.delta, flushContext)
  );

  const handleDone = (payload) => {
    let terminalKind = "";
    const handled = registry.finishContext(payload?.requestId, (context) => {
      terminalKind = context.kind;
      const usage = payload.usage || {};
      const totalTokens = getAiUsageTotalTokens(usage);
      const cachedTokens = getAiUsageCachedTokens(usage);
      const elapsedSeconds = context.startedAt
        ? Math.max(0, (now() - context.startedAt) / 1000)
        : 0;
      if (context.kind === "chat") {
        updateChatStateForKey(context.documentKey, (chat) => ({
          ...chat,
          status: "idle",
          error: "",
          messages: chat.messages.map((message) => (
            message.id === context.assistantId
              ? {
                  ...message,
                  content: context.outputBuffer || message.content || "",
                  status: "done",
                  elapsedSeconds,
                  usage: totalTokens > 0
                    ? totalTokens
                    : (context.promptTokenEstimate || 0)
                      + estimateTokenCount(context.outputBuffer || message.content || ""),
                  usageEstimated: totalTokens <= 0,
                  cachedTokens,
                }
              : message
          )),
        }));
        return;
      }
      const output = context.outputBuffer || "";
      updateOptimizeStateForKey(context.documentKey, (optimize) => ({
        ...optimize,
        output,
        status: "done",
        error: "",
        elapsedSeconds,
        tokenStats: totalTokens > 0
          ? { totalTokens, estimated: false, cachedTokens }
          : {
              totalTokens: (context.promptTokenEstimate || 0) + estimateTokenCount(output),
              estimated: true,
              cachedTokens,
            },
      }));
    });
    if (!handled) return false;
    showStatus(
      terminalKind === "chat" ? "AI 已回复" : "AI 优化结果已生成",
      "success",
    );
    return true;
  };

  const handleError = (payload) => {
    let terminalKind = "";
    const message = payload?.message || "AI 生成失败";
    const handled = registry.finishContext(payload?.requestId, (context) => {
      terminalKind = context.kind;
      const elapsedSeconds = context.startedAt
        ? Math.max(0, (now() - context.startedAt) / 1000)
        : 0;
      if (context.kind === "chat") {
        updateChatStateForKey(context.documentKey, (chat) => ({
          ...chat,
          status: payload.aborted ? "idle" : "error",
          error: payload.aborted ? "" : message,
          messages: chat.messages.map((item) => (
            item.id === context.assistantId
              ? {
                  ...item,
                  content: context.outputBuffer || item.content || message,
                  elapsedSeconds,
                  status: payload.aborted ? "stopped" : "error",
                }
              : item
          )),
        }));
        return;
      }
      updateOptimizeStateForKey(context.documentKey, (optimize) => ({
        ...optimize,
        output: context.outputBuffer || optimize.output,
        status: payload.aborted ? "ready" : "error",
        error: payload.aborted ? "" : message,
        elapsedSeconds,
      }));
    });
    if (!handled) return false;
    showStatus(message, payload.aborted ? "success" : "warning");
    return terminalKind;
  };

  return {
    handleChunk,
    handleDone,
    handleError,
  };
}

export function subscribeAiStreamEvents({
  aiBridge = bridge,
  handlers,
  registry,
}) {
  const unsubscribeChunk = aiBridge.onAiChunk?.(handlers.handleChunk);
  const unsubscribeDone = aiBridge.onAiDone?.(handlers.handleDone);
  const unsubscribeError = aiBridge.onAiError?.(handlers.handleError);
  return () => {
    unsubscribeChunk?.();
    unsubscribeDone?.();
    unsubscribeError?.();
    registry.clearPendingTimers();
  };
}

export function useAiStreamEventsLifecycle({
  registry,
  showStatus,
  updateChatStateForKey,
  updateOptimizeStateForKey,
}) {
  useEffect(() => {
    const handlers = createAiStreamEventHandlers({
      registry,
      showStatus,
      updateChatStateForKey,
      updateOptimizeStateForKey,
    });
    return subscribeAiStreamEvents({
      handlers,
      registry,
    });
  }, [registry, showStatus, updateChatStateForKey, updateOptimizeStateForKey]);
}
