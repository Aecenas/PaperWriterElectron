import assert from "node:assert/strict";
import test from "node:test";

import {
  createPortableProfilePreferences,
  normalizeProfilePreferencesPatch,
} from "./settings/profile-preferences.js";

test("portable UI preferences use an explicit path-free whitelist", () => {
  assert.deepEqual(createPortableProfilePreferences({
    newDocumentTemplateId: "paper",
    leftSidebarMode: "structure",
    structureMode: "writing",
    leftSidebarCollapsed: true,
    documentSplitRatio: 0.64,
    currentPath: "C:\\private\\draft.letterpaper",
    recentFiles: ["C:\\private\\draft.letterpaper"],
    openTabs: [{ path: "C:\\private\\draft.letterpaper" }],
    pageViewMode: "spread",
  }), {
    newDocumentTemplateId: "paper",
    leftSidebarMode: "structure",
    structureMode: "writing",
    leftSidebarCollapsed: true,
    documentSplitRatio: 0.64,
  });
});

test("imported UI preferences apply only present, valid keys and bound split ratio", () => {
  assert.deepEqual(normalizeProfilePreferencesPatch({
    leftSidebarMode: "invalid",
    structureMode: "bibliography",
    leftSidebarCollapsed: false,
    documentSplitRatio: 99,
  }), {
    structureMode: "bibliography",
    leftSidebarCollapsed: false,
    documentSplitRatio: 0.75,
  });
  assert.deepEqual(normalizeProfilePreferencesPatch({}), {});
});
