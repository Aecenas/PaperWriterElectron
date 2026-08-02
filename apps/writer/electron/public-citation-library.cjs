const PUBLIC_CITATION_LIBRARY_VERSION = 1;
const PUBLIC_CITATION_LIBRARY_DIRECTORY = "Citation";
const PUBLIC_CITATION_LIBRARY_FILE = "public-library.json";
const PUBLIC_CITATION_SOURCE_LIMIT = 5000;
const PUBLIC_CITATION_LIBRARY_MAX_BYTES = 32 * 1024 * 1024;
const PUBLIC_CITATION_SOURCE_MAX_BYTES = 256 * 1024;

function boundedTimestamp(value, fallback = "") {
  const candidate = typeof value === "string" ? value.trim().slice(0, 64) : "";
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : fallback;
}

function canonicalText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .slice(0, 2000);
}

function citationIdentity(source = {}) {
  const doi = String(source.doi || "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  if (doi) return `doi:${doi}`;
  const isbn = String(source.isbn || "").replace(/[^0-9x]/gi, "").toLocaleLowerCase("en-US");
  if (isbn) return `isbn:${isbn}`;
  const title = canonicalText(source.title);
  const authors = canonicalText(Array.isArray(source.authors) ? source.authors.join("|") : source.authors);
  const year = canonicalText(source.year);
  return title ? `work:${title}|${authors}|${year}` : "";
}

function hasContent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function mergeMissingCitationFields(existing = {}, incoming = {}) {
  const next = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (["id", "createdAt", "updatedAt"].includes(key)) continue;
    if (!hasContent(next[key]) && hasContent(value)) next[key] = value;
  }
  return next;
}

function createPublicCitationLibraryRuntime({
  fs,
  path,
  atomicWriteFile,
  getUserDataPath,
  normalizeCitationSources,
  randomUUID,
}) {
  if (!fs || !path || !atomicWriteFile || !getUserDataPath || !normalizeCitationSources) {
    throw new Error("公域文献库缺少运行依赖");
  }
  let mutationTail = Promise.resolve();

  function libraryPath() {
    return path.join(
      getUserDataPath(),
      PUBLIC_CITATION_LIBRARY_DIRECTORY,
      PUBLIC_CITATION_LIBRARY_FILE,
    );
  }

  function normalizeSource(input = {}, previous = null, { touch = true } = {}) {
    const now = new Date().toISOString();
    const requested = {
      ...(previous || {}),
      ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
      id: input?.id || previous?.id || randomUUID?.(),
    };
    const source = normalizeCitationSources([requested])[0];
    if (!source) throw new Error("参考文献来源至少需要标题、网址或 DOI");
    const normalized = {
      ...source,
      createdAt: boundedTimestamp(previous?.createdAt || input?.createdAt, now),
      updatedAt: touch
        ? now
        : boundedTimestamp(input?.updatedAt || previous?.updatedAt, now),
    };
    if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > PUBLIC_CITATION_SOURCE_MAX_BYTES) {
      throw new Error("参考文献来源元数据过大");
    }
    return normalized;
  }

  function normalizeState(value = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const seen = new Set();
    const sources = (Array.isArray(source.sources) ? source.sources : [])
      .slice(0, PUBLIC_CITATION_SOURCE_LIMIT)
      .flatMap((item) => {
        try {
          const normalized = normalizeSource(item, item, { touch: false });
          if (seen.has(normalized.id)) return [];
          seen.add(normalized.id);
          return [normalized];
        } catch {
          return [];
        }
      });
    const migratedWorkspaceIds = [...new Set(
      (Array.isArray(source.migratedWorkspaceIds) ? source.migratedWorkspaceIds : [])
        .map((id) => String(id || "").trim().slice(0, 128))
        .filter((id) => /^[A-Za-z0-9_-]{8,128}$/.test(id)),
    )].slice(0, PUBLIC_CITATION_SOURCE_LIMIT);
    return {
      version: PUBLIC_CITATION_LIBRARY_VERSION,
      sources,
      migratedWorkspaceIds,
    };
  }

  async function readState() {
    let handle;
    try {
      handle = await fs.open(libraryPath(), "r");
      const before = await handle.stat();
      if (!before.isFile() || before.size <= 0 || before.size > PUBLIC_CITATION_LIBRARY_MAX_BYTES) {
        throw new Error("公域文献库大小无效");
      }
      const buffer = await handle.readFile();
      const after = await handle.stat();
      if (
        buffer.length !== after.size
        || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs
      ) {
        throw new Error("公域文献库在读取期间发生变化");
      }
      return normalizeState(JSON.parse(buffer.toString("utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return normalizeState();
      if (error instanceof SyntaxError) throw new Error("公域文献库文件已损坏，未执行任何修改");
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async function persistState(value) {
    const state = normalizeState(value);
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > PUBLIC_CITATION_LIBRARY_MAX_BYTES) {
      throw new Error("公域文献库超过安全上限");
    }
    await atomicWriteFile(libraryPath(), serialized);
    return state;
  }

  function queueMutation(task) {
    const pending = mutationTail.catch(() => {}).then(task);
    mutationTail = pending;
    return pending;
  }

  async function listSources() {
    const state = await readState();
    return { sources: state.sources };
  }

  function upsertSource(input = {}) {
    return queueMutation(async () => {
      const state = await readState();
      const requestedId = String(input?.id || "").trim().toLocaleLowerCase("en-US");
      const previous = state.sources.find((source) => source.id === requestedId) || null;
      if (!previous && state.sources.length >= PUBLIC_CITATION_SOURCE_LIMIT) {
        throw new Error("公域文献数量已达上限");
      }
      const saved = normalizeSource(input, previous);
      const sources = previous
        ? state.sources.map((source) => source.id === previous.id ? saved : source)
        : [...state.sources, saved];
      const committed = await persistState({ ...state, sources });
      return { source: saved, sources: committed.sources };
    });
  }

  function deleteSource(sourceId) {
    return queueMutation(async () => {
      const id = String(sourceId || "").trim().toLocaleLowerCase("en-US");
      const state = await readState();
      if (!state.sources.some((source) => source.id === id)) {
        throw new Error("公域文献不存在");
      }
      const committed = await persistState({
        ...state,
        sources: state.sources.filter((source) => source.id !== id),
      });
      return { ok: true, id, sources: committed.sources };
    });
  }

  function migrateWorkspace(workspaceId, legacySources = []) {
    return queueMutation(async () => {
      const id = String(workspaceId || "").trim().slice(0, 128);
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error("工作区身份无效");
      const state = await readState();
      if (state.migratedWorkspaceIds.includes(id)) {
        return { migrated: false, alreadyMigrated: true, imported: 0, sources: state.sources };
      }
      const sources = [...state.sources];
      let imported = 0;
      for (const raw of Array.isArray(legacySources) ? legacySources.slice(0, PUBLIC_CITATION_SOURCE_LIMIT) : []) {
        let incoming;
        try {
          incoming = normalizeSource(raw, raw, { touch: false });
        } catch {
          continue;
        }
        const identity = citationIdentity(incoming);
        const index = sources.findIndex((source) => (
          source.id === incoming.id
          || (identity && citationIdentity(source) === identity)
        ));
        if (index < 0) {
          if (sources.length >= PUBLIC_CITATION_SOURCE_LIMIT) break;
          sources.push(incoming);
          imported += 1;
          continue;
        }
        const merged = normalizeSource(
          mergeMissingCitationFields(sources[index], incoming),
          sources[index],
        );
        sources[index] = { ...merged, updatedAt: sources[index].updatedAt };
      }
      const committed = await persistState({
        ...state,
        sources,
        migratedWorkspaceIds: [...state.migratedWorkspaceIds, id],
      });
      return { migrated: true, alreadyMigrated: false, imported, sources: committed.sources };
    });
  }

  return {
    facade: {
      deleteSource,
      listSources,
      migrateWorkspace,
      upsertSource,
    },
    libraryPath,
    normalizeSource,
    readState,
  };
}

module.exports = {
  PUBLIC_CITATION_LIBRARY_FILE,
  PUBLIC_CITATION_LIBRARY_MAX_BYTES,
  PUBLIC_CITATION_LIBRARY_VERSION,
  PUBLIC_CITATION_SOURCE_LIMIT,
  citationIdentity,
  createPublicCitationLibraryRuntime,
  mergeMissingCitationFields,
};
