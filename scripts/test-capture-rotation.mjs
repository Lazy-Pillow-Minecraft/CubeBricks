import assert from 'node:assert/strict';
import { opaquePixelBounds } from '../src/render/model-capture.js';
import { shortestAngleDelta } from '../src/utils/math/rotation.js';

const width = 7, height = 5;
const pixels = new Uint8ClampedArray(width * height * 4);
for (const [x, y] of [[2, 1], [4, 3], [3, 2]]) pixels[(y * width + x) * 4 + 3] = 128;
const canvas = { width, height, getContext: () => ({ getImageData: () => ({ data: pixels }) }) };
assert.deepEqual(opaquePixelBounds(canvas), { x: 2, y: 1, width: 3, height: 3 },
  'capture crop includes every nontransparent pixel without changing the original');
assert.equal(pixels[(1 * width + 2) * 4 + 3], 128, 'scanning does not alter source alpha');
pixels.fill(0);
assert.equal(opaquePixelBounds(canvas), null, 'an empty capture remains uncropped');

const samples = [0, 45, 90, 135, 180, 225, 270, 315, 360]
  .map(degrees => Math.atan2(Math.sin(degrees * Math.PI / 180), Math.cos(degrees * Math.PI / 180)));
let total = 0;
for (let index = 1; index < samples.length; index++) total += shortestAngleDelta(samples[index - 1], samples[index]);
assert.ok(Math.abs(total - Math.PI * 2) < 1e-10,
  'a continuous rotation crosses the 180-degree wrap without reversing');

console.log('Model capture crop and continuous rotation checks passed.');
