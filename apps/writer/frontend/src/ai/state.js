import {
  boundedAiImageEntries,
  normalizeBoundedAiChatMessages,
  normalizeBoundedAiQuotes,
} from "../content-limits.js";
import { normalizeCodexImageMode, normalizeCodexScope } from "../codex-scope.js";
import { normalizeEmbedWidth, normalizeImageSource } from "../resource-safety.js";
import { CODEX_DOCUMENT_ONLY_SCOPE } from "./constants.js";
import { createAiChatSelectionId } from "./context.js";
import { normalizeCollaborationProposal } from "../ai-collaboration/protocol.js";


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
    pendingReview: null,
    proposalSummaries: [],
  };
}

function normalizeProposalSummary(summary = {}) {
  const status = ["applied", "discarded", "stale"].includes(summary.status)
    ? summary.status
    : "discarded";
  return {
    id: typeof summary.id === "string" ? summary.id.slice(0, 128) : "",
    status,
    summary: typeof summary.summary === "string" ? summary.summary.slice(0, 2_000) : "",
    acceptedCount: Math.max(0, Math.floor(Number(summary.acceptedCount) || 0)),
    rejectedCount: Math.max(0, Math.floor(Number(summary.rejectedCount) || 0)),
    decisions: (Array.isArray(summary.decisions) ? summary.decisions : []).slice(0, 50).map((decision) => ({
      id: typeof decision?.id === "string" ? decision.id.slice(0, 128) : "",
      label: typeof decision?.label === "string" ? decision.label.slice(0, 240) : "",
      type: typeof decision?.type === "string" ? decision.type.slice(0, 40) : "",
      status: decision?.status === "accepted" ? "accepted" : "rejected",
      edited: Boolean(decision?.edited),
    })).filter((decision) => decision.id),
    resolvedAt: Number.isFinite(Number(summary.resolvedAt)) ? Number(summary.resolvedAt) : Date.now(),
  };
}

export function normalizeAiCollaborationPendingReview(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proposal = normalizeCollaborationProposal(value.proposal || value);
  if (!proposal.operations.length || !["pending", "stale"].includes(proposal.status)) return null;
  return {
    proposal,
    originDocumentKey: typeof value.originDocumentKey === "string" ? value.originDocumentKey.slice(0, 32768) : "",
    originTabId: typeof value.originTabId === "string" ? value.originTabId.slice(0, 128) : "",
    workspaceRoot: typeof value.workspaceRoot === "string" ? value.workspaceRoot.slice(0, 32768) : "",
    createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : proposal.createdAt,
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
    pendingReview: normalizeAiCollaborationPendingReview(state.pendingReview),
    proposalSummaries: (Array.isArray(state.proposalSummaries) ? state.proposalSummaries : [])
      .slice(-20)
      .map(normalizeProposalSummary)
      .filter((summary) => summary.id),
  };
}

export function createEmptyAiState() {
  return {
    version: 4,
    lastMode: "",
    optimize: createEmptyAiOptimizeState(),
    chat: createEmptyAiChatState(),
  };
}

export function normalizeAiState(state = {}) {
  return {
    version: 4,
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
