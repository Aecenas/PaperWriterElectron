import { useMemo, useRef } from "react";
import { documentRuntimeKey } from "./model.js";

function defaultUpdatedAt() {
  return new Date().toISOString();
}

export function createAiDocumentPort({
  activeIdentityRef,
  activeTabIdRef,
  currentPathRef,
  documentStateRef,
  getUpdatedAt = defaultUpdatedAt,
  onRuntimeKeyRekey = () => {},
  openTabsRef,
  recordTabMutation,
  setDocumentState,
  setOpenTabs,
}) {
  const getActiveIdentity = () => activeIdentityRef?.current || {
    activeTabId: activeTabIdRef.current,
    currentPath: currentPathRef.current,
  };

  const getActiveKey = () => {
    const identity = getActiveIdentity();
    return documentRuntimeKey(identity.currentPath, identity.activeTabId);
  };

  const getActiveSnapshot = () => {
    const identity = getActiveIdentity();
    const tab = openTabsRef.current.find((candidate) => candidate.id === identity.activeTabId);
    if (!tab) return null;
    const document = documentStateRef.current;
    return {
      document,
      documentKey: documentRuntimeKey(identity.currentPath, identity.activeTabId),
      readOnly: Boolean(tab.readOnly || document?._readOnlyFutureSchema),
      tabId: tab.id,
    };
  };

  const updateByRuntimeKey = (documentKey, updater) => {
    if (!documentKey) return false;
    const updatedAt = getUpdatedAt();
    const applyPatch = (document) => {
      const candidate = typeof updater === "function"
        ? updater(document, updatedAt)
        : { ...document, ...(updater || {}) };
      return {
        ...candidate,
        updatedAt,
      };
    };

    if (documentKey === getActiveKey()) {
      const activeSnapshot = getActiveSnapshot();
      if (!activeSnapshot || activeSnapshot.readOnly) return false;
      recordTabMutation(activeSnapshot.tabId, updatedAt);
      const nextDocument = applyPatch(activeSnapshot.document);
      documentStateRef.current = nextDocument;
      setDocumentState(nextDocument);
      return true;
    }

    const targetTab = openTabsRef.current.find(
      (tab) => documentRuntimeKey(tab.path, tab.id) === documentKey,
    );
    if (!targetTab || targetTab.readOnly || targetTab.document?._readOnlyFutureSchema) {
      return false;
    }
    recordTabMutation(targetTab.id, updatedAt);
    const nextTabs = openTabsRef.current.map((tab) => (
      tab.id === targetTab.id
        ? { ...tab, document: applyPatch(tab.document), dirty: true }
        : tab
    ));
    openTabsRef.current = nextTabs;
    setOpenTabs(nextTabs);
    return true;
  };

  const updateActive = (updater) => updateByRuntimeKey(getActiveKey(), updater);

  const rekeyPersistedDocument = (fromKey, toKey) => {
    if (!fromKey || !toKey || fromKey === toKey) return false;
    onRuntimeKeyRekey(fromKey, toKey);
    return true;
  };

  return {
    getActiveKey,
    getActiveSnapshot,
    rekeyPersistedDocument,
    updateActive,
    updateByRuntimeKey,
  };
}

export function useAiDocumentPort(options) {
  const activeIdentityRef = useRef({
    activeTabId: options.activeTabId,
    currentPath: options.currentPath,
  });
  activeIdentityRef.current = {
    activeTabId: options.activeTabId,
    currentPath: options.currentPath,
  };

  return useMemo(() => createAiDocumentPort({
    ...options,
    activeIdentityRef,
  }), [
    options.onRuntimeKeyRekey,
    options.recordTabMutation,
    options.setDocumentState,
    options.setOpenTabs,
  ]);
}
