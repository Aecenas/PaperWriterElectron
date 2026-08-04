import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../bridge.js";
import {
  RESEARCH_TRANSLATION_MAX_CHARACTERS,
  RESEARCH_TRANSLATION_TARGET_LANGUAGE,
  translationCharacterCount,
  translationMap,
} from "./research-translation-model.js";
import {
  readResearchTranslationCache,
  writeResearchTranslationCache,
} from "./research-translation-cache.js";

function translationRequestId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `ai-research-translation-${suffix}`;
}

export function useResearchTranslation({
  kind,
  page = 0,
  blocks = [],
  resetKey = "",
  onBeforeStart,
  bridgeApi = bridge,
}) {
  const requestRef = useRef("");
  const runRef = useRef(0);
  const blocksRef = useRef(blocks);
  const [state, setState] = useState({
    status: "idle",
    translations: new Map(),
    error: "",
    errorCode: "",
    progress: "",
    completedBatches: 0,
    totalBatches: 0,
    cacheHit: false,
  });
  blocksRef.current = blocks;

  const reset = useCallback(({ cancel = true } = {}) => {
    runRef.current += 1;
    const requestId = requestRef.current;
    requestRef.current = "";
    if (cancel && requestId) void bridgeApi.cancelResearchTranslation?.(requestId);
    setState({
      status: "idle",
      translations: new Map(),
      error: "",
      errorCode: "",
      progress: "",
      completedBatches: 0,
      totalBatches: 0,
      cacheHit: false,
    });
  }, [bridgeApi]);

  useEffect(() => {
    reset();
    return () => {
      runRef.current += 1;
      const requestId = requestRef.current;
      requestRef.current = "";
      if (requestId) void bridgeApi.cancelResearchTranslation?.(requestId);
    };
  }, [reset, resetKey]);

  useEffect(() => bridgeApi.onResearchTranslationProgress?.((progress) => {
    if (!progress || progress.requestId !== requestRef.current) return;
    setState((current) => current.status !== "translating" ? current : {
      ...current,
      progress: String(progress.message || "正在翻译…"),
      completedBatches: Math.max(0, Number(progress.completedBatches) || 0),
      totalBatches: Math.max(0, Number(progress.totalBatches) || 0),
    });
  }), [bridgeApi]);

  const start = useCallback(async () => {
    if (requestRef.current) {
      return { ok: false, code: "AI_RESEARCH_TRANSLATION_REQUEST_DUPLICATE", message: "资料翻译正在进行" };
    }
    const currentBlocks = blocksRef.current;
    if (!currentBlocks.length) {
      setState((current) => ({ ...current, status: "error", error: kind === "pdf" ? "本页没有可翻译文字；扫描件需要先经过 OCR" : "当前内容没有可翻译文字", errorCode: "AI_RESEARCH_TRANSLATION_NO_TEXT", cacheHit: false }));
      return { ok: false, code: "AI_RESEARCH_TRANSLATION_NO_TEXT" };
    }
    if (translationCharacterCount(currentBlocks) > RESEARCH_TRANSLATION_MAX_CHARACTERS) {
      setState((current) => ({ ...current, status: "error", error: "当前资料超过 20 万字符，未发送给 AI", errorCode: "AI_RESEARCH_TRANSLATION_TOO_LARGE", cacheHit: false }));
      return { ok: false, code: "AI_RESEARCH_TRANSLATION_TOO_LARGE" };
    }
    onBeforeStart?.();
    const cacheInput = {
      kind,
      page,
      targetLanguage: RESEARCH_TRANSLATION_TARGET_LANGUAGE,
      blocks: currentBlocks,
    };
    const cachedTranslations = readResearchTranslationCache(cacheInput);
    if (cachedTranslations) {
      runRef.current += 1;
      setState({ status: "translated", translations: cachedTranslations, error: "", errorCode: "", progress: "", completedBatches: 0, totalBatches: 0, cacheHit: true });
      return {
        ok: true,
        cached: true,
        requestId: "",
        translations: [...cachedTranslations].map(([id, text]) => ({ id, text })),
      };
    }
    const run = runRef.current + 1;
    runRef.current = run;
    const requestId = translationRequestId();
    requestRef.current = requestId;
    setState({ status: "translating", translations: new Map(), error: "", errorCode: "", progress: "正在准备翻译…", completedBatches: 0, totalBatches: 0, cacheHit: false });
    try {
      const result = await bridgeApi.translateResearchContent?.({
        requestId,
        kind,
        ...(kind === "pdf" ? { page } : {}),
        targetLanguage: RESEARCH_TRANSLATION_TARGET_LANGUAGE,
        blocks: currentBlocks.map(({ id, text }) => ({ id, text })),
      });
      if (runRef.current !== run || requestRef.current !== requestId) return result;
      requestRef.current = "";
      if (!result?.ok) {
        if (result?.canceled) {
          reset({ cancel: false });
          return result;
        }
        setState({ status: "error", translations: new Map(), error: result?.message || "资料翻译失败", errorCode: result?.code || "AI_RESEARCH_TRANSLATION_FAILED", progress: "", completedBatches: 0, totalBatches: 0, cacheHit: false });
        return result;
      }
      const translations = translationMap(result.translations);
      writeResearchTranslationCache(cacheInput, translations);
      setState({ status: "translated", translations, error: "", errorCode: "", progress: "", completedBatches: 0, totalBatches: 0, cacheHit: false });
      return result;
    } catch (error) {
      if (runRef.current !== run || requestRef.current !== requestId) return { ok: false, canceled: true };
      requestRef.current = "";
      setState({ status: "error", translations: new Map(), error: error?.message || "资料翻译失败", errorCode: error?.code || "AI_RESEARCH_TRANSLATION_FAILED", progress: "", completedBatches: 0, totalBatches: 0, cacheHit: false });
      return { ok: false, code: error?.code, message: error?.message };
    }
  }, [kind, onBeforeStart, page, reset, bridgeApi]);

  const cancelOrRestore = useCallback(() => reset(), [reset]);
  const needsModelSettings = [
    "AI_RESEARCH_TRANSLATION_MODEL_INVALID",
    "AI_DEFAULT_MODEL_UNAVAILABLE",
  ].includes(state.errorCode);

  return {
    ...state,
    hasText: blocks.length > 0,
    needsModelSettings,
    start,
    cancelOrRestore,
    reset,
  };
}
