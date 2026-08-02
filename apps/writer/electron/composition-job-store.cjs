const { normalizeCompositionJob } = require("./composition-model.cjs");

const COMPOSITION_JOB_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const COMPOSITION_JOB_FILE_MAX_BYTES = 64 * 1024 * 1024;

function assertJobId(value) {
  const jobId = String(value || "");
  if (!COMPOSITION_JOB_ID_PATTERN.test(jobId)) {
    throw new Error("AI 起稿任务标识无效");
  }
  return jobId;
}

function createCompositionJobStore({
  fs,
  path,
  getUserDataPath,
  atomicWriteFile,
  randomUUID,
  now = () => new Date(),
}) {
  const mutationTails = new Map();

  function jobsDirectory() {
    return path.join(getUserDataPath(), "CompositionJobs");
  }

  function jobPath(jobId) {
    return path.join(jobsDirectory(), `${assertJobId(jobId)}.json`);
  }

  async function ensureDirectory() {
    await fs.mkdir(jobsDirectory(), { recursive: true });
  }

  async function readJobFile(filePath) {
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size > COMPOSITION_JOB_FILE_MAX_BYTES) {
      throw new Error("AI 起稿任务文件过大或无效");
    }
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    const job = normalizeCompositionJob(parsed);
    if (!job.jobId || path.basename(filePath) !== `${job.jobId}.json`) {
      throw new Error("AI 起稿任务身份不匹配");
    }
    return job;
  }

  async function get(jobId) {
    try {
      return await readJobFile(jobPath(jobId));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function list() {
    await ensureDirectory();
    const entries = await fs.readdir(jobsDirectory(), { withFileTypes: true });
    const jobs = [];
    for (const entry of entries.slice(0, 1000)) {
      if (!entry.isFile() || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\.json$/.test(entry.name)) continue;
      try {
        const job = await readJobFile(path.join(jobsDirectory(), entry.name));
        jobs.push(job);
      } catch {
        // A damaged job remains on disk for diagnostics but cannot poison the list.
      }
    }
    return jobs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async function write(job) {
    const normalized = normalizeCompositionJob(job);
    if (!normalized.jobId) throw new Error("AI 起稿任务标识无效");
    await ensureDirectory();
    await atomicWriteFile(jobPath(normalized.jobId), `${JSON.stringify(normalized, null, 2)}\n`);
    return normalized;
  }

  async function create(input = {}) {
    const timestamp = now().toISOString();
    const hasOutline = Array.isArray(input.outline) && input.outline.length > 0;
    const job = normalizeCompositionJob({
      ...input,
      jobId: randomUUID(),
      revision: 1,
      status: hasOutline ? "outline-review" : "brief",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return write(job);
  }

  function queue(jobId, operation) {
    const id = assertJobId(jobId);
    const previous = mutationTails.get(id) || Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    mutationTails.set(id, current);
    return current.finally(() => {
      if (mutationTails.get(id) === current) mutationTails.delete(id);
    });
  }

  async function mutate(jobId, updater, expectedRevision) {
    return queue(jobId, async () => {
      const current = await get(jobId);
      if (!current) throw new Error("AI 起稿任务不存在");
      if (
        expectedRevision !== undefined
        && Math.trunc(Number(expectedRevision)) !== current.revision
      ) {
        const error = new Error("AI 起稿任务已被其他操作更新");
        error.code = "COMPOSITION_REVISION_CONFLICT";
        error.currentRevision = current.revision;
        throw error;
      }
      const patch = typeof updater === "function" ? await updater(current) : updater;
      const next = normalizeCompositionJob({
        ...current,
        ...(patch && typeof patch === "object" ? patch : {}),
        jobId: current.jobId,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        updatedAt: now().toISOString(),
      });
      return write(next);
    });
  }

  async function remove(jobId) {
    return queue(jobId, async () => {
      const current = await get(jobId);
      if (!current) return { ok: true, deleted: false };
      await fs.unlink(jobPath(jobId));
      return { ok: true, deleted: true };
    });
  }

  async function recoverInterrupted({ reconcileOutputIntent } = {}) {
    const jobs = await list();
    const running = new Set(["outline-running", "drafting", "finalizing"]);
    const recovered = [];
    for (const job of jobs) {
      if (job.outputIntent && typeof reconcileOutputIntent === "function") {
        let reconciliation;
        try {
          reconciliation = await reconcileOutputIntent(job.outputIntent, job);
        } catch (error) {
          reconciliation = {
            state: "indeterminate",
            error: String(error?.message || "派生文件状态无法确认"),
          };
        }
        const state = reconciliation?.state
          || (reconciliation?.committed === true ? "committed" : "missing");
        if (state === "committed") {
          const next = await mutate(job.jobId, {
            status: "complete",
            outputPath: reconciliation?.path || job.outputIntent.path,
            outputDocumentId: reconciliation?.documentId
              || job.outputIntent.documentId,
            outputIntent: null,
            activeSectionId: "",
            error: "",
          });
          recovered.push(next);
          continue;
        }
        if (state === "missing") {
          const next = await mutate(job.jobId, {
            status: "paused",
            outputIntent: null,
            activeSectionId: "",
            sections: job.sections.map((section) => (
              section.status === "running"
                ? { ...section, status: "interrupted", error: "应用退出，当前章节已中断" }
                : section
            )),
            error: "",
          });
          recovered.push(next);
          continue;
        }
        const next = await mutate(job.jobId, {
          status: "paused",
          activeSectionId: "",
          sections: job.sections.map((section) => (
            section.status === "running"
              ? { ...section, status: "interrupted", error: "应用退出，当前章节已中断" }
              : section
          )),
          error: String(
            reconciliation?.error || "派生文件状态无法确认，请重启应用后再试",
          ).slice(0, 4000),
        });
        recovered.push(next);
        continue;
      }
      if (!running.has(job.status) && !job.sections.some((section) => section.status === "running")) continue;
      const next = await mutate(job.jobId, {
        status: "paused",
        activeSectionId: "",
        sections: job.sections.map((section) => (
          section.status === "running"
            ? { ...section, status: "interrupted", error: "应用退出，当前章节已中断" }
            : section
        )),
        error: "",
      });
      recovered.push(next);
    }
    return recovered;
  }

  return Object.freeze({
    create,
    get,
    list,
    mutate,
    recoverInterrupted,
    remove,
  });
}

module.exports = {
  COMPOSITION_JOB_FILE_MAX_BYTES,
  createCompositionJobStore,
};
