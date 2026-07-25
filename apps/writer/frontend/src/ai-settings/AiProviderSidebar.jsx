import {
  Bot,
  Plus,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import {
  getAiProviderConnectionMeta,
  normalizePublicAiProviderConfig,
} from "./model.js";
import { AI_PROVIDER_ICON_ASSETS } from "./provider-icons.js";

export function AiProviderSidebar({
  activePanel,
  busy,
  drafts,
  normalizedConfig,
  openProviderCreator,
  providerOptions,
  selectedProvider,
  setActivePanel,
  setSelectedModelId,
  setSelectedProvider,
  setStatus,
  taskModelNavLabel,
  taskModelNavTone,
}) {
  return (
    <aside className="ai-settings-sidebar">
      <div className="ai-provider-list-head">
        <strong>基础模型</strong>
        <button type="button" onClick={openProviderCreator} disabled={busy} title="添加供应商">
          <Plus size={15} />
          <span>添加供应商</span>
        </button>
      </div>
      <div className="ai-provider-list" aria-label="AI 服务商">
        {providerOptions.map((option) => {
          const providerConfig = drafts[option.id] || normalizePublicAiProviderConfig(option.id);
          const meta = getAiProviderConnectionMeta(providerConfig);
          const isSelected = selectedProvider === option.id;
          const providerIconSrc = AI_PROVIDER_ICON_ASSETS[option.id];
          return (
            <button
              key={option.id}
              type="button"
              className={[
                "ai-provider-card",
                activePanel === "provider" && isSelected ? "selected" : "",
                meta.tone,
              ].filter(Boolean).join(" ")}
              onClick={() => {
                setActivePanel("provider");
                setStatus(null);
                setSelectedProvider(option.id);
                setSelectedModelId((drafts[option.id] || normalizePublicAiProviderConfig(option.id)).activeModelId);
              }}
            >
              <span className="ai-provider-icon">
                {providerIconSrc ? <img src={providerIconSrc} alt="" aria-hidden="true" /> : (option.transport === "codex-cli" ? <SquareTerminal size={22} aria-hidden="true" /> : <Sparkles size={22} aria-hidden="true" />)}
                {normalizedConfig.activeProvider === option.id ? <span className="ai-provider-default-pill">默</span> : null}
              </span>
              <span className="ai-provider-main">
                <strong>{option.label}</strong>
                <em>{providerConfig.transport === "codex-cli" ? "本地 Codex CLI" : providerConfig.baseUrl}</em>
              </span>
              <span className={`ai-status-pill ${meta.tone}`}>{meta.shortLabel}</span>
            </button>
          );
        })}
      </div>
      <div className="ai-task-model-nav-wrap">
        <button
          type="button"
          className={activePanel === "tasks" ? "ai-task-model-nav selected" : "ai-task-model-nav"}
          aria-current={activePanel === "tasks" ? "page" : undefined}
          onClick={() => {
            setActivePanel("tasks");
            setStatus(null);
          }}
        >
          <span className="ai-task-model-nav-icon"><Bot size={21} aria-hidden="true" /></span>
          <span className="ai-task-model-nav-copy">
            <strong>任务模型</strong>
            <em>为内置任务指定模型</em>
          </span>
          <span className={`ai-status-pill ${taskModelNavTone}`}>{taskModelNavLabel}</span>
        </button>
      </div>
    </aside>
  );
}
