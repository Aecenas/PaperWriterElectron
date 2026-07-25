import { useRef } from "react";

function defaultDeferCommit() {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

function normalizeTabId(tabId) {
  const normalized = String(tabId ?? "").trim();
  if (!normalized) {
    throw new TypeError("A non-empty tabId is required");
  }
  return normalized;
}

function normalizeLiveRevision(revision) {
  const normalized = Number(revision);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError("liveRevision must be a non-negative safe integer");
  }
  return normalized;
}

function normalizeNow(now) {
  const value = Number(now());
  if (!Number.isFinite(value)) {
    throw new TypeError("now() must return a finite timestamp");
  }
  return value;
}

export function createDocumentRuntimeKernel({
  deferCommit = defaultDeferCommit,
  now = Date.now,
} = {}) {
  if (typeof deferCommit !== "function") {
    throw new TypeError("deferCommit must be a function");
  }
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  const dirtyTabIds = new Set();
  const liveUpdatedAtByTab = new Map();
  const liveRevisionByTab = new Map();
  const diskRevisionByTab = new Map();
  const lastEditAtByTab = new Map();
  const liveEditorSourceByTab = new Map();
  const recoveryRevisionByTab = new Map();
  const saveQueueByTab = new Map();
  const runtimeEpochByTab = new Map();
  const revisionTokenMetadata = new WeakMap();
  let runtimeEpoch = 0;

  const ensureRuntimeEpoch = (tabId) => {
    if (!runtimeEpochByTab.has(tabId)) {
      runtimeEpoch += 1;
      runtimeEpochByTab.set(tabId, runtimeEpoch);
    }
    return runtimeEpochByTab.get(tabId);
  };

  const captureRevision = (tabId) => {
    const normalizedTabId = normalizeTabId(tabId);
    const token = Object.freeze({
      tabId: normalizedTabId,
      revision: liveRevisionByTab.get(normalizedTabId) || 0,
    });
    revisionTokenMetadata.set(token, {
      epoch: ensureRuntimeEpoch(normalizedTabId),
    });
    return token;
  };

  const readRuntimeState = (tabId) => {
    const normalizedTabId = normalizeTabId(tabId);
    return Object.freeze({
      tabId: normalizedTabId,
      dirty: dirtyTabIds.has(normalizedTabId),
      liveUpdatedAt: liveUpdatedAtByTab.get(normalizedTabId) ?? null,
      liveRevision: liveRevisionByTab.get(normalizedTabId) || 0,
      diskRevision: diskRevisionByTab.get(normalizedTabId) ?? null,
      lastEditAt: lastEditAtByTab.get(normalizedTabId) ?? null,
      editorSource: liveEditorSourceByTab.get(normalizedTabId) ?? null,
      recoveryRevision: recoveryRevisionByTab.get(normalizedTabId) ?? null,
      savePending: saveQueueByTab.has(normalizedTabId),
    });
  };

  const clearRuntimeState = (tabId) => {
    dirtyTabIds.delete(tabId);
    liveUpdatedAtByTab.delete(tabId);
    liveRevisionByTab.delete(tabId);
    diskRevisionByTab.delete(tabId);
    lastEditAtByTab.delete(tabId);
    liveEditorSourceByTab.delete(tabId);
    recoveryRevisionByTab.delete(tabId);
    saveQueueByTab.delete(tabId);
    runtimeEpochByTab.delete(tabId);
  };

  const revisionPort = Object.freeze({
    capture: captureRevision,

    isCurrent(token) {
      if (!token || typeof token !== "object") return false;
      const metadata = revisionTokenMetadata.get(token);
      if (!metadata) return false;
      return runtimeEpochByTab.get(token.tabId) === metadata.epoch
        && (liveRevisionByTab.get(token.tabId) || 0) === token.revision;
    },

    readLiveRevision(tabId) {
      return liveRevisionByTab.get(normalizeTabId(tabId)) || 0;
    },

    readDiskRevision(tabId) {
      return diskRevisionByTab.get(normalizeTabId(tabId)) ?? null;
    },

    readLiveUpdatedAt(tabId) {
      return liveUpdatedAtByTab.get(normalizeTabId(tabId)) ?? null;
    },

    commitLiveUpdatedAt(tabId, updatedAt) {
      const normalizedTabId = normalizeTabId(tabId);
      ensureRuntimeEpoch(normalizedTabId);
      if (updatedAt == null) {
        liveUpdatedAtByTab.delete(normalizedTabId);
        return null;
      }
      const normalizedUpdatedAt = String(updatedAt);
      liveUpdatedAtByTab.set(normalizedTabId, normalizedUpdatedAt);
      return normalizedUpdatedAt;
    },

    readLastEditAt(tabId) {
      return lastEditAtByTab.get(normalizeTabId(tabId)) ?? null;
    },

    commitDiskRevision(tabId, diskRevision) {
      const normalizedTabId = normalizeTabId(tabId);
      ensureRuntimeEpoch(normalizedTabId);
      if (diskRevision == null) {
        diskRevisionByTab.delete(normalizedTabId);
        return null;
      }
      diskRevisionByTab.set(normalizedTabId, diskRevision);
      return diskRevision;
    },

    recordMutation(tabId, options = {}) {
      const normalizedTabId = normalizeTabId(tabId);
      ensureRuntimeEpoch(normalizedTabId);
      const editedAt = normalizeNow(now);
      const updatedAt = String(options.updatedAt ?? new Date(editedAt).toISOString());
      const previousRevision = liveRevisionByTab.get(normalizedTabId) || 0;
      const nextRevision = previousRevision + 1;
      const becameDirty = !dirtyTabIds.has(normalizedTabId);
      const recoveryBecameStale = recoveryRevisionByTab.has(normalizedTabId);

      liveUpdatedAtByTab.set(normalizedTabId, updatedAt);
      liveRevisionByTab.set(normalizedTabId, nextRevision);
      lastEditAtByTab.set(normalizedTabId, editedAt);
      dirtyTabIds.add(normalizedTabId);
      recoveryRevisionByTab.delete(normalizedTabId);
      if (options.editorSource != null) {
        const editorSource = String(options.editorSource);
        if (editorSource) liveEditorSourceByTab.set(normalizedTabId, editorSource);
        else liveEditorSourceByTab.delete(normalizedTabId);
      }

      return Object.freeze({
        tabId: normalizedTabId,
        revision: nextRevision,
        updatedAt,
        lastEditAt: editedAt,
        becameDirty,
        recoveryBecameStale,
      });
    },
  });

  const dirtyPort = Object.freeze({
    isDirty(tabId) {
      return dirtyTabIds.has(normalizeTabId(tabId));
    },

    markDirty(tabId) {
      const normalizedTabId = normalizeTabId(tabId);
      ensureRuntimeEpoch(normalizedTabId);
      const becameDirty = !dirtyTabIds.has(normalizedTabId);
      dirtyTabIds.add(normalizedTabId);
      return becameDirty;
    },

    markClean(tabId) {
      return dirtyTabIds.delete(normalizeTabId(tabId));
    },

    readRecoveryRevision(tabId) {
      return recoveryRevisionByTab.get(normalizeTabId(tabId)) ?? null;
    },

    commitRecoveryRevision(tabId, revision) {
      const normalizedTabId = normalizeTabId(tabId);
      ensureRuntimeEpoch(normalizedTabId);
      if (revision == null) {
        recoveryRevisionByTab.delete(normalizedTabId);
        return null;
      }
      const normalizedRevision = normalizeLiveRevision(revision);
      recoveryRevisionByTab.set(normalizedTabId, normalizedRevision);
      return normalizedRevision;
    },
  });

  const saveQueuePort = Object.freeze({
    enqueue(tabId, operation) {
      const normalizedTabId = normalizeTabId(tabId);
      if (typeof operation !== "function") {
        throw new TypeError("operation must be a function");
      }
      ensureRuntimeEpoch(normalizedTabId);
      const previous = saveQueueByTab.get(normalizedTabId) || Promise.resolve();
      const queued = previous.catch(() => undefined).then(operation);
      const tracked = queued
        .then(() => undefined, () => undefined)
        .then(() => deferCommit(normalizedTabId))
        .then(() => undefined, () => undefined);

      saveQueueByTab.set(normalizedTabId, tracked);
      tracked.then(() => {
        if (saveQueueByTab.get(normalizedTabId) === tracked) {
          saveQueueByTab.delete(normalizedTabId);
        }
      });
      return queued;
    },

    hasPending(tabId) {
      return saveQueueByTab.has(normalizeTabId(tabId));
    },

    async wait(tabId) {
      const normalizedTabId = normalizeTabId(tabId);
      await (saveQueueByTab.get(normalizedTabId) || Promise.resolve());
    },

    async waitAll() {
      await Promise.all([...saveQueueByTab.values()]);
    },
  });

  const tabRuntimePort = Object.freeze({
    register(tabId, initialState = {}) {
      const normalizedTabId = normalizeTabId(tabId);
      if (saveQueueByTab.has(normalizedTabId)) {
        throw new Error(`Cannot register tab "${normalizedTabId}" while a save is pending`);
      }
      const liveRevision = normalizeLiveRevision(initialState.liveRevision ?? 0);
      const lastEditAt = initialState.lastEditAt == null
        ? null
        : Number(initialState.lastEditAt);
      if (lastEditAt != null && !Number.isFinite(lastEditAt)) {
        throw new TypeError("lastEditAt must be a finite timestamp");
      }
      const recoveryRevision = initialState.recoveryRevision == null
        ? null
        : normalizeLiveRevision(initialState.recoveryRevision);
      const diskRevision = initialState.diskRevision ?? null;
      const liveUpdatedAt = initialState.liveUpdatedAt == null
        ? null
        : String(initialState.liveUpdatedAt);
      const editorSource = initialState.editorSource == null
        ? null
        : String(initialState.editorSource);
      const initiallyDirty = Boolean(initialState.dirty);

      clearRuntimeState(normalizedTabId);
      runtimeEpoch += 1;
      runtimeEpochByTab.set(normalizedTabId, runtimeEpoch);

      if (liveRevision) liveRevisionByTab.set(normalizedTabId, liveRevision);
      if (diskRevision != null) {
        diskRevisionByTab.set(normalizedTabId, diskRevision);
      }
      if (liveUpdatedAt != null) {
        liveUpdatedAtByTab.set(normalizedTabId, liveUpdatedAt);
      }
      if (lastEditAt != null) {
        lastEditAtByTab.set(normalizedTabId, lastEditAt);
      }
      if (editorSource) {
        liveEditorSourceByTab.set(normalizedTabId, editorSource);
      }
      if (recoveryRevision != null) {
        recoveryRevisionByTab.set(normalizedTabId, recoveryRevision);
      }
      if (initiallyDirty) dirtyTabIds.add(normalizedTabId);
      return readRuntimeState(normalizedTabId);
    },

    has(tabId) {
      return runtimeEpochByTab.has(normalizeTabId(tabId));
    },

    ensure(tabId, initialState = {}) {
      const normalizedTabId = normalizeTabId(tabId);
      return runtimeEpochByTab.has(normalizedTabId)
        ? readRuntimeState(normalizedTabId)
        : tabRuntimePort.register(normalizedTabId, initialState);
    },

    syncReactMirror(tabId, mirroredState = {}) {
      const normalizedTabId = normalizeTabId(tabId);
      if (!runtimeEpochByTab.has(normalizedTabId)) {
        return tabRuntimePort.register(normalizedTabId, mirroredState);
      }
      // React state is committed asynchronously after editor mutations. Treat
      // an existing runtime as the freshness authority: a late clean/recovery
      // mirror must not undo the mutation ledger. Dirty is monotonic here;
      // explicit save/reload actions own the transition back to clean.
      if (mirroredState.dirty) {
        dirtyTabIds.add(normalizedTabId);
      }
      return readRuntimeState(normalizedTabId);
    },

    read: readRuntimeState,

    setEditorSource(tabId, editorSource) {
      const normalizedTabId = normalizeTabId(tabId);
      ensureRuntimeEpoch(normalizedTabId);
      if (editorSource == null || !String(editorSource)) {
        liveEditorSourceByTab.delete(normalizedTabId);
        return null;
      }
      const normalizedSource = String(editorSource);
      liveEditorSourceByTab.set(normalizedTabId, normalizedSource);
      return normalizedSource;
    },

    readEditorSource(tabId) {
      return liveEditorSourceByTab.get(normalizeTabId(tabId)) ?? null;
    },

    release(tabId) {
      const normalizedTabId = normalizeTabId(tabId);
      const existed = runtimeEpochByTab.has(normalizedTabId)
        || dirtyTabIds.has(normalizedTabId)
        || liveUpdatedAtByTab.has(normalizedTabId)
        || liveRevisionByTab.has(normalizedTabId)
        || diskRevisionByTab.has(normalizedTabId)
        || lastEditAtByTab.has(normalizedTabId)
        || liveEditorSourceByTab.has(normalizedTabId)
        || recoveryRevisionByTab.has(normalizedTabId)
        || saveQueueByTab.has(normalizedTabId);
      clearRuntimeState(normalizedTabId);
      return existed;
    },
  });

  return Object.freeze({
    dirtyPort,
    revisionPort,
    saveQueuePort,
    tabRuntimePort,
  });
}

export function useDocumentRuntimeKernel(options = {}) {
  const kernelRef = useRef(null);
  if (!kernelRef.current) {
    kernelRef.current = createDocumentRuntimeKernel(options);
  }
  return kernelRef.current;
}
