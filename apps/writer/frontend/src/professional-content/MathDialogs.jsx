import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, Hash, Search, X } from "lucide-react";
import katex from "katex";
import { isTopModalDialog, useModalFocusTrap } from "../ui-interactions.js";
import {
  collectEquationTargets,
  MATH_MODES,
  normalizeMathDraft,
  PROFESSIONAL_UI_LIMITS,
  validateMathDraft,
} from "./model.js";
import {
  insertEquationReference,
  insertMathDraft,
  updateMathDraftAt,
} from "./editor-commands.js";

function useDialogEscape(open, dialogRef, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || !isTopModalDialog(dialogRef)) return;
      event.preventDefault();
      onClose?.();
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [dialogRef, onClose, open]);
}

function renderKatexPreview(latex, displayMode) {
  if (!latex.trim()) return { html: "", error: "" };
  try {
    return {
      html: katex.renderToString(latex, {
        displayMode,
        throwOnError: true,
        strict: "warn",
        trust: false,
        maxExpand: 1_000,
        output: "htmlAndMathml",
      }),
      error: "",
    };
  } catch (error) {
    return { html: "", error: error?.message || "TeX 语法有误" };
  }
}

export function MathInsertDialog({
  open,
  editor,
  initialValue,
  update = false,
  updatePosition,
  returnFocusElement,
  onSubmit,
  onClose,
}) {
  const initialKey = JSON.stringify({
    mode: initialValue?.mode,
    latex: initialValue?.latex,
    equationId: initialValue?.equationId,
    label: initialValue?.label,
    numbering: initialValue?.numbering,
  });
  const [draft, setDraft] = useState(() => normalizeMathDraft(initialValue));
  const dialogRef = useRef(null);
  const sourceRef = useRef(null);
  useModalFocusTrap(Boolean(open), dialogRef, sourceRef, returnFocusElement);
  useDialogEscape(Boolean(open), dialogRef, onClose);

  useEffect(() => {
    if (open) setDraft(normalizeMathDraft(initialValue));
  }, [initialKey, open]);

  const validation = useMemo(() => validateMathDraft(draft), [draft]);
  const preview = useMemo(
    () => renderKatexPreview(draft.latex, draft.mode === "block"),
    [draft.latex, draft.mode],
  );

  if (!open) return null;

  const submit = () => {
    if (!validation.valid) return;
    const result = onSubmit
      ? onSubmit(validation.value, { update, position: updatePosition })
      : (
        update && Number.isFinite(Number(updatePosition))
          ? updateMathDraftAt(editor, Number(updatePosition), validation.value)
          : insertMathDraft(editor, validation.value, { update })
      );
    if (result !== false) onClose?.();
  };

  return (
    <div className="professional-dialog-layer dialog-scrim" role="presentation" onMouseDown={() => onClose?.()}>
      <section
        ref={dialogRef}
        className="professional-dialog math-insert-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="math-insert-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="professional-dialog-header">
          <span className="professional-dialog-mark"><Braces size={20} aria-hidden="true" /></span>
          <div>
            <small>元素 · 专业内容</small>
            <h2 id="math-insert-title">{update ? "编辑公式" : "插入公式"}</h2>
          </div>
          <button type="button" className="professional-icon-button" onClick={onClose} aria-label="关闭公式对话框"><X size={18} /></button>
        </header>

        <div className="professional-dialog-body">
          <div className="professional-segmented" role="radiogroup" aria-label="公式类型">
            {MATH_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={draft.mode === mode.id}
                className={draft.mode === mode.id ? "is-active" : ""}
                disabled={update}
                title={update ? "编辑现有公式时不能改变行内/块类型" : undefined}
                onClick={() => setDraft((current) => normalizeMathDraft({ ...current, mode: mode.id }))}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <label className="professional-field">
            <span>TeX 源码</span>
            <textarea
              ref={sourceRef}
              value={draft.latex}
              maxLength={PROFESSIONAL_UI_LIMITS.maxLatexChars}
              rows={5}
              spellCheck={false}
              placeholder={draft.mode === "inline" ? String.raw`例如：E = mc^2` : String.raw`例如：\int_0^\infty e^{-x}\,dx = 1`}
              onChange={(event) => setDraft((current) => ({ ...current, latex: event.target.value }))}
            />
            <small>{draft.latex.length.toLocaleString()} / {PROFESSIONAL_UI_LIMITS.maxLatexChars.toLocaleString()}</small>
          </label>

          {draft.mode === "block" ? (
            <div className="professional-form-grid">
              <label className="professional-field">
                <span>标签</span>
                <input
                  value={draft.label}
                  maxLength={200}
                  placeholder="例如：勾股定理"
                  onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
                />
              </label>
              <label className="professional-check">
                <input
                  type="checkbox"
                  checked={draft.numbering}
                  onChange={(event) => setDraft((current) => ({ ...current, numbering: event.target.checked }))}
                />
                <span>显示自动编号并允许交叉引用</span>
              </label>
            </div>
          ) : null}

          <section className="professional-live-preview" aria-label="公式实时预览" aria-live="polite">
            <div className="professional-preview-heading">
              <strong>实时预览</strong>
              <small>{draft.mode === "block" ? "块公式" : "行内公式"}</small>
            </div>
            {!draft.latex.trim() ? <p className="professional-preview-empty">输入 TeX 后将在这里预览。</p> : null}
            {preview.error ? <p className="professional-preview-error" role="alert">{preview.error}</p> : null}
            {preview.html ? (
              <div
                className={draft.mode === "block" ? "math-preview-output is-block" : "math-preview-output"}
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
            ) : null}
          </section>
        </div>

        <footer className="professional-dialog-footer">
          <span className="professional-validation">{validation.error || "TeX 源码会作为文档的规范数据保存。"}</span>
          <button type="button" className="professional-secondary-button" onClick={onClose}>取消</button>
          <button type="button" className="professional-primary-button" disabled={!validation.valid} onClick={submit}>
            {update ? "保存公式" : "插入公式"}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function EquationReferenceDialog({
  open,
  editor,
  documentNode,
  equations,
  returnFocusElement,
  onSubmit,
  onClose,
}) {
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  useModalFocusTrap(Boolean(open), dialogRef, searchRef, returnFocusElement);
  useDialogEscape(Boolean(open), dialogRef, onClose);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedId("");
  }, [open]);

  const targets = Array.isArray(equations)
    ? equations
    : collectEquationTargets(documentNode || editor?.state?.doc);
  const visibleTargets = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    if (!needle) return targets;
    return targets.filter((target) => [
      target.displayLabel,
      target.label,
      target.latex,
      target.number,
    ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN").includes(needle));
  }, [query, targets]);
  const selected = targets.find((target) => target.equationId === selectedId && target.referenceable) || null;

  if (!open) return null;

  const submit = () => {
    if (!selected) return;
    const result = onSubmit
      ? onSubmit(selected)
      : insertEquationReference(editor, selected.equationId);
    if (result !== false) onClose?.();
  };

  return (
    <div className="professional-dialog-layer dialog-scrim" role="presentation" onMouseDown={() => onClose?.()}>
      <section
        ref={dialogRef}
        className="professional-dialog equation-reference-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="equation-reference-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="professional-dialog-header">
          <span className="professional-dialog-mark"><Hash size={20} aria-hidden="true" /></span>
          <div>
            <small>元素 · 公式引用</small>
            <h2 id="equation-reference-title">选择公式</h2>
          </div>
          <button type="button" className="professional-icon-button" onClick={onClose} aria-label="关闭公式引用选择器"><X size={18} /></button>
        </header>
        <label className="professional-search">
          <Search size={16} aria-hidden="true" />
          <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标签、编号或 TeX" />
        </label>
        <div className="equation-reference-list">
          {!visibleTargets.length ? <p className="professional-empty">当前文档没有可引用的块公式。</p> : null}
          {visibleTargets.map((target) => (
            <button
              key={target.equationId}
              type="button"
              className={`equation-reference-row${selectedId === target.equationId ? " is-active" : ""}`}
              disabled={!target.referenceable}
              onClick={() => setSelectedId(target.equationId)}
              onDoubleClick={() => {
                if (!target.referenceable) return;
                const result = onSubmit ? onSubmit(target) : insertEquationReference(editor, target.equationId);
                if (result !== false) onClose?.();
              }}
            >
              <strong>{target.referenceable ? `(${target.number})` : "—"}</strong>
              <span>
                <b>{target.label || "未命名公式"}</b>
                <code>{target.latex || "TeX 源码为空"}</code>
              </span>
              {!target.referenceable ? <small>未编号</small> : null}
            </button>
          ))}
        </div>
        <footer className="professional-dialog-footer">
          <span className="professional-validation">引用编号随正文中的公式顺序自动更新。</span>
          <button type="button" className="professional-secondary-button" onClick={onClose}>取消</button>
          <button type="button" className="professional-primary-button" disabled={!selected} onClick={submit}>插入引用</button>
        </footer>
      </section>
    </div>
  );
}
