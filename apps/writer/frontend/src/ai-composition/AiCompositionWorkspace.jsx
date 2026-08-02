import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  Check,
  ChevronDown,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { isTopModalDialog, useModalFocusTrap } from "../ui-interactions.js";
import {
  EMPTY_COMPOSITION_BRIEF,
  estimateCompositionContext,
  loadCompositionDraft,
  normalizeCompositionDraft,
  saveCompositionDraft,
  sectionCompletion,
  validateCompositionBrief,
} from "./model.js";
import { useCompositionJob } from "./useCompositionJob.js";

const GENERATION_STAGES = Object.freeze([
  { id: "outline", label: "组织结构" },
  { id: "draft", label: "撰写正文" },
  { id: "review", label: "全文检查" },
  { id: "finalize", label: "生成信笺" },
]);

function BriefField({ label, error, wide = false, hint = "", children }) {
  return (
    <label className={wide ? "composition-field is-wide" : "composition-field"}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
      {error ? <small className="composition-field-error" role="alert">{error}</small> : null}
    </label>
  );
}

function BriefEditor({
  initialPayload,
  sourceCandidates,
  busy,
  onClose,
  onCreate,
  onDraftChange,
  onUserEdit,
}) {
  const [brief, setBrief] = useState({
    ...EMPTY_COMPOSITION_BRIEF,
    ...(initialPayload?.brief || {}),
  });
  const [selectedSources, setSelectedSources] = useState(initialPayload?.selectedSourceIds || []);
  const [sourcesOpen, setSourcesOpen] = useState(Boolean(initialPayload?.selectedSourceIds?.length));
  const [errors, setErrors] = useState({});
  const availableIds = useMemo(() => new Set(sourceCandidates.map(
    (source) => String(source.sourceId || source.id),
  )), [sourceCandidates]);

  useEffect(() => {
    setSelectedSources((current) => current.filter((sourceId) => availableIds.has(sourceId)));
  }, [availableIds]);

  useEffect(() => {
    onDraftChange?.({ brief, selectedSourceIds: selectedSources });
  }, [brief, onDraftChange, selectedSources]);

  const selected = sourceCandidates.filter((source) => (
    selectedSources.includes(String(source.sourceId || source.id))
  ));
  const estimate = estimateCompositionContext({ brief, sources: selected });
  const update = (key, value) => {
    onUserEdit?.();
    setBrief((current) => ({ ...current, [key]: value }));
  };
  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = validateCompositionBrief(brief);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    try {
      await onCreate({
        brief,
        constraints: "",
        outline: [],
        selectedSourceIds: selectedSources,
      });
    } catch {
      // The controller surfaces the actionable error in the dialog and app status bar.
    }
  };

  return (
    <form className="composition-dialog-view" onSubmit={submit}>
      <header className="composition-dialog-header">
        <span className="composition-dialog-mark" aria-hidden="true"><Sparkles size={21} /></span>
        <span>
          <small>AI 起稿 · 全稿生成</small>
          <h2 id="composition-dialog-title">定义这篇文章</h2>
        </span>
        <button type="button" className="composition-dialog-close" onClick={onClose} disabled={busy} aria-label="关闭 AI 起稿">
          <X size={18} />
        </button>
      </header>

      <div className="composition-dialog-body">
        <p className="composition-dialog-intro">给出文章方向，AI 将自动完成结构设计、正文撰写和全文检查，并生成一封新的信笺。</p>
        <div className="composition-form-grid">
          <BriefField label="写作主题" error={errors.topic} wide>
            <textarea
              autoFocus
              value={brief.topic}
              onChange={(event) => update("topic", event.target.value)}
              rows={3}
              placeholder="写清楚要讨论的问题、核心观点或期望得到的文章"
            />
          </BriefField>
          <BriefField label="目标读者">
            <input value={brief.audience} onChange={(event) => update("audience", event.target.value)} placeholder="例如：产品经理、研究者" />
          </BriefField>
          <BriefField label="目标字数" error={errors.targetWords}>
            <input type="number" min="100" max="200000" value={brief.targetWords} onChange={(event) => update("targetWords", event.target.value)} />
          </BriefField>
          <BriefField label="文章类型">
            <input value={brief.genre} onChange={(event) => update("genre", event.target.value)} placeholder="例如：长文、报告、评论" />
          </BriefField>
          <BriefField label="表达风格">
            <input value={brief.tone} onChange={(event) => update("tone", event.target.value)} placeholder="例如：克制、清晰、有判断" />
          </BriefField>
          <BriefField label="补充要求（可选）" wide hint="可填写必须覆盖的观点、结构、案例或格式要求。">
            <textarea value={brief.requirements} onChange={(event) => update("requirements", event.target.value)} rows={4} placeholder="例如：结合三个实际案例，结尾给出可执行建议" />
          </BriefField>
        </div>

        <section className={sourcesOpen ? "composition-source-section is-open" : "composition-source-section"}>
          <button type="button" className="composition-source-toggle" onClick={() => setSourcesOpen((current) => !current)} aria-expanded={sourcesOpen}>
            <span className="composition-source-mark" aria-hidden="true"><BookOpenCheck size={17} /></span>
            <span>
              <strong>参考资料（可选）</strong>
              <small>仅会向 AI 发送你明确勾选的内容</small>
            </span>
            <b>{selectedSources.length}</b>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {sourcesOpen ? (
            <div className="composition-source-content">
              {!sourceCandidates.length ? (
                <p className="composition-source-empty">当前没有可选资料，可以直接生成全稿。</p>
              ) : (
                <div className="composition-source-list" aria-label="选择 AI 起稿参考资料">
                  {sourceCandidates.map((source) => {
                    const id = String(source.sourceId || source.id);
                    return (
                      <label key={id}>
                        <input
                          type="checkbox"
                          checked={selectedSources.includes(id)}
                          onChange={(event) => {
                            onUserEdit?.();
                            setSelectedSources((current) => (
                              event.target.checked
                                ? [...current, id]
                                : current.filter((item) => item !== id)
                            ));
                          }}
                        />
                        <span>
                          <strong>{source.title || source.name || "未命名资料"}</strong>
                          <small>{String(source.content || source.text || "").length.toLocaleString()} 字符</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>

      <footer className="composition-dialog-footer">
        <span>{selectedSources.length ? `已选 ${selectedSources.length} 份资料 · 约 ${estimate.estimatedTokens.toLocaleString()} tokens` : ""}</span>
        <div>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>取消</button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? <LoaderCircle className="composition-spin" size={16} /> : <Sparkles size={16} />}
            {busy ? "正在准备…" : "生成全稿"}
          </button>
        </div>
      </footer>
    </form>
  );
}

function generationStage(job) {
  if (!job || ["brief", "outline-running"].includes(job.status)) return 0;
  if (["outline-review", "drafting", "paused"].includes(job.status)) return 1;
  if (job.status === "review" && !job.reviewedAt) return 2;
  return 3;
}

function generationProgress(job) {
  const stage = generationStage(job);
  if (stage === 0) return 12;
  if (stage === 1) {
    const completion = sectionCompletion(job);
    return 28 + (completion.total ? Math.round((completion.done / completion.total) * 43) : 0);
  }
  if (stage === 2) return 78;
  return job?.status === "complete" ? 100 : 92;
}

function generationMessage(job) {
  const stage = generationStage(job);
  if (stage === 0) return "正在梳理主题并设计文章结构…";
  if (stage === 1) {
    const completion = sectionCompletion(job);
    return completion.total
      ? `正在撰写正文，已完成 ${completion.done} / ${completion.total} 节…`
      : "正在准备正文…";
  }
  if (stage === 2) return "正在检查全文的一致性、引用与遗漏…";
  return "正在生成新的信笺…";
}

function GeneratingView({ job, busy, onCancel }) {
  const activeStage = generationStage(job);
  const progress = generationProgress(job);
  return (
    <div className="composition-dialog-view">
      <header className="composition-dialog-header">
        <span className="composition-dialog-mark is-working" aria-hidden="true"><LoaderCircle className="composition-spin" size={21} /></span>
        <span>
          <small>AI 起稿 · 正在生成</small>
          <h2 id="composition-dialog-title">{job?.brief?.topic || "正在准备全稿"}</h2>
        </span>
        <button type="button" className="composition-dialog-close" disabled aria-label="生成期间暂不能关闭"><X size={18} /></button>
      </header>
      <div className="composition-dialog-body composition-generating" role="status" aria-live="polite">
        <div className="composition-generating-orbit" aria-hidden="true"><Sparkles size={28} /></div>
        <h3>请稍候，完整文章正在生成</h3>
        <p>{generationMessage(job)}</p>
        <div className="composition-progress-track" aria-label={`生成进度 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <ol className="composition-generation-stages">
          {GENERATION_STAGES.map((stage, index) => (
            <li key={stage.id} className={index < activeStage ? "is-done" : index === activeStage ? "is-active" : ""}>
              <span>{index < activeStage ? <Check size={13} /> : index + 1}</span>
              {stage.label}
            </li>
          ))}
        </ol>
        <small>生成完成后会自动打开新信笺，当前信笺不会被覆盖。</small>
      </div>
      <footer className="composition-dialog-footer">
        <span>{busy ? "AI 正在工作，请保持应用开启" : "正在衔接下一阶段…"}</span>
        <div>
          <button type="button" className="ghost" onClick={onCancel}><Square size={14} />停止生成</button>
        </div>
      </footer>
    </div>
  );
}

function ErrorView({ job, message, retryable, onBack, onRetry, onClose }) {
  return (
    <div className="composition-dialog-view">
      <header className="composition-dialog-header">
        <span className="composition-dialog-mark is-error" aria-hidden="true"><AlertTriangle size={21} /></span>
        <span>
          <small>AI 起稿 · 需要处理</small>
          <h2 id="composition-dialog-title">全稿生成没有完成</h2>
        </span>
        <button type="button" className="composition-dialog-close" onClick={onClose} aria-label="关闭 AI 起稿"><X size={18} /></button>
      </header>
      <div className="composition-dialog-body composition-generation-error" role="alert">
        <AlertTriangle size={28} />
        <div>
          <h3>{job?.brief?.topic || "AI 起稿任务"}</h3>
          <p>{message || "生成过程中发生错误，请检查 AI 设置后重试。"}</p>
          {job?.outputIntent ? <small>应用已经保留落稿凭据，请重启笺间完成文件状态确认。</small> : null}
        </div>
      </div>
      <footer className="composition-dialog-footer">
        <span>已完成的后台阶段会保留，重试时将从中断处继续。</span>
        <div>
          <button type="button" className="ghost" onClick={onBack}>返回修改</button>
          {retryable ? <button type="button" className="primary" onClick={onRetry}><RotateCcw size={15} />继续生成</button> : null}
        </div>
      </footer>
    </div>
  );
}

export function AiCompositionWorkspace({
  bridge,
  sourceCandidates = [],
  sourceDocument,
  onBack,
  onError,
  onComplete,
}) {
  const dialogRef = useRef(null);
  const pipelineActiveRef = useRef(false);
  const pipelineJobIdRef = useRef("");
  const handledEventRef = useRef(0);
  const draftEditedRef = useRef(false);
  const recentJobRestoreHandledRef = useRef(false);
  const [view, setView] = useState("brief");
  const [pipelineError, setPipelineError] = useState("");
  const [storedDraftAtOpen] = useState(() => loadCompositionDraft());
  const [lastPayload, setLastPayload] = useState(() => (
    storedDraftAtOpen || normalizeCompositionDraft({}, sourceDocument?.title || "")
  ));

  useModalFocusTrap(true, dialogRef);

  const handleControllerError = useCallback((error) => {
    const message = error?.message || String(error || "AI 起稿失败");
    if (pipelineActiveRef.current) {
      setPipelineError(message);
      setView("error");
    }
    onError?.(error);
  }, [onError]);

  const controller = useCompositionJob({
    bridge,
    sourceCandidates,
    sourceDocument,
    onError: handleControllerError,
    onComplete,
  });

  const persistDraft = useCallback((payload) => {
    saveCompositionDraft(payload);
  }, []);

  const markDraftEdited = useCallback(() => {
    draftEditedRef.current = true;
  }, []);

  useEffect(() => {
    if (storedDraftAtOpen || controller.loading || recentJobRestoreHandledRef.current) return;
    recentJobRestoreHandledRef.current = true;
    if (draftEditedRef.current) return;
    const recentJob = controller.jobs[0];
    if (!recentJob?.brief) return;
    const restored = normalizeCompositionDraft({
      brief: recentJob.brief,
      selectedSourceIds: (recentJob.sourceSnapshots || []).map((source) => source.sourceId),
    }, sourceDocument?.title || "");
    setLastPayload(restored);
    persistDraft(restored);
  }, [controller.jobs, controller.loading, persistDraft, sourceDocument?.title, storedDraftAtOpen]);

  const close = useCallback(() => {
    if (pipelineActiveRef.current && view === "running") return;
    onBack?.();
  }, [onBack, view]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || !isTopModalDialog(dialogRef)) return;
      event.preventDefault();
      event.stopPropagation();
      if (pipelineActiveRef.current && view === "running") {
        event.stopImmediatePropagation?.();
        return;
      }
      close();
    };
    window.document.addEventListener("keydown", handleKeyDown, true);
    return () => window.document.removeEventListener("keydown", handleKeyDown, true);
  }, [close, view]);

  const runAction = useCallback(async (action) => {
    try {
      await action();
    } catch {
      // useCompositionJob reports and stores the error for this dialog.
    }
  }, []);

  useEffect(() => {
    const event = controller.lastEvent;
    if (!event?.sequence || handledEventRef.current === event.sequence) return;
    if (!pipelineActiveRef.current || event.jobId !== pipelineJobIdRef.current) return;
    handledEventRef.current = event.sequence;
    if (event.type === "outline-complete") {
      void runAction(() => controller.actions.resume());
    } else if (event.type === "drafting-complete") {
      void runAction(() => controller.actions.review());
    } else if (event.type === "review-complete") {
      void runAction(() => controller.actions.finalize());
    } else if (event.type === "complete") {
      pipelineActiveRef.current = false;
      setView("complete");
    } else if (event.type === "error") {
      setPipelineError(event.message || event.job?.error || "全稿生成失败");
      setView("error");
    }
  }, [controller.actions, controller.lastEvent, runAction]);

  const createFullDraft = useCallback(async (payload) => {
    const savedPayload = saveCompositionDraft(payload);
    setLastPayload(savedPayload);
    setPipelineError("");
    pipelineActiveRef.current = true;
    pipelineJobIdRef.current = "";
    setView("running");
    const created = await controller.actions.create(savedPayload);
    if (!created?.jobId) throw new Error("无法创建 AI 起稿任务");
    pipelineJobIdRef.current = created.jobId;
    await controller.actions.generateOutline(created);
  }, [controller.actions]);

  const stopGeneration = useCallback(async () => {
    pipelineActiveRef.current = false;
    pipelineJobIdRef.current = "";
    await runAction(() => controller.actions.cancel());
    setView("brief");
  }, [controller.actions, runAction]);

  const retryGeneration = useCallback(async () => {
    const job = controller.job;
    if (!job?.jobId || job.outputIntent) return;
    pipelineActiveRef.current = true;
    pipelineJobIdRef.current = job.jobId;
    setPipelineError("");
    setView("running");
    const completion = sectionCompletion(job);
    if (!job.outline?.length) {
      await runAction(() => controller.actions.generateOutline(job));
    } else if (completion.done < completion.total) {
      await runAction(() => controller.actions.resume());
    } else if (!job.reviewedAt) {
      await runAction(() => controller.actions.review());
    } else {
      await runAction(() => controller.actions.finalize());
    }
  }, [controller.actions, controller.job, runAction]);

  const returnToBrief = useCallback(() => {
    pipelineActiveRef.current = false;
    pipelineJobIdRef.current = "";
    setPipelineError("");
    setView("brief");
  }, []);

  return (
    <section
      ref={dialogRef}
      className="ai-composition-workspace"
      role="dialog"
      aria-modal="true"
      aria-labelledby="composition-dialog-title"
      onMouseDown={(event) => event.stopPropagation()}
    >
      {view === "brief" ? (
        <BriefEditor
          key={`${lastPayload?.brief?.topic || "new"}-${lastPayload?.selectedSourceIds?.join("|") || "none"}`}
          initialPayload={lastPayload}
          sourceCandidates={sourceCandidates}
          busy={controller.busy}
          onClose={close}
          onCreate={createFullDraft}
          onDraftChange={persistDraft}
          onUserEdit={markDraftEdited}
        />
      ) : null}
      {view === "running" || view === "complete" ? (
        <GeneratingView job={controller.job} busy={controller.busy} onCancel={stopGeneration} />
      ) : null}
      {view === "error" ? (
        <ErrorView
          job={controller.job}
          message={pipelineError || controller.job?.error}
          retryable={Boolean(controller.job?.jobId && !controller.job?.outputIntent)}
          onBack={returnToBrief}
          onRetry={retryGeneration}
          onClose={close}
        />
      ) : null}
    </section>
  );
}
