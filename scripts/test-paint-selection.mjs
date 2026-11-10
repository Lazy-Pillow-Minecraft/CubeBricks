import assert from 'node:assert/strict';
import { paintSelectionAllows, faceRectangleFrame, faceRectanglePlanePoint,
  faceRectangleCoordinates, faceRectangleWorldPoint } from '../src/paint/selection-controller.js';
import { transformSelectedPixels, mapSelectionPoint } from '../src/paint/selection-transform.js';
import { captureSelectionPatch, preparePixelSelection, renderPixelSelection, selectionGestureMatrix } from '../src/paint/selection-gesture.js';
import { HANDLE_SIZE, selectionHandleProjection } from '../src/paint/selection-frame.js';
import { paintDragAcceptsHit, sceneBrushBranchKey } from '../src/paint/scene-controller.js';

assert.equal(paintDragAcceptsHit({ bucketDrag: true }, { uid: 'next', faceName: 'north' }), true,
  'the 3D bucket may keep filling after crossing onto another face or cube');
assert.equal(paintDragAcceptsHit({ uid: 'first', faceName: 'north' }, { uid: 'next', faceName: 'north' }), false,
  'a single-face shape stroke remains restricted to its starting face');

const state = { paintSelection: { active: false, masks: new Map() } };
assert.equal(paintSelectionAllows(state, 'a', 0, 0, 2, 2), true);
state.paintSelection.active = true;
assert.equal(paintSelectionAllows(state, 'a', 0, 0, 2, 2), false);
state.paintSelection.masks.set('a', { width: 2, height: 2, pixels: new Uint8Array([0, 1, 0, 0]) });
assert.equal(paintSelectionAllows(state, 'a', 1, 0, 2, 2), true);
assert.equal(paintSelectionAllows(state, 'a', 0, 0, 2, 2), false);
assert.equal(paintSelectionAllows(state, 'b', 1, 0, 2, 2), false);
assert.equal(paintSelectionAllows(state, 'a', 1, 0, 4, 4), false);
const face = faceRectangleFrame({ point: [2, 2, 0], facePoints: [
  [0, 0, 0], [4, 0, 0], [0, 4, 0], [4, 4, 0]
] });
assert.deepEqual(faceRectangleCoordinates(face, faceRectanglePlanePoint(face, {
  origin: [6, 2, 5], direction: [0, 0, -1]
})), [1.5, .5], 'rectangle drag extends on the starting face plane beyond its visible quad');
assert.deepEqual(faceRectangleWorldPoint(face, .5, .5), [2, 2, 0]);
const oblique = faceRectangleFrame({ point: [1, 2, 1], facePoints: [
  [0, 0, 0], [2, 0, 2], [0, 4, 0], [2, 4, 2]
] });
assert.deepEqual(faceRectangleCoordinates(oblique, faceRectanglePlanePoint(oblique, {
  origin: [1, 2, 6], direction: [0, 0, -1]
})), [.5, .5], 'oblique faces use their actual 3D plane, independent of screen projection');
const pixelSource = new Uint8ClampedArray(5 * 5 * 4);
pixelSource.set([255, 0, 0, 255], (2 * 5 + 1) * 4);
const pixelMask = new Uint8Array(25); pixelMask[2 * 5 + 1] = 1;
const moved = transformSelectedPixels(pixelSource, pixelMask, 5, 5, { dx: 2 });
assert.equal(moved.pixels[(2 * 5 + 1) * 4 + 3], 0, 'moving cuts the original pixel');
assert.equal(moved.pixels[(2 * 5 + 3) * 4], 255, 'moving places the selected pixel');
const copied = transformSelectedPixels(pixelSource, pixelMask, 5, 5, { dx: 2, copy: true });
assert.equal(copied.pixels[(2 * 5 + 1) * 4], 255, 'copy leaves the original pixel untouched');
assert.equal(copied.pixels[(2 * 5 + 3) * 4], 255, 'copy places a second pixel');
const rotated = transformSelectedPixels(pixelSource, pixelMask, 5, 5, { angle: Math.PI / 2 });
assert.equal(rotated.pixels[(2 * 5 + 1) * 4], 255, 'a one-pixel selection rotates around its center');
const angled = transformSelectedPixels(pixelSource, pixelMask, 5, 5, { angle: Math.PI / 4 });
assert.equal(angled.pixels[(2 * 5 + 1) * 4 + 3] > 0, true,
  'inverse mapping retains coverage during free rotation');
const big = new Uint8ClampedArray(13 * 13 * 4), bigMask = new Uint8Array(13 * 13);
for (let y = 4; y < 9; y++) for (let x = 4; x < 9; x++) {
  const i = y * 13 + x;
  bigMask[i] = 1; big.set([90, 170, 220, 255], i * 4);
}
const free = transformSelectedPixels(big, bigMask, 13, 13, { angle: .47, scaleX: 1.3, scaleY: 1.1 });
for (let y = 5; y < 8; y++) for (let x = 5; x < 8; x++)
  assert.equal(free.pixels[(y * 13 + x) * 4 + 3], 255, 'inverse rotation leaves no holes inside the rotated patch');
const frame = { left: 1, top: 1, right: 4, bottom: 4, cx: 3, cy: 3 };
assert.deepEqual(mapSelectionPoint(selectionGestureMatrix(frame, [5, 5], [8, 7], 2), [1, 1]), [1, 1],
  'the opposite corner stays anchored on resize');
assert.deepEqual(mapSelectionPoint(selectionGestureMatrix(frame, [5, 5], [0, 7], 2), [5, 5]), [0, 7],
  'crossing the anchor flips the chosen scale axis');
const snapped = selectionGestureMatrix(frame, [5, 1], [5, 3], 1);
const unsnapped = selectionGestureMatrix(frame, [5, 1], [5, 3], 1, { rotationStep: 0 });
assert.ok(Math.abs(snapped[1]) < 1e-8 || Math.abs(snapped[0]) < 1e-8);
assert.ok(Math.abs(unsnapped[1]) > .1 && Math.abs(unsnapped[0]) > .1);
const step = Math.PI / 12, offsetAngle = .35;
const precise = selectionGestureMatrix(frame, [5, 1], [5, 3], 1, { rotationStep: step, rotationOffset: offsetAngle });
const steps = (Math.atan2(precise[1], precise[0]) + offsetAngle) / step;
assert.ok(Math.abs(steps - Math.round(steps)) < 1e-8, 'Ctrl snaps the current angle to a 15-degree increment');
const keepAspect = selectionGestureMatrix(frame, [5, 5], [9, 6], 2, { scaleBasis: [1, 1] });
assert.equal(keepAspect[0], keepAspect[3], 'Shift scales both current extents equally');
const originalAspect = selectionGestureMatrix(frame, [5, 5], [9, 6], 2, { scaleBasis: [2, 1] });
assert.equal(originalAspect[0] * 2, originalAspect[3], 'Ctrl compensates for the previous non-uniform scale');

const nearest = transformSelectedPixels(pixelSource, pixelMask, 5, 5, { angle: Math.PI / 4, sampling: 'nearest' });
assert.equal(nearest.pixels[(2 * 5 + 1) * 4 + 3], 255, 'nearest-neighbor keeps a sharp opaque texel');
const quad = [[2, 7], [18, 3], [16, 24], [5, 20]];
const projection = selectionHandleProjection(quad);
for (const [[x, y], [u, v]] of quad.map((corner, i) => [
  [[0, 0], [HANDLE_SIZE, 0], [HANDLE_SIZE, HANDLE_SIZE], [0, HANDLE_SIZE]][i], corner
])) {
  const w = projection[3] * x + projection[7] * y + 1;
  assert.ok(Math.abs((projection[0] * x + projection[4] * y + projection[12]) / w - u) < 1e-8);
  assert.ok(Math.abs((projection[1] * x + projection[5] * y + projection[13]) / w - v) < 1e-8);
}

const asset = { _uid: 'atlas' }, pixels = new Uint8ClampedArray(8 * 4 * 4), atlasMask = new Uint8Array(8 * 4);
const offset = (x, y) => (y * 8 + x) * 4;
pixels.set([255, 0, 0, 255], offset(1, 1)); pixels.set([0, 0, 255, 255], offset(6, 1));
pixels.set([0, 255, 0, 255], offset(4, 1)); atlasMask[9] = 1;
const primary = { asset, width: 8, height: 4, bounds: { left: 1, top: 1, right: 1, bottom: 1, cx: 1.5, cy: 1.5 },
  clip: { left: 0, top: 0, right: 3, bottom: 4 }, inverse: [1 / 3, 0, 0, 1 / 4, 0, 0] };
const mirror = { asset, width: 8, height: 4, clip: { left: 5, top: 0, right: 8, bottom: 4 },
  slots: [[5, 0], [8, 0], [5, 4], [8, 4]], hit: { symmetryPermutation: [1, 0, 3, 2] } };
let resultPixels;
const surfaces = await preparePixelSelection(primary, [mirror], new Map([[asset._uid,
  { width: 8, height: 4, pixels: atlasMask }]]), async () => ({
    canvas: { width: 8, height: 4 },
    context: { getImageData: () => ({ data: pixels }), createImageData: () => ({ data: new Uint8ClampedArray(pixels.length) }),
      putImageData: image => { resultPixels = image.data; } }
  }));
renderPixelSelection(surfaces, [1, 0, 0, 1, 1, 0], false);
assert.deepEqual([...resultPixels.slice(offset(2, 1), offset(2, 1) + 4)], [255, 0, 0, 255]);
assert.deepEqual([...resultPixels.slice(offset(5, 1), offset(5, 1) + 4)], [0, 0, 255, 255],
  'opposite UVs move in reflected directions while keeping their own pixels');
renderPixelSelection(surfaces, [1, 0, 0, 1, 3, 0], false);
assert.deepEqual([...resultPixels.slice(offset(4, 1), offset(4, 1) + 4)], [0, 255, 0, 255],
  'handles can leave the face without writing into adjacent atlas pixels');
assert.equal(resultPixels[offset(2, 1) + 3], 0, 'a later preview samples the original snapshot again');
const patch = captureSelectionPatch(surfaces, [1, 0, 0, 1, 1, 0], 'nearest');
assert.deepEqual({ ...patch, data: [...patch.data] }, { left: 2, top: 1, width: 1, height: 1, data: [255, 0, 0, 255] });
const pasted = await preparePixelSelection({ ...primary, bounds: { left: 2, top: 0, right: 2, bottom: 0 } }, [], null, async () => ({
  canvas: { width: 8, height: 4 },
  context: { getImageData: () => ({ data: pixels }), createImageData: () => ({ data: new Uint8ClampedArray(pixels.length) }),
    putImageData: image => { resultPixels = image.data; } }
}), patch);
assert.equal(renderPixelSelection(pasted, [1, 0, 0, 1, 0, 0], false), true, 'paste places pixels without requiring a transform');
assert.deepEqual([...resultPixels.slice(offset(2, 0), offset(2, 0) + 4)], [255, 0, 0, 255]);
assert.deepEqual([...resultPixels.slice(offset(1, 1), offset(1, 1) + 4)], [255, 0, 0, 255], 'paste keeps existing pixels');
const centeredNorth = { uid: 'center', faceName: 'north' };
const centeredEast = { uid: 'center', faceName: 'east' };
assert.notEqual(
  sceneBrushBranchKey(centeredNorth, centeredNorth, 'atlas'),
  sceneBrushBranchKey(centeredEast, centeredNorth, 'atlas'),
  'radial and mandala reflections must not connect strokes from two source faces on the same target face'
);
assert.equal(
  sceneBrushBranchKey(centeredNorth, centeredEast, 'atlas'),
  sceneBrushBranchKey(centeredNorth, centeredEast, 'atlas'),
  'one source-to-target branch remains continuous while the pointer stays on its source face'
);
console.log('Paint selection mask tests passed.');
