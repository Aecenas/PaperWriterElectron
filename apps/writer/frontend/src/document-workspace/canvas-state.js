export function readCanvasScrollState(canvas) {
  if (!canvas) {
    return { top: 0, left: 0 };
  }
  return {
    top: Math.max(0, Math.round(canvas.scrollTop || 0)),
    left: Math.max(0, Math.round(canvas.scrollLeft || 0)),
  };
}

export function restoreCanvasScrollState(canvas, scrollState) {
  if (!canvas) {
    return;
  }
  canvas.scrollTop = Math.max(0, Number(scrollState?.top) || 0);
  canvas.scrollLeft = Math.max(0, Number(scrollState?.left) || 0);
}
