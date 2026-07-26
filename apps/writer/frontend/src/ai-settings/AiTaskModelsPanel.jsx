import { useEffect, useRef } from "react";
import {
  Bot,
  ChevronDown,
  Sparkles,
  SquareTerminal,
  Wifi,
} from "lucide-react";
import { TemplateSelect } from "../templates/index.js";
import {
  aiApplyResolverEditableRequestParams,
  aiRequestParamsEqual,
  aiTaskRequestParamsForEditor,
  normalizeUiAiRequestParams,
  parseAiRequestParamRows,
  requestParamsToRows,
} from "../ai-request-params.js";
import { AiRequestParamsEditor } from "./AiRequestParamsEditor.jsx";
import {
  AI_TASK_MODEL_DEFINITIONS,
  createAiModelKey,
} from "./model.js";

export function AiTaskModelsPanel({
  busy,
  defaultResolverModelKey,
  expandedTaskIds,
  focusTaskId,
  normalizedConfig,
  onTaskFocusHandled,
  openBaseModelSettings,
  requestTaskProviderChange,
  resolverModels,
  resolverProviderGroups,
  saveTaskModelAssignment,
  saveTaskRequestParams,
  setExpandedTaskIds,
  setTaskParamDrafts,
  status,
  taskParamDrafts,
}) {
  const taskHeaderRefs = useRef({});
  const expandedTasks = new Set(expandedTaskIds);

  useEffect(() => {
    if (!focusTaskId || !expandedTasks.has(focusTaskId)) return undefined;
    const frame = window.requestAnimationFrame(() => {
      taskHeaderRefs.current[focusTaskId]?.focus({ preventScroll: true });
      onTaskFocusHandled(focusTaskId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedTaskIds, focusTaskId, onTaskFocusHandled]);

  const toggleTask = (taskId) => {
    setExpandedTaskIds((current) => (
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId]
    ));
  };

  return (
    <main className="ai-settings-main ai-task-model-main">
      <header className="ai-settings-main-head ai-task-model-main-head">
        <div className="ai-provider-hero ai-task-model-hero">
          <span className="ai-provider-hero-icon"><Bot size={30} aria-hidden="true" /></span>
          <div>
            <h2 id="ai-settings-title">任务模型</h2>
            <p>未单独指定时跟随默认模型，也可为内置任务设置专用模型。</p>
          </div>
        </div>
      </header>
      <section className="ai-settings-section ai-task-model-section" aria-label="任务模型列表">
        <div className="ai-settings-section-head">
          <div>
            <h3>内置任务</h3>
            <p className="ai-settings-muted">选择范围仅包含已连接供应商中已测试可用的模型。</p>
          </div>
        </div>
        <div className="ai-task-model-list">
          {AI_TASK_MODEL_DEFINITIONS.map((task) => {
            const assignment = normalizedConfig.taskModels?.[task.id] || { providerId: "", modelId: "", requestParams: {} };
            const modelKey = createAiModelKey(assignment.providerId, assignment.modelId);
            const modelConfigured = Boolean(assignment.providerId && assignment.modelId);
            const effectiveModelKey = modelConfigured ? modelKey : defaultResolverModelKey;
            const assignedModel = resolverModels.find((model) => model.id === effectiveModelKey);
            const assignedProvider = resolverProviderGroups.find((provider) => provider.id === assignedModel?.provider);
            const modelAvailable = Boolean(assignedModel);
            const modelInvalid = modelConfigured && !modelAvailable;
            const providerValue = assignedProvider ? assignedProvider.id : "";
            const modelOptions = assignedProvider?.models || [];
            const effectiveTaskParams = assignedModel
              ? aiTaskRequestParamsForEditor(
                assignedModel.provider,
                assignedModel.requestParams,
                assignment.requestParams,
                assignedModel.model,
              )
              : normalizeUiAiRequestParams(assignment.requestParams);
            const editableEffectiveTaskParams = task.id === "applyResolver"
              ? aiApplyResolverEditableRequestParams(assignedModel?.provider, effectiveTaskParams)
              : effectiveTaskParams;
            const taskRows = taskParamDrafts[task.id] || requestParamsToRows(editableEffectiveTaskParams);
            const taskParamsResult = parseAiRequestParamRows(taskRows, { providerId: assignedModel?.provider || "" });
            const taskParamsDirty = taskParamsResult.valid
              && !aiRequestParamsEqual(taskParamsResult.requestParams, editableEffectiveTaskParams);
            const isExpanded = expandedTasks.has(task.id);
            const headerId = `ai-task-model-header-${task.id}`;
            const bodyId = `ai-task-model-body-${task.id}`;
            const effectiveModelLabel = assignedModel
              ? `${modelConfigured ? "" : "默认模型 · "}${assignedProvider?.label || assignedModel.providerLabel || assignedModel.provider} · ${assignedModel.modelName || assignedModel.model}`
              : "暂无可用模型";
            const hasSummaryBadges = taskParamsDirty || modelInvalid;
            return (
              <article
                key={task.id}
                className={[
                  "ai-task-model-card",
                  isExpanded ? "expanded" : "collapsed",
                  modelInvalid ? "invalid" : "",
                ].filter(Boolean).join(" ")}
              >
                <button
                  ref={(element) => {
                    if (element) taskHeaderRefs.current[task.id] = element;
                    else delete taskHeaderRefs.current[task.id];
                  }}
                  type="button"
                  id={headerId}
                  className="ai-task-model-summary"
                  aria-expanded={isExpanded}
                  aria-controls={bodyId}
                  onClick={() => toggleTask(task.id)}
                >
                  <span className="ai-task-model-copy">
                    <span className="ai-task-model-card-icon"><Sparkles size={19} aria-hidden="true" /></span>
                    <span className="ai-task-model-copy-text">
                      <strong>{task.label}</strong>
                      <span>{task.description}</span>
                    </span>
                  </span>
                  <span className="ai-task-model-summary-status">
                    <span className={modelInvalid ? "ai-task-model-effective invalid" : "ai-task-model-effective"}>
                      {effectiveModelLabel}
                    </span>
                    {hasSummaryBadges ? (
                      <span className="ai-task-model-badges" aria-label={`${task.label}状态`}>
                        {taskParamsDirty ? <span className="ai-task-model-badge dirty">参数未保存</span> : null}
                        {modelInvalid ? <span className="ai-task-model-badge invalid">需重选</span> : null}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown className="ai-task-model-chevron" size={20} aria-hidden="true" />
                </button>
                <div
                  id={bodyId}
                  className="ai-task-model-body-shell"
                  role="region"
                  aria-labelledby={headerId}
                  aria-hidden={!isExpanded}
                  inert={isExpanded ? undefined : true}
                >
                  <div className="ai-task-model-body">
                    <div className="ai-task-model-control">
                      <div className="ai-task-model-selectors" aria-label={task.selectLabel}>
                        <label>
                          <span>供应商</span>
                          <TemplateSelect
                            ariaLabel={`${task.label}供应商`}
                            value={providerValue}
                            options={[
                              { value: "", label: "跟随默认模型" },
                              ...resolverProviderGroups.map((provider) => ({ value: provider.id, label: provider.label })),
                            ]}
                            disabled={busy}
                            invalid={modelInvalid && !assignedProvider}
                            className="ai-task-model-select"
                            onChange={(providerId) => {
                              if (!providerId) {
                                saveTaskModelAssignment(task.id, "", {});
                                return;
                              }
                              requestTaskProviderChange(task.id, providerId);
                            }}
                          />
                        </label>
                        <label>
                          <span>模型</span>
                          <TemplateSelect
                            ariaLabel={`${task.label}模型`}
                            value={modelAvailable ? effectiveModelKey : ""}
                            options={[
                              { value: "", label: modelInvalid ? "原模型已失效，请重新选择" : (assignedProvider ? "请选择模型" : "请先选择供应商") },
                              ...modelOptions.map((model) => ({ value: model.id, label: model.modelName || model.model })),
                            ]}
                            disabled={busy || !assignedProvider}
                            invalid={modelInvalid}
                            className="ai-task-model-select"
                            onChange={(value) => {
                              const model = resolverModels.find((item) => item.id === value);
                              if (model) saveTaskModelAssignment(task.id, model.id, assignment.requestParams || {});
                            }}
                          />
                        </label>
                      </div>
                      {!modelConfigured && assignedModel ? (
                        <span className="ai-task-model-follow-default">
                          未单独指定，当前跟随默认模型「{assignedModel.modelName || assignedModel.model}」。
                        </span>
                      ) : null}
                      {modelInvalid ? <span className="ai-task-model-warning" role="alert">原任务模型已失效，请重新选择。</span> : null}
                      {assignedModel?.transport === "codex-cli" ? (
                        <div className="ai-task-codex-inherit-note">
                          <SquareTerminal size={17} aria-hidden="true" />
                          <span>任务将继承基础模型中的 Codex 推理强度；Codex CLI 不使用 HTTP 请求参数。</span>
                        </div>
                      ) : assignedModel ? (
                        <div className="ai-task-request-params">
                          <AiRequestParamsEditor
                            rows={taskRows}
                            providerId={assignedModel.provider}
                            disabled={busy}
                            compact
                            flat
                            title="任务请求参数"
                            description="已显示所选模型参数；修改或新增字段仅用于当前任务。"
                            onChange={(rows) => setTaskParamDrafts((current) => ({ ...current, [task.id]: rows }))}
                          />
                          <div className="ai-task-request-params-actions">
                            <span>{taskParamsDirty ? "有尚未保存的修改" : "参数已同步"}</span>
                            <button
                              type="button"
                              disabled={busy || !taskParamsResult.valid || !taskParamsDirty}
                              onClick={() => saveTaskRequestParams(task.id, assignedModel)}
                            >
                              保存参数
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        {!resolverModels.length ? (
          <div className="ai-task-model-empty">
            <Wifi size={22} aria-hidden="true" />
            <div>
              <strong>暂无已连接模型</strong>
              <span>请先完成供应商连接并测试至少一个模型。</span>
            </div>
            <button type="button" onClick={openBaseModelSettings}>配置基础模型</button>
          </div>
        ) : null}
        {status ? <p className={`ai-task-model-feedback ${status.tone}`} aria-live="polite">{status.message}</p> : null}
      </section>
    </main>
  );
}
