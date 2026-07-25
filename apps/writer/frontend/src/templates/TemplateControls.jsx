import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Minus, Pencil, Plus } from "lucide-react";
import {
  TEMPLATE_FONT_SIZE_MAX,
  TEMPLATE_FONT_SIZE_MIN,
  TEMPLATE_HEADING_COLOR_OPTIONS,
  TEMPLATE_NAME_MAX_LENGTH,
  normalizeTemplateFontSize,
  normalizeTemplateName,
} from "./model.js";

export function TemplatePaperPicker({ value, groups, onChange }) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const selectedGroup = groups.find((group) => group.options.some((option) => option.value === value)) || groups[0];
  const selectedOption = groups.flatMap((group) => group.options).find((option) => option.value === value)
    || selectedGroup?.options?.[0];
  const [activeGroupId, setActiveGroupId] = useState(() => selectedGroup?.id || "");
  const activeGroup = groups.find((group) => group.id === activeGroupId) || selectedGroup || groups[0];

  useEffect(() => {
    if (selectedGroup?.id) {
      setActiveGroupId(selectedGroup.id);
    }
  }, [selectedGroup?.id, value]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
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
    <div ref={rootRef} className={`template-paper-picker${open ? " open" : ""}`}>
      <button
        type="button"
        className="template-paper-picker-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-label="信纸背景"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span
          className="template-paper-miniature"
          style={{ "--template-bg": `url("${selectedOption?.background}")`, "--swatch": selectedOption?.swatch }}
          aria-hidden="true"
        />
        <span className="template-paper-picker-copy">
          <small>{selectedGroup?.label}</small>
          <strong>{selectedOption?.label || "选择信纸"}</strong>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div className="template-paper-picker-panel" role="dialog" aria-label="选择信纸背景">
          <div className="template-paper-group-tabs" role="tablist" aria-label="系统信纸分组">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={activeGroup?.id === group.id}
                className={activeGroup?.id === group.id ? "active" : ""}
                onClick={() => setActiveGroupId(group.id)}
              >
                {group.label}
              </button>
            ))}
          </div>
          <div className="template-paper-options" role="listbox" aria-label={activeGroup?.label || "信纸"}>
            {(activeGroup?.options || []).map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={option.value === value ? "active" : ""}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span
                  className="template-paper-option-thumb"
                  style={{ "--template-bg": `url("${option.background}")`, "--swatch": option.swatch }}
                  aria-hidden="true"
                />
                <span>{option.label}</span>
                {option.value === value ? <Check size={14} aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TemplateNameInput({ value, onChange, error = "" }) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);

  useEffect(() => {
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  const commit = () => {
    const normalized = normalizeTemplateName(draftRef.current);
    if (normalized !== value) {
      const accepted = onChange(normalized);
      if (accepted === false) {
        draftRef.current = value;
        setDraft(value);
        return;
      }
    }
    draftRef.current = normalized;
    setDraft(normalized);
  };

  return (
    <div className="template-name-field">
      <label className="template-name-control">
        <Pencil size={15} aria-hidden="true" />
        <input
          value={draft}
          maxLength={TEMPLATE_NAME_MAX_LENGTH}
          onChange={(event) => {
            const nextValue = Array.from(event.target.value).slice(0, TEMPLATE_NAME_MAX_LENGTH).join("");
            draftRef.current = nextValue;
            setDraft(nextValue);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              draftRef.current = value;
              setDraft(value);
              event.currentTarget.blur();
            }
          }}
          aria-label="模板名称"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "template-name-error" : undefined}
        />
        <span className="template-name-count" aria-hidden="true">
          {Array.from(draft).length}/{TEMPLATE_NAME_MAX_LENGTH}
        </span>
      </label>
      {error ? <small id="template-name-error" className="template-name-error" role="alert">{error}</small> : null}
    </div>
  );
}

export function TemplateSizeInput({ ariaLabel, value, onChange }) {
  const [draft, setDraft] = useState(String(value));
  const normalizedValue = normalizeTemplateFontSize(value, 16);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = (nextDraft = draft) => {
    const nextValue = normalizeTemplateFontSize(nextDraft, normalizedValue);
    setDraft(String(nextValue));
    if (nextValue !== value) {
      onChange(nextValue);
    }
  };

  const step = (delta) => {
    const nextValue = normalizeTemplateFontSize(normalizedValue + delta, normalizedValue);
    setDraft(String(nextValue));
    onChange(nextValue);
  };

  return (
    <div className="template-size-control" title={`字号范围 ${TEMPLATE_FONT_SIZE_MIN}–${TEMPLATE_FONT_SIZE_MAX}`}>
      <button
        type="button"
        disabled={normalizedValue <= TEMPLATE_FONT_SIZE_MIN}
        onClick={() => step(-1)}
        aria-label={`${ariaLabel}减小字号`}
        title="减小字号"
      >
        <Minus size={13} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            step(event.key === "ArrowUp" ? 1 : -1);
          } else if (event.key === "Escape") {
            setDraft(String(normalizedValue));
            event.currentTarget.blur();
          }
        }}
        aria-label={`${ariaLabel}字号`}
        aria-valuemin={TEMPLATE_FONT_SIZE_MIN}
        aria-valuemax={TEMPLATE_FONT_SIZE_MAX}
        aria-valuenow={normalizedValue}
      />
      <button
        type="button"
        disabled={normalizedValue >= TEMPLATE_FONT_SIZE_MAX}
        onClick={() => step(1)}
        aria-label={`${ariaLabel}增大字号`}
        title="增大字号"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

export function TemplateSettingSwitch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      className={checked ? "template-setting-switch checked" : "template-setting-switch"}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i aria-hidden="true" />
    </button>
  );
}

export function TemplateHeadingColorPicker({ value, onChange, label, disabled = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selectedOption = TEMPLATE_HEADING_COLOR_OPTIONS.find((option) => option.value === value)
    || TEMPLATE_HEADING_COLOR_OPTIONS[0];

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
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
    <div ref={rootRef} className={`template-heading-color-picker${open ? " open" : ""}`}>
      <button
        type="button"
        className="template-heading-color-trigger"
        aria-label={label}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <i style={{ "--color": selectedOption.value }} aria-hidden="true" />
        <span>{selectedOption.label}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="template-heading-color-options" role="listbox" aria-label={label}>
          {TEMPLATE_HEADING_COLOR_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "active" : ""}
              title={option.label}
              aria-label={option.label}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <i style={{ "--color": option.value }} aria-hidden="true" />
              {option.value === value ? <Check size={12} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
