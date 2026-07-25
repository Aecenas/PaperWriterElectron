import { useRef } from "react";

export const AI_STREAM_FLUSH_INTERVAL_MS = 50;

function emptyChatContext() {
  return {
    signature: "",
    context: "",
    images: [],
  };
}

function contextSnapshot(context) {
  return {
    assistantId: context.assistantId,
    documentKey: context.documentKey,
    kind: context.kind,
    outputBuffer: context.outputBuffer || "",
    promptTokenEstimate: context.promptTokenEstimate || 0,
    requestId: context.requestId,
    startedAt: context.startedAt || 0,
  };
}

export function createAiStreamRegistry({
  timerHost = globalThis,
} = {}) {
  const contexts = new Map();
  let active = {
    assistantId: "",
    kind: "",
    promptTokenEstimate: 0,
    requestId: "",
    startedAt: 0,
  };
  let chatContext = emptyChatContext();
  let readChatMessages = () => [];

  const materializeOutput = (context) => {
    if (!context?.pendingChunks?.length) return context?.outputBuffer || "";
    context.outputBuffer = `${context.outputBuffer || ""}${context.pendingChunks.join("")}`;
    context.pendingChunks.length = 0;
    return context.outputBuffer;
  };

  const clearPendingFlush = (context) => {
    if (!context?.flushId) return;
    timerHost.clearTimeout(context.flushId);
    context.flushId = 0;
  };

  const startRequest = ({
    assistantId = "",
    documentKey,
    kind,
    promptTokenEstimate = 0,
    requestId,
    startedAt,
  }) => {
    if (!requestId || !documentKey || (kind !== "chat" && kind !== "optimize")) {
      return false;
    }
    const context = {
      assistantId: kind === "chat" ? assistantId : "",
      documentKey,
      flushId: 0,
      kind,
      outputBuffer: "",
      pendingChunks: [],
      promptTokenEstimate,
      requestId,
      startedAt,
    };
    contexts.set(requestId, context);
    active = {
      assistantId: context.assistantId,
      kind,
      promptTokenEstimate,
      requestId,
      startedAt,
    };
    return true;
  };

  const getActiveId = () => active.requestId;
  const hasActiveStartedAt = () => Boolean(active.startedAt);
  const hasContext = (requestId) => contexts.has(requestId);

  const cancelActive = (cancelRequest) => {
    const requestId = active.requestId;
    if (requestId) cancelRequest?.(requestId);
    return requestId;
  };

  const clearActive = () => {
    active = {
      assistantId: "",
      kind: "",
      promptTokenEstimate: 0,
      requestId: "",
      startedAt: 0,
    };
  };

  const clearActiveAfterTerminal = (requestId) => {
    if (!requestId || active.requestId !== requestId) return false;
    active = {
      ...active,
      assistantId: "",
      kind: "",
      requestId: "",
      startedAt: 0,
    };
    return true;
  };

  const retireStartFailure = (requestId) => {
    const context = contexts.get(requestId);
    if (!context) return false;
    clearPendingFlush(context);
    contexts.delete(requestId);
    if (context.kind === "chat" && active.requestId === requestId) {
      active = {
        ...active,
        assistantId: "",
        kind: "",
        requestId: "",
      };
    }
    return true;
  };

  const rekeyDocument = (fromKey, toKey) => {
    if (!fromKey || !toKey || fromKey === toKey) return false;
    contexts.forEach((context) => {
      if (context.documentKey === fromKey) context.documentKey = toKey;
    });
    return true;
  };

  const enqueueChunk = (requestId, delta, onFlush) => {
    const context = contexts.get(requestId);
    if (!context) return false;
    if (delta) context.pendingChunks.push(delta);
    if (!context.flushId) {
      context.flushId = timerHost.setTimeout(() => {
        context.flushId = 0;
        materializeOutput(context);
        onFlush?.(contextSnapshot(context));
      }, AI_STREAM_FLUSH_INTERVAL_MS);
    }
    return true;
  };

  const finishContext = (requestId, consume) => {
    const context = contexts.get(requestId);
    if (!context) return false;
    clearPendingFlush(context);
    materializeOutput(context);
    try {
      consume?.(contextSnapshot(context));
    } finally {
      contexts.delete(requestId);
      clearActiveAfterTerminal(requestId);
    }
    return true;
  };

  const getElapsedContexts = () => (
    [...contexts.values()].map(contextSnapshot)
  );

  const clearPendingTimers = () => {
    contexts.forEach(clearPendingFlush);
  };

  const resetChatContext = () => {
    chatContext = emptyChatContext();
  };

  const resolveChatContext = (signature, buildContext) => {
    if (signature !== chatContext.signature) {
      chatContext = buildContext();
    }
    return {
      ...chatContext,
      images: [...(chatContext.images || [])],
    };
  };

  const setChatMessagesReader = (reader) => {
    readChatMessages = typeof reader === "function" ? reader : () => [];
  };

  const getChatMessages = () => {
    const messages = readChatMessages();
    return Array.isArray(messages) ? messages : [];
  };

  return {
    cancelActive,
    clearActive,
    clearPendingTimers,
    enqueueChunk,
    finishContext,
    getActiveId,
    getChatMessages,
    getElapsedContexts,
    hasActiveStartedAt,
    hasContext,
    rekeyDocument,
    resetChatContext,
    resolveChatContext,
    retireStartFailure,
    setChatMessagesReader,
    startRequest,
  };
}

export function useAiStreamRegistry() {
  const registryRef = useRef(null);
  if (!registryRef.current) {
    registryRef.current = createAiStreamRegistry({ timerHost: window });
  }
  return registryRef.current;
}

export function useAiStreamChatMessagesSlot(registry) {
  const chatMessagesRef = useRef([]);
  registry.setChatMessagesReader(() => chatMessagesRef.current);
  return (messages) => {
    chatMessagesRef.current = messages;
  };
}
