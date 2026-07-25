import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { summarizeSessionTabs } from "./document-workspace/model.js";

const source = fs.readFileSync(fileURLToPath(new URL("./App.jsx", import.meta.url)), "utf8");
const sessionControllerSource = fs.readFileSync(
  fileURLToPath(new URL("./document-workspace/document-session-controller.js", import.meta.url)),
  "utf8",
);
const persistenceControllerSource = fs.readFileSync(
  fileURLToPath(new URL("./document-workspace/document-persistence-controller.js", import.meta.url)),
  "utf8",
);

function betweenSource(targetSource, startMarker, endMarker, fromIndex = 0) {
  const start = targetSource.indexOf(startMarker, fromIndex);
  const end = targetSource.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing marker: ${endMarker}`);
  return targetSource.slice(start, end);
}

function between(startMarker, endMarker, fromIndex = 0) {
  return betweenSource(source, startMarker, endMarker, fromIndex);
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
  const diskRevision = { size: 12, mtimeMs: 34, sha256: "a".repeat(64) };
  assert.deepEqual(summarizeSessionTabs([{
    path: "C:\\letters\\draft.letterpaper",
    recoveryPath: "C:\\recovery\\draft.letterpaper",
    recoverySourcePath: 42,
    diskRevision,
  }]), [{
    path: "C:\\letters\\draft.letterpaper",
    recoveryPath: "C:\\recovery\\draft.letterpaper",
    recoveryId: "",
    recoverySourcePath: "C:\\letters\\draft.letterpaper",
    recoveryBaseRevision: diskRevision,
    temporary: false,
  }]);

  const restore = betweenSource(
    sessionControllerSource,
    "const openRestoredTab",
    "const restoreDocumentsAndGroups",
  );
  ordered(restore, [
    "const recoveryBaseRevision = normalizeSessionDiskRevision(",
    "logicalRevision = await documentIoPort.getDocumentRevision(logicalPath)",
    "const currentDiskRevision = normalizeSessionDiskRevision(",
    "const externalChanged = Boolean(logicalPath",
  ]);
  assert.match(restore, /!sourceMatches\s*\|\|\s*!recoveryBaseRevision\s*\|\|\s*!sameDiskRevision\(currentDiskRevision, recoveryBaseRevision\)/s);
  assert.match(restore, /diskRevision:\s*recoveryBaseRevision/);
  assert.match(restore, /externalChanged/);
  const sessionComposition = between(
    "const documentSessionController = useMemo(",
    "documentSessionControllerRef.current = documentSessionController",
  );
  assert.match(
    sessionComposition,
    /getDocumentRevision: \(path\) => bridge\.getDocumentRevision\?\.\(path\)/,
  );
  assert.match(source, /const restoreOperation = documentSessionController\.beginRestore\(\)/);
  assert.match(source, /const activeWorkPersistenceState = deriveTabPersistenceState\(/);
  assert.match(source, /persistenceState=\{activeWorkPersistenceState\}/);
  assert.match(source, /externalVersion=\{Boolean\(activeWorkTab\?\.externalChanged\)\}/);

  const recoveryAutosave = betweenSource(
    persistenceControllerSource,
    "const runRecoveryAutosave = async",
    "const flushDirtyWorkspaceTabs = async",
  );
  assert.match(
    recoveryAutosave,
    /baseRevision:\s*normalizeSessionDiskRevision\(\s*revisionPort\.readDiskRevision\(tab\.id\)\s*\|\|\s*tab\.diskRevision,\s*\)/,
  );
  assert.match(recoveryAutosave, /recoverySourcePath:\s*update\.sourcePath/);
  assert.match(recoveryAutosave, /recoveryBaseRevision:\s*update\.baseRevision/);
  assert.match(recoveryAutosave, /appliedUpdates\.forEach\(\(update, tabId\)/);
  assert.match(recoveryAutosave, /sessionStatePort\.commitSessionPatch\(\{[\s\S]*tabs:\s*summarizeSessionTabs\(nextTabs\)/);
});

test("a manual save that races with continued editing keeps a fresh recovery cache", () => {
  const save = betweenSource(
    persistenceControllerSource,
    "const save = async",
    "const closeTab = async",
  );
  assert.match(save, /const unchanged = \(\s*revisionPort\.readLiveRevision\(targetTab\.id\) === revision\s*\)/);
  assert.match(save, /const latestSnapshot = unchanged\s*\? readDocuments\(\)\.tabs\s*:\s*snapshotTabs\(\{ includeEditorJson: true \}\)/);
  assert.match(save, /mergePersistedDocumentIdentity\(\s*latestTargetTab\.document \|\| nextDocument,\s*savedDocument,\s*\)/);
  assert.match(save, /if \(unchanged\) \{\s*dirtyPort\.markClean\(targetTab\.id\);\s*dirtyPort\.commitRecoveryRevision\(targetTab\.id, null\);\s*\} else \{[\s\S]*documentIoPort\.saveTempDocument\?\.\([\s\S]*livePersistedDocument/s);
  assert.match(save, /recoveryPath:\s*unchanged\s*\?\s*""\s*:\s*\(recoveryWrite\?\.path \|\| tab\.recoveryPath \|\| ""\)/);
  assert.match(save, /recoveryBaseRevision:\s*unchanged\s*\?\s*null\s*:\s*\(\s*recoveryWrite\?\.path\s*\?\s*normalizeSessionDiskRevision\(result\.diskRevision\)/);
  assert.match(save, /dirty:\s*!unchanged/);
  assert.match(save, /const recoveryCleaned = unchanged\s*\? await deleteRecoveryBestEffort[\s\S]*:\s*true/);
});

test("successful workspace writes advance diskRevision before any stale-snapshot early exit", () => {
  const save = betweenSource(
    persistenceControllerSource,
    "const save = async",
    "const closeTab = async",
  );
  ordered(save, [
    "revisionPort.commitDiskRevision(",
    "if (unchanged) {",
  ]);

  const flush = betweenSource(
    persistenceControllerSource,
    "const flushDirtyWorkspaceTabs = async",
    "const startLifecycle = ({ resolveController } = {}) =>",
  );
  ordered(flush, [
    "revisionPort.commitDiskRevision(tab.id, result.diskRevision)",
    "if (!snapshotRevisionIsCurrent(tab, revisionPort)) continue",
    "dirtyPort.markClean(tab.id)",
  ]);
  assert.match(flush, /diskRevision:\s*result\.diskRevision/);
  assert.match(flush, /recoveryBaseRevision:\s*null/);
});
