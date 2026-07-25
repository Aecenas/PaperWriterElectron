import { useEditorState } from "@tiptap/react";
import {
  Download,
  SeparatorHorizontal,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import {
  getPaperDerivedState,
  insertFinalizedBreak,
  removeFinalizedBreak,
} from "../editor/index.js";
import { AiProviderRunSelector, CodexScopeSelector } from "./Selectors.jsx";


export function AiOptimizeToolbar({
  status,
  hasResult,
  editor,
  savedSelectionRef,
  availableProviders = [],
  selectedProvider,
  onProviderChange,
  onStart,
  onStop,
  onClear,
}) {
  const finalizedBreakInserted = Boolean(useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getPaperDerivedState(activeEditor).hasFinalizedBreak,
  }));
  const isStreaming = status === "streaming";
  const hasUsableProvider = availableProviders.length > 0;
  const selectedRunModel = availableProviders.find((provider) => provider.id === selectedProvider) || availableProviders[0];
  const runModelLabel = selectedRunModel
    ? `${selectedRunModel.providerLabel || "AI"} · ${selectedRunModel.modelName || selectedRunModel.model || "未选择模型"}`
    : "未选择模型";

  return (
    <div className="ai-result-toolbar">
      <div className="ai-result-model-line">
        <p>{runModelLabel}</p>
        <AiProviderRunSelector providers={availableProviders} value={selectedProvider} disabled={isStreaming} onChange={onProviderChange} />
      </div>
      <div className="ai-result-actions">
        <button type="button" disabled={!hasResult || isStreaming} onClick={onClear}>
          <Trash2 size={13} />
          <span>清空</span>
        </button>
        {!isStreaming ? (
          <>
            <button
              type="button"
              title={finalizedBreakInserted ? "清空定稿线" : "插入定稿线"}
              onClick={() => finalizedBreakInserted
                ? removeFinalizedBreak(editor)
                : insertFinalizedBreak(editor, savedSelectionRef)}
            >
              <SeparatorHorizontal size={13} />
              <span>{finalizedBreakInserted ? "清空定稿线" : "插入定稿线"}</span>
            </button>
            <button
              type="button"
              className="primary"
              disabled={!hasUsableProvider}
              title={hasUsableProvider ? (hasResult ? "重新优化" : "开始优化") : "请先配置模型"}
              onClick={onStart}
            >
              <Sparkles size={13} />
              <span>{hasResult ? "重新优化" : "开始优化"}</span>
            </button>
          </>
        ) : null}
        {isStreaming ? (
          <button type="button" onClick={onStop}>
            <Square size={13} />
            <span>停止</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AiChatToolbar({
  editor,
  availableProviders = [],
  selectedProvider,
  status,
  messages = [],
  hasState = false,
  codexImageMode,
  onProviderChange,
  onCodexImageModeChange,
  onStop,
  onClear,
  onExport,
}) {
  const imageCount = useEditorState({
    editor,
    selector: ({ editor: activeEditor }) => getPaperDerivedState(activeEditor).imageCount,
  }) || 0;
  const isStreaming = status === "streaming";
  const selectedRunModel = availableProviders.find((provider) => provider.id === selectedProvider) || availableProviders[0];
  const runModelLabel = selectedRunModel
    ? `${selectedRunModel.providerLabel || "AI"} · ${selectedRunModel.modelName || selectedRunModel.model || "未选择模型"}`
    : "未选择模型";

  return (
    <div className="ai-result-toolbar ai-chat-toolbar">
      <div className="ai-result-model-line">
        <p>{runModelLabel}</p>
        <AiProviderRunSelector providers={availableProviders} value={selectedProvider} disabled={isStreaming} onChange={onProviderChange} />
        {selectedRunModel?.transport === "codex-cli" ? (
          <CodexScopeSelector
            imageMode={codexImageMode}
            imageCount={imageCount}
            disabled={isStreaming}
            onImageModeChange={onCodexImageModeChange}
          />
        ) : null}
      </div>
      <div className="ai-result-actions">
        <button type="button" disabled={!messages.length || isStreaming} onClick={onExport}>
          <Download size={13} />
          <span>另存记录</span>
        </button>
        <button type="button" disabled={!hasState || isStreaming} onClick={onClear}>
          <Trash2 size={13} />
          <span>清空</span>
        </button>
        {isStreaming ? (
          <button type="button" className="danger" onClick={onStop}>
            <Square size={13} />
            <span>停止</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
