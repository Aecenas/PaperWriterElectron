import { useMemo, useState } from "react";

export function useStatusState() {
  return useState(null);
}

export function createStatusActions(setStatus, timerHost) {
  const showStatus = (message, tone = "success", options = {}) => {
    const duration = Number.isFinite(options.duration) ? Math.max(1000, options.duration) : 2800;
    setStatus({ message, tone, dismissible: Boolean(options.dismissible) });
    timerHost.clearTimeout(showStatus.timer);
    showStatus.timer = timerHost.setTimeout(() => setStatus(null), duration);
  };

  const dismissStatus = () => {
    timerHost.clearTimeout(showStatus.timer);
    setStatus(null);
  };

  return { showStatus, dismissStatus };
}

export function useStatusActions(setStatus) {
  return useMemo(() => createStatusActions(setStatus, window), [setStatus]);
}
