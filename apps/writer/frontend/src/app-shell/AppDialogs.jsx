import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  HelpCircle,
  Pencil,
  X,
} from "lucide-react";
import {
  isTopModalDialog,
  useModalFocusTrap,
} from "../ui-interactions.js";

export function AppConfirmDialog({ dialog, onResolve }) {
  const dialogRef = useRef(null);
  useModalFocusTrap(Boolean(dialog), dialogRef, null, dialog?.returnFocusElement);

  useEffect(() => {
    if (!dialog) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && isTopModalDialog(dialogRef)) {
        event.preventDefault();
        event.stopPropagation();
        onResolve(dialog.cancelValue);
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [dialog, onResolve]);

  if (!dialog) {
    return null;
  }

  const Icon = dialog.icon || HelpCircle;
  const content = (
    <div className="app-confirm-overlay dialog-scrim" role="presentation" onMouseDown={() => onResolve(dialog.cancelValue)}>
      <section
        ref={dialogRef}
        className={`app-confirm-dialog ${dialog.tone || "default"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="app-confirm-close" onClick={() => onResolve(dialog.cancelValue)} aria-label="关闭提示" title="关闭提示">
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true">
          <Icon size={24} />
        </div>
        <div className="app-confirm-copy">
          {dialog.eyebrow ? <span>{dialog.eyebrow}</span> : null}
          <h2 id="app-confirm-title">{dialog.title}</h2>
          {dialog.message ? <p className="app-confirm-message">{dialog.message}</p> : null}
          {dialog.detail ? <p className="app-confirm-detail">{dialog.detail}</p> : null}
        </div>
        <footer className="app-confirm-actions">
          {dialog.actions.map((action) => {
            const ActionIcon = action.icon;
            return (
              <button
                key={action.value}
                type="button"
                className={action.variant || "secondary"}
                onClick={() => onResolve(action.value)}
                autoFocus={Boolean(action.autoFocus)}
              >
                {ActionIcon ? <ActionIcon size={15} /> : null}
                <span>{action.label}</span>
              </button>
            );
          })}
        </footer>
      </section>
    </div>
  );

  return createPortal(content, window.document.body);
}

export function AppPromptDialog({ dialog, onResolve }) {
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  useModalFocusTrap(Boolean(dialog), dialogRef, inputRef, dialog?.returnFocusElement);

  useEffect(() => {
    if (!dialog) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && isTopModalDialog(dialogRef)) {
        event.preventDefault();
        event.stopPropagation();
        onResolve(null);
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [dialog, onResolve]);

  if (!dialog) {
    return null;
  }

  const Icon = dialog.icon || Pencil;
  const content = (
    <div className="app-confirm-overlay dialog-scrim" role="presentation" onMouseDown={() => onResolve(null)}>
      <form
        ref={dialogRef}
        className="app-confirm-dialog app-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-prompt-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onResolve(inputRef.current?.value || "");
        }}
      >
        <button type="button" className="app-confirm-close" onClick={() => onResolve(null)} aria-label="关闭提示" title="关闭提示">
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true">
          <Icon size={24} />
        </div>
        <div className="app-confirm-copy">
          {dialog.eyebrow ? <span>{dialog.eyebrow}</span> : null}
          <h2 id="app-prompt-title">{dialog.title}</h2>
          {dialog.message ? <p className="app-confirm-message">{dialog.message}</p> : null}
          <label className="app-prompt-field">
            <span>{dialog.label || "名称"}</span>
            <input
              ref={inputRef}
              type="text"
              defaultValue={dialog.defaultValue || ""}
              placeholder={dialog.placeholder || ""}
              maxLength={dialog.maxLength || 120}
            />
          </label>
        </div>
        <footer className="app-confirm-actions">
          <button type="button" className="ghost" onClick={() => onResolve(null)}>
            <span>取消</span>
          </button>
          <button type="submit" className="primary">
            <Check size={15} />
            <span>{dialog.confirmLabel || "确定"}</span>
          </button>
        </footer>
      </form>
    </div>
  );
  return createPortal(content, window.document.body);
}
