import { useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, RotateCcw, X } from "lucide-react";
import { renderMermaidSafely } from "../editor/professional-content-extensions.js";
import { isTopModalDialog, useModalFocusTrap } from "../ui-interactions.js";
import { applyMermaidDraft } from "./editor-commands.js";
import {
  MERMAID_WIDTH_OPTIONS,
  normalizeMermaidDraft,
  PROFESSIONAL_UI_LIMITS,
  validateMermaidDraft,
} from "./model.js";

const DEFAULT_MERMAID_SOURCE = `flowchart LR
  A[开始] --> B{条件}
  B -->|是| C[处理]
  B -->|否| D[结束]`;

export function MermaidInsertDialog({
  open,
  editor,
  initialValue,
  update = false,
  updatePosition = null,
  returnFocusElement,
  onSubmit,
  onClose,
}) {
  const initialKey = JSON.stringify({
    diagramId: initialValue?.diagramId,
    source: initialValue?.source,
    caption: initialValue?.caption,
    width: initialValue?.width,
  });
  const dialogRef = useRef(null);
  const sourceRef = useRef(null);
  const [draft, setDraft] = useState(() => normalizeMermaidDraft(initialValue));
  const [preview, setPreview] = useState({ loading: false, svg: "", error: "" });
  useModalFocusTrap(Boolean(open), dialogRef, sourceRef, returnFocusElement);

  useEffect(() => {
    if (open) setDraft(normalizeMermaidDraft(initialValue));
  }, [initialKey, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || !isTopModalDialog(dialogRef)) return;
      event.preventDefault();
      onClose?.();
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose, open]);

  const validation = useMemo(() => validateMermaidDraft(draft), [draft]);

  useEffect(() => {
    if (!open) return undefined;
    if (!validation.valid) {
      setPreview({ loading: false, svg: "", error: validation.error });
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setPreview((current) => ({ ...current, loading: true, error: "" }));
      renderMermaidSafely(validation.value.source, validation.value.diagramId || "dialog-preview")
        .then((svg) => {
          if (active) setPreview({ loading: false, svg, error: "" });
        })
        .catch((error) => {
          if (active) {
            setPreview({
              loading: false,
              svg: "",
              error: error?.message || "Mermaid 语法有误，源码仍会保留。",
            });
          }
        });
    }, 240);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, validation.error, validation.valid, validation.value.diagramId, validation.value.source]);

  if (!open) return null;

  const submit = () => {
    if (!validation.valid) return;
    const result = onSubmit
      ? onSubmit(validation.value, { previewError: preview.error, update, position: updatePosition })
      : applyMermaidDraft(editor, validation.value, { update });
    if (result !== false) onClose?.();
  };

  return (
    <div className="professional-dialog-layer dialog-scrim" role="presentation" onMouseDown={() => onClose?.()}>
      <section
        ref={dialogRef}
        className="professional-dialog mermaid-insert-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mermaid-insert-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="professional-dialog-header">
          <span className="professional-dialog-mark"><GitBranch size={20} aria-hidden="true" /></span>
          <div>
            <small>元素 · 专业内容</small>
            <h2 id="mermaid-insert-title">{update ? "编辑 Mermaid 图" : "插入 Mermaid 图"}</h2>
          </div>
          <button type="button" className="professional-icon-button" onClick={onClose} aria-label="关闭 Mermaid 对话框"><X size={18} /></button>
        </header>

        <div className="mermaid-editor-grid">
          <section className="mermaid-source-pane" aria-labelledby="mermaid-source-title">
            <div className="professional-preview-heading">
              <strong id="mermaid-source-title">源码</strong>
              <button
                type="button"
                className="professional-text-button"
                onClick={() => setDraft((current) => ({ ...current, source: DEFAULT_MERMAID_SOURCE }))}
              >
                <RotateCcw size={14} aria-hidden="true" />载入示例
              </button>
            </div>
            <textarea
              ref={sourceRef}
              value={draft.source}
              rows={18}
              spellCheck={false}
              aria-label="Mermaid 源码"
              placeholder="flowchart LR&#10;  A --> B"
              onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
            />
            <small className={validation.valid ? "" : "is-error"}>
              {draft.source.length.toLocaleString()} / {PROFESSIONAL_UI_LIMITS.maxMermaidChars.toLocaleString()} 字符
            </small>
          </section>

          <section className="mermaid-preview-pane" aria-labelledby="mermaid-preview-title" aria-live="polite">
            <div className="professional-preview-heading">
              <strong id="mermaid-preview-title">预览</strong>
            </div>
            {preview.loading ? <p className="professional-preview-empty">正在渲染 Mermaid 图…</p> : null}
            {!preview.loading && preview.svg ? (
              <div className="mermaid-dialog-preview-stage">
                <div
                  className="mermaid-dialog-svg"
                  style={{ "--mermaid-preview-width": draft.width }}
                  dangerouslySetInnerHTML={{ __html: preview.svg }}
                />
              </div>
            ) : null}
            {!preview.loading && preview.error ? (
              <div className="professional-preview-error" role="alert">
                <strong>预览失败</strong>
                <span>{preview.error}</span>
                <small>源码没有被清空；可继续修改，也可保存后稍后修复。</small>
              </div>
            ) : null}
          </section>
        </div>

        <div className="mermaid-metadata-bar">
          <label className="professional-field mermaid-caption-field">
            <span>图注</span>
            <input
              value={draft.caption}
              maxLength={500}
              placeholder="可选，例如：研究流程"
              onChange={(event) => setDraft((current) => ({ ...current, caption: event.target.value }))}
            />
          </label>
          <fieldset className="mermaid-width-field">
            <legend>铺满程度</legend>
            <div className="professional-segmented" aria-label="Mermaid 图铺满程度">
              {MERMAID_WIDTH_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={draft.width === option.width ? "is-active" : ""}
                  title={`Mermaid 图宽度 ${option.width}`}
                  onClick={() => setDraft((current) => ({ ...current, width: option.width }))}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <footer className="professional-dialog-footer">
          <span className="professional-validation">
            {validation.error || (preview.error ? "当前预览失败，但可以保存源码。" : "预览在本机生成，文档仅保存 Mermaid 源码。")}
          </span>
          <button type="button" className="professional-secondary-button" onClick={onClose}>取消</button>
          <button type="button" className="professional-primary-button" disabled={!validation.valid} onClick={submit}>
            {preview.error ? "保存源码" : (update ? "保存 Mermaid 图" : "插入 Mermaid 图")}
          </button>
        </footer>
      </section>
    </div>
  );
}

export { DEFAULT_MERMAID_SOURCE };
