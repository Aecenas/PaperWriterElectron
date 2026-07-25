import { useCallback, useState } from "react";

export function useHelpReleaseState() {
  const [helpOpen, setHelpOpen] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  return {
    helpOpen,
    setHelpOpen,
    releaseNotesOpen,
    setReleaseNotesOpen,
  };
}

export function useHelpReleaseActions(setHelpOpen, setReleaseNotesOpen) {
  const openHelpCenter = useCallback(() => {
    setHelpOpen(true);
  }, []);

  const closeHelpCenter = useCallback(() => {
    setHelpOpen(false);
  }, []);

  const openReleaseNotes = useCallback(() => {
    setReleaseNotesOpen(true);
  }, []);

  const closeReleaseNotes = useCallback(() => {
    setReleaseNotesOpen(false);
  }, []);

  return {
    openHelpCenter,
    closeHelpCenter,
    openReleaseNotes,
    closeReleaseNotes,
  };
}
