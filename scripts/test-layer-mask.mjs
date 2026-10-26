import assert from 'node:assert/strict';
import { applyLayerMaskPixels } from '../src/common/core/layer-blend.js';
import { compositeLayers, layerRasterCache } from '../src/common/core/texture-features.js';

const colored = new Uint8ClampedArray([200, 80, 40, 255, 1, 2, 3, 128]);
applyLayerMaskPixels(colored, new Uint8ClampedArray([255, 255, 255, 128, 0, 0, 0, 255]));
assert.deepEqual([...colored], [200, 80, 40, 128, 1, 2, 3, 0],
  'mask coverage combines grayscale brightness and alpha without changing RGB');

class Canvas {
  constructor(pixel = [0, 0, 0, 0]) {
    this._width = 1; this._height = 1;
    this.data = new Uint8ClampedArray(pixel);
    this.context = {
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      drawImage: source => {
        const upper = source.data;
        const alpha = upper[3] / 255 * this.context.globalAlpha;
        const lowerAlpha = this.data[3] / 255;
        const outputAlpha = alpha + lowerAlpha * (1 - alpha);
        for (let channel = 0; channel < 3; channel++) this.data[channel] = outputAlpha
          ? (upper[channel] * alpha + this.data[channel] * lowerAlpha * (1 - alpha)) / outputAlpha : 0;
        this.data[3] = outputAlpha * 255;
      },
      getImageData: () => ({ data: new Uint8ClampedArray(this.data) }),
      putImageData: image => { this.data.set(image.data); }
    };
  }
  get width() { return this._width; }
  set width(next) { this._width = next; this.data = new Uint8ClampedArray(next * this._height * 4); }
  get height() { return this._height; }
  set height(next) { this._height = next; this.data = new Uint8ClampedArray(this._width * next * 4); }
  getContext() { return this.context; }
}

globalThis.document = { createElement: type => {
  assert.equal(type, 'canvas');
  return new Canvas();
} };

layerRasterCache.set('paint', { canvas: new Canvas([220, 40, 20, 255]) });
layerRasterCache.set('mask', { canvas: new Canvas([255, 255, 255, 128]) });
const asset = { layers: [
  { uid: 'paint', visible: true, opacity: 100, blendMode: 'normal', maskLayerUid: 'mask' },
  { uid: 'mask', visible: false, opacity: 100, blendMode: 'normal' }
] };
assert.deepEqual([...compositeLayers(asset).data], [220, 40, 20, 128],
  'a hidden source layer still masks a visible layer');
asset.layers[1].visible = true;
assert.equal(compositeLayers(asset).data[3], 192,
  'showing the source affects only its normal stack rendering, not the mask coverage');
asset.layers[1].visible = false;
asset.layers[0].opacity = 50;
assert.equal(compositeLayers(asset).data[3], 64,
  'mask coverage and target opacity are independent and combine during compositing');

asset.layers[0].maskLayerUid = 'group';
asset.layers[0].opacity = 100;
asset.layers[1].parentUid = 'group';
asset.layers.push({ uid: 'group', type: 'group', visible: false, opacity: 100, blendMode: 'normal' });
assert.equal(compositeLayers(asset).data[3], 128,
  'a hidden group and its hidden children can still provide a mask');

asset.layers[1].maskLayerUid = 'paint';
assert.doesNotThrow(() => compositeLayers(asset), 'cyclic mask references must not recurse indefinitely');
console.log('Layer mask tests passed.');
