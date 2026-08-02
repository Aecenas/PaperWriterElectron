const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createCitationRuntime,
  normalizeDoi,
  normalizeIsbn,
} = require("./citation-runtime.cjs");
const {
  BUILT_IN_STYLE_TEMPLATES,
} = require("./citation-styles.cjs");

const IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
];

test("parses and exports BibTeX, RIS, and CSL JSON without Citation.js private graph data", () => {
  let cursor = 0;
  const runtime = createCitationRuntime({ idFactory: () => IDS[cursor++] });
  const parsed = runtime.parse({
    format: "bibtex",
    text: "@article{doe2024,title={A Safe Paper},author={Doe, Jane},year={2024},doi={10.1000/test}}",
  });
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.sources[0].citationKey, "doe2024");
  assert.equal(parsed.sources[0].doi, "10.1000/test");
  assert.equal("_graph" in parsed.sources[0].csl, false);
  assert.match(runtime.exportSources({ sources: parsed.sources, format: "ris" }).text, /TY  - JOUR/);
  assert.match(runtime.exportSources({ sources: parsed.sources, format: "bibtex" }).text, /title = \{A \{Safe\} \{Paper\}\}/);
  assert.equal(JSON.parse(runtime.exportSources({ sources: parsed.sources, format: "csl-json" }).text)[0].title, "A Safe Paper");
  assert.match(runtime.formatSources({ sources: parsed.sources }).entries[0], /^\[1\]/);
  assert.equal(runtime.builtInStyles().length, 5);
  for (const style of runtime.builtInStyles()) {
    const formatted = runtime.formatSources({
      sources: parsed.sources,
      styleId: style.styleId,
      locale: style.locale,
    });
    assert.equal(formatted.entries.length, 1);
    assert.equal(typeof formatted.entriesById[parsed.sources[0].id], "string");
    assert.equal(typeof formatted.citationsById[parsed.sources[0].id], "string");
  }
});

test("rejects active or externally linked custom CSL styles", () => {
  const runtime = createCitationRuntime();
  assert.throws(() => runtime.validateCslStyle({ xml: '<!DOCTYPE style><style xmlns="http://purl.org/net/xbiblio/csl"></style>' }), /DTD/);
  assert.throws(() => runtime.validateCslStyle({ xml: '<style xmlns="http://purl.org/net/xbiblio/csl"><link href="https://evil.test/style"/></style>' }), /外部网络/);
  const style = runtime.validateCslStyle({
    xml: '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><title>安全样式</title><id>safe-style</id></info></style>',
  });
  assert.match(style.styleId, /^custom-[a-f0-9]{24}$/);
  assert.equal(style.hash.length, 64);
  assert.equal(style.title, "安全样式");
});

test("formats a hash-bound custom CSL style through citeproc", () => {
  const runtime = createCitationRuntime();
  const xml = BUILT_IN_STYLE_TEMPLATES["gb-t-7714-2015-author-date"].xml;
  const validated = runtime.validateCslStyle({ xml });
  const source = {
    id: IDS[0],
    type: "article",
    title: "自定义样式论文",
    authors: ["张三"],
    year: "2025",
  };
  const formatted = runtime.formatSources({
    sources: [source],
    styleId: validated.styleId,
    locale: "zh-CN",
    customStyle: validated,
  });
  assert.equal(formatted.styleId, validated.styleId);
  assert.equal(formatted.customStyle.hash, validated.hash);
  assert.match(formatted.entriesById[source.id], /自定义样式论文/);
  assert.match(formatted.citationsById[source.id], /张三/);
  assert.throws(
    () => runtime.formatSources({
      sources: [source],
      styleId: `${validated.styleId}-tampered`,
      customStyle: validated,
    }),
    /身份/,
  );
});

test("restricts lookup identifiers and hosts", async () => {
  const calls = [];
  const runtime = createCitationRuntime({
    idFactory: () => IDS[0],
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: { type: "journal-article", title: ["论文"], DOI: "10.1000/test" } }),
      };
    },
  });
  await assert.rejects(
    runtime.lookup({ kind: "doi", value: "10.1000/test" }),
    /隐私说明/,
  );
  const source = await runtime.lookup({
    kind: "doi",
    value: "https://doi.org/10.1000/test",
    privacyConsent: true,
  });
  assert.equal(source.title, "论文");
  assert.deepEqual(calls, ["https://api.crossref.org/works/10.1000%2Ftest"]);
  await assert.rejects(runtime.lookup({
    kind: "doi",
    value: "https://evil.example/test",
    privacyConsent: true,
  }), /DOI/);
  assert.equal(normalizeDoi("10.1000/Test"), "10.1000/Test");
  assert.equal(normalizeIsbn("978-7-111-23456-7"), "9787111234567");
});

test("lookup retries bounded transient failures and persists a TTL cache", async () => {
  let fetchCalls = 0;
  const sleeps = [];
  const saved = [];
  const runtime = createCitationRuntime({
    idFactory: () => IDS[0],
    now: () => 10_000,
    random: () => 0,
    sleep: async (delay) => { sleeps.push(delay); },
    loadLookupCache: async () => ({ version: 1, entries: [] }),
    saveLookupCache: async (value) => { saved.push(value); },
    fetchImpl: async () => {
      fetchCalls += 1;
      if (fetchCalls < 3) {
        return {
          ok: false,
          status: fetchCalls === 1 ? 429 : 503,
          headers: { get: () => null },
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            type: "journal-article",
            title: ["缓存论文"],
          },
        }),
      };
    },
  });
  const payload = {
    kind: "doi",
    value: "10.1000/cache",
    privacyConsent: true,
  };
  assert.equal((await runtime.lookup(payload)).title, "缓存论文");
  assert.equal((await runtime.lookup(payload)).title, "缓存论文");
  assert.equal(fetchCalls, 3);
  assert.deepEqual(sleeps.slice(0, 2), [250, 500]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].entries[0].key, "doi:10.1000/cache");
});
