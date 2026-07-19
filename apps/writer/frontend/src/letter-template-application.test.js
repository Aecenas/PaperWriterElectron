import assert from "node:assert/strict";
import test from "node:test";
import { applyLetterTemplateToDocument, createLetterTemplatePatch } from "./letter-template-application.js";

const template = {
  id: "paper-warm",
  paperId: "warm",
  typography: { bodyFont: "Noto Serif SC", bodySize: 17 },
};

test("builds a stable document patch for a letter template", () => {
  assert.deepEqual(createLetterTemplatePatch(template, "2026-07-16T00:00:00.000Z"), {
    letterTemplateId: "paper-warm",
    templateId: "warm",
    fontFamily: "Noto Serif SC",
    fontSize: 17,
    customBackground: "",
    updatedAt: "2026-07-16T00:00:00.000Z",
  });
});

test("applies template presentation fields without replacing document content", () => {
  const source = { title: "保留标题", html: "<p>保留正文</p>", customBackground: "data:image/png;base64,old" };
  const result = applyLetterTemplateToDocument(source, template, "2026-07-16T00:00:00.000Z");
  assert.equal(result.title, source.title);
  assert.equal(result.html, source.html);
  assert.equal(result.letterTemplateId, template.id);
  assert.equal(result.templateId, template.paperId);
  assert.equal(result.customBackground, "");
});

test("leaves the source unchanged when a template is invalid", () => {
  const source = { title: "不变" };
  assert.equal(applyLetterTemplateToDocument(source, null), source);
  assert.equal(applyLetterTemplateToDocument(source, { id: "missing-paper" }), source);
});
