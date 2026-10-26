import assert from 'node:assert/strict';
import { mapLayerTonePixels, toneMapStops } from '../src/common/core/layer-tone-map.js';

const discrete = { paletteType: 'discrete', paletteSamples: ['#ffffff', '#808080', '#000000'] };
const original = new Uint8ClampedArray([255, 255, 255, 255, 128, 128, 128, 128, 0, 0, 0, 0]);
const mapped = new Uint8ClampedArray(original);
mapLayerTonePixels(mapped, discrete);
assert.deepEqual([...mapped], [255, 255, 255, 255, 128, 128, 128, 128, 0, 0, 0, 0],
  'the fixed 0–100% grayscale scale maps midpoint gray to the midpoint swatch and preserves alpha');
assert.equal(original[4], 128, 'tone mapping does not mutate the source raster');

const partialRange = new Uint8ClampedArray([200, 200, 200, 255, 100, 100, 100, 255]);
mapLayerTonePixels(partialRange, discrete);
assert.deepEqual([partialRange[0], partialRange[4]], [255, 128],
  'the brightest and darkest pixels of a layer do not redefine the mapping endpoints');

const anchored = new Uint8ClampedArray([255, 255, 255, 255, 128, 128, 128, 255, 0, 0, 0, 255]);
mapLayerTonePixels(anchored, { ...discrete, anchorEnabled: true, anchorColorIndex: 1, anchorGray: 50, grayUnit: 'percent' });
assert.deepEqual([anchored[0], anchored[4], anchored[8]], [255, 128, 0],
  'the chosen discrete palette color maps to the specified gray level');

const continuous = { paletteType: 'continuous', paletteSamples: Array.from({ length: 101 }, (_, i) => {
  const hex = Math.round(255 * (1 - i / 100)).toString(16).padStart(2, '0');
  return `#${hex}${hex}${hex}`;
}), segmentCount: 5, anchorEnabled: true, anchorPercent: 35, anchorGray: 128 };
const stops = toneMapStops(continuous);
assert.equal(stops.length, 5);
assert.deepEqual(stops[1], [166, 166, 166], 'the nearest segment is snapped to the selected palette position');
assert.deepEqual(stops[2], [110, 110, 110], 'segments on the other side are redistributed independently');

console.log('Layer tone-map tests passed.');
