import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export function TemplateSelect({ ariaLabel, value, options, onChange, disabled = false, invalid = false, className = "" }) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const optionRefs = useRef([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex] || options[0];

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const predictedHeight = Math.min(280, options.length * 36 + 12);
    const availableBelow = window.innerHeight - rect.bottom - 12;
    const openAbove = availableBelow < predictedHeight && rect.top > predictedHeight + 12;
    const width = Math.max(180, rect.width);
    setMenuStyle({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: openAbove ? Math.max(12, rect.top - predictedHeight - 6) : rect.bottom + 6,
      width,
      maxHeight: predictedHeight,
    });
  }, [options.length]);

  const focusOption = useCallback((index) => {
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  }, []);

  const openWithKeyboard = (index) => {
    setOpen(true);
    focusOption(index);
  };

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return undefined;
    }
    updateMenuPosition();
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.document.addEventListener("pointerdown", handlePointerDown, true);
    window.document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown, true);
      window.document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const handleOptionKeyDown = (event, index) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      focusOption((index + direction + options.length) % options.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : options.length - 1);
    }
  };

  const menu = open && menuStyle ? createPortal(
    <div
      ref={menuRef}
      className="template-select-popover"
      role="listbox"
      aria-label={ariaLabel}
      style={menuStyle}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => { optionRefs.current[index] = element; }}
          type="button"
          className={option.value === value ? "template-select-option active" : "template-select-option"}
          role="option"
          aria-selected={option.value === value}
          onKeyDown={(event) => handleOptionKeyDown(event, index)}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
            triggerRef.current?.focus();
          }}
        >
          <span style={option.fontFamily ? { fontFamily: option.fontFamily } : undefined}>{option.label}</span>
          {option.value === value ? <Check size={14} /> : null}
        </button>
      ))}
    </div>,
    window.document.body,
  ) : null;

  return (
    <div ref={rootRef} className={["template-select", open ? "open" : "", invalid ? "invalid" : "", className].filter(Boolean).join(" ")}>
      <button
        ref={triggerRef}
        type="button"
        className="template-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={invalid || undefined}
        onClick={() => {
          if (!disabled) {
            setOpen((current) => !current);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openWithKeyboard(selectedIndex);
          }
        }}
      >
        <span style={selectedOption?.fontFamily ? { fontFamily: selectedOption.fontFamily } : undefined}>
          {selectedOption?.label || "请选择"}
        </span>
        <ChevronDown size={15} />
      </button>
      {menu}
    </div>
  );
}
