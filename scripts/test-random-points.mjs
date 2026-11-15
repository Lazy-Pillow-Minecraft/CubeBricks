import assert from 'node:assert/strict';
import { sampleRandomPoints } from '../src/texture/random-points.js';
import { copyRandomPointsToSymmetricFaces } from '../src/texture/random-points-symmetry.js';

function seededRandom(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const options = { width: 64, height: 48, diameter: 3, gap: 4, yieldControl: async () => {} };
const first = await sampleRandomPoints({ ...options, random: seededRandom(42) });
const second = await sampleRandomPoints({ ...options, random: seededRandom(42) });
assert.deepEqual(first, second, 'the sampler must be reproducible with a supplied seed');
assert.ok(first.length > 10);
for (let i = 0; i < first.length; i++) {
  assert.ok(first[i].x >= 0 && first[i].x <= options.width - options.diameter);
  assert.ok(first[i].y >= 0 && first[i].y <= options.height - options.diameter);
  for (let j = i + 1; j < first.length; j++) {
    const distance = Math.hypot(first[i].x - first[j].x, first[i].y - first[j].y);
    assert.ok(distance >= options.diameter + options.gap, 'dot edges must keep their minimum gap');
  }
}

const pixels = new Uint8ClampedArray(8 * 4 * 4);
pixels.set([255, 0, 0, 255], (1 * 8 + 0) * 4);
pixels.set([0, 0, 255, 255], (1 * 8 + 4) * 4);
let rendered = null;
const canvas = {
  width: 8, height: 4,
  getContext() {
    return {
      getImageData: () => ({ data: new Uint8ClampedArray(pixels) }),
      putImageData: image => { rendered = image.data; }
    };
  }
};
const records = new Map([
  ['left', { uvSlots: [[0, 0], [4, 0], [0, 4], [4, 4]] }],
  ['right', { uvSlots: [[4, 0], [8, 0], [4, 4], [8, 4]] }]
]);
const relations = new Map([
  ['left', [{ targetKey: 'right', permutation: [1, 0, 3, 2] }]],
  ['right', [{ targetKey: 'left', permutation: [1, 0, 3, 2] }]]
]);
assert.equal(copyRandomPointsToSymmetricFaces(canvas, { records, relations }, () => true), 2);
assert.deepEqual([...rendered.slice((1 * 8 + 7) * 4, (1 * 8 + 7) * 4 + 4)], [255, 0, 0, 255],
  'the target face must use the matched corner orientation');
assert.equal(rendered[(1 * 8 + 4) * 4 + 3], 0, 'independently sampled target pixels must be replaced');

rendered = null;
const centered = new Map([['one', records.get('left')]]);
const selfRelation = new Map([['one', [{ targetKey: 'one', permutation: [1, 0, 3, 2] }]]]);
assert.equal(copyRandomPointsToSymmetricFaces(canvas, { records: centered, relations: selfRelation }, () => true), 1);
assert.equal(rendered[(1 * 8 + 0) * 4 + 3], 255, 'the original pixel remains on a self-symmetric face');
assert.equal(rendered[(1 * 8 + 3) * 4 + 3], 255, 'a self-symmetric face receives its mirrored pixel');

console.log('Random point generation tests passed.');
