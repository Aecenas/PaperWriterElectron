import { useMemo } from "react";
import {
  mergeAiStatePatch,
  normalizeAiChatState,
  normalizeAiOptimizeState,
} from "../ai/state.js";

export function createAiDocumentStateActions(documentPort) {
  const updateDocumentAiStateForKey = (documentKey, updater) => (
    documentPort.updateByRuntimeKey(documentKey, (document, updatedAt) => ({
      ...document,
      aiState: mergeAiStatePatch(document?.aiState, (previous) => {
        const next = typeof updater === "function"
          ? updater(previous, updatedAt)
          : { ...previous, ...updater };
        return {
          ...next,
          optimize: normalizeAiOptimizeState(next.optimize),
          chat: normalizeAiChatState(next.chat),
        };
      }),
    }))
  );

  const updateActiveDocumentAiState = (updater) => {
    updateDocumentAiStateForKey(documentPort.getActiveKey(), updater);
  };

  const updateOptimizeStateForKey = (documentKey, updater) => {
    updateDocumentAiStateForKey(documentKey, (previous, updatedAt) => {
      const previousOptimize = normalizeAiOptimizeState(previous.optimize);
      const nextOptimize = normalizeAiOptimizeState(
        typeof updater === "function"
          ? updater(previousOptimize, updatedAt)
          : { ...previousOptimize, ...updater },
      );
      return {
        ...previous,
        optimize: { ...nextOptimize, updatedAt },
      };
    });
  };

  const updateChatStateForKey = (documentKey, updater) => {
    updateDocumentAiStateForKey(documentKey, (previous, updatedAt) => {
      const previousChat = normalizeAiChatState(previous.chat);
      const nextChat = normalizeAiChatState(
        typeof updater === "function"
          ? updater(previousChat, updatedAt)
          : { ...previousChat, ...updater },
      );
      return {
        ...previous,
        chat: { ...nextChat, updatedAt },
      };
    });
  };

  const updateOptimizeState = (updater) => {
    updateOptimizeStateForKey(documentPort.getActiveKey(), updater);
  };

  const updateChatState = (updater) => {
    updateChatStateForKey(documentPort.getActiveKey(), updater);
  };

  const migrateAiRequestDocumentKey = (fromKey, toKey) => {
    documentPort.rekeyPersistedDocument(fromKey, toKey);
  };

  return {
    getActiveDocumentKey: documentPort.getActiveKey,
    getActiveDocumentSnapshot: documentPort.getActiveSnapshot,
    migrateAiRequestDocumentKey,
    updateActiveDocumentAiState,
    updateChatState,
    updateChatStateForKey,
    updateDocumentAiStateForKey,
    updateOptimizeState,
    updateOptimizeStateForKey,
  };
}

export function useAiDocumentStateActions(documentPort) {
  return useMemo(
    () => createAiDocumentStateActions(documentPort),
    [documentPort],
  );
}
