import assert from 'node:assert/strict';
import { rasterScreenPaint, rasterScreenUvFootprint, screenPaintClientPoint, screenPaintGrid, screenPaintPoint }
  from '../src/paint/screen-space.js';
import { createScenePaintController } from '../src/paint/scene-controller.js';
import { createPaintStrokeController } from '../src/paint/stroke-controller.js';

const grid = screenPaintGrid({ left: 10, top: 20, width: 800, height: 400 }, 200);
assert.deepEqual([grid.width, grid.height], [400, 200]);
assert.deepEqual(screenPaintPoint(grid, 12, 22), [1, 1]);
assert.deepEqual(screenPaintClientPoint(grid, 1, 1), [13, 23]);

const brush = rasterScreenPaint('brush', [2, 3], [8, 3], grid, { size: 1 });
for (let x = 2; x <= 8; x++) assert.equal(brush.get(3 * grid.width + x), 1);
const rectangle = rasterScreenPaint('rectangle', [2, 2], [4, 4], grid, { size: 1, filled: true });
assert.equal(rectangle.size, 9);
const outline = rasterScreenPaint('rectangle', [2, 2], [4, 4], grid, { size: 1, filled: false });
assert.equal(outline.size, 8);
const clipped = rasterScreenPaint('brush', [-4, -4], [1, 1], grid, { size: 3 });
assert.ok([...clipped.keys()].every(index => index >= 0 && index < grid.width * grid.height));
const angledFootprint = rasterScreenUvFootprint([[2, 0], [4, 2], [0, 2], [2, 4]], [2, 2]);
assert.ok(angledFootprint.some(([x, y]) => x === 2 && y === 2));
assert.ok(!angledFootprint.some(([x, y]) => x === 0 && y === 0),
  'an oblique screen cell must not paint its entire UV bounding rectangle');
const fractionalFootprint = rasterScreenUvFootprint(
  [[.25, .25], [1.25, .25], [.25, 1.25], [1.25, 1.25]], [0, 0],
  { minU: 0, minV: 0, maxU: 2, maxV: 2 });
assert.deepEqual(fractionalFootprint.map(([x, y]) => [x, y]).sort(),
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  'fractional screen-cell UV corners cover every touched integer texel');

const asset = { _uid: 'texture_a', uvWidth: 4, uvHeight: 4 };
const cube = { uid: 'cube_a', type: 'cube', faces: { up: { texture: 'texture_a', uv: [0, 0, 4, 4] } } };
const hit = {
  uid: 'cube_a', cube, cubeUid: 'cube_a', faceName: 'up',
  point: [.5, .5, 0], facePoints: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]
};
const state = {
  mode: 'paint', tool: 'brush', project: { getNode: () => cube },
  textureAssets: [asset], activeTextureUid: asset._uid, paintScreenHeight: 100,
  paintBrushSize: 1, paintBrushShape: 'square', paintBrushAa: false,
  paintShapeFilled: false, paintToolSettings: {}, paintIgnoreTransparent: false,
  paintBrushOverlay: false, modifierResultGhost: false, paintBucketScope: 'face'
};
const painted = [];
const ordinarySceneSegments = [];
let slowSceneStroke = false;
let pickOnlyExactPointer = false;
let pickOnlyEdgeSample = false;
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage() {}, imageSmoothingEnabled: false,
      getImageData: () => ({ data: new Uint8ClampedArray(4 * 4 * 4) })
    })
  })
};
const controller = createScenePaintController({
  state,
  sceneCanvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), setPointerCapture() {} },
  sceneRenderer: {
    pickDetailed: (_project, x, y) => !pickOnlyExactPointer && !pickOnlyEdgeSample
      || pickOnlyExactPointer && Math.abs(x - 50.2) < 1e-6 && Math.abs(y - 50.2) < 1e-6
      || pickOnlyEdgeSample && x > 50.1 && x < 50.25 && y > 50.1 && y < 50.25
      ? { ...hit, point: [x / 100, y / 100, 0] } : null,
    mirrorCache: null, rayAt: () => null,
    projectPoint: point => ({ x: point[0] * 100, y: point[1] * 100, behind: false })
  },
  textureAssetForReference: () => asset,
  isFaceTiled: () => false,
  loadTextureAssetImage: async () => ({ naturalWidth: 4, naturalHeight: 4 }),
  paintSymmetryRelatedHits: source => [source],
  paintSymmetryFaceKey: source => `${source.cubeUid}:${source.faceName}`,
  paintHitAlphaCache: new Map(),
  drawScreenPaintPixel: (_surface, x, y) => painted.push([x, y]),
  drawPaintSegment: (_surface, from, to) => {
    ordinarySceneSegments.push([from, to]);
    if (slowSceneStroke) {
      const until = performance.now() + 9;
      while (performance.now() < until) { /* Simulate a costly face update. */ }
    }
  },
  flushScreenPaintSurface() {},
  paintUvBounds: () => ({ minU: 0, minV: 0, maxU: 4, maxV: 4 }),
  toast(message) { throw new Error(message); }
});
controller.startScenePaintPointer({
  ctrlKey: true, pointerId: 1, clientX: 50, clientY: 50,
  preventDefault() {}
}, 50, 50);
await state.dragging.queue;
assert.deepEqual(painted[0], [2, 2], 'Ctrl brush projects a screen cell onto the visible face UV');
controller.moveScenePaintDrag({ clientX: 53, clientY: 50 });
await state.dragging.queue;
assert.ok(painted.length > 1, 'dragging keeps updating the screen-space brush');
controller.finishScenePaintDrag(state.dragging);
pickOnlyExactPointer = true;
painted.length = 0;
controller.startScenePaintPointer({
  ctrlKey: true, pointerId: 3, clientX: 50.2, clientY: 50.2,
  preventDefault() {}
}, 50.2, 50.2);
await state.dragging.queue;
assert.ok(painted.length, 'a pointer hit paints even if its virtual cell center misses the face');
controller.finishScenePaintDrag(state.dragging);
pickOnlyExactPointer = false;
pickOnlyEdgeSample = true;
painted.length = 0;
controller.startScenePaintPointer({
  ctrlKey: true, pointerId: 6, clientX: 50.5, clientY: 50.5,
  preventDefault() {}
}, 50.5, 50.5);
await state.dragging.queue;
assert.ok(painted.length, 'a screen cell paints a visible face sliver even if its center and pointer miss');
controller.finishScenePaintDrag(state.dragging);
pickOnlyEdgeSample = false;
controller.startScenePaintPointer({
  ctrlKey: false, pointerId: 4, clientX: 50, clientY: 50,
  preventDefault() {}
}, 50, 50);
controller.moveScenePaintDrag({
  clientX: 75, clientY: 75,
  getCoalescedEvents: () => [{ clientX: 50, clientY: 75 }, { clientX: 75, clientY: 75 }]
});
assert.deepEqual(state.dragging.pendingBrushPointers, [[50, 75], [75, 75]],
  'coalesced pointer samples retain the bend without duplicating the final sample');
await state.dragging.queue;
assert.ok(ordinarySceneSegments.some(segment => segment[1][0] === 2 && segment[1][1] === 3),
  'ordinary 3D brush retains a bend while pointer moves queue');
assert.deepEqual(ordinarySceneSegments.at(-1)?.[1], [3, 3],
  'ordinary 3D brush reaches the latest pointer');
controller.finishScenePaintDrag(state.dragging);
const previousRaf = globalThis.requestAnimationFrame;
let paintFrameYields = 0;
globalThis.requestAnimationFrame = callback => {
  paintFrameYields++;
  setTimeout(callback, 0);
};
slowSceneStroke = true;
controller.startScenePaintPointer({
  ctrlKey: false, pointerId: 5, clientX: 50, clientY: 50,
  preventDefault() {}
}, 50, 50);
controller.moveScenePaintDrag({ clientX: 51, clientY: 50 });
controller.moveScenePaintDrag({ clientX: 52, clientY: 50 });
await state.dragging.queue;
assert.ok(paintFrameYields > 0, 'a backlog of short brush segments yields a visible model frame');
controller.finishScenePaintDrag(state.dragging);
slowSceneStroke = false;
if (previousRaf === undefined) delete globalThis.requestAnimationFrame;
else globalThis.requestAnimationFrame = previousRaf;
cube.uvMode = 'box';
cube.size = [1, 1, 1];
cube.uv = [0, 0];
assert.deepEqual(controller.facePaintUvPoint(hit, { cube, faceName: 'up', asset }, { width: 4, height: 4 }), [1, 0],
  'screen-space painting follows box UVs even when an obsolete face rectangle remains');
cube.uvMode = 'face';

globalThis.window = { cubeBricksDesktop: { checkoutProjectJournal() {} } };
const operationIds = [];
const paintState = {
  tool: 'brush', paintColor: '#ff0000', alphaLock: false,
  paintIgnoreTransparent: false, paintHistory: [], paintFuture: []
};
const opaqueComposite = {
  width: 2, height: 2,
  getContext: () => ({
    getImageData: () => ({
      data: Uint8ClampedArray.from(
        Array.from({ length: 4 }, () => [0, 0, 0, 255]).flat())
    })
  })
};
const stroke = createPaintStrokeController({
  state: paintState,
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  paintToolErasing: () => false, paintToolOpacity: () => .5,
  noteJournalOperation: id => operationIds.push(id),
  syncRendererTextureAsset() {}, scheduleSceneRender() {}, uvPreviewIsActive: () => false,
  animationRasterCache: new Map([['texture_a', { canvas: opaqueComposite }]])
});
const root = {
  holisticStroke: true, tool: 'brush', historyAssets: new Set(),
  touchedSurfaces: new Set(), historyGroup: 'one-screen-stroke'
};
const canvas = { width: 2, height: 2 };
const context = {
  getImageData: () => ({
    width: 2, height: 2,
    data: new Uint8ClampedArray(16)
  })
};
const base = { canvas, context, asset: { _uid: 'texture_a' }, rootDrag: root };
base.baseSurface = base;
const surface = { ...base, tool: 'brush', clip: { minU: 0, minV: 0, maxU: 2, maxV: 2 } };
stroke.drawScreenPaintPixel(surface, 1, 1, 1);
stroke.drawScreenPaintPixel(surface, 1, 1, 1);
assert.equal(base.strokeTiles.get('0:0').image.data[15], 128,
  'overlapping screen samples use one holistic half-opacity stroke');
paintState.paintIgnoreTransparent = true;
stroke.drawScreenPaintPixel(surface, 0, 0, 1);
assert.equal(base.strokeTiles.get('0:0').image.data[3], 128,
  'ignore transparent permits painting a blank layer above opaque composite pixels');
paintState.paintIgnoreTransparent = false;
assert.deepEqual(operationIds, ['core.texture.brush']);
assert.equal(root.touchedSurfaces.size, 1);
const tileReads = [], tileWrites = [];
const sparseCanvas = { width: 256, height: 256 };
const sparseContext = {
  getImageData(x, y, width, height) {
    tileReads.push([x, y, width, height]);
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  },
  putImageData(_image, x, y, dirtyX, dirtyY, width, height) {
    tileWrites.push([x, y, dirtyX, dirtyY, width, height]);
  }
};
const sparseRoot = { holisticStroke: true, tool: 'brush', historyAssets: new Set(), touchedSurfaces: new Set() };
const sparseBase = { canvas: sparseCanvas, context: sparseContext, asset: { _uid: 'sparse' }, rootDrag: sparseRoot };
sparseBase.baseSurface = sparseBase;
const sparseSurface = { ...sparseBase, tool: 'brush' };
stroke.drawScreenPaintPixel(sparseSurface, 1, 1, 1);
stroke.drawScreenPaintPixel(sparseSurface, 200, 200, 1);
assert.deepEqual(tileReads, [[0, 0, 64, 64], [192, 192, 64, 64]],
  'a sparse stroke snapshots only touched texture tiles');
stroke.flushScreenPaintSurface(sparseBase);
assert.equal(tileWrites.length, 2, 'only touched tiles are flushed');
stroke.resetScreenPaintPreview(sparseRoot);
assert.equal(tileWrites.length, 4, 'screen-space preview restores only the touched tiles');
assert.equal(sparseBase.strokeTiles.get('0:0').image.data[3], 0,
  'preview reset restores the original pixel rather than stacking opacity');
const liveUploads = [];
let mainSceneFrames = 0;
const ordinaryCanvas = { width: 4, height: 4 };
const ordinaryContext = { save() {}, restore() {}, fillRect() {}, imageSmoothingEnabled: false };
const ordinaryStroke = createPaintStrokeController({
  state: paintState,
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  paintSetting: () => ({ size: 1 }), paintToolErasing: () => false,
  paintToolOpacity: () => 1, noteJournalOperation: () => {},
  syncRendererTextureAsset: (_asset, _canvas, _composited, dirty) => liveUploads.push(dirty),
  scheduleSceneRender() { mainSceneFrames++; },
  uvPreviewIsActive: () => true,
  renderUvPreview() { throw new Error('UV preview must not block the main paint frame'); }
});
ordinaryStroke.drawPaintSegment({
  canvas: ordinaryCanvas, context: ordinaryContext,
  asset: { _uid: 'ordinary' }, tool: 'brush'
}, [1, 1], [1, 1]);
await Promise.resolve();
assert.deepEqual(liveUploads, [{ x: 1, y: 1, width: 1, height: 1 }],
  'ordinary brush uploads its dirty pixel before the next display frame');
assert.equal(mainSceneFrames, 1, 'live paint schedules the main model frame');
assert.equal(ordinaryCanvas.pendingSyncDirty, null, 'ordinary brush passes its dirty pixel to live sync');
state.tool = 'fill';
state.paintToolSettings.fill = { size: 1, opacity: 100, erase: false };
const countBeforeFill = painted.length;
controller.startScenePaintPointer({
  ctrlKey: true, pointerId: 2, clientX: 50, clientY: 50,
  preventDefault() {}
}, 50, 50);
await state.dragging.queue;
assert.equal(painted.length - countBeforeFill, 16,
  'Ctrl bucket fills every visible texel of the projected face');
controller.finishScenePaintDrag(state.dragging);

console.log('Screen-space paint grid and raster tests passed.');
