import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyResearchSearchState,
  createResearchSearchRequestId,
  researchSearchProgressMatches,
} from "./controllers/research-search.js";

test("research search state starts idle and request ids stay scoped", () => {
  assert.deepEqual(createEmptyResearchSearchState(), {
    loading: false,
    results: [],
    error: "",
    requestId: "",
    progress: null,
    showProgress: false,
    warnings: [],
  });
  assert.equal(
    createResearchSearchRequestId(() => 1234, () => 0.25),
    "research-search-ya-9",
  );
});

test("research search progress rejects stale libraries and request ids", () => {
  const progress = {
    libraryId: "library-1",
    requestId: "request-1",
    phase: "extracting",
    completed: 2,
    total: 10,
  };
  assert.equal(researchSearchProgressMatches(progress, "library-1", "request-1"), true);
  assert.equal(researchSearchProgressMatches(progress, "library-2", "request-1"), false);
  assert.equal(researchSearchProgressMatches(progress, "library-1", "request-2"), false);
  assert.equal(researchSearchProgressMatches(null, "library-1", "request-1"), false);
});
