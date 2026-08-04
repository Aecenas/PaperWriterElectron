import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, Languages, LoaderCircle, RotateCcw, SearchX, Square } from "lucide-react";

const MENU_WIDTH = 216;
const MENU_MARGIN = 8;

export function positionResearchTranslationMenu(event) {
  const viewportWidth = Math.max(MENU_WIDTH + MENU_MARGIN * 2, window.innerWidth || 0);
  const viewportHeight = Math.max(80, window.innerHeight || 0);
  const x = Number(event?.clientX) || 0;
  const y = Number(event?.clientY) || 0;
  return {
    x: Math.max(MENU_MARGIN, Math.min(x, viewportWidth - MENU_WIDTH - MENU_MARGIN)),
    y: Math.max(MENU_MARGIN, Math.min(y, viewportHeight - 72 - MENU_MARGIN)),
  };
}

export function keyboardResearchTranslationMenuPosition(element) {
  const rect = element?.getBoundingClientRect?.();
  return positionResearchTranslationMenu({
    clientX: rect ? rect.left + Math.min(32, rect.width / 2) : MENU_MARGIN,
    clientY: rect ? rect.top + Math.min(32, rect.height / 2) : MENU_MARGIN,
  });
}

export default function ResearchTranslationMenu({ menu, status, progress, hasText, pageMode, onStart, onCancel, onDismiss }) {
  const menuRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);
  useEffect(() => {
    if (!menu) return undefined;
    restoreFocusRef.current = null;
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && menuRef.current?.contains(event.target)) return;
      if (event.type === "keydown") restoreFocusRef.current = menu.returnFocus || null;
      onDismissRef.current?.();
    };
    const frame = window.requestAnimationFrame(() => menuRef.current?.querySelector("button:not(:disabled)")?.focus({ preventScroll: true }));
    window.document.addEventListener("pointerdown", close, true);
    window.document.addEventListener("keydown", close, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.document.removeEventListener("pointerdown", close, true);
      window.document.removeEventListener("keydown", close, true);
      const returnFocus = restoreFocusRef.current;
      if (returnFocus?.focus) window.requestAnimationFrame(() => returnFocus.focus({ preventScroll: true }));
    };
  }, [menu]);
  if (!menu || typeof document === "undefined") return null;
  const translating = status === "translating";
  const translated = status === "translated";
  const Icon = translating ? Square : translated ? RotateCcw : hasText ? Languages : SearchX;
  const label = translating
    ? "停止翻译"
    : translated
      ? "取消翻译"
      : hasText
        ? (pageMode ? "翻译当页" : "翻译当前内容")
        : (pageMode ? "本页无可翻译文字" : "当前内容无可翻译文字");
  const run = () => {
    restoreFocusRef.current = menu.returnFocus || null;
    onDismiss?.();
    if (translating || translated) onCancel?.();
    else onStart?.();
  };
  return createPortal((
    <div
      ref={menuRef}
      className="research-translation-menu"
      role="menu"
      aria-label={pageMode ? "PDF 当前页翻译操作" : "资料翻译操作"}
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" role="menuitem" disabled={!hasText && !translating && !translated} onClick={run}>
        {translating ? <LoaderCircle className="research-spin" size={15} aria-hidden="true" /> : <Icon size={15} aria-hidden="true" />}
        <span>{label}{translating && progress ? <small>{progress}</small> : null}</span>
      </button>
    </div>
  ), document.body);
}

export function ResearchTranslationFeedback({ translation, onRetry, onOpenSettings }) {
  if (translation.status === "translating") {
    return (
      <div className="research-translation-feedback" role="status" aria-live="polite">
        <LoaderCircle className="research-spin" size={13} aria-hidden="true" />
        <span>{translation.progress || "正在翻译…"}</span>
        <button type="button" onClick={translation.cancelOrRestore}>停止</button>
      </div>
    );
  }
  if (translation.status === "translated" && translation.cacheHit) {
    return (
      <div className="research-translation-feedback is-cached" role="status" aria-live="polite">
        <CircleCheck size={13} aria-hidden="true" />
        <span>已从本次运行的缓存恢复译文</span>
        <button type="button" onClick={translation.cancelOrRestore}>取消翻译</button>
      </div>
    );
  }
  if (translation.status !== "error" || !translation.error) return null;
  return (
    <div className="research-translation-feedback is-error" role="alert">
      <span>{translation.error}</span>
      {translation.needsModelSettings && onOpenSettings ? <button type="button" onClick={onOpenSettings}>打开任务模型</button> : null}
      {!translation.needsModelSettings && translation.hasText ? <button type="button" onClick={onRetry}>重试</button> : null}
    </div>
  );
}
