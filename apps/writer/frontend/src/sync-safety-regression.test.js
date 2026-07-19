import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fs.readFileSync(fileURLToPath(new URL("./App.jsx", import.meta.url)), "utf8");

function between(startMarker, endMarker, fromIndex = 0) {
  const start = source.indexOf(startMarker, fromIndex);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return source.slice(start, end);
}

function ordered(fragment, markers) {
  let previous = -1;
  for (const marker of markers) {
    const current = fragment.indexOf(marker, previous + 1);
    assert.ok(current > previous, `expected marker after previous boundary: ${marker}`);
    previous = current;
  }
}

test("recovery sessions persist the workspace base revision and mark stale restores external", () => {
  const summary = between("function summarizeSessionTabs", "function createDocumentTab");
  assert.match(summary, /recoverySourcePath:\s*typeof tab\?\.recoverySourcePath/);
  assert.match(summary, /recoveryBaseRevision:\s*normalizeSessionDiskRevision\(tab\?\.recoveryBaseRevision \|\| tab\?\.diskRevision\)/);

  const restore = between("if (restoreEntries.length)", "const handleSelectTab");
  ordered(restore, [
    "const recoveryBaseRevision = normalizeSessionDiskRevision(restoreEntry.recoveryBaseRevision)",
    "const logicalRevision = logicalPath ? await bridge.getDocumentRevision?.(logicalPath)",
    "const currentDiskRevision = normalizeSessionDiskRevision(logicalRevision?.diskRevision)",
    "const externalChanged = Boolean(logicalPath",
  ]);
  assert.match(restore, /!sourceMatches\s*\|\|\s*!recoveryBaseRevision\s*\|\|\s*!sameDiskRevision\(currentDiskRevision, recoveryBaseRevision\)/s);
  assert.match(restore, /diskRevision:\s*recoveryBaseRevision/);
  assert.match(restore, /externalChanged/);
  assert.match(restore, /setPersistenceState\(activeTab\.externalChanged \? "external"/);

  const recoveryAutosave = between("const timer = window.setInterval(async () =>", "const flushDirtyWorkspaceTabs");
  assert.match(recoveryAutosave, /baseRevision:\s*normalizeSessionDiskRevision\(diskRevisionByTabRef\.current\.get\(tab\.id\) \|\| tab\.diskRevision\)/);
  assert.match(recoveryAutosave, /recoverySourcePath:\s*update\.sourcePath/);
  assert.match(recoveryAutosave, /recoveryBaseRevision:\s*update\.baseRevision/);
  assert.match(recoveryAutosave, /persistSession\(\{[\s\S]*tabs:\s*summarizeSessionTabs\(nextTabs\)/);
});

test("a manual save that races with continued editing keeps a fresh recovery cache", () => {
  const save = between("const handleSave = useCallback", "bridge.onCloseRequest");
  assert.match(save, /const unchanged = \(liveRevisionByTabRef\.current\.get\(targetTab\.id\) \|\| 0\) === revision/);
  assert.match(save, /const latestSnapshot = unchanged \? openTabsRef\.current : snapshotLiveTabs\(\{ includeEditorJson: true \}\)/);
  assert.match(save, /mergePersistedDocumentIdentity\(latestTargetTab\.document \|\| nextDocument, savedDocument\)/);
  assert.match(save, /if \(unchanged\) \{\s*dirtyTabIdsRef\.current\.delete\(targetTab\.id\);\s*\} else \{[\s\S]*bridge\.saveTempDocument\?\.\([\s\S]*livePersistedDocument/s);
  assert.match(save, /recoveryPath:\s*unchanged \? "" : \(recoveryWrite\?\.path \|\| tab\.recoveryPath \|\| ""\)/);
  assert.match(save, /recoveryBaseRevision:\s*unchanged \? null : \(recoveryWrite\?\.path \? normalizeSessionDiskRevision\(result\.diskRevision\)/);
  assert.match(save, /dirty:\s*!unchanged/);
  assert.match(save, /const recoveryCleaned = unchanged\s*\? await deleteRecoveryBestEffort[\s\S]*:\s*true/);
});

test("successful workspace writes advance diskRevision before any stale-snapshot early exit", () => {
  const save = between("const handleSave = useCallback", "bridge.onCloseRequest");
  ordered(save, [
    "if (result.diskRevision) diskRevisionByTabRef.current.set(targetTab.id, result.diskRevision)",
    "if (unchanged) {",
  ]);

  const flush = between("const flushDirtyWorkspaceTabs = useCallback", "useEffect(() => {\n    const timer = window.setInterval(() => flushDirtyWorkspaceTabs");
  ordered(flush, [
    "if (result.diskRevision) diskRevisionByTabRef.current.set(tab.id, result.diskRevision)",
    "if (!snapshotRevisionIsCurrent(tab, liveRevisionByTabRef.current)) continue",
  ]);
  assert.match(flush, /diskRevision:\s*result\.diskRevision/);
  assert.match(flush, /recoveryBaseRevision:\s*null/);
});
