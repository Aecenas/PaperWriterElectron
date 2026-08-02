import {
  ArrowRight,
  BookCheck,
  CircleOff,
  Replace,
  ReplaceAll,
  Settings,
} from "lucide-react";
import "./writing-assistance.css";

export default function WritingAssistancePane({
  issues = [],
  enabled = true,
  scanning = false,
  editorLabel = "当前正文",
  onIgnoreOnce,
  onReplaceOnce,
  onReplaceAll,
  onJump,
  onOpenSettings,
  settingsButtonRef,
}) {
  return (
    <section className={`writing-assistance-pane${enabled ? "" : " is-disabled"}`} aria-label="写作检查" aria-busy={scanning || undefined}>
      <header>
        <div className="writing-assistance-pane-title">
          <BookCheck size={15} aria-hidden="true" />
          <strong>写作检查</strong>
        </div>
        <div className="writing-assistance-pane-actions">
          {scanning ? <span className="writing-assistance-scanning" role="status">检查中…</span> : null}
          <span className="writing-assistance-pane-count" aria-label={`${issues.length} 条检查建议`}>{issues.length}</span>
          <button
            ref={settingsButtonRef}
            type="button"
            className="writing-assistance-settings-button"
            onClick={onOpenSettings}
            aria-label="检查设置"
            title="检查设置"
          >
            <Settings size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      <p className="writing-assistance-pane-description">
        {enabled ? `${editorLabel} · 拼写与用词规范` : "当前已关闭"}
      </p>

      {!enabled ? (
        <p className="writing-assistance-compact-empty">写作检查已关闭。可从右上角的设置按钮重新启用。</p>
      ) : null}

      {enabled && !issues.length && !scanning ? (
        <p className="writing-assistance-compact-empty">正文还没有发现需要纠正的内容。</p>
      ) : null}

      {enabled ? <div className="writing-assistance-list">
        {issues.map((issue) => (
          <article key={issue.id} className="writing-assistance-card">
            <button
              type="button"
              className="writing-assistance-card-main"
              onClick={() => onJump?.(issue)}
              title={`定位到正文：${issue.actual} → ${issue.preferred}`}
              aria-label={`定位到正文：${issue.actual}，建议改为${issue.preferred}`}
            >
              <span className={`writing-assistance-card-kind is-${issue.kind === "spelling" ? "spelling" : "wording"}`}>
                {issue.kind === "spelling" ? "拼写" : "用词"}
              </span>
              <span className="writing-assistance-card-change">
                <del>{issue.actual}</del>
                <ArrowRight size={10} aria-hidden="true" />
                <ins>{issue.preferred}</ins>
              </span>
            </button>
            <div className="writing-assistance-actions">
              <button type="button" title="忽略一次" aria-label={`忽略一次：${issue.actual}`} onClick={() => onIgnoreOnce?.(issue)}>
                <CircleOff size={13} />
              </button>
              <button type="button" title="替换" aria-label={`替换为${issue.preferred}`} onClick={() => onReplaceOnce?.(issue)}>
                <Replace size={13} />
              </button>
              <button type="button" title="全文替换" aria-label={`全文替换为${issue.preferred}`} onClick={() => onReplaceAll?.(issue)}>
                <ReplaceAll size={13} />
              </button>
            </div>
          </article>
        ))}
      </div> : null}
    </section>
  );
}
