import { AlertTriangle, Check, CheckCheck, LockKeyhole, RotateCcw, X } from "lucide-react";

export function CollaborationReviewCard({
  busy = false,
  onAcceptAllPending,
  onCommit,
  onDiscard,
  onRegenerate,
  pendingReview,
}) {
  const proposal = pendingReview?.proposal;
  if (!proposal) return null;
  const stale = proposal.status === "stale";
  const total = proposal.operations.length;
  const reviewed = proposal.operations.filter((operation) => operation.decision !== "pending").length;
  const remaining = Math.max(0, total - reviewed);
  const progress = total ? Math.round((reviewed / total) * 100) : 0;

  return (
    <section className={`ai-collaboration-review ai-collaboration-review-summary${stale ? " stale" : ""}`} aria-label="待审阅修改">
      <header className="ai-collaboration-review-head">
        <span className="ai-collaboration-review-icon" aria-hidden="true"><LockKeyhole size={17} /></span>
        <div>
          <strong>{stale ? "方案已过期" : "审阅进度"}</strong>
          <p>{stale ? "涉及信笺已发生变化，这份方案不能再提交。" : "请在左侧正文中逐项接受或拒绝。"}</p>
        </div>
      </header>

      {stale ? (
        <div className="ai-collaboration-stale-note"><AlertTriangle size={15} />请取消，或重新生成基于最新内容的方案。</div>
      ) : (
        <div className="ai-collaboration-review-progress">
          <div className="ai-collaboration-review-counts" aria-live="polite">
            <span><b>{total}</b><em>全部修改</em></span>
            <span><b>{reviewed}</b><em>已经审阅</em></span>
          </div>
          <div
            className="ai-collaboration-progress-track"
            role="progressbar"
            aria-label="AI 协作审阅进度"
            aria-valuemin="0"
            aria-valuemax={total}
            aria-valuenow={reviewed}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <button type="button" className="ai-collaboration-accept-remaining" disabled={busy || !remaining} onClick={onAcceptAllPending}>
            <CheckCheck size={16} />
            {remaining ? `未审阅的全部接受（${remaining}）` : "全部修改已审阅"}
          </button>
        </div>
      )}

      <footer className="ai-collaboration-review-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onDiscard}><X size={15} />取消审阅</button>
        {stale ? (
          <button type="button" className="primary" disabled={busy} onClick={onRegenerate}><RotateCcw size={15} />重新生成</button>
        ) : (
          <button type="button" className="primary" disabled={busy || remaining > 0 || !total} onClick={() => onCommit?.(pendingReview)}><Check size={15} />提交审阅结果</button>
        )}
      </footer>
    </section>
  );
}
