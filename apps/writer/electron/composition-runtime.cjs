const {
  extractControlledCitations,
  normalizeBrief,
  normalizeOutline,
  parseOutlinePlanResponse,
  parseReviewResponse,
} = require("./composition-model.cjs");
const {
  createOutlineMessages,
  createReviewMessages,
  createSectionMessages,
} = require("./composition-prompts.cjs");

const ACTIVE_COMPOSITION_LIMIT = 2;
const CHECKPOINT_INTERVAL_MS = 750;

function mergeUsage(current, incoming) {
  const next = incoming && typeof incoming === "object" ? incoming : {};
  return {
    inputTokens: current.inputTokens + Math.max(0, Math.trunc(Number(next.inputTokens) || 0)),
    outputTokens: current.outputTokens + Math.max(0, Math.trunc(Number(next.outputTokens) || 0)),
    totalTokens: current.totalTokens + Math.max(0, Math.trunc(Number(next.totalTokens) || 0)),
    estimatedCost: current.estimatedCost + Math.max(0, Number(next.estimatedCost) || 0),
  };
}

function comparableSectionHeading(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/^\s*(?:第\s*)?[0-9一二三四五六七八九十百]+\s*(?:[章节篇部]|[.、:：])\s*/u, "")
    .replace(/[*_~`]/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLocaleLowerCase();
}

function stripLeadingDuplicateSectionHeading(draft, title) {
  const original = String(draft || "");
  const expected = comparableSectionHeading(title);
  if (!expected) return original;
  let remaining = original.replace(/^\uFEFF/, "");
  let changed = false;
  for (let count = 0; count < 4; count += 1) {
    const withoutLeadingBlankLines = remaining.replace(/^(?:[ \t]*\r?\n)+/, "");
    const atx = withoutLeadingBlankLines.match(
      /^(?: {0,3}#{1,6})[ \t]+([^\r\n]+?)[ \t]*#*[ \t]*(?:\r?\n|$)/,
    );
    const setext = atx ? null : withoutLeadingBlankLines.match(
      /^([^\r\n]+)\r?\n {0,3}(?:=+|-+)[ \t]*(?:\r?\n|$)/,
    );
    const plain = atx || setext ? null : withoutLeadingBlankLines.match(
      /^([^\r\n]+)(?:\r?\n(?:[ \t]*\r?\n)+|$)/,
    );
    const match = atx || setext || plain;
    if (!match || comparableSectionHeading(match[1]) !== expected) break;
    remaining = withoutLeadingBlankLines
      .slice(match[0].length)
      .replace(/^(?:[ \t]*\r?\n)+/, "");
    changed = true;
  }
  return changed ? remaining : original;
}

function resultParts(result) {
  if (typeof result === "string") return { text: result, usage: {}, model: {} };
  return {
    text: String(result?.text || result?.output || ""),
    usage: result?.usage || {},
    model: result?.model || {},
  };
}

function assertMutableJob(job) {
  if (job.outputIntent) {
    throw new Error("上次派生信笺的落稿状态尚未确认，请重启应用后再试");
  }
  if (["complete", "canceled"].includes(job.status)) {
    throw new Error("当前 AI 起稿任务已结束");
  }
  if (job.status === "finalizing") {
    throw new Error("当前 AI 起稿任务正在生成派生信笺");
  }
}

function mergeLockedOutline(existingOutline, generatedOutline) {
  const existing = normalizeOutline(existingOutline);
  const generated = normalizeOutline(generatedOutline);
  const lockedIds = new Set(existing.filter((section) => section.locked).map((section) => section.sectionId));
  const lockedTitles = new Set(existing
    .filter((section) => section.locked)
    .map((section) => section.title.trim().toLocaleLowerCase()));
  if (!lockedIds.size) return generated;
  const available = generated.filter((section) => (
    !lockedIds.has(section.sectionId)
    && !lockedTitles.has(section.title.trim().toLocaleLowerCase())
  ));
  const merged = [];
  let generatedIndex = 0;
  const minimumLength = Math.max(existing.length, generated.length);
  for (let index = 0; index < minimumLength; index += 1) {
    const locked = existing[index]?.locked ? existing[index] : null;
    if (locked) {
      merged.push(locked);
    } else if (available[generatedIndex]) {
      merged.push(available[generatedIndex]);
      generatedIndex += 1;
    }
  }
  merged.push(...available.slice(generatedIndex));
  return normalizeOutline(merged);
}

function createCompositionRuntime({
  store,
  completeTask,
  resolveModelAssignments = async () => ({}),
  finalizeDocument,
  reconcileOutputIntent = async () => ({ state: "missing" }),
  emitEvent = () => {},
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  checkpointIntervalMs = CHECKPOINT_INTERVAL_MS,
  activeLimit = ACTIVE_COMPOSITION_LIMIT,
  AbortControllerApi = AbortController,
}) {
  const active = new Map();

  function publish(sender, payload) {
    emitEvent(sender, {
      version: 1,
      at: now().toISOString(),
      ...payload,
    });
  }

  function publishTerminal(sender, payload) {
    active.delete(String(payload?.jobId || ""));
    publish(sender, payload);
  }

  function ensureCapacity(jobId) {
    if (active.has(jobId)) throw new Error("该 AI 起稿任务已有操作正在运行");
    if (active.size >= activeLimit) throw new Error("同时运行的 AI 起稿任务过多");
  }

  async function reconcileFinalization(jobId) {
    const current = await store.get(jobId);
    if (!current?.outputIntent) return null;
    let reconciliation;
    try {
      reconciliation = await reconcileOutputIntent(current.outputIntent, current);
    } catch {
      return null;
    }
    const state = reconciliation?.state
      || (reconciliation?.committed === true ? "committed" : "missing");
    if (state === "committed") {
      return store.mutate(jobId, {
        status: "complete",
        outputPath: reconciliation?.path || current.outputIntent.path,
        outputDocumentId: reconciliation?.documentId
          || current.outputIntent.documentId,
        outputIntent: null,
        activeSectionId: "",
        error: "",
      });
    }
    if (state === "missing") {
      await store.mutate(jobId, { outputIntent: null });
    }
    return null;
  }

  async function completeStructured({
    job,
    taskKey,
    messages,
    repairMessages,
    parse,
    signal,
    sender,
    requestId,
  }) {
    const first = resultParts(await completeTask({
      taskKey,
      messages,
      modelAssignment: job.modelAssignments?.[taskKey],
      signal,
      onDelta: (delta) => publish(sender, {
        type: "delta",
        jobId: job.jobId,
        requestId,
        step: taskKey,
        delta: String(delta || "").slice(0, 100000),
      }),
    }));
    try {
      return { value: parse(first.text), usage: first.usage, model: first.model };
    } catch (firstError) {
      if (signal.aborted) throw firstError;
      const repaired = resultParts(await completeTask({
        taskKey,
        messages: repairMessages({
          raw: first.text,
          message: firstError.message,
        }),
        modelAssignment: job.modelAssignments?.[taskKey],
        signal,
        onDelta: (delta) => publish(sender, {
          type: "delta",
          jobId: job.jobId,
          requestId,
          step: `${taskKey}-repair`,
          delta: String(delta || "").slice(0, 100000),
        }),
      }));
      return {
        value: parse(repaired.text),
        usage: mergeUsage(mergeUsage({ inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 }, first.usage), repaired.usage),
        model: repaired.model || first.model,
      };
    }
  }

  function runOperation(jobId, sender, requestId, operation) {
    ensureCapacity(jobId);
    const controller = new AbortControllerApi();
    let resolveDone;
    const done = new Promise((resolve) => {
      resolveDone = resolve;
    });
    const record = {
      controller,
      done,
      flushCheckpoint: null,
      committing: false,
      requestId,
      startedAt: now().toISOString(),
    };
    active.set(jobId, record);
    void (async () => {
      try {
        await operation(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          const failedJob = await store.mutate(jobId, (job) => ({
            status: "error",
            activeSectionId: "",
            error: String(error?.message || "AI 起稿失败").slice(0, 4000),
            sections: job.sections.map((section) => (
              section.status === "running"
                ? { ...section, status: "error", error: String(error?.message || "生成失败").slice(0, 4000) }
                : section
            )),
          })).catch(() => undefined);
          publishTerminal(sender, {
            type: "error",
            jobId,
            requestId,
            message: String(error?.message || "AI 起稿失败").slice(0, 4000),
            job: failedJob,
          });
        }
      } finally {
        if (active.get(jobId) === record) active.delete(jobId);
        resolveDone();
      }
    })();
    return { ok: true, jobId, requestId };
  }

  async function list() {
    return store.list();
  }

  async function get(jobId) {
    return store.get(jobId);
  }

  async function create(payload = {}) {
    const modelAssignments = await resolveModelAssignments();
    return store.create({
      brief: normalizeBrief(payload.brief),
      constraints: payload.constraints,
      sourceSnapshots: payload.sourceSnapshots,
      outline: payload.outline,
      derivedFrom: payload.derivedFrom,
      modelAssignments,
    });
  }

  async function update(payload = {}) {
    const jobId = String(payload.jobId || "");
    if (active.has(jobId)) throw new Error("生成运行中，请先暂停再编辑任务");
    return store.mutate(jobId, (job) => {
      assertMutableJob(job);
      const action = String(payload.action || "");
      if (action === "brief") {
        const sections = job.sections.map((section) => {
          const draft = section.acceptedDraft || section.draft;
          return {
            ...section,
            status: draft.trim() ? "draft" : "pending",
            draft,
            acceptedDraft: "",
            citations: [],
            error: "",
          };
        });
        return {
          brief: normalizeBrief(payload.brief),
          constraints: String(payload.constraints || "").slice(0, 30000),
          sourceSnapshots: payload.sourceSnapshots,
          sections,
          status: job.outline.length ? "outline-review" : "brief",
          reviewReports: [],
          reviewedAt: "",
          error: "",
        };
      }
      if (action === "outline") {
        const outline = normalizeOutline(payload.outline);
        if (!outline.length) throw new Error("大纲至少需要一个章节");
        return {
          outline,
          sections: outline.map((item) => {
            const existing = job.sections.find((section) => section.sectionId === item.sectionId);
            return existing || { sectionId: item.sectionId, status: "pending" };
          }),
          status: "outline-review",
          reviewReports: [],
          reviewedAt: "",
          error: "",
        };
      }
      if (action === "accept-section") {
        const sectionId = String(payload.sectionId || "");
        let found = false;
        const sections = job.sections.map((section) => {
          if (section.sectionId !== sectionId) return section;
          found = true;
          if (!section.draft.trim()) throw new Error("当前章节还没有可接受的草稿");
          return {
            ...section,
            status: "accepted",
            acceptedDraft: section.draft,
            error: "",
          };
        });
        if (!found) throw new Error("章节不存在");
        return {
          sections,
          status: "paused",
          reviewReports: [],
          reviewedAt: "",
          error: "",
        };
      }
      if (action === "section-draft") {
        const sectionId = String(payload.sectionId || "");
        const draft = String(payload.draft || "").slice(0, 500000);
        if (!draft.trim()) throw new Error("章节草稿不能为空");
        let found = false;
        const sections = job.sections.map((section) => {
          if (section.sectionId !== sectionId) return section;
          found = true;
          const alternatives = section.draft.trim() && section.draft !== draft
            ? [...section.alternatives, {
              id: `alternative-${Date.now()}`,
              draft: section.draft,
              createdAt: now().toISOString(),
            }].slice(-4)
            : section.alternatives;
          return {
            ...section,
            status: "draft",
            draft,
            alternatives,
            error: "",
            updatedAt: now().toISOString(),
          };
        });
        if (!found) throw new Error("章节不存在");
        return {
          sections,
          status: "paused",
          reviewReports: [],
          reviewedAt: "",
          error: "",
        };
      }
      if (action === "restore-alternative") {
        const sectionId = String(payload.sectionId || "");
        const alternativeId = String(payload.alternativeId || "");
        return {
          sections: job.sections.map((section) => {
            if (section.sectionId !== sectionId) return section;
            const alternative = section.alternatives.find((item) => item.id === alternativeId);
            if (!alternative) throw new Error("备选稿不存在");
            return { ...section, draft: alternative.draft, status: "draft", error: "" };
          }),
          status: "paused",
          reviewReports: [],
          reviewedAt: "",
          error: "",
        };
      }
      if (action === "resolve-review") {
        const reportId = String(payload.reportId || "");
        return {
          reviewReports: job.reviewReports.map((report) => (
            report.id === reportId ? { ...report, resolved: Boolean(payload.resolved) } : report
          )),
        };
      }
      throw new Error("不支持的 AI 起稿任务更新");
    }, payload.expectedRevision);
  }

  async function remove(jobId) {
    const id = String(jobId || "");
    if (active.has(id)) throw new Error("请先暂停或取消正在运行的任务");
    const current = await store.get(id);
    if (current?.outputIntent) {
      throw new Error("派生信笺状态确认前不能删除任务，请重启应用后再试");
    }
    return store.remove(jobId);
  }

  async function generateOutline(sender, payload = {}) {
    const jobId = String(payload.jobId || "");
    const requestId = String(payload.requestId || `composition-outline-${Date.now()}`);
    ensureCapacity(jobId);
    const initial = await store.mutate(jobId, (job) => {
      assertMutableJob(job);
      if (!job.brief.topic.trim()) throw new Error("请先填写写作主题");
      const keepExistingOutline = Boolean(payload.keepOutline || payload.keepLocked);
      return {
        status: "outline-running",
        outline: keepExistingOutline ? job.outline : [],
        sections: keepExistingOutline ? job.sections : [],
        reviewReports: [],
        reviewedAt: "",
        error: "",
      };
    }, payload.expectedRevision);
    return runOperation(jobId, sender, requestId, async (signal) => {
      const result = await completeStructured({
        job: initial,
        taskKey: "composeOutline",
        messages: createOutlineMessages(initial),
        repairMessages: (repair) => createOutlineMessages(initial, repair),
        parse: (raw) => {
          const plan = parseOutlinePlanResponse(raw);
          const requestedTopic = String(initial.brief.topic || "").trim();
          const comparableTitle = plan.documentTitle.replace(/[\s\p{P}\p{S}]+/gu, "").toLocaleLowerCase();
          const comparableTopic = requestedTopic.replace(/[\s\p{P}\p{S}]+/gu, "").toLocaleLowerCase();
          if (requestedTopic.length > 24 && comparableTitle === comparableTopic) {
            throw new Error("文章标题不能直接复制写作要求，请根据全文重新拟定");
          }
          return plan;
        },
        signal,
        sender,
        requestId,
      });
      if (signal.aborted) return;
      const nextOutline = payload.keepLocked
        ? mergeLockedOutline(initial.outline, result.value.outline)
        : result.value.outline;
      const completed = await store.mutate(jobId, {
        status: "outline-review",
        generatedTitle: result.value.documentTitle,
        outline: nextOutline,
        sections: nextOutline.map((section) => (
          initial.sections.find((candidate) => candidate.sectionId === section.sectionId)
          || { sectionId: section.sectionId, status: "pending" }
        )),
        usage: mergeUsage(initial.usage, result.usage),
        modelAssignments: {
          ...initial.modelAssignments,
          composeOutline: {
            providerId: result.model.providerId || initial.modelAssignments.composeOutline.providerId,
            modelId: result.model.modelId || initial.modelAssignments.composeOutline.modelId,
          },
        },
        error: "",
      });
      publishTerminal(sender, { type: "outline-complete", jobId, requestId, job: completed });
    });
  }

  async function streamSection({ sender, jobId, requestId, sectionId, signal }) {
    let job = await store.get(jobId);
    if (!job) throw new Error("AI 起稿任务不存在");
    const sectionIndex = job.sections.findIndex((section) => section.sectionId === sectionId);
    if (sectionIndex < 0) throw new Error("章节不存在");
    const previous = job.sections[sectionIndex];
    const alternatives = previous.draft.trim()
      ? [...previous.alternatives, {
        id: `alternative-${Date.now()}`,
        draft: previous.draft,
        createdAt: now().toISOString(),
      }].slice(-4)
      : previous.alternatives;
    job = await store.mutate(jobId, {
      status: "drafting",
      activeSectionId: sectionId,
      sections: job.sections.map((section) => (
        section.sectionId === sectionId
          ? { ...section, status: "running", draft: "", alternatives, error: "" }
          : section
      )),
      reviewReports: [],
      reviewedAt: "",
      error: "",
    });

    let draft = "";
    let checkpointTimer = null;
    let checkpointTail = Promise.resolve();
    const checkpoint = () => {
      checkpointTimer = null;
      const snapshot = draft;
      checkpointTail = checkpointTail
        .catch(() => undefined)
        .then(() => store.mutate(jobId, (current) => ({
          sections: current.sections.map((section) => (
            section.sectionId === sectionId && section.status === "running"
              ? { ...section, draft: snapshot, updatedAt: now().toISOString() }
              : section
          )),
        })));
    };
    const scheduleCheckpoint = () => {
      if (checkpointTimer !== null) return;
      checkpointTimer = setTimer(checkpoint, checkpointIntervalMs);
    };
    const flushCheckpoint = async () => {
      if (checkpointTimer !== null) {
        clearTimer(checkpointTimer);
        checkpointTimer = null;
      }
      checkpoint();
      await checkpointTail.catch(() => undefined);
    };
    const activeRecord = active.get(jobId);
    if (activeRecord) activeRecord.flushCheckpoint = flushCheckpoint;
    let completed;
    try {
      completed = resultParts(await completeTask({
        taskKey: "composeDraft",
        messages: createSectionMessages(job, sectionId),
        modelAssignment: job.modelAssignments?.composeDraft,
        signal,
        onDelta(delta) {
          if (signal.aborted) return;
          const chunk = String(delta || "");
          draft = (draft + chunk).slice(0, 500000);
          publish(sender, { type: "delta", step: "composeDraft", jobId, requestId, sectionId, delta: chunk.slice(0, 100000) });
          scheduleCheckpoint();
        },
      }));
      if (!draft && completed.text) draft = completed.text.slice(0, 500000);
      const outlineTitle = job.outline.find((section) => section.sectionId === sectionId)?.title;
      draft = stripLeadingDuplicateSectionHeading(draft, outlineTitle);
      if (!draft.trim()) throw new Error("章节生成结果为空");
    } finally {
      await flushCheckpoint();
      if (activeRecord?.flushCheckpoint === flushCheckpoint) {
        activeRecord.flushCheckpoint = null;
      }
    }
    if (signal.aborted) return null;
    const citationResult = extractControlledCitations(draft, job);
    if (citationResult.unknown.length) {
      draft += `\n\n> 待核实：模型使用了未选择的来源 ${citationResult.unknown.join("、")}。`;
    }
    return store.mutate(jobId, (current) => {
      const sections = current.sections.map((section) => (
        section.sectionId === sectionId
          ? {
            ...section,
            status: "draft",
            draft,
            citations: citationResult.citations,
            error: "",
            updatedAt: now().toISOString(),
          }
          : section
      ));
      const allDrafted = sections.every((section) => ["draft", "accepted"].includes(section.status));
      return {
        status: allDrafted ? "review" : "paused",
        activeSectionId: "",
        sections,
        usage: mergeUsage(current.usage, completed.usage),
        modelAssignments: {
          ...current.modelAssignments,
          composeDraft: {
            providerId: completed.model.providerId || current.modelAssignments.composeDraft.providerId,
            modelId: completed.model.modelId || current.modelAssignments.composeDraft.modelId,
          },
        },
        reviewReports: [],
        error: "",
      };
    });
  }

  async function generateSection(sender, payload = {}) {
    const jobId = String(payload.jobId || "");
    const sectionId = String(payload.sectionId || "");
    const requestId = String(payload.requestId || `composition-section-${Date.now()}`);
    ensureCapacity(jobId);
    const current = await store.get(jobId);
    if (!current) throw new Error("AI 起稿任务不存在");
    if (payload.expectedRevision !== undefined && current.revision !== Math.trunc(Number(payload.expectedRevision))) {
      const error = new Error("AI 起稿任务已被其他操作更新");
      error.code = "COMPOSITION_REVISION_CONFLICT";
      throw error;
    }
    assertMutableJob(current);
    return runOperation(jobId, sender, requestId, async (signal) => {
      const completed = await streamSection({ sender, jobId, requestId, sectionId, signal });
      if (completed) publishTerminal(sender, { type: "section-complete", jobId, sectionId, requestId, job: completed });
    });
  }

  async function resume(sender, payload = {}) {
    const jobId = String(payload.jobId || "");
    const requestId = String(payload.requestId || `composition-resume-${Date.now()}`);
    ensureCapacity(jobId);
    const current = await store.get(jobId);
    if (!current) throw new Error("AI 起稿任务不存在");
    assertMutableJob(current);
    if (!current.outline.length) throw new Error("请先完成并确认大纲");
    return runOperation(jobId, sender, requestId, async (signal) => {
      let job = current;
      for (const section of job.sections) {
        if (signal.aborted) return;
        if (!["pending", "interrupted", "error"].includes(section.status)) {
          continue;
        }
        job = await streamSection({
          sender,
          jobId,
          requestId,
          sectionId: section.sectionId,
          signal,
        }) || job;
        if (signal.aborted) return;
        publish(sender, {
          type: "section-complete",
          jobId,
          sectionId: section.sectionId,
          requestId,
          job,
        });
      }
      const reviewed = await store.mutate(jobId, { status: "review", activeSectionId: "", error: "" });
      publishTerminal(sender, { type: "drafting-complete", jobId, requestId, job: reviewed });
    });
  }

  async function review(sender, payload = {}) {
    const jobId = String(payload.jobId || "");
    const requestId = String(payload.requestId || `composition-review-${Date.now()}`);
    ensureCapacity(jobId);
    const initial = await store.mutate(jobId, (job) => {
      assertMutableJob(job);
      if (!job.sections.length || job.sections.some((section) => !(section.acceptedDraft || section.draft).trim())) {
        throw new Error("请先生成所有章节");
      }
      return {
        status: "review",
        reviewReports: [],
        reviewedAt: "",
        error: "",
      };
    }, payload.expectedRevision);
    return runOperation(jobId, sender, requestId, async (signal) => {
      const result = await completeStructured({
        job: initial,
        taskKey: "composeReview",
        messages: createReviewMessages(initial),
        repairMessages: (repair) => createReviewMessages(initial, repair),
        parse: parseReviewResponse,
        signal,
        sender,
        requestId,
      });
      if (signal.aborted) return;
      const completed = await store.mutate(jobId, {
        status: "review",
        reviewReports: result.value,
        reviewedAt: now().toISOString(),
        usage: mergeUsage(initial.usage, result.usage),
        modelAssignments: {
          ...initial.modelAssignments,
          composeReview: {
            providerId: result.model.providerId || initial.modelAssignments.composeReview.providerId,
            modelId: result.model.modelId || initial.modelAssignments.composeReview.modelId,
          },
        },
        error: "",
      });
      publishTerminal(sender, { type: "review-complete", jobId, requestId, job: completed });
    });
  }

  async function pause(jobId) {
    const id = String(jobId || "");
    const record = active.get(id);
    if (record?.committing) {
      await record.done;
      return store.get(id);
    }
    if (!record) {
      const current = await store.get(id);
      if (!current) throw new Error("AI 起稿任务不存在");
      return current;
    }
    record?.controller.abort(new Error("已暂停 AI 起稿"));
    await record?.flushCheckpoint?.();
    const current = await store.get(id);
    if (!current) throw new Error("AI 起稿任务不存在");
    if (["complete", "canceled"].includes(current.status)) {
      await record.done;
      return current;
    }
    const paused = await store.mutate(id, {
      status: "paused",
      activeSectionId: "",
      sections: current.sections.map((section) => (
        section.status === "running"
          ? { ...section, status: "interrupted", error: "生成已暂停" }
          : section
      )),
      error: "",
    });
    await record.done;
    return (await store.get(id)) || paused;
  }

  async function cancel(jobId) {
    const id = String(jobId || "");
    const record = active.get(id);
    if (record?.committing) {
      await record.done;
      return store.get(id);
    }
    const beforeCancel = await store.get(id);
    if (!beforeCancel) throw new Error("AI 起稿任务不存在");
    if (beforeCancel.outputIntent) {
      throw new Error("派生信笺状态确认前不能取消任务，请重启应用后再试");
    }
    if (beforeCancel.status === "complete") {
      throw new Error("已完成的 AI 起稿任务不能取消");
    }
    if (beforeCancel.status === "canceled") return beforeCancel;
    record?.controller.abort(new Error("已取消 AI 起稿"));
    await record?.flushCheckpoint?.();
    const canceled = await store.mutate(id, (job) => ({
      status: "canceled",
      activeSectionId: "",
      sections: job.sections.map((section) => (
        section.status === "running"
          ? { ...section, status: "interrupted", error: "任务已取消" }
          : section
      )),
      error: "",
    }));
    if (record) await record.done;
    return (await store.get(id)) || canceled;
  }

  async function finalize(sender, payload = {}) {
    const jobId = String(payload.jobId || "");
    const requestId = String(payload.requestId || `composition-finalize-${Date.now()}`);
    ensureCapacity(jobId);
    const initial = await store.mutate(jobId, (job) => {
      assertMutableJob(job);
      if (!job.sections.length || job.sections.some((section) => !(section.acceptedDraft || section.draft).trim())) {
        throw new Error("所有章节生成完成后才能落稿");
      }
      if (!job.reviewedAt) {
        throw new Error("请先完成当前正文的全局一致性与引用检查");
      }
      return { status: "finalizing", error: "" };
    }, payload.expectedRevision);
    return runOperation(jobId, sender, requestId, async (signal) => {
      const markdown = initial.outline.map((outline, index) => {
        const section = initial.sections[index];
        const body = stripLeadingDuplicateSectionHeading(
          section.acceptedDraft || section.draft,
          outline.title,
        );
        return `## ${outline.title}\n\n${body}`;
      }).join("\n\n");
      let intentPersisted = false;
      let result;
      try {
        result = await finalizeDocument({
          job: initial,
          markdown,
          signal,
          outputPath: payload.outputPath,
          onIntent: async (intent) => {
            if (signal.aborted) throw new Error("AI 起稿落稿已停止");
            const prepared = await store.mutate(jobId, {
              status: "finalizing",
              outputIntent: intent,
              error: "",
            });
            if (!prepared.outputIntent) {
              throw new Error("派生信笺落稿意图无效");
            }
            intentPersisted = true;
            const record = active.get(jobId);
            if (record) record.committing = true;
            return prepared.outputIntent;
          },
        });
        if (!intentPersisted) {
          throw new Error("派生信笺提交前未登记落稿意图");
        }
      } catch (error) {
        const reconciled = await reconcileFinalization(jobId);
        if (reconciled) {
          publishTerminal(sender, {
            type: "complete",
            jobId,
            requestId,
            job: reconciled,
            output: {
              path: reconciled.outputPath,
              documentId: reconciled.outputDocumentId,
            },
          });
          return;
        }
        throw error;
      }
      const completed = await store.mutate(jobId, {
        status: "complete",
        outputPath: result?.path,
        outputDocumentId: result?.documentId,
        outputIntent: null,
        activeSectionId: "",
        error: "",
      });
      publishTerminal(sender, {
        type: "complete",
        jobId,
        requestId,
        job: completed,
        output: {
          path: completed.outputPath,
          documentId: completed.outputDocumentId,
        },
      });
    });
  }

  async function initialize() {
    return store.recoverInterrupted({ reconcileOutputIntent });
  }

  async function abortAll() {
    const ids = [...active.keys()];
    await Promise.all(ids.map((jobId) => pause(jobId).catch(() => undefined)));
  }

  return Object.freeze({
    abortAll,
    cancel,
    create,
    delete: remove,
    finalize,
    generateOutline,
    generateSection,
    get,
    initialize,
    list,
    pause,
    resume,
    review,
    update,
  });
}

module.exports = {
  ACTIVE_COMPOSITION_LIMIT,
  CHECKPOINT_INTERVAL_MS,
  createCompositionRuntime,
  mergeLockedOutline,
  stripLeadingDuplicateSectionHeading,
};
