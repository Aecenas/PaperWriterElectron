import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  LoaderCircle,
  Send,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { PageArticle, getPaperPresentation } from "../editor/index.js";
import { DEFAULT_LETTER_TEMPLATES } from "../templates/model.js";
import { AI_ASSETS } from "./assets.js";
import {
  AI_CHAT_PROMPT_PRESETS,
  AI_FIXED_LETTER_TEMPLATE_ID,
} from "./constants.js";
import {
  formatChatMessageTime,
  summarizeChatMessage,
  summarizeSelectedText,
} from "./context.js";
import { parseAiResponseBlocks } from "./markdown.js";
import {
  AiChatAssistantContent,
  AiResultBlock,
  InlineAiText,
} from "./ResultBlocks.jsx";
import { formatElapsedSeconds, formatTokenUsage } from "./usage.js";
import { CollaborationReviewCard } from "../ai-collaboration/CollaborationReviewCard.jsx";


export function getAiPaperPresentation() {
  const fixedTemplate = DEFAULT_LETTER_TEMPLATES.find((template) => template.id === AI_FIXED_LETTER_TEMPLATE_ID) || DEFAULT_LETTER_TEMPLATES[0];
  return getPaperPresentation({
    letterTemplateId: fixedTemplate.id,
    templateId: fixedTemplate.paperId,
    customBackground: "",
  }, DEFAULT_LETTER_TEMPLATES);
}


export function AiResultPane({
  document,
  letterTemplates,
  output,
  status,
  error,
  assets,
  elapsedSeconds,
  tokenStats,
  onCopyBlock,
  onApplyBlock,
  applyingBlockIndex,
  previewingBlockIndex = -1,
  manualFallbackBlockIndexes = [],
  resolverLabel,
}) {
  const { selectedTemplate, paperStyle } = useMemo(() => getAiPaperPresentation(), []);
  const blocks = useMemo(() => parseAiResponseBlocks(output, assets), [assets, output]);
  const isStreaming = status === "streaming";
  const isPreparing = status === "ready";
  const tokenValue = tokenStats?.totalTokens
    ? formatTokenUsage(tokenStats.totalTokens, tokenStats?.estimated, tokenStats?.cachedTokens)
    : (isPreparing ? "待开始" : "等待统计");

  return (
    <main className="canvas ai-result-canvas" style={paperStyle}>
      <div className="paper-viewport ai-result-viewport">
        <PageArticle
          document={document}
          selectedTemplate={selectedTemplate}
          paperStyle={paperStyle}
          className="ai-result-sheet"
          customHeaderLayout
        >
          <header className="paper-header ai-result-header">
            <h1>AI优化结果</h1>
            <p className="ai-result-subtitle">耗时：{formatElapsedSeconds(elapsedSeconds)} ；Token消耗：{tokenValue}</p>
          </header>
          <div className="paper-editor ai-result-body">
            {isStreaming && !blocks.length && !error ? <p className="ai-result-loading">AI优化中…</p> : null}
            {error ? <p className="ai-result-error">{error}</p> : null}
            {isPreparing && !error ? (
              <p className="ai-result-placeholder">在左侧原文插入一根“定稿线”，线以上全部作为已定稿背景，不会要求 AI 改写；线以下是本次优化重点。准备好后点击“开始优化”。</p>
            ) : null}
            {!error && !blocks.length && !isPreparing ? (
              isStreaming ? null : <p className="ai-result-placeholder">AI 优化结果会显示在这里。</p>
            ) : null}
            {blocks.map((block, index) => (
              <AiResultBlock
                key={`${block.type}-${index}-${block.text || block.caption || block.number}`}

                block={block}
                onCopy={onCopyBlock}
                onApply={(selectedBlock) => onApplyBlock(selectedBlock, index, blocks)}
                applying={applyingBlockIndex === index}
                previewing={previewingBlockIndex === index}
                manualFallback={manualFallbackBlockIndexes.includes(index)}
                resolverLabel={resolverLabel}
              />
            ))}
          </div>
        </PageArticle>
      </div>
    </main>
  );
}

export function AiChatPane({
  availableProviders = [],
  document,
  letterTemplates,
  messages,
  input,
  selectedTexts = [],
  status,
  error,
  collaborationBusy = false,
  collaborationFrozen = false,
  collaborationPendingQuestion = "",
  collaborationStartedAt = 0,
  collaborationStatusText = "",
  pendingReview = null,
  onAcceptAllPendingCollaboration,
  onCommitCollaboration,
  onDiscardCollaboration,
  onRegenerateCollaboration,
  onInputChange,
  onSend,
  onRemoveSelectedText,
  onJumpSelectedText,
  onPresetSelect,
}) {
  const messagesRef = useRef(null);
  const [collapsedMessageIds, setCollapsedMessageIds] = useState(() => new Set());
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [collaborationClock, setCollaborationClock] = useState(() => Date.now());
  const { paperStyle } = useMemo(() => getAiPaperPresentation(), []);
  const isStreaming = status === "streaming";
  const hasUsableProvider = availableProviders.length > 0;
  const inputDisabled = isStreaming || collaborationBusy || collaborationFrozen;
  const canSend = Boolean(input.trim()) && !inputDisabled && hasUsableProvider;
  const collaborationElapsedSeconds = collaborationStartedAt
    ? Math.max(0, (collaborationClock - collaborationStartedAt) / 1000)
    : 0;
  const collaborationStageHint = /等待 AI|接收|请求一次格式修复|请求一次安全修复/.test(collaborationStatusText)
    ? "当前正在等待模型接口；模型返回后，本地检查通常只需很短时间。"
    : /本地检查|正在检查|正在整理|安全忽略/.test(collaborationStatusText)
      ? "模型内容已经返回，正在本地整理和安全校验。"
      : "你可以随时停止；明确的修改请求会直接进入方案生成。";

  useEffect(() => {
    if (!collaborationBusy || !collaborationStartedAt) return undefined;
    const updateClock = () => setCollaborationClock(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, [collaborationBusy, collaborationStartedAt]);

  const toggleMessageCollapsed = useCallback((messageId) => {
    setCollapsedMessageIds((previous) => {
      const next = new Set(previous);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);


  useEffect(() => {
    const scroller = messagesRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [messages, status]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  }, [canSend, onSend]);

  return (
    <main className="canvas ai-chat-canvas" style={paperStyle}>
      <section className="ai-chat-panel">
        <div ref={messagesRef} className="ai-chat-messages">
          {!messages.length && !collaborationPendingQuestion ? (
            <div className="ai-chat-empty">
              <div className="ai-chat-empty-icon" aria-hidden="true">
                <img src={AI_ASSETS.aiEmptyMark} alt="" />
              </div>
              <strong>围绕当前信笺协作</strong>
              <p>可以提问，也可以让 AI 生成逐项审阅的修改。提交前不会改动正文。</p>
            </div>
          ) : null}
          {messages.map((message) => {
            const isAssistant = message.role === "assistant";
            const collapsed = isAssistant && collapsedMessageIds.has(message.id);
            const isThinking = isAssistant && message.status === "streaming" && !message.content;
            return (
              <article key={message.id} className={`ai-chat-message ${message.role} ${message.status || ""} ${collapsed ? "collapsed" : ""}`}>
                <header className="ai-chat-message-head">
                  <span className="ai-chat-message-role">
                    {isAssistant ? (
                      <button type="button" className="ai-chat-answer-toggle" onClick={() => toggleMessageCollapsed(message.id)} aria-label={collapsed ? "展开回答" : "折叠回答"} title={collapsed ? "展开回答" : "折叠回答"}>
                        <ChevronDown size={15} />
                      </button>
                    ) : null}
                    {isAssistant ? <Sparkles size={16} /> : <UserRound size={15} />}
                    <strong>{message.role === "user" ? "你" : "AI 协作"}</strong>
                    {isAssistant ? (
                      <span className="ai-chat-message-meta inline">
                        <em>耗时：{formatElapsedSeconds(message.elapsedSeconds || 0)}</em>
                        <em>Token：{formatTokenUsage(message.usage, message.usageEstimated, message.cachedTokens)}</em>
                      </span>

                    ) : null}
                  </span>
                  <span className="ai-chat-message-meta">
                    {isAssistant ? (
                      null
                    ) : (
                      <em>{formatChatMessageTime(message)}</em>
                    )}
                  </span>
                </header>
                {collapsed ? (
                  <div className={isThinking ? "ai-chat-message-summary thinking" : "ai-chat-message-summary"}>{summarizeChatMessage(message.content || (message.status === "streaming" ? "正在思考..." : ""))}</div>
                ) : (
                  <div className={isThinking ? "ai-chat-message-body thinking" : "ai-chat-message-body"}>
                    {isAssistant ? (
                      isThinking ? <InlineAiText text="正在思考..." /> : <AiChatAssistantContent text={message.content} />
                    ) : message.content}
                  </div>
                )}
              </article>
            );
          })}
          {collaborationPendingQuestion && !messages.some((message) => message.role === "user" && message.content === collaborationPendingQuestion) ? (
            <article className="ai-chat-message user routing-pending">
              <header className="ai-chat-message-head">
                <span className="ai-chat-message-role"><UserRound size={15} /><strong>你</strong></span>
              </header>
              <div className="ai-chat-message-body">{collaborationPendingQuestion}</div>
            </article>
          ) : null}
          {collaborationBusy && collaborationStatusText ? (
            <article className="ai-chat-message assistant ai-collaboration-running-message" role="status" aria-live="polite">
              <header className="ai-chat-message-head">
                <span className="ai-chat-message-role"><LoaderCircle className="spin" size={16} /><strong>AI 协作</strong></span>
              </header>
              <div className="ai-collaboration-running-body">
                <div className="ai-collaboration-running-stage">
                  <strong>{collaborationStatusText}</strong>
                  <em>已用时 {formatElapsedSeconds(collaborationElapsedSeconds)}</em>
                </div>
                <span>{collaborationStageHint}</span>
              </div>
            </article>
          ) : null}
          {pendingReview ? (
            <CollaborationReviewCard
              busy={collaborationBusy}
              pendingReview={pendingReview}
              onAcceptAllPending={onAcceptAllPendingCollaboration}
              onCommit={onCommitCollaboration}
              onDiscard={onDiscardCollaboration}
              onRegenerate={onRegenerateCollaboration}
            />
          ) : null}
          {error ? <p className="ai-chat-error">{error}</p> : null}
        </div>
        <footer className={[
          "ai-chat-composer",
          selectedTexts.length ? "has-selection" : "",
          composerCollapsed ? "collapsed" : "",
        ].filter(Boolean).join(" ")}>
          <div className="ai-chat-composer-title">
            <span aria-hidden="true">
              <img src={AI_ASSETS.aiComposerMark} alt="" />
            </span>
            <strong>{collaborationFrozen ? "协作审阅期间已冻结新的 AI 请求" : "提问，或让 AI 添加标题、表格、Mermaid、拆分/合并信笺…"}</strong>
            <button type="button" className="ai-chat-composer-collapse" onClick={() => setComposerCollapsed((value) => !value)} aria-label={composerCollapsed ? "展开输入框" : "折叠输入框"} title={composerCollapsed ? "展开输入框" : "折叠输入框"}>
              <ChevronDown size={18} />
            </button>
          </div>
          {composerCollapsed ? null : selectedTexts.length ? (
            <div className="ai-chat-selected-chips" aria-label="已标记文字">
              {selectedTexts.map((selection, index) => (
                <div className="ai-chat-selected-chip" title={selection.text} key={selection.id}>
                  <button type="button" className="ai-chat-selected-chip-main" onClick={() => onJumpSelectedText?.(selection)}>
                    <span className="selected-chip-label">已标记{index + 1}：</span>
                    <span>{summarizeSelectedText(selection.text, 5)}</span>
                  </button>
                  <button type="button" className="ai-chat-selected-chip-remove" onClick={() => onRemoveSelectedText?.(selection.id)} disabled={inputDisabled} aria-label={`清除已标记${index + 1}`}>
                    <X size={13} />
                  </button>
                </div>

              ))}
            </div>
          ) : null}
          {composerCollapsed ? null : (
            <>
              <textarea
                value={input}
                rows={3}
                placeholder="例如：在合适位置添加标题和 Emoji；把数据整理成表格并画 Mermaid 图"
                disabled={inputDisabled}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                type="button"
                className="ai-chat-send-button"
                disabled={!canSend}
                onClick={onSend}
                title={hasUsableProvider ? "发送" : "请先配置模型"}
                aria-label={hasUsableProvider ? "发送" : "请先配置模型"}
              >
                <Send size={21} />
              </button>
              <div className="ai-chat-presets" aria-label="快捷提问">
                {AI_CHAT_PROMPT_PRESETS.map((preset) => (
                  <button type="button" key={preset.id} disabled={inputDisabled} onClick={() => onPresetSelect?.(preset)}>
                    <Sparkles size={12} />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </footer>
      </section>
    </main>
  );
}
