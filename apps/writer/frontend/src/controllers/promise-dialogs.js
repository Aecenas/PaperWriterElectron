import { useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../bridge.js";

export function usePromiseDialogState() {
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [promptDialog, setPromptDialog] = useState(null);
  return {
    confirmDialog,
    setConfirmDialog,
    promptDialog,
    setPromptDialog,
  };
}

export function usePromiseDialogResolverRefs() {
  const confirmDialogResolverRef = useRef(null);
  const promptDialogResolverRef = useRef(null);
  return { confirmDialogResolverRef, promptDialogResolverRef };
}

export function createPromiseDialogActions({
  confirmDialogResolverRef,
  promptDialogResolverRef,
  setConfirmDialog,
  setPromptDialog,
  getActiveElement = () => globalThis.window?.document?.activeElement,
}) {
  const resolveConfirmDialog = (value) => {
    const resolver = confirmDialogResolverRef.current;
    confirmDialogResolverRef.current = null;
    setConfirmDialog(null);
    resolver?.(value);
  };

  const showConfirmDialog = (options) => new Promise((resolve) => {
    confirmDialogResolverRef.current?.(options.cancelValue || "cancel");
    confirmDialogResolverRef.current = resolve;
    setConfirmDialog({
      tone: "default",
      cancelValue: "cancel",
      actions: [],
      ...options,
      returnFocusElement: options?.returnFocusElement || getActiveElement(),
    });
  });

  const resolvePromptDialog = (value) => {
    const resolver = promptDialogResolverRef.current;
    promptDialogResolverRef.current = null;
    setPromptDialog(null);
    resolver?.(value);
  };

  const showPromptDialog = (options) => new Promise((resolve) => {
    promptDialogResolverRef.current?.(null);
    promptDialogResolverRef.current = resolve;
    setPromptDialog({
      defaultValue: "",
      confirmLabel: "确定",
      ...options,
      returnFocusElement: options?.returnFocusElement || getActiveElement(),
    });
  });

  return {
    resolveConfirmDialog,
    showConfirmDialog,
    resolvePromptDialog,
    showPromptDialog,
  };
}

export function usePromiseDialogActions({
  confirmDialogResolverRef,
  promptDialogResolverRef,
  setConfirmDialog,
  setPromptDialog,
}) {
  return useMemo(() => createPromiseDialogActions({
    confirmDialogResolverRef,
    promptDialogResolverRef,
    setConfirmDialog,
    setPromptDialog,
  }), [
    confirmDialogResolverRef,
    promptDialogResolverRef,
    setConfirmDialog,
    setPromptDialog,
  ]);
}

export function usePromiseDialogOverlayLifecycle(confirmDialog, promptDialog) {
  useEffect(() => {
    if (!confirmDialog && !promptDialog) {
      return undefined;
    }
    bridge.setWindowModalOverlay?.(false);
    return () => {
      bridge.setWindowModalOverlay?.(false);
    };
  }, [confirmDialog, promptDialog]);
}

export function cancelPendingPromiseDialogs(
  confirmDialogResolverRef,
  promptDialogResolverRef,
) {
  confirmDialogResolverRef.current?.("cancel");
  confirmDialogResolverRef.current = null;
  promptDialogResolverRef.current?.(null);
  promptDialogResolverRef.current = null;
}

export function usePromiseDialogUnmountLifecycle(
  confirmDialogResolverRef,
  promptDialogResolverRef,
) {
  useEffect(() => () => {
    cancelPendingPromiseDialogs(confirmDialogResolverRef, promptDialogResolverRef);
  }, []);
}
