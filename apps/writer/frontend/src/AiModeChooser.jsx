import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut, Settings } from "lucide-react";
import aiChatIdle from "./assets/ai-modes/ai-chat-card-idle-v3.png";
import aiChatSelected from "./assets/ai-modes/ai-chat-card-selected-v3.png";
import aiOptimizeIdle from "./assets/ai-modes/ai-optimize-card-idle-v3.png";
import aiOptimizeSelected from "./assets/ai-modes/ai-optimize-card-selected-v3.png";
import "./ai-mode-chooser.css";

const MODE_OPTIONS = [
  {
    id: "optimize",
    label: "AI优化",
    description: "润色、改写、提炼表达",
    idleImage: aiOptimizeIdle,
    selectedImage: aiOptimizeSelected,
  },
  {
    id: "chat",
    label: "AI问答",
    description: "快速解答、生成内容、辅助思考",
    idleImage: aiChatIdle,
    selectedImage: aiChatSelected,
  },
];

function focusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll(
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

export default function AiModeChooser({
  open,
  anchorRef,
  activeMode = "none",
  configured = false,
  onSelectMode,
  onExitMode,
  onOpenSettings,
  onClose,
}) {
  const panelRef = useRef(null);
  const settingsButtonRef = useRef(null);
  const modeButtonRefs = useRef([]);
  const [previewMode, setPreviewMode] = useState("");
  const [committingMode, setCommittingMode] = useState("");
  const focusPreferredControl = useCallback(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (open) {
      setPreviewMode("");
      setCommittingMode("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = window.document.activeElement;
    const frame = window.requestAnimationFrame(focusPreferredControl);
    return () => {
      window.cancelAnimationFrame(frame);
      const returnTarget = anchorRef?.current || previouslyFocused;
      if (returnTarget instanceof HTMLElement && returnTarget.isConnected) {
        returnTarget.focus({ preventScroll: true });
      }
    };
  }, [activeMode, anchorRef, focusPreferredControl, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleDocumentKeyDown = (event) => {
      const panel = panelRef.current;
      const anotherDialogIsOpen = [...window.document.querySelectorAll('[role="dialog"]')]
        .some((dialog) => dialog !== panel && !panel?.contains(dialog));
      if (anotherDialogIsOpen) return;
      if (committingMode && (event.key === "Escape" || event.key === "Tab")) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key === "Tab" && panel && !panel.contains(window.document.activeElement)) {
        event.preventDefault();
        focusPreferredControl();
      }
    };
    window.document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleDocumentKeyDown, true);
  }, [committingMode, focusPreferredControl, onClose, open]);

  if (!open) return null;

  const handleKeyDown = (event) => {
    if (committingMode) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key !== "Tab") return;
    const elements = focusableElements(panelRef.current);
    if (!elements.length) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && window.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && window.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleModeArrowKey = (event, currentIndex) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (currentIndex + direction + MODE_OPTIONS.length) % MODE_OPTIONS.length;
    modeButtonRefs.current[nextIndex]?.focus();
  };

  const handleSelectMode = async (modeId) => {
    if (committingMode) return;
    setPreviewMode(modeId);
    setCommittingMode(modeId);
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    const selected = await onSelectMode?.(modeId);
    if (selected === false) {
      setCommittingMode("");
      setPreviewMode("");
    }
  };

  const content = (
    <div
      className="ai-mode-chooser-layer dialog-scrim dialog-scrim--large"
      role="presentation"
      data-transitioning={committingMode ? "true" : "false"}
      onPointerDown={(event) => {
        if (committingMode) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!target.closest(".ai-mode-card, .ai-mode-exit-button, .ai-mode-settings-button")) onClose?.();
      }}
    >
      <section
        ref={panelRef}
        id="ai-mode-chooser-dialog"
        className={`ai-mode-chooser${committingMode ? " is-committing" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="选择 AI 模式"
        aria-busy={Boolean(committingMode)}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <div className="ai-mode-card-grid" role="group" aria-label="AI 模式">
          {MODE_OPTIONS.map((mode, index) => {
            const active = activeMode === mode.id;
            const visuallyActive = configured && (previewMode === mode.id || committingMode === mode.id);
            return (
              <button
                key={mode.id}
                ref={(node) => {
                  modeButtonRefs.current[index] = node;
                }}
                type="button"
                className={[
                  "ai-mode-card",
                  visuallyActive ? "visual-active" : "",
                  committingMode === mode.id ? "is-committing" : "",
                ].filter(Boolean).join(" ")}
                data-mode={mode.id}
                disabled={!configured}
                aria-pressed={active}
                aria-label={`${mode.label}${active ? "，当前正在使用" : ""}，${mode.description}`}
                onPointerEnter={() => setPreviewMode(mode.id)}
                onPointerLeave={(event) => {
                  if (window.document.activeElement !== event.currentTarget) setPreviewMode("");
                }}
                onFocus={() => setPreviewMode(mode.id)}
                onBlur={() => setPreviewMode("")}
                onKeyDown={(event) => handleModeArrowKey(event, index)}
                onClick={() => void handleSelectMode(mode.id)}
              >
                <span className="ai-mode-card-art" aria-hidden="true">
                  <img className="ai-mode-card-image idle" src={mode.idleImage} alt="" draggable="false" />
                  <img className="ai-mode-card-image selected" src={mode.selectedImage} alt="" draggable="false" />
                </span>
                <span className="ai-mode-card-copy" aria-hidden="true">
                  <strong className="ai-mode-card-title">{mode.label}</strong>
                  <small className="ai-mode-card-description">{mode.description}</small>
                </span>
              </button>
            );
          })}
        </div>
        {activeMode !== "none" ? (
          <button
            type="button"
            className="ai-mode-exit-button"
            onClick={onExitMode}
            aria-label="退出 AI 模式"
          >
            <span className="ai-mode-exit-icon" aria-hidden="true">
              <LogOut size={15} strokeWidth={1.9} />
            </span>
            <span>退出 AI 模式</span>
          </button>
        ) : null}
        {!configured ? (
          <div className="ai-mode-recovery">
            <button
              ref={settingsButtonRef}
              type="button"
              className="ai-mode-settings-button"
              onClick={onOpenSettings}
            >
              <Settings size={15} strokeWidth={1.9} aria-hidden="true" />
              <span>配置 AI</span>
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );

  return createPortal(content, window.document.body);
}
