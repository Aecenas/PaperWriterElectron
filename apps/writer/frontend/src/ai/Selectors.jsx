import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  FileText,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { AI_PROVIDER_OPTIONS } from "../ai-settings/model.js";
import { groupTestedAiProviders } from "../ai-provider-selector.js";
import { normalizeCodexImageMode } from "../codex-scope.js";
import { AI_ASSETS } from "./assets.js";


export function AiProviderRunSelector({ providers, value, disabled = false, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeProviderId, setActiveProviderId] = useState("");
  const current = providers.find((provider) => provider.id === value) || providers[0];
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event) => {
      if (
        !(event.target instanceof Element) ||
        (!event.target.closest(".ai-provider-switch") && !event.target.closest(".ai-provider-switch-modal"))
      ) {
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
  useEffect(() => {
    if (open && current?.provider) {
      setActiveProviderId(current.provider);
    }
  }, [current?.provider, open]);

  if (!providers.length) {
    return <span className="ai-provider-run-empty">没有已测试可用的模型</span>;
  }
  const groupedProviders = groupTestedAiProviders(providers, AI_PROVIDER_OPTIONS);
  const selectedProviderGroup = groupedProviders.find((provider) => provider.id === (activeProviderId || current?.provider)) || groupedProviders[0];
  const modelSwitchModal = open
    ? createPortal(
        <div className="ai-provider-switch-modal-backdrop dialog-scrim" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="ai-provider-switch-modal" role="dialog" aria-modal="true" aria-label="选择模型" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <strong>选择模型</strong>
              <span>仅显示已测试可用的模型</span>
            </header>
            <div className="ai-provider-switch-modal-body">
              <aside className="ai-provider-switch-providers" aria-label="供应商">
                {groupedProviders.map((provider) => {

                  const isSelectedProvider = provider.id === selectedProviderGroup?.id;
                  const hasCurrentModel = provider.models.some((model) => model.id === current?.id);
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      className={[
                        "ai-provider-switch-provider-item",
                        isSelectedProvider ? "selected" : "",
                        hasCurrentModel ? "current" : "",
                      ].filter(Boolean).join(" ")}
                      aria-pressed={isSelectedProvider}
                      onClick={() => setActiveProviderId(provider.id)}
                    >
                      <span className="ai-provider-switch-provider-main">
                        <span className="ai-provider-switch-icon">
                          {AI_ASSETS[provider.id]
                            ? <img src={AI_ASSETS[provider.id]} alt="" aria-hidden="true" />
                            : (provider.transport === "codex-cli" ? <SquareTerminal size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />)}
                        </span>
                        <span>
                          <strong>{provider.label}</strong>
                          <em>{provider.transport === "codex-cli" ? "本地 Codex CLI" : (provider.protocol === "anthropic" ? "Anthropic 原生" : "OpenAI 兼容")} · {provider.models.length} 个可用模型</em>
                        </span>
                      </span>
                      {hasCurrentModel ? <Check size={14} /> : null}
                    </button>
                  );
                })}
              </aside>
              <section className="ai-provider-switch-models">
                <p>
                  {selectedProviderGroup ? (
                    <>
                      <span className="ai-provider-switch-icon">
                        {AI_ASSETS[selectedProviderGroup.id]
                          ? <img src={AI_ASSETS[selectedProviderGroup.id]} alt="" aria-hidden="true" />
                          : (selectedProviderGroup.transport === "codex-cli" ? <SquareTerminal size={18} aria-hidden="true" /> : <Sparkles size={18} aria-hidden="true" />)}
                      </span>
                      <span>{selectedProviderGroup.label}</span>
                    </>
                  ) : null}
                </p>
                <div className="ai-provider-switch-model-list">
                  {selectedProviderGroup?.models.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={model.id === current?.id ? "ai-provider-switch-model-item selected" : "ai-provider-switch-model-item"}
                      aria-pressed={model.id === current?.id}

                      onClick={() => {
                        onChange?.(model.id);
                        setOpen(false);
                      }}
                    >
                      <span>
                        <strong>{model.modelName}</strong>
                        <em>{model.model}</em>
                      </span>
                      {model.id === current?.id ? <Check size={14} /> : null}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </section>
        </div>,
        window.document.body,
      )
    : null;

  return (
    <div className={open ? "ai-provider-switch open" : "ai-provider-switch"}>
      <button
        type="button"
        className="ai-provider-switch-button"
        disabled={disabled}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span>切换模型</span>
      </button>
      {modelSwitchModal}
    </div>
  );
}

export function CodexScopeSelector({ imageMode, imageCount = 0, disabled = false, onImageModeChange }) {
  const normalizedImageMode = normalizeCodexImageMode(imageMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);

        triggerRef.current?.focus();
      }
    };
    window.document.addEventListener("pointerdown", handlePointerDown, true);
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.document.removeEventListener("pointerdown", handlePointerDown, true);
      window.document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [menuOpen]);

  return (
    <div ref={rootRef} className={menuOpen ? "codex-scope-switch open" : "codex-scope-switch"}>
      <button ref={triggerRef} type="button" className="codex-scope-switch-button" disabled={disabled} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)} title="Codex 已隔离为仅可读取当前信笺">
        <FileText size={14} />
        <span>仅当前信笺（隔离）</span>
        <ChevronDown size={13} />
      </button>
      {menuOpen ? (
        <div className="codex-scope-menu" role="menu" aria-label="Codex 信笺设置">
          <button type="button" className="codex-scope-fixed" role="menuitem" aria-disabled="true" disabled>
            <span><strong>仅当前信笺（隔离）</strong><em>无法读取信笺目录、工作区或其他本地文件</em></span>
            <Check size={14} />
          </button>
          <div className="codex-scope-menu-divider" role="separator" />
          <button
            type="button"
            className="codex-image-mode-option"
            role="menuitemcheckbox"
            aria-checked={normalizedImageMode === "original"}
            disabled={!imageCount}
            onClick={() => onImageModeChange?.(normalizedImageMode === "original" ? "caption-only" : "original")}
          >
            <span>
              <strong>信笺图片</strong>
              <em>{imageCount
                ? (normalizedImageMode === "original" ? `附加全部原图（${imageCount} 张）` : `仅发送图号和标题（${imageCount} 张）`)
                : "当前信笺无图片可附加"}</em>
            </span>
            <span className="codex-image-mode-switch" aria-hidden="true"><i /></span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
