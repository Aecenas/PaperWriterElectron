import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PROFILE_SECRET_PASSWORD_MIN_LENGTH,
  defaultProfileSectionSelection,
  normalizeProfileDiff,
  normalizeProfileImportCandidate,
  selectedProfileSections,
  validateProfileExportOptions,
} from "./settings/profile-migration-model.js";

test("profile exports default to all non-secret configuration sections", () => {
  const selection = defaultProfileSectionSelection();
  assert.deepEqual(selectedProfileSections(selection), [
    "preferences",
    "templates",
    "ai",
    "writingAssistance",
  ]);
  assert.deepEqual(validateProfileExportOptions({ selection, includeSecrets: false }), {
    valid: true,
    message: "",
    sections: ["preferences", "templates", "ai", "writingAssistance"],
    includeSecrets: false,
    password: "",
  });
});

test("secret profile export requires matching twelve-character passwords", () => {
  const selection = defaultProfileSectionSelection();
  assert.equal(validateProfileExportOptions({
    selection,
    includeSecrets: true,
    password: "short",
    confirmPassword: "short",
  }).valid, false);
  const password = "a".repeat(PROFILE_SECRET_PASSWORD_MIN_LENGTH);
  assert.equal(validateProfileExportOptions({
    selection,
    includeSecrets: true,
    password,
    confirmPassword: `${password}!`,
  }).message, "两次输入的口令不一致。");
  assert.equal(validateProfileExportOptions({
    selection,
    includeSecrets: true,
    password,
    confirmPassword: password,
  }).valid, true);
});

test("profile import candidate keeps opaque token and advertised sections", () => {
  const candidate = normalizeProfileImportCandidate({
    importToken: "opaque-token",
    name: "迁移.jianprofile",
    manifest: { schemaVersion: 1 },
    hasSecrets: true,
    availableSections: ["templates", "writingAssistance"],
  });
  assert.equal(candidate.token, "opaque-token");
  assert.equal(candidate.fileName, "迁移.jianprofile");
  assert.equal(candidate.requiresPassword, true);
  assert.deepEqual(candidate.availableSections, ["templates", "writingAssistance"]);
});

test("profile import detects encrypted secrets from the inspected manifest preview", () => {
  const candidate = normalizeProfileImportCandidate({
    importToken: "secret-token",
    manifest: {
      schemaVersion: 1,
      sections: { preferences: true, templates: true, ai: true, writingAssistance: true, secrets: true },
    },
    preview: { includesSecrets: true },
  });
  assert.equal(candidate.requiresPassword, true);
  assert.deepEqual(candidate.availableSections, ["preferences", "templates", "ai", "writingAssistance"]);
});

test("profile diff model bounds counts and warnings", () => {
  const diff = normalizeProfileDiff({
    sections: {
      templates: {
        added: 2,
        changed: 1,
        conflicts: 3,
        summary: "冲突模板将生成新 ID。",
        warnings: ["模板 A 将追加“（导入）”"],
      },
    },
  });
  const templates = diff.find((section) => section.id === "templates");
  assert.equal(templates.added, 2);
  assert.equal(templates.conflicts, 3);
  assert.deepEqual(templates.warnings, ["模板 A 将追加“（导入）”"]);
});

test("profile diff adapts the current main-process compact preview", () => {
  const diff = normalizeProfileDiff({
    preferenceKeys: ["theme", "font"],
    templateCount: 3,
    providerCount: 2,
    termRuleCount: 4,
  });
  assert.equal(diff.find((section) => section.id === "preferences").changed, 2);
  assert.equal(diff.find((section) => section.id === "templates").added, 3);
  assert.equal(diff.find((section) => section.id === "writingAssistance").changed, 4);
});

test("profile diff keeps bounded item-level actions and terminology warnings", () => {
  const diff = normalizeProfileDiff({
    sections: {
      writingAssistance: {
        changed: 2,
        conflicts: 1,
        items: [{
          wrong: "帐户",
          preferred: "账户",
          action: "keep-local",
        }],
        warnings: ["1 条术语规则与本机冲突，将保留本机规则。"],
      },
    },
  });
  const writing = diff.find((section) => section.id === "writingAssistance");
  assert.deepEqual(writing.items, [{
    key: "",
    id: "",
    title: "",
    wrong: "帐户",
    preferred: "账户",
    action: "keep-local",
  }]);
  assert.equal(writing.conflicts, 1);
  assert.match(writing.warnings[0], /保留本机/);
});

test("encrypted profile UI verifies its token before rendering the diff preview", () => {
  const source = readFileSync(new URL("./settings/ProfileMigrationPanel.jsx", import.meta.url), "utf8");
  const verification = source.indexOf("bridge.verifyProfile");
  const diff = source.indexOf('className="profile-preview-metrics"');
  assert.ok(verification >= 0);
  assert.ok(diff > verification);
  assert.match(source, /inspection\.verified !== true/);
  assert.match(source, /口令只在内存中/);
});

test("profile import uses prepare, renderer apply, commit, and rollback transaction APIs", () => {
  const source = readFileSync(
    new URL(
      "./settings/profile-import-transaction.js",
      import.meta.url,
    ),
    "utf8",
  );
  const applyPreferences = source.indexOf("onApplyPreferences(prepared.preferences)");
  const applyTemplates = source.indexOf("onApplyTemplates(prepared.templates)");
  const commit = source.indexOf("const committed = await bridge.commitProfileImport");
  const rollback = source.indexOf("run: typeof bridge?.rollbackProfileImport");
  assert.ok(applyPreferences >= 0);
  assert.ok(applyTemplates > applyPreferences);
  assert.ok(commit > applyTemplates);
  assert.ok(rollback > commit);
  assert.match(source, /onApplyTemplates\(previousTemplates\)/);
  assert.match(source, /onApplyPreferences\(previousPreferences\)/);
});

test("profile panel requests a current-state diff and reports retained terminology conflicts", () => {
  const source = readFileSync(
    new URL("./settings/ProfileMigrationPanel.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /currentPreferences: preferences/);
  assert.match(source, /currentTemplates: templates/);
  assert.match(source, /配置导入分项差异/);
  assert.match(source, /术语冲突不会覆盖本机规则/);
  assert.match(source, /applied\?\.termConflicts/);
});

test("profile migration reuses the shared settings dialog frame and a compact step header", () => {
  const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  const panelSource = readFileSync(new URL("./settings/ProfileMigrationPanel.jsx", import.meta.url), "utf8");
  assert.match(appSource, /className="settings-feature-dialog profile-settings-dialog"/);
  assert.match(appSource, /className="settings-feature-dialog-header"/);
  assert.match(appSource, /className="profile-settings-dialog-body"/);
  assert.match(appSource, /id="profile-settings-dialog-title">备份与迁移/);
  assert.match(appSource, /aria-label="关闭备份与迁移"/);
  assert.match(panelSource, /function ProfileMigrationStepHeader/);
  assert.match(panelSource, /title="选择迁移方式"/);
  assert.doesNotMatch(panelSource, /eyebrow="配置迁移"/);
  assert.doesNotMatch(panelSource, /<h2>备份与迁移<\/h2>/);
});

test("profile migration internals reuse the writing-settings hierarchy and controls", () => {
  const panelSource = readFileSync(new URL("./settings/ProfileMigrationPanel.jsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./styles-data-safety.css", import.meta.url), "utf8");
  const componentCss = readFileSync(new URL("./settings/profile-migration.css", import.meta.url), "utf8");
  [
    'className="profile-migration-panel profile-migration-export-step"',
    'role="switch"',
    'className={includeSecrets ? "profile-migration-switch checked" : "profile-migration-switch"}',
    'className="profile-import-drop-icon"',
    'className="profile-import-drop-copy"',
    "仅支持由笺间导出的 .jianprofile 配置包",
    'className="profile-migration-panel profile-migration-preview-step"',
  ].forEach((marker) => assert.ok(panelSource.includes(marker), `missing migration UI marker: ${marker}`));
  assert.match(css, /\.profile-secret-toggle\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.profile-migration-switch\.checked i\s*\{[\s\S]*?translateX\(18px\)/);
  assert.match(css, /\.profile-import-drop\s*\{[\s\S]*?width:\s*min\(520px, 100%\)[\s\S]*?min-height:\s*300px/);
  assert.match(css, /\.profile-settings-dialog \.profile-migration-panel \.settings-primary\s*\{[\s\S]*?linear-gradient/);
  assert.match(css, /\.profile-migration-export-step \.profile-migration-back[\s\S]*?position:\s*absolute/);
  assert.match(css, /\.settings-feature-dialog-header \.writing-settings-titlecopy[\s\S]*?display:\s*none/);
  assert.match(css, /\.profile-migration-option-icon\s*\{[\s\S]*?background:\s*#f2dfce/);
  assert.match(componentCss, /\.profile-migration-options > button > \.profile-migration-option-icon[\s\S]*?color:\s*#a45531[\s\S]*?background:\s*#f2dfce/);
  assert.doesNotMatch(componentCss, /\.profile-migration-options > button > span\s*\{/);
});
