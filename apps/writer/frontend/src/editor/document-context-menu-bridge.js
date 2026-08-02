function boundedCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100_000, Math.round(number)));
}

export function canUseElectronDocumentContextMenu(bridge) {
  return Boolean(
    bridge?.isElectron
    && typeof bridge.onDocumentContextMenuRequest === "function",
  );
}

export function installElectronDocumentContextMenuBridge({
  bridge,
  documentObject,
  getCanvas,
  onContextMenu,
}) {
  if (
    !canUseElectronDocumentContextMenu(bridge)
    || typeof getCanvas !== "function"
    || typeof onContextMenu !== "function"
  ) {
    return () => {};
  }
  const ownerDocument = documentObject
    || (typeof document !== "undefined" ? document : null);
  return bridge.onDocumentContextMenuRequest((payload = {}) => {
    const clientX = boundedCoordinate(payload?.x);
    const clientY = boundedCoordinate(payload?.y);
    const canvas = getCanvas();
    if (clientX === null || clientY === null || !canvas) return;

    const target = ownerDocument?.elementFromPoint?.(clientX, clientY) || null;
    const insideTarget = target && (
      target === canvas
      || canvas.contains?.(target)
    );
    if (!insideTarget) return;

    onContextMenu({
      clientX,
      clientY,
      target: target || canvas,
      currentTarget: canvas,
      preventDefault() {},
      stopPropagation() {},
    });
  });
}
