import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_PREVIEW_ZOOM_LEVELS,
  imagePreviewFitZoom,
  nextImagePreviewZoom,
  visibleImagePoint,
} from "./image-preview-model.js";

test("image preview zoom follows fixed levels and clamps at both ends", () => {
  assert.deepEqual(IMAGE_PREVIEW_ZOOM_LEVELS, [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]);
  assert.equal(nextImagePreviewZoom(0.42, 1), 0.5);
  assert.equal(nextImagePreviewZoom(0.42, -1), 0.25);
  assert.equal(nextImagePreviewZoom(4, 1), 4);
  assert.equal(nextImagePreviewZoom(0.1, -1), 0.1);
});

test("image preview fit uses both stage axes without enlarging small images", () => {
  assert.equal(imagePreviewFitZoom({ naturalWidth: 400, naturalHeight: 200, stageWidth: 1000, stageHeight: 800 }), 1);
  assert.equal(imagePreviewFitZoom({ naturalWidth: 2000, naturalHeight: 1000, stageWidth: 1036, stageHeight: 536 }), 0.5);
});

test("image copy coordinates target only the visible stage intersection", () => {
  assert.deepEqual(visibleImagePoint(
    { left: -100, top: 40, right: 500, bottom: 640 },
    { left: 20, top: 80, right: 420, bottom: 580 },
    { width: 800, height: 600 },
  ), { x: 220, y: 330 });
  assert.equal(visibleImagePoint(
    { left: -100, top: -100, right: -20, bottom: -20 },
    { left: 0, top: 0, right: 400, bottom: 400 },
    { width: 800, height: 600 },
  ), null);
});
