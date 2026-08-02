import assert from "node:assert/strict";
import test from "node:test";
import {
  citationStyleChoiceFromPickerResult,
  collectEquationTargets,
  createCitationImportPreview,
  mergeCitationImportPreview,
  normalizeCitationStyleChoice,
  normalizeCodeBlockOptions,
  validateMathDraft,
  validateMermaidDraft,
} from "./professional-content/model.js";

const CURRENT_ID = "11111111-1111-4111-8111-111111111111";
const IMPORT_ID = "22222222-2222-4222-8222-222222222222";

test("professional content drafts normalize mode, language, and bounded source rules", () => {
  assert.deepEqual(validateMathDraft(null).value, {
    mode: "block",
    latex: "",
    equationId: "",
    label: "",
    numbering: true,
  });
  assert.equal(validateMermaidDraft(null).valid, false);
  assert.deepEqual(normalizeCodeBlockOptions(null), {
    language: "plaintext",
    wrap: false,
  });

  const math = validateMathDraft({
    mode: "inline",
    latex: "  E = mc^2  ",
    label: "ignored",
    numbering: true,
  });
  assert.equal(math.valid, true);
  assert.deepEqual(math.value, {
    mode: "inline",
    latex: "E = mc^2",
    equationId: "",
    label: "",
    numbering: false,
  });

  assert.deepEqual(normalizeCodeBlockOptions({ language: "TypeScript", wrap: true }), {
    language: "typescript",
    wrap: true,
  });
  assert.equal(normalizeCodeBlockOptions({ language: "<script>" }).language, "plaintext");
  assert.equal(validateMermaidDraft({ source: "flowchart LR\nA-->B" }).valid, true);
  assert.equal(validateMermaidDraft({ source: "flowchart LR\nA-->B", width: "100%" }).value.width, "100%");
  assert.equal(validateMermaidDraft({ source: "flowchart LR\nA-->B", width: "script" }).value.width, "78%");
  assert.equal(validateMermaidDraft({ source: "" }).valid, false);
  assert.equal(validateMermaidDraft({ source: "x\n".repeat(1_501) }).valid, false);
});

test("equation target collection derives stable numbers while retaining unnumbered formulas", () => {
  const targets = collectEquationTargets({
    type: "doc",
    content: [
      {
        type: "blockMath",
        attrs: {
          equationId: CURRENT_ID,
          latex: "a=b",
          label: "first",
          numbering: true,
        },
      },
      {
        type: "blockMath",
        attrs: {
          equationId: IMPORT_ID,
          latex: "c=d",
          label: "",
          numbering: false,
        },
      },
    ],
  });

  assert.equal(targets.length, 2);
  assert.deepEqual(targets[0], {
    equationId: CURRENT_ID,
    label: "first",
    latex: "a=b",
    number: 1,
    position: 1,
    referenceable: true,
    displayLabel: "first",
  });
  assert.equal(targets[1].number, null);
  assert.equal(targets[1].referenceable, false);
  assert.equal(targets[1].displayLabel, "未编号公式");
});

test("citation import preview exposes conflicts and merges only empty fields while preserving referenced ids", () => {
  const existing = [{
    id: CURRENT_ID,
    citationKey: "doe2025",
    title: "",
    authors: ["Jane Doe"],
    year: "2025",
    doi: "10.1000/example",
    publisher: "Local publisher",
    csl: {
      title: "",
      issued: { "date-parts": [[2025]] },
    },
    createdAt: "2025-01-01T00:00:00.000Z",
  }];
  const incoming = [{
    id: IMPORT_ID,
    citationKey: "doe2025",
    title: "Revised title",
    authors: ["Jane Doe", "John Roe"],
    year: "2026",
    doi: "https://doi.org/10.1000/EXAMPLE",
    publisher: "Imported publisher",
    csl: {
      title: "Revised title",
      issued: { literal: "Spring" },
    },
  }];
  const preview = createCitationImportPreview(existing, incoming);

  assert.deepEqual(preview.counts, { total: 1, new: 0, conflict: 1, duplicate: 0 });
  assert.equal(preview.entries[0].existing.id, CURRENT_ID);
  assert.deepEqual(
    preview.entries[0].differences.map((difference) => difference.field),
    ["title", "authors", "year", "publisher"],
  );

  assert.deepEqual(mergeCitationImportPreview(existing, preview, {}), existing);
  const merged = mergeCitationImportPreview(existing, preview, { [IMPORT_ID]: "merge" });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, CURRENT_ID);
  assert.equal(merged[0].createdAt, existing[0].createdAt);
  assert.equal(merged[0].title, "Revised title");
  assert.equal(merged[0].publisher, "Local publisher");
  assert.deepEqual(merged[0].authors, ["Jane Doe"]);
  assert.deepEqual(merged[0].csl, {
    title: "Revised title",
    issued: {
      "date-parts": [[2025]],
      literal: "Spring",
    },
  });
});

test("citation import appends new records, skips duplicates, and normalizes style locale", () => {
  const existing = [{ id: CURRENT_ID, title: "Paper", year: "2026", doi: "10.1/a" }];
  const incoming = [
    { id: IMPORT_ID, title: "Paper", year: "2026", doi: "10.1/a" },
    { id: "33333333-3333-4333-8333-333333333333", title: "Book", isbn: "978-1-23-456789-0" },
  ];
  const preview = createCitationImportPreview(existing, incoming);
  assert.equal(preview.counts.duplicate, 1);
  assert.equal(preview.counts.new, 1);
  assert.equal(mergeCitationImportPreview(existing, preview).length, 2);
  assert.deepEqual(normalizeCitationStyleChoice({ styleId: "apa-7", locale: "EN-us" }), {
    styleId: "apa-7",
    locale: "en-US",
  });
  const hash = "c".repeat(64);
  const styleId = `custom-${hash.slice(0, 24)}`;
  assert.deepEqual(normalizeCitationStyleChoice({
    styleId,
    locale: "zh-cn",
    customStyle: {
      styleId,
      title: "本地样式",
      hash,
      xml: '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"></style>',
    },
  }), {
    styleId,
    locale: "zh-CN",
    customStyle: {
      styleId,
      title: "本地样式",
      hash,
      xml: '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"></style>',
    },
  });
});

test("citation fallback identity includes first author and conflicts can be kept twice or skipped", () => {
  const existing = [{
    id: CURRENT_ID,
    citationKey: "",
    title: "Shared title",
    authors: ["Alice Zhang"],
    year: "2026",
  }];
  const differentAuthor = [{
    id: IMPORT_ID,
    citationKey: "",
    title: "Shared title",
    authors: ["Bob Li"],
    year: "2026",
  }];
  assert.equal(createCitationImportPreview(existing, differentAuthor).counts.new, 1);

  const matchingAuthor = [{
    id: IMPORT_ID,
    citationKey: "",
    title: "Shared title",
    authors: ["Alice Zhang"],
    year: "2026",
    publisher: "Imported publisher",
  }];
  const preview = createCitationImportPreview(existing, matchingAuthor);
  assert.equal(preview.counts.conflict, 1);
  assert.deepEqual(mergeCitationImportPreview(existing, preview, { [IMPORT_ID]: "skip" }), existing);

  const COPY_ID = "33333333-3333-4333-8333-333333333333";
  const kept = mergeCitationImportPreview(
    existing,
    preview,
    { [IMPORT_ID]: "keep-both" },
    { idFactory: () => COPY_ID },
  );
  assert.equal(kept.length, 2);
  assert.equal(kept[0].id, CURRENT_ID);
  assert.equal(kept[1].id, COPY_ID);
  assert.equal(kept[1].publisher, "Imported publisher");
});

test("custom CSL picker result keeps the validated nested style payload", () => {
  const hash = "d".repeat(64);
  const styleId = `custom-${hash.slice(0, 24)}`;
  const xml = '<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"></style>';
  assert.deepEqual(citationStyleChoiceFromPickerResult({
    canceled: false,
    style: {
      styleId,
      locale: "en-US",
      customStyle: { styleId, title: "Imported", hash, xml },
    },
  }), {
    styleId,
    locale: "en-US",
    customStyle: { styleId, title: "Imported", hash, xml },
  });
  assert.equal(citationStyleChoiceFromPickerResult({
    style: {
      styleId,
      customStyle: { styleId: "custom-invalid", title: "Bad", hash, xml },
    },
  }), null);
});
