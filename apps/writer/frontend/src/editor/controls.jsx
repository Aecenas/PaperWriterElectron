import { useEffect, useState } from "react";
import { Check, ChevronDown, Underline } from "lucide-react";
import { UNDERLINE_STYLE_OPTIONS, normalizeUnderlineStyle } from "./formatting.js";

export function IconButton({ icon: Icon, label, active, disabled = false, onClick }) {
  const isToggle = typeof active === "boolean";
  return (
    <button
      type="button"
      className={active ? "icon-button active" : "icon-button"}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={isToggle ? Boolean(active) : undefined}
    >
      <Icon size={17} strokeWidth={2.1} aria-hidden="true" />
    </button>
  );
}

export function ColorMenu({ icon: Icon, label, options, value, onSelect }) {
  const [open, setOpen] = useState(false);
  const activeOption = options.find((option) => option.value === value) || options[0];
  const selectedColor = activeOption?.value || "#ffffff";

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".color-menu")) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.document.addEventListener("pointerdown", handlePointerDown, true);
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown, true);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <div className={open ? "color-menu open" : "color-menu"}>
      <button
        type="button"
        className="color-menu-trigger"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon size={17} />
        <span className="color-dot" style={{ "--selected-color": selectedColor }} />
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="color-menu-popover" role="menu">
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              className={option.value === value ? "color-menu-option active" : "color-menu-option"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
              role="menuitem"
            >
              <span className="color-option-dot" style={{ "--option-color": option.value || "#ffffff" }} />
              <span>{option.label}</span>
              {option.value === value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function UnderlineStyleMenu({ active, value, onToggle, onSelect }) {
  const [open, setOpen] = useState(false);
  const normalizedValue = normalizeUnderlineStyle(value);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".underline-style-menu")) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.document.addEventListener("pointerdown", handlePointerDown, true);
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown, true);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <div className={open ? "underline-style-menu open" : "underline-style-menu"}>
      <button
        type="button"
        className={active ? "icon-button active underline-style-toggle" : "icon-button underline-style-toggle"}
        title="下划线"
        aria-label="下划线"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggle}
      >
        <Underline size={17} strokeWidth={2.1} />
      </button>
      <button
        type="button"
        className="underline-style-trigger"
        title="下划线线型"
        aria-label="下划线线型"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className="underline-style-popover" role="menu">
          {UNDERLINE_STYLE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === normalizedValue ? "underline-style-option active" : "underline-style-option"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
              role="menuitem"
            >
              <span className="underline-style-sample" style={{ "--underline-style": option.value }} aria-hidden="true">
                字
              </span>
              <span>{option.label}</span>
              {option.value === normalizedValue ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

