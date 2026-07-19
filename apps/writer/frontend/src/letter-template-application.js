export function createLetterTemplatePatch(letterTemplate, updatedAt = new Date().toISOString()) {
  if (!letterTemplate?.id || !letterTemplate?.paperId || !letterTemplate?.typography) {
    return null;
  }
  return {
    letterTemplateId: letterTemplate.id,
    templateId: letterTemplate.paperId,
    fontFamily: letterTemplate.typography.bodyFont,
    fontSize: letterTemplate.typography.bodySize,
    customBackground: "",
    updatedAt,
  };
}

export function applyLetterTemplateToDocument(document, letterTemplate, updatedAt = new Date().toISOString()) {
  const patch = createLetterTemplatePatch(letterTemplate, updatedAt);
  if (!document || !patch) return document;
  return { ...document, ...patch };
}
