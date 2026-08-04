import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { bridge } from "../bridge.js";
import { groupTestedAiProviders } from "../ai-provider-selector.js";
import {
  aiApplyResolverEditableRequestParams,
  aiModelCapabilities,
  aiRequestParamsWithProviderDefaults,
  aiTaskRequestParamsForEditor,
  normalizeUiAiRequestParams,
  parseAiRequestParamRows,
  requestParamsToRows,
} from "../ai-request-params.js";
import { dialogFocusableElements } from "../ui-interactions.js";
import { AiRequestParamsEditor, AppInfoTooltip } from "./AiRequestParamsEditor.jsx";
import { AiProviderPanel } from "./AiProviderPanel.jsx";
import { AiProviderSidebar } from "./AiProviderSidebar.jsx";
import { AiTaskModelsPanel } from "./AiTaskModelsPanel.jsx";
import {
  AI_PROTOCOL_OPTIONS,
  AI_PROVIDER_OPTIONS,
  AI_TASK_MODEL_DEFINITIONS,
  createAiModelKey,
  formatAiProviderUpdatedAt,
  getAiProviderConnectionMeta,
  getAiProviderDefaults,
  getAiProviderSaveBaseUrl,
  getTestedAiProviders,
  normalizePublicAiConfig,
  normalizePublicAiModelConfig,
  normalizePublicAiProviderConfig,
} from "./model.js";
import { AI_PROVIDER_ICON_ASSETS } from "./provider-icons.js";

export function AiSettingsDialog({ open, embedded = false, initialPanel = "provider", initialTaskId = "", returnFocusRef, config, onClose, onSave, onCreateProvider, onDeleteProvider, onTest, onClear, onRefreshCodex, onLoginCodex }) {
  const [activePanel, setActivePanel] = useState("provider");
  const [selectedProvider, setSelectedProvider] = useState("gemini");
  const [selectedModelId, setSelectedModelId] = useState("gemini-default");
  const [drafts, setDrafts] = useState(() => normalizePublicAiConfig(config).providers);
  const [apiKeys, setApiKeys] = useState({});
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [providerEditor, setProviderEditor] = useState(null);
  const [providerCreator, setProviderCreator] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [modelEditor, setModelEditor] = useState(null);
  const [taskParamDrafts, setTaskParamDrafts] = useState({});
  const [taskProviderConfirm, setTaskProviderConfirm] = useState(null);
  const [expandedTaskIds, setExpandedTaskIds] = useState([]);
  const [taskFocusRequestId, setTaskFocusRequestId] = useState("");
  const initializedOpenRef = useRef(false);
  const codexAutoCheckRef = useRef(false);
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const normalizedConfig = useMemo(() => normalizePublicAiConfig(config), [config]);
  const providerOptions = useMemo(() => Object.values(drafts).map((provider) => ({
    id: provider.provider,
    label: provider.providerLabel,
    transport: provider.transport || "http",
    protocol: provider.protocol,
    builtin: provider.builtin,
    baseUrl: provider.baseUrl,
  })), [drafts]);
  const selectedDraft = drafts[selectedProvider] || normalizePublicAiProviderConfig(selectedProvider);
  const selectedModel = selectedDraft.models.find((model) => model.id === selectedModelId) || selectedDraft.models[0];
  const selectedIsDefault = normalizedConfig.activeProvider === selectedProvider && selectedDraft.activeModelId === selectedModel?.id;
  const selectedProviderOption = getAiProviderDefaults(selectedProvider, selectedDraft);
  const selectedProviderIcon = AI_PROVIDER_ICON_ASSETS[selectedProvider];
  const selectedConnection = getAiProviderConnectionMeta(selectedDraft);
  const selectedLastUpdated = formatAiProviderUpdatedAt(selectedDraft);
  const selectedIsCodex = selectedDraft.transport === "codex-cli";
  const modelEditorCapabilities = modelEditor ? aiModelCapabilities(selectedProvider, modelEditor.model) : null;
  const resolverModels = useMemo(() => getTestedAiProviders({
    ...normalizedConfig,
    providers: drafts,
  }), [drafts, normalizedConfig]);
  const resolverProviderGroups = useMemo(() => groupTestedAiProviders(resolverModels, AI_PROVIDER_OPTIONS), [resolverModels]);
  const defaultResolverModelKey = createAiModelKey(normalizedConfig.activeProvider, normalizedConfig.activeModelId);
  const taskModelStatuses = AI_TASK_MODEL_DEFINITIONS.map((task) => {
    const assignment = normalizedConfig.taskModels?.[task.id] || {};
    const configured = Boolean(assignment.providerId && assignment.modelId);
    const modelKey = configured
      ? createAiModelKey(assignment.providerId, assignment.modelId)
      : defaultResolverModelKey;
    return {
      configured,
      available: resolverModels.some((model) => model.id === modelKey),
    };
  });
  const taskModelInvalid = taskModelStatuses.some((task) => task.configured && !task.available);
  const taskModelsAvailable = taskModelStatuses.length > 0 && taskModelStatuses.every((task) => task.available);
  const configuredTaskModelCount = taskModelStatuses.filter((task) => task.configured).length;
  const taskModelNavTone = taskModelInvalid ? "failed" : (taskModelsAvailable ? "connected" : "idle");
  const taskModelNavLabel = taskModelInvalid
    ? "需重选"
    : (configuredTaskModelCount
      ? `${configuredTaskModelCount} 项已指定`
      : (taskModelsAvailable ? "跟随默认" : "待配置"));
  const selectedProviderTaskLabels = useMemo(() => AI_TASK_MODEL_DEFINITIONS
    .filter((task) => normalizedConfig.taskModels?.[task.id]?.providerId === selectedProvider)
    .map((task) => task.label), [normalizedConfig.taskModels, selectedProvider]);
  const requestedTaskId = AI_TASK_MODEL_DEFINITIONS.some((task) => task.id === initialTaskId)
    ? initialTaskId
    : "";

  useEffect(() => {
    if (!open) {
      initializedOpenRef.current = false;
      return;
    }
    if (initializedOpenRef.current) {
      return;
    }
    initializedOpenRef.current = true;
    const normalized = normalizePublicAiConfig(config);
    setActivePanel(requestedTaskId || initialPanel === "tasks" ? "tasks" : "provider");
    setSelectedProvider(normalized.activeProvider);
    setSelectedModelId(normalized.activeModelId);
    setDrafts(normalized.providers);
    setApiKeys({});
    setStatus(null);
    setBusy(false);
    setProviderEditor(null);
    setProviderCreator(null);
    setDeleteConfirm(false);
    setModelEditor(null);
    const availableModels = getTestedAiProviders(normalized);
    setTaskParamDrafts(Object.fromEntries(AI_TASK_MODEL_DEFINITIONS.map((task) => {
      const assignment = normalized.taskModels?.[task.id] || {};
      const modelConfigured = Boolean(assignment.providerId && assignment.modelId);
      const assignedModel = availableModels.find((model) => model.id === (
        modelConfigured
          ? createAiModelKey(assignment.providerId, assignment.modelId)
          : createAiModelKey(normalized.activeProvider, normalized.activeModelId)
      ));
      const requestParams = assignedModel
        ? aiTaskRequestParamsForEditor(
          assignedModel.provider,
          assignedModel.requestParams,
          assignment.requestParams,
          assignedModel.model,
        )
        : assignment.requestParams;
      const editableRequestParams = task.id === "applyResolver"
        ? aiApplyResolverEditableRequestParams(assignedModel?.provider, requestParams)
        : requestParams;
      return [task.id, requestParamsToRows(editableRequestParams || {})];
    })));
    setTaskProviderConfirm(null);
    setExpandedTaskIds(requestedTaskId ? [requestedTaskId] : []);
    setTaskFocusRequestId(requestedTaskId);
    codexAutoCheckRef.current = false;
  }, [config, initialPanel, open, requestedTaskId]);

  useEffect(() => {
    if (!open || embedded) return undefined;
    const previouslyFocused = window.document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      if (!requestedTaskId) {
        closeButtonRef.current?.focus({ preventScroll: true });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const focusTarget = returnFocusRef?.current || previouslyFocused;
      if (focusTarget instanceof HTMLElement && focusTarget.isConnected) {
        focusTarget.focus({ preventScroll: true });
      }
    };
  }, [embedded, open, requestedTaskId, returnFocusRef]);

  const handleTaskFocusHandled = useCallback((taskId) => {
    setTaskFocusRequestId((current) => (current === taskId ? "" : current));
  }, []);

  useEffect(() => {
    if (!open) return;
    const codex = normalizedConfig.providers["codex-cli"];
    if (!codex) return;
    setDrafts((previous) => ({ ...previous, "codex-cli": codex }));
  }, [normalizedConfig.providers, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (!embedded && event.key === "Tab") {
        const elements = dialogFocusableElements(dialogRef.current);
        if (!elements.length) return;
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (event.shiftKey && window.document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && window.document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (!dialogRef.current?.contains(window.document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (taskProviderConfirm) {
          setTaskProviderConfirm(null);
        } else if (modelEditor) {
          setModelEditor(null);
        } else if (deleteConfirm) {
          setDeleteConfirm(false);
        } else if (providerEditor) {
          setProviderEditor(null);
        } else if (providerCreator) {
          setProviderCreator(null);
        } else {
          onClose?.();
        }
      }
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [deleteConfirm, embedded, modelEditor, onClose, open, providerCreator, providerEditor, taskProviderConfirm]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    bridge.setWindowModalOverlay?.(false);
    return () => {
      bridge.setWindowModalOverlay?.(false);
    };
  }, [open]);

  const runAction = useCallback(async (action, patch = {}) => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await action({
        provider: selectedProvider,
        modelId: selectedModel?.id,
        modelName: selectedModel?.name,
        model: selectedModel?.model,
        models: selectedDraft.models,
        baseUrl: getAiProviderSaveBaseUrl(selectedDraft),
        apiKey: apiKeys[selectedProvider] || "",
        resetTest: !selectedModel?.testedOk && !selectedModel?.testedAt,
        activate: false,
        ...patch,
      });
      setStatus({
        tone: result?.ok === false ? "warning" : "success",
        message: result?.message || "操作完成",
      });
      if (result && (result.provider || result.providers)) {
        const normalized = normalizePublicAiConfig(result);
        setDrafts(normalized.providers);
        setSelectedProvider((current) => (normalized.providers[current] ? current : normalized.activeProvider));
        setSelectedModelId((current) => {
          const providerConfig = normalized.providers[selectedProvider] || normalized.providers[normalized.activeProvider];
          return providerConfig?.models.some((model) => model.id === current) ? current : providerConfig?.activeModelId;
        });
        setApiKeys({});
      }
      return result;
    } catch (error) {
      setStatus({ tone: "warning", message: error?.message || "操作失败" });
      return null;
    } finally {
      setBusy(false);
    }
  }, [apiKeys, selectedDraft.baseUrl, selectedDraft.models, selectedModel?.id, selectedModel?.model, selectedModel?.name, selectedModel?.testedAt, selectedModel?.testedOk, selectedProvider]);

  const saveTaskModelAssignment = useCallback(async (taskId, modelKey, requestParamsOverride) => {
    const model = modelKey ? resolverModels.find((item) => item.id === modelKey) : null;
    if (modelKey && !model) return;
    const task = AI_TASK_MODEL_DEFINITIONS.find((item) => item.id === taskId);
    const currentAssignment = normalizedConfig.taskModels?.[taskId] || {};
    const requestParams = !model || model.transport === "codex-cli"
      ? {}
      : normalizeUiAiRequestParams(requestParamsOverride ?? currentAssignment.requestParams);
    setBusy(true);
    setStatus(null);
    try {
      const result = await onSave({
        taskModels: {
          [taskId]: model
            ? { providerId: model.provider, modelId: model.modelId, requestParams }
            : { providerId: "", modelId: "", requestParams: {} },
        },
      });
      const normalized = normalizePublicAiConfig(result);
      setDrafts(normalized.providers);
      const effectiveAssignment = normalized.taskModels?.[taskId] || {};
      const effectiveModelKey = effectiveAssignment.providerId && effectiveAssignment.modelId
        ? createAiModelKey(effectiveAssignment.providerId, effectiveAssignment.modelId)
        : createAiModelKey(normalized.activeProvider, normalized.activeModelId);
      const effectiveModel = resolverModels.find((item) => item.id === effectiveModelKey) || null;
      const effectiveTaskParams = effectiveModel
        ? aiTaskRequestParamsForEditor(
          effectiveModel.provider,
          effectiveModel.requestParams,
          effectiveAssignment.requestParams || {},
          effectiveModel.model,
        )
        : {};
      const editableTaskParams = taskId === "applyResolver"
        ? aiApplyResolverEditableRequestParams(effectiveModel?.provider, effectiveTaskParams)
        : effectiveTaskParams;
      setTaskParamDrafts((current) => ({
        ...current,
        [taskId]: requestParamsToRows(editableTaskParams),
      }));
      setStatus({
        tone: "success",
        message: model
          ? `${task?.label || "任务"}模型已更新`
          : `${task?.label || "任务"}已恢复跟随默认模型`,
      });
    } catch (error) {
      setStatus({ tone: "warning", message: error?.message || "任务模型保存失败" });
    } finally {
      setBusy(false);
    }
  }, [normalizedConfig.taskModels, onSave, resolverModels]);

  const requestTaskProviderChange = useCallback((taskId, providerId) => {
    const provider = resolverProviderGroups.find((item) => item.id === providerId);
    const model = provider?.models[0];
    if (!model) return;
    const assignment = normalizedConfig.taskModels?.[taskId] || {};
    const hasTaskOverrides = Object.keys(normalizeUiAiRequestParams(assignment.requestParams)).length > 0;
    if (assignment.providerId && assignment.providerId !== providerId && hasTaskOverrides) {
      setTaskProviderConfirm({ taskId, modelKey: model.id, providerLabel: provider.label });
      return;
    }
    saveTaskModelAssignment(taskId, model.id, assignment.providerId === providerId ? assignment.requestParams : {});
  }, [normalizedConfig.taskModels, resolverProviderGroups, saveTaskModelAssignment]);

  const confirmTaskProviderChange = useCallback(async () => {
    if (!taskProviderConfirm) return;
    const { taskId, modelKey } = taskProviderConfirm;
    setTaskProviderConfirm(null);
    setTaskParamDrafts((current) => ({ ...current, [taskId]: [] }));
    await saveTaskModelAssignment(taskId, modelKey, {});
  }, [saveTaskModelAssignment, taskProviderConfirm]);

  const saveTaskRequestParams = useCallback(async (taskId, assignedModel) => {
    if (!assignedModel || assignedModel.transport === "codex-cli") return;
    const rows = taskParamDrafts[taskId] || [];
    const parsed = parseAiRequestParamRows(rows, { providerId: assignedModel.provider });
    if (!parsed.valid) {
      setStatus({ tone: "warning", message: parsed.error || "请先修正请求参数" });
      return;
    }
    await saveTaskModelAssignment(taskId, assignedModel.id, parsed.requestParams);
  }, [saveTaskModelAssignment, taskParamDrafts]);

  const openBaseModelSettings = useCallback(() => {
    const provider = drafts[normalizedConfig.activeProvider]
      ? normalizedConfig.activeProvider
      : (Object.keys(drafts)[0] || "gemini");
    const providerDraft = drafts[provider] || normalizePublicAiProviderConfig(provider);
    setSelectedProvider(provider);
    setSelectedModelId(providerDraft.activeModelId || providerDraft.models[0]?.id || "");
    setActivePanel("provider");
    setStatus(null);
  }, [drafts, normalizedConfig.activeProvider]);

  const refreshCodex = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await onRefreshCodex();
      const normalized = normalizePublicAiConfig(result);
      setDrafts(normalized.providers);
      const codex = normalized.providers["codex-cli"];
      setSelectedModelId((current) => codex?.models.some((model) => model.id === current) ? current : codex?.activeModelId || "");
      setStatus({ tone: result?.ok ? "success" : "warning", message: result?.message || "Codex CLI 检查完成" });
      return result;
    } catch (error) {
      setStatus({ tone: "warning", message: error?.message || "Codex CLI 检查失败" });
      return null;
    } finally {
      setBusy(false);
    }
  }, [onRefreshCodex]);

  useEffect(() => {
    if (!open || !selectedIsCodex || selectedDraft.runtime?.checkedAt || selectedDraft.runtime?.browserOnly || codexAutoCheckRef.current) return;
    codexAutoCheckRef.current = true;
    refreshCodex();
  }, [open, refreshCodex, selectedDraft.runtime?.browserOnly, selectedDraft.runtime?.checkedAt, selectedIsCodex]);

  const loginCodex = useCallback(async () => {
    setBusy(true);
    try {
      const result = await onLoginCodex();
      setStatus({ tone: result?.ok ? "success" : "warning", message: result?.message || "已启动 Codex 登录" });
    } catch (error) {
      setStatus({ tone: "warning", message: error?.message || "无法启动 Codex 登录" });
    } finally {
      setBusy(false);
    }
  }, [onLoginCodex]);

  const saveModelReasoningEffort = useCallback(async (model, reasoningEffort) => {
    const models = selectedDraft.models.map((item) => item.id === model.id ? { ...item, reasoningEffort } : item);
    await runAction(onSave, { modelId: model.id, modelName: model.name, model: model.model, models, resetTest: false });
  }, [onSave, runAction, selectedDraft.models]);

  const openProviderEditor = useCallback(() => {
    setProviderEditor({
      providerLabel: selectedDraft.providerLabel,
      baseUrl: selectedDraft.baseUrl || selectedProviderOption.baseUrl,
      apiKey: "",
    });
  }, [selectedDraft.baseUrl, selectedProviderOption.baseUrl]);

  const saveProviderEditor = useCallback(async () => {
    if (!providerEditor) {
      return;
    }
    const baseUrl = providerEditor.baseUrl.trim() || selectedProviderOption.baseUrl;
    const baseUrlChanged = baseUrl !== selectedDraft.baseUrl;
    const models = baseUrlChanged
      ? selectedDraft.models.map((model) => ({ ...model, testedOk: false, testedAt: "", testMessage: "" }))
      : selectedDraft.models;
    const result = await runAction(onSave, {
      providerLabel: providerEditor.providerLabel,
      baseUrl,
      apiKey: providerEditor.apiKey,
      models,
      resetTest: baseUrlChanged,
    });
    if (result) {
      setProviderEditor(null);
    }
  }, [onSave, providerEditor, runAction, selectedDraft.baseUrl, selectedDraft.models, selectedProviderOption.baseUrl]);

  const openProviderCreator = useCallback(() => {
    setProviderCreator({ providerLabel: "", protocol: "openai", baseUrl: AI_PROTOCOL_OPTIONS[0].baseUrl, error: "" });
  }, []);

  const saveProviderCreator = useCallback(async () => {
    if (!providerCreator) return;
    const providerLabel = providerCreator.providerLabel.trim();
    const baseUrl = providerCreator.baseUrl.trim();
    if (!providerLabel || !baseUrl) {
      setProviderCreator((current) => ({ ...current, error: "请填写供应商名称和 Base URL" }));
      return;
    }
    setBusy(true);
    try {
      const result = await onCreateProvider({ providerLabel, protocol: providerCreator.protocol, baseUrl });
      const normalized = normalizePublicAiConfig(result);
      setDrafts(normalized.providers);
      const createdProvider = result?.createdProvider;
      if (createdProvider && normalized.providers[createdProvider]) {
        setActivePanel("provider");
        setSelectedProvider(createdProvider);
        setSelectedModelId("");
      }
      setStatus({ tone: "success", message: result?.message || "供应商已添加" });
      setProviderCreator(null);
    } catch (error) {
      setProviderCreator((current) => ({ ...current, error: error?.message || "添加供应商失败" }));
    } finally {
      setBusy(false);
    }
  }, [onCreateProvider, providerCreator]);

  const deleteSelectedProvider = useCallback(async () => {
    if (selectedDraft.builtin || normalizedConfig.activeProvider === selectedProvider) return;
    const affectedTasks = selectedProviderTaskLabels.join("、");
    setBusy(true);
    try {
      const result = await onDeleteProvider(selectedProvider);
      const normalized = normalizePublicAiConfig(result);
      setDrafts(normalized.providers);
      setSelectedProvider(normalized.activeProvider);
      setSelectedModelId(normalized.activeModelId);
      setStatus(affectedTasks
        ? { tone: "warning", message: `${affectedTasks}的任务模型已失效，请重新选择` }
        : { tone: "success", message: result?.message || "供应商已删除" });
      setDeleteConfirm(false);
    } catch (error) {
      setStatus({ tone: "warning", message: error?.message || "删除供应商失败" });
    } finally {
      setBusy(false);
    }
  }, [normalizedConfig.activeProvider, onDeleteProvider, selectedDraft.builtin, selectedProvider, selectedProviderTaskLabels]);

  const openAddModelEditor = useCallback(() => {
    const providerDraft = drafts[selectedProvider] || normalizePublicAiProviderConfig(selectedProvider);
    const nextIndex = providerDraft.models.length + 1;
    const defaults = getAiProviderDefaults(selectedProvider);
    setModelEditor({
      mode: "add",
      modelId: "",
      name: `模型 ${nextIndex}`,
      model: defaults.model,
      requestParamRows: requestParamsToRows(aiRequestParamsWithProviderDefaults(selectedProvider, {}, defaults.model)),
    });
  }, [drafts, selectedProvider]);

  const openEditModelEditor = useCallback((model) => {
    setSelectedModelId(model.id);
    setModelEditor({
      mode: "edit",
      modelId: model.id,
      name: model.name,
      model: model.model,
      requestParamRows: requestParamsToRows(aiRequestParamsWithProviderDefaults(selectedProvider, model.requestParams || {}, model.model)),
    });
  }, [selectedProvider]);

  const saveModelEditor = useCallback(async () => {
    if (!modelEditor) {
      return;
    }
    const providerDraft = drafts[selectedProvider] || normalizePublicAiProviderConfig(selectedProvider);
    const name = modelEditor.name.trim();
    const modelValue = modelEditor.model.trim();
    if (!name || !modelValue) {
      setStatus({ tone: "warning", message: "请填写模型名称和模型" });
      return;
    }
    const parsedParams = parseAiRequestParamRows(modelEditor.requestParamRows || [], { providerId: selectedProvider });
    if (!parsedParams.valid) {
      setStatus({ tone: "warning", message: parsedParams.error || "请先修正请求参数" });
      return;
    }
    const existingModel = modelEditor.mode === "edit"
      ? providerDraft.models.find((model) => model.id === modelEditor.modelId)
      : null;
    const requestParamsChanged = !existingModel || !aiRequestParamsEqual(existingModel.requestParams, parsedParams.requestParams);
    const modelChanged = !existingModel || existingModel.model !== modelValue || requestParamsChanged;
    const affectedTasks = modelChanged && existingModel
      ? AI_TASK_MODEL_DEFINITIONS.filter((task) => {
        const assignment = normalizedConfig.taskModels?.[task.id];
        return assignment?.providerId === selectedProvider && assignment?.modelId === existingModel.id;
      }).map((task) => task.label)
      : [];
    const nextModel = normalizePublicAiModelConfig(selectedProvider, {
      ...(existingModel || {}),
      id: existingModel?.id || `${selectedProvider}-custom-${Date.now().toString(36)}`,
      name,
      model: modelValue,
      requestParams: parsedParams.requestParams,
      testedOk: modelChanged ? false : existingModel?.testedOk,
      testedAt: modelChanged ? "" : existingModel?.testedAt,
      testMessage: modelChanged ? "" : existingModel?.testMessage,
    }, providerDraft.models.length);
    const models = existingModel
      ? providerDraft.models.map((model) => (model.id === existingModel.id ? nextModel : model))
      : [...providerDraft.models, nextModel];
    const result = await runAction(onSave, {
      modelId: nextModel.id,
      modelName: nextModel.name,
      model: nextModel.model,
      models,
      resetTest: modelChanged,
    });
    if (result) {
      setSelectedModelId(nextModel.id);
      setModelEditor(null);
      if (affectedTasks.length) {
        setStatus({ tone: "warning", message: `${affectedTasks.join("、")}的任务模型已失效，请重新测试或选择其他模型` });
      }
    }
  }, [drafts, modelEditor, normalizedConfig.taskModels, onSave, runAction, selectedProvider]);

  const removeModelDraft = useCallback(async (modelId) => {
    const providerDraft = drafts[selectedProvider] || normalizePublicAiProviderConfig(selectedProvider);
    if (providerDraft.models.length <= 1 && (providerDraft.builtin || normalizedConfig.activeProvider === selectedProvider)) {
      setStatus({ tone: "warning", message: "至少保留一个模型" });
      return;
    }
    const nextModels = providerDraft.models.filter((model) => model.id !== modelId);
    const nextActiveModelId = providerDraft.activeModelId === modelId
      ? (nextModels[0]?.id || "")
      : providerDraft.activeModelId;
    const nextSelectedModel = nextModels.find((model) => model.id === nextActiveModelId) || nextModels[0];
    const affectedTasks = AI_TASK_MODEL_DEFINITIONS.filter((task) => {
      const assignment = normalizedConfig.taskModels?.[task.id];
      return assignment?.providerId === selectedProvider && assignment?.modelId === modelId;
    }).map((task) => task.label);
    setDrafts((previous) => ({
      ...previous,
      [selectedProvider]: {
        ...(previous[selectedProvider] || providerDraft),
        activeModelId: nextActiveModelId,
        models: nextModels,
      },
    }));
    setSelectedModelId(nextSelectedModel?.id || "");
    const result = await runAction(onSave, {
      modelId: nextSelectedModel?.id || "",
      modelName: nextSelectedModel?.name || "",
      model: nextSelectedModel?.model || "",
      models: nextModels,
      resetTest: false,
      activate: normalizedConfig.activeProvider === selectedProvider && providerDraft.activeModelId === modelId,
    });
    if (result && affectedTasks.length) {
      setStatus({ tone: "warning", message: `${affectedTasks.join("、")}的任务模型已失效，请在“任务模型”中重新选择` });
    }
  }, [drafts, normalizedConfig.activeProvider, normalizedConfig.taskModels, onSave, runAction, selectedProvider]);

  const setDefaultModel = useCallback(async (model) => {
    setSelectedModelId(model.id);
    await runAction(onSave, {
      modelId: model.id,
      modelName: model.name,
      model: model.model,
      resetTest: false,
      activate: true,
    });
  }, [onSave, runAction]);

  const testModel = useCallback(async (model) => {
    setSelectedModelId(model.id);
    await runAction(onTest, {
      modelId: model.id,
      modelName: model.name,
      model: model.model,
    });
  }, [onTest, runAction]);

  if (!open) {
    return null;
  }

  return (
    <div className={embedded ? "ai-settings-embed" : "ai-settings-overlay dialog-scrim dialog-scrim--large"} role="presentation" onMouseDown={embedded ? undefined : onClose}>
      <section
        ref={dialogRef}
        className={embedded ? "ai-settings-dialog settings-embedded" : "ai-settings-dialog"}
        role={embedded ? "region" : "dialog"}
        aria-modal={embedded ? undefined : "true"}
        aria-labelledby="ai-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {!embedded ? (
          <button ref={closeButtonRef} type="button" className="ai-settings-close" onClick={onClose} aria-label="关闭 AI 设置" title="关闭">
            <X size={24} strokeWidth={2.6} />
          </button>
        ) : null}
        <AiProviderSidebar
          activePanel={activePanel}
          busy={busy}
          drafts={drafts}
          normalizedConfig={normalizedConfig}
          openProviderCreator={openProviderCreator}
          providerOptions={providerOptions}
          selectedProvider={selectedProvider}
          setActivePanel={setActivePanel}
          setSelectedModelId={setSelectedModelId}
          setSelectedProvider={setSelectedProvider}
          setStatus={setStatus}
          taskModelNavLabel={taskModelNavLabel}
          taskModelNavTone={taskModelNavTone}
        />
        {activePanel === "tasks" ? (
          <AiTaskModelsPanel
            busy={busy}
            defaultResolverModelKey={defaultResolverModelKey}
            expandedTaskIds={expandedTaskIds}
            focusTaskId={taskFocusRequestId}
            normalizedConfig={normalizedConfig}
            onTaskFocusHandled={handleTaskFocusHandled}
            openBaseModelSettings={openBaseModelSettings}
            requestTaskProviderChange={requestTaskProviderChange}
            resolverModels={resolverModels}
            resolverProviderGroups={resolverProviderGroups}
            saveTaskModelAssignment={saveTaskModelAssignment}
            saveTaskRequestParams={saveTaskRequestParams}
            setExpandedTaskIds={setExpandedTaskIds}
            setTaskParamDrafts={setTaskParamDrafts}
            status={status}
            taskParamDrafts={taskParamDrafts}
          />
        ) : (
        <AiProviderPanel
          busy={busy}
          loginCodex={loginCodex}
          normalizedConfig={normalizedConfig}
          onSave={onSave}
          openAddModelEditor={openAddModelEditor}
          openEditModelEditor={openEditModelEditor}
          openProviderEditor={openProviderEditor}
          refreshCodex={refreshCodex}
          removeModelDraft={removeModelDraft}
          runAction={runAction}
          saveModelReasoningEffort={saveModelReasoningEffort}
          selectedConnection={selectedConnection}
          selectedDraft={selectedDraft}
          selectedIsCodex={selectedIsCodex}
          selectedIsDefault={selectedIsDefault}
          selectedLastUpdated={selectedLastUpdated}
          selectedModel={selectedModel}
          selectedProvider={selectedProvider}
          selectedProviderIcon={selectedProviderIcon}
          status={status}
          setDefaultModel={setDefaultModel}
          setDeleteConfirm={setDeleteConfirm}
          setSelectedModelId={setSelectedModelId}
          testModel={testModel}
        />
        )}
        {providerCreator ? (
          <div className="ai-settings-subdialog-backdrop dialog-scrim" role="presentation" onMouseDown={() => setProviderCreator(null)}>
            <section className="ai-settings-subdialog" role="dialog" aria-modal="true" aria-label="添加供应商" onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <h3>添加供应商</h3>
                <button type="button" onClick={() => setProviderCreator(null)} aria-label="关闭"><X size={16} /></button>
              </header>
              <label>
                <span>供应商名称</span>
                <input autoFocus value={providerCreator.providerLabel} onChange={(event) => setProviderCreator((current) => ({ ...current, providerLabel: event.target.value, error: "" }))} placeholder="例如：公司网关" />
              </label>
              <fieldset className="ai-provider-protocol-fieldset">
                <legend>接口协议</legend>
                <div>
                  {AI_PROTOCOL_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={providerCreator.protocol === option.id ? "selected" : ""}
                      aria-pressed={providerCreator.protocol === option.id}
                      onClick={() => setProviderCreator((current) => ({ ...current, protocol: option.id, baseUrl: option.baseUrl, error: "" }))}
                    >
                      <strong>{option.label}</strong><span>{option.description}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <label>
                <span>Base URL</span>
                <input value={providerCreator.baseUrl} onChange={(event) => setProviderCreator((current) => ({ ...current, baseUrl: event.target.value, error: "" }))} spellCheck={false} />
                <small>填写接口根地址，不含 /chat/completions 或 /messages</small>
              </label>
              {providerCreator.error ? <p className="ai-provider-form-error" role="alert">{providerCreator.error}</p> : null}
              <footer>
                <span />
                <div>
                  <button type="button" onClick={() => setProviderCreator(null)}>取消</button>
                  <button type="button" className="primary" disabled={busy} onClick={saveProviderCreator}>{busy ? "添加中…" : "添加"}</button>
                </div>
              </footer>
            </section>
          </div>
        ) : null}
        {providerEditor ? (
          <div className="ai-settings-subdialog-backdrop dialog-scrim" role="presentation" onMouseDown={() => setProviderEditor(null)}>
            <section className="ai-settings-subdialog" role="dialog" aria-modal="true" aria-label="编辑供应商" onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <h3>编辑供应商</h3>
                <button type="button" onClick={() => setProviderEditor(null)} aria-label="关闭">
                  <X size={16} />
                </button>
              </header>
              <label>
                <span>供应商名称</span>
                <input value={providerEditor.providerLabel} disabled={selectedDraft.builtin} onChange={(event) => setProviderEditor((current) => ({ ...current, providerLabel: event.target.value }))} />
              </label>
              <label>
                <span>接口协议</span>
                <input value={AI_PROTOCOL_OPTIONS.find((option) => option.id === selectedDraft.protocol)?.label || "OpenAI 兼容"} disabled />
              </label>
              <label>
                <span>Base URL</span>
                <input value={providerEditor.baseUrl} onChange={(event) => setProviderEditor((current) => ({ ...current, baseUrl: event.target.value }))} spellCheck={false} />
              </label>
              <label>
                <span>API Key</span>
                <input
                  type="password"
                  value={providerEditor.apiKey}
                  onChange={(event) => setProviderEditor((current) => ({ ...current, apiKey: event.target.value }))}
                  placeholder={selectedDraft.hasApiKey ? `已保存，尾号 ${selectedDraft.apiKeyLast4 || "****"}；留空则不修改` : "粘贴 API Key"}
                  spellCheck={false}
                />
              </label>
              <footer>
                <button type="button" className="ghost" disabled={busy || !selectedDraft.hasApiKey} onClick={() => runAction(() => onClear({
                  provider: selectedProvider,
                  modelId: selectedModel?.id,
                  modelName: selectedModel?.name,
                  model: selectedModel?.model,
                  baseUrl: selectedDraft.baseUrl,
                  clearApiKey: true,
                })).then((result) => {
                  if (result) {
                    setProviderEditor(null);
                  }
                })}>
                  清空密钥
                </button>
                <div>
                  <button type="button" onClick={() => setProviderEditor(null)}>取消</button>
                  <button type="button" className="primary" disabled={busy} onClick={saveProviderEditor}>保存</button>
                </div>
              </footer>
            </section>
          </div>
        ) : null}
        {deleteConfirm ? (
          <div className="ai-settings-subdialog-backdrop dialog-scrim" role="presentation" onMouseDown={() => setDeleteConfirm(false)}>
            <section className="ai-settings-subdialog ai-provider-delete-dialog" role="alertdialog" aria-modal="true" aria-label="删除供应商" onMouseDown={(event) => event.stopPropagation()}>
              <header><h3>删除供应商</h3><button type="button" onClick={() => setDeleteConfirm(false)} aria-label="关闭"><X size={16} /></button></header>
              <p>
                确定删除“{selectedDraft.providerLabel}”吗？保存的 API Key 和模型配置也会一并删除，此操作无法撤销。
                {selectedProviderTaskLabels.length ? ` 删除后，“${selectedProviderTaskLabels.join("、")}”需要重新选择任务模型。` : ""}
              </p>
              <footer><span /><div><button type="button" onClick={() => setDeleteConfirm(false)}>取消</button><button type="button" className="danger-solid" disabled={busy} onClick={deleteSelectedProvider}>{busy ? "删除中…" : "删除"}</button></div></footer>
            </section>
          </div>
        ) : null}
        {taskProviderConfirm ? (
          <div className="ai-settings-subdialog-backdrop dialog-scrim" role="presentation" onMouseDown={() => setTaskProviderConfirm(null)}>
            <section className="ai-settings-subdialog ai-provider-delete-dialog" role="alertdialog" aria-modal="true" aria-label="切换任务供应商" onMouseDown={(event) => event.stopPropagation()}>
              <header><h3>切换任务供应商</h3><button type="button" onClick={() => setTaskProviderConfirm(null)} aria-label="关闭"><X size={16} /></button></header>
              <p>任务请求参数通常与供应商协议绑定。切换到“{taskProviderConfirm.providerLabel}”后，当前任务参数将被清空。</p>
              <footer><span /><div><button type="button" onClick={() => setTaskProviderConfirm(null)}>取消</button><button type="button" className="primary" disabled={busy} onClick={confirmTaskProviderChange}>清空并切换</button></div></footer>
            </section>
          </div>
        ) : null}
        {modelEditor ? (
          <div className="ai-settings-subdialog-backdrop dialog-scrim" role="presentation" onMouseDown={() => setModelEditor(null)}>
            <section className="ai-settings-subdialog ai-model-editor-dialog" role="dialog" aria-modal="true" aria-label={modelEditor.mode === "add" ? "添加模型" : "编辑模型"} onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <h3>{modelEditor.mode === "add" ? "添加模型" : "编辑模型"}</h3>
                <button type="button" onClick={() => setModelEditor(null)} aria-label="关闭">
                  <X size={16} />
                </button>
              </header>
              <label>
                <span>模型名称</span>
                <input value={modelEditor.name} onChange={(event) => setModelEditor((current) => ({ ...current, name: event.target.value }))} spellCheck={false} />
              </label>
              <label>
                <span>模型</span>
                <input value={modelEditor.model} onChange={(event) => setModelEditor((current) => ({ ...current, model: event.target.value }))} spellCheck={false} />
              </label>
              {modelEditorCapabilities ? (
                <div className="ai-model-capabilities">
                  <div className="ai-model-capabilities-title">
                    <strong>模型能力</strong>
                    <AppInfoTooltip
                      id="ai-model-capabilities-tip"
                      label="查看模型能力说明"
                      text="这些是只读模型能力，只用于帮助判断模型容量，不会作为请求参数发送。"
                    />
                  </div>
                  <div className="ai-model-capabilities-fields">
                    <label>
                      <span>context_window</span>
                      <input value={modelEditorCapabilities.contextWindow.toLocaleString("en-US")} readOnly />
                    </label>
                    <label>
                      <span>max_output_tokens</span>
                      <input value={modelEditorCapabilities.maxOutputTokens.toLocaleString("en-US")} readOnly />
                    </label>
                  </div>
                </div>
              ) : null}
              <AiRequestParamsEditor
                rows={modelEditor.requestParamRows || []}
                providerId={selectedProvider}
                disabled={busy}
                flat
                title="请求参数"
                description=""
                onChange={(requestParamRows) => setModelEditor((current) => ({ ...current, requestParamRows }))}
              />
              <footer>
                <span />
                <div>
                  <button type="button" onClick={() => setModelEditor(null)}>取消</button>
                  <button type="button" className="primary" disabled={busy} onClick={saveModelEditor}>保存</button>
                </div>
              </footer>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}
