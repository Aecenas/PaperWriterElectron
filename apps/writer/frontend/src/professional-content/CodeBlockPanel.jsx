import { useEffect, useState } from "react";
import { Braces, Check, Undo2, WrapText, X } from "lucide-react";
import {
  applyCodeBlockOptions,
  readActiveCodeBlockOptions,
} from "./editor-commands.js";
import { CODE_LANGUAGES, normalizeCodeBlockOptions } from "./model.js";

export function CodeBlockPanel({
  open,
  editor,
  initialValue,
  compact = false,
  onApply,
  onClose,
}) {
  const [options, setOptions] = useState(() => normalizeCodeBlockOptions(initialValue));
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const sync = () => {
      const current = readActiveCodeBlockOptions(editor);
      setActive(current.active);
      if (current.active) setOptions(normalizeCodeBlockOptions(current));
    };
    const current = readActiveCodeBlockOptions(editor);
    setActive(current.active);
    setOptions(current.active ? normalizeCodeBlockOptions(current) : normalizeCodeBlockOptions(initialValue));
    editor?.on?.("selectionUpdate", sync);
    editor?.on?.("transaction", sync);
    return () => {
      editor?.off?.("selectionUpdate", sync);
      editor?.off?.("transaction", sync);
    };
  }, [editor, initialValue?.language, initialValue?.wrap, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open]);

  if (!open) return null;

  const apply = () => {
    const result = onApply
      ? onApply(options, { active })
      : applyCodeBlockOptions(editor, options);
    if (result !== false) onClose?.();
  };

  const convertToParagraph = () => {
    const result = editor?.chain?.().focus?.().toggleCodeBlock?.().run?.();
    if (result !== false) onClose?.();
  };

  return (
    <section
      className={`professional-code-panel${compact ? " is-compact" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-label={active ? "代码块设置" : "插入代码块"}
    >
      <header>
        <span><Braces size={17} aria-hidden="true" /></span>
        <div>
          <strong>{active ? "代码块设置" : "插入代码块"}</strong>
          <small>{active ? "修改当前代码块" : "将当前段落转换为代码块"}</small>
        </div>
        <button type="button" className="professional-icon-button" onClick={onClose} aria-label="关闭代码块面板"><X size={16} /></button>
      </header>
      <div className="professional-code-panel-body">
        <label className="professional-field">
          <span>语言</span>
          <select
            value={options.language}
            onChange={(event) => setOptions((current) => normalizeCodeBlockOptions({
              ...current,
              language: event.target.value,
            }))}
          >
            {!CODE_LANGUAGES.some((language) => language.id === options.language)
              ? <option value={options.language}>{options.language}</option>
              : null}
            {CODE_LANGUAGES.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}
          </select>
        </label>
        <label className="professional-check">
          <input
            type="checkbox"
            checked={options.wrap}
            onChange={(event) => setOptions((current) => ({ ...current, wrap: event.target.checked }))}
          />
          <WrapText size={16} aria-hidden="true" />
          <span>自动换行</span>
        </label>
      </div>
      <footer>
        {active ? (
          <button type="button" className="professional-text-button is-danger" onClick={convertToParagraph}>
            <Undo2 size={14} aria-hidden="true" />转为正文
          </button>
        ) : <span />}
        <button type="button" className="professional-primary-button" onClick={apply}>
          <Check size={15} aria-hidden="true" />{active ? "应用" : "插入"}
        </button>
      </footer>
    </section>
  );
}
