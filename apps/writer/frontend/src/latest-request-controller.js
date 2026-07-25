export function createLatestRequestController() {
  const currentRequests = new Map();
  let sequence = 0;

  const normalizeScope = (scope) => String(scope || "default");
  const invalidateEntry = (scope) => {
    const current = currentRequests.get(scope);
    current?.abortController?.abort();
    currentRequests.delete(scope);
  };

  return {
    begin(scope = "default") {
      const normalizedScope = normalizeScope(scope);
      invalidateEntry(normalizedScope);
      const abortController = typeof AbortController === "function" ? new AbortController() : null;
      const token = Object.freeze({
        scope: normalizedScope,
        id: ++sequence,
        signal: abortController?.signal,
      });
      currentRequests.set(normalizedScope, { id: token.id, abortController });
      return token;
    },

    isCurrent(token) {
      return Boolean(
        token
        && currentRequests.get(token.scope)?.id === token.id
        && !token.signal?.aborted,
      );
    },

    invalidate(scope = "default") {
      invalidateEntry(normalizeScope(scope));
    },

    invalidateAll() {
      for (const scope of [...currentRequests.keys()]) {
        invalidateEntry(scope);
      }
    },

    finish(token) {
      if (!token || currentRequests.get(token.scope)?.id !== token.id) return false;
      currentRequests.delete(token.scope);
      return true;
    },
  };
}
