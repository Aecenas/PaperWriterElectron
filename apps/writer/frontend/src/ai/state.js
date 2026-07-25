import {
  boundedAiImageEntries,
  normalizeBoundedAiChatMessages,
  normalizeBoundedAiQuotes,
} from "../content-limits.js";
import { normalizeCodexImageMode, normalizeCodexScope } from "../codex-scope.js";
import { normalizeEmbedWidth, normalizeImageSource } from "../resource-safety.js";
import { CODEX_DOCUMENT_ONLY_SCOPE } from "./constants.js";
import { createAiChatSelectionId } from "./context.js";


export function createEmptyAiOptimizeState() {
  return {
    output: "",
    status: "ready",
    error: "",
    assets: { images: {}, quotes: [] },
    elapsedSeconds: 0,
    tokenStats: null,
    provider: "",
    modelId: "",
    modelName: "",
    updatedAt: "",
  };
}

export function createEmptyAiChatState() {
  return {
    messages: [],
    input: "",
    selectedTexts: [],
    codexScope: { ...CODEX_DOCUMENT_ONLY_SCOPE },
    codexImageMode: normalizeCodexImageMode(),
    status: "idle",
    error: "",
    updatedAt: "",
  };
}

export function normalizeAiOptimizeState(state = {}) {
  const status = ["ready", "streaming", "done", "error", "idle"].includes(state.status)
    ? state.status
    : "ready";
  const assets = state.assets && typeof state.assets === "object" ? state.assets : {};
  const images = Object.fromEntries(
    boundedAiImageEntries(assets.images)
      .map(([key, image], index) => [String(key).slice(0, 128), {
        number: Math.max(1, Math.floor(Number(image?.number) || index + 1)),
        caption: String(image?.caption || image?.alt || "图片").slice(0, 240),
        src: normalizeImageSource(image?.src),
        alt: typeof image?.alt === "string" ? image.alt.slice(0, 240) : "",
        width: normalizeEmbedWidth(image?.width),
      }]),
  );
  return {
    ...createEmptyAiOptimizeState(),
    ...state,
    output: typeof state.output === "string" ? state.output.slice(0, 8 * 1024 * 1024) : "",
    status,
    error: typeof state.error === "string" ? state.error.slice(0, 2000) : "",
    assets: {
      images,
      quotes: normalizeBoundedAiQuotes(assets.quotes),
    },
    elapsedSeconds: Number.isFinite(Number(state.elapsedSeconds)) ? Math.max(0, Number(state.elapsedSeconds)) : 0,
    tokenStats: state.tokenStats && typeof state.tokenStats === "object" ? state.tokenStats : null,
    provider: typeof state.provider === "string" ? state.provider : "",
    modelId: typeof state.modelId === "string" ? state.modelId : "",
    modelName: typeof state.modelName === "string" ? state.modelName : "",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

export function normalizeAiChatSelection(selection = {}) {
  return {
    id: typeof selection.id === "string" && selection.id ? selection.id.slice(0, 128) : createAiChatSelectionId(),
    text: typeof selection.text === "string" ? selection.text.slice(0, 20000) : "",
    from: Number.isFinite(Number(selection.from)) ? Number(selection.from) : 1,
    to: Number.isFinite(Number(selection.to)) ? Number(selection.to) : 1,
  };
}

export function normalizeAiChatState(state = {}) {
  // Parse legacy values so older documents remain loadable, then migrate them
  // to the only scope the isolated backend accepts.
  normalizeCodexScope(state.codexScope);
  return {
    ...createEmptyAiChatState(),
    ...state,
    messages: normalizeBoundedAiChatMessages(state.messages),
    input: typeof state.input === "string" ? state.input.slice(0, 200000) : "",
    selectedTexts: Array.isArray(state.selectedTexts) ? state.selectedTexts.slice(0, 100).map(normalizeAiChatSelection).filter((selection) => selection.text) : [],
    codexScope: { ...CODEX_DOCUMENT_ONLY_SCOPE },
    codexImageMode: normalizeCodexImageMode(state.codexImageMode),
    status: ["idle", "streaming", "error"].includes(state.status) ? state.status : "idle",
    error: typeof state.error === "string" ? state.error.slice(0, 2000) : "",
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : "",
  };
}

export function createEmptyAiState() {
  return {
    version: 3,
    lastMode: "",
    optimize: createEmptyAiOptimizeState(),
    chat: createEmptyAiChatState(),
  };
}

export function normalizeAiState(state = {}) {
  return {
    version: 3,
    lastMode: ["optimize", "chat"].includes(state.lastMode) ? state.lastMode : "",
    optimize: normalizeAiOptimizeState(state.optimize),
    chat: normalizeAiChatState(state.chat),
  };
}

export function mergeAiStatePatch(aiState, patchOrUpdater) {
  const previous = normalizeAiState(aiState);
  const patched = typeof patchOrUpdater === "function" ? patchOrUpdater(previous) : { ...previous, ...patchOrUpdater };
  return normalizeAiState(patched);
}
