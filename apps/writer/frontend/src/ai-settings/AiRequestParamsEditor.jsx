import { useCallback, useMemo, useState } from "react";
import { Info, Maximize2, Minimize2, Plus, Trash2 } from "lucide-react";
import { TemplateSelect } from "../templates/index.js";
import {
  AI_REQUEST_PARAM_BOOLEAN_OPTIONS,
  AI_REQUEST_PARAM_TYPE_OPTIONS,
  aiRequestParamPreset,
  createAiRequestParamRow,
  parseAiRequestParamRows,
} from "../ai-request-params.js";

export function AppInfoTooltip({ id, label, text, className = "" }) {
  return (
    <button
      type="button"
      className={["app-info-tooltip-trigger", className].filter(Boolean).join(" ")}
      aria-label={label}
      aria-describedby={id}
    >
      <Info size={15} aria-hidden="true" />
      <span id={id} className="app-info-tooltip-bubble" role="tooltip">{text}</span>
    </button>
  );
}

export function AiRequestParamsEditor({
  rows = [],
  onChange,
  providerId = "",
  disabled = false,
  compact = false,
  flat = false,
  title = "请求参数",
  description = "以 Key-Value 形式附加到模型请求体。",
}) {
  const parsed = useMemo(() => parseAiRequestParamRows(rows, { providerId }), [providerId, rows]);
  const [expandedJsonRows, setExpandedJsonRows] = useState(() => new Set());

  const updateRow = useCallback((rowId, patch) => {
    onChange(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }, [onChange, rows]);

  const addRow = useCallback(() => {
    onChange([...rows, createAiRequestParamRow()]);
  }, [onChange, rows]);

  const toggleJsonRow = useCallback((row) => {
    const expanded = expandedJsonRows.has(row.id);
    let valueText = row.valueText;
    try {
      valueText = JSON.stringify(JSON.parse(row.valueText), null, expanded ? 0 : 2);
    } catch {
      // Keep malformed drafts untouched so users can repair them in the expanded editor.
    }
    updateRow(row.id, { valueText });
    setExpandedJsonRows((current) => {
      const next = new Set(current);
      if (expanded) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, [expandedJsonRows, updateRow]);

  return (
    <section className={["ai-request-params-editor", compact ? "compact" : "", flat ? "flat" : "", disabled ? "disabled" : ""].filter(Boolean).join(" ")}>
      <header className="ai-request-params-head">
        <div>
          <strong>{title}</strong>
          {description ? <span>{description}</span> : null}
        </div>
        <button
          type="button"
          className="ai-request-param-add-button"
          disabled={disabled || rows.length >= 64}
          aria-label={`为${title}添加参数`}
          onClick={addRow}
        >
          <Plus size={14} aria-hidden="true" />
          <span>添加参数</span>
        </button>
      </header>
      {rows.length ? (
        <div className="ai-request-param-list">
          <div className="ai-request-param-columns" aria-hidden="true">
            <span>参数名</span><span>类型</span><span>参数值</span><span />
          </div>
          {rows.map((row, index) => {
            const rowError = parsed.errors[row.id];
            const rowHint = row.hint || aiRequestParamPreset(providerId, row.key)?.hint || "";
            return (
              <div key={row.id} className={rowError ? "ai-request-param-row invalid" : "ai-request-param-row"}>
                <div className="ai-request-param-key-field">
                  {rowHint ? (
                    <AppInfoTooltip
                      id={`ai-request-param-tip-${row.id}`}
                      className="ai-request-param-info"
                      label={`查看 ${row.key || `参数 ${index + 1}`} 的说明`}
                      text={rowHint}
                    />
                  ) : <span className="ai-request-param-info-spacer" aria-hidden="true" />}
                  <input
                    value={row.key}
                    disabled={disabled}
                    aria-label={`${title}参数 ${index + 1} 名称`}
                    aria-invalid={Boolean(rowError) || undefined}
                    placeholder="例如：temperature"
                    spellCheck={false}
                    onChange={(event) => updateRow(row.id, { key: event.target.value, hint: "" })}
                  />
                  {rowError ? <small className="ai-request-param-error" role="alert">{rowError}</small> : null}
                </div>
                <TemplateSelect
                  ariaLabel={`${row.key || `参数 ${index + 1}`}类型`}
                  value={row.type}
                  options={AI_REQUEST_PARAM_TYPE_OPTIONS}
                  disabled={disabled}
                  className="ai-request-param-type-select"
                  onChange={(type) => updateRow(row.id, {
                    type,
                    valueText: type === "boolean" && !["true", "false"].includes(row.valueText) ? "true" : row.valueText,
                  })}
                />
                {row.type === "boolean" ? (
                  <TemplateSelect
                    ariaLabel={`${row.key || `参数 ${index + 1}`}值`}
                    value={["true", "false"].includes(row.valueText) ? row.valueText : "true"}
                    options={AI_REQUEST_PARAM_BOOLEAN_OPTIONS}
                    disabled={disabled}
                    className="ai-request-param-value-select"
                    onChange={(valueText) => updateRow(row.id, { valueText })}
                  />
                ) : row.type === "json" ? (
                  <div className={`ai-request-param-json-field${expandedJsonRows.has(row.id) ? " expanded" : ""}`}>
                    {expandedJsonRows.has(row.id) ? (
                      <textarea
                        value={row.valueText}
                        disabled={disabled}
                        aria-label={`${row.key || `参数 ${index + 1}`}JSON 值`}
                        aria-invalid={Boolean(rowError) || undefined}
                        placeholder='例如：{"type":"enabled"}'
                        spellCheck={false}
                        rows={compact ? 4 : 5}
                        onChange={(event) => updateRow(row.id, { valueText: event.target.value })}
                      />
                    ) : (
                      <input
                        value={row.valueText}
                        disabled={disabled}
                        aria-label={`${row.key || `参数 ${index + 1}`}JSON 值`}
                        aria-invalid={Boolean(rowError) || undefined}
                        placeholder='例如：{"type":"enabled"}'
                        spellCheck={false}
                        onChange={(event) => updateRow(row.id, { valueText: event.target.value })}
                      />
                    )}
                    <button
                      type="button"
                      className="ai-request-param-json-toggle"
                      disabled={disabled}
                      aria-label={`${expandedJsonRows.has(row.id) ? "收起" : "展开"} ${row.key || `参数 ${index + 1}`} JSON 编辑器`}
                      onClick={() => toggleJsonRow(row)}
                    >
                      {expandedJsonRows.has(row.id) ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                  </div>
                ) : (
                  <input
                    className="ai-request-param-value-input"
                    value={row.valueText}
                    disabled={disabled}
                    aria-label={`${row.key || `参数 ${index + 1}`}值`}
                    aria-invalid={Boolean(rowError) || undefined}
                    inputMode={row.type === "number" ? "decimal" : undefined}
                    placeholder={row.type === "number" ? "例如：1" : "参数值"}
                    spellCheck={false}
                    onChange={(event) => updateRow(row.id, { valueText: event.target.value })}
                  />
                )}
                <button
                  type="button"
                  className="ai-request-param-remove"
                  disabled={disabled}
                  aria-label={`删除参数 ${row.key || index + 1}`}
                  title="删除参数"
                  onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ai-request-params-empty">尚未添加请求参数，将使用服务商默认行为。</div>
      )}
      {parsed.error ? <p className="ai-request-params-message error" role="alert">{parsed.error}</p> : null}
    </section>
  );
}
