import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "../bridge.js";

export const RESEARCH_SEARCH_DEBOUNCE_MS = 180;
export const RESEARCH_SEARCH_PROGRESS_DELAY_MS = 300;

export function createEmptyResearchSearchState() {
  return {
    loading: false,
    results: [],
    error: "",
    requestId: "",
    progress: null,
    showProgress: false,
    warnings: [],
  };
}

export function createResearchSearchRequestId(now = Date.now, random = Math.random) {
  return `research-search-${now().toString(36)}-${random().toString(36).slice(2, 10)}`;
}

export function researchSearchProgressMatches(progress, libraryId, requestId) {
  return Boolean(
    progress
    && String(progress.libraryId || "") === String(libraryId || "")
    && String(progress.requestId || "") === String(requestId || ""),
  );
}

export function useResearchSearch({
  active = false,
  libraryId = "",
  workspaceScopeKey = "global",
  researchBridge = bridge,
} = {}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState(createEmptyResearchSearchState);
  const requestRef = useRef("");
  const libraryRef = useRef("");

  useEffect(() => {
    if (!active || !libraryId) return undefined;
    const unsubscribe = researchBridge.onResearchSearchProgress?.((progress = {}) => {
      if (!researchSearchProgressMatches(progress, libraryRef.current, requestRef.current)) return;
      setState((current) => {
        if (current.requestId !== requestRef.current) return current;
        return { ...current, progress };
      });
    });
    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [active, libraryId, researchBridge]);

  useEffect(() => {
    if (!active || !libraryId) {
      const previousRequestId = requestRef.current;
      const previousLibraryId = libraryRef.current;
      requestRef.current = "";
      libraryRef.current = "";
      if (previousRequestId && previousLibraryId) {
        researchBridge.cancelResearchSearch?.(previousLibraryId, previousRequestId)?.catch?.(() => {});
      }
      setState(createEmptyResearchSearchState());
      return undefined;
    }

    const normalizedQuery = query.trim();
    const previousRequestId = requestRef.current;
    const previousLibraryId = libraryRef.current;
    if (previousRequestId && previousLibraryId) {
      researchBridge.cancelResearchSearch?.(previousLibraryId, previousRequestId)?.catch?.(() => {});
    }
    if (!normalizedQuery) {
      requestRef.current = "";
      libraryRef.current = libraryId;
      setState(createEmptyResearchSearchState());
      return undefined;
    }

    const requestId = createResearchSearchRequestId();
    requestRef.current = requestId;
    libraryRef.current = libraryId;
    setState({
      loading: true,
      results: [],
      error: "",
      requestId,
      progress: null,
      showProgress: false,
      warnings: [],
    });

    const progressTimer = window.setTimeout(() => {
      setState((current) => (
        current.requestId === requestId && current.loading
          ? { ...current, showProgress: true }
          : current
      ));
    }, RESEARCH_SEARCH_PROGRESS_DELAY_MS);

    const searchTimer = window.setTimeout(async () => {
      try {
        const result = await researchBridge.searchResearch?.({
          libraryId,
          requestId,
          query: normalizedQuery,
          workspaceScopeKey,
          limit: 200,
        });
        if (requestRef.current !== requestId || result?.canceled) return;
        setState({
          loading: false,
          results: Array.isArray(result?.results) ? result.results : [],
          error: "",
          requestId,
          progress: result?.progress || null,
          showProgress: false,
          warnings: Array.isArray(result?.warnings) ? result.warnings : [],
        });
      } catch (error) {
        if (requestRef.current !== requestId) return;
        setState({
          loading: false,
          results: [],
          error: error?.message || "资料搜索失败",
          requestId,
          progress: null,
          showProgress: false,
          warnings: [],
        });
      }
    }, RESEARCH_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(progressTimer);
      window.clearTimeout(searchTimer);
      researchBridge.cancelResearchSearch?.(libraryId, requestId)?.catch?.(() => {});
    };
  }, [active, libraryId, query, researchBridge, workspaceScopeKey]);

  const reset = useCallback(() => {
    setQuery("");
    setState(createEmptyResearchSearchState());
  }, []);

  const cancel = useCallback(() => {
    const requestId = requestRef.current;
    const currentLibraryId = libraryRef.current;
    requestRef.current = "";
    if (requestId && currentLibraryId) {
      researchBridge.cancelResearchSearch?.(currentLibraryId, requestId)?.catch?.(() => {});
    }
    setState((current) => ({
      ...current,
      loading: false,
      requestId: "",
      progress: null,
      showProgress: false,
    }));
  }, [researchBridge]);

  return {
    ...state,
    query,
    setQuery,
    reset,
    cancel,
  };
}
