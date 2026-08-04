import assert from "node:assert/strict";
import test from "node:test";

import {
  RESEARCH_TRANSLATION_CACHE_MAX_ENTRIES,
  clearResearchTranslationCache,
  readResearchTranslationCache,
  researchTranslationCacheStats,
  writeResearchTranslationCache,
} from "./research/research-translation-cache.js";

function input(overrides = {}) {
  return {
    kind: "pdf",
    page: 3,
    targetLanguage: "zh-CN",
    blocks: [{ id: "pdf-0-1", text: "Hello world" }],
    ...overrides,
  };
}

test("research translation cache is session-memory-only and matches exact page content", () => {
  clearResearchTranslationCache();
  assert.equal(writeResearchTranslationCache(input(), [{ id: "pdf-0-1", text: "你好，世界" }]), true);
  assert.equal(readResearchTranslationCache(input()).get("pdf-0-1"), "你好，世界");
  assert.equal(readResearchTranslationCache(input({ page: 4 })), null);
  assert.equal(readResearchTranslationCache(input({ blocks: [{ id: "pdf-0-1", text: "Changed content" }] })), null);
  const stats = researchTranslationCacheStats();
  assert.equal(stats.entries, 1);
  assert.ok(stats.characters > 0);
  clearResearchTranslationCache();
});

test("research translation cache rejects incomplete results and evicts least-recently-used pages", () => {
  clearResearchTranslationCache();
  assert.equal(writeResearchTranslationCache(input(), []), false);
  for (let index = 0; index <= RESEARCH_TRANSLATION_CACHE_MAX_ENTRIES; index += 1) {
    const pageInput = input({
      page: index + 1,
      blocks: [{ id: `pdf-${index}`, text: `Page ${index}` }],
    });
    assert.equal(writeResearchTranslationCache(pageInput, [{ id: `pdf-${index}`, text: `第 ${index} 页` }]), true);
  }
  assert.equal(researchTranslationCacheStats().entries, RESEARCH_TRANSLATION_CACHE_MAX_ENTRIES);
  assert.equal(readResearchTranslationCache(input({
    page: 1,
    blocks: [{ id: "pdf-0", text: "Page 0" }],
  })), null);
  assert.equal(readResearchTranslationCache(input({
    page: RESEARCH_TRANSLATION_CACHE_MAX_ENTRIES + 1,
    blocks: [{ id: `pdf-${RESEARCH_TRANSLATION_CACHE_MAX_ENTRIES}`, text: `Page ${RESEARCH_TRANSLATION_CACHE_MAX_ENTRIES}` }],
  })).get(`pdf-${RESEARCH_TRANSLATION_CACHE_MAX_ENTRIES}`), `第 ${RESEARCH_TRANSLATION_CACHE_MAX_ENTRIES} 页`);
  clearResearchTranslationCache();
});
