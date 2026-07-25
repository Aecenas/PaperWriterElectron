import { useEffect } from "react";

export const MODAL_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';

function resolveFocusCandidate(candidate) {
  if (!candidate) return null;
  return Object.prototype.hasOwnProperty.call(candidate, "current")
    ? candidate.current
    : candidate;
}

function canReceiveFocus(candidate) {
  return Boolean(candidate && candidate.isConnected !== false && typeof candidate.focus === "function");
}

function topModalDialog(documentObject) {
  return [...(documentObject?.querySelectorAll?.(MODAL_DIALOG_SELECTOR) || [])].at(-1) || null;
}

export function isTopModalDialog(candidate, documentObject = globalThis.document) {
  return topModalDialog(documentObject) === resolveFocusCandidate(candidate);
}

export function modalDialogOpen(documentObject = globalThis.document) {
  return Boolean(documentObject?.querySelector?.(MODAL_DIALOG_SELECTOR));
}

export function isGlobalShortcutBlocked(event, documentObject = globalThis.document) {
  return Boolean(event?.defaultPrevented || modalDialogOpen(documentObject));
}

export function dialogFocusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll(
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

export function resolveDialogReturnFocus({
  documentObject = globalThis.document,
  preferred = null,
  previous = null,
} = {}) {
  const candidates = [
    resolveFocusCandidate(preferred),
    resolveFocusCandidate(previous),
    documentObject?.querySelector?.('[data-dialog-focus-fallback="true"]'),
    documentObject?.querySelector?.('.document-tab.active:not(:disabled)'),
    documentObject?.querySelector?.('.paper-title-input:not(:disabled)'),
  ];
  return candidates.find(canReceiveFocus) || null;
}

export function useModalFocusTrap(open, dialogRef, initialFocus = null, returnFocus = null) {
  useEffect(() => {
    if (!open) return undefined;
    const documentObject = globalThis.document;
    const windowObject = globalThis.window;
    const previouslyFocused = documentObject?.activeElement || null;
    const focusInitialElement = () => {
      const dialog = dialogRef.current;
      if (!dialog || !isTopModalDialog(dialog, documentObject)) return;
      if (dialog.contains(documentObject.activeElement)) return;
      const target = resolveFocusCandidate(initialFocus) || dialogFocusableElements(dialog)[0] || dialog;
      if (target === dialog && !dialog.hasAttribute("tabindex")) {
        dialog.setAttribute("tabindex", "-1");
      }
      target.focus?.({ preventScroll: true });
    };
    const frame = windowObject?.requestAnimationFrame?.(focusInitialElement);
    const handleKeyDown = (event) => {
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog || !isTopModalDialog(dialog, documentObject)) return;
      const elements = dialogFocusableElements(dialog);
      if (!elements.length) {
        event.preventDefault();
        dialog.focus?.({ preventScroll: true });
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && (documentObject.activeElement === first || !dialog.contains(documentObject.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (documentObject.activeElement === last || !dialog.contains(documentObject.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    documentObject?.addEventListener?.("keydown", handleKeyDown, true);
    return () => {
      if (frame !== undefined) windowObject?.cancelAnimationFrame?.(frame);
      documentObject?.removeEventListener?.("keydown", handleKeyDown, true);
      windowObject?.requestAnimationFrame?.(() => {
        const activeModal = topModalDialog(documentObject);
        if (activeModal?.contains(documentObject.activeElement)) return;
        resolveDialogReturnFocus({
          documentObject,
          preferred: returnFocus,
          previous: previouslyFocused,
        })?.focus({ preventScroll: true });
      });
    };
  }, [dialogRef, initialFocus, open, returnFocus]);
}
