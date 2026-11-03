import assert from 'node:assert/strict';
import { createTextureAtlasController } from '../src/texture/atlas-controller.js';
import { createPaintStrokeController } from '../src/paint/stroke-controller.js';
import { layerRasterCache } from '../src/common/core/texture-features.js';

class Canvas {
  constructor(width = 1, height = 1) {
    this._width = width;
    this._height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
    this.context = {
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      clearRect: (x, y, width, height) => {
        for (let row = Math.max(0, y); row < Math.min(this.height, y + height); row++)
          for (let column = Math.max(0, x); column < Math.min(this.width, x + width); column++)
            this.pixels.fill(0, (row * this.width + column) * 4, (row * this.width + column + 1) * 4);
      },
      fillRect: () => {},
      drawImage: (source, ...args) => {
        const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 8
          ? args : [0, 0, source.width, source.height, args[0] ?? 0, args[1] ?? 0, source.width, source.height];
        const input = new Uint8ClampedArray(source.pixels);
        for (let row = 0; row < dh; row++) for (let column = 0; column < dw; column++) {
          const fromX = Math.floor(sx + column * sw / dw);
          const fromY = Math.floor(sy + row * sh / dh);
          const toX = dx + column, toY = dy + row;
          if (fromX < 0 || fromY < 0 || fromX >= source.width || fromY >= source.height
            || toX < 0 || toY < 0 || toX >= this.width || toY >= this.height) continue;
          const from = (fromY * source.width + fromX) * 4;
          const to = (toY * this.width + toX) * 4;
          const alpha = input[from + 3] / 255 * this.context.globalAlpha;
          const previous = this.pixels[to + 3] / 255;
          const result = alpha + previous * (1 - alpha);
          for (let channel = 0; channel < 3; channel++) this.pixels[to + channel] = result
            ? (input[from + channel] * alpha + this.pixels[to + channel] * previous * (1 - alpha)) / result : 0;
          this.pixels[to + 3] = result * 255;
        }
      },
      getImageData: (x, y, width, height) => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
          const from = ((y + row) * this.width + x + column) * 4;
          data.set(this.pixels.subarray(from, from + 4), (row * width + column) * 4);
        }
        return { width, height, data };
      },
      putImageData: (image, x, y) => {
        for (let row = 0; row < image.height; row++) for (let column = 0; column < image.width; column++) {
          const from = (row * image.width + column) * 4;
          const to = ((y + row) * this.width + x + column) * 4;
          this.pixels.set(image.data.subarray(from, from + 4), to);
        }
      }
    };
  }
  get width() { return this._width; }
  set width(value) { this._width = value; this.pixels = new Uint8ClampedArray(value * this.height * 4); }
  get height() { return this._height; }
  set height(value) { this._height = value; this.pixels = new Uint8ClampedArray(this.width * value * 4); }
  getContext() { return this.context; }
}

function pixel(canvas, x, y) {
  return [...canvas.pixels.slice((y * canvas.width + x) * 4, (y * canvas.width + x + 1) * 4)];
}

function renderer() {
  return {
    atlas: null,
    patches: 0,
    patchSizes: [],
    setTextureAtlas(source) {
      this.atlas = new Canvas(source.width, source.height);
      this.atlas.getContext('2d').drawImage(source, 0, 0);
    },
    updateTextureAtlasRegion(source, x, y) {
      this.patches++;
      this.patchSizes.push([source.width, source.height]);
      this.atlas.getContext('2d').clearRect(x, y, source.width, source.height);
      this.atlas.getContext('2d').drawImage(source, x, y);
      return true;
    },
    setTexture() {}
  };
}

const savedDocument = globalThis.document;
const savedWindow = globalThis.window;
const savedRequestAnimationFrame = globalThis.requestAnimationFrame;
const savedCancelAnimationFrame = globalThis.cancelAnimationFrame;
globalThis.document = { createElement: () => new Canvas(), querySelectorAll: () => [] };
globalThis.window = { dispatchEvent() {} };
try {
  const base = new Canvas(4, 4), editable = new Canvas(4, 4);
  base.pixels.set([30, 40, 50, 255], (1 * 4 + 1) * 4);
  layerRasterCache.set('live-base', { canvas: base, savedSource: 'base' });
  layerRasterCache.set('live-edit', { canvas: editable, savedSource: 'edit' });
  const asset = { _uid: 'live-asset', name: 'test.png', source: 'saved', uvWidth: 4, uvHeight: 4,
    activeLayerUid: 'live-edit', layers: [
      { uid: 'live-base', source: 'base', visible: true, opacity: 100, blendMode: 'normal' },
      { uid: 'live-edit', source: 'edit', visible: true, opacity: 100, blendMode: 'normal' }
    ] };
  const state = { project: { elements: [], textureSize: [4, 4] }, textureAssets: [asset], activeTextureUid: asset._uid };
  const scene = renderer(), previewRenderer = renderer(), previewCanvas = new Canvas(4, 4);
  const liveSources = new Map(), rasterCache = new Map();
  let frames = 0;
  const controller = createTextureAtlasController({ state, $: () => ({}), textureCanvas: editable,
    textureCtx: editable.getContext('2d'), sceneRenderer: scene, uvPreviewRenderer: previewRenderer,
    uvPreviewController: {}, uvEditorController: {}, livePaintTextureSources: liveSources,
    animationRasterCache: rasterCache, CUBE_FACE_NAMES: [], loadTextureAssetImage: async () => base,
    textureAssetForReference: () => null, scheduleSceneRender: () => { frames++; },
    refreshUvPreview: () => {}, updateLayerCompositePreview: (_asset, canvas, dirty) => {
      if (dirty) {
        previewCanvas.getContext('2d').clearRect(dirty.x, dirty.y, dirty.width, dirty.height);
        previewCanvas.getContext('2d').drawImage(canvas, dirty.x, dirty.y, dirty.width, dirty.height,
          dirty.x, dirty.y, dirty.width, dirty.height);
      } else previewCanvas.getContext('2d').drawImage(canvas, 0, 0);
    },
    refreshDerivedTileEntries: () => {}, uvPreviewIsActive: () => false,
    syncTexturePreviewPriority: () => {}, resetTextureView: () => {},
    activeTextureAsset: () => asset, getTextureAssetController: () => ({}) });
  await controller.rebuildTextureAtlasNow();
  let entry = controller.textureAtlasEntries[0];
  editable.pixels.set([240, 20, 10, 255], (1 * 4 + 1) * 4);
  controller.syncRendererTextureAsset(asset, editable, false, { x: 1, y: 1, width: 1, height: 1 });
  assert.deepEqual(pixel(scene.atlas, entry.x + 1, entry.y + 1), [240, 20, 10, 255],
    'the first live paint upload reaches the model before commit');
  editable.pixels.set([10, 220, 40, 255], (2 * 4 + 2) * 4);
  controller.syncRendererTextureAsset(asset, editable, false, { x: 2, y: 2, width: 1, height: 1 });
  entry = controller.textureAtlasEntries[0];
  assert.deepEqual(pixel(scene.atlas, entry.x + 2, entry.y + 2), [10, 220, 40, 255],
    'a later live paint patch reaches the model before commit');
  assert.deepEqual(pixel(previewCanvas, 2, 2), [10, 220, 40, 255],
    'the same patch reaches the 2D texture preview');
  assert.equal(asset.source, 'saved', 'live feedback does not wait for a saved PNG');
  assert.equal(scene.patches, 2);
  assert.deepEqual(scene.patchSizes[1], [1, 1], 'later live updates retain the small dirty upload');
  assert.ok(frames >= 2);
  const callbacks = [];
  globalThis.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
  globalThis.cancelAnimationFrame = () => {};
  const uploads = [];
  let liveRenders = 0;
  const stroke = createPaintStrokeController({ state: { paintColor: '#ffffff', activeTextureUid: 'other' },
    syncRendererTextureAsset: (_asset, _canvas, _composited, dirty) => uploads.push(dirty),
    scheduleSceneRender: () => {}, renderScene: () => { liveRenders++; },
    paintHitAlphaCache: new Map(), $$: () => [], markDirty: () => {} });
  const painted = { pendingSyncDirty: { minX: 1, minY: 1, maxX: 1, maxY: 1 } };
  stroke.queuePaintedTextureSync(asset, painted);
  painted.pendingSyncDirty = { minX: 3, minY: 1, maxX: 3, maxY: 1 };
  stroke.queuePaintedTextureSync(asset, painted);
  assert.equal(callbacks.length, 1, 'pointer samples share one atlas upload per frame');
  callbacks[0]();
  assert.deepEqual(uploads, [{ x: 1, y: 1, width: 3, height: 1 }]);
  assert.equal(liveRenders, 1, 'the model draws in the same frame as the atlas upload');
  const releaseAsset = { _uid: 'release', layers: null };
  const releaseCanvas = { width: 1, height: 1, pendingSyncDirty: {
    minX: 0, minY: 0, maxX: 0, maxY: 0
  }, toDataURL: () => 'data:image/png;base64,AA==' };
  stroke.queuePaintedTextureSync(releaseAsset, releaseCanvas);
  stroke.finishTexturePaintDrag({ asset: releaseAsset, canvas: releaseCanvas });
  assert.equal(uploads.length, 2, 'releasing a stroke uploads only its final image');
  callbacks[1]();
  assert.equal(uploads.length, 2, 'a cancelled live patch cannot overwrite the committed image');
  console.log('Live paint atlas tests passed.');
} finally {
  if (savedDocument === undefined) delete globalThis.document;
  else globalThis.document = savedDocument;
  if (savedWindow === undefined) delete globalThis.window;
  else globalThis.window = savedWindow;
  if (savedRequestAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = savedRequestAnimationFrame;
  if (savedCancelAnimationFrame === undefined) delete globalThis.cancelAnimationFrame;
  else globalThis.cancelAnimationFrame = savedCancelAnimationFrame;
  layerRasterCache.delete('live-base');
  layerRasterCache.delete('live-edit');
}
