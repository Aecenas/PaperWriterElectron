import assert from "node:assert/strict";
import test from "node:test";
import { clearSafeStorageMemoryForTests } from "./safe-storage.js";
import {
  BASE_USER_TEMPLATE_GROUP_ID,
  DEFAULT_LETTER_TEMPLATES,
  DEFAULT_TEMPLATE_PRESENTATION,
  SYSTEM_TEMPLATE_GROUPS,
  TEMPLATES,
  createUniqueTemplateName,
  getLetterTemplate,
  normalizeColorValue,
  normalizeNewDocumentTemplateHistory,
  normalizeTemplateId,
  normalizeTemplatePresentation,
  normalizeUserTemplate,
  normalizeUserTemplateGroups,
} from "./templates/model.js";
import {
  NEW_DOCUMENT_TEMPLATE_HISTORY_STORAGE_KEY,
  NEW_DOCUMENT_TEMPLATE_STORAGE_KEY,
  USER_TEMPLATE_GROUP_STORAGE_KEY,
  USER_TEMPLATE_STORAGE_KEY,
  loadNewDocumentTemplateHistory,
  loadNewDocumentTemplateId,
  loadUserLetterTemplates,
  loadUserTemplateGroups,
  saveNewDocumentTemplateHistory,
  saveNewDocumentTemplateId,
  saveUserLetterTemplates,
  saveUserTemplateGroups,
} from "./templates/storage.js";

const DEFAULT_TEMPLATE_IDS = [
  "fiber-letter",
  "windfield-letter",
  "rain-platform-letter",
  "starlit-sky-letter",
  "warm-letter",
  "bamboo-note",
  "mountain-border",
  "feather-essay",
  "blue-water",
  "window-shadow",
  "corner-classic",
  "moon-grid-letter",
  "mist-dot-letter",
  "plum-snow-letter",
  "lotus-breeze-letter",
  "sunny-island-letter",
  "forest-mist-letter",
  "snow-lit-cabin-letter",
  "bauhaus-geometry-letter",
  "swiss-editorial-letter",
  "retro-newspaper-letter",
  "film-journal-letter",
  "vinyl-sleeve-letter",
  "cyber-glow-letter",
];

test("template model preserves the complete default paper and template catalog", () => {
  assert.deepEqual(DEFAULT_LETTER_TEMPLATES.map((template) => template.id), DEFAULT_TEMPLATE_IDS);
  assert.equal(TEMPLATES.length, 25);
  assert.deepEqual(
    new Set(SYSTEM_TEMPLATE_GROUPS.flatMap((group) => group.templateIds)),
    new Set(DEFAULT_TEMPLATE_IDS),
  );
  assert.ok(DEFAULT_LETTER_TEMPLATES.every((template) => (
    TEMPLATES.some((paper) => paper.id === template.paperId)
    && template.presentation.showDocumentTitle
    && template.presentation.showSignatureDate
  )));
});

test("template normalization retains legacy compatibility and bounds user data", () => {
  assert.equal(normalizeTemplateId("warm", ""), "minimal-red-margin");
  assert.equal(normalizeTemplateId("missing", ""), "fiber");
  assert.equal(normalizeTemplateId("custom", "data:image/png;base64,AA=="), "custom");
  assert.equal(getLetterTemplate({ templateId: "warm" }).id, "warm-letter");
  assert.equal(normalizeColorValue("rgb(47,52,53)"), "#2f3435");

  const presentation = normalizeTemplatePresentation({
    paragraphAlign: "center",
    headingColors: { 1: "#4f6f8f", 2: "#invalid" },
    headingNumbering: { 2: false, 4: false },
    numberImageCaptions: false,
  });
  assert.equal(presentation.paragraphAlign, "center");
  assert.equal(presentation.headingColors[1], "#4f6f8f");
  assert.equal(presentation.headingColors[2], DEFAULT_TEMPLATE_PRESENTATION.headingColors[2]);
  assert.equal(presentation.headingNumbering[2], false);
  assert.equal(presentation.headingColors[4], DEFAULT_TEMPLATE_PRESENTATION.headingColors[4]);
  assert.equal(presentation.headingNumbering[4], false);
  assert.equal(presentation.numberImageCaptions, false);

  const groups = normalizeUserTemplateGroups([
    { id: "user-group-notes", label: " 笔记 " },
    { id: "user-group-duplicate", label: "笔记" },
    { id: "invalid", label: "忽略" },
  ]);
  assert.deepEqual(groups.map((group) => group.id), [BASE_USER_TEMPLATE_GROUP_ID, "user-group-notes"]);

  const userTemplate = normalizeUserTemplate({
    id: "user-example",
    label: "  自用模板  ",
    paperId: "unsupported",
    typography: DEFAULT_LETTER_TEMPLATES[0].typography,
    groupIds: ["user-group-notes", "missing"],
  }, groups);
  assert.equal(userTemplate.paperId, DEFAULT_LETTER_TEMPLATES[0].paperId);
  assert.deepEqual(userTemplate.groupIds, [BASE_USER_TEMPLATE_GROUP_ID, "user-group-notes"]);
  assert.equal(createUniqueTemplateName("自用模板", [userTemplate]), "自用模板 2");
  assert.deepEqual(
    normalizeNewDocumentTemplateHistory(["missing", "fiber-letter", "windfield-letter"]),
    ["fiber-letter", "windfield-letter"],
  );
});

test("template preferences retain their storage keys and round-trip through the domain API", () => {
  const originalWindow = globalThis.window;
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  };
  clearSafeStorageMemoryForTests();

  try {
    const groups = normalizeUserTemplateGroups([{ id: "user-group-notes", label: "笔记" }]);
    const userTemplate = normalizeUserTemplate({
      id: "user-example",
      label: "自用模板",
      paperId: "fiber",
      typography: DEFAULT_LETTER_TEMPLATES[0].typography,
      presentation: DEFAULT_TEMPLATE_PRESENTATION,
      groupIds: ["user-group-notes"],
    }, groups);

    saveUserTemplateGroups(groups);
    saveUserLetterTemplates([userTemplate], groups);
    saveNewDocumentTemplateId("windfield-letter");
    saveNewDocumentTemplateHistory(["fiber-letter", "windfield-letter"]);

    assert.deepEqual(loadUserTemplateGroups(), groups);
    assert.deepEqual(loadUserLetterTemplates(groups), [userTemplate]);
    assert.equal(loadNewDocumentTemplateId([...DEFAULT_LETTER_TEMPLATES, userTemplate]), "windfield-letter");
    assert.deepEqual(loadNewDocumentTemplateHistory(), ["fiber-letter", "windfield-letter"]);
    assert.ok(values.has(USER_TEMPLATE_GROUP_STORAGE_KEY));
    assert.ok(values.has(USER_TEMPLATE_STORAGE_KEY));
    assert.equal(values.get(NEW_DOCUMENT_TEMPLATE_STORAGE_KEY), "windfield-letter");
    assert.ok(values.has(NEW_DOCUMENT_TEMPLATE_HISTORY_STORAGE_KEY));
  } finally {
    clearSafeStorageMemoryForTests();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
