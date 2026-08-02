import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge as defaultBridge } from "../bridge.js";
import {
  compositionRequestId,
  createSourceSnapshots,
  sourceChangesForJob,
} from "./model.js";

export function useCompositionJob({
  bridge = defaultBridge,
  sourceCandidates = [],
  sourceDocument,
  onError,
  onComplete,
} = {}) {
  const [jobs, setJobs] = useState([]);
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [liveDrafts, setLiveDrafts] = useState({});
  const [sourceChanges, setSourceChanges] = useState([]);
  const [lastEvent, setLastEvent] = useState(null);
  const activeJobIdRef = useRef("");
  const eventSequenceRef = useRef(0);

  const refreshJobs = useCallback(async () => {
    const result = await bridge.listCompositionJobs?.();
    setJobs(Array.isArray(result) ? result : []);
    return result;
  }, [bridge]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    refreshJobs()
      .catch((error) => onError?.(error))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [onError, refreshJobs]);

  useEffect(() => bridge.onCompositionEvent?.((event) => {
    if (!event || event.jobId !== activeJobIdRef.current) return;
    if (["outline-complete", "drafting-complete", "review-complete", "complete", "error"].includes(event.type)) {
      setLastEvent({ ...event, sequence: ++eventSequenceRef.current });
    }
    if (event.type === "delta" && event.sectionId) {
      setLiveDrafts((current) => ({
        ...current,
        [event.sectionId]: `${current[event.sectionId] || ""}${event.delta || ""}`,
      }));
    }
    if (event.job) {
      setJob(event.job);
      setJobs((current) => [
        event.job,
        ...current.filter((item) => item.jobId !== event.job.jobId),
      ]);
    }
    if (["outline-complete", "section-complete", "drafting-complete", "review-complete", "complete", "error"].includes(event.type)) {
      setBusy(false);
    }
    if (event.type === "complete") onComplete?.(event.output, event.job);
    if (event.type === "error") onError?.(new Error(event.message || "AI 起稿失败"));
  }), [bridge, onComplete, onError]);

  useEffect(() => {
    let active = true;
    sourceChangesForJob(job, sourceCandidates)
      .then((changes) => {
        if (active) setSourceChanges(changes);
      })
      .catch((error) => {
        if (active) {
          setSourceChanges([]);
          onError?.(error);
        }
      });
    return () => {
      active = false;
    };
  }, [job, onError, sourceCandidates]);

  const invoke = useCallback(async (action, { staysBusy = false } = {}) => {
    setBusy(true);
    try {
      const result = await action();
      if (result?.jobId && !result?.revision) {
        if (!staysBusy) setBusy(false);
      } else if (result?.jobId) {
        setJob(result);
        setJobs((current) => [result, ...current.filter((item) => item.jobId !== result.jobId)]);
        setBusy(false);
      } else if (!staysBusy) {
        setBusy(false);
      }
      return result;
    } catch (error) {
      setBusy(false);
      onError?.(error);
      throw error;
    }
  }, [onError]);

  const actions = useMemo(() => ({
    async open(jobId) {
      const result = await bridge.getCompositionJob?.(jobId);
      activeJobIdRef.current = result?.jobId || "";
      setJob(result || null);
      setLiveDrafts({});
      return result;
    },
    async create({ brief, constraints, selectedSourceIds, outline }) {
      const sourceSnapshots = await createSourceSnapshots(sourceCandidates, selectedSourceIds);
      return invoke(async () => {
        const result = await bridge.createCompositionJob?.({
          brief,
          constraints,
          sourceSnapshots,
          outline,
          derivedFrom: sourceDocument?.documentId
            ? {
              documentId: sourceDocument.documentId,
              revision: sourceDocument.diskRevision || sourceDocument.revision || "",
              path: sourceDocument.path || "",
              title: sourceDocument.title || "",
            }
            : null,
        });
        activeJobIdRef.current = result?.jobId || "";
        setJob(result);
        return result;
      });
    },
    async updateBrief({ brief, constraints, selectedSourceIds }) {
      if (!job) throw new Error("尚未创建起稿任务");
      const sourceSnapshots = await createSourceSnapshots(sourceCandidates, selectedSourceIds);
      return invoke(() => bridge.updateCompositionJob?.({
        jobId: job.jobId,
        expectedRevision: job.revision,
        action: "brief",
        brief,
        constraints,
        sourceSnapshots,
      }));
    },
    update(action, patch = {}) {
      if (!job) return Promise.reject(new Error("尚未创建起稿任务"));
      return invoke(() => bridge.updateCompositionJob?.({
        jobId: job.jobId,
        expectedRevision: job.revision,
        action,
        ...patch,
      }));
    },
    generateOutline(jobOverride, options = {}) {
      const target = jobOverride?.jobId ? jobOverride : job;
      if (!target) return Promise.reject(new Error("尚未创建起稿任务"));
      return invoke(() => bridge.generateCompositionOutline?.({
        jobId: target.jobId,
        expectedRevision: target.revision,
        requestId: compositionRequestId("outline", target.jobId),
        keepLocked: Boolean(options.keepLocked),
      }), { staysBusy: true });
    },
    generateSection(sectionId) {
      if (!job) return Promise.reject(new Error("尚未创建起稿任务"));
      setLiveDrafts((current) => ({ ...current, [sectionId]: "" }));
      return invoke(() => bridge.generateCompositionSection?.({
        jobId: job.jobId,
        sectionId,
        expectedRevision: job.revision,
        requestId: compositionRequestId("section", job.jobId),
      }), { staysBusy: true });
    },
    resume() {
      if (!job) return Promise.reject(new Error("尚未创建起稿任务"));
      setLiveDrafts({});
      return invoke(() => bridge.resumeComposition?.({
        jobId: job.jobId,
        requestId: compositionRequestId("resume", job.jobId),
      }), { staysBusy: true });
    },
    review() {
      if (!job) return Promise.reject(new Error("尚未创建起稿任务"));
      return invoke(() => bridge.reviewComposition?.({
        jobId: job.jobId,
        expectedRevision: job.revision,
        requestId: compositionRequestId("review", job.jobId),
      }), { staysBusy: true });
    },
    pause() {
      if (!job) return Promise.resolve(null);
      return invoke(() => bridge.pauseComposition?.(job.jobId));
    },
    cancel() {
      if (!job) return Promise.resolve(null);
      return invoke(() => bridge.cancelComposition?.(job.jobId));
    },
    finalize(outputPath = "") {
      if (!job) return Promise.reject(new Error("尚未创建起稿任务"));
      return invoke(() => bridge.finalizeComposition?.({
        jobId: job.jobId,
        expectedRevision: job.revision,
        requestId: compositionRequestId("finalize", job.jobId),
        outputPath,
      }), { staysBusy: true });
    },
    async remove(jobId) {
      await invoke(() => bridge.deleteCompositionJob?.(jobId));
      if (job?.jobId === jobId) {
        activeJobIdRef.current = "";
        setJob(null);
      }
      await refreshJobs();
    },
  }), [bridge, invoke, job, refreshJobs, sourceCandidates, sourceDocument]);

  return {
    actions,
    busy,
    job,
    jobs,
    lastEvent,
    liveDrafts,
    loading,
    sourceChanges,
  };
}
