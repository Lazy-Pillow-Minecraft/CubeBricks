import assert from 'node:assert/strict';
import { paintSelectionAllows, faceRectangleFrame, faceRectanglePlanePoint,
  faceRectangleCoordinates, faceRectangleWorldPoint } from '../src/paint/selection-controller.js';
import { transformSelectedPixels } from '../src/paint/selection-transform.js';
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
