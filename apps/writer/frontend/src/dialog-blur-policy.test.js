import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readAppStyles } from "./style-test-utils.js";

const sourceUrl = (name) => new URL(name, import.meta.url);

async function source(name) {
  return readFile(sourceUrl(name), "utf8");
}

function cssRuleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || "";
}

test("dialog scrims default to clear and require an explicit large opt-in for blur", async () => {
  const css = await readAppStyles();
  const compact = cssRuleBody(css, ".dialog-scrim");
  const large = cssRuleBody(css, ".dialog-scrim.dialog-scrim--large");

  assert.match(compact, /-webkit-backdrop-filter:\s*none\s*!important/);
  assert.match(compact, /backdrop-filter:\s*none\s*!important/);
  assert.match(large, /backdrop-filter:\s*blur\(10px\)\s+saturate\(1\.04\)\s*!important/);
});

test("only full-context dialogs opt into the large blur policy", async () => {
  const [helpCenter, chooser, releaseNotes, settingsCenter, templateDialog, aiSettingsDialog] = await Promise.all([
    source("./app-shell/HelpCenter.jsx"),
    source("./AiModeChooser.jsx"),
    source("./ReleaseNotesDialog.jsx"),
    source("./SettingsCenter.jsx"),
    source("./templates/LetterTemplateDialog.jsx"),
    source("./ai-settings/AiSettingsDialog.jsx"),
  ]);

  assert.match(chooser, /ai-mode-chooser-layer dialog-scrim dialog-scrim--large/);
  assert.match(releaseNotes, /release-notes-overlay dialog-scrim dialog-scrim--large/);
  assert.match(templateDialog, /template-dialog-overlay dialog-scrim dialog-scrim--large/);
  assert.match(aiSettingsDialog, /ai-settings-overlay dialog-scrim dialog-scrim--large/);
  assert.match(helpCenter, /help-center-overlay dialog-scrim dialog-scrim--large/);
  assert.match(helpCenter, /help-image-preview-overlay dialog-scrim dialog-scrim--large/);
  assert.match(settingsCenter, /settings-center-overlay dialog-scrim"/);
  assert.doesNotMatch(settingsCenter, /settings-center-overlay dialog-scrim dialog-scrim--large/);
});

test("compact dialogs, nested dialogs, palettes and prompts all use the clear scrim", async () => {
  const [appDialogs, webDialogs, linkDialogs, aiSelectors, exportDialog, templateDialog, aiSettingsDialog, citation, knowledge, search] = await Promise.all([
    source("./app-shell/AppDialogs.jsx"),
    source("./app-shell/WebDialogs.jsx"),
    source("./app-shell/LinkDialogs.jsx"),
    source("./ai/Selectors.jsx"),
    source("./export/ExportDialog.jsx"),
    source("./templates/LetterTemplateDialog.jsx"),
    source("./ai-settings/AiSettingsDialog.jsx"),
    source("./CitationPickerDialog.jsx"),
    source("./KnowledgeDialogs.jsx"),
    source("./WorkspaceSearchPanel.jsx"),
  ]);

  assert.match(aiSettingsDialog, /ai-settings-subdialog-backdrop dialog-scrim/);
  const compactMarkers = [
    "ai-provider-switch-modal-backdrop dialog-scrim",
    "app-confirm-overlay dialog-scrim",
    "web-copy-overlay dialog-scrim",
    "internal-link-picker-overlay dialog-scrim",
  ];
  const applicationSurfaces = `${appDialogs}\n${webDialogs}\n${linkDialogs}\n${aiSelectors}`;
  compactMarkers.forEach((marker) => assert.ok(applicationSurfaces.includes(marker), `missing compact dialog marker: ${marker}`));
  assert.match(exportDialog, /export-dialog-overlay dialog-scrim/);
  assert.match(templateDialog, /template-group-dialog-backdrop dialog-scrim/);
  assert.match(citation, /citation-picker-overlay dialog-scrim/);
  assert.match(knowledge, /app-confirm-overlay dialog-scrim/);
  assert.match(search, /workspace-search-overlay dialog-scrim/);
  assert.doesNotMatch(`${applicationSurfaces}\n${exportDialog}\n${templateDialog}\n${aiSettingsDialog}\n${citation}\n${knowledge}\n${search}`, /noBackdropBlur|no-backdrop-blur/);
});

test("no overlay-specific rule can reintroduce blur outside the shared policy", async () => {
  const stylesheets = await Promise.all([
    readAppStyles(),
    source("./ai-mode-chooser.css"),
    source("./settings-center.css"),
    source("./citation-picker.css"),
    source("./workspace-features.css"),
  ]);
  const forbidden = [];
  for (const css of stylesheets) {
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = match[1].trim();
      const body = match[2];
      if (!/(overlay|backdrop|chooser-layer)/.test(selector)) continue;
      if (/dialog-scrim\.dialog-scrim--large/.test(selector)) continue;
      if (/(?:-webkit-)?backdrop-filter:\s*blur/.test(body)) forbidden.push(selector);
    }
  }
  assert.deepEqual(forbidden, []);
});
