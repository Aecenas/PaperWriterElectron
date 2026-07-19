import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dialogSource = fs.readFileSync(new URL("./ReleaseNotesDialog.jsx", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

test("release notes dialog exposes phase and major-version navigation", () => {
  assert.match(dialogSource, /className="release-notes-phase-nav"/);
  assert.match(dialogSource, /RELEASE_PHASES\.map/);
  assert.match(dialogSource, /phase\.majorReleases\.map/);
  assert.match(dialogSource, /handlePhaseClick/);
  assert.match(dialogSource, /handleMajorReleaseClick/);
  assert.match(dialogSource, /activePhaseId/);
  assert.match(dialogSource, /activeMajorVersion/);
});

test("release notes scroll sync, reduced motion and full focus loop remain wired", () => {
  assert.match(dialogSource, /onScroll=\{handleTimelineScroll\}/);
  assert.match(dialogSource, /syncNavigationToScroll/);
  assert.match(dialogSource, /prefers-reduced-motion: reduce/);
  assert.match(dialogSource, /scrollTo\(\{ top, behavior: reducedMotion \? "auto" : "smooth" \}\)/);
  assert.match(dialogSource, /focusableElements\(dialogRef\.current\)/);
  assert.match(dialogSource, /const activeIndex = elements\.indexOf\(activeElement\)/);
  assert.match(dialogSource, /elements\[nextIndex\]\?\.focus\(\)/);
});

test("release notes layout has independent panes and a stacked narrow mode", () => {
  assert.match(stylesSource, /\.release-notes-body\s*\{[\s\S]*?grid-template-columns:\s*250px minmax\(0, 1fr\)/);
  assert.match(stylesSource, /\.release-notes-phase-list\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(stylesSource, /\.release-notes-scroll\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(stylesSource, /@media \(max-width: 860px\)[\s\S]*?\.release-notes-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(stylesSource, /\.release-notes-scale-badge\.major/);
  assert.match(stylesSource, /\.release-notes-scale-badge\.minor/);
});

test("release hierarchy distinguishes phase summaries and release scales", () => {
  assert.match(dialogSource, /className="release-notes-phase-stats"/);
  assert.match(dialogSource, /<div className="major">[\s\S]*?<dt>大版本<\/dt>[\s\S]*?\{phase\.majorCount\}/);
  assert.match(dialogSource, /<div className="minor">[\s\S]*?<dt>小版本<\/dt>[\s\S]*?\{phase\.minorCount\}/);
  assert.match(stylesSource, /\.release-notes-phase-list > section \+ section\s*\{[\s\S]*?border-top-color:/);
  assert.match(stylesSource, /\.release-notes-phase-stats > div\.major/);
  assert.match(stylesSource, /\.release-notes-phase-stats > div\.minor/);
  assert.match(stylesSource, /\.release-notes-phase-stats\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(stylesSource, /\.release-notes-phase-stats > div\s*\{[\s\S]*?border-radius:\s*999px/);
  assert.match(stylesSource, /\.scale-major \.release-notes-version-row > strong\s*\{[\s\S]*?font-size:\s*17px/);
  assert.match(stylesSource, /\.scale-minor \.release-notes-version-row > strong\s*\{[\s\S]*?font-size:\s*13px/);
  assert.match(stylesSource, /\.release-notes-current\s*\{[\s\S]*?border-radius:\s*999px/);
});
