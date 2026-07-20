import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildReleasePhases,
  CURRENT_RELEASE_VERSION,
  RELEASE_NOTES,
  RELEASE_PHASE_DEFINITIONS,
  RELEASE_PHASES,
} from "./release-notes.js";

test("release notes start with the package version and remain complete", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(CURRENT_RELEASE_VERSION, packageJson.version);
  assert.equal(RELEASE_NOTES[0].version, packageJson.version);
  assert.equal(new Set(RELEASE_NOTES.map((release) => release.version)).size, RELEASE_NOTES.length);
  assert.ok(RELEASE_NOTES.length >= 15);
  assert.ok(RELEASE_NOTES.every((release) => release.version && /^\d+\.\d+\.\d+$/.test(release.version)));
  assert.ok(RELEASE_NOTES.every((release) => /^\d{4}-\d{2}-\d{2}$/.test(release.date)));
  assert.ok(RELEASE_NOTES.every((release) => release.title && release.changes.length > 0));
  assert.ok(RELEASE_NOTES.every((release) => RELEASE_PHASE_DEFINITIONS.some((phase) => phase.id === release.phaseId)));
  assert.ok(RELEASE_NOTES.every((release) => release.scale === "major" || release.scale === "minor"));
});

test("release notes are ordered newest first", () => {
  const dates = RELEASE_NOTES.map((release) => release.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("release phases cover the timeline exactly once and remain contiguous", () => {
  const phaseVersions = RELEASE_PHASES.flatMap((phase) => phase.releases.map((release) => release.version));
  assert.deepEqual(phaseVersions, RELEASE_NOTES.map((release) => release.version));
  assert.equal(new Set(phaseVersions).size, RELEASE_NOTES.length);
  assert.ok(RELEASE_PHASES.every((phase) => phase.releases.length > 0));
  assert.ok(RELEASE_PHASES.every((phase) => phase.majorReleases.length > 0));

  for (const phase of RELEASE_PHASES) {
    const positions = RELEASE_NOTES
      .map((release, index) => release.phaseId === phase.id ? index : -1)
      .filter((index) => index >= 0);
    assert.equal(positions.at(-1) - positions[0] + 1, positions.length);
  }
});

test("release phase ranges and major/minor totals are derived from release data", () => {
  assert.equal(RELEASE_PHASES.length, 4);
  assert.equal(RELEASE_PHASES.reduce((total, phase) => total + phase.majorCount, 0), 8);
  assert.equal(RELEASE_PHASES.reduce((total, phase) => total + phase.minorCount, 0), 10);
  assert.deepEqual(
    RELEASE_PHASES.map((phase) => [phase.id, phase.majorCount, phase.minorCount, phase.versionRange]),
    [
      ["research-workspace", 1, 2, "V0.9.8 — V0.9.10"],
      ["intelligent-collaboration", 2, 1, "V0.9.0 — V0.9.2"],
      ["writing-workbench", 1, 2, "V0.8.0 — V0.8.2"],
      ["writing-foundation", 4, 5, "V0.1.0 — V0.2.0"],
    ],
  );
  assert.deepEqual(
    RELEASE_PHASES.flatMap((phase) => phase.majorReleases.map((release) => release.version)),
    ["0.9.8", "0.9.2", "0.9.0", "0.8.0", "0.2.0", "0.1.6", "0.1.1", "0.1.0"],
  );
  assert.ok(RELEASE_PHASES.every((phase) => phase.latestRelease === phase.releases[0]));
  assert.ok(RELEASE_PHASES.every((phase) => phase.oldestRelease === phase.releases.at(-1)));
  assert.deepEqual(buildReleasePhases(), RELEASE_PHASES);
});

test("the 0.9.8 consolidation remains intact after later maintenance releases", () => {
  const versions = RELEASE_NOTES.map((release) => release.version);
  assert.equal(versions[0], "0.9.10");
  assert.ok(versions.includes("0.9.8"));
  assert.ok(versions.includes("0.9.2"));
  assert.ok(["0.9.3", "0.9.4", "0.9.5", "0.9.6", "0.9.7"].every((version) => !versions.includes(version)));
});
