import assert from 'node:assert/strict';
import { compositeLayers, layerRasterCache, tiledFaceRaster } from '../src/common/core/texture-features.js';

class RasterCanvas {
  constructor(width = 1, height = 1) {
    this._width = width;
    this._height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.context = {
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      drawImage: (source, ...args) => {
        const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 8
          ? args : [0, 0, source.width, source.height, args[0] || 0, args[1] || 0, source.width, source.height];
        for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
          const sourceX = Math.floor(sx + x * sw / dw), sourceY = Math.floor(sy + y * sh / dh);
          const targetX = x + dx, targetY = y + dy;
          if (targetX < 0 || targetY < 0 || targetX >= this.width || targetY >= this.height) continue;
          const from = (sourceY * source.width + sourceX) * 4;
          const to = (targetY * this.width + targetX) * 4;
          const alpha = source.data[from + 3] / 255 * this.context.globalAlpha;
          const lower = this.data[to + 3] / 255;
          const result = alpha + lower * (1 - alpha);
          for (let channel = 0; channel < 3; channel++) this.data[to + channel] = result
            ? (source.data[from + channel] * alpha + this.data[to + channel] * lower * (1 - alpha)) / result : 0;
          this.data[to + 3] = result * 255;
        }
      },
      getImageData: () => ({ data: new Uint8ClampedArray(this.data) }),
      createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: image => { this.data.set(image.data); }
    };
  }
  get width() { return this._width; }
  set width(value) {
    this._width = value;
    this.data = new Uint8ClampedArray(value * this._height * 4);
  }
  get height() { return this._height; }
  set height(value) {
    this._height = value;
    this.data = new Uint8ClampedArray(this._width * value * 4);
  }
  getContext() { return this.context; }
}

const previousDocument = globalThis.document;
globalThis.document = { createElement: () => new RasterCanvas() };
try {
  const bottom = new RasterCanvas(4, 4), top = new RasterCanvas(4, 4), mask = new RasterCanvas(4, 4);
  for (let pixel = 0; pixel < 16; pixel++) {
    bottom.data.set([20, 40, 80, 255], pixel * 4);
    top.data.set([200, 60, 40, pixel % 2 ? 160 : 255], pixel * 4);
    mask.data.set([255, 255, 255, pixel % 3 ? 128 : 255], pixel * 4);
  }
  layerRasterCache.set('region-bottom', { canvas: bottom });
  layerRasterCache.set('region-top', { canvas: top });
  layerRasterCache.set('region-mask', { canvas: mask });
  const asset = {
    layers: [
      { uid: 'region-bottom', visible: true, opacity: 100, blendMode: 'normal' },
      { uid: 'region-top', visible: true, opacity: 60, blendMode: 'normal', maskLayerUid: 'region-mask' },
      { uid: 'region-mask', visible: false, opacity: 100, blendMode: 'normal' }
    ]
  };
  const full = compositeLayers(asset);
  const region = compositeLayers(asset, null, null, { x: 1, y: 1, width: 2, height: 2 });
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const fullOffset = ((y + 1) * 4 + x + 1) * 4;
    const regionOffset = (y * 2 + x) * 4;
    assert.deepEqual([...region.data.slice(regionOffset, regionOffset + 4)],
      [...full.data.slice(fullOffset, fullOffset + 4)], 'local layer stack matches full composite');
  }
  const tileSource = new RasterCanvas(2, 2);
  tileSource.data.set([255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 0, 255]);
  const tileCube = { size: [2, 1, 2], faces: { up: { tiling: { width: 1, height: 1 } } } };
  const expectedTile = tiledFaceRaster(tileCube, 'up', tileSource);
  const pixels = tileSource.getContext('2d').getImageData(0, 0, 2, 2);
  tileSource.context.getImageData = () => { throw new Error('source pixels should be reused'); };
  const sharedTile = tiledFaceRaster(tileCube, 'up', tileSource, null, null, pixels);
  assert.deepEqual([...sharedTile.data], [...expectedTile.data],
    'reusing source pixels preserves the exact tiled output');
  console.log('Layer region compositing tests passed.');
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  for (const uid of ['region-bottom', 'region-top', 'region-mask']) layerRasterCache.delete(uid);
}
