import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = (name) => new URL(name, import.meta.url);

async function source(name) {
  return readFile(sourceUrl(name), "utf8");
}

function cssRuleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] || "";
}

test("dialog scrims default to clear and require an explicit large opt-in for blur", async () => {
  const css = await source("./styles.css");
  const compact = cssRuleBody(css, ".dialog-scrim");
  const large = cssRuleBody(css, ".dialog-scrim.dialog-scrim--large");

  assert.match(compact, /-webkit-backdrop-filter:\s*none\s*!important/);
  assert.match(compact, /backdrop-filter:\s*none\s*!important/);
  assert.match(large, /backdrop-filter:\s*blur\(10px\)\s+saturate\(1\.04\)\s*!important/);
});

test("only full-context dialogs opt into the large blur policy", async () => {
  const [app, chooser, releaseNotes, settingsCenter] = await Promise.all([
    source("./App.jsx"),
    source("./AiModeChooser.jsx"),
    source("./ReleaseNotesDialog.jsx"),
    source("./SettingsCenter.jsx"),
  ]);

  assert.match(chooser, /ai-mode-chooser-layer dialog-scrim dialog-scrim--large/);
  assert.match(releaseNotes, /release-notes-overlay dialog-scrim dialog-scrim--large/);
  assert.match(app, /template-dialog-overlay dialog-scrim dialog-scrim--large/);
  assert.match(app, /ai-settings-overlay dialog-scrim dialog-scrim--large/);
  assert.match(app, /help-center-overlay dialog-scrim dialog-scrim--large/);
  assert.match(app, /help-image-preview-overlay dialog-scrim dialog-scrim--large/);
  assert.match(settingsCenter, /settings-center-overlay dialog-scrim"/);
  assert.doesNotMatch(settingsCenter, /settings-center-overlay dialog-scrim dialog-scrim--large/);
});

test("compact dialogs, nested dialogs, palettes and prompts all use the clear scrim", async () => {
  const [app, citation, knowledge, search] = await Promise.all([
    source("./App.jsx"),
    source("./CitationPickerDialog.jsx"),
    source("./KnowledgeDialogs.jsx"),
    source("./WorkspaceSearchPanel.jsx"),
  ]);

  const compactMarkers = [
    "export-dialog-overlay dialog-scrim",
    "template-group-dialog-backdrop dialog-scrim",
    "ai-settings-subdialog-backdrop dialog-scrim",
    "ai-provider-switch-modal-backdrop dialog-scrim",
    "app-confirm-overlay dialog-scrim",
    "web-copy-overlay dialog-scrim",
    "internal-link-picker-overlay dialog-scrim",
  ];
  compactMarkers.forEach((marker) => assert.ok(app.includes(marker), `missing compact dialog marker: ${marker}`));
  assert.match(citation, /citation-picker-overlay dialog-scrim/);
  assert.match(knowledge, /app-confirm-overlay dialog-scrim/);
  assert.match(search, /workspace-search-overlay dialog-scrim/);
  assert.doesNotMatch(`${app}\n${citation}\n${knowledge}\n${search}`, /noBackdropBlur|no-backdrop-blur/);
});

test("no overlay-specific rule can reintroduce blur outside the shared policy", async () => {
  const stylesheets = await Promise.all([
    source("./styles.css"),
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
