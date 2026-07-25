export const TAB_PERSISTENCE_STATE = Object.freeze({
  WORKSPACE: "workspace",
  DIRTY: "dirty",
  RECOVERY: "recovery",
  EXTERNAL: "external",
});

export function deriveTabPersistenceState(tab, liveRevision = 0) {
  if (tab?.externalChanged) return TAB_PERSISTENCE_STATE.EXTERNAL;
  if (!tab?.dirty) return TAB_PERSISTENCE_STATE.WORKSPACE;
  if (
    tab?.recoveryPath
    && Number.isFinite(tab?.recoveryRevision)
    && tab.recoveryRevision === (Number(liveRevision) || 0)
  ) {
    return TAB_PERSISTENCE_STATE.RECOVERY;
  }
  if (tab?.dirty) return TAB_PERSISTENCE_STATE.DIRTY;
  return TAB_PERSISTENCE_STATE.WORKSPACE;
}
