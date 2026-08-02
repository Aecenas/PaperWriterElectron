export const PROFILE_MIGRATION_SECTIONS = Object.freeze([
  { id: "preferences", label: "界面与编辑偏好", defaultSelected: true },
  { id: "templates", label: "自定义信笺模板", defaultSelected: true },
  { id: "ai", label: "AI 服务商、模型与任务分配", defaultSelected: true },
  { id: "writingAssistance", label: "写作检查与自定义词典", defaultSelected: true },
]);

export const PROFILE_SECRET_PASSWORD_MIN_LENGTH = 12;

export function defaultProfileSectionSelection() {
  return Object.fromEntries(PROFILE_MIGRATION_SECTIONS.map((section) => [section.id, section.defaultSelected]));
}

export function selectedProfileSections(selection) {
  return PROFILE_MIGRATION_SECTIONS
    .filter((section) => selection?.[section.id] !== false)
    .map((section) => section.id);
}

export function validateProfileExportOptions({
  selection,
  includeSecrets = false,
  password = "",
  confirmPassword = "",
} = {}) {
  const sections = selectedProfileSections(selection);
  if (!sections.length) return { valid: false, message: "请至少选择一项配置。" };
  if (!includeSecrets) return { valid: true, message: "", sections, includeSecrets: false, password: "" };
  if (String(password).length < PROFILE_SECRET_PASSWORD_MIN_LENGTH) {
    return { valid: false, message: `口令至少需要 ${PROFILE_SECRET_PASSWORD_MIN_LENGTH} 位。` };
  }
  if (password !== confirmPassword) return { valid: false, message: "两次输入的口令不一致。" };
  return {
    valid: true,
    message: "",
    sections,
    includeSecrets: true,
    password: String(password),
  };
}

export function normalizeProfileImportCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const token = String(candidate.token || candidate.importToken || "");
  if (!token) return null;
  const manifestSections = candidate.manifest?.sections && typeof candidate.manifest.sections === "object"
    ? candidate.manifest.sections
    : {};
  const advertisedSections = Array.isArray(candidate.availableSections)
    ? candidate.availableSections
    : PROFILE_MIGRATION_SECTIONS
      .filter((section) => manifestSections[section.id] !== false)
      .map((section) => section.id);
  return Object.freeze({
    token,
    fileName: String(candidate.fileName || candidate.name || "配置包.jianprofile"),
    schemaVersion: Number(candidate.schemaVersion || candidate.manifest?.schemaVersion || 1),
    requiresPassword: candidate.requiresPassword === true
      || candidate.hasSecrets === true
      || candidate.preview?.includesSecrets === true
      || manifestSections.secrets === true,
    availableSections: Object.freeze(
      selectedProfileSections(
        Object.fromEntries(
          PROFILE_MIGRATION_SECTIONS.map((section) => [
            section.id,
            advertisedSections.includes(section.id),
          ]),
        ),
      ),
    ),
    preview: candidate.preview || null,
  });
}

export function normalizeProfileDiff(preview) {
  const sections = preview?.sections && typeof preview.sections === "object" ? preview.sections : {};
  const fallbackSections = {
    preferences: {
      changed: Array.isArray(preview?.preferenceKeys) ? preview.preferenceKeys.length : 0,
      summary: Array.isArray(preview?.preferenceKeys) && preview.preferenceKeys.length
        ? `配置包包含 ${preview.preferenceKeys.length} 项偏好设置。`
        : "",
    },
    templates: {
      added: Math.max(0, Number(preview?.templateCount) || 0),
      summary: Number(preview?.templateCount) > 0
        ? `配置包包含 ${Number(preview.templateCount)} 个自定义模板。`
        : "",
    },
    ai: {
      changed: Math.max(0, Number(preview?.providerCount) || 0),
      summary: Number(preview?.providerCount) > 0
        ? `配置包包含 ${Number(preview.providerCount)} 个 AI 服务商。`
        : "",
    },
    writingAssistance: {
      changed: Math.max(0, Number(preview?.termRuleCount) || 0),
      summary: Number(preview?.termRuleCount) > 0
        ? `配置包包含 ${Number(preview.termRuleCount)} 条术语规则。`
        : "",
    },
  };
  return PROFILE_MIGRATION_SECTIONS.map((section) => {
    const source = sections[section.id] || fallbackSections[section.id] || {};
    return Object.freeze({
      id: section.id,
      label: section.label,
      changed: Math.max(0, Number(source.changed ?? source.changeCount) || 0),
      added: Math.max(0, Number(source.added ?? source.addCount) || 0),
      conflicts: Math.max(0, Number(source.conflicts ?? source.conflictCount) || 0),
      unchanged: Math.max(0, Number(source.unchanged) || 0),
      summary: String(source.summary || ""),
      items: Object.freeze((Array.isArray(source.items) ? source.items : [])
        .filter((item) => item && typeof item === "object")
        .slice(0, 256)
        .map((item) => Object.freeze({
          key: String(item.key || "").slice(0, 200),
          id: String(item.id || "").slice(0, 200),
          title: String(item.title || "").slice(0, 200),
          wrong: String(item.wrong || "").slice(0, 200),
          preferred: String(item.preferred || "").slice(0, 200),
          action: String(item.action || "").slice(0, 32),
        }))),
      warnings: Object.freeze((Array.isArray(source.warnings) ? source.warnings : [])
        .map((warning) => String(warning || "").trim())
        .filter(Boolean)
        .slice(0, 20)),
    });
  });
}
