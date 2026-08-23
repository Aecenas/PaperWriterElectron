export const IMAGE_PREVIEW_ZOOM_LEVELS = Object.freeze([
  0.1,
  0.25,
  0.5,
  0.75,
  1,
  1.25,
  1.5,
  2,
  3,
  4,
]);

export function nextImagePreviewZoom(currentZoom, direction) {
  const current = Number.isFinite(currentZoom) && currentZoom > 0 ? currentZoom : 1;
  if (direction > 0) {
    return IMAGE_PREVIEW_ZOOM_LEVELS.find((level) => level > current + 0.001)
      || IMAGE_PREVIEW_ZOOM_LEVELS.at(-1);
  }
  return IMAGE_PREVIEW_ZOOM_LEVELS.findLast((level) => level < current - 0.001)
    || Math.min(current, IMAGE_PREVIEW_ZOOM_LEVELS[0]);
}

export function imagePreviewFitZoom({
  naturalWidth,
  naturalHeight,
  stageWidth,
  stageHeight,
  padding = 36,
} = {}) {
  const width = Math.max(1, Number(naturalWidth) || 1);
  const height = Math.max(1, Number(naturalHeight) || 1);
  const availableWidth = Math.max(1, (Number(stageWidth) || width) - padding);
  const availableHeight = Math.max(1, (Number(stageHeight) || height) - padding);
  return Math.max(0.01, Math.min(1, availableWidth / width, availableHeight / height));
}

export function visibleImagePoint(imageRect, stageRect, viewport = {}) {
  if (!imageRect || !stageRect) return null;
  const viewportWidth = Math.max(0, Number(viewport.width) || Number(globalThis.innerWidth) || 0);
  const viewportHeight = Math.max(0, Number(viewport.height) || Number(globalThis.innerHeight) || 0);
  const left = Math.max(0, imageRect.left, stageRect.left);
  const top = Math.max(0, imageRect.top, stageRect.top);
  const right = Math.min(viewportWidth, imageRect.right, stageRect.right);
  const bottom = Math.min(viewportHeight, imageRect.bottom, stageRect.bottom);
  if (!(right > left) || !(bottom > top)) return null;
  return {
    x: Math.floor((left + right) / 2),
    y: Math.floor((top + bottom) / 2),
  };
}
