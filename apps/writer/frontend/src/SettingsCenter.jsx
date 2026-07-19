import { useEffect, useRef } from "react";
import { ArrowRight, Palette, Settings, Sparkles, X } from "lucide-react";

const SETTINGS_DESTINATIONS = [
  {
    id: "ai",
    label: "AI 配置",
    description: "管理供应商、模型与连接参数",
    icon: Sparkles,
  },
  {
    id: "template",
    label: "模板配置",
    description: "管理模板、分组与默认排版",
    icon: Palette,
  },
];

function focusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll(
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}

export default function SettingsCenter({
  open,
  anchorRef,
  onSelectSection,
  onClose,
}) {
  const dialogRef = useRef(null);
  const firstDestinationRef = useRef(null);
  const previouslyFocusedRef = useRef(null);
  const destinationSelectedRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;

    destinationSelectedRef.current = false;
    previouslyFocusedRef.current = window.document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      firstDestinationRef.current?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (!destinationSelectedRef.current) {
        const focusTarget = anchorRef?.current || previouslyFocusedRef.current;
        if (focusTarget instanceof HTMLElement && focusTarget.isConnected) {
          focusTarget.focus({ preventScroll: true });
        }
      }
    };
  }, [anchorRef, open]);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
        return;
      }

      if (event.key !== "Tab") return;
      const elements = focusableElements(dialogRef.current);
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

    window.document.addEventListener("keydown", handleKeyDown);
    return () => window.document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="settings-center-overlay dialog-scrim"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        ref={dialogRef}
        className="settings-center-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-center-title"
        aria-describedby="settings-center-description"
      >
        <header className="settings-center-heading">
          <span className="settings-center-heading-icon" aria-hidden="true">
            <Settings size={22} strokeWidth={1.9} />
          </span>
          <div>
            <h2 id="settings-center-title">设置</h2>
            <p id="settings-center-description">选择要配置的功能</p>
          </div>
        </header>

        <div className="settings-center-destinations" aria-label="设置功能">
          {SETTINGS_DESTINATIONS.map((destination, index) => {
            const Icon = destination.icon;
            return (
              <button
                key={destination.id}
                ref={index === 0 ? firstDestinationRef : undefined}
                type="button"
                className={`settings-center-destination settings-center-destination-${destination.id}`}
                onClick={() => {
                  destinationSelectedRef.current = true;
                  onSelectSection?.(destination.id);
                }}
                aria-describedby={`settings-center-${destination.id}-description`}
              >
                <span className="settings-center-destination-icon" aria-hidden="true">
                  <Icon size={32} strokeWidth={1.75} />
                </span>
                <span className="settings-center-destination-copy">
                  <strong>{destination.label}</strong>
                  <small id={`settings-center-${destination.id}-description`}>
                    {destination.description}
                  </small>
                </span>
                <span className="settings-center-destination-arrow" aria-hidden="true">
                  <ArrowRight size={19} strokeWidth={1.9} />
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="settings-center-close"
          onClick={onClose}
          aria-label="关闭设置"
          title="关闭设置"
        >
          <X size={20} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </section>
    </div>
  );
}
